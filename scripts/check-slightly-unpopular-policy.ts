import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import { getAdvanceDiscountRate } from "../src/domain/advanceDiscount.ts";
import { getAreaCountSameItemLimit } from "../src/domain/areaCountHistory.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { getFinalTimeGuide } from "../src/domain/discount.ts";
import { FULL_MODE_NOTICE_TEXTS } from "../src/domain/fullMode.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import {
  buildEarlyNextMinus5RateDecisionSnapshot,
  buildFinalDiscountGuideSnapshot,
  buildLatePlus5RateDecisionSnapshot,
  buildNormalRateDecisionSnapshot,
  normalizeRateDecisionSnapshot,
  PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT,
} from "../src/domain/rateDecisionSnapshot.ts";
import { createInitialReview19Result } from "../src/domain/review19.ts";
import { buildAllReview19DataExportPayload } from "../src/domain/separateDataExport.ts";
import type {
  DailySessionSnapshot, FinalGuideData, ProductAdjustmentPolicySnapshot,
  RateDecisionSnapshot, ResolvedWeatherInput, Review19DaySnapshot,
} from "../src/domain/types.ts";
import { normalizeAreaProgressMap } from "../src/hooks/nebikiApp/stateNormalization.ts";

const notice = "やや不人気な商品は、実際に10個以上ある場合のみ表示値引率に+10%。大パックと小パックに分かれている場合は大パックのみ+10%（小パックは補正なし）";
const legacyPolicy = {
  staplePercent: -10, nightSellerPercent: -10, poorAppearancePercent: 10,
  unpopularPercent: 10, advertisementPercent: -10, advertisementMode: "always",
} satisfies ProductAdjustmentPolicySnapshot;
const slightlyUnpopular = {
  adjustmentPercent: 10, minimumActualCount: 10, splitPackTarget: "large_only",
} as const;
const date = "2026-09-24";
const confirmedAt = "2026-09-24T06:00:00.000Z";
const resolvedWeather: ResolvedWeatherInput = {
  nearTermWeather: "other", hasLaterPrecip: false, laterPrecipType: null,
  precipitationRateBonus: 0, precipitationRateBonusLabel: null,
  windLevel: "2orLess", tempLevel: "28to30", weatherPointScore: 0,
  weatherPointShift: 0, weatherPointRangeText: null, next18TempDropShift: 0,
  next18WindWorsenShift: 0, next18WindWorsenKind: null, afterRainSky: null,
};
const common = {
  confirmedAt, sessionDiscountTime: "15", weatherComfortAdjustmentPercent: 0,
  areaJudge: "normal", areaRateAdjustment: 0, resolvedWeather, weekday: 4, date,
} as const;
const finalGuide: FinalGuideData = {
  count1: { main: "30%" }, count2: { main: "40%" }, count3OrMore: { main: "50%" },
  score: 0, scoreThreshold: 1, scoreBreakdown: { weekdayShiftPoints: 0, rateBonusPoints: 0 },
};
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// Fixed v9-29 baseline outputs: none are built from the new policy constant or
// a new snapshot with its field deleted. The historical six-field policy is real input.
function legacySnapshot(mode: RateDecisionSnapshot["calculationMode"]): RateDecisionSnapshot {
  const modes = {
    normal: { session: "15", effective: "15", basic: 0, before: 0, normal: 0, many: 10, late: 0, early: 0 },
    late_plus5: { session: "17", effective: "17", basic: 10, before: 15, normal: 15, many: 25, late: 5, early: 0 },
    early_next_minus5: { session: "17", effective: "18", basic: 20, before: 20, normal: 15, many: 25, late: 0, early: -5 },
    final: { session: "20", effective: "20", basic: 0, before: 30, normal: 30, many: 50, late: 0, early: 0 },
  } as const;
  const fixture = modes[mode];
  const manyBefore = mode === "final" ? 50 : fixture.before + 10;
  return {
    version: 1, dataSchemaVersion: 3, appVersion: "2026.8.9-29", buildId: "build-20260921-202716-jst",
    demandCycle: "normal", confirmedAt, sessionDiscountTime: fixture.session,
    effectiveRateDiscountTime: fixture.effective, calculationMode: mode,
    rateLogicVersion: "time_basic_rate_v1", basicRatePercent: fixture.basic,
    weatherComfortAdjustmentPercent: 0, lateTimeAdjustmentPercent: fixture.late,
    earlyNextAdjustmentPercent: fixture.early, areaCountAdjustmentPercent: 0,
    legacyAreaJudgeAdjustmentPercent: 0, otherAdjustments: { productPolicy: { ...legacyPolicy } },
    normalRateBeforeLimitsPercent: fixture.before, manyRateBeforeLimitsPercent: manyBefore,
    normalRateAfterBaseLimitsPercent: fixture.before, manyRateAfterBaseLimitsPercent: manyBefore,
    normalRatePercent: fixture.normal, manyRatePercent: fixture.many,
    limits: {
      minimumPercent: 0, maximumPercent: 50, normalLowerLimitApplied: false,
      normalUpperLimitApplied: false, manyLowerLimitApplied: false, manyUpperLimitApplied: false,
    },
    displayedRatePercent: fixture.normal, displayedRateText: `${fixture.normal}%`,
    displayedNormalRatePercent: fixture.normal, displayedManyRatePercent: fixture.many,
    display: mode === "final" ? null : {
      many: { main: `${fixture.many}%` }, few: { main: "引かない" }, normal: { main: `${fixture.normal}%` },
    },
    ...(mode === "final" ? { finalGuide: json(finalGuide) } : {}),
    resolvedWeather: json(resolvedWeather),
  };
}

const freshSnapshots = [
  buildNormalRateDecisionSnapshot(common),
  buildLatePlus5RateDecisionSnapshot({ ...common, sessionDiscountTime: "17" }),
  buildEarlyNextMinus5RateDecisionSnapshot({ ...common, sessionDiscountTime: "17", effectiveRateDiscountTime: "18" }),
  buildFinalDiscountGuideSnapshot({ confirmedAt, resolvedWeather, finalGuide }),
];
let passed = 0;
function test(name: string, body: () => void): void {
  body();
  passed += 1;
  console.log(`PASS: ${name}`);
}

test("既存5商品補正を維持し、実数10個以上・+10ポイント・大パックのみを保存", () => {
  assert.deepEqual(PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT, { ...legacyPolicy, slightlyUnpopular });
  assert.equal(Object.isFrozen(PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT), true);
  assert.equal(Object.isFrozen(PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT.slightlyUnpopular), true);
  assert.equal(getCurrentDataVersionInfo().dataSchemaVersion, 3);
});

test("通常・遅延・先取り・20:30の新規snapshotはpolicyとrelease情報以外9-29と一致", () => {
  assert.deepEqual(getFinalTimeGuide({ weekday: 4, weather21: "sunny", temp21C: 28, comfortScore: 0 }), finalGuide);
  for (const fresh of freshSnapshots) {
    const expected = legacySnapshot(fresh.calculationMode);
    Object.assign(expected, getCurrentDataVersionInfo());
    expected.otherAdjustments.productPolicy.slightlyUnpopular = { ...slightlyUnpopular };
    assert.deepEqual(fresh, expected, fresh.calculationMode);
    assert.equal(Object.isFrozen(fresh.otherAdjustments.productPolicy.slightlyUnpopular), true);
    assert.notEqual(fresh.otherAdjustments.productPolicy.slightlyUnpopular, PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT.slightlyUnpopular);
  }
  assert.equal(new Set(freshSnapshots.map((value) => value.otherAdjustments.productPolicy.slightlyUnpopular)).size, 4);
});

test("新規policyを独立cloneしfreeze、読込元の変更から確定値を保護", () => {
  for (const fresh of freshSnapshots) {
    const raw = json(fresh);
    const normalized = normalizeRateDecisionSnapshot(raw);
    assert.ok(normalized);
    assert.deepEqual(normalized, fresh);
    assert.notEqual(normalized.otherAdjustments.productPolicy, raw.otherAdjustments.productPolicy);
    assert.notEqual(normalized.otherAdjustments.productPolicy.slightlyUnpopular, raw.otherAdjustments.productPolicy.slightlyUnpopular);
    assert.equal(Object.isFrozen(normalized.otherAdjustments.productPolicy.slightlyUnpopular), true);
    assert.equal(Object.isFrozen(raw.otherAdjustments.productPolicy.slightlyUnpopular), false);
    delete raw.otherAdjustments.productPolicy.slightlyUnpopular;
    assert.deepEqual(normalized.otherAdjustments.productPolicy.slightlyUnpopular, slightlyUnpopular);
  }
});

test("4モードの旧snapshotを再計算せず復元し、欠損policyを遡及追加しない", () => {
  for (const { calculationMode } of freshSnapshots) {
    const raw = legacySnapshot(calculationMode);
    const before = JSON.stringify(raw);
    const normalized = normalizeRateDecisionSnapshot(raw);
    assert.ok(normalized);
    assert.deepEqual(normalized, raw);
    assert.equal(Object.hasOwn(normalized.otherAdjustments.productPolicy, "slightlyUnpopular"), false);
    assert.equal(Object.isFrozen(normalized.otherAdjustments.productPolicy), true);
    assert.notEqual(normalized.otherAdjustments.productPolicy, raw.otherAdjustments.productPolicy);
    assert.equal(JSON.stringify(raw), before);
  }
});

test("不正な新policyは拒否し、undefinedは従来のoptional field同様に欠損扱い", () => {
  const malformed: unknown[] = [null, [], "10", {},
    { ...slightlyUnpopular, adjustmentPercent: 5 },
    { ...slightlyUnpopular, minimumActualCount: 9 },
    { ...slightlyUnpopular, minimumActualCount: "10" },
    { ...slightlyUnpopular, splitPackTarget: "all" },
    { adjustmentPercent: 10, minimumActualCount: 10 },
  ];
  for (const extension of malformed) {
    const raw = legacySnapshot("normal");
    Object.assign(raw.otherAdjustments.productPolicy, { slightlyUnpopular: extension });
    const before = JSON.stringify(raw);
    assert.equal(normalizeRateDecisionSnapshot(raw), undefined, JSON.stringify(extension));
    assert.equal(JSON.stringify(raw), before);
  }
  const optionalMissing = legacySnapshot("normal");
  Object.assign(optionalMissing.otherAdjustments.productPolicy, { slightlyUnpopular: undefined });
  assert.equal(Object.hasOwn(normalizeRateDecisionSnapshot(optionalMissing)!.otherAdjustments.productPolicy, "slightlyUnpopular"), false);
  const invalidOldPolicy = json(freshSnapshots[0]);
  Object.assign(invalidOldPolicy.otherAdjustments.productPolicy, { unpopularPercent: 0 });
  assert.equal(normalizeRateDecisionSnapshot(invalidOldPolicy), undefined);
});

test("実際のstate normalizerは新旧policyを保持しsnapshot欠損recordを作り替えない", () => {
  for (const snapshot of [legacySnapshot("normal"), freshSnapshots[0]]) {
    const restored = normalizeAreaProgressMap({ bento_men: {
      areaId: "bento_men", status: "completed", areaJudge: "normal",
      completedRateText: snapshot.displayedRateText, rateDecisionSnapshot: json(snapshot),
      rateDecisionSnapshotStatus: "captured",
    } });
    assert.deepEqual(restored.bento_men.rateDecisionSnapshot, snapshot);
  }
  const restored = normalizeAreaProgressMap({ bento_men: {
    areaId: "bento_men", status: "completed", areaJudge: "normal", completedRateText: "25%",
  } });
  assert.equal(restored.bento_men.rateDecisionSnapshot, undefined);
  assert.equal(restored.bento_men.rateDecisionSnapshotStatus, "legacy_not_captured");
  assert.equal(restored.bento_men.completedRateText, "25%");
});

function dayWithSnapshot(snapshot: RateDecisionSnapshot): Review19DaySnapshot {
  const areas = Object.fromEntries(NORMAL_ROUTE.map((areaId) => [areaId, {
    areaId, areaName: areaId, status: "completed", areaJudge: "normal", judgeText: "普通",
    rateText: snapshot.displayedRateText, completedAt: confirmedAt,
    rateDecisionSnapshot: json(snapshot), rateDecisionSnapshotStatus: "captured",
  }])) as DailySessionSnapshot["areas"];
  return {
    version: 1, capturedAt: confirmedAt, date, review19Status: "recorded", areaCountRecords: [],
    sessions: [{
      version: 1, capturedAt: confirmedAt, screen: "done",
      session: {
        date, weekday: 4, discountTime: snapshot.sessionDiscountTime, startedAt: confirmedAt,
        manualWeekdayOverride: false, manualDiscountTimeOverride: false,
        weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null }, resolvedWeather,
      },
      basis: { baseRateBonus: 0, lateTimeBonus: 0, totalRateBonus: 0, baseRateBonusReason: [] },
      areas, doneSummaryItems: [], currentAreaId: null, review19ExcludedAreaIds: [],
    }],
  };
}

test("Review19の実export builderとJSON往復が4モードの新旧snapshotを保持", () => {
  for (const fresh of freshSnapshots) {
    for (const snapshot of [legacySnapshot(fresh.calculationMode), fresh]) {
      const record = createInitialReview19Result({ date, sessionStartedAt: confirmedAt });
      record.daySnapshot = dayWithSnapshot(snapshot);
      const before = JSON.stringify(record);
      const payload = json(buildAllReview19DataExportPayload({ records: [record], exportedAt: confirmedAt }));
      assert.equal(payload.dataSchemaVersion, 3);
      const exported = payload.records[0].daySnapshot?.sessions[0].areas.bento_men.rateDecisionSnapshot;
      assert.deepEqual(exported, snapshot);
      assert.equal(JSON.stringify(record), before);
    }
  }
});

test("注意事項は旧5文言・順序を維持し条件付き補正だけを独立追加", () => {
  assert.deepEqual(FULL_MODE_NOTICE_TEXTS, [
    "残り2個の商品は「多い」にしない", "残り1個の商品は「少ない」にする",
    "定番商品・夜によく売れる商品・広告商品は、表示値引率から-10%",
    "見た目が悪い個別商品・不人気な商品は、表示値引率に+10%", notice,
    "多い・少ないの判断は、残り数だけでなく商品の減り方も含める",
  ]);
});

test("エリア同商品10個capと先行率は商品補正policyに依存しない", () => {
  for (const demandCycle of ["normal", "summer"] as const) {
    for (const discountTime of ["15", "17"] as const) {
      assert.equal(getAreaCountSameItemLimit({ weekday: 4, discountTime }), 10);
      const session = { date, weekday: 4, discountTime, demandCycle, globalDiscountAdjustmentPercent: 0 as const };
      // Poison extra product inputs: the real advance function must not read them.
      for (const field of ["productPolicy", "slightlyUnpopular", "actualCount", "packSize"]) {
        Object.defineProperty(session, field, { get() { throw new Error(`Unexpected product input: ${field}`); } });
      }
      assert.equal(getAdvanceDiscountRate({ session, resolvedWeather, isFixedTimeMode: false }), discountTime === "15" ? 10 : 20);
      assert.equal(getAdvanceDiscountRate({ session, resolvedWeather, isFixedTimeMode: true }), null);
    }
  }
});

// Existing actual-TSX React SSR harness; production components/dependencies, no UI stubs.
const componentModules = new Map<string, Record<string, unknown>>();
async function loadComponentModule(url: URL): Promise<Record<string, unknown>> {
  const cached = componentModules.get(url.href);
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
    const dependency = [id, id + ".ts", id + ".tsx"].map((path) => new URL(path, url)).find((candidate) => existsSync(candidate));
    assert.ok(dependency);
    dependencies.set(id, dependency.pathname.endsWith(".tsx") ? await loadComponentModule(dependency) : await import(dependency.href));
  }
  const exports: Record<string, unknown> = {};
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(output, { exports, require: (id: string) => {
    assert.ok(dependencies.has(id));
    return dependencies.get(id);
  } });
  componentModules.set(url.href, exports);
  return exports;
}
const RuntimeRateScreen = (await loadComponentModule(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url))).RateDisplayScreen as typeof RateDisplayScreen;
const noop = () => undefined;
test("実RateDisplayScreenの通常/夏に新しい注意を表示し、20:30の非表示を維持", () => {
  for (const demandCycle of ["normal", "summer"] as const) {
    for (const discountTime of ["15", "17", "18", "19", "20"] as const) {
      const markup = renderToStaticMarkup(React.createElement(RuntimeRateScreen, {
        weekdayText: "木曜日", timeText: discountTime === "15" ? "15時" : "20時30分", areaName: "弁当・麺",
        demandCycle, discountTime, rateDisplay: freshSnapshots[0].display, finalGuide,
        basisGuide: { referenceText: "木曜日を基準", referenceConditionLabel: "木曜日・15時" },
        onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop,
      }));
      const text = markup.replace(/<[^>]*>/g, "");
      if (discountTime === "20") {
        assert.equal(text.includes("注意事項"), false);
        assert.equal(text.includes(notice), false);
        continue;
      }
      assert.equal(text.split(notice).length - 1, 1);
      assert.match(markup, /<strong>10個以上<\/strong>/);
      assert.match(markup, /<strong>大パックのみ\+10%<\/strong>/);
      assert.ok(text.indexOf(FULL_MODE_NOTICE_TEXTS[3]) < text.indexOf(notice));
    }
  }
});

console.log(`\nやや不人気の商品補正回帰テスト: ${passed}/10件成功`);
