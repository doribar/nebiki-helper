import {
  isDayBeforeJapaneseHoliday,
  isThreeDayHolidayMiddle,
} from "./japaneseHoliday.ts";
import type { TrainingStep } from "./trainingMode.ts";
import type { DiscountTime } from "./types.ts";

export function shouldShowDayBeforeHolidayNotice(params: {
  sessionDate: string;
  discountTime: DiscountTime;
  trainingStep: TrainingStep;
}): boolean {
  return (
    params.trainingStep !== "step1" &&
    isDayBeforeJapaneseHoliday(params.sessionDate) &&
    !isThreeDayHolidayMiddle(params.sessionDate)
  );
}

export function shouldShowThreeDayHolidayMiddleNotice(params: {
  sessionDate: string;
  discountTime: DiscountTime;
  trainingStep: TrainingStep;
}): boolean {
  return (
    params.trainingStep !== "step1" &&
    params.discountTime !== "15" &&
    isThreeDayHolidayMiddle(params.sessionDate)
  );
}
