import { buildMedianEvaluationDisplay } from "./medianEvaluationPresentation.ts";
import type {
  AreaCountEvaluation,
  AreaProgress,
  DiscountTime,
  HumanEvaluationAdjustment,
  ScreenName,
} from "./types.ts";

const EVALUATIONS_ASCENDING: AreaCountEvaluation[] = [
  "few",
  "slightly_few",
  "normal",
  "slightly_many",
  "many",
];

export function createAreaEvaluationQuickAdjustment(
  originalEvaluation: AreaCountEvaluation,
  direction: HumanEvaluationAdjustment["direction"],
): HumanEvaluationAdjustment | null {
  const originalIndex = EVALUATIONS_ASCENDING.indexOf(originalEvaluation);
  if (originalIndex < 0) return null;
  const finalEvaluation = EVALUATIONS_ASCENDING[
    originalIndex + (direction === "lower" ? -1 : 1)
  ];
  if (!finalEvaluation) return null;

  return {
    applied: true,
    source: "human",
    direction,
    steps: 1,
    originalEvaluation,
    finalEvaluation,
  };
}

/** 保存済みの元の履歴自動判定を基準にする。採用判定から累積させない。 */
export function getAreaEvaluationQuickAdjustments(params: {
  screen: ScreenName;
  discountTime: DiscountTime;
  isTestMode: boolean;
  progress?: AreaProgress;
}): HumanEvaluationAdjustment[] {
  if (
    params.isTestMode ||
    params.screen !== "rate_display" ||
    params.discountTime === "20" ||
    typeof params.progress?.areaCount !== "number" ||
    params.progress.areaCountDecisionBasis?.recommendationStatus !== "ready"
  ) {
    return [];
  }

  const automatic = buildMedianEvaluationDisplay(params.progress);
  if (automatic?.status !== "ready") return [];

  return (["higher", "lower"] as const).flatMap((direction) => {
    const adjustment = createAreaEvaluationQuickAdjustment(
      automatic.evaluation,
      direction,
    );
    return adjustment ? [adjustment] : [];
  });
}
