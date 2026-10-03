import assert from "node:assert/strict";
import { ALL_AREA_IDS, LEGACY_AREA_MASTERS } from "../src/domain/area.ts";
import {
  buildAreaCountDecisionBasis,
  canSuppressAreaCountDecreaseAdjustment,
  cloneAreaCountRecords,
  evaluationToRateAdjustment,
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  getDecreaseRateAssessment,
  normalizeAreaCountDecisionBasis,
  normalizeAreaCountRecords,
  setAreaCountDecreaseAdjustmentSuppressed,
  type AreaCountDecisionBasis,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import {
  buildRemoteAreaCountRow,
  normalizeRemoteAreaCountRows,
} from "../src/domain/areaCountRemoteStorage.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { buildAutomaticDayExportPayload } from "../src/domain/dayExport.ts";
import { getNormalTimeRateDisplay, getNormalTimeRatePercentages } from "../src/domain/discount.ts";
import { initializeFinalizedDayDataInMemory } from "../src/domain/finalizedDayData.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import {
  loadCurrentSession,
  loadWorkSessionCheckpoint,
  saveCurrentSession,
  saveWorkSessionCheckpoint,
} from "../src/domain/storage.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import {
  createDailySessionSnapshot,
  createReview19DaySnapshot,
  createReview19Snapshot,
} from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { buildCurrentNormalRateNumbers, buildCurrentNormalRatePresentation } from "../src/hooks/nebikiApp/ratePresentation.ts";
import type { AreaCountEvaluation, AreaId, DiscountTime, SessionDraft } from "../src/domain/types.ts";

const TODAY = "2026-09-08";
const AT = `${TODAY}T08:10:00.000Z`;
const DATES = ["2026-08-18", "2026-08-25", "2026-09-01"];
const TARGETS: AreaId[] = ["bento_men", "tempura", "onigiri", "inari", "hosomaki", "ryomi", "autumn", "yakitori"];
const EXCLUSIONS: AreaId[] = ["croquette", "fry_chicken", "chuka_fish", "sushi", "futomaki_chumaki", "balance_bento"];
const checks: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void) => checks.push({ name, run });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function record(date: string, count: number, areaId: AreaId, discountTime: DiscountTime): AreaCountRecord {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return {
    ...getCurrentDataVersionInfo(), date, areaId, discountTime, count,
    demandCycle: "normal", sessionStartedAt: `${date}T08:00:00.000Z`,
    recordedAt: `${date}T08:05:00.000Z`,
    actualWeekday: getActualWeekdayLabel(weekday),
    actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({ date, weekday, discountTime }),
  };
}

function recommend(params: {
  areaId?: AreaId; time?: DiscountTime; count?: number;
  medianCount?: number; medianPrevious?: number; previous?: number;
  dates?: string[]; omitCurrentPrevious?: boolean; previousTime?: DiscountTime;
} = {}) {
  const areaId = params.areaId ?? "bento_men";
  const discountTime = params.time ?? "17";
  const previousTime = params.previousTime ?? (discountTime === "19" ? "18" : "15");
  const records = (params.dates ?? DATES).flatMap((date) => [
    record(date, params.medianCount ?? 50, areaId, discountTime),
    record(date, params.medianPrevious ?? 100, areaId, previousTime),
  ]);
  if (!params.omitCurrentPrevious) records.push(record(TODAY, params.previous ?? 100, areaId, previousTime));
  const original = structuredClone(records);
  const result = getAreaCountRecommendation({ records, areaId, discountTime, count: params.count ?? 70, weekday: 2, date: TODAY, demandCycle: "normal" });
  assert.deepEqual(records, original, "recommendation must not mutate saved observations");
  return result;
}

function basisFor(base: AreaCountEvaluation = "normal") {
  const medianCount = ({ few: 100, slightly_few: 80, normal: 70, slightly_many: 62, many: 50 })[base];
  const recommendation = recommend({ medianCount, medianPrevious: medianCount * 2, count: 70 });
  assert.equal(recommendation.baseEvaluation, base);
  assert.equal(recommendation.decreaseRecommendation?.direction, "more_many");
  return {
    recommendation,
    basis: buildAreaCountDecisionBasis({ recommendation, evaluationSource: "history", finalEvaluation: recommendation.suggestedEvaluation, areaRateAdjustment: recommendation.areaRateAdjustment }),
  };
}

function toggle(basis: AreaCountDecisionBasis, suppressed: boolean) {
  const result = setAreaCountDecreaseAdjustmentSuppressed({ areaId: "bento_men", discountTime: "17", basis, suppressed });
  assert.ok(result);
  return result;
}

function assertSuppressed(basis: AreaCountDecisionBasis | undefined) {
  assert.ok(basis);
  assert.equal(basis.finalEvaluation, "normal");
  assert.equal(basis.areaRateAdjustment, 0);
  assert.equal(basis.decreaseAdjustment?.suppressed, true);
  assert.equal(basis.decreaseAdjustment?.suppressionReason, "additional_production");
  assert.equal(basis.decreaseAdjustment?.direction, "more_many");
  assert.equal(basis.decreaseAdjustment?.currentDecreaseRate, 0.3);
  assert.equal(basis.decreaseAdjustment?.medianDecreaseRate, 0.5);
  assert.equal(getDecreaseRateAssessment(basis.decreaseAdjustment), "悪い");
}

for (const areaId of TARGETS) {
  test(`17:00 includes ${areaId} and allows bad correction cancellation`, () => {
    const recommendation = recommend({ areaId });
    assert.equal(recommendation.status, "ready");
    assert.equal(recommendation.decreaseRecommendation?.canUse, true);
    assert.equal(recommendation.decreaseRecommendation?.previousDiscountTime, "15");
    assert.equal(getDecreaseRateAssessment(recommendation.decreaseRecommendation), "悪い");
    const basis = buildAreaCountDecisionBasis({ recommendation });
    assert.equal(canSuppressAreaCountDecreaseAdjustment({ areaId, discountTime: "17", basis }), true);
  });
}
for (const areaId of EXCLUSIONS) {
  test(`17:00 still excludes ${areaId}`, () => {
    const recommendation = recommend({ areaId });
    assert.equal(recommendation.status, "ready");
    assert.equal(recommendation.decreaseRecommendation?.canUse, false);
    assert.equal(getDecreaseRateAssessment(recommendation.decreaseRecommendation), "判定なし");
    // A raw bad basis from another area cannot make an excluded area eligible.
    assert.equal(canSuppressAreaCountDecreaseAdjustment({ areaId, discountTime: "17", basis: basisFor().basis }), false);
  });
}
test("internal seasonal IDs and current names remain compatible", () => {
  assert.equal(LEGACY_AREA_MASTERS.find((area) => area.id === "ryomi")?.name, "夏商品");
  assert.equal(LEGACY_AREA_MASTERS.find((area) => area.id === "autumn")?.name, "秋商品");
  assert.equal(LEGACY_AREA_MASTERS.find((area) => area.id === "yakitori")?.name, "焼鳥");
  assert.deepEqual([...ALL_AREA_IDS].sort(), [...TARGETS, ...EXCLUSIONS].sort());
});

test("18:30 never uses decrease, while 19:30 still uses all known areas", () => {
  for (const areaId of ALL_AREA_IDS) {
    const at18 = recommend({ areaId, time: "18", previousTime: "17" });
    assert.equal(at18.decreaseRecommendation?.canUse, false);
    assert.equal(getDecreaseRateAssessment(at18.decreaseRecommendation), "判定なし");
    const at19 = recommend({ areaId, time: "19" });
    assert.equal(at19.decreaseRecommendation?.canUse, true);
    assert.equal(at19.decreaseRecommendation?.previousDiscountTime, "18");
    assert.equal(getDecreaseRateAssessment(at19.decreaseRecommendation), "悪い");
    assert.equal(canSuppressAreaCountDecreaseAdjustment({ areaId, discountTime: "19", basis: buildAreaCountDecisionBasis({ recommendation: at19 }) }), false);
    // Keep the exact 9-39 19:30 binary boundary comparison, including this
    // previously unadjusted 40%→60% case. The equality repair is 17:00 only.
    const boundary19 = recommend({ areaId, time: "19", medianCount: 60, count: 40 });
    assert.equal(boundary19.decreaseRecommendation?.currentDecreaseRate, 0.6);
    assert.equal(boundary19.decreaseRecommendation?.medianDecreaseRate, 0.4);
    assert.equal(boundary19.decreaseRecommendation?.direction, "none");
  }
});

for (const [decreasePercent, direction, assessment] of [
  [70, "more_few", "良い"], [69, "none", "普通"],
  [30, "more_many", "悪い"], [31, "none", "普通"],
] as const) {
  test(`50% median / ${decreasePercent}% decrease has exact 20pt classification`, () => {
    const recommendation = recommend({ count: 100 - decreasePercent });
    assert.equal(recommendation.decreaseRecommendation?.currentDecreaseRate, decreasePercent / 100);
    assert.equal(recommendation.decreaseRecommendation?.medianDecreaseRate, 0.5);
    assert.equal(recommendation.decreaseRecommendation?.direction, direction);
    assert.equal(getDecreaseRateAssessment(recommendation.decreaseRecommendation), assessment);
    assert.equal(canSuppressAreaCountDecreaseAdjustment({ areaId: "bento_men", discountTime: "17", basis: buildAreaCountDecisionBasis({ recommendation }) }), direction === "more_many");
  });
}
test("17:00 binary equality 40%→60% receives the existing one-step correction", () => {
  const recommendation = recommend({ medianCount: 60, count: 40 });
  assert.equal(recommendation.decreaseRecommendation?.medianDecreaseRate, 0.4);
  assert.equal(recommendation.decreaseRecommendation?.currentDecreaseRate, 0.6);
  assert.equal(recommendation.decreaseRecommendation?.direction, "more_few");
});
test("the equality tolerance does not classify a genuine sub-20pt difference", () => {
  for (const count of [3_000_000_001, 6_999_999_999]) {
    const recommendation = recommend({ previous: 10_000_000_000, medianPrevious: 10_000_000_000, medianCount: 5_000_000_000, count });
    assert.equal(recommendation.decreaseRecommendation?.direction, "none");
  }
});
test("missing previous or fewer than three decrease samples has no assessment or cancellation", () => {
  const missing = recommend({ omitCurrentPrevious: true });
  assert.equal(getDecreaseRateAssessment(missing.decreaseRecommendation), "判定なし");
  const insufficient = recommend({ dates: DATES.slice(0, 2) });
  assert.equal(insufficient.status, "insufficient");
  assert.equal(getDecreaseRateAssessment(insufficient.decreaseRecommendation), "判定なし");
  assert.equal(getDecreaseRateAssessment(undefined), "判定なし");
  assert.equal(getDecreaseRateAssessment(null), "判定なし");
  for (const recommendation of [missing, insufficient]) {
    assert.equal(canSuppressAreaCountDecreaseAdjustment({ areaId: "bento_men", discountTime: "17", basis: buildAreaCountDecisionBasis({ recommendation }) }), false);
  }
});

for (const base of ["normal", "slightly_few", "few", "slightly_many", "many"] as const) {
  test(`cancel/restore is based on raw ${base} and never accumulates`, () => {
    const { basis, recommendation } = basisFor(base);
    const original = structuredClone(basis);
    Object.freeze(basis.decreaseAdjustment);
    Object.freeze(basis);
    const suppressed = toggle(basis, true);
    assert.equal(suppressed.finalEvaluation, base);
    assert.equal(suppressed.areaRateAdjustment, evaluationToRateAdjustment(base));
    assert.equal(suppressed.decreaseAdjustment?.suppressed, true);
    assert.equal(suppressed.decreaseAdjustment?.suppressionReason, "additional_production");
    assert.equal(getDecreaseRateAssessment(suppressed.decreaseAdjustment), "悪い");
    const { suppressed: flag, suppressionReason, ...raw } = suppressed.decreaseAdjustment!;
    assert.equal(flag, true);
    assert.equal(suppressionReason, "additional_production");
    assert.deepEqual(raw, basis.decreaseAdjustment);
    assert.deepEqual(toggle(suppressed, true), suppressed);
    const restored = toggle(suppressed, false);
    assert.equal(restored.finalEvaluation, recommendation.suggestedEvaluation);
    assert.equal(restored.areaRateAdjustment, recommendation.areaRateAdjustment);
    assert.equal(Object.hasOwn(restored.decreaseAdjustment!, "suppressed"), false);
    assert.equal(Object.hasOwn(restored.decreaseAdjustment!, "suppressionReason"), false);
    assert.deepEqual(restored, basis);
    assert.deepEqual(toggle(restored, false), restored);
    assert.deepEqual(basis, original);
  });
}

test("explicit manual final evaluation and rate take priority over suppression", () => {
  for (const finalEvaluation of ["few", "slightly_few", "normal", "slightly_many", "many"] as const) {
    const manual: AreaCountDecisionBasis = { ...basisFor().basis, evaluationSource: "manual", finalEvaluation, areaRateAdjustment: evaluationToRateAdjustment(finalEvaluation) };
    const cancelled = toggle(manual, true);
    assert.equal(cancelled.finalEvaluation, finalEvaluation);
    assert.equal(cancelled.areaRateAdjustment, manual.areaRateAdjustment);
    const restored = toggle(cancelled, false);
    assert.deepEqual(restored, manual);
  }
});

test("setter rejects good, normal, unavailable, missing base, non-ready and other-time bases", () => {
  const basis = basisFor().basis;
  const badBases = [
    { ...basis, recommendationStatus: "insufficient" as const },
    { ...basis, recommendationStatus: "disabled" as const },
    { ...basis, baseEvaluation: undefined },
    { ...basis, decreaseAdjustment: undefined },
    ...(["more_few", "none"] as const).map((direction) => ({ ...basis, decreaseAdjustment: { ...basis.decreaseAdjustment!, direction } })),
    { ...basis, decreaseAdjustment: { ...basis.decreaseAdjustment!, canUse: false } },
    { ...basis, decreaseAdjustment: { ...basis.decreaseAdjustment!, previousDiscountTime: undefined } },
  ];
  for (const invalid of badBases) {
    assert.equal(canSuppressAreaCountDecreaseAdjustment({ areaId: "bento_men", discountTime: "17", basis: invalid }), false);
    assert.equal(setAreaCountDecreaseAdjustmentSuppressed({ areaId: "bento_men", discountTime: "17", basis: invalid, suppressed: true }), null);
  }
  for (const discountTime of ["15", "18", "19", "20"] as const) {
    assert.equal(setAreaCountDecreaseAdjustmentSuppressed({ areaId: "bento_men", discountTime, basis, suppressed: true }), null);
  }
  assert.equal(canSuppressAreaCountDecreaseAdjustment({ areaId: null, discountTime: "17", basis }), false);
});

test("schema3 normalization preserves valid optional metadata without legacy backfill", () => {
  const legacy = basisFor().basis;
  const original = structuredClone(legacy);
  const normalizedLegacy = normalizeAreaCountDecisionBasis(legacy)!;
  assert.equal(Object.hasOwn(normalizedLegacy.decreaseAdjustment!, "suppressed"), false);
  assert.equal(Object.hasOwn(normalizedLegacy.decreaseAdjustment!, "suppressionReason"), false);
  for (const suppressed of [false, true]) {
    const input = { ...legacy, decreaseAdjustment: { ...legacy.decreaseAdjustment!, suppressed, suppressionReason: "additional_production" as const } };
    const normalized = normalizeAreaCountDecisionBasis(input)!;
    assert.equal(normalized.decreaseAdjustment?.suppressed, suppressed);
    assert.equal(normalized.decreaseAdjustment?.suppressionReason, "additional_production");
    assert.equal(normalized.decreaseAdjustment?.direction, legacy.decreaseAdjustment?.direction);
    assert.equal(normalized.decreaseAdjustment?.currentDecreaseRate, legacy.decreaseAdjustment?.currentDecreaseRate);
    assert.equal(normalized.decreaseAdjustment?.medianDecreaseRate, legacy.decreaseAdjustment?.medianDecreaseRate);
  }
  const invalid = { ...legacy, decreaseAdjustment: { ...legacy.decreaseAdjustment!, suppressed: "true", suppressionReason: "unknown" } };
  const normalizedInvalid = normalizeAreaCountDecisionBasis(invalid)!;
  assert.equal(Object.hasOwn(normalizedInvalid.decreaseAdjustment!, "suppressed"), false);
  assert.equal(Object.hasOwn(normalizedInvalid.decreaseAdjustment!, "suppressionReason"), false);
  assert.deepEqual(legacy, original);
});

test("record clone/normalize and remote JSON preserve raw decision and suppression", () => {
  const basis = toggle(basisFor().basis, true);
  const saved: AreaCountRecord = { ...record(TODAY, 70, "bento_men", "17"), suggestedEvaluation: "normal", areaRateAdjustment: 0, evaluationSource: "history", decisionBasis: basis };
  const original = structuredClone(saved);
  const cloned = cloneAreaCountRecords([saved])[0];
  assert.notEqual(cloned.decisionBasis, saved.decisionBasis);
  const normalized = normalizeAreaCountRecords([saved])[0];
  const remote = buildRemoteAreaCountRow(saved);
  const recovered = normalizeRemoteAreaCountRows([copy(remote)])[0];
  for (const candidate of [cloned, normalized, recovered]) assertSuppressed(candidate.decisionBasis);
  assertSuppressed(remote.record_details?.decisionBasis);
  assert.equal(remote.data_schema_version, 3);
  assert.deepEqual(saved, original);
  const old = { ...saved, decisionBasis: basisFor().basis };
  const oldRecovered = normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(old)])[0];
  assert.equal(Object.hasOwn(oldRecovered.decisionBasis!.decreaseAdjustment!, "suppressed"), false);
});

test("current/checkpoint recovery, daily/Review19 snapshots, finalized and export preserve adoption", () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } });
  try {
    const draft: SessionDraft = { date: TODAY, weekday: 2, discountTime: "17", demandCycle: "normal", manualWeekdayOverride: false, manualDiscountTimeOverride: false, weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null } };
    const state = createInitialState(draft);
    state.session = { ...draft, ...getCurrentDataVersionInfo(), startedAt: `${TODAY}T08:00:00.000Z` };
    state.screen = "rate_display";
    state.currentAreaId = "bento_men";
    const basis = toggle(basisFor().basis, true);
    state.areaProgressMap.bento_men = { ...state.areaProgressMap.bento_men, status: "completed", areaCount: 70, areaJudge: "normal", areaCountEvaluation: "normal", areaCountEvaluationSource: "history", areaRateAdjustment: 0, areaCountDecisionBasis: basis };
    saveCurrentSession(state);
    saveWorkSessionCheckpoint(state);
    for (const saved of [loadCurrentSession(), loadWorkSessionCheckpoint()]) {
      assert.ok(saved);
      const recovered = normalizeLoadedState(saved);
      assert.equal(recovered.currentAreaId, "bento_men");
      assert.equal(recovered.areaProgressMap.bento_men.areaCount, 70);
      assert.equal(recovered.areaProgressMap.bento_men.areaCountEvaluation, "normal");
      assertSuppressed(recovered.areaProgressMap.bento_men.areaCountDecisionBasis);
    }
    state.screen = "done";
    const resolvedWeather = resolveWeatherInputForDiscount(state.session.weather, "17");
    const snapshotInputs = { capturedAt: AT, resolvedWeather, lateTimeBonus: 0, doneSummaryItems: [], weekdayBaseInfo: getWeekdayBaseInfo(2, "17", resolvedWeather, TODAY), basisGuide: getBasisGuideDisplay({ date: TODAY, weekday: 2, discountTime: "17", demandCycle: "normal", weather: resolvedWeather }) };
    const daily = createDailySessionSnapshot({ ...snapshotInputs, state });
    assert.ok(daily);
    const review = createReview19Snapshot({ ...snapshotInputs, session: state.session, areaProgressMap: state.areaProgressMap, excludedAreaIds: [] });
    const saved: AreaCountRecord = { ...record(TODAY, 70, "bento_men", "17"), suggestedEvaluation: "normal", areaRateAdjustment: 0, evaluationSource: "history", decisionBasis: basis };
    const day = createReview19DaySnapshot({ date: TODAY, capturedAt: AT, demandCycle: "normal", sessions: [daily], areaCountRecords: [saved] });
    const finalized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot: day, finalizedAt: AT }).record;
    const exported = buildAutomaticDayExportPayload({ date: TODAY, exportedAt: AT, daySnapshot: day });
    for (const candidate of [
      daily.areas.bento_men.areaCountDecisionBasis, review.areas.bento_men.areaCountDecisionBasis,
      day.sessions[0].areas.bento_men.areaCountDecisionBasis, day.areaCountRecords[0].decisionBasis,
      finalized.sessions[0].areas.bento_men.areaCountDecisionBasis, finalized.areaCountRecords[0].decisionBasis,
      exported.daySnapshot.sessions[0].areas.bento_men.areaCountDecisionBasis,
      exported.daySnapshot.areaCountRecords[0].decisionBasis,
    ]) assertSuppressed(candidate);
    assert.notEqual(daily.areas.bento_men.areaCountDecisionBasis, basis);
    assert.equal(exported.dataSchemaVersion, 3);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("numeric rate core exactly matches displayed rates for legacy judges and all five adjustments", () => {
  let cases = 0;
  for (const discountTime of ["15", "17", "18", "19"] as const) {
    for (const weatherBonus of [-20, -10, 0, 5, 10, 20, 50]) {
      for (const areaJudge of ["many", "normal", "few"] as const) {
        for (const areaRateAdjustment of [undefined, -10, -5, 0, 5, 10] as const) {
          for (const ignoreTimeRateCap of [false, true]) {
            const params = { discountTime, date: TODAY, weekday: 2, weatherBonus, areaJudge, areaRateAdjustment, ignoreTimeRateCap };
            const numbers = getNormalTimeRatePercentages(params);
            const display = getNormalTimeRateDisplay(params);
            assert.equal(display.many.main, `${numbers.manyRatePercent}%`);
            assert.equal(display.normal.main, `${numbers.normalRatePercent}%`);
            assert.equal(display.few.main, "引かない");
            assert.ok(numbers.manyRatePercent >= 0 && numbers.manyRatePercent <= 50);
            assert.ok(numbers.normalRatePercent >= 0 && numbers.normalRatePercent <= 50);
            cases += 1;
          }
        }
      }
    }
  }
  assert.equal(cases, 1008);
});

test("current numeric rates preserve offset/global order including early-next and zero/clamp edges", () => {
  let cases = 0;
  for (const discountTime of ["15", "17", "18", "19"] as const) {
    for (const effectiveDiscountTime of [discountTime, "18"] as const) {
      for (const globalDiscountAdjustmentPercent of [-5, 0, 5] as const) {
        for (const rateOffsetPercent of [-5, 0, 5]) {
          for (const weatherBonus of [-20, -10, 0, 5, 10, 20, 50]) {
            for (const areaRateAdjustment of [-10, -5, 0, 5, 10] as const) {
              const draft: SessionDraft = { date: TODAY, weekday: 2, discountTime, demandCycle: "normal", globalDiscountAdjustmentPercent, manualWeekdayOverride: false, manualDiscountTimeOverride: false, weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null } };
              const state = createInitialState(draft);
              const session = { ...draft, ...getCurrentDataVersionInfo(), startedAt: AT };
              const progress = { ...state.areaProgressMap.bento_men, areaJudge: "normal" as const, areaRateAdjustment };
              const params = { session, progress, effectiveDiscountTime, weatherBonus, ignoreTimeRateCap: true, rateOffsetPercent };
              const display = buildCurrentNormalRatePresentation(params)!;
              const numbers = buildCurrentNormalRateNumbers(params)!;
              assert.equal(display.display.many.main, `${numbers.manyRatePercent}%`);
              assert.equal(display.display.normal.main, `${numbers.normalRatePercent}%`);
              cases += 1;
            }
          }
        }
      }
    }
  }
  assert.equal(cases, 2520);
  const empty = { session: null, progress: undefined, effectiveDiscountTime: null, weatherBonus: 0, ignoreTimeRateCap: false };
  assert.equal(buildCurrentNormalRateNumbers(empty), null);
});

for (const check of checks) {
  check.run();
  console.log(`PASS ${check.name}`);
}
console.log(`Area decrease adjustment checks passed: ${checks.length}/${checks.length}`);
