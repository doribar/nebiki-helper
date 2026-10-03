import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  isBusinessMonth,
  monthFromBusinessDate,
  resolveBusinessMonth,
} from "../src/domain/businessMonth.ts";
import { normalizeDemandCycle } from "../src/domain/demandCycle.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import {
  formatReferenceConditionLabel,
  getBasisGuideDisplay,
  getIndividualAmountReferenceContext,
  getReferenceConditionLabel,
} from "../src/domain/weekdayBase.ts";
import type { DemandCycle, DiscountTime } from "../src/domain/types.ts";
import type { AdvanceDiscountScreen } from "../src/components/screens/AdvanceDiscountScreen.tsx";
import type { AreaJudgeScreen } from "../src/components/screens/AreaJudgeScreen.tsx";
import type { DoneScreen } from "../src/components/screens/DoneScreen.tsx";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";
import type { Review19Screen } from "../src/components/screens/Review19Screen.tsx";

// Load actual production TSX and dependencies, following the established UI checks.
const modules = new Map<string, Record<string, unknown>>();
async function loadComponent(url: URL): Promise<Record<string, unknown>> {
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
    assert.ok(id.startsWith("."), "local component dependency: " + id);
    const target = [id, id + ".ts", id + ".tsx"]
      .map((candidate) => new URL(candidate, url)).find((candidate) => existsSync(candidate));
    assert.ok(target, "actual dependency exists: " + id);
    dependencies.set(id, target.pathname.endsWith(".tsx")
      ? await loadComponent(target) : await import(target.href));
  }
  const exports: Record<string, unknown> = {};
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(output, {
    exports,
    require: (id: string) => {
      assert.ok(dependencies.has(id), "dependency loaded: " + id);
      return dependencies.get(id);
    },
  });
  modules.set(url.href, exports);
  return exports;
}

const Advance = (await loadComponent(new URL("../src/components/screens/AdvanceDiscountScreen.tsx", import.meta.url))).AdvanceDiscountScreen as typeof AdvanceDiscountScreen;
const AreaJudge = (await loadComponent(new URL("../src/components/screens/AreaJudgeScreen.tsx", import.meta.url))).AreaJudgeScreen as typeof AreaJudgeScreen;
const Done = (await loadComponent(new URL("../src/components/screens/DoneScreen.tsx", import.meta.url))).DoneScreen as typeof DoneScreen;
const Rate = (await loadComponent(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url))).RateDisplayScreen as typeof RateDisplayScreen;
const Review19 = (await loadComponent(new URL("../src/components/screens/Review19Screen.tsx", import.meta.url))).Review19Screen as typeof Review19Screen;
const noop = () => {};

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

function guide(date: string, discountTime: DiscountTime, demandCycle: DemandCycle, weekday = 5) {
  return getBasisGuideDisplay({
    date, weekday, discountTime, demandCycle,
    weather: resolveWeatherInputForDiscount({
      hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null,
    }, discountTime),
  });
}

function assertRenderedLabel(markup: string, label: string): void {
  assert.ok(markup.includes(label), `rendered reference contains ${label}`);
  assert.doesNotMatch(markup, /夏・|夏の|undefined月|NaN月/);
}

test("ISO business date validates all calendar months and leap days without timestamps", () => {
  for (let month = 1; month <= 12; month += 1) {
    assert.equal(monthFromBusinessDate(`2026-${String(month).padStart(2, "0")}-18`), month);
  }
  assert.equal(monthFromBusinessDate("2024-02-29"), 2);
  assert.equal(monthFromBusinessDate("2000-02-29"), 2);
  for (const invalid of ["", "2026-1-18", "2026-01-1", "2026-00-18", "2026-13-18", "2026-01-00", "2026-04-31", "2026-02-29", "1900-02-29", "0000-01-01", "2026-10-02T00:00:00Z", " 2026-10-02"]) {
    assert.equal(monthFromBusinessDate(invalid), undefined, invalid);
  }
  for (const value of [0, 13, 1.5, NaN, Infinity, "10", null, undefined]) assert.equal(isBusinessMonth(value), false);
  assert.equal(isBusinessMonth(1), true);
  assert.equal(isBusinessMonth(12), true);
});

test("all 1..12 months use the same prefix for normal and summer, at 15/17/19", () => {
  for (let month = 1; month <= 12; month += 1) {
    const date = `2026-${String(month).padStart(2, "0")}-18`;
    for (const demandCycle of ["normal", "summer"] as const) {
      for (const discountTime of ["15", "17", "19"] as const) {
        const time = discountTime === "19" ? "19時30分" : `${discountTime}時`;
        const display = guide(date, discountTime, demandCycle);
        assert.equal(display.referenceConditionLabel, `${month}月・金曜日・${time}`);
        assert.equal(display.referenceText, `${month}月の金曜日の${time}を基準に考えて`);
        const reviewLabel = getReferenceConditionLabel({ date, weekday: 5, discountTime: "19", demandCycle, displayTimeText: "19時" });
        assert.equal(reviewLabel, `${month}月・金曜日・19時`);
      }
    }
  }
});

for (const month of [1, 5, 7, 8, 9, 10, 12]) {
  for (const discountTime of ["15", "17", "19"] as const) {
    test(`actual UI ${month}月 ${discountTime}: AreaJudge/Rate/Done/Advance/Review19`, () => {
      const date = `2026-${String(month).padStart(2, "0")}-18`;
      const demandCycle = month >= 7 && month <= 9 ? "summer" : "normal";
      const basisGuide = guide(date, discountTime, demandCycle);
      const label = basisGuide.referenceConditionLabel;
      const shared = { weekdayText: "金曜日", timeText: `${discountTime}時`, areaName: "弁当・麺", demandCycle, basisGuide, onGoBack: noop, onReturnHome: noop };
      assertRenderedLabel(renderToStaticMarkup(React.createElement(AreaJudge, {
        ...shared, areaId: "bento_men", calculatorDraftScope: `${date}:${discountTime}`, onJudge: noop, onSkip: noop,
      })), label);
      assertRenderedLabel(renderToStaticMarkup(React.createElement(Rate, {
        ...shared, discountTime, rateDisplay: null, onNextArea: noop, onSkip: noop,
      })), label);
      assertRenderedLabel(renderToStaticMarkup(React.createElement(Done, {
        referenceConditionLabel: label, summaryItems: [], onGoBack: noop, onReturnHome: noop,
      })), label);
      if (discountTime !== "19") {
        assertRenderedLabel(renderToStaticMarkup(React.createElement(Advance, {
          referenceConditionLabel: label, ratePercent: 30, onContinue: noop,
        })), `${label}を基準に考えて`);
      } else {
        const reviewLabel = getReferenceConditionLabel({ date, weekday: 5, discountTime, demandCycle, displayTimeText: "19時" });
        const markup = renderToStaticMarkup(React.createElement(Review19, {
          items: [{ areaId: "bento_men", areaName: "弁当・麺", excluded: false }],
          referenceConditionLabel: reviewLabel, calculatorDraftScope: `${date}:review19`,
          onCompleteArea: noop, onSave: noop, onGoBack: noop, onReturnHome: noop,
        }));
        assertRenderedLabel(markup, `${month}月・金曜日・19時`);
        assert.doesNotMatch(markup, /19時30分/);
      }
    });
  }
}

test("resolved single weekday and weekday group retain their existing grammar/content", () => {
  assert.equal(guide("2026-10-02", "17", "normal").referenceText, "10月の金曜日の17時を基準に考えて");
  for (const discountTime of ["15", "17", "19"] as const) {
    const reference = Object.freeze(getIndividualAmountReferenceContext({ date: "2026-11-02", weekday: 1, discountTime }));
    const original = JSON.stringify(reference);
    assert.equal(reference.referenceWeekdayGroup, "金土");
    const time = discountTime === "19" ? "19時30分" : `${discountTime}時`;
    const label = formatReferenceConditionLabel({ date: "2026-10-02", reference, demandCycle: "summer" });
    assert.equal(label, `10月・金曜日・土曜日・${time}`);
    assert.equal(guide("2026-11-02", discountTime, "normal", 1).referenceText, `11月の金曜日・土曜日の${time}を基準に考えて`);
    if (discountTime !== "19") {
      assertRenderedLabel(renderToStaticMarkup(React.createElement(Advance, {
        referenceConditionLabel: label, ratePercent: 30, onContinue: noop,
      })), label);
    } else {
      const reviewLabel = formatReferenceConditionLabel({ date: "2026-10-02", reference, displayTimeText: "19時" });
      assert.equal(reviewLabel, "10月・金曜日・土曜日・19時");
      assertRenderedLabel(renderToStaticMarkup(React.createElement(Review19, {
        items: [{ areaId: "bento_men", areaName: "弁当・麺", excluded: false }],
        referenceConditionLabel: reviewLabel, calculatorDraftScope: "2026-10-02:review19-group",
        onCompleteArea: noop, onSave: noop, onGoBack: noop, onReturnHome: noop,
      })), reviewLabel);
    }
    assert.equal(JSON.stringify(reference), original, "formatting never rewrites a resolved saved reference");
  }
});

test("manual weekday override and calendar resolution remain authoritative", () => {
  assert.equal(getReferenceConditionLabel({ date: "2026-10-02", weekday: 1, discountTime: "17", demandCycle: "normal" }), "10月・月曜日・17時");
  assert.equal(getReferenceConditionLabel({ date: "2026-08-14", weekday: 5, discountTime: "17", demandCycle: "summer" }), "8月・日曜日・17時");
  assert.equal(getReferenceConditionLabel({ date: "2026-07-19", weekday: 0, discountTime: "17", demandCycle: "summer" }), "7月・日曜日・金曜日・土曜日・中間・17時");
});

test("legacy month fallback uses business date across UTC boundaries and never mutates records", () => {
  for (const record of [
    Object.freeze({ date: "2026-09-14", recordedAt: "2026-10-01T00:00:00.000Z" }),
    Object.freeze({ date: "2026-10-01", recordedAt: "2026-09-30T15:01:00.000Z" }),
  ]) {
    const original = JSON.stringify(record);
    assert.equal(resolveBusinessMonth(record), record.date === "2026-09-14" ? 9 : 10);
    assert.equal(JSON.stringify(record), original);
    assert.equal("businessMonth" in record, false);
  }
  assert.equal(resolveBusinessMonth({ date: "2026-09-14", businessMonth: 8 }), 8);
  assert.equal(resolveBusinessMonth({ date: "2026-09-14", businessMonth: 13 }), 9);
});

test("actual Review19 hook memo and UI use record date when saved reference date differs", () => {
  const hook = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
  const memo = hook.match(/const review19ReferenceLabel = useMemo\(\(\) => \{[\s\S]*?\}, \[state\.review19, applyObonRule\]\);/)?.[0];
  assert.ok(memo, "actual production Review19 label memo found");
  const record = Object.freeze({
    date: "2026-10-02", recordedAt: "2026-09-30T15:01:00.000Z", demandCycle: "normal",
    reference: Object.freeze({ date: "2026-09-30", weekday: 1, demandCycle: "summer" }),
  });
  const label = runInNewContext(`${memo}\nreview19ReferenceLabel`, {
    state: { review19: record }, applyObonRule: true,
    getReferenceConditionLabel, normalizeDemandCycle,
    useMemo: (build: () => unknown) => build(),
  });
  assert.equal(label, "10月・月曜日・19時");
  assertRenderedLabel(renderToStaticMarkup(React.createElement(Review19, {
    items: [{ areaId: "bento_men", areaName: "弁当・麺", excluded: false }],
    referenceConditionLabel: label, calculatorDraftScope: "2026-10-02:legacy-reference",
    onCompleteArea: noop, onSave: noop, onGoBack: noop, onReturnHome: noop,
  })), label);
  assert.equal(record.reference.date, "2026-09-30");
  assert.equal(record.reference.weekday, 1);
});

test("missing or invalid date never borrows the current clock or emits a summer prefix", () => {
  const reference = getIndividualAmountReferenceContext({ weekday: 5, discountTime: "17" });
  for (const date of [undefined, "", "2026-13-02", "2026-02-30"]) {
    assert.equal(formatReferenceConditionLabel({ date, reference, demandCycle: "summer" }), "金曜日・17時");
  }
  const source = readFileSync(new URL("../src/domain/businessMonth.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /new Date|recordedAt|Date\.parse|Date\.now/);
  // Review19 reads the saved reference's date/weekday and keeps the explicit 19:00 display override.
  const hook = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
  assert.match(hook, /const review19ReferenceLabel[\s\S]*?date: state\.review19\?\.date \?\? reference\.date,[\s\S]*?weekday: reference\.weekday,[\s\S]*?displayTimeText: "19時"/);
});

console.log(`\nBusiness month label checks: ${passed}/${passed} PASS`);
