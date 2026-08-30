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
import {
  appendReview19RecordInMemory,
  buildReview19DataQuality,
  cloneReview19Records,
} from "./review19.ts";
import {
  normalizeWeatherConfirmationPending,
  type WeatherConfirmationPending,
} from "./weatherConfirmation.ts";
import { normalizeDemandCycle } from "./demandCycle.ts";
import {
  buildAnalysisWeatherContext,
  buildSessionCalendarContextFromSnapshot,
  chooseBestAnalysisWeatherContext,
  normalizeAnalysisCalendarContext,
} from "./analysisMetadata.ts";
import { FINALIZED_DAY_DATA_STORAGE_KEY } from "./finalizedDayData.ts";
import {
  LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY,
  LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY,
  isLegacyAreaCountStorageFullyCovered,
  removeLegacyAreaCountStorage,
  type LegacyAreaCountStorageKey,
} from "./areaCountLocalStorage.ts";

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

/** Persisted navigation is a crash/debug aid; in-memory navigation stays intact. */
export const PERSISTED_RUNTIME_HISTORY_MAX_ENTRIES = 24;

export type StorageOperationResult =
  | {
      ok: true;
      key: string;
      operation: "set" | "remove";
    }
  | {
      ok: false;
      key: string;
      operation: "set" | "remove";
      errorName: string;
      quotaExceeded: boolean;
    };

export type StorageOperationRecoveryResult = {
  ok: boolean;
  retried: boolean;
  attempts: StorageOperationResult[];
  finalResult: StorageOperationResult;
};

export const NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES = Math.floor(
  2.25 * 1024 * 1024,
);
export const NEBIKI_LOCAL_STORAGE_WRITE_HEADROOM_BYTES = 256 * 1024;

export function estimateNebikiLocalStorageTotalBytes(): number {
  if (typeof localStorage === "undefined") return 0;
  let total = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith("nebiki-helper/")) continue;
    const value = localStorage.getItem(key);
    if (value !== null) total += (key.length + value.length) * 2;
  }
  return total;
}

function isOperationalHeadroomLow(): boolean {
  try {
    return estimateNebikiLocalStorageTotalBytes() >
      NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES -
        NEBIKI_LOCAL_STORAGE_WRITE_HEADROOM_BYTES;
  } catch {
    return false;
  }
}

/**
 * DailySessionSnapshot is a rich, reconstructable copy. Keep its localStorage
 * footprint bounded so it cannot crowd out authoritative area/review/queue data.
 *
 * localStorage stores DOMString values. Counting UTF-16 code units (including
 * the key) is deterministic and intentionally conservative across browsers.
 */
export const DAILY_SESSION_SNAPSHOT_MAX_RECORDS = 120;
export const DAILY_SESSION_SNAPSHOT_BYTE_BUDGET = 512 * 1024;

let archivedFinalizedDatesForRetention = new Set<string>();

/** Register only dates whose rich finalized records were verified in IndexedDB. */
export function setArchivedFinalizedDatesForStorageRetention(
  dates: readonly string[],
): void {
  archivedFinalizedDatesForRetention = new Set(
    dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
  );
}

export type DailySessionSnapshotRetentionResult = {
  snapshots: DailySessionSnapshot[];
  prunedCount: number;
  retainedCount: number;
  retainedApproxBytes: number;
  protectedDateExceededBudget: boolean;
  requiredHistoryExceededBudget: boolean;
};

export type DailySessionSnapshotWriteResult = {
  ok: boolean;
  quotaExceeded: boolean;
  retried: boolean;
  prunedCount: number;
  retainedCount: number;
  retainedApproxBytes: number;
  failure: StorageOperationResult | null;
  attempts: StorageOperationResult[];
};

export type StartupStorageHousekeepingResult = {
  attempts: StorageOperationResult[];
  removedLegacyKeys: LegacyAreaCountStorageKey[];
  dailySnapshotsPruned: number;
  dailySnapshotsRetained: number;
  dailySnapshotsRetainedApproxBytes: number;
};

function isQuotaExceededStorageError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === "QuotaExceededError" ||
    candidate.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    candidate.code === 22 ||
    candidate.code === 1014
  );
}

export function attemptStorageOperation(params: {
  key: string;
  operation: "set" | "remove";
  run: () => void;
}): StorageOperationResult {
  try {
    params.run();
    return {
      ok: true,
      key: params.key,
      operation: params.operation,
    };
  } catch (error) {
    return {
      ok: false,
      key: params.key,
      operation: params.operation,
      errorName:
        error && typeof error === "object" && "name" in error
          ? String((error as { name?: unknown }).name ?? "Error")
          : "Error",
      quotaExceeded: isQuotaExceededStorageError(error),
    };
  }
}

/**
 * Maintenance/domain code that must preserve untouched JSON values can write
 * through the same structured boundary without adding a raw primitive outside
 * this module.
 */
export function writeStorageJsonValueSafely(params: {
  storage: Pick<Storage, "setItem">;
  key: string;
  value: unknown;
}): StorageOperationResult {
  const { storage, key, value } = params;
  return attemptStorageOperation({
    key,
    operation: "set",
    run: () => storage.setItem(key, JSON.stringify(value)),
  });
}

/**
 * UI / hookから任意keyを削除するときもDOMExceptionをReactへ漏らさない境界。
 * payloadを読み取らず、失敗結果だけを呼び出し側へ返す。
 */
export function removeStorageKeySafely(key: string): StorageOperationResult {
  return attemptStorageOperation({
    key,
    operation: "remove",
    run: () => localStorage.removeItem(key),
  });
}

/**
 * 正本または業務継続に必要な書き込み向けの共通境界。
 * Quota時だけnavigation runtimeと重複checkpointを解放し、同じ操作を
 * ちょうど1回再試行する。呼び出し操作はidempotentであること。
 */
export function attemptStorageOperationWithAuxiliaryRecovery(params: {
  key: string;
  operation: "set" | "remove";
  run: () => void;
}): StorageOperationRecoveryResult {
  const proactiveAttempts = isOperationalHeadroomLow()
    ? releaseAuxiliaryStorageForReview19()
    : [];
  const guardedParams = {
    ...params,
    run: () => {
      // Some domain writers keep SSR-compatible no-op behavior when storage is
      // absent. A browser business-flow boundary must not mistake that no-op
      // for an authoritative save.
      if (typeof localStorage === "undefined") {
        const error = new Error("localStorage is unavailable");
        error.name = "StorageUnavailableError";
        throw error;
      }
      void localStorage;
      params.run();
    },
  };
  const firstAttempt = attemptStorageOperation(guardedParams);
  const attempts: StorageOperationResult[] = [...proactiveAttempts, firstAttempt];
  if (firstAttempt.ok || !firstAttempt.quotaExceeded) {
    return {
      ok: firstAttempt.ok,
      retried: false,
      attempts,
      finalResult: firstAttempt,
    };
  }

  attempts.push(...releaseAuxiliaryStorageForReview19());
  const retryAttempt = attemptStorageOperation(guardedParams);
  attempts.push(retryAttempt);
  return {
    ok: retryAttempt.ok,
    retried: true,
    attempts,
    finalResult: retryAttempt,
  };
}

/**
 * record本文やcredentialを出さず、失敗した保存領域だけを診断へ残す。
 */
export function reportStorageOperationFailures(
  context: string,
  results: readonly StorageOperationResult[],
): void {
  const failures = results.filter(
    (result): result is Extract<StorageOperationResult, { ok: false }> =>
      !result.ok,
  );
  if (failures.length === 0) return;

  console.warn("[nebiki-helper] storage operation failed", {
    context,
    failures: failures.map(({ key, operation, errorName, quotaExceeded }) => ({
      key,
      operation,
      errorName,
      quotaExceeded,
    })),
  });
}

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
      ? JSON.parse(JSON.stringify(raw.screenHistory.slice(
          -PERSISTED_RUNTIME_HISTORY_MAX_ENTRIES,
        )))
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

export function appendReview19RecordSafely(
  record: Review19Result,
): StorageOperationResult {
  return attemptStorageOperation({
    key: STORAGE_KEYS.review19Records,
    operation: "set",
    run: () => appendReview19Record(record),
  });
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
  cloned.calendarContext =
    normalizeAnalysisCalendarContext(cloned.calendarContext) ??
    buildSessionCalendarContextFromSnapshot(cloned);
  cloned.analysisWeatherContext = chooseBestAnalysisWeatherContext([
    cloned.analysisWeatherContext,
    buildAnalysisWeatherContext(
      cloned.session.weather,
      cloned.session.discountTime,
    ),
  ]);

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

function compareDailySessionSnapshots(
  left: DailySessionSnapshot,
  right: DailySessionSnapshot,
): number {
  const dateCompare = left.session.date.localeCompare(right.session.date);
  if (dateCompare !== 0) return dateCompare;
  return left.capturedAt.localeCompare(right.capturedAt);
}

function serializeDailySessionSnapshots(
  snapshots: readonly DailySessionSnapshot[],
): string {
  return JSON.stringify(snapshots.map(cloneDailySessionSnapshot));
}

/** localStorageのDOMString key/valueをUTF-16 code unit基準で概算する。 */
export function estimateLocalStorageEntryBytes(
  key: string,
  value: string,
): number {
  return (key.length + value.length) * 2;
}

function estimateDailySessionSnapshotStorageBytes(
  snapshots: readonly DailySessionSnapshot[],
): number {
  return estimateLocalStorageEntryBytes(
    STORAGE_KEYS.dailySessionSnapshots,
    serializeDailySessionSnapshots(snapshots),
  );
}

function loadFinalizedDayDatesForSnapshotRetention(): Set<string> {
  const parsed = safeParseJSON<unknown[]>(
    localStorage.getItem(FINALIZED_DAY_DATA_STORAGE_KEY),
    [],
  );
  if (!Array.isArray(parsed)) {
    return new Set(archivedFinalizedDatesForRetention);
  }

  return new Set([
    ...archivedFinalizedDatesForRetention,
    ...parsed.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const record = candidate as {
        version?: unknown;
        date?: unknown;
        sessions?: unknown;
        areaCountRecords?: unknown;
      };
      return record.version === 1 &&
          typeof record.date === "string" &&
          Array.isArray(record.sessions) &&
          Array.isArray(record.areaCountRecords)
        ? [record.date]
        : [];
    }),
  ]);
}

/**
 * Keep complete date groups rather than arbitrary individual records. This
 * prevents a retained 20:30 snapshot from looking like a complete day while
 * its earlier session snapshots have already been removed.
 *
 * Protected and not-yet-finalized dates are a soft exception to both limits.
 * The running business day's recovery/temperature inputs and the only legacy
 * export/backfill fallback must not be discarded to satisfy a cache budget.
 * Only dates sealed into finalized-day-data are prune candidates because that
 * authoritative record contains the same session snapshots.
 */
export function retainDailySessionSnapshotsWithinBudget(
  snapshots: readonly DailySessionSnapshot[],
  options?: {
    protectedDates?: readonly string[];
    finalizedDates?: ReadonlySet<string>;
    maxRecords?: number;
    byteBudget?: number;
  },
): DailySessionSnapshotRetentionResult {
  const sorted = snapshots
    .map(cloneDailySessionSnapshot)
    .sort(compareDailySessionSnapshots);
  const protectedDates = new Set(options?.protectedDates ?? []);
  const finalizedDates = options?.finalizedDates ?? new Set<string>();
  const maxRecords = Math.max(
    0,
    Math.floor(options?.maxRecords ?? DAILY_SESSION_SNAPSHOT_MAX_RECORDS),
  );
  const byteBudget = Math.max(
    0,
    Math.floor(options?.byteBudget ?? DAILY_SESSION_SNAPSHOT_BYTE_BUDGET),
  );
  const groupsByDate = new Map<string, DailySessionSnapshot[]>();

  for (const snapshot of sorted) {
    const date = snapshot.session.date;
    const group = groupsByDate.get(date) ?? [];
    group.push(snapshot);
    groupsByDate.set(date, group);
  }

  const protectedSnapshots = [...groupsByDate.entries()]
    .filter(([date]) => protectedDates.has(date))
    .flatMap(([, group]) => group)
    .sort(compareDailySessionSnapshots);
  const requiredSnapshots = [...groupsByDate.entries()]
    .filter(
      ([date]) => protectedDates.has(date) || !finalizedDates.has(date),
    )
    .flatMap(([, group]) => group)
    .sort(compareDailySessionSnapshots);
  let retained = requiredSnapshots;
  const protectedDateExceededBudget =
    protectedSnapshots.length > maxRecords ||
    estimateDailySessionSnapshotStorageBytes(protectedSnapshots) > byteBudget;
  const requiredHistoryExceededBudget =
    requiredSnapshots.length > maxRecords ||
    estimateDailySessionSnapshotStorageBytes(requiredSnapshots) > byteBudget;
  const remainingGroups = [...groupsByDate.entries()]
    .filter(
      ([date]) => !protectedDates.has(date) && finalizedDates.has(date),
    )
    .map(([date, group]) => ({
      date,
      group,
    }))
    .sort((left, right) => {
      return right.date.localeCompare(left.date);
    });

  for (const candidate of remainingGroups) {
    if (retained.length + candidate.group.length > maxRecords) continue;
    const next = [...retained, ...candidate.group].sort(compareDailySessionSnapshots);
    if (estimateDailySessionSnapshotStorageBytes(next) > byteBudget) continue;
    retained = next;
  }

  const retainedApproxBytes = estimateDailySessionSnapshotStorageBytes(retained);
  return {
    snapshots: retained.map(cloneDailySessionSnapshot),
    prunedCount: Math.max(0, sorted.length - retained.length),
    retainedCount: retained.length,
    retainedApproxBytes,
    protectedDateExceededBudget,
    requiredHistoryExceededBudget,
  };
}

function releaseFullyCoveredLegacyAreaCountStorage(): {
  attempts: StorageOperationResult[];
  removedKeys: LegacyAreaCountStorageKey[];
} {
  const attempts: StorageOperationResult[] = [];
  const removedKeys: LegacyAreaCountStorageKey[] = [];
  for (const key of [
    LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY,
    LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY,
  ] as const) {
    let removed = false;
    const result = attemptStorageOperation({
      key,
      operation: "remove",
      run: () => {
        if (!isLegacyAreaCountStorageFullyCovered(key)) return;
        removeLegacyAreaCountStorage(key);
        removed = true;
      },
    });
    attempts.push(result);
    if (result.ok && removed) removedKeys.push(key);
  }
  return { attempts, removedKeys };
}

function compactSealedDailySessionSnapshots(params?: {
  protectedDates?: readonly string[];
}): {
  attempts: StorageOperationResult[];
  prunedCount: number;
  retainedCount: number;
  retainedApproxBytes: number;
} {
  let retention: DailySessionSnapshotRetentionResult | null = null;
  const preparation = attemptStorageOperation({
    key: STORAGE_KEYS.dailySessionSnapshots,
    operation: "set",
    run: () => {
      retention = retainDailySessionSnapshotsWithinBudget(
        loadDailySessionSnapshots(),
        {
          protectedDates: params?.protectedDates,
          finalizedDates: loadFinalizedDayDatesForSnapshotRetention(),
        },
      );
    },
  });
  if (!preparation.ok || !retention) {
    return {
      attempts: [preparation],
      prunedCount: 0,
      retainedCount: 0,
      retainedApproxBytes: 0,
    };
  }

  const prepared = retention as DailySessionSnapshotRetentionResult;
  if (prepared.prunedCount === 0) {
    return {
      attempts: [],
      prunedCount: 0,
      retainedCount: prepared.retainedCount,
      retainedApproxBytes: prepared.retainedApproxBytes,
    };
  }

  const write = attemptStorageOperation({
    key: STORAGE_KEYS.dailySessionSnapshots,
    operation: "set",
    run: () => saveDailySessionSnapshots(prepared.snapshots),
  });
  return {
    attempts: [write],
    prunedCount: write.ok ? prepared.prunedCount : 0,
    retainedCount: prepared.retainedCount,
    retainedApproxBytes: prepared.retainedApproxBytes,
  };
}

/**
 * Idempotent startup cleanup. It never touches current-session, active
 * Review19 source, pending, Review19 records, finalized-day, or unsealed daily
 * snapshots. Existing state must be loaded into memory before invoking it.
 */
export function runStartupStorageHousekeeping(params?: {
  protectedDates?: readonly string[];
}): StartupStorageHousekeepingResult {
  const legacy = releaseFullyCoveredLegacyAreaCountStorage();
  const daily = compactSealedDailySessionSnapshots(params);
  const attempts = [...legacy.attempts, ...daily.attempts];
  reportStorageOperationFailures("startup-storage-housekeeping", attempts);
  return {
    attempts,
    removedLegacyKeys: legacy.removedKeys,
    dailySnapshotsPruned: daily.prunedCount,
    dailySnapshotsRetained: daily.retainedCount,
    dailySnapshotsRetainedApproxBytes: daily.retainedApproxBytes,
  };
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
    serializeDailySessionSnapshots(snapshots),
  );
}

function buildUpsertedDailySessionSnapshots(
  current: readonly DailySessionSnapshot[],
  snapshot: DailySessionSnapshot,
): DailySessionSnapshot[] {
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
    .sort(compareDailySessionSnapshots);
  return next;
}

export function upsertDailySessionSnapshotSafely(
  snapshot: DailySessionSnapshot,
  options?: { protectedDate?: string },
): DailySessionSnapshotWriteResult {
  if (!isDailySessionSnapshotDateConsistent(snapshot)) {
    return {
      ok: true,
      quotaExceeded: false,
      retried: false,
      prunedCount: 0,
      retainedCount: 0,
      retainedApproxBytes: 0,
      failure: null,
      attempts: [],
    };
  }

  const protectedDate = options?.protectedDate ?? snapshot.session.date;
  let upserted: DailySessionSnapshot[] = [];
  let retained: DailySessionSnapshotRetentionResult | null = null;
  let finalizedDates = new Set<string>();
  const preparationAttempt = attemptStorageOperation({
    key: STORAGE_KEYS.dailySessionSnapshots,
    operation: "set",
    run: () => {
      const current = loadDailySessionSnapshots();
      upserted = buildUpsertedDailySessionSnapshots(current, snapshot);
      finalizedDates = loadFinalizedDayDatesForSnapshotRetention();
      retained = retainDailySessionSnapshotsWithinBudget(upserted, {
        protectedDates: [protectedDate],
        finalizedDates,
      });
    },
  });

  if (!preparationAttempt.ok || !retained) {
    return {
      ok: false,
      quotaExceeded:
        !preparationAttempt.ok && preparationAttempt.quotaExceeded,
      retried: false,
      prunedCount: 0,
      retainedCount: 0,
      retainedApproxBytes: 0,
      failure: preparationAttempt,
      attempts: [preparationAttempt],
    };
  }

  const preparedRetention = retained as DailySessionSnapshotRetentionResult;
  const proactiveAttempts = isOperationalHeadroomLow()
    ? releaseAuxiliaryStorageForReview19()
    : [];
  const firstAttempt = attemptStorageOperation({
    key: STORAGE_KEYS.dailySessionSnapshots,
    operation: "set",
    run: () => saveDailySessionSnapshots(preparedRetention.snapshots),
  });
  const attempts: StorageOperationResult[] = [...proactiveAttempts, firstAttempt];

  if (firstAttempt.ok) {
    return {
      ok: true,
      quotaExceeded: false,
      retried: false,
      prunedCount: preparedRetention.prunedCount,
      retainedCount: preparedRetention.retainedCount,
      retainedApproxBytes: preparedRetention.retainedApproxBytes,
      failure: null,
      attempts,
    };
  }

  if (!firstAttempt.quotaExceeded) {
    return {
      ok: false,
      quotaExceeded: false,
      retried: false,
      prunedCount: preparedRetention.prunedCount,
      retainedCount: preparedRetention.retainedCount,
      retainedApproxBytes: preparedRetention.retainedApproxBytes,
      failure: firstAttempt,
      attempts,
    };
  }

  // Quota recovery removes only reconstructable navigation/checkpoint copies,
  // then retries once with the running business date's snapshots only.
  attempts.push(...releaseAuxiliaryStorageForReview19());
  const emergency = retainDailySessionSnapshotsWithinBudget(upserted, {
    protectedDates: [protectedDate],
    finalizedDates,
    maxRecords: 0,
    byteBudget: 0,
  });
  const retryAttempt = attemptStorageOperation({
    key: STORAGE_KEYS.dailySessionSnapshots,
    operation: "set",
    run: () => saveDailySessionSnapshots(emergency.snapshots),
  });
  attempts.push(retryAttempt);

  return {
    ok: retryAttempt.ok,
    quotaExceeded: true,
    retried: true,
    prunedCount: emergency.prunedCount,
    retainedCount: emergency.retainedCount,
    retainedApproxBytes: emergency.retainedApproxBytes,
    failure: retryAttempt.ok ? null : retryAttempt,
    attempts,
  };
}

/** Compatibility wrapper. Business-flow callers should inspect the safe result. */
export function upsertDailySessionSnapshot(snapshot: DailySessionSnapshot): void {
  const result = upsertDailySessionSnapshotSafely(snapshot);
  reportStorageOperationFailures("daily-session-snapshot", result.attempts);
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

  // A fully entered but not-yet-saved Review19 is authoritative in-progress
  // evidence. Preserve that exact session across midnight/deployment so the
  // user can retry the failed authoritative save without re-entry. This does
  // not infer values: every checkpoint must already be complete and the
  // Review19/session identities must agree.
  if (
    (state.screen === "review19" || state.screen === "review19_weather") &&
    state.review19 &&
    !state.review19.recordedAt &&
    state.review19.date === state.session.date &&
    state.review19.sessionStartedAt === state.session.startedAt &&
    buildReview19DataQuality({
      ...state.review19,
      areaEvaluations: state.review19.areaEvaluations ?? {},
    }).complete
  ) {
    return true;
  }

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
  const cleanupResults: StorageOperationResult[] = [];

  if (loaded.currentSession && !sanitized.currentSession) {
    cleanupResults.push(removeStorageKeySafely(STORAGE_KEYS.currentSession));
  }

  if (loaded.workSessionCheckpoint && !sanitized.workSessionCheckpoint) {
    cleanupResults.push(
      removeStorageKeySafely(STORAGE_KEYS.workSessionCheckpoint),
    );
  }

  if (loaded.runtimeState && !sanitized.runtimeState) {
    cleanupResults.push(removeStorageKeySafely(STORAGE_KEYS.runtimeState));
  }

  reportStorageOperationFailures("stale-session-cleanup", cleanupResults);

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
}

function buildPersistedAuxiliaryStateOperations(
  state: PersistedNebikiState,
): Array<{
    key: string;
    operation: "set" | "remove";
    run: () => void;
  }> {
  return [
    {
      key: STORAGE_KEYS.nextSessionSkipRecords,
      operation: "set",
      run: () => saveNextSessionSkipRecords(state.nextSessionSkipRecords),
    },
    state.lastSessionWeather
      ? {
          key: STORAGE_KEYS.lastSessionWeather,
          operation: "set",
          run: () => saveLastSessionWeather(state.lastSessionWeather!),
        }
      : {
          key: STORAGE_KEYS.lastSessionWeather,
          operation: "remove",
          run: clearLastSessionWeather,
        },
    state.lastUsedSessionDraft
      ? {
          key: STORAGE_KEYS.lastUsedSessionDraft,
          operation: "set",
          run: () => saveLastUsedSessionDraft(state.lastUsedSessionDraft!),
        }
      : {
          key: STORAGE_KEYS.lastUsedSessionDraft,
          operation: "remove",
          run: clearLastUsedSessionDraft,
        },
    {
      key: STORAGE_KEYS.dailyMessageState,
      operation: "set",
      run: () => saveDailyMessageState(state.dailyMessageState),
    },
  ];
}

export function savePersistedNebikiStateSafely(
  state: PersistedNebikiState,
): StorageOperationResult[] {
  const currentSessionOperation = state.currentSession
    ? {
        key: STORAGE_KEYS.currentSession,
        operation: "set" as const,
        run: () => saveCurrentSession(state.currentSession!),
      }
    : {
        key: STORAGE_KEYS.currentSession,
        operation: "remove" as const,
        run: clearCurrentSession,
      };

  return [
    attemptStorageOperation(currentSessionOperation),
    ...buildPersistedAuxiliaryStateOperations(state).map(attemptStorageOperation),
  ];
}

export function savePersistedNebikiStateWithAuxiliaryRecovery(
  state: PersistedNebikiState,
): StorageOperationResult[] {
  const proactiveAttempts = isOperationalHeadroomLow()
    ? releaseAuxiliaryStorageForReview19()
    : [];
  const currentSessionResult = attemptStorageOperation(
    state.currentSession
      ? {
          key: STORAGE_KEYS.currentSession,
          operation: "set",
          run: () => saveCurrentSession(state.currentSession!),
        }
      : {
          key: STORAGE_KEYS.currentSession,
          operation: "remove",
          run: clearCurrentSession,
        },
  );
  const results = [...proactiveAttempts, currentSessionResult];

  if (
    state.currentSession &&
    !currentSessionResult.ok &&
    currentSessionResult.quotaExceeded
  ) {
    // 完成recordとcloud outboxに続いてcurrent-sessionを優先し、
    // navigation/debug runtimeと重複checkpointだけを解放して1回再試行する。
    results.push(...releaseAuxiliaryStorageForReview19());
    results.push(
      attemptStorageOperation({
        key: STORAGE_KEYS.currentSession,
        operation: "set",
        run: () => saveCurrentSession(state.currentSession!),
      }),
    );
  }

  // 小さい補助設定はcurrent-sessionの保存可否を確定した後にだけ書く。
  results.push(
    ...buildPersistedAuxiliaryStateOperations(state).map(attemptStorageOperation),
  );
  return results;
}

export function saveWorkSessionCheckpointSafely(
  state: AppState,
): StorageOperationResult {
  if (isOperationalHeadroomLow()) {
    const removed = removeStorageKeySafely(STORAGE_KEYS.workSessionCheckpoint);
    return removed.ok
      ? { ok: true, key: STORAGE_KEYS.workSessionCheckpoint, operation: "set" }
      : removed;
  }
  return attemptStorageOperation({
    key: STORAGE_KEYS.workSessionCheckpoint,
    operation: "set",
    run: () => saveWorkSessionCheckpoint(state),
  });
}

export function saveRuntimeStateSafely(
  state: PersistedRuntimeState,
): StorageOperationResult {
  if (isOperationalHeadroomLow()) {
    const removed = removeStorageKeySafely(STORAGE_KEYS.runtimeState);
    return removed.ok
      ? { ok: true, key: STORAGE_KEYS.runtimeState, operation: "set" }
      : removed;
  }
  return attemptStorageOperation({
    key: STORAGE_KEYS.runtimeState,
    operation: "set",
    run: () => saveRuntimeState(state),
  });
}

/**
 * Review19正本の保存容量を確保するため、完全重複と確認できたlegacy
 * AreaCount mirror、finalized-dayへ封印済みのsnapshot、復元の補助情報だけを
 * 優先順に解放する。current-session、Review19履歴、cloud outbox、未封印の
 * snapshotには触れない。
 */
export function releaseAuxiliaryStorageForReview19(): StorageOperationResult[] {
  const legacy = releaseFullyCoveredLegacyAreaCountStorage();
  const daily = compactSealedDailySessionSnapshots();
  return [
    ...legacy.attempts,
    ...daily.attempts,
    attemptStorageOperation({
      key: STORAGE_KEYS.runtimeState,
      operation: "remove",
      run: clearRuntimeState,
    }),
    attemptStorageOperation({
      key: STORAGE_KEYS.workSessionCheckpoint,
      operation: "remove",
      run: clearWorkSessionCheckpoint,
    }),
  ];
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
