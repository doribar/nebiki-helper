import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppState,
  AreaId,
  DailyMessageState,
  AreaProgress,
  DoneSummaryItem,
  DiscountTime,
  PendingBannerInfo,
  PendingReason,
  SessionData,
  SkipTargetOption,
  SessionDraft,
  UseNebikiAppResult,
  AreaJudge,
  ScreenName,
  NextSessionSkipRecord,
  Review19Result,
  AreaCountEvaluation,
  AreaRateAdjustment,
  DemandCycle,
} from "../domain/types";
import {
  buildFinalRateDecisionSnapshot,
  buildRateDecisionSnapshot,
} from "../domain/rateDecisionSnapshot.ts";
import {
  shouldShowDayBeforeHolidayNotice,
  shouldShowHolidayBeforeNormalWeekdayNotice,
  shouldShowThreeDayHolidayMiddleNotice,
} from "../domain/dayBeforeHolidayNotice.ts";
import { DONE_SUMMARY_ROUTE, NORMAL_ROUTE, getAreaName } from "../domain/area";
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
  loadPersistedNebikiStateForDate,
  normalizeDailyMessageState,
  savePersistedNebikiState,
  saveWorkSessionCheckpoint,
  clearWorkSessionCheckpoint,
  saveRuntimeState,
  clearRuntimeState,
  appendReview19Record,
  loadReview19Records,
  loadReview19SourceState,
  saveReview19SourceState,
  clearReview19SourceState,
  getDailySessionSnapshotsForDate,
  loadDailySessionSnapshots,
  upsertDailySessionSnapshot,
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
import { shouldOfferAfterRainRecovery } from "../domain/afterRain";
import {
  cloneHourlyForecasts,
  getNearTermWeatherForDiscount,
  resolveWeatherInputForDiscount,
} from "../domain/hourlyWeather.ts";
import {
  createInitialReview19Result,
  buildReview19DataQuality,
  getReview19AreaItems,
  REVIEW19_EXCLUDE_REASON_TEXT,
} from "../domain/review19.ts";
import {
  buildAllDataExportPayload,
  getAllDataExportFilename,
} from "../domain/allDataExport.ts";
import { getAutomaticDayExportFilename } from "../domain/dayExport.ts";
import {
  initializeFinalizedDayData,
  loadFinalizedDayData,
  patchFinalizedDayDataMetadata,
  patchFinalizedDayDataMetadataByRecordId,
  replaceFinalizedDayDataCore,
  selectFinalizedDayDataByRecordId,
  selectFinalizedDayDataByDate,
  type StoredFinalizedDayData,
} from "../domain/finalizedDayData.ts";
import {
  buildAllFinalizedDayDataExportPayload,
  buildAllReview19DataExportPayload,
  buildDirectFinalizedDayDataExportPayload,
  buildDirectReview19DataExportPayload,
  buildLatestFinalizedDayDataExportPayload,
  buildLatestReview19DataExportPayload,
  selectAllReview19Data,
} from "../domain/separateDataExport.ts";
import { getPreviousJstCalendarDate } from "../domain/jstCalendar.ts";
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
import {
  matchesWeatherConfirmationDraft,
  restoreWeatherConfirmationPending,
  type WeatherConfirmationPending,
} from "../domain/weatherConfirmation.ts";
import { getCurrentDataVersionInfo } from "../domain/dataVersion.ts";
import {
  applyRateOffsetToDisplay,
  buildCompletedRateSnapshot,
  buildNextSessionSkipRecord,
  getAreaJudgeText,
  getAreaStatusText,
  getProgressManyRateText,
  getProgressNormalRateText,
  shouldIgnoreNormalTimeRateCap,
} from "./nebikiApp/ratePresentation.ts";
import type { CompletedRateSnapshot } from "./nebikiApp/ratePresentation.ts";
import {
  acknowledgeAutoSkippedProgress,
  isAutoSkipNoticePending,
  processEarlyNextMinus5AreaNormally,
  recordAutoSkippedCountOnlyProgress,
  startAutoSkippedCountOnlyProgress,
} from "./nebikiApp/autoSkipFlow.ts";
import {
  buildTimeSwitchNotice,
  canStartReview19FromCurrentState,
  formatLocalDate,
  getBasisTimeText,
  getNextDoneDiscountInfo,
  getRuntimeNow,
  getRuntimeNowMs,
  resolveDiscountTime,
  setRuntimeNowOverride,
} from "./nebikiApp/clock.ts";
import {
  addReview19ExcludedAreaId,
  buildStartDefaultDraft,
  clonePersistedNebikiStateSnapshot,
  createInitialAreaProgressMap,
  createInitialState,
  getInitialTimeSwitchTarget,
  isValidDiscountTime,
  normalizeLoadedState,
  normalizeReview19ExcludedAreaIds,
  normalizeSessionDraft,
  removeReview19ExcludedAreaId,
  shouldUseCheckpointInsteadOfCurrent,
  syncAfterRainSelection,
} from "./nebikiApp/stateNormalization.ts";
import {
  getFirstNormalFlowAreaId,
  getNextNormalFlowAreaId,
  getNextNormalFlowAreaIdWithWrap,
  getNormalFlowScreenForArea,
  hasRemainingNormalFlowArea,
} from "./nebikiApp/normalFlow.ts";
import { selectReview19SourceState } from "./nebikiApp/review19Flow.ts";
import {
  buildAutoTimeSwitchDialogText,
  createAreaProgressMapWithAutoSkippedAreas,
  createTimeSwitchPlan,
  finalizeUnmeasuredAreasForAutoTransition,
  getFirstAvailableAreaId,
  getNextSkipTargetDiscountTime,
  getWeekdayText,
  refreshSessionDiscountTime,
  shouldPrioritizeUnfinishedAreasOnAutoTransition,
} from "./nebikiApp/timeTransitions.ts";
import {
  buildFinalSessionDoneSummaryItems,
  createDailySessionSnapshot,
  createReview19DaySnapshot,
  createReview19Reference,
  createReview19Snapshot,
  createReview19WeatherDraft,
  getLatestReview19DayCheck,
} from "./nebikiApp/sessionSnapshots.ts";
import {
  getNearTemperatureC,
  resolveSessionTemperatureComfort,
} from "./nebikiApp/temperatureComfortState.ts";
import {
  getDemandCycleBasisLabel,
  getDemandCycleShortName,
  normalizeDemandCycle,
  resolveDemandCycleFromEvidence,
} from "../domain/demandCycle.ts";
import {
  loadDemandCycleState,
  loadSummerAreaCountRecords,
  lockDemandCycleForDate,
  saveDemandCycleState,
  selectDemandCycleForDate,
  selectDemandCycleLockForDate,
  updateDemandCyclePreference,
  upsertSummerAreaCountRecord,
  type DemandCycleState,
} from "../domain/demandCycleStorage.ts";

export { selectReview19SourceState } from "./nebikiApp/review19Flow.ts";

export {
  createTimeSwitchPlan,
  finalizeUnmeasuredAreasForAutoTransition,
} from "./nebikiApp/timeTransitions.ts";

export { createReview19Snapshot } from "./nebikiApp/sessionSnapshots.ts";

export {
  getInitialTimeSwitchTarget,
  normalizeAreaProgressMap,
  normalizeLoadedState,
  normalizeNormalFlowOrder,
} from "./nebikiApp/stateNormalization.ts";

export {
  acknowledgeAutoSkippedProgress,
  processEarlyNextMinus5AreaNormally,
  recordAutoSkippedCountOnlyProgress,
  startAutoSkippedCountOnlyProgress,
} from "./nebikiApp/autoSkipFlow.ts";

function downloadJsonFile(payload: unknown, filename: string): void {
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

  const initialToday = formatLocalDate(getRuntimeNow());
  const initialDemandCycleState = isTestMode
    ? ({
        selectedCycle: "normal",
        lockedDate: null,
        lockedCycle: null,
      } satisfies DemandCycleState)
    : loadDemandCycleState();
  const initialLastUsedSessionDraftBase = buildStartDefaultDraft(
    isTestMode ? null : initialPersistenceRef.current?.lastUsedSessionDraft ?? null
  );
  const initialLastUsedSessionDraft: SessionDraft = {
    ...initialLastUsedSessionDraftBase,
    demandCycle: selectDemandCycleForDate(initialDemandCycleState, initialToday),
  };
  const initialLoadedState = isTestMode
    ? null
    : shouldUseCheckpointInsteadOfCurrent({
        currentSession: initialPersistenceRef.current?.currentSession ?? null,
        checkpoint: initialPersistenceRef.current?.workSessionCheckpoint ?? null,
        today: initialToday,
      })
    ? initialPersistenceRef.current?.workSessionCheckpoint ?? null
    : initialPersistenceRef.current?.currentSession ?? null;

  const initialWeatherConfirmationPending = isTestMode
    ? null
    : restoreWeatherConfirmationPending({
        raw: initialPersistenceRef.current?.runtimeState
          ?.weatherConfirmationPending,
        screen: initialLoadedState?.screen,
        sessionDraft: initialLoadedState?.sessionDraft,
        currentDate: initialToday,
      });

  const [state, setState] = useState<AppState>(() => {
    const normalizedBase = normalizeLoadedState(
      initialLoadedState,
      initialLastUsedSessionDraft,
    );
    const normalized = normalizedBase.session
      ? normalizedBase
      : {
          ...normalizedBase,
          sessionDraft: {
            ...normalizedBase.sessionDraft,
            demandCycle: selectDemandCycleForDate(
              initialDemandCycleState,
              normalizedBase.sessionDraft.date,
            ),
          },
        };

    if (!initialWeatherConfirmationPending || !initialLoadedState) {
      return normalized;
    }

    return {
      ...normalized,
      sessionDraft: normalizeSessionDraft(initialLoadedState.sessionDraft),
    };
  });
  const [weatherConfirmationPending, setWeatherConfirmationPending] =
    useState<WeatherConfirmationPending | null>(
      initialWeatherConfirmationPending,
    );
  const [weatherCorrectionRequestId, setWeatherCorrectionRequestId] =
    useState(0);
  const weatherConfirmationSubmittingRef = useRef(false);
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
  const [demandCycleState, setDemandCycleState] = useState<DemandCycleState>(
    initialDemandCycleState,
  );
  const [areaCountRemoteLoadStatus, setAreaCountRemoteLoadStatus] = useState<
    "loading" | "ready" | "disabled" | "error"
  >("loading");
  const [areaCountRecords, setAreaCountRecords] = useState<AreaCountRecord[]>(() =>
    isTestMode ? [] : loadSummerAreaCountRecords()
  );
  const [review19RecordsVersion, setReview19RecordsVersion] = useState(0);
  const [finalizedDayDataVersion, setFinalizedDayDataVersion] = useState(0);
  const lastFinalizedDayDataRef = useRef<StoredFinalizedDayData | null>(null);

  if (!lastFinalizedDayDataRef.current && state.finalizedDayRecordId) {
    lastFinalizedDayDataRef.current =
      loadFinalizedDayData().find(
        (record) => record.recordId === state.finalizedDayRecordId,
      ) ?? null;
  }

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
    weatherConfirmationSubmittingRef.current = false;
    setWeatherConfirmationPending(null);
    replaceNextSessionSkipRecords(snapshot.nextSessionSkipRecords);
    setLastSessionWeather(cloneLastSessionWeatherRecord(snapshot.lastSessionWeather));
    const restoredState = cloneAppState(snapshot.state);
    if (
      state.finalizedDayRecordId &&
      state.session?.discountTime === "20" &&
      restoredState.session?.discountTime === "20" &&
      restoredState.session.date === state.session.date &&
      restoredState.session.startedAt === state.session.startedAt
    ) {
      restoredState.finalizedDayRecordId = state.finalizedDayRecordId;
    }
    setState(restoredState);
    setAreaJudgeSelection(snapshot.areaJudgeSelection);
    setResumeTargetScreen(snapshot.resumeTargetScreen);
    setTimeSwitchTarget(null);
  }
  const previousRenderRef = useRef<NavigationSnapshot | null>(null);
  const suppressHistoryPushRef = useRef(false);



  useEffect(() => {
    let cancelled = false;

    void loadRemoteAreaCountRecords().then((result) => {
      if (cancelled) return;
      setAreaCountRemoteLoadStatus(result.status);
      if (result.status !== "ready") return;

      // 通常サイクルは従来どおりSupabaseを正本とし、列を追加できない
      // 夏サイクルだけを端末内の専用JSON履歴から併合する。
      setAreaCountRecords((current) => {
        const localSummerRecords = current.filter(
          (record) => normalizeDemandCycle(record.demandCycle) === "summer",
        );
        return [...cloneAreaCountRecords(result.records), ...cloneAreaCountRecords(localSummerRecords)];
      });
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
      weatherConfirmationPending,
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
    weatherConfirmationPending,
  ]);

  useEffect(() => {
    if (!weatherConfirmationPending) return;
    if (
      matchesWeatherConfirmationDraft({
        pending: weatherConfirmationPending,
        screen: state.screen,
        sessionDraft: state.sessionDraft,
      })
    ) {
      return;
    }

    weatherConfirmationSubmittingRef.current = false;
    setWeatherConfirmationPending(null);
  }, [
    state.screen,
    state.sessionDraft,
    weatherConfirmationPending,
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

    const nearTempC = state.session.legacyUnresolvedTempLevel
      ? undefined
      : getNearTemperatureC(
          state.session.weather,
          state.session.discountTime,
        );
    const nextRecord = {
      date: state.session.date,
      discountTime: state.session.discountTime,
      demandCycle: normalizeDemandCycle(state.session.demandCycle),
      nearTermWeather: getNearTermWeatherForDiscount(state.session.weather, state.session.discountTime),
      nearTempC,
      sessionStartedAt: state.session.startedAt,
      temperatureComfortAnalysis: state.session.temperatureComfortAnalysis,
    } as const;

    setLastSessionWeather((current) => {
      if (
        current?.date === nextRecord.date &&
        current?.discountTime === nextRecord.discountTime &&
        normalizeDemandCycle(current?.demandCycle) === nextRecord.demandCycle &&
        current?.nearTermWeather === nextRecord.nearTermWeather &&
        current?.nearTempC === nextRecord.nearTempC &&
        current?.sessionStartedAt === nextRecord.sessionStartedAt &&
        JSON.stringify(current?.temperatureComfortAnalysis) ===
          JSON.stringify(nextRecord.temperatureComfortAnalysis)
      ) {
        return current;
      }

      return nextRecord;
    });
  }, [state.session?.startedAt]);

  useEffect(() => {
    const session = state.session;
    const temperatureComfortAnalysis = session?.temperatureComfortAnalysis;
    if (!session || !temperatureComfortAnalysis) return;
    const nearTempC = session.legacyUnresolvedTempLevel
      ? undefined
      : getNearTemperatureC(session.weather, session.discountTime);

    setLastSessionWeather((current) => {
      if (
        !current ||
        current.date !== session.date ||
        current.discountTime !== session.discountTime ||
        (current.sessionStartedAt !== undefined &&
          current.sessionStartedAt !== session.startedAt)
      ) {
        return current;
      }
      if (
        current.nearTempC === nearTempC &&
        JSON.stringify(current.temperatureComfortAnalysis) ===
          JSON.stringify(temperatureComfortAnalysis)
      ) {
        return current;
      }
      return {
        ...current,
        nearTempC,
        sessionStartedAt: session.startedAt,
        temperatureComfortAnalysis: {
          ...temperatureComfortAnalysis,
        },
      };
    });
  }, [state.session]);

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
    if (!state.session) {
      return resolveWeatherInputForDiscount(
        sessionSource.weather,
        sessionSource.discountTime,
      );
    }

    return resolveSessionTemperatureComfort({
      date: state.session.date,
      discountTime: state.session.discountTime,
      weather: state.session.weather,
      snapshots: getDailySessionSnapshotsForDate(state.session.date),
      lastSessionWeather,
      existingAnalysis: state.session.temperatureComfortAnalysis,
      legacyUnresolvedTempLevel: state.session.legacyUnresolvedTempLevel,
    }).resolvedWeather;
  }, [state.session, sessionSource.weather, sessionSource.discountTime, lastSessionWeather]);
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
    const resolvedWeather = resolveSessionTemperatureComfort({
      date: state.session.date,
      discountTime: targetDiscountTime,
      weather: state.session.weather,
      snapshots: getDailySessionSnapshotsForDate(state.session.date),
      lastSessionWeather,
      previousSession: state.session,
    }).resolvedWeather;
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
    lastSessionWeather,
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

  const displayBasisGuide = useMemo(() => {
    if (!state.session || state.session.discountTime !== "15") {
      return basisGuide;
    }

    const current = new Date(nowMs);
    const minutes = current.getHours() * 60 + current.getMinutes();
    if (minutes < 16 * 60) return basisGuide;

    return {
      ...basisGuide,
      referenceText: basisGuide.referenceText.replace(
        "15時を基準に考えて",
        "16時を基準に考えて",
      ),
    };
  }, [basisGuide, nowMs, state.session]);

  const ignoreNormalTimeRateCap = shouldIgnoreNormalTimeRateCap(sessionSourceResolvedWeather);
  const effectiveRateDiscountTime = earlyNextMinus5Info?.targetDiscountTime ?? state.session?.discountTime;
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

    return DONE_SUMMARY_ROUTE.map((areaId) => {
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

      const completedNormalRateText =
        progress.rateDecisionSnapshot?.displayedRateText ??
        getProgressNormalRateText(progress) ??
        "旧データ（確定率未記録）";
      const completedManyRateText =
        progress.rateDecisionSnapshot?.displayedManyRatePercent !== undefined
          ? `${progress.rateDecisionSnapshot.displayedManyRatePercent}%`
          : getProgressManyRateText(progress) ??
            "旧データ（確定率未記録）";

      return {
        areaId,
        areaName: getAreaName(areaId),
        judgeText: progress.areaCountEvaluation
          ? getAreaCountEvaluationText(progress.areaCountEvaluation)
          : getAreaJudgeText(progress.areaJudge),
        rateText: completedNormalRateText,
        manyRateText: completedManyRateText,
        normalRateText: completedNormalRateText,
        statusText,
      };
    });
  }, [
    state.session,
    state.areaProgressMap,
    weekdayBaseInfo.weekdayShift,
  ]);

  useEffect(() => {
    if (isTestMode) return;
    if (!state.session) return;
    // 20:30は全エリア入力完了時に正式日次データを一度だけ確定する。
    // done描画時の再構築で確定済みsnapshotを劣化させない。
    if (state.session.discountTime === "20") return;
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
  const savedFinalizedDayData = (() => {
    void finalizedDayDataVersion;
    return loadFinalizedDayData();
  })();
  const savedDailySessionSnapshots = loadDailySessionSnapshots();
  const completedDailyDates = savedDailySessionSnapshots
    .filter(
      (snapshot) =>
        snapshot.session.discountTime === "20" && snapshot.screen === "done",
    )
    .map((snapshot) => snapshot.session.date);
  const allDataExport = {
    totalCount: new Set([
      ...completedDailyDates,
      ...savedReview19Records.map((record) => record.date),
    ]).size,
  };
  const dataExport = {
    review19Count: selectAllReview19Data(savedReview19Records).length,
    dailyCount: new Set([
      ...savedFinalizedDayData.map((record) => record.date),
      ...completedDailyDates,
    ]).size,
  };
  const editableAreaCounts = NORMAL_ROUTE.flatMap((areaId) => {
    const count = state.areaProgressMap[areaId]?.areaCount;
    return typeof count === "number"
      ? [{ areaId, areaName: getAreaName(areaId), count }]
      : [];
  });
  const activeFinalizedDayData =
    lastFinalizedDayDataRef.current ??
    (state.finalizedDayRecordId
      ? savedFinalizedDayData.find(
          (record) => record.recordId === state.finalizedDayRecordId,
        ) ?? null
      : null);
  const previousDayDate = getPreviousJstCalendarDate(new Date(nowMs));
  const previousDayFinalizedData = previousDayDate
    ? selectFinalizedDayDataByDate(savedFinalizedDayData, previousDayDate)
    : null;
  const previousDayDiscardTarget = previousDayFinalizedData
    ? {
        date: previousDayFinalizedData.date,
        count: previousDayFinalizedData.discardCount,
      }
    : null;

  const canStartReview19Manually = canStartReview19FromCurrentState({
    state,
    now: new Date(nowMs),
    records: savedReview19Records,
  });

  // 開始画面では、前日の完了セッションを保持したまま日付を跨ぐ場合がある。
  // そのため営業日の判定対象は開始ドラフトの日付を優先し、運用中だけ
  // 実セッションの日付を権威とする。
  const demandCycleDate = state.screen === "start"
    ? state.sessionDraft.date
    : state.session?.date ?? state.sessionDraft.date;
  const savedReview19SourceState = loadReview19SourceState();
  const hasCurrentStateRateSnapshot = Boolean(state.session) && Object.values(state.areaProgressMap).some(
    (progress) => Boolean(progress.rateDecisionSnapshot),
  );
  const inferredOperationDemandCycle = resolveDemandCycleFromEvidence(
    demandCycleDate,
    [
      ...(state.session
        ? [{ date: state.session.date, demandCycle: state.session.demandCycle }]
        : []),
      ...(state.review19
        ? [{ date: state.review19.date, demandCycle: state.review19.demandCycle }]
        : []),
      ...(hasCurrentStateRateSnapshot
        ? [{
            date: state.session!.date,
            demandCycle: state.session!.demandCycle,
          }]
        : []),
      ...savedDailySessionSnapshots.map((snapshot) => ({
        date: snapshot.session.date,
        demandCycle: snapshot.demandCycle ?? snapshot.session.demandCycle,
      })),
      ...savedFinalizedDayData.map((record) => ({
        date: record.date,
        demandCycle: record.demandCycle,
      })),
      ...savedReview19Records.map((record) => ({
        date: record.date,
        demandCycle: record.demandCycle,
      })),
      ...areaCountRecords.map((record) => ({
        date: record.date,
        demandCycle: record.demandCycle,
      })),
      ...(savedReview19SourceState?.session
        ? [{
            date: savedReview19SourceState.session.date,
            demandCycle: savedReview19SourceState.session.demandCycle,
          }]
        : []),
      ...nextSessionSkipRecords.map((record) => ({
        date: record.date,
        demandCycle: record.demandCycle,
      })),
      ...(lastSessionWeather
        ? [{ date: lastSessionWeather.date, demandCycle: lastSessionWeather.demandCycle }]
        : []),
    ],
  );
  const persistedDemandCycleLock = selectDemandCycleLockForDate(
    demandCycleState,
    demandCycleDate,
  );
  const activeDemandCycle =
    persistedDemandCycleLock ??
    inferredOperationDemandCycle ??
    normalizeDemandCycle(
      state.screen === "start"
        ? state.sessionDraft.demandCycle
        : state.session?.demandCycle ?? state.sessionDraft.demandCycle,
    );
  const demandCycleHistoryCheckPending = areaCountRemoteLoadStatus === "loading";
  const demandCycleHistoryCheckFailed = areaCountRemoteLoadStatus === "error";
  const canChangeDemandCycle =
    state.screen === "start" &&
    !inferredOperationDemandCycle &&
    !persistedDemandCycleLock &&
    !demandCycleHistoryCheckPending &&
    !demandCycleHistoryCheckFailed;
  const demandCycleChangeBlockedReason = canChangeDemandCycle
    ? null
    : demandCycleHistoryCheckPending
      ? "当日の保存データを確認中のため、需要サイクルはまだ変更できません。"
      : demandCycleHistoryCheckFailed
        ? "当日の保存データを確認できなかったため、安全のため需要サイクルを変更できません。"
        : "当日の値引運用がすでに始まっているため、需要サイクルは変更できません。";

  useEffect(() => {
    if (!inferredOperationDemandCycle) return;

    const nextDemandCycleState = lockDemandCycleForDate(
      demandCycleState,
      demandCycleDate,
      inferredOperationDemandCycle,
    );
    if (
      nextDemandCycleState.selectedCycle !== demandCycleState.selectedCycle ||
      nextDemandCycleState.lockedDate !== demandCycleState.lockedDate ||
      nextDemandCycleState.lockedCycle !== demandCycleState.lockedCycle
    ) {
      setDemandCycleState(nextDemandCycleState);
      if (!isTestMode) saveDemandCycleState(nextDemandCycleState);
    }

    setState((current) => {
      const currentDraftCycle = normalizeDemandCycle(current.sessionDraft.demandCycle);
      const currentSessionCycle = current.session
        ? normalizeDemandCycle(current.session.demandCycle)
        : null;
      if (
        currentDraftCycle === inferredOperationDemandCycle &&
        (!current.session || currentSessionCycle === inferredOperationDemandCycle)
      ) {
        return current;
      }
      return {
        ...current,
        sessionDraft: {
          ...current.sessionDraft,
          demandCycle: inferredOperationDemandCycle,
        },
        session:
          current.session?.date === demandCycleDate
            ? { ...current.session, demandCycle: inferredOperationDemandCycle }
            : current.session,
      };
    });
    setLastUsedSessionDraft((current) =>
      normalizeDemandCycle(current.demandCycle) === inferredOperationDemandCycle
        ? current
        : { ...current, demandCycle: inferredOperationDemandCycle },
    );
  }, [
    demandCycleDate,
    demandCycleState,
    inferredOperationDemandCycle,
    isTestMode,
  ]);


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

  function changeDemandCycle(nextDemandCycle: DemandCycle): boolean {
    if (!canChangeDemandCycle) return false;
    const normalizedNext = normalizeDemandCycle(nextDemandCycle);
    const nextDemandCycleState = updateDemandCyclePreference(
      demandCycleState,
      normalizedNext,
    );

    setDemandCycleState(nextDemandCycleState);
    if (!isTestMode) saveDemandCycleState(nextDemandCycleState);
    setLastUsedSessionDraft((current) => ({
      ...current,
      demandCycle: normalizedNext,
    }));
    setState((current) => ({
      ...current,
      sessionDraft: {
        ...current.sessionDraft,
        demandCycle: normalizedNext,
      },
    }));
    return true;
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

    if (
      requestedScreen === "auto_skip_count" &&
      progress.status === "auto_skipped_late_time" &&
      progress.earlyDiscountResolution === "count_only" &&
      !progress.visitedAt
    ) {
      return {
        screen: "auto_skip_count" as const,
        currentAreaId: fallbackAreaId,
        lastReferenceAreaId: fallbackAreaId,
        finalTimeStep: 0 as const,
      };
    }

    if (
      requestedScreen === "auto_skip_notice" &&
      isAutoSkipNoticePending(progress)
    ) {
      return {
        screen: "auto_skip_notice" as const,
        currentAreaId: fallbackAreaId,
        lastReferenceAreaId: fallbackAreaId,
        finalTimeStep: 0 as const,
      };
    }

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
    stapleItemCount?: number | null,
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
            ...(prev.session?.discountTime === "20"
              ? { stapleItemCount: stapleItemCount ?? null }
              : {}),
            areaCountEvaluation: areaCountResult?.evaluation,
            areaCountEvaluationSource,
            areaCountDecisionBasis,
            areaRateAdjustment: areaCountResult?.rateAdjustment,
            visitedAt: getRuntimeNow().toISOString(),
            measurementStatus:
              typeof areaCount === "number"
                ? "measured"
                : prev.areaProgressMap[currentAreaId].measurementStatus,
            missingReason:
              typeof areaCount === "number"
                ? undefined
                : prev.areaProgressMap[currentAreaId].missingReason,
            measurementRecordedAt:
              typeof areaCount === "number"
                ? getRuntimeNow().toISOString()
                : prev.areaProgressMap[currentAreaId].measurementRecordedAt,
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
        ...(prev.session?.discountTime === "20"
          ? { stapleItemCount: stapleItemCount ?? null }
          : {}),
        areaCountEvaluation: areaCountResult?.evaluation,
        areaCountEvaluationSource,
        areaCountDecisionBasis,
        areaRateAdjustment: areaCountResult?.rateAdjustment,
        visitedAt: currentVisitedAt,
        measurementStatus:
          typeof areaCount === "number"
            ? "measured"
            : prev.areaProgressMap[currentAreaId].measurementStatus,
        missingReason:
          typeof areaCount === "number"
            ? undefined
            : prev.areaProgressMap[currentAreaId].missingReason,
        measurementRecordedAt:
          typeof areaCount === "number"
            ? currentVisitedAt
            : prev.areaProgressMap[currentAreaId].measurementRecordedAt,
      },
    };

    const updatedMap = {
      ...prev.areaProgressMap,
      [currentAreaId]: {
        ...prev.areaProgressMap[currentAreaId],
        areaJudge: "few" as const,
        areaCount: areaCount ?? prev.areaProgressMap[currentAreaId].areaCount,
        ...(prev.session?.discountTime === "20"
          ? { stapleItemCount: stapleItemCount ?? null }
          : {}),
        areaCountEvaluation: areaCountResult?.evaluation,
        areaCountEvaluationSource,
        areaCountDecisionBasis,
        areaRateAdjustment: areaCountResult?.rateAdjustment,
        status: "postponed_few" as const,
        skipReason: "few" as const,
        visitedAt: currentVisitedAt,
        measurementStatus:
          typeof areaCount === "number"
            ? "measured"
            : prev.areaProgressMap[currentAreaId].measurementStatus,
        missingReason:
          typeof areaCount === "number"
            ? undefined
            : prev.areaProgressMap[currentAreaId].missingReason,
        measurementRecordedAt:
          typeof areaCount === "number"
            ? currentVisitedAt
            : prev.areaProgressMap[currentAreaId].measurementRecordedAt,
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
    if (
      activeDemandCycle === "summer" &&
      !persistedDemandCycleLock &&
      !inferredOperationDemandCycle &&
      (areaCountRemoteLoadStatus === "loading" ||
        areaCountRemoteLoadStatus === "error")
    ) {
      window.alert(
        areaCountRemoteLoadStatus === "loading"
          ? "当日の保存データを確認中です。確認完了後にもう一度お試しください。"
          : "当日の保存データを確認できないため、安全のため夏サイクルを開始できません。",
      );
      return;
    }
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
    const nextSessionBase: SessionData = {
      ...prev.sessionDraft,
      ...getCurrentDataVersionInfo(),
      date: currentDate,
      demandCycle: activeDemandCycle,
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
    const isResumingSameDiscountSession = Boolean(
      prev.session &&
      prev.session.date === nextSessionBase.date &&
      prev.session.discountTime === nextSessionBase.discountTime &&
      !timeSwitchTarget,
    );
    const temperatureComfort = resolveSessionTemperatureComfort({
      date: nextSessionBase.date,
      discountTime: nextSessionBase.discountTime,
      weather: nextSessionBase.weather,
      snapshots: getDailySessionSnapshotsForDate(nextSessionBase.date),
      lastSessionWeather,
      previousSession: isResumingSameDiscountSession ? null : prev.session,
      existingAnalysis: isResumingSameDiscountSession
        ? prev.session?.temperatureComfortAnalysis
        : null,
    });
    const nextSession: SessionData = {
      ...nextSessionBase,
      temperatureComfortAnalysis: temperatureComfort.analysis,
    };
    const nextDemandCycleState = lockDemandCycleForDate(
      demandCycleState,
      currentDate,
      activeDemandCycle,
    );
    setDemandCycleState(nextDemandCycleState);
    if (!isTestMode) saveDemandCycleState(nextDemandCycleState);
    setLastUsedSessionDraft((current) => ({
      ...current,
      demandCycle: activeDemandCycle,
    }));

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
        areaCountCorrection: null,
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
        areaCountCorrection: null,
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
        areaCountCorrection: null,
      };
    }

    setState(nextState);
    replaceNextSessionSkipRecords(nextSkipRecords);
    setResumeTargetScreen(null);
    setTimeSwitchTarget(null);
    setUndoSnapshot(null);
    setUndoNotice(null);
  }

  function requestWeatherConfirmation() {
    if (state.screen !== "start") return;

    weatherConfirmationSubmittingRef.current = false;
    setWeatherConfirmationPending({
      date: state.sessionDraft.date,
      discountTime: state.sessionDraft.discountTime,
    });
  }

  function editWeatherInput() {
    weatherConfirmationSubmittingRef.current = false;
    setWeatherConfirmationPending(null);
    setWeatherCorrectionRequestId((current) => current + 1);
  }

  function confirmWeatherInput() {
    if (weatherConfirmationSubmittingRef.current) return;
    if (
      !matchesWeatherConfirmationDraft({
        pending: weatherConfirmationPending,
        screen: state.screen,
        sessionDraft: state.sessionDraft,
      })
    ) {
      return;
    }

    if (
      activeDemandCycle === "summer" &&
      !persistedDemandCycleLock &&
      !inferredOperationDemandCycle &&
      (areaCountRemoteLoadStatus === "loading" ||
        areaCountRemoteLoadStatus === "error")
    ) {
      window.alert(
        areaCountRemoteLoadStatus === "loading"
          ? "当日の保存データを確認中です。確認完了後にもう一度お試しください。"
          : "当日の保存データを確認できないため、安全のため夏サイクルを開始できません。",
      );
      return;
    }

    weatherConfirmationSubmittingRef.current = true;
    setWeatherConfirmationPending(null);
    startSession();
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
      demandCycle: state.session?.demandCycle,
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


  function finalizeFinalDayData(params: {
    nextState: AppState;
    nextAreaCountRecords: AreaCountRecord[];
    exportedAt: string;
  }): StoredFinalizedDayData | null {
    const session = params.nextState.session;
    if (isTestMode || !session || session.discountTime !== "20") return null;

    const allFinalCountsEntered = NORMAL_ROUTE.every(
      (areaId) => typeof params.nextState.areaProgressMap[areaId]?.areaCount === "number",
    );
    if (!allFinalCountsEntered) return null;

    const completedAreaProgressMap = NORMAL_ROUTE.reduce((acc, areaId) => {
      const progress = params.nextState.areaProgressMap[areaId];
      const guide = getFinalTimeGuide({
        weekday: session.weekday,
        weather21: session.weather.hourlyForecasts["21"].weather,
        temp21C: session.weather.hourlyForecasts["21"].tempC,
        comfortScore: weekdayBaseInfo.weekdayShift,
        areaCountEvaluation: progress?.areaCountEvaluation,
      });
      const shouldCaptureRateSnapshot =
        !progress.rateDecisionSnapshot ||
        params.nextState.areaCountCorrection?.targetAreaId === areaId;
      acc[areaId] = {
        ...progress,
        areaJudge: progress.areaJudge ?? "normal",
        status: "completed",
        skipReason: undefined,
        visitedAt: progress.visitedAt ?? params.exportedAt,
        completedAt: progress.completedAt ?? params.exportedAt,
        measurementStatus: "measured",
        missingReason: undefined,
        measurementRecordedAt:
          progress.measurementRecordedAt ?? progress.visitedAt ?? params.exportedAt,
        rateDecisionSnapshot: shouldCaptureRateSnapshot
          ? buildFinalRateDecisionSnapshot({
              confirmedAt: params.exportedAt,
              finalGuide: guide,
              resolvedWeather: sessionSourceResolvedWeather,
              weatherComfortAdjustmentPercent: weekdayBaseInfo.baseRateBonus,
              demandCycle: session.demandCycle,
            })
          : progress.rateDecisionSnapshot,
        rateDecisionSnapshotStatus: shouldCaptureRateSnapshot
          ? "captured"
          : progress.rateDecisionSnapshotStatus,
        rateOrigin: shouldCaptureRateSnapshot
          ? "confirmed_now"
          : progress.rateOrigin,
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
    if (!finalSessionSnapshot) return null;

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
      demandCycle: session.demandCycle,
      areaCountRecords: params.nextAreaCountRecords,
      sessions,
      review19Check: getLatestReview19DayCheck(session.date),
    });
    const result = params.nextState.finalizedDayRecordId
      ? replaceFinalizedDayDataCore({
          daySnapshot,
          finalizedAt: params.exportedAt,
        })
      : initializeFinalizedDayData({
          daySnapshot,
          finalizedAt: params.exportedAt,
        });
    lastFinalizedDayDataRef.current = result.record;
    setFinalizedDayDataVersion((version) => version + 1);
    return result.record;
  }


  function judgeCurrentArea(
    judge: Exclude<AreaJudge, null>,
    areaCount?: number | null,
    manualAreaCountEvaluation?: AreaCountEvaluation,
    stapleItemCount?: number | null,
  ) {
    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);

    const roundedAreaCount =
      typeof areaCount === "number" && Number.isFinite(areaCount) && areaCount >= 0
        ? Math.round(areaCount)
        : null;
    const normalizedStapleItemCount =
      state.session?.discountTime === "20"
        ? stapleItemCount === null || stapleItemCount === undefined
          ? null
          : Number.isInteger(stapleItemCount) &&
            stapleItemCount >= 0 &&
            roundedAreaCount !== null &&
            stapleItemCount <= roundedAreaCount
          ? stapleItemCount
          : undefined
        : undefined;
    if (
      state.session?.discountTime === "20" &&
      stapleItemCount !== null &&
      stapleItemCount !== undefined &&
      normalizedStapleItemCount === undefined
    ) {
      return;
    }

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
        demandCycle: normalizeDemandCycle(state.session.demandCycle),
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
      if (nextRecord.demandCycle === "summer") {
        upsertSummerAreaCountRecord(nextRecord);
      } else {
        void upsertRemoteAreaCountRecord(nextRecord);
      }
    }

    const nextStateForAction = applyAreaJudgeSelection(
      state,
      effectiveJudge,
      roundedAreaCount,
      effectiveAreaCountResult,
      areaCountEvaluationSource,
      areaCountDecisionBasis,
      normalizedStapleItemCount,
    );

    const finalizedDayData = finalizeFinalDayData({
      nextState: nextStateForAction,
      nextAreaCountRecords,
      exportedAt: actionAt,
    });

    setState((prev) => {
      const nextState = applyAreaJudgeSelection(
        prev,
        effectiveJudge,
        roundedAreaCount,
        effectiveAreaCountResult,
        areaCountEvaluationSource,
        areaCountDecisionBasis,
        normalizedStapleItemCount,
      );
      return finalizedDayData
        ? { ...nextState, finalizedDayRecordId: finalizedDayData.recordId }
        : nextState;
    });
  }

  function goBackOneScreen() {
    const previousSnapshot = screenHistoryRef.current.at(-1);
    if (
      state.screen === "area_judge" &&
      previousSnapshot?.state.screen === "start" &&
      !window.confirm("天候入力画面に戻りますか？")
    ) {
      return;
    }

    const historyResult = popNavigationHistory(screenHistoryRef.current);
    if (!historyResult.previousSnapshot) return;

    screenHistoryRef.current = historyResult.history;
    suppressHistoryPushRef.current = true;
    restoreNavigationSnapshot(historyResult.previousSnapshot);
    setUndoNotice(null);
  }

  function startAreaCountCorrection(areaId: AreaId) {
    if (!state.session || typeof state.areaProgressMap[areaId]?.areaCount !== "number") {
      return;
    }

    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);
    setState((prev) => {
      if (!prev.session || typeof prev.areaProgressMap[areaId]?.areaCount !== "number") {
        return prev;
      }
      if (
        prev.screen === "rate_display" &&
        prev.currentAreaId === areaId &&
        prev.areaProgressMap[areaId].status !== "completed"
      ) {
        return {
          ...prev,
          screen: "area_judge",
          finalTimeStep: 0,
          timeSwitchNotice: null,
          areaCountCorrection: null,
        };
      }
      const correctionMode =
        prev.areaProgressMap[areaId].status === "auto_skipped_late_time" &&
        prev.areaProgressMap[areaId].earlyDiscountResolution === "count_only"
          ? "auto_skip_count_only" as const
          : "normal" as const;
      const existingContext = prev.areaCountCorrection;
      return {
        ...prev,
        screen:
          correctionMode === "auto_skip_count_only"
            ? "auto_skip_count"
            : "area_judge",
        currentAreaId: areaId,
        lastReferenceAreaId: areaId,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        finalTimeStep: 0,
        timeSwitchNotice: null,
        areaCountCorrection: existingContext
          ? { ...existingContext, mode: correctionMode, targetAreaId: areaId }
          : {
            mode: correctionMode,
            targetAreaId: areaId,
            returnScreen: prev.screen,
            returnAreaId: prev.currentAreaId,
            returnLastReferenceAreaId: prev.lastReferenceAreaId,
            returnCurrentFlow: prev.currentFlow,
            returnPendingDeferredAreaIds: [...prev.pendingDeferredAreaIds],
            returnFinalTimeStep: prev.finalTimeStep,
            returnTimeSwitchNotice: prev.timeSwitchNotice,
            returnHistoryLength: screenHistoryRef.current.length,
            },
      };
    });
  }

  function startEditingConditions() {
    if (state.screen === "start") return;

    weatherConfirmationSubmittingRef.current = false;
    setWeatherConfirmationPending(null);
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
          rateDisplayOverride: rateDisplay,
        })
      : null;
    const clickedRateDecisionSnapshot =
      clickedAreaId && clickedProgress?.areaJudge && state.session
        ? state.session.discountTime === "20" && finalGuide
          ? buildFinalRateDecisionSnapshot({
              confirmedAt: completedAt,
              finalGuide,
              resolvedWeather: sessionSourceResolvedWeather,
              weatherComfortAdjustmentPercent: weekdayBaseInfo.baseRateBonus,
              demandCycle: state.session.demandCycle,
            })
          : state.session.discountTime !== "20" &&
            effectiveRateDiscountTime &&
            effectiveRateDiscountTime !== "20"
          ? buildRateDecisionSnapshot({
            confirmedAt: completedAt,
            sessionDiscountTime: state.session.discountTime,
            effectiveRateDiscountTime,
            calculationMode: earlyNextMinus5Info
              ? "early_next_minus5"
              : lateTimeBonus > 0
              ? "late_plus5"
              : "normal",
            weatherComfortAdjustmentPercent: earlyNextMinus5Info
              ? earlyNextMinus5Info.weekdayBaseInfo.baseRateBonus
              : weekdayBaseInfo.baseRateBonus,
            areaJudge: clickedProgress.areaJudge,
            areaRateAdjustment: clickedProgress.areaRateAdjustment,
            resolvedWeather: earlyNextMinus5Info
              ? earlyNextMinus5Info.resolvedWeather
              : sessionSourceResolvedWeather,
            weekday: state.session.weekday,
            date: state.session.date,
            ignoreTimeRateCap: effectiveRateIgnoreTimeRateCap,
            demandCycle: state.session.demandCycle,
          })
          : null
        : null;
    const confirmedRateSnapshot: CompletedRateSnapshot | null =
      clickedRateDecisionSnapshot?.display
        ? {
            completedRateText: clickedRateDecisionSnapshot.display.normal.main,
            completedNormalRateText:
              clickedRateDecisionSnapshot.display.normal.main,
            completedManyRateText:
              clickedRateDecisionSnapshot.display.many.main,
          }
        : clickedRateSnapshot;

    let skipRecordToAdd: NextSessionSkipRecord | null = null;
    if (
      clickedAreaId &&
      confirmedRateSnapshot &&
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
          rateSnapshot: confirmedRateSnapshot,
          skipKind: earlyNextTargetDiscountTime
            ? "early_next_minus5"
            : "late_plus5",
          sourceSession: state.session,
          earlyDiscountCompletedAt: completedAt,
        });
      }
    }

    setState((prev) => {
      if (!clickedAreaId || prev.currentAreaId !== clickedAreaId || !confirmedRateSnapshot) return prev;
      const { nextSession, timeSwitchNotice } = refreshSessionDiscountTime(prev.session);

      const updatedMap = {
        ...prev.areaProgressMap,
        [clickedAreaId]: {
          ...prev.areaProgressMap[clickedAreaId],
          status: "completed" as const,
          completedAt,
          skipReason: undefined,
          ...confirmedRateSnapshot,
          rateDecisionSnapshot: clickedRateDecisionSnapshot ?? undefined,
          rateDecisionSnapshotStatus: clickedRateDecisionSnapshot
            ? "captured" as const
            : undefined,
          rateOrigin: "confirmed_now" as const,
        },
      };

      if (prev.areaCountCorrection?.targetAreaId === clickedAreaId) {
        const correction = prev.areaCountCorrection;
        screenHistoryRef.current = screenHistoryRef.current.slice(
          0,
          correction.returnHistoryLength,
        );
        suppressHistoryPushRef.current = true;
        return {
          ...prev,
          areaProgressMap: updatedMap,
          screen: correction.returnScreen,
          currentAreaId: correction.returnAreaId,
          lastReferenceAreaId: correction.returnLastReferenceAreaId,
          currentFlow: correction.returnCurrentFlow,
          pendingDeferredAreaIds: [...correction.returnPendingDeferredAreaIds],
          finalTimeStep: correction.returnFinalTimeStep,
          timeSwitchNotice: correction.returnTimeSwitchNotice,
          areaCountCorrection: null,
        };
      }

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
      if (state.areaCountCorrection?.targetAreaId === clickedAreaId) {
        replaceNextSessionSkipRecords([
          ...nextSessionSkipRecordsRef.current.filter(
            (record) =>
              !(
                record.date === skipRecordToAdd!.date &&
                record.targetDiscountTime === skipRecordToAdd!.targetDiscountTime &&
                record.areaId === skipRecordToAdd!.areaId
              ),
          ),
          skipRecordToAdd,
        ]);
      } else {
        appendNextSessionSkipRecords([skipRecordToAdd]);
      }
    }
  }

  function advanceAfterAutoSkippedArea(
    prev: AppState,
    updatedMap: Record<AreaId, AreaProgress>,
    currentAreaId: AreaId,
  ): AppState {
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
  }

  function startAutoSkippedAreaCountOnly() {
    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);
    setState((prev) => {
      if (!prev.currentAreaId || prev.screen !== "auto_skip_notice") return prev;
      const currentProgress = prev.areaProgressMap[prev.currentAreaId];
      const nextProgress = startAutoSkippedCountOnlyProgress(currentProgress);
      if (nextProgress === currentProgress) return prev;

      return {
        ...prev,
        screen: "auto_skip_count",
        areaProgressMap: {
          ...prev.areaProgressMap,
          [prev.currentAreaId]: nextProgress,
        },
      };
    });
  }

  function saveAutoSkippedAreaCount(count: number) {
    if (!state.currentAreaId || !state.session) return;
    const roundedCount = Math.max(0, Math.round(count));
    const currentAreaId = state.currentAreaId;
    const recordedAt = getRuntimeNow().toISOString();
    const currentProgress = state.areaProgressMap[currentAreaId];
    if (
      state.screen !== "auto_skip_count" ||
      currentProgress?.status !== "auto_skipped_late_time" ||
      currentProgress.earlyDiscountResolution !== "count_only"
    ) {
      return;
    }

    if (!isTestMode) {
      const nextRecord: AreaCountRecord = {
        ...getCurrentDataVersionInfo(),
        date: state.session.date,
        demandCycle: normalizeDemandCycle(state.session.demandCycle),
        sessionStartedAt: state.session.startedAt,
        recordedAt,
        areaId: currentAreaId,
        discountTime: state.session.discountTime,
        actualWeekday: getActualWeekdayLabel(state.session.weekday),
        actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({
          weekday: state.session.weekday,
          discountTime: state.session.discountTime,
          date: state.session.date,
        }),
        count: roundedCount,
      };
      const nextAreaCountRecords = upsertAreaCountRecord(areaCountRecords, nextRecord);
      setAreaCountRecords(nextAreaCountRecords);
      if (nextRecord.demandCycle === "summer") {
        upsertSummerAreaCountRecord(nextRecord);
      } else {
        void upsertRemoteAreaCountRecord(nextRecord);
      }
    }

    setState((prev) => {
      if (prev.currentAreaId !== currentAreaId || prev.screen !== "auto_skip_count") {
        return prev;
      }
      const progress = prev.areaProgressMap[currentAreaId];
      if (progress?.status !== "auto_skipped_late_time") return prev;
      const updatedProgress = recordAutoSkippedCountOnlyProgress(
        progress,
        roundedCount,
        recordedAt,
      );
      if (updatedProgress === progress) return prev;
      const updatedMap = {
        ...prev.areaProgressMap,
        [currentAreaId]: updatedProgress,
      };
      if (
        prev.areaCountCorrection?.targetAreaId === currentAreaId &&
        prev.areaCountCorrection.mode === "auto_skip_count_only"
      ) {
        const correction = prev.areaCountCorrection;
        screenHistoryRef.current = screenHistoryRef.current.slice(
          0,
          correction.returnHistoryLength,
        );
        suppressHistoryPushRef.current = true;
        return {
          ...prev,
          areaProgressMap: updatedMap,
          screen: correction.returnScreen,
          currentAreaId: correction.returnAreaId,
          lastReferenceAreaId: correction.returnLastReferenceAreaId,
          currentFlow: correction.returnCurrentFlow,
          pendingDeferredAreaIds: [...correction.returnPendingDeferredAreaIds],
          finalTimeStep: correction.returnFinalTimeStep,
          timeSwitchNotice: correction.returnTimeSwitchNotice,
          areaCountCorrection: null,
        };
      }
      return advanceAfterAutoSkippedArea(prev, updatedMap, currentAreaId);
    });
  }

  function skipAutoSkippedAreaWithoutMeasurement() {
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
        [currentAreaId]: acknowledgeAutoSkippedProgress(currentProgress, acknowledgedAt),
      };

      return advanceAfterAutoSkippedArea(prev, updatedMap, currentAreaId);
    });
  }

  function processAutoSkippedAreaNormally() {
    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);
    setAreaJudgeSelection(null);
    setResumeTargetScreen(null);
    setState((prev) => processEarlyNextMinus5AreaNormally(prev));
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
      if (prev.screen !== "start") return prev;
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
        demandCycle: normalizeDemandCycle(session.demandCycle),
        sessionStartedAt: session.startedAt,
        reviewStartedAt: now.toISOString(),
        excludedAreaIds: sourceStateForReview.review19ExcludedAreaIds,
      });
      const reviewTemperatureComfort = resolveSessionTemperatureComfort({
        date: reviewDraft.date,
        discountTime: "19",
        weather: reviewDraft.weather,
        snapshots: getDailySessionSnapshotsForDate(reviewDraft.date),
        lastSessionWeather,
        previousSession: session,
      }).analysis;

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
          reference: createReview19Reference(
            reviewDraft,
            reviewTemperatureComfort,
          ),
        },
      };
    });
  }

  function startReview19AfterWeather() {
    setState((prev) => {
      if (prev.screen !== "review19_weather" || !prev.session || !prev.review19) return prev;

      const reviewTemperatureComfort = resolveSessionTemperatureComfort({
        date: prev.sessionDraft.date,
        discountTime: "19",
        weather: prev.sessionDraft.weather,
        snapshots: getDailySessionSnapshotsForDate(prev.sessionDraft.date),
        lastSessionWeather,
        previousSession: prev.session,
      }).analysis;

      return {
        ...prev,
        screen: "review19",
        review19: {
          ...prev.review19,
          reviewStartedAt: prev.review19.reviewStartedAt ?? getRuntimeNow().toISOString(),
          reference: createReview19Reference(
            prev.sessionDraft,
            reviewTemperatureComfort,
          ),
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
      demandCycle: state.review19.demandCycle,
      areaCountRecords,
      sessions: getDailySessionSnapshotsForDate(state.review19.date),
      review19Check: {
        version: 1,
        ...getCurrentDataVersionInfo(),
        demandCycle: state.review19.demandCycle,
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
      demandCycle: normalizeDemandCycle(
        state.session?.demandCycle ?? state.review19?.demandCycle,
      ),
    });
    const nextSessionBase: SessionData = {
      ...draft,
      ...getCurrentDataVersionInfo(),
      discountTime: "19",
      weather: {
        ...draft.weather,
        hourlyForecasts: cloneHourlyForecasts(draft.weather.hourlyForecasts),
      },
      startedAt,
    };
    const nextSessionTemperatureComfort = resolveSessionTemperatureComfort({
      date: nextSessionBase.date,
      discountTime: "19",
      weather: nextSessionBase.weather,
      snapshots: getDailySessionSnapshotsForDate(nextSessionBase.date),
      lastSessionWeather,
      previousSession: state.session,
    }).analysis;
    const nextSession: SessionData = {
      ...nextSessionBase,
      temperatureComfortAnalysis: nextSessionTemperatureComfort,
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
      areaCountCorrection: null,
    });

    replaceNextSessionSkipRecords(consumed.remainingRecords);
    setResumeTargetScreen(null);
    setTimeSwitchTarget(null);
    setUndoSnapshot(null);
    setUndoNotice(null);
  }

  function openNextSessionInput(
    targetDiscountTime: DiscountTime,
    options?: {
      preserveCurrentSession?: boolean;
      sourceState?: AppState;
    }
  ) {
    weatherConfirmationSubmittingRef.current = false;
    setWeatherConfirmationPending(null);
    const now = getRuntimeNow();
    const currentDate = formatLocalDate(now);
    const currentWeekday = now.getDay();

    const sourceState = options?.sourceState ?? state;

    if (
      sourceState.session?.date === currentDate &&
      sourceState.session.discountTime === "17"
    ) {
      saveReview19SourceState(cloneAppState(sourceState));
    }

    const baseDraft = buildStartDefaultDraft(lastUsedSessionDraft);
    const nextDraft: SessionDraft = {
      ...baseDraft,
      date: currentDate,
      demandCycle: normalizeDemandCycle(
        sourceState.session?.demandCycle ?? activeDemandCycle,
      ),
      weekday: currentWeekday,
      discountTime: targetDiscountTime,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather: {
        ...baseDraft.weather,
        hourlyForecasts: cloneHourlyForecasts(baseDraft.weather.hourlyForecasts),
      },
    };

    if (options?.preserveCurrentSession && sourceState.session) {
      setState({
        ...sourceState,
        screen: "start",
        sessionDraft: nextDraft,
        timeSwitchNotice: null,
        areaCountCorrection: null,
      });
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
    const transitionedAt = getRuntimeNow().toISOString();
    const sourceState = options?.autoTransition
      ? finalizeUnmeasuredAreasForAutoTransition(state, transitionedAt)
      : state;

    if (options?.autoTransition) {
      const interruptedSnapshot = createDailySessionSnapshot({
        capturedAt: transitionedAt,
        state: sourceState,
        resolvedWeather: sessionSourceResolvedWeather,
        weekdayBaseInfo,
        basisGuide,
        lateTimeBonus,
        doneSummaryItems,
        sessionEndReason: "auto_time_transition",
      });
      if (interruptedSnapshot) upsertDailySessionSnapshot(interruptedSnapshot);
    }

    const prioritizeUnfinishedAreas =
      (options?.autoTransition ?? false) &&
      shouldPrioritizeUnfinishedAreasOnAutoTransition(state.screen);

    const currentAreaEarlyNextTarget = state.currentAreaId
      ? sourceState.areaProgressMap[state.currentAreaId]?.earlyNextMinus5TargetDiscountTime ??
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
      const progress = sourceState.areaProgressMap[state.currentAreaId];
      const rateSnapshot = buildCompletedRateSnapshot({
        session: state.session,
        progress,
        weatherBonus: weekdayBaseInfo.baseRateBonus + lateTimeBonus,
        rateDisplayOverride: rateDisplay,
      });

      appendNextSessionSkipRecords([
        buildNextSessionSkipRecord({
          date: state.session.date,
          targetDiscountTime: currentAreaEarlyNextTarget!,
          areaId: state.currentAreaId,
          rateSnapshot,
          skipKind: "early_next_minus5",
          sourceSession: state.session,
          earlyDiscountCompletedAt: transitionedAt,
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
      sourceState,
    });
  }

  function persistFinalizedDayMemo(
    recordId: string,
    memo: string | null,
  ): StoredFinalizedDayData | null {
    const current =
      lastFinalizedDayDataRef.current?.recordId === recordId
        ? lastFinalizedDayDataRef.current
        : selectFinalizedDayDataByRecordId(
            loadFinalizedDayData(),
            recordId,
          );
    if (!current || current.recordId !== recordId) return null;

    const updated = patchFinalizedDayDataMetadataByRecordId({
      recordId,
      patch: { memo },
    });
    if (!updated || updated.recordId !== recordId) return null;
    lastFinalizedDayDataRef.current = updated;
    setFinalizedDayDataVersion((version) => version + 1);
    return updated;
  }

  function saveFinalizedDayMemo(memo: string | null): void {
    const recordId = state.finalizedDayRecordId;
    if (!recordId) return;
    persistFinalizedDayMemo(recordId, memo);
  }

  function savePreviousDayDiscardCount(count: number | null) {
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) return;
    const previousDate = getPreviousJstCalendarDate(getRuntimeNow());
    if (!previousDate) return;
    const existing = selectFinalizedDayDataByDate(
      loadFinalizedDayData(),
      previousDate,
    );
    if (!existing) return;

    const updated = patchFinalizedDayDataMetadata({
      date: previousDate,
      patch: { discardCount: count },
    });
    if (!updated) return;
    if (lastFinalizedDayDataRef.current?.recordId === updated.recordId) {
      lastFinalizedDayDataRef.current = updated;
    }
    setFinalizedDayDataVersion((version) => version + 1);
  }

  async function getExportableDailyData() {
    const finalized = loadFinalizedDayData();
    const finalizedDates = new Set(finalized.map((record) => record.date));
    const sessionSnapshots = loadDailySessionSnapshots();
    const legacyDates = [...new Set(
      sessionSnapshots
        .filter(
          (snapshot) =>
            snapshot.session.discountTime === "20" &&
            snapshot.screen === "done" &&
            !finalizedDates.has(snapshot.session.date),
        )
        .map((snapshot) => snapshot.session.date),
    )].sort();
    if (legacyDates.length === 0) return finalized;

    const remoteResult = await loadRemoteAreaCountRecords();
    const remoteRecords = remoteResult.status === "ready" ? remoteResult.records : [];
    const mergedAreaCountRecords = remoteRecords.reduce(
      (records, record) => upsertAreaCountRecord(records, record),
      cloneAreaCountRecords(areaCountRecords),
    );
    const legacy = legacyDates.map((date) => {
      const sessions = sessionSnapshots.filter(
        (snapshot) => snapshot.session.date === date,
      );
      return createReview19DaySnapshot({
        capturedAt:
          [...sessions]
            .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
            .at(-1)?.capturedAt ?? getRuntimeNow().toISOString(),
        date,
        demandCycle:
          sessions[0]?.demandCycle ??
          sessions[0]?.session.demandCycle ??
          mergedAreaCountRecords.find((record) => record.date === date)?.demandCycle,
        areaCountRecords: mergedAreaCountRecords,
        sessions,
        review19Check: getLatestReview19DayCheck(date),
      });
    });
    return [...finalized, ...legacy];
  }

  function exportAllReview19Data(): boolean {
    const records = selectAllReview19Data(loadReview19Records());
    if (records.length === 0) return false;
    const exportedAt = getRuntimeNow().toISOString();
    downloadJsonFile(
      buildAllReview19DataExportPayload({ records, exportedAt }),
      `nebiki-review19-all-${formatLocalDate(getRuntimeNow())}.json`,
    );
    return true;
  }

  function exportLatestReview19Data(): boolean {
    const exportedAt = getRuntimeNow().toISOString();
    const payload = buildLatestReview19DataExportPayload({
      records: loadReview19Records(),
      exportedAt,
    });
    if (!payload || payload.records.length === 0) return false;
    downloadJsonFile(payload, `nebiki-review19-${payload.records[0].date}.json`);
    return true;
  }

  async function exportAllDailyData(): Promise<boolean> {
    const records = await getExportableDailyData();
    if (records.length === 0) return false;
    const exportedAt = getRuntimeNow().toISOString();
    downloadJsonFile(
      buildAllFinalizedDayDataExportPayload({ records, exportedAt }),
      `nebiki-day-all-${formatLocalDate(getRuntimeNow())}.json`,
    );
    return true;
  }

  async function exportLatestDailyData(): Promise<boolean> {
    const records = await getExportableDailyData();
    const exportedAt = getRuntimeNow().toISOString();
    const payload = buildLatestFinalizedDayDataExportPayload({
      records,
      exportedAt,
    });
    if (!payload) return false;
    downloadJsonFile(payload, getAutomaticDayExportFilename(payload.date));
    return true;
  }

  function exportCompletedReview19Data(): boolean {
    if (
      state.screen !== "review19_done" ||
      !state.review19 ||
      state.review19.review19Status !== "recorded" ||
      !state.review19.recordedAt
    ) {
      return false;
    }
    const exportedAt = getRuntimeNow().toISOString();
    const payload = buildDirectReview19DataExportPayload({
      record: state.review19,
      exportedAt,
    });
    downloadJsonFile(payload, `nebiki-review19-${state.review19.date}.json`);
    return true;
  }

  function exportCompletedDailyData(memo: string | null): boolean {
    const recordId = state.finalizedDayRecordId;
    if (!recordId) return false;
    const record = persistFinalizedDayMemo(recordId, memo);
    if (!record || record.recordId !== recordId) return false;
    const exportedAt = getRuntimeNow().toISOString();
    downloadJsonFile(
      buildDirectFinalizedDayDataExportPayload({ record, exportedAt }),
      getAutomaticDayExportFilename(record.date),
    );
    return true;
  }

  async function exportAllData() {
    const exportedAt = getRuntimeNow().toISOString();
    const sessionSnapshots = loadDailySessionSnapshots();
    const dailyDates = [...new Set(
      sessionSnapshots
        .filter((snapshot) =>
          snapshot.session.discountTime === "20" &&
          snapshot.screen === "done"
        )
        .map((snapshot) => snapshot.session.date)
    )].sort();

    const remoteResult = await loadRemoteAreaCountRecords();
    const remoteRecords = remoteResult.status === "ready" ? remoteResult.records : [];
    const mergedAreaCountRecords = remoteRecords.reduce(
      (records, record) => upsertAreaCountRecord(records, record),
      cloneAreaCountRecords(areaCountRecords),
    );
    const dailyData = dailyDates.map((date) =>
      createReview19DaySnapshot({
        capturedAt:
          sessionSnapshots
            .filter((snapshot) => snapshot.session.date === date)
            .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
            .at(-1)?.capturedAt ?? exportedAt,
        date,
        demandCycle:
          sessionSnapshots.find((snapshot) => snapshot.session.date === date)
            ?.demandCycle ??
          sessionSnapshots.find((snapshot) => snapshot.session.date === date)
            ?.session.demandCycle ??
          mergedAreaCountRecords.find((record) => record.date === date)?.demandCycle,
        areaCountRecords: mergedAreaCountRecords,
        sessions: sessionSnapshots.filter(
          (snapshot) => snapshot.session.date === date,
        ),
        review19Check: getLatestReview19DayCheck(date),
      })
    );
    const payload = buildAllDataExportPayload({
      dailyData,
      review19Data: loadReview19Records(),
      exportedAt,
    });
    if (payload.dailyData.length === 0 && payload.review19Data.length === 0) return;

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getAllDataExportFilename(exportedAt);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
    lastFinalizedDayDataRef.current = null;
    weatherConfirmationSubmittingRef.current = false;
    setWeatherConfirmationPending(null);
    setState(createInitialState({
      ...buildStartDefaultDraft(lastUsedSessionDraft),
      demandCycle: activeDemandCycle,
    }));
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
  basisGuide: displayBasisGuide,
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
  weatherConfirmationPending: weatherConfirmationPending !== null,
  weatherCorrectionRequestId,
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
  editableAreaCounts,
  finalizedDayMemo: activeFinalizedDayData?.memo ?? "",
  previousDayDiscardTarget,
  dataExport,
  allDataExport,
  canStartReview19Manually,
  demandCycle: activeDemandCycle,
  demandCycleLabel: getDemandCycleShortName(activeDemandCycle),
  demandCycleBasisLabel: getDemandCycleBasisLabel(activeDemandCycle),
  canChangeDemandCycle,
  demandCycleChangeBlockedReason,
},
    actions: {
      updateSessionDraft,
      startSession,
      requestWeatherConfirmation,
      editWeatherInput,
      confirmWeatherInput,
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
      startAutoSkippedAreaCountOnly,
      saveAutoSkippedAreaCount,
      skipAutoSkippedAreaWithoutMeasurement,
      processAutoSkippedAreaNormally,
      advanceFinalTimeStep,
      updateReview19AreaCount,
      skipReview19Area,
      startReview19AfterWeather,
      saveReview19,
      startAreaCountCorrection,
      saveFinalizedDayMemo,
      savePreviousDayDiscardCount,
      exportAllReview19Data,
      exportLatestReview19Data,
      exportAllDailyData,
      exportLatestDailyData,
      exportCompletedReview19Data,
      exportCompletedDailyData,
      start19DiscountAfterReview,
      startNextDoneSession,
      exportAllData,
      startReview19Manually,
      resetApp,
      changeDemandCycle,
    },
  };
}
