export type DiscountTime = "15" | "17" | "18" | "19" | "20";

export type AreaId =
  | "hosomaki"
  | "inari"
  | "futomaki_chumaki"
  | "sushi"
  | "onigiri"
  | "sekihan_takikomi"
  | "balance_bento"
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
  | "26to30"
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
  windLevel: WindLevel;
  tempLevel: TempLevel;
  next18TempDropShift: 0 | 1;
  next18WindWorsenShift: 0 | 1;
  afterRainSky: AfterRainSky;
};

export type SessionDraft = {
  date: string;
  weekday: number;
  discountTime: DiscountTime;
  manualWeekdayOverride: boolean;
  manualDiscountTimeOverride: boolean;
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
  | "postponed_few";

export type AreaProgress = {
  areaId: AreaId;
  status: AreaStatus;
  areaJudge: AreaJudge;
  visitedAt?: string;
  completedAt?: string;
  skipReason?: "manual" | "few";
};

export type ScreenName =
  | "start"
  | "area_judge"
  | "rate_display"
  | "final_time"
  | "done";

export type FlowMode = "normal" | "pending";

export type WeekdayBaseLabel = "日" | "金土" | "火木" | "月水";

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
  showDailyNoticeBeforeRate: boolean;
  areaJudgeSelection: AreaJudge;
  isResuming: boolean;
  canUndo: boolean;
  undoNotice: string | null;
  canChooseSkipTarget: boolean;
  skipTargetOptions: SkipTargetOption[];
  doneSummaryItems: DoneSummaryItem[];
};

export type UseNebikiAppActions = {
  updateSessionDraft: (patch: Partial<SessionDraft>) => void;
  startSession: () => void;
  goBackOneScreen: () => void;
  startEditingConditions: () => void;
  undoLastAction: () => void;
  markBentoJudgeGuideShown: () => void;
  confirmDailyNotice: () => void;

  judgeCurrentArea: (judge: Exclude<AreaJudge, null>) => void;
  skipCurrentArea: () => void;
  chooseSkipTargetArea: (areaId: AreaId) => void;

  goToNextArea: () => void;
  advanceFinalTimeStep: () => void;
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
