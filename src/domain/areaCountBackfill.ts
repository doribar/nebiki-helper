import { LEGACY_AREA_MASTERS } from "./area.ts";
import {
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  isAreaCountAssistDiscountTime,
  mergeAreaCountRecordCollections,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "./areaCountHistory.ts";
import type { AreaId, DemandCycle } from "./types.ts";

export type AreaCountBackfillSources = {
  /** Contents of nebiki-helper/area-count-records-v2. */
  unifiedCacheRecords?: unknown;
  /** Contents of nebiki-helper/summer-area-count-records-v1. */
  summerCacheRecords?: unknown;
  finalizedDayRecords?: readonly unknown[];
  review19Records?: readonly unknown[];
  dailySessionSnapshots?: readonly unknown[];
  currentState?: unknown;
  /** Runtime Unix time. Callers must not invoke this collector in fixed-time mode. */
  nowMs: number;
};

const VALID_AREA_IDS = new Set(
  LEGACY_AREA_MASTERS.map((area) => area.id),
);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function getJstDateString(nowMs: number): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function getTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidAreaId(value: unknown): value is AreaId {
  return typeof value === "string" &&
    VALID_AREA_IDS.has(value as AreaId);
}

function resolveConsistentDemandCycle(
  ...values: readonly unknown[]
): DemandCycle | null {
  let resolved: DemandCycle | undefined;
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (value !== "normal" && value !== "summer") return null;
    if (resolved && resolved !== value) return null;
    resolved = value;
  }
  return resolved ?? "normal";
}

function isEligibleRecord(
  record: AreaCountRecord,
  nowMs: number,
  maxDate: string,
): boolean {
  if (!isValidDateString(record.date) || record.date > maxDate) return false;
  if (!isValidAreaId(record.areaId)) return false;
  if (!Number.isFinite(record.count) || record.count < 0) return false;

  const sessionStartedAt = getTimestamp(record.sessionStartedAt);
  const recordedAt = getTimestamp(record.recordedAt);
  return sessionStartedAt !== null &&
    recordedAt !== null &&
    sessionStartedAt <= nowMs &&
    recordedAt <= nowMs &&
    recordedAt >= sessionStartedAt;
}

function normalizeDirectRecords(
  raw: unknown,
  nowMs: number,
  maxDate: string,
  fallbackDemandCycle?: DemandCycle,
): AreaCountRecord[] {
  if (!Array.isArray(raw)) return [];

  const recordsWithValidCycle = raw.filter((candidate) => {
    if (!isObject(candidate)) return false;
    return candidate.demandCycle === undefined ||
      candidate.demandCycle === "normal" ||
      candidate.demandCycle === "summer";
  });
  return normalizeAreaCountRecords(
    recordsWithValidCycle,
    fallbackDemandCycle,
  ).filter((record) => isEligibleRecord(record, nowMs, maxDate));
}

function getAreaCountRecords(value: unknown): unknown {
  return isObject(value) ? value.areaCountRecords : undefined;
}

function collectFinalizedDayRecords(
  values: readonly unknown[] | undefined,
  nowMs: number,
  maxDate: string,
): AreaCountRecord[] {
  return (values ?? []).flatMap((value) =>
    normalizeDirectRecords(getAreaCountRecords(value), nowMs, maxDate),
  );
}

function collectReview19DayRecords(
  values: readonly unknown[] | undefined,
  nowMs: number,
  maxDate: string,
): AreaCountRecord[] {
  return (values ?? []).flatMap((value) => {
    if (!isObject(value) || !isObject(value.daySnapshot)) return [];
    return normalizeDirectRecords(
      value.daySnapshot.areaCountRecords,
      nowMs,
      maxDate,
    );
  });
}

function getVersionField(
  field: "dataSchemaVersion" | "appVersion" | "buildId",
  ...values: readonly Record<string, unknown>[]
): unknown {
  for (const value of values) {
    if (value[field] !== undefined) return value[field];
  }
  return undefined;
}

function reconstructAreaRecord(params: {
  areaId: AreaId;
  area: Record<string, unknown>;
  container: Record<string, unknown>;
  session: Record<string, unknown>;
  demandCycle: DemandCycle;
  date: string;
  weekday: number;
  discountTime: AreaCountRecord["discountTime"];
  sessionStartedAt: string;
  recordedAt: string;
}): AreaCountRecord | null {
  const count = params.area.areaCount;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return null;
  }
  if (params.area.measurementStatus === "not_measured") return null;
  if (
    params.area.measurementStatus !== undefined &&
    params.area.measurementStatus !== "measured"
  ) {
    return null;
  }

  const evaluationSource = params.area.areaCountEvaluationSource;
  const evaluation = params.area.areaCountEvaluation;
  const normalized = normalizeAreaCountRecords([
    {
      dataSchemaVersion: getVersionField(
        "dataSchemaVersion",
        params.area,
        params.container,
        params.session,
      ),
      appVersion: getVersionField(
        "appVersion",
        params.area,
        params.container,
        params.session,
      ),
      buildId: getVersionField(
        "buildId",
        params.area,
        params.container,
        params.session,
      ),
      demandCycle: params.demandCycle,
      date: params.date,
      sessionStartedAt: params.sessionStartedAt,
      recordedAt: params.recordedAt,
      areaId: params.areaId,
      discountTime: params.discountTime,
      actualWeekday: getActualWeekdayLabel(params.weekday),
      actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({
        weekday: params.weekday,
        discountTime: params.discountTime,
        date: params.date,
      }),
      count,
      userJudge: evaluationSource === "manual" ? evaluation : undefined,
      humanEvaluationDetails: params.area.humanEvaluationDetails,
      suggestedEvaluation:
        evaluationSource === "history" ? evaluation : undefined,
      areaRateAdjustment: params.area.areaRateAdjustment,
      evaluationSource,
      decisionBasis: params.area.areaCountDecisionBasis,
    },
  ]);
  return normalized[0] ?? null;
}

function reconstructSnapshotRecords(
  value: unknown,
  nowMs: number,
  maxDate: string,
): AreaCountRecord[] {
  if (!isObject(value) || !isObject(value.session) || !isObject(value.areas)) {
    return [];
  }
  const session = value.session;
  const date = session.date;
  const weekday = session.weekday;
  const rawDiscountTime = session.discountTime;
  const startedAt = session.startedAt;
  if (!isValidDateString(date) || date > maxDate) return [];
  if (
    typeof weekday !== "number" ||
    !Number.isInteger(weekday) ||
    weekday < 0 ||
    weekday > 6
  ) {
    return [];
  }
  if (
    typeof rawDiscountTime !== "string" ||
    !isAreaCountAssistDiscountTime(
      rawDiscountTime as AreaCountRecord["discountTime"],
    )
  ) {
    return [];
  }
  const discountTime = rawDiscountTime as AreaCountRecord["discountTime"];
  if (typeof startedAt !== "string") return [];
  const sessionStartedAt = getTimestamp(startedAt);
  if (sessionStartedAt === null || sessionStartedAt > nowMs) return [];
  const demandCycle = resolveConsistentDemandCycle(
    value.demandCycle,
    session.demandCycle,
  );
  if (!demandCycle) return [];

  return Object.entries(value.areas).flatMap(([areaId, candidate]) => {
    if (!isValidAreaId(areaId) || !isObject(candidate)) return [];
    if (candidate.areaId !== undefined && candidate.areaId !== areaId) return [];
    const measurementRecordedAt = candidate.measurementRecordedAt;
    if (typeof measurementRecordedAt !== "string") return [];
    const recordedAt = getTimestamp(measurementRecordedAt);
    if (
      recordedAt === null ||
      recordedAt > nowMs ||
      recordedAt < sessionStartedAt
    ) {
      return [];
    }
    const record = reconstructAreaRecord({
      areaId,
      area: candidate,
      container: value,
      session,
      demandCycle,
      date,
      weekday,
      discountTime,
      sessionStartedAt: startedAt,
      recordedAt: measurementRecordedAt,
    });
    return record && isEligibleRecord(record, nowMs, maxDate) ? [record] : [];
  });
}

function reconstructCurrentStateRecords(
  value: unknown,
  nowMs: number,
  maxDate: string,
): AreaCountRecord[] {
  if (
    !isObject(value) ||
    !isObject(value.session) ||
    !isObject(value.areaProgressMap)
  ) {
    return [];
  }
  const session = value.session;
  const date = session.date;
  const weekday = session.weekday;
  const rawDiscountTime = session.discountTime;
  const startedAt = session.startedAt;
  if (!isValidDateString(date) || date > maxDate) return [];
  if (
    typeof weekday !== "number" ||
    !Number.isInteger(weekday) ||
    weekday < 0 ||
    weekday > 6
  ) {
    return [];
  }
  if (
    typeof rawDiscountTime !== "string" ||
    !isAreaCountAssistDiscountTime(
      rawDiscountTime as AreaCountRecord["discountTime"],
    )
  ) {
    return [];
  }
  const discountTime = rawDiscountTime as AreaCountRecord["discountTime"];
  if (typeof startedAt !== "string") return [];
  const sessionStartedAt = getTimestamp(startedAt);
  if (sessionStartedAt === null || sessionStartedAt > nowMs) return [];
  const demandCycle = resolveConsistentDemandCycle(session.demandCycle);
  if (!demandCycle) return [];

  return Object.entries(value.areaProgressMap).flatMap(([areaId, candidate]) => {
    if (!isValidAreaId(areaId) || !isObject(candidate)) return [];
    if (candidate.areaId !== undefined && candidate.areaId !== areaId) return [];
    const measurementRecordedAt = candidate.measurementRecordedAt;
    if (typeof measurementRecordedAt !== "string") return [];
    const recordedAt = getTimestamp(measurementRecordedAt);
    if (
      recordedAt === null ||
      recordedAt > nowMs ||
      recordedAt < sessionStartedAt
    ) {
      return [];
    }
    const record = reconstructAreaRecord({
      areaId,
      area: candidate,
      container: value,
      session,
      demandCycle,
      date,
      weekday,
      discountTime,
      sessionStartedAt: startedAt,
      recordedAt: measurementRecordedAt,
    });
    return record && isEligibleRecord(record, nowMs, maxDate) ? [record] : [];
  });
}

export function collectAreaCountBackfillRecords(
  sources: AreaCountBackfillSources,
): AreaCountRecord[] {
  if (!Number.isFinite(sources.nowMs)) {
    throw new TypeError("nowMs must be a finite runtime timestamp");
  }
  const maxDate = getJstDateString(sources.nowMs);

  return mergeAreaCountRecordCollections(
    normalizeDirectRecords(
      sources.unifiedCacheRecords,
      sources.nowMs,
      maxDate,
    ),
    normalizeDirectRecords(
      sources.summerCacheRecords,
      sources.nowMs,
      maxDate,
      "summer",
    ),
    collectFinalizedDayRecords(
      sources.finalizedDayRecords,
      sources.nowMs,
      maxDate,
    ),
    collectReview19DayRecords(
      sources.review19Records,
      sources.nowMs,
      maxDate,
    ),
    (sources.dailySessionSnapshots ?? []).flatMap((snapshot) =>
      reconstructSnapshotRecords(snapshot, sources.nowMs, maxDate),
    ),
    reconstructCurrentStateRecords(
      sources.currentState,
      sources.nowMs,
      maxDate,
    ),
  );
}
