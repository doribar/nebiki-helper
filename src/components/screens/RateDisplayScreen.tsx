import { useEffect, useState, type CSSProperties } from "react";
import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  SkipTargetOption,
} from "../../domain/types";
import { ScreenHeader } from "../layout/ScreenHeader";
import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { PrimaryButton } from "../layout/PrimaryButton";

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
  showSlightlyManyOption?: boolean;
  finalGuide?: FinalGuideData;
  onNextArea: () => void;
  onSkip: () => void;
  onGoBack: () => void;
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

export function RateDisplayScreen({
  weekdayText,
  timeText,
  areaName,
  basisGuide,
  pendingBanner,
  timeSwitchNotice,
  lateSkipNotice,
  discountTime,
  rateDisplay,
  showSlightlyManyOption,
  finalGuide,
  onNextArea,
  onSkip,
  onGoBack,
  canChooseSkipTarget: _canChooseSkipTarget = false,
  skipTargetOptions = [],
  onChooseSkipTarget,
}: RateDisplayScreenProps) {
  const isFinalTime = discountTime === "20";
  const [showSkipTargetPicker, setShowSkipTargetPicker] = useState(false);

  useEffect(() => {
    setShowSkipTargetPicker(false);
  }, [areaName, skipTargetOptions.length]);

  const manyColor = "#d32f2f";
  const slightlyManyColor = "#ef6c00";
  const fewColor = "#1976d2";
  const normalColor = "#2e7d32";
  const referencePrefix = basisGuide.referenceText.replace("を基準に考えて", "");

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


      {timeSwitchNotice ? (
        <section
          style={{
            border: "1px solid #ead28b",
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
            background: "#fff8e1",
          }}
        >
          <div>{timeSwitchNotice}</div>
        </section>
      ) : null}

      {pendingBanner ? (
        <section
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            まだ値引きをしていないエリアが{pendingBanner.remainingCount}個あります。
          </div>
          <div>
            {pendingBanner.reason === "manual"
              ? "手動でスキップしたエリアから表示しています。"
              : "少ないため後回しにしたエリアを表示しています。"}
          </div>
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
              <span>各商品の量が「</span>
              <span style={{ color: "#d32f2f", fontWeight: 700 }}>多い</span>
              {showSlightlyManyOption ? (
                <>
                  <span>・</span>
                  <span style={{ color: "#ef6c00", fontWeight: 700 }}>やや多い</span>
                </>
              ) : null}
              <span>・</span>
              <span style={{ color: "#2e7d32", fontWeight: 700 }}>どちらでもない</span>
              <span>・</span>
              <span style={{ color: "#1976d2", fontWeight: 700 }}>少ない</span>
              <span>」のどれかを確認し、</span>
              <br />
              <span>完了したら以下の値引率で値引きをしてください。</span>
              {showSlightlyManyOption ? (
                <div style={{ marginTop: 6, fontSize: 13, color: "#666" }}>
                  ※ やや多い は日曜日の15時だけ表示されます
                </div>
              ) : null}
            </div>

            {rateDisplay ? (
              <>
                <RateRow label="多い" line={rateDisplay.many} color={manyColor} />
                {showSlightlyManyOption && rateDisplay.slightlyMany ? (
                  <RateRow
                    label="やや多い"
                    line={rateDisplay.slightlyMany}
                    color={slightlyManyColor}
                  />
                ) : null}
                <RateRow
                  label="どちらでもない"
                  line={rateDisplay.normal}
                  color={normalColor}
                />
                <RateRow label="少ない" line={rateDisplay.few} color={fewColor} />
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
          今はスキップ
        </button>

        <button
          type="button"
          onClick={() => setShowSkipTargetPicker((current) => !current)}
          disabled={skipTargetOptions.length === 0}
          style={{
            ...subActionButtonStyle,
            opacity: skipTargetOptions.length === 0 ? 0.45 : 1,
            cursor: skipTargetOptions.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          スキップ先を選ぶ
        </button>

        {skipTargetOptions.length > 0 && showSkipTargetPicker ? (
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>まだ値引きが終わっていないエリア</div>
            <div style={{ display: "grid", gap: 8 }}>
              {skipTargetOptions.map((option) => (
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
          </section>
        ) : null}
      </div>


      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>注意事項</div>
        <div style={{ lineHeight: 1.8 }}>
          ・2個は多いにしない
          <br />
          ・1個は最終値引以外引かない
          <br />
          ・不人気な商品は表示値引率に10%上乗せする
          <br />
          ・その日の売れ方が順調なときは定番・広告の値引率を10%下げる
        </div>
      </section>

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
    </main>
  );
}
