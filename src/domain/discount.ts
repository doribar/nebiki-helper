import type {
  DiscountTime,
  FinalGuideData,
  RateDisplayData,
  RateLine,
  AreaJudge,
  AreaRateAdjustment,
  WeekdayBaseLabel,
} from "./types";
import {
  addDaysToDateString,
  isJapaneseHolidayOrObserved,
  isJapaneseHolidayOrWeekend,
} from "./japaneseHoliday.ts";

const MAX_DISCOUNT_RATE = 50;

function capAbsoluteDiscountRate(rawRate: number): number {
  return Math.max(0, Math.min(rawRate, MAX_DISCOUNT_RATE));
}

type BasicRateGroup = "friSatSun" | "tueThu" | "monWed";

function isNightDiscountTime(discountTime: DiscountTime): boolean {
  return discountTime === "17" || discountTime === "18" || discountTime === "19" || discountTime === "20";
}

function getBasicRateGroup(params: {
  weekday?: number;
  discountTime: DiscountTime;
  date?: string;
}): BasicRateGroup {
  if (params.date && isJapaneseHolidayOrObserved(params.date)) {
    if (params.discountTime === "15") return "friSatSun";

    if (isNightDiscountTime(params.discountTime)) {
      const nextDate = addDaysToDateString(params.date, 1);
      return isJapaneseHolidayOrWeekend(nextDate) ? "friSatSun" : "tueThu";
    }
  }

  switch (params.weekday) {
    case 1:
    case 3:
      return "monWed";
    case 2:
    case 4:
      return "tueThu";
    case 0:
      return params.discountTime === "15" ? "friSatSun" : "tueThu";
    case 5:
    case 6:
      return "friSatSun";
    default:
      return "tueThu";
  }
}

export function getBaseRate(
  discountTime: DiscountTime,
  params?: { weekday?: number; date?: string }
): number {
  if (discountTime === "20") return 0;

  const group = getBasicRateGroup({
    weekday: params?.weekday,
    date: params?.date,
    discountTime,
  });

  if (group === "friSatSun") {
    switch (discountTime) {
      case "15":
        return 0;
      case "17":
        return 5;
      case "18":
        return 15;
      case "19":
        return 25;
    }
  }

  if (group === "monWed") {
    switch (discountTime) {
      case "15":
        return 5;
      case "17":
        return 15;
      case "18":
        return 25;
      case "19":
        return 35;
    }
  }

  switch (discountTime) {
    case "15":
      return 0;
    case "17":
      return 10;
    case "18":
      return 20;
    case "19":
      return 30;
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


export function getManyPlus5Threshold(_weekdayBase: WeekdayBaseLabel | undefined): number {
  // 曜日基準に関係なく、「多い」の+5%目安は10個以上で固定する。
  return 10;
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
