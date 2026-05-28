import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  RateLine,
  AreaJudge,
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

function getNormalTimeRateCap(discountTime: Exclude<DiscountTime, "20">): number {
  switch (discountTime) {
    case "15":
      return 20;
    case "17":
    case "18":
      return 30;
    case "19":
      return 40;
  }
}

function capNormalDiscountRate(
  rawRate: number,
  discountTime: Exclude<DiscountTime, "20">,
  ignoreTimeRateCap: boolean
): number {
  if (ignoreTimeRateCap) return rawRate;
  return Math.min(rawRate, getNormalTimeRateCap(discountTime));
}

function toRateLine(main: string, note?: string): RateLine {
  return note ? { main, note } : { main };
}


function getManyTenOrMoreNote(params: {
  manyRate: number;
  discountTime: Exclude<DiscountTime, "20">;
  ignoreTimeRateCap: boolean;
}): string | undefined {
  const tenOrMoreRate = capNormalDiscountRate(
    params.manyRate + 10,
    params.discountTime,
    params.ignoreTimeRateCap
  );

  if (tenOrMoreRate === params.manyRate) {
    return undefined;
  }

  return `多いのうち10個以上は ${tenOrMoreRate}%`;
}

function buildManyNote(params: {
  manyRate: number;
  discountTime: Exclude<DiscountTime, "20">;
  ignoreTimeRateCap: boolean;
}): string {
  const notes: string[] = [];

  const tenOrMoreNote = getManyTenOrMoreNote(params);

  if (tenOrMoreNote) {
    notes.push(tenOrMoreNote);
  }

  return notes.join("\n\n");
}

export function getNormalTimeRateDisplay(params: {
  discountTime: Exclude<DiscountTime, "20">;
  weatherBonus: number;
  areaJudge: Exclude<AreaJudge, null>;
  isSunday?: boolean;
  ignoreTimeRateCap?: boolean;
}): RateDisplayData {
  const ignoreTimeRateCap = params.ignoreTimeRateCap ?? false;
  const base = getBaseRate(params.discountTime) + params.weatherBonus;

  let areaAdjustedBase = base;
  if (params.areaJudge === "many") {
    areaAdjustedBase = base + 10;
  } else if (params.areaJudge === "few") {
    areaAdjustedBase = base - 5;
  }

  const manyRate = capNormalDiscountRate(
    areaAdjustedBase + 10,
    params.discountTime,
    ignoreTimeRateCap
  );
  const normalRate = capNormalDiscountRate(
    areaAdjustedBase,
    params.discountTime,
    ignoreTimeRateCap
  );

  return {
    many: toRateLine(
      `${manyRate}%`,
      buildManyNote({
        manyRate,
        discountTime: params.discountTime,
        ignoreTimeRateCap,
      })
    ),
    few: toRateLine("引かない"),
    normal: toRateLine(`${normalRate}%`),
  };
}

export function getFinalTimeGuide(_params: {
  weekdayShift: number;
  rateBonus: number;
}): FinalGuideData {
  return {
    count1: { main: "30%" },
    count2: { main: "40%" },
    count3OrMore: { main: "50%" },
    score: 0,
    scoreThreshold: 0,
    scoreBreakdown: {
      weekdayShiftPoints: 0,
      rateBonusPoints: 0,
    },
  };
}
