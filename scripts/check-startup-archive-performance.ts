import assert from "node:assert/strict";
import {
  HistoricalArchiveRepository,
  MemoryHistoricalArchiveAdapter,
  mergeDailySessionSnapshotArchiveOperations,
  mergeReview19ArchiveOperations,
} from "../src/domain/historicalArchive.ts";
import {
  getHistoricalArchiveRuntimeSnapshot,
  getHistoricalArchiveRuntimeStatus,
  initializeHistoricalArchiveRuntime,
  refreshHistoricalArchiveRuntime,
  type HistoricalArchiveRuntimeSnapshot,
} from "../src/domain/historicalArchiveRuntime.ts";
import {
  loadDailySessionSnapshots,
  loadReview19Records,
  STORAGE_KEYS,
} from "../src/domain/storage.ts";
import {
  AREA_COUNT_LOCAL_STORAGE_KEY,
  loadLocalAreaCountRecords,
} from "../src/domain/areaCountLocalStorage.ts";
import {
  mergeAreaCountRecordCollections,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import {
  FINALIZED_DAY_DATA_STORAGE_KEY,
  initializeFinalizedDayDataInMemory,
  loadFinalizedDayData,
  selectAllFinalizedDayData,
  type StoredFinalizedDayData,
} from "../src/domain/finalizedDayData.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { createInitialReview19Result } from "../src/domain/review19.ts";
import type { DailySessionSnapshot, Review19Result } from "../src/domain/types.ts";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  reads = 0;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { this.reads += 1; return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

class CapturingRepository extends HistoricalArchiveRepository {
  reviews: Review19Result[] = [];
  finalized: StoredFinalizedDayData[] = [];
  daily: DailySessionSnapshot[] = [];
  areas: AreaCountRecord[] = [];

  override async listReview19Records() {
    const result = await super.listReview19Records();
    if (result.ok) this.reviews = result.value;
    return result;
  }
  override async listFinalizedDays() {
    const result = await super.listFinalizedDays();
    if (result.ok) this.finalized = result.value;
    return result;
  }
  override async listDailySessionSnapshots() {
    const result = await super.listDailySessionSnapshots();
    if (result.ok) this.daily = result.value;
    return result;
  }
  override async listAreaCountRecords() {
    const result = await super.listAreaCountRecords();
    if (result.ok) this.areas = result.value;
    return result;
  }
}

const storage = new MemoryStorage();
Object.assign(globalThis, { localStorage: storage });
const adapter = new MemoryHistoricalArchiveAdapter();
const repository = new CapturingRepository(adapter);
const date = "2026-09-01";
const area: AreaCountRecord = {
  date, areaId: "bento_men", discountTime: "17", count: 12,
  demandCycle: "normal", actualWeekday: "火", actualWeekdayGroup: "火木日",
  sessionStartedAt: `${date}T08:00:00.000Z`, recordedAt: `${date}T08:01:00.000Z`,
  decisionBasis: { ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 3, requiredSampleSize: 3 },
};
const review = createInitialReview19Result({ date, sessionStartedAt: `${date}T10:00:00.000Z`, demandCycle: "normal" });
review.recordedAt = `${date}T10:01:00.000Z`;
review.areaCounts.bento_men = 12;
const daily: DailySessionSnapshot = {
  version: 1, dataSchemaVersion: 3, appVersion: "2026.8.9-37",
  capturedAt: `${date}T08:30:00.000Z`, screen: "done", demandCycle: "normal",
  session: {
    date, weekday: 2, discountTime: "17", demandCycle: "normal",
    startedAt: `${date}T08:00:00.000Z`, manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
    resolvedWeather: { weather: "sunny", tempC: 25, windMs: 2 },
  },
  basis: { baseRateBonus: 0, lateTimeBonus: 0, totalRateBonus: 0, baseRateBonusReason: [] },
  areas: {} as DailySessionSnapshot["areas"], doneSummaryItems: [], currentAreaId: null, review19ExcludedAreaIds: [],
};
const finalized = initializeFinalizedDayDataInMemory({
  currentRecords: [],
  daySnapshot: { version: 1, date, capturedAt: `${date}T12:00:00.000Z`, review19Status: "not_performed", sessions: [daily], areaCountRecords: [area] },
}).record;
await repository.upsertReview19Records([review]);
await repository.upsertFinalizedDays([finalized]);
await repository.upsertDailySessionSnapshots([daily]);
await repository.upsertAreaCountRecords([area]);

let checks = 0;
function check(name: string, run: () => void): void { run(); checks += 1; console.log(`PASS: ${name}`); }
const stringify = JSON.stringify;
const serializedCopy = <T>(value: T): T => JSON.parse(stringify(value)) as T;
let internalSnapshot: HistoricalArchiveRuntimeSnapshot | null = null;
JSON.stringify = ((value: unknown, ...args: unknown[]) => {
  if (value && typeof value === "object" && "status" in value && "review19Records" in value && "dailySessionSnapshots" in value) {
    internalSnapshot = value as HistoricalArchiveRuntimeSnapshot;
  }
  return Reflect.apply(stringify, JSON, [value, ...args]);
}) as typeof JSON.stringify;
let initialized: HistoricalArchiveRuntimeSnapshot;
try { initialized = await initializeHistoricalArchiveRuntime({ repository, storage }); }
finally { JSON.stringify = stringify; }

check("hydration reuses canonical repository arrays when operational fallback is empty", () => {
  assert.ok(internalSnapshot);
  assert.equal(internalSnapshot.review19Records, repository.reviews);
  assert.equal(internalSnapshot.finalizedDayRecords, repository.finalized);
  assert.equal(internalSnapshot.dailySessionSnapshots, repository.daily);
  assert.equal(internalSnapshot.areaCountRecords, repository.areas);
});
check("empty-fallback output equals the prior normalize/merge pipeline", () => {
  assert.deepEqual(initialized.review19Records, serializedCopy(mergeReview19ArchiveOperations(repository.reviews)));
  assert.deepEqual(initialized.finalizedDayRecords, serializedCopy(selectAllFinalizedDayData(repository.finalized)));
  assert.deepEqual(initialized.dailySessionSnapshots, serializedCopy(mergeDailySessionSnapshotArchiveOperations(repository.daily)));
  assert.deepEqual(initialized.areaCountRecords, serializedCopy(mergeAreaCountRecordCollections(repository.areas, [])));
  assert.equal(initialized.status, "complete");
});
check("readiness polling does not clone, parse or read storage", () => {
  let stringifies = 0;
  let parses = 0;
  const parse = JSON.parse;
  storage.reads = 0;
  JSON.stringify = ((...args: unknown[]) => { stringifies += 1; return Reflect.apply(stringify, JSON, args); }) as typeof JSON.stringify;
  JSON.parse = ((...args: unknown[]) => { parses += 1; return Reflect.apply(parse, JSON, args); }) as typeof JSON.parse;
  try { for (let index = 0; index < 1000; index += 1) assert.equal(getHistoricalArchiveRuntimeStatus(), "complete"); }
  finally { JSON.stringify = stringify; JSON.parse = parse; }
  assert.equal(stringifies, 0);
  assert.equal(parses, 0);
  assert.equal(storage.reads, 0);
});
check("public snapshot getter retains detached nested copies", () => {
  initialized.areaCountRecords[0].count = 999;
  initialized.dailySessionSnapshots[0].session.weather.hourlyForecasts["17"].tempC = 99;
  const current = getHistoricalArchiveRuntimeSnapshot();
  assert.equal(current.areaCountRecords[0].count, 12);
  assert.notEqual(current.dailySessionSnapshots[0].session.weather.hourlyForecasts["17"].tempC, 99);
});

storage.setItem(STORAGE_KEYS.review19Records, JSON.stringify([{ ...review, recordedAt: `${date}T10:02:00.000Z`, sourceUpdatedAt: `${date}T10:02:00.000Z`, areaCounts: { bento_men: 18 } }]));
storage.setItem(FINALIZED_DAY_DATA_STORAGE_KEY, JSON.stringify([{ ...finalized, memo: "operational overlap" }]));
storage.setItem(STORAGE_KEYS.dailySessionSnapshots, JSON.stringify([{ ...daily, capturedAt: `${date}T08:31:00.000Z` }]));
storage.setItem(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify([{ ...area, recordedAt: `${date}T08:02:00.000Z`, count: 18 }]));
const fallback = {
  reviews: loadReview19Records(), finalized: loadFinalizedDayData(),
  daily: loadDailySessionSnapshots(), areas: loadLocalAreaCountRecords(),
};
const refreshed = await refreshHistoricalArchiveRuntime();
check("nonempty local-first fallback retains canonical overlap merge", () => {
  assert.deepEqual(refreshed.review19Records, serializedCopy(mergeReview19ArchiveOperations([...repository.reviews, ...fallback.reviews])));
  assert.deepEqual(refreshed.finalizedDayRecords, serializedCopy(selectAllFinalizedDayData([...repository.finalized, ...fallback.finalized])));
  assert.deepEqual(refreshed.dailySessionSnapshots, serializedCopy(mergeDailySessionSnapshotArchiveOperations([...repository.daily, ...fallback.daily])));
  assert.deepEqual(refreshed.areaCountRecords, serializedCopy(mergeAreaCountRecordCollections(repository.areas, fallback.areas)));
});
const beforeFailure = [...storage.values.entries()];
adapter.fault = "read";
const failed = await refreshHistoricalArchiveRuntime();
check("archive read failure preserves operational recovery and failure readiness", () => {
  assert.equal(failed.status, "partial");
  assert.equal(getHistoricalArchiveRuntimeStatus(), "partial");
  assert.deepEqual(failed.review19Records, serializedCopy(fallback.reviews));
  assert.deepEqual(failed.finalizedDayRecords, serializedCopy(fallback.finalized));
  assert.deepEqual(failed.dailySessionSnapshots, serializedCopy(fallback.daily));
  assert.deepEqual(failed.areaCountRecords, serializedCopy(fallback.areas));
  assert.deepEqual([...storage.values.entries()], beforeFailure);
});
console.log(`Startup archive performance checks passed: ${checks}/${checks}`);
