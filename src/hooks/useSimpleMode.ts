import { useCallback, useEffect, useMemo, useState } from "react";
import { getNormalRoute } from "../domain/area.ts";
import {
  applySimpleAreaJudgment,
  buildSimpleFinalRoute,
  buildSimpleSecondRoute,
  clearSimpleModeState,
  completeSimpleFirstLapArea,
  createInitialSimpleModeState,
  loadSimpleModeState,
  resolveSimpleDiscountTime,
  saveSimpleModeState,
  type SimpleModeState,
  type SimpleRateSnapshot,
} from "../domain/simpleMode.ts";
import type { AreaCountEvaluation, AreaId, SessionDraft } from "../domain/types.ts";

export type UseSimpleModeResult = {
  state: SimpleModeState;
  route: AreaId[];
  activeRoute: AreaId[];
  actions: {
    updateSessionDraft: (patch: Partial<SessionDraft>) => void;
    startSession: () => void;
    judgeCurrentArea: (evaluation: AreaCountEvaluation) => void;
    completeFirstLapArea: (rate: SimpleRateSnapshot) => void;
    completeSecondLapArea: () => void;
    reset: () => void;
    syncToTime: (now: Date) => void;
  };
};

export function useSimpleMode(params: { testNow?: Date | null } = {}): UseSimpleModeResult {
  const getNow = useCallback(
    () => params.testNow ? new Date(params.testNow) : new Date(),
    [params.testNow],
  );
  const [state, setState] = useState<SimpleModeState>(() =>
    params.testNow
      ? createInitialSimpleModeState(getNow())
      : loadSimpleModeState(getNow()),
  );
  const route = useMemo(() => getNormalRoute(state.date), [state.date]);
  const activeRoute = useMemo(
    () => state.phase === "second_lap"
      ? buildSimpleSecondRoute(route, state.judgments)
      : state.phase === "final"
        ? state.finalRoute
        : route,
    [route, state.finalRoute, state.judgments, state.phase],
  );

  useEffect(() => {
    if (!params.testNow) saveSimpleModeState(state);
  }, [params.testNow, state]);

  const syncToTime = useCallback((now: Date) => {
    setState((current) => {
      const target = resolveSimpleDiscountTime(now);
      const currentDate = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
      if (current.date === currentDate && current.discountTime === target) return current;

      if (target === "20" && current.date === currentDate) {
        const routeForDate = getNormalRoute(currentDate);
        const judgments1930 = current.discountTime === "19"
          ? current.judgments
          : current.judgments1930;
        return {
          ...createInitialSimpleModeState(now),
          judgments1930,
          finalRoute: buildSimpleFinalRoute(routeForDate, judgments1930),
        };
      }

      return createInitialSimpleModeState(now);
    });
  }, []);

  useEffect(() => {
    if (params.testNow) return;
    const update = () => syncToTime(new Date());
    const intervalId = window.setInterval(update, 30 * 1000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [params.testNow, syncToTime]);

  const updateSessionDraft = useCallback((patch: Partial<SessionDraft>) => {
    setState((current) => {
      const nextDraft = { ...current.sessionDraft, ...patch };
      const nextDiscountTime = patch.discountTime;
      if (
        nextDiscountTime &&
        nextDiscountTime !== current.discountTime &&
        (nextDiscountTime === "17" || nextDiscountTime === "18" || nextDiscountTime === "19")
      ) {
        return {
          ...createInitialSimpleModeState(getNow()),
          date: nextDraft.date,
          discountTime: nextDiscountTime,
          sessionDraft: { ...nextDraft, discountTime: nextDiscountTime },
        };
      }
      return { ...current, sessionDraft: nextDraft };
    });
  }, [getNow]);

  const startSession = useCallback(() => {
    setState((current) => ({
      ...current,
      phase: "judgment",
      currentIndex: 0,
      currentAreaId: getNormalRoute(current.date)[0] ?? null,
      judgments: {},
      firstLapRates: {},
    }));
  }, []);

  const judgeCurrentArea = useCallback((evaluation: AreaCountEvaluation) => {
    setState((current) => applySimpleAreaJudgment(current, evaluation));
  }, []);

  const completeFirstLapArea = useCallback((rate: SimpleRateSnapshot) => {
    setState((current) => completeSimpleFirstLapArea(current, rate));
  }, []);

  const completeSecondLapArea = useCallback(() => {
    setState((current) => {
      const secondRoute = buildSimpleSecondRoute(getNormalRoute(current.date), current.judgments);
      if (current.currentIndex >= secondRoute.length - 1) return current;
      return {
        ...current,
        currentIndex: current.currentIndex + 1,
        currentAreaId: secondRoute[current.currentIndex + 1] ?? null,
      };
    });
  }, []);

  const reset = useCallback(() => {
    clearSimpleModeState();
    setState(createInitialSimpleModeState(getNow()));
  }, [getNow]);

  return {
    state,
    route,
    activeRoute,
    actions: {
      updateSessionDraft,
      startSession,
      judgeCurrentArea,
      completeFirstLapArea,
      completeSecondLapArea,
      reset,
      syncToTime,
    },
  };
}
