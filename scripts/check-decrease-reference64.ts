import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeAreaCountDecisionBasis, normalizeAreaCountRecords, canSuppressAreaCountDecreaseAdjustment, setAreaCountDecreaseAdjustmentSuppressed, evaluationToRateAdjustment, isAreaCountDecreaseComparisonEligible } from "../src/domain/areaCountHistory.ts";
import { buildRemoteAreaCountRow, normalizeRemoteAreaCountRows } from "../src/domain/areaCountRemoteStorage.ts";
import { buildAutomaticDayExportPayload } from "../src/domain/dayExport.ts";
import { initializeFinalizedDayDataInMemory } from "../src/domain/finalizedDayData.ts";
import { resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { getWeekdayBaseInfo, getBasisGuideDisplay } from "../src/domain/weekdayBase.ts";
import { createDailySessionSnapshot, createReview19Snapshot, createReview19DaySnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { buildCurrentNormalRatePresentation } from "../src/hooks/nebikiApp/ratePresentation.ts";
import { getAdoptedEvaluation, getNextPriorityPendingCandidate } from "../src/domain/pending.ts";
import { createAreaEvaluationQuickAdjustment, getAreaEvaluationQuickAdjustments, getAreaEvaluationQuickAdjustmentBase } from "../src/domain/areaEvaluationAdjustment.ts";
import { createHumanEvaluationSelection, resolveHumanEvaluationForDiscount } from "../src/domain/humanEvaluation.ts";
import { buildRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { AREA_COUNT_LOCAL_STORAGE_KEY } from "../src/domain/areaCountLocalStorage.ts";
import * as storage from "../src/domain/storage.ts";
import { getAreaDecreaseDisplay } from "../src/domain/areaDecreaseDisplay.ts";
import { buildAreaCountDecisionBasis, getActualWeekdayLabel, getAreaCountFallbackWeekdayGroup, getAreaCountRecommendation, type AreaCountDecisionBasis, type AreaCountRecord } from "../src/domain/areaCountHistory.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { setRuntimeNowOverride } from "../src/hooks/nebikiApp/clock.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";
import type { AppState, AreaId, DemandCycle, DiscountTime, SessionData, UseNebikiAppResult } from "../src/domain/types.ts";
import type { AppRouter } from "../src/app/AppRouter.tsx";

// Reuse the existing real React dispatcher/full-hook fixture: execute the actual TSX,
// handlers, aligned clock and synchronous persistence effects. This is a host
// tree test; actual browser paint/overflow/transport are checked separately.
process.env.TZ = "Asia/Tokyo";
const NativeDate = Date, DATE = "2026-09-08", AREA = "bento_men";
const at = (clock: string, date = DATE) => new NativeDate(`${date}T${clock}+09:00`).getTime();
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let nowMs = at("15:00:00");
class FixtureDate extends NativeDate {
  constructor(value?: string | number | Date) { super(value === undefined ? nowMs : value); }
  static now() { return nowMs; }
}
Object.defineProperty(globalThis, "Date", { configurable: true, value: FixtureDate });
class MemoryStorage implements Storage {
  values = new Map<string, string>(); writes: string[] = []; removals: string[] = []; failKeys = new Set<string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes.push(key); if (this.failKeys.has(key)) throw new DOMException("fixture quota", "QuotaExceededError"); this.values.set(key, String(value)); }
  removeItem(key: string) { this.removals.push(key); this.values.delete(key); }
  clear() { this.values.clear(); this.writes = []; this.removals = []; this.failKeys.clear(); }
}
class Events {
  listeners = new Map<string, Set<() => void>>();
  addEventListener = (name: string, callback: () => void) => { const values = this.listeners.get(name) ?? new Set<() => void>(); values.add(callback); this.listeners.set(name, values); };
  removeEventListener = (name: string, callback: () => void) => { this.listeners.get(name)?.delete(callback); };
  emit(name: string) { for (const callback of [...(this.listeners.get(name) ?? [])]) callback(); }
  count(name: string) { return this.listeners.get(name)?.size ?? 0; }
}
const memory = new MemoryStorage(), windowEvents = new Events(), documentEvents = new Events();
type Timer = { callback: () => void; due: number; delay: number };
const timeouts = new Map<number, Timer>(); let timerId = 0;
const documentFixture = { hidden: false, addEventListener: documentEvents.addEventListener, removeEventListener: documentEvents.removeEventListener };
const alerts: string[] = [];
const windowFixture = {
  addEventListener: windowEvents.addEventListener, removeEventListener: windowEvents.removeEventListener,
  setTimeout(callback: () => void, delay = 0) { const id = ++timerId; timeouts.set(id, { callback, delay, due: nowMs + delay }); return id; },
  clearTimeout(id: number) { timeouts.delete(id); },
  setInterval() { assert.fail("64 must reuse the shared aligned timeout clock"); }, clearInterval() {},
  location: { search: "", hash: "", href: "http://decrease64.invalid/", pathname: "/" },
  confirm() { return true; }, scrollTo() {}, alert(message: string) { alerts.push(message); },
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
Object.defineProperty(globalThis, "document", { configurable: true, value: documentFixture });
Object.defineProperty(globalThis, "window", { configurable: true, value: windowFixture });
const modules = new Map<string, Record<string, unknown>>();
async function loadTsx(url: URL): Promise<Record<string, unknown>> {
  const cached = modules.get(url.href); if (cached) return cached;
  const source = readFileSync(url, "utf8"), ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dependencies = new Map<string, unknown>([["react", React], ["react/jsx-runtime", jsxRuntime]]);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    assert.ok(ts.isStringLiteral(statement.moduleSpecifier)); const id = statement.moduleSpecifier.text; if (dependencies.has(id)) continue;
    assert.ok(id.startsWith(".")); const target = [id, `${id}.ts`, `${id}.tsx`].map(path => new URL(path, url)).find(path => existsSync(path)); assert.ok(target);
    dependencies.set(id, target.pathname.endsWith(".tsx") ? await loadTsx(target) : await import(target.href));
  }
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    Date: FixtureDate, window: windowFixture, document: documentFixture, navigator, localStorage, URLSearchParams, exports,
    require: (id: string) => { assert.ok(dependencies.has(id)); return dependencies.get(id); },
  });
  modules.set(url.href, exports); return exports;
}
const Router = (await loadTsx(new URL("../src/app/AppRouter.tsx", import.meta.url))).AppRouter as typeof AppRouter;
type Props = Record<string, unknown>;
type HostNode = { type: string; props: Props; children: Array<HostNode | string> };
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Instance = { type: unknown; slots: Slot[]; cursor: number };
const textOf = (node: HostNode | string): string => typeof node === "string" ? node : node.children.map(textOf).join("");
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) => a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const hookEffects = (text: string) => /app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|areaCompletionStateRef\.current|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|startAlignedRuntimeClock|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)|earlyNextMinus5TargetDiscountTime|setGlobalDiscountAdjustmentState/.test(text);
function FixtureApp({ fixture }: { fixture: AppFixture }) {
  const app = useNebikiApp({ testNow: fixture.fixedNow }); fixture.capture(app);
  return React.createElement(Router, { app, testNow: fixture.fixedNow });
}
class AppFixture {
  instances = new Map<string, Instance>(); current: Instance | null = null;
  effects: Array<() => void> = []; dirty = true; nodes: HostNode[] = [];
  fixedNow: Date | null = null; app!: UseNebikiAppResult;
  capture(app: UseNebikiAppResult) { this.app = app; }
  slot() { assert.ok(this.current); return this.current.slots[this.current.cursor++] ??= {}; }
  dispatcher = {
    useState: <T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] => {
      const slot = this.slot(); if (!("value" in slot)) slot.value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slot.value as T, value => { const next = typeof value === "function" ? (value as (previous: T) => T)(slot.value as T) : value; if (!Object.is(next, slot.value)) { slot.value = next; this.dirty = true; } }];
    },
    useRef: <T>(initial: T) => { const slot = this.slot(); if (!("value" in slot)) slot.value = { current: initial }; return slot.value as { current: T }; },
    useMemo: <T>(callback: () => T, deps?: readonly unknown[]) => { const slot = this.slot(); if (!("value" in slot) || !sameDeps(slot.deps, deps)) { slot.value = callback(); slot.deps = deps; } return slot.value as T; },
    useCallback: <T>(callback: T, deps?: readonly unknown[]) => this.dispatcher.useMemo(() => callback, deps),
    useEffect: (callback: () => void | (() => void), deps?: readonly unknown[]) => {
      const owner = this.current, slot = this.slot();
      if (!sameDeps(slot.deps, deps)) { slot.deps = deps; if (owner?.type === FixtureApp && !hookEffects(String(callback))) return;
        this.effects.push(() => { slot.cleanup?.(); const cleanup = callback(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; }); }
    },
  };
  render() {
    this.dirty = true;
    for (let pass = 0; this.dirty; pass++) {
      assert.ok(pass < 25, "actual hook and component effects converge"); this.dirty = false; this.nodes = [];
      const visited = new Set<string>(), internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown };
      const previous = internals.H; internals.H = this.dispatcher;
      const expand = (value: React.ReactNode, path: string): Array<HostNode | string> => {
        if (value == null || typeof value === "boolean") return [];
        if (typeof value === "string" || typeof value === "number") return [String(value)];
        if (Array.isArray(value)) return value.flatMap((child, index) => expand(child, `${path}/${index}`));
        assert.ok(React.isValidElement<Props>(value));
        if (value.type === React.Fragment) return expand(value.props.children as React.ReactNode, path + "/fragment");
        if (typeof value.type === "function") {
          const key = `${path}:${value.key ?? ""}`; let instance = this.instances.get(key);
          if (!instance || instance.type !== value.type) { instance?.slots.forEach(slot => slot.cleanup?.()); instance = { type: value.type, slots: [], cursor: 0 }; this.instances.set(key, instance); }
          visited.add(key); instance.cursor = 0; const outer = this.current; this.current = instance;
          const rendered = (value.type as (props: Props) => React.ReactNode)(value.props); this.current = outer; return expand(rendered, path + "/render");
        }
        assert.equal(typeof value.type, "string"); const node: HostNode = { type: value.type as string, props: value.props, children: [] }; this.nodes.push(node);
        node.children = expand(value.props.children as React.ReactNode, path + "/children"); return [node];
      };
      try { expand(React.createElement(FixtureApp, { fixture: this }), "root"); } finally { internals.H = previous; }
      for (const [key, instance] of this.instances) if (!visited.has(key)) { instance.slots.forEach(slot => slot.cleanup?.()); this.instances.delete(key); }
      const effects = this.effects; this.effects = []; effects.forEach(effect => effect());
    }
  }
  text() { return this.nodes.filter(node => node.type === "main").map(textOf).join(""); }
  panelText() { const panel = this.nodes.find(node => node.props["aria-label"] === "現在のエリア残数と減少率"); return panel ? textOf(panel) : ""; }
  async act(callback: () => void | Promise<void>) { await callback(); this.render(); }
  button(label: string) { const node = this.nodes.find(value => value.type === "button" && (textOf(value) === label || value.props["aria-label"] === label)); assert.ok(node, `real button exists: ${label}`); return node; }
  async click(label: string) { await invoke(this.button(label)); this.render(); }
  changeInput(id: string, text: string) { const input = this.nodes.find(node => node.type === "input" && node.props.id === id); assert.ok(input); (input.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: text } }); this.render(); }
  replaceState(next: AppState) { const instance = [...this.instances.values()].find(value => value.type === FixtureApp); assert.ok(instance); const slot = instance.slots.find(value => value.value === this.app.state); assert.ok(slot); slot.value = next; this.render(); }
  close() { this.instances.forEach(instance => instance.slots.forEach(slot => slot.cleanup?.())); this.instances.clear(); }
}
function invoke(node: HostNode) { assert.ok(!node.props.disabled); return (node.props.onClick as () => void | Promise<void>)(); }
function clean() { assert.equal(timeouts.size, 0); assert.equal(windowEvents.count("focus"), 0); assert.equal(documentEvents.count("visibilitychange"), 0); setRuntimeNowOverride(null); documentFixture.hidden = false; }

const TARGETS: AreaId[] = ["bento_men", "tempura", "yakitori", "chuka_fish", "onigiri", "sushi", "futomaki_chumaki", "inari", "hosomaki"];
const EXCLUDED: AreaId[] = ["croquette", "fry_chicken"];
const HISTORY_DATES = ["2026-08-18", "2026-08-25", "2026-09-01"];
type Decrease = NonNullable<AreaCountDecisionBasis["decreaseAdjustment"]>;
function decrease(patch: Partial<Decrease> = {}): Decrease {
  return { canUse: true, sampleSize: 3, requiredSampleSize: 3, previousDiscountTime: "15", previousCount: 100,
    currentDecreaseRate: 0.5, medianDecreaseRate: 0.4, direction: "none", ...patch };
}
function basis(patch: Partial<Decrease> = {}): AreaCountDecisionBasis {
  return { ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 3, requiredSampleSize: 3,
    baseEvaluation: "normal", finalEvaluation: "normal", evaluationSource: "history", areaRateAdjustment: 0,
    decreaseAdjustment: decrease(patch) };
}
function record(date: string, areaId: AreaId, discountTime: DiscountTime, count: number, cycle: DemandCycle = "normal"): AreaCountRecord {
  const weekday = new NativeDate(`${date}T00:00:00Z`).getUTCDay();
  return { ...getCurrentDataVersionInfo(), date, areaId, discountTime, count, demandCycle: cycle,
    sessionStartedAt: `${date}T06:00:00.000Z`, recordedAt: `${date}T06:05:00.000Z`,
    actualWeekday: getActualWeekdayLabel(weekday), actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({ date, weekday, discountTime }) };
}
function history(areaId: AreaId = AREA, previous = 100, medianCount = 50, medianPrevious = 100, cycle: DemandCycle = "normal") {
  return [...HISTORY_DATES.flatMap(date => [record(date, areaId, "15", medianPrevious, cycle), record(date, areaId, "17", medianCount, cycle)]), record(DATE, areaId, "15", previous, cycle)];
}
function sessionState(options: { areaId?: AreaId; time?: DiscountTime; count?: number; savedBasis?: AreaCountDecisionBasis; screen?: AppState["screen"]; cycle?: DemandCycle } = {}): AppState {
  const areaId = options.areaId ?? AREA, time = options.time ?? "17", count = options.count ?? 50;
  const session: SessionData = { ...getCurrentDataVersionInfo(), date: DATE, weekday: 2, discountTime: time,
    demandCycle: options.cycle ?? "normal", manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null }, startedAt: `${DATE}T${time === "15" ? "06" : "08"}:00:00.000Z` };
  const state = createInitialState(session); state.session = session; state.screen = options.screen ?? "rate_display";
  state.currentAreaId = areaId; state.lastReferenceAreaId = areaId;
  Object.assign(state.areaProgressMap[areaId], { areaCount: count, areaJudge: "normal", areaCountEvaluation: options.savedBasis?.finalEvaluation ?? "normal",
    areaCountEvaluationSource: "history", areaRateAdjustment: options.savedBasis?.areaRateAdjustment ?? 0, areaCountDecisionBasis: options.savedBasis });
  return state;
}
function fixture(options: { raw?: AppState; records?: AreaCountRecord[]; fixed?: boolean } = {}) {
  clean(); memory.clear(); alerts.length = 0; nowMs = at("17:10:00");
  if (options.raw) memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(options.raw));
  if (options.records) memory.values.set(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(options.records));
  const value = new AppFixture(); if (options.fixed) value.fixedNow = new Date(nowMs); value.render(); return value;
}
async function mounted(options: { raw: AppState; records?: AreaCountRecord[]; fixed?: boolean }) {
  const value = fixture(options);
  if (value.app.state.screen === "start") await value.click("再開");
  assert.equal(value.app.state.session?.discountTime, options.raw.session?.discountTime);
  return value;
}
function assertCleanDisplay(text: string) { assert.doesNotMatch(text, /NaN|Infinity|[−-]0\.0(?=％|%|["<])/); }
const results: Array<{ name: string; ok: boolean }> = [], logLines: string[] = [];
function saveSummary(passed: boolean, failure?: string) {
  writeFileSync(new URL("../../tests64-summary.json", import.meta.url), JSON.stringify({ passed, passedCases: results.length,
    totalCases: results.length + (failure ? 1 : 0), evidence: "Actual production domain functions, full useNebikiApp hook, AppRouter and TSX host tree with real UI event handlers. Browser paint and transport are verified separately.",
    ...(failure ? { failure } : {}), cases: results }, null, 2) + "\n");
  writeFileSync(new URL("../../tests64.log", import.meta.url), [...logLines, ...(failure ? [`FAIL ${failure}`] : [])].join("\n") + "\n");
}
async function test(name: string, run: () => void | Promise<void>) {
  try { await run(); clean(); } catch (error) { saveSummary(false, `${name}: ${String(error)}`); throw error; }
  results.push({ name, ok: true }); const line = `PASS ${String(results.length).padStart(2, "0")}: ${name}`; logLines.push(line); console.log(line);
}


function recommendation(rows = history(), count = 50, areaId: AreaId = AREA, time: DiscountTime = "17", date = DATE, weekday = 2) {
  return getAreaCountRecommendation({ records: rows, areaId, discountTime: time, count, date, weekday, demandCycle: "normal" });
}
function referenceBasis(rows = history(), count = 50, areaId: AreaId = AREA) {
  const rec = recommendation(rows, count, areaId);
  return buildAreaCountDecisionBasis({ recommendation: rec, evaluationSource: "history", finalEvaluation: rec.suggestedEvaluation, areaRateAdjustment: rec.areaRateAdjustment });
}
function assertReference(value: AreaCountDecisionBasis["decreaseAdjustment"]) {
  assert.equal(value?.mode, "reference_only_v1"); assert.equal(value?.applied, false);
}
function noControls(value: AppFixture) {
  assert.doesNotMatch(value.text(), /追加製造あり・補正を取り消す|補正を戻す/);
  assert.equal("toggleCurrentAreaDecreaseAdjustmentSuppression" in value.app.actions, false);
}
function displayedRates(state: AppState) {
  return buildCurrentNormalRatePresentation({ session: state.session, progress: state.areaProgressMap[AREA], effectiveDiscountTime: "17", weatherBonus: 0, ignoreTimeRateCap: false })!.display;
}

for (const areaId of TARGETS) await test(`new 17 ${areaId} uses paired decrease history solely as reference`, () => {
  const rows = history(areaId), before = structuredClone(rows), rec = recommendation(rows, 70, areaId);
  assert.equal(isAreaCountDecreaseComparisonEligible({ areaId, discountTime: "17" }), true);
  assert.equal(rec.decreaseRecommendation?.canUse, true); assert.equal(rec.decreaseRecommendation?.direction, "more_many");
  assert.equal(rec.suggestedEvaluation, rec.baseEvaluation); assert.equal(rec.areaRateAdjustment, evaluationToRateAdjustment(rec.baseEvaluation!));
  const saved = buildAreaCountDecisionBasis({ recommendation: rec }); assertReference(saved.decreaseAdjustment);
  assert.equal(canSuppressAreaCountDecreaseAdjustment({ areaId, discountTime: "17", basis: saved }), false);
  assert.equal(setAreaCountDecreaseAdjustmentSuppressed({ areaId, discountTime: "17", basis: saved, suppressed: false }), null);
  assert.deepEqual(rows, before);
});
for (const areaId of EXCLUDED) await test(`${areaId} displays measured decrease and increase without comparative median`, () => {
  for (const count of [50, 150]) {
    const rec = recommendation(history(areaId), count, areaId); assert.equal(rec.decreaseRecommendation?.canUse, false);
    const saved = buildAreaCountDecisionBasis({ recommendation: rec }); assertReference(saved.decreaseAdjustment);
    const value = getAreaDecreaseDisplay({ areaId, discountTime: "17", areaCount: count, previousCount: 100, decreaseAdjustment: saved.decreaseAdjustment })!;
    assert.equal(value.rateText, count === 50 ? "50.0％" : "−50.0％"); assert.equal(value.isIncrease, count === 150);
    assert.equal(value.assessmentText, "比較対象外"); assert.equal(value.medianText, undefined);
    assert.equal(rec.suggestedEvaluation, rec.baseEvaluation);
  }
});
await test("the original nine areas and preserved seasonals receive reference comparison; balance stays excluded", () => {
  assert.equal(new Set(TARGETS).size, 9);
  for (const areaId of ["ryomi", "autumn"] as AreaId[]) {
    assert.equal(isAreaCountDecreaseComparisonEligible({ areaId, discountTime: "17" }), true);
    const rec = recommendation(history(areaId), 70, areaId);
    assert.equal(rec.decreaseRecommendation?.canUse, true);
    assert.equal(rec.suggestedEvaluation, rec.baseEvaluation);
    assertReference(rec.decreaseRecommendation);
  }
  assert.equal(isAreaCountDecreaseComparisonEligible({ areaId: "balance_bento", discountTime: "17" }), false);
});
await test("same 17 count and median keep automatic and all five manual displayed rates identical across good/normal/bad", () => {
  const all = [200, 100, 60].map(previous => recommendation(history(AREA, previous), 50));
  assert.deepEqual(all.map(rec => rec.decreaseRecommendation?.direction), ["more_few", "none", "more_many"]);
  const rates = all.map(rec => displayedRates(sessionState({ count: 50, savedBasis: buildAreaCountDecisionBasis({ recommendation: rec, finalEvaluation: rec.suggestedEvaluation, areaRateAdjustment: rec.areaRateAdjustment }) })));
  assert.deepEqual(rates[0], rates[1]); assert.deepEqual(rates[1], rates[2]);
  for (const finalEvaluation of ["few", "slightly_few", "normal", "slightly_many", "many"] as const) {
    const manual = all.map(rec => displayedRates(sessionState({ count: 50, savedBasis: buildAreaCountDecisionBasis({ recommendation: rec, evaluationSource: "manual", finalEvaluation, areaRateAdjustment: evaluationToRateAdjustment(finalEvaluation) }) })));
    assert.deepEqual(manual[0], manual[1]); assert.deepEqual(manual[1], manual[2]);
  }
});
await test("decrease history requires three valid same-day pairs and uses at most 16 adopted-group observations", () => {
  const dates = Array.from({ length: 22 }, (_, i) => new NativeDate(at("00:00:00") - (i + 1) * 7 * 86400000).toISOString().slice(0, 10)).reverse();
  const rows = dates.flatMap((date, i) => [record(date, AREA, "15", 100), record(date, AREA, "17", i < 6 ? 90 : 50)]);
  rows.push(record(DATE, AREA, "15", 100));
  const rec = recommendation(rows, 50); assert.equal(rec.decreaseRecommendation?.sampleSize, 16); assert.equal(rec.decreaseRecommendation?.medianDecreaseRate, 0.5);
  const invalid = history().filter(row => !(row.date === HISTORY_DATES[0] && row.discountTime === "15"));
  invalid.push(record(HISTORY_DATES[0], "onigiri", "15", 100), record("2026-08-19", AREA, "15", 100));
  const missing = recommendation(invalid); assert.equal(missing.decreaseRecommendation?.sampleSize, 2); assert.equal(missing.decreaseRecommendation?.canUse, false);
  const unrelated = [record("2026-08-19", AREA, "15", 100), record("2026-08-19", AREA, "17", 1), record("2026-08-26", AREA, "15", 100), record("2026-08-26", AREA, "17", 1)];
  const before = structuredClone(rows); assert.equal(recommendation([...rows, ...unrelated]).decreaseRecommendation?.medianDecreaseRate, 0.5); assert.deepEqual(rows, before);
});
await test("weekday fallback uses the adopted 17 日月火 group and ignores unrelated 金土 pairs", () => {
  const rows = ["2026-09-06", "2026-08-31", "2026-08-24"].flatMap(date => [record(date, AREA, "15", 100), record(date, AREA, "17", 50)]);
  rows.push(record(DATE, AREA, "15", 100));
  for (const date of ["2026-09-04", "2026-08-28", "2026-08-21"]) rows.push(record(date, AREA, "15", 100), record(date, AREA, "17", 1));
  const rec = recommendation(rows, 70); assert.equal(rec.comparisonMode, "fallback_group"); assert.equal(rec.actualWeekdayGroup, "日月火");
  assert.equal(rec.decreaseRecommendation?.sampleSize, 3); assert.equal(rec.decreaseRecommendation?.medianDecreaseRate, 0.5);
});
await test("raw exact ±20 points and floating point equality classify without changing final count judgment", () => {
  for (const [count, direction] of [[30, "more_few"], [31, "none"], [69, "none"], [70, "more_many"]] as const) {
    const rec = recommendation(history(), count); assert.equal(rec.decreaseRecommendation?.direction, direction); assert.equal(rec.suggestedEvaluation, rec.baseEvaluation);
  }
  assert.equal(recommendation(history(AREA, 100, 60), 40).decreaseRecommendation?.direction, "more_few");
  for (const count of [3_000_000_001, 6_999_999_999]) assert.equal(recommendation(history(AREA, 10_000_000_000, 5_000_000_000, 10_000_000_000), count).decreaseRecommendation?.direction, "none");
});
await test("rounded percentages never classify a raw subthreshold comparison and increase retains bad badge", () => {
  for (const count of [3_000_000_001, 6_999_999_999]) {
    const rec = recommendation(history(AREA, 10_000_000_000, 5_000_000_000, 10_000_000_000), count);
    const d = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: count, decreaseAdjustment: rec.decreaseRecommendation })!;
    assert.equal(d.assessmentText, "普通"); assert.equal(d.rateText, count < 5_000_000_000 ? "70.0％" : "30.0％");
  }
  const rec = recommendation(history(), 150), d = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 150, decreaseAdjustment: rec.decreaseRecommendation })!;
  assert.equal(d.rateText, "−50.0％"); assert.equal(d.isIncrease, true); assert.equal(d.assessmentText, "悪い");
});
await test("missing and zero comparison source remain unavailable; zero current count is valid", () => {
  for (const previous of [undefined, 0]) {
    const rows = history().filter(row => row.date !== DATE); if (previous !== undefined) rows.push(record(DATE, AREA, "15", previous));
    const rec = recommendation(rows, 0); assert.equal(rec.decreaseRecommendation?.canUse, false); assert.equal(rec.suggestedEvaluation, rec.baseEvaluation);
    const d = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 0, previousCount: previous, decreaseAdjustment: rec.decreaseRecommendation })!;
    assert.equal(d.rateText, "算出不可"); assertCleanDisplay(JSON.stringify(d));
  }
  const d = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 0, decreaseAdjustment: recommendation(history(), 0).decreaseRecommendation })!;
  assert.equal(d.rateText, "100.0％");
});
await test("15 and retired 19 preserve their old calculation and never acquire a new marker", () => {
  for (const time of ["15", "18", "19", "20"] as const) {
    const previous = time === "19" ? "18" : "15";
    const rows = HISTORY_DATES.flatMap(date => [record(date, AREA, previous, 100), record(date, AREA, time, 50)]); rows.push(record(DATE, AREA, previous, 60));
    const rec = recommendation(rows, 50, AREA, time); assert.equal(rec.decreaseRecommendation?.mode, undefined);
    if (time === "19") { assert.equal(rec.decreaseRecommendation?.direction, "more_many"); assert.notEqual(rec.suggestedEvaluation, rec.baseEvaluation); }
    assert.equal(getAreaDecreaseDisplay({ areaId: AREA, discountTime: time, areaCount: 70, previousCount: 100 }), null);
  }
});
await test("optional schema3 marker round trips and absence keeps legacy saved adoption untouched", () => {
  const current = referenceBasis(history(), 70), legacy = basis({ direction: "more_many", suppressed: true, suppressionReason: "additional_production" });
  legacy.finalEvaluation = "slightly_many"; legacy.areaRateAdjustment = 5;
  for (const candidate of [current, legacy]) {
    const before = structuredClone(candidate), normalized = normalizeAreaCountDecisionBasis(candidate)!;
    assert.deepEqual(normalized, normalizeAreaCountDecisionBasis(before)); assert.deepEqual(candidate, before);
    const row = { ...record(DATE, AREA, "17", 70), decisionBasis: candidate, suggestedEvaluation: candidate.finalEvaluation, areaRateAdjustment: candidate.areaRateAdjustment };
    for (const recovered of [normalizeAreaCountRecords([row])[0], normalizeRemoteAreaCountRows([buildRemoteAreaCountRow(row)])[0]]) {
      assert.equal(recovered.decisionBasis?.finalEvaluation, candidate.finalEvaluation); assert.equal(recovered.decisionBasis?.areaRateAdjustment, candidate.areaRateAdjustment);
      if (candidate === current) assertReference(recovered.decisionBasis?.decreaseAdjustment); else assert.equal(Object.hasOwn(recovered.decisionBasis!.decreaseAdjustment!, "mode"), false);
    }
  }
  assert.equal(normalizeAreaCountDecisionBasis({ ...current, decreaseAdjustment: { ...current.decreaseAdjustment!, mode: "unknown", applied: true } })?.decreaseAdjustment?.mode, undefined);
});
await test("current/checkpoint, daily/Review19, finalized and JSON export retain the reference evidence and unchanged final rates", () => {
  memory.clear(); const saved = referenceBasis(history(), 70), state = sessionState({ count: 70, savedBasis: saved });
  storage.saveCurrentSession(state); storage.saveWorkSessionCheckpoint(state);
  for (const raw of [storage.loadCurrentSession(), storage.loadWorkSessionCheckpoint()]) { assert.ok(raw); const restored = normalizeLoadedState(raw); assertReference(restored.areaProgressMap[AREA].areaCountDecisionBasis?.decreaseAdjustment); assert.deepEqual(displayedRates(restored), displayedRates(state)); }
  state.screen = "done"; const capturedAt = new Date(at("17:10:00")).toISOString(), resolvedWeather = resolveWeatherInputForDiscount(state.session!.weather, "17");
  const inputs = { capturedAt, resolvedWeather, lateTimeBonus: 0, doneSummaryItems: [], weekdayBaseInfo: getWeekdayBaseInfo(2, "17", resolvedWeather, DATE), basisGuide: getBasisGuideDisplay({ date: DATE, weekday: 2, discountTime: "17", demandCycle: "normal", weather: resolvedWeather }) };
  const daily = createDailySessionSnapshot({ ...inputs, state })!, review = createReview19Snapshot({ ...inputs, session: state.session!, areaProgressMap: state.areaProgressMap, excludedAreaIds: [] });
  const row = { ...record(DATE, AREA, "17", 70), decisionBasis: saved, suggestedEvaluation: saved.finalEvaluation, areaRateAdjustment: saved.areaRateAdjustment };
  const day = createReview19DaySnapshot({ date: DATE, capturedAt, demandCycle: "normal", sessions: [daily], areaCountRecords: [row] });
  const finalized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot: day, finalizedAt: capturedAt }).record, exported = buildAutomaticDayExportPayload({ date: DATE, exportedAt: capturedAt, daySnapshot: day });
  for (const v of [daily.areas[AREA].areaCountDecisionBasis, review.areas[AREA].areaCountDecisionBasis, finalized.sessions[0].areas[AREA].areaCountDecisionBasis, finalized.areaCountRecords[0].decisionBasis, exported.daySnapshot.sessions[0].areas[AREA].areaCountDecisionBasis, exported.daySnapshot.areaCountRecords[0].decisionBasis]) { assertReference(v?.decreaseAdjustment); assert.equal(v?.finalEvaluation, saved.finalEvaluation); assert.equal(v?.areaRateAdjustment, saved.areaRateAdjustment); }
  assert.equal(exported.dataSchemaVersion, 3); assert.deepEqual(exported.daySnapshot.areaCountRecords[0].decisionBasis?.decreaseAdjustment, saved.decreaseAdjustment);
});
for (const [previous, label] of [[200, "良い"], [100, "普通"], [60, "悪い"]] as const) await test(`full hook ${label} reference preserves rates through real quick lower/higher, undo and manual selection`, async () => {
  const rows = history(AREA, previous), saved = referenceBasis(rows), value = await mounted({ raw: sessionState({ savedBasis: saved }), records: rows });
  try {
    assert.match(value.panelText(), new RegExp(`減少率判定：${label}`)); noControls(value);
    const originalRates = json(value.app.derived.rateDisplay), originalState = json(value.app.state);
    await value.act(() => value.app.actions.applyAreaEvaluationAdjustment("lower"));
    assert.equal(value.app.state.areaProgressMap[AREA].areaCountEvaluation, "slightly_few"); assert.equal(value.app.state.areaProgressMap[AREA].humanEvaluationDetails?.evaluationAdjustment?.originalEvaluation, "normal");
    assertReference(value.app.state.areaProgressMap[AREA].areaCountDecisionBasis?.decreaseAdjustment);
    await value.act(() => value.app.actions.undoLastAction()); assert.deepEqual(json(value.app.state), originalState); assert.deepEqual(json(value.app.derived.rateDisplay), originalRates);
    await value.act(() => value.app.actions.applyAreaEvaluationAdjustment("higher")); assert.equal(value.app.state.areaProgressMap[AREA].areaCountEvaluation, "slightly_many");
    await value.act(() => value.app.actions.applyAreaEvaluationAdjustment("lower")); assert.equal(value.app.state.areaProgressMap[AREA].areaCountEvaluation, "slightly_few");
    await value.act(() => value.app.actions.judgeCurrentArea("normal", 50, "many")); assert.equal(value.app.state.areaProgressMap[AREA].areaCountEvaluation, "many"); assert.equal(value.app.state.areaProgressMap[AREA].areaRateAdjustment, 10); noControls(value);
  } finally { value.close(); }
});
await test("legacy confirmed rate snapshot, raw pair and saved correction remain unchanged on render/restore; fresh quick uses residual base", async () => {
  const saved = basis({ direction: "more_many", previousCount: 100, currentDecreaseRate: 0.3, medianDecreaseRate: 0.5 }); saved.finalEvaluation = "slightly_many"; saved.areaRateAdjustment = 5; saved.medianCount = 70;
  const raw = sessionState({ count: 70, savedBasis: saved }); raw.areaProgressMap[AREA].completedManyRateText = "35%"; raw.areaProgressMap[AREA].completedNormalRateText = "25%";
  raw.areaProgressMap[AREA].rateDecisionSnapshot = buildRateDecisionSnapshot({ confirmedAt: new Date(at("17:00:00")).toISOString(), sessionDiscountTime: "17", effectiveRateDiscountTime: "17", calculationMode: "normal", weatherComfortAdjustmentPercent: 0, areaJudge: "normal", areaRateAdjustment: 5, resolvedWeather: resolveWeatherInputForDiscount(raw.session!.weather, "17"), weekday: 2, date: DATE });
  raw.areaProgressMap[AREA].rateDecisionSnapshotStatus = "captured";
  const value = await mounted({ raw, records: history(AREA, 999) });
  try {
    const progress = json(value.app.state.areaProgressMap[AREA]), rates = json(value.app.derived.rateDisplay);
    value.render(); assert.deepEqual(json(value.app.state.areaProgressMap[AREA]), progress); assert.deepEqual(json(value.app.derived.rateDisplay), rates); noControls(value);
    assert.equal(Object.hasOwn(value.app.state.areaProgressMap[AREA].areaCountDecisionBasis!.decreaseAdjustment!, "mode"), false);
    await value.act(() => value.app.actions.applyAreaEvaluationAdjustment("lower")); assert.equal(value.app.state.areaProgressMap[AREA].areaCountEvaluation, "slightly_few");
    assert.equal(value.app.state.areaProgressMap[AREA].humanEvaluationDetails?.evaluationAdjustment?.originalEvaluation, "normal");
    await value.act(() => value.app.actions.undoLastAction()); assert.deepEqual(json(value.app.state.areaProgressMap[AREA]), progress);
  } finally { value.close(); }
});
await test("real keypad correction after restoring a legacy suppressed record starts reference mode without reapplying decrease", async () => {
  const saved = basis({ direction: "more_many", suppressed: true, suppressionReason: "additional_production" });
  const rows = history(AREA, 100, 20, 100), value = await mounted({ raw: sessionState({ count: 20, savedBasis: saved }), records: rows });
  try {
    await value.act(() => value.app.actions.startAreaCountCorrection(AREA));
    await value.click("電卓を1文字削除"); await value.click("電卓を1文字削除"); await value.click("1"); await value.click("8"); await value.click("完了");
    const p = value.app.state.areaProgressMap[AREA]; assert.equal(p.areaCount, 18); assert.equal(p.areaCountEvaluation, "slightly_few"); assert.equal(p.areaCountDecisionBasis?.baseEvaluation, "slightly_few");
    assertReference(p.areaCountDecisionBasis?.decreaseAdjustment); assert.equal(p.areaCountDecisionBasis?.decreaseAdjustment?.suppressed, undefined); noControls(value);
    const savedState = json(value.app.state); value.close(); const restored = await mounted({ raw: savedState, records: history(AREA, 5000, 1, 5000) });
    try { assert.deepEqual(json(restored.app.state.areaProgressMap[AREA]), json(savedState.areaProgressMap[AREA])); noControls(restored); } finally { restored.close(); }
  } finally { value.close(); }
});
await test("SSR and routed active screens show separate prominent good/bad labels, including negative-rate bad, with no retired controls", async () => {
  for (const [count, previous, label] of [[50, 200, "良い"], [50, 60, "悪い"], [150, 100, "悪い"]] as const) {
    const rows = history(AREA, previous), raw = sessionState({ count, savedBasis: referenceBasis(rows, count) }), value = await mounted({ raw, records: rows });
    try {
      for (const screen of ["rate_display", "area_judge", "auto_skip_notice", "auto_skip_count"] as const) { value.replaceState({ ...value.app.state, screen }); assert.match(value.panelText(), new RegExp(`減少率判定：${label}`)); noControls(value); }
      const badge = value.nodes.find(n => n.props["data-decrease-assessment"] === label); assert.ok(badge); assert.equal(typeof badge.props.style, "object");
      if (count > previous) { assert.match(value.panelText(), /−50\.0％/); assert.match(value.panelText(), /増加/); assert.match(value.panelText(), /減少率判定：悪い/); }
      const markup = renderToStaticMarkup(React.createElement(Router, { app: value.app })); assert.match(markup.replace(/<[^>]*>/g, ""), new RegExp(`減少率判定：${label}`)); assert.doesNotMatch(markup, /追加製造あり・補正を取り消す|補正を戻す/);
    } finally { value.close(); }
  }
});
await test("63 priority uses the final adopted result and cannot promote a raw bad reference or old base", () => {
  const state = sessionState(), p = state.areaProgressMap[AREA]; p.status = "skipped_manual";
  p.areaCountEvaluation = "normal"; p.areaCountDecisionBasis = { ...referenceBasis(history(), 70), baseEvaluation: "many", finalEvaluation: "many" };
  assert.equal(getAdoptedEvaluation(p), "normal");
  const inputs = { areaProgressMap: state.areaProgressMap, referenceAreaId: "tempura" as AreaId, normalFlowOrder: [AREA, "tempura"] as AreaId[], session: state.session };
  assert.equal(getNextPriorityPendingCandidate(inputs), null);
  p.areaCountEvaluation = "slightly_many"; p.areaCountDecisionBasis.decreaseAdjustment!.direction = "more_few";
  assert.equal(getNextPriorityPendingCandidate(inputs)?.areaId, AREA);
});

await test("legacy quick bases use captured median for good, bad and clamped endpoints; no median never guesses an old quick", async () => {
  for (const [residual, oldAuto, median, count, direction] of [["normal", "slightly_many", 50, 50, "more_many"], ["normal", "slightly_few", 50, 50, "more_few"], ["many", "many", 20, 50, "more_many"]] as const) {
    const saved = basis({ direction }), initial = createAreaEvaluationQuickAdjustment(oldAuto, "lower")!;
    saved.baseEvaluation = oldAuto; saved.medianCount = median; saved.finalEvaluation = initial.finalEvaluation; saved.areaRateAdjustment = evaluationToRateAdjustment(initial.finalEvaluation);
    const raw = sessionState({ count, savedBasis: saved }), p = raw.areaProgressMap[AREA]; p.areaCountEvaluationSource = "manual";
    p.humanEvaluationDetails = { ...resolveHumanEvaluationForDiscount({ selection: createHumanEvaluationSelection(initial.finalEvaluation)!, demandCycle: "normal", sessionDiscountTime: "17", nowMs: at("17:10:00"), evaluatedAt: new Date(at("17:10:00")).toISOString() }), automaticEvaluation: oldAuto, evaluationAdjustment: initial };
    assert.equal(getAreaEvaluationQuickAdjustmentBase({ discountTime: "17", progress: p }), residual);
    const before = json(normalizeLoadedState(raw).areaProgressMap[AREA]), value = await mounted({ raw, records: history(AREA, 100) });
    try { assert.deepEqual(json(value.app.state.areaProgressMap[AREA]), before); await value.act(() => value.app.actions.applyAreaEvaluationAdjustment("lower"));
      assert.equal(value.app.state.areaProgressMap[AREA].humanEvaluationDetails?.evaluationAdjustment?.originalEvaluation, residual);
      assert.equal(value.app.state.areaProgressMap[AREA].areaCountEvaluation, residual === "many" ? "slightly_many" : "slightly_few"); assertReference(value.app.state.areaProgressMap[AREA].areaCountDecisionBasis?.decreaseAdjustment);
    } finally { value.close(); }
    delete saved.medianCount; const ambiguous = raw.areaProgressMap[AREA];
    assert.equal(getAreaEvaluationQuickAdjustmentBase({ discountTime: "17", progress: ambiguous }), undefined);
    assert.deepEqual(getAreaEvaluationQuickAdjustments({ screen: "rate_display", discountTime: "17", isTestMode: false, now: new Date(at("17:10:00")), progress: ambiguous }), []);
  }
});
await test("missing, nonfinite median and wrong prior time never receive a guessed good/bad badge", async () => {
  for (const direction of ["more_few", "more_many"] as const) for (const patch of [{ medianDecreaseRate: undefined }, { medianDecreaseRate: Number.NaN }, { medianDecreaseRate: Number.POSITIVE_INFINITY }, { previousDiscountTime: "17" as const }]) {
    const saved = referenceBasis(history()); Object.assign(saved.decreaseAdjustment!, { direction }, patch);
    const display = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 50, decreaseAdjustment: saved.decreaseAdjustment })!;
    assert.ok(!["良い", "悪い", "普通"].includes(display.assessmentText)); assertCleanDisplay(JSON.stringify(display));
    const value = await mounted({ raw: sessionState({ savedBasis: saved }), records: history() });
    try { const panel = value.nodes.find(n => n.props["aria-label"] === "現在のエリア残数と減少率")!;
      assert.equal(panel.props["data-decrease-highlight"], undefined); assert.ok(!value.nodes.some(n => n.props["data-decrease-badge"] === "good" || n.props["data-decrease-badge"] === "bad")); noControls(value);
    } finally { value.close(); }
  }
});
await test("a non17 context cannot highlight captured reference data", async () => {
  const value = await mounted({ raw: sessionState({ time: "15", savedBasis: referenceBasis(history(AREA, 60)) }), records: history() });
  try { const panel = value.nodes.find(n => n.props["aria-label"] === "現在のエリア残数と減少率")!; assert.equal(panel.props["data-decrease-highlight"], undefined); assert.match(value.panelText(), /判定なし/); noControls(value); } finally { value.close(); }
});

await test("numeric before/after example uses actual rate presentation for good/bad reference at identical count and median", () => {
  const rows = history(), rec = recommendation(rows), now = sessionState({ savedBasis: referenceBasis(rows) });
  const after = displayedRates(now); assert.equal(after.normal.main, "10%"); assert.equal(after.many.main, "20%");
  const examples = [];
  for (const [label, oldEvaluation] of [["良い", "slightly_few"], ["悪い", "slightly_many"]] as const) {
    const old = sessionState({ savedBasis: { ...basis(), medianCount: 50, finalEvaluation: oldEvaluation, areaRateAdjustment: evaluationToRateAdjustment(oldEvaluation) } });
    const before = displayedRates(old); assert.equal(before.normal.main, label === "良い" ? "5%" : "15%"); assert.equal(before.many.main, label === "良い" ? "15%" : "25%");
    examples.push({ label, count: 50, median: rec.medianCount, before: { normal: before.normal.main, many: before.many.main }, after: { normal: after.normal.main, many: after.many.main } });
  }
  console.log("NUMERIC64: " + JSON.stringify(examples));
});

saveSummary(true);
console.log(`Decrease reference64 checks passed: ${results.length}/${results.length}`);
