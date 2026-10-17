import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import { loadPendingSupabaseSyncQueue } from "../src/domain/supabaseSyncQueue.ts";
import * as storage from "../src/domain/storage.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { setRuntimeNowOverride } from "../src/hooks/nebikiApp/clock.ts";
import { useNebikiApp as runProductionHook } from "../src/hooks/useNebikiApp.ts";
import type { DemandCycle, DiscountTime, DoneSummaryItem, SessionDraft, UseNebikiAppResult } from "../src/domain/types.ts";
import type { DoneScreen } from "../src/components/screens/DoneScreen.tsx";
import type { AppRouter } from "../src/app/AppRouter.tsx";

// Production TSX, the complete hook/actions and its existing aligned scheduler
// execute unchanged. React scheduling, browser events/time and storage are
// deterministic fixtures; native paint, IDB hydration and Supabase are separate.
process.env.TZ = "Asia/Tokyo";
const NativeDate = Date;
const DATE = "2026-09-08", AREA = "bento_men";
const at = (clock: string) => new NativeDate(`${DATE}T${clock}+09:00`).getTime();
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
type Timer = { callback: () => void; delay: number; due: number };
const timeouts = new Map<number, Timer>();
let timerId = 0;
const documentFixture = { hidden: false, addEventListener: documentEvents.addEventListener, removeEventListener: documentEvents.removeEventListener };
const windowFixture = {
  addEventListener: windowEvents.addEventListener, removeEventListener: windowEvents.removeEventListener,
  setTimeout(callback: () => void, delay = 0) { const id = ++timerId; timeouts.set(id, { callback, delay, due: nowMs + delay }); return id; },
  clearTimeout(id: number) { timeouts.delete(id); },
  setInterval() { assert.fail("Done strike-through must reuse the aligned timeout clock"); }, clearInterval() {},
  location: { search: "", hash: "", href: "http://done53.invalid/", pathname: "/" },
  confirm() { return true; }, scrollTo() {}, alert(message: string) { assert.fail(`Unexpected alert: ${message}`); },
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
Object.defineProperty(globalThis, "document", { configurable: true, value: documentFixture });
Object.defineProperty(globalThis, "window", { configurable: true, value: windowFixture });
function clean() {
  assert.equal(timeouts.size, 0, "all production timers are disposed");
  assert.equal(windowEvents.count("focus"), 0); assert.equal(documentEvents.count("visibilitychange"), 0);
  setRuntimeNowOverride(null); documentFixture.hidden = false;
}
function fireDueTimers() {
  const due = [...timeouts].filter(([, timer]) => timer.due <= nowMs);
  assert.ok(due.length > 0, "an elapsed production clock timeout fires");
  for (const [id, timer] of due) { timeouts.delete(id); timer.callback(); }
}
function assertOneAlignedTimer() {
  assert.equal(timeouts.size, 1, "the existing hook is the single timer owner");
  const timer = [...timeouts.values()][0];
  assert.ok(timer.delay > 0 && timer.delay <= 30000); assert.equal(timer.due % 30000, 0);
}

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) => a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
class ReactFixture<T> {
  slots: Slot[] = []; index = 0; dirty = false; renders = 0; fixedNow: Date | null = null;
  pending: { callback: () => void | (() => void); slot: Slot }[] = [];
  value!: T;
  renderValue: (fixture: ReactFixture<T>) => T;
  include: (text: string) => boolean;
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
    assert.fail("production synchronous effects converge");
  }
  close() { this.slots.forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined; }); }
}
const hookEffects = (text: string) => /app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|areaCompletionStateRef\.current|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|startAlignedRuntimeClock|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)|earlyNextMinus5TargetDiscountTime/.test(text);
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
const Done = (await loadTsx(new URL("../src/components/screens/DoneScreen.tsx", import.meta.url))).DoneScreen as typeof DoneScreen;
const Router = (await loadTsx(new URL("../src/app/AppRouter.tsx", import.meta.url))).AppRouter as typeof AppRouter;
const noop = () => {};
function item(patch: Partial<DoneSummaryItem> = {}): DoneSummaryItem {
  return { areaId: AREA, areaName: "弁当・麺", judgeText: "普通", rateText: "20%", manyRateText: "30%", normalRateText: "20%", manyRatePercent: 30, normalRatePercent: 20, statusText: "完了", ...patch };
}
function renderDone(summaryItems: DoneSummaryItem[], strikeNormalRate?: boolean) {
  return renderToStaticMarkup(React.createElement(Done, { summaryItems, strikeNormalRate, referenceConditionLabel: "9月・火曜日・17時", onGoBack: noop, onReturnHome: noop }));
}
function line(markup: string, label: "多い" | "どちらでもない") {
  const match = markup.match(new RegExp(`<div style="([^"]*)">${label} → ([^<]*)</div>`));
  assert.ok(match, `actual Done ${label} line exists`); return { style: match[1], text: match[2] };
}
const withoutStrike = (markup: string) => markup.replace(/;text-decoration-line:line-through;text-decoration-style:solid/g, "");
function assertStrike(markup: string, expected: boolean) {
  assert.equal(/(?:^|;)text-decoration-line:line-through(?:;|$)/.test(line(markup, "どちらでもない").style), expected);
  assert.equal(/(?:^|;)text-decoration-style:solid(?:;|$)/.test(line(markup, "どちらでもない").style), expected);
  assert.doesNotMatch(markup, /opacity:/);
  assert.doesNotMatch(line(markup, "多い").style, /text-decoration/);
}
function draft(time: DiscountTime, cycle: DemandCycle): SessionDraft {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const forecast of Object.values(hourlyForecasts)) Object.assign(forecast, { weather: "sunny", tempC: 29, windMs: 2 });
  return { date: DATE, weekday: 2, discountTime: time, demandCycle: cycle, manualWeekdayOverride: false, manualDiscountTimeOverride: false, weather: { hourlyForecasts, afterRainSky: null } };
}
function activeState(time: "15" | "17", cycle: DemandCycle) {
  const input = draft(time, cycle), raw = createInitialState(input);
  raw.session = { ...input, ...getCurrentDataVersionInfo(), globalDiscountAdjustmentPercent: 0, startedAt: new NativeDate(at(`${time}:00:00`)).toISOString() };
  raw.screen = "rate_display"; raw.currentAreaId = AREA;
  for (const progress of Object.values(raw.areaProgressMap)) Object.assign(progress, { status: "completed", areaJudge: "normal", areaRateAdjustment: 0, completedAt: raw.session.startedAt, completedRateText: "10%", completedNormalRateText: "10%", completedManyRateText: "20%" });
  Object.assign(raw.areaProgressMap[AREA], { status: "unstarted", areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaCountEvaluationSource: "manual", areaRateAdjustment: 0 });
  return raw;
}
function hookFixture(time: "15" | "17", cycle: DemandCycle, clock: string) {
  clean(); nowMs = at(clock); memory.clear(); const raw = activeState(time, cycle);
  memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(raw)); memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(raw));
  const hook = new ReactFixture<UseNebikiAppResult>(self => runProductionHook({ testNow: self.fixedNow }), hookEffects);
  hook.settle(true); return hook;
}
function renderRouter(app: UseNebikiAppResult, testNow?: Date | null) {
  return renderToStaticMarkup(React.createElement(Router, { app, testNow }));
}
function minimalApp(time?: DiscountTime, cycle: DemandCycle = "normal") {
  const raw = createInitialState(draft(time ?? "15", cycle)); raw.screen = "done";
  if (time) raw.session = { ...draft(time, cycle), startedAt: new NativeDate(at("15:00:00")).toISOString() };
  return { state: raw, derived: { doneSummaryItems: [item()], basisGuide: { referenceConditionLabel: "9月・火曜日" } }, actions: { goBackOneScreen: noop, resetApp: noop } } as unknown as UseNebikiAppResult;
}
let passed = 0;
async function test(name: string, run: () => void | Promise<void>) { await run(); clean(); passed++; console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`); }

await test("optional strike flag defaults to the existing complete markup", () => {
  assert.equal(renderDone([item()]), renderDone([item()], false));
  assertStrike(renderDone([item()]), false);
});
for (const value of [0, 5, 20, 50]) await test(`numeric normal ${value}% strikes only its complete line and preserves independent red/green`, () => {
  const values = [item({ normalRatePercent: value, normalRateText: `${value}%` })], before = JSON.stringify(values), plain = renderDone(values, false), strike = renderDone(values, true);
  assertStrike(strike, true); assert.equal(withoutStrike(strike), plain); assert.equal(JSON.stringify(values), before);
  assert.match(line(strike, "多い").style, /color:#ff0000(?:;|$)/);
  assert.equal(line(strike, "どちらでもない").style.includes("color:#008000"), value > 0);
  assert.equal(line(strike, "どちらでもない").text, `${value}%`);
});
for (const value of [undefined, null, NaN, Infinity, -Infinity, -1, "20"]) await test(`unknown/invalid normal ${String(value)} never infers numeric strike-through from 20% text`, () => {
  const values = [item({ normalRatePercent: value as number })];
  assert.equal(renderDone(values, true), renderDone(values, false)); assertStrike(renderDone(values, true), false);
});
await test("skip, unfinished, unknown instructions, status, labels and area order remain byte-identical", () => {
  const values = [
    item({ rateText: "スキップ済み", statusText: "今はスキップ" }),
    item({ areaId: "onigiri", areaName: "おにぎり", rateText: "未完了", manyRateText: "未完了", normalRateText: "未完了", manyRatePercent: undefined, normalRatePercent: undefined, statusText: "未完了" }),
    item({ areaId: "inari", areaName: "いなり", rateText: "前回値引率不明", manyRateText: undefined, normalRateText: undefined, manyRatePercent: undefined, normalRatePercent: undefined, statusText: "保存済みの状態\n再確認" }),
  ];
  const strike = renderDone(values, true); assert.equal(strike, renderDone(values, false)); assert.doesNotMatch(strike, /opacity:/);
  assert.ok(strike.indexOf("弁当・麺") < strike.indexOf("おにぎり")); assert.ok(strike.indexOf("おにぎり") < strike.indexOf("いなり"));
  for (const text of ["9月・火曜日・17時", "スキップ済み", "今はスキップ", "未完了", "前回値引率不明", "保存済みの状態\n再確認", "戻る", "トップに戻る"]) assert.ok(strike.includes(text), text);
});
for (const cycle of ["normal", "summer"] as const) for (const time of ["15", "17"] as const) {
  const before = time === "15" ? "15:59:59.999" : "17:59:59.999", boundary = time === "15" ? "16:00:00" : "18:00:00", after = time === "15" ? "16:00:00.001" : "18:00:00.001";
  for (const [clock, expected] of [[before, false], [boundary, true], [after, true]] as const) await test(`${cycle}/${time}: actual Router uses runtime JST ${clock}`, () => {
    nowMs = at("12:00:00"); setRuntimeNowOverride(new Date(at(clock)));
    const app = minimalApp(time, cycle), beforeState = JSON.stringify(app), html = renderRouter(app, new Date(at("12:00:00")));
    assertStrike(html, expected); assert.equal(JSON.stringify(app), beforeState); assert.equal(timeouts.size, 0);
  });
}
for (const time of [undefined, "18", "19", "20"] as const) await test(`missing/legacy ${String(time)} session never strikes at 20:45`, () => {
  setRuntimeNowOverride(new Date(at("20:45:00"))); assertStrike(renderRouter(minimalApp(time)), false);
});
for (const cycle of ["normal", "summer"] as const) for (const time of ["15", "17"] as const) {
  const before = time === "15" ? "15:59:59.999" : "17:59:59.999", boundary = time === "15" ? "16:00:00" : "18:00:00";
  await test(`${cycle}/${time}: real completion and aligned 00/30 ticks strike current +5 rates while retaining captured/storage evidence`, () => {
    const hook = hookFixture(time, cycle, before);
    try {
      const expected = time === "15" ? [0, 10] : [10, 20];
      assert.deepEqual([hook.value.derived.rateDisplay!.normal.main, hook.value.derived.rateDisplay!.many.main], expected.map(value => `${value}%`));
      hook.value.actions.goToNextArea(); hook.settle(); assert.equal(hook.value.state.screen, "done");
      const progress = hook.value.state.areaProgressMap[AREA], captured = JSON.stringify(progress.rateDecisionSnapshot), state = JSON.stringify(hook.value.state);
      assert.ok(progress.rateDecisionSnapshot); assert.equal(progress.rateDecisionSnapshot.lateTimeAdjustmentPercent, 0); assert.equal(progress.rateDecisionSnapshot.calculationMode, "normal");
      assert.deepEqual([progress.rateDecisionSnapshot.normalRatePercent, progress.rateDecisionSnapshot.manyRatePercent], expected);
      const currentBefore = hook.value.derived.doneSummaryItems.find(value => value.areaId === AREA)!;
      assert.deepEqual([currentBefore.normalRatePercent, currentBefore.manyRatePercent], expected);
      const beforeHtml = renderRouter({ ...hook.value, derived: { ...hook.value.derived, doneSummaryItems: [currentBefore] } });
      assertStrike(beforeHtml, false); assertOneAlignedTimer();
      const bytes = [...memory.values], writes = memory.writes.length, removals = memory.removals.length, records = loadLocalAreaCountRecords(), queue = loadPendingSupabaseSyncQueue();
      const daily = storage.loadDailySessionSnapshots(); assert.ok(daily.length > 0, "real Done completion persists its captured daily snapshot");
      const dailyArea = daily.at(-1)!.areas[AREA]; assert.deepEqual(JSON.parse(JSON.stringify(dailyArea.rateDecisionSnapshot)), JSON.parse(captured));
      nowMs = at(boundary); fireDueTimers(); hook.settle();
      const current = hook.value.derived.doneSummaryItems.find(value => value.areaId === AREA)!;
      assert.deepEqual([current.normalRatePercent, current.manyRatePercent], expected.map(value => value + 5), "existing current-rate late bonus remains exactly +5 points");
      const renderWrites = memory.writes.length;
      const html = renderRouter({ ...hook.value, derived: { ...hook.value.derived, doneSummaryItems: [current] } });
      assert.equal(memory.writes.length, renderWrites, "actual Router/Done strike rendering never writes storage");
      assertStrike(html, true); assert.match(line(html, "多い").style, /color:#ff0000/); assert.match(line(html, "どちらでもない").style, /color:#008000/);
      assert.equal(line(html, "どちらでもない").text, `${expected[0] + 5}%`);
      assert.equal(JSON.stringify(hook.value.state), state); assert.equal(JSON.stringify(hook.value.state.areaProgressMap[AREA].rateDecisionSnapshot), captured);
      assert.deepEqual([...memory.values], bytes); assert.equal(memory.removals.length, removals);
      // The unchanged completion effect depends on lateTimeBonus and may
      // re-save its identical daily journal; the UI adds no persistence.
      assert.ok(memory.writes.slice(writes).every(key => key === storage.STORAGE_KEYS.dailySessionSnapshots), JSON.stringify(memory.writes.slice(writes)));
      assert.deepEqual(storage.loadDailySessionSnapshots(), daily); assert.deepEqual(loadLocalAreaCountRecords(), records); assert.deepEqual(loadPendingSupabaseSyncQueue(), queue); assertOneAlignedTimer();
      nowMs = at(time === "15" ? "16:00:30" : "18:00:30"); fireDueTimers(); hook.settle();
      assert.deepEqual(hook.value.derived.doneSummaryItems.find(value => value.areaId === AREA), current); assertStrike(renderRouter({ ...hook.value, derived: { ...hook.value.derived, doneSummaryItems: [current] } }), true);
      assert.deepEqual([...memory.values], bytes); assertOneAlignedTimer();
      assert.doesNotMatch(JSON.stringify([hook.value.state, current, ...memory.values]), /strikeNormalRate/);
    } finally { hook.close(); }
  });
  await test(`${cycle}/${time}: fixed runtime controls strike-through while real time/focus cannot advance it or add a timer/write`, () => {
    const hook = hookFixture(time, cycle, before);
    try {
      hook.value.actions.goToNextArea(); hook.settle();
      hook.fixedNow = new Date(at(before)); hook.settle(true); assert.equal(timeouts.size, 0);
      const bytes = [...memory.values], writes = memory.writes.length, captured = JSON.stringify(hook.value.state.areaProgressMap[AREA].rateDecisionSnapshot);
      assertStrike(renderRouter(hook.value, hook.fixedNow), false);
      nowMs = at(time === "15" ? "16:10:00" : "18:10:00"); windowEvents.emit("focus"); documentEvents.emit("visibilitychange"); hook.settle();
      assertStrike(renderRouter(hook.value, hook.fixedNow), false); assert.equal(timeouts.size, 0);
      hook.fixedNow = new Date(at(boundary)); hook.settle(true); assertStrike(renderRouter(hook.value, hook.fixedNow), true);
      hook.fixedNow = new Date(at(before)); hook.settle(true); assertStrike(renderRouter(hook.value, hook.fixedNow), false);
      assert.equal(timeouts.size, 0); assert.deepEqual([...memory.values], bytes); assert.equal(memory.writes.length, writes);
      assert.equal(JSON.stringify(hook.value.state.areaProgressMap[AREA].rateDecisionSnapshot), captured);
    } finally { hook.close(); }
  });
}
await test("a late/focus return uses the existing scheduler once and strikes immediately", () => {
  const hook = hookFixture("17", "normal", "17:59:07.125");
  try {
    hook.value.actions.goToNextArea(); hook.settle(); assertStrike(renderRouter(hook.value), false);
    nowMs = at("18:02:17.345"); windowEvents.emit("focus"); hook.settle(); assertStrike(renderRouter(hook.value), true); assertOneAlignedTimer();
    documentFixture.hidden = true; documentEvents.emit("visibilitychange"); hook.settle(); assertOneAlignedTimer();
    documentFixture.hidden = false; documentEvents.emit("visibilitychange"); hook.settle(); assertStrike(renderRouter(hook.value), true); assertOneAlignedTimer();
  } finally { hook.close(); }
});
await test("Done/Router add no state, storage or timers; domain/summary types carry no UI strike flag", () => {
  for (const path of ["../src/components/screens/DoneScreen.tsx", "../src/app/AppRouter.tsx"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:setInterval|setTimeout|startAlignedRuntimeClock|localStorage|sessionStorage|useState|useReducer)\b/);
  }
  for (const path of ["../src/domain/types.ts", "../src/hooks/useNebikiApp.ts", "../src/hooks/nebikiApp/sessionSnapshots.ts"]) assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), "utf8"), /strikeNormalRate/);
});
Object.defineProperty(globalThis, "Date", { configurable: true, value: NativeDate });
console.log(`Done normal strike54 compatibility checks passed: ${passed}/${passed}`);
