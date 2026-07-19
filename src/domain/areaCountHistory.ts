import type {
  ActualWeekdayGroup,
  ActualWeekdayLabel,
  AreaCountEvaluation,
  AreaCountEvaluationSource,
  AreaId,
  AreaJudge,
  AreaRateAdjustment,
  DiscountTime,
  WeekdayBaseLabel,
} from "./types";
import {
  addDaysToDateString,
  isDayBeforeJapaneseHoliday,
  isJapaneseHolidayOrObserved,
  isThreeDayHolidayMiddle,
} from "./japaneseHoliday.ts";

export type AreaCountDiscountTime = DiscountTime;

export type AreaCountComparisonMode =
  | "weekday"
  | "fallback_group"
  | "three_day_holiday_middle";

export const AREA_COUNT_DECISION_RULE_VERSION = "area_count_median_v1" as const;

export type AreaCountDecisionBasis = {
  ruleVersion: typeof AREA_COUNT_DECISION_RULE_VERSION;
  evaluationSource?: AreaCountEvaluationSource;
  recommendationStatus: AreaCountRecommendation["status"];
  actualWeekday?: ActualWeekdayLabel;
  actualWeekdayGroup?: ActualWeekdayGroup;
  comparisonMode?: AreaCountComparisonMode;
  sampleSize: number;
  requiredSampleSize: number;
  medianCount?: number;
  shortMedianCount?: number;
  longMedianCount?: number;
  shortSampleSize?: number;
  longSampleSize?: number;
  medianDownGuardApplied?: boolean;
  smallDifferenceThreshold?: number;
  largeDifferenceThreshold?: number;
  lowerLargeThreshold?: number;
  lowerSmallThreshold?: number;
  upperSmallThreshold?: number;
  upperLargeThreshold?: number;
  baseEvaluation?: AreaCountEvaluation;
  finalEvaluation?: AreaCountEvaluation;
  areaRateAdjustment?: AreaRateAdjustment;
  decreaseAdjustment?: {
    canUse: boolean;
    sampleSize: number;
    requiredSampleSize: number;
    previousDiscountTime?: AreaCountDiscountTime;
    previousCount?: number;
    currentDecreaseRate?: number;
    medianDecreaseRate?: number;
    direction: DecreaseAdjustmentDirection;
  };
};

export type AreaCountRecord = {
  dataSchemaVersion?: number;
  appVersion?: string;
  date: string;
  sessionStartedAt: string;
  recordedAt: string;
  areaId: AreaId;
  discountTime: AreaCountDiscountTime;
  /** legacy: 旧版の比較キー。 */
  weekdayBase?: WeekdayBaseLabel;
  /** 新しい比較キー。実際の曜日ごとの履歴を優先して使う。 */
  actualWeekday?: ActualWeekdayLabel;
  /** fallback/legacy: 実曜日の記録が足りない時の暫定グループ。 */
  actualWeekdayGroup: ActualWeekdayGroup;
  count: number;
  /** 手動で選んだ5段階のエリア判定。自動判定時は保存しない。 */
  userJudge?: AreaCountEvaluation;
  suggestedEvaluation?: AreaCountEvaluation;
  areaRateAdjustment?: AreaRateAdjustment;
  /** 判定元が手動か履歴中央値かを明示する。 */
  evaluationSource?: AreaCountEvaluationSource;
  /** 判定時点の中央値・閾値・減り方補正を、後から検証できる形で保存する。 */
  decisionBasis?: AreaCountDecisionBasis;
  comfortPoint?: number;
};

type DecreaseAdjustmentDirection = "more_many" | "more_few" | "none";

type DecreaseRecommendation = {
  canUse: boolean;
  sampleSize: number;
  requiredSampleSize: number;
  previousDiscountTime?: AreaCountDiscountTime;
  previousCount?: number;
  currentDecreaseRate?: number;
  medianDecreaseRate?: number;
  direction: DecreaseAdjustmentDirection;
  detailLines: string[];
};

export type AreaCountRecommendation = {
  status: "disabled" | "insufficient" | "ready";
  count: number;
  sampleSize: number;
  requiredSampleSize: number;
  matchedRecords: AreaCountRecord[];
  actualWeekday?: ActualWeekdayLabel;
  actualWeekdayGroup?: ActualWeekdayGroup;
  comparisonMode?: AreaCountComparisonMode;
  threeDayHolidayMiddleReference?: {
    fireThursdaySundaySampleSize: number;
    fridaySaturdaySampleSize: number;
    fireThursdaySundayMedianCount?: number;
    fridaySaturdayMedianCount?: number;
    adoptedSource: "both" | "火木日" | "金土" | "none";
  };
  medianCount?: number;
  shortMedianCount?: number;
  longMedianCount?: number;
  shortSampleSize?: number;
  longSampleSize?: number;
  medianDownGuardApplied?: boolean;
  smallDifferenceThreshold?: number;
  largeDifferenceThreshold?: number;
  lowerLargeThreshold?: number;
  lowerSmallThreshold?: number;
  upperSmallThreshold?: number;
  upperLargeThreshold?: number;
  baseEvaluation?: AreaCountEvaluation;
  suggestedEvaluation?: AreaCountEvaluation;
  suggestedJudge?: Exclude<AreaJudge, null>;
  areaRateAdjustment?: AreaRateAdjustment;
  decreaseRecommendation?: DecreaseRecommendation;
  summaryText: string;
  detailLines: string[];
};

const REQUIRED_SAMPLE_SIZE = 3;
const SHORT_REFERENCE_RECORDS = 16;
const LONG_REFERENCE_RECORDS = 52;
const MEDIAN_DOWN_GUARD_MAX_DROP = 2;
const DECREASE_RATE_THRESHOLD = 0.2;

// 15→17時の減り方比較を使える、追加製造が基本的にないエリア。
// 涼味・フライ鶏惣菜・焼鳥・中華魚惣菜・寿司・太巻中巻は追加製造があり得るため含めない。
const NO_AFTERNOON_ADD_AREA_IDS = new Set<AreaId>([
  "bento_men",
  "tempura",
  "onigiri",
  "inari",
  "hosomaki",
]);

export function getActualWeekdayLabel(weekday: number): ActualWeekdayLabel {
  switch (weekday) {
    case 0:
      return "日";
    case 1:
      return "月";
    case 2:
      return "火";
    case 3:
      return "水";
    case 4:
      return "木";
    case 5:
      return "金";
    case 6:
    default:
      return "土";
  }
}

export function getActualWeekdayGroup(
  weekday: number,
  discountTime: AreaCountDiscountTime = "15",
): ActualWeekdayGroup {
  switch (weekday) {
    case 1:
    case 3:
      return "月水";
    case 2:
    case 4:
      return discountTime === "15" ? "火木" : "火木日";
    case 5:
    case 6:
      return discountTime === "15" ? "金土日" : "金土";
    case 0:
    default:
      return discountTime === "15" ? "金土日" : "火木日";
  }
}

export function getAreaCountFallbackWeekdayGroup(params: {
  weekday: number;
  discountTime: AreaCountDiscountTime;
  date?: string | null;
}): ActualWeekdayGroup {
  const dateString = typeof params.date === "string" ? params.date : null;
  if (
    dateString !== null &&
    params.discountTime !== "15" &&
    isThreeDayHolidayMiddle(dateString)
  ) {
    return "三連休中日";
  }

  if (dateString !== null && isDayBeforeJapaneseHoliday(dateString)) {
    return params.discountTime === "15" ? "金土日" : "金土";
  }

  return getActualWeekdayGroup(params.weekday, params.discountTime);
}

export function shouldForceAreaCountFallbackWeekdayGroup(params: {
  weekday: number;
  date?: string | null;
}): boolean {
  const dateString = typeof params.date === "string" ? params.date : null;
  if (dateString === null) return false;

  const isHoliday = isJapaneseHolidayOrObserved(dateString);
  const isDayBeforeHoliday = isJapaneseHolidayOrObserved(addDaysToDateString(dateString, 1));

  // 祝日前日は通常曜日より翌日休みの影響を優先する。
  if (isDayBeforeHoliday) return true;

  if (!isHoliday) return false;

  // 金曜祝日は普通の金曜より連休初日寄りなので暫定グループ固定。
  if (params.weekday === 5) return true;

  // 土曜祝日は通常土曜と大きくズレにくいため、土曜単体データがあるなら優先する。
  if (params.weekday === 6) return false;

  // その他の祝日は通常曜日データより祝日用の暫定グループを優先する。
  return true;
}

export function getAreaCountSameItemLimit(_params: {
  weekdayBase?: WeekdayBaseLabel;
  weekday?: number;
  discountTime?: AreaCountDiscountTime;
}): number {
  // エリア残数入力の「同じ商品は〇個まで」は、曜日・時刻に関係なく常に10個に固定する。
  return 10;
}

function legacyWeekdayBaseToActualWeekdayGroup(
  weekdayBase: WeekdayBaseLabel | undefined,
  discountTime: AreaCountDiscountTime,
): ActualWeekdayGroup | null {
  switch (weekdayBase) {
    case "月水":
      return "月水";
    case "火木":
      return discountTime === "15" ? "火木" : "火木日";
    case "金土":
      return discountTime === "15" ? "金土日" : "金土";
    case "日":
      return discountTime === "15" ? "金土日" : "火木日";
    default:
      return null;
  }
}

export function isAreaCountAssistDiscountTime(
  discountTime: DiscountTime | undefined | null,
): discountTime is AreaCountDiscountTime {
  return (
    discountTime === "15" ||
    discountTime === "17" ||
    discountTime === "18" ||
    discountTime === "19" ||
    discountTime === "20"
  );
}

export function isAreaCountAssistTarget(params: {
  areaId: AreaId | null | undefined;
  discountTime: DiscountTime | undefined | null;
}): params is { areaId: AreaId; discountTime: AreaCountDiscountTime } {
  return Boolean(
    params.areaId && isAreaCountAssistDiscountTime(params.discountTime),
  );
}

function cloneAreaCountRecord(record: AreaCountRecord): AreaCountRecord {
  return {
    dataSchemaVersion: record.dataSchemaVersion,
    appVersion: record.appVersion,
    date: record.date,
    sessionStartedAt: record.sessionStartedAt,
    recordedAt: record.recordedAt,
    areaId: record.areaId,
    discountTime: record.discountTime,
    weekdayBase: record.weekdayBase,
    actualWeekday: record.actualWeekday,
    actualWeekdayGroup: record.actualWeekdayGroup,
    count: record.count,
    userJudge: record.userJudge,
    suggestedEvaluation: record.suggestedEvaluation,
    areaRateAdjustment: record.areaRateAdjustment,
    evaluationSource: record.evaluationSource,
    decisionBasis: record.decisionBasis
      ? JSON.parse(JSON.stringify(record.decisionBasis)) as AreaCountDecisionBasis
      : undefined,
    comfortPoint: record.comfortPoint,
  };
}

export function cloneAreaCountRecords(records: AreaCountRecord[]): AreaCountRecord[] {
  return records.map(cloneAreaCountRecord);
}

function isAreaCountEvaluation(value: unknown): value is AreaCountEvaluation {
  return (
    value === "many" ||
    value === "slightly_many" ||
    value === "normal" ||
    value === "slightly_few" ||
    value === "few"
  );
}

function isAreaRateAdjustment(value: unknown): value is AreaRateAdjustment {
  return value === -10 || value === -5 || value === 0 || value === 5 || value === 10;
}

function isActualWeekdayGroup(value: unknown): value is ActualWeekdayGroup {
  return (
    value === "月水" ||
    value === "火木" ||
    value === "金土日" ||
    value === "火木日" ||
    value === "金土" ||
    value === "三連休中日"
  );
}

function isActualWeekdayLabel(value: unknown): value is ActualWeekdayLabel {
  return value === "日" || value === "月" || value === "火" || value === "水" || value === "木" || value === "金" || value === "土";
}

function isAreaCountEvaluationSource(value: unknown): value is AreaCountEvaluationSource {
  return value === "manual" || value === "history";
}

function isRecommendationStatus(
  value: unknown,
): value is AreaCountRecommendation["status"] {
  return value === "disabled" || value === "insufficient" || value === "ready";
}

function isComparisonMode(value: unknown): value is AreaCountComparisonMode {
  return (
    value === "weekday" ||
    value === "fallback_group" ||
    value === "three_day_holiday_middle"
  );
}

function isDecreaseAdjustmentDirection(value: unknown): value is DecreaseAdjustmentDirection {
  return value === "more_many" || value === "more_few" || value === "none";
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  const numberValue = normalizeFiniteNumber(value);
  return numberValue === undefined || numberValue < 0 ? undefined : Math.round(numberValue);
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
  const numberValue = normalizeFiniteNumber(value);
  return numberValue === undefined || numberValue < 0 ? undefined : numberValue;
}

export function normalizeAreaCountDecisionBasis(
  raw: unknown,
): AreaCountDecisionBasis | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const basis = raw as Partial<AreaCountDecisionBasis>;
  if (basis.ruleVersion !== AREA_COUNT_DECISION_RULE_VERSION) return undefined;
  if (!isRecommendationStatus(basis.recommendationStatus)) return undefined;

  const sampleSize = normalizeNonNegativeInteger(basis.sampleSize);
  const requiredSampleSize = normalizeNonNegativeInteger(basis.requiredSampleSize);
  if (sampleSize === undefined || requiredSampleSize === undefined) return undefined;

  let decreaseAdjustment: AreaCountDecisionBasis["decreaseAdjustment"];
  const rawDecrease = basis.decreaseAdjustment;
  if (rawDecrease && typeof rawDecrease === "object") {
    const decreaseSampleSize = normalizeNonNegativeInteger(rawDecrease.sampleSize);
    const decreaseRequiredSampleSize = normalizeNonNegativeInteger(rawDecrease.requiredSampleSize);
    if (
      typeof rawDecrease.canUse === "boolean" &&
      decreaseSampleSize !== undefined &&
      decreaseRequiredSampleSize !== undefined &&
      isDecreaseAdjustmentDirection(rawDecrease.direction)
    ) {
      decreaseAdjustment = {
        canUse: rawDecrease.canUse,
        sampleSize: decreaseSampleSize,
        requiredSampleSize: decreaseRequiredSampleSize,
        previousDiscountTime: isAreaCountAssistDiscountTime(rawDecrease.previousDiscountTime)
          ? rawDecrease.previousDiscountTime
          : undefined,
        previousCount: normalizeNonNegativeInteger(rawDecrease.previousCount),
        currentDecreaseRate: normalizeFiniteNumber(rawDecrease.currentDecreaseRate),
        medianDecreaseRate: normalizeFiniteNumber(rawDecrease.medianDecreaseRate),
        direction: rawDecrease.direction,
      };
    }
  }

  return {
    ruleVersion: AREA_COUNT_DECISION_RULE_VERSION,
    evaluationSource: isAreaCountEvaluationSource(basis.evaluationSource)
      ? basis.evaluationSource
      : undefined,
    recommendationStatus: basis.recommendationStatus,
    actualWeekday: isActualWeekdayLabel(basis.actualWeekday) ? basis.actualWeekday : undefined,
    actualWeekdayGroup: isActualWeekdayGroup(basis.actualWeekdayGroup)
      ? basis.actualWeekdayGroup
      : undefined,
    comparisonMode: isComparisonMode(basis.comparisonMode) ? basis.comparisonMode : undefined,
    sampleSize,
    requiredSampleSize,
    medianCount: normalizeNonNegativeNumber(basis.medianCount),
    shortMedianCount: normalizeNonNegativeNumber(basis.shortMedianCount),
    longMedianCount: normalizeNonNegativeNumber(basis.longMedianCount),
    shortSampleSize: normalizeNonNegativeInteger(basis.shortSampleSize),
    longSampleSize: normalizeNonNegativeInteger(basis.longSampleSize),
    medianDownGuardApplied:
      typeof basis.medianDownGuardApplied === "boolean"
        ? basis.medianDownGuardApplied
        : undefined,
    smallDifferenceThreshold: normalizeNonNegativeNumber(basis.smallDifferenceThreshold),
    largeDifferenceThreshold: normalizeNonNegativeNumber(basis.largeDifferenceThreshold),
    lowerLargeThreshold: normalizeNonNegativeNumber(basis.lowerLargeThreshold),
    lowerSmallThreshold: normalizeNonNegativeNumber(basis.lowerSmallThreshold),
    upperSmallThreshold: normalizeNonNegativeNumber(basis.upperSmallThreshold),
    upperLargeThreshold: normalizeNonNegativeNumber(basis.upperLargeThreshold),
    baseEvaluation: isAreaCountEvaluation(basis.baseEvaluation)
      ? basis.baseEvaluation
      : undefined,
    finalEvaluation: isAreaCountEvaluation(basis.finalEvaluation)
      ? basis.finalEvaluation
      : undefined,
    areaRateAdjustment: isAreaRateAdjustment(basis.areaRateAdjustment)
      ? basis.areaRateAdjustment
      : undefined,
    decreaseAdjustment,
  };
}

export function buildAreaCountDecisionBasis(params: {
  recommendation: AreaCountRecommendation;
  evaluationSource?: AreaCountEvaluationSource;
  finalEvaluation?: AreaCountEvaluation;
  areaRateAdjustment?: AreaRateAdjustment;
}): AreaCountDecisionBasis {
  const decrease = params.recommendation.decreaseRecommendation;
  return {
    ruleVersion: AREA_COUNT_DECISION_RULE_VERSION,
    evaluationSource: params.evaluationSource,
    recommendationStatus: params.recommendation.status,
    actualWeekday: params.recommendation.actualWeekday,
    actualWeekdayGroup: params.recommendation.actualWeekdayGroup,
    comparisonMode: params.recommendation.comparisonMode,
    sampleSize: params.recommendation.sampleSize,
    requiredSampleSize: params.recommendation.requiredSampleSize,
    medianCount: params.recommendation.medianCount,
    shortMedianCount: params.recommendation.shortMedianCount,
    longMedianCount: params.recommendation.longMedianCount,
    shortSampleSize: params.recommendation.shortSampleSize,
    longSampleSize: params.recommendation.longSampleSize,
    medianDownGuardApplied: params.recommendation.medianDownGuardApplied,
    smallDifferenceThreshold: params.recommendation.smallDifferenceThreshold,
    largeDifferenceThreshold: params.recommendation.largeDifferenceThreshold,
    lowerLargeThreshold: params.recommendation.lowerLargeThreshold,
    lowerSmallThreshold: params.recommendation.lowerSmallThreshold,
    upperSmallThreshold: params.recommendation.upperSmallThreshold,
    upperLargeThreshold: params.recommendation.upperLargeThreshold,
    baseEvaluation: params.recommendation.baseEvaluation,
    finalEvaluation: params.finalEvaluation,
    areaRateAdjustment: params.areaRateAdjustment,
    decreaseAdjustment: decrease
      ? {
          canUse: decrease.canUse,
          sampleSize: decrease.sampleSize,
          requiredSampleSize: decrease.requiredSampleSize,
          previousDiscountTime: decrease.previousDiscountTime,
          previousCount: decrease.previousCount,
          currentDecreaseRate: decrease.currentDecreaseRate,
          medianDecreaseRate: decrease.medianDecreaseRate,
          direction: decrease.direction,
        }
      : undefined,
  };
}

function inferWeekdayLabelFromDate(dateText: string): ActualWeekdayLabel | undefined {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return getActualWeekdayLabel(date.getDay());
}

function actualWeekdayLabelToNumber(actualWeekday: ActualWeekdayLabel): number {
  switch (actualWeekday) {
    case "日":
      return 0;
    case "月":
      return 1;
    case "火":
      return 2;
    case "水":
      return 3;
    case "木":
      return 4;
    case "金":
      return 5;
    case "土":
      return 6;
  }
}

export function normalizeAreaCountRecords(raw: unknown): AreaCountRecord[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item): AreaCountRecord[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<AreaCountRecord>;

    if (typeof record.date !== "string") return [];
    if (typeof record.sessionStartedAt !== "string") return [];
    if (typeof record.recordedAt !== "string") return [];
    if (typeof record.areaId !== "string") return [];
    if (!isAreaCountAssistDiscountTime(record.discountTime)) return [];
    if (typeof record.count !== "number" || !Number.isFinite(record.count) || record.count < 0) return [];

    const legacyWeekdayBase =
      record.weekdayBase === "日" ||
      record.weekdayBase === "金土" ||
      record.weekdayBase === "火木" ||
      record.weekdayBase === "月水"
        ? record.weekdayBase
        : undefined;
    const actualWeekday = isActualWeekdayLabel(record.actualWeekday)
      ? record.actualWeekday
      : inferWeekdayLabelFromDate(record.date);
    // 旧レコードの保存済みグループ名は時刻別仕様と一致しない場合があるため、
    // 解決済みの実曜日・日付・値引時刻から現行仕様へ読み替える。
    const actualWeekdayGroup = actualWeekday
      ? getAreaCountFallbackWeekdayGroup({
          weekday: actualWeekdayLabelToNumber(actualWeekday),
          discountTime: record.discountTime,
          date: record.date,
        })
      : isActualWeekdayGroup(record.actualWeekdayGroup)
        ? record.actualWeekdayGroup
        : legacyWeekdayBaseToActualWeekdayGroup(legacyWeekdayBase, record.discountTime);

    if (!actualWeekdayGroup) return [];

    const userJudge = isAreaCountEvaluation(record.userJudge)
      ? record.userJudge
      : undefined;

    return [
      {
        dataSchemaVersion:
          typeof record.dataSchemaVersion === "number" &&
          Number.isInteger(record.dataSchemaVersion) &&
          record.dataSchemaVersion >= 1
            ? record.dataSchemaVersion
            : undefined,
        appVersion:
          typeof record.appVersion === "string" && record.appVersion.trim()
            ? record.appVersion
            : undefined,
        date: record.date,
        sessionStartedAt: record.sessionStartedAt,
        recordedAt: record.recordedAt,
        areaId: record.areaId as AreaId,
        discountTime: record.discountTime,
        weekdayBase: legacyWeekdayBase,
        actualWeekday,
        actualWeekdayGroup,
        count: Math.round(record.count),
        userJudge,
        suggestedEvaluation: isAreaCountEvaluation(record.suggestedEvaluation)
          ? record.suggestedEvaluation
          : undefined,
        areaRateAdjustment: isAreaRateAdjustment(record.areaRateAdjustment)
          ? record.areaRateAdjustment
          : undefined,
        evaluationSource: isAreaCountEvaluationSource(record.evaluationSource)
          ? record.evaluationSource
          : undefined,
        decisionBasis: normalizeAreaCountDecisionBasis(record.decisionBasis),
        comfortPoint:
          typeof record.comfortPoint === "number" && Number.isFinite(record.comfortPoint)
            ? Math.max(-1, Math.min(3, Math.round(record.comfortPoint)))
            : undefined,
      },
    ];
  });
}

export function upsertAreaCountRecord(
  records: AreaCountRecord[],
  nextRecord: AreaCountRecord,
): AreaCountRecord[] {
  const filtered = records.filter((record) => {
    return !(
      record.date === nextRecord.date &&
      record.sessionStartedAt === nextRecord.sessionStartedAt &&
      record.areaId === nextRecord.areaId &&
      record.discountTime === nextRecord.discountTime
    );
  });

  return [...filtered, cloneAreaCountRecord(nextRecord)].sort((a, b) => {
    return a.recordedAt.localeCompare(b.recordedAt);
  });
}

function compareRecordFreshness(a: AreaCountRecord, b: AreaCountRecord): number {
  const recordedAtCompare = a.recordedAt.localeCompare(b.recordedAt);
  if (recordedAtCompare !== 0) return recordedAtCompare;
  return a.sessionStartedAt.localeCompare(b.sessionStartedAt);
}

export function dedupeLatestAreaCountRecordsByDateAreaTime(
  records: AreaCountRecord[],
): AreaCountRecord[] {
  const latestByKey = new Map<string, AreaCountRecord>();

  for (const record of records) {
    const key = `${record.date}__${record.areaId}__${record.discountTime}`;
    const current = latestByKey.get(key);

    if (!current || compareRecordFreshness(current, record) <= 0) {
      latestByKey.set(key, cloneAreaCountRecord(record));
    }
  }

  return [...latestByKey.values()].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return compareRecordFreshness(a, b);
  });
}

function getHistoricalAreaCountRecords(
  records: AreaCountRecord[],
  currentDate: string,
): AreaCountRecord[] {
  return dedupeLatestAreaCountRecordsByDateAreaTime(records).filter((record) => {
    return record.date < currentDate;
  });
}

function getCurrentDateAreaCountRecords(
  records: AreaCountRecord[],
  currentDate: string,
): AreaCountRecord[] {
  return dedupeLatestAreaCountRecordsByDateAreaTime(records).filter((record) => {
    return record.date === currentDate;
  });
}

function getMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[center];
  return Math.round((sorted[center - 1] + sorted[center]) / 2);
}

function getMedianFloat(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[center];
  return (sorted[center - 1] + sorted[center]) / 2;
}

export function evaluationText(evaluation: AreaCountEvaluation): string {
  switch (evaluation) {
    case "many":
      return "多い";
    case "slightly_many":
      return "やや多い";
    case "normal":
      return "普通";
    case "slightly_few":
      return "やや少ない";
    case "few":
      return "少ない";
  }
}

function evaluationToLegacyJudge(evaluation: AreaCountEvaluation): Exclude<AreaJudge, null> {
  switch (evaluation) {
    case "many":
    case "slightly_many":
      return "many";
    case "slightly_few":
    case "few":
      return "few";
    case "normal":
      return "normal";
  }
}

export function evaluationToRateAdjustment(evaluation: AreaCountEvaluation): AreaRateAdjustment {
  switch (evaluation) {
    case "many":
      return 10;
    case "slightly_many":
      return 5;
    case "normal":
      return 0;
    case "slightly_few":
      return -5;
    case "few":
      return -10;
  }
}

function formatRateAdjustment(value: AreaRateAdjustment): string {
  if (value > 0) return `+${value}%`;
  if (value < 0) return `${value}%`;
  return "±0%";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getEvaluationFromCount(params: {
  count: number;
  referenceCount: number;
}): {
  evaluation: AreaCountEvaluation;
  smallDifferenceThreshold: number;
  largeDifferenceThreshold: number;
  lowerLargeThreshold: number;
  lowerSmallThreshold: number;
  upperSmallThreshold: number;
  upperLargeThreshold: number;
} {
  const smallDifferenceThreshold = Math.max(2, Math.ceil(params.referenceCount * 0.1));
  const largeDifferenceThreshold = Math.max(4, Math.ceil(params.referenceCount * 0.2));
  const lowerLargeThreshold = Math.max(0, params.referenceCount - largeDifferenceThreshold);
  const lowerSmallThreshold = Math.max(0, params.referenceCount - smallDifferenceThreshold);
  const upperSmallThreshold = params.referenceCount + smallDifferenceThreshold;
  const upperLargeThreshold = params.referenceCount + largeDifferenceThreshold;

  let evaluation: AreaCountEvaluation = "normal";
  if (params.count >= upperLargeThreshold) {
    evaluation = "many";
  } else if (params.count >= upperSmallThreshold) {
    evaluation = "slightly_many";
  } else if (params.count <= lowerLargeThreshold) {
    evaluation = "few";
  } else if (params.count <= lowerSmallThreshold) {
    evaluation = "slightly_few";
  }

  return {
    evaluation,
    smallDifferenceThreshold,
    largeDifferenceThreshold,
    lowerLargeThreshold,
    lowerSmallThreshold,
    upperSmallThreshold,
    upperLargeThreshold,
  };
}

function getEvaluationScore(evaluation: AreaCountEvaluation): number {
  switch (evaluation) {
    case "few":
      return -2;
    case "slightly_few":
      return -1;
    case "normal":
      return 0;
    case "slightly_many":
      return 1;
    case "many":
      return 2;
  }
}

function scoreToEvaluation(score: number): AreaCountEvaluation {
  switch (clamp(score, -2, 2)) {
    case -2:
      return "few";
    case -1:
      return "slightly_few";
    case 1:
      return "slightly_many";
    case 2:
      return "many";
    case 0:
    default:
      return "normal";
  }
}

function getPreviousDiscountTimeForDecrease(params: {
  areaId: AreaId;
  discountTime: DiscountTime;
}): AreaCountDiscountTime | null {
  if (params.discountTime === "17") {
    return NO_AFTERNOON_ADD_AREA_IDS.has(params.areaId) ? "15" : null;
  }

  // 18時30分はバラ商品をパック化して値引対象へ加えるため、17時との単純な減少率比較はしない。
  if (params.discountTime === "18") return null;
  if (params.discountTime === "19") return "18";
  return null;
}

function getLatestRecord(records: AreaCountRecord[], params: {
  date: string;
  areaId: AreaId;
  discountTime: AreaCountDiscountTime;
}): AreaCountRecord | null {
  const matches = records.filter((record) => {
    return (
      record.date === params.date &&
      record.areaId === params.areaId &&
      record.discountTime === params.discountTime
    );
  });

  return matches.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).at(-1) ?? null;
}

type ReferenceRecords = {
  matchedRecords: AreaCountRecord[];
  longMatchedRecords: AreaCountRecord[];
  comparisonMode: AreaCountComparisonMode;
  weekdaySampleSize: number;
  fallbackSampleSize: number;
  forceFallbackWeekdayGroup: boolean;
  hasValidReference: boolean;
  threeDayHolidayMiddleReference?: NonNullable<
    AreaCountRecommendation["threeDayHolidayMiddleReference"]
  >;
};

function getReferenceRecords(params: {
  records: AreaCountRecord[];
  areaId: AreaId;
  discountTime: AreaCountDiscountTime;
  actualWeekday: ActualWeekdayLabel;
  fallbackWeekdayGroup: ActualWeekdayGroup;
  forceFallbackWeekdayGroup: boolean;
}): ReferenceRecords {
  const sameWeekdayAllRecords = params.records
    .filter((record) => {
      return (
        record.areaId === params.areaId &&
        record.discountTime === params.discountTime &&
        record.actualWeekday === params.actualWeekday
      );
    })
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  if (!params.forceFallbackWeekdayGroup && sameWeekdayAllRecords.length >= REQUIRED_SAMPLE_SIZE) {
    return {
      matchedRecords: sameWeekdayAllRecords.slice(-SHORT_REFERENCE_RECORDS),
      longMatchedRecords: sameWeekdayAllRecords.slice(-LONG_REFERENCE_RECORDS),
      comparisonMode: "weekday",
      weekdaySampleSize: sameWeekdayAllRecords.length,
      fallbackSampleSize: 0,
      forceFallbackWeekdayGroup: false,
      hasValidReference: true,
    };
  }

  const fallbackAllRecords = params.records
    .filter((record) => {
      return (
        record.areaId === params.areaId &&
        record.discountTime === params.discountTime &&
        record.actualWeekdayGroup === params.fallbackWeekdayGroup
      );
    })
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  return {
    matchedRecords: fallbackAllRecords.slice(-SHORT_REFERENCE_RECORDS),
    longMatchedRecords: fallbackAllRecords.slice(-LONG_REFERENCE_RECORDS),
    comparisonMode: "fallback_group",
    weekdaySampleSize: sameWeekdayAllRecords.length,
    fallbackSampleSize: fallbackAllRecords.length,
    forceFallbackWeekdayGroup: params.forceFallbackWeekdayGroup,
    hasValidReference: fallbackAllRecords.length >= REQUIRED_SAMPLE_SIZE,
  };
}

function getGuardedReferenceMedian(params: {
  shortRecords: AreaCountRecord[];
  longRecords: AreaCountRecord[];
  comparisonMode: Exclude<AreaCountComparisonMode, "three_day_holiday_middle">;
}): {
  shortMedianCount: number;
  longMedianCount: number;
  adoptedMedianCount: number;
  medianDownGuardApplied: boolean;
} {
  const shortMedianCount = getMedian(params.shortRecords.map((record) => record.count));
  const longMedianCount = getMedian(params.longRecords.map((record) => record.count));

  // 暫定グループはデータが少ない時の代替なので、まずは従来どおり直近中央値で判定する。
  if (params.comparisonMode === "fallback_group") {
    return {
      shortMedianCount,
      longMedianCount,
      adoptedMedianCount: shortMedianCount,
      medianDownGuardApplied: false,
    };
  }

  if (shortMedianCount >= longMedianCount) {
    return {
      shortMedianCount,
      longMedianCount,
      adoptedMedianCount: shortMedianCount,
      medianDownGuardApplied: false,
    };
  }

  const guardedMedianCount = Math.max(
    shortMedianCount,
    longMedianCount - MEDIAN_DOWN_GUARD_MAX_DROP
  );

  return {
    shortMedianCount,
    longMedianCount,
    adoptedMedianCount: guardedMedianCount,
    medianDownGuardApplied: guardedMedianCount !== shortMedianCount,
  };
}

type ReferenceMedian = ReturnType<typeof getGuardedReferenceMedian>;

function getThreeDayHolidayMiddleReference(params: {
  records: AreaCountRecord[];
  areaId: AreaId;
  discountTime: AreaCountDiscountTime;
  actualWeekday: ActualWeekdayLabel;
}): { reference: ReferenceRecords; referenceMedian?: ReferenceMedian } {
  const getGroupReference = (fallbackWeekdayGroup: ActualWeekdayGroup) =>
    getReferenceRecords({
      records: params.records,
      areaId: params.areaId,
      discountTime: params.discountTime,
      actualWeekday: params.actualWeekday,
      fallbackWeekdayGroup,
      forceFallbackWeekdayGroup: true,
    });

  const fireThursdaySundayReference = getGroupReference("火木日");
  const fridaySaturdayReference = getGroupReference("金土");
  const fireThursdaySundayValid = fireThursdaySundayReference.hasValidReference;
  const fridaySaturdayValid = fridaySaturdayReference.hasValidReference;

  const fireThursdaySundayMedian = fireThursdaySundayValid
    ? getGuardedReferenceMedian({
        shortRecords: fireThursdaySundayReference.matchedRecords,
        longRecords: fireThursdaySundayReference.longMatchedRecords,
        comparisonMode: "fallback_group",
      })
    : undefined;
  const fridaySaturdayMedian = fridaySaturdayValid
    ? getGuardedReferenceMedian({
        shortRecords: fridaySaturdayReference.matchedRecords,
        longRecords: fridaySaturdayReference.longMatchedRecords,
        comparisonMode: "fallback_group",
      })
    : undefined;

  const adoptedSource =
    fireThursdaySundayMedian && fridaySaturdayMedian
      ? "both"
      : fireThursdaySundayMedian
        ? "火木日"
        : fridaySaturdayMedian
          ? "金土"
          : "none";
  const validReferences = [
    fireThursdaySundayMedian
      ? { reference: fireThursdaySundayReference, median: fireThursdaySundayMedian }
      : null,
    fridaySaturdayMedian
      ? { reference: fridaySaturdayReference, median: fridaySaturdayMedian }
      : null,
  ].filter((item): item is { reference: ReferenceRecords; median: ReferenceMedian } => item !== null);

  const insufficientReference =
    fireThursdaySundayReference.fallbackSampleSize >= fridaySaturdayReference.fallbackSampleSize
      ? fireThursdaySundayReference
      : fridaySaturdayReference;
  const matchedRecords = validReferences.length > 0
    ? validReferences
        .flatMap((item) => item.reference.matchedRecords)
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    : insufficientReference.matchedRecords;
  const longMatchedRecords = validReferences.length > 0
    ? validReferences
        .flatMap((item) => item.reference.longMatchedRecords)
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    : insufficientReference.longMatchedRecords;

  const combineValidMedians = (
    selector: (median: ReferenceMedian) => number,
  ): number | undefined => {
    if (validReferences.length === 0) return undefined;
    return validReferences.reduce((sum, item) => sum + selector(item.median), 0) /
      validReferences.length;
  };

  const referenceMedian = validReferences.length > 0
    ? {
        shortMedianCount: combineValidMedians((median) => median.shortMedianCount) as number,
        longMedianCount: combineValidMedians((median) => median.longMedianCount) as number,
        adoptedMedianCount: combineValidMedians((median) => median.adoptedMedianCount) as number,
        medianDownGuardApplied: validReferences.some(
          (item) => item.median.medianDownGuardApplied,
        ),
      }
    : undefined;

  return {
    reference: {
      matchedRecords,
      longMatchedRecords,
      comparisonMode: "three_day_holiday_middle",
      weekdaySampleSize: 0,
      fallbackSampleSize: Math.max(
        fireThursdaySundayReference.fallbackSampleSize,
        fridaySaturdayReference.fallbackSampleSize,
      ),
      forceFallbackWeekdayGroup: true,
      hasValidReference: validReferences.length > 0,
      threeDayHolidayMiddleReference: {
        fireThursdaySundaySampleSize: fireThursdaySundayReference.fallbackSampleSize,
        fridaySaturdaySampleSize: fridaySaturdayReference.fallbackSampleSize,
        fireThursdaySundayMedianCount: fireThursdaySundayMedian?.adoptedMedianCount,
        fridaySaturdayMedianCount: fridaySaturdayMedian?.adoptedMedianCount,
        adoptedSource,
      },
    },
    referenceMedian,
  };
}

function getDecreaseRecommendation(params: {
  records: AreaCountRecord[];
  referenceCurrentRecords: AreaCountRecord[];
  date: string;
  areaId: AreaId;
  discountTime: DiscountTime;
  count: number;
}): DecreaseRecommendation {
  const requiredSampleSize = REQUIRED_SAMPLE_SIZE;
  const previousDiscountTime = getPreviousDiscountTimeForDecrease({
    areaId: params.areaId,
    discountTime: params.discountTime,
  });

  if (!previousDiscountTime) {
    return {
      canUse: false,
      sampleSize: 0,
      requiredSampleSize,
      direction: "none",
      detailLines: ["減り方補正：この時刻・エリアでは使いません。"],
    };
  }

  const previousRecord = getLatestRecord(params.records, {
    date: params.date,
    areaId: params.areaId,
    discountTime: previousDiscountTime,
  });

  if (!previousRecord || previousRecord.count <= 0) {
    return {
      canUse: false,
      sampleSize: 0,
      requiredSampleSize,
      previousDiscountTime,
      direction: "none",
      detailLines: ["減り方補正：前回時刻の残数がないため使いません。"],
    };
  }

  const currentDecreaseRate = (previousRecord.count - params.count) / previousRecord.count;

  const historicalRates = params.referenceCurrentRecords.flatMap((record): number[] => {
    if (record.date === params.date) return [];

    const pairedPreviousRecord = getLatestRecord(params.records, {
      date: record.date,
      areaId: params.areaId,
      discountTime: previousDiscountTime,
    });

    if (!pairedPreviousRecord || pairedPreviousRecord.count <= 0) return [];
    return [(pairedPreviousRecord.count - record.count) / pairedPreviousRecord.count];
  }).slice(-SHORT_REFERENCE_RECORDS);

  if (historicalRates.length < requiredSampleSize) {
    return {
      canUse: false,
      sampleSize: historicalRates.length,
      requiredSampleSize,
      previousDiscountTime,
      previousCount: previousRecord.count,
      currentDecreaseRate,
      direction: "none",
      detailLines: [
        `減り方補正：過去データ ${historicalRates.length}/${requiredSampleSize}件のため、今回は補正なし。`,
      ],
    };
  }

  const medianDecreaseRate = getMedianFloat(historicalRates);
  let direction: DecreaseAdjustmentDirection = "none";
  if (currentDecreaseRate <= medianDecreaseRate - DECREASE_RATE_THRESHOLD) {
    direction = "more_many";
  } else if (currentDecreaseRate >= medianDecreaseRate + DECREASE_RATE_THRESHOLD) {
    direction = "more_few";
  }

  const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

  return {
    canUse: true,
    sampleSize: historicalRates.length,
    requiredSampleSize,
    previousDiscountTime,
    previousCount: previousRecord.count,
    currentDecreaseRate,
    medianDecreaseRate,
    direction,
    detailLines: [
      `減り方：前回${previousRecord.count}個 → 今回${params.count}個（${formatPercent(currentDecreaseRate)}減）`,
      `過去の減り方中央値：${formatPercent(medianDecreaseRate)}減（同条件${historicalRates.length}件）`,
      direction === "more_many"
        ? "過去より減りが悪いため、1段階多い側へ補正。"
        : direction === "more_few"
        ? "過去より減りが良いため、1段階少ない側へ補正。"
        : "減り方は標準範囲のため、補正なし。",
    ],
  };
}

export function getAreaCountRecommendation(params: {
  records: AreaCountRecord[];
  areaId: AreaId | null;
  discountTime: DiscountTime | null | undefined;
  weekday: number | null | undefined;
  date: string | null | undefined;
  count: number;
}): AreaCountRecommendation {
  const requiredSampleSize = REQUIRED_SAMPLE_SIZE;
  const count = Math.max(0, Math.round(params.count));

  if (
    params.weekday === null ||
    params.weekday === undefined ||
    !params.date ||
    !isAreaCountAssistTarget({
      areaId: params.areaId,
      discountTime: params.discountTime,
    })
  ) {
    return {
      status: "disabled",
      count,
      sampleSize: 0,
      requiredSampleSize,
      matchedRecords: [],
      summaryText: "このエリア・時刻ではエリア残数判定は使いません。",
      detailLines: [],
    };
  }

  const areaId = params.areaId as AreaId;
  const discountTime = params.discountTime as AreaCountDiscountTime;
  const date = params.date as string;
  const actualWeekday = getActualWeekdayLabel(params.weekday);
  const actualWeekdayGroup = getAreaCountFallbackWeekdayGroup({
    weekday: params.weekday,
    discountTime,
    date,
  });
  const forceFallbackWeekdayGroup = shouldForceAreaCountFallbackWeekdayGroup({
    weekday: params.weekday,
    date,
  });
  // エリア判定の比較サンプルは「今日より前」の履歴だけを使う。
  // 同じ日・同じエリア・同じ時刻で複数記録がある場合は、最新の1件だけを採用する。
  // 呼び出し元がローカル・Supabase・混在データのどれでも、比較直前に
  // 旧曜日グループを現行仕様へ正規化してから参照する。
  const normalizedRecords = normalizeAreaCountRecords(params.records);
  const historicalRecords = getHistoricalAreaCountRecords(normalizedRecords, date);
  const recordsForDecrease = [
    ...historicalRecords,
    ...getCurrentDateAreaCountRecords(normalizedRecords, date),
  ];
  const middleReferenceResult = actualWeekdayGroup === "三連休中日"
    ? getThreeDayHolidayMiddleReference({
        records: historicalRecords,
        areaId,
        discountTime,
        actualWeekday,
      })
    : null;
  const reference = middleReferenceResult?.reference ?? getReferenceRecords({
    records: historicalRecords,
    areaId,
    discountTime,
    actualWeekday,
    fallbackWeekdayGroup: actualWeekdayGroup,
    forceFallbackWeekdayGroup,
  });
  const { matchedRecords, comparisonMode } = reference;

  if (!reference.hasValidReference) {
    const middleReference = reference.threeDayHolidayMiddleReference;
    return {
      status: "insufficient",
      count,
      sampleSize: matchedRecords.length,
      requiredSampleSize,
      matchedRecords,
      actualWeekday,
      actualWeekdayGroup,
      comparisonMode,
      threeDayHolidayMiddleReference: middleReference,
      summaryText: `過去データ ${matchedRecords.length}/${requiredSampleSize}件`,
      detailLines: comparisonMode === "three_day_holiday_middle" && middleReference
        ? [
            `今日の曜日：${actualWeekday}`,
            `火木日の記録：${middleReference.fireThursdaySundaySampleSize}/${requiredSampleSize}件`,
            `金土の記録：${middleReference.fridaySaturdaySampleSize}/${requiredSampleSize}件`,
            "三連休中日は、火木日と金土を別々に集計し、有効な基準ができるまで従来の履歴不足扱いにします。",
            `今回の${count}個も、判定後に履歴へ保存されます。`,
          ]
        : [
            `今日の曜日：${actualWeekday}`,
            `同じ曜日の記録：${reference.weekdaySampleSize}/${requiredSampleSize}件`,
            `暫定グループ（${actualWeekdayGroup}）の記録：${reference.fallbackSampleSize}/${requiredSampleSize}件`,
            reference.forceFallbackWeekdayGroup
              ? "祝日まわりのため、通常曜日データではなく暫定グループで判定します。"
              : "同じエリア・同じ時刻・同じ曜日の記録を優先し、足りない時だけ暫定グループで判定します。",
            `今回の${count}個も、判定後に履歴へ保存されます。`,
          ],
    };
  }

  const referenceMedian = middleReferenceResult?.referenceMedian ?? getGuardedReferenceMedian({
    shortRecords: matchedRecords,
    longRecords: reference.longMatchedRecords,
    comparisonMode: comparisonMode as Exclude<
      AreaCountComparisonMode,
      "three_day_holiday_middle"
    >,
  });
  if (!referenceMedian) {
    throw new Error("有効な残数比較基準がありません。");
  }
  const medianCount = referenceMedian.adoptedMedianCount;
  const baseEvaluationInfo = getEvaluationFromCount({
    count,
    referenceCount: medianCount,
  });
  const middleReference = reference.threeDayHolidayMiddleReference;
  const comparisonConditionLine = comparisonMode === "weekday"
    ? `比較条件：同じ曜日（${actualWeekday}）`
    : comparisonMode === "three_day_holiday_middle"
      ? "比較条件：通常の日曜夜（火木日）と金曜・土曜夜（金土）の中間"
      : `比較条件：暫定グループ（${actualWeekdayGroup}）`;
  const referenceSelectionLines = comparisonMode === "three_day_holiday_middle" && middleReference
    ? [
        `火木日の記録：${middleReference.fireThursdaySundaySampleSize}/${requiredSampleSize}件（採用基準 ${middleReference.fireThursdaySundayMedianCount ?? "なし"}個）`,
        `金土の記録：${middleReference.fridaySaturdaySampleSize}/${requiredSampleSize}件（採用基準 ${middleReference.fridaySaturdayMedianCount ?? "なし"}個）`,
        middleReference.adoptedSource === "both"
          ? `両グループを50対50で合成し、採用基準を${medianCount}個とします。`
          : `${middleReference.adoptedSource}だけに有効な基準があるため、${medianCount}個を採用します。`,
      ]
    : [
        `同じ曜日の記録：${reference.weekdaySampleSize}/${requiredSampleSize}件`,
        reference.forceFallbackWeekdayGroup
          ? "祝日まわりのため、通常曜日データではなく暫定グループを採用。"
          : "通常日は同じ曜日の記録を優先し、足りない時だけ暫定グループを採用。",
        comparisonMode === "weekday"
          ? `短期中央値：${referenceMedian.shortMedianCount}個（直近${matchedRecords.length}件）`
          : `暫定中央値：${referenceMedian.shortMedianCount}個（直近${matchedRecords.length}件）`,
        comparisonMode === "weekday"
          ? `長期中央値：${referenceMedian.longMedianCount}個（最大${reference.longMatchedRecords.length}件）`
          : "暫定グループは短期中央値で判定",
        referenceMedian.medianDownGuardApplied
          ? `短期が長期より少ないため、基準を下げすぎないように${medianCount}個で判定。`
          : `採用基準：${medianCount}個`,
      ];

  if (discountTime === "20") {
    const suggestedEvaluation = baseEvaluationInfo.evaluation;
    const areaRateAdjustment = evaluationToRateAdjustment(suggestedEvaluation);
    const finalTierDirection =
      suggestedEvaluation === "many" || suggestedEvaluation === "slightly_many"
        ? "中央値より上寄りのため、最終値引基準をC側へ1段階補正します。"
        : suggestedEvaluation === "few" || suggestedEvaluation === "slightly_few"
        ? "中央値より下寄りのため、最終値引基準をA側へ1段階補正します。"
        : "中央値付近のため、天候・曜日で決まった最終値引基準をそのまま使います。";

    return {
      status: "ready",
      count,
      sampleSize: matchedRecords.length,
      requiredSampleSize,
      matchedRecords,
      actualWeekday,
      actualWeekdayGroup,
      comparisonMode,
      threeDayHolidayMiddleReference: middleReference,
      medianCount,
      shortMedianCount: referenceMedian.shortMedianCount,
      longMedianCount: referenceMedian.longMedianCount,
      shortSampleSize: matchedRecords.length,
      longSampleSize: reference.longMatchedRecords.length,
      medianDownGuardApplied: referenceMedian.medianDownGuardApplied,
      smallDifferenceThreshold: baseEvaluationInfo.smallDifferenceThreshold,
      largeDifferenceThreshold: baseEvaluationInfo.largeDifferenceThreshold,
      lowerLargeThreshold: baseEvaluationInfo.lowerLargeThreshold,
      lowerSmallThreshold: baseEvaluationInfo.lowerSmallThreshold,
      upperSmallThreshold: baseEvaluationInfo.upperSmallThreshold,
      upperLargeThreshold: baseEvaluationInfo.upperLargeThreshold,
      baseEvaluation: suggestedEvaluation,
      suggestedEvaluation,
      suggestedJudge: evaluationToLegacyJudge(suggestedEvaluation),
      areaRateAdjustment,
      summaryText: finalTierDirection,
      detailLines: [
        `今日の曜日：${actualWeekday}`,
        comparisonConditionLine,
        ...referenceSelectionLines,
        `中央値より下寄り：${baseEvaluationInfo.lowerSmallThreshold}個以下`,
        `中央値付近：${baseEvaluationInfo.lowerSmallThreshold + 1}〜${baseEvaluationInfo.upperSmallThreshold - 1}個`,
        `中央値より上寄り：${baseEvaluationInfo.upperSmallThreshold}個以上`,
        `今回：${count}個`,
      ],
    };
  }

  const decreaseRecommendation = getDecreaseRecommendation({
    records: recordsForDecrease,
    referenceCurrentRecords: matchedRecords,
    date,
    areaId,
    discountTime,
    count,
  });

  let suggestedEvaluation = baseEvaluationInfo.evaluation;
  if (decreaseRecommendation.direction === "more_many") {
    suggestedEvaluation = scoreToEvaluation(getEvaluationScore(suggestedEvaluation) + 1);
  } else if (decreaseRecommendation.direction === "more_few") {
    suggestedEvaluation = scoreToEvaluation(getEvaluationScore(suggestedEvaluation) - 1);
  }

  const areaRateAdjustment = evaluationToRateAdjustment(suggestedEvaluation);

  return {
    status: "ready",
    count,
    sampleSize: matchedRecords.length,
    requiredSampleSize,
    matchedRecords,
    actualWeekday,
    actualWeekdayGroup,
    comparisonMode,
    threeDayHolidayMiddleReference: middleReference,
    medianCount,
    shortMedianCount: referenceMedian.shortMedianCount,
    longMedianCount: referenceMedian.longMedianCount,
    shortSampleSize: matchedRecords.length,
    longSampleSize: reference.longMatchedRecords.length,
    medianDownGuardApplied: referenceMedian.medianDownGuardApplied,
    smallDifferenceThreshold: baseEvaluationInfo.smallDifferenceThreshold,
    largeDifferenceThreshold: baseEvaluationInfo.largeDifferenceThreshold,
    lowerLargeThreshold: baseEvaluationInfo.lowerLargeThreshold,
    lowerSmallThreshold: baseEvaluationInfo.lowerSmallThreshold,
    upperSmallThreshold: baseEvaluationInfo.upperSmallThreshold,
    upperLargeThreshold: baseEvaluationInfo.upperLargeThreshold,
    baseEvaluation: baseEvaluationInfo.evaluation,
    suggestedEvaluation,
    suggestedJudge: evaluationToLegacyJudge(suggestedEvaluation),
    areaRateAdjustment,
    decreaseRecommendation,
    summaryText: `おすすめ：${evaluationText(suggestedEvaluation)}（表示値引率 ${formatRateAdjustment(areaRateAdjustment)}）`,
    detailLines: [
      `今日の曜日：${actualWeekday}`,
      comparisonConditionLine,
      ...referenceSelectionLines,
      `少ない：${baseEvaluationInfo.lowerLargeThreshold}個以下 / やや少ない：${baseEvaluationInfo.lowerSmallThreshold}個以下`,
      `やや多い：${baseEvaluationInfo.upperSmallThreshold}個以上 / 多い：${baseEvaluationInfo.upperLargeThreshold}個以上`,
      `今回：${count}個`,
      `残数判定：${evaluationText(baseEvaluationInfo.evaluation)}`,
      ...decreaseRecommendation.detailLines,
    ],
  };
}
