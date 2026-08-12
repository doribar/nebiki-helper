import { NORMAL_ROUTE, getAreaName, getNormalRoute } from "./area.ts";
import {
  normalizeAreaCountDecisionBasis,
  normalizeAreaCountRecords,
} from "./areaCountHistory.ts";
import {
  getCurrentDataVersionInfo,
  normalizeDataVersionInfo,
} from "./dataVersion.ts";
import {
  getEvaluationFromOddHumanScore,
  getLegacyHumanEvaluationDetails,
  normalizeHumanEvaluationDetails,
  resolveHumanEvaluationDetails,
} from "./humanEvaluation.ts";
import type {
  AreaCountEvaluation,
  AreaId,
  DailySessionSnapshot,
  DemandCycle,
  HumanEvaluationDetails,
  Review19AreaSnapshot,
  Review19AreaEvaluation,
  Review19DataQuality,
  Review19Rating,
  Review19RatingScore,
  Review19Reference,
  Review19Result,
  Review19Snapshot,
  Review19DayCheckSnapshot,
  Review19DaySnapshot,
} from "./types.ts";
import { normalizeDemandCycle } from "./demandCycle.ts";
import {
  buildAnalysisWeatherContext,
  buildDayAnalysisCalendarContext,
  buildProductionAnalysis,
  buildSessionAnalysisCalendarContext,
  buildSessionCalendarContextFromSnapshot,
  chooseBestAnalysisWeatherContext,
  mergeProductionAnalyses,
  normalizeAnalysisCalendarContext,
  normalizeProductionAnalysis,
} from "./analysisMetadata.ts";

export const REVIEW19_RATINGS: Array<{
  value: Review19Rating;
  label: string;
  score: Review19RatingScore;
}> = [
  { value: "decreased_too_much", label: "減りすぎ", score: -2 },
  { value: "decreased_slightly_too_much", label: "やや減りすぎ", score: -1 },
  { value: "just_right", label: "ちょうどいい", score: 0 },
  { value: "remained_slightly_too_much", label: "やや残りすぎ", score: 1 },
  { value: "remained_too_much", label: "残りすぎ", score: 2 },
];

export const REVIEW19_EXPORT_BATCH_SIZE = 10;
const REVIEW19_COUNT_INPUT_STARTED_DATE = "2026-06-27";

export const REVIEW19_EXCLUDE_REASON_TEXT: Record<string, string> = {
  few_at_15: "対象外：15時・17時ともに「少ない」判定",
  few_at_15_and_17: "対象外：15時・17時ともに「少ない」判定",
  manual: "スキップ：手動で対象外",
};

function normalizeExcludedAreaIds(raw: unknown): AreaId[] {
  if (!Array.isArray(raw)) return [];

  const unique = new Set<AreaId>();
  for (const value of raw) {
    if (NORMAL_ROUTE.includes(value as AreaId)) {
      unique.add(value as AreaId);
    }
  }

  return [...unique];
}

function createExcludeReasons(
  areaIds: AreaId[],
): Partial<Record<AreaId, "few_at_15_and_17">> {
  return areaIds.reduce(
    (acc, areaId) => {
      acc[areaId] = "few_at_15_and_17";
      return acc;
    },
    {} as Partial<Record<AreaId, "few_at_15_and_17">>,
  );
}

function normalizeExcludeReason(raw: unknown) {
  if (raw === "manual") {
    return "manual" as const;
  }

  if (raw === "few_at_15" || raw === "few_at_15_and_17") {
    return "few_at_15_and_17" as const;
  }

  return undefined;
}

export function getReview19RatingScore(
  rating: Review19Rating,
): Review19RatingScore {
  return REVIEW19_RATINGS.find((item) => item.value === rating)?.score ?? 0;
}

export function createReview19RatingScores(
  ratings: Record<AreaId, Review19Rating>,
): Record<AreaId, Review19RatingScore> {
  return NORMAL_ROUTE.reduce(
    (acc, areaId) => {
      acc[areaId] = getReview19RatingScore(ratings[areaId]);
      return acc;
    },
    {} as Record<AreaId, Review19RatingScore>,
  );
}

export function createDefaultReview19Ratings(): Record<AreaId, Review19Rating> {
  return NORMAL_ROUTE.reduce(
    (acc, areaId) => {
      acc[areaId] = "just_right";
      return acc;
    },
    {} as Record<AreaId, Review19Rating>,
  );
}

type Review19SourceTimestampFields = {
  sourceUpdatedAt?: unknown;
  recordedAt?: unknown;
  reviewCompletedAt?: unknown;
  areaCountRecordedAt?: unknown;
  reviewStartedAt?: unknown;
  sessionStartedAt?: unknown;
};

function isValidReview19Timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function getReview19AreaTimestampValues(raw: unknown): unknown[] {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? Object.values(raw as Record<string, unknown>)
    : [];
}

/**
 * Resolves old records without sourceUpdatedAt from their latest valid source
 * timestamp. sourceUpdatedAt is listed first so its representation wins ties.
 */
export function getReview19SourceUpdatedAt(
  record: Review19SourceTimestampFields,
): string | undefined {
  const candidates: unknown[] = [
    record.sourceUpdatedAt,
    record.recordedAt,
    record.reviewCompletedAt,
    ...getReview19AreaTimestampValues(record.areaCountRecordedAt),
    record.reviewStartedAt,
    record.sessionStartedAt,
  ];
  let latest: string | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    if (!isValidReview19Timestamp(candidate)) continue;
    const timestamp = Date.parse(candidate);
    if (timestamp > latestTime) {
      latest = candidate;
      latestTime = timestamp;
    }
  }

  return latest;
}

/**
 * Advances a Review19 mutation timestamp monotonically even when the runtime
 * clock has millisecond ties or moves backwards.
 */
export function advanceReview19SourceUpdatedAt(
  previous: Review19SourceTimestampFields,
  actionTimestamp: string,
): string {
  if (!isValidReview19Timestamp(actionTimestamp)) {
    throw new TypeError("Review19 action timestamp must be valid");
  }

  const previousTimestamp = getReview19SourceUpdatedAt(previous);
  const previousTime = previousTimestamp
    ? Date.parse(previousTimestamp)
    : Number.NEGATIVE_INFINITY;
  const actionTime = Date.parse(actionTimestamp);
  return new Date(Math.max(actionTime, previousTime + 1)).toISOString();
}

export function createInitialReview19Result(params: {
  date: string;
  sessionStartedAt: string;
  demandCycle?: DemandCycle;
  reviewStartedAt?: string;
  sourceUpdatedAt?: string;
  excludedAreaIds?: AreaId[];
}): Review19Result {
  const excludedAreaIds = normalizeExcludedAreaIds(params.excludedAreaIds ?? []);
  const sourceUpdatedAt = getReview19SourceUpdatedAt({
    sourceUpdatedAt: params.sourceUpdatedAt,
    reviewStartedAt: params.reviewStartedAt,
    sessionStartedAt: params.sessionStartedAt,
  });

  return {
    ...getCurrentDataVersionInfo(),
    review19Status: "recorded",
    date: params.date,
    demandCycle: normalizeDemandCycle(params.demandCycle),
    sessionStartedAt: params.sessionStartedAt,
    reviewStartedAt: params.reviewStartedAt,
    reviewCompletedAt: undefined,
    sourceUpdatedAt,
    areaCountRecordedAt: {},
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCounts: {},
    areaEvaluations: {},
    excludedAreaIds,
    excludeReasons: createExcludeReasons(excludedAreaIds),
    dataQuality: buildReview19DataQuality({
      date: params.date,
      areaCounts: {},
      areaEvaluations: {},
      excludedAreaIds,
      review19Status: "recorded",
    }),
  };
}

export function buildReview19DataQuality(params: {
  date: string;
  areaCounts: Partial<Record<AreaId, number>>;
  areaEvaluations: Partial<Record<AreaId, Review19AreaEvaluation>>;
  excludedAreaIds: AreaId[];
  review19Status?: "recorded" | "not_applicable";
}): Review19DataQuality {
  if (params.review19Status === "not_applicable") {
    return {
      expectedAreaCount: 0,
      recordedAreaCount: 0,
      excludedAreaCount: 0,
      missingAreaIds: [],
      duplicateAreaIds: [],
      complete: true,
      processComplete: true,
      measurementComplete: true,
      notMeasuredAreaIds: [],
      missingReasons: {},
      humanEvaluationExpectedAreaCount: 0,
      humanEvaluationRecordedAreaCount: 0,
      missingHumanEvaluationAreaIds: [],
      humanEvaluationComplete: true,
    };
  }

  const expectedAreaIds = getNormalRoute(params.date);
  const areaEvaluations = params.areaEvaluations;
  const excludedAreaIdSet = new Set(params.excludedAreaIds);
  const recordedAreaIds = expectedAreaIds.filter((areaId) => {
    return !excludedAreaIdSet.has(areaId) && typeof params.areaCounts[areaId] === "number";
  });
  const excludedAreaIds = expectedAreaIds.filter((areaId) => excludedAreaIdSet.has(areaId));
  const missingAreaIds = expectedAreaIds.filter((areaId) => {
    return !excludedAreaIdSet.has(areaId) && typeof params.areaCounts[areaId] !== "number";
  });
  const humanEvaluationExpectedAreaIds = expectedAreaIds.filter(
    (areaId) => !excludedAreaIdSet.has(areaId),
  );
  const humanEvaluationRecordedAreaIds = humanEvaluationExpectedAreaIds.filter(
    (areaId) => resolveReview19HumanEvaluationDetails(areaEvaluations[areaId]) !== undefined,
  );
  const missingHumanEvaluationAreaIds = humanEvaluationExpectedAreaIds.filter(
    (areaId) => resolveReview19HumanEvaluationDetails(areaEvaluations[areaId]) === undefined,
  );
  const measurementComplete = missingAreaIds.length === 0;
  const humanEvaluationComplete = missingHumanEvaluationAreaIds.length === 0;
  const processComplete = measurementComplete && humanEvaluationComplete;

  return {
    expectedAreaCount: expectedAreaIds.length,
    recordedAreaCount: recordedAreaIds.length,
    excludedAreaCount: excludedAreaIds.length,
    missingAreaIds,
    duplicateAreaIds: [],
    complete: processComplete,
    processComplete,
    measurementComplete,
    notMeasuredAreaIds: [...missingAreaIds],
    missingReasons: missingAreaIds.reduce((acc, areaId) => {
      acc[areaId] = "legacy_unknown";
      return acc;
    }, {} as Partial<Record<AreaId, "legacy_unknown">>),
    humanEvaluationExpectedAreaCount: humanEvaluationExpectedAreaIds.length,
    humanEvaluationRecordedAreaCount: humanEvaluationRecordedAreaIds.length,
    missingHumanEvaluationAreaIds,
    humanEvaluationComplete,
  };
}

export function getReview19AreaItems(): Array<{
  areaId: AreaId;
  areaName: string;
}> {
  return NORMAL_ROUTE.map((areaId) => ({
    areaId,
    areaName: getAreaName(areaId),
  }));
}

export function isValidReview19Rating(value: unknown): value is Review19Rating {
  return REVIEW19_RATINGS.some((rating) => rating.value === value);
}

function isAreaCountEvaluation(value: unknown): value is AreaCountEvaluation {
  return (
    value === "many" ||
    value === "slightly_many" ||
    value === "normal" ||
    value === "slightly_few" ||
    value === "few"
  );
}

function isReview19HumanEvaluationDetails(
  details: HumanEvaluationDetails,
  fallbackDemandCycle?: DemandCycle,
): boolean {
  if (details.humanEvaluationScale === 5) return true;

  return (
    details.resolutionReason === "review19_observation" &&
    details.resolutionDirection === "not_applicable" &&
    details.resolvedEvaluation === undefined &&
    details.sessionDiscountTime === "19" &&
    (fallbackDemandCycle === undefined ||
      details.demandCycle === normalizeDemandCycle(fallbackDemandCycle))
  );
}

function resolveReview19HumanEvaluationDetails(
  candidate?: Partial<Review19AreaEvaluation>,
  fallbackDemandCycle?: DemandCycle,
): HumanEvaluationDetails | undefined {
  if (!candidate) return undefined;

  if (candidate.humanEvaluationDetails !== undefined) {
    const details = normalizeHumanEvaluationDetails(
      candidate.humanEvaluationDetails,
    );
    return details &&
      isReview19HumanEvaluationDetails(details, fallbackDemandCycle)
      ? details
      : undefined;
  }

  const legacyEvaluation = isAreaCountEvaluation(candidate.humanEvaluation)
    ? candidate.humanEvaluation
    : undefined;
  return resolveHumanEvaluationDetails(undefined, legacyEvaluation);
}

function normalizeReview19AreaEvaluations(
  raw: unknown,
  fallbackDemandCycle?: DemandCycle,
): Partial<Record<AreaId, Review19AreaEvaluation>> {
  const normalized: Partial<Record<AreaId, Review19AreaEvaluation>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;

  for (const areaId of NORMAL_ROUTE) {
    const value = (raw as Partial<Record<AreaId, unknown>>)[areaId];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const candidate = value as Partial<Review19AreaEvaluation>;
    const resolvedHumanEvaluationDetails =
      resolveReview19HumanEvaluationDetails(candidate, fallbackDemandCycle);
    if (!resolvedHumanEvaluationDetails) continue;

    const hasCanonicalDetails =
      candidate.humanEvaluationDetails !== undefined;
    const humanEvaluation = hasCanonicalDetails
      ? getEvaluationFromOddHumanScore(
          resolvedHumanEvaluationDetails.humanEvaluationScore9,
        ) ?? undefined
      : isAreaCountEvaluation(candidate.humanEvaluation)
        ? candidate.humanEvaluation
        : undefined;
    const humanEvaluationFields: Pick<
      Review19AreaEvaluation,
      "humanEvaluation" | "humanEvaluationDetails"
    > = {
      ...(humanEvaluation ? { humanEvaluation } : {}),
      ...(hasCanonicalDetails
        ? { humanEvaluationDetails: resolvedHumanEvaluationDetails }
        : {}),
    };

    const autoEvaluationBasis = normalizeAreaCountDecisionBasis(
      candidate.autoEvaluationBasis,
      fallbackDemandCycle,
    );
    const hasMatchingDemandCycle = Boolean(
      autoEvaluationBasis &&
      autoEvaluationBasis.demandCycle !==
        undefined &&
      autoEvaluationBasis.demandCycle ===
        normalizeDemandCycle(fallbackDemandCycle),
    );

    if (
      candidate.autoEvaluationStatus === "ready" &&
      isAreaCountEvaluation(candidate.autoEvaluation) &&
      autoEvaluationBasis?.recommendationStatus === "ready" &&
      hasMatchingDemandCycle
    ) {
      normalized[areaId] = {
        ...humanEvaluationFields,
        autoEvaluation: candidate.autoEvaluation,
        autoEvaluationStatus: "ready",
        autoEvaluationBasis,
      };
      continue;
    }

    const normalizedEvaluation: Review19AreaEvaluation = {
      ...humanEvaluationFields,
      autoEvaluation: null,
      autoEvaluationStatus: "insufficient",
    };
    if (
      candidate.autoEvaluationStatus === "insufficient" &&
      candidate.autoEvaluation === null &&
      autoEvaluationBasis?.recommendationStatus === "insufficient" &&
      hasMatchingDemandCycle
    ) {
      normalizedEvaluation.autoEvaluationBasis = autoEvaluationBasis;
    }
    normalized[areaId] = normalizedEvaluation;
  }

  return normalized;
}

export function parseReview19RatePercent(text?: string): number | undefined {
  if (!text) return undefined;
  if (text === "引かない") return 0;

  const match = text.match(/(-?\d+)\s*%/);
  if (!match) return undefined;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeReview19AreaSnapshot(
  area: Review19AreaSnapshot,
  fallbackDemandCycle?: DemandCycle,
): Review19AreaSnapshot {
  const demandCycle = normalizeDemandCycle(
    fallbackDemandCycle ??
      area.rateDecisionSnapshot?.demandCycle ??
      area.areaCountDecisionBasis?.demandCycle,
  );
  const rateDecisionSnapshot = area.rateDecisionSnapshot
    ? {
        ...area.rateDecisionSnapshot,
        demandCycle,
      }
    : undefined;
  const areaCountDecisionBasis = area.areaCountDecisionBasis
    ? {
        ...area.areaCountDecisionBasis,
        demandCycle,
      }
    : undefined;
  return {
    ...area,
    reviewExcluded: area.reviewExcluded === true,
    reviewExcludeReason: normalizeExcludeReason(area.reviewExcludeReason),
    ratePercent: area.ratePercent ?? parseReview19RatePercent(area.rateText),
    manyRatePercent:
      area.manyRatePercent ?? parseReview19RatePercent(area.manyRateText),
    normalRatePercent:
      area.normalRatePercent ?? parseReview19RatePercent(area.normalRateText),
    areaCountDecisionBasis,
    rateDecisionSnapshot,
  };
}

function normalizeReview19Snapshot(
  raw?: Partial<Review19Snapshot> | null,
  fallbackDemandCycle?: DemandCycle,
): Review19Snapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const cloned = JSON.parse(JSON.stringify(raw)) as Review19Snapshot;
  const demandCycle = normalizeDemandCycle(
    raw.demandCycle ?? raw.session?.demandCycle ?? fallbackDemandCycle,
  );
  cloned.demandCycle = demandCycle;
  if (cloned.session && typeof cloned.session === "object") {
    cloned.session.demandCycle = demandCycle;
  }
  cloned.reviewReference = cloneReview19Reference(
    cloned.reviewReference,
    demandCycle,
  );
  cloned.analysisWeatherContext = chooseBestAnalysisWeatherContext([
    cloned.analysisWeatherContext,
    buildAnalysisWeatherContext(
      cloned.session?.weather,
      cloned.session?.discountTime,
    ),
  ]);
  if (!cloned.areas || typeof cloned.areas !== "object") {
    cloned.calendarContext = normalizeAnalysisCalendarContext(
      cloned.calendarContext,
    );
    return cloned;
  }

  for (const areaId of Object.keys(cloned.areas) as AreaId[]) {
    cloned.areas[areaId] = normalizeReview19AreaSnapshot(
      cloned.areas[areaId],
      demandCycle,
    );
  }
  cloned.calendarContext =
    normalizeAnalysisCalendarContext(cloned.calendarContext) ??
    (cloned.session
      ? buildSessionAnalysisCalendarContext({
          date: cloned.session.date,
          weekday: cloned.session.weekday,
          discountTime: cloned.session.discountTime,
          sessionStartedAt: cloned.session.startedAt,
          manualWeekdayOverride: cloned.session.manualWeekdayOverride,
          areaDecisionBases: Object.values(cloned.areas).map((area) => ({
            areaId: area.areaId,
            basis: area.areaCountDecisionBasis,
          })),
        })
      : undefined);

  return cloned;
}

function normalizeLegacyReview19Ratings(
  raw: unknown,
): Record<AreaId, Review19Rating> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const ratings = createDefaultReview19Ratings();
  let hasValidRating = false;

  for (const areaId of NORMAL_ROUTE) {
    const rating = (raw as Partial<Record<AreaId, unknown>>)[areaId];
    if (!isValidReview19Rating(rating)) continue;
    ratings[areaId] = rating;
    hasValidRating = true;
  }

  return hasValidRating ? ratings : null;
}

function normalizeReview19RatingData(params: {
  date: string;
  ratingStatus: unknown;
  ratings: unknown;
  hasAreaCountsField: boolean;
}): Pick<Review19Result, "ratingStatus" | "ratings" | "ratingScores"> {
  const legacyRatings = normalizeLegacyReview19Ratings(params.ratings);
  const explicitlyRecorded = params.ratingStatus === "recorded";
  const explicitlyNotCollected = params.ratingStatus === "not_collected";
  const predatesCountInput = params.date < REVIEW19_COUNT_INPUT_STARTED_DATE;
  const preserveLegacyRatings =
    !explicitlyNotCollected &&
    legacyRatings !== null &&
    (explicitlyRecorded || !params.hasAreaCountsField || predatesCountInput);

  if (!preserveLegacyRatings) {
    return {
      ratingStatus: "not_collected",
      ratings: null,
      ratingScores: null,
    };
  }

  return {
    ratingStatus: "recorded",
    ratings: legacyRatings,
    ratingScores: createReview19RatingScores(legacyRatings),
  };
}

function normalizeReview19DayCheckSnapshot(
  raw: Partial<Review19DayCheckSnapshot> | null | undefined,
  date: string,
  fallbackDemandCycle?: DemandCycle,
): Review19DayCheckSnapshot | undefined {
  if (!raw || typeof raw !== "object" || raw.version !== 1) return undefined;
  if (typeof raw.recordedAt !== "string" || typeof raw.sessionStartedAt !== "string") {
    return undefined;
  }

  const ratingData = normalizeReview19RatingData({
    date,
    ratingStatus: raw.ratingStatus,
    ratings: raw.ratings,
    hasAreaCountsField: Object.prototype.hasOwnProperty.call(raw, "areaCounts"),
  });

  const areaCounts = normalizeReview19AreaCounts(raw.areaCounts);
  const excludedAreaIds = normalizeExcludedAreaIds(raw.excludedAreaIds);
  for (const areaId of excludedAreaIds) {
    delete areaCounts[areaId];
  }
  const areaCountRecordedAt = normalizeAreaCountRecordedAt(
    raw.areaCountRecordedAt,
    date,
    excludedAreaIds,
  );
  const review19Status =
    raw.review19Status === "not_applicable" ? "not_applicable" : "recorded";
  const dataVersion = normalizeDataVersionInfo(raw);
  const demandCycle = normalizeDemandCycle(
    raw.demandCycle ??
      raw.snapshot?.demandCycle ??
      raw.reference?.demandCycle ??
      fallbackDemandCycle,
  );
  const areaEvaluations = normalizeReview19AreaEvaluations(
    raw.areaEvaluations,
    demandCycle,
  );
  for (const areaId of excludedAreaIds) {
    delete areaEvaluations[areaId];
  }
  const reference = cloneReview19Reference(raw.reference, demandCycle);
  const snapshot = normalizeReview19Snapshot(raw.snapshot, demandCycle);
  const calendarContext =
    normalizeAnalysisCalendarContext(raw.calendarContext) ??
    normalizeAnalysisCalendarContext(reference?.calendarContext) ??
    normalizeAnalysisCalendarContext(snapshot?.calendarContext);
  const analysisWeatherContext = chooseBestAnalysisWeatherContext([
    raw.analysisWeatherContext,
    reference?.analysisWeatherContext,
    snapshot?.analysisWeatherContext,
  ]);
  const productionAnalysis = normalizeProductionAnalysis(
    raw.productionAnalysis,
    getNormalRoute(date),
  );

  return JSON.parse(JSON.stringify({
    ...raw,
    ...dataVersion,
    demandCycle,
    calendarContext,
    analysisWeatherContext,
    productionAnalysis,
    review19Status,
    ...ratingData,
    reviewStartedAt:
      typeof raw.reviewStartedAt === "string" ? raw.reviewStartedAt : undefined,
    reviewCompletedAt:
      typeof raw.reviewCompletedAt === "string" ? raw.reviewCompletedAt : raw.recordedAt,
    sourceUpdatedAt: getReview19SourceUpdatedAt(raw),
    areaCountRecordedAt,
    areaCounts,
    areaEvaluations,
    excludedAreaIds,
    excludeReasons:
      raw.excludeReasons && typeof raw.excludeReasons === "object"
        ? raw.excludeReasons
        : {},
    dataQuality: buildReview19DataQuality({
      date,
      areaCounts,
      areaEvaluations,
      excludedAreaIds,
      review19Status,
    }),
    reference,
    snapshot,
  })) as Review19DayCheckSnapshot;
}

function normalizeDailySessionSnapshotDemandCycle(
  raw: DailySessionSnapshot,
  fallbackDemandCycle?: DemandCycle,
): DailySessionSnapshot {
  const cloned = JSON.parse(JSON.stringify(raw)) as DailySessionSnapshot;
  const demandCycle = normalizeDemandCycle(
    cloned.demandCycle ?? cloned.session?.demandCycle ?? fallbackDemandCycle,
  );
  cloned.demandCycle = demandCycle;
  if (cloned.session && typeof cloned.session === "object") {
    cloned.session.demandCycle = demandCycle;
  }
  if (cloned.areas && typeof cloned.areas === "object") {
    for (const areaId of Object.keys(cloned.areas) as AreaId[]) {
      cloned.areas[areaId] = normalizeReview19AreaSnapshot(
        cloned.areas[areaId],
        demandCycle,
      );
    }
  }
  cloned.calendarContext =
    normalizeAnalysisCalendarContext(cloned.calendarContext) ??
    buildSessionCalendarContextFromSnapshot(cloned);
  cloned.analysisWeatherContext = chooseBestAnalysisWeatherContext([
    cloned.analysisWeatherContext,
    buildAnalysisWeatherContext(
      cloned.session?.weather,
      cloned.session?.discountTime,
    ),
  ]);
  return cloned;
}


function normalizeReview19DaySnapshot(
  raw?: Partial<Review19DaySnapshot> | null,
  fallbackDemandCycle?: DemandCycle,
): Review19DaySnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  if (raw.version !== 1) return undefined;
  if (typeof raw.capturedAt !== "string" || typeof raw.date !== "string") return undefined;

  const rawSessions = Array.isArray(raw.sessions) ? raw.sessions : [];
  const firstSession = rawSessions[0] as DailySessionSnapshot | undefined;
  const demandCycle = normalizeDemandCycle(
    raw.demandCycle ??
      raw.review19Check?.demandCycle ??
      firstSession?.demandCycle ??
      firstSession?.session?.demandCycle ??
      fallbackDemandCycle,
  );
  const sessions = rawSessions
    .filter((session) => {
        const screen = (session as { screen?: unknown })?.screen;
        return screen !== "review19_weather" && screen !== "review19" && screen !== "review19_done";
      })
    .map((session) =>
      normalizeDailySessionSnapshotDemandCycle(
        session as DailySessionSnapshot,
        demandCycle,
      ),
    );
  const review19Check = normalizeReview19DayCheckSnapshot(
    raw.review19Check,
    raw.date,
    demandCycle,
  );
  const review19Status =
    raw.review19Status === "recorded" ||
    raw.review19Status === "not_performed" ||
    raw.review19Status === "not_applicable"
      ? raw.review19Status
      : review19Check?.review19Status ?? "not_performed";
  const areaCountRecords = normalizeAreaCountRecords(
    raw.areaCountRecords,
    demandCycle,
  );
  const calendarContext = buildDayAnalysisCalendarContext({
    date: raw.date,
    sessionContexts: [
      normalizeAnalysisCalendarContext(raw.calendarContext),
      ...sessions.map((session) => session.calendarContext),
      review19Check?.reference?.calendarContext,
      review19Check?.snapshot?.calendarContext,
    ],
    areaRecordContexts: areaCountRecords.map(
      (record) => record.calendarContext,
    ),
  });
  const analysisWeatherContext = chooseBestAnalysisWeatherContext([
    raw.analysisWeatherContext,
    review19Check?.analysisWeatherContext,
    ...sessions
      .slice()
      .reverse()
      .map((session) => session.analysisWeatherContext),
  ]);
  const rebuiltProductionAnalysis = buildProductionAnalysis({
    date: raw.date,
    demandCycle,
    areaIds: getNormalRoute(raw.date),
    areaCountRecords,
    sessions,
    review19Check,
  });
  const productionAnalysis = mergeProductionAnalyses({
    persisted: raw.productionAnalysis,
    rebuilt: rebuiltProductionAnalysis,
    areaIds: getNormalRoute(raw.date),
  });
  if (review19Check) {
    review19Check.productionAnalysis = productionAnalysis;
  }

  return JSON.parse(JSON.stringify({
    ...raw,
    ...normalizeDataVersionInfo(raw),
    demandCycle,
    calendarContext,
    analysisWeatherContext,
    productionAnalysis,
    sessions,
    review19Status,
    review19Check,
    areaCountRecords,
  })) as Review19DaySnapshot;
}

function cloneReview19Reference(
  raw?: Partial<Review19Reference> | null,
  fallbackDemandCycle?: DemandCycle,
): Review19Reference | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  if (raw.discountTime !== "19") return undefined;
  if (typeof raw.date !== "string" || typeof raw.weekday !== "number")
    return undefined;
  if (!raw.weather || typeof raw.weather !== "object") return undefined;
  if (!raw.resolvedWeather || typeof raw.resolvedWeather !== "object")
    return undefined;
  if (!raw.basis || typeof raw.basis !== "object") return undefined;

  return {
    ...JSON.parse(JSON.stringify(raw)),
    demandCycle: normalizeDemandCycle(raw.demandCycle ?? fallbackDemandCycle),
    calendarContext: normalizeAnalysisCalendarContext(raw.calendarContext),
    analysisWeatherContext: chooseBestAnalysisWeatherContext([
      raw.analysisWeatherContext,
      buildAnalysisWeatherContext(raw.weather, "19"),
    ]),
  } as Review19Reference;
}


function normalizeReview19AreaCounts(
  raw: unknown,
): Partial<Record<AreaId, number>> {
  const result: Partial<Record<AreaId, number>> = {};
  if (!raw || typeof raw !== "object") return result;

  for (const areaId of NORMAL_ROUTE) {
    const value = (raw as Partial<Record<AreaId, unknown>>)[areaId];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const rounded = Math.max(0, Math.round(value));
    result[areaId] = rounded;
  }

  return result;
}

function normalizeAreaCountRecordedAt(
  raw: unknown,
  date: string,
  excludedAreaIds: AreaId[],
): Partial<Record<AreaId, string>> {
  const result: Partial<Record<AreaId, string>> = {};
  if (!raw || typeof raw !== "object") return result;
  const excludedAreaIdSet = new Set(excludedAreaIds);

  for (const areaId of getNormalRoute(date)) {
    if (excludedAreaIdSet.has(areaId)) continue;
    const value = (raw as Partial<Record<AreaId, unknown>>)[areaId];
    if (typeof value === "string") result[areaId] = value;
  }

  return result;
}

export function normalizeReview19Result(
  raw?: Partial<Review19Result> | null,
): Review19Result | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.date !== "string" || typeof raw.sessionStartedAt !== "string")
    return null;

  const rawExcludedAreaIds = normalizeExcludedAreaIds(
    (raw as Partial<Review19Result>).excludedAreaIds,
  );
  const legacyReview19Status =
    raw.review19Status === "not_applicable" ? "not_applicable" : "recorded";
  const demandCycle = normalizeDemandCycle(
    raw.demandCycle ??
      raw.daySnapshot?.demandCycle ??
      raw.snapshot?.demandCycle ??
      raw.reference?.demandCycle,
  );
  const base = createInitialReview19Result({
    date: raw.date,
    sessionStartedAt: raw.sessionStartedAt,
    demandCycle,
    excludedAreaIds: rawExcludedAreaIds,
  });

  const ratingData = normalizeReview19RatingData({
    date: raw.date,
    ratingStatus: raw.ratingStatus,
    ratings: raw.ratings,
    hasAreaCountsField: Object.prototype.hasOwnProperty.call(raw, "areaCounts"),
  });

  const sourceExcludeReasons =
    raw.excludeReasons && typeof raw.excludeReasons === "object" ? raw.excludeReasons : {};
  const excludeReasons = { ...base.excludeReasons };
  for (const areaId of base.excludedAreaIds) {
    const reason = normalizeExcludeReason(
      (sourceExcludeReasons as Partial<Record<AreaId, unknown>>)[areaId],
    );
    if (reason) {
      excludeReasons[areaId] = reason;
    }
  }

  const areaCounts = normalizeReview19AreaCounts(
    (raw as Partial<Review19Result>).areaCounts,
  );
  for (const areaId of base.excludedAreaIds) {
    delete areaCounts[areaId];
  }
  const areaCountRecordedAt = normalizeAreaCountRecordedAt(
    raw.areaCountRecordedAt,
    raw.date,
    base.excludedAreaIds,
  );
  const areaEvaluations = normalizeReview19AreaEvaluations(
    raw.areaEvaluations,
    demandCycle,
  );
  for (const areaId of base.excludedAreaIds) {
    delete areaEvaluations[areaId];
  }
  const recordedAt = typeof raw.recordedAt === "string" ? raw.recordedAt : undefined;
  const reference = cloneReview19Reference(raw.reference, demandCycle);
  const snapshot = normalizeReview19Snapshot(raw.snapshot, demandCycle);
  const daySnapshot = normalizeReview19DaySnapshot(
    raw.daySnapshot,
    demandCycle,
  );
  const calendarContext = buildDayAnalysisCalendarContext({
    date: raw.date,
    sessionContexts: [
      daySnapshot?.calendarContext,
      normalizeAnalysisCalendarContext(raw.calendarContext),
      reference?.calendarContext,
      snapshot?.calendarContext,
    ],
  });
  const analysisWeatherContext = chooseBestAnalysisWeatherContext([
    reference?.analysisWeatherContext,
    raw.analysisWeatherContext,
    daySnapshot?.analysisWeatherContext,
    snapshot?.analysisWeatherContext,
  ]);
  const productionAnalysis = mergeProductionAnalyses({
    persisted: raw.productionAnalysis,
    rebuilt: daySnapshot?.productionAnalysis,
    areaIds: getNormalRoute(raw.date),
  });

  return {
    ...base,
    ...normalizeDataVersionInfo(raw),
    ...ratingData,
    review19Status: legacyReview19Status,
    demandCycle,
    calendarContext,
    analysisWeatherContext,
    productionAnalysis,
    reviewStartedAt:
      typeof raw.reviewStartedAt === "string" ? raw.reviewStartedAt : undefined,
    reviewCompletedAt:
      typeof raw.reviewCompletedAt === "string" ? raw.reviewCompletedAt : recordedAt,
    sourceUpdatedAt: getReview19SourceUpdatedAt(raw),
    areaCountRecordedAt,
    areaCounts,
    areaEvaluations,
    excludedAreaIds: base.excludedAreaIds,
    excludeReasons,
    dataQuality: buildReview19DataQuality({
      date: raw.date,
      areaCounts,
      areaEvaluations,
      excludedAreaIds: base.excludedAreaIds,
      review19Status: legacyReview19Status,
    }),
    recordedAt,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : undefined,
    reference,
    snapshot,
    daySnapshot,
  };
}

export function cloneReview19Result(
  record: Review19Result | null,
): Review19Result | null {
  const normalized = normalizeReview19Result(record);
  return normalized
    ? (JSON.parse(JSON.stringify(normalized)) as Review19Result)
    : null;
}

export function cloneReview19Records(
  records: Review19Result[],
): Review19Result[] {
  return records
    .map((record) => cloneReview19Result(record))
    .filter((record): record is Review19Result => record !== null);
}

function materializeLegacyReview19AreaEvaluationsForExport(
  areaEvaluations: Partial<Record<AreaId, Review19AreaEvaluation>> | undefined,
): void {
  if (!areaEvaluations) return;
  for (const areaId of NORMAL_ROUTE) {
    const evaluation = areaEvaluations[areaId];
    if (
      !evaluation ||
      evaluation.humanEvaluationDetails ||
      !isAreaCountEvaluation(evaluation.humanEvaluation)
    ) {
      continue;
    }
    evaluation.humanEvaluationDetails = getLegacyHumanEvaluationDetails(
      evaluation.humanEvaluation,
    );
  }
}

function materializeLegacyManualAreaSnapshotsForExport(
  areas: Record<AreaId, Review19AreaSnapshot> | undefined,
): void {
  if (!areas) return;
  for (const areaId of NORMAL_ROUTE) {
    const area = areas[areaId];
    if (
      !area ||
      area.humanEvaluationDetails ||
      area.areaCountEvaluationSource !== "manual" ||
      !isAreaCountEvaluation(area.areaCountEvaluation)
    ) {
      continue;
    }
    area.humanEvaluationDetails = getLegacyHumanEvaluationDetails(
      area.areaCountEvaluation,
    );
  }
}

/**
 * 旧5段階の人間評価を、保存済みデータ自体は書き換えず、出力時だけ奇数scoreへ展開する。
 */
export function materializeReview19DaySnapshotHumanEvaluationsForExport<
  T extends Review19DaySnapshot,
>(snapshot: T): T {
  const cloned = JSON.parse(JSON.stringify(snapshot)) as T;
  for (const session of cloned.sessions) {
    materializeLegacyManualAreaSnapshotsForExport(session.areas);
  }
  for (const record of cloned.areaCountRecords) {
    if (
      !record.humanEvaluationDetails &&
      isAreaCountEvaluation(record.userJudge)
    ) {
      record.humanEvaluationDetails = getLegacyHumanEvaluationDetails(
        record.userJudge,
      );
    }
  }
  materializeLegacyReview19AreaEvaluationsForExport(
    cloned.review19Check?.areaEvaluations,
  );
  materializeLegacyManualAreaSnapshotsForExport(
    cloned.review19Check?.snapshot?.areas,
  );
  return cloned;
}

export function materializeReview19ResultHumanEvaluationsForExport(
  record: Review19Result,
): Review19Result {
  const cloned = JSON.parse(JSON.stringify(record)) as Review19Result;
  materializeLegacyReview19AreaEvaluationsForExport(cloned.areaEvaluations);
  materializeLegacyManualAreaSnapshotsForExport(cloned.snapshot?.areas);
  if (cloned.daySnapshot) {
    cloned.daySnapshot =
      materializeReview19DaySnapshotHumanEvaluationsForExport(
        cloned.daySnapshot,
      );
  }
  return cloned;
}

export function appendReview19RecordInMemory(params: {
  currentRecords: Review19Result[];
  recordToAdd: Review19Result;
}): Review19Result[] {
  const normalizedRecord = normalizeReview19Result(params.recordToAdd);
  if (!normalizedRecord?.recordedAt) {
    return cloneReview19Records(params.currentRecords);
  }

  const current = cloneReview19Records(params.currentRecords);
  const index = current.findIndex(
    (record) =>
      record.date === normalizedRecord.date &&
      record.sessionStartedAt === normalizedRecord.sessionStartedAt,
  );

  if (index >= 0) {
    current[index] = normalizedRecord;
    return current;
  }

  return [...current, normalizedRecord];
}

function getReview19RecordKey(record: Review19Result): string {
  return `${record.date}::${record.sessionStartedAt}`;
}

export function getUnexportedReview19Records(
  records: Review19Result[],
): Review19Result[] {
  return cloneReview19Records(records)
    .filter((record) =>
      record.review19Status === "recorded" &&
      Boolean(record.recordedAt) &&
      !record.exportedAt
    )
    .sort((a, b) => {
      const recordedCompare = (a.recordedAt ?? "").localeCompare(
        b.recordedAt ?? "",
      );
      if (recordedCompare !== 0) return recordedCompare;
      return getReview19RecordKey(a).localeCompare(getReview19RecordKey(b));
    });
}

export function getReview19ExportBatch(
  records: Review19Result[],
  limit = REVIEW19_EXPORT_BATCH_SIZE,
): Review19Result[] {
  return getUnexportedReview19Records(records).slice(0, limit);
}

export function buildReview19ExportPayload(params: {
  records: Review19Result[];
  exportedAt: string;
}) {
  const records = cloneReview19Records(params.records)
    .map(materializeReview19ResultHumanEvaluationsForExport)
    .filter((record) => record.review19Status === "recorded");
  const incompleteRecords = records
    .filter((record) => !record.dataQuality.complete)
    .map((record) => ({
      date: record.date,
      sessionStartedAt: record.sessionStartedAt,
      missingAreaIds: [...record.dataQuality.missingAreaIds],
      missingHumanEvaluationAreaIds: [
        ...record.dataQuality.missingHumanEvaluationAreaIds,
      ],
    }));
  return {
    format: "nebiki-helper-review19-export",
    version: 1,
    ...getCurrentDataVersionInfo(),
    exportedAt: params.exportedAt,
    count: records.length,
    dataQuality: {
      recordedCount: records.length,
      completeRecordCount: records.length - incompleteRecords.length,
      incompleteRecordCount: incompleteRecords.length,
      incompleteRecords,
    },
    records,
  };
}

export function markReview19RecordsExportedInMemory(params: {
  currentRecords: Review19Result[];
  recordsToMark: Review19Result[];
  exportedAt: string;
}): Review19Result[] {
  const targetKeys = new Set(params.recordsToMark.map(getReview19RecordKey));

  return cloneReview19Records(params.currentRecords).map((record) => {
    if (!targetKeys.has(getReview19RecordKey(record))) return record;
    return {
      ...record,
      exportedAt: params.exportedAt,
    };
  });
}
