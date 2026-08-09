import {
  buildAutomaticDayExportDataQuality,
  buildAutomaticDayExportPayload,
} from "./dayExport.ts";
import { getCurrentDataVersionInfo } from "./dataVersion.ts";
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
import type { Review19Result } from "./types.ts";

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
}) {
  return buildReview19ExportPayload({
    records: selectAllReview19Data(params.records),
    exportedAt: params.exportedAt,
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
}): FinalizedDayDataExportPayload {
  const records = selectAllFinalizedDayData(params.records).map(
    materializeReview19DaySnapshotHumanEvaluationsForExport,
  );
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
    count: records.length,
    dataQuality: {
      completeDayCount: records.length - incompleteDates.length,
      incompleteDayCount: incompleteDates.length,
      incompleteDates,
    },
    records,
  };
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
