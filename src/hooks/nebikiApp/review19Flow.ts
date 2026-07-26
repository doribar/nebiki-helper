import type { AppState } from "../../domain/types";
import { normalizeLoadedState } from "./stateNormalization.ts";

export function selectReview19SourceState(params: {
  currentState: AppState;
  savedSourceState: AppState | null;
  currentDate: string;
}): AppState | null {
  if (
    params.currentState.session?.date === params.currentDate &&
    params.currentState.session.discountTime === "17"
  ) {
    return params.currentState;
  }

  const savedSourceState = normalizeLoadedState(
    params.savedSourceState,
    params.currentState.sessionDraft,
  );

  return savedSourceState.session?.date === params.currentDate &&
    savedSourceState.session.discountTime === "17"
    ? savedSourceState
    : null;
}
