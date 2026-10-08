import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { FULL_MODE_NOTICE_TEXTS } from "../src/domain/fullMode.ts";
import type { AreaCountRecommendation } from "../src/domain/areaCountHistory.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { retireManualDiscountTimeOverride } from "../src/hooks/nebikiApp/operationalTime.ts";
import { resolveDiscountTime, setRuntimeNowOverride } from "../src/hooks/nebikiApp/clock.ts";
import type { DemandCycle, DiscountTime, SessionDraft } from "../src/domain/types.ts";

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
const at = (hour: number, minute = 0, second = 0) => new Date(`2026-09-08T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+09:00`);
function draft(time: DiscountTime = "17", cycle: DemandCycle = "normal"): SessionDraft {
  return {
    date: "2026-09-08", weekday: 2, discountTime: time, demandCycle: cycle,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
}
const rateProps = {
  weekdayText: "火曜日", timeText: "17時", areaName: "弁当・麺", discountTime: "17", demandCycle: "normal",
  basisGuide: { referenceText: "9月・火曜日・17時を基準に考えて", referenceConditionLabel: "9月・火曜日・17時" },
  rateDisplay: { many: { main: "30%" }, normal: { main: "20%" }, few: { main: "引かない" } },
  onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop,
};
async function screen(runtime: Runtime, name: string) {
  return (await runtime.loader.load(`src/components/screens/${name}Screen.tsx`))[`${name}Screen`] as Component;
}
let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run(); passed++; console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

await test("daily notice props, action, derived state and swipe-disable dependency are retired", () => {
  for (const path of ["src/hooks/useNebikiApp.ts", "src/domain/types.ts", "src/app/AppRouter.tsx", "src/components/screens/RateDisplayScreen.tsx"])
    assert.doesNotMatch(source(path), /showDailyNotice(?:BeforeRate)?|confirmDailyNotice|onConfirmDailyNotice/);
  assert.doesNotMatch(source("src/components/screens/RateDisplayScreen.tsx"), /enabled:\s*false/);
});

await test("first instruction begins with many products and advances exactly once per stage", async () => {
  for (const demandCycle of ["normal", "summer"] as const) {
    let next = 0;
    const runtime = new Runtime();
    runtime.mount(await screen(runtime, "RateDisplay"), { ...rateProps, demandCycle, onNextArea: () => next++ });
    assert.ok(runtime.nodes.some(node => textOf(node).includes("多い商品を30%")));
    assert.equal(runtime.buttons("OK").length, 0);
    runtime.click(runtime.button("終わった"));
    assert.equal(next, 0);
    assert.ok(runtime.nodes.some(node => textOf(node).includes("どちらでもない商品を20%")));
    runtime.click(runtime.button("終わった"));
    assert.equal(next, 1);
  }
});

await test("lower notices retain exact seven rows, order and slightly-unpopular emphasis", async () => {
  const expected = [
    "残り2個の商品は「多い」にしない",
    "残り1個の商品は「少ない」にする",
    "定番商品・夜によく売れる商品・広告商品は、表示値引率から-10%",
    "見た目が悪い個別商品・不人気な商品は、表示値引率に+10%",
    "やや不人気な商品は、10個以上ある場合のみ表示値引率に+10%。大パックと小パックに分かれている場合は大パックのみ+10%",
    "同一商品が、小パックを含めずに20個以上ある場合は、表示値引率に＋10％。",
    "多い・少ないの判断は、残り数だけでなく商品の減り方も含める",
  ];
  assert.deepEqual(FULL_MODE_NOTICE_TEXTS, expected);
  const loader = new ModuleLoader(React);
  const Rate = (await loader.load("src/components/screens/RateDisplayScreen.tsx")).RateDisplayScreen as Component;
  const markup = renderToStaticMarkup(React.createElement(Rate, rateProps));
  const rows = [...markup.matchAll(/<div>・([\s\S]*?)<\/div>/g)].map(match => match[1]);
  assert.deepEqual(rows.map(row => row.replace(/<[^>]*>/g, "")), expected);
  assert.deepEqual([...rows[4].matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]), ["やや不人気な商品", "10個以上", "+10%", "大パックのみ+10%"]);
  assert.ok(markup.indexOf("多い商品を") < markup.indexOf("注意事項"));
});

await test("rate screen swipe works immediately and cancelled touch cannot skip", async () => {
  let skipped = 0;
  const runtime = new Runtime();
  runtime.mount(await screen(runtime, "RateDisplay"), { ...rateProps, onSkip: () => skipped++ });
  const main = () => runtime.find(node => node.type === "main");
  runtime.dispatch(main(), "TouchStart", { touches: [{ identifier: 1, clientX: 200, clientY: 50 }] });
  runtime.dispatch(main(), "TouchCancel");
  runtime.dispatch(main(), "TouchEnd", { changedTouches: [{ identifier: 1, clientX: 30, clientY: 50 }] });
  assert.equal(skipped, 0);
  runtime.swipe(main());
  assert.equal(skipped, 1);
});

await test("ready-history and manual count input both proceed directly to the first rate instruction", async () => {
  for (const status of ["ready", "insufficient"] as const) {
    const runtime = new Runtime();
    const Judge = await screen(runtime, "AreaJudge");
    const Rate = await screen(runtime, "RateDisplay");
    let currentScreen = "judge";
    let confirmedCount: number | null = null;
    const recommendation = (count: number): AreaCountRecommendation => ({
      status, demandCycle: "normal", count, sampleSize: status === "ready" ? 3 : 0, requiredSampleSize: 3, matchedRecords: [],
      summaryText: status === "ready" ? "普通" : "履歴不足", detailLines: [],
      ...(status === "ready" ? { baseEvaluation: "normal", suggestedEvaluation: "normal", areaRateAdjustment: 0 } : {}),
    });
    runtime.mount(() => currentScreen === "judge"
      ? React.createElement(Judge, {
          ...rateProps, areaId: "bento_men", calculatorDraftScope: `automatic44-${status}`,
          areaCountAssistEnabled: true, getAreaCountRecommendation: recommendation,
          onJudge: (_judge: unknown, count: number | null) => { confirmedCount = count; currentScreen = "rate"; },
        })
      : React.createElement(Rate, { ...rateProps, areaCount: confirmedCount }), {});
    runtime.click(runtime.button("2")); runtime.click(runtime.button("0")); runtime.click(runtime.button("完了"));
    if (status === "insufficient") {
      assert.equal(currentScreen, "judge");
      runtime.click(runtime.find(node => node.props["data-evaluation"] === "normal"));
    }
    assert.equal(confirmedCount, 20);
    assert.equal(currentScreen, "rate");
    assert.ok(runtime.nodes.some(node => textOf(node).includes("多い商品を30%")));
    assert.equal(runtime.buttons("OK").length, 0);
  }
});

await test("normal and fixed-time Start show time without a manual select, toggle or wheel handler", async () => {
  for (const isFixedTimeMode of [false, true]) {
    for (const legacyManualFlag of [false, true]) {
      const runtime = new Runtime();
      const patches: Partial<SessionDraft>[] = [];
      const props = {
        sessionDraft: { ...draft(), manualDiscountTimeOverride: legacyManualFlag }, previousSession: null, isFixedTimeMode,
        weatherGuideText: { nearTermWeatherGuide: "", laterPrecipGuide: "", laterPrecipTypeGuide: "", windGuide: "", tempGuide: "" },
        showAfterRainRecoverySelector: false, weatherConfirmationPending: false, weatherCorrectionRequestId: 0,
        onChangeSessionDraft: (patch: Partial<SessionDraft>) => patches.push(patch), onRequestWeatherConfirmation: noop,
        onEditWeatherInput: noop, onStart: noop, demandCycle: "normal", summerModeAvailable: true,
        canChangeDemandCycle: true, onChangeDemandCycle: () => true, now: at(17),
      };
      runtime.mount(await screen(runtime, "Start"), props);
      const timeLabel = runtime.find(node => textOf(node) === "時刻");
      const timeSection = timeLabel.parent;
      assert.ok(timeSection);
      const sectionNodes = runtime.nodes.filter(node => {
        for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parent) if (ancestor === timeSection) return true;
        return false;
      });
      assert.ok(textOf(timeSection).includes("17時"));
      assert.equal(sectionNodes.filter(node => node.type === "select" || node.type === "button" || typeof node.props.onWheel === "function").length, 0);
      runtime.dispatch(timeSection, "Wheel", { deltaY: 100 });
      assert.equal(patches.length, 0);
      assert.equal(runtime.buttons("手動で切り替える").length, 0, "weekday picker was also retired in 45");
      assert.equal(runtime.buttons("自動に戻す").length, 0);
    }
  }
});

await test("the first weather input retains its draft time without reintroducing a manual override", async () => {
  const runtime = new Runtime();
  const patches: Partial<SessionDraft>[] = [];
  runtime.mount(await screen(runtime, "Start"), {
    sessionDraft: draft(), previousSession: null, isFixedTimeMode: false,
    weatherGuideText: { nearTermWeatherGuide: "", laterPrecipGuide: "", laterPrecipTypeGuide: "", windGuide: "", tempGuide: "" },
    showAfterRainRecoverySelector: false, weatherConfirmationPending: false, weatherCorrectionRequestId: 0,
    onChangeSessionDraft: (patch: Partial<SessionDraft>) => patches.push(patch), onRequestWeatherConfirmation: noop,
    onEditWeatherInput: noop, onStart: noop, demandCycle: "normal", summerModeAvailable: true,
    canChangeDemandCycle: true, onChangeDemandCycle: () => true, now: at(18, 25),
  });
  const weatherButton = runtime.nodes.find(node => node.type === "button" && textOf(node).includes("晴") && !node.props.disabled);
  assert.ok(weatherButton, "actual first weather control exists");
  runtime.click(weatherButton);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].weatherInputLockedDiscountTime, "17");
  assert.equal(patches[0].manualDiscountTimeOverride, undefined);
});

await test("legacy draft reload returns to automatic time without modifying its saved input", () => {
  setRuntimeNowOverride(at(18, 25));
  try {
    const saved = createInitialState({ ...draft("15"), manualDiscountTimeOverride: true });
    const before = JSON.stringify(saved);
    const normalized = retireManualDiscountTimeOverride(normalizeLoadedState(saved, draft("18")), { now: at(18, 25) });
    assert.equal(normalized.session, null);
    assert.equal(normalized.sessionDraft.manualDiscountTimeOverride, false);
    assert.equal(normalized.sessionDraft.discountTime, resolveDiscountTime(at(18, 25)));
    assert.equal(normalized.sessionDraft.weatherInputLockedDiscountTime, null);
    assert.equal(JSON.stringify(saved), before);
  } finally { setRuntimeNowOverride(null); }
});

await test("active legacy session keeps its original time and adopted evaluation while retiring both manual flags", () => {
  setRuntimeNowOverride(at(18, 1));
  try {
    const saved = createInitialState(draft("17", "summer"));
    saved.session = { ...clone(saved.sessionDraft), manualDiscountTimeOverride: true, startedAt: at(17).toISOString() };
    saved.sessionDraft.manualDiscountTimeOverride = true;
    saved.screen = "rate_display"; saved.currentAreaId = "bento_men";
    saved.areaProgressMap.bento_men = { ...saved.areaProgressMap.bento_men, areaJudge: "normal", areaCount: 20,
      areaCountEvaluation: "normal", areaCountEvaluationSource: "manual", areaRateAdjustment: 0 };
    const before = JSON.stringify(saved);
    const legacyNormalized = normalizeLoadedState(saved, draft("17", "summer"));
    assert.equal(legacyNormalized.session?.manualDiscountTimeOverride, true, "generic normalization preserves historical fields");
    const normalized = retireManualDiscountTimeOverride(legacyNormalized, { now: at(18, 1) });
    assert.equal(normalized.screen, "rate_display");
    assert.equal(normalized.session?.manualDiscountTimeOverride, false);
    assert.equal(normalized.sessionDraft.manualDiscountTimeOverride, false);
    assert.equal(normalized.session?.discountTime, "17");
    assert.equal(normalized.session?.startedAt, saved.session.startedAt);
    assert.equal(normalized.areaProgressMap, legacyNormalized.areaProgressMap, "retirement does not rebuild or re-resolve adopted progress");
    assert.equal(normalized.areaProgressMap.bento_men.areaCountEvaluation, "normal");
    assert.equal(normalized.areaProgressMap.bento_men.areaRateAdjustment, 0);
    assert.equal(JSON.stringify(saved), before);
    assert.deepEqual(retireManualDiscountTimeOverride(normalized, { now: at(18, 1) }), normalized, "reload retirement is idempotent");
  } finally { setRuntimeNowOverride(null); }
});

await test("operational retirement keeps a legitimate weather hold and weekday override", () => {
  const saved = createInitialState({ ...draft("17"), manualWeekdayOverride: true, weekday: 4, weatherInputLockedDiscountTime: "17" });
  const before = JSON.stringify(saved);
  const restored = retireManualDiscountTimeOverride(saved, { now: at(18, 25) });
  assert.equal(restored.sessionDraft.discountTime, "17");
  assert.equal(restored.sessionDraft.weatherInputLockedDiscountTime, "17");
  assert.equal(restored.sessionDraft.weekday, 4);
  assert.equal(restored.sessionDraft.manualWeekdayOverride, true);
  assert.equal(JSON.stringify(saved), before);
});

await test("legacy true-flag draft uses an existing weather lock without inventing one", () => {
  for (const lock of [null, "17"] as const) {
    const saved = createInitialState({ ...draft("15"), manualDiscountTimeOverride: true, weatherInputLockedDiscountTime: lock });
    const before = JSON.stringify(saved);
    const restored = retireManualDiscountTimeOverride(saved, { now: at(18, 25) });
    assert.equal(restored.sessionDraft.manualDiscountTimeOverride, false);
    assert.equal(restored.sessionDraft.discountTime, lock ?? "18");
    assert.equal(restored.sessionDraft.weatherInputLockedDiscountTime, lock);
    assert.equal(JSON.stringify(saved), before);
  }
});

await test("completed and Review19 states preserve saved legacy identity and snapshot bytes", () => {
  for (const screen of ["done", "review19_weather", "review19", "review19_done"] as const) {
    const saved = createInitialState({ ...draft("18"), manualDiscountTimeOverride: true });
    saved.session = { ...clone(saved.sessionDraft), startedAt: at(18, 30).toISOString() };
    saved.screen = screen;
    const before = JSON.stringify(saved);
    const restored = retireManualDiscountTimeOverride(saved, { now: at(19, 30) });
    assert.equal(JSON.stringify(restored), before, screen);
    assert.equal(JSON.stringify(saved), before, "source is not rewritten");
  }
});

await test("saved resolution text describes the confirmed adoption instead of re-resolving at current time", async () => {
  const loader = new ModuleLoader(React);
  const Rate = (await loader.load("src/components/screens/RateDisplayScreen.tsx")).RateDisplayScreen as Component;
  const markup = renderToStaticMarkup(React.createElement(Rate, { ...rateProps,
    humanEvaluationDetails: {
      humanEvaluationScore9: 6, humanEvaluationScale: 9,
      humanEvaluationSelections: ["normal", "slightly_many"],
      resolvedEvaluation: "normal", resolutionDirection: "lower", resolutionReason: "summer_before_1800",
    },
  }));
  assert.doesNotMatch(markup, /この時間帯は/);
  assert.ok(markup.includes("判定確定時に"));
  assert.match(markup.replace(/<[^>]*>/g, ""), /普通/);
});

console.log(`automatic-time operation checks passed: ${passed}/${passed}`);


