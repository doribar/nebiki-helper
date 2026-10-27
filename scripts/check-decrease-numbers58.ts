import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { AREA_COUNT_LOCAL_STORAGE_KEY, loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import * as storage from "../src/domain/storage.ts";
import { getAreaDecreaseDisplay } from "../src/domain/areaDecreaseDisplay.ts";
import { buildAreaCountDecisionBasis, getActualWeekdayLabel, getAreaCountFallbackWeekdayGroup, getAreaCountRecommendation, getAreaCountFormalObservation, type AreaCountDecisionBasis, type AreaCountRecord } from "../src/domain/areaCountHistory.ts";
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
  setInterval() { assert.fail("58 must reuse the shared aligned timeout clock"); }, clearInterval() {},
  location: { search: "", hash: "", href: "http://decrease58.invalid/", pathname: "/" },
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

const TARGETS: AreaId[] = ["bento_men", "tempura", "onigiri", "inari", "hosomaki", "ryomi", "autumn", "yakitori"];
const EXCLUDED: AreaId[] = ["croquette", "fry_chicken", "chuka_fish", "sushi", "futomaki_chumaki", "balance_bento"];
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
  writeFileSync(new URL("../../tests58-summary.json", import.meta.url), JSON.stringify({ passed, passedCases: results.length,
    totalCases: results.length + (failure ? 1 : 0), evidence: "Actual production domain functions, full useNebikiApp hook, AppRouter and TSX host tree with real UI event handlers. Browser paint and transport are verified separately.",
    ...(failure ? { failure } : {}), cases: results }, null, 2) + "\n");
  writeFileSync(new URL("../../tests58.log", import.meta.url), [...logLines, ...(failure ? [`FAIL ${failure}`] : [])].join("\n") + "\n");
}
async function test(name: string, run: () => void | Promise<void>) {
  try { await run(); clean(); } catch (error) { saveSummary(false, `${name}: ${String(error)}`); throw error; }
  results.push({ name, ok: true }); const line = `PASS ${String(results.length).padStart(2, "0")}: ${name}`; logLines.push(line); console.log(line);
}

await test("all eligible areas display the actual transition and one decimal saved median", () => {
  for (const areaId of TARGETS) {
    const adopted = decrease({ previousCount: 100, currentDecreaseRate: 0.5, medianDecreaseRate: 0.17142857142857143, direction: "more_few" });
    const before = structuredClone(adopted);
    const display = getAreaDecreaseDisplay({ areaId, discountTime: "17", areaCount: 50, decreaseAdjustment: Object.freeze(adopted) });
    assert.ok(display); assert.equal(display.transitionText, "15時100個 → 17時50個"); assert.equal(display.rateText, "50.0％");
    assert.equal(display.medianText, "履歴中央値：17.1％"); assert.equal(display.assessmentText, "良い"); assert.equal(display.isIncrease, false);
    assert.deepEqual(adopted, before); assertCleanDisplay(JSON.stringify(display));
  }
});
await test("raw classification remains independent of rounded percentage text", () => {
  const prev = 10_000_000, historyRows = history(AREA, prev, 5_000_000, prev);
  for (const [count, expected] of [[7_000_001, "悪い"], [7_000_000, "悪い"], [6_999_999, "普通"], [3_000_001, "普通"], [3_000_000, "良い"], [2_999_999, "良い"]] as const) {
    const rec = getAreaCountRecommendation({ records: historyRows, areaId: AREA, discountTime: "17", count, date: DATE, weekday: 2, demandCycle: "normal" });
    const display = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: count, decreaseAdjustment: rec.decreaseRecommendation });
    assert.ok(display); assert.equal(display.assessmentText, expected); assert.equal(display.rateText, count > 5_000_000 ? "30.0％" : "70.0％");
  }
});
await test("excluded areas show measured percentages without acquiring median correction", () => {
  for (const areaId of EXCLUDED) {
    const rec = getAreaCountRecommendation({ records: history(areaId), areaId, discountTime: "17", count: 50, date: DATE, weekday: 2, demandCycle: "normal" });
    const before = structuredClone(rec), saved = buildAreaCountDecisionBasis({ recommendation: rec });
    assert.equal(rec.decreaseRecommendation?.canUse, false);
    const display = getAreaDecreaseDisplay({ areaId, discountTime: "17", areaCount: 50, previousCount: 100, decreaseAdjustment: saved.decreaseAdjustment });
    assert.ok(display); assert.equal(display.rateText, "50.0％"); assert.equal(display.assessmentText, "補正対象外"); assert.equal(display.medianText, undefined);
    assert.deepEqual(rec, before, "display never changes canUse, evaluation or adjustment");
  }
});
await test("eligible measured pair without historical evidence states history shortage", () => {
  const display = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 29, previousCount: 100,
    decreaseAdjustment: { canUse: false, sampleSize: 2, requiredSampleSize: 3, direction: "none" } });
  assert.ok(display); assert.equal(display.rateText, "71.0％"); assert.equal(display.assessmentText, "履歴不足"); assert.equal(display.medianText, "履歴中央値：履歴不足");
});
await test("zero current count is a complete decrease and negative rate is an explicit increase", () => {
  const zero = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 0, previousCount: 22 });
  assert.equal(zero?.rateText, "100.0％"); assert.equal(zero?.transitionText, "15時22個 → 17時0個");
  const increase = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 29, previousCount: 22 });
  assert.equal(increase?.rateText, "−31.8％"); assert.equal(increase?.assessmentText, "増加"); assert.equal(increase?.isIncrease, true);
  assertCleanDisplay(JSON.stringify([zero, increase]));
});
await test("previous missing, invalid or zero cannot fabricate a percentage", () => {
  for (const previousCount of [undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const display = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 29, previousCount });
    assert.ok(display); assert.equal(display.rateText, "算出不可");
    assert.equal(display.assessmentText, previousCount === undefined ? "比較元なし" : "算出不可"); assertCleanDisplay(JSON.stringify(display));
  }
});
await test("captured raw prior/rate/median outrank fresh history and do not mutate", () => {
  const adopted = decrease({ previousCount: 99, currentDecreaseRate: 0.123456789, medianDecreaseRate: 0.456789, direction: "more_many" });
  const display = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 20, previousCount: 22, decreaseAdjustment: adopted });
  assert.equal(display?.transitionText, "15時99個 → 17時20個"); assert.equal(display?.rateText, "12.3％"); assert.equal(display?.medianText, "履歴中央値：45.7％"); assert.equal(display?.assessmentText, "悪い");
  assert.deepEqual(adopted, decrease({ previousCount: 99, currentDecreaseRate: 0.123456789, medianDecreaseRate: 0.456789, direction: "more_many" }));
});
await test("captured invalid pair cannot be silently repaired from a newer valid observation", () => {
  for (const patch of [{ previousCount: 0 }, { previousCount: -1 }, { previousCount: Number.NaN }, { currentDecreaseRate: Number.NaN }, { currentDecreaseRate: Number.POSITIVE_INFINITY }]) {
    const display = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 20, previousCount: 100, decreaseAdjustment: decrease(patch) });
    assert.equal(display?.rateText, "算出不可"); assert.equal(display?.assessmentText, "算出不可"); assertCleanDisplay(JSON.stringify(display));
  }
});
await test("legacy captured rate without its comparison count is unavailable and cannot use fresh history", () => {
  const captured = decrease({ currentDecreaseRate: 0.333333333 }); delete captured.previousCount;
  const display = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 20, previousCount: 100, decreaseAdjustment: captured });
  assert.equal(display?.rateText, "算出不可"); assert.equal(display?.assessmentText, "算出不可"); assert.equal(display?.transitionText, "15時不明 → 17時20個");
});
await test("legacy ready evidence preserves raw classification and explicitly marks an unsaved median", () => {
  for (const [direction, expected] of [["more_many", "悪い"], ["more_few", "良い"], ["none", "普通"]] as const) {
    for (const medianDecreaseRate of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const display = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 50, decreaseAdjustment: decrease({ direction, medianDecreaseRate }) });
      assert.equal(display?.rateText, "50.0％"); assert.equal(display?.assessmentText, expected); assert.equal(display?.medianText, "履歴中央値：未保存"); assertCleanDisplay(JSON.stringify(display));
    }
  }
});
await test("tiny signed rates and invalid medians do not leak negative zero, NaN or Infinity", () => {
  for (const rate of [0, -0, -0.000001, 0.000001]) {
    const display = getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount: 100, decreaseAdjustment: decrease({ currentDecreaseRate: rate, medianDecreaseRate: Number.NaN }) });
    assert.equal(display?.rateText, "0.0％"); assertCleanDisplay(JSON.stringify(display));
  }
});
await test("15-time and retired time data never presents a 15-to-17 comparison", () => {
  for (const discountTime of ["15", "18", "19", "20"] as const) assert.equal(getAreaDecreaseDisplay({ areaId: AREA, discountTime, areaCount: 50, previousCount: 100, decreaseAdjustment: decrease() }), null);
  for (const areaCount of [undefined, null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(getAreaDecreaseDisplay({ areaId: AREA, discountTime: "17", areaCount, previousCount: 100 }), null);
});

await test("formal observation lookup is read-only and selects the actual day, time and area", () => {
  const rows = [record("2026-09-07", AREA, "15", 999), record(DATE, "onigiri", "15", 888), record(DATE, AREA, "17", 777), record(DATE, AREA, "15", 22)];
  const before = structuredClone(rows), found = getAreaCountFormalObservation({ records: rows, date: DATE, areaId: AREA, discountTime: "15" });
  assert.equal(found?.count, 22); assert.notEqual(found, rows.at(-1)); assert.deepEqual(rows, before);
  assert.equal(getAreaCountFormalObservation({ records: rows, date: "2026-09-06", areaId: AREA, discountTime: "15" }), null);
  for (const count of [-1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(getAreaCountFormalObservation({ records: [record(DATE, AREA, "15", count)], date: DATE, areaId: AREA, discountTime: "15" }), null);
});

await test("full hook and routed operational screens retain the adopted pair over newer canonical history", async () => {
  const savedBasis = basis({ previousCount: 99, currentDecreaseRate: 0.123456789, medianDecreaseRate: 0.456789, direction: "more_many" });
  const raw = sessionState({ count: 20, savedBasis });
  const value = await mounted({ raw, records: history(AREA, 22) });
  const before = json(value.app.state.areaProgressMap[AREA]);
  try {
    for (const screen of ["rate_display", "area_judge", "auto_skip_notice", "auto_skip_count"] as const) {
      value.replaceState({ ...value.app.state, screen });
      assert.match(value.panelText(), /15時99個 → 17時20個/); assert.match(value.panelText(), /12\.3％/); assert.match(value.panelText(), /履歴中央値：45\.7％/);
      assert.deepEqual(json(value.app.state.areaProgressMap[AREA]), before); assertCleanDisplay(value.panelText());
    }
    assert.equal(value.app.derived.areaCountDecreaseDisplayContext?.previousCount, 22);
  } finally { value.close(); }
});
await test("real suppressed count correction submits a new pair and returning retains its saved evidence", async () => {
  const rows = history(AREA, 22, 11, 22), adopted = getAreaCountRecommendation({ records: rows, areaId: AREA, discountTime: "17", count: 20, date: DATE, weekday: 2, demandCycle: "normal" });
  const raw = sessionState({ count: 20, savedBasis: buildAreaCountDecisionBasis({ recommendation: adopted, evaluationSource: "history", finalEvaluation: adopted.suggestedEvaluation, areaRateAdjustment: adopted.areaRateAdjustment }) });
  const value = await mounted({ raw, records: rows });
  try {
    await value.click("追加製造あり・補正を取り消す");
    await value.act(() => value.app.actions.startAreaCountCorrection(AREA));
    assert.equal(value.app.state.screen, "area_judge");
    await value.click("電卓を1文字削除"); await value.click("電卓を1文字削除"); await value.click("1"); await value.click("8"); await value.click("完了");
    assert.equal(value.app.state.areaProgressMap[AREA].areaCount, 18);
    assert.match(value.panelText(), /15時22個 → 17時18個/); assert.match(value.panelText(), /18\.2％/); assert.match(value.panelText(), /履歴中央値：50\.0％/);
    assert.equal(value.app.state.areaProgressMap[AREA].areaCountDecisionBasis?.decreaseAdjustment?.currentDecreaseRate, (22 - 18) / 22);
    await value.act(() => value.app.actions.goBackOneScreen()); assert.match(value.panelText(), /17時18個/); assert.doesNotMatch(value.panelText(), /17時20個/);
  } finally { value.close(); }
});
await test("ordinary correction and history back preserve the existing atomic count and basis restoration", async () => {
  const rows = history(AREA, 22, 11, 22), adopted = getAreaCountRecommendation({ records: rows, areaId: AREA, discountTime: "17", count: 20, date: DATE, weekday: 2, demandCycle: "normal" });
  const value = await mounted({ raw: sessionState({ count: 20, savedBasis: buildAreaCountDecisionBasis({ recommendation: adopted, evaluationSource: "history", finalEvaluation: adopted.suggestedEvaluation, areaRateAdjustment: adopted.areaRateAdjustment }) }), records: rows });
  try {
    await value.act(() => value.app.actions.startAreaCountCorrection(AREA));
    await value.click("電卓を1文字削除"); await value.click("電卓を1文字削除"); await value.click("1"); await value.click("8"); await value.click("完了");
    assert.equal(value.app.state.areaProgressMap[AREA].areaCount, 18); assert.match(value.panelText(), /17時18個/); assert.match(value.panelText(), /18\.2％/);
    await value.act(() => value.app.actions.goBackOneScreen());
    assert.equal(value.app.state.areaProgressMap[AREA].areaCount, 20); assert.match(value.panelText(), /17時20個/); assert.match(value.panelText(), /9\.1％/); assert.doesNotMatch(value.panelText(), /17時18個|18\.2％/);
  } finally { value.close(); }
});
await test("AutoSkipCount real input edits display the entered count without reusing a different saved ratio", async () => {
  const value = await mounted({ raw: sessionState({ count: 20, savedBasis: basis({ previousCount: 99, currentDecreaseRate: 0.123456789, medianDecreaseRate: 0.456789 }) }), records: history(AREA, 22) });
  try {
    value.replaceState({ ...value.app.state, screen: "auto_skip_count" });
    assert.match(value.panelText(), /15時99個 → 17時20個/); assert.match(value.panelText(), /12\.3％/);
    value.changeInput("auto-skip-area-count", "29");
    assert.match(value.panelText(), /エリア残数：29個/); assert.match(value.panelText(), /15時22個 → 17時29個/); assert.match(value.panelText(), /−31\.8％/); assert.match(value.panelText(), /増加/);
    assert.doesNotMatch(value.panelText(), /12\.3％|45\.7％/); assert.equal(value.app.state.areaProgressMap[AREA].areaCount, 20, "editing preview does not persist a new count");
    value.changeInput("auto-skip-area-count", "20"); assert.match(value.panelText(), /15時99個 → 17時20個/); assert.match(value.panelText(), /12\.3％/);
    value.changeInput("auto-skip-area-count", "0"); assert.match(value.panelText(), /17時0個/); assert.match(value.panelText(), /100\.0％/);
    value.changeInput("auto-skip-area-count", ""); assert.equal(value.panelText(), "");
  } finally { value.close(); }
});
await test("AreaJudge real submitted phase cannot carry the prior area's input into a new area", async () => {
  const raw = sessionState({ screen: "area_judge", count: 20, savedBasis: basis({ previousCount: 99, currentDecreaseRate: 0.123456789 }) });
  Object.assign(raw.areaProgressMap.onigiri, { areaCount: 7, areaJudge: "normal", areaCountDecisionBasis: basis({ previousCount: 33, currentDecreaseRate: 26 / 33, medianDecreaseRate: 0.625 }) });
  const value = await mounted({ raw, records: [record(DATE, AREA, "15", 22), record(DATE, "onigiri", "15", 44)] });
  try {
    await value.click("完了"); assert.equal(value.app.state.screen, "area_judge"); assert.match(value.panelText(), /15時22個 → 17時20個/); assert.match(value.panelText(), /9\.1％/);
    for (const [id, timer] of timeouts) if (timer.delay === 0) { timeouts.delete(id); timer.callback(); }
    value.replaceState({ ...value.app.state, currentAreaId: "onigiri", lastReferenceAreaId: "onigiri" });
    assert.match(value.panelText(), /15時33個 → 17時7個/); assert.match(value.panelText(), /78\.8％/); assert.match(value.panelText(), /履歴中央値：62\.5％/); assert.doesNotMatch(value.panelText(), /17時20個|9\.1％/);
  } finally { value.close(); }
});
await test("real suppression and restore keep the raw percentage, transition and median through both rate steps", async () => {
  const rows = history(AREA, 100), adopted = getAreaCountRecommendation({ records: rows, areaId: AREA, discountTime: "17", count: 70, date: DATE, weekday: 2, demandCycle: "normal" });
  const raw = sessionState({ count: 70, savedBasis: buildAreaCountDecisionBasis({ recommendation: adopted, evaluationSource: "history", finalEvaluation: adopted.suggestedEvaluation, areaRateAdjustment: adopted.areaRateAdjustment }) });
  const value = await mounted({ raw, records: rows });
  try {
    const rawEvidence = json(value.app.state.areaProgressMap[AREA].areaCountDecisionBasis?.decreaseAdjustment);
    await value.click("追加製造あり・補正を取り消す");
    assert.match(value.panelText(), /15時100個 → 17時70個/); assert.match(value.panelText(), /30\.0％/); assert.match(value.panelText(), /履歴中央値：50\.0％/); assert.match(value.panelText(), /取り消し済み/);
    await value.click("終わった"); assert.match(value.panelText(), /30\.0％/);
    await value.click("補正を戻す"); assert.deepEqual(value.app.state.areaProgressMap[AREA].areaCountDecisionBasis?.decreaseAdjustment, rawEvidence);
    assert.match(value.panelText(), /30\.0％/); assert.match(value.panelText(), /履歴中央値：50\.0％/);
  } finally { value.close(); }
});
await test("reload restores saved display values rather than recalculating from changed historical observations", async () => {
  const raw = sessionState({ count: 20, savedBasis: basis({ previousCount: 99, currentDecreaseRate: 0.123456789, medianDecreaseRate: 0.456789, direction: "more_many" }) });
  let value = await mounted({ raw, records: history(AREA, 22) });
  let saved: AppState;
  try { assert.match(value.panelText(), /12\.3％/); saved = json(value.app.state); } finally { value.close(); }
  value = await mounted({ raw: saved!, records: history(AREA, 1000, 1, 1000) });
  try { assert.match(value.panelText(), /15時99個 → 17時20個/); assert.match(value.panelText(), /12\.3％/); assert.match(value.panelText(), /履歴中央値：45\.7％/); } finally { value.close(); }
});
await test("routed excluded area displays the actual pair while keeping its saved evaluation and rates", async () => {
  const areaId: AreaId = "croquette", rows = history(areaId, 22), adopted = getAreaCountRecommendation({ records: rows, areaId, discountTime: "17", count: 29, date: DATE, weekday: 2, demandCycle: "normal" });
  const savedBasis = buildAreaCountDecisionBasis({ recommendation: adopted, evaluationSource: "history", finalEvaluation: adopted.suggestedEvaluation, areaRateAdjustment: adopted.areaRateAdjustment });
  const value = await mounted({ raw: sessionState({ areaId, count: 29, savedBasis }), records: rows });
  try {
    const progress = json(value.app.state.areaProgressMap[areaId]), rates = json(value.app.derived.rateDisplay);
    assert.match(value.panelText(), /15時22個 → 17時29個/); assert.match(value.panelText(), /−31\.8％/); assert.match(value.panelText(), /増加/); assert.match(value.panelText(), /補正対象外/);
    assert.doesNotMatch(value.panelText(), /履歴中央値|取り消す/); assert.equal(value.app.state.areaProgressMap[areaId].areaCountDecisionBasis?.decreaseAdjustment?.canUse, false);
    await value.click("終わった"); assert.deepEqual(json(value.app.state.areaProgressMap[areaId]), progress); assert.deepEqual(json(value.app.derived.rateDisplay), rates);
  } finally { value.close(); }
});
await test("routed 15-time current count has no 15-to-17 numeric or median display", async () => {
  const value = await mounted({ raw: sessionState({ time: "15", count: 50, savedBasis: basis() }), records: history() });
  try { assert.equal(value.app.derived.areaCountDecreaseDisplayContext, null); assert.doesNotMatch(value.panelText(), /15時\d+個 → 17時|履歴中央値/); } finally { value.close(); }
});
await test("routed missing and zero previous observations are unavailable while valid current zero remains 100 percent", async () => {
  for (const [previous, count, expected] of [[undefined, 29, "算出不可"], [0, 29, "算出不可"], [22, 0, "100.0％"]] as const) {
    const rows = [record("2026-09-07", AREA, "15", 999), ...(previous === undefined ? [] : [record(DATE, AREA, "15", previous)])];
    const value = await mounted({ raw: sessionState({ count }), records: rows });
    try {
      assert.match(value.panelText(), new RegExp(expected.replace(".", "\\."))); assertCleanDisplay(value.panelText()); assert.doesNotMatch(value.panelText(), /15時999個/);
      if (previous === undefined) assert.match(value.panelText(), /15時不明 → 17時29個/);
      if (previous === 0) assert.match(value.panelText(), /15時0個 → 17時29個/);
      if (count === 0) assert.match(value.panelText(), /15時22個 → 17時0個/);
    } finally { value.close(); }
  }
});
await test("display rendering does not write AreaCount records or add persistent schema fields", async () => {
  const rows = history(AREA, 100), value = await mounted({ raw: sessionState({ count: 50 }), records: rows });
  try {
    const before = json(loadLocalAreaCountRecords()); const writes = memory.writes.filter(key => key === AREA_COUNT_LOCAL_STORAGE_KEY).length;
    for (let index = 0; index < 3; index++) { value.render(); assert.match(value.panelText(), /15時100個 → 17時50個/); }
    assert.deepEqual(json(loadLocalAreaCountRecords()), before); assert.equal(memory.writes.filter(key => key === AREA_COUNT_LOCAL_STORAGE_KEY).length, writes);
    assert.doesNotMatch(JSON.stringify(value.app.state), /decreaseDisplayContext|areaCountDecreaseDisplayContext|transitionText|rateText|medianText/);
  } finally { value.close(); }
});

saveSummary(true);
console.log(`Decrease numbers 58 checks passed: ${results.length}/${results.length}`);
