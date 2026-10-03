import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { DoneScreen } from "../src/components/screens/DoneScreen.tsx";
import type { DoneSummaryItem } from "../src/domain/types.ts";

const source = readFileSync(new URL("../src/components/screens/DoneScreen.tsx", import.meta.url), "utf8");
const exports: Record<string, unknown> = {};
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, {
  exports,
  require: (id: string) => {
    assert.equal(id, "react/jsx-runtime");
    return jsxRuntime;
  },
});
const Done = exports.DoneScreen as typeof DoneScreen;
const noop = () => {};
let passed = 0;
function test(name: string, run: () => void): void {
  run(); passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

function item(patch: Partial<DoneSummaryItem> = {}): DoneSummaryItem {
  return {
    areaId: "bento_men", areaName: "弁当・麺", judgeText: "普通", rateText: "20%",
    manyRateText: "30%", normalRateText: "20%", ...patch,
  };
}
function render(summaryItems: DoneSummaryItem[]) {
  return renderToStaticMarkup(React.createElement(Done, {
    referenceConditionLabel: "10月・土曜日・17時", summaryItems,
    onGoBack: noop, onReturnHome: noop, onStart1830: noop,
  }));
}
function line(markup: string, label: "多い" | "どちらでもない") {
  const match = markup.match(new RegExp(`<div style="([^"]*)">${label} → ([^<]*)</div>`));
  assert.ok(match, `actual Done ${label} line exists`);
  return { style: match[1], text: match[2] };
}

for (const [many, normal] of [[30, 20], [5, 5], [50, 50]]) {
  test(`positive numeric ${many}%/${normal}% uses RateDisplay red/green`, () => {
    const markup = render([item({ manyRateText: `${many}%`, normalRateText: `${normal}%`, manyRatePercent: many, normalRatePercent: normal })]);
    assert.match(line(markup, "多い").style, /color:#ff0000(?:;|$)/);
    assert.match(line(markup, "どちらでもない").style, /color:#008000(?:;|$)/);
    assert.equal(line(markup, "多い").text, `${many}%`);
    assert.equal(line(markup, "どちらでもない").text, `${normal}%`);
  });
}

test("numeric 0% keeps both inherited current colors and display text", () => {
  const markup = render([item({ manyRateText: "0%", normalRateText: "0%", manyRatePercent: 0, normalRatePercent: 0 })]);
  for (const label of ["多い", "どちらでもない"] as const) {
    assert.doesNotMatch(line(markup, label).style, /color:/);
    assert.equal(line(markup, label).text, "0%");
  }
});

test("0% and positive lines are colored independently", () => {
  for (const [many, normal] of [[0, 20], [30, 0]]) {
    const markup = render([item({ manyRateText: `${many}%`, normalRateText: `${normal}%`, manyRatePercent: many, normalRatePercent: normal })]);
    assert.equal(line(markup, "多い").style.includes("color:#ff0000"), many > 0);
    assert.equal(line(markup, "どちらでもない").style.includes("color:#008000"), normal > 0);
  }
});

test("legacy numeric absence never parses displayed percentages", () => {
  const markup = render([item()]);
  assert.equal(line(markup, "多い").text, "30%");
  assert.equal(line(markup, "どちらでもない").text, "20%");
  assert.doesNotMatch(line(markup, "多い").style, /color:/);
  assert.doesNotMatch(line(markup, "どちらでもない").style, /color:/);
});

test("invalid numeric values keep existing color", () => {
  for (const value of [NaN, Infinity, -Infinity, -1, "30", null]) {
    const markup = render([item({ manyRatePercent: value as number, normalRatePercent: value as number })]);
    assert.doesNotMatch(line(markup, "多い").style, /color:/);
    assert.doesNotMatch(line(markup, "どちらでもない").style, /color:/);
  }
});

test("non-numeric/final instructions, status, skip and order are preserved", () => {
  const first = item({ manyRateText: "30%・40%・50%", normalRateText: "30%・40%・50%", statusText: "20時30分は最終値引です\n定番商品を確認" });
  const second = item({ areaId: "onigiri", areaName: "おにぎり", rateText: "スキップ済み", manyRatePercent: 30, normalRatePercent: 20, statusText: "今はスキップ" });
  const markup = render([first, second]);
  assert.equal(line(markup, "多い").text, first.manyRateText);
  assert.equal(line(markup, "どちらでもない").text, first.normalRateText);
  assert.doesNotMatch(markup, /color:#ff0000|color:#008000/);
  assert.ok(markup.indexOf("弁当・麺") < markup.indexOf("おにぎり"));
  assert.match(markup, /20時30分は最終値引です\n定番商品を確認/);
  assert.match(markup, /スキップ済み/);
  assert.match(markup, /今はスキップ/);
  assert.match(markup, /18:30値引を開始/);
  assert.match(markup, /10月・土曜日・17時/);
});

test("color changes leave the actual 9-39 Done markup text unchanged", () => {
  const values = [
    item({ manyRatePercent: 30, normalRatePercent: 20, statusText: "完了", note: "既存注記" }),
    item({ areaId: "onigiri", areaName: "おにぎり", manyRateText: "0%", normalRateText: "0%", manyRatePercent: 0, normalRatePercent: 0 }),
    item({ areaId: "inari", areaName: "いなり", rateText: "スキップ済み", statusText: "後回し" }),
    item({ areaId: "tempura", areaName: "天ぷら", manyRateText: "30%・40%・50%", normalRateText: "30%・40%・50%" }),
  ];
  // Captured from the verified 9-39 actual Done component for this fixture.
  // Only the two intentional color styles are removed before comparison.
  const baselineHash = "dae76e149a2ed5920691cc66280cbb9ebe2dbf768039eb2ff4e907c03d5e0190";
  const markup = render(values).replaceAll(/;color:#(?:ff0000|008000)/g, "");
  assert.equal(createHash("sha256").update(markup).digest("hex"), baselineHash);
});

console.log(`Done rate color checks passed: ${passed}/${passed}`);
