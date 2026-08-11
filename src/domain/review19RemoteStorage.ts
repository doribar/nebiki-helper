import { isDemandCycle, normalizeDemandCycle } from "./demandCycle.ts";
import {
  cloneReview19Result,
  getReview19SourceUpdatedAt,
  normalizeReview19Result,
} from "./review19.ts";
import { formatSupabaseHttpError } from "./supabaseSyncDiagnostics.ts";
import type { DemandCycle, Review19Result } from "./types.ts";

export { getReview19SourceUpdatedAt } from "./review19.ts";

export const REVIEW19_REMOTE_TABLE = "review19_records" as const;

const REVIEW19_REMOTE_COLUMNS = [
  "data_schema_version",
  "app_version",
  "build_id",
  "date",
  "session_started_at",
  "demand_cycle",
  "recorded_at",
  "source_updated_at",
  "is_complete",
  "payload",
].join(",");

export type RemoteReview19Config = {
  url: string;
  anonKey: string;
};

export type RemoteReview19Row<TPayload = unknown> = {
  data_schema_version: number | null;
  app_version: string | null;
  build_id: string | null;
  date: string;
  session_started_at: string;
  demand_cycle: DemandCycle;
  recorded_at: string | null;
  source_updated_at: string;
  is_complete: boolean;
  payload: TPayload;
};

export type BuiltRemoteReview19Row = RemoteReview19Row<Review19Result>;

export type RemoteReview19LoadResult =
  | { status: "disabled" }
  | { status: "ready"; records: Review19Result[] }
  | { status: "error"; message: string };

export type RemoteReview19SaveResult =
  | { status: "disabled" }
  | { status: "saved"; savedCount: number }
  | { status: "error"; message: string };

export type Review19Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RemoteReview19RequestOptions = {
  /** Tests and non-Vite adapters may inject a config. Explicit null disables I/O. */
  config?: RemoteReview19Config | null;
  fetchImpl?: Review19Fetch;
  signal?: AbortSignal;
};

export type MergeReview19MedianHistoryParams = {
  localRecords: readonly Review19Result[];
  remoteRecords: readonly Review19Result[];
  demandCycle?: DemandCycle;
};

function normalizeConfig(
  candidate: RemoteReview19Config | null | undefined,
): RemoteReview19Config | null {
  const url = candidate?.url.trim();
  const anonKey = candidate?.anonKey.trim();
  if (!url || !anonKey) return null;

  return {
    url: url.replace(/\/+$/, ""),
    anonKey,
  };
}

function getSupabaseConfig(): RemoteReview19Config | null {
  const env = (
    import.meta as ImportMeta & {
      readonly env?: Record<string, string | undefined>;
    }
  ).env;

  return normalizeConfig({
    url: env?.VITE_SUPABASE_URL ?? "",
    anonKey: env?.VITE_SUPABASE_ANON_KEY ?? "",
  });
}

function resolveConfig(
  options?: RemoteReview19RequestOptions,
): RemoteReview19Config | null {
  if (options && Object.prototype.hasOwnProperty.call(options, "config")) {
    return normalizeConfig(options.config);
  }
  return getSupabaseConfig();
}

function resolveFetch(
  options?: RemoteReview19RequestOptions,
): Review19Fetch | null {
  if (options?.fetchImpl) return options.fetchImpl;
  if (typeof globalThis.fetch !== "function") return null;
  return globalThis.fetch.bind(globalThis);
}

function buildHeaders(config: RemoteReview19Config): HeadersInit {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    "Content-Type": "application/json",
  };
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    return formatSupabaseHttpError(response.status, await response.text());
  } catch {
    return `HTTP ${response.status}`;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}

function isNullableSchemaVersion(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 1)
  );
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function timestampsRepresentSameInstant(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (left == null || right == null) return left == null && right == null;
  return Date.parse(left) === Date.parse(right);
}

function isValidBusinessDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function cloneNormalizedReview19(record: Review19Result): Review19Result {
  const cloned = cloneReview19Result(record);
  if (!cloned) {
    throw new TypeError("Invalid Review19 record");
  }
  return cloned;
}

function normalizeRecordForRemote(record: Review19Result): Review19Result {
  const normalized = normalizeReview19Result(record);
  if (
    !normalized ||
    normalized.review19Status !== "recorded" ||
    !isValidBusinessDate(normalized.date) ||
    !isValidTimestamp(normalized.sessionStartedAt) ||
    (normalized.recordedAt !== undefined &&
      !isValidTimestamp(normalized.recordedAt))
  ) {
    throw new TypeError("Invalid Review19 record");
  }
  return cloneNormalizedReview19(normalized);
}

function metadataMatches(
  row: RemoteReview19Row,
  record: Review19Result,
): boolean {
  return (
    row.data_schema_version === (record.dataSchemaVersion ?? null) &&
    row.app_version === (record.appVersion ?? null) &&
    row.build_id === (record.buildId ?? null)
  );
}

/**
 * Validates one REST row as an all-or-nothing trust boundary.
 * The payload is normalized for backward compatibility, but its business
 * identity must still agree exactly with the fixed columns.
 */
export function normalizeRemoteReview19Row(
  raw: unknown,
  expectedDemandCycle: DemandCycle,
): Review19Result | null {
  if (!isDemandCycle(expectedDemandCycle) || !isPlainObject(raw)) return null;

  const row = raw as Partial<RemoteReview19Row>;
  if (
    !isNullableSchemaVersion(row.data_schema_version) ||
    !isNullableNonEmptyString(row.app_version) ||
    !isNullableNonEmptyString(row.build_id) ||
    !isValidBusinessDate(row.date) ||
    !isValidTimestamp(row.session_started_at) ||
    row.demand_cycle !== expectedDemandCycle ||
    (row.recorded_at !== null && !isValidTimestamp(row.recorded_at)) ||
    !isValidTimestamp(row.source_updated_at) ||
    Date.parse(row.source_updated_at) < Date.parse(row.session_started_at) ||
    typeof row.is_complete !== "boolean" ||
    !isPlainObject(row.payload)
  ) {
    return null;
  }

  const payload = row.payload as Partial<Review19Result>;
  if (
    payload.sourceUpdatedAt !== undefined &&
    (!isValidTimestamp(payload.sourceUpdatedAt) ||
      !timestampsRepresentSameInstant(
        payload.sourceUpdatedAt,
        getReview19SourceUpdatedAt(payload),
      ))
  ) {
    return null;
  }

  const normalized = normalizeReview19Result(payload);
  if (
    !normalized ||
    normalized.review19Status !== "recorded" ||
    normalized.date !== row.date ||
    !timestampsRepresentSameInstant(
      normalized.sessionStartedAt,
      row.session_started_at,
    ) ||
    normalizeDemandCycle(normalized.demandCycle) !== row.demand_cycle ||
    !timestampsRepresentSameInstant(normalized.recordedAt, row.recorded_at) ||
    !timestampsRepresentSameInstant(
      getReview19SourceUpdatedAt(normalized),
      row.source_updated_at,
    ) ||
    normalized.dataQuality.complete !== row.is_complete ||
    !metadataMatches(row as RemoteReview19Row, normalized)
  ) {
    return null;
  }

  return cloneNormalizedReview19(normalized);
}

/** Returns null if the response shape or even one row is invalid. */
export function normalizeRemoteReview19Rows(
  raw: unknown,
  expectedDemandCycle: DemandCycle,
): Review19Result[] | null {
  if (!isDemandCycle(expectedDemandCycle) || !Array.isArray(raw)) return null;

  const records: Review19Result[] = [];
  const businessKeys = new Set<string>();
  for (const candidate of raw) {
    const record = normalizeRemoteReview19Row(candidate, expectedDemandCycle);
    if (!record) return null;

    const key = `${record.date}::${normalizeDemandCycle(record.demandCycle)}`;
    if (businessKeys.has(key)) return null;
    businessKeys.add(key);
    records.push(record);
  }

  return records.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.sessionStartedAt.localeCompare(b.sessionStartedAt);
  });
}

/**
 * Builds both partial and final rows. A complete partial is represented by
 * is_complete=true and recorded_at=null; finality is the recorded_at field.
 */
export function buildRemoteReview19Row(
  record: Review19Result,
): BuiltRemoteReview19Row {
  const normalized = normalizeRecordForRemote(record);
  const demandCycle = normalizeDemandCycle(normalized.demandCycle);
  const sourceUpdatedAt = getReview19SourceUpdatedAt(normalized);
  if (!sourceUpdatedAt) {
    throw new TypeError("Review19 source timestamp is unavailable");
  }

  return {
    data_schema_version: normalized.dataSchemaVersion ?? null,
    app_version: normalized.appVersion ?? null,
    build_id: normalized.buildId ?? null,
    date: normalized.date,
    session_started_at: normalized.sessionStartedAt,
    demand_cycle: demandCycle,
    recorded_at: normalized.recordedAt ?? null,
    source_updated_at: sourceUpdatedAt,
    is_complete: normalized.dataQuality.complete,
    payload: normalized,
  };
}

function getRecordTimestamp(record: Review19Result): number {
  return Date.parse(getReview19SourceUpdatedAt(record) ?? "");
}

function isFinalRecord(record: Review19Result): boolean {
  return isValidTimestamp(record.recordedAt);
}

export function isCompleteFinalReview19Record(
  record: Review19Result,
): boolean {
  const normalized = normalizeReview19Result(record);
  return Boolean(
    normalized &&
      normalized.review19Status === "recorded" &&
      normalized.dataQuality.complete &&
      isFinalRecord(normalized),
  );
}

function compareCanonicalPreference(
  a: Review19Result,
  b: Review19Result,
): number {
  const finalCompare = Number(isFinalRecord(a)) - Number(isFinalRecord(b));
  if (finalCompare !== 0) return finalCompare;

  const completeCompare =
    Number(a.dataQuality.complete) - Number(b.dataQuality.complete);
  if (completeCompare !== 0) return completeCompare;

  const timestampCompare = getRecordTimestamp(a) - getRecordTimestamp(b);
  if (timestampCompare !== 0) return timestampCompare;

  return a.sessionStartedAt.localeCompare(b.sessionStartedAt);
}

/** Deduplicates a write batch to match unique(date, demand_cycle). */
export function buildRemoteReview19Rows(
  records: readonly Review19Result[],
): BuiltRemoteReview19Row[] {
  const canonicalByBusinessKey = new Map<string, Review19Result>();

  for (const source of records) {
    const record = normalizeRecordForRemote(source);
    const demandCycle = normalizeDemandCycle(record.demandCycle);
    const key = `${record.date}::${demandCycle}`;
    const current = canonicalByBusinessKey.get(key);
    if (!current || compareCanonicalPreference(record, current) >= 0) {
      canonicalByBusinessKey.set(key, record);
    }
  }

  return [...canonicalByBusinessKey.values()]
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return normalizeDemandCycle(a.demandCycle).localeCompare(
        normalizeDemandCycle(b.demandCycle),
      );
    })
    .map(buildRemoteReview19Row);
}

/**
 * Produces median history only: complete final records, one canonical record
 * per date and demand cycle. Remote wins an otherwise exact tie. Normalizing a
 * legacy five-scale record does not materialize humanEvaluationDetails.
 */
export function mergeReview19MedianHistory(
  params: MergeReview19MedianHistoryParams,
): Review19Result[] {
  if (
    params.demandCycle !== undefined &&
    !isDemandCycle(params.demandCycle)
  ) {
    return [];
  }

  const canonicalByBusinessKey = new Map<
    string,
    { record: Review19Result; sourceRank: number }
  >();
  const sources: Array<{
    records: readonly Review19Result[];
    sourceRank: number;
  }> = [
    { records: params.localRecords, sourceRank: 0 },
    { records: params.remoteRecords, sourceRank: 1 },
  ];

  for (const source of sources) {
    for (const candidate of source.records) {
      const normalized = normalizeReview19Result(candidate);
      if (!normalized || !isCompleteFinalReview19Record(normalized)) continue;

      const demandCycle = normalizeDemandCycle(normalized.demandCycle);
      if (
        params.demandCycle !== undefined &&
        demandCycle !== params.demandCycle
      ) {
        continue;
      }

      const key = `${normalized.date}::${demandCycle}`;
      const current = canonicalByBusinessKey.get(key);
      const preference = current
        ? compareCanonicalPreference(normalized, current.record)
        : 1;
      if (
        !current ||
        preference > 0 ||
        (preference === 0 && source.sourceRank >= current.sourceRank)
      ) {
        canonicalByBusinessKey.set(key, {
          record: cloneNormalizedReview19(normalized),
          sourceRank: source.sourceRank,
        });
      }
    }
  }

  return [...canonicalByBusinessKey.values()]
    .map(({ record }) => cloneNormalizedReview19(record))
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return normalizeDemandCycle(a.demandCycle).localeCompare(
        normalizeDemandCycle(b.demandCycle),
      );
    });
}

export async function loadRemoteReview19Records(
  demandCycle: DemandCycle,
  options?: RemoteReview19RequestOptions,
): Promise<RemoteReview19LoadResult> {
  if (!isDemandCycle(demandCycle)) {
    return { status: "error", message: "Invalid demand cycle" };
  }

  const config = resolveConfig(options);
  if (!config) return { status: "disabled" };
  const fetchImpl = resolveFetch(options);
  if (!fetchImpl) {
    return { status: "error", message: "Fetch is unavailable" };
  }

  const url =
    `${config.url}/rest/v1/${REVIEW19_REMOTE_TABLE}` +
    `?select=${REVIEW19_REMOTE_COLUMNS}` +
    `&demand_cycle=eq.${demandCycle}&order=date.asc`;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: buildHeaders(config),
      signal: options?.signal,
    });
    if (!response.ok) {
      return { status: "error", message: await getErrorMessage(response) };
    }

    const records = normalizeRemoteReview19Rows(
      await response.json(),
      demandCycle,
    );
    if (!records) {
      return {
        status: "error",
        message: "Invalid review19_records response",
      };
    }
    return { status: "ready", records };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "unknown error",
    };
  }
}

export async function upsertRemoteReview19Records(
  records: readonly Review19Result[],
  options?: RemoteReview19RequestOptions,
): Promise<RemoteReview19SaveResult> {
  const config = resolveConfig(options);
  if (!config) return { status: "disabled" };
  const fetchImpl = resolveFetch(options);
  if (!fetchImpl) {
    return { status: "error", message: "Fetch is unavailable" };
  }

  let rows: BuiltRemoteReview19Row[];
  try {
    rows = buildRemoteReview19Rows(records);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Invalid Review19 record",
    };
  }
  if (rows.length === 0) return { status: "saved", savedCount: 0 };

  const url =
    `${config.url}/rest/v1/${REVIEW19_REMOTE_TABLE}` +
    "?on_conflict=date,demand_cycle";

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        ...buildHeaders(config),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
      signal: options?.signal,
    });
    if (!response.ok) {
      // A missing table/column is an error. Do not retry against an older schema.
      return { status: "error", message: await getErrorMessage(response) };
    }

    return { status: "saved", savedCount: rows.length };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "unknown error",
    };
  }
}

export async function upsertRemoteReview19Record(
  record: Review19Result,
  options?: RemoteReview19RequestOptions,
): Promise<RemoteReview19SaveResult> {
  return upsertRemoteReview19Records([record], options);
}
