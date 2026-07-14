import type { Review19DaySnapshot } from "./types.ts";

export type AutomaticDayExportPayload = {
  format: "nebiki-helper-day-export";
  version: 1;
  exportedAt: string;
  date: string;
  trigger: "final-counts-complete";
  daySnapshot: Review19DaySnapshot;
};

export function buildAutomaticDayExportPayload(params: {
  exportedAt: string;
  date: string;
  daySnapshot: Review19DaySnapshot;
}): AutomaticDayExportPayload {
  return {
    format: "nebiki-helper-day-export",
    version: 1,
    exportedAt: params.exportedAt,
    date: params.date,
    trigger: "final-counts-complete",
    daySnapshot: JSON.parse(JSON.stringify(params.daySnapshot)) as Review19DaySnapshot,
  };
}

export function getAutomaticDayExportFilename(date: string): string {
  return `nebiki-day-${date}.json`;
}
