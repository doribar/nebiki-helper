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

function capNormalDiscountRate(rawRate: number): number {
  return Math.min(Math.max(rawRate, 0), 30);
}

function toRateLine(main: string, note?: string): RateLine {
  return note ? { main, note } : { main };
}

function getManyTenOrMoreNote(manyRate: number): string | undefined {
  const tenOrMoreRate = capNormalDiscountRate(manyRate + 10);

  if (tenOrMoreRate === manyRate) {
    return undefined;
  }

  return `多いのうち10個以上は ${tenOrMoreRate}%`;
}

function buildManyNote(manyRate: number): string {
  const notes: string[] = [];
  const tenOrMoreNote = getManyTenOrMoreNote(manyRate);

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
}): RateDisplayData {
  const base = getBaseRate(params.discountTime) + params.weatherBonus;

  let areaAdjustedBase = base;
  if (params.areaJudge === "many") {
    areaAdjustedBase = base + 10;
  } else if (params.areaJudge === "few") {
    areaAdjustedBase = base - 5;
  }

  const manyRate = capNormalDiscountRate(areaAdjustedBase + 10);
  const showSundaySlightlyMany = params.isSunday && params.discountTime === "15";
  const slightlyManyRate = showSundaySlightlyMany
    ? capNormalDiscountRate(areaAdjustedBase + 5)
    : null;
  const normalRate = capNormalDiscountRate(areaAdjustedBase);

  return {
    many: toRateLine(
      manyRate > 0 ? `${manyRate}%` : "引かない",
      buildManyNote(manyRate)
    ),
    slightlyMany:
      showSundaySlightlyMany && slightlyManyRate !== null
        ? slightlyManyRate > 0
          ? toRateLine(`${slightlyManyRate}%`)
          : toRateLine("引かない")
        : undefined,
    few: toRateLine("引かない"),
    normal:
      normalRate > 0 ? toRateLine(`${normalRate}%`) : toRateLine("引かない"),
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
