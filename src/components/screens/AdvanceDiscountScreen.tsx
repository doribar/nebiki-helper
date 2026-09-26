import { PrimaryButton } from "../layout/PrimaryButton.tsx";
import type { ColdDeliGuide } from "../../domain/coldDeliGuide.ts";

type AdvanceDiscountScreenProps = {
  referenceConditionLabel: string;
  ratePercent: number;
  coldDeliGuide?: ColdDeliGuide | null;
  onContinue: () => void;
};

export function AdvanceDiscountScreen({
  referenceConditionLabel,
  ratePercent,
  coldDeliGuide,
  onContinue,
}: AdvanceDiscountScreenProps) {
  const manyColor = "#ff0000";

  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <section
        aria-label="先行値引の案内"
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginTop: 16,
          background: "#fff",
        }}
      >
        <div style={{ display: "grid", gap: 12, fontSize: 18, fontWeight: 700, lineHeight: 1.7 }}>
          <div>{referenceConditionLabel}を基準に考えて</div>
          <div>
            <span style={{ color: manyColor, fontWeight: 700 }}>多い</span>商品のうち10個以上ある商品を
          </div>
          <div>
            <span style={{ color: manyColor, fontWeight: 700 }}>{ratePercent}％</span>で引いてください
          </div>
        </div>

        {coldDeliGuide && (
          <section
            aria-label="冷惣菜"
            style={{ borderTop: "1px solid #ddd", marginTop: 20, paddingTop: 16, lineHeight: 1.6 }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>冷惣菜</h2>
            {coldDeliGuide.discountTime === "15" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{coldDeliGuide.highCount}個以上 → 20%</div>
                  <div style={{ marginLeft: 12, fontSize: 16, color: "#555" }}>少ないエリア → 15%</div>
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{coldDeliGuide.lowCount}個 → 10%</div>
                  <div style={{ marginLeft: 12, fontSize: 16, color: "#555" }}>少ないエリア → 5%</div>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 18, fontWeight: 700 }}>すべて → {coldDeliGuide.ratePercent}%</div>
                <p style={{ margin: "8px 0 0", fontSize: 14, color: "#555" }}>
                  少ないエリア・判断に迷う場合は後回しにしてください。
                </p>
              </>
            )}
          </section>
        )}

        <div style={{ marginTop: 24 }}>
          <PrimaryButton onClick={onContinue}>エリア別値引へ進む</PrimaryButton>
        </div>
      </section>
    </main>
  );
}
