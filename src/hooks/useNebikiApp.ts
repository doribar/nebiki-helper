import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppState,
  AreaId,
  DailyMessageState,
  AreaProgress,
  DoneSummaryItem,
  DoneNextSessionInfo,
  DiscountTime,
  PendingBannerInfo,
  PendingReason,
  SessionData,
  SkipTargetOption,
  SessionDraft,
  UseNebikiAppResult,
  WeatherInput,
  ResolvedWeatherInput,
  AreaJudge,
  ScreenName,
  LastSessionWeatherRecord,
  NextSessionSkipRecord,
  Review19Rating,
  Review19Result,
  Review19Snapshot,
  Review19Reference,
  WeekdayBaseLabel,
  AreaCountEvaluation,
  AreaRateAdjustment,
} from "../domain/types";
import { AREA_MASTERS, DONE_SUMMARY_ROUTE, NORMAL_ROUTE, getAreaName, getNextNormalArea } from "../domain/area";
import {
  getBasisGuideDisplay,
  getWeatherGuideText,
  getWeekdayBaseInfo,
  buildMergedBonusDisplay,
} from "../domain/weekdayBase";
import {
  getFinalTimeGuide,
  getNormalTimeRateDisplay,
} from "../domain/discount";
import {
  appendSkipRecordsInMemory,
  consumeSkipRecordsInMemory,
  loadPersistedNebikiState,
  normalizeDailyMessageState,
  savePersistedNebikiState,
  saveWorkSessionCheckpoint,
  clearWorkSessionCheckpoint,
  saveRuntimeState,
  clearRuntimeState,
  appendReview19Record,
  loadReview19Records,
  saveReview19Records,
  loadReview19SourceState,
  saveReview19SourceState,
  clearReview19SourceState,
} from "../domain/storage";
import {
  appendNavigationHistory,
  cloneAppState,
  cloneLastSessionWeatherRecord,
  cloneNavigationSnapshot,
  cloneSkipRecords,
  createNavigationSnapshot,
  popNavigationHistory,
} from "../domain/navigationHistory";
import type { NavigationSnapshot } from "../domain/navigationHistory";
import {
  getNextPendingCandidate,
  getPendingRemainingCount,
  getPendingResumeScreen,
  getSkipTargetOptions,
} from "../domain/pending";
import {
  applyAfterRainSelectionDefaults,
  shouldOfferAfterRainRecovery,
} from "../domain/afterRain";
import {
  buildHourlyForecastsFromLegacy,
  cloneHourlyForecasts,
  createDefaultHourlyForecasts,
  getNearTermWeatherForDiscount,
  resolveWeatherInputForDiscount,
} from "../domain/hourlyWeather.ts";
import {
  createInitialReview19Result,
  createReview19RatingScores,
  getReview19AreaItems,
  parseReview19RatePercent,
  normalizeReview19Result,
  buildReview19ExportPayload,
  getReview19ExportBatch,
  getUnexportedReview19Records,
  markReview19RecordsExportedInMemory,
  REVIEW19_EXCLUDE_REASON_TEXT,
} from "../domain/review19.ts";
import type { AreaCountRecord } from "../domain/areaCountHistory.ts";
import type { TrainingStep } from "../domain/trainingMode.ts";
import { getTrainingStepConfig } from "../domain/trainingMode.ts";
import {
  cloneAreaCountRecords,
  evaluationText as getAreaCountEvaluationText,
  evaluationToRateAdjustment as getAreaCountRateAdjustment,
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation as buildAreaCountRecommendation,
  getAreaCountSameItemLimit,
  isAreaCountAssistTarget,
  upsertAreaCountRecord,
} from "../domain/areaCountHistory.ts";

function formatLocalDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function resolveDiscountTime(date = new Date()): DiscountTime {
  const minutes = date.getHours() * 60 + date.getMinutes();

  if (minutes < 16 * 60 + 30) return "15";
  if (minutes < 18 * 60 + 15) return "17";
  if (minutes < 19 * 60 + 15) return "18";
  if (minutes < 20 * 60 + 15) return "19";
  return "20";
}

function getBasisTimeText(discountTime: DiscountTime): string {
  switch (discountTime) {
    case "15":
      return "15時";
    case "17":
      return "17時";
    case "18":
      return "18時30分";
    case "19":
      return "19時30分";
    case "20":
      return "20時30分";
  }
}



function getNextDoneDiscountInfo(
  discountTime: DiscountTime,
  now: Date
): DoneNextSessionInfo | null {
  const minutes = now.getHours() * 60 + now.getMinutes();

  const infoByTime: Partial<
    Record<
      DiscountTime,
      {
        label: string;
        unlockMinutes: number;
        unlockText: string;
        targetDiscountTime: DiscountTime;
      }
    >
  > = {
    "15": {
      label: "17時の値引に進む",
      unlockMinutes: 16 * 60 + 40,
      unlockText: "16:40からタップできます",
      targetDiscountTime: "17",
    },
    "17": {
      label: "18時30分の値引に進む",
      unlockMinutes: 18 * 60 + 25,
      unlockText: "18:25からタップできます",
      targetDiscountTime: "18",
    },
    "18": {
      label: "19時30分の値引に進む",
      unlockMinutes: 19 * 60 + 25,
      unlockText: "19:25からタップできます",
      targetDiscountTime: "19",
    },
    "19": {
      label: "20時30分の最終値引に進む",
      unlockMinutes: 20 * 60 + 25,
      unlockText: "20:25からタップできます",
      targetDiscountTime: "20",
    },
  };

  const info = infoByTime[discountTime];
  if (!info) return null;

  return {
    label: info.label,
    canStart: minutes >= info.unlockMinutes,
    unlockText: minutes >= info.unlockMinutes ? null : info.unlockText,
    targetDiscountTime: info.targetDiscountTime,
  };
}

function isAtOrAfterReview19StartTime(now: Date): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 19 * 60;
}

function canStartReview19FromCurrentState(params: {
  state: AppState;
  now: Date;
}): boolean {
  const { state, now } = params;

  if (!isAtOrAfterReview19StartTime(now)) return false;

  const currentDate = formatLocalDate(now);
  if (state.review19?.date === currentDate && state.review19.recordedAt) return false;

  return true;
}


function buildTimeSwitchNotice(to: DiscountTime): string {
  if (to === "20") {
    return "20時15分を過ぎたため、19時30分の値引を打ち切り、20時30分の最終値引を開始します。";
  }

  if (to === "19") {
    return "19時15分を過ぎたため、18時30分の値引を打ち切り、19時30分の値引を開始します。";
  }

  if (to === "18") {
    return "18時15分を過ぎたため、17時の値引を打ち切り、18時30分の値引を開始します。";
  }

  return `現在時刻が${getBasisTimeText(
    to
  )}を過ぎたため、ここから${getBasisTimeText(to)}の基準で表示します。`;
}

function getAreaJudgeText(judge: AreaJudge): string {
  switch (judge) {
    case "many":
      return "多い";
    case "normal":
      return "どちらでもない";
    case "few":
      return "少ない";
    default:
      return "未判定";
  }
}




function getAreaStatusText(progress: AreaProgress): string | undefined {
  switch (progress.status) {
    case "completed":
      return undefined;
    case "skipped_manual":
      return "未完了（スキップ中）";
    case "postponed_few":
      return "未完了（少ないため後回し）";
    case "auto_skipped_late_time":
      return "スキップ済み（前回+5%で値引済み）";
    case "unstarted":
      return "未完了";
  }
}


type CompletedRateSnapshot = Pick<
  AreaProgress,
  "completedRateText" | "completedManyRateText" | "completedManyNote" | "completedNormalRateText"
>;

function getProgressNormalRateText(progress: AreaProgress): string | undefined {
  return progress.completedNormalRateText ?? progress.completedRateText;
}

function getProgressManyRateText(progress: AreaProgress): string | undefined {
  return progress.completedManyRateText ?? progress.completedRateText;
}

function shouldIgnoreNormalTimeRateCap(weather: ResolvedWeatherInput): boolean {
  if (typeof weather.precipitationRateBonus === "number") {
    return weather.precipitationRateBonus > 0;
  }

  // 旧データ互換: 以前のResolvedWeatherInputには直近1枠の雨雪だけが入っていた。
  return weather.nearTermWeather === "rain" || weather.nearTermWeather === "snow";
}

function buildCompletedRateSnapshot(params: {
  session: SessionData | null;
  progress: AreaProgress;
  weatherBonus: number;
  weekdayBase: WeekdayBaseLabel;
}): CompletedRateSnapshot {
  const { session, progress, weatherBonus } = params;

  if (!session || session.discountTime === "20" || !progress.areaJudge) {
    return {};
  }

  const resolvedWeather = resolveWeatherInputForDiscount(session.weather, session.discountTime);

  const display = getNormalTimeRateDisplay({
    discountTime: session.discountTime,
    weatherBonus,
    areaJudge: progress.areaJudge,
    isSunday: session.weekday === 0 && session.discountTime === "15",
    ignoreTimeRateCap: shouldIgnoreNormalTimeRateCap(resolvedWeather),
    weekdayBase: params.weekdayBase,
    areaRateAdjustment: progress.areaRateAdjustment,
  });

  return {
    completedRateText: display.normal.main,
    completedManyRateText: display.many.main,
    completedManyNote: display.many.note,
    completedNormalRateText: display.normal.main,
  };
}

function buildNextSessionSkipRecord(params: {
  date: string;
  targetDiscountTime: "18" | "19";
  areaId: AreaId;
  rateSnapshot: CompletedRateSnapshot;
}): NextSessionSkipRecord {
  return {
    date: params.date,
    targetDiscountTime: params.targetDiscountTime,
    areaId: params.areaId,
    previousRateText: params.rateSnapshot.completedRateText,
    previousManyRateText: params.rateSnapshot.completedManyRateText,
    previousManyNote: params.rateSnapshot.completedManyNote,
    previousNormalRateText: params.rateSnapshot.completedNormalRateText,
  };
}


function isAutoSkipNoticePending(progress: AreaProgress | undefined): boolean {
  return progress?.status === "auto_skipped_late_time" && !progress.visitedAt;
}

function isNormalFlowWorkArea(progress: AreaProgress | undefined): boolean {
  return progress?.status === "unstarted" || isAutoSkipNoticePending(progress);
}

function getNormalFlowScreenForArea(
  areaProgressMap: Record<AreaId, AreaProgress>,
  areaId: AreaId
): "area_judge" | "auto_skip_notice" {
  return isAutoSkipNoticePending(areaProgressMap[areaId])
    ? "auto_skip_notice"
    : "area_judge";
}

function getFirstNormalFlowAreaId(
  areaProgressMap: Record<AreaId, AreaProgress>
): AreaId | null {
  return NORMAL_ROUTE.find((areaId) => isNormalFlowWorkArea(areaProgressMap[areaId])) ?? null;
}

function getNextNormalFlowAreaId(
  areaProgressMap: Record<AreaId, AreaProgress>,
  currentAreaId: AreaId
): AreaId | null {
  const currentIndex = NORMAL_ROUTE.indexOf(currentAreaId);
  const afterCurrent = currentIndex >= 0 ? NORMAL_ROUTE.slice(currentIndex + 1) : NORMAL_ROUTE;

  return afterCurrent.find((areaId) => isNormalFlowWorkArea(areaProgressMap[areaId])) ?? null;
}

function getNextNormalFlowAreaIdWithWrap(
  areaProgressMap: Record<AreaId, AreaProgress>,
  currentAreaId: AreaId
): AreaId | null {
  return (
    getNextNormalFlowAreaId(areaProgressMap, currentAreaId) ??
    NORMAL_ROUTE.find((areaId) => isNormalFlowWorkArea(areaProgressMap[areaId])) ??
    null
  );
}

function hasRemainingNormalFlowArea(
  areaProgressMap: Record<AreaId, AreaProgress>,
  currentAreaId: AreaId
): boolean {
  return Object.values(areaProgressMap).some((progress) => {
    return progress.areaId !== currentAreaId && isNormalFlowWorkArea(progress);
  });
}

function createInitialSessionDraft(): SessionDraft {
  const now = new Date();

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

function createInitialAreaProgressMap(): Record<AreaId, AreaProgress> {
  return AREA_MASTERS.reduce((acc, area) => {
    acc[area.id] = {
      areaId: area.id,
      status: "unstarted",
      areaJudge: null,
    };
    return acc;
  }, {} as Record<AreaId, AreaProgress>);
}

function isValidAreaId(value: unknown): value is AreaId {
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

function isValidAreaCountEvaluation(value: unknown): value is AreaCountEvaluation {
  return (
    value === "many" ||
    value === "slightly_many" ||
    value === "normal" ||
    value === "slightly_few" ||
    value === "few"
  );
}

function isValidAreaRateAdjustment(value: unknown): value is AreaRateAdjustment {
  return value === -10 || value === -5 || value === 0 || value === 5 || value === 10;
}


function normalizeReview19ExcludedAreaIds(raw: unknown): AreaId[] {
  if (!Array.isArray(raw)) return [];

  const unique = new Set<AreaId>();
  for (const value of raw) {
    if (isValidAreaId(value)) {
      unique.add(value);
    }
  }

  return [...unique];
}

function addReview19ExcludedAreaId(current: AreaId[], areaId: AreaId): AreaId[] {
  return current.includes(areaId) ? current : [...current, areaId];
}

function removeReview19ExcludedAreaId(current: AreaId[], areaId: AreaId): AreaId[] {
  return current.filter((currentAreaId) => currentAreaId !== areaId);
}

function getReview19ExcludedAreaIdsForReview(state: AppState): AreaId[] {
  return normalizeReview19ExcludedAreaIds(
    state.review19ExcludedAreaIds.filter(
      (areaId) => state.areaProgressMap[areaId]?.areaJudge === "few"
    )
  );
}

function normalizeAreaProgressMap(
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
      areaCountEvaluation: isValidAreaCountEvaluation(progress.areaCountEvaluation)
        ? progress.areaCountEvaluation
        : undefined,
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
      completedManyNote:
        typeof progress.completedManyNote === "string"
          ? progress.completedManyNote
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
      previousManyNote:
        typeof progress.previousManyNote === "string"
          ? progress.previousManyNote
          : undefined,
      previousNormalRateText:
        typeof progress.previousNormalRateText === "string"
          ? progress.previousNormalRateText
          : undefined,
    };
  }

  return base;
}


function createInitialState(initialSessionDraft: SessionDraft = createInitialSessionDraft()): AppState {
  return {
    screen: "start",
    session: null,
    sessionDraft: initialSessionDraft,
    areaProgressMap: createInitialAreaProgressMap(),
    currentAreaId: null,
    lastReferenceAreaId: null,
    currentFlow: "normal",
    pendingDeferredAreaIds: [],
    timeSwitchNotice: null,
    finalTimeStep: 0,
    review19: null,
    review19ExcludedAreaIds: [],
  };
}

function clonePersistedNebikiStateSnapshot(params: {
  currentSession: AppState;
  nextSessionSkipRecords: NextSessionSkipRecord[];
  lastSessionWeather: LastSessionWeatherRecord | null;
  lastUsedSessionDraft: SessionDraft;
  dailyMessageState: DailyMessageState;
  areaCountRecords: AreaCountRecord[];
}) {
  return {
    currentSession: cloneAppState(params.currentSession),
    workSessionCheckpoint: null,
    runtimeState: null,
    nextSessionSkipRecords: cloneSkipRecords(params.nextSessionSkipRecords),
    lastSessionWeather: cloneLastSessionWeatherRecord(params.lastSessionWeather),
    lastUsedSessionDraft: normalizeSessionDraft(params.lastUsedSessionDraft),
    dailyMessageState: normalizeDailyMessageState(params.dailyMessageState),
    areaCountRecords: cloneAreaCountRecords(params.areaCountRecords),
  };
}

function isSameDaySession(state: AppState | null, date: string): boolean {
  return state?.session?.date === date;
}

function shouldUseCheckpointInsteadOfCurrent(params: {
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

function normalizeSessionDraft(raw?: Partial<SessionDraft> | null): SessionDraft {
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
    weather: normalizeWeatherInput(raw?.weather, discountTime),
  };
}

function buildStartDefaultDraft(raw?: Partial<SessionDraft> | null): SessionDraft {
  const currentDefault = createInitialSessionDraft();

  if (!raw) {
    return currentDefault;
  }

  const normalized = normalizeSessionDraft(raw);

  const resolvedDiscountTime = normalized.manualDiscountTimeOverride
    ? normalized.discountTime
    : currentDefault.discountTime;

  return {
    ...normalized,
    date: currentDefault.date,
    weekday: normalized.manualWeekdayOverride ? normalized.weekday : currentDefault.weekday,
    discountTime: resolvedDiscountTime,
    weather: {
      ...normalized.weather,
      hourlyForecasts: cloneHourlyForecasts(normalized.weather.hourlyForecasts),
    },
  };
}


function normalizeSessionData(raw?: Partial<SessionData> | null): SessionData | null {
  if (!raw) return null;

  const normalizedDraft = normalizeSessionDraft(raw);

  return {
    ...normalizedDraft,
    startedAt:
      typeof raw.startedAt === "string" ? raw.startedAt : new Date().toISOString(),
  };
}

function syncAfterRainSelection(
  sessionDraft: SessionDraft,
  lastSessionWeather: LastSessionWeatherRecord | null
): SessionDraft {
  return applyAfterRainSelectionDefaults({
    sessionDraft,
    lastSessionWeather,
  });
}

function normalizeLoadedState(
  loaded: AppState | null,
  initialSessionDraft: SessionDraft
): AppState {
  if (!loaded) return createInitialState(initialSessionDraft);

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
  const sessionDraft = normalizeSessionDraft(loaded.sessionDraft);
  const normalizedReview19 = normalizeReview19Result((loaded as Partial<AppState>).review19);
  const screen = loaded.screen === "review19_weather" ? "review19" : loaded.screen;
  const review19 =
    loaded.screen === "review19_weather" && session && normalizedReview19 && !normalizedReview19.reference
      ? {
          ...normalizedReview19,
          reference: createReview19Reference(createReview19WeatherDraft(session)),
        }
      : normalizedReview19;

  return {
    ...loaded,
    screen,
    session,
    sessionDraft,
    areaProgressMap,
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
  };
}

function getWeekdayText(weekday: number): string {
  const map = ["日", "月", "火", "水", "木", "金", "土"];
  return `${map[weekday] ?? ""}曜日`;
}


function getNextSkipTargetDiscountTime(
  discountTime: DiscountTime
): "18" | "19" | null {
  if (discountTime === "17") return "18";
  if (discountTime === "18") return "19";
  return null;
}

function createAreaProgressMapWithAutoSkippedAreas(
  skippedRecords: NextSessionSkipRecord[]
): Record<AreaId, AreaProgress> {
  const base = createInitialAreaProgressMap();

  for (const record of skippedRecords) {
    if (!isValidAreaId(record.areaId) || !base[record.areaId]) continue;

    base[record.areaId] = {
      ...base[record.areaId],
      status: "auto_skipped_late_time",
      skipReason: "late_time",
      completedAt: new Date().toISOString(),
      previousRateText: record.previousRateText,
      previousManyRateText: record.previousManyRateText,
      previousManyNote: record.previousManyNote,
      previousNormalRateText: record.previousNormalRateText,
    };
  }

  return base;
}

function getFirstAvailableAreaId(
  areaProgressMap: Record<AreaId, AreaProgress>
): AreaId | null {
  let current: AreaId | null = "bento_men";

  while (current) {
    const progress = areaProgressMap[current];
    if (progress.status === "unstarted") {
      return current;
    }

    current = getNextNormalArea(current);
  }

  return null;
}

function refreshSessionDiscountTime(session: SessionData | null): {
  nextSession: SessionData | null;
  timeSwitchNotice: string | null;
} {
  // 実時間が次の値引帯に入っても、自動で打ち切り・移動しない。
  // 必要な場合はユーザーが開始画面から値引時刻を選び直す。
  return {
    nextSession: session,
    timeSwitchNotice: null,
  };
}




function createReview19Snapshot(params: {
  capturedAt: string;
  session: SessionData;
  resolvedWeather: ReturnType<typeof resolveWeatherInputForDiscount>;
  weekdayBaseInfo: ReturnType<typeof getWeekdayBaseInfo>;
  basisGuide: ReturnType<typeof getBasisGuideDisplay>;
  lateTimeBonus: number;
  reviewReference?: Review19Reference;
  excludedAreaIds: AreaId[];
  areaProgressMap: Record<AreaId, AreaProgress>;
  doneSummaryItems: DoneSummaryItem[];
}): Review19Snapshot {
  const doneSummaryByArea = params.doneSummaryItems.reduce((acc, item) => {
    acc[item.areaId] = item;
    return acc;
  }, {} as Record<AreaId, DoneSummaryItem>);
  const excludedAreaIdSet = new Set(params.excludedAreaIds);

  const areas = DONE_SUMMARY_ROUTE.reduce((acc, areaId) => {
    const progress = params.areaProgressMap[areaId];
    const summary = doneSummaryByArea[areaId];

    acc[areaId] = {
      areaId,
      areaName: getAreaName(areaId),
      reviewExcluded: excludedAreaIdSet.has(areaId),
      reviewExcludeReason: excludedAreaIdSet.has(areaId) ? "few_at_15_and_17" : undefined,
      status: progress?.status ?? "unstarted",
      statusText: summary?.statusText,
      areaJudge: progress?.areaJudge ?? null,
      areaCount: progress?.areaCount,
      judgeText: summary?.judgeText ?? getAreaJudgeText(progress?.areaJudge ?? null),
      rateText: summary?.rateText ?? "未完了",
      ratePercent: parseReview19RatePercent(summary?.rateText),
      manyRateText: summary?.manyRateText,
      manyRatePercent: parseReview19RatePercent(summary?.manyRateText),
      manyNote: summary?.manyNote,
      normalRateText: summary?.normalRateText,
      normalRatePercent: parseReview19RatePercent(summary?.normalRateText),
      visitedAt: progress?.visitedAt,
      completedAt: progress?.completedAt,
      skipReason: progress?.skipReason,
    };

    return acc;
  }, {} as Review19Snapshot["areas"]);

  return {
    version: 1,
    capturedAt: params.capturedAt,
    session: {
      date: params.session.date,
      weekday: params.session.weekday,
      discountTime: params.session.discountTime,
      startedAt: params.session.startedAt,
      manualWeekdayOverride: params.session.manualWeekdayOverride,
      manualDiscountTimeOverride: params.session.manualDiscountTimeOverride,
      weather: JSON.parse(JSON.stringify(params.session.weather)),
      resolvedWeather: JSON.parse(JSON.stringify(params.resolvedWeather)),
    },
    basis: {
      originalWeekdayBase: params.weekdayBaseInfo.original,
      adjustedWeekdayBase: params.weekdayBaseInfo.adjusted,
      weekdayShift: params.weekdayBaseInfo.weekdayShift,
      baseRateBonus: params.weekdayBaseInfo.baseRateBonus,
      lateTimeBonus: params.lateTimeBonus,
      totalRateBonus: params.weekdayBaseInfo.baseRateBonus + params.lateTimeBonus,
      baseRateBonusReason: [...params.weekdayBaseInfo.baseRateBonusReason],
      noticeText: params.basisGuide.noticeText,
      weekdaySummaryText: params.basisGuide.weekdaySummaryText,
      weekdayCalcText: params.basisGuide.weekdayCalcText,
      weekdayResultText: params.basisGuide.weekdayResultText,
      bonusSummaryText: params.basisGuide.bonusSummaryText,
      bonusCalcText: params.basisGuide.bonusCalcText,
      bonusResultText: params.basisGuide.bonusResultText,
    },
    areas,
    reviewReference: params.reviewReference
      ? JSON.parse(JSON.stringify(params.reviewReference)) as Review19Reference
      : undefined,
  };
}


function createReview19Reference(draft: SessionDraft): Review19Reference {
  const reviewDraft: SessionDraft = {
    ...draft,
    discountTime: "19",
    manualDiscountTimeOverride: false,
    weather: {
      ...draft.weather,
      hourlyForecasts: cloneHourlyForecasts(draft.weather.hourlyForecasts),
    },
  };
  const resolvedWeather = resolveWeatherInputForDiscount(reviewDraft.weather, "19");
  const weekdayBaseInfo = getWeekdayBaseInfo(
    reviewDraft.weekday,
    "19",
    resolvedWeather,
    reviewDraft.date
  );
  const basisGuide = getBasisGuideDisplay({
    date: reviewDraft.date,
    weekday: reviewDraft.weekday,
    discountTime: "19",
    weather: resolvedWeather,
  });

  return {
    date: reviewDraft.date,
    weekday: reviewDraft.weekday,
    discountTime: "19",
    weather: JSON.parse(JSON.stringify(reviewDraft.weather)) as WeatherInput,
    resolvedWeather: JSON.parse(JSON.stringify(resolvedWeather)),
    basis: {
      originalWeekdayBase: weekdayBaseInfo.original,
      adjustedWeekdayBase: weekdayBaseInfo.adjusted,
      weekdayShift: weekdayBaseInfo.weekdayShift,
      baseRateBonus: weekdayBaseInfo.baseRateBonus,
      baseRateBonusReason: [...weekdayBaseInfo.baseRateBonusReason],
      noticeText: basisGuide.noticeText,
      weekdaySummaryText: basisGuide.weekdaySummaryText,
      weekdayCalcText: basisGuide.weekdayCalcText,
      weekdayResultText: basisGuide.weekdayResultText,
      bonusSummaryText: basisGuide.bonusSummaryText,
      bonusCalcText: basisGuide.bonusCalcText,
      bonusResultText: basisGuide.bonusResultText,
    },
  };
}

function createReview19WeatherDraft(session: SessionData): SessionDraft {
  return {
    date: session.date,
    weekday: session.weekday,
    discountTime: "19",
    manualWeekdayOverride: session.manualWeekdayOverride,
    manualDiscountTimeOverride: false,
    weather: {
      ...session.weather,
      hourlyForecasts: cloneHourlyForecasts(session.weather.hourlyForecasts),
    },
  };
}
export function useNebikiApp(params?: { trainingStep?: TrainingStep }): UseNebikiAppResult {
  const trainingStep = params?.trainingStep ?? "step5";
  const trainingStepConfig = getTrainingStepConfig(trainingStep);
  const initialPersistenceRef = useRef<ReturnType<typeof loadPersistedNebikiState> | null>(null);

  if (!initialPersistenceRef.current) {
    initialPersistenceRef.current = loadPersistedNebikiState();
  }

  const initialLastUsedSessionDraft = buildStartDefaultDraft(
    initialPersistenceRef.current?.lastUsedSessionDraft ?? null
  );
  const initialToday = formatLocalDate(new Date());
  const initialLoadedState = shouldUseCheckpointInsteadOfCurrent({
    currentSession: initialPersistenceRef.current?.currentSession ?? null,
    checkpoint: initialPersistenceRef.current?.workSessionCheckpoint ?? null,
    today: initialToday,
  })
    ? initialPersistenceRef.current?.workSessionCheckpoint ?? null
    : initialPersistenceRef.current?.currentSession ?? null;

  const [state, setState] = useState<AppState>(() =>
    normalizeLoadedState(initialLoadedState, initialLastUsedSessionDraft)
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [nextSessionSkipRecords, setNextSessionSkipRecords] = useState<NextSessionSkipRecord[]>(() =>
    cloneSkipRecords(initialPersistenceRef.current?.nextSessionSkipRecords ?? [])
  );
  const [lastSessionWeather, setLastSessionWeather] = useState(() =>
    cloneLastSessionWeatherRecord(initialPersistenceRef.current?.lastSessionWeather ?? null)
  );
  const [lastUsedSessionDraft, setLastUsedSessionDraft] = useState<SessionDraft>(() =>
    normalizeSessionDraft(initialPersistenceRef.current?.lastUsedSessionDraft ?? null)
  );
  const [dailyMessageState, setDailyMessageState] = useState<DailyMessageState>(() =>
    normalizeDailyMessageState(initialPersistenceRef.current?.dailyMessageState ?? null)
  );
  const [areaCountRecords, setAreaCountRecords] = useState<AreaCountRecord[]>(() =>
    cloneAreaCountRecords(initialPersistenceRef.current?.areaCountRecords ?? [])
  );
  const [review19RecordsVersion, setReview19RecordsVersion] = useState(0);

  const [areaJudgeSelection, setAreaJudgeSelection] = useState<AreaJudge>(
    initialPersistenceRef.current?.runtimeState?.areaJudgeSelection ?? null
  );
  const [resumeTargetScreen, setResumeTargetScreen] = useState<ScreenName | null>(
    initialPersistenceRef.current?.runtimeState?.resumeTargetScreen ?? null
  );
  const [timeSwitchTarget, setTimeSwitchTarget] = useState<DiscountTime | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<NavigationSnapshot | null>(
    initialPersistenceRef.current?.runtimeState?.undoSnapshot ?? null
  );
  const [undoNotice, setUndoNotice] = useState<string | null>(null);
  const screenHistoryRef = useRef<NavigationSnapshot[]>(
    initialPersistenceRef.current?.runtimeState?.screenHistory ?? []
  );

  function buildNavigationSnapshot(baseState: AppState = state) {
    return createNavigationSnapshot({
      state: baseState,
      areaJudgeSelection,
      resumeTargetScreen,
      nextSessionSkipRecords,
      lastSessionWeather,
    });
  }

  function restoreNavigationSnapshot(snapshot: NavigationSnapshot): void {
    setNextSessionSkipRecords(cloneSkipRecords(snapshot.nextSessionSkipRecords));
    setLastSessionWeather(cloneLastSessionWeatherRecord(snapshot.lastSessionWeather));
    setState(cloneAppState(snapshot.state));
    setAreaJudgeSelection(snapshot.areaJudgeSelection);
    setResumeTargetScreen(snapshot.resumeTargetScreen);
    setTimeSwitchTarget(null);
  }
  const previousRenderRef = useRef<NavigationSnapshot | null>(null);
  const suppressHistoryPushRef = useRef(false);



  useEffect(() => {
    savePersistedNebikiState(
      clonePersistedNebikiStateSnapshot({
        currentSession: state,
        nextSessionSkipRecords,
        lastSessionWeather,
        lastUsedSessionDraft,
        dailyMessageState,
        areaCountRecords,
      })
    );

    if (state.session) {
      saveWorkSessionCheckpoint(cloneAppState(state));
    }
  }, [
    state,
    nextSessionSkipRecords,
    lastSessionWeather,
    lastUsedSessionDraft,
    dailyMessageState,
    areaCountRecords,
  ]);


  useEffect(() => {
    const historyResult = appendNavigationHistory({
      history: screenHistoryRef.current,
      previousSnapshot: previousRenderRef.current,
      nextState: state,
      suppressHistoryPush: suppressHistoryPushRef.current,
    });

    screenHistoryRef.current = historyResult.history;
    suppressHistoryPushRef.current = historyResult.suppressHistoryPush;
    previousRenderRef.current = buildNavigationSnapshot(state);
  }, [state, areaJudgeSelection, resumeTargetScreen, nextSessionSkipRecords, lastSessionWeather]);

  useEffect(() => {
    if (!previousRenderRef.current) return;

    previousRenderRef.current = cloneNavigationSnapshot({
      ...previousRenderRef.current,
      nextSessionSkipRecords: cloneSkipRecords(nextSessionSkipRecords),
      lastSessionWeather: cloneLastSessionWeatherRecord(lastSessionWeather),
    });
  }, [nextSessionSkipRecords, lastSessionWeather]);

  useEffect(() => {
    saveRuntimeState({
      areaJudgeSelection,
      resumeTargetScreen,
      timeSwitchTarget,
      undoSnapshot,
      screenHistory: screenHistoryRef.current,
    });
  }, [
    state,
    areaJudgeSelection,
    resumeTargetScreen,
    timeSwitchTarget,
    undoSnapshot,
    nextSessionSkipRecords,
    lastSessionWeather,
  ]);

  useEffect(() => {
    if (!undoNotice) return;

    const id = window.setTimeout(() => {
      setUndoNotice(null);
    }, 2500);

    return () => window.clearTimeout(id);
  }, [undoNotice]);

  useEffect(() => {
    if (state.screen !== "area_judge" || !state.currentAreaId) return;

    const nextSelection = state.areaProgressMap[state.currentAreaId]?.areaJudge ?? null;
    setAreaJudgeSelection(nextSelection);
  }, [state.screen, state.currentAreaId, state.areaProgressMap]);

  useEffect(() => {
    if (!state.session) return;

    const nextRecord = {
      date: state.session.date,
      discountTime: state.session.discountTime,
      nearTermWeather: getNearTermWeatherForDiscount(state.session.weather, state.session.discountTime),
    } as const;

    setLastSessionWeather((current) => {
      if (
        current?.date === nextRecord.date &&
        current?.discountTime === nextRecord.discountTime &&
        current?.nearTermWeather === nextRecord.nearTermWeather
      ) {
        return current;
      }

      return nextRecord;
    });
  }, [state.session?.startedAt]);

  useEffect(() => {
    const updateNow = () => setNowMs(Date.now());
    const onVisibilityChange = () => {
      if (!document.hidden) updateNow();
    };

    const id = window.setInterval(updateNow, 30000);
    window.addEventListener("focus", updateNow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", updateNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);


  useEffect(() => {
  if (state.screen !== "start") return;

  const syncDraftTime = () => {
    setState((prev) => {
      if (prev.screen !== "start") return prev;

      const now = new Date();
      const nowDiscountTime = resolveDiscountTime(now);
      const nowDate = formatLocalDate(now);
      const nowWeekday = now.getDay();

      const nextDraft = { ...prev.sessionDraft };
      let changed = false;

      if (nextDraft.date !== nowDate) {
        nextDraft.date = nowDate;
        changed = true;
      }

      if (
        !nextDraft.manualWeekdayOverride &&
        nextDraft.weekday !== nowWeekday
      ) {
        nextDraft.weekday = nowWeekday;
        changed = true;
      }

      if (
        !nextDraft.manualDiscountTimeOverride &&
        nextDraft.discountTime !== nowDiscountTime
      ) {
        nextDraft.discountTime = nowDiscountTime;
        changed = true;
      }

      if (!changed) return prev;

      return {
        ...prev,
        sessionDraft: nextDraft,
      };
    });
  };

  syncDraftTime();
  const id = window.setInterval(syncDraftTime, 30000);

  return () => window.clearInterval(id);
}, [state.screen]);

  useEffect(() => {
    if (state.screen !== "start") return;

    setState((prev) => {
      if (prev.screen !== "start") return prev;

      const nextDraft = syncAfterRainSelection(prev.sessionDraft, lastSessionWeather);

      if (nextDraft === prev.sessionDraft) {
        return prev;
      }

      return {
        ...prev,
        sessionDraft: nextDraft,
      };
    });
  }, [
    lastSessionWeather,
    state.screen,
    state.sessionDraft.date,
    state.sessionDraft.discountTime,
    state.sessionDraft.weather.hourlyForecasts,
    state.sessionDraft.weather.afterRainSky,
  ]);

  useEffect(() => {
    setLastUsedSessionDraft((current) => {
      const normalizedDraft = normalizeSessionDraft(state.sessionDraft);

      if (JSON.stringify(current) === JSON.stringify(normalizedDraft)) {
        return current;
      }

      return normalizedDraft;
    });
  }, [state.sessionDraft]);

  const sessionSource = state.session ?? state.sessionDraft;
  const sessionSourceResolvedWeather = useMemo(() => {
    return resolveWeatherInputForDiscount(sessionSource.weather, sessionSource.discountTime);
  }, [sessionSource.weather, sessionSource.discountTime]);
  const startDraftNearTermWeather = useMemo(() => {
    return getNearTermWeatherForDiscount(state.sessionDraft.weather, state.sessionDraft.discountTime);
  }, [state.sessionDraft.weather, state.sessionDraft.discountTime]);
  const currentAreaName = state.currentAreaId ? getAreaName(state.currentAreaId) : null;
  const activeSessionDate = state.session?.date ?? state.sessionDraft.date;

  const showBentoJudgeGuide =
    state.screen === "area_judge" &&
    state.currentAreaId === "bento_men" &&
    dailyMessageState.bentoJudgeGuideShownDate !== activeSessionDate;

  const showDailyNoticeBeforeRate =
    trainingStepConfig.noticeItemIds.length > 0 &&
    state.screen === "rate_display" &&
    state.session?.discountTime !== "20" &&
    dailyMessageState.rateNoticeShownDate !== activeSessionDate;

  const showAfterRainRecoverySelector = useMemo(() => {
    return shouldOfferAfterRainRecovery({
      sessionDate: state.sessionDraft.date,
      sessionDiscountTime: state.sessionDraft.discountTime,
      nearTermWeather: startDraftNearTermWeather,
      lastSessionWeather,
    });
  }, [
    state.sessionDraft.date,
    state.sessionDraft.discountTime,
    startDraftNearTermWeather,
    lastSessionWeather,
  ]);

  const weekdayText = useMemo(() => {
    return getWeekdayText(sessionSource.weekday);
  }, [sessionSource.weekday]);

  const timeText = useMemo(() => {
    return getBasisTimeText(sessionSource.discountTime);
  }, [sessionSource.discountTime]);

  const weekdayBaseInfo = useMemo(() => {
  return getWeekdayBaseInfo(
    sessionSource.weekday,
    sessionSource.discountTime,
    sessionSourceResolvedWeather,
    sessionSource.date
  );
}, [
  sessionSource.weekday,
  sessionSource.discountTime,
  sessionSourceResolvedWeather,
  sessionSource.date,
]);

  const lateTimeBonus = useMemo(() => {
  if (!state.session) return 0;
  if (state.session.discountTime === "20") return 0;

  // 手動で時刻を切り替えている場合は、実時間による +5% を適用しない
  if (state.session.manualDiscountTimeOverride) return 0;

  const now = new Date(nowMs);
  const minutes = now.getHours() * 60 + now.getMinutes();

  // 15時基準の値引中に16時を超えた
  if (state.session.discountTime === "15") {
    return minutes >= 16 * 60 ? 5 : 0;
  }

  // 17時基準の値引中に18時を超えたら、ユーザーが値引時刻を切り替えるまで +5% を維持する。
  if (state.session.discountTime === "17") {
    return minutes >= 18 * 60 ? 5 : 0;
  }

  // 18時30分基準の値引中に19時を超えたら、ユーザーが値引時刻を切り替えるまで +5% を維持する。
  if (state.session.discountTime === "18") {
    return minutes >= 19 * 60 ? 5 : 0;
  }

  // 19時30分基準の値引中に20時を超えたら、ユーザーが値引時刻を切り替えるまで +5% を維持する。
  if (state.session.discountTime === "19") {
    return minutes >= 20 * 60 ? 5 : 0;
  }

  return 0;
}, [state.session, nowMs]);

const lateTimeBonusNotice = useMemo(() => {
  if (!state.session || lateTimeBonus === 0) return null;

  if (state.session.discountTime === "15") {
    return "16時を過ぎたため値引率を5%上げています。";
  }

  if (state.session.discountTime === "17") {
    return "18時を過ぎたため値引率を5%上げています。";
  }

  if (state.session.discountTime === "18") {
    return "19時を過ぎたため値引率を5%上げています。";
  }

  if (state.session.discountTime === "19") {
    return "20時を過ぎたため値引率を5%上げています。";
  }

  return null;
}, [state.session, lateTimeBonus]);

const lateSkipNotice = useMemo(() => {
  if (!state.session || lateTimeBonus === 0) return null;

  if (state.session.discountTime === "15") {
    return "16時を過ぎたため、今回は5%強めて値引します。";
  }

  if (state.session.discountTime === "19") {
    return "20時を過ぎたため、今回は5%強めて値引します。";
  }

  return `次の基準時刻に近づいているため、今回は5%強めて値引します。
このエリアは次回の値引でスキップします。`;
}, [state.session, lateTimeBonus]);

    const basisGuide = useMemo(() => {
  const baseGuide = getBasisGuideDisplay({
    date: sessionSource.date,
    weekday: sessionSource.weekday,
    discountTime: sessionSource.discountTime,
    weather: sessionSourceResolvedWeather,
  });

  if (!lateTimeBonusNotice) {
    return baseGuide;
  }

  return {
    ...baseGuide,
    ...buildMergedBonusDisplay({
      baseBonusParts: baseGuide.bonusCalcParts,
      baseRateBonus: weekdayBaseInfo.baseRateBonus,
      lateTimeBonus,
    }),
  };
}, [
  sessionSource.weekday,
  sessionSource.discountTime,
  sessionSourceResolvedWeather,
  lateTimeBonusNotice,
  lateTimeBonus,
  weekdayBaseInfo.baseRateBonus,
  sessionSource.date,
]);

  const ignoreNormalTimeRateCap = shouldIgnoreNormalTimeRateCap(sessionSourceResolvedWeather);

  const weatherGuideText = useMemo(() => {
    return getWeatherGuideText();
  }, []);

  const currentAreaProgress = useMemo(() => {
    if (!state.currentAreaId) return null;
    return state.areaProgressMap[state.currentAreaId];
  }, [state.currentAreaId, state.areaProgressMap]);




  const rateDisplay = useMemo(() => {
    if (!state.session || !currentAreaProgress) return null;
    if (state.session.discountTime === "20") return null;
    if (!currentAreaProgress.areaJudge) return null;

    return getNormalTimeRateDisplay({
      discountTime: state.session.discountTime,
      weatherBonus: weekdayBaseInfo.baseRateBonus + lateTimeBonus,
      areaJudge: currentAreaProgress.areaJudge,
      isSunday: state.session.weekday === 0 && state.session.discountTime === "15",
      ignoreTimeRateCap: ignoreNormalTimeRateCap,
      weekdayBase: weekdayBaseInfo.adjusted,
      areaRateAdjustment: currentAreaProgress.areaRateAdjustment,
    });
  }, [
  state.session,
  currentAreaProgress,
  weekdayBaseInfo.baseRateBonus,
  lateTimeBonus,
  ignoreNormalTimeRateCap,
  weekdayBaseInfo.adjusted,
  currentAreaProgress?.areaRateAdjustment,
]);
  const finalGuide = useMemo(() => {
  if (!state.session || state.session.discountTime !== "20") return null;

  return getFinalTimeGuide({
    weekdayShift: weekdayBaseInfo.weekdayShift,
    rateBonus: weekdayBaseInfo.baseRateBonus,
  });
}, [state.session, weekdayBaseInfo.weekdayShift, weekdayBaseInfo.baseRateBonus]);

  const doneSummaryItems = useMemo<DoneSummaryItem[]>(() => {
    const session = state.session;
    if (!session || session.discountTime === "20") return [];

    const discountTime = session.discountTime;
    const baseWeatherBonus = weekdayBaseInfo.baseRateBonus + lateTimeBonus;

    return DONE_SUMMARY_ROUTE.map((areaId) => {
      const weatherBonus = baseWeatherBonus;
      const progress = state.areaProgressMap[areaId];
      const statusText = progress ? getAreaStatusText(progress) : "未完了";

      if (progress?.status === "auto_skipped_late_time") {
        const previousNormalRateText =
          progress.previousNormalRateText ?? progress.previousRateText ?? "前回値引率不明";
        const previousManyRateText =
          progress.previousManyRateText ?? progress.previousRateText ?? "前回値引率不明";

        return {
          areaId,
          areaName: getAreaName(areaId),
          judgeText: "前回+5%済み",
          rateText: previousNormalRateText,
          manyRateText: previousManyRateText,
          manyNote: progress.previousManyNote,
          normalRateText: previousNormalRateText,
          statusText,
        };
      }

      if (!progress || !progress.areaJudge || progress.status !== "completed") {
        return {
          areaId,
          areaName: getAreaName(areaId),
          judgeText: progress ? getAreaJudgeText(progress.areaJudge) : "未判定",
          rateText: "未完了",
          manyRateText: "未完了",
          normalRateText: "未完了",
          statusText,
        };
      }

      const display = getNormalTimeRateDisplay({
        discountTime,
        weatherBonus,
        areaJudge: progress.areaJudge,
        isSunday: session.weekday === 0 && discountTime === "15",
        ignoreTimeRateCap: ignoreNormalTimeRateCap,
        weekdayBase: weekdayBaseInfo.adjusted,
        areaRateAdjustment: progress.areaRateAdjustment,
      });

      const completedNormalRateText = getProgressNormalRateText(progress) ?? display.normal.main;
      const completedManyRateText = getProgressManyRateText(progress) ?? display.many.main;

      return {
        areaId,
        areaName: getAreaName(areaId),
        judgeText: progress.areaCountEvaluation
          ? getAreaCountEvaluationText(progress.areaCountEvaluation)
          : getAreaJudgeText(progress.areaJudge),
        rateText: completedNormalRateText,
        manyRateText: completedManyRateText,
        manyNote: progress.completedManyNote ?? display.many.note,
        normalRateText: completedNormalRateText,
        statusText,
      };
    });
  }, [
    state.session,
    state.areaProgressMap,
    weekdayBaseInfo.baseRateBonus,
    lateTimeBonus,
    ignoreNormalTimeRateCap,
    weekdayBaseInfo.adjusted,
  ]);

  const review19Items = useMemo(() => {
    const ratings = state.review19?.ratings;
    const excludedAreaIdSet = new Set(state.review19?.excludedAreaIds ?? []);

    return getReview19AreaItems().map((item) => {
      const excluded = excludedAreaIdSet.has(item.areaId);
      const excludeReason = state.review19?.excludeReasons?.[item.areaId];

      return {
        ...item,
        rating: ratings?.[item.areaId] ?? ("just_right" as Review19Rating),
        excluded,
        excludeReasonText: excluded
          ? REVIEW19_EXCLUDE_REASON_TEXT[excludeReason ?? "few_at_15_and_17"]
          : undefined,
      };
    });
  }, [state.review19]);

  const review19ReferenceLines = useMemo(() => {
    const reference = state.review19?.reference;
    if (!reference) return [];

    const lines: string[] = [];
    lines.push(`曜日基準：${reference.basis.originalWeekdayBase} → ${reference.basis.adjustedWeekdayBase}`);

    if (reference.basis.bonusSummaryText) {
      lines.push(reference.basis.bonusSummaryText);
    }

    if (reference.basis.weekdayResultText) {
      lines.push(reference.basis.weekdayResultText);
    }

    if (reference.basis.bonusResultText) {
      lines.push(reference.basis.bonusResultText);
    }

    return lines;
  }, [state.review19]);

  const review19Export = (() => {
    void review19RecordsVersion;
    const unexportedCount = getUnexportedReview19Records(loadReview19Records()).length;
    return {
      unexportedCount,
      canExportTen: unexportedCount >= 10,
    };
  })();

  const canStartReview19Manually = canStartReview19FromCurrentState({
    state,
    now: new Date(nowMs),
  });


  const doneNextSessionInfo = state.session
    ? getNextDoneDiscountInfo(state.session.discountTime, new Date(nowMs))
    : null;

  const pendingBanner = useMemo<PendingBannerInfo | null>(() => {
    if (state.currentFlow !== "pending" || !state.currentAreaId) return null;

    const progress = state.areaProgressMap[state.currentAreaId];
    if (!progress) return null;

    if (progress.status !== "skipped_manual" && progress.status !== "postponed_few") {
      return null;
    }

    return {
      remainingCount: getPendingRemainingCount(state.areaProgressMap),
      reason: progress.status === "skipped_manual" ? "manual" : "few",
    };
  }, [state.currentFlow, state.currentAreaId, state.areaProgressMap]);

  const allSkipTargetOptions = useMemo<SkipTargetOption[]>(() => {
    if (!state.currentAreaId) return [];

    return getSkipTargetOptions({
      areaProgressMap: state.areaProgressMap,
      currentAreaId: state.currentAreaId,
    });
  }, [state.currentAreaId, state.areaProgressMap]);

  const canChooseSkipTarget = useMemo(() => {
    if (!state.currentAreaId) return false;
    return allSkipTargetOptions.length > 0;
  }, [allSkipTargetOptions.length, state.currentAreaId]);

  const skipTargetOptions = useMemo<SkipTargetOption[]>(() => {
    if (!canChooseSkipTarget) return [];
    return allSkipTargetOptions;
  }, [allSkipTargetOptions, canChooseSkipTarget]);

  function moveToNextPendingOrDone(params: {
    prev: AppState;
    updatedMap: Record<AreaId, AreaProgress>;
    referenceAreaId: AreaId;
    deferredAreaIds?: AreaId[];
    preferredNextReason?: PendingReason | null;
    nextSession: SessionData | null;
    timeSwitchNotice: string | null;
  }): AppState {
    const effectiveDeferredAreaIds =
      params.deferredAreaIds ?? params.prev.pendingDeferredAreaIds;

    if (params.nextSession?.discountTime === "20") {
      return {
        ...params.prev,
        session: params.nextSession,
        timeSwitchNotice: params.timeSwitchNotice,
        areaProgressMap: params.updatedMap,
        currentAreaId: null,
        lastReferenceAreaId: params.referenceAreaId,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        finalTimeStep: 0,
        screen: "final_time",
      };
    }

    const nextCandidate = getNextPendingCandidate({
      areaProgressMap: params.updatedMap,
      referenceAreaId: params.referenceAreaId,
      deferredAreaIds: effectiveDeferredAreaIds,
      preferredReason: params.preferredNextReason ?? null,
    });

    if (!nextCandidate) {
      const nextNormalFlowAreaId = getNextNormalFlowAreaIdWithWrap(
        params.updatedMap,
        params.referenceAreaId
      );

      if (nextNormalFlowAreaId) {
        return {
          ...params.prev,
          session: params.nextSession,
          timeSwitchNotice: params.timeSwitchNotice,
          areaProgressMap: params.updatedMap,
          currentAreaId: nextNormalFlowAreaId,
          lastReferenceAreaId: params.referenceAreaId,
          currentFlow: "normal",
          pendingDeferredAreaIds: [],
          finalTimeStep: 0,
          screen: getNormalFlowScreenForArea(params.updatedMap, nextNormalFlowAreaId),
        };
      }

      return {
        ...params.prev,
        session: params.nextSession,
        timeSwitchNotice: params.timeSwitchNotice,
        areaProgressMap: params.updatedMap,
        currentAreaId: null,
        lastReferenceAreaId: params.referenceAreaId,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        finalTimeStep: 0,
        screen: "done",
      };
    }

    const nextProgress = params.updatedMap[nextCandidate.areaId];
    const nextScreen =
      nextCandidate.reason === "manual"
        ? getPendingResumeScreen(nextProgress)
        : "rate_display";
    const nextDeferredAreaIds =
      params.prev.currentFlow === "pending" || effectiveDeferredAreaIds.includes(params.referenceAreaId)
        ? effectiveDeferredAreaIds
        : [...effectiveDeferredAreaIds, params.referenceAreaId];

    return {
      ...params.prev,
      session: params.nextSession,
      timeSwitchNotice: params.timeSwitchNotice,
      areaProgressMap: params.updatedMap,
      currentAreaId: nextCandidate.areaId,
      lastReferenceAreaId: params.referenceAreaId,
      currentFlow: "pending",
      pendingDeferredAreaIds: nextDeferredAreaIds,
      finalTimeStep: 0,
      screen: nextScreen,
    };
  }

  function updateSessionDraft(patch: Partial<SessionDraft>) {
    setState((prev) => {
      const mergedDraft: SessionDraft = {
        ...prev.sessionDraft,
        ...patch,
        weather: {
          ...prev.sessionDraft.weather,
          ...(patch.weather ?? {}),
        },
      };

      return {
        ...prev,
        sessionDraft: syncAfterRainSelection(mergedDraft, lastSessionWeather),
      };
    });
  }

  function buildDraftFromSource(source: SessionData | SessionDraft): SessionDraft {
    return syncAfterRainSelection(normalizeSessionDraft(source), lastSessionWeather);
  }

  function createUndoSnapshot(baseState: AppState = state) {
    return buildNavigationSnapshot(baseState);
  }

  function resolveResumeState(prev: AppState, nextSession: SessionData, requestedScreen: ScreenName) {
    if (nextSession.discountTime === "20") {
      return {
        screen: "final_time" as const,
        currentAreaId: null,
        lastReferenceAreaId: prev.lastReferenceAreaId,
        finalTimeStep: prev.finalTimeStep,
      };
    }

    const fallbackAreaId =
      prev.currentAreaId ??
      prev.lastReferenceAreaId ??
      getFirstAvailableAreaId(prev.areaProgressMap);

    if (!fallbackAreaId) {
      return {
        screen: "done" as const,
        currentAreaId: null,
        lastReferenceAreaId: prev.lastReferenceAreaId,
        finalTimeStep: 0 as const,
      };
    }

    const progress = prev.areaProgressMap[fallbackAreaId];

    if (requestedScreen === "done") {
      return {
        screen: "done" as const,
        currentAreaId: null,
        lastReferenceAreaId: fallbackAreaId,
        finalTimeStep: 0 as const,
      };
    }

    if (requestedScreen === "rate_display" && progress.areaJudge) {
      return {
        screen: "rate_display" as const,
        currentAreaId: fallbackAreaId,
        lastReferenceAreaId: fallbackAreaId,
        finalTimeStep: 0 as const,
      };
    }

    if (requestedScreen === "area_judge" || !progress.areaJudge) {
      return {
        screen: "area_judge" as const,
        currentAreaId: fallbackAreaId,
        lastReferenceAreaId: fallbackAreaId,
        finalTimeStep: 0 as const,
      };
    }

    return {
      screen: "rate_display" as const,
      currentAreaId: fallbackAreaId,
      lastReferenceAreaId: fallbackAreaId,
      finalTimeStep: 0 as const,
    };
  }

  function applyAreaJudgeSelection(
    prev: AppState,
    selection: Exclude<AreaJudge, null>,
    areaCount?: number | null,
    areaCountResult?: {
      evaluation?: AreaCountEvaluation;
      rateAdjustment?: AreaRateAdjustment;
    }
  ): AppState {
    if (!prev.currentAreaId) return prev;
    const currentAreaId = prev.currentAreaId;

    if (selection === "many" || selection === "normal") {
      return {
        ...prev,
        screen: "rate_display",
        timeSwitchNotice: null,
        finalTimeStep: 0,
        review19ExcludedAreaIds: prev.session?.discountTime === "17"
          ? removeReview19ExcludedAreaId(prev.review19ExcludedAreaIds, currentAreaId)
          : prev.review19ExcludedAreaIds,
        areaProgressMap: {
          ...prev.areaProgressMap,
          [currentAreaId]: {
            ...prev.areaProgressMap[currentAreaId],
            areaJudge: selection,
            areaCount: areaCount ?? prev.areaProgressMap[currentAreaId].areaCount,
            areaCountEvaluation: areaCountResult?.evaluation,
            areaRateAdjustment: areaCountResult?.rateAdjustment,
            visitedAt: new Date().toISOString(),
          },
        },
      };
    }

    const { nextSession, timeSwitchNotice } = refreshSessionDiscountTime(prev.session);

    const currentVisitedAt = new Date().toISOString();
    const nextReview19ExcludedAreaIds = prev.session?.discountTime === "15"
      ? addReview19ExcludedAreaId(prev.review19ExcludedAreaIds, currentAreaId)
      : prev.review19ExcludedAreaIds;
    const judgedCurrentMap = {
      ...prev.areaProgressMap,
      [currentAreaId]: {
        ...prev.areaProgressMap[currentAreaId],
        areaJudge: "few" as const,
        areaCount: areaCount ?? prev.areaProgressMap[currentAreaId].areaCount,
        areaCountEvaluation: areaCountResult?.evaluation,
        areaRateAdjustment: areaCountResult?.rateAdjustment,
        visitedAt: currentVisitedAt,
      },
    };

    const updatedMap = {
      ...prev.areaProgressMap,
      [currentAreaId]: {
        ...prev.areaProgressMap[currentAreaId],
        areaJudge: "few" as const,
        areaCount: areaCount ?? prev.areaProgressMap[currentAreaId].areaCount,
        areaCountEvaluation: areaCountResult?.evaluation,
        areaRateAdjustment: areaCountResult?.rateAdjustment,
        status: "postponed_few" as const,
        skipReason: "few" as const,
        visitedAt: currentVisitedAt,
      },
    };

    if (nextSession?.discountTime === "20") {
      return {
        ...prev,
        session: nextSession,
        timeSwitchNotice,
        review19ExcludedAreaIds: nextReview19ExcludedAreaIds,
        areaProgressMap: updatedMap,
        currentAreaId: null,
        lastReferenceAreaId: currentAreaId,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        finalTimeStep: 0,
        screen: "final_time",
      };
    }

    if (!hasRemainingNormalFlowArea(judgedCurrentMap, currentAreaId)) {
      return {
        ...prev,
        session: nextSession,
        timeSwitchNotice,
        review19ExcludedAreaIds: nextReview19ExcludedAreaIds,
        areaProgressMap: judgedCurrentMap,
        currentAreaId,
        lastReferenceAreaId: currentAreaId,
        finalTimeStep: 0,
        screen: "rate_display",
      };
    }

    if (prev.currentFlow === "pending") {
      const nextDeferredAreaIds = [...prev.pendingDeferredAreaIds, currentAreaId];

      return moveToNextPendingOrDone({
        prev,
        updatedMap,
        referenceAreaId: currentAreaId,
        deferredAreaIds: nextDeferredAreaIds,
        nextSession,
        timeSwitchNotice,
      });
    }

    const nextAreaId = getNextNormalFlowAreaId(updatedMap, currentAreaId);

    if (nextAreaId) {
      return {
        ...prev,
        session: nextSession,
        timeSwitchNotice,
        review19ExcludedAreaIds: nextReview19ExcludedAreaIds,
        areaProgressMap: updatedMap,
        currentAreaId: nextAreaId,
        lastReferenceAreaId: currentAreaId,
        pendingDeferredAreaIds: [],
        finalTimeStep: 0,
        screen: getNormalFlowScreenForArea(updatedMap, nextAreaId),
      };
    }

    return moveToNextPendingOrDone({
      prev,
      updatedMap,
      referenceAreaId: currentAreaId,
      nextSession,
      timeSwitchNotice,
    });
  }

  function startSession() {
    const now = new Date();
    const startedAt = now.toISOString();
    const currentDate = formatLocalDate(now);
    const currentWeekday = now.getDay();
    const currentDiscountTime = resolveDiscountTime(now);

    let nextSkipRecords = nextSessionSkipRecords;

    setState((prev) => {
      const resolvedDiscountTime = prev.sessionDraft.manualDiscountTimeOverride
        ? prev.sessionDraft.discountTime
        : currentDiscountTime;

      const nextSession: SessionData = {
        ...prev.sessionDraft,
        date: currentDate,
        weekday: prev.sessionDraft.manualWeekdayOverride
          ? prev.sessionDraft.weekday
          : currentWeekday,
        discountTime: resolvedDiscountTime,
        weather: {
          ...prev.sessionDraft.weather,
          hourlyForecasts: cloneHourlyForecasts(prev.sessionDraft.weather.hourlyForecasts),
        },
        startedAt: prev.session?.startedAt ?? startedAt,
      };


      if (timeSwitchTarget && prev.session) {
        let areaProgressMap = createInitialAreaProgressMap();
        if (nextSession.discountTime === "18" || nextSession.discountTime === "19") {
          const consumed = consumeSkipRecordsInMemory({
            currentRecords: nextSkipRecords,
            date: nextSession.date,
            targetDiscountTime: nextSession.discountTime,
          });

          nextSkipRecords = consumed.remainingRecords;
          areaProgressMap = createAreaProgressMapWithAutoSkippedAreas(
            consumed.skippedRecords
          );
        }

        const firstAreaId =
          nextSession.discountTime === "20"
            ? null
            : getFirstNormalFlowAreaId(areaProgressMap);
        const nextReview19ExcludedAreaIds =
          prev.session.discountTime === "15" && nextSession.discountTime === "17"
            ? normalizeReview19ExcludedAreaIds([
                ...prev.review19ExcludedAreaIds,
                ...NORMAL_ROUTE.filter((areaId) => prev.areaProgressMap[areaId]?.areaJudge === "few"),
              ])
            : nextSession.discountTime === "15"
            ? []
            : prev.review19ExcludedAreaIds;

        return {
          ...prev,
          screen:
            nextSession.discountTime === "20"
              ? "final_time"
              : firstAreaId
              ? getNormalFlowScreenForArea(areaProgressMap, firstAreaId)
              : "done",
          session: {
            ...nextSession,
            startedAt,
          },
          areaProgressMap,
          currentAreaId: firstAreaId,
          lastReferenceAreaId: firstAreaId,
          currentFlow: "normal",
          pendingDeferredAreaIds: [],
          timeSwitchNotice: buildTimeSwitchNotice(nextSession.discountTime),
          review19ExcludedAreaIds: nextReview19ExcludedAreaIds,
          finalTimeStep: 0,
        };
      }

      if (prev.session) {
        const requestedScreen =
          resumeTargetScreen ??
          (prev.session.discountTime === "20" ? "final_time" : "area_judge");

        const resumeState = resolveResumeState(prev, nextSession, requestedScreen);

        return {
          ...prev,
          session: nextSession,
          screen: resumeState.screen,
          currentAreaId: resumeState.currentAreaId,
          lastReferenceAreaId: resumeState.lastReferenceAreaId,
          timeSwitchNotice: null,
          finalTimeStep: resumeState.finalTimeStep,
        };
      }

      let areaProgressMap = createInitialAreaProgressMap();
      if (nextSession.discountTime === "18" || nextSession.discountTime === "19") {
        const consumed = consumeSkipRecordsInMemory({
          currentRecords: nextSessionSkipRecords,
          date: nextSession.date,
          targetDiscountTime: nextSession.discountTime,
        });

        nextSkipRecords = consumed.remainingRecords;
        areaProgressMap = createAreaProgressMapWithAutoSkippedAreas(
          consumed.skippedRecords
        );
      }

      const firstAreaId =
        nextSession.discountTime === "20"
          ? null
          : getFirstNormalFlowAreaId(areaProgressMap);

      return {
        ...prev,
        screen:
          nextSession.discountTime === "20"
            ? "final_time"
            : firstAreaId
            ? getNormalFlowScreenForArea(areaProgressMap, firstAreaId)
            : "done",
        session: nextSession,
        areaProgressMap,
        currentAreaId: firstAreaId,
        lastReferenceAreaId: firstAreaId,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        timeSwitchNotice: null,
        finalTimeStep: 0,
      };
    });

    setNextSessionSkipRecords(cloneSkipRecords(nextSkipRecords));
    setResumeTargetScreen(null);
    setTimeSwitchTarget(null);
    setUndoSnapshot(null);
    setUndoNotice(null);
  }

  const areaCountAssistEnabled = Boolean(
    state.session &&
    isAreaCountAssistTarget({
      areaId: state.currentAreaId,
      discountTime: state.session.discountTime,
    })
  );

  const areaCountSameItemLimit = areaCountAssistEnabled && state.session
    ? getAreaCountSameItemLimit({
        weekdayBase: weekdayBaseInfo.adjusted,
      })
    : null;

  function getCurrentAreaCountRecommendation(count: number) {
    return buildAreaCountRecommendation({
      records: areaCountRecords,
      areaId: state.currentAreaId,
      discountTime: state.session?.discountTime,
      weekday: state.session?.weekday,
      weather: state.session?.weather,
      date: state.session?.date,
      count,
    });
  }

  function markBentoJudgeGuideShown() {
    const shownDate = activeSessionDate;

    setDailyMessageState((current) => {
      if (current.bentoJudgeGuideShownDate === shownDate) return current;

      return {
        ...current,
        bentoJudgeGuideShownDate: shownDate,
      };
    });
  }

  function confirmDailyNotice() {
    const shownDate = activeSessionDate;

    setDailyMessageState((current) => {
      if (current.rateNoticeShownDate === shownDate) return current;

      return {
        ...current,
        rateNoticeShownDate: shownDate,
      };
    });
  }


  function judgeCurrentArea(
    judge: Exclude<AreaJudge, null>,
    areaCount?: number | null,
    manualAreaCountEvaluation?: AreaCountEvaluation
  ) {
    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);

    const roundedAreaCount =
      typeof areaCount === "number" && Number.isFinite(areaCount) && areaCount >= 0
        ? Math.round(areaCount)
        : null;

    const areaCountRecommendation = roundedAreaCount !== null
      ? getCurrentAreaCountRecommendation(roundedAreaCount)
      : null;
    const readyAreaCountResult =
      areaCountRecommendation?.status === "ready" &&
      areaCountRecommendation.suggestedEvaluation &&
      areaCountRecommendation.areaRateAdjustment !== undefined
        ? {
            evaluation: areaCountRecommendation.suggestedEvaluation,
            rateAdjustment: areaCountRecommendation.areaRateAdjustment,
          }
        : undefined;
    const manualAreaCountResult =
      roundedAreaCount !== null && manualAreaCountEvaluation
        ? {
            evaluation: manualAreaCountEvaluation,
            rateAdjustment: getAreaCountRateAdjustment(manualAreaCountEvaluation),
          }
        : undefined;
    const effectiveAreaCountResult = readyAreaCountResult ?? manualAreaCountResult;

    // エリア残数判定が使える場合、エリア判定は5段階結果で固定する。
    // ここでの「少ない」はエリア全体の-10%補正であり、後回しにはしない。
    const effectiveJudge: Exclude<AreaJudge, null> = effectiveAreaCountResult ? "normal" : judge;
    setAreaJudgeSelection(effectiveJudge);

    if (
      roundedAreaCount !== null &&
      state.session &&
      state.currentAreaId &&
      isAreaCountAssistTarget({
        areaId: state.currentAreaId,
        discountTime: state.session.discountTime,
      })
    ) {
      const recordedAt = new Date().toISOString();
      const nextRecord: AreaCountRecord = {
        date: state.session.date,
        sessionStartedAt: state.session.startedAt,
        recordedAt,
        areaId: state.currentAreaId,
        discountTime: state.session.discountTime,
        weekdayBase: weekdayBaseInfo.adjusted,
        actualWeekday: getActualWeekdayLabel(state.session.weekday),
        actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({
          weekday: state.session.weekday,
          discountTime: state.session.discountTime,
        }),
        count: roundedAreaCount,
        userJudge: effectiveJudge,
        suggestedEvaluation: effectiveAreaCountResult?.evaluation,
        areaRateAdjustment: effectiveAreaCountResult?.rateAdjustment,
        comfortPoint: areaCountRecommendation?.comfortPoint,
      };

      setAreaCountRecords((current) => upsertAreaCountRecord(current, nextRecord));
    }

    setState((prev) =>
      applyAreaJudgeSelection(prev, effectiveJudge, roundedAreaCount, effectiveAreaCountResult)
    );
  }

  function goBackOneScreen() {
    const historyResult = popNavigationHistory(screenHistoryRef.current);
    if (!historyResult.previousSnapshot) return;

    screenHistoryRef.current = historyResult.history;
    suppressHistoryPushRef.current = true;
    restoreNavigationSnapshot(historyResult.previousSnapshot);
    setUndoNotice(null);
  }

  function startEditingConditions() {
    if (state.screen === "start") return;

    setResumeTargetScreen(state.screen);
    setState((prev) => ({
      ...prev,
      screen: "start",
      sessionDraft: buildDraftFromSource(prev.session ?? prev.sessionDraft),
      timeSwitchNotice: null,
    }));
  }

  function undoLastAction() {
    if (!undoSnapshot) return;

    suppressHistoryPushRef.current = true;
    restoreNavigationSnapshot(undoSnapshot);
    setUndoSnapshot(null);
    setUndoNotice("直前の操作を取り消しました");
  }

  function skipCurrentArea() {
    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);

    setState((prev) => {
      if (!prev.currentAreaId) return prev;
      const currentAreaId = prev.currentAreaId;
      const currentProgress = prev.areaProgressMap[currentAreaId];
      const { nextSession, timeSwitchNotice } = refreshSessionDiscountTime(prev.session);

      if (prev.currentFlow === "pending") {
        const nextDeferredAreaIds = [...prev.pendingDeferredAreaIds, currentAreaId];

        return moveToNextPendingOrDone({
          prev,
          updatedMap: prev.areaProgressMap,
          referenceAreaId: currentAreaId,
          deferredAreaIds: nextDeferredAreaIds,
          nextSession,
          timeSwitchNotice,
        });
      }

      const updatedMap = {
        ...prev.areaProgressMap,
        [currentAreaId]: {
          ...currentProgress,
          status: "skipped_manual" as const,
          skipReason: "manual" as const,
        },
      };

      if (nextSession?.discountTime === "20") {
        return {
          ...prev,
          session: nextSession,
          timeSwitchNotice,
          areaProgressMap: updatedMap,
          currentAreaId: null,
          lastReferenceAreaId: currentAreaId,
          currentFlow: "normal",
          pendingDeferredAreaIds: [],
          finalTimeStep: 0,
          screen: "final_time",
        };
      }

      const nextAreaId = getNextNormalFlowAreaId(updatedMap, currentAreaId);

      if (nextAreaId) {
        return {
          ...prev,
          session: nextSession,
          timeSwitchNotice,
          areaProgressMap: updatedMap,
          currentAreaId: nextAreaId,
          lastReferenceAreaId: currentAreaId,
          pendingDeferredAreaIds: [],
          finalTimeStep: 0,
          screen: getNormalFlowScreenForArea(updatedMap, nextAreaId),
        };
      }

      return moveToNextPendingOrDone({
        prev,
        updatedMap,
        referenceAreaId: currentAreaId,
        nextSession,
        timeSwitchNotice,
      });
    });
  }


  function chooseSkipTargetArea(targetAreaId: AreaId) {
    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);

    setState((prev) => {
      if (!prev.currentAreaId || prev.currentAreaId === targetAreaId) return prev;

      const targetProgress = prev.areaProgressMap[targetAreaId];
      if (!targetProgress || targetProgress.status === "completed") return prev;

      return {
        ...prev,
        currentAreaId: targetAreaId,
        lastReferenceAreaId: prev.currentAreaId,
        screen: getPendingResumeScreen(targetProgress),
        currentFlow:
          targetProgress.status === "skipped_manual" || targetProgress.status === "postponed_few"
            ? "pending"
            : "normal",
        pendingDeferredAreaIds:
          targetProgress.status === "skipped_manual" || targetProgress.status === "postponed_few"
            ? [prev.currentAreaId]
            : [],
        timeSwitchNotice: null,
      };
    });
  }

  function goToNextArea() {
    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);

    let nextSkipRecords = nextSessionSkipRecords;

    setState((prev) => {
      if (!prev.currentAreaId) return prev;
      const currentAreaId = prev.currentAreaId;
      const { nextSession, timeSwitchNotice } = refreshSessionDiscountTime(prev.session);
      const rateSnapshot = buildCompletedRateSnapshot({
        session: prev.session,
        progress: prev.areaProgressMap[currentAreaId],
        weatherBonus: weekdayBaseInfo.baseRateBonus + lateTimeBonus,
        weekdayBase: weekdayBaseInfo.adjusted,
      });

      const updatedMap = {
        ...prev.areaProgressMap,
        [currentAreaId]: {
          ...prev.areaProgressMap[currentAreaId],
          status: "completed" as const,
          completedAt: new Date().toISOString(),
          ...rateSnapshot,
        },
      };

      // 次回スキップ予約は「次のエリアへ」で完遂した時点で作る。
      // ただし直後に「戻る」または取り消しを押した場合は、
      // NavigationSnapshot から nextSessionSkipRecords も復元されるため予約も取り消される。
      if (
        prev.session &&
        lateTimeBonus > 0 &&
        !prev.session.manualDiscountTimeOverride
      ) {
        const targetDiscountTime = getNextSkipTargetDiscountTime(prev.session.discountTime);

        if (targetDiscountTime) {
          nextSkipRecords = appendSkipRecordsInMemory({
            currentRecords: nextSkipRecords,
            recordsToAdd: [
              buildNextSessionSkipRecord({
                date: prev.session.date,
                targetDiscountTime,
                areaId: currentAreaId,
                rateSnapshot,
              }),
            ],
          });
        }
      }

      if (prev.currentFlow === "pending") {
        return moveToNextPendingOrDone({
          prev,
          updatedMap,
          referenceAreaId: currentAreaId,
          nextSession,
          timeSwitchNotice,
        });
      }

      if (nextSession?.discountTime === "20") {
        return {
          ...prev,
          session: nextSession,
          timeSwitchNotice,
          areaProgressMap: updatedMap,
          currentAreaId: null,
          lastReferenceAreaId: currentAreaId,
          currentFlow: "normal",
          pendingDeferredAreaIds: [],
          finalTimeStep: 0,
          screen: "final_time",
        };
      }

      const nextAreaId = getNextNormalFlowAreaId(updatedMap, currentAreaId);

      if (nextAreaId) {
        return {
          ...prev,
          session: nextSession,
          timeSwitchNotice,
          areaProgressMap: updatedMap,
          currentAreaId: nextAreaId,
          lastReferenceAreaId: currentAreaId,
          pendingDeferredAreaIds: [],
          finalTimeStep: 0,
          screen: getNormalFlowScreenForArea(updatedMap, nextAreaId),
        };
      }

      return moveToNextPendingOrDone({
        prev,
        updatedMap,
        referenceAreaId: currentAreaId,
        nextSession,
        timeSwitchNotice,
      });
    });

    setNextSessionSkipRecords(cloneSkipRecords(nextSkipRecords));
  }

  function acknowledgeAutoSkippedArea() {
    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);

    setState((prev) => {
      if (!prev.currentAreaId) return prev;
      const currentAreaId = prev.currentAreaId;
      const currentProgress = prev.areaProgressMap[currentAreaId];

      if (currentProgress?.status !== "auto_skipped_late_time") return prev;

      const acknowledgedAt = new Date().toISOString();
      const updatedMap = {
        ...prev.areaProgressMap,
        [currentAreaId]: {
          ...currentProgress,
          visitedAt: currentProgress.visitedAt ?? acknowledgedAt,
          completedAt: currentProgress.completedAt ?? acknowledgedAt,
        },
      };

      const nextAreaId = getNextNormalFlowAreaId(updatedMap, currentAreaId);

      if (nextAreaId) {
        return {
          ...prev,
          areaProgressMap: updatedMap,
          currentAreaId: nextAreaId,
          lastReferenceAreaId: currentAreaId,
          currentFlow: "normal",
          pendingDeferredAreaIds: [],
          timeSwitchNotice: null,
          finalTimeStep: 0,
          screen: getNormalFlowScreenForArea(updatedMap, nextAreaId),
        };
      }

      return moveToNextPendingOrDone({
        prev,
        updatedMap,
        referenceAreaId: currentAreaId,
        nextSession: prev.session,
        timeSwitchNotice: null,
      });
    });
  }

  function advanceFinalTimeStep() {
    if (state.screen !== "final_time") return;

    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);
    setState((prev) => ({
      ...prev,
      finalTimeStep: Math.min(3, prev.finalTimeStep + 1) as AppState["finalTimeStep"],
    }));
  }


  function startReview19Manually() {
    setUndoSnapshot(null);
    setUndoNotice(null);

    setState((prev) => {
      if (prev.screen !== "done" && prev.screen !== "start") return prev;
      const now = new Date(nowMs);
      if (!canStartReview19FromCurrentState({ state: prev, now })) return prev;

      const currentDate = formatLocalDate(now);
      const currentWeekday = now.getDay();
      const sourceState = prev.session?.date === currentDate
        ? prev
        : normalizeLoadedState(loadReview19SourceState(), prev.sessionDraft);
      const sourceSession = sourceState.session?.date === currentDate ? sourceState.session : null;
      const session: SessionData = sourceSession ?? {
        ...prev.sessionDraft,
        date: currentDate,
        weekday: prev.sessionDraft.manualWeekdayOverride
          ? prev.sessionDraft.weekday
          : currentWeekday,
        discountTime: "17",
        weather: {
          ...prev.sessionDraft.weather,
          hourlyForecasts: cloneHourlyForecasts(prev.sessionDraft.weather.hourlyForecasts),
        },
        startedAt: now.toISOString(),
      };
      const sourceStateForReview = sourceSession ? sourceState : prev;

      const reviewDraft = createReview19WeatherDraft(session);
      const initialReview19 = createInitialReview19Result({
        date: session.date,
        sessionStartedAt: session.startedAt,
        excludedAreaIds: sourceSession ? getReview19ExcludedAreaIdsForReview(sourceStateForReview) : [],
      });

      return {
        ...prev,
        session,
        screen: "review19",
        sessionDraft: reviewDraft,
        areaProgressMap: sourceStateForReview.areaProgressMap,
        review19ExcludedAreaIds: sourceStateForReview.review19ExcludedAreaIds,
        currentAreaId: null,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        timeSwitchNotice: null,
        review19: {
          ...initialReview19,
          reference: createReview19Reference(reviewDraft),
        },
      };
    });
  }

  function startReview19AfterWeather() {
    setState((prev) => {
      if (prev.screen !== "review19_weather" || !prev.session || !prev.review19) return prev;

      return {
        ...prev,
        screen: "review19",
        review19: {
          ...prev.review19,
          reference: createReview19Reference(prev.sessionDraft),
        },
      };
    });
  }

  function updateReview19Rating(areaId: AreaId, rating: Review19Rating) {
    setState((prev) => {
      if (prev.screen !== "review19" || !prev.review19) return prev;

      return {
        ...prev,
        review19: {
          ...prev.review19,
          ratings: {
            ...prev.review19.ratings,
            [areaId]: rating,
          },
          ratingScores: createReview19RatingScores({
            ...prev.review19.ratings,
            [areaId]: rating,
          }),
        },
      };
    });
  }

  function buildRecordedReview19Result(): Review19Result | null {
    if ((state.screen !== "review19" && state.screen !== "review19_done") || !state.review19) return null;

    const recordedAt = state.review19.recordedAt ?? new Date().toISOString();
    const snapshot = state.session
      ? createReview19Snapshot({
          capturedAt: recordedAt,
          session: state.session,
          resolvedWeather: sessionSourceResolvedWeather,
          weekdayBaseInfo,
          basisGuide,
          lateTimeBonus,
          reviewReference: state.review19.reference,
          excludedAreaIds: state.review19.excludedAreaIds,
          areaProgressMap: state.areaProgressMap,
          doneSummaryItems,
        })
      : state.review19.snapshot;

    return {
      ...state.review19,
      ratingScores: createReview19RatingScores(state.review19.ratings),
      excludedAreaIds: state.review19.excludedAreaIds,
      excludeReasons: state.review19.excludeReasons,
      recordedAt,
      snapshot,
    };
  }

  function saveReview19() {
    const recordedReview = buildRecordedReview19Result();
    if (!recordedReview) return;

    appendReview19Record(recordedReview);
    clearReview19SourceState();
    setReview19RecordsVersion((version) => version + 1);

    setState((prev) => {
      if (prev.screen !== "review19" || !prev.review19) return prev;
      if (prev.review19.sessionStartedAt !== recordedReview.sessionStartedAt) return prev;

      return {
        ...prev,
        screen: "review19_done",
        review19: recordedReview,
      };
    });
  }

  function start19DiscountAfterReview() {
    const now = new Date();
    const startedAt = now.toISOString();
    let nextSkipRecords = nextSessionSkipRecords;

    setState((prev) => {
      if (prev.screen !== "review19" && prev.screen !== "review19_done") return prev;

      const draft = normalizeSessionDraft({
        ...prev.sessionDraft,
        discountTime: "19",
      });
      const nextSession: SessionData = {
        ...draft,
        discountTime: "19",
        weather: {
          ...draft.weather,
          hourlyForecasts: cloneHourlyForecasts(draft.weather.hourlyForecasts),
        },
        startedAt,
      };

      const consumed = consumeSkipRecordsInMemory({
        currentRecords: nextSkipRecords,
        date: nextSession.date,
        targetDiscountTime: "19",
      });

      nextSkipRecords = consumed.remainingRecords;
      const areaProgressMap = createAreaProgressMapWithAutoSkippedAreas(consumed.skippedRecords);
      const firstAreaId = getFirstNormalFlowAreaId(areaProgressMap);

      return {
        ...prev,
        screen: firstAreaId ? getNormalFlowScreenForArea(areaProgressMap, firstAreaId) : "done",
        session: nextSession,
        areaProgressMap,
        currentAreaId: firstAreaId,
        lastReferenceAreaId: firstAreaId,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        timeSwitchNotice: null,
        finalTimeStep: 0,
      };
    });

    setNextSessionSkipRecords(cloneSkipRecords(nextSkipRecords));
    setResumeTargetScreen(null);
    setTimeSwitchTarget(null);
    setUndoSnapshot(null);
    setUndoNotice(null);
  }

  function startNextDoneSession() {
    if (state.screen !== "done" || !state.session) return;

    const nextInfo = getNextDoneDiscountInfo(state.session.discountTime, new Date(nowMs));
    if (!nextInfo?.canStart) return;

    if (nextInfo.targetDiscountTime !== "20") {
      resetApp();
      return;
    }

    const now = new Date();
    const currentDate = formatLocalDate(now);
    const currentWeekday = now.getDay();
    const startedAt = now.toISOString();

    setState((prev) => {
      if (prev.screen !== "done" || !prev.session) return prev;

      const nextSession: SessionData = {
        ...prev.sessionDraft,
        date: currentDate,
        weekday: prev.sessionDraft.manualWeekdayOverride
          ? prev.sessionDraft.weekday
          : currentWeekday,
        discountTime: "20",
        weather: {
          ...prev.sessionDraft.weather,
          hourlyForecasts: cloneHourlyForecasts(prev.sessionDraft.weather.hourlyForecasts),
        },
        startedAt,
      };

      return {
        ...prev,
        screen: "final_time",
        session: nextSession,
        sessionDraft: {
          ...prev.sessionDraft,
          date: currentDate,
          weekday: nextSession.weekday,
          discountTime: "20",
          weather: {
            ...nextSession.weather,
            hourlyForecasts: cloneHourlyForecasts(nextSession.weather.hourlyForecasts),
          },
        },
        areaProgressMap: createInitialAreaProgressMap(),
        currentAreaId: null,
        lastReferenceAreaId: null,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        timeSwitchNotice: null,
        finalTimeStep: 0,
      };
    });

    setResumeTargetScreen(null);
    setTimeSwitchTarget(null);
    setUndoSnapshot(null);
    setUndoNotice(null);
  }

  function exportReview19Records() {
    const currentRecords = loadReview19Records();
    const batch = getReview19ExportBatch(currentRecords, 10);

    if (batch.length < 10) return;

    const exportedAt = new Date().toISOString();
    const payload = buildReview19ExportPayload({ records: batch, exportedAt });
    const firstDate = batch[0]?.date ?? 'unknown';
    const lastDate = batch[batch.length - 1]?.date ?? firstDate;
    const filename = `nebiki-review19-${firstDate}_${lastDate}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);

    saveReview19Records(
      markReview19RecordsExportedInMemory({
        currentRecords,
        recordsToMark: batch,
        exportedAt,
      })
    );
    setReview19RecordsVersion((version) => version + 1);
  }

  function resetApp() {
    const now = new Date();
    const currentDate = formatLocalDate(now);
    if (state.session?.date === currentDate && state.session.discountTime === "17") {
      saveReview19SourceState(cloneAppState(state));
    }

    clearWorkSessionCheckpoint();
    clearRuntimeState();
    screenHistoryRef.current = [];
    previousRenderRef.current = null;
    suppressHistoryPushRef.current = false;
    setState(createInitialState(buildStartDefaultDraft(lastUsedSessionDraft)));
    setAreaJudgeSelection(null);
    setResumeTargetScreen(null);
    setTimeSwitchTarget(null);
    setUndoSnapshot(null);
    setUndoNotice(null);
  }

  return {
    state,
    derived: {
  trainingStep,
  trainingStepConfig,
  currentAreaName,
  weekdayText,
  timeText,
  basisGuide,
  weatherGuideText,
  rateDisplay,
  finalGuide,
  pendingBanner,
  timeSwitchNotice: state.timeSwitchNotice,
  lateSkipNotice,
  showAfterRainRecoverySelector,
  showBentoJudgeGuide,
  areaCountAssistEnabled,
  areaCountSameItemLimit,
  showDailyNoticeBeforeRate,
  areaJudgeSelection,
  isResuming: resumeTargetScreen !== null,
  startButtonLabel: timeSwitchTarget
    ? `${getBasisTimeText(timeSwitchTarget)}の値引へ進む`
    : resumeTargetScreen !== null
    ? "再開"
    : undefined,
  canUndo: undoSnapshot !== null,
  undoNotice,
  canChooseSkipTarget,
  skipTargetOptions,
  doneSummaryItems,
  doneNextSessionInfo,
  review19Items,
  review19ReferenceLines,
  review19Export,
  canStartReview19Manually,
},
    actions: {
      updateSessionDraft,
      startSession,
      goBackOneScreen,
      startEditingConditions,
      undoLastAction,
      markBentoJudgeGuideShown,
      confirmDailyNotice,
      judgeCurrentArea,
      getCurrentAreaCountRecommendation,
      skipCurrentArea,
      chooseSkipTargetArea,
      goToNextArea,
      acknowledgeAutoSkippedArea,
      advanceFinalTimeStep,
      updateReview19Rating,
      startReview19AfterWeather,
      saveReview19,
      start19DiscountAfterReview,
      startNextDoneSession,
      exportReview19Records,
      startReview19Manually,
      resetApp,
    },
  };
}