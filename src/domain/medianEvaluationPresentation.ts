import type { AreaCountEvaluation, AreaProgress } from "./types.ts";
import { evaluationText } from "./areaCountHistory.ts";

export type MedianEvaluationDisplay =
  | {
      status: "ready";
      evaluation: AreaCountEvaluation;
      text: string;
    }
  | {
      status: "insufficient" | "unavailable";
      evaluation: null;
      text: "履歴不足" | "取得できません";
    };

/**
 * 値引率表示用に、手動変更前の履歴中央値判定だけを取り出す。
 * 値引率や最終採用判定は再計算せず、判定時に保存済みの情報だけを使う。
 */
export function buildMedianEvaluationDisplay(
  progress: AreaProgress | null | undefined,
): MedianEvaluationDisplay | null {
  const basis = progress?.areaCountDecisionBasis;
  if (!basis || basis.recommendationStatus === "disabled") return null;

  if (basis.recommendationStatus === "insufficient") {
    return {
      status: "insufficient",
      evaluation: null,
      text: "履歴不足",
    };
  }

  const evaluation =
    progress.humanEvaluationDetails?.automaticEvaluation ??
    (progress.areaCountEvaluationSource === "history"
      ? progress.areaCountEvaluation
      : undefined);

  if (!evaluation) {
    return {
      status: "unavailable",
      evaluation: null,
      text: "取得できません",
    };
  }

  return {
    status: "ready",
    evaluation,
    text: evaluationText(evaluation),
  };
}
