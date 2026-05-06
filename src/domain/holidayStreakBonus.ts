import type { AreaId, DiscountTime } from "./types";
import { getHolidayOrWeekendStreakDay } from "./japaneseHoliday.ts";

const HOLIDAY_STREAK_BENTO_BONUS_AREAS = new Set<AreaId>([
  "bento_men",
  "balance_bento",
]);

function isHolidayStreakBonusTime(discountTime: DiscountTime): boolean {
  return discountTime === "17" || discountTime === "18" || discountTime === "19";
}

export function isHolidayStreakBentoBonusArea(areaId: AreaId): boolean {
  return HOLIDAY_STREAK_BENTO_BONUS_AREAS.has(areaId);
}

export function getHolidayStreakBentoBonus(params: {
  date: string;
  discountTime: DiscountTime;
  areaId: AreaId;
}): number {
  if (!isHolidayStreakBonusTime(params.discountTime)) return 0;
  if (!isHolidayStreakBentoBonusArea(params.areaId)) return 0;

  return getHolidayOrWeekendStreakDay(params.date) >= 4 ? 10 : 0;
}

export function getHolidayStreakBentoBonusTerm(params: {
  date: string;
  discountTime: DiscountTime;
  areaId: AreaId;
}): { label: string; value: number } | undefined {
  const value = getHolidayStreakBentoBonus(params);
  if (value === 0) return undefined;

  return {
    label: "土日祝連休4日目以降の弁当系",
    value,
  };
}
