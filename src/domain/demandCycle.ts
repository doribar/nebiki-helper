import type { DemandCycle } from "./types.ts";

export const DEFAULT_DEMAND_CYCLE: DemandCycle = "normal";

export function isDemandCycle(value: unknown): value is DemandCycle {
  return value === "normal" || value === "summer";
}

/** 需要サイクル項目がない旧データは、明示的に通常サイクルへ寄せる。 */
export function normalizeDemandCycle(value: unknown): DemandCycle {
  return isDemandCycle(value) ? value : DEFAULT_DEMAND_CYCLE;
}

export function getDemandCycleDisplayName(cycle: DemandCycle): string {
  return cycle === "summer" ? "夏サイクル" : "通常サイクル";
}

export function getDemandCycleShortName(cycle: DemandCycle): string {
  return cycle === "summer" ? "夏" : "通常";
}

export function getDemandCycleBasisLabel(cycle: DemandCycle): string {
  return `${getDemandCycleDisplayName(cycle)}基準`;
}

export function getCalendarYear(date: string): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) ? year : null;
}

export type DemandCycleEvidence = {
  date: string;
  demandCycle?: unknown;
};

/**
 * 並び順を優先順位として、その営業日にすでに存在する運用データの
 * 需要サイクルを解決する。旧データの欠落値は通常サイクルである。
 */
export function resolveDemandCycleFromEvidence(
  date: string,
  evidence: DemandCycleEvidence[],
): DemandCycle | null {
  const matched = evidence.find((item) => item.date === date);
  return matched ? normalizeDemandCycle(matched.demandCycle) : null;
}
