import {
  AREA_COUNT_DECISION_RULE_VERSION,
  evaluationText,
  getEvaluationFromCount,
  type AreaCountDecisionBasis,
} from "./areaCountHistory.ts";
import type { AreaCountEvaluation, DiscountTime } from "./types";

export function getAreaCountBoundaryHint({
  discountTime,
  areaCount,
  areaCountDecisionBasis: basis,
  adoptedEvaluation,
}: {
  discountTime: DiscountTime;
  areaCount?: number | null;
  areaCountDecisionBasis?: AreaCountDecisionBasis | null;
  adoptedEvaluation?: AreaCountEvaluation | null;
}): string | null {
  if (
    (discountTime !== "15" && discountTime !== "17") ||
    typeof areaCount !== "number" || !Number.isSafeInteger(areaCount) || areaCount < 0 ||
    !adoptedEvaluation ||
    basis?.ruleVersion !== AREA_COUNT_DECISION_RULE_VERSION ||
    basis.recommendationStatus !== "ready" ||
    !Number.isSafeInteger(basis.sampleSize) || !Number.isSafeInteger(basis.requiredSampleSize) ||
    basis.requiredSampleSize < 1 || basis.sampleSize < basis.requiredSampleSize ||
    typeof basis.medianCount !== "number" || !Number.isFinite(basis.medianCount) || basis.medianCount < 0
  ) return null;

  const referenceCount = basis.medianCount;
  const current = getEvaluationFromCount({ count: areaCount, referenceCount });
  // Use the captured basis only when it agrees with the residual-count rule.
  if (
    basis.baseEvaluation !== current.evaluation ||
    basis.lowerLargeThreshold !== current.lowerLargeThreshold ||
    basis.lowerSmallThreshold !== current.lowerSmallThreshold ||
    basis.upperSmallThreshold !== current.upperSmallThreshold ||
    basis.upperLargeThreshold !== current.upperLargeThreshold
  ) return null;

  const changes: string[] = [];
  for (const count of [areaCount - 1, areaCount + 1]) {
    if (!Number.isSafeInteger(count) || count < 0) continue;
    const { evaluation } = getEvaluationFromCount({ count, referenceCount });
    if (evaluation !== current.evaluation) changes.push(`${count}個なら「${evaluationText(evaluation)}」`);
  }
  if (!changes.length) return null;

  const automatic = current.evaluation === adoptedEvaluation
    ? ""
    : `・自動判定「${evaluationText(current.evaluation)}」`;
  return `残数${areaCount}個${automatic}（${changes.join("、")}）`;
}
