import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type {
  AreaId,
  DiscountTime,
  EditableAreaCountItem,
  FinalGuideData,
  HumanEvaluationDetails,
  HumanEvaluationSelection,
  RateDisplayData,
  SkipTargetOption,
} from "../../domain/types";
import { FULL_MODE_NOTICE_ITEMS } from "../../domain/fullMode";
import { ScreenHeader } from "../layout/ScreenHeader";
import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { PrimaryButton } from "../layout/PrimaryButton";
import { JudgeHintDialog } from "../common/JudgeHintDialog";
import {
  DayBeforeHolidayNotice,
  HolidayBeforeNormalWeekdayNotice,
  ThreeDayHolidayMiddleNotice,
} from "../common/DayBeforeHolidayNotice";
import { useSwipeToSkip } from "../../hooks/useSwipeToSkip";
import { getFinalTimeInstructionSteps } from "../../domain/discount";
import { AreaCountCorrectionPanel } from "../common/AreaCountCorrectionPanel.tsx";
import { evaluationText } from "../../domain/areaCountHistory.ts";
import { getHumanEvaluationRangeLabel } from "../../domain/humanEvaluation.ts";
import { HumanEvaluationSelector } from "../common/HumanEvaluationSelector.tsx";

type RateDisplayScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
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
  lateSkipNotice?: string | null;
  discountTime: DiscountTime;
  rateDisplay: RateDisplayData | null;
  humanEvaluationDetails?: HumanEvaluationDetails;
  canOverrideAreaCountEvaluation?: boolean;
  onOverrideAreaCountEvaluation?: (selection: HumanEvaluationSelection) => void;
  showSummerModeJudgeHint?: boolean;
  showDailyNotice?: boolean;
  showDayBeforeHolidayNotice?: boolean;
  showThreeDayHolidayMiddleNotice?: boolean;
  showHolidayBeforeNormalWeekdayNotice?: boolean;
  onConfirmDailyNotice?: () => void;
  finalGuide?: FinalGuideData;
  onNextArea: () => void;
  onSkip: () => void;
  onGoBack: () => void;
  onReturnHome: () => void;
  canChooseSkipTarget?: boolean;
  skipTargetOptions?: SkipTargetOption[];
  onChooseSkipTarget?: (areaId: SkipTargetOption["areaId"]) => void;
  editableAreaCounts?: EditableAreaCountItem[];
  onStartAreaCountCorrection?: (areaId: AreaId) => void;
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

type RateInstructionStep = {
  key: string;
  title: ReactNode;
  rateLine: { main: string; note?: string };
  color?: string;
};

function buildRateInstructionSteps(params: {
  rateDisplay: RateDisplayData | null;
  manyColor: string;
  normalColor: string;
}): RateInstructionStep[] {
  const {
    rateDisplay,
    manyColor,
    normalColor,
  } = params;
  if (!rateDisplay) return [];

  return [
    {
      key: "many",
      title: (
        <>
          多い商品を{rateDisplay.many.main}値引きしてください。
        </>
      ),
      rateLine: { main: rateDisplay.many.main },
      color: manyColor,
    },
    {
      key: "normal",
      title: (
        <>
          どちらでもない商品を
          <br />
          {rateDisplay.normal.main}値引きしてください。
        </>
      ),
      rateLine: rateDisplay.normal,
      color: normalColor,
    },
  ];
}

function RateInstructionCard({
  step,
  currentIndex,
  totalCount,
  showSummerModeJudgeHint,
  onDone,
}: {
  step: RateInstructionStep;
  currentIndex: number;
  totalCount: number;
  showSummerModeJudgeHint: boolean;
  onDone: () => void;
}) {
  const [showJudgeHint, setShowJudgeHint] = useState(false);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: totalCount > 1 ? "space-between" : "flex-end",
          gap: 12,
          marginBottom: 10,
        }}
      >
        {totalCount > 1 ? (
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#666",
            }}
          >
            {currentIndex + 1} / {totalCount}
          </div>
        ) : null}

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

      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.7,
          color: step.color,
        }}
      >
        {step.title}
      </div>

      {step.rateLine.note ? (
        <div
          style={{
            marginTop: 12,
            fontSize: 14,
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
            color: step.color,
          }}
        >
          {step.rateLine.note}
        </div>
      ) : null}

      <div style={{ marginTop: 24 }}>
        <PrimaryButton onClick={onDone}>終わった</PrimaryButton>
      </div>

      {showJudgeHint ? (
        <JudgeHintDialog
          showSummerModeJudgeHint={showSummerModeJudgeHint}
          onClose={() => setShowJudgeHint(false)}
        />
      ) : null}
    </>
  );
}

export function NoticeItems() {
  return (
    <div style={{ lineHeight: 1.8 }}>
      {FULL_MODE_NOTICE_ITEMS.map((segments, itemIndex) => (
        <div key={itemIndex}>
          ・
          {segments.map((segment, segmentIndex) =>
            segment.emphasis ? (
              <strong key={segmentIndex}>{segment.text}</strong>
            ) : (
              <span key={segmentIndex}>{segment.text}</span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function NoticeSection() {
  return (
    <section
      style={{
        border: "1px solid #ddd",
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        background: "#fff",
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 8 }}>注意事項</div>
      <NoticeItems />
    </section>
  );
}

export function RateDisplayScreen({
  weekdayText,
  timeText,
  areaName,
  basisGuide,
  timeSwitchNotice,
  lateSkipNotice,
  discountTime,
  rateDisplay,
  humanEvaluationDetails,
  canOverrideAreaCountEvaluation = false,
  onOverrideAreaCountEvaluation,
  showSummerModeJudgeHint = false,
  showDailyNotice = false,
  showDayBeforeHolidayNotice = false,
  showThreeDayHolidayMiddleNotice = false,
  showHolidayBeforeNormalWeekdayNotice = false,
  onConfirmDailyNotice,
  finalGuide,
  onNextArea,
  onSkip,
  onGoBack,
  onReturnHome,
  canChooseSkipTarget = false,
  skipTargetOptions = [],
  onChooseSkipTarget,
  editableAreaCounts = [],
  onStartAreaCountCorrection,
}: RateDisplayScreenProps) {
  const isFinalTime = discountTime === "20";
  const { cancelSwipeGesture, ...swipeToSkipHandlers } = useSwipeToSkip({
    enabled: !showDailyNotice,
    onSwipeLeft: onSkip,
  });
  const [showSkipTargetPicker, setShowSkipTargetPicker] = useState(false);
  const [showManualEvaluationOverride, setShowManualEvaluationOverride] = useState(false);
  const [rateInstructionStepIndex, setRateInstructionStepIndex] = useState(0);
  const manyColor = "#ff0000";
  const normalColor = "#008000";
  const productAmountReferenceText = basisGuide.referenceText.replace(
    /を基準に考えて$/,
    "",
  );
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

  const rateDisplaySignature = [
    rateDisplay?.many.main ?? "",
    rateDisplay?.many.note ?? "",
    rateDisplay?.normal.main ?? "",
    rateDisplay?.normal.note ?? "",
    rateDisplay?.few.main ?? "",
    rateDisplay?.few.note ?? "",
  ].join("|");

  useEffect(() => {
    setShowSkipTargetPicker(false);
    setShowManualEvaluationOverride(false);
    setRateInstructionStepIndex(0);
  }, [
    areaName,
    canChooseSkipTarget,
    discountTime,
    rateDisplaySignature,
  ]);
  const rateInstructionSteps = buildRateInstructionSteps({
    rateDisplay,
    manyColor,
    normalColor,
  });
  const currentRateInstructionStep =
    rateInstructionSteps[
      Math.min(
        rateInstructionStepIndex,
        Math.max(rateInstructionSteps.length - 1, 0),
      )
    ];
  const finalInstructionSteps = finalGuide
    ? getFinalTimeInstructionSteps(finalGuide)
    : [];

  function handleRateInstructionDone() {
    if (rateInstructionStepIndex < rateInstructionSteps.length - 1) {
      setRateInstructionStepIndex((current) => current + 1);
      return;
    }

    onNextArea();
  }

  if (showDailyNotice) {
    return (
      <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
        <ScreenHeader
          weekdayText={weekdayText}
          timeText={timeText}
          areaName={areaName}
          rightAction={
            <button
              type="button"
              onClick={onGoBack}
              style={subActionButtonStyle}
            >
              戻る
            </button>
          }
        />

        <NoticeSection />

        <PrimaryButton onClick={onConfirmDailyNotice ?? (() => {})}>
          OK
        </PrimaryButton>

        {onStartAreaCountCorrection ? (
          <AreaCountCorrectionPanel
            items={editableAreaCounts}
            onSelect={onStartAreaCountCorrection}
          />
        ) : null}

        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={onReturnHome}
            style={{ ...subActionButtonStyle, width: "100%" }}
          >
            トップに戻る
          </button>
        </div>
      </main>
    );
  }

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

      {humanEvaluationDetails &&
      humanEvaluationDetails.humanEvaluationScore9 % 2 === 0 &&
      humanEvaluationDetails.resolvedEvaluation ? (
        <section
          style={{
            border: "1px solid #c4b5fd",
            borderRadius: 10,
            padding: "9px 11px",
            marginBottom: 12,
            background: "#f5f3ff",
            color: "#4c1d95",
            fontSize: 13,
            fontWeight: 800,
            lineHeight: 1.6,
          }}
        >
          {getHumanEvaluationRangeLabel(humanEvaluationDetails, evaluationText)}
          <br />→ この時間帯は「
          {evaluationText(humanEvaluationDetails.resolvedEvaluation)}」として計算
        </section>
      ) : null}

      {!isFinalTime &&
      canOverrideAreaCountEvaluation &&
      onOverrideAreaCountEvaluation ? (
        <section
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 10,
            marginBottom: 12,
            background: "#fafafa",
          }}
        >
          <button
            type="button"
            onClick={() =>
              setShowManualEvaluationOverride((current) => !current)
            }
            aria-expanded={showManualEvaluationOverride}
            style={{
              width: "100%",
              minHeight: 44,
              border: "1px solid #aaa",
              borderRadius: 10,
              background: "#fff",
              fontSize: 14,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            自動判定を手動で変更
          </button>
          {showManualEvaluationOverride ? (
            <div style={{ marginTop: 10 }}>
              <HumanEvaluationSelector
                ariaLabel={`自動判定の手動変更-${areaName}`}
                layout="stacked"
                showRateAdjustments
                onLongPressActivated={cancelSwipeGesture}
                onCommit={(selection) => {
                  setShowManualEvaluationOverride(false);
                  onOverrideAreaCountEvaluation(selection);
                }}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {!isFinalTime ? (
        <WeekdayBasePanel
          noticeText={basisGuide.noticeText}
          weekdaySummaryText={basisGuide.weekdaySummaryText}
          weekdayDetailLines={basisGuide.weekdayDetailLines}
          bonusSummaryText={basisGuide.bonusSummaryText}
          bonusDetailLines={basisGuide.bonusDetailLines}
        />
      ) : null}

      {lateSkipNotice ? (
        <section
          style={{
            border: "1px solid #ead28b",
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
            background: "#fff8e1",
            whiteSpace: "pre-wrap",
            lineHeight: 1.7,
            fontWeight: 700,
          }}
        >
          {lateSkipNotice}
        </section>
      ) : null}

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        {!isFinalTime ? (
          <>
            <div style={{ marginBottom: 14, lineHeight: 1.8 }}>
              <span style={{ fontWeight: 800 }}>{productAmountReferenceText}</span>
              <span>を基準に考えて</span>
              <br />
              <span>各商品の量が「</span>
              <span style={{ color: "#ff0000", fontWeight: 700 }}>
                多い
              </span>
              <span>・</span>
              <span style={{ color: "#0000ff", fontWeight: 700 }}>
                少ない
              </span>
              <span>・</span>
              <span style={{ color: "#008000", fontWeight: 700 }}>
                どちらでもない
              </span>
              <span>」のどれかを確認してください。</span>
            </div>

            <DayBeforeHolidayNotice visible={showDayBeforeHolidayNotice} />
            <ThreeDayHolidayMiddleNotice
              visible={showThreeDayHolidayMiddleNotice}
            />
            <HolidayBeforeNormalWeekdayNotice
              visible={showHolidayBeforeNormalWeekdayNotice}
            />

            {currentRateInstructionStep ? (
              <RateInstructionCard
                step={currentRateInstructionStep}
                currentIndex={rateInstructionStepIndex}
                totalCount={rateInstructionSteps.length}
                showSummerModeJudgeHint={showSummerModeJudgeHint}
                onDone={handleRateInstructionDone}
              />
            ) : null}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>
              20時30分は最終値引です
            </div>

            <DayBeforeHolidayNotice visible={showDayBeforeHolidayNotice} />
            <ThreeDayHolidayMiddleNotice
              visible={showThreeDayHolidayMiddleNotice}
            />
            <HolidayBeforeNormalWeekdayNotice
              visible={showHolidayBeforeNormalWeekdayNotice}
            />

            <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
              {finalInstructionSteps.map((step) => (
                <div
                  key={`${step.subject}-${step.rate}`}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    background: "#fafafa",
                    fontSize: 20,
                    fontWeight: 900,
                    lineHeight: 1.7,
                  }}
                >
                  {step.subject}
                  <br />
                  {step.rate}値引きしてください。
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        {isFinalTime ? (
          <PrimaryButton onClick={onNextArea}>次のエリアへ</PrimaryButton>
        ) : null}

        <button type="button" onClick={onSkip} style={subActionButtonStyle}>
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

      {!isFinalTime ? (
        <NoticeSection />
      ) : null}

      {onStartAreaCountCorrection ? (
        <AreaCountCorrectionPanel
          items={editableAreaCounts}
          onSelect={onStartAreaCountCorrection}
        />
      ) : null}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={onReturnHome}
          style={{ ...subActionButtonStyle, width: "100%" }}
        >
          トップに戻る
        </button>
      </div>
    </main>
  );
}
