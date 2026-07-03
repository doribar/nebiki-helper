import type {
  ActualWeekdayGroup,
  ActualWeekdayLabel,
  AreaCountEvaluation,
  AreaId,
  AreaJudge,
  AreaRateAdjustment,
  DiscountTime,
  WeatherInput,
  WeekdayBaseLabel,
} from "./types";
import { resolveWeatherInputForDiscount } from "./hourlyWeather.ts";

export type AreaCountDiscountTime = DiscountTime;

export type AreaCountRecord = {
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
  /** legacy/manual fallback: 旧3段階の選択。 */
  userJudge?: Exclude<AreaJudge, null>;
  suggestedEvaluation?: AreaCountEvaluation;
  areaRateAdjustment?: AreaRateAdjustment;
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
  comparisonMode?: "weekday" | "fallback_group";
  medianCount?: number;
  shortMedianCount?: number;
  longMedianCount?: number;
  shortSampleSize?: number;
  longSampleSize?: number;
  medianDownGuardApplied?: boolean;
  comfortPoint?: number;
  comfortAdjustedMedianCount?: number;
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

const NO_AFTERNOON_ADD_AREA_IDS = new Set<AreaId>([
  "bento_men",
  "tempura",
  "ryomi",
  "yakitori",
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

export function getActualWeekdayGroup(weekday: number): ActualWeekdayGroup {
  switch (weekday) {
    case 1:
    case 3:
      return "月水";
    case 2:
    case 4:
      return "火木";
    case 0:
    case 5:
    case 6:
    default:
      return "金土日";
  }
}

export function getAreaCountFallbackWeekdayGroup(params: {
  weekday: number;
  discountTime: AreaCountDiscountTime;
}): ActualWeekdayGroup {
  // 日曜は、15時は製造量・売場作りに合わせて金土日寄り、17時以降は売れ方に合わせて火木寄りにする。
  if (params.weekday === 0 && params.discountTime !== "15") return "火木";
  return getActualWeekdayGroup(params.weekday);
}

export function getAreaCountSameItemLimit(_params: {
  weekdayBase?: WeekdayBaseLabel;
  weekday?: number;
  discountTime?: AreaCountDiscountTime;
}): number {
  // エリア残数入力の「同じ商品は〇個まで」は、曜日・時刻に関係なく常に10個に固定する。
  return 10;
}

function legacyWeekdayBaseToActualWeekdayGroup(weekdayBase: WeekdayBaseLabel | undefined): ActualWeekdayGroup | null {
  switch (weekdayBase) {
    case "月水":
      return "月水";
    case "火木":
      return "火木";
    case "金土":
    case "日":
      return "金土日";
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
  if (!params.areaId || !isAreaCountAssistDiscountTime(params.discountTime)) return false;

  // 20時30分は最終値引画面でエリア判定を行わない。
  return params.discountTime !== "20";
}

function cloneAreaCountRecord(record: AreaCountRecord): AreaCountRecord {
  return {
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
  return value === "月水" || value === "火木" || value === "金土日";
}

function isActualWeekdayLabel(value: unknown): value is ActualWeekdayLabel {
  return value === "日" || value === "月" || value === "火" || value === "水" || value === "木" || value === "金" || value === "土";
}

function inferWeekdayLabelFromDate(dateText: string): ActualWeekdayLabel | undefined {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return getActualWeekdayLabel(date.getDay());
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
    const actualWeekdayGroup = isActualWeekdayGroup(record.actualWeekdayGroup)
      ? record.actualWeekdayGroup
      : legacyWeekdayBaseToActualWeekdayGroup(legacyWeekdayBase);

    if (!actualWeekdayGroup) return [];

    const userJudge =
      record.userJudge === "many" || record.userJudge === "normal" || record.userJudge === "few"
        ? record.userJudge
        : undefined;

    return [
      {
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

function getTempComfortPoint(tempLevel: ReturnType<typeof resolveWeatherInputForDiscount>["tempLevel"]): number {
  switch (tempLevel) {
    case "5orLess":
    case "36orMore":
      return 2;
    case "6to10":
    case "31to35":
      return 1;
    case "11to15":
    case "16to20":
    case "21to25":
    case "26to27":
    case "28to30":
    case "26to30":
    default:
      return 0;
  }
}

function isComfortableTemp(tempLevel: ReturnType<typeof resolveWeatherInputForDiscount>["tempLevel"]): boolean {
  return tempLevel === "16to20" || tempLevel === "21to25" || tempLevel === "26to27";
}

function isColdTemp(tempLevel: ReturnType<typeof resolveWeatherInputForDiscount>["tempLevel"]): boolean {
  return tempLevel === "5orLess" || tempLevel === "6to10" || tempLevel === "11to15";
}

function getComfortPoint(params: {
  weather: WeatherInput;
  discountTime: DiscountTime;
}): { point: number; detailText: string } {
  const resolved = resolveWeatherInputForDiscount(params.weather, params.discountTime);
  let point = 0;
  const details: string[] = [];

  if (resolved.precipitationRateBonus >= 20) {
    point += 3;
    details.push("雪が続くため+3");
  } else if (resolved.precipitationRateBonus >= 15) {
    point += 2;
    details.push("雪のため+2");
  } else if (resolved.precipitationRateBonus >= 10) {
    point += 2;
    details.push("雨が続くため+2");
  } else if (resolved.precipitationRateBonus >= 5) {
    point += 1;
    details.push("雨のため+1");
  }

  const tempPoint = getTempComfortPoint(resolved.tempLevel);
  if (tempPoint > 0) {
    point += tempPoint;
    details.push(`気温で+${tempPoint}`);
  }

  if (resolved.windLevel === "5orMore") {
    point += 1;
    details.push("強い風で+1");
    if (isColdTemp(resolved.tempLevel)) {
      point += 1;
      details.push("寒さと風でさらに+1");
    }
  }

  if (
    point === 0 &&
    resolved.precipitationRateBonus === 0 &&
    isComfortableTemp(resolved.tempLevel) &&
    resolved.windLevel === "2orLess"
  ) {
    point -= 1;
    details.push("快適な天候のため-1");
  }

  const clamped = clamp(point, -1, 3);
  if (details.length === 0) details.push("通常の天候のため0");

  return {
    point: clamped,
    detailText: details.join(" / "),
  };
}

function adjustMedianByComfort(medianCount: number, comfortPoint: number): number {
  const factor = 1 - comfortPoint * 0.05;
  return Math.max(0, Math.round(medianCount * factor));
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

  if (params.discountTime === "18") return "17";
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

function getReferenceRecords(params: {
  records: AreaCountRecord[];
  areaId: AreaId;
  discountTime: AreaCountDiscountTime;
  actualWeekday: ActualWeekdayLabel;
  fallbackWeekdayGroup: ActualWeekdayGroup;
}): {
  matchedRecords: AreaCountRecord[];
  longMatchedRecords: AreaCountRecord[];
  comparisonMode: "weekday" | "fallback_group";
  weekdaySampleSize: number;
  fallbackSampleSize: number;
} {
  const sameWeekdayAllRecords = params.records
    .filter((record) => {
      return (
        record.areaId === params.areaId &&
        record.discountTime === params.discountTime &&
        record.actualWeekday === params.actualWeekday
      );
    })
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  if (sameWeekdayAllRecords.length >= REQUIRED_SAMPLE_SIZE) {
    return {
      matchedRecords: sameWeekdayAllRecords.slice(-SHORT_REFERENCE_RECORDS),
      longMatchedRecords: sameWeekdayAllRecords.slice(-LONG_REFERENCE_RECORDS),
      comparisonMode: "weekday",
      weekdaySampleSize: sameWeekdayAllRecords.length,
      fallbackSampleSize: 0,
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
  };
}

function getGuardedReferenceMedian(params: {
  shortRecords: AreaCountRecord[];
  longRecords: AreaCountRecord[];
  comparisonMode: "weekday" | "fallback_group";
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
  weather: WeatherInput | null | undefined;
  date: string | null | undefined;
  count: number;
}): AreaCountRecommendation {
  const requiredSampleSize = REQUIRED_SAMPLE_SIZE;
  const count = Math.max(0, Math.round(params.count));

  if (
    params.weekday === null ||
    params.weekday === undefined ||
    !params.weather ||
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
      detailLines: ["20時30分の最終値引では、従来どおり数量別の最終値引を使います。"],
    };
  }

  const areaId = params.areaId as AreaId;
  const discountTime = params.discountTime as AreaCountDiscountTime;
  const weather = params.weather as WeatherInput;
  const date = params.date as string;
  const actualWeekday = getActualWeekdayLabel(params.weekday);
  const actualWeekdayGroup = getAreaCountFallbackWeekdayGroup({
    weekday: params.weekday,
    discountTime,
  });
  // エリア判定の比較サンプルは「今日より前」の履歴だけを使う。
  // 同じ日・同じエリア・同じ時刻で複数記録がある場合は、最新の1件だけを採用する。
  const historicalRecords = getHistoricalAreaCountRecords(params.records, date);
  const recordsForDecrease = [
    ...historicalRecords,
    ...getCurrentDateAreaCountRecords(params.records, date),
  ];
  const reference = getReferenceRecords({
    records: historicalRecords,
    areaId,
    discountTime,
    actualWeekday,
    fallbackWeekdayGroup: actualWeekdayGroup,
  });
  const { matchedRecords, comparisonMode } = reference;

  if (matchedRecords.length < requiredSampleSize) {
    return {
      status: "insufficient",
      count,
      sampleSize: matchedRecords.length,
      requiredSampleSize,
      matchedRecords,
      actualWeekday,
      actualWeekdayGroup,
      comparisonMode,
      summaryText: `過去データ ${matchedRecords.length}/${requiredSampleSize}件`,
      detailLines: [
        `今日の曜日：${actualWeekday}`,
        `同じ曜日の記録：${reference.weekdaySampleSize}/${requiredSampleSize}件`,
        `暫定グループ（${actualWeekdayGroup}）の記録：${reference.fallbackSampleSize}/${requiredSampleSize}件`,
        "同じエリア・同じ時刻・同じ曜日の記録を優先し、足りない時だけ暫定グループで判定します。",
        `今回の${count}個も、判定後に履歴へ保存されます。`,
      ],
    };
  }

  const referenceMedian = getGuardedReferenceMedian({
    shortRecords: matchedRecords,
    longRecords: reference.longMatchedRecords,
    comparisonMode,
  });
  const medianCount = referenceMedian.adoptedMedianCount;
  const comfort = getComfortPoint({ weather, discountTime });
  const comfortAdjustedMedianCount = adjustMedianByComfort(medianCount, comfort.point);
  const baseEvaluationInfo = getEvaluationFromCount({
    count,
    referenceCount: comfortAdjustedMedianCount,
  });
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
    medianCount,
    shortMedianCount: referenceMedian.shortMedianCount,
    longMedianCount: referenceMedian.longMedianCount,
    shortSampleSize: matchedRecords.length,
    longSampleSize: reference.longMatchedRecords.length,
    medianDownGuardApplied: referenceMedian.medianDownGuardApplied,
    comfortPoint: comfort.point,
    comfortAdjustedMedianCount,
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
      comparisonMode === "weekday"
        ? `比較条件：同じ曜日（${actualWeekday}）`
        : `比較条件：暫定グループ（${actualWeekdayGroup}）`,
      `同じ曜日の記録：${reference.weekdaySampleSize}/${requiredSampleSize}件`,
      comparisonMode === "weekday"
        ? `短期中央値：${referenceMedian.shortMedianCount}個（直近${matchedRecords.length}件）`
        : `暫定中央値：${referenceMedian.shortMedianCount}個（直近${matchedRecords.length}件）`,
      comparisonMode === "weekday"
        ? `長期中央値：${referenceMedian.longMedianCount}個（最大${reference.longMatchedRecords.length}件）`
        : `暫定グループは短期中央値で判定`,
      referenceMedian.medianDownGuardApplied
        ? `短期が長期より少ないため、基準を下げすぎないように${medianCount}個で判定。`
        : `採用基準：${medianCount}個`,
      `快適度ポイント：${comfort.point}（${comfort.detailText}）`,
      `快適度補正後の基準：${comfortAdjustedMedianCount}個`,
      `少ない：${baseEvaluationInfo.lowerLargeThreshold}個以下 / やや少ない：${baseEvaluationInfo.lowerSmallThreshold}個以下`,
      `やや多い：${baseEvaluationInfo.upperSmallThreshold}個以上 / 多い：${baseEvaluationInfo.upperLargeThreshold}個以上`,
      `今回：${count}個`,
      `残数のみの判定：${evaluationText(baseEvaluationInfo.evaluation)}`,
      ...decreaseRecommendation.detailLines,
    ],
  };
}
