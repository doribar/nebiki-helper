import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecordIdentity,
  mergeAreaCountRecordCollections,
  mergeAreaCountRecordPair,
  normalizeAreaCountRecords,
  upsertAreaCountRecord,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { collectAreaCountBackfillRecords } from "../src/domain/areaCountBackfill.ts";
import {
  enqueueReview19RecordForCloud,
  shouldReplaceQueuedReview19Record,
} from "../src/domain/cloudSync.ts";
import {
  AREA_COUNT_LOCAL_STORAGE_KEY,
  LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY,
  LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY,
  loadLegacyNormalAreaCountRecords,
  loadLegacySummerAreaCountRecords,
  loadLocalAreaCountRecords,
  saveLocalAreaCountRecords,
  upsertLocalAreaCountRecord,
} from "../src/domain/areaCountLocalStorage.ts";
import {
  buildRemoteAreaCountRow,
  normalizeRemoteAreaCountRows,
} from "../src/domain/areaCountRemoteStorage.ts";
import { persistAreaCountRecordLocalFirst } from "../src/domain/cloudSync.ts";
import { getLegacyHumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import {
  advanceReview19SourceUpdatedAt,
  createInitialReview19Result,
} from "../src/domain/review19.ts";
import {
  PENDING_SUPABASE_SYNC_STORAGE_KEY,
  clearPendingSupabaseSyncQueue,
  enqueuePendingSupabaseSync,
  flushPendingSupabaseSyncQueue,
  loadPendingSupabaseSyncQueue,
  normalizePendingSupabaseSyncQueue,
  savePendingSupabaseSyncQueue,
  type PendingSupabaseSyncItem,
} from "../src/domain/supabaseSyncQueue.ts";
import type { Review19Result } from "../src/domain/types.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

let passed = 0;
let failed = 0;

async function test(
  name: string,
  run: () => void | Promise<void>,
): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`PASS: ${String(passed + failed).padStart(2, "0")}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${String(passed + failed).padStart(2, "0")}. ${name}`);
    console.error(error);
  }
}

const NOW_MS = Date.parse("2026-08-10T03:00:00.000Z");
const NOW_ISO = new Date(NOW_MS).toISOString();

function getWeekday(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function makeRecord(
  overrides: Partial<AreaCountRecord> = {},
): AreaCountRecord {
  const date = overrides.date ?? "2026-08-09";
  const discountTime = overrides.discountTime ?? "15";
  const weekday = getWeekday(date);
  return {
    demandCycle: "normal",
    date,
    sessionStartedAt: "2026-08-09T06:00:00.000Z",
    recordedAt: "2026-08-09T06:05:00.000Z",
    areaId: "bento_men",
    discountTime,
    actualWeekday: getActualWeekdayLabel(weekday),
    actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({
      weekday,
      discountTime,
      date,
    }),
    count: 10,
    ...overrides,
  };
}

function getQueueItem(
  overrides: Partial<PendingSupabaseSyncItem> = {},
): PendingSupabaseSyncItem {
  return {
    type: "area_count",
    identity: "item-1",
    payload: { value: 1 },
    firstFailedAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    enqueuedAt: "2026-08-10T01:00:00.000Z",
    lastError: null,
    ...overrides,
  };
}

function makeReview19SyncRecord(params: {
  sourceUpdatedAt: string;
  recordedAt?: string;
}): Review19Result {
  const record = createInitialReview19Result({
    date: "2026-08-10",
    demandCycle: "normal",
    sessionStartedAt: "2026-08-10T09:00:00.000Z",
    reviewStartedAt: params.sourceUpdatedAt,
    excludedAreaIds: [...NORMAL_ROUTE],
  });
  return params.recordedAt
    ? {
        ...record,
        reviewCompletedAt: params.recordedAt,
        recordedAt: params.recordedAt,
      }
    : record;
}

await test("sync identity uses exactly the five cycle-safe record fields", () => {
  const base = makeRecord();
  const variants = [
    makeRecord({ date: "2026-08-08" }),
    makeRecord({ sessionStartedAt: "2026-08-09T06:01:00.000Z" }),
    makeRecord({ areaId: "tempura" }),
    makeRecord({ discountTime: "17" }),
    makeRecord({ demandCycle: "summer" }),
  ];
  const identities = new Set([
    getAreaCountRecordIdentity(base),
    ...variants.map(getAreaCountRecordIdentity),
  ]);
  assert.equal(identities.size, 6);
  assert.equal(
    getAreaCountRecordIdentity({ ...base, demandCycle: undefined }),
    getAreaCountRecordIdentity({ ...base, demandCycle: "normal" }),
  );
  assert.equal(JSON.parse(getAreaCountRecordIdentity(base)).length, 5);
});

await test("rich merge preserves newest core and supplements missing details", () => {
  const base = makeRecord();
  const withHuman = {
    ...base,
    userJudge: "normal" as const,
    humanEvaluationDetails: getLegacyHumanEvaluationDetails("normal"),
  };
  const withComfort = { ...base, comfortPoint: 2 };
  const forward = mergeAreaCountRecordPair(withHuman, withComfort);
  const reverse = mergeAreaCountRecordPair(withComfort, withHuman);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.userJudge, "normal");
  assert.equal(forward.comfortPoint, 2);

  const newer = makeRecord({
    recordedAt: "2026-08-09T06:06:00.000Z",
    count: 7,
    comfortPoint: 3,
  });
  const revised = mergeAreaCountRecordPair(withHuman, newer);
  const reversedRevision = mergeAreaCountRecordPair(newer, withHuman);
  assert.deepEqual(revised, reversedRevision);
  assert.equal(revised.recordedAt, newer.recordedAt);
  assert.equal(revised.count, 7);
  assert.equal(revised.comfortPoint, 3);
  assert.equal(revised.userJudge, "normal");
  assert.equal(revised.humanEvaluationDetails?.humanEvaluationScale, 5);
  assert.deepEqual(upsertAreaCountRecord([newer], withHuman), [revised]);

  const conflict = makeRecord({ count: 11 });
  assert.deepEqual(
    mergeAreaCountRecordPair(base, conflict),
    mergeAreaCountRecordPair(conflict, base),
  );
});

await test("collection merge dedupes by identity without crossing demand cycles", () => {
  const normal = makeRecord();
  const summer = makeRecord({ demandCycle: "summer", count: 12 });
  const merged = mergeAreaCountRecordCollections(
    [normal],
    [summer],
    [{ ...normal, comfortPoint: 1 }],
  );
  assert.equal(merged.length, 2);
  assert.equal(
    merged.find((record) => record.demandCycle === "normal")?.comfortPoint,
    1,
  );
});

await test("legacy scale-5 details survive normalization and cloud roundtrip", () => {
  const legacyDetails = getLegacyHumanEvaluationDetails("normal");
  assert.equal(legacyDetails.demandCycle, undefined);

  for (const demandCycle of ["normal", "summer"] as const) {
    const record = makeRecord({
      demandCycle,
      userJudge: "normal",
      humanEvaluationDetails: legacyDetails,
    });
    const normalized = normalizeAreaCountRecords([record]);
    assert.equal(normalized[0]?.humanEvaluationDetails?.humanEvaluationScale, 5);

    const roundtrip = normalizeRemoteAreaCountRows([
      buildRemoteAreaCountRow(record),
    ]);
    assert.equal(roundtrip[0]?.demandCycle, demandCycle);
    assert.equal(roundtrip[0]?.humanEvaluationDetails?.humanEvaluationScale, 5);
  }

  const mismatched = normalizeAreaCountRecords([
    makeRecord({
      demandCycle: "normal",
      humanEvaluationDetails: { ...legacyDetails, demandCycle: "summer" },
    }),
  ]);
  assert.equal(mismatched[0]?.humanEvaluationDetails, undefined);

  const malformedCycle = normalizeAreaCountRecords([
    makeRecord({
      humanEvaluationDetails: {
        ...legacyDetails,
        demandCycle: "invalid" as "normal",
      },
    }),
  ]);
  assert.equal(malformedCycle[0]?.humanEvaluationDetails, undefined);
});

await test("local cache dedupes legacy normal and preserves summer dual-write", () => {
  const storage = new MemoryStorage();
  const normal = makeRecord();
  const summerWithoutCycle = makeRecord({
    areaId: "tempura",
    sessionStartedAt: "2026-08-09T07:00:00.000Z",
    recordedAt: "2026-08-09T07:05:00.000Z",
  }) as AreaCountRecord & { demandCycle?: "normal" | "summer" };
  delete summerWithoutCycle.demandCycle;
  storage.setItem(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify([normal]));
  storage.setItem(
    LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY,
    JSON.stringify([{ ...normal, comfortPoint: 2 }]),
  );
  storage.setItem(
    LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY,
    JSON.stringify([summerWithoutCycle]),
  );

  const loaded = loadLocalAreaCountRecords({ storage });
  assert.equal(loaded.length, 2);
  assert.equal(loadLegacyNormalAreaCountRecords({ storage }).length, 1);
  assert.equal(
    loaded.find((record) => record.areaId === "bento_men")?.comfortPoint,
    2,
  );
  assert.equal(
    loaded.find((record) => record.areaId === "tempura")?.demandCycle,
    "summer",
  );

  const added = makeRecord({
    areaId: "onigiri",
    sessionStartedAt: "2026-08-09T08:00:00.000Z",
    recordedAt: "2026-08-09T08:05:00.000Z",
  });
  const saved = saveLocalAreaCountRecords([added], { storage });
  assert.equal(saved.length, 3);
  assert.equal(loadLegacySummerAreaCountRecords({ storage }).length, 1);
  assert.equal(
    JSON.parse(storage.getItem(AREA_COUNT_LOCAL_STORAGE_KEY) ?? "[]").length,
    3,
  );
});

await test("local upsert replaces a revision but never deletes other records", () => {
  const storage = new MemoryStorage();
  const first = makeRecord();
  const other = makeRecord({
    areaId: "tempura",
    demandCycle: "summer",
    sessionStartedAt: "2026-08-09T07:00:00.000Z",
    recordedAt: "2026-08-09T07:05:00.000Z",
  });
  saveLocalAreaCountRecords([first, other], { storage });
  const updated = upsertLocalAreaCountRecord(
    makeRecord({
      recordedAt: "2026-08-09T06:06:00.000Z",
      count: 14,
    }),
    { storage },
  );
  assert.equal(updated.length, 2);
  assert.equal(
    updated.find((record) => record.areaId === "bento_men")?.count,
    14,
  );
  assert.equal(loadLegacySummerAreaCountRecords({ storage }).length, 1);
});

await test("local-first retains the record when pending storage fails", () => {
  class PendingWriteFailureStorage extends MemoryStorage {
    override setItem(key: string, value: string): void {
      if (key === PENDING_SUPABASE_SYNC_STORAGE_KEY) {
        throw new Error("pending quota failure");
      }
      super.setItem(key, value);
    }
  }

  const storage = new PendingWriteFailureStorage();
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    assert.throws(
      () => persistAreaCountRecordLocalFirst(makeRecord()),
      /pending quota failure/,
    );
    const localRecords = loadLocalAreaCountRecords({ storage });
    assert.equal(localRecords.length, 1);
    assert.equal(localRecords[0]?.count, 10);
    assert.equal(loadPendingSupabaseSyncQueue({ storage }).length, 0);
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, "localStorage", previousDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
});

await test("local-first queues the canonical revision after clock rollback", () => {
  const storage = new MemoryStorage();
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    const newer = makeRecord({
      recordedAt: "2026-08-09T06:10:00.000Z",
      count: 20,
    });
    persistAreaCountRecordLocalFirst(newer);
    const staleRich = makeRecord({
      recordedAt: "2026-08-09T06:05:00.000Z",
      count: 10,
      userJudge: "normal",
      humanEvaluationDetails: getLegacyHumanEvaluationDetails("normal"),
    });
    const local = persistAreaCountRecordLocalFirst(staleRich);
    const pending = loadPendingSupabaseSyncQueue({ storage });
    const queuedRecord = pending[0]?.payload as AreaCountRecord | undefined;

    assert.equal(local.length, 1);
    assert.equal(local[0]?.recordedAt, newer.recordedAt);
    assert.equal(local[0]?.count, 20);
    assert.equal(local[0]?.humanEvaluationDetails?.humanEvaluationScale, 5);
    assert.equal(pending.length, 1);
    assert.equal(queuedRecord?.recordedAt, newer.recordedAt);
    assert.equal(queuedRecord?.count, 20);
    assert.equal(queuedRecord?.humanEvaluationDetails?.humanEvaluationScale, 5);
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, "localStorage", previousDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
});

await test("queue normalization rejects malformed items and keeps types separate", () => {
  const normalized = normalizePendingSupabaseSyncQueue([
    getQueueItem(),
    getQueueItem({ payload: { value: 2 } }),
    getQueueItem({ type: "review19", payload: { value: 3 } }),
    { ...getQueueItem(), enqueuedAt: "invalid" },
    { ...getQueueItem(), attemptCount: -1 },
  ]);
  assert.equal(normalized.length, 2);
  assert.deepEqual(
    normalized.find((item) => item.type === "area_count")?.payload,
    { value: 2 },
  );
  assert.deepEqual(
    normalized.find((item) => item.type === "review19")?.payload,
    { value: 3 },
  );
});

await test("enqueue dedupes identity and replaces only changed payload", () => {
  const storage = new MemoryStorage();
  enqueuePendingSupabaseSync(
    {
      type: "area_count",
      identity: "same",
      payload: { a: 1, b: 2 },
      firstFailedAt: "2026-08-10T00:00:00.000Z",
      attemptCount: 2,
      lastError: "offline",
    },
    { storage, now: () => "2026-08-10T01:00:00.000Z" },
  );
  enqueuePendingSupabaseSync(
    {
      type: "area_count",
      identity: "same",
      payload: { b: 2, a: 1 },
    },
    { storage, now: () => "2026-08-10T01:01:00.000Z" },
  );
  let queue = loadPendingSupabaseSyncQueue({ storage });
  assert.equal(queue.length, 1);
  assert.equal(queue[0]?.attemptCount, 2);

  enqueuePendingSupabaseSync(
    { type: "area_count", identity: "same", payload: { a: 3 } },
    { storage, now: () => "2026-08-10T01:02:00.000Z" },
  );
  queue = loadPendingSupabaseSyncQueue({ storage });
  assert.equal(queue.length, 1);
  assert.deepEqual(queue[0]?.payload, { a: 3 });
  assert.equal(queue[0]?.attemptCount, 0);
  assert.equal(queue[0]?.lastError, null);
  assert.equal(queue[0]?.enqueuedAt, "2026-08-10T01:02:00.000Z");
});

await test("Review19 outboxはstrict monotonicでfinalからpartialへ退行しない", () => {
  const partial = makeReview19SyncRecord({
    sourceUpdatedAt: "2026-08-10T10:00:00.000Z",
  });
  const equalTimeFinal = makeReview19SyncRecord({
    sourceUpdatedAt: "2026-08-10T10:00:00.000Z",
    recordedAt: "2026-08-10T10:00:00.000Z",
  });
  const monotonicFinal = {
    ...equalTimeFinal,
    sourceUpdatedAt: advanceReview19SourceUpdatedAt(
      partial,
      "2026-08-10T10:00:00.000Z",
    ),
  };
  const newerPartial = makeReview19SyncRecord({
    sourceUpdatedAt: "2026-08-10T11:00:00.000Z",
  });
  const olderPartial = makeReview19SyncRecord({
    sourceUpdatedAt: "2026-08-10T09:30:00.000Z",
  });

  assert.equal(
    shouldReplaceQueuedReview19Record(partial, equalTimeFinal),
    false,
  );
  assert.equal(
    shouldReplaceQueuedReview19Record(partial, monotonicFinal),
    true,
  );
  assert.equal(
    shouldReplaceQueuedReview19Record(monotonicFinal, newerPartial),
    false,
  );
  assert.equal(
    shouldReplaceQueuedReview19Record(newerPartial, olderPartial),
    false,
  );
  assert.equal(
    shouldReplaceQueuedReview19Record(olderPartial, newerPartial),
    true,
  );

  const storage = new MemoryStorage();
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    assert.equal(enqueueReview19RecordForCloud(partial), true);
    assert.equal(enqueueReview19RecordForCloud(equalTimeFinal), false);
    assert.equal(enqueueReview19RecordForCloud(monotonicFinal), true);
    assert.equal(enqueueReview19RecordForCloud(newerPartial), false);

    const queue = loadPendingSupabaseSyncQueue({ storage });
    assert.equal(queue.length, 1);
    assert.equal(
      (queue[0]?.payload as Partial<Review19Result>)?.recordedAt,
      monotonicFinal.recordedAt,
    );
    assert.equal(
      (queue[0]?.payload as Partial<Review19Result>)?.sourceUpdatedAt,
      "2026-08-10T10:00:00.001Z",
    );
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    } else {
      delete (
        globalThis as typeof globalThis & { localStorage?: Storage }
      ).localStorage;
    }
  }
});

await test("Review19 deletion correction advances despite clock rollback", () => {
  const targetAreaId = NORMAL_ROUTE[0];
  const partial = makeReview19SyncRecord({
    sourceUpdatedAt: "2026-08-10T10:00:00.000Z",
  });
  partial.excludedAreaIds = partial.excludedAreaIds.filter(
    (areaId) => areaId !== targetAreaId,
  );
  delete partial.excludeReasons[targetAreaId];
  partial.areaCounts[targetAreaId] = 12;
  partial.areaCountRecordedAt[targetAreaId] =
    "2026-08-10T10:00:00.000Z";
  const correction = {
    ...partial,
    areaCounts: { ...partial.areaCounts },
    areaCountRecordedAt: { ...partial.areaCountRecordedAt },
    excludedAreaIds: [...partial.excludedAreaIds, targetAreaId],
    excludeReasons: {
      ...partial.excludeReasons,
      [targetAreaId]: "manual" as const,
    },
    sourceUpdatedAt: advanceReview19SourceUpdatedAt(
      partial,
      "2026-08-10T09:30:00.000Z",
    ),
  };
  delete correction.areaCounts[targetAreaId];
  delete correction.areaCountRecordedAt[targetAreaId];
  assert.equal(correction.sourceUpdatedAt, "2026-08-10T10:00:00.001Z");
  assert.equal(shouldReplaceQueuedReview19Record(partial, correction), true);

  const storage = new MemoryStorage();
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    assert.equal(enqueueReview19RecordForCloud(partial), true);
    assert.equal(enqueueReview19RecordForCloud(correction), true);
    const queued = loadPendingSupabaseSyncQueue({ storage });
    assert.equal(queued.length, 1);
    assert.equal(
      (queued[0]?.payload as Partial<Review19Result>)?.sourceUpdatedAt,
      correction.sourceUpdatedAt,
    );
    assert.equal(
      (queued[0]?.payload as Partial<Review19Result>)?.areaCounts?.[
        targetAreaId
      ],
      undefined,
    );
    assert.equal(
      (queued[0]?.payload as Partial<Review19Result>)?.excludeReasons?.[
        targetAreaId
      ],
      "manual",
    );
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, "localStorage", previousDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
});

await test("flush is sequential, removes successes, and retains stamped failures", async () => {
  const storage = new MemoryStorage();
  savePendingSupabaseSyncQueue(
    [
      getQueueItem({ identity: "success" }),
      getQueueItem({
        identity: "failure",
        enqueuedAt: "2026-08-10T01:01:00.000Z",
      }),
    ],
    { storage },
  );
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const result = await flushPendingSupabaseSyncQueue({
    storage,
    now: () => NOW_ISO,
    sender: async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(item.identity);
      await Promise.resolve();
      active -= 1;
      return item.identity === "failure"
        ? { ok: false, error: "offline" }
        : { ok: true };
    },
  });
  assert.deepEqual(order, ["success", "failure"]);
  assert.equal(maxActive, 1);
  assert.deepEqual(result, {
    attempted: 2,
    succeeded: 1,
    failed: 1,
    retained: 1,
  });
  const retained = loadPendingSupabaseSyncQueue({ storage })[0];
  assert.equal(retained?.identity, "failure");
  assert.equal(retained?.attemptCount, 1);
  assert.equal(retained?.lastAttemptAt, NOW_ISO);
  assert.equal(retained?.firstFailedAt, NOW_ISO);
  assert.equal(retained?.lastError, "offline");
});

await test("flush uses one module lock for concurrent callers", async () => {
  const storage = new MemoryStorage();
  savePendingSupabaseSyncQueue([getQueueItem()], { storage });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const sender = async () => {
    calls += 1;
    await gate;
    return { ok: true } as const;
  };
  const first = flushPendingSupabaseSyncQueue({ storage, sender });
  const second = flushPendingSupabaseSyncQueue({ storage, sender });
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.ok(release);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(loadPendingSupabaseSyncQueue({ storage }).length, 0);
});

await test("flush CAS preserves a newer payload enqueued during send", async () => {
  const storage = new MemoryStorage();
  enqueuePendingSupabaseSync(
    { type: "area_count", identity: "same", payload: { revision: 1 } },
    { storage, now: () => "2026-08-10T01:00:00.000Z" },
  );
  const result = await flushPendingSupabaseSyncQueue({
    storage,
    now: () => NOW_ISO,
    sender: () => {
      enqueuePendingSupabaseSync(
        { type: "area_count", identity: "same", payload: { revision: 2 } },
        { storage, now: () => "2026-08-10T02:00:00.000Z" },
      );
      return { ok: true };
    },
  });
  assert.equal(result.succeeded, 1);
  assert.equal(result.retained, 1);
  const queue = loadPendingSupabaseSyncQueue({ storage });
  assert.deepEqual(queue[0]?.payload, { revision: 2 });
  assert.equal(queue[0]?.attemptCount, 0);
});

await test("backfill collects every rich source and merges by identity", () => {
  const duplicate = makeRecord();
  const legacyDetails = getLegacyHumanEvaluationDetails("normal");
  const summerLegacy = makeRecord({
    areaId: "tempura",
    sessionStartedAt: "2026-08-09T07:00:00.000Z",
    recordedAt: "2026-08-09T07:05:00.000Z",
  }) as AreaCountRecord & { demandCycle?: "normal" | "summer" };
  delete summerLegacy.demandCycle;
  const finalized = makeRecord({
    areaId: "chuka_fish",
    sessionStartedAt: "2026-08-09T08:00:00.000Z",
    recordedAt: "2026-08-09T08:05:00.000Z",
  });
  const review = makeRecord({
    areaId: "yakitori",
    sessionStartedAt: "2026-08-09T09:00:00.000Z",
    recordedAt: "2026-08-09T09:05:00.000Z",
  });
  const sources = {
    nowMs: NOW_MS,
    unifiedCacheRecords: [
      duplicate,
      makeRecord({
        date: "2026-08-11",
        sessionStartedAt: "2026-08-11T01:00:00.000Z",
        recordedAt: "2026-08-11T01:05:00.000Z",
        areaId: "ryomi",
      }),
      { ...makeRecord({ areaId: "ryomi" }), areaId: "unknown" },
    ],
    summerCacheRecords: [summerLegacy],
    finalizedDayRecords: [
      {
        areaCountRecords: [
          {
            ...duplicate,
            userJudge: "normal",
            humanEvaluationDetails: legacyDetails,
          },
          finalized,
        ],
      },
    ],
    review19Records: [
      { daySnapshot: { areaCountRecords: [review] } },
      { areaCounts: { sushi: 999 } },
    ],
    dailySessionSnapshots: [
      {
        version: 1,
        demandCycle: "normal",
        session: {
          date: "2026-08-09",
          weekday: 0,
          discountTime: "17",
          demandCycle: "normal",
          startedAt: "2026-08-09T10:00:00.000Z",
        },
        areas: {
          sushi: {
            areaId: "sushi",
            areaCount: 8,
            measurementStatus: "measured",
            measurementRecordedAt: "2026-08-09T10:05:00.000Z",
            areaCountEvaluation: "normal",
            areaCountEvaluationSource: "manual",
            humanEvaluationDetails: legacyDetails,
          },
          croquette: {
            areaId: "croquette",
            areaCount: 9,
            measurementStatus: "not_measured",
            measurementRecordedAt: "2026-08-09T10:06:00.000Z",
          },
          fry_chicken: {
            areaId: "fry_chicken",
            areaCount: 9,
            measurementStatus: "measured",
          },
          ryomi: {
            areaId: "ryomi",
            areaCount: 9,
            measurementStatus: "measured",
            measurementRecordedAt: "2026-08-11T10:06:00.000Z",
          },
        },
      },
    ],
    currentState: {
      session: {
        dataSchemaVersion: 3,
        date: "2026-08-09",
        weekday: 0,
        discountTime: "18",
        demandCycle: "normal",
        startedAt: "2026-08-09T11:00:00.000Z",
      },
      areaProgressMap: {
        onigiri: {
          areaId: "onigiri",
          areaCount: 6,
          measurementStatus: "measured",
          measurementRecordedAt: "2026-08-09T11:05:00.000Z",
          areaCountEvaluation: "slightly_few",
          areaCountEvaluationSource: "history",
        },
        hosomaki: {
          areaId: "hosomaki",
          areaCount: 4,
          measurementStatus: "not_measured",
          measurementRecordedAt: "2026-08-09T11:06:00.000Z",
        },
      },
    },
  };
  const before = JSON.stringify(sources);
  const records = collectAreaCountBackfillRecords(sources);
  assert.equal(records.length, 6);
  assert.deepEqual(
    new Set(records.map((record) => record.areaId)),
    new Set([
      "bento_men",
      "tempura",
      "chuka_fish",
      "yakitori",
      "sushi",
      "onigiri",
    ]),
  );
  assert.equal(
    records.find((record) => record.areaId === "tempura")?.demandCycle,
    "summer",
  );
  assert.equal(
    records.find((record) => record.areaId === "bento_men")
      ?.humanEvaluationDetails?.humanEvaluationScale,
    5,
  );
  assert.equal(
    records.find((record) => record.areaId === "sushi")?.userJudge,
    "normal",
  );
  assert.equal(
    records.find((record) => record.areaId === "onigiri")
      ?.suggestedEvaluation,
    "slightly_few",
  );
  assert.equal(JSON.stringify(sources), before);
});

await test("backfill rejects bad chronology, cross-cycle snapshots, and bad now", () => {
  const invalidChronology = makeRecord({
    sessionStartedAt: "2026-08-09T08:00:00.000Z",
    recordedAt: "2026-08-09T07:59:00.000Z",
  });
  const crossCycleSnapshot = {
    demandCycle: "summer",
    session: {
      date: "2026-08-09",
      weekday: 0,
      discountTime: "17",
      demandCycle: "normal",
      startedAt: "2026-08-09T08:00:00.000Z",
    },
    areas: {
      bento_men: {
        areaId: "bento_men",
        areaCount: 1,
        measurementStatus: "measured",
        measurementRecordedAt: "2026-08-09T08:01:00.000Z",
      },
    },
  };
  assert.deepEqual(
    collectAreaCountBackfillRecords({
      nowMs: NOW_MS,
      unifiedCacheRecords: [invalidChronology],
      dailySessionSnapshots: [crossCycleSnapshot],
    }),
    [],
  );
  assert.throws(
    () => collectAreaCountBackfillRecords({ nowMs: Number.NaN }),
    /nowMs/,
  );
});

await test("fixed-time isolation stays a caller boundary in pure domains", () => {
  const source = readFileSync(
    new URL("../src/domain/areaCountBackfill.ts", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("testNow"), false);
  assert.equal(source.includes("getRuntimeNow"), false);
  assert.equal(
    PENDING_SUPABASE_SYNC_STORAGE_KEY,
    "nebiki-helper/pending-supabase-sync-v1",
  );
  assert.equal(
    AREA_COUNT_LOCAL_STORAGE_KEY,
    "nebiki-helper/area-count-records-v2",
  );

  const storage = new MemoryStorage();
  clearPendingSupabaseSyncQueue({ storage });
  assert.equal(storage.length, 0);
});

await test("hook integration is local-first, fixed-isolated, and retry-safe", () => {
  const hookSource = readFileSync(
    new URL("../src/hooks/useNebikiApp.ts", import.meta.url),
    "utf8",
  );
  const cloudSource = readFileSync(
    new URL("../src/domain/cloudSync.ts", import.meta.url),
    "utf8",
  );
  const settingsSource = readFileSync(
    new URL("../src/components/common/AdminSettingsDialog.tsx", import.meta.url),
    "utf8",
  );

  const persistStart = cloudSource.indexOf(
    "export function persistAreaCountRecordLocalFirst",
  );
  const persistEnd = cloudSource.indexOf(
    "export function enqueueAreaCountRecordsForCloud",
    persistStart,
  );
  const persistBlock = cloudSource.slice(persistStart, persistEnd);
  assert.ok(
    persistBlock.indexOf("upsertLocalAreaCountRecord(normalized)") <
      persistBlock.indexOf("enqueuePendingSupabaseSync({"),
  );

  const syncStart = hookSource.indexOf(
    "async function syncLocalDataToSupabase",
  );
  const syncEnd = hookSource.indexOf("function resetApp", syncStart);
  const syncBlock = hookSource.slice(syncStart, syncEnd);
  assert.ok(syncStart >= 0 && syncEnd > syncStart);
  assert.ok(
    syncBlock.indexOf("if (isTestMode)") <
      syncBlock.indexOf("collectAreaCountBackfillRecords({"),
  );
  assert.ok(syncBlock.includes('skippedReason: "fixed_time_mode"'));
  assert.ok(syncBlock.includes("loadLegacyNormalAreaCountRecords()"));

  const retryStart = hookSource.indexOf(
    "const retryPendingCloudSync = useCallback",
  );
  const retryEnd = hookSource.indexOf(
    "if (!lastFinalizedDayDataRef.current",
    retryStart,
  );
  const retryBlock = hookSource.slice(retryStart, retryEnd);
  assert.ok(retryBlock.includes("if (isTestMode)"));
  assert.ok(retryBlock.includes("let result = { ...firstPass }"));
  assert.equal(hookSource.includes("upsertRemoteAreaCountRecord(nextRecord)"), false);
  assert.ok(hookSource.includes('loadRemoteAreaCountRecords("normal")'));
  assert.ok(hookSource.includes('loadRemoteAreaCountRecords("summer")'));
  assert.ok(hookSource.includes('loadRemoteReview19Records("normal")'));
  assert.ok(hookSource.includes('loadRemoteReview19Records("summer")'));
  assert.ok(hookSource.includes('window.addEventListener("online", retry)'));
  assert.ok(hookSource.includes('window.removeEventListener("online", retry)'));
  assert.equal(
    hookSource.match(/persistAreaCountRecordLocalFirst\(/g)?.length,
    2,
  );
  assert.ok(settingsSource.includes("端末内データをSupabaseへ同期"));
  assert.ok(settingsSource.includes("result.allSynced"));
  assert.ok(settingsSource.includes("未同期 0件"));
  assert.ok(settingsSource.includes('width: "min(92vw, 520px)"'));
  assert.ok(settingsSource.includes('maxWidth: "100%"'));
  assert.ok(settingsSource.includes('boxSizing: "border-box"'));

  const finalStart = hookSource.indexOf(
    "function buildRecordedReview19Result",
  );
  const finalEnd = hookSource.indexOf("function saveReview19", finalStart);
  const finalBlock = hookSource.slice(finalStart, finalEnd);
  assert.ok(finalStart >= 0 && finalEnd > finalStart);
  assert.ok(finalBlock.includes("const sourceBeforeFinal"));
  assert.ok(finalBlock.includes("latestAreaCount || latestExcludedAreaId"));
  assert.ok(
    finalBlock.match(/advanceReview19SourceUpdatedAt/g)?.length === 2,
  );
});

console.log(`\n${passed}/${passed + failed} tests passed.`);
if (failed > 0) process.exitCode = 1;
