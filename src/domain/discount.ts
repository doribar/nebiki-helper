import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  RateLine,
  AreaJudge,
  AreaCountEvaluation,
  AreaRateAdjustment,
  ForecastWeatherKind,
  GlobalDiscountAdjustmentPercent,
} from "./types";
import {
  applyGlobalDiscountAdjustmentToDisplay,
  applyGlobalDiscountAdjustmentToRate,
} from "./globalDiscountAdjustment.ts";
const MAX_DISCOUNT_RATE = 50;

function capAbsoluteDiscountRate(rawRate: number): number {
  return Math.max(0, Math.min(rawRate, MAX_DISCOUNT_RATE));
}

export function getBaseRate(
  discountTime: DiscountTime,
  _params?: { weekday?: number; date?: string }
): number {
  // 曜日差はエリア残数判定側で見るため、基本値引率は時刻だけで固定する。
  switch (discountTime) {
    case "15":
      return 0;
    case "17":
      return 10;
    case "18":
      return 20;
    case "19":
      return 30;
    case "20":
      return 0;
  }
}

function toRateLine(main: string, note?: string): RateLine {
  return note ? { main, note } : { main };
}

export type NormalTimeRateParams = {
  discountTime: Exclude<DiscountTime, "20">;
  weekday?: number;
  date?: string;
  weatherBonus: number;
  areaJudge: Exclude<AreaJudge, null>;
  isSunday?: boolean;
  ignoreTimeRateCap?: boolean;
  areaRateAdjustment?: AreaRateAdjustment;
  rateOffsetPercent?: number;
  globalDiscountAdjustmentPercent?: GlobalDiscountAdjustmentPercent;
};

/** Upper limits retain their existing stages; only the lower limit follows global. */
export function calculateNormalRateStages(params: {
  normalRateBeforeLimitsPercent: number;
  manyRateBeforeLimitsPercent: number;
  rateOffsetPercent?: number;
  globalDiscountAdjustmentPercent?: GlobalDiscountAdjustmentPercent;
}) {
  const offset = params.rateOffsetPercent ?? 0;
  const globalOffset = params.globalDiscountAdjustmentPercent ?? 0;
  const normalBefore = params.normalRateBeforeLimitsPercent;
  const manyBefore = params.manyRateBeforeLimitsPercent;
  const normalAfterOffset = Math.min(MAX_DISCOUNT_RATE, normalBefore) + offset;
  const manyAfterOffset = Math.min(MAX_DISCOUNT_RATE, manyBefore) + offset;
  const normalBeforeGlobal = Math.min(MAX_DISCOUNT_RATE, normalAfterOffset);
  const manyBeforeGlobal = Math.min(MAX_DISCOUNT_RATE, manyAfterOffset);
  return {
    normalRateBeforeLimitsPercent: normalBefore,
    manyRateBeforeLimitsPercent: manyBefore,
    // Retain the legacy pre-global visible values separately from signed inputs.
    normalRateAfterBaseLimitsPercent: capAbsoluteDiscountRate(normalBefore),
    manyRateAfterBaseLimitsPercent: capAbsoluteDiscountRate(manyBefore),
    normalRatePercent: capAbsoluteDiscountRate(normalBeforeGlobal),
    manyRatePercent: capAbsoluteDiscountRate(manyBeforeGlobal),
    normalRateBeforeGlobalAdjustmentPercent: normalBeforeGlobal,
    manyRateBeforeGlobalAdjustmentPercent: manyBeforeGlobal,
    displayedNormalRatePercent: applyGlobalDiscountAdjustmentToRate(normalBeforeGlobal, globalOffset),
    displayedManyRatePercent: applyGlobalDiscountAdjustmentToRate(manyBeforeGlobal, globalOffset),
    limits: {
      minimumPercent: 0 as const,
      maximumPercent: 50 as const,
      normalLowerLimitApplied: normalBeforeGlobal + globalOffset < 0,
      normalUpperLimitApplied: normalBefore > MAX_DISCOUNT_RATE ||
        normalAfterOffset > MAX_DISCOUNT_RATE || normalBeforeGlobal + globalOffset > MAX_DISCOUNT_RATE,
      manyLowerLimitApplied: manyBeforeGlobal + globalOffset < 0,
      manyUpperLimitApplied: manyBefore > MAX_DISCOUNT_RATE ||
        manyAfterOffset > MAX_DISCOUNT_RATE || manyBeforeGlobal + globalOffset > MAX_DISCOUNT_RATE,
    },
  };
}

/** Display, Done numbers and new decision snapshots share these signed stages. */
export function getNormalTimeRateCalculation(params: NormalTimeRateParams) {
  const base = getBaseRate(params.discountTime, {
    weekday: params.weekday,
    date: params.date,
  }) + params.weatherBonus;

  let areaAdjustedBase = base + (params.areaRateAdjustment ?? 0);

  // 旧データ・手動判定互換: エリア残数からの5段階補正がない場合だけ、
  // 従来の3段階エリア判定で表示値引率を補正する。
  if (params.areaRateAdjustment === undefined) {
    if (params.areaJudge === "many") {
      areaAdjustedBase = base + 10;
    } else if (params.areaJudge === "few") {
      areaAdjustedBase = base - 5;
    }
  }

  return calculateNormalRateStages({
    normalRateBeforeLimitsPercent: areaAdjustedBase,
    manyRateBeforeLimitsPercent: areaAdjustedBase + 10,
    rateOffsetPercent: params.rateOffsetPercent,
    globalDiscountAdjustmentPercent: params.globalDiscountAdjustmentPercent,
  });
}

/** 表示と同じ計算の数値を返す。Doneの色判定で表示文字列を解析しない。 */
export function getNormalTimeRatePercentages(params: NormalTimeRateParams): {
  manyRatePercent: number;
  normalRatePercent: number;
} {
  const rates = getNormalTimeRateCalculation(params);
  return {
    manyRatePercent: rates.displayedManyRatePercent,
    normalRatePercent: rates.displayedNormalRatePercent,
  };
}

export function getNormalTimeRateDisplay(params: NormalTimeRateParams): RateDisplayData {
  const rates = getNormalTimeRateCalculation(params);
  const display = applyGlobalDiscountAdjustmentToDisplay({
    many: toRateLine(`${rates.manyRatePercent}%`),
    few: toRateLine("引かない"),
    normal: toRateLine(`${rates.normalRatePercent}%`),
  }, params.globalDiscountAdjustmentPercent ?? 0, {
    normalRatePercent: rates.normalRateBeforeGlobalAdjustmentPercent,
    manyRatePercent: rates.manyRateBeforeGlobalAdjustmentPercent,
  });
  return { many: display.many, few: display.few, normal: display.normal };
}

type FinalDiscountTier = 0 | 1 | 2;

function getBaseFinalDiscountTier(params: {
  weather21: ForecastWeatherKind;
  temp21C: number;
  comfortScore: number;
}): FinalDiscountTier {
  if (params.weather21 === "snow") {
    return 2;
  }

  const isStrongCold = params.temp21C <= 15 && params.comfortScore >= 2;

  if (params.weather21 === "rain") {
    // 雨の日は、同じ気温・風でも体感が一段不快になるものとして扱う。
    // 例: 雨なしでは「少し不快」の10℃前後でも、雨なら「不快」相当としてC候補にする。
    const rainAdjustedComfortScore = Math.min(2, params.comfortScore + 1);
    const isRainStrongCold = params.temp21C <= 15 && rainAdjustedComfortScore >= 2;
    return isRainStrongCold ? 2 : 1;
  }

  if (isStrongCold) {
    return 2;
  }

  // 暑さによる強い不快は、夜への来店ずれ込みを考慮してB止まり。
  return params.comfortScore >= 1 ? 1 : 0;
}

function getFinalAreaCountTierShift(
  evaluation: AreaCountEvaluation | undefined,
): -1 | 0 | 1 {
  if (evaluation === "many" || evaluation === "slightly_many") return 1;
  if (evaluation === "few" || evaluation === "slightly_few") return -1;
  return 0;
}

function applyFinalAreaCountCorrection(params: {
  tier: FinalDiscountTier;
  evaluation?: AreaCountEvaluation;
}): FinalDiscountTier {
  const shift = getFinalAreaCountTierShift(params.evaluation);
  return Math.max(0, Math.min(2, params.tier + shift)) as FinalDiscountTier;
}

function reapplyFinalWeatherFloor(params: {
  tier: FinalDiscountTier;
  weather21: ForecastWeatherKind;
}): FinalDiscountTier {
  if (params.weather21 === "snow") return 2;
  if (params.weather21 === "rain") {
    return Math.max(1, params.tier) as FinalDiscountTier;
  }
  return params.tier;
}

function applyFridaySaturdayFinalDiscountCorrection(params: {
  tier: FinalDiscountTier;
  weekday: number;
  weather21: ForecastWeatherKind;
}): FinalDiscountTier {
  const isFridayOrSaturday = params.weekday === 5 || params.weekday === 6;
  if (!isFridayOrSaturday || params.weather21 === "snow") {
    return params.tier;
  }

  if (params.weather21 === "rain") {
    return Math.max(1, params.tier - 1) as FinalDiscountTier;
  }

  return Math.max(0, params.tier - 1) as FinalDiscountTier;
}


export type FinalTimeInstructionStep = {
  subject: string;
  rate: string;
};

export function getFinalTimeInstructionSteps(
  finalGuide: FinalGuideData,
): FinalTimeInstructionStep[] {
  if (finalGuide.score === 2) {
    return [
      { subject: "すべての商品を", rate: finalGuide.count1.main },
    ];
  }

  if (finalGuide.score === 1) {
    return [
      { subject: "2個以上ある商品を", rate: finalGuide.count2.main },
      { subject: "1個の商品を", rate: finalGuide.count1.main },
    ];
  }

  return [
    { subject: "3個以上ある商品を", rate: finalGuide.count3OrMore.main },
    { subject: "2個ある商品を", rate: finalGuide.count2.main },
    { subject: "1個の商品を", rate: finalGuide.count1.main },
  ];
}

export function getFinalTimeGuide(params: {
  weekday: number;
  weather21: ForecastWeatherKind;
  temp21C: number;
  comfortScore: number;
  areaCountEvaluation?: AreaCountEvaluation;
}): FinalGuideData {
  const baseTier = getBaseFinalDiscountTier(params);
  const weekdayCorrectedTier = applyFridaySaturdayFinalDiscountCorrection({
    tier: baseTier,
    weekday: params.weekday,
    weather21: params.weather21,
  });
  const areaCountCorrectedTier = applyFinalAreaCountCorrection({
    tier: weekdayCorrectedTier,
    evaluation: params.areaCountEvaluation,
  });
  const tier = reapplyFinalWeatherFloor({
    tier: areaCountCorrectedTier,
    weather21: params.weather21,
  });

  const rates =
    tier === 2
      ? { count1: "50%", count2: "50%", count3OrMore: "50%" }
      : tier === 1
        ? { count1: "40%", count2: "50%", count3OrMore: "50%" }
        : { count1: "30%", count2: "40%", count3OrMore: "50%" };

  return {
    count1: { main: rates.count1 },
    count2: { main: rates.count2 },
    count3OrMore: { main: rates.count3OrMore },
    score: tier,
    scoreThreshold: 1,
    scoreBreakdown: {
      weekdayShiftPoints: baseTier,
      rateBonusPoints: tier - baseTier,
    },
  };
}
