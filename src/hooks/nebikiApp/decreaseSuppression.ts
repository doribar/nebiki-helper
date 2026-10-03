import {
  buildAreaCountDecisionBasis,
  evaluationText,
  setAreaCountDecreaseAdjustmentSuppressed,
  type AreaCountDecisionBasis,
  type AreaCountRecommendation,
} from "../../domain/areaCountHistory.ts";
import type { NavigationSnapshot } from "../../domain/navigationHistory.ts";
import type { AppState, AreaId, AreaProgress, DiscountTime } from "../../domain/types.ts";

/** Reapply an existing exception to a freshly calculated count, not its raw history. */
export function retainSuppressedDecreaseRecommendation(params: {
  recommendation: AreaCountRecommendation;
  previousBasis: AreaCountDecisionBasis | undefined;
  areaId: AreaId | null;
  discountTime: DiscountTime | undefined;
}): AreaCountRecommendation {
  const recommendation = params.recommendation;
  if (params.previousBasis?.decreaseAdjustment?.suppressed !== true) return recommendation;
  const basis = setAreaCountDecreaseAdjustmentSuppressed({
    ...params,
    basis: buildAreaCountDecisionBasis({
      recommendation,
      evaluationSource: "history",
      finalEvaluation: recommendation.suggestedEvaluation,
      areaRateAdjustment: recommendation.areaRateAdjustment,
    }),
    suppressed: true,
  });
  if (!basis || !basis.finalEvaluation) return recommendation;
  return {
    ...recommendation,
    suggestedEvaluation: basis.finalEvaluation,
    areaRateAdjustment: basis.areaRateAdjustment,
    summaryText: `残数の目安：${evaluationText(basis.finalEvaluation)}（減少率補正は取り消し済み）`,
  };
}

/** Keep the exception/count when returning within this same area's navigation.
 * Update only existing navigation snapshots; no extra persistent state or history clone.
 */
export function retainAreaProgressInNavigationSnapshot(
  snapshot: NavigationSnapshot,
  state: AppState,
  areaId: AreaId,
  progress: AreaProgress,
): NavigationSnapshot {
  const session = state.session;
  const previous = snapshot.state;
  if (!session || previous.currentAreaId !== areaId ||
    (previous.screen !== "area_judge" && previous.screen !== "rate_display") ||
    previous.session?.date !== session.date ||
    previous.session.discountTime !== session.discountTime ||
    previous.session.startedAt !== session.startedAt) return snapshot;
  return {
    ...snapshot,
    state: {
      ...previous,
      areaProgressMap: { ...previous.areaProgressMap, [areaId]: progress },
    },
  };
}
