import {
  isDayBeforeJapaneseHoliday,
  isHolidayBeforeNormalWeekday,
  isJapaneseHolidayOrObserved,
  isThreeDayHolidayMiddle,
} from "./japaneseHoliday.ts";
import type { DiscountTime } from "./types.ts";

export function shouldShowDayBeforeHolidayNotice(params: {
  sessionDate: string;
  discountTime: DiscountTime;
}): boolean {
  return (
    isDayBeforeJapaneseHoliday(params.sessionDate) &&
    !isJapaneseHolidayOrObserved(params.sessionDate) &&
    !isThreeDayHolidayMiddle(params.sessionDate) &&
    !isHolidayBeforeNormalWeekday(params.sessionDate)
  );
}

export function shouldShowHolidayBeforeNormalWeekdayNotice(params: {
  sessionDate: string;
  discountTime: DiscountTime;
}): boolean {
  return (
    !isThreeDayHolidayMiddle(params.sessionDate) &&
    isHolidayBeforeNormalWeekday(params.sessionDate)
  );
}

export function shouldShowThreeDayHolidayMiddleNotice(params: {
  sessionDate: string;
  discountTime: DiscountTime;
}): boolean {
  return (
    params.discountTime !== "15" &&
    isThreeDayHolidayMiddle(params.sessionDate)
  );
}
