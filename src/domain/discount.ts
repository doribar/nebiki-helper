import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  RateLine,
  AreaJudge,
  AreaRateAdjustment,
  WeekdayBaseLabel,
  ForecastWeatherKind,
} from "./types";
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

function capNormalDiscountRate(
  rawRate: number,
  _discountTime: Exclude<DiscountTime, "20">,
  _ignoreTimeRateCap: boolean
): number {
  // 通常値引も時刻別上限は設けず、絶対上限50%だけで止める。
  return capAbsoluteDiscountRate(rawRate);
}

function toRateLine(main: string, note?: string): RateLine {
  return note ? { main, note } : { main };
}


export function getManyPlus15Threshold(_weekdayBase: WeekdayBaseLabel | undefined): number {
  // 曜日基準に関係なく、「多い」のうち10個以上の+15%目安は10個以上で固定する。
  return 10;
}

function getManyThresholdPlus15Note(params: {
  manyRate: number;
  discountTime: Exclude<DiscountTime, "20">;
  ignoreTimeRateCap: boolean;
  weekdayBase?: WeekdayBaseLabel;
}): string | undefined {
  const tenOrMoreRate = capNormalDiscountRate(
    params.manyRate + 5,
    params.discountTime,
    params.ignoreTimeRateCap
  );

  if (tenOrMoreRate === params.manyRate) {
    return undefined;
  }

  const threshold = getManyPlus15Threshold(params.weekdayBase);

  return `多いのうち${threshold}個以上は ${tenOrMoreRate}%`;
}

function buildManyNote(params: {
  manyRate: number;
  discountTime: Exclude<DiscountTime, "20">;
  ignoreTimeRateCap: boolean;
  weekdayBase?: WeekdayBaseLabel;
}): string {
  const notes: string[] = [];

  const tenOrMoreNote = getManyThresholdPlus15Note(params);

  if (tenOrMoreNote) {
    notes.push(tenOrMoreNote);
  }

  return notes.join("\n\n");
}

export function getNormalTimeRateDisplay(params: {
  discountTime: Exclude<DiscountTime, "20">;
  weekday?: number;
  date?: string;
  weatherBonus: number;
  areaJudge: Exclude<AreaJudge, null>;
  isSunday?: boolean;
  ignoreTimeRateCap?: boolean;
  weekdayBase?: WeekdayBaseLabel;
  areaRateAdjustment?: AreaRateAdjustment;
}): RateDisplayData {
  const ignoreTimeRateCap = params.ignoreTimeRateCap ?? false;
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
        weekdayBase: params.weekdayBase,
      })
    ),
    few: toRateLine("引かない"),
    normal: toRateLine(`${normalRate}%`),
  };
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
    return isStrongCold ? 2 : 1;
  }

  if (isStrongCold) {
    return 2;
  }

  // 暑さによる強い不快は、夜への来店ずれ込みを考慮してB止まり。
  return params.comfortScore >= 1 ? 1 : 0;
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
}): FinalGuideData {
  const baseTier = getBaseFinalDiscountTier(params);
  const tier = applyFridaySaturdayFinalDiscountCorrection({
    tier: baseTier,
    weekday: params.weekday,
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
