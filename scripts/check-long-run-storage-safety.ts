import assert from "node:assert/strict";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import { AREA_COUNT_LOCAL_STORAGE_KEY } from "../src/domain/areaCountLocalStorage.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { createReview19HumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import {
  buildReview19DataQuality,
  createInitialReview19Result,
} from "../src/domain/review19.ts";
import { persistCompletedReview19LocalFirst } from "../src/domain/review19CompletionStorage.ts";
import {
  PENDING_SUPABASE_SYNC_STORAGE_KEY,
} from "../src/domain/supabaseSyncQueue.ts";
import {
  STORAGE_KEYS,
  attemptStorageOperation,
  estimateLocalStorageEntryBytes,
  loadDailySessionSnapshots,
  releaseAuxiliaryStorageForReview19,
  retainDailySessionSnapshotsWithinBudget,
  upsertDailySessionSnapshotSafely,
} from "../src/domain/storage.ts";
import { FINALIZED_DAY_DATA_STORAGE_KEY } from "../src/domain/finalizedDayData.ts";
import type {
  AreaId,
  DailySessionSnapshot,
  DiscountTime,
  Review19AreaEvaluation,
  Review19Result,
} from "../src/domain/types.ts";
import { getNextDoneDiscountInfo } from "../src/hooks/nebikiApp/clock.ts";
import { buildAutoTimeSwitchDialogText } from "../src/hooks/nebikiApp/timeTransitions.ts";

class QuotaMemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  private capacityBytes = Number.POSITIVE_INFINITY;
  readonly setAttempts = new Map<string, number>();
  readonly removeAttempts: string[] = [];

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
    this.setAttempts.clear();
    this.removeAttempts.length = 0;
    this.capacityBytes = Number.POSITIVE_INFINITY;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.removeAttempts.push(key);
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    const serialized = String(value);
    this.setAttempts.set(key, (this.setAttempts.get(key) ?? 0) + 1);
    const previous = this.values.get(key);
    const projectedBytes =
      this.usedBytes() -
      (previous === undefined ? 0 : estimateLocalStorageEntryBytes(key, previous)) +
      estimateLocalStorageEntryBytes(key, serialized);
    if (projectedBytes > this.capacityBytes) {
      throw new DOMException("synthetic localStorage quota", "QuotaExceededError");
    }
    this.values.set(key, serialized);
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }

  setQuotaBytes(bytes: number): void {
    this.capacityBytes = Math.max(0, Math.floor(bytes));
  }

  usedBytes(): number {
    let total = 0;
    for (const [key, value] of this.values) {
      total += estimateLocalStorageEntryBytes(key, value);
    }
    return total;
  }

  entryBytes(key: string): number {
    const value = this.values.get(key);
    return value === undefined ? 0 : estimateLocalStorageEntryBytes(key, value);
  }
}

function makeSnapshot(params: {
  date: string;
  discountTime: DiscountTime;
  padding: number;
  startedMinute?: number;
}): DailySessionSnapshot {
  const startedMinute = params.startedMinute ?? 0;
  const hour = params.discountTime === "15" ? 15 : 17;
  const startedAt = `${params.date}T${String(hour).padStart(2, "0")}:${String(
    startedMinute,
  ).padStart(2, "0")}:00.000+09:00`;
  return {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-8-fixture",
    buildId: "build-long-run-storage-fixture",
    capturedAt: `${params.date}T18:00:00.000+09:00`,
    demandCycle: "normal",
    sessionEndReason: "completed",
    screen: "done",
    session: {
      dataSchemaVersion: 3,
      appVersion: "2026.8.9-8-fixture",
      buildId: "build-long-run-storage-fixture",
      date: params.date,
      weekday: 0,
      discountTime: params.discountTime,
      demandCycle: "normal",
      startedAt,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather: {
        hourlyForecasts: createDefaultHourlyForecasts(),
        afterRainSky: null,
      },
      resolvedWeather: {
        weather: "sunny",
        tempC: 28,
        windMs: 2,
      },
    },
    basis: {
      baseRateBonus: 0,
      lateTimeBonus: 0,
      totalRateBonus: 0,
      baseRateBonusReason: [],
      noticeText: "s".repeat(params.padding),
    },
    areas: {},
    doneSummaryItems: [],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  };
}

function makeCompleteReview19(date: string): Review19Result {
  const recordedAt = `${date}T19:05:00.000+09:00`;
  const initial = createInitialReview19Result({
    date,
    demandCycle: "normal",
    sessionStartedAt: `${date}T17:00:00.000+09:00`,
    reviewStartedAt: `${date}T19:00:00.000+09:00`,
  });
  const areaCounts: Partial<Record<AreaId, number>> = {};
  const areaCountRecordedAt: Partial<Record<AreaId, string>> = {};
  const areaEvaluations: Partial<Record<AreaId, Review19AreaEvaluation>> = {};

  for (const [index, areaId] of NORMAL_ROUTE.entries()) {
    areaCounts[areaId] = 10 + index;
    areaCountRecordedAt[areaId] = recordedAt;
    areaEvaluations[areaId] = {
      humanEvaluation: "normal",
      humanEvaluationDetails: createReview19HumanEvaluationDetails({
        selection: {
          humanEvaluationScore9: 5,
          humanEvaluationSelections: ["normal"],
        },
        demandCycle: "normal",
        evaluatedAt: recordedAt,
      }),
      autoEvaluation: null,
      autoEvaluationStatus: "insufficient",
    };
  }

  return {
    ...initial,
    areaCounts,
    areaCountRecordedAt,
    areaEvaluations,
    reviewCompletedAt: recordedAt,
    sourceUpdatedAt: recordedAt,
    recordedAt,
    dataQuality: buildReview19DataQuality({
      date,
      areaCounts,
      areaEvaluations,
      excludedAreaIds: [],
    }),
  };
}

function dateFromOffset(offset: number): string {
  const date = new Date(Date.UTC(2026, 4, 1 + offset));
  return date.toISOString().slice(0, 10);
}

function makeAreaCountHistory(count: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, index) => ({
      version: 2,
      identity: `fixture-area-${index}`,
      date: dateFromOffset(index % 75),
      discountTime: index % 2 === 0 ? "15" : "17",
      areaId: NORMAL_ROUTE[index % NORMAL_ROUTE.length],
      demandCycle: index % 5 === 0 ? "summer" : "normal",
      count: index % 37,
      areaCountEvaluation: index % 3 === 0 ? "few" : "normal",
      areaCountEvaluationSource: index % 7 === 0 ? "manual" : "history",
      recordedAt: `${dateFromOffset(index % 75)}T15:20:00.000+09:00`,
      recordDetails: {
        humanEvaluationScale: index % 7 === 0 ? 9 : null,
        humanEvaluationScore9: index % 7 === 0 ? 4 : null,
        diagnosticPadding: "a".repeat(120),
      },
    })),
  );
}

function formatKiB(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

const storage = new QuotaMemoryStorage();
const previousStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

const originalWarn = console.warn;
console.warn = () => undefined;

try {
  const initialSnapshots = Array.from({ length: 40 }, (_, dayIndex) => {
    const date = dateFromOffset(dayIndex);
    return (["15", "17"] as const).map((discountTime) =>
      makeSnapshot({ date, discountTime, padding: 3_000 }),
    );
  }).flat();
  const finalizedDates = [...new Set(initialSnapshots.map((item) => item.session.date))];
  const reviewRecords = Array.from({ length: 6 }, (_, index) =>
    makeCompleteReview19(dateFromOffset(60 + index)),
  );
  const pendingItems = Array.from({ length: 165 }, (_, index) => ({
    type: "area_count",
    identity: `pending-${index}`,
    payload: {
      date: dateFromOffset(index % 75),
      demand_cycle: index % 4 === 0 ? "summer" : "normal",
      area_id: NORMAL_ROUTE[index % NORMAL_ROUTE.length],
      record_details: { fixture: true, padding: "p".repeat(180) },
    },
    firstFailedAt: "2026-08-16T10:00:00.000+09:00",
    lastAttemptAt: "2026-08-16T10:01:00.000+09:00",
    attemptCount: 2,
    enqueuedAt: "2026-08-16T10:00:00.000+09:00",
    lastError: "HTTP 503 fixture",
  }));

  storage.seed(AREA_COUNT_LOCAL_STORAGE_KEY, makeAreaCountHistory(950));
  storage.seed(STORAGE_KEYS.review19Records, JSON.stringify(reviewRecords));
  storage.seed(PENDING_SUPABASE_SYNC_STORAGE_KEY, JSON.stringify(pendingItems));
  storage.seed(
    STORAGE_KEYS.currentSession,
    JSON.stringify({ date: "2026-08-16", screen: "done", state: "c".repeat(70_000) }),
  );
  storage.seed(
    STORAGE_KEYS.workSessionCheckpoint,
    JSON.stringify({ date: "2026-08-16", duplicate: "k".repeat(95_000) }),
  );
  storage.seed(
    STORAGE_KEYS.runtimeState,
    JSON.stringify({ screenHistory: ["r".repeat(135_000)] }),
  );
  storage.seed(STORAGE_KEYS.dailySessionSnapshots, JSON.stringify(initialSnapshots));
  storage.seed(
    FINALIZED_DAY_DATA_STORAGE_KEY,
    JSON.stringify(
      finalizedDates.map((date) => ({
        version: 1,
        date,
        sessions: [],
        areaCountRecords: [],
      })),
    ),
  );

  const authoritativeKeys = [
    AREA_COUNT_LOCAL_STORAGE_KEY,
    STORAGE_KEYS.review19Records,
    PENDING_SUPABASE_SYNC_STORAGE_KEY,
    STORAGE_KEYS.currentSession,
    FINALIZED_DAY_DATA_STORAGE_KEY,
  ];
  const authoritativeBefore = new Map(
    authoritativeKeys.map((key) => [key, storage.getItem(key)]),
  );
  const initialUsedBytes = storage.usedBytes();
  const targetSnapshot = makeSnapshot({
    date: "2026-08-16",
    discountTime: "15",
    padding: 80_000,
  });
  const expectedRetained = retainDailySessionSnapshotsWithinBudget(
    [...initialSnapshots, targetSnapshot],
    {
      protectedDates: ["2026-08-16"],
      finalizedDates: new Set(finalizedDates),
    },
  );
  const oldDailyBytes = storage.entryBytes(STORAGE_KEYS.dailySessionSnapshots);
  const expectedDailyBytes = estimateLocalStorageEntryBytes(
    STORAGE_KEYS.dailySessionSnapshots,
    JSON.stringify(expectedRetained.snapshots),
  );
  assert.ok(
    expectedDailyBytes < oldDailyBytes,
    `512KiB retention must compact the legacy snapshot set (${expectedDailyBytes} >= ${oldDailyBytes})`,
  );
  storage.setQuotaBytes(initialUsedBytes);

  const dailyAttemptOffset = storage.setAttempts.get(
    STORAGE_KEYS.dailySessionSnapshots,
  ) ?? 0;
  const dailyResult = upsertDailySessionSnapshotSafely(targetSnapshot, {
    protectedDate: "2026-08-16",
  });
  assert.equal(dailyResult.ok, true);
  assert.equal(dailyResult.quotaExceeded, false);
  assert.equal(dailyResult.retried, false);
  assert.equal(
    (storage.setAttempts.get(STORAGE_KEYS.dailySessionSnapshots) ?? 0) -
      dailyAttemptOffset,
    2,
    "one proactive retention write plus the target write must complete without a quota retry",
  );
  assert.deepEqual(storage.removeAttempts, [
    STORAGE_KEYS.runtimeState,
    STORAGE_KEYS.workSessionCheckpoint,
  ]);
  assert.equal(storage.getItem(STORAGE_KEYS.runtimeState), null);
  assert.equal(storage.getItem(STORAGE_KEYS.workSessionCheckpoint), null);
  for (const [key, raw] of authoritativeBefore) {
    assert.equal(storage.getItem(key), raw, `daily cleanup changed authoritative ${key}`);
  }
  assert.equal(
    loadDailySessionSnapshots().some(
      (item) =>
        item.session.date === "2026-08-16" &&
        item.session.discountTime === "15",
    ),
    true,
  );

  const nextInfo = getNextDoneDiscountInfo(
    "15",
    new Date(2026, 7, 16, 16, 40, 0, 0),
  );
  assert.equal(nextInfo?.canStart, true);
  assert.equal(nextInfo?.targetDiscountTime, "17");
  assert.match(
    buildAutoTimeSwitchDialogText({
      from: "15",
      to: "17",
      prioritizeUnfinishedAreas: false,
    }),
    /次の値引時刻に近づいたため/,
  );

  // Review19 9-7 safety regression under the same long-lived storage set:
  // local authoritative record first, cloud outbox second; only reconstructable
  // runtime/checkpoint copies may be released, and each write retries once.
  storage.setQuotaBytes(Number.POSITIVE_INFINITY);
  storage.seed(STORAGE_KEYS.runtimeState, JSON.stringify({ history: "x".repeat(90_000) }));
  storage.seed(
    STORAGE_KEYS.workSessionCheckpoint,
    JSON.stringify({ duplicate: "y".repeat(90_000) }),
  );
  const newReview = makeCompleteReview19("2026-08-16");
  const nextReviewRaw = JSON.stringify([...reviewRecords, newReview]);
  const nextPendingRaw = JSON.stringify([
    ...pendingItems,
    {
      type: "review19",
      identity: "review19-2026-08-16-normal",
      payload: newReview,
      firstFailedAt: null,
      lastAttemptAt: null,
      attemptCount: 0,
      enqueuedAt: newReview.recordedAt,
      lastError: null,
    },
  ]);
  const reviewGrowth =
    estimateLocalStorageEntryBytes(STORAGE_KEYS.review19Records, nextReviewRaw) -
    storage.entryBytes(STORAGE_KEYS.review19Records);
  assert.ok(reviewGrowth > 0);
  const beforeReviewUsed = storage.usedBytes();
  storage.setQuotaBytes(beforeReviewUsed + Math.floor(reviewGrowth / 2));
  const reviewSetOffset = storage.setAttempts.get(STORAGE_KEYS.review19Records) ?? 0;
  const protectedBeforeReview = new Map(
    [
      AREA_COUNT_LOCAL_STORAGE_KEY,
      STORAGE_KEYS.currentSession,
      FINALIZED_DAY_DATA_STORAGE_KEY,
      STORAGE_KEYS.dailySessionSnapshots,
    ].map((key) => [key, storage.getItem(key)]),
  );
  const reviewPersistence = persistCompletedReview19LocalFirst(newReview, {
    saveLocal: () =>
      attemptStorageOperation({
        key: STORAGE_KEYS.review19Records,
        operation: "set",
        run: () => localStorage.setItem(STORAGE_KEYS.review19Records, nextReviewRaw),
      }),
    enqueueCloud: () => {
      localStorage.setItem(PENDING_SUPABASE_SYNC_STORAGE_KEY, nextPendingRaw);
      return true;
    },
    releaseAuxiliary: releaseAuxiliaryStorageForReview19,
  });
  assert.equal(reviewPersistence.localSaved, true);
  assert.equal(reviewPersistence.cloudQueuePrepared, true);
  assert.equal(
    (storage.setAttempts.get(STORAGE_KEYS.review19Records) ?? 0) - reviewSetOffset,
    2,
    "Review19 local authoritative save must retry at most once",
  );
  assert.equal(storage.getItem(STORAGE_KEYS.review19Records), nextReviewRaw);
  assert.equal(storage.getItem(PENDING_SUPABASE_SYNC_STORAGE_KEY), nextPendingRaw);
  for (const [key, raw] of protectedBeforeReview) {
    assert.equal(storage.getItem(key), raw, `Review19 recovery changed ${key}`);
  }
  assert.equal(storage.getItem(STORAGE_KEYS.runtimeState), null);
  assert.equal(storage.getItem(STORAGE_KEYS.workSessionCheckpoint), null);

  const sizes = {
    areaCountRecords: 950,
    review19RecordsBefore: reviewRecords.length,
    pendingItemsBefore: pendingItems.length,
    dailySnapshotsBefore: initialSnapshots.length,
    dailySnapshotsAfterCompletion: dailyResult.retainedCount,
    dailySnapshotsPruned: dailyResult.prunedCount,
    initialTotalKiB: formatKiB(initialUsedBytes),
    areaCountKiB: formatKiB(
      estimateLocalStorageEntryBytes(
        AREA_COUNT_LOCAL_STORAGE_KEY,
        authoritativeBefore.get(AREA_COUNT_LOCAL_STORAGE_KEY) ?? "",
      ),
    ),
    review19KiB: formatKiB(
      estimateLocalStorageEntryBytes(
        STORAGE_KEYS.review19Records,
        authoritativeBefore.get(STORAGE_KEYS.review19Records) ?? "",
      ),
    ),
    pendingKiB: formatKiB(
      estimateLocalStorageEntryBytes(
        PENDING_SUPABASE_SYNC_STORAGE_KEY,
        authoritativeBefore.get(PENDING_SUPABASE_SYNC_STORAGE_KEY) ?? "",
      ),
    ),
    dailySnapshotsBeforeKiB: formatKiB(oldDailyBytes),
    dailySnapshotsAfterKiB: formatKiB(dailyResult.retainedApproxBytes),
    currentSessionKiB: formatKiB(storage.entryBytes(STORAGE_KEYS.currentSession)),
    runtimePlusCheckpointReleasedKiB: formatKiB(
      estimateLocalStorageEntryBytes(
        STORAGE_KEYS.runtimeState,
        JSON.stringify({ screenHistory: ["r".repeat(135_000)] }),
      ) +
        estimateLocalStorageEntryBytes(
          STORAGE_KEYS.workSessionCheckpoint,
          JSON.stringify({ date: "2026-08-16", duplicate: "k".repeat(95_000) }),
        ),
    ),
  };

  console.log("PASS long-run daily completion quota recovery");
  console.log("PASS authoritative keys byte-identical after derived cleanup");
  console.log("PASS 15→17 transition remains usable after snapshot quota failure");
  console.log("PASS Review19 local-first quota recovery regression");
  console.log(`INFO long-run UTF-16 storage sizes (KiB): ${JSON.stringify(sizes)}`);
} finally {
  console.warn = originalWarn;
  if (previousStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", previousStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}
