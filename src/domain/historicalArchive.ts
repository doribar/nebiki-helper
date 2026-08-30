import {
  normalizeFinalizedDayData,
  patchFinalizedDayDataMetadataByRecordIdInMemory,
  patchFinalizedDayDataMetadataInMemory,
  selectAllFinalizedDayData,
  type FinalizedDayData,
  type FinalizedDayMetadataPatch,
  type StoredFinalizedDayData,
} from "./finalizedDayData.ts";
import { normalizeDemandCycle } from "./demandCycle.ts";
import {
  cloneReview19Result,
  getReview19SourceUpdatedAt,
  normalizeReview19Result,
} from "./review19.ts";
import type { DemandCycle, Review19Result } from "./types.ts";

export const HISTORICAL_ARCHIVE_DB_NAME =
  "nebiki-helper-historical-archive" as const;
export const HISTORICAL_ARCHIVE_DB_VERSION = 1 as const;
export const HISTORICAL_ARCHIVE_REVIEW19_STORE = "review19" as const;
export const HISTORICAL_ARCHIVE_FINALIZED_DAY_STORE = "finalized-days" as const;

export const LEGACY_REVIEW19_STORAGE_KEY =
  "nebiki-helper/review19-records" as const;
export const LEGACY_FINALIZED_DAY_STORAGE_KEY =
  "nebiki-helper/finalized-day-data" as const;

type HistoricalArchiveStoreName =
  | typeof HISTORICAL_ARCHIVE_REVIEW19_STORE
  | typeof HISTORICAL_ARCHIVE_FINALIZED_DAY_STORE;

type Review19ArchiveEntry = {
  key: string;
  date: string;
  demandCycle: DemandCycle;
  sessionStartedAt: string;
  record: Review19Result;
};

type FinalizedDayArchiveEntry = {
  key: string;
  date: string;
  recordId: string;
  record: StoredFinalizedDayData;
};

type HistoricalArchiveEntry = Review19ArchiveEntry | FinalizedDayArchiveEntry;

export type HistoricalArchiveOperation =
  | "open"
  | "read"
  | "write"
  | "verify"
  | "remove_legacy";

export type HistoricalArchiveFailure = {
  ok: false;
  operation: HistoricalArchiveOperation;
  errorName: string;
  message: string;
};

export type HistoricalArchiveResult<T> =
  | { ok: true; value: T }
  | HistoricalArchiveFailure;

export interface HistoricalArchiveAdapter {
  getAll(store: HistoricalArchiveStoreName): Promise<HistoricalArchiveEntry[]>;
  get(
    store: HistoricalArchiveStoreName,
    key: string,
  ): Promise<HistoricalArchiveEntry | undefined>;
  putMany(
    store: HistoricalArchiveStoreName,
    entries: HistoricalArchiveEntry[],
  ): Promise<void>;
  delete(store: HistoricalArchiveStoreName, key: string): Promise<void>;
  count(store: HistoricalArchiveStoreName): Promise<number>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorName(error: unknown): string {
  if (error && typeof error === "object") {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name;
  }
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Historical archive operation failed";
}

function failure(
  operation: HistoricalArchiveOperation,
  error: unknown,
): HistoricalArchiveFailure {
  return {
    ok: false,
    operation,
    errorName: errorName(error),
    message: errorMessage(error),
  };
}

async function safely<T>(
  operation: HistoricalArchiveOperation,
  run: () => Promise<T>,
): Promise<HistoricalArchiveResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return failure(operation, error);
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function getReview19ArchiveOperationKey(
  record: Pick<Review19Result, "date" | "demandCycle" | "sessionStartedAt">,
): string {
  return JSON.stringify([
    record.date,
    normalizeDemandCycle(record.demandCycle),
    record.sessionStartedAt,
  ]);
}

function getFinalizedDayArchiveKey(record: Pick<StoredFinalizedDayData, "date">): string {
  return record.date;
}

function toReview19Entry(record: Review19Result): Review19ArchiveEntry | null {
  const normalized = normalizeReview19Result(record);
  if (!normalized) return null;
  return {
    key: getReview19ArchiveOperationKey(normalized),
    date: normalized.date,
    demandCycle: normalizeDemandCycle(normalized.demandCycle),
    sessionStartedAt: normalized.sessionStartedAt,
    record: clone(normalized),
  };
}

function toFinalizedDayEntry(
  record: FinalizedDayData,
): FinalizedDayArchiveEntry | null {
  const normalized = normalizeFinalizedDayData(record);
  if (!normalized) return null;
  return {
    key: getFinalizedDayArchiveKey(normalized),
    date: normalized.date,
    recordId: normalized.recordId,
    record: clone(normalized),
  };
}

function getTimestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** Same operation identity is replaceable; prefer final/complete/newer evidence. */
function preferReview19Operation(
  current: Review19Result,
  candidate: Review19Result,
): Review19Result {
  const currentFinal = Number(Boolean(current.recordedAt));
  const candidateFinal = Number(Boolean(candidate.recordedAt));
  if (candidateFinal !== currentFinal) {
    return candidateFinal > currentFinal ? candidate : current;
  }
  const currentComplete = Number(Boolean(current.dataQuality?.complete));
  const candidateComplete = Number(Boolean(candidate.dataQuality?.complete));
  if (candidateComplete !== currentComplete) {
    return candidateComplete > currentComplete ? candidate : current;
  }
  const currentRevision = getTimestamp(getReview19SourceUpdatedAt(current));
  const candidateRevision = getTimestamp(getReview19SourceUpdatedAt(candidate));
  if (candidateRevision !== currentRevision) {
    return candidateRevision > currentRevision ? candidate : current;
  }
  // Equal revision: the richer normalized record wins deterministically.
  return stableStringify(candidate).length >= stableStringify(current).length
    ? candidate
    : current;
}

export function mergeReview19ArchiveOperations(
  records: readonly Review19Result[],
): Review19Result[] {
  const byOperation = new Map<string, Review19Result>();
  for (const raw of records) {
    const normalized = normalizeReview19Result(raw);
    if (!normalized) continue;
    const key = getReview19ArchiveOperationKey(normalized);
    const current = byOperation.get(key);
    byOperation.set(
      key,
      clone(current ? preferReview19Operation(current, normalized) : normalized),
    );
  }
  return [...byOperation.values()].sort((left, right) =>
    getReview19ArchiveOperationKey(left).localeCompare(
      getReview19ArchiveOperationKey(right),
    ),
  );
}

function normalizeRawReview19Array(raw: unknown): Review19Result[] | null {
  if (!Array.isArray(raw)) return null;
  const normalized: Review19Result[] = [];
  for (const value of raw) {
    const record = normalizeReview19Result(value as Review19Result);
    if (!record) return null;
    normalized.push(record);
  }
  return mergeReview19ArchiveOperations(normalized);
}

function normalizeRawFinalizedDayArray(
  raw: unknown,
): StoredFinalizedDayData[] | null {
  if (!Array.isArray(raw)) return null;
  const normalized: StoredFinalizedDayData[] = [];
  for (const value of raw) {
    const record = normalizeFinalizedDayData(value);
    if (!record) return null;
    normalized.push(record);
  }
  return selectAllFinalizedDayData(normalized);
}

export class HistoricalArchiveRepository {
  readonly adapter: HistoricalArchiveAdapter;
  private review19MutationChain: Promise<void> = Promise.resolve();

  constructor(adapter: HistoricalArchiveAdapter) {
    this.adapter = adapter;
  }

  /**
   * Review19 cache hydration and a newly completed local observation can arrive
   * at the same time. Serialize their read/merge/write sections so a stale
   * remote snapshot can never overwrite a richer local completion after both
   * callers read the same previous archive state.
   */
  private enqueueReview19Mutation<T>(run: () => Promise<T>): Promise<T> {
    const pending = this.review19MutationChain.then(run, run);
    this.review19MutationChain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async listAllReview19Records(): Promise<
    HistoricalArchiveResult<Review19Result[]>
  > {
    return safely("read", async () => {
      const entries = await this.adapter.getAll(HISTORICAL_ARCHIVE_REVIEW19_STORE);
      return mergeReview19ArchiveOperations(
        entries.flatMap((entry) => {
          const record = (entry as Review19ArchiveEntry).record;
          const normalized = normalizeReview19Result(record);
          return normalized ? [normalized] : [];
        }),
      );
    });
  }

  async listReview19Records(): Promise<
    HistoricalArchiveResult<Review19Result[]>
  > {
    const result = await this.listAllReview19Records();
    if (!result.ok) return result;
    return {
      ok: true,
      value: result.value.filter(
        (record) => record.review19Status !== "not_applicable",
      ),
    };
  }

  async countReview19Records(): Promise<HistoricalArchiveResult<number>> {
    return safely("read", () =>
      this.adapter.count(HISTORICAL_ARCHIVE_REVIEW19_STORE),
    );
  }

  async upsertReview19Records(
    records: readonly Review19Result[],
  ): Promise<HistoricalArchiveResult<Review19Result[]>> {
    return safely("write", () => this.enqueueReview19Mutation(async () => {
      const currentResult = await this.listAllReview19Records();
      if (!currentResult.ok) throw Object.assign(new Error(currentResult.message), {
        name: currentResult.errorName,
      });
      const merged = mergeReview19ArchiveOperations([
        ...currentResult.value,
        ...records,
      ]);
      const entries = merged
        .map(toReview19Entry)
        .filter((entry): entry is Review19ArchiveEntry => entry !== null);
      await this.adapter.putMany(HISTORICAL_ARCHIVE_REVIEW19_STORE, entries);
      return merged.map((record) => cloneReview19Result(record) as Review19Result);
    }));
  }

  async getReview19Record(params: {
    date: string;
    demandCycle: DemandCycle;
    sessionStartedAt: string;
  }): Promise<HistoricalArchiveResult<Review19Result | null>> {
    return safely("read", async () => {
      const key = getReview19ArchiveOperationKey(params);
      const entry = (await this.adapter.get(
        HISTORICAL_ARCHIVE_REVIEW19_STORE,
        key,
      )) as Review19ArchiveEntry | undefined;
      return entry ? cloneReview19Result(entry.record) : null;
    });
  }

  async listFinalizedDays(): Promise<
    HistoricalArchiveResult<StoredFinalizedDayData[]>
  > {
    return safely("read", async () => {
      const entries = await this.adapter.getAll(
        HISTORICAL_ARCHIVE_FINALIZED_DAY_STORE,
      );
      return selectAllFinalizedDayData(
        entries.map((entry) => (entry as FinalizedDayArchiveEntry).record),
      );
    });
  }

  async countFinalizedDays(): Promise<HistoricalArchiveResult<number>> {
    return safely("read", () =>
      this.adapter.count(HISTORICAL_ARCHIVE_FINALIZED_DAY_STORE),
    );
  }

  async upsertFinalizedDays(
    records: readonly FinalizedDayData[],
  ): Promise<HistoricalArchiveResult<StoredFinalizedDayData[]>> {
    return safely("write", async () => {
      const currentResult = await this.listFinalizedDays();
      if (!currentResult.ok) throw Object.assign(new Error(currentResult.message), {
        name: currentResult.errorName,
      });
      const merged = selectAllFinalizedDayData([...currentResult.value, ...records]);
      const entries = merged
        .map(toFinalizedDayEntry)
        .filter((entry): entry is FinalizedDayArchiveEntry => entry !== null);
      await this.adapter.putMany(HISTORICAL_ARCHIVE_FINALIZED_DAY_STORE, entries);
      return merged.map(clone);
    });
  }

  async replaceFinalizedDay(
    record: FinalizedDayData,
  ): Promise<HistoricalArchiveResult<StoredFinalizedDayData>> {
    return safely("write", async () => {
      const entry = toFinalizedDayEntry(record);
      if (!entry) throw new TypeError("Invalid finalized day record");
      await this.adapter.putMany(HISTORICAL_ARCHIVE_FINALIZED_DAY_STORE, [entry]);
      const verified = (await this.adapter.get(
        HISTORICAL_ARCHIVE_FINALIZED_DAY_STORE,
        entry.key,
      )) as FinalizedDayArchiveEntry | undefined;
      if (!verified || stableStringify(verified.record) !== stableStringify(entry.record)) {
        throw Object.assign(new Error("Finalized day archive verification failed"), {
          name: "ArchiveVerificationError",
        });
      }
      return clone(entry.record);
    });
  }

  async patchFinalizedDayByDate(params: {
    date: string;
    patch: FinalizedDayMetadataPatch;
  }): Promise<HistoricalArchiveResult<StoredFinalizedDayData | null>> {
    return safely("write", async () => {
      const currentResult = await this.listFinalizedDays();
      if (!currentResult.ok) throw Object.assign(new Error(currentResult.message), {
        name: currentResult.errorName,
      });
      const patched = patchFinalizedDayDataMetadataInMemory({
        currentRecords: currentResult.value,
        ...params,
      });
      if (!patched.record) return null;
      const saved = await this.replaceFinalizedDay(patched.record);
      if (!saved.ok) throw Object.assign(new Error(saved.message), {
        name: saved.errorName,
      });
      return saved.value;
    });
  }

  async patchFinalizedDayByRecordId(params: {
    recordId: string;
    patch: FinalizedDayMetadataPatch;
  }): Promise<HistoricalArchiveResult<StoredFinalizedDayData | null>> {
    return safely("write", async () => {
      const currentResult = await this.listFinalizedDays();
      if (!currentResult.ok) throw Object.assign(new Error(currentResult.message), {
        name: currentResult.errorName,
      });
      const patched = patchFinalizedDayDataMetadataByRecordIdInMemory({
        currentRecords: currentResult.value,
        ...params,
      });
      if (!patched.record) return null;
      const saved = await this.replaceFinalizedDay(patched.record);
      if (!saved.ok) throw Object.assign(new Error(saved.message), {
        name: saved.errorName,
      });
      return saved.value;
    });
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("IndexedDB transaction failed"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? Object.assign(new Error("IndexedDB transaction aborted"), {
        name: "AbortError",
      }),
    );
  });
}

export class NativeIndexedDbHistoricalArchiveAdapter
  implements HistoricalArchiveAdapter {
  private readonly indexedDb: IDBFactory;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(indexedDb: IDBFactory = indexedDB) {
    this.indexedDb = indexedDb;
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.indexedDb.open(
          HISTORICAL_ARCHIVE_DB_NAME,
          HISTORICAL_ARCHIVE_DB_VERSION,
        );
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(HISTORICAL_ARCHIVE_REVIEW19_STORE)) {
          const store = database.createObjectStore(
            HISTORICAL_ARCHIVE_REVIEW19_STORE,
            { keyPath: "key" },
          );
          store.createIndex("date-demand-cycle", ["date", "demandCycle"], {
            unique: false,
          });
        }
        if (!database.objectStoreNames.contains(
          HISTORICAL_ARCHIVE_FINALIZED_DAY_STORE,
        )) {
          const store = database.createObjectStore(
            HISTORICAL_ARCHIVE_FINALIZED_DAY_STORE,
            { keyPath: "key" },
          );
          store.createIndex("recordId", "recordId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onblocked = () => reject(Object.assign(
        new Error("IndexedDB upgrade is blocked"),
        { name: "BlockedError" },
      ));
    });
    return this.databasePromise;
  }

  async getAll(store: HistoricalArchiveStoreName): Promise<HistoricalArchiveEntry[]> {
    const database = await this.open();
    const transaction = database.transaction(store, "readonly");
    const result = await requestResult(
      transaction.objectStore(store).getAll() as IDBRequest<HistoricalArchiveEntry[]>,
    );
    await transactionComplete(transaction);
    return clone(result);
  }

  async get(
    store: HistoricalArchiveStoreName,
    key: string,
  ): Promise<HistoricalArchiveEntry | undefined> {
    const database = await this.open();
    const transaction = database.transaction(store, "readonly");
    const result = await requestResult(
      transaction.objectStore(store).get(key) as IDBRequest<
        HistoricalArchiveEntry | undefined
      >,
    );
    await transactionComplete(transaction);
    return result ? clone(result) : undefined;
  }

  async putMany(
    store: HistoricalArchiveStoreName,
    entries: HistoricalArchiveEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const database = await this.open();
    const transaction = database.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    for (const entry of entries) objectStore.put(clone(entry));
    await transactionComplete(transaction);
  }

  async delete(store: HistoricalArchiveStoreName, key: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(store, "readwrite");
    transaction.objectStore(store).delete(key);
    await transactionComplete(transaction);
  }

  async count(store: HistoricalArchiveStoreName): Promise<number> {
    const database = await this.open();
    const transaction = database.transaction(store, "readonly");
    const value = await requestResult(transaction.objectStore(store).count());
    await transactionComplete(transaction);
    return value;
  }
}

export type MemoryHistoricalArchiveFault =
  | "read"
  | "write"
  | "delete"
  | null;

/** Dependency-free deterministic adapter for Node checks and failure injection. */
export class MemoryHistoricalArchiveAdapter implements HistoricalArchiveAdapter {
  private readonly stores = new Map<HistoricalArchiveStoreName, Map<string, HistoricalArchiveEntry>>([
    [HISTORICAL_ARCHIVE_REVIEW19_STORE, new Map()],
    [HISTORICAL_ARCHIVE_FINALIZED_DAY_STORE, new Map()],
  ]);
  fault: MemoryHistoricalArchiveFault = null;
  faultError: Error = Object.assign(new Error("Injected archive failure"), {
    name: "ArchiveInjectedError",
  });

  private maybeFail(operation: Exclude<MemoryHistoricalArchiveFault, null>): void {
    if (this.fault === operation) throw this.faultError;
  }

  async getAll(store: HistoricalArchiveStoreName): Promise<HistoricalArchiveEntry[]> {
    this.maybeFail("read");
    return [...(this.stores.get(store)?.values() ?? [])].map(clone);
  }

  async get(
    store: HistoricalArchiveStoreName,
    key: string,
  ): Promise<HistoricalArchiveEntry | undefined> {
    this.maybeFail("read");
    const value = this.stores.get(store)?.get(key);
    return value ? clone(value) : undefined;
  }

  async putMany(
    store: HistoricalArchiveStoreName,
    entries: HistoricalArchiveEntry[],
  ): Promise<void> {
    this.maybeFail("write");
    const target = this.stores.get(store);
    if (!target) throw new Error(`Missing memory store: ${store}`);
    // Stage first so injected/validation failures never partially commit.
    const staged = new Map(target);
    for (const entry of entries) staged.set(entry.key, clone(entry));
    this.stores.set(store, staged);
  }

  async delete(store: HistoricalArchiveStoreName, key: string): Promise<void> {
    this.maybeFail("delete");
    this.stores.get(store)?.delete(key);
  }

  async count(store: HistoricalArchiveStoreName): Promise<number> {
    this.maybeFail("read");
    return this.stores.get(store)?.size ?? 0;
  }
}

export type LegacyArchiveMigrationSourceResult = {
  key: string;
  sourcePresent: boolean;
  sourceRecordCount: number;
  archiveRecordCount: number;
  verified: boolean;
  sourceRemoved: boolean;
  failure: HistoricalArchiveFailure | null;
};

export type LegacyHistoricalArchiveMigrationResult = {
  ok: boolean;
  review19: LegacyArchiveMigrationSourceResult;
  finalizedDays: LegacyArchiveMigrationSourceResult;
};

function emptyMigrationResult(key: string): LegacyArchiveMigrationSourceResult {
  return {
    key,
    sourcePresent: false,
    sourceRecordCount: 0,
    archiveRecordCount: 0,
    verified: true,
    sourceRemoved: false,
    failure: null,
  };
}

function readLegacyStorage(storage: Storage, key: string): HistoricalArchiveResult<{
  present: boolean;
  value: unknown;
}> {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { ok: true, value: { present: false, value: [] } };
    return { ok: true, value: { present: true, value: JSON.parse(raw) as unknown } };
  } catch (error) {
    return failure("read", error);
  }
}

function removeLegacyStorage(storage: Storage, key: string): HistoricalArchiveResult<null> {
  try {
    storage.removeItem(key);
    return { ok: true, value: null };
  } catch (error) {
    return failure("remove_legacy", error);
  }
}

async function migrateReview19Source(params: {
  repository: HistoricalArchiveRepository;
  storage: Storage;
}): Promise<LegacyArchiveMigrationSourceResult> {
  const result = emptyMigrationResult(LEGACY_REVIEW19_STORAGE_KEY);
  const source = readLegacyStorage(params.storage, result.key);
  if (!source.ok) return { ...result, verified: false, failure: source };
  if (!source.value.present) return result;
  result.sourcePresent = true;
  const sourceRecords = normalizeRawReview19Array(source.value.value);
  if (!sourceRecords) {
    return {
      ...result,
      verified: false,
      failure: failure("verify", Object.assign(
        new Error("Legacy Review19 contains an invalid record"),
        { name: "ArchiveVerificationError" },
      )),
    };
  }
  result.sourceRecordCount = sourceRecords.length;
  const current = await params.repository.listAllReview19Records();
  if (!current.ok) return { ...result, verified: false, failure: current };
  const expected = mergeReview19ArchiveOperations([
    ...current.value,
    ...sourceRecords,
  ]);
  const write = await params.repository.upsertReview19Records(sourceRecords);
  if (!write.ok) return { ...result, verified: false, failure: write };
  const verified = await params.repository.listAllReview19Records();
  if (!verified.ok) return { ...result, verified: false, failure: verified };
  result.archiveRecordCount = verified.value.length;
  if (stableStringify(verified.value) !== stableStringify(expected)) {
    return {
      ...result,
      verified: false,
      failure: failure("verify", Object.assign(
        new Error("Review19 archive read-back differs from canonical source"),
        { name: "ArchiveVerificationError" },
      )),
    };
  }
  result.verified = true;
  const removed = removeLegacyStorage(params.storage, result.key);
  if (!removed.ok) return { ...result, sourceRemoved: false, failure: removed };
  return { ...result, sourceRemoved: true };
}

async function migrateFinalizedDaySource(params: {
  repository: HistoricalArchiveRepository;
  storage: Storage;
}): Promise<LegacyArchiveMigrationSourceResult> {
  const result = emptyMigrationResult(LEGACY_FINALIZED_DAY_STORAGE_KEY);
  const source = readLegacyStorage(params.storage, result.key);
  if (!source.ok) return { ...result, verified: false, failure: source };
  if (!source.value.present) return result;
  result.sourcePresent = true;
  const sourceRecords = normalizeRawFinalizedDayArray(source.value.value);
  if (!sourceRecords) {
    return {
      ...result,
      verified: false,
      failure: failure("verify", Object.assign(
        new Error("Legacy finalized-day contains an invalid record"),
        { name: "ArchiveVerificationError" },
      )),
    };
  }
  result.sourceRecordCount = sourceRecords.length;
  const current = await params.repository.listFinalizedDays();
  if (!current.ok) return { ...result, verified: false, failure: current };
  const expected = selectAllFinalizedDayData([...current.value, ...sourceRecords]);
  const write = await params.repository.upsertFinalizedDays(sourceRecords);
  if (!write.ok) return { ...result, verified: false, failure: write };
  const verified = await params.repository.listFinalizedDays();
  if (!verified.ok) return { ...result, verified: false, failure: verified };
  result.archiveRecordCount = verified.value.length;
  if (stableStringify(verified.value) !== stableStringify(expected)) {
    return {
      ...result,
      verified: false,
      failure: failure("verify", Object.assign(
        new Error("Finalized-day archive read-back differs from canonical source"),
        { name: "ArchiveVerificationError" },
      )),
    };
  }
  result.verified = true;
  const removed = removeLegacyStorage(params.storage, result.key);
  if (!removed.ok) return { ...result, sourceRemoved: false, failure: removed };
  return { ...result, sourceRemoved: true };
}

/**
 * Idempotent read -> archive transaction -> exact read-back verification ->
 * legacy removal. A crash after archive commit but before removal is safe:
 * operation identities are stable and the next startup repeats the same puts.
 */
export async function migrateLegacyHistoricalLocalStorage(params: {
  repository: HistoricalArchiveRepository;
  storage: Storage;
}): Promise<LegacyHistoricalArchiveMigrationResult> {
  const review19 = await migrateReview19Source(params);
  const finalizedDays = await migrateFinalizedDaySource(params);
  return {
    ok:
      review19.verified &&
      finalizedDays.verified &&
      (!review19.sourcePresent || review19.sourceRemoved) &&
      (!finalizedDays.sourcePresent || finalizedDays.sourceRemoved),
    review19,
    finalizedDays,
  };
}
