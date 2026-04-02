import type {
  AppState,
  AreaId,
  LastSessionWeatherRecord,
  NextSessionSkipRecord,
  SessionDraft,
} from "./types";

export const STORAGE_KEYS = {
  currentSession: "nebiki-helper/current-session",
  nextSessionSkipRecords: "nebiki-helper/next-session-skip-records",
  lastSessionWeather: "nebiki-helper/last-session-weather",
  lastUsedSessionDraft: "nebiki-helper/last-used-session-draft",
} as const;

export type PersistedNebikiState = {
  currentSession: AppState | null;
  nextSessionSkipRecords: NextSessionSkipRecord[];
  lastSessionWeather: LastSessionWeatherRecord | null;
  lastUsedSessionDraft: SessionDraft | null;
};

function safeParseJSON<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function loadCurrentSession(): AppState | null {
  const raw = localStorage.getItem(STORAGE_KEYS.currentSession);
  return safeParseJSON<AppState | null>(raw, null);
}

export function saveCurrentSession(state: AppState): void {
  localStorage.setItem(STORAGE_KEYS.currentSession, JSON.stringify(state));
}

export function clearCurrentSession(): void {
  localStorage.removeItem(STORAGE_KEYS.currentSession);
}

export function loadNextSessionSkipRecords(): NextSessionSkipRecord[] {
  const raw = localStorage.getItem(STORAGE_KEYS.nextSessionSkipRecords);
  return safeParseJSON<NextSessionSkipRecord[]>(raw, []);
}

export function saveNextSessionSkipRecords(records: NextSessionSkipRecord[]): void {
  localStorage.setItem(
    STORAGE_KEYS.nextSessionSkipRecords,
    JSON.stringify(records)
  );
}

export function appendNextSessionSkipRecords(
  recordsToAdd: NextSessionSkipRecord[]
): void {
  if (recordsToAdd.length === 0) return;

  const current = loadNextSessionSkipRecords();
  const merged = [...current];

  for (const record of recordsToAdd) {
    const exists = merged.some(
      (r) =>
        r.date === record.date &&
        r.targetDiscountTime === record.targetDiscountTime &&
        r.areaId === record.areaId
    );

    if (!exists) {
      merged.push(record);
    }
  }

  saveNextSessionSkipRecords(merged);
}

export function consumeNextSessionSkipAreaIds(params: {
  date: string;
  targetDiscountTime: "18" | "19";
}): AreaId[] {
  const current = loadNextSessionSkipRecords();

  const matched = current.filter(
    (r) =>
      r.date === params.date &&
      r.targetDiscountTime === params.targetDiscountTime
  );

  const remaining = current.filter(
    (r) =>
      !(
        r.date === params.date &&
        r.targetDiscountTime === params.targetDiscountTime
      )
  );

  saveNextSessionSkipRecords(remaining);

  return matched.map((r) => r.areaId);
}

export function loadLastSessionWeather(): LastSessionWeatherRecord | null {
  const raw = localStorage.getItem(STORAGE_KEYS.lastSessionWeather);
  return safeParseJSON<LastSessionWeatherRecord | null>(raw, null);
}

export function saveLastSessionWeather(record: LastSessionWeatherRecord): void {
  localStorage.setItem(STORAGE_KEYS.lastSessionWeather, JSON.stringify(record));
}

export function clearLastSessionWeather(): void {
  localStorage.removeItem(STORAGE_KEYS.lastSessionWeather);
}


export function loadLastUsedSessionDraft(): SessionDraft | null {
  const raw = localStorage.getItem(STORAGE_KEYS.lastUsedSessionDraft);
  return safeParseJSON<SessionDraft | null>(raw, null);
}

export function saveLastUsedSessionDraft(sessionDraft: SessionDraft): void {
  localStorage.setItem(
    STORAGE_KEYS.lastUsedSessionDraft,
    JSON.stringify(sessionDraft)
  );
}

export function clearLastUsedSessionDraft(): void {
  localStorage.removeItem(STORAGE_KEYS.lastUsedSessionDraft);
}

export function loadPersistedNebikiState(): PersistedNebikiState {
  return {
    currentSession: loadCurrentSession(),
    nextSessionSkipRecords: loadNextSessionSkipRecords(),
    lastSessionWeather: loadLastSessionWeather(),
    lastUsedSessionDraft: loadLastUsedSessionDraft(),
  };
}

export function savePersistedNebikiState(state: PersistedNebikiState): void {
  if (state.currentSession) {
    saveCurrentSession(state.currentSession);
  } else {
    clearCurrentSession();
  }

  saveNextSessionSkipRecords(state.nextSessionSkipRecords);

  if (state.lastSessionWeather) {
    saveLastSessionWeather(state.lastSessionWeather);
  } else {
    clearLastSessionWeather();
  }

  if (state.lastUsedSessionDraft) {
    saveLastUsedSessionDraft(state.lastUsedSessionDraft);
  } else {
    clearLastUsedSessionDraft();
  }
}

export function appendSkipRecordsInMemory(params: {
  currentRecords: NextSessionSkipRecord[];
  recordsToAdd: NextSessionSkipRecord[];
}): NextSessionSkipRecord[] {
  if (params.recordsToAdd.length === 0) {
    return params.currentRecords.map((record) => ({ ...record }));
  }

  const merged = params.currentRecords.map((record) => ({ ...record }));

  for (const record of params.recordsToAdd) {
    const exists = merged.some(
      (current) =>
        current.date === record.date &&
        current.targetDiscountTime === record.targetDiscountTime &&
        current.areaId === record.areaId
    );

    if (!exists) {
      merged.push({ ...record });
    }
  }

  return merged;
}

export function consumeSkipRecordsInMemory(params: {
  currentRecords: NextSessionSkipRecord[];
  date: string;
  targetDiscountTime: "18" | "19";
}): {
  skippedAreaIds: AreaId[];
  remainingRecords: NextSessionSkipRecord[];
} {
  const matched = params.currentRecords.filter(
    (record) =>
      record.date === params.date &&
      record.targetDiscountTime === params.targetDiscountTime
  );

  const remainingRecords = params.currentRecords
    .filter(
      (record) =>
        !(
          record.date === params.date &&
          record.targetDiscountTime === params.targetDiscountTime
        )
    )
    .map((record) => ({ ...record }));

  return {
    skippedAreaIds: matched.map((record) => record.areaId),
    remainingRecords,
  };
}
