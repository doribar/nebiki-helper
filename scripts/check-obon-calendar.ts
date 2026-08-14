import assert from "node:assert/strict";
import {
  buildDayAnalysisCalendarContext,
  buildSessionAnalysisCalendarContext,
  normalizeAnalysisCalendarContext,
  type AnalysisCalendarContext,
} from "../src/domain/analysisMetadata.ts";
import {
  getActualWeekdayGroup,
  getActualWeekdayLabel,
  getAreaCountComparisonWeekdayGroup,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  normalizeAreaCountRecords,
  shouldForceAreaCountFallbackWeekdayGroup,
  type AreaCountDecisionBasis,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import {
  buildRemoteAreaCountRow,
  normalizeRemoteAreaCountRows,
} from "../src/domain/areaCountRemoteStorage.ts";
import { collectAreaCountBackfillRecords } from "../src/domain/areaCountBackfill.ts";
import {
  buildRemoteReview19Row,
  normalizeRemoteReview19Row,
} from "../src/domain/review19RemoteStorage.ts";
import { buildReview19AutomaticEvaluation } from "../src/domain/review19Evaluation.ts";
import { createReview19Reference } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialSessionDraft } from "../src/hooks/nebikiApp/stateNormalization.ts";
import {
  isDayBeforeJapaneseHoliday,
  isJapaneseHolidayOrObserved,
  isObonDate,
  isThreeDayHolidayMiddle,
} from "../src/domain/japaneseHoliday.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import { supportsObonCalendarRule } from "../src/domain/obon.ts";
import {
  buildAllFinalizedDayDataExportPayloadsByDemandCycle,
  buildAllReview19DataExportPayloadsByDemandCycle,
} from "../src/domain/separateDataExport.ts";
import {
  getBasisGuideDisplay,
  getIndividualAmountReferenceContext,
} from "../src/domain/weekdayBase.ts";
import type {
  DemandCycle,
  DiscountTime,
  Review19DaySnapshot,
  Review19Result,
} from "../src/domain/types.ts";

type TestEntry = { name: string; run: () => void };
const tests: TestEntry[] = [];

function test(name: string, run: TestEntry["run"]): void {
  tests.push({ name, run });
}

const SESSION_STARTED_AT = "2026-08-13T15:00:00+09:00";

function buildCalendar(date: string, options?: {
  weekday?: number;
  discountTime?: DiscountTime;
  manualWeekdayOverride?: boolean;
  applyObonRule?: boolean;
}): AnalysisCalendarContext {
  const context = buildSessionAnalysisCalendarContext({
    date,
    weekday: options?.weekday ?? 4,
    discountTime: options?.discountTime ?? "17",
    sessionStartedAt: SESSION_STARTED_AT,
    manualWeekdayOverride: options?.manualWeekdayOverride ?? false,
    applyObonRule: options?.applyObonRule,
    areaDecisionBases: [],
  });
  assert.ok(context);
  return context;
}

function makeReview(
  date: string,
  demandCycle: DemandCycle,
  calendarContext: AnalysisCalendarContext,
): Review19Result {
  return {
    dataSchemaVersion: 3,
    appVersion: "obon-test",
    buildId: "build-obon-test",
    review19Status: "recorded",
    date,
    demandCycle,
    calendarContext,
    sessionStartedAt: `${date}T18:30:00+09:00`,
    reviewCompletedAt: `${date}T19:10:00+09:00`,
    recordedAt: `${date}T19:11:00+09:00`,
    areaCountRecordedAt: {},
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCounts: {},
    areaEvaluations: {},
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
      humanEvaluationComplete: true,
      humanEvaluationRecordedAreaCount: 0,
      missingHumanEvaluationAreaIds: [],
    },
  };
}

function makeDay(
  date: string,
  demandCycle: DemandCycle,
  calendarContext: AnalysisCalendarContext,
): Review19DaySnapshot {
  return {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: "obon-test",
    buildId: "build-obon-test",
    capturedAt: `${date}T20:35:00+09:00`,
    date,
    demandCycle,
    calendarContext,
    review19Status: "not_performed",
    sessions: [],
    areaCountRecords: [],
  };
}

function makeLegacyDecisionBasis(): AreaCountDecisionBasis {
  return {
    ruleVersion: "area_count_median_v1",
    demandCycle: "summer",
    evaluationSource: "history",
    recommendationStatus: "ready",
    actualWeekday: getActualWeekdayLabel(4),
    actualWeekdayGroup: getActualWeekdayGroup(4, "17"),
    comparisonMode: "weekday",
    sampleSize: 3,
    requiredSampleSize: 3,
    medianCount: 20,
    baseEvaluation: "normal",
    finalEvaluation: "normal",
    areaRateAdjustment: 0,
  };
}

function makeLegacyOrdinaryContext(): AnalysisCalendarContext {
  const capturedBeforeRule = buildSessionAnalysisCalendarContext({
    date: "2026-08-20",
    weekday: 4,
    discountTime: "17",
    sessionStartedAt: SESSION_STARTED_AT,
    manualWeekdayOverride: false,
    applyObonRule: false,
    areaDecisionBases: [
      { areaId: "bento_men", basis: makeLegacyDecisionBasis() },
    ],
  });
  assert.ok(capturedBeforeRule);
  const legacy: AnalysisCalendarContext = {
    ...capturedBeforeRule,
    date: "2026-08-13",
    actualWeekday: getActualWeekdayLabel(4),
    isHoliday: false,
    isDayBeforeHoliday: false,
    calendarCondition: "ordinary",
  };
  delete legacy.isObon;
  return legacy;
}

test("お盆は毎年8月13日から16日だけ", () => {
  assert.equal(isObonDate("2026-08-12"), false);
  assert.equal(isObonDate("2026-08-13"), true);
  assert.equal(isObonDate("2026-08-14"), true);
  assert.equal(isObonDate("2026-08-15"), true);
  assert.equal(isObonDate("2026-08-16"), true);
  assert.equal(isObonDate("2026-08-17"), false);
  assert.equal(isObonDate("2027-08-13"), true);
  assert.equal(isObonDate("2027-08-16"), true);
  assert.equal(isObonDate("invalid"), false);
  assert.equal(isJapaneseHolidayOrObserved("2026-08-13"), false);
});

test("新規お盆sessionはholidayと分離したcalendar factを保持", () => {
  for (const date of ["2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"]) {
    const context = buildCalendar(date);
    assert.equal(context.isObon, true);
    assert.equal(context.isHoliday, false);
    assert.equal(context.calendarCondition, "obon");
  }
  const ordinary = buildCalendar("2026-08-17", { weekday: 1 });
  assert.equal(ordinary.isObon, false);
  assert.equal(ordinary.calendarCondition, "ordinary");
});

test("旧session gateは8月13日でも当時の通常曜日基準を維持", () => {
  assert.equal(supportsObonCalendarRule("2026.8.9-5"), false);
  assert.equal(supportsObonCalendarRule("2026.8.9-6"), true);
  const legacySession = buildCalendar("2026-08-13", {
    weekday: 4,
    applyObonRule: false,
  });
  assert.equal(legacySession.calendarCondition, "ordinary");
  assert.equal(legacySession.isObon, undefined);
  assert.equal(
    legacySession.individualAmountReference[0]?.kind,
    "actual_weekday",
  );
  assert.equal(
    legacySession.individualAmountReference[0]?.referenceWeekday,
    4,
  );
});

test("旧session由来の19時referenceもお盆基準へ遡及変更しない", () => {
  const draft = {
    ...createInitialSessionDraft(),
    date: "2026-08-13",
    weekday: 4,
    discountTime: "19" as const,
  };
  const legacyReference = createReview19Reference(draft, undefined, false);
  assert.equal(legacyReference.calendarContext?.calendarCondition, "ordinary");
  assert.notEqual(legacyReference.calendarContext?.isObon, true);
  assert.equal(
    legacyReference.calendarContext?.individualAmountReference[0]?.referenceWeekday,
    4,
  );

  const currentReference = createReview19Reference(draft, undefined, true);
  assert.equal(currentReference.calendarContext?.calendarCondition, "obon");
  assert.equal(currentReference.calendarContext?.isObon, true);
  assert.equal(
    currentReference.calendarContext?.individualAmountReference[0]?.referenceWeekday,
    0,
  );
});

test("お盆の個別量referenceは祝日当日と同じでreasonだけ識別可能", () => {
  const obon = getIndividualAmountReferenceContext({
    date: "2026-08-14",
    weekday: 5,
    discountTime: "17",
  });
  const holiday = getIndividualAmountReferenceContext({
    date: "2026-03-20",
    weekday: 5,
    discountTime: "17",
  });
  assert.deepEqual(
    {
      comparisonMode: obon.comparisonMode,
      referenceWeekday: obon.referenceWeekday,
      referenceWeekdayGroup: obon.referenceWeekdayGroup,
      referenceDiscountTime: obon.referenceDiscountTime,
    },
    {
      comparisonMode: holiday.comparisonMode,
      referenceWeekday: holiday.referenceWeekday,
      referenceWeekdayGroup: holiday.referenceWeekdayGroup,
      referenceDiscountTime: holiday.referenceDiscountTime,
    },
  );
  assert.equal(obon.kind, "obon");
  assert.equal(obon.reason, "obon");
  assert.equal(holiday.kind, "holiday");
  assert.equal(obon.referenceWeekday, 0);

  const guide = getBasisGuideDisplay({
    date: "2026-08-14",
    weekday: 5,
    discountTime: "17",
    weather: resolveWeatherInputForDiscount(
      {
        hourlyForecasts: createDefaultHourlyForecasts(),
        afterRainSky: null,
      },
      "17",
    ),
  });
  assert.equal(
    guide.noticeText,
    "今日はお盆のため、祝日と同じ基準になっています。",
  );
  assert.equal(guide.referenceText, "日曜日の17時を基準に考えて");
});

test("お盆のエリアreference選択は同曜日の祝日当日と同じ", () => {
  for (const discountTime of ["15", "17"] as const) {
    const obonParams = { weekday: 5, discountTime, date: "2026-08-14" };
    const holidayParams = { weekday: 5, discountTime, date: "2026-03-20" };
    assert.equal(
      getAreaCountFallbackWeekdayGroup(obonParams),
      getAreaCountFallbackWeekdayGroup(holidayParams),
    );
    assert.equal(
      getAreaCountComparisonWeekdayGroup(obonParams),
      getAreaCountComparisonWeekdayGroup(holidayParams),
    );
    assert.equal(
      shouldForceAreaCountFallbackWeekdayGroup(obonParams),
      shouldForceAreaCountFallbackWeekdayGroup(holidayParams),
    );
  }

  const referenceGroup = getAreaCountComparisonWeekdayGroup({
    weekday: 5,
    discountTime: "17",
    date: "2026-03-20",
  });
  const records: AreaCountRecord[] = [3, 10, 17].map((day, index) => ({
    dataSchemaVersion: 3,
    appVersion: "obon-test",
    buildId: "build-obon-test",
    demandCycle: "normal",
    date: `2025-12-${String(day).padStart(2, "0")}`,
    sessionStartedAt: `2025-12-${String(day).padStart(2, "0")}T17:00:00+09:00`,
    recordedAt: `2025-12-${String(day).padStart(2, "0")}T17:05:00+09:00`,
    areaId: "bento_men",
    discountTime: "17",
    actualWeekday: getActualWeekdayLabel(5),
    actualWeekdayGroup: referenceGroup,
    count: 20 + index * 2,
  }));
  const common = {
    records,
    areaId: "bento_men" as const,
    discountTime: "17" as const,
    weekday: 5,
    demandCycle: "normal" as const,
    count: 22,
  };
  const holiday = getAreaCountRecommendation({
    ...common,
    date: "2026-03-20",
  });
  const obon = getAreaCountRecommendation({
    ...common,
    date: "2026-08-14",
  });
  const restoredLegacy = getAreaCountRecommendation({
    ...common,
    date: "2026-08-14",
    applyObonRule: false,
  });
  assert.deepEqual(
    {
      status: obon.status,
      actualWeekdayGroup: obon.actualWeekdayGroup,
      comparisonMode: obon.comparisonMode,
      sampleSize: obon.sampleSize,
      medianCount: obon.medianCount,
      baseEvaluation: obon.baseEvaluation,
    },
    {
      status: holiday.status,
      actualWeekdayGroup: holiday.actualWeekdayGroup,
      comparisonMode: holiday.comparisonMode,
      sampleSize: holiday.sampleSize,
      medianCount: holiday.medianCount,
      baseEvaluation: holiday.baseEvaluation,
    },
  );
  assert.equal(obon.comparisonMode, "fallback_group");
  assert.equal(restoredLegacy.comparisonMode, "weekday");
});

test("お盆最終日の翌日平日referenceも祝日当日と同じ", () => {
  for (const discountTime of ["15", "17"] as const) {
    const obonParams = {
      weekday: 1,
      discountTime,
      date: "2027-08-16",
      applyObonRule: true,
    };
    const holidayParams = {
      weekday: 1,
      discountTime,
      date: "2026-07-20",
    };
    assert.equal(
      getAreaCountFallbackWeekdayGroup(obonParams),
      getAreaCountFallbackWeekdayGroup(holidayParams),
    );
    assert.equal(
      getAreaCountComparisonWeekdayGroup(obonParams),
      getAreaCountComparisonWeekdayGroup(holidayParams),
    );
    assert.equal(
      getAreaCountFallbackWeekdayGroup({
        ...obonParams,
        applyObonRule: false,
      }),
      "月水",
    );
  }

  const newRecord: AreaCountRecord = {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-6",
    buildId: "build-obon-rule",
    demandCycle: "normal",
    date: "2027-08-16",
    sessionStartedAt: "2027-08-16T17:00:00+09:00",
    recordedAt: "2027-08-16T17:05:00+09:00",
    areaId: "bento_men",
    discountTime: "17",
    actualWeekday: "月",
    actualWeekdayGroup: "月水",
    count: 20,
  };
  const oldRecord = { ...newRecord, appVersion: "2026.8.9-5" };
  assert.equal(
    normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(newRecord)])[0]
      ?.actualWeekdayGroup,
    "翌日平日祝日",
  );
  assert.equal(
    normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(oldRecord)])[0]
      ?.actualWeekdayGroup,
    "月水",
  );
});

test("復元した旧sessionの当時referenceは現行appVersion付きrecordでも不変", () => {
  for (const { date, weekday } of [
    { date: "2026-08-13", weekday: 4 },
    { date: "2026-08-16", weekday: 0 },
  ]) {
    const decisionBasis: AreaCountDecisionBasis = {
      ...makeLegacyDecisionBasis(),
      actualWeekday: getActualWeekdayLabel(weekday),
      actualWeekdayGroup: getActualWeekdayGroup(weekday, "17"),
    };
    const capturedContext = buildSessionAnalysisCalendarContext({
      date,
      weekday,
      discountTime: "17",
      sessionStartedAt: `${date}T17:00:00+09:00`,
      manualWeekdayOverride: false,
      applyObonRule: false,
      areaDecisionBases: [{ areaId: "bento_men", basis: decisionBasis }],
    });
    assert.ok(capturedContext);

    const normalized = normalizeAreaCountRecords([{
      dataSchemaVersion: 3,
      // A resumed legacy session saves through the new binary, so the record
      // version alone cannot identify which calendar rule was adopted.
      appVersion: "2026.8.9-6",
      buildId: "build-current-binary-restored-session",
      demandCycle: "summer",
      date,
      sessionStartedAt: `${date}T17:00:00+09:00`,
      recordedAt: `${date}T17:05:00+09:00`,
      areaId: "bento_men",
      discountTime: "17",
      actualWeekday: getActualWeekdayLabel(weekday),
      actualWeekdayGroup: getActualWeekdayGroup(weekday, "17"),
      calendarContext: capturedContext,
      count: 20,
      decisionBasis,
    }])[0];

    assert.ok(normalized);
    assert.equal(
      normalized.actualWeekdayGroup,
      getActualWeekdayGroup(weekday, "17"),
    );
    assert.equal(normalized.calendarContext?.calendarCondition, "ordinary");
    assert.notEqual(normalized.calendarContext?.isObon, true);
    assert.equal(
      normalized.calendarContext?.individualAmountReference[0]?.kind,
      "actual_weekday",
    );
    assert.equal(
      normalized.calendarContext?.areaCountReference[0]?.comparisonMode,
      "weekday",
    );
    assert.equal(
      normalized.calendarContext?.areaCountReference[0]?.reason,
      "same_weekday_history",
    );
  }
});

test("backfillもsnapshotの保存済みcalendar factを優先", () => {
  const collectSnapshot = (params: {
    date: string;
    weekday: number;
    applyObonRule: boolean;
    nestedAppVersion: string;
  }) => {
    const calendarContext = buildSessionAnalysisCalendarContext({
      date: params.date,
      weekday: params.weekday,
      discountTime: "17",
      sessionStartedAt: `${params.date}T17:00:00+09:00`,
      manualWeekdayOverride: false,
      applyObonRule: params.applyObonRule,
      areaDecisionBases: [],
    });
    assert.ok(calendarContext);
    return collectAreaCountBackfillRecords({
      nowMs: Date.parse("2028-01-01T00:00:00+09:00"),
      dailySessionSnapshots: [{
        version: 1,
        dataSchemaVersion: 3,
        // Snapshot creation belongs to the new binary while the nested
        // session may have been restored from the pre-Obon release.
        appVersion: "2026.8.9-6",
        buildId: "build-current-binary-restored-session",
        demandCycle: "summer",
        calendarContext,
        capturedAt: `${params.date}T17:10:00+09:00`,
        session: {
          dataSchemaVersion: 3,
          appVersion: params.nestedAppVersion,
          buildId: "build-session-origin",
          date: params.date,
          weekday: params.weekday,
          discountTime: "17",
          demandCycle: "summer",
          startedAt: `${params.date}T17:00:00+09:00`,
        },
        areas: {
          bento_men: {
            areaId: "bento_men",
            areaCount: 20,
            measurementStatus: "measured",
            measurementRecordedAt: `${params.date}T17:05:00+09:00`,
          },
        },
      }],
    })[0];
  };

  for (const { date, weekday } of [
    { date: "2026-08-13", weekday: 4 },
    { date: "2026-08-16", weekday: 0 },
  ]) {
    const restoredLegacy = collectSnapshot({
      date,
      weekday,
      applyObonRule: false,
      nestedAppVersion: "2026.8.9-5",
    });
    assert.ok(restoredLegacy);
    assert.equal(restoredLegacy.appVersion, "2026.8.9-6");
    assert.equal(
      restoredLegacy.actualWeekdayGroup,
      getActualWeekdayGroup(weekday, "17"),
    );
    assert.equal(restoredLegacy.calendarContext?.calendarCondition, "ordinary");
    assert.notEqual(restoredLegacy.calendarContext?.isObon, true);
  }

  const explicitObon = collectSnapshot({
    date: "2026-08-16",
    weekday: 0,
    applyObonRule: true,
    nestedAppVersion: "2026.8.9-6",
  });
  assert.ok(explicitObon);
  assert.equal(explicitObon.actualWeekdayGroup, "翌日平日祝日");
  assert.equal(explicitObon.calendarContext?.calendarCondition, "obon");
  assert.equal(explicitObon.calendarContext?.isObon, true);
});

test("Review19履歴も保存済みcalendar factをversionより優先", () => {
  const dates = ["2022-08-16", "2026-08-16", "2029-08-16"];
  const makeHistorical = (
    date: string,
    applyObonRule: boolean,
  ): Review19Result => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const calendarContext = buildSessionAnalysisCalendarContext({
      date,
      weekday,
      discountTime: "19",
      sessionStartedAt: `${date}T18:30:00+09:00`,
      manualWeekdayOverride: false,
      applyObonRule,
      areaDecisionBases: [],
    });
    assert.ok(calendarContext);
    return {
      ...makeReview(date, "normal", calendarContext),
      appVersion: "2026.8.9-6",
      areaCounts: { bento_men: 20 },
      areaCountRecordedAt: {
        bento_men: `${date}T19:05:00+09:00`,
      },
    };
  };
  const evaluate = (historicalRecords: Review19Result[]) =>
    buildReview19AutomaticEvaluation({
      areaId: "bento_men",
      count: 20,
      date: "2032-08-16",
      weekday: 1,
      demandCycle: "normal",
      applyObonRule: true,
      historicalRecords,
    });

  const restoredLegacy = evaluate(
    dates.map((date) => makeHistorical(date, false)),
  );
  assert.equal(restoredLegacy.autoEvaluationStatus, "ready");
  assert.equal(restoredLegacy.autoEvaluationBasis.sampleSize, 3);
  assert.equal(
    restoredLegacy.autoEvaluationBasis.comparisonMode,
    "holiday_before_normal_weekday",
  );

  const explicitObon = evaluate(
    dates.map((date) => makeHistorical(date, true)),
  );
  assert.equal(explicitObon.autoEvaluationStatus, "insufficient");
  assert.equal(explicitObon.autoEvaluationBasis.sampleSize, 0);
});

test("お盆中日という日付だけで三連休中日へ誤分類しない", () => {
  for (const date of ["2026-08-14", "2026-08-15"]) {
    assert.equal(isThreeDayHolidayMiddle(date), false);
    const reference = getIndividualAmountReferenceContext({
      date,
      weekday: date.endsWith("14") ? 5 : 6,
      discountTime: "17",
    });
    assert.equal(reference.kind, "obon");
    assert.notEqual(reference.kind, "three_day_holiday_middle");
  }
  const realMiddle = getIndividualAmountReferenceContext({
    date: "2026-07-19",
    weekday: 0,
    discountTime: "17",
  });
  assert.equal(realMiddle.kind, "three_day_holiday_middle");
});

test("8月12日にお盆前日・祝日前日ルールを追加しない", () => {
  assert.equal(isObonDate("2026-08-12"), false);
  assert.equal(isDayBeforeJapaneseHoliday("2026-08-12"), false);
  const reference = getIndividualAmountReferenceContext({
    date: "2026-08-12",
    weekday: 3,
    discountTime: "17",
  });
  assert.equal(reference.kind, "actual_weekday");
  assert.equal(buildCalendar("2026-08-12", { weekday: 3 }).calendarCondition, "ordinary");
});

test("manual weekday overrideでもお盆のcalendar factは維持", () => {
  const context = buildCalendar("2026-08-13", {
    weekday: 2,
    manualWeekdayOverride: true,
  });
  assert.equal(context.manualWeekdayOverride, true);
  assert.equal(context.isObon, true);
  assert.equal(context.calendarCondition, "obon");
});

test("導入前ordinary 8月13日をnormalize・日次統合で遡及変換しない", () => {
  const legacy = makeLegacyOrdinaryContext();
  const normalized = normalizeAnalysisCalendarContext(legacy);
  assert.ok(normalized);
  assert.equal(normalized.calendarCondition, "ordinary");
  assert.notEqual(normalized.isObon, true);
  assert.equal(normalized.individualAmountReference[0]?.kind, "actual_weekday");
  assert.equal(normalized.individualAmountReference[0]?.referenceWeekday, 4);
  assert.equal(normalized.areaCountReference[0]?.comparisonMode, "weekday");
  assert.equal(normalized.areaCountReference[0]?.reason, "same_weekday_history");

  const day = buildDayAnalysisCalendarContext({
    date: "2026-08-13",
    sessionContexts: [legacy],
  });
  assert.ok(day);
  assert.equal(day.calendarCondition, "ordinary");
  assert.notEqual(day.isObon, true);
  assert.equal(day.individualAmountReference[0]?.kind, "actual_weekday");
  assert.equal(day.areaCountReference[0]?.comparisonMode, "weekday");
});

test("導入前ordinary recordはdaily exportとcloud roundtripでも不変", () => {
  const legacy = makeLegacyOrdinaryContext();
  const daily = buildAllFinalizedDayDataExportPayloadsByDemandCycle({
    records: [makeDay("2026-08-13", "summer", legacy)],
    exportedAt: "2026-08-13T14:00:00Z",
  });
  assert.equal(daily.length, 1);
  const exportedContext = daily[0]?.payload.records[0]?.calendarContext;
  assert.equal(exportedContext?.calendarCondition, "ordinary");
  assert.notEqual(exportedContext?.isObon, true);
  assert.equal(
    exportedContext?.individualAmountReference[0]?.kind,
    "actual_weekday",
  );

  const record: AreaCountRecord = {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-5",
    buildId: "build-before-obon-rule",
    demandCycle: "summer",
    date: "2026-08-13",
    sessionStartedAt: SESSION_STARTED_AT,
    recordedAt: "2026-08-13T17:05:00+09:00",
    areaId: "bento_men",
    discountTime: "17",
    actualWeekday: getActualWeekdayLabel(4),
    actualWeekdayGroup: getActualWeekdayGroup(4, "17"),
    calendarContext: legacy,
    count: 20,
    suggestedEvaluation: "normal",
    areaRateAdjustment: 0,
    evaluationSource: "history",
    decisionBasis: makeLegacyDecisionBasis(),
  };
  const cloudRoundTrip = normalizeRemoteAreaCountRows([
    buildRemoteAreaCountRow(record),
  ])[0];
  assert.equal(cloudRoundTrip?.calendarContext?.calendarCondition, "ordinary");
  assert.notEqual(cloudRoundTrip?.calendarContext?.isObon, true);
  assert.equal(
    cloudRoundTrip?.calendarContext?.individualAmountReference[0]?.referenceWeekday,
    4,
  );
  assert.equal(cloudRoundTrip?.actualWeekdayGroup, record.actualWeekdayGroup);
  assert.equal(cloudRoundTrip?.suggestedEvaluation, record.suggestedEvaluation);
  assert.equal(cloudRoundTrip?.evaluationSource, record.evaluationSource);
  assert.equal(cloudRoundTrip?.areaRateAdjustment, record.areaRateAdjustment);
  assert.deepEqual(
    JSON.parse(JSON.stringify(cloudRoundTrip?.decisionBasis)),
    JSON.parse(JSON.stringify(record.decisionBasis)),
  );
  assert.equal(
    cloudRoundTrip?.calendarContext?.areaCountReference[0]?.comparisonMode,
    "weekday",
  );
  assert.equal(
    cloudRoundTrip?.calendarContext?.areaCountReference[0]?.reason,
    "same_weekday_history",
  );

  const review19 = makeReview("2026-08-13", "summer", legacy);
  const review19CloudRoundTrip = normalizeRemoteReview19Row(
    buildRemoteReview19Row(review19),
    "summer",
  );
  assert.equal(
    review19CloudRoundTrip?.calendarContext?.calendarCondition,
    "ordinary",
  );
  assert.notEqual(review19CloudRoundTrip?.calendarContext?.isObon, true);
  assert.equal(
    review19CloudRoundTrip?.calendarContext?.individualAmountReference[0]
      ?.referenceWeekday,
    4,
  );
});

test("normal・summer別exportはお盆metadataを欠落・混在させない", () => {
  const normalContext = buildCalendar("2027-08-13", { weekday: 5 });
  const summerContext = buildCalendar("2026-08-13", { weekday: 4 });
  const exportedAt = "2026-08-13T14:00:00Z";
  const daily = buildAllFinalizedDayDataExportPayloadsByDemandCycle({
    records: [
      makeDay("2027-08-13", "normal", normalContext),
      makeDay("2026-08-13", "summer", summerContext),
    ],
    exportedAt,
  });
  assert.deepEqual(daily.map((bundle) => bundle.demandCycle), ["normal", "summer"]);
  for (const bundle of daily) {
    assert.equal(bundle.payload.records.length, 1);
    assert.equal(bundle.payload.records[0]?.demandCycle, bundle.demandCycle);
    assert.equal(bundle.payload.records[0]?.calendarContext?.isObon, true);
    assert.equal(
      bundle.payload.records[0]?.calendarContext?.calendarCondition,
      "obon",
    );
  }

  const review19 = buildAllReview19DataExportPayloadsByDemandCycle({
    records: [
      makeReview("2027-08-13", "normal", normalContext),
      makeReview("2026-08-13", "summer", summerContext),
    ],
    exportedAt,
  });
  assert.deepEqual(review19.map((bundle) => bundle.demandCycle), ["normal", "summer"]);
  for (const bundle of review19) {
    assert.equal(bundle.payload.records.length, 1);
    assert.equal(bundle.payload.records[0]?.demandCycle, bundle.demandCycle);
    assert.equal(bundle.payload.records[0]?.calendarContext?.isObon, true);
    assert.equal(
      bundle.payload.records[0]?.calendarContext?.calendarCondition,
      "obon",
    );
  }
});

let passed = 0;
for (const entry of tests) {
  try {
    entry.run();
    passed += 1;
    console.log(`PASS: ${entry.name}`);
  } catch (error) {
    console.error(`FAIL: ${entry.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const summary = `${passed}/${tests.length} Obon calendar checks passed`;
if (process.exitCode) console.error(summary);
else console.log(summary);
