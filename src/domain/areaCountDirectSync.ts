import {
  cloneAreaCountRecords,
  getAreaCountRecordIdentity,
  mergeAreaCountRecordCollections,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "./areaCountHistory.ts";
import { isAreaCountRecordCoveredByRemote } from "./areaCountCache.ts";
import {
  upsertRemoteAreaCountRecords,
  type RemoteAreaCountSaveResult,
} from "./areaCountRemoteStorage.ts";

/**
 * A direct backfill request deliberately stays below the remote read page size
 * and keeps each JSON request bounded. This is an in-memory/network bound only;
 * no batch is materialized in the localStorage outbox.
 */
export const AREA_COUNT_DIRECT_SYNC_BATCH_SIZE = 100;

export type DirectAreaCountUploader = (
  records: readonly AreaCountRecord[],
) => Promise<RemoteAreaCountSaveResult>;

export type DirectAreaCountRecordStatus =
  | "remote_covered"
  | "pending_queued"
  | "uploaded"
  | "failed"
  | "deferred";

export type DirectAreaCountRecordResult = {
  identity: string;
  status: DirectAreaCountRecordStatus;
  batchIndex?: number;
  error?: string;
};

export type DirectAreaCountBatchResult = {
  batchIndex: number;
  attemptedCount: number;
  succeededCount: number;
  failedCount: number;
  status: RemoteAreaCountSaveResult["status"];
  identities: string[];
  message?: string;
};

export type DirectAreaCountSyncResult = {
  /** Number of raw source entries offered by the caller. */
  detectedCount: number;
  /** Number remaining after normalisation and business-identity dedupe. */
  canonicalCount: number;
  /** Known remote revisions that already fully cover their local source. */
  remoteCoveredCount: number;
  /** Existing legacy/normal pending is retried by the queue path, not duplicated. */
  pendingCoveredCount: number;
  /** Canonical records requiring a direct upload after safe skips. */
  targetCount: number;
  attemptedCount: number;
  succeededCount: number;
  failedCount: number;
  /** Targets not attempted after the first failed batch. */
  deferredCount: number;
  batchSize: number;
  batches: DirectAreaCountBatchResult[];
  records: DirectAreaCountRecordResult[];
  /** Transient successes for in-memory remote-confirmed history; never persist here. */
  sentRecords: AreaCountRecord[];
  failureMessage?: string;
};

export type DirectAreaCountSyncOptions = {
  uploader?: DirectAreaCountUploader;
  /** Optional already-loaded remote history. No extra local cache is created. */
  knownRemoteRecords?: readonly AreaCountRecord[];
  /** Existing queue identities stay owned by the legacy queue/CAS path. */
  pendingIdentities?: ReadonlySet<string>;
  /** Values above the fixed safety ceiling are clamped. */
  batchSize?: number;
};

function resolveBatchSize(requested?: number): number {
  if (!Number.isFinite(requested)) return AREA_COUNT_DIRECT_SYNC_BATCH_SIZE;
  return Math.max(
    1,
    Math.min(AREA_COUNT_DIRECT_SYNC_BATCH_SIZE, Math.floor(requested!)),
  );
}

function errorMessage(result: RemoteAreaCountSaveResult): string | undefined {
  if (result.status === "saved") return undefined;
  return result.status === "disabled"
    ? "Supabase configuration is unavailable"
    : result.message;
}

/**
 * Sends authoritative local AreaCount sources directly to Supabase in bounded
 * batches. It never writes pending/localStorage and never mutates its inputs.
 * Failed sources therefore remain discoverable from the caller's authoritative
 * local collection and can be safely retried by a later manual sync.
 */
export async function syncAuthoritativeAreaCountRecordsDirectly(
  sourceRecords: readonly AreaCountRecord[],
  options: DirectAreaCountSyncOptions = {},
): Promise<DirectAreaCountSyncResult> {
  const canonical = mergeAreaCountRecordCollections(
    normalizeAreaCountRecords(sourceRecords),
  );
  const remoteByIdentity = new Map<string, AreaCountRecord>();
  for (const remote of mergeAreaCountRecordCollections(
    normalizeAreaCountRecords(options.knownRemoteRecords ?? []),
  )) {
    remoteByIdentity.set(getAreaCountRecordIdentity(remote), remote);
  }

  const records: DirectAreaCountRecordResult[] = [];
  const candidates: AreaCountRecord[] = [];
  for (const local of canonical) {
    const identity = getAreaCountRecordIdentity(local);
    if (options.pendingIdentities?.has(identity)) {
      records.push({ identity, status: "pending_queued" });
      continue;
    }
    const remote = remoteByIdentity.get(identity);
    if (remote && isAreaCountRecordCoveredByRemote({ local, remote })) {
      records.push({ identity, status: "remote_covered" });
    } else {
      candidates.push(local);
    }
  }

  const batchSize = resolveBatchSize(options.batchSize);
  const uploader = options.uploader ?? upsertRemoteAreaCountRecords;
  const batches: DirectAreaCountBatchResult[] = [];
  const sentRecords: AreaCountRecord[] = [];
  let failureMessage: string | undefined;

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batchIndex = batches.length;
    const batch = candidates.slice(offset, offset + batchSize);
    const identities = batch.map(getAreaCountRecordIdentity);
    let result: RemoteAreaCountSaveResult;
    try {
      result = await uploader(batch);
    } catch (error) {
      result = {
        status: "error",
        errorKind: "network",
        message: error instanceof Error ? error.message : "unknown error",
      };
    }

    const succeeded = result.status === "saved";
    const message = errorMessage(result);
    const succeededCount = succeeded ? batch.length : 0;
    const failedCount = succeeded ? 0 : batch.length;
    batches.push({
      batchIndex,
      attemptedCount: batch.length,
      succeededCount,
      failedCount,
      status: result.status,
      identities,
      ...(message ? { message } : {}),
    });
    records.push(
      ...identities.map((identity): DirectAreaCountRecordResult => ({
        identity,
        status: succeeded ? "uploaded" : "failed",
        batchIndex,
        ...(message ? { error: message } : {}),
      })),
    );
    if (succeeded) {
      sentRecords.push(...batch);
      continue;
    }

    // A failed network/config/schema batch is a strong signal that immediately
    // retrying every remaining backfill batch would only hammer the same
    // endpoint. Keep the untouched local sources discoverable for the next
    // manual run instead of materialising them as rich pending payloads.
    failureMessage = message;
    for (const deferred of candidates.slice(offset + batch.length)) {
      records.push({
        identity: getAreaCountRecordIdentity(deferred),
        status: "deferred",
      });
    }
    break;
  }

  const remoteCoveredCount = records.filter(
    (record) => record.status === "remote_covered",
  ).length;
  const succeededCount = records.filter(
    (record) => record.status === "uploaded",
  ).length;
  const failedCount = records.filter(
    (record) => record.status === "failed",
  ).length;
  const pendingCoveredCount = records.filter(
    (record) => record.status === "pending_queued",
  ).length;
  const deferredCount = records.filter(
    (record) => record.status === "deferred",
  ).length;

  return {
    detectedCount: sourceRecords.length,
    canonicalCount: canonical.length,
    remoteCoveredCount,
    pendingCoveredCount,
    targetCount: candidates.length,
    attemptedCount: succeededCount + failedCount,
    succeededCount,
    failedCount,
    deferredCount,
    batchSize,
    batches,
    records,
    sentRecords: cloneAreaCountRecords(sentRecords),
    ...(failureMessage ? { failureMessage } : {}),
  };
}
