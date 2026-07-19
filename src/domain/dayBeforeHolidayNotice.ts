import { isDayBeforeJapaneseHoliday } from "./japaneseHoliday.ts";
import type { TrainingStep } from "./trainingMode.ts";
import type { DiscountTime } from "./types.ts";

export function shouldShowDayBeforeHolidayNotice(params: {
  sessionDate: string;
  discountTime: DiscountTime;
  trainingStep: TrainingStep;
}): boolean {
  return (
    params.trainingStep !== "step1" &&
    isDayBeforeJapaneseHoliday(params.sessionDate)
  );
}
