import type { AreaId, AreaMaster } from "./types";

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
  "sushi",
  "futomaki_chumaki",
  "inari",
  "hosomaki",
];

export const DONE_SUMMARY_ROUTE: AreaId[] = [
  "hosomaki",
  "inari",
  "futomaki_chumaki",
  "sushi",
  "onigiri",
  "sekihan_takikomi",
  "balance_bento",
  "chuka_fish",
  "yakitori",
  "fry_chicken",
  "croquette",
  "tempura",
  "bento_men",
];

export const AREA_MASTERS: AreaMaster[] = [
  { id: "bento_men", name: "弁当・麺類", order: 1 },
  { id: "tempura", name: "天ぷら", order: 2 },
  { id: "croquette", name: "コロッケ系", order: 3 },
  { id: "fry_chicken", name: "フライ・鶏惣菜", order: 4 },
  { id: "yakitori", name: "焼鳥", order: 5 },
  { id: "chuka_fish", name: "中華・魚惣菜", order: 6 },
  { id: "balance_bento", name: "バランス弁当", order: 7 },
  { id: "sekihan_takikomi", name: "赤飯・炊き込みご飯", order: 8 },
  { id: "onigiri", name: "おにぎり", order: 9 },
  { id: "sushi", name: "寿司", order: 10 },
  { id: "futomaki_chumaki", name: "太巻・中巻", order: 11 },
  { id: "inari", name: "いなり", order: 12 },
  { id: "hosomaki", name: "細巻き", order: 13 },
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
