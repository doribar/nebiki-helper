import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { FULL_MODE_NOTICE_TEXTS } from "../src/domain/fullMode.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { getCalendarWeekday } from "../src/domain/japaneseHoliday.ts";
import { getIndividualAmountReferenceContext } from "../src/domain/weekdayBase.ts";
import { getAreaCountRecommendation } from "../src/domain/areaCountHistory.ts";
import type { AreaCountRecord } from "../src/domain/areaCountHistory.ts";
import { buildNormalRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { normalizeSessionDraft, createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { retireManualWeekdayOverride } from "../src/hooks/nebikiApp/operationalWeekday.ts";
import type { AppState, SessionDraft } from "../src/domain/types.ts";
// Run actual production TSX and event handlers with a deterministic scheduler.
// Native touch, layout, and browser persistence remain separate browser checks.
type Props = Record<string, unknown>;
type Component = (props: Props) => React.ReactNode;
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Instance = { type: Component; slots: Slot[]; cursor: number };
type Element = { type: string; props: Props; parent: Element | null; children: Array<Element | string> };
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const textOf = (node: Element | string): string => typeof node === "string" ? node : node.children.map(textOf).join("");

class ModuleLoader {
  private modules = new Map<string, Record<string, unknown>>();
  private react: object;
  private environment: Props;
  constructor(react: object, environment: Props = {}) {
    this.react = react;
    this.environment = environment;
  }
  async load(path: string | URL): Promise<Record<string, unknown>> {
    const url = typeof path === "string" ? new URL(`../${path}`, import.meta.url) : path;
    const cached = this.modules.get(url.href);
    if (cached) return cached;
    const raw = readFileSync(url, "utf8");
    const ast = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const dependencies = new Map<string, unknown>([["react", this.react], ["react/jsx-runtime", jsxRuntime]]);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
      const id = statement.moduleSpecifier.text;
      if (dependencies.has(id)) continue;
      assert.ok(id.startsWith("."), `expected local production dependency: ${id}`);
      const target = [id, `${id}.ts`, `${id}.tsx`].map((candidate) => new URL(candidate, url)).find((candidate) => existsSync(candidate));
      assert.ok(target, `actual dependency exists: ${id}`);
      const needsEnvironment = target.pathname.endsWith(".tsx") || /\/(useSwipeToSkip|calculatorDraft)\.ts$/.test(target.pathname);
      dependencies.set(id, needsEnvironment ? await this.load(target) : await import(target.href));
    }
    const exports: Record<string, unknown> = {};
    const output = ts.transpileModule(raw, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(output, {
      exports, ...this.environment,
      require: (id: string) => {
        assert.ok(dependencies.has(id), `actual dependency loaded: ${id}`);
        return dependencies.get(id);
      },
    });
    this.modules.set(url.href, exports);
    return exports;
  }
}

class Runtime {
  private active: Instance | null = null;
  private instances = new Map<string, Instance>();
  private effects: Array<() => void> = [];
  private root: (() => React.ReactNode) | null = null;
  private dirty = true;
  private timerId = 0;
  private timers = new Map<number, () => void>();
  private storage = new Map<string, string>();
  storageWrites = 0;
  nodes: Element[] = [];
  private slot(): Slot {
    assert.ok(this.active, "hooks run inside the production component");
    return this.active.slots[this.active.cursor++] ??= {};
  }
  private hooks = {
    useState: <T,>(initial: T | (() => T)): [T, (next: T | ((value: T) => T)) => void] => {
      const slot = this.slot();
      if (!Object.hasOwn(slot, "value")) slot.value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slot.value as T, (next) => {
        const value = typeof next === "function" ? (next as (previous: T) => T)(slot.value as T) : next;
        if (!Object.is(slot.value, value)) { slot.value = value; this.dirty = true; }
      }];
    },
    useRef: <T,>(initial: T): { current: T } => {
      const slot = this.slot();
      if (!Object.hasOwn(slot, "value")) slot.value = { current: initial };
      return slot.value as { current: T };
    },
    useMemo: <T,>(get: () => T, deps?: readonly unknown[]): T => {
      const slot = this.slot();
      if (!sameDeps(slot.deps, deps)) { slot.value = get(); slot.deps = deps; }
      return slot.value as T;
    },
    useCallback: <T,>(callback: T, deps?: readonly unknown[]): T => {
      const slot = this.slot();
      if (!sameDeps(slot.deps, deps)) { slot.value = callback; slot.deps = deps; }
      return slot.value as T;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const slot = this.slot();
      if (sameDeps(slot.deps, deps)) return;
      slot.deps = deps;
      this.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
    },
  };
  loader = new ModuleLoader(this.hooks, {
    window: {
      setTimeout: (run: () => void) => { const id = ++this.timerId; this.timers.set(id, run); return id; },
      clearTimeout: (id: number) => { this.timers.delete(id); },
      addEventListener: () => {}, removeEventListener: () => {},
      confirm: () => true, alert: () => {}, scrollTo: () => {},
      sessionStorage: {
        getItem: (key: string) => this.storage.get(key) ?? null,
        setItem: (key: string, value: string) => { this.storage.set(key, value); this.storageWrites += 1; },
        removeItem: (key: string) => { this.storage.delete(key); this.storageWrites += 1; },
      },
    },
    document: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
    navigator: { vibrate: () => {} },
  });
  mount(component: Component, props: Props) { this.root = () => React.createElement(component, props); this.dirty = true; this.flush(); }
  flush() {
    assert.ok(this.root);
    let renders = 0;
    while (this.dirty) {
      assert.ok(++renders < 30, "state/effect rerenders converge");
      this.dirty = false;
      this.nodes = [];
      const visited = new Set<string>();
      const expand = (node: React.ReactNode, path: string, parent: Element | null): Array<Element | string> => {
        if (node === null || node === undefined || typeof node === "boolean") return [];
        if (typeof node === "string" || typeof node === "number") return [String(node)];
        if (Array.isArray(node)) return node.flatMap((child, index) => expand(child, `${path}/${index}`, parent));
        assert.ok(React.isValidElement<Props>(node));
        if (node.type === React.Fragment) return expand(node.props.children as React.ReactNode, `${path}/fragment`, parent);
        if (typeof node.type === "function") {
          const type = node.type as Component;
          const key = `${path}:${node.key ?? ""}`;
          let instance = this.instances.get(key);
          if (!instance || instance.type !== type) {
            instance?.slots.forEach((slot) => slot.cleanup?.());
            instance = { type, slots: [], cursor: 0 };
            this.instances.set(key, instance);
          }
          visited.add(key);
          instance.cursor = 0;
          const previous = this.active;
          this.active = instance;
          const result = type(node.props);
          this.active = previous;
          return expand(result, `${path}/render`, parent);
        }
        assert.equal(typeof node.type, "string");
        const element: Element = { type: node.type as string, props: node.props, parent, children: [] };
        this.nodes.push(element);
        element.children = expand(node.props.children as React.ReactNode, `${path}/children`, element);
        return [element];
      };
      expand(this.root(), "root", null);
      for (const [key, instance] of this.instances) {
        if (visited.has(key)) continue;
        instance.slots.forEach((slot) => slot.cleanup?.());
        this.instances.delete(key);
      }
      const effects = this.effects;
      this.effects = [];
      effects.forEach((effect) => effect());
    }
  }
  find(predicate: (node: Element) => boolean): Element {
    const element = this.nodes.find(predicate);
    assert.ok(element, "actual rendered control exists");
    return element;
  }
  buttons(text: string) { return this.nodes.filter((node) => node.type === "button" && textOf(node) === text); }
  button(text: string) { assert.equal(this.buttons(text).length, 1, `one ${text} control`); return this.buttons(text)[0]; }
  dialog() { return this.find((node) => node.props.role === "dialog"); }
  hasDialog() { return this.nodes.some((node) => node.props.role === "dialog"); }
  dispatch(target: Element, name: string, fields: Props = {}) {
    if (target.props.disabled) return;
    let stopped = false;
    const event = {
      detail: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { stopped = true; }, ...fields,
    };
    const ancestors: Element[] = [];
    for (let node: Element | null = target; node; node = node.parent) ancestors.push(node);
    const invoke = (node: Element, key: string) => {
      if (!stopped && typeof node.props[key] === "function") (node.props[key] as (event: Props) => void)(event);
    };
    [...ancestors].reverse().forEach((node) => invoke(node, `on${name}Capture`));
    ancestors.forEach((node) => invoke(node, `on${name}`));
    this.dirty = true;
    this.flush();
  }
  click(target: Element) { this.dispatch(target, "Click"); }
  swipe(target: Element) {
    this.dispatch(target, "TouchStart", { touches: [{ identifier: 1, clientX: 200, clientY: 50 }] });
    this.dispatch(target, "TouchEnd", { changedTouches: [{ identifier: 1, clientX: 30, clientY: 50 }] });
  }
}


process.env.TZ = "Asia/Tokyo";
const noop = () => {};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const at = (date: string, time = "17:05:00") => new Date(`${date}T${time}+09:00`);
function draft(date = "2026-10-01", weekday = 4): SessionDraft {
  return {
    date, weekday, discountTime: "17", demandCycle: "normal",
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
}
function active(date = "2026-10-01", weekday = 2): AppState {
  const saved = createInitialState({ ...draft(date, weekday), manualWeekdayOverride: true });
  saved.session = { ...clone(saved.sessionDraft), startedAt: at(date, "17:00:00").toISOString() };
  saved.screen = "rate_display"; saved.currentAreaId = "bento_men";
  Object.assign(saved.areaProgressMap.bento_men, {
    areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal",
    areaCountEvaluationSource: "manual", areaRateAdjustment: 0,
    humanEvaluationDetails: {
      humanEvaluationScore9: 4, humanEvaluationScale: 9,
      humanEvaluationSelections: ["slightly_few", "normal"],
      resolvedEvaluation: "normal", resolutionDirection: "higher", demandCycle: "normal", sessionDiscountTime: "17",
      resolutionReason: "normal_17_or_later", evaluatedAt: at(date).toISOString(),
    },
  });
  return saved;
}
function below(runtime: Runtime, parent: Element) {
  return runtime.nodes.filter(node => {
    for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parent) if (ancestor === parent) return true;
    return false;
  });
}
let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run(); passed++; console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

await test("Start displays weekday and time only for normal/fixed mode and old true/false flags", async () => {
  for (const isFixedTimeMode of [false, true]) for (const legacyManualFlag of [false, true]) {
    const runtime = new Runtime();
    const patches: Partial<SessionDraft>[] = [];
    const adjustments: number[] = [];
    const Start = (await runtime.loader.load("src/components/screens/StartScreen.tsx")).StartScreen as Component;
    runtime.mount(Start, {
      sessionDraft: { ...draft(), manualWeekdayOverride: legacyManualFlag }, previousSession: null, isFixedTimeMode,
      weatherGuideText: { nearTermWeatherGuide: "", laterPrecipGuide: "", laterPrecipTypeGuide: "", windGuide: "", tempGuide: "" },
      showAfterRainRecoverySelector: false, weatherConfirmationPending: false, weatherCorrectionRequestId: 0,
      onChangeSessionDraft: (patch: Partial<SessionDraft>) => patches.push(patch), onRequestWeatherConfirmation: noop,
      onEditWeatherInput: noop, onStart: noop, demandCycle: "normal", summerModeAvailable: false,
      canChangeDemandCycle: true, onChangeDemandCycle: () => true, now: at("2026-10-01"),
      onChangeGlobalDiscountAdjustment: (adjustment: number) => adjustments.push(adjustment),
    });
    const row = runtime.find(node => node.props.role === "group" && node.props["aria-label"] === "曜日と時刻");
    const rowStyle = row.props.style as React.CSSProperties;
    assert.equal(rowStyle.display, "grid");
    assert.equal(rowStyle.gridTemplateColumns, "repeat(2, minmax(0, 1fr))", "weekday and time have equal columns");
    const columns = row.children.filter((node): node is Element => typeof node !== "string");
    assert.deepEqual(Array.from(columns, node => Array.from(node.children, textOf)), [["曜日", "木曜日"], ["時刻", "17時"]], "labels are above values, weekday on the left");
    assert.ok(columns.every(node => (node.props.style as React.CSSProperties).minWidth === 0));
    const adjustmentSection = runtime.find(node => node.type === "section" && node.props["aria-label"] === "全体値引補正");
    const weatherLabel = runtime.find(node => textOf(node) === "天候");
    assert.ok(row.parent);
    assert.equal(row.parent, adjustmentSection.parent);
    assert.equal(row.parent, weatherLabel.parent);
    const rowIndex = row.parent.children.indexOf(row);
    assert.equal(row.parent.children.indexOf(adjustmentSection), rowIndex - 1);
    assert.equal(row.parent.children.indexOf(weatherLabel), rowIndex + 1);
    for (const [label, display] of [["曜日", "木曜日"], ["時刻", "17時"]]) {
      const parent = runtime.find(node => textOf(node) === label).parent;
      assert.ok(parent);
      assert.ok(textOf(parent).includes(display), display);
      assert.equal(below(runtime, parent).filter(node => node.type === "select" || node.type === "button" || typeof node.props.onWheel === "function").length, 0);
      runtime.dispatch(parent, "Wheel", { deltaY: 100 });
      runtime.dispatch(parent, "Wheel", { deltaY: -100 });
    }
    assert.equal(runtime.buttons("手動で切り替える").length, 0);
    assert.equal(runtime.buttons("自動に戻す").length, 0);
    assert.deepEqual(patches, [], "wheel events cannot change the operational draft");
    for (const label of ["-5%", "なし", "+5%"]) runtime.click(runtime.button(label));
    assert.deepEqual(adjustments, [-5, 0, 5], "global adjustment buttons retain their callbacks");
    runtime.click(runtime.find(node => node.type === "button" && textOf(node) === "+1" && !node.props.disabled));
    const expectedWeather = clone(draft().weather);
    expectedWeather.hourlyForecasts["18"].weather = "rain";
    expectedWeather.hourlyForecasts["19"].weather = "rain";
    assert.deepEqual(clone(patches), [{ weatherInputLockedDiscountTime: "17", weather: expectedWeather }], "weather change preserves its lock and next-hour copy");
    assert.equal(runtime.storageWrites, 0, "display and weather change introduce no storage writes");
  }
});

await test("the two-column Start retains all seven weekday and five automatic time labels", async () => {
  const runtime = new Runtime();
  const Start = (await runtime.loader.load("src/components/screens/StartScreen.tsx")).StartScreen as Component;
  for (const [weekday, weekdayLabel] of ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"].entries()) {
    for (const [discountTime, timeLabel] of [["15", "15時"], ["17", "17時"], ["18", "18時30分"], ["19", "19時30分"], ["20", "20時30分"]] as const) {
      runtime.mount(Start, {
        sessionDraft: { ...draft(`2026-10-${String(4 + weekday).padStart(2, "0")}`, weekday), discountTime }, previousSession: null, isFixedTimeMode: false,
        weatherGuideText: { nearTermWeatherGuide: "", laterPrecipGuide: "", laterPrecipTypeGuide: "", windGuide: "", tempGuide: "" },
        showAfterRainRecoverySelector: false, weatherConfirmationPending: false, weatherCorrectionRequestId: 0,
        onChangeSessionDraft: noop, onRequestWeatherConfirmation: noop, onEditWeatherInput: noop, onStart: noop,
        demandCycle: "normal", summerModeAvailable: false, canChangeDemandCycle: true, onChangeDemandCycle: () => true,
      });
      const row = runtime.find(node => node.props.role === "group" && node.props["aria-label"] === "曜日と時刻");
      assert.deepEqual(Array.from(row.children, textOf), [`曜日${weekdayLabel}`, `時刻${timeLabel}`]);
    }
  }
});

await test("production Start has no picker constants, manual-entry callbacks or wheel handlers", () => {
  assert.doesNotMatch(source("src/components/screens/StartScreen.tsx"), /WEEKDAY_OPTIONS|handleWeekdayWheel|manualWeekdayOverride|手動で切り替える|自動に戻す|onWheel/);
  assert.doesNotMatch(source("src/app/AppRouter.tsx"), /manualWeekdayOverride:\s*true|onChangeWeekday|onSelectWeekday/);
});

await test("natural weekday comes from the validated business date in every host timezone", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["Asia/Tokyo", "UTC", "America/Los_Angeles"]) {
      process.env.TZ = zone;
      assert.equal(getCalendarWeekday("2026-10-01"), 4);
      assert.equal(getCalendarWeekday("2026-09-08"), 2);
      assert.equal(getCalendarWeekday("2026-11-03"), 2);
      assert.equal(getCalendarWeekday("2026-02-30"), null);
      assert.equal(getCalendarWeekday("invalid"), null);
    }
  } finally { process.env.TZ = original; }
});

await test("an unstarted manual draft returns to its current natural day without changing weather", () => {
  const saved = createInitialState({ ...draft("2026-10-01", 0), manualWeekdayOverride: true, weatherInputLockedDiscountTime: "17" });
  const before = JSON.stringify(saved);
  const restored = retireManualWeekdayOverride(saved, { now: at("2026-10-01") });
  assert.equal(restored.sessionDraft.date, "2026-10-01");
  assert.equal(restored.sessionDraft.weekday, 4);
  assert.equal(restored.sessionDraft.manualWeekdayOverride, false);
  assert.equal(restored.sessionDraft.weather, saved.sessionDraft.weather);
  assert.equal(restored.sessionDraft.weatherInputLockedDiscountTime, "17");
  assert.equal(JSON.stringify(saved), before);
  assert.equal(retireManualWeekdayOverride(restored, { now: at("2026-10-01") }), restored, "retirement is idempotent");
});

await test("an in-progress session keeps its old business date and uses that date's natural weekday", () => {
  const saved = active("2026-09-08", 4);
  const before = JSON.stringify(saved);
  const restored = retireManualWeekdayOverride(saved, { now: at("2026-10-01") });
  assert.equal(restored.session?.date, "2026-09-08");
  assert.equal(restored.sessionDraft.date, "2026-09-08");
  assert.equal(restored.session?.weekday, 2);
  assert.equal(restored.sessionDraft.weekday, 2);
  assert.equal(restored.session?.manualWeekdayOverride, false);
  assert.equal(restored.sessionDraft.manualWeekdayOverride, false);
  assert.equal(restored.session?.startedAt, saved.session?.startedAt);
  assert.equal(restored.session?.discountTime, saved.session?.discountTime);
  assert.equal(restored.areaProgressMap, saved.areaProgressMap, "counts, confirmed evaluation and completed data keep the same object");
  assert.equal(JSON.stringify(saved), before);
});

await test("a legacy draft-only manual flag attached to an active session is retired consistently", () => {
  const saved = active();
  saved.session!.weekday = 4; saved.session!.manualWeekdayOverride = false;
  const restored = retireManualWeekdayOverride(saved, { now: at("2026-10-01") });
  assert.equal(restored.session?.weekday, 4);
  assert.equal(restored.sessionDraft.weekday, 4);
  assert.equal(restored.sessionDraft.manualWeekdayOverride, false);
  assert.equal(restored.areaProgressMap, saved.areaProgressMap);
});

await test("generic legacy normalization retains old manual flags for historical consumers", () => {
  const saved = active();
  const normalized = normalizeLoadedState(saved, draft());
  assert.equal(normalizeSessionDraft(saved.sessionDraft).manualWeekdayOverride, true);
  assert.equal(normalized.session?.manualWeekdayOverride, true);
  assert.equal(normalized.session?.weekday, 2);
  assert.equal(saved.session?.manualWeekdayOverride, true);
});

await test("completed and Review19 states preserve legacy session metadata until a work re-entry", () => {
  for (const screen of ["done", "review19_weather", "review19", "review19_done"] as const) {
    const saved = active(); saved.screen = screen;
    const before = JSON.stringify(saved);
    const restored = retireManualWeekdayOverride(saved, { now: at("2026-10-02") });
    assert.equal(JSON.stringify(restored), before, screen);
    assert.equal(JSON.stringify(saved), before);
  }
});

await test("fixed clock leaves supplied legacy metadata untouched at the retirement boundary", () => {
  const saved = active();
  assert.equal(retireManualWeekdayOverride(saved, { now: at("2026-10-01"), fixedTime: true }), saved);
});

await test("natural weekday and holiday/Obon calculation reference remain separate", () => {
  for (const [date, natural, kind, reference] of [
    ["2026-10-01", 4, "actual_weekday", 4],
    ["2026-11-03", 2, "holiday", 0],
    ["2026-11-02", 1, "day_before_holiday", null],
    ["2026-10-11", 0, "three_day_holiday_middle", 0],
    ["2026-05-04", 1, "long_holiday_middle", null],
    ["2026-08-13", 4, "obon", 0],
  ] as const) {
    const saved = active(date, 6);
    const restored = retireManualWeekdayOverride(saved, { now: at(date) });
    assert.equal(restored.session?.weekday, natural);
    const context = getIndividualAmountReferenceContext({ date, weekday: natural, discountTime: "17" });
    assert.equal(context.kind, kind, date);
    assert.equal(context.referenceWeekday, reference, date);
    const recommendation = getAreaCountRecommendation({ records: [], areaId: "bento_men", discountTime: "17", weekday: natural, date, count: 20, demandCycle: "normal" });
    assert.equal(recommendation.actualWeekday, ["日", "月", "火", "水", "木", "金", "土"][natural], date);
  }
});

await test("the 44 seven lower notices and their bold emphasis remain available", async () => {
  const loader = new ModuleLoader(React);
  const Rate = (await loader.load("src/components/screens/RateDisplayScreen.tsx")).RateDisplayScreen as Component;
  const markup = renderToStaticMarkup(React.createElement(Rate, {
    weekdayText: "木曜日", timeText: "17時", areaName: "弁当・麺", discountTime: "17", demandCycle: "normal",
    basisGuide: { referenceText: "10月・木曜日・17時を基準に考えて", referenceConditionLabel: "10月・木曜日・17時" },
    rateDisplay: { many: { main: "30%" }, normal: { main: "20%" }, few: { main: "引かない" } },
    onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop,
  }));
  const rows = [...markup.matchAll(/<div>・([\s\S]*?)<\/div>/g)].map(match => match[1]);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map(row => row.replace(/<[^>]*>/g, "")), FULL_MODE_NOTICE_TEXTS);
  assert.deepEqual([...rows[4].matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]), ["やや不人気な商品", "10個以上", "+10%", "大パックのみ+10%"]);
  assert.ok(markup.includes("多い商品を30%"));
});

await test("new median judgments follow automatic weekday while previously saved observations remain unchanged", () => {
  const records: AreaCountRecord[] = [
    ...["2026-09-07", "2026-09-14", "2026-09-28"].map(date => ({ date, sessionStartedAt: `${date}T08:00:00.000Z`, recordedAt: `${date}T08:05:00.000Z`,
      areaId: "bento_men" as const, discountTime: "17" as const, actualWeekday: "月" as const, actualWeekdayGroup: "月水" as const, count: 100, demandCycle: "normal" as const })),
    ...["2026-09-10", "2026-09-17", "2026-09-24"].map(date => ({ date, sessionStartedAt: `${date}T08:00:00.000Z`, recordedAt: `${date}T08:05:00.000Z`,
      areaId: "bento_men" as const, discountTime: "17" as const, actualWeekday: "木" as const, actualWeekdayGroup: "火木日" as const, count: 10, demandCycle: "normal" as const })),
  ];
  const before = JSON.stringify(records);
  const saved = active("2026-10-01", 1);
  const restored = retireManualWeekdayOverride(saved, { now: at("2026-10-01") });
  const results = [saved.session!.weekday, restored.session!.weekday].map(weekday => getAreaCountRecommendation({
    records, areaId: "bento_men", discountTime: "17", weekday, date: "2026-10-01", count: 40, demandCycle: "normal",
  }));
  assert.deepEqual(results.map(result => [result.medianCount, result.suggestedEvaluation, result.areaRateAdjustment]), [[100, "few", -10], [10, "many", 10]]);
  const rateResults = results.map(result => buildNormalRateDecisionSnapshot({
    confirmedAt: at("2026-10-01").toISOString(), sessionDiscountTime: "17", weatherComfortAdjustmentPercent: 0,
    areaJudge: "normal", areaRateAdjustment: result.areaRateAdjustment,
    resolvedWeather: { nearTermWeather: "other", hasLaterPrecip: false, laterPrecipType: null,
      precipitationRateBonus: 0, precipitationRateBonusLabel: null, windLevel: "2orLess", tempLevel: "21to25",
      weatherPointScore: 0, weatherPointShift: 0, weatherPointRangeText: null,
      next18TempDropShift: 0, next18WindWorsenShift: 0, next18WindWorsenKind: null, afterRainSky: null },
  }));
  assert.deepEqual(rateResults.map(result => [result.normalRatePercent, result.manyRatePercent]), [[0, 10], [20, 30]]);
  assert.equal(JSON.stringify(records), before);
  assert.equal(restored.areaProgressMap.bento_men.areaCountEvaluation, "normal", "already adopted manual judgment is not replaced by the new median");
});

console.log(`automatic-weekday operation checks passed: ${passed}/${passed}`);


