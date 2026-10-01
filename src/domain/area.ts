import type { AreaId, AreaMaster } from "./types";

const SUMMER_MONTHS = new Set([6, 7, 8, 9]);
const AUTUMN_MONTHS = new Set([10, 11]);

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

export function isAutumnSeason(dateLike?: string | Date | null): boolean {
  return AUTUMN_MONTHS.has(getMonthFromDateLike(dateLike));
}

export const LEGACY_AREA_MASTERS: AreaMaster[] = [
  { id: "bento_men", name: "弁当・麺類", order: 1 },
  { id: "tempura", name: "天ぷら", order: 2 },
  { id: "ryomi", name: "夏商品", order: 3 },
  { id: "autumn", name: "秋商品", order: 3 },
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
    ...(isAutumnSeason(dateLike) ? (["autumn"] as AreaId[]) : []),
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

/** Historical validation must not depend on the month the app was loaded. */
export const ALL_AREA_IDS: AreaId[] = LEGACY_AREA_MASTERS.map((area) => area.id);

export function isKnownAreaId(value: unknown): value is AreaId {
  return typeof value === "string" && ALL_AREA_IDS.includes(value as AreaId);
}

export function normalizeAreaIds(raw: unknown): AreaId[] {
  return Array.isArray(raw) ? [...new Set(raw.filter(isKnownAreaId))] : [];
}

/** Keep the saved seasonal slot when resuming or reading a historical record. */
export function getAreaRouteFromStoredIds(
  dateLike: string | Date | null | undefined,
  storedAreaIds: readonly unknown[],
): AreaId[] {
  const stored = normalizeAreaIds(storedAreaIds);
  if (stored.length === 0) return getNormalRoute(dateLike);
  const seasonal = stored.filter((id) => id === "ryomi" || id === "autumn");
  return getNormalRoute(dateLike).flatMap((id) => {
    if (id === "ryomi" || id === "autumn") return [];
    return id === "tempura" ? [id, ...seasonal] : [id];
  });
}

/** New records save their expected route; legacy autumn months have no autumn area. */
export function getExpectedAreaIdsForStoredRecord(
  date: string,
  record: {
    expectedAreaIds?: unknown;
    appVersion?: string;
    areaCounts?: unknown;
    excludedAreaIds?: unknown;
    dataQuality?: { expectedAreaCount?: number; missingAreaIds?: unknown; notMeasuredAreaIds?: unknown };
    snapshot?: { areas?: unknown };
    sessions?: Array<{ areas?: unknown }>;
    review19Check?: { expectedAreaIds?: unknown; areaCounts?: unknown; excludedAreaIds?: unknown };
    areaCountRecords?: Array<{ areaId?: unknown }>;
  },
): AreaId[] {
  const explicit = normalizeAreaIds(record.expectedAreaIds ?? record.review19Check?.expectedAreaIds);
  if (explicit.length > 0) return explicit;
  const keys = (value: unknown) => value && typeof value === "object" ? Object.keys(value) : [];
  const savedIds = normalizeAreaIds([
    ...keys(record.areaCounts),
    ...normalizeAreaIds(record.excludedAreaIds),
    ...normalizeAreaIds(record.dataQuality?.missingAreaIds),
    ...normalizeAreaIds(record.dataQuality?.notMeasuredAreaIds),
    ...keys(record.snapshot?.areas),
    ...(record.sessions ?? []).flatMap((session) => keys(session.areas)),
    ...keys(record.review19Check?.areaCounts),
    ...normalizeAreaIds(record.review19Check?.excludedAreaIds),
    ...(record.areaCountRecords ?? []).map((item) => item.areaId),
  ]);
  // The existing summer calendar predates this release. Only the new autumn
  // slot needs positive saved evidence; a date alone cannot invent it.
  const expected = getNormalRoute(date).filter((id) => id !== "autumn" &&
    !(id === "ryomi" && record.dataQuality?.expectedAreaCount === 11 && !savedIds.includes("ryomi")));
  const seasonalIds = savedIds.filter((id) => id === "ryomi" || id === "autumn");
  if (seasonalIds.length === 0) return expected;
  return getAreaRouteFromStoredIds(date, [...expected, ...seasonalIds]);
}

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
