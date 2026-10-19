import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  ALL_AREA_IDS, getAreaName, getAreaMasters, getAreaRouteFromStoredIds,
  getDoneSummaryRoute, getExpectedAreaIdsForStoredRecord, getNextNormalArea,
  getNormalRoute, getOperationalAreaRoute, isAreaActiveForCurrentWork,
  isAutumnSeason, isKnownAreaId,
} from "../src/domain/area.ts";
import {
  buildReview19DataQuality, buildReview19ExportPayload, createInitialReview19Result,
  getReview19AreaItems, normalizeReview19Result,
} from "../src/domain/review19.ts";
import { createReview19HumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import { buildAutomaticDayExportPayload } from "../src/domain/dayExport.ts";
import { normalizeReview19DaySnapshotDemandCycle } from "../src/domain/finalizedDayData.ts";
import { buildRemoteReview19Row } from "../src/domain/review19RemoteStorage.ts";
import { buildRemoteAreaCountRow, normalizeRemoteAreaCountRows } from "../src/domain/areaCountRemoteStorage.ts";
import { collectAreaCountBackfillRecords } from "../src/domain/areaCountBackfill.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { buildNormalRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { loadDailySessionSnapshots, saveDailySessionSnapshots, upsertDailySessionSnapshotSafely } from "../src/domain/storage.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { createReview19StartState } from "../src/hooks/nebikiApp/review19Flow.ts";
import {
  createDailySessionSnapshot, createReview19DaySnapshot, selectLatestReview19DayCheck,
  createReview19Snapshot,
} from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { finalizeUnmeasuredAreasForAutoTransition } from "../src/hooks/nebikiApp/timeTransitions.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import type { AreaCountRecord } from "../src/domain/areaCountHistory.ts";
import type { AppState, AreaId, Review19AreaEvaluation, Review19Result, SessionDraft } from "../src/domain/types.ts";

const results: Array<{ name: string; pass: true }> = [];
function test(name: string, run: () => void) {
  run();
  results.push({ name, pass: true });
  console.log(`PASS: ${name}`);
}
const oct = "2026-10-19";
const activeIds = getNormalRoute(oct);
const historicalIds = getAreaRouteFromStoredIds(oct, [...activeIds, "autumn"]);

function stateAt(date = oct): AppState {
  const draft: SessionDraft = {
    date, weekday: new Date(`${date}T00:00:00`).getDay(), discountTime: "17",
    demandCycle: "normal", manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
  const state = createInitialState(draft);
  return { ...state, screen: "area_judge", currentAreaId: "tempura", session: {
    ...draft, startedAt: `${date}T17:00:00+09:00`, appVersion: "2026.8.9-54", dataSchemaVersion: 3,
  } };
}

function snapshotOf(state: AppState) {
  const session = state.session!;
  const resolvedWeather = resolveWeatherInputForDiscount(session.weather, session.discountTime);
  return createDailySessionSnapshot({
    state, capturedAt: `${session.date}T18:55:00+09:00`, resolvedWeather,
    weekdayBaseInfo: getWeekdayBaseInfo(session.weekday, session.discountTime, resolvedWeather, session.date),
    basisGuide: getBasisGuideDisplay({ ...session, weather: resolvedWeather }),
    lateTimeBonus: 0, doneSummaryItems: [], sessionEndReason: "auto_time_transition",
  })!;
}

function completeReview(ids: AreaId[], date = oct): Review19Result {
  const initial = createInitialReview19Result({ date, sessionStartedAt: `${date}T17:00:00+09:00`, expectedAreaIds: ids });
  const areaCounts = Object.fromEntries(ids.map((id) => [id, 7]));
  const areaEvaluations = Object.fromEntries(ids.map((id) => [id, {
    humanEvaluation: "few", humanEvaluationDetails: createReview19HumanEvaluationDetails({
      selection: { humanEvaluationScore9: 1, humanEvaluationSelections: ["few"] },
      demandCycle: "normal", evaluatedAt: `${date}T19:01:00+09:00`,
    }),
  }])) as Partial<Record<AreaId, Review19AreaEvaluation>>;
  return { ...initial, recordedAt: `${date}T19:01:00+09:00`, areaCounts, areaEvaluations,
    dataQuality: buildReview19DataQuality({ date, expectedAreaIds: ids, areaCounts, areaEvaluations, excludedAreaIds: [] }) };
}

function record(areaId: AreaId, time: "15" | "17" = "17"): AreaCountRecord {
  return {
    dataSchemaVersion: 3, appVersion: "2026.8.9-54", date: oct,
    sessionStartedAt: `${oct}T${time}:00:00+09:00`, recordedAt: `${oct}T${time}:05:00+09:00`,
    discountTime: time, areaId, actualWeekday: "月", actualWeekdayGroup: "月水", count: 7,
    demandCycle: "normal", userJudge: "few", suggestedEvaluation: "few", evaluationSource: "manual",
  };
}

function legacySource(done = false): AppState {
  const state = stateAt();
  state.screen = done ? "done" : "area_judge";
  state.normalFlowOrder = historicalIds;
  state.areaProgressMap.autumn = {
    areaId: "autumn", status: "completed", areaJudge: "normal", areaCount: 17,
    areaCountEvaluation: "slightly_many", areaCountEvaluationSource: "manual",
    areaRateAdjustment: 5, visitedAt: `${oct}T17:04:00+09:00`, completedAt: `${oct}T17:05:00+09:00`,
    rateDecisionSnapshot: buildNormalRateDecisionSnapshot({
      confirmedAt: `${oct}T17:05:00+09:00`, sessionDiscountTime: "17", areaJudge: "normal",
      weatherComfortAdjustmentPercent: 0, areaRateAdjustment: 5, weekday: 1, date: oct,
      resolvedWeather: resolveWeatherInputForDiscount(state.session!.weather, "17"),
    }),
  };
  return state;
}

test("one temporary exclusion keeps autumn identity and the seasonal calendar", () => {
  assert.equal(isAreaActiveForCurrentWork("autumn"), false);
  assert.equal(isAreaActiveForCurrentWork("ryomi"), true);
  assert.equal(isKnownAreaId("autumn"), true);
  assert.ok(ALL_AREA_IDS.includes("autumn"));
  assert.equal(getAreaName("autumn"), "秋商品");
  assert.equal(isAutumnSeason(oct), true);
  assert.equal(isAutumnSeason("2027-10-19"), true);
});

for (const [date, seasonal, count] of [
  ["2026-05-31", undefined, 11], ["2026-06-01", "ryomi", 12],
  ["2026-09-30", "ryomi", 12], ["2026-10-01", undefined, 11],
  ["2026-11-30", undefined, 11], ["2026-12-01", undefined, 11],
  ["2027-10-01", undefined, 11],
] as const) {
  test(`${date}: work/master/Done preserve order and the summer rule`, () => {
    const ids = getNormalRoute(date);
    assert.equal(ids.length, count);
    assert.deepEqual(ids.filter((id) => id === "autumn" || id === "ryomi"), seasonal ? [seasonal] : []);
    assert.equal(getNextNormalArea("tempura", date), seasonal ?? "croquette");
    assert.deepEqual(getAreaMasters(date).map((area) => area.id), ids);
    assert.deepEqual(getDoneSummaryRoute(date), ids.toReversed());
    assert.deepEqual(Object.keys(stateAt(date).areaProgressMap), ids);
  });
}

test("historical and operational saved routes have separate, immutable boundaries", () => {
  const input = [...historicalIds];
  assert.equal(historicalIds.length, 12);
  assert.deepEqual(getAreaRouteFromStoredIds(oct, historicalIds), historicalIds);
  assert.deepEqual(getOperationalAreaRoute(oct, historicalIds), activeIds);
  assert.deepEqual(input, historicalIds);
  assert.deepEqual(getExpectedAreaIdsForStoredRecord(oct, { expectedAreaIds: historicalIds }), historicalIds);
});

test("new October Review19 completes eleven real observations without autumn payload or missingness", () => {
  const review = normalizeReview19Result(completeReview(activeIds))!;
  assert.equal(review.dataQuality.expectedAreaCount, 11);
  assert.equal(review.dataQuality.recordedAreaCount, 11);
  assert.equal(review.dataQuality.complete, true);
  assert.deepEqual(review.dataQuality.missingAreaIds, []);
  assert.deepEqual(review.dataQuality.missingHumanEvaluationAreaIds, []);
  assert.equal(review.areaCounts.autumn, undefined);
  assert.equal(review.areaEvaluations?.autumn, undefined);
  assert.equal(review.productionAnalysis?.areas.autumn, undefined);
  assert.deepEqual(getReview19AreaItems(oct, review.expectedAreaIds).map((item) => item.areaId), activeIds);
  assert.equal(buildReview19ExportPayload({ records: [review], exportedAt: `${oct}T19:05:00+09:00` }).records[0].dataQuality.expectedAreaCount, 11);
});

test("saved twelve-area and pre-autumn eleven-area reviews retain their own quality and originals", () => {
  for (const explicit of [true, false]) {
    const old = completeReview(historicalIds); old.appVersion = "2026.8.9-54";
    if (!explicit) delete old.expectedAreaIds;
    const original = JSON.stringify(old);
    const normalized = normalizeReview19Result(old)!;
    assert.equal(normalized.dataQuality.expectedAreaCount, 12);
    assert.equal(normalized.dataQuality.complete, true);
    assert.equal(normalized.areaCounts.autumn, 7);
    assert.equal(normalized.areaEvaluations?.autumn?.humanEvaluationDetails?.humanEvaluationScore9, 1);
    assert.equal(buildRemoteReview19Row(normalized).payload.areaCounts.autumn, 7);
    assert.equal(JSON.stringify(old), original);
  }
  const preAutumn = completeReview(activeIds); preAutumn.appVersion = "2026.8.9-36"; delete preAutumn.expectedAreaIds;
  const before = JSON.stringify(preAutumn);
  const normalized = normalizeReview19Result(preAutumn)!;
  assert.equal(normalized.dataQuality.expectedAreaCount, 11);
  assert.equal(normalized.dataQuality.complete, true);
  assert.equal(normalized.areaCounts.autumn, undefined);
  assert.equal(JSON.stringify(preAutumn), before);
});

test("historical twelve-area incompleteness remains historical and is never regraded as eleven", () => {
  const old = completeReview(historicalIds);
  delete old.areaCounts.autumn;
  delete old.areaEvaluations!.autumn;
  old.dataQuality = buildReview19DataQuality({ date: oct, expectedAreaIds: historicalIds,
    areaCounts: old.areaCounts, areaEvaluations: old.areaEvaluations!, excludedAreaIds: [] });
  for (const explicit of [true, false]) {
    const fixture = JSON.parse(JSON.stringify(old)) as Review19Result;
    if (!explicit) delete fixture.expectedAreaIds;
    const before = JSON.stringify(fixture);
    const normalized = normalizeReview19Result(fixture)!;
    assert.equal(normalized.dataQuality.expectedAreaCount, 12);
    assert.equal(normalized.dataQuality.complete, false);
    assert.deepEqual(normalized.dataQuality.missingAreaIds, ["autumn"]);
    assert.deepEqual(normalized.dataQuality.missingHumanEvaluationAreaIds, ["autumn"]);
    assert.equal(JSON.stringify(fixture), before);
  }
});

test("old seventeen-hour source creates eleven-area Review19 and retains its adopted autumn evidence", () => {
  const source = legacySource(); source.review19ExcludedAreaIds = ["autumn"];
  source.priorityReturnContext = {
    sessionDate: oct, sessionStartedAt: source.session!.startedAt, sessionDiscountTime: "17", normalResumeAreaId: "onigiri",
  };
  const before = JSON.stringify(source);
  const next = createReview19StartState({ currentState: stateAt(), sourceState: source,
    now: new Date(`${oct}T18:55:00+09:00`), snapshots: [], lastSessionWeather: null });
  assert.deepEqual(next.review19!.expectedAreaIds, activeIds);
  assert.equal(next.review19!.dataQuality.expectedAreaCount, 11);
  assert.equal(next.review19!.dataQuality.missingAreaIds.includes("autumn"), false);
  assert.equal(next.review19!.excludedAreaIds.includes("autumn"), false);
  assert.equal(next.priorityReturnContext, undefined);
  assert.deepEqual(next.areaProgressMap.autumn, source.areaProgressMap.autumn);
  assert.equal(JSON.stringify(source), before);
});

test("same-completion journal writes preserve the saved denominator and legacy field absence", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const memoryStorage = {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, String(value)); },
    removeItem(key: string) { values.delete(key); },
    clear() { values.clear(); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage });
  try {
    for (const previousExpected of [undefined, activeIds, historicalIds]) {
      const source = legacySource(true);
      const previous = snapshotOf(source);
      if (previousExpected) previous.expectedAreaIds = [...previousExpected];
      else delete previous.expectedAreaIds;
      const originalAreas = JSON.parse(JSON.stringify(previous.areas));
      saveDailySessionSnapshots([previous]);
      const candidate = snapshotOf(source);
      candidate.capturedAt = `${oct}T19:15:00+09:00`;
      const result = upsertDailySessionSnapshotSafely(candidate, { protectedDate: oct });
      assert.equal(result.ok, true);
      const stored = loadDailySessionSnapshots()[0];
      assert.deepEqual(stored.expectedAreaIds, previousExpected);
      assert.deepEqual(stored.areas, originalAreas);
      assert.equal(stored.capturedAt, previous.capturedAt);
      if (!previousExpected) assert.equal(Object.hasOwn(stored, "expectedAreaIds"), false);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("new snapshots mark their active denominator and retain original autumn observation and rates", () => {
  const source = legacySource(); source.normalFlowOrder = activeIds;
  const original = JSON.stringify(source);
  const snapshot = snapshotOf(source);
  assert.deepEqual(snapshot.expectedAreaIds, activeIds);
  assert.equal(Object.keys(snapshot.areas).length, 12);
  assert.equal(snapshot.areas.autumn.areaCount, 17);
  assert.equal(snapshot.areas.autumn.areaCountEvaluation, "slightly_many");
  assert.deepEqual(snapshot.areas.autumn.rateDecisionSnapshot, source.areaProgressMap.autumn.rateDecisionSnapshot);
  assert.deepEqual(getExpectedAreaIdsForStoredRecord(oct, { snapshot }), activeIds);
  assert.equal(JSON.stringify(source), original);
});

test("retained unobserved autumn does not become a current snapshot/export missing area or signal", () => {
  const source = legacySource(); source.normalFlowOrder = activeIds;
  source.areaProgressMap.autumn = { areaId: "autumn", status: "unstarted", areaJudge: null };
  const originalAutumn = JSON.parse(JSON.stringify(source.areaProgressMap.autumn));
  const finalized = finalizeUnmeasuredAreasForAutoTransition(source, `${oct}T18:55:00+09:00`);
  assert.deepEqual(finalized.areaProgressMap.autumn, originalAutumn);
  const snapshot = snapshotOf(source);
  const day = createReview19DaySnapshot({ capturedAt: `${oct}T19:05:00+09:00`, date: oct,
    sessions: [snapshot], areaCountRecords: activeIds.map((id) => record(id)) });
  assert.deepEqual(day.expectedAreaIds, activeIds);
  assert.equal(day.productionAnalysis?.areas.autumn, undefined);
  const coverage = buildAutomaticDayExportPayload({ date: oct, exportedAt: `${oct}T19:10:00+09:00`, daySnapshot: day })
    .dataQuality.coverageByDiscountTime.find((item) => item.discountTime === "17")!;
  assert.equal(coverage.expectedAreaCount, 11);
  assert.equal(coverage.recordedAreaCount, 11);
  assert.equal(coverage.measurementComplete, true);
  assert.equal(coverage.missingAreaIds.includes("autumn"), false);
  assert.equal(coverage.notMeasuredAreaIds.includes("autumn"), false);
  assert.equal(snapshot.areas.autumn, undefined);
  const session = source.session!;
  const resolvedWeather = resolveWeatherInputForDiscount(session.weather, session.discountTime);
  const reviewSource = createReview19Snapshot({
    capturedAt: `${oct}T19:01:00+09:00`, session, resolvedWeather,
    weekdayBaseInfo: getWeekdayBaseInfo(session.weekday, session.discountTime, resolvedWeather, session.date),
    basisGuide: getBasisGuideDisplay({ ...session, weather: resolvedWeather }), lateTimeBonus: 0,
    excludedAreaIds: [], areaProgressMap: source.areaProgressMap, doneSummaryItems: [],
  });
  assert.equal(reviewSource.areas.autumn, undefined);
  assert.deepEqual(source.areaProgressMap.autumn, originalAutumn);
});

test("completed old twelve-area source keeps its denominator beside a new eleven-area Review19", () => {
  const source = legacySource(true);
  for (const id of historicalIds) source.areaProgressMap[id] = { ...source.areaProgressMap[id], status: "completed", areaCount: 7 };
  const oldSnapshot = snapshotOf(source);
  assert.deepEqual(oldSnapshot.expectedAreaIds, historicalIds);
  const check = selectLatestReview19DayCheck([completeReview(activeIds)], oct)!;
  const day = createReview19DaySnapshot({ capturedAt: `${oct}T19:05:00+09:00`, date: oct,
    sessions: [oldSnapshot], areaCountRecords: historicalIds.map((id) => record(id)), review19Check: check });
  assert.deepEqual(day.expectedAreaIds, activeIds);
  const payload = buildAutomaticDayExportPayload({ date: oct, exportedAt: `${oct}T19:10:00+09:00`, daySnapshot: day });
  const coverage = payload.dataQuality.coverageByDiscountTime.find((item) => item.discountTime === "17")!;
  assert.equal(coverage.expectedAreaCount, 12);
  assert.equal(coverage.recordedAreaCount, 12);
  assert.equal(coverage.complete, true);
  assert.equal(coverage.processComplete, true);
  assert.equal(payload.daySnapshot.sessions[0].areas.autumn.areaCount, 7);
  assert.equal(payload.daySnapshot.areaCountRecords.find((item) => item.areaId === "autumn")!.count, 7);
  assert.equal(payload.daySnapshot.review19Check!.dataQuality.expectedAreaCount, 11);
  assert.equal(payload.daySnapshot.productionAnalysis?.areas.autumn, undefined);
});

test("stored autumn production analysis survives an active denominator change without rebuilding autumn", () => {
  const old = completeReview(historicalIds);
  const oldCheck = selectLatestReview19DayCheck([old], oct)!;
  const oldDay = createReview19DaySnapshot({ capturedAt: `${oct}T19:05:00+09:00`, date: oct,
    sessions: [], review19Check: oldCheck, areaCountRecords: historicalIds.flatMap((id) => [record(id, "15"), record(id, "17")]) });
  const storedAutumn = oldDay.productionAnalysis!.areas.autumn;
  assert.ok(storedAutumn);
  old.productionAnalysis = oldDay.productionAnalysis;
  const active = { ...old, expectedAreaIds: activeIds };
  const input = JSON.stringify(active);
  const normalized = normalizeReview19Result(active)!;
  assert.equal(normalized.dataQuality.expectedAreaCount, 11);
  assert.deepEqual(normalized.productionAnalysis!.areas.autumn, storedAutumn);
  assert.equal(normalized.areaCounts.autumn, 7);
  assert.equal(JSON.stringify(active), input);
  const activeCheck = selectLatestReview19DayCheck([normalized], oct)!;
  const newDay = createReview19DaySnapshot({ capturedAt: `${oct}T19:10:00+09:00`, date: oct,
    sessions: [], areaCountRecords: activeIds.map((id) => record(id)), review19Check: activeCheck });
  assert.deepEqual(newDay.productionAnalysis!.areas.autumn, storedAutumn);
  assert.deepEqual(normalizeReview19DaySnapshotDemandCycle(newDay).productionAnalysis!.areas.autumn, storedAutumn);
  const exported = buildAutomaticDayExportPayload({ date: oct, exportedAt: `${oct}T19:15:00+09:00`, daySnapshot: newDay });
  assert.deepEqual(exported.daySnapshot.productionAnalysis!.areas.autumn, storedAutumn);
  assert.equal(buildRemoteReview19Row(normalized).payload.productionAnalysis!.areas.autumn!.areaId, "autumn");
});

test("historical autumn AreaCount archive/backfill/cloud identity remains available", () => {
  const original = record("autumn");
  const bytes = JSON.stringify(original);
  const row = buildRemoteAreaCountRow(original);
  assert.equal(row.area_id, "autumn");
  assert.equal(normalizeRemoteAreaCountRows([row])[0].areaId, "autumn");
  assert.equal(collectAreaCountBackfillRecords({ unifiedCacheRecords: [original], nowMs: Date.parse(`${oct}T20:00:00+09:00`) })[0].areaId, "autumn");
  assert.equal(JSON.stringify(original), bytes);
});

if (process.env.NEBIKI_AUTUMN55_AUDIT_PATH) {
  writeFileSync(process.env.NEBIKI_AUTUMN55_AUDIT_PATH, JSON.stringify({
    scope: "disabled autumn seasonal domain and historical compatibility", total: results.length,
    passed: results.length, operationalOctoberCount: activeIds.length, historicalOctoberCount: historicalIds.length,
    checks: results,
  }, null, 2));
}
console.log(`Disabled autumn 55 checks passed: ${results.length}/${results.length}`);
