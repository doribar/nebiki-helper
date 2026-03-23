import type { AreaId, AreaMaster } from "./types";

export const AREA_MASTERS: AreaMaster[] = [
  { id: "hosomaki", name: "細巻き", order: 1 },
  { id: "inari", name: "いなり", order: 2 },
  { id: "futomaki_chumaki", name: "太巻・中巻", order: 3 },
  { id: "sushi", name: "寿司", order: 4 },
  { id: "onigiri", name: "おにぎり", order: 5 },
  { id: "sekihan_takikomi", name: "赤飯・炊き込みご飯", order: 6 },
  { id: "balance_bento", name: "バランス弁当", order: 7 },
  { id: "chuka_fish", name: "中華・魚惣菜", order: 8 },
  { id: "yakitori", name: "焼鳥", order: 9 },
  { id: "fry_chicken", name: "フライ・鶏惣菜", order: 10 },
  { id: "croquette", name: "コロッケ系", order: 11 },
  { id: "tempura", name: "天ぷら", order: 12 },
  { id: "bento_men", name: "弁当・麺類", order: 13 },
];

export const NORMAL_ROUTE: AreaId[] = [
  "bento_men",
  "tempura",
  "croquette",
  "fry_chicken",
  "yakitori",
  "chuka_fish",
  "balance_bento",
  "sekihan_takikomi",
  "onigiri",
  "hosomaki",
  "inari",
  "futomaki_chumaki",
  "sushi",
];

export function getAreaName(areaId: AreaId): string {
  return AREA_MASTERS.find((a) => a.id === areaId)?.name ?? "";
}

export function getAreaOrder(areaId: AreaId): number {
  return AREA_MASTERS.find((a) => a.id === areaId)?.order ?? 0;
}

export function getNextNormalArea(currentAreaId: AreaId): AreaId | null {
  const index = NORMAL_ROUTE.indexOf(currentAreaId);
  if (index === -1) return null;
  return NORMAL_ROUTE[index + 1] ?? null;
}