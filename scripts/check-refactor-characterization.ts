import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { buildAllDataExportPayload } from "../src/domain/allDataExport.ts";
import { buildAutomaticDayExportPayload } from "../src/domain/dayExport.ts";
import { getEarlyNextMinus5TargetDiscountTime } from "../src/domain/earlyNextMinus5.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import { buildNormalRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import {
  buildReview19ExportPayload,
  createInitialReview19Result,
} from "../src/domain/review19.ts";
import type { Review19DaySnapshot } from "../src/domain/types.ts";
import {
  getNextDoneDiscountInfo,
  resolveDiscountTime,
} from "../src/hooks/nebikiApp/clock.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new MemoryStorage(),
});

function assertPublicHookContract(): void {
  function Probe() {
    const captured = useNebikiApp({ testNow: new Date(2026, 6, 21, 15, 0, 0) });
    assert.deepEqual(Object.keys(captured), ["state", "derived", "actions"]);
    assert.deepEqual(Object.keys(captured.state), [
      "screen",
      "session",
      "sessionDraft",
      "areaProgressMap",
      "normalFlowOrder",
      "currentAreaId",
      "lastReferenceAreaId",
      "currentFlow",
      "pendingDeferredAreaIds",
      "timeSwitchNotice",
      "finalTimeStep",
      "review19",
      "review19ExcludedAreaIds",
      "areaCountCorrection",
      "finalizedDayRecordId",
    ]);
    assert.deepEqual(Object.keys(captured.derived), [
      "currentAreaName",
      "weekdayText",
      "timeText",
      "basisGuide",
      "weatherGuideText",
      "rateDisplay",
      "finalGuide",
      "pendingBanner",
      "timeSwitchNotice",
      "lateSkipNotice",
      "showAfterRainRecoverySelector",
      "showBentoJudgeGuide",
      "areaCountAssistEnabled",
      "areaCountSameItemLimit",
      "showDailyNoticeBeforeRate",
      "showDayBeforeHolidayNotice",
      "showThreeDayHolidayMiddleNotice",
      "showHolidayBeforeNormalWeekdayNotice",
      "weatherConfirmationPending",
      "weatherCorrectionRequestId",
      "areaJudgeSelection",
      "isResuming",
      "startButtonLabel",
      "canUndo",
      "undoNotice",
      "canChooseSkipTarget",
      "skipTargetOptions",
      "doneSummaryItems",
      "doneNextSessionInfo",
      "review19Items",
      "review19ReferenceLines",
      "editableAreaCounts",
      "finalizedDayMemo",
      "previousDayDiscardTarget",
      "dataExport",
      "allDataExport",
      "cloudSync",
      "canStartReview19Manually",
      "demandCycle",
      "demandCycleLabel",
      "demandCycleBasisLabel",
      "canChangeDemandCycle",
      "demandCycleChangeBlockedReason",
    ]);
    assert.deepEqual(Object.keys(captured.actions), [
      "updateSessionDraft",
      "startSession",
      "requestWeatherConfirmation",
      "editWeatherInput",
      "confirmWeatherInput",
      "goBackOneScreen",
      "startEditingConditions",
      "undoLastAction",
      "markBentoJudgeGuideShown",
      "confirmDailyNotice",
      "judgeCurrentArea",
      "getCurrentAreaCountRecommendation",
      "skipCurrentArea",
      "chooseSkipTargetArea",
      "goToNextArea",
      "startAutoSkippedAreaCountOnly",
      "saveAutoSkippedAreaCount",
      "skipAutoSkippedAreaWithoutMeasurement",
      "processAutoSkippedAreaNormally",
      "advanceFinalTimeStep",
      "updateReview19AreaCount",
      "skipReview19Area",
      "startReview19AfterWeather",
      "saveReview19",
      "startAreaCountCorrection",
      "saveFinalizedDayMemo",
      "savePreviousDayDiscardCount",
      "exportAllReview19Data",
      "exportLatestReview19Data",
      "exportAllDailyData",
      "exportLatestDailyData",
      "exportCompletedReview19Data",
      "exportCompletedDailyData",
      "start19DiscountAfterReview",
      "startNextDoneSession",
      "exportAllData",
      "syncLocalDataToSupabase",
      "startReview19Manually",
      "resetApp",
      "changeDemandCycle",
    ]);
    assert.equal(captured.state.screen, "start");
    assert.equal(captured.state.sessionDraft.discountTime, "15");
    return createElement("span", null, "probe");
  }

  assert.equal(renderToString(createElement(Probe)), "<span>probe</span>");
}

function assertFacadeBodyIsUnchanged(): void {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const source = readFileSync(`${projectRoot}/src/hooks/useNebikiApp.ts`, "utf8")
    .replaceAll("\r\n", "\n");
  const body = source.slice(source.indexOf("export function useNebikiApp"));

  assert.equal(body.length, 147959);
  assert.equal(
    createHash("sha256").update(body).digest("hex"),
    "d55bf14ca9ce7fcdfb0583979bfba0c162790a3b5e03a37a2ae89b5eeb2b2243",
  );
  assert.equal([...body.matchAll(/\buseEffect\(\(\) =>/g)].length, 22);
  assert.equal([...body.matchAll(/window\.setInterval\(/g)].length, 2);
}

function assertTimeBoundaries(): void {
  const at = (hour: number, minute: number) => new Date(2026, 6, 21, hour, minute, 0, 0);

  for (const [hour, minute, expected] of [
    [16, 39, "15"],
    [16, 40, "17"],
    [18, 24, "17"],
    [18, 25, "18"],
    [19, 24, "18"],
    [19, 25, "19"],
    [20, 24, "19"],
    [20, 25, "20"],
  ] as const) {
    assert.equal(resolveDiscountTime(at(hour, minute)), expected);
  }

  for (const [discountTime, hour, minute, canStart, target] of [
    ["15", 16, 39, false, "17"],
    ["15", 16, 40, true, "17"],
    ["17", 18, 24, false, "18"],
    ["17", 18, 25, true, "18"],
    ["18", 19, 24, false, "19"],
    ["18", 19, 25, true, "19"],
    ["19", 20, 24, false, "20"],
    ["19", 20, 25, true, "20"],
  ] as const) {
    const info = getNextDoneDiscountInfo(discountTime, at(hour, minute));
    assert.equal(info?.canStart, canStart);
    assert.equal(info?.targetDiscountTime, target);
  }

  for (const [discountTime, hour, minute, expected] of [
    ["17", 18, 0, "18"],
    ["17", 18, 24, "18"],
    ["17", 18, 25, null],
    ["18", 19, 0, "19"],
    ["18", 19, 24, "19"],
    ["18", 19, 25, null],
  ] as const) {
    assert.equal(
      getEarlyNextMinus5TargetDiscountTime({
        discountTime,
        manualDiscountTimeOverride: false,
        nowMs: at(hour, minute).getTime(),
      }),
      expected,
    );
  }
}

function assertExportJsonCharacterization(): void {
  const weather = {
    hourlyForecasts: createDefaultHourlyForecasts(),
    afterRainSky: null,
  };
  weather.hourlyForecasts["19"] = { weather: "rain", tempC: 12, windMs: 5 };
  const resolved = resolveWeatherInputForDiscount(weather, "18");
  const rate = buildNormalRateDecisionSnapshot({
    confirmedAt: "2026-07-21T09:50:00.000Z",
    sessionDiscountTime: "18",
    weatherComfortAdjustmentPercent: 10,
    areaJudge: "many",
    areaRateAdjustment: 5,
    resolvedWeather: resolved,
    weekday: 2,
    date: "2026-07-21",
  });
  const measured = {
    dataSchemaVersion: 3,
    appVersion: "fixture-app",
    buildId: "fixture-build",
    areaId: "bento_men",
    areaName: "bento",
    status: "completed",
    areaJudge: "many",
    areaCount: 12,
    areaCountEvaluation: "many",
    areaCountEvaluationSource: "history",
    areaRateAdjustment: 5,
    judgeText: "many",
    rateText: rate.displayedRateText,
    ratePercent: rate.displayedRatePercent,
    manyRateText: `${rate.displayedManyRatePercent}%`,
    manyRatePercent: rate.displayedManyRatePercent,
    normalRateText: `${rate.displayedNormalRatePercent}%`,
    normalRatePercent: rate.displayedNormalRatePercent,
    completedAt: rate.confirmedAt,
    rateDecisionSnapshot: rate,
    rateDecisionSnapshotStatus: "captured",
    measurementStatus: "measured",
    measurementRecordedAt: "2026-07-21T09:49:00.000Z",
    rateOrigin: "confirmed_now",
  };
  const missing = {
    areaId: "tempura",
    areaName: "tempura",
    status: "auto_skipped_late_time",
    areaJudge: null,
    judgeText: "early",
    rateText: "30%",
    ratePercent: 30,
    rateDecisionSnapshotStatus: "legacy_not_captured",
    measurementStatus: "not_measured",
    missingReason: "early_next_minus5_skipped",
    autoSkipKind: "early_next_minus5",
    sourceDiscountTime: "17",
    sourceSessionStartedAt: "2026-07-21T08:00:00.000Z",
    earlyDiscountCompletedAt: "2026-07-21T09:00:00.000Z",
    skipAcknowledgedAt: "2026-07-21T09:51:00.000Z",
    rateOrigin: "carried_from_early_discount",
  };
  const session = {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: "fixture-app",
    buildId: "fixture-build",
    capturedAt: "2026-07-21T09:55:00.000Z",
    basisCapturedAt: "2026-07-21T09:55:00.000Z",
    sessionEndReason: "completed",
    rateLogicVersion: "time_basic_rate_v1",
    screen: "done",
    session: {
      dataSchemaVersion: 3,
      appVersion: "fixture-app",
      buildId: "fixture-build",
      date: "2026-07-21",
      weekday: 2,
      discountTime: "18",
      startedAt: "2026-07-21T09:30:00.000Z",
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather,
      resolvedWeather: resolved,
    },
    basis: {
      rateLogicVersion: "time_basic_rate_v1",
      baseRateBonus: 10,
      lateTimeBonus: 0,
      totalRateBonus: 10,
      baseRateBonusReason: ["fixture-rain"],
      weekdaySummaryText: "fixture-basis",
    },
    areas: { bento_men: measured, tempura: missing },
    doneSummaryItems: [{
      areaId: "bento_men",
      areaName: "bento",
      judgeText: "many",
      rateText: rate.displayedRateText,
    }],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  };
  const day = {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: "fixture-app",
    buildId: "fixture-build",
    capturedAt: "2026-07-21T11:30:00.000Z",
    date: "2026-07-21",
    rateLogicVersion: "time_basic_rate_v1",
    review19Status: "recorded",
    sessions: [session],
    areaCountRecords: [{
      dataSchemaVersion: 3,
      appVersion: "fixture-app",
      buildId: "fixture-build",
      date: "2026-07-21",
      sessionStartedAt: "2026-07-21T09:30:00.000Z",
      recordedAt: "2026-07-21T09:49:00.000Z",
      areaId: "bento_men",
      discountTime: "18",
      actualWeekday: "火",
      actualWeekdayGroup: "火木日",
      count: 12,
    }],
  } as unknown as Review19DaySnapshot;
  const review = createInitialReview19Result({
    date: "2026-07-22",
    sessionStartedAt: "2026-07-22T08:00:00.000Z",
  });
  review.recordedAt = "2026-07-22T10:00:00.000Z";
  review.areaCounts = { bento_men: 8 };
  review.areaCountRecordedAt = { bento_men: "2026-07-22T09:59:00.000Z" };
  const duplicate = {
    ...review,
    date: "2026-07-21",
    recordedAt: "2026-07-21T10:00:00.000Z",
  };
  const bundle = {
    automatic: buildAutomaticDayExportPayload({
      exportedAt: "2026-07-21T12:00:00.000Z",
      date: "2026-07-21",
      daySnapshot: day,
    }),
    review: buildReview19ExportPayload({
      records: [review],
      exportedAt: "2026-07-22T12:00:00.000Z",
    }),
    all: buildAllDataExportPayload({
      dailyData: [day],
      review19Data: [duplicate, review],
      exportedAt: "2026-07-22T12:00:00.000Z",
      versionInfo: {
        dataSchemaVersion: 3,
        appVersion: "fixture-app",
        buildId: "fixture-build",
      },
    }),
  };
  const json = JSON.stringify(bundle, (key, value) =>
    key === "appVersion"
      ? "<appVersion>"
      : key === "buildId"
        ? "<buildId>"
        : value
  );

  assert.equal(json.length, 34742);
  assert.equal(
    createHash("sha256").update(json).digest("hex"),
    "f43b1708f17e37ba1d3ab32bd9bfa0786b67d7a36dc65db272a1c8f108d282a4",
  );
  assert.deepEqual(Object.keys(bundle.automatic), [
    "format",
    "version",
    "dataSchemaVersion",
    "appVersion",
    "buildId",
    "exportedAt",
    "date",
    "trigger",
    "dataQuality",
    "daySnapshot",
  ]);
  assert.deepEqual(Object.keys(bundle.review), [
    "format",
    "version",
    "dataSchemaVersion",
    "appVersion",
    "buildId",
    "exportedAt",
    "count",
    "dataQuality",
    "records",
  ]);
  assert.deepEqual(Object.keys(bundle.all), [
    "exportType",
    "version",
    "dataSchemaVersion",
    "appVersion",
    "buildId",
    "exportedAt",
    "dailyData",
    "review19Data",
    "dataQuality",
  ]);
}

assertPublicHookContract();
assertFacadeBodyIsUnchanged();
assertTimeBoundaries();
assertExportJsonCharacterization();

console.log("refactor characterization checks passed");
