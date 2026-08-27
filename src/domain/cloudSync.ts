import {
  getAreaCountRecordIdentity,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "./areaCountHistory.ts";
import {
  AREA_COUNT_LOCAL_STORAGE_KEY,
  saveUnifiedAreaCountRecords,
  upsertLocalAreaCountRecord,
} from "./areaCountLocalStorage.ts";
import { upsertRemoteAreaCountRecord } from "./areaCountRemoteStorage.ts";
import { normalizeReview19Result } from "./review19.ts";
import {
  buildReview19PendingReference,
  getReview19PendingBusinessIdentity,
  isReview19PendingPayloadCoveredByRecord,
  normalizeLegacyReview19PendingPayload,
  normalizeReview19PendingReference,
  resolveReview19PendingReference,
  shouldReplaceReview19PendingPayload,
} from "./review19CloudOutbox.ts";
import {
  mergeReview19MedianHistory,
  upsertRemoteReview19Record,
  upsertRemoteReview19Records,
  type RemoteReview19SaveResult,
} from "./review19RemoteStorage.ts";
import {
  enqueuePendingSupabaseSync,
  flushPendingSupabaseSyncQueue,
  loadPendingSupabaseSyncQueue,
  PENDING_SUPABASE_SYNC_STORAGE_KEY,
  savePendingSupabaseSyncQueue,
  type FlushPendingSupabaseSyncResult,
  type PendingSupabaseSyncItem,
  type SupabaseSyncQueueStorage,
} from "./supabaseSyncQueue.ts";
import {
  attemptStorageOperationWithAuxiliaryRecovery,
  loadCurrentSession,
  loadReview19Records,
  loadReview19SourceState,
  loadWorkSessionCheckpoint,
  reportStorageOperationFailures,
  type StorageOperationResult,
} from "./storage.ts";
import type { Review19Result } from "./types.ts";

export type CloudSyncStatus = {
  pendingCount: number;
  areaCountPendingCount: number;
  review19PendingCount: number;
};

export type AreaCountLocalFirstStorageResult = {
  localSaved: boolean;
  cloudQueuePrepared: boolean;
  records: AreaCountRecord[];
  localAttempts: StorageOperationResult[];
  cloudQueueAttempts: StorageOperationResult[];
};

export function getReview19CloudIdentity(
  record: Pick<Review19Result, "date" | "demandCycle">,
): string {
  return getReview19PendingBusinessIdentity(record);
}

export function getCloudSyncStatus(): CloudSyncStatus {
  const pending = loadPendingSupabaseSyncQueue();
  return {
    pendingCount: pending.length,
    areaCountPendingCount: pending.filter((item) => item.type === "area_count").length,
    review19PendingCount: pending.filter((item) => item.type === "review19").length,
  };
}

/**
 * 端末の正式cacheを先に更新してからoutboxへ積む。remote I/Oは行わない。
 */
export function persistAreaCountRecordLocalFirst(
  record: AreaCountRecord,
): AreaCountRecord[] {
  const [normalized] = normalizeAreaCountRecords([record]);
  if (!normalized) return [];
  const nextLocalRecords = upsertLocalAreaCountRecord(normalized);
  const identity = getAreaCountRecordIdentity(normalized);
  const canonicalRecord = nextLocalRecords.find(
    (candidate) => getAreaCountRecordIdentity(candidate) === identity,
  );
  if (!canonicalRecord) return nextLocalRecords;
  enqueuePendingSupabaseSync({
    type: "area_count",
    identity,
    payload: canonicalRecord,
  });
  return nextLocalRecords;
}

/**
 * AreaCount正本とcloud outboxを別々に確定し、どちらの失敗かを保持する。
 * Quota時は再構築可能なruntime/checkpointだけを解放して各段階を1回再試行する。
 */
export function persistAreaCountRecordLocalFirstSafely(
  record: AreaCountRecord,
): AreaCountLocalFirstStorageResult {
  const [normalized] = normalizeAreaCountRecords([record]);
  if (!normalized) {
    return {
      localSaved: false,
      cloudQueuePrepared: false,
      records: [],
      localAttempts: [],
      cloudQueueAttempts: [],
    };
  }

  let records: AreaCountRecord[] = [];
  const local = attemptStorageOperationWithAuxiliaryRecovery({
    key: AREA_COUNT_LOCAL_STORAGE_KEY,
    operation: "set",
    run: () => {
      records = saveUnifiedAreaCountRecords([normalized]);
    },
  });
  reportStorageOperationFailures("area-count-local-save", local.attempts);
  if (!local.ok) {
    return {
      localSaved: false,
      cloudQueuePrepared: false,
      records,
      localAttempts: local.attempts,
      cloudQueueAttempts: [],
    };
  }

  // The legacy summer mirror is read/import-only from 9-12 onward. Rewriting
  // the complete summer population here duplicated the authoritative v2 data
  // and could exhaust the origin's localStorage quota.
  const localAttempts = [...local.attempts];

  const identity = getAreaCountRecordIdentity(normalized);
  const canonicalRecord = records.find(
    (candidate) => getAreaCountRecordIdentity(candidate) === identity,
  );
  if (!canonicalRecord) {
    return {
      localSaved: true,
      cloudQueuePrepared: false,
      records,
      localAttempts,
      cloudQueueAttempts: [],
    };
  }

  const cloudQueue = attemptStorageOperationWithAuxiliaryRecovery({
    key: PENDING_SUPABASE_SYNC_STORAGE_KEY,
    operation: "set",
    run: () => {
      enqueuePendingSupabaseSync({
        type: "area_count",
        identity,
        payload: canonicalRecord,
      });
    },
  });
  reportStorageOperationFailures("area-count-cloud-enqueue", cloudQueue.attempts);
  return {
    localSaved: true,
    cloudQueuePrepared: cloudQueue.ok,
    records,
    localAttempts,
    cloudQueueAttempts: cloudQueue.attempts,
  };
}

export function enqueueAreaCountRecordsForCloud(
  records: readonly AreaCountRecord[],
): number {
  let count = 0;
  for (const record of normalizeAreaCountRecords(records)) {
    enqueuePendingSupabaseSync({
      type: "area_count",
      identity: getAreaCountRecordIdentity(record),
      payload: record,
    });
    count += 1;
  }
  return count;
}

/**
 * Same-key Review19 outbox revisions are strictly monotonic. A final payload
 * never regresses to a partial payload, and equal timestamps are idempotent
 * retries rather than a proven newer mutation.
 */
export function shouldReplaceQueuedReview19Record(
  current: Review19Result,
  incoming: Review19Result,
): boolean {
  const normalizedCurrent = normalizeReview19Result(current);
  const normalizedIncoming = normalizeReview19Result(incoming);
  if (!normalizedCurrent || !normalizedIncoming) return false;
  return shouldReplaceReview19PendingPayload(
    normalizedCurrent,
    normalizedIncoming,
  );
}

export function enqueueReview19RecordForCloud(record: Review19Result): boolean {
  const normalized = normalizeReview19Result(record);
  if (!normalized || normalized.review19Status !== "recorded") return false;
  const identity = getReview19CloudIdentity(normalized);
  const reference = buildReview19PendingReference(normalized);
  if (!reference) return false;
  const currentItem = loadPendingSupabaseSyncQueue().find(
    (item) => item.type === "review19" && item.identity === identity,
  );
  if (
    currentItem &&
    !shouldReplaceReview19PendingPayload(currentItem.payload, normalized)
  ) {
    return false;
  }
  enqueuePendingSupabaseSync({
    type: "review19",
    identity,
    payload: reference,
  });
  return true;
}

function normalizeQueuedAreaCount(item: PendingSupabaseSyncItem): AreaCountRecord | null {
  const [record] = normalizeAreaCountRecords([item.payload]);
  if (!record || getAreaCountRecordIdentity(record) !== item.identity) return null;
  return record;
}

function normalizeLegacyQueuedReview19(
  item: PendingSupabaseSyncItem,
): Review19Result | null {
  const record = normalizeLegacyReview19PendingPayload(item.payload);
  if (
    !record ||
    getReview19CloudIdentity(record) !== item.identity
  ) {
    return null;
  }
  return record;
}

function loadDefaultReview19PendingSources(): Review19Result[] {
  const current = loadCurrentSession()?.review19;
  const checkpoint = loadWorkSessionCheckpoint()?.review19;
  const review19Source = loadReview19SourceState()?.review19;
  return [
    ...loadReview19Records(),
    ...(current ? [current] : []),
    ...(checkpoint ? [checkpoint] : []),
    ...(review19Source ? [review19Source] : []),
  ];
}

/** Resolves both legacy self-contained payloads and lightweight references. */
export function resolveQueuedReview19Record(
  item: PendingSupabaseSyncItem,
  sources?: readonly Review19Result[],
): Review19Result | null {
  if (item.type !== "review19") return null;
  const legacy = normalizeLegacyQueuedReview19(item);
  const availableSources = sources ?? loadDefaultReview19PendingSources();
  if (legacy) {
    // Legacy entries remain self-contained, but a local authoritative final or
    // a newer same-business revision must win when it safely covers that old
    // payload. This prevents retrying a stale partial after the final record
    // has already been committed locally. The legacy payload itself remains a
    // fallback, so old queues stay sendable even when no local source survives.
    const legacyReference = buildReview19PendingReference(legacy);
    return legacyReference
      ? resolveReview19PendingReference(legacyReference, [
          legacy,
          ...availableSources,
        ]) ?? legacy
      : legacy;
  }

  const reference = normalizeReview19PendingReference(item.payload);
  if (
    !reference ||
    getReview19PendingBusinessIdentity(reference) !== item.identity
  ) {
    return null;
  }
  return resolveReview19PendingReference(
    reference,
    availableSources,
  );
}

export type DirectReview19CloudSyncResult = {
  attemptedCount: number;
  succeededCount: number;
  failedCount: number;
  status: RemoteReview19SaveResult["status"];
  message?: string;
  /** Transient canonical records for revision-aware queue cleanup; do not persist. */
  sentRecords: Review19Result[];
};

export type DirectReview19Uploader = (
  records: readonly Review19Result[],
) => Promise<RemoteReview19SaveResult>;

/**
 * Uploads complete final local Review19 records without first materializing a
 * second rich copy in the outbox. Supabase's existing unique key/CAS/merge
 * remains the authority for idempotent retries and already-existing rows.
 */
export async function syncAuthoritativeReview19RecordsDirectly(
  records: readonly Review19Result[],
  uploader: DirectReview19Uploader = upsertRemoteReview19Records,
): Promise<DirectReview19CloudSyncResult> {
  const canonicalRecords = mergeReview19MedianHistory({
    localRecords: records,
    remoteRecords: [],
  });
  if (canonicalRecords.length === 0) {
    return {
      attemptedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      status: "saved",
      sentRecords: [],
    };
  }

  let result: RemoteReview19SaveResult;
  try {
    result = await uploader(canonicalRecords);
  } catch (error) {
    return {
      attemptedCount: canonicalRecords.length,
      succeededCount: 0,
      failedCount: canonicalRecords.length,
      status: "error",
      message: error instanceof Error ? error.message : "unknown error",
      sentRecords: [],
    };
  }
  if (result.status === "saved") {
    return {
      attemptedCount: canonicalRecords.length,
      succeededCount: canonicalRecords.length,
      failedCount: 0,
      status: "saved",
      sentRecords: canonicalRecords,
    };
  }
  return {
    attemptedCount: canonicalRecords.length,
    succeededCount: 0,
    failedCount: canonicalRecords.length,
    status: result.status,
    message:
      result.status === "disabled"
        ? "Supabase configuration is unavailable"
        : result.message,
    sentRecords: [],
  };
}

export type Review19PendingCleanupResult = {
  removedCount: number;
  retainedCount: number;
};

/**
 * Removes only revisions proven to be covered by a successful direct upload.
 * A newer, malformed, or otherwise unproven pending item is retained.
 */
export function removeReview19PendingItemsCoveredByRecords(
  sentRecords: readonly Review19Result[],
  options: { storage?: SupabaseSyncQueueStorage | null } = {},
): Review19PendingCleanupResult {
  const queue = loadPendingSupabaseSyncQueue(options);
  const sentByIdentity = new Map<string, Review19Result[]>();
  for (const candidate of sentRecords) {
    const normalized = normalizeReview19Result(candidate);
    if (!normalized || normalized.review19Status !== "recorded") continue;
    const identity = getReview19CloudIdentity(normalized);
    sentByIdentity.set(identity, [
      ...(sentByIdentity.get(identity) ?? []),
      normalized,
    ]);
  }

  const retained = queue.filter((item) => {
    if (item.type !== "review19") return true;
    const sentCandidates = sentByIdentity.get(item.identity) ?? [];
    return !sentCandidates.some((record) =>
      isReview19PendingPayloadCoveredByRecord(item.payload, record)
    );
  });
  const removedCount = queue.length - retained.length;
  if (removedCount > 0) savePendingSupabaseSyncQueue(retained, options);
  return { removedCount, retainedCount: retained.length };
}

export async function sendPendingSupabaseSyncItem(
  item: PendingSupabaseSyncItem,
): Promise<{ ok: boolean; error?: string }> {
  if (item.type === "area_count") {
    const record = normalizeQueuedAreaCount(item);
    if (!record) return { ok: false, error: "invalid area_count payload" };
    const result = await upsertRemoteAreaCountRecord(record);
    return result.status === "saved"
      ? { ok: true }
      : {
          ok: false,
          error:
            result.status === "disabled"
              ? "Supabase configuration is unavailable"
              : result.message,
        };
  }

  const record = resolveQueuedReview19Record(item);
  if (!record) {
    return {
      ok: false,
      error: normalizeReview19PendingReference(item.payload)
        ? "Review19 local source is unavailable"
        : "invalid review19 payload",
    };
  }
  const result = await upsertRemoteReview19Record(record);
  return result.status === "saved"
    ? { ok: true }
    : {
        ok: false,
        error:
          result.status === "disabled"
            ? "Supabase configuration is unavailable"
            : result.message,
      };
}

export function flushCloudSyncQueue(): Promise<FlushPendingSupabaseSyncResult> {
  return flushPendingSupabaseSyncQueue({ sender: sendPendingSupabaseSyncItem });
}
