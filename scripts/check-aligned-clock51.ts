import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import * as storage from "../src/domain/storage.ts";
import { loadPendingSupabaseSyncQueue } from "../src/domain/supabaseSyncQueue.ts";
import { loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { getNextAlignedRuntimeClockDelayMs, startAlignedRuntimeClock, setRuntimeNowOverride } from "../src/hooks/nebikiApp/clock.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";
import type { AppState, DiscountTime, SessionDraft, UseNebikiAppResult } from "../src/domain/types.ts";

// The production clock, hook, App and React actions execute unchanged. Only
// browser scheduling/events, React scheduling, time and storage are fixtures.
// Native browser paint, IDB hydration and real Supabase remain separate checks.
process.env.TZ = "Asia/Tokyo";
const NativeDate = Date;
const DATE = "2026-09-08";
const at = (clock: string, date = DATE) => new NativeDate(`${date}T${clock}+09:00`).getTime();
let nowMs = at("15:05:03.700");
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
const documentFixture = { hidden: false, addEventListener: documentEvents.addEventListener, removeEventListener: documentEvents.removeEventListener };
type Timer = { callback: () => void; delay: number; due: number };
const timeouts = new Map<number, Timer>(), intervals = new Map<number, Timer>();
const alerts: string[] = [];
let timerId = 0;
const windowFixture = {
  addEventListener: windowEvents.addEventListener, removeEventListener: windowEvents.removeEventListener,
  setTimeout(callback: () => void, delay = 0) { const id = ++timerId; timeouts.set(id, { callback, delay, due: nowMs + delay }); return id; },
  clearTimeout(id: number) { timeouts.delete(id); },
  setInterval(callback: () => void, delay = 0) { const id = ++timerId; intervals.set(id, { callback, delay, due: nowMs + delay }); return id; },
  clearInterval(id: number) { intervals.delete(id); },
  location: { search: "", hash: "", href: "http://clock51.invalid/", pathname: "/" },
  confirm() { return true; }, scrollTo() {}, alert(message: string) { alerts.push(message); },
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
Object.defineProperty(globalThis, "document", { configurable: true, value: documentFixture });
Object.defineProperty(globalThis, "window", { configurable: true, value: windowFixture });
const onlyTimer = () => { assert.equal(timeouts.size, 1); return [...timeouts.entries()][0]; };
function clean() {
  assert.equal(timeouts.size, 0, "all owned timeouts were disposed"); assert.equal(intervals.size, 0, "no interval is used");
  assert.equal(windowEvents.count("focus"), 0); assert.equal(documentEvents.count("visibilitychange"), 0);
  setRuntimeNowOverride(null); documentFixture.hidden = false; windowFixture.location.search = "";
}
function fireDueTimers() {
  const due = [...timeouts].filter(([, timer]) => timer.due <= nowMs);
  assert.ok(due.length > 0, "a real elapsed clock timeout is fired");
  for (const [id, timer] of due) { timeouts.delete(id); timer.callback(); }
}
function assertAlignedTimers(count: number) {
  assert.equal(timeouts.size, count); assert.equal(intervals.size, 0);
  for (const timer of timeouts.values()) { assert.ok(timer.delay > 0 && timer.delay <= 30000); assert.equal(timer.due % 30000, 0, "each due time falls on second 00 or 30"); }
}

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) => a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
class ReactFixture<T> {
  slots: Slot[] = []; index = 0; dirty = false; renders = 0;
  pending: { callback: () => void | (() => void); slot: Slot }[] = [];
  value!: T; fixedNow: Date | null = null;
  private renderValue: (fixture: ReactFixture<T>) => T;
  private include: (text: string) => boolean;
  constructor(renderValue: (fixture: ReactFixture<T>) => T, include: (text: string) => boolean) { this.renderValue = renderValue; this.include = include; }
  next() { return this.slots[this.index++] ??= {}; }
  dispatcher = {
    useRef: <V>(initial: V) => { const slot = this.next(); if (!("value" in slot)) slot.value = { current: initial }; return slot.value as { current: V }; },
    useState: <V>(initial: V | (() => V)): [V, (value: V | ((previous: V) => V)) => void] => {
      const slot = this.next(); if (!("value" in slot)) slot.value = typeof initial === "function" ? (initial as () => V)() : initial;
      return [slot.value as V, value => { const next = typeof value === "function" ? (value as (previous: V) => V)(slot.value as V) : value; if (!Object.is(next, slot.value)) { slot.value = next; this.dirty = true; } }];
    },
    useMemo: <V>(get: () => V, deps: readonly unknown[]) => { const slot = this.next(); if (!("value" in slot) || !sameDeps(slot.deps, deps)) { slot.value = get(); slot.deps = deps; } return slot.value as V; },
    useCallback: <V>(value: V, deps: readonly unknown[]) => this.dispatcher.useMemo(() => value, deps),
    useEffect: (callback: () => void | (() => void), deps?: readonly unknown[]) => { const slot = this.next(); if (!sameDeps(slot.deps, deps)) { slot.deps = deps; this.pending.push({ callback, slot }); } },
  };
  render() {
    this.index = 0; this.dirty = false; this.pending = []; this.renders++;
    const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown };
    const previous = internals.H; internals.H = this.dispatcher;
    try { this.value = this.renderValue(this); } finally { internals.H = previous; }
  }
  settle(force = false) {
    if (force || this.dirty || !this.renders) this.render();
    for (let pass = 0; pass < 20; pass++) {
      const effects = this.pending; this.pending = [];
      for (const { callback, slot } of effects) {
        if (!this.include(String(callback))) continue;
        slot.cleanup?.(); const cleanup = callback(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      }
      if (!this.dirty) return;
      this.render();
    }
    assert.fail("actual production React effects converge");
  }
  close() { this.slots.forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined; }); }
}
const hookEffects = (text: string) => /app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|startAlignedRuntimeClock|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)|earlyNextMinus5TargetDiscountTime|startAutomaticReview19/.test(text);
function draft(time: DiscountTime = "15"): SessionDraft {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const forecast of Object.values(hourlyForecasts)) Object.assign(forecast, { weather: "sunny", tempC: 29, windMs: 2 });
  return { date: DATE, weekday: 2, discountTime: time, demandCycle: "normal", manualWeekdayOverride: false, manualDiscountTimeOverride: false, weather: { hourlyForecasts, afterRainSky: null } };
}
function activeState(time: "15" | "17", screen: AppState["screen"] = "rate_display") {
  const input = draft(time), raw = createInitialState(input);
  raw.session = { ...input, ...getCurrentDataVersionInfo(), globalDiscountAdjustmentPercent: 0, startedAt: new NativeDate(at(time === "15" ? "15:00:00" : "17:00:00")).toISOString() };
  raw.screen = screen; raw.currentAreaId = "bento_men";
  Object.assign(raw.areaProgressMap.bento_men, { areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaCountEvaluationSource: "manual", areaRateAdjustment: 0 });
  return raw;
}
function hookFixture(raw: AppState, clock: string) {
  clean(); nowMs = at(clock); memory.clear(); alerts.length = 0;
  memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(raw));
  if (raw.session) memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(raw));
  const fixture = new ReactFixture<UseNebikiAppResult>(self => useNebikiApp({ testNow: self.fixedNow }), hookEffects);
  fixture.settle(true); return fixture;
}
const componentModules = new Map<string, Record<string, unknown>>();
async function loadComponent(url: URL): Promise<Record<string, unknown>> {
  const cached = componentModules.get(url.href); if (cached) return cached;
  const source = readFileSync(url, "utf8"), ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dependencies = new Map<string, unknown>([["react", React], ["react/jsx-runtime", jsxRuntime]]);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    assert.ok(ts.isStringLiteral(statement.moduleSpecifier)); const id = statement.moduleSpecifier.text; if (dependencies.has(id)) continue;
    assert.ok(id.startsWith(".")); const target = [id, `${id}.ts`, `${id}.tsx`].map(path => new URL(path, url)).find(path => existsSync(path)); assert.ok(target);
    dependencies.set(id, target.pathname.endsWith(".tsx") ? await loadComponent(target) : await import(target.href));
  }
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    Date: FixtureDate, window: windowFixture, document: documentFixture, navigator, URLSearchParams, exports,
    require: (id: string) => { assert.ok(dependencies.has(id)); return dependencies.get(id); },
  });
  componentModules.set(url.href, exports); return exports;
}
const App = (await loadComponent(new URL("../src/app/App.tsx", import.meta.url))).default as () => React.ReactElement<Record<string, unknown>>;
let passed = 0;
async function test(name: string, run: () => void | Promise<void>) { await run(); clean(); passed++; console.log(`PASS ${passed}: ${name}`); }

await test("exact milliseconds always choose the next 00/30 boundary, including an exact boundary", () => {
  const origin = at("12:34:00");
  for (const offset of [0, 1, 999, 1000, 10001, 29999, 30000, 30001, 59999, 60000]) {
    assert.equal(getNextAlignedRuntimeClockDelayMs(origin + offset), 30000 - offset % 30000);
  }
});
await test("mount updates immediately and reserves the first partial period", () => {
  nowMs = at("15:05:03.700"); const samples: number[] = [];
  const stop = startAlignedRuntimeClock(value => samples.push(value));
  try { assert.deepEqual(samples, [nowMs]); assert.equal(onlyTimer()[1].delay, 26300); assertAlignedTimers(1); } finally { stop(); }
});
await test("scheduling reads fresh time after the update callback rather than reusing its sample", () => {
  nowMs = at("15:05:29.900"); const samples: number[] = [];
  const stop = startAlignedRuntimeClock(value => { samples.push(value); nowMs += 200; });
  try { assert.equal(samples[0], at("15:05:29.900")); assert.equal(onlyTimer()[1].delay, 29900); assert.equal(onlyTimer()[1].due, at("15:06:00")); } finally { stop(); }
});
await test("late callback realigns from its execution time without carrying mount phase drift", () => {
  nowMs = at("15:05:03"); const samples: number[] = []; const stop = startAlignedRuntimeClock(value => samples.push(value));
  try {
    nowMs = at("15:05:47.250"); fireDueTimers(); assert.equal(samples.at(-1), nowMs); assert.equal(onlyTimer()[1].delay, 12750);
    nowMs = at("15:06:00.400"); fireDueTimers(); assert.equal(onlyTimer()[1].delay, 29600); assertAlignedTimers(1);
  } finally { stop(); }
});
await test("backward system-time correction also recomputes the following boundary", () => {
  nowMs = at("15:05:20"); const samples: number[] = []; const stop = startAlignedRuntimeClock(value => samples.push(value));
  try { const [id, timer] = onlyTimer(); timeouts.delete(id); nowMs = at("15:04:07.123"); timer.callback(); assert.equal(samples.at(-1), nowMs); assert.equal(onlyTimer()[1].delay, 22877); assertAlignedTimers(1); } finally { stop(); }
});
for (const event of ["focus", "visibility"] as const) await test(`${event} immediately refreshes, cancels stale reservation and ignores a queued canceled callback`, () => {
  nowMs = at("15:05:03"); const samples: number[] = []; const stop = startAlignedRuntimeClock(value => samples.push(value));
  try {
    const [oldId, oldTimer] = onlyTimer(); nowMs = at("15:07:41.234");
    (event === "focus" ? windowEvents : documentEvents).emit(event === "focus" ? "focus" : "visibilitychange");
    assert.equal(samples.at(-1), nowMs); assert.equal(timeouts.has(oldId), false); assert.equal(onlyTimer()[1].delay, 18766);
    const reservation = onlyTimer(), count = samples.length; oldTimer.callback(); assert.equal(samples.length, count); assert.deepEqual(onlyTimer(), reservation);
  } finally { stop(); }
});
await test("hidden visibility event does not refresh; returning visible refreshes and rearms", () => {
  nowMs = at("15:05:03"); const samples: number[] = []; const stop = startAlignedRuntimeClock(value => samples.push(value));
  try {
    const reservation = onlyTimer(); nowMs = at("15:06:11.500"); documentFixture.hidden = true; documentEvents.emit("visibilitychange");
    assert.equal(samples.length, 1); assert.deepEqual(onlyTimer(), reservation);
    documentFixture.hidden = false; documentEvents.emit("visibilitychange"); assert.equal(samples.at(-1), nowMs); assert.equal(onlyTimer()[1].delay, 18500);
  } finally { stop(); }
});
await test("cleanup and Strict Mode setup-cleanup-setup leave one owner and no stale side effects", () => {
  nowMs = at("15:05:13"); const samples: number[] = [];
  const firstStop = startAlignedRuntimeClock(value => samples.push(value)), firstTimer = onlyTimer()[1]; firstStop();
  const secondStop = startAlignedRuntimeClock(value => samples.push(value));
  try { assertAlignedTimers(1); assert.equal(windowEvents.count("focus"), 1); assert.equal(documentEvents.count("visibilitychange"), 1); firstTimer.callback(); assert.equal(samples.length, 2); }
  finally { const queued = onlyTimer()[1]; secondStop(); secondStop(); queued.callback(); windowEvents.emit("focus"); documentEvents.emit("visibilitychange"); assert.equal(samples.length, 2); }
});

await test("actual Start changes at 16:40 on the aligned timer with partial first period", () => {
  const fixture = hookFixture(createInitialState(draft()), "16:39:07.125");
  try {
    assert.equal(fixture.value.state.sessionDraft.discountTime, "15"); assertAlignedTimers(2);
    nowMs = at("16:39:30"); fireDueTimers(); fixture.settle(); assert.equal(fixture.value.state.sessionDraft.discountTime, "15");
    nowMs = at("16:40:00"); fireDueTimers(); fixture.settle(); assert.equal(fixture.value.state.sessionDraft.discountTime, "17"); assertAlignedTimers(2);
  } finally { fixture.close(); }
});
await test("actual Start weather lock preserves its selected time across 16:40 and focus", () => {
  const fixture = hookFixture(createInitialState(draft()), "16:39:59.999");
  try {
    fixture.value.actions.updateSessionDraft({ weather: fixture.value.state.sessionDraft.weather }); fixture.settle();
    assert.equal(fixture.value.state.sessionDraft.weatherInputLockedDiscountTime, "15", "the real weather edit establishes the lock");
    nowMs = at("16:40:00"); fireDueTimers(); fixture.settle(); windowEvents.emit("focus"); fixture.settle(); assert.equal(fixture.value.state.sessionDraft.discountTime, "15"); assert.equal(fixture.value.state.sessionDraft.weatherInputLockedDiscountTime, "15");
  } finally { fixture.close(); }
});
await test("actual Start focus updates both clock and unlocked draft before the old timer", () => {
  const fixture = hookFixture(createInitialState(draft()), "16:39:07");
  try { const ids = [...timeouts.keys()]; nowMs = at("16:40:17.444"); windowEvents.emit("focus"); fixture.settle(); assert.equal(fixture.value.state.sessionDraft.discountTime, "17"); ids.forEach(id => assert.equal(timeouts.has(id), false)); assertAlignedTimers(2); } finally { fixture.close(); }
});
await test("Start midnight draft refreshes date, weekday and time while an active business-date edit is preserved", () => {
  let fixture = hookFixture(createInitialState(draft("17")), "23:59:59.999");
  try { nowMs = at("00:00:00", "2026-09-09"); fireDueTimers(); fixture.settle(); assert.equal(fixture.value.state.sessionDraft.date, "2026-09-09"); assert.equal(fixture.value.state.sessionDraft.weekday, 3); assert.equal(fixture.value.state.sessionDraft.discountTime, "15"); } finally { fixture.close(); }
  fixture = hookFixture(activeState("17", "start"), "23:59:59.999");
  try { nowMs = at("00:00:00", "2026-09-09"); fireDueTimers(); fixture.settle(); assert.equal(fixture.value.state.sessionDraft.date, DATE); assert.equal(fixture.value.state.sessionDraft.weekday, 2); assert.equal(fixture.value.state.session?.date, DATE); } finally { fixture.close(); }
});
for (const [time, before, boundary] of [["15", "15:59:59.999", "16:00:00"], ["17", "17:59:59.999", "18:00:00"]] as const) await test(`${time} actual late-rate display updates at exact boundary without rewriting saved progress, undo or queues`, () => {
  const fixture = hookFixture(activeState(time), before);
  try {
    const stateBefore = JSON.stringify(fixture.value.state), bytesBefore = [...memory.values], pendingBefore = loadPendingSupabaseSyncQueue(), recordsBefore = loadLocalAreaCountRecords();
    const rateBefore = JSON.stringify(fixture.value.derived.rateDisplay), writes = memory.writes.length;
    nowMs = at(boundary); fireDueTimers(); fixture.settle(); assert.notEqual(JSON.stringify(fixture.value.derived.rateDisplay), rateBefore);
    assert.equal(JSON.stringify(fixture.value.state), stateBefore); assert.deepEqual([...memory.values], bytesBefore); assert.equal(memory.writes.length, writes);
    assert.deepEqual(loadPendingSupabaseSyncQueue(), pendingBefore); assert.deepEqual(loadLocalAreaCountRecords(), recordsBefore); assertAlignedTimers(1);
  } finally { fixture.close(); }
});
await test("a screen change after a missed boundary confirms fresh late rate into its real snapshot", async () => {
  const fixture = hookFixture(activeState("17", "area_judge"), "17:59:59.999");
  try {
    nowMs = at("18:00:00.001"); fixture.value.actions.startAreaCountCorrection("bento_men"); fixture.settle();
    // The real action below enters rate_display; its effect must not snapshot the
    // old clock before the shared scheduler wakes the next React render.
    await fixture.value.actions.judgeCurrentArea("normal", 20, "normal");
    fixture.settle(); assert.equal(fixture.value.state.screen, "rate_display");
    fixture.value.actions.goToNextArea(); fixture.settle(); const snapshot = fixture.value.state.areaProgressMap.bento_men.rateDecisionSnapshot;
    assert.ok(snapshot); assert.equal(snapshot.lateTimeAdjustmentPercent, 5); assert.equal(snapshot.calculationMode, "late_plus5"); assert.equal(snapshot.sessionDiscountTime, "17");
  } finally { fixture.close(); }
});

await test("17 session enters Review19 at 18:55 once and stores the original17 source", () => {
  const fixture = hookFixture(activeState("17"), "18:54:59.999");
  try {
    nowMs = at("18:55:00"); fireDueTimers(); fixture.settle(); assert.equal(fixture.value.state.screen, "review19", "complete source forecasts enter Review19 directly");
    assert.equal(alerts.filter(value => value.includes("19時チェックの時間")).length, 1);
    const source = storage.loadReview19SourceState(), snapshots = storage.loadDailySessionSnapshots();
    assert.equal(source?.session?.discountTime, "17"); assert.equal(snapshots.length, 1); assert.equal(snapshots[0].session.discountTime, "17");
    windowEvents.emit("focus"); fixture.settle(); nowMs = at("18:55:30"); fireDueTimers(); fixture.settle();
    assert.equal(alerts.filter(value => value.includes("19時チェックの時間")).length, 1); assert.equal(storage.loadDailySessionSnapshots().length, 1);
  } finally { fixture.close(); }
});
await test("late visible return still prioritizes unfinished Review19 after19:25", () => {
  const fixture = hookFixture(activeState("17"), "18:54:01");
  try { nowMs = at("19:40:27.321"); documentEvents.emit("visibilitychange"); fixture.settle(); assert.equal(fixture.value.state.screen, "review19"); assert.equal(fixture.value.state.session?.discountTime, "17"); assertAlignedTimers(1); } finally { fixture.close(); }
});
await test("fixed hook reserves no clock timer and writes no production data on realtime focus or explicit clock change", () => {
  clean(); memory.clear(); nowMs = at("16:39:59"); const productionBytes = [...memory.values];
  const fixture = new ReactFixture<UseNebikiAppResult>(self => useNebikiApp({ testNow: self.fixedNow }), hookEffects); fixture.fixedNow = new Date(nowMs);
  try {
    fixture.settle(true); assert.equal(timeouts.size, 0); assert.equal(fixture.value.state.sessionDraft.discountTime, "15");
    nowMs = at("19:40:00"); windowEvents.emit("focus"); documentEvents.emit("visibilitychange"); fixture.settle(); assert.equal(fixture.value.state.sessionDraft.discountTime, "15");
    fixture.fixedNow = new Date(at("16:40:00")); fixture.settle(true); assert.equal(fixture.value.state.sessionDraft.discountTime, "17");
    assert.equal(timeouts.size, 0); assert.deepEqual([...memory.values].filter(([key]) => !key.includes("fixed-time")), productionBytes);
    assert.deepEqual(loadLocalAreaCountRecords(), []); assert.deepEqual(loadPendingSupabaseSyncQueue(), []);
  } finally { fixture.close(); }
});
await test("actual App date blocker becomes active at midnight, with cleanup and no fixed-date drift", () => {
  clean(); nowMs = at("23:59:59.999"); const fixture = new ReactFixture(() => App(), text => /startAlignedRuntimeClock/.test(text));
  try { fixture.settle(true); assertAlignedTimers(1); nowMs = at("00:00:00", "2026-09-09"); fireDueTimers(); fixture.settle(); assert.equal((fixture.value.type as { name: string }).name, "DateChangedBlocker"); assert.equal(fixture.value.props.loadedDate, DATE); } finally { fixture.close(); }
  windowFixture.location.search = `?testTime=17&testDate=${DATE}`;
  const fixed = new ReactFixture(() => App(), text => /startAlignedRuntimeClock/.test(text));
  try { fixed.settle(true); assert.equal(timeouts.size, 0); nowMs = at("12:00:00", "2026-09-10"); fixed.settle(true); assert.notEqual((fixed.value.type as { name?: string }).name, "DateChangedBlocker"); assert.equal(timeouts.size, 0); } finally { fixed.close(); }
});

Object.defineProperty(globalThis, "Date", { configurable: true, value: NativeDate });
console.log(`Aligned runtime clock51 checks passed: ${passed}/${passed}`);
