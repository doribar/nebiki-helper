import type { AreaId, AreaMaster } from "./types";

const SUMMER_MONTHS = new Set([6, 7, 8, 9]);

function getMonthFromDateLike(dateLike?: string | Date | null): number {
  if (dateLike instanceof Date) return dateLike.getMonth() + 1;
  if (typeof dateLike === "string") {
    const match = dateLike.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const month = Number(match[2]);
      if (Number.isFinite(month)) return month;
    }
  }
  return new Date().getMonth() + 1;
}

export function isRyomiSeason(dateLike?: string | Date | null): boolean {
  return SUMMER_MONTHS.has(getMonthFromDateLike(dateLike));
}

export const LEGACY_AREA_MASTERS: AreaMaster[] = [
  { id: "bento_men", name: "弁当・麺類", order: 1 },
  { id: "tempura", name: "天ぷら", order: 2 },
  { id: "ryomi", name: "涼味商品", order: 3 },
  { id: "croquette", name: "コロッケ系", order: 4 },
  { id: "fry_chicken", name: "フライ・鶏惣菜", order: 5 },
  { id: "yakitori", name: "焼鳥", order: 6 },
  { id: "chuka_fish", name: "中華・魚惣菜", order: 7 },
  // legacy compatibility: older saved data may still contain this area.
  { id: "balance_bento", name: "バランス弁当", order: 8 },
  { id: "onigiri", name: "おにぎり", order: 9 },
  { id: "sushi", name: "寿司", order: 10 },
  { id: "futomaki_chumaki", name: "太巻・中巻", order: 11 },
  { id: "inari", name: "いなり", order: 12 },
  { id: "hosomaki", name: "細巻き", order: 13 },
];

export function getNormalRoute(dateLike?: string | Date | null): AreaId[] {
  const route: AreaId[] = [
    "bento_men",
    "tempura",
    ...(isRyomiSeason(dateLike) ? (["ryomi"] as AreaId[]) : []),
    "croquette",
    "fry_chicken",
    "yakitori",
    "chuka_fish",
    "onigiri",
    "sushi",
    "futomaki_chumaki",
    "inari",
    "hosomaki",
  ];
  return route;
}

export function getDoneSummaryRoute(dateLike?: string | Date | null): AreaId[] {
  return [...getNormalRoute(dateLike)].reverse();
}

export function getAreaMasters(dateLike?: string | Date | null): AreaMaster[] {
  const routeSet = new Set(getNormalRoute(dateLike));
  return LEGACY_AREA_MASTERS.filter((area) => routeSet.has(area.id));
}

// Runtime defaults used by utility code/tests. App state creation also uses the date-aware helpers.
export const NORMAL_ROUTE: AreaId[] = getNormalRoute();
export const DONE_SUMMARY_ROUTE: AreaId[] = getDoneSummaryRoute();
export const AREA_MASTERS: AreaMaster[] = getAreaMasters();

export function getAreaName(areaId: AreaId): string {
  return LEGACY_AREA_MASTERS.find((a) => a.id === areaId)?.name ?? "";
}

export function getAreaOrder(areaId: AreaId): number {
  return LEGACY_AREA_MASTERS.find((a) => a.id === areaId)?.order ?? 0;
}

export function getNextNormalArea(currentAreaId: AreaId, dateLike?: string | Date | null): AreaId | null {
  const route = getNormalRoute(dateLike);
  const index = route.indexOf(currentAreaId);
  if (index === -1) return null;
  return route[index + 1] ?? null;
}
