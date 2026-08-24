import type { AreaCountRecord } from "./areaCountHistory.ts";
import {
  mergeAreaCountRecordCollections,
  normalizeAreaCountRecords,
} from "./areaCountHistory.ts";
import { normalizeDemandCycle } from "./demandCycle.ts";
import type {
  AreaCountEvaluation,
  AreaCountEvaluationSource,
  AreaRateAdjustment,
  DemandCycle,
  HumanEvaluationDetails,
} from "./types.ts";
import type { AreaCountDecisionBasis } from "./areaCountHistory.ts";
import { getLegacyHumanEvaluationDetails } from "./humanEvaluation.ts";
import { formatSupabaseHttpError } from "./supabaseSyncDiagnostics.ts";
import type {
  AnalysisCalendarContext,
  AnalysisWeatherContext,
} from "./analysisMetadata.ts";

type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export type RemoteAreaCountRequestOptions = {
  config?: SupabaseConfig | null;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type RemoteAreaCountDetails = {
  userJudge?: AreaCountEvaluation;
  humanEvaluationDetails?: HumanEvaluationDetails;
  suggestedEvaluation?: AreaCountEvaluation;
  areaRateAdjustment?: AreaRateAdjustment;
  evaluationSource?: AreaCountEvaluationSource;
  decisionBasis?: AreaCountDecisionBasis;
  comfortPoint?: number;
  calendarContext?: AnalysisCalendarContext;
  analysisWeatherContext?: AnalysisWeatherContext;
};

export type RemoteAreaCountRow = {
  data_schema_version?: number | null;
  app_version?: string | null;
  build_id?: string | null;
  date: string;
  session_started_at: string;
  recorded_at: string;
  area_id: string;
  discount_time: string;
  actual_weekday?: string | null;
  actual_weekday_group: string;
  count: number;
  demand_cycle?: DemandCycle | null;
  record_details?: RemoteAreaCountDetails | null;
};

export type RemoteStorageErrorKind =
  | "network"
  | "rate_limited"
  | "server"
  | "auth"
  | "schema"
  | "unknown";

export type RemoteAreaCountLoadResult =
  | { status: "disabled" }
  | { status: "ready"; records: AreaCountRecord[] }
  | {
      status: "error";
      message: string;
      errorKind: RemoteStorageErrorKind;
      httpStatus?: number;
    };

export type RemoteAreaCountSaveResult =
  | { status: "disabled" }
  | { status: "saved"; savedCount: number }
  | {
      status: "error";
      message: string;
      errorKind: RemoteStorageErrorKind;
      httpStatus?: number;
    };

const TABLE_NAME = "area_count_records";
export const AREA_COUNT_REMOTE_PAGE_SIZE = 1000;
export const AREA_COUNT_REMOTE_CONFLICT_COLUMNS = [
  "date",
  "session_started_at",
  "area_id",
  "discount_time",
  "demand_cycle",
] as const;

function getSupabaseConfig(): SupabaseConfig | null {
  const env = (
    import.meta as ImportMeta & { readonly env?: Record<string, string | undefined> }
  ).env ?? {};
  const rawUrl = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!rawUrl || !anonKey) return null;

  return {
    url: rawUrl.replace(/\/+$/, ""),
    anonKey,
  };
}

function resolveSupabaseConfig(
  options?: RemoteAreaCountRequestOptions,
): SupabaseConfig | null {
  if (options && Object.prototype.hasOwnProperty.call(options, "config")) {
    const rawUrl = options.config?.url.trim();
    const anonKey = options.config?.anonKey.trim();
    if (!rawUrl || !anonKey) return null;
    return { url: rawUrl.replace(/\/+$/, ""), anonKey };
  }
  return getSupabaseConfig();
}

function resolveFetch(options?: RemoteAreaCountRequestOptions): typeof fetch | null {
  if (options?.fetchImpl) return options.fetchImpl;
  return typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
}

function buildHeaders(config: SupabaseConfig): HeadersInit {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    "Content-Type": "application/json",
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeRemoteDetails(raw: unknown): RemoteAreaCountDetails {
  if (!isObject(raw)) return {};
  return cloneJson(raw) as RemoteAreaCountDetails;
}

function rowToRecord(row: RemoteAreaCountRow): Partial<AreaCountRecord> {
  const details = normalizeRemoteDetails(row.record_details);
  return {
    dataSchemaVersion: row.data_schema_version ?? undefined,
    appVersion: row.app_version ?? undefined,
    buildId: row.build_id ?? undefined,
    date: row.date,
    sessionStartedAt: row.session_started_at,
    recordedAt: row.recorded_at,
    areaId: row.area_id as AreaCountRecord["areaId"],
    discountTime: row.discount_time as AreaCountRecord["discountTime"],
    actualWeekday: row.actual_weekday ?? undefined,
    actualWeekdayGroup: row.actual_weekday_group as AreaCountRecord["actualWeekdayGroup"],
    count: row.count,
    demandCycle: normalizeDemandCycle(row.demand_cycle),
    userJudge: details.userJudge,
    humanEvaluationDetails: details.humanEvaluationDetails,
    suggestedEvaluation: details.suggestedEvaluation,
    areaRateAdjustment: details.areaRateAdjustment,
    evaluationSource: details.evaluationSource,
    decisionBasis: details.decisionBasis,
    comfortPoint: details.comfortPoint,
    calendarContext: details.calendarContext,
    analysisWeatherContext: details.analysisWeatherContext,
  } as Partial<AreaCountRecord>;
}

/**
 * `demand_cycle`のない旧rowはnormalとして読める。
 * 実際のremote queryはmigration済みschemaに対してcycle条件を必ず付ける。
 */
export function normalizeRemoteAreaCountRows(raw: unknown): AreaCountRecord[] {
  if (!Array.isArray(raw)) return [];
  return normalizeAreaCountRecords(
    raw
      .filter((row): row is RemoteAreaCountRow => Boolean(row) && typeof row === "object")
      .map(rowToRecord),
  );
}

export function buildRemoteAreaCountDetails(
  record: AreaCountRecord,
): RemoteAreaCountDetails {
  const details: RemoteAreaCountDetails = {};
  if (record.userJudge !== undefined) details.userJudge = record.userJudge;
  if (record.humanEvaluationDetails !== undefined) {
    details.humanEvaluationDetails = cloneJson(record.humanEvaluationDetails);
  } else if (record.userJudge !== undefined) {
    // 旧5段階記録は物理データを書き換えず、cloud payload上だけscale=5として明示する。
    details.humanEvaluationDetails = getLegacyHumanEvaluationDetails(record.userJudge);
  }
  if (record.suggestedEvaluation !== undefined) {
    details.suggestedEvaluation = record.suggestedEvaluation;
  }
  if (record.areaRateAdjustment !== undefined) {
    details.areaRateAdjustment = record.areaRateAdjustment;
  }
  if (record.evaluationSource !== undefined) {
    details.evaluationSource = record.evaluationSource;
  }
  if (record.decisionBasis !== undefined) {
    details.decisionBasis = cloneJson(record.decisionBasis);
  }
  if (record.comfortPoint !== undefined) details.comfortPoint = record.comfortPoint;
  if (record.calendarContext !== undefined) {
    details.calendarContext = cloneJson(record.calendarContext);
  }
  if (record.analysisWeatherContext !== undefined) {
    details.analysisWeatherContext = cloneJson(record.analysisWeatherContext);
  }
  return details;
}

export function buildRemoteAreaCountRow(record: AreaCountRecord): RemoteAreaCountRow {
  return {
    data_schema_version: record.dataSchemaVersion ?? null,
    app_version: record.appVersion ?? null,
    build_id: record.buildId ?? null,
    date: record.date,
    session_started_at: record.sessionStartedAt,
    recorded_at: record.recordedAt,
    area_id: record.areaId,
    discount_time: record.discountTime,
    actual_weekday: record.actualWeekday ?? null,
    actual_weekday_group: record.actualWeekdayGroup,
    count: record.count,
    demand_cycle: normalizeDemandCycle(record.demandCycle),
    record_details: buildRemoteAreaCountDetails(record),
  };
}

/** 新schemaへ送る単一payloadだけを返す。旧schema向けfallbackは意図的に持たない。 */
export function buildRemoteAreaCountWriteAttempts(
  record: AreaCountRecord,
): readonly [RemoteAreaCountRow] {
  return [buildRemoteAreaCountRow(record)];
}

function classifyHttpError(status: number): RemoteStorageErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (status === 400 || status === 404 || status === 409) return "schema";
  return "unknown";
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    return formatSupabaseHttpError(response.status, await response.text());
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function buildRemoteAreaCountReadPath(
  demandCycle?: DemandCycle,
  page?: { limit: number; offset: number },
): string {
  const cycleFilter = demandCycle
    ? `demand_cycle=eq.${encodeURIComponent(demandCycle)}`
    : "demand_cycle=in.(normal,summer)";
  const pagination = page
    ? `&limit=${Math.max(1, Math.floor(page.limit))}` +
      `&offset=${Math.max(0, Math.floor(page.offset))}`
    : "";
  return `/rest/v1/${TABLE_NAME}?select=*&${cycleFilter}&order=recorded_at.asc${pagination}`;
}

export async function loadRemoteAreaCountRecords(
  demandCycle?: DemandCycle,
  options?: RemoteAreaCountRequestOptions,
): Promise<RemoteAreaCountLoadResult> {
  const config = resolveSupabaseConfig(options);
  if (!config) return { status: "disabled" };
  const fetchImpl = resolveFetch(options);
  if (!fetchImpl) {
    return { status: "error", message: "Fetch is unavailable", errorKind: "network" };
  }

  try {
    let offset = 0;
    let records: AreaCountRecord[] = [];
    while (true) {
      const response = await fetchImpl(
        `${config.url}${buildRemoteAreaCountReadPath(demandCycle, {
          limit: AREA_COUNT_REMOTE_PAGE_SIZE,
          offset,
        })}`,
        {
          method: "GET",
          headers: buildHeaders(config),
          signal: options?.signal,
        },
      );

      if (!response.ok) {
        return {
          status: "error",
          message: await getErrorMessage(response),
          errorKind: classifyHttpError(response.status),
          httpStatus: response.status,
        };
      }

      const rawPage = await response.json() as unknown;
      if (!Array.isArray(rawPage)) {
        return {
          status: "error",
          message: "Invalid area_count_records response",
          errorKind: "schema",
        };
      }
      const pageRecords = normalizeRemoteAreaCountRows(rawPage).filter(
        (record) =>
          demandCycle === undefined ||
          normalizeDemandCycle(record.demandCycle) === demandCycle,
      );
      records = mergeAreaCountRecordCollections(records, pageRecords);
      if (rawPage.length < AREA_COUNT_REMOTE_PAGE_SIZE) break;
      offset += AREA_COUNT_REMOTE_PAGE_SIZE;
    }

    return { status: "ready", records };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "unknown error",
      errorKind: "network",
    };
  }
}

export async function upsertRemoteAreaCountRecords(
  records: readonly AreaCountRecord[],
  options?: RemoteAreaCountRequestOptions,
): Promise<RemoteAreaCountSaveResult> {
  const config = resolveSupabaseConfig(options);
  if (!config) return { status: "disabled" };
  const fetchImpl = resolveFetch(options);
  if (!fetchImpl) {
    return { status: "error", message: "Fetch is unavailable", errorKind: "network" };
  }

  const normalized = normalizeAreaCountRecords(records);
  if (normalized.length === 0) return { status: "saved", savedCount: 0 };

  try {
    const conflictColumns = AREA_COUNT_REMOTE_CONFLICT_COLUMNS.join(",");
    const response = await fetchImpl(
      `${config.url}/rest/v1/${TABLE_NAME}?on_conflict=${conflictColumns}`,
      {
        method: "POST",
        headers: {
          ...buildHeaders(config),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(normalized.map(buildRemoteAreaCountRow)),
        signal: options?.signal,
      },
    );

    if (!response.ok) {
      return {
        status: "error",
        message: await getErrorMessage(response),
        errorKind: classifyHttpError(response.status),
        httpStatus: response.status,
      };
    }

    return { status: "saved", savedCount: normalized.length };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "unknown error",
      errorKind: "network",
    };
  }
}

export async function upsertRemoteAreaCountRecord(
  record: AreaCountRecord,
  options?: RemoteAreaCountRequestOptions,
): Promise<RemoteAreaCountSaveResult> {
  return upsertRemoteAreaCountRecords([record], options);
}
