import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  HISTORICAL_ARCHIVE_AREA_COUNT_STORE,
  HISTORICAL_ARCHIVE_DAILY_SESSION_SNAPSHOT_STORE,
  HistoricalArchiveRepository,
  MemoryHistoricalArchiveAdapter,
  mergeDailySessionSnapshotArchiveOperations,
  migrateLegacyHistoricalLocalStorage,
} from "../src/domain/historicalArchive.ts";
import { collectAreaCountBackfillRecords } from "../src/domain/areaCountBackfill.ts";
import {
  mergeAreaCountRecordCollections,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import {
  NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES,
  upsertDailySessionSnapshotSafely,
} from "../src/domain/storage.ts";
import type {
  DailySessionSnapshot,
  DemandCycle,
} from "../src/domain/types.ts";

type MemoryStore = Parameters<MemoryHistoricalArchiveAdapter["getAll"]>[0];
type MemoryEntries = Parameters<MemoryHistoricalArchiveAdapter["putMany"]>[1];

class ReadBackMismatchAdapter extends MemoryHistoricalArchiveAdapter {
  private readonly targetStore: MemoryStore;
  private wroteTarget = false;

  constructor(targetStore: MemoryStore) {
    super();
    this.targetStore = targetStore;
  }

  override async putMany(store: MemoryStore, entries: MemoryEntries): Promise<void> {
    await super.putMany(store, entries);
    if (store === this.targetStore && entries.length > 0) this.wroteTarget = true;
  }

  override async getAll(
    store: MemoryStore,
  ): ReturnType<MemoryHistoricalArchiveAdapter["getAll"]> {
    const entries = await super.getAll(store);
    return store === this.targetStore && this.wroteTarget
      ? entries.slice(0, -1)
      : entries;
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  capacityBytes = Number.POSITIVE_INFINITY;
  failRemove = false;

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void {
    if (this.failRemove) {
      throw new DOMException("synthetic remove failure", "SecurityError");
    }
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    const serialized = String(value);
    const previous = this.values.get(key);
    const projected = this.totalApproxBytes()
      - (previous === undefined ? 0 : (key.length + previous.length) * 2)
      + (key.length + serialized.length) * 2;
    if (projected > this.capacityBytes) {
      throw new DOMException("synthetic localStorage quota", "QuotaExceededError");
    }
    this.values.set(key, serialized);
  }
  totalApproxBytes(): number {
    return [...this.values.entries()].reduce(
      (total, [key, value]) => total + (key.length + value.length) * 2,
      0,
    );
  }
  keyApproxBytes(key: string): number {
    const value = this.values.get(key);
    return value === undefined ? 0 : (key.length + value.length) * 2;
  }
}

function dateAt(offset: number): string {
  return new Date(Date.UTC(2025, 0, 1 + offset)).toISOString().slice(0, 10);
}

function makeSnapshot(params: {
  date: string;
  index: number;
  padding?: number;
  cycle?: DemandCycle;
}): DailySessionSnapshot {
  const hour = params.index % 2 === 0 ? "15" : "17";
  const discountTime = hour as "15" | "17";
  const minute = String(params.index % 60).padStart(2, "0");
  return {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-16-real-device-fixture",
    buildId: "build-real-device-fixture",
    capturedAt: `${params.date}T${hour}:55:${minute}.000+09:00`,
    demandCycle: params.cycle ?? "summer",
    sessionEndReason: params.index % 7 === 0
      ? "auto_time_transition"
      : "completed",
    screen: "done",
    session: {
      dataSchemaVersion: 3,
      appVersion: "2026.8.9-16-real-device-fixture",
      buildId: "build-real-device-fixture",
      date: params.date,
      weekday: params.index % 7,
      discountTime,
      demandCycle: params.cycle ?? "summer",
      startedAt: `${params.date}T${hour}:${minute}:00.000+09:00`,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather: {
        hourlyForecasts: createDefaultHourlyForecasts(),
        afterRainSky: null,
      },
      resolvedWeather: { weather: "sunny", tempC: 31, windMs: 2 },
    },
    basis: {
      baseRateBonus: 0,
      lateTimeBonus: 0,
      totalRateBonus: 0,
      baseRateBonusReason: [],
      noticeText: "historical-session-evidence-" +
        "s".repeat(params.padding ?? 28_000),
    },
    areas: {} as DailySessionSnapshot["areas"],
    doneSummaryItems: [],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  };
}

function makeAreaCount(params: {
  date: string;
  index: number;
  cycle?: DemandCycle;
}): AreaCountRecord {
  const hour = params.index % 2 === 0 ? "15" : "17";
  const minute = String(params.index % 60).padStart(2, "0");
  const millisecond = String(params.index % 1000).padStart(3, "0");
  return {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-16-real-device-fixture",
    buildId: "build-" + "a".repeat(250),
    demandCycle: params.cycle ?? "summer",
    date: params.date,
    sessionStartedAt: `${params.date}T${hour}:${minute}:00.${millisecond}+09:00`,
    recordedAt: `${params.date}T${hour}:${minute}:30.${millisecond}+09:00`,
    areaId: NORMAL_ROUTE[params.index % NORMAL_ROUTE.length]!,
    discountTime: hour as "15" | "17",
    actualWeekday: "火",
    actualWeekdayGroup: "火木日",
    count: 5 + (params.index % 25),
    suggestedEvaluation: "normal",
    evaluationSource: "history",
    areaRateAdjustment: 0,
    decisionBasis: {
      ruleVersion: "area_count_median_v1",
      demandCycle: params.cycle ?? "summer",
      evaluationSource: "history",
      recommendationStatus: "ready",
      actualWeekday: "火",
      actualWeekdayGroup: "火木日",
      comparisonMode: "actual_weekday",
      sampleSize: 12,
      requiredSampleSize: 3,
      medianCount: 12,
      shortMedianCount: 12,
      longMedianCount: 12,
      shortSampleSize: 12,
      longSampleSize: 24,
      finalEvaluation: "normal",
      areaRateAdjustment: 0,
    },
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
    .join(",")}}`;
}

function stableSha256(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

const storage = new MemoryStorage();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

try {
  const snapshots = Array.from({ length: 86 }, (_, index) => makeSnapshot({
    date: index === 85 ? "2026-08-30" : dateAt(index % 33),
    index,
  }));
  const areaRecords = Array.from({ length: 866 }, (_, index) => makeAreaCount({
    date: index === 865 ? "2026-08-30" : dateAt(index % 33),
    index,
    cycle: index % 5 === 0 ? "normal" : "summer",
  }));
  storage.setItem(
    "nebiki-helper/daily-session-snapshots",
    JSON.stringify(snapshots),
  );
  storage.setItem(
    "nebiki-helper/area-count-records-v2",
    JSON.stringify(areaRecords),
  );
  storage.setItem(
    "nebiki-helper/current-session",
    JSON.stringify({ screen: "start", session: { date: "2026-08-30" } }),
  );
  storage.setItem("nebiki-helper/pending-supabase-sync-v1", "[]");
  const beforeBytes = storage.totalApproxBytes();
  const beforeSnapshotBytes = storage.keyApproxBytes(
    "nebiki-helper/daily-session-snapshots",
  );
  const beforeAreaBytes = storage.keyApproxBytes(
    "nebiki-helper/area-count-records-v2",
  );
  assert.ok(beforeBytes > 6 * 1024 * 1024, { beforeBytes });

  const adapter = new MemoryHistoricalArchiveAdapter();
  const repository = new HistoricalArchiveRepository(adapter);
  const migrated = await migrateLegacyHistoricalLocalStorage({
    repository,
    storage,
    protectedDailySnapshotDates: ["2026-08-30"],
    protectedAreaCountDates: ["2026-08-30"],
  });
  assert.equal(migrated.ok, true);
  assert.equal(migrated.dailySessionSnapshots.sourceRecordCount, 86);
  assert.equal(migrated.areaCountRecords.sourceRecordCount, 866);
  assert.equal((await repository.countDailySessionSnapshots()).value, 86);
  assert.equal((await repository.countAreaCountRecords()).value, 866);
  assert.equal((await repository.countFinalizedDays()).value, 0);
  assert.equal(
    JSON.parse(storage.getItem("nebiki-helper/daily-session-snapshots") ?? "[]").length,
    1,
  );
  assert.equal(
    JSON.parse(storage.getItem("nebiki-helper/area-count-records-v2") ?? "[]").length,
    1,
  );
  const afterBytes = storage.totalApproxBytes();
  assert.ok(afterBytes < NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES, {
    afterBytes,
    softBudget: NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES,
  });
  assert.ok(
    NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES - afterBytes > 1024 * 1024,
    { afterBytes },
  );
  assert.equal(
    stableSha256((await repository.listDailySessionSnapshots()).value),
    stableSha256(mergeDailySessionSnapshotArchiveOperations(snapshots)),
  );
  assert.equal(
    stableSha256((await repository.listAreaCountRecords()).value),
    stableSha256(mergeAreaCountRecordCollections(normalizeAreaCountRecords(areaRecords))),
  );
  console.log("PASS 1: 実端末相当86 snapshots/33日 + 866 AreaCountを欠落なくarchiveしheadroom回復");

  // The operational journal starts small after migration. Exercise 15/17
  // AreaCount and session completion writes without re-growing history.
  const criticalDate = "2026-08-30";
  const criticalSnapshots: DailySessionSnapshot[] = [];
  const criticalAreas: AreaCountRecord[] = [];
  for (let sessionIndex = 0; sessionIndex < 2; sessionIndex += 1) {
    for (let areaIndex = 0; areaIndex < NORMAL_ROUTE.length; areaIndex += 1) {
      criticalAreas.push(makeAreaCount({
        date: criticalDate,
        index: sessionIndex * 60 + areaIndex,
        cycle: "summer",
      }));
    }
    criticalSnapshots.push(makeSnapshot({
      date: criticalDate,
      index: sessionIndex,
      padding: 1_000,
      cycle: "summer",
    }));
  }
  storage.setItem(
    "nebiki-helper/area-count-records-v2",
    JSON.stringify(criticalAreas),
  );
  for (const snapshot of criticalSnapshots) {
    const saved = upsertDailySessionSnapshotSafely(snapshot, {
      protectedDate: criticalDate,
    });
    assert.equal(saved.ok, true);
  }
  assert.ok(storage.totalApproxBytes() < NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES);
  console.log("PASS 2: 15/17各12エリアとscreen transition snapshotをheadroom内で保存");

  const backfill = collectAreaCountBackfillRecords({
    unifiedCacheRecords: (await repository.listAreaCountRecords()).value,
    dailySessionSnapshots: (await repository.listDailySessionSnapshots()).value,
    nowMs: Date.parse("2027-01-01T00:00:00.000Z"),
  });
  assert.equal(backfill.length, 866);
  console.log("PASS 3: archive後もmanual backfill evidenceをidentity dedupeして保持");

  // Migration failure never removes the source. Retry with the same stable
  // identities completes without duplicates.
  const failureStorage = new MemoryStorage();
  failureStorage.setItem(
    "nebiki-helper/daily-session-snapshots",
    JSON.stringify([snapshots[0]]),
  );
  failureStorage.setItem(
    "nebiki-helper/area-count-records-v2",
    JSON.stringify([areaRecords[0]]),
  );
  const failureAdapter = new MemoryHistoricalArchiveAdapter();
  failureAdapter.fault = "write";
  failureAdapter.faultError = new DOMException("blocked", "SecurityError");
  const failureRepository = new HistoricalArchiveRepository(failureAdapter);
  const failed = await migrateLegacyHistoricalLocalStorage({
    repository: failureRepository,
    storage: failureStorage,
  });
  assert.equal(failed.ok, false);
  assert.notEqual(
    failureStorage.getItem("nebiki-helper/daily-session-snapshots"),
    null,
  );
  assert.notEqual(
    failureStorage.getItem("nebiki-helper/area-count-records-v2"),
    null,
  );
  failureAdapter.fault = null;
  const retried = await migrateLegacyHistoricalLocalStorage({
    repository: failureRepository,
    storage: failureStorage,
  });
  assert.equal(retried.ok, true);
  assert.equal((await failureRepository.countDailySessionSnapshots()).value, 1);
  assert.equal((await failureRepository.countAreaCountRecords()).value, 1);
  console.log("PASS 4: IndexedDB SecurityError/write failureは原本保持し次回idempotent retry");

  const removeFailureStorage = new MemoryStorage();
  removeFailureStorage.setItem(
    "nebiki-helper/daily-session-snapshots",
    JSON.stringify([snapshots[1]]),
  );
  removeFailureStorage.setItem(
    "nebiki-helper/area-count-records-v2",
    JSON.stringify([areaRecords[1]]),
  );
  const removeFailureRepository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  removeFailureStorage.failRemove = true;
  const removeFailed = await migrateLegacyHistoricalLocalStorage({
    repository: removeFailureRepository,
    storage: removeFailureStorage,
  });
  assert.equal(removeFailed.ok, false);
  assert.notEqual(
    removeFailureStorage.getItem("nebiki-helper/daily-session-snapshots"),
    null,
  );
  removeFailureStorage.failRemove = false;
  const removeRetried = await migrateLegacyHistoricalLocalStorage({
    repository: removeFailureRepository,
    storage: removeFailureStorage,
  });
  assert.equal(removeRetried.ok, true);
  assert.equal((await removeFailureRepository.countDailySessionSnapshots()).value, 1);
  assert.equal((await removeFailureRepository.countAreaCountRecords()).value, 1);
  console.log("PASS 5: IDB commit後/local remove前crash相当も原本保持し重複なく完了");

  for (const targetStore of [
    HISTORICAL_ARCHIVE_DAILY_SESSION_SNAPSHOT_STORE,
    HISTORICAL_ARCHIVE_AREA_COUNT_STORE,
  ] as const) {
    const mismatchStorage = new MemoryStorage();
    mismatchStorage.setItem(
      "nebiki-helper/daily-session-snapshots",
      JSON.stringify([snapshots[2]]),
    );
    mismatchStorage.setItem(
      "nebiki-helper/area-count-records-v2",
      JSON.stringify([areaRecords[2]]),
    );
    const mismatch = await migrateLegacyHistoricalLocalStorage({
      repository: new HistoricalArchiveRepository(
        new ReadBackMismatchAdapter(targetStore),
      ),
      storage: mismatchStorage,
    });
    assert.equal(mismatch.ok, false);
    const sourceKey = targetStore === HISTORICAL_ARCHIVE_DAILY_SESSION_SNAPSHOT_STORE
      ? "nebiki-helper/daily-session-snapshots"
      : "nebiki-helper/area-count-records-v2";
    assert.notEqual(mismatchStorage.getItem(sourceKey), null);
  }
  console.log("PASS 6: daily/Area archive verify mismatchは対象localStorage原本を削除しない");

  // 360 days: historical archive grows, operational localStorage does not.
  const longRunStorage = new MemoryStorage();
  const longRunRepository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  const longRunSnapshots: DailySessionSnapshot[] = [];
  const longRunAreas: AreaCountRecord[] = [];
  for (let day = 0; day < 360; day += 1) {
    const date = dateAt(400 + day);
    longRunSnapshots.push(...[0, 1].map((index) => makeSnapshot({
      date,
      index,
      padding: 1_200,
      cycle: day % 4 === 0 ? "summer" : "normal",
    })));
    longRunAreas.push(...Array.from({ length: 24 }, (_, index) => makeAreaCount({
      date,
      index,
      cycle: day % 4 === 0 ? "summer" : "normal",
    })));
  }
  longRunStorage.setItem(
    "nebiki-helper/daily-session-snapshots",
    JSON.stringify(longRunSnapshots),
  );
  longRunStorage.setItem(
    "nebiki-helper/area-count-records-v2",
    JSON.stringify(longRunAreas),
  );
  const maximumLocalBytes = longRunStorage.totalApproxBytes();
  const longRunMigration = await migrateLegacyHistoricalLocalStorage({
    repository: longRunRepository,
    storage: longRunStorage,
  });
  assert.equal(longRunMigration.ok, true);
  const longRunAfterMigrationBytes = longRunStorage.totalApproxBytes();
  assert.ok(longRunAfterMigrationBytes < 1024);
  assert.equal((await longRunRepository.countDailySessionSnapshots()).value, 720);
  assert.equal((await longRunRepository.countAreaCountRecords()).value, 8_640);
  assert.equal((await longRunRepository.countFinalizedDays()).value, 0);
  console.log("PASS 7: 360営業日（formal finalized 0日を含む）でもlocalStorageは日数比例せずarchive履歴を保持");
  console.log(`INFO operational storage headroom: ${JSON.stringify({
    beforeKiB: Number((beforeBytes / 1024).toFixed(1)),
    beforeDailySnapshotsKiB: Number((beforeSnapshotBytes / 1024).toFixed(1)),
    beforeAreaCountKiB: Number((beforeAreaBytes / 1024).toFixed(1)),
    afterMigrationKiB: Number((afterBytes / 1024).toFixed(1)),
    criticalAfterKiB: Number((storage.totalApproxBytes() / 1024).toFixed(1)),
    recoveredPercent: Number(((1 - afterBytes / beforeBytes) * 100).toFixed(1)),
    minimumHeadroomKiB: Number(((NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES - Math.max(afterBytes, storage.totalApproxBytes())) / 1024).toFixed(1)),
    longRunLegacySourceBeforeMigrationKiB: Number((maximumLocalBytes / 1024).toFixed(1)),
    longRunAfterMigrationKiB: Number((longRunAfterMigrationBytes / 1024).toFixed(1)),
    archivedDailySnapshots: 720,
    archivedAreaCount: 8_640,
    archivedFinalizedDays: 0,
  })}`);
} finally {
  if (originalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}
