import { NORMAL_ROUTE, getAreaName } from "./area.ts";
import type {
  AreaId,
  Review19AreaSnapshot,
  Review19Rating,
  Review19RatingScore,
  Review19Reference,
  Review19Result,
  Review19Snapshot,
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

export const REVIEW19_EXCLUDE_REASON_TEXT: Record<string, string> = {
  few_at_15: "対象外：15時・17時ともに「少ない」判定",
  few_at_15_and_17: "対象外：15時・17時ともに「少ない」判定",
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
  excludedAreaIds?: AreaId[];
}): Review19Result {
  const ratings = createDefaultReview19Ratings();
  const excludedAreaIds = normalizeExcludedAreaIds(
    params.excludedAreaIds ?? [],
  );

  return {
    date: params.date,
    sessionStartedAt: params.sessionStartedAt,
    ratings,
    ratingScores: createReview19RatingScores(ratings),
    areaCounts: {},
    excludedAreaIds,
    excludeReasons: createExcludeReasons(excludedAreaIds),
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
  });

  const sourceRatings =
    raw.ratings && typeof raw.ratings === "object" ? raw.ratings : {};

  for (const areaId of NORMAL_ROUTE) {
    const rating = (sourceRatings as Partial<Record<AreaId, unknown>>)[areaId];
    if (isValidReview19Rating(rating)) {
      base.ratings[areaId] = rating;
    }
  }

  return {
    ...base,
    ratingScores: createReview19RatingScores(base.ratings),
    areaCounts: normalizeReview19AreaCounts((raw as Partial<Review19Result>).areaCounts),
    excludedAreaIds: base.excludedAreaIds,
    excludeReasons: base.excludeReasons,
    recordedAt: typeof raw.recordedAt === "string" ? raw.recordedAt : undefined,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : undefined,
    reference: cloneReview19Reference(raw.reference),
    snapshot: normalizeReview19Snapshot(raw.snapshot),
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
  return {
    format: "nebiki-helper-review19-export",
    version: 1,
    exportedAt: params.exportedAt,
    count: records.length,
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

