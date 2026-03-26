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

function getNightAdjustedWeekdayBase(
  weekday: number,
  discountTime: DiscountTime
): WeekdayBaseLabel {
  if (
    weekday === 0 &&
    (discountTime === "17" || discountTime === "18" || discountTime === "19")
  ) {
    return "火木";
  }

  return getOriginalWeekdayBase(weekday);
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

export function relaxWeekdayBase(label: WeekdayBaseLabel): WeekdayBaseLabel {
  switch (label) {
    case "月水":
      return "火木";
    case "火木":
      return "金土";
    case "金土":
      return "日";
    case "日":
      return "日";
  }
}

function isTempUnder10(tempLevel: TempLevel): boolean {
  return tempLevel === "10orLess";
}

function isTemp16to25(tempLevel: TempLevel): boolean {
  return tempLevel === "16to25";
}

function isWindThresholdMet(windLevel: WindLevel, tempLevel: TempLevel): boolean {
  if (tempLevel === "16to25" || tempLevel === "26orMore") {
    return windLevel === "5orMore";
  }

  return windLevel === "3to4" || windLevel === "5orMore";
}

export function getWeekdayBaseInfo(
  weekday: number,
  discountTime: DiscountTime,
  weather: WeatherInput
): WeekdayBaseInfo {
  const original = getNightAdjustedWeekdayBase(weekday, discountTime);

const isSundayNight =
  weekday === 0 &&
  (discountTime === "17" || discountTime === "18" || discountTime === "19");

const warmedBase =
  isTemp16to25(weather.tempLevel) && !isSundayNight
    ? relaxWeekdayBase(original)
    : original;

  let adjusted = warmedBase;
  let changedByWeather = false;
  let baseRateBonus = 0;
  const baseRateBonusReason: string[] = [];

  const windMet = isWindThresholdMet(weather.windLevel, weather.tempLevel);
  const tempUnder10 = isTempUnder10(weather.tempLevel);

  const isLowestBase = warmedBase === "月水";
  const onlyWind = windMet && !tempUnder10;
  const onlyCold = !windMet && tempUnder10;
  const windAndCold = windMet && tempUnder10;

  if (onlyWind || onlyCold) {
    if (isLowestBase) {
      baseRateBonus += 10;
      baseRateBonusReason.push("悪天候");
    } else {
      adjusted = raiseWeekdayBase(warmedBase);
      changedByWeather = adjusted !== warmedBase;
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
  const info = getWeekdayBaseInfo(
  params.weekday,
  params.discountTime,
  params.weather
);

const isSundayNight =
  params.weekday === 0 &&
  (params.discountTime === "17" ||
    params.discountTime === "18" ||
    params.discountTime === "19");

const noticeText = isSundayNight
  ? "日曜日の夜は客足が減るため、火曜・木曜の基準を使います。"
  : undefined;

  const originalText = toWeekdayGroupText(info.original);
  const adjustedText = toWeekdayGroupText(info.adjusted);

  const windMet = isWindThresholdMet(params.weather.windLevel, params.weather.tempLevel);
  const tempUnder10 = isTempUnder10(params.weather.tempLevel);

  const onlyWind = windMet && !tempUnder10;
  const onlyCold = !windMet && tempUnder10;
  const windAndCold = windMet && tempUnder10;

  const originalRank = getWeekdayBaseRank(info.original);
  const adjustedRank = getWeekdayBaseRank(info.adjusted);

  let reasonText: string | undefined;
  let changeText: string | undefined;
  let bonusText: string | undefined;

  if (originalRank !== adjustedRank) {
    if (adjustedRank < originalRank) {
      reasonText = "気候がおだやかなため、";
    } else if (onlyWind) {
      reasonText = "風が強いため";
    } else if (onlyCold) {
      reasonText = "気温が低いため";
    }

    changeText = `${originalText}ではなく${adjustedText}の基準を使用します。`;
  }

  if (onlyWind && info.adjusted === info.original && info.original === "月水") {
    bonusText = "風が強いため値引率を10%上げます。";
  } else if (onlyCold && info.adjusted === info.original && info.original === "月水") {
    bonusText = "気温が低いため値引率を10%上げます。";
  }

  if (windAndCold && params.weather.isRain) {
    bonusText = "風が強く、気温が低く、雨のため値引率を20%上げます。";
  } else if (windAndCold) {
    bonusText = "風が強く、気温が低いため値引率を10%上げます。";
  } else if (params.weather.isRain) {
    bonusText = "雨のため値引率を10%上げます。";
  }

  return {
  noticeText,
  reasonText,
  changeText,
  bonusText,
  referenceText: `${adjustedText}の${getBasisTimeText(
    params.discountTime
  )}を基準に考えて`,
};
}

export function getWeatherGuideText(): WeatherGuideText {
  return {
    rainGuide: "現在時刻以降に雨マークがあるか",
    windGuide: "30分〜1時間後の風速を選択",
    tempGuide: "30分〜1時間後の気温を選択",
  };
}