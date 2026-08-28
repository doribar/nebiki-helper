import assert from "node:assert/strict";
import {
  cleanupReview19Debug20260825,
  excludeReview19Debug20260825Target,
  REVIEW19_DEBUG_20260825_AREA_IDS,
  REVIEW19_DEBUG_20260825_TARGET,
} from "../src/domain/maintenance/cleanupReview19Debug20260825.ts";
import { buildReview19DataQuality, normalizeReview19Result } from "../src/domain/review19.ts";
import {
  buildAllFinalizedDayDataExportPayload,
  buildAllReview19DataExportPayload,
} from "../src/domain/separateDataExport.ts";
import { buildAllDataExportPayload } from "../src/domain/allDataExport.ts";
import { syncAuthoritativeReview19RecordsDirectly } from "../src/domain/cloudSync.ts";
import { STORAGE_KEYS } from "../src/domain/storage.ts";
import { PENDING_SUPABASE_SYNC_STORAGE_KEY } from "../src/domain/supabaseSyncQueue.ts";
import { FINALIZED_DAY_DATA_STORAGE_KEY } from "../src/domain/finalizedDayData.ts";
import type { AreaId, Review19Result } from "../src/domain/types.ts";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  seed(key: string, value: unknown): void {
    this.values.set(key, JSON.stringify(value));
  }

  read<T>(key: string): T {
    return JSON.parse(this.values.get(key) ?? "null") as T;
  }
}

class FailingWriteStorage extends MemoryStorage {
  override setItem(): void {
    const error = new Error("maintenance write denied");
    error.name = "SecurityError";
    throw error;
  }
}

const TARGET_AREA_IDS = [...REVIEW19_DEBUG_20260825_AREA_IDS];

function areaCounts(value: number): Record<AreaId, number> {
  return Object.fromEntries(
    TARGET_AREA_IDS.map((areaId) => [areaId, value]),
  ) as Record<AreaId, number>;
}

function areaTimestamps(timestamp: string): Record<AreaId, string> {
  return Object.fromEntries(
    TARGET_AREA_IDS.map((areaId) => [areaId, timestamp]),
  ) as Record<AreaId, string>;
}

function makeReview19(params: {
  date: string;
  sessionStartedAt: string;
  count?: number;
  demandCycle?: "normal" | "summer";
  appVersion?: string;
}): Review19Result {
  const count = params.count ?? 1;
  const demandCycle = params.demandCycle ?? "summer";
  const appVersion = params.appVersion ?? "2026.8.9-14";
  const recordedAt = `${params.date}T10:05:00.000Z`;
  const counts = areaCounts(count);
  const areaEvaluations = Object.fromEntries(
    TARGET_AREA_IDS.map((areaId) => [
      areaId,
      {
        autoEvaluation: "normal",
        autoEvaluationStatus: "ready",
        humanEvaluation: "normal",
      },
    ]),
  ) as Review19Result["areaEvaluations"];
  return {
    dataSchemaVersion: 3,
    appVersion,
    buildId: `fixture-${params.date}`,
    review19Status: "recorded",
    date: params.date,
    demandCycle,
    sessionStartedAt: params.sessionStartedAt,
    reviewStartedAt: params.sessionStartedAt,
    reviewCompletedAt: recordedAt,
    sourceUpdatedAt: recordedAt,
    areaCountRecordedAt: areaTimestamps(recordedAt),
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCounts: counts,
    areaEvaluations,
    excludedAreaIds: [],
    excludeReasons: {},
    dataQuality: buildReview19DataQuality({
      date: params.date,
      areaCounts: counts,
      areaEvaluations: areaEvaluations ?? {},
      excludedAreaIds: [],
      review19Status: "recorded",
    }),
    recordedAt,
  };
}

function makeTargetReview19(): Review19Result {
  return makeReview19({
    date: REVIEW19_DEBUG_20260825_TARGET.date,
    sessionStartedAt: REVIEW19_DEBUG_20260825_TARGET.sessionStartedAt,
    count: 0,
    demandCycle: REVIEW19_DEBUG_20260825_TARGET.demandCycle,
    appVersion: REVIEW19_DEBUG_20260825_TARGET.appVersion,
  });
}

function makePendingItem(payload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    type: "review19",
    identity: JSON.stringify(["2026-08-25", "summer"]),
    payload,
    firstFailedAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    enqueuedAt: "2026-08-25T10:06:00.000Z",
    lastError: null,
    ...overrides,
  };
}

function makeTargetReference() {
  return {
    kind: "review19_ref_v1",
    date: REVIEW19_DEBUG_20260825_TARGET.date,
    demandCycle: REVIEW19_DEBUG_20260825_TARGET.demandCycle,
    sessionStartedAt: REVIEW19_DEBUG_20260825_TARGET.sessionStartedAt,
    sourceUpdatedAt: "2026-08-25T10:05:00.000Z",
    recordedAt: "2026-08-25T10:05:00.000Z",
    complete: true,
  };
}

function makeState(review19: Review19Result | null) {
  return {
    screen: review19 ? "review19_done" : "start",
    review19,
    session: {
      date: "2026-08-25",
      startedAt: REVIEW19_DEBUG_20260825_TARGET.sessionStartedAt,
    },
    sentinel: { keep: "unchanged" },
  };
}

function makeOperationSession(discountTime: "15" | "17", startedAt: string) {
  return {
    version: 1,
    capturedAt: `${startedAt.slice(0, 11)}10:00:00.000Z`,
    demandCycle: "summer",
    screen: "done",
    session: {
      date: "2026-08-25",
      startedAt,
      discountTime,
      demandCycle: "summer",
    },
    areas: {
      bento_men: {
        status: "completed",
        areaCount: 3,
        areaCountEvaluation: "few",
        areaCountEvaluationSource: "history",
        rateDecisionSnapshotStatus: "legacy_not_captured",
      },
    },
  };
}

function makeAreaCountRecord(discountTime: "15" | "17", startedAt: string) {
  return {
    date: "2026-08-25",
    demandCycle: "summer",
    sessionStartedAt: startedAt,
    recordedAt: `${startedAt.slice(0, 11)}10:00:00.000Z`,
    areaId: "bento_men",
    discountTime,
    actualWeekdayGroup: "火木",
    count: 3,
    suggestedEvaluation: "few",
    evaluationSource: "history",
  };
}

function makeTargetDayCheck() {
  const target = makeTargetReview19();
  const { date: _date, ...withoutDate } = target;
  void _date;
  return {
    version: 1,
    ...withoutDate,
  };
}

function makeFinalizedDay() {
  const started15 = "2026-08-25T06:00:00.000Z";
  const started17 = "2026-08-25T08:00:00.000Z";
  return {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-12",
    buildId: "fixture-finalized",
    capturedAt: "2026-08-25T11:30:00.000Z",
    date: "2026-08-25",
    demandCycle: "summer",
    review19Status: "recorded",
    sessions: [
      makeOperationSession("15", started15),
      makeOperationSession("17", started17),
    ],
    areaCountRecords: [
      makeAreaCountRecord("15", started15),
      makeAreaCountRecord("17", started17),
    ],
    review19Check: makeTargetDayCheck(),
    productionAnalysis: { stale: "debug-review19-must-not-survive" },
    calendarContext: { keep: "calendar" },
    analysisWeatherContext: { keep: "weather" },
    globalDiscountAdjustmentPercent: 5,
    recordId: "nebiki-day:2026-08-25",
    finalizedAt: "2026-08-25T11:31:00.000Z",
    memo: "実データのメモ",
    discardCount: 7,
    sentinel: "keep-day-fields",
  };
}

function seedSixReviews(storage: MemoryStorage) {
  const normalRecords = [20, 21, 22, 23, 24].map((day) =>
    makeReview19({
      date: `2026-08-${day}`,
      sessionStartedAt: `2026-08-${day}T08:00:00.000Z`,
      count: day - 18,
    }),
  );
  const target = makeTargetReview19();
  storage.seed(STORAGE_KEYS.review19Records, [...normalRecords, target]);
  return { normalRecords, target };
}

function runSingleRecordGuardTest(mutator: (target: Review19Result) => void) {
  const storage = new MemoryStorage();
  const target = makeTargetReview19();
  mutator(target);
  storage.seed(STORAGE_KEYS.review19Records, [target]);
  const before = storage.getItem(STORAGE_KEYS.review19Records);
  const result = cleanupReview19Debug20260825({ storage });
  assert.equal(result.changed, false);
  assert.equal(storage.getItem(STORAGE_KEYS.review19Records), before);
}

async function main() {
  // A/B: one exact target from six authoritative records, five untouched.
  const storage = new MemoryStorage();
  const { normalRecords } = seedSixReviews(storage);
  const normalBefore = JSON.stringify(normalRecords);
  const first = cleanupReview19Debug20260825({ storage });
  assert.equal(first.ok, true);
  assert.equal(first.counts.review19Records, 1);
  const reviewsAfter = storage.read<Review19Result[]>(STORAGE_KEYS.review19Records);
  assert.equal(reviewsAfter.length, 5);
  assert.equal(JSON.stringify(reviewsAfter), normalBefore);

  // C-G and appVersion guard: any mismatch is a fail-closed no-op.
  runSingleRecordGuardTest((target) => {
    target.areaCounts.bento_men = 1;
  });
  runSingleRecordGuardTest((target) => {
    delete target.areaCounts.bento_men;
  });
  runSingleRecordGuardTest((target) => {
    target.sessionStartedAt = "2026-08-25T07:54:21.146Z";
  });
  runSingleRecordGuardTest((target) => {
    target.demandCycle = "normal";
  });
  runSingleRecordGuardTest((target) => {
    target.date = "2026-08-24";
  });
  runSingleRecordGuardTest((target) => {
    target.appVersion = "2026.8.9-13";
  });

  // H-K: exact ref and legacy rich payload only; AreaCount and other refs stay.
  const queueStorage = new MemoryStorage();
  const otherReference = {
    ...makeTargetReference(),
    sessionStartedAt: "2026-08-25T07:54:21.146Z",
  };
  const areaPending = {
    ...makePendingItem({ rich: "area-count-must-stay" }),
    type: "area_count",
    identity: "area-count-identity",
  };
  const otherReview = makeReview19({
    date: "2026-08-25",
    sessionStartedAt: "2026-08-25T07:54:21.146Z",
    count: 2,
    appVersion: "2026.8.9-12",
  });
  queueStorage.seed(PENDING_SUPABASE_SYNC_STORAGE_KEY, [
    makePendingItem(makeTargetReference()),
    makePendingItem({ ...makeTargetReference(), complete: false }),
    makePendingItem(otherReference),
    makePendingItem(makeTargetReview19()),
    makePendingItem(otherReview),
    areaPending,
  ]);
  const queueResult = cleanupReview19Debug20260825({ storage: queueStorage });
  assert.equal(queueResult.counts.pendingReferences, 2);
  assert.equal(queueResult.counts.pendingLegacyPayloads, 1);
  const queueAfter = queueStorage.read<Array<Record<string, unknown>>>(
    PENDING_SUPABASE_SYNC_STORAGE_KEY,
  );
  assert.equal(queueAfter.length, 3);
  assert.deepEqual(queueAfter.at(-1), areaPending);
  assert.equal(
    (queueAfter[0]?.payload as { sessionStartedAt: string }).sessionStartedAt,
    "2026-08-25T07:54:21.146Z",
  );

  // L: each AppState source and runtime navigation copy loses only target review.
  const stateStorage = new MemoryStorage();
  const targetState = makeState(makeTargetReview19());
  stateStorage.seed(STORAGE_KEYS.currentSession, targetState);
  stateStorage.seed(STORAGE_KEYS.workSessionCheckpoint, targetState);
  stateStorage.seed(STORAGE_KEYS.review19SourceState, targetState);
  stateStorage.seed(STORAGE_KEYS.runtimeState, {
    areaJudgeSelection: null,
    resumeTargetScreen: null,
    timeSwitchTarget: null,
    weatherConfirmationPending: null,
    sentinel: "keep-runtime",
    undoSnapshot: { state: targetState, sentinel: "keep-undo" },
    screenHistory: [
      { state: targetState, sentinel: "keep-history" },
      { state: makeState(null), sentinel: "keep-nontarget" },
    ],
  });
  const stateResult = cleanupReview19Debug20260825({ storage: stateStorage });
  assert.deepEqual(
    {
      current: stateResult.counts.currentSession,
      checkpoint: stateResult.counts.workSessionCheckpoint,
      source: stateResult.counts.review19SourceState,
      runtime: stateResult.counts.runtimeNavigationStates,
    },
    { current: 1, checkpoint: 1, source: 1, runtime: 2 },
  );
  for (const key of [
    STORAGE_KEYS.currentSession,
    STORAGE_KEYS.workSessionCheckpoint,
    STORAGE_KEYS.review19SourceState,
  ]) {
    const next = stateStorage.read<Record<string, unknown>>(key);
    assert.equal(next.review19, null);
    assert.equal(next.screen, "start");
    assert.deepEqual(next.sentinel, { keep: "unchanged" });
  }
  const runtime = stateStorage.read<Record<string, unknown>>(STORAGE_KEYS.runtimeState);
  assert.equal(runtime.sentinel, "keep-runtime");
  assert.equal(
    (((runtime.undoSnapshot as Record<string, unknown>).state as Record<string, unknown>)
      .review19),
    null,
  );

  // M-P: remove only review19Check, preserve daily evidence/metadata, rebuild 19 missing.
  const dayStorage = new MemoryStorage();
  const dayBefore = makeFinalizedDay();
  const sessionsBefore = JSON.stringify(dayBefore.sessions);
  const areaRecordsBefore = JSON.stringify(dayBefore.areaCountRecords);
  dayStorage.seed(FINALIZED_DAY_DATA_STORAGE_KEY, [dayBefore]);
  const dayResult = cleanupReview19Debug20260825({ storage: dayStorage });
  assert.equal(dayResult.counts.finalizedDayRecords, 1);
  const [dayAfter] = dayStorage.read<Array<Record<string, unknown>>>(
    FINALIZED_DAY_DATA_STORAGE_KEY,
  );
  assert.ok(dayAfter);
  assert.equal(Object.prototype.hasOwnProperty.call(dayAfter, "review19Check"), false);
  assert.equal(dayAfter.review19Status, "not_performed");
  assert.equal(JSON.stringify(dayAfter.sessions), sessionsBefore);
  assert.equal(JSON.stringify(dayAfter.areaCountRecords), areaRecordsBefore);
  for (const key of [
    "memo",
    "discardCount",
    "recordId",
    "finalizedAt",
    "globalDiscountAdjustmentPercent",
    "sentinel",
  ]) {
    assert.deepEqual(dayAfter[key], (dayBefore as Record<string, unknown>)[key]);
  }
  const bentoAnalysis = (
    dayAfter.productionAnalysis as {
      areas: Record<string, {
        productionShortageSuspicion: string;
        checkpointStatus: Record<string, string>;
      }>;
    }
  ).areas.bento_men;
  assert.equal(bentoAnalysis?.checkpointStatus["15"], "recorded");
  assert.equal(bentoAnalysis?.checkpointStatus["17"], "recorded");
  assert.equal(bentoAnalysis?.checkpointStatus["19"], "session_missing");
  assert.equal(bentoAnalysis?.productionShortageSuspicion, "insufficient");

  // Q: second run is a natural no-op and writes nothing.
  const afterFirstRaw = new Map(dayStorage.values);
  const second = cleanupReview19Debug20260825({ storage: dayStorage });
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.removedCount, 0);
  assert.deepEqual(dayStorage.values, afterFirstRaw);

  // Shared storage boundary: a DOMException becomes a structured failure.
  const failingStorage = new FailingWriteStorage();
  seedSixReviews(failingStorage);
  const failingBefore = failingStorage.getItem(STORAGE_KEYS.review19Records);
  const failedWrite = cleanupReview19Debug20260825({ storage: failingStorage });
  assert.equal(failedWrite.ok, false);
  assert.equal(failedWrite.failureReason, "write_failed");
  assert.equal(
    failingStorage.getItem(STORAGE_KEYS.review19Records),
    failingBefore,
  );

  // Storage getter access itself can throw SecurityError in restricted modes.
  // The startup maintenance must return a safe unavailable result, not crash
  // React before its existing storage boundaries can run.
  const originalStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    const unavailable = cleanupReview19Debug20260825();
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.failureReason, "storage_unavailable");
    assert.equal(unavailable.changed, false);
  } finally {
    if (originalStorageDescriptor) {
      Object.defineProperty(
        globalThis,
        "localStorage",
        originalStorageDescriptor,
      );
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }

  // R/S: all Review19 and daily/all-data exports no longer contain the target.
  const exportStorage = new MemoryStorage();
  const six = seedSixReviews(exportStorage);
  exportStorage.seed(FINALIZED_DAY_DATA_STORAGE_KEY, [makeFinalizedDay()]);
  cleanupReview19Debug20260825({ storage: exportStorage });
  const exportedReviews = exportStorage
    .read<Review19Result[]>(STORAGE_KEYS.review19Records)
    .map((record) => normalizeReview19Result(record))
    .filter((record): record is Review19Result => Boolean(record));
  const reviewPayload = buildAllReview19DataExportPayload({
    records: exportedReviews,
    exportedAt: "2026-08-28T00:00:00.000Z",
  });
  assert.equal(reviewPayload.count, 5);
  assert.equal(
    reviewPayload.records.some(
      (record) =>
        record.date === REVIEW19_DEBUG_20260825_TARGET.date &&
        record.sessionStartedAt === REVIEW19_DEBUG_20260825_TARGET.sessionStartedAt,
    ),
    false,
  );
  const cleanedDays = exportStorage.read<Array<Record<string, unknown>>>(
    FINALIZED_DAY_DATA_STORAGE_KEY,
  );
  const dayPayload = buildAllFinalizedDayDataExportPayload({
    records: cleanedDays as never[],
    exportedAt: "2026-08-28T00:00:00.000Z",
  });
  assert.equal(dayPayload.records[0]?.review19Check, undefined);
  const allPayload = buildAllDataExportPayload({
    dailyData: cleanedDays as never[],
    review19Data: exportedReviews,
    exportedAt: "2026-08-28T00:00:00.000Z",
  });
  assert.equal(allPayload.dailyData[0]?.review19Check, undefined);
  assert.equal(
    allPayload.review19Data.some(
      (record) =>
        record.date === REVIEW19_DEBUG_20260825_TARGET.date &&
        record.sessionStartedAt === REVIEW19_DEBUG_20260825_TARGET.sessionStartedAt,
    ),
    false,
  );

  // T: manual authoritative direct sync can no longer rediscover/re-send target.
  let uploaded: Review19Result[] = [];
  const direct = await syncAuthoritativeReview19RecordsDirectly(
    exportedReviews,
    async (records) => {
      uploaded = [...records];
      return {
        status: "saved" as const,
        savedCount: records.length,
        skippedCount: 0,
        records: [...records],
      };
    },
  );
  assert.equal(direct.status, "saved");
  assert.equal(uploaded.length, 5);
  assert.equal(
    uploaded.some(
      (record) =>
        record.date === REVIEW19_DEBUG_20260825_TARGET.date &&
        record.sessionStartedAt === REVIEW19_DEBUG_20260825_TARGET.sessionStartedAt,
    ),
    false,
  );
  assert.equal(six.normalRecords.length, 5);
  const remoteImportCandidates = excludeReview19Debug20260825Target([
    ...six.normalRecords,
    makeTargetReview19(),
  ]);
  assert.equal(remoteImportCandidates.length, 5);
  assert.equal(
    remoteImportCandidates.some(
      (record) => record.sessionStartedAt === REVIEW19_DEBUG_20260825_TARGET.sessionStartedAt,
    ),
    false,
  );

  console.log("review19 debug 2026-08-25 one-time cleanup check: PASS (A-T)");
}

void main();
