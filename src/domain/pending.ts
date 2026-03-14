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
}): PendingAreaCandidate | null {
  const deferredSet = new Set(params.deferredAreaIds ?? []);
  const all = Object.values(params.areaProgressMap);

  const manual = all.filter((p) => p.status === "skipped_manual");
  const few = all.filter((p) => p.status === "postponed_few");

  const prioritized = manual.length > 0 ? manual : few;
  if (prioritized.length === 0) return null;

  const filtered = prioritized.filter((p) => !deferredSet.has(p.areaId));
  const targetList = filtered.length > 0 ? filtered : prioritized;

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

export function getPendingReasonText(reason: PendingReason): string {
  switch (reason) {
    case "manual":
      return "手動スキップ";
    case "few":
      return "少ないため後回し";
  }
}