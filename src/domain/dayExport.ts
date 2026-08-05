import { getNormalRoute } from "./area.ts";
import type {
  AreaCountDataQuality,
  DiscountTime,
  Review19DaySnapshot,
} from "./types.ts";
import { getCurrentDataVersionInfo } from "./dataVersion.ts";
import { normalizeReview19DaySnapshotDemandCycle } from "./finalizedDayData.ts";

const DAY_EXPORT_DISCOUNT_TIMES: DiscountTime[] = ["15", "17", "18", "19", "20"];

export type AutomaticDayExportDataQuality = {
  coverageByDiscountTime: Array<AreaCountDataQuality & { discountTime: DiscountTime }>;
  completeDiscountTimeCount: number;
  incompleteDiscountTimeCount: number;
  complete: boolean;
};

export type AutomaticDayExportPayload = {
  format: "nebiki-helper-day-export";
  version: 1;
  dataSchemaVersion: number;
  appVersion: string;
  buildId: string;
  exportedAt: string;
  date: string;
  trigger: "final-counts-complete";
  dataQuality: AutomaticDayExportDataQuality;
  daySnapshot: Review19DaySnapshot;
};

export function buildAutomaticDayExportDataQuality(params: {
  date: string;
  daySnapshot: Review19DaySnapshot;
}): AutomaticDayExportDataQuality {
  const expectedAreaIds = getNormalRoute(params.date);
  const expectedAreaIdSet = new Set(expectedAreaIds);
  const records = params.daySnapshot.areaCountRecords.filter((record) => {
    return record.date === params.date && expectedAreaIdSet.has(record.areaId);
  });

  const coverageByDiscountTime = DAY_EXPORT_DISCOUNT_TIMES.map((discountTime) => {
    const countsByArea = new Map<string, number>();
    for (const record of records) {
      if (record.discountTime !== discountTime) continue;
      countsByArea.set(record.areaId, (countsByArea.get(record.areaId) ?? 0) + 1);
    }

    const recordedAreaIds = expectedAreaIds.filter((areaId) => countsByArea.has(areaId));
    const missingAreaIds = expectedAreaIds.filter((areaId) => !countsByArea.has(areaId));
    const duplicateAreaIds = expectedAreaIds.filter((areaId) => {
      return (countsByArea.get(areaId) ?? 0) > 1;
    });
    const sessionSnapshot = params.daySnapshot.sessions
      .filter((session) => session.session.discountTime === discountTime)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .at(-1);
    const processComplete = Boolean(
      sessionSnapshot &&
      expectedAreaIds.every((areaId) => {
        const status = sessionSnapshot.areas[areaId]?.status;
        return status === "completed" || status === "auto_skipped_late_time";
      })
    );
    const notMeasuredAreaIds = expectedAreaIds.filter((areaId) => {
      const area = sessionSnapshot?.areas[areaId];
      return (
        area?.measurementStatus === "not_measured" ||
        !countsByArea.has(areaId)
      );
    });
    const missingReasons = notMeasuredAreaIds.reduce((acc, areaId) => {
      acc[areaId] =
        sessionSnapshot?.areas[areaId]?.missingReason ?? "legacy_unknown";
      return acc;
    }, {} as AreaCountDataQuality["missingReasons"]);
    const measurementComplete =
      missingAreaIds.length === 0 && duplicateAreaIds.length === 0;

    return {
      discountTime,
      expectedAreaCount: expectedAreaIds.length,
      recordedAreaCount: recordedAreaIds.length,
      excludedAreaCount: 0,
      missingAreaIds,
      duplicateAreaIds,
      complete: measurementComplete,
      processComplete,
      measurementComplete,
      notMeasuredAreaIds,
      missingReasons,
    };
  });
  const completeDiscountTimeCount = coverageByDiscountTime.filter((item) => item.complete).length;

  return {
    coverageByDiscountTime,
    completeDiscountTimeCount,
    incompleteDiscountTimeCount: coverageByDiscountTime.length - completeDiscountTimeCount,
    complete: completeDiscountTimeCount === coverageByDiscountTime.length,
  };
}

export function buildAutomaticDayExportPayload(params: {
  exportedAt: string;
  date: string;
  daySnapshot: Review19DaySnapshot;
}): AutomaticDayExportPayload {
  const daySnapshot = normalizeReview19DaySnapshotDemandCycle(
    params.daySnapshot,
  );
  return {
    format: "nebiki-helper-day-export",
    version: 1,
    ...getCurrentDataVersionInfo(),
    exportedAt: params.exportedAt,
    date: params.date,
    trigger: "final-counts-complete",
    dataQuality: buildAutomaticDayExportDataQuality({
      ...params,
      daySnapshot,
    }),
    daySnapshot,
  };
}

export function getAutomaticDayExportFilename(date: string): string {
  return `nebiki-day-${date}.json`;
}
