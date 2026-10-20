import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import { loadPendingSupabaseSyncQueue } from "../src/domain/supabaseSyncQueue.ts";
import { createNavigationSnapshot } from "../src/domain/navigationHistory.ts";
import * as storage from "../src/domain/storage.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { setRuntimeNowOverride } from "../src/hooks/nebikiApp/clock.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";
import type { AppState, DemandCycle, UseNebikiAppResult } from "../src/domain/types.ts";
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
  location: { search: "", hash: "", href: "http://late54.invalid/", pathname: "/" },
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
function fixture(time: "15" | "17", cycle: DemandCycle, timestamp: number, onlyLast = true, fixed = false, backHistory = false) {
  clean(); memory.clear(); nowMs = timestamp; const raw = state(time, cycle, onlyLast);
  memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(raw)); memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(raw));
  if (backHistory) {
    const previous = { ...json(raw), screen: "area_judge" as const };
    const navigation = createNavigationSnapshot({ state: previous, areaJudgeSelection: null, resumeTargetScreen: null, nextSessionSkipRecords: [], lastSessionWeather: null });
    memory.values.set(storage.STORAGE_KEYS.runtimeState, JSON.stringify({ areaJudgeSelection: null, resumeTargetScreen: null, timeSwitchTarget: null, undoSnapshot: null, screenHistory: [navigation], weatherConfirmationPending: null }));
  }
  const value = new AppFixture(); value.render();
  if (fixed) { value.fixedNow = new Date(timestamp); value.render(); }
  return value;
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
    writeFileSync(new URL("../../tests54-summary.json", import.meta.url), JSON.stringify({ passed: false, passedCases: results.length, totalCases: results.length + 1, notes: [`${name}: ${String(error)}`], cases: results }, null, 2) + "\n");
    throw error;
  }
  results.push({ name, ok: true }); const line = `PASS ${String(results.length).padStart(2, "0")}: ${name}`; logLines.push(line); console.log(line);
}
function assertCaptured(value: AppFixture, time: "15" | "17", bonus: number) {
  const progress = value.app.state.areaProgressMap[AREA], snapshot = progress.rateDecisionSnapshot; assert.ok(snapshot);
  const expected = (time === "15" ? 0 : 10) + bonus;
  assert.equal(snapshot.sessionDiscountTime, time); assert.equal(snapshot.effectiveRateDiscountTime, time);
  assert.equal(snapshot.calculationMode, bonus ? "late_plus5" : "normal"); assert.equal(snapshot.lateTimeAdjustmentPercent, bonus); assert.equal(snapshot.earlyNextAdjustmentPercent, 0);
  assert.deepEqual([snapshot.normalRatePercent, snapshot.manyRatePercent], [expected, expected + 10]);
  assert.deepEqual([progress.completedNormalRateText, progress.completedManyRateText], [`${expected}%`, `${expected + 10}%`]);
  assert.equal(snapshot.confirmedAt, new NativeDate(nowMs).toISOString());
  assert.equal(value.app.state.session?.discountTime, time); assert.deepEqual(storage.loadNextSessionSkipRecords(), []);
  return json(snapshot);
}

for (const cycle of ["normal", "summer"] as const) {
  await test(`${cycle}/15: before16 uses two explicit stages; late15 starts many-only and completes once`, async () => {
    let value = fixture("15", cycle, cutoff("15") - 1);
    try { assertMany(value, 10); await value.click(); assertNormal(value, 0); assert.equal(value.app.state.areaProgressMap[AREA].status, "unstarted"); await value.click(); assert.equal(value.app.state.screen, "done"); assertCaptured(value, "15", 0); } finally { value.close(); }
    value = fixture("15", cycle, cutoff("15"));
    try { assertMany(value, 15); const old = value.button(); await invoke(old); await invoke(old); value.render(); assert.equal(value.app.state.screen, "done"); assertCaptured(value, "15", 5); } finally { value.close(); }
  });
  for (const time of ["15", "17"] as const) {
    await test(`${cycle}/${time}: normal stage crossing cutoff never rewinds; only explicit finish captures fresh +5`, async () => {
      const value = fixture(time, cycle, cutoff(time) - 1);
      try {
        const base = time === "15" ? 0 : 10; assertMany(value, base + 10); await value.click(); assertNormal(value, base);
        const saved = json(value.app.state), before = persistence(); nowMs = cutoff(time); fireDueTimers(); value.render();
        if (time === "15") assertSuppressed(value); else assertNormal(value, base + 5);
        assert.deepEqual(json(value.app.state), saved, "clock does not complete, rewind or rewrite input");
        assert.deepEqual(persistence(), before, "clock-only transition has no storage side effects"); assertAlignedTimer();
        await value.click(); assert.equal(value.app.state.screen, "done"); examples.push({ cycle, time, clock: new NativeDate(nowMs).toISOString(), snapshot: assertCaptured(value, time, 5) });
        const daily = storage.loadDailySessionSnapshots().find(record => record.session.startedAt === value.app.state.session?.startedAt); assert.ok(daily); assert.deepEqual(json(daily.areas[AREA].rateDecisionSnapshot), json(value.app.state.areaProgressMap[AREA].rateDecisionSnapshot));
      } finally { value.close(); }
    });
    await test(`${cycle}/${time}: old many handler checks click clock at cutoff; duplicate event cannot complete another stage/area`, async () => {
      const value = fixture(time, cycle, cutoff(time) - 1, false);
      try {
        const button = value.button(); nowMs = cutoff(time); await invoke(button); await invoke(button); value.render();
        if (time === "15") { assertCaptured(value, time, 5); assert.notEqual(value.app.state.currentAreaId, AREA); assert.equal(value.app.state.screen, "area_judge"); }
        else { assertNormal(value, 15); assert.equal(value.app.state.currentAreaId, AREA); assert.equal(value.app.state.areaProgressMap[AREA].status, "unstarted"); await value.click(); assertCaptured(value, time, 5); }
        const completed = Object.values(value.app.state.areaProgressMap).filter(progress => progress.status === "completed"); assert.equal(completed.length, 1, "one click generation completes at most its own area");
      } finally { value.close(); }
    });
    await test(`${cycle}/${time}: stale normal handler captures fresh click clock before any timer/render`, async () => {
      const value = fixture(time, cycle, cutoff(time) - 1);
      try { await value.click(); const old = value.button(); nowMs = cutoff(time); await invoke(old); await invoke(old); value.render(); assert.equal(value.app.state.screen, "done"); assertCaptured(value, time, 5); } finally { value.close(); }
    });
    await test(`${cycle}/${time}: direct stale completion action captures fresh rate snapshot and is replay-safe`, () => {
      const value = fixture(time, cycle, cutoff(time) - 1, false);
      try {
        const action = value.app.actions.goToNextArea; nowMs = cutoff(time); action(); action(); value.render(); assertCaptured(value, time, 5);
        const after = persistence(), stateAfter = json(value.app.state); action(); value.render(); assert.deepEqual(json(value.app.state), stateAfter); assert.deepEqual(persistence(), after);
      } finally { value.close(); }
    });
  }
  await test(`${cycle}/17: new18-boundary entry keeps two17-rate stages and displays18 reference`, async () => {
    const value = fixture("17", cycle, cutoff("17"));
    try {
      assertMany(value, 25); assert.match(value.app.derived.basisGuide.referenceText, /18時を基準に考えて/); assert.match(value.app.derived.basisGuide.referenceConditionLabel, /18時$/);
      assert.equal(value.app.state.session?.discountTime, "17"); await value.click(); assertNormal(value, 15); assert.equal(value.app.state.areaProgressMap[AREA].status, "unstarted"); await value.click(); assert.equal(value.app.state.screen, "done"); assertCaptured(value, "17", 5);
    } finally { value.close(); }
  });
}

for (const time of ["15", "17"] as const) for (const trigger of ["focus", "visible", "timeout"] as const) {
  await test(`${time}: ${trigger} refreshes the open normal stage with one aligned clock and no persistence`, async () => {
    const value = fixture(time, "normal", cutoff(time) - 12345);
    try {
      await value.click(); assertNormal(value, time === "15" ? 0 : 10); const before = persistence(); nowMs = cutoff(time) + 17345;
      if (trigger === "focus") windowEvents.emit("focus");
      if (trigger === "visible") { documentFixture.hidden = true; documentEvents.emit("visibilitychange"); assert.equal(value.dirty, false); assertNormal(value, time === "15" ? 0 : 10); documentFixture.hidden = false; documentEvents.emit("visibilitychange"); }
      if (trigger === "timeout") fireDueTimers(); value.render();
      if (time === "15") assertSuppressed(value); else assertNormal(value, 15);
      assert.deepEqual(persistence(), before); assertAlignedTimer(); await value.click(); assertCaptured(value, time, 5);
    } finally { value.close(); }
  });
}

for (const time of ["15", "17"] as const) await test(`${time}: back then reenter resets the area stage using current cutoff policy`, async () => {
  const value = fixture(time, "normal", cutoff(time) - 1, true, false, true);
  try {
    await value.click(); assertNormal(value, time === "15" ? 0 : 10); await value.click("戻る"); assert.equal(value.app.state.screen, "area_judge");
    nowMs = cutoff(time); await value.app.actions.judgeCurrentArea("normal", 20, "normal"); value.render(); assertMany(value, time === "15" ? 15 : 25);
    await value.click(); if (time === "15") assert.equal(value.app.state.screen, "done"); else { assertNormal(value, 15); await value.click(); }
    assertCaptured(value, time, 5);
  } finally { value.close(); }
});

for (const time of ["15", "17"] as const) await test(`${time}: reload starts the displayed area from many with saved counts; late+5 is not accumulated`, async () => {
  let value = fixture(time, "summer", cutoff(time) - 1);
  try {
    await value.click(); value.close(); clean(); nowMs = cutoff(time); value = new AppFixture(); value.render(); assertMany(value, time === "15" ? 15 : 25); assert.equal(value.app.state.areaProgressMap[AREA].areaCount, 20);
    await value.click(); if (time === "17") { assertNormal(value, 15); await value.click(); } assertCaptured(value, time, 5);
  } finally { value.close(); }
});

for (const time of ["15", "17"] as const) await test(`${time}: fixed-time boundary controls stages without live timers or production data writes`, async () => {
  const value = fixture(time, "normal", cutoff(time) - 1, true, true);
  try {
    assert.equal(timeouts.size, 0); await value.click(); assertNormal(value, time === "15" ? 0 : 10);
    const before = { records: loadLocalAreaCountRecords(), queue: loadPendingSupabaseSyncQueue(), daily: storage.loadDailySessionSnapshots(), skip: storage.loadNextSessionSkipRecords() };
    nowMs = cutoff(time) + 60000; windowEvents.emit("focus"); documentEvents.emit("visibilitychange"); value.render(); assertNormal(value, time === "15" ? 0 : 10);
    value.fixedNow = new Date(cutoff(time)); value.render(); if (time === "15") assertSuppressed(value); else assertNormal(value, 15); assert.equal(timeouts.size, 0);
    await value.click(); assert.equal(value.app.state.screen, "done");
    assert.deepEqual({ records: loadLocalAreaCountRecords(), queue: loadPendingSupabaseSyncQueue(), daily: storage.loadDailySessionSnapshots(), skip: storage.loadNextSessionSkipRecords() }, before, "fixed operation cannot enter production archive/queue/day/skip data");
  } finally { value.close(); }
});

for (const cycle of ["normal", "summer"] as const) for (const time of ["15", "17"] as const) for (const delta of [-1, 0, 1]) {
  await test(`${cycle}/${time}: reference and initial stage at exact cutoff${delta < 0 ? "-1ms" : delta ? "+1ms" : ""}`, async () => {
    const value = fixture(time, cycle, cutoff(time) + delta);
    try {
      const shownTime = delta < 0 ? time : time === "15" ? "16" : "18";
      assert.match(value.app.derived.basisGuide.referenceConditionLabel, new RegExp(`${shownTime}時$`));
      assert.match(value.app.derived.basisGuide.referenceText, new RegExp(`${shownTime}時を基準に考えて`));
      assert.equal(value.app.state.session?.discountTime, time);
      assertMany(value, (time === "15" ? 10 : 20) + (delta < 0 ? 0 : 5));
      await value.click();
      if (time === "15" && delta >= 0) assert.equal(value.app.state.screen, "done");
      else { assertNormal(value, (time === "15" ? 0 : 10) + (delta < 0 ? 0 : 5)); await value.click(); }
      assertCaptured(value, time, delta < 0 ? 0 : 5);
    } finally { value.close(); }
  });
}

for (const cycle of ["normal", "summer"] as const) await test(`${cycle}: same-area replacement17 session remounts instructions from many`, async () => {
  const value = fixture("17", cycle, cutoff("17") - 1);
  try {
    await value.click(); assertNormal(value, 10);
    nowMs = cutoff("17"); const replacement = state("17", cycle); replacement.session!.startedAt = new NativeDate(at("17:30:00")).toISOString();
    value.replaceState(replacement); assertMany(value, 25); await value.click(); assertNormal(value, 15); await value.click(); assertCaptured(value, "17", 5);
  } finally { value.close(); }
});

for (const navigation of ["back", "reset"] as const) await test(`old unfinished completion event after ${navigation} cannot change current state or persistence`, async () => {
  const value = fixture("15", "normal", cutoff("15") - 1, true, false, true);
  try {
    await value.click(); const oldButton = value.button(), oldAction = value.app.actions.goToNextArea;
    if (navigation === "back") await value.click("戻る"); else { value.app.actions.resetApp(); value.render(); }
    const before = persistence(), stateBefore = json(value.app.state); nowMs = cutoff("15"); await invoke(oldButton); oldAction(); value.render();
    assert.deepEqual(json(value.app.state), stateBefore); assert.deepEqual(persistence(), before, "stale navigation callback cannot create undo/storage side effects");
  } finally { value.close(); }
});

const noop = () => {};
function isolatedRate(patch: Partial<React.ComponentProps<typeof Rate>>) {
  return React.createElement(Rate, {
    weekdayText: "火曜日", timeText: "17時", areaName: "弁当・麺", discountTime: "17",
    basisGuide: { referenceText: "9月の火曜日の17時を基準に考えて", referenceConditionLabel: "9月・火曜日・17時" },
    rateDisplay: { many: { main: "25%" }, normal: { main: "15%" }, few: { main: "引かない" } },
    onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop, ...patch,
  });
}
await test("empty rate text cannot create a blank instruction stage or demand an extra click", async () => {
  nowMs = cutoff("17");
  for (const [many, normal, expected] of [["25%", " ", "多い商品を25%"], [" ", "15%", "どちらでもない商品を15%"]]) {
    let completed = 0;
    const value = new AppFixture(() => isolatedRate({ rateDisplay: { many: { main: many }, normal: { main: normal }, few: { main: "引かない" } }, onNextArea: () => { completed++; } }));
    try { value.render(); assert.ok(value.text().includes(expected)); await value.click(); assert.equal(completed, 1); } finally { value.close(); }
  }
  const empty = new AppFixture(() => isolatedRate({ rateDisplay: { many: { main: " " }, normal: { main: "\n" }, few: { main: "引かない" } } }));
  try { empty.render(); assert.doesNotMatch(empty.text(), /商品を.*値引きしてください。/); assert.equal(empty.nodes.filter(node => node.type === "button" && textOf(node) === "終わった").length, 0); } finally { empty.close(); }
});
await test("late15 global correction supplement shows many rates without exposing normal rate", () => {
  nowMs = cutoff("15");
  const value = new AppFixture(() => isolatedRate({ discountTime: "15", globalDiscountAdjustmentPercent: 5,
    rateDisplay: { many: { main: "20%" }, normal: { main: "10%" }, few: { main: "引かない" } },
    rateDisplayBeforeGlobalAdjustment: { many: { main: "15%" }, normal: { main: "5%" }, few: { main: "引かない" } },
  }));
  try { value.render(); assertMany(value, 20); assert.match(value.text(), /多い商品の基準値引率：15%/); assert.match(value.text(), /多い商品の補正後：20%/); assert.doesNotMatch(value.text(), /(?:基準値引率：5%|補正後：10%|どちらでもない商品を10%)/); } finally { value.close(); }
});
await test("explicitly refused completion unlocks retry and accepted completion rejects replays", async () => {
  nowMs = cutoff("15"); let attempts = 0;
  const value = new AppFixture(() => isolatedRate({ discountTime: "15", onNextArea: () => ++attempts > 1 }));
  try { value.render(); await value.click(); assert.equal(attempts, 1); const button = value.button(); await invoke(button); await invoke(button); value.render(); assert.equal(attempts, 2); } finally { value.close(); }
});
await test("a throwing completion releases its lock for an explicit successful retry", async () => {
  nowMs = cutoff("15"); let attempts = 0;
  const value = new AppFixture(() => isolatedRate({ discountTime: "15", onNextArea: () => { if (++attempts === 1) throw new Error("fixture completion failure"); return true; } }));
  try { value.render(); await assert.rejects(value.click(), /fixture completion failure/); await value.click(); await value.click(); assert.equal(attempts, 2); } finally { value.close(); }
});
await test("queued manual judgment then old completion cannot capture previous rates; adopted many retries both latest instructions", async () => {
  const value = fixture("15", "normal", cutoff("15") - 1);
  try {
    await value.click(); nowMs = cutoff("15"); fireDueTimers(); value.render(); assertSuppressed(value);
    const old = value.button(); await value.app.actions.judgeCurrentArea("normal", 20, "many"); await invoke(old); value.render();
    assert.equal(value.app.state.areaProgressMap[AREA].status, "unstarted"); assert.equal(value.app.state.areaProgressMap[AREA].rateDecisionSnapshot, undefined); assertMany(value, 25);
    await value.click(); assertNormal(value, 15); assert.equal(value.app.state.areaProgressMap[AREA].status, "unstarted"); assert.equal(value.app.state.areaProgressMap[AREA].rateDecisionSnapshot, undefined);
    await value.click(); assert.equal(value.app.state.screen, "done"); const snapshot = value.app.state.areaProgressMap[AREA].rateDecisionSnapshot; assert.ok(snapshot);
    assert.equal(snapshot.areaCountAdjustmentPercent, 10); assert.equal(snapshot.lateTimeAdjustmentPercent, 5); assert.deepEqual([snapshot.normalRatePercent, snapshot.manyRatePercent], [15, 25]);
  } finally { value.close(); }
});
await test("manual metadata change unlocks neutral completion even when displayed rates stay clamped", async () => {
  nowMs = cutoff("15") - 1; let attempts = 0;
  let finalEvaluation: "normal" | "many" = "normal";
  const value = new AppFixture(() => isolatedRate({ discountTime: "15", areaCountDecisionBasis: {
    ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 3, requiredSampleSize: 3,
    baseEvaluation: "normal", finalEvaluation, areaRateAdjustment: finalEvaluation === "many" ? 10 : 0,
  }, onNextArea: () => { attempts++; return true; } }));
  try {
    value.render(); await value.click(); nowMs = cutoff("15"); value.render(); assertSuppressed(value); await value.click(); assert.equal(attempts, 1);
    finalEvaluation = "many"; value.render(); assertSuppressed(value); await value.click(); assert.equal(attempts, 2);
  } finally { value.close(); }
});

Object.defineProperty(globalThis, "Date", { configurable: true, value: NativeDate });
const summary = { passed: true, passedCases: results.length, totalCases: results.length, notes: [], boundaryExamples: examples, cases: results };
writeFileSync(new URL("../../tests54-summary.json", import.meta.url), JSON.stringify(summary, null, 2) + "\n");
const finalLine = `Late operation54 checks passed: ${results.length}/${results.length}`;
writeFileSync(new URL("../../check-late-operation54.log", import.meta.url), [...logLines, finalLine].join("\n") + "\n");
console.log(finalLine);
