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
  Review19Result,
  Review19Snapshot,
  Review19Reference,
  WeekdayBaseLabel,
  AreaCountEvaluation,
  AreaRateAdjustment,
  RateDisplayData,
  DailySessionSnapshot,
  Review19DayCheckSnapshot,
} from "../domain/types";
import {
  shouldShowDayBeforeHolidayNotice,
  shouldShowHolidayBeforeNormalWeekdayNotice,
  shouldShowThreeDayHolidayMiddleNotice,
} from "../domain/dayBeforeHolidayNotice.ts";
import { AREA_MASTERS, DONE_SUMMARY_ROUTE, NORMAL_ROUTE, getAreaName } from "../domain/area";
import {
  getBasisGuideDisplay,
  getWeatherGuideText,
  getWeekdayBaseInfo,
  buildMergedBonusDisplay,
} from "../domain/weekdayBase";
import {
  getFinalTimeGuide,
  getFinalTimeInstructionSteps,
  getNormalTimeRateDisplay,
} from "../domain/discount";
import {
  appendSkipRecordsInMemory,
  consumeSkipRecordsInMemory,
  loadPersistedNebikiStateForDate,
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
  getDailySessionSnapshotsForDate,
  upsertDailySessionSnapshot,
  hasFinalDayAutoExported,
  markFinalDayAutoExported,
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
  buildReview19DataQuality,
  getReview19AreaItems,
  parseReview19RatePercent,
  normalizeReview19Result,
  buildReview19ExportPayload,
  getUnexportedReview19Records,
  markReview19RecordsExportedInMemory,
  REVIEW19_EXCLUDE_REASON_TEXT,
} from "../domain/review19.ts";
import {
  buildAutomaticDayExportPayload,
  getAutomaticDayExportFilename,
} from "../domain/dayExport.ts";
import type {
  AreaCountDecisionBasis,
  AreaCountRecord,
} from "../domain/areaCountHistory.ts";
import {
  cloneAreaCountRecords,
  buildAreaCountDecisionBasis,
  evaluationText as getAreaCountEvaluationText,
  evaluationToRateAdjustment as getAreaCountRateAdjustment,
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation as buildAreaCountRecommendation,
  getAreaCountSameItemLimit,
  isAreaCountAssistTarget,
  normalizeAreaCountDecisionBasis,
  upsertAreaCountRecord,
} from "../domain/areaCountHistory.ts";
import {
  loadRemoteAreaCountRecords,
  upsertRemoteAreaCountRecord,
} from "../domain/areaCountRemoteStorage.ts";
import {
  getEarlyNextMinus5NoticeText,
  getEarlyNextMinus5TargetDiscountTime,
  shouldReserveEarlyNextMinus5OnAutoTransition,
} from "../domain/earlyNextMinus5.ts";
import { getCurrentDataVersionInfo } from "../domain/dataVersion.ts";

let runtimeNowOverrideMs: number | null = null;

function setRuntimeNowOverride(date?: Date | null): void {
  runtimeNowOverrideMs = date ? date.getTime() : null;
}

function getRuntimeNow(): Date {
  return runtimeNowOverrideMs === null ? new Date() : new Date(runtimeNowOverrideMs);
}

function getRuntimeNowMs(): number {
  return runtimeNowOverrideMs === null ? Date.now() : runtimeNowOverrideMs;
}

function formatLocalDate(date = getRuntimeNow()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function resolveDiscountTime(date = getRuntimeNow()): DiscountTime {
  const minutes = date.getHours() * 60 + date.getMinutes();

  // 天候入力・値引開始準備の時刻で自動切替する。
  // 15時・17時は冷惣菜値引もあるため20分前、それ以降は5分前。
  if (minutes < 16 * 60 + 40) return "15";
  if (minutes < 18 * 60 + 25) return "17";
  if (minutes < 19 * 60 + 25) return "18";
  if (minutes < 20 * 60 + 25) return "19";
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

function canStartReview19FromCurrentState(params: {
  state: AppState;
  now: Date;
  records?: Review19Result[];
}): boolean {
  const { state, now } = params;

  const currentDate = formatLocalDate(now);
  if (state.review19?.date === currentDate && state.review19.recordedAt) return false;
  if (
    params.records?.some(
      (record) => record.date === currentDate && Boolean(record.recordedAt),
    )
  ) {
    return false;
  }

  return true;
}


function buildTimeSwitchNotice(to: DiscountTime): string {
  if (to === "20") {
    return "20時30分を過ぎたため、19時30分の値引を打ち切り、20時30分の最終値引を開始します。";
  }

  if (to === "19") {
    return "19時30分を過ぎたため、18時30分の値引を打ち切り、19時30分の値引を開始します。";
  }

  if (to === "18") {
    return "18時30分を過ぎたため、17時の値引を打ち切り、18時30分の値引を開始します。";
  }

  return `現在時刻が${getBasisTimeText(
    to
  )}を過ぎたため、ここから${getBasisTimeText(to)}の基準で表示します。`;
}

function clampDisplayRate(value: number): number {
  return Math.max(0, Math.min(50, value));
}

function applyRateOffsetToText(text: string, offset: number): string {
  return text.replace(/(\d+)%/g, (_match, valueText: string) => {
    const value = Number(valueText);
    if (!Number.isFinite(value)) return _match;
    return `${clampDisplayRate(value + offset)}%`;
  });
}

function applyRateOffsetToDisplay(display: RateDisplayData, offset: number): RateDisplayData {
  return {
    many: {
      main: applyRateOffsetToText(display.many.main, offset),
      note: display.many.note ? applyRateOffsetToText(display.many.note, offset) : undefined,
    },
    normal: {
      main: applyRateOffsetToText(display.normal.main, offset),
      note: display.normal.note ? applyRateOffsetToText(display.normal.note, offset) : undefined,
    },
    few: {
      main: applyRateOffsetToText(display.few.main, offset),
      note: display.few.note ? applyRateOffsetToText(display.few.note, offset) : undefined,
    },
  };
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
      return progress.autoSkipKind === "early_next_minus5"
        ? "スキップ済み（先取り値引済み）"
        : "スキップ済み（前回+5%で値引済み）";
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
  rateDisplayOverride?: RateDisplayData | null;
}): CompletedRateSnapshot {
  const { session, progress, weatherBonus } = params;

  if (!session || session.discountTime === "20" || !progress.areaJudge) {
    return {};
  }

  const display = params.rateDisplayOverride ?? (() => {
    const resolvedWeather = resolveWeatherInputForDiscount(session.weather, session.discountTime);

    return getNormalTimeRateDisplay({
      discountTime: session.discountTime,
      weekday: session.weekday,
      date: session.date,
      weatherBonus,
      areaJudge: progress.areaJudge,
      isSunday: session.weekday === 0 && session.discountTime === "15",
      ignoreTimeRateCap: shouldIgnoreNormalTimeRateCap(resolvedWeather),
      weekdayBase: params.weekdayBase,
      areaRateAdjustment: progress.areaRateAdjustment,
    });
  })();

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
  skipKind?: "late_plus5" | "early_next_minus5";
}): NextSessionSkipRecord {
  return {
    date: params.date,
    targetDiscountTime: params.targetDiscountTime,
    areaId: params.areaId,
    previousRateText: params.rateSnapshot.completedRateText,
    previousManyRateText: params.rateSnapshot.completedManyRateText,
    previousManyNote: params.rateSnapshot.completedManyNote,
    previousNormalRateText: params.rateSnapshot.completedNormalRateText,
    skipKind: params.skipKind,
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
  areaProgressMap: Record<AreaId, AreaProgress>,
  normalFlowOrder: readonly AreaId[] = NORMAL_ROUTE
): AreaId | null {
  return normalFlowOrder.find((areaId) => isNormalFlowWorkArea(areaProgressMap[areaId])) ?? null;
}

function getNextNormalFlowAreaId(
  areaProgressMap: Record<AreaId, AreaProgress>,
  currentAreaId: AreaId,
  normalFlowOrder: readonly AreaId[] = NORMAL_ROUTE
): AreaId | null {
  const currentIndex = normalFlowOrder.indexOf(currentAreaId);
  const afterCurrent = currentIndex >= 0
    ? normalFlowOrder.slice(currentIndex + 1)
    : normalFlowOrder;

  return afterCurrent.find((areaId) => isNormalFlowWorkArea(areaProgressMap[areaId])) ?? null;
}

function getNextNormalFlowAreaIdWithWrap(
  areaProgressMap: Record<AreaId, AreaProgress>,
  currentAreaId: AreaId,
  normalFlowOrder: readonly AreaId[] = NORMAL_ROUTE
): AreaId | null {
  return (
    getNextNormalFlowAreaId(areaProgressMap, currentAreaId, normalFlowOrder) ??
    normalFlowOrder.find((areaId) => isNormalFlowWorkArea(areaProgressMap[areaId])) ??
    null
  );
}

function hasRemainingNormalFlowArea(
  areaProgressMap: Record<AreaId, AreaProgress>,
  currentAreaId: AreaId,
  normalFlowOrder: readonly AreaId[] = NORMAL_ROUTE
): boolean {
  return normalFlowOrder.some((areaId) => {
    return areaId !== currentAreaId && isNormalFlowWorkArea(areaProgressMap[areaId]);
  });
}

function createInitialSessionDraft(): SessionDraft {
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

function isValidAreaCountEvaluationSource(
  value: unknown
): value is NonNullable<AreaProgress["areaCountEvaluationSource"]> {
  return value === "manual" || value === "history";
}

function isValidDiscountTime(value: unknown): value is DiscountTime {
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

function addReview19ExcludedAreaId(current: AreaId[], areaId: AreaId): AreaId[] {
  return current.includes(areaId) ? current : [...current, areaId];
}

function removeReview19ExcludedAreaId(current: AreaId[], areaId: AreaId): AreaId[] {
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
    normalFlowOrder: [...NORMAL_ROUTE],
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
    weatherInputLockedDiscountTime: isValidDiscountTime(raw?.weatherInputLockedDiscountTime)
      ? raw.weatherInputLockedDiscountTime
      : null,
    weather: normalizeWeatherInput(raw?.weather, discountTime),
  };
}

function buildStartDefaultDraft(raw?: Partial<SessionDraft> | null): SessionDraft {
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

  return {
    ...normalizedDraft,
    startedAt:
      typeof raw.startedAt === "string" ? raw.startedAt : getRuntimeNow().toISOString(),
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
    params.currentState.sessionDraft
  );

  return savedSourceState.session?.date === params.currentDate &&
    savedSourceState.session.discountTime === "17"
    ? savedSourceState
    : null;
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
      completedAt: getRuntimeNow().toISOString(),
      previousRateText: record.previousRateText,
      previousManyRateText: record.previousManyRateText,
      previousManyNote: record.previousManyNote,
      previousNormalRateText: record.previousNormalRateText,
      autoSkipKind: record.skipKind ?? "late_plus5",
    };
  }

  return base;
}

function isPreviousTimeUnfinished(progress: AreaProgress | undefined): boolean {
  if (!progress) return false;

  switch (progress.status) {
    case "unstarted":
    case "skipped_manual":
    case "postponed_few":
      return true;
    case "completed":
    case "auto_skipped_late_time":
      return false;
  }
}

export function createTimeSwitchPlan(params: {
  previousMap: Record<AreaId, AreaProgress>;
  skippedRecords: NextSessionSkipRecord[];
  targetDiscountTime: DiscountTime;
  completedAt?: string;
}): {
  areaProgressMap: Record<AreaId, AreaProgress>;
  normalFlowOrder: AreaId[];
} {
  const areaProgressMap = createInitialAreaProgressMap();
  const completedAt = params.completedAt ?? getRuntimeNow().toISOString();
  const unfinishedAreaIds = params.targetDiscountTime === "20"
    ? []
    : NORMAL_ROUTE.filter((areaId) => isPreviousTimeUnfinished(params.previousMap[areaId]));
  const normalFlowOrder = normalizeNormalFlowOrder([
    ...unfinishedAreaIds,
    ...NORMAL_ROUTE,
  ]);

  const markAutoSkipped = (record: NextSessionSkipRecord) => {
    if (
      record.skipKind !== "early_next_minus5" ||
      !isValidAreaId(record.areaId) ||
      !areaProgressMap[record.areaId]
    ) {
      return;
    }

    areaProgressMap[record.areaId] = {
      ...areaProgressMap[record.areaId],
      status: "auto_skipped_late_time",
      skipReason: "late_time",
      completedAt,
      previousRateText: record.previousRateText,
      previousManyRateText: record.previousManyRateText,
      previousManyNote: record.previousManyNote,
      previousNormalRateText: record.previousNormalRateText,
      autoSkipKind: "early_next_minus5",
    };
  };

  for (const record of params.skippedRecords) {
    markAutoSkipped(record);
  }

  return { areaProgressMap, normalFlowOrder };
}

function buildAutoTimeSwitchDialogText(params: {
  from: DiscountTime;
  to: DiscountTime;
  prioritizeUnfinishedAreas: boolean;
}): string {
  const transitionText =
    params.to === "20"
      ? `次の値引時刻に近づいたため、${getBasisTimeText(params.to)}の最終値引に移行します。`
      : `次の値引時刻に近づいたため、${getBasisTimeText(params.to)}の値引に移行します。`;

  if (!params.prioritizeUnfinishedAreas || params.to === "20") {
    return transitionText;
  }

  return `${transitionText}\n${getBasisTimeText(params.from)}の値引で未完了のエリアから先に表示されます。`;
}

function shouldPrioritizeUnfinishedAreasOnAutoTransition(screen: ScreenName): boolean {
  return screen === "area_judge" || screen === "rate_display" || screen === "auto_skip_notice";
}

function getFirstAvailableAreaId(
  areaProgressMap: Record<AreaId, AreaProgress>,
  normalFlowOrder: readonly AreaId[] = NORMAL_ROUTE
): AreaId | null {
  return normalFlowOrder.find((areaId) => areaProgressMap[areaId]?.status === "unstarted") ?? null;
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





function buildAreaSnapshotsFromState(params: {
  areaProgressMap: Record<AreaId, AreaProgress>;
  doneSummaryItems: DoneSummaryItem[];
  excludedAreaIds?: AreaId[];
}): Record<AreaId, Review19Snapshot["areas"][AreaId]> {
  const doneSummaryByArea = params.doneSummaryItems.reduce((acc, item) => {
    acc[item.areaId] = item;
    return acc;
  }, {} as Record<AreaId, DoneSummaryItem>);
  const excludedAreaIdSet = new Set(params.excludedAreaIds ?? []);

  return DONE_SUMMARY_ROUTE.reduce((acc, areaId) => {
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
      areaCountEvaluation: progress?.areaCountEvaluation,
      areaCountEvaluationSource: progress?.areaCountEvaluationSource,
      areaCountDecisionBasis: progress?.areaCountDecisionBasis
        ? JSON.parse(JSON.stringify(progress.areaCountDecisionBasis)) as AreaCountDecisionBasis
        : undefined,
      areaRateAdjustment: progress?.areaRateAdjustment,
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
}

function createDailySessionSnapshot(params: {
  capturedAt: string;
  state: AppState;
  resolvedWeather: ReturnType<typeof resolveWeatherInputForDiscount>;
  weekdayBaseInfo: ReturnType<typeof getWeekdayBaseInfo>;
  basisGuide: ReturnType<typeof getBasisGuideDisplay>;
  lateTimeBonus: number;
  doneSummaryItems: DoneSummaryItem[];
}): DailySessionSnapshot | null {
  const session = params.state.session;
  if (!session) return null;

  return {
    version: 1,
    ...getCurrentDataVersionInfo(),
    capturedAt: params.capturedAt,
    rateLogicVersion: "time_basic_rate_v1",
    screen: params.state.screen,
    session: {
      date: session.date,
      weekday: session.weekday,
      discountTime: session.discountTime,
      startedAt: session.startedAt,
      manualWeekdayOverride: session.manualWeekdayOverride,
      manualDiscountTimeOverride: session.manualDiscountTimeOverride,
      weather: JSON.parse(JSON.stringify(session.weather)),
      resolvedWeather: JSON.parse(JSON.stringify(params.resolvedWeather)),
    },
    basis: {
      rateLogicVersion: "time_basic_rate_v1",
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
    areas: buildAreaSnapshotsFromState({
      areaProgressMap: params.state.areaProgressMap,
      doneSummaryItems: params.doneSummaryItems,
      excludedAreaIds: params.state.review19ExcludedAreaIds,
    }),
    doneSummaryItems: JSON.parse(JSON.stringify(params.doneSummaryItems)) as DoneSummaryItem[],
    currentAreaId: params.state.currentAreaId,
    review19ExcludedAreaIds: [...params.state.review19ExcludedAreaIds],
  };
}

function getFinalGuideSummaryText(guide: ReturnType<typeof getFinalTimeGuide>): string {
  return getFinalTimeInstructionSteps(guide)
    .map((step) => `${step.subject}${step.rate}`)
    .join("・");
}

function buildFinalSessionDoneSummaryItems(params: {
  session: SessionData;
  areaProgressMap: Record<AreaId, AreaProgress>;
  comfortScore: number;
}): DoneSummaryItem[] {
  return DONE_SUMMARY_ROUTE.map((areaId) => {
    const progress = params.areaProgressMap[areaId];
    const guide = getFinalTimeGuide({
      weekday: params.session.weekday,
      weather21: params.session.weather.hourlyForecasts["21"].weather,
      temp21C: params.session.weather.hourlyForecasts["21"].tempC,
      comfortScore: params.comfortScore,
      areaCountEvaluation: progress?.areaCountEvaluation,
    });
    const rateText = getFinalGuideSummaryText(guide);

    return {
      areaId,
      areaName: getAreaName(areaId),
      judgeText: progress?.areaCountEvaluation
        ? getAreaCountEvaluationText(progress.areaCountEvaluation)
        : "履歴不足（残数補正なし）",
      rateText,
      normalRateText: rateText,
      statusText: typeof progress?.areaCount === "number" ? undefined : "残数未入力",
    };
  });
}

function getLatestReview19DayCheck(date: string): Review19DayCheckSnapshot | undefined {
  const latest = loadReview19Records()
    .filter((record) => record.date === date && Boolean(record.recordedAt))
    .sort((a, b) => (a.recordedAt ?? "").localeCompare(b.recordedAt ?? ""))
    .at(-1);

  if (!latest?.recordedAt) return undefined;
  if (latest.daySnapshot?.review19Check) {
    return JSON.parse(JSON.stringify(latest.daySnapshot.review19Check)) as Review19DayCheckSnapshot;
  }

  return {
    version: 1,
    dataSchemaVersion: latest.dataSchemaVersion,
    appVersion: latest.appVersion,
    review19Status: latest.review19Status,
    recordedAt: latest.recordedAt,
    sessionStartedAt: latest.sessionStartedAt,
    reviewStartedAt: latest.reviewStartedAt,
    reviewCompletedAt: latest.reviewCompletedAt ?? latest.recordedAt,
    areaCountRecordedAt: JSON.parse(JSON.stringify(latest.areaCountRecordedAt)) as Review19DayCheckSnapshot["areaCountRecordedAt"],
    ratingStatus: latest.ratingStatus,
    ratings: latest.ratings
      ? JSON.parse(JSON.stringify(latest.ratings)) as Review19DayCheckSnapshot["ratings"]
      : null,
    ratingScores: latest.ratingScores
      ? JSON.parse(JSON.stringify(latest.ratingScores)) as Review19DayCheckSnapshot["ratingScores"]
      : null,
    areaCounts: JSON.parse(JSON.stringify(latest.areaCounts)) as Review19DayCheckSnapshot["areaCounts"],
    excludedAreaIds: [...latest.excludedAreaIds],
    excludeReasons: JSON.parse(JSON.stringify(latest.excludeReasons)) as Review19DayCheckSnapshot["excludeReasons"],
    dataQuality: JSON.parse(JSON.stringify(latest.dataQuality)) as Review19DayCheckSnapshot["dataQuality"],
    snapshot: latest.snapshot
      ? JSON.parse(JSON.stringify(latest.snapshot)) as Review19Snapshot
      : undefined,
  };
}

function createReview19DaySnapshot(params: {
  capturedAt: string;
  date: string;
  areaCountRecords: AreaCountRecord[];
  sessions: DailySessionSnapshot[];
  review19Check?: NonNullable<NonNullable<Review19Result["daySnapshot"]>["review19Check"]>;
}): NonNullable<Review19Result["daySnapshot"]> {
  return {
    version: 1,
    ...getCurrentDataVersionInfo(),
    capturedAt: params.capturedAt,
    date: params.date,
    rateLogicVersion: "time_basic_rate_v1",
    review19Status: params.review19Check?.review19Status ?? "not_performed",
    sessions: params.sessions
      .filter((session) => session.session.date === params.date && session.screen === "done")
      .map((session) => JSON.parse(JSON.stringify(session)) as DailySessionSnapshot),
    review19Check: params.review19Check
      ? JSON.parse(JSON.stringify(params.review19Check)) as NonNullable<NonNullable<Review19Result["daySnapshot"]>["review19Check"]>
      : undefined,
    areaCountRecords: cloneAreaCountRecords(
      params.areaCountRecords.filter((record) => record.date === params.date),
    ),
  };
}

export function createReview19Snapshot(params: {
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
      areaCountEvaluation: progress?.areaCountEvaluation,
      areaCountEvaluationSource: progress?.areaCountEvaluationSource,
      areaCountDecisionBasis: progress?.areaCountDecisionBasis
        ? JSON.parse(JSON.stringify(progress.areaCountDecisionBasis)) as AreaCountDecisionBasis
        : undefined,
      areaRateAdjustment: progress?.areaRateAdjustment,
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
    ...getCurrentDataVersionInfo(),
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
      rateLogicVersion: "time_basic_rate_v1",
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
      rateLogicVersion: "time_basic_rate_v1",
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
export function useNebikiApp(params?: { testNow?: Date | null }): UseNebikiAppResult {
  setRuntimeNowOverride(params?.testNow ?? null);
  const isTestMode = params?.testNow instanceof Date;
  const initialPersistenceRef = useRef<ReturnType<typeof loadPersistedNebikiStateForDate> | null>(null);

  if (!initialPersistenceRef.current) {
    const initialDate = formatLocalDate(getRuntimeNow());
    initialPersistenceRef.current = isTestMode
      ? {
          currentSession: null,
          workSessionCheckpoint: null,
          runtimeState: null,
          nextSessionSkipRecords: [],
          lastSessionWeather: null,
          lastUsedSessionDraft: null,
          dailyMessageState: normalizeDailyMessageState(null),
        }
      : loadPersistedNebikiStateForDate(initialDate);
  }

  const initialLastUsedSessionDraft = buildStartDefaultDraft(
    isTestMode ? null : initialPersistenceRef.current?.lastUsedSessionDraft ?? null
  );
  const initialToday = formatLocalDate(getRuntimeNow());
  const initialLoadedState = isTestMode
    ? null
    : shouldUseCheckpointInsteadOfCurrent({
        currentSession: initialPersistenceRef.current?.currentSession ?? null,
        checkpoint: initialPersistenceRef.current?.workSessionCheckpoint ?? null,
        today: initialToday,
      })
    ? initialPersistenceRef.current?.workSessionCheckpoint ?? null
    : initialPersistenceRef.current?.currentSession ?? null;

  const [state, setState] = useState<AppState>(() =>
    normalizeLoadedState(initialLoadedState, initialLastUsedSessionDraft)
  );
  const [nowMs, setNowMs] = useState(() => getRuntimeNowMs());
  const [nextSessionSkipRecords, setNextSessionSkipRecords] = useState<NextSessionSkipRecord[]>(() =>
    cloneSkipRecords(initialPersistenceRef.current?.nextSessionSkipRecords ?? [])
  );
  const nextSessionSkipRecordsRef = useRef<NextSessionSkipRecord[]>(
    cloneSkipRecords(initialPersistenceRef.current?.nextSessionSkipRecords ?? [])
  );

  function replaceNextSessionSkipRecords(records: NextSessionSkipRecord[]): void {
    const cloned = cloneSkipRecords(records);
    nextSessionSkipRecordsRef.current = cloned;
    setNextSessionSkipRecords(cloned);
  }

  function appendNextSessionSkipRecords(recordsToAdd: NextSessionSkipRecord[]): void {
    if (recordsToAdd.length === 0) return;

    replaceNextSessionSkipRecords(
      appendSkipRecordsInMemory({
        currentRecords: nextSessionSkipRecordsRef.current,
        recordsToAdd,
      })
    );
  }
  const [lastSessionWeather, setLastSessionWeather] = useState(() =>
    cloneLastSessionWeatherRecord(initialPersistenceRef.current?.lastSessionWeather ?? null)
  );
  const [lastUsedSessionDraft, setLastUsedSessionDraft] = useState<SessionDraft>(() =>
    normalizeSessionDraft(initialPersistenceRef.current?.lastUsedSessionDraft ?? null)
  );
  const [dailyMessageState, setDailyMessageState] = useState<DailyMessageState>(() =>
    normalizeDailyMessageState(initialPersistenceRef.current?.dailyMessageState ?? null)
  );
  const [areaCountRecords, setAreaCountRecords] = useState<AreaCountRecord[]>([]);
  const [review19RecordsVersion, setReview19RecordsVersion] = useState(0);

  const [areaJudgeSelection, setAreaJudgeSelection] = useState<AreaJudge>(
    initialPersistenceRef.current?.runtimeState?.areaJudgeSelection ?? null
  );
  const [resumeTargetScreen, setResumeTargetScreen] = useState<ScreenName | null>(
    initialPersistenceRef.current?.runtimeState?.resumeTargetScreen ?? null
  );
  const [timeSwitchTarget, setTimeSwitchTarget] = useState<DiscountTime | null>(() =>
    getInitialTimeSwitchTarget(
      initialPersistenceRef.current?.runtimeState?.timeSwitchTarget,
      isTestMode
    )
  );
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
      nextSessionSkipRecords: nextSessionSkipRecordsRef.current,
      lastSessionWeather,
    });
  }

  function restoreNavigationSnapshot(snapshot: NavigationSnapshot): void {
    replaceNextSessionSkipRecords(snapshot.nextSessionSkipRecords);
    setLastSessionWeather(cloneLastSessionWeatherRecord(snapshot.lastSessionWeather));
    setState(cloneAppState(snapshot.state));
    setAreaJudgeSelection(snapshot.areaJudgeSelection);
    setResumeTargetScreen(snapshot.resumeTargetScreen);
    setTimeSwitchTarget(null);
  }
  const previousRenderRef = useRef<NavigationSnapshot | null>(null);
  const suppressHistoryPushRef = useRef(false);



  useEffect(() => {
    let cancelled = false;

    void loadRemoteAreaCountRecords().then((result) => {
      if (cancelled || result.status !== "ready") return;

      // エリア判定の履歴はSupabaseを正とする。
      // 端末内のローカル履歴を混ぜると、削除済みテストデータで判定がズレるため使わない。
      setAreaCountRecords(cloneAreaCountRecords(result.records));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 動作確認モードでは入力結果を端末内のlocalStorageへ残さない。
    // 残数入力の確認で、本番用のセッション状態を汚さないため。
    if (isTestMode) return;

    savePersistedNebikiState(
      clonePersistedNebikiStateSnapshot({
        currentSession: state,
        nextSessionSkipRecords,
        lastSessionWeather,
        lastUsedSessionDraft,
        dailyMessageState,
      })
    );

    if (state.session) {
      saveWorkSessionCheckpoint(cloneAppState(state));
    }
  }, [
    isTestMode,
    state,
    nextSessionSkipRecords,
    lastSessionWeather,
    lastUsedSessionDraft,
    dailyMessageState,
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
    // 動作確認モードでは画面遷移状態もlocalStorageへ保存しない。
    if (isTestMode) return;

    saveRuntimeState({
      areaJudgeSelection,
      resumeTargetScreen,
      timeSwitchTarget,
      undoSnapshot,
      screenHistory: screenHistoryRef.current,
    });
  }, [
    isTestMode,
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
    const updateNow = () => setNowMs(getRuntimeNowMs());
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

      const now = getRuntimeNow();
      const nowDiscountTime = resolveDiscountTime(now);
      const nowDate = formatLocalDate(now);
      const nowWeekday = now.getDay();

      const nextDraft = { ...prev.sessionDraft };
      let changed = false;

      if (nextDraft.date !== nowDate) {
        nextDraft.date = nowDate;
        nextDraft.weatherInputLockedDiscountTime = null;
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
        !nextDraft.weatherInputLockedDiscountTime &&
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
  const showDayBeforeHolidayNotice = shouldShowDayBeforeHolidayNotice({
    sessionDate: activeSessionDate,
    discountTime: sessionSource.discountTime,
  });
  const showThreeDayHolidayMiddleNotice = shouldShowThreeDayHolidayMiddleNotice({
    sessionDate: activeSessionDate,
    discountTime: sessionSource.discountTime,
  });
  const showHolidayBeforeNormalWeekdayNotice =
    shouldShowHolidayBeforeNormalWeekdayNotice({
      sessionDate: activeSessionDate,
      discountTime: sessionSource.discountTime,
    });

  const showBentoJudgeGuide =
    state.screen === "area_judge" &&
    state.currentAreaId === "bento_men" &&
    dailyMessageState.bentoJudgeGuideShownDate !== activeSessionDate;

  const showDailyNoticeBeforeRate =
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

  const earlyNextMinus5Info = useMemo(() => {
    if (!state.session) return null;

    const targetDiscountTime = getEarlyNextMinus5TargetDiscountTime({
      discountTime: state.session.discountTime,
      manualDiscountTimeOverride: state.session.manualDiscountTimeOverride,
      nowMs,
    });
    if (!targetDiscountTime) return null;
    const resolvedWeather = resolveWeatherInputForDiscount(
      state.session.weather,
      targetDiscountTime
    );
    const targetWeekdayBaseInfo = getWeekdayBaseInfo(
      state.session.weekday,
      targetDiscountTime,
      resolvedWeather,
      state.session.date
    );
    const targetBasisGuide = getBasisGuideDisplay({
      date: state.session.date,
      weekday: state.session.weekday,
      discountTime: targetDiscountTime,
      weather: resolvedWeather,
    });

    return {
      targetDiscountTime,
      resolvedWeather,
      weekdayBaseInfo: targetWeekdayBaseInfo,
      basisGuide: targetBasisGuide,
      ignoreNormalTimeRateCap: shouldIgnoreNormalTimeRateCap(resolvedWeather),
    };
  }, [
    state.session,
    nowMs,
  ]);

  useEffect(() => {
    const areaId = state.currentAreaId;
    if (state.screen !== "rate_display" || !areaId || !earlyNextMinus5Info) return;

    setState((prev) => {
      if (prev.screen !== "rate_display" || prev.currentAreaId !== areaId) return prev;
      const progress = prev.areaProgressMap[areaId];
      if (
        progress.earlyNextMinus5TargetDiscountTime ===
        earlyNextMinus5Info.targetDiscountTime
      ) {
        return prev;
      }

      return {
        ...prev,
        areaProgressMap: {
          ...prev.areaProgressMap,
          [areaId]: {
            ...progress,
            earlyNextMinus5TargetDiscountTime:
              earlyNextMinus5Info.targetDiscountTime,
          },
        },
      };
    });
  }, [
    state.screen,
    state.currentAreaId,
    earlyNextMinus5Info?.targetDiscountTime,
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

  // 17時基準の18:00〜18:24は、+5%ではなく18時30分値引率-5%で表示する。
  if (state.session.discountTime === "17") {
    return 0;
  }

  // 18時30分基準の19:00〜19:24は、+5%ではなく19時30分値引率-5%で表示する。
  if (state.session.discountTime === "18") {
    return 0;
  }

  // 19時30分基準の値引中に20時を超えたら、ユーザーが値引時刻を切り替えるまで +5% を維持する。
  if (state.session.discountTime === "19") {
    return minutes >= 20 * 60 + 15 ? 5 : 0;
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
  if (earlyNextMinus5Info) {
    return getEarlyNextMinus5NoticeText(earlyNextMinus5Info.targetDiscountTime);
  }

  if (!state.session || lateTimeBonus === 0) return null;

  if (state.session.discountTime === "15") {
    return "16時を過ぎたため、今回は5%強めて値引します。";
  }

  if (state.session.discountTime === "19") {
    return "20時15分を過ぎたため、今回は5%強めて値引します。";
  }

  return `次の基準時刻に近づいているため、今回は5%強めて値引します。
このエリアは次回の値引でスキップします。`;
}, [state.session, lateTimeBonus, earlyNextMinus5Info]);

    const basisGuide = useMemo(() => {
  if (earlyNextMinus5Info) {
    return earlyNextMinus5Info.basisGuide;
  }

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
  earlyNextMinus5Info,
]);

  const ignoreNormalTimeRateCap = shouldIgnoreNormalTimeRateCap(sessionSourceResolvedWeather);
  const effectiveRateDiscountTime = earlyNextMinus5Info?.targetDiscountTime ?? state.session?.discountTime;
  const effectiveRateWeekdayBase = earlyNextMinus5Info?.weekdayBaseInfo.adjusted ?? weekdayBaseInfo.adjusted;
  const effectiveRateIgnoreTimeRateCap = earlyNextMinus5Info?.ignoreNormalTimeRateCap ?? ignoreNormalTimeRateCap;
  const effectiveTimeText = useMemo(() => {
    return getBasisTimeText(effectiveRateDiscountTime ?? sessionSource.discountTime);
  }, [effectiveRateDiscountTime, sessionSource.discountTime]);

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

    const rateDiscountTime = (effectiveRateDiscountTime ?? state.session.discountTime) as Exclude<DiscountTime, "20">;
    const display = getNormalTimeRateDisplay({
      discountTime: rateDiscountTime,
      weekday: state.session.weekday,
      date: state.session.date,
      weatherBonus: earlyNextMinus5Info
        ? earlyNextMinus5Info.weekdayBaseInfo.baseRateBonus
        : weekdayBaseInfo.baseRateBonus + lateTimeBonus,
      areaJudge: currentAreaProgress.areaJudge,
      isSunday: state.session.weekday === 0 && rateDiscountTime === "15",
      ignoreTimeRateCap: effectiveRateIgnoreTimeRateCap,
      weekdayBase: effectiveRateWeekdayBase,
      areaRateAdjustment: currentAreaProgress.areaRateAdjustment,
    });

    return earlyNextMinus5Info ? applyRateOffsetToDisplay(display, -5) : display;
  }, [
  state.session,
  currentAreaProgress,
  weekdayBaseInfo.baseRateBonus,
  lateTimeBonus,
  ignoreNormalTimeRateCap,
  weekdayBaseInfo.adjusted,
  effectiveRateDiscountTime,
  effectiveRateWeekdayBase,
  effectiveRateIgnoreTimeRateCap,
  earlyNextMinus5Info,
  currentAreaProgress?.areaRateAdjustment,
]);
  const finalGuide = useMemo(() => {
  if (!state.session || state.session.discountTime !== "20") return null;

  return getFinalTimeGuide({
    weekday: state.session.weekday,
    weather21: state.session.weather.hourlyForecasts["21"].weather,
    temp21C: state.session.weather.hourlyForecasts["21"].tempC,
    comfortScore: weekdayBaseInfo.weekdayShift,
    areaCountEvaluation: currentAreaProgress?.areaCountEvaluation,
  });
}, [state.session, weekdayBaseInfo.weekdayShift, currentAreaProgress?.areaCountEvaluation]);

  const doneSummaryItems = useMemo<DoneSummaryItem[]>(() => {
    const session = state.session;
    if (!session) return [];
    if (session.discountTime === "20") {
      return buildFinalSessionDoneSummaryItems({
        session,
        areaProgressMap: state.areaProgressMap,
        comfortScore: weekdayBaseInfo.weekdayShift,
      });
    }

    const isEarlyNextMinus5Summary =
      Boolean(earlyNextMinus5Info) &&
      (session.discountTime === "17" || session.discountTime === "18") &&
      !session.manualDiscountTimeOverride;
    const discountTime = (isEarlyNextMinus5Summary
      ? earlyNextMinus5Info!.targetDiscountTime
      : session.discountTime) as Exclude<DiscountTime, "20">;
    const baseWeatherBonus = isEarlyNextMinus5Summary
      ? earlyNextMinus5Info!.weekdayBaseInfo.baseRateBonus
      : weekdayBaseInfo.baseRateBonus + lateTimeBonus;
    const summaryWeekdayBase = isEarlyNextMinus5Summary
      ? earlyNextMinus5Info!.weekdayBaseInfo.adjusted
      : weekdayBaseInfo.adjusted;
    const summaryIgnoreTimeRateCap = isEarlyNextMinus5Summary
      ? earlyNextMinus5Info!.ignoreNormalTimeRateCap
      : ignoreNormalTimeRateCap;

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
          judgeText: progress.autoSkipKind === "early_next_minus5" ? "先取り値引済み" : "前回+5%済み",
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

      const baseDisplay = getNormalTimeRateDisplay({
        discountTime,
        weekday: session.weekday,
        date: session.date,
        weatherBonus,
        areaJudge: progress.areaJudge,
        isSunday: session.weekday === 0 && discountTime === "15",
        ignoreTimeRateCap: summaryIgnoreTimeRateCap,
        weekdayBase: summaryWeekdayBase,
        areaRateAdjustment: progress.areaRateAdjustment,
      });
      const display = isEarlyNextMinus5Summary
        ? applyRateOffsetToDisplay(baseDisplay, -5)
        : baseDisplay;

      const completedNormalRateText = isEarlyNextMinus5Summary
        ? display.normal.main
        : getProgressNormalRateText(progress) ?? display.normal.main;
      const completedManyRateText = isEarlyNextMinus5Summary
        ? display.many.main
        : getProgressManyRateText(progress) ?? display.many.main;

      return {
        areaId,
        areaName: getAreaName(areaId),
        judgeText: progress.areaCountEvaluation
          ? getAreaCountEvaluationText(progress.areaCountEvaluation)
          : getAreaJudgeText(progress.areaJudge),
        rateText: completedNormalRateText,
        manyRateText: completedManyRateText,
        manyNote: isEarlyNextMinus5Summary
          ? display.many.note
          : progress.completedManyNote ?? display.many.note,
        normalRateText: completedNormalRateText,
        statusText,
      };
    });
  }, [
    state.session,
    state.areaProgressMap,
    weekdayBaseInfo.baseRateBonus,
    weekdayBaseInfo.weekdayShift,
    lateTimeBonus,
    ignoreNormalTimeRateCap,
    weekdayBaseInfo.adjusted,
    earlyNextMinus5Info,
  ]);

  useEffect(() => {
    if (isTestMode) return;
    if (!state.session) return;
    // 19時チェック用の日次セッションログには、完了した通常値引セッションだけを保存する。
    // 動作確認中の area_judge / rate_display などを保存すると、19時チェックのエクスポートに
    // 未完了セッションが混ざって分析時のノイズになる。
    if (state.screen !== "done") return;

    const snapshot = createDailySessionSnapshot({
      capturedAt: getRuntimeNow().toISOString(),
      state,
      resolvedWeather: sessionSourceResolvedWeather,
      weekdayBaseInfo,
      basisGuide,
      lateTimeBonus,
      doneSummaryItems,
    });

    if (snapshot) {
      upsertDailySessionSnapshot(snapshot);
    }
  }, [
    isTestMode,
    state,
    sessionSourceResolvedWeather,
    weekdayBaseInfo,
    basisGuide,
    lateTimeBonus,
    doneSummaryItems,
  ]);

  const review19Items = useMemo(() => {
    const excludedAreaIdSet = new Set(state.review19?.excludedAreaIds ?? []);

    return getReview19AreaItems().map((item) => {
      const excludeReason = state.review19?.excludeReasons?.[item.areaId];
      return {
        ...item,
        count: state.review19?.areaCounts?.[item.areaId],
        excluded: excludedAreaIdSet.has(item.areaId),
        excludeReasonText: excludeReason
          ? REVIEW19_EXCLUDE_REASON_TEXT[excludeReason]
          : undefined,
      };
    });
  }, [state.review19]);

  const review19ReferenceLines = useMemo(() => {
    const reference = state.review19?.reference;
    if (!reference) return [];

    const lines: string[] = [];
    if (reference.basis.weekdaySummaryText) {
      lines.push(reference.basis.weekdaySummaryText);
    }

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

  const savedReview19Records = (() => {
    void review19RecordsVersion;
    return loadReview19Records();
  })();
  const review19UnexportedCount = getUnexportedReview19Records(
    savedReview19Records,
  ).length;
  const review19Export = {
    unexportedCount: review19UnexportedCount,
    totalCount: savedReview19Records.length,
    shouldRecommendExport: review19UnexportedCount >= 10,
  };

  const canStartReview19Manually = canStartReview19FromCurrentState({
    state,
    now: new Date(nowMs),
    records: savedReview19Records,
  });


  const doneNextSessionInfo = state.session
    ? getNextDoneDiscountInfo(state.session.discountTime, new Date(nowMs))
    : null;

  useEffect(() => {
    if (!state.session) return;
    if (state.screen === "start") return;
    if (
      state.screen === "review19_weather" ||
      state.screen === "review19" ||
      state.screen === "review19_done"
    ) {
      return;
    }
    if (!doneNextSessionInfo?.canStart) return;

    // 次の天候入力開始時刻が来たら、作業中・完了画面では自動で次の入力画面へ進む。
    // ただし開始画面で天候入力中、または19時チェック中は、表示中の作業を優先し、自動遷移しない。
    // ここで自動遷移すると、19時チェック開始直後に18時30分入力へ戻されることがある。
    startNextDoneSession({ autoTransition: true });
  }, [
    state.screen,
    state.session?.discountTime,
    state.session?.startedAt,
    doneNextSessionInfo?.canStart,
    doneNextSessionInfo?.targetDiscountTime,
  ]);

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

    const nextCandidate = getNextPendingCandidate({
      areaProgressMap: params.updatedMap,
      referenceAreaId: params.referenceAreaId,
      deferredAreaIds: effectiveDeferredAreaIds,
      preferredReason: params.preferredNextReason ?? null,
    });

    if (!nextCandidate) {
      const nextNormalFlowAreaId = getNextNormalFlowAreaIdWithWrap(
        params.updatedMap,
        params.referenceAreaId,
        params.prev.normalFlowOrder
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
      const hasWeatherPatch = Object.prototype.hasOwnProperty.call(patch, "weather");
      const mergedDraft: SessionDraft = {
        ...prev.sessionDraft,
        ...patch,
        weather: {
          ...prev.sessionDraft.weather,
          ...(patch.weather ?? {}),
        },
      };

      if (hasWeatherPatch && !prev.sessionDraft.manualDiscountTimeOverride) {
        // 天候入力中に時刻境界を跨いでも、入力を始めた時刻を維持する。
        // StartScreen側から明示された表示中の値引時刻を優先することで、
        // 19時30分入力中に自動判定だけ20時30分へ進む競合を防ぐ。
        mergedDraft.weatherInputLockedDiscountTime = isValidDiscountTime(
          patch.weatherInputLockedDiscountTime,
        )
          ? patch.weatherInputLockedDiscountTime
          : prev.sessionDraft.weatherInputLockedDiscountTime ?? prev.sessionDraft.discountTime;
      }

      if (patch.manualDiscountTimeOverride === true) {
        mergedDraft.weatherInputLockedDiscountTime = null;
      }

      if (patch.manualDiscountTimeOverride === false) {
        mergedDraft.weatherInputLockedDiscountTime = null;
      }

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

  function resolveResumeState(prev: AppState, requestedScreen: ScreenName) {
    const fallbackAreaId =
      prev.currentAreaId ??
      prev.lastReferenceAreaId ??
      getFirstAvailableAreaId(prev.areaProgressMap, prev.normalFlowOrder);

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
    },
    areaCountEvaluationSource?: NonNullable<AreaProgress["areaCountEvaluationSource"]>,
    areaCountDecisionBasis?: AreaCountDecisionBasis,
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
            areaCountEvaluationSource,
            areaCountDecisionBasis,
            areaRateAdjustment: areaCountResult?.rateAdjustment,
            visitedAt: getRuntimeNow().toISOString(),
          },
        },
      };
    }

    const { nextSession, timeSwitchNotice } = refreshSessionDiscountTime(prev.session);

    const currentVisitedAt = getRuntimeNow().toISOString();
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
        areaCountEvaluationSource,
        areaCountDecisionBasis,
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
        areaCountEvaluationSource,
        areaCountDecisionBasis,
        areaRateAdjustment: areaCountResult?.rateAdjustment,
        status: "postponed_few" as const,
        skipReason: "few" as const,
        visitedAt: currentVisitedAt,
      },
    };

    if (!hasRemainingNormalFlowArea(judgedCurrentMap, currentAreaId, prev.normalFlowOrder)) {
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

    const nextAreaId = getNextNormalFlowAreaId(
      updatedMap,
      currentAreaId,
      prev.normalFlowOrder
    );

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
    const now = getRuntimeNow();
    const startedAt = now.toISOString();
    const currentDate = formatLocalDate(now);
    const currentWeekday = now.getDay();
    const prev = state;

    // 開始時は、クリック時点の現在時刻で再解決せず、画面に表示されている値引時刻をそのまま使う。
    // そうしないと、天候入力中や開始ボタン押下直前に時刻境界を跨いだとき、
    // 19時30分で入力したのに20時30分の値引へ進むことがある。
    const resolvedDiscountTime =
      !prev.sessionDraft.manualDiscountTimeOverride &&
      isValidDiscountTime(prev.sessionDraft.weatherInputLockedDiscountTime)
        ? prev.sessionDraft.weatherInputLockedDiscountTime
        : prev.sessionDraft.discountTime;

    const canResumeCurrentSession = prev.session?.date === currentDate;
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
      startedAt: canResumeCurrentSession ? prev.session!.startedAt : startedAt,
    };

    let nextSkipRecords = cloneSkipRecords(nextSessionSkipRecordsRef.current);
    let nextState: AppState;

    if (timeSwitchTarget && prev.session && canResumeCurrentSession) {
      let skippedRecords: NextSessionSkipRecord[] = [];
      if (nextSession.discountTime === "18" || nextSession.discountTime === "19") {
        const consumed = consumeSkipRecordsInMemory({
          currentRecords: nextSkipRecords,
          date: nextSession.date,
          targetDiscountTime: nextSession.discountTime,
        });

        nextSkipRecords = consumed.remainingRecords;
        skippedRecords = consumed.skippedRecords;
      }

      const timeSwitchPlan = createTimeSwitchPlan({
        previousMap: prev.areaProgressMap,
        skippedRecords,
        targetDiscountTime: nextSession.discountTime,
        completedAt: startedAt,
      });
      const { areaProgressMap, normalFlowOrder } = timeSwitchPlan;
      const firstAreaId = getFirstNormalFlowAreaId(areaProgressMap, normalFlowOrder);
      const nextReview19ExcludedAreaIds =
        prev.session.discountTime === "15" && nextSession.discountTime === "17"
          ? normalizeReview19ExcludedAreaIds([
              ...prev.review19ExcludedAreaIds,
              ...NORMAL_ROUTE.filter((areaId) => prev.areaProgressMap[areaId]?.areaJudge === "few"),
            ])
          : nextSession.discountTime === "15"
          ? []
          : prev.review19ExcludedAreaIds;

      nextState = {
        ...prev,
        screen: firstAreaId
          ? getNormalFlowScreenForArea(areaProgressMap, firstAreaId)
          : "done",
        session: {
          ...nextSession,
          startedAt,
        },
        areaProgressMap,
        normalFlowOrder,
        currentAreaId: firstAreaId,
        lastReferenceAreaId: firstAreaId,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        timeSwitchNotice: buildTimeSwitchNotice(nextSession.discountTime),
        review19ExcludedAreaIds: nextReview19ExcludedAreaIds,
        finalTimeStep: 0,
      };
    } else if (prev.session && canResumeCurrentSession) {
      const requestedScreen = resumeTargetScreen ?? "area_judge";
      const resumeState = resolveResumeState(prev, requestedScreen);

      nextState = {
        ...prev,
        session: nextSession,
        screen: resumeState.screen,
        currentAreaId: resumeState.currentAreaId,
        lastReferenceAreaId: resumeState.lastReferenceAreaId,
        timeSwitchNotice: null,
        finalTimeStep: resumeState.finalTimeStep,
      };
    } else {
      let areaProgressMap = createInitialAreaProgressMap();
      const normalFlowOrder = [...NORMAL_ROUTE];
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

      const firstAreaId = getFirstNormalFlowAreaId(areaProgressMap, normalFlowOrder);

      nextState = {
        ...prev,
        screen: firstAreaId
          ? getNormalFlowScreenForArea(areaProgressMap, firstAreaId)
          : "done",
        session: nextSession,
        areaProgressMap,
        normalFlowOrder,
        currentAreaId: firstAreaId,
        lastReferenceAreaId: firstAreaId,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        timeSwitchNotice: null,
        finalTimeStep: 0,
      };
    }

    setState(nextState);
    replaceNextSessionSkipRecords(nextSkipRecords);
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
      })
    : null;

  function getCurrentAreaCountRecommendation(count: number) {
    return buildAreaCountRecommendation({
      records: areaCountRecords,
      areaId: state.currentAreaId,
      discountTime: state.session?.discountTime,
      weekday: state.session?.weekday,
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


  function autoDownloadFinalDayData(params: {
    nextState: AppState;
    nextAreaCountRecords: AreaCountRecord[];
    exportedAt: string;
  }): void {
    const session = params.nextState.session;
    if (isTestMode || !session || session.discountTime !== "20") return;
    if (hasFinalDayAutoExported(session.date)) return;

    const allFinalCountsEntered = NORMAL_ROUTE.every(
      (areaId) => typeof params.nextState.areaProgressMap[areaId]?.areaCount === "number",
    );
    if (!allFinalCountsEntered) return;

    const completedAreaProgressMap = NORMAL_ROUTE.reduce((acc, areaId) => {
      const progress = params.nextState.areaProgressMap[areaId];
      acc[areaId] = {
        ...progress,
        areaJudge: progress.areaJudge ?? "normal",
        status: "completed",
        skipReason: undefined,
        visitedAt: progress.visitedAt ?? params.exportedAt,
        completedAt: progress.completedAt ?? params.exportedAt,
      };
      return acc;
    }, {} as Record<AreaId, AreaProgress>);

    const finalDoneSummaryItems = buildFinalSessionDoneSummaryItems({
      session,
      areaProgressMap: completedAreaProgressMap,
      comfortScore: weekdayBaseInfo.weekdayShift,
    });
    const exportState: AppState = {
      ...params.nextState,
      screen: "done",
      areaProgressMap: completedAreaProgressMap,
      currentAreaId: null,
      currentFlow: "normal",
      pendingDeferredAreaIds: [],
      finalTimeStep: 0,
    };
    const finalSessionSnapshot = createDailySessionSnapshot({
      capturedAt: params.exportedAt,
      state: exportState,
      resolvedWeather: sessionSourceResolvedWeather,
      weekdayBaseInfo,
      basisGuide,
      lateTimeBonus,
      doneSummaryItems: finalDoneSummaryItems,
    });
    if (!finalSessionSnapshot) return;

    upsertDailySessionSnapshot(finalSessionSnapshot);
    const sessions = [
      ...getDailySessionSnapshotsForDate(session.date).filter((snapshot) => {
        return !(
          snapshot.session.discountTime === "20" &&
          snapshot.session.startedAt === session.startedAt
        );
      }),
      finalSessionSnapshot,
    ].sort((a, b) => {
      const timeCompare = a.session.discountTime.localeCompare(b.session.discountTime);
      if (timeCompare !== 0) return timeCompare;
      return a.capturedAt.localeCompare(b.capturedAt);
    });

    const daySnapshot = createReview19DaySnapshot({
      capturedAt: params.exportedAt,
      date: session.date,
      areaCountRecords: params.nextAreaCountRecords,
      sessions,
      review19Check: getLatestReview19DayCheck(session.date),
    });
    const payload = buildAutomaticDayExportPayload({
      exportedAt: params.exportedAt,
      date: session.date,
      daySnapshot,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getAutomaticDayExportFilename(session.date);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    markFinalDayAutoExported(session.date);
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
    const areaCountEvaluationSource = readyAreaCountResult
      ? "history" as const
      : manualAreaCountResult
      ? "manual" as const
      : undefined;
    const areaCountDecisionBasis = areaCountRecommendation
      ? buildAreaCountDecisionBasis({
          recommendation: areaCountRecommendation,
          evaluationSource: areaCountEvaluationSource,
          finalEvaluation: effectiveAreaCountResult?.evaluation,
          areaRateAdjustment: effectiveAreaCountResult?.rateAdjustment,
        })
      : undefined;

    // エリア残数判定が使える場合、エリア判定は5段階結果で固定する。
    const effectiveJudge: Exclude<AreaJudge, null> = effectiveAreaCountResult ? "normal" : judge;
    setAreaJudgeSelection(effectiveJudge);

    const actionAt = getRuntimeNow().toISOString();
    let nextAreaCountRecords = areaCountRecords;

    if (
      !isTestMode &&
      roundedAreaCount !== null &&
      state.session &&
      state.currentAreaId &&
      isAreaCountAssistTarget({
        areaId: state.currentAreaId,
        discountTime: state.session.discountTime,
      })
    ) {
      const nextRecord: AreaCountRecord = {
        ...getCurrentDataVersionInfo(),
        date: state.session.date,
        sessionStartedAt: state.session.startedAt,
        recordedAt: actionAt,
        areaId: state.currentAreaId,
        discountTime: state.session.discountTime,
        actualWeekday: getActualWeekdayLabel(state.session.weekday),
        actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({
          weekday: state.session.weekday,
          discountTime: state.session.discountTime,
          date: state.session.date,
        }),
        count: roundedAreaCount,
        userJudge: manualAreaCountEvaluation,
        suggestedEvaluation: effectiveAreaCountResult?.evaluation,
        areaRateAdjustment: effectiveAreaCountResult?.rateAdjustment,
        evaluationSource: areaCountEvaluationSource,
        decisionBasis: areaCountDecisionBasis,
      };

      nextAreaCountRecords = upsertAreaCountRecord(areaCountRecords, nextRecord);
      setAreaCountRecords(nextAreaCountRecords);
      void upsertRemoteAreaCountRecord(nextRecord);
    }

    const nextStateForAction = applyAreaJudgeSelection(
      state,
      effectiveJudge,
      roundedAreaCount,
      effectiveAreaCountResult,
      areaCountEvaluationSource,
      areaCountDecisionBasis,
    );

    setState((prev) =>
      applyAreaJudgeSelection(
        prev,
        effectiveJudge,
        roundedAreaCount,
        effectiveAreaCountResult,
        areaCountEvaluationSource,
        areaCountDecisionBasis,
      )
    );

    autoDownloadFinalDayData({
      nextState: nextStateForAction,
      nextAreaCountRecords,
      exportedAt: actionAt,
    });
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

      const nextAreaId = getNextNormalFlowAreaId(
        updatedMap,
        currentAreaId,
        prev.normalFlowOrder
      );

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

    const clickedAreaId = state.currentAreaId;
    const clickedProgress = clickedAreaId ? state.areaProgressMap[clickedAreaId] : null;
    const completedAt = getRuntimeNow().toISOString();
    const clickedRateSnapshot = clickedAreaId && clickedProgress
      ? buildCompletedRateSnapshot({
          session: state.session,
          progress: clickedProgress,
          weatherBonus: weekdayBaseInfo.baseRateBonus + lateTimeBonus,
          weekdayBase: weekdayBaseInfo.adjusted,
          rateDisplayOverride: rateDisplay,
        })
      : null;

    let skipRecordToAdd: NextSessionSkipRecord | null = null;
    if (
      clickedAreaId &&
      clickedRateSnapshot &&
      state.session &&
      !state.session.manualDiscountTimeOverride
    ) {
      const earlyNextTargetDiscountTime =
        clickedProgress?.earlyNextMinus5TargetDiscountTime ??
        (earlyNextMinus5Info &&
        (state.session.discountTime === "17" || state.session.discountTime === "18")
          ? earlyNextMinus5Info.targetDiscountTime
          : null);
      const targetDiscountTime =
        earlyNextTargetDiscountTime ??
        (lateTimeBonus > 0
          ? getNextSkipTargetDiscountTime(state.session.discountTime)
          : null);

      if (targetDiscountTime) {
        skipRecordToAdd = buildNextSessionSkipRecord({
          date: state.session.date,
          targetDiscountTime,
          areaId: clickedAreaId,
          rateSnapshot: clickedRateSnapshot,
          skipKind: earlyNextTargetDiscountTime
            ? "early_next_minus5"
            : "late_plus5",
        });
      }
    }

    setState((prev) => {
      if (!clickedAreaId || prev.currentAreaId !== clickedAreaId || !clickedRateSnapshot) return prev;
      const { nextSession, timeSwitchNotice } = refreshSessionDiscountTime(prev.session);

      const updatedMap = {
        ...prev.areaProgressMap,
        [clickedAreaId]: {
          ...prev.areaProgressMap[clickedAreaId],
          status: "completed" as const,
          completedAt,
          skipReason: undefined,
          ...clickedRateSnapshot,
        },
      };

      if (prev.currentFlow === "pending") {
        return moveToNextPendingOrDone({
          prev,
          updatedMap,
          referenceAreaId: clickedAreaId,
          nextSession,
          timeSwitchNotice,
        });
      }

      const nextAreaId = getNextNormalFlowAreaId(
        updatedMap,
        clickedAreaId,
        prev.normalFlowOrder
      );

      if (nextAreaId) {
        return {
          ...prev,
          session: nextSession,
          timeSwitchNotice,
          areaProgressMap: updatedMap,
          currentAreaId: nextAreaId,
          lastReferenceAreaId: clickedAreaId,
          pendingDeferredAreaIds: [],
          finalTimeStep: 0,
          screen: getNormalFlowScreenForArea(updatedMap, nextAreaId),
        };
      }

      return moveToNextPendingOrDone({
        prev,
        updatedMap,
        referenceAreaId: clickedAreaId,
        nextSession,
        timeSwitchNotice,
      });
    });

    if (skipRecordToAdd) {
      appendNextSessionSkipRecords([skipRecordToAdd]);
    }
  }

  function acknowledgeAutoSkippedArea() {
    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);

    setState((prev) => {
      if (!prev.currentAreaId) return prev;
      const currentAreaId = prev.currentAreaId;
      const currentProgress = prev.areaProgressMap[currentAreaId];

      if (currentProgress?.status !== "auto_skipped_late_time") return prev;

      const acknowledgedAt = getRuntimeNow().toISOString();
      const updatedMap = {
        ...prev.areaProgressMap,
        [currentAreaId]: {
          ...currentProgress,
          visitedAt: currentProgress.visitedAt ?? acknowledgedAt,
          completedAt: currentProgress.completedAt ?? acknowledgedAt,
        },
      };

      const nextAreaId = getNextNormalFlowAreaId(
        updatedMap,
        currentAreaId,
        prev.normalFlowOrder
      );

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
      if (
        !canStartReview19FromCurrentState({
          state: prev,
          now,
          records: loadReview19Records(),
        })
      ) {
        return prev;
      }

      const currentDate = formatLocalDate(now);
      const sourceStateForReview = selectReview19SourceState({
        currentState: prev,
        savedSourceState: loadReview19SourceState(),
        currentDate,
      });
      const session = sourceStateForReview?.session;
      if (!session) return prev;

      const reviewDraft = createReview19WeatherDraft(session);
      const initialReview19 = createInitialReview19Result({
        date: session.date,
        sessionStartedAt: session.startedAt,
        reviewStartedAt: now.toISOString(),
        excludedAreaIds: sourceStateForReview.review19ExcludedAreaIds,
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

  function markReview19NotApplicable() {
    if (state.screen !== "done" && state.screen !== "start") return;

    const ok = window.confirm(
      "今日の19:00チェックを「対象外」として記録しますか？",
    );
    if (!ok) return;

    const now = getRuntimeNow();
    const savedRecords = loadReview19Records();
    if (
      !canStartReview19FromCurrentState({
        state,
        now,
        records: savedRecords,
      })
    ) {
      return;
    }

    const currentDate = formatLocalDate(now);
    const recordedAt = now.toISOString();
    const sourceState =
      state.session?.date === currentDate
        ? state
        : normalizeLoadedState(loadReview19SourceState(), state.sessionDraft);
    const sourceSession =
      sourceState.session?.date === currentDate ? sourceState.session : null;
    const initialReview19 = createInitialReview19Result({
      date: currentDate,
      sessionStartedAt: sourceSession?.startedAt ?? recordedAt,
      review19Status: "not_applicable",
    });
    const review19Check: Review19DayCheckSnapshot = {
      version: 1,
      ...getCurrentDataVersionInfo(),
      review19Status: "not_applicable",
      recordedAt,
      sessionStartedAt: initialReview19.sessionStartedAt,
      reviewCompletedAt: recordedAt,
      areaCountRecordedAt: {},
      ratingStatus: "not_collected",
      ratings: null,
      ratingScores: null,
      areaCounts: {},
      excludedAreaIds: [],
      excludeReasons: {},
      dataQuality: initialReview19.dataQuality,
    };
    const recordedReview: Review19Result = {
      ...initialReview19,
      reviewCompletedAt: recordedAt,
      recordedAt,
      daySnapshot: createReview19DaySnapshot({
        capturedAt: recordedAt,
        date: currentDate,
        areaCountRecords,
        sessions: getDailySessionSnapshotsForDate(currentDate),
        review19Check,
      }),
    };

    if (!isTestMode) {
      appendReview19Record(recordedReview);
      clearReview19SourceState();
      setReview19RecordsVersion((version) => version + 1);
    }

    setUndoSnapshot(null);
    setUndoNotice(null);
    setState((prev) => ({
      ...prev,
      session: sourceSession ?? prev.session,
      screen: "review19_done",
      review19: recordedReview,
    }));
  }

  function startReview19AfterWeather() {
    setState((prev) => {
      if (prev.screen !== "review19_weather" || !prev.session || !prev.review19) return prev;

      return {
        ...prev,
        screen: "review19",
        review19: {
          ...prev.review19,
          reviewStartedAt: prev.review19.reviewStartedAt ?? getRuntimeNow().toISOString(),
          reference: createReview19Reference(prev.sessionDraft),
        },
      };
    });
  }

  function updateReview19AreaCount(areaId: AreaId, count: number) {
    setState((prev) => {
      if (prev.screen !== "review19" || !prev.review19) return prev;

      const safeCount = Math.max(0, Math.round(count));
      const recordedAt = getRuntimeNow().toISOString();
      const nextExcludedAreaIds = prev.review19.excludedAreaIds.filter((id) => id !== areaId);
      const nextExcludeReasons = { ...prev.review19.excludeReasons };
      delete nextExcludeReasons[areaId];
      const nextAreaCounts = {
        ...prev.review19.areaCounts,
        [areaId]: safeCount,
      };

      return {
        ...prev,
        review19: {
          ...prev.review19,
          areaCounts: nextAreaCounts,
          areaCountRecordedAt: {
            ...prev.review19.areaCountRecordedAt,
            [areaId]: recordedAt,
          },
          excludedAreaIds: nextExcludedAreaIds,
          excludeReasons: nextExcludeReasons,
          dataQuality: buildReview19DataQuality({
            date: prev.review19.date,
            areaCounts: nextAreaCounts,
            excludedAreaIds: nextExcludedAreaIds,
          }),
        },
      };
    });
  }

  function skipReview19Area(areaId: AreaId) {
    setState((prev) => {
      if (prev.screen !== "review19" || !prev.review19) return prev;

      const nextAreaCounts = { ...prev.review19.areaCounts };
      delete nextAreaCounts[areaId];
      const nextAreaCountRecordedAt = { ...prev.review19.areaCountRecordedAt };
      delete nextAreaCountRecordedAt[areaId];

      const nextExcludedAreaIds = prev.review19.excludedAreaIds.includes(areaId)
        ? prev.review19.excludedAreaIds
        : [...prev.review19.excludedAreaIds, areaId];

      return {
        ...prev,
        review19: {
          ...prev.review19,
          areaCounts: nextAreaCounts,
          areaCountRecordedAt: nextAreaCountRecordedAt,
          excludedAreaIds: nextExcludedAreaIds,
          excludeReasons: {
            ...prev.review19.excludeReasons,
            [areaId]: "manual",
          },
          dataQuality: buildReview19DataQuality({
            date: prev.review19.date,
            areaCounts: nextAreaCounts,
            excludedAreaIds: nextExcludedAreaIds,
          }),
        },
      };
    });
  }

  function buildRecordedReview19Result(
    latestAreaCount?: { areaId: AreaId; count: number },
    latestExcludedAreaId?: AreaId
  ): Review19Result | null {
    if ((state.screen !== "review19" && state.screen !== "review19_done") || !state.review19) return null;

    const completedAt = getRuntimeNow().toISOString();
    const latestAreaCounts: Partial<Record<AreaId, number>> = latestAreaCount
      ? { [latestAreaCount.areaId]: Math.max(0, Math.round(latestAreaCount.count)) }
      : {};
    const excludedAreaIdSet = new Set(state.review19.excludedAreaIds);
    const excludeReasons = { ...state.review19.excludeReasons };

    if (latestAreaCount) {
      excludedAreaIdSet.delete(latestAreaCount.areaId);
      delete excludeReasons[latestAreaCount.areaId];
    }

    if (latestExcludedAreaId) {
      excludedAreaIdSet.add(latestExcludedAreaId);
      excludeReasons[latestExcludedAreaId] = "manual";
    }

    const recordedAreaCounts: Partial<Record<AreaId, number>> = {
      ...state.review19.areaCounts,
      ...latestAreaCounts,
    };
    for (const areaId of excludedAreaIdSet) {
      delete recordedAreaCounts[areaId];
    }
    const areaCountRecordedAt = {
      ...state.review19.areaCountRecordedAt,
    };
    if (latestAreaCount) {
      areaCountRecordedAt[latestAreaCount.areaId] = completedAt;
    }
    for (const areaId of excludedAreaIdSet) {
      delete areaCountRecordedAt[areaId];
    }

    const excludedAreaIds = NORMAL_ROUTE.filter((areaId) => excludedAreaIdSet.has(areaId));
    const recordedAt = state.review19.recordedAt ?? completedAt;
    const dataQuality = buildReview19DataQuality({
      date: state.review19.date,
      areaCounts: recordedAreaCounts,
      excludedAreaIds,
    });
    const snapshot = state.session
      ? createReview19Snapshot({
          capturedAt: recordedAt,
          session: state.session,
          resolvedWeather: sessionSourceResolvedWeather,
          weekdayBaseInfo,
          basisGuide,
          lateTimeBonus,
          excludedAreaIds,
          areaProgressMap: state.areaProgressMap,
          doneSummaryItems,
        })
      : state.review19.snapshot;

    const daySnapshot = createReview19DaySnapshot({
      capturedAt: recordedAt,
      date: state.review19.date,
      areaCountRecords,
      sessions: getDailySessionSnapshotsForDate(state.review19.date),
      review19Check: {
        version: 1,
        ...getCurrentDataVersionInfo(),
        review19Status: "recorded",
        recordedAt,
        sessionStartedAt: state.review19.sessionStartedAt,
        reviewStartedAt: state.review19.reviewStartedAt,
        reviewCompletedAt: completedAt,
        areaCountRecordedAt,
        ratingStatus: "not_collected",
        ratings: null,
        ratingScores: null,
        areaCounts: recordedAreaCounts,
        excludedAreaIds,
        excludeReasons,
        dataQuality,
        snapshot,
      },
    });

    const review19WithoutReference: Review19Result = { ...state.review19 };
    delete review19WithoutReference.reference;

    return {
      ...review19WithoutReference,
      ...getCurrentDataVersionInfo(),
      review19Status: "recorded",
      ratingStatus: "not_collected",
      ratings: null,
      ratingScores: null,
      areaCounts: recordedAreaCounts,
      areaCountRecordedAt,
      excludedAreaIds,
      excludeReasons,
      reviewCompletedAt: completedAt,
      dataQuality,
      recordedAt,
      snapshot,
      daySnapshot,
    };
  }

  function saveReview19(latestAreaCount?: { areaId: AreaId; count: number }, latestExcludedAreaId?: AreaId) {
    const recordedReview = buildRecordedReview19Result(latestAreaCount, latestExcludedAreaId);
    if (!recordedReview) return;

    if (!isTestMode) {
      appendReview19Record(recordedReview);
      clearReview19SourceState();
      setReview19RecordsVersion((version) => version + 1);
    }

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
    if (state.screen !== "review19" && state.screen !== "review19_done") return;

    const now = getRuntimeNow();
    const startedAt = now.toISOString();
    const draft = normalizeSessionDraft({
      ...state.sessionDraft,
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
      currentRecords: nextSessionSkipRecordsRef.current,
      date: nextSession.date,
      targetDiscountTime: "19",
    });

    const areaProgressMap = createAreaProgressMapWithAutoSkippedAreas(consumed.skippedRecords);
    const normalFlowOrder = [...NORMAL_ROUTE];
    const firstAreaId = getFirstNormalFlowAreaId(areaProgressMap, normalFlowOrder);

    setState({
      ...state,
      screen: firstAreaId ? getNormalFlowScreenForArea(areaProgressMap, firstAreaId) : "done",
      session: nextSession,
      areaProgressMap,
      normalFlowOrder,
      currentAreaId: firstAreaId,
      lastReferenceAreaId: firstAreaId,
      currentFlow: "normal",
      pendingDeferredAreaIds: [],
      timeSwitchNotice: null,
      finalTimeStep: 0,
    });

    replaceNextSessionSkipRecords(consumed.remainingRecords);
    setResumeTargetScreen(null);
    setTimeSwitchTarget(null);
    setUndoSnapshot(null);
    setUndoNotice(null);
  }

  function openNextSessionInput(
    targetDiscountTime: DiscountTime,
    options?: { preserveCurrentSession?: boolean }
  ) {
    const now = getRuntimeNow();
    const currentDate = formatLocalDate(now);
    const currentWeekday = now.getDay();

    if (state.session?.date === currentDate && state.session.discountTime === "17") {
      saveReview19SourceState(cloneAppState(state));
    }

    const baseDraft = buildStartDefaultDraft(lastUsedSessionDraft);
    const nextDraft: SessionDraft = {
      ...baseDraft,
      date: currentDate,
      weekday: currentWeekday,
      discountTime: targetDiscountTime,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather: {
        ...baseDraft.weather,
        hourlyForecasts: cloneHourlyForecasts(baseDraft.weather.hourlyForecasts),
      },
    };

    if (options?.preserveCurrentSession && state.session) {
      setState((prev) => ({
        ...prev,
        screen: "start",
        sessionDraft: nextDraft,
        timeSwitchNotice: null,
      }));
      setAreaJudgeSelection(null);
      setResumeTargetScreen(null);
      setTimeSwitchTarget(targetDiscountTime);
      setUndoSnapshot(null);
      setUndoNotice(null);
      return;
    }

    clearWorkSessionCheckpoint();
    clearRuntimeState();
    screenHistoryRef.current = [];
    previousRenderRef.current = null;
    suppressHistoryPushRef.current = false;
    setState(createInitialState(nextDraft));
    setAreaJudgeSelection(null);
    setResumeTargetScreen(null);
    setTimeSwitchTarget(null);
    setUndoSnapshot(null);
    setUndoNotice(null);
  }

  function startNextDoneSession(options?: { autoTransition?: boolean }) {
    if (!state.session) return;

    const previousDiscountTime = state.session.discountTime;
    const nextInfo = getNextDoneDiscountInfo(previousDiscountTime, new Date(nowMs));
    if (!nextInfo?.canStart) return;

    const prioritizeUnfinishedAreas =
      (options?.autoTransition ?? false) &&
      shouldPrioritizeUnfinishedAreasOnAutoTransition(state.screen);

    const currentAreaEarlyNextTarget = state.currentAreaId
      ? state.areaProgressMap[state.currentAreaId]?.earlyNextMinus5TargetDiscountTime ??
        earlyNextMinus5Info?.targetDiscountTime ??
        null
      : null;
    const shouldReserveCurrentArea =
      (options?.autoTransition ?? false) &&
      shouldReserveEarlyNextMinus5OnAutoTransition({
        screen: state.screen,
        currentTargetDiscountTime: currentAreaEarlyNextTarget,
        nextTargetDiscountTime: nextInfo.targetDiscountTime,
      });

    if (
      shouldReserveCurrentArea &&
      state.currentAreaId &&
      state.session &&
      !state.session.manualDiscountTimeOverride
    ) {
      const progress = state.areaProgressMap[state.currentAreaId];
      const rateSnapshot = buildCompletedRateSnapshot({
        session: state.session,
        progress,
        weatherBonus: weekdayBaseInfo.baseRateBonus + lateTimeBonus,
        weekdayBase: weekdayBaseInfo.adjusted,
        rateDisplayOverride: rateDisplay,
      });

      appendNextSessionSkipRecords([
        buildNextSessionSkipRecord({
          date: state.session.date,
          targetDiscountTime: currentAreaEarlyNextTarget!,
          areaId: state.currentAreaId,
          rateSnapshot,
          skipKind: "early_next_minus5",
        }),
      ]);
    }

    if (options?.autoTransition) {
      window.alert(buildAutoTimeSwitchDialogText({
        from: previousDiscountTime,
        to: nextInfo.targetDiscountTime,
        prioritizeUnfinishedAreas,
      }));
    }

    // 20時30分も他の値引時刻と同じく、20:25から天候入力画面へ移動する。
    // 21時の天気・気温・風速を確認してから最終値引へ進む。
    openNextSessionInput(nextInfo.targetDiscountTime, {
      preserveCurrentSession: prioritizeUnfinishedAreas,
    });
  }

  function getReview19ExportFilename(params: {
    records: Review19Result[];
    kind: "unexported" | "all";
  }): string {
    const firstDate = params.records[0]?.date ?? "unknown";
    const lastDate = params.records[params.records.length - 1]?.date ?? firstDate;
    return `nebiki-review19-${params.kind}-${firstDate}_${lastDate}.json`;
  }

  function downloadReview19Records(params: {
    records: Review19Result[];
    exportedAt: string;
    kind: "unexported" | "all";
  }) {
    if (params.records.length === 0) return;

    const payload = buildReview19ExportPayload({
      records: params.records,
      exportedAt: params.exportedAt,
    });
    const filename = getReview19ExportFilename({
      records: params.records,
      kind: params.kind,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportReview19Records() {
    const currentRecords = loadReview19Records();
    const unexportedRecords = getUnexportedReview19Records(currentRecords);

    if (unexportedRecords.length === 0) return;

    const exportedAt = getRuntimeNow().toISOString();
    downloadReview19Records({
      records: unexportedRecords,
      exportedAt,
      kind: "unexported",
    });

    saveReview19Records(
      markReview19RecordsExportedInMemory({
        currentRecords,
        recordsToMark: unexportedRecords,
        exportedAt,
      })
    );
    setReview19RecordsVersion((version) => version + 1);
  }

  function exportAllReview19Records() {
    const records = loadReview19Records().sort((a, b) => {
      const recordedCompare = (a.recordedAt ?? "").localeCompare(b.recordedAt ?? "");
      if (recordedCompare !== 0) return recordedCompare;
      return `${a.date}::${a.sessionStartedAt}`.localeCompare(`${b.date}::${b.sessionStartedAt}`);
    });

    if (records.length === 0) return;

    downloadReview19Records({
      records,
      exportedAt: getRuntimeNow().toISOString(),
      kind: "all",
    });
  }

  function resetApp() {
    const now = getRuntimeNow();
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
  currentAreaName,
  weekdayText,
  timeText: effectiveTimeText,
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
  showDayBeforeHolidayNotice,
  showThreeDayHolidayMiddleNotice,
  showHolidayBeforeNormalWeekdayNotice,
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
      updateReview19AreaCount,
      skipReview19Area,
      startReview19AfterWeather,
      saveReview19,
      start19DiscountAfterReview,
      startNextDoneSession,
      exportReview19Records,
      exportAllReview19Records,
      startReview19Manually,
      markReview19NotApplicable,
      resetApp,
    },
  };
}
