import { getAreaName, getAreaOrder } from "./area.ts";
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
    return (
      getDistance(referenceAreaId, a.areaId) -
      getDistance(referenceAreaId, b.areaId)
    );
  });
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

  const nonDeferred = allPending.filter((p) => !deferredSet.has(p.areaId));
  const targetList = nonDeferred.length > 0 ? nonDeferred : allPending;

  const sorted = sortByDistance(targetList, params.referenceAreaId);
  const picked = sorted[0];

  const reason = toPendingReason(picked);
  if (!reason) return null;

  return {
    areaId: picked.areaId,
    areaName: getAreaName(picked.areaId),
    reason,
  };
}


export function getPendingResumeScreen(progress: AreaProgress): "area_judge" | "rate_display" {
  if (progress.status === "skipped_manual" && progress.areaJudge) {
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
