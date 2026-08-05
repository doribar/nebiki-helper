import type {
  AppState,
  AreaJudge,
  LastSessionWeatherRecord,
  NextSessionSkipRecord,
  ScreenName,
} from './types';
import { normalizeDemandCycle } from './demandCycle.ts';

export type NavigationSnapshot = {
  state: AppState;
  areaJudgeSelection: AreaJudge;
  resumeTargetScreen: ScreenName | null;
  nextSessionSkipRecords: NextSessionSkipRecord[];
  lastSessionWeather: LastSessionWeatherRecord | null;
};

export function cloneAppState(state: AppState): AppState {
  const cloned = JSON.parse(JSON.stringify(state)) as AppState;
  if (cloned.session) {
    const sessionDemandCycle = normalizeDemandCycle(cloned.session.demandCycle);
    cloned.session.demandCycle = sessionDemandCycle;
    cloned.sessionDraft = {
      ...cloned.sessionDraft,
      // During an active business day the started session is authoritative.
      demandCycle: sessionDemandCycle,
    };
    return cloned;
  }

  cloned.sessionDraft = {
    ...cloned.sessionDraft,
    // Legacy navigation snapshots without the field normalize to normal.
    demandCycle: normalizeDemandCycle(cloned.sessionDraft?.demandCycle),
  };

  return cloned;
}

export function cloneSkipRecords(
  records: NextSessionSkipRecord[]
): NextSessionSkipRecord[] {
  return records.map((record) => ({ ...record }));
}

export function cloneLastSessionWeatherRecord(
  record: LastSessionWeatherRecord | null
): LastSessionWeatherRecord | null {
  return record
    ? {
        ...record,
        demandCycle: normalizeDemandCycle(record.demandCycle),
        ...(record.temperatureComfortAnalysis
          ? {
              temperatureComfortAnalysis: {
                ...record.temperatureComfortAnalysis,
              },
            }
          : {}),
      }
    : null;
}

export function cloneNavigationSnapshot(
  snapshot: NavigationSnapshot
): NavigationSnapshot {
  return {
    state: cloneAppState(snapshot.state),
    areaJudgeSelection: snapshot.areaJudgeSelection,
    resumeTargetScreen: snapshot.resumeTargetScreen,
    nextSessionSkipRecords: cloneSkipRecords(snapshot.nextSessionSkipRecords),
    lastSessionWeather: cloneLastSessionWeatherRecord(snapshot.lastSessionWeather),
  };
}

export function createNavigationSnapshot(params: {
  state: AppState;
  areaJudgeSelection: AreaJudge;
  resumeTargetScreen: ScreenName | null;
  nextSessionSkipRecords: NextSessionSkipRecord[];
  lastSessionWeather: LastSessionWeatherRecord | null;
}): NavigationSnapshot {
  return {
    state: cloneAppState(params.state),
    areaJudgeSelection: params.areaJudgeSelection,
    resumeTargetScreen: params.resumeTargetScreen,
    nextSessionSkipRecords: cloneSkipRecords(params.nextSessionSkipRecords),
    lastSessionWeather: cloneLastSessionWeatherRecord(params.lastSessionWeather),
  };
}

export function hasNavigationStateChanged(prev: AppState, next: AppState): boolean {
  return (
    prev.screen !== next.screen ||
    prev.currentAreaId !== next.currentAreaId ||
    prev.finalTimeStep !== next.finalTimeStep
  );
}

export function appendNavigationHistory(params: {
  history: NavigationSnapshot[];
  previousSnapshot: NavigationSnapshot | null;
  nextState: AppState;
  suppressHistoryPush: boolean;
}): {
  history: NavigationSnapshot[];
  suppressHistoryPush: boolean;
} {
  const baseHistory = params.history.map(cloneNavigationSnapshot);

  if (!params.previousSnapshot) {
    return {
      history: baseHistory,
      suppressHistoryPush: params.suppressHistoryPush,
    };
  }

  if (!hasNavigationStateChanged(params.previousSnapshot.state, params.nextState)) {
    return {
      history: baseHistory,
      suppressHistoryPush: params.suppressHistoryPush,
    };
  }

  if (params.suppressHistoryPush) {
    return {
      history: baseHistory,
      suppressHistoryPush: false,
    };
  }

  return {
    history: [...baseHistory, cloneNavigationSnapshot(params.previousSnapshot)],
    suppressHistoryPush: false,
  };
}

export function popNavigationHistory(history: NavigationSnapshot[]): {
  history: NavigationSnapshot[];
  previousSnapshot: NavigationSnapshot | null;
} {
  if (history.length === 0) {
    return {
      history: [],
      previousSnapshot: null,
    };
  }

  return {
    history: history.slice(0, -1).map(cloneNavigationSnapshot),
    previousSnapshot: cloneNavigationSnapshot(history[history.length - 1]),
  };
}
