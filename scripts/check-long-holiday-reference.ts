import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  addDaysToDateString,
  isJapaneseHolidayOrObserved,
  isLongHolidayMiddle,
  isThreeDayHolidayMiddle,
} from "../src/domain/japaneseHoliday.ts";
import {
  formatReferenceConditionLabel,
  getBasisGuideDisplay,
  getIndividualAmountReferenceContext,
  getReferenceConditionLabel,
  getWeekdayBaseInfo,
} from "../src/domain/weekdayBase.ts";
import {
  buildAreaCountDecisionBasis,
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
  buildDayAnalysisCalendarContext,
  buildProductionAnalysis,
  buildSessionAnalysisCalendarContext,
  buildSessionCalendarContextFromSnapshot,
  normalizeAnalysisCalendarContext,
  type AnalysisCalendarContext,
} from "../src/domain/analysisMetadata.ts";
import {
  buildRemoteAreaCountRow,
  normalizeRemoteAreaCountRows,
} from "../src/domain/areaCountRemoteStorage.ts";
import {
  buildReview19ExportPayload,
  createInitialReview19Result,
  normalizeReview19Result,
} from "../src/domain/review19.ts";
import {
  buildRemoteReview19Row,
  normalizeRemoteReview19Row,
} from "../src/domain/review19RemoteStorage.ts";
import { buildAllFinalizedDayDataExportPayloadsByDemandCycle } from "../src/domain/separateDataExport.ts";
import { collectAreaCountBackfillRecords } from "../src/domain/areaCountBackfill.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import { getAdvanceDiscountRate } from "../src/domain/advanceDiscount.ts";
import { getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import type {
  AreaId,
  DailySessionSnapshot,
  DemandCycle,
  DiscountTime,
  Review19AreaSnapshot,
  Review19DaySnapshot,
} from "../src/domain/types.ts";

let passed = 0;
let failed = 0;
function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(error);
  }
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const paramsFor = (date: string, discountTime: DiscountTime = "17") => ({
  date, weekday: weekday(date), discountTime,
});
const newReference = {
  kind: "long_holiday_middle",
  comparisonMode: "weekday_group",
  referenceWeekday: null,
  referenceWeekdayGroup: "金土",
  referenceDiscountTime: "17",
  reason: "long_holiday_middle",
  referenceText: "金曜日・土曜日の17時を基準に考えて",
};

function makeRecord(date: string, count: number, discountTime: DiscountTime = "17", demandCycle: DemandCycle = "normal"): AreaCountRecord {
  return {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-28",
    buildId: "build-before-long-holiday-rule",
    demandCycle,
    date,
    sessionStartedAt: `${date}T${discountTime}:00:00+09:00`,
    recordedAt: `${date}T${discountTime}:05:00+09:00`,
    areaId: "bento_men",
    discountTime,
    actualWeekday: getActualWeekdayLabel(weekday(date)),
    actualWeekdayGroup: getAreaCountFallbackWeekdayGroup(paramsFor(date, discountTime)),
    count,
  };
}

// Three ordinary records for each requested weekday, before every target date.
function history(year: number, discountTime: DiscountTime = "17", demandCycle: DemandCycle = "normal", counts = [30, 90, 90, 90, 90, 30, 10]): AreaCountRecord[] {
  const result: AreaCountRecord[] = [];
  for (let day = 0; day < 7; day += 1) {
    let found = 0;
    for (let date = `${year}-01-05`; found < 3; date = addDaysToDateString(date, 1)) {
      if (weekday(date) !== day || isJapaneseHolidayOrObserved(date) || isThreeDayHolidayMiddle(date)) continue;
      result.push(makeRecord(date, counts[day]!, discountTime, demandCycle));
      found += 1;
    }
  }
  return result;
}

function recommendation(date: string, records: AreaCountRecord[], discountTime: DiscountTime = "17", demandCycle: DemandCycle = "normal") {
  return getAreaCountRecommendation({ ...paramsFor(date, discountTime), records, demandCycle, areaId: "bento_men", count: 20 });
}

function calendar(date: string, basis?: AreaCountDecisionBasis, applyLongHolidayRule?: boolean): AnalysisCalendarContext {
  const result = buildSessionAnalysisCalendarContext({
    ...paramsFor(date),
    sessionStartedAt: `${date}T17:00:00+09:00`,
    manualWeekdayOverride: false,
    applyLongHolidayRule,
    areaDecisionBases: [{ areaId: "bento_men", basis }],
  });
  assert.ok(result);
  return result;
}

function legacyBasis(date: string): AreaCountDecisionBasis {
  return {
    ruleVersion: "area_count_median_v1", demandCycle: "normal", evaluationSource: "history",
    recommendationStatus: "ready", actualWeekday: getActualWeekdayLabel(weekday(date)),
    actualWeekdayGroup: "金土", comparisonMode: "weekday", sampleSize: 3,
    requiredSampleSize: 3, medianCount: 10, baseEvaluation: "many", finalEvaluation: "many", areaRateAdjustment: 10,
  };
}

function snapshot(date: string, calendarContext?: AnalysisCalendarContext): DailySessionSnapshot {
  const weather = { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null };
  const area: Review19AreaSnapshot = {
    areaId: "bento_men", areaName: "弁当・麺類", status: "completed", areaJudge: "many",
    areaCount: 20, areaCountEvaluation: "many", areaCountEvaluationSource: "history",
    areaCountDecisionBasis: legacyBasis(date), areaRateAdjustment: 10,
    judgeText: "多い", rateText: "30%", rateDecisionSnapshotStatus: "legacy_not_captured",
    measurementStatus: "measured", measurementRecordedAt: `${date}T17:05:00+09:00`,
  };
  return {
    version: 1, dataSchemaVersion: 3, appVersion: "2026.8.9-28", buildId: "build-before-long-holiday-rule",
    capturedAt: `${date}T17:10:00+09:00`, demandCycle: "normal", calendarContext, screen: "done",
    sessionEndReason: "completed",
    session: {
      dataSchemaVersion: 3, appVersion: "2026.8.9-28", buildId: "build-before-long-holiday-rule",
      ...paramsFor(date), demandCycle: "normal", startedAt: `${date}T17:00:00+09:00`,
      manualWeekdayOverride: false, manualDiscountTimeOverride: false,
      weather, resolvedWeather: resolveWeatherInputForDiscount(weather, "17"),
    },
    basis: { baseRateBonus: 0, lateTimeBonus: 0, totalRateBonus: 0, baseRateBonusReason: [] },
    areas: { bento_men: area } as Record<AreaId, Review19AreaSnapshot>,
    doneSummaryItems: [], currentAreaId: null, review19ExcludedAreaIds: [],
  };
}

function reviewWithSnapshot(value: DailySessionSnapshot) {
  return {
    ...createInitialReview19Result({ date: value.session.date, sessionStartedAt: `${value.session.date}T19:00:00+09:00`, demandCycle: "normal" }),
    dataSchemaVersion: 3, appVersion: "2026.8.9-28", buildId: "build-before-long-holiday-rule",
    snapshot: {
      version: 1 as const, capturedAt: value.capturedAt, demandCycle: value.demandCycle,
      calendarContext: value.calendarContext, session: value.session, basis: value.basis, areas: value.areas,
    },
  };
}

test("9/19–24は初日・最終日を除き9/20–22だけを長期連休内部日にする", () => {
  const expected = [
    ["2026-09-19", false, "actual_weekday", "金土"],
    ["2026-09-20", true, "long_holiday_middle", "金土"],
    ["2026-09-21", true, "long_holiday_middle", "金土"],
    ["2026-09-22", true, "long_holiday_middle", "金土"],
    ["2026-09-23", false, "holiday", "火木日"],
    ["2026-09-24", false, "actual_weekday", "火木日"],
  ] as const;
  for (const [date, middle, kind, group] of expected) {
    assert.equal(isLongHolidayMiddle(date), middle, date);
    assert.equal(isThreeDayHolidayMiddle(date), false, date);
    assert.equal(getIndividualAmountReferenceContext(paramsFor(date)).kind, kind, date);
    assert.equal(getAreaCountComparisonWeekdayGroup(paramsFor(date)), group, date);
  }
  assert.equal(isJapaneseHolidayOrObserved("2026-09-22"), true, "国民の休日を含む");
});

test("9/21・22の個別量context・共通ラベル・案内・保存metadataは同じ金土17時", () => {
  for (const date of ["2026-09-21", "2026-09-22"]) {
    for (const demandCycle of ["normal", "summer"] as const) {
      const reference = getIndividualAmountReferenceContext(paramsFor(date));
      assert.deepEqual(reference, newReference);
      const expectedLabel = `${demandCycle === "summer" ? "夏・" : ""}金曜日・土曜日・17時`;
      assert.equal(formatReferenceConditionLabel({ reference, demandCycle }), expectedLabel);
      assert.equal(getReferenceConditionLabel({ ...paramsFor(date), demandCycle }), expectedLabel);
      const weather = resolveWeatherInputForDiscount({ hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null }, "17");
      const guide = getBasisGuideDisplay({ ...paramsFor(date), demandCycle, weather });
      assert.equal(guide.referenceText, newReference.referenceText);
      assert.equal(guide.referenceConditionLabel, expectedLabel);
      const result = recommendation(date, history(2026, "17", demandCycle), "17", demandCycle);
      assert.equal(result.comparisonMode, "fallback_group");
      assert.equal(result.actualWeekdayGroup, "金土");
      assert.equal(result.medianCount, 20);
      const basis = buildAreaCountDecisionBasis({ recommendation: result, evaluationSource: "history" });
      const context = calendar(date, basis);
      assert.equal(context.actualWeekday, getActualWeekdayLabel(weekday(date)));
      assert.equal(context.isHoliday, true);
      assert.equal(context.calendarCondition, "holiday");
      assert.deepEqual(context.individualAmountReference[0], { ...newReference, sessionStartedAt: `${date}T17:00:00+09:00` });
      assert.equal(context.areaCountReference[0]?.comparisonMode, "fallback_group");
      assert.equal(context.areaCountReference[0]?.referenceWeekdayGroup, "金土");
      assert.equal(context.areaCountReference[0]?.reason, "fallback_weekday_group_history");
    }
  }
});

test("9/23最終日は祝日の日曜基準と翌日平日祝日の中央値を維持", () => {
  const date = "2026-09-23";
  const result = recommendation(date, history(2026));
  assert.equal(getIndividualAmountReferenceContext(paramsFor(date)).referenceText, "日曜日の17時を基準に考えて");
  assert.equal(getAreaCountFallbackWeekdayGroup(paramsFor(date)), "翌日平日祝日");
  assert.equal(result.comparisonMode, "holiday_before_normal_weekday");
  assert.equal(result.actualWeekdayGroup, "翌日平日祝日");
  assert.ok(result.matchedRecords.every((record) => record.actualWeekdayGroup === "火木日"));
});

test("ちょうど4日の連休は2日目・3日目だけが対象", () => {
  // 2026/5/3(日)–5/6(振替休日)に前日の土曜が接続するため5日。
  // 2027/5/1(土)–5/5(水祝)も5日。2025/5/3(土)–5/6(火振替)は4日。
  assert.deepEqual(["2025-05-02", "2025-05-03", "2025-05-04", "2025-05-05", "2025-05-06", "2025-05-07"].map(isLongHolidayMiddle), [false, false, true, true, false, false]);
  assert.deepEqual(["2025-05-04", "2025-05-05"].map((date) => getIndividualAmountReferenceContext(paramsFor(date))), [newReference, newReference]);
});

test("土曜3件が十分でも内部17時は金曜3件と合算し、土曜単体中央値を使わない", () => {
  for (const date of ["2028-05-06", "2029-05-05"]) {
    assert.equal(isLongHolidayMiddle(date), true);
    assert.equal(isJapaneseHolidayOrObserved(addDaysToDateString(date, 1)), false);
    // The old helper intentionally stays false, so this catches a missing override
    // inside getAreaCountRecommendation, even where both group labels are 金土.
    assert.equal(shouldForceAreaCountFallbackWeekdayGroup(paramsFor(date)), false);
    for (const demandCycle of ["normal", "summer"] as const) {
      const records = history(Number(date.slice(0, 4)), "17", demandCycle);
      const result = recommendation(date, records, "17", demandCycle);
      assert.equal(result.status, "ready");
      assert.equal(result.comparisonMode, "fallback_group");
      assert.equal(result.actualWeekdayGroup, "金土");
      assert.equal(result.sampleSize, 6);
      assert.equal(result.medianCount, 20);
      assert.deepEqual([...new Set(result.matchedRecords.map((record) => record.actualWeekday))].sort(), ["土", "金"]);
      assert.equal(buildAreaCountDecisionBasis({ recommendation: result }).actualWeekdayGroup, "金土");
    }
  }
});

test("金土履歴不足を同曜日履歴で補わず、normalとsummerは混ぜない", () => {
  const date = "2026-09-21";
  const records = history(2026).filter((record) => record.actualWeekday === "月");
  records.push(...history(2026, "17", "summer"));
  const result = recommendation(date, records);
  assert.equal(result.status, "insufficient");
  assert.equal(result.comparisonMode, "fallback_group");
  assert.equal(result.actualWeekdayGroup, "金土");
  assert.equal(result.sampleSize, 0);
  assert.equal(result.medianCount, undefined);
  const stored = calendar(date, buildAreaCountDecisionBasis({ recommendation: result }));
  assert.equal(stored.areaCountReference[0]?.referenceWeekdayGroup, "金土");
  assert.equal(stored.areaCountReference[0]?.reason, "insufficient_history");
});

test("三連休は従来の中間referenceを優先し、前後日にも長期ルールを広げない", () => {
  for (const date of ["2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20", "2026-07-21"]) {
    assert.equal(isLongHolidayMiddle(date), false, date);
  }
  assert.equal(isThreeDayHolidayMiddle("2026-07-19"), true);
  for (const discountTime of ["17", "18", "19", "20"] as const) {
    assert.equal(getIndividualAmountReferenceContext(paramsFor("2026-07-19", discountTime)).kind, "three_day_holiday_middle");
    const result = recommendation("2026-07-19", history(2026, discountTime), discountTime);
    assert.equal(result.comparisonMode, "three_day_holiday_middle");
    assert.equal(result.threeDayHolidayMiddleReference?.adoptedSource, "both");
    assert.equal(result.medianCount, 55);
  }
  assert.equal(getIndividualAmountReferenceContext(paramsFor("2026-07-19", "15")).kind, "actual_weekday");
});

test("単独祝日・祝日前日・通常平日・土日・お盆だけの日は従来reference", () => {
  for (const [date, kind] of [
    ["2026-11-03", "holiday"], ["2026-11-02", "day_before_holiday"],
    ["2026-09-25", "actual_weekday"], ["2026-09-26", "actual_weekday"],
    ["2026-09-27", "actual_weekday"], ["2026-08-13", "obon"],
    ["2026-08-14", "obon"], ["2026-08-15", "obon"], ["2026-08-16", "obon"],
  ]) {
    assert.equal(isLongHolidayMiddle(date!), false, date);
    assert.equal(getIndividualAmountReferenceContext(paramsFor(date!)).kind, kind, date);
  }
});

test("不正日付を対象にせず、年またぎの正月休みを架空の4連休にしない", () => {
  for (const date of ["", "invalid", "2026-02-30", "2026-13-01", "2026-09-00", "2026-9-21", "2026-09-21T00:00:00Z"]) {
    assert.equal(isLongHolidayMiddle(date), false, date);
    assert.notEqual(getIndividualAmountReferenceContext({ date, weekday: 1, discountTime: "17" }).kind, "long_holiday_middle");
  }
  assert.equal(addDaysToDateString("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToDateString("2027-01-01", -1), "2026-12-31");
  for (const date of ["2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"]) {
    assert.equal(isLongHolidayMiddle(date), false, date);
  }
  assert.equal(isThreeDayHolidayMiddle("2027-01-02"), true);
});

test("内部日の15・18:30・19:30・20:30は十分な土曜単体履歴を維持", () => {
  for (const date of ["2028-05-06", "2029-05-05"]) {
    for (const discountTime of ["15", "18", "19", "20"] as const) {
      const result = recommendation(date, history(Number(date.slice(0, 4)), discountTime), discountTime);
      assert.equal(result.comparisonMode, "weekday");
      assert.equal(result.sampleSize, 3);
      assert.equal(result.medianCount, 10);
      assert.notEqual(getIndividualAmountReferenceContext(paramsFor(date, discountTime)).kind, "long_holiday_middle");
    }
  }
});

test("applyLongHolidayRule:falseは旧個別referenceを再現し、保存済みcalendarContextを保持", () => {
  for (const [date, oldKind, referenceWeekday] of [
    ["2026-09-21", "holiday", 0], ["2026-09-22", "holiday", 0], ["2028-05-06", "actual_weekday", 6],
  ] as const) {
    const old = getIndividualAmountReferenceContext({ ...paramsFor(date), applyLongHolidayRule: false });
    assert.equal(old.kind, oldKind);
    assert.equal(old.referenceWeekday, referenceWeekday);
    assert.equal(old.referenceWeekdayGroup, null);
    const stored = calendar(date, legacyBasis(date), false);
    assert.deepEqual(stored.individualAmountReference[0], { ...old, sessionStartedAt: `${date}T17:00:00+09:00` });
    const saved = snapshot(date, stored);
    assert.deepEqual(json(buildSessionCalendarContextFromSnapshot(saved)), json(stored));
    assert.deepEqual(json(normalizeAnalysisCalendarContext(stored)), json(stored));
    const day = buildDayAnalysisCalendarContext({ date, sessionContexts: [stored] });
    assert.deepEqual(day?.individualAmountReference, stored.individualAmountReference);
    assert.equal(day?.areaCountReference[0]?.comparisonMode, "weekday");
  }
});

test("context欠損旧snapshotは日次復元・Review19 clone・exportで長期ルールを遡及適用しない", () => {
  for (const [date, oldKind] of [["2026-09-21", "holiday"], ["2028-05-06", "actual_weekday"]] as const) {
    const saved = snapshot(date);
    const expected = calendar(date, legacyBasis(date), false);
    assert.deepEqual(json(buildSessionCalendarContextFromSnapshot(saved)), json(expected));
    const review = reviewWithSnapshot(saved);
    const cloned = normalizeReview19Result(review);
    assert.equal(cloned?.snapshot?.calendarContext?.individualAmountReference[0]?.kind, oldKind);
    assert.deepEqual(json(cloned?.snapshot?.calendarContext), json(expected));
    const exported = buildReview19ExportPayload({ records: [review], exportedAt: "2030-01-01T00:00:00Z" });
    assert.deepEqual(json(exported.records[0]?.snapshot?.calendarContext), json(expected));
    const roundtrip = normalizeRemoteReview19Row(buildRemoteReview19Row(review), "normal");
    assert.deepEqual(json(roundtrip?.snapshot?.calendarContext), json(expected));
  }
});

test("新kindはnormalization・日次export・Review19/cloudで欠落せずschema3を維持", () => {
  const date = "2026-09-21";
  const result = recommendation(date, history(2026));
  const basis = buildAreaCountDecisionBasis({ recommendation: result, evaluationSource: "history" });
  const stored = calendar(date, basis);
  assert.deepEqual(json(normalizeAnalysisCalendarContext(stored)), json(stored));
  const record = { ...makeRecord(date, 20), calendarContext: stored, decisionBasis: basis };
  const roundtrip = normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(record)])[0];
  assert.equal(roundtrip?.dataSchemaVersion, 3);
  assert.deepEqual(json(roundtrip?.calendarContext), json(stored));
  assert.deepEqual(json(roundtrip?.decisionBasis), json(basis));
  const saved = snapshot(date, stored);
  const day: Review19DaySnapshot = {
    version: 1, dataSchemaVersion: 3, appVersion: "2026.8.9-29", buildId: "build-long-holiday-test",
    capturedAt: `${date}T20:35:00+09:00`, date, demandCycle: "normal", calendarContext: stored,
    review19Status: "not_performed", sessions: [saved], areaCountRecords: [record],
  };
  const daily = buildAllFinalizedDayDataExportPayloadsByDemandCycle({ records: [day], exportedAt: "2030-01-01T00:00:00Z" });
  assert.deepEqual(daily[0]?.payload.records[0]?.calendarContext?.individualAmountReference, stored.individualAmountReference);
  assert.equal(daily[0]?.payload.records[0]?.dataSchemaVersion, 3);
  const review = reviewWithSnapshot(saved);
  assert.deepEqual(json(buildReview19ExportPayload({ records: [review], exportedAt: "2030-01-01T00:00:00Z" }).records[0]?.snapshot?.calendarContext), json(stored));
  assert.deepEqual(json(normalizeRemoteReview19Row(buildRemoteReview19Row(review), "normal")?.snapshot?.calendarContext), json(stored));
});

test("旧recordの保存分類・判定basis・backfillは金土当日比較への変更で書換えない", () => {
  const date = "2028-05-06";
  const stored = calendar(date, legacyBasis(date), false);
  const record = { ...makeRecord(date, 20), calendarContext: stored, decisionBasis: legacyBasis(date), suggestedEvaluation: "many" as const, areaRateAdjustment: 10 as const };
  for (const normalized of [normalizeAreaCountRecords([record])[0], normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(record)])[0]]) {
    assert.ok(normalized);
    assert.equal(normalized.actualWeekdayGroup, record.actualWeekdayGroup);
    assert.deepEqual(json(normalized.decisionBasis), json(record.decisionBasis));
    assert.deepEqual(json(normalized.calendarContext), json(stored));
    assert.equal(normalized.suggestedEvaluation, "many");
    assert.equal(normalized.areaRateAdjustment, 10);
  }
  const collected = collectAreaCountBackfillRecords({ nowMs: Date.parse("2030-01-01T00:00:00Z"), dailySessionSnapshots: [snapshot(date, stored)] });
  assert.equal(collected.length, 1);
  assert.equal(collected[0]?.actualWeekdayGroup, "金土");
  assert.equal(collected[0]?.decisionBasis?.comparisonMode, "weekday");
  assert.deepEqual(json(collected[0]?.calendarContext), json(stored));
});

test("productionAnalysisは同じ観測値と判断を持つ新旧calendarContextで変化しない", () => {
  const date = "2026-09-21";
  const legacy = snapshot(date, calendar(date, legacyBasis(date), false));
  const current = snapshot(date, calendar(date, legacyBasis(date)));
  const analyze = (session: DailySessionSnapshot) => buildProductionAnalysis({ date, demandCycle: "normal", areaIds: ["bento_men"], areaCountRecords: [], sessions: [session] });
  assert.deepEqual(analyze(current), analyze(legacy));
  assert.equal(legacy.areas.bento_men.areaCountEvaluation, current.areas.bento_men.areaCountEvaluation);
});

// Captured from the verified 2026.8.9-28 source before this change. These fixed
// fingerprints keep this check self-contained; no old checkout is read at run time.
const GOLDEN_NON17 = "d36c310dd3a14df208fbf42b2e21e530a2385b5c23f64b67b81e99367738e687";
const GOLDEN_RATES = "6627b95b633e13e93beb137abd3ed315fe4167ea38d3ff64ed396f345156ad67";
const goldenDates = ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2028-05-06", "2029-05-05"];

test("非17時のreference・履歴比較・履歴不足表示64条件は9-28の実結果と同一", () => {
  const values: unknown[] = [];
  for (const date of goldenDates) for (const demandCycle of ["normal", "summer"] as const) for (const discountTime of ["15", "18", "19", "20"] as const) {
    const params = paramsFor(date, discountTime);
    values.push([params, demandCycle, getIndividualAmountReferenceContext(params), getAreaCountFallbackWeekdayGroup(params), getAreaCountComparisonWeekdayGroup(params), recommendation(date, [], discountTime, demandCycle)]);
  }
  assert.equal(values.length, 64);
  assert.equal(hash(values), GOLDEN_NON17);
});

test("全時刻の率・天候解決・先行率720条件は9-28の実結果と同一", () => {
  const values: unknown[] = [];
  for (const date of goldenDates) for (const demandCycle of ["normal", "summer"] as const) for (const discountTime of ["15", "17", "18", "19", "20"] as const) {
    const params = paramsFor(date, discountTime);
    for (const weatherKind of ["sunny", "rain", "snow"] as const) {
      const hourlyForecasts = createDefaultHourlyForecasts();
      for (const hour of Object.keys(hourlyForecasts) as Array<keyof typeof hourlyForecasts>) hourlyForecasts[hour] = { ...hourlyForecasts[hour], weather: weatherKind };
      const weather = resolveWeatherInputForDiscount({ hourlyForecasts, afterRainSky: null }, discountTime);
      const info = getWeekdayBaseInfo(params.weekday, discountTime, weather, date, demandCycle);
      for (const adjustment of [-5, 0, 5] as const) values.push([
        params, demandCycle, weatherKind, adjustment, weather, info,
        getAdvanceDiscountRate({ session: { ...params, demandCycle, globalDiscountAdjustmentPercent: adjustment }, resolvedWeather: weather, isFixedTimeMode: false }),
        getNormalTimeRateDisplay({ discountTime, weatherBonus: info.baseRateBonus, areaJudge: "normal", isSunday: params.weekday === 0, ignoreTimeRateCap: false, weekdayBase: info.adjusted }),
      ]);
    }
  }
  assert.equal(values.length, 720);
  assert.equal(hash(values), GOLDEN_RATES);
});

console.log(`Long holiday reference: ${passed}/${passed + failed} checks passed`);
if (failed) process.exitCode = 1;
