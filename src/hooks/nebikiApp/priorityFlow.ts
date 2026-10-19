import type { AppState, AreaId, PriorityReturnContext, SessionData } from "../../domain/types.ts";
import { isAreaActiveForCurrentWork, isKnownAreaId } from "../../domain/area.ts";

/** Context belongs to one original session; no queue or copied evaluation. */
export function normalizePriorityReturnContext(
  raw: unknown,
  session: SessionData | null,
): PriorityReturnContext | undefined {
  if (!raw || typeof raw !== "object" || !session) return undefined;
  const value = raw as Partial<PriorityReturnContext>;
  if (value.sessionStartedAt !== session.startedAt || value.sessionDate !== session.date ||
    value.sessionDiscountTime !== session.discountTime ||
    !(value.normalResumeAreaId === null || isKnownAreaId(value.normalResumeAreaId))) return undefined;
  return {
    sessionStartedAt: session.startedAt,
    sessionDate: session.date,
    sessionDiscountTime: session.discountTime,
    normalResumeAreaId: value.normalResumeAreaId && isAreaActiveForCurrentWork(value.normalResumeAreaId)
      ? value.normalResumeAreaId : null,
  };
}

export function createPriorityReturnContext(state: AppState, normalResumeAreaId: AreaId | null): PriorityReturnContext | undefined {
  if (!state.session) return undefined;
  return {
    sessionStartedAt: state.session.startedAt,
    sessionDate: state.session.date,
    sessionDiscountTime: state.session.discountTime,
    normalResumeAreaId,
  };
}
