import {
  cloneAreaCountRecords,
  mergeAreaCountRecordCollections,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "./areaCountHistory.ts";
import {
  attemptStorageOperation,
  reportStorageOperationFailures,
} from "./storage.ts";

export const AREA_COUNT_LOCAL_STORAGE_KEY =
  "nebiki-helper/area-count-records-v2" as const;

export const LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY =
  "nebiki-helper/area-count-records" as const;

export const LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY =
  "nebiki-helper/summer-area-count-records-v1" as const;

export type AreaCountLocalStorage = Pick<Storage, "getItem" | "setItem">;

export type AreaCountLocalStorageOptions = {
  storage?: AreaCountLocalStorage | null;
};

function getDefaultStorage(): AreaCountLocalStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function resolveStorage(
  storage: AreaCountLocalStorage | null | undefined,
): AreaCountLocalStorage | null {
  return storage === undefined ? getDefaultStorage() : storage;
}

export function isAreaCountLocalStorageAvailable(
  options: AreaCountLocalStorageOptions = {},
): boolean {
  return resolveStorage(options.storage) !== null;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function loadUnifiedAreaCountRecords(
  options: AreaCountLocalStorageOptions = {},
): AreaCountRecord[] {
  const storage = resolveStorage(options.storage);
  if (!storage) return [];
  return normalizeAreaCountRecords(
    parseJson(storage.getItem(AREA_COUNT_LOCAL_STORAGE_KEY)),
  );
}

export function loadLegacySummerAreaCountRecords(
  options: AreaCountLocalStorageOptions = {},
): AreaCountRecord[] {
  const storage = resolveStorage(options.storage);
  if (!storage) return [];
  return normalizeAreaCountRecords(
    parseJson(storage.getItem(LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY)),
    "summer",
  ).filter((record) => record.demandCycle === "summer");
}

export function loadLegacyNormalAreaCountRecords(
  options: AreaCountLocalStorageOptions = {},
): AreaCountRecord[] {
  const storage = resolveStorage(options.storage);
  if (!storage) return [];
  return normalizeAreaCountRecords(
    parseJson(storage.getItem(LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY)),
    "normal",
  ).filter((record) => record.demandCycle === "normal");
}

export function loadLocalAreaCountRecords(
  options: AreaCountLocalStorageOptions = {},
): AreaCountRecord[] {
  return mergeAreaCountRecordCollections(
    loadUnifiedAreaCountRecords(options),
    loadLegacyNormalAreaCountRecords(options),
    loadLegacySummerAreaCountRecords(options),
  );
}

export const loadAreaCountRecordsFromLocalStorage =
  loadLocalAreaCountRecords;

/**
 * Canonical AreaCount cache write. This is the authoritative local-first stage;
 * compatibility mirrors must never change whether this write succeeded.
 */
export function saveUnifiedAreaCountRecords(
  records: readonly AreaCountRecord[],
  options: AreaCountLocalStorageOptions = {},
): AreaCountRecord[] {
  const storage = resolveStorage(options.storage);
  const current = storage ? loadLocalAreaCountRecords({ storage }) : [];
  const merged = mergeAreaCountRecordCollections(
    current,
    normalizeAreaCountRecords(records),
  );

  if (storage) {
    storage.setItem(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(merged));
  }

  return cloneAreaCountRecords(merged);
}

/**
 * Best-effort compatibility copy for pre-unified summer readers. The unified
 * v2 cache remains the source of truth even when this derived mirror fails.
 */
export function saveLegacySummerAreaCountRecordsMirror(
  records: readonly AreaCountRecord[],
  options: AreaCountLocalStorageOptions = {},
): void {
  const storage = resolveStorage(options.storage);
  if (!storage) return;

  const summerRecords = mergeAreaCountRecordCollections(
    loadLegacySummerAreaCountRecords({ storage }),
    normalizeAreaCountRecords(records).filter(
      (record) => record.demandCycle === "summer",
    ),
  );
  storage.setItem(
    LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY,
    JSON.stringify(summerRecords),
  );
}

export function saveLocalAreaCountRecords(
  records: readonly AreaCountRecord[],
  options: AreaCountLocalStorageOptions = {},
): AreaCountRecord[] {
  const merged = saveUnifiedAreaCountRecords(records, options);
  const mirrorResult = attemptStorageOperation({
    key: LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY,
    operation: "set",
    run: () => saveLegacySummerAreaCountRecordsMirror(merged, options),
  });
  reportStorageOperationFailures(
    "area-count-legacy-summer-mirror",
    [mirrorResult],
  );
  return cloneAreaCountRecords(merged);
}

export const saveAreaCountRecordsToLocalStorage =
  saveLocalAreaCountRecords;

export function upsertLocalAreaCountRecord(
  record: AreaCountRecord,
  options: AreaCountLocalStorageOptions = {},
): AreaCountRecord[] {
  return saveLocalAreaCountRecords([record], options);
}

export const upsertAreaCountRecordInLocalStorage =
  upsertLocalAreaCountRecord;
