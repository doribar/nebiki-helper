import { PrimaryButton } from "../layout/PrimaryButton.tsx";

type AdvanceDiscountScreenProps = {
  referenceConditionLabel: string;
  ratePercent: number;
  onContinue: () => void;
};

export function AdvanceDiscountScreen({
  referenceConditionLabel,
  ratePercent,
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

        <div style={{ marginTop: 24 }}>
          <PrimaryButton onClick={onContinue}>エリア別値引へ進む</PrimaryButton>
        </div>
      </section>
    </main>
  );
}
