import type { AreaCountDecisionBasis } from "../../domain/areaCountHistory.ts";
import { getAreaDecreaseDisplay, type AreaDecreaseDisplayContext } from "../../domain/areaDecreaseDisplay.ts";

type AreaCountStatusPanelProps = {
  areaCount?: number | null;
  decreaseAdjustment?: AreaCountDecisionBasis["decreaseAdjustment"] | null;
  decreaseDisplayContext?: AreaDecreaseDisplayContext | null;
};

export function AreaCountStatusPanel({
  areaCount,
  decreaseAdjustment,
  decreaseDisplayContext,
}: AreaCountStatusPanelProps) {
  if (
    typeof areaCount !== "number" ||
    !Number.isSafeInteger(areaCount) ||
    areaCount < 0
  ) return null;

  const decreaseDisplay = decreaseDisplayContext
    ? getAreaDecreaseDisplay({ ...decreaseDisplayContext, areaCount, decreaseAdjustment })
    : null;
  const assessment = decreaseDisplay?.assessmentText ?? "判定なし";
  const highlight = assessment === "良い" ? "good" : assessment === "悪い" ? "bad" : undefined;
  const highlightColor = highlight === "good" ? "#1b5e20" : "#991b1b";
  const hasHistoricalAdjustment = decreaseAdjustment?.mode === undefined &&
    decreaseAdjustment?.canUse === true &&
    decreaseAdjustment.direction !== "none";

  return (
    <section
      aria-label="現在のエリア残数と減少率"
      aria-live="polite"
      data-decrease-assessment={assessment}
      data-decrease-highlight={highlight}
      style={{
        border: highlight ? `2px solid ${highlightColor}` : "1px solid #cbd5e1",
        borderRadius: 10,
        padding: "9px 11px",
        marginBottom: 12,
        background: highlight === "good" ? "#edf7ee" : highlight === "bad" ? "#fff1f2" : "#f8fafc",
        color: "#334155",
        fontSize: 14,
        lineHeight: 1.6,
        overflowWrap: "anywhere",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", fontWeight: 800 }}>
        <div>エリア残数：{areaCount}個</div>
      </div>
      {decreaseDisplay ? (
        <div style={{ fontWeight: 800 }}>
          <div>{decreaseDisplay.transitionText}</div>
          <div>減少率：{decreaseDisplay.rateText}{decreaseDisplay.isIncrease ? "（増加）" : ""}</div>
          {decreaseDisplay.medianText ? <div>{decreaseDisplay.medianText}</div> : null}
          {decreaseDisplay.statusText ? <div>{decreaseDisplay.statusText}</div> : null}
        </div>
      ) : null}
      <div style={{ marginTop: 2, fontWeight: 800 }}>
        減少率判定：
        <span
          data-decrease-badge={highlight}
          style={highlight ? {
            display: "inline-block",
            padding: "0 8px",
            borderRadius: 999,
            border: `1px solid ${highlightColor}`,
            background: highlight === "good" ? "#dcfce7" : "#fee2e2",
            color: highlightColor,
            fontWeight: 900,
          } : undefined}
        >
          {assessment}
        </span>
      </div>
      {hasHistoricalAdjustment ? (
        <div style={{ marginTop: 4 }}>
          過去の保存時の減少率補正：
          {decreaseAdjustment.suppressed === true
            ? "取り消し済み"
            : decreaseAdjustment.direction === "more_many"
              ? "1段階多い側"
              : "1段階少ない側"}
        </div>
      ) : null}
    </section>
  );
}
