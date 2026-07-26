import type { AreaId, AreaProgress } from "../../domain/types";
import { NORMAL_ROUTE } from "../../domain/area";
import { isAutoSkipNoticePending } from "./autoSkipFlow.ts";

function isNormalFlowWorkArea(progress: AreaProgress | undefined): boolean {
  return progress?.status === "unstarted" || isAutoSkipNoticePending(progress);
}

export function getNormalFlowScreenForArea(
  areaProgressMap: Record<AreaId, AreaProgress>,
  areaId: AreaId,
): "area_judge" | "auto_skip_notice" {
  return isAutoSkipNoticePending(areaProgressMap[areaId])
    ? "auto_skip_notice"
    : "area_judge";
}

export function getFirstNormalFlowAreaId(
  areaProgressMap: Record<AreaId, AreaProgress>,
  normalFlowOrder: readonly AreaId[] = NORMAL_ROUTE,
): AreaId | null {
  return (
    normalFlowOrder.find((areaId) =>
      isNormalFlowWorkArea(areaProgressMap[areaId]),
    ) ?? null
  );
}

export function getNextNormalFlowAreaId(
  areaProgressMap: Record<AreaId, AreaProgress>,
  currentAreaId: AreaId,
  normalFlowOrder: readonly AreaId[] = NORMAL_ROUTE,
): AreaId | null {
  const currentIndex = normalFlowOrder.indexOf(currentAreaId);
  const afterCurrent =
    currentIndex >= 0
      ? normalFlowOrder.slice(currentIndex + 1)
      : normalFlowOrder;

  return (
    afterCurrent.find((areaId) =>
      isNormalFlowWorkArea(areaProgressMap[areaId]),
    ) ?? null
  );
}

export function getNextNormalFlowAreaIdWithWrap(
  areaProgressMap: Record<AreaId, AreaProgress>,
  currentAreaId: AreaId,
  normalFlowOrder: readonly AreaId[] = NORMAL_ROUTE,
): AreaId | null {
  return (
    getNextNormalFlowAreaId(areaProgressMap, currentAreaId, normalFlowOrder) ??
    normalFlowOrder.find((areaId) => isNormalFlowWorkArea(areaProgressMap[areaId])) ??
    null
  );
}

export function hasRemainingNormalFlowArea(
  areaProgressMap: Record<AreaId, AreaProgress>,
  currentAreaId: AreaId,
  normalFlowOrder: readonly AreaId[] = NORMAL_ROUTE,
): boolean {
  return normalFlowOrder.some((areaId) => {
    return (
      areaId !== currentAreaId &&
      isNormalFlowWorkArea(areaProgressMap[areaId])
    );
  });
}
