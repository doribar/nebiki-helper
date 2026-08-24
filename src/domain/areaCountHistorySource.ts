import {
  cloneAreaCountRecords,
  mergeAreaCountRecordCollections,
  type AreaCountRecord,
} from "./areaCountHistory.ts";
import type { RemoteAreaCountLoadResult } from "./areaCountRemoteStorage.ts";

export type AreaCountHistorySourceMode = "production" | "fixed_time_readonly";

export type AreaCountHistoryRemoteStatus =
  | "ready"
  | "disabled"
  | "error";

export type AreaCountHistorySourceResult = {
  records: AreaCountRecord[];
  remoteStatus: AreaCountHistoryRemoteStatus;
  /**
   * Full local/remote history is an in-memory calculation source only.
   * A separate authoritative-aware retention decision may persist a bounded
   * production cache; this merged population itself must never be persisted.
   */
  shouldPersistProductionCache: boolean;
};

function resolveRemoteStatus(
  results: readonly RemoteAreaCountLoadResult[],
): AreaCountHistoryRemoteStatus {
  if (results.some((result) => result.status === "error")) return "error";
  if (results.every((result) => result.status === "disabled")) return "disabled";
  return "ready";
}

/**
 * Separates the AreaCount history input from its persistence destination.
 *
 * - production: local-first cache plus Supabase rows, held in memory.
 * - fixed_time_readonly: Supabase rows only, held in React memory; never save.
 */
export function resolveAreaCountHistorySource(params: {
  mode: AreaCountHistorySourceMode;
  localRecords?: readonly AreaCountRecord[];
  remoteResults: readonly RemoteAreaCountLoadResult[];
}): AreaCountHistorySourceResult {
  const remoteRecords = params.remoteResults.flatMap((result) =>
    result.status === "ready" ? result.records : [],
  );
  const records = mergeAreaCountRecordCollections(
    params.mode === "production"
      ? cloneAreaCountRecords([...(params.localRecords ?? [])])
      : [],
    remoteRecords,
  );

  return {
    records,
    remoteStatus: resolveRemoteStatus(params.remoteResults),
    shouldPersistProductionCache: false,
  };
}
