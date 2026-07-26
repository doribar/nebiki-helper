import type {
  AppState,
  AreaId,
  AreaProgress,
  DailySessionSnapshot,
  DoneSummaryItem,
  Review19DayCheckSnapshot,
  Review19Reference,
  Review19Result,
  Review19Snapshot,
  SessionData,
  SessionDraft,
  WeatherInput,
} from "../../domain/types";
import type {
  AreaCountDecisionBasis,
  AreaCountRecord,
} from "../../domain/areaCountHistory.ts";
import { DONE_SUMMARY_ROUTE, getAreaName } from "../../domain/area";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../../domain/weekdayBase";
import { getFinalTimeGuide, getFinalTimeInstructionSteps } from "../../domain/discount";
import { loadReview19Records } from "../../domain/storage";
import { cloneHourlyForecasts, resolveWeatherInputForDiscount } from "../../domain/hourlyWeather.ts";
import { parseReview19RatePercent } from "../../domain/review19.ts";
import {
  cloneAreaCountRecords,
  evaluationText as getAreaCountEvaluationText,
} from "../../domain/areaCountHistory.ts";
import { getCurrentDataVersionInfo } from "../../domain/dataVersion.ts";
import { getAreaJudgeText } from "./ratePresentation.ts";

function buildAreaSnapshotsFromState(params: {
  areaProgressMap: Record<AreaId, AreaProgress>;
  doneSummaryItems: DoneSummaryItem[];
  excludedAreaIds?: AreaId[];
}): Record<AreaId, Review19Snapshot["areas"][AreaId]> {
  const doneSummaryByArea = params.doneSummaryItems.reduce((acc, item) => {
    acc[item.areaId] = item;
    return acc;
  }, {} as Record<AreaId, DoneSummaryItem>);
  const excludedAreaIdSet = new Set(params.excludedAreaIds ?? []);

  return DONE_SUMMARY_ROUTE.reduce((acc, areaId) => {
    const progress = params.areaProgressMap[areaId];
    const summary = doneSummaryByArea[areaId];
    const rateDecisionSnapshot = progress?.rateDecisionSnapshot
      ? JSON.parse(JSON.stringify(progress.rateDecisionSnapshot))
      : undefined;
    const rateText =
      rateDecisionSnapshot?.displayedRateText ?? summary?.rateText ?? "未完了";
    const manyRateText = rateDecisionSnapshot
      ? `${rateDecisionSnapshot.displayedManyRatePercent}%`
      : summary?.manyRateText;
    const normalRateText = rateDecisionSnapshot?.displayedRateText ?? summary?.normalRateText;

    acc[areaId] = {
      ...getCurrentDataVersionInfo(),
      areaId,
      areaName: getAreaName(areaId),
      reviewExcluded: excludedAreaIdSet.has(areaId),
      reviewExcludeReason: excludedAreaIdSet.has(areaId) ? "few_at_15_and_17" : undefined,
      status: progress?.status ?? "unstarted",
      statusText: summary?.statusText,
      areaJudge: progress?.areaJudge ?? null,
      areaCount: progress?.areaCount,
      areaCountEvaluation: progress?.areaCountEvaluation,
      areaCountEvaluationSource: progress?.areaCountEvaluationSource,
      areaCountDecisionBasis: progress?.areaCountDecisionBasis
        ? JSON.parse(JSON.stringify(progress.areaCountDecisionBasis)) as AreaCountDecisionBasis
        : undefined,
      areaRateAdjustment: progress?.areaRateAdjustment,
      judgeText: summary?.judgeText ?? getAreaJudgeText(progress?.areaJudge ?? null),
      rateText,
      ratePercent:
        rateDecisionSnapshot?.displayedRatePercent ??
        parseReview19RatePercent(rateText),
      manyRateText,
      manyRatePercent:
        rateDecisionSnapshot?.displayedManyRatePercent ??
        parseReview19RatePercent(manyRateText),
      normalRateText,
      normalRatePercent:
        rateDecisionSnapshot?.displayedNormalRatePercent ??
        parseReview19RatePercent(normalRateText),
      visitedAt: progress?.visitedAt,
      completedAt: progress?.completedAt,
      skipReason: progress?.skipReason,
      rateDecisionSnapshot,
      rateDecisionSnapshotStatus: rateDecisionSnapshot
        ? "captured"
        : "legacy_not_captured",
      measurementStatus:
        typeof progress?.areaCount === "number"
          ? "measured"
          : progress?.measurementStatus,
      missingReason: progress?.missingReason,
      earlyDiscountResolution: progress?.earlyDiscountResolution,
      autoSkipKind: progress?.autoSkipKind,
      sourceDiscountTime: progress?.sourceDiscountTime,
      sourceSessionStartedAt: progress?.sourceSessionStartedAt,
      earlyDiscountCompletedAt: progress?.earlyDiscountCompletedAt,
      skipAcknowledgedAt: progress?.skipAcknowledgedAt,
      measurementRecordedAt: progress?.measurementRecordedAt,
      rateOrigin: progress?.rateOrigin,
    };

    return acc;
  }, {} as Review19Snapshot["areas"]);
}

export function createDailySessionSnapshot(params: {
  capturedAt: string;
  state: AppState;
  resolvedWeather: ReturnType<typeof resolveWeatherInputForDiscount>;
  weekdayBaseInfo: ReturnType<typeof getWeekdayBaseInfo>;
  basisGuide: ReturnType<typeof getBasisGuideDisplay>;
  lateTimeBonus: number;
  doneSummaryItems: DoneSummaryItem[];
  sessionEndReason?: DailySessionSnapshot["sessionEndReason"];
}): DailySessionSnapshot | null {
  const session = params.state.session;
  if (!session) return null;

  return {
    version: 1,
    ...getCurrentDataVersionInfo(),
    capturedAt: params.capturedAt,
    basisCapturedAt: params.capturedAt,
    sessionEndReason:
      params.sessionEndReason ??
      (params.state.screen === "done" ? "completed" : undefined),
    rateLogicVersion: "time_basic_rate_v1",
    screen: params.state.screen,
    session: {
      dataSchemaVersion: session.dataSchemaVersion,
      appVersion: session.appVersion,
      buildId: session.buildId,
      date: session.date,
      weekday: session.weekday,
      discountTime: session.discountTime,
      startedAt: session.startedAt,
      manualWeekdayOverride: session.manualWeekdayOverride,
      manualDiscountTimeOverride: session.manualDiscountTimeOverride,
      weather: JSON.parse(JSON.stringify(session.weather)),
      resolvedWeather: JSON.parse(JSON.stringify(params.resolvedWeather)),
    },
    basis: {
      rateLogicVersion: "time_basic_rate_v1",
      baseRateBonus: params.weekdayBaseInfo.baseRateBonus,
      lateTimeBonus: params.lateTimeBonus,
      totalRateBonus: params.weekdayBaseInfo.baseRateBonus + params.lateTimeBonus,
      baseRateBonusReason: [...params.weekdayBaseInfo.baseRateBonusReason],
      noticeText: params.basisGuide.noticeText,
      weekdaySummaryText: params.basisGuide.weekdaySummaryText,
      weekdayCalcText: params.basisGuide.weekdayCalcText,
      weekdayResultText: params.basisGuide.weekdayResultText,
      bonusSummaryText: params.basisGuide.bonusSummaryText,
      bonusCalcText: params.basisGuide.bonusCalcText,
      bonusResultText: params.basisGuide.bonusResultText,
    },
    areas: buildAreaSnapshotsFromState({
      areaProgressMap: params.state.areaProgressMap,
      doneSummaryItems: params.doneSummaryItems,
      excludedAreaIds: params.state.review19ExcludedAreaIds,
    }),
    doneSummaryItems: JSON.parse(JSON.stringify(params.doneSummaryItems)) as DoneSummaryItem[],
    currentAreaId: params.state.currentAreaId,
    review19ExcludedAreaIds: [...params.state.review19ExcludedAreaIds],
  };
}

function getFinalGuideSummaryText(guide: ReturnType<typeof getFinalTimeGuide>): string {
  return getFinalTimeInstructionSteps(guide)
    .map((step) => `${step.subject}${step.rate}`)
    .join("・");
}

export function buildFinalSessionDoneSummaryItems(params: {
  session: SessionData;
  areaProgressMap: Record<AreaId, AreaProgress>;
  comfortScore: number;
}): DoneSummaryItem[] {
  return DONE_SUMMARY_ROUTE.map((areaId) => {
    const progress = params.areaProgressMap[areaId];
    const guide = getFinalTimeGuide({
      weekday: params.session.weekday,
      weather21: params.session.weather.hourlyForecasts["21"].weather,
      temp21C: params.session.weather.hourlyForecasts["21"].tempC,
      comfortScore: params.comfortScore,
      areaCountEvaluation: progress?.areaCountEvaluation,
    });
    const rateText = getFinalGuideSummaryText(guide);

    return {
      areaId,
      areaName: getAreaName(areaId),
      judgeText: progress?.areaCountEvaluation
        ? getAreaCountEvaluationText(progress.areaCountEvaluation)
        : "履歴不足（残数補正なし）",
      rateText,
      normalRateText: rateText,
      statusText: typeof progress?.areaCount === "number" ? undefined : "残数未入力",
    };
  });
}

export function getLatestReview19DayCheck(date: string): Review19DayCheckSnapshot | undefined {
  const latest = loadReview19Records()
    .filter((record) => record.date === date && Boolean(record.recordedAt))
    .sort((a, b) => (a.recordedAt ?? "").localeCompare(b.recordedAt ?? ""))
    .at(-1);

  if (!latest?.recordedAt) return undefined;
  if (latest.daySnapshot?.review19Check) {
    return JSON.parse(JSON.stringify(latest.daySnapshot.review19Check)) as Review19DayCheckSnapshot;
  }

  return {
    version: 1,
    dataSchemaVersion: latest.dataSchemaVersion,
    appVersion: latest.appVersion,
    buildId: latest.buildId,
    review19Status: latest.review19Status,
    recordedAt: latest.recordedAt,
    sessionStartedAt: latest.sessionStartedAt,
    reviewStartedAt: latest.reviewStartedAt,
    reviewCompletedAt: latest.reviewCompletedAt ?? latest.recordedAt,
    areaCountRecordedAt: JSON.parse(JSON.stringify(latest.areaCountRecordedAt)) as Review19DayCheckSnapshot["areaCountRecordedAt"],
    ratingStatus: latest.ratingStatus,
    ratings: latest.ratings
      ? JSON.parse(JSON.stringify(latest.ratings)) as Review19DayCheckSnapshot["ratings"]
      : null,
    ratingScores: latest.ratingScores
      ? JSON.parse(JSON.stringify(latest.ratingScores)) as Review19DayCheckSnapshot["ratingScores"]
      : null,
    areaCounts: JSON.parse(JSON.stringify(latest.areaCounts)) as Review19DayCheckSnapshot["areaCounts"],
    excludedAreaIds: [...latest.excludedAreaIds],
    excludeReasons: JSON.parse(JSON.stringify(latest.excludeReasons)) as Review19DayCheckSnapshot["excludeReasons"],
    dataQuality: JSON.parse(JSON.stringify(latest.dataQuality)) as Review19DayCheckSnapshot["dataQuality"],
    snapshot: latest.snapshot
      ? JSON.parse(JSON.stringify(latest.snapshot)) as Review19Snapshot
      : undefined,
  };
}

export function createReview19DaySnapshot(params: {
  capturedAt: string;
  date: string;
  areaCountRecords: AreaCountRecord[];
  sessions: DailySessionSnapshot[];
  review19Check?: NonNullable<NonNullable<Review19Result["daySnapshot"]>["review19Check"]>;
}): NonNullable<Review19Result["daySnapshot"]> {
  return {
    version: 1,
    ...getCurrentDataVersionInfo(),
    capturedAt: params.capturedAt,
    date: params.date,
    rateLogicVersion: "time_basic_rate_v1",
    review19Status: params.review19Check?.review19Status ?? "not_performed",
    sessions: params.sessions
      .filter((session) =>
        session.session.date === params.date &&
        (session.screen === "done" || session.sessionEndReason === "auto_time_transition")
      )
      .map((session) => JSON.parse(JSON.stringify(session)) as DailySessionSnapshot),
    review19Check: params.review19Check
      ? JSON.parse(JSON.stringify(params.review19Check)) as NonNullable<NonNullable<Review19Result["daySnapshot"]>["review19Check"]>
      : undefined,
    areaCountRecords: cloneAreaCountRecords(
      params.areaCountRecords.filter((record) => record.date === params.date),
    ),
  };
}

export function createReview19Snapshot(params: {
  capturedAt: string;
  session: SessionData;
  resolvedWeather: ReturnType<typeof resolveWeatherInputForDiscount>;
  weekdayBaseInfo: ReturnType<typeof getWeekdayBaseInfo>;
  basisGuide: ReturnType<typeof getBasisGuideDisplay>;
  lateTimeBonus: number;
  reviewReference?: Review19Reference;
  excludedAreaIds: AreaId[];
  areaProgressMap: Record<AreaId, AreaProgress>;
  doneSummaryItems: DoneSummaryItem[];
}): Review19Snapshot {
  const areas = buildAreaSnapshotsFromState({
    areaProgressMap: params.areaProgressMap,
    doneSummaryItems: params.doneSummaryItems,
    excludedAreaIds: params.excludedAreaIds,
  });

  return {
    version: 1,
    ...getCurrentDataVersionInfo(),
    capturedAt: params.capturedAt,
    session: {
      dataSchemaVersion: params.session.dataSchemaVersion,
      appVersion: params.session.appVersion,
      buildId: params.session.buildId,
      date: params.session.date,
      weekday: params.session.weekday,
      discountTime: params.session.discountTime,
      startedAt: params.session.startedAt,
      manualWeekdayOverride: params.session.manualWeekdayOverride,
      manualDiscountTimeOverride: params.session.manualDiscountTimeOverride,
      weather: JSON.parse(JSON.stringify(params.session.weather)),
      resolvedWeather: JSON.parse(JSON.stringify(params.resolvedWeather)),
    },
    basis: {
      rateLogicVersion: "time_basic_rate_v1",
      baseRateBonus: params.weekdayBaseInfo.baseRateBonus,
      lateTimeBonus: params.lateTimeBonus,
      totalRateBonus: params.weekdayBaseInfo.baseRateBonus + params.lateTimeBonus,
      baseRateBonusReason: [...params.weekdayBaseInfo.baseRateBonusReason],
      noticeText: params.basisGuide.noticeText,
      weekdaySummaryText: params.basisGuide.weekdaySummaryText,
      weekdayCalcText: params.basisGuide.weekdayCalcText,
      weekdayResultText: params.basisGuide.weekdayResultText,
      bonusSummaryText: params.basisGuide.bonusSummaryText,
      bonusCalcText: params.basisGuide.bonusCalcText,
      bonusResultText: params.basisGuide.bonusResultText,
    },
    areas,
    reviewReference: params.reviewReference
      ? JSON.parse(JSON.stringify(params.reviewReference)) as Review19Reference
      : undefined,
  };
}


export function createReview19Reference(draft: SessionDraft): Review19Reference {
  const reviewDraft: SessionDraft = {
    ...draft,
    discountTime: "19",
    manualDiscountTimeOverride: false,
    weather: {
      ...draft.weather,
      hourlyForecasts: cloneHourlyForecasts(draft.weather.hourlyForecasts),
    },
  };
  const resolvedWeather = resolveWeatherInputForDiscount(reviewDraft.weather, "19");
  const weekdayBaseInfo = getWeekdayBaseInfo(
    reviewDraft.weekday,
    "19",
    resolvedWeather,
    reviewDraft.date
  );
  const basisGuide = getBasisGuideDisplay({
    date: reviewDraft.date,
    weekday: reviewDraft.weekday,
    discountTime: "19",
    weather: resolvedWeather,
  });

  return {
    date: reviewDraft.date,
    weekday: reviewDraft.weekday,
    discountTime: "19",
    weather: JSON.parse(JSON.stringify(reviewDraft.weather)) as WeatherInput,
    resolvedWeather: JSON.parse(JSON.stringify(resolvedWeather)),
    basis: {
      rateLogicVersion: "time_basic_rate_v1",
      baseRateBonus: weekdayBaseInfo.baseRateBonus,
      baseRateBonusReason: [...weekdayBaseInfo.baseRateBonusReason],
      noticeText: basisGuide.noticeText,
      weekdaySummaryText: basisGuide.weekdaySummaryText,
      weekdayCalcText: basisGuide.weekdayCalcText,
      weekdayResultText: basisGuide.weekdayResultText,
      bonusSummaryText: basisGuide.bonusSummaryText,
      bonusCalcText: basisGuide.bonusCalcText,
      bonusResultText: basisGuide.bonusResultText,
    },
  };
}

export function createReview19WeatherDraft(session: SessionData): SessionDraft {
  return {
    date: session.date,
    weekday: session.weekday,
    discountTime: "19",
    manualWeekdayOverride: session.manualWeekdayOverride,
    manualDiscountTimeOverride: false,
    weather: {
      ...session.weather,
      hourlyForecasts: cloneHourlyForecasts(session.weather.hourlyForecasts),
    },
  };
}
