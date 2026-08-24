import assert from "node:assert/strict";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  AREA_COUNT_LOCAL_CACHE_BYTE_BUDGET,
  estimateAreaCountCacheBytes,
  isAreaCountRecordCoveredByRemote,
  retainAreaCountLocalCacheWithinBudget,
} from "../src/domain/areaCountCache.ts";
import {
  getAreaCountRecommendation,
  getAreaCountRecordIdentity,
  mergeAreaCountRecordCollections,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import {
  AREA_COUNT_LOCAL_STORAGE_KEY,
  LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY,
  LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY,
  isLegacyAreaCountStorageFullyCovered,
  loadLegacySummerAreaCountRecords,
  loadUnifiedAreaCountRecords,
  replaceUnifiedAreaCountRecords,
} from "../src/domain/areaCountLocalStorage.ts";
import {
  AREA_COUNT_REMOTE_PAGE_SIZE,
  buildRemoteAreaCountRow,
  loadRemoteAreaCountRecords,
} from "../src/domain/areaCountRemoteStorage.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { createReview19HumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import {
  buildReview19DataQuality,
  createInitialReview19Result,
} from "../src/domain/review19.ts";
import { persistCompletedReview19LocalFirst } from "../src/domain/review19CompletionStorage.ts";
import {
  loadPendingSupabaseSyncQueue,
  PENDING_SUPABASE_SYNC_STORAGE_KEY,
} from "../src/domain/supabaseSyncQueue.ts";
import {
  STORAGE_KEYS,
  estimateLocalStorageEntryBytes,
  loadPersistedNebikiStateForDate,
  loadReview19Records,
  runStartupStorageHousekeeping,
} from "../src/domain/storage.ts";
import { FINALIZED_DAY_DATA_STORAGE_KEY } from "../src/domain/finalizedDayData.ts";
import {
  createInitialState,
  normalizeLoadedState,
} from "../src/hooks/nebikiApp/stateNormalization.ts";
import type {
  AppState,
  AreaId,
  DailySessionSnapshot,
  DemandCycle,
  DiscountTime,
  Review19AreaEvaluation,
  Review19Result,
  SessionData,
} from "../src/domain/types.ts";

class QuotaMemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  private quotaBytes = Number.POSITIVE_INFINITY;
  readonly writes = new Map<string, number>();
  readonly removals: string[] = [];

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
    this.writes.clear();
    this.removals.length = 0;
    this.quotaBytes = Number.POSITIVE_INFINITY;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.removals.push(key);
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    const serialized = String(value);
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
    const previous = this.values.get(key);
    const projected =
      this.usedBytes() -
      (previous === undefined
        ? 0
        : estimateLocalStorageEntryBytes(key, previous)) +
      estimateLocalStorageEntryBytes(key, serialized);
    if (projected > this.quotaBytes) {
      throw new DOMException("fixture origin quota", "QuotaExceededError");
    }
    this.values.set(key, serialized);
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }

  setQuota(bytes: number): void {
    this.quotaBytes = Math.max(0, Math.floor(bytes));
  }

  usedBytes(): number {
    let total = 0;
    for (const [key, value] of this.values) {
      total += estimateLocalStorageEntryBytes(key, value);
    }
    return total;
  }

  sizes(): Array<{ key: string; bytes: number }> {
    return [...this.values.entries()]
      .map(([key, value]) => ({
        key,
        bytes: estimateLocalStorageEntryBytes(key, value),
      }))
      .sort((left, right) => right.bytes - left.bytes);
  }

  entries(): Array<[string, string]> {
    return [...this.values.entries()];
  }
}

function buildAnonymousStorageAudit(storage: QuotaMemoryStorage): Array<{
  key: string;
  recordCount: number | null;
  jsonChars: number;
  utf8Bytes: number;
  utf16Bytes: number;
  percent: number;
}> {
  const entries = storage.entries();
  const totalBytes = storage.usedBytes();
  return entries
    .map(([key, value]) => {
      let recordCount: number | null = null;
      try {
        const parsed: unknown = JSON.parse(value);
        recordCount = Array.isArray(parsed) ? parsed.length : parsed === null ? 0 : 1;
      } catch {
        recordCount = null;
      }
      const utf16Bytes = estimateLocalStorageEntryBytes(key, value);
      return {
        key,
        recordCount,
        jsonChars: value.length,
        utf8Bytes: Buffer.byteLength(value, "utf8"),
        utf16Bytes,
        percent: Number(((utf16Bytes / totalBytes) * 100).toFixed(2)),
      };
    })
    .sort((left, right) => right.utf16Bytes - left.utf16Bytes);
}

function dateFromOffset(offset: number): string {
  const date = new Date(Date.UTC(2020, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}

function makeAreaCountRecord(index: number, overrides: Partial<AreaCountRecord> = {}): AreaCountRecord {
  const date = overrides.date ?? dateFromOffset(index);
  const demandCycle = overrides.demandCycle ?? (index % 5 === 0 ? "summer" : "normal");
  const discountTime = overrides.discountTime ?? (index % 2 === 0 ? "15" : "17");
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"] as const;
  return {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-11-fixture",
    buildId: "build-quota-root-fixture",
    date,
    sessionStartedAt: `${date}T${discountTime === "15" ? "06" : "08"}:${String(index % 60).padStart(2, "0")}:00.000Z`,
    recordedAt: `${date}T${discountTime === "15" ? "06" : "08"}:${String(index % 60).padStart(2, "0")}:30.000Z`,
    areaId: overrides.areaId ?? NORMAL_ROUTE[index % NORMAL_ROUTE.length]!,
    discountTime,
    actualWeekday: weekdayLabels[weekday],
    actualWeekdayGroup: weekday === 1 || weekday === 3
      ? "月水"
      : weekday === 5 || weekday === 6
        ? discountTime === "15" ? "金土日" : "金土"
        : discountTime === "15" ? "火木" : "火木日",
    count: index % 41,
    demandCycle,
    suggestedEvaluation: index % 3 === 0 ? "few" : "normal",
    evaluationSource: "history",
    decisionBasis: {
      ruleVersion: "area_count_median_v1",
      demandCycle,
      evaluationSource: "history",
      recommendationStatus: "ready",
      sampleSize: 3,
      requiredSampleSize: 3,
      finalEvaluation: index % 3 === 0 ? "few" : "normal",
    },
    analysisWeatherContext: {
      weatherDataSource: "entered_hourly_forecast",
      forecastWeatherClass: "dry",
      hasForecastPrecipitation: false,
      forecastPrecipitationTypes: [],
    },
    ...overrides,
  };
}

function makeUnstoredCompleteReview19State(date = "2026-08-24"): AppState {
  const initial = createInitialState();
  const sessionStartedAt = `${date}T08:00:00.000Z`;
  const recordedAt = `${date}T10:05:00.000Z`;
  const demandCycle: DemandCycle = "summer";
  const session: SessionData = {
    ...initial.sessionDraft,
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-11",
    buildId: "build-20260824-203336-jst",
    date,
    weekday: 1,
    discountTime: "17",
    demandCycle,
    startedAt: sessionStartedAt,
    weather: {
      hourlyForecasts: createDefaultHourlyForecasts(),
      afterRainSky: null,
    },
  };
  const review = createInitialReview19Result({
    date,
    demandCycle,
    sessionStartedAt,
    reviewStartedAt: `${date}T10:00:00.000Z`,
  });
  const areaCounts: Partial<Record<AreaId, number>> = {};
  const areaCountRecordedAt: Partial<Record<AreaId, string>> = {};
  const areaEvaluations: Partial<Record<AreaId, Review19AreaEvaluation>> = {};
  for (const [index, areaId] of NORMAL_ROUTE.entries()) {
    areaCounts[areaId] = index + 1;
    areaCountRecordedAt[areaId] = recordedAt;
    areaEvaluations[areaId] = {
      humanEvaluation: "slightly_few",
      humanEvaluationDetails: createReview19HumanEvaluationDetails({
        selection: {
          humanEvaluationScore9: 3,
          humanEvaluationSelections: ["slightly_few"],
        },
        demandCycle,
        evaluatedAt: recordedAt,
      }),
      autoEvaluation: null,
      autoEvaluationStatus: "insufficient",
    };
  }
  const completedReview: Review19Result = {
    ...review,
    areaCounts,
    areaCountRecordedAt,
    areaEvaluations,
    dataQuality: buildReview19DataQuality({
      date,
      areaCounts,
      areaEvaluations,
      excludedAreaIds: [],
    }),
  };
  return {
    ...initial,
    screen: "review19",
    session,
    sessionDraft: { ...session },
    review19: completedReview,
  };
}

function finalizeUnstoredReview19(review: Review19Result): Review19Result {
  const timestamp = `${review.date}T10:06:00.000Z`;
  return {
    ...review,
    reviewCompletedAt: timestamp,
    sourceUpdatedAt: timestamp,
    recordedAt: timestamp,
  };
}

function makeDailySnapshot(
  date: string,
  discountTime: DiscountTime,
  padding = 3_000,
): DailySessionSnapshot {
  return {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-11-fixture",
    buildId: "build-quota-root-fixture",
    capturedAt: `${date}T18:00:00.000+09:00`,
    demandCycle: "normal",
    sessionEndReason: "completed",
    screen: "done",
    session: {
      dataSchemaVersion: 3,
      appVersion: "2026.8.9-11-fixture",
      buildId: "build-quota-root-fixture",
      date,
      weekday: 1,
      discountTime,
      demandCycle: "normal",
      startedAt: `${date}T${discountTime === "15" ? "15" : "17"}:00:00.000+09:00`,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather: {
        hourlyForecasts: createDefaultHourlyForecasts(),
        afterRainSky: null,
      },
      resolvedWeather: { weather: "sunny", tempC: 28, windMs: 2 },
    },
    basis: {
      baseRateBonus: 0,
      lateTimeBonus: 0,
      totalRateBonus: 0,
      baseRateBonusReason: [],
      noticeText: "snapshot".repeat(Math.ceil(padding / 8)).slice(0, padding),
    },
    areas: {},
    doneSummaryItems: [],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  };
}

function pendingFixture(record: AreaCountRecord) {
  return {
    type: "area_count",
    identity: getAreaCountRecordIdentity(record),
    payload: record,
    firstFailedAt: "2026-08-24T10:00:00.000Z",
    lastAttemptAt: "2026-08-24T10:01:00.000Z",
    attemptCount: 1,
    enqueuedAt: "2026-08-24T10:00:00.000Z",
    lastError: "HTTP 503 fixture",
  };
}

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

const storage = new QuotaMemoryStorage();
const previousStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});
const originalWarn = console.warn;
console.warn = () => undefined;

try {
  await test("legacy summer/normalはunifiedに完全包含される場合だけ削除する", () => {
    storage.clear();
    const normal = makeAreaCountRecord(1, { demandCycle: "normal" });
    const summer = makeAreaCountRecord(2, { demandCycle: "summer" });
    storage.seed(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify([normal, summer]));
    storage.seed(LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY, JSON.stringify([normal]));
    storage.seed(LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY, JSON.stringify([summer]));
    assert.equal(isLegacyAreaCountStorageFullyCovered(LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY), true);
    assert.equal(isLegacyAreaCountStorageFullyCovered(LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY), true);
    runStartupStorageHousekeeping({ protectedDates: ["2026-08-24"] });
    assert.equal(storage.getItem(LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY), null);
    assert.equal(storage.getItem(LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY), null);
    const unified = loadUnifiedAreaCountRecords();
    assert.equal(unified.length, 2);
    assert.deepEqual(
      unified.map(getAreaCountRecordIdentity),
      mergeAreaCountRecordCollections([normal, summer]).map(
        getAreaCountRecordIdentity,
      ),
    );
  });

  await test("mirror-onlyまたはricher legacy recordはstartupで削除しない", () => {
    storage.clear();
    const unified = makeAreaCountRecord(3, { demandCycle: "summer" });
    const richer = { ...unified, comfortPoint: 2 };
    storage.seed(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify([unified]));
    storage.seed(LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY, JSON.stringify([richer]));
    runStartupStorageHousekeeping({ protectedDates: ["2026-08-24"] });
    assert.equal(loadLegacySummerAreaCountRecords().length, 1);
    assert.equal(loadLegacySummerAreaCountRecords()[0]?.comfortPoint, 2);
  });

  await test("remote-confirmedはidentity/revision/detailをすべて確認する", () => {
    const local = makeAreaCountRecord(4);
    assert.equal(isAreaCountRecordCoveredByRemote({ local, remote: { ...local } }), true);
    assert.equal(
      isAreaCountRecordCoveredByRemote({
        local,
        remote: { ...local, recordedAt: "2019-01-01T00:00:00.000Z" },
      }),
      false,
    );
    const withoutDetails = { ...local };
    delete withoutDetails.decisionBasis;
    assert.equal(
      isAreaCountRecordCoveredByRemote({ local, remote: withoutDetails }),
      false,
    );
  });

  await test("2,000件cacheはpending/current/local-onlyを保護しremote-confirmedだけ整理する", () => {
    const remote = Array.from({ length: 2_000 }, (_, index) => makeAreaCountRecord(index));
    const localOnly = makeAreaCountRecord(2_500, { count: 99 });
    const pending = remote[0]!;
    const current = remote[1]!;
    const local = [...remote, localOnly];
    const retained = retainAreaCountLocalCacheWithinBudget({
      localRecords: local,
      remoteRecords: remote,
      pendingIdentities: new Set([getAreaCountRecordIdentity(pending)]),
      protectedDates: new Set([current.date]),
    });
    const identities = new Set(retained.records.map(getAreaCountRecordIdentity));
    assert.equal(identities.has(getAreaCountRecordIdentity(localOnly)), true);
    assert.equal(identities.has(getAreaCountRecordIdentity(pending)), true);
    assert.equal(identities.has(getAreaCountRecordIdentity(current)), true);
    assert.ok(retained.evictedCount > 0);
    assert.ok(retained.retainedCount < local.length);
    assert.equal(retained.byteBudget, AREA_COUNT_LOCAL_CACHE_BYTE_BUDGET);
  });

  await test("remote/local同一identityは中央値母集団で1件にdedupeし判定は不変", () => {
    const remote = [0, 7, 14, 21].map((offset, index) =>
      makeAreaCountRecord(3_000 + index, {
        date: dateFromOffset(2_000 + offset),
        areaId: "sushi",
        discountTime: "17",
        demandCycle: "normal",
        actualWeekday: "水",
        actualWeekdayGroup: "月水",
        count: 20,
      }),
    );
    const merged = mergeAreaCountRecordCollections(remote, [remote[0]!]);
    assert.equal(merged.length, remote.length);
    const params = {
      areaId: "sushi" as const,
      discountTime: "17" as const,
      weekday: 3,
      date: dateFromOffset(2_100),
      demandCycle: "normal" as const,
      count: 20,
      applyObonRule: true,
    };
    assert.deepEqual(
      getAreaCountRecommendation({ ...params, records: merged }),
      getAreaCountRecommendation({ ...params, records: remote }),
    );
  });

  await test("AreaCount remote GETは2,000件超をcycle別に全page取得する", async () => {
    const records = Array.from({ length: 2_005 }, (_, index) =>
      makeAreaCountRecord(5_000 + index, { demandCycle: "normal" }),
    );
    const rows = records.map(buildRemoteAreaCountRow);
    const offsets: number[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? AREA_COUNT_REMOTE_PAGE_SIZE);
      offsets.push(offset);
      return new Response(JSON.stringify(rows.slice(offset, offset + limit)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const result = await loadRemoteAreaCountRecords("normal", {
      config: { url: "https://example.supabase.co", anonKey: "fixture-anon" },
      fetchImpl,
    });
    assert.equal(result.status, "ready");
    if (result.status === "ready") assert.equal(result.records.length, 2_005);
    assert.deepEqual(offsets, [0, 1_000, 2_000]);
  });

  await test("9-11 current-sessionの12/12未保存Review19を日付跨ぎreload後も保持する", () => {
    storage.clear();
    const source = makeUnstoredCompleteReview19State();
    storage.seed(STORAGE_KEYS.currentSession, JSON.stringify(source));
    const persisted = loadPersistedNebikiStateForDate("2026-08-25");
    assert.ok(persisted.currentSession);
    assert.equal(storage.getItem(STORAGE_KEYS.currentSession), JSON.stringify(source));
    const restored = normalizeLoadedState(
      persisted.currentSession,
      source.sessionDraft,
    );
    assert.equal(restored.screen, "review19");
    assert.equal(restored.review19?.dataQuality.complete, true);
    assert.equal(Object.keys(restored.review19?.areaCounts ?? {}).length, 12);
    assert.equal(
      restored.review19?.areaEvaluations?.sushi?.humanEvaluationDetails
        ?.humanEvaluationScore9,
      3,
    );

    const alreadyDone = normalizeLoadedState(
      { ...source, screen: "review19_done", review19: finalizeUnstoredReview19(source.review19!) },
      source.sessionDraft,
    );
    assert.equal(alreadyDone.screen, "start");
    assert.equal(alreadyDone.review19, null);
  });

  await test("near-quota startupで12/12/pendingを保持しmirror解放後にReview19を正式保存する", () => {
    storage.clear();
    const active = makeUnstoredCompleteReview19State();
    const areaRecords = Array.from({ length: 950 }, (_, index) => makeAreaCountRecord(8_000 + index));
    const summerMirror = areaRecords.filter((record) => record.demandCycle === "summer");
    const protectedPending = pendingFixture(areaRecords[0]!);
    storage.seed(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(areaRecords));
    storage.seed(LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY, JSON.stringify(summerMirror));
    storage.seed(PENDING_SUPABASE_SYNC_STORAGE_KEY, JSON.stringify([protectedPending]));
    storage.seed(STORAGE_KEYS.currentSession, JSON.stringify(active));
    storage.seed(STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(active));
    storage.seed(STORAGE_KEYS.runtimeState, JSON.stringify({ screenHistory: [{ state: active }] }));
    storage.seed(STORAGE_KEYS.review19SourceState, JSON.stringify(active));
    storage.seed(STORAGE_KEYS.review19Records, "[]");
    storage.seed(STORAGE_KEYS.dailySessionSnapshots, "[]");
    storage.seed(FINALIZED_DAY_DATA_STORAGE_KEY, "[]");

    const currentRaw = storage.getItem(STORAGE_KEYS.currentSession);
    const pendingRaw = storage.getItem(PENDING_SUPABASE_SYNC_STORAGE_KEY);
    const sourceRaw = storage.getItem(STORAGE_KEYS.review19SourceState);
    const beforeBytes = storage.usedBytes();
    storage.setQuota(beforeBytes + 1_024);
    const housekeeping = runStartupStorageHousekeeping({
      protectedDates: [active.review19!.date],
    });
    assert.equal(housekeeping.removedLegacyKeys.includes(LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY), true);
    assert.equal(storage.getItem(STORAGE_KEYS.currentSession), currentRaw);
    assert.equal(storage.getItem(PENDING_SUPABASE_SYNC_STORAGE_KEY), pendingRaw);
    assert.equal(storage.getItem(STORAGE_KEYS.review19SourceState), sourceRaw);

    const restored = normalizeLoadedState(
      JSON.parse(currentRaw!) as AppState,
      active.sessionDraft,
    );
    const finalRecord = finalizeUnstoredReview19(restored.review19!);
    const completion = persistCompletedReview19LocalFirst(finalRecord);
    assert.equal(completion.localSaved, true);
    assert.equal(completion.cloudQueuePrepared, true);
    assert.equal(loadReview19Records().length, 1);
    assert.equal(loadPendingSupabaseSyncQueue().some((item) => item.type === "review19"), true);
    assert.equal(storage.getItem(STORAGE_KEYS.currentSession), currentRaw);

    const duplicateAttempt = persistCompletedReview19LocalFirst(finalRecord);
    assert.equal(duplicateAttempt.localSaved, true);
    assert.equal(loadReview19Records().length, 1);
    assert.equal(
      loadPendingSupabaseSyncQueue().filter((item) => item.type === "review19").length,
      1,
    );
  });

  await test("remote unavailableではformal AreaCountをpruneせず不足時はQuota失敗を返す", () => {
    storage.clear();
    const active = makeUnstoredCompleteReview19State();
    const local = Array.from({ length: 40 }, (_, index) => makeAreaCountRecord(10_000 + index));
    storage.seed(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(local));
    storage.seed(STORAGE_KEYS.currentSession, JSON.stringify(active));
    storage.seed(STORAGE_KEYS.review19Records, "[]");
    storage.seed(PENDING_SUPABASE_SYNC_STORAGE_KEY, "[]");
    const retained = retainAreaCountLocalCacheWithinBudget({
      localRecords: local,
      remoteRecords: [],
      byteBudget: 0,
    });
    assert.equal(retained.evictedCount, 0);
    assert.equal(retained.records.length, local.length);
    storage.setQuota(storage.usedBytes());
    const currentRaw = storage.getItem(STORAGE_KEYS.currentSession);
    const result = persistCompletedReview19LocalFirst(
      finalizeUnstoredReview19(active.review19!),
    );
    assert.equal(result.localSaved, false);
    assert.equal(result.localAttempts.length, 2);
    assert.equal(result.localResult.ok, false);
    if (!result.localResult.ok) {
      assert.equal(result.localResult.errorName, "QuotaExceededError");
      assert.equal(result.localResult.quotaExceeded, true);
    }
    assert.equal(storage.getItem(STORAGE_KEYS.currentSession), currentRaw);
    assert.equal(loadUnifiedAreaCountRecords().length, local.length);
  });

  await test("匿名long-run fixtureで修正前後容量とtop5を実測する", () => {
    storage.clear();
    const records = Array.from({ length: 2_000 }, (_, index) => makeAreaCountRecord(12_000 + index));
    const mirror = records.filter((record) => record.demandCycle === "summer");
    const active = makeUnstoredCompleteReview19State();
    const snapshotDates = Array.from({ length: 40 }, (_, index) =>
      dateFromOffset(2_500 + index),
    );
    const dailySnapshots = snapshotDates.flatMap((date) => [
      makeDailySnapshot(date, "15"),
      makeDailySnapshot(date, "17"),
    ]);
    const historicalReviews = Array.from({ length: 6 }, (_, index) => {
      const reviewState = makeUnstoredCompleteReview19State(
        dateFromOffset(2_600 + index),
      );
      const finalized = finalizeUnstoredReview19(reviewState.review19!);
      return {
        ...finalized,
        daySnapshot: {
          version: 1 as const,
          capturedAt: finalized.recordedAt!,
          date: finalized.date,
          demandCycle: finalized.demandCycle,
          review19Status: "recorded" as const,
          sessions: [makeDailySnapshot(finalized.date, "17", 1_000)],
          areaCountRecords: records.slice(index * 40, index * 40 + 40),
        },
      };
    });
    storage.seed(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(records));
    storage.seed(LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY, JSON.stringify(mirror));
    storage.seed(STORAGE_KEYS.currentSession, JSON.stringify(active));
    storage.seed(STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(active));
    storage.seed(STORAGE_KEYS.runtimeState, JSON.stringify({ screenHistory: Array.from({ length: 8 }, () => ({ state: active })) }));
    storage.seed(STORAGE_KEYS.review19SourceState, JSON.stringify(active));
    storage.seed(STORAGE_KEYS.review19Records, JSON.stringify(historicalReviews));
    storage.seed(PENDING_SUPABASE_SYNC_STORAGE_KEY, JSON.stringify(Array.from({ length: 100 }, (_, index) => pendingFixture(records[index]!))));
    storage.seed(STORAGE_KEYS.dailySessionSnapshots, JSON.stringify(dailySnapshots));
    storage.seed(
      FINALIZED_DAY_DATA_STORAGE_KEY,
      JSON.stringify(
        snapshotDates.map((date) => ({
          version: 1,
          date,
          sessions: [],
          areaCountRecords: [],
        })),
      ),
    );
    storage.seed(STORAGE_KEYS.nextSessionSkipRecords, "[]");
    storage.seed(STORAGE_KEYS.lastSessionWeather, "null");
    storage.seed(STORAGE_KEYS.lastUsedSessionDraft, JSON.stringify(active.sessionDraft));
    storage.seed(STORAGE_KEYS.dailyMessageState, "{}");
    storage.seed(STORAGE_KEYS.finalDayAutoExportDates, "[]");
    storage.seed("nebiki-helper/demand-cycle-state-v1", JSON.stringify({ selectedCycle: "summer" }));
    storage.seed("nebiki-helper/fixed-time-demand-cycle-state-v1", JSON.stringify({ selectedCycle: "normal" }));

    const before = storage.usedBytes();
    const beforeAudit = buildAnonymousStorageAudit(storage);
    const beforeTop5 = storage.sizes().slice(0, 5);
    runStartupStorageHousekeeping({ protectedDates: ["2026-08-24"] });
    const pendingIdentities = new Set(
      loadPendingSupabaseSyncQueue()
        .filter((item) => item.type === "area_count")
        .map((item) => item.identity),
    );
    const retention = retainAreaCountLocalCacheWithinBudget({
      localRecords: loadUnifiedAreaCountRecords(),
      remoteRecords: records,
      pendingIdentities,
      protectedDates: new Set(["2026-08-24"]),
    });
    replaceUnifiedAreaCountRecords(retention.records);
    const after = storage.usedBytes();
    const afterTop5 = storage.sizes().slice(0, 5);
    assert.ok(after < before);
    assert.ok(retention.evictedCount > 0);
    assert.ok(estimateAreaCountCacheBytes(retention.records) <= AREA_COUNT_LOCAL_CACHE_BYTE_BUDGET || retention.protectedDataExceededBudget);
    const summary = {
      beforeKiB: Number((before / 1024).toFixed(1)),
      afterKiB: Number((after / 1024).toFixed(1)),
      reductionPercent: Number((((before - after) / before) * 100).toFixed(1)),
      areaRecordsBefore: records.length,
      areaRecordsAfter: retention.retainedCount,
      beforeTop5: beforeTop5.map((entry) => ({ key: entry.key, KiB: Number((entry.bytes / 1024).toFixed(1)) })),
      afterTop5: afterTop5.map((entry) => ({ key: entry.key, KiB: Number((entry.bytes / 1024).toFixed(1)) })),
    };
    console.log(`INFO quota-root storage comparison=${JSON.stringify(summary)}`);
    console.log(`INFO quota-root key audit=${JSON.stringify(beforeAudit)}`);
  });
} finally {
  console.warn = originalWarn;
  if (previousStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", previousStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}

console.log(`Quota root-fix checks passed: ${passed}/${passed}`);
