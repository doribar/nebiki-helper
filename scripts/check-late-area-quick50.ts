import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  createAreaEvaluationQuickAdjustment,
  getAreaEvaluationLowerQuickAdjustmentDelayMs,
  getAreaEvaluationQuickAdjustments,
} from "../src/domain/areaEvaluationAdjustment.ts";
import {
  buildAreaCountDecisionBasis, evaluationToRateAdjustment,
  getAreaCountRecommendation, type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { AREA_COUNT_LOCAL_STORAGE_KEY, loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import { buildRemoteAreaCountRow } from "../src/domain/areaCountRemoteStorage.ts";
import { buildAutomaticDayExportPayload } from "../src/domain/dayExport.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { initializeFinalizedDayDataInMemory } from "../src/domain/finalizedDayData.ts";
import { createHumanEvaluationSelection, resolveHumanEvaluationForDiscount } from "../src/domain/humanEvaluation.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { createInitialReview19Result } from "../src/domain/review19.ts";
import { buildDirectReview19DataExportPayload } from "../src/domain/separateDataExport.ts";
import { loadPendingSupabaseSyncQueue } from "../src/domain/supabaseSyncQueue.ts";
import * as storage from "../src/domain/storage.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot, createReview19Snapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { useNebikiApp as runProductionHook } from "../src/hooks/useNebikiApp.ts";
import type {
  AppState, AreaCountEvaluation, DemandCycle, DiscountTime, HumanEvaluationAdjustment,
  HumanEvaluationDetails, UseNebikiAppResult,
} from "../src/domain/types.ts";

// Production helpers, complete hook/actions, AppRouter and RateDisplayScreen run
// unchanged. React scheduling, browser events, time and localStorage are fixtures.
// This suite does not claim native browser paint, IndexedDB hydration or Supabase.
process.env.TZ = "Asia/Tokyo";
const NativeDate = Date;
const DATE = "2026-09-08";
const AREA = "bento_men";
const EVALUATIONS: AreaCountEvaluation[] = ["few", "slightly_few", "normal", "slightly_many", "many"];
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const at = (clock: string) => new NativeDate(`${DATE}T${clock}+09:00`);
const cutoff = (time: "15" | "17") => at(time === "15" ? "16:00:00" : "18:00:00").getTime();
let nowMs = at("15:05:00").getTime();
class FixtureDate extends NativeDate {
  constructor(value?: string | number | Date) { super(value === undefined ? nowMs : value); }
  static now() { return nowMs; }
}
Object.defineProperty(globalThis, "Date", { configurable: true, value: FixtureDate });

function history(time: DiscountTime, cycle: DemandCycle): AreaCountRecord[] {
  return ["2026-08-18", "2026-08-25", "2026-09-01"].map(date => ({
    ...getCurrentDataVersionInfo(), date, areaId: AREA, discountTime: time, demandCycle: cycle,
    sessionStartedAt: `${date}T${time === "15" ? "06" : "08"}:00:00.000Z`,
    recordedAt: `${date}T${time === "15" ? "06" : "08"}:05:00.000Z`,
    actualWeekday: "火", actualWeekdayGroup: "火木", count: 20,
  }));
}

function state(time: DiscountTime, cycle: DemandCycle = "normal", original: AreaCountEvaluation = "normal", onlyLast = false): AppState {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const forecast of Object.values(hourlyForecasts)) Object.assign(forecast, { weather: "sunny", tempC: 29, windMs: 2 });
  const session = {
    ...getCurrentDataVersionInfo(), date: DATE, weekday: 2, discountTime: time, demandCycle: cycle,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    globalDiscountAdjustmentPercent: 0 as const,
    weather: { hourlyForecasts, afterRainSky: null },
    startedAt: `${DATE}T${time === "15" ? "06" : "08"}:00:00.000Z`,
  };
  const value = createInitialState(session);
  value.session = session;
  value.screen = "rate_display";
  value.currentAreaId = AREA;
  const count = [16, 18, 20, 22, 24][EVALUATIONS.indexOf(original)];
  const recommendation = getAreaCountRecommendation({
    records: history(time, cycle), areaId: AREA, discountTime: time,
    date: DATE, weekday: 2, demandCycle: cycle, count,
  });
  assert.equal(recommendation.suggestedEvaluation, original);
  Object.assign(value.areaProgressMap[AREA], {
    areaCount: count, areaJudge: "normal", areaCountEvaluation: original,
    areaCountEvaluationSource: "history", areaRateAdjustment: evaluationToRateAdjustment(original),
    areaCountDecisionBasis: buildAreaCountDecisionBasis({
      recommendation, evaluationSource: "history", finalEvaluation: original,
      areaRateAdjustment: evaluationToRateAdjustment(original),
    }),
  });
  if (onlyLast) {
    for (const [areaId, progress] of Object.entries(value.areaProgressMap)) {
      if (areaId !== AREA) Object.assign(progress, {
        status: "completed", areaJudge: "normal", areaRateAdjustment: 0,
        completedAt: session.startedAt, completedRateText: "10%",
        completedNormalRateText: "10%", completedManyRateText: "20%",
      });
    }
  }
  return value;
}

function choices(value: AppState, now: Date, fixed = false) {
  return getAreaEvaluationQuickAdjustments({
    screen: value.screen, discountTime: value.session!.discountTime, isTestMode: fixed,
    now, progress: value.currentAreaId ? value.areaProgressMap[value.currentAreaId] : undefined,
  });
}

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  writes: string[] = [];
  removals: string[] = [];
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes.push(key); this.values.set(key, String(value)); }
  removeItem(key: string) { this.removals.push(key); this.values.delete(key); }
  clear() { this.values.clear(); this.writes = []; this.removals = []; }
}
class Events {
  listeners = new Map<string, Set<() => void>>();
  addEventListener = (type: string, callback: () => void) => {
    const values = this.listeners.get(type) ?? new Set<() => void>();
    values.add(callback); this.listeners.set(type, values);
  };
  removeEventListener = (type: string, callback: () => void) => { this.listeners.get(type)?.delete(callback); };
  emit(type: string) { for (const callback of [...(this.listeners.get(type) ?? [])]) callback(); }
}
const memory = new MemoryStorage();
const windowEvents = new Events();
const documentEvents = new Events();
const documentFixture = { hidden: false, addEventListener: documentEvents.addEventListener, removeEventListener: documentEvents.removeEventListener };
type Timeout = { callback: () => void; delay: number; due: number };
const timeouts = new Map<number, Timeout>();
const intervals = new Map<number, { callback: () => void; delay: number }>();
let timerId = 0;
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
Object.defineProperty(globalThis, "document", { configurable: true, value: documentFixture });
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  addEventListener: windowEvents.addEventListener, removeEventListener: windowEvents.removeEventListener,
  setTimeout(callback: () => void, delay = 0) { const id = ++timerId; timeouts.set(id, { callback, delay, due: nowMs + delay }); return id; },
  clearTimeout(id: number) { timeouts.delete(id); },
  setInterval(callback: () => void, delay: number) { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
  clearInterval(id: number) { intervals.delete(id); },
  confirm() { return true; }, scrollTo() {},
  alert(message: string) { throw new Error(`Unexpected operational alert: ${message}`); },
} });

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const sameDeps = (left?: readonly unknown[], right?: readonly unknown[]) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
class HookFixture {
  slots: Slot[] = [];
  index = 0;
  dirty = false;
  renders = 0;
  setters: number[] = [];
  effects: { callback: () => void | (() => void); slot: Slot }[] = [];
  app!: UseNebikiAppResult;
  fixedNow: Date | null = null;
  next() { return this.slots[this.index++] ??= {}; }
  dispatcher = {
    useRef: <T>(initial: T) => { const slot = this.next(); if (!("value" in slot)) slot.value = { current: initial }; return slot.value as { current: T }; },
    useState: <T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] => {
      const index = this.index, slot = this.next();
      if (!("value" in slot)) slot.value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slot.value as T, value => {
        this.setters.push(index);
        const next = typeof value === "function" ? (value as (previous: T) => T)(slot.value as T) : value;
        if (!Object.is(next, slot.value)) { slot.value = next; this.dirty = true; }
      }];
    },
    useMemo: <T>(callback: () => T, deps: readonly unknown[]) => { const slot = this.next(); if (!("value" in slot) || !sameDeps(slot.deps, deps)) { slot.value = callback(); slot.deps = deps; } return slot.value as T; },
    useCallback: <T>(callback: T, deps: readonly unknown[]) => this.dispatcher.useMemo(() => callback, deps),
    useEffect: (callback: () => void | (() => void), deps?: readonly unknown[]) => { const slot = this.next(); if (!sameDeps(slot.deps, deps)) { slot.deps = deps; this.effects.push({ callback, slot }); } },
  };
  render() {
    this.index = 0; this.dirty = false; this.effects = []; this.renders++;
    const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown };
    const previous = internals.H; internals.H = this.dispatcher;
    try { this.app = runProductionHook({ testNow: this.fixedNow }); } finally { internals.H = previous; }
  }
  settle(force = false) {
    if (force || this.dirty || !this.app) this.render();
    for (let pass = 0; pass < 15; pass++) {
      for (const { callback, slot } of this.effects) {
        // Run real clock/boundary/listener, navigation and persistence effects.
        // Unrelated asynchronous archive/network hydration is separate scope.
        if (!/app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|setInterval\(updateNow|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)|earlyNextMinus5TargetDiscountTime/.test(String(callback))) continue;
        slot.cleanup?.(); const cleanup = callback(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      }
      if (!this.dirty) return;
      this.render();
    }
    assert.fail("production synchronous hook effects converge");
  }
  close() { this.slots.forEach(slot => slot.cleanup?.()); }
}

function fixture(raw: AppState, timestamp: number): HookFixture {
  assert.equal(timeouts.size, 0, "previous fixture cleaned its timers");
  assert.equal(intervals.size, 0, "previous fixture cleaned its intervals");
  nowMs = timestamp; memory.clear(); documentFixture.hidden = false;
  memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(raw));
  memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(raw));
  memory.values.set(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(history(raw.session!.discountTime, raw.session!.demandCycle)));
  const hook = new HookFixture(); hook.settle(true); return hook;
}
const boundaryTimeouts = () => [...timeouts.entries()].filter(([, timer]) => /setNowMs/.test(String(timer.callback)));
function fireBoundaryTimers() {
  for (const [id, timer] of [...boundaryTimeouts()]) {
    if (timer.due <= nowMs) { timeouts.delete(id); timer.callback(); }
  }
}
function observation(hook: HookFixture) {
  return {
    state: json(hook.app.state), slots: JSON.stringify(hook.slots.map(slot => slot.value)),
    bytes: [...memory.values.entries()], writes: [...memory.writes], removals: [...memory.removals],
    pending: loadPendingSupabaseSyncQueue(), records: loadLocalAreaCountRecords(), setters: [...hook.setters],
  };
}

// Compile the actual router/screen and their TSX dependencies. Capturing the
// screen's real React tree allows old DOM handlers to be replayed after expiry.
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
    assert.ok(id.startsWith("."));
    const dependency = [id, id + ".ts", id + ".tsx"].map(path => new URL(path, url)).find(path => existsSync(path));
    assert.ok(dependency, `production component dependency exists: ${id}`);
    dependencies.set(id, dependency.pathname.endsWith(".tsx") ? await loadComponentModule(dependency) : await import(dependency.href));
  }
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { Date, exports, require: (id: string) => { assert.ok(dependencies.has(id)); return dependencies.get(id); } });
  componentModules.set(url.href, exports); return exports;
}
type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return React.isValidElement<Record<string, unknown>>(node) ? [node, ...elements(node.props.children as React.ReactNode)] : [];
}
function nodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return React.isValidElement<Record<string, unknown>>(node) ? nodeText(node.props.children as React.ReactNode) : "";
}
let screenTree: React.ReactNode = null;
const screenModule = await loadComponentModule(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url));
const actualScreen = screenModule.RateDisplayScreen as (props: Record<string, unknown>) => React.ReactNode;
screenModule.RateDisplayScreen = (props: Record<string, unknown>) => { screenTree = actualScreen(props); return screenTree; };
const routerModule = await loadComponentModule(new URL("../src/app/AppRouter.tsx", import.meta.url));
const Router = routerModule.AppRouter as React.ComponentType<{ app: UseNebikiAppResult; testNow?: Date | null }>;
function renderRouter(hook: HookFixture) {
  screenTree = null;
  const markup = renderToStaticMarkup(React.createElement(Router, { app: hook.app, testNow: hook.fixedNow }));
  const section = elements(screenTree).find(element => element.type === "section" && element.props["aria-label"] === "履歴中央値による自動判定");
  const buttons = section ? elements(section).filter(element => element.type === "button") : [];
  return { markup, section, buttons, directions: buttons.map(button => button.key), labels: buttons.map(nodeText) };
}
function click(button: Element) { return (button.props.onClick as () => void | Promise<void>)(); }

const results: { name: string; ok: boolean }[] = [];
async function test(name: string, run: () => void | Promise<void>) {
  await run(); results.push({ name, ok: true }); console.log(`PASS ${results.length}: ${name}`);
}

for (const time of ["15", "17"] as const) {
  await test(`${time}: JST cutoff helper returns exact milliseconds before, at and after boundary`, () => {
    const boundary = cutoff(time);
    for (const difference of [-3600000, -30000, -1000, -1, 0, 1, 1000, 3600000]) {
      assert.equal(getAreaEvaluationLowerQuickAdjustmentDelayMs(time, new NativeDate(boundary + difference)), Math.max(0, -difference));
    }
    assert.equal(getAreaEvaluationLowerQuickAdjustmentDelayMs(time, at("00:00:00")), (time === "15" ? 16 : 18) * 3600000);
    assert.equal(getAreaEvaluationLowerQuickAdjustmentDelayMs(time, at("23:59:59.999")), 0);
    assert.equal(getAreaEvaluationLowerQuickAdjustmentDelayMs(time, new NativeDate("invalid")), 0);
  });
}
await test("JST cutoff calculation is independent of UTC/local getters and offset representation", () => {
  const originalTz = process.env.TZ;
  try {
    for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = timezone;
      for (const [time, iso, offset] of [
        ["15", "2026-09-08T06:59:59.999Z", "2026-09-07T22:59:59.999-08:00"],
        ["17", "2026-09-08T08:59:59.999Z", "2026-09-08T17:59:59.999+09:00"],
      ] as const) {
        const date = new NativeDate(iso);
        date.getHours = () => { throw new Error("local hour must not determine JST cutoff"); };
        date.getMinutes = () => { throw new Error("local minutes must not determine JST cutoff"); };
        assert.equal(getAreaEvaluationLowerQuickAdjustmentDelayMs(time, date), 1);
        assert.equal(getAreaEvaluationLowerQuickAdjustmentDelayMs(time, new NativeDate(offset)), 1);
      }
    }
  } finally { process.env.TZ = originalTz; }
});
await test("non15/17 saved slots retain existing behavior, including forced50 exclusion", () => {
  for (const time of ["18", "19", "20"] as const) {
    assert.equal(getAreaEvaluationLowerQuickAdjustmentDelayMs(time, at("23:59:59")), null);
    assert.equal(choices(state(time), at("23:59:59")).length, time === "20" ? 0 : 2);
  }
});

for (const cycle of ["normal", "summer"] as const) for (const time of ["15", "17"] as const) {
  await test(`${cycle}/${time}: all five auto evaluations retain endpoint/higher rules while lower expires exactly`, () => {
    for (const original of EVALUATIONS) {
      const value = state(time, cycle, original), before = json(value);
      const baseline = ["higher", "lower"].filter(direction => createAreaEvaluationQuickAdjustment(original, direction as HumanEvaluationAdjustment["direction"]));
      for (const delta of [-1, 0, 1, 60000]) {
        const expected = delta < 0 ? baseline : baseline.filter(direction => direction !== "lower");
        assert.deepEqual(choices(value, new NativeDate(cutoff(time) + delta)).map(adjustment => adjustment.direction), expected);
      }
      assert.deepEqual(json(value), before, "filter never rewrites saved observation");
    }
  });
}
await test("ready/source/count/screen/fixed gates remain intact before and after boundary", () => {
  for (const now of [at("15:59:59"), at("16:00:00")]) {
    for (const screen of ["start", "area_judge", "done", "review19", "review19_weather", "review19_done", "final_time"] as const) {
      assert.deepEqual(choices({ ...state("15"), screen }, now), []);
    }
    assert.deepEqual(choices(state("15"), now, true), []);
    for (const status of ["insufficient", "disabled"] as const) {
      const value = state("15"); value.areaProgressMap[AREA].areaCountDecisionBasis!.recommendationStatus = status;
      assert.deepEqual(choices(value, now), []);
    }
    const absentCount = state("15"); delete absentCount.areaProgressMap[AREA].areaCount;
    assert.deepEqual(choices(absentCount, now), []);
    const absentBasis = state("15"); delete absentBasis.areaProgressMap[AREA].areaCountDecisionBasis;
    assert.deepEqual(choices(absentBasis, now), []);
    const absentAuto = state("15"); absentAuto.areaProgressMap[AREA].areaCountEvaluationSource = "manual";
    assert.deepEqual(choices(absentAuto, now), []);
  }
});
await test("saved lower always uses original automatic observation and invalid clock fails lower closed", () => {
  const value = state("17", "summer", "slightly_many");
  const adjustment = createAreaEvaluationQuickAdjustment("slightly_many", "lower")!;
  const selection = createHumanEvaluationSelection(adjustment.finalEvaluation)!;
  Object.assign(value.areaProgressMap[AREA], {
    areaCountEvaluationSource: "manual", areaCountEvaluation: adjustment.finalEvaluation,
    humanEvaluationDetails: { ...resolveHumanEvaluationForDiscount({
      selection, demandCycle: "summer", sessionDiscountTime: "17", nowMs: at("17:59:59").getTime(), evaluatedAt: at("17:59:59").toISOString(),
    }), automaticEvaluation: "slightly_many", evaluationAdjustment: adjustment },
  });
  for (const now of [at("18:00:00"), new NativeDate("invalid")]) {
    assert.deepEqual(choices(value, now), [createAreaEvaluationQuickAdjustment("slightly_many", "higher")]);
    assert.deepEqual(value.areaProgressMap[AREA].humanEvaluationDetails?.evaluationAdjustment, adjustment);
  }
});

for (const cycle of ["normal", "summer"] as const) for (const time of ["15", "17"] as const) {
  await test(`${cycle}/${time}: production timeout renders exact expiry and cleans up listeners/timers`, () => {
    const hook = fixture(state(time, cycle), cutoff(time) - 1);
    try {
      assert.deepEqual(renderRouter(hook).directions, ["higher", "lower"]);
      const timer = boundaryTimeouts(); assert.equal(timer.length, 1); assert.equal(timer[0][1].delay, 1); assert.equal(timer[0][1].due, cutoff(time));
      const stateBefore = json(hook.app.state), renders = hook.renders, writes = memory.writes.length;
      nowMs = cutoff(time); fireBoundaryTimers(); hook.settle();
      assert.ok(hook.renders > renders, "timeout forces React update at cutoff");
      assert.deepEqual(renderRouter(hook).directions, ["higher"]);
      assert.deepEqual(json(hook.app.state), stateBefore, "clock does not rewrite progress");
      assert.equal(memory.writes.length, writes, "clock-only rerender adds no persistence writes");
      assert.equal(boundaryTimeouts().length, 0, "expired boundary is not rescheduled");
      assert.ok([...intervals.values()].some(timer => timer.delay === 30000));
    } finally { hook.close(); }
    assert.equal(timeouts.size, 0); assert.equal(intervals.size, 0);
    assert.equal(windowEvents.listeners.get("focus")?.size ?? 0, 0);
    assert.equal(documentEvents.listeners.get("visibilitychange")?.size ?? 0, 0);
  });
  await test(`${cycle}/${time}: old rendered lower event is rejected without state/records/undo/cloud/writes; higher still acts`, async () => {
    const hook = fixture(state(time, cycle), cutoff(time) - 1);
    try {
      const rendered = renderRouter(hook), lower = rendered.buttons.find(button => button.key === "lower")!, higher = rendered.buttons.find(button => button.key === "higher")!;
      assert.ok(lower); assert.ok(higher);
      const before = observation(hook);
      nowMs = cutoff(time); // Keep old hook/tree: no timer, focus or render first.
      await click(lower);
      assert.deepEqual(observation(hook), before, "rejection precedes all production state setters and storage/cloud queue writes");
      assert.equal(hook.dirty, false);
      await click(higher); hook.settle();
      const progress = hook.app.state.areaProgressMap[AREA];
      assert.equal(progress.areaCountEvaluation, "slightly_many");
      assert.deepEqual(progress.humanEvaluationDetails?.evaluationAdjustment, createAreaEvaluationQuickAdjustment("normal", "higher"));
      assert.equal(progress.areaRateAdjustment, 5);
      const current = loadLocalAreaCountRecords().filter(record => record.date === DATE && record.discountTime === time);
      assert.equal(current.length, 1); assert.equal(current[0].suggestedEvaluation, "slightly_many");
      assert.ok(memory.writes.length > before.writes.length);
      assert.deepEqual(renderRouter(hook).directions, ["higher"]);
    } finally { hook.close(); }
  });
}

for (const time of ["15", "17"] as const) for (const trigger of ["focus", "visibility", "interval"] as const) {
  await test(`${time}: ${trigger} updates expired quick buttons and refreshes boundary timeout from fresh clock`, () => {
    const hook = fixture(state(time), cutoff(time) - 12345);
    try {
      assert.equal(boundaryTimeouts()[0][1].delay, 12345);
      nowMs = cutoff(time) - 100;
      if (trigger === "focus") windowEvents.emit("focus");
      if (trigger === "visibility") documentEvents.emit("visibilitychange");
      if (trigger === "interval") [...intervals.values()].find(timer => timer.delay === 30000)!.callback();
      hook.settle();
      assert.equal(boundaryTimeouts().length, 1); assert.equal(boundaryTimeouts()[0][1].delay, 100);
      const renders = hook.renders; nowMs = cutoff(time);
      if (trigger === "focus") windowEvents.emit("focus");
      if (trigger === "visibility") {
        documentFixture.hidden = true; documentEvents.emit("visibilitychange"); hook.settle(); assert.equal(hook.renders, renders, "hidden event does not wake clock");
        documentFixture.hidden = false; documentEvents.emit("visibilitychange");
      }
      if (trigger === "interval") [...intervals.values()].find(timer => timer.delay === 30000)!.callback();
      hook.settle(); assert.deepEqual(renderRouter(hook).directions, ["higher"]); assert.equal(boundaryTimeouts().length, 0);
    } finally { hook.close(); }
  });
}
await test("boundary timeout is limited to active rate screen and removed on navigation/session change/fixed mode", () => {
  const hook = fixture(state("15"), at("15:59:00").getTime());
  try {
    const first = boundaryTimeouts()[0][0];
    hook.app.actions.startEditingConditions(); hook.settle();
    assert.equal(hook.app.state.screen, "start"); assert.equal(timeouts.has(first), false); assert.equal(boundaryTimeouts().length, 0);
    const stateSlot = hook.slots.find(slot => slot.value === hook.app.state)!;
    stateSlot.value = state("17"); hook.settle(true);
    assert.equal(boundaryTimeouts().length, 1); assert.equal(boundaryTimeouts()[0][1].due, cutoff("17"));
    hook.fixedNow = new Date(at("17:59:00").getTime()); hook.settle(true);
    assert.equal(boundaryTimeouts().length, 0); assert.deepEqual(renderRouter(hook).directions, []);
  } finally { hook.close(); }
});

for (const cycle of ["normal", "summer"] as const) for (const time of ["15", "17"] as const) {
  await test(`${cycle}/${time}: saved lower survives expiry, late+5 completion, session/day/export and reload without accumulation`, async () => {
    let hook = fixture(state(time, cycle, "slightly_many", true), cutoff(time) - 1);
    try {
      for (let repeat = 0; repeat < 2; repeat++) {
        const lower = renderRouter(hook).buttons.find(button => button.key === "lower")!;
        assert.ok(lower); await click(lower); hook.settle();
      }
      const adjustment = createAreaEvaluationQuickAdjustment("slightly_many", "lower")!;
      const details = json(hook.app.state.areaProgressMap[AREA].humanEvaluationDetails!);
      assert.deepEqual(details.evaluationAdjustment, adjustment);
      assert.equal(details.automaticEvaluation, "slightly_many"); assert.equal(details.resolvedEvaluation, "normal");
      const recordBefore = loadLocalAreaCountRecords().find(record => record.date === DATE && record.discountTime === time)!;
      assert.equal(loadLocalAreaCountRecords().filter(record => record.date === DATE && record.discountTime === time).length, 1, "quick repeats keep one canonical observation");
      const beforeRate = Number(hook.app.derived.rateDisplay!.normal.main.replace("%", ""));
      nowMs = cutoff(time); fireBoundaryTimers(); hook.settle();
      const shown = json(hook.app.derived.rateDisplay!);
      assert.equal(Number(shown.normal.main.replace("%", "")), beforeRate + 5, "neutral-weather late adjustment is exactly five points");
      assert.deepEqual(hook.app.state.areaProgressMap[AREA].humanEvaluationDetails, details);
      assert.deepEqual(loadLocalAreaCountRecords().find(record => record.date === DATE && record.discountTime === time), recordBefore);
      const rendered = renderRouter(hook);
      assert.deepEqual(rendered.directions, ["higher"]);
      assert.equal(nodeText(rendered.section), "中央値判定：やや多い人間補正：1段少ない側採用判定：普通多いにする");
      for (let render = 0; render < 3; render++) { hook.settle(true); assert.deepEqual(hook.app.derived.rateDisplay, shown); }
      hook.app.actions.goToNextArea(); hook.settle();
      assert.equal(hook.app.state.screen, "done");
      const progress = hook.app.state.areaProgressMap[AREA], snapshot = json(progress.rateDecisionSnapshot!);
      assert.equal(snapshot.sessionDiscountTime, time); assert.equal(snapshot.effectiveRateDiscountTime, time);
      assert.equal(snapshot.calculationMode, "late_plus5"); assert.equal(snapshot.lateTimeAdjustmentPercent, 5);
      assert.equal(snapshot.earlyNextAdjustmentPercent, 0); assert.equal(snapshot.areaCountAdjustmentPercent, 0);
      assert.equal(snapshot.displayedRateText, shown.normal.main); assert.deepEqual(progress.humanEvaluationDetails, details);
      const savedDaily = storage.loadDailySessionSnapshots().find(value => value.session.startedAt === hook.app.state.session!.startedAt)!;
      assert.ok(savedDaily); assert.deepEqual(savedDaily.areas[AREA].rateDecisionSnapshot, snapshot);
      assert.deepEqual(savedDaily.areas[AREA].humanEvaluationDetails, details);
      const capturedAt = new NativeDate(nowMs).toISOString(), completedState = json(hook.app.state);
      const resolvedWeather = resolveWeatherInputForDiscount(completedState.session!.weather, time);
      const snapshotInputs = {
        capturedAt, resolvedWeather, lateTimeBonus: 5, doneSummaryItems: hook.app.derived.doneSummaryItems,
        weekdayBaseInfo: getWeekdayBaseInfo(2, time, resolvedWeather, DATE, cycle),
        basisGuide: getBasisGuideDisplay({ date: DATE, weekday: 2, discountTime: time, demandCycle: cycle, weather: resolvedWeather }),
      };
      const daily = createDailySessionSnapshot({ ...snapshotInputs, state: completedState })!;
      const reviewSnapshot = createReview19Snapshot({ ...snapshotInputs, session: completedState.session!, areaProgressMap: completedState.areaProgressMap, excludedAreaIds: [] });
      const day = createReview19DaySnapshot({ date: DATE, capturedAt, demandCycle: cycle, sessions: [daily], areaCountRecords: [recordBefore] });
      const finalized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot: day, finalizedAt: capturedAt }).record;
      const dayExport = buildAutomaticDayExportPayload({ date: DATE, exportedAt: capturedAt, daySnapshot: day });
      const review = createInitialReview19Result({ date: DATE, demandCycle: cycle, sessionStartedAt: completedState.session!.startedAt, reviewStartedAt: capturedAt, excludedAreaIds: [] });
      Object.assign(review, { review19Status: "recorded", recordedAt: capturedAt, snapshot: reviewSnapshot, daySnapshot: day });
      const exported = buildDirectReview19DataExportPayload({ record: review, exportedAt: capturedAt });
      const remote = buildRemoteAreaCountRow(recordBefore);
      const propagated: (HumanEvaluationDetails | undefined)[] = [
        daily.areas[AREA].humanEvaluationDetails, reviewSnapshot.areas[AREA].humanEvaluationDetails,
        day.sessions[0].areas[AREA].humanEvaluationDetails, day.areaCountRecords[0].humanEvaluationDetails,
        finalized.sessions[0].areas[AREA].humanEvaluationDetails, finalized.areaCountRecords[0].humanEvaluationDetails,
        dayExport.daySnapshot.sessions[0].areas[AREA].humanEvaluationDetails,
        exported.records[0].snapshot!.areas[AREA].humanEvaluationDetails,
        exported.records[0].daySnapshot!.sessions[0].areas[AREA].humanEvaluationDetails,
        exported.records[0].daySnapshot!.areaCountRecords[0].humanEvaluationDetails,
        remote.record_details!.humanEvaluationDetails,
      ];
      for (const value of propagated) assert.deepEqual(value, details);
      assert.equal(exported.dataSchemaVersion, 3); assert.equal(remote.discount_time, time); assert.equal(remote.demand_cycle, cycle);
      assert.deepEqual(dayExport.daySnapshot.sessions[0].areas[AREA].rateDecisionSnapshot, snapshot);
      assert.deepEqual(exported.records[0].daySnapshot!.sessions[0].areas[AREA].rateDecisionSnapshot, snapshot);
      hook.close(); hook = new HookFixture(); nowMs = cutoff(time) + 60000; hook.settle(true);
      assert.deepEqual(hook.app.state.areaProgressMap[AREA].rateDecisionSnapshot, snapshot);
      assert.deepEqual(hook.app.state.areaProgressMap[AREA].humanEvaluationDetails, details);
      for (let render = 0; render < 3; render++) { hook.settle(true); assert.deepEqual(hook.app.state.areaProgressMap[AREA].rateDecisionSnapshot, snapshot); }
      assert.deepEqual(storage.loadDailySessionSnapshots().find(value => value.session.startedAt === completedState.session!.startedAt)!.areas[AREA].rateDecisionSnapshot, snapshot);
    } finally { hook.close(); }
  });
}

assert.equal(timeouts.size, 0); assert.equal(intervals.size, 0);
Object.defineProperty(globalThis, "Date", { configurable: true, value: NativeDate });
console.log(`late area quick50 checks passed: ${results.length}/${results.length}`);
