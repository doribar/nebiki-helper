import type { AreaId, AreaMaster } from "./types";

export const AREA_MASTERS: AreaMaster[] = [
  { id: "hosomaki", name: "細巻き", order: 1 },
  { id: "inari", name: "いなり", order: 2 },
  { id: "futomaki_chumaki", name: "太巻・中巻", order: 3 },
  { id: "sushi", name: "寿司", order: 4 },
  { id: "onigiri", name: "おにぎり", order: 5 },
  { id: "sekihan_takikomi", name: "赤飯・炊き込みご飯", order: 6 },
  { id: "chuka_fish", name: "中華・魚惣菜", order: 7 },
  { id: "yakitori", name: "焼鳥", order: 8 },
  { id: "fry_chicken", name: "フライ・鶏惣菜", order: 9 },
  { id: "croquette", name: "コロッケ系", order: 10 },
  { id: "tempura", name: "天ぷら", order: 11 },
  { id: "bento_men", name: "弁当・麺類", order: 12 },
];

export const NORMAL_ROUTE: AreaId[] = [
  "bento_men",
  "tempura",
  "croquette",
  "fry_chicken",
  "yakitori",
  "chuka_fish",
  "sekihan_takikomi",
  "onigiri",
  "sushi",
  "futomaki_chumaki",
  "inari",
  "hosomaki",
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