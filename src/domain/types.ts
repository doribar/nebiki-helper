import type {
  AreaCountDecisionBasis,
  AreaCountRecommendation,
  AreaCountRecord,
} from "./areaCountHistory.ts";
export type DiscountTime = "15" | "17" | "18" | "19" | "20";
export type DemandCycle = "normal" | "summer";

export type AutoSkipKind = "late_plus5" | "early_next_minus5";
export type MeasurementStatus = "measured" | "not_measured";
export type MeasurementMissingReason =
  | "early_next_minus5_skipped"
  | "auto_time_transition"
  | "legacy_unknown";
export type EarlyDiscountResolution =
  | "count_only"
  | "process_normally"
  | "not_measured";
export type RateOrigin = "confirmed_now" | "carried_from_early_discount";

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
  demandCycle?: DemandCycle;
  targetDiscountTime: "18" | "19";
  areaId: AreaId;
  previousRateText?: string;
  previousManyRateText?: string;
  previousNormalRateText?: string;
  skipKind?: AutoSkipKind;
  sourceDiscountTime?: "17" | "18";
  sourceSessionStartedAt?: string;
  earlyDiscountCompletedAt?: string;
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
  | "31to33"
  | "34to35"
  | "31to35"
  | "36orMore";

export type TemperatureComfortAnalysis = {
  version: 1;
  originalTemperaturePoint: number;
  appliedTemperaturePoint: number;
  temperatureFalling: boolean;
  previousTemperatureFalling: boolean;
  previousTempLevel: TempLevel | null;
  previousDiscountTime: DiscountTime | null;
  currentTempLevel: TempLevel;
  temperaturePointSuppressed: boolean;
};

export type ForecastHourKey = "16" | "17" | "18" | "19" | "20" | "21";
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
  temperatureComfortAnalysis?: TemperatureComfortAnalysis;
};

export type SessionDraft = {
  date: string;
  weekday: number;
  discountTime: DiscountTime;
  /** 旧データに存在しない場合は通常サイクルとして扱う。 */
  demandCycle?: DemandCycle;
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
  dataSchemaVersion?: number;
  appVersion?: string;
  buildId?: string;
  temperatureComfortAnalysis?: TemperatureComfortAnalysis;
  /** 実気温を持たない旧進行中データの集約区分を、推測せず保持するためだけの互換マーカー。 */
  legacyUnresolvedTempLevel?: "31to35";
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
  stapleItemCount?: number | null;
  areaCountEvaluation?: AreaCountEvaluation;
  areaCountEvaluationSource?: AreaCountEvaluationSource;
  humanEvaluationDetails?: HumanEvaluationDetails;
  areaCountDecisionBasis?: AreaCountDecisionBasis;
  areaRateAdjustment?: AreaRateAdjustment;
  visitedAt?: string;
  completedAt?: string;
  skipReason?: "manual" | "few" | "late_time";
  completedRateText?: string;
  completedManyRateText?: string;
  completedNormalRateText?: string;
  previousRateText?: string;
  previousManyRateText?: string;
  previousNormalRateText?: string;
  autoSkipKind?: AutoSkipKind;
  /**
   * このエリアの値引指示画面を、次回基準-5%の時間帯に表示した記録。
   * 19:25などの自動移行時には現在時刻だけでは判定できないため保持する。
   */
  earlyNextMinus5TargetDiscountTime?: "18" | "19";
  rateDecisionSnapshot?: RateDecisionSnapshot;
  rateDecisionSnapshotStatus?: "captured" | "legacy_not_captured";
  measurementStatus?: MeasurementStatus;
  missingReason?: MeasurementMissingReason;
  earlyDiscountResolution?: EarlyDiscountResolution;
  sourceDiscountTime?: DiscountTime;
  sourceSessionStartedAt?: string;
  earlyDiscountCompletedAt?: string;
  skipAcknowledgedAt?: string;
  measurementRecordedAt?: string;
  rateOrigin?: RateOrigin;
};


export type ScreenName =
  | "start"
  | "review19_weather"
  | "review19_done"
  | "area_judge"
  | "auto_skip_notice"
  | "auto_skip_count"
  | "rate_display"
  | "final_time"
  | "review19"
  | "done";

export type FlowMode = "normal" | "pending";

export type WeekdayBaseLabel = "日" | "金土" | "火木" | "月水";
export type ActualWeekdayLabel = "日" | "月" | "火" | "水" | "木" | "金" | "土";
export type ActualWeekdayGroup =
  | "月水"
  | "火木"
  | "金土日"
  | "火木日"
  | "金土"
  | "三連休中日"
  | "翌日平日祝日";
export type AreaCountEvaluation = "many" | "slightly_many" | "normal" | "slightly_few" | "few";
export type HumanEvaluationScore9 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type HumanEvaluationScale = 5 | 9;
export type HumanEvaluationSelections =
  | [AreaCountEvaluation]
  | [AreaCountEvaluation, AreaCountEvaluation];
export type HumanEvaluationSelection = {
  humanEvaluationScore9: HumanEvaluationScore9;
  humanEvaluationSelections: HumanEvaluationSelections;
};
export type HumanEvaluationResolutionDirection =
  | "none"
  | "lower"
  | "higher"
  | "not_applicable";
export type HumanEvaluationResolutionReason =
  | "single_selection"
  | "normal_15"
  | "normal_17_or_later"
  | "summer_before_1800"
  | "summer_1800_or_later"
  | "review19_observation"
  | "legacy_5_level";
export type HumanEvaluationDetails = {
  humanEvaluationScore9: HumanEvaluationScore9;
  humanEvaluationScale: HumanEvaluationScale;
  humanEvaluationSelections: HumanEvaluationSelections;
  /** 手動変更前の履歴自動判定。自動判定がない場合は保存しない。 */
  automaticEvaluation?: AreaCountEvaluation;
  resolvedEvaluation?: AreaCountEvaluation;
  resolutionDirection: HumanEvaluationResolutionDirection;
  resolutionReason: HumanEvaluationResolutionReason;
  demandCycle?: DemandCycle;
  evaluatedAt?: string;
  sessionDiscountTime?: DiscountTime;
};
export type AreaCountEvaluationSource = "manual" | "history";
export type AreaRateAdjustment = -10 | -5 | 0 | 5 | 10;
export type RateLogicVersion = "weekday_basis_v1" | "time_basic_rate_v1";

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

export type RateDecisionCalculationMode =
  | "normal"
  | "late_plus5"
  | "early_next_minus5"
  | "final";

export type ProductAdjustmentPolicySnapshot = {
  staplePercent: -10;
  nightSellerPercent: -10;
  poorAppearancePercent: 10;
  unpopularPercent: 10;
  advertisementPercent: -10;
  advertisementMode: "always";
};

/**
 * エリアの値引率を確定した瞬間の不変スナップショット。
 * 完了後の時計進行やエクスポート時に再計算しない。
 */
export type RateDecisionSnapshot = {
  version: 1;
  dataSchemaVersion: number;
  appVersion: string;
  buildId: string;
  demandCycle?: DemandCycle;
  confirmedAt: string;
  sessionDiscountTime: DiscountTime;
  effectiveRateDiscountTime: DiscountTime;
  calculationMode: RateDecisionCalculationMode;
  rateLogicVersion: RateLogicVersion;
  basicRatePercent: number;
  weatherComfortAdjustmentPercent: number;
  lateTimeAdjustmentPercent: number;
  earlyNextAdjustmentPercent: number;
  areaCountAdjustmentPercent: number;
  legacyAreaJudgeAdjustmentPercent: number;
  otherAdjustments: {
    productPolicy: ProductAdjustmentPolicySnapshot;
  };
  normalRateBeforeLimitsPercent: number;
  manyRateBeforeLimitsPercent: number;
  normalRateAfterBaseLimitsPercent: number;
  manyRateAfterBaseLimitsPercent: number;
  normalRatePercent: number;
  manyRatePercent: number;
  limits: {
    minimumPercent: 0;
    maximumPercent: 50;
    normalLowerLimitApplied: boolean;
    normalUpperLimitApplied: boolean;
    manyLowerLimitApplied: boolean;
    manyUpperLimitApplied: boolean;
  };
  displayedRatePercent: number;
  displayedRateText: string;
  displayedNormalRatePercent: number;
  displayedManyRatePercent: number;
  display: RateDisplayData | null;
  finalGuide?: FinalGuideData;
  resolvedWeather: ResolvedWeatherInput;
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
  demandCycle?: DemandCycle;
  nearTermWeather: NearTermWeather;
  /** 同日内の次セッションで気温推移を比較するための、確定済み近接気温。 */
  nearTempC?: number;
  sessionStartedAt?: string;
  temperatureComfortAnalysis?: TemperatureComfortAnalysis;
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

export type Review19RatingStatus = "recorded" | "not_collected";

export type Review19Status = "recorded" | "not_performed" | "not_applicable";

export type Review19ExcludeReason = "few_at_15" | "few_at_15_and_17" | "manual";

export type AreaCountDataQuality = {
  expectedAreaCount: number;
  recordedAreaCount: number;
  excludedAreaCount: number;
  missingAreaIds: AreaId[];
  duplicateAreaIds: AreaId[];
  complete: boolean;
  processComplete: boolean;
  measurementComplete: boolean;
  notMeasuredAreaIds: AreaId[];
  missingReasons: Partial<Record<AreaId, MeasurementMissingReason>>;
};

export type Review19AutomaticEvaluation = {
  /** 過去中央値との比較結果。人間評価の正解ラベルではなく、分析用の別観測値。 */
  autoEvaluation: AreaCountEvaluation | null;
  autoEvaluationStatus: "ready" | "insufficient";
  /** 新規記録では必ず保存する。旧・不完全データの正規化時だけ欠損を許容する。 */
  autoEvaluationBasis?: AreaCountDecisionBasis;
};

export type Review19AreaEvaluation = Review19AutomaticEvaluation & {
  /** 売場を見た担当者の観測値。ground truthとして扱わない。 */
  humanEvaluation?: AreaCountEvaluation;
  humanEvaluationDetails?: HumanEvaluationDetails;
};

export type Review19DataQuality = AreaCountDataQuality & {
  humanEvaluationExpectedAreaCount: number;
  humanEvaluationRecordedAreaCount: number;
  missingHumanEvaluationAreaIds: AreaId[];
  humanEvaluationComplete: boolean;
};

export type Review19AreaSnapshot = {
  dataSchemaVersion?: number;
  appVersion?: string;
  buildId?: string;
  areaId: AreaId;
  areaName: string;
  reviewExcluded?: boolean;
  reviewExcludeReason?: Review19ExcludeReason;
  status: AreaStatus;
  statusText?: string;
  areaJudge: AreaJudge;
  areaCount?: number;
  stapleItemCount?: number | null;
  areaCountEvaluation?: AreaCountEvaluation;
  areaCountEvaluationSource?: AreaCountEvaluationSource;
  humanEvaluationDetails?: HumanEvaluationDetails;
  areaCountDecisionBasis?: AreaCountDecisionBasis;
  areaRateAdjustment?: AreaRateAdjustment;
  judgeText: string;
  rateText: string;
  ratePercent?: number;
  manyRateText?: string;
  manyRatePercent?: number;
  normalRateText?: string;
  normalRatePercent?: number;
  visitedAt?: string;
  completedAt?: string;
  skipReason?: "manual" | "few" | "late_time";
  rateDecisionSnapshot?: RateDecisionSnapshot;
  rateDecisionSnapshotStatus: "captured" | "legacy_not_captured";
  measurementStatus?: MeasurementStatus;
  missingReason?: MeasurementMissingReason;
  earlyDiscountResolution?: EarlyDiscountResolution;
  autoSkipKind?: AutoSkipKind;
  sourceDiscountTime?: DiscountTime;
  sourceSessionStartedAt?: string;
  earlyDiscountCompletedAt?: string;
  skipAcknowledgedAt?: string;
  measurementRecordedAt?: string;
  rateOrigin?: RateOrigin;
};

export type Review19Reference = {
  date: string;
  weekday: number;
  discountTime: "19";
  demandCycle?: DemandCycle;
  weather: WeatherInput;
  resolvedWeather: ResolvedWeatherInput;
  basis: {
    rateLogicVersion?: RateLogicVersion;
    /** legacy: 旧曜日基準方式の保存データにだけ入る。 */
    originalWeekdayBase?: WeekdayBaseLabel;
    /** legacy: 旧曜日基準方式の保存データにだけ入る。 */
    adjustedWeekdayBase?: WeekdayBaseLabel;
    /** legacy: 旧曜日基準方式の保存データにだけ入る。 */
    weekdayShift?: number;
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
  dataSchemaVersion?: number;
  appVersion?: string;
  buildId?: string;
  capturedAt: string;
  demandCycle?: DemandCycle;
  session: {
    dataSchemaVersion?: number;
    appVersion?: string;
    buildId?: string;
    date: string;
    weekday: number;
    discountTime: DiscountTime;
    demandCycle?: DemandCycle;
    startedAt: string;
    manualWeekdayOverride: boolean;
    manualDiscountTimeOverride: boolean;
    weather: WeatherInput;
    resolvedWeather: ResolvedWeatherInput;
  };
  basis: {
    rateLogicVersion?: RateLogicVersion;
    /** legacy: 旧曜日基準方式の保存データにだけ入る。 */
    originalWeekdayBase?: WeekdayBaseLabel;
    /** legacy: 旧曜日基準方式の保存データにだけ入る。 */
    adjustedWeekdayBase?: WeekdayBaseLabel;
    /** legacy: 旧曜日基準方式の保存データにだけ入る。 */
    weekdayShift?: number;
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


export type DailySessionSnapshot = {
  version: 1;
  dataSchemaVersion?: number;
  appVersion?: string;
  buildId?: string;
  capturedAt: string;
  demandCycle?: DemandCycle;
  basisCapturedAt?: string;
  sessionEndReason?: "completed" | "auto_time_transition";
  rateLogicVersion?: RateLogicVersion;
  screen: ScreenName;
  session: {
    dataSchemaVersion?: number;
    appVersion?: string;
    buildId?: string;
    date: string;
    weekday: number;
    discountTime: DiscountTime;
    demandCycle?: DemandCycle;
    startedAt: string;
    manualWeekdayOverride: boolean;
    manualDiscountTimeOverride: boolean;
    weather: WeatherInput;
    resolvedWeather: ResolvedWeatherInput;
  };
  basis: {
    rateLogicVersion?: RateLogicVersion;
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
  doneSummaryItems: DoneSummaryItem[];
  currentAreaId: AreaId | null;
  review19ExcludedAreaIds: AreaId[];
};


export type Review19DayCheckSnapshot = {
  version: 1;
  dataSchemaVersion?: number;
  appVersion?: string;
  buildId?: string;
  demandCycle?: DemandCycle;
  review19Status: Exclude<Review19Status, "not_performed">;
  recordedAt: string;
  sessionStartedAt: string;
  reviewStartedAt?: string;
  reviewCompletedAt?: string;
  /** Cloud同期で同一営業日のmutation順序を保証する単調増加timestamp。 */
  sourceUpdatedAt?: string;
  areaCountRecordedAt: Partial<Record<AreaId, string>>;
  /** 旧手動評価データだけ recorded。現在の残数入力方式では not_collected。 */
  ratingStatus: Review19RatingStatus;
  ratings: Record<AreaId, Review19Rating> | null;
  ratingScores: Record<AreaId, Review19RatingScore> | null;
  areaCounts: Partial<Record<AreaId, number>>;
  areaEvaluations?: Partial<Record<AreaId, Review19AreaEvaluation>>;
  excludedAreaIds: AreaId[];
  excludeReasons: Partial<Record<AreaId, Review19ExcludeReason>>;
  dataQuality: Review19DataQuality;
  reference?: Review19Reference;
  snapshot?: Review19Snapshot;
};

export type Review19DaySnapshot = {
  version: 1;
  dataSchemaVersion?: number;
  appVersion?: string;
  buildId?: string;
  capturedAt: string;
  date: string;
  demandCycle?: DemandCycle;
  rateLogicVersion?: RateLogicVersion;
  review19Status: Review19Status;
  /** その日の通常値引セッションログ。19:00チェックはreview19Checkへ分けて保存する。 */
  sessions: DailySessionSnapshot[];
  /** 19:00チェックの記録。daySnapshot内でも1日のログとして参照できるように保存する。 */
  review19Check?: Review19DayCheckSnapshot;
  /** その日に通常の値引作業で保存されたエリア残数データ。19:00チェックの残数はReview19Result.areaCountsとreview19Check.areaCountsに保存する。 */
  areaCountRecords: AreaCountRecord[];
};

export type Review19Result = {
  dataSchemaVersion?: number;
  appVersion?: string;
  buildId?: string;
  review19Status: Exclude<Review19Status, "not_performed">;
  date: string;
  demandCycle?: DemandCycle;
  sessionStartedAt: string;
  reviewStartedAt?: string;
  reviewCompletedAt?: string;
  /** 旧データは他の記録timestamp最大値から論理導出する。 */
  sourceUpdatedAt?: string;
  areaCountRecordedAt: Partial<Record<AreaId, string>>;
  /** 旧手動評価データだけ recorded。現在の残数入力方式では not_collected。 */
  ratingStatus: Review19RatingStatus;
  ratings: Record<AreaId, Review19Rating> | null;
  ratingScores: Record<AreaId, Review19RatingScore> | null;
  areaCounts: Partial<Record<AreaId, number>>;
  areaEvaluations?: Partial<Record<AreaId, Review19AreaEvaluation>>;
  excludedAreaIds: AreaId[];
  excludeReasons: Partial<Record<AreaId, Review19ExcludeReason>>;
  dataQuality: Review19DataQuality;
  recordedAt?: string;
  exportedAt?: string;
  reference?: Review19Reference;
  snapshot?: Review19Snapshot;
  daySnapshot?: Review19DaySnapshot;
};

export type Review19AreaItem = {
  areaId: AreaId;
  areaName: string;
  count?: number;
  humanEvaluation?: AreaCountEvaluation;
  humanEvaluationDetails?: HumanEvaluationDetails;
  excluded: boolean;
  excludeReasonText?: string;
};

export type EditableAreaCountItem = {
  areaId: AreaId;
  areaName: string;
  count: number;
};

export type SupabaseBackfillResult = {
  detectedAreaCount: number;
  detectedReview19Count: number;
  queuedCount: number;
  attemptedCount: number;
  succeededCount: number;
  failedCount: number;
  pendingCount: number;
  allSynced: boolean;
  skippedReason?: "fixed_time_mode";
};

export type AreaCountCorrectionContext = {
  mode?: "normal" | "auto_skip_count_only";
  targetAreaId: AreaId;
  returnScreen: ScreenName;
  returnAreaId: AreaId | null;
  returnLastReferenceAreaId: AreaId | null;
  returnCurrentFlow: FlowMode;
  returnPendingDeferredAreaIds: AreaId[];
  returnFinalTimeStep: FinalTimeStep;
  returnTimeSwitchNotice: string | null;
  returnHistoryLength: number;
};

export type AppState = {
  screen: ScreenName;
  session: SessionData | null;
  sessionDraft: SessionDraft;
  areaProgressMap: Record<AreaId, AreaProgress>;
  /** 自動時刻切替時に、前時刻の未完了エリアを先頭へ並べるための通常処理順。 */
  normalFlowOrder?: AreaId[];
  currentAreaId: AreaId | null;
  lastReferenceAreaId: AreaId | null;
  currentFlow: FlowMode;
  pendingDeferredAreaIds: AreaId[];
  timeSwitchNotice: string | null;
  finalTimeStep: FinalTimeStep;
  review19: Review19Result | null;
  review19ExcludedAreaIds: AreaId[];
  /** 入力済み残数を既存の判定フローで修正し、元画面へ戻るための一時情報。 */
  areaCountCorrection?: AreaCountCorrectionContext | null;
  /** 20:30入力完了時に確定した日次記録を直接参照するための安定ID。 */
  finalizedDayRecordId?: string | null;
};

export type UseNebikiAppDerived = {
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
  showDayBeforeHolidayNotice: boolean;
  showThreeDayHolidayMiddleNotice: boolean;
  showHolidayBeforeNormalWeekdayNotice: boolean;
  weatherConfirmationPending: boolean;
  weatherCorrectionRequestId: number;
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
  editableAreaCounts: EditableAreaCountItem[];
  finalizedDayMemo: string;
  previousDayDiscardTarget: {
    date: string;
    count: number | null;
  } | null;
  dataExport: {
    review19Count: number;
    dailyCount: number;
  };
  allDataExport: {
    totalCount: number;
  };
  cloudSync: {
    pendingCount: number;
    areaCountPendingCount: number;
    review19PendingCount: number;
    syncing: boolean;
    lastBackfillResult: SupabaseBackfillResult | null;
  };
  canStartReview19Manually: boolean;
  demandCycle: DemandCycle;
  demandCycleLabel: string;
  demandCycleBasisLabel: string;
  canChangeDemandCycle: boolean;
  demandCycleChangeBlockedReason: string | null;
};

export type UseNebikiAppActions = {
  updateSessionDraft: (patch: Partial<SessionDraft>) => void;
  startSession: () => void;
  requestWeatherConfirmation: () => void;
  editWeatherInput: () => void;
  confirmWeatherInput: () => void;
  goBackOneScreen: () => void;
  startEditingConditions: () => void;
  undoLastAction: () => void;
  markBentoJudgeGuideShown: () => void;
  confirmDailyNotice: () => void;
  judgeCurrentArea: (
    judge: Exclude<AreaJudge, null>,
    areaCount?: number | null,
    manualAreaCountEvaluation?: AreaCountEvaluation,
    stapleItemCount?: number | null,
    humanEvaluationSelection?: HumanEvaluationSelection,
  ) => void;
  getCurrentAreaCountRecommendation: (count: number) => AreaCountRecommendation;
  skipCurrentArea: () => void;
  chooseSkipTargetArea: (areaId: AreaId) => void;

  goToNextArea: () => void;
  startAutoSkippedAreaCountOnly: () => void;
  saveAutoSkippedAreaCount: (count: number) => void;
  skipAutoSkippedAreaWithoutMeasurement: () => void;
  processAutoSkippedAreaNormally: () => void;
  advanceFinalTimeStep: () => void;
  updateReview19AreaCount: (
    areaId: AreaId,
    count: number,
    humanEvaluation?: AreaCountEvaluation,
    humanEvaluationSelection?: HumanEvaluationSelection,
  ) => void;
  skipReview19Area: (areaId: AreaId) => void;
  startReview19AfterWeather: () => void;
  saveReview19: (
    latestAreaCount?: {
      areaId: AreaId;
      count: number;
      humanEvaluation?: AreaCountEvaluation;
      humanEvaluationSelection?: HumanEvaluationSelection;
    },
    latestExcludedAreaId?: AreaId,
  ) => void;
  startAreaCountCorrection: (areaId: AreaId) => void;
  saveFinalizedDayMemo: (memo: string | null) => void;
  savePreviousDayDiscardCount: (count: number | null) => void;
  exportAllReview19Data: () => boolean;
  exportLatestReview19Data: () => boolean;
  exportAllDailyData: () => Promise<boolean>;
  exportLatestDailyData: () => Promise<boolean>;
  exportCompletedReview19Data: () => boolean;
  exportCompletedDailyData: (memo: string | null) => boolean;
  start19DiscountAfterReview: () => void;
  startNextDoneSession: () => void;
  exportAllData: () => void;
  syncLocalDataToSupabase: () => Promise<SupabaseBackfillResult>;
  startReview19Manually: () => void;
  resetApp: () => void;
  changeDemandCycle: (demandCycle: DemandCycle) => boolean;
};

export type UseNebikiAppResult = {
  state: AppState;
  derived: UseNebikiAppDerived;
  actions: UseNebikiAppActions;
};

export type NearTermWeather = "other" | "rain" | "snow";
export type LaterPrecipType = "rain" | "snow" | null;
export type AfterRainSky = "cloudy" | "sunny" | null;
