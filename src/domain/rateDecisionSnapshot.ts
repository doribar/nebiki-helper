import { getCurrentDataVersionInfo } from "./dataVersion.ts";
import { getBaseRate, getNormalTimeRateDisplay } from "./discount.ts";
import type {
  AreaJudge,
  AreaRateAdjustment,
  DiscountTime,
  FinalGuideData,
  ProductAdjustmentPolicySnapshot,
  RateDecisionCalculationMode,
  RateDecisionSnapshot,
  RateDisplayData,
  RateLine,
  RateLogicVersion,
  ResolvedWeatherInput,
} from "./types.ts";

const MINIMUM_RATE_PERCENT = 0 as const;
const MAXIMUM_RATE_PERCENT = 50 as const;

export const PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT = Object.freeze({
  staplePercent: -10,
  nightSellerPercent: -10,
  poorAppearancePercent: 10,
  unpopularPercent: 10,
  advertisementPercent: -10,
  advertisementMode: "always",
} satisfies ProductAdjustmentPolicySnapshot);

type NonFinalCalculationMode = Exclude<RateDecisionCalculationMode, "final">;
type NormalDiscountTime = Exclude<DiscountTime, "20">;

type CommonRateDecisionSnapshotParams = {
  confirmedAt: string;
  sessionDiscountTime: NormalDiscountTime;
  rateLogicVersion?: RateLogicVersion;
  weatherComfortAdjustmentPercent: number;
  areaJudge: Exclude<AreaJudge, null>;
  areaRateAdjustment?: AreaRateAdjustment;
  resolvedWeather: ResolvedWeatherInput;
  weekday?: number;
  date?: string;
  ignoreTimeRateCap?: boolean;
};

export type BuildRateDecisionSnapshotParams = CommonRateDecisionSnapshotParams & {
  effectiveRateDiscountTime: NormalDiscountTime;
  calculationMode: NonFinalCalculationMode;
};

export type BuildNormalRateDecisionSnapshotParams =
  CommonRateDecisionSnapshotParams;

export type BuildLatePlus5RateDecisionSnapshotParams =
  CommonRateDecisionSnapshotParams;

export type BuildEarlyNextMinus5RateDecisionSnapshotParams =
  CommonRateDecisionSnapshotParams & {
    effectiveRateDiscountTime: NormalDiscountTime;
  };

export type BuildFinalDiscountGuideSnapshotParams = {
  confirmedAt: string;
  finalGuide: FinalGuideData;
  resolvedWeather: ResolvedWeatherInput;
  rateLogicVersion?: RateLogicVersion;
  weatherComfortAdjustmentPercent?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function clampRate(value: number): number {
  return Math.max(MINIMUM_RATE_PERCENT, Math.min(MAXIMUM_RATE_PERCENT, value));
}

/** 値引率表示のうち、単独の「数値%」だけを厳密に読み取る。 */
export function parseDisplayRatePercent(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(value);
  if (!match) return undefined;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) &&
    parsed >= MINIMUM_RATE_PERCENT &&
    parsed <= MAXIMUM_RATE_PERCENT
    ? parsed
    : undefined;
}

function applyRateOffsetToText(text: string, offset: number): string {
  return text.replace(/(\d+)%/g, (match, valueText: string) => {
    const value = Number(valueText);
    return Number.isFinite(value) ? `${clampRate(value + offset)}%` : match;
  });
}

/**
 * 先取り値引の -5% は、通常表示を 0..50% に制限した後で適用する。
 * 既存 Hook と同じく、main / note 内のすべての整数%表記へ適用する。
 */
export function applyRateOffsetToDisplay(
  display: RateDisplayData,
  offset: number,
): RateDisplayData {
  return {
    many: {
      main: applyRateOffsetToText(display.many.main, offset),
      note: display.many.note
        ? applyRateOffsetToText(display.many.note, offset)
        : undefined,
    },
    normal: {
      main: applyRateOffsetToText(display.normal.main, offset),
      note: display.normal.note
        ? applyRateOffsetToText(display.normal.note, offset)
        : undefined,
    },
    few: {
      main: applyRateOffsetToText(display.few.main, offset),
      note: display.few.note
        ? applyRateOffsetToText(display.few.note, offset)
        : undefined,
    },
  };
}

function cloneRateLine(raw: unknown): RateLine | undefined {
  if (!isRecord(raw) || typeof raw.main !== "string" || !raw.main.trim()) {
    return undefined;
  }
  if (raw.note !== undefined && typeof raw.note !== "string") {
    return undefined;
  }
  return raw.note === undefined
    ? { main: raw.main }
    : { main: raw.main, note: raw.note as string };
}

function cloneRateDisplay(raw: unknown): RateDisplayData | undefined {
  if (!isRecord(raw)) return undefined;
  const many = cloneRateLine(raw.many);
  const few = cloneRateLine(raw.few);
  const normal = cloneRateLine(raw.normal);
  return many && few && normal ? { many, few, normal } : undefined;
}

function cloneFinalGuide(raw: unknown): FinalGuideData | undefined {
  if (!isRecord(raw) || !isRecord(raw.scoreBreakdown)) return undefined;
  const count1 = cloneRateLine(raw.count1);
  const count2 = cloneRateLine(raw.count2);
  const count3OrMore = cloneRateLine(raw.count3OrMore);
  if (!count1 || !count2 || !count3OrMore) return undefined;
  if (
    !Number.isInteger(raw.score) ||
    !isFiniteNumber(raw.score) ||
    raw.score < 0 ||
    raw.score > 2 ||
    !isFiniteNumber(raw.scoreThreshold) ||
    !isFiniteNumber(raw.scoreBreakdown.weekdayShiftPoints) ||
    !isFiniteNumber(raw.scoreBreakdown.rateBonusPoints)
  ) {
    return undefined;
  }
  if (
    parseDisplayRatePercent(count1.main) === undefined ||
    parseDisplayRatePercent(count2.main) === undefined ||
    parseDisplayRatePercent(count3OrMore.main) === undefined
  ) {
    return undefined;
  }
  return {
    count1,
    count2,
    count3OrMore,
    score: raw.score,
    scoreThreshold: raw.scoreThreshold,
    scoreBreakdown: {
      weekdayShiftPoints: raw.scoreBreakdown.weekdayShiftPoints,
      rateBonusPoints: raw.scoreBreakdown.rateBonusPoints,
    },
  };
}

function cloneResolvedWeather(raw: unknown): ResolvedWeatherInput | undefined {
  if (!isRecord(raw)) return undefined;
  if (
    !["other", "rain", "snow"].includes(String(raw.nearTermWeather)) ||
    typeof raw.hasLaterPrecip !== "boolean" ||
    ![null, "rain", "snow"].includes(raw.laterPrecipType as null | string) ||
    !isFiniteNumber(raw.precipitationRateBonus) ||
    !(
      raw.precipitationRateBonusLabel === null ||
      typeof raw.precipitationRateBonusLabel === "string"
    ) ||
    !["2orLess", "3to4", "5orMore"].includes(String(raw.windLevel)) ||
    ![
      "5orLess",
      "6to10",
      "11to15",
      "16to20",
      "21to25",
      "26to27",
      "28to30",
      "26to30",
      "31to35",
      "36orMore",
    ].includes(String(raw.tempLevel)) ||
    !isFiniteNumber(raw.weatherPointScore) ||
    ![-2, -1, 0, 1, 2].includes(raw.weatherPointShift as number) ||
    !(
      raw.weatherPointRangeText === null ||
      typeof raw.weatherPointRangeText === "string"
    ) ||
    ![-1, 0, 1].includes(raw.next18TempDropShift as number) ||
    ![0, 1, 2].includes(raw.next18WindWorsenShift as number) ||
    ![null, "cold"].includes(raw.next18WindWorsenKind as null | string) ||
    ![null, "cloudy", "sunny"].includes(raw.afterRainSky as null | string)
  ) {
    return undefined;
  }

  return {
    nearTermWeather: raw.nearTermWeather as ResolvedWeatherInput["nearTermWeather"],
    hasLaterPrecip: raw.hasLaterPrecip,
    laterPrecipType: raw.laterPrecipType as ResolvedWeatherInput["laterPrecipType"],
    precipitationRateBonus: raw.precipitationRateBonus,
    precipitationRateBonusLabel:
      raw.precipitationRateBonusLabel as ResolvedWeatherInput["precipitationRateBonusLabel"],
    windLevel: raw.windLevel as ResolvedWeatherInput["windLevel"],
    tempLevel: raw.tempLevel as ResolvedWeatherInput["tempLevel"],
    weatherPointScore: raw.weatherPointScore,
    weatherPointShift: raw.weatherPointShift as ResolvedWeatherInput["weatherPointShift"],
    weatherPointRangeText:
      raw.weatherPointRangeText as ResolvedWeatherInput["weatherPointRangeText"],
    next18TempDropShift:
      raw.next18TempDropShift as ResolvedWeatherInput["next18TempDropShift"],
    next18WindWorsenShift:
      raw.next18WindWorsenShift as ResolvedWeatherInput["next18WindWorsenShift"],
    next18WindWorsenKind:
      raw.next18WindWorsenKind as ResolvedWeatherInput["next18WindWorsenKind"],
    afterRainSky: raw.afterRainSky as ResolvedWeatherInput["afterRainSky"],
  };
}

function cloneProductPolicy(
  raw: unknown,
): ProductAdjustmentPolicySnapshot | undefined {
  if (!isRecord(raw)) return undefined;
  if (
    raw.staplePercent !== -10 ||
    raw.nightSellerPercent !== -10 ||
    raw.poorAppearancePercent !== 10 ||
    raw.unpopularPercent !== 10 ||
    raw.advertisementPercent !== -10 ||
    raw.advertisementMode !== "always"
  ) {
    return undefined;
  }
  return { ...PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT };
}

function getLegacyAreaJudgeAdjustment(
  areaJudge: Exclude<AreaJudge, null>,
  areaRateAdjustment: AreaRateAdjustment | undefined,
): number {
  if (areaRateAdjustment !== undefined) return 0;
  if (areaJudge === "many") return 10;
  if (areaJudge === "few") return -5;
  return 0;
}

function getModeAdjustments(calculationMode: NonFinalCalculationMode): {
  lateTimeAdjustmentPercent: number;
  earlyNextAdjustmentPercent: number;
} {
  switch (calculationMode) {
    case "normal":
      return { lateTimeAdjustmentPercent: 0, earlyNextAdjustmentPercent: 0 };
    case "late_plus5":
      return { lateTimeAdjustmentPercent: 5, earlyNextAdjustmentPercent: 0 };
    case "early_next_minus5":
      return { lateTimeAdjustmentPercent: 0, earlyNextAdjustmentPercent: -5 };
  }
}

function getLimitFlags(params: {
  normalBefore: number;
  manyBefore: number;
  normalAfterBase: number;
  manyAfterBase: number;
  earlyOffset: number;
}): RateDecisionSnapshot["limits"] {
  const normalAfterOffset = params.normalAfterBase + params.earlyOffset;
  const manyAfterOffset = params.manyAfterBase + params.earlyOffset;
  return {
    minimumPercent: MINIMUM_RATE_PERCENT,
    maximumPercent: MAXIMUM_RATE_PERCENT,
    normalLowerLimitApplied:
      params.normalBefore < MINIMUM_RATE_PERCENT ||
      normalAfterOffset < MINIMUM_RATE_PERCENT,
    normalUpperLimitApplied:
      params.normalBefore > MAXIMUM_RATE_PERCENT ||
      normalAfterOffset > MAXIMUM_RATE_PERCENT,
    manyLowerLimitApplied:
      params.manyBefore < MINIMUM_RATE_PERCENT ||
      manyAfterOffset < MINIMUM_RATE_PERCENT,
    manyUpperLimitApplied:
      params.manyBefore > MAXIMUM_RATE_PERCENT ||
      manyAfterOffset > MAXIMUM_RATE_PERCENT,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function assertBuildInputs(params: BuildRateDecisionSnapshotParams): void {
  if (!isValidTimestamp(params.confirmedAt)) {
    throw new TypeError("confirmedAt must be a valid timestamp");
  }
  if (!isFiniteNumber(params.weatherComfortAdjustmentPercent)) {
    throw new TypeError("weatherComfortAdjustmentPercent must be finite");
  }
  if (!cloneResolvedWeather(params.resolvedWeather)) {
    throw new TypeError("resolvedWeather is invalid");
  }
}

/** 通常・遅延+5%・先取り次時刻-5%を、既存の表示計算順で固定保存する。 */
export function buildRateDecisionSnapshot(
  params: BuildRateDecisionSnapshotParams,
): RateDecisionSnapshot {
  assertBuildInputs(params);
  const versionInfo = getCurrentDataVersionInfo();
  const modeAdjustments = getModeAdjustments(params.calculationMode);
  const basicRatePercent = getBaseRate(params.effectiveRateDiscountTime, {
    weekday: params.weekday,
    date: params.date,
  });
  const areaCountAdjustmentPercent = params.areaRateAdjustment ?? 0;
  const legacyAreaJudgeAdjustmentPercent = getLegacyAreaJudgeAdjustment(
    params.areaJudge,
    params.areaRateAdjustment,
  );
  const normalRateBeforeLimitsPercent =
    basicRatePercent +
    params.weatherComfortAdjustmentPercent +
    modeAdjustments.lateTimeAdjustmentPercent +
    areaCountAdjustmentPercent +
    legacyAreaJudgeAdjustmentPercent;
  const manyRateBeforeLimitsPercent = normalRateBeforeLimitsPercent + 10;
  const normalRateAfterBaseLimitsPercent = clampRate(
    normalRateBeforeLimitsPercent,
  );
  const manyRateAfterBaseLimitsPercent = clampRate(manyRateBeforeLimitsPercent);

  const baseDisplay = getNormalTimeRateDisplay({
    discountTime: params.effectiveRateDiscountTime,
    weekday: params.weekday,
    date: params.date,
    weatherBonus:
      params.weatherComfortAdjustmentPercent +
      modeAdjustments.lateTimeAdjustmentPercent,
    areaJudge: params.areaJudge,
    isSunday:
      params.weekday === 0 && params.effectiveRateDiscountTime === "15",
    ignoreTimeRateCap: params.ignoreTimeRateCap,
    areaRateAdjustment: params.areaRateAdjustment,
  });
  const computedDisplay =
    modeAdjustments.earlyNextAdjustmentPercent === 0
      ? baseDisplay
      : applyRateOffsetToDisplay(
          baseDisplay,
          modeAdjustments.earlyNextAdjustmentPercent,
        );
  const display = cloneRateDisplay(computedDisplay)!;
  const normalRatePercent = parseDisplayRatePercent(display.normal.main);
  const manyRatePercent = parseDisplayRatePercent(display.many.main);
  if (normalRatePercent === undefined || manyRatePercent === undefined) {
    throw new Error("normal rate display did not contain a valid percentage");
  }

  const expectedNormalRatePercent = clampRate(
    normalRateAfterBaseLimitsPercent +
      modeAdjustments.earlyNextAdjustmentPercent,
  );
  const expectedManyRatePercent = clampRate(
    manyRateAfterBaseLimitsPercent + modeAdjustments.earlyNextAdjustmentPercent,
  );
  if (
    normalRatePercent !== expectedNormalRatePercent ||
    manyRatePercent !== expectedManyRatePercent
  ) {
    throw new Error("rate snapshot arithmetic differs from the displayed rate");
  }

  return deepFreeze({
    version: 1,
    ...versionInfo,
    confirmedAt: params.confirmedAt,
    sessionDiscountTime: params.sessionDiscountTime,
    effectiveRateDiscountTime: params.effectiveRateDiscountTime,
    calculationMode: params.calculationMode,
    rateLogicVersion: params.rateLogicVersion ?? "time_basic_rate_v1",
    basicRatePercent,
    weatherComfortAdjustmentPercent: params.weatherComfortAdjustmentPercent,
    lateTimeAdjustmentPercent: modeAdjustments.lateTimeAdjustmentPercent,
    earlyNextAdjustmentPercent: modeAdjustments.earlyNextAdjustmentPercent,
    areaCountAdjustmentPercent,
    legacyAreaJudgeAdjustmentPercent,
    otherAdjustments: {
      productPolicy: { ...PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT },
    },
    normalRateBeforeLimitsPercent,
    manyRateBeforeLimitsPercent,
    normalRateAfterBaseLimitsPercent,
    manyRateAfterBaseLimitsPercent,
    normalRatePercent,
    manyRatePercent,
    limits: getLimitFlags({
      normalBefore: normalRateBeforeLimitsPercent,
      manyBefore: manyRateBeforeLimitsPercent,
      normalAfterBase: normalRateAfterBaseLimitsPercent,
      manyAfterBase: manyRateAfterBaseLimitsPercent,
      earlyOffset: modeAdjustments.earlyNextAdjustmentPercent,
    }),
    displayedRatePercent: normalRatePercent,
    displayedRateText: display.normal.main,
    displayedNormalRatePercent: normalRatePercent,
    displayedManyRatePercent: manyRatePercent,
    display,
    resolvedWeather: cloneResolvedWeather(params.resolvedWeather)!,
  });
}

export function buildNormalRateDecisionSnapshot(
  params: BuildNormalRateDecisionSnapshotParams,
): RateDecisionSnapshot {
  return buildRateDecisionSnapshot({
    ...params,
    effectiveRateDiscountTime: params.sessionDiscountTime,
    calculationMode: "normal",
  });
}

export function buildLatePlus5RateDecisionSnapshot(
  params: BuildLatePlus5RateDecisionSnapshotParams,
): RateDecisionSnapshot {
  return buildRateDecisionSnapshot({
    ...params,
    effectiveRateDiscountTime: params.sessionDiscountTime,
    calculationMode: "late_plus5",
  });
}

export function buildEarlyNextMinus5RateDecisionSnapshot(
  params: BuildEarlyNextMinus5RateDecisionSnapshotParams,
): RateDecisionSnapshot {
  return buildRateDecisionSnapshot({
    ...params,
    calculationMode: "early_next_minus5",
  });
}

/** 20:30 の個数別ガイドを、その表示結果と一緒に固定保存する。 */
export function buildFinalDiscountGuideSnapshot(
  params: BuildFinalDiscountGuideSnapshotParams,
): RateDecisionSnapshot {
  if (!isValidTimestamp(params.confirmedAt)) {
    throw new TypeError("confirmedAt must be a valid timestamp");
  }
  const finalGuide = cloneFinalGuide(params.finalGuide);
  const resolvedWeather = cloneResolvedWeather(params.resolvedWeather);
  const weatherAdjustment = params.weatherComfortAdjustmentPercent ?? 0;
  if (!finalGuide || !resolvedWeather || !isFiniteNumber(weatherAdjustment)) {
    throw new TypeError("final snapshot input is invalid");
  }
  const normalRatePercent = parseDisplayRatePercent(finalGuide.count1.main)!;
  const manyRatePercent = parseDisplayRatePercent(
    finalGuide.count3OrMore.main,
  )!;

  return deepFreeze({
    version: 1,
    ...getCurrentDataVersionInfo(),
    confirmedAt: params.confirmedAt,
    sessionDiscountTime: "20",
    effectiveRateDiscountTime: "20",
    calculationMode: "final",
    rateLogicVersion: params.rateLogicVersion ?? "time_basic_rate_v1",
    basicRatePercent: 0,
    weatherComfortAdjustmentPercent: weatherAdjustment,
    lateTimeAdjustmentPercent: 0,
    earlyNextAdjustmentPercent: 0,
    areaCountAdjustmentPercent: 0,
    legacyAreaJudgeAdjustmentPercent: 0,
    otherAdjustments: {
      productPolicy: { ...PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT },
    },
    normalRateBeforeLimitsPercent: normalRatePercent,
    manyRateBeforeLimitsPercent: manyRatePercent,
    normalRateAfterBaseLimitsPercent: normalRatePercent,
    manyRateAfterBaseLimitsPercent: manyRatePercent,
    normalRatePercent,
    manyRatePercent,
    limits: {
      minimumPercent: MINIMUM_RATE_PERCENT,
      maximumPercent: MAXIMUM_RATE_PERCENT,
      normalLowerLimitApplied: false,
      normalUpperLimitApplied: false,
      manyLowerLimitApplied: false,
      manyUpperLimitApplied: false,
    },
    displayedRatePercent: normalRatePercent,
    displayedRateText: finalGuide.count1.main,
    displayedNormalRatePercent: normalRatePercent,
    displayedManyRatePercent: manyRatePercent,
    display: null,
    finalGuide,
    resolvedWeather,
  });
}

export const buildFinalRateDecisionSnapshot = buildFinalDiscountGuideSnapshot;

function isDiscountTime(value: unknown): value is DiscountTime {
  return ["15", "17", "18", "19", "20"].includes(String(value));
}

function isRateLogicVersion(value: unknown): value is RateLogicVersion {
  return value === "weekday_basis_v1" || value === "time_basic_rate_v1";
}

function isCalculationMode(
  value: unknown,
): value is RateDecisionCalculationMode {
  return (
    value === "normal" ||
    value === "late_plus5" ||
    value === "early_next_minus5" ||
    value === "final"
  );
}

function cloneLimits(raw: unknown): RateDecisionSnapshot["limits"] | undefined {
  if (!isRecord(raw)) return undefined;
  if (
    raw.minimumPercent !== MINIMUM_RATE_PERCENT ||
    raw.maximumPercent !== MAXIMUM_RATE_PERCENT ||
    typeof raw.normalLowerLimitApplied !== "boolean" ||
    typeof raw.normalUpperLimitApplied !== "boolean" ||
    typeof raw.manyLowerLimitApplied !== "boolean" ||
    typeof raw.manyUpperLimitApplied !== "boolean"
  ) {
    return undefined;
  }
  return {
    minimumPercent: MINIMUM_RATE_PERCENT,
    maximumPercent: MAXIMUM_RATE_PERCENT,
    normalLowerLimitApplied: raw.normalLowerLimitApplied,
    normalUpperLimitApplied: raw.normalUpperLimitApplied,
    manyLowerLimitApplied: raw.manyLowerLimitApplied,
    manyUpperLimitApplied: raw.manyUpperLimitApplied,
  };
}

function equalLimits(
  left: RateDecisionSnapshot["limits"],
  right: RateDecisionSnapshot["limits"],
): boolean {
  return (
    left.minimumPercent === right.minimumPercent &&
    left.maximumPercent === right.maximumPercent &&
    left.normalLowerLimitApplied === right.normalLowerLimitApplied &&
    left.normalUpperLimitApplied === right.normalUpperLimitApplied &&
    left.manyLowerLimitApplied === right.manyLowerLimitApplied &&
    left.manyUpperLimitApplied === right.manyUpperLimitApplied
  );
}

/**
 * 保存済み raw 値を厳密に検証する。旧データに完全なスナップショットが
 * なければ推測で補完せず undefined を返す。
 */
export function normalizeRateDecisionSnapshot(
  raw: unknown,
): RateDecisionSnapshot | undefined {
  if (!isRecord(raw) || raw.version !== 1) return undefined;
  if (
    !Number.isInteger(raw.dataSchemaVersion) ||
    !isFiniteNumber(raw.dataSchemaVersion) ||
    raw.dataSchemaVersion < 1 ||
    typeof raw.appVersion !== "string" ||
    !raw.appVersion.trim() ||
    typeof raw.buildId !== "string" ||
    !raw.buildId.trim() ||
    !isValidTimestamp(raw.confirmedAt) ||
    !isDiscountTime(raw.sessionDiscountTime) ||
    !isDiscountTime(raw.effectiveRateDiscountTime) ||
    !isCalculationMode(raw.calculationMode) ||
    !isRateLogicVersion(raw.rateLogicVersion)
  ) {
    return undefined;
  }

  const numericKeys = [
    "basicRatePercent",
    "weatherComfortAdjustmentPercent",
    "lateTimeAdjustmentPercent",
    "earlyNextAdjustmentPercent",
    "areaCountAdjustmentPercent",
    "legacyAreaJudgeAdjustmentPercent",
    "normalRateBeforeLimitsPercent",
    "manyRateBeforeLimitsPercent",
    "normalRateAfterBaseLimitsPercent",
    "manyRateAfterBaseLimitsPercent",
    "normalRatePercent",
    "manyRatePercent",
    "displayedRatePercent",
    "displayedNormalRatePercent",
    "displayedManyRatePercent",
  ] as const;
  if (numericKeys.some((key) => !isFiniteNumber(raw[key]))) return undefined;
  if (
    !isRecord(raw.otherAdjustments) ||
    !cloneProductPolicy(raw.otherAdjustments.productPolicy)
  ) {
    return undefined;
  }
  const limits = cloneLimits(raw.limits);
  const resolvedWeather = cloneResolvedWeather(raw.resolvedWeather);
  if (!limits || !resolvedWeather) return undefined;

  const baseFields = {
    version: 1 as const,
    dataSchemaVersion: raw.dataSchemaVersion,
    appVersion: raw.appVersion,
    buildId: raw.buildId,
    confirmedAt: raw.confirmedAt,
    sessionDiscountTime: raw.sessionDiscountTime,
    effectiveRateDiscountTime: raw.effectiveRateDiscountTime,
    calculationMode: raw.calculationMode,
    rateLogicVersion: raw.rateLogicVersion,
    basicRatePercent: raw.basicRatePercent as number,
    weatherComfortAdjustmentPercent:
      raw.weatherComfortAdjustmentPercent as number,
    lateTimeAdjustmentPercent: raw.lateTimeAdjustmentPercent as number,
    earlyNextAdjustmentPercent: raw.earlyNextAdjustmentPercent as number,
    areaCountAdjustmentPercent: raw.areaCountAdjustmentPercent as number,
    legacyAreaJudgeAdjustmentPercent:
      raw.legacyAreaJudgeAdjustmentPercent as number,
    otherAdjustments: {
      productPolicy: { ...PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT },
    },
    normalRateBeforeLimitsPercent: raw.normalRateBeforeLimitsPercent as number,
    manyRateBeforeLimitsPercent: raw.manyRateBeforeLimitsPercent as number,
    normalRateAfterBaseLimitsPercent:
      raw.normalRateAfterBaseLimitsPercent as number,
    manyRateAfterBaseLimitsPercent:
      raw.manyRateAfterBaseLimitsPercent as number,
    normalRatePercent: raw.normalRatePercent as number,
    manyRatePercent: raw.manyRatePercent as number,
    limits,
    displayedRatePercent: raw.displayedRatePercent as number,
    displayedRateText: raw.displayedRateText as string,
    displayedNormalRatePercent: raw.displayedNormalRatePercent as number,
    displayedManyRatePercent: raw.displayedManyRatePercent as number,
    resolvedWeather,
  };
  if (typeof baseFields.displayedRateText !== "string") return undefined;

  if (raw.calculationMode === "final") {
    const finalGuide = cloneFinalGuide(raw.finalGuide);
    const normalRate = finalGuide
      ? parseDisplayRatePercent(finalGuide.count1.main)
      : undefined;
    const manyRate = finalGuide
      ? parseDisplayRatePercent(finalGuide.count3OrMore.main)
      : undefined;
    if (
      raw.sessionDiscountTime !== "20" ||
      raw.effectiveRateDiscountTime !== "20" ||
      raw.display !== null ||
      !finalGuide ||
      normalRate === undefined ||
      manyRate === undefined ||
      raw.basicRatePercent !== 0 ||
      raw.lateTimeAdjustmentPercent !== 0 ||
      raw.earlyNextAdjustmentPercent !== 0 ||
      raw.areaCountAdjustmentPercent !== 0 ||
      raw.legacyAreaJudgeAdjustmentPercent !== 0 ||
      raw.normalRateBeforeLimitsPercent !== normalRate ||
      raw.manyRateBeforeLimitsPercent !== manyRate ||
      raw.normalRateAfterBaseLimitsPercent !== normalRate ||
      raw.manyRateAfterBaseLimitsPercent !== manyRate ||
      raw.normalRatePercent !== normalRate ||
      raw.manyRatePercent !== manyRate ||
      raw.displayedRatePercent !== normalRate ||
      raw.displayedNormalRatePercent !== normalRate ||
      raw.displayedManyRatePercent !== manyRate ||
      raw.displayedRateText !== finalGuide.count1.main ||
      !equalLimits(limits, {
        minimumPercent: 0,
        maximumPercent: 50,
        normalLowerLimitApplied: false,
        normalUpperLimitApplied: false,
        manyLowerLimitApplied: false,
        manyUpperLimitApplied: false,
      })
    ) {
      return undefined;
    }
    return deepFreeze({
      ...baseFields,
      calculationMode: "final",
      sessionDiscountTime: "20",
      effectiveRateDiscountTime: "20",
      display: null,
      finalGuide,
    });
  }

  if (
    raw.sessionDiscountTime === "20" ||
    raw.effectiveRateDiscountTime === "20" ||
    raw.finalGuide !== undefined
  ) {
    return undefined;
  }
  const display = cloneRateDisplay(raw.display);
  if (!display) return undefined;
  const modeAdjustments = getModeAdjustments(raw.calculationMode);
  const basicRate = getBaseRate(raw.effectiveRateDiscountTime);
  const normalBefore =
    basicRate +
    (raw.weatherComfortAdjustmentPercent as number) +
    modeAdjustments.lateTimeAdjustmentPercent +
    (raw.areaCountAdjustmentPercent as number) +
    (raw.legacyAreaJudgeAdjustmentPercent as number);
  const manyBefore = normalBefore + 10;
  const normalAfterBase = clampRate(normalBefore);
  const manyAfterBase = clampRate(manyBefore);
  const normalRate = clampRate(
    normalAfterBase + modeAdjustments.earlyNextAdjustmentPercent,
  );
  const manyRate = clampRate(
    manyAfterBase + modeAdjustments.earlyNextAdjustmentPercent,
  );
  const expectedLimits = getLimitFlags({
    normalBefore,
    manyBefore,
    normalAfterBase,
    manyAfterBase,
    earlyOffset: modeAdjustments.earlyNextAdjustmentPercent,
  });
  if (
    raw.basicRatePercent !== basicRate ||
    raw.lateTimeAdjustmentPercent !==
      modeAdjustments.lateTimeAdjustmentPercent ||
    raw.earlyNextAdjustmentPercent !==
      modeAdjustments.earlyNextAdjustmentPercent ||
    ![-10, -5, 0, 5, 10].includes(raw.areaCountAdjustmentPercent as number) ||
    ![-5, 0, 10].includes(raw.legacyAreaJudgeAdjustmentPercent as number) ||
    raw.normalRateBeforeLimitsPercent !== normalBefore ||
    raw.manyRateBeforeLimitsPercent !== manyBefore ||
    raw.normalRateAfterBaseLimitsPercent !== normalAfterBase ||
    raw.manyRateAfterBaseLimitsPercent !== manyAfterBase ||
    raw.normalRatePercent !== normalRate ||
    raw.manyRatePercent !== manyRate ||
    raw.displayedRatePercent !== normalRate ||
    raw.displayedNormalRatePercent !== normalRate ||
    raw.displayedManyRatePercent !== manyRate ||
    raw.displayedRateText !== display.normal.main ||
    parseDisplayRatePercent(display.normal.main) !== normalRate ||
    parseDisplayRatePercent(display.many.main) !== manyRate ||
    !equalLimits(limits, expectedLimits)
  ) {
    return undefined;
  }

  return deepFreeze({
    ...baseFields,
    calculationMode: raw.calculationMode,
    sessionDiscountTime: raw.sessionDiscountTime,
    effectiveRateDiscountTime: raw.effectiveRateDiscountTime,
    display,
  });
}

/** 保存済み表示を現在の時計やセッション basis から再計算せず再現する。 */
export function reconstructRateDisplayFromSnapshot(
  snapshot: RateDecisionSnapshot,
): RateDisplayData | null {
  if (snapshot.calculationMode === "final") return null;
  return snapshot.display ? cloneRateDisplay(snapshot.display) ?? null : null;
}

/** 最終値引ガイドも、保存されたスナップショットだけから再現する。 */
export function reconstructFinalGuideFromSnapshot(
  snapshot: RateDecisionSnapshot,
): FinalGuideData | undefined {
  return snapshot.calculationMode === "final"
    ? cloneFinalGuide(snapshot.finalGuide)
    : undefined;
}
