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

test("1. Step4の注意事項は指定された3項目だけ", () => {
  assert.deepEqual(getTrainingStepConfig("step4").noticeItemIds, [
    "twoLeftNotMany",
    "oneLeftFew",
    "step4TenOrMoreNotAlwaysMany",
  ]);
});

test("2. Step4の新文言が完全一致し、旧文言と削除対象2行を含まない", () => {
  assert.equal(
    STEP4_TEN_OR_MORE_NOTICE_TEXT,
    "10個以上あっても、必ず「多い」になるわけではありません。",
  );
  assert.equal(STEP4_TEN_OR_MORE_NOTICE_TEXT.includes("10個以上あるだけで"), false);
  assert.equal(
    STEP4_TEN_OR_MORE_NOTICE_TEXT.includes("曜日・時刻を基準に「多い」と判断してください。"),
    false,
  );
  assert.equal(
    STEP4_TEN_OR_MORE_NOTICE_TEXT.includes("そのうち10個以上ある商品だけさらに"),
    false,
  );
});

test("3. Step1〜3とStep5以降の注意事項構成は変更しない", () => {
  const expected: Partial<Record<TrainingStep, NoticeItemId[]>> = {
    step1: [],
    step2: ["twoLeftNotMany"],
    step3: ["twoLeftNotMany", "oneLeftFew"],
    step5: [
      "twoLeftNotMany",
      "oneLeftFew",
      "manyTenPlusAfterJudge",
      "steadyStandardMinus",
      "nightSellerMinus",
    ],
    step6: [
      "twoLeftNotMany",
      "oneLeftFew",
      "manyTenPlusAfterJudge",
      "steadyStandardMinus",
      "nightSellerMinus",
      "badAppearancePlus",
      "unpopularPlus",
    ],
    step7: [
      "twoLeftNotMany",
      "oneLeftFew",
      "manyTenPlusAfterJudge",
      "steadyStandardMinus",
      "nightSellerMinus",
      "badAppearancePlus",
      "unpopularPlus",
      "judgeIncludesTrend",
    ],
    step8: [
      "twoLeftNotMany",
      "oneLeftFew",
      "manyTenPlusAfterJudge",
      "steadyStandardMinus",
      "nightSellerMinus",
      "badAppearancePlus",
      "unpopularPlus",
      "judgeIncludesTrend",
      "advertisementTrendMinus",
    ],
  };

  for (const [step, noticeItemIds] of Object.entries(expected)) {
    assert.deepEqual(
      getTrainingStepConfig(step as TrainingStep).noticeItemIds,
      noticeItemIds,
    );
  }
});

test("4. Step4の10個以上商品をさらに+5%にする値引ロジックを維持", () => {
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
  assert.equal(getTrainingStepConfig("step4").showManyThresholdRule, true);
});

test("5. Step4専用注意項目に不要な改行要素を追加しない", () => {
  const source = readFileSync(
    new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("step4TenOrMoreNotAlwaysMany:");
  const end = source.indexOf("},", start);
  const step4NoticeBlock = source.slice(start, end);

  assert.ok(start >= 0);
  assert.ok(end > start);
  assert.ok(step4NoticeBlock.includes("STEP4_TEN_OR_MORE_NOTICE_TEXT"));
  assert.equal(step4NoticeBlock.includes("<br"), false);
});

if (process.exitCode) {
  console.error(`\nStep4注意事項テスト: ${passed}/5件成功`);
} else {
  console.log(`\nStep4注意事項テスト: ${passed}/5件成功`);
}
