import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  RateLine,
  AreaJudge,
  WeatherInput,
} from "./types";

export function getBaseRate(discountTime: DiscountTime): number {
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

function capNormalDiscountRate(rawRate: number): number {
  return Math.min(Math.max(rawRate, 0), 30);
}

function toRateLine(main: string, note?: string): RateLine {
  return note ? { main, note } : { main };
}

function getRepeatManyNote(params: {
  discountTime: Exclude<DiscountTime, "20">;
  areaJudge: Exclude<AreaJudge, null>;
  manyRate: number;
}): string | undefined {
  const { discountTime, areaJudge, manyRate } = params;

  if (discountTime === "15") return undefined;

  if (areaJudge === "few") {
    if (discountTime === "17" && manyRate === 15) {
      return `前回も多かった商品は
　5個以下 → 15%
　6〜9個 → 20%
　10個以上 → 25%`;
    }

    if (discountTime === "18" && manyRate === 25) {
      return `前回も多かった商品は
　5個以下 → 25%
　6〜9個 → 30%
　10個以上 → 30%`;
    }
  }

  if (manyRate === 20) {
    return `前回も多かった商品は
　5個以下 → 20%
　6〜9個 → 25%
　10個以上 → 30%`;
  }

  if (manyRate === 25) {
    return `前回も多かった商品は
　5個以下 → 25%
　6〜9個 → 25%
　10個以上 → 30%`;
  }

  return undefined;
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
  areaAdjustedBase = base - 5;
}

  const manyRate = capNormalDiscountRate(areaAdjustedBase + 10);
  const normalRate = capNormalDiscountRate(areaAdjustedBase);

  return {
    many:
  manyRate > 0
    ? toRateLine(
        `${manyRate}%`,
        getRepeatManyNote({
          discountTime: params.discountTime,
          areaJudge: params.areaJudge,
          manyRate,
        })
      )
    : toRateLine("引かない"),
    few: toRateLine("引かない"),
    normal:
      normalRate > 0 ? toRateLine(`${normalRate}%`) : toRateLine("引かない"),
  };
}

function shouldLowerFinalTimeRate(weather: WeatherInput): boolean {
  const isNearTermDry = weather.nearTermWeather === "other";
  const isLaterDry = !weather.hasLaterPrecip;
  const isWind4OrLess =
    weather.windLevel === "2orLess" || weather.windLevel === "3to4";
  const isTemp16OrMore =
    weather.tempLevel === "16to25" || weather.tempLevel === "26orMore";

  return isNearTermDry && isLaterDry && isWind4OrLess && isTemp16OrMore;
}

export function getFinalTimeGuide(weather: WeatherInput): FinalGuideData {
  const shouldLower = shouldLowerFinalTimeRate(weather);

  if (shouldLower) {
    return {
      count1: { main: "20%" },
      count2: { main: "30%" },
      count3OrMore: { main: "40%" },
    };
  }

  return {
    count1: { main: "30%" },
    count2: { main: "40%" },
    count3OrMore: { main: "50%" },
  };
}