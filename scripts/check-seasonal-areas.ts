import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALL_AREA_IDS, LEGACY_AREA_MASTERS, getAreaMasters, getAreaName,
  getAreaOrder, getDoneSummaryRoute, getNormalRoute, getNextNormalArea,
  getExpectedAreaIdsForStoredRecord,
} from "../src/domain/area.ts";
import { getAreaCountRecommendation, normalizeAreaCountRecords } from "../src/domain/areaCountHistory.ts";
import type { AreaCountRecord } from "../src/domain/areaCountHistory.ts";
import { buildRemoteAreaCountRow, normalizeRemoteAreaCountRows } from "../src/domain/areaCountRemoteStorage.ts";
import { collectAreaCountBackfillRecords } from "../src/domain/areaCountBackfill.ts";
import { buildRemoteReview19Row } from "../src/domain/review19RemoteStorage.ts";
import { buildReview19DataQuality, createInitialReview19Result, normalizeReview19Result, getReview19AreaItems } from "../src/domain/review19.ts";
import { createReview19HumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { buildAutomaticDayExportPayload } from "../src/domain/dayExport.ts";
import { normalizeReview19DaySnapshotDemandCycle } from "../src/domain/finalizedDayData.ts";
import { cloneAppState } from "../src/domain/navigationHistory.ts";
import { getNextPendingCandidate } from "../src/domain/pending.ts";
import { createInitialState, normalizeLoadedState, isValidAreaId, normalizeNormalFlowOrder } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { createTimeSwitchPlan, finalizeUnmeasuredAreasForAutoTransition } from "../src/hooks/nebikiApp/timeTransitions.ts";
import { getNextNormalFlowAreaId } from "../src/hooks/nebikiApp/normalFlow.ts";
import { createReview19StartState } from "../src/hooks/nebikiApp/review19Flow.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot, buildFinalSessionDoneSummaryItems } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { DATA_SCHEMA_VERSION } from "../src/domain/dataVersion.ts";
import type { AppState, AreaId, Review19AreaEvaluation, Review19Result, SessionDraft } from "../src/domain/types.ts";

let passed = 0;
function test(name: string, run: () => void) {
  run(); passed += 1; console.log(`PASS: ${name}`);
}

function stateAt(date: string): AppState {
  const draft: SessionDraft = {
    date, weekday: new Date(`${date}T00:00:00`).getDay(), discountTime: "17",
    demandCycle: "normal", manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
  const state = createInitialState(draft);
  return { ...state, screen: "area_judge", session: { ...draft, startedAt: `${date}T17:00:00+09:00`, dataSchemaVersion: 3, appVersion: "2026.8.9-37" }, currentAreaId: "tempura" };
}

function dailySnapshot(state: AppState) {
  const session = state.session!;
  const resolvedWeather = resolveWeatherInputForDiscount(session.weather, session.discountTime);
  return createDailySessionSnapshot({
    state, capturedAt: `${session.date}T18:54:00+09:00`, resolvedWeather,
    weekdayBaseInfo: getWeekdayBaseInfo(session.weekday, session.discountTime, resolvedWeather, session.date),
    basisGuide: getBasisGuideDisplay({ ...session, weather: resolvedWeather }),
    lateTimeBonus: 0, doneSummaryItems: [], sessionEndReason: "auto_time_transition",
  })!;
}

for (const [date, seasonal] of [
  ["2026-05-31", null], ["2026-06-01", "ryomi"], ["2026-09-30", "ryomi"],
  ["2026-10-01", "autumn"], ["2026-11-30", "autumn"], ["2026-12-01", null],
  ["2027-01-01", null], ["2027-05-31", null], ["2027-06-01", "ryomi"],
] as const) {
  test(`${date}: route/master/Done has exactly the seasonal slot`, () => {
    const route = getNormalRoute(date);
    assert.deepEqual(route.filter((id) => id === "ryomi" || id === "autumn"), seasonal ? [seasonal] : []);
    assert.equal(route.length, seasonal ? 12 : 11);
    assert.deepEqual(route.slice(0, seasonal ? 4 : 3), seasonal ? ["bento_men", "tempura", seasonal, "croquette"] : ["bento_men", "tempura", "croquette"]);
    assert.deepEqual(getAreaMasters(date).map((area) => area.id), route);
    assert.deepEqual(getDoneSummaryRoute(date), [...route].reverse());
    assert.equal(getNextNormalArea("tempura", date), seasonal ?? "croquette");
  });
  test(`${date}: initial state, reload and Review19 expected route use the record date`, () => {
    const state = stateAt(date);
    assert.deepEqual(Object.keys(state.areaProgressMap), getNormalRoute(date));
    assert.deepEqual(normalizeLoadedState(state, state.sessionDraft).normalFlowOrder, state.normalFlowOrder);
    const review = createReview19StartState({ currentState: stateAt("2026-12-01"), sourceState: state, now: new Date(`${date}T18:55:00+09:00`), snapshots: [], lastSessionWeather: null });
    assert.deepEqual(review.review19?.expectedAreaIds, state.normalFlowOrder);
    assert.equal(review.review19?.dataQuality.expectedAreaCount, seasonal ? 12 : 11);
    assert.deepEqual(getReview19AreaItems(date, review.review19?.expectedAreaIds).map((area) => area.areaId), getNormalRoute(date));
    assert.deepEqual(Object.keys(dailySnapshot(state).areas).reverse(), getNormalRoute(date));
  });
}

test("master keeps ryomi identity, renames only current display and puts autumn in the same slot", () => {
  assert.equal(getAreaName("ryomi"), "夏商品"); assert.equal(getAreaName("autumn"), "秋商品");
  assert.equal(getAreaOrder("ryomi"), getAreaOrder("autumn"));
  assert.equal(LEGACY_AREA_MASTERS.filter((area) => area.id === "ryomi").length, 1);
  for (const id of ["ryomi", "autumn", "balance_bento"] as const) {
    assert.ok(ALL_AREA_IDS.includes(id)); assert.equal(isValidAreaId(id), true);
  }
});

const oct = "2026-10-01";
const legacyOctRoute = getNormalRoute(oct).filter((id) => id !== "autumn");
test("old October saved route/map and navigation remain eleven areas after reload", () => {
  const old = stateAt(oct); old.normalFlowOrder = legacyOctRoute; delete old.areaProgressMap.autumn;
  old.session!.appVersion = "2026.8.9-36";
  old.currentAreaId = "croquette"; old.pendingDeferredAreaIds = ["tempura"];
  const input = JSON.stringify(old);
  for (const restored of [normalizeLoadedState(old, old.sessionDraft), normalizeLoadedState(cloneAppState(old), old.sessionDraft)]) {
    assert.deepEqual(restored.normalFlowOrder, legacyOctRoute); assert.equal(restored.areaProgressMap.autumn, undefined);
    assert.equal(restored.currentAreaId, "croquette"); assert.deepEqual(restored.pendingDeferredAreaIds, ["tempura"]);
    assert.equal(Object.keys(dailySnapshot(restored).areas).length, 11);
    const review = createReview19StartState({ currentState: stateAt(oct), sourceState: restored, now: new Date(`${oct}T18:55:00+09:00`), snapshots: [], lastSessionWeather: null });
    assert.equal(review.review19!.dataQuality.expectedAreaCount, 11);
    assert.equal(review.review19!.dataQuality.missingAreaIds.includes("autumn"), false);
  }
  assert.equal(JSON.stringify(old), input);
  const withoutOrder = { ...old, normalFlowOrder: undefined };
  assert.deepEqual(normalizeLoadedState(withoutOrder, old.sessionDraft).normalFlowOrder, legacyOctRoute);
  assert.deepEqual(normalizeNormalFlowOrder(legacyOctRoute, oct), legacyOctRoute);
});

test("historical summer progress and skipped IDs survive loading outside the summer months", () => {
  const summer = stateAt("2026-09-30");
  summer.currentAreaId = "ryomi"; summer.pendingDeferredAreaIds = ["ryomi"];
  summer.areaProgressMap.ryomi.areaCount = 7; summer.review19ExcludedAreaIds = ["ryomi"];
  const loaded = normalizeLoadedState(summer, stateAt(oct).sessionDraft);
  assert.equal(loaded.currentAreaId, "ryomi"); assert.equal(loaded.areaProgressMap.ryomi.areaCount, 7);
  assert.deepEqual(loaded.review19ExcludedAreaIds, ["ryomi"]);
  assert.equal(loaded.areaProgressMap.autumn, undefined);
});

test("autumn stays in normal, pending, time transition and auto-skip flows", () => {
  const state = stateAt(oct);
  assert.equal(getNextNormalFlowAreaId(state.areaProgressMap, "tempura", state.normalFlowOrder), "autumn");
  state.areaProgressMap.autumn.status = "skipped_manual";
  assert.equal(getNextPendingCandidate({ areaProgressMap: state.areaProgressMap, referenceAreaId: "tempura", normalFlowOrder: state.normalFlowOrder })?.areaId, "autumn");
  const plan = createTimeSwitchPlan({ previousMap: state.areaProgressMap, date: oct, areaIds: state.normalFlowOrder, targetDiscountTime: "18", skippedRecords: [{ date: oct, targetDiscountTime: "18", areaId: "autumn", skipKind: "early_next_minus5" }] });
  assert.equal(plan.areaProgressMap.autumn.status, "auto_skipped_late_time"); assert.equal(plan.areaProgressMap.ryomi, undefined);
  assert.equal(finalizeUnmeasuredAreasForAutoTransition(state, `${oct}T18:55:00+09:00`).areaProgressMap.autumn.missingReason, "auto_time_transition");
});

test("unfinished priority during 15→17 changes navigation only; Review19, Done and snapshot retain canonical seasonal position", () => {
  const state = stateAt(oct);
  state.normalFlowOrder = ["hosomaki", ...getNormalRoute(oct).filter((id) => id !== "hosomaki")];
  const review = createReview19StartState({ currentState: state, sourceState: state, now: new Date(`${oct}T18:55:00+09:00`), snapshots: [], lastSessionWeather: null });
  assert.deepEqual(review.normalFlowOrder, state.normalFlowOrder);
  assert.deepEqual(review.review19!.expectedAreaIds, getNormalRoute(oct));
  assert.deepEqual(getReview19AreaItems(oct, state.normalFlowOrder).map((item) => item.areaId), getNormalRoute(oct));
  assert.deepEqual(Object.keys(dailySnapshot(state).areas), getDoneSummaryRoute(oct));
  assert.deepEqual(buildFinalSessionDoneSummaryItems({ session: state.session!, areaProgressMap: state.areaProgressMap, comfortScore: 0 }).map((item) => item.areaId), getDoneSummaryRoute(oct));
});

function completeReview(date: string, expectedAreaIds = getNormalRoute(date)): Review19Result {
  const initial = createInitialReview19Result({ date, expectedAreaIds, sessionStartedAt: `${date}T17:00:00+09:00` });
  const areaCounts = Object.fromEntries(expectedAreaIds.map((id) => [id, 6]));
  const areaEvaluations = Object.fromEntries(expectedAreaIds.map((id) => [id, {
    humanEvaluation: "normal", humanEvaluationDetails: createReview19HumanEvaluationDetails({
      selection: { humanEvaluationScore9: 5, humanEvaluationSelections: ["normal"] },
      demandCycle: "normal", evaluatedAt: `${date}T19:01:00+09:00`,
    }),
  }])) as Partial<Record<AreaId, Review19AreaEvaluation>>;
  return { ...initial, areaCounts, areaEvaluations, recordedAt: `${date}T19:01:00+09:00`, dataQuality: buildReview19DataQuality({ date, expectedAreaIds, areaCounts, areaEvaluations, excludedAreaIds: [] }) };
}

test("new October Review19 counts and exported/Supabase payload include autumn and raw human assessment", () => {
  const review = completeReview(oct);
  const normalized = normalizeReview19Result(review)!;
  assert.equal(normalized.dataQuality.expectedAreaCount, 12); assert.equal(normalized.dataQuality.complete, true);
  assert.equal(normalized.areaCounts.autumn, 6); assert.equal(normalized.areaCounts.ryomi, undefined);
  assert.equal(normalized.areaEvaluations?.autumn?.humanEvaluationDetails?.humanEvaluationScore9, 5);
  assert.equal(buildRemoteReview19Row(normalized).payload.areaCounts.autumn, 6);
  assert.equal(buildRemoteReview19Row(normalized).data_schema_version, 3);
});

test("legacy October Review19 derives eleven expected areas and never invents autumn missing data", () => {
  const old = completeReview(oct, legacyOctRoute); delete old.expectedAreaIds; old.appVersion = "2026.8.9-36";
  const input = JSON.stringify(old);
  const normalized = normalizeReview19Result(old)!;
  assert.equal(normalized.dataQuality.expectedAreaCount, 11); assert.equal(normalized.dataQuality.complete, true);
  assert.equal(normalized.dataQuality.missingAreaIds.includes("autumn"), false);
  assert.equal(normalized.productionAnalysis?.areas.autumn, undefined);
  assert.equal(JSON.stringify(old), input);
  assert.equal(getExpectedAreaIdsForStoredRecord(oct, { dataQuality: { expectedAreaCount: 11, missingAreaIds: ["tempura"] } }).length, 11);
});

test("saved old areaName is unchanged while new snapshots use 夏商品/秋商品", () => {
  const summer = stateAt("2026-09-30"); const snapshot = dailySnapshot(summer);
  assert.equal(snapshot.areas.ryomi.areaName, "夏商品");
  const old = completeReview("2026-09-30");
  old.snapshot = { version: 1, capturedAt: snapshot.capturedAt, session: snapshot.session, basis: snapshot.basis, areas: snapshot.areas };
  old.snapshot.areas.ryomi.areaName = "涼味商品";
  assert.equal(normalizeReview19Result(old)!.snapshot!.areas.ryomi.areaName, "涼味商品");
  assert.equal(dailySnapshot(stateAt(oct)).areas.autumn.areaName, "秋商品");
});

function countRecord(areaId: AreaId, date: string, count: number, demandCycle: "normal" | "summer" = "normal"): AreaCountRecord {
  return { dataSchemaVersion: 3, date, sessionStartedAt: `${date}T17:00:00+09:00`, recordedAt: `${date}T17:05:00+09:00`, discountTime: "17", areaId, actualWeekday: "木", actualWeekdayGroup: "火木日", count, demandCycle };
}
const summerRecords = ["2026-09-03", "2026-09-10", "2026-09-17"].map((date) => countRecord("ryomi", date, 100, "summer"));
const autumnRecords = ["2026-10-01", "2026-10-08", "2026-10-15"].map((date, i) => countRecord("autumn", date, 6 + i * 2, i % 2 ? "summer" : "normal"));
test("ryomi history cannot seed autumn; <3 autumn remains insufficient and 3 autumn uses only autumn", () => {
  const get = (records: AreaCountRecord[]) => getAreaCountRecommendation({ records, date: "2026-10-22", weekday: 4, areaId: "autumn", discountTime: "17", count: 8, demandCycle: "normal" });
  assert.equal(get(summerRecords).status, "insufficient");
  assert.equal(get([...summerRecords, ...autumnRecords.slice(0, 2)]).status, "insufficient");
  const ready = get([...summerRecords, ...autumnRecords]);
  assert.equal(ready.status, "ready"); assert.equal(ready.medianCount, 8);
  assert.ok(ready.matchedRecords.every((record) => record.areaId === "autumn"));
});

test("AreaCount normalization/backfill/Supabase preserve both area IDs and cycle metadata independently", () => {
  const records = [...summerRecords, ...autumnRecords];
  assert.equal(normalizeAreaCountRecords(records).length, 6);
  const backfill = collectAreaCountBackfillRecords({ unifiedCacheRecords: records, nowMs: Date.parse("2026-11-01T00:00:00+09:00") });
  assert.equal(backfill.filter((record) => record.areaId === "autumn").length, 3);
  for (const record of records) {
    const row = buildRemoteAreaCountRow(record); assert.equal(row.area_id, record.areaId); assert.equal(row.demand_cycle, record.demandCycle);
    assert.equal(normalizeRemoteAreaCountRows([row])[0].areaId, record.areaId);
  }
});

test("new and legacy day export/finalized analysis respect their saved areas without changing analysis definition", () => {
  for (const legacy of [false, true]) {
    const state = stateAt(oct);
    if (legacy) { state.normalFlowOrder = legacyOctRoute; delete state.areaProgressMap.autumn; }
    const session = dailySnapshot(state);
    const ids = state.normalFlowOrder!;
    const day = createReview19DaySnapshot({ capturedAt: `${oct}T20:30:00+09:00`, date: oct, sessions: [session], areaCountRecords: ids.map((id) => countRecord(id, oct, 4)) });
    const original = JSON.stringify(day);
    const finalized = normalizeReview19DaySnapshotDemandCycle(day);
    const payload = buildAutomaticDayExportPayload({ date: oct, exportedAt: `${oct}T20:31:00+09:00`, daySnapshot: finalized });
    assert.equal(payload.dataQuality.coverageByDiscountTime.find((item) => item.discountTime === "17")!.expectedAreaCount, legacy ? 11 : 12);
    assert.equal(Boolean(payload.daySnapshot.productionAnalysis?.areas.autumn), !legacy);
    assert.equal(payload.dataSchemaVersion, 3); assert.equal(JSON.stringify(day), original);
  }
});

test("SQL area_id is text without enumerated seasonal constraint and schema remains 3", () => {
  assert.equal(DATA_SCHEMA_VERSION, 3);
  const sql = readFileSync(new URL("../supabase_area_count_records.sql", import.meta.url), "utf8");
  assert.match(sql, /area_id\s+text/i);
  assert.doesNotMatch(sql, /check\s*\([^)]*area_id[^)]*\bin\s*\(/i);
});

console.log(`Seasonal area checks passed: ${passed}/${passed}`);
