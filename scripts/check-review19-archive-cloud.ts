import assert from "node:assert/strict";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  getReview19CloudIdentity,
  sendPendingSupabaseSyncItem,
} from "../src/domain/cloudSync.ts";
import { createInitialReview19Result } from "../src/domain/review19.ts";
import { buildReview19PendingReference } from "../src/domain/review19CloudOutbox.ts";
import {
  persistCompletedReview19LocalFirstAsync,
} from "../src/domain/review19CompletionStorage.ts";
import type { PendingSupabaseSyncItem } from "../src/domain/supabaseSyncQueue.ts";
import type { Review19Result } from "../src/domain/types.ts";
import type { StorageOperationResult } from "../src/domain/storage.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new MemoryStorage(),
});

function success(key = "nebiki-helper-history/review19"): StorageOperationResult {
  return { ok: true, key, operation: "set" };
}

function quotaFailure(): StorageOperationResult {
  return {
    ok: false,
    key: "nebiki-helper-history/review19",
    operation: "set",
    errorName: "QuotaExceededError",
    quotaExceeded: true,
  };
}

function makeReview(params: {
  sessionStartedAt?: string;
  sourceUpdatedAt?: string;
} = {}): Review19Result {
  const date = "2026-08-29";
  const sourceUpdatedAt = params.sourceUpdatedAt ?? "2026-08-29T10:10:00.000Z";
  const initial = createInitialReview19Result({
    date,
    demandCycle: "summer",
    sessionStartedAt: params.sessionStartedAt ?? "2026-08-29T09:00:00.000Z",
    excludedAreaIds: [...NORMAL_ROUTE],
  });
  return {
    ...initial,
    sourceUpdatedAt,
    reviewCompletedAt: sourceUpdatedAt,
    recordedAt: sourceUpdatedAt,
  };
}

function pending(record: Review19Result, payload: unknown): PendingSupabaseSyncItem {
  return {
    type: "review19",
    identity: getReview19CloudIdentity(record),
    payload,
    firstFailedAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    enqueuedAt: "2026-08-29T10:11:00.000Z",
    lastError: null,
  };
}

let passed = 0;
async function test(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

const record = makeReview();

await test("authoritative archive commitをawaitしてからlightweight outboxを作る", async () => {
  const order: string[] = [];
  let releaseSave: (() => void) | null = null;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const completion = persistCompletedReview19LocalFirstAsync(record, {
    saveAuthoritative: async () => {
      order.push("archive-start");
      await saveGate;
      order.push("archive-committed");
      return success();
    },
    enqueueCloud: () => {
      order.push("outbox");
      return true;
    },
    releaseAuxiliary: () => [],
  });
  await Promise.resolve();
  assert.deepEqual(order, ["archive-start"]);
  assert.ok(releaseSave);
  releaseSave();
  const result = await completion;
  assert.deepEqual(order, ["archive-start", "archive-committed", "outbox"]);
  assert.equal(result.localSaved, true);
  assert.equal(result.cloudQueuePrepared, true);
});

await test("archive quotaは補助領域解放後に最大1回だけ再試行する", async () => {
  let saves = 0;
  let releases = 0;
  const result = await persistCompletedReview19LocalFirstAsync(record, {
    saveAuthoritative: async () => (++saves === 1 ? quotaFailure() : success()),
    enqueueCloud: () => true,
    releaseAuxiliary: () => {
      releases += 1;
      return [];
    },
  });
  assert.equal(saves, 2);
  assert.equal(releases, 1);
  assert.equal(result.localSaved, true);
});

await test("archiveが失敗したままならoutboxを作らない", async () => {
  let queueCalls = 0;
  const result = await persistCompletedReview19LocalFirstAsync(record, {
    saveAuthoritative: async () => quotaFailure(),
    enqueueCloud: () => {
      queueCalls += 1;
      return true;
    },
    releaseAuxiliary: () => [],
  });
  assert.equal(result.localSaved, false);
  assert.equal(queueCalls, 0);
  assert.equal(result.localAttempts.length, 2);
});

await test("lightweight referenceを同business identityのarchive候補から非同期解決する", async () => {
  const reference = buildReview19PendingReference(record);
  assert.ok(reference);
  let query: unknown = null;
  let uploaded: Review19Result | null = null;
  const result = await sendPendingSupabaseSyncItem(pending(record, reference), {
    loadReview19ArchiveSources: async (value) => {
      query = value;
      return [record];
    },
    upsertReview19Record: async (value) => {
      uploaded = value;
      return { status: "saved", savedCount: 1 };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(query, { date: record.date, demandCycle: "summer" });
  assert.equal(uploaded?.sessionStartedAt, record.sessionStartedAt);
});

await test("archive read失敗時はreferenceを捏造せずqueue保持用failureを返す", async () => {
  const reference = buildReview19PendingReference(record);
  assert.ok(reference);
  let uploadCalls = 0;
  const result = await sendPendingSupabaseSyncItem(pending(record, reference), {
    loadReview19ArchiveSources: async () => {
      throw new DOMException("fixture", "SecurityError");
    },
    upsertReview19Record: async () => {
      uploadCalls += 1;
      return { status: "saved", savedCount: 1 };
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /archive source/);
  assert.equal(uploadCalls, 0);
});

await test("legacy rich pendingはarchive read失敗でもself-contained送信できる", async () => {
  let uploaded: Review19Result | null = null;
  const result = await sendPendingSupabaseSyncItem(pending(record, record), {
    loadReview19ArchiveSources: async () => {
      throw new DOMException("fixture", "SecurityError");
    },
    upsertReview19Record: async (value) => {
      uploaded = value;
      return { status: "saved", savedCount: 1 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(uploaded?.date, record.date);
});

console.log(`Review19 archive cloud checks passed: ${passed}/${passed}`);

if (previousStorage) {
  Object.defineProperty(globalThis, "localStorage", previousStorage);
} else {
  Reflect.deleteProperty(globalThis, "localStorage");
}


