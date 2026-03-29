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
export type TempLevel = "10orLess" | "11to15" | "16to25" | "26orMore";

export type WeatherInput = {
  nearTermWeather: NearTermWeather;
  hasLaterPrecip: boolean;
  laterPrecipType: LaterPrecipType;
  windLevel: WindLevel;
  tempLevel: TempLevel;
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
  baseRateBonus: number;
  baseRateBonusReason: string[];
};

export type BasisGuideDisplay = {
  noticeText?: string;
  reasonText?: string;
  changeText?: string;
  bonusText?: string;
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

export type WeatherGuideText = {
  nearTermWeatherGuide: string;
  laterPrecipGuide: string;
  laterPrecipTypeGuide: string;
  windGuide: string;
  tempGuide: string;
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
};

export type UseNebikiAppActions = {
  updateSessionDraft: (patch: Partial<SessionDraft>) => void;
  startSession: () => void;

  selectAreaMany: () => void;
  selectAreaNormal: () => void;
  selectAreaFew: () => void;
  skipCurrentArea: () => void;

  goToNextArea: () => void;
  resetApp: () => void;
};

export type UseNebikiAppResult = {
  state: AppState;
  derived: UseNebikiAppDerived;
  actions: UseNebikiAppActions;
};

export type NearTermWeather = "other" | "rain" | "snow";
export type LaterPrecipType = "rain" | "snow" | null;