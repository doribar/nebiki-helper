import { normalizeGlobalDiscountAdjustmentPercent } from "./globalDiscountAdjustment.ts";
import {
  addDaysToDateString,
  isJapaneseHolidayOrWeekend,
} from "./japaneseHoliday.ts";
import type { ResolvedWeatherInput, SessionData } from "./types.ts";
import { getWeekdayBaseInfo } from "./weekdayBase.ts";

export type ColdDeliGuide =
  | {
      discountTime: "15";
      highCount: number;
      lowCount: number;
      highRatePercent: number;
      highFewRatePercent: number;
      lowRatePercent: number;
      lowFewRatePercent: number;
    }
  | { discountTime: "17"; ratePercent: number };

type ColdDeliGuideSession = Pick<
  SessionData,
  "date" | "weekday" | "discountTime" | "demandCycle" | "globalDiscountAdjustmentPercent"
>;

/** 先行値引画面専用の冷惣菜ガイド。商品数の判定や通常値引率への加算は行わない。 */
export function getColdDeliGuide(params: {
  session: ColdDeliGuideSession | null;
  resolvedWeather: ResolvedWeatherInput;
  isFixedTimeMode: boolean;
}): ColdDeliGuide | null {
  const { session } = params;
  if (
    params.isFixedTimeMode ||
    !session ||
    (session.discountTime !== "15" && session.discountTime !== "17")
  ) {
    return null;
  }

  // 手動変更された曜日やお盆の需要区分ではなく、実日付の翌日を使う。
  const nextDayIsHolidayOrWeekend = isJapaneseHolidayOrWeekend(
    addDaysToDateString(session.date, 1),
  );
  // 先行値引と同じ、気温補正snapshotを含む解決済み天候から既存補正を得る。
  const weatherBonus = getWeekdayBaseInfo(
    session.weekday,
    session.discountTime,
    params.resolvedWeather,
    session.date,
    session.demandCycle,
  ).baseRateBonus;
  const globalAdjustment = normalizeGlobalDiscountAdjustmentPercent(
    session.globalDiscountAdjustmentPercent,
  );
  const hasMinusFiveAdjustment = globalAdjustment === -5;
  // マイナス分は独自ルールの判定だけに使い、プラス分を別々に上乗せする。
  const additionalRate = Math.max(weatherBonus, 0) + Math.max(globalAdjustment, 0);

  if (session.discountTime === "15") {
    const highCount =
      2 + Number(nextDayIsHolidayOrWeekend) + Number(hasMinusFiveAdjustment);
    return {
      discountTime: "15",
      highCount,
      lowCount: highCount - 1,
      highRatePercent: Math.min(50, 20 + additionalRate),
      highFewRatePercent: Math.min(50, 15 + additionalRate),
      lowRatePercent: Math.min(50, 10 + additionalRate),
      lowFewRatePercent: Math.min(50, 5 + additionalRate),
    };
  }

  const useTwentyFivePercent =
    nextDayIsHolidayOrWeekend &&
    (weatherBonus === -10 || (weatherBonus === -5 && hasMinusFiveAdjustment));

  return {
    discountTime: "17",
    ratePercent: Math.min(50, (useTwentyFivePercent ? 25 : 30) + additionalRate),
  };
}
