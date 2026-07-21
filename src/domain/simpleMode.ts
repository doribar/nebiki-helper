import { getAreaName, getNormalRoute } from "./area.ts";
import { evaluationToRateAdjustment } from "./areaCountHistory.ts";
import { getNormalTimeRateDisplay } from "./discount.ts";
import { createDefaultHourlyForecasts, normalizeHourlyForecastEntry, resolveWeatherInputForDiscount } from "./hourlyWeather.ts";
import {
  shouldShowDayBeforeHolidayNotice,
  shouldShowHolidayBeforeNormalWeekdayNotice,
  shouldShowThreeDayHolidayMiddleNotice,
} from "./dayBeforeHolidayNotice.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "./weekdayBase.ts";
import type {
  AreaCountEvaluation,
  AreaId,
  BasisGuideDisplay,
  RateDisplayData,
  SessionDraft,
} from "./types.ts";

export type SimpleDiscountTime = "17" | "18" | "19" | "20";
export type SimpleWorkDiscountTime = Exclude<SimpleDiscountTime, "20">;
export type SimplePhase = "weather" | "judgment" | "first_lap" | "second_lap" | "final";

export type SimpleRateSnapshot = {
  mainRateText: string;
  tenOrMoreRateText: string | null;
};

function parseSimpleRatePercent(rateText: string | null): number | null {
  if (!rateText) return null;
  const percent = Number(rateText.match(/(\d+)%/)?.[1]);
  return Number.isFinite(percent) ? percent : null;
}

/** 上限処理後も10個以上の率が実際に高い場合だけ、追加率の案内を表示する。 */
export function shouldShowSimpleTenOrMoreRate(rate: SimpleRateSnapshot): boolean {
  const mainRatePercent = parseSimpleRatePercent(rate.mainRateText);
  const tenOrMoreRatePercent = parseSimpleRatePercent(rate.tenOrMoreRateText);
  return (
    mainRatePercent !== null &&
    tenOrMoreRatePercent !== null &&
    tenOrMoreRatePercent > mainRatePercent
  );
}

export type SimpleModeState = {
  version: 1;
  date: string;
  discountTime: SimpleDiscountTime;
  phase: SimplePhase;
  sessionDraft: SessionDraft;
  judgments: Partial<Record<AreaId, AreaCountEvaluation>>;
  currentIndex: number;
  currentAreaId: AreaId | null;
  firstLapRates: Partial<Record<AreaId, SimpleRateSnapshot>>;
  judgments1930: Partial<Record<AreaId, AreaCountEvaluation>>;
  finalRoute: AreaId[];
};

export const SIMPLE_MODE_STORAGE_KEY = "nebiki-helper/simple-mode-state-v1";

type SimpleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const SIMPLE_EVALUATIONS: AreaCountEvaluation[] = [
  "many",
  "slightly_many",
  "normal",
  "slightly_few",
  "few",
];

const SIMPLE_TIMES: SimpleDiscountTime[] = ["17", "18", "19", "20"];

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getBrowserStorage(): SimpleStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function isSimpleEvaluation(value: unknown): value is AreaCountEvaluation {
  return SIMPLE_EVALUATIONS.includes(value as AreaCountEvaluation);
}

export function resolveSimpleDiscountTime(date: Date): SimpleDiscountTime {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 20 * 60 + 25) return "20";
  if (minutes >= 19 * 60 + 25) return "19";
  if (minutes >= 18 * 60 + 25) return "18";
  return "17";
}

export function getSimpleTimeLabel(discountTime: SimpleDiscountTime): string {
  switch (discountTime) {
    case "17": return "17時";
    case "18": return "18時30分";
    case "19": return "19時30分";
    case "20": return "20時30分";
  }
}

export function getSimpleWeekdayText(weekday: number): string {
  return ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"][weekday] ?? "";
}

export function createSimpleSessionDraft(now: Date, discountTime = resolveSimpleDiscountTime(now)): SessionDraft {
  return {
    date: formatLocalDate(now),
    weekday: now.getDay(),
    discountTime,
    manualWeekdayOverride: false,
    manualDiscountTimeOverride: false,
    weather: {
      hourlyForecasts: createDefaultHourlyForecasts(),
      afterRainSky: null,
    },
  };
}

export function buildSimpleSecondRoute(
  normalRoute: readonly AreaId[],
  judgments: Partial<Record<AreaId, AreaCountEvaluation>>,
): AreaId[] {
  const reverse = [...normalRoute].reverse();
  const high = reverse.filter((areaId) => {
    const value = judgments[areaId];
    return value === "many" || value === "slightly_many";
  });
  const normal = normalRoute.filter((areaId) => judgments[areaId] === "normal");
  const low = reverse.filter((areaId) => {
    const value = judgments[areaId];
    return value === "slightly_few" || value === "few";
  });
  const judged = new Set([...high, ...normal, ...low]);
  return [...high, ...normal, ...low, ...normalRoute.filter((areaId) => !judged.has(areaId))];
}

export function buildSimpleFinalRoute(
  normalRoute: readonly AreaId[],
  judgments1930: Partial<Record<AreaId, AreaCountEvaluation>>,
): AreaId[] {
  const reverse = [...normalRoute].reverse();
  const high = normalRoute.filter((areaId) => {
    const value = judgments1930[areaId];
    return value === "many" || value === "slightly_many";
  });
  const normal = reverse.filter((areaId) => judgments1930[areaId] === "normal");
  const low = normalRoute.filter((areaId) => {
    const value = judgments1930[areaId];
    return value === "slightly_few" || value === "few";
  });
  const judged = new Set([...high, ...normal, ...low]);
  return [...high, ...normal, ...low, ...normalRoute.filter((areaId) => !judged.has(areaId))];
}

export function applySimpleAreaJudgment(
  state: SimpleModeState,
  evaluation: AreaCountEvaluation,
): SimpleModeState {
  if (state.phase !== "judgment") return state;
  const route = getNormalRoute(state.date);
  const areaId = route[state.currentIndex];
  if (!areaId) return state;

  const judgments = { ...state.judgments, [areaId]: evaluation };
  return {
    ...state,
    judgments,
    judgments1930: state.discountTime === "19" ? judgments : state.judgments1930,
    phase: "first_lap",
    currentAreaId: areaId,
  };
}

export function completeSimpleFirstLapArea(
  state: SimpleModeState,
  rate: SimpleRateSnapshot,
): SimpleModeState {
  if (state.phase !== "first_lap") return state;
  const route = getNormalRoute(state.date);
  const areaId = route[state.currentIndex];
  if (!areaId) return state;

  const firstLapRates = { ...state.firstLapRates, [areaId]: rate };
  const isLast = state.currentIndex >= route.length - 1;
  if (!isLast) {
    const nextIndex = state.currentIndex + 1;
    return {
      ...state,
      firstLapRates,
      phase: "judgment",
      currentIndex: nextIndex,
      currentAreaId: route[nextIndex] ?? null,
    };
  }

  const secondRoute = buildSimpleSecondRoute(route, state.judgments);
  return {
    ...state,
    firstLapRates,
    phase: "second_lap",
    currentIndex: 0,
    currentAreaId: secondRoute[0] ?? null,
  };
}

export function createInitialSimpleModeState(now: Date): SimpleModeState {
  const discountTime = resolveSimpleDiscountTime(now);
  const date = formatLocalDate(now);
  const route = getNormalRoute(date);
  const phase: SimplePhase = discountTime === "20" ? "final" : "weather";
  return {
    version: 1,
    date,
    discountTime,
    phase,
    sessionDraft: createSimpleSessionDraft(now, discountTime),
    judgments: {},
    currentIndex: 0,
    currentAreaId: phase === "final" ? null : route[0] ?? null,
    firstLapRates: {},
    judgments1930: {},
    finalRoute: phase === "final" ? [...route] : [],
  };
}

function normalizeJudgments(raw: unknown, route: readonly AreaId[]): Partial<Record<AreaId, AreaCountEvaluation>> {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Partial<Record<AreaId, unknown>>;
  const result: Partial<Record<AreaId, AreaCountEvaluation>> = {};
  for (const areaId of route) {
    if (isSimpleEvaluation(source[areaId])) result[areaId] = source[areaId];
  }
  return result;
}

function normalizeSessionDraft(raw: unknown, fallback: SessionDraft): SessionDraft {
  if (!raw || typeof raw !== "object") return fallback;
  const source = raw as Partial<SessionDraft>;
  const rawWeather = source.weather && typeof source.weather === "object" ? source.weather : fallback.weather;
  const rawForecasts = rawWeather.hourlyForecasts && typeof rawWeather.hourlyForecasts === "object"
    ? rawWeather.hourlyForecasts
    : fallback.weather.hourlyForecasts;
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const hour of Object.keys(hourlyForecasts) as Array<keyof typeof hourlyForecasts>) {
    hourlyForecasts[hour] = normalizeHourlyForecastEntry(rawForecasts[hour], hourlyForecasts[hour]);
  }
  return {
    ...fallback,
    weekday: typeof source.weekday === "number" && source.weekday >= 0 && source.weekday <= 6
      ? Math.trunc(source.weekday)
      : fallback.weekday,
    manualWeekdayOverride: source.manualWeekdayOverride === true,
    manualDiscountTimeOverride: source.manualDiscountTimeOverride === true,
    weather: {
      hourlyForecasts,
      afterRainSky: rawWeather.afterRainSky === "sunny" || rawWeather.afterRainSky === "cloudy"
        ? rawWeather.afterRainSky
        : null,
    },
  };
}

function normalizeRateSnapshots(raw: unknown, route: readonly AreaId[]): Partial<Record<AreaId, SimpleRateSnapshot>> {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Partial<Record<AreaId, unknown>>;
  const result: Partial<Record<AreaId, SimpleRateSnapshot>> = {};
  for (const areaId of route) {
    const value = source[areaId];
    if (!value || typeof value !== "object") continue;
    const rate = value as Partial<SimpleRateSnapshot>;
    if (typeof rate.mainRateText !== "string") continue;
    result[areaId] = {
      mainRateText: rate.mainRateText,
      tenOrMoreRateText: typeof rate.tenOrMoreRateText === "string" ? rate.tenOrMoreRateText : null,
    };
  }
  return result;
}

export function normalizeSimpleModeState(raw: unknown, now: Date): SimpleModeState {
  const initial = createInitialSimpleModeState(now);
  if (!raw || typeof raw !== "object") return initial;
  const source = raw as Partial<SimpleModeState>;
  if (source.version !== 1 || source.date !== initial.date || !SIMPLE_TIMES.includes(source.discountTime as SimpleDiscountTime)) {
    return initial;
  }

  const currentTime = initial.discountTime;
  const storedTime = source.discountTime as SimpleDiscountTime;
  const route = getNormalRoute(initial.date);
  const stored1930 = normalizeJudgments(source.judgments1930, route);
  const storedJudgments = normalizeJudgments(source.judgments, route);

  if (currentTime !== storedTime) {
    if (currentTime === "20") {
      const judgments1930 = storedTime === "19" ? storedJudgments : stored1930;
      return {
        ...initial,
        judgments1930,
        finalRoute: buildSimpleFinalRoute(route, judgments1930),
      };
    }
    return initial;
  }

  if (currentTime === "20") {
    return {
      ...initial,
      judgments1930: stored1930,
      finalRoute: buildSimpleFinalRoute(route, stored1930),
    };
  }

  const phase = source.phase === "weather" || source.phase === "judgment" || source.phase === "first_lap" ||
    source.phase === "second_lap" || source.phase === "final" ? source.phase : initial.phase;
  const judgments1930 = storedTime === "19" && Object.keys(stored1930).length === 0
    ? storedJudgments
    : stored1930;
  const phaseRoute = phase === "second_lap"
    ? buildSimpleSecondRoute(route, storedJudgments)
    : route;
  const currentIndex = typeof source.currentIndex === "number" && Number.isInteger(source.currentIndex)
    ? Math.max(0, Math.min(source.currentIndex, Math.max(phaseRoute.length - 1, 0)))
    : 0;
  return {
    ...initial,
    phase,
    sessionDraft: normalizeSessionDraft(source.sessionDraft, initial.sessionDraft),
    judgments: storedJudgments,
    currentIndex,
    currentAreaId: phase === "final" ? null : phaseRoute[currentIndex] ?? null,
    firstLapRates: normalizeRateSnapshots(source.firstLapRates, route),
    judgments1930,
    finalRoute: phase === "final" ? buildSimpleFinalRoute(route, judgments1930) : [],
  };
}

export function loadSimpleModeState(
  now: Date,
  storage: SimpleStorage | null = getBrowserStorage(),
): SimpleModeState {
  if (!storage) return createInitialSimpleModeState(now);
  try {
    const raw = storage.getItem(SIMPLE_MODE_STORAGE_KEY);
    return normalizeSimpleModeState(raw ? JSON.parse(raw) : null, now);
  } catch {
    return createInitialSimpleModeState(now);
  }
}

export function saveSimpleModeState(
  state: SimpleModeState,
  storage: SimpleStorage | null = getBrowserStorage(),
): void {
  if (!storage) return;
  storage.setItem(SIMPLE_MODE_STORAGE_KEY, JSON.stringify(state));
}

export function clearSimpleModeState(storage: SimpleStorage | null = getBrowserStorage()): void {
  storage?.removeItem(SIMPLE_MODE_STORAGE_KEY);
}

function shouldIgnoreRateCap(discountTime: SimpleWorkDiscountTime, draft: SessionDraft): boolean {
  const weather = resolveWeatherInputForDiscount(draft.weather, discountTime);
  return weather.precipitationRateBonus > 0 || weather.nearTermWeather === "rain" || weather.nearTermWeather === "snow";
}

function getSimpleLateTimeBonus(discountTime: SimpleWorkDiscountTime, now: Date, manualOverride: boolean): number {
  if (manualOverride) return 0;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return discountTime === "19" && minutes >= 20 * 60 + 15 ? 5 : 0;
}

export function getSimpleCalculation(params: {
  draft: SessionDraft;
  evaluation: AreaCountEvaluation;
  now: Date;
}): { rateDisplay: RateDisplayData; rateSnapshot: SimpleRateSnapshot; basisGuide: BasisGuideDisplay } {
  const discountTime = params.draft.discountTime as SimpleWorkDiscountTime;
  const resolvedWeather = resolveWeatherInputForDiscount(params.draft.weather, discountTime);
  const weekdayInfo = getWeekdayBaseInfo(
    params.draft.weekday,
    discountTime,
    resolvedWeather,
    params.draft.date,
  );
  const rateDisplay = getNormalTimeRateDisplay({
    discountTime,
    weekday: params.draft.weekday,
    date: params.draft.date,
    weatherBonus: weekdayInfo.baseRateBonus + getSimpleLateTimeBonus(discountTime, params.now, params.draft.manualDiscountTimeOverride),
    areaJudge: "normal",
    isSunday: false,
    ignoreTimeRateCap: shouldIgnoreRateCap(discountTime, params.draft),
    weekdayBase: weekdayInfo.adjusted,
    areaRateAdjustment: evaluationToRateAdjustment(params.evaluation),
  });
  const mainRate = Number(rateDisplay.many.main.match(/(\d+)%/)?.[1]);
  const tenOrMoreRate = Number.isFinite(mainRate) ? `${Math.min(50, mainRate + 5)}%` : null;
  return {
    rateDisplay,
    rateSnapshot: {
      mainRateText: rateDisplay.many.main,
      tenOrMoreRateText: tenOrMoreRate,
    },
    basisGuide: getBasisGuideDisplay({
      date: params.draft.date,
      weekday: params.draft.weekday,
      discountTime,
      weather: resolvedWeather,
    }),
  };
}

export function getSimpleHolidayNotices(draft: SessionDraft) {
  return {
    dayBefore: shouldShowDayBeforeHolidayNotice({ sessionDate: draft.date, discountTime: draft.discountTime }),
    threeDayMiddle: shouldShowThreeDayHolidayMiddleNotice({ sessionDate: draft.date, discountTime: draft.discountTime }),
    holidayBeforeWeekday: shouldShowHolidayBeforeNormalWeekdayNotice({ sessionDate: draft.date, discountTime: draft.discountTime }),
  };
}

export function getSimpleAreaLabels(route: readonly AreaId[]): string[] {
  return route.map(getAreaName);
}
