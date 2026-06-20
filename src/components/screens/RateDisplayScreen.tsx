import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  SkipTargetOption,
} from "../../domain/types";
import type { NoticeItemId, TrainingStepConfig } from "../../domain/trainingMode";
import { ScreenHeader } from "../layout/ScreenHeader";
import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { PrimaryButton } from "../layout/PrimaryButton";
import { useSwipeToSkip } from "../../hooks/useSwipeToSkip";

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

function RateRow({
  label,
  line,
  color,
}: {
  label: string;
  line: { main: string; note?: string };
  color?: string;
}) {
  return (
    <div style={{ marginBottom: 10, color }}>
      <div style={{ fontWeight: 700 }}>
        {label} → {line.main}
      </div>
      {line.note ? (
        <div
          style={{
            fontSize: 14,
            marginTop: 4,
            color,
            whiteSpace: "pre-wrap",
          }}
        >
          {line.note}
        </div>
      ) : null}
    </div>
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
        <strong>多い・少ないの判断</strong>は、残り数だけでなく<strong>商品の減り方</strong>も含める
      </>
    ),
  },
  fewNoDiscountExceptFinal: {
    content: (
      <>
        <strong>少ない判定</strong>の商品は、<strong>最終値引以外では引かない</strong>
      </>
    ),
  },
  badAppearancePlus: {
    content: (
      <>
        <strong>見た目が悪い個別商品</strong>は、表示値引率に<strong>+10%</strong>
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
        <strong>売れ方が順調な定番・広告商品</strong>は、表示値引率から<strong>-10%</strong>
      </>
    ),
  },
  nightSellerMinus: {
    content: (
      <>
        <strong>夜によく売れる商品</strong>は、表示値引率から<strong>-10%</strong>
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
    setShowSkipTargetPicker(false);
  }, [areaName, canChooseSkipTarget]);

  const manyColor = "#ff0000";
  const normalColor = "#008000";
  const fewColor = "#0000ff";
  const referencePrefix = basisGuide.referenceText.replace("を基準に考えて", "");
  const showManyProductRate = trainingStepConfig.showManyProductRate;
  const showFewProductRule = trainingStepConfig.showFewProductRule;

  if (showDailyNotice) {
    return (
      <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
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

        <NoticeSection itemIds={trainingStepConfig.noticeItemIds} />

        <PrimaryButton onClick={onConfirmDailyNotice ?? (() => {})}>OK</PrimaryButton>

        <div style={{ marginTop: 16 }}>
          <button type="button" onClick={onReturnHome} style={{ ...subActionButtonStyle, width: "100%" }}>
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

      <WeekdayBasePanel
        noticeText={basisGuide.noticeText}
        weekdaySummaryText={basisGuide.weekdaySummaryText}
        weekdayDetailLines={basisGuide.weekdayDetailLines}
        bonusSummaryText={basisGuide.bonusSummaryText}
        bonusDetailLines={basisGuide.bonusDetailLines}
      />

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
              <span style={{ fontWeight: 800 }}>{referencePrefix}</span>
              <span>を基準に考えて</span>
              <br />
              {!showManyProductRate ? (
                <span>このエリアの商品は、表示値引率で一律に値引きしてください。</span>
              ) : showFewProductRule ? (
                <>
                  <span>各商品の量が「</span>
                  <span style={{ color: "#ff0000", fontWeight: 700 }}>多い</span>
                  <span>・</span>
                  <span style={{ color: "#0000ff", fontWeight: 700 }}>少ない</span>
                  <span>・</span>
                  <span style={{ color: "#008000", fontWeight: 700 }}>どちらでもない</span>
                  <span>」のどれかを確認し、</span>
                  <br />
                  <span>完了したら以下の値引率で値引きをしてください。</span>
                </>
              ) : (
                <>
                  <span>多い商品だけ表示値引率より強めます。</span>
                  <br />
                  <span>多くない商品は表示値引率で値引きしてください。</span>
                </>
              )}
            </div>

            {rateDisplay ? (
              <>
                {!showManyProductRate ? (
                  <RateRow label="表示値引率" line={rateDisplay.normal} color={normalColor} />
                ) : (
                  <>
                    <RateRow label="多い" line={rateDisplay.many} color={manyColor} />
                    <RateRow
                      label={showFewProductRule ? "どちらでもない" : "多くない"}
                      line={rateDisplay.normal}
                      color={normalColor}
                    />
                    {showFewProductRule ? (
                      <RateRow label="少ない" line={rateDisplay.few} color={fewColor} />
                    ) : null}
                  </>
                )}
              </>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>
              20時は最終値引です。商品数を見て値引してください
            </div>

            {finalGuide ? (
              <>
                <RateRow label="1個" line={finalGuide.count1} />
                <RateRow label="2個" line={finalGuide.count2} />
                <RateRow label="3個以上" line={finalGuide.count3OrMore} />
              </>
            ) : null}
          </>
        )}
      </section>

      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <PrimaryButton onClick={onNextArea}>次のエリアへ</PrimaryButton>

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
          <div>
            ・アウトパック
            <span style={{ color: "#00897b", fontWeight: 700 }}>➡多い側に寄せる</span>
          </div>
          ・商品が大パックと小パックで分かれている
          <span style={{ color: "#ab47bc", fontWeight: 700 }}>➡大パックだけ値引</span>
          <br />
          ・期限が近いものと遠いもので分かれている
          <span style={{ color: "#ab47bc", fontWeight: 700 }}>➡近いものだけ値引</span>
        </div>

        <div style={{ marginTop: 14, marginBottom: 8 }}>
          ・分かれていなければ今使っている曜日基準が
        </div>
        <div style={{ lineHeight: 1.8 }}>
          <div>
            月・水または火・木
            <span style={{ color: "#e65100", fontWeight: 700 }}>➡多い側に寄せる</span>
          </div>
          <div>
            金・土または日
            <span style={{ color: "#e65100", fontWeight: 700 }}>➡少ない側に寄せる</span>
          </div>
        </div>
      </section>

      {!isFinalTime ? <NoticeSection itemIds={trainingStepConfig.noticeItemIds} /> : null}

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={onReturnHome} style={{ ...subActionButtonStyle, width: "100%" }}>
          トップに戻る
        </button>
      </div>
    </main>
  );
}
