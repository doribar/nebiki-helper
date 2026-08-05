import type {
  AppState,
  AreaId,
  DailyMessageState,
  LastSessionWeatherRecord,
  NextSessionSkipRecord,
  SessionDraft,
  Review19Result,
  DailySessionSnapshot,
  AreaJudge,
  ScreenName,
} from "./types";
import type { NavigationSnapshot } from "./navigationHistory";
import { appendReview19RecordInMemory, cloneReview19Records } from "./review19.ts";
import {
  normalizeWeatherConfirmationPending,
  type WeatherConfirmationPending,
} from "./weatherConfirmation.ts";
import { normalizeDemandCycle } from "./demandCycle.ts";

export const STORAGE_KEYS = {
  currentSession: "nebiki-helper/current-session",
  workSessionCheckpoint: "nebiki-helper/work-session-checkpoint",
  runtimeState: "nebiki-helper/runtime-state",
  nextSessionSkipRecords: "nebiki-helper/next-session-skip-records",
  lastSessionWeather: "nebiki-helper/last-session-weather",
  lastUsedSessionDraft: "nebiki-helper/last-used-session-draft",
  dailyMessageState: "nebiki-helper/daily-message-state",
  review19Records: "nebiki-helper/review19-records",
  review19SourceState: "nebiki-helper/review19-source-state",
  dailySessionSnapshots: "nebiki-helper/daily-session-snapshots",
  finalDayAutoExportDates: "nebiki-helper/final-day-auto-export-dates",
} as const;

export type PersistedRuntimeState = {
  areaJudgeSelection: AreaJudge;
  resumeTargetScreen: ScreenName | null;
  timeSwitchTarget: import("./types").DiscountTime | null;
  undoSnapshot: NavigationSnapshot | null;
  screenHistory: NavigationSnapshot[];
  weatherConfirmationPending?: WeatherConfirmationPending | null;
};

export type PersistedNebikiState = {
  currentSession: AppState | null;
  workSessionCheckpoint: AppState | null;
  runtimeState: PersistedRuntimeState | null;
  nextSessionSkipRecords: NextSessionSkipRecord[];
  lastSessionWeather: LastSessionWeatherRecord | null;
  lastUsedSessionDraft: SessionDraft | null;
  dailyMessageState: DailyMessageState;
};

function cloneSkipRecord(record: NextSessionSkipRecord): NextSessionSkipRecord {
  const cloned: NextSessionSkipRecord = {
    date: record.date,
    targetDiscountTime: record.targetDiscountTime,
    areaId: record.areaId,
  };

  if (record.demandCycle === "normal" || record.demandCycle === "summer") {
    cloned.demandCycle = record.demandCycle;
  }

  if (typeof record.previousRateText === "string") cloned.previousRateText = record.previousRateText;
  if (typeof record.previousManyRateText === "string") cloned.previousManyRateText = record.previousManyRateText;
  if (typeof record.previousNormalRateText === "string") cloned.previousNormalRateText = record.previousNormalRateText;
  if (record.skipKind === "late_plus5" || record.skipKind === "early_next_minus5") cloned.skipKind = record.skipKind;
  if (record.sourceDiscountTime === "17" || record.sourceDiscountTime === "18") {
    cloned.sourceDiscountTime = record.sourceDiscountTime;
  }
  if (typeof record.sourceSessionStartedAt === "string") {
    cloned.sourceSessionStartedAt = record.sourceSessionStartedAt;
  }
  if (typeof record.earlyDiscountCompletedAt === "string") {
    cloned.earlyDiscountCompletedAt = record.earlyDiscountCompletedAt;
  }

  return cloned;
}

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

export function loadWorkSessionCheckpoint(): AppState | null {
  const raw = localStorage.getItem(STORAGE_KEYS.workSessionCheckpoint);
  return safeParseJSON<AppState | null>(raw, null);
}

export function saveWorkSessionCheckpoint(state: AppState): void {
  localStorage.setItem(STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(state));
}

export function clearWorkSessionCheckpoint(): void {
  localStorage.removeItem(STORAGE_KEYS.workSessionCheckpoint);
}

function cloneRuntimeState(raw: PersistedRuntimeState | null): PersistedRuntimeState | null {
  if (!raw || typeof raw !== "object") return null;

  return {
    areaJudgeSelection:
      raw.areaJudgeSelection === "many" ||
      raw.areaJudgeSelection === "normal" ||
      raw.areaJudgeSelection === "few"
        ? raw.areaJudgeSelection
        : null,
    resumeTargetScreen:
      typeof raw.resumeTargetScreen === "string" ? raw.resumeTargetScreen : null,
    timeSwitchTarget:
      raw.timeSwitchTarget === "15" ||
      raw.timeSwitchTarget === "17" ||
      raw.timeSwitchTarget === "18" ||
      raw.timeSwitchTarget === "19" ||
      raw.timeSwitchTarget === "20"
        ? raw.timeSwitchTarget
        : null,
    undoSnapshot: raw.undoSnapshot ? JSON.parse(JSON.stringify(raw.undoSnapshot)) : null,
    screenHistory: Array.isArray(raw.screenHistory)
      ? JSON.parse(JSON.stringify(raw.screenHistory))
      : [],
    weatherConfirmationPending: normalizeWeatherConfirmationPending(
      raw.weatherConfirmationPending,
    ),
  };
}

export function loadRuntimeState(): PersistedRuntimeState | null {
  const raw = localStorage.getItem(STORAGE_KEYS.runtimeState);
  return cloneRuntimeState(safeParseJSON<PersistedRuntimeState | null>(raw, null));
}

export function saveRuntimeState(state: PersistedRuntimeState): void {
  localStorage.setItem(
    STORAGE_KEYS.runtimeState,
    JSON.stringify(cloneRuntimeState(state))
  );
}

export function clearRuntimeState(): void {
  localStorage.removeItem(STORAGE_KEYS.runtimeState);
}

export function loadNextSessionSkipRecords(): NextSessionSkipRecord[] {
  const raw = localStorage.getItem(STORAGE_KEYS.nextSessionSkipRecords);
  const parsed = safeParseJSON<NextSessionSkipRecord[]>(raw, []);
  return Array.isArray(parsed) ? parsed.map(cloneSkipRecord) : [];
}

export function saveNextSessionSkipRecords(records: NextSessionSkipRecord[]): void {
  localStorage.setItem(
    STORAGE_KEYS.nextSessionSkipRecords,
    JSON.stringify(records.map(cloneSkipRecord))
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
      merged.push(cloneSkipRecord(record));
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

  saveNextSessionSkipRecords(remaining.map(cloneSkipRecord));

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


function clearLegacyAreaCountRecords(): void {
  localStorage.removeItem("nebiki-helper/area-count-records");
}

const defaultDailyMessageState: DailyMessageState = {
  bentoJudgeGuideShownDate: null,
  rateNoticeShownDate: null,
};

export function normalizeDailyMessageState(
  raw?: Partial<DailyMessageState> | null
): DailyMessageState {
  return {
    bentoJudgeGuideShownDate:
      typeof raw?.bentoJudgeGuideShownDate === "string"
        ? raw.bentoJudgeGuideShownDate
        : null,
    rateNoticeShownDate:
      typeof raw?.rateNoticeShownDate === "string"
        ? raw.rateNoticeShownDate
        : null,
  };
}

export function loadDailyMessageState(): DailyMessageState {
  const raw = localStorage.getItem(STORAGE_KEYS.dailyMessageState);
  return normalizeDailyMessageState(
    safeParseJSON<Partial<DailyMessageState> | null>(raw, defaultDailyMessageState)
  );
}

export function saveDailyMessageState(state: DailyMessageState): void {
  localStorage.setItem(
    STORAGE_KEYS.dailyMessageState,
    JSON.stringify(normalizeDailyMessageState(state))
  );
}




export function hasFinalDayAutoExported(date: string): boolean {
  const raw = localStorage.getItem(STORAGE_KEYS.finalDayAutoExportDates);
  const dates = safeParseJSON<string[]>(raw, []);
  return Array.isArray(dates) && dates.includes(date);
}

export function markFinalDayAutoExported(date: string): void {
  const raw = localStorage.getItem(STORAGE_KEYS.finalDayAutoExportDates);
  const dates = safeParseJSON<string[]>(raw, []);
  const next = Array.from(new Set([...(Array.isArray(dates) ? dates : []), date]))
    .sort()
    .slice(-120);
  localStorage.setItem(STORAGE_KEYS.finalDayAutoExportDates, JSON.stringify(next));
}

function loadRawReview19Records(): unknown[] {
  const raw = localStorage.getItem(STORAGE_KEYS.review19Records);
  const parsed = safeParseJSON<unknown[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function loadReview19Records(): Review19Result[] {
  return cloneReview19Records(
    loadRawReview19Records()
      .filter((item): item is Review19Result =>
        Boolean(item) &&
        typeof item === "object" &&
        (item as { review19Status?: unknown }).review19Status !== "not_applicable"
      )
  );
}

export function saveReview19Records(records: Review19Result[]): void {
  // 旧not_applicableレコードは業務処理から除外するが、履歴自体は書き換えない。
  const legacyNotApplicable = loadRawReview19Records().filter((item) =>
    Boolean(item) &&
    typeof item === "object" &&
    (item as { review19Status?: unknown }).review19Status === "not_applicable"
  );
  localStorage.setItem(
    STORAGE_KEYS.review19Records,
    JSON.stringify([
      ...legacyNotApplicable,
      ...cloneReview19Records(records).filter(
        (record) => record.review19Status === "recorded"
      ),
    ])
  );
}

export function appendReview19Record(record: Review19Result): void {
  saveReview19Records(
    appendReview19RecordInMemory({
      currentRecords: loadReview19Records(),
      recordToAdd: record,
    })
  );
}


export function loadReview19SourceState(): AppState | null {
  const raw = localStorage.getItem(STORAGE_KEYS.review19SourceState);
  return safeParseJSON<AppState | null>(raw, null);
}

export function saveReview19SourceState(state: AppState): void {
  localStorage.setItem(STORAGE_KEYS.review19SourceState, JSON.stringify(state));
}

export function clearReview19SourceState(): void {
  localStorage.removeItem(STORAGE_KEYS.review19SourceState);
}


function formatLocalDateFromTimestamp(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isDailySessionSnapshotDateConsistent(snapshot: DailySessionSnapshot): boolean {
  return formatLocalDateFromTimestamp(snapshot.session.startedAt) === snapshot.session.date;
}

function cloneDailySessionSnapshot(snapshot: DailySessionSnapshot): DailySessionSnapshot {
  const cloned = JSON.parse(JSON.stringify(snapshot)) as DailySessionSnapshot;
  const demandCycle = normalizeDemandCycle(
    cloned.demandCycle ?? cloned.session?.demandCycle,
  );
  cloned.demandCycle = demandCycle;
  cloned.session.demandCycle = demandCycle;

  if (cloned.areas && typeof cloned.areas === "object") {
    for (const area of Object.values(cloned.areas)) {
      if (!area || typeof area !== "object") continue;
      if (area.rateDecisionSnapshot) {
        area.rateDecisionSnapshot.demandCycle = demandCycle;
      }
      if (area.areaCountDecisionBasis) {
        area.areaCountDecisionBasis.demandCycle = demandCycle;
      }
    }
  }

  return cloned;
}

function getDailySessionCompletionSignature(snapshot: DailySessionSnapshot): string {
  return JSON.stringify(
    Object.values(snapshot.areas)
      .map((area) => ({
        areaId: area.areaId,
        status: area.status,
        visitedAt: area.visitedAt ?? null,
        completedAt: area.completedAt ?? null,
        confirmedAt: area.rateDecisionSnapshot?.confirmedAt ?? null,
        measurementStatus: area.measurementStatus ?? null,
        missingReason: area.missingReason ?? null,
        measurementRecordedAt: area.measurementRecordedAt ?? null,
      }))
      .sort((a, b) => a.areaId.localeCompare(b.areaId))
  );
}

export function loadDailySessionSnapshots(): DailySessionSnapshot[] {
  const raw = localStorage.getItem(STORAGE_KEYS.dailySessionSnapshots);
  const parsed = safeParseJSON<DailySessionSnapshot[]>(raw, []);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((snapshot): snapshot is DailySessionSnapshot => {
      return (
        snapshot &&
        typeof snapshot === "object" &&
        snapshot.version === 1 &&
        typeof snapshot.capturedAt === "string" &&
        snapshot.session &&
        typeof snapshot.session.date === "string" &&
        typeof snapshot.session.startedAt === "string" &&
        isDailySessionSnapshotDateConsistent(snapshot)
      );
    })
    .map(cloneDailySessionSnapshot);
}

export function saveDailySessionSnapshots(snapshots: DailySessionSnapshot[]): void {
  localStorage.setItem(
    STORAGE_KEYS.dailySessionSnapshots,
    JSON.stringify(snapshots.map(cloneDailySessionSnapshot))
  );
}

export function upsertDailySessionSnapshot(snapshot: DailySessionSnapshot): void {
  if (!isDailySessionSnapshotDateConsistent(snapshot)) return;

  const current = loadDailySessionSnapshots();
  const previous = current.find((item) =>
    item.session.date === snapshot.session.date &&
    item.session.discountTime === snapshot.session.discountTime &&
    item.session.startedAt === snapshot.session.startedAt
  );
  const preserveCapturedDecision = Boolean(
    previous &&
    getDailySessionCompletionSignature(previous) ===
      getDailySessionCompletionSignature(snapshot)
  );
  const snapshotToStore = preserveCapturedDecision && previous
    ? {
        ...cloneDailySessionSnapshot(snapshot),
        capturedAt: previous.capturedAt,
        basisCapturedAt: previous.basisCapturedAt ?? previous.capturedAt,
        basis: JSON.parse(JSON.stringify(previous.basis)),
        areas: JSON.parse(JSON.stringify(previous.areas)),
        doneSummaryItems: JSON.parse(JSON.stringify(previous.doneSummaryItems)),
      }
    : cloneDailySessionSnapshot(snapshot);
  const next = [
    ...current.filter((item) => {
      return !(
        item.session.date === snapshot.session.date &&
        item.session.discountTime === snapshot.session.discountTime &&
        item.session.startedAt === snapshot.session.startedAt
      );
    }),
    snapshotToStore,
  ]
    .sort((a, b) => {
      const dateCompare = a.session.date.localeCompare(b.session.date);
      if (dateCompare !== 0) return dateCompare;
      return a.capturedAt.localeCompare(b.capturedAt);
    })
    .slice(-120);

  saveDailySessionSnapshots(next);
}

export function getDailySessionSnapshotsForDate(date: string): DailySessionSnapshot[] {
  return loadDailySessionSnapshots()
    .filter((snapshot) => snapshot.session.date === date)
    .sort((a, b) => {
      const timeCompare = a.session.discountTime.localeCompare(b.session.discountTime);
      if (timeCompare !== 0) return timeCompare;
      return a.capturedAt.localeCompare(b.capturedAt);
    });
}

export function isAppStateSessionCurrentForDate(
  state: AppState | null,
  date: string
): boolean {
  if (!state?.session) return true;

  return (
    state.session.date === date &&
    formatLocalDateFromTimestamp(state.session.startedAt) === date
  );
}

export function sanitizePersistedNebikiStateForDate(
  state: PersistedNebikiState,
  date: string
): PersistedNebikiState {
  const staleCurrentSession = !isAppStateSessionCurrentForDate(state.currentSession, date);
  const staleCheckpoint = !isAppStateSessionCurrentForDate(
    state.workSessionCheckpoint,
    date
  );
  const resetRuntimeState = staleCurrentSession || staleCheckpoint;

  return {
    ...state,
    currentSession: staleCurrentSession ? null : state.currentSession,
    workSessionCheckpoint: staleCheckpoint ? null : state.workSessionCheckpoint,
    runtimeState: resetRuntimeState ? null : state.runtimeState,
  };
}

export function loadPersistedNebikiState(): PersistedNebikiState {
  clearLegacyAreaCountRecords();

  return {
    currentSession: loadCurrentSession(),
    workSessionCheckpoint: loadWorkSessionCheckpoint(),
    runtimeState: loadRuntimeState(),
    nextSessionSkipRecords: loadNextSessionSkipRecords(),
    lastSessionWeather: loadLastSessionWeather(),
    lastUsedSessionDraft: loadLastUsedSessionDraft(),
    dailyMessageState: loadDailyMessageState(),
  };
}

export function loadPersistedNebikiStateForDate(date: string): PersistedNebikiState {
  const loaded = loadPersistedNebikiState();
  const sanitized = sanitizePersistedNebikiStateForDate(loaded, date);

  if (loaded.currentSession && !sanitized.currentSession) {
    clearCurrentSession();
  }

  if (loaded.workSessionCheckpoint && !sanitized.workSessionCheckpoint) {
    clearWorkSessionCheckpoint();
  }

  if (loaded.runtimeState && !sanitized.runtimeState) {
    clearRuntimeState();
  }

  return sanitized;
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

  saveDailyMessageState(state.dailyMessageState);
  clearLegacyAreaCountRecords();
}

export function appendSkipRecordsInMemory(params: {
  currentRecords: NextSessionSkipRecord[];
  recordsToAdd: NextSessionSkipRecord[];
}): NextSessionSkipRecord[] {
  if (params.recordsToAdd.length === 0) {
    return params.currentRecords.map(cloneSkipRecord);
  }

  const merged = params.currentRecords.map(cloneSkipRecord);

  for (const record of params.recordsToAdd) {
    const exists = merged.some(
      (current) =>
        current.date === record.date &&
        current.targetDiscountTime === record.targetDiscountTime &&
        current.areaId === record.areaId
    );

    if (!exists) {
      merged.push(cloneSkipRecord(record));
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
  skippedRecords: NextSessionSkipRecord[];
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
    .map(cloneSkipRecord);

  return {
    skippedAreaIds: matched.map((record) => record.areaId),
    skippedRecords: matched.map(cloneSkipRecord),
    remainingRecords,
  };
}
