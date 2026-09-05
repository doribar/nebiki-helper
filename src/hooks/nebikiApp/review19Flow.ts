import type {
  AppState,
  DailySessionSnapshot,
  LastSessionWeatherRecord,
  Review19Result,
} from "../../domain/types";
import { normalizeDemandCycle } from "../../domain/demandCycle.ts";
import { supportsObonCalendarRule } from "../../domain/obon.ts";
import { createInitialReview19Result } from "../../domain/review19.ts";
import { canStartReview19FromCurrentState, formatLocalDate } from "./clock.ts";
import { createReview19Reference, createReview19WeatherDraft } from "./sessionSnapshots.ts";
import { normalizeLoadedState } from "./stateNormalization.ts";
import { resolveSessionTemperatureComfort } from "./temperatureComfortState.ts";

/** 18:30への移行を逃した当日17時sourceだけを救済する。19:25以降も優先する。 */
export function getAutomaticReview19TransitionKey(params: {
  state: AppState;
  now: Date;
  records?: Review19Result[];
  isTestMode?: boolean;
  hasTransitionedTo1830?: boolean;
}): string | null {
  const { state, now } = params;
  const currentDate = formatLocalDate(now);
  if (
    params.isTestMode ||
    params.hasTransitionedTo1830 ||
    state.screen === "start" ||
    state.screen === "review19_weather" ||
    state.screen === "review19" ||
    state.screen === "review19_done" ||
    state.session?.date !== currentDate ||
    state.session.discountTime !== "17" ||
    now.getHours() * 60 + now.getMinutes() < 18 * 60 + 55 ||
    state.review19?.date === currentDate ||
    !canStartReview19FromCurrentState(params)
  ) {
    return null;
  }
  return [currentDate, state.session.startedAt, "17", "review19"].join("|");
}

/** 手動開始と自動救済が共用する、17時sourceからのReview19生成。保存・通知は呼出側。 */
export function createReview19StartState(params: {
  currentState: AppState;
  sourceState: AppState;
  now: Date;
  snapshots: DailySessionSnapshot[];
  lastSessionWeather: LastSessionWeatherRecord | null;
}): AppState {
  const { currentState, sourceState, now } = params;
  const session = sourceState.session;
  if (!session) return currentState;
  const reviewDraft = createReview19WeatherDraft(session);
  const initialReview19 = createInitialReview19Result({
    date: session.date,
    demandCycle: normalizeDemandCycle(session.demandCycle),
    sessionStartedAt: session.startedAt,
    reviewStartedAt: now.toISOString(),
    excludedAreaIds: sourceState.review19ExcludedAreaIds,
  });
  const reviewTemperatureComfort = resolveSessionTemperatureComfort({
    date: reviewDraft.date,
    discountTime: "19",
    weather: reviewDraft.weather,
    snapshots: params.snapshots,
    lastSessionWeather: params.lastSessionWeather,
    previousSession: session,
  }).analysis;

  return {
    ...currentState,
    session,
    screen: "review19",
    sessionDraft: reviewDraft,
    areaProgressMap: sourceState.areaProgressMap,
    review19ExcludedAreaIds: sourceState.review19ExcludedAreaIds,
    currentAreaId: null,
    currentFlow: "normal",
    pendingDeferredAreaIds: [],
    timeSwitchNotice: null,
    review19: {
      ...initialReview19,
      reference: createReview19Reference(
        reviewDraft,
        reviewTemperatureComfort,
        supportsObonCalendarRule(session.appVersion),
      ),
    },
  };
}

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
