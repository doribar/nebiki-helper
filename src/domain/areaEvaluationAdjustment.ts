import type {
  AreaCountEvaluation,
  AreaCountEvaluationSource,
  DemandCycle,
  DiscountTime,
  HumanEvaluationAdjustment,
} from "./types.ts";

export function canApplyManyToSlightlyManyAdjustment(params: {
  demandCycle: DemandCycle;
  discountTime: DiscountTime;
  automaticEvaluation?: AreaCountEvaluation;
  evaluationSource?: AreaCountEvaluationSource;
}): boolean {
  if (
    params.automaticEvaluation !== "many" ||
    params.evaluationSource !== "history"
  ) {
    return false;
  }

  return params.demandCycle === "summer"
    ? params.discountTime === "15" || params.discountTime === "17"
    : params.discountTime === "15";
}

export function createManyToSlightlyManyAdjustment(): HumanEvaluationAdjustment {
  return {
    applied: true,
    source: "human",
    direction: "lower",
    steps: 1,
    originalEvaluation: "many",
    finalEvaluation: "slightly_many",
  };
}
