export type TrainingStep = "step1" | "step2" | "step3" | "step4" | "step5";

export type NoticeItemId =
  | "oneLeftFew"
  | "twoLeftNotMany"
  | "judgeIncludesTrend"
  | "fewNoDiscountExceptFinal"
  | "badAppearancePlus"
  | "unpopularPlus"
  | "steadyStandardMinus"
  | "nightSellerMinus";

export type TrainingStepConfig = {
  step: TrainingStep;
  label: string;
  shortLabel: string;
  description: string;
  showManyProductRate: boolean;
  showFewProductRule: boolean;
  noticeItemIds: NoticeItemId[];
};

const STEP_CONFIGS: Record<TrainingStep, TrainingStepConfig> = {
  step1: {
    step: "step1",
    label: "ステップ1：エリア一律値引",
    shortLabel: "エリア一律",
    description: "エリアごとの表示値引率で一律に値引きします。",
    showManyProductRate: false,
    showFewProductRule: false,
    noticeItemIds: [],
  },
  step2: {
    step: "step2",
    label: "ステップ2：多い商品だけ+10%",
    shortLabel: "多い商品+10%",
    description: "表示値引率を基本に、多い商品だけ+10%で値引きします。",
    showManyProductRate: true,
    showFewProductRule: false,
    noticeItemIds: ["twoLeftNotMany", "judgeIncludesTrend"],
  },
  step3: {
    step: "step3",
    label: "ステップ3：少ない商品を引かない",
    shortLabel: "少ない商品除外",
    description: "多い商品は+10%、少ない商品は最終値引以外では引きません。",
    showManyProductRate: true,
    showFewProductRule: true,
    noticeItemIds: [
      "twoLeftNotMany",
      "judgeIncludesTrend",
      "oneLeftFew",
      "fewNoDiscountExceptFinal",
    ],
  },
  step4: {
    step: "step4",
    label: "ステップ4：プラス注意事項まで",
    shortLabel: "プラス注意事項",
    description: "見た目が悪い商品・不人気な商品を強める判断まで使います。",
    showManyProductRate: true,
    showFewProductRule: true,
    noticeItemIds: [
      "twoLeftNotMany",
      "judgeIncludesTrend",
      "oneLeftFew",
      "fewNoDiscountExceptFinal",
      "badAppearancePlus",
      "unpopularPlus",
    ],
  },
  step5: {
    step: "step5",
    label: "ステップ5：全注意事項",
    shortLabel: "全注意事項",
    description: "プラス方面・マイナス方面を含む全注意事項を使います。",
    showManyProductRate: true,
    showFewProductRule: true,
    noticeItemIds: [
      "twoLeftNotMany",
      "judgeIncludesTrend",
      "oneLeftFew",
      "fewNoDiscountExceptFinal",
      "badAppearancePlus",
      "unpopularPlus",
      "steadyStandardMinus",
      "nightSellerMinus",
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
