import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  enqueueReview19RecordForCloud,
  getReview19CloudIdentity,
  removeReview19PendingItemsCoveredByRecords,
  resolveQueuedReview19Record,
  syncAuthoritativeReview19RecordsDirectly,
} from "../src/domain/cloudSync.ts";
import { createInitialReview19Result } from "../src/domain/review19.ts";
import {
  buildReview19PendingReference,
  normalizeReview19PendingReference,
  REVIEW19_PENDING_REFERENCE_KIND,
} from "../src/domain/review19CloudOutbox.ts";
import {
  loadPendingSupabaseSyncQueue,
  savePendingSupabaseSyncQueue,
  type PendingSupabaseSyncItem,
} from "../src/domain/supabaseSyncQueue.ts";
import type { DemandCycle, Review19Result } from "../src/domain/types.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

function utf16StorageBytes(key: string, value: unknown): number {
  return (key.length + JSON.stringify(value).length) * 2;
}

function makeFinalReview(params: {
  date?: string;
  demandCycle?: DemandCycle;
  sourceUpdatedAt?: string;
  paddingLength?: number;
} = {}): Review19Result {
  const date = params.date ?? "2026-08-24";
  const sourceUpdatedAt = params.sourceUpdatedAt ?? `${date}T10:06:00.000Z`;
  const record = createInitialReview19Result({
    date,
    demandCycle: params.demandCycle ?? "normal",
    sessionStartedAt: `${date}T09:00:00.000Z`,
    reviewStartedAt: `${date}T10:00:00.000Z`,
    excludedAreaIds: [...NORMAL_ROUTE],
  });
  return {
    ...record,
    reviewCompletedAt: sourceUpdatedAt,
    sourceUpdatedAt,
    recordedAt: sourceUpdatedAt,
    // Anonymous rich fixture: legacy pending copied every payload byte while
    // the reference shape below remains fixed-size.
    fixturePadding: "x".repeat(params.paddingLength ?? 48_000),
  } as Review19Result;
}

function pendingItem(
  payload: unknown,
  identity: string,
  suffix = "",
): PendingSupabaseSyncItem {
  return {
    type: "review19",
    identity,
    payload,
    firstFailedAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    enqueuedAt: `2026-08-24T10:10:00.00${suffix || "0"}Z`,
    lastError: null,
  };
}

let passed = 0;
async function test(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

await test("rich authoritative / legacy full pending / referenceのUTF-16容量を実測する", () => {
  const record = makeFinalReview();
  const identity = getReview19CloudIdentity(record);
  const reference = buildReview19PendingReference(record);
  assert.ok(reference);
  const authoritativeBytes = utf16StorageBytes(
    "nebiki-helper/review19-records",
    [record],
  );
  const legacyBytes = utf16StorageBytes(
    "nebiki-helper/pending-supabase-sync-v1",
    [pendingItem(record, identity)],
  );
  const referenceBytes = utf16StorageBytes(
    "nebiki-helper/pending-supabase-sync-v1",
    [pendingItem(reference, identity)],
  );
  assert.ok(authoritativeBytes > 90_000);
  assert.ok(legacyBytes > 90_000);
  assert.ok(referenceBytes < 2_000);
  assert.ok(referenceBytes / legacyBytes < 0.03);
  console.log(
    `INFO Review19 UTF-16 authoritativeKiB=${(authoritativeBytes / 1024).toFixed(1)} ` +
      `legacyPendingKiB=${(legacyBytes / 1024).toFixed(1)} ` +
      `referencePendingKiB=${(referenceBytes / 1024).toFixed(1)} ` +
      `reduction=${((1 - referenceBytes / legacyBytes) * 100).toFixed(1)}%`,
  );
});

await test("referenceはrich payloadを含まずrecordの大きさに比例しない", () => {
  const small = buildReview19PendingReference(makeFinalReview({ paddingLength: 1 }));
  const large = buildReview19PendingReference(makeFinalReview({ paddingLength: 200_000 }));
  assert.ok(small);
  assert.ok(large);
  assert.deepEqual(large, small);
  assert.equal(large.kind, REVIEW19_PENDING_REFERENCE_KIND);
  assert.equal("areaCounts" in large, false);
  assert.equal("daySnapshot" in large, false);
  assert.equal("fixturePadding" in large, false);
});

await test("100件referenceもrich payload 100件分へ膨張しない", () => {
  const rich = makeFinalReview({ paddingLength: 64_000 });
  const references = Array.from({ length: 100 }, (_, index) => ({
    ...buildReview19PendingReference(rich)!,
    sessionStartedAt: `2026-08-24T09:${String(index % 60).padStart(2, "0")}:00.000Z`,
    sourceUpdatedAt: `2026-08-24T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
  }));
  const refBytes = utf16StorageBytes("queue", references);
  const fullBytes = utf16StorageBytes("queue", Array.from({ length: 100 }, () => rich));
  assert.ok(refBytes < 100_000);
  assert.ok(refBytes / fullBytes < 0.02);
});

await test("legacy full payloadとreferenceの両方をcanonical Review19へ解決する", () => {
  const record = makeFinalReview();
  const identity = getReview19CloudIdentity(record);
  const reference = buildReview19PendingReference(record)!;
  const legacyResolved = resolveQueuedReview19Record(
    pendingItem(record, identity),
    [],
  );
  const referenceResolved = resolveQueuedReview19Record(
    pendingItem(reference, identity),
    [record],
  );
  assert.equal(legacyResolved?.recordedAt, record.recordedAt);
  assert.equal(referenceResolved?.recordedAt, record.recordedAt);
  assert.equal(
    normalizeReview19PendingReference(referenceResolved),
    null,
    "resolved object is the authoritative record, not another reference",
  );
});

await test("pendingなしlocal authoritative Review19をdirect uploadできる", async () => {
  const storage = new MemoryStorage();
  const record = makeFinalReview();
  let uploaded: readonly Review19Result[] = [];
  assert.equal(loadPendingSupabaseSyncQueue({ storage }).length, 0);
  const result = await syncAuthoritativeReview19RecordsDirectly(
    [record],
    async (records) => {
      uploaded = records;
      return { status: "saved", savedCount: records.length };
    },
  );
  assert.equal(result.status, "saved");
  assert.equal(result.succeededCount, 1);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0]?.date, record.date);
  assert.equal(loadPendingSupabaseSyncQueue({ storage }).length, 0);
});

await test("remote already existsのidempotent upsert mockでもduplicateを作らない", async () => {
  const record = makeFinalReview();
  const rows = new Map<string, Review19Result>([
    [getReview19CloudIdentity(record), record],
  ]);
  const uploader = async (records: readonly Review19Result[]) => {
    for (const candidate of records) {
      rows.set(getReview19CloudIdentity(candidate), candidate);
    }
    return { status: "saved" as const, savedCount: records.length };
  };
  const first = await syncAuthoritativeReview19RecordsDirectly([record], uploader);
  const second = await syncAuthoritativeReview19RecordsDirectly([record], uploader);
  assert.equal(first.status, "saved");
  assert.equal(second.status, "saved");
  assert.equal(rows.size, 1);
});

await test("direct upload失敗時もfull payloadではなくreferenceを保存できる", async () => {
  const storage = new MemoryStorage();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    const record = makeFinalReview();
    const failed = await syncAuthoritativeReview19RecordsDirectly(
      [record],
      async () => ({ status: "error", message: "offline fixture" }),
    );
    assert.equal(failed.status, "error");
    assert.equal(enqueueReview19RecordForCloud(record), true);
    const queue = loadPendingSupabaseSyncQueue({ storage });
    assert.equal(queue.length, 1);
    assert.ok(normalizeReview19PendingReference(queue[0]?.payload));
    assert.equal(JSON.stringify(queue[0]?.payload).includes("fixturePadding"), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

await test("successful direct uploadはcovered pendingだけをrevision-awareにcleanupする", () => {
  const storage = new MemoryStorage();
  const sent = makeFinalReview({ sourceUpdatedAt: "2026-08-24T10:06:00.000Z" });
  const newer = makeFinalReview({
    date: "2026-08-25",
    sourceUpdatedAt: "2026-08-25T10:08:00.000Z",
  });
  const staleSentForNewer = makeFinalReview({
    date: "2026-08-25",
    sourceUpdatedAt: "2026-08-25T10:07:00.000Z",
  });
  savePendingSupabaseSyncQueue(
    [
      pendingItem(buildReview19PendingReference(sent), getReview19CloudIdentity(sent), "1"),
      pendingItem(buildReview19PendingReference(newer), getReview19CloudIdentity(newer), "2"),
    ],
    { storage },
  );
  const cleanup = removeReview19PendingItemsCoveredByRecords(
    [sent, staleSentForNewer],
    { storage },
  );
  assert.equal(cleanup.removedCount, 1);
  const retained = loadPendingSupabaseSyncQueue({ storage });
  assert.equal(retained.length, 1);
  assert.equal(retained[0]?.identity, getReview19CloudIdentity(newer));
});

await test("管理設定manual syncはdirect authoritative uploadを呼びfull enqueueを前提にしない", () => {
  const hookSource = readFileSync(
    resolve(import.meta.dirname, "../src/hooks/useNebikiApp.ts"),
    "utf8",
  );
  const start = hookSource.indexOf("async function syncLocalDataToSupabase");
  const end = hookSource.indexOf("function resetApp", start);
  assert.ok(start >= 0 && end > start);
  const block = hookSource.slice(start, end);
  assert.match(block, /syncAuthoritativeReview19RecordsDirectly\(localReview19Records\)/);
  assert.doesNotMatch(block, /enqueueReview19RecordsForCloud/);
});

console.log(`Review19 lightweight outbox checks passed: ${passed}/${passed}`);
