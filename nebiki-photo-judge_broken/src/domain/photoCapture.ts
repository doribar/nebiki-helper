import type { AreaId } from "./types";
import { DONE_SUMMARY_ROUTE, NORMAL_ROUTE, getAreaName } from "./area";

export type PhotoCaptureSlotDefinition = {
  areaId: AreaId;
  areaName: string;
  slotId: string;
  slotLabel: string;
};

const SLOT_LABELS: Partial<Record<AreaId, string[]>> = {
  bento_men: ["正面", "バラ側", "寿司側", "麺類"],
  fry_chicken: ["フライ側", "鶏惣菜側"],
};

export const PHOTO_CAPTURE_ROUTE: AreaId[] = DONE_SUMMARY_ROUTE;
export const PHOTO_JUDGE_UPLOAD_ROUTE: AreaId[] = NORMAL_ROUTE;

export function getPhotoCaptureSlotLabels(areaId: AreaId): string[] {
  return SLOT_LABELS[areaId] ?? ["全体"];
}

export function getPhotoCaptureSlotsForArea(areaId: AreaId): PhotoCaptureSlotDefinition[] {
  const areaName = getAreaName(areaId);
  return getPhotoCaptureSlotLabels(areaId).map((slotLabel, index) => ({
    areaId,
    areaName,
    slotId: `slot_${index + 1}`,
    slotLabel,
  }));
}

export function getAllPhotoCaptureSlots(): PhotoCaptureSlotDefinition[] {
  return PHOTO_CAPTURE_ROUTE.flatMap((areaId) => getPhotoCaptureSlotsForArea(areaId));
}

export function getPhotoCaptureKey(areaId: AreaId, slotId: string): string {
  return `${areaId}:${slotId}`;
}
