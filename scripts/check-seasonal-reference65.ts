import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { ALL_AREA_IDS, getNormalRoute, getOperationalAreaRoute, getAreaRouteFromStoredIds, isAreaActiveForCurrentWork } from "../src/domain/area.ts";
import { buildAreaCountDecisionBasis, canSuppressAreaCountDecreaseAdjustment, evaluationToRateAdjustment, getActualWeekdayLabel, getAreaCountFallbackWeekdayGroup, getAreaCountRecommendation, isAreaCountDecreaseComparisonEligible, normalizeAreaCountDecisionBasis, normalizeAreaCountRecords, type AreaCountDecisionBasis, type AreaCountRecord } from "../src/domain/areaCountHistory.ts";
import { buildRemoteAreaCountRow, normalizeRemoteAreaCountRows } from "../src/domain/areaCountRemoteStorage.ts";
import { getAreaDecreaseDisplay } from "../src/domain/areaDecreaseDisplay.ts";
import { getAreaEvaluationQuickAdjustments } from "../src/domain/areaEvaluationAdjustment.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { buildAutomaticDayExportPayload } from "../src/domain/dayExport.ts";
import { initializeFinalizedDayDataInMemory } from "../src/domain/finalizedDayData.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { loadCurrentSession, loadWorkSessionCheckpoint, saveCurrentSession, saveWorkSessionCheckpoint } from "../src/domain/storage.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { buildCurrentNormalRatePresentation } from "../src/hooks/nebikiApp/ratePresentation.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot, createReview19Snapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import type { AreaCountEvaluation, AreaId, DemandCycle, DiscountTime } from "../src/domain/types.ts";
import type { AreaCountStatusPanel } from "../src/components/common/AreaCountStatusPanel.tsx";

// Execute the production domain, shared TSX panel and persistence/export builders.
// Eligibility for historical comparison is distinct from the current work route.
process.env.TZ = "Asia/Tokyo";
const SEASONALS = ["ryomi", "autumn"] as const;
const CYCLES = ["normal", "summer"] as const;
const ordinaryNine: AreaId[] = ["bento_men", "tempura", "yakitori", "chuka_fish", "onigiri", "sushi", "futomaki_chumaki", "inari", "hosomaki"];
const evaluations: AreaCountEvaluation[] = ["few", "slightly_few", "normal", "slightly_many", "many"];
const dates = { ryomi: { today: "2026-09-08", history: ["2026-08-18", "2026-08-25", "2026-09-01"] }, autumn: { today: "2026-11-10", history: ["2026-10-13", "2026-10-20", "2026-10-27"] } };
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const checks: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => checks.push({ name, run });
const results: Array<{ name: string; ok: boolean }> = [];
function saveSummary(passed: boolean, failure?: string) {
  writeFileSync(new URL("../../tests65-summary.json", import.meta.url), JSON.stringify({ passed, passedCases: results.length, totalCases: checks.length, evidence: "Actual production domain, shared AreaCountStatusPanel TSX SSR, storage/current/checkpoint/remote/snapshot/finalized/export builders. Browser operation is separate evidence.", ...(failure ? { failure } : {}), cases: results }, null, 2) + "\n");
}
function record(date: string, areaId: AreaId, time: DiscountTime, count: number, cycle: DemandCycle): AreaCountRecord {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { ...getCurrentDataVersionInfo(), date, areaId, discountTime: time, count, demandCycle: cycle, sessionStartedAt: `${date}T08:00:00.000Z`, recordedAt: `${date}T08:05:00.000Z`, actualWeekday: getActualWeekdayLabel(weekday), actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({ date, weekday, discountTime: time }) };
}
function history(areaId: typeof SEASONALS[number], cycle: DemandCycle, previous = 100, days = dates[areaId].history) {
  return [...days.flatMap(date => [record(date, areaId, "15", 100, cycle), record(date, areaId, "17", 50, cycle)]), record(dates[areaId].today, areaId, "15", previous, cycle)];
}
function recommend(areaId: typeof SEASONALS[number], cycle: DemandCycle, previous = 100, count = 50, rows = history(areaId, cycle, previous)) {
  return getAreaCountRecommendation({ records: rows, areaId, discountTime: "17", date: dates[areaId].today, weekday: 2, demandCycle: cycle, count });
}
function basis(areaId: typeof SEASONALS[number], cycle: DemandCycle, previous = 100, count = 50, manual?: AreaCountEvaluation) {
  const recommendation = recommend(areaId, cycle, previous, count);
  return buildAreaCountDecisionBasis({ recommendation, evaluationSource: manual ? "manual" : "history", finalEvaluation: manual ?? recommendation.suggestedEvaluation, areaRateAdjustment: manual ? evaluationToRateAdjustment(manual) : recommendation.areaRateAdjustment });
}
function stateFor(areaId: typeof SEASONALS[number], cycle: DemandCycle, saved = basis(areaId, cycle), count = 50) {
  const date = dates[areaId].today;
  const session = { ...getCurrentDataVersionInfo(), date, weekday: 2, discountTime: "17" as const, demandCycle: cycle, startedAt: `${date}T08:00:00.000Z`, manualWeekdayOverride: false, manualDiscountTimeOverride: false, weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null } };
  const state = createInitialState(session); state.session = session; state.screen = "rate_display"; state.currentAreaId = areaId === "autumn" ? "tempura" : areaId;
  // A saved autumn observation can exist outside the active route. Seed that
  // historical evidence without making autumn the current operational area.
  state.areaProgressMap[areaId] ??= { areaId, status: "unstarted", areaJudge: null };
  Object.assign(state.areaProgressMap[areaId], { areaCount: count, areaJudge: "normal", areaCountEvaluation: saved.finalEvaluation, areaCountEvaluationSource: saved.evaluationSource, areaRateAdjustment: saved.areaRateAdjustment, areaCountDecisionBasis: saved });
  return state;
}
function shown(areaId: typeof SEASONALS[number], cycle: DemandCycle, saved: AreaCountDecisionBasis) {
  const state = stateFor(areaId, cycle, saved);
  return buildCurrentNormalRatePresentation({ session: state.session, progress: state.areaProgressMap[areaId], effectiveDiscountTime: "17", weatherBonus: 0, ignoreTimeRateCap: false })!.display;
}
function assertReference(saved: AreaCountDecisionBasis | undefined) {
  assert.ok(saved); assert.equal(saved.decreaseAdjustment?.mode, "reference_only_v1"); assert.equal(saved.decreaseAdjustment?.applied, false);
  assert.equal(saved.decreaseAdjustment?.suppressed, undefined);
}

const panelUrl = new URL("../src/components/common/AreaCountStatusPanel.tsx", import.meta.url);
const panelDependencies = new Map<string, unknown>([["react/jsx-runtime", jsxRuntime], ["../../domain/areaCountHistory.ts", await import("../src/domain/areaCountHistory.ts")], ["../../domain/areaDecreaseDisplay.ts", await import("../src/domain/areaDecreaseDisplay.ts")]]);
const panelExports: Record<string, unknown> = {};
runInNewContext(ts.transpileModule(readFileSync(panelUrl, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports: panelExports, require: (id: string) => { assert.ok(panelDependencies.has(id)); return panelDependencies.get(id); } });
const Panel = panelExports.AreaCountStatusPanel as typeof AreaCountStatusPanel;
function panel(areaId: typeof SEASONALS[number], saved: AreaCountDecisionBasis, count = 50) {
  return renderToStaticMarkup(React.createElement(Panel, { areaCount: count, decreaseAdjustment: saved.decreaseAdjustment, decreaseDisplayContext: { areaId, discountTime: "17" } }));
}

test("comparison eligibility is the nine ordinary areas plus both existing seasonals, with three exclusions", () => {
  const targets = [...ordinaryNine, ...SEASONALS]; assert.equal(targets.length, 11);
  for (const areaId of ALL_AREA_IDS) assert.equal(isAreaCountDecreaseComparisonEligible({ areaId, discountTime: "17" }), targets.includes(areaId));
});
for (const areaId of SEASONALS) for (const cycle of CYCLES) {
  for (const [previous, direction, label] of [[200, "more_few", "良い"], [100, "none", "普通"], [60, "more_many", "悪い"]] as const) {
    test(`${areaId}/${cycle}/${label}: historical comparison stays reference-only in actual domain and SSR`, () => {
      const rows = history(areaId, cycle, previous), original = structuredClone(rows), rec = recommend(areaId, cycle, previous, 50, rows), saved = basis(areaId, cycle, previous);
      assert.equal(rec.status, "ready"); assert.equal(rec.decreaseRecommendation?.canUse, true); assert.equal(rec.decreaseRecommendation?.sampleSize, 3); assert.equal(rec.decreaseRecommendation?.medianDecreaseRate, 0.5); assert.equal(rec.decreaseRecommendation?.direction, direction);
      assert.equal(rec.baseEvaluation, "normal"); assert.equal(rec.suggestedEvaluation, "normal"); assert.equal(rec.areaRateAdjustment, 0); assertReference(saved);
      assert.equal(canSuppressAreaCountDecreaseAdjustment({ areaId, discountTime: "17", basis: saved }), false);
      const display = getAreaDecreaseDisplay({ areaId, discountTime: "17", areaCount: 50, decreaseAdjustment: saved.decreaseAdjustment })!;
      assert.equal(display.assessmentText, label); assert.equal(display.medianText, "履歴中央値：50.0％");
      const markup = panel(areaId, saved); assert.match(markup, new RegExp(`data-decrease-assessment="${label}"`));
      if (label !== "普通") assert.match(markup, new RegExp(`data-decrease-highlight="${label === "良い" ? "good" : "bad"}"`)); else assert.doesNotMatch(markup, /data-decrease-highlight/);
      assert.doesNotMatch(markup, /<button|補正を戻す|追加製造あり/); assert.deepEqual(rows, original);
    });
  }
  test(`${areaId}/${cycle}: good-normal-bad leave automatic, five manual and quick rates independent of reference`, () => {
    const saved = [200, 100, 60].map(previous => basis(areaId, cycle, previous));
    assert.deepEqual(shown(areaId, cycle, saved[0]), shown(areaId, cycle, saved[1])); assert.deepEqual(shown(areaId, cycle, saved[1]), shown(areaId, cycle, saved[2]));
    for (const manual of evaluations) {
      const displays = [200, 100, 60].map(previous => shown(areaId, cycle, basis(areaId, cycle, previous, 50, manual)));
      assert.deepEqual(displays[0], displays[1]); assert.deepEqual(displays[1], displays[2]);
    }
    for (const savedBasis of saved) {
      const state = stateFor(areaId, cycle, savedBasis), choices = getAreaEvaluationQuickAdjustments({ screen: "rate_display", discountTime: "17", isTestMode: false, now: new Date(`${dates[areaId].today}T08:10:00Z`), progress: state.areaProgressMap[areaId] });
      assert.deepEqual(choices.map(x => [x.originalEvaluation, x.direction, x.finalEvaluation]), [["normal", "higher", "slightly_many"], ["normal", "lower", "slightly_few"]]);
    }
  });
  test(`${areaId}/${cycle}: three valid paired days are required and history is capped at sixteen`, () => {
    const short = recommend(areaId, cycle, 100, 50, history(areaId, cycle, 100, dates[areaId].history.slice(0, 2)));
    assert.equal(short.decreaseRecommendation?.canUse, false); assert.equal(short.decreaseRecommendation?.sampleSize, 2);
    const today = new Date(`${dates[areaId].today}T00:00:00Z`), days = Array.from({ length: 22 }, (_, index) => new Date(today.getTime() - (22 - index) * 7 * 86400000).toISOString().slice(0, 10));
    const rows = history(areaId, cycle, 100, days), firstInvalid = rows.find(row => row.date === days[0] && row.discountTime === "15")!; firstInvalid.count = 0;
    const rec = recommend(areaId, cycle, 100, 50, rows); assert.equal(rec.decreaseRecommendation?.canUse, true); assert.equal(rec.decreaseRecommendation?.sampleSize, 16); assert.equal(rec.decreaseRecommendation?.medianDecreaseRate, 0.5);
    const missing = history(areaId, cycle).filter(row => !(row.date === dates[areaId].history[0] && row.discountTime === "15"));
    const incomplete = recommend(areaId, cycle, 100, 50, missing); assert.equal(incomplete.decreaseRecommendation?.sampleSize, 2); assert.equal(incomplete.decreaseRecommendation?.canUse, false);
  });
  test(`${areaId}/${cycle}: missing or zero15 never fabricates a comparison and current0 remains valid`, () => {
    for (const previous of [undefined, 0]) {
      const rows = history(areaId, cycle).filter(row => row.date !== dates[areaId].today); if (previous !== undefined) rows.push(record(dates[areaId].today, areaId, "15", previous, cycle));
      const rec = recommend(areaId, cycle, 100, 50, rows), saved = buildAreaCountDecisionBasis({ recommendation: rec }); assertReference(saved); assert.equal(rec.decreaseRecommendation?.canUse, false);
      const d = getAreaDecreaseDisplay({ areaId, discountTime: "17", areaCount: 50, decreaseAdjustment: saved.decreaseAdjustment })!;
      assert.equal(d.rateText, "算出不可"); assert.ok(!["良い", "普通", "悪い"].includes(d.assessmentText)); assert.doesNotMatch(panel(areaId, saved), /data-decrease-highlight/);
    }
    const rec = recommend(areaId, cycle, 100, 0), saved = buildAreaCountDecisionBasis({ recommendation: rec });
    assert.equal(getAreaDecreaseDisplay({ areaId, discountTime: "17", areaCount: 0, decreaseAdjustment: saved.decreaseAdjustment })?.rateText, "100.0％"); assert.equal(rec.suggestedEvaluation, rec.baseEvaluation);
  });
  test(`${areaId}/${cycle}: reference evidence survives current/checkpoint, remote, snapshots, finalized and export`, () => {
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), key: (index: number) => [...values.keys()][index] ?? null, get length() { return values.size; } } });
    try {
      const saved = basis(areaId, cycle, 60), state = stateFor(areaId, cycle, saved), date = dates[areaId].today, capturedAt = `${date}T08:10:00.000Z`, resolvedWeather = resolveWeatherInputForDiscount(state.session!.weather, "17");
      saveCurrentSession(state); saveWorkSessionCheckpoint(state);
      for (const raw of [loadCurrentSession(), loadWorkSessionCheckpoint()]) { assert.ok(raw); assert.deepEqual(normalizeLoadedState(raw).areaProgressMap[areaId].areaCountDecisionBasis?.decreaseAdjustment, saved.decreaseAdjustment); }
      const row = { ...record(date, areaId, "17", 50, cycle), decisionBasis: saved, suggestedEvaluation: saved.finalEvaluation, areaRateAdjustment: saved.areaRateAdjustment };
      for (const recovered of [normalizeAreaCountRecords([row])[0], normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(row)])[0]]) { assert.equal(recovered.areaId, areaId); assert.equal(recovered.demandCycle, cycle); assert.deepEqual(recovered.decisionBasis?.decreaseAdjustment, saved.decreaseAdjustment); }
      state.screen = "done";
      const inputs = { capturedAt, resolvedWeather, lateTimeBonus: 0, doneSummaryItems: [], weekdayBaseInfo: getWeekdayBaseInfo(2, "17", resolvedWeather, date), basisGuide: getBasisGuideDisplay({ date, weekday: 2, discountTime: "17", demandCycle: cycle, weather: resolvedWeather }) };
      const daily = createDailySessionSnapshot({ ...inputs, state })!, review = createReview19Snapshot({ ...inputs, session: state.session!, areaProgressMap: state.areaProgressMap, excludedAreaIds: [] });
      const day = createReview19DaySnapshot({ date, capturedAt, demandCycle: cycle, sessions: [daily], areaCountRecords: [row] }), finalized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot: day, finalizedAt: capturedAt }).record, exported = buildAutomaticDayExportPayload({ date, exportedAt: capturedAt, daySnapshot: day });
      for (const evidence of [daily.areas[areaId].areaCountDecisionBasis, review.areas[areaId].areaCountDecisionBasis, finalized.sessions[0].areas[areaId].areaCountDecisionBasis, finalized.areaCountRecords[0].decisionBasis, exported.daySnapshot.sessions[0].areas[areaId].areaCountDecisionBasis, exported.daySnapshot.areaCountRecords[0].decisionBasis]) { assertReference(evidence); assert.deepEqual(evidence?.decreaseAdjustment, saved.decreaseAdjustment); assert.equal(evidence?.finalEvaluation, "normal"); assert.equal(evidence?.areaRateAdjustment, 0); }
      assert.equal(exported.dataSchemaVersion, 3); if (areaId === "autumn") assert.equal(daily.expectedAreaIds?.includes("autumn"), false);
    } finally { if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage); else Reflect.deleteProperty(globalThis, "localStorage"); }
  });
}
for (const areaId of SEASONALS) {
  test(`${areaId}: other seasonal histories cannot complete missing pairs or change its median`, () => {
    const other = areaId === "ryomi" ? "autumn" : "ryomi", own = history(areaId, "normal"), opposite = own.filter(row => row.date !== dates[areaId].today).map(row => ({ ...row, areaId: other as AreaId, count: row.discountTime === "17" ? 1 : 1000 }));
    const rec = recommend(areaId, "normal", 100, 50, [...own, ...opposite]); assert.equal(rec.decreaseRecommendation?.sampleSize, 3); assert.equal(rec.decreaseRecommendation?.medianDecreaseRate, 0.5);
    const incomplete = own.filter(row => !(row.discountTime === "15" && row.date === dates[areaId].history[0])); assert.equal(recommend(areaId, "normal", 100, 50, [...incomplete, ...opposite]).decreaseRecommendation?.canUse, false);
  });
  test(`${areaId}: increased count keeps signed rate and separate bad badge`, () => {
    const saved = basis(areaId, "normal", 100, 150), display = getAreaDecreaseDisplay({ areaId, discountTime: "17", areaCount: 150, decreaseAdjustment: saved.decreaseAdjustment })!;
    assert.equal(display.rateText, "−50.0％"); assert.equal(display.isIncrease, true); assert.equal(display.assessmentText, "悪い");
    const markup = panel(areaId, saved, 150); assert.match(markup, /−50.0％（増加）/); assert.match(markup, /data-decrease-highlight="bad"/);
  });
  test(`${areaId}: absent-mode legacy adoption and suppression metadata remain unchanged`, () => {
    const legacy = basis(areaId, "normal", 60); delete legacy.decreaseAdjustment!.mode; delete legacy.decreaseAdjustment!.applied;
    legacy.decreaseAdjustment!.suppressed = true; legacy.decreaseAdjustment!.suppressionReason = "additional_production"; legacy.finalEvaluation = "slightly_many"; legacy.areaRateAdjustment = 5;
    const before = structuredClone(legacy), normalized = normalizeAreaCountDecisionBasis(legacy)!;
    assert.equal(normalized.finalEvaluation, "slightly_many"); assert.equal(normalized.areaRateAdjustment, 5); assert.equal(normalized.decreaseAdjustment?.mode, undefined); assert.equal(normalized.decreaseAdjustment?.suppressed, true); assert.deepEqual(legacy, before);
    assert.match(panel(areaId, normalized), /過去の保存時の減少率補正：取り消し済み/);
  });
  test(`${areaId}: a saved64 reference without comparative history stays unavailable until explicit new judgment`, () => {
    const saved64 = basis(areaId, "normal", 60);
    Object.assign(saved64.decreaseAdjustment!, { canUse: false, sampleSize: 0, direction: "none" }); delete saved64.decreaseAdjustment!.medianDecreaseRate;
    const before = json(saved64), normalized = normalizeAreaCountDecisionBasis(saved64)!;
    assert.deepEqual(json(normalized), before); assert.equal(normalized.finalEvaluation, "normal"); assert.equal(normalized.areaRateAdjustment, 0);
    const markup = panel(areaId, normalized); assert.match(markup, /履歴不足/); assert.doesNotMatch(markup, /data-decrease-highlight|50.0％/);
    const row = { ...record(dates[areaId].today, areaId, "17", 50, "normal"), decisionBasis: normalized };
    assert.deepEqual(json(normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(row)])[0].decisionBasis), before);
    const fresh = basis(areaId, "normal", 60); assert.equal(fresh.decreaseAdjustment?.canUse, true); assert.equal(fresh.decreaseAdjustment?.medianDecreaseRate, 0.5); assert.equal(fresh.finalEvaluation, normalized.finalEvaluation); assert.equal(fresh.areaRateAdjustment, normalized.areaRateAdjustment);
    assert.deepEqual(json(saved64), before);
  });
}
test("autumn comparison never reactivates autumn work and summer calendar remains unchanged", () => {
  assert.equal(isAreaCountDecreaseComparisonEligible({ areaId: "autumn", discountTime: "17" }), true); assert.equal(isAreaActiveForCurrentWork("autumn"), false);
  for (let month = 1; month <= 12; month++) {
    const date = `2026-${String(month).padStart(2, "0")}-15`, route = getNormalRoute(date);
    assert.equal(route.includes("autumn"), false); assert.equal(route.includes("ryomi"), month >= 6 && month <= 9); assert.equal(route.length, month >= 6 && month <= 9 ? 12 : 11);
    const savedRoute = getAreaRouteFromStoredIds(date, [...route, "autumn"]); assert.equal(savedRoute.includes("autumn"), true); assert.equal(getOperationalAreaRoute(date, savedRoute).includes("autumn"), false);
  }
});

for (const item of checks) {
  try { item.run(); results.push({ name: item.name, ok: true }); console.log(`PASS ${String(results.length).padStart(2, "0")}: ${item.name}`); }
  catch (error) { saveSummary(false, `${item.name}: ${String(error)}`); throw error; }
}
saveSummary(true);
console.log(`Seasonal reference65 checks passed: ${results.length}/${checks.length}`);
