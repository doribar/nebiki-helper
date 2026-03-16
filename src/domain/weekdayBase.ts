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

function getBasisTimeText(discountTime: DiscountTime): string {
  switch (discountTime) {
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

function isTempUnder10(tempLevel: TempLevel): boolean {
  return tempLevel === "10orLess";
}

function isWindThresholdMet(windLevel: WindLevel, tempLevel: TempLevel): boolean {
  if (tempLevel === "16orMore") {
    return windLevel === "5orMore";
  }

  return windLevel === "3to4" || windLevel === "5orMore";
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

  const windMet = isWindThresholdMet(weather.windLevel, weather.tempLevel);
  const tempUnder10 = isTempUnder10(weather.tempLevel);

  const isLowestBase = original === "月水";
  const onlyWind = windMet && !tempUnder10;
  const onlyCold = !windMet && tempUnder10;
  const windAndCold = windMet && tempUnder10;

  if (onlyWind || onlyCold) {
    if (isLowestBase) {
      baseRateBonus += 10;
      baseRateBonusReason.push("悪天候");
    } else {
      adjusted = raiseWeekdayBase(original);
      changedByWeather = adjusted !== original;
    }
  }

  if (windAndCold) {
    baseRateBonus += 10;
    baseRateBonusReason.push("悪天候");
  }

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

  const windMet = isWindThresholdMet(params.weather.windLevel, params.weather.tempLevel);
  const tempUnder10 = isTempUnder10(params.weather.tempLevel);

  const isLowestBase = info.original === "月水";
  const onlyWind = windMet && !tempUnder10;
  const onlyCold = !windMet && tempUnder10;
  const windAndCold = windMet && tempUnder10;

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
    referenceText: `${referenceBaseText}の${getBasisTimeText(
      params.discountTime
    )}を基準に考えて`,
  };
}

export function getWeatherGuideText(): WeatherGuideText {
  return {
    rainGuide: "現在時刻以降に雨マークがあるか",
    windGuide: "現在の風速を選択",
    tempGuide: "現在の気温を選択",
  };
}