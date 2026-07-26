import type { AppState, AreaProgress } from "../../domain/types";

export function isAutoSkipNoticePending(
  progress: AreaProgress | undefined,
): boolean {
  return progress?.status === "auto_skipped_late_time" && !progress.visitedAt;
}

export function acknowledgeAutoSkippedProgress(
  progress: AreaProgress,
  acknowledgedAt: string,
): AreaProgress {
  if (progress.status !== "auto_skipped_late_time") return progress;

  return {
    ...progress,
    visitedAt: progress.visitedAt ?? acknowledgedAt,
    completedAt: progress.completedAt ?? acknowledgedAt,
    measurementStatus: "not_measured",
    missingReason: "early_next_minus5_skipped",
    earlyDiscountResolution: "not_measured",
    skipAcknowledgedAt: acknowledgedAt,
    rateOrigin: "carried_from_early_discount",
  };
}

export function startAutoSkippedCountOnlyProgress(
  progress: AreaProgress,
): AreaProgress {
  if (
    progress.status !== "auto_skipped_late_time" ||
    progress.autoSkipKind !== "early_next_minus5" ||
    progress.visitedAt
  ) {
    return progress;
  }

  return {
    ...progress,
    earlyDiscountResolution: "count_only",
  };
}

export function recordAutoSkippedCountOnlyProgress(
  progress: AreaProgress,
  count: number,
  recordedAt: string,
): AreaProgress {
  if (
    progress.status !== "auto_skipped_late_time" ||
    progress.earlyDiscountResolution !== "count_only"
  ) {
    return progress;
  }

  const roundedCount = Math.max(0, Math.round(count));
  return {
    ...progress,
    areaCount: roundedCount,
    measurementStatus: "measured",
    missingReason: undefined,
    measurementRecordedAt: recordedAt,
    skipAcknowledgedAt: recordedAt,
    visitedAt: progress.visitedAt ?? recordedAt,
    completedAt: progress.completedAt ?? recordedAt,
    rateOrigin: "carried_from_early_discount",
  };
}

export function processEarlyNextMinus5AreaNormally(state: AppState): AppState {
  const currentAreaId = state.currentAreaId;
  if (!currentAreaId || state.screen !== "auto_skip_notice") return state;

  const currentProgress = state.areaProgressMap[currentAreaId];
  if (
    currentProgress?.status !== "auto_skipped_late_time" ||
    currentProgress.autoSkipKind !== "early_next_minus5" ||
    currentProgress.visitedAt
  ) {
    return state;
  }

  return {
    ...state,
    screen: "area_judge",
    areaProgressMap: {
      ...state.areaProgressMap,
      [currentAreaId]: {
        ...currentProgress,
        areaId: currentAreaId,
        status: "unstarted",
        areaJudge: null,
        areaCount: undefined,
        areaCountEvaluation: undefined,
        areaCountEvaluationSource: undefined,
        areaCountDecisionBasis: undefined,
        areaRateAdjustment: undefined,
        visitedAt: undefined,
        completedAt: undefined,
        skipReason: undefined,
        completedRateText: undefined,
        completedManyRateText: undefined,
        completedNormalRateText: undefined,
        previousRateText: undefined,
        previousManyRateText: undefined,
        previousNormalRateText: undefined,
        earlyNextMinus5TargetDiscountTime: undefined,
        rateDecisionSnapshot: undefined,
        rateDecisionSnapshotStatus: undefined,
        measurementStatus: undefined,
        missingReason: undefined,
        earlyDiscountResolution: "process_normally",
        skipAcknowledgedAt: undefined,
        measurementRecordedAt: undefined,
        rateOrigin: "confirmed_now",
      },
    },
    currentFlow: "normal",
    pendingDeferredAreaIds: [],
    timeSwitchNotice: null,
    finalTimeStep: 0,
  };
}
