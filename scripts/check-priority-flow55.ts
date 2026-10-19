import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { AREA_COUNT_LOCAL_STORAGE_KEY, loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import { getNormalRoute, getAreaName } from "../src/domain/area.ts";
import { createHumanEvaluationSelection, createReview19HumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import { buildReview19DataQuality, createInitialReview19Result } from "../src/domain/review19.ts";
import { HistoricalArchiveRepository, MemoryHistoricalArchiveAdapter } from "../src/domain/historicalArchive.ts";
import { initializeHistoricalArchiveRuntime } from "../src/domain/historicalArchiveRuntime.ts";
import { createNavigationSnapshot } from "../src/domain/navigationHistory.ts";
import { loadPendingSupabaseSyncQueue } from "../src/domain/supabaseSyncQueue.ts";
import * as storage from "../src/domain/storage.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { setRuntimeNowOverride } from "../src/hooks/nebikiApp/clock.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";
import type { AppState, AreaCountEvaluation, AreaId, DemandCycle, UseNebikiAppResult } from "../src/domain/types.ts";
import type { AppRouter } from "../src/app/AppRouter.tsx";

// Execute the real TSX tree, event handlers, complete business hook, aligned
// scheduler and synchronous persistence effects. Browser paint, IndexedDB
// hydration and actual Supabase transport are checked separately.
process.env.TZ = "Asia/Tokyo";
const NativeDate = Date; let DATE = "2026-10-13";
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
const alerts: string[] = [];
type Timer = { callback: () => void; due: number; delay: number };
const timeouts = new Map<number, Timer>(); let timerId = 0;
const documentFixture = { hidden: false, addEventListener: documentEvents.addEventListener, removeEventListener: documentEvents.removeEventListener };
const windowFixture = {
  addEventListener: windowEvents.addEventListener, removeEventListener: windowEvents.removeEventListener,
  setTimeout(callback: () => void, delay = 0) { const id = ++timerId; timeouts.set(id, { callback, delay, due: nowMs + delay }); return id; },
  clearTimeout(id: number) { timeouts.delete(id); },
  setInterval() { assert.fail("priority operation must reuse the shared aligned timeout clock"); }, clearInterval() {},
  location: { search: "", hash: "", href: "http://priority55.invalid/", pathname: "/" },
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
const hookEffects = (text: string) => /app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|areaCompletionStateRef\.current|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|startAlignedRuntimeClock|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)|earlyNextMinus5TargetDiscountTime|startAutomaticReview19/.test(text);
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

const SKIP = "今はスキップ（画面左スワイプ）";
const F: AreaId = "fry_chicken", Y: AreaId = "yakitori", C: AreaId = "chuka_fish", O: AreaId = "onigiri";
const results: Array<{ name: string; ok: boolean }> = [], examples: unknown[] = [];
const logLines: string[] = [];
function completed(progress: AppState["areaProgressMap"][AreaId], time: "15" | "17" = "15") {
  Object.assign(progress, { status: "completed", areaJudge: "normal", areaCount: 20,
    areaCountEvaluation: "normal", areaRateAdjustment: 0, completedAt: new NativeDate(at(`${time}:00:00`)).toISOString(),
    completedRateText: "10%", completedNormalRateText: "0%", completedManyRateText: "10%" });
}
function state(time: "15" | "17" = "15", cycle: DemandCycle = "normal", start: AreaId = F): AppState {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const value of Object.values(hourlyForecasts)) Object.assign(value, { weather: "sunny", tempC: 29, windMs: 2 });
  const session = { ...getCurrentDataVersionInfo(), date: DATE, weekday: new NativeDate(at("12:00:00")).getDay(), discountTime: time, demandCycle: cycle,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false, globalDiscountAdjustmentPercent: 0 as const,
    weather: { hourlyForecasts, afterRainSky: null }, startedAt: new NativeDate(at(`${time}:00:00`)).toISOString() };
  const value = createInitialState(session); value.session = session; value.screen = "area_judge"; value.currentAreaId = start;
  for (const id of value.normalFlowOrder ?? getNormalRoute(DATE)) { if (id === start) break; completed(value.areaProgressMap[id], time); }
  return value;
}
function clean() {
  assert.equal(timeouts.size, 0, "production timers disposed"); assert.equal(windowEvents.count("focus"), 0); assert.equal(documentEvents.count("visibilitychange"), 0);
  setRuntimeNowOverride(null); documentFixture.hidden = false;
}
function fixture(raw = state(), timestamp = at("15:10:00"), fixed = false, historical: unknown[] = [], runtime?: unknown) {
  clean(); memory.clear(); alerts.length = 0; nowMs = timestamp;
  memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(raw)); memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(raw));
  if (historical.length) memory.values.set(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(historical));
  if (runtime) memory.values.set(storage.STORAGE_KEYS.runtimeState, JSON.stringify(runtime));
  const value = new AppFixture(); value.render(); if (fixed) { value.fixedNow = new Date(timestamp); value.render(); } return value;
}
function fireDueTimers() {
  for (const [id, timer] of [...timeouts]) if (timer.due <= nowMs) { timeouts.delete(id); timer.callback(); }
}
async function settle(value: AppFixture) {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  fireDueTimers(); value.render();
}
function current(value: AppFixture, id: AreaId, screen: AppState["screen"] = "area_judge") {
  assert.equal(value.app.state.currentAreaId, id, `current area is ${getAreaName(id)}`); assert.equal(value.app.state.screen, screen);
}
async function judge(value: AppFixture, evaluation: AreaCountEvaluation = "normal", human = false) {
  assert.equal(value.app.state.screen, "area_judge");
  const selection = human ? createHumanEvaluationSelection(evaluation) : undefined;
  await value.app.actions.judgeCurrentArea("normal", 20, human ? undefined : evaluation, undefined, selection ?? undefined); value.render();
  assert.equal(value.app.state.screen, "rate_display"); assert.equal(value.app.state.areaProgressMap[value.app.state.currentAreaId!].areaCountEvaluation, evaluation);
}
async function judgeUi(value: AppFixture, evaluation: AreaCountEvaluation) {
  assert.equal(value.app.state.screen, "area_judge");
  await value.click("2"); await value.click("0"); await value.click("完了");
  const node = value.nodes.find(node => node.type === "button" && node.props["data-evaluation"] === evaluation); assert.ok(node, `manual evaluation UI ${evaluation}`);
  await invoke(node); await settle(value); assert.equal(value.app.state.screen, "rate_display");
  assert.equal(value.app.state.areaProgressMap[value.app.state.currentAreaId!].areaCountEvaluation, evaluation);
}
async function finish(value: AppFixture) {
  const id = value.app.state.currentAreaId; assert.ok(id); assert.equal(value.app.state.screen, "rate_display");
  const previouslyCompleted = value.app.state.areaProgressMap[id].status === "completed";
  const late15 = value.app.state.session?.discountTime === "15" && (value.fixedNow?.getTime() ?? nowMs) >= cutoff("15");
  await value.click();
  if (!late15) { current(value, id, "rate_display"); if (!previouslyCompleted) assert.notEqual(value.app.state.areaProgressMap[id].status, "completed"); await value.click(); }
  assert.equal(value.app.state.areaProgressMap[id].status, "completed"); assert.ok(value.app.state.areaProgressMap[id].rateDecisionSnapshot);
}
function persistence() { return { records: loadLocalAreaCountRecords(), queue: loadPendingSupabaseSyncQueue(), daily: storage.loadDailySessionSnapshots(), skip: storage.loadNextSessionSkipRecords() }; }
function assertNoCompletion(value: AppFixture, id: AreaId) { assert.notEqual(value.app.state.areaProgressMap[id].status, "completed"); assert.equal(value.app.state.areaProgressMap[id].rateDecisionSnapshot, undefined); }
async function test(name: string, run: () => void | Promise<void>) {
  try { await run(); clean(); } catch (error) {
    writeFileSync(new URL("../../tests55-flow-summary.json", import.meta.url), JSON.stringify({ passed: false, passedCases: results.length, totalCases: results.length + 1, notes: [`${name}: ${String(error)}`], cases: results }, null, 2) + "\n"); throw error;
  }
  results.push({ name, ok: true }); const line = `PASS ${String(results.length).padStart(2, "0")}: ${name}`; logLines.push(line); console.log(line);
}

for (const cycle of ["normal", "summer"] as const) for (const time of ["15", "17"] as const) {
  await test(`${cycle}/${time}: mandatory example1 uses actual count/manual/skip/two-stage completion events`, async () => {
    DATE = cycle === "summer" ? "2026-09-08" : "2026-10-13";
    const value = fixture(state(time, cycle), at(`${time}:10:00`));
    try {
      const visited = [F]; await judgeUi(value, "slightly_many"); assertNoCompletion(value, F); await value.click(SKIP); current(value, Y); visited.push(Y);
      await judgeUi(value, "normal"); current(value, Y, "rate_display"); assertNoCompletion(value, F);
      await value.click(); current(value, Y, "rate_display"); assertNoCompletion(value, F); assertNoCompletion(value, Y);
      await value.click(); current(value, F, "rate_display"); visited.push(F); assertNoCompletion(value, F);
      assert.equal(value.app.state.areaProgressMap[F].areaCount, 20, "return reuses saved observation"); await finish(value); current(value, C); visited.push(C);
      assert.equal(value.app.state.areaProgressMap[Y].status, "completed"); examples.push({ name: `${cycle}/${time}/example1`, visited });
    } finally { value.close(); }
  });
  await test(`${cycle}/${time}: mandatory example2 chooses near yakitori then fry and resumes onigiri`, async () => {
    DATE = cycle === "summer" ? "2026-09-08" : "2026-10-13";
    const value = fixture(state(time, cycle), at(`${time}:10:00`));
    try {
      const visited = [F]; await judgeUi(value, "many"); await value.click(SKIP); current(value, Y); visited.push(Y);
      await judgeUi(value, "slightly_many"); await value.click(SKIP); current(value, C); visited.push(C); assertNoCompletion(value, F); assertNoCompletion(value, Y);
      await judgeUi(value, "normal"); await finish(value); current(value, Y, "rate_display"); visited.push(Y); assertNoCompletion(value, Y);
      await finish(value); current(value, F, "rate_display"); visited.push(F); await finish(value); current(value, O); visited.push(O);
      assert.deepEqual((value.app.state.normalFlowOrder ?? []).filter(id => [F, Y, C, O].includes(id)), [F, Y, C, O]);
      examples.push({ name: `${cycle}/${time}/example2`, visited });
    } finally { value.close(); }
  });
}

await test("manual final normal excludes raw automatic many; human slightly_many includes automatic normal", async () => {
  DATE = "2026-10-13";
  const history = ["2026-10-06", "2026-09-29", "2026-09-22"].flatMap(date => [F, Y].map(areaId => ({
    ...getCurrentDataVersionInfo(), date, demandCycle: "normal", sessionStartedAt: `${date}T15:00:00+09:00`, recordedAt: `${date}T15:00:00+09:00`,
    areaId, discountTime: "15", actualWeekday: "火", actualWeekdayGroup: "火木", count: areaId === F ? 5 : 20,
  })));
  const value = fixture(state(), at("15:10:00"), false, history);
  try {
    assert.equal(value.app.actions.getCurrentAreaCountRecommendation(20).suggestedEvaluation, "many");
    await judge(value, "normal", true); await value.click(SKIP); current(value, Y);
    assert.equal(value.app.actions.getCurrentAreaCountRecommendation(20).suggestedEvaluation, "normal");
    await judge(value, "slightly_many", true); await value.click(SKIP); current(value, C); await judge(value); await finish(value); current(value, Y, "rate_display");
    await finish(value); current(value, O); assert.equal(value.app.state.areaProgressMap[F].status, "skipped_manual", "normal manual skip stays for ordinary pending handling");
  } finally { value.close(); }
});
for (const pair of [["normal", "slightly_many"], ["slightly_many", "many"]] as const) await test(`summer17 intermediate ${pair.join("/")} retains adopted evaluation after18 without resolving raw score again`, async () => {
  DATE = "2026-09-08"; const value = fixture(state("17", "summer"), cutoff("17") - 1);
  try {
    const selection = createHumanEvaluationSelection(...pair); assert.ok(selection);
    await value.app.actions.judgeCurrentArea("normal", 20, undefined, undefined, selection); value.render();
    const details = json(value.app.state.areaProgressMap[F].humanEvaluationDetails); assert.equal(value.app.state.areaProgressMap[F].areaCountEvaluation, pair[0]);
    await value.click(SKIP); await judge(value); nowMs = cutoff("17"); windowEvents.emit("focus"); value.render(); await finish(value);
    if (pair[0] === "normal") current(value, C); else current(value, F, "rate_display");
    assert.equal(value.app.state.areaProgressMap[F].areaCountEvaluation, pair[0]); assert.deepEqual(json(value.app.state.areaProgressMap[F].humanEvaluationDetails), details);
  } finally { value.close(); }
});

for (const evaluation of ["normal", "slightly_few", "few"] as const) await test(`${evaluation}: ordinary manual skip is not collected after another area's completion`, async () => {
  DATE = "2026-10-13"; const value = fixture();
  try { await judge(value, evaluation); await value.click(SKIP); current(value, Y); await judge(value); await finish(value); current(value, C); assert.equal(value.app.state.areaProgressMap[F].status, "skipped_manual"); } finally { value.close(); }
});
await test("unjudged skip and few postponement stay outside high priority", async () => {
  const value = fixture();
  try {
    await value.click(SKIP); current(value, Y); await value.app.actions.judgeCurrentArea("few", 20); value.render(); current(value, C);
    await judge(value); await finish(value); current(value, O); assert.equal(value.app.state.areaProgressMap[F].areaJudge, null); assert.equal(value.app.state.areaProgressMap[Y].status, "postponed_few");
  } finally { value.close(); }
});
for (const kind of ["late_plus5", "early_next_minus5"] as const) await test(`${kind}: auto-skip acknowledgment never triggers priority and auto-skipped area never joins it`, async () => {
  const raw = state(); raw.currentAreaId = Y; raw.screen = "auto_skip_notice";
  Object.assign(raw.areaProgressMap[F], { status: "skipped_manual", areaJudge: "normal", areaCount: 20, areaCountEvaluation: "many", areaRateAdjustment: 10 });
  Object.assign(raw.areaProgressMap[Y], { status: "auto_skipped_late_time", autoSkipKind: kind, areaJudge: "normal", areaCountEvaluation: "many" });
  const value = fixture(raw);
  try {
    await value.click(kind === "late_plus5" ? "OK" : "測定せずスキップする"); current(value, C); assertNoCompletion(value, F);
    await judge(value); await finish(value); current(value, F, "rate_display"); await finish(value); current(value, O);
    assert.equal(value.app.state.areaProgressMap[Y].status, "auto_skipped_late_time");
  } finally { value.close(); }
});
await test("completed many area stays completed and cannot become a priority candidate", async () => {
  const raw = state("15", "normal", Y); Object.assign(raw.areaProgressMap[F], { areaCountEvaluation: "many", areaRateAdjustment: 10 });
  const value = fixture(raw);
  try { await judge(value); await finish(value); current(value, C); assert.equal(value.app.state.areaProgressMap[F].status, "completed"); } finally { value.close(); }
});

await test("re-skip during priority return proceeds along saved continuation and is eligible only after a different completion", async () => {
  const value = fixture();
  try {
    await judge(value, "many"); await value.click(SKIP); await judge(value); await finish(value); current(value, F, "rate_display");
    await value.click(SKIP); current(value, C); assertNoCompletion(value, F); await judge(value); current(value, C, "rate_display");
    await value.click(); current(value, C, "rate_display"); await value.click(); current(value, F, "rate_display"); await finish(value); current(value, O);
  } finally { value.close(); }
});
await test("last remaining high-priority area refuses skip and finishes into Done", async () => {
  const raw = state(); for (const progress of Object.values(raw.areaProgressMap)) completed(progress);
  Object.assign(raw.areaProgressMap[F], { status: "unstarted", completedAt: undefined }); const value = fixture(raw);
  try { await judge(value, "many"); const before = json(value.app.state); await value.click(SKIP); assert.deepEqual(json(value.app.state), before); assert.match(value.app.derived.undoNotice ?? "", /他にスキップできるエリアがありません/); await finish(value); assert.equal(value.app.state.screen, "done"); } finally { value.close(); }
});
await test("end of normal route completes high priority before ordinary pending and never enters Done with candidates", async () => {
  const raw = state("15", "normal", "hosomaki");
  Object.assign(raw.areaProgressMap[F], { status: "skipped_manual", areaCountEvaluation: "many", areaRateAdjustment: 10, completedAt: undefined });
  Object.assign(raw.areaProgressMap[Y], { status: "skipped_manual", areaCountEvaluation: "normal", completedAt: undefined });
  const value = fixture(raw);
  try {
    await judge(value); await finish(value); current(value, F, "rate_display"); assert.equal(value.app.state.priorityReturnContext?.normalResumeAreaId, null);
    await finish(value); current(value, Y, "rate_display"); assert.equal(value.app.state.priorityReturnContext, undefined);
    await finish(value); assert.equal(value.app.state.screen, "done");
  } finally { value.close(); }
});
await test("old active autumn observation is preserved while hook current/skip/correction targets exclude it", async () => {
  DATE = "2026-10-13"; const raw = state();
  raw.areaProgressMap.autumn = { areaId: "autumn", status: "skipped_manual", areaJudge: "normal", areaCount: 9,
    areaCountEvaluation: "many", areaCountEvaluationSource: "manual", areaRateAdjustment: 10, measurementStatus: "measured", completedManyRateText: "30%", completedNormalRateText: "20%" };
  raw.normalFlowOrder = getNormalRoute(DATE).flatMap(id => id === "tempura" ? [id, "autumn" as const] : [id]); raw.currentAreaId = "autumn"; raw.screen = "rate_display";
  const original = json(raw.areaProgressMap.autumn), value = fixture(raw);
  try {
    assert.notEqual(value.app.state.currentAreaId, "autumn"); assert.ok(!value.app.state.normalFlowOrder?.includes("autumn")); assert.deepEqual(json(value.app.state.areaProgressMap.autumn), original);
    assert.ok(!value.app.derived.skipTargetOptions.some(option => option.areaId === "autumn"));
    const before = json(value.app.state); value.app.actions.startAreaCountCorrection("autumn"); value.render(); assert.deepEqual(json(value.app.state), before);
    value.app.actions.chooseSkipTargetArea("autumn"); value.render(); assert.deepEqual(json(value.app.state), before);
    current(value, F); await judge(value); await finish(value); current(value, Y); assert.deepEqual(json(value.app.state.areaProgressMap.autumn), original);
  } finally { value.close(); }
});
for (const operation of ["back", "undo"] as const) await test(`legacy ${operation} snapshot pointing to autumn safely returns to active work and keeps observed progress`, async () => {
  const raw = state(); raw.areaProgressMap.autumn = { areaId: "autumn", status: "skipped_manual", areaJudge: "normal", areaCount: 9,
    areaCountEvaluation: "many", areaRateAdjustment: 10, measurementStatus: "measured" };
  raw.normalFlowOrder = getNormalRoute(DATE).flatMap(id => id === "tempura" ? [id, "autumn" as const] : [id]);
  const old = { ...json(raw), currentAreaId: "autumn" as const, screen: "rate_display" as const };
  const navigation = createNavigationSnapshot({ state: old, areaJudgeSelection: "normal", resumeTargetScreen: null, nextSessionSkipRecords: [], lastSessionWeather: null });
  const runtime = { areaJudgeSelection: null, resumeTargetScreen: null, timeSwitchTarget: null, undoSnapshot: navigation, screenHistory: [navigation], weatherConfirmationPending: null };
  const value = fixture(raw, at("15:10:00"), false, [], runtime);
  try {
    if (operation === "back") await value.click("戻る"); else { value.app.actions.undoLastAction(); value.render(); }
    current(value, F); assert.deepEqual(json(value.app.state.areaProgressMap.autumn), raw.areaProgressMap.autumn); assert.ok(!value.app.state.normalFlowOrder?.includes("autumn"));
    await judge(value); await finish(value); current(value, Y);
  } finally { value.close(); }
});
await test("undo of completion restores ordinary area and priority candidate; repeat completion follows same continuation", async () => {
  const value = fixture();
  try {
    await judge(value, "many"); await value.click(SKIP); await judge(value); await finish(value); current(value, F, "rate_display");
    value.app.actions.undoLastAction(); value.render(); current(value, Y, "rate_display"); assertNoCompletion(value, Y); assertNoCompletion(value, F);
    await finish(value); current(value, F, "rate_display"); await finish(value); current(value, C);
  } finally { value.close(); }
});
await test("back from priority return restores pre-completion navigation and re-completion cannot lose normal continuation", async () => {
  const value = fixture();
  try {
    await judge(value, "many"); await value.click(SKIP); await judge(value); await finish(value); current(value, F, "rate_display");
    await value.click("戻る"); current(value, Y, "rate_display"); assertNoCompletion(value, Y); await finish(value); current(value, F, "rate_display"); await finish(value); current(value, C);
  } finally { value.close(); }
});
await test("reload within priority return and top resume keep saved onigiri continuation", async () => {
  let value = fixture();
  try {
    await judge(value, "many"); await value.click(SKIP); await judge(value, "slightly_many"); await value.click(SKIP); await judge(value); await finish(value); current(value, Y, "rate_display");
    value.close(); clean(); value = new AppFixture(); value.render(); current(value, Y, "rate_display");
    value.app.actions.startEditingConditions(); value.render(); assert.equal(value.app.state.screen, "start"); value.app.actions.startSession(); value.render(); current(value, Y, "rate_display");
    await finish(value); current(value, F, "rate_display"); await finish(value); current(value, O);
  } finally { value.close(); }
});
await test("foreign-session saved continuation is rejected before real completion builds the current session continuation", async () => {
  DATE = "2026-10-13"; const raw = state(); raw.priorityReturnContext = { sessionStartedAt: "2026-10-12T06:00:00.000Z", sessionDate: "2026-10-12", sessionDiscountTime: "15", normalResumeAreaId: O };
  const value = fixture(raw);
  try {
    assert.equal(value.app.state.priorityReturnContext, undefined); await judge(value, "many"); await value.click(SKIP); await judge(value); await finish(value); current(value, F, "rate_display");
    assert.equal(value.app.state.priorityReturnContext?.normalResumeAreaId, C); await finish(value); current(value, C); assert.equal(value.app.state.priorityReturnContext, undefined);
  } finally { value.close(); }
});
await test("15-to17 automatic transition from priority return keeps unfinished-first routing and clears prior session continuation", async () => {
  const value = fixture(state(), at("16:39:59"));
  try {
    await judge(value, "many"); await value.click(SKIP); await judge(value); await finish(value); current(value, F, "rate_display"); assert.equal(value.app.state.priorityReturnContext?.normalResumeAreaId, C);
    const previousSession = value.app.state.session?.startedAt; nowMs = at("16:40:00"); windowEvents.emit("focus"); value.render(); assert.equal(value.app.state.screen, "start"); assert.match(alerts.join("\n"), /未完了のエリアから/);
    value.app.actions.startSession(); value.render(); assert.equal(value.app.state.session?.discountTime, "17"); assert.notEqual(value.app.state.session?.startedAt, previousSession);
    assert.equal(value.app.state.priorityReturnContext, undefined); assert.deepEqual(value.app.state.normalFlowOrder?.slice(0, 2), [F, C]);
    if (value.app.state.screen === "advance_discount") { value.app.actions.continueAfterAdvanceDiscount(); value.render(); } current(value, F);
    assert.ok(storage.loadDailySessionSnapshots().some(snapshot => snapshot.session.startedAt === previousSession));
  } finally { value.close(); }
});
await test("temporary count correction respects prior screen before priority selection continues", async () => {
  const value = fixture();
  try {
    await judge(value, "many"); await value.click(SKIP); await judge(value); await finish(value); current(value, F, "rate_display");
    value.app.actions.startAreaCountCorrection(Y); value.render(); current(value, Y); assert.ok(value.app.state.areaCountCorrection);
    await judge(value, "normal"); await finish(value); current(value, F, "rate_display"); assert.equal(value.app.state.areaCountCorrection, null);
    await finish(value); current(value, C);
  } finally { value.close(); }
});
for (const mode of ["normal", "auto_skip_count_only"] as const) await test(`legacy ${mode} correction whose saved return is autumn resumes active work and retains observation`, async () => {
  DATE = "2026-10-13"; const raw = state(); raw.currentAreaId = Y;
  raw.areaProgressMap.autumn = { areaId: "autumn", status: "skipped_manual", areaJudge: "normal", areaCount: 9,
    areaCountEvaluation: "many", measurementStatus: "measured" };
  raw.normalFlowOrder = getNormalRoute(DATE).flatMap(id => id === "tempura" ? [id, "autumn" as const] : [id]);
  Object.assign(raw.areaProgressMap[Y], { areaJudge: "normal", areaCount: 20, areaCountEvaluation: "normal", areaRateAdjustment: 0,
    ...(mode === "auto_skip_count_only" ? { status: "auto_skipped_late_time", autoSkipKind: "early_next_minus5", earlyDiscountResolution: "count_only" } : {}) });
  raw.screen = mode === "normal" ? "rate_display" : "auto_skip_count";
  raw.areaCountCorrection = { mode, targetAreaId: Y, returnScreen: "rate_display", returnAreaId: "autumn", returnLastReferenceAreaId: "autumn",
    returnCurrentFlow: "pending", returnPendingDeferredAreaIds: ["autumn"], returnFinalTimeStep: 0, returnTimeSwitchNotice: null, returnHistoryLength: 0 };
  const original = json(raw.areaProgressMap.autumn), value = fixture(raw);
  try {
    current(value, Y, mode === "normal" ? "rate_display" : "auto_skip_count");
    if (mode === "normal") await finish(value);
    else {
      const input = value.nodes.find(node => node.type === "input" && node.props.id === "auto-skip-area-count"); assert.ok(input);
      (input.props.onChange as (event: unknown) => void)({ currentTarget: { value: "31" } }); value.render();
      const form = value.nodes.find(node => node.type === "form"); assert.ok(form);
      (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); value.render();
      assert.equal(value.app.state.areaProgressMap[Y].areaCount, 31); assert.equal(value.app.state.areaProgressMap[Y].status, "auto_skipped_late_time");
    }
    current(value, F); assert.equal(value.app.state.areaCountCorrection, null); assert.deepEqual(json(value.app.state.areaProgressMap.autumn), original);
    assert.ok(!value.app.state.pendingDeferredAreaIds.includes("autumn")); assert.ok(!value.app.state.normalFlowOrder?.includes("autumn"));
  } finally { value.close(); }
});

function oldTwelveAreaReview(raw: AppState, autumn: "missing" | "excluded" | "recorded") {
  const expectedAreaIds = getNormalRoute(DATE).flatMap(id => id === "tempura" ? [id, "autumn" as const] : [id]);
  const review = createInitialReview19Result({ date: DATE, sessionStartedAt: raw.session!.startedAt, demandCycle: "normal", expectedAreaIds,
    reviewStartedAt: new NativeDate(at("18:55:00")).toISOString(), excludedAreaIds: autumn === "excluded" ? ["autumn"] : [] });
  const selection = createHumanEvaluationSelection("normal"); assert.ok(selection);
  for (const id of autumn === "recorded" ? expectedAreaIds : getNormalRoute(DATE)) {
    review.areaCounts[id] = id === "autumn" ? 9 : 20;
    review.areaEvaluations[id] = { humanEvaluation: "normal", humanEvaluationDetails: createReview19HumanEvaluationDetails({
      selection, demandCycle: "normal", evaluatedAt: new NativeDate(at("19:00:00")).toISOString() }) };
  }
  review.dataQuality = buildReview19DataQuality({ date: DATE, expectedAreaIds, areaCounts: review.areaCounts,
    areaEvaluations: review.areaEvaluations, excludedAreaIds: review.excludedAreaIds });
  if (autumn === "recorded") review.recordedAt = new NativeDate(at("19:05:00")).toISOString();
  return review;
}
for (const autumn of ["missing", "excluded"] as const) await test(`resumed old12 live Review19 with autumn ${autumn} has complete11 quality immediately after load`, () => {
  DATE = "2026-10-13"; const raw = state("17"); raw.screen = "review19"; raw.currentAreaId = null;
  raw.review19 = oldTwelveAreaReview(raw, autumn); assert.equal(raw.review19.dataQuality.expectedAreaCount, 12);
  const savedCounts = json(raw.review19.areaCounts), savedEvaluations = json(raw.review19.areaEvaluations), value = fixture(raw, at("19:00:00"));
  try {
    assert.equal(value.app.state.screen, "review19"); const review = value.app.state.review19; assert.ok(review);
    assert.equal(review.expectedAreaIds?.length, 11); assert.equal(review.dataQuality.expectedAreaCount, 11); assert.equal(review.dataQuality.complete, true);
    assert.equal(review.dataQuality.excludedAreaCount, 0); assert.deepEqual(review.dataQuality.missingAreaIds, []); assert.deepEqual(review.dataQuality.missingHumanEvaluationAreaIds, []);
    assert.deepEqual(review.areaCounts, savedCounts); assert.deepEqual(json(review.areaEvaluations), savedEvaluations); assert.ok(!review.excludedAreaIds.includes("autumn"));
  } finally { value.close(); }
});
await test("recorded old12 Review19 in legacy Undo remains twelve and preserves autumn observations exactly", () => {
  DATE = "2026-10-13"; const raw = state("17"), old = json(raw);
  old.screen = "done"; old.currentAreaId = null; old.review19 = oldTwelveAreaReview(old, "recorded");
  for (const progress of Object.values(old.areaProgressMap)) completed(progress, "17");
  old.areaProgressMap.autumn = { areaId: "autumn", status: "completed", areaJudge: "normal", areaCount: 9, measurementStatus: "measured", completedAt: old.session!.startedAt };
  old.normalFlowOrder = old.review19.expectedAreaIds;
  const original = json(old.review19), navigation = createNavigationSnapshot({ state: old, areaJudgeSelection: null, resumeTargetScreen: null, nextSessionSkipRecords: [], lastSessionWeather: null });
  const runtime = { areaJudgeSelection: null, resumeTargetScreen: null, timeSwitchTarget: null, undoSnapshot: navigation, screenHistory: [], weatherConfirmationPending: null };
  const value = fixture(raw, at("18:00:00"), false, [], runtime);
  try {
    value.app.actions.undoLastAction(); value.render(); assert.equal(value.app.state.screen, "done"); assert.deepEqual(json(value.app.state.review19), original);
    assert.equal(value.app.state.review19?.dataQuality.expectedAreaCount, 12); assert.equal(value.app.state.review19?.areaCounts.autumn, 9); assert.equal(value.app.state.review19?.dataQuality.complete, true);
  } finally { value.close(); }
});

for (const time of ["15", "17"] as const) for (const stage of ["many", "normal"] as const) await test(`${time}: priority return crosses boundary while displaying ${stage}; captured +5 and proper stages`, async () => {
  DATE = "2026-10-13"; const value = fixture(state(time), cutoff(time) - 1000);
  try {
    await judge(value, "slightly_many"); await value.click(SKIP); await judge(value); await finish(value); current(value, F, "rate_display");
    if (stage === "normal") await value.click();
    const before = json(value.app.state); nowMs = cutoff(time); windowEvents.emit("focus"); value.render(); assert.deepEqual(json(value.app.state), before, "clock cannot complete or snapshot return target");
    assert.match(value.app.derived.basisGuide.referenceConditionLabel, time === "15" ? /16時$/ : /18時$/);
    if (time === "15" && stage === "normal") assert.doesNotMatch(value.text(), /どちらでもない商品を[0-9]+%値引き/);
    await value.click();
    if (time === "17" && stage === "many") { current(value, F, "rate_display"); assertNoCompletion(value, F); await value.click(); }
    current(value, C); const snapshot = value.app.state.areaProgressMap[F].rateDecisionSnapshot; assert.ok(snapshot); assert.equal(snapshot.lateTimeAdjustmentPercent, 5); assert.equal(snapshot.confirmedAt, new NativeDate(nowMs).toISOString());
    assert.equal(snapshot.sessionDiscountTime, time); assert.equal(snapshot.effectiveRateDiscountTime, time);
  } finally { value.close(); }
});
await test("late15 one-stage completion triggers priority and continuation exactly once", async () => {
  const value = fixture(state(), cutoff("15"));
  try {
    await judge(value, "many"); await value.click(SKIP); await judge(value); const old = value.button(); await invoke(old); await invoke(old); value.render(); current(value, F, "rate_display"); assertNoCompletion(value, F);
    await finish(value); current(value, C); assert.equal(Object.values(value.app.state.areaProgressMap).filter(p => p.rateDecisionSnapshot).length, 2);
  } finally { value.close(); }
});
await test("old finish/skip events from another area cannot finish or skip the priority target", async () => {
  const value = fixture();
  try {
    await judge(value, "many"); await value.click(SKIP); await judge(value); await value.click();
    const old = value.button(), oldAction = value.app.actions.goToNextArea, oldSkip = value.app.actions.skipCurrentArea;
    await invoke(old); value.render(); current(value, F, "rate_display"); const before = json(value.app.state), saved = persistence();
    await invoke(old); oldAction(); oldSkip(); value.render(); assert.deepEqual(json(value.app.state), before); assert.deepEqual(persistence(), saved);
  } finally { value.close(); }
});
await test("queued final judgment change invalidates stale completion and latest evaluation controls candidacy", async () => {
  const value = fixture();
  try {
    await judge(value, "many"); await value.click(SKIP); await judge(value); await value.click(); const old = value.button();
    await value.app.actions.judgeCurrentArea("normal", 20, "slightly_many"); await invoke(old); value.render(); current(value, Y, "rate_display"); assertNoCompletion(value, Y);
    await finish(value); current(value, F, "rate_display"); assert.equal(value.app.state.areaProgressMap[Y].areaCountEvaluation, "slightly_many");
  } finally { value.close(); }
});
await test("fixed-time priority judgments/completions preserve production AreaCount/outbox/day/Review19 READ ONLY", async () => {
  const value = fixture(state(), at("15:10:00"), true);
  try {
    const before = persistence(); await judge(value, "many"); await value.click(SKIP); await judge(value); await finish(value); current(value, F, "rate_display");
    value.fixedNow = new Date(cutoff("15")); value.render(); await finish(value); current(value, C);
    assert.deepEqual(persistence(), before); assert.equal(timeouts.size, 0);
  } finally { value.close(); }
});
await test("new October eleven-area operation completes every active area exactly once without autumn", async () => {
  DATE = "2026-10-13"; const value = fixture(state("15", "normal", "bento_men"));
  try {
    const visited: AreaId[] = [];
    for (let i = 0; i < 11; i++) { const id = value.app.state.currentAreaId; assert.ok(id); visited.push(id); await judge(value); await finish(value); }
    assert.equal(value.app.state.screen, "done"); assert.deepEqual(visited, getNormalRoute(DATE)); assert.equal(new Set(visited).size, 11); assert.ok(!visited.includes("autumn"));
    assert.equal(Object.values(value.app.state.areaProgressMap).filter(p => p.rateDecisionSnapshot).length, 11);
  } finally { value.close(); }
});
await test("old twelve-area17 source automatically starts eleven-area Review19, preserves autumn evidence and saves complete raw-human review", async () => {
  DATE = "2026-10-13"; const raw = state("17"); for (const progress of Object.values(raw.areaProgressMap)) completed(progress, "17");
  raw.areaProgressMap.autumn = { areaId: "autumn", status: "completed", areaJudge: "normal", areaCount: 9, measurementStatus: "measured",
    areaCountEvaluation: "many", areaRateAdjustment: 10, completedAt: raw.session!.startedAt, rateDecisionSnapshotStatus: "legacy_not_captured", completedManyRateText: "30%", completedNormalRateText: "20%" };
  raw.normalFlowOrder = getNormalRoute(DATE).flatMap(id => id === "tempura" ? [id, "autumn" as const] : [id]); raw.screen = "done"; raw.currentAreaId = null;
  const original = json(raw.areaProgressMap.autumn), value = fixture(raw, at("18:54:59"));
  const repository = new HistoricalArchiveRepository(new MemoryHistoricalArchiveAdapter());
  try {
    nowMs = at("18:55:00"); windowEvents.emit("focus"); value.render(); assert.equal(value.app.state.screen, "review19");
    assert.equal(value.app.state.review19?.expectedAreaIds?.length, 11); assert.ok(!value.app.state.review19?.expectedAreaIds?.includes("autumn"));
    assert.deepEqual(json(value.app.state.areaProgressMap.autumn), original); assert.deepEqual(json(storage.loadReview19SourceState()?.areaProgressMap.autumn), original);
    assert.ok(storage.loadDailySessionSnapshots().some(snapshot => snapshot.areas.autumn?.areaCount === 9), "saved17 source snapshot preserves recorded autumn observation");
    await initializeHistoricalArchiveRuntime({ repository, storage: new MemoryStorage() });
    const selection = createHumanEvaluationSelection("normal"); assert.ok(selection);
    for (const id of getNormalRoute(DATE)) { value.app.actions.updateReview19AreaCount(id, 20, "normal", selection); value.render(); }
    assert.equal(value.app.state.review19?.dataQuality.expectedAreaCount, 11); assert.equal(value.app.state.review19?.dataQuality.complete, true);
    assert.equal(value.app.state.review19?.dataQuality.missingAreaIds.includes("autumn"), false);
    await value.app.actions.saveReview19(); value.render(); assert.equal(value.app.state.screen, "review19_done");
    const archived = await repository.listReview19Records(); assert.equal(archived.ok, true); if (!archived.ok) assert.fail("memory archive read failed");
    assert.equal(archived.value.length, 1); assert.equal(archived.value[0].dataQuality.expectedAreaCount, 11); assert.equal(archived.value[0].dataQuality.complete, true);
    assert.equal(archived.value[0].areaCounts.autumn, undefined); assert.equal(Object.keys(archived.value[0].areaCounts).length, 11);
    for (const evaluation of Object.values(archived.value[0].areaEvaluations ?? {})) assert.equal(evaluation.humanEvaluationDetails?.humanEvaluationScore9, 5);
  } finally { value.close(); }
});

Object.defineProperty(globalThis, "Date", { configurable: true, value: NativeDate });
const summary = { passed: true, passedCases: results.length, totalCases: results.length, notes: [], examples, cases: results };
writeFileSync(new URL("../../tests55-flow-summary.json", import.meta.url), JSON.stringify(summary, null, 2) + "\n");
const finalLine = `Priority flow55 checks passed: ${results.length}/${results.length}`;
writeFileSync(new URL("../../check-priority-flow55.log", import.meta.url), [...logLines, finalLine].join("\n") + "\n"); console.log(finalLine);
