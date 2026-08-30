import assert from "node:assert/strict";
import {
  HistoricalArchiveRepository,
  LEGACY_FINALIZED_DAY_STORAGE_KEY,
  LEGACY_REVIEW19_STORAGE_KEY,
  MemoryHistoricalArchiveAdapter,
  getReview19ArchiveOperationKey,
  migrateLegacyHistoricalLocalStorage,
} from "../src/domain/historicalArchive.ts";
import type {
  Review19DaySnapshot,
  Review19Result,
} from "../src/domain/types.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

class RemoveFailureStorage extends MemoryStorage {
  failRemove = true;

  override removeItem(key: string): void {
    if (this.failRemove) {
      throw new DOMException("fixture", "SecurityError");
    }
    super.removeItem(key);
  }
}

class VerifyMismatchAdapter extends MemoryHistoricalArchiveAdapter {
  private reviewReads = 0;

  override async getAll(
    ...args: Parameters<MemoryHistoricalArchiveAdapter["getAll"]>
  ): ReturnType<MemoryHistoricalArchiveAdapter["getAll"]> {
    const result = await super.getAll(...args);
    if (String(args[0]) === "review19") {
      this.reviewReads += 1;
      if (this.reviewReads === 3) return [];
    }
    return result;
  }
}

function makeReview(params: {
  date: string;
  cycle?: "normal" | "summer";
  session?: string;
  sourceUpdatedAt?: string;
  status?: "recorded" | "not_applicable";
}): Review19Result {
  const sessionStartedAt = params.session ?? `${params.date}T09:00:00.000Z`;
  const sourceUpdatedAt = params.sourceUpdatedAt ?? `${params.date}T10:10:00.000Z`;
  return {
    review19Status: params.status ?? "recorded",
    date: params.date,
    demandCycle: params.cycle ?? "normal",
    sessionStartedAt,
    reviewStartedAt: `${params.date}T10:00:00.000Z`,
    reviewCompletedAt: sourceUpdatedAt,
    sourceUpdatedAt,
    recordedAt: sourceUpdatedAt,
    areaCountRecordedAt: {},
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCounts: {},
    excludedAreaIds: [],
    excludeReasons: {},
    dataQuality: {
      expectedAreaCount: 0,
      recordedAreaCount: 0,
      excludedAreaCount: 0,
      missingAreaIds: [],
      duplicateAreaIds: [],
      complete: true,
      processComplete: true,
      measurementComplete: true,
      humanEvaluationComplete: true,
      missingHumanEvaluationAreaIds: [],
      notMeasuredAreaIds: [],
      missingReasons: {},
    },
  };
}

function makeDay(date: string, memo: string | null = null) {
  const snapshot: Review19DaySnapshot = {
    version: 1,
    capturedAt: `${date}T12:00:00.000Z`,
    date,
    demandCycle: "normal",
    review19Status: "not_performed",
    sessions: [],
    areaCountRecords: [],
  };
  return {
    ...snapshot,
    recordId: `nebiki-day:${date}`,
    finalizedAt: `${date}T12:00:00.000Z`,
    memo,
    discardCount: null,
  };
}

let passed = 0;
async function test(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

await test("Review19 operation identity keeps different sessions separate", async () => {
  const repository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  const first = makeReview({ date: "2026-08-25", session: "2026-08-25T09:00:00.000Z" });
  const second = makeReview({ date: "2026-08-25", session: "2026-08-25T09:30:00.000Z" });
  assert.notEqual(getReview19ArchiveOperationKey(first), getReview19ArchiveOperationKey(second));
  assert.equal((await repository.upsertReview19Records([first, second])).ok, true);
  const listed = await repository.listReview19Records();
  assert.equal(listed.ok && listed.value.length, 2);
});

await test("Review19 operation identity keeps normal/summer separate", async () => {
  const repository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  const normal = makeReview({
    date: "2026-08-25",
    cycle: "normal",
    session: "2026-08-25T09:00:00.000Z",
  });
  const summer = makeReview({
    date: "2026-08-25",
    cycle: "summer",
    session: normal.sessionStartedAt,
  });
  assert.notEqual(
    getReview19ArchiveOperationKey(normal),
    getReview19ArchiveOperationKey(summer),
  );
  assert.equal((await repository.upsertReview19Records([normal, summer])).ok, true);
  const listed = await repository.listReview19Records();
  assert.equal(listed.ok && listed.value.length, 2);
  assert.deepEqual(
    listed.ok
      ? listed.value.map((record) => record.demandCycle).sort()
      : [],
    ["normal", "summer"],
  );
});

await test("same Review19 operation uses final/newer evidence without duplicates", async () => {
  const repository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  const older = makeReview({ date: "2026-08-26", sourceUpdatedAt: "2026-08-26T10:10:00.000Z" });
  const newer = makeReview({ date: "2026-08-26", sourceUpdatedAt: "2026-08-26T10:20:00.000Z" });
  await repository.upsertReview19Records([newer]);
  await repository.upsertReview19Records([older]);
  const listed = await repository.listReview19Records();
  assert.equal(listed.ok && listed.value.length, 1);
  assert.equal(listed.ok && listed.value[0]?.sourceUpdatedAt, newer.sourceUpdatedAt);
});

await test("concurrent remote/local Review19 mutations cannot regress richer evidence", async () => {
  const repository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  const finalLocal = makeReview({
    date: "2026-08-27",
    sourceUpdatedAt: "2026-08-27T10:20:00.000Z",
  });
  const staleRemote = makeReview({
    date: "2026-08-27",
    sourceUpdatedAt: "2026-08-27T10:10:00.000Z",
  });
  await Promise.all([
    repository.upsertReview19Records([finalLocal]),
    repository.upsertReview19Records([staleRemote]),
  ]);
  const listed = await repository.listReview19Records();
  assert.equal(listed.ok && listed.value.length, 1);
  assert.equal(
    listed.ok && listed.value[0]?.sourceUpdatedAt,
    finalLocal.sourceUpdatedAt,
  );
});

await test("legacy migration preserves recorded and not_applicable raw records", async () => {
  const storage = new MemoryStorage();
  const recorded = makeReview({ date: "2026-08-20" });
  const notApplicable = makeReview({
    date: "2026-08-21",
    status: "not_applicable",
  });
  storage.setItem(LEGACY_REVIEW19_STORAGE_KEY, JSON.stringify([recorded, notApplicable]));
  storage.setItem(LEGACY_FINALIZED_DAY_STORAGE_KEY, JSON.stringify([
    makeDay("2026-08-20", "kept"),
  ]));
  const repository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  const migrated = await migrateLegacyHistoricalLocalStorage({ repository, storage });
  assert.equal(migrated.ok, true);
  assert.equal(storage.getItem(LEGACY_REVIEW19_STORAGE_KEY), null);
  assert.equal(storage.getItem(LEGACY_FINALIZED_DAY_STORAGE_KEY), null);
  const allReviews = await repository.listAllReview19Records();
  const visibleReviews = await repository.listReview19Records();
  const days = await repository.listFinalizedDays();
  assert.equal(allReviews.ok && allReviews.value.length, 2);
  assert.equal(visibleReviews.ok && visibleReviews.value.length, 1);
  assert.equal(days.ok && days.value[0]?.memo, "kept");
});

await test("write failure retains both legacy source keys and is retryable", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_REVIEW19_STORAGE_KEY, JSON.stringify([
    makeReview({ date: "2026-08-22" }),
  ]));
  storage.setItem(LEGACY_FINALIZED_DAY_STORAGE_KEY, JSON.stringify([
    makeDay("2026-08-22"),
  ]));
  const adapter = new MemoryHistoricalArchiveAdapter();
  adapter.fault = "write";
  const repository = new HistoricalArchiveRepository(adapter);
  const failed = await migrateLegacyHistoricalLocalStorage({ repository, storage });
  assert.equal(failed.ok, false);
  assert.ok(storage.getItem(LEGACY_REVIEW19_STORAGE_KEY));
  assert.ok(storage.getItem(LEGACY_FINALIZED_DAY_STORAGE_KEY));
  adapter.fault = null;
  const retried = await migrateLegacyHistoricalLocalStorage({ repository, storage });
  assert.equal(retried.ok, true);
  assert.equal((await repository.countReview19Records()).ok, true);
  assert.equal((await repository.countFinalizedDays()).ok, true);
});

await test("SecurityError during archive write retains source and errorName", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_REVIEW19_STORAGE_KEY, JSON.stringify([
    makeReview({ date: "2026-08-22" }),
  ]));
  const adapter = new MemoryHistoricalArchiveAdapter();
  adapter.fault = "write";
  adapter.faultError = new DOMException("fixture", "SecurityError");
  const result = await migrateLegacyHistoricalLocalStorage({
    repository: new HistoricalArchiveRepository(adapter),
    storage,
  });
  assert.equal(result.ok, false);
  assert.equal(result.review19.failure?.errorName, "SecurityError");
  assert.ok(storage.getItem(LEGACY_REVIEW19_STORAGE_KEY));
});

await test("transaction abort retains source and is retryable", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_FINALIZED_DAY_STORAGE_KEY, JSON.stringify([
    makeDay("2026-08-22"),
  ]));
  const adapter = new MemoryHistoricalArchiveAdapter();
  adapter.fault = "write";
  adapter.faultError = new DOMException("fixture", "AbortError");
  const repository = new HistoricalArchiveRepository(adapter);
  const failed = await migrateLegacyHistoricalLocalStorage({ repository, storage });
  assert.equal(failed.ok, false);
  assert.equal(failed.finalizedDays.failure?.errorName, "AbortError");
  assert.ok(storage.getItem(LEGACY_FINALIZED_DAY_STORAGE_KEY));
  adapter.fault = null;
  assert.equal(
    (await migrateLegacyHistoricalLocalStorage({ repository, storage })).ok,
    true,
  );
  assert.equal(storage.getItem(LEGACY_FINALIZED_DAY_STORAGE_KEY), null);
});

await test("read-back verification mismatch never removes legacy source", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_REVIEW19_STORAGE_KEY, JSON.stringify([
    makeReview({ date: "2026-08-22" }),
  ]));
  const repository = new HistoricalArchiveRepository(
    new VerifyMismatchAdapter(),
  );
  const failed = await migrateLegacyHistoricalLocalStorage({ repository, storage });
  assert.equal(failed.ok, false);
  assert.equal(failed.review19.failure?.errorName, "ArchiveVerificationError");
  assert.ok(storage.getItem(LEGACY_REVIEW19_STORAGE_KEY));
  const retried = await migrateLegacyHistoricalLocalStorage({ repository, storage });
  assert.equal(retried.ok, true);
  assert.equal(storage.getItem(LEGACY_REVIEW19_STORAGE_KEY), null);
});

await test("legacy remove failure keeps verified source and retry stays idempotent", async () => {
  const storage = new RemoveFailureStorage();
  const review = makeReview({ date: "2026-08-22" });
  storage.setItem(LEGACY_REVIEW19_STORAGE_KEY, JSON.stringify([review]));
  const repository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  const failed = await migrateLegacyHistoricalLocalStorage({ repository, storage });
  assert.equal(failed.ok, false);
  assert.equal(failed.review19.verified, true);
  assert.equal(failed.review19.sourceRemoved, false);
  assert.equal(failed.review19.failure?.errorName, "SecurityError");
  assert.ok(storage.getItem(LEGACY_REVIEW19_STORAGE_KEY));
  storage.failRemove = false;
  const retried = await migrateLegacyHistoricalLocalStorage({ repository, storage });
  assert.equal(retried.ok, true);
  const listed = await repository.listReview19Records();
  assert.equal(listed.ok && listed.value.length, 1);
});

await test("crash after archive write but before legacy removal is idempotent", async () => {
  const storage = new MemoryStorage();
  const review = makeReview({ date: "2026-08-23" });
  const day = makeDay("2026-08-23");
  storage.setItem(LEGACY_REVIEW19_STORAGE_KEY, JSON.stringify([review]));
  storage.setItem(LEGACY_FINALIZED_DAY_STORAGE_KEY, JSON.stringify([day]));
  const repository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  await repository.upsertReview19Records([review]);
  await repository.upsertFinalizedDays([day]);
  const migrated = await migrateLegacyHistoricalLocalStorage({ repository, storage });
  assert.equal(migrated.ok, true);
  assert.equal((await repository.countReview19Records()).ok, true);
  const reviews = await repository.listReview19Records();
  const days = await repository.listFinalizedDays();
  assert.equal(reviews.ok && reviews.value.length, 1);
  assert.equal(days.ok && days.value.length, 1);
});

await test("finalized metadata patches preserve rich core and stable identity", async () => {
  const repository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  const day = makeDay("2026-08-24");
  assert.equal((await repository.upsertFinalizedDays([day])).ok, true);
  const patched = await repository.patchFinalizedDayByRecordId({
    recordId: day.recordId,
    patch: { memo: "memo", discardCount: 7 },
  });
  assert.equal(patched.ok && patched.value?.memo, "memo");
  assert.equal(patched.ok && patched.value?.discardCount, 7);
  assert.equal(patched.ok && patched.value?.recordId, day.recordId);
  assert.equal(patched.ok && patched.value?.sessions.length, 0);
});

await test("malformed legacy input is never removed", async () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_REVIEW19_STORAGE_KEY, JSON.stringify([{ invalid: true }]));
  const repository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  const result = await migrateLegacyHistoricalLocalStorage({ repository, storage });
  assert.equal(result.ok, false);
  assert.ok(storage.getItem(LEGACY_REVIEW19_STORAGE_KEY));
  assert.equal(result.review19.failure?.errorName, "ArchiveVerificationError");
});

console.log(`Historical archive checks passed: ${passed}`);
