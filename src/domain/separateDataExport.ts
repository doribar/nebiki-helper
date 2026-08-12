import {
  buildAutomaticDayExportDataQuality,
  buildAutomaticDayExportPayload,
} from "./dayExport.ts";
import { getCurrentDataVersionInfo } from "./dataVersion.ts";
import { normalizeDemandCycle } from "./demandCycle.ts";
import {
  selectAllFinalizedDayData,
  selectLatestFinalizedDayData,
  type FinalizedDayData,
  type StoredFinalizedDayData,
} from "./finalizedDayData.ts";
import {
  buildReview19ExportPayload,
  cloneReview19Records,
  materializeReview19DaySnapshotHumanEvaluationsForExport,
} from "./review19.ts";
import type { DemandCycle, Review19Result } from "./types.ts";

const DEMAND_CYCLES: readonly DemandCycle[] = ["normal", "summer"];
const JST_TIME_ZONE = "Asia/Tokyo";

export type DemandCycleExportFilter = {
  demandCycle: DemandCycle;
};

export type DemandCycleExportBundle<T> = {
  demandCycle: DemandCycle;
  payload: T;
};

function withDemandCycleExportFilter<T extends object>(
  payload: T,
  demandCycle?: DemandCycle,
): T & { exportFilter?: DemandCycleExportFilter } {
  return demandCycle
    ? { ...payload, exportFilter: { demandCycle } }
    : payload;
}

function getTimestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function getReviewExecutionTimestamp(record: Review19Result): number {
  return getTimestamp(
    record.reviewCompletedAt ??
      record.reviewStartedAt ??
      record.sessionStartedAt,
  );
}

function compareReview19Data(a: Review19Result, b: Review19Result): number {
  const dateCompare = a.date.localeCompare(b.date);
  if (dateCompare !== 0) return dateCompare;

  const timeCompare =
    getReviewExecutionTimestamp(a) - getReviewExecutionTimestamp(b);
  if (timeCompare !== 0) return timeCompare;

  return a.sessionStartedAt.localeCompare(b.sessionStartedAt);
}

/** 19:00チェックだけを実施日時順に返す。日次データは混在させない。 */
export function selectAllReview19Data(
  records: readonly Review19Result[],
): Review19Result[] {
  return cloneReview19Records([...records])
    .filter((record) => record.review19Status === "recorded")
    .sort(compareReview19Data);
}

/** 対象日付、同日ならチェック実施日時を基準に最新1件を返す。 */
export function selectLatestReview19Data(
  records: readonly Review19Result[],
): Review19Result | null {
  return selectAllReview19Data(records).at(-1) ?? null;
}

export function buildAllReview19DataExportPayload(params: {
  records: readonly Review19Result[];
  exportedAt: string;
  demandCycle?: DemandCycle;
}) {
  const records = selectAllReview19Data(params.records).filter(
    (record) =>
      !params.demandCycle ||
      normalizeDemandCycle(record.demandCycle) === params.demandCycle,
  );
  return withDemandCycleExportFilter(buildReview19ExportPayload({
    records,
    exportedAt: params.exportedAt,
  }), params.demandCycle);
}

export function buildAllReview19DataExportPayloadsByDemandCycle(params: {
  records: readonly Review19Result[];
  exportedAt: string;
}) {
  return DEMAND_CYCLES.flatMap((demandCycle) => {
    const payload = buildAllReview19DataExportPayload({ ...params, demandCycle });
    return payload.count > 0 ? [{ demandCycle, payload }] : [];
  });
}

export function buildLatestReview19DataExportPayload(params: {
  records: readonly Review19Result[];
  exportedAt: string;
}) {
  const latest = selectLatestReview19Data(params.records);
  return latest
    ? buildReview19ExportPayload({
        records: [latest],
        exportedAt: params.exportedAt,
      })
    : null;
}

export type FinalizedDayDataExportPayload = {
  format: "nebiki-helper-day-data-export";
  version: 1;
  dataSchemaVersion: number;
  appVersion: string;
  buildId: string;
  exportedAt: string;
  exportFilter?: DemandCycleExportFilter;
  count: number;
  dataQuality: {
    completeDayCount: number;
    incompleteDayCount: number;
    incompleteDates: string[];
  };
  records: StoredFinalizedDayData[];
};

/** 確定済み1日データだけの全件payload。19:00チェック配列は持たない。 */
export function buildAllFinalizedDayDataExportPayload(params: {
  records: readonly FinalizedDayData[];
  exportedAt: string;
  demandCycle?: DemandCycle;
}): FinalizedDayDataExportPayload {
  const records = selectAllFinalizedDayData(params.records)
    .filter(
      (record) =>
        !params.demandCycle ||
        normalizeDemandCycle(record.demandCycle) === params.demandCycle,
    )
    .map(materializeReview19DaySnapshotHumanEvaluationsForExport);
  const incompleteDates = records
    .filter(
      (record) =>
        !buildAutomaticDayExportDataQuality({
          date: record.date,
          daySnapshot: record,
        }).complete,
    )
    .map((record) => record.date);

  return {
    format: "nebiki-helper-day-data-export",
    version: 1,
    ...getCurrentDataVersionInfo(),
    exportedAt: params.exportedAt,
    ...(params.demandCycle
      ? { exportFilter: { demandCycle: params.demandCycle } }
      : {}),
    count: records.length,
    dataQuality: {
      completeDayCount: records.length - incompleteDates.length,
      incompleteDayCount: incompleteDates.length,
      incompleteDates,
    },
    records,
  };
}

export function buildAllFinalizedDayDataExportPayloadsByDemandCycle(params: {
  records: readonly FinalizedDayData[];
  exportedAt: string;
}): Array<DemandCycleExportBundle<FinalizedDayDataExportPayload>> {
  return DEMAND_CYCLES.flatMap((demandCycle) => {
    const payload = buildAllFinalizedDayDataExportPayload({
      ...params,
      demandCycle,
    });
    return payload.count > 0 ? [{ demandCycle, payload }] : [];
  });
}

function formatJstExportTimestamp(exportedAt: string): string | null {
  const date = new Date(exportedAt);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  return year && month && day && hour && minute
    ? `${year}${month}${day}-${hour}${minute}`
    : null;
}

export function getDemandCycleAllExportFilename(params: {
  dataKind: "review19" | "daily";
  demandCycle: DemandCycle;
  exportedAt: string;
}): string {
  const timestamp = formatJstExportTimestamp(params.exportedAt);
  const suffix = timestamp ? `-${timestamp}` : "";
  return `nebiki-${params.dataKind}-${params.demandCycle}${suffix}.json`;
}

/** 設定の最新出力と20:30完了画面の直接出力で共有する1件payload。 */
export function buildLatestFinalizedDayDataExportPayload(params: {
  records: readonly FinalizedDayData[];
  exportedAt: string;
}) {
  const latest = selectLatestFinalizedDayData(params.records);
  return latest
    ? buildAutomaticDayExportPayload({
        exportedAt: params.exportedAt,
        date: latest.date,
        daySnapshot: latest,
      })
    : null;
}

/** 検索を行わず、画面遷移直前に確定した1件をそのまま包む。 */
export function buildDirectFinalizedDayDataExportPayload(params: {
  record: FinalizedDayData;
  exportedAt: string;
}) {
  return buildAutomaticDayExportPayload({
    exportedAt: params.exportedAt,
    date: params.record.date,
    daySnapshot: params.record,
  });
}

/** 検索を行わず、19:00チェック完了直前に確定した1件をそのまま包む。 */
export function buildDirectReview19DataExportPayload(params: {
  record: Review19Result;
  exportedAt: string;
}) {
  return buildReview19ExportPayload({
    records: [params.record],
    exportedAt: params.exportedAt,
  });
}
