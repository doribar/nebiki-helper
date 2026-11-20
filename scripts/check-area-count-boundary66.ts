import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  buildAreaCountDecisionBasis,
  evaluationToRateAdjustment,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  type AreaCountDecisionBasis,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { getAreaCountBoundaryHint } from "../src/domain/areaCountBoundaryHint.ts";
import { getAreaEvaluationQuickAdjustments } from "../src/domain/areaEvaluationAdjustment.ts";
import { createHumanEvaluationSelection, resolveHumanEvaluationForDiscount } from "../src/domain/humanEvaluation.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { setRuntimeNowOverride } from "../src/hooks/nebikiApp/clock.ts";
import { buildCurrentNormalRatePresentation } from "../src/hooks/nebikiApp/ratePresentation.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import type { AppRouter } from "../src/app/AppRouter.tsx";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";
import type { AppState, AreaCountEvaluation, AreaId, AreaProgress, DemandCycle, DiscountTime, UseNebikiAppResult } from "../src/domain/types.ts";

process.env.TZ = "Asia/Tokyo";
const day = "2026-09-08";
const historicalDays = ["2026-08-18", "2026-08-25", "2026-09-01"];
const at = (clock: string) => new Date(`${day}T${clock}+09:00`);
const noop = () => {};
const markupText = (markup: string) => markup.replace(/<[^>]+>/gu, "");

function recommendation({
  areaId = "tempura",
  discountTime = "15",
  demandCycle = "normal",
  count,
  median,
  days = historicalDays,
}: {
  areaId?: AreaId;
  discountTime?: DiscountTime;
  demandCycle?: DemandCycle;
  count: number;
  median: number;
  days?: string[];
}) {
  const records: AreaCountRecord[] = days.map((date) => ({
    date,
    areaId,
    discountTime,
    demandCycle,
    sessionStartedAt: `${date}T07:00:00.000Z`,
    recordedAt: `${date}T08:30:00.000Z`,
    actualWeekday: "火",
    actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({ date, weekday: 2, discountTime }),
    count: median,
  }));
  return getAreaCountRecommendation({ records, areaId, discountTime, date: day, weekday: 2, demandCycle, count });
}

function progress(
  count: number,
  median: number,
  discountTime: DiscountTime = "15",
  areaId: AreaId = "tempura",
  adopted?: AreaCountEvaluation,
  demandCycle: DemandCycle = "normal",
): AreaProgress {
  const captured = recommendation({ count, median, discountTime, areaId, demandCycle });
  assert.equal(captured.status, "ready");
  assert.equal(captured.medianCount, median);
  const final = adopted ?? captured.suggestedEvaluation;
  assert.ok(final);
  const evaluationSource = adopted ? "manual" : "history";
  const areaRateAdjustment = evaluationToRateAdjustment(final);
  return {
    status: "unstarted",
    areaCount: count,
    areaJudge: "normal",
    areaCountEvaluation: final,
    areaCountEvaluationSource: evaluationSource,
    areaRateAdjustment,
    areaCountDecisionBasis: buildAreaCountDecisionBasis({
      recommendation: captured,
      evaluationSource,
      finalEvaluation: final,
      areaRateAdjustment,
    }),
  };
}

function hint(checked: AreaProgress, discountTime: DiscountTime = "15") {
  return getAreaCountBoundaryHint({
    discountTime,
    areaCount: checked.areaCount,
    areaCountDecisionBasis: checked.areaCountDecisionBasis,
    adoptedEvaluation: checked.areaCountEvaluation,
  });
}

// Load real TSX in Node without adding production or test dependencies.
const modules = new Map<string, Record<string, unknown>>();
async function loadTsx(url: URL): Promise<Record<string, unknown>> {
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
    const target = [id, `${id}.ts`, `${id}.tsx`].map((path) => new URL(path, url)).find((path) => existsSync(path));
    assert.ok(target, `module ${id} from ${url.pathname}`);
    dependencies.set(id, target.pathname.endsWith(".tsx") ? await loadTsx(target) : await import(target.href));
  }
  const exports: Record<string, unknown> = {};
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  runInNewContext(outputText, { exports, require: (id: string) => dependencies.get(id) });
  modules.set(url.href, exports);
  return exports;
}
const Router = (await loadTsx(new URL("../src/app/AppRouter.tsx", import.meta.url))).AppRouter as typeof AppRouter;
const Rate = (await loadTsx(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url))).RateDisplayScreen as typeof RateDisplayScreen;

function rateProps(checked: AreaProgress, discountTime: DiscountTime, weatherBonus = 0): React.ComponentProps<typeof Rate> {
  const session = {
    date: day, weekday: 2, discountTime, demandCycle: "normal" as const,
    startedAt: at(`${discountTime}:00:00`).toISOString(),
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
  const presentation = buildCurrentNormalRatePresentation({
    session, progress: checked, effectiveDiscountTime: discountTime, weatherBonus, ignoreTimeRateCap: false,
  });
  return {
    weekdayText: "火曜日", timeText: `${discountTime}時`, areaName: "天ぷら", discountTime,
    areaCount: checked.areaCount, adoptedAreaEvaluation: checked.areaCountEvaluation,
    areaCountDecisionBasis: checked.areaCountDecisionBasis,
    humanEvaluationDetails: checked.humanEvaluationDetails,
    basisGuide: { referenceText: "", referenceConditionLabel: `9月・火曜日・${discountTime}時` },
    rateDisplay: presentation?.display ?? null,
    onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop,
  };
}

function referenceMarkup(markup: string) {
  const start = markup.indexOf('aria-label="値引の基準とエリア判定"');
  assert.notEqual(start, -1);
  const end = markup.indexOf("各商品の量が", start);
  assert.notEqual(end, -1);
  return markup.slice(start, end);
}

function assertRenderedHint(markup: string, adoptedLabel: string, expected: string | null) {
  const reference = referenceMarkup(markup);
  const visible = markupText(reference.slice(reference.indexOf(">") + 1));
  assert.equal(visible.replace(/^.*?エリア判定：/u, ""), `${adoptedLabel}${expected ?? ""}を基準に考えて`);
  if (expected) {
    assert.equal(markup.split(expected).length, 2, "one supplement inside the instruction region");
    assert.match(reference, /エリア判定：[^<]+<\/span><\/div><div\b[^>]*>残数/u, "supplement is a separate block directly below the adopted field");
  } else {
    assert.doesNotMatch(reference, /data-area-count-boundary-hint|残数\d+個|<div[^>]*><\/div>/u, "silent cases do not leave a spacer");
  }
}

// Mount the real instruction component in a small synchronous React host
// fixture. Native wrapping and touch input are checked separately in Edge.
type ElementProps = {
  children?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
  "aria-label"?: string;
};
type Host = { type: string; props: ElementProps; text: string };
function mountRate(initialProps: React.ComponentProps<typeof Rate>) {
  const hooks = new Map<string, { type: unknown; slots: unknown[] }>();
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown };
  let active: { slots: unknown[]; cursor: number } | undefined;
  let props = initialProps;
  let hosts: Host[] = [];
  let effects: Array<() => void> = [];
  let dirty = false;
  const nextSlot = <T,>(initialize: () => T) => {
    assert.ok(active);
    const index = active.cursor++;
    if (!(index in active.slots)) active.slots[index] = initialize();
    return { slots: active.slots, index };
  };
  const dispatcher = {
    useState<T>(initial: T | (() => T)) {
      const { slots, index } = nextSlot(() => typeof initial === "function" ? (initial as () => T)() : initial);
      return [slots[index], (next: T | ((previous: T) => T)) => {
        const value = typeof next === "function" ? (next as (previous: T) => T)(slots[index] as T) : next;
        if (!Object.is(value, slots[index])) {
          slots[index] = value;
          dirty = true;
        }
      }];
    },
    useRef<T>(initial: T) { const { slots, index } = nextSlot(() => ({ current: initial })); return slots[index]; },
    useEffect(callback: () => void, dependencies?: readonly unknown[]) {
      const { slots, index } = nextSlot(() => undefined);
      const prior = slots[index] as readonly unknown[] | undefined;
      if (prior && dependencies && prior.length === dependencies.length &&
        prior.every((value, i) => Object.is(value, dependencies[i]))) return;
      slots[index] = dependencies;
      effects.push(callback);
    },
    useCallback<T>(callback: T) { return callback; },
    useMemo<T>(callback: () => T) { return callback(); },
  };
  function expand(node: React.ReactNode, path: string): string {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}.${index}`)).join("");
    assert.ok(React.isValidElement<ElementProps>(node));
    if (node.type === React.Fragment) return expand(node.props.children, `${path}.fragment`);
    if (typeof node.type === "function") {
      const key = `${path}:${node.key ?? ""}`;
      let saved = hooks.get(key);
      if (!saved || saved.type !== node.type) {
        saved = { type: node.type, slots: [] };
        hooks.set(key, saved);
      }
      const previous = active;
      active = { slots: saved.slots, cursor: 0 };
      const output = (node.type as (p: ElementProps) => React.ReactNode)(node.props);
      active = previous;
      return expand(output, `${path}.component`);
    }
    assert.equal(typeof node.type, "string");
    const text = expand(node.props.children, `${path}.host`);
    hosts.push({ type: node.type as string, props: node.props, text });
    return text;
  }
  function render() {
    let text = "";
    dirty = true;
    for (let pass = 0; dirty; pass++) {
      assert.ok(pass < 10, "the instruction effects converge");
      dirty = false;
      hosts = [];
      effects = [];
      const previous = internals.H;
      internals.H = dispatcher;
      try { text = expand(React.createElement(Rate, props), "root"); }
      finally { internals.H = previous; }
      effects.forEach((effect) => effect());
    }
    return text;
  }
  return {
    render,
    update: (patch: Partial<typeof props>) => {
      props = { ...props, ...patch };
      return render();
    },
    click(label: string) {
      const button = hosts.find((host) => host.type === "button" && host.text === label);
      assert.ok(button?.props.onClick, `missing button ${label}`);
      button.props.onClick();
      return render();
    },
  };
}

function routedState(areas: Partial<Record<AreaId, AreaProgress>>, active: AreaId, time: DiscountTime): AppState {
  const draft = {
    date: day, weekday: 2, discountTime: time, demandCycle: "normal" as const,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
  const initial = createInitialState(draft);
  return {
    ...initial, screen: "rate_display", session: { ...draft, startedAt: at(`${time}:00:00`).toISOString() },
    currentAreaId: active, areaProgressMap: { ...initial.areaProgressMap, ...areas },
  };
}

function renderRouted(state: AppState, currentAreaName: string) {
  assert.ok(state.currentAreaId && state.session);
  const props = rateProps(state.areaProgressMap[state.currentAreaId], state.session.discountTime);
  // The real router resolves area progress, the final adopted evaluation and
  // quick controls. Unrelated actions and computed panels are left outside this
  // presentation fixture.
  const app = {
    state,
    derived: {
      currentAreaName, weekdayText: props.weekdayText, timeText: props.timeText,
      demandCycle: "normal", basisGuide: props.basisGuide, rateDisplay: props.rateDisplay,
    },
    actions: { goToNextArea: noop, skipCurrentArea: noop, goBackOneScreen: noop },
  } as UseNebikiAppResult;
  return renderToStaticMarkup(React.createElement(Router, { app }));
}

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void) { cases.push({ name, run }); }
const tempuraText = "残数25個（24個なら「普通」）";
const sushiText = "残数41個（42個なら「多い」）";
const manualText = "残数25個・自動判定「やや多い」（24個なら「普通」）";

for (const time of ["15", "17"] as const) {
  test(`${time}: actual history, three requested examples and exact rendered placement`, () => {
    for (const scenario of [
      { areaId: "tempura", count: 25, median: 22, expected: tempuraText },
      { areaId: "sushi", count: 41, median: 35, expected: sushiText },
      { areaId: "sushi", count: 40, median: 35, expected: null },
    ] as const) {
      const checked = progress(scenario.count, scenario.median, time, scenario.areaId);
      assert.equal(checked.areaCountEvaluation, "slightly_many");
      assert.equal(hint(checked, time), scenario.expected);
      assertRenderedHint(renderToStaticMarkup(React.createElement(Rate, rateProps(checked, time))), "やや多い", scenario.expected);
    }
  });

  test(`${time}: a lower quick correction distinguishes adopted and residual judgments`, () => {
    const auto = progress(25, 22, time);
    const lower = getAreaEvaluationQuickAdjustments({
      screen: "rate_display", discountTime: time, isTestMode: false, now: at(`${time}:15:00`), progress: auto,
    }).find((choice) => choice.direction === "lower");
    assert.ok(lower);
    assert.equal(lower.finalEvaluation, "normal");
    const manual = progress(25, 22, time, "tempura", lower.finalEvaluation);
    const selection = createHumanEvaluationSelection(lower.finalEvaluation);
    assert.ok(selection);
    const evaluatedAt = at(`${time}:15:00`);
    manual.humanEvaluationDetails = {
      ...resolveHumanEvaluationForDiscount({ selection, sessionDiscountTime: time, demandCycle: "normal", nowMs: evaluatedAt.getTime(), evaluatedAt: evaluatedAt.toISOString() }),
      automaticEvaluation: lower.originalEvaluation,
      evaluationAdjustment: lower,
    };
    assert.equal(hint(auto, time), tempuraText);
    assert.equal(hint(manual, time), manualText);
    const routed = routedState({ tempura: manual }, "tempura", time);
    assertRenderedHint(renderRouted(routed, "天ぷら"), "普通", manualText);
  });

  test(`${time}: a full manual judgment does not create a non-boundary supplement`, () => {
    const near = progress(25, 22, time, "tempura", "few");
    assert.equal(hint(near, time), manualText);
    assertRenderedHint(renderRouted(routedState({ tempura: near }, "tempura", time), "天ぷら"), "少ない", manualText);
    const far = progress(40, 35, time, "sushi", "many");
    assert.equal(hint(far, time), null);
    assertRenderedHint(renderRouted(routedState({ sushi: far }, "sushi", time), "寿司"), "多い", null);
  });

  test(`${time}: both product instructions use the same hint and preserve completion`, () => {
    setRuntimeNowOverride(at(`${time}:15:00`));
    const checked = progress(25, 22, time);
    const initial = structuredClone(checked);
    let completions = 0;
    const props = rateProps(checked, time);
    assert.ok(props.rateDisplay);
    const mounted = mountRate({ ...props, onNextArea: () => { completions++; } });
    const first = mounted.render();
    assert.ok(first.includes(`多い商品を${props.rateDisplay.many.main}値引きしてください。`));
    assert.ok(first.includes(tempuraText));
    const second = mounted.click("終わった");
    assert.equal(completions, 0);
    assert.ok(second.includes(`どちらでもない商品を${props.rateDisplay.normal.main}値引きしてください。`));
    assert.ok(second.includes(tempuraText));
    mounted.click("終わった");
    assert.equal(completions, 1);
    assert.deepEqual(checked, initial);
  });
}

test("one item can change the evaluation on both sides, with lower count first", () => {
  const checked = progress(1, 0, "17", "sushi");
  const expected = "残数1個（0個なら「少ない」、2個なら「やや多い」）";
  assert.equal(hint(checked, "17"), expected);
  assertRenderedHint(renderRouted(routedState({ sushi: checked }, "sushi", "17"), "寿司"), "普通", expected);
});

test("zero does not generate a negative candidate or a spacer", () => {
  const checked = progress(0, 0);
  assert.equal(hint(checked), "残数0個（1個なら「普通」）");
  assert.equal(hint(progress(0, 22)), null);
  assert.doesNotMatch(hint(checked) ?? "", /-1個/u);
});

test("missing, noninteger and nonfinite counts never fabricate a boundary", () => {
  const checked = progress(25, 22);
  for (const areaCount of [null, undefined, -1, 25.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(hint({ ...checked, areaCount }), null);
  }
});

test("insufficient, missing and inconsistent captured bases do not show a boundary", () => {
  const checked = progress(25, 22);
  const basis = checked.areaCountDecisionBasis!;
  const tooShort = buildAreaCountDecisionBasis({
    recommendation: recommendation({ count: 25, median: 22, days: historicalDays.slice(0, 2) }),
  });
  assert.equal(tooShort.recommendationStatus, "insufficient");
  const cases: Array<AreaCountDecisionBasis | undefined> = [
    undefined,
    tooShort,
    { ...basis, medianCount: undefined },
    { ...basis, upperSmallThreshold: undefined },
    { ...basis, upperLargeThreshold: basis.upperLargeThreshold! + 1 },
    { ...basis, lowerSmallThreshold: 999 },
    { ...basis, sampleSize: 2 },
    { ...basis, baseEvaluation: "many" },
    { ...basis, ruleVersion: "unknown_legacy_rule" as AreaCountDecisionBasis["ruleVersion"] },
  ];
  for (const areaCountDecisionBasis of cases) {
    const incomplete = { ...checked, areaCountDecisionBasis };
    assert.equal(hint(incomplete), null);
    assertRenderedHint(renderToStaticMarkup(React.createElement(Rate, rateProps(incomplete, "15"))), "やや多い", null);
  }
  assert.equal(hint({ ...checked, areaCountEvaluation: undefined }), null);
});

test("stored, coherent basis survives normalization and stays independent from updated history and cycle", () => {
  const saved = progress(25, 22, "17", "tempura", undefined, "summer");
  const reopened = normalizeLoadedState(routedState({ tempura: saved }, "tempura", "17"));
  assert.equal(hint(reopened.areaProgressMap.tempura, "17"), tempuraText);
  const fresh = progress(25, 35, "17", "tempura");
  assert.equal(hint(fresh, "17"), null);
  assertRenderedHint(renderRouted(reopened, "天ぷら"), "やや多い", tempuraText);
  assert.deepEqual(reopened.areaProgressMap.tempura.areaCountDecisionBasis, saved.areaCountDecisionBasis);
});

test("the actual router uses the active area's saved evidence on switch and revisit", () => {
  const areas = { tempura: progress(25, 22, "17"), sushi: progress(41, 35, "17", "sushi") };
  const state = routedState(areas, "tempura", "17");
  const before = structuredClone(state);
  assertRenderedHint(renderRouted(state, "天ぷら"), "やや多い", tempuraText);
  assertRenderedHint(renderRouted({ ...state, currentAreaId: "sushi" }, "寿司"), "やや多い", sushiText);
  const inside = { ...state.areaProgressMap, sushi: progress(40, 35, "17", "sushi") };
  assertRenderedHint(renderRouted({ ...state, currentAreaId: "sushi", areaProgressMap: inside }, "寿司"), "やや多い", null);
  assertRenderedHint(renderRouted(state, "天ぷら"), "やや多い", tempuraText);
  assert.deepEqual(state, before);
});

test("rate instructions for other times do not show the supplement", () => {
  const checked = progress(25, 22);
  for (const time of ["18", "19", "20"] as const) {
    assert.equal(hint(checked, time), null);
    const markup = renderToStaticMarkup(React.createElement(Rate, rateProps(checked, time)));
    assert.doesNotMatch(markup, /data-area-count-boundary-hint|24個なら/u);
  }
});

test("a captured 17:00 residual basis remains visible when the existing 18:00 stage boundary is crossed", () => {
  const checked = progress(25, 22, "17");
  const props = rateProps(checked, "17");
  const lateRate = rateProps(checked, "17", 5).rateDisplay;
  assert.ok(lateRate);
  assert.notEqual(lateRate.normal.main, props.rateDisplay?.normal.main);
  setRuntimeNowOverride(at("17:55:00"));
  const mounted = mountRate(props);
  assert.match(mounted.render(), /1 \/ 2/u);
  assert.match(mounted.click("終わった"), /2 \/ 2/u);
  setRuntimeNowOverride(at("18:00:00"));
  const late = mounted.update({
    rateDisplay: lateRate,
    basisGuide: { ...props.basisGuide, referenceConditionLabel: "9月・火曜日・18時" },
  });
  assert.ok(late.includes(tempuraText));
  assert.match(late, /2 \/ 2/u);
  assert.ok(late.includes(`どちらでもない商品を${lateRate.normal.main}値引きしてください。`));
});

let passed = 0;
try {
  for (const { name, run } of cases) {
    setRuntimeNowOverride(at("15:30:00"));
    run();
    passed++;
    console.log(`PASS ${name}`);
  }
} finally {
  setRuntimeNowOverride(null);
}
console.log(`Area-count boundary checks passed: ${passed}/${cases.length}`);
