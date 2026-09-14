import { getBaseRate } from "./discount.ts";
import {
  applyGlobalDiscountAdjustmentToRate,
  normalizeGlobalDiscountAdjustmentPercent,
} from "./globalDiscountAdjustment.ts";
import type { ResolvedWeatherInput, SessionData } from "./types.ts";
import { getWeekdayBaseInfo } from "./weekdayBase.ts";

type AdvanceDiscountSession = Pick<
  SessionData,
  "date" | "weekday" | "discountTime" | "demandCycle" | "globalDiscountAdjustmentPercent"
>;

/**
 * 天候確定後の15時・17時に使う、session共通の先行値引率。
 * 天候は呼び出し側で既存の気温補正を含めて解決した値を受け取る。
 * 商品が多い場合の固定10ポイントを加え、全体補正と共通上限を最後に適用する。
 */
export function getAdvanceDiscountRate(params: {
  session: AdvanceDiscountSession | null;
  resolvedWeather: ResolvedWeatherInput;
  isFixedTimeMode: boolean;
}): number | null {
  const { session } = params;
  if (
    params.isFixedTimeMode ||
    !session ||
    (session.discountTime !== "15" && session.discountTime !== "17")
  ) {
    return null;
  }

  const weatherBonus = getWeekdayBaseInfo(
    session.weekday,
    session.discountTime,
    params.resolvedWeather,
    session.date,
    session.demandCycle,
  ).baseRateBonus;

  return applyGlobalDiscountAdjustmentToRate(
    getBaseRate(session.discountTime) + weatherBonus + 10,
    normalizeGlobalDiscountAdjustmentPercent(
      session.globalDiscountAdjustmentPercent,
    ),
  );
}
