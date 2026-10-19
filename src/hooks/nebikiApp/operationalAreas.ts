import type { AppState, AreaId } from "../../domain/types.ts";
import { getOperationalAreaRoute, isAreaActiveForCurrentWork } from "../../domain/area.ts";
import { getNextPendingCandidate, getPendingResumeScreen } from "../../domain/pending.ts";
import { buildReview19DataQuality } from "../../domain/review19.ts";
import { getFirstNormalFlowAreaId, getNormalFlowScreenForArea } from "./normalFlow.ts";
import { normalizePriorityReturnContext } from "./priorityFlow.ts";

/** Operational boundary only. Observed inactive progress remains original evidence. */
export function retireInactiveAreaWork(state: AppState): AppState {
  const route = state.normalFlowOrder?.length
    ? state.normalFlowOrder.filter(isAreaActiveForCurrentWork)
    : getOperationalAreaRoute(state.session?.date ?? state.sessionDraft.date, Object.keys(state.areaProgressMap));
  const active = (id: AreaId | null) => id !== null && isAreaActiveForCurrentWork(id);
  let next = state;
  const correction = state.areaCountCorrection;
  if (correction && !isAreaActiveForCurrentWork(correction.targetAreaId)) {
    next = {
      ...next,
      screen: correction.returnScreen,
      currentAreaId: correction.returnAreaId,
      lastReferenceAreaId: correction.returnLastReferenceAreaId,
      currentFlow: correction.returnCurrentFlow,
      pendingDeferredAreaIds: correction.returnPendingDeferredAreaIds,
      priorityReturnContext: correction.returnPriorityReturnContext,
      finalTimeStep: correction.returnFinalTimeStep,
      timeSwitchNotice: correction.returnTimeSwitchNotice,
      areaCountCorrection: null,
    };
  }
  const priorityReturnContext = normalizePriorityReturnContext(next.priorityReturnContext, next.session);
  const deferred = next.pendingDeferredAreaIds.filter(isAreaActiveForCurrentWork);
  const excluded = next.review19ExcludedAreaIds.filter(isAreaActiveForCurrentWork);
  const liveReview = next.review19 && !next.review19.recordedAt;
  const reviewExpected = liveReview ? next.review19!.expectedAreaIds?.filter(isAreaActiveForCurrentWork) : undefined;
  const reviewExcluded = liveReview ? next.review19!.excludedAreaIds.filter(isAreaActiveForCurrentWork) : undefined;
  const reviewNeedsRetirement = liveReview && (
    next.review19!.expectedAreaIds?.some((id) => !isAreaActiveForCurrentWork(id)) ||
    reviewExcluded!.length !== next.review19!.excludedAreaIds.length
  );
  const currentInactive = next.currentAreaId !== null && !active(next.currentAreaId);
  const hasInactiveRoute = next.normalFlowOrder?.some((id) => !isAreaActiveForCurrentWork(id));
  if (!currentInactive && !(hasInactiveRoute && next.screen !== "done") &&
    deferred.length === next.pendingDeferredAreaIds.length && excluded.length === next.review19ExcludedAreaIds.length &&
    !reviewNeedsRetirement &&
    JSON.stringify(priorityReturnContext) === JSON.stringify(next.priorityReturnContext)) return next;
  next = {
    ...next,
    // Completed source retains its saved route for historical snapshot capture.
    normalFlowOrder: next.screen === "done" ? next.normalFlowOrder : route,
    pendingDeferredAreaIds: deferred,
    priorityReturnContext,
    review19ExcludedAreaIds: excluded,
    ...(reviewNeedsRetirement ? { review19: {
      ...next.review19!,
      expectedAreaIds: reviewExpected,
      excludedAreaIds: reviewExcluded!,
      dataQuality: buildReview19DataQuality({
        date: next.review19!.date,
        expectedAreaIds: reviewExpected,
        areaCounts: next.review19!.areaCounts,
        areaEvaluations: next.review19!.areaEvaluations ?? {},
        excludedAreaIds: reviewExcluded!,
        review19Status: next.review19!.review19Status,
      }),
    } } : {}),
  };
  if (!currentInactive) return next;
  const first = getFirstNormalFlowAreaId(next.areaProgressMap, route);
  const pending = !first ? getNextPendingCandidate({
    areaProgressMap: next.areaProgressMap, referenceAreaId: state.currentAreaId!, normalFlowOrder: route,
  }) : null;
  const target = first ?? pending?.areaId ?? null;
  return {
    ...next,
    currentAreaId: target,
    lastReferenceAreaId: target,
    currentFlow: pending ? "pending" : "normal",
    ...(next.screen === "start" || next.screen.startsWith("review19") ? {} : {
      screen: target ? pending ? getPendingResumeScreen(next.areaProgressMap[target])
        : getNormalFlowScreenForArea(next.areaProgressMap, target) : "done",
    }),
  };
}
