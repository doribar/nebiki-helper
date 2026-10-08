import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  canSuppressAreaCountDecreaseAdjustment,
  setAreaCountDecreaseAdjustmentSuppressed,
  type AreaCountDecisionBasis,
  type AreaCountRecommendation,
} from "../src/domain/areaCountHistory.ts";
import type { AreaJudgeScreen } from "../src/components/screens/AreaJudgeScreen.tsx";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";
import type { AppRouter } from "../src/app/AppRouter.tsx";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { retainSuppressedDecreaseRecommendation } from "../src/hooks/nebikiApp/decreaseSuppression.ts";
import type { AreaId, AreaProgress, DiscountTime, RateDisplayData, ScreenName, UseNebikiAppResult } from "../src/domain/types.ts";

// Actual production TSX, React JSX and React hooks execute in this fixture.
// The dispatcher controls scheduling and invokes real event handlers; it does
// not replace domain calculations. Native DOM/layout are checked in Edge.
const modules = new Map<string, Record<string, unknown>>();
async function load(url: URL): Promise<Record<string, unknown>> {
  const cached = modules.get(url.href);
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
    const target = [id, id + ".ts", id + ".tsx"].map(path => new URL(path, url)).find(path => existsSync(path));
    assert.ok(target);
    dependencies.set(id, target.pathname.endsWith(".tsx") ? await load(target) : await import(target.href));
  }
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, window: fixtureWindow, document: fixtureDocument, require: (id: string) => {
    assert.ok(dependencies.has(id)); return dependencies.get(id);
  } });
  modules.set(url.href, exports);
  return exports;
}

const sessionStorage = new Map<string, string>();
const fixtureWindow = {
  setTimeout: () => 1, clearTimeout: () => {},
  scrollTo: () => {},
  addEventListener: () => {}, removeEventListener: () => {},
  sessionStorage: {
    getItem: (key: string) => sessionStorage.get(key) ?? null,
    setItem: (key: string, value: string) => sessionStorage.set(key, value),
    removeItem: (key: string) => sessionStorage.delete(key),
  },
};
const fixtureDocument = { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} };
Object.defineProperty(globalThis, "window", { configurable: true, value: fixtureWindow });
Object.defineProperty(globalThis, "document", { configurable: true, value: fixtureDocument });
const Judge = (await load(new URL("../src/components/screens/AreaJudgeScreen.tsx", import.meta.url))).AreaJudgeScreen as typeof AreaJudgeScreen;
const Rate = (await load(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url))).RateDisplayScreen as typeof RateDisplayScreen;
const Router = (await load(new URL("../src/app/AppRouter.tsx", import.meta.url))).AppRouter as typeof AppRouter;
const noop = () => {};
const shared = {
  weekdayText: "土曜日", timeText: "17時", areaName: "弁当・麺",
  basisGuide: { referenceText: "10月の土曜日の17時を基準に考えて", referenceConditionLabel: "10月・土曜日・17時" },
  onGoBack: noop, onReturnHome: noop, onSkip: noop,
};
function basis(direction: "more_many" | "more_few" | "none" = "more_many", canUse = true): AreaCountDecisionBasis {
  return {
    ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 3, requiredSampleSize: 3,
    baseEvaluation: "normal", finalEvaluation: "slightly_many", areaRateAdjustment: 5,
    decreaseAdjustment: { canUse, direction, sampleSize: 3, requiredSampleSize: 3, previousDiscountTime: "15", previousCount: 50, currentDecreaseRate: 0.3, medianDecreaseRate: 0.5 },
  };
}
function rates(normal = "20%"): RateDisplayData {
  return { many: { main: "30%" }, normal: { main: normal }, few: { main: "引かない" } };
}
function rateMarkup(patch: Partial<React.ComponentProps<typeof Rate>> = {}) {
  return renderToStaticMarkup(React.createElement(Rate, {
    ...shared, discountTime: "17", areaCount: 20, areaCountDecisionBasis: basis(),
    rateDisplay: rates(), onNextArea: noop, ...patch,
  }));
}

function routedApp(areaId: AreaId = "bento_men", discountTime: DiscountTime = "17", screen: ScreenName = "rate_display"): UseNebikiAppResult {
  const draft = {
    date: "2026-10-03", weekday: 6, discountTime, demandCycle: "normal" as const,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
  const state = createInitialState(draft);
  state.session = { ...draft, startedAt: "2026-10-03T08:00:00.000Z" };
  state.screen = screen; state.currentAreaId = areaId;
  state.areaProgressMap[areaId] = { areaId, status: "unstarted", areaJudge: "normal", areaCount: 20,
    areaCountEvaluation: "slightly_many", areaCountEvaluationSource: "history", areaRateAdjustment: 5,
    areaCountDecisionBasis: basis() };
  return {
    state,
    derived: {
      ...shared, demandCycle: "normal", currentAreaName: areaId, rateDisplay: rates(),
      areaCountAssistEnabled: true,
      finalGuide: { count1: { main: "30%" }, count2: { main: "40%" }, count3OrMore: { main: "50%" }, score: 0, scoreThreshold: 3, scoreBreakdown: { weekdayShiftPoints: 0, rateBonusPoints: 0 } },
    } as unknown as UseNebikiAppResult["derived"],
    actions: {
      goBackOneScreen: noop, skipCurrentArea: noop, goToNextArea: noop,
      applyAreaEvaluationAdjustment: noop, toggleCurrentAreaDecreaseAdjustmentSuppression: noop,
      judgeCurrentArea: noop, chooseSkipTargetArea: noop, startAreaCountCorrection: noop,
      startAutoSkippedAreaCountOnly: noop, processAutoSkippedAreaNormally: noop, skipAutoSkippedAreaWithoutMeasurement: noop,
      saveAutoSkippedAreaCount: noop, advanceFinalTimeStep: noop,
      getCurrentAreaCountRecommendation: () => ({ status: "insufficient", demandCycle: "normal", count: 20, sampleSize: 0, requiredSampleSize: 3, matchedRecords: [], summaryText: "履歴不足", detailLines: [] }),
    } as unknown as UseNebikiAppResult["actions"],
  };
}
function routedMarkup(app: UseNebikiAppResult, testNow?: Date) {
  return renderToStaticMarkup(React.createElement(Router, { app, testNow }));
}

type Props = Record<string, unknown>;
type Node = { type: string; props: Props; children: Array<Node | string> };
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Instance = { type: unknown; slots: Slot[]; cursor: number };
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) => a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const textOf = (node: Node | string): string => typeof node === "string" ? node : node.children.map(textOf).join("");
class ComponentFixture {
  private instances = new Map<string, Instance>();
  private current: Instance | null = null;
  private effects: Array<() => void> = [];
  private root: () => React.ReactNode;
  private dirty = true;
  nodes: Node[] = [];
  constructor(root: () => React.ReactNode) { this.root = root; this.render(); }
  private slot() { assert.ok(this.current); return this.current.slots[this.current.cursor++] ??= {}; }
  private dispatcher = {
    useState: <T,>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] => {
      const slot = this.slot();
      if (!("value" in slot)) slot.value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slot.value as T, value => {
        const next = typeof value === "function" ? (value as (previous: T) => T)(slot.value as T) : value;
        if (!Object.is(next, slot.value)) { slot.value = next; this.dirty = true; }
      }];
    },
    useRef: <T,>(initial: T) => { const slot = this.slot(); if (!("value" in slot)) slot.value = { current: initial }; return slot.value as { current: T }; },
    useMemo: <T,>(callback: () => T, deps?: readonly unknown[]) => { const slot = this.slot(); if (!("value" in slot) || !sameDeps(slot.deps, deps)) { slot.value = callback(); slot.deps = deps; } return slot.value as T; },
    useCallback: <T,>(callback: T, deps?: readonly unknown[]) => this.dispatcher.useMemo(() => callback, deps),
    useEffect: (callback: () => void | (() => void), deps?: readonly unknown[]) => {
      const slot = this.slot();
      if (!sameDeps(slot.deps, deps)) { slot.deps = deps; this.effects.push(() => { slot.cleanup?.(); const cleanup = callback(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; }); }
    },
  };
  render() {
    this.dirty = true;
    for (let pass = 0; this.dirty; pass++) {
      assert.ok(pass < 20, "real component state/effects settle");
      this.dirty = false; this.nodes = [];
      const visited = new Set<string>();
      const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown } }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H; internals.H = this.dispatcher;
      const expand = (value: React.ReactNode, path: string): Array<Node | string> => {
        if (value === null || value === undefined || typeof value === "boolean") return [];
        if (typeof value === "string" || typeof value === "number") return [String(value)];
        if (Array.isArray(value)) return value.flatMap((child, index) => expand(child, `${path}/${index}`));
        assert.ok(React.isValidElement<Props>(value));
        if (value.type === React.Fragment) return expand(value.props.children as React.ReactNode, path + "/fragment");
        if (typeof value.type === "function") {
          const key = path + ":" + (value.key ?? "");
          let instance = this.instances.get(key);
          if (!instance || instance.type !== value.type) { instance?.slots.forEach(slot => slot.cleanup?.()); instance = { type: value.type, slots: [], cursor: 0 }; this.instances.set(key, instance); }
          visited.add(key); instance.cursor = 0;
          const outer = this.current; this.current = instance;
          const rendered = (value.type as (props: Props) => React.ReactNode)(value.props);
          this.current = outer;
          return expand(rendered, path + "/render");
        }
        assert.equal(typeof value.type, "string");
        const node: Node = { type: value.type as string, props: value.props, children: [] }; this.nodes.push(node);
        node.children = expand(value.props.children as React.ReactNode, path + "/children");
        return [node];
      };
      try { expand(this.root(), "root"); } finally { internals.H = previous; }
      for (const [key, instance] of this.instances) if (!visited.has(key)) { instance.slots.forEach(slot => slot.cleanup?.()); this.instances.delete(key); }
      const effects = this.effects; this.effects = []; effects.forEach(effect => effect());
    }
  }
  text() { return this.nodes.filter(node => node.type === "main").map(textOf).join(""); }
  click(label: string) { const button = this.nodes.find(node => node.type === "button" && textOf(node) === label); assert.ok(button, `real button exists: ${label}`); assert.ok(!button.props.disabled); (button.props.onClick as () => void)(); this.render(); }
  close() { this.instances.forEach(instance => instance.slots.forEach(slot => slot.cleanup?.())); }
}

const tests: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => tests.push({ name, run });

test("SSR count and assessment are paired directly below ScreenHeader", () => {
  const markup = rateMarkup();
  assert.match(markup, /エリア残数：20個/);
  assert.match(markup, /減少率：悪い/);
  assert.ok(markup.indexOf("現在のエリア残数と減少率") < markup.indexOf("各商品の量が"));
  assert.match(markup, /flex-wrap:wrap/);
});
test("raw recommendation direction supplies all three labels; incomparable is not ordinary", () => {
  for (const [direction, canUse, expected] of [["more_many", true, "悪い"], ["more_few", true, "良い"], ["none", true, "普通"], ["none", false, "判定なし"], ["more_many", false, "判定なし"]] as const) {
    assert.match(rateMarkup({ areaCountDecisionBasis: basis(direction, canUse) }), new RegExp(`減少率：${expected}`));
  }
  assert.match(rateMarkup({ areaCountDecisionBasis: undefined }), /減少率：判定なし/);
});
test("unknown/invalid counts do not invent a remaining-count display; zero is known", () => {
  for (const areaCount of [undefined, null, -1, NaN, Infinity, 1.5]) assert.doesNotMatch(rateMarkup({ areaCount }), /エリア残数：/);
  assert.match(rateMarkup({ areaCount: 0 }), /エリア残数：0個/);
});
test("only eligible 17-time bad comparison renders suppression control", () => {
  const targets: AreaId[] = ["bento_men", "tempura", "onigiri", "inari", "hosomaki", "ryomi", "autumn", "yakitori"];
  const excluded: AreaId[] = ["croquette", "fry_chicken", "chuka_fish", "sushi", "futomaki_chumaki"];
  for (const areaId of [...targets, ...excluded]) {
    for (const discountTime of ["17", "19"] as const) {
      for (const [direction, canUse] of [["more_many", true], ["more_few", true], ["none", true], ["none", false]] as const) {
        const raw = basis(direction, canUse);
        const eligible = canSuppressAreaCountDecreaseAdjustment({ areaId, discountTime, basis: raw });
        const markup = rateMarkup({ discountTime, areaCountDecisionBasis: raw, onToggleDecreaseAdjustmentSuppression: eligible ? noop : undefined });
        assert.equal(markup.includes("追加製造あり・補正を取り消す"), targets.includes(areaId) && discountTime === "17" && direction === "more_many" && canUse);
      }
    }
  }
});
test("fixed-time callback absence and defensive 19:30 guard hide the button", () => {
  assert.doesNotMatch(rateMarkup({ onToggleDecreaseAdjustmentSuppression: undefined }), /追加製造あり・補正を取り消す/);
  assert.doesNotMatch(rateMarkup({ discountTime: "19", onToggleDecreaseAdjustmentSuppression: noop }), /追加製造あり・補正を取り消す/);
  const raw19 = basis(); raw19.decreaseAdjustment!.previousDiscountTime = "18";
  const markup19 = rateMarkup({ discountTime: "19", areaCountDecisionBasis: raw19 });
  assert.match(markup19, /減少率：悪い/); assert.doesNotMatch(markup19, /追加製造あり・補正を取り消す/);
});
test("rate instructions and lower notices keep the same current-area count and raw assessment", () => {
  const markup = rateMarkup();
  assert.match(markup, /エリア残数：20個/); assert.match(markup, /減少率：悪い/); assert.match(markup, /注意事項/);
  assert.match(markup, /多い商品を30%/); assert.doesNotMatch(markup, />OK<\/button>/);
});
test("actual AreaJudge keypad completion transitions to RateDisplay with count 20", () => {
  sessionStorage.clear();
  let screen: "judge" | "rate" = "judge";
  let count: number | undefined;
  const recommendation: AreaCountRecommendation = {
    status: "ready", demandCycle: "normal", count: 20, sampleSize: 3, requiredSampleSize: 3, matchedRecords: [],
    baseEvaluation: "normal", suggestedEvaluation: "slightly_many", areaRateAdjustment: 5, summaryText: "やや多い", detailLines: [],
  };
  const fixture = new ComponentFixture(() => screen === "judge"
    ? React.createElement(Judge, { ...shared, areaId: "bento_men", calculatorDraftScope: "input-20", areaCountAssistEnabled: true,
      getAreaCountRecommendation: () => recommendation, onJudge: (_judge, entered) => { count = entered ?? undefined; screen = "rate"; } })
    : React.createElement(Rate, { ...shared, discountTime: "17", areaCount: count, areaCountDecisionBasis: basis(), rateDisplay: rates(), onNextArea: noop }));
  fixture.click("2"); fixture.click("0"); fixture.click("完了");
  assert.equal(count, 20); assert.match(fixture.text(), /エリア残数：20個/); assert.match(fixture.text(), /多い商品を30%/);
  fixture.click("終わった");
  assert.match(fixture.text(), /どちらでもない商品を20%/); assert.match(fixture.text(), /エリア残数：20個/);
  fixture.close();
});
test("RateDisplay quick adjustment and manual selector retain current count", () => {
  let rateDisplay = rates(); let quick = 0;
  const fixture = new ComponentFixture(() => React.createElement(Rate, {
    ...shared, discountTime: "17", areaCount: 20, areaCountDecisionBasis: basis(), rateDisplay,
    medianEvaluationDisplay: { text: "普通", evaluation: "normal", status: "ready" },
    areaEvaluationQuickAdjustments: [{ applied: true, source: "human", direction: "lower", steps: 1, originalEvaluation: "normal", finalEvaluation: "slightly_few" }],
    onApplyAreaEvaluationAdjustment: () => { quick++; rateDisplay = rates("15%"); },
    canOverrideAreaCountEvaluation: true, onOverrideAreaCountEvaluation: noop, onNextArea: noop,
  }));
  fixture.click("やや少ないにする"); assert.equal(quick, 1); assert.match(fixture.text(), /エリア残数：20個/);
  fixture.click("自動判定を手動で変更"); assert.match(fixture.text(), /エリア残数：20個/);
  fixture.click("終わった"); assert.match(fixture.text(), /どちらでもない商品を15%/); assert.match(fixture.text(), /エリア残数：20個/);
  fixture.close();
});
test("count correction and next-area/reload use the latest current-area progress prop", () => {
  let areaId: AreaId = "bento_men";
  const progress: Partial<Record<AreaId, AreaProgress>> = {
    bento_men: { areaId: "bento_men", status: "unstarted", areaJudge: "normal", areaCount: 20, areaCountDecisionBasis: basis() },
    onigiri: { areaId: "onigiri", status: "unstarted", areaJudge: "normal", areaCount: 7 },
  };
  const root = () => React.createElement(Rate, { ...shared, areaName: areaId, discountTime: "17", areaCount: progress[areaId]?.areaCount,
    areaCountDecisionBasis: progress[areaId]?.areaCountDecisionBasis, rateDisplay: rates(), onNextArea: noop });
  const fixture = new ComponentFixture(root);
  assert.match(fixture.text(), /エリア残数：20個/);
  progress.bento_men!.areaCount = 18; fixture.render();
  assert.match(fixture.text(), /エリア残数：18個/); assert.doesNotMatch(fixture.text(), /エリア残数：20個/);
  areaId = "onigiri"; fixture.render();
  assert.match(fixture.text(), /エリア残数：7個/); assert.doesNotMatch(fixture.text(), /エリア残数：(20|18)個/);
  fixture.close();
  const recovered = JSON.parse(JSON.stringify({ areaId, progress })) as { areaId: AreaId; progress: typeof progress };
  const reloaded = new ComponentFixture(() => React.createElement(Rate, { ...shared, discountTime: "17", areaCount: recovered.progress[recovered.areaId]?.areaCount,
    areaCountDecisionBasis: recovered.progress[recovered.areaId]?.areaCountDecisionBasis, rateDisplay: rates(), onNextArea: noop }));
  assert.match(reloaded.text(), /エリア残数：7個/); assert.doesNotMatch(reloaded.text(), /エリア残数：(20|18)個/); reloaded.close();
});
test("suppression click keeps bad raw assessment through both steps and restoration", () => {
  let currentBasis = basis(); const raw = { ...currentBasis.decreaseAdjustment };
  const toggle = () => { const next = setAreaCountDecreaseAdjustmentSuppressed({ areaId: "bento_men", discountTime: "17", basis: currentBasis, suppressed: currentBasis.decreaseAdjustment?.suppressed !== true }); assert.ok(next); currentBasis = next; };
  const fixture = new ComponentFixture(() => React.createElement(Rate, { ...shared, discountTime: "17", areaCount: 20,
    areaCountDecisionBasis: currentBasis, rateDisplay: rates(), onToggleDecreaseAdjustmentSuppression: toggle, onNextArea: noop }));
  fixture.click("追加製造あり・補正を取り消す");
  assert.match(fixture.text(), /減少率：悪い/); assert.match(fixture.text(), /減少率補正：取り消し済み/); assert.equal(currentBasis.finalEvaluation, "normal");
  fixture.click("終わった"); assert.match(fixture.text(), /どちらでもない商品を20%/); assert.match(fixture.text(), /減少率補正：取り消し済み/);
  fixture.click("補正を戻す"); assert.match(fixture.text(), /減少率：悪い/); assert.equal(currentBasis.finalEvaluation, "slightly_many");
  assert.deepEqual(currentBasis.decreaseAdjustment, raw); fixture.close();
});
test("AreaJudge manual phase derives newly entered count and recommendation instead of stale basis", () => {
  sessionStorage.clear(); let recommendations = 0;
  const getAreaCountRecommendation = (count: number): AreaCountRecommendation => {
    recommendations++;
    return { status: "insufficient", demandCycle: "normal", count, sampleSize: 0, requiredSampleSize: 3, matchedRecords: [],
      summaryText: "履歴不足", detailLines: [], decreaseRecommendation: { canUse: false, direction: "none", sampleSize: 0, requiredSampleSize: 3, detailLines: [] } };
  };
  const fixture = new ComponentFixture(() => React.createElement(Judge, { ...shared, areaId: "bento_men", calculatorDraftScope: "manual-18",
    areaCount: 20, areaCountDecisionBasis: basis(), areaCountAssistEnabled: true, getAreaCountRecommendation, onJudge: noop }));
  fixture.click("1"); fixture.click("8"); fixture.click("完了");
  assert.match(fixture.text(), /エリア残数：18個/); assert.match(fixture.text(), /減少率：判定なし/); assert.doesNotMatch(fixture.text(), /減少率：悪い/);
  const calls = recommendations; fixture.render(); assert.equal(recommendations, calls, "status display reuses existing memoized recommendation"); fixture.close();
});
test("AreaJudge retains saved suppression only when the newly entered raw comparison is still bad", () => {
  for (const direction of ["more_many", "more_few", "none"] as const) {
    sessionStorage.clear();
    const previous = basis(); previous.decreaseAdjustment!.suppressed = true;
    const raw = basis(direction).decreaseAdjustment!;
    const recommendation: AreaCountRecommendation = {
      status: "insufficient", demandCycle: "normal", count: 18, sampleSize: 0, requiredSampleSize: 3, matchedRecords: [],
      summaryText: "履歴不足", detailLines: [], decreaseRecommendation: { ...raw, detailLines: [] },
    };
    const getAreaCountRecommendation = () => recommendation;
    const fixture = new ComponentFixture(() => React.createElement(Judge, { ...shared, areaId: "bento_men", calculatorDraftScope: "retained-" + direction,
      areaCount: 20, areaCountDecisionBasis: previous, areaCountAssistEnabled: true, getAreaCountRecommendation, onJudge: noop }));
    fixture.click("1"); fixture.click("8"); fixture.click("完了");
    assert.match(fixture.text(), /エリア残数：18個/);
    assert.equal(fixture.text().includes("減少率補正：取り消し済み"), direction === "more_many");
    assert.match(fixture.text(), new RegExp(`減少率：${direction === "more_many" ? "悪い" : direction === "more_few" ? "良い" : "普通"}`));
    assert.doesNotMatch(fixture.text(), /追加製造あり・補正を取り消す|補正を戻す/);
    fixture.close();
  }
  const previous = basis(); previous.decreaseAdjustment!.suppressed = true;
  const raw = basis().decreaseAdjustment!;
  const retained = retainSuppressedDecreaseRecommendation({ areaId: "bento_men", discountTime: "17", previousBasis: previous,
    recommendation: { status: "ready", demandCycle: "normal", count: 18, sampleSize: 3, requiredSampleSize: 3, matchedRecords: [],
      baseEvaluation: "normal", suggestedEvaluation: "slightly_many", areaRateAdjustment: 5, summaryText: "やや多い", detailLines: [], decreaseRecommendation: { ...raw, detailLines: [] } } });
  assert.equal(retained.suggestedEvaluation, "normal");
  assert.equal(retained.decreaseRecommendation?.direction, "more_many");
  assert.equal(retained.decreaseRecommendation?.currentDecreaseRate, raw.currentDecreaseRate);
});
test("actual AppRouter routes canonical current-area progress across count and skip/final screens", () => {
  for (const screen of ["area_judge", "rate_display", "auto_skip_notice", "auto_skip_count", "final_time"] as const) {
    const app = routedApp("bento_men", screen === "final_time" ? "20" : "17", screen);
    let markup = routedMarkup(app);
    assert.match(markup, /エリア残数：20個/); assert.match(markup, /減少率：悪い/);
    app.state.areaProgressMap.bento_men.areaCount = 18;
    markup = routedMarkup(app); assert.match(markup, /エリア残数：18個/); assert.doesNotMatch(markup, /エリア残数：20個/);
    app.state.currentAreaId = "onigiri";
    app.state.areaProgressMap.onigiri.areaCount = 7;
    app.derived.currentAreaName = "おにぎり";
    markup = routedMarkup(app); assert.match(markup, /エリア残数：7個/); assert.doesNotMatch(markup, /エリア残数：(20|18)個/);
  }
});
test("actual AppRouter owns area/time eligibility and fixed-time suppression callback guard", () => {
  const targets: AreaId[] = ["bento_men", "tempura", "onigiri", "inari", "hosomaki", "ryomi", "autumn", "yakitori"];
  for (const areaId of [...targets, "croquette", "fry_chicken", "chuka_fish", "sushi", "futomaki_chumaki"] as AreaId[]) {
    for (const discountTime of ["17", "19"] as const) {
      const app = routedApp(areaId, discountTime);
      if (discountTime === "19") app.state.areaProgressMap[areaId].areaCountDecisionBasis!.decreaseAdjustment!.previousDiscountTime = "18";
      for (const direction of ["more_many", "more_few", "none"] as const) {
        app.state.areaProgressMap[areaId].areaCountDecisionBasis!.decreaseAdjustment!.direction = direction;
        const expected = targets.includes(areaId) && discountTime === "17" && direction === "more_many";
        assert.equal(routedMarkup(app).includes("追加製造あり・補正を取り消す"), expected);
        assert.doesNotMatch(routedMarkup(app, new Date("2026-10-03T08:00:00.000Z")), /追加製造あり・補正を取り消す|補正を戻す/);
      }
    }
  }
});
test("actual AppRouter and optional screen props do not invent a count on global or unmeasured screens", () => {
  for (const screen of ["area_judge", "rate_display", "auto_skip_notice", "auto_skip_count"] as const) {
    const app = routedApp("bento_men", "17", screen); delete app.state.areaProgressMap.bento_men.areaCount;
    assert.doesNotMatch(routedMarkup(app), /エリア残数：/);
  }
  const final = routedApp("bento_men", "20", "final_time"); final.state.currentAreaId = null;
  assert.doesNotMatch(routedMarkup(final), /エリア残数：/);
});
test("shared status component adds no count/assessment state or history preprocessing", () => {
  const panel = readFileSync(new URL("../src/components/common/AreaCountStatusPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /useState|useEffect|prepareAreaCount|normalizeAreaCount|JSON\.(?:parse|stringify)|localStorage|archive/i);
});

let passed = 0;
for (const { name, run } of tests) { run(); passed++; console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`); }
console.log(`Area count status UI checks passed: ${passed}/${tests.length}`);
