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
  discountTime: DiscountTime;
  rateDisplay: RateDisplayData | null;
  finalGuide?: FinalGuideData;
  previousManyProducts: string[];
  consecutiveManyRate?: number | null;
  onOpenManyInput: () => void;
  onNextArea: () => void;
  onSkip: () => void;
};

function RateRow({
  label,
  line,
  color,
}: {
  label: string;
  line: { main: string; sub?: string };
  color?: string;
}) {
  return (
    <div style={{ marginBottom: 10, color }}>
      <div style={{ fontWeight: 700 }}>
        {label} → {line.main}
      </div>

      {line.sub ? (
        <div style={{ fontSize: 14, marginTop: 4, color }}>{line.sub}</div>
      ) : null}
    </div>
  );
}

export function RateDisplayScreen({
  weekdayText,
  timeText,
  areaName,
  basisGuide,
  discountTime,
  rateDisplay,
  finalGuide,
  previousManyProducts,
  consecutiveManyRate,
  onOpenManyInput,
  onNextArea,
  onSkip,
}: RateDisplayScreenProps) {
  const isFinalTime = discountTime === "20";

  const manyColor = "#d32f2f";
  const fewColor = "#1976d2";
  const normalColor = "#2e7d32";

  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <ScreenHeader
        weekdayText={weekdayText}
        timeText={timeText}
        areaName={areaName}
      />

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
            <div style={{ fontWeight: 800, marginBottom: 14, lineHeight: 1.8 }}>
  {basisGuide.referenceText}
  <br />
  各商品の量が「多い・少ない・どちらでもない」のどれかを確認し、
  <br />
  完了したら以下の値引率で値引きをしてください。
</div>

            {rateDisplay ? (
              <>
                <RateRow
                  label="多い"
                  line={rateDisplay.many}
                  color={manyColor}
                />
                <RateRow
                  label="少ない"
                  line={rateDisplay.few}
                  color={fewColor}
                />
                <RateRow
                  label="どちらでもない"
                  line={rateDisplay.normal}
                  color={normalColor}
                />
              </>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>
              20時は最終値引です。商品数を見て値引してください
            </div>

            <div style={{ marginBottom: 14 }}>
              確認が完了したら以下の値引率で値引きをしてください
            </div>

            {finalGuide ? (
              <>
                <RateRow label="1個" line={finalGuide.count1} />
                <RateRow label="2個" line={finalGuide.count2} />
                <RateRow label="3個以上" line={finalGuide.count3OrMore} />
                <RateRow label="少ない" line={finalGuide.few} color={fewColor} />
              </>
            ) : null}
          </>
        )}
      </section>

      {previousManyProducts.length > 0 && consecutiveManyRate ? (
        <section
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8 }}>
            前回多かった商品が今回も多い場合
          </div>

          <div style={{ lineHeight: 1.8 }}>
            {previousManyProducts.map((name) => (
              <div key={name}>
                ・{name} → {consecutiveManyRate}%
              </div>
            ))}
          </div>
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
        <div style={{ fontWeight: 800, marginBottom: 8 }}>注意事項</div>
        <div style={{ lineHeight: 1.8 }}>
          ・2個は多いにしない
          <br />
          ・1個は最終値引以外引かない
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
          <strong>　大パックだけ値引</strong>
          <br />
          ・商品が期限が近いものと遠いもので分かれている場合
          <br />
          <strong>　近いものだけ値引</strong>
        </div>

        <div style={{ fontWeight: 800, marginTop: 14, marginBottom: 8 }}>
          分かれていなければ
        </div>
        <div style={{ lineHeight: 1.8 }}>
  ・今日が月火水木なら多い方に寄せる
  <br />
  ・今日が金土日なら少ない方に寄せる
</div>
      </section>

      <div style={{ display: "grid", gap: 10 }}>
        {!isFinalTime ? (
          <PrimaryButton onClick={onOpenManyInput}>
            多い商品を入力
          </PrimaryButton>
        ) : null}

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
    </main>
  );
}