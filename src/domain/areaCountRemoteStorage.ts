import type { AreaCountRecord } from "./areaCountHistory.ts";
import { cloneAreaCountRecords, normalizeAreaCountRecords, upsertAreaCountRecord } from "./areaCountHistory.ts";

type SupabaseConfig = {
  url: string;
  anonKey: string;
};

type AreaCountRecordRow = {
  date: string;
  session_started_at: string;
  recorded_at: string;
  area_id: string;
  discount_time: string;
  weekday_base?: string | null;
  actual_weekday?: string | null;
  actual_weekday_group: string;
  count: number;
  user_judge?: string | null;
  suggested_evaluation?: string | null;
  area_rate_adjustment?: number | null;
  comfort_point?: number | null;
};

export type RemoteAreaCountLoadResult =
  | { status: "disabled" }
  | { status: "ready"; records: AreaCountRecord[] }
  | { status: "error"; message: string };

export type RemoteAreaCountSaveResult =
  | { status: "disabled" }
  | { status: "saved" }
  | { status: "error"; message: string };

const TABLE_NAME = "area_count_records";

function getSupabaseConfig(): SupabaseConfig | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const rawUrl = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!rawUrl || !anonKey) return null;

  return {
    url: rawUrl.replace(/\/+$/, ""),
    anonKey,
  };
}

function buildHeaders(config: SupabaseConfig): HeadersInit {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    "Content-Type": "application/json",
  };
}

function rowToRecord(row: AreaCountRecordRow): Partial<AreaCountRecord> {
  return {
    date: row.date,
    sessionStartedAt: row.session_started_at,
    recordedAt: row.recorded_at,
    areaId: row.area_id as AreaCountRecord["areaId"],
    discountTime: row.discount_time as AreaCountRecord["discountTime"],
    weekdayBase: row.weekday_base ?? undefined,
    actualWeekday: row.actual_weekday ?? undefined,
    actualWeekdayGroup: row.actual_weekday_group as AreaCountRecord["actualWeekdayGroup"],
    count: row.count,
    userJudge: row.user_judge ?? undefined,
    suggestedEvaluation: row.suggested_evaluation ?? undefined,
    areaRateAdjustment: row.area_rate_adjustment ?? undefined,
    comfortPoint: row.comfort_point ?? undefined,
  } as Partial<AreaCountRecord>;
}

function recordToRow(record: AreaCountRecord): AreaCountRecordRow {
  return {
    date: record.date,
    session_started_at: record.sessionStartedAt,
    recorded_at: record.recordedAt,
    area_id: record.areaId,
    discount_time: record.discountTime,
    weekday_base: record.weekdayBase ?? null,
    actual_weekday: record.actualWeekday ?? null,
    actual_weekday_group: record.actualWeekdayGroup,
    count: record.count,
    user_judge: record.userJudge ?? null,
    suggested_evaluation: record.suggestedEvaluation ?? null,
    area_rate_adjustment: record.areaRateAdjustment ?? null,
    comfort_point: record.comfortPoint ?? null,
  };
}

export function mergeAreaCountRecords(
  baseRecords: AreaCountRecord[],
  recordsToMerge: AreaCountRecord[],
): AreaCountRecord[] {
  return recordsToMerge.reduce(
    (merged, record) => upsertAreaCountRecord(merged, record),
    cloneAreaCountRecords(baseRecords),
  );
}

export async function loadRemoteAreaCountRecords(): Promise<RemoteAreaCountLoadResult> {
  const config = getSupabaseConfig();
  if (!config) return { status: "disabled" };

  try {
    const response = await fetch(
      `${config.url}/rest/v1/${TABLE_NAME}?select=*&order=recorded_at.asc`,
      {
        method: "GET",
        headers: buildHeaders(config),
      },
    );

    if (!response.ok) {
      return { status: "error", message: `HTTP ${response.status}` };
    }

    const rows = (await response.json()) as AreaCountRecordRow[];
    const records = normalizeAreaCountRecords(rows.map(rowToRecord));

    return { status: "ready", records };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "unknown error",
    };
  }
}

export async function upsertRemoteAreaCountRecord(
  record: AreaCountRecord,
): Promise<RemoteAreaCountSaveResult> {
  const config = getSupabaseConfig();
  if (!config) return { status: "disabled" };

  try {
    const response = await fetch(
      `${config.url}/rest/v1/${TABLE_NAME}?on_conflict=date,session_started_at,area_id,discount_time`,
      {
        method: "POST",
        headers: {
          ...buildHeaders(config),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([recordToRow(record)]),
      },
    );

    if (!response.ok) {
      return { status: "error", message: `HTTP ${response.status}` };
    }

    return { status: "saved" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "unknown error",
    };
  }
}
