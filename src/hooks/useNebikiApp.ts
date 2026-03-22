import { useEffect, useMemo, useState } from "react";
import type {
  AppState,
  AreaId,
  AreaProgress,
  DiscountTime,
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
  appendNextSessionSkipRecords,
  clearCurrentSession,
  consumeNextSessionSkipAreaIds,
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

function resolveDiscountTime(date = new Date()): DiscountTime {
  const minutes = date.getHours() * 60 + date.getMinutes();

  if (minutes < 18 * 60 + 30) return "17";
  if (minutes < 19 * 60 + 30) return "18";
  if (minutes < 20 * 60 + 30) return "19";
  return "20";
}

function getBasisTimeText(discountTime: DiscountTime): string {
  switch (discountTime) {
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

function createInitialSessionDraft(): SessionDraft {
  const now = new Date();

  return {
    date: formatLocalDate(now),
    weekday: now.getDay(),
    discountTime: resolveDiscountTime(now),
    manualWeekdayOverride: false,
    manualDiscountTimeOverride: false,
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
    timeSwitchNotice: null,
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
  source.tempLevel === "16to25" ||
  source.tempLevel === "26orMore"
    ? source.tempLevel
    : source.tempLevel === "16orMore"
    ? "16to25"
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
    manualWeekdayOverride:
      typeof raw?.manualWeekdayOverride === "boolean"
        ? raw.manualWeekdayOverride
        : false,
    manualDiscountTimeOverride:
      typeof raw?.manualDiscountTimeOverride === "boolean"
        ? raw.manualDiscountTimeOverride
        : false,
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
    timeSwitchNotice:
      (loaded as Partial<AppState>).timeSwitchNotice ?? null,
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
    },
    timeSwitchNotice: buildTimeSwitchNotice(nowDiscountTime),
  };
}

export function useNebikiApp(): UseNebikiAppResult {
  const [state, setState] = useState<AppState>(() =>
    normalizeLoadedState(loadCurrentSession())
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    saveCurrentSession(state);
  }, [state]);

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

  const sessionSource = state.session ?? state.sessionDraft;
  const currentAreaName = state.currentAreaId ? getAreaName(state.currentAreaId) : null;

  const weekdayText = useMemo(() => {
    return getWeekdayText(sessionSource.weekday);
  }, [sessionSource.weekday]);

  const timeText = useMemo(() => {
    return getBasisTimeText(sessionSource.discountTime);
  }, [sessionSource.discountTime]);

  const weekdayBaseInfo = useMemo(() => {
    return getWeekdayBaseInfo(sessionSource.weekday, sessionSource.weather);
  }, [sessionSource.weekday, sessionSource.weather]);

  const lateTimeBonus = useMemo(() => {
  if (!state.session) return 0;
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

  const basisGuide = useMemo(() => {
  const baseGuide = getBasisGuideDisplay({
    weekday: sessionSource.weekday,
    discountTime: sessionSource.discountTime,
    weather: sessionSource.weather,
  });

  if (!lateTimeBonusNotice) {
    return baseGuide;
  }

  return {
    ...baseGuide,
    bonusText: baseGuide.bonusText
      ? `${baseGuide.bonusText} ${lateTimeBonusNotice}`
      : lateTimeBonusNotice,
  };
}, [
  sessionSource.weekday,
  sessionSource.discountTime,
  sessionSource.weather,
  lateTimeBonusNotice,
]);

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
});
  }, [
  state.session,
  currentAreaProgress,
  weekdayBaseInfo.baseRateBonus,
  lateTimeBonus,
]);
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
    nextSession: SessionData | null;
    timeSwitchNotice: string | null;
  }): AppState {
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
        screen: "final_time",
      };
    }

    const nextCandidate = getNextPendingCandidate({
      areaProgressMap: params.updatedMap,
      referenceAreaId: params.referenceAreaId,
      deferredAreaIds: params.deferredAreaIds ?? [],
    });

    if (!nextCandidate) {
      return {
        ...params.prev,
        session: params.nextSession,
        timeSwitchNotice: params.timeSwitchNotice,
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
      session: params.nextSession,
      timeSwitchNotice: params.timeSwitchNotice,
      areaProgressMap: params.updatedMap,
      currentAreaId: nextCandidate.areaId,
      lastReferenceAreaId: params.referenceAreaId,
      currentFlow: "pending",
      pendingDeferredAreaIds: params.deferredAreaIds ?? [],
      screen: nextCandidate.reason === "manual" ? "area_judge" : "rate_display",
    };
  }

function startSession() {
  const now = new Date();
  const startedAt = now.toISOString();
  const currentDate = formatLocalDate(now);
  const currentWeekday = now.getDay();
  const currentDiscountTime = resolveDiscountTime(now);

  setState((prev) => {
    const session: SessionData = {
      ...prev.sessionDraft,
      date: currentDate,
      weekday: prev.sessionDraft.manualWeekdayOverride
        ? prev.sessionDraft.weekday
        : currentWeekday,
      discountTime: prev.sessionDraft.manualDiscountTimeOverride
        ? prev.sessionDraft.discountTime
        : currentDiscountTime,
      startedAt,
    };

    let areaProgressMap = createInitialAreaProgressMap();

    if (session.discountTime === "18" || session.discountTime === "19") {
      const skippedAreaIds = consumeNextSessionSkipAreaIds({
        date: session.date,
        targetDiscountTime: session.discountTime,
      });

      areaProgressMap = createAreaProgressMapWithAutoSkippedAreas(
        skippedAreaIds
      );
    }

    const firstAreaId =
      session.discountTime === "20"
        ? null
        : getFirstAvailableAreaId(areaProgressMap);

    return {
      ...prev,
      screen:
        session.discountTime === "20"
          ? "final_time"
          : firstAreaId
          ? "area_judge"
          : "done",
      session,
      areaProgressMap,
      currentAreaId: firstAreaId,
      lastReferenceAreaId: firstAreaId,
      currentFlow: "normal",
      pendingDeferredAreaIds: [],
      timeSwitchNotice: null,
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
        timeSwitchNotice: null,
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
        timeSwitchNotice: null,
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

  function skipCurrentArea() {
  setState((prev) => {
    if (!prev.currentAreaId) return prev;
    const currentAreaId = prev.currentAreaId;
    const currentProgress = prev.areaProgressMap[currentAreaId];
    const { nextSession, timeSwitchNotice } = refreshSessionDiscountTime(prev.session);

    if (prev.currentFlow === "pending") {
      // 同じ manual skip エリアがもう一度出てきた状態で再スキップしたら、
      // few を先に回すために manual を全部 defer 扱いにする
      const isSecondConsecutiveSameManualSkip =
        currentProgress.status === "skipped_manual" &&
        prev.pendingDeferredAreaIds.includes(currentAreaId);

      const nextDeferredAreaIds = isSecondConsecutiveSameManualSkip
        ? Object.values(prev.areaProgressMap)
            .filter((p) => p.status === "skipped_manual")
            .map((p) => p.areaId)
        : prev.pendingDeferredAreaIds.includes(currentAreaId)
        ? prev.pendingDeferredAreaIds
        : [...prev.pendingDeferredAreaIds, currentAreaId];

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

  function goToNextArea() {
  setState((prev) => {
    if (!prev.currentAreaId) return prev;
    const currentAreaId = prev.currentAreaId;
    const { nextSession, timeSwitchNotice } = refreshSessionDiscountTime(
      prev.session
    );

    const updatedMap = {
      ...prev.areaProgressMap,
      [currentAreaId]: {
        ...prev.areaProgressMap[currentAreaId],
        status: "completed" as const,
        completedAt: new Date().toISOString(),
      },
    };

    // +5% が発動している状態で完了したエリアだけ、次回スキップ対象として記録
    if (
      prev.session &&
      lateTimeBonus > 0 &&
      !prev.session.manualDiscountTimeOverride
    ) {
      const targetDiscountTime = getNextSkipTargetDiscountTime(
        prev.session.discountTime
      );

      if (targetDiscountTime) {
        appendNextSessionSkipRecords([
          {
            date: prev.session.date,
            targetDiscountTime,
            areaId: currentAreaId,
          },
        ]);
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
      timeSwitchNotice: state.timeSwitchNotice,
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