import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { AREA_COUNT_LOCAL_STORAGE_KEY, loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import { getNormalRoute, getAreaName } from "../src/domain/area.ts";
import { createHumanEvaluationSelection, resolveHumanEvaluationForDiscount } from "../src/domain/humanEvaluation.ts";
import { HistoricalArchiveRepository, MemoryHistoricalArchiveAdapter } from "../src/domain/historicalArchive.ts";
import { initializeHistoricalArchiveRuntime, getHistoricalDailySessionSnapshots } from "../src/domain/historicalArchiveRuntime.ts";
import { getAdoptedEvaluation, getNextPriorityPendingCandidate } from "../src/domain/pending.ts";
import { loadPendingSupabaseSyncQueue } from "../src/domain/supabaseSyncQueue.ts";
import * as storage from "../src/domain/storage.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { setRuntimeNowOverride } from "../src/hooks/nebikiApp/clock.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";
import type { AppState, AreaCountEvaluation, AreaId, AreaProgress, DailySessionSnapshot, DemandCycle, UseNebikiAppResult } from "../src/domain/types.ts";
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
  reads = new Map<string, number>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { this.reads.set(key, (this.reads.get(key) ?? 0) + 1); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes.push(key); this.values.set(key, String(value)); }
  removeItem(key: string) { this.removals.push(key); this.values.delete(key); }
  clear() { this.values.clear(); this.writes = []; this.removals = []; this.reads.clear(); }
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
  location: { search: "", hash: "", href: "http://priority63.invalid/", pathname: "/" },
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
const results: Array<{ name: string; ok: boolean }> = [];
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
function fixture(raw = state(), timestamp = at("15:10:00"), fixed = false, historical: unknown[] = [], runtime?: unknown, previous: DailySessionSnapshot[] = []) {
  clean(); memory.clear(); alerts.length = 0; nowMs = timestamp;
  memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(raw)); memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(raw));
  if (historical.length) memory.values.set(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(historical));
  if (runtime) memory.values.set(storage.STORAGE_KEYS.runtimeState, JSON.stringify(runtime));
  storage.saveDailySessionSnapshots(previous);
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
  const progress = value.app.state.areaProgressMap[id];
  const adopted = progress.areaCountEvaluation ?? progress.humanEvaluationDetails?.resolvedEvaluation ?? progress.areaCountDecisionBasis?.finalEvaluation;
  await value.click();
  if (!late15 || adopted === "many") { current(value, id, "rate_display"); if (!previouslyCompleted) assert.notEqual(value.app.state.areaProgressMap[id].status, "completed"); await value.click(); }
  assert.equal(value.app.state.areaProgressMap[id].status, "completed"); assert.ok(value.app.state.areaProgressMap[id].rateDecisionSnapshot);
}
function persistence() { return { records: loadLocalAreaCountRecords(), queue: loadPendingSupabaseSyncQueue(), daily: storage.loadDailySessionSnapshots(), skip: storage.loadNextSessionSkipRecords() }; }
function assertNoCompletion(value: AppFixture, id: AreaId) { assert.notEqual(value.app.state.areaProgressMap[id].status, "completed"); assert.equal(value.app.state.areaProgressMap[id].rateDecisionSnapshot, undefined); }
async function test(name: string, run: () => void | Promise<void>) {
  try { await run(); clean(); } catch (error) {
    writeFileSync(new URL("../../tests63-priority-summary.json", import.meta.url), JSON.stringify({ passed: false, passedCases: results.length, totalCases: results.length + 1, notes: [`${name}: ${String(error)}`], cases: results }, null, 2) + "\n"); throw error;
  }
  results.push({ name, ok: true }); const line = `PASS ${String(results.length).padStart(2, "0")}: ${name}`; logLines.push(line); console.log(line);
}

/** Saved source fixtures deliberately contain no current-history calculations. */
function previous15(evaluations: Partial<Record<AreaId, AreaCountEvaluation | undefined>> = { [F]: "many" },
  options: { date?: string; captured?: string; started?: string; cycle?: DemandCycle } = {}): DailySessionSnapshot {
  const date = options.date ?? DATE;
  const source = state("15", options.cycle ?? "normal");
  const session = { ...source.session!, date, startedAt: options.started ?? `${date}T15:00:00+09:00` };
  const areas = Object.fromEntries(Object.entries(source.areaProgressMap).map(([id, progress]) => [id, {
    ...progress, areaId: id, areaName: getAreaName(id as AreaId), status: "completed", areaJudge: "normal",
    areaCount: 20, areaCountEvaluation: evaluations[id as AreaId] ?? "normal", judgeText: "saved", rateText: "10%",
    rateDecisionSnapshotStatus: "legacy_not_captured", measurementStatus: "measured",
  }])) as DailySessionSnapshot["areas"];
  // Explicit undefined represents old evidence without a saved adopted result.
  for (const id of Object.keys(evaluations) as AreaId[]) {
    areas[id] ??= { ...areas[F], areaId: id, areaName: getAreaName(id) };
    areas[id].areaCountEvaluation = evaluations[id];
  }
  return { version: 1, capturedAt: options.captured ?? `${date}T16:30:00+09:00`, screen: "done",
    demandCycle: options.cycle ?? "normal", expectedAreaIds: getNormalRoute(date),
    session: { ...session, resolvedWeather: resolveWeatherInputForDiscount(session.weather, "15") },
    basis: { baseRateBonus: 0, lateTimeBonus: 0, totalRateBonus: 0, baseRateBonusReason: [] },
    areas, doneSummaryItems: [], currentAreaId: null, review19ExcludedAreaIds: [] };
}
function pendingMap(): Record<AreaId, AreaProgress> {
  const map = state("17").areaProgressMap;
  for (const progress of Object.values(map)) completed(progress, "17");
  map[F] = { areaId: F, status: "skipped_manual", areaJudge: null };
  return map;
}
function priority(map: Record<AreaId, AreaProgress>, previous: DailySessionSnapshot[], referenceAreaId: AreaId = C,
  time: "15" | "17" = "17") {
  return getNextPriorityPendingCandidate({ areaProgressMap: map, referenceAreaId,
    normalFlowOrder: getNormalRoute(DATE), session: { date: DATE, discountTime: time }, previousSessionSnapshots: previous });
}
function flow17(previous: DailySessionSnapshot[] = [previous15()], raw = state("17"), timestamp = at("17:10:00"), fixed = false) {
  return fixture(raw, timestamp, fixed, [], undefined, previous);
}
function missing17(value: AppFixture, id: AreaId = F) {
  const progress = value.app.state.areaProgressMap[id];
  assert.equal(progress.areaJudge, null); assert.equal(progress.areaCount, undefined);
  assert.equal(progress.areaCountEvaluation, undefined); assert.equal(progress.humanEvaluationDetails, undefined);
  assert.equal(progress.areaCountDecisionBasis, undefined); assert.equal(progress.rateDecisionSnapshot, undefined);
  assert.notEqual(progress.measurementStatus, "measured"); assert.notEqual(progress.status, "completed");
}

for (const evaluation of ["many", "slightly_many"] as const) await test(`pure: same-day15 saved ${evaluation} prioritizes unmeasured manual17 skip`, () => {
  const map = pendingMap(), previous = [previous15({ [F]: evaluation })], before = json({ map, previous });
  assert.equal(priority(map, previous)?.areaId, F); assert.deepEqual(json({ map, previous }), before);
});
for (const evaluation of ["normal", "slightly_few", "few"] as const) await test(`pure: own17 ${evaluation} defeats same-day15 many`, () => {
  const map = pendingMap(); map[F].areaCountEvaluation = evaluation;
  assert.equal(priority(map, [previous15()]), null);
});
await test("pure: current17 saved human or decision final wins before previous15 lookup", () => {
  const map = pendingMap(), selection = createHumanEvaluationSelection("normal")!;
  map[F].humanEvaluationDetails = resolveHumanEvaluationForDiscount({ selection, demandCycle: "normal",
    sessionDiscountTime: "17", nowMs: at("17:10:00"), evaluatedAt: new NativeDate(at("17:10:00")).toISOString() });
  assert.equal(priority(map, [previous15()]), null);
  delete map[F].humanEvaluationDetails;
  map[F].areaCountDecisionBasis = { ruleVersion: "area_count_median_v1", recommendationStatus: "ready",
    sampleSize: 3, requiredSampleSize: 3, baseEvaluation: "many", finalEvaluation: "few" };
  assert.equal(priority(map, [previous15()]), null);
});
for (const kind of ["automatic", "manual", "resolved_intermediate", "decision_final"] as const) await test(`pure: saved15 ${kind} final many-side is accepted`, () => {
  const source = previous15({ [F]: undefined }), area = source.areas[F];
  if (kind === "automatic") { area.areaCountEvaluation = "slightly_many"; area.areaCountEvaluationSource = "history"; }
  if (kind === "manual") { area.areaCountEvaluation = "many"; area.areaCountEvaluationSource = "manual"; }
  if (kind === "resolved_intermediate") {
    const selection = createHumanEvaluationSelection("slightly_many", "many")!;
    area.humanEvaluationDetails = resolveHumanEvaluationForDiscount({ selection, demandCycle: "normal", sessionDiscountTime: "15",
      nowMs: at("15:10:00"), evaluatedAt: new NativeDate(at("15:10:00")).toISOString() });
    assert.equal(area.humanEvaluationDetails.resolvedEvaluation, "slightly_many");
  }
  if (kind === "decision_final") area.areaCountDecisionBasis = { ruleVersion: "area_count_median_v1", recommendationStatus: "ready",
    sampleSize: 3, requiredSampleSize: 3, baseEvaluation: "normal", finalEvaluation: "slightly_many" };
  assert.equal(priority(pendingMap(), [source])?.areaId, F);
});
await test("pure: saved15 intermediate resolved normal is never re-resolved at17", () => {
  const source = previous15({ [F]: undefined }), selection = createHumanEvaluationSelection("normal", "slightly_many")!;
  source.areas[F].humanEvaluationDetails = resolveHumanEvaluationForDiscount({ selection, demandCycle: "summer", sessionDiscountTime: "17",
    nowMs: new NativeDate("2026-08-01T17:59:00+09:00").getTime(), evaluatedAt: "2026-08-01T17:59:00+09:00" });
  assert.equal(source.areas[F].humanEvaluationDetails?.resolvedEvaluation, "normal");
  assert.equal(priority(pendingMap(), [source]), null);
});
await test("pure: unresolved saved15 raw9 selection cannot supply a final adopted evaluation", () => {
  const source = previous15({ [F]: undefined }), selection = createHumanEvaluationSelection("slightly_many", "many")!;
  source.areas[F].humanEvaluationDetails = { ...selection, automaticEvaluation: "many", resolutionDirection: "lower",
    resolutionReason: "normal_15", evaluatedAt: `${DATE}T15:10:00+09:00`, sessionDiscountTime: "15", demandCycle: "normal" };
  assert.equal(source.areas[F].humanEvaluationDetails.resolvedEvaluation, undefined);
  assert.equal(priority(pendingMap(), [source]), null);
});
await test("pure: saved15 direct adopted normal defeats stale human many and raw automatic many", () => {
  const source = previous15({ [F]: "normal" }), selection = createHumanEvaluationSelection("many")!;
  source.areas[F].humanEvaluationDetails = resolveHumanEvaluationForDiscount({ selection, demandCycle: "normal", sessionDiscountTime: "15",
    nowMs: at("15:10:00"), evaluatedAt: `${DATE}T15:10:00+09:00` });
  source.areas[F].areaCountDecisionBasis = { ruleVersion: "area_count_median_v1", recommendationStatus: "ready",
    sampleSize: 3, requiredSampleSize: 3, baseEvaluation: "many", finalEvaluation: "many" };
  assert.equal(priority(pendingMap(), [source]), null);
});
for (const wrong of ["raw_base", "judge_only", "no_result"] as const) await test(`pure: saved15 ${wrong} cannot invent adopted many`, () => {
  const source = previous15({ [F]: undefined });
  source.areas[F].areaJudge = "many";
  if (wrong === "raw_base") source.areas[F].areaCountDecisionBasis = { ruleVersion: "area_count_median_v1", recommendationStatus: "ready",
    sampleSize: 3, requiredSampleSize: 3, baseEvaluation: "many" };
  assert.equal(priority(pendingMap(), [source]), null);
});
for (const wrong of ["yesterday", "future", "17time", "other_area", "no_source", "15session"] as const) await test(`pure: ${wrong} does not supply previous15 fallback`, () => {
  const source = previous15(wrong === "other_area" ? { [Y]: "many" } : { [F]: "many" },
    { date: wrong === "yesterday" ? "2026-10-12" : wrong === "future" ? "2026-10-14" : DATE });
  if (wrong === "17time") source.session.discountTime = "17";
  assert.equal(priority(pendingMap(), wrong === "no_source" ? [] : [source], C, wrong === "15session" ? "15" : "17"), null);
});
for (const status of ["unstarted", "completed", "postponed_few", "auto_skipped_late_time"] as const) await test(`pure: ${status}17 is not an explicit manual skip`, () => {
  const map = pendingMap(); map[F].status = status;
  assert.equal(priority(map, [previous15()]), null);
});
await test("pure: direct and previous15 candidates use one nearest-distance set", () => {
  const map = pendingMap(); map[Y] = { areaId: Y, areaJudge: "normal", status: "skipped_manual", areaCountEvaluation: "slightly_many" };
  assert.equal(priority(map, [previous15()])?.areaId, Y, "nearer own17 candidate beats distant previous15 candidate");
  map[F].areaCountEvaluation = "many"; delete map[Y].areaCountEvaluation; map[Y].areaJudge = null;
  assert.equal(priority(map, [previous15({ [Y]: "slightly_many" })])?.areaId, Y, "nearer previous15 candidate beats distant own17 candidate");
});
await test("pure: combined set preserves stable area-order tie and excludes reference", () => {
  const map = pendingMap(); map[F].status = "completed";
  map[Y] = { areaId: Y, areaJudge: null, status: "skipped_manual" };
  map.tempura = { areaId: "tempura", areaJudge: "normal", status: "skipped_manual", areaCountEvaluation: "many" };
  const previous = [previous15({ [Y]: "slightly_many" })];
  assert.equal(priority(map, previous, "croquette")?.areaId, "tempura");
  assert.equal(priority(map, previous, Y)?.areaId, "tempura");
  assert.equal(priority(Object.fromEntries(Object.entries(map).reverse()) as Record<AreaId, AreaProgress>, previous, "croquette")?.areaId, "tempura");
});
await test("pure: disabled and off-route seasonal evidence cannot become a candidate", () => {
  const map = pendingMap(); map[F].status = "completed";
  map.autumn = { areaId: "autumn", areaJudge: null, status: "skipped_manual" };
  map.ryomi = { areaId: "ryomi", areaJudge: null, status: "skipped_manual" };
  const source = previous15({ autumn: "many", ryomi: "many" });
  assert.equal(priority(map, [source]), null);
});
for (const ordered of [true, false]) await test(`pure: latest corrected15 normal supersedes old many independent of input order=${ordered}`, () => {
  const old = previous15(), corrected = previous15({ [F]: "normal" }, { captured: `${DATE}T16:35:00+09:00` });
  assert.equal(priority(pendingMap(), ordered ? [old, corrected] : [corrected, old]), null);
});
await test("pure: latest corrected15 many restores candidacy without rewriting source", () => {
  const old = previous15({ [F]: "normal" }), corrected = previous15({ [F]: "slightly_many" }, { captured: `${DATE}T16:35:00+09:00` });
  const before = json([old, corrected]); assert.equal(priority(pendingMap(), [corrected, old])?.areaId, F);
  assert.deepEqual(json([old, corrected]), before);
});
await test("pure: latest15 session without final does not resurrect older session many", () => {
  const old = previous15(), latest = previous15({ [F]: undefined }, { started: `${DATE}T15:20:00+09:00`, captured: `${DATE}T16:35:00+09:00` });
  assert.equal(priority(pendingMap(), [old, latest]), null);
});
for (const shape of ["missing_areas", "missing_area", "mismatched_area"] as const) await test(`pure: latest15 ${shape} safely blocks older many`, () => {
  const old = previous15(), latest = previous15({}, { captured: `${DATE}T16:35:00+09:00` });
  if (shape === "missing_areas") delete (latest as Partial<DailySessionSnapshot>).areas;
  if (shape === "missing_area") delete (latest.areas as Partial<DailySessionSnapshot["areas"]>)[F];
  if (shape === "mismatched_area") latest.areas[F] = { ...latest.areas[F], areaId: Y, areaCountEvaluation: "many" };
  assert.equal(priority(pendingMap(), [old, latest]), null);
});
await test("pure: saved partial15 auto-time-transition snapshot supports final adopted evidence", () => {
  const source = previous15(); source.screen = "rate_display"; source.sessionEndReason = "auto_time_transition";
  source.areas[F].status = "skipped_manual";
  assert.equal(priority(pendingMap(), [source])?.areaId, F);
});
await test("pure: unsealed in-progress15 snapshot cannot introduce a fallback", () => {
  const source = previous15(); source.screen = "rate_display";
  assert.equal(priority(pendingMap(), [source]), null);
});
await test("pure: raw current17 base and three-level judge never outrank a saved final15", () => {
  const map = pendingMap(); map[F].areaJudge = "many";
  map[F].areaCountDecisionBasis = { ruleVersion: "area_count_median_v1", recommendationStatus: "ready",
    sampleSize: 3, requiredSampleSize: 3, baseEvaluation: "few" };
  assert.equal(getAdoptedEvaluation(map[F]), undefined);
  assert.equal(priority(map, [previous15()])?.areaId, F);
  assert.equal(priority(map, [previous15({ [F]: "normal" })]), null);
});

for (const cycle of ["normal", "summer"] as const) await test(`real ${cycle}: unmeasured17 skip returns only after other area full completion and opens count keypad`, async () => {
  DATE = cycle === "normal" ? "2026-10-13" : "2026-09-08";
  const previous = previous15({ [F]: "many" }, { cycle }), value = flow17([previous], state("17", cycle));
  try {
    const saved = json(storage.loadDailySessionSnapshots().find(item => item.session.discountTime === "15"));
    missing17(value); await value.click(SKIP); current(value, Y); missing17(value);
    await judgeUi(value, "normal"); await value.click(); current(value, Y, "rate_display"); assertNoCompletion(value, Y);
    assert.equal(value.app.state.priorityReturnContext, undefined, "first instruction cannot start priority return"); missing17(value);
    await value.click(); current(value, F); missing17(value); assert.equal(value.app.state.areaProgressMap[F].status, "skipped_manual");
    assert.ok(value.nodes.some(node => node.type === "button" && textOf(node) === "2"), "actual missing17 count keypad is shown");
    assert.equal(value.app.state.priorityReturnContext?.normalResumeAreaId, C);
    assert.deepEqual(json(storage.loadDailySessionSnapshots().find(item => item.session.discountTime === "15")), saved);
    await judgeUi(value, "normal"); await finish(value); current(value, C);
    assert.equal(value.app.state.priorityReturnContext, undefined); assert.equal(value.app.state.areaProgressMap[F].areaCount, 20);
  } finally { value.close(); }
});
DATE = "2026-10-13";
for (const adopted of ["normal", "slightly_few", "few"] as const) await test(`real: own17 ${adopted} manual skip does not use many15 fallback`, async () => {
  const value = flow17();
  try {
    await judge(value, adopted); await value.click(SKIP); current(value, Y);
    await judge(value); await finish(value); current(value, C);
    assert.equal(value.app.state.areaProgressMap[F].areaCountEvaluation, adopted); assertNoCompletion(value, F);
    assert.equal(value.app.state.priorityReturnContext, undefined);
  } finally { value.close(); }
});
await test("real: previous15 normal leaves unmeasured17 skip for ordinary pending", async () => {
  const value = flow17([previous15({ [F]: "normal" })]);
  try {
    await value.click(SKIP); await judge(value); await finish(value); current(value, C); missing17(value);
    assert.equal(value.app.state.priorityReturnContext, undefined);
  } finally { value.close(); }
});
await test("real: saved partial15 auto-time-transition returns unmeasured17 skip through actual events", async () => {
  const source = previous15({ [F]: "slightly_many" }); source.screen = "rate_display";
  source.sessionEndReason = "auto_time_transition"; source.areas[F].status = "skipped_manual";
  const value = flow17([source]);
  try {
    await value.click(SKIP); await judgeUi(value, "normal"); await finish(value); current(value, F); missing17(value);
    await judgeUi(value, "normal"); await finish(value); current(value, C);
  } finally { value.close(); }
});
await test("real: current17 human normal saved adoption defeats previous15 many", async () => {
  const value = flow17();
  try {
    await judge(value, "normal", true); assert.equal(value.app.state.areaProgressMap[F].humanEvaluationDetails?.resolvedEvaluation, "normal");
    await value.click(SKIP); await judgeUi(value, "normal"); await finish(value); current(value, C);
    assert.equal(value.app.state.areaProgressMap[F].status, "skipped_manual"); assertNoCompletion(value, F);
  } finally { value.close(); }
});
await test("real: source15 human intermediate uses its saved lower final without17 re-resolution", async () => {
  const source = previous15({ [F]: undefined }), selection = createHumanEvaluationSelection("normal", "slightly_many")!;
  source.areas[F].humanEvaluationDetails = resolveHumanEvaluationForDiscount({ selection, demandCycle: "normal", sessionDiscountTime: "15",
    nowMs: at("15:10:00"), evaluatedAt: `${DATE}T15:10:00+09:00` });
  assert.equal(source.areas[F].humanEvaluationDetails.resolvedEvaluation, "normal");
  const value = flow17([source]);
  try {
    await value.click(SKIP); await judgeUi(value, "normal"); await finish(value); current(value, C); missing17(value);
  } finally { value.close(); }
});
await test("real: previous15 and current17 priority candidates chain by distance then resume onigiri", async () => {
  const value = flow17();
  try {
    await value.click(SKIP); await judge(value, "slightly_many"); await value.click(SKIP); current(value, C);
    await judge(value); await finish(value); current(value, Y, "rate_display");
    assert.equal(value.app.state.priorityReturnContext?.normalResumeAreaId, O);
    await finish(value); current(value, F); missing17(value);
    await judgeUi(value, "normal"); await finish(value); current(value, O);
    assert.equal(value.app.state.priorityReturnContext, undefined);
  } finally { value.close(); }
});
await test("real: two unmeasured17 fallback skips chain through area_judge and preserve normal continuation", async () => {
  const value = flow17([previous15({ [F]: "many", [Y]: "slightly_many" })]);
  try {
    await value.click(SKIP); await value.click(SKIP); current(value, C); await judge(value); await finish(value); current(value, Y);
    missing17(value, Y); assert.equal(value.app.state.priorityReturnContext?.normalResumeAreaId, O);
    await judgeUi(value, "normal"); await finish(value); current(value, F); missing17(value);
    await judgeUi(value, "normal"); await finish(value); current(value, O);
  } finally { value.close(); }
});
await test("real: missing17 priority reload and top resume retain keypad and saved continuation", async () => {
  let value = flow17();
  try {
    await value.click(SKIP); await judge(value); await finish(value); current(value, F); missing17(value);
    value.close(); clean(); value = new AppFixture(); value.render(); current(value, F); missing17(value);
    assert.equal(value.app.state.priorityReturnContext?.normalResumeAreaId, C);
    value.app.actions.startEditingConditions(); value.render(); assert.equal(value.app.state.screen, "start");
    value.app.actions.startSession(); value.render(); current(value, F); missing17(value);
    await judgeUi(value, "normal"); await finish(value); current(value, C);
  } finally { value.close(); }
});
for (const operation of ["back", "undo"] as const) await test(`real: ${operation} from missing17 return restores completing area; repeat finish returns once`, async () => {
  const value = flow17();
  try {
    await value.click(SKIP); await judge(value); await finish(value); current(value, F); missing17(value);
    if (operation === "back") await value.click("戻る"); else { value.app.actions.undoLastAction(); value.render(); }
    current(value, Y, "rate_display"); assertNoCompletion(value, Y); missing17(value);
    await finish(value); current(value, F); missing17(value); await judgeUi(value, "normal"); await finish(value); current(value, C);
  } finally { value.close(); }
});
await test("real: count correction during missing17 priority returns to keypad before normal continuation", async () => {
  const value = flow17();
  try {
    await value.click(SKIP); await judge(value); await finish(value); current(value, F);
    value.app.actions.startAreaCountCorrection(Y); value.render(); current(value, Y); assert.ok(value.app.state.areaCountCorrection);
    await judge(value, "slightly_many"); await finish(value); current(value, F); missing17(value);
    assert.equal(value.app.state.areaCountCorrection, null); assert.equal(value.app.state.priorityReturnContext?.normalResumeAreaId, C);
    await judgeUi(value, "normal"); await finish(value); current(value, C);
  } finally { value.close(); }
});
await test("real: correction of15 source to normal before completion removes stale candidate without rerender", async () => {
  const value = flow17();
  try {
    await value.click(SKIP); await judge(value); await value.click();
    const corrected = previous15({ [F]: "normal" }, { captured: `${DATE}T17:11:00+09:00` });
    corrected.areas[F].measurementRecordedAt = corrected.capturedAt;
    storage.upsertDailySessionSnapshot(corrected);
    nowMs = at("17:12:00");
    await value.click(); current(value, C); missing17(value); assert.equal(value.app.state.priorityReturnContext, undefined);
  } finally { value.close(); }
});
await test("real: correction of15 source to many before completion enables fresh candidate without rerender", async () => {
  const value = flow17([previous15({ [F]: "normal" })]);
  try {
    await value.click(SKIP); await judge(value); await value.click();
    const corrected = previous15({ [F]: "slightly_many" }, { captured: `${DATE}T17:11:00+09:00` });
    corrected.areas[F].measurementRecordedAt = corrected.capturedAt;
    storage.upsertDailySessionSnapshot(corrected);
    nowMs = at("17:12:00");
    await value.click(); current(value, F); missing17(value);
    await judgeUi(value, "normal"); await finish(value); current(value, C);
  } finally { value.close(); }
});
await test("real: ordinary15 session never uses supplied15 source as fallback", async () => {
  const value = fixture(state("15"), at("15:10:00"), false, [], undefined, [previous15()]);
  try {
    await value.click(SKIP); await judge(value); await finish(value); current(value, C); missing17(value);
    assert.equal(value.app.state.priorityReturnContext, undefined);
  } finally { value.close(); }
});
await test("real: previous15 eligibility does not write a17 observation or old15 adopted value", async () => {
  const value = flow17();
  try {
    const saved = json(storage.loadDailySessionSnapshots()); await value.click(SKIP); await judge(value); await finish(value); current(value, F);
    missing17(value); assert.equal(loadLocalAreaCountRecords().filter(record => record.date === DATE && record.discountTime === "17" && record.areaId === F).length, 0);
    assert.deepEqual(json(storage.loadDailySessionSnapshots()), saved);
    await judgeUi(value, "normal"); assert.equal(value.app.state.areaProgressMap[F].areaCountEvaluation, "normal");
    assert.equal(loadLocalAreaCountRecords().find(record => record.areaId === F)?.suggestedEvaluation, "normal");
    await finish(value); current(value, C); assert.deepEqual(json(storage.loadDailySessionSnapshots()), saved);
  } finally { value.close(); }
});
await test("real: duplicate old completion events cannot complete or skip returned missing17 target", async () => {
  const value = flow17();
  try {
    await value.click(SKIP); await judge(value); await value.click();
    const old = value.button(), oldAction = value.app.actions.goToNextArea, oldSkip = value.app.actions.skipCurrentArea;
    await invoke(old); value.render(); current(value, F); const before = json(value.app.state), saved = persistence();
    await invoke(old); oldAction(); oldSkip(); value.render(); current(value, F); missing17(value);
    assert.deepEqual(json(value.app.state), before); assert.deepEqual(persistence(), saved);
  } finally { value.close(); }
});
await test("real: fixed-time missing17 skips ignore production15 sources and remain READ ONLY", async () => {
  const value = flow17([previous15()], state("17"), at("17:10:00"), true);
  try {
    const before = persistence(); await value.click(SKIP); await judge(value); await finish(value); current(value, C); missing17(value);
    assert.equal(value.app.state.priorityReturnContext, undefined); assert.deepEqual(persistence(), before);
  } finally { value.close(); }
});
await test("real: fixed-time own17 many keeps existing priority and READ ONLY behavior", async () => {
  const value = flow17([previous15({ [F]: "normal" })], state("17"), at("17:10:00"), true);
  try {
    const before = persistence(); await judge(value, "many"); await value.click(SKIP); await judge(value); await finish(value); current(value, F, "rate_display");
    await finish(value); current(value, C); assert.deepEqual(persistence(), before);
  } finally { value.close(); }
});
await test("real: actual15 Done correction persists latest normal/many for reloaded automatic17 operation", async () => {
  for (const correctedEvaluation of ["normal", "many"] as const) {
    const raw = state("15");
    for (const progress of Object.values(raw.areaProgressMap)) completed(progress);
    raw.areaProgressMap[F].areaCountEvaluation = correctedEvaluation === "normal" ? "many" : "normal";
    raw.areaProgressMap[F].areaRateAdjustment = correctedEvaluation === "normal" ? 10 : 0;
    raw.screen = "done"; raw.currentAreaId = null;
    let value = fixture(raw, at("15:10:00"));
    try {
      assert.equal(value.app.state.screen, "done");
      const original = storage.loadDailySessionSnapshots().find(item => item.session.discountTime === "15");
      assert.ok(original); assert.notEqual(original.areas[F].areaCountEvaluation, correctedEvaluation);
      nowMs = at("15:20:00");
      value.app.actions.startAreaCountCorrection(F); value.render(); current(value, F);
      assert.equal(value.app.state.areaCountCorrection?.returnScreen, "done");
      // The correction keypad starts with the saved20; submit and select through the real manual UI.
      await value.click("完了");
      const option = value.nodes.find(node => node.type === "button" && node.props["data-evaluation"] === correctedEvaluation);
      assert.ok(option); await invoke(option); await settle(value); current(value, F, "rate_display");
      assert.equal(value.app.state.areaProgressMap[F].areaCount, 20);
      assert.equal(value.app.state.areaProgressMap[F].areaCountEvaluation, correctedEvaluation);
      await finish(value); assert.equal(value.app.state.screen, "done");
      const saved = storage.loadDailySessionSnapshots().filter(item => item.session.discountTime === "15");
      assert.equal(saved.length, 1); assert.equal(saved[0].areas[F].areaCountEvaluation, correctedEvaluation);
      assert.notEqual(saved[0].capturedAt, original.capturedAt);
      assert.equal(saved[0].areas[F].humanEvaluationDetails?.resolvedEvaluation, correctedEvaluation);
      const correctedSource = json(saved[0]);
      value.close(); clean(); nowMs = at("17:10:00");
      value = new AppFixture(); value.render(); windowEvents.emit("focus"); value.render();
      assert.equal(value.app.state.screen, "start"); value.app.actions.startSession(); value.render();
      assert.equal(value.app.state.session?.discountTime, "17");
      if (value.app.state.screen === "advance_discount") { value.app.actions.continueAfterAdvanceDiscount(); value.render(); }
      for (let index = 0; value.app.state.currentAreaId !== F; index++) {
        assert.ok(index < 4, "fresh17 route reaches fry_chicken without an extra operation");
        await judgeUi(value, "normal"); await finish(value);
      }
      current(value, F); missing17(value); await value.click(SKIP); current(value, Y);
      await judgeUi(value, "normal"); await finish(value);
      if (correctedEvaluation === "many") { current(value, F); missing17(value); }
      else { current(value, C); missing17(value); assert.equal(value.app.state.priorityReturnContext, undefined); }
      const sourceAfter17 = storage.loadDailySessionSnapshots().find(item => item.session.discountTime === "15");
      assert.ok(sourceAfter17); assert.equal(sourceAfter17.capturedAt, correctedSource.capturedAt);
      assert.deepEqual(json(sourceAfter17.areas), correctedSource.areas); assert.deepEqual(json(sourceAfter17.basis), correctedSource.basis);
    } finally { value.close(); }
  }
});
await test("real: previous15 history reads occur only inside eligible missing17 full completion", async () => {
  const reads = () => memory.reads.get(storage.STORAGE_KEYS.dailySessionSnapshots) ?? 0;
  for (const scenario of ["ordinary", "own17", "missing17", "fixed"] as const) {
    const value = flow17([previous15()], state("17"), at("17:10:00"), scenario === "fixed");
    try {
      if (scenario === "own17") { await judgeUi(value, "many"); await value.click(SKIP); }
      if (scenario === "missing17" || scenario === "fixed") await value.click(SKIP);
      await judgeUi(value, "normal");
      const beforeStage1 = reads(); await invoke(value.button());
      assert.equal(reads() - beforeStage1, 0, `${scenario}: first instruction reads no15 history`);
      value.render(); const completingArea = value.app.state.currentAreaId;
      const beforeCompletion = reads(); await invoke(value.button());
      const completionReads = reads() - beforeCompletion;
      assert.equal(completionReads, scenario === "missing17" ? 1 : 0,
        `${scenario}: only full completion with missing17 saved adoption reads15 history`);
      value.render(); assert.equal(value.app.state.areaProgressMap[completingArea!].status, "completed");
      if (scenario === "missing17") current(value, F);
      if (scenario === "own17") current(value, F, "rate_display");
      if (scenario === "fixed") current(value, C);
    } finally { value.close(); }
  }
});
await test("real: restored archive15 source participates after local journal copy is absent", async () => {
  const saved = previous15({ [F]: "many" }), adapter = new MemoryHistoricalArchiveAdapter(), repository = new HistoricalArchiveRepository(adapter);
  const write = await repository.upsertDailySessionSnapshots([saved]); assert.equal(write.ok, true);
  await initializeHistoricalArchiveRuntime({ repository, storage: new MemoryStorage() });
  const value = flow17([]);
  try {
    assert.equal(storage.loadDailySessionSnapshots().length, 0); assert.ok(getHistoricalDailySessionSnapshots().some(item => item.session.startedAt === saved.session.startedAt));
    await value.click(SKIP); await judge(value); await finish(value); current(value, F); missing17(value);
    await judgeUi(value, "normal"); await finish(value); current(value, C);
  } finally { value.close(); }
});
await test("real: newer local15 correction supersedes restored archive15 many in canonical view", async () => {
  const corrected = previous15({ [F]: "normal" }, { captured: `${DATE}T16:35:00+09:00` });
  corrected.areas[F].measurementRecordedAt = corrected.capturedAt;
  const value = flow17([corrected]);
  try {
    const canonical = getHistoricalDailySessionSnapshots().filter(item => item.session.date === DATE && item.session.discountTime === "15");
    assert.equal(canonical.length, 1); assert.equal(canonical[0].areas[F].areaCountEvaluation, "normal");
    await value.click(SKIP); await judgeUi(value, "normal"); await finish(value); current(value, C); missing17(value);
  } finally { value.close(); }
});

Object.defineProperty(globalThis, "Date", { configurable: true, value: NativeDate });
writeFileSync(new URL("../../tests63-priority-summary.json", import.meta.url), JSON.stringify({ passed: true,
  passedCases: results.length, totalCases: results.length, notes: [], cases: results }, null, 2) + "\n");
const finalLine = `Priority previous63 checks passed: ${results.length}/${results.length}`;
writeFileSync(new URL("../../check-priority-previous63.log", import.meta.url), [...logLines, finalLine].join("\n") + "\n");
console.log(finalLine);

