import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAreaCountDecisionBasis, getActualWeekdayLabel, getAreaCountFallbackWeekdayGroup, getAreaCountComparisonFallbackWeekdayGroup,
  getAreaCountRecommendation, normalizeAreaCountDecisionBasis, normalizeAreaCountRecords,
  prepareAreaCountCalculationPopulation, type AreaCountRecord, type AreaCountRecommendation,
} from "../src/domain/areaCountHistory.ts";
import { buildSessionAnalysisCalendarContext, normalizeAnalysisCalendarContext } from "../src/domain/analysisMetadata.ts";
import { buildRemoteAreaCountRow, normalizeRemoteAreaCountRows } from "../src/domain/areaCountRemoteStorage.ts";
import { getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import { initializeFinalizedDayDataInMemory, normalizeFinalizedDayData } from "../src/domain/finalizedDayData.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { isDayBeforeJapaneseHoliday, isJapaneseHolidayOrObserved, isLongHolidayMiddle, isThreeDayHolidayMiddle } from "../src/domain/japaneseHoliday.ts";
import { isObonDate } from "../src/domain/obon.ts";
import { buildNormalRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { buildDirectFinalizedDayDataExportPayload } from "../src/domain/separateDataExport.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeSessionDraft } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import type { ActualWeekdayGroup, DiscountTime } from "../src/domain/types.ts";

// Production selection, rates, canonical observations and export builders run
// here. The v61 fixture is frozen output from the completed release, not an
// implementation of either version's recommendation algorithm.
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const AREA = "bento_men" as const;
const checks: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void) => checks.push({ name, run });
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const ordinary = (date: string) => !isJapaneseHolidayOrObserved(date) && !isDayBeforeJapaneseHoliday(date) && !isLongHolidayMiddle(date) && !isThreeDayHolidayMiddle(date) && !isObonDate(date);
const GROUPS: Record<"15" | "17", readonly ActualWeekdayGroup[]> = {
  "15": ["金土日", "月火", "月火", "水木", "水木", "金土日", "金土日"],
  "17": ["日月火", "日月火", "日月火", "水木", "水木", "金土", "金土"],
};
function legacyGroup(day: number, time: DiscountTime): ActualWeekdayGroup {
  return day === 1 || day === 3 ? "月水" : day === 2 || day === 4 ? time === "15" ? "火木" : "火木日" : day === 0 ? time === "15" ? "金土日" : "火木日" : time === "15" ? "金土日" : "金土";
}
function dates(days: readonly number[], count: number, before = "2026-11-09"): string[] {
  const cursor = new Date(`${before}T00:00:00Z`), found: string[] = [];
  for (let tries = 0; tries < 6000 && found.length < count; tries++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const date = cursor.toISOString().slice(0, 10);
    if (days.includes(cursor.getUTCDay()) && ordinary(date)) found.push(date);
  }
  assert.equal(found.length, count, "fixture dates exist");
  return found.reverse();
}
function record(date: string, count: number, time: DiscountTime = "17", patch: Partial<AreaCountRecord> = {}): AreaCountRecord {
  return { dataSchemaVersion: 3, appVersion: "2026.8.9-61", demandCycle: "normal", date,
    sessionStartedAt: `${date}T08:00:00.000Z`, recordedAt: `${date}T08:05:00.000Z`,
    areaId: AREA, discountTime: time, actualWeekday: getActualWeekdayLabel(weekday(date)),
    actualWeekdayGroup: legacyGroup(weekday(date), time), count, ...patch };
}
const history = (days: readonly number[], count: number, size = 3, time: DiscountTime = "17", before?: string) => dates(days, size, before).map(date => record(date, count, time));
function recommend(records: AreaCountRecord[], patch: Partial<Parameters<typeof getAreaCountRecommendation>[0]> = {}) {
  return getAreaCountRecommendation({ records, areaId: AREA, discountTime: "17", date: "2026-11-09", weekday: 1, count: 10, ...patch });
}
function rate(result: AreaCountRecommendation, time: "15" | "17", date = "2026-11-09", day = weekday(date)) {
  assert.ok(result.suggestedJudge);
  return getNormalTimeRateDisplay({ discountTime: time, weatherBonus: 0, areaJudge: result.suggestedJudge!, areaRateAdjustment: result.areaRateAdjustment, date, weekday: day });
}
function projection(result: AreaCountRecommendation) {
  const fields = ["status", "sampleSize", "requiredSampleSize", "comparisonMode", "medianCount", "shortMedianCount", "longMedianCount", "shortSampleSize", "longSampleSize", "medianDownGuardApplied", "smallDifferenceThreshold", "largeDifferenceThreshold", "lowerLargeThreshold", "lowerSmallThreshold", "upperSmallThreshold", "upperLargeThreshold", "baseEvaluation", "suggestedEvaluation", "suggestedJudge", "areaRateAdjustment", "decreaseRecommendation"] as const;
  return copy(Object.fromEntries(fields.map(key => [key, key === "decreaseRecommendation" && result[key] ? Object.fromEntries(Object.entries(result[key]!).filter(([name]) => name !== "detailLines")) : result[key]]).concat([["matched", result.matchedRecords.map(item => [item.date, item.count, item.demandCycle])]])));
}

for (const time of ["15", "17"] as const) for (let day = 0; day < 7; day++) {
  test(`${time}/${getActualWeekdayLabel(day)}: exact new ordinary membership`, () => {
    const date = `2026-11-${String(8 + day).padStart(2, "0")}`;
    assert.equal(ordinary(date), true);
    assert.equal(getAreaCountComparisonFallbackWeekdayGroup({ date, weekday: day, discountTime: time }), GROUPS[time][day]);
    assert.equal(getAreaCountFallbackWeekdayGroup({ date, weekday: day, discountTime: time }), legacyGroup(day, time), "stored column retains the SQL-compatible legacy classification");
  });
}

const baseline = JSON.parse(readFileSync(new URL("./weekday-fallback61-fixtures.json", import.meta.url), "utf8")) as {
  sourceVersion: string; sourceZipSha256: string;
  cases: { time: "15" | "17"; weekday: number; target: string; expected: unknown; rate: unknown }[];
  numericCase: { params: Parameters<typeof getAreaCountRecommendation>[0]; expected: { status: string; comparisonMode: string; medianCount: number; suggestedEvaluation: string; areaRateAdjustment: number; matchedDates: string[] }; rate: ReturnType<typeof getNormalTimeRateDisplay> };
};
assert.equal(baseline.sourceVersion, "2026.8.9-61");
assert.equal(baseline.sourceZipSha256, "dbae2498d81b3380ba015012e3cbf665a5ba083af03ec0699d0fb2943a1e2d88");
assert.equal(baseline.cases.length, 14);
for (const fixture of baseline.cases) test(`${fixture.time}/${fixture.weekday}: three same-weekday samples match completed v61 fields and rates`, () => {
  const records = dates([fixture.weekday], 3, fixture.target).map((date, index) => record(date, 12 + 2 * index, fixture.time));
  for (let day = 0; day < 7; day++) if (day !== fixture.weekday) records.push(...history([day], 99, 2, fixture.time, fixture.target));
  if (fixture.time === "17") records.push(...records.map(item => record(item.date, 28, "15")), record(fixture.target, 20, "15"));
  const before = copy(records), result = recommend(records, { date: fixture.target, weekday: fixture.weekday, discountTime: fixture.time });
  assert.deepEqual(projection(result), fixture.expected);
  assert.deepEqual(rate(result, fixture.time, fixture.target, fixture.weekday), fixture.rate);
  assert.deepEqual(recommend([], { date: fixture.target, weekday: fixture.weekday, discountTime: fixture.time, preparedPopulation: prepareAreaCountCalculationPopulation(records) }), result);
  assert.deepEqual(records, before);
});

for (const [time, day, include, exclude] of [["15", 1, 2, 3], ["15", 2, 1, 4], ["17", 1, 2, 3], ["17", 3, 4, 1], ["17", 4, 3, 2]] as const) {
  test(`${time}/${day}: legacy labels reclassify actual ${include}, excluding former peer ${exclude}`, () => {
    const date = `2026-11-${String(8 + day).padStart(2, "0")}`;
    const records = [...history([include], 6, 3, time, date), ...history([exclude], 30, 3, time, date)];
    const original = copy(records), result = recommend(records, { date, weekday: day, discountTime: time });
    assert.equal(result.comparisonMode, "fallback_group"); assert.equal(result.status, "ready");
    assert.equal(result.medianCount, 6); assert.equal(result.areaRateAdjustment, 10); assert.equal(result.suggestedEvaluation, "many");
    assert.ok(result.matchedRecords.every(item => weekday(item.date) === include));
    assert.deepEqual(records, original);
    assert.deepEqual(normalizeAreaCountRecords(records).map(item => item.actualWeekdayGroup), original.map(item => item.actualWeekdayGroup), "normalization preserves saved labels");
  });
}

test("numeric v61→v62 fallback example changes median 30/few/-10 to 6/many/+10 and actual 17:00 rates 0/10→20/30", () => {
  const original = baseline.numericCase;
  assert.deepEqual([original.expected.medianCount, original.expected.suggestedEvaluation, original.expected.areaRateAdjustment], [30, "few", -10]);
  assert.deepEqual([original.rate.normal.main, original.rate.many.main], ["0%", "10%"]);
  const result = getAreaCountRecommendation(copy(original.params)), displayed = rate(result, "17");
  assert.deepEqual([result.medianCount, result.suggestedEvaluation, result.areaRateAdjustment], [6, "many", 10]);
  assert.deepEqual([displayed.normal.main, displayed.many.main], ["20%", "30%"]);
  console.log("NUMERIC62: 17:00 Monday, current10, Tuesday6×3 + Wednesday30×3; v61 median30/few/-10 normal0% many10%; v62 median6/many/+10 normal20% many30%");
});

for (const time of ["15", "17"] as const) for (let day = 0; day < 7; day++) {
  test(`${time}/${getActualWeekdayLabel(day)}: actual fallback selects exactly new peers despite stored legacy labels`, () => {
    const date = `2026-11-${String(8 + day).padStart(2, "0")}`, group = GROUPS[time][day];
    const peer = GROUPS[time].findIndex((candidate, candidateDay) => candidateDay !== day && candidate === group);
    const excluded = GROUPS[time].findIndex(candidate => candidate !== group);
    assert.ok(peer >= 0 && excluded >= 0);
    const records = [...history([day], 6, 2, time, date), ...history([peer], 6, 1, time, date), ...history([excluded], 999, 6, time, date)];
    const result = recommend(records, { date, weekday: day, discountTime: time });
    assert.equal(result.comparisonMode, "fallback_group"); assert.equal(result.actualWeekdayGroup, group); assert.equal(result.sampleSize, 3); assert.equal(result.medianCount, 6);
    assert.ok(result.matchedRecords.every(item => [day, peer].includes(weekday(item.date))));
  });
}

test("exactly two same-weekday samples fallback; the third immediately restores weekday priority", () => {
  const two = [...history([1], 6, 2), ...history([2], 30, 6)];
  const before = recommend(two); assert.equal(before.comparisonMode, "fallback_group"); assert.equal(before.medianCount, 30);
  const after = recommend([...two, record(dates([1], 3)[0]!, 6)]);
  assert.equal(after.comparisonMode, "weekday"); assert.equal(after.sampleSize, 3); assert.equal(after.medianCount, 6);
});
test("two observations remain insufficient despite duplicate source/cycle/session copies", () => {
  const originals = history([2], 6, 2), first = originals[0]!;
  const records = [...originals, copy(first), copy(first), { ...copy(first), demandCycle: "summer" as const }, { ...copy(first), recordedAt: `${first.date}T08:07:00.000Z`, sessionStartedAt: `${first.date}T08:01:00.000Z` }];
  const result = recommend(records); assert.equal(result.status, "insufficient"); assert.equal(result.sampleSize, 2); assert.equal(result.suggestedEvaluation, undefined);
  assert.deepEqual(recommend([...records].reverse()), result);
});
test("current/future/wrong area/wrong checkpoint and invalid counts cannot enter new fallback", () => {
  const originals = history([2], 6), other = dates([2], 4)[0]!;
  const records = [...originals, record("2026-11-09", 999), record("2026-11-10", 999), record(other, 999, "17", { areaId: "sushi" }), record(other, 999, "15"), record(other, -1), record(other, Number.NaN)];
  const result = recommend(records); assert.equal(result.sampleSize, 3); assert.equal(result.medianCount, 6); assert.deepEqual(result.matchedRecords.map(item => item.date), originals.map(item => item.date));
});
test("date-inferred weekday is eligible; unknown legacy label cannot be guessed into 15/17 groups", () => {
  for (const time of ["15", "17"] as const) {
    const records = history([2], 6, 3, time).map(item => ({ ...item, actualWeekday: undefined }));
    const inferred = recommend(records, { discountTime: time }); assert.equal(inferred.status, "ready"); assert.equal(inferred.sampleSize, 3);
    // Keep unknown dates lexically before today: rejection must come from
    // missing weekday evidence, not the independent current/future filter.
    const unknown = records.map((item, index) => ({ ...item, date: `0000-unknown-${index}`, sessionStartedAt: "unknown", recordedAt: "unknown", actualWeekdayGroup: time === "15" ? "月水" as const : "火木日" as const }));
    const before = copy(unknown), result = recommend(unknown, { discountTime: time });
    assert.equal(result.status, "insufficient"); assert.equal(result.sampleSize, 0); assert.equal(result.medianCount, undefined); assert.deepEqual(copy(unknown), before);
  }
});
test("normal and summer fallback observations share one population and retain winning cycle metadata", () => {
  const records = history([2], 6, 4).map((item, index) => ({ ...item, demandCycle: index % 2 ? "summer" as const : "normal" as const }));
  for (const demandCycle of ["normal", "summer"] as const) {
    const result = recommend(records, { demandCycle }); assert.equal(result.sampleSize, 4); assert.equal(result.medianCount, 6);
    assert.deepEqual(result.matchedRecords.map(item => item.demandCycle), ["normal", "summer", "normal", "summer"]);
  }
});
test("same-weekday windows remain 16/52 with max(short,long−2) lower guard", () => {
  const records = dates([1], 60).map((date, index) => record(date, index < 44 ? 30 : 6));
  const result = recommend(records); assert.equal(result.comparisonMode, "weekday");
  assert.deepEqual([result.shortSampleSize, result.longSampleSize, result.shortMedianCount, result.longMedianCount, result.medianCount, result.medianDownGuardApplied], [16, 52, 6, 30, 28, true]);
});
test("new fallback windows remain 16/52 and use short median without the weekday guard", () => {
  const records = dates([2], 60).map((date, index) => record(date, index < 44 ? 30 : 6));
  const result = recommend(records); assert.equal(result.comparisonMode, "fallback_group");
  assert.deepEqual([result.shortSampleSize, result.longSampleSize, result.shortMedianCount, result.longMedianCount, result.medianCount, result.medianDownGuardApplied], [16, 52, 6, 30, 6, false]);
});
test("decrease pairs use exactly the new fallback population and preserve the 20-point correction", () => {
  const records = [...history([2], 6), ...history([3], 30)];
  records.push(...records.map(item => record(item.date, weekday(item.date) === 2 ? 30 : 60, "15")), record("2026-11-09", 20, "15"));
  const result = recommend(records); assert.equal(result.baseEvaluation, "many"); assert.equal(result.decreaseRecommendation?.sampleSize, 3);
  assert.equal(result.decreaseRecommendation?.medianDecreaseRate, 0.8); assert.equal(result.decreaseRecommendation?.currentDecreaseRate, 0.5); assert.equal(result.decreaseRecommendation?.direction, "more_many");
  assert.equal(result.suggestedEvaluation, "many"); assert.equal(result.areaRateAdjustment, 10);
});

for (const time of ["15", "17"] as const) {
  test(`${time}: holiday before normal weekday still chooses three ordinary Sundays first`, () => {
    const date = "2026-10-12", records = [...history([0], 6, 3, time, date), ...history(time === "15" ? [5, 6] : [1, 2], 30, 40, time, date)];
    const result = recommend(records, { date, weekday: 1, discountTime: time });
    assert.equal(result.medianCount, 6); assert.equal(result.holidayBeforeNormalWeekdayReference?.source, "weekday"); assert.equal(result.holidayBeforeNormalWeekdayReference?.fallbackWeekdayGroup, time === "15" ? "金土日" : "日月火");
    assert.ok(result.matchedRecords.every(item => weekday(item.date) === 0));
  });
  test(`${time}: fewer than three Sundays use holiday fallback ${time === "15" ? "金土日" : "日月火"}`, () => {
    const date = "2026-10-12", records = [...history([0], 6, 2, time, date), ...history(time === "15" ? [5, 6] : [1, 2], 30, 40, time, date), ...history([3, 4], 999, 10, time, date)];
    const result = recommend(records, { date, weekday: 1, discountTime: time });
    assert.equal(result.medianCount, 30); assert.equal(result.holidayBeforeNormalWeekdayReference?.source, "fallback_group"); assert.equal(result.holidayBeforeNormalWeekdayReference?.weekdaySampleSize, 2);
    assert.ok(result.matchedRecords.every(item => time === "15" ? [0, 5, 6].includes(weekday(item.date)) : [0, 1, 2].includes(weekday(item.date))));
  });
}
test("three-day middle keeps 50:50 Sunday 6 / Friday-Saturday10 at 8, regardless of unequal samples", () => {
  const date = "2026-07-19", records = [...history([0], 6, 3, "17", date), ...history([1, 2], 99, 40, "17", date), ...history([5, 6], 10, 10, "17", date)];
  const result = recommend(records, { date, weekday: 0 }), ref = result.threeDayHolidayMiddleReference!;
  assert.equal(result.medianCount, 8); assert.equal(result.comparisonMode, "three_day_holiday_middle"); assert.equal(ref.adoptedSource, "both"); assert.equal(ref.sundayReference?.source, "weekday");
  assert.equal(ref.sundayFallbackWeekdayGroup, "日月火"); assert.equal(ref.sundayMondayTuesdaySampleSize, 43); assert.equal(ref.fireThursdaySundaySampleSize, undefined);
});
test("three-day middle fallback uses 日月火 30 / 金土10 at 20 and never renames old evidence", () => {
  const date = "2026-07-19", records = [...history([0], 6, 2, "17", date), ...history([1, 2], 30, 40, "17", date), ...history([3, 4], 999, 40, "17", date), ...history([5, 6], 10, 3, "17", date)];
  const result = recommend(records, { date, weekday: 0 }), ref = result.threeDayHolidayMiddleReference!;
  assert.equal(result.medianCount, 20); assert.equal(ref.adoptedSource, "both"); assert.equal(ref.sundayMondayTuesdayMedianCount, 30); assert.equal(ref.sundayReference?.source, "fallback_group");
  assert.equal(ref.fireThursdaySundayMedianCount, undefined); assert.equal(ref.fireThursdaySundaySampleSize, undefined);
  const legacy = { ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 6, requiredSampleSize: 3, comparisonMode: "three_day_holiday_middle", threeDayHolidayMiddleReference: { fireThursdaySundaySampleSize: 3, fridaySaturdaySampleSize: 3, fireThursdaySundayMedianCount: 20, fridaySaturdayMedianCount: 10, adoptedSource: "both" } };
  assert.deepEqual(copy(normalizeAreaCountDecisionBasis(legacy)?.threeDayHolidayMiddleReference), legacy.threeDayHolidayMiddleReference);
});
test("Obon-only fallback and long-holiday internal 17:00 reference retain their own calendar rules", () => {
  const date = "2026-08-16", obon = recommend([...history([0, 1, 2], 30, 40, "17", date), ...history([3, 4], 999, 10, "17", date)], { date, weekday: 0 });
  assert.equal(obon.comparisonMode, "holiday_before_normal_weekday"); assert.equal(obon.holidayBeforeNormalWeekdayReference, undefined); assert.equal(obon.medianCount, 30);
  const longDate = "2026-05-04", long = recommend([...history([5, 6], 10, 3, "17", longDate), ...history([0, 1, 2], 999, 20, "17", longDate)], { date: longDate, weekday: 1 });
  assert.equal(long.actualWeekdayGroup, "金土"); assert.equal(long.medianCount, 10); assert.ok(long.matchedRecords.every(item => [5, 6].includes(weekday(item.date))));
});
test("Obon-only final-day metadata captures 日月火 while legacy missing evidence retains 火木日", () => {
  const date = "2026-08-16", result = recommend(history([1, 2], 30, 6, "17", date), { date, weekday: 0 });
  const basis = buildAreaCountDecisionBasis({ recommendation: result });
  assert.equal(basis.comparisonWeekdayGroup, "日月火");
  assert.equal(normalizeAreaCountDecisionBasis(copy(basis))?.comparisonWeekdayGroup, "日月火");
  const calendar = (value: typeof basis) => buildSessionAnalysisCalendarContext({ date, weekday: 0, discountTime: "17", sessionStartedAt: `${date}T08:00:00.000Z`, manualWeekdayOverride: false, areaDecisionBases: [{ areaId: AREA, basis: value }] })!;
  assert.equal(calendar(basis).areaCountReference[0]!.referenceWeekdayGroup, "日月火");
  const legacy = copy(basis); delete legacy.comparisonWeekdayGroup;
  assert.equal(calendar(legacy).areaCountReference[0]!.referenceWeekdayGroup, "火木日");
  assert.equal(normalizeAreaCountDecisionBasis(copy(legacy))?.comparisonWeekdayGroup, undefined);
});
test("18/19/20 preserve v61 fallback groups and three-day legacy metadata", () => {
  for (const time of ["18", "19", "20"] as const) {
    for (let day = 0; day < 7; day++) assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: day, discountTime: time }), legacyGroup(day, time));
    const date = "2026-07-19", result = recommend([...history([2, 4], 30, 3, time, date), ...history([5, 6], 10, 3, time, date)], { date, weekday: 0, discountTime: time });
    assert.equal(result.medianCount, 20); assert.equal(result.threeDayHolidayMiddleReference?.fireThursdaySundayMedianCount, 30); assert.equal(result.threeDayHolidayMiddleReference?.sundayMondayTuesdaySampleSize, undefined);
  }
});

for (const [time, day, peer] of [["15", 1, 2], ["15", 3, 4], ["17", 1, 2], ["17", 3, 4]] as const) {
  test(`${time}/${GROUPS[time][day]}: new decision/calendar survives remote, daily, finalized, export and schema3 normalization`, () => {
    const date = `2026-11-${String(8 + day).padStart(2, "0")}`, result = recommend(history([peer], 6, 3, time, date), { date, weekday: day, discountTime: time });
    const basis = buildAreaCountDecisionBasis({ recommendation: result, evaluationSource: "history", finalEvaluation: result.suggestedEvaluation, areaRateAdjustment: result.areaRateAdjustment });
    const calendar = buildSessionAnalysisCalendarContext({ date, weekday: day, discountTime: time, sessionStartedAt: `${date}T08:00:00.000Z`, manualWeekdayOverride: false, areaDecisionBases: [{ areaId: AREA, basis }] })!;
    assert.deepEqual(copy(normalizeAreaCountDecisionBasis(copy(basis))), copy(basis)); assert.deepEqual(copy(normalizeAnalysisCalendarContext(copy(calendar))), copy(calendar));
    assert.equal(calendar.areaCountReference[0]!.referenceWeekdayGroup, GROUPS[time][day]);
    const draft = normalizeSessionDraft({ date, weekday: day, discountTime: time, demandCycle: "normal", manualWeekdayOverride: false, manualDiscountTimeOverride: false, weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null } }), state = createInitialState(draft);
    state.session = { ...draft, startedAt: `${date}T08:00:00.000Z` };
    const weather = resolveWeatherInputForDiscount(state.session.weather, time), weekdayBase = getWeekdayBaseInfo(day, time, weather, date, "normal");
    const capturedRate = buildNormalRateDecisionSnapshot({ confirmedAt: `${date}T08:05:00.000Z`, sessionDiscountTime: time, resolvedWeather: weather, areaJudge: result.suggestedJudge!, areaRateAdjustment: result.areaRateAdjustment, weatherComfortAdjustmentPercent: 0, weekday: day, date });
    Object.assign(state.areaProgressMap[AREA], { status: "completed", areaJudge: result.suggestedJudge, areaCount: 10, areaCountEvaluation: result.suggestedEvaluation, areaCountDecisionBasis: basis, areaRateAdjustment: result.areaRateAdjustment, rateDecisionSnapshot: capturedRate, completedAt: `${date}T08:05:00.000Z` });
    const observation = record(date, 10, time, { decisionBasis: basis, calendarContext: calendar });
    const row = buildRemoteAreaCountRow(observation);
    assert.ok(["月水", "火木", "火木日", "金土日", "金土", "三連休中日", "翌日平日祝日"].includes(row.actual_weekday_group), "outbound dedicated column obeys unchanged SQL CHECK");
    assert.deepEqual(copy(normalizeRemoteAreaCountRows([row])[0]!.decisionBasis), copy(basis));
    assert.deepEqual(copy(row.record_details.calendarContext), copy(calendar));
    const daily = createDailySessionSnapshot({ capturedAt: `${date}T08:10:00.000Z`, state, resolvedWeather: weather, weekdayBaseInfo: weekdayBase, basisGuide: getBasisGuideDisplay({ date, weekday: day, discountTime: time, weather }), lateTimeBonus: 0, doneSummaryItems: [], sessionEndReason: "auto_time_transition" })!;
    const daySnapshot = createReview19DaySnapshot({ capturedAt: `${date}T11:35:00.000Z`, date, demandCycle: "normal", sessions: [daily], areaCountRecords: [observation] });
    const finalized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot, finalizedAt: daySnapshot.capturedAt }).record;
    const exported = buildDirectFinalizedDayDataExportPayload({ record: finalized, exportedAt: `${date}T12:00:00.000Z` });
    assert.equal(exported.dataSchemaVersion, 3);
    for (const snapshot of [daySnapshot, finalized, exported.daySnapshot, normalizeFinalizedDayData(copy(exported.daySnapshot))!]) {
      assert.deepEqual(copy(snapshot.sessions[0]!.areas[AREA].areaCountDecisionBasis), copy(basis)); assert.deepEqual(copy(snapshot.sessions[0]!.areas[AREA].rateDecisionSnapshot), copy(capturedRate));
      assert.equal(snapshot.sessions[0]!.calendarContext!.areaCountReference[0]!.referenceWeekdayGroup, GROUPS[time][day]);
    }
  });
}

let passed = 0;
for (const check of checks) {
  try { check.run(); passed++; console.log(`PASS: ${check.name}`); }
  catch (error) { process.exitCode = 1; console.error(`FAIL: ${check.name}`); console.error(error); }
}
console.log(`weekday-fallback62: ${passed}/${checks.length} PASS`);
