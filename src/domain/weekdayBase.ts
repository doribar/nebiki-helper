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

function getAppliedRaiseSteps(
  label: WeekdayBaseLabel,
  steps: number
): number {
  const raised = raiseWeekdayBaseBySteps(label, steps);
  return getWeekdayBaseRank(raised) - getWeekdayBaseRank(label);
}

function getRaiseOverflowBonus(
  requestedSteps: number,
  appliedSteps: number
): number {
  return requestedSteps > appliedSteps ? 5 : 0;
}

function getRateUpBonusText(totalBonus: number): string | undefined {
  return totalBonus > 0 ? `値引率を${totalBonus}%上げます。` : undefined;
}

function getRelaxFloor(discountTime: DiscountTime): WeekdayBaseLabel {
  return discountTime === "17" ||
    discountTime === "18" ||
    discountTime === "19"
    ? "金土"
    : "日";
}

function relaxWeekdayBaseByStepsWithFloor(
  label: WeekdayBaseLabel,
  steps: number,
  discountTime: DiscountTime
): WeekdayBaseLabel {
  const floorRank = getWeekdayBaseRank(getRelaxFloor(discountTime));
  const nextRank = getWeekdayBaseRank(label) - steps;
  return rankToWeekdayBase(Math.max(nextRank, floorRank));
}

function getAppliedRelaxStepsWithFloor(
  label: WeekdayBaseLabel,
  steps: number,
  discountTime: DiscountTime
): number {
  const relaxed = relaxWeekdayBaseByStepsWithFloor(
    label,
    steps,
    discountTime
  );

  return getWeekdayBaseRank(label) - getWeekdayBaseRank(relaxed);
}

function getRelaxOverflowPenalty(requestedSteps: number, appliedSteps: number): number {
  return requestedSteps > appliedSteps ? -5 : 0;
}

function isTempUnder10(tempLevel: TempLevel): boolean {
  return tempLevel === "10orLess";
}

function isWindThresholdMet(windLevel: WindLevel, tempLevel: TempLevel): boolean {
  if (
    tempLevel === "16to20" ||
    tempLevel === "21to25" ||
    tempLevel === "26orMore"
  ) {
    return windLevel === "5orMore";
  }

  return windLevel === "3to4" || windLevel === "5orMore";
}

function getWarmRelaxReasonText(tempLevel: TempLevel): string | undefined {
  if (tempLevel === "21to25") {
    return "かなり過ごしやすいため、";
  }

  if (tempLevel === "16to20") {
    return "過ごしやすいため、";
  }

  return undefined;
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
    const raiseSteps = 1;
    const appliedRaiseSteps = getAppliedRaiseSteps(original, raiseSteps);
    const raiseOverflowBonus = getRaiseOverflowBonus(
      raiseSteps,
      appliedRaiseSteps
    );

    adjusted = raiseWeekdayBaseBySteps(original, raiseSteps);
    baseRateBonus = 10 + raiseOverflowBonus;
    reasonText = buildRainNearReason(windMet, coldMet);
    bonusText = getRateUpBonusText(baseRateBonus);
  } else {
    baseRateBonus = 10;
    bonusText = "30分〜1時間後に雨予報があるため値引率を10%上げます。";
  }
}
  // 30分〜1時間後に雪
  else if (nearTermWeather === "snow") {
  const raiseSteps = windMet && coldMet ? 0 : windMet || coldMet ? 1 : 0;
  const appliedRaiseSteps = getAppliedRaiseSteps(original, raiseSteps);
  const raiseOverflowBonus = getRaiseOverflowBonus(
    raiseSteps,
    appliedRaiseSteps
  );

  adjusted = raiseWeekdayBaseBySteps(original, raiseSteps);
  baseRateBonus =
    (windMet && coldMet ? 30 : 20) + raiseOverflowBonus;

  if (windMet && coldMet) {
    bonusText = getRateUpBonusText(baseRateBonus);
  } else if (windMet) {
    reasonText = "30分〜1時間後に雪予報があり、風が強いため、";
    bonusText = getRateUpBonusText(baseRateBonus);
  } else if (coldMet) {
    reasonText = "30分〜1時間後に雪予報があり、気温が低いため、";
    bonusText = getRateUpBonusText(baseRateBonus);
  } else {
    bonusText = getRateUpBonusText(baseRateBonus);
  }
}
  // その日のうちに雨
  else if (laterPrecipType === "rain") {
  if (windMet && coldMet) {
    baseRateBonus = 10;
    bonusText =
      "1時間30分後～23時に雨予報があり、風が強く気温が低いため値引率を10%上げます。";
  } else {
    const raiseSteps = windMet || coldMet ? 3 : 2;
    const appliedRaiseSteps = getAppliedRaiseSteps(original, raiseSteps);
    const raiseOverflowBonus = getRaiseOverflowBonus(
      raiseSteps,
      appliedRaiseSteps
    );

    adjusted = raiseWeekdayBaseBySteps(original, raiseSteps);
    reasonText = buildRainLaterReason(
      windMet || false,
      coldMet || false
    );
    baseRateBonus = raiseOverflowBonus;
    bonusText =
      raiseOverflowBonus > 0 ? "値引率を5%上げます。" : undefined;
  }
}
  // その日のうちに雪
  else if (laterPrecipType === "snow") {
  const raiseSteps = windMet && coldMet ? 0 : windMet || coldMet ? 1 : 0;
  const appliedRaiseSteps = getAppliedRaiseSteps(original, raiseSteps);
  const raiseOverflowBonus = getRaiseOverflowBonus(
    raiseSteps,
    appliedRaiseSteps
  );

  adjusted = raiseWeekdayBaseBySteps(original, raiseSteps);
  baseRateBonus =
    (windMet && coldMet ? 20 : 10) + raiseOverflowBonus;

  if (windMet && coldMet) {
    bonusText = getRateUpBonusText(baseRateBonus);
  } else if (windMet) {
    reasonText = "1時間30分後～23時に雪予報があり、風が強いため、";
    bonusText = getRateUpBonusText(baseRateBonus);
  } else if (coldMet) {
    reasonText = "1時間30分後～23時に雪予報があり、気温が低いため、";
    bonusText = getRateUpBonusText(baseRateBonus);
  } else {
    bonusText = getRateUpBonusText(baseRateBonus);
  }
}
  

      // 降水なし → 風・低気温・16〜25度処理
else {
  const warmRelaxSteps =
  params.weather.tempLevel === "21to25"
    ? 2
    : params.weather.tempLevel === "16to20"
    ? 1
    : 0;

  const appliedWarmRelaxSteps =
  warmRelaxSteps > 0
    ? getAppliedRelaxStepsWithFloor(
        original,
        warmRelaxSteps,
        params.discountTime
      )
    : 0;

const warmPenalty = getRelaxOverflowPenalty(
  warmRelaxSteps,
  appliedWarmRelaxSteps
);

const warmedBase =
  appliedWarmRelaxSteps > 0
    ? relaxWeekdayBaseByStepsWithFloor(
        original,
        warmRelaxSteps,
        params.discountTime
      )
    : original;

adjusted = warmedBase;
reasonText =
  warmRelaxSteps > 0
    ? getWarmRelaxReasonText(params.weather.tempLevel)
    : undefined;
bonusText = warmPenalty < 0 ? "値引率を5%下げます。" : undefined;
baseRateBonus += warmPenalty;

  const onlyWind = windMet && !coldMet;
  const onlyCold = !windMet && coldMet;
  const windAndCold = windMet && coldMet;

  const is15 = params.discountTime === "15";

  // 暖かさ緩和と風だけは相殺。21〜25度は2段緩和なので、風だけなら1段残る。
  if (warmRelaxSteps > 0 && onlyWind) {
    const remainingRelaxSteps = Math.max(warmRelaxSteps - 1, 0);

const appliedRemainingRelaxSteps =
  remainingRelaxSteps > 0
    ? getAppliedRelaxStepsWithFloor(
        original,
        remainingRelaxSteps,
        params.discountTime
      )
    : 0;

const remainingWarmPenalty = getRelaxOverflowPenalty(
  remainingRelaxSteps,
  appliedRemainingRelaxSteps
);

adjusted =
  appliedRemainingRelaxSteps > 0
    ? relaxWeekdayBaseByStepsWithFloor(
        original,
        remainingRelaxSteps,
        params.discountTime
      )
    : original;

reasonText =
  remainingRelaxSteps > 0
    ? getWarmRelaxReasonText(params.weather.tempLevel)
    : undefined;

bonusText =
  remainingWarmPenalty < 0 ? "値引率を5%下げます。" : undefined;

baseRateBonus += remainingWarmPenalty;
  } else if (onlyWind || onlyCold) {
    if (is15) {
      if (original === "月水") {
        baseRateBonus += 5;
        bonusText = onlyWind
          ? "風が強いため値引率を5%上げます。"
          : "気温が低いため値引率を5%上げます。";
        reasonText = undefined;
      } else {
        adjusted = raiseWeekdayBaseBySteps(adjusted, 1);
        reasonText = onlyWind ? "風が強いため、" : "気温が低いため、";
        bonusText = undefined;
      }
    } else {
      if (original === "月水") {
        baseRateBonus += 5;
        bonusText = onlyWind
          ? "風が強いため値引率を5%上げます。"
          : "気温が低いため値引率を5%上げます。";
        reasonText = undefined;
      } else {
        adjusted = raiseWeekdayBaseBySteps(adjusted, 1);
        reasonText = onlyWind ? "風が強いため、" : "気温が低いため、";
        bonusText = undefined;
      }
    }
  }

  if (windAndCold) {
    if (is15) {
      if (original === "月水") {
        baseRateBonus += 10;
        bonusText = "風が強く、気温が低いため値引率を10%上げます。";
        reasonText = undefined;
      } else if (original === "火木") {
        adjusted = raiseWeekdayBaseBySteps(original, 1);
        baseRateBonus += 5;
        reasonText = "風が強く、気温が低いため、";
        bonusText = "値引率を5%上げます。";
      } else {
        adjusted = raiseWeekdayBaseBySteps(original, 2);
        reasonText = "風が強く、気温が低いため、";
        bonusText = undefined;
      }
    } else {
      baseRateBonus += 10;
      bonusText = "風が強く、気温が低いため値引率を10%上げます。";
      reasonText = undefined;
    }
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