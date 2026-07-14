import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  SkipTargetOption,
} from "../../domain/types";
import type {
  NoticeItemId,
  TrainingStepConfig,
} from "../../domain/trainingMode";
import { ScreenHeader } from "../layout/ScreenHeader";
import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { PrimaryButton } from "../layout/PrimaryButton";
import { JudgeHintDialog } from "../common/JudgeHintDialog";
import { useSwipeToSkip } from "../../hooks/useSwipeToSkip";
import { getFinalTimeInstructionSteps } from "../../domain/discount";

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
  trainingStepConfig: TrainingStepConfig;
  showDailyNotice?: boolean;
  onConfirmDailyNotice?: () => void;
  finalGuide?: FinalGuideData;
  onNextArea: () => void;
  onSkip: () => void;
  onGoBack: () => void;
  onReturnHome: () => void;
  canChooseSkipTarget?: boolean;
  skipTargetOptions?: SkipTargetOption[];
  onChooseSkipTarget?: (areaId: SkipTargetOption["areaId"]) => void;
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

type ManyThresholdInstruction = {
  thresholdText: string;
  rateText: string;
};

function parseManyThresholdInstruction(
  note: string | undefined,
): ManyThresholdInstruction | null {
  if (!note) return null;

  const line = note
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean);

  if (!line) return null;

  const match = line.match(/^多いのうち(.+?)は\s*(.+)$/);
  if (!match) return null;

  const [, thresholdText, rateText] = match;
  return { thresholdText, rateText };
}

function buildRateInstructionSteps(params: {
  rateDisplay: RateDisplayData | null;
  showManyProductRate: boolean;
  showManyThresholdRule: boolean;
  showFewProductRule: boolean;
  manyColor: string;
  normalColor: string;
}): RateInstructionStep[] {
  const {
    rateDisplay,
    showManyProductRate,
    showManyThresholdRule,
    showFewProductRule,
    manyColor,
    normalColor,
  } = params;
  if (!rateDisplay) return [];

  if (!showManyProductRate) {
    return [
      {
        key: "normal-only",
        title: (
          <>
            このエリアの商品を
            <br />
            {rateDisplay.normal.main}値引きしてください。
          </>
        ),
        rateLine: rateDisplay.normal,
        color: normalColor,
      },
    ];
  }

  const manyThresholdInstruction = showManyThresholdRule
    ? parseManyThresholdInstruction(rateDisplay.many.note)
    : null;

  return [
    {
      key: "many",
      title: (
        <>
          多い商品を{rateDisplay.many.main}値引きしてください。
          {manyThresholdInstruction ? (
            <>
              <br />
              そのうち{manyThresholdInstruction.thresholdText}ある商品は
              {manyThresholdInstruction.rateText}で値引きしてください。
            </>
          ) : null}
        </>
      ),
      rateLine: { main: rateDisplay.many.main },
      color: manyColor,
    },
    {
      key: "normal",
      title: (
        <>
          {showFewProductRule ? "どちらでもない商品" : "多くない商品"}を
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
  showJudgeHintButton,
  onDone,
}: {
  step: RateInstructionStep;
  currentIndex: number;
  totalCount: number;
  showJudgeHintButton: boolean;
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

        {showJudgeHintButton ? (
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
        ) : null}
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
        <JudgeHintDialog onClose={() => setShowJudgeHint(false)} />
      ) : null}
    </>
  );
}

const NOTICE_ITEMS: Record<NoticeItemId, { content: ReactNode }> = {
  oneLeftFew: {
    content: (
      <>
        <strong>残り1個</strong>の商品は<strong>「少ない」にする</strong>
      </>
    ),
  },
  twoLeftNotMany: {
    content: (
      <>
        <strong>残り2個</strong>の商品は<strong>「多い」にしない</strong>
      </>
    ),
  },
  judgeIncludesTrend: {
    content: (
      <>
        <strong>多い・少ないの判断</strong>は、残り数だけでなく
        <strong>商品の減り方</strong>も含める
      </>
    ),
  },
  badAppearancePlus: {
    content: (
      <>
        <strong>見た目が悪い個別商品</strong>は、表示値引率に
        <strong>+10%</strong>
      </>
    ),
  },
  unpopularPlus: {
    content: (
      <>
        <strong>不人気な商品</strong>は、表示値引率に<strong>+10%</strong>
      </>
    ),
  },
  steadyStandardMinus: {
    content: (
      <>
        <strong>定番商品</strong>は、表示値引率から<strong>-10%</strong>
      </>
    ),
  },
  nightSellerMinus: {
    content: (
      <>
        <strong>夜によく売れる商品</strong>は、表示値引率から
        <strong>-10%</strong>
      </>
    ),
  },
  manyTenPlusAfterJudge: {
    content: (
      <>
        <strong>10個以上あるだけで「多い」になるわけではありません。</strong>
        <br />
        曜日・時刻を基準に「多い」と判断してください。
        <br />
        そのうち10個以上ある商品だけさらに<strong>+5%</strong>
      </>
    ),
  },
  advertisementTrendMinus: {
    content: (
      <>
        <strong>広告商品</strong>は、当日の売れ方を見て、
        売れ方が順調なら表示値引率から<strong>-10%</strong>
      </>
    ),
  },
};

export function NoticeItems({ itemIds }: { itemIds: NoticeItemId[] }) {
  return (
    <div style={{ lineHeight: 1.8 }}>
      {itemIds.map((itemId) => (
        <div key={itemId}>・{NOTICE_ITEMS[itemId].content}</div>
      ))}
    </div>
  );
}

function NoticeSection({ itemIds }: { itemIds: NoticeItemId[] }) {
  if (itemIds.length === 0) return null;

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
      <NoticeItems itemIds={itemIds} />
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
  trainingStepConfig,
  showDailyNotice = false,
  onConfirmDailyNotice,
  finalGuide,
  onNextArea,
  onSkip,
  onGoBack,
  onReturnHome,
  canChooseSkipTarget = false,
  skipTargetOptions = [],
  onChooseSkipTarget,
}: RateDisplayScreenProps) {
  const isFinalTime = discountTime === "20";
  const swipeToSkipHandlers = useSwipeToSkip({
    enabled: !showDailyNotice,
    onSwipeLeft: onSkip,
  });
  const [showSkipTargetPicker, setShowSkipTargetPicker] = useState(false);
  const [rateInstructionStepIndex, setRateInstructionStepIndex] = useState(0);
  const manyColor = "#ff0000";
  const normalColor = "#008000";
  const productAmountReferenceText = `${weekdayText}の${timeText}`;
  const showManyProductRate = trainingStepConfig.showManyProductRate;
  const showManyThresholdRule = trainingStepConfig.showManyThresholdRule;
  const showFewProductRule = trainingStepConfig.showFewProductRule;
  const showProductAmountReference =
    trainingStepConfig.showProductAmountReference;
  const showAdvancedReference = trainingStepConfig.showAdvancedReference;
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
    setRateInstructionStepIndex(0);
  }, [
    areaName,
    canChooseSkipTarget,
    discountTime,
    rateDisplaySignature,
    showManyProductRate,
    showManyThresholdRule,
    showFewProductRule,
    showProductAmountReference,
  ]);
  const rateInstructionSteps = buildRateInstructionSteps({
    rateDisplay,
    showManyProductRate,
    showManyThresholdRule,
    showFewProductRule,
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

        <NoticeSection itemIds={trainingStepConfig.noticeItemIds} />

        <PrimaryButton onClick={onConfirmDailyNotice ?? (() => {})}>
          OK
        </PrimaryButton>

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

      {showAdvancedReference && !isFinalTime ? (
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
              {showProductAmountReference ? (
                <>
                  <span style={{ fontWeight: 800 }}>{productAmountReferenceText}</span>
                  <span>を基準に考えて</span>
                  <br />
                </>
              ) : null}
              {!showManyProductRate ? (
                <span>
                  step1では、このエリアの商品は表示値引率で一律に値引きしてください。
                </span>
              ) : showFewProductRule ? (
                <>
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
                </>
              ) : (
                <>
                  <span>多い商品だけ表示値引率より強めます。</span>
                  <br />
                  <span>多くない商品は表示値引率で値引きしてください。</span>
                </>
              )}
            </div>

            {currentRateInstructionStep ? (
              <RateInstructionCard
                step={currentRateInstructionStep}
                currentIndex={rateInstructionStepIndex}
                totalCount={rateInstructionSteps.length}
                showJudgeHintButton={trainingStepConfig.step !== "step1"}
                onDone={handleRateInstructionDone}
              />
            ) : null}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>
              20時30分は最終値引です
            </div>

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
        <NoticeSection itemIds={trainingStepConfig.noticeItemIds} />
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
