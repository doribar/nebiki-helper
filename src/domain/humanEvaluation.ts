import type {
  AreaCountEvaluation,
  DemandCycle,
  DiscountTime,
  HumanEvaluationDetails,
  HumanEvaluationResolutionDirection,
  HumanEvaluationResolutionReason,
  HumanEvaluationScore9,
  HumanEvaluationSelection,
} from "./types.ts";

export const HUMAN_EVALUATION_LONG_PRESS_MS = 500;

const EVALUATIONS_ASCENDING: AreaCountEvaluation[] = [
  "few",
  "slightly_few",
  "normal",
  "slightly_many",
  "many",
];

const ODD_SCORE_BY_EVALUATION: Record<AreaCountEvaluation, HumanEvaluationScore9> = {
  few: 1,
  slightly_few: 3,
  normal: 5,
  slightly_many: 7,
  many: 9,
};

function isAreaCountEvaluation(value: unknown): value is AreaCountEvaluation {
  return EVALUATIONS_ASCENDING.includes(value as AreaCountEvaluation);
}

function isHumanEvaluationScore9(value: unknown): value is HumanEvaluationScore9 {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 9;
}

function getEvaluationIndex(value: AreaCountEvaluation): number {
  return EVALUATIONS_ASCENDING.indexOf(value);
}

export function areHumanEvaluationsAdjacent(
  first: AreaCountEvaluation,
  second: AreaCountEvaluation,
): boolean {
  return Math.abs(getEvaluationIndex(first) - getEvaluationIndex(second)) === 1;
}

export function getHumanEvaluationSecondChoices(
  first: AreaCountEvaluation,
): AreaCountEvaluation[] {
  const index = getEvaluationIndex(first);
  return EVALUATIONS_ASCENDING.filter((_, candidateIndex) =>
    candidateIndex === index || Math.abs(candidateIndex - index) === 1
  );
}

export function createHumanEvaluationSelection(
  first: AreaCountEvaluation,
  second?: AreaCountEvaluation,
): HumanEvaluationSelection | null {
  if (second === undefined || second === first) {
    return {
      humanEvaluationScore9: ODD_SCORE_BY_EVALUATION[first],
      humanEvaluationSelections: [first],
    };
  }
  if (!areHumanEvaluationsAdjacent(first, second)) return null;

  const firstIndex = getEvaluationIndex(first);
  const secondIndex = getEvaluationIndex(second);
  return {
    humanEvaluationScore9: (Math.min(firstIndex, secondIndex) * 2 + 2) as HumanEvaluationScore9,
    humanEvaluationSelections: [first, second],
  };
}

export function getEvaluationFromOddHumanScore(
  score: HumanEvaluationScore9,
): AreaCountEvaluation | null {
  if (score % 2 === 0) return null;
  return EVALUATIONS_ASCENDING[(score - 1) / 2] ?? null;
}

export function getLegacyHumanEvaluationDetails(
  evaluation: AreaCountEvaluation,
): HumanEvaluationDetails {
  return {
    humanEvaluationScore9: ODD_SCORE_BY_EVALUATION[evaluation],
    humanEvaluationScale: 5,
    humanEvaluationSelections: [evaluation],
    resolvedEvaluation: evaluation,
    resolutionDirection: "none",
    resolutionReason: "legacy_5_level",
  };
}

export function normalizeHumanEvaluationDetails(
  raw: unknown,
): HumanEvaluationDetails | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Partial<HumanEvaluationDetails>;
  if (!isHumanEvaluationScore9(source.humanEvaluationScore9)) return undefined;
  if (source.humanEvaluationScale !== 5 && source.humanEvaluationScale !== 9) {
    return undefined;
  }
  if (!Array.isArray(source.humanEvaluationSelections)) return undefined;
  if (
    source.humanEvaluationSelections.length < 1 ||
    source.humanEvaluationSelections.length > 2 ||
    !source.humanEvaluationSelections.every(isAreaCountEvaluation)
  ) {
    return undefined;
  }

  const first = source.humanEvaluationSelections[0];
  const second = source.humanEvaluationSelections[1];
  const normalizedSelection = createHumanEvaluationSelection(first, second);
  if (
    !normalizedSelection ||
    normalizedSelection.humanEvaluationScore9 !== source.humanEvaluationScore9 ||
    (source.humanEvaluationScale === 5 && normalizedSelection.humanEvaluationSelections.length !== 1)
  ) {
    return undefined;
  }

  const validDirections: HumanEvaluationResolutionDirection[] = [
    "none",
    "lower",
    "higher",
    "not_applicable",
  ];
  const validReasons: HumanEvaluationResolutionReason[] = [
    "single_selection",
    "normal_15",
    "normal_17_or_later",
    "summer_before_1800",
    "summer_1800_or_later",
    "review19_observation",
    "legacy_5_level",
  ];
  if (
    !validDirections.includes(source.resolutionDirection as HumanEvaluationResolutionDirection) ||
    !validReasons.includes(source.resolutionReason as HumanEvaluationResolutionReason)
  ) {
    return undefined;
  }

  const resolvedEvaluation = isAreaCountEvaluation(source.resolvedEvaluation)
    ? source.resolvedEvaluation
    : undefined;
  const evaluatedAt =
    typeof source.evaluatedAt === "string" &&
    source.evaluatedAt.trim() &&
    Number.isFinite(Date.parse(source.evaluatedAt))
      ? source.evaluatedAt
      : undefined;
  const sessionDiscountTime =
    source.sessionDiscountTime === "15" ||
    source.sessionDiscountTime === "17" ||
    source.sessionDiscountTime === "18" ||
    source.sessionDiscountTime === "19" ||
    source.sessionDiscountTime === "20"
      ? source.sessionDiscountTime
      : undefined;
  const demandCycle =
    source.demandCycle === "summer" || source.demandCycle === "normal"
      ? source.demandCycle
      : undefined;
  const resolutionDirection =
    source.resolutionDirection as HumanEvaluationResolutionDirection;
  const resolutionReason = source.resolutionReason as HumanEvaluationResolutionReason;
  const selectedIndexes = normalizedSelection.humanEvaluationSelections.map(
    getEvaluationIndex,
  );
  const lowerEvaluation = EVALUATIONS_ASCENDING[Math.min(...selectedIndexes)];
  const higherEvaluation = EVALUATIONS_ASCENDING[Math.max(...selectedIndexes)];

  if (source.humanEvaluationScale === 5) {
    if (
      normalizedSelection.humanEvaluationSelections.length !== 1 ||
      resolutionReason !== "legacy_5_level" ||
      resolutionDirection !== "none" ||
      resolvedEvaluation !== normalizedSelection.humanEvaluationSelections[0]
    ) {
      return undefined;
    }
  } else {
    if (!evaluatedAt || !demandCycle || !sessionDiscountTime) return undefined;
    if (resolutionReason === "review19_observation") {
      if (
        resolutionDirection !== "not_applicable" ||
        resolvedEvaluation !== undefined ||
        sessionDiscountTime !== "19"
      ) {
        return undefined;
      }
    } else if (resolutionReason === "single_selection") {
      if (
        normalizedSelection.humanEvaluationSelections.length !== 1 ||
        resolutionDirection !== "none" ||
        resolvedEvaluation !== normalizedSelection.humanEvaluationSelections[0]
      ) {
        return undefined;
      }
    } else {
      if (
        normalizedSelection.humanEvaluationSelections.length !== 2 ||
        !["lower", "higher"].includes(resolutionDirection) ||
        resolvedEvaluation !==
          (resolutionDirection === "lower" ? lowerEvaluation : higherEvaluation)
      ) {
        return undefined;
      }
      if (
        (resolutionReason === "normal_15" &&
          (demandCycle !== "normal" ||
            sessionDiscountTime !== "15" ||
            resolutionDirection !== "lower")) ||
        (resolutionReason === "normal_17_or_later" &&
          (demandCycle !== "normal" ||
            sessionDiscountTime === "15" ||
            resolutionDirection !== "higher")) ||
        (resolutionReason === "summer_before_1800" &&
          (demandCycle !== "summer" || resolutionDirection !== "lower")) ||
        (resolutionReason === "summer_1800_or_later" &&
          (demandCycle !== "summer" || resolutionDirection !== "higher")) ||
        resolutionReason === "legacy_5_level"
      ) {
        return undefined;
      }

      if (
        (resolutionReason === "summer_before_1800" ||
          resolutionReason === "summer_1800_or_later") &&
        evaluatedAt
      ) {
        const evaluatedAtMs = Date.parse(evaluatedAt);
        const isBefore1800Jst = getJstMinutes(evaluatedAtMs) < 18 * 60;
        if (
          (resolutionReason === "summer_before_1800" && !isBefore1800Jst) ||
          (resolutionReason === "summer_1800_or_later" && isBefore1800Jst)
        ) {
          return undefined;
        }
      }
    }
  }

  return {
    humanEvaluationScore9: source.humanEvaluationScore9,
    humanEvaluationScale: source.humanEvaluationScale,
    humanEvaluationSelections: normalizedSelection.humanEvaluationSelections,
    automaticEvaluation: isAreaCountEvaluation(source.automaticEvaluation)
      ? source.automaticEvaluation
      : undefined,
    resolvedEvaluation,
    resolutionDirection,
    resolutionReason,
    demandCycle,
    evaluatedAt,
    sessionDiscountTime,
  };
}

export function resolveHumanEvaluationDetails(
  humanEvaluationDetails: unknown,
  legacyEvaluation?: AreaCountEvaluation,
): HumanEvaluationDetails | undefined {
  return (
    normalizeHumanEvaluationDetails(humanEvaluationDetails) ??
    (legacyEvaluation ? getLegacyHumanEvaluationDetails(legacyEvaluation) : undefined)
  );
}

function getJstMinutes(nowMs: number): number {
  const jst = new Date(nowMs + 9 * 60 * 60 * 1000);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

export function resolveHumanEvaluationForDiscount(params: {
  selection: HumanEvaluationSelection;
  demandCycle: DemandCycle;
  sessionDiscountTime: DiscountTime;
  nowMs: number;
  evaluatedAt: string;
}): HumanEvaluationDetails {
  const oddEvaluation = getEvaluationFromOddHumanScore(
    params.selection.humanEvaluationScore9,
  );
  if (oddEvaluation) {
    return {
      ...params.selection,
      humanEvaluationScale: 9,
      resolvedEvaluation: oddEvaluation,
      resolutionDirection: "none",
      resolutionReason: "single_selection",
      demandCycle: params.demandCycle,
      evaluatedAt: params.evaluatedAt,
      sessionDiscountTime: params.sessionDiscountTime,
    };
  }

  const useLower = params.demandCycle === "summer"
    ? getJstMinutes(params.nowMs) < 18 * 60
    : params.sessionDiscountTime === "15";
  const lowerIndex = Math.floor((params.selection.humanEvaluationScore9 - 1) / 2);
  const resolvedEvaluation = EVALUATIONS_ASCENDING[
    useLower ? lowerIndex : lowerIndex + 1
  ];
  const resolutionReason: HumanEvaluationResolutionReason =
    params.demandCycle === "summer"
      ? useLower
        ? "summer_before_1800"
        : "summer_1800_or_later"
      : useLower
        ? "normal_15"
        : "normal_17_or_later";

  return {
    ...params.selection,
    humanEvaluationScale: 9,
    resolvedEvaluation,
    resolutionDirection: useLower ? "lower" : "higher",
    resolutionReason,
    demandCycle: params.demandCycle,
    evaluatedAt: params.evaluatedAt,
    sessionDiscountTime: params.sessionDiscountTime,
  };
}

export function createReview19HumanEvaluationDetails(params: {
  selection: HumanEvaluationSelection;
  demandCycle: DemandCycle;
  evaluatedAt: string;
}): HumanEvaluationDetails {
  return {
    ...params.selection,
    humanEvaluationScale: 9,
    resolutionDirection: "not_applicable",
    resolutionReason: "review19_observation",
    demandCycle: params.demandCycle,
    evaluatedAt: params.evaluatedAt,
    sessionDiscountTime: "19",
  };
}

export function getHumanEvaluationRangeLabel(
  details: HumanEvaluationDetails,
  getLabel: (evaluation: AreaCountEvaluation) => string,
): string {
  return details.humanEvaluationSelections.map(getLabel).join("〜");
}
