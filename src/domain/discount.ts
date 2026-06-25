import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  RateLine,
  AreaJudge,
  AreaRateAdjustment,
  WeekdayBaseLabel,
} from "./types";

const MAX_DISCOUNT_RATE = 50;

function capAbsoluteDiscountRate(rawRate: number): number {
  return Math.max(0, Math.min(rawRate, MAX_DISCOUNT_RATE));
}

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
  if (ignoreTimeRateCap) return capAbsoluteDiscountRate(rawRate);
  return capAbsoluteDiscountRate(Math.min(rawRate, getNormalTimeRateCap(discountTime)));
}

function toRateLine(main: string, note?: string): RateLine {
  return note ? { main, note } : { main };
}


export function getManyPlus5Threshold(weekdayBase: WeekdayBaseLabel | undefined): number {
  switch (weekdayBase) {
    case "月水":
      return 8;
    case "金土":
    case "日": // legacy: 旧「日」基準は現在の金土日相当として扱う
      return 12;
    case "火木":
    default:
      return 10;
  }
}

function getManyThresholdPlus5Note(params: {
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

  const threshold = getManyPlus5Threshold(params.weekdayBase);

  return `多いのうち${threshold}個以上は ${tenOrMoreRate}%`;
}

function buildManyNote(params: {
  manyRate: number;
  discountTime: Exclude<DiscountTime, "20">;
  ignoreTimeRateCap: boolean;
  weekdayBase?: WeekdayBaseLabel;
}): string {
  const notes: string[] = [];

  const tenOrMoreNote = getManyThresholdPlus5Note(params);

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
  weekdayBase?: WeekdayBaseLabel;
  areaRateAdjustment?: AreaRateAdjustment;
}): RateDisplayData {
  const ignoreTimeRateCap = params.ignoreTimeRateCap ?? false;
  const base = getBaseRate(params.discountTime) + params.weatherBonus;

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
