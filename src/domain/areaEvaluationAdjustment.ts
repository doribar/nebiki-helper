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

/** 元の15/17時sessionに対応するJSTの下げ操作終了時刻までの時間。 */
export function getAreaEvaluationLowerQuickAdjustmentDelayMs(
  discountTime: DiscountTime,
  now: Date,
): number | null {
  const boundaryHour = discountTime === "15" ? 16 : discountTime === "17" ? 18 : null;
  if (boundaryHour === null) return null;
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const jst = new Date(timestamp + 9 * 60 * 60 * 1000);
  const elapsedMs = ((jst.getUTCHours() * 60 + jst.getUTCMinutes()) * 60
    + jst.getUTCSeconds()) * 1000 + jst.getUTCMilliseconds();
  return Math.max(0, boundaryHour * 60 * 60 * 1000 - elapsedMs);
}

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
  now: Date;
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
    if (direction === "lower"
      && getAreaEvaluationLowerQuickAdjustmentDelayMs(params.discountTime, params.now) === 0) {
      return [];
    }
    const adjustment = createAreaEvaluationQuickAdjustment(
      automatic.evaluation,
      direction,
    );
    return adjustment ? [adjustment] : [];
  });
}
