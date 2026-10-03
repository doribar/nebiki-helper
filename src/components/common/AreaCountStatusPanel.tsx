import {
  getDecreaseRateAssessment,
  type AreaCountDecisionBasis,
} from "../../domain/areaCountHistory.ts";

type AreaCountStatusPanelProps = {
  areaCount?: number | null;
  decreaseAdjustment?: AreaCountDecisionBasis["decreaseAdjustment"] | null;
  onToggleDecreaseAdjustmentSuppression?: () => void;
};

export function AreaCountStatusPanel({
  areaCount,
  decreaseAdjustment,
  onToggleDecreaseAdjustmentSuppression,
}: AreaCountStatusPanelProps) {
  if (
    typeof areaCount !== "number" ||
    !Number.isSafeInteger(areaCount) ||
    areaCount < 0
  ) return null;

  const assessment = getDecreaseRateAssessment(decreaseAdjustment);
  const hasAdjustment = decreaseAdjustment?.canUse === true &&
    decreaseAdjustment.direction !== "none";
  const canToggleSuppression = onToggleDecreaseAdjustmentSuppression &&
    decreaseAdjustment?.canUse === true &&
    decreaseAdjustment.direction === "more_many" &&
    decreaseAdjustment.previousDiscountTime === "15";

  return (
    <section
      aria-label="現在のエリア残数と減少率"
      aria-live="polite"
      style={{
        border: "1px solid #cbd5e1",
        borderRadius: 10,
        padding: "9px 11px",
        marginBottom: 12,
        background: "#f8fafc",
        color: "#334155",
        fontSize: 14,
        lineHeight: 1.6,
        overflowWrap: "anywhere",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", fontWeight: 800 }}>
        <div>エリア残数：{areaCount}個</div>
        <div>減少率：{assessment}</div>
      </div>
      {hasAdjustment ? (
        <div style={{ marginTop: 4 }}>
          減少率補正：
          {decreaseAdjustment.suppressed === true
            ? "取り消し済み"
            : decreaseAdjustment.direction === "more_many"
              ? "1段階多い側"
              : "1段階少ない側"}
        </div>
      ) : null}
      {canToggleSuppression ? (
        <button
          type="button"
          onClick={onToggleDecreaseAdjustmentSuppression}
          style={{
            width: "100%",
            minHeight: 44,
            marginTop: 8,
            padding: "8px 10px",
            border: "1px solid #94a3b8",
            borderRadius: 10,
            background: "#fff",
            color: "#334155",
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {decreaseAdjustment.suppressed === true
            ? "補正を戻す"
            : "追加製造あり・補正を取り消す"}
        </button>
      ) : null}
    </section>
  );
}
