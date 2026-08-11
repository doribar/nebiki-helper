import {
  getAreaCountRecordIdentity,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "./areaCountHistory.ts";
import { upsertLocalAreaCountRecord } from "./areaCountLocalStorage.ts";
import { upsertRemoteAreaCountRecord } from "./areaCountRemoteStorage.ts";
import { normalizeDemandCycle } from "./demandCycle.ts";
import {
  getReview19SourceUpdatedAt,
  normalizeReview19Result,
} from "./review19.ts";
import { upsertRemoteReview19Record } from "./review19RemoteStorage.ts";
import {
  enqueuePendingSupabaseSync,
  flushPendingSupabaseSyncQueue,
  loadPendingSupabaseSyncQueue,
  type FlushPendingSupabaseSyncResult,
  type PendingSupabaseSyncItem,
} from "./supabaseSyncQueue.ts";
import type { Review19Result } from "./types.ts";

export type CloudSyncStatus = {
  pendingCount: number;
  areaCountPendingCount: number;
  review19PendingCount: number;
};

export function getReview19CloudIdentity(
  record: Pick<Review19Result, "date" | "demandCycle">,
): string {
  return JSON.stringify([record.date, normalizeDemandCycle(record.demandCycle)]);
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

function isReview19Final(record: Review19Result): boolean {
  return (
    typeof record.recordedAt === "string" &&
    Number.isFinite(Date.parse(record.recordedAt))
  );
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
  if (
    getReview19CloudIdentity(normalizedCurrent) !==
    getReview19CloudIdentity(normalizedIncoming)
  ) {
    return false;
  }

  const currentFinal = isReview19Final(normalizedCurrent);
  const incomingFinal = isReview19Final(normalizedIncoming);
  if (currentFinal && !incomingFinal) return false;

  const currentUpdatedAt = Date.parse(
    getReview19SourceUpdatedAt(normalizedCurrent) ?? "",
  );
  const incomingUpdatedAt = Date.parse(
    getReview19SourceUpdatedAt(normalizedIncoming) ?? "",
  );
  if (!Number.isFinite(incomingUpdatedAt)) return false;
  if (!Number.isFinite(currentUpdatedAt)) return true;
  return incomingUpdatedAt > currentUpdatedAt;
}

export function enqueueReview19RecordForCloud(record: Review19Result): boolean {
  const normalized = normalizeReview19Result(record);
  if (!normalized || normalized.review19Status !== "recorded") return false;
  const identity = getReview19CloudIdentity(normalized);
  const currentItem = loadPendingSupabaseSyncQueue().find(
    (item) => item.type === "review19" && item.identity === identity,
  );
  if (currentItem) {
    const currentRecord = normalizeQueuedReview19(currentItem);
    if (
      currentRecord &&
      !shouldReplaceQueuedReview19Record(currentRecord, normalized)
    ) {
      return false;
    }
  }
  enqueuePendingSupabaseSync({
    type: "review19",
    identity,
    payload: normalized,
  });
  return true;
}

function normalizeQueuedAreaCount(item: PendingSupabaseSyncItem): AreaCountRecord | null {
  const [record] = normalizeAreaCountRecords([item.payload]);
  if (!record || getAreaCountRecordIdentity(record) !== item.identity) return null;
  return record;
}

function normalizeQueuedReview19(item: PendingSupabaseSyncItem): Review19Result | null {
  const record = normalizeReview19Result(
    item.payload as Partial<Review19Result> | null | undefined,
  );
  if (
    !record ||
    record.review19Status !== "recorded" ||
    getReview19CloudIdentity(record) !== item.identity
  ) {
    return null;
  }
  return record;
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

  const record = normalizeQueuedReview19(item);
  if (!record) return { ok: false, error: "invalid review19 payload" };
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
