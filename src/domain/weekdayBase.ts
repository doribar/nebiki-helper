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
  isJapaneseHolidayOrObserved,
  isJapaneseHolidayOrWeekend,
} from "./japaneseHoliday.ts";

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

function getWeekdayBaseRank(label: WeekdayBaseLabel): number {
  switch (label) {
    // 旧データ互換: 以前の「日」基準は、現在は15時の金土日基準に統合する。
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

function isNightFloorTime(discountTime: DiscountTime): boolean {
  return (
    discountTime === "17" ||
    discountTime === "18" ||
    discountTime === "19" ||
    discountTime === "20"
  );
}

function getHolidayAdjustedWeekdayBase(params: {
  date?: string;
  weekday: number;
  discountTime: DiscountTime;
}): { original: WeekdayBaseLabel; noticeText?: string } {
  const isHoliday = Boolean(
    params.date && isJapaneseHolidayOrObserved(params.date),
  );

  if (isHoliday) {
    if (params.discountTime === "15") {
      return {
        original: "金土",
        noticeText: "祝日の15時は金曜・土曜・日曜の基準を使います。",
      };
    }

    if (isNightFloorTime(params.discountTime) && params.date) {
      const nextDate = addDaysToDateString(params.date, 1);
      if (isJapaneseHolidayOrWeekend(nextDate)) {
        return {
          original: "金土",
          noticeText:
            "祝日の17時以降で翌日も休日・祝日のため、金曜・土曜の基準を使います。",
        };
      }

      return {
        original: "火木",
        noticeText:
          "祝日の17時以降で翌日が平日のため、火曜・木曜の基準を使います。",
      };
    }
  }

  if (params.weekday === 0 && isNightFloorTime(params.discountTime)) {
    return {
      original: "火木",
      noticeText:
        "日曜日の17時以降は客足が減るため、火曜・木曜の基準を使います。",
    };
  }

  return { original: getOriginalWeekdayBase(params.weekday) };
}

function getRelaxFloor(_discountTime: DiscountTime): WeekdayBaseLabel {
  return "金土";
}

function getWeekdayBaseDisplayLabel(
  label: WeekdayBaseLabel,
  discountTime: DiscountTime,
): string {
  switch (label) {
    // 旧データ互換: 以前の「日」基準は、現在は15時の金土日基準に統合する。
    case "日":
    case "金土":
      return discountTime === "15" ? "金土日" : "金土";
    case "火木":
      return "火木";
    case "月水":
      return "月水";
  }
}

function toWeekdayGroupText(
  label: WeekdayBaseLabel,
  discountTime: DiscountTime,
): string {
  switch (label) {
    // 旧データ互換: 以前の「日」基準は、現在は15時の金土日基準に統合する。
    case "日":
    case "金土":
      return discountTime === "15" ? "金曜・土曜・日曜" : "金曜・土曜";
    case "火木":
      return "火曜・木曜";
    case "月水":
      return "月曜・水曜";
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

function buildWeekdaySummaryText(
  original: WeekdayBaseLabel,
  adjusted: WeekdayBaseLabel,
  discountTime: DiscountTime,
): string {
  if (original === adjusted) {
    return "曜日基準補正：なし";
  }

  return `曜日基準補正：${getWeekdayBaseDisplayLabel(
    original,
    discountTime,
  )}→${getWeekdayBaseDisplayLabel(adjusted, discountTime)}`;
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

function getOverflowBonusValue(params: {
  discountTime: DiscountTime;
  overflowDirection: "up" | "down" | null;
  overflowSteps: number;
}): number {
  if (params.overflowDirection === null || params.overflowSteps <= 0) {
    return 0;
  }

  if (params.overflowDirection === "up") {
    if (params.discountTime === "15") {
      return 5;
    }

    return params.overflowSteps >= 2 ? 10 : 5;
  }

  if (params.discountTime === "15") {
    return params.overflowSteps >= 2 ? -10 : -5;
  }

  return -5;
}

function getOverflowBonusTerm(params: {
  discountTime: DiscountTime;
  overflowDirection: "up" | "down" | null;
  overflowSteps: number;
  hasNearTermPercentBonus: boolean;
}): PercentTerm | undefined {
  if (params.hasNearTermPercentBonus) {
    return undefined;
  }

  const value = getOverflowBonusValue(params);
  if (value === 0) {
    return undefined;
  }

  return {
    label: "曜日基準で補正しきれない分",
    value,
  };
}

function toShiftCalcPart(term: ShiftTerm): string {
  return `${term.label} ${formatSignedValue(term.value, "段")}`;
}

function toPercentCalcPart(term: PercentTerm): string {
  return `${term.label} ${formatSignedValue(term.value, "%")}`;
}

function buildWeekdayResultText(params: {
  original: WeekdayBaseLabel;
  adjusted: WeekdayBaseLabel;
  totalShift: number;
  overflowDirection: "up" | "down" | null;
  discountTime: DiscountTime;
}): string | undefined {
  if (params.totalShift === 0) {
    return buildResultText({
      label: "曜日基準補正",
      total: 0,
      unit: "段",
      suffix: `${toWeekdayGroupText(params.original, params.discountTime)}の基準のままです`,
    });
  }

  if (params.overflowDirection === "up") {
    return buildResultText({
      label: "曜日基準補正",
      total: params.totalShift,
      unit: "段",
      suffix: `上限に当たるため${toWeekdayGroupText(
        params.adjusted,
        params.discountTime,
      )}の基準を使用します`,
    });
  }

  if (params.overflowDirection === "down") {
    return buildResultText({
      label: "曜日基準補正",
      total: params.totalShift,
      unit: "段",
      suffix: `下限に当たるため${toWeekdayGroupText(
        params.adjusted,
        params.discountTime,
      )}の基準を使用します`,
    });
  }

  return buildResultText({
    label: "曜日基準補正",
    total: params.totalShift,
    unit: "段",
    suffix: `${toWeekdayGroupText(
      params.original,
      params.discountTime,
    )}ではなく${toWeekdayGroupText(
      params.adjusted,
      params.discountTime,
    )}の基準を使用します`,
  });
}

function buildPercentResultText(totalBonus: number): string | undefined {
  return buildResultText({
    label: "値引率補正",
    total: totalBonus,
    unit: "%",
    suffix: totalBonus === 0 ? "補正はありません" : undefined,
  });
}

function buildDetailLines<T extends ShiftTerm | PercentTerm>(
  terms: T[],
  formatter: (term: T) => string,
): string[] | undefined {
  if (terms.length === 0) {
    return undefined;
  }

  return terms.map(formatter);
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
  const holidayAdjusted = getHolidayAdjustedWeekdayBase({
    date: params.date,
    weekday: params.weekday,
    discountTime: params.discountTime,
  });
  const original = holidayAdjusted.original;
  const noticeText = holidayAdjusted.noticeText;

  const shiftTerms = [
    getBaseTempShiftTerm(params.weather, params.discountTime),
    getWindShiftTerm(params.weather.tempLevel, params.weather.windLevel),
    getWeatherPointShiftTerm(params.weather),
    getAfterRainRecoveryShiftTerm(params.weather),
    getGoldenWeekAfterPeakShiftTerm({
      date: params.date,
      discountTime: params.discountTime,
    }),
  ].filter((value): value is ShiftTerm => Boolean(value));

  const totalShift =
    getBaseTempShift(params.weather.tempLevel) +
    getWindShift(params.weather.tempLevel, params.weather.windLevel) +
    getWeatherPointShift(params.weather) +
    getAfterRainRecoveryShift(params.weather) +
    (isDayAfterGoldenWeekThirdConsecutiveHoliday(params.date)
      ? getGoldenWeekAfterPeakShift(params.discountTime)
      : 0);

  const shifted = applyWeekdayShift({
    base: original,
    discountTime: params.discountTime,
    shift: totalShift,
  });

  const percentTerms = [
    getPrecipitationRateBonusTerm(params.weather, params.discountTime),
    getOverflowBonusTerm({
      discountTime: params.discountTime,
      overflowDirection: shifted.overflowDirection,
      overflowSteps: shifted.overflowSteps,
      hasNearTermPercentBonus: getPrecipitationRateBonus(params.weather) > 0,
    }),
  ].filter((value): value is PercentTerm => Boolean(value));

  const baseRateBonus = percentTerms.reduce((sum, term) => sum + term.value, 0);
  const weekdaySummaryText = buildWeekdaySummaryText(
    original,
    shifted.adjusted,
    params.discountTime,
  );
  const weekdayDetailLines = buildDetailLines(shiftTerms, toShiftCalcPart);
  const weekdayCalcText = buildCalcText(
    "曜日基準補正の内訳",
    shiftTerms.map(toShiftCalcPart),
  );
  const weekdayResultText =
    shiftTerms.length > 0
      ? buildWeekdayResultText({
          original,
          adjusted: shifted.adjusted,
          totalShift,
          overflowDirection: shifted.overflowDirection,
          discountTime: params.discountTime,
        })
      : undefined;
  const bonusCalcParts = percentTerms.map(toPercentCalcPart);
  const bonusSummaryText = buildBonusSummaryText(baseRateBonus);
  const bonusDetailLines = buildDetailLines(percentTerms, toPercentCalcPart);
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
    totalShift,
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
    referenceText: `${toWeekdayGroupText(
      resolved.adjusted,
      params.discountTime,
    )}の${getBasisTimeText(params.discountTime)}を基準に考えて`,
  };
}

export function getWeatherGuideText(): WeatherGuideText {
  return {
    nearTermWeatherGuide: "起点時刻の雨雪で値引率を補正（雨+5%、起点雨かつその後も雨+10%、雪+20%）",
    laterPrecipGuide: "1時間30分後以降の天候は未来天候ポイントで加減算",
    laterPrecipTypeGuide: "未来の雨・雪・風もポイントに含める",
    windGuide: "30分〜1時間後の風速を選択",
    tempGuide: "30分〜1時間後はベース、以降はポイントとして使う",
  };
}
