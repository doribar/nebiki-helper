import type {
  BasisGuideDisplay,
  DiscountTime,
  WeatherGuideText,
  WeatherInput,
  WeekdayBaseInfo,
  WeekdayBaseLabel,
} from "./types";

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

/**
 * 曜日基準を1段上げる
 * 日 → 金土 → 火木 → 月水
 * 月水はそれ以上上がらない
 */
export function raiseWeekdayBase(label: WeekdayBaseLabel): WeekdayBaseLabel {
  switch (label) {
    case "日":
      return "金土";
    case "金土":
      return "火木";
    case "火木":
      return "月水";
    case "月水":
      return "月水";
  }
}

export function getWeekdayBaseInfo(
  weekday: number,
  weather: WeatherInput
): WeekdayBaseInfo {
  const original = getOriginalWeekdayBase(weekday);
  let adjusted = original;
  let changedByWeather = false;
  let baseRateBonus = 0;
  const baseRateBonusReason: string[] = [];

  const isLowestBase = original === "月水";
  const onlyWind = weather.isWindOver3m && !weather.isTempUnder10;
  const onlyCold = !weather.isWindOver3m && weather.isTempUnder10;
  const windAndCold = weather.isWindOver3m && weather.isTempUnder10;

  // 風のみ or 低温のみ → 曜日基準を1段上げる
  // ただし月水はこれ以上上げられないのでベース +10%
  if (onlyWind || onlyCold) {
    if (isLowestBase) {
      baseRateBonus += 10;
      baseRateBonusReason.push("悪天候");
    } else {
      adjusted = raiseWeekdayBase(original);
      changedByWeather = adjusted !== original;
    }
  }

  // 風 + 低温 → ベース +10%
  if (windAndCold) {
    baseRateBonus += 10;
    baseRateBonusReason.push("悪天候");
  }

  // 雨 → ベース +10%
  if (weather.isRain) {
    baseRateBonus += 10;
    baseRateBonusReason.push("雨");
  }

  return {
    original,
    adjusted,
    changedByWeather,
    baseRateBonus,
    baseRateBonusReason,
  };
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

export function getBasisGuideDisplay(params: {
  weekday: number;
  discountTime: DiscountTime;
  weather: WeatherInput;
}): BasisGuideDisplay {
  const info = getWeekdayBaseInfo(params.weekday, params.weather);

  const originalText = toWeekdayGroupText(info.original);
  const adjustedText = toWeekdayGroupText(info.adjusted);

  const isLowestBase = info.original === "月水";
  const onlyWind =
    params.weather.isWindOver3m && !params.weather.isTempUnder10;
  const onlyCold =
    !params.weather.isWindOver3m && params.weather.isTempUnder10;
  const windAndCold =
    params.weather.isWindOver3m && params.weather.isTempUnder10;

  let reasonText: string | undefined;
  let changeText: string | undefined;
  let bonusText: string | undefined;

  if (onlyWind && !isLowestBase) {
    reasonText = "風が強いため";
    changeText = `${originalText}ではなく${adjustedText}の基準を使用します。`;
  } else if (onlyCold && !isLowestBase) {
    reasonText = "気温が低いため";
    changeText = `${originalText}ではなく${adjustedText}の基準を使用します。`;
  }

  if (onlyWind && isLowestBase) {
    bonusText = "風が強いため値引率を10%上げます。";
  } else if (onlyCold && isLowestBase) {
    bonusText = "気温が低いため値引率を10%上げます。";
  }

  if (windAndCold && params.weather.isRain) {
    bonusText = "風が強く、気温が低く、雨のため値引率を20%上げます。";
  } else if (windAndCold) {
    bonusText = "風が強く、気温が低いため値引率を10%上げます。";
  } else if (params.weather.isRain) {
    bonusText = "雨のため値引率を10%上げます。";
  }

  const referenceBaseText = toWeekdayGroupText(info.adjusted);

  return {
    reasonText,
    changeText,
    bonusText,
    referenceText: `${referenceBaseText}の${params.discountTime}時を基準に考えて`,
  };
}

export function getWeatherGuideText(discountTime: DiscountTime): WeatherGuideText {
  const nextHourMap: Record<DiscountTime, string> = {
    "17": "18時",
    "18": "19時",
    "19": "20時",
    "20": "21時",
  };

  return {
    rainGuide: `${discountTime}時以降に雨マークがあるか`,
    windGuide: `${nextHourMap[discountTime]}の風を見て入力`,
    tempGuide: `${nextHourMap[discountTime]}の気温を見て入力`,
  };
}