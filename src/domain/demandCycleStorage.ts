import {
  normalizeAreaCountRecords,
  upsertAreaCountRecord,
  type AreaCountRecord,
} from "./areaCountHistory.ts";
import {
  DEFAULT_DEMAND_CYCLE,
  normalizeDemandCycle,
} from "./demandCycle.ts";
import type { DemandCycle } from "./types.ts";

export const DEMAND_CYCLE_STORAGE_KEYS = {
  state: "nebiki-helper/demand-cycle-state-v1",
  summerAreaCountRecords: "nebiki-helper/summer-area-count-records-v1",
} as const;

export type DemandCycleState = {
  selectedCycle: DemandCycle;
  lockedDate: string | null;
  lockedCycle: DemandCycle | null;
};

const DEFAULT_STATE: DemandCycleState = {
  selectedCycle: DEFAULT_DEMAND_CYCLE,
  lockedDate: null,
  lockedCycle: null,
};

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function normalizeDemandCycleState(raw: unknown): DemandCycleState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
  const source = raw as Partial<DemandCycleState>;
  const lockedDate =
    typeof source.lockedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.lockedDate)
      ? source.lockedDate
      : null;
  const lockedCycle =
    lockedDate && (source.lockedCycle === "normal" || source.lockedCycle === "summer")
      ? source.lockedCycle
      : null;

  return {
    selectedCycle: normalizeDemandCycle(source.selectedCycle),
    lockedDate: lockedCycle ? lockedDate : null,
    lockedCycle,
  };
}

export function loadDemandCycleState(): DemandCycleState {
  return normalizeDemandCycleState(
    parseJson(localStorage.getItem(DEMAND_CYCLE_STORAGE_KEYS.state)),
  );
}

export function saveDemandCycleState(state: DemandCycleState): void {
  localStorage.setItem(
    DEMAND_CYCLE_STORAGE_KEYS.state,
    JSON.stringify(normalizeDemandCycleState(state)),
  );
}

export function selectDemandCycleForDate(
  state: DemandCycleState,
  date: string,
): DemandCycle {
  return state.lockedDate === date && state.lockedCycle
    ? state.lockedCycle
    : state.selectedCycle;
}

export function selectDemandCycleLockForDate(
  state: DemandCycleState,
  date: string,
): DemandCycle | null {
  return state.lockedDate === date ? state.lockedCycle : null;
}

export function updateDemandCyclePreference(
  state: DemandCycleState,
  selectedCycle: DemandCycle,
): DemandCycleState {
  return normalizeDemandCycleState({ ...state, selectedCycle });
}

export function lockDemandCycleForDate(
  state: DemandCycleState,
  date: string,
  demandCycle: DemandCycle,
): DemandCycleState {
  void state;
  return {
    selectedCycle: demandCycle,
    lockedDate: date,
    lockedCycle: demandCycle,
  };
}

/**
 * Supabaseの既存表には需要サイクル列がないため、夏サイクル履歴だけを
 * 専用JSONへ保持する。通常履歴は従来どおりSupabaseを正本とする。
 */
export function loadSummerAreaCountRecords(): AreaCountRecord[] {
  const normalized = normalizeAreaCountRecords(
    parseJson(localStorage.getItem(DEMAND_CYCLE_STORAGE_KEYS.summerAreaCountRecords)),
  );
  return normalized.filter((record) => record.demandCycle === "summer");
}

export function saveSummerAreaCountRecords(records: AreaCountRecord[]): void {
  const summerRecords = normalizeAreaCountRecords(records).filter(
    (record) => record.demandCycle === "summer",
  );
  localStorage.setItem(
    DEMAND_CYCLE_STORAGE_KEYS.summerAreaCountRecords,
    JSON.stringify(summerRecords),
  );
}

export function upsertSummerAreaCountRecord(record: AreaCountRecord): AreaCountRecord[] {
  if (normalizeDemandCycle(record.demandCycle) !== "summer") {
    return loadSummerAreaCountRecords();
  }
  const next = upsertAreaCountRecord(loadSummerAreaCountRecords(), {
    ...record,
    demandCycle: "summer",
  });
  saveSummerAreaCountRecords(next);
  return next;
}
