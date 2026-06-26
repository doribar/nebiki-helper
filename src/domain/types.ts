import type { AreaCountRecommendation } from "./areaCountHistory.ts";
import type { TrainingStep, TrainingStepConfig } from "./trainingMode.ts";
export type DiscountTime = "15" | "17" | "18" | "19" | "20";

export type AreaId =
  | "hosomaki"
  | "inari"
  | "futomaki_chumaki"
  | "sushi"
  | "onigiri"
  | "balance_bento" // legacy: older saved data
  | "ryomi"
  | "chuka_fish"
  | "yakitori"
  | "fry_chicken"
  | "croquette"
  | "tempura"
  | "bento_men";

  export type NextSessionSkipRecord = {
  date: string;
  targetDiscountTime: "18" | "19";
  areaId: AreaId;
  previousRateText?: string;
  previousManyRateText?: string;
  previousManyNote?: string;
  previousNormalRateText?: string;
};

export type AreaMaster = {
  id: AreaId;
  name: string;
  order: number;
};

export type WindLevel = "2orLess" | "3to4" | "5orMore";
export type TempLevel =
  | "5orLess"
  | "6to10"
  | "11to15"
  | "16to20"
  | "21to25"
  | "26to27"
  | "28to30"
  | "26to30" // legacy: old saved/legacy 26〜30 bucket
  | "31to35"
  | "36orMore";

export type ForecastHourKey = "15" | "16" | "17" | "18" | "19" | "20" | "21";
export type ForecastWeatherKind = "sunny" | "rain" | "snow";

export type HourlyForecastEntry = {
  weather: ForecastWeatherKind;
  tempC: number;
  windMs: number;
};

export type HourlyForecastMap = Record<ForecastHourKey, HourlyForecastEntry>;

export type WeatherInput = {
  hourlyForecasts: HourlyForecastMap;
  afterRainSky: AfterRainSky;
};

export type ResolvedWeatherInput = {
  nearTermWeather: NearTermWeather;
  hasLaterPrecip: boolean;
  laterPrecipType: LaterPrecipType;
  precipitationRateBonus: number;
  precipitationRateBonusLabel: string | null;
  windLevel: WindLevel;
  tempLevel: TempLevel;
  weatherPointScore: number;
  weatherPointShift: -2 | -1 | 0 | 1 | 2;
  weatherPointRangeText: string | null;
  // legacy compatibility: old 15時→18時の単発補正は天候ポイント制へ移行済み
  next18TempDropShift: -1 | 0 | 1;
  next18WindWorsenShift: 0 | 1 | 2;
  next18WindWorsenKind: 'cold' | null;
  afterRainSky: AfterRainSky;
};

export type SessionDraft = {
  date: string;
  weekday: number;
  discountTime: DiscountTime;
  manualWeekdayOverride: boolean;
  manualDiscountTimeOverride: boolean;
  /**
   * 天候入力中に自動時刻が次の値引帯へ進んでも、
   * 入力した時刻のまま開始するための一時ロック。
   * 手動切替とは別扱いなので、実時間による遅れ補正は従来どおり使える。
   */
  weatherInputLockedDiscountTime?: DiscountTime | null;
  weather: WeatherInput;
};

export type SessionData = SessionDraft & {
  startedAt: string;
};

export type AreaJudge = "many" | "normal" | "few" | null;

export type AreaStatus =
  | "unstarted"
  | "completed"
  | "skipped_manual"
  | "postponed_few"
  | "auto_skipped_late_time";

export type AreaProgress = {
  areaId: AreaId;
  status: AreaStatus;
  areaJudge: AreaJudge;
  areaCount?: number;
  areaCountEvaluation?: AreaCountEvaluation;
  areaRateAdjustment?: AreaRateAdjustment;
  visitedAt?: string;
  completedAt?: string;
  skipReason?: "manual" | "few" | "late_time";
  completedRateText?: string;
  completedManyRateText?: string;
  completedManyNote?: string;
  completedNormalRateText?: string;
  previousRateText?: string;
  previousManyRateText?: string;
  previousManyNote?: string;
  previousNormalRateText?: string;
};


export type ScreenName =
  | "start"
  | "review19_weather"
  | "review19_done"
  | "area_judge"
  | "auto_skip_notice"
  | "rate_display"
  | "final_time"
  | "review19"
  | "done";

export type FlowMode = "normal" | "pending";

export type WeekdayBaseLabel = "日" | "金土" | "火木" | "月水";
export type ActualWeekdayLabel = "日" | "月" | "火" | "水" | "木" | "金" | "土";
export type ActualWeekdayGroup = "月水" | "火木" | "金土日";
export type AreaCountEvaluation = "many" | "slightly_many" | "normal" | "slightly_few" | "few";
export type AreaRateAdjustment = -10 | -5 | 0 | 5 | 10;

export type AreaCountMigrationResult = {
  ok: boolean;
  message: string;
};

export type WeekdayBaseInfo = {
  original: WeekdayBaseLabel;
  adjusted: WeekdayBaseLabel;
  changedByWeather: boolean;
  weekdayShift: number;
  baseRateBonus: number;
  baseRateBonusReason: string[];
};

export type BasisGuideDisplay = {
  noticeText?: string;
  weekdaySummaryText?: string;
  weekdayDetailLines?: string[];
  bonusSummaryText?: string;
  bonusDetailLines?: string[];
  weekdayCalcText?: string;
  weekdayResultText?: string;
  bonusCalcText?: string;
  bonusResultText?: string;
  bonusCalcParts?: string[];
  bonusTotal?: number;
  referenceText: string;
};

export type RateLine = {
  main: string;
  note?: string;
};

export type RateDisplayData = {
  many: RateLine;
  few: RateLine;
  normal: RateLine;
};

export type FinalGuideData = {
  count1: RateLine;
  count2: RateLine;
  count3OrMore: RateLine;
  score: number;
  scoreThreshold: number;
  scoreBreakdown: {
    weekdayShiftPoints: number;
    rateBonusPoints: number;
  };
};

export type PendingReason = "manual" | "few";

export type PendingAreaCandidate = {
  areaId: AreaId;
  areaName: string;
  reason: PendingReason;
};

export type PendingBannerInfo = {
  remainingCount: number;
  reason: PendingReason;
};

export type SkipTargetOption = {
  areaId: AreaId;
  areaName: string;
  resumeScreen: "area_judge" | "rate_display";
  status: AreaStatus;
};

export type DoneSummaryItem = {
  areaId: AreaId;
  areaName: string;
  judgeText: string;
  rateText: string;
  note?: string;
  manyRateText?: string;
  manyNote?: string;
  normalRateText?: string;
  statusText?: string;
};

export type DoneNextSessionInfo = {
  label: string;
  canStart: boolean;
  unlockText: string | null;
  targetDiscountTime: DiscountTime;
};

export type WeatherGuideText = {
  nearTermWeatherGuide: string;
  laterPrecipGuide: string;
  laterPrecipTypeGuide: string;
  windGuide: string;
  tempGuide: string;
};

export type LastSessionWeatherRecord = {
  date: string;
  discountTime: DiscountTime;
  nearTermWeather: NearTermWeather;
};

export type FinalTimeStep = 0 | 1 | 2 | 3;

export type DailyMessageState = {
  bentoJudgeGuideShownDate: string | null;
  rateNoticeShownDate: string | null;
};

export type Review19Rating =
  | "decreased_too_much"
  | "decreased_slightly_too_much"
  | "just_right"
  | "remained_slightly_too_much"
  | "remained_too_much";

export type Review19RatingScore = -2 | -1 | 0 | 1 | 2;

export type Review19ExcludeReason = "few_at_15" | "few_at_15_and_17";

export type Review19AreaSnapshot = {
  areaId: AreaId;
  areaName: string;
  reviewExcluded?: boolean;
  reviewExcludeReason?: Review19ExcludeReason;
  status: AreaStatus;
  statusText?: string;
  areaJudge: AreaJudge;
  areaCount?: number;
  judgeText: string;
  rateText: string;
  ratePercent?: number;
  manyRateText?: string;
  manyRatePercent?: number;
  manyNote?: string;
  normalRateText?: string;
  normalRatePercent?: number;
  visitedAt?: string;
  completedAt?: string;
  skipReason?: "manual" | "few" | "late_time";
};

export type Review19Reference = {
  date: string;
  weekday: number;
  discountTime: "19";
  weather: WeatherInput;
  resolvedWeather: ResolvedWeatherInput;
  basis: {
    originalWeekdayBase: WeekdayBaseLabel;
    adjustedWeekdayBase: WeekdayBaseLabel;
    weekdayShift: number;
    baseRateBonus: number;
    baseRateBonusReason: string[];
    noticeText?: string;
    weekdaySummaryText?: string;
    weekdayCalcText?: string;
    weekdayResultText?: string;
    bonusSummaryText?: string;
    bonusCalcText?: string;
    bonusResultText?: string;
  };
};

export type Review19Snapshot = {
  version: 1;
  capturedAt: string;
  session: {
    date: string;
    weekday: number;
    discountTime: DiscountTime;
    startedAt: string;
    manualWeekdayOverride: boolean;
    manualDiscountTimeOverride: boolean;
    weather: WeatherInput;
    resolvedWeather: ResolvedWeatherInput;
  };
  basis: {
    originalWeekdayBase: WeekdayBaseLabel;
    adjustedWeekdayBase: WeekdayBaseLabel;
    weekdayShift: number;
    baseRateBonus: number;
    lateTimeBonus: number;
    totalRateBonus: number;
    baseRateBonusReason: string[];
    noticeText?: string;
    weekdaySummaryText?: string;
    weekdayCalcText?: string;
    weekdayResultText?: string;
    bonusSummaryText?: string;
    bonusCalcText?: string;
    bonusResultText?: string;
  };
  areas: Record<AreaId, Review19AreaSnapshot>;
  reviewReference?: Review19Reference;
};

export type Review19Result = {
  date: string;
  sessionStartedAt: string;
  ratings: Record<AreaId, Review19Rating>;
  ratingScores: Record<AreaId, Review19RatingScore>;
  excludedAreaIds: AreaId[];
  excludeReasons: Partial<Record<AreaId, Review19ExcludeReason>>;
  recordedAt?: string;
  exportedAt?: string;
  reference?: Review19Reference;
  snapshot?: Review19Snapshot;
};

export type Review19AreaItem = {
  areaId: AreaId;
  areaName: string;
  rating: Review19Rating;
  excluded: boolean;
  excludeReasonText?: string;
};

export type AppState = {
  screen: ScreenName;
  session: SessionData | null;
  sessionDraft: SessionDraft;
  areaProgressMap: Record<AreaId, AreaProgress>;
  currentAreaId: AreaId | null;
  lastReferenceAreaId: AreaId | null;
  currentFlow: FlowMode;
  pendingDeferredAreaIds: AreaId[];
  timeSwitchNotice: string | null;
  finalTimeStep: FinalTimeStep;
  review19: Review19Result | null;
  review19ExcludedAreaIds: AreaId[];
};

export type UseNebikiAppDerived = {
  trainingStep: TrainingStep;
  trainingStepConfig: TrainingStepConfig;
  currentAreaName: string | null;
  weekdayText: string;
  timeText: string;
  basisGuide: BasisGuideDisplay;
  weatherGuideText: WeatherGuideText;
  rateDisplay: RateDisplayData | null;
  finalGuide: FinalGuideData | null;
  pendingBanner: PendingBannerInfo | null;
  timeSwitchNotice: string | null;
  lateSkipNotice: string | null;
  showAfterRainRecoverySelector: boolean;
  showBentoJudgeGuide: boolean;
  areaCountAssistEnabled: boolean;
  areaCountSameItemLimit: number | null;
  showDailyNoticeBeforeRate: boolean;
  areaJudgeSelection: AreaJudge;
  isResuming: boolean;
  startButtonLabel?: string;
  canUndo: boolean;
  undoNotice: string | null;
  canChooseSkipTarget: boolean;
  skipTargetOptions: SkipTargetOption[];
  doneSummaryItems: DoneSummaryItem[];
  doneNextSessionInfo: DoneNextSessionInfo | null;
  review19Items: Review19AreaItem[];
  review19ReferenceLines: string[];
  review19Export: {
    unexportedCount: number;
    canExportTen: boolean;
  };
  canStartReview19Manually: boolean;
  localAreaCountRecordCount: number;
};

export type UseNebikiAppActions = {
  updateSessionDraft: (patch: Partial<SessionDraft>) => void;
  startSession: () => void;
  goBackOneScreen: () => void;
  startEditingConditions: () => void;
  undoLastAction: () => void;
  markBentoJudgeGuideShown: () => void;
  confirmDailyNotice: () => void;
  judgeCurrentArea: (
    judge: Exclude<AreaJudge, null>,
    areaCount?: number | null,
    manualAreaCountEvaluation?: AreaCountEvaluation
  ) => void;
  getCurrentAreaCountRecommendation: (count: number) => AreaCountRecommendation;
  skipCurrentArea: () => void;
  chooseSkipTargetArea: (areaId: AreaId) => void;

  goToNextArea: () => void;
  acknowledgeAutoSkippedArea: () => void;
  advanceFinalTimeStep: () => void;
  updateReview19Rating: (areaId: AreaId, rating: Review19Rating) => void;
  startReview19AfterWeather: () => void;
  saveReview19: () => void;
  start19DiscountAfterReview: () => void;
  startNextDoneSession: () => void;
  exportReview19Records: () => void;
  startReview19Manually: () => void;
  migrateLocalAreaCountRecordsToRemote: () => Promise<AreaCountMigrationResult>;
  resetApp: () => void;
};

export type UseNebikiAppResult = {
  state: AppState;
  derived: UseNebikiAppDerived;
  actions: UseNebikiAppActions;
};

export type NearTermWeather = "other" | "rain" | "snow";
export type LaterPrecipType = "rain" | "snow" | null;
export type AfterRainSky = "cloudy" | "sunny" | null;
