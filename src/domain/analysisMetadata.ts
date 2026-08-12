import type {
  AreaCountComparisonMode,
  AreaCountDecisionBasis,
  AreaCountRecord,
} from "./areaCountHistory.ts";
import { normalizeDemandCycle } from "./demandCycle.ts";
import { getWeatherInputForecastHours } from "./hourlyWeather.ts";
import { normalizeHumanEvaluationDetails } from "./humanEvaluation.ts";
import {
  getIndividualAmountReferenceContext,
  type IndividualAmountReferenceContext,
} from "./weekdayBase.ts";
import {
  isDayBeforeJapaneseHoliday,
  isHolidayBeforeNormalWeekday,
  isJapaneseHolidayOrObserved,
  isThreeDayHolidayMiddle,
} from "./japaneseHoliday.ts";
import type {
  ActualWeekdayGroup,
  ActualWeekdayLabel,
  AreaCountEvaluation,
  AreaCountEvaluationSource,
  AreaId,
  DailySessionSnapshot,
  DemandCycle,
  DiscountTime,
  ForecastHourKey,
  HumanEvaluationScale,
  HumanEvaluationScore9,
  Review19DayCheckSnapshot,
  Review19AreaEvaluation,
  Review19AreaSnapshot,
  WeekdayBaseLabel,
} from "./types.ts";

export type CalendarIndividualAmountReference =
  IndividualAmountReferenceContext & {
    sessionStartedAt: string | null;
  };

export type CalendarAreaCountReferenceReason =
  | "same_weekday_history"
  | "fallback_weekday_group_history"
  | "three_day_holiday_middle_history"
  | "holiday_before_normal_weekday_history"
  | "insufficient_history"
  | "disabled"
  | "metadata_not_captured";

export type CalendarAreaCountReference = {
  sessionStartedAt: string;
  discountTime: DiscountTime;
  areaId: AreaId;
  recommendationStatus: "ready" | "insufficient" | "disabled" | null;
  type:
    | "weekday"
    | "weekday_group"
    | "composite_weekday_groups"
    | "unavailable";
  referenceWeekday: ActualWeekdayLabel | null;
  referenceWeekdayGroup: ActualWeekdayGroup | null;
  referenceWeekdayGroups: ActualWeekdayGroup[];
  comparisonMode: AreaCountComparisonMode | null;
  reason: CalendarAreaCountReferenceReason;
};

/**
 * A session contains one individual-amount reference and zero or more
 * independently selected area-count references. A day combines those entries
 * without collapsing differences between 15:00/17:00/19:00 or between areas.
 */
export type AnalysisCalendarContext = {
  version: 1;
  scope: "session" | "day" | "area_count";
  date: string;
  actualWeekday: ActualWeekdayLabel;
  isHoliday: boolean;
  isDayBeforeHoliday: boolean;
  calendarCondition:
    | "ordinary"
    | "day_before_holiday"
    | "holiday"
    | "holiday_before_normal_weekday"
    | "three_day_holiday_middle";
  manualWeekdayOverride: boolean;
  individualAmountReference: CalendarIndividualAmountReference[];
  areaCountReference: CalendarAreaCountReference[];
};

export type AnalysisWeatherClassification =
  | "dry"
  | "rain"
  | "snow"
  | "mixed"
  | "unknown";

export type AnalysisWeatherContext = {
  version: 1;
  weatherDataSource: "entered_hourly_forecast";
  analysisWeatherClass: AnalysisWeatherClassification;
  hasPrecipitation: boolean;
  precipitationTypes: Array<"rain" | "snow">;
  expectedHours: ForecastHourKey[];
  consideredHours: ForecastHourKey[];
  dryHours: ForecastHourKey[];
  rainHours: ForecastHourKey[];
  snowHours: ForecastHourKey[];
};

export type ProductionShortageSuspicionLevel =
  | "strong"
  | "medium"
  | "weak"
  | "none"
  | "insufficient";

export type ProductionShortageCheckpointStatus =
  | "recorded"
  | "missing"
  | "excluded"
  | "not_measured"
  | "session_missing";

export type ProductionShortageCheckpointSource =
  | AreaCountEvaluationSource
  | "human_review19";

export type ProductionShortageCheckpoint = {
  discountTime: "15" | "17" | "19";
  status: ProductionShortageCheckpointStatus;
  /** 15/17: the five-level area evaluation actually adopted for discounting. */
  evaluation?: AreaCountEvaluation;
  /** Keeps automatic/history adoption distinct from a manual override. */
  source?: ProductionShortageCheckpointSource;
  /** Human raw observation only; history adoption never fabricates this value. */
  rawScore9?: HumanEvaluationScore9;
  sourceScale?: HumanEvaluationScale;
};

export type ProductionAreaAnalysis = {
  version: 1;
  areaId: AreaId;
  productionShortageSuspicion: ProductionShortageSuspicionLevel;
  validCheckpointCount: number;
  lowSideCount?: number;
  checkpointScores: {
    "15": HumanEvaluationScore9 | null;
    "17": HumanEvaluationScore9 | null;
    "19": HumanEvaluationScore9 | null;
  };
  checkpointStatus: {
    "15": ProductionShortageCheckpointStatus;
    "17": ProductionShortageCheckpointStatus;
    "19": ProductionShortageCheckpointStatus;
  };
  checkpointSourceScale: {
    "15": HumanEvaluationScale | null;
    "17": HumanEvaluationScale | null;
    "19": HumanEvaluationScale | null;
  };
  checkpointEvaluations?: {
    "15": AreaCountEvaluation | null;
    "17": AreaCountEvaluation | null;
    "19": AreaCountEvaluation | null;
  };
  checkpointSources?: {
    "15": ProductionShortageCheckpointSource | null;
    "17": ProductionShortageCheckpointSource | null;
    "19": ProductionShortageCheckpointSource | null;
  };
};

export type ProductionAnalysis = {
  version: 1;
  requiredCheckpoints: ["15", "17", "19"];
  areas: Partial<Record<AreaId, ProductionAreaAnalysis>>;
};

const DISCOUNT_TIMES: DiscountTime[] = ["15", "17", "18", "19", "20"];
const FORECAST_HOURS: ForecastHourKey[] = ["16", "17", "18", "19", "20", "21"];
const ACTUAL_WEEKDAYS: ActualWeekdayLabel[] = [
  "日",
  "月",
  "火",
  "水",
  "木",
  "金",
  "土",
];
const ACTUAL_WEEKDAY_GROUPS: ActualWeekdayGroup[] = [
  "月水",
  "火木",
  "金土日",
  "火木日",
  "金土",
  "三連休中日",
  "翌日平日祝日",
];
const WEEKDAY_BASE_LABELS: WeekdayBaseLabel[] = ["日", "金土", "火木", "月水"];
const AREA_COUNT_COMPARISON_MODES: AreaCountComparisonMode[] = [
  "weekday",
  "fallback_group",
  "three_day_holiday_middle",
  "holiday_before_normal_weekday",
];
const AREA_REFERENCE_REASONS: CalendarAreaCountReferenceReason[] = [
  "same_weekday_history",
  "fallback_weekday_group_history",
  "three_day_holiday_middle_history",
  "holiday_before_normal_weekday_history",
  "insufficient_history",
  "disabled",
  "metadata_not_captured",
];
const CHECKPOINT_TIMES = ["15", "17", "19"] as const;
const AREA_COUNT_EVALUATIONS: AreaCountEvaluation[] = [
  "few",
  "slightly_few",
  "normal",
  "slightly_many",
  "many",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDiscountTime(value: unknown): value is DiscountTime {
  return DISCOUNT_TIMES.includes(value as DiscountTime);
}

function isAreaCountEvaluationValue(
  value: unknown,
): value is AreaCountEvaluation {
  return AREA_COUNT_EVALUATIONS.includes(value as AreaCountEvaluation);
}

function isActualWeekday(value: unknown): value is ActualWeekdayLabel {
  return ACTUAL_WEEKDAYS.includes(value as ActualWeekdayLabel);
}

function isActualWeekdayGroup(value: unknown): value is ActualWeekdayGroup {
  return ACTUAL_WEEKDAY_GROUPS.includes(value as ActualWeekdayGroup);
}

function getActualWeekdayFromDate(date: string): ActualWeekdayLabel | null {
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
  return ACTUAL_WEEKDAYS[parsed.getUTCDay()] ?? null;
}

function getCalendarCondition(date: string): Pick<
  AnalysisCalendarContext,
  "isHoliday" | "isDayBeforeHoliday" | "calendarCondition"
> {
  const isHoliday = isJapaneseHolidayOrObserved(date);
  const isDayBeforeHoliday = isDayBeforeJapaneseHoliday(date);
  const calendarCondition = isThreeDayHolidayMiddle(date)
    ? "three_day_holiday_middle" as const
    : isHolidayBeforeNormalWeekday(date)
      ? "holiday_before_normal_weekday" as const
      : isHoliday
        ? "holiday" as const
        : !isHoliday && isDayBeforeHoliday
          ? "day_before_holiday" as const
          : "ordinary" as const;
  return { isHoliday, isDayBeforeHoliday, calendarCondition };
}

function normalizeIndividualAmountReference(
  raw: unknown,
): CalendarIndividualAmountReference | null {
  if (!isObject(raw)) return null;
  const kind = raw.kind;
  const validKind =
    kind === "three_day_holiday_middle" ||
    kind === "day_before_holiday" ||
    kind === "holiday" ||
    kind === "actual_weekday";
  const comparisonMode = raw.comparisonMode;
  const validComparisonMode =
    comparisonMode === "three_day_holiday_middle" ||
    comparisonMode === "weekday_group" ||
    comparisonMode === "weekday";
  const referenceWeekday = raw.referenceWeekday;
  const referenceWeekdayGroup = raw.referenceWeekdayGroup;
  if (
    !validKind ||
    !validComparisonMode ||
    (referenceWeekday !== null &&
      (!Number.isInteger(referenceWeekday) ||
        Number(referenceWeekday) < 0 ||
        Number(referenceWeekday) > 6)) ||
    (referenceWeekdayGroup !== null &&
      !WEEKDAY_BASE_LABELS.includes(referenceWeekdayGroup as WeekdayBaseLabel)) ||
    !isDiscountTime(raw.referenceDiscountTime) ||
    raw.reason !== kind ||
    typeof raw.referenceText !== "string" ||
    raw.referenceText.trim() === "" ||
    (raw.sessionStartedAt !== null &&
      (typeof raw.sessionStartedAt !== "string" ||
        raw.sessionStartedAt.trim() === ""))
  ) {
    return null;
  }

  return {
    kind,
    comparisonMode,
    referenceWeekday: referenceWeekday as number | null,
    referenceWeekdayGroup: referenceWeekdayGroup as WeekdayBaseLabel | null,
    referenceDiscountTime: raw.referenceDiscountTime,
    reason: kind,
    referenceText: raw.referenceText,
    sessionStartedAt: raw.sessionStartedAt,
  };
}

function normalizeAreaCountReference(
  raw: unknown,
): CalendarAreaCountReference | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw.sessionStartedAt !== "string" ||
    raw.sessionStartedAt.trim() === "" ||
    !isDiscountTime(raw.discountTime) ||
    typeof raw.areaId !== "string" ||
    (raw.recommendationStatus !== null &&
      raw.recommendationStatus !== "ready" &&
      raw.recommendationStatus !== "insufficient" &&
      raw.recommendationStatus !== "disabled") ||
    (raw.type !== "weekday" &&
      raw.type !== "weekday_group" &&
      raw.type !== "composite_weekday_groups" &&
      raw.type !== "unavailable") ||
    (raw.referenceWeekday !== null && !isActualWeekday(raw.referenceWeekday)) ||
    (raw.referenceWeekdayGroup !== null &&
      !isActualWeekdayGroup(raw.referenceWeekdayGroup)) ||
    (raw.comparisonMode !== null &&
      !AREA_COUNT_COMPARISON_MODES.includes(
        raw.comparisonMode as AreaCountComparisonMode,
      )) ||
    !AREA_REFERENCE_REASONS.includes(
      raw.reason as CalendarAreaCountReferenceReason,
    ) ||
    !Array.isArray(raw.referenceWeekdayGroups) ||
    !raw.referenceWeekdayGroups.every(isActualWeekdayGroup)
  ) {
    return null;
  }

  if (
    (raw.type === "weekday" && !isActualWeekday(raw.referenceWeekday)) ||
    (raw.type === "weekday_group" &&
      !isActualWeekdayGroup(raw.referenceWeekdayGroup)) ||
    (raw.type === "composite_weekday_groups" &&
      raw.referenceWeekdayGroups.length < 2)
  ) {
    return null;
  }

  return {
    sessionStartedAt: raw.sessionStartedAt,
    discountTime: raw.discountTime,
    areaId: raw.areaId as AreaId,
    recommendationStatus: raw.recommendationStatus,
    type: raw.type,
    referenceWeekday: raw.referenceWeekday as ActualWeekdayLabel | null,
    referenceWeekdayGroup:
      raw.referenceWeekdayGroup as ActualWeekdayGroup | null,
    referenceWeekdayGroups: [...new Set(
      raw.referenceWeekdayGroups as ActualWeekdayGroup[],
    )],
    comparisonMode: raw.comparisonMode as AreaCountComparisonMode | null,
    reason: raw.reason as CalendarAreaCountReferenceReason,
  };
}

function compareCalendarEntry(
  first: { sessionStartedAt: string | null; discountTime?: DiscountTime; areaId?: AreaId },
  second: { sessionStartedAt: string | null; discountTime?: DiscountTime; areaId?: AreaId },
): number {
  const timeCompare = (first.discountTime ?? "").localeCompare(
    second.discountTime ?? "",
  );
  if (timeCompare !== 0) return timeCompare;
  const sessionCompare = (first.sessionStartedAt ?? "").localeCompare(
    second.sessionStartedAt ?? "",
  );
  if (sessionCompare !== 0) return sessionCompare;
  return (first.areaId ?? "").localeCompare(second.areaId ?? "");
}

function dedupeCalendarEntries<T extends { sessionStartedAt: string | null }>(
  entries: readonly T[],
): T[] {
  const byFingerprint = new Map<string, T>();
  for (const entry of entries) {
    byFingerprint.set(JSON.stringify(entry), entry);
  }
  return [...byFingerprint.values()];
}

export function normalizeAnalysisCalendarContext(
  raw: unknown,
): AnalysisCalendarContext | undefined {
  if (!isObject(raw) || raw.version !== 1) return undefined;
  if (
    raw.scope !== "session" &&
    raw.scope !== "day" &&
    raw.scope !== "area_count"
  ) {
    return undefined;
  }
  if (typeof raw.date !== "string") return undefined;
  const actualWeekday = getActualWeekdayFromDate(raw.date);
  if (!actualWeekday) return undefined;
  const individualRaw = Array.isArray(raw.individualAmountReference)
    ? raw.individualAmountReference
    : [];
  const areaRaw = Array.isArray(raw.areaCountReference)
    ? raw.areaCountReference
    : [];
  const individualAmountReference = individualRaw
    .map(normalizeIndividualAmountReference)
    .filter(
      (value): value is CalendarIndividualAmountReference => value !== null,
    )
    .sort(compareCalendarEntry);
  const areaCountReference = areaRaw
    .map(normalizeAreaCountReference)
    .filter((value): value is CalendarAreaCountReference => value !== null)
    .sort(compareCalendarEntry);

  return {
    version: 1,
    scope: raw.scope,
    date: raw.date,
    actualWeekday,
    ...getCalendarCondition(raw.date),
    manualWeekdayOverride: raw.manualWeekdayOverride === true,
    individualAmountReference: dedupeCalendarEntries(
      individualAmountReference,
    ),
    areaCountReference: dedupeCalendarEntries(areaCountReference),
  };
}

function buildAreaCountReference(params: {
  sessionStartedAt: string;
  discountTime: DiscountTime;
  date: string;
  weekday: number;
  areaId: AreaId;
  basis?: AreaCountDecisionBasis;
}): CalendarAreaCountReference {
  const comparisonMode = params.basis?.comparisonMode ?? null;
  const base = {
    sessionStartedAt: params.sessionStartedAt,
    discountTime: params.discountTime,
    areaId: params.areaId,
    recommendationStatus: params.basis?.recommendationStatus ?? null,
    comparisonMode,
  };

  if (!params.basis) {
    return {
      ...base,
      type: "unavailable",
      referenceWeekday: null,
      referenceWeekdayGroup: null,
      referenceWeekdayGroups: [],
      reason: "metadata_not_captured",
    };
  }
  if (params.basis.recommendationStatus === "disabled") {
    return {
      ...base,
      type: "unavailable",
      referenceWeekday: null,
      referenceWeekdayGroup: null,
      referenceWeekdayGroups: [],
      reason: "disabled",
    };
  }
  const hasSufficientHistory = params.basis.recommendationStatus === "ready";

  if (
    comparisonMode === "weekday" &&
    isActualWeekday(params.basis.actualWeekday)
  ) {
    return {
      ...base,
      type: "weekday",
      referenceWeekday: params.basis.actualWeekday,
      referenceWeekdayGroup: null,
      referenceWeekdayGroups: [],
      reason: hasSufficientHistory
        ? "same_weekday_history"
        : "insufficient_history",
    };
  }

  if (comparisonMode === "three_day_holiday_middle") {
    const adoptedSource = params.basis.threeDayHolidayMiddleReference?.adoptedSource;
    const groups: ActualWeekdayGroup[] =
      adoptedSource === "both"
        ? ["火木日", "金土"]
        : adoptedSource === "火木日" || adoptedSource === "金土"
          ? [adoptedSource]
          : hasSufficientHistory
            ? []
            : ["火木日", "金土"];
    return groups.length > 0
      ? {
          ...base,
          type: groups.length > 1
            ? "composite_weekday_groups"
            : "weekday_group",
          referenceWeekday: null,
          referenceWeekdayGroup: groups.length === 1 ? groups[0] ?? null : null,
          referenceWeekdayGroups: groups,
          reason: hasSufficientHistory
            ? "three_day_holiday_middle_history"
            : "insufficient_history",
        }
      : {
          ...base,
          type: "unavailable",
          referenceWeekday: null,
          referenceWeekdayGroup: null,
          referenceWeekdayGroups: [],
          reason: "metadata_not_captured",
        };
  }

  const group = comparisonMode === "holiday_before_normal_weekday"
    ? params.discountTime === "15"
      ? "金土日"
      : "火木日"
    : comparisonMode === "fallback_group" &&
        isActualWeekdayGroup(params.basis.actualWeekdayGroup)
      ? params.basis.actualWeekdayGroup
      : null;
  const reason: CalendarAreaCountReferenceReason =
    !hasSufficientHistory
      ? "insufficient_history"
      : comparisonMode === "fallback_group"
      ? "fallback_weekday_group_history"
      : comparisonMode === "holiday_before_normal_weekday"
          ? "holiday_before_normal_weekday_history"
          : "metadata_not_captured";
  return group && reason !== "metadata_not_captured"
    ? {
        ...base,
        type: "weekday_group",
        referenceWeekday: null,
        referenceWeekdayGroup: group,
        referenceWeekdayGroups: [group],
        reason,
      }
    : {
        ...base,
        type: "unavailable",
        referenceWeekday: null,
        referenceWeekdayGroup: null,
        referenceWeekdayGroups: [],
        reason: "metadata_not_captured",
      };
}

export function buildSessionAnalysisCalendarContext(params: {
  scope?: "session" | "area_count";
  date: string;
  weekday: number;
  discountTime: DiscountTime;
  sessionStartedAt: string | null;
  manualWeekdayOverride: boolean;
  areaDecisionBases: readonly {
    areaId: AreaId;
    basis?: AreaCountDecisionBasis;
  }[];
}): AnalysisCalendarContext | undefined {
  const actualWeekday = getActualWeekdayFromDate(params.date);
  if (!actualWeekday) return undefined;
  const individual = getIndividualAmountReferenceContext({
    date: params.date,
    weekday: params.weekday,
    discountTime: params.discountTime,
  });
  const individualAmountReference: CalendarIndividualAmountReference[] = [
    { ...individual, sessionStartedAt: params.sessionStartedAt },
  ];
  const areaCountReference = params.sessionStartedAt === null
    ? []
    : params.areaDecisionBases
        .map(({ areaId, basis }) =>
          buildAreaCountReference({
            sessionStartedAt: params.sessionStartedAt as string,
            discountTime: params.discountTime,
            date: params.date,
            weekday: params.weekday,
            areaId,
            basis,
          }),
        )
        .sort(compareCalendarEntry);

  return {
    version: 1,
    scope: params.scope ?? "session",
    date: params.date,
    actualWeekday,
    ...getCalendarCondition(params.date),
    manualWeekdayOverride: params.manualWeekdayOverride,
    individualAmountReference,
    areaCountReference,
  };
}

export function buildDayAnalysisCalendarContext(params: {
  date: string;
  sessionContexts: readonly (AnalysisCalendarContext | undefined)[];
  areaRecordContexts?: readonly (AnalysisCalendarContext | undefined)[];
}): AnalysisCalendarContext | undefined {
  const actualWeekday = getActualWeekdayFromDate(params.date);
  if (!actualWeekday) return undefined;
  const contexts = [...params.sessionContexts, ...(params.areaRecordContexts ?? [])]
    .flatMap((context) => {
      const normalized = normalizeAnalysisCalendarContext(context);
      return normalized?.date === params.date ? [normalized] : [];
    });
  const individualAmountReference = dedupeCalendarEntries(
    contexts.flatMap((context) => context.individualAmountReference),
  ).sort(compareCalendarEntry);
  const areaCountReference = dedupeCalendarEntries(
    contexts.flatMap((context) => context.areaCountReference),
  ).sort(compareCalendarEntry);

  return {
    version: 1,
    scope: "day",
    date: params.date,
    actualWeekday,
    ...getCalendarCondition(params.date),
    manualWeekdayOverride: contexts.some(
      (context) => context.manualWeekdayOverride,
    ),
    individualAmountReference,
    areaCountReference,
  };
}

function getWeatherClassification(params: {
  expectedHours: readonly ForecastHourKey[];
  consideredHours: readonly ForecastHourKey[];
  rainHours: readonly ForecastHourKey[];
  snowHours: readonly ForecastHourKey[];
}): AnalysisWeatherClassification {
  if (params.consideredHours.length !== params.expectedHours.length) return "unknown";
  if (params.rainHours.length > 0 && params.snowHours.length > 0) return "mixed";
  if (params.snowHours.length > 0) return "snow";
  if (params.rainHours.length > 0) return "rain";
  return "dry";
}

export function buildAnalysisWeatherContext(
  rawWeatherOrForecasts: unknown,
  discountTime?: DiscountTime,
): AnalysisWeatherContext {
  const raw = isObject(rawWeatherOrForecasts) &&
      isObject(rawWeatherOrForecasts.hourlyForecasts)
    ? rawWeatherOrForecasts.hourlyForecasts
    : rawWeatherOrForecasts;
  const forecasts = isObject(raw) ? raw : {};
  const consideredHours: ForecastHourKey[] = [];
  const dryHours: ForecastHourKey[] = [];
  const rainHours: ForecastHourKey[] = [];
  const snowHours: ForecastHourKey[] = [];
  const expectedHours = discountTime
    ? getWeatherInputForecastHours(discountTime)
    : [...FORECAST_HOURS];

  for (const hour of expectedHours) {
    const entry = forecasts[hour];
    if (!isObject(entry)) continue;
    if (
      entry.weather !== "sunny" &&
      entry.weather !== "rain" &&
      entry.weather !== "snow"
    ) {
      continue;
    }
    consideredHours.push(hour);
    if (entry.weather === "sunny") dryHours.push(hour);
    if (entry.weather === "rain") rainHours.push(hour);
    if (entry.weather === "snow") snowHours.push(hour);
  }

  return {
    version: 1,
    weatherDataSource: "entered_hourly_forecast",
    analysisWeatherClass: getWeatherClassification({
      expectedHours,
      consideredHours,
      rainHours,
      snowHours,
    }),
    hasPrecipitation: rainHours.length > 0 || snowHours.length > 0,
    precipitationTypes: [
      ...(rainHours.length > 0 ? ["rain" as const] : []),
      ...(snowHours.length > 0 ? ["snow" as const] : []),
    ],
    expectedHours,
    consideredHours,
    dryHours,
    rainHours,
    snowHours,
  };
}

export function normalizeAnalysisWeatherContext(
  raw: unknown,
): AnalysisWeatherContext | undefined {
  if (!isObject(raw) || raw.version !== 1) return undefined;
  if (raw.weatherDataSource !== "entered_hourly_forecast") return undefined;
  const normalizeHours = (value: unknown): ForecastHourKey[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((hour): hour is ForecastHourKey =>
          FORECAST_HOURS.includes(hour as ForecastHourKey),
        ))].sort()
      : [];
  const expectedHours = raw.expectedHours === undefined
    ? [...FORECAST_HOURS]
    : normalizeHours(raw.expectedHours);
  const validExpectedHours = DISCOUNT_TIMES.some(
    (discountTime) =>
      JSON.stringify(expectedHours) ===
      JSON.stringify(getWeatherInputForecastHours(discountTime)),
  );
  if (!validExpectedHours) return undefined;
  const consideredHours = normalizeHours(raw.consideredHours).filter((hour) =>
    expectedHours.includes(hour),
  );
  const dryHours = normalizeHours(raw.dryHours).filter((hour) =>
    consideredHours.includes(hour),
  );
  const rainHours = normalizeHours(raw.rainHours).filter((hour) =>
    consideredHours.includes(hour),
  );
  const snowHours = normalizeHours(raw.snowHours).filter((hour) =>
    consideredHours.includes(hour),
  );
  const assignedHours = [...dryHours, ...rainHours, ...snowHours];
  if (
    new Set(assignedHours).size !== assignedHours.length ||
    assignedHours.length !== consideredHours.length
  ) {
    return undefined;
  }
  const analysisWeatherClass = getWeatherClassification({
    expectedHours,
    consideredHours,
    rainHours,
    snowHours,
  });
  const hasPrecipitation = rainHours.length > 0 || snowHours.length > 0;
  const precipitationTypes: Array<"rain" | "snow"> = [
    ...(rainHours.length > 0 ? ["rain" as const] : []),
    ...(snowHours.length > 0 ? ["snow" as const] : []),
  ];
  if (
    raw.analysisWeatherClass !== analysisWeatherClass ||
    raw.hasPrecipitation !== hasPrecipitation ||
    !Array.isArray(raw.precipitationTypes) ||
    JSON.stringify(raw.precipitationTypes) !== JSON.stringify(precipitationTypes)
  ) {
    return undefined;
  }
  return {
    version: 1,
    weatherDataSource: "entered_hourly_forecast",
    analysisWeatherClass,
    hasPrecipitation,
    precipitationTypes,
    expectedHours,
    consideredHours,
    dryHours,
    rainHours,
    snowHours,
  };
}

/**
 * Select the most informative entered forecast without allowing an incomplete
 * legacy candidate to hide a complete one. Candidate order remains the final
 * tie-breaker so callers can state their semantic preference explicitly.
 */
export function chooseBestAnalysisWeatherContext(
  candidates: readonly unknown[],
): AnalysisWeatherContext | undefined {
  let best: AnalysisWeatherContext | undefined;
  let bestCompleteness = -1;
  let bestKnown = -1;
  let bestCompletenessRatio = -1;

  for (const candidate of candidates) {
    const normalized = normalizeAnalysisWeatherContext(candidate);
    if (!normalized) continue;
    const completeness = normalized.consideredHours.length;
    const known = normalized.analysisWeatherClass === "unknown" ? 0 : 1;
    const completenessRatio = normalized.expectedHours.length === 0
      ? 0
      : completeness / normalized.expectedHours.length;
    if (
      known > bestKnown ||
      (known === bestKnown && completenessRatio > bestCompletenessRatio) ||
      (known === bestKnown &&
        completenessRatio === bestCompletenessRatio &&
        completeness > bestCompleteness)
    ) {
      best = normalized;
      bestCompleteness = completeness;
      bestKnown = known;
      bestCompletenessRatio = completenessRatio;
    }
  }

  return best;
}

function legacyEvaluationToRawScore9(
  evaluation: AreaCountEvaluation | undefined,
): HumanEvaluationScore9 | undefined {
  switch (evaluation) {
    case "few":
      return 1;
    case "slightly_few":
      return 3;
    case "normal":
      return 5;
    case "slightly_many":
      return 7;
    case "many":
      return 9;
    default:
      return undefined;
  }
}

function resolveHumanRawScore(params: {
  details: unknown;
  legacyEvaluation?: AreaCountEvaluation;
}): { rawScore9: HumanEvaluationScore9; sourceScale: HumanEvaluationScale } | null {
  const details = normalizeHumanEvaluationDetails(params.details);
  if (details) {
    return {
      rawScore9: details.humanEvaluationScore9,
      sourceScale: details.humanEvaluationScale,
    };
  }
  const rawScore9 = legacyEvaluationToRawScore9(params.legacyEvaluation);
  return rawScore9 === undefined
    ? null
    : { rawScore9, sourceScale: 5 };
}

function buildUnavailableCheckpoint(
  discountTime: "15" | "17" | "19",
  status: Exclude<ProductionShortageCheckpointStatus, "recorded">,
): ProductionShortageCheckpoint {
  return { discountTime, status };
}

function getLatestSession(
  sessions: readonly DailySessionSnapshot[],
  date: string,
  demandCycle: DemandCycle,
  discountTime: "15" | "17",
): DailySessionSnapshot | null {
  return sessions
    .filter(
      (session) =>
        session.session.date === date &&
        normalizeDemandCycle(
          session.demandCycle ?? session.session.demandCycle,
        ) === demandCycle &&
        session.session.discountTime === discountTime,
    )
    .sort((first, second) => first.capturedAt.localeCompare(second.capturedAt))
    .at(-1) ?? null;
}

function getLatestAreaCountRecord(params: {
  records: readonly AreaCountRecord[];
  date: string;
  demandCycle: DemandCycle;
  areaId: AreaId;
  discountTime: "15" | "17";
  sessionStartedAt: string;
}): AreaCountRecord | null {
  return params.records
    .filter(
      (record) =>
        record.date === params.date &&
        normalizeDemandCycle(record.demandCycle) === params.demandCycle &&
        record.areaId === params.areaId &&
        record.discountTime === params.discountTime &&
        record.sessionStartedAt === params.sessionStartedAt,
    )
    .sort((first, second) => first.recordedAt.localeCompare(second.recordedAt))
    .at(-1) ?? null;
}

function buildOperationCheckpoint(params: {
  discountTime: "15" | "17";
  date: string;
  demandCycle: DemandCycle;
  areaId: AreaId;
  records: readonly AreaCountRecord[];
  sessions: readonly DailySessionSnapshot[];
}): ProductionShortageCheckpoint {
  const session = getLatestSession(
    params.sessions,
    params.date,
    params.demandCycle,
    params.discountTime,
  );
  if (!session) {
    return buildUnavailableCheckpoint(params.discountTime, "session_missing");
  }
  const record = getLatestAreaCountRecord({
    records: params.records,
    date: params.date,
    demandCycle: params.demandCycle,
    areaId: params.areaId,
    discountTime: params.discountTime,
    sessionStartedAt: session.session.startedAt,
  });
  const area = session.areas?.[params.areaId];
  if (area?.measurementStatus === "not_measured" || area?.missingReason) {
    return buildUnavailableCheckpoint(params.discountTime, "not_measured");
  }
  if (typeof area?.areaCount !== "number" && typeof record?.count !== "number") {
    return buildUnavailableCheckpoint(params.discountTime, "missing");
  }
  const explicitRecordSource =
    record?.evaluationSource ?? record?.decisionBasis?.evaluationSource;
  const recordSource =
    explicitRecordSource ?? (record?.userJudge ? "manual" : undefined);
  const recordEvaluation =
    record?.decisionBasis?.finalEvaluation ??
    (recordSource === "manual"
      ? record?.userJudge ?? record?.suggestedEvaluation
      : recordSource === "history"
        ? record?.suggestedEvaluation
        : undefined);
  const sessionEvaluation =
    area?.areaCountEvaluation ?? area?.areaCountDecisionBasis?.finalEvaluation;
  const sessionSource =
    area?.areaCountEvaluationSource ?? area?.areaCountDecisionBasis?.evaluationSource;
  const hasValidRecordDecision =
    Boolean(recordEvaluation) &&
    (recordSource === "history" || recordSource === "manual");
  const evaluation = hasValidRecordDecision
    ? recordEvaluation
    : sessionEvaluation;
  const source = hasValidRecordDecision ? recordSource : sessionSource;
  if (!evaluation || (source !== "history" && source !== "manual")) {
    return buildUnavailableCheckpoint(params.discountTime, "missing");
  }

  const humanScore = source === "manual"
    ? resolveHumanRawScore({
        details:
          (hasValidRecordDecision
            ? record?.humanEvaluationDetails
            : area?.humanEvaluationDetails) ??
          record?.humanEvaluationDetails ??
          area?.humanEvaluationDetails,
        legacyEvaluation: evaluation,
      })
    : null;
  return {
    discountTime: params.discountTime,
    status: "recorded",
    evaluation,
    source,
    ...(humanScore ?? {}),
  };
}

function buildReview19Checkpoint(params: {
  areaId: AreaId;
  demandCycle: DemandCycle;
  review19Check?: Review19DayCheckSnapshot;
}): ProductionShortageCheckpoint {
  const check = params.review19Check;
  if (
    !check ||
    check.review19Status !== "recorded" ||
    normalizeDemandCycle(check.demandCycle) !== params.demandCycle
  ) {
    return buildUnavailableCheckpoint("19", "session_missing");
  }
  if (check.excludedAreaIds.includes(params.areaId)) {
    return buildUnavailableCheckpoint("19", "excluded");
  }
  if (check.dataQuality.notMeasuredAreaIds.includes(params.areaId)) {
    return buildUnavailableCheckpoint("19", "not_measured");
  }
  if (typeof check.areaCounts[params.areaId] !== "number") {
    return buildUnavailableCheckpoint("19", "missing");
  }
  const evaluation: Review19AreaEvaluation | undefined =
    check.areaEvaluations?.[params.areaId];
  const score = resolveHumanRawScore({
    details: evaluation?.humanEvaluationDetails,
    legacyEvaluation: evaluation?.humanEvaluation,
  });
  return score
    ? {
        discountTime: "19",
        status: "recorded",
        evaluation: evaluation?.humanEvaluation,
        source: "human_review19",
        ...score,
      }
    : buildUnavailableCheckpoint("19", "missing");
}

export function buildProductionShortageSuspicion(params: {
  areaId: AreaId;
  checkpoints: {
    "15": ProductionShortageCheckpoint;
    "17": ProductionShortageCheckpoint;
    "19": ProductionShortageCheckpoint;
  };
}): ProductionAreaAnalysis {
  const checkpoints = Object.fromEntries(
    CHECKPOINT_TIMES.map((time) => [
      time,
      normalizeCheckpoint(params.checkpoints[time], time) ??
        buildUnavailableCheckpoint(time, "missing"),
    ]),
  ) as typeof params.checkpoints;
  const values = CHECKPOINT_TIMES.map((time) => checkpoints[time]);
  const recorded = values.filter((checkpoint) => checkpoint.status === "recorded");
  const checkpointScores = Object.fromEntries(
    CHECKPOINT_TIMES.map((time) => [
      time,
      checkpoints[time].status === "recorded"
        ? checkpoints[time].rawScore9 ?? null
        : null,
    ]),
  ) as ProductionAreaAnalysis["checkpointScores"];
  const checkpointStatus = Object.fromEntries(
    CHECKPOINT_TIMES.map((time) => [time, checkpoints[time].status]),
  ) as ProductionAreaAnalysis["checkpointStatus"];
  const checkpointSourceScale = Object.fromEntries(
    CHECKPOINT_TIMES.map((time) => [
      time,
      checkpoints[time].status === "recorded"
        ? checkpoints[time].sourceScale ?? null
        : null,
    ]),
  ) as ProductionAreaAnalysis["checkpointSourceScale"];
  const checkpointEvaluations = Object.fromEntries(
    CHECKPOINT_TIMES.map((time) => [
      time,
      checkpoints[time].status === "recorded"
        ? checkpoints[time].evaluation ?? null
        : null,
    ]),
  ) as NonNullable<ProductionAreaAnalysis["checkpointEvaluations"]>;
  const checkpointSources = Object.fromEntries(
    CHECKPOINT_TIMES.map((time) => [
      time,
      checkpoints[time].status === "recorded"
        ? checkpoints[time].source ?? null
        : null,
    ]),
  ) as NonNullable<ProductionAreaAnalysis["checkpointSources"]>;
  if (recorded.length !== CHECKPOINT_TIMES.length) {
    return {
      version: 1,
      areaId: params.areaId,
      productionShortageSuspicion: "insufficient",
      validCheckpointCount: recorded.length,
      checkpointScores,
      checkpointStatus,
      checkpointSourceScale,
      checkpointEvaluations,
      checkpointSources,
    };
  }
  const lowSideCount = recorded.filter((checkpoint) => {
    if (checkpoint.discountTime === "19") {
      return (
        checkpoint.rawScore9 !== undefined &&
        checkpoint.rawScore9 >= 1 &&
        checkpoint.rawScore9 <= 4
      );
    }
    if (checkpoint.evaluation) {
      return (
        checkpoint.evaluation === "few" ||
        checkpoint.evaluation === "slightly_few"
      );
    }
    // Compatibility for 2026.8.9-4 persisted analysis, which only carried
    // a human raw score for 15/17. New analyses always carry final evaluation.
    return (
      checkpoint.rawScore9 !== undefined &&
      checkpoint.rawScore9 >= 1 &&
      checkpoint.rawScore9 <= 4
    );
  }).length;
  const level: ProductionShortageSuspicionLevel =
    lowSideCount === 3
      ? "strong"
      : lowSideCount === 2
        ? "medium"
        : lowSideCount === 1
          ? "weak"
          : "none";
  return {
    version: 1,
    areaId: params.areaId,
    productionShortageSuspicion: level,
    validCheckpointCount: 3,
    lowSideCount,
    checkpointScores,
    checkpointStatus,
    checkpointSourceScale,
    checkpointEvaluations,
    checkpointSources,
  };
}

export function buildProductionAnalysis(params: {
  date: string;
  demandCycle?: DemandCycle;
  areaIds: readonly AreaId[];
  areaCountRecords: readonly AreaCountRecord[];
  sessions: readonly DailySessionSnapshot[];
  review19Check?: Review19DayCheckSnapshot;
}): ProductionAnalysis {
  const demandCycle = normalizeDemandCycle(params.demandCycle);
  const areas: ProductionAnalysis["areas"] = {};
  for (const areaId of params.areaIds) {
    areas[areaId] = buildProductionShortageSuspicion({
      areaId,
      checkpoints: {
        "15": buildOperationCheckpoint({
          discountTime: "15",
          date: params.date,
          demandCycle,
          areaId,
          records: params.areaCountRecords,
          sessions: params.sessions,
        }),
        "17": buildOperationCheckpoint({
          discountTime: "17",
          date: params.date,
          demandCycle,
          areaId,
          records: params.areaCountRecords,
          sessions: params.sessions,
        }),
        "19": buildReview19Checkpoint({
          areaId,
          demandCycle,
          review19Check: params.review19Check,
        }),
      },
    });
  }
  return {
    version: 1,
    requiredCheckpoints: ["15", "17", "19"],
    areas,
  };
}

function normalizeCheckpoint(
  raw: unknown,
  discountTime: "15" | "17" | "19",
): ProductionShortageCheckpoint | null {
  if (!isObject(raw) || raw.discountTime !== discountTime) return null;
  if (
    raw.status !== "recorded" &&
    raw.status !== "missing" &&
    raw.status !== "excluded" &&
    raw.status !== "not_measured" &&
    raw.status !== "session_missing"
  ) {
    return null;
  }
  if (raw.status !== "recorded") return { discountTime, status: raw.status };
  const hasValidRawScore =
    Number.isInteger(raw.rawScore9) &&
    Number(raw.rawScore9) >= 1 &&
    Number(raw.rawScore9) <= 9 &&
    (raw.sourceScale === 5 || raw.sourceScale === 9);
  const evaluation = isAreaCountEvaluationValue(raw.evaluation)
    ? raw.evaluation
    : undefined;
  const source =
    raw.source === "manual" ||
    raw.source === "history" ||
    raw.source === "human_review19"
      ? raw.source
      : undefined;

  if (discountTime === "19") {
    if (!hasValidRawScore || (source && source !== "human_review19")) return null;
    return {
      discountTime,
      status: "recorded",
      evaluation,
      source: "human_review19",
      rawScore9: raw.rawScore9 as HumanEvaluationScore9,
      sourceScale: raw.sourceScale as HumanEvaluationScale,
    };
  }

  if (evaluation && (source === "history" || source === "manual")) {
    return {
      discountTime,
      status: "recorded",
      evaluation,
      source,
      ...(source === "manual" && hasValidRawScore
        ? {
            rawScore9: raw.rawScore9 as HumanEvaluationScore9,
            sourceScale: raw.sourceScale as HumanEvaluationScale,
          }
        : {}),
    };
  }

  // Compatibility with 2026.8.9-4 productionAnalysis. At that point a
  // recorded 15/17 checkpoint could only have originated from manual input.
  if (!hasValidRawScore || source === "history" || source === "human_review19") {
    return null;
  }
  return {
    discountTime,
    status: "recorded",
    rawScore9: raw.rawScore9 as HumanEvaluationScore9,
    sourceScale: raw.sourceScale as HumanEvaluationScale,
    source: "manual",
  };
}

export function normalizeProductionAnalysis(
  raw: unknown,
  areaIds: readonly AreaId[],
): ProductionAnalysis | undefined {
  if (
    !isObject(raw) ||
    raw.version !== 1 ||
    !Array.isArray(raw.requiredCheckpoints) ||
    JSON.stringify(raw.requiredCheckpoints) !== JSON.stringify(CHECKPOINT_TIMES) ||
    !isObject(raw.areas)
  ) {
    return undefined;
  }
  const areas: ProductionAnalysis["areas"] = {};
  for (const areaId of areaIds) {
    const candidate = raw.areas[areaId];
    if (!isObject(candidate) || candidate.version !== 1 || candidate.areaId !== areaId) {
      continue;
    }
    const checkpointScores = candidate.checkpointScores;
    const checkpointStatus = candidate.checkpointStatus;
    const checkpointSourceScale = candidate.checkpointSourceScale;
    const checkpointEvaluations = candidate.checkpointEvaluations;
    const checkpointSources = candidate.checkpointSources;
    if (
      !isObject(checkpointScores) ||
      !isObject(checkpointStatus) ||
      !isObject(checkpointSourceScale)
    ) {
      continue;
    }
    const buildRawCheckpoint = (time: "15" | "17" | "19") => ({
      discountTime: time,
      status: checkpointStatus[time],
      rawScore9: checkpointScores[time],
      sourceScale: checkpointSourceScale[time],
      evaluation: isObject(checkpointEvaluations)
        ? checkpointEvaluations[time]
        : undefined,
      source: isObject(checkpointSources)
        ? checkpointSources[time]
        : undefined,
    });
    const at15 = normalizeCheckpoint(buildRawCheckpoint("15"), "15");
    const at17 = normalizeCheckpoint(buildRawCheckpoint("17"), "17");
    const at19 = normalizeCheckpoint(buildRawCheckpoint("19"), "19");
    if (!at15 || !at17 || !at19) continue;
    const normalized = buildProductionShortageSuspicion({
      areaId,
      checkpoints: { "15": at15, "17": at17, "19": at19 },
    });
    if (
      candidate.productionShortageSuspicion !==
        normalized.productionShortageSuspicion ||
      candidate.validCheckpointCount !== normalized.validCheckpointCount ||
      candidate.lowSideCount !== normalized.lowSideCount
    ) {
      continue;
    }
    areas[areaId] = normalized;
  }
  return {
    version: 1,
    requiredCheckpoints: ["15", "17", "19"],
    areas,
  };
}

/** Preserve complementary persisted/rebuilt evidence checkpoint by checkpoint. */
export function mergeProductionAnalyses(params: {
  persisted: unknown;
  rebuilt: unknown;
  areaIds: readonly AreaId[];
}): ProductionAnalysis | undefined {
  const persisted = normalizeProductionAnalysis(
    params.persisted,
    params.areaIds,
  );
  const rebuilt = normalizeProductionAnalysis(params.rebuilt, params.areaIds);
  if (!persisted && !rebuilt) return undefined;

  const areas: ProductionAnalysis["areas"] = {};
  for (const areaId of params.areaIds) {
    const storedArea = persisted?.areas[areaId];
    const rebuiltArea = rebuilt?.areas[areaId];
    if (!storedArea && !rebuiltArea) continue;
    if (!storedArea || !rebuiltArea) {
      areas[areaId] = rebuiltArea ?? storedArea;
      continue;
    }

    const toCheckpoint = (
      area: ProductionAreaAnalysis,
      discountTime: "15" | "17" | "19",
    ): ProductionShortageCheckpoint => {
      const status = area.checkpointStatus[discountTime];
      return status === "recorded"
        ? {
            discountTime,
            status,
            evaluation: area.checkpointEvaluations?.[discountTime] ?? undefined,
            source: area.checkpointSources?.[discountTime] ?? undefined,
            ...(area.checkpointScores[discountTime] !== null &&
            area.checkpointSourceScale[discountTime] !== null
              ? {
                  rawScore9: area.checkpointScores[discountTime] as HumanEvaluationScore9,
                  sourceScale: area.checkpointSourceScale[discountTime] as HumanEvaluationScale,
                }
              : {}),
          }
        : { discountTime, status };
    };
    const checkpoints = Object.fromEntries(
      CHECKPOINT_TIMES.map((discountTime) => {
        const storedCheckpoint = toCheckpoint(storedArea, discountTime);
        const rebuiltCheckpoint = toCheckpoint(rebuiltArea, discountTime);
        const richness = (checkpoint: ProductionShortageCheckpoint): number =>
          checkpoint.status !== "recorded"
            ? 0
            : checkpoint.evaluation && checkpoint.source
              ? 2
              : checkpoint.rawScore9 !== undefined
                ? 1
                : 0;
        return [
          discountTime,
          richness(rebuiltCheckpoint) >= richness(storedCheckpoint)
            ? rebuiltCheckpoint
            : storedCheckpoint,
        ];
      }),
    ) as {
      "15": ProductionShortageCheckpoint;
      "17": ProductionShortageCheckpoint;
      "19": ProductionShortageCheckpoint;
    };
    areas[areaId] = buildProductionShortageSuspicion({
      areaId,
      checkpoints,
    });
  }

  return {
    version: 1,
    requiredCheckpoints: ["15", "17", "19"],
    areas,
  };
}

export function buildSessionCalendarContextFromSnapshot(
  snapshot: DailySessionSnapshot,
): AnalysisCalendarContext | undefined {
  const existing = normalizeAnalysisCalendarContext(
    snapshot.calendarContext,
  );
  if (existing) return existing;
  const areaDecisionBases = Object.values(snapshot.areas ?? {}).flatMap(
    (area: Review19AreaSnapshot | undefined) =>
      area
        ? [{ areaId: area.areaId, basis: area.areaCountDecisionBasis }]
        : [],
  );
  return buildSessionAnalysisCalendarContext({
    date: snapshot.session.date,
    weekday: snapshot.session.weekday,
    discountTime: snapshot.session.discountTime,
    sessionStartedAt: snapshot.session.startedAt,
    manualWeekdayOverride: snapshot.session.manualWeekdayOverride,
    areaDecisionBases,
  });
}
