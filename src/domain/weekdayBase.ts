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
  if (original === adjusted) {
    return "曜日基準補正：なし";
  }

  return `曜日基準補正：${original}→${adjusted}`;
}

function buildBonusSummaryText(totalBonus: number): string {
  if (totalBonus === 0) {
    return "値引率補正：なし";
  }

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
      return { label: "気温 5度以下", value: 2 };
    case "6to10":
      return { label: "気温 6〜10度", value: 1 };
    case "16to20":
      return { label: "気温 16〜20度", value: -1 };
    case "21to25":
      return { label: "気温 21〜25度", value: -2 };
    case "31to35":
      return { label: "気温 31〜35度", value: 1 };
    case "36orMore":
      return { label: "気温 36度以上", value: 2 };
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
    label: is15OrLess ? "風 3m以上（15度以下）" : "風 5m以上",
    value: 1,
  };
}

function getAfterRainRecoveryShift(_weather: ResolvedWeatherInput): number {
  return 0;
}

function getAfterRainRecoveryShiftTerm(_weather: ResolvedWeatherInput): ShiftTerm | undefined {
  return undefined;
}

function getNext18TempDropShift(weather: ResolvedWeatherInput, discountTime: DiscountTime): number {
  return discountTime === "15" ? weather.next18TempDropShift : 0;
}

function getNext18TempDropShiftTerm(
  weather: ResolvedWeatherInput,
  discountTime: DiscountTime
): ShiftTerm | undefined {
  if (getNext18TempDropShift(weather, discountTime) === 0) {
    return undefined;
  }

  return { label: "15時と18時の気温差が6度以上", value: 1 };
}

function getNext18WindWorsenShift(weather: ResolvedWeatherInput, discountTime: DiscountTime): number {
  return discountTime === "15" ? weather.next18WindWorsenShift : 0;
}

function getNext18WindWorsenShiftTerm(
  weather: ResolvedWeatherInput,
  discountTime: DiscountTime
): ShiftTerm | undefined {
  if (getNext18WindWorsenShift(weather, discountTime) === 0) {
    return undefined;
  }

  return { label: "18時予報で風も強まる", value: 1 };
}

function getLaterPrecipShift(weather: ResolvedWeatherInput): number {

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

function getLaterPrecipShiftTerm(weather: ResolvedWeatherInput): ShiftTerm | undefined {
  if (!weather.hasLaterPrecip) {
    return undefined;
  }

  switch (weather.laterPrecipType) {
    case "rain":
      return { label: "後の雨", value: 1 };
    case "snow":
      return { label: "後の雪", value: 2 };
    default:
      return undefined;
  }
}

function getNearTermPercentBonus(weather: ResolvedWeatherInput): number {
  switch (weather.nearTermWeather) {
    case "rain":
      return 10;
    case "snow":
      return 20;
    default:
      return 0;
  }
}

function getNearTermPercentTerm(weather: ResolvedWeatherInput): PercentTerm | undefined {
  switch (weather.nearTermWeather) {
    case "rain":
      return { label: "近い雨", value: 10 };
    case "snow":
      return { label: "近い雪", value: 20 };
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
  weather: ResolvedWeatherInput;
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
    getAfterRainRecoveryShiftTerm(params.weather),
    getNext18TempDropShiftTerm(params.weather, params.discountTime),
    getNext18WindWorsenShiftTerm(params.weather, params.discountTime),
  ].filter((value): value is ShiftTerm => Boolean(value));

  const totalShift =
    getTempShift(params.weather.tempLevel) +
    getWindShift(params.weather.tempLevel, params.weather.windLevel) +
    getLaterPrecipShift(params.weather) +
    getAfterRainRecoveryShift(params.weather) +
    getNext18TempDropShift(params.weather, params.discountTime) +
    getNext18WindWorsenShift(params.weather, params.discountTime);

  const shifted = applyWeekdayShift({
    base: original,
    discountTime: params.discountTime,
    shift: totalShift,
  });

  const percentTerms = [
    getNearTermPercentTerm(params.weather),
    getOverflowBonusTerm({
      discountTime: params.discountTime,
      overflowDirection: shifted.overflowDirection,
      overflowSteps: shifted.overflowSteps,
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
  weather: ResolvedWeatherInput
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
