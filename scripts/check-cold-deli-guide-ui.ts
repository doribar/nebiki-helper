import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { AdvanceDiscountScreen } from "../src/components/screens/AdvanceDiscountScreen.tsx";
import type { PrimaryButton } from "../src/components/layout/PrimaryButton.tsx";
import { getColdDeliGuide, type ColdDeliGuide } from "../src/domain/coldDeliGuide.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";

// Load the production TSX and its actual local dependencies, as in check-advance-discount-ui.
const componentModules = new Map<string, Record<string, unknown>>();
async function loadComponentModule(url: URL): Promise<Record<string, unknown>> {
  const cached = componentModules.get(url.href);
  if (cached) return cached;
  const source = readFileSync(url, "utf8");
  const ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dependencies = new Map<string, unknown>([
    ["react", React], ["react/jsx-runtime", jsxRuntime],
  ]);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
    const id = statement.moduleSpecifier.text;
    if (dependencies.has(id)) continue;
    assert.ok(id.startsWith("."), "only local component dependencies are expected: " + id);
    const dependencyUrl = [id, id + ".ts", id + ".tsx"]
      .map((candidate) => new URL(candidate, url)).find((candidate) => existsSync(candidate));
    assert.ok(dependencyUrl, "actual component dependency exists: " + id);
    dependencies.set(id, dependencyUrl.pathname.endsWith(".tsx")
      ? await loadComponentModule(dependencyUrl)
      : await import(dependencyUrl.href));
  }
  const exports: Record<string, unknown> = {};
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  // No window, storage, network or document globals: presentation must work without them.
  runInNewContext(output, {
    exports,
    require: (id: string) => {
      assert.ok(dependencies.has(id), "actual dependency was loaded: " + id);
      return dependencies.get(id);
    },
  });
  componentModules.set(url.href, exports);
  return exports;
}

const screenUrl = new URL("../src/components/screens/AdvanceDiscountScreen.tsx", import.meta.url);
const screenModule = await loadComponentModule(screenUrl);
const buttonModule = await loadComponentModule(new URL("../src/components/layout/PrimaryButton.tsx", import.meta.url));
const RuntimeScreen = screenModule.AdvanceDiscountScreen as typeof AdvanceDiscountScreen;
const RuntimePrimaryButton = buttonModule.PrimaryButton as typeof PrimaryButton;
type ScreenElement = React.ReactElement<Record<string, unknown>>;

function elements(node: React.ReactNode): ScreenElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
function nodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return React.isValidElement<Record<string, unknown>>(node)
    ? nodeText(node.props.children as React.ReactNode) : "";
}
function renderScreen(props: Partial<React.ComponentProps<typeof AdvanceDiscountScreen>> = {}) {
  let tree: React.ReactNode = null;
  function CaptureScreen() {
    tree = RuntimeScreen({
      referenceConditionLabel: "夏・金曜日・土曜日・17時", ratePercent: 30, onContinue: () => {}, ...props,
    });
    return tree;
  }
  const markup = renderToStaticMarkup(React.createElement(CaptureScreen));
  return { markup, nodes: elements(tree) };
}
function coldSection(rendered: ReturnType<typeof renderScreen>): ScreenElement {
  const sections = rendered.nodes.filter((node) => node.type === "section" && node.props["aria-label"] === "冷惣菜");
  assert.equal(sections.length, 1, "one independent cold deli section");
  assert.ok(elements(sections[0]).some((node) => node.type === "h2" && nodeText(node) === "冷惣菜"), "visible cold deli heading");
  return sections[0];
}
function instructionLines(rendered: ReturnType<typeof renderScreen>): ScreenElement[] {
  const block = rendered.nodes.find((node) =>
    (node.props.style as React.CSSProperties | undefined)?.display === "grid",
  );
  assert.ok(block, "original instruction block exists");
  return React.Children.toArray(block.props.children as React.ReactNode) as ScreenElement[];
}
function assertOriginalInstruction(rendered: ReturnType<typeof renderScreen>, label: string, rate: number): void {
  const lines = instructionLines(rendered);
  assert.deepEqual(lines.map(nodeText), [
    `${label}を基準に考えて`, "多い商品のうち10個以上ある商品を", `${rate}％で引いてください`,
  ]);
  assert.match(rendered.markup, /font-size:18px;font-weight:700;line-height:1.7/);
  for (const text of ["多い", `${rate}％`]) {
    const emphasis = elements(lines).find((node) => node.type === "span" && nodeText(node) === text);
    assert.ok(emphasis);
    assert.deepEqual({ ...emphasis.props.style as React.CSSProperties }, { color: "#ff0000", fontWeight: 700 });
  }
}
function assertColdContentRestrictions(section: ScreenElement): void {
  const markup = renderToStaticMarkup(section);
  assert.doesNotMatch(markup, /当日切れ|10個以上|[+＋]10\s*[%％]|やや不人気|エリア残数|AreaCount/);
  assert.doesNotMatch(markup, /<(input|textarea|select|button)\b/);
}
type ColdDeliGuide15 = Extract<ColdDeliGuide, { discountTime: "15" }>;
const baselineRates15 = {
  highRatePercent: 20, highFewRatePercent: 15, lowRatePercent: 10, lowFewRatePercent: 5,
};
function assertFifteenGuide(guide: ColdDeliGuide15): void {
  const label = "木曜日・15時";
  const rendered = renderScreen({ referenceConditionLabel: label, coldDeliGuide: Object.freeze(guide) });
  assertOriginalInstruction(rendered, label, 30);
  const section = coldSection(rendered);
  const groups = elements(section).find((node) => (node.props.style as React.CSSProperties | undefined)?.display === "grid");
  assert.ok(groups);
  const pairs = React.Children.toArray(groups.props.children as React.ReactNode) as ScreenElement[];
  assert.deepEqual(pairs.map((pair) =>
    React.Children.toArray(pair.props.children as React.ReactNode).map(nodeText),
  ), [
    [`${guide.highCount}個以上 → ${guide.highRatePercent}%`, `少ないエリア → ${guide.highFewRatePercent}%`],
    [`${guide.lowCount}個 → ${guide.lowRatePercent}%`, `少ないエリア → ${guide.lowFewRatePercent}%`],
  ]);
  assert.equal(nodeText(section), `冷惣菜${guide.highCount}個以上 → ${guide.highRatePercent}%少ないエリア → ${guide.highFewRatePercent}%${guide.lowCount}個 → ${guide.lowRatePercent}%少ないエリア → ${guide.lowFewRatePercent}%`);
  assert.doesNotMatch(renderToStaticMarkup(section), /後回し|すべて|条件|場合|翌日|補正|自分で|足して/);
  assertColdContentRestrictions(section);
}

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

const thresholdCases = [
  { name: "next weekday / adjustment 0", highCount: 2, lowCount: 1 },
  { name: "next weekend or holiday / adjustment 0", highCount: 3, lowCount: 2 },
  { name: "next weekday / adjustment -5", highCount: 3, lowCount: 2 },
  { name: "next weekend or holiday / adjustment -5", highCount: 4, lowCount: 3 },
];
for (const fixture of thresholdCases) {
  test(`15: ${fixture.name} renders concrete supplied thresholds and their separate few-area rates`, () => {
    assertFifteenGuide({ discountTime: "15", highCount: fixture.highCount, lowCount: fixture.lowCount, ...baselineRates15 });
  });
}

// These are already-calculated display props from the requested examples; domain checks verify their calculation.
const rateCases15 = [
  { name: "weather 0 / global 0", highCount: 2, lowCount: 1, rates: [20, 15, 10, 5] },
  { name: "weather +5 / global 0", highCount: 2, lowCount: 1, rates: [25, 20, 15, 10] },
  { name: "weather 0 / global +5", highCount: 2, lowCount: 1, rates: [25, 20, 15, 10] },
  { name: "weather +10 / global +5", highCount: 2, lowCount: 1, rates: [35, 30, 25, 20] },
  { name: "weather +10 / global -5", highCount: 3, lowCount: 2, rates: [30, 25, 20, 15] },
  { name: "weather -10 / global +5", highCount: 2, lowCount: 1, rates: [25, 20, 15, 10] },
  { name: "weather -10 / global -5", highCount: 3, lowCount: 2, rates: [20, 15, 10, 5] },
  { name: "user display example: weather +5 / global +5", highCount: 2, lowCount: 1, rates: [30, 25, 20, 15] },
];
for (const fixture of rateCases15) {
  test(`15: next weekday / ${fixture.name} displays all four supplied final rates`, () => {
    const [highRatePercent, highFewRatePercent, lowRatePercent, lowFewRatePercent] = fixture.rates;
    assertFifteenGuide({
      discountTime: "15", highCount: fixture.highCount, lowCount: fixture.lowCount,
      highRatePercent, highFewRatePercent, lowRatePercent, lowFewRatePercent,
    });
  });
}

const rateCases17 = [
  { name: "weather 0 / global 0", ratePercent: 30 },
  { name: "weather +5 / global 0", ratePercent: 35 },
  { name: "weather 0 / global +5", ratePercent: 35 },
  { name: "user display example: weather +10 / global +5", ratePercent: 45 },
  { name: "weather +10 / global -5", ratePercent: 40 },
  { name: "weather +20 / global +5 capped by helper", ratePercent: 50 },
  { name: "weather +20 / global 0", ratePercent: 50 },
  { name: "weather +20 / global -5", ratePercent: 50 },
  { name: "next holiday / weather -10 / global 0", ratePercent: 25 },
  { name: "next holiday / weather -10 / global -5", ratePercent: 25 },
  { name: "next holiday / weather -10 / global +5", ratePercent: 30 },
  { name: "next holiday / weather -5 / global -5", ratePercent: 25 },
  { name: "next holiday / weather -5 / global 0", ratePercent: 30 },
  { name: "next holiday / weather -5 / global +5", ratePercent: 35 },
  { name: "next weekday / weather -10 / global -5", ratePercent: 30 },
  { name: "next weekday / weather -10 / global +5", ratePercent: 35 },
];
for (const { name, ratePercent } of rateCases17) {
  test(`17: ${name} displays supplied ${ratePercent}% with a timing note and no lower few-area rate`, () => {
    const rendered = renderScreen({ coldDeliGuide: { discountTime: "17", ratePercent } });
    assertOriginalInstruction(rendered, "夏・金曜日・土曜日・17時", 30);
    const section = coldSection(rendered);
    assert.equal(nodeText(section), `冷惣菜すべて → ${ratePercent}%少ないエリア・判断に迷う場合は後回しにしてください。`);
    const note = elements(section).find((node) => node.type === "p");
    assert.ok(note);
    assert.equal(nodeText(note), "少ないエリア・判断に迷う場合は後回しにしてください。");
    assert.doesNotMatch(nodeText(note), /\d|[%％]|→/);
    assert.deepEqual(nodeText(section).match(/\d+[%％]/g), [`${ratePercent}%`]);
    assertColdContentRestrictions(section);
  });
}

test("supplied final 50% and fractional cold deli rates render unchanged without UI arithmetic", () => {
  assertFifteenGuide({
    discountTime: "15", highCount: 3, lowCount: 2,
    highRatePercent: 50, highFewRatePercent: 50, lowRatePercent: 49.5, lowFewRatePercent: 44.5,
  });
  for (const ratePercent of [49.5, 50]) {
    const section = coldSection(renderScreen({ coldDeliGuide: { discountTime: "17", ratePercent } }));
    assert.equal(nodeText(section), `冷惣菜すべて → ${ratePercent}%少ないエリア・判断に迷う場合は後回しにしてください。`);
    assertColdContentRestrictions(section);
  }
});

test("production helper supplies final 50% rates to the unchanged presentation", () => {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const entry of Object.values(hourlyForecasts)) {
    entry.weather = "snow";
    entry.tempC = 25;
    entry.windMs = 2;
  }
  const resolvedWeather = resolveWeatherInputForDiscount({ hourlyForecasts, afterRainSky: null }, "17");
  const session = {
    date: "2026-09-04", weekday: 5, discountTime: "17" as const,
    demandCycle: "normal" as const, globalDiscountAdjustmentPercent: 5 as const,
  };
  const seventeen = getColdDeliGuide({ session, resolvedWeather, isFixedTimeMode: false });
  assert.deepEqual(seventeen, { discountTime: "17", ratePercent: 50 });
  const rendered = renderScreen({ coldDeliGuide: seventeen });
  assertOriginalInstruction(rendered, "夏・金曜日・土曜日・17時", 30);
  assert.equal(nodeText(coldSection(rendered)), "冷惣菜すべて → 50%少ないエリア・判断に迷う場合は後回しにしてください。");
  assert.doesNotMatch(rendered.markup, /55[%％]|上限|キャップ|cap/i);

  // Synthetic resolved weather reaches 15:00 cap boundaries that current real
  // weather (W <= 20) cannot reach; production weather semantics stay unchanged.
  for (const [bonus, rates] of [
    [35.5, [50, 50, 45.5, 40.5]], [45.5, [50, 50, 50, 50]],
  ] as const) {
    const fifteen = getColdDeliGuide({
      session: { ...session, discountTime: "15", globalDiscountAdjustmentPercent: 0 },
      resolvedWeather: { ...resolvedWeather, tempLevel: "28to30", precipitationRateBonus: bonus },
      isFixedTimeMode: false,
    });
    assert.ok(fifteen?.discountTime === "15");
    assert.deepEqual([fifteen.highRatePercent, fifteen.highFewRatePercent,
      fifteen.lowRatePercent, fifteen.lowFewRatePercent], rates);
    assertFifteenGuide(fifteen);
  }
});

test("omitted, undefined and null guide preserve the original screen without an empty cold deli section", () => {
  const original = renderScreen();
  for (const rendered of [original, renderScreen({ coldDeliGuide: undefined }), renderScreen({ coldDeliGuide: null })]) {
    assert.equal(rendered.markup, original.markup);
    assert.doesNotMatch(rendered.markup, /冷惣菜|後回し|<h2\b/);
    assert.equal(rendered.markup.replace(/<[^>]*>/g, ""),
      "夏・金曜日・土曜日・17時を基準に考えて多い商品のうち10個以上ある商品を30％で引いてくださいエリア別値引へ進む");
    assert.equal(rendered.nodes.filter((node) => node.type === "section").length, 1);
  }
});

test("cold deli rates stay independent of the existing supplied advance rate and reference label", () => {
  for (const label of ["木曜日・15時", "夏・木曜日・15時", "日曜日・17時", "夏・日曜日・金曜日・土曜日・中間・17時"]) {
    for (const rate of [0, 5, 30, 50]) {
      for (const guide of [
        { discountTime: "15", highCount: 4, lowCount: 3, ...baselineRates15 },
        { discountTime: "15", highCount: 4, lowCount: 3, highRatePercent: 35, highFewRatePercent: 30, lowRatePercent: 25, lowFewRatePercent: 20 },
        { discountTime: "17", ratePercent: 25 },
        { discountTime: "17", ratePercent: 45 },
      ] satisfies ColdDeliGuide[]) {
        const original = renderScreen({ referenceConditionLabel: label, ratePercent: rate });
        const rendered = renderScreen({ referenceConditionLabel: label, ratePercent: rate, coldDeliGuide: guide });
        assertOriginalInstruction(rendered, label, rate);
        assert.deepEqual(instructionLines(rendered).map((line) => renderToStaticMarkup(line)),
          instructionLines(original).map((line) => renderToStaticMarkup(line)));
        const expected = guide.discountTime === "15"
          ? `冷惣菜4個以上 → ${guide.highRatePercent}%少ないエリア → ${guide.highFewRatePercent}%3個 → ${guide.lowRatePercent}%少ないエリア → ${guide.lowFewRatePercent}%`
          : `冷惣菜すべて → ${guide.ratePercent}%少ないエリア・判断に迷う場合は後回しにしてください。`;
        assert.equal(nodeText(coldSection(rendered)), expected);
      }
    }
  }
});

test("the same single PrimaryButton remains after the cold deli guide and invokes only its existing callback", () => {
  for (const coldDeliGuide of [
    { discountTime: "15", highCount: 2, lowCount: 1, ...baselineRates15 },
    { discountTime: "15", highCount: 2, lowCount: 1, highRatePercent: 35, highFewRatePercent: 30, lowRatePercent: 25, lowFewRatePercent: 20 },
    { discountTime: "17", ratePercent: 30 },
    { discountTime: "17", ratePercent: 45 },
  ] satisfies ColdDeliGuide[]) {
    let continued = 0;
    const onContinue = () => { continued += 1; };
    const rendered = renderScreen({ coldDeliGuide, onContinue });
    assert.equal(continued, 0, "rendering does not advance");
    assert.equal([...rendered.markup.matchAll(/<button\b/g)].length, 1);
    assert.ok(rendered.markup.indexOf("で引いてください") < rendered.markup.indexOf('aria-label="冷惣菜"'));
    assert.ok(rendered.markup.indexOf('aria-label="冷惣菜"') < rendered.markup.indexOf("エリア別値引へ進む"));
    const primary = rendered.nodes.find((node) => node.type === RuntimePrimaryButton);
    assert.ok(primary);
    assert.equal(primary.props.onClick, onContinue);
    const button = RuntimePrimaryButton(primary.props as React.ComponentProps<typeof PrimaryButton>);
    assert.equal(button.type, "button");
    assert.equal(button.props.type, "button");
    assert.equal(button.props.disabled, false);
    assert.equal(nodeText(button), "エリア別値引へ進む");
    const original = renderScreen();
    const originalPrimary = original.nodes.find((node) => node.type === RuntimePrimaryButton);
    assert.ok(originalPrimary);
    assert.equal(renderToStaticMarkup(button), renderToStaticMarkup(RuntimePrimaryButton(originalPrimary.props as React.ComponentProps<typeof PrimaryButton>)));
    button.props.onClick();
    assert.equal(continued, 1);
    button.props.onClick();
    assert.equal(continued, 2);
  }
});

test("cold deli presentation adds no inputs, app state, storage or network dependencies", () => {
  assert.doesNotMatch(readFileSync(screenUrl, "utf8"),
    /\b(?:useState|useReducer|useEffect|useLayoutEffect|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest)\b/);
  for (const coldDeliGuide of [
    { discountTime: "15", highCount: 4, lowCount: 3, ...baselineRates15 },
    { discountTime: "15", highCount: 4, lowCount: 3, highRatePercent: 35, highFewRatePercent: 30, lowRatePercent: 25, lowFewRatePercent: 20 },
    { discountTime: "17", ratePercent: 25 },
    { discountTime: "17", ratePercent: 45 },
  ] satisfies ColdDeliGuide[]) {
    const rendered = renderScreen({ coldDeliGuide });
    assert.doesNotMatch(rendered.markup, /<(input|textarea|select|form)\b|contenteditable|商品名|残数入力/);
    assert.equal(componentModules.size, 2, "only the screen and the existing PrimaryButton are loaded");
  }
});

test("the guide preserves mobile wrapping without fixed sizes or horizontal overflow styles", () => {
  for (const coldDeliGuide of [
    { discountTime: "15", highCount: 4, lowCount: 3, ...baselineRates15 },
    { discountTime: "15", highCount: 4, lowCount: 3, highRatePercent: 35, highFewRatePercent: 30, lowRatePercent: 25, lowFewRatePercent: 20 },
    { discountTime: "17", ratePercent: 30 },
    { discountTime: "17", ratePercent: 45 },
  ] satisfies ColdDeliGuide[]) {
    const rendered = renderScreen({ referenceConditionLabel: "夏・日曜日・金曜日・土曜日・中間・17時", coldDeliGuide });
    const main = rendered.nodes.find((node) => node.type === "main");
    assert.ok(main);
    const style = main.props.style as React.CSSProperties;
    assert.equal(style.maxWidth, 480);
    assert.equal(style.padding, 16);
    assert.equal(style.width, undefined);
    assert.doesNotMatch(rendered.markup, /white-space:nowrap|min-width:[4-9]\d\dpx|height:\d+px|overflow-x:(?:scroll|hidden)/);
    assert.match(rendered.markup, /<button[^>]*style="width:100%;padding:14px 16px/);
  }
});

console.log(`cold deli guide UI checks passed: ${passed}/${passed}`);
