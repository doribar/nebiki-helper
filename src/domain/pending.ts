import { NORMAL_ROUTE, getAreaName, getAreaOrder } from "./area.ts";
import type {
  AreaId,
  AreaProgress,
  PendingAreaCandidate,
  PendingReason,
  SkipTargetOption,
} from "./types.ts";

function toPendingReason(progress: AreaProgress): PendingReason | null {
  if (progress.status === "skipped_manual") return "manual";
  if (progress.status === "postponed_few") return "few";
  return null;
}

function getDistance(fromAreaId: AreaId, toAreaId: AreaId): number {
  return Math.abs(getAreaOrder(fromAreaId) - getAreaOrder(toAreaId));
}

function sortByDistance(
  items: AreaProgress[],
  referenceAreaId: AreaId
): AreaProgress[] {
  return [...items].sort((a, b) => {
    const distanceDiff =
      getDistance(referenceAreaId, a.areaId) -
      getDistance(referenceAreaId, b.areaId);

    if (distanceDiff !== 0) return distanceDiff;

    return getAreaOrder(a.areaId) - getAreaOrder(b.areaId);
  });
}

function getLastDistinctDeferredBeforeCurrent(
  deferredAreaIds: AreaId[],
  referenceAreaId: AreaId
): AreaId | null {
  for (let i = deferredAreaIds.length - 1; i >= 0; i -= 1) {
    const areaId = deferredAreaIds[i];
    if (areaId !== referenceAreaId) return areaId;
  }

  return null;
}

function pickNextPendingByRouteDirection(params: {
  items: AreaProgress[];
  referenceAreaId: AreaId;
  deferredAreaIds: AreaId[];
}): AreaProgress | null {
  const itemMap = new Map(params.items.map((item) => [item.areaId, item]));
  const referenceIndex = NORMAL_ROUTE.indexOf(params.referenceAreaId);
  if (referenceIndex === -1) return null;

  const previousAreaId = getLastDistinctDeferredBeforeCurrent(
    params.deferredAreaIds,
    params.referenceAreaId
  );
  const previousIndex = previousAreaId ? NORMAL_ROUTE.indexOf(previousAreaId) : -1;
  const direction = previousIndex === -1 || previousIndex === referenceIndex
    ? 1
    : referenceIndex > previousIndex
      ? 1
      : -1;

  const scan = (step: 1 | -1): AreaProgress | null => {
    for (
      let index = referenceIndex + step;
      index >= 0 && index < NORMAL_ROUTE.length;
      index += step
    ) {
      const areaId = NORMAL_ROUTE[index];
      const progress = itemMap.get(areaId);
      if (progress) return progress;
    }

    return null;
  };

  return scan(direction) ?? scan(direction === 1 ? -1 : 1);
}

function hasRouteDirectionHistory(
  deferredAreaIds: AreaId[],
  referenceAreaId: AreaId
): boolean {
  return getLastDistinctDeferredBeforeCurrent(deferredAreaIds, referenceAreaId) !== null;
}

function pickNextPending(params: {
  items: AreaProgress[];
  referenceAreaId: AreaId;
  deferredAreaIds: AreaId[];
  allCandidatesAreDeferred: boolean;
  allRouteAreasArePending: boolean;
}): AreaProgress | null {
  const withoutCurrent =
    params.items.length > 1
      ? params.items.filter((progress) => progress.areaId !== params.referenceAreaId)
      : params.items;

  const candidates = withoutCurrent.length > 0 ? withoutCurrent : params.items;

  if (candidates.length > 1 && hasRouteDirectionHistory(params.deferredAreaIds, params.referenceAreaId)) {
    return pickNextPendingByRouteDirection({
      items: candidates,
      referenceAreaId: params.referenceAreaId,
      deferredAreaIds: params.deferredAreaIds,
    }) ?? sortByDistance(candidates, params.referenceAreaId)[0] ?? null;
  }

  if ((params.allCandidatesAreDeferred || params.allRouteAreasArePending) && candidates.length > 1) {
    return pickNextPendingByRouteDirection({
      items: candidates,
      referenceAreaId: params.referenceAreaId,
      deferredAreaIds: params.deferredAreaIds,
    }) ?? sortByDistance(candidates, params.referenceAreaId)[0] ?? null;
  }

  return sortByDistance(candidates, params.referenceAreaId)[0] ?? null;
}

export function getNextPendingCandidate(params: {
  areaProgressMap: Record<AreaId, AreaProgress>;
  referenceAreaId: AreaId;
  deferredAreaIds?: AreaId[];
  preferredReason?: PendingReason | null;
}): PendingAreaCandidate | null {
  const deferredSet = new Set(params.deferredAreaIds ?? []);
  const allPending = Object.values(params.areaProgressMap).filter((p) => {
    return p.status === "skipped_manual" || p.status === "postponed_few";
  });

  if (allPending.length === 0) return null;

  const manualAll = allPending.filter((p) => p.status === "skipped_manual");
  const fewAll = allPending.filter((p) => p.status === "postponed_few");
  const manualNonDeferred = manualAll.filter((p) => !deferredSet.has(p.areaId));
  const fewNonDeferred = fewAll.filter((p) => !deferredSet.has(p.areaId));

  const allCandidatesAreDeferred = manualAll.length > 0
    ? manualNonDeferred.length === 0
    : fewNonDeferred.length === 0;
  const prioritized =
    manualAll.length > 0
      ? manualNonDeferred.length > 0
        ? manualNonDeferred
        : manualAll
      : fewNonDeferred.length > 0
        ? fewNonDeferred
        : fewAll;

  const picked = pickNextPending({
    items: prioritized,
    referenceAreaId: params.referenceAreaId,
    deferredAreaIds: params.deferredAreaIds ?? [],
    allCandidatesAreDeferred,
    allRouteAreasArePending: manualAll.length === NORMAL_ROUTE.length,
  });
  if (!picked) return null;

  const reason = toPendingReason(picked);
  if (!reason) return null;

  return {
    areaId: picked.areaId,
    areaName: getAreaName(picked.areaId),
    reason,
  };
}


export function getPendingResumeScreen(progress: AreaProgress): "area_judge" | "rate_display" {
  if (progress.areaJudge) {
    return "rate_display";
  }

  return "area_judge";
}

export function getPendingRemainingCount(
  areaProgressMap: Record<AreaId, AreaProgress>
): number {
  return Object.values(areaProgressMap).filter(
    (p) => p.status === "skipped_manual" || p.status === "postponed_few"
  ).length;
}

export function getSkipTargetOptions(params: {
  areaProgressMap: Record<AreaId, AreaProgress>;
  currentAreaId: AreaId;
}): SkipTargetOption[] {
  return Object.values(params.areaProgressMap)
    .filter((progress) => progress.areaId !== params.currentAreaId && progress.status !== "completed")
    .sort((a, b) => {
      return getDistance(params.currentAreaId, a.areaId) - getDistance(params.currentAreaId, b.areaId);
    })
    .map((progress) => ({
      areaId: progress.areaId,
      areaName: getAreaName(progress.areaId),
      resumeScreen: getPendingResumeScreen(progress),
      status: progress.status,
    }));
}
