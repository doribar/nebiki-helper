import { getCurrentDataVersionInfo } from "./dataVersion.ts";
import type { Review19DaySnapshot, Review19Result } from "./types.ts";

const JST_TIME_ZONE = "Asia/Tokyo";
const JST_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type AllDataExportVersionInfo = {
  dataSchemaVersion: number;
  appVersion: string;
  buildId: string;
};

export type AllDataExportDataQuality = {
  sourceDailyCount: number;
  sourceReview19Count: number;
  dayCount: number;
  dailyDataDayCount: number;
  review19DataDayCount: number;
  excludedDuplicateDates: string[];
  excludedDuplicateReview19Count: number;
  excludedNotApplicableCount: number;
  duplicateDailyDateCount: number;
  duplicateReview19DateCount: number;
  indeterminateCount: number;
  indeterminateDailyCount: number;
  indeterminateReview19Count: number;
};

export type AllDataExportPayload = {
  exportType: "nebiki-helper-all-data-export";
  version: 1;
  dataSchemaVersion: number;
  appVersion: string;
  buildId: string;
  exportedAt: string;
  dailyData: Review19DaySnapshot[];
  review19Data: Review19Result[];
  dataQuality: AllDataExportDataQuality;
};

function formatDateInJst(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function getJstDateFromTimestamp(value: string): string | null {
  return formatDateInJst(new Date(value));
}

export function isValidJstDateString(value: unknown): value is string {
  if (typeof value !== "string" || !JST_DATE_PATTERN.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00+09:00`);
  return formatDateInJst(parsed) === value;
}

function removeLegacyHour15(value: unknown): void {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach(removeLegacyHour15);
    return;
  }

  const record = value as Record<string, unknown>;
  const hourlyForecasts = record.hourlyForecasts;
  if (hourlyForecasts && typeof hourlyForecasts === "object" && !Array.isArray(hourlyForecasts)) {
    delete (hourlyForecasts as Record<string, unknown>)["15"];
  }
  Object.values(record).forEach(removeLegacyHour15);
}

function clone<T>(value: T): T {
  const cloned = JSON.parse(JSON.stringify(value)) as T;
  removeLegacyHour15(cloned);
  return cloned;
}

function selectLatestByDate<T>(params: {
  values: T[];
  getDate: (value: T) => string;
  getTimestamp: (value: T) => string;
}): Map<string, T> {
  const latestByDate = new Map<string, T>();

  for (const value of params.values) {
    const date = params.getDate(value);
    const current = latestByDate.get(date);
    if (!current || params.getTimestamp(current).localeCompare(params.getTimestamp(value)) <= 0) {
      latestByDate.set(date, value);
    }
  }

  return latestByDate;
}

function resolveCurrentVersionInfo(): AllDataExportVersionInfo {
  const current = getCurrentDataVersionInfo() as ReturnType<
    typeof getCurrentDataVersionInfo
  > & { buildId?: string };

  return {
    dataSchemaVersion: current.dataSchemaVersion,
    appVersion: current.appVersion,
    buildId: current.buildId ?? "unknown",
  };
}

export function buildAllDataExportPayload(params: {
  dailyData: readonly Review19DaySnapshot[];
  review19Data: readonly Review19Result[];
  exportedAt: string;
  versionInfo?: AllDataExportVersionInfo;
}): AllDataExportPayload {
  const validDaily = params.dailyData.filter((item) => isValidJstDateString(item.date));
  const indeterminateDailyCount = params.dailyData.length - validDaily.length;
  const latestDailyByDate = selectLatestByDate({
    values: validDaily,
    getDate: (item) => item.date,
    getTimestamp: (item) => item.capturedAt,
  });
  const dailyDates = new Set(latestDailyByDate.keys());

  const applicableReview19 = params.review19Data.filter(
    (item) => item.review19Status !== "not_applicable",
  );
  const excludedNotApplicableCount =
    params.review19Data.length - applicableReview19.length;
  const validReview19 = applicableReview19.filter((item) =>
    isValidJstDateString(item.date),
  );
  const indeterminateReview19Count =
    applicableReview19.length - validReview19.length;

  const duplicateReview19 = validReview19.filter((item) => dailyDates.has(item.date));
  const excludedDuplicateDates = [...new Set(duplicateReview19.map((item) => item.date))]
    .sort();
  const review19WithoutDailyDuplicates = validReview19.filter(
    (item) => !dailyDates.has(item.date),
  );
  const latestReview19ByDate = selectLatestByDate({
    values: review19WithoutDailyDuplicates,
    getDate: (item) => item.date,
    getTimestamp: (item) =>
      item.recordedAt ?? item.reviewCompletedAt ?? item.sessionStartedAt,
  });

  const dailyData = [...latestDailyByDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(clone);
  const review19Data = [...latestReview19ByDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(clone);
  const versionInfo = params.versionInfo ?? resolveCurrentVersionInfo();

  return {
    exportType: "nebiki-helper-all-data-export",
    version: 1,
    ...versionInfo,
    exportedAt: params.exportedAt,
    dailyData,
    review19Data,
    dataQuality: {
      sourceDailyCount: params.dailyData.length,
      sourceReview19Count: params.review19Data.length,
      dayCount: dailyData.length + review19Data.length,
      dailyDataDayCount: dailyData.length,
      review19DataDayCount: review19Data.length,
      excludedDuplicateDates,
      excludedDuplicateReview19Count: duplicateReview19.length,
      excludedNotApplicableCount,
      duplicateDailyDateCount: validDaily.length - latestDailyByDate.size,
      duplicateReview19DateCount:
        review19WithoutDailyDuplicates.length - latestReview19ByDate.size,
      indeterminateCount: indeterminateDailyCount + indeterminateReview19Count,
      indeterminateDailyCount,
      indeterminateReview19Count,
    },
  };
}

export function getAllDataExportFilename(exportedAt: string): string {
  const date = getJstDateFromTimestamp(exportedAt);
  return date ? `nebiki-all-data-${date}.json` : "nebiki-all-data.json";
}
