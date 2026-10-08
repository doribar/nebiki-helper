import type { AppState } from "../../domain/types.ts";
import { resolveDiscountTime } from "./clock.ts";

/** Retire the old time picker only at operational restore boundaries.
 * Historical/session snapshot normalization must continue to preserve its data.
 */
export function retireManualDiscountTimeOverride(
  state: AppState,
  params: { now: Date; fixedTime?: boolean },
): AppState {
  if (params.fixedTime || state.screen === "done" || state.screen.startsWith("review19")) {
    return state;
  }
  const draft = state.sessionDraft;
  if (!draft.manualDiscountTimeOverride && !state.session?.manualDiscountTimeOverride) {
    return state;
  }
  return {
    ...state,
    session: state.session?.manualDiscountTimeOverride
      ? { ...state.session, manualDiscountTimeOverride: false }
      : state.session,
    sessionDraft: {
      ...draft,
      manualDiscountTimeOverride: false,
      // An in-progress session keeps its identity. An unstarted legacy manual
      // draft uses the clock unless weather input already has a legitimate lock.
      discountTime: !state.session && draft.manualDiscountTimeOverride
        ? draft.weatherInputLockedDiscountTime ?? resolveDiscountTime(params.now)
        : draft.discountTime,
    },
  };
}
