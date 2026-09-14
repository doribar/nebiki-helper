import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { AdvanceDiscountScreen } from "../src/components/screens/AdvanceDiscountScreen.tsx";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";
import { getAdvanceDiscountRate } from "../src/domain/advanceDiscount.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { normalizeDemandCycle } from "../src/domain/demandCycle.ts";
import { normalizeFinalizedDayData, initializeFinalizedDayDataInMemory } from "../src/domain/finalizedDayData.ts";
import { normalizeGlobalDiscountAdjustmentPercent } from "../src/domain/globalDiscountAdjustment.ts";
import { mergeDailySessionSnapshotArchiveOperations } from "../src/domain/historicalArchive.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import {
  buildRateDecisionSnapshot, buildNormalRateDecisionSnapshot,
  normalizeRateDecisionSnapshot, reconstructRateDisplayFromSnapshot,
} from "../src/domain/rateDecisionSnapshot.ts";
import { buildAllFinalizedDayDataExportPayload, buildDirectFinalizedDayDataExportPayload } from "../src/domain/separateDataExport.ts";
import { loadCurrentSession, saveCurrentSession, loadDailySessionSnapshots, saveDailySessionSnapshots, upsertDailySessionSnapshotSafely } from "../src/domain/storage.ts";
import type { AppState, DailySessionSnapshot, DemandCycle, DiscountTime, GlobalDiscountAdjustmentPercent, RateDecisionSnapshot, SessionData } from "../src/domain/types.ts";
import { buildMergedBonusDisplay, getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { buildCurrentNormalRatePresentation, shouldIgnoreNormalTimeRateCap } from "../src/hooks/nebikiApp/ratePresentation.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot, createReview19Reference } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";

// Local in-memory fixtures only; no browser, production store, or network access.
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}
const memory = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
const DATE = "2026-09-08";
const CONFIRMED_AT = `${DATE}T08:10:00.000Z`;
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const noop = () => {};
let passed = 0;
function test(name: string, body: () => void): void {
  body();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

function makeSession(cycle: DemandCycle = "summer", time: DiscountTime = "17", global: GlobalDiscountAdjustmentPercent = 0): SessionData {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const entry of Object.values(hourlyForecasts)) {
    entry.weather = "sunny";
    entry.tempC = 24;
    entry.windMs = 2;
  }
  return {
    ...getCurrentDataVersionInfo(), date: DATE, weekday: 2, discountTime: time,
    demandCycle: cycle, globalDiscountAdjustmentPercent: global,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts, afterRainSky: null },
    startedAt: `${DATE}T08:00:00.000Z`,
  };
}
function advance(session: SessionData, resolvedWeather = resolveWeatherInputForDiscount(session.weather, session.discountTime)): number | null {
  return getAdvanceDiscountRate({ session, resolvedWeather, isFixedTimeMode: false });
}

// Execute actual hook expressions, following the existing advance-flow harness.
// This catches missing demandCycle arguments and wrong display/snapshot wiring.
const hookSource = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
const hookAst = ts.createSourceFile("useNebikiApp.ts", hookSource, ts.ScriptTarget.Latest, true);
function executeHookValue<T>(name: string, context: Record<string, unknown>): T {
  const matches: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(hookAst);
  assert.equal(matches.length, 1, `one production hook declaration for ${name}`);
  assert.ok(matches[0].initializer);
  const expression = matches[0].initializer.getText(hookAst);
  const output = ts.transpileModule(`(${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const value = runInNewContext(output, context) as T;
  context[name] = value;
  return value;
}
function hookDecision(session: SessionData, resolvedWeather = resolveWeatherInputForDiscount(session.weather, session.discountTime)) {
  const state = createInitialState(session);
  state.session = session;
  state.screen = "rate_display";
  state.currentAreaId = "bento_men";
  const progress = state.areaProgressMap.bento_men;
  progress.areaJudge = "normal";
  progress.areaRateAdjustment = 0;
  const context: Record<string, unknown> = {
    state, sessionSource: session, sessionSourceResolvedWeather: resolvedWeather,
    currentAreaProgress: progress, clickedProgress: progress, clickedAreaId: "bento_men",
    completedAt: CONFIRMED_AT, lateTimeBonus: 0, lateTimeBonusNotice: null,
    earlyNextMinus5Info: null, effectiveRateDiscountTime: session.discountTime,
    effectiveRateIgnoreTimeRateCap: shouldIgnoreNormalTimeRateCap(resolvedWeather),
    applyObonRule: true, useMemo: (factory: () => unknown) => factory(),
    getWeekdayBaseInfo, getBasisGuideDisplay, buildMergedBonusDisplay,
    buildCurrentNormalRatePresentation, buildRateDecisionSnapshot,
    normalizeGlobalDiscountAdjustmentPercent, normalizeDemandCycle,
  };
  const weekdayBaseInfo = executeHookValue<ReturnType<typeof getWeekdayBaseInfo>>("weekdayBaseInfo", context);
  const basisGuide = executeHookValue<ReturnType<typeof getBasisGuideDisplay>>("basisGuide", context);
  const presentation = executeHookValue<ReturnType<typeof buildCurrentNormalRatePresentation>>("ratePresentation", context);
  const snapshot = executeHookValue<RateDecisionSnapshot | null>("clickedRateDecisionSnapshot", context);
  assert.ok(presentation);
  assert.ok(snapshot);
  return { state, resolvedWeather, weekdayBaseInfo, basisGuide, presentation, snapshot };
}
function dailyFromDecision(decision: ReturnType<typeof hookDecision>): DailySessionSnapshot {
  const state: AppState = json(decision.state);
  state.screen = "done";
  state.areaProgressMap.bento_men = {
    ...state.areaProgressMap.bento_men, status: "completed", completedAt: CONFIRMED_AT,
    completedRateText: decision.snapshot.displayedRateText,
    rateDecisionSnapshot: decision.snapshot, rateDecisionSnapshotStatus: "captured",
  };
  const daily = createDailySessionSnapshot({
    capturedAt: CONFIRMED_AT, state, resolvedWeather: decision.resolvedWeather,
    weekdayBaseInfo: decision.weekdayBaseInfo, basisGuide: decision.basisGuide,
    lateTimeBonus: 0, doneSummaryItems: [],
  });
  assert.ok(daily);
  return daily;
}
function assertSavedWeather(daily: DailySessionSnapshot, expected: number): void {
  assert.equal(daily.demandCycle, "summer");
  assert.equal(daily.session.demandCycle, "summer");
  assert.equal(daily.basis.baseRateBonus, expected);
  assert.equal(daily.areas.bento_men.rateDecisionSnapshot?.weatherComfortAdjustmentPercent, expected);
}

// Actual TSX and real local dependencies, as in check-advance-discount-ui.
const componentModules = new Map<string, Record<string, unknown>>();
async function loadComponentModule(url: URL): Promise<Record<string, unknown>> {
  const cached = componentModules.get(url.href);
  if (cached) return cached;
  const source = readFileSync(url, "utf8");
  const ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dependencies = new Map<string, unknown>([["react", React], ["react/jsx-runtime", jsxRuntime]]);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
    const id = statement.moduleSpecifier.text;
    if (dependencies.has(id)) continue;
    assert.ok(id.startsWith("."), `local component dependency: ${id}`);
    const dependency = [id, id + ".ts", id + ".tsx"].map((path) => new URL(path, url)).find((candidate) => existsSync(candidate));
    assert.ok(dependency);
    dependencies.set(id, dependency.pathname.endsWith(".tsx") ? await loadComponentModule(dependency) : await import(dependency.href));
  }
  const exports: Record<string, unknown> = {};
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(output, { exports, require: (id: string) => {
    assert.ok(dependencies.has(id));
    return dependencies.get(id);
  } });
  componentModules.set(url.href, exports);
  return exports;
}
const RuntimeAdvanceScreen = (await loadComponentModule(new URL("../src/components/screens/AdvanceDiscountScreen.tsx", import.meta.url))).AdvanceDiscountScreen as typeof AdvanceDiscountScreen;
const RuntimeRateScreen = (await loadComponentModule(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url))).RateDisplayScreen as typeof RateDisplayScreen;

test("summer17: actual hourly dry/comfortable weather + global -5/0/+5 gives advance 5/10/15", () => {
  assert.deepEqual(([-5, 0, 5] as const).map((global) => advance(makeSession("summer", "17", global))), [5, 10, 15]);
  assert.equal(advance(makeSession("normal", "17", -5)), 10);
  const legacy = makeSession("normal", "17", -5);
  delete legacy.demandCycle;
  assert.equal(advance(legacy), 10, "cycle missing still means normal");
});

test("15時は両cycleで同じ0/0/5、rain/snowはdry特例を採用しない", () => {
  for (const cycle of ["normal", "summer"] as const) {
    assert.deepEqual(([-5, 0, 5] as const).map((global) => advance(makeSession(cycle, "15", global))), [0, 0, 5]);
  }
  for (const weather of ["rain", "snow"] as const) {
    for (const global of [-5, 0, 5] as const) {
      const rates = (["normal", "summer"] as const).map((cycle) => {
        const session = makeSession(cycle, "17", global);
        for (const entry of Object.values(session.weather.hourlyForecasts)) entry.weather = weather;
        return advance(session);
      });
      assert.deepEqual(rates, weather === "rain" ? [30 + global, 30 + global] : [40 + global, 40 + global]);
    }
  }
});

test("summer17 advanceはAreaCount・quick・decrease・product policyのgetterに触れない", () => {
  function forbid<T extends object>(target: T): T {
    for (const field of ["areaCount", "areaCountRecords", "areaProgressMap", "areaJudge", "areaRateAdjustment", "humanEvaluationDetails", "quickAdjustment", "decrease", "decreaseAdjustment", "medianCount", "history", "productAdjustmentPolicy", "productPolicy"]) {
      Object.defineProperty(target, field, { get() { throw new Error(`forbidden ${field}`); } });
    }
    return target;
  }
  const session = makeSession("summer", "17", -5);
  const resolvedWeather = resolveWeatherInputForDiscount(session.weather, "17");
  const input = forbid({ session: forbid(session), resolvedWeather, isFixedTimeMode: false });
  assert.equal(getAdvanceDiscountRate(input), 5);
});

test("共通0..50制限と先行画面の0％指示を維持する", () => {
  const zero = advance(makeSession("summer", "15", -5));
  assert.equal(zero, 0);
  const markup = renderToStaticMarkup(React.createElement(RuntimeAdvanceScreen, { referenceConditionLabel: "夏・火曜日・15時", ratePercent: zero!, onContinue: noop }));
  assert.match(markup.replace(/<[^>]*>/g, ""), /0％で引いてください/);
  assert.doesNotMatch(markup, /引かない/);
  const session = makeSession();
  const resolved = resolveWeatherInputForDiscount(session.weather, "17");
  for (const global of [-5, 0, 5] as const) {
    session.globalDiscountAdjustmentPercent = global;
    assert.equal(advance(session, { ...resolved, nearTermWeather: "snow", precipitationRateBonus: 40 }), 50);
  }
});

test("実hookのRateDisplayと確定snapshotはsummer17 weather -10を共有する", () => {
  const decision = hookDecision(makeSession());
  assert.equal(decision.weekdayBaseInfo.baseRateBonus, -10);
  assert.equal(decision.snapshot.weatherComfortAdjustmentPercent, -10);
  assert.equal(decision.snapshot.demandCycle, "summer");
  assert.equal(decision.snapshot.normalRateBeforeLimitsPercent, 0);
  assert.equal(decision.snapshot.displayedManyRatePercent, 10);
  assert.deepEqual(decision.presentation.display, decision.snapshot.display);
  const markup = renderToStaticMarkup(React.createElement(RuntimeRateScreen, {
    weekdayText: "火曜日", timeText: "17時", areaName: "弁当・麺", demandCycle: "summer",
    discountTime: "17", basisGuide: decision.basisGuide, rateDisplay: decision.presentation.display,
    onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop,
  }));
  assert.ok(markup.includes(decision.basisGuide.bonusSummaryText!));
  assert.match(decision.basisGuide.bonusSummaryText!, /-10％/);
  assert.match(markup, /10%/);
});

test("実hook: normal17とsummer18/19は旧快適下限-5を維持する", () => {
  for (const [cycle, time] of [["normal", "17"], ["summer", "18"], ["summer", "19"]] as const) {
    const decision = hookDecision(makeSession(cycle, time));
    assert.equal(decision.weekdayBaseInfo.baseRateBonus, -5);
    assert.equal(decision.snapshot.weatherComfortAdjustmentPercent, -5);
    assert.deepEqual(decision.presentation.display, decision.snapshot.display);
  }
});

test("session保存/復元とrate normalizationは新-10snapshotを維持する", () => {
  const decision = hookDecision(makeSession());
  decision.state.areaProgressMap.bento_men.rateDecisionSnapshot = decision.snapshot;
  const before = JSON.stringify(decision.state);
  saveCurrentSession(decision.state);
  const restored = normalizeLoadedState(loadCurrentSession(), decision.state.sessionDraft);
  assert.equal(restored.session?.demandCycle, "summer");
  assert.equal(restored.areaProgressMap.bento_men.rateDecisionSnapshot?.weatherComfortAdjustmentPercent, -10);
  const normalized = normalizeRateDecisionSnapshot(json(decision.snapshot));
  assert.deepEqual(normalized, decision.snapshot);
  assert.deepEqual(reconstructRateDisplayFromSnapshot(normalized!), decision.presentation.display);
  assert.equal(JSON.stringify(decision.state), before, "normalization does not mutate input");
});

test("実daily→day→finalized→direct/all exportはsummer17 weather -10を保持する", () => {
  const daily = dailyFromDecision(hookDecision(makeSession()));
  assertSavedWeather(daily, -10);
  saveDailySessionSnapshots([daily]);
  const savedDaily = loadDailySessionSnapshots()[0];
  assertSavedWeather(savedDaily, -10);
  const day = createReview19DaySnapshot({ capturedAt: CONFIRMED_AT, date: DATE, demandCycle: "summer", sessions: [savedDaily], areaCountRecords: [] });
  assert.equal(day.sessions.length, 1);
  assertSavedWeather(day.sessions[0], -10);
  const initialized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot: day });
  assert.equal(initialized.created, true);
  assertSavedWeather(initialized.record.sessions[0], -10);
  const normalized = normalizeFinalizedDayData(json(initialized.record));
  assert.ok(normalized);
  assertSavedWeather(normalized.sessions[0], -10);
  const direct = buildDirectFinalizedDayDataExportPayload({ record: normalized, exportedAt: CONFIRMED_AT });
  assertSavedWeather(direct.daySnapshot.sessions[0], -10);
  const all = buildAllFinalizedDayDataExportPayload({ records: [normalized], exportedAt: CONFIRMED_AT, demandCycle: "summer" });
  assert.equal(all.count, 1);
  assertSavedWeather(all.records[0].sessions[0], -10);
});

function legacyDaily(): DailySessionSnapshot {
  // Normal17 retains the exact pre-change comfortable-weather basis/display.
  // Use that real implementation to construct consistent historical text.
  const decision = hookDecision(makeSession("normal"));
  decision.state.session = { ...makeSession(), appVersion: "2026.8.9-24" };
  // A captured pre-change snapshot is an explicit historical fixture. Build it
  // with the real snapshot API's stored -5 input, never re-evaluate its weather.
  decision.snapshot = buildNormalRateDecisionSnapshot({
    confirmedAt: CONFIRMED_AT, sessionDiscountTime: "17", demandCycle: "summer",
    weekday: 2, date: DATE, resolvedWeather: decision.resolvedWeather,
    weatherComfortAdjustmentPercent: -5, areaJudge: "normal", areaRateAdjustment: 0,
  });
  const daily = dailyFromDecision(decision);
  daily.appVersion = "2026.8.9-24";
  daily.session.appVersion = "2026.8.9-24";
  return json(daily);
}

test("旧summer17 -5 snapshotはsession/rate/daily/finalized/exportで遡及再計算しない", () => {
  const old = legacyDaily();
  const original = JSON.stringify(old);
  const rate = old.areas.bento_men.rateDecisionSnapshot!;
  const normalizedRate = normalizeRateDecisionSnapshot(json(rate));
  assert.ok(normalizedRate);
  assert.equal(normalizedRate.weatherComfortAdjustmentPercent, -5);
  assert.equal(normalizedRate.displayedRatePercent, 5);
  const state = createInitialState(makeSession());
  state.session = { ...makeSession(), appVersion: "2026.8.9-24" };
  state.areaProgressMap.bento_men.rateDecisionSnapshot = rate;
  assert.equal(normalizeLoadedState(json(state), state.sessionDraft).areaProgressMap.bento_men.rateDecisionSnapshot?.weatherComfortAdjustmentPercent, -5);
  saveDailySessionSnapshots([old]);
  assertSavedWeather(loadDailySessionSnapshots()[0], -5);
  const day = createReview19DaySnapshot({ capturedAt: CONFIRMED_AT, date: DATE, demandCycle: "summer", sessions: [old], areaCountRecords: [] });
  const finalized = normalizeFinalizedDayData(day);
  assert.ok(finalized);
  assertSavedWeather(finalized.sessions[0], -5);
  const exported = buildAllFinalizedDayDataExportPayload({ records: [finalized], exportedAt: CONFIRMED_AT, demandCycle: "summer" });
  assertSavedWeather(exported.records[0].sessions[0], -5);
  assert.equal(JSON.stringify(old), original);
});

test("同identity/同完了signatureの新-10candidateでも旧-5 dailyを上書きしない", () => {
  memory.clear();
  const old = legacyDaily();
  const candidate = dailyFromDecision(hookDecision(makeSession()));
  candidate.capturedAt = `${DATE}T09:00:00.000Z`;
  assert.equal(candidate.session.startedAt, old.session.startedAt);
  assertSavedWeather(candidate, -10);
  saveDailySessionSnapshots([old]);
  assert.equal(upsertDailySessionSnapshotSafely(candidate, { protectedDate: DATE }).ok, true);
  const stored = loadDailySessionSnapshots();
  assert.equal(stored.length, 1);
  assertSavedWeather(stored[0], -5);
  assert.deepEqual(stored[0].basis, old.basis);
  assert.deepEqual(stored[0].areas, old.areas);
  const archived = mergeDailySessionSnapshotArchiveOperations([old, candidate]);
  assert.equal(archived.length, 1);
  assertSavedWeather(archived[0], -5);
  assert.deepEqual(archived[0], old);
});

test("Review19 referenceは17時draftでも19時として解決し旧仕様を保持する", () => {
  const summer = createReview19Reference(makeSession("summer", "17"));
  const normal = createReview19Reference(makeSession("normal", "17"));
  assert.equal(summer.discountTime, "19");
  assert.equal(summer.demandCycle, "summer");
  assert.equal(summer.basis.baseRateBonus, -5);
  assert.equal(summer.basis.baseRateBonus, normal.basis.baseRateBonus);
  assert.deepEqual(summer.resolvedWeather, normal.resolvedWeather);
  assert.deepEqual(summer.basis.baseRateBonusReason, normal.basis.baseRateBonusReason);
});

console.log(`Summer17 comfort integration checks passed: ${passed}/${passed}`);
