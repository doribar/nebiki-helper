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

function raiseWeekdayBaseBySteps(
  label: WeekdayBaseLabel,
  steps: number
): WeekdayBaseLabel {
  return rankToWeekdayBase(getWeekdayBaseRank(label) + steps);
}

function relaxWeekdayBase(label: WeekdayBaseLabel): WeekdayBaseLabel {
  return rankToWeekdayBase(getWeekdayBaseRank(label) - 1);
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

function buildRainNearReason(windMet: boolean, coldMet: boolean): string | undefined {
  if (windMet && !coldMet) {
    return "30分〜1時間後に雨予報があり、風が強いため、";
  }
  if (!windMet && coldMet) {
    return "30分〜1時間後に雨予報があり、気温が低いため、";
  }
  return undefined;
}

function buildRainLaterReason(windMet: boolean, coldMet: boolean): string {
  if (windMet && !coldMet) {
    return "1時間30分後～23時に雨予報があり、風が強いため、";
  }
  if (!windMet && coldMet) {
    return "1時間30分後～23時に雨予報があり、気温が低いため、";
  }
  return "1時間30分後～23時に雨予報があるため、";
}

function resolveWeatherEffect(params: {
  weekday: number;
  discountTime: DiscountTime;
  weather: WeatherInput;
}) {
  const original = getNightAdjustedWeekdayBase(
    params.weekday,
    params.discountTime
  );

  const isSundayNight =
  params.weekday === 0 &&
  (params.discountTime === "17" ||
    params.discountTime === "18" ||
    params.discountTime === "19");

const isFridaySaturdayNight =
  (params.weekday === 5 || params.weekday === 6) &&
  (params.discountTime === "17" ||
    params.discountTime === "18" ||
    params.discountTime === "19");

const noticeText = isSundayNight
  ? "日曜日の夜は客足が減るため、火曜・木曜の基準を使います。"
  : undefined;

  const windMet = isWindThresholdMet(
    params.weather.windLevel,
    params.weather.tempLevel
  );
  const coldMet = isTempUnder10(params.weather.tempLevel);

  let adjusted = original;
  let baseRateBonus = 0;
  let reasonText: string | undefined;
  let bonusText: string | undefined;

  const nearTermWeather = params.weather.nearTermWeather;
  const laterPrecipType =
    nearTermWeather === "rain" || nearTermWeather === "snow"
      ? nearTermWeather
      : params.weather.hasLaterPrecip
      ? params.weather.laterPrecipType
      : null;

  // 30分〜1時間後に雨
  if (nearTermWeather === "rain") {
    if (windMet && coldMet) {
      baseRateBonus = 20;
      bonusText =
        "30分〜1時間後に雨予報があり、風が強く気温が低いため値引率を20%上げます。";
    } else if (windMet || coldMet) {
      adjusted = raiseWeekdayBaseBySteps(original, 1);
      baseRateBonus = 10;
      reasonText = buildRainNearReason(windMet, coldMet);
      bonusText = "値引率を10%上げます。";
    } else {
      baseRateBonus = 10;
      bonusText = "30分〜1時間後に雨予報があるため値引率を10%上げます。";
    }
  }
  // 30分〜1時間後に雪
  else if (nearTermWeather === "snow") {
  const raiseSteps = windMet && coldMet ? 0 : windMet || coldMet ? 1 : 0;
  adjusted = raiseWeekdayBaseBySteps(original, raiseSteps);
  baseRateBonus = windMet && coldMet ? 30 : 20;

  if (windMet && coldMet) {
    bonusText =
      "30分〜1時間後に雪予報があり、風が強く気温が低いため値引率を30%上げます。";
  } else if (windMet) {
    reasonText = "30分〜1時間後に雪予報があり、風が強いため、";
    bonusText = "値引率を20%上げます。";
  } else if (coldMet) {
    reasonText = "30分〜1時間後に雪予報があり、気温が低いため、";
    bonusText = "値引率を20%上げます。";
  } else {
    bonusText = "30分〜1時間後に雪予報があるため値引率を20%上げます。";
  }
}
  // その日のうちに雨
  else if (laterPrecipType === "rain") {
    if (windMet && coldMet) {
      baseRateBonus = 10;
      bonusText =
  "1時間30分後～23時に雨予報があり、風が強く気温が低いため値引率を10%上げます。";
    } else if (windMet || coldMet) {
      adjusted = raiseWeekdayBaseBySteps(original, 3);
      reasonText = buildRainLaterReason(windMet, coldMet);
    } else {
      adjusted = raiseWeekdayBaseBySteps(original, 2);
      reasonText = buildRainLaterReason(false, false);
    }
  }
  // その日のうちに雪
  else if (laterPrecipType === "snow") {
  const raiseSteps = windMet && coldMet ? 0 : windMet || coldMet ? 1 : 0;
  adjusted = raiseWeekdayBaseBySteps(original, raiseSteps);
  baseRateBonus = windMet && coldMet ? 20 : 10;

  if (windMet && coldMet) {
    bonusText =
      "1時間30分後～23時に雪予報があり、風が強く気温が低いため値引率を20%上げます。";
  } else if (windMet) {
    reasonText = "1時間30分後～23時に雪予報があり、風が強いため、";
    bonusText = "値引率を10%上げます。";
  } else if (coldMet) {
    reasonText = "1時間30分後～23時に雪予報があり、気温が低いため、";
    bonusText = "値引率を10%上げます。";
  } else {
    bonusText = "1時間30分後～23時に雪予報があるため値引率を10%上げます。";
  }
}
  // 降水なし → 従来の風・低気温・16〜25度処理
  else {
    const warmedBase =
  isTemp16to25(params.weather.tempLevel) &&
  !isSundayNight &&
  !isFridaySaturdayNight
    ? relaxWeekdayBase(original)
    : original;

    adjusted = warmedBase;

    if (warmedBase !== original) {
      reasonText = "気候がおだやかなため、";
    }

    const onlyWind = windMet && !coldMet;
    const onlyCold = !windMet && coldMet;
    const windAndCold = windMet && coldMet;

    if (onlyWind || onlyCold) {
      if (adjusted === "月水") {
        baseRateBonus += 10;
        bonusText = onlyWind
          ? "風が強いため値引率を10%上げます。"
          : "気温が低いため値引率を10%上げます。";
      } else {
        adjusted = raiseWeekdayBaseBySteps(adjusted, 1);
        reasonText = onlyWind ? "風が強いため、" : "気温が低いため、";
      }
    }

    if (windAndCold) {
      baseRateBonus += 10;
      bonusText = "風が強く、気温が低いため値引率を10%上げます。";
    }
  }

  const changeText =
    adjusted !== original
      ? `${toWeekdayGroupText(original)}ではなく${toWeekdayGroupText(
          adjusted
        )}の基準を使用します。`
      : undefined;

  return {
    original,
    adjusted,
    noticeText,
    reasonText,
    changeText,
    bonusText,
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
    baseRateBonus: resolved.baseRateBonus,
    baseRateBonusReason: resolved.bonusText ? [resolved.bonusText] : [],
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
    reasonText: resolved.reasonText,
    changeText: resolved.changeText,
    bonusText: resolved.bonusText,
    referenceText: `${toWeekdayGroupText(resolved.adjusted)}の${getBasisTimeText(
      params.discountTime
    )}を基準に考えて`,
  };
}

export function getWeatherGuideText(): WeatherGuideText {
  return {
    nearTermWeatherGuide: "30分〜1時間後に雨マークがあるか",
    laterPrecipGuide: "1時間30分後～23時に雨マークがあるか",
    laterPrecipTypeGuide: "ある場合それは雨と雪のどちらか",
    windGuide: "30分〜1時間後の風速を選択",
    tempGuide: "30分〜1時間後の気温を選択",
  };
}