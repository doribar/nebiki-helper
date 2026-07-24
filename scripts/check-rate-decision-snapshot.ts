import assert from "node:assert/strict";
import {
  buildEarlyNextMinus5RateDecisionSnapshot,
  buildFinalDiscountGuideSnapshot,
  buildLatePlus5RateDecisionSnapshot,
  buildNormalRateDecisionSnapshot,
  normalizeRateDecisionSnapshot,
  parseDisplayRatePercent,
  reconstructFinalGuideFromSnapshot,
  reconstructRateDisplayFromSnapshot,
} from "../src/domain/rateDecisionSnapshot.ts";
import type { ResolvedWeatherInput } from "../src/domain/types.ts";

const resolvedWeather: ResolvedWeatherInput = {
  nearTermWeather: "other",
  hasLaterPrecip: false,
  laterPrecipType: null,
  precipitationRateBonus: 0,
  precipitationRateBonusLabel: null,
  windLevel: "2orLess",
  tempLevel: "21to25",
  weatherPointScore: 0,
  weatherPointShift: 0,
  weatherPointRangeText: null,
  next18TempDropShift: 0,
  next18WindWorsenShift: 0,
  next18WindWorsenKind: null,
  afterRainSky: null,
};

const common = {
  confirmedAt: "2026-07-24T12:00:00.000Z",
  sessionDiscountTime: "17" as const,
  resolvedWeather,
  areaJudge: "normal" as const,
};

assert.equal(parseDisplayRatePercent("30%"), 30);
assert.equal(parseDisplayRatePercent(" 12.5 % "), 12.5);
assert.equal(parseDisplayRatePercent("50%です"), undefined);
assert.equal(parseDisplayRatePercent("51%"), undefined);

const normal = buildNormalRateDecisionSnapshot({
  ...common,
  weatherComfortAdjustmentPercent: 5,
  areaRateAdjustment: 5,
});
assert.equal(normal.calculationMode, "normal");
assert.equal(normal.basicRatePercent, 10);
assert.equal(normal.normalRateBeforeLimitsPercent, 20);
assert.equal(normal.normalRatePercent, 20);
assert.equal(normal.manyRatePercent, 30);
assert.equal(normal.display?.normal.main, "20%");
assert.equal(normal.display?.many.main, "30%");
assert.equal(normal.otherAdjustments.productPolicy.advertisementPercent, -10);
assert.equal(normal.otherAdjustments.productPolicy.advertisementMode, "always");
assert.equal(Object.isFrozen(normal), true);
assert.equal(Object.isFrozen(normal.display), true);

const legacyJudge = buildNormalRateDecisionSnapshot({
  ...common,
  weatherComfortAdjustmentPercent: 0,
  areaJudge: "many",
});
assert.equal(legacyJudge.areaCountAdjustmentPercent, 0);
assert.equal(legacyJudge.legacyAreaJudgeAdjustmentPercent, 10);
assert.equal(legacyJudge.normalRatePercent, 20);

const late = buildLatePlus5RateDecisionSnapshot({
  ...common,
  weatherComfortAdjustmentPercent: 0,
  areaRateAdjustment: 0,
});
assert.equal(late.calculationMode, "late_plus5");
assert.equal(late.lateTimeAdjustmentPercent, 5);
assert.equal(late.normalRatePercent, 15);
assert.equal(late.manyRatePercent, 25);

// 先取り -5% は、通常値を50%へ上限制限した後に適用される。
const early = buildEarlyNextMinus5RateDecisionSnapshot({
  ...common,
  effectiveRateDiscountTime: "19",
  weatherComfortAdjustmentPercent: 15,
  areaRateAdjustment: 5,
});
assert.equal(early.calculationMode, "early_next_minus5");
assert.equal(early.normalRateBeforeLimitsPercent, 50);
assert.equal(early.manyRateBeforeLimitsPercent, 60);
assert.equal(early.normalRateAfterBaseLimitsPercent, 50);
assert.equal(early.manyRateAfterBaseLimitsPercent, 50);
assert.equal(early.normalRatePercent, 45);
assert.equal(early.manyRatePercent, 45);
assert.equal(early.display?.normal.main, "45%");
assert.equal(early.display?.many.main, "45%");

const roundTrip = normalizeRateDecisionSnapshot(
  JSON.parse(JSON.stringify(early)) as unknown,
);
assert.deepEqual(roundTrip, early);
const reconstructed = reconstructRateDisplayFromSnapshot(roundTrip!);
assert.deepEqual(reconstructed, early.display);
assert.notEqual(reconstructed, early.display);

const tamperedRate = JSON.parse(JSON.stringify(early)) as Record<string, unknown>;
tamperedRate.displayedRatePercent = 50;
assert.equal(normalizeRateDecisionSnapshot(tamperedRate), undefined);

const tamperedPolicy = JSON.parse(JSON.stringify(early)) as {
  otherAdjustments: { productPolicy: { advertisementPercent: number } };
};
tamperedPolicy.otherAdjustments.productPolicy.advertisementPercent = 0;
assert.equal(normalizeRateDecisionSnapshot(tamperedPolicy), undefined);

// 旧 raw に完全なスナップショットがなければ、根拠を推測して作らない。
assert.equal(
  normalizeRateDecisionSnapshot({ completedRateText: "30%" }),
  undefined,
);

const finalSnapshot = buildFinalDiscountGuideSnapshot({
  confirmedAt: common.confirmedAt,
  resolvedWeather,
  finalGuide: {
    count1: { main: "40%" },
    count2: { main: "50%" },
    count3OrMore: { main: "50%" },
    score: 1,
    scoreThreshold: 1,
    scoreBreakdown: { weekdayShiftPoints: 0, rateBonusPoints: 1 },
  },
});
assert.equal(finalSnapshot.calculationMode, "final");
assert.equal(finalSnapshot.display, null);
assert.equal(finalSnapshot.displayedRatePercent, 40);
assert.equal(finalSnapshot.displayedManyRatePercent, 50);
assert.equal(reconstructRateDisplayFromSnapshot(finalSnapshot), null);
assert.deepEqual(
  reconstructFinalGuideFromSnapshot(finalSnapshot),
  finalSnapshot.finalGuide,
);
assert.deepEqual(
  normalizeRateDecisionSnapshot(
    JSON.parse(JSON.stringify(finalSnapshot)) as unknown,
  ),
  finalSnapshot,
);

console.log("rate decision snapshot checks passed");
