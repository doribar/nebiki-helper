import {
  AREA_COUNT_LOCAL_STORAGE_KEY,
  LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY,
  LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY,
} from "./areaCountLocalStorage.ts";
import { DEMAND_CYCLE_STORAGE_KEYS } from "./demandCycleStorage.ts";
import { FINALIZED_DAY_DATA_STORAGE_KEY } from "./finalizedDayData.ts";
import { FIXED_TIME_TEMPERATURE_STORAGE_KEY } from "./fixedTimeTemperatureMemory.ts";
import { GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS } from "./globalDiscountAdjustment.ts";
import {
  NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES,
  STORAGE_KEYS,
} from "./storage.ts";
import { PENDING_SUPABASE_SYNC_STORAGE_KEY } from "./supabaseSyncQueue.ts";

export const NEBIKI_LOCAL_STORAGE_PREFIX = "nebiki-helper/";

/**
 * The budget is deliberately below typical 5 MiB localStorage limits. It is
 * an application soft budget, not a claim about the browser/origin quota.
 */
export { NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES } from "./storage.ts";

export const NEBIKI_KNOWN_LOCAL_STORAGE_KEYS = Object.freeze(
  Array.from(
    new Set<string>([
      ...Object.values(STORAGE_KEYS),
      AREA_COUNT_LOCAL_STORAGE_KEY,
      LEGACY_NORMAL_AREA_COUNT_STORAGE_KEY,
      LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY,
      FINALIZED_DAY_DATA_STORAGE_KEY,
      PENDING_SUPABASE_SYNC_STORAGE_KEY,
      ...Object.values(DEMAND_CYCLE_STORAGE_KEYS),
      FIXED_TIME_TEMPERATURE_STORAGE_KEY,
      ...Object.values(GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS),
      // Obsolete values are still included so a failed startup removal remains
      // visible without exposing its value.
      "nebiki-helper/app-mode-v1",
      "nebiki-helper/simple-mode-state-v1",
    ]),
  ).sort(),
);

export type StorageDiagnosticStorage = Pick<
  Storage,
  "length" | "key" | "getItem"
>;

export type ArchiveMigrationDiagnosticStatus =
  | "not_started"
  | "not_needed"
  | "in_progress"
  | "complete"
  | "partial"
  | "failed"
  | "unavailable"
  | "unknown";

export type ArchiveStorageDiagnosticInput = {
  review19Count: number | null;
  finalizedDayCount: number | null;
  dailySessionSnapshotCount?: number | null;
  areaCountCount?: number | null;
  migrationStatus: ArchiveMigrationDiagnosticStatus;
  /** Input-only sealing evidence; exact dates are never included in output. */
  finalizedDates?: readonly string[];
};

export type ArchiveStorageDiagnostic = Omit<
  ArchiveStorageDiagnosticInput,
  "finalizedDates"
>;

export type DailySnapshotStorageDiagnostic = {
  totalRecordCount: number;
  dateCount: number;
  currentDateCount: number;
  trulyActiveCount: number;
  historicalUnfinalizedDateCount: number;
  archivedCount: number;
  localPruneableCount: number;
  protectedCurrentDateCount: number;
  protectedCurrentSessionCount: number;
  oldestDate: string | null;
  newestDate: string | null;
};

export type AreaCountStorageDiagnostic = {
  totalCount: number;
  archivedCount: number;
  localOnlyCount: number;
  pendingCount: number;
  currentCount: number;
  remoteConfirmedCount: number;
  remoteUnconfirmedCount: number;
  localPruneableCount: number;
  offlineMinimumProtectedCount: number;
};

export type LocalStorageKeyDiagnostic = {
  key: string;
  present: boolean;
  readable: boolean;
  approxBytes: number;
  recordCount: number | null;
  errorName: string | null;
};

export type OriginStorageEstimateDiagnostic = {
  available: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  headroomBytes: number | null;
  errorName: string | null;
  /** Always false: StorageManager estimates the whole origin, not localStorage. */
  isLocalStorageQuota: false;
};

export type NebikiStorageUsageDiagnostic = {
  version: 1;
  collectedAt: string;
  status: "ready" | "partial" | "unavailable";
  localStorage: {
    keyPrefix: typeof NEBIKI_LOCAL_STORAGE_PREFIX;
    presentKeyCount: number;
    knownKeyCount: number;
    unknownPrefixedKeyCount: number;
    totalApproxBytes: number;
    softBudgetBytes: number;
    headroomBytes: number;
    overBudgetBytes: number;
    entries: LocalStorageKeyDiagnostic[];
    topEntries: LocalStorageKeyDiagnostic[];
    protectedData: {
      currentSessionPresent: boolean;
      review19SourcePresent: boolean;
      pendingQueueCount: number;
      dailySnapshotCount: number;
      unfinalizedDailyDateCount: number;
    };
  };
  archive: ArchiveStorageDiagnostic;
  history: {
    dailySnapshots: DailySnapshotStorageDiagnostic | null;
    areaCount: AreaCountStorageDiagnostic | null;
  };
  originEstimate: OriginStorageEstimateDiagnostic;
};

export type StorageEstimateProvider = () => Promise<{
  usage?: number;
  quota?: number;
}>;

function getErrorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) {
    return String((error as { name?: unknown }).name ?? "Error");
  }
  return "Error";
}

function normalizeCount(value: number | null): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeArchiveDiagnostic(
  archive?: Partial<ArchiveStorageDiagnosticInput>,
): ArchiveStorageDiagnostic {
  const validStatuses: readonly ArchiveMigrationDiagnosticStatus[] = [
    "not_started",
    "not_needed",
    "in_progress",
    "complete",
    "partial",
    "failed",
    "unavailable",
    "unknown",
  ];
  return {
    review19Count: normalizeCount(archive?.review19Count ?? null),
    finalizedDayCount: normalizeCount(archive?.finalizedDayCount ?? null),
    dailySessionSnapshotCount: normalizeCount(
      archive?.dailySessionSnapshotCount ?? null,
    ),
    areaCountCount: normalizeCount(archive?.areaCountCount ?? null),
    migrationStatus: validStatuses.includes(
      archive?.migrationStatus as ArchiveMigrationDiagnosticStatus,
    )
      ? (archive?.migrationStatus as ArchiveMigrationDiagnosticStatus)
      : "unknown",
  };
}

function getParsedArray(storage: StorageDiagnosticStorage | null, key: string): unknown[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveDefaultStorage(): StorageDiagnosticStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function resolveDefaultEstimateProvider(): StorageEstimateProvider | null {
  try {
    if (
      typeof navigator === "undefined" ||
      !navigator.storage ||
      typeof navigator.storage.estimate !== "function"
    ) {
      return null;
    }
    return () => navigator.storage.estimate();
  } catch {
    return null;
  }
}

function countJsonRecords(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed === null) return 0;
    if (typeof parsed !== "object") return 1;

    // Fixed-time temperatures are the sole active by-date map. Counting its
    // dates is more useful than reporting one wrapper object.
    if (
      "byDate" in parsed &&
      (parsed as { byDate?: unknown }).byDate &&
      typeof (parsed as { byDate?: unknown }).byDate === "object" &&
      !Array.isArray((parsed as { byDate?: unknown }).byDate)
    ) {
      return Object.keys(
        (parsed as { byDate: Record<string, unknown> }).byDate,
      ).length;
    }
    return 1;
  } catch {
    return null;
  }
}

function collectDiscoveredKeys(storage: StorageDiagnosticStorage): {
  keys: string[];
  errorName: string | null;
} {
  const keys = new Set<string>(NEBIKI_KNOWN_LOCAL_STORAGE_KEYS);
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(NEBIKI_LOCAL_STORAGE_PREFIX)) keys.add(key);
    }
    return { keys: [...keys].sort(), errorName: null };
  } catch (error) {
    return { keys: [...keys].sort(), errorName: getErrorName(error) };
  }
}

function collectLocalStorageEntries(
  storage: StorageDiagnosticStorage | null,
  topEntryLimit: number,
): Pick<
  NebikiStorageUsageDiagnostic["localStorage"],
  | "presentKeyCount"
  | "knownKeyCount"
  | "unknownPrefixedKeyCount"
  | "totalApproxBytes"
  | "entries"
  | "topEntries"
> & { status: NebikiStorageUsageDiagnostic["status"] } {
  if (!storage) {
    return {
      status: "unavailable",
      presentKeyCount: 0,
      knownKeyCount: NEBIKI_KNOWN_LOCAL_STORAGE_KEYS.length,
      unknownPrefixedKeyCount: 0,
      totalApproxBytes: 0,
      entries: [],
      topEntries: [],
    };
  }

  const discovered = collectDiscoveredKeys(storage);
  const known = new Set<string>(NEBIKI_KNOWN_LOCAL_STORAGE_KEYS);
  let readFailure = false;
  const entries = discovered.keys.map<LocalStorageKeyDiagnostic>((key) => {
    try {
      const value = storage.getItem(key);
      if (value === null) {
        return {
          key,
          present: false,
          readable: true,
          approxBytes: 0,
          recordCount: 0,
          errorName: null,
        };
      }
      return {
        key,
        present: true,
        readable: true,
        approxBytes: (key.length + value.length) * 2,
        recordCount: countJsonRecords(value),
        errorName: null,
      };
    } catch (error) {
      readFailure = true;
      return {
        key,
        present: false,
        readable: false,
        approxBytes: 0,
        recordCount: null,
        errorName: getErrorName(error),
      };
    }
  });
  const presentEntries = entries.filter((entry) => entry.present);
  const topEntries = [...presentEntries]
    .sort(
      (left, right) =>
        right.approxBytes - left.approxBytes || left.key.localeCompare(right.key),
    )
    .slice(0, Math.max(0, topEntryLimit));
  return {
    status:
      discovered.errorName || readFailure
        ? "partial"
        : "ready",
    presentKeyCount: presentEntries.length,
    knownKeyCount: known.size,
    unknownPrefixedKeyCount: presentEntries.filter(
      (entry) => !known.has(entry.key),
    ).length,
    totalApproxBytes: presentEntries.reduce(
      (total, entry) => total + entry.approxBytes,
      0,
    ),
    entries,
    topEntries,
  };
}

async function collectOriginEstimate(
  provider: StorageEstimateProvider | null,
): Promise<OriginStorageEstimateDiagnostic> {
  if (!provider) {
    return {
      available: false,
      usageBytes: null,
      quotaBytes: null,
      headroomBytes: null,
      errorName: null,
      isLocalStorageQuota: false,
    };
  }
  try {
    const estimate = await provider();
    const usageBytes =
      typeof estimate.usage === "number" && Number.isFinite(estimate.usage)
        ? Math.max(0, Math.floor(estimate.usage))
        : null;
    const quotaBytes =
      typeof estimate.quota === "number" && Number.isFinite(estimate.quota)
        ? Math.max(0, Math.floor(estimate.quota))
        : null;
    return {
      available: usageBytes !== null || quotaBytes !== null,
      usageBytes,
      quotaBytes,
      headroomBytes:
        usageBytes !== null && quotaBytes !== null
          ? Math.max(0, quotaBytes - usageBytes)
          : null,
      errorName: null,
      isLocalStorageQuota: false,
    };
  } catch (error) {
    return {
      available: false,
      usageBytes: null,
      quotaBytes: null,
      headroomBytes: null,
      errorName: getErrorName(error),
      isLocalStorageQuota: false,
    };
  }
}

export async function collectNebikiStorageUsageDiagnostic(params?: {
  storage?: StorageDiagnosticStorage | null;
  archive?: Partial<ArchiveStorageDiagnosticInput>;
  dailySnapshotDiagnostic?: DailySnapshotStorageDiagnostic | null;
  areaCountDiagnostic?: AreaCountStorageDiagnostic | null;
  estimateProvider?: StorageEstimateProvider | null;
  softBudgetBytes?: number;
  topEntryLimit?: number;
  now?: () => Date;
}): Promise<NebikiStorageUsageDiagnostic> {
  const storage =
    params && Object.prototype.hasOwnProperty.call(params, "storage")
      ? params.storage ?? null
      : resolveDefaultStorage();
  const softBudgetBytes = Math.max(
    0,
    Math.floor(
      params?.softBudgetBytes ?? NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES,
    ),
  );
  const local = collectLocalStorageEntries(
    storage,
    Math.max(0, Math.floor(params?.topEntryLimit ?? 10)),
  );
  const estimateProvider =
    params && Object.prototype.hasOwnProperty.call(params, "estimateProvider")
      ? params.estimateProvider ?? null
      : resolveDefaultEstimateProvider();
  const originEstimate = await collectOriginEstimate(estimateProvider);
  const headroomBytes = Math.max(0, softBudgetBytes - local.totalApproxBytes);
  const overBudgetBytes = Math.max(0, local.totalApproxBytes - softBudgetBytes);
  const presentByKey = new Map(
    local.entries.map((entry) => [entry.key, entry.present]),
  );
  const pendingQueueCount = getParsedArray(
    storage,
    PENDING_SUPABASE_SYNC_STORAGE_KEY,
  ).length;
  const snapshots = getParsedArray(storage, STORAGE_KEYS.dailySessionSnapshots);
  const finalizedDates = new Set(params?.archive?.finalizedDates ?? []);
  const unfinalizedDailyDateCount = new Set(
    snapshots.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const session = (value as { session?: unknown }).session;
      if (!session || typeof session !== "object") return [];
      const date = (session as { date?: unknown }).date;
      return typeof date === "string" && !finalizedDates.has(date) ? [date] : [];
    }),
  ).size;

  return {
    version: 1,
    collectedAt: (params?.now ?? (() => new Date()))().toISOString(),
    status: local.status,
    localStorage: {
      keyPrefix: NEBIKI_LOCAL_STORAGE_PREFIX,
      presentKeyCount: local.presentKeyCount,
      knownKeyCount: local.knownKeyCount,
      unknownPrefixedKeyCount: local.unknownPrefixedKeyCount,
      totalApproxBytes: local.totalApproxBytes,
      softBudgetBytes,
      headroomBytes,
      overBudgetBytes,
      entries: local.entries,
      topEntries: local.topEntries,
      protectedData: {
        currentSessionPresent: Boolean(presentByKey.get(STORAGE_KEYS.currentSession)),
        review19SourcePresent: Boolean(presentByKey.get(STORAGE_KEYS.review19SourceState)),
        pendingQueueCount,
        dailySnapshotCount: snapshots.length,
        unfinalizedDailyDateCount,
      },
    },
    archive: normalizeArchiveDiagnostic(params?.archive),
    history: {
      dailySnapshots: params?.dailySnapshotDiagnostic ?? null,
      areaCount: params?.areaCountDiagnostic ?? null,
    },
    originEstimate,
  };
}

export type StorageHeadroomPreflightResult = {
  ok: boolean;
  requiredAdditionalBytes: number;
  cleanupAttempted: boolean;
  cleanupSucceeded: boolean | null;
  cleanupErrorName: string | null;
  before: NebikiStorageUsageDiagnostic;
  after: NebikiStorageUsageDiagnostic;
};

/**
 * Proactive aggregate headroom check. This helper never decides what to
 * delete and performs no raw storage write. Callers may provide one reviewed,
 * idempotent cleanup coordinator; it is invoked at most once.
 */
export async function ensureNebikiLocalStorageHeadroom(params: {
  requiredAdditionalBytes: number;
  cleanup?: () => void | Promise<void>;
  storage?: StorageDiagnosticStorage | null;
  archive?: Partial<ArchiveStorageDiagnosticInput>;
  estimateProvider?: StorageEstimateProvider | null;
  softBudgetBytes?: number;
  now?: () => Date;
}): Promise<StorageHeadroomPreflightResult> {
  const requiredAdditionalBytes = Math.max(
    0,
    Math.floor(params.requiredAdditionalBytes),
  );
  const collect = () => {
    const diagnosticParams: Parameters<
      typeof collectNebikiStorageUsageDiagnostic
    >[0] = {
      archive: params.archive,
      softBudgetBytes: params.softBudgetBytes,
      now: params.now,
    };
    if (Object.prototype.hasOwnProperty.call(params, "storage")) {
      diagnosticParams.storage = params.storage;
    }
    if (Object.prototype.hasOwnProperty.call(params, "estimateProvider")) {
      diagnosticParams.estimateProvider = params.estimateProvider;
    }
    return collectNebikiStorageUsageDiagnostic(diagnosticParams);
  };
  const before = await collect();
  const initiallySafe =
    before.status !== "unavailable" &&
    before.localStorage.totalApproxBytes + requiredAdditionalBytes <=
      before.localStorage.softBudgetBytes;
  if (initiallySafe || !params.cleanup) {
    return {
      ok: initiallySafe,
      requiredAdditionalBytes,
      cleanupAttempted: false,
      cleanupSucceeded: null,
      cleanupErrorName: null,
      before,
      after: before,
    };
  }

  let cleanupSucceeded = false;
  let cleanupErrorName: string | null = null;
  try {
    await params.cleanup();
    cleanupSucceeded = true;
  } catch (error) {
    cleanupErrorName = getErrorName(error);
  }
  const after = await collect();
  return {
    ok:
      after.status !== "unavailable" &&
      after.localStorage.totalApproxBytes + requiredAdditionalBytes <=
        after.localStorage.softBudgetBytes,
    requiredAdditionalBytes,
    cleanupAttempted: true,
    cleanupSucceeded,
    cleanupErrorName,
    before,
    after,
  };
}

export function formatStorageKiB(bytes: number): string {
  return `${(Math.max(0, bytes) / 1024).toFixed(1)} KiB`;
}
