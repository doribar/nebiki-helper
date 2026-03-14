export type DiscountTime = "17" | "18" | "19" | "20";

export type AreaId =
  | "hosomaki"
  | "inari"
  | "futomaki_chumaki"
  | "sushi"
  | "onigiri"
  | "sekihan_takikomi"
  | "chuka_fish"
  | "yakitori"
  | "fry_chicken"
  | "croquette"
  | "tempura"
  | "bento_men";

export type AreaMaster = {
  id: AreaId;
  name: string;
  order: number;
};

export type WeatherInput = {
  isRain: boolean;
  isWindOver3m: boolean;
  isTempUnder10: boolean;
};

export type SessionDraft = {
  date: string; // YYYY-MM-DD
  weekday: number; // 0=日,1=月...6=土
  discountTime: DiscountTime;
  weather: WeatherInput;
};

export type SessionData = SessionDraft & {
  startedAt: string; // ISO文字列
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

export type ManyProductRecord = {
  areaId: AreaId;
  productName: string;
  recordedDate: string; // YYYY-MM-DD
  discountTime: DiscountTime;
};

export type ScreenName =
  | "start"
  | "area_judge"
  | "rate_display"
  | "many_input"
  | "pending_guide"
  | "final_time"
  | "done";

export type FlowMode = "normal" | "pending";

export type WeekdayBaseLabel = "日" | "金土" | "火木" | "月水";

export type WeekdayBaseInfo = {
  original: WeekdayBaseLabel;
  adjusted: WeekdayBaseLabel;
  changedByWeather: boolean;
  baseRateBonus: number; // 0 / 10 / 20
  baseRateBonusReason: string[]; // 例: ["悪天候"], ["悪天候", "雨"], ["雪"]
};

export type WeekdayBaseDisplay = {
  weekdayBaseText: string; // 例: "曜日基準：火木 → 月水"
  bonusText?: string; // 例: "悪天候のためベース +10%"
};

export type RateLine = {
  main: string; // 例: "30%"
  sub?: string; // 例: "定番・広告 → 20%"
};

export type RateDisplayData = {
  many: RateLine;
  few: { main: "引かない" };
  normal: RateLine;
};

export type FinalGuideData = {
  count1: RateLine;
  count2: RateLine;
  count3OrMore: RateLine;
  few: { main: "引かない" };
};

export type PendingReason = "manual" | "few";

export type PendingAreaCandidate = {
  areaId: AreaId;
  areaName: string;
  reason: PendingReason;
};

export type WeatherGuideText = {
  rainGuide: string;
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
  manyInputDraft: string[];
  pendingDeferredAreaIds: AreaId[];
};

export type UseNebikiAppDerived = {
  currentAreaName: string | null;
  weekdayText: string;
  timeText: string;
  basisGuide: BasisGuideDisplay;
  weatherGuideText: WeatherGuideText;
  rateDisplay: RateDisplayData | null;
  finalGuide: FinalGuideData | null;
  previousManyProducts: string[];
  consecutiveManyRate: number | null;
  pendingCandidate: PendingAreaCandidate | null;
  pendingReasonText: string | null;
};

export type UseNebikiAppActions = {
  updateSessionDraft: (patch: Partial<SessionDraft>) => void;
  startSession: () => void;

  selectAreaMany: () => void;
  selectAreaNormal: () => void;
  selectAreaFew: () => void;
  skipCurrentArea: () => void;

  openManyInput: () => void;
  changeManyDraftValues: (next: string[]) => void;
  addManyDraftRow: () => void;
  removeManyDraftRow: (index: number) => void;
  saveManyDraft: () => void;
  cancelManyDraft: () => void;

  goToNextArea: () => void;

  openPendingArea: () => void;
  postponePendingAgain: () => void;
  markPendingCompleted: () => void;

  resetApp: () => void;
};

export type UseNebikiAppResult = {
  state: AppState;
  derived: UseNebikiAppDerived;
  actions: UseNebikiAppActions;
};

export type BasisGuideDisplay = {
  reasonText?: string;
  changeText?: string;
  bonusText?: string;
  referenceText: string;
};