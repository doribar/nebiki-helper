export type TrainingStep =
  | "step1"
  | "step2"
  | "step3"
  | "step4"
  | "step5"
  | "step6"
  | "step7"
  | "step8";


export const TRAINING_STEPS: TrainingStep[] = [
  "step1",
  "step2",
  "step3",
  "step4",
  "step5",
  "step6",
  "step7",
  "step8",
];

export type NoticeItemId =
  | "oneLeftFew"
  | "twoLeftNotMany"
  | "step4TenOrMoreNotAlwaysMany"
  | "judgeIncludesTrend"
  | "badAppearancePlus"
  | "unpopularPlus"
  | "steadyStandardMinus"
  | "nightSellerMinus"
  | "advertisementTrendMinus";

export const STEP4_TEN_OR_MORE_NOTICE_TEXT =
  "10個以上あっても、必ず「多い」になるわけではありません。";

export type TrainingStepConfig = {
  step: TrainingStep;
  label: string;
  shortLabel: string;
  description: string;
  showManyProductRate: boolean;
  showManyThresholdRule: boolean;
  showFewProductRule: boolean;
  showProductAmountReference: boolean;
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
    showProductAmountReference: false,
    showAdvancedReference: false,
    noticeItemIds: [],
  },
  step2: {
    step: "step2",
    label: "ステップ2：曜日・時刻を基準に多い商品を強める",
    shortLabel: "多い商品+10%",
    description:
      "曜日・時刻を基準に多い商品を判断し、表示値引率より+10%で値引きします。",
    showManyProductRate: true,
    showManyThresholdRule: false,
    showFewProductRule: false,
    showProductAmountReference: true,
    showAdvancedReference: false,
    noticeItemIds: ["twoLeftNotMany"],
  },
  step3: {
    step: "step3",
    label: "ステップ3：多い・少ない・どちらでもないを分ける",
    shortLabel: "3分類",
    description:
      "商品の量を多い・少ない・どちらでもないに分け、画面に表示された値引指示を行います。",
    showManyProductRate: true,
    showManyThresholdRule: false,
    showFewProductRule: true,
    showProductAmountReference: true,
    showAdvancedReference: false,
    noticeItemIds: ["twoLeftNotMany", "oneLeftFew"],
  },
  step4: {
    step: "step4",
    label: "ステップ4：多い商品のうち10個以上をさらに強める",
    shortLabel: "多い中の10個以上",
    description:
      "まず多い商品を判断し、その中で10個以上ある商品だけをさらに+5%強めます。",
    showManyProductRate: true,
    showManyThresholdRule: true,
    showFewProductRule: true,
    showProductAmountReference: true,
    showAdvancedReference: false,
    noticeItemIds: [
      "twoLeftNotMany",
      "oneLeftFew",
      "step4TenOrMoreNotAlwaysMany",
    ],
  },
  step5: {
    step: "step5",
    label: "ステップ5：売れる商品を弱める",
    shortLabel: "売れる商品-10%",
    description:
      "定番商品・夜によく売れる商品は、表示値引率から-10%で調整します。",
    showManyProductRate: true,
    showManyThresholdRule: true,
    showFewProductRule: true,
    showProductAmountReference: true,
    showAdvancedReference: false,
    noticeItemIds: [
      "twoLeftNotMany",
      "oneLeftFew",
      "step4TenOrMoreNotAlwaysMany",
      "steadyStandardMinus",
      "nightSellerMinus",
    ],
  },
  step6: {
    step: "step6",
    label: "ステップ6：売れにくい商品を強める",
    shortLabel: "売れにくい商品+10%",
    description:
      "見た目が悪い商品・不人気商品は、表示値引率に+10%して調整します。",
    showManyProductRate: true,
    showManyThresholdRule: true,
    showFewProductRule: true,
    showProductAmountReference: true,
    showAdvancedReference: false,
    noticeItemIds: [
      "twoLeftNotMany",
      "oneLeftFew",
      "step4TenOrMoreNotAlwaysMany",
      "steadyStandardMinus",
      "nightSellerMinus",
      "badAppearancePlus",
      "unpopularPlus",
    ],
  },
  step7: {
    step: "step7",
    label: "ステップ7：今日の減り方を見る",
    shortLabel: "今日の減り方",
    description:
      "現在の残数だけでなく、前回の値引時刻からの商品の減り方も判断に含めます。",
    showManyProductRate: true,
    showManyThresholdRule: true,
    showFewProductRule: true,
    showProductAmountReference: true,
    showAdvancedReference: false,
    noticeItemIds: [
      "twoLeftNotMany",
      "oneLeftFew",
      "step4TenOrMoreNotAlwaysMany",
      "steadyStandardMinus",
      "nightSellerMinus",
      "badAppearancePlus",
      "unpopularPlus",
      "judgeIncludesTrend",
    ],
  },
  step8: {
    step: "step8",
    label: "ステップ8：広告商品の当日の動きまで見る",
    shortLabel: "全解禁",
    description:
      "広告商品の当日の売れ方まで含め、すべての判断基準を使います。",
    showManyProductRate: true,
    showManyThresholdRule: true,
    showFewProductRule: true,
    showProductAmountReference: true,
    showAdvancedReference: true,
    noticeItemIds: [
      "twoLeftNotMany",
      "oneLeftFew",
      "step4TenOrMoreNotAlwaysMany",
      "steadyStandardMinus",
      "nightSellerMinus",
      "badAppearancePlus",
      "unpopularPlus",
      "judgeIncludesTrend",
      "advertisementTrendMinus",
    ],
  },
};

export function getTrainingStepConfig(step: TrainingStep): TrainingStepConfig {
  return STEP_CONFIGS[step];
}

export function parseExplicitTrainingStepFromHash(
  hash: string,
): TrainingStep | null {
  const normalized = hash.replace(/^#\/?/, "").split(/[/?&]/)[0];
  return TRAINING_STEPS.find((step) => step === normalized) ?? null;
}

export function parseTrainingStepFromHash(hash: string): TrainingStep {
  // 互換用。明示的なstepがないURLは完成版step8として扱う。
  return parseExplicitTrainingStepFromHash(hash) ?? "step8";
}
