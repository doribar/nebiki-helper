import type {
  BasisGuideDisplay,
  DiscountTime,
  TempLevel,
  WeatherGuideText,
  ResolvedWeatherInput,
  WeekdayBaseInfo,
  WeekdayBaseLabel,
  WindLevel,
} from "./types";
import {
  addDaysToDateString,
  isHolidayBeforeNormalWeekday,
  isJapaneseHolidayOrWeekend,
  isThreeDayHolidayMiddle,
} from "./japaneseHoliday.ts";
import { getBaseRate } from "./discount.ts";

type ShiftTerm = {
  label: string;
  value: number;
};

type PercentTerm = {
  label: string;
  value: number;
};

function getBasisTimeText(discountTime: DiscountTime): string {
  switch (discountTime) {
    case "15":
      return "15時";
    case "17":
      return "17時";
    case "18":
      return "18時30分";
    case "19":
      return "19時30分";
    case "20":
      return "20時30分";
  }
}

function getActualWeekdayText(weekday: number): string {
  switch (weekday) {
    case 0:
      return "日曜日";
    case 1:
      return "月曜日";
    case 2:
      return "火曜日";
    case 3:
      return "水曜日";
    case 4:
      return "木曜日";
    case 5:
      return "金曜日";
    case 6:
      return "土曜日";
    default:
      return "不明曜日";
  }
}

export function getOriginalWeekdayBase(weekday: number): WeekdayBaseLabel {
  switch (weekday) {
    case 0:
    case 5:
    case 6:
      return "金土";
    case 2:
    case 4:
      return "火木";
    case 1:
    case 3:
      return "月水";
    default:
      return "火木";
  }
}

function formatSignedValue(value: number, unit: string): string {
  if (value > 0) {
    return `+${value}${unit}`;
  }

  if (value < 0) {
    return `${value}${unit}`;
  }

  return `0${unit}`;
}

function buildCalcText(title: string, parts: string[]): string | undefined {
  if (parts.length === 0) {
    return undefined;
  }

  return `${title}：${parts.join(" ＋ ")}`;
}

function buildResultText(params: {
  label: string;
  total: number;
  unit: string;
  suffix?: string;
}): string {
  const suffix = params.suffix ? `、${params.suffix}` : "";
  return `計算の結果、${params.label}は${formatSignedValue(params.total, params.unit)}${suffix}。`;
}

function formatSignedPercentCompact(value: number): string {
  if (value > 0) {
    return `+${value}％`;
  }

  if (value < 0) {
    return `${value}％`;
  }

  return "0％";
}

function buildBonusSummaryText(totalBonus: number): string {
  if (totalBonus === 0) {
    return "値引率補正：なし";
  }

  return `値引率補正：${formatSignedPercentCompact(totalBonus)}`;
}

function getBaseTempShift(tempLevel: TempLevel): number {
  switch (tempLevel) {
    case "5orLess":
      return 2;
    case "6to10":
      return 1;
    case "11to15":
      return 0;
    case "16to20":
      return -1;
    case "21to25":
      return -2;
    case "26to27":
    case "26to30":
      return -1;
    case "28to30":
      return 0;
    case "31to35":
      return 1;
    case "36orMore":
      return 2;
  }
}

function getTempLevelText(tempLevel: TempLevel): string {
  switch (tempLevel) {
    case "5orLess":
      return "5度以下";
    case "6to10":
      return "6〜10度";
    case "11to15":
      return "11〜15度";
    case "16to20":
      return "16〜20度";
    case "21to25":
      return "21〜25度";
    case "26to27":
      return "26〜27度";
    case "26to30":
      return "26〜30度";
    case "28to30":
      return "28〜30度";
    case "31to35":
      return "31〜35度";
    case "36orMore":
      return "36度以上";
  }
}

function getBaseTempShiftTerm(
  weather: ResolvedWeatherInput,
  discountTime: DiscountTime,
): ShiftTerm | undefined {
  const value = getBaseTempShift(weather.tempLevel);
  if (value === 0) {
    return undefined;
  }

  return {
    label: `${getNearForecastHourText(discountTime)}気温 ${getTempLevelText(weather.tempLevel)}`,
    value,
  };
}

function getWeatherPointShift(weather: ResolvedWeatherInput): number {
  return weather.weatherPointShift;
}

function getWeatherPointShiftTerm(
  weather: ResolvedWeatherInput,
): ShiftTerm | undefined {
  if (
    weather.weatherPointShift === 0 ||
    weather.weatherPointRangeText === null
  ) {
    return undefined;
  }

  return {
    label: `未来天候ポイント ${formatSignedValue(weather.weatherPointScore, "pt")}（${weather.weatherPointRangeText}）`,
    value: weather.weatherPointShift,
  };
}

function isWindThresholdMet(
  tempLevel: TempLevel,
  windLevel: WindLevel,
): boolean {
  const is15OrLess =
    tempLevel === "5orLess" || tempLevel === "6to10" || tempLevel === "11to15";

  if (is15OrLess) {
    return windLevel === "3to4" || windLevel === "5orMore";
  }

  return windLevel === "5orMore";
}

function getWindShift(tempLevel: TempLevel, windLevel: WindLevel): number {
  if (!isWindThresholdMet(tempLevel, windLevel)) {
    return 0;
  }

  const is15OrLess =
    tempLevel === "5orLess" || tempLevel === "6to10" || tempLevel === "11to15";

  if (is15OrLess && windLevel === "5orMore") {
    return 2;
  }

  return 1;
}

function getWindShiftTerm(
  tempLevel: TempLevel,
  windLevel: WindLevel,
): ShiftTerm | undefined {
  if (!isWindThresholdMet(tempLevel, windLevel)) {
    return undefined;
  }

  const is15OrLess =
    tempLevel === "5orLess" || tempLevel === "6to10" || tempLevel === "11to15";

  if (is15OrLess) {
    if (windLevel === "5orMore") {
      return { label: "風 5m以上（15度以下）", value: 2 };
    }

    return { label: "風 3〜4m（15度以下）", value: 1 };
  }

  return {
    label: "風 5m以上",
    value: 1,
  };
}

function getAfterRainRecoveryShift(_weather: ResolvedWeatherInput): number {
  return 0;
}

function getAfterRainRecoveryShiftTerm(
  _weather: ResolvedWeatherInput,
): ShiftTerm | undefined {
  return undefined;
}

function getPrecipitationRateBonus(weather: ResolvedWeatherInput): number {
  if (typeof weather.precipitationRateBonus === "number") {
    return weather.precipitationRateBonus;
  }

  // 旧データ互換: 以前のResolvedWeatherInputには直近1枠の雨雪だけが入っていた。
  switch (weather.nearTermWeather) {
    case "rain":
      return 10;
    case "snow":
      return 20;
    default:
      return 0;
  }
}

function getNearForecastHourText(discountTime: DiscountTime): string {
  switch (discountTime) {
    case "15":
      return "16時";
    case "17":
      return "18時";
    case "18":
      return "19時";
    case "19":
      return "20時";
    case "20":
      return "21時";
  }
}

function getPrecipitationRateBonusTerm(
  weather: ResolvedWeatherInput,
  discountTime: DiscountTime,
): PercentTerm | undefined {
  const value = getPrecipitationRateBonus(weather);
  if (value === 0) {
    return undefined;
  }

  if (weather.precipitationRateBonusLabel) {
    return { label: weather.precipitationRateBonusLabel, value };
  }

  // 旧データ互換: 以前のResolvedWeatherInputには直近1枠の雨雪だけが入っていた。
  const hourText = getNearForecastHourText(discountTime);
  switch (weather.nearTermWeather) {
    case "rain":
      return { label: `${hourText}に雨`, value };
    case "snow":
      return { label: `${hourText}に雪`, value };
    default:
      return undefined;
  }
}

function parseMonthDay(
  dateString: string,
): { month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;

  return {
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function isGoldenWeekWindow(dateString: string): boolean {
  const monthDay = parseMonthDay(dateString);
  if (!monthDay) return false;

  if (monthDay.month === 4) {
    return monthDay.day >= 29;
  }

  if (monthDay.month === 5) {
    return monthDay.day <= 6;
  }

  return false;
}

function isThirdDayOfConsecutiveHolidayOrWeekend(dateString: string): boolean {
  if (!isJapaneseHolidayOrWeekend(dateString)) {
    return false;
  }

  const dayBefore1 = addDaysToDateString(dateString, -1);
  const dayBefore2 = addDaysToDateString(dateString, -2);
  const dayBefore3 = addDaysToDateString(dateString, -3);

  return (
    isJapaneseHolidayOrWeekend(dayBefore1) &&
    isJapaneseHolidayOrWeekend(dayBefore2) &&
    !isJapaneseHolidayOrWeekend(dayBefore3)
  );
}

function isDayAfterGoldenWeekThirdConsecutiveHoliday(
  dateString?: string,
): boolean {
  if (!dateString) {
    return false;
  }

  const previousDate = addDaysToDateString(dateString, -1);

  return (
    isGoldenWeekWindow(previousDate) &&
    isThirdDayOfConsecutiveHolidayOrWeekend(previousDate)
  );
}

function getGoldenWeekAfterPeakShift(discountTime: DiscountTime): number {
  if (discountTime === "15") {
    return 1;
  }

  if (discountTime === "17") {
    return 2;
  }

  return 0;
}

function getGoldenWeekAfterPeakShiftTerm(params: {
  date?: string;
  discountTime: DiscountTime;
}): ShiftTerm | undefined {
  if (!isDayAfterGoldenWeekThirdConsecutiveHoliday(params.date)) {
    return undefined;
  }

  const value = getGoldenWeekAfterPeakShift(params.discountTime);
  if (value === 0) {
    return undefined;
  }

  return {
    label: "GW連休3日目の翌日",
    value,
  };
}


function getWeekdayBaseRank(label: WeekdayBaseLabel): number {
  switch (label) {
    case "日":
    case "金土":
      return 1;
    case "火木":
      return 2;
    case "月水":
      return 3;
  }
}

function rankToWeekdayBase(rank: number): WeekdayBaseLabel {
  switch (Math.max(1, Math.min(rank, 3))) {
    case 1:
      return "金土";
    case 2:
      return "火木";
    case 3:
      return "月水";
    default:
      return "火木";
  }
}

function getRelaxFloor(_discountTime: DiscountTime): WeekdayBaseLabel {
  return "金土";
}

function applyWeekdayShift(params: {
  base: WeekdayBaseLabel;
  discountTime: DiscountTime;
  shift: number;
}): {
  adjusted: WeekdayBaseLabel;
  overflowDirection: "up" | "down" | null;
  overflowSteps: number;
} {
  const currentRank = getWeekdayBaseRank(params.base);

  if (params.shift > 0) {
    const targetRank = currentRank + params.shift;
    const ceilingRank = getWeekdayBaseRank("月水");
    const adjustedRank = Math.min(targetRank, ceilingRank);

    return {
      adjusted: rankToWeekdayBase(adjustedRank),
      overflowDirection: targetRank > adjustedRank ? "up" : null,
      overflowSteps: Math.max(0, targetRank - ceilingRank),
    };
  }

  if (params.shift < 0) {
    const targetRank = currentRank + params.shift;
    const floorRank = getWeekdayBaseRank(getRelaxFloor(params.discountTime));
    const adjustedRank = Math.max(targetRank, floorRank);

    return {
      adjusted: rankToWeekdayBase(adjustedRank),
      overflowDirection: targetRank < adjustedRank ? "down" : null,
      overflowSteps: Math.max(0, floorRank - targetRank),
    };
  }

  return {
    adjusted: params.base,
    overflowDirection: null,
    overflowSteps: 0,
  };
}

function clampComfortScore(score: number): -2 | -1 | 0 | 1 | 2 {
  return Math.max(-2, Math.min(2, score)) as -2 | -1 | 0 | 1 | 2;
}

function getComfortText(score: number): string {
  switch (clampComfortScore(score)) {
    case -2:
      return "超快適";
    case -1:
      return "快適";
    case 1:
      return "少し不快";
    case 2:
      return "不快";
    case 0:
    default:
      return "普通";
  }
}

function isRainPrecipitationBonus(value: number): boolean {
  return value > 0 && value < 15;
}

function isSnowPrecipitationBonus(value: number): boolean {
  return value >= 15;
}

function applyComfortNegativeLimit(params: {
  rawScore: number;
  discountTime: DiscountTime;
  hasRain: boolean;
}): { score: -2 | -1 | 0 | 1 | 2; note?: string } {
  const rawScore = clampComfortScore(params.rawScore);

  if (rawScore >= 0) {
    return { score: rawScore };
  }

  if (params.discountTime === "15") {
    if (params.hasRain && rawScore < -1) {
      return { score: -1, note: "雨あり15時のため快適方向は-5%まで" };
    }

    return { score: rawScore };
  }

  if (params.hasRain) {
    return { score: 0, note: "17時以降の雨ありのため快適方向は0%" };
  }

  if (rawScore < -1) {
    return { score: -1, note: "17時以降のため快適方向は-5%まで" };
  }

  return { score: rawScore };
}

function getComfortRateBonusTerm(params: {
  discountTime: DiscountTime;
  rawScore: number;
  precipitationBonus: number;
}): PercentTerm | undefined {
  if (isSnowPrecipitationBonus(params.precipitationBonus)) return undefined;

  const rawScore = clampComfortScore(params.rawScore);
  if (rawScore === 0) return undefined;

  const limited = applyComfortNegativeLimit({
    rawScore,
    discountTime: params.discountTime,
    hasRain: isRainPrecipitationBonus(params.precipitationBonus),
  });
  const value = limited.score * 5;
  const note = limited.note ? `（${limited.note}）` : "";

  return {
    label: `快適度補正：${getComfortText(rawScore)}${note}`,
    value,
  };
}

function toComfortScoreCalcPart(term: ShiftTerm): string {
  return `${term.label} ${formatSignedValue(term.value, "点")}`;
}

function toPercentCalcPart(term: PercentTerm): string {
  return `${term.label} ${formatSignedValue(term.value, "%")}`;
}

function buildPercentResultText(totalBonus: number): string | undefined {
  return buildResultText({
    label: "値引率補正",
    total: totalBonus,
    unit: "%",
    suffix: totalBonus === 0 ? "補正はありません" : undefined,
  });
}

function joinBonusCalculationParts(parts: string[]): string | undefined {
  return buildCalcText("値引率補正の内訳", parts);
}

export function buildMergedBonusDisplay(params: {
  baseBonusParts?: string[];
  baseRateBonus: number;
  lateTimeBonus: number;
  extraBonusTerms?: PercentTerm[];
}): Pick<
  BasisGuideDisplay,
  | "bonusSummaryText"
  | "bonusDetailLines"
  | "bonusCalcText"
  | "bonusResultText"
  | "bonusCalcParts"
  | "bonusTotal"
> {
  const parts = [...(params.baseBonusParts ?? [])];

  if (params.lateTimeBonus !== 0) {
    parts.push(
      `次の基準時刻が近い ${formatSignedValue(params.lateTimeBonus, "%")}`,
    );
  }

  const extraBonusTerms = params.extraBonusTerms ?? [];
  for (const term of extraBonusTerms) {
    parts.push(toPercentCalcPart(term));
  }

  const extraBonusTotal = extraBonusTerms.reduce(
    (sum, term) => sum + term.value,
    0,
  );
  const total = params.baseRateBonus + params.lateTimeBonus + extraBonusTotal;

  return {
    bonusSummaryText: buildBonusSummaryText(total),
    bonusDetailLines: parts,
    bonusCalcParts: parts,
    bonusTotal: total,
    bonusCalcText: joinBonusCalculationParts(parts),
    bonusResultText:
      parts.length > 0 ? buildPercentResultText(total) : undefined,
  };
}

function resolveWeatherEffect(params: {
  date?: string;
  weekday: number;
  discountTime: DiscountTime;
  weather: ResolvedWeatherInput;
}) {
  // 旧形式の保存データ互換用。値引率の計算には使わない。
  const original = getOriginalWeekdayBase(params.weekday);
  const noticeText = undefined;

  const comfortShiftTerms = [
    getBaseTempShiftTerm(params.weather, params.discountTime),
    getWindShiftTerm(params.weather.tempLevel, params.weather.windLevel),
    getWeatherPointShiftTerm(params.weather),
    getAfterRainRecoveryShiftTerm(params.weather),
    getGoldenWeekAfterPeakShiftTerm({
      date: params.date,
      discountTime: params.discountTime,
    }),
  ].filter((value): value is ShiftTerm => Boolean(value));

  const rawComfortShift =
    getBaseTempShift(params.weather.tempLevel) +
    getWindShift(params.weather.tempLevel, params.weather.windLevel) +
    getWeatherPointShift(params.weather) +
    getAfterRainRecoveryShift(params.weather) +
    (isDayAfterGoldenWeekThirdConsecutiveHoliday(params.date)
      ? getGoldenWeekAfterPeakShift(params.discountTime)
      : 0);

  // 旧形式の保存データ互換用。値引率の計算には使わない。
  const shifted = applyWeekdayShift({
    base: original,
    discountTime: params.discountTime,
    shift: rawComfortShift,
  });

  const precipitationBonus = getPrecipitationRateBonus(params.weather);
  const precipitationTerm = getPrecipitationRateBonusTerm(
    params.weather,
    params.discountTime,
  );
  const comfortTerm = getComfortRateBonusTerm({
    discountTime: params.discountTime,
    rawScore: rawComfortShift,
    precipitationBonus,
  });

  const percentTerms = [
    comfortTerm,
    precipitationTerm,
  ].filter((value): value is PercentTerm => Boolean(value));

  const baseRateBonus = percentTerms.reduce((sum, term) => sum + term.value, 0);
  const basicRate = getBaseRate(params.discountTime, {
    weekday: params.weekday,
    date: params.date,
  });
  const rawComfortScore = clampComfortScore(rawComfortShift);
  const finalComfortScore = isSnowPrecipitationBonus(precipitationBonus)
    ? 0
    : applyComfortNegativeLimit({
        rawScore: rawComfortScore,
        discountTime: params.discountTime,
        hasRain: isRainPrecipitationBonus(precipitationBonus),
      }).score;

  const basisTimeText = getBasisTimeText(params.discountTime);
  const weekdaySummaryText = `基本値引率：${basicRate}%（${basisTimeText}）`;
  const weekdayDetailLines: string[] = [];
  const weekdayCalcText = `基本値引率の内訳：${basisTimeText} → ${basicRate}%`;
  const weekdayResultText = `基本値引率は${basicRate}%です。曜日差はエリア残数判定で反映します。`;
  const comfortCalcParts = comfortShiftTerms.map(toComfortScoreCalcPart);
  const comfortDetailLine = isSnowPrecipitationBonus(precipitationBonus)
    ? "雪のため快適度補正は使いません。"
    : `快適度：${getComfortText(rawComfortScore)}（快適度補正 ${formatSignedValue(finalComfortScore * 5, "%")}）`;
  const bonusCalcParts = percentTerms.map(toPercentCalcPart);
  const bonusSummaryText = buildBonusSummaryText(baseRateBonus);
  const bonusDetailLines = [
    ...(comfortCalcParts.length > 0
      ? [`快適度計算：${comfortCalcParts.join(" ＋ ")}`]
      : []),
    comfortDetailLine,
    ...bonusCalcParts,
  ];
  const bonusCalcText = joinBonusCalculationParts(bonusCalcParts);
  const bonusResultText =
    bonusCalcParts.length > 0
      ? buildPercentResultText(baseRateBonus)
      : undefined;

  return {
    original,
    adjusted: shifted.adjusted,
    noticeText,
    weekdaySummaryText,
    weekdayDetailLines,
    weekdayCalcText,
    weekdayResultText,
    bonusSummaryText,
    bonusDetailLines,
    bonusCalcText,
    bonusResultText,
    bonusCalcParts,
    totalShift: rawComfortShift,
    baseRateBonus,
  };
}

export function getWeekdayBaseInfo(
  weekday: number,
  discountTime: DiscountTime,
  weather: ResolvedWeatherInput,
  date?: string,
): WeekdayBaseInfo {
  const resolved = resolveWeatherEffect({
    date,
    weekday,
    discountTime,
    weather,
  });

  return {
    original: resolved.original,
    adjusted: resolved.adjusted,
    changedByWeather: resolved.adjusted !== resolved.original,
    weekdayShift: resolved.totalShift,
    baseRateBonus: resolved.baseRateBonus,
    baseRateBonusReason:
      resolved.baseRateBonus !== 0 && resolved.bonusCalcText
        ? [resolved.bonusCalcText, resolved.bonusResultText ?? ""]
        : [],
  };
}

export function getBasisGuideDisplay(params: {
  date?: string;
  weekday: number;
  discountTime: DiscountTime;
  weather: ResolvedWeatherInput;
}): BasisGuideDisplay {
  const resolved = resolveWeatherEffect(params);
  const useThreeDayHolidayMiddleReference =
    params.discountTime !== "15" &&
    typeof params.date === "string" &&
    isThreeDayHolidayMiddle(params.date);
  const useHolidayBeforeNormalWeekdayReference =
    typeof params.date === "string" &&
    !useThreeDayHolidayMiddleReference &&
    isHolidayBeforeNormalWeekday(params.date);

  return {
    noticeText: resolved.noticeText,
    weekdaySummaryText: resolved.weekdaySummaryText,
    weekdayDetailLines: resolved.weekdayDetailLines,
    weekdayCalcText: resolved.weekdayCalcText,
    weekdayResultText: resolved.weekdayResultText,
    bonusSummaryText: resolved.bonusSummaryText,
    bonusDetailLines: resolved.bonusDetailLines,
    bonusCalcText: resolved.bonusCalcText,
    bonusResultText: resolved.bonusResultText,
    bonusCalcParts: resolved.bonusCalcParts,
    bonusTotal: resolved.baseRateBonus,
    referenceText: useThreeDayHolidayMiddleReference
      ? "通常の日曜夜と金曜・土曜夜の中間を基準に考えて"
      : useHolidayBeforeNormalWeekdayReference
        ? `日曜日の${getBasisTimeText(params.discountTime)}を基準に考えて`
        : `${getActualWeekdayText(params.weekday)}の${getBasisTimeText(params.discountTime)}を基準に考えて`,
  };
}

export function getWeatherGuideText(): WeatherGuideText {
  return {
    nearTermWeatherGuide: "起点時刻の雨雪で値引率を補正（雨+5%、起点雨かつその後も雨+10%、雪+15%、起点雪かつその後も雪+20%）",
    laterPrecipGuide: "1時間30分後以降の天候は未来天候ポイントで加減算",
    laterPrecipTypeGuide: "未来の雨・雪・風もポイントに含める",
    windGuide: "30分〜1時間後の風速を選択",
    tempGuide: "30分〜1時間後はベース、以降はポイントとして使う",
  };
}
