import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildAllDataExportPayload,
  getAllDataExportFilename,
  isValidJstDateString,
} from "../src/domain/allDataExport.ts";
import {
  buildRemoteAreaCountRow,
  buildRemoteAreaCountWriteAttempts,
  normalizeRemoteAreaCountRows,
} from "../src/domain/areaCountRemoteStorage.ts";
import type { AreaCountRecord } from "../src/domain/areaCountHistory.ts";
import {
  buildHourlyForecastsFromLegacy,
  createDefaultHourlyForecasts,
  FORECAST_HOUR_KEYS,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import type { Review19DaySnapshot, Review19Result } from "../src/domain/types.ts";

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`OK: ${name}`);
  } catch (error) {
    console.error(`NG: ${name}`);
    throw error;
  }
}

function makeDaily(date: string, capturedAt: string): Review19DaySnapshot {
  return {
    version: 1,
    capturedAt,
    date,
    review19Status: "not_performed",
    sessions: [],
    areaCountRecords: [],
  } as Review19DaySnapshot;
}

function makeReview(params: {
  date: string;
  recordedAt: string;
  status?: "recorded" | "not_applicable";
}): Review19Result {
  return {
    review19Status: params.status ?? "recorded",
    date: params.date,
    sessionStartedAt: params.recordedAt,
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCountRecordedAt: {},
    areaCounts: {},
    excludedAreaIds: [],
    excludeReasons: {},
    dataQuality: {
      expectedAreaCount: 0,
      recordedAreaCount: 0,
      excludedAreaCount: 0,
      missingAreaIds: [],
      duplicateAreaIds: [],
      complete: true,
      processComplete: true,
      measurementComplete: true,
      notMeasuredAreaIds: [],
      missingReasons: {},
    },
    recordedAt: params.recordedAt,
  };
}

test("天候入力キーは16〜21時だけ", () => {
  assert.deepEqual(FORECAST_HOUR_KEYS, ["16", "17", "18", "19", "20", "21"]);
  assert.deepEqual(Object.keys(createDefaultHourlyForecasts()), FORECAST_HOUR_KEYS);
});

test("旧15時天候値はlegacy変換結果へ持ち込まない", () => {
  const forecasts = buildHourlyForecastsFromLegacy({
    discountTime: "15",
    legacyWeather: {
      hourlyForecasts: {
        "15": { weather: "rain", tempC: -5, windMs: 15 },
      },
      nearTermWeather: "other",
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(forecasts, "15"), false);
  assert.deepEqual(Object.keys(forecasts), FORECAST_HOUR_KEYS);
});

test("15時セッションは16時以降の天候で従来どおり計算する", () => {
  const hourlyForecasts = createDefaultHourlyForecasts();
  hourlyForecasts["16"].weather = "rain";
  hourlyForecasts["17"].weather = "rain";
  const resolved = resolveWeatherInputForDiscount(
    { hourlyForecasts, afterRainSky: null },
    "15",
  );
  assert.equal(resolved.nearTermWeather, "rain");
  assert.equal(resolved.precipitationRateBonus, 10);
});

test("JSTの実在日だけを受理する", () => {
  assert.equal(isValidJstDateString("2026-07-21"), true);
  assert.equal(isValidJstDateString("2024-02-29"), true);
  assert.equal(isValidJstDateString("2026-02-29"), false);
  assert.equal(isValidJstDateString("2026-7-21"), false);
});

test("統合出力は日次を優先し対象外・不正日付・同日重複を品質へ分離する", () => {
  const olderDaily = makeDaily("2026-07-21", "2026-07-21T10:00:00+09:00");
  const latestDaily = makeDaily("2026-07-21", "2026-07-21T23:00:00+09:00");
  (latestDaily as unknown as { legacy: { hourlyForecasts: Record<string, unknown> } }).legacy = {
    hourlyForecasts: {
      "15": { weather: "rain" },
      "16": { weather: "sunny" },
    },
  };
  const payload = buildAllDataExportPayload({
    dailyData: [olderDaily, latestDaily, makeDaily("2026-02-29", "invalid")],
    review19Data: [
      makeReview({ date: "2026-07-21", recordedAt: "2026-07-21T19:00:00+09:00" }),
      makeReview({ date: "2026-07-22", recordedAt: "2026-07-22T19:00:00+09:00" }),
      makeReview({ date: "2026-07-22", recordedAt: "2026-07-22T20:00:00+09:00" }),
      makeReview({
        date: "2026-07-23",
        recordedAt: "2026-07-23T19:00:00+09:00",
        status: "not_applicable",
      }),
      makeReview({ date: "not-a-date", recordedAt: "2026-07-24T19:00:00+09:00" }),
    ],
    exportedAt: "2026-07-24T12:00:00+09:00",
    versionInfo: {
      dataSchemaVersion: 2,
      appVersion: "test",
      buildId: "build-test",
    },
  });

  assert.equal(payload.exportType, "nebiki-helper-all-data-export");
  assert.equal(payload.buildId, "build-test");
  assert.deepEqual(payload.dailyData.map((item) => item.date), ["2026-07-21"]);
  assert.equal(payload.dailyData[0].capturedAt, latestDaily.capturedAt);
  const exportedLegacyForecasts = (
    payload.dailyData[0] as unknown as {
      legacy: { hourlyForecasts: Record<string, unknown> };
    }
  ).legacy.hourlyForecasts;
  assert.equal(Object.prototype.hasOwnProperty.call(exportedLegacyForecasts, "15"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exportedLegacyForecasts, "16"), true);
  assert.deepEqual(payload.review19Data.map((item) => item.date), ["2026-07-22"]);
  assert.equal(payload.review19Data[0].recordedAt, "2026-07-22T20:00:00+09:00");
  assert.deepEqual(payload.dataQuality.excludedDuplicateDates, ["2026-07-21"]);
  assert.equal(payload.dataQuality.excludedDuplicateReview19Count, 1);
  assert.equal(payload.dataQuality.excludedNotApplicableCount, 1);
  assert.equal(payload.dataQuality.duplicateDailyDateCount, 1);
  assert.equal(payload.dataQuality.duplicateReview19DateCount, 1);
  assert.equal(payload.dataQuality.indeterminateCount, 2);
  assert.equal(payload.dataQuality.dayCount, 2);
});

test("統合出力ファイル名はexportedAtのJST日付を使う", () => {
  assert.equal(
    getAllDataExportFilename("2026-07-20T15:30:00.000Z"),
    "nebiki-all-data-2026-07-21.json",
  );
  assert.equal(getAllDataExportFilename("invalid"), "nebiki-all-data.json");
});

test("Supabase送信行は保持列とbuild_idだけ", () => {
  const record: AreaCountRecord = {
    dataSchemaVersion: 2,
    appVersion: "test",
    buildId: "build-test",
    date: "2026-07-21",
    sessionStartedAt: "2026-07-21T17:00:00+09:00",
    recordedAt: "2026-07-21T17:10:00+09:00",
    areaId: "bento_men",
    discountTime: "17",
    weekdayBase: "火木",
    actualWeekday: "火",
    actualWeekdayGroup: "火木日",
    count: 12,
    userJudge: "many",
    suggestedEvaluation: "many",
    areaRateAdjustment: 10,
    evaluationSource: "manual",
    comfortPoint: 3,
  };
  const row = buildRemoteAreaCountRow(record);
  assert.deepEqual(Object.keys(row).sort(), [
    "actual_weekday",
    "actual_weekday_group",
    "app_version",
    "area_id",
    "build_id",
    "count",
    "data_schema_version",
    "date",
    "discount_time",
    "recorded_at",
    "session_started_at",
  ]);
  assert.equal(row.build_id, "build-test");
  const [primary, preBuildIdFallback] = buildRemoteAreaCountWriteAttempts(record);
  assert.equal(primary.build_id, "build-test");
  assert.equal(Object.prototype.hasOwnProperty.call(preBuildIdFallback, "build_id"), false);
  assert.deepEqual(
    Object.keys(preBuildIdFallback).sort(),
    Object.keys(primary).filter((key) => key !== "build_id").sort(),
  );
});

test("Supabase旧行は削除済み列を無視して読み込む", () => {
  const [record] = normalizeRemoteAreaCountRows([{
    data_schema_version: 2,
    app_version: "old",
    build_id: "old-build",
    date: "2026-07-21",
    session_started_at: "2026-07-21T17:00:00+09:00",
    recorded_at: "2026-07-21T17:10:00+09:00",
    area_id: "bento_men",
    discount_time: "17",
    actual_weekday: "火",
    actual_weekday_group: "火木日",
    count: 12,
    weekday_base: "火木",
    user_judge: "many",
    decision_basis: { legacy: true },
  }]);
  assert.equal(record?.count, 12);
  assert.equal(record?.buildId, "old-build");
});

test("SQL成果物はスリム列・backup・migration・verify・rollbackを備える", () => {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const read = (name: string) =>
    readFileSync(`${projectRoot}/${name}`, "utf8");
  const canonical = read("supabase_area_count_records.sql");
  const migration = read("supabase_area_count_records_migration.sql");
  const backup = read("supabase_area_count_records_backup.sql");
  const verify = read("supabase_area_count_records_verify.sql");
  const rollback = read("supabase_area_count_records_rollback.sql");

  assert.match(canonical, /build_id text/);
  for (const removed of [
    "weekday_base",
    "comfort_point",
    "user_judge",
    "suggested_evaluation",
    "area_rate_adjustment",
    "evaluation_source",
    "decision_basis",
  ]) {
    assert.doesNotMatch(canonical, new RegExp(`\\b${removed}\\b`));
    assert.match(migration, new RegExp(`drop column if exists ${removed}`));
  }
  assert.match(backup, /area_count_records_backup_20260724/);
  assert.match(verify, /retained column data differs from backup/);
  assert.match(rollback, /drop column if exists build_id/);
  assert.match(canonical, /id bigint generated by default as identity primary key/);
});

console.log("data export / weather / Supabase checks passed");
