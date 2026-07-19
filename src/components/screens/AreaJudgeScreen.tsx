import { useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  AreaCountEvaluation,
  AreaId,
  AreaJudge,
  SkipTargetOption,
} from "../../domain/types";
import type { TrainingStepConfig } from "../../domain/trainingMode";
import type { AreaCountRecommendation } from "../../domain/areaCountHistory.ts";
import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { JudgeHintDialog } from "../common/JudgeHintDialog";
import { ScreenHeader } from "../layout/ScreenHeader";
import { useSwipeToSkip } from "../../hooks/useSwipeToSkip";
import {
  buildCalculatorDraftKey,
  clearCalculatorDraft,
  loadCalculatorDraft,
  saveCalculatorDraft,
} from "../../domain/calculatorDraft";

type AreaJudgeScreenProps = {
  weekdayText: string;
  timeText: string;
  areaId: AreaId;
  areaName: string;
  calculatorDraftScope: string;
  showJudgeGuide?: boolean;
  basisGuide: {
    noticeText?: string;
    weekdaySummaryText?: string;
    weekdayDetailLines?: string[];
    bonusSummaryText?: string;
    bonusDetailLines?: string[];
    referenceText: string;
  };
  pendingBanner?: {
    remainingCount: number;
    reason: "manual" | "few";
  } | null;
  timeSwitchNotice?: string | null;
  areaCountAssistEnabled?: boolean;
  areaCountSameItemLimit?: number | null;
  finalCountMode?: boolean;
  trainingStepConfig: TrainingStepConfig;
  getAreaCountRecommendation?: (count: number) => AreaCountRecommendation;
  onJudge: (
    judge: Exclude<AreaJudge, null>,
    areaCount?: number | null,
    manualAreaCountEvaluation?: AreaCountEvaluation,
  ) => void;
  onSkip: () => void;
  onGoBack: () => void;
  onReturnHome: () => void;
  canChooseSkipTarget?: boolean;
  skipTargetOptions?: SkipTargetOption[];
  onChooseSkipTarget?: (areaId: SkipTargetOption["areaId"]) => void;
  onJudgeGuideShown?: () => void;
};

const subActionButtonStyle: CSSProperties = {
  minWidth: 88,
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #ccc",
  background: "#fff",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

function getJudgeLabelColor(label: string) {
  if (label === "多い" || label === "やや多い") return "#ff0000";
  if (label === "どちらでもない" || label === "普通") return "#008000";
  if (label === "少ない" || label === "やや少ない") return "#0000ff";
  return "#000";
}

function JudgeOptionButton({
  label,
  subLabel,
  selected,
  onClick,
  buttonRef,
}: {
  label: string;
  subLabel?: string;
  selected: boolean;
  onClick: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        padding: "14px 16px",
        borderRadius: 12,
        border: selected ? "2px solid #2f5ef5" : "1px solid #ccc",
        background: selected ? "#e8f0ff" : "#fff",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: getJudgeLabelColor(label),
        }}
      >
        {label}
        {subLabel ? (
          <span
            style={{
              fontSize: 13,
              color: "#555",
              fontWeight: 600,
              marginLeft: 6,
            }}
          >
            ({subLabel})
          </span>
        ) : null}
      </div>
    </button>
  );
}

function parseAreaCount(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function normalizeAdditionFormula(value: string): string {
  return value
    .replace(/[^0-9+]/g, "")
    .replace(/\+{2,}/g, "+")
    .replace(/^\+/, "");
}

function calculateAdditionResult(value: string): number | null {
  const normalized = normalizeAdditionFormula(value).replace(/\+$/, "");
  if (!normalized) return null;

  const parts = normalized.split("+");
  if (parts.some((part) => part === "")) return null;

  const total = parts.reduce((sum, part) => sum + Number(part), 0);
  if (!Number.isFinite(total) || total < 0) return null;
  return Math.round(total);
}

function getRecommendationColor(
  recommendation: AreaCountRecommendation | null,
): string {
  const evaluation = recommendation?.suggestedEvaluation;
  if (evaluation === "many" || evaluation === "slightly_many") return "#b71c1c";
  if (evaluation === "few" || evaluation === "slightly_few") return "#0d47a1";
  return "#1b5e20";
}

function BasisTimeMiniPanel({
  weekdayText,
  timeText,
}: {
  weekdayText: string;
  timeText: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        padding: "10px 12px",
        borderRadius: 10,
        background: "#f7f7f7",
        border: "1px solid #e0e0e0",
        fontSize: 13,
        color: "#333",
        lineHeight: 1.5,
      }}
    >
      <div>
        <strong>今日の曜日：</strong>
        {weekdayText}
      </div>
      <div>
        <strong>値引時刻：</strong>
        {timeText}
      </div>
    </div>
  );
}

function getComparisonNotice(
  recommendation: AreaCountRecommendation,
): string | null {
  if (recommendation.comparisonMode === "three_day_holiday_middle") {
    return "※三連休中日のため、火木日と金土を別々に集計した50対50の中間基準で判定しています。";
  }

  if (recommendation.comparisonMode !== "fallback_group") return null;

  const group = recommendation.actualWeekdayGroup ?? "暫定グループ";
  return `※同じ曜日の過去データが足りないため、暫定グループ（${group}）で判定しています。`;
}

export function AreaJudgeScreen({
  weekdayText,
  timeText,
  areaId,
  areaName,
  calculatorDraftScope,
  basisGuide,
  timeSwitchNotice,
  areaCountAssistEnabled = false,
  areaCountSameItemLimit = null,
  finalCountMode = false,
  trainingStepConfig,
  getAreaCountRecommendation,
  onJudge,
  onSkip,
  onGoBack,
  onReturnHome,
  canChooseSkipTarget = false,
  skipTargetOptions = [],
  onChooseSkipTarget,
}: AreaJudgeScreenProps) {
  const [showSkipTargetPicker, setShowSkipTargetPicker] = useState(false);
  const [showJudgeHint, setShowJudgeHint] = useState(false);
  const [areaCountText, setAreaCountText] = useState("");
  const [areaCountSubmitted, setAreaCountSubmitted] = useState(false);
  const [areaCountCalculatorText, setAreaCountCalculatorText] = useState("");
  const normalManualJudgeButtonRef = useRef<HTMLButtonElement | null>(null);
  const areaCountCalculatorDraftKey = buildCalculatorDraftKey({
    kind: "area-count",
    scopeId: calculatorDraftScope,
    areaId,
  });
  const skipTargetGroups = [
    {
      label: "スキップしたエリア",
      options: skipTargetOptions.filter(
        (option) => option.status === "skipped_manual",
      ),
    },
    {
      label: "少ないため後回ししたエリア",
      options: skipTargetOptions.filter(
        (option) => option.status === "postponed_few",
      ),
    },
    {
      label: "未着手のエリア",
      options: skipTargetOptions.filter(
        (option) => option.status === "unstarted",
      ),
    },
  ].filter((group) => group.options.length > 0);

  useEffect(() => {
    const calculatorDraft = loadCalculatorDraft(areaCountCalculatorDraftKey);

    setShowSkipTargetPicker(false);
    setShowJudgeHint(false);
    setAreaCountText("");
    setAreaCountSubmitted(false);
    setAreaCountCalculatorText(calculatorDraft?.text ?? "");
  }, [areaCountCalculatorDraftKey]);

  const parsedAreaCount = parseAreaCount(areaCountText);
  const areaCountCalculatorResult = calculateAdditionResult(
    areaCountCalculatorText,
  );
  const areaCountRecommendation =
    areaCountAssistEnabled &&
    parsedAreaCount !== null &&
    getAreaCountRecommendation
      ? getAreaCountRecommendation(parsedAreaCount)
      : null;
  const isAreaCountReady = areaCountRecommendation?.status === "ready";
  const isStep1 = trainingStepConfig.step === "step1";
  const canUseManualJudge = !areaCountAssistEnabled || parsedAreaCount !== null;

  const clearAreaCountCalculatorDraft = () => {
    clearCalculatorDraft(areaCountCalculatorDraftKey);
  };

  const saveAreaCountCalculatorDraft = () => {
    if (areaCountCalculatorText) {
      saveCalculatorDraft(areaCountCalculatorDraftKey, {
        text: areaCountCalculatorText,
        open: true,
      });
      return;
    }

    clearAreaCountCalculatorDraft();
  };

  const handleSkip = () => {
    saveAreaCountCalculatorDraft();
    onSkip();
  };

  const handleChooseSkipTarget = (areaId: SkipTargetOption["areaId"]) => {
    saveAreaCountCalculatorDraft();
    onChooseSkipTarget?.(areaId);
  };

  const swipeToSkipHandlers = useSwipeToSkip({ onSwipeLeft: handleSkip });

  const handleJudge = (judge: Exclude<AreaJudge, null>) => {
    clearAreaCountCalculatorDraft();
    onJudge(judge, parsedAreaCount);
  };

  const handleManualAreaCountEvaluation = (evaluation: AreaCountEvaluation) => {
    clearAreaCountCalculatorDraft();
    onJudge("normal", parsedAreaCount, evaluation);
  };

  const handleAreaCountCalculatorDigit = (digit: string) => {
    setAreaCountCalculatorText((current) => {
      const next = normalizeAdditionFormula(`${current}${digit}`);
      return next.replace(/(^|\+)0+(?=\d)/g, "$1");
    });
  };

  const handleAreaCountCalculatorPlus = () => {
    setAreaCountCalculatorText((current) => {
      const normalized = normalizeAdditionFormula(current);
      if (!normalized || normalized.endsWith("+")) return normalized;
      return `${normalized}+`;
    });
  };

  const handleAreaCountCalculatorBackspace = () => {
    setAreaCountCalculatorText((current) => current.slice(0, -1));
  };

  const completeAreaCountEntry = () => {
    if (areaCountCalculatorResult === null) return;

    const completedCount = areaCountCalculatorResult;
    const completedRecommendation =
      areaCountAssistEnabled && getAreaCountRecommendation
        ? getAreaCountRecommendation(completedCount)
        : null;

    setAreaCountText(String(completedCount));
    clearAreaCountCalculatorDraft();

    if (finalCountMode) {
      onJudge("normal", completedCount);
      return;
    }

    if (completedRecommendation?.status === "ready") {
      onJudge("normal", completedCount);
      return;
    }

    if (isStep1 && areaCountAssistEnabled) {
      onJudge("normal", completedCount);
      return;
    }

    setAreaCountSubmitted(true);
    window.setTimeout(() => {
      normalManualJudgeButtonRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, 0);
  };

  return (
    <main
      {...swipeToSkipHandlers}
      style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}
    >
      <ScreenHeader
        weekdayText={weekdayText}
        timeText={timeText}
        areaName={areaName}
        rightAction={
          <button type="button" onClick={onGoBack} style={subActionButtonStyle}>
            戻る
          </button>
        }
      />

      {timeSwitchNotice ? (
        <section
          style={{
            border: "1px solid #ead28b",
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
            background: "#fff8e1",
            whiteSpace: "pre-wrap",
            lineHeight: 1.7,
          }}
        >
          <div>{timeSwitchNotice}</div>
        </section>
      ) : null}

      {!finalCountMode ? (
        <WeekdayBasePanel
          noticeText={basisGuide.noticeText}
          weekdaySummaryText={basisGuide.weekdaySummaryText}
          weekdayDetailLines={basisGuide.weekdayDetailLines}
          bonusSummaryText={basisGuide.bonusSummaryText}
          bonusDetailLines={basisGuide.bonusDetailLines}
        />
      ) : null}

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 18,
              lineHeight: 1.7,
              fontWeight: 800,
              flex: 1,
            }}
          >
            このエリア全体で、消費期限が今日までの商品数は？
          </div>
        </div>

        {areaCountAssistEnabled ? (
          <section style={{ marginBottom: 14 }}>
            {!areaCountSubmitted ? (
              <section
                style={{
                  border: "1px solid #d6d6d6",
                  borderRadius: 12,
                  padding: 12,
                  background: "#fafafa",
                  marginBottom: 12,
                }}
              >
                <div
                  aria-live="polite"
                  style={{
                    minHeight: 44,
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #bbb",
                    background: "#fff",
                    fontSize: 20,
                    fontWeight: 900,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    color: areaCountCalculatorText ? "#111" : "#999",
                    overflowWrap: "anywhere",
                    textAlign: "right",
                  }}
                >
                  {areaCountCalculatorText || "0"}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 14,
                    fontWeight: 800,
                    textAlign: "right",
                    color: "#333",
                  }}
                >
                  合計：{areaCountCalculatorResult ?? 0}
                </div>
                <div
                  aria-label="残数入力・足し算電卓キーパッド"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(
                    (digit) => (
                      <button
                        key={digit}
                        type="button"
                        onClick={() => handleAreaCountCalculatorDigit(digit)}
                        style={{
                          padding: "12px 0",
                          borderRadius: 12,
                          border: "1px solid #ccc",
                          background: "#fff",
                          fontSize: 18,
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                      >
                        {digit}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={() => handleAreaCountCalculatorDigit("0")}
                    style={{
                      padding: "12px 0",
                      borderRadius: 12,
                      border: "1px solid #ccc",
                      background: "#fff",
                      fontSize: 18,
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handleAreaCountCalculatorPlus}
                    disabled={
                      !areaCountCalculatorText ||
                      areaCountCalculatorText.endsWith("+")
                    }
                    style={{
                      padding: "12px 0",
                      borderRadius: 12,
                      border: "1px solid #ccc",
                      background:
                        areaCountCalculatorText &&
                        !areaCountCalculatorText.endsWith("+")
                          ? "#fff"
                          : "#eee",
                      color:
                        areaCountCalculatorText &&
                        !areaCountCalculatorText.endsWith("+")
                          ? "#111"
                          : "#999",
                      fontSize: 18,
                      fontWeight: 900,
                      cursor:
                        areaCountCalculatorText &&
                        !areaCountCalculatorText.endsWith("+")
                          ? "pointer"
                          : "not-allowed",
                    }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={handleAreaCountCalculatorBackspace}
                    disabled={!areaCountCalculatorText}
                    style={{
                      padding: "12px 0",
                      borderRadius: 12,
                      border: "1px solid #ccc",
                      background: areaCountCalculatorText ? "#fff" : "#eee",
                      color: areaCountCalculatorText ? "#111" : "#999",
                      fontSize: 18,
                      fontWeight: 900,
                      cursor: areaCountCalculatorText
                        ? "pointer"
                        : "not-allowed",
                    }}
                    aria-label="電卓を1文字削除"
                  >
                    ⌫
                  </button>
                </div>
                <button
                  type="button"
                  onClick={completeAreaCountEntry}
                  disabled={areaCountCalculatorResult === null}
                  style={{
                    ...subActionButtonStyle,
                    width: "100%",
                    marginTop: 10,
                    border:
                      areaCountCalculatorResult !== null
                        ? "2px solid #2f5ef5"
                        : "1px solid #ccc",
                    background:
                      areaCountCalculatorResult !== null ? "#e8f0ff" : "#eee",
                    color: areaCountCalculatorResult !== null ? "#111" : "#999",
                    cursor:
                      areaCountCalculatorResult !== null
                        ? "pointer"
                        : "not-allowed",
                  }}
                >
                  完了
                </button>
              </section>
            ) : (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "#f7f7f7",
                  border: "1px solid #e0e0e0",
                  fontSize: 16,
                  fontWeight: 900,
                }}
              >
                入力した残数：{parsedAreaCount}個
              </div>
            )}

            {areaCountSameItemLimit !== null ? (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 16,
                  color: "#333",
                  lineHeight: 1.7,
                }}
              >
                商品名が同じ商品が11個以上ある場合、その商品は10個としてカウントします。
              </div>
            ) : null}

            {areaCountSubmitted &&
            parsedAreaCount !== null &&
            areaCountRecommendation ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 10,
                  background: "#fff",
                  border: "1px solid #e0e0e0",
                  lineHeight: 1.7,
                }}
              >
                <div
                  style={{
                    fontWeight: 900,
                    color: getRecommendationColor(areaCountRecommendation),
                  }}
                >
                  {areaCountRecommendation.summaryText}
                </div>
                {getComparisonNotice(areaCountRecommendation) ? (
                  <div
                    style={{
                      marginTop: 6,
                      padding: "8px 10px",
                      borderRadius: 10,
                      background: "#fff8e1",
                      border: "1px solid #ead28b",
                      color: "#6d4c00",
                      fontSize: 13,
                      fontWeight: 800,
                      lineHeight: 1.6,
                    }}
                  >
                    {getComparisonNotice(areaCountRecommendation)}
                  </div>
                ) : null}
                {areaCountRecommendation.detailLines.map((line) => (
                  <div key={line} style={{ fontSize: 13, color: "#444" }}>
                    {line}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {finalCountMode ? null : areaCountAssistEnabled &&
          parsedAreaCount ===
            null ? null : isAreaCountReady ? null : areaCountAssistEnabled ? (
          isStep1 ? null : (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowJudgeHint(true)}
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "#555",
                    fontSize: 14,
                    fontWeight: 700,
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                    cursor: "pointer",
                    padding: "4px 0",
                    whiteSpace: "nowrap",
                  }}
                >
                  迷ったら…
                </button>
              </div>
              <BasisTimeMiniPanel
                weekdayText={weekdayText}
                timeText={timeText}
              />
              <JudgeOptionButton
                label="多い"
                subLabel="+10%"
                selected={false}
                onClick={() =>
                  canUseManualJudge && handleManualAreaCountEvaluation("many")
                }
              />
              <JudgeOptionButton
                label="やや多い"
                subLabel="+5%"
                selected={false}
                onClick={() =>
                  canUseManualJudge &&
                  handleManualAreaCountEvaluation("slightly_many")
                }
              />
              <JudgeOptionButton
                label="普通"
                subLabel="±0%"
                selected={false}
                buttonRef={normalManualJudgeButtonRef}
                onClick={() =>
                  canUseManualJudge && handleManualAreaCountEvaluation("normal")
                }
              />
              <JudgeOptionButton
                label="やや少ない"
                subLabel="-5%"
                selected={false}
                onClick={() =>
                  canUseManualJudge &&
                  handleManualAreaCountEvaluation("slightly_few")
                }
              />
              <JudgeOptionButton
                label="少ない"
                subLabel="-10%"
                selected={false}
                onClick={() =>
                  canUseManualJudge && handleManualAreaCountEvaluation("few")
                }
              />
            </div>
          )
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <BasisTimeMiniPanel weekdayText={weekdayText} timeText={timeText} />
            <JudgeOptionButton
              label="多い"
              selected={false}
              onClick={() => canUseManualJudge && handleJudge("many")}
            />
            <JudgeOptionButton
              label="どちらでもない"
              selected={false}
              onClick={() => canUseManualJudge && handleJudge("normal")}
            />
            <JudgeOptionButton
              label="少ない"
              subLabel="後回しします"
              selected={false}
              onClick={() => canUseManualJudge && handleJudge("few")}
            />
          </div>
        )}
      </section>

      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <button type="button" onClick={handleSkip} style={subActionButtonStyle}>
          今はスキップ（画面左スワイプ）
        </button>

        <button
          type="button"
          onClick={() => setShowSkipTargetPicker((current) => !current)}
          disabled={!(canChooseSkipTarget && skipTargetOptions.length > 0)}
          style={{
            ...subActionButtonStyle,
            background:
              canChooseSkipTarget && skipTargetOptions.length > 0
                ? "#fff"
                : "#eee",
            color:
              canChooseSkipTarget && skipTargetOptions.length > 0
                ? "#000"
                : "#999",
            cursor:
              canChooseSkipTarget && skipTargetOptions.length > 0
                ? "pointer"
                : "not-allowed",
          }}
        >
          スキップ先を選ぶ
        </button>

        {canChooseSkipTarget &&
        skipTargetOptions.length > 0 &&
        showSkipTargetPicker ? (
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ display: "grid", gap: 12 }}>
              {skipTargetGroups.map((group) => (
                <div key={group.label}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    {group.label}
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {group.options.map((option) => (
                      <button
                        key={option.areaId}
                        type="button"
                        onClick={() => handleChooseSkipTarget(option.areaId)}
                        style={{
                          ...subActionButtonStyle,
                          width: "100%",
                          textAlign: "left",
                        }}
                      >
                        {option.areaName}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={onReturnHome}
          style={{ ...subActionButtonStyle, width: "100%" }}
        >
          トップに戻る
        </button>
      </div>

      {showJudgeHint ? (
        <JudgeHintDialog
          compact
          onClose={() => setShowJudgeHint(false)}
        />
      ) : null}
    </main>
  );
}
