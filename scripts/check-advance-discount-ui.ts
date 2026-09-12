import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { AdvanceDiscountScreen } from "../src/components/screens/AdvanceDiscountScreen.tsx";
import type { DoneScreen } from "../src/components/screens/DoneScreen.tsx";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";
import type { PrimaryButton } from "../src/components/layout/PrimaryButton.tsx";
import {
  formatReferenceConditionLabel,
  getIndividualAmountReferenceContext,
  type IndividualAmountReferenceKind,
} from "../src/domain/weekdayBase.ts";
import type { DemandCycle, DiscountTime } from "../src/domain/types.ts";

// Reuse the actual TSX + React SSR approach from check-area-quick-adjustment.
// Production components and their local dependencies run without UI stubs.
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

const advanceModule = await loadComponentModule(new URL("../src/components/screens/AdvanceDiscountScreen.tsx", import.meta.url));
const doneModule = await loadComponentModule(new URL("../src/components/screens/DoneScreen.tsx", import.meta.url));
const rateModule = await loadComponentModule(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url));
const buttonModule = await loadComponentModule(new URL("../src/components/layout/PrimaryButton.tsx", import.meta.url));
const RuntimeAdvanceScreen = advanceModule.AdvanceDiscountScreen as typeof AdvanceDiscountScreen;
const RuntimeDoneScreen = doneModule.DoneScreen as typeof DoneScreen;
const RuntimeRateScreen = rateModule.RateDisplayScreen as typeof RateDisplayScreen;
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
function renderScreen(render: () => React.ReactNode) {
  let tree: React.ReactNode = null;
  function CaptureScreen() {
    tree = render();
    return tree;
  }
  const markup = renderToStaticMarkup(React.createElement(CaptureScreen));
  return { markup, nodes: elements(tree) };
}
function instructionLines(rendered: ReturnType<typeof renderScreen>): ScreenElement[] {
  const block = rendered.nodes.find((node) =>
    (node.props.style as React.CSSProperties | undefined)?.display === "grid",
  );
  assert.ok(block, "instruction block exists");
  return React.Children.toArray(block.props.children as React.ReactNode) as ScreenElement[];
}
const noop = () => {};
const renderAdvance = (referenceConditionLabel: string, ratePercent = 30, onContinue = noop) =>
  renderScreen(() => RuntimeAdvanceScreen({ referenceConditionLabel, ratePercent, onContinue }));
const renderDone = (props: Partial<React.ComponentProps<typeof DoneScreen>> = {}) =>
  renderScreen(() => RuntimeDoneScreen({ onGoBack: noop, onReturnHome: noop, summaryItems: [], ...props }));

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

type ReferenceCase = {
  name: string;
  date: string;
  weekday: number;
  discountTime: DiscountTime;
  demandCycle: DemandCycle;
  kind: IndividualAmountReferenceKind;
  expected: string;
};
const referenceCases: ReferenceCase[] = [
  { name: "normal 15", date: "2026-09-10", weekday: 4, discountTime: "15", demandCycle: "normal", kind: "actual_weekday", expected: "木曜日・15時" },
  { name: "normal 17", date: "2026-09-10", weekday: 4, discountTime: "17", demandCycle: "normal", kind: "actual_weekday", expected: "木曜日・17時" },
  { name: "summer 15", date: "2026-09-10", weekday: 4, discountTime: "15", demandCycle: "summer", kind: "actual_weekday", expected: "夏・木曜日・15時" },
  { name: "summer 17", date: "2026-09-10", weekday: 4, discountTime: "17", demandCycle: "summer", kind: "actual_weekday", expected: "夏・木曜日・17時" },
  // September 8 is Tuesday; the persisted manual override selects Thursday.
  { name: "normal manual weekday override", date: "2026-09-08", weekday: 4, discountTime: "15", demandCycle: "normal", kind: "actual_weekday", expected: "木曜日・15時" },
  { name: "summer manual weekday override", date: "2026-09-08", weekday: 4, discountTime: "17", demandCycle: "summer", kind: "actual_weekday", expected: "夏・木曜日・17時" },
  { name: "normal holiday", date: "2026-01-01", weekday: 4, discountTime: "15", demandCycle: "normal", kind: "holiday", expected: "日曜日・15時" },
  { name: "summer holiday", date: "2026-01-01", weekday: 4, discountTime: "17", demandCycle: "summer", kind: "holiday", expected: "夏・日曜日・17時" },
  { name: "day before holiday", date: "2026-02-10", weekday: 2, discountTime: "15", demandCycle: "normal", kind: "day_before_holiday", expected: "金曜日・土曜日・15時" },
  { name: "Obon", date: "2026-08-13", weekday: 4, discountTime: "17", demandCycle: "summer", kind: "obon", expected: "夏・日曜日・17時" },
  { name: "normal three day holiday middle", date: "2026-01-11", weekday: 0, discountTime: "17", demandCycle: "normal", kind: "three_day_holiday_middle", expected: "日曜日・金曜日・土曜日・中間・17時" },
  { name: "summer three day holiday middle", date: "2026-01-11", weekday: 0, discountTime: "17", demandCycle: "summer", kind: "three_day_holiday_middle", expected: "夏・日曜日・金曜日・土曜日・中間・17時" },
];

for (const fixture of referenceCases) {
  const reference = getIndividualAmountReferenceContext(fixture);
  assert.equal(reference.kind, fixture.kind, fixture.name);
  const label = formatReferenceConditionLabel({ reference, demandCycle: fixture.demandCycle });
  assert.equal(label, fixture.expected, fixture.name);

  test(`Done ${fixture.name} shows the resolved label even with no summary`, () => {
    const rendered = renderDone({ referenceConditionLabel: label });
    const labelNodes = rendered.nodes.filter((node) => node.props["aria-label"] === "判定の基準");
    assert.equal(labelNodes.length, 1);
    assert.equal(nodeText(labelNodes[0]), fixture.expected);
    assert.ok(rendered.markup.includes(`>${fixture.expected}</div>`));
    assert.ok(rendered.markup.indexOf(fixture.expected) < rendered.markup.indexOf("値引作業は完了です。"));
    assert.doesNotMatch(rendered.markup, /全エリアの値引率/);
  });

  test(`Advance ${fixture.name} renders the three requested instruction blocks`, () => {
    const rendered = renderAdvance(label);
    const lines = instructionLines(rendered);
    assert.deepEqual(lines.map(nodeText), [
      `${fixture.expected}を基準に考えて`,
      "多い商品のうち10個以上ある商品を",
      "30％で引いてください",
    ]);
    for (const line of lines) assert.ok(rendered.markup.includes(renderToStaticMarkup(line)));
    assert.equal([...rendered.markup.matchAll(/<button\b/g)].length, 1);
    assert.match(rendered.markup, />エリア別値引へ進む<\/button>/);
  });
}

for (const rate of [0, 5, 30, 50]) {
  test(`Advance preserves the supplied ${rate} percent including explicit zero`, () => {
    const rendered = renderAdvance("夏・木曜日・17時", rate);
    assert.equal(nodeText(instructionLines(rendered)[2]), `${rate}％で引いてください`);
    assert.match(rendered.markup, new RegExp(`>${rate}％</span>で引いてください`));
    assert.doesNotMatch(rendered.markup, /引かない|値引しない|値引きしない/);
  });
}

test("Advance many and rate use the existing RateDisplay red and bold style", () => {
  const current = renderScreen(() => RuntimeRateScreen({
    weekdayText: "木曜日", timeText: "17時", areaName: "弁当・麺", discountTime: "17",
    basisGuide: { referenceText: "木曜日の17時を基準に考えて", referenceConditionLabel: "木曜日・17時" },
    rateDisplay: { many: { main: "30%" }, normal: { main: "20%" }, few: { main: "10%" } },
    onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop,
  }));
  const currentMany = current.nodes.find((node) => node.type === "span" && nodeText(node) === "多い");
  assert.ok(currentMany);
  const rendered = renderAdvance("木曜日・17時");
  for (const text of ["多い", "30％"]) {
    const emphasis = rendered.nodes.find((node) => node.type === "span" && nodeText(node) === text);
    assert.ok(emphasis);
    assert.deepEqual(
      { ...(emphasis.props.style as React.CSSProperties) },
      { ...(currentMany.props.style as React.CSSProperties) },
    );
    assert.ok(rendered.markup.includes(renderToStaticMarkup(emphasis)));
  }
  assert.match(current.markup, /font-size:18px;font-weight:700;line-height:1.7;color:#ff0000/);
  assert.match(rendered.markup, /font-size:18px;font-weight:700;line-height:1.7/);
});

test("Advance actual PrimaryButton invokes only the supplied continue handler per tap", () => {
  let continued = 0;
  const rendered = renderAdvance("木曜日・17時", 0, () => { continued += 1; });
  assert.equal(continued, 0, "rendering does not advance");
  const primary = rendered.nodes.find((node) => node.type === RuntimePrimaryButton);
  assert.ok(primary);
  const button = RuntimePrimaryButton(primary.props as React.ComponentProps<typeof PrimaryButton>);
  assert.equal(button.type, "button");
  assert.equal(button.props.type, "button");
  assert.equal(button.props.disabled, false);
  assert.equal(nodeText(button), "エリア別値引へ進む");
  assert.ok(rendered.markup.includes(renderToStaticMarkup(button)));
  button.props.onClick();
  assert.equal(continued, 1);
  button.props.onClick();
  assert.equal(continued, 2);
});

test("Advance has no product/count input or additional operational instructions", () => {
  const rendered = renderAdvance("夏・木曜日・17時");
  assert.doesNotMatch(rendered.markup, /<(input|textarea|select)\b|温惣菜|商品名|残数入力|エリア残数|AreaCount/);
  assert.equal(rendered.markup.replace(/<[^>]*>/g, ""),
    "夏・木曜日・17時を基準に考えて多い商品のうち10個以上ある商品を30％で引いてくださいエリア別値引へ進む");
});

test("Advance uses the mobile screen width and allows long resolved labels to wrap", () => {
  const rendered = renderAdvance(referenceCases.at(-1)!.expected);
  const main = rendered.nodes.find((node) => node.type === "main");
  assert.ok(main);
  const style = main.props.style as React.CSSProperties;
  assert.equal(style.maxWidth, 480);
  assert.equal(style.padding, 16);
  assert.equal(style.width, undefined);
  assert.doesNotMatch(rendered.markup, /white-space:nowrap|min-width:[4-9]\d\dpx|height:\d+px/);
  assert.match(rendered.markup, /<button[^>]*style="width:100%;padding:14px 16px/);
});

test("Done without a label remains compatible and adds no empty reference block", () => {
  for (const referenceConditionLabel of [undefined, ""]) {
    const rendered = renderDone({ referenceConditionLabel });
    assert.doesNotMatch(rendered.markup, /aria-label="判定の基準"|undefined|全エリアの値引率/);
    assert.match(rendered.markup, /値引作業は完了です。/);
  }
});

test("Done reference label coexists with the unchanged legacy summary reference and rates", () => {
  const rendered = renderDone({
    referenceConditionLabel: "夏・木曜日・17時",
    referenceText: "木曜日の17時を基準に考えて", timeText: "17時",
    summaryItems: [{ areaId: "bento_men", areaName: "弁当・麺", judgeText: "普通", rateText: "20%", manyRateText: "30%", normalRateText: "20%" }],
  });
  assert.ok(rendered.markup.includes("夏・木曜日・17時"));
  assert.match(rendered.markup, /全エリアの値引率/);
  assert.match(rendered.markup, /<strong>今日の曜日：<\/strong>木曜日/);
  assert.match(rendered.markup, /<strong>値引時刻：<\/strong>17時/);
  assert.match(rendered.markup, /多い → 30%/);
  assert.match(rendered.markup, /どちらでもない → 20%/);
});

test("Done retains back, home and manual 18:30 button handlers with the new label", () => {
  const tapped: string[] = [];
  const rendered = renderDone({
    referenceConditionLabel: "夏・木曜日・17時",
    onGoBack: () => tapped.push("back"), onReturnHome: () => tapped.push("home"),
    onStart1830: () => tapped.push("18:30"),
  });
  assert.deepEqual(tapped, []);
  for (const label of ["戻る", "トップに戻る", "18:30値引を開始"]) {
    const button = rendered.nodes.find((node) => node.type === "button" && nodeText(node) === label);
    assert.ok(button, label);
    (button.props.onClick as () => void)();
  }
  assert.deepEqual(tapped, ["back", "home", "18:30"]);
});

console.log(`advance discount UI checks passed: ${passed}/${passed}`);
