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
  getThreeDayHolidayMiddleReferenceDetailLines,
  mergeAreaCountRecordCollections,
  normalizeAreaCountDecisionBasis,
  normalizeAreaCountRecords,
  prepareAreaCountCalculationPopulation,
  type AreaCountDecisionBasis,
  type AreaCountRecord,
  type AreaCountRecommendation,
} from "../src/domain/areaCountHistory.ts";
import { buildSessionAnalysisCalendarContext } from "../src/domain/analysisMetadata.ts";
import { buildRemoteAreaCountRow, normalizeRemoteAreaCountRows } from "../src/domain/areaCountRemoteStorage.ts";
import { getFinalTimeGuide, getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import { initializeFinalizedDayDataInMemory, normalizeFinalizedDayData } from "../src/domain/finalizedDayData.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import {
  isDayBeforeJapaneseHoliday,
  isJapaneseHolidayOrObserved,
  isLongHolidayMiddle,
  isThreeDayHolidayMiddle,
} from "../src/domain/japaneseHoliday.ts";
import { isObonDate } from "../src/domain/obon.ts";
import { buildFinalDiscountGuideSnapshot, buildNormalRateDecisionSnapshot, normalizeRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { buildReview19ExportPayload, createInitialReview19Result } from "../src/domain/review19.ts";
import { buildReview19HistoryStatistics, prepareReview19HistoryPopulation } from "../src/domain/review19Evaluation.ts";
import { buildDirectFinalizedDayDataExportPayload } from "../src/domain/separateDataExport.ts";
import { loadCurrentSession, loadWorkSessionCheckpoint, saveCurrentSession, saveWorkSessionCheckpoint } from "../src/domain/storage.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeLoadedState, normalizeSessionDraft } from "../src/hooks/nebikiApp/stateNormalization.ts";
import type { DemandCycle, DiscountTime, Review19Result } from "../src/domain/types.ts";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";

// These fixtures execute production selection, rates, adapters and persistence
// builders. No real browser storage or network transport is used.
const TARGET = "2026-07-19";
const AREA = "bento_men" as const;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const weekday = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
const checks: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>): void => { checks.push({ name, run }); };

function ordinary(date: string): boolean {
  return !isJapaneseHolidayOrObserved(date) && !isDayBeforeJapaneseHoliday(date) &&
    !isThreeDayHolidayMiddle(date) && !isLongHolidayMiddle(date) && !isObonDate(date);
}

function dates(days: readonly number[], count: number, before = TARGET): string[] {
  const cursor = new Date(`${before}T00:00:00Z`);
  const found: string[] = [];
  for (let tries = 0; tries < 6000 && found.length < count; tries++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const date = cursor.toISOString().slice(0, 10);
    if (days.includes(cursor.getUTCDay()) && ordinary(date)) found.push(date);
  }
  assert.equal(found.length, count, "fixture dates must be available");
  return found.reverse();
}

function record(date: string, count: number, discountTime: DiscountTime = "17", patch: Partial<AreaCountRecord> = {}): AreaCountRecord {
  return {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-47",
    buildId: "build-three-day-fixture",
    demandCycle: "normal",
    date,
    sessionStartedAt: `${date}T08:00:00.000Z`,
    recordedAt: `${date}T08:05:00.000Z`,
    areaId: AREA,
    discountTime,
    actualWeekday: getActualWeekdayLabel(weekday(date)),
    actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({ date, weekday: weekday(date), discountTime }),
    count,
    ...patch,
  };
}

function records(params: {
  sunday?: number[]; tuesdayThursday?: number[]; fridaySaturday?: number[];
  discountTime?: DiscountTime; before?: string;
}): AreaCountRecord[] {
  const time = params.discountTime ?? "17";
  return [
    ...dates([0], params.sunday?.length ?? 0, params.before).map((date, i) => record(date, params.sunday![i]!, time, { demandCycle: i % 2 ? "summer" : "normal" })),
    ...dates([2, 4], params.tuesdayThursday?.length ?? 0, params.before).map((date, i) => record(date, params.tuesdayThursday![i]!, time)),
    ...dates([5, 6], params.fridaySaturday?.length ?? 0, params.before).map((date, i) => record(date, params.fridaySaturday![i]!, time)),
  ];
}

function recommend(history: AreaCountRecord[], patch: Partial<Parameters<typeof getAreaCountRecommendation>[0]> = {}): AreaCountRecommendation {
  return getAreaCountRecommendation({ records: history, areaId: AREA, discountTime: "17", date: TARGET, weekday: 0, demandCycle: "normal", count: 10, ...patch });
}

function middle(result: AreaCountRecommendation) {
  assert.equal(result.comparisonMode, "three_day_holiday_middle");
  assert.ok(result.threeDayHolidayMiddleReference);
  assert.ok(result.threeDayHolidayMiddleReference.sundayReference);
  return result.threeDayHolidayMiddleReference;
}

const plentiful = (time: DiscountTime = "17") => records({ sunday: [6, 6, 6], tuesdayThursday: Array(80).fill(30), fridaySaturday: [10, 10, 10], discountTime: time });

for (const discountTime of ["17", "18", "19", "20"] as const) {
  test(`${discountTime}: three ordinary Sundays outrank 80 different Tuesday/Thursday counts`, () => {
    const history = plentiful(discountTime);
    const before = copy(history);
    const result = recommend(history, { discountTime });
    const reference = middle(result);
    assert.equal(result.status, "ready");
    assert.equal(result.medianCount, 8);
    assert.equal(result.baseEvaluation, "slightly_many");
    assert.equal(result.areaRateAdjustment, 5);
    assert.equal(reference.adoptedSource, "both");
    assert.equal(reference.fireThursdaySundaySampleSize, 83);
    assert.equal(reference.fireThursdaySundayMedianCount, undefined);
    assert.equal(reference.fridaySaturdayMedianCount, 10);
    assert.equal(reference.sundayReference!.source, "weekday");
    assert.equal(reference.sundayReference!.adopted, true);
    assert.equal(reference.sundayReference!.weekdaySampleSize, 3);
    assert.equal(reference.sundayReference!.medianCount, 6);
    assert.equal(reference.sundayReference!.fallbackReason, undefined);
    assert.equal(result.matchedRecords.length, 6);
    assert.ok(result.matchedRecords.every(item => [0, 5, 6].includes(weekday(item.date))));
    assert.deepEqual(recommend(history, { discountTime, demandCycle: "summer" }).medianCount, result.medianCount);
    const preparedPopulation = prepareAreaCountCalculationPopulation(history);
    assert.deepEqual(recommend([], { discountTime, preparedPopulation }), result);
    assert.deepEqual(history, before);
  });
}

test("Saturday middle also compares ordinary Sunday, even with many ordinary Saturdays", () => {
  const date = "2026-03-21";
  assert.equal(isThreeDayHolidayMiddle(date), true);
  const result = recommend(records({ sunday: [6, 6, 6], tuesdayThursday: Array(40).fill(30), fridaySaturday: Array(30).fill(20), before: date }), { date, weekday: 6 });
  assert.equal(result.actualWeekday, "土");
  assert.equal(result.medianCount, 13);
  assert.equal(middle(result).sundayReference!.medianCount, 6);
  assert.equal(middle(result).sundayReference!.weekdaySampleSize, 3);
});

for (const size of [0, 1, 2]) {
  test(`Sunday ${size}: fallback combines Tuesday/Thursday/Sunday and Friday/Saturday 50:50`, () => {
    const result = recommend(records({ sunday: Array(size).fill(30), tuesdayThursday: Array(16).fill(30), fridaySaturday: [10, 10, 10] }));
    const reference = middle(result);
    assert.equal(result.medianCount, 20);
    assert.equal(result.baseEvaluation, "few");
    assert.equal(reference.adoptedSource, "both");
    assert.equal(reference.fireThursdaySundaySampleSize, 16 + size);
    assert.equal(reference.fireThursdaySundayMedianCount, 30);
    assert.equal(reference.sundayReference!.source, "fallback_group");
    assert.equal(reference.sundayReference!.weekdaySampleSize, size);
    assert.equal(reference.sundayReference!.fallbackReason, "insufficient_sunday_history");
    assert.equal(reference.sundayReference!.medianDownGuardApplied, false);
    assert.notEqual(result.medianCount, (30 * 16 + 10 * 3) / 19);
  });
}

test("Sunday-only valid reference is used at full strength", () => {
  const result = recommend(records({ sunday: [6, 6, 6], tuesdayThursday: Array(20).fill(99), fridaySaturday: [10, 10] }));
  assert.equal(result.status, "ready");
  assert.equal(result.medianCount, 6);
  assert.equal(middle(result).adoptedSource, "日");
  assert.equal(result.matchedRecords.length, 3);
});

test("Fallback-only valid reference keeps its full median", () => {
  const result = recommend(records({ sunday: [6, 6], tuesdayThursday: [30, 30, 30], fridaySaturday: [10, 10] }));
  assert.equal(result.medianCount, 30);
  assert.equal(middle(result).adoptedSource, "火木日");
  assert.equal(middle(result).sundayReference!.source, "fallback_group");
  assert.equal(middle(result).sundayReference!.adopted, true);
});

test("Friday/Saturday-only reference and both-insufficient retain existing status", () => {
  const only = recommend(records({ sunday: [6, 6], fridaySaturday: [10, 10, 10] }));
  assert.equal(only.medianCount, 10);
  assert.equal(middle(only).adoptedSource, "金土");
  assert.equal(middle(only).sundayReference!.adopted, false);
  const none = recommend(records({ sunday: [6], tuesdayThursday: [30], fridaySaturday: [10, 10] }));
  assert.equal(none.status, "insufficient");
  assert.equal(none.medianCount, undefined);
  assert.equal(middle(none).adoptedSource, "none");
  assert.equal(middle(none).sundayReference!.adopted, false);
});

test("Holiday, holiday eve, middle, long-holiday and Obon Sundays cannot reach Sunday minimum", () => {
  const specialDates = ["2026-05-03", "2026-01-11", "2025-11-23", "2025-05-04", "2023-08-13"];
  const actuallySpecial = specialDates.filter(date => !ordinary(date));
  assert.ok(actuallySpecial.length >= 5);
  assert.ok(actuallySpecial.some(isJapaneseHolidayOrObserved));
  assert.ok(actuallySpecial.some(isDayBeforeJapaneseHoliday));
  assert.ok(actuallySpecial.some(isThreeDayHolidayMiddle));
  assert.ok(actuallySpecial.some(isLongHolidayMiddle));
  assert.ok(actuallySpecial.some(isObonDate));
  const history = records({ sunday: [6, 6], tuesdayThursday: Array(20).fill(30), fridaySaturday: [10, 10, 10] });
  for (const date of actuallySpecial) {
    assert.equal(weekday(date), 0);
    history.push(record(date, 999, "17", { actualWeekdayGroup: "火木日" }));
  }
  const result = recommend(history);
  assert.equal(middle(result).sundayReference!.weekdaySampleSize, 2);
  assert.equal(middle(result).sundayReference!.source, "fallback_group");
  assert.equal(result.medianCount, 20);
  // A holiday eve can still belong to the existing Friday/Saturday side.
  // Only the ordinary Sunday side is newly restricted in this release.
  assert.ok(result.matchedRecords.filter(item => item.actualWeekdayGroup === "火木日").every(item => !actuallySpecial.includes(item.date)));
  history.push(record(dates([0], 3)[0]!, 6));
  const sundayReady = recommend(history);
  assert.equal(middle(sundayReady).sundayReference!.weekdaySampleSize, 3);
  assert.equal(middle(sundayReady).sundayReference!.medianCount, 6);
  assert.ok(sundayReady.matchedRecords.filter(item => item.actualWeekdayGroup === "火木日").every(item => ordinary(item.date)));
});

test("Sunday windows remain 16/52, with same-weekday long-median guard", () => {
  const sundayCounts = [...Array(44).fill(30), ...Array(16).fill(6)];
  const result = recommend(records({ sunday: sundayCounts, tuesdayThursday: Array(80).fill(99), fridaySaturday: [10, 10, 10] }));
  const sunday = middle(result).sundayReference!;
  assert.equal(sunday.weekdaySampleSize, 60);
  assert.equal(sunday.sampleSize, 60);
  assert.equal(sunday.shortSampleSize, 16);
  assert.equal(sunday.longSampleSize, 52);
  assert.equal(sunday.shortMedianCount, 6);
  assert.equal(sunday.longMedianCount, 30);
  assert.equal(sunday.medianCount, 28);
  assert.equal(sunday.medianDownGuardApplied, true);
  assert.equal(result.shortMedianCount, 8);
  assert.equal(result.longMedianCount, 20);
  assert.equal(result.medianCount, 19);
  assert.equal(result.medianDownGuardApplied, true);
  assert.equal(result.shortSampleSize, 19);
  assert.equal(result.longSampleSize, 55);
});

test("Legacy manual Tuesday-as-Sunday and captured special calendar do not supply ordinary Sundays", () => {
  const history = records({ sunday: [6, 6], tuesdayThursday: Array(20).fill(30), fridaySaturday: [10, 10, 10] });
  const manual = dates([2], 5).map(date => record(date, 99, "17", { actualWeekday: "日", actualWeekdayGroup: "火木日" }));
  const specialDate = dates([0], 3)[0]!;
  const captured = buildSessionAnalysisCalendarContext({ scope: "area_count", date: specialDate, weekday: 0, discountTime: "17", sessionStartedAt: `${specialDate}T08:00:00.000Z`, manualWeekdayOverride: false, areaDecisionBases: [] })!;
  const special = record(specialDate, 999, "17", { calendarContext: { ...captured, isHoliday: true, calendarCondition: "holiday" } });
  const result = recommend([...history, ...manual, special]);
  assert.equal(middle(result).sundayReference!.weekdaySampleSize, 2);
  assert.equal(middle(result).sundayReference!.source, "fallback_group");
  assert.equal(normalizeAreaCountRecords(manual)[0]!.actualWeekday, "日");
  assert.equal(manual[0]!.actualWeekdayGroup, "火木日");
});

test("Obon exclusion respects captured legacy calendar and pre-rule versions", () => {
  const history = records({ sunday: [6, 6], fridaySaturday: [10, 10, 10] });
  const date = "2023-08-13";
  const preRule = record(date, 6, "17", { appVersion: "2026.8.9-5" });
  assert.equal(middle(recommend([...history, preRule])).sundayReference!.weekdaySampleSize, 3);
  assert.equal(middle(recommend([...history, { ...preRule, appVersion: "2026.8.9-47" }])).sundayReference!.weekdaySampleSize, 2);
  const legacyCalendar = buildSessionAnalysisCalendarContext({ scope: "area_count", date, weekday: 0, discountTime: "17", sessionStartedAt: preRule.sessionStartedAt, manualWeekdayOverride: false, applyObonRule: false, areaDecisionBases: [] });
  assert.equal(middle(recommend([...history, { ...preRule, appVersion: "2026.8.9-47", calendarContext: legacyCalendar }])).sundayReference!.weekdaySampleSize, 3);
});

test("Fallback 16/52 still uses short median without guard", () => {
  const result = recommend(records({ sunday: [6, 6], tuesdayThursday: [...Array(44).fill(30), ...Array(16).fill(6)], fridaySaturday: [10, 10, 10] }));
  const sunday = middle(result).sundayReference!;
  assert.equal(sunday.source, "fallback_group");
  assert.equal(sunday.shortSampleSize, 16);
  assert.equal(sunday.longSampleSize, 52);
  assert.equal(sunday.shortMedianCount, 6);
  assert.equal(sunday.longMedianCount, 30);
  assert.equal(sunday.medianCount, 6);
  assert.equal(sunday.medianDownGuardApplied, false);
  assert.equal(result.medianCount, 8);
  assert.equal(result.medianDownGuardApplied, false);
});

test("Unequal population sizes and decimal medians keep an unrounded 50:50 result", () => {
  const result = recommend(records({ sunday: Array(40).fill(6), fridaySaturday: [11, 11, 11] }));
  assert.equal(result.medianCount, 8.5);
  assert.notEqual(result.medianCount, (6 * 40 + 11 * 3) / 43);
  assert.equal(result.lowerSmallThreshold, 6.5);
  assert.equal(normalizeAreaCountDecisionBasis(copy(buildAreaCountDecisionBasis({ recommendation: result })))?.medianCount, 8.5);
});

test("Canonical normal/summer duplicates, latest observations and wrong date/area/time do not inflate Sunday minimum", () => {
  const history = records({ sunday: [6, 6], tuesdayThursday: Array(20).fill(30), fridaySaturday: [10, 10, 10] });
  const first = history[0]!;
  history.push(copy(first), copy(first), { ...copy(first), demandCycle: "summer" }, { ...copy(first), sessionStartedAt: `${first.date}T08:02:00.000Z`, recordedAt: `${first.date}T08:06:00.000Z`, count: 7 });
  history.push(record(TARGET, 999), record("2026-07-26", 999), { ...record(dates([0], 3)[0]!, 999), areaId: "sushi" }, record(dates([0], 3)[0]!, 999, "18"));
  const before = copy(history);
  const canonical = dedupeLatestAreaCountCalculationRecordsByDateAreaTime(normalizeAreaCountRecords(history));
  assert.equal(canonical.find(item => item.date === first.date && item.areaId === AREA && item.discountTime === "17")?.count, 7);
  const result = recommend(history);
  assert.equal(middle(result).sundayReference!.weekdaySampleSize, 2);
  assert.equal(middle(result).sundayReference!.source, "fallback_group");
  assert.equal(result.medianCount, 20);
  assert.deepEqual(recommend([...history].reverse()), result);
  assert.deepEqual(history, before);
});

test("15:00 remains on its prior Friday/Saturday/Sunday reference", () => {
  const result = recommend(plentiful("15"), { discountTime: "15" });
  assert.equal(result.comparisonMode, "fallback_group");
  assert.equal(result.actualWeekdayGroup, "金土日");
  assert.equal(result.medianCount, 8);
  assert.equal(result.threeDayHolidayMiddleReference, undefined);
});

test("Ordinary Sunday, Tuesday, Friday and four-day-holiday rules keep their existing references", () => {
  const sundayDate = "2026-07-12";
  const history = records({ sunday: [6, 6, 6], tuesdayThursday: Array(20).fill(30), fridaySaturday: [10, 10, 10], before: sundayDate });
  const sunday = recommend(history, { date: sundayDate, weekday: 0 });
  assert.equal(sunday.comparisonMode, "weekday");
  assert.equal(sunday.medianCount, 6);
  const tuesday = recommend(history, { date: "2026-07-14", weekday: 2 });
  assert.equal(tuesday.comparisonMode, "weekday");
  assert.equal(tuesday.medianCount, 30);
  const friday = recommend(history, { date: "2026-07-17", weekday: 5 });
  assert.equal(friday.medianCount, 10);
  for (const result of [sunday, tuesday, friday]) assert.equal(result.threeDayHolidayMiddleReference, undefined);
  const long = recommend(records({ sunday: [6, 6, 6], tuesdayThursday: Array(20).fill(30), fridaySaturday: [10, 10, 10], before: "2026-05-04" }), { date: "2026-05-04", weekday: 1 });
  assert.equal(long.comparisonMode, "fallback_group");
  assert.equal(long.medianCount, 10);
  assert.equal(long.threeDayHolidayMiddleReference, undefined);
});

test("Captured legacy adopted source and medians are preserved without new Sunday metadata", () => {
  const legacy = buildAreaCountDecisionBasis({ recommendation: recommend(records({ sunday: [6, 6], tuesdayThursday: Array(20).fill(30), fridaySaturday: [10, 10, 10] })) });
  delete legacy.threeDayHolidayMiddleReference!.sundayReference;
  const before = copy(legacy);
  const normalized = normalizeAreaCountDecisionBasis(copy(legacy));
  assert.deepEqual(copy(normalized), before);
  assert.equal(normalized?.threeDayHolidayMiddleReference?.sundayReference, undefined);
  assert.equal(normalized?.threeDayHolidayMiddleReference?.adoptedSource, "both");
  assert.equal(normalized?.medianCount, 20);
  const old = record(TARGET, 10, "17", { decisionBasis: legacy });
  assert.deepEqual(copy(normalizeAreaCountRecords([old])[0]!.decisionBasis), before);
  assert.deepEqual(copy(normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(old)])[0]!.decisionBasis), before);
});

test("Canonical winner retains its own legacy basis without supplementing new Sunday adoption metadata", () => {
  const modernBasis = buildAreaCountDecisionBasis({ recommendation: recommend(plentiful()) });
  const legacyBasis = copy(modernBasis);
  delete legacyBasis.threeDayHolidayMiddleReference!.sundayReference;
  legacyBasis.medianCount = 20;
  const old = record(TARGET, 10, "17", { decisionBasis: legacyBasis, recordedAt: `${TARGET}T08:07:00.000Z` });
  const modern = record(TARGET, 10, "17", { decisionBasis: modernBasis });
  const merged = mergeAreaCountRecordCollections([modern], [old])[0]!;
  assert.equal(merged.decisionBasis?.medianCount, 20);
  assert.equal(merged.decisionBasis?.threeDayHolidayMiddleReference?.sundayReference, undefined);
  const differentIdentity = { ...modern, demandCycle: "summer" as const, sessionStartedAt: `${TARGET}T08:01:00.000Z` };
  const winner = dedupeLatestAreaCountCalculationRecordsByDateAreaTime([differentIdentity, old])[0]!;
  assert.equal(winner.recordedAt, old.recordedAt);
  assert.equal(winner.decisionBasis?.medianCount, 20);
  assert.equal(winner.decisionBasis?.threeDayHolidayMiddleReference?.sundayReference, undefined);
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

for (const demandCycle of ["normal", "summer"] as const) {
  test(`${demandCycle}: real rate, current/checkpoint restore, AreaCount, daily/finalized/exports retain captured Sunday basis`, () => {
    const result = recommend(plentiful(), { demandCycle });
    const basis = buildAreaCountDecisionBasis({ recommendation: result, evaluationSource: "history", finalEvaluation: result.suggestedEvaluation, areaRateAdjustment: result.areaRateAdjustment });
    const draft = normalizeSessionDraft({ date: TARGET, weekday: 0, discountTime: "17", demandCycle });
    const state = createInitialState(draft);
    state.session = { ...draft, startedAt: `${TARGET}T08:00:00.000Z` };
    state.screen = "rate_display";
    state.currentAreaId = AREA;
    const weather = resolveWeatherInputForDiscount({ hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null }, "17");
    const weekdayBase = getWeekdayBaseInfo(0, "17", weather, TARGET, demandCycle);
    const rate = buildNormalRateDecisionSnapshot({ confirmedAt: `${TARGET}T08:05:00.000Z`, sessionDiscountTime: "17", demandCycle, weatherComfortAdjustmentPercent: weekdayBase.baseRateBonus, areaJudge: result.suggestedJudge!, areaRateAdjustment: result.areaRateAdjustment, resolvedWeather: weather, weekday: 0, date: TARGET, globalDiscountAdjustmentPercent: 0 });
    const display = getNormalTimeRateDisplay({ discountTime: "17", weatherBonus: weekdayBase.baseRateBonus, areaJudge: result.suggestedJudge!, areaRateAdjustment: result.areaRateAdjustment, date: TARGET, weekday: 0 });
    assert.deepEqual(rate.display, display);
    assert.equal(rate.normalRatePercent, 15);
    assert.equal(rate.manyRatePercent, 25);
    assert.equal(normalizeRateDecisionSnapshot(copy(rate))?.normalRatePercent, 15);
    state.areaProgressMap[AREA] = { areaId: AREA, status: "completed", areaJudge: result.suggestedJudge!, areaCount: 10, areaCountEvaluation: result.suggestedEvaluation, areaCountEvaluationSource: "history", areaCountDecisionBasis: basis, areaRateAdjustment: result.areaRateAdjustment, rateDecisionSnapshot: rate, completedAt: `${TARGET}T08:05:00.000Z` };
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
    try {
      saveCurrentSession(state);
      saveWorkSessionCheckpoint(state);
      for (const loaded of [loadCurrentSession(), loadWorkSessionCheckpoint()]) {
        const restored = normalizeLoadedState(loaded, draft);
        assert.deepEqual(copy(restored.areaProgressMap[AREA].areaCountDecisionBasis), copy(basis));
        assert.equal(restored.areaProgressMap[AREA].rateDecisionSnapshot?.normalRatePercent, 15);
      }
    } finally {
      if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
    const observed = record(TARGET, 10, "17", { demandCycle, decisionBasis: basis, suggestedEvaluation: result.suggestedEvaluation, areaRateAdjustment: result.areaRateAdjustment });
    const restoredRecord = normalizeAreaCountRecords(copy([observed]))[0]!;
    assert.deepEqual(copy(restoredRecord.decisionBasis), copy(basis));
    assert.deepEqual(copy(normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(observed)])[0]!.decisionBasis), copy(basis));
    const daily = createDailySessionSnapshot({ capturedAt: `${TARGET}T08:10:00.000Z`, state, resolvedWeather: weather, weekdayBaseInfo: weekdayBase, basisGuide: getBasisGuideDisplay({ date: TARGET, weekday: 0, discountTime: "17", demandCycle, weather }), lateTimeBonus: 0, doneSummaryItems: [], sessionEndReason: "auto_time_transition" })!;
    assert.deepEqual(copy(daily.areas[AREA].areaCountDecisionBasis), copy(basis));
    assert.equal(daily.areas[AREA].rateDecisionSnapshot?.normalRatePercent, 15);
    const calendarReference = daily.calendarContext!.areaCountReference.find(item => item.areaId === AREA)!;
    assert.equal(calendarReference.type, "composite_weekday_and_group");
    assert.equal(calendarReference.referenceWeekday, "日");
    assert.deepEqual(calendarReference.referenceWeekdayGroups, ["金土"]);
    const day = createReview19DaySnapshot({ capturedAt: `${TARGET}T11:35:00.000Z`, date: TARGET, demandCycle, sessions: [daily], areaCountRecords: [observed] });
    const finalized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot: day, finalizedAt: day.capturedAt }).record;
    const exported = buildDirectFinalizedDayDataExportPayload({ record: finalized, exportedAt: `${TARGET}T12:00:00.000Z` });
    const restoredDay = normalizeFinalizedDayData(copy(exported.daySnapshot))!;
    assert.equal(exported.dataSchemaVersion, 3);
    for (const snapshot of [day, finalized, exported.daySnapshot, restoredDay]) {
      assert.deepEqual(copy(snapshot.areaCountRecords[0]!.decisionBasis), copy(basis));
      assert.deepEqual(copy(snapshot.sessions[0]!.areas[AREA].areaCountDecisionBasis), copy(basis));
      assert.equal(snapshot.sessions[0]!.areas[AREA].rateDecisionSnapshot?.normalRatePercent, 15);
    }
    const review = createInitialReview19Result({ date: TARGET, demandCycle, sessionStartedAt: state.session.startedAt, reviewStartedAt: `${TARGET}T10:00:00.000Z` });
    review.daySnapshot = day;
    const reviewExport = buildReview19ExportPayload({ records: [review], exportedAt: `${TARGET}T12:00:00.000Z` });
    assert.deepEqual(copy(reviewExport.records[0]!.daySnapshot!.sessions[0]!.areas[AREA].areaCountDecisionBasis), copy(basis));
  });
}

test("20:30 changed evaluation reaches final guide and snapshot; forced snow still gives all 50%", () => {
  const result = recommend(plentiful("20"), { discountTime: "20" });
  assert.equal(result.medianCount, 8);
  assert.equal(result.suggestedEvaluation, "slightly_many");
  const sunnyParams = { weather21: "sunny" as const, temp21C: 25, comfortScore: 0, weekday: 0 };
  // The 47/48 runtime comparison independently verifies that this fixture's
  // captured 47 evaluation was "few". The final engine itself is unchanged.
  const beforeGuide = getFinalTimeGuide({ ...sunnyParams, areaCountEvaluation: "few" });
  const afterGuide = getFinalTimeGuide({ ...sunnyParams, areaCountEvaluation: result.suggestedEvaluation });
  const rates = (value: typeof afterGuide) => [value.count1.main, value.count2.main, value.count3OrMore.main];
  assert.deepEqual(rates(beforeGuide), ["30%", "40%", "50%"]);
  assert.equal(beforeGuide.score, 0);
  assert.deepEqual(rates(afterGuide), ["40%", "50%", "50%"]);
  assert.equal(afterGuide.score, 1);
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const forecast of Object.values(hourlyForecasts)) Object.assign(forecast, { weather: "sunny", tempC: 25 });
  const resolvedWeather = resolveWeatherInputForDiscount({ hourlyForecasts, afterRainSky: null }, "20");
  for (const [finalGuide, rate] of [[beforeGuide, 30], [afterGuide, 40]] as const) {
    const snapshot = buildFinalDiscountGuideSnapshot({ confirmedAt: `${TARGET}T11:35:00.000Z`, finalGuide, resolvedWeather });
    assert.equal(snapshot.calculationMode, "final");
    assert.equal(snapshot.displayedRatePercent, rate);
    assert.equal(snapshot.displayedManyRatePercent, 50);
    assert.deepEqual(snapshot.finalGuide, finalGuide);
    assert.deepEqual(normalizeRateDecisionSnapshot(copy(snapshot)), snapshot);
  }
  const guide = getFinalTimeGuide({ weather21: "snow", temp21C: 20, comfortScore: 0, weekday: 0, areaCountEvaluation: result.suggestedEvaluation });
  assert.equal(guide.count1.main, "50%");
  assert.equal(guide.count2.main, "50%");
  assert.equal(guide.count3OrMore.main, "50%");
});

test("Review19 temporary 19:00 statistics adopt Sunday while preserving human-only evaluation", () => {
  const history = plentiful("19").map((item): Review19Result => {
    const review = createInitialReview19Result({ date: item.date, demandCycle: item.demandCycle, sessionStartedAt: item.sessionStartedAt, reviewStartedAt: item.recordedAt });
    return { ...review, recordedAt: item.recordedAt, reviewCompletedAt: item.recordedAt, areaCounts: { [AREA]: item.count }, areaCountRecordedAt: { [AREA]: item.recordedAt } };
  });
  const before = copy(history);
  const args = { areaId: AREA, count: 10, date: TARGET, weekday: 0, demandCycle: "normal" as DemandCycle, historicalRecords: history };
  const statistics = buildReview19HistoryStatistics(args);
  assert.equal(statistics.autoEvaluationBasis.medianCount, 8);
  assert.equal(statistics.autoEvaluationBasis.threeDayHolidayMiddleReference?.sundayReference?.source, "weekday");
  assert.deepEqual(buildReview19HistoryStatistics({ ...args, preparedHistory: prepareReview19HistoryPopulation(history) }), statistics);
  for (const field of ["baseEvaluation", "finalEvaluation", "areaRateAdjustment", "smallDifferenceThreshold", "lowerSmallThreshold"]) assert.equal(field in statistics.autoEvaluationBasis, false);
  assert.equal("autoEvaluation" in statistics, false);
  assert.deepEqual(history, before);
});

test("Calendar metadata preserves Sunday-only, new composite and legacy group adoption", () => {
  const both = buildAreaCountDecisionBasis({ recommendation: recommend(plentiful()) });
  const only = buildAreaCountDecisionBasis({ recommendation: recommend(records({ sunday: [6, 6, 6], fridaySaturday: [10, 10] })) });
  const fallback = buildAreaCountDecisionBasis({ recommendation: recommend(records({ sunday: [6, 6], tuesdayThursday: Array(16).fill(30), fridaySaturday: [10, 10, 10] })) });
  const legacy = copy(fallback);
  delete legacy.threeDayHolidayMiddleReference!.sundayReference;
  for (const [basis, type, referenceWeekday, groups] of [
    [both, "composite_weekday_and_group", "日", ["金土"]],
    [only, "weekday", "日", []],
    [fallback, "composite_weekday_groups", null, ["火木日", "金土"]],
    [legacy, "composite_weekday_groups", null, ["火木日", "金土"]],
  ] as const) {
    const context = buildSessionAnalysisCalendarContext({ date: TARGET, weekday: 0, discountTime: "17", sessionStartedAt: `${TARGET}T08:00:00.000Z`, manualWeekdayOverride: false, areaDecisionBases: [{ areaId: AREA, basis }] })!;
    assert.equal(context.areaCountReference[0]!.type, type);
    assert.equal(context.areaCountReference[0]!.referenceWeekday, referenceWeekday);
    assert.deepEqual(context.areaCountReference[0]!.referenceWeekdayGroups, groups);
  }
});

// Compile and execute the actual production TSX dependencies with React SSR.
// This checks rendered evidence; native layout/touch delivery needs a browser.
const modules = new Map<string, Record<string, unknown>>();
async function loadTsx(url: URL): Promise<Record<string, unknown>> {
  const cached = modules.get(url.href);
  if (cached) return cached;
  const source = readFileSync(url, "utf8");
  const ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dependencies = new Map<string, unknown>([["react", React], ["react/jsx-runtime", jsxRuntime]]);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
    const id = statement.moduleSpecifier.text;
    if (dependencies.has(id)) continue;
    assert.ok(id.startsWith("."), `local production dependency: ${id}`);
    const target = [id, `${id}.ts`, `${id}.tsx`].map(path => new URL(path, url)).find(path => existsSync(path));
    assert.ok(target, `actual dependency exists: ${id}`);
    dependencies.set(id, target.pathname.endsWith(".tsx") ? await loadTsx(target) : await import(target.href));
  }
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: (id: string) => { assert.ok(dependencies.has(id)); return dependencies.get(id); },
  });
  modules.set(url.href, exports);
  return exports;
}

test("Actual RateDisplay TSX renders captured Sunday/fallback/only/insufficient/legacy details", async () => {
  const Rate = (await loadTsx(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url))).RateDisplayScreen as typeof RateDisplayScreen;
  const noop = () => {};
  const markup = (basis?: AreaCountDecisionBasis) => renderToStaticMarkup(React.createElement(Rate, {
    weekdayText: "日曜日", timeText: "17時", areaName: "弁当・麺", discountTime: "17", areaCount: 10,
    basisGuide: { referenceText: "7月・三連休中日・17時", referenceConditionLabel: "7月・三連休中日・17時" },
    areaCountDecisionBasis: basis, rateDisplay: { normal: { main: "15%" }, many: { main: "25%" }, few: { main: "引かない" } },
    onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop,
  }));
  const fixtures = [
    recommend(plentiful()),
    recommend(records({ sunday: [6, 6], tuesdayThursday: Array(16).fill(30), fridaySaturday: [10, 10, 10] })),
    recommend(records({ sunday: [6, 6, 6], fridaySaturday: [10, 10] })),
    recommend(records({ sunday: [6, 6], fridaySaturday: [10, 10, 10] })),
    recommend(records({ sunday: [6], fridaySaturday: [10, 10] })),
  ].map(recommendation => buildAreaCountDecisionBasis({ recommendation }));
  const legacy = copy(fixtures[1]!);
  delete legacy.threeDayHolidayMiddleReference!.sundayReference;
  const guarded = buildAreaCountDecisionBasis({ recommendation: recommend(records({ sunday: [...Array(44).fill(30), ...Array(16).fill(6)], fridaySaturday: [10, 10, 10] })) });
  const partial = copy(fixtures[0]!);
  delete partial.threeDayHolidayMiddleReference!.sundayReference!.medianCount;
  delete partial.threeDayHolidayMiddleReference!.sundayReference!.shortMedianCount;
  delete partial.threeDayHolidayMiddleReference!.sundayReference!.longMedianCount;
  for (const basis of [...fixtures, legacy, partial, guarded]) {
    const before = copy(basis);
    const html = markup(basis);
    assert.match(html, /<details aria-label="三連休中日の履歴基準"/);
    assert.match(html, /<summary[^>]*>三連休中日の履歴基準<\/summary>/);
    assert.ok(!/<details[^>]*\bopen/.test(html), "reference details start collapsed");
    for (const line of getThreeDayHolidayMiddleReferenceDetailLines(basis.threeDayHolidayMiddleReference!, basis.requiredSampleSize)) assert.ok(html.includes(line), line);
    assert.doesNotMatch(html, /undefined個|undefined件|なし個|NaN/);
    assert.deepEqual(copy(basis), before, "render preserves saved evidence");
  }
  assert.match(markup(fixtures[0]), /通常の日曜の記録：3\/3件（採用基準 6個）/);
  assert.match(markup(fixtures[1]), /通常の日曜の記録が足りないため、火木日へフォールバック/);
  assert.doesNotMatch(markup(legacy), /通常の日曜の記録：/);
  assert.match(markup(partial), /数値未保存/);
  assert.match(markup(guarded), /日曜の短期中央値：6個（直近16件）/);
  assert.match(markup(guarded), /日曜の長期中央値：30個（最大52件）/);
  assert.match(markup(guarded), /基準を下げすぎないように28個を採用/);
  assert.match(markup(guarded), /採用基準を19個とします/);
  for (const basis of [undefined, buildAreaCountDecisionBasis({ recommendation: recommend(plentiful("15"), { discountTime: "15" }) }), { ...fixtures[0]!, comparisonMode: "weekday" as const }]) {
    assert.doesNotMatch(markup(basis), /<details aria-label="三連休中日の履歴基準"/);
  }
});

let passed = 0;
for (const check of checks) {
  try { await check.run(); passed++; console.log(`PASS: ${passed}. ${check.name}`); }
  catch (error) { console.error(`FAIL: ${check.name}`); console.error(error); process.exitCode = 1; }
}
console.log(`\n三連休中日・通常日曜優先: ${passed}/${checks.length} PASS`);
