import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { getAdoptedEvaluation } from "../src/domain/pending.ts";
import { resolveHumanEvaluationForDiscount } from "../src/domain/humanEvaluation.ts";
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
import type { AppState, AreaCountEvaluation, DemandCycle, UseNebikiAppResult } from "../src/domain/types.ts";
import type { AppRouter } from "../src/app/AppRouter.tsx";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";

// Execute actual production TSX, React SSR, UI event handlers and the full
// business hook using the existing 56/58 React-dispatcher fixture. Native
// browser layout, IndexedDB hydration and live transport are separate checks.
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
  location: { search: "", hash: "", href: "http://reference61.invalid/", pathname: "/" },
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

const noop = () => {};
const labels: Record<AreaCountEvaluation, string> = {
  many: "多い", slightly_many: "やや多い", normal: "普通", slightly_few: "やや少ない", few: "少ない",
};
function isolatedRate(patch: Partial<React.ComponentProps<typeof Rate>> = {}) {
  return React.createElement(Rate, { weekdayText: "金曜日", timeText: "17時", areaName: "弁当・麺", discountTime: "17",
    basisGuide: { referenceText: "unused alternate reference", referenceConditionLabel: "11月・金曜日・17時" },
    rateDisplay: { many: { main: "30%" }, normal: { main: "20%" }, few: { main: "引かない" } },
    onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop, ...patch });
}
function persistence() {
  return { bytes: [...memory.values], writes: [...memory.writes], removals: [...memory.removals],
    records: loadLocalAreaCountRecords(), queue: loadPendingSupabaseSyncQueue(),
    daily: storage.loadDailySessionSnapshots(), skip: storage.loadNextSessionSkipRecords() };
}
function assertReference(value: AppFixture, label: string, expected: AreaCountEvaluation | undefined) {
  const panel = value.nodes.find(node => node.props["aria-label"] === "値引の基準とエリア判定");
  assert.ok(panel, "the actual shared product-reference panel exists");
  const [condition, instruction] = panel.children;
  assert.ok(typeof condition !== "string" && condition.type === "div");
  assert.ok(typeof instruction !== "string" && instruction.type === "div");
  assert.equal(textOf(condition), `${label.replaceAll("・", " ")}\u3000エリア判定：${expected ? labels[expected] : "未記録"}`);
  const field = condition.children.find(child => typeof child !== "string" && child.type === "span");
  assert.ok(field && typeof field !== "string", "the adopted field is a single inline unit");
  assert.equal(textOf(field), `エリア判定：${expected ? labels[expected] : "未記録"}`);
  assert.equal((field.props.style as React.CSSProperties).whiteSpace, "nowrap", "keep the label/value together when the reference wraps");
  assert.equal(textOf(instruction), "を基準に考えて", "an independent block forces the requested line break");
  assert.equal((panel.props.style as React.CSSProperties).overflowWrap, "anywhere");
  assert.doesNotMatch(textOf(condition), /undefined|NaN|中央値判定|[・]/);
  assert.doesNotMatch(JSON.stringify(panel.props.style), /nowrap|overflow.*hidden/);
}
function assertHookReference(value: AppFixture, expected?: AreaCountEvaluation) {
  assertReference(value, value.app.derived.basisGuide.referenceConditionLabel, expected);
}
function basis(finalEvaluation?: AreaCountEvaluation, baseEvaluation: AreaCountEvaluation = "normal"): AreaCountDecisionBasis {
  return { ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 3, requiredSampleSize: 3,
    baseEvaluation, finalEvaluation, areaRateAdjustment: 0 };
}
function history(cycle: DemandCycle, median = 20) {
  return ["2026-09-01", "2026-08-25", "2026-08-18"].map(date => ({ ...getCurrentDataVersionInfo(), date, demandCycle: cycle,
    sessionStartedAt: `${date}T17:00:00+09:00`, recordedAt: `${date}T17:00:00+09:00`, areaId: AREA,
    discountTime: "17", actualWeekday: "火", actualWeekdayGroup: "火木", count: median }));
}
let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run(); clean(); passed++; console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

for (const cycle of ["normal", "summer"] as const) for (const evaluation of Object.keys(labels) as AreaCountEvaluation[]) {
  await test(`SSR ${cycle}/${evaluation}: exact month/weekday/time plus final 5-level label and explicit second line`, () => {
    nowMs = at("17:10:00");
    const markup = renderToStaticMarkup(isolatedRate({ demandCycle: cycle, adoptedAreaEvaluation: evaluation }));
    assert.ok(markup.includes(`<div style="font-weight:800">11月 金曜日 17時\u3000<span style="white-space:nowrap">エリア判定：${labels[evaluation]}</span></div><div>を基準に考えて</div>`));
    assert.match(markup, /overflow-wrap:anywhere/);
    assert.doesNotMatch(markup, /unused alternate reference|11月の|11月・金曜日・17時/);
  });
  await test(`actual ${cycle}/${evaluation}: both product stages show the same adopted reference and preserve rate/action sequence`, async () => {
    nowMs = at("17:10:00"); let completions = 0;
    const props = { demandCycle: cycle, adoptedAreaEvaluation: evaluation, onNextArea: () => { completions++; } };
    const value = new AppFixture(() => isolatedRate(props));
    try {
      const before = persistence(); value.render(); assertReference(value, "11月・金曜日・17時", evaluation);
      assert.match(value.text(), /多い商品を30%値引きしてください。/);
      await value.click(); assert.equal(completions, 0); assertReference(value, "11月・金曜日・17時", evaluation);
      assert.match(value.text(), /どちらでもない商品を20%値引きしてください。/);
      await value.click(); assert.equal(completions, 1); assert.deepEqual(persistence(), before, "presentation creates no writes or records");
    } finally { value.close(); }
  });
}

await test("render derives text from current props after manual change, next area and revisit", async () => {
  nowMs = at("17:10:00"); let props: Partial<React.ComponentProps<typeof Rate>> = { adoptedAreaEvaluation: "many" };
  const value = new AppFixture(() => isolatedRate(props));
  try {
    value.render(); await value.click(); assertReference(value, "11月・金曜日・17時", "many");
    props = { adoptedAreaEvaluation: "slightly_many" }; value.render(); assertReference(value, "11月・金曜日・17時", "slightly_many");
    props = { areaName: "天ぷら", adoptedAreaEvaluation: "few" }; value.render(); assertReference(value, "11月・金曜日・17時", "few");
    props = { adoptedAreaEvaluation: "slightly_many" }; value.render(); assertReference(value, "11月・金曜日・17時", "slightly_many");
  } finally { value.close(); }
});

await test("resolved reference weekday groups, holidays and display time come directly from the supplied label", () => {
  nowMs = at("17:10:00");
  for (const label of ["11月・金曜日・土曜日・17時", "7月・日曜日・金曜日・土曜日・中間・17時", "11月・日曜日・18時", "金曜日・17時"]) {
    const value = new AppFixture(() => isolatedRate({ adoptedAreaEvaluation: "normal", weekdayText: "unused weekday", timeText: "unused time",
      basisGuide: { referenceText: "unused reference", referenceConditionLabel: label } }));
    try { value.render(); assertReference(value, label, "normal"); } finally { value.close(); }
  }
});

for (const entry of [
  { name: "explicit final outranks saved human and basis", adopted: "slightly_many", human: "many", final: "few", expected: "slightly_many" },
  { name: "explicit normal is not overridden by automatic many", adopted: "normal", human: "many", final: "many", expected: "normal" },
  { name: "saved human resolved value precedes basis", adopted: undefined, human: "slightly_few", final: "many", expected: "slightly_few" },
  { name: "saved basis final is the last adopted fallback", adopted: undefined, human: undefined, final: "few", expected: "few" },
  { name: "legacy without any saved final is 未記録", adopted: undefined, human: undefined, final: undefined, expected: undefined },
] as const) await test(`actual Router source priority: ${entry.name}`, () => {
  const value = fixture(adoptedState("normal", "normal", "17"), at("17:10:00"));
  try {
    const shadow = json(value.app.state), progress = shadow.areaProgressMap[AREA];
    progress.areaCountEvaluation = entry.adopted; progress.areaCountDecisionBasis = basis(entry.final, "many");
    progress.humanEvaluationDetails = entry.human ? getLegacyHumanEvaluationDetails(entry.human) : undefined;
    progress.areaJudge = "many"; progress.areaRateAdjustment = 10;
    const before = JSON.stringify(shadow), persisted = persistence();
    assert.equal(getAdoptedEvaluation(progress), entry.expected);
    const routed = new AppFixture(() => React.createElement(Router, { app: { ...value.app, state: shadow } }));
    try { routed.render(); assertReference(routed, value.app.derived.basisGuide.referenceConditionLabel, entry.expected); }
    finally { routed.close(); }
    assert.equal(JSON.stringify(shadow), before, "legacy/saved progress is never filled in or rewritten by rendering");
    assert.deepEqual(persistence(), persisted);
  } finally { value.close(); }
});

for (const marker of ["three-level judge", "automatic median", "basis base", "rate adjustment", "raw intermediate selection"] as const) {
  await test(`legacy ${marker} cannot be promoted into an adopted final label`, () => {
    const value = fixture(adoptedState(undefined, "normal", "17"), at("17:10:00"));
    try {
      const shadow = json(value.app.state), progress = shadow.areaProgressMap[AREA];
      progress.areaCountEvaluation = undefined; progress.humanEvaluationDetails = undefined; progress.areaCountDecisionBasis = undefined;
      if (marker === "three-level judge") progress.areaJudge = "many";
      if (marker === "automatic median") progress.humanEvaluationDetails = { ...getLegacyHumanEvaluationDetails("normal"), resolvedEvaluation: undefined, automaticEvaluation: "many" };
      if (marker === "basis base") progress.areaCountDecisionBasis = basis(undefined, "many");
      if (marker === "rate adjustment") progress.areaRateAdjustment = 10;
      if (marker === "raw intermediate selection") progress.humanEvaluationDetails = { ...getLegacyHumanEvaluationDetails("normal"),
        ...createHumanEvaluationSelection("normal", "slightly_many")!, humanEvaluationScale: 9, resolvedEvaluation: undefined };
      const before = JSON.stringify(shadow), persisted = persistence();
      const routed = new AppFixture(() => React.createElement(Router, { app: { ...value.app, state: shadow } }));
      try { routed.render(); assertReference(routed, value.app.derived.basisGuide.referenceConditionLabel, undefined); } finally { routed.close(); }
      assert.equal(JSON.stringify(shadow), before); assert.deepEqual(persistence(), persisted);
    } finally { value.close(); }
  });
}

for (const cycle of ["normal", "summer"] as const) for (const mode of ["automatic", "manual", "higher", "lower", "intermediate"] as const) {
  await test(`full hook ${cycle}/${mode}: displayed final follows actual saved business judgment`, async () => {
    const raw = adoptedState(undefined, cycle, "17"); raw.screen = "area_judge";
    const value = fixture(raw, at("17:10:00"), false, false, history(cycle));
    try {
      const initial = value.app.actions.getCurrentAreaCountRecommendation(20); assert.equal(initial.suggestedEvaluation, "normal");
      const selection = mode === "manual" ? createHumanEvaluationSelection("few") : mode === "intermediate" ? createHumanEvaluationSelection("normal", "slightly_many") : undefined;
      await value.app.actions.judgeCurrentArea("normal", 20, undefined, undefined, selection ?? undefined); value.render();
      if (mode === "higher" || mode === "lower") {
        await value.click(mode === "higher" ? "やや多いにする" : "やや少ないにする");
      }
      const expected = mode === "manual" ? "few" : mode === "higher" ? "slightly_many" : mode === "lower" ? "slightly_few" :
        mode === "intermediate" && cycle === "normal" ? "slightly_many" : "normal";
      assert.equal(value.app.state.areaProgressMap[AREA].areaCountEvaluation, expected); assertHookReference(value, expected);
      const saved = json(value.app.state), persisted = persistence(), rate = json(value.app.derived.rateDisplay);
      value.render(); assert.deepEqual(json(value.app.state), saved); assert.deepEqual(persistence(), persisted); assert.deepEqual(json(value.app.derived.rateDisplay), rate);
      await value.click(); assertHookReference(value, expected); assert.equal(value.app.state.screen, "rate_display");
      assert.match(value.text(), /どちらでもない商品を/); await value.click(); assert.equal(value.app.state.screen, "done");
      assert.equal(value.app.state.areaProgressMap[AREA].areaCountEvaluation, expected);
    } finally { value.close(); }
  });
}

await test("17 session at 18:00 uses hook's 18時 label and never re-resolves a saved summer intermediate", async () => {
  const raw = adoptedState("normal", "summer", "17");
  const selection = createHumanEvaluationSelection("normal", "slightly_many"); assert.ok(selection);
  const details = resolveHumanEvaluationForDiscount({ selection, demandCycle: "summer", sessionDiscountTime: "17", nowMs: at("17:10:00"), evaluatedAt: new NativeDate(at("17:10:00")).toISOString() });
  assert.equal(details.resolvedEvaluation, "normal"); raw.areaProgressMap[AREA].humanEvaluationDetails = details;
  const value = fixture(raw, cutoff("17") - 1);
  try {
    assertHookReference(value, "normal"); assert.match(value.app.derived.basisGuide.referenceConditionLabel, /17時$/);
    await value.click(); assertHookReference(value, "normal"); const saved = json(value.app.state), persisted = persistence();
    nowMs = cutoff("17"); value.app.actions.refreshRuntimeClock(); value.render();
    assert.equal(value.app.state.session?.discountTime, "17"); assert.match(value.app.derived.basisGuide.referenceConditionLabel, /18時$/);
    assertHookReference(value, "normal"); assert.deepEqual(json(value.app.state), saved); assert.deepEqual(persistence(), persisted);
    assert.equal(value.app.state.areaProgressMap[AREA].humanEvaluationDetails?.resolvedEvaluation, "normal");
  } finally { value.close(); }
});

await test("next area, saved-area revisit and reload read the current area's saved adopted value", async () => {
  const raw = adoptedState("slightly_many", "normal", "17", false);
  Object.assign(raw.areaProgressMap.tempura, { status: "unstarted", areaCount: 12, areaJudge: "normal", areaCountEvaluation: "slightly_few", areaRateAdjustment: -5 });
  const value = fixture(raw, at("17:10:00")); let recovered: AppState;
  try {
    assertHookReference(value, "slightly_many"); await value.click("今はスキップ（画面左スワイプ）");
    assert.equal(value.app.state.currentAreaId, "tempura");
    const atNext = json(value.app.state); atNext.screen = "rate_display"; value.replaceState(atNext); assertHookReference(value, "slightly_few");
    const revisit = json(value.app.state); revisit.currentAreaId = AREA; revisit.screen = "rate_display";
    value.replaceState(revisit); assertHookReference(value, "slightly_many"); recovered = json(value.app.state);
  } finally { value.close(); }
  const reloaded = fixture(recovered!, at("17:10:00"));
  try { assertHookReference(reloaded, "slightly_many"); } finally { reloaded.close(); }
});

console.log(`\nAdopted reference61 checks: ${passed}/${passed} PASS`);
