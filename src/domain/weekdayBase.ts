import type {
  BasisGuideDisplay,
  DiscountTime,
  TempLevel,
  WeatherGuideText,
  WeatherInput,
  WeekdayBaseInfo,
  WeekdayBaseLabel,
  WindLevel,
} from "./types";

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
    case "日":
      return 0;
    case "金土":
      return 1;
    case "火木":
      return 2;
    case "月水":
      return 3;
  }
}

function rankToWeekdayBase(rank: number): WeekdayBaseLabel {
  switch (Math.max(0, Math.min(rank, 3))) {
    case 0:
      return "日";
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
      return "日";
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

function getNightAdjustedWeekdayBase(
  weekday: number,
  discountTime: DiscountTime
): WeekdayBaseLabel {
  if (weekday === 0 && isNightFloorTime(discountTime)) {
    return "火木";
  }

  return getOriginalWeekdayBase(weekday);
}

function getRelaxFloor(discountTime: DiscountTime): WeekdayBaseLabel {
  return isNightFloorTime(discountTime) ? "金土" : "日";
}

function toWeekdayGroupText(label: WeekdayBaseLabel): string {
  switch (label) {
    case "日":
      return "日曜日";
    case "金土":
      return "金曜・土曜";
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

  return '0％';
}

function buildWeekdaySummaryText(original: WeekdayBaseLabel, adjusted: WeekdayBaseLabel): string {
  return `曜日基準補正：${original}→${adjusted}`;
}

function buildBonusSummaryText(totalBonus: number): string {
  return `値引率補正：${formatSignedPercentCompact(totalBonus)}`;
}

function getTempShift(tempLevel: TempLevel): number {
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
    case "26to30":
      return 0;
    case "31to35":
      return 1;
    case "36orMore":
      return 2;
  }
}

function getTempShiftTerm(tempLevel: TempLevel): ShiftTerm | undefined {
  switch (tempLevel) {
    case "5orLess":
      return { label: "5度以下", value: 2 };
    case "6to10":
      return { label: "6〜10度", value: 1 };
    case "16to20":
      return { label: "16〜20度", value: -1 };
    case "21to25":
      return { label: "21〜25度", value: -2 };
    case "31to35":
      return { label: "31〜35度", value: 1 };
    case "36orMore":
      return { label: "36度以上", value: 2 };
    default:
      return undefined;
  }
}

function isWindThresholdMet(tempLevel: TempLevel, windLevel: WindLevel): boolean {
  const is15OrLess =
    tempLevel === "5orLess" || tempLevel === "6to10" || tempLevel === "11to15";

  if (is15OrLess) {
    return windLevel === "3to4" || windLevel === "5orMore";
  }

  return windLevel === "5orMore";
}

function getWindShift(tempLevel: TempLevel, windLevel: WindLevel): number {
  return isWindThresholdMet(tempLevel, windLevel) ? 1 : 0;
}

function getWindShiftTerm(
  tempLevel: TempLevel,
  windLevel: WindLevel
): ShiftTerm | undefined {
  if (!isWindThresholdMet(tempLevel, windLevel)) {
    return undefined;
  }

  const is15OrLess =
    tempLevel === "5orLess" || tempLevel === "6to10" || tempLevel === "11to15";

  return {
    label: is15OrLess ? "風速3m以上（15度以下）" : "風速5m以上",
    value: 1,
  };
}

function getLaterPrecipShift(weather: WeatherInput): number {
  if (!weather.hasLaterPrecip) {
    return 0;
  }

  switch (weather.laterPrecipType) {
    case "rain":
      return 1;
    case "snow":
      return 2;
    default:
      return 0;
  }
}

function getLaterPrecipShiftTerm(weather: WeatherInput): ShiftTerm | undefined {
  if (!weather.hasLaterPrecip) {
    return undefined;
  }

  switch (weather.laterPrecipType) {
    case "rain":
      return { label: "1時間30分後〜23時 雨", value: 1 };
    case "snow":
      return { label: "1時間30分後〜23時 雪", value: 2 };
    default:
      return undefined;
  }
}

function getNearTermPercentBonus(weather: WeatherInput): number {
  switch (weather.nearTermWeather) {
    case "rain":
      return 10;
    case "snow":
      return 20;
    default:
      return 0;
  }
}

function getNearTermPercentTerm(weather: WeatherInput): PercentTerm | undefined {
  switch (weather.nearTermWeather) {
    case "rain":
      return { label: "30分〜1時間後 雨", value: 10 };
    case "snow":
      return { label: "30分〜1時間後 雪", value: 20 };
    default:
      return undefined;
  }
}

function applyWeekdayShift(params: {
  base: WeekdayBaseLabel;
  discountTime: DiscountTime;
  shift: number;
}): {
  adjusted: WeekdayBaseLabel;
  overflowDirection: "up" | "down" | null;
} {
  const currentRank = getWeekdayBaseRank(params.base);

  if (params.shift > 0) {
    const targetRank = currentRank + params.shift;
    const adjustedRank = Math.min(targetRank, getWeekdayBaseRank("月水"));

    return {
      adjusted: rankToWeekdayBase(adjustedRank),
      overflowDirection: targetRank > adjustedRank ? "up" : null,
    };
  }

  if (params.shift < 0) {
    const targetRank = currentRank + params.shift;
    const floorRank = getWeekdayBaseRank(getRelaxFloor(params.discountTime));
    const adjustedRank = Math.max(targetRank, floorRank);

    return {
      adjusted: rankToWeekdayBase(adjustedRank),
      overflowDirection: targetRank < adjustedRank ? "down" : null,
    };
  }

  return {
    adjusted: params.base,
    overflowDirection: null,
  };
}

function getOverflowBonusTerm(params: {
  overflowDirection: "up" | "down" | null;
  hasNearTermPercentBonus: boolean;
}): PercentTerm | undefined {
  if (params.hasNearTermPercentBonus) {
    return undefined;
  }

  if (params.overflowDirection === "up") {
    return {
      label: "頭打ち（上限）",
      value: 5,
    };
  }

  if (params.overflowDirection === "down") {
    return {
      label: "頭打ち（下限）",
      value: -5,
    };
  }

  return undefined;
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
}): string | undefined {
  if (params.totalShift === 0) {
    return buildResultText({
      label: "曜日基準補正",
      total: 0,
      unit: "段",
      suffix: `${toWeekdayGroupText(params.original)}の基準のままです`,
    });
  }

  if (params.overflowDirection === "up") {
    return buildResultText({
      label: "曜日基準補正",
      total: params.totalShift,
      unit: "段",
      suffix: `上限に当たるため${toWeekdayGroupText(params.adjusted)}の基準を使用します`,
    });
  }

  if (params.overflowDirection === "down") {
    return buildResultText({
      label: "曜日基準補正",
      total: params.totalShift,
      unit: "段",
      suffix: `下限に当たるため${toWeekdayGroupText(params.adjusted)}の基準を使用します`,
    });
  }

  return buildResultText({
    label: "曜日基準補正",
    total: params.totalShift,
    unit: "段",
    suffix: `${toWeekdayGroupText(params.original)}ではなく${toWeekdayGroupText(
      params.adjusted
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
  formatter: (term: T) => string
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
}): Pick<
  BasisGuideDisplay,
  "bonusSummaryText" | "bonusDetailLines" | "bonusCalcText" | "bonusResultText" | "bonusCalcParts" | "bonusTotal"
> {
  const parts = [...(params.baseBonusParts ?? [])];

  if (params.lateTimeBonus !== 0) {
    parts.push(`次の基準時刻が近い ${formatSignedValue(params.lateTimeBonus, "%")}`);
  }

  const total = params.baseRateBonus + params.lateTimeBonus;

  return {
    bonusSummaryText: buildBonusSummaryText(total),
    bonusDetailLines: parts,
    bonusCalcParts: parts,
    bonusTotal: total,
    bonusCalcText: joinBonusCalculationParts(parts),
    bonusResultText: parts.length > 0 ? buildPercentResultText(total) : undefined,
  };
}

function resolveWeatherEffect(params: {
  weekday: number;
  discountTime: DiscountTime;
  weather: WeatherInput;
}) {
  const original = getNightAdjustedWeekdayBase(params.weekday, params.discountTime);
  const isSundayNight = params.weekday === 0 && isNightFloorTime(params.discountTime);
  const noticeText = isSundayNight
    ? "日曜日の17時以降は客足が減るため、火曜・木曜の基準を使います。"
    : undefined;

  const shiftTerms = [
    getTempShiftTerm(params.weather.tempLevel),
    getWindShiftTerm(params.weather.tempLevel, params.weather.windLevel),
    getLaterPrecipShiftTerm(params.weather),
  ].filter((value): value is ShiftTerm => Boolean(value));

  const totalShift =
    getTempShift(params.weather.tempLevel) +
    getWindShift(params.weather.tempLevel, params.weather.windLevel) +
    getLaterPrecipShift(params.weather);

  const shifted = applyWeekdayShift({
    base: original,
    discountTime: params.discountTime,
    shift: totalShift,
  });

  const percentTerms = [
    getNearTermPercentTerm(params.weather),
    getOverflowBonusTerm({
      overflowDirection: shifted.overflowDirection,
      hasNearTermPercentBonus: getNearTermPercentBonus(params.weather) > 0,
    }),
  ].filter((value): value is PercentTerm => Boolean(value));

  const baseRateBonus = percentTerms.reduce((sum, term) => sum + term.value, 0);
  const weekdaySummaryText = buildWeekdaySummaryText(original, shifted.adjusted);
  const weekdayDetailLines = buildDetailLines(shiftTerms, toShiftCalcPart);
  const weekdayCalcText = buildCalcText(
    "曜日基準補正の内訳",
    shiftTerms.map(toShiftCalcPart)
  );
  const weekdayResultText =
    shiftTerms.length > 0
      ? buildWeekdayResultText({
          original,
          adjusted: shifted.adjusted,
          totalShift,
          overflowDirection: shifted.overflowDirection,
        })
      : undefined;
  const bonusCalcParts = percentTerms.map(toPercentCalcPart);
  const bonusSummaryText = buildBonusSummaryText(baseRateBonus);
  const bonusDetailLines = buildDetailLines(percentTerms, toPercentCalcPart);
  const bonusCalcText = joinBonusCalculationParts(bonusCalcParts);
  const bonusResultText =
    bonusCalcParts.length > 0 ? buildPercentResultText(baseRateBonus) : undefined;

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
  weather: WeatherInput
): WeekdayBaseInfo {
  const resolved = resolveWeatherEffect({
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
  weekday: number;
  discountTime: DiscountTime;
  weather: WeatherInput;
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
    referenceText: `${toWeekdayGroupText(resolved.adjusted)}の${getBasisTimeText(
      params.discountTime
    )}を基準に考えて`,
  };
}

export function getWeatherGuideText(): WeatherGuideText {
  return {
    nearTermWeatherGuide: "30分〜1時間後に雨マーク（もしくは雪）があるか",
    laterPrecipGuide: "1時間30分後〜23時に雨マーク（もしくは雪）があるか",
    laterPrecipTypeGuide: "ある場合それは雨と雪のどちらか",
    windGuide: "30分〜1時間後の風速を選択",
    tempGuide: "30分〜1時間後の気温を選択",
  };
}
