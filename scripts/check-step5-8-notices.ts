import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import {
  getTrainingStepConfig,
  STEP4_TEN_OR_MORE_NOTICE_TEXT,
  type NoticeItemId,
  type TrainingStep,
} from "../src/domain/trainingMode.ts";

let passed = 0;

function test(name: string, run: () => void) {
  try {
    run();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const commonNoticeItemIds: NoticeItemId[] = [
  "twoLeftNotMany",
  "oneLeftFew",
  "step4TenOrMoreNotAlwaysMany",
];

const expectedNoticeItemIds: Record<TrainingStep, NoticeItemId[]> = {
  step1: [],
  step2: ["twoLeftNotMany"],
  step3: ["twoLeftNotMany", "oneLeftFew"],
  step4: commonNoticeItemIds,
  step5: [
    ...commonNoticeItemIds,
    "steadyStandardMinus",
    "nightSellerMinus",
  ],
  step6: [
    ...commonNoticeItemIds,
    "steadyStandardMinus",
    "nightSellerMinus",
    "badAppearancePlus",
    "unpopularPlus",
  ],
  step7: [
    ...commonNoticeItemIds,
    "steadyStandardMinus",
    "nightSellerMinus",
    "badAppearancePlus",
    "unpopularPlus",
    "judgeIncludesTrend",
  ],
  step8: [
    ...commonNoticeItemIds,
    "steadyStandardMinus",
    "nightSellerMinus",
    "badAppearancePlus",
    "unpopularPlus",
    "judgeIncludesTrend",
    "advertisementTrendMinus",
  ],
};

test("1. Step4の注意事項は既存の3項目のまま", () => {
  assert.deepEqual(
    getTrainingStepConfig("step4").noticeItemIds,
    expectedNoticeItemIds.step4,
  );
});

test("2. Step1〜3の注意事項構成を維持", () => {
  for (const step of ["step1", "step2", "step3"] as const) {
    assert.deepEqual(
      getTrainingStepConfig(step).noticeItemIds,
      expectedNoticeItemIds[step],
    );
  }
});

for (const step of ["step5", "step6", "step7", "step8"] as const) {
  test(`${step}. 共通3項目とStep固有項目を正しい順序で表示`, () => {
    const actual = getTrainingStepConfig(step).noticeItemIds;
    assert.deepEqual(actual, expectedNoticeItemIds[step]);
    assert.deepEqual(actual.slice(0, 3), commonNoticeItemIds);
  });
}

test("7. 共通文言は指定文言に一致し、旧共通文言をソースから削除", () => {
  assert.equal(
    STEP4_TEN_OR_MORE_NOTICE_TEXT,
    "10個以上あっても、必ず「多い」になるわけではありません。",
  );

  const trainingModeSource = readFileSync(
    new URL("../src/domain/trainingMode.ts", import.meta.url),
    "utf8",
  );
  const rateDisplaySource = readFileSync(
    new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url),
    "utf8",
  );
  const source = `${trainingModeSource}\n${rateDisplaySource}`;

  for (const oldText of [
    "10個以上あるだけで「多い」になるわけではありません。",
    "曜日・時刻を基準に「多い」と判断してください。",
    "そのうち10個以上ある商品だけさらに",
    "manyTenPlusAfterJudge",
  ]) {
    assert.equal(source.includes(oldText), false, `旧文言・IDが残っています: ${oldText}`);
  }
});

test("8. Step5〜8の固有注意事項と補正値を維持", () => {
  const source = readFileSync(
    new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url),
    "utf8",
  );

  for (const expectedText of [
    "定番商品",
    "夜によく売れる商品",
    "見た目が悪い個別商品",
    "不人気な商品",
    "商品の減り方",
    "広告商品",
    "<strong>-10%</strong>",
    "<strong>+10%</strong>",
  ]) {
    assert.ok(source.includes(expectedText), `固有注意事項がありません: ${expectedText}`);
  }

  for (const step of ["step5", "step6", "step7", "step8"] as const) {
    const config = getTrainingStepConfig(step);
    assert.equal(config.showManyThresholdRule, true);
    assert.equal(config.showFewProductRule, true);
  }
  assert.equal(getTrainingStepConfig("step8").showAdvancedReference, true);
});

test("9. 10個以上商品の+5%計算を維持", () => {
  const display = getNormalTimeRateDisplay({
    discountTime: "17",
    weatherBonus: 0,
    areaJudge: "normal",
    weekdayBase: "火木",
  });
  const manyRate = Number.parseInt(display.many.main, 10);
  const thresholdMatch = display.many.note?.match(/10個以上は\s*(\d+)%/);

  assert.ok(Number.isFinite(manyRate));
  assert.ok(thresholdMatch);
  assert.equal(Number(thresholdMatch[1]), manyRate + 5);
});

if (process.exitCode) {
  console.error(`\nStep5〜8注意事項テスト: ${passed}/9件成功`);
} else {
  console.log(`\nStep5〜8注意事項テスト: ${passed}/9件成功`);
}
