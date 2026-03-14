import { useEffect, useMemo, useState } from "react";
import type {
  AppState,
  AreaId,
  AreaProgress,
  PendingBannerInfo,
  SessionData,
  SessionDraft,
  UseNebikiAppResult,
  WeatherInput,
} from "../domain/types";
import { AREA_MASTERS, getAreaName, getNextNormalArea } from "../domain/area";
import {
  getBasisGuideDisplay,
  getWeatherGuideText,
  getWeekdayBaseInfo,
} from "../domain/weekdayBase";
import {
  getFinalTimeGuide,
  getNormalTimeRateDisplay,
} from "../domain/discount";
import {
  clearCurrentSession,
  loadCurrentSession,
  saveCurrentSession,
} from "../domain/storage";
import {
  getNextPendingCandidate,
  getPendingRemainingCount,
} from "../domain/pending";

function formatLocalDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function createInitialSessionDraft(): SessionDraft {
  const now = new Date();

  return {
    date: formatLocalDate(now),
    weekday: now.getDay(),
    discountTime: "17",
    weather: {
      isRain: false,
      windLevel: "2orLess",
      tempLevel: "11to15",
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

function createInitialState(): AppState {
  return {
    screen: "start",
    session: null,
    sessionDraft: createInitialSessionDraft(),
    areaProgressMap: createInitialAreaProgressMap(),
    currentAreaId: null,
    lastReferenceAreaId: null,
    currentFlow: "normal",
    pendingDeferredAreaIds: [],
  };
}

function normalizeWeatherInput(raw: unknown): WeatherInput {
  const fallback = createInitialSessionDraft().weather;

  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const source = raw as Record<string, unknown>;

  return {
    isRain:
      typeof source.isRain === "boolean" ? source.isRain : fallback.isRain,
    windLevel:
      source.windLevel === "2orLess" ||
      source.windLevel === "3to4" ||
      source.windLevel === "5orMore"
        ? source.windLevel
        : typeof source.isWindThresholdMet === "boolean"
        ? source.isWindThresholdMet
          ? "3to4"
          : "2orLess"
        : typeof source.isWindOver3m === "boolean"
        ? source.isWindOver3m
          ? "3to4"
          : "2orLess"
        : fallback.windLevel,
    tempLevel:
      source.tempLevel === "10orLess" ||
      source.tempLevel === "11to15" ||
      source.tempLevel === "16orMore"
        ? source.tempLevel
        : typeof source.isTempUnder10 === "boolean"
        ? source.isTempUnder10
          ? "10orLess"
          : "11to15"
        : fallback.tempLevel,
  };
}

function normalizeSessionDraft(raw?: Partial<SessionDraft> | null): SessionDraft {
  const fallback = createInitialSessionDraft();

  return {
    date: typeof raw?.date === "string" ? raw.date : fallback.date,
    weekday: typeof raw?.weekday === "number" ? raw.weekday : fallback.weekday,
    discountTime:
      raw?.discountTime === "17" ||
      raw?.discountTime === "18" ||
      raw?.discountTime === "19" ||
      raw?.discountTime === "20"
        ? raw.discountTime
        : fallback.discountTime,
    weather: normalizeWeatherInput(raw?.weather),
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

function normalizeLoadedState(loaded: AppState | null): AppState {
  if (!loaded) return createInitialState();

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
  };
}

function getWeekdayText(weekday: number): string {
  const map = ["日", "月", "火", "水", "木", "金", "土"];
  return `${map[weekday] ?? ""}曜日`;
}

export function useNebikiApp(): UseNebikiAppResult {
  const [state, setState] = useState<AppState>(() =>
    normalizeLoadedState(loadCurrentSession())
  );

  useEffect(() => {
    saveCurrentSession(state);
  }, [state]);

  const sessionSource = state.session ?? state.sessionDraft;
  const currentAreaName = state.currentAreaId ? getAreaName(state.currentAreaId) : null;

  const weekdayText = useMemo(() => {
    return getWeekdayText(sessionSource.weekday);
  }, [sessionSource.weekday]);

  const timeText = useMemo(() => {
    return `${sessionSource.discountTime}時`;
  }, [sessionSource.discountTime]);

  const weekdayBaseInfo = useMemo(() => {
    return getWeekdayBaseInfo(sessionSource.weekday, sessionSource.weather);
  }, [sessionSource.weekday, sessionSource.weather]);

  const basisGuide = useMemo(() => {
    return getBasisGuideDisplay({
      weekday: sessionSource.weekday,
      discountTime: sessionSource.discountTime,
      weather: sessionSource.weather,
    });
  }, [sessionSource.weekday, sessionSource.discountTime, sessionSource.weather]);

  const weatherGuideText = useMemo(() => {
    return getWeatherGuideText(sessionSource.discountTime);
  }, [sessionSource.discountTime]);

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
      weatherBonus: weekdayBaseInfo.baseRateBonus,
      areaJudge: currentAreaProgress.areaJudge,
    });
  }, [state.session, currentAreaProgress, weekdayBaseInfo.baseRateBonus]);

  const finalGuide = useMemo(() => {
    if (!state.session || state.session.discountTime !== "20") return null;
    return getFinalTimeGuide();
  }, [state.session]);

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

  function updateSessionDraft(patch: Partial<SessionDraft>) {
    setState((prev) => ({
      ...prev,
      sessionDraft: {
        ...prev.sessionDraft,
        ...patch,
        weather: {
          ...prev.sessionDraft.weather,
          ...(patch.weather ?? {}),
        },
      },
    }));
  }

  function moveToNextPendingOrDone(params: {
    prev: AppState;
    updatedMap: Record<AreaId, AreaProgress>;
    referenceAreaId: AreaId;
    deferredAreaIds?: AreaId[];
  }): AppState {
    const nextCandidate = getNextPendingCandidate({
      areaProgressMap: params.updatedMap,
      referenceAreaId: params.referenceAreaId,
      deferredAreaIds: params.deferredAreaIds ?? [],
    });

    if (!nextCandidate) {
      return {
        ...params.prev,
        areaProgressMap: params.updatedMap,
        currentAreaId: null,
        lastReferenceAreaId: params.referenceAreaId,
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
        screen: "done",
      };
    }

    return {
      ...params.prev,
      areaProgressMap: params.updatedMap,
      currentAreaId: nextCandidate.areaId,
      lastReferenceAreaId: params.referenceAreaId,
      currentFlow: "pending",
      pendingDeferredAreaIds: params.deferredAreaIds ?? [],
      screen: nextCandidate.reason === "manual" ? "area_judge" : "rate_display",
    };
  }

  function startSession() {
    const startedAt = new Date().toISOString();

    setState((prev) => {
      const isFinalTime = prev.sessionDraft.discountTime === "20";

      return {
        ...prev,
        screen: isFinalTime ? "final_time" : "area_judge",
        session: {
          ...prev.sessionDraft,
          startedAt,
        },
        areaProgressMap: createInitialAreaProgressMap(),
        currentAreaId: isFinalTime ? null : "bento_men",
        lastReferenceAreaId: isFinalTime ? null : "bento_men",
        currentFlow: "normal",
        pendingDeferredAreaIds: [],
      };
    });
  }

  function selectAreaMany() {
    setState((prev) => {
      if (!prev.currentAreaId) return prev;
      const currentAreaId = prev.currentAreaId;

      return {
        ...prev,
        screen: "rate_display",
        areaProgressMap: {
          ...prev.areaProgressMap,
          [currentAreaId]: {
            ...prev.areaProgressMap[currentAreaId],
            areaJudge: "many",
            visitedAt: new Date().toISOString(),
          },
        },
      };
    });
  }

  function selectAreaNormal() {
    setState((prev) => {
      if (!prev.currentAreaId) return prev;
      const currentAreaId = prev.currentAreaId;

      return {
        ...prev,
        screen: "rate_display",
        areaProgressMap: {
          ...prev.areaProgressMap,
          [currentAreaId]: {
            ...prev.areaProgressMap[currentAreaId],
            areaJudge: "normal",
            visitedAt: new Date().toISOString(),
          },
        },
      };
    });
  }

  function selectAreaFew() {
    setState((prev) => {
      if (!prev.currentAreaId) return prev;
      const currentAreaId = prev.currentAreaId;

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
        return moveToNextPendingOrDone({
          prev,
          updatedMap,
          referenceAreaId: currentAreaId,
        });
      }

      const nextAreaId = getNextNormalArea(currentAreaId);

      if (nextAreaId) {
        return {
          ...prev,
          areaProgressMap: updatedMap,
          currentAreaId: nextAreaId,
          lastReferenceAreaId: currentAreaId,
          pendingDeferredAreaIds: [],
          screen: "area_judge",
        };
      }

      return moveToNextPendingOrDone({
        prev,
        updatedMap,
        referenceAreaId: currentAreaId,
      });
    });
  }

  function skipCurrentArea() {
    setState((prev) => {
      if (!prev.currentAreaId) return prev;
      const currentAreaId = prev.currentAreaId;
      const currentProgress = prev.areaProgressMap[currentAreaId];

      if (prev.currentFlow === "pending") {
        const nextDeferredAreaIds = prev.pendingDeferredAreaIds.includes(currentAreaId)
          ? prev.pendingDeferredAreaIds
          : [...prev.pendingDeferredAreaIds, currentAreaId];

        return moveToNextPendingOrDone({
          prev,
          updatedMap: prev.areaProgressMap,
          referenceAreaId: currentAreaId,
          deferredAreaIds: nextDeferredAreaIds,
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

      const nextAreaId = getNextNormalArea(currentAreaId);

      if (nextAreaId) {
        return {
          ...prev,
          areaProgressMap: updatedMap,
          currentAreaId: nextAreaId,
          lastReferenceAreaId: currentAreaId,
          pendingDeferredAreaIds: [],
          screen: "area_judge",
        };
      }

      return moveToNextPendingOrDone({
        prev,
        updatedMap,
        referenceAreaId: currentAreaId,
      });
    });
  }

  function goToNextArea() {
    setState((prev) => {
      if (!prev.currentAreaId) return prev;
      const currentAreaId = prev.currentAreaId;

      const updatedMap = {
        ...prev.areaProgressMap,
        [currentAreaId]: {
          ...prev.areaProgressMap[currentAreaId],
          status: "completed" as const,
          completedAt: new Date().toISOString(),
        },
      };

      if (prev.currentFlow === "pending") {
        return moveToNextPendingOrDone({
          prev,
          updatedMap,
          referenceAreaId: currentAreaId,
        });
      }

      const nextAreaId = getNextNormalArea(currentAreaId);

      if (nextAreaId) {
        return {
          ...prev,
          areaProgressMap: updatedMap,
          currentAreaId: nextAreaId,
          lastReferenceAreaId: currentAreaId,
          pendingDeferredAreaIds: [],
          screen: "area_judge",
        };
      }

      return moveToNextPendingOrDone({
        prev,
        updatedMap,
        referenceAreaId: currentAreaId,
      });
    });
  }

  function resetApp() {
    clearCurrentSession();
    setState(createInitialState());
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
    },
    actions: {
      updateSessionDraft,
      startSession,
      selectAreaMany,
      selectAreaNormal,
      selectAreaFew,
      skipCurrentArea,
      goToNextArea,
      resetApp,
    },
  };
}