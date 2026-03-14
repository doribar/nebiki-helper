import { useEffect, useMemo, useState } from "react";
import type {
  AppState,
  AreaId,
  AreaProgress,
  ManyProductRecord,
  SessionDraft,
  UseNebikiAppResult,
} from "../domain/types";
import { AREA_MASTERS, getAreaName, getNextNormalArea } from "../domain/area";
import {
  getBasisGuideDisplay,
  getWeatherGuideText,
  getWeekdayBaseInfo,
} from "../domain/weekdayBase";
import {
  getConsecutiveManyRateForNormalTime,
  getFinalTimeGuide,
  getNormalTimeRateDisplay,
} from "../domain/discount";
import {
  appendManyProducts,
  clearCurrentSession,
  getPreviousManyProducts,
  loadCurrentSession,
  saveCurrentSession,
} from "../domain/storage";
import {
  getNextPendingCandidate,
  getPendingReasonText,
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
      isWindOver3m: false,
      isTempUnder10: false,
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
    manyInputDraft: [""],
    pendingDeferredAreaIds: [],
  };
}

function normalizeLoadedState(loaded: AppState | null): AppState {
  if (!loaded) return createInitialState();

  return {
    ...loaded,
    sessionDraft: loaded.sessionDraft ?? createInitialSessionDraft(),
    areaProgressMap: loaded.areaProgressMap ?? createInitialAreaProgressMap(),
    currentAreaId: loaded.currentAreaId ?? null,
    lastReferenceAreaId:
      (loaded as Partial<AppState>).lastReferenceAreaId ?? null,
    currentFlow: (loaded as Partial<AppState>).currentFlow ?? "normal",
    manyInputDraft:
      loaded.manyInputDraft && loaded.manyInputDraft.length > 0
        ? loaded.manyInputDraft
        : [""],
    pendingDeferredAreaIds:
      (loaded as Partial<AppState>).pendingDeferredAreaIds ?? [],
  };
}

function getWeekdayText(weekday: number): string {
  const map = ["日", "月", "火", "水", "木", "金", "土"];
  return `${map[weekday] ?? ""}曜日`;
}

function createManyProductRecords(params: {
  areaId: AreaId;
  date: string;
  discountTime: "17" | "18" | "19" | "20";
  names: string[];
}): ManyProductRecord[] {
  return params.names
    .map((name) => name.trim())
    .filter(Boolean)
    .map((productName) => ({
      areaId: params.areaId,
      productName,
      recordedDate: params.date,
      discountTime: params.discountTime,
    }));
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

  const previousManyProducts = useMemo(() => {
    if (!state.session || !state.currentAreaId) return [];

    return getPreviousManyProducts({
      areaId: state.currentAreaId,
      discountTime: state.session.discountTime,
      currentDate: state.session.date,
    });
  }, [state.session, state.currentAreaId]);

  const rateDisplay = useMemo(() => {
    if (!state.session || !currentAreaProgress) return null;
    if (state.session.discountTime === "20") return null;

    if (
      currentAreaProgress.areaJudge !== "many" &&
      currentAreaProgress.areaJudge !== "normal"
    ) {
      return null;
    }

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

  const consecutiveManyRate = useMemo(() => {
    if (!state.session || !state.currentAreaId) return null;
    if (state.session.discountTime === "20") return null;
    if (!currentAreaProgress) return null;

    if (
      currentAreaProgress.areaJudge !== "many" &&
      currentAreaProgress.areaJudge !== "normal"
    ) {
      return null;
    }

    return getConsecutiveManyRateForNormalTime({
      discountTime: state.session.discountTime,
      weatherBonus: weekdayBaseInfo.baseRateBonus,
      areaJudge: currentAreaProgress.areaJudge,
    });
  }, [
    state.session,
    state.currentAreaId,
    currentAreaProgress,
    weekdayBaseInfo.baseRateBonus,
  ]);

  const pendingCandidate = useMemo(() => {
    if (!state.lastReferenceAreaId) return null;

    return getNextPendingCandidate({
      areaProgressMap: state.areaProgressMap,
      referenceAreaId: state.lastReferenceAreaId,
      deferredAreaIds: state.pendingDeferredAreaIds,
    });
  }, [
    state.areaProgressMap,
    state.lastReferenceAreaId,
    state.pendingDeferredAreaIds,
  ]);

  const pendingReasonText = useMemo(() => {
    return pendingCandidate ? getPendingReasonText(pendingCandidate.reason) : null;
  }, [pendingCandidate]);

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
      manyInputDraft: [""],
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
        const nextCandidate = getNextPendingCandidate({
          areaProgressMap: updatedMap,
          referenceAreaId: currentAreaId,
          deferredAreaIds: [],
        });

        return {
          ...prev,
          areaProgressMap: updatedMap,
          screen: nextCandidate ? "pending_guide" : "done",
          currentAreaId: null,
          lastReferenceAreaId: currentAreaId,
          pendingDeferredAreaIds: [],
        };
      }

      const nextAreaId = getNextNormalArea(currentAreaId);

      return {
        ...prev,
        areaProgressMap: updatedMap,
        screen: nextAreaId ? "area_judge" : "pending_guide",
        currentAreaId: nextAreaId,
        lastReferenceAreaId: currentAreaId,
        pendingDeferredAreaIds: [],
      };
    });
  }

  function skipCurrentArea() {
    setState((prev) => {
      if (!prev.currentAreaId) return prev;
      const currentAreaId = prev.currentAreaId;

      const updatedMap = {
        ...prev.areaProgressMap,
        [currentAreaId]: {
          ...prev.areaProgressMap[currentAreaId],
          status: "skipped_manual" as const,
          skipReason: "manual" as const,
        },
      };

      if (prev.currentFlow === "pending") {
        const nextCandidate = getNextPendingCandidate({
          areaProgressMap: updatedMap,
          referenceAreaId: currentAreaId,
          deferredAreaIds: [],
        });

        return {
          ...prev,
          areaProgressMap: updatedMap,
          screen: nextCandidate ? "pending_guide" : "done",
          currentAreaId: null,
          lastReferenceAreaId: currentAreaId,
          pendingDeferredAreaIds: [],
        };
      }

      const nextAreaId = getNextNormalArea(currentAreaId);

      return {
        ...prev,
        areaProgressMap: updatedMap,
        screen: nextAreaId ? "area_judge" : "pending_guide",
        currentAreaId: nextAreaId,
        lastReferenceAreaId: currentAreaId,
        pendingDeferredAreaIds: [],
      };
    });
  }

  function openManyInput() {
    setState((prev) => ({
      ...prev,
      screen: "many_input",
      manyInputDraft: [""],
    }));
  }

  function changeManyDraftValues(next: string[]) {
    setState((prev) => ({
      ...prev,
      manyInputDraft: next,
    }));
  }

  function addManyDraftRow() {
    setState((prev) => ({
      ...prev,
      manyInputDraft: [...prev.manyInputDraft, ""],
    }));
  }

  function removeManyDraftRow(index: number) {
    setState((prev) => ({
      ...prev,
      manyInputDraft: prev.manyInputDraft.filter((_, i) => i !== index),
    }));
  }

  function saveManyDraft() {
    setState((prev) => {
      if (!prev.session || !prev.currentAreaId) {
        return {
          ...prev,
          screen: "rate_display",
          manyInputDraft: [""],
        };
      }

      const records = createManyProductRecords({
        areaId: prev.currentAreaId,
        date: prev.session.date,
        discountTime: prev.session.discountTime,
        names: prev.manyInputDraft,
      });

      if (records.length > 0) {
        appendManyProducts(records);
      }

      return {
        ...prev,
        screen: "rate_display",
        manyInputDraft: [""],
      };
    });
  }

  function cancelManyDraft() {
    setState((prev) => ({
      ...prev,
      screen: "rate_display",
      manyInputDraft: [""],
    }));
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
        const nextCandidate = getNextPendingCandidate({
          areaProgressMap: updatedMap,
          referenceAreaId: currentAreaId,
          deferredAreaIds: [],
        });

        return {
          ...prev,
          areaProgressMap: updatedMap,
          screen: nextCandidate ? "pending_guide" : "done",
          currentAreaId: null,
          lastReferenceAreaId: currentAreaId,
          pendingDeferredAreaIds: [],
        };
      }

      const nextAreaId = getNextNormalArea(currentAreaId);

      return {
        ...prev,
        areaProgressMap: updatedMap,
        screen: nextAreaId ? "area_judge" : "pending_guide",
        currentAreaId: nextAreaId,
        lastReferenceAreaId: currentAreaId,
        pendingDeferredAreaIds: [],
      };
    });
  }

  function openPendingArea() {
    if (!pendingCandidate) return;

    setState((prev) => ({
      ...prev,
      currentAreaId: pendingCandidate.areaId,
      screen: "area_judge",
      currentFlow: "pending",
      pendingDeferredAreaIds: [],
    }));
  }

  function postponePendingAgain() {
    if (!pendingCandidate) return;

    setState((prev) => {
      const exists = prev.pendingDeferredAreaIds.includes(pendingCandidate.areaId);

      return {
        ...prev,
        screen: "pending_guide",
        pendingDeferredAreaIds: exists
          ? prev.pendingDeferredAreaIds
          : [...prev.pendingDeferredAreaIds, pendingCandidate.areaId],
      };
    });
  }

  function markPendingCompleted() {
    if (!pendingCandidate) return;

    setState((prev) => {
      const updatedMap = {
        ...prev.areaProgressMap,
        [pendingCandidate.areaId]: {
          ...prev.areaProgressMap[pendingCandidate.areaId],
          status: "completed" as const,
          completedAt: new Date().toISOString(),
        },
      };

      const nextCandidate = getNextPendingCandidate({
        areaProgressMap: updatedMap,
        referenceAreaId: pendingCandidate.areaId,
        deferredAreaIds: [],
      });

      return {
        ...prev,
        areaProgressMap: updatedMap,
        currentAreaId: null,
        lastReferenceAreaId: pendingCandidate.areaId,
        pendingDeferredAreaIds: [],
        screen: nextCandidate ? "pending_guide" : "done",
      };
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
      previousManyProducts,
      consecutiveManyRate,
      pendingCandidate,
      pendingReasonText,
    },
    actions: {
      updateSessionDraft,
      startSession,

      selectAreaMany,
      selectAreaNormal,
      selectAreaFew,
      skipCurrentArea,

      openManyInput,
      changeManyDraftValues,
      addManyDraftRow,
      removeManyDraftRow,
      saveManyDraft,
      cancelManyDraft,

      goToNextArea,

      openPendingArea,
      postponePendingAgain,
      markPendingCompleted,

      resetApp,
    },
  };
}