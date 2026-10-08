import type { AppState, SessionDraft } from "../../domain/types.ts";
import { getCalendarWeekday } from "../../domain/japaneseHoliday.ts";
import { formatLocalDate } from "./clock.ts";

/** Only operational drafts opt in; historical normalization keeps legacy data. */
export function retireManualWeekdayDraft<T extends SessionDraft>(
  draft: T,
  params: { fixedTime?: boolean } = {},
): T {
  if (params.fixedTime || !draft.manualWeekdayOverride) return draft;
  return {
    ...draft,
    weekday: getCalendarWeekday(draft.date) ?? draft.weekday,
    manualWeekdayOverride: false,
  };
}

/** Keep the business date and completed evidence when retiring an old override. */
export function retireManualWeekdayOverride(
  state: AppState,
  params: { now: Date; fixedTime?: boolean },
): AppState {
  if (params.fixedTime || state.screen === "done" || state.screen.startsWith("review19")) {
    return state;
  }
  if (!state.sessionDraft.manualWeekdayOverride && !state.session?.manualWeekdayOverride) {
    return state;
  }
  const draft = state.sessionDraft;
  const draftDate = !state.session ? formatLocalDate(params.now) : draft.date;
  const operationalDraft = {
    ...draft,
    date: draftDate,
    weekday: getCalendarWeekday(draftDate) ?? draft.weekday,
    manualWeekdayOverride: false,
    weatherInputLockedDiscountTime: draftDate === draft.date
      ? draft.weatherInputLockedDiscountTime : null,
  };
  return {
    ...state,
    session: state.session ? retireManualWeekdayDraft(state.session) : null,
    sessionDraft: operationalDraft,
  };
}
