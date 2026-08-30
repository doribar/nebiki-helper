import {
  HistoricalArchiveRepository,
  NativeIndexedDbHistoricalArchiveAdapter,
  mergeDailySessionSnapshotArchiveOperations,
  mergeReview19ArchiveOperations,
  migrateLegacyHistoricalLocalStorage,
  type HistoricalArchiveFailure,
  type HistoricalArchiveResult,
  type LegacyHistoricalArchiveMigrationResult,
} from "./historicalArchive.ts";
import {
  initializeFinalizedDayDataInMemory,
  loadFinalizedDayData,
  patchFinalizedDayDataMetadataByRecordIdInMemory,
  patchFinalizedDayDataMetadataInMemory,
  replaceFinalizedDayDataCoreInMemory,
  selectAllFinalizedDayData,
  type FinalizedDayMetadataPatch,
  type FinalizedDayWriteResult,
  type StoredFinalizedDayData,
} from "./finalizedDayData.ts";
import { cloneReview19Records } from "./review19.ts";
import {
  loadDailySessionSnapshots,
  loadReview19Records,
  type StorageOperationResult,
} from "./storage.ts";
import {
  loadLocalAreaCountRecords,
} from "./areaCountLocalStorage.ts";
import {
  mergeAreaCountRecordCollections,
  type AreaCountRecord,
} from "./areaCountHistory.ts";
import type {
  DailySessionSnapshot,
  DemandCycle,
  Review19DaySnapshot,
  Review19Result,
} from "./types.ts";

export type HistoricalArchiveRuntimeStatus =
  | "not_started"
  | "in_progress"
  | "complete"
  | "partial"
  | "failed"
  | "unavailable";

export type HistoricalArchiveRuntimeSnapshot = {
  status: HistoricalArchiveRuntimeStatus;
  review19Records: Review19Result[];
  finalizedDayRecords: StoredFinalizedDayData[];
  dailySessionSnapshots: DailySessionSnapshot[];
  areaCountRecords: AreaCountRecord[];
  migration: LegacyHistoricalArchiveMigrationResult | null;
  failure: HistoricalArchiveFailure | null;
};

let repository: HistoricalArchiveRepository | null = null;
let initialization: Promise<HistoricalArchiveRuntimeSnapshot> | null = null;
let snapshot: HistoricalArchiveRuntimeSnapshot = {
  status: "not_started",
  review19Records: [],
  finalizedDayRecords: [],
  dailySessionSnapshots: [],
  areaCountRecords: [],
  migration: null,
  failure: null,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function legacyFallback(): Pick<
  HistoricalArchiveRuntimeSnapshot,
  | "review19Records"
  | "finalizedDayRecords"
  | "dailySessionSnapshots"
  | "areaCountRecords"
> {
  try {
    return {
      review19Records: loadReview19Records(),
      finalizedDayRecords: loadFinalizedDayData(),
      dailySessionSnapshots: loadDailySessionSnapshots(),
      areaCountRecords: loadLocalAreaCountRecords(),
    };
  } catch {
    return {
      review19Records: [],
      finalizedDayRecords: [],
      dailySessionSnapshots: [],
      areaCountRecords: [],
    };
  }
}

function mergeReview19Operations(
  left: readonly Review19Result[],
  right: readonly Review19Result[],
): Review19Result[] {
  return mergeReview19ArchiveOperations([...left, ...right]);
}

function resultFailure<T>(
  result: HistoricalArchiveResult<T>,
): HistoricalArchiveFailure | null {
  return result.ok ? null : result;
}

async function hydrateRuntime(
  target: HistoricalArchiveRepository,
  migration: LegacyHistoricalArchiveMigrationResult | null,
): Promise<HistoricalArchiveRuntimeSnapshot> {
  const [review19, finalizedDays, dailySessionSnapshots, areaCountRecords] = await Promise.all([
    target.listReview19Records(),
    target.listFinalizedDays(),
    target.listDailySessionSnapshots(),
    target.listAreaCountRecords(),
  ]);
  const fallback = legacyFallback();
  const failure =
    resultFailure(review19) ??
    resultFailure(finalizedDays) ??
    resultFailure(dailySessionSnapshots) ??
    resultFailure(areaCountRecords);
  const review19Records = review19.ok
    ? mergeReview19Operations(review19.value, fallback.review19Records)
    : fallback.review19Records;
  const finalizedDayRecords = finalizedDays.ok
    ? selectAllFinalizedDayData([
        ...finalizedDays.value,
        ...fallback.finalizedDayRecords,
      ])
    : fallback.finalizedDayRecords;
  const archivedDailySessionSnapshots = dailySessionSnapshots.ok
    ? mergeDailySessionSnapshotArchiveOperations([
        ...dailySessionSnapshots.value,
        ...fallback.dailySessionSnapshots,
      ])
    : fallback.dailySessionSnapshots;
  const archivedAreaCountRecords = areaCountRecords.ok
    ? mergeAreaCountRecordCollections(
        areaCountRecords.value,
        fallback.areaCountRecords,
      )
    : fallback.areaCountRecords;
  return {
    status: failure
      ? "partial"
      : migration && !migration.ok
        ? "partial"
        : "complete",
    review19Records,
    finalizedDayRecords,
    dailySessionSnapshots: archivedDailySessionSnapshots,
    areaCountRecords: archivedAreaCountRecords,
    migration,
    failure:
      failure ??
      migration?.review19.failure ??
      migration?.finalizedDays.failure ??
      migration?.dailySessionSnapshots.failure ??
      migration?.areaCountRecords.failure ??
      null,
  };
}

export function getHistoricalArchiveRuntimeSnapshot(): HistoricalArchiveRuntimeSnapshot {
  return clone(snapshot);
}

/**
 * Synchronous memory view used after the App startup gate. The legacy
 * localStorage operational journal is merged for crash overlap/current-day
 * writes; stable identities prevent double counting.
 */
export function getHistoricalDailySessionSnapshots(): DailySessionSnapshot[] {
  let operational: DailySessionSnapshot[] = [];
  try {
    operational = loadDailySessionSnapshots();
  } catch {
    // Archive memory remains usable when localStorage reads are unavailable.
  }
  return mergeDailySessionSnapshotArchiveOperations([
    ...snapshot.dailySessionSnapshots,
    ...operational,
  ]);
}

export function getHistoricalDailySessionSnapshotsForDate(
  date: string,
): DailySessionSnapshot[] {
  return getHistoricalDailySessionSnapshots().filter(
    (item) => item.session.date === date,
  );
}

export function getHistoricalAreaCountRecords(): AreaCountRecord[] {
  let operational: AreaCountRecord[] = [];
  try {
    operational = loadLocalAreaCountRecords();
  } catch {
    // Archive memory remains usable when localStorage reads are unavailable.
  }
  return mergeAreaCountRecordCollections(
    snapshot.areaCountRecords,
    operational,
  );
}

export function getHistoricalArchiveRepository(): HistoricalArchiveRepository | null {
  return repository;
}

export function initializeHistoricalArchiveRuntime(params?: {
  repository?: HistoricalArchiveRepository;
  storage?: Storage;
  protectedDailySnapshotDates?: readonly string[];
  protectedAreaCountDates?: readonly string[];
}): Promise<HistoricalArchiveRuntimeSnapshot> {
  if (initialization) return initialization;
  snapshot = { ...snapshot, status: "in_progress" };
  initialization = (async () => {
    try {
      const target =
        params?.repository ??
        new HistoricalArchiveRepository(
          new NativeIndexedDbHistoricalArchiveAdapter(),
        );
      repository = target;
      const storage =
        params?.storage ??
        (typeof localStorage === "undefined" ? null : localStorage);
      const migration = storage
          ? await migrateLegacyHistoricalLocalStorage({
            repository: target,
            storage,
            protectedDailySnapshotDates: params?.protectedDailySnapshotDates,
            protectedAreaCountDates: params?.protectedAreaCountDates,
          })
        : null;
      snapshot = await hydrateRuntime(target, migration);
      return getHistoricalArchiveRuntimeSnapshot();
    } catch (error) {
      const fallback = legacyFallback();
      const errorName =
        error && typeof error === "object" && "name" in error
          ? String((error as { name?: unknown }).name ?? "UnknownError")
          : "UnknownError";
      snapshot = {
        status: "unavailable",
        ...fallback,
        migration: null,
        failure: {
          ok: false,
          operation: "open",
          errorName,
          message: error instanceof Error ? error.message : "IndexedDB unavailable",
        },
      };
      return getHistoricalArchiveRuntimeSnapshot();
    }
  })();
  return initialization;
}

export async function refreshHistoricalArchiveRuntime(): Promise<HistoricalArchiveRuntimeSnapshot> {
  if (!repository) return initializeHistoricalArchiveRuntime();
  snapshot = await hydrateRuntime(repository, snapshot.migration);
  return getHistoricalArchiveRuntimeSnapshot();
}

function archiveStorageResult(
  key: string,
  result: HistoricalArchiveResult<unknown>,
): StorageOperationResult {
  if (result.ok) return { ok: true, key, operation: "set" };
  return {
    ok: false,
    key,
    operation: "set",
    errorName: result.errorName,
    quotaExceeded:
      result.errorName === "QuotaExceededError" ||
      result.errorName === "NS_ERROR_DOM_QUOTA_REACHED",
  };
}

export async function saveReview19ToHistoricalArchive(
  record: Review19Result,
): Promise<StorageOperationResult> {
  await initializeHistoricalArchiveRuntime();
  if (!repository) {
    return {
      ok: false,
      key: "nebiki-helper-historical-archive/review19",
      operation: "set",
      errorName: "ArchiveUnavailableError",
      quotaExceeded: false,
    };
  }
  const result = await repository.upsertReview19Records([record]);
  if (result.ok) {
    snapshot = {
      ...snapshot,
      review19Records: mergeReview19Operations(
        snapshot.review19Records,
        result.value,
      ),
    };
  }
  return archiveStorageResult(
    "nebiki-helper-historical-archive/review19",
    result,
  );
}

export async function cacheRemoteReview19InHistoricalArchive(
  records: readonly Review19Result[],
): Promise<HistoricalArchiveResult<Review19Result[]>> {
  await initializeHistoricalArchiveRuntime();
  if (!repository) {
    return {
      ok: false,
      operation: "open",
      errorName: "ArchiveUnavailableError",
      message: "Historical archive is unavailable",
    };
  }
  const result = await repository.upsertReview19Records(records);
  if (result.ok) {
    snapshot = { ...snapshot, review19Records: cloneReview19Records(result.value) };
  }
  return result;
}

export async function listArchivedReview19ByBusinessIdentity(params: {
  date: string;
  demandCycle: DemandCycle;
}): Promise<Review19Result[]> {
  await initializeHistoricalArchiveRuntime();
  return snapshot.review19Records.filter(
    (record) =>
      record.date === params.date &&
      (record.demandCycle ?? "normal") === params.demandCycle,
  ).map((record) => clone(record));
}

async function commitFinalizedRecords(
  result: FinalizedDayWriteResult,
): Promise<HistoricalArchiveResult<FinalizedDayWriteResult>> {
  await initializeHistoricalArchiveRuntime();
  if (!repository) {
    return {
      ok: false,
      operation: "open",
      errorName: "ArchiveUnavailableError",
      message: "Historical archive is unavailable",
    };
  }
  const saved = await repository.replaceFinalizedDay(result.record);
  if (!saved.ok) return saved;
  snapshot = {
    ...snapshot,
    finalizedDayRecords: selectAllFinalizedDayData([
      ...snapshot.finalizedDayRecords,
      saved.value,
    ]),
  };
  return {
    ok: true,
    value: {
      ...result,
      records: clone(snapshot.finalizedDayRecords),
      record: clone(saved.value),
    },
  };
}

export async function initializeArchivedFinalizedDay(params: {
  daySnapshot: Review19DaySnapshot;
  finalizedAt?: string;
}): Promise<HistoricalArchiveResult<FinalizedDayWriteResult>> {
  const result = initializeFinalizedDayDataInMemory({
    currentRecords: snapshot.finalizedDayRecords,
    ...params,
  });
  return commitFinalizedRecords(result);
}

export async function replaceArchivedFinalizedDay(params: {
  daySnapshot: Review19DaySnapshot;
  finalizedAt?: string;
}): Promise<HistoricalArchiveResult<FinalizedDayWriteResult>> {
  const result = replaceFinalizedDayDataCoreInMemory({
    currentRecords: snapshot.finalizedDayRecords,
    ...params,
  });
  return commitFinalizedRecords(result);
}

export async function patchArchivedFinalizedDayByDate(params: {
  date: string;
  patch: FinalizedDayMetadataPatch;
}): Promise<HistoricalArchiveResult<StoredFinalizedDayData | null>> {
  await initializeHistoricalArchiveRuntime();
  if (!repository) {
    return {
      ok: false,
      operation: "open",
      errorName: "ArchiveUnavailableError",
      message: "Historical archive is unavailable",
    };
  }
  const memory = patchFinalizedDayDataMetadataInMemory({
    currentRecords: snapshot.finalizedDayRecords,
    ...params,
  });
  if (!memory.record) return { ok: true, value: null };
  const saved = await repository.replaceFinalizedDay(memory.record);
  if (!saved.ok) return saved;
  snapshot = { ...snapshot, finalizedDayRecords: memory.records };
  return { ok: true, value: clone(saved.value) };
}

export async function patchArchivedFinalizedDayByRecordId(params: {
  recordId: string;
  patch: FinalizedDayMetadataPatch;
}): Promise<HistoricalArchiveResult<StoredFinalizedDayData | null>> {
  await initializeHistoricalArchiveRuntime();
  if (!repository) {
    return {
      ok: false,
      operation: "open",
      errorName: "ArchiveUnavailableError",
      message: "Historical archive is unavailable",
    };
  }
  const memory = patchFinalizedDayDataMetadataByRecordIdInMemory({
    currentRecords: snapshot.finalizedDayRecords,
    ...params,
  });
  if (!memory.record) return { ok: true, value: null };
  const saved = await repository.replaceFinalizedDay(memory.record);
  if (!saved.ok) return saved;
  snapshot = { ...snapshot, finalizedDayRecords: memory.records };
  return { ok: true, value: clone(saved.value) };
}
