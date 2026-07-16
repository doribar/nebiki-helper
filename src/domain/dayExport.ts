import { getNormalRoute } from "./area.ts";
import type {
  AreaCountDataQuality,
  DiscountTime,
  Review19DaySnapshot,
} from "./types.ts";

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

    return {
      discountTime,
      expectedAreaCount: expectedAreaIds.length,
      recordedAreaCount: recordedAreaIds.length,
      excludedAreaCount: 0,
      missingAreaIds,
      duplicateAreaIds,
      complete: missingAreaIds.length === 0 && duplicateAreaIds.length === 0,
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
  return {
    format: "nebiki-helper-day-export",
    version: 1,
    exportedAt: params.exportedAt,
    date: params.date,
    trigger: "final-counts-complete",
    dataQuality: buildAutomaticDayExportDataQuality(params),
    daySnapshot: JSON.parse(JSON.stringify(params.daySnapshot)) as Review19DaySnapshot,
  };
}

export function getAutomaticDayExportFilename(date: string): string {
  return `nebiki-day-${date}.json`;
}
