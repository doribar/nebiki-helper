import { getAreaName, getAreaOrder } from "./area";
import type {
  AreaId,
  AreaProgress,
  PendingAreaCandidate,
  PendingReason,
} from "./types";

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
  const all = Object.values(params.areaProgressMap);

  const manual = all.filter((p) => p.status === "skipped_manual");
  const few = all.filter((p) => p.status === "postponed_few");

  const manualFiltered = manual.filter((p) => !deferredSet.has(p.areaId));
  const fewFiltered = few.filter((p) => !deferredSet.has(p.areaId));

  let targetList: AreaProgress[] = [];

  // 1回だけ優先したい理由がある場合
  if (params.preferredReason === "few" && fewFiltered.length > 0) {
    targetList = fewFiltered;
  } else if (params.preferredReason === "manual" && manualFiltered.length > 0) {
    targetList = manualFiltered;
  } else if (manual.length > 0) {
    if (manualFiltered.length > 0) {
      targetList = manualFiltered;
    } else if (fewFiltered.length > 0) {
      targetList = fewFiltered;
    } else if (few.length > 0) {
      targetList = few;
    } else {
      targetList = manual;
    }
  } else if (few.length > 0) {
    if (fewFiltered.length > 0) {
      targetList = fewFiltered;
    } else {
      targetList = few;
    }
  } else {
    return null;
  }

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

export function getPendingRemainingCount(
  areaProgressMap: Record<AreaId, AreaProgress>
): number {
  return Object.values(areaProgressMap).filter(
    (p) => p.status === "skipped_manual" || p.status === "postponed_few"
  ).length;
}