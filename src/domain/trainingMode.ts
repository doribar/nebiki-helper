export type TrainingStep = "step1" | "step2" | "step3" | "step4" | "step5";

export type NoticeItemId =
  | "oneLeftFew"
  | "twoLeftNotMany"
  | "judgeIncludesTrend"
  | "fewNoDiscountExceptFinal"
  | "badAppearancePlus"
  | "unpopularPlus"
  | "steadyStandardMinus"
  | "nightSellerMinus"
  | "advertisementTrendMinus";

export type TrainingStepConfig = {
  step: TrainingStep;
  label: string;
  shortLabel: string;
  description: string;
  showManyProductRate: boolean;
  showManyThresholdRule: boolean;
  showFewProductRule: boolean;
  showAdvancedReference: boolean;
  noticeItemIds: NoticeItemId[];
};

const STEP_CONFIGS: Record<TrainingStep, TrainingStepConfig> = {
  step1: {
    step: "step1",
    label: "ステップ1：一律値引",
    shortLabel: "一律",
    description: "エリアごとの表示値引率で一律に値引きします。",
    showManyProductRate: false,
    showManyThresholdRule: false,
    showFewProductRule: false,
    showAdvancedReference: false,
    noticeItemIds: [],
  },
  step2: {
    step: "step2",
    label: "ステップ2：多い商品だけ+10%",
    shortLabel: "多い商品+10%",
    description: "多い商品だけ、表示値引率より+10%で値引きします。",
    showManyProductRate: true,
    showManyThresholdRule: false,
    showFewProductRule: false,
    showAdvancedReference: false,
    noticeItemIds: ["twoLeftNotMany"],
  },
  step3: {
    step: "step3",
    label: "ステップ3：少ない商品は値引かない",
    shortLabel: "少ない商品除外",
    description: "10個以上の商品は+15%、多い商品は+10%、少ない商品は値引きしません。",
    showManyProductRate: true,
    showManyThresholdRule: true,
    showFewProductRule: true,
    showAdvancedReference: false,
    noticeItemIds: [
      "twoLeftNotMany",
      "oneLeftFew",
      "fewNoDiscountExceptFinal",
    ],
  },
  step4: {
    step: "step4",
    label: "ステップ4：個別に±10%",
    shortLabel: "個別±10%",
    description: "見た目が悪い商品・不人気商品は+10%、定番商品・夜売れる商品は-10%で調整します。",
    showManyProductRate: true,
    showManyThresholdRule: true,
    showFewProductRule: true,
    showAdvancedReference: false,
    noticeItemIds: [
      "twoLeftNotMany",
      "oneLeftFew",
      "fewNoDiscountExceptFinal",
      "badAppearancePlus",
      "unpopularPlus",
      "steadyStandardMinus",
      "nightSellerMinus",
    ],
  },
  step5: {
    step: "step5",
    label: "ステップ5：全解禁",
    shortLabel: "全解禁",
    description: "曜日・時刻の基準、広告商品の当日の売れ方まで含めて判断します。",
    showManyProductRate: true,
    showManyThresholdRule: true,
    showFewProductRule: true,
    showAdvancedReference: true,
    noticeItemIds: [
      "twoLeftNotMany",
      "oneLeftFew",
      "fewNoDiscountExceptFinal",
      "badAppearancePlus",
      "unpopularPlus",
      "steadyStandardMinus",
      "nightSellerMinus",
      "judgeIncludesTrend",
      "advertisementTrendMinus",
    ],
  },
};

export function getTrainingStepConfig(step: TrainingStep): TrainingStepConfig {
  return STEP_CONFIGS[step];
}

export function parseTrainingStepFromHash(hash: string): TrainingStep {
  const normalized = hash.replace(/^#\/?/, "").split(/[/?&]/)[0];

  if (normalized === "step1") return "step1";
  if (normalized === "step2") return "step2";
  if (normalized === "step3") return "step3";
  if (normalized === "step4") return "step4";
  if (normalized === "step5") return "step5";

  // 既存URLは、これまで作り込んできた完成版として扱う。
  return "step5";
}
