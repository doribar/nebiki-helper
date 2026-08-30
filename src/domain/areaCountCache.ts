import {
  cloneAreaCountRecords,
  getAreaCountRecordIdentity,
  mergeAreaCountRecordCollections,
  type AreaCountRecord,
} from "./areaCountHistory.ts";
import { AREA_COUNT_LOCAL_STORAGE_KEY } from "./areaCountLocalStorage.ts";

/**
 * The existing daily-snapshot cache has a 1 MiB soft budget. Using the same
 * measured envelope for AreaCount leaves quota headroom for Review19,
 * current-session, pending, and finalized-day authoritative data. This is a
 * soft limit: protected/local-only records are never discarded to satisfy it.
 */
export const AREA_COUNT_LOCAL_CACHE_BYTE_BUDGET = 1024 * 1024;

/** The median engine requires at least three matching observations. */
export const AREA_COUNT_OFFLINE_MIN_SAMPLE_SIZE = 3;

export type AreaCountCacheRetentionResult = {
  records: AreaCountRecord[];
  originalCount: number;
  retainedCount: number;
  evictedCount: number;
  seededFromRemoteCount: number;
  remoteConfirmedCount: number;
  protectedCount: number;
  retainedApproxBytes: number;
  byteBudget: number;
  protectedDataExceededBudget: boolean;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

const IDENTITY_FIELDS = new Set<keyof AreaCountRecord>([
  "date",
  "sessionStartedAt",
  "areaId",
  "discountTime",
  "demandCycle",
]);

/**
 * A remote row covers a local record only when the same business identity is
 * at least as new and contains every locally-defined diagnostic/detail field.
 * Pending absence alone is deliberately not treated as confirmation.
 */
export function isAreaCountRecordCoveredByRemote(params: {
  local: AreaCountRecord;
  remote: AreaCountRecord;
}): boolean {
  if (
    getAreaCountRecordIdentity(params.local) !==
    getAreaCountRecordIdentity(params.remote)
  ) {
    return false;
  }

  const localTime = Date.parse(params.local.recordedAt);
  const remoteTime = Date.parse(params.remote.recordedAt);
  if (!Number.isFinite(localTime) || !Number.isFinite(remoteTime)) return false;
  if (remoteTime < localTime) return false;

  const localEntries = Object.entries(params.local) as Array<
    [keyof AreaCountRecord, AreaCountRecord[keyof AreaCountRecord]]
  >;
  if (remoteTime === localTime) {
    return localEntries.every(([field, localValue]) => {
      if (localValue === undefined || IDENTITY_FIELDS.has(field)) return true;
      return valuesEqual(params.remote[field], localValue);
    });
  }

  // A genuinely newer revision may change count/evaluation values. The DB
  // merge retains prior detail keys, so absence of a locally-defined detail is
  // evidence that this remote row cannot yet reconstruct the local record.
  return localEntries.every(([field, localValue]) => {
    if (
      localValue === undefined ||
      IDENTITY_FIELDS.has(field) ||
      field === "recordedAt" ||
      field === "count"
    ) {
      return true;
    }
    return params.remote[field] !== undefined;
  });
}

export function estimateAreaCountCacheBytes(
  records: readonly AreaCountRecord[],
): number {
  const value = JSON.stringify(mergeAreaCountRecordCollections(records));
  return (AREA_COUNT_LOCAL_STORAGE_KEY.length + value.length) * 2;
}

function getSerializedArrayCharLength(
  records: readonly AreaCountRecord[],
): number {
  if (records.length === 0) return 2;
  return (
    2 +
    records.reduce(
      (total, record) => total + JSON.stringify(record).length,
      0,
    ) +
    records.length -
    1
  );
}

function compareNewestFirst(left: AreaCountRecord, right: AreaCountRecord): number {
  const timestamp = Date.parse(right.recordedAt) - Date.parse(left.recordedAt);
  if (Number.isFinite(timestamp) && timestamp !== 0) return timestamp;
  return getAreaCountRecordIdentity(right).localeCompare(
    getAreaCountRecordIdentity(left),
  );
}

function getCoverageKeys(record: AreaCountRecord): string[] {
  const prefix = [
    record.demandCycle ?? "normal",
    record.areaId,
    record.discountTime,
  ].join("|");
  return [
    `${prefix}|weekday:${record.actualWeekday ?? "unknown"}`,
    `${prefix}|group:${record.actualWeekdayGroup}`,
  ];
}

function incrementCoverage(
  counts: Map<string, number>,
  record: AreaCountRecord,
): void {
  for (const key of getCoverageKeys(record)) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

/**
 * Retains every unconfirmed/pending/current record, a minimum offline sample
 * for each cycle/area/time/reference bucket, then newest confirmed records up
 * to the soft byte budget. Protected data may exceed the budget by design.
 */
export function retainAreaCountLocalCacheWithinBudget(params: {
  localRecords: readonly AreaCountRecord[];
  remoteRecords: readonly AreaCountRecord[];
  pendingIdentities?: ReadonlySet<string>;
  protectedDates?: ReadonlySet<string>;
  byteBudget?: number;
  minimumSamplesPerGroup?: number;
  /** False when the full offline population is already available in IndexedDB. */
  seedRemoteRecords?: boolean;
}): AreaCountCacheRetentionResult {
  const localRecords = mergeAreaCountRecordCollections(params.localRecords);
  const remoteRecords = mergeAreaCountRecordCollections(params.remoteRecords);
  const remoteByIdentity = new Map(
    remoteRecords.map((record) => [getAreaCountRecordIdentity(record), record]),
  );
  const pendingIdentities = params.pendingIdentities ?? new Set<string>();
  const protectedDates = params.protectedDates ?? new Set<string>();
  const byteBudget = Math.max(
    0,
    Math.floor(params.byteBudget ?? AREA_COUNT_LOCAL_CACHE_BYTE_BUDGET),
  );
  const minimumSamplesPerGroup = Math.max(
    0,
    Math.floor(
      params.minimumSamplesPerGroup ?? AREA_COUNT_OFFLINE_MIN_SAMPLE_SIZE,
    ),
  );

  const protectedRecords: AreaCountRecord[] = [];
  const confirmedCandidates: AreaCountRecord[] = [];
  const localIdentitySet = new Set(
    localRecords.map((record) => getAreaCountRecordIdentity(record)),
  );
  for (const local of localRecords) {
    const identity = getAreaCountRecordIdentity(local);
    const remote = remoteByIdentity.get(identity);
    const confirmed = Boolean(
      remote && isAreaCountRecordCoveredByRemote({ local, remote }),
    );
    if (
      !confirmed ||
      pendingIdentities.has(identity) ||
      protectedDates.has(local.date)
    ) {
      protectedRecords.push(local);
    } else {
      confirmedCandidates.push(local);
    }
  }
  // Keep a bounded offline fallback even on a fresh device. Remote rows are
  // cache candidates only; they never become pending or local-first evidence.
  if (params.seedRemoteRecords !== false) {
    for (const remote of remoteRecords) {
      if (!localIdentitySet.has(getAreaCountRecordIdentity(remote))) {
        confirmedCandidates.push(remote);
      }
    }
  }

  const coverage = new Map<string, number>();
  for (const record of protectedRecords) incrementCoverage(coverage, record);

  const coverageRecords: AreaCountRecord[] = [];
  const remainingCandidates: AreaCountRecord[] = [];
  for (const record of confirmedCandidates.sort(compareNewestFirst)) {
    const requiresCoverage = getCoverageKeys(record).some(
      (key) => (coverage.get(key) ?? 0) < minimumSamplesPerGroup,
    );
    if (requiresCoverage) {
      coverageRecords.push(record);
      incrementCoverage(coverage, record);
    } else {
      remainingCandidates.push(record);
    }
  }

  let retained = mergeAreaCountRecordCollections(
    protectedRecords,
    coverageRecords,
  );
  let retainedValueChars = getSerializedArrayCharLength(retained);
  const entryBytes = (valueChars: number) =>
    (AREA_COUNT_LOCAL_STORAGE_KEY.length + valueChars) * 2;
  const protectedDataExceededBudget = entryBytes(retainedValueChars) > byteBudget;

  if (!protectedDataExceededBudget) {
    for (const record of remainingCandidates) {
      // Candidates are already identity-deduped above, so the serialized JSON
      // array length can be updated exactly without re-merging and serializing
      // the entire cache for every candidate. This keeps 2,000+ row startup
      // housekeeping practical on a phone.
      const recordChars = JSON.stringify(record).length;
      const nextValueChars =
        retained.length === 0
          ? 2 + recordChars
          : retainedValueChars + 1 + recordChars;
      if (entryBytes(nextValueChars) > byteBudget) continue;
      retained.push(record);
      retainedValueChars = nextValueChars;
    }
  }

  retained = mergeAreaCountRecordCollections(retained);
  const retainedIdentitySet = new Set(
    retained.map((record) => getAreaCountRecordIdentity(record)),
  );
  return {
    records: cloneAreaCountRecords(retained),
    originalCount: localRecords.length,
    retainedCount: retained.length,
    evictedCount: localRecords.filter(
      (record) => !retainedIdentitySet.has(getAreaCountRecordIdentity(record)),
    ).length,
    seededFromRemoteCount: retained.filter(
      (record) => !localIdentitySet.has(getAreaCountRecordIdentity(record)),
    ).length,
    remoteConfirmedCount: confirmedCandidates.length,
    protectedCount: protectedRecords.length,
    retainedApproxBytes: estimateAreaCountCacheBytes(retained),
    byteBudget,
    protectedDataExceededBudget,
  };
}
