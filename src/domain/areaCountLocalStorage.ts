import {
  cloneAreaCountRecords,
  mergeAreaCountRecordCollections,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "./areaCountHistory.ts";

export const AREA_COUNT_LOCAL_STORAGE_KEY =
  "nebiki-helper/area-count-records-v2" as const;

export const LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY =
  "nebiki-helper/area-count-records" as const;

export const LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY =
  "nebiki-helper/summer-area-count-records-v1" as const;

export type AreaCountLocalStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

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
 * Replaces only the unified cache with the supplied canonical collection.
 *
 * Unlike saveUnifiedAreaCountRecords(), this function intentionally does not
 * merge the existing cache back in. It is reserved for a remote-confirmed,
 * authoritative-aware cache retention decision; normal local-first writes
 * must continue to use saveUnifiedAreaCountRecords().
 */
export function replaceUnifiedAreaCountRecords(
  records: readonly AreaCountRecord[],
  options: AreaCountLocalStorageOptions = {},
): AreaCountRecord[] {
  const storage = resolveStorage(options.storage);
  const canonical = mergeAreaCountRecordCollections(
    normalizeAreaCountRecords(records),
  );
  if (storage) {
    storage.setItem(AREA_COUNT_LOCAL_STORAGE_KEY, JSON.stringify(canonical));
  }
  return cloneAreaCountRecords(canonical);
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
  // 9-12: v1 summer is a read/import-only compatibility source. Recreating a
  // full duplicate after every authoritative v2 write was a principal quota
  // pressure path. Existing mirror-only/richer rows remain readable and are
  // never removed without a separate semantic-coverage proof.
  return saveUnifiedAreaCountRecords(records, options);
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

export type LegacyAreaCountStorageKey =
  | typeof LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY
  | typeof LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY;

function getLegacyRecordsForKey(
  key: LegacyAreaCountStorageKey,
  storage: AreaCountLocalStorage,
): AreaCountRecord[] {
  return key === LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY
    ? loadLegacySummerAreaCountRecords({ storage })
    : loadLegacyNormalAreaCountRecords({ storage });
}

/**
 * True only when deleting the complete legacy value cannot remove any
 * identity, newer revision, or richer detail that is absent from unified v2.
 */
export function isLegacyAreaCountStorageFullyCovered(
  key: LegacyAreaCountStorageKey,
  options: AreaCountLocalStorageOptions = {},
): boolean {
  const storage = resolveStorage(options.storage);
  if (!storage) return false;
  const raw = storage.getItem(key);
  if (raw === null) return false;

  const legacy = getLegacyRecordsForKey(key, storage);
  if (legacy.length === 0) return raw.trim() === "[]";

  const unified = mergeAreaCountRecordCollections(
    loadUnifiedAreaCountRecords({ storage }),
  );
  const withLegacy = mergeAreaCountRecordCollections(unified, legacy);
  return JSON.stringify(withLegacy) === JSON.stringify(unified);
}

export function removeLegacyAreaCountStorage(
  key: LegacyAreaCountStorageKey,
  options: AreaCountLocalStorageOptions = {},
): void {
  resolveStorage(options.storage)?.removeItem(key);
}
