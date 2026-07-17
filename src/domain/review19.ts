import { NORMAL_ROUTE, getAreaName, getNormalRoute } from "./area.ts";
import { normalizeAreaCountRecords } from "./areaCountHistory.ts";
import {
  getCurrentDataVersionInfo,
  normalizeDataVersionInfo,
} from "./dataVersion.ts";
import type {
  AreaId,
  Review19AreaSnapshot,
  Review19Rating,
  Review19RatingScore,
  Review19Reference,
  Review19Result,
  Review19Snapshot,
  Review19DayCheckSnapshot,
  Review19DaySnapshot,
} from "./types.ts";

export const REVIEW19_RATINGS: Array<{
  value: Review19Rating;
  label: string;
  score: Review19RatingScore;
}> = [
  { value: "decreased_too_much", label: "減りすぎ", score: -2 },
  { value: "decreased_slightly_too_much", label: "やや減りすぎ", score: -1 },
  { value: "just_right", label: "ちょうどいい", score: 0 },
  { value: "remained_slightly_too_much", label: "やや残りすぎ", score: 1 },
  { value: "remained_too_much", label: "残りすぎ", score: 2 },
];

export const REVIEW19_EXPORT_BATCH_SIZE = 10;
const REVIEW19_COUNT_INPUT_STARTED_DATE = "2026-06-27";

export const REVIEW19_EXCLUDE_REASON_TEXT: Record<string, string> = {
  few_at_15: "対象外：15時・17時ともに「少ない」判定",
  few_at_15_and_17: "対象外：15時・17時ともに「少ない」判定",
  manual: "スキップ：手動で対象外",
};

function normalizeExcludedAreaIds(raw: unknown): AreaId[] {
  if (!Array.isArray(raw)) return [];

  const unique = new Set<AreaId>();
  for (const value of raw) {
    if (NORMAL_ROUTE.includes(value as AreaId)) {
      unique.add(value as AreaId);
    }
  }

  return [...unique];
}

function createExcludeReasons(
  areaIds: AreaId[],
): Partial<Record<AreaId, "few_at_15_and_17">> {
  return areaIds.reduce(
    (acc, areaId) => {
      acc[areaId] = "few_at_15_and_17";
      return acc;
    },
    {} as Partial<Record<AreaId, "few_at_15_and_17">>,
  );
}

function normalizeExcludeReason(raw: unknown) {
  if (raw === "manual") {
    return "manual" as const;
  }

  if (raw === "few_at_15" || raw === "few_at_15_and_17") {
    return "few_at_15_and_17" as const;
  }

  return undefined;
}

export function getReview19RatingScore(
  rating: Review19Rating,
): Review19RatingScore {
  return REVIEW19_RATINGS.find((item) => item.value === rating)?.score ?? 0;
}

export function createReview19RatingScores(
  ratings: Record<AreaId, Review19Rating>,
): Record<AreaId, Review19RatingScore> {
  return NORMAL_ROUTE.reduce(
    (acc, areaId) => {
      acc[areaId] = getReview19RatingScore(ratings[areaId]);
      return acc;
    },
    {} as Record<AreaId, Review19RatingScore>,
  );
}

export function createDefaultReview19Ratings(): Record<AreaId, Review19Rating> {
  return NORMAL_ROUTE.reduce(
    (acc, areaId) => {
      acc[areaId] = "just_right";
      return acc;
    },
    {} as Record<AreaId, Review19Rating>,
  );
}

export function createInitialReview19Result(params: {
  date: string;
  sessionStartedAt: string;
  reviewStartedAt?: string;
  excludedAreaIds?: AreaId[];
  review19Status?: "recorded" | "not_applicable";
}): Review19Result {
  const excludedAreaIds = normalizeExcludedAreaIds(
    params.excludedAreaIds ?? [],
  );

  return {
    ...getCurrentDataVersionInfo(),
    review19Status: params.review19Status ?? "recorded",
    date: params.date,
    sessionStartedAt: params.sessionStartedAt,
    reviewStartedAt: params.reviewStartedAt,
    reviewCompletedAt: undefined,
    areaCountRecordedAt: {},
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCounts: {},
    excludedAreaIds,
    excludeReasons: createExcludeReasons(excludedAreaIds),
    dataQuality: buildReview19DataQuality({
      date: params.date,
      areaCounts: {},
      excludedAreaIds,
      review19Status: params.review19Status,
    }),
  };
}

export function buildReview19DataQuality(params: {
  date: string;
  areaCounts: Partial<Record<AreaId, number>>;
  excludedAreaIds: AreaId[];
  review19Status?: "recorded" | "not_applicable";
}) {
  if (params.review19Status === "not_applicable") {
    return {
      expectedAreaCount: 0,
      recordedAreaCount: 0,
      excludedAreaCount: 0,
      missingAreaIds: [],
      duplicateAreaIds: [],
      complete: true,
    };
  }

  const expectedAreaIds = getNormalRoute(params.date);
  const excludedAreaIdSet = new Set(params.excludedAreaIds);
  const recordedAreaIds = expectedAreaIds.filter((areaId) => {
    return !excludedAreaIdSet.has(areaId) && typeof params.areaCounts[areaId] === "number";
  });
  const excludedAreaIds = expectedAreaIds.filter((areaId) => excludedAreaIdSet.has(areaId));
  const missingAreaIds = expectedAreaIds.filter((areaId) => {
    return !excludedAreaIdSet.has(areaId) && typeof params.areaCounts[areaId] !== "number";
  });

  return {
    expectedAreaCount: expectedAreaIds.length,
    recordedAreaCount: recordedAreaIds.length,
    excludedAreaCount: excludedAreaIds.length,
    missingAreaIds,
    duplicateAreaIds: [],
    complete: missingAreaIds.length === 0,
  };
}

export function getReview19AreaItems(): Array<{
  areaId: AreaId;
  areaName: string;
}> {
  return NORMAL_ROUTE.map((areaId) => ({
    areaId,
    areaName: getAreaName(areaId),
  }));
}

export function isValidReview19Rating(value: unknown): value is Review19Rating {
  return REVIEW19_RATINGS.some((rating) => rating.value === value);
}

export function parseReview19RatePercent(text?: string): number | undefined {
  if (!text) return undefined;
  if (text === "引かない") return 0;

  const match = text.match(/(-?\d+)\s*%/);
  if (!match) return undefined;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeReview19AreaSnapshot(
  area: Review19AreaSnapshot,
): Review19AreaSnapshot {
  return {
    ...area,
    reviewExcluded: area.reviewExcluded === true,
    reviewExcludeReason: normalizeExcludeReason(area.reviewExcludeReason),
    ratePercent: area.ratePercent ?? parseReview19RatePercent(area.rateText),
    manyRatePercent:
      area.manyRatePercent ?? parseReview19RatePercent(area.manyRateText),
    normalRatePercent:
      area.normalRatePercent ?? parseReview19RatePercent(area.normalRateText),
  };
}

function normalizeReview19Snapshot(
  raw?: Partial<Review19Snapshot> | null,
): Review19Snapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const cloned = JSON.parse(JSON.stringify(raw)) as Review19Snapshot;
  if (!cloned.areas || typeof cloned.areas !== "object") return cloned;

  for (const areaId of Object.keys(cloned.areas) as AreaId[]) {
    cloned.areas[areaId] = normalizeReview19AreaSnapshot(cloned.areas[areaId]);
  }

  return cloned;
}

function normalizeLegacyReview19Ratings(
  raw: unknown,
): Record<AreaId, Review19Rating> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const ratings = createDefaultReview19Ratings();
  let hasValidRating = false;

  for (const areaId of NORMAL_ROUTE) {
    const rating = (raw as Partial<Record<AreaId, unknown>>)[areaId];
    if (!isValidReview19Rating(rating)) continue;
    ratings[areaId] = rating;
    hasValidRating = true;
  }

  return hasValidRating ? ratings : null;
}

function normalizeReview19RatingData(params: {
  date: string;
  ratingStatus: unknown;
  ratings: unknown;
  hasAreaCountsField: boolean;
}): Pick<Review19Result, "ratingStatus" | "ratings" | "ratingScores"> {
  const legacyRatings = normalizeLegacyReview19Ratings(params.ratings);
  const explicitlyRecorded = params.ratingStatus === "recorded";
  const explicitlyNotCollected = params.ratingStatus === "not_collected";
  const predatesCountInput = params.date < REVIEW19_COUNT_INPUT_STARTED_DATE;
  const preserveLegacyRatings =
    !explicitlyNotCollected &&
    legacyRatings !== null &&
    (explicitlyRecorded || !params.hasAreaCountsField || predatesCountInput);

  if (!preserveLegacyRatings) {
    return {
      ratingStatus: "not_collected",
      ratings: null,
      ratingScores: null,
    };
  }

  return {
    ratingStatus: "recorded",
    ratings: legacyRatings,
    ratingScores: createReview19RatingScores(legacyRatings),
  };
}

function normalizeReview19DayCheckSnapshot(
  raw: Partial<Review19DayCheckSnapshot> | null | undefined,
  date: string,
): Review19DayCheckSnapshot | undefined {
  if (!raw || typeof raw !== "object" || raw.version !== 1) return undefined;
  if (typeof raw.recordedAt !== "string" || typeof raw.sessionStartedAt !== "string") {
    return undefined;
  }

  const ratingData = normalizeReview19RatingData({
    date,
    ratingStatus: raw.ratingStatus,
    ratings: raw.ratings,
    hasAreaCountsField: Object.prototype.hasOwnProperty.call(raw, "areaCounts"),
  });

  const areaCounts = normalizeReview19AreaCounts(raw.areaCounts);
  const excludedAreaIds = normalizeExcludedAreaIds(raw.excludedAreaIds);
  for (const areaId of excludedAreaIds) {
    delete areaCounts[areaId];
  }
  const areaCountRecordedAt = normalizeAreaCountRecordedAt(
    raw.areaCountRecordedAt,
    date,
    excludedAreaIds,
  );
  const review19Status =
    raw.review19Status === "not_applicable" ? "not_applicable" : "recorded";
  const dataVersion = normalizeDataVersionInfo(raw);

  return JSON.parse(JSON.stringify({
    ...raw,
    ...dataVersion,
    review19Status,
    ...ratingData,
    reviewStartedAt:
      typeof raw.reviewStartedAt === "string" ? raw.reviewStartedAt : undefined,
    reviewCompletedAt:
      typeof raw.reviewCompletedAt === "string" ? raw.reviewCompletedAt : raw.recordedAt,
    areaCountRecordedAt,
    areaCounts,
    excludedAreaIds,
    excludeReasons:
      raw.excludeReasons && typeof raw.excludeReasons === "object"
        ? raw.excludeReasons
        : {},
    dataQuality: buildReview19DataQuality({
      date,
      areaCounts,
      excludedAreaIds,
      review19Status,
    }),
  })) as Review19DayCheckSnapshot;
}


function normalizeReview19DaySnapshot(
  raw?: Partial<Review19DaySnapshot> | null,
): Review19DaySnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  if (raw.version !== 1) return undefined;
  if (typeof raw.capturedAt !== "string" || typeof raw.date !== "string") return undefined;

  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.filter((session) => {
        const screen = (session as { screen?: unknown })?.screen;
        return screen !== "review19_weather" && screen !== "review19" && screen !== "review19_done";
      })
    : [];
  const review19Check = normalizeReview19DayCheckSnapshot(raw.review19Check, raw.date);
  const review19Status =
    raw.review19Status === "recorded" ||
    raw.review19Status === "not_performed" ||
    raw.review19Status === "not_applicable"
      ? raw.review19Status
      : review19Check?.review19Status ?? "not_performed";

  return JSON.parse(JSON.stringify({
    ...raw,
    ...normalizeDataVersionInfo(raw),
    sessions,
    review19Status,
    review19Check,
    areaCountRecords: normalizeAreaCountRecords(raw.areaCountRecords),
  })) as Review19DaySnapshot;
}

function cloneReview19Reference(
  raw?: Partial<Review19Reference> | null,
): Review19Reference | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  if (raw.discountTime !== "19") return undefined;
  if (typeof raw.date !== "string" || typeof raw.weekday !== "number")
    return undefined;
  if (!raw.weather || typeof raw.weather !== "object") return undefined;
  if (!raw.resolvedWeather || typeof raw.resolvedWeather !== "object")
    return undefined;
  if (!raw.basis || typeof raw.basis !== "object") return undefined;

  return JSON.parse(JSON.stringify(raw)) as Review19Reference;
}


function normalizeReview19AreaCounts(raw: unknown): Partial<Record<AreaId, number>> {
  const result: Partial<Record<AreaId, number>> = {};
  if (!raw || typeof raw !== "object") return result;

  for (const areaId of NORMAL_ROUTE) {
    const value = (raw as Partial<Record<AreaId, unknown>>)[areaId];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const rounded = Math.max(0, Math.round(value));
    result[areaId] = rounded;
  }

  return result;
}

function normalizeAreaCountRecordedAt(
  raw: unknown,
  date: string,
  excludedAreaIds: AreaId[],
): Partial<Record<AreaId, string>> {
  const result: Partial<Record<AreaId, string>> = {};
  if (!raw || typeof raw !== "object") return result;
  const excludedAreaIdSet = new Set(excludedAreaIds);

  for (const areaId of getNormalRoute(date)) {
    if (excludedAreaIdSet.has(areaId)) continue;
    const value = (raw as Partial<Record<AreaId, unknown>>)[areaId];
    if (typeof value === "string") result[areaId] = value;
  }

  return result;
}

export function normalizeReview19Result(
  raw?: Partial<Review19Result> | null,
): Review19Result | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.date !== "string" || typeof raw.sessionStartedAt !== "string")
    return null;

  const rawExcludedAreaIds = normalizeExcludedAreaIds(
    (raw as Partial<Review19Result>).excludedAreaIds,
  );
  const base = createInitialReview19Result({
    date: raw.date,
    sessionStartedAt: raw.sessionStartedAt,
    excludedAreaIds: rawExcludedAreaIds,
    review19Status:
      raw.review19Status === "not_applicable" ? "not_applicable" : "recorded",
  });

  const ratingData = normalizeReview19RatingData({
    date: raw.date,
    ratingStatus: raw.ratingStatus,
    ratings: raw.ratings,
    hasAreaCountsField: Object.prototype.hasOwnProperty.call(raw, "areaCounts"),
  });

  const sourceExcludeReasons =
    raw.excludeReasons && typeof raw.excludeReasons === "object" ? raw.excludeReasons : {};
  const excludeReasons = { ...base.excludeReasons };
  for (const areaId of base.excludedAreaIds) {
    const reason = normalizeExcludeReason(
      (sourceExcludeReasons as Partial<Record<AreaId, unknown>>)[areaId],
    );
    if (reason) {
      excludeReasons[areaId] = reason;
    }
  }

  const areaCounts = normalizeReview19AreaCounts((raw as Partial<Review19Result>).areaCounts);
  for (const areaId of base.excludedAreaIds) {
    delete areaCounts[areaId];
  }
  const areaCountRecordedAt = normalizeAreaCountRecordedAt(
    raw.areaCountRecordedAt,
    raw.date,
    base.excludedAreaIds,
  );
  const recordedAt = typeof raw.recordedAt === "string" ? raw.recordedAt : undefined;

  return {
    ...base,
    ...normalizeDataVersionInfo(raw),
    ...ratingData,
    reviewStartedAt:
      typeof raw.reviewStartedAt === "string" ? raw.reviewStartedAt : undefined,
    reviewCompletedAt:
      typeof raw.reviewCompletedAt === "string" ? raw.reviewCompletedAt : recordedAt,
    areaCountRecordedAt,
    areaCounts,
    excludedAreaIds: base.excludedAreaIds,
    excludeReasons,
    dataQuality: buildReview19DataQuality({
      date: raw.date,
      areaCounts,
      excludedAreaIds: base.excludedAreaIds,
      review19Status: base.review19Status,
    }),
    recordedAt,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : undefined,
    reference: cloneReview19Reference(raw.reference),
    snapshot: normalizeReview19Snapshot(raw.snapshot),
    daySnapshot: normalizeReview19DaySnapshot(raw.daySnapshot),
  };
}

export function cloneReview19Result(
  record: Review19Result | null,
): Review19Result | null {
  const normalized = normalizeReview19Result(record);
  return normalized
    ? (JSON.parse(JSON.stringify(normalized)) as Review19Result)
    : null;
}

export function cloneReview19Records(
  records: Review19Result[],
): Review19Result[] {
  return records
    .map((record) => cloneReview19Result(record))
    .filter((record): record is Review19Result => record !== null);
}

export function appendReview19RecordInMemory(params: {
  currentRecords: Review19Result[];
  recordToAdd: Review19Result;
}): Review19Result[] {
  const normalizedRecord = normalizeReview19Result(params.recordToAdd);
  if (!normalizedRecord?.recordedAt) {
    return cloneReview19Records(params.currentRecords);
  }

  const current = cloneReview19Records(params.currentRecords);
  const index = current.findIndex(
    (record) =>
      record.date === normalizedRecord.date &&
      record.sessionStartedAt === normalizedRecord.sessionStartedAt,
  );

  if (index >= 0) {
    current[index] = normalizedRecord;
    return current;
  }

  return [...current, normalizedRecord];
}

function getReview19RecordKey(record: Review19Result): string {
  return `${record.date}::${record.sessionStartedAt}`;
}

export function getUnexportedReview19Records(
  records: Review19Result[],
): Review19Result[] {
  return cloneReview19Records(records)
    .filter((record) => Boolean(record.recordedAt) && !record.exportedAt)
    .sort((a, b) => {
      const recordedCompare = (a.recordedAt ?? "").localeCompare(
        b.recordedAt ?? "",
      );
      if (recordedCompare !== 0) return recordedCompare;
      return getReview19RecordKey(a).localeCompare(getReview19RecordKey(b));
    });
}

export function getReview19ExportBatch(
  records: Review19Result[],
  limit = REVIEW19_EXPORT_BATCH_SIZE,
): Review19Result[] {
  return getUnexportedReview19Records(records).slice(0, limit);
}

export function buildReview19ExportPayload(params: {
  records: Review19Result[];
  exportedAt: string;
}) {
  const records = cloneReview19Records(params.records);
  const incompleteRecords = records
    .filter((record) => !record.dataQuality.complete)
    .map((record) => ({
      date: record.date,
      sessionStartedAt: record.sessionStartedAt,
      missingAreaIds: [...record.dataQuality.missingAreaIds],
    }));
  return {
    format: "nebiki-helper-review19-export",
    version: 1,
    ...getCurrentDataVersionInfo(),
    exportedAt: params.exportedAt,
    count: records.length,
    dataQuality: {
      recordedCount: records.filter((record) => record.review19Status === "recorded").length,
      notApplicableCount: records.filter(
        (record) => record.review19Status === "not_applicable",
      ).length,
      completeRecordCount: records.length - incompleteRecords.length,
      incompleteRecordCount: incompleteRecords.length,
      incompleteRecords,
    },
    records,
  };
}

export function markReview19RecordsExportedInMemory(params: {
  currentRecords: Review19Result[];
  recordsToMark: Review19Result[];
  exportedAt: string;
}): Review19Result[] {
  const targetKeys = new Set(params.recordsToMark.map(getReview19RecordKey));

  return cloneReview19Records(params.currentRecords).map((record) => {
    if (!targetKeys.has(getReview19RecordKey(record))) return record;
    return {
      ...record,
      exportedAt: params.exportedAt,
    };
  });
}
