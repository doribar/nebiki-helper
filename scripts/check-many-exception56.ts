import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { AREA_COUNT_LOCAL_STORAGE_KEY, loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import { loadPendingSupabaseSyncQueue } from "../src/domain/supabaseSyncQueue.ts";
import { createNavigationSnapshot } from "../src/domain/navigationHistory.ts";
import * as storage from "../src/domain/storage.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { setRuntimeNowOverride } from "../src/hooks/nebikiApp/clock.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";
import { createHumanEvaluationSelection, getLegacyHumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import type { AreaCountDecisionBasis } from "../src/domain/areaCountHistory.ts";
import type { AppState, AreaCountEvaluation, AreaId, DemandCycle, UseNebikiAppResult } from "../src/domain/types.ts";
import type { AppRouter } from "../src/app/AppRouter.tsx";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";

// Execute the real TSX tree, event handlers, complete business hook, aligned
// scheduler and synchronous persistence effects. Browser paint, IndexedDB
// hydration and actual Supabase transport are checked separately.
process.env.TZ = "Asia/Tokyo";
const NativeDate = Date, DATE = "2026-09-08", AREA = "bento_men";
const at = (clock: string) => new NativeDate(`${DATE}T${clock}+09:00`).getTime();
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const cutoff = (time: "15" | "17") => at(time === "15" ? "16:00:00" : "18:00:00");
let nowMs = at("15:00:00");
class FixtureDate extends NativeDate {
  constructor(value?: string | number | Date) { super(value === undefined ? nowMs : value); }
  static now() { return nowMs; }
}
Object.defineProperty(globalThis, "Date", { configurable: true, value: FixtureDate });
class MemoryStorage implements Storage {
  values = new Map<string, string>(); writes: string[] = []; removals: string[] = [];
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes.push(key); this.values.set(key, String(value)); }
  removeItem(key: string) { this.removals.push(key); this.values.delete(key); }
  clear() { this.values.clear(); this.writes = []; this.removals = []; }
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
const windowFixture = {
  addEventListener: windowEvents.addEventListener, removeEventListener: windowEvents.removeEventListener,
  setTimeout(callback: () => void, delay = 0) { const id = ++timerId; timeouts.set(id, { callback, delay, due: nowMs + delay }); return id; },
  clearTimeout(id: number) { timeouts.delete(id); },
  setInterval() { assert.fail("late operation must reuse the shared aligned timeout clock"); }, clearInterval() {},
  location: { search: "", hash: "", href: "http://many56.invalid/", pathname: "/" },
  confirm() { return true; }, scrollTo() {}, alert(message: string) { assert.fail(`Unexpected alert: ${message}`); },
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
const Rate = (await loadTsx(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url))).RateDisplayScreen as typeof RateDisplayScreen;
type Props = Record<string, unknown>;
type HostNode = { type: string; props: Props; children: Array<HostNode | string> };
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Instance = { type: unknown; slots: Slot[]; cursor: number };
const textOf = (node: HostNode | string): string => typeof node === "string" ? node : node.children.map(textOf).join("");
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) => a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const hookEffects = (text: string) => /app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|areaCompletionStateRef\.current|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|startAlignedRuntimeClock|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)|earlyNextMinus5TargetDiscountTime/.test(text);
// The production hook is called from a function component, just as in the app.
function FixtureApp({ fixture }: { fixture: AppFixture }) {
  const app = useNebikiApp({ testNow: fixture.fixedNow });
  fixture.capture(app);
  return React.createElement(Router, { app, testNow: fixture.fixedNow });
}
class AppFixture {
  instances = new Map<string, Instance>(); current: Instance | null = null;
  effects: Array<() => void> = []; dirty = true; renders = 0; nodes: HostNode[] = [];
  fixedNow: Date | null = null; app!: UseNebikiAppResult;
  root?: () => React.ReactNode;
  constructor(root?: () => React.ReactNode) { this.root = root; }
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
      if (!sameDeps(slot.deps, deps)) {
        slot.deps = deps;
        if (owner?.type === FixtureApp && !hookEffects(String(callback))) return;
        this.effects.push(() => { slot.cleanup?.(); const cleanup = callback(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; });
      }
    },
  };
  render() {
    this.dirty = true;
    for (let pass = 0; this.dirty; pass++) {
      assert.ok(pass < 25, "real component/hook synchronous effects converge");
      this.dirty = false; this.nodes = []; this.renders++;
      const visited = new Set<string>();
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown };
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
          const rendered = (value.type as (props: Props) => React.ReactNode)(value.props); this.current = outer;
          return expand(rendered, path + "/render");
        }
        assert.equal(typeof value.type, "string"); const node: HostNode = { type: value.type as string, props: value.props, children: [] }; this.nodes.push(node);
        node.children = expand(value.props.children as React.ReactNode, path + "/children"); return [node];
      };
      try { expand(this.root ? this.root() : React.createElement(FixtureApp, { fixture: this }), "root"); } finally { internals.H = previous; }
      for (const [key, instance] of this.instances) if (!visited.has(key)) { instance.slots.forEach(slot => slot.cleanup?.()); this.instances.delete(key); }
      const effects = this.effects; this.effects = []; effects.forEach(effect => effect());
    }
  }
  text() { return this.nodes.filter(node => node.type === "main").map(textOf).join(""); }
  button(label = "終わった") { const node = this.nodes.find(value => value.type === "button" && textOf(value) === label); assert.ok(node, `real button exists: ${label}`); return node; }
  async click(label = "終わった") { await invoke(this.button(label)); this.render(); }
  replaceState(nextState: AppState) { const instance = [...this.instances.values()].find(value => value.type === FixtureApp); assert.ok(instance); const slot = instance.slots.find(value => value.value === this.app.state); assert.ok(slot); slot.value = nextState; this.render(); }
  close() { this.instances.forEach(instance => instance.slots.forEach(slot => slot.cleanup?.())); this.instances.clear(); }
}
function invoke(node: HostNode) { assert.ok(!node.props.disabled); return (node.props.onClick as () => void | Promise<void>)(); }
function state(time: "15" | "17", cycle: DemandCycle, onlyLast = true): AppState {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const value of Object.values(hourlyForecasts)) Object.assign(value, { weather: "sunny", tempC: 29, windMs: 2 });
  const session = { ...getCurrentDataVersionInfo(), date: DATE, weekday: 2, discountTime: time, demandCycle: cycle, manualWeekdayOverride: false,
    manualDiscountTimeOverride: false, globalDiscountAdjustmentPercent: 0 as const, weather: { hourlyForecasts, afterRainSky: null }, startedAt: new NativeDate(at(`${time}:00:00`)).toISOString() };
  const value = createInitialState(session); value.session = session; value.screen = "rate_display"; value.currentAreaId = AREA;
  if (onlyLast) for (const progress of Object.values(value.areaProgressMap)) Object.assign(progress, {
    status: "completed", areaJudge: "normal", areaRateAdjustment: 0, completedAt: session.startedAt,
    completedRateText: "10%", completedNormalRateText: "10%", completedManyRateText: "20%",
  });
  Object.assign(value.areaProgressMap[AREA], { status: "unstarted", areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaCountEvaluationSource: "manual", areaRateAdjustment: 0 });
  return value;
}
function clean() {
  assert.equal(timeouts.size, 0, "all production timers disposed"); assert.equal(windowEvents.count("focus"), 0); assert.equal(documentEvents.count("visibilitychange"), 0);
  setRuntimeNowOverride(null); documentFixture.hidden = false;
}
function fixture(raw = adoptedState("normal"), timestamp = cutoff("15"), fixed = false, backHistory = false, historical: unknown[] = []) {
  clean(); memory.clear(); nowMs = timestamp;
  memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(raw)); memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(raw));
  if (historical.length) memory.values.set(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(historical));
  if (backHistory) {
    const previous = { ...json(raw), screen: "area_judge" as const };
    const navigation = createNavigationSnapshot({ state: previous, areaJudgeSelection: null, resumeTargetScreen: null, nextSessionSkipRecords: [], lastSessionWeather: null });
    memory.values.set(storage.STORAGE_KEYS.runtimeState, JSON.stringify({ areaJudgeSelection: null, resumeTargetScreen: null, timeSwitchTarget: null, undoSnapshot: null, screenHistory: [navigation], weatherConfirmationPending: null }));
  }
  const value = new AppFixture(); value.render();
  if (fixed) { value.fixedNow = new Date(timestamp); value.render(); }
  return value;
}
function adoptedState(evaluation: AreaCountEvaluation | undefined, cycle: DemandCycle = "normal", time: "15" | "17" = "15", onlyLast = true) {
  const raw = state(time, cycle, onlyLast); raw.areaProgressMap[AREA].areaCountEvaluation = evaluation; return raw;
}
function fireDueTimers() {
  const due = [...timeouts].filter(([, timer]) => timer.due <= nowMs); assert.ok(due.length, "shared clock fires");
  for (const [id, timer] of due) { timeouts.delete(id); timer.callback(); }
}
function assertAlignedTimer() { assert.equal(timeouts.size, 1); const timer = [...timeouts.values()][0]; assert.ok(timer.delay > 0 && timer.delay <= 30000); assert.equal(timer.due % 30000, 0); }
function assertMany(value: AppFixture, rate: number) { assert.match(value.text(), new RegExp(`多い商品を${rate}%値引きしてください。`)); assert.doesNotMatch(value.text(), /どちらでもない商品を[0-9]+%値引きしてください。/); }
function assertNormal(value: AppFixture, rate: number) { assert.match(value.text(), new RegExp(`どちらでもない商品を${rate}%値引きしてください。`)); assert.doesNotMatch(value.text(), /多い商品を[0-9]+%値引きしてください。/); }
function assertSuppressed(value: AppFixture) { assert.doesNotMatch(value.text(), /(?:多い|どちらでもない)商品を[0-9]+%値引きしてください。/); value.button(); if (!value.root) assert.equal(value.app.state.screen, "rate_display"); }
function persistence() { return { bytes: [...memory.values], writes: [...memory.writes], removals: [...memory.removals], records: loadLocalAreaCountRecords(), queue: loadPendingSupabaseSyncQueue(), daily: storage.loadDailySessionSnapshots(), skip: storage.loadNextSessionSkipRecords() }; }
const results: Array<{ name: string; ok: boolean }> = [], examples: unknown[] = [];
const logLines: string[] = [];
async function test(name: string, run: () => void | Promise<void>) {
  try { await run(); clean(); } catch (error) {
    writeFileSync(new URL("../../tests56-summary.json", import.meta.url), JSON.stringify({ passed: false, passedCases: results.length, totalCases: results.length + 1, notes: [`${name}: ${String(error)}`], cases: results }, null, 2) + "\n");
    throw error;
  }
  results.push({ name, ok: true }); const line = `PASS ${String(results.length).padStart(2, "0")}: ${name}`; logLines.push(line); console.log(line);
}

function assertUnfinished(value: AppFixture, id: AreaId = AREA) {
  assert.equal(value.app.state.currentAreaId, id); assert.equal(value.app.state.screen, "rate_display");
  assert.notEqual(value.app.state.areaProgressMap[id].status, "completed");
  assert.equal(value.app.state.areaProgressMap[id].rateDecisionSnapshot, undefined);
}
function assertSnapshot(value: AppFixture, evaluation: AreaCountEvaluation = "many", time: "15" | "17" = "15", bonus = 5, adjustment = 0) {
  const progress = value.app.state.areaProgressMap[AREA], snapshot = progress.rateDecisionSnapshot; assert.ok(snapshot);
  const normal = (time === "15" ? 0 : 10) + bonus + adjustment;
  assert.equal(snapshot.sessionDiscountTime, time); assert.equal(snapshot.effectiveRateDiscountTime, time);
  assert.equal(snapshot.calculationMode, bonus ? "late_plus5" : "normal"); assert.equal(snapshot.lateTimeAdjustmentPercent, bonus);
  assert.equal(snapshot.earlyNextAdjustmentPercent, 0); assert.equal(snapshot.areaCountAdjustmentPercent, adjustment);
  assert.deepEqual([snapshot.normalRatePercent, snapshot.manyRatePercent], [Math.max(0, normal), Math.max(0, normal + 10)]);
  assert.deepEqual([progress.completedNormalRateText, progress.completedManyRateText], [`${Math.max(0, normal)}%`, `${Math.max(0, normal + 10)}%`]);
  assert.equal(snapshot.confirmedAt, new NativeDate(nowMs).toISOString()); assert.equal(progress.areaCountEvaluation, evaluation);
  assert.equal(progress.status, "completed"); assert.equal(value.app.state.session?.discountTime, time);
  assert.deepEqual(storage.loadNextSessionSkipRecords(), []); return json(snapshot);
}
async function finish(value: AppFixture, stages = 2) {
  const id = value.app.state.currentAreaId; assert.ok(id);
  await value.click(); if (stages === 2) { assertUnfinished(value, id); await value.click(); }
  assert.equal(value.app.state.areaProgressMap[id].status, "completed"); assert.ok(value.app.state.areaProgressMap[id].rateDecisionSnapshot);
}
function basis(finalEvaluation?: AreaCountEvaluation, baseEvaluation: AreaCountEvaluation = "normal"): AreaCountDecisionBasis {
  return { ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 3, requiredSampleSize: 3,
    baseEvaluation, finalEvaluation, areaRateAdjustment: finalEvaluation === "many" ? 10 : finalEvaluation === "slightly_many" ? 5 : 0 };
}
const SKIP = "今はスキップ（画面左スワイプ）";

await test("public refreshRuntimeClock refreshes visible rates without completing, persisting or adding clocks", async () => {
  const value = fixture(adoptedState("many"), cutoff("15") - 1);
  try {
    await value.click(); assertNormal(value, 0); const before = json(value.app.state), persisted = persistence(); assertAlignedTimer();
    nowMs = cutoff("15"); value.app.actions.refreshRuntimeClock(); value.render();
    assertNormal(value, 5); assertUnfinished(value); assert.match(value.app.derived.basisGuide.referenceConditionLabel, /16時$/);
    assert.deepEqual(json(value.app.state), before); assert.deepEqual(persistence(), persisted); assertAlignedTimer();
    value.app.actions.refreshRuntimeClock(); value.render(); assert.deepEqual(json(value.app.state), before); assert.deepEqual(persistence(), persisted); assertAlignedTimer();
  } finally { value.close(); }
});

for (const cycle of ["normal", "summer"] as const) {
  for (const evaluation of ["many", "slightly_many", "normal", "slightly_few", "few", undefined] as const) {
    await test(`${cycle}/late15: adopted ${evaluation ?? "unknown"} requires ${evaluation === "many" ? "two" : "one"} explicit stages`, async () => {
      const value = fixture(adoptedState(evaluation, cycle));
      try {
        assertMany(value, 15); assert.match(value.app.derived.basisGuide.referenceConditionLabel, /16時$/);
        const button = value.button(); await invoke(button); await invoke(button); value.render();
        if (evaluation === "many") {
          assertUnfinished(value); assertNormal(value, 5); assertAlignedTimer(); await value.click();
        }
        assert.equal(value.app.state.screen, "done");
        const snapshot = value.app.state.areaProgressMap[AREA].rateDecisionSnapshot; assert.ok(snapshot);
        assert.equal(snapshot.lateTimeAdjustmentPercent, 5); assert.deepEqual([snapshot.normalRatePercent, snapshot.manyRatePercent], [5, 15]);
        assert.equal(Object.values(value.app.state.areaProgressMap).filter(p => p.rateDecisionSnapshot).length, 1);
      } finally { value.close(); }
    });
  }
  for (const delta of [-1, 0, 1]) await test(`${cycle}/many: exact16 boundary${delta === -1 ? "-1ms" : delta ? "+1ms" : ""} retains two stages and one captured bonus`, async () => {
    const value = fixture(adoptedState("many", cycle), cutoff("15") + delta);
    try {
      assertMany(value, delta < 0 ? 10 : 15); await value.click(); assertUnfinished(value); assertNormal(value, delta < 0 ? 0 : 5);
      await value.click(); examples.push({ cycle, delta, snapshot: assertSnapshot(value, "many", "15", delta < 0 ? 0 : 5) });
      assert.equal(value.app.state.screen, "done"); const daily = storage.loadDailySessionSnapshots().filter(record => record.session.startedAt === value.app.state.session?.startedAt);
      assert.equal(daily.length, 1); assert.deepEqual(json(daily[0].areas[AREA].rateDecisionSnapshot), json(value.app.state.areaProgressMap[AREA].rateDecisionSnapshot));
    } finally { value.close(); }
  });
  for (const trigger of ["focus", "visible", "timeout", "stale-click"] as const) await test(`${cycle}/many: open normal stage crosses16 by ${trigger} and remains actionable`, async () => {
    const value = fixture(adoptedState("many", cycle), cutoff("15") - 1);
    try {
      await value.click(); assertNormal(value, 0); const button = value.button(), saved = json(value.app.state), persisted = persistence(); nowMs = cutoff("15");
      if (trigger === "focus") windowEvents.emit("focus");
      if (trigger === "visible") documentEvents.emit("visibilitychange");
      if (trigger === "timeout") fireDueTimers();
      if (trigger !== "stale-click") {
        value.render(); assertNormal(value, 5); assertUnfinished(value); assert.deepEqual(json(value.app.state), saved); assert.deepEqual(persistence(), persisted);
      }
      await invoke(button); await invoke(button); value.render(); assert.equal(value.app.state.screen, "done"); assertSnapshot(value);
    } finally { value.close(); }
  });
  await test(`${cycle}/many: first-stage click sees16 before timer and refreshes the second-stage rate`, async () => {
    const value = fixture(adoptedState("many", cycle), cutoff("15") - 1, false);
    try {
      const old = value.button(); nowMs = cutoff("15"); await invoke(old); await invoke(old); value.render();
      assertNormal(value, 5); assertUnfinished(value); assertAlignedTimer(); await value.click(); assertSnapshot(value);
    } finally { value.close(); }
  });
  await test(`${cycle}/nonmany: open normal stage becomes neutral finish at16`, async () => {
    const value = fixture(adoptedState("slightly_many", cycle), cutoff("15") - 1);
    try { await value.click(); assertNormal(value, 0); nowMs = cutoff("15"); windowEvents.emit("focus"); value.render(); assertSuppressed(value); assertUnfinished(value); await value.click(); assertSnapshot(value, "slightly_many"); } finally { value.close(); }
  });
  for (const evaluation of ["many", "slightly_many", undefined] as const) await test(`${cycle}/17 ${evaluation ?? "unknown"}:18 keeps two stages and18 reference`, async () => {
    const value = fixture(adoptedState(evaluation, cycle, "17"), cutoff("17"));
    try {
      assertMany(value, 25); assert.match(value.app.derived.basisGuide.referenceText, /18時を基準に考えて/); assert.match(value.app.derived.basisGuide.referenceConditionLabel, /18時$/);
      await value.click(); assertUnfinished(value); assertNormal(value, 15); await value.click();
      assert.equal(value.app.state.screen, "done"); assert.equal(value.app.state.areaProgressMap[AREA].rateDecisionSnapshot?.lateTimeAdjustmentPercent, 5);
    } finally { value.close(); }
  });
}

for (const entry of [
  { name: "explicit adopted many beats human normal and basis normal", adopted: "many", human: "normal", final: "normal", expected: true },
  { name: "explicit adopted slightly_many beats human many and basis many", adopted: "slightly_many", human: "many", final: "many", expected: false },
  { name: "explicit adopted normal beats human many", adopted: "normal", human: "many", final: "many", expected: false },
  { name: "saved human resolved many is fallback before basis normal", adopted: undefined, human: "many", final: "normal", expected: true },
  { name: "saved human resolved slightly_many is fallback before basis many", adopted: undefined, human: "slightly_many", final: "many", expected: false },
  { name: "saved basis final many is last fallback", adopted: undefined, human: undefined, final: "many", expected: true },
  { name: "saved basis final slightly_many is one stage", adopted: undefined, human: undefined, final: "slightly_many", expected: false },
] as const) await test(`adopted source precedence: ${entry.name}`, async () => {
  const raw = adoptedState(entry.adopted), progress = raw.areaProgressMap[AREA]; progress.areaCountDecisionBasis = basis(entry.final, "many");
  if (entry.human) progress.humanEvaluationDetails = getLegacyHumanEvaluationDetails(entry.human);
  const value = fixture(raw);
  try { await value.click(); if (entry.expected) { assertNormal(value, 5); assertUnfinished(value); await value.click(); } assert.equal(value.app.state.screen, "done"); } finally { value.close(); }
});
for (const marker of ["areaJudge", "automatic", "base", "decreaseFlag", "rateAdjustment"] as const) await test(`unadopted ${marker} many cannot enable the exception`, async () => {
  const raw = adoptedState(undefined), progress = raw.areaProgressMap[AREA];
  if (marker === "areaJudge") progress.areaJudge = "many";
  if (marker === "automatic") progress.humanEvaluationDetails = { ...getLegacyHumanEvaluationDetails("normal"), resolvedEvaluation: undefined, automaticEvaluation: "many" };
  if (marker === "base") progress.areaCountDecisionBasis = basis(undefined, "many");
  if (marker === "decreaseFlag") progress.areaCountDecisionBasis = { ...basis(undefined), decreaseAdjustment: { canUse: true, sampleSize: 3, requiredSampleSize: 3, direction: "more_many", suppressed: true } };
  if (marker === "rateAdjustment") progress.areaRateAdjustment = 10;
  const value = fixture(raw);
  try { await value.click(); assert.equal(value.app.state.screen, "done"); assert.equal(value.app.state.areaProgressMap[AREA].status, "completed"); } finally { value.close(); }
});

function history(cycle: DemandCycle, median: number) {
  return ["2026-09-01", "2026-08-25", "2026-08-18"].map(date => ({ ...getCurrentDataVersionInfo(), date, demandCycle: cycle,
    sessionStartedAt: `${date}T15:00:00+09:00`, recordedAt: `${date}T15:00:00+09:00`, areaId: AREA, discountTime: "15", actualWeekday: "火", actualWeekdayGroup: "火木", count: median }));
}
for (const cycle of ["normal", "summer"] as const) for (const mode of ["automatic-many", "human-raised-many", "many-lowered-slightly"] as const) await test(`${cycle}: ${mode} uses final adopted judgment through real hook`, async () => {
  const raw = adoptedState(undefined, cycle); raw.screen = "area_judge"; const autoMany = mode !== "human-raised-many";
  const value = fixture(raw, cutoff("15"), false, false, history(cycle, autoMany ? 5 : 20));
  try {
    const recommendation = value.app.actions.getCurrentAreaCountRecommendation(20); assert.equal(recommendation.suggestedEvaluation, autoMany ? "many" : "normal");
    const selection = mode === "automatic-many" ? undefined : createHumanEvaluationSelection(mode === "human-raised-many" ? "many" : "slightly_many");
    await value.app.actions.judgeCurrentArea("normal", 20, undefined, undefined, selection ?? undefined); value.render();
    const final = mode === "many-lowered-slightly" ? "slightly_many" : "many", progress = value.app.state.areaProgressMap[AREA];
    assert.equal(progress.areaCountEvaluation, final); assert.equal(progress.areaCountEvaluationSource, mode === "automatic-many" ? "history" : "manual");
    if (selection) assert.equal(progress.humanEvaluationDetails?.automaticEvaluation, autoMany ? "many" : "normal");
    await value.click(); if (final === "many") { assertUnfinished(value); assert.match(value.text(), /どちらでもない商品を15%値引き/); await value.click(); }
    assert.equal(value.app.state.screen, "done"); assertSnapshot(value, final, "15", 5, final === "many" ? 10 : 5);
  } finally { value.close(); }
});

for (const evaluation of ["many", "slightly_many"] as const) await test(`late15 priority return ${evaluation} waits for ${evaluation === "many" ? "both" : "one"} stage before ordinary continuation`, async () => {
  const value = fixture(adoptedState(evaluation, "normal", "15", false));
  try {
    await value.click(SKIP); assert.equal(value.app.state.currentAreaId, "tempura");
    await value.app.actions.judgeCurrentArea("normal", 20, "normal"); value.render(); await finish(value, 1);
    assertUnfinished(value); assert.equal(value.app.state.priorityReturnContext?.normalResumeAreaId, "ryomi");
    const persisted = persistence(); await value.click();
    if (evaluation === "many") { assertUnfinished(value); assertNormal(value, 5); assert.equal(persistence().daily.length, persisted.daily.length); await value.click(); }
    assert.equal(value.app.state.currentAreaId, "ryomi"); assert.equal(value.app.state.screen, "area_judge");
    assert.equal(value.app.state.priorityReturnContext, undefined); assertSnapshot(value, evaluation);
    assert.equal(Object.values(value.app.state.areaProgressMap).filter(p => p.rateDecisionSnapshot).length, 2);
  } finally { value.close(); }
});

for (const evaluation of ["many", "slightly_many"] as const) await test(`late15 ${evaluation}: back and rejudge restart appropriate instructions`, async () => {
  const value = fixture(adoptedState(evaluation), cutoff("15") - 1, false, true);
  try {
    await value.click(); await value.click("戻る"); assert.equal(value.app.state.screen, "area_judge"); nowMs = cutoff("15");
    await value.app.actions.judgeCurrentArea("normal", 20, evaluation); value.render(); assertMany(value, evaluation === "many" ? 25 : 20);
    await finish(value, evaluation === "many" ? 2 : 1); assertSnapshot(value, evaluation, "15", 5, evaluation === "many" ? 10 : 5);
  } finally { value.close(); }
});
for (const evaluation of ["many", "slightly_many"] as const) await test(`late15 ${evaluation}: reload retains counts/adoption and returns to correct first stage`, async () => {
  let value = fixture(adoptedState(evaluation), cutoff("15") - 1);
  try {
    await value.click(); value.close(); clean(); nowMs = cutoff("15"); value = new AppFixture(); value.render();
    assertMany(value, 15); assert.equal(value.app.state.areaProgressMap[AREA].areaCount, 20); assert.equal(value.app.state.areaProgressMap[AREA].areaCountEvaluation, evaluation);
    await finish(value, evaluation === "many" ? 2 : 1); assertSnapshot(value, evaluation);
  } finally { value.close(); }
});
for (const [before, after] of [["normal", "many"], ["many", "slightly_many"]] as const) await test(`same-batch judgment ${before}→${after} rejects old event and follows latest stage count`, async () => {
  const value = fixture(adoptedState(before));
  try {
    if (before === "many") await value.click(); const old = value.button(), action = value.app.actions.goToNextArea;
    await value.app.actions.judgeCurrentArea("normal", 20, after); await invoke(old); action(); value.render(); assertUnfinished(value);
    assert.equal(value.app.state.areaProgressMap[AREA].areaCountEvaluation, after);
    await finish(value, after === "many" ? 2 : 1); assertSnapshot(value, after, "15", 5, after === "many" ? 10 : 5);
  } finally { value.close(); }
});
await test("many count correction returns to previous area only after both instructions", async () => {
  const raw = adoptedState("normal", "normal", "15", false); raw.currentAreaId = "fry_chicken";
  Object.assign(raw.areaProgressMap.fry_chicken, { areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaRateAdjustment: 0 });
  const value = fixture(raw);
  try {
    value.app.actions.startAreaCountCorrection(AREA); value.render(); assert.equal(value.app.state.screen, "area_judge");
    await value.app.actions.judgeCurrentArea("normal", 21, "many"); value.render(); assert.ok(value.app.state.areaCountCorrection);
    await value.click(); assertUnfinished(value); assert.ok(value.app.state.areaCountCorrection); await value.click();
    assert.equal(value.app.state.currentAreaId, "fry_chicken"); assert.equal(value.app.state.screen, "rate_display"); assert.equal(value.app.state.areaCountCorrection, null);
    assert.equal(value.app.state.areaProgressMap[AREA].areaCount, 21); assertSnapshot(value, "many", "15", 5, 10);
  } finally { value.close(); }
});
for (const operation of ["back", "other-area", "session"] as const) await test(`many stale second-stage button after ${operation} has no persistence side effects`, async () => {
  const value = fixture(adoptedState("many", "normal", "15", false), cutoff("15"), false, true);
  try {
    await value.click(); const old = value.button(), action = value.app.actions.goToNextArea;
    if (operation === "back") await value.click("戻る");
    if (operation === "other-area") { await value.click(); assert.equal(value.app.state.currentAreaId, "tempura"); }
    if (operation === "session") { const next = adoptedState("many", "normal", "15", false); next.session!.startedAt = new NativeDate(at("15:30:00")).toISOString(); value.replaceState(next); }
    const saved = json(value.app.state), persisted = persistence(); await invoke(old); action(); value.render();
    assert.deepEqual(json(value.app.state), saved); assert.deepEqual(persistence(), persisted);
  } finally { value.close(); }
});
for (const cycle of ["normal", "summer"] as const) await test(`${cycle}/many: fixed clock stages preserve production AreaCount/queue/day READ ONLY`, async () => {
  const value = fixture(adoptedState("many", cycle), cutoff("15") - 1, true);
  try {
    const before = { records: loadLocalAreaCountRecords(), queue: loadPendingSupabaseSyncQueue(), daily: storage.loadDailySessionSnapshots(), skip: storage.loadNextSessionSkipRecords() };
    await value.click(); assertNormal(value, 0); nowMs = cutoff("15") + 60000; windowEvents.emit("focus"); value.render(); assertNormal(value, 0);
    value.fixedNow = new Date(cutoff("15")); value.render(); assertNormal(value, 5); assert.equal(timeouts.size, 0); await value.click(); assert.equal(value.app.state.screen, "done");
    assert.deepEqual({ records: loadLocalAreaCountRecords(), queue: loadPendingSupabaseSyncQueue(), daily: storage.loadDailySessionSnapshots(), skip: storage.loadNextSessionSkipRecords() }, before);
  } finally { value.close(); }
});

const noop = () => {};
function isolatedRate(patch: Partial<React.ComponentProps<typeof Rate>>) {
  return React.createElement(Rate, { weekdayText: "火曜日", timeText: "15時", areaName: "弁当・麺", discountTime: "15",
    basisGuide: { referenceText: "9月の火曜日の16時を基準に考えて", referenceConditionLabel: "9月・火曜日・16時" },
    rateDisplay: { many: { main: "20%" }, normal: { main: "10%" }, few: { main: "引かない" } },
    onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop, ...patch });
}
for (const evaluation of ["many", "slightly_many"] as const) await test(`global supplement ${evaluation} follows the same stage policy as instructions`, async () => {
  nowMs = cutoff("15"); let completed = 0;
  const value = new AppFixture(() => isolatedRate({ adoptedAreaEvaluation: evaluation, globalDiscountAdjustmentPercent: 5,
    rateDisplayBeforeGlobalAdjustment: { many: { main: "15%" }, normal: { main: "5%" }, few: { main: "引かない" } }, onNextArea: () => { completed++; } }));
  try {
    value.render(); assertMany(value, 20);
    if (evaluation === "many") { assert.match(value.text(), /基準値引率：5%/); assert.match(value.text(), /補正後：10%/); assert.doesNotMatch(value.text(), /多い商品の基準値引率/); }
    else { assert.match(value.text(), /多い商品の基準値引率：15%/); assert.match(value.text(), /多い商品の補正後：20%/); assert.doesNotMatch(value.text(), /(?:基準値引率：5%|補正後：10%)/); }
    await value.click(); assert.equal(completed, evaluation === "many" ? 0 : 1);
    if (evaluation === "many") { assertNormal(value, 10); await value.click(); assert.equal(completed, 1); }
  } finally { value.close(); }
});
await test("clamped rates: a changed adopted judgment rejects old first-stage event before latest explicit retry", async () => {
  nowMs = cutoff("15"); let adopted: AreaCountEvaluation = "normal", completed = 0;
  const value = new AppFixture(() => isolatedRate({ adoptedAreaEvaluation: adopted, onNextArea: () => { completed++; return true; } }));
  try {
    value.render(); const old = value.button(); adopted = "many"; value.render(); await invoke(old); value.render();
    assertMany(value, 20); assert.equal(completed, 0); await value.click(); assertNormal(value, 10); assert.equal(completed, 0); await value.click(); assert.equal(completed, 1);
  } finally { value.close(); }
});
await test("clamped rates: adopted normal→many retains normal stage and invalidates old callback", async () => {
  nowMs = cutoff("15") - 1; let adopted: AreaCountEvaluation = "normal", completed = 0;
  const value = new AppFixture(() => isolatedRate({ adoptedAreaEvaluation: adopted, onNextArea: () => { completed++; return true; } }));
  try {
    value.render(); await value.click(); const old = value.button(); nowMs = cutoff("15"); adopted = "many"; value.render();
    assertNormal(value, 10); await invoke(old); value.render(); assert.equal(completed, 0); assertNormal(value, 10);
    await value.click(); assert.equal(completed, 1);
  } finally { value.close(); }
});
await test("clamped rates: adopted many→normal retains neutral finish and rejects old normal callback", async () => {
  nowMs = cutoff("15"); let adopted: AreaCountEvaluation = "many", completed = 0;
  const value = new AppFixture(() => isolatedRate({ adoptedAreaEvaluation: adopted, onNextArea: () => { completed++; return true; } }));
  try { value.render(); await value.click(); const old = value.button(); adopted = "normal"; value.render(); assertSuppressed(value); await invoke(old); value.render(); assert.equal(completed, 0); await value.click(); assert.equal(completed, 1); } finally { value.close(); }
});
await test("accepted/refused/throwing many completion retains explicit retry and duplicate protection", async () => {
  nowMs = cutoff("15"); let attempts = 0;
  const value = new AppFixture(() => isolatedRate({ adoptedAreaEvaluation: "many", onNextArea: () => { attempts++; if (attempts === 1) return false; if (attempts === 2) throw new Error("fixture retry"); return true; } }));
  try {
    value.render(); await value.click(); assert.equal(attempts, 0); await value.click(); assert.equal(attempts, 1); await assert.rejects(value.click(), /fixture retry/);
    const old = value.button(); await invoke(old); await invoke(old); value.render(); assert.equal(attempts, 3);
  } finally { value.close(); }
});
await test("many Done keeps late15 normal strike and positive-rate colors unchanged", async () => {
  const value = fixture(adoptedState("many"));
  try {
    await finish(value); assert.equal(value.app.state.screen, "done");
    const normalRows = value.nodes.filter(node => textOf(node).startsWith("どちらでもない →") && node.props.style && (node.props.style as React.CSSProperties).textDecorationLine === "line-through");
    assert.ok(normalRows.length > 0); assert.ok(normalRows.some(node => textOf(node).includes("5%")));
    assert.ok(normalRows.some(node => (node.props.style as React.CSSProperties).color === "#008000"));
    assert.ok(value.nodes.some(node => textOf(node) === "多い → 15%" && (node.props.style as React.CSSProperties | undefined)?.color === "#ff0000"));
    const saved = json(value.app.state.areaProgressMap[AREA].rateDecisionSnapshot), persisted = persistence(); nowMs = cutoff("15") + 60000; windowEvents.emit("focus"); value.render();
    assert.deepEqual(json(value.app.state.areaProgressMap[AREA].rateDecisionSnapshot), saved); assert.deepEqual(persistence(), persisted);
  } finally { value.close(); }
});

Object.defineProperty(globalThis, "Date", { configurable: true, value: NativeDate });
const summary = { passed: true, passedCases: results.length, totalCases: results.length, notes: [], boundaryExamples: examples, cases: results };
writeFileSync(new URL("../../tests56-summary.json", import.meta.url), JSON.stringify(summary, null, 2) + "\n");
const finalLine = `Many exception56 checks passed: ${results.length}/${results.length}`;
writeFileSync(new URL("../../check-many-exception56.log", import.meta.url), [...logLines, finalLine].join("\n") + "\n");
console.log(finalLine);
