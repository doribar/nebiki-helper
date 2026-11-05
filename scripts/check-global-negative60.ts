import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getAdvanceDiscountRate } from "../src/domain/advanceDiscount.ts";
import { getColdDeliGuide } from "../src/domain/coldDeliGuide.ts";
import { buildAutomaticDayExportPayload } from "../src/domain/dayExport.ts";
import { DATA_SCHEMA_VERSION, getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { getBaseRate } from "../src/domain/discount.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { createInitialReview19Result } from "../src/domain/review19.ts";
import {
  buildRateDecisionSnapshot,
  normalizeRateDecisionSnapshot,
  reconstructRateDisplayFromSnapshot,
  type BuildRateDecisionSnapshotParams,
} from "../src/domain/rateDecisionSnapshot.ts";
import { buildAllFinalizedDayDataExportPayload, buildDirectReview19DataExportPayload } from "../src/domain/separateDataExport.ts";
import type {
  AreaJudge, AreaRateAdjustment, DemandCycle, DiscountTime,
  RateDecisionSnapshot, ResolvedWeatherInput, SessionData,
} from "../src/domain/types.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import {
  buildCompletedRateSnapshot,
  buildCurrentNormalRateNumbers,
  buildCurrentNormalRatePresentation,
} from "../src/hooks/nebikiApp/ratePresentation.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";

// The JSON oracle was generated using original v59 modules, with release metadata
// injected before import. It is intentionally static and does not import a sibling
// working copy at test time. Its source-file SHA-256 values document provenance.
type NonFinalMode = Exclude<RateDecisionSnapshot["calculationMode"], "final">;
type NormalTime = Exclude<DiscountTime, "20">;
type AreaInput = { areaJudge: Exclude<AreaJudge, null>; areaRateAdjustment?: AreaRateAdjustment };
const baseline = JSON.parse(readFileSync(new URL("./fixtures/global-negative60-v59.json", import.meta.url), "utf8")) as {
  source: { appVersion: string; buildId: string; files: Record<string, string> };
  unchangedSnapshotComparisons: Array<{ global: -5 | 0; mode: NonFinalMode; count: number; sha256: string; rateAndDisplaySha256: string }>;
  unchangedGuides: { count: number; sha256: string };
  oldSnapshots: Array<{ name: string; params: BuildRateDecisionSnapshotParams; snapshot: RateDecisionSnapshot }>;
};
const DATE = "2026-09-08", AREA = "bento_men";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const resolvedWeather: ResolvedWeatherInput = {
  nearTermWeather: "other", hasLaterPrecip: false, laterPrecipType: null,
  precipitationRateBonus: 0, precipitationRateBonusLabel: null,
  windLevel: "2orLess", tempLevel: "21to25", weatherPointScore: 0,
  weatherPointShift: 0, weatherPointRangeText: null, next18TempDropShift: 0,
  next18WindWorsenShift: 0, next18WindWorsenKind: null, afterRainSky: null,
};
const areas: AreaInput[] = [
  { areaJudge: "many" }, { areaJudge: "normal" }, { areaJudge: "few" },
  ...([-10, -5, 0, 5, 10] as const).map(areaRateAdjustment => ({ areaJudge: "normal" as const, areaRateAdjustment })),
];
function input(time: NormalTime, mode: NonFinalMode, cycle: DemandCycle, weather: number, area: AreaInput, global: -5 | 0 | 5): BuildRateDecisionSnapshotParams {
  return { confirmedAt: "2026-09-08T09:00:00.000Z", sessionDiscountTime: time,
    effectiveRateDiscountTime: time, calculationMode: mode, demandCycle: cycle,
    resolvedWeather, weatherComfortAdjustmentPercent: weather, ...area,
    globalDiscountAdjustmentPercent: global };
}
function signature(s: RateDecisionSnapshot): unknown[] {
  return [s.basicRatePercent, s.weatherComfortAdjustmentPercent, s.lateTimeAdjustmentPercent,
    s.earlyNextAdjustmentPercent, s.areaCountAdjustmentPercent, s.legacyAreaJudgeAdjustmentPercent,
    s.normalRateBeforeLimitsPercent, s.manyRateBeforeLimitsPercent,
    s.normalRateAfterBaseLimitsPercent, s.manyRateAfterBaseLimitsPercent,
    s.normalRatePercent, s.manyRatePercent, s.displayedNormalRatePercent,
    s.displayedManyRatePercent, s.display, s.limits];
}
function session(time: DiscountTime, cycle: DemandCycle = "normal", global: -5 | 0 | 5 = 5): SessionData {
  return { ...getCurrentDataVersionInfo(), date: DATE, weekday: 2,
    discountTime: time, demandCycle: cycle, globalDiscountAdjustmentPercent: global,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
    startedAt: "2026-09-08T06:00:00.000Z" };
}
let passed = 0, snapshotComparisons = 0, numericComparisons = 0, guideComparisons = 0;
function test(name: string, run: () => void): void {
  run(); console.log(`PASS ${++passed}: ${name}`);
}

test("v59 oracle identifies original59 source bytes and preserves schema3", () => {
  assert.equal(DATA_SCHEMA_VERSION, 3);
  assert.equal(baseline.source.appVersion, "2026.8.9-59");
  assert.equal(baseline.source.buildId, "build-20261104-125115-jst");
  assert.equal(Object.keys(baseline.source.files).length, 4);
  for (const sha of Object.values(baseline.source.files)) assert.match(sha, /^[0-9a-f]{64}$/);
});

for (const oracle of baseline.unchangedSnapshotComparisons) test(`v59 exhaustive G${oracle.global}/${oracle.mode} keeps rates/display/few and records actual lower-limit stage`, () => {
  const hash = createHash("sha256"), rateAndDisplayHash = createHash("sha256"); let count = 0;
  for (const time of ["15", "17", "18", "19"] as const)
    for (const cycle of ["normal", "summer"] as const)
      for (const weather of [-30, -20, -10, -5, 0, 5, 10, 20, 30, 40, 50])
        for (const area of areas) {
          const snapshot = buildRateDecisionSnapshot(input(time, oracle.mode, cycle, weather, area, oracle.global));
          const saved = signature(snapshot);
          hash.update(JSON.stringify(saved) + "\n");
          rateAndDisplayHash.update(JSON.stringify(saved.slice(0, -1)) + "\n"); count++;
          const early = oracle.mode === "early_next_minus5" ? -5 : 0;
          for (const [raw, lower, upper] of [
            [snapshot.normalRateBeforeLimitsPercent, snapshot.limits.normalLowerLimitApplied, snapshot.limits.normalUpperLimitApplied],
            [snapshot.manyRateBeforeLimitsPercent, snapshot.limits.manyLowerLimitApplied, snapshot.limits.manyUpperLimitApplied],
          ] as const) {
            const afterOffset = Math.min(50, raw) + early;
            const beforeGlobal = Math.min(50, afterOffset);
            assert.equal(lower, beforeGlobal + oracle.global < 0);
            assert.equal(upper, raw > 50 || afterOffset > 50 || beforeGlobal + oracle.global > 50);
          }
          assert.deepEqual(normalizeRateDecisionSnapshot(clone(snapshot)), snapshot);
          const s = session(time, cycle, oracle.global);
          const presentationParams = { session: s, progress: { status: "unstarted" as const, ...area },
            effectiveDiscountTime: time, ignoreTimeRateCap: false,
            weatherBonus: weather + (oracle.mode === "late_plus5" ? 5 : 0),
            rateOffsetPercent: oracle.mode === "early_next_minus5" ? -5 : 0 };
          assert.deepEqual(clone(buildCurrentNormalRatePresentation(presentationParams)?.display), clone(snapshot.display));
          assert.deepEqual(buildCurrentNormalRateNumbers(presentationParams), {
            normalRatePercent: snapshot.displayedNormalRatePercent,
            manyRatePercent: snapshot.displayedManyRatePercent,
          });
        }
  assert.equal(count, oracle.count);
  assert.equal(rateAndDisplayHash.digest("hex"), oracle.rateAndDisplaySha256, "compare all pre-existing rates/display fields against original59 outputs");
  const wholeSignatureHash = hash.digest("hex");
  if (oracle.global !== 0 || oracle.mode !== "early_next_minus5") assert.equal(wholeSignatureHash, oracle.sha256);
  // For early raw0..4/G0 the signed -5 stage now correctly records a floor.
  // Original59's floor occurred before early/global and its flag was false;
  // the rate/display digest above still must match every original59 value.
  snapshotComparisons += count;
});

for (const mode of ["normal", "late_plus5", "early_next_minus5"] as const) test(`G+5 ${mode}: signed normal/many survive lower limit across all times, cycles and count sources`, () => {
  for (const time of ["15", "17", "18", "19"] as const)
    for (const cycle of ["normal", "summer"] as const)
      for (let rawNormal = -30; rawNormal <= 70; rawNormal += 5)
        for (const area of areas) {
          const areaBonus = area.areaRateAdjustment ?? (area.areaJudge === "many" ? 10 : area.areaJudge === "few" ? -5 : 0);
          const late = mode === "late_plus5" ? 5 : 0, early = mode === "early_next_minus5" ? -5 : 0;
          const weather = rawNormal - getBaseRate(time) - areaBonus - late;
          const snapshot = buildRateDecisionSnapshot(input(time, mode, cycle, weather, area, 5));
          // Existing upper50 occurs before legacy early -5 and global adjustment.
          // The new order changes only the lower0 stage, which follows global+5.
          const signedNormal = Math.min(50, Math.min(50, rawNormal) + early);
          const signedMany = Math.min(50, Math.min(50, rawNormal + 10) + early);
          const expectedNormal = Math.max(0, Math.min(50, signedNormal + 5));
          const expectedMany = Math.max(0, Math.min(50, signedMany + 5));
          assert.equal(snapshot.normalRateBeforeLimitsPercent, rawNormal);
          assert.equal(snapshot.normalRateBeforeGlobalAdjustmentPercent, signedNormal);
          assert.equal(snapshot.manyRateBeforeGlobalAdjustmentPercent, signedMany);
          assert.deepEqual([snapshot.displayedNormalRatePercent, snapshot.displayedManyRatePercent], [expectedNormal, expectedMany]);
          assert.deepEqual(snapshot.limits, {
            minimumPercent: 0, maximumPercent: 50,
            normalLowerLimitApplied: signedNormal + 5 < 0,
            normalUpperLimitApplied: rawNormal > 50 || Math.min(50, rawNormal) + early > 50 || signedNormal + 5 > 50,
            manyLowerLimitApplied: signedMany + 5 < 0,
            manyUpperLimitApplied: rawNormal + 10 > 50 || Math.min(50, rawNormal + 10) + early > 50 || signedMany + 5 > 50,
          });
          assert.equal(snapshot.display?.few.main, "5%", "few keeps its existing separate global display behavior");
          assert.deepEqual(normalizeRateDecisionSnapshot(clone(snapshot)), snapshot);
          const s = session(time, cycle);
          const presentationParams = { session: s, progress: { status: "unstarted" as const, ...area },
            effectiveDiscountTime: time, ignoreTimeRateCap: false,
            weatherBonus: weather + late, rateOffsetPercent: early };
          assert.deepEqual(clone(buildCurrentNormalRatePresentation(presentationParams)?.display), clone(snapshot.display));
          assert.deepEqual(buildCurrentNormalRateNumbers(presentationParams), { normalRatePercent: expectedNormal, manyRatePercent: expectedMany });
          if (mode !== "early_next_minus5") assert.deepEqual(buildCompletedRateSnapshot({
            session: s, progress: presentationParams.progress, weatherBonus: weather + late,
          }), { completedRateText: `${expectedNormal}%`, completedNormalRateText: `${expectedNormal}%`, completedManyRateText: `${expectedMany}%` });
          numericComparisons++;
        }
});

test("requested raw -10/-5/0/5 +5 matrix and many5/normal-5 example", () => {
  for (const [raw, expected] of [[-10, 0], [-5, 0], [0, 5], [5, 10]]) {
    const snapshot = buildRateDecisionSnapshot(input("15", "normal", "normal", raw, { areaJudge: "normal", areaRateAdjustment: 0 }, 5));
    assert.equal(snapshot.displayedNormalRatePercent, expected);
  }
  const example = buildRateDecisionSnapshot(input("15", "normal", "normal", 0, { areaJudge: "normal", areaRateAdjustment: -5 }, 5));
  assert.deepEqual([example.manyRateBeforeLimitsPercent, example.normalRateBeforeLimitsPercent], [5, -5]);
  assert.deepEqual([example.display?.many.main, example.display?.normal.main], ["10%", "0%"]);
  assert.equal(example.normalRatePercent, 0, "existing pre-global visible base remains clamped");
  assert.equal(example.displayedNormalRateBeforeGlobalAdjustmentPercent, 0);
  assert.equal(example.normalRateBeforeGlobalAdjustmentPercent, -5, "new metadata preserves actual signed global input");
  assert.equal(example.calculationOrder, "global_before_lower_limit_v1");
});

function persistedState(snapshot: RateDecisionSnapshot) {
  const s = session(snapshot.sessionDiscountTime, snapshot.demandCycle, snapshot.globalDiscountAdjustmentPercent ?? 0);
  const state = createInitialState(s); state.session = s; state.screen = "done"; state.currentAreaId = null;
  Object.assign(state.areaProgressMap[AREA], { status: "completed", areaJudge: "normal", areaCount: 20,
    areaRateAdjustment: snapshot.areaCountAdjustmentPercent, rateDecisionSnapshot: snapshot,
    completedRateText: snapshot.displayedRateText, completedNormalRateText: snapshot.displayedRateText,
    completedManyRateText: `${snapshot.displayedManyRatePercent}%`, completedAt: snapshot.confirmedAt });
  return state;
}
function dailyAndExports(snapshot: RateDecisionSnapshot) {
  const state = persistedState(snapshot), s = state.session!;
  const daily = createDailySessionSnapshot({ capturedAt: snapshot.confirmedAt, state, resolvedWeather,
    weekdayBaseInfo: getWeekdayBaseInfo(s.weekday, s.discountTime, resolvedWeather, s.date, s.demandCycle),
    basisGuide: getBasisGuideDisplay({ date: s.date, weekday: s.weekday, discountTime: s.discountTime, weather: resolvedWeather }),
    lateTimeBonus: snapshot.lateTimeAdjustmentPercent, doneSummaryItems: [] });
  assert.ok(daily);
  const day = createReview19DaySnapshot({ capturedAt: snapshot.confirmedAt, date: s.date,
    demandCycle: s.demandCycle, sessions: [daily], areaCountRecords: [] });
  const automatic = buildAutomaticDayExportPayload({ exportedAt: snapshot.confirmedAt, date: s.date, daySnapshot: day });
  const all = buildAllFinalizedDayDataExportPayload({ exportedAt: snapshot.confirmedAt, records: [day] });
  const record = { ...createInitialReview19Result({ date: s.date, sessionStartedAt: s.startedAt,
    demandCycle: s.demandCycle }), daySnapshot: day };
  const review19 = buildDirectReview19DataExportPayload({ exportedAt: snapshot.confirmedAt, record });
  return [daily.areas[AREA]?.rateDecisionSnapshot,
    automatic.daySnapshot.sessions[0]?.areas[AREA]?.rateDecisionSnapshot,
    all.records[0]?.sessions[0]?.areas[AREA]?.rateDecisionSnapshot,
    review19.records[0]?.daySnapshot?.sessions[0]?.areas[AREA]?.rateDecisionSnapshot];
}

for (const fixture of baseline.oldSnapshots) test(`authentic59 persisted ${fixture.name} keeps its historical display through load and export`, () => {
  const saved = clone(fixture.snapshot), before = JSON.stringify(saved);
  assert.equal(saved.appVersion, baseline.source.appVersion);
  assert.equal(saved.buildId, baseline.source.buildId);
  assert.equal(saved.calculationOrder, undefined);
  assert.deepEqual(normalizeRateDecisionSnapshot(saved), saved);
  assert.deepEqual(reconstructRateDisplayFromSnapshot(saved), saved.display);
  const state = persistedState(saved);
  assert.deepEqual(normalizeLoadedState(clone(state), state.sessionDraft).areaProgressMap[AREA].rateDecisionSnapshot, saved);
  for (const propagated of dailyAndExports(saved)) assert.deepEqual(propagated, saved);
  assert.equal(JSON.stringify(saved), before, "normalization/export must not rewrite persisted fixture");
  if (fixture.name === "normal-negative5-global5") {
    assert.equal(saved.displayedNormalRatePercent, 5);
    assert.equal(buildRateDecisionSnapshot(fixture.params).displayedNormalRatePercent, 0);
  }
});

test("new signed snapshot keeps schema3, discriminator, raw values and display through load/daily/day/all-data export", () => {
  const snapshot = buildRateDecisionSnapshot(input("15", "normal", "summer", -5, { areaJudge: "normal", areaRateAdjustment: 0 }, 5));
  const state = persistedState(snapshot);
  const restored = normalizeLoadedState(clone(state), state.sessionDraft).areaProgressMap[AREA].rateDecisionSnapshot;
  assert.deepEqual(restored, snapshot);
  for (const propagated of dailyAndExports(snapshot)) {
    assert.deepEqual(propagated, snapshot);
    assert.equal(propagated?.dataSchemaVersion, 3);
    assert.equal(propagated?.normalRateBeforeGlobalAdjustmentPercent, -5);
    assert.equal(propagated?.display?.normal.main, "0%");
  }
});

test("strict normalizer rejects altered discriminator, incomplete signed metadata and contradictory rates", () => {
  const snapshot = buildRateDecisionSnapshot(input("15", "normal", "normal", -5, { areaJudge: "normal", areaRateAdjustment: 0 }, 5));
  for (const mutate of [
    (s: Record<string, unknown>) => { s.calculationOrder = "unsupported_order"; },
    (s: Record<string, unknown>) => { delete s.calculationOrder; },
    (s: Record<string, unknown>) => { delete s.normalRateBeforeGlobalAdjustmentPercent; },
    (s: Record<string, unknown>) => { delete s.manyRateBeforeGlobalAdjustmentPercent; },
    (s: Record<string, unknown>) => { s.normalRateBeforeGlobalAdjustmentPercent = 0; },
    (s: Record<string, unknown>) => { s.manyRateBeforeGlobalAdjustmentPercent = 0; },
    (s: Record<string, unknown>) => { s.displayedRatePercent = 5; },
    (s: Record<string, unknown>) => { s.displayedNormalRatePercent = 5; },
    (s: Record<string, unknown>) => { s.displayedManyRatePercent = 5; },
    (s: Record<string, unknown>) => { s.globalDiscountAdjustmentPercent = 6; },
  ]) {
    const tampered = clone(snapshot) as unknown as Record<string, unknown>; mutate(tampered);
    assert.equal(normalizeRateDecisionSnapshot(tampered), undefined);
  }
  const mislabelledOld = clone(baseline.oldSnapshots[0].snapshot) as unknown as Record<string, unknown>;
  mislabelledOld.calculationOrder = "global_before_lower_limit_v1";
  assert.equal(normalizeRateDecisionSnapshot(mislabelledOld), undefined);
});

test("advance and cold deli guides equal original59 across dates/cycles/times/globals/weather/fixed mode", () => {
  const hash = createHash("sha256");
  for (const date of ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-20", "2026-09-21"])
    for (const cycle of ["normal", "summer"] as const)
      for (const time of ["15", "17", "18", "19", "20"] as const)
        for (const global of [-5, 0, 5] as const)
          for (const bonus of [-15, -10, -5, 0, 5, 10, 20])
            for (const fixed of [false, true]) {
              const guideSession = { date, weekday: new Date(date + "T12:00:00+09:00").getUTCDay(),
                discountTime: time, demandCycle: cycle, globalDiscountAdjustmentPercent: global };
              const params = { session: guideSession, resolvedWeather: { ...resolvedWeather, precipitationRateBonus: bonus }, isFixedTimeMode: fixed };
              hash.update(JSON.stringify([getAdvanceDiscountRate(params), getColdDeliGuide(params)]) + "\n"); guideComparisons++;
            }
  assert.equal(guideComparisons, baseline.unchangedGuides.count);
  assert.equal(hash.digest("hex"), baseline.unchangedGuides.sha256);
});

console.log(`Global negative60 checks passed: ${passed}/${passed}; ${snapshotComparisons} original59 snapshots, ${numericComparisons} signed calculations, ${guideComparisons} advance/cold comparisons`);
