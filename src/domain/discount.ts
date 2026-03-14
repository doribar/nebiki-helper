import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  RateLine,
} from "./types";

export function getBaseRate(discountTime: DiscountTime): number {
  switch (discountTime) {
    case "17":
      return 10;
    case "18":
      return 20;
    case "19":
      return 30;
    case "20":
      return 0; // 20時は別処理
  }
}

/**
 * 通常値引の上限
 * 17〜19時は 40% / 50% を使わず 30%で止める
 */
export function capNormalDiscountRate(rawRate: number): number {
  return Math.min(rawRate, 30);
}

/**
 * 通常値引での定番・広告表示値
 *
 * 重要:
 * rawRate が 40%以上なら、定番・広告でも 30%
 * 例:
 * 20 -> 10
 * 30 -> 20
 * 40 -> 30
 * 50 -> 30
 */
export function getRegularAdRateForNormalDiscount(rawRate: number): number {
  if (rawRate >= 40) return 30;
  return Math.max(rawRate - 10, 0);
}

/**
 * 最終値引(20時)での定番・広告表示値
 * 例:
 * 50 -> 40
 * 40 -> 30
 * 30 -> 20
 */
export function getRegularAdRateForFinalDiscount(rawRate: number): number {
  return Math.max(rawRate - 10, 0);
}

export function shouldShowRegularAdSub(
  mainRate: number,
  regularAdRate: number
): boolean {
  return mainRate !== regularAdRate;
}

export function toRateLine(mainRate: number, regularAdRate: number): RateLine {
  if (!shouldShowRegularAdSub(mainRate, regularAdRate)) {
    return { main: `${mainRate}%` };
  }

  return {
    main: `${mainRate}%`,
    sub: `定番・広告 → ${regularAdRate}%`,
  };
}

export function getNormalTimeRateDisplay(params: {
  discountTime: Exclude<DiscountTime, "20">;
  weatherBonus: number;
  areaJudge: "many" | "normal";
}): RateDisplayData {
  const base = getBaseRate(params.discountTime) + params.weatherBonus;
  const areaAdjustedBase = params.areaJudge === "many" ? base + 10 : base;

  // 商品個別がどちらでもない
  const normalRawRate = areaAdjustedBase;
  const normalMainRate = capNormalDiscountRate(normalRawRate);
  const normalRegularAdRate =
    getRegularAdRateForNormalDiscount(normalRawRate);

  // 商品個別が多い
  const manyRawRate = areaAdjustedBase + 10;
  const manyMainRate = capNormalDiscountRate(manyRawRate);
  const manyRegularAdRate =
    getRegularAdRateForNormalDiscount(manyRawRate);

  return {
    many: toRateLine(manyMainRate, manyRegularAdRate),
    few: { main: "引かない" },
    normal: toRateLine(normalMainRate, normalRegularAdRate),
  };
}

export function getConsecutiveManyRateForNormalTime(params: {
  discountTime: Exclude<DiscountTime, "20">;
  weatherBonus: number;
  areaJudge: "many" | "normal";
}): number {
  const base = getBaseRate(params.discountTime) + params.weatherBonus;
  const areaAdjustedBase = params.areaJudge === "many" ? base + 10 : base;

  // 多い +10, 2回連続多い +10
  const rawRate = areaAdjustedBase + 20;
  return capNormalDiscountRate(rawRate);
}

export function getFinalTimeGuide(): FinalGuideData {
  const rate30 = 30;
  const rate40 = 40;
  const rate50 = 50;

  return {
    count1: toRateLine(rate30, getRegularAdRateForFinalDiscount(rate30)),
    count2: toRateLine(rate40, getRegularAdRateForFinalDiscount(rate40)),
    count3OrMore: toRateLine(rate50, getRegularAdRateForFinalDiscount(rate50)),
    few: { main: "引かない" },
  };
}