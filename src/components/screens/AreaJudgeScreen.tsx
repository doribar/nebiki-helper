import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AreaCountEvaluation, AreaJudge, SkipTargetOption } from "../../domain/types";
import type { AreaCountRecommendation } from "../../domain/areaCountHistory.ts";
import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { ScreenHeader } from "../layout/ScreenHeader";
import { useSwipeToSkip } from "../../hooks/useSwipeToSkip";

type AreaJudgeScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
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
  getAreaCountRecommendation?: (count: number) => AreaCountRecommendation;
  onJudge: (
    judge: Exclude<AreaJudge, null>,
    areaCount?: number | null,
    manualAreaCountEvaluation?: AreaCountEvaluation
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
}: {
  label: string;
  subLabel?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
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
      <div style={{ fontSize: 16, fontWeight: 800, color: getJudgeLabelColor(label) }}>
        {label}
        {subLabel ? (
          <span style={{ fontSize: 13, color: "#555", fontWeight: 600, marginLeft: 6 }}>
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

function getRecommendationColor(recommendation: AreaCountRecommendation | null): string {
  const evaluation = recommendation?.suggestedEvaluation;
  if (evaluation === "many" || evaluation === "slightly_many") return "#b71c1c";
  if (evaluation === "few" || evaluation === "slightly_few") return "#0d47a1";
  return "#1b5e20";
}

export function AreaJudgeScreen({
  weekdayText,
  timeText,
  areaName,
  showJudgeGuide = false,
  basisGuide,
  timeSwitchNotice,
  areaCountAssistEnabled = false,
  areaCountSameItemLimit = null,
  getAreaCountRecommendation,
  onJudge,
  onSkip,
  onGoBack,
  onReturnHome,
  canChooseSkipTarget = false,
  skipTargetOptions = [],
  onChooseSkipTarget,
  onJudgeGuideShown,
}: AreaJudgeScreenProps) {
  const referencePrefix = basisGuide.referenceText.replace("を基準に考えて", "");
  const swipeToSkipHandlers = useSwipeToSkip({ onSwipeLeft: onSkip });
  const [showSkipTargetPicker, setShowSkipTargetPicker] = useState(false);
  const [displayJudgeGuide, setDisplayJudgeGuide] = useState(showJudgeGuide);
  const [areaCountText, setAreaCountText] = useState("");
  const previousAreaNameRef = useRef(areaName);
  const skipTargetGroups = [
    {
      label: "スキップしたエリア",
      options: skipTargetOptions.filter((option) => option.status === "skipped_manual"),
    },
    {
      label: "少ないため後回ししたエリア",
      options: skipTargetOptions.filter((option) => option.status === "postponed_few"),
    },
    {
      label: "未着手のエリア",
      options: skipTargetOptions.filter((option) => option.status === "unstarted"),
    },
  ].filter((group) => group.options.length > 0);

  useEffect(() => {
    if (previousAreaNameRef.current !== areaName) {
      previousAreaNameRef.current = areaName;
      setShowSkipTargetPicker(false);
      setDisplayJudgeGuide(showJudgeGuide);
      setAreaCountText("");
      return;
    }

    if (showJudgeGuide) {
      setDisplayJudgeGuide(true);
    }
  }, [areaName, showJudgeGuide]);

  useEffect(() => {
    if (!displayJudgeGuide) return;
    onJudgeGuideShown?.();
  }, [displayJudgeGuide, onJudgeGuideShown]);

  const parsedAreaCount = parseAreaCount(areaCountText);
  const areaCountRecommendation =
    areaCountAssistEnabled && parsedAreaCount !== null && getAreaCountRecommendation
      ? getAreaCountRecommendation(parsedAreaCount)
      : null;
  const isAreaCountReady = areaCountRecommendation?.status === "ready";
  const canUseManualJudge = !areaCountAssistEnabled || parsedAreaCount !== null;

  const handleJudge = (judge: Exclude<AreaJudge, null>) => {
    onJudge(judge, parsedAreaCount);
  };

  const handleManualAreaCountEvaluation = (evaluation: AreaCountEvaluation) => {
    onJudge("normal", parsedAreaCount, evaluation);
  };

  const handleUseAreaCountRecommendation = () => {
    onJudge("normal", parsedAreaCount);
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

      <WeekdayBasePanel
        noticeText={basisGuide.noticeText}
        weekdaySummaryText={basisGuide.weekdaySummaryText}
        weekdayDetailLines={basisGuide.weekdayDetailLines}
        bonusSummaryText={basisGuide.bonusSummaryText}
        bonusDetailLines={basisGuide.bonusDetailLines}
      />

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
            fontSize: 18,
            marginBottom: 14,
            lineHeight: 1.7,
          }}
        >
          <span style={{ fontWeight: 800 }}>{referencePrefix}</span>
          <span>を基準に考えて</span>
          <br />
          <span>このエリア全体の商品数は？</span>
        </div>

        {displayJudgeGuide ? (
          <div
            style={{
              border: "1px solid #f0d38a",
              borderRadius: 12,
              padding: 12,
              marginBottom: 14,
              background: "#fffaf0",
              fontSize: 14,
              lineHeight: 1.7,
            }}
          >
            まずエリアが多いかどうかを確認し、当てはまれば「多い」を選択してください。
            多くなければ次に少ないかどうかを確認し、当てはまれば「少ない」を選択してください。
            どちらにも当てはまらない場合は「どちらでもない」を選択してください。
          </div>
        ) : null}

        {areaCountAssistEnabled ? (
          <section
            style={{
              border: "1px solid #cfd8dc",
              borderRadius: 12,
              padding: 12,
              marginBottom: 14,
              background: "#f7fbff",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 8 }}>エリア残数判定</div>
            <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 700 }}>
              エリア全体の商品数
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={areaCountText}
                onChange={(event) => setAreaCountText(event.target.value)}
                placeholder="例：23"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #bbb",
                  fontSize: 16,
                }}
              />
            </label>

            {areaCountSameItemLimit !== null ? (
              <div style={{ marginTop: 8, fontSize: 13, color: "#555", lineHeight: 1.7 }}>
                同じ商品が極端に多い場合は、{areaCountSameItemLimit}個までとして数えてください。超えた分は個別に多い商品として判断します。
              </div>
            ) : null}

            {areaCountText.trim() && parsedAreaCount === null ? (
              <div style={{ marginTop: 8, color: "#b71c1c", fontWeight: 700 }}>
                0以上の数字を入力してください。
              </div>
            ) : null}

            {parsedAreaCount !== null && areaCountRecommendation ? (
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
                {areaCountRecommendation.detailLines.map((line) => (
                  <div key={line} style={{ fontSize: 13, color: "#444" }}>
                    {line}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 13, color: "#555", lineHeight: 1.7 }}>
                入力すると、過去の同じエリア・同じ時刻・同じ実際の曜日を優先して比較します。足りない時だけ暫定グループを使います。
              </div>
            )}
          </section>
        ) : null}

        {areaCountAssistEnabled && parsedAreaCount === null ? (
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
              lineHeight: 1.7,
              fontWeight: 700,
            }}
          >
            エリア全体の商品数を入力すると判定に進めます。
          </div>
        ) : isAreaCountReady ? (
          <div style={{ display: "grid", gap: 10 }}>
            <button
              type="button"
              onClick={handleUseAreaCountRecommendation}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 12,
                border: "2px solid #2f5ef5",
                background: "#e8f0ff",
                textAlign: "center",
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 900,
              }}
            >
              この判定で進む
            </button>
          </div>
        ) : areaCountAssistEnabled ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, color: "#555", lineHeight: 1.7 }}>
              過去データが足りない場合は、手動で5段階判定してください。ここでの「少ない」は後回しではなく、表示値引率-10%です。
            </div>
            <JudgeOptionButton label="多い" subLabel="+10%" selected={false} onClick={() => canUseManualJudge && handleManualAreaCountEvaluation("many")} />
            <JudgeOptionButton label="やや多い" subLabel="+5%" selected={false} onClick={() => canUseManualJudge && handleManualAreaCountEvaluation("slightly_many")} />
            <JudgeOptionButton label="普通" subLabel="±0%" selected={false} onClick={() => canUseManualJudge && handleManualAreaCountEvaluation("normal")} />
            <JudgeOptionButton label="やや少ない" subLabel="-5%" selected={false} onClick={() => canUseManualJudge && handleManualAreaCountEvaluation("slightly_few")} />
            <JudgeOptionButton label="少ない" subLabel="-10%" selected={false} onClick={() => canUseManualJudge && handleManualAreaCountEvaluation("few")} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <JudgeOptionButton label="多い" selected={false} onClick={() => canUseManualJudge && handleJudge("many")} />
            <JudgeOptionButton label="どちらでもない" selected={false} onClick={() => canUseManualJudge && handleJudge("normal")} />
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
        <button type="button" onClick={onSkip} style={subActionButtonStyle}>
          今はスキップ（画面左スワイプ）
        </button>

        <button
          type="button"
          onClick={() => setShowSkipTargetPicker((current) => !current)}
          disabled={!(canChooseSkipTarget && skipTargetOptions.length > 0)}
          style={{
            ...subActionButtonStyle,
            background: canChooseSkipTarget && skipTargetOptions.length > 0 ? "#fff" : "#eee",
            color: canChooseSkipTarget && skipTargetOptions.length > 0 ? "#000" : "#999",
            cursor: canChooseSkipTarget && skipTargetOptions.length > 0 ? "pointer" : "not-allowed",
          }}
        >
          スキップ先を選ぶ
        </button>

        {canChooseSkipTarget && skipTargetOptions.length > 0 && showSkipTargetPicker ? (
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
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{group.label}</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {group.options.map((option) => (
                      <button
                        key={option.areaId}
                        type="button"
                        onClick={() => onChooseSkipTarget?.(option.areaId)}
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

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          background: "#fafafa",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>迷ったら…</div>
        <div style={{ lineHeight: 1.8 }}>
          <div>実際の曜日が</div>
          <div>
            月・水・火・木
            <span style={{ color: "#e65100", fontWeight: 700 }}>➡多い側に寄せる</span>
          </div>
          <div>
            金・土・日
            <span style={{ color: "#e65100", fontWeight: 700 }}>➡少ない側に寄せる</span>
          </div>
        </div>
      </section>

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={onReturnHome} style={{ ...subActionButtonStyle, width: "100%" }}>
          トップに戻る
        </button>
      </div>
    </main>
  );
}
