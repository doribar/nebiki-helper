import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  buildAreaCountDecisionBasis,
  dedupeLatestAreaCountCalculationRecordsByDateAreaTime,
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  getHolidayBeforeNormalWeekdayReferenceDetailLines,
  mergeAreaCountRecordCollections,
  normalizeAreaCountDecisionBasis,
  normalizeAreaCountRecords,
  prepareAreaCountCalculationPopulation,
  type AreaCountDecisionBasis,
  type AreaCountRecord,
  type AreaCountRecommendation,
} from "../src/domain/areaCountHistory.ts";
import { buildSessionAnalysisCalendarContext, normalizeAnalysisCalendarContext } from "../src/domain/analysisMetadata.ts";
import { AREA_COUNT_LOCAL_STORAGE_KEY, loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import { buildRemoteAreaCountRow, normalizeRemoteAreaCountRows } from "../src/domain/areaCountRemoteStorage.ts";
import { resolveAreaCountHistorySource } from "../src/domain/areaCountHistorySource.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import { initializeFinalizedDayDataInMemory, normalizeFinalizedDayData } from "../src/domain/finalizedDayData.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { isDayBeforeJapaneseHoliday, isHolidayBeforeNormalWeekday, isJapaneseHolidayOrObserved, isLongHolidayMiddle, isNormalWeekday, isThreeDayHolidayMiddle } from "../src/domain/japaneseHoliday.ts";
import { isObonDate } from "../src/domain/obon.ts";
import { buildNormalRateDecisionSnapshot, normalizeRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { buildReview19ExportPayload, createInitialReview19Result } from "../src/domain/review19.ts";
import { buildDirectFinalizedDayDataExportPayload } from "../src/domain/separateDataExport.ts";
import * as storage from "../src/domain/storage.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeLoadedState, normalizeSessionDraft } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";
import type { AppState, DemandCycle, DiscountTime, HolidayBeforeNormalWeekdayReference, UseNebikiAppResult } from "../src/domain/types.ts";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";
import type { AreaJudgeScreen } from "../src/components/screens/AreaJudgeScreen.tsx";

// Real production selection, hook actions, rates, TSX and persistence builders
// execute with deterministic React scheduling and memory storage. Browser
// paint, physical touch, IndexedDB and real Supabase transport are separate.
process.env.TZ = "Asia/Tokyo";
const TARGET = "2026-10-12";
const AREA = "bento_men" as const;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const NativeDate = Date;
const weekday = (date: string) => new NativeDate(`${date}T00:00:00Z`).getUTCDay();
const checks: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) => checks.push({ name, run });
function ordinary(date: string): boolean {
  return !isJapaneseHolidayOrObserved(date) && !isDayBeforeJapaneseHoliday(date) && !isThreeDayHolidayMiddle(date) && !isLongHolidayMiddle(date) && !isObonDate(date);
}
function dates(days: readonly number[], count: number, before = TARGET): string[] {
  const cursor = new NativeDate(`${before}T00:00:00Z`), result: string[] = [];
  for (let tries = 0; tries < 6000 && result.length < count; tries++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const date = cursor.toISOString().slice(0, 10);
    if (days.includes(cursor.getUTCDay()) && ordinary(date)) result.push(date);
  }
  assert.equal(result.length, count, "fixture dates are available");
  return result.reverse();
}
function record(date: string, count: number, time: DiscountTime = "17", patch: Partial<AreaCountRecord> = {}): AreaCountRecord {
  return { dataSchemaVersion: 3, appVersion: "2026.8.9-51", buildId: "build-holiday52-fixture", demandCycle: "normal", date,
    sessionStartedAt: `${date}T${time === "15" ? "06" : "08"}:00:00.000Z`, recordedAt: `${date}T08:05:00.000Z`,
    areaId: AREA, discountTime: time, actualWeekday: getActualWeekdayLabel(weekday(date)),
    actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({ date, weekday: weekday(date), discountTime: time }), count, ...patch };
}
function records(params: { sunday?: number[]; other?: number[]; time?: DiscountTime; before?: string }): AreaCountRecord[] {
  const time = params.time ?? "17";
  return [
    ...dates([0], params.sunday?.length ?? 0, params.before).map((date, i) => record(date, params.sunday![i]!, time, { demandCycle: i % 2 ? "summer" : "normal" })),
    ...dates(time === "15" ? [5, 6] : [2, 4], params.other?.length ?? 0, params.before).map((date, i) => record(date, params.other![i]!, time, { demandCycle: i % 2 ? "normal" : "summer" })),
  ];
}
function recommend(history: AreaCountRecord[], patch: Partial<Parameters<typeof getAreaCountRecommendation>[0]> = {}): AreaCountRecommendation {
  return getAreaCountRecommendation({ records: history, areaId: AREA, discountTime: "17", date: TARGET, weekday: 1, demandCycle: "normal", count: 10, ...patch });
}
function evidence(result: AreaCountRecommendation): HolidayBeforeNormalWeekdayReference {
  assert.equal(result.comparisonMode, "holiday_before_normal_weekday");
  assert.ok(result.holidayBeforeNormalWeekdayReference, "new rule captures its adopted population");
  return result.holidayBeforeNormalWeekdayReference;
}
const plentiful = (time: DiscountTime = "17") => records({ sunday: [6, 6, 6], other: Array(80).fill(30), time });
const calendar = (basis: AreaCountDecisionBasis, time: DiscountTime = "17") => buildSessionAnalysisCalendarContext({ date: TARGET, weekday: 1, discountTime: time, sessionStartedAt: `${TARGET}T08:00:00.000Z`, manualWeekdayOverride: false, areaDecisionBases: [{ areaId: AREA, basis }] })!;

test("2026-10-12 is a Monday holiday followed by a normal Tuesday", () => {
  assert.equal(weekday(TARGET), 1); assert.equal(isJapaneseHolidayOrObserved(TARGET), true);
  assert.equal(isHolidayBeforeNormalWeekday(TARGET), true); assert.equal(isNormalWeekday("2026-10-13"), true);
  for (const date of ["2026-03-20", "2026-05-04", "2026-10-11", "2026-10-13", "2026-10-04"]) assert.equal(isHolidayBeforeNormalWeekday(date), false, date);
});

for (const time of ["15", "17"] as const) {
  test(`${time}: three ordinary Sundays outrank 80 different fallback records`, () => {
    const history = plentiful(time), before = copy(history), result = recommend(history, { discountTime: time });
    const ref = evidence(result);
    assert.equal(result.status, "ready"); assert.equal(result.actualWeekday, "月"); assert.equal(result.actualWeekdayGroup, "翌日平日祝日");
    assert.equal(result.medianCount, 6); assert.equal(result.baseEvaluation, "many"); assert.equal(result.suggestedEvaluation, "many"); assert.equal(result.areaRateAdjustment, 10);
    assert.equal(ref.source, "weekday"); assert.equal(ref.adopted, true); assert.equal(ref.weekdaySampleSize, 3); assert.equal(ref.requiredSampleSize, 3);
    assert.equal(ref.fallbackWeekdayGroup, time === "15" ? "金土日" : "火木日"); assert.equal(ref.fallbackSampleSize, 83);
    assert.equal(ref.sampleSize, 3); assert.equal(ref.shortSampleSize, 3); assert.equal(ref.longSampleSize, 3); assert.equal(ref.medianCount, 6);
    assert.equal(ref.fallbackReason, undefined); assert.equal(ref.medianDownGuardApplied, false);
    assert.equal(result.matchedRecords.length, 3); assert.ok(result.matchedRecords.every(item => weekday(item.date) === 0 && ordinary(item.date)));
    assert.deepEqual(recommend(history, { discountTime: time, demandCycle: "summer" }).medianCount, result.medianCount);
    assert.deepEqual(recommend([], { discountTime: time, preparedPopulation: prepareAreaCountCalculationPopulation(history) }), result);
    assert.deepEqual(history, before);
  });
  for (const size of [0, 1, 2]) {
    test(`${time}: Sunday ${size} falls back to the time-specific group without a weekday guard`, () => {
      const result = recommend(records({ sunday: Array(size).fill(6), other: Array(60).fill(30), time }), { discountTime: time }), ref = evidence(result);
      assert.equal(result.status, "ready"); assert.equal(result.medianCount, 30); assert.equal(result.baseEvaluation, "few"); assert.equal(result.areaRateAdjustment, -10);
      assert.equal(ref.source, "fallback_group"); assert.equal(ref.adopted, true); assert.equal(ref.weekdaySampleSize, size); assert.equal(ref.fallbackSampleSize, 60 + size);
      assert.equal(ref.fallbackWeekdayGroup, time === "15" ? "金土日" : "火木日"); assert.equal(ref.fallbackReason, "insufficient_sunday_history");
      assert.equal(ref.sampleSize, 60 + size); assert.equal(ref.shortSampleSize, 16); assert.equal(ref.longSampleSize, 52); assert.equal(ref.medianDownGuardApplied, false);
      assert.ok(result.matchedRecords.every(item => item.actualWeekdayGroup === ref.fallbackWeekdayGroup));
    });
  }
  test(`${time}: adding the third Sunday changes fallback 30/few/-10 to Sunday 6/many/+10`, () => {
    const history = records({ sunday: [6, 6], other: Array(80).fill(30), time });
    const before = recommend(history, { discountTime: time });
    history.push(record(dates([0], 3)[0]!, 6, time, { demandCycle: "summer" }));
    const after = recommend(history, { discountTime: time });
    assert.deepEqual([evidence(before).source, before.medianCount, before.suggestedEvaluation, before.areaRateAdjustment], ["fallback_group", 30, "few", -10]);
    assert.deepEqual([evidence(after).source, after.medianCount, after.suggestedEvaluation, after.areaRateAdjustment], ["weekday", 6, "many", 10]);
  });
  for (const size of [0, 1, 2]) {
    test(`${time}: both populations below three remain insufficient (${size} Sundays)`, () => {
      const result = recommend(records({ sunday: Array(size).fill(6), time }), { discountTime: time }), ref = evidence(result);
      assert.equal(result.status, "insufficient"); assert.equal(result.medianCount, undefined); assert.equal(result.suggestedEvaluation, undefined); assert.equal(result.areaRateAdjustment, undefined);
      assert.equal(ref.source, "fallback_group"); assert.equal(ref.adopted, false); assert.equal(ref.weekdaySampleSize, size); assert.equal(ref.fallbackSampleSize, size);
      assert.equal(ref.fallbackReason, "insufficient_sunday_history"); assert.equal(ref.medianCount, undefined);
    });
  }
  test(`${time}: two Sundays plus one other group record make a valid fallback`, () => {
    const result = recommend(records({ sunday: [6, 6], other: [30], time }), { discountTime: time });
    assert.equal(result.status, "ready"); assert.equal(evidence(result).source, "fallback_group"); assert.equal(evidence(result).fallbackSampleSize, 3); assert.equal(result.medianCount, 6);
  });
  test(`${time}: ordinary-Sunday windows are 16/52 and guard 6 against long 30 at 28`, () => {
    const result = recommend(records({ sunday: [...Array(44).fill(30), ...Array(16).fill(6)], other: Array(80).fill(99), time }), { discountTime: time }), ref = evidence(result);
    assert.equal(ref.weekdaySampleSize, 60); assert.equal(ref.sampleSize, 60); assert.equal(ref.shortSampleSize, 16); assert.equal(ref.longSampleSize, 52);
    assert.equal(ref.shortMedianCount, 6); assert.equal(ref.longMedianCount, 30); assert.equal(ref.medianCount, 28); assert.equal(ref.medianDownGuardApplied, true);
    assert.equal(result.shortMedianCount, 6); assert.equal(result.longMedianCount, 30); assert.equal(result.medianCount, 28); assert.equal(result.medianDownGuardApplied, true);
    assert.equal(result.matchedRecords.length, 16);
  });
  test(`${time}: fallback windows are 16/52 but use short 6 despite long 30`, () => {
    const result = recommend(records({ sunday: [6, 6], other: [...Array(44).fill(30), ...Array(16).fill(6)], time }), { discountTime: time }), ref = evidence(result);
    assert.equal(ref.source, "fallback_group"); assert.equal(ref.shortSampleSize, 16); assert.equal(ref.longSampleSize, 52);
    assert.equal(ref.shortMedianCount, 6); assert.equal(ref.longMedianCount, 30); assert.equal(ref.medianCount, 6); assert.equal(ref.medianDownGuardApplied, false); assert.equal(result.medianDownGuardApplied, false);
  });
  test(`${time}: short above long is adopted without a guard and keeps existing integer median rounding`, () => {
    const result = recommend(records({ sunday: [...Array(44).fill(6), ...Array(8).fill(11), ...Array(8).fill(12)], time }), { discountTime: time });
    assert.equal(result.shortMedianCount, 12); assert.equal(result.longMedianCount, 6); assert.equal(result.medianCount, 12); assert.equal(evidence(result).medianDownGuardApplied, false);
    assert.equal(normalizeAreaCountDecisionBasis(copy(buildAreaCountDecisionBasis({ recommendation: result })))?.holidayBeforeNormalWeekdayReference?.medianCount, 12);
  });
  test(`${time}: special Sunday dates and legacy manual Tuesday-as-Sunday cannot reach minimum`, () => {
    const special = ["2026-05-03", "2026-01-11", "2025-11-23", "2025-05-04", "2023-08-13"];
    assert.ok(special.some(isJapaneseHolidayOrObserved)); assert.ok(special.some(isDayBeforeJapaneseHoliday)); assert.ok(special.some(isThreeDayHolidayMiddle)); assert.ok(special.some(isLongHolidayMiddle)); assert.ok(special.some(isObonDate));
    const history = records({ sunday: [6, 6], other: Array(20).fill(30), time });
    for (const date of special) { assert.equal(weekday(date), 0); history.push(record(date, 999, time, { actualWeekdayGroup: time === "15" ? "金土日" : "火木日" })); }
    history.push(...dates([2], 5).map(date => record(date, 999, time, { actualWeekday: "日", actualWeekdayGroup: time === "15" ? "金土日" : "火木日" })));
    const result = recommend(history, { discountTime: time });
    assert.equal(evidence(result).weekdaySampleSize, 2); assert.equal(evidence(result).source, "fallback_group");
  });
  test(`${time}: captured special calendar on an otherwise ordinary Sunday is excluded`, () => {
    const specialDate = dates([0], 3)[0]!;
    const captured = buildSessionAnalysisCalendarContext({ scope: "area_count", date: specialDate, weekday: 0, discountTime: time, sessionStartedAt: `${specialDate}T08:00:00.000Z`, manualWeekdayOverride: false, areaDecisionBases: [] })!;
    const special = record(specialDate, 999, time, { calendarContext: { ...captured, isHoliday: true, calendarCondition: "holiday" } });
    const history = [...records({ sunday: [6, 6], other: Array(20).fill(30), time }), special];
    assert.equal(evidence(recommend(history, { discountTime: time })).weekdaySampleSize, 2);
    const ordinaryCaptured = { ...special, count: 6, calendarContext: captured };
    assert.equal(evidence(recommend([...history.slice(0, -1), ordinaryCaptured], { discountTime: time })).weekdaySampleSize, 3);
  });
  test(`${time}: Obon captured/pre-rule version semantics remain compatible`, () => {
    const history = records({ sunday: [6, 6], other: Array(20).fill(30), time }), date = "2023-08-13";
    const legacy = record(date, 6, time, { appVersion: "2026.8.9-5" });
    assert.equal(evidence(recommend([...history, legacy], { discountTime: time })).weekdaySampleSize, 3);
    assert.equal(evidence(recommend([...history, { ...legacy, appVersion: "2026.8.9-51" }], { discountTime: time })).weekdaySampleSize, 2);
    const captured = buildSessionAnalysisCalendarContext({ scope: "area_count", date, weekday: 0, discountTime: time, sessionStartedAt: legacy.sessionStartedAt, manualWeekdayOverride: false, applyObonRule: false, areaDecisionBases: [] });
    assert.equal(evidence(recommend([...history, { ...legacy, appVersion: "2026.8.9-51", calendarContext: captured }], { discountTime: time })).weekdaySampleSize, 3);
  });
  test(`${time}: canonical local/remote/cycle copies and wrong date/area/time do not inflate Sunday minimum`, () => {
    const history = records({ sunday: [6, 6], other: Array(20).fill(30), time }), first = history[0]!;
    history.push(copy(first), copy(first), { ...copy(first), demandCycle: "summer" }, { ...copy(first), sessionStartedAt: `${first.date}T08:02:00.000Z`, recordedAt: `${first.date}T08:06:00.000Z`, count: 7 });
    history.push(record(TARGET, 999, time), record("2026-10-18", 999, time), record(dates([0], 3)[0]!, 999, time, { areaId: "sushi" }), record(dates([0], 3)[0]!, 999, time === "15" ? "17" : "15"));
    const before = copy(history), canonical = dedupeLatestAreaCountCalculationRecordsByDateAreaTime(normalizeAreaCountRecords(history));
    assert.equal(canonical.find(item => item.date === first.date && item.areaId === AREA && item.discountTime === time)?.count, 7);
    const remote = normalizeRemoteAreaCountRows(history.map(buildRemoteAreaCountRow));
    const source = resolveAreaCountHistorySource({ mode: "production", localRecords: history, remoteResults: [{ status: "ready", records: remote }] });
    const result = recommend(source.records, { discountTime: time });
    assert.equal(evidence(result).weekdaySampleSize, 2); assert.equal(evidence(result).source, "fallback_group"); assert.equal(result.medianCount, 30);
    assert.deepEqual(recommend([...source.records].reverse(), { discountTime: time }), result); assert.deepEqual(history, before); assert.equal(source.shouldPersistProductionCache, false);
  });
}

test("15:00 Sundays retain 金土日 history and are still individually selected", () => {
  const history = plentiful("15"), normalized = normalizeAreaCountRecords(history), result = recommend(history, { discountTime: "15" });
  assert.ok(normalized.filter(item => weekday(item.date) === 0).every(item => item.actualWeekdayGroup === "金土日"));
  assert.equal(evidence(result).source, "weekday"); assert.equal(result.medianCount, 6);
});
for (const time of ["18", "19", "20"] as const) {
  test(`${time}: legacy night references retain their prior group selection`, () => {
    const result = recommend(plentiful(time), { discountTime: time });
    assert.equal(result.holidayBeforeNormalWeekdayReference, undefined); assert.equal(result.comparisonMode, "holiday_before_normal_weekday"); assert.equal(result.medianCount, 30);
  });
}
for (const time of ["15", "17"] as const) {
  test(`${time}: nonholiday Obon-only date retains group reference`, () => {
    const date = "2026-08-16";
    assert.equal(isObonDate(date), true); assert.equal(isHolidayBeforeNormalWeekday(date), false);
    const result = recommend(records({ sunday: [6, 6, 6], other: Array(40).fill(30), time, before: date }), { date, weekday: weekday(date), discountTime: time });
    assert.equal(result.holidayBeforeNormalWeekdayReference, undefined); assert.equal(result.comparisonMode, "holiday_before_normal_weekday"); assert.equal(result.medianCount, 30);
  });
  test(`${time}: ordinary Sunday, ordinary weekday and holiday-before-weekend have no new evidence`, () => {
    for (const date of ["2026-10-04", "2026-10-06", "2026-03-20"]) {
      const result = recommend(records({ sunday: [6, 6, 6], other: Array(40).fill(30), time, before: date }), { date, weekday: weekday(date), discountTime: time });
      assert.equal(result.holidayBeforeNormalWeekdayReference, undefined, date);
    }
  });
}
test("three-day middle still adopts 50:50 Sunday 6 / Friday-Saturday 10 at median 8", () => {
  const date = "2026-10-11", history = records({ sunday: [6, 6, 6], other: Array(80).fill(30), before: date });
  history.push(...dates([5, 6], 3, date).map(day => record(day, 10)));
  const result = recommend(history, { date, weekday: 0 });
  assert.equal(result.comparisonMode, "three_day_holiday_middle"); assert.equal(result.holidayBeforeNormalWeekdayReference, undefined); assert.equal(result.medianCount, 8);
  assert.equal(result.threeDayHolidayMiddleReference?.sundayReference?.source, "weekday"); assert.equal(result.threeDayHolidayMiddleReference?.adoptedSource, "both");
});
test("decrease correction pairs exactly the adopted Sunday population", () => {
  const history = plentiful();
  history.push(...history.map(item => record(item.date, weekday(item.date) === 0 ? 12 : 150, "15")), record(TARGET, 20, "15"));
  const result = recommend(history, { count: 10 });
  assert.equal(evidence(result).source, "weekday"); assert.equal(result.decreaseRecommendation?.sampleSize, 3); assert.equal(result.decreaseRecommendation?.medianDecreaseRate, 0.5);
  assert.equal(result.decreaseRecommendation?.currentDecreaseRate, 0.5); assert.equal(result.decreaseRecommendation?.direction, "none"); assert.equal(result.suggestedEvaluation, "many");
});
test("decrease correction falls back to the selected group when Sunday has only two pairs", () => {
  const history = records({ sunday: [6, 6], other: Array(20).fill(30) });
  history.push(...history.map(item => record(item.date, weekday(item.date) === 0 ? 12 : 150, "15")), record(TARGET, 20, "15"));
  const result = recommend(history);
  assert.equal(evidence(result).source, "fallback_group"); assert.equal(result.decreaseRecommendation?.sampleSize, 16); assert.equal(result.decreaseRecommendation?.medianDecreaseRate, 0.8);
  assert.equal(result.decreaseRecommendation?.direction, "more_many"); assert.equal(result.baseEvaluation, "few"); assert.equal(result.suggestedEvaluation, "slightly_few"); assert.equal(result.areaRateAdjustment, -5);
});
test("missing Sunday pairs cannot borrow excluded Tuesday/Thursday pairs", () => {
  const history = plentiful(), sunday = history.filter(item => weekday(item.date) === 0);
  history.push(record(sunday[0]!.date, 12, "15"), ...history.filter(item => weekday(item.date) !== 0).map(item => record(item.date, 150, "15")), record(TARGET, 20, "15"));
  const result = recommend(history);
  assert.equal(evidence(result).source, "weekday"); assert.equal(result.decreaseRecommendation?.canUse, false); assert.equal(result.decreaseRecommendation?.sampleSize, 1); assert.equal(result.decreaseRecommendation?.direction, "none");
});
test("new target histories keep actual Monday and 翌日平日祝日 classification", () => {
  const basis = buildAreaCountDecisionBasis({ recommendation: recommend(plentiful()) });
  const observed = record(TARGET, 10, "17", { decisionBasis: basis });
  for (const restored of [normalizeAreaCountRecords([observed])[0]!, normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(observed)])[0]!]) {
    assert.equal(restored.actualWeekday, "月"); assert.equal(restored.actualWeekdayGroup, "翌日平日祝日"); assert.deepEqual(copy(restored.decisionBasis), copy(basis));
  }
});
test("calendar evidence distinguishes Sunday, fallback, insufficient and legacy without inventing adoption", () => {
  const ready = buildAreaCountDecisionBasis({ recommendation: recommend(plentiful()) });
  const fallback = buildAreaCountDecisionBasis({ recommendation: recommend(records({ sunday: [6, 6], other: Array(20).fill(30) })) });
  const none = buildAreaCountDecisionBasis({ recommendation: recommend(records({ sunday: [6, 6] })) });
  const legacy = copy(fallback); delete legacy.holidayBeforeNormalWeekdayReference;
  for (const [basis, type, refDay, group] of [[ready, "weekday", "日", null], [fallback, "weekday_group", null, "火木日"], [none, "weekday_group", null, "火木日"], [legacy, "weekday_group", null, "火木日"]] as const) {
    const context = calendar(basis), restored = normalizeAnalysisCalendarContext(copy(context))!;
    assert.equal(context.actualWeekday, "月"); assert.equal(context.calendarCondition, "holiday_before_normal_weekday");
    assert.equal(context.areaCountReference[0]!.type, type); assert.equal(context.areaCountReference[0]!.referenceWeekday, refDay); assert.equal(context.areaCountReference[0]!.referenceWeekdayGroup, group);
    assert.deepEqual(copy(restored), copy(context));
    if (basis.holidayBeforeNormalWeekdayReference) assert.deepEqual(context.areaCountReference[0]!.holidayBeforeNormalWeekdayReference, basis.holidayBeforeNormalWeekdayReference);
    else assert.equal(context.areaCountReference[0]!.holidayBeforeNormalWeekdayReference, undefined);
  }
  assert.equal(calendar(none).areaCountReference[0]!.reason, "insufficient_history");
});
test("canonical legacy winner does not acquire a losing record's new evidence", () => {
  const modern = buildAreaCountDecisionBasis({ recommendation: recommend(plentiful()) }), legacy = copy(modern);
  delete legacy.holidayBeforeNormalWeekdayReference; legacy.medianCount = 30;
  const old = record(TARGET, 10, "17", { decisionBasis: legacy, recordedAt: `${TARGET}T08:07:00.000Z` });
  const current = record(TARGET, 10, "17", { decisionBasis: modern });
  const merged = mergeAreaCountRecordCollections([current], [old])[0]!;
  assert.equal(merged.decisionBasis?.medianCount, 30); assert.equal(merged.decisionBasis?.holidayBeforeNormalWeekdayReference, undefined);
  const differentIdentity = { ...current, demandCycle: "summer" as const, sessionStartedAt: `${TARGET}T08:01:00.000Z` };
  assert.equal(dedupeLatestAreaCountCalculationRecordsByDateAreaTime([differentIdentity, old])[0]!.decisionBasis?.holidayBeforeNormalWeekdayReference, undefined);
});

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
const memory = new MemoryStorage();
let nowMs = new NativeDate(`${TARGET}T17:05:00+09:00`).getTime();
class FixtureDate extends NativeDate {
  constructor(value?: string | number | Date) { super(value === undefined ? nowMs : value); }
  static now() { return nowMs; }
}
Object.defineProperty(globalThis, "Date", { configurable: true, value: FixtureDate });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
const events = { addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, "document", { configurable: true, value: { ...events, hidden: false } });
let timerId = 0;
const timers = new Map<number, () => void>();
Object.defineProperty(globalThis, "window", { configurable: true, value: { ...events,
  setTimeout(callback: () => void) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id: number) { timers.delete(id); },
  setInterval() { assert.fail("production clock must use aligned timeout"); }, clearInterval() {}, confirm() { return true; }, scrollTo() {},
  alert(message: string) { assert.fail(`unexpected alert: ${message}`); }, location: { search: "", hash: "", href: "http://holiday52.invalid/", pathname: "/" },
} });
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) => a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
function FixtureProductionApp() { return useNebikiApp(); }
class HookFixture {
  slots: Slot[] = []; index = 0; dirty = false; app!: UseNebikiAppResult;
  element?: React.ReactElement;
  private readonly renderComponent?: () => React.ReactElement;
  constructor(renderComponent?: () => React.ReactElement) { this.renderComponent = renderComponent; }
  effects: { callback: () => void | (() => void); slot: Slot }[] = [];
  next() { return this.slots[this.index++] ??= {}; }
  dispatcher = {
    useRef: <T>(initial: T) => { const slot = this.next(); if (!("value" in slot)) slot.value = { current: initial }; return slot.value as { current: T }; },
    useState: <T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] => {
      const slot = this.next(); if (!("value" in slot)) slot.value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slot.value as T, value => { const next = typeof value === "function" ? (value as (previous: T) => T)(slot.value as T) : value; if (!Object.is(next, slot.value)) { slot.value = next; this.dirty = true; } }];
    },
    useMemo: <T>(callback: () => T, deps: readonly unknown[]) => { const slot = this.next(); if (!("value" in slot) || !sameDeps(slot.deps, deps)) { slot.value = callback(); slot.deps = deps; } return slot.value as T; },
    useCallback: <T>(callback: T, deps: readonly unknown[]) => this.dispatcher.useMemo(() => callback, deps),
    useEffect: (callback: () => void | (() => void), deps?: readonly unknown[]) => { const slot = this.next(); if (!sameDeps(slot.deps, deps)) { slot.deps = deps; this.effects.push({ callback, slot }); } },
  };
  render() {
    this.index = 0; this.dirty = false; this.effects = [];
    const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown }, previous = internals.H;
    internals.H = this.dispatcher;
    try { if (this.renderComponent) this.element = this.renderComponent(); else this.app = FixtureProductionApp(); } finally { internals.H = previous; }
  }
  settle(force = false) {
    if (force || this.dirty || !this.app) this.render();
    for (let pass = 0; pass < 20; pass++) {
      const pending = this.effects; this.effects = [];
      for (const { callback, slot } of pending) {
        const allowed = this.renderComponent
          ? /loadCalculatorDraft/.test(String(callback))
          : /app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|areaCompletionStateRef\.current|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|startAlignedRuntimeClock|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)|earlyNextMinus5TargetDiscountTime/.test(String(callback));
        if (!allowed) continue;
        slot.cleanup?.(); const cleanup = callback(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      }
      if (!this.dirty) return;
      this.render();
    }
    assert.fail("production effects converge");
  }
  close() { this.slots.forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined; }); }
}
function stateFor(time: "15" | "17", demandCycle: DemandCycle): AppState {
  const draft = normalizeSessionDraft({ date: TARGET, weekday: 1, discountTime: time, demandCycle, manualWeekdayOverride: false, manualDiscountTimeOverride: false, weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null } });
  const state = createInitialState(draft);
  state.session = { ...draft, ...getCurrentDataVersionInfo(), startedAt: `${TARGET}T${time === "15" ? "06" : "08"}:00:00.000Z`, globalDiscountAdjustmentPercent: 0 };
  state.screen = "area_judge"; state.currentAreaId = AREA;
  return state;
}
function hookFixture(history: AreaCountRecord[], time: "15" | "17", demandCycle: DemandCycle) {
  assert.equal(timers.size, 0); memory.clear(); nowMs = new NativeDate(`${TARGET}T${time}:05:00+09:00`).getTime();
  const state = stateFor(time, demandCycle);
  memory.setItem(storage.STORAGE_KEYS.currentSession, JSON.stringify(state)); memory.setItem(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(state)); memory.setItem(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(history));
  const hook = new HookFixture(); hook.settle(true); return hook;
}
for (const demandCycle of ["normal", "summer"] as const) {
  for (const time of ["15", "17"] as const) {
    for (const size of [2, 3]) {
      test(`${demandCycle}/${time}/Sunday${size}: actual hook confirms count, rate and current/checkpoint evidence`, async () => {
        const hook = hookFixture(records({ sunday: Array(size).fill(6), other: Array(80).fill(30), time }), time, demandCycle);
        try {
          const recommendation = hook.app.actions.getCurrentAreaCountRecommendation(10), ref = evidence(recommendation);
          assert.equal(ref.source, size === 3 ? "weekday" : "fallback_group"); assert.equal(recommendation.medianCount, size === 3 ? 6 : 30);
          await hook.app.actions.judgeCurrentArea("normal", 10); hook.settle();
          assert.equal(hook.app.state.screen, "rate_display");
          const progress = hook.app.state.areaProgressMap[AREA], basis = progress.areaCountDecisionBasis!;
          assert.equal(progress.areaCountEvaluationSource, "history"); assert.equal(progress.areaCountEvaluation, size === 3 ? "many" : "few");
          assert.deepEqual(basis.holidayBeforeNormalWeekdayReference, ref);
          const expected = time === "15" ? (size === 3 ? [10, 20] : [0, 0]) : (size === 3 ? [20, 30] : [0, 10]);
          const shown = hook.app.derived.rateDisplay!;
          assert.deepEqual([shown.normal.main, shown.many.main], expected.map(value => `${value}%`));
          hook.app.actions.goToNextArea(); hook.settle();
          const completed = hook.app.state.areaProgressMap[AREA], captured = completed.rateDecisionSnapshot!;
          assert.equal(completed.status, "completed"); assert.equal(captured.calculationMode, "normal"); assert.equal(captured.sessionDiscountTime, time);
          assert.deepEqual([captured.normalRatePercent, captured.manyRatePercent], expected); assert.deepEqual(captured.display, shown);
          assert.deepEqual(copy(normalizeRateDecisionSnapshot(copy(captured))), copy(captured)); assert.deepEqual(completed.areaCountDecisionBasis?.holidayBeforeNormalWeekdayReference, ref);
          for (const loaded of [storage.loadCurrentSession(), storage.loadWorkSessionCheckpoint()]) {
            const restored = normalizeLoadedState(loaded, hook.app.state.draft);
            assert.deepEqual(copy(restored.areaProgressMap[AREA].areaCountDecisionBasis), copy(completed.areaCountDecisionBasis));
            assert.deepEqual(copy(restored.areaProgressMap[AREA].rateDecisionSnapshot), copy(captured));
          }
          const observed = loadLocalAreaCountRecords().find(item => item.date === TARGET && item.areaId === AREA && item.discountTime === time)!;
          assert.ok(observed); assert.equal(observed.actualWeekday, "月"); assert.equal(observed.actualWeekdayGroup, "翌日平日祝日");
          assert.deepEqual(observed.decisionBasis?.holidayBeforeNormalWeekdayReference, ref); assert.deepEqual(observed.calendarContext?.areaCountReference[0]?.holidayBeforeNormalWeekdayReference, ref);
          const remoteRow = buildRemoteAreaCountRow(observed); assert.ok(remoteRow.record_details);
          assert.deepEqual(normalizeRemoteAreaCountRows([copy(remoteRow)])[0]!.decisionBasis?.holidayBeforeNormalWeekdayReference, ref);
          const saved = copy(completed), stored = copy(memory.getItem(storage.STORAGE_KEYS.currentSession));
          nowMs = new NativeDate(`${TARGET}T${time === "15" ? "16" : "18"}:30:00+09:00`).getTime(); hook.settle(true);
          assert.deepEqual(copy(hook.app.state.areaProgressMap[AREA]), saved, "clock render cannot recapture completed evidence/rates");
          assert.equal(memory.getItem(storage.STORAGE_KEYS.currentSession), stored, "clock does not rewrite the completed session");
        } finally { hook.close(); }
      });
    }
  }
}
for (const time of ["15", "17"] as const) {
  for (const source of ["weekday", "fallback_group"] as const) {
    test(`${time}/${source}: daily/day/finalized/Review19 exports retain basis, calendar source and fixed confirmed rates`, () => {
      const result = recommend(records({ sunday: Array(source === "weekday" ? 3 : 2).fill(6), other: Array(80).fill(30), time }), { discountTime: time });
      const basis = buildAreaCountDecisionBasis({ recommendation: result, evaluationSource: "history", finalEvaluation: result.suggestedEvaluation, areaRateAdjustment: result.areaRateAdjustment }), state = stateFor(time, "normal");
      const weather = resolveWeatherInputForDiscount(state.session!.weather, time), weekdayBase = getWeekdayBaseInfo(1, time, weather, TARGET, "normal");
      const rate = buildNormalRateDecisionSnapshot({ confirmedAt: `${TARGET}T08:05:00.000Z`, sessionDiscountTime: time, demandCycle: "normal", weatherComfortAdjustmentPercent: weekdayBase.baseRateBonus, areaJudge: result.suggestedJudge!, areaRateAdjustment: result.areaRateAdjustment, resolvedWeather: weather, weekday: 1, date: TARGET, globalDiscountAdjustmentPercent: 0 });
      assert.deepEqual(rate.display, getNormalTimeRateDisplay({ discountTime: time, weatherBonus: weekdayBase.baseRateBonus, areaJudge: result.suggestedJudge!, areaRateAdjustment: result.areaRateAdjustment, date: TARGET, weekday: 1 }));
      Object.assign(state.areaProgressMap[AREA], { status: "completed", areaJudge: result.suggestedJudge!, areaCount: 10, areaCountEvaluation: result.suggestedEvaluation, areaCountEvaluationSource: "history", areaCountDecisionBasis: basis, areaRateAdjustment: result.areaRateAdjustment, rateDecisionSnapshot: rate, completedAt: `${TARGET}T08:05:00.000Z` });
      const observed = record(TARGET, 10, time, { decisionBasis: basis, calendarContext: calendar(basis, time) });
      const daily = createDailySessionSnapshot({ capturedAt: `${TARGET}T08:10:00.000Z`, state, resolvedWeather: weather, weekdayBaseInfo: weekdayBase, basisGuide: getBasisGuideDisplay({ date: TARGET, weekday: 1, discountTime: time, demandCycle: "normal", weather }), lateTimeBonus: 0, doneSummaryItems: [], sessionEndReason: "auto_time_transition" })!;
      const day = createReview19DaySnapshot({ capturedAt: `${TARGET}T11:35:00.000Z`, date: TARGET, demandCycle: "normal", sessions: [daily], areaCountRecords: [observed] });
      const finalized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot: day, finalizedAt: day.capturedAt }).record;
      const exported = buildDirectFinalizedDayDataExportPayload({ record: finalized, exportedAt: `${TARGET}T12:00:00.000Z` }), restored = normalizeFinalizedDayData(copy(exported.daySnapshot))!;
      assert.equal(exported.dataSchemaVersion, 3);
      for (const snapshot of [day, finalized, exported.daySnapshot, restored]) {
        const area = snapshot.sessions[0]!.areas[AREA], ref = snapshot.sessions[0]!.calendarContext!.areaCountReference.find(item => item.areaId === AREA)!;
        assert.deepEqual(copy(area.areaCountDecisionBasis), copy(basis)); assert.deepEqual(copy(area.rateDecisionSnapshot), copy(rate));
        assert.deepEqual(snapshot.areaCountRecords[0]!.decisionBasis?.holidayBeforeNormalWeekdayReference, evidence(result));
        assert.deepEqual(ref.holidayBeforeNormalWeekdayReference, evidence(result)); assert.equal(ref.type, source === "weekday" ? "weekday" : "weekday_group");
        assert.equal(ref.referenceWeekday, source === "weekday" ? "日" : null); assert.equal(ref.referenceWeekdayGroup, source === "weekday" ? null : time === "15" ? "金土日" : "火木日");
      }
      const review = createInitialReview19Result({ date: TARGET, demandCycle: "normal", sessionStartedAt: state.session!.startedAt, reviewStartedAt: `${TARGET}T10:00:00.000Z` }); review.daySnapshot = day;
      const reviewExport = buildReview19ExportPayload({ records: [review], exportedAt: `${TARGET}T12:00:00.000Z` });
      assert.deepEqual(copy(reviewExport.records[0]!.daySnapshot!.sessions[0]!.areas[AREA].areaCountDecisionBasis), copy(basis));
      assert.deepEqual(copy(reviewExport.records[0]!.daySnapshot!.sessions[0]!.areas[AREA].rateDecisionSnapshot), copy(rate));
    });
  }
}
test("legacy missing evidence and confirmed rate remain missing/unchanged after snapshot restore/export", () => {
  const result = recommend(plentiful()), basis = buildAreaCountDecisionBasis({ recommendation: result }); delete basis.holidayBeforeNormalWeekdayReference; basis.medianCount = 30;
  const state = stateFor("17", "normal"), weather = resolveWeatherInputForDiscount(state.session!.weather, "17"), weekdayBase = getWeekdayBaseInfo(1, "17", weather, TARGET, "normal");
  const rate = buildNormalRateDecisionSnapshot({ confirmedAt: `${TARGET}T08:05:00.000Z`, sessionDiscountTime: "17", weatherComfortAdjustmentPercent: 0, areaJudge: "normal", areaRateAdjustment: -10, resolvedWeather: weather, weekday: 1, date: TARGET });
  Object.assign(state.areaProgressMap[AREA], { status: "completed", areaJudge: "normal", areaCount: 10, areaCountDecisionBasis: basis, rateDecisionSnapshot: rate, completedAt: `${TARGET}T08:05:00.000Z` });
  const daily = createDailySessionSnapshot({ capturedAt: `${TARGET}T08:10:00.000Z`, state, resolvedWeather: weather, weekdayBaseInfo: weekdayBase, basisGuide: getBasisGuideDisplay({ date: TARGET, weekday: 1, discountTime: "17", weather }), lateTimeBonus: 0, doneSummaryItems: [], sessionEndReason: "auto_time_transition" })!;
  const day = createReview19DaySnapshot({ capturedAt: `${TARGET}T11:35:00.000Z`, date: TARGET, demandCycle: "normal", sessions: [daily], areaCountRecords: [record(TARGET, 10, "17", { decisionBasis: basis })] });
  const finalized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot: day, finalizedAt: day.capturedAt }).record;
  const exported = buildDirectFinalizedDayDataExportPayload({ record: finalized, exportedAt: `${TARGET}T12:00:00.000Z` });
  for (const snapshot of [day, finalized, exported.daySnapshot, normalizeFinalizedDayData(copy(exported.daySnapshot))!]) {
    const area = snapshot.sessions[0]!.areas[AREA]; assert.equal(area.areaCountDecisionBasis?.holidayBeforeNormalWeekdayReference, undefined); assert.equal(area.areaCountDecisionBasis?.medianCount, 30);
    assert.deepEqual(copy(area.rateDecisionSnapshot), copy(rate)); assert.equal(area.rateDecisionSnapshot?.normalRatePercent, 0);
    assert.equal(snapshot.sessions[0]!.calendarContext!.areaCountReference[0]!.holidayBeforeNormalWeekdayReference, undefined);
  }
});

const modules = new Map<string, Record<string, unknown>>();
async function loadTsx(url: URL): Promise<Record<string, unknown>> {
  const cached = modules.get(url.href); if (cached) return cached;
  const source = readFileSync(url, "utf8"), ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dependencies = new Map<string, unknown>([["react", React], ["react/jsx-runtime", jsxRuntime]]);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    assert.ok(ts.isStringLiteral(statement.moduleSpecifier)); const id = statement.moduleSpecifier.text; if (dependencies.has(id)) continue;
    assert.ok(id.startsWith("."), `local production dependency: ${id}`);
    const target = [id, `${id}.ts`, `${id}.tsx`].map(path => new URL(path, url)).find(path => existsSync(path)); assert.ok(target);
    dependencies.set(id, target.pathname.endsWith(".tsx") ? await loadTsx(target) : await import(target.href));
  }
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { Date: FixtureDate, window, document, navigator, localStorage, URLSearchParams, exports, require: (id: string) => { assert.ok(dependencies.has(id)); return dependencies.get(id); } });
  modules.set(url.href, exports); return exports;
}
test("actual RateDisplay TSX renders collapsed captured Sunday/fallback/insufficient/guard evidence; legacy gets no invented block", async () => {
  const Rate = (await loadTsx(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url))).RateDisplayScreen as typeof RateDisplayScreen;
  const noop = () => {};
  const markup = (basis?: AreaCountDecisionBasis) => renderToStaticMarkup(React.createElement(Rate, { weekdayText: "月曜日", timeText: "17時", areaName: "弁当・麺", discountTime: "17", areaCount: 10, basisGuide: { referenceText: "10月・祝日翌日平日・17時", referenceConditionLabel: "10月・祝日翌日平日・17時" }, areaCountDecisionBasis: basis, rateDisplay: { normal: { main: "20%" }, many: { main: "30%" }, few: { main: "引かない" } }, onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop }));
  const fixtures = [recommend(plentiful()), recommend(records({ sunday: [6, 6], other: Array(20).fill(30) })), recommend(records({ sunday: [6, 6] })), recommend(records({ sunday: [...Array(44).fill(30), ...Array(16).fill(6)] }))].map(recommendation => buildAreaCountDecisionBasis({ recommendation }));
  const partial = copy(fixtures[0]!); delete partial.holidayBeforeNormalWeekdayReference!.medianCount; delete partial.holidayBeforeNormalWeekdayReference!.shortMedianCount; delete partial.holidayBeforeNormalWeekdayReference!.longMedianCount;
  for (const basis of [...fixtures, partial]) {
    const before = copy(basis), html = markup(basis);
    assert.match(html, /<details aria-label="祝日翌日平日の履歴基準"/); assert.match(html, /<summary[^>]*>祝日翌日平日の履歴基準<\/summary>/); assert.ok(!/<details[^>]*\bopen/.test(html));
    for (const line of getHolidayBeforeNormalWeekdayReferenceDetailLines(basis.holidayBeforeNormalWeekdayReference!)) assert.ok(html.includes(line), line);
    assert.doesNotMatch(html, /undefined個|undefined件|なし個|NaN/); assert.deepEqual(copy(basis), before);
  }
  assert.match(markup(fixtures[0]), /通常の日曜/); assert.match(markup(fixtures[1]), /火木日/); assert.match(markup(fixtures[3]), /28個/); assert.match(markup(partial), /数値未保存/);
  const legacy = copy(fixtures[1]!); delete legacy.holidayBeforeNormalWeekdayReference;
  for (const basis of [undefined, legacy, { ...fixtures[0]!, comparisonMode: "weekday" as const }]) assert.doesNotMatch(markup(basis), /<details aria-label="祝日翌日平日の履歴基準"/);
});
test("actual AreaJudge TSX displays ordinary-Sunday adoption and fallback notice matching the selected source", async () => {
  const Judge = (await loadTsx(new URL("../src/components/screens/AreaJudgeScreen.tsx", import.meta.url))).AreaJudgeScreen as typeof AreaJudgeScreen;
  const noop = () => {};
  const html = (result: AreaCountRecommendation, time: "15" | "17") => {
    // Enter through the real insufficient/manual path, then update history
    // while the entered count remains on screen to inspect ready notices.
    let current = recommend(records({ sunday: [6, 6], time }), { discountTime: time });
    const component = new HookFixture(() => Judge({
      weekdayText: "月曜日", timeText: `${time}時`, areaId: AREA, areaName: "弁当・麺", calculatorDraftScope: `holiday52-${time}-${evidence(result).source}`,
      basisGuide: { referenceText: "10月・祝日翌日平日", referenceConditionLabel: "10月・祝日翌日平日" },
      areaCountAssistEnabled: true, initialAreaCount: 10, getAreaCountRecommendation: () => current,
      onJudge: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop,
    }));
    const findComplete = (node: React.ReactNode): (() => void) | undefined => {
      if (Array.isArray(node)) { for (const child of node) { const found = findComplete(child); if (found) return found; } return; }
      if (!React.isValidElement(node)) return;
      const props = node.props as { children?: React.ReactNode; onClick?: () => void };
      if (node.type === "button" && props.children === "完了") return props.onClick;
      return findComplete(props.children);
    };
    try {
      component.settle(true);
      const complete = findComplete(component.element); assert.ok(complete, "actual calculator completion action exists");
      complete(); component.settle();
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
      current = result; component.settle(true);
      const output = renderToStaticMarkup(component.element!); assert.ok(output.includes("入力した残数：10個")); return output;
    } finally { component.close(); }
  };
  for (const time of ["15", "17"] as const) {
    const ready = html(recommend(plentiful(time), { discountTime: time }), time), fallback = html(recommend(records({ sunday: [6, 6], other: Array(20).fill(30), time }), { discountTime: time }), time);
    assert.match(ready, /通常の日曜/); assert.doesNotMatch(ready, /通常の日曜の記録が足りないため/);
    assert.match(fallback, /通常の日曜の記録が足りないため/); assert.ok(fallback.includes(time === "15" ? "金土日" : "火木日"));
  }
});

let passed = 0;
for (const check of checks) {
  try { await check.run(); passed++; console.log(`PASS ${passed}: ${check.name}`); }
  catch (error) { console.error(`FAIL: ${check.name}`); console.error(error); process.exitCode = 1; }
}
assert.equal(timers.size, 0, "hook fixtures dispose production timers");
console.log(`\n祝日翌日平日・通常日曜優先52: ${passed}/${checks.length} PASS`);
