import type {
  AppState,
  AreaCountEvaluation,
  AreaCountCorrectionContext,
  AreaId,
  AreaJudge,
  AreaProgress,
  AreaRateAdjustment,
  DailyMessageState,
  DiscountTime,
  LastSessionWeatherRecord,
  NextSessionSkipRecord,
  ScreenName,
  SessionData,
  SessionDraft,
  WeatherInput,
} from "../../domain/types";
import { AREA_MASTERS, NORMAL_ROUTE } from "../../domain/area";
import { normalizeRateDecisionSnapshot } from "../../domain/rateDecisionSnapshot.ts";
import {
  evaluateTemperatureComfort,
  normalizeTemperatureComfortAnalysis,
} from "../../domain/temperatureComfort.ts";
import {
  buildHourlyForecastsFromLegacy,
  cloneHourlyForecasts,
  createDefaultHourlyForecasts,
} from "../../domain/hourlyWeather.ts";
import {
  cloneAppState,
  cloneLastSessionWeatherRecord,
  cloneSkipRecords,
} from "../../domain/navigationHistory";
import { normalizeDailyMessageState } from "../../domain/storage";
import { applyAfterRainSelectionDefaults } from "../../domain/afterRain";
import { normalizeAreaCountDecisionBasis } from "../../domain/areaCountHistory.ts";
import { normalizeReview19Result } from "../../domain/review19.ts";
import { normalizeDataVersionInfo } from "../../domain/dataVersion.ts";
import {
  formatLocalDate,
  getRuntimeNow,
  resolveDiscountTime,
} from "./clock.ts";

export function createInitialSessionDraft(): SessionDraft {
  const now = getRuntimeNow();

  return {
    date: formatLocalDate(now),
    weekday: now.getDay(),
    discountTime: resolveDiscountTime(now),
    manualWeekdayOverride: false,
    manualDiscountTimeOverride: false,
    weather: {
      hourlyForecasts: createDefaultHourlyForecasts(),
      afterRainSky: null,
    },
  };
}

export function createInitialAreaProgressMap(): Record<AreaId, AreaProgress> {
  return AREA_MASTERS.reduce((acc, area) => {
    acc[area.id] = {
      areaId: area.id,
      status: "unstarted",
      areaJudge: null,
    };
    return acc;
  }, {} as Record<AreaId, AreaProgress>);
}

export function isValidAreaId(value: unknown): value is AreaId {
  return typeof value === "string" && NORMAL_ROUTE.includes(value as AreaId);
}

function isValidAreaStatus(value: unknown): value is AreaProgress["status"] {
  return (
    value === "unstarted" ||
    value === "completed" ||
    value === "skipped_manual" ||
    value === "postponed_few" ||
    value === "auto_skipped_late_time"
  );
}

function isValidAreaJudge(value: unknown): value is AreaJudge {
  return value === "many" || value === "normal" || value === "few" || value === null;
}

function isValidScreenName(value: unknown): value is ScreenName {
  return (
    value === "start" ||
    value === "review19_weather" ||
    value === "review19_done" ||
    value === "area_judge" ||
    value === "auto_skip_notice" ||
    value === "auto_skip_count" ||
    value === "rate_display" ||
    value === "final_time" ||
    value === "review19" ||
    value === "done"
  );
}

function normalizeAreaCountCorrectionContext(
  raw: unknown,
): AreaCountCorrectionContext | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<AreaCountCorrectionContext>;
  if (!isValidAreaId(source.targetAreaId) || !isValidScreenName(source.returnScreen)) {
    return null;
  }

  return {
    mode:
      source.mode === "auto_skip_count_only"
        ? "auto_skip_count_only"
        : "normal",
    targetAreaId: source.targetAreaId,
    returnScreen: source.returnScreen,
    returnAreaId: isValidAreaId(source.returnAreaId) ? source.returnAreaId : null,
    returnLastReferenceAreaId: isValidAreaId(source.returnLastReferenceAreaId)
      ? source.returnLastReferenceAreaId
      : null,
    returnCurrentFlow: source.returnCurrentFlow === "pending" ? "pending" : "normal",
    returnPendingDeferredAreaIds: Array.isArray(source.returnPendingDeferredAreaIds)
      ? source.returnPendingDeferredAreaIds.filter(isValidAreaId)
      : [],
    returnFinalTimeStep:
      source.returnFinalTimeStep === 1 ||
      source.returnFinalTimeStep === 2 ||
      source.returnFinalTimeStep === 3
        ? source.returnFinalTimeStep
        : 0,
    returnTimeSwitchNotice:
      typeof source.returnTimeSwitchNotice === "string"
        ? source.returnTimeSwitchNotice
        : null,
    returnHistoryLength:
      typeof source.returnHistoryLength === "number" &&
      Number.isInteger(source.returnHistoryLength) &&
      source.returnHistoryLength >= 0
        ? source.returnHistoryLength
        : 0,
  };
}

function isValidAreaCountEvaluation(value: unknown): value is AreaCountEvaluation {
  return (
    value === "many" ||
    value === "slightly_many" ||
    value === "normal" ||
    value === "slightly_few" ||
    value === "few"
  );
}

function isValidAreaCountEvaluationSource(
  value: unknown
): value is NonNullable<AreaProgress["areaCountEvaluationSource"]> {
  return value === "manual" || value === "history";
}

export function isValidDiscountTime(value: unknown): value is DiscountTime {
  return (
    value === "15" ||
    value === "17" ||
    value === "18" ||
    value === "19" ||
    value === "20"
  );
}

export function getInitialTimeSwitchTarget(
  raw: unknown,
  isTestMode: boolean
): DiscountTime | null {
  return !isTestMode && isValidDiscountTime(raw) ? raw : null;
}

function isValidAreaRateAdjustment(value: unknown): value is AreaRateAdjustment {
  return value === -10 || value === -5 || value === 0 || value === 5 || value === 10;
}


export function normalizeReview19ExcludedAreaIds(raw: unknown): AreaId[] {
  if (!Array.isArray(raw)) return [];

  const unique = new Set<AreaId>();
  for (const value of raw) {
    if (isValidAreaId(value)) {
      unique.add(value);
    }
  }

  return [...unique];
}

export function normalizeNormalFlowOrder(raw: unknown): AreaId[] {
  const normalized: AreaId[] = [];

  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (
        isValidAreaId(value) &&
        NORMAL_ROUTE.includes(value) &&
        !normalized.includes(value)
      ) {
        normalized.push(value);
      }
    }
  }

  for (const areaId of NORMAL_ROUTE) {
    if (!normalized.includes(areaId)) normalized.push(areaId);
  }

  return normalized;
}

export function addReview19ExcludedAreaId(
  current: AreaId[],
  areaId: AreaId,
): AreaId[] {
  return current.includes(areaId) ? current : [...current, areaId];
}

export function removeReview19ExcludedAreaId(
  current: AreaId[],
  areaId: AreaId,
): AreaId[] {
  return current.filter((currentAreaId) => currentAreaId !== areaId);
}

export function normalizeAreaProgressMap(
  raw?: Partial<Record<string, AreaProgress>> | null
): Record<AreaId, AreaProgress> {
  const base = createInitialAreaProgressMap();

  if (!raw || typeof raw !== "object") {
    return base;
  }

  for (const area of AREA_MASTERS) {
    const progress = raw[area.id];
    if (!progress || typeof progress !== "object") continue;

    base[area.id] = {
      ...base[area.id],
      status: isValidAreaStatus(progress.status) ? progress.status : "unstarted",
      areaJudge: isValidAreaJudge(progress.areaJudge) ? progress.areaJudge : null,
      areaCount:
        typeof progress.areaCount === "number" && Number.isFinite(progress.areaCount) && progress.areaCount >= 0
          ? Math.round(progress.areaCount)
          : undefined,
      stapleItemCount:
        progress.stapleItemCount === null
          ? null
          : typeof progress.stapleItemCount === "number" &&
            Number.isInteger(progress.stapleItemCount) &&
            progress.stapleItemCount >= 0 &&
            (!(
              typeof progress.areaCount === "number" &&
              Number.isFinite(progress.areaCount) &&
              progress.areaCount >= 0
            ) ||
              progress.stapleItemCount <= Math.round(progress.areaCount))
          ? progress.stapleItemCount
          : undefined,
      areaCountEvaluation: isValidAreaCountEvaluation(progress.areaCountEvaluation)
        ? progress.areaCountEvaluation
        : undefined,
      areaCountEvaluationSource: isValidAreaCountEvaluationSource(progress.areaCountEvaluationSource)
        ? progress.areaCountEvaluationSource
        : undefined,
      areaCountDecisionBasis: normalizeAreaCountDecisionBasis(progress.areaCountDecisionBasis),
      areaRateAdjustment: isValidAreaRateAdjustment(progress.areaRateAdjustment)
        ? progress.areaRateAdjustment
        : undefined,
      visitedAt:
        typeof progress.visitedAt === "string" ? progress.visitedAt : undefined,
      completedAt:
        typeof progress.completedAt === "string" ? progress.completedAt : undefined,
      skipReason:
        progress.skipReason === "manual" ||
        progress.skipReason === "few" ||
        progress.skipReason === "late_time"
          ? progress.skipReason
          : undefined,
      completedRateText:
        typeof progress.completedRateText === "string"
          ? progress.completedRateText
          : undefined,
      completedManyRateText:
        typeof progress.completedManyRateText === "string"
          ? progress.completedManyRateText
          : undefined,
      completedNormalRateText:
        typeof progress.completedNormalRateText === "string"
          ? progress.completedNormalRateText
          : undefined,
      previousRateText:
        typeof progress.previousRateText === "string"
          ? progress.previousRateText
          : undefined,
      previousManyRateText:
        typeof progress.previousManyRateText === "string"
          ? progress.previousManyRateText
          : undefined,
      previousNormalRateText:
        typeof progress.previousNormalRateText === "string"
          ? progress.previousNormalRateText
          : undefined,
      autoSkipKind:
        progress.autoSkipKind === "late_plus5" ||
        progress.autoSkipKind === "early_next_minus5"
          ? progress.autoSkipKind
          : undefined,
      earlyNextMinus5TargetDiscountTime:
        progress.earlyNextMinus5TargetDiscountTime === "18" ||
        progress.earlyNextMinus5TargetDiscountTime === "19"
          ? progress.earlyNextMinus5TargetDiscountTime
          : undefined,
      measurementStatus:
        typeof progress.areaCount === "number"
          ? "measured"
          : progress.measurementStatus === "measured" ||
            progress.measurementStatus === "not_measured"
          ? progress.measurementStatus
          : progress.status === "auto_skipped_late_time" &&
            typeof progress.visitedAt === "string"
          ? "not_measured"
          : undefined,
      missingReason:
        progress.missingReason === "early_next_minus5_skipped" ||
        progress.missingReason === "auto_time_transition" ||
        progress.missingReason === "legacy_unknown"
          ? progress.missingReason
          : progress.status === "auto_skipped_late_time" &&
            typeof progress.visitedAt === "string" &&
            typeof progress.areaCount !== "number"
          ? "legacy_unknown"
          : undefined,
      earlyDiscountResolution:
        progress.earlyDiscountResolution === "count_only" ||
        progress.earlyDiscountResolution === "process_normally" ||
        progress.earlyDiscountResolution === "not_measured"
          ? progress.earlyDiscountResolution
          : undefined,
      sourceDiscountTime: isValidDiscountTime(progress.sourceDiscountTime)
        ? progress.sourceDiscountTime
        : undefined,
      sourceSessionStartedAt:
        typeof progress.sourceSessionStartedAt === "string"
          ? progress.sourceSessionStartedAt
          : undefined,
      earlyDiscountCompletedAt:
        typeof progress.earlyDiscountCompletedAt === "string"
          ? progress.earlyDiscountCompletedAt
          : undefined,
      skipAcknowledgedAt:
        typeof progress.skipAcknowledgedAt === "string"
          ? progress.skipAcknowledgedAt
          : undefined,
      measurementRecordedAt:
        typeof progress.measurementRecordedAt === "string"
          ? progress.measurementRecordedAt
          : undefined,
      rateOrigin:
        progress.rateOrigin === "confirmed_now" ||
        progress.rateOrigin === "carried_from_early_discount"
          ? progress.rateOrigin
          : undefined,
      rateDecisionSnapshot: normalizeRateDecisionSnapshot(
        progress.rateDecisionSnapshot,
      ),
      rateDecisionSnapshotStatus: normalizeRateDecisionSnapshot(
        progress.rateDecisionSnapshot,
      )
        ? "captured"
        : progress.status === "completed"
        ? "legacy_not_captured"
        : undefined,
    };
  }

  return base;
}


export function createInitialState(
  initialSessionDraft: SessionDraft = createInitialSessionDraft(),
): AppState {
  return {
    screen: "start",
    session: null,
    sessionDraft: initialSessionDraft,
    areaProgressMap: createInitialAreaProgressMap(),
    normalFlowOrder: [...NORMAL_ROUTE],
    currentAreaId: null,
    lastReferenceAreaId: null,
    currentFlow: "normal",
    pendingDeferredAreaIds: [],
    timeSwitchNotice: null,
    finalTimeStep: 0,
    review19: null,
    review19ExcludedAreaIds: [],
    areaCountCorrection: null,
    finalizedDayRecordId: null,
  };
}

export function clonePersistedNebikiStateSnapshot(params: {
  currentSession: AppState;
  nextSessionSkipRecords: NextSessionSkipRecord[];
  lastSessionWeather: LastSessionWeatherRecord | null;
  lastUsedSessionDraft: SessionDraft;
  dailyMessageState: DailyMessageState;
}) {
  return {
    currentSession: cloneAppState(params.currentSession),
    workSessionCheckpoint: null,
    runtimeState: null,
    nextSessionSkipRecords: cloneSkipRecords(params.nextSessionSkipRecords),
    lastSessionWeather: cloneLastSessionWeatherRecord(params.lastSessionWeather),
    lastUsedSessionDraft: normalizeSessionDraft(params.lastUsedSessionDraft),
    dailyMessageState: normalizeDailyMessageState(params.dailyMessageState),
  };
}

function isSameDaySession(state: AppState | null, date: string): boolean {
  return state?.session?.date === date;
}

export function shouldUseCheckpointInsteadOfCurrent(params: {
  currentSession: AppState | null;
  checkpoint: AppState | null;
  today: string;
}): boolean {
  const { currentSession, checkpoint, today } = params;
  if (!isSameDaySession(checkpoint, today)) return false;

  // 通常は現在セッションを優先する。
  // ただし、再読み込みなどで開始画面・セッションなしに戻ってしまっている場合は、
  // 最後の値引作業チェックポイントから復元する。
  if (!currentSession?.session && currentSession?.screen === "start") return true;
  if (!currentSession?.session && !currentSession) return true;

  return false;
}


function normalizeWeatherInput(raw: unknown, discountTime: DiscountTime): WeatherInput {
  const fallback = createInitialSessionDraft().weather;

  if (!raw || typeof raw !== "object") {
    return {
      hourlyForecasts: cloneHourlyForecasts(fallback.hourlyForecasts),
      afterRainSky: fallback.afterRainSky,
    };
  }

  const source = raw as Record<string, unknown>;
  const rawHourlyForecasts = source.hourlyForecasts;

  const hourlyForecasts =
    rawHourlyForecasts && typeof rawHourlyForecasts === "object"
      ? (Object.keys(fallback.hourlyForecasts) as Array<keyof typeof fallback.hourlyForecasts>).reduce((acc, hour) => {
          const rawMap = rawHourlyForecasts as Record<string, unknown>;
          const rawEntry = rawMap[hour];

          if (!rawEntry || typeof rawEntry !== "object") {
            acc[hour] = { ...fallback.hourlyForecasts[hour] };
            return acc;
          }

          const entry = rawEntry as Record<string, unknown>;
          acc[hour] = {
            weather:
              entry.weather === "sunny" || entry.weather === "rain" || entry.weather === "snow"
                ? entry.weather
                : fallback.hourlyForecasts[hour].weather,
            tempC:
              typeof entry.tempC === "number"
                ? Math.max(-20, Math.min(45, Math.round(entry.tempC)))
                : fallback.hourlyForecasts[hour].tempC,
            windMs:
              typeof entry.windMs === "number"
                ? Math.max(0, Math.min(20, Math.round(entry.windMs)))
                : fallback.hourlyForecasts[hour].windMs,
          };
          return acc;
        }, {} as WeatherInput["hourlyForecasts"])
      : buildHourlyForecastsFromLegacy({
          legacyWeather: source,
          discountTime,
        });

  return {
    hourlyForecasts,
    afterRainSky:
      source.afterRainSky === "cloudy" || source.afterRainSky === "sunny"
        ? source.afterRainSky
        : fallback.afterRainSky,
  };
}

export function normalizeSessionDraft(
  raw?: Partial<SessionDraft> | null,
): SessionDraft {
  const fallback = createInitialSessionDraft();

  const discountTime =
    raw?.discountTime === "15" ||
    raw?.discountTime === "17" ||
    raw?.discountTime === "18" ||
    raw?.discountTime === "19" ||
    raw?.discountTime === "20"
      ? raw.discountTime
      : fallback.discountTime;

  return {
    date: typeof raw?.date === "string" ? raw.date : fallback.date,
    weekday: typeof raw?.weekday === "number" ? raw.weekday : fallback.weekday,
    discountTime,
    manualWeekdayOverride:
      typeof raw?.manualWeekdayOverride === "boolean"
        ? raw.manualWeekdayOverride
        : false,
    manualDiscountTimeOverride:
      typeof raw?.manualDiscountTimeOverride === "boolean"
        ? raw.manualDiscountTimeOverride
        : false,
    weatherInputLockedDiscountTime: isValidDiscountTime(raw?.weatherInputLockedDiscountTime)
      ? raw.weatherInputLockedDiscountTime
      : null,
    weather: normalizeWeatherInput(raw?.weather, discountTime),
  };
}

export function buildStartDefaultDraft(
  raw?: Partial<SessionDraft> | null,
): SessionDraft {
  const currentDefault = createInitialSessionDraft();

  if (!raw) {
    return currentDefault;
  }

  const normalized = normalizeSessionDraft(raw);

  return {
    ...normalized,
    date: currentDefault.date,
    weekday: normalized.manualWeekdayOverride ? normalized.weekday : currentDefault.weekday,
    // 手動時刻・天候入力ロックはページ再読み込み後まで引き継がない。
    // ここを保存値から復元すると、メイン画面や固定動作確認モードが以前の時刻に貼り付く。
    discountTime: currentDefault.discountTime,
    manualDiscountTimeOverride: false,
    weatherInputLockedDiscountTime: null,
    weather: {
      ...normalized.weather,
      hourlyForecasts: cloneHourlyForecasts(normalized.weather.hourlyForecasts),
    },
  };
}


function normalizeSessionData(raw?: Partial<SessionData> | null): SessionData | null {
  if (!raw) return null;

  const normalizedDraft = normalizeSessionDraft(raw);
  const normalizedTemperatureComfortAnalysis = normalizeTemperatureComfortAnalysis(
    raw.temperatureComfortAnalysis,
  );
  const rawSession = raw as unknown as Record<string, unknown>;
  const rawWeather =
    rawSession.weather && typeof rawSession.weather === "object"
      ? (rawSession.weather as Record<string, unknown>)
      : null;
  const rawHourlyForecasts =
    rawWeather?.hourlyForecasts && typeof rawWeather.hourlyForecasts === "object"
      ? (rawWeather.hourlyForecasts as Record<string, unknown>)
      : null;
  const nearHourByDiscountTime: Record<DiscountTime, string> = {
    "15": "16",
    "17": "18",
    "18": "19",
    "19": "20",
    "20": "21",
  };
  const rawNearEntry = rawHourlyForecasts?.[nearHourByDiscountTime[normalizedDraft.discountTime]];
  const hasActualNearTemperature = Boolean(
    rawNearEntry &&
      typeof rawNearEntry === "object" &&
      typeof (rawNearEntry as Record<string, unknown>).tempC === "number" &&
      Number.isFinite((rawNearEntry as Record<string, unknown>).tempC),
  );
  const legacyTempLevel = rawWeather?.nearTempLevel ?? rawWeather?.tempLevel;
  const legacyUnresolvedTempLevel =
    raw.legacyUnresolvedTempLevel === "31to35" ||
    (!hasActualNearTemperature && legacyTempLevel === "31to35")
      ? "31to35"
      : undefined;
  const temperatureComfortAnalysis = legacyUnresolvedTempLevel
    ? normalizedTemperatureComfortAnalysis?.currentTempLevel ===
      legacyUnresolvedTempLevel
      ? normalizedTemperatureComfortAnalysis
      : evaluateTemperatureComfort({
          date: normalizedDraft.date,
          discountTime: normalizedDraft.discountTime,
          tempLevel: legacyUnresolvedTempLevel,
        })
    : normalizedTemperatureComfortAnalysis;

  return {
    ...normalizedDraft,
    ...normalizeDataVersionInfo(raw),
    startedAt:
      typeof raw.startedAt === "string" ? raw.startedAt : getRuntimeNow().toISOString(),
    ...(temperatureComfortAnalysis ? { temperatureComfortAnalysis } : {}),
    ...(legacyUnresolvedTempLevel ? { legacyUnresolvedTempLevel } : {}),
  };
}

export function syncAfterRainSelection(
  sessionDraft: SessionDraft,
  lastSessionWeather: LastSessionWeatherRecord | null
): SessionDraft {
  return applyAfterRainSelectionDefaults({
    sessionDraft,
    lastSessionWeather,
  });
}

export function normalizeLoadedState(
  loaded: AppState | null,
  initialSessionDraft: SessionDraft
): AppState {
  if (!loaded) return createInitialState(initialSessionDraft);

  const loadedWithoutLegacyTrainingFields = { ...loaded } as AppState & {
    trainingStep?: unknown;
    trainingStepConfig?: unknown;
  };
  delete loadedWithoutLegacyTrainingFields.trainingStep;
  delete loadedWithoutLegacyTrainingFields.trainingStepConfig;

  const areaProgressMap = normalizeAreaProgressMap(loaded.areaProgressMap);
  const currentAreaId = isValidAreaId(loaded.currentAreaId)
    ? loaded.currentAreaId
    : null;
  const rawLastReferenceAreaId = (loaded as Partial<AppState>).lastReferenceAreaId;
  const lastReferenceAreaId = isValidAreaId(rawLastReferenceAreaId)
    ? rawLastReferenceAreaId
    : null;
  const rawPendingDeferredAreaIds =
    (loaded as Partial<AppState>).pendingDeferredAreaIds ?? [];
  const pendingDeferredAreaIds = rawPendingDeferredAreaIds.filter(isValidAreaId);
  const session = normalizeSessionData(loaded.session);
  const normalizedReview19 = normalizeReview19Result((loaded as Partial<AppState>).review19);
  const reviewScreens: ScreenName[] = ["review19_weather", "review19", "review19_done"];
  const screen = reviewScreens.includes(loaded.screen) ? "start" : loaded.screen;
  const review19 = reviewScreens.includes(loaded.screen) ? null : normalizedReview19;
  const sessionDraft =
    screen === "start" && !session
      ? buildStartDefaultDraft(loaded.sessionDraft)
      : normalizeSessionDraft(loaded.sessionDraft);

  return {
    ...loadedWithoutLegacyTrainingFields,
    screen,
    session,
    sessionDraft,
    areaProgressMap,
    normalFlowOrder: normalizeNormalFlowOrder((loaded as Partial<AppState>).normalFlowOrder),
    currentAreaId,
    lastReferenceAreaId,
    currentFlow: (loaded as Partial<AppState>).currentFlow ?? "normal",
    pendingDeferredAreaIds,
    timeSwitchNotice:
      (loaded as Partial<AppState>).timeSwitchNotice ?? null,
    finalTimeStep:
      typeof (loaded as Partial<AppState>).finalTimeStep === "number"
        ? ((loaded as Partial<AppState>).finalTimeStep as AppState["finalTimeStep"])
        : 0,
    review19,
    review19ExcludedAreaIds: normalizeReview19ExcludedAreaIds((loaded as Partial<AppState>).review19ExcludedAreaIds),
    areaCountCorrection: normalizeAreaCountCorrectionContext(
      (loaded as Partial<AppState>).areaCountCorrection,
    ),
    finalizedDayRecordId:
      typeof (loaded as Partial<AppState>).finalizedDayRecordId === "string"
        ? (loaded as Partial<AppState>).finalizedDayRecordId
        : null,
  };
}
