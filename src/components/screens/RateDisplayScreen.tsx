import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
} from "../../domain/types";
import { ScreenHeader } from "../layout/ScreenHeader";
import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { PrimaryButton } from "../layout/PrimaryButton";

type RateDisplayScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
  basisGuide: {
    reasonText?: string;
    changeText?: string;
    bonusText?: string;
    referenceText: string;
  };
  pendingBanner?: {
    remainingCount: number;
    reason: "manual" | "few";
  } | null;
  timeSwitchNotice?: string | null;
  discountTime: DiscountTime;
  rateDisplay: RateDisplayData | null;
  finalGuide?: FinalGuideData;
  onNextArea: () => void;
  onSkip: () => void;
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
        <div style={{ fontSize: 14, marginTop: 4, color }}>{line.note}</div>
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
  discountTime,
  rateDisplay,
  finalGuide,
  onNextArea,
  onSkip,
}: RateDisplayScreenProps) {
  const isFinalTime = discountTime === "20";

  const manyColor = "#d32f2f";
  const fewColor = "#1976d2";
  const normalColor = "#2e7d32";
const referencePrefix = basisGuide.referenceText.replace("を基準に考えて", "");
  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <ScreenHeader
        weekdayText={weekdayText}
        timeText={timeText}
        areaName={areaName}
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
        reasonText={basisGuide.reasonText}
        changeText={basisGuide.changeText}
        bonusText={basisGuide.bonusText}
      />

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
<span>・</span>
<span style={{ color: "#2e7d32", fontWeight: 700 }}>どちらでもない</span>
<span>・</span>
<span style={{ color: "#1976d2", fontWeight: 700 }}>少ない</span>
<span>」のどれかを確認し、</span>
  <br />
  <span>完了したら以下の値引率で値引きをしてください。</span>
</div>

            {rateDisplay ? (
  <>
    <RateRow label="多い" line={rateDisplay.many} color={manyColor} />
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

  <button
    type="button"
    onClick={onSkip}
    style={{
      width: "100%",
      padding: "14px 16px",
      borderRadius: 12,
      border: "1px solid #ccc",
      background: "#fff",
      fontSize: 15,
      cursor: "pointer",
    }}
  >
    今はスキップ
  </button>
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
    ・必要に応じて定番・広告は値引率を10%下げてもよい
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
  ・商品が大パックと小パックで分かれている場合
  <br />
  <span style={{ color: "#ab47bc", fontWeight: 700 }}>大パックだけ値引</span>
  <br />
  ・商品が期限が近いものと遠いもので分かれている場合
  <br />
  <span style={{ color: "#ab47bc", fontWeight: 700 }}>近いものだけ値引</span>
</div>

<div style={{ marginTop: 14, marginBottom: 8 }}>
  ・分かれていなければ
</div>
<div style={{ lineHeight: 1.8 }}>
  <span style={{ color: "#e65100", fontWeight: 700 }}>
    今日が月火水木なら多い側に寄せる
  </span>
  <br />
  <span style={{ color: "#e65100", fontWeight: 700 }}>
    今日が金土日なら少ない側に寄せる
  </span>
</div>
</section>


    </main>
  );
}