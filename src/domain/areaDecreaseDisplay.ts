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
    | "増加"
    | "履歴不足"
    | "補正対象外"
    | "比較元なし"
    | "算出不可";
  contextText?: "履歴不足" | "補正対象外";
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
 * evidence. Neither a displayed rate nor a rounded value can enable correction.
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
  const invalidPrevious = previousValue !== undefined &&
    (!isCount(previousValue) || previousValue === 0);
  const currentDecreaseRate = invalidPrevious || previousCount === undefined
    ? undefined
    : hasCapturedRate
      ? isDisplayableRate(decrease?.currentDecreaseRate)
        ? decrease.currentDecreaseRate
        : undefined
      : previousCount !== undefined && previousCount > 0
        ? (previousCount - params.areaCount) / previousCount
        : undefined;
  const eligible = isAreaCountDecreaseComparisonEligible(params);
  const hasDecision = eligible && decrease?.canUse === true;
  const medianDecreaseRate = hasDecision && isDisplayableRate(decrease.medianDecreaseRate)
    ? decrease.medianDecreaseRate
    : undefined;
  const unavailableAssessment = invalidPrevious || hasCapturedRate
    ? "算出不可" as const
    : "比較元なし" as const;
  const isIncrease = currentDecreaseRate !== undefined && currentDecreaseRate < 0;
  const capturedAssessment = getDecreaseRateAssessment(decrease);
  const comparisonAssessment = !eligible
    ? "補正対象外" as const
    : hasDecision && capturedAssessment !== "判定なし"
      ? capturedAssessment
      : "履歴不足" as const;
  const assessmentText = currentDecreaseRate === undefined
    ? unavailableAssessment
    : isIncrease
      ? "増加" as const
      : comparisonAssessment;

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
            ? hasDecision ? "履歴中央値：未保存" : "履歴中央値：履歴不足"
            : `履歴中央値：${formatPercent(medianDecreaseRate)}`,
        }
      : {}),
    assessmentText,
    ...(isIncrease && (comparisonAssessment === "補正対象外" || comparisonAssessment === "履歴不足")
      ? { contextText: comparisonAssessment }
      : {}),
    isIncrease,
  };
}
