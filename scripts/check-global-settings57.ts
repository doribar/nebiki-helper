import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { AREA_COUNT_LOCAL_STORAGE_KEY, loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import { loadPendingSupabaseSyncQueue } from "../src/domain/supabaseSyncQueue.ts";
import * as storage from "../src/domain/storage.ts";
import { GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS as KEYS, getGlobalDiscountAdjustmentDate, loadGlobalDiscountAdjustmentState, resolveSessionStartGlobalDiscountAdjustment } from "../src/domain/globalDiscountAdjustment.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { setRuntimeNowOverride } from "../src/hooks/nebikiApp/clock.ts";
import { createDailySessionSnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { buildNormalRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";
import type { AppState, GlobalDiscountAdjustmentPercent, SessionData, UseNebikiAppResult } from "../src/domain/types.ts";
import type { AppRouter } from "../src/app/AppRouter.tsx";
import type { AdminSettingsDialog } from "../src/components/common/AdminSettingsDialog.tsx";

// Reuse 56's real React dispatcher/full-hook fixture: execute the actual TSX,
// handlers, aligned clock and synchronous persistence effects. This is a host
// tree test; actual browser paint/overflow/transport are checked separately.
process.env.TZ = "Asia/Tokyo";
const NativeDate = Date, DATE = "2026-09-08", NEXT = "2026-09-09", AREA = "bento_men";
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
  setInterval() { assert.fail("57 must reuse the shared aligned timeout clock"); }, clearInterval() {},
  location: { search: "", hash: "", href: "http://settings57.invalid/", pathname: "/" },
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
const Admin = (await loadTsx(new URL("../src/components/common/AdminSettingsDialog.tsx", import.meta.url))).AdminSettingsDialog as typeof AdminSettingsDialog;
type Props = Record<string, unknown>;
type HostNode = { type: string; props: Props; children: Array<HostNode | string> };
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Instance = { type: unknown; slots: Slot[]; cursor: number };
const textOf = (node: HostNode | string): string => typeof node === "string" ? node : node.children.map(textOf).join("");
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) => a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const hookEffects = (text: string) => /app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|areaCompletionStateRef\.current|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|startAlignedRuntimeClock|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)|earlyNextMinus5TargetDiscountTime|setGlobalDiscountAdjustmentState/.test(text);
function FixtureApp({ fixture }: { fixture: AppFixture }) {
  const app = useNebikiApp({ testNow: fixture.fixedNow }); fixture.capture(app);
  const [showSettings, setShowSettings] = React.useState(false);
  return React.createElement(React.Fragment, null,
    React.createElement(Router, { app, testNow: fixture.fixedNow, onOpenSettings: () => setShowSettings(true) }),
    showSettings ? React.createElement(Admin, {
      globalDiscountAdjustmentPercent: app.derived.globalDiscountAdjustmentPercent,
      globalDiscountAdjustmentDate: app.derived.globalDiscountAdjustmentDate,
      startGlobalDiscountAdjustmentPercent: app.derived.startGlobalDiscountAdjustmentPercent,
      isResumingGlobalDiscountAdjustment: app.derived.isResumingGlobalDiscountAdjustment,
      onChangeGlobalDiscountAdjustment: app.actions.changeGlobalDiscountAdjustment,
      onClose: () => setShowSettings(false),
    }) : null);
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
  button(label: string) { const node = this.nodes.find(value => value.type === "button" && (textOf(value) === label || value.props["aria-label"] === label)); assert.ok(node, `real button exists: ${label}`); return node; }
  async click(label: string) { await invoke(this.button(label)); this.render(); }
  replaceState(next: AppState) { const instance = [...this.instances.values()].find(value => value.type === FixtureApp); assert.ok(instance); const slot = instance.slots.find(value => value.value === this.app.state); assert.ok(slot); slot.value = next; this.render(); }
  close() { this.instances.forEach(instance => instance.slots.forEach(slot => slot.cleanup?.())); this.instances.clear(); }
}
function invoke(node: HostNode) { assert.ok(!node.props.disabled); return (node.props.onClick as () => void | Promise<void>)(); }
function clean() { assert.equal(timeouts.size, 0); assert.equal(windowEvents.count("focus"), 0); assert.equal(documentEvents.count("visibilitychange"), 0); setRuntimeNowOverride(null); documentFixture.hidden = false; }
function putSetting(adjustmentPercent: GlobalDiscountAdjustmentPercent, date = DATE, fixed = false) { memory.values.set(fixed ? KEYS.fixedTime : KEYS.production, JSON.stringify({ version: 1, date, adjustmentPercent })); }
function fixture(options: { adjustment?: GlobalDiscountAdjustmentPercent; date?: string; timestamp?: number; raw?: AppState; checkpoint?: AppState; fixed?: boolean } = {}) {
  clean(); memory.clear(); alerts.length = 0; nowMs = options.timestamp ?? at("15:00:00");
  if (options.adjustment !== undefined) putSetting(options.adjustment, options.date ?? DATE, options.fixed);
  if (options.raw) memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(options.raw));
  if (options.checkpoint) memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(options.checkpoint));
  const value = new AppFixture(); if (options.fixed) value.fixedNow = new Date(nowMs); value.render(); return value;
}
function sessionState(adjustment: GlobalDiscountAdjustmentPercent | undefined, date = DATE): AppState {
  const weather = { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null };
  const session: SessionData = { ...getCurrentDataVersionInfo(), date, weekday: 2, discountTime: "15", demandCycle: "normal", manualWeekdayOverride: false,
    manualDiscountTimeOverride: false, weather, startedAt: new NativeDate(at("15:00:00", date)).toISOString(), ...(adjustment !== undefined ? { globalDiscountAdjustmentPercent: adjustment } : {}) };
  const raw = createInitialState(session); raw.session = session; raw.screen = "rate_display"; raw.currentAreaId = AREA; raw.lastReferenceAreaId = AREA;
  Object.assign(raw.areaProgressMap[AREA], { areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaRateAdjustment: 0 }); return raw;
}
function indicator(value: AppFixture) { return value.nodes.filter(node => node.props["aria-label"] === "全体値引補正"); }
function assertTop(value: AppFixture, adjustment: GlobalDiscountAdjustmentPercent) {
  assert.equal(value.app.state.screen, "start");
  assert.equal(value.nodes.filter(node => node.props["aria-label"] === "全体値引補正を選択").length, 0, "top has no correction picker");
  assert.equal(indicator(value).length, adjustment === 0 ? 0 : 1, "zero has no correction element/frame");
  if (adjustment === 0) assert.doesNotMatch(value.text(), /全体値引補正|補正なし|設定で変更/);
  else assert.match(textOf(indicator(value)[0]), adjustment > 0 ? /全体値引補正：＋5％/ : /全体値引補正：−5％/);
}
function selected(value: AppFixture, adjustment: GlobalDiscountAdjustmentPercent) {
  for (const [percent, label] of [[-5, "−5％"], [0, "なし"], [5, "＋5％"]] as const) assert.equal(value.button(label).props["aria-pressed"], adjustment === percent, `${label} selection is controlled by successful saved value`);
}
function fireDueTimers() { const due = [...timeouts].filter(([, timer]) => timer.due <= nowMs); assert.ok(due.length); for (const [id, timer] of due) { timeouts.delete(id); timer.callback(); } }
function assertAlignedTimer() { assert.equal(timeouts.size, 2, "Start reuses its existing display and draft aligned clocks with no correction timer"); for (const timer of timeouts.values()) { assert.ok(timer.delay > 0 && timer.delay <= 30000); assert.equal(timer.due % 30000, 0); } }
function productionBytes() { return [...memory.values].filter(([key]) => key !== KEYS.fixedTime && !key.includes("fixed-time")); }
const results: Array<{ name: string; ok: boolean }> = [], logLines: string[] = [];
async function test(name: string, run: () => void | Promise<void>) {
  try { await run(); clean(); } catch (error) { writeFileSync(new URL("../../tests57-summary.json", import.meta.url), JSON.stringify({ passed: false, passedCases: results.length, totalCases: results.length + 1, notes: [`${name}: ${String(error)}`], cases: results }, null, 2) + "\n"); throw error; }
  results.push({ name, ok: true }); const line = `PASS ${String(results.length).padStart(2, "0")}: ${name}`; logLines.push(line); console.log(line);
}

for (const [timestamp, expected] of [["2026-09-08T14:59:59.999Z", DATE], ["2026-09-08T15:00:00.000Z", NEXT], ["2026-09-08T15:00:00.001Z", NEXT], ["2026-09-08T08:00:00-07:00", NEXT], ["2026-09-09T00:00:00+09:00", NEXT]] as const) await test(`JST current date ${timestamp}`, () => {
  assert.equal(getGlobalDiscountAdjustmentDate(new NativeDate(timestamp)), expected);
});
for (const adjustment of [-5, 0, 5] as const) await test(`new start ${adjustment}: conditional top status uses today's setting`, () => {
  const value = fixture({ adjustment }); try { assert.equal(value.app.derived.globalDiscountAdjustmentDate, DATE); assert.equal(value.app.derived.globalDiscountAdjustmentPercent, adjustment); assert.equal(value.app.derived.startGlobalDiscountAdjustmentPercent, adjustment); assert.equal(value.app.derived.isResumingGlobalDiscountAdjustment, false); assertTop(value, adjustment); } finally { value.close(); }
});
for (const adjustment of [-5, 0, 5] as const) await test(`Admin save/reopen/reload ${adjustment} uses controlled successful day state`, async () => {
  let value = fixture();
  try {
    await value.click("設定を開く"); selected(value, 0); await value.click(adjustment === 5 ? "＋5％" : adjustment === -5 ? "−5％" : "なし"); selected(value, adjustment);
    assert.equal(loadGlobalDiscountAdjustmentState({ date: DATE, fixedTime: false }).adjustmentPercent, adjustment);
    await value.click("設定を閉じる"); assertTop(value, adjustment); await value.click("設定を開く"); selected(value, adjustment); await value.click("設定を閉じる");
    value.close(); clean(); value = new AppFixture(); value.render(); assertTop(value, adjustment); await value.click("設定を開く"); selected(value, adjustment);
  } finally { value.close(); }
});
await test("save failure leaves stored/controlled value unchanged and explicit retry succeeds", async () => {
  const value = fixture({ adjustment: -5 });
  try {
    await value.click("設定を開く"); memory.failKeys.add(KEYS.production); await value.click("＋5％"); selected(value, -5);
    assert.equal(value.app.derived.globalDiscountAdjustmentPercent, -5); assert.equal(loadGlobalDiscountAdjustmentState({ date: DATE, fixedTime: false }).adjustmentPercent, -5);
    assert.ok(value.nodes.some(node => node.props.role === "alert" && /保存できませんでした/.test(textOf(node))));
    memory.failKeys.clear(); await value.click("＋5％"); selected(value, 5); await value.click("設定を閉じる"); assertTop(value, 5);
  } finally { value.close(); }
});
await test("actual App connects daily and prospective setting props to the real Admin dialog", () => {
  const source = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
  for (const field of ["globalDiscountAdjustmentPercent", "globalDiscountAdjustmentDate", "startGlobalDiscountAdjustmentPercent", "isResumingGlobalDiscountAdjustment"]) assert.match(source, new RegExp(`${field}=\\{app\\.derived\\.${field}\\}`));
  assert.match(source, /onChangeGlobalDiscountAdjustment=\{app\.actions\.changeGlobalDiscountAdjustment\}/);
});
for (const [captured, daily] of [[5, -5], [-5, 5], [0, 5], [undefined, 5]] as const) await test(`same-session resume captured ${captured ?? "missing=0"}, daily ${daily}: truthful top and exact adoption`, async () => {
  const value = fixture({ adjustment: daily, raw: sessionState(captured) });
  try {
    const adopted = captured ?? 0; value.app.actions.startEditingConditions(); value.render();
    assert.equal(value.app.derived.globalDiscountAdjustmentPercent, daily); assert.equal(value.app.derived.startGlobalDiscountAdjustmentPercent, adopted); assert.equal(value.app.derived.isResumingGlobalDiscountAdjustment, true); assertTop(value, adopted);
    await value.click("設定を開く"); selected(value, daily); assert.match(value.nodes.filter(node => node.props.role === "dialog").map(textOf).join(""), /再開|作業/); await value.click("設定を閉じる");
    const before = json(value.app.state.session); value.app.actions.startSession(); value.render(); assert.equal(value.app.state.session?.globalDiscountAdjustmentPercent, adopted); assert.equal(value.app.state.session?.startedAt, before?.startedAt);
  } finally { value.close(); }
});
await test("daily changes during active work preserve captured session, confirmed rate, daily snapshot and export metadata", async () => {
  const raw = sessionState(5), session = raw.session!, resolvedWeather = resolveWeatherInputForDiscount(session.weather, "15");
  const rateSnapshot = buildNormalRateDecisionSnapshot({ confirmedAt: session.startedAt, sessionDiscountTime: "15", resolvedWeather, weatherComfortAdjustmentPercent: 0, areaRateAdjustment: 0, areaJudge: "normal", globalDiscountAdjustmentPercent: 5 });
  Object.assign(raw.areaProgressMap.tempura, { status: "completed", areaJudge: "normal", areaRateAdjustment: 0, rateDecisionSnapshot: rateSnapshot, completedAt: session.startedAt });
  const value = fixture({ adjustment: 5, raw });
  try {
    const snapshot = createDailySessionSnapshot({ capturedAt: session.startedAt, state: raw, resolvedWeather, weekdayBaseInfo: getWeekdayBaseInfo(2, "15", resolvedWeather, DATE), basisGuide: getBasisGuideDisplay({ date: DATE, weekday: 2, discountTime: "15", weather: resolvedWeather }), lateTimeBonus: 0, doneSummaryItems: [] }); assert.ok(snapshot);
    memory.values.set(storage.STORAGE_KEYS.dailySessionSnapshots, JSON.stringify([snapshot]));
    const before = JSON.stringify({ session: value.app.state.session, progress: value.app.state.areaProgressMap, savedSnapshots: memory.getItem(storage.STORAGE_KEYS.dailySessionSnapshots), dataExport: value.app.derived.dataExport });
    assert.equal(value.app.actions.changeGlobalDiscountAdjustment(-5), true); value.render();
    assert.equal(value.app.derived.globalDiscountAdjustmentPercent, -5); assert.equal(value.app.derived.startGlobalDiscountAdjustmentPercent, 5);
    assert.equal(JSON.stringify({ session: value.app.state.session, progress: value.app.state.areaProgressMap, savedSnapshots: memory.getItem(storage.STORAGE_KEYS.dailySessionSnapshots), dataExport: value.app.derived.dataExport }), before);
    assert.equal(value.app.state.areaProgressMap.tempura.rateDecisionSnapshot?.globalDiscountAdjustmentPercent, 5);
  } finally { value.close(); }
});
await test("successful day choice and stale start in one React batch captures committed choice", () => {
  const value = fixture({ adjustment: -5 }); try { const start = value.app.actions.startSession; assert.equal(value.app.actions.changeGlobalDiscountAdjustment(5), true); start(); value.render(); assert.equal(value.app.state.session?.globalDiscountAdjustmentPercent, 5); } finally { value.close(); }
});
await test("failed day choice and stale start in one React batch captures last successful choice", () => {
  const value = fixture({ adjustment: -5 }); try { const start = value.app.actions.startSession; memory.failKeys.add(KEYS.production); assert.equal(value.app.actions.changeGlobalDiscountAdjustment(5), false); start(); value.render(); assert.equal(value.app.state.session?.globalDiscountAdjustmentPercent, -5); } finally { value.close(); }
});
for (const trigger of ["timeout", "focus", "visible", "refresh"] as const) await test(`open top across JST midnight by ${trigger}: zero, canonical reset and shared aligned scheduler`, () => {
  const value = fixture({ adjustment: 5, timestamp: at("23:59:59.999") });
  try {
    assertTop(value, 5); assertAlignedTimer(); nowMs = at("00:00:00", NEXT);
    if (trigger === "timeout") fireDueTimers(); if (trigger === "focus") windowEvents.emit("focus"); if (trigger === "visible") documentEvents.emit("visibilitychange"); if (trigger === "refresh") value.app.actions.refreshRuntimeClock(); value.render();
    assert.equal(value.app.derived.globalDiscountAdjustmentDate, NEXT); assert.equal(value.app.derived.globalDiscountAdjustmentPercent, 0); assertTop(value, 0); assertAlignedTimer();
    assert.deepEqual(JSON.parse(memory.getItem(KEYS.production)!), { version: 1, date: NEXT, adjustmentPercent: 0 });
    const count = memory.writes.filter(key => key === KEYS.production).length; windowEvents.emit("focus"); value.render(); assert.equal(memory.writes.filter(key => key === KEYS.production).length, count, "same date refresh does not repeatedly save reset");
  } finally { value.close(); }
});
await test("hidden visibility event cannot advance daily date; visible event refreshes once", () => {
  const value = fixture({ adjustment: 5, timestamp: at("23:59:59.999") });
  try { nowMs = at("00:00:00", NEXT); documentFixture.hidden = true; documentEvents.emit("visibilitychange"); assert.equal(value.dirty, false, "hidden event does not request a render"); assert.equal(value.app.derived.globalDiscountAdjustmentDate, DATE); documentFixture.hidden = false; documentEvents.emit("visibilitychange"); value.render(); assert.equal(value.app.derived.globalDiscountAdjustmentDate, NEXT); assertTop(value, 0); assertAlignedTimer(); } finally { value.close(); }
});
await test("midnight reset save failure keeps effective zero and never restores yesterday's nonzero", () => {
  const value = fixture({ adjustment: 5, timestamp: at("23:59:59.999") });
  try { memory.failKeys.add(KEYS.production); nowMs = at("00:00:00", NEXT); windowEvents.emit("focus"); value.render(); assertTop(value, 0); assert.equal(value.app.derived.globalDiscountAdjustmentDate, NEXT); assert.equal(JSON.parse(memory.getItem(KEYS.production)!).date, DATE); value.app.actions.startSession(); value.render(); assert.equal(value.app.state.session?.globalDiscountAdjustmentPercent, 0); } finally { value.close(); }
});
await test("stale settings button after midnight rejects old-day intent and refreshes controlled zero", async () => {
  const value = fixture({ adjustment: 5, timestamp: at("23:59:59.999") });
  try { await value.click("設定を開く"); const old = value.button("−5％"); nowMs = at("00:00:00", NEXT); await invoke(old); value.render(); selected(value, 0); assert.equal(value.app.derived.globalDiscountAdjustmentDate, NEXT); assert.ok(value.nodes.some(node => node.props.role === "alert" && /保存できませんでした/.test(textOf(node)))); assert.equal(loadGlobalDiscountAdjustmentState({ date: NEXT, fixedTime: false }).adjustmentPercent, 0); await value.click("−5％"); selected(value, -5); assert.equal(loadGlobalDiscountAdjustmentState({ date: NEXT, fixedTime: false }).adjustmentPercent, -5); } finally { value.close(); }
});
await test("stale pre-midnight start refuses old input, refreshes zero and permits explicit fresh start", () => {
  const value = fixture({ adjustment: 5, timestamp: at("23:59:59.999") });
  try { const start = value.app.actions.startSession; nowMs = at("00:00:00", NEXT); start(); value.render(); assert.equal(value.app.state.session, null); assertTop(value, 0); value.app.actions.startSession(); value.render(); assert.equal(value.app.state.session?.date, NEXT); assert.equal(value.app.state.session?.globalDiscountAdjustmentPercent, 0); } finally { value.close(); }
});
await test("stale pre-midnight start refreshes current-day external choice before explicit retry", () => {
  const value = fixture({ adjustment: 5, timestamp: at("23:59:59.999") });
  try { const start = value.app.actions.startSession; nowMs = at("00:00:00", NEXT); putSetting(-5, NEXT); start(); value.render(); assert.equal(value.app.state.session, null); assertTop(value, -5); value.app.actions.startSession(); value.render(); assert.equal(value.app.state.session?.date, NEXT); assert.equal(value.app.state.session?.globalDiscountAdjustmentPercent, -5); } finally { value.close(); }
});
for (const source of ["current", "checkpoint", "last-draft"] as const) await test(`previous-day ${source} never selects daily correction by restored draft date`, () => {
  const raw = sessionState(5), value = fixture({ adjustment: 5, timestamp: at("00:00:00", NEXT), ...(source === "current" ? { raw } : source === "checkpoint" ? { checkpoint: raw } : {}) });
  try {
    if (source === "last-draft") { const stale = json(value.app.state); stale.sessionDraft.date = DATE; value.replaceState(stale); }
    assert.equal(value.app.derived.globalDiscountAdjustmentDate, NEXT); assert.equal(value.app.derived.globalDiscountAdjustmentPercent, 0); assert.equal(value.app.derived.startGlobalDiscountAdjustmentPercent, 0);
    value.app.actions.startSession(); value.render(); assert.equal(value.app.state.session?.date, NEXT); assert.equal(value.app.state.session?.globalDiscountAdjustmentPercent, 0);
  } finally { value.close(); }
});
await test("same-day pending 15→17 transition adopts daily setting instead of captured 15", () => {
  const raw = sessionState(-5); raw.screen = "done";
  for (const progress of Object.values(raw.areaProgressMap)) Object.assign(progress, { status: "completed", areaJudge: "normal", areaRateAdjustment: 0, completedAt: raw.session!.startedAt });
  const value = fixture({ adjustment: 5, raw, timestamp: at("16:40:00") });
  try { value.app.actions.startNextDoneSession(); value.render(); assert.equal(value.app.derived.startGlobalDiscountAdjustmentPercent, 5); assert.equal(value.app.derived.isResumingGlobalDiscountAdjustment, false); value.app.actions.startSession(); value.render(); assert.equal(value.app.state.session?.discountTime, "17"); assert.equal(value.app.state.session?.globalDiscountAdjustmentPercent, 5); } finally { value.close(); }
});
await test("fixed-time choices and fixed-day rollover preserve all production settings/data/queues", async () => {
  const value = fixture({ adjustment: -5, fixed: true });
  try {
    putSetting(5); memory.values.set(AREA_COUNT_LOCAL_STORAGE_KEY, "[]"); const before = productionBytes(); const records = loadLocalAreaCountRecords(), pending = loadPendingSupabaseSyncQueue();
    assertTop(value, -5); assert.equal(timeouts.size, 0); await value.click("設定を開く"); await value.click("＋5％"); selected(value, 5); await value.click("設定を閉じる"); assertTop(value, 5);
    nowMs = at("00:00:00", NEXT); windowEvents.emit("focus"); documentEvents.emit("visibilitychange"); value.render(); assert.equal(value.app.derived.globalDiscountAdjustmentDate, DATE); assertTop(value, 5);
    value.fixedNow = new Date(nowMs); value.render(); assert.equal(value.app.derived.globalDiscountAdjustmentDate, NEXT); assertTop(value, 0); assert.equal(timeouts.size, 0);
    assert.deepEqual(productionBytes(), before); assert.deepEqual(loadLocalAreaCountRecords(), records); assert.deepEqual(loadPendingSupabaseSyncQueue(), pending); assert.equal(loadGlobalDiscountAdjustmentState({ date: DATE, fixedTime: false }).adjustmentPercent, 5);
  } finally { value.close(); }
});
await test("shared adoption resolver keeps captured session and allows new day/new time without mutation", () => {
  const state = { version: 1 as const, date: DATE, adjustmentPercent: 5 as const }, session = { date: DATE, discountTime: "15" as const, globalDiscountAdjustmentPercent: -5 as const }, before = json({ state, session });
  assert.equal(resolveSessionStartGlobalDiscountAdjustment({ state, date: DATE, session, discountTime: "15", timeSwitchTarget: null }), -5);
  assert.equal(resolveSessionStartGlobalDiscountAdjustment({ state, date: DATE, session, discountTime: "17", timeSwitchTarget: "17" }), 5);
  assert.equal(resolveSessionStartGlobalDiscountAdjustment({ state, date: NEXT, session, discountTime: "15", timeSwitchTarget: null }), 0);
  assert.deepEqual({ state, session }, before);
});

Object.defineProperty(globalThis, "Date", { configurable: true, value: NativeDate });
const summary = { passed: true, passedCases: results.length, totalCases: results.length, notes: ["Actual hook/TSX host-tree test; browser paint, IndexedDB hydration and Supabase transport are separate checks."], cases: results };
writeFileSync(new URL("../../tests57-summary.json", import.meta.url), JSON.stringify(summary, null, 2) + "\n");
const finalLine = `Global settings57 checks passed: ${results.length}/${results.length}`;
writeFileSync(new URL("../../check-global-settings57.log", import.meta.url), [...logLines, finalLine].join("\n") + "\n");
console.log(finalLine);
