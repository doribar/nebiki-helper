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
  WeatherInput,
  AreaJudge,
  ScreenName,
  LastSessionWeatherRecord,
  NextSessionSkipRecord,
  PhotoJudgeFeedbackDraft,
  PhotoJudgeFeedbackRecord,
  PhotoCaptureSlotView,
  PhotoJudgeQueueRecord,
  PhotoJudgeAreaResult,
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
  areaJudgeToHumanText,
  getPhotoJudgeBaseUrl,
  compressPhotoForUpload,
  requestPhotoJudge,
  sendPhotoJudgeFeedback,
  setPhotoJudgeBaseUrl as savePhotoJudgeBaseUrl,
} from "../domain/photoJudge";
import {
  PHOTO_JUDGE_UPLOAD_ROUTE,
  getAllPhotoCaptureSlots,
  getPhotoCaptureKey,
  getPhotoCaptureSlotsForArea,
} from "../domain/photoCapture";
import {
  clearPersistedCapturedPhotosForSession,
  deletePersistedCapturedPhotosForArea,
  loadPersistedCapturedPhotoSlots,
  savePersistedCapturedPhotoSlot,
} from "../domain/photoCaptureStore";

function formatLocalDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function resolveDiscountTime(date = new Date()): DiscountTime {
  const minutes = date.getHours() * 60 + date.getMinutes();

  if (minutes < 16 * 60 + 30) return "15";
  if (minutes < 18 * 60 + 30) return "17";
  if (minutes < 19 * 60 + 30) return "18";
  if (minutes < 20 * 60 + 30) return "19";
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

function buildTimeSwitchNotice(to: DiscountTime): string {
  if (to === "20") {
    return `現在時刻が${getBasisTimeText(
      to
    )}を過ぎたため、ここから最終値引ルールで表示します。`;
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

type CapturedPhotoSlot = {
  areaId: AreaId;
  slotId: string;
  file?: File;
  previewUrl?: string;
  uploaded?: boolean;
};

type CapturedPhotoItem = {
  file: File;
  label: string;
};

function isNormalDiscountTime(discountTime: DiscountTime): boolean {
  return discountTime !== "20";
}

function normalizePhotoJudgeResult(result: PhotoJudgeAreaResult): PhotoJudgeAreaResult {
  return {
    photoGroupId: result.photoGroupId,
    suggestion: result.suggestion,
    confidence: result.confidence,
    reason: [...result.reason],
    aiSkipped: result.aiSkipped,
  };
}

function getAreaStatusText(progress: AreaProgress): string | undefined {
  switch (progress.status) {
    case "completed":
      return undefined;
    case "skipped_manual":
      return "未完了（スキップ中）";
    case "postponed_few":
      return "未完了（少ないため後回し）";
    case "unstarted":
      return "未完了";
  }
}

function getNextUnstartedAreaId(
  areaProgressMap: Record<AreaId, AreaProgress>,
  referenceAreaId: AreaId
): AreaId | null {
  const currentIndex = NORMAL_ROUTE.indexOf(referenceAreaId);
  const afterCurrent =
    currentIndex >= 0 ? NORMAL_ROUTE.slice(currentIndex + 1) : NORMAL_ROUTE;

  return (
    afterCurrent.find((areaId) => areaProgressMap[areaId]?.status === "unstarted") ??
    NORMAL_ROUTE.find((areaId) => areaProgressMap[areaId]?.status === "unstarted") ??
    null
  );
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
    photoJudgeFeedbackMap: {},
    timeSwitchNotice: null,
    finalTimeStep: 0,
  };
}

function normalizePhotoJudgeFeedbackMap(
  raw: unknown
): Partial<Record<AreaId, PhotoJudgeFeedbackRecord>> {
  if (!raw || typeof raw !== "object") return {};

  const result: Partial<Record<AreaId, PhotoJudgeFeedbackRecord>> = {};
  const source = raw as Partial<Record<AreaId, Partial<PhotoJudgeFeedbackRecord>>>;

  for (const area of AREA_MASTERS) {
    const record = source[area.id];
    if (!record) continue;
    if (record.areaId !== area.id) continue;
    if (typeof record.photoGroupId !== "string" || !record.photoGroupId) continue;
    if (typeof record.apiBaseUrl !== "string" || !record.apiBaseUrl) continue;
    if (
      record.humanJudge !== "多い" &&
      record.humanJudge !== "どちらでもない" &&
      record.humanJudge !== "少ない"
    ) {
      continue;
    }

    result[area.id] = {
      areaId: area.id,
      photoGroupId: record.photoGroupId,
      apiBaseUrl: record.apiBaseUrl,
      humanJudge: record.humanJudge,
      updatedAt:
        typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
      savedAt: typeof record.savedAt === "string" ? record.savedAt : undefined,
    };
  }

  return result;
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
    nextSessionSkipRecords: cloneSkipRecords(params.nextSessionSkipRecords),
    lastSessionWeather: cloneLastSessionWeatherRecord(params.lastSessionWeather),
    lastUsedSessionDraft: normalizeSessionDraft(params.lastUsedSessionDraft),
    dailyMessageState: normalizeDailyMessageState(params.dailyMessageState),
  };
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

  return {
    ...loaded,
    session: normalizeSessionData(loaded.session),
    sessionDraft: normalizeSessionDraft(loaded.sessionDraft),
    areaProgressMap: loaded.areaProgressMap ?? createInitialAreaProgressMap(),
    currentAreaId: loaded.currentAreaId ?? null,
    lastReferenceAreaId:
      (loaded as Partial<AppState>).lastReferenceAreaId ?? null,
    currentFlow: (loaded as Partial<AppState>).currentFlow ?? "normal",
    pendingDeferredAreaIds:
      (loaded as Partial<AppState>).pendingDeferredAreaIds ?? [],
    photoJudgeFeedbackMap: normalizePhotoJudgeFeedbackMap(
      (loaded as Partial<AppState>).photoJudgeFeedbackMap
    ),
    timeSwitchNotice:
      (loaded as Partial<AppState>).timeSwitchNotice ?? null,
    finalTimeStep:
      typeof (loaded as Partial<AppState>).finalTimeStep === "number"
        ? ((loaded as Partial<AppState>).finalTimeStep as AppState["finalTimeStep"])
        : 0,
  };
}

function getWeekdayText(weekday: number): string {
  const map = ["日", "月", "火", "水", "木", "金", "土"];
  return `${map[weekday] ?? ""}曜日`;
}

function getWeekdayBaseText(label: string): string {
  switch (label) {
    case "日":
      return "日";
    case "金土":
      return "金・土";
    case "火木":
      return "火・木";
    case "月水":
      return "月・水";
    default:
      return "基準不明";
  }
}

function getNextSkipTargetDiscountTime(
  discountTime: DiscountTime
): "18" | "19" | null {
  if (discountTime === "17") return "18";
  if (discountTime === "18") return "19";
  return null;
}

function createAreaProgressMapWithAutoSkippedAreas(
  skippedAreaIds: AreaId[]
): Record<AreaId, AreaProgress> {
  const base = createInitialAreaProgressMap();

  for (const areaId of skippedAreaIds) {
    base[areaId] = {
      ...base[areaId],
      status: "completed",
      completedAt: new Date().toISOString(),
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
  if (!session) {
    return {
      nextSession: null,
      timeSwitchNotice: null,
    };
  }

  // 手動で時刻を切り替えている場合は、その値を現在時刻として扱う
  if (session.manualDiscountTimeOverride) {
    return {
      nextSession: session,
      timeSwitchNotice: null,
    };
  }

  const nowDiscountTime = resolveDiscountTime(new Date());

  if (session.discountTime === nowDiscountTime) {
    return {
      nextSession: session,
      timeSwitchNotice: null,
    };
  }

  return {
    nextSession: {
      ...session,
      discountTime: nowDiscountTime,
      weather: {
        ...session.weather,
        hourlyForecasts: cloneHourlyForecasts(session.weather.hourlyForecasts),
      },
    },
    timeSwitchNotice: buildTimeSwitchNotice(nowDiscountTime),
  };
}

export function useNebikiApp(): UseNebikiAppResult {
  const initialPersistenceRef = useRef<ReturnType<typeof loadPersistedNebikiState> | null>(null);

  if (!initialPersistenceRef.current) {
    initialPersistenceRef.current = loadPersistedNebikiState();
  }

  const initialLastUsedSessionDraft = buildStartDefaultDraft(
    initialPersistenceRef.current?.lastUsedSessionDraft ?? null
  );

  const [state, setState] = useState<AppState>(() =>
    normalizeLoadedState(
      initialPersistenceRef.current?.currentSession ?? null,
      initialLastUsedSessionDraft
    )
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

  const [areaJudgeSelection, setAreaJudgeSelection] = useState<AreaJudge>(null);
  const [resumeTargetScreen, setResumeTargetScreen] = useState<ScreenName | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<NavigationSnapshot | null>(null);
  const [undoNotice, setUndoNotice] = useState<string | null>(null);
  const [photoJudgeBaseUrl, setPhotoJudgeBaseUrlState] = useState(() => getPhotoJudgeBaseUrl());
  const [capturedPhotoSlots, setCapturedPhotoSlots] = useState<Record<string, CapturedPhotoSlot>>({});
  const [photoJudgeQueueMap, setPhotoJudgeQueueMap] = useState<Partial<Record<AreaId, PhotoJudgeQueueRecord>>>({});
  const screenHistoryRef = useRef<NavigationSnapshot[]>([]);
  const photoJudgeFeedbackSaveInFlightRef = useRef(false);
  const capturedPhotoSlotsRef = useRef<Record<string, CapturedPhotoSlot>>({});
  const photoJudgeQueueRunIdRef = useRef(0);

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
  }
  const previousRenderRef = useRef<NavigationSnapshot | null>(null);
  const suppressHistoryPushRef = useRef(false);

  useEffect(() => {
    capturedPhotoSlotsRef.current = capturedPhotoSlots;
  }, [capturedPhotoSlots]);

  useEffect(() => {
    if (state.screen !== "photo_capture" || !state.session) return;

    let cancelled = false;
    const { date: sessionDate, discountTime } = state.session;

    void loadPersistedCapturedPhotoSlots({ sessionDate, discountTime })
      .then((records) => {
        if (cancelled || records.length === 0) return;

        setCapturedPhotoSlots((current) => {
          let changed = false;
          const next: Record<string, CapturedPhotoSlot> = { ...current };

          for (const record of records) {
            const key = getPhotoCaptureKey(record.areaId, record.slotId);
            if (next[key]?.file) continue;
            next[key] = {
              areaId: record.areaId,
              slotId: record.slotId,
              file: record.file,
            };
            changed = true;
          }

          return changed ? next : current;
        });
      })
      .catch(() => {
        // IndexedDB は復元用の補助。失敗しても通常の撮影フローは止めない。
      });

    return () => {
      cancelled = true;
    };
  }, [state.screen, state.session?.date, state.session?.discountTime]);

  useEffect(() => {
    savePersistedNebikiState(
      clonePersistedNebikiStateSnapshot({
        currentSession: state,
        nextSessionSkipRecords,
        lastSessionWeather,
        lastUsedSessionDraft,
        dailyMessageState,
      })
    );
  }, [
    state,
    nextSessionSkipRecords,
    lastSessionWeather,
    lastUsedSessionDraft,
    dailyMessageState,
  ]);

  useEffect(() => {
    if (state.screen !== "done") return;
    if (photoJudgeFeedbackSaveInFlightRef.current) return;

    const pendingRecords = Object.values(state.photoJudgeFeedbackMap ?? {}).filter(
      (record): record is PhotoJudgeFeedbackRecord =>
        Boolean(record?.photoGroupId && record.apiBaseUrl && record.humanJudge && !record.savedAt)
    );

    if (pendingRecords.length === 0) return;

    photoJudgeFeedbackSaveInFlightRef.current = true;

    Promise.allSettled(
      pendingRecords.map((record) =>
        sendPhotoJudgeFeedback({
          apiBaseUrl: record.apiBaseUrl,
          photoGroupId: record.photoGroupId,
          humanJudge: record.humanJudge,
        })
      )
    )
      .then((results) => {
        const savedPhotoGroupIds = pendingRecords
          .filter((_record, index) => results[index]?.status === "fulfilled")
          .map((record) => record.photoGroupId);

        if (savedPhotoGroupIds.length === 0) return;

        const savedAt = new Date().toISOString();
        setState((prev) => {
          const currentMap = prev.photoJudgeFeedbackMap ?? {};
          const nextMap: Partial<Record<AreaId, PhotoJudgeFeedbackRecord>> = {};

          for (const area of AREA_MASTERS) {
            const record = currentMap[area.id];
            if (!record) continue;

            nextMap[area.id] = savedPhotoGroupIds.includes(record.photoGroupId)
              ? { ...record, savedAt }
              : record;
          }

          return {
            ...prev,
            photoJudgeFeedbackMap: nextMap,
          };
        });
      })
      .catch((error) => {
        console.error("写真判定のまとめ保存に失敗しました", error);
      })
      .finally(() => {
        photoJudgeFeedbackSaveInFlightRef.current = false;
      });
  }, [state.screen, state.photoJudgeFeedbackMap]);

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
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30000);

    return () => window.clearInterval(id);
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
    state.screen === "rate_display" &&
    state.currentAreaId === "bento_men" &&
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
    sessionSourceResolvedWeather
  );
}, [
  sessionSource.weekday,
  sessionSource.discountTime,
  sessionSourceResolvedWeather,
]);

  const lateTimeBonus = useMemo(() => {
  if (!state.session) return 0;
  if (state.session.discountTime === "15") return 0;
  if (state.session.discountTime === "20") return 0;

  // 手動で時刻を切り替えている場合は、実時間による +5% を適用しない
  if (state.session.manualDiscountTimeOverride) return 0;

  const now = new Date(nowMs);
  const minutes = now.getHours() * 60 + now.getMinutes();

  // 17時基準の値引中に18時を超えた
  if (state.session.discountTime === "17") {
    return minutes >= 18 * 60 ? 5 : 0;
  }

  // 18時30分基準の値引中に19時を超えた
  if (state.session.discountTime === "18") {
    return minutes >= 19 * 60 ? 5 : 0;
  }

  // 19時30分基準の値引中に20時を超えた
  if (state.session.discountTime === "19") {
    return minutes >= 20 * 60 ? 5 : 0;
  }

  return 0;
}, [state.session, nowMs]);

const lateTimeBonusNotice = useMemo(() => {
  if (!state.session || lateTimeBonus === 0) return null;

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

  return `次の基準時刻に近づいているため、今回は5%強めて値引します。
このエリアは次回の値引でスキップします。`;
}, [state.session, lateTimeBonus]);

  const basisGuide = useMemo(() => {
  const baseGuide = getBasisGuideDisplay({
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
]);

  const weatherGuideText = useMemo(() => {
    return getWeatherGuideText();
  }, []);

  const currentAreaProgress = useMemo(() => {
    if (!state.currentAreaId) return null;
    return state.areaProgressMap[state.currentAreaId];
  }, [state.currentAreaId, state.areaProgressMap]);

  const currentPhotoJudgeFeedback = useMemo(() => {
    if (!state.currentAreaId) return null;
    return state.photoJudgeFeedbackMap[state.currentAreaId] ?? null;
  }, [state.currentAreaId, state.photoJudgeFeedbackMap]);

  const currentPhotoJudgeQueueRecord = useMemo(() => {
    if (!state.currentAreaId) return null;
    return photoJudgeQueueMap[state.currentAreaId] ?? null;
  }, [state.currentAreaId, photoJudgeQueueMap]);

  const photoCaptureSlots = useMemo<PhotoCaptureSlotView[]>(() => {
    return getAllPhotoCaptureSlots().map((slot) => {
      const captured = capturedPhotoSlots[getPhotoCaptureKey(slot.areaId, slot.slotId)];
      return {
        areaId: slot.areaId,
        areaName: slot.areaName,
        slotId: slot.slotId,
        slotLabel: slot.slotLabel,
        captured: Boolean(captured),
        previewUrl: captured?.previewUrl,
      };
    });
  }, [capturedPhotoSlots]);

  const photoCaptureCompletedCount = useMemo(() => {
    return photoCaptureSlots.filter((slot) => slot.captured).length;
  }, [photoCaptureSlots]);

  const photoCaptureTotalCount = photoCaptureSlots.length;

  const rateDisplay = useMemo(() => {
    if (!state.session || !currentAreaProgress) return null;
    if (state.session.discountTime === "20") return null;
    if (!currentAreaProgress.areaJudge) return null;

    return getNormalTimeRateDisplay({
      discountTime: state.session.discountTime,
      weatherBonus: weekdayBaseInfo.baseRateBonus + lateTimeBonus,
      areaJudge: currentAreaProgress.areaJudge,
      isSunday: state.session.weekday === 0 && state.session.discountTime === "15",
    });
  }, [
  state.session,
  currentAreaProgress,
  weekdayBaseInfo.baseRateBonus,
  lateTimeBonus,
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
    const weatherBonus = weekdayBaseInfo.baseRateBonus + lateTimeBonus;

    return DONE_SUMMARY_ROUTE.map((areaId) => {
      const progress = state.areaProgressMap[areaId];
      const statusText = progress ? getAreaStatusText(progress) : "未完了";

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
      });

      return {
        areaId,
        areaName: getAreaName(areaId),
        judgeText: getAreaJudgeText(progress.areaJudge),
        rateText: display.normal.main,
        manyRateText: display.many.main,
        manyNote: display.many.note,
        normalRateText: display.normal.main,
        statusText,
      };
    });
  }, [
    state.session,
    state.areaProgressMap,
    weekdayBaseInfo.baseRateBonus,
    lateTimeBonus,
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
      const nextUnstartedAreaId = getNextUnstartedAreaId(
        params.updatedMap,
        params.referenceAreaId
      );

      if (nextUnstartedAreaId) {
        return {
          ...params.prev,
          session: params.nextSession,
          timeSwitchNotice: params.timeSwitchNotice,
          areaProgressMap: params.updatedMap,
          currentAreaId: nextUnstartedAreaId,
          lastReferenceAreaId: params.referenceAreaId,
          currentFlow: "normal",
          pendingDeferredAreaIds: [],
          finalTimeStep: 0,
          screen: "area_judge",
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

  function buildPhotoJudgeFeedbackMap(params: {
    prev: AppState;
    areaId: AreaId;
    selection: Exclude<AreaJudge, null>;
    draft?: PhotoJudgeFeedbackDraft | null;
  }): Partial<Record<AreaId, PhotoJudgeFeedbackRecord>> {
    const existing = params.prev.photoJudgeFeedbackMap[params.areaId] ?? null;
    const source = params.draft?.photoGroupId ? params.draft : existing;

    if (!source?.photoGroupId || !source.apiBaseUrl) {
      return params.prev.photoJudgeFeedbackMap;
    }

    const humanJudge = areaJudgeToHumanText(params.selection);
    const sameSavedRecord =
      existing?.photoGroupId === source.photoGroupId &&
      existing?.apiBaseUrl === source.apiBaseUrl &&
      existing?.humanJudge === humanJudge
        ? existing.savedAt
        : undefined;

    return {
      ...params.prev.photoJudgeFeedbackMap,
      [params.areaId]: {
        areaId: params.areaId,
        photoGroupId: source.photoGroupId,
        apiBaseUrl: source.apiBaseUrl,
        humanJudge,
        updatedAt: new Date().toISOString(),
        savedAt: sameSavedRecord,
      },
    };
  }

  function updatePhotoJudgeBaseUrl(url: string) {
    setPhotoJudgeBaseUrlState(url);
    savePhotoJudgeBaseUrl(url);
  }

  function clearPhotoCaptureState() {
    photoJudgeQueueRunIdRef.current += 1;

    if (state.session) {
      void clearPersistedCapturedPhotosForSession({
        sessionDate: state.session.date,
        discountTime: state.session.discountTime,
      }).catch(() => {
        // 復元用ストレージの削除に失敗しても、画面操作は止めない。
      });
    }

    for (const record of Object.values(capturedPhotoSlotsRef.current)) {
      if (record.previewUrl) URL.revokeObjectURL(record.previewUrl);
    }
    capturedPhotoSlotsRef.current = {};
    setCapturedPhotoSlots({});
    setPhotoJudgeQueueMap({});
  }

  function capturePhotoSlot(areaId: AreaId, slotId: string, file: File) {
    const key = getPhotoCaptureKey(areaId, slotId);

    if (state.session) {
      void savePersistedCapturedPhotoSlot({
        sessionDate: state.session.date,
        discountTime: state.session.discountTime,
        areaId,
        slotId,
        file,
      }).catch(() => {
        // IndexedDB は保険。保存に失敗しても、メモリ上の撮影状態は維持する。
      });
    }

    setCapturedPhotoSlots((current) => {
      const existing = current[key];
      if (existing?.previewUrl) URL.revokeObjectURL(existing.previewUrl);

      return {
        ...current,
        [key]: {
          areaId,
          slotId,
          file,
        },
      };
    });
  }

  function releaseCapturedPhotoFilesForArea(
    areaId: AreaId,
    snapshot?: Record<string, CapturedPhotoSlot>
  ) {
    if (state.session) {
      void deletePersistedCapturedPhotosForArea({
        sessionDate: state.session.date,
        discountTime: state.session.discountTime,
        areaId,
      }).catch(() => {
        // 復元用ストレージの削除に失敗しても、AI判定完了後の操作は止めない。
      });
    }

    if (snapshot) {
      for (const key of Object.keys(snapshot)) {
        if (snapshot[key]?.areaId === areaId) {
          delete snapshot[key];
        }
      }
    }

    setCapturedPhotoSlots((current) => {
      let changed = false;
      const next: Record<string, CapturedPhotoSlot> = { ...current };

      for (const [key, record] of Object.entries(current)) {
        if (record.areaId !== areaId) continue;
        if (record.previewUrl) URL.revokeObjectURL(record.previewUrl);
        next[key] = {
          areaId: record.areaId,
          slotId: record.slotId,
          uploaded: true,
        };
        changed = true;
      }

      return changed ? next : current;
    });
  }

  function getCapturedPhotoItemsForArea(
    snapshot: Record<string, CapturedPhotoSlot>,
    areaId: AreaId
  ): CapturedPhotoItem[] {
    return getPhotoCaptureSlotsForArea(areaId)
      .map((slot) => {
        const captured = snapshot[getPhotoCaptureKey(areaId, slot.slotId)];
        if (!captured?.file) return null;
        return {
          file: captured.file,
          label: slot.slotLabel,
        };
      })
      .filter((item): item is CapturedPhotoItem => Boolean(item));
  }

  function hasCompleteCapturedPhotosForArea(
    snapshot: Record<string, CapturedPhotoSlot>,
    areaId: AreaId
  ): boolean {
    return getPhotoCaptureSlotsForArea(areaId).every((slot) => {
      const captured = snapshot[getPhotoCaptureKey(areaId, slot.slotId)];
      return Boolean(captured?.file);
    });
  }

  function getCapturedPhotoFilesForArea(
    snapshot: Record<string, CapturedPhotoSlot>,
    areaId: AreaId
  ): File[] {
    return getCapturedPhotoItemsForArea(snapshot, areaId).map((item) => item.file);
  }

  function buildInitialPhotoJudgeQueueMap(
    snapshot: Record<string, CapturedPhotoSlot>
  ): Partial<Record<AreaId, PhotoJudgeQueueRecord>> {
    const next: Partial<Record<AreaId, PhotoJudgeQueueRecord>> = {};

    for (const areaId of PHOTO_JUDGE_UPLOAD_ROUTE) {
      if (!hasCompleteCapturedPhotosForArea(snapshot, areaId)) continue;
      const photos = getCapturedPhotoFilesForArea(snapshot, areaId);
      if (photos.length === 0) continue;
      next[areaId] = {
        areaId,
        status: "queued",
        photoCount: photos.length,
      };
    }

    return next;
  }

  function attachPhotoJudgeFeedbackIfAlreadyJudged(params: {
    areaId: AreaId;
    result: PhotoJudgeAreaResult;
    apiBaseUrl: string;
  }) {
    if (!params.result.photoGroupId) return;

    setState((prev) => {
      const selection = prev.areaProgressMap[params.areaId]?.areaJudge;
      if (!selection) return prev;

      return {
        ...prev,
        photoJudgeFeedbackMap: buildPhotoJudgeFeedbackMap({
          prev,
          areaId: params.areaId,
          selection,
          draft: {
            photoGroupId: params.result.photoGroupId,
            apiBaseUrl: params.apiBaseUrl,
          },
        }),
      };
    });
  }

  async function requestPhotoJudgeForArea(params: {
    runId: number;
    areaId: AreaId;
    apiBaseUrl: string;
    weekdayTextValue: string;
    weekdayBaseTextValue: string;
    timeTextValue: string;
    sessionDateValue: string;
    snapshot: Record<string, CapturedPhotoSlot>;
  }) {
    if (!hasCompleteCapturedPhotosForArea(params.snapshot, params.areaId)) return;

    const photoItems = getCapturedPhotoItemsForArea(params.snapshot, params.areaId);
    const photos = photoItems.map((item) => item.file);
    const photoLabels = photoItems.map((item) => item.label);
    if (photos.length === 0) return;

    setPhotoJudgeQueueMap((current) => ({
      ...current,
      [params.areaId]: {
        areaId: params.areaId,
        status: "uploading",
        photoCount: photos.length,
      },
    }));

    try {
      const uploadPhotos: File[] = [];
      for (const photo of photos) {
        if (photoJudgeQueueRunIdRef.current !== params.runId) return;
        uploadPhotos.push(await compressPhotoForUpload(photo));
      }

      const result = normalizePhotoJudgeResult(
        await requestPhotoJudge({
          apiBaseUrl: params.apiBaseUrl,
          areaName: getAreaName(params.areaId),
          weekdayText: params.weekdayTextValue,
          weekdayBaseText: params.weekdayBaseTextValue,
          timeText: params.timeTextValue,
          sessionDate: params.sessionDateValue,
          photos: uploadPhotos,
          photoLabels,
        })
      );

      if (photoJudgeQueueRunIdRef.current !== params.runId) return;

      setPhotoJudgeQueueMap((current) => ({
        ...current,
        [params.areaId]: {
          areaId: params.areaId,
          status: "done",
          photoCount: photos.length,
          result,
        },
      }));

      attachPhotoJudgeFeedbackIfAlreadyJudged({
        areaId: params.areaId,
        result,
        apiBaseUrl: params.apiBaseUrl,
      });

      releaseCapturedPhotoFilesForArea(params.areaId, params.snapshot);
    } catch (error) {
      if (photoJudgeQueueRunIdRef.current !== params.runId) return;

      setPhotoJudgeQueueMap((current) => ({
        ...current,
        [params.areaId]: {
          areaId: params.areaId,
          status: "error",
          photoCount: photos.length,
          error:
            error instanceof Error
              ? error.message
              : "写真判定でエラーが発生しました。",
        },
      }));
    }
  }

  async function runPhotoJudgeQueue(params: {
    runId: number;
    apiBaseUrl: string;
    weekdayTextValue: string;
    weekdayBaseTextValue: string;
    timeTextValue: string;
    sessionDateValue: string;
    snapshot: Record<string, CapturedPhotoSlot>;
  }) {
    for (const areaId of PHOTO_JUDGE_UPLOAD_ROUTE) {
      if (photoJudgeQueueRunIdRef.current !== params.runId) return;
      await requestPhotoJudgeForArea({
        ...params,
        areaId,
      });
    }
  }

  function startPhotoJudgeQueueFromCapturedPhotos() {
    const snapshot = { ...capturedPhotoSlotsRef.current };
    const initialQueueMap = buildInitialPhotoJudgeQueueMap(snapshot);

    setPhotoJudgeQueueMap(initialQueueMap);

    if (!state.session || Object.keys(initialQueueMap).length === 0) return;

    const runId = photoJudgeQueueRunIdRef.current + 1;
    photoJudgeQueueRunIdRef.current = runId;

    void runPhotoJudgeQueue({
      runId,
      apiBaseUrl: photoJudgeBaseUrl,
      weekdayTextValue: getWeekdayText(state.session.weekday),
      weekdayBaseTextValue: getWeekdayBaseText(weekdayBaseInfo.adjusted),
      timeTextValue: getBasisTimeText(state.session.discountTime),
      sessionDateValue: state.session.date,
      snapshot,
    });
  }

  function retryPhotoJudgeForArea(areaId: AreaId) {
    if (!state.session) return;

    const snapshot = { ...capturedPhotoSlotsRef.current };
    const photos = getCapturedPhotoFilesForArea(snapshot, areaId);
    if (photos.length === 0) return;

    const runId = photoJudgeQueueRunIdRef.current + 1;
    photoJudgeQueueRunIdRef.current = runId;

    void requestPhotoJudgeForArea({
      runId,
      areaId,
      apiBaseUrl: photoJudgeBaseUrl,
      weekdayTextValue: getWeekdayText(state.session.weekday),
      weekdayBaseTextValue: getWeekdayBaseText(weekdayBaseInfo.adjusted),
      timeTextValue: getBasisTimeText(state.session.discountTime),
      sessionDateValue: state.session.date,
      snapshot,
    });
  }

  function startValueAfterPhotoCapture(withPhotos: boolean) {
    if (!state.session || !isNormalDiscountTime(state.session.discountTime)) return;

    const firstAreaId = getFirstAvailableAreaId(state.areaProgressMap);

    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);
    setState((prev) => ({
      ...prev,
      screen: firstAreaId ? "area_judge" : "done",
      currentAreaId: firstAreaId,
      lastReferenceAreaId: firstAreaId ?? prev.lastReferenceAreaId,
      timeSwitchNotice: null,
      finalTimeStep: 0,
    }));

    if (withPhotos) {
      startPhotoJudgeQueueFromCapturedPhotos();
    } else {
      photoJudgeQueueRunIdRef.current += 1;
      setPhotoJudgeQueueMap({});
    }
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
    photoJudgeFeedback?: PhotoJudgeFeedbackDraft | null
  ): AppState {
    if (!prev.currentAreaId) return prev;
    const currentAreaId = prev.currentAreaId;
    const photoJudgeFeedbackMap = buildPhotoJudgeFeedbackMap({
      prev,
      areaId: currentAreaId,
      selection,
      draft: photoJudgeFeedback,
    });

    if (selection === "many" || selection === "normal") {
      return {
        ...prev,
        screen: "rate_display",
        photoJudgeFeedbackMap,
        timeSwitchNotice: null,
        finalTimeStep: 0,
        areaProgressMap: {
          ...prev.areaProgressMap,
          [currentAreaId]: {
            ...prev.areaProgressMap[currentAreaId],
            areaJudge: selection,
            visitedAt: new Date().toISOString(),
          },
        },
      };
    }

    const { nextSession, timeSwitchNotice } = refreshSessionDiscountTime(prev.session);

    const updatedMap = {
      ...prev.areaProgressMap,
      [currentAreaId]: {
        ...prev.areaProgressMap[currentAreaId],
        areaJudge: "few" as const,
        status: "postponed_few" as const,
        skipReason: "few" as const,
        visitedAt: new Date().toISOString(),
      },
    };

    if (prev.currentFlow === "pending") {
      const nextDeferredAreaIds = [...prev.pendingDeferredAreaIds, currentAreaId];

      return moveToNextPendingOrDone({
        prev: { ...prev, photoJudgeFeedbackMap },
        updatedMap,
        referenceAreaId: currentAreaId,
        deferredAreaIds: nextDeferredAreaIds,
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
        photoJudgeFeedbackMap,
        currentAreaId: null,
        lastReferenceAreaId: currentAreaId,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        finalTimeStep: 0,
        screen: "final_time",
      };
    }

    const nextAreaId = getNextNormalArea(currentAreaId);

    if (nextAreaId) {
      return {
        ...prev,
        session: nextSession,
        timeSwitchNotice,
        areaProgressMap: updatedMap,
        photoJudgeFeedbackMap,
        currentAreaId: nextAreaId,
        lastReferenceAreaId: currentAreaId,
        pendingDeferredAreaIds: [],
        finalTimeStep: 0,
        screen: "area_judge",
      };
    }

    return moveToNextPendingOrDone({
      prev: { ...prev, photoJudgeFeedbackMap },
      updatedMap,
      referenceAreaId: currentAreaId,
      nextSession,
      timeSwitchNotice,
    });
  }

  function startSession() {
    if (!state.session) {
      clearPhotoCaptureState();
    }

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
          consumed.skippedAreaIds
        );
      }

      const firstAreaId =
        nextSession.discountTime === "20"
          ? null
          : getFirstAvailableAreaId(areaProgressMap);

      return {
        ...prev,
        screen:
          nextSession.discountTime === "20"
            ? "final_time"
            : firstAreaId
            ? "photo_capture"
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
    setUndoSnapshot(null);
    setUndoNotice(null);
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
    photoJudgeFeedback?: PhotoJudgeFeedbackDraft | null
  ) {
    setAreaJudgeSelection(judge);
    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);

    setState((prev) => applyAreaJudgeSelection(prev, judge, photoJudgeFeedback));
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

      const nextAreaId = getNextNormalArea(currentAreaId);

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
          screen: "area_judge",
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

      const updatedMap = {
        ...prev.areaProgressMap,
        [currentAreaId]: {
          ...prev.areaProgressMap[currentAreaId],
          status: "completed" as const,
          completedAt: new Date().toISOString(),
        },
      };

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
              {
                date: prev.session.date,
                targetDiscountTime,
                areaId: currentAreaId,
              },
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

      const nextAreaId = getNextNormalArea(currentAreaId);

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
          screen: "area_judge",
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

  function advanceFinalTimeStep() {
    if (state.screen !== "final_time") return;

    setUndoSnapshot(createUndoSnapshot());
    setUndoNotice(null);
    setState((prev) => ({
      ...prev,
      finalTimeStep: Math.min(3, prev.finalTimeStep + 1) as AppState["finalTimeStep"],
    }));
  }

  function resetApp() {
    clearPhotoCaptureState();
    screenHistoryRef.current = [];
    previousRenderRef.current = null;
    suppressHistoryPushRef.current = false;
    setState(createInitialState(buildStartDefaultDraft(lastUsedSessionDraft)));
    setAreaJudgeSelection(null);
    setResumeTargetScreen(null);
    setUndoSnapshot(null);
    setUndoNotice(null);
  }

  return {
    state,
    derived: {
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
  showDailyNoticeBeforeRate,
  areaJudgeSelection,
  isResuming: resumeTargetScreen !== null,
  canUndo: undoSnapshot !== null,
  undoNotice,
  canChooseSkipTarget,
  skipTargetOptions,
  doneSummaryItems,
  currentPhotoJudgeFeedback,
  photoJudgeBaseUrl,
  photoCaptureSlots,
  photoCaptureCompletedCount,
  photoCaptureTotalCount,
  currentPhotoJudgeQueueRecord,
},
    actions: {
      updateSessionDraft,
      startSession,
      updatePhotoJudgeBaseUrl,
      capturePhotoSlot,
      startValueAfterPhotoCapture,
      retryPhotoJudgeForArea,
      goBackOneScreen,
      startEditingConditions,
      undoLastAction,
      markBentoJudgeGuideShown,
      confirmDailyNotice,
      judgeCurrentArea,
      skipCurrentArea,
      chooseSkipTargetArea,
      goToNextArea,
      advanceFinalTimeStep,
      resetApp,
    },
  };
}