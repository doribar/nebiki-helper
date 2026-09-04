import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  formatReferenceConditionLabel,
  getIndividualAmountReferenceContext,
  getReferenceConditionLabel,
} from "../src/domain/weekdayBase.ts";
import {
  canApplyManyToSlightlyManyAdjustment,
  createManyToSlightlyManyAdjustment,
} from "../src/domain/areaEvaluationAdjustment.ts";
import {
  createHumanEvaluationSelection,
  normalizeHumanEvaluationDetails,
  resolveHumanEvaluationForDiscount,
} from "../src/domain/humanEvaluation.ts";
import {
  evaluationToRateAdjustment,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { buildRemoteAreaCountRow } from "../src/domain/areaCountRemoteStorage.ts";
import { applyGlobalDiscountAdjustmentToRate } from "../src/domain/globalDiscountAdjustment.ts";
import type {
  AreaCountEvaluation,
  AreaCountEvaluationSource,
  DemandCycle,
  DiscountTime,
  HumanEvaluationDetails,
} from "../src/domain/types.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(`${projectRoot}/${path}`, "utf8");

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

function label(params: {
  demandCycle: DemandCycle;
  weekday: number;
  discountTime: DiscountTime;
  displayTimeText?: string;
  date?: string;
}): string {
  return getReferenceConditionLabel(params);
}

function canQuick(params: {
  demandCycle: DemandCycle;
  discountTime: DiscountTime;
  automaticEvaluation: AreaCountEvaluation;
  evaluationSource?: AreaCountEvaluationSource;
}): boolean {
  return canApplyManyToSlightlyManyAdjustment(params);
}

function buildAdjustedDetails(): HumanEvaluationDetails {
  const selection = createHumanEvaluationSelection("slightly_many");
  assert.ok(selection);
  return {
    ...resolveHumanEvaluationForDiscount({
      selection,
      demandCycle: "normal",
      sessionDiscountTime: "15",
      nowMs: Date.parse("2026-09-08T06:10:00.000Z"),
      evaluatedAt: "2026-09-08T06:10:00.000Z",
    }),
    automaticEvaluation: "many",
    evaluationAdjustment: createManyToSlightlyManyAdjustment(),
  };
}

test("normal / 火曜 / 15 は火曜日・15時", () => {
  assert.equal(label({ demandCycle: "normal", weekday: 2, discountTime: "15" }), "火曜日・15時");
});

test("normal / 火曜 / 17 は火曜日・17時", () => {
  assert.equal(label({ demandCycle: "normal", weekday: 2, discountTime: "17" }), "火曜日・17時");
});

test("normal / 火曜 / Review19 は火曜日・19時", () => {
  assert.equal(label({ demandCycle: "normal", weekday: 2, discountTime: "19", displayTimeText: "19時" }), "火曜日・19時");
});

test("summer / 火曜 / 15 は夏・火曜日・15時", () => {
  assert.equal(label({ demandCycle: "summer", weekday: 2, discountTime: "15" }), "夏・火曜日・15時");
});

test("summer / 火曜 / 17 は夏・火曜日・17時", () => {
  assert.equal(label({ demandCycle: "summer", weekday: 2, discountTime: "17" }), "夏・火曜日・17時");
});

test("summer / 火曜 / Review19 は夏・火曜日・19時", () => {
  assert.equal(label({ demandCycle: "summer", weekday: 2, discountTime: "19", displayTimeText: "19時" }), "夏・火曜日・19時");
});

test("Review19ラベルに19時30分を表示しない", () => {
  const value = label({ demandCycle: "summer", weekday: 2, discountTime: "19", displayTimeText: "19時" });
  assert.doesNotMatch(value, /19時30分/);
});

test("対象UIに『を基準に考えて』が残らない", () => {
  for (const path of [
    "src/components/screens/AreaJudgeScreen.tsx",
    "src/components/screens/RateDisplayScreen.tsx",
    "src/components/screens/Review19Screen.tsx",
  ]) {
    assert.doesNotMatch(source(path), /を基準に考えて/);
  }
});

test("夏ラベルは『の』を混ぜず中黒で統一", () => {
  const value = label({ demandCycle: "summer", weekday: 2, discountTime: "17" });
  assert.equal(value, "夏・火曜日・17時");
  assert.doesNotMatch(value, /の/);
});

test("祝日は既存参照ロジックが採用する日曜日を表示", () => {
  assert.equal(
    label({ demandCycle: "normal", date: "2026-01-01", weekday: 4, discountTime: "15" }),
    "日曜日・15時",
  );
});

test("formatは解決済み参照曜日を再判定せず利用", () => {
  const reference = getIndividualAmountReferenceContext({ weekday: 4, discountTime: "17" });
  assert.equal(formatReferenceConditionLabel({ demandCycle: "summer", reference }), "夏・木曜日・17時");
});

test("normal 15 / auto many だけquick補正を許可", () => {
  assert.equal(canQuick({ demandCycle: "normal", discountTime: "15", automaticEvaluation: "many", evaluationSource: "history" }), true);
});

test("normal 17 / auto many はquick補正を許可しない", () => {
  assert.equal(canQuick({ demandCycle: "normal", discountTime: "17", automaticEvaluation: "many", evaluationSource: "history" }), false);
});

test("summer 15 / auto many はquick補正を許可", () => {
  assert.equal(canQuick({ demandCycle: "summer", discountTime: "15", automaticEvaluation: "many", evaluationSource: "history" }), true);
});

test("summer 17 / auto many はquick補正を許可", () => {
  assert.equal(canQuick({ demandCycle: "summer", discountTime: "17", automaticEvaluation: "many", evaluationSource: "history" }), true);
});

test("summer 18以降 / auto many はquick補正を許可しない", () => {
  for (const discountTime of ["18", "19", "20"] as const) {
    assert.equal(canQuick({ demandCycle: "summer", discountTime, automaticEvaluation: "many", evaluationSource: "history" }), false);
  }
});

test("auto slightly_many はquick補正を許可しない", () => {
  assert.equal(canQuick({ demandCycle: "summer", discountTime: "15", automaticEvaluation: "slightly_many", evaluationSource: "history" }), false);
});

test("auto normal はquick補正を許可しない", () => {
  assert.equal(canQuick({ demandCycle: "summer", discountTime: "15", automaticEvaluation: "normal", evaluationSource: "history" }), false);
});

test("auto slightly_few はquick補正を許可しない", () => {
  assert.equal(canQuick({ demandCycle: "summer", discountTime: "15", automaticEvaluation: "slightly_few", evaluationSource: "history" }), false);
});

test("auto few はquick補正を許可しない", () => {
  assert.equal(canQuick({ demandCycle: "summer", discountTime: "15", automaticEvaluation: "few", evaluationSource: "history" }), false);
});

test("Review19画面にはquick補正ボタンを配線しない", () => {
  assert.doesNotMatch(source("src/components/screens/Review19Screen.tsx"), /やや多いにする/);
  assert.match(source("src/components/screens/RateDisplayScreen.tsx"), /やや多いにする/);
});

test("quick補正は元auto manyと人間の1段lowerを保存", () => {
  const normalized = normalizeHumanEvaluationDetails(buildAdjustedDetails());
  assert.equal(normalized?.automaticEvaluation, "many");
  assert.deepEqual(normalized?.evaluationAdjustment, {
    applied: true,
    source: "human",
    direction: "lower",
    steps: 1,
    originalEvaluation: "many",
    finalEvaluation: "slightly_many",
  });
});

test("quick補正後のfinalはslightly_many", () => {
  const normalized = normalizeHumanEvaluationDetails(buildAdjustedDetails());
  assert.equal(normalized?.resolvedEvaluation, "slightly_many");
  assert.equal(normalized?.humanEvaluationScore9, 7);
});

test("値引率計算へmany +10ではなくslightly_many +5として接続", () => {
  assert.equal(evaluationToRateAdjustment("many"), 10);
  assert.equal(evaluationToRateAdjustment("slightly_many"), 5);
});

test("全体値引補正は既存最終段でquick補正後rateへ一度だけ作用", () => {
  const baseRate = 20;
  const afterArea = baseRate + evaluationToRateAdjustment("slightly_many");
  assert.equal(afterArea, 25);
  assert.equal(applyGlobalDiscountAdjustmentToRate(afterArea, 5), 30);
  assert.equal(applyGlobalDiscountAdjustmentToRate(afterArea, -5), 20);
});

test("既存フル手動判定selectorは残る", () => {
  const rateScreen = source("src/components/screens/RateDisplayScreen.tsx");
  assert.match(rateScreen, /自動判定を手動で変更/);
  assert.match(rateScreen, /HumanEvaluationSelector/);
});

test("補正なしはhuman agreementとして記録しない", () => {
  const selection = createHumanEvaluationSelection("many");
  assert.ok(selection);
  const details = resolveHumanEvaluationForDiscount({
    selection,
    demandCycle: "normal",
    sessionDiscountTime: "15",
    nowMs: Date.parse("2026-09-08T06:10:00.000Z"),
    evaluatedAt: "2026-09-08T06:10:00.000Z",
  });
  assert.equal(details.evaluationAdjustment, undefined);
});

test("AreaCount normalize / cloud payloadでquick補正metadataを追跡可能", () => {
  const record: AreaCountRecord = {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-19",
    buildId: "build-test-jst",
    demandCycle: "normal",
    date: "2026-09-08",
    sessionStartedAt: "2026-09-08T06:00:00.000Z",
    recordedAt: "2026-09-08T06:10:00.000Z",
    areaId: "bento_men",
    discountTime: "15",
    actualWeekday: "火",
    actualWeekdayGroup: "火木",
    count: 24,
    userJudge: "slightly_many",
    humanEvaluationDetails: buildAdjustedDetails(),
    suggestedEvaluation: "slightly_many",
    areaRateAdjustment: 5,
    evaluationSource: "manual",
    decisionBasis: {
      ruleVersion: "area_count_median_v1",
      demandCycle: "normal",
      evaluationSource: "manual",
      recommendationStatus: "ready",
      actualWeekday: "火",
      actualWeekdayGroup: "火木",
      comparisonMode: "weekday",
      sampleSize: 3,
      requiredSampleSize: 3,
      baseEvaluation: "many",
      finalEvaluation: "slightly_many",
      areaRateAdjustment: 5,
    },
  };
  const normalized = normalizeAreaCountRecords([record]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].humanEvaluationDetails?.evaluationAdjustment?.steps, 1);
  const remote = buildRemoteAreaCountRow(normalized[0]);
  assert.equal(remote.record_details?.humanEvaluationDetails?.evaluationAdjustment?.originalEvaluation, "many");
  assert.match(source("src/hooks/nebikiApp/sessionSnapshots.ts"), /humanEvaluationDetails/);
});

test("新fieldのない過去データもschema 3のまま正常化", () => {
  const legacy = buildAdjustedDetails();
  delete legacy.evaluationAdjustment;
  const normalized = normalizeHumanEvaluationDetails(legacy);
  assert.ok(normalized);
  assert.equal(normalized.evaluationAdjustment, undefined);
});

console.log(`reference label / quick adjustment checks passed: ${passed}/29`);
