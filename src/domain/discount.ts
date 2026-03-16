import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  RateLine,
  AreaJudge,
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
      return 0;
  }
}

function capNormalDiscountRate(rawRate: number): number {
  return Math.min(Math.max(rawRate, 0), 30);
}

function toRateLine(main: string, note?: string): RateLine {
  return note ? { main, note } : { main };
}

export function getNormalTimeRateDisplay(params: {
  discountTime: Exclude<DiscountTime, "20">;
  weatherBonus: number;
  areaJudge: Exclude<AreaJudge, null>;
}): RateDisplayData {
  const base = getBaseRate(params.discountTime) + params.weatherBonus;

  let areaAdjustedBase = base;
  if (params.areaJudge === "many") {
    areaAdjustedBase = base + 10;
  } else if (params.areaJudge === "few") {
    areaAdjustedBase = base - 10;
  }

  const manyRate = capNormalDiscountRate(areaAdjustedBase + 10);
  const normalRate = capNormalDiscountRate(areaAdjustedBase);

  return {
    many: toRateLine(
      `${manyRate}%`,
      manyRate === 20 ? "前回も多かった商品は30%（5個以下の商品には適用しない）" : undefined
    ),
    few: toRateLine("引かない"),
    normal:
      normalRate > 0 ? toRateLine(`${normalRate}%`) : toRateLine("引かない"),
  };
}

export function getFinalTimeGuide(): FinalGuideData {
  return {
    count1: { main: "30%" },
    count2: { main: "40%" },
    count3OrMore: { main: "50%" },
  };
}