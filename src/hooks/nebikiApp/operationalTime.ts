import type { AppState } from "../../domain/types.ts";
import type {
  getEarlyNextMinus5TargetDiscountTime,
  shouldReserveEarlyNextMinus5OnAutoTransition,
} from "../../domain/earlyNextMinus5.ts";
import { resolveDiscountTime } from "./clock.ts";

/** 新しい通常操作では夜値引率の先取りを行わない。旧pure helperは過去計算互換に残す。 */
export function getOperationalEarlyNextMinus5TargetDiscountTime(
  params: Parameters<typeof getEarlyNextMinus5TargetDiscountTime>[0],
): ReturnType<typeof getEarlyNextMinus5TargetDiscountTime> {
  void params;
  return null;
}

/** 通常操作から夜の次枠skipを新規予約しない。保存済み予約の互換読込は別境界で保持する。 */
export function shouldReserveOperationalEarlyNextMinus5OnAutoTransition(
  params: Parameters<typeof shouldReserveEarlyNextMinus5OnAutoTransition>[0],
): boolean {
  void params;
  return false;
}

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
