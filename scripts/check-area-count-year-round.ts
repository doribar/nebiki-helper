import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAreaCountDecisionBasis,
  dedupeLatestAreaCountCalculationRecordsByDateAreaTime,
  dedupeLatestAreaCountRecordsByDateAreaTime,
  evaluationToRateAdjustment,
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  getAreaCountRecordIdentity,
  mergeAreaCountRecordCollections,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { resolveAreaCountHistorySource } from "../src/domain/areaCountHistorySource.ts";
import {
  buildRemoteAreaCountRow,
  normalizeRemoteAreaCountRows,
  upsertRemoteAreaCountRecords,
} from "../src/domain/areaCountRemoteStorage.ts";
import { isSummerModeAvailable } from "../src/domain/demandCycle.ts";
import {
  lockDemandCycleForDate,
  normalizeDemandCycleState,
  normalizeDemandCycleStateForBusinessDate,
  selectDemandCycleForDate,
  updateDemandCyclePreference,
} from "../src/domain/demandCycleStorage.ts";
import {
  getBaseRate,
  getFinalTimeGuide,
  getFinalTimeInstructionSteps,
} from "../src/domain/discount.ts";
import { initializeFinalizedDayDataInMemory } from "../src/domain/finalizedDayData.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import {
  createHumanEvaluationSelection,
  createReview19HumanEvaluationDetails,
  resolveHumanEvaluationForDiscount,
} from "../src/domain/humanEvaluation.ts";
import {
  buildNormalRateDecisionSnapshot,
  normalizeRateDecisionSnapshot,
} from "../src/domain/rateDecisionSnapshot.ts";
import { buildReview19ExportPayload, createInitialReview19Result } from "../src/domain/review19.ts";
import { buildReview19HistoryStatistics } from "../src/domain/review19Evaluation.ts";
import { buildRemoteReview19Row } from "../src/domain/review19RemoteStorage.ts";
import {
  buildAllFinalizedDayDataExportPayloadsByDemandCycle,
  buildAllReview19DataExportPayloadsByDemandCycle,
} from "../src/domain/separateDataExport.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import {
  createDailySessionSnapshot,
  createReview19DaySnapshot,
} from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeSessionDraft } from "../src/hooks/nebikiApp/stateNormalization.ts";
import type { AreaId, DemandCycle, DiscountTime, Review19Result } from "../src/domain/types.ts";

// Runtime fixtures call the production recommendation, canonical merge,
// Review19 adapter, snapshots, exports and injected Supabase transport.
// No real remote writes, migration, new dependency or seasonal rule is needed.
type Check = { name: string; run: () => void | Promise<void> };
const checks: Check[] = [];
const test = (name: string, run: Check["run"]) => checks.push({ name, run });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const TODAY = "2027-07-07";
const CYCLES = ["normal", "summer"] as const;

function record(date: string, count: number, demandCycle: DemandCycle = "normal", patch: Partial<AreaCountRecord> = {}): AreaCountRecord {
  const discountTime = patch.discountTime ?? "17";
  return {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-36",
    buildId: "build-year-round-fixture",
    date,
    sessionStartedAt: `${date}T08:00:00.000Z`,
    recordedAt: `${date}T08:05:00.000Z`,
    areaId: "bento_men",
    discountTime,
    demandCycle,
    actualWeekday: getActualWeekdayLabel(weekday(date)),
    actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({ date, weekday: weekday(date), discountTime }),
    count,
    ...patch,
  };
}

function datesBefore(date: string, day: number, count: number): string[] {
  const cursor = new Date(`${date}T00:00:00Z`);
  const dates: string[] = [];
  for (let tries = 0; tries < 5000 && dates.length < count; tries += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const value = cursor.toISOString().slice(0, 10);
    // Keep fallback fixtures in the ordinary weekday group. Same-day tests
    // still use the real calendar normalizer and dedicated calendar checks.
    if (cursor.getUTCDay() === day && getAreaCountFallbackWeekdayGroup({ date: value, weekday: day, discountTime: "17" }) === "月水") dates.push(value);
  }
  assert.equal(dates.length, count, "could not generate fixture dates");
  return dates.reverse();
}

const WEDNESDAYS = datesBefore(TODAY, 3, 60);
const MONDAYS = datesBefore(TODAY, 1, 60);
function recommend(records: AreaCountRecord[], demandCycle: DemandCycle = "normal", patch: Partial<Parameters<typeof getAreaCountRecommendation>[0]> = {}) {
  return getAreaCountRecommendation({ records, demandCycle, areaId: "bento_men", discountTime: "17", date: TODAY, weekday: 3, count: 10, ...patch });
}
const mixed = (dates: string[], count: number) => dates.map((date, index) => record(date, count, index % 2 ? "summer" : "normal"));
function near(actual: number | undefined, expected: number): void {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual! - expected) < 1e-9, `${actual} != ${expected}`);
}

for (const [current, history] of [["normal", "summer"], ["summer", "normal"]] as const) {
  test(`${current} uses past ${history} AreaCount records`, () => {
    const result = recommend(WEDNESDAYS.slice(-3).map((date) => record(date, 12, history)), current);
    assert.equal(result.status, "ready");
    assert.equal(result.medianCount, 12);
    assert.equal(result.sampleSize, 3);
    assert.equal(result.demandCycle, current);
    assert.ok(result.matchedRecords.every((item) => item.demandCycle === history));
  });
}

for (const cycle of CYCLES) {
  test(`${cycle}: normal 2 + summer 2 count as 4 same-weekday observations`, () => {
    const result = recommend(mixed(WEDNESDAYS.slice(-4), 10), cycle);
    assert.equal(result.status, "ready");
    assert.equal(result.comparisonMode, "weekday");
    assert.equal(result.sampleSize, 4);
    assert.deepEqual(result.matchedRecords.map((item) => item.demandCycle).sort(), ["normal", "normal", "summer", "summer"]);
  });

  test(`${cycle}: short uses latest 16 and long uses latest 52 across cycles`, () => {
    const records = WEDNESDAYS.map((date, index) => record(date, index < 8 ? 10000 : index + 1, index % 2 ? "summer" : "normal"));
    const result = recommend(records.reverse(), cycle);
    assert.equal(result.shortSampleSize, 16);
    assert.equal(result.longSampleSize, 52);
    assert.deepEqual(result.matchedRecords.map((item) => item.date), WEDNESDAYS.slice(-16));
    assert.equal(result.shortMedianCount, 53); // Rounded median of 45..60.
    assert.equal(result.longMedianCount, 35); // Rounded median of 9..60.
    assert.equal(result.medianCount, 53);
    assert.equal(result.medianDownGuardApplied, false);
  });
}

test("summer can begin from prior-year normal/summer records with no current-year history", () => {
  const dates = WEDNESDAYS.filter((date) => date < "2027-01-01").slice(-4);
  const result = recommend(mixed(dates, 14), "summer");
  assert.equal(result.status, "ready");
  assert.equal(result.sampleSize, 4);
  assert.equal(result.shortSampleSize, 4);
  assert.equal(result.longSampleSize, 4);
  assert.equal(result.medianCount, 14);
  assert.ok(result.matchedRecords.every((item) => item.date < "2027-01-01"));
});

for (const fixture of [
  { previous: "2026-06-30", today: "2026-07-01", dates: ["2026-06-16", "2026-06-23", "2026-06-30"], current: "summer", previousCycle: "normal" },
  { previous: "2026-09-30", today: "2026-10-01", dates: ["2026-09-09", "2026-09-16", "2026-09-30"], current: "normal", previousCycle: "summer" },
] as const) {
  test(`${fixture.previous} -> ${fixture.today}: eligible prior day survives the cycle boundary`, () => {
    // Explicit same weekday is the existing manual weekday override. Adjacent
    // real weekdays need not share a group; this isolates cycle eligibility.
    const records = fixture.dates.map((date) => record(date, 10, fixture.previousCycle));
    const result = recommend(records, fixture.current, { date: fixture.today, weekday: weekday(fixture.previous) });
    assert.equal(result.status, "ready");
    assert.equal(result.comparisonMode, "weekday");
    assert.equal(result.sampleSize, 3);
    assert.equal(result.matchedRecords.at(-1)?.date, fixture.previous);
    assert.equal(result.matchedRecords.at(-1)?.demandCycle, fixture.previousCycle);
    assert.equal(recommend(records, fixture.previousCycle, { date: fixture.previous, weekday: weekday(fixture.previous) }).sampleSize, 2);
    const pairs = records.flatMap((item) => [item, record(item.date, 20, item.demandCycle, { discountTime: "15" })]);
    pairs.push(record(fixture.today, 20, fixture.current, { discountTime: "15" }));
    const decrease = recommend(pairs, fixture.current, { date: fixture.today, weekday: weekday(fixture.previous), count: 10 }).decreaseRecommendation;
    assert.equal(decrease?.canUse, true);
    assert.equal(decrease?.sampleSize, 3);
    near(decrease?.medianDecreaseRate, 0.5);
  });
}

test("today/future observations and other area/time stay outside the reference", () => {
  const base = mixed(WEDNESDAYS.slice(-3), 10);
  const records = [...base, record(TODAY, 999, "summer"), record("2027-07-14", 999), ...WEDNESDAYS.slice(-3).flatMap((date) => [record(date, 999, "summer", { areaId: "sushi" }), record(date, 999, "summer", { discountTime: "15" })])];
  const result = recommend(records, "summer");
  assert.equal(result.sampleSize, 3);
  assert.equal(result.medianCount, 10);
  assert.deepEqual(result.matchedRecords.map((item) => item.date), base.map((item) => item.date));
});

for (const [short, long, adopted, guarded] of [[10, 30, 28, true], [30, 10, 30, false], [10, 11, 10, false]] as const) {
  test(`shared same-weekday guard: short ${short}, long ${long} -> ${adopted}`, () => {
    const records = WEDNESDAYS.map((date, index) => record(date, index < 44 ? long : short, index % 2 ? "summer" : "normal"));
    for (const cycle of CYCLES) {
      const result = recommend(records, cycle);
      assert.equal(result.shortMedianCount, short);
      assert.equal(result.longMedianCount, long);
      assert.equal(result.medianCount, adopted);
      assert.equal(result.medianDownGuardApplied, guarded);
    }
  });
}

test("shared fallback group still uses short without long guard", () => {
  const result = recommend(MONDAYS.map((date, index) => record(date, index < 44 ? 30 : 10, index % 2 ? "summer" : "normal")), "summer");
  assert.equal(result.comparisonMode, "fallback_group");
  assert.equal(result.shortSampleSize, 16);
  assert.equal(result.longSampleSize, 52);
  assert.equal(result.shortMedianCount, 10);
  assert.equal(result.longMedianCount, 30);
  assert.equal(result.medianCount, 10);
  assert.equal(result.medianDownGuardApplied, false);
});

test("mixed-cycle three-day-holiday reference still combines both groups 50:50", () => {
  const records = [
    ...["2026-06-02", "2026-06-09", "2026-06-16"].map((date, index) => record(date, 10, index % 2 ? "summer" : "normal")),
    ...["2026-06-05", "2026-06-12", "2026-06-19"].map((date, index) => record(date, 30, index % 2 ? "normal" : "summer")),
  ];
  const result = recommend(records, "summer", { date: "2026-07-19", weekday: 0 });
  assert.equal(result.comparisonMode, "three_day_holiday_middle");
  assert.equal(result.threeDayHolidayMiddleReference?.adoptedSource, "both");
  assert.equal(result.threeDayHolidayMiddleReference?.fireThursdaySundayMedianCount, 10);
  assert.equal(result.threeDayHolidayMiddleReference?.fridaySaturdayMedianCount, 30);
  assert.equal(result.medianCount, 20);
  assert.doesNotMatch(JSON.stringify(result.detailLines), /今年の夏|前年以前の夏|夏季モード/);
});

test("fewer than 3 same-weekday records fallback; fewer than 3 in group remain insufficient", () => {
  const result = recommend([...mixed(WEDNESDAYS.slice(-2), 10), record(MONDAYS.at(-1)!, 10, "summer")]);
  assert.equal(result.status, "ready");
  assert.equal(result.comparisonMode, "fallback_group");
  assert.equal(result.sampleSize, 3);
  assert.equal(recommend(mixed(WEDNESDAYS.slice(-2), 10)).status, "insufficient");
  assert.equal(recommend([]).requiredSampleSize, 3);
});

test("persisted and remote identities still distinguish normal/summer", () => {
  const normal = record(WEDNESDAYS.at(-1)!, 10, "normal");
  const summer = { ...normal, demandCycle: "summer" as const };
  assert.notEqual(getAreaCountRecordIdentity(normal), getAreaCountRecordIdentity(summer));
  assert.equal(mergeAreaCountRecordCollections([normal, summer]).length, 2);
  assert.equal(dedupeLatestAreaCountRecordsByDateAreaTime([normal, summer]).length, 2);
  assert.equal(dedupeLatestAreaCountCalculationRecordsByDateAreaTime([normal, summer]).length, 1);
});

test("calculation winner uses recordedAt before richness and keeps only winning metadata", () => {
  const old = record(WEDNESDAYS.at(-1)!, 90, "normal", { userJudge: "many", decisionBasis: { ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 3, requiredSampleSize: 3 } });
  const current = record(old.date, 12, "summer", { recordedAt: `${old.date}T08:06:00.000Z`, buildId: "winner-build" });
  const [winner] = dedupeLatestAreaCountCalculationRecordsByDateAreaTime([old, current]);
  assert.equal(winner.count, 12);
  assert.equal(winner.demandCycle, "summer");
  assert.equal(winner.buildId, "winner-build");
  assert.equal(winner.userJudge, undefined);
  assert.equal(winner.decisionBasis, undefined);
});

test("calculation timestamp compares actual instants and later session breaks equal-time ties", () => {
  const date = WEDNESDAYS.at(-1)!;
  const older = record(date, 90, "normal", { recordedAt: `${date}T17:05:00+09:00` });
  const newer = record(date, 12, "summer", { recordedAt: `${date}T08:06:00Z` });
  assert.equal(dedupeLatestAreaCountCalculationRecordsByDateAreaTime([older, newer])[0]?.count, 12);
  const laterSession = { ...older, sessionStartedAt: `${date}T08:01:00Z`, count: 14 };
  assert.equal(dedupeLatestAreaCountCalculationRecordsByDateAreaTime([older, laterSession])[0]?.count, 14);
});

test("equal-time calculation winner uses richness and deterministic order-independent ties", () => {
  const lean = record(WEDNESDAYS.at(-1)!, 10, "normal");
  const rich = { ...lean, demandCycle: "summer" as const, count: 12, userJudge: "few" as const };
  for (const records of [[lean, rich], [rich, lean]]) assert.equal(dedupeLatestAreaCountCalculationRecordsByDateAreaTime(records)[0]?.count, 12);
  const tied = { ...lean, demandCycle: "summer" as const, count: 14 };
  assert.deepEqual(dedupeLatestAreaCountCalculationRecordsByDateAreaTime([lean, tied]), dedupeLatestAreaCountCalculationRecordsByDateAreaTime([tied, lean]));
});

test("existing same-identity canonical revision merge and clone safety remain intact", () => {
  const old = record(WEDNESDAYS.at(-1)!, 90, "normal", { decisionBasis: { ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 3, requiredSampleSize: 3 } });
  const next = { ...record(old.date, 12), recordedAt: `${old.date}T08:06:00Z` };
  const source = [old, next];
  const before = JSON.stringify(source);
  const [winner] = dedupeLatestAreaCountCalculationRecordsByDateAreaTime(source);
  assert.equal(winner.count, 12);
  assert.ok(winner.decisionBasis, "same persisted identity retains existing detail supplementation");
  winner.decisionBasis.sampleSize = 999;
  assert.equal(JSON.stringify(source), before);
});

test("three conflicting copies produce the same full canonical result in every permutation", () => {
  const date = WEDNESDAYS.at(-1)!;
  const base = record(date, 10);
  delete base.appVersion;
  delete base.buildId;
  const copies = [
    { ...base, count: 10, appVersion: "version-copy" },
    { ...base, count: 11, buildId: "build-copy" },
    { ...base, count: 12, comfortPoint: 1 },
  ];
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const expected = dedupeLatestAreaCountCalculationRecordsByDateAreaTime(copies);
  assert.equal(expected.length, 1);
  assert.equal(expected[0].count, 12);
  for (const permutation of permutations) {
    const source = permutation.map((index) => copies[index]);
    const before = JSON.stringify(source);
    assert.deepEqual(dedupeLatestAreaCountCalculationRecordsByDateAreaTime(source), expected);
    const result = recommend([...source, ...mixed(WEDNESDAYS.slice(-3, -1), 12)]);
    assert.equal(result.sampleSize, 3);
    assert.equal(result.medianCount, 12);
    assert.equal(JSON.stringify(source), before);
  }
});

test("cross-cycle duplicates count once and cannot fabricate 3 samples", () => {
  const two = mixed(WEDNESDAYS.slice(-2), 10).flatMap((item) => [item, { ...item, demandCycle: item.demandCycle === "normal" ? "summer" as const : "normal" as const }]);
  const insufficient = recommend(two, "summer");
  assert.equal(insufficient.status, "insufficient");
  assert.equal(insufficient.sampleSize, 2);
  const ready = recommend([...two, record(WEDNESDAYS.at(-3)!, 10)], "summer");
  assert.equal(ready.status, "ready");
  assert.equal(ready.sampleSize, 3);
});

function decreaseHistory(currentCount = 5, previousCount = 10, currentDate = TODAY, patch: Partial<AreaCountRecord> = {}): AreaCountRecord[] {
  return [
    ...mixed(WEDNESDAYS.slice(-4), currentCount).flatMap((item) => [
      { ...record(item.date, previousCount, item.demandCycle === "summer" ? "normal" : "summer", { discountTime: "15" }), ...patch },
      { ...item, ...patch },
    ]),
    record(currentDate, previousCount, "summer", { discountTime: "15", ...patch }),
  ];
}

test("decrease pairs and current prior-time observation use both cycles", () => {
  const result = recommend(decreaseHistory(), "normal", { count: 7 });
  assert.equal(result.decreaseRecommendation?.canUse, true);
  assert.equal(result.decreaseRecommendation?.sampleSize, 4);
  assert.equal(result.decreaseRecommendation?.previousCount, 10);
  near(result.decreaseRecommendation?.medianDecreaseRate, 0.5);
  near(result.decreaseRecommendation?.currentDecreaseRate, 0.3);
  assert.equal(result.decreaseRecommendation?.direction, "more_many");
});

for (const [count, direction] of [[7, "more_many"], [5, "none"], [3, "more_few"]] as const) {
  test(`decrease still applies at a 20-point gap: current ${count}/10 -> ${direction}`, () => {
    const result = recommend(decreaseHistory(), "summer", { count });
    assert.equal(result.decreaseRecommendation?.direction, direction);
    const base = result.baseEvaluation;
    const final = result.suggestedEvaluation;
    const evaluations = ["few", "slightly_few", "normal", "slightly_many", "many"];
    const offset = direction === "more_many" ? 1 : direction === "more_few" ? -1 : 0;
    assert.equal(evaluations.indexOf(final!), Math.max(0, Math.min(4, evaluations.indexOf(base!) + offset)));
  });
}

test("decrease dedupes historical cycles and selects current official prior-time winner", () => {
  const records = decreaseHistory().flatMap((item) => [item, { ...item, demandCycle: item.demandCycle === "summer" ? "normal" as const : "summer" as const, count: 999, recordedAt: `${item.date}T08:04:00Z` }]);
  records.push(record(TODAY, 20, "normal", { discountTime: "15", recordedAt: `${TODAY}T08:06:00Z` }));
  for (const cycle of CYCLES) {
    const result = recommend(records, cycle, { count: 10 });
    assert.equal(result.sampleSize, 4);
    assert.equal(result.decreaseRecommendation?.sampleSize, 4);
    assert.equal(result.decreaseRecommendation?.previousCount, 20);
    near(result.decreaseRecommendation?.medianDecreaseRate, 0.5);
    near(result.decreaseRecommendation?.currentDecreaseRate, 0.5);
    assert.equal(result.decreaseRecommendation?.direction, "none");
  }
});

test("decrease preserves area/time eligibility and missing/nonpositive previous safeguards", () => {
  for (const areaId of ["sushi", "fry_chicken"] as const satisfies readonly AreaId[]) {
    const result = recommend(decreaseHistory(5, 10, TODAY, { areaId }), "normal", { areaId });
    assert.equal(result.decreaseRecommendation?.canUse, false);
  }
  for (const discountTime of ["15", "18"] as const) {
    const result = recommend(mixed(WEDNESDAYS.slice(-4), 5).map((item) => ({ ...item, discountTime })), "normal", { discountTime });
    assert.equal(result.decreaseRecommendation?.canUse, false);
  }
  assert.equal(recommend(decreaseHistory().filter((item) => item.date !== TODAY)).decreaseRecommendation?.canUse, false);
  assert.equal(recommend(decreaseHistory(5, 0)).decreaseRecommendation?.canUse, false);
  const night = decreaseHistory().map((item) => ({ ...item, discountTime: item.discountTime === "15" ? "18" as const : "19" as const }));
  assert.equal(recommend(night, "normal", { discountTime: "19" }).decreaseRecommendation?.previousDiscountTime, "18");
  assert.equal(recommend(night, "normal", { discountTime: "19" }).decreaseRecommendation?.canUse, true);
});

for (const cycle of CYCLES) {
  test(`${cycle}: 20:30 uses shared median and the existing tier/rate/count rules`, () => {
    const result = recommend(mixed(WEDNESDAYS.slice(-4), 10).map((item) => ({ ...item, discountTime: "20" as const })), cycle, { discountTime: "20", count: 14 });
    assert.equal(result.sampleSize, 4);
    assert.equal(result.medianCount, 10);
    assert.equal(result.suggestedEvaluation, "many");
    assert.equal(result.decreaseRecommendation, undefined);
    const guide = getFinalTimeGuide({ weekday: 3, weather21: "sunny", temp21C: 25, comfortScore: 0, areaCountEvaluation: result.suggestedEvaluation });
    assert.deepEqual([guide.count1.main, guide.count2.main, guide.count3OrMore.main], ["40%", "50%", "50%"]);
    assert.deepEqual(getFinalTimeInstructionSteps(guide).map((item) => item.subject), ["2個以上ある商品を", "1個の商品を"]);
  });
}

test("20:30 A/B/C types, weather floors and Friday/Saturday correction remain unchanged", () => {
  for (const [weather21, comfortScore, rates, subjects] of [
    ["sunny", 0, ["30%", "40%", "50%"], ["3個以上ある商品を", "2個ある商品を", "1個の商品を"]],
    ["sunny", 1, ["40%", "50%", "50%"], ["2個以上ある商品を", "1個の商品を"]],
    ["snow", 0, ["50%", "50%", "50%"], ["すべての商品を"]],
  ] as const) {
    const guide = getFinalTimeGuide({ weekday: 3, weather21, temp21C: 25, comfortScore });
    assert.deepEqual([guide.count1.main, guide.count2.main, guide.count3OrMore.main], rates);
    assert.deepEqual(getFinalTimeInstructionSteps(guide).map((item) => item.subject), subjects);
  }
  assert.equal(getFinalTimeGuide({ weekday: 3, weather21: "rain", temp21C: 25, comfortScore: 0, areaCountEvaluation: "few" }).score, 1);
  assert.equal(getFinalTimeGuide({ weekday: 5, weather21: "sunny", temp21C: 25, comfortScore: 1 }).score, 0);
});

test("normal single-cycle recommendation retains thresholds, five levels and adjustments", () => {
  const records = WEDNESDAYS.slice(-3).map((date) => record(date, 10));
  for (const [count, evaluation, rate] of [[6, "few", -10], [8, "slightly_few", -5], [10, "normal", 0], [12, "slightly_many", 5], [14, "many", 10]] as const) {
    const result = recommend(records, "normal", { count });
    assert.equal(result.medianCount, 10);
    assert.equal(result.smallDifferenceThreshold, 2);
    assert.equal(result.largeDifferenceThreshold, 4);
    assert.equal(result.baseEvaluation, evaluation);
    assert.equal(result.areaRateAdjustment, rate);
    assert.equal(evaluationToRateAdjustment(evaluation), rate);
  }
  assert.deepEqual(["15", "17", "18", "19"].map((time) => getBaseRate(time as DiscountTime)), [0, 10, 20, 30]);
});

test("production/fixed-time sources retain both cycles in memory; failure stays local-first", () => {
  const remote = mixed(WEDNESDAYS.slice(-4), 10);
  for (const mode of ["production", "fixed_time_readonly"] as const) {
    const source = resolveAreaCountHistorySource({ mode, localRecords: [record(WEDNESDAYS.at(-5)!, 999)], remoteResults: CYCLES.map((cycle) => ({ status: "ready" as const, records: remote.filter((item) => item.demandCycle === cycle) })) });
    assert.equal(source.shouldPersistProductionCache, false);
    assert.equal(source.records.length, mode === "production" ? 5 : 4);
    assert.equal(recommend(source.records, "summer").status, "ready");
    assert.deepEqual(new Set(source.records.map((item) => item.demandCycle)), new Set(CYCLES));
  }
  const offline = resolveAreaCountHistorySource({ mode: "production", localRecords: remote, remoteResults: [{ status: "error", message: "offline", errorKind: "network" }] });
  assert.equal(offline.remoteStatus, "error");
  assert.equal(recommend(offline.records).sampleSize, 4);
  assert.equal(offline.shouldPersistProductionCache, false);
});

function review(date: string, count: number, demandCycle: DemandCycle): Review19Result {
  const initial = createInitialReview19Result({ date, demandCycle, sessionStartedAt: `${date}T10:00:00Z` });
  return { ...initial, areaCounts: { bento_men: count }, areaCountRecordedAt: { bento_men: `${date}T10:05:00Z` }, recordedAt: `${date}T10:05:00Z` };
}

test("Review19 adapter derives shared statistics while preserving human raw9 and cycle metadata", () => {
  const history = WEDNESDAYS.slice(-4).map((date, index) => review(date, index < 2 ? 10 : 20, index % 2 ? "summer" : "normal"));
  const before = JSON.stringify(history);
  for (const cycle of CYCLES) {
    const stats = buildReview19HistoryStatistics({ areaId: "bento_men", count: 12, date: TODAY, weekday: 3, demandCycle: cycle, historicalRecords: history });
    assert.deepEqual(Object.keys(stats), ["autoEvaluationBasis"]);
    assert.equal(stats.autoEvaluationBasis.sampleSize, 4);
    assert.equal(stats.autoEvaluationBasis.medianCount, 15);
    assert.equal(stats.autoEvaluationBasis.demandCycle, cycle);
    assert.equal(stats.autoEvaluationBasis.baseEvaluation, undefined);
    assert.equal(stats.autoEvaluationBasis.areaRateAdjustment, undefined);
    assert.equal(stats.autoEvaluationBasis.decreaseRecommendation, undefined);
    const selection = createHumanEvaluationSelection("normal", "slightly_many")!;
    const human = createReview19HumanEvaluationDetails({ selection, demandCycle: cycle, evaluatedAt: `${TODAY}T10:05:00Z` });
    assert.equal(human.humanEvaluationScore9, 6);
    assert.equal(human.resolutionReason, "review19_observation");
    assert.equal(human.resolutionDirection, "not_applicable");
    assert.equal(human.resolvedEvaluation, undefined);
  }
  assert.equal(JSON.stringify(history), before);
});

test("Review19 statistics include prior years and dedupe opposite-cycle copies without reviving auto", () => {
  const dates = WEDNESDAYS.filter((date) => date < "2027-01-01").slice(-3);
  const history = dates.flatMap((date) => [review(date, 20, "normal"), review(date, 10, "summer")]);
  const stats = buildReview19HistoryStatistics({ areaId: "bento_men", count: 12, date: TODAY, weekday: 3, demandCycle: "summer", historicalRecords: history });
  assert.equal(stats.autoEvaluationBasis.recommendationStatus, "ready");
  assert.equal(stats.autoEvaluationBasis.sampleSize, 3);
  assert.equal(stats.autoEvaluationBasis.shortSampleSize, 3);
  assert.equal(stats.autoEvaluationBasis.longSampleSize, 3);
  assert.equal("autoEvaluation" in stats, false);
  assert.equal("autoEvaluationStatus" in stats, false);
});

for (const cycle of CYCLES) {
  test(`${cycle}: records/session/rate/daily/finalized/Review19/export retain demandCycle`, () => {
    const draft = normalizeSessionDraft({ date: TODAY, weekday: 3, discountTime: "17", demandCycle: cycle });
    const state = createInitialState(draft);
    state.session = { ...draft, startedAt: `${TODAY}T08:00:00Z` };
    const weather = resolveWeatherInputForDiscount({ hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null }, "17");
    const result = recommend(mixed(WEDNESDAYS.slice(-4), 10), cycle);
    const basis = buildAreaCountDecisionBasis({ recommendation: result });
    const observed = record(TODAY, 10, cycle, { decisionBasis: basis });
    const restored = normalizeAreaCountRecords(copy([observed]))[0]!;
    assert.equal(restored.demandCycle, cycle);
    assert.equal(restored.decisionBasis?.demandCycle, cycle);
    const rate = buildNormalRateDecisionSnapshot({ confirmedAt: `${TODAY}T08:05:00Z`, sessionDiscountTime: "17", demandCycle: cycle, weatherComfortAdjustmentPercent: 0, areaJudge: "normal", resolvedWeather: weather, weekday: 3, date: TODAY });
    assert.equal(normalizeRateDecisionSnapshot(copy(rate))?.demandCycle, cycle);
    const saved = createDailySessionSnapshot({ capturedAt: `${TODAY}T08:10:00Z`, state, resolvedWeather: weather, weekdayBaseInfo: getWeekdayBaseInfo(3, "17", weather, TODAY, cycle), basisGuide: getBasisGuideDisplay({ date: TODAY, weekday: 3, discountTime: "17", demandCycle: cycle, weather }), lateTimeBonus: 0, doneSummaryItems: [] });
    assert.equal(saved?.demandCycle, cycle);
    assert.equal(saved?.session.demandCycle, cycle);
    const day = createReview19DaySnapshot({ capturedAt: `${TODAY}T11:35:00Z`, date: TODAY, demandCycle: cycle, areaCountRecords: [observed], sessions: [saved!] });
    const finalized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot: day, finalizedAt: `${TODAY}T11:35:00Z` });
    assert.equal(finalized.record.demandCycle, cycle);
    assert.equal(day.demandCycle, cycle);
    const reviewRecord = review(TODAY, 10, cycle);
    assert.equal(buildReview19ExportPayload({ records: [reviewRecord], exportedAt: `${TODAY}T12:00:00Z` }).records[0]?.demandCycle, cycle);
    assert.equal(buildRemoteReview19Row(reviewRecord).demand_cycle, cycle);
    assert.equal(buildRemoteAreaCountRow(observed).demand_cycle, cycle);
    assert.equal(normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(observed)])[0]?.demandCycle, cycle);
  });
}

test("normal/summer JSON export bundles remain separated after shared recommendations", () => {
  const reviews = CYCLES.map((cycle, index) => review(WEDNESDAYS.at(-index - 1)!, 10, cycle));
  const reviewBundles = buildAllReview19DataExportPayloadsByDemandCycle({ records: reviews, exportedAt: `${TODAY}T12:00:00Z` });
  assert.equal(reviewBundles.length, 2);
  for (const bundle of reviewBundles) assert.ok(bundle.payload.records.every((item) => item.demandCycle === bundle.demandCycle));
  const days = reviews.map((item) => createReview19DaySnapshot({ capturedAt: `${item.date}T12:00:00Z`, date: item.date, demandCycle: item.demandCycle, sessions: [], areaCountRecords: [record(item.date, 10, item.demandCycle)] }));
  const dailyBundles = buildAllFinalizedDayDataExportPayloadsByDemandCycle({ records: days, exportedAt: `${TODAY}T12:00:00Z` });
  assert.equal(dailyBundles.length, 2);
  for (const bundle of dailyBundles) assert.ok(bundle.payload.records.every((item) => item.demandCycle === bundle.demandCycle));
});

test("Supabase write transport retains demand_cycle and existing conflict key", async () => {
  const records = CYCLES.map((cycle) => record(WEDNESDAYS.at(-1)!, 10, cycle));
  const requests: Array<{ url: string; method?: string; body: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method, body: String(init?.body) });
    return new Response(null, { status: 201 });
  };
  const result = await upsertRemoteAreaCountRecords(records, { config: { url: "https://example.supabase.co", anonKey: "fixture-anon" }, fetchImpl });
  assert.deepEqual(result, { status: "saved", savedCount: 2 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.match(requests[0].url, /on_conflict=date,session_started_at,area_id,discount_time,demand_cycle$/);
  assert.deepEqual((JSON.parse(requests[0].body) as Array<{ demand_cycle: DemandCycle }>).map((item) => item.demand_cycle).sort(), [...CYCLES]);
});

test("summer raw9 resolves lower through 17:59 and higher at 18:00; normal17 stays higher", () => {
  const selection = createHumanEvaluationSelection("normal", "slightly_many")!;
  for (const [cycle, nowMs, resolved, direction] of [
    ["normal", Date.UTC(2026, 8, 30, 8, 59), "slightly_many", "higher"],
    ["summer", Date.UTC(2026, 8, 30, 8, 59), "normal", "lower"],
    ["summer", Date.UTC(2026, 8, 30, 9, 0), "slightly_many", "higher"],
  ] as const) {
    const result = resolveHumanEvaluationForDiscount({ selection, demandCycle: cycle, sessionDiscountTime: "17", nowMs, evaluatedAt: new Date(nowMs).toISOString() });
    assert.equal(result.humanEvaluationScore9, 6);
    assert.equal(result.resolvedEvaluation, resolved);
    assert.equal(result.resolutionDirection, direction);
    assert.equal(result.demandCycle, cycle);
  }
});

test("summer17 comfort can remain -10 while normal17 is capped at -5", () => {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const hour of Object.keys(hourlyForecasts) as Array<keyof typeof hourlyForecasts>) hourlyForecasts[hour] = { weather: "sunny", tempC: 25, windMs: 2 };
  const weather = resolveWeatherInputForDiscount({ hourlyForecasts, afterRainSky: null }, "17");
  assert.equal(getWeekdayBaseInfo(0, "17", weather, "2026-09-13", "normal").baseRateBonus, -5);
  assert.equal(getWeekdayBaseInfo(0, "17", weather, "2026-09-13", "summer").baseRateBonus, -10);
});

test("summer gate and daily lock are unchanged outside July1 through September30", () => {
  for (const [date, available] of [["2026-06-30", false], ["2026-07-01", true], ["2026-09-30", true], ["2026-10-01", false]] as const) assert.equal(isSummerModeAvailable(date), available);
  const selected = updateDemandCyclePreference(normalizeDemandCycleState(null), "summer");
  const locked = lockDemandCycleForDate(selected, "2026-09-30", "summer");
  assert.equal(selectDemandCycleForDate(updateDemandCyclePreference(locked, "normal"), "2026-09-30"), "summer");
  assert.equal(selectDemandCycleForDate(normalizeDemandCycleStateForBusinessDate(locked, "2026-10-01"), "2026-10-01"), "normal");
});

test("runtime AreaCount history explanations are common for ready/insufficient/group/special cases", () => {
  for (const [records, patch] of [
    [[], {}], [mixed(WEDNESDAYS.slice(-4), 10), {}], [mixed(MONDAYS.slice(-4), 10), {}],
    [[], { date: "2026-07-19", weekday: 0 }], [[], { date: "2026-09-21", weekday: 1 }],
  ] as Array<[AreaCountRecord[], Partial<Parameters<typeof getAreaCountRecommendation>[0]>]>) {
    const normal = recommend(records, "normal", patch);
    const summer = recommend(records, "summer", patch);
    assert.equal(summer.summaryText, normal.summaryText);
    assert.deepEqual(summer.detailLines, normal.detailLines);
    assert.doesNotMatch(JSON.stringify([summer.summaryText, summer.detailLines]), /今年の夏|夏季モード.*履歴|夏の残数基準|前年以前の夏/);
  }
  const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  assert.match(source("src/components/screens/AreaJudgeScreen.tsx"), /残数基準で手動判定します。/);
  assert.doesNotMatch(source("src/components/screens/AreaJudgeScreen.tsx"), /夏の残数基準|今年の夏季モード/);
  assert.match(source("src/components/screens/StartScreen.tsx"), /残数判定には通常・夏季共通の履歴を使用します。/);
  assert.match(source("src/components/common/JudgeHintDialog.tsx"), /15時・17時：/);
  assert.match(source("src/components/common/JudgeHintDialog.tsx"), /18時以降：/);
});

let passed = 0;
for (const check of checks) {
  try {
    await check.run();
    passed += 1;
    console.log(`PASS: ${String(passed).padStart(2, "0")}. ${check.name}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL: ${check.name}`);
    console.error(error);
  }
}
console.log(`AreaCount year-round checks passed: ${passed}/${checks.length}`);
