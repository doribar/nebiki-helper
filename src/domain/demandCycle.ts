import type { DemandCycle } from "./types.ts";
import { formatJstCalendarDate } from "./jstCalendar.ts";

export const DEFAULT_DEMAND_CYCLE: DemandCycle = "normal";

export function isDemandCycle(value: unknown): value is DemandCycle {
  return value === "normal" || value === "summer";
}

/** 需要サイクル項目がない旧データは、明示的に通常サイクルへ寄せる。 */
export function normalizeDemandCycle(value: unknown): DemandCycle {
  return isDemandCycle(value) ? value : DEFAULT_DEMAND_CYCLE;
}

export function getDemandCycleDisplayName(cycle: DemandCycle): string {
  return cycle === "summer" ? "夏季モード" : "通常";
}

export function getDemandCycleShortName(cycle: DemandCycle): string {
  return cycle === "summer" ? "ON" : "OFF";
}

export function getDemandCycleBasisLabel(cycle: DemandCycle): string {
  return `${getDemandCycleDisplayName(cycle)}基準`;
}

/**
 * 夏季モードを利用できる営業日かを判定する。
 * 呼び出し側でJSTへ解決済みの営業日（YYYY-MM-DD）だけを受け付け、
 * 実在する7月1日〜9月30日に限定する。
 */
export function isSummerModeAvailable(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return false;
  }

  return month >= 7 && month <= 9;
}

const JST_HOUR_MINUTE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 夏季モードの残数判断補助を表示する条件だけを共通化する。 */
export function shouldShowSummerModeJudgeHint(params: {
  demandCycle: DemandCycle;
  businessDate: string;
  nowMs: number;
}): boolean {
  if (
    params.demandCycle !== "summer" ||
    !isSummerModeAvailable(params.businessDate) ||
    !Number.isFinite(params.nowMs)
  ) {
    return false;
  }

  const now = new Date(params.nowMs);
  if (formatJstCalendarDate(now) !== params.businessDate) return false;

  const parts = JST_HOUR_MINUTE_FORMATTER.formatToParts(now);
  const rawHour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(rawHour) || !Number.isInteger(minute)) return false;

  const hour = rawHour % 24;
  return hour * 60 + minute < 18 * 60;
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
