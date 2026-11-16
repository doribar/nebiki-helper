import {
  getDecreaseRateAssessment,
  isAreaCountDecreaseComparisonEligible,
  type AreaCountDecisionBasis,
} from "./areaCountHistory.ts";
import type { AreaId, DiscountTime } from "./types";

/** Derived display context only; this is never part of a saved decision. */
export type AreaDecreaseDisplayContext = {
  areaId: AreaId;
  discountTime: DiscountTime;
  previousCount?: number;
};

export type AreaDecreaseDisplay = {
  previousCount?: number;
  currentCount: number;
  currentDecreaseRate?: number;
  medianDecreaseRate?: number;
  rateText: string;
  transitionText: string;
  medianText?: string;
  assessmentText:
    | "良い"
    | "普通"
    | "悪い"
    | "履歴不足"
    | "中央値未保存"
    | "中央値不正"
    | "比較データ不正"
    | "比較対象外"
    | "比較元なし"
    | "算出不可";
  statusText?: string;
  isIncrease: boolean;
};

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDisplayableRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    Number.isFinite(value * 100);
}

function formatPercent(rate: number): string {
  const rounded = (rate * 100).toFixed(1);
  return `${rounded === "-0.0" ? "0.0" : rounded.replace("-", "−")}％`;
}

/**
 * Present only the supplied decision and the current 15→17 count pair. Saved
 * pair evidence takes priority over a later history lookup, including invalid
 * evidence. The assessment comes from the captured raw direction, never the
 * rounded percentage. This reference display does not change an evaluation.
 */
export function getAreaDecreaseDisplay(params: {
  discountTime: DiscountTime | null | undefined;
  areaId: AreaId | null | undefined;
  areaCount: number | null | undefined;
  previousCount?: number | null;
  decreaseAdjustment?: AreaCountDecisionBasis["decreaseAdjustment"] | null;
}): AreaDecreaseDisplay | null {
  if (
    params.discountTime !== "17" || !params.areaId ||
    !isCount(params.areaCount)
  ) return null;

  const decrease = params.decreaseAdjustment;
  const hasCapturedPreviousCount = decrease?.previousCount !== undefined;
  const hasCapturedRate = decrease?.currentDecreaseRate !== undefined;
  const previousValue = hasCapturedPreviousCount
    ? decrease?.previousCount
    : hasCapturedRate
      ? undefined
      : params.previousCount;
  const previousCount = isCount(previousValue) ? previousValue : undefined;
  const invalidPrevious = previousValue !== undefined && !isCount(previousValue);
  const zeroPrevious = previousCount === 0;
  const invalidRate = hasCapturedRate && !isDisplayableRate(decrease?.currentDecreaseRate);
  const currentDecreaseRate = invalidPrevious || zeroPrevious || previousCount === undefined
    ? undefined
    : hasCapturedRate
      ? isDisplayableRate(decrease?.currentDecreaseRate)
        ? decrease.currentDecreaseRate
        : undefined
      : previousCount !== undefined && previousCount > 0
        ? (previousCount - params.areaCount) / previousCount
        : undefined;
  // Keep explicitly captured seasonal evidence readable without treating those
  // areas as eligible for a newly calculated comparison.
  const hasLegacySeasonalDecision = decrease?.mode === undefined &&
    decrease?.canUse === true && decrease.previousDiscountTime === "15" &&
    (params.areaId === "ryomi" || params.areaId === "autumn");
  const eligible = isAreaCountDecreaseComparisonEligible(params) || hasLegacySeasonalDecision;
  const hasCapturedDecision = eligible && decrease?.canUse === true;
  const hasValidPreviousTime = decrease?.previousDiscountTime === undefined ||
    decrease.previousDiscountTime === "15";
  const hasValidDirection = decrease?.direction === "more_many" ||
    decrease?.direction === "more_few" || decrease?.direction === "none";
  const hasValidMedian = isDisplayableRate(decrease?.medianDecreaseRate);
  const hasDecision = hasCapturedDecision && hasValidPreviousTime &&
    hasValidDirection && hasValidMedian && currentDecreaseRate !== undefined;
  const medianDecreaseRate = hasCapturedDecision && hasValidPreviousTime && hasValidMedian
    ? decrease.medianDecreaseRate
    : undefined;
  const unavailableAssessment = invalidPrevious || zeroPrevious || hasCapturedRate
    ? "算出不可" as const
    : "比較元なし" as const;
  const isIncrease = currentDecreaseRate !== undefined && currentDecreaseRate < 0;
  const capturedAssessment = getDecreaseRateAssessment(decrease);
  const comparisonAssessment = !eligible
    ? "比較対象外" as const
    : !hasCapturedDecision
      ? "履歴不足" as const
      : !hasValidPreviousTime || !hasValidDirection
        ? "比較データ不正" as const
        : decrease.medianDecreaseRate === undefined
          ? "中央値未保存" as const
          : !hasValidMedian
            ? "中央値不正" as const
            : hasDecision && capturedAssessment !== "判定なし"
              ? capturedAssessment
              : "比較データ不正" as const;
  const assessmentText = currentDecreaseRate === undefined
    ? unavailableAssessment
    : comparisonAssessment;
  const statusText = currentDecreaseRate !== undefined
    ? hasCapturedDecision && !hasValidPreviousTime
      ? "保存された比較元時刻が15時ではないため比較不可"
      : hasCapturedDecision && !hasValidDirection
        ? "保存された減少率判定が不正なため比較不可"
        : undefined
    : invalidPrevious
      ? "15時残数が不正なため算出不可"
      : zeroPrevious
        ? "15時残数が0個のため算出不可"
        : invalidRate
          ? "保存された減少率が不正なため算出不可"
          : hasCapturedRate
            ? "保存された15時残数がないため算出不可"
            : "15時残数がないため比較元なし";

  return {
    previousCount,
    currentCount: params.areaCount,
    currentDecreaseRate,
    medianDecreaseRate,
    rateText: currentDecreaseRate === undefined
      ? "算出不可"
      : formatPercent(currentDecreaseRate),
    transitionText: `15時${previousCount === undefined ? "不明" : `${previousCount}個`} → 17時${params.areaCount}個`,
    ...(eligible && currentDecreaseRate !== undefined
      ? {
          medianText: medianDecreaseRate === undefined
            ? !hasCapturedDecision
              ? "履歴中央値：履歴不足"
              : decrease.medianDecreaseRate === undefined
                ? "履歴中央値：未保存"
                : hasValidMedian ? "履歴中央値：比較不可" : "履歴中央値：不正"
            : `履歴中央値：${formatPercent(medianDecreaseRate)}`,
        }
      : {}),
    assessmentText,
    ...(statusText ? { statusText } : {}),
    isIncrease,
  };
}
