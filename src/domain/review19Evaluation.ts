import {
  buildAreaCountDecisionBasis,
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  type AreaCountDecisionBasis,
  type AreaCountRecord,
} from "./areaCountHistory.ts";
import {
  normalizeAnalysisCalendarContext,
  type AnalysisCalendarContext,
} from "./analysisMetadata.ts";
import { normalizeDemandCycle } from "./demandCycle.ts";
import { supportsObonCalendarRule } from "./obon.ts";
import type {
  AreaId,
  DemandCycle,
  Review19Result,
} from "./types.ts";

const REVIEW19_DISCOUNT_TIME = "19" as const;

function isWeekday(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
  );
}

function getWeekdayFromCalendarDate(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed.getUTCDay();
}

function resolveReview19RecordWeekday(record: Review19Result): number | null {
  const candidates: unknown[] = [
    record.reference?.weekday,
    record.daySnapshot?.review19Check?.reference?.weekday,
    record.snapshot?.reviewReference?.weekday,
    record.snapshot?.session?.weekday,
  ];

  for (const candidate of candidates) {
    if (isWeekday(candidate)) return candidate;
  }

  return getWeekdayFromCalendarDate(record.date);
}

function resolveAreaCountRecordedAt(
  record: Review19Result,
  areaId: AreaId,
): string | null {
  const candidates: unknown[] = [
    record.areaCountRecordedAt?.[areaId],
    record.recordedAt,
    record.reviewCompletedAt,
    record.sessionStartedAt,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

function resolveReview19RecordCalendarContext(
  record: Review19Result,
): AnalysisCalendarContext | undefined {
  const candidates = [
    record.calendarContext,
    record.daySnapshot?.calendarContext,
    record.daySnapshot?.review19Check?.calendarContext,
    record.reference?.calendarContext,
    record.snapshot?.calendarContext,
    record.snapshot?.reviewReference?.calendarContext,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeAnalysisCalendarContext(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}

function buildHistoricalReview19AreaCountRecords(params: {
  areaId: AreaId;
  date: string;
  demandCycle: DemandCycle;
  historicalRecords: readonly Review19Result[];
}): AreaCountRecord[] {
  return params.historicalRecords.flatMap((record): AreaCountRecord[] => {
    if (record.review19Status !== "recorded") return [];
    if (record.date >= params.date) return [];
    if (normalizeDemandCycle(record.demandCycle) !== params.demandCycle) {
      return [];
    }
    if (record.excludedAreaIds.includes(params.areaId)) return [];

    const count = record.areaCounts[params.areaId];
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
      return [];
    }

    const weekday = resolveReview19RecordWeekday(record);
    const recordedAt = resolveAreaCountRecordedAt(record, params.areaId);
    if (weekday === null || recordedAt === null) return [];
    const calendarContext = resolveReview19RecordCalendarContext(record);
    const applyObonRule = calendarContext
      ? calendarContext.isObon === true ||
        calendarContext.calendarCondition === "obon"
      : supportsObonCalendarRule(record.appVersion);

    return [
      {
        dataSchemaVersion: record.dataSchemaVersion,
        appVersion: record.appVersion,
        buildId: record.buildId,
        demandCycle: params.demandCycle,
        date: record.date,
        sessionStartedAt: record.sessionStartedAt,
        recordedAt,
        areaId: params.areaId,
        discountTime: REVIEW19_DISCOUNT_TIME,
        actualWeekday: getActualWeekdayLabel(weekday),
        actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({
          weekday,
          discountTime: REVIEW19_DISCOUNT_TIME,
          date: record.date,
          applyObonRule,
        }),
        calendarContext,
        count: Math.max(0, Math.round(count)),
      },
    ];
  });
}

/**
 * 19:00チェックの実測残数を、過去の19:00チェックだけと比較する。
 *
 * 変換したAreaCountRecordは既存中央値エンジンへ渡すためだけの一時値で、
 * 通常の残数履歴、夏履歴、Supabaseへは保存しない。
 */
export function buildReview19HistoryStatistics(params: {
  areaId: AreaId;
  count: number;
  date: string;
  weekday: number;
  demandCycle: DemandCycle;
  historicalRecords: readonly Review19Result[];
  applyObonRule?: boolean;
}): {
  autoEvaluationBasis: AreaCountDecisionBasis;
} {
  const demandCycle = normalizeDemandCycle(params.demandCycle);
  const records = buildHistoricalReview19AreaCountRecords({
    areaId: params.areaId,
    date: params.date,
    demandCycle,
    historicalRecords: params.historicalRecords,
  });
  const recommendation = getAreaCountRecommendation({
    records,
    areaId: params.areaId,
    discountTime: REVIEW19_DISCOUNT_TIME,
    weekday: params.weekday,
    date: params.date,
    demandCycle,
    applyObonRule: params.applyObonRule,
    count: params.count,
  });

  return {
    // 既存の中央値計算を共用するが、5段階評価・閾値・値引補正は採用しない。
    autoEvaluationBasis: pickReview19HistoryStatistics(
      buildAreaCountDecisionBasis({ recommendation }),
    ),
  };
}

/** 互換用の既存basisには履歴統計だけを残す。Review19の正式評価は人間入力。 */
export function pickReview19HistoryStatistics(
  basis: AreaCountDecisionBasis,
): AreaCountDecisionBasis {
  return {
    ruleVersion: basis.ruleVersion,
    demandCycle: basis.demandCycle,
    recommendationStatus: basis.recommendationStatus,
    actualWeekday: basis.actualWeekday,
    actualWeekdayGroup: basis.actualWeekdayGroup,
    comparisonMode: basis.comparisonMode,
    threeDayHolidayMiddleReference: basis.threeDayHolidayMiddleReference,
    sampleSize: basis.sampleSize,
    requiredSampleSize: basis.requiredSampleSize,
    medianCount: basis.medianCount,
    shortMedianCount: basis.shortMedianCount,
    longMedianCount: basis.longMedianCount,
    shortSampleSize: basis.shortSampleSize,
    longSampleSize: basis.longSampleSize,
    medianDownGuardApplied: basis.medianDownGuardApplied,
  };
}
