import { buildProductionAnalysis } from "../analysisMetadata.ts";
import { getNormalRoute } from "../area.ts";
import { normalizeDemandCycle } from "../demandCycle.ts";
import { FINALIZED_DAY_DATA_STORAGE_KEY } from "../finalizedDayData.ts";
import {
  normalizeLegacyReview19PendingPayload,
  normalizeReview19PendingReference,
} from "../review19CloudOutbox.ts";
import {
  reportStorageOperationFailures,
  STORAGE_KEYS,
  writeStorageJsonValueSafely,
  type StorageOperationResult,
} from "../storage.ts";
import { PENDING_SUPABASE_SYNC_STORAGE_KEY } from "../supabaseSyncQueue.ts";
import type {
  AreaId,
  DailySessionSnapshot,
  Review19DayCheckSnapshot,
} from "../types.ts";
import type { AreaCountRecord } from "../areaCountHistory.ts";

/**
 * 2026-08-25に作成された既知のdebug Review19 1件だけを除去する、
 * 2026.8.9-15限定のone-time maintenance。
 *
 * 汎用削除APIにはしない。次の通常releaseでこのmoduleとstartup呼び出しを
 * そのまま取り外せるよう、exact identityとall-zero guardをここへ閉じ込める。
 */
export const REVIEW19_DEBUG_20260825_TARGET = {
  date: "2026-08-25",
  demandCycle: "summer",
  sessionStartedAt: "2026-08-25T07:54:21.145Z",
  appVersion: "2026.8.9-12",
} as const;

export const REVIEW19_DEBUG_20260825_AREA_IDS = [
  "bento_men",
  "tempura",
  "ryomi",
  "croquette",
  "fry_chicken",
  "yakitori",
  "chuka_fish",
  "onigiri",
  "sushi",
  "futomaki_chumaki",
  "inari",
  "hosomaki",
] as const satisfies readonly AreaId[];

const REVIEW_SCREENS = new Set([
  "review19_weather",
  "review19",
  "review19_done",
]);

const REVIEW19_TARGET_CLOUD_IDENTITY = JSON.stringify([
  REVIEW19_DEBUG_20260825_TARGET.date,
  REVIEW19_DEBUG_20260825_TARGET.demandCycle,
]);

const MAINTENANCE_STORAGE_KEYS = {
  pending: PENDING_SUPABASE_SYNC_STORAGE_KEY,
  currentSession: STORAGE_KEYS.currentSession,
  workSessionCheckpoint: STORAGE_KEYS.workSessionCheckpoint,
  review19SourceState: STORAGE_KEYS.review19SourceState,
  runtimeState: STORAGE_KEYS.runtimeState,
  finalizedDayData: FINALIZED_DAY_DATA_STORAGE_KEY,
  review19Records: STORAGE_KEYS.review19Records,
} as const;

type MaintenanceStorageKey =
  (typeof MAINTENANCE_STORAGE_KEYS)[keyof typeof MAINTENANCE_STORAGE_KEYS];

type JsonObject = Record<string, unknown>;

export type Review19DebugCleanupCounts = {
  review19Records: number;
  pendingReferences: number;
  pendingLegacyPayloads: number;
  currentSession: number;
  workSessionCheckpoint: number;
  review19SourceState: number;
  runtimeNavigationStates: number;
  finalizedDayRecords: number;
};

export type Review19DebugCleanupResult = {
  ok: boolean;
  changed: boolean;
  removedCount: number;
  counts: Review19DebugCleanupCounts;
  writtenKeys: MaintenanceStorageKey[];
  writeResults: StorageOperationResult[];
  failureReason: "storage_unavailable" | "invalid_source" | "write_failed" | null;
  failedKey: MaintenanceStorageKey | null;
};

export type Review19DebugCleanupStorage = Pick<Storage, "getItem" | "setItem">;

function resolveMaintenanceStorage(
  options: { storage?: Review19DebugCleanupStorage | null },
): Review19DebugCleanupStorage | null {
  if (Object.prototype.hasOwnProperty.call(options, "storage")) {
    return options.storage ?? null;
  }
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Some privacy/security modes throw SecurityError while resolving the
    // Storage getter itself, before getItem/setItem can enter their boundary.
    return null;
  }
}

type PlannedSource = {
  key: MaintenanceStorageKey;
  raw: string | null;
  parsed: unknown;
};

type TransformResult = {
  value: unknown;
  removed: number;
  changed: boolean;
  blocked: boolean;
};

function emptyCounts(): Review19DebugCleanupCounts {
  return {
    review19Records: 0,
    pendingReferences: 0,
    pendingLegacyPayloads: 0,
    currentSession: 0,
    workSessionCheckpoint: 0,
    review19SourceState: 0,
    runtimeNavigationStates: 0,
    finalizedDayRecords: 0,
  };
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactAllZeroAreaCounts(value: unknown): boolean {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== REVIEW19_DEBUG_20260825_AREA_IDS.length) return false;
  return REVIEW19_DEBUG_20260825_AREA_IDS.every(
    (areaId) =>
      Object.prototype.hasOwnProperty.call(value, areaId) &&
      Number.isInteger(value[areaId]) &&
      value[areaId] === 0,
  );
}

/** Exact identity + recorded + appVersion + all 12 integer-zero guard. */
export function isReview19Debug20260825Target(value: unknown): boolean {
  return (
    isObject(value) &&
    value.date === REVIEW19_DEBUG_20260825_TARGET.date &&
    value.demandCycle === REVIEW19_DEBUG_20260825_TARGET.demandCycle &&
    value.sessionStartedAt ===
      REVIEW19_DEBUG_20260825_TARGET.sessionStartedAt &&
    value.appVersion === REVIEW19_DEBUG_20260825_TARGET.appVersion &&
    value.review19Status === "recorded" &&
    hasExactAllZeroAreaCounts(value.areaCounts)
  );
}

/** Prevent the still-remote debug row from being merged back before admin DELETE. */
export function excludeReview19Debug20260825Target<T>(
  records: readonly T[],
): T[] {
  return records.filter((record) => !isReview19Debug20260825Target(record));
}

function isTargetReview19DayCheck(
  value: unknown,
  parent: JsonObject,
): boolean {
  return (
    parent.date === REVIEW19_DEBUG_20260825_TARGET.date &&
    parent.demandCycle === REVIEW19_DEBUG_20260825_TARGET.demandCycle &&
    isObject(value) &&
    value.demandCycle === REVIEW19_DEBUG_20260825_TARGET.demandCycle &&
    value.sessionStartedAt ===
      REVIEW19_DEBUG_20260825_TARGET.sessionStartedAt &&
    value.appVersion === REVIEW19_DEBUG_20260825_TARGET.appVersion &&
    value.review19Status === "recorded" &&
    hasExactAllZeroAreaCounts(value.areaCounts)
  );
}

function isTargetPendingReference(value: unknown): boolean {
  const reference = normalizeReview19PendingReference(value);
  return Boolean(
    reference &&
      reference.date === REVIEW19_DEBUG_20260825_TARGET.date &&
      reference.demandCycle === REVIEW19_DEBUG_20260825_TARGET.demandCycle &&
      reference.sessionStartedAt ===
        REVIEW19_DEBUG_20260825_TARGET.sessionStartedAt,
  );
}

function transformReview19Records(value: unknown): TransformResult {
  if (!Array.isArray(value)) {
    return { value, removed: 0, changed: false, blocked: true };
  }
  const retained = value.filter(
    (candidate) => !isReview19Debug20260825Target(candidate),
  );
  const removed = value.length - retained.length;
  return {
    value: removed > 0 ? retained : value,
    removed,
    changed: removed > 0,
    blocked: false,
  };
}

function transformPendingQueue(value: unknown): TransformResult & {
  referenceRemoved: number;
  legacyRemoved: number;
} {
  if (!Array.isArray(value)) {
    return {
      value,
      removed: 0,
      changed: false,
      blocked: true,
      referenceRemoved: 0,
      legacyRemoved: 0,
    };
  }

  let referenceRemoved = 0;
  let legacyRemoved = 0;
  const retained = value.filter((candidate) => {
    if (!isObject(candidate) || candidate.type !== "review19") return true;
    if (candidate.identity !== REVIEW19_TARGET_CLOUD_IDENTITY) return true;

    if (isTargetPendingReference(candidate.payload)) {
      referenceRemoved += 1;
      return false;
    }

    const legacy = normalizeLegacyReview19PendingPayload(candidate.payload);
    if (legacy && isReview19Debug20260825Target(legacy)) {
      legacyRemoved += 1;
      return false;
    }
    return true;
  });
  const removed = referenceRemoved + legacyRemoved;
  return {
    value: removed > 0 ? retained : value,
    removed,
    changed: removed > 0,
    blocked: false,
    referenceRemoved,
    legacyRemoved,
  };
}

function transformAppState(value: unknown): TransformResult {
  if (value === null) {
    return { value, removed: 0, changed: false, blocked: false };
  }
  if (!isObject(value)) {
    return { value, removed: 0, changed: false, blocked: true };
  }
  if (!isReview19Debug20260825Target(value.review19)) {
    return { value, removed: 0, changed: false, blocked: false };
  }

  return {
    value: {
      ...value,
      review19: null,
      ...(typeof value.screen === "string" && REVIEW_SCREENS.has(value.screen)
        ? { screen: "start" }
        : {}),
    },
    removed: 1,
    changed: true,
    blocked: false,
  };
}

function transformNavigationSnapshot(value: unknown): TransformResult {
  if (!isObject(value)) {
    return { value, removed: 0, changed: false, blocked: false };
  }
  const state = transformAppState(value.state);
  if (state.blocked || !state.changed) {
    return { value, removed: 0, changed: false, blocked: state.blocked };
  }
  return {
    value: { ...value, state: state.value },
    removed: state.removed,
    changed: true,
    blocked: false,
  };
}

function transformRuntimeState(value: unknown): TransformResult {
  if (value === null) {
    return { value, removed: 0, changed: false, blocked: false };
  }
  if (!isObject(value)) {
    return { value, removed: 0, changed: false, blocked: true };
  }

  const undo = value.undoSnapshot === null || value.undoSnapshot === undefined
    ? { value: value.undoSnapshot, removed: 0, changed: false, blocked: false }
    : transformNavigationSnapshot(value.undoSnapshot);
  if (undo.blocked) {
    return { value, removed: 0, changed: false, blocked: true };
  }

  if (!Array.isArray(value.screenHistory)) {
    return { value, removed: 0, changed: false, blocked: true };
  }
  let historyRemoved = 0;
  let historyChanged = false;
  const history: unknown[] = [];
  for (const snapshot of value.screenHistory) {
    const transformed = transformNavigationSnapshot(snapshot);
    if (transformed.blocked) {
      return { value, removed: 0, changed: false, blocked: true };
    }
    history.push(transformed.value);
    historyRemoved += transformed.removed;
    historyChanged ||= transformed.changed;
  }

  const changed = undo.changed || historyChanged;
  return {
    value: changed
      ? {
          ...value,
          undoSnapshot: undo.value,
          screenHistory: history,
        }
      : value,
    removed: undo.removed + historyRemoved,
    changed,
    blocked: false,
  };
}

function rebuildFinalizedDayWithoutTargetReview19(
  value: JsonObject,
): JsonObject | null {
  if (
    value.date !== REVIEW19_DEBUG_20260825_TARGET.date ||
    value.demandCycle !== REVIEW19_DEBUG_20260825_TARGET.demandCycle ||
    !isTargetReview19DayCheck(value.review19Check, value) ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.areaCountRecords)
  ) {
    return null;
  }

  try {
    const productionAnalysis = buildProductionAnalysis({
      date: REVIEW19_DEBUG_20260825_TARGET.date,
      demandCycle: normalizeDemandCycle(value.demandCycle),
      areaIds: getNormalRoute(REVIEW19_DEBUG_20260825_TARGET.date),
      areaCountRecords: value.areaCountRecords as AreaCountRecord[],
      sessions: value.sessions as DailySessionSnapshot[],
      review19Check: undefined,
    });
    const next: JsonObject = {
      ...value,
      review19Status: "not_performed",
      productionAnalysis,
    };
    delete next.review19Check;
    return next;
  } catch {
    return null;
  }
}

function transformFinalizedDayData(value: unknown): TransformResult {
  if (!Array.isArray(value)) {
    return { value, removed: 0, changed: false, blocked: true };
  }

  let removed = 0;
  let blocked = false;
  const records = value.map((candidate) => {
    if (!isObject(candidate)) return candidate;
    const review19Check = candidate.review19Check as
      | Review19DayCheckSnapshot
      | undefined;
    if (!isTargetReview19DayCheck(review19Check, candidate)) return candidate;
    const rebuilt = rebuildFinalizedDayWithoutTargetReview19(candidate);
    if (!rebuilt) {
      blocked = true;
      return candidate;
    }
    removed += 1;
    return rebuilt;
  });

  return {
    value: removed > 0 ? records : value,
    removed,
    changed: removed > 0,
    blocked,
  };
}

function parseSource(
  storage: Review19DebugCleanupStorage,
  key: MaintenanceStorageKey,
): PlannedSource | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { key, raw, parsed: null };
    return { key, raw, parsed: JSON.parse(raw) as unknown };
  } catch {
    return null;
  }
}

function invalidResult(
  failureReason: Review19DebugCleanupResult["failureReason"],
  failedKey: MaintenanceStorageKey | null,
): Review19DebugCleanupResult {
  return {
    ok: false,
    changed: false,
    removedCount: 0,
    counts: emptyCounts(),
    writtenKeys: [],
    writeResults: [],
    failureReason,
    failedKey,
  };
}

/**
 * Runs before any cloud retry/backfill. Every source is parsed and transformed
 * before the first write; malformed/unsafe input aborts the maintenance.
 * Writes only shrink/remove the exact target and use the shared exception
 * boundary so a DOMException never escapes into React.
 */
export function cleanupReview19Debug20260825(
  options: { storage?: Review19DebugCleanupStorage | null } = {},
): Review19DebugCleanupResult {
  const storage = resolveMaintenanceStorage(options);
  if (!storage) return invalidResult("storage_unavailable", null);

  const sources = Object.values(MAINTENANCE_STORAGE_KEYS).map((key) =>
    parseSource(storage, key),
  );
  const failedSourceIndex = sources.findIndex((source) => source === null);
  if (failedSourceIndex >= 0) {
    return invalidResult(
      "invalid_source",
      Object.values(MAINTENANCE_STORAGE_KEYS)[failedSourceIndex] ?? null,
    );
  }
  const parsedByKey = new Map(
    (sources as PlannedSource[]).map((source) => [source.key, source]),
  );

  const review19RecordsSource = parsedByKey.get(
    MAINTENANCE_STORAGE_KEYS.review19Records,
  )!;
  const pendingSource = parsedByKey.get(MAINTENANCE_STORAGE_KEYS.pending)!;
  const currentSource = parsedByKey.get(
    MAINTENANCE_STORAGE_KEYS.currentSession,
  )!;
  const checkpointSource = parsedByKey.get(
    MAINTENANCE_STORAGE_KEYS.workSessionCheckpoint,
  )!;
  const review19Source = parsedByKey.get(
    MAINTENANCE_STORAGE_KEYS.review19SourceState,
  )!;
  const runtimeSource = parsedByKey.get(
    MAINTENANCE_STORAGE_KEYS.runtimeState,
  )!;
  const finalizedSource = parsedByKey.get(
    MAINTENANCE_STORAGE_KEYS.finalizedDayData,
  )!;

  const review19Records = review19RecordsSource.raw === null
    ? { value: null, removed: 0, changed: false, blocked: false }
    : transformReview19Records(review19RecordsSource.parsed);
  const pending = pendingSource.raw === null
    ? {
        value: null,
        removed: 0,
        changed: false,
        blocked: false,
        referenceRemoved: 0,
        legacyRemoved: 0,
      }
    : transformPendingQueue(pendingSource.parsed);
  const current = currentSource.raw === null
    ? { value: null, removed: 0, changed: false, blocked: false }
    : transformAppState(currentSource.parsed);
  const checkpoint = checkpointSource.raw === null
    ? { value: null, removed: 0, changed: false, blocked: false }
    : transformAppState(checkpointSource.parsed);
  const review19State = review19Source.raw === null
    ? { value: null, removed: 0, changed: false, blocked: false }
    : transformAppState(review19Source.parsed);
  const runtime = runtimeSource.raw === null
    ? { value: null, removed: 0, changed: false, blocked: false }
    : transformRuntimeState(runtimeSource.parsed);
  const finalized = finalizedSource.raw === null
    ? { value: null, removed: 0, changed: false, blocked: false }
    : transformFinalizedDayData(finalizedSource.parsed);

  const transforms = [
    review19Records,
    pending,
    current,
    checkpoint,
    review19State,
    runtime,
    finalized,
  ];
  if (transforms.some((transform) => transform.blocked)) {
    return invalidResult("invalid_source", null);
  }

  const counts: Review19DebugCleanupCounts = {
    review19Records: review19Records.removed,
    pendingReferences: pending.referenceRemoved,
    pendingLegacyPayloads: pending.legacyRemoved,
    currentSession: current.removed,
    workSessionCheckpoint: checkpoint.removed,
    review19SourceState: review19State.removed,
    runtimeNavigationStates: runtime.removed,
    finalizedDayRecords: finalized.removed,
  };
  const removedCount = Object.values(counts).reduce(
    (total, count) => total + count,
    0,
  );
  if (removedCount === 0) {
    return {
      ok: true,
      changed: false,
      removedCount: 0,
      counts,
      writtenKeys: [],
      writeResults: [],
      failureReason: null,
      failedKey: null,
    };
  }

  // Pending and alternate Review19 sources are neutralized before the local
  // authoritative array, so startup retry cannot re-send the target between
  // maintenance and React effects. The operation is synchronous and idempotent.
  const writes: Array<{ key: MaintenanceStorageKey; transform: TransformResult }> = [
    { key: MAINTENANCE_STORAGE_KEYS.pending, transform: pending },
    { key: MAINTENANCE_STORAGE_KEYS.currentSession, transform: current },
    { key: MAINTENANCE_STORAGE_KEYS.workSessionCheckpoint, transform: checkpoint },
    { key: MAINTENANCE_STORAGE_KEYS.review19SourceState, transform: review19State },
    { key: MAINTENANCE_STORAGE_KEYS.runtimeState, transform: runtime },
    { key: MAINTENANCE_STORAGE_KEYS.finalizedDayData, transform: finalized },
    { key: MAINTENANCE_STORAGE_KEYS.review19Records, transform: review19Records },
  ];
  const writeResults: StorageOperationResult[] = [];
  const writtenKeys: MaintenanceStorageKey[] = [];
  for (const { key, transform } of writes) {
    if (!transform.changed) continue;
    const result = writeStorageJsonValueSafely({
      storage,
      key,
      value: transform.value,
    });
    writeResults.push(result);
    if (!result.ok) {
      reportStorageOperationFailures("review19-debug-20260825-cleanup", writeResults);
      return {
        ok: false,
        changed: writtenKeys.length > 0,
        removedCount,
        counts,
        writtenKeys,
        writeResults,
        failureReason: "write_failed",
        failedKey: key,
      };
    }
    writtenKeys.push(key);
  }

  return {
    ok: true,
    changed: true,
    removedCount,
    counts,
    writtenKeys,
    writeResults,
    failureReason: null,
    failedKey: null,
  };
}
