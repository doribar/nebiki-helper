import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  HistoricalArchiveRepository,
  LEGACY_FINALIZED_DAY_STORAGE_KEY,
  LEGACY_REVIEW19_STORAGE_KEY,
  MemoryHistoricalArchiveAdapter,
} from "../src/domain/historicalArchive.ts";
import {
  cacheRemoteReview19InHistoricalArchive,
  getHistoricalArchiveRuntimeSnapshot,
  initializeArchivedFinalizedDay,
  initializeHistoricalArchiveRuntime,
  refreshHistoricalArchiveRuntime,
  saveReview19ToHistoricalArchive,
} from "../src/domain/historicalArchiveRuntime.ts";
import {
  enqueueReview19RecordForCloud,
  persistAreaCountRecordLocalFirstSafely,
} from "../src/domain/cloudSync.ts";
import { persistCompletedReview19LocalFirstAsync } from "../src/domain/review19CompletionStorage.ts";
import { releaseAuxiliaryStorageForReview19 } from "../src/domain/storage.ts";
import type { AreaCountRecord } from "../src/domain/areaCountHistory.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { createReview19HumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import {
  buildReview19DataQuality,
  createInitialReview19Result,
} from "../src/domain/review19.ts";
import { buildReview19AutomaticEvaluation } from "../src/domain/review19Evaluation.ts";
import {
  buildAllFinalizedDayDataExportPayloadsByDemandCycle,
  buildAllReview19DataExportPayloadsByDemandCycle,
} from "../src/domain/separateDataExport.ts";
import type {
  AreaId,
  DailySessionSnapshot,
  DemandCycle,
  Review19AreaEvaluation,
  Review19DayCheckSnapshot,
  Review19DaySnapshot,
  Review19Result,
} from "../src/domain/types.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  private capacityBytes = Number.POSITIVE_INFINITY;

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
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

  setCapacityBytes(value: number): void {
    this.capacityBytes = value;
  }

  totalApproxBytes(): number {
    let total = 0;
    for (const [key, value] of this.values) total += (key.length + value.length) * 2;
    return total;
  }

  topEntrySizes(limit = 5): Array<{ key: string; KiB: number }> {
    return [...this.values.entries()]
      .map(([key, value]) => ({
        key,
        KiB: Number((((key.length + value.length) * 2) / 1024).toFixed(1)),
      }))
      .sort((left, right) => right.KiB - left.KiB)
      .slice(0, limit);
  }
}

function dateFromOffset(offset: number): string {
  const date = new Date(Date.UTC(2025, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}

function makeOperationalAreaCount(date: string, index = 0): AreaCountRecord {
  const minute = String(index % 60).padStart(2, "0");
  return {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-16-fixture",
    buildId: "build-archive-long-run-fixture",
    date,
    sessionStartedAt: date + "T08:" + minute + ":00.000Z",
    recordedAt: date + "T08:" + minute + ":30.000Z",
    areaId: NORMAL_ROUTE[index % NORMAL_ROUTE.length]!,
    discountTime: "17",
    actualWeekday: "火",
    actualWeekdayGroup: "火木日",
    count: 8 + (index % 15),
    demandCycle: "normal",
    suggestedEvaluation: "normal",
    evaluationSource: "history",
    decisionBasis: {
      ruleVersion: "area_count_median_v1",
      demandCycle: "normal",
      evaluationSource: "history",
      recommendationStatus: "ready",
      sampleSize: 3,
      requiredSampleSize: 3,
      finalEvaluation: "normal",
    },
  };
}

function makeSession(params: {
  date: string;
  cycle: DemandCycle;
  discountTime: "15" | "17";
  padding: number;
}): DailySessionSnapshot {
  const startedAt = `${params.date}T${params.discountTime}:00:00.000+09:00`;
  return {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-15-fixture",
    buildId: "build-archive-long-run-fixture",
    capturedAt: `${params.date}T${params.discountTime}:45:00.000+09:00`,
    demandCycle: params.cycle,
    sessionEndReason: "completed",
    screen: "done",
    session: {
      dataSchemaVersion: 3,
      appVersion: "2026.8.9-15-fixture",
      buildId: "build-archive-long-run-fixture",
      date: params.date,
      weekday: 2,
      discountTime: params.discountTime,
      demandCycle: params.cycle,
      startedAt,
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
      noticeText: `anonymous-rich-session-${params.discountTime}-` +
        "x".repeat(params.padding),
    },
    areas: {} as DailySessionSnapshot["areas"],
    doneSummaryItems: [],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  };
}

function makeDayBase(params: {
  date: string;
  cycle: DemandCycle;
  padding?: number;
}): Review19DaySnapshot {
  const padding = params.padding ?? 2_500;
  return {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-15-fixture",
    buildId: "build-archive-long-run-fixture",
    capturedAt: `${params.date}T20:35:00.000+09:00`,
    date: params.date,
    demandCycle: params.cycle,
    review19Status: "not_performed",
    sessions: [
      makeSession({
        date: params.date,
        cycle: params.cycle,
        discountTime: "15",
        padding,
      }),
      makeSession({
        date: params.date,
        cycle: params.cycle,
        discountTime: "17",
        padding,
      }),
    ],
    areaCountRecords: [],
  };
}

function makeReview(params: {
  date: string;
  cycle: DemandCycle;
  sessionStartedAt?: string;
  padding?: number;
}): Review19Result {
  const recordedAt = `${params.date}T19:05:00.000+09:00`;
  const initial = createInitialReview19Result({
    date: params.date,
    demandCycle: params.cycle,
    sessionStartedAt:
      params.sessionStartedAt ?? `${params.date}T19:00:00.000+09:00`,
    reviewStartedAt: `${params.date}T19:00:00.000+09:00`,
  });
  const areaCounts: Partial<Record<AreaId, number>> = {};
  const areaCountRecordedAt: Partial<Record<AreaId, string>> = {};
  const areaEvaluations: Partial<Record<AreaId, Review19AreaEvaluation>> = {};
  for (const [index, areaId] of NORMAL_ROUTE.entries()) {
    areaCounts[areaId] = 8 + index;
    areaCountRecordedAt[areaId] = recordedAt;
    areaEvaluations[areaId] = {
      autoEvaluation: "normal",
      autoEvaluationStatus: "ready",
      humanEvaluation: "normal",
      humanEvaluationDetails: createReview19HumanEvaluationDetails({
        selection: {
          humanEvaluationScore9: 5,
          humanEvaluationSelections: ["normal"],
        },
        demandCycle: params.cycle,
        evaluatedAt: recordedAt,
      }),
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
    daySnapshot: makeDayBase({
      date: params.date,
      cycle: params.cycle,
      padding: params.padding,
    }),
    dataQuality: buildReview19DataQuality({
      date: params.date,
      areaCounts,
      areaEvaluations,
      excludedAreaIds: [],
    }),
  };
}

function makeFinalizedDay(params: {
  date: string;
  cycle: DemandCycle;
  review: Review19Result;
  padding?: number;
}) {
  const base = makeDayBase(params);
  const review19Check: Review19DayCheckSnapshot = {
    version: 1,
    dataSchemaVersion: params.review.dataSchemaVersion,
    appVersion: params.review.appVersion,
    buildId: params.review.buildId,
    demandCycle: params.cycle,
    review19Status: params.review.review19Status,
    recordedAt: params.review.recordedAt ?? params.review.sourceUpdatedAt ?? "",
    sessionStartedAt: params.review.sessionStartedAt,
    reviewStartedAt: params.review.reviewStartedAt,
    reviewCompletedAt: params.review.reviewCompletedAt,
    sourceUpdatedAt: params.review.sourceUpdatedAt,
    areaCountRecordedAt: params.review.areaCountRecordedAt,
    ratingStatus: params.review.ratingStatus,
    ratings: params.review.ratings,
    ratingScores: params.review.ratingScores,
    areaCounts: params.review.areaCounts,
    areaEvaluations: params.review.areaEvaluations,
    excludedAreaIds: params.review.excludedAreaIds,
    excludeReasons: params.review.excludeReasons,
    dataQuality: params.review.dataQuality,
  };
  return {
    ...base,
    review19Status: "recorded" as const,
    review19Check,
    recordId: `nebiki-day:${params.date}`,
    finalizedAt: `${params.date}T20:40:00.000+09:00`,
    memo: `anonymous-day-${params.date}`,
    discardCount: 4,
  };
}

function makeHistory(startOffset: number, count: number) {
  const reviews: Review19Result[] = [];
  const days: ReturnType<typeof makeFinalizedDay>[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = dateFromOffset(startOffset + index);
    const cycle: DemandCycle = index % 5 === 0 ? "summer" : "normal";
    const review = makeReview({ date, cycle });
    reviews.push(review);
    days.push(makeFinalizedDay({ date, cycle, review }));
  }
  return { reviews, days };
}

const storage = new MemoryStorage();
const originalStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

try {
  const history = makeHistory(0, 180);
  const fixtureExportedAt = "2026-08-30T00:00:00.000Z";
  const reviewExportBefore = buildAllReview19DataExportPayloadsByDemandCycle({
    records: history.reviews,
    exportedAt: fixtureExportedAt,
  });
  const dayExportBefore = buildAllFinalizedDayDataExportPayloadsByDemandCycle({
    records: history.days,
    exportedAt: fixtureExportedAt,
  });
  const medianBefore = buildReview19AutomaticEvaluation({
    areaId: "bento_men",
    count: 12,
    date: "2025-07-01",
    weekday: 2,
    demandCycle: "normal",
    historicalRecords: history.reviews,
  });
  const operationalValues = new Map<string, string>([
    ["nebiki-helper/current-session", JSON.stringify({
      date: dateFromOffset(180),
      screen: "area",
      recovery: "c".repeat(35_000),
    })],
    ["nebiki-helper/work-session-checkpoint", JSON.stringify({
      date: dateFromOffset(180),
      checkpoint: "k".repeat(18_000),
    })],
    ["nebiki-helper/pending-supabase-sync-v1", JSON.stringify([
      { type: "review19", payload: { kind: "review19_ref_v1" } },
    ])],
    ["nebiki-helper/area-count-records-v2", JSON.stringify(
      Array.from({ length: 240 }, (_, index) =>
        makeOperationalAreaCount(dateFromOffset(index), index),
      ),
    )],
    ["nebiki-helper/daily-session-snapshots", JSON.stringify(
      Array.from({ length: 12 }, (_, index) => ({
        date: dateFromOffset(168 + index),
        crashRecovery: "s".repeat(1_500),
      })),
    )],
  ]);
  for (const [key, value] of operationalValues) storage.setItem(key, value);
  storage.setItem(LEGACY_REVIEW19_STORAGE_KEY, JSON.stringify(history.reviews));
  storage.setItem(LEGACY_FINALIZED_DAY_STORAGE_KEY, JSON.stringify(history.days));
  const beforeBytes = storage.totalApproxBytes();
  const beforeTop5 = storage.topEntrySizes();

  const repository = new HistoricalArchiveRepository(
    new MemoryHistoricalArchiveAdapter(),
  );
  const initialized = await initializeHistoricalArchiveRuntime({
    repository,
    storage,
  });
  assert.equal(initialized.status, "complete");
  assert.equal(initialized.migration?.ok, true);
  assert.equal(initialized.review19Records.length, 180);
  assert.equal(initialized.finalizedDayRecords.length, 180);
  assert.deepEqual(
    buildAllReview19DataExportPayloadsByDemandCycle({
      records: initialized.review19Records,
      exportedAt: fixtureExportedAt,
    }),
    reviewExportBefore,
  );
  assert.deepEqual(
    buildAllFinalizedDayDataExportPayloadsByDemandCycle({
      records: initialized.finalizedDayRecords,
      exportedAt: fixtureExportedAt,
    }),
    dayExportBefore,
  );
  assert.deepEqual(
    buildReview19AutomaticEvaluation({
      areaId: "bento_men",
      count: 12,
      date: "2025-07-01",
      weekday: 2,
      demandCycle: "normal",
      historicalRecords: initialized.review19Records,
    }),
    medianBefore,
  );
  assert.equal(storage.getItem(LEGACY_REVIEW19_STORAGE_KEY), null);
  assert.equal(storage.getItem(LEGACY_FINALIZED_DAY_STORAGE_KEY), null);
  for (const [key, expected] of operationalValues) {
    assert.equal(storage.getItem(key), expected, `migration changed ${key}`);
  }
  const afterMigrationBytes = storage.totalApproxBytes();
  const afterTop5 = storage.topEntrySizes();
  assert.ok(afterMigrationBytes < beforeBytes * 0.35, {
    beforeBytes,
    afterMigrationBytes,
  });
  console.log("PASS 1: 180営業日rich historyをarchiveへ移しexport・median・operational原本を維持");

  storage.setCapacityBytes(Math.floor(2.25 * 1024 * 1024));
  const operationalDate = history.reviews.at(-1)!.date;
  const areaSaved = persistAreaCountRecordLocalFirstSafely(
    makeOperationalAreaCount(operationalDate, 999),
  );
  assert.equal(areaSaved.localSaved, true);
  assert.equal(areaSaved.cloudQueuePrepared, true);
  const reviewSaved = await persistCompletedReview19LocalFirstAsync(
    history.reviews.at(-1)!,
    {
      saveAuthoritative: saveReview19ToHistoricalArchive,
      enqueueCloud: enqueueReview19RecordForCloud,
      releaseAuxiliary: releaseAuxiliaryStorageForReview19,
    },
  );
  assert.equal(reviewSaved.localSaved, true);
  assert.equal(reviewSaved.cloudQueuePrepared, true);
  const finalizedSaved = await initializeArchivedFinalizedDay({
    daySnapshot: history.days.at(-1)!,
    finalizedAt: history.days.at(-1)!.finalizedAt,
  });
  assert.equal(finalizedSaved.ok, true);
  assert.ok(storage.totalApproxBytes() < 2.25 * 1024 * 1024);
  console.log("PASS 2: migration直後の17時AreaCount・Review19・20:30 finalized重要保存がheadroom内で成功");

  const sameSession = "2027-01-01T19:00:00.000+09:00";
  const normal = makeReview({
    date: "2027-01-01",
    cycle: "normal",
    sessionStartedAt: sameSession,
    padding: 100,
  });
  const summer = makeReview({
    date: "2027-01-01",
    cycle: "summer",
    sessionStartedAt: sameSession,
    padding: 100,
  });
  assert.equal((await repository.upsertReview19Records([normal, summer])).ok, true);
  const refreshed = await refreshHistoricalArchiveRuntime();
  const cyclePair = refreshed.review19Records.filter(
    (record) =>
      record.date === "2027-01-01" &&
      record.sessionStartedAt === sameSession,
  );
  assert.deepEqual(
    cyclePair.map((record) => record.demandCycle).sort(),
    ["normal", "summer"],
  );
  console.log("PASS 3: runtime hydrateもnormal/summer operation identityを分離");

  const remoteHistory = makeHistory(300, 120).reviews;
  const beforeRemoteBytes = storage.totalApproxBytes();
  const remoteCached = await cacheRemoteReview19InHistoricalArchive(remoteHistory);
  assert.equal(remoteCached.ok, true);
  assert.equal(storage.getItem(LEGACY_REVIEW19_STORAGE_KEY), null);
  assert.equal(storage.totalApproxBytes(), beforeRemoteBytes);
  const runtimeAfterRemote = getHistoricalArchiveRuntimeSnapshot();
  assert.equal(runtimeAfterRemote.review19Records.length, 302);
  console.log("PASS 4: remote Review19 120件をlocalStorageへ再materializeしない");

  const future = makeHistory(500, 180);
  const steadyLocalBytes = storage.totalApproxBytes();
  assert.equal((await repository.upsertReview19Records(future.reviews)).ok, true);
  assert.equal((await repository.upsertFinalizedDays(future.days)).ok, true);
  assert.equal(storage.totalApproxBytes(), steadyLocalBytes);
  const reviewCount = await repository.countReview19Records();
  const finalizedCount = await repository.countFinalizedDays();
  assert.equal(reviewCount.ok && reviewCount.value, 482);
  assert.equal(finalizedCount.ok && finalizedCount.value, 360);
  console.log("PASS 5: 追加180営業日後もlocalStorage totalは増加しない");

  const hookSource = readFileSync(
    new URL("../src/hooks/useNebikiApp.ts", import.meta.url),
    "utf8",
  );
  assert.match(hookSource, /cacheRemoteReview19InHistoricalArchive/);
  assert.doesNotMatch(hookSource, /saveReview19Records/);
  console.log("PASS 6: production remote hydrateにlegacy localStorage writerなし");

  console.log(`INFO historical archive long-run UTF-16 bytes: ${JSON.stringify({
    beforeMigrationKiB: Number((beforeBytes / 1024).toFixed(1)),
    afterMigrationKiB: Number((afterMigrationBytes / 1024).toFixed(1)),
    afterAdditional180KiB: Number((storage.totalApproxBytes() / 1024).toFixed(1)),
    releasedPercent: Number(((1 - afterMigrationBytes / beforeBytes) * 100).toFixed(1)),
    archivedReview19: reviewCount.ok ? reviewCount.value : null,
    archivedFinalizedDays: finalizedCount.ok ? finalizedCount.value : null,
    beforeTop5,
    afterTop5,
  })}`);
} finally {
  if (originalStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}
