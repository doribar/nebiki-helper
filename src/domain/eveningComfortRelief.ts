import type { DiscountTime, HourlyForecastEntry, SessionDraft } from "./types.ts";
import { getHourlyForecastComfortScore } from "./hourlyWeather.ts";

/** 元sessionの時刻を、先取りで使う基準時刻とは別に渡す。 */
export type EveningComfortReliefContext = {
  sessionDiscountTime: DiscountTime;
  /** 正規化で欠損を既定値へ置換する前の、入力済み予報を渡す。 */
  hourlyForecasts: unknown;
  /** falseは正規化で補完された比較入力。数値として揃っていても判定へ使わない。 */
  comparisonInputAvailable?: boolean;
};

export type EveningHourlyComfortInput = HourlyForecastEntry & {
  /** 既存の1時間天候ポイントの符号を逆転。大きいほど不快。 */
  comfortScore: number;
};

export type EveningComfortReliefReason =
  | "applied"
  | "not_target_session"
  | "comparison_input_unavailable"
  | "temperature_difference_below_5"
  | "comfort_not_decreased"
  | "comfort_not_negative";

/** optional metadata。過去の保存値を現行予報から再判定しない。 */
export type EveningComfortReliefAnalysis = {
  version: 1;
  sessionDiscountTime: DiscountTime;
  effectiveRateDiscountTime: DiscountTime;
  forecast16: EveningHourlyComfortInput | null;
  forecast21: EveningHourlyComfortInput | null;
  temperatureDifferenceC: number | null;
  eligibleSession: boolean;
  temperatureDifferenceAtLeast5: boolean;
  comfortDecreased: boolean;
  conditionMet: boolean;
  comfortAdjustmentBeforePercent: number;
  comfortAdjustmentAfterPercent: number;
  applied: boolean;
  reliefPercent: 0 | 5;
  reason: EveningComfortReliefReason;
};

export function getEveningComfortReliefContext(
  session: Pick<SessionDraft, "discountTime" | "weather">,
): EveningComfortReliefContext {
  const unavailableHours = session.weather.eveningComfortUnavailableForecastHours ?? [];
  return {
    sessionDiscountTime: session.discountTime,
    // 補完されたhourだけを欠損に戻す。他方の入力済み予報は比較証跡に残す。
    hourlyForecasts: unavailableHours.length > 0
      ? {
          ...session.weather.hourlyForecasts,
          ...(unavailableHours.includes("16") ? { "16": undefined } : {}),
          ...(unavailableHours.includes("21") ? { "21": undefined } : {}),
        }
      : session.weather.hourlyForecasts,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDiscountTime(value: unknown): value is DiscountTime {
  return typeof value === "string" && ["15", "17", "18", "19", "20"].includes(value);
}

function readHourlyForecast(raw: unknown): HourlyForecastEntry | null {
  if (
    !isRecord(raw) ||
    !["sunny", "rain", "snow"].includes(raw.weather as string) ||
    typeof raw.tempC !== "number" ||
    !Number.isFinite(raw.tempC) || raw.tempC < -20 || raw.tempC > 45 ||
    typeof raw.windMs !== "number" ||
    !Number.isFinite(raw.windMs) || raw.windMs < 0 || raw.windMs > 20
  ) {
    return null;
  }

  return {
    weather: raw.weather as HourlyForecastEntry["weather"],
    tempC: raw.tempC,
    windMs: raw.windMs,
  };
}

/** 正規化による既定値補完の前後で、比較用入力の有効性を共通判定する。 */
export function isValidEveningComfortForecastEntry(raw: unknown): raw is HourlyForecastEntry {
  return readHourlyForecast(raw) !== null;
}

function getReason(params: {
  eligibleSession: boolean;
  hasComparisonInput: boolean;
  temperatureDifferenceAtLeast5: boolean;
  comfortDecreased: boolean;
  applied: boolean;
}): EveningComfortReliefReason {
  if (!params.eligibleSession) return "not_target_session";
  if (!params.hasComparisonInput) return "comparison_input_unavailable";
  if (!params.temperatureDifferenceAtLeast5) return "temperature_difference_below_5";
  if (!params.comfortDecreased) return "comfort_not_decreased";
  return params.applied ? "applied" : "comfort_not_negative";
}

export function evaluateEveningComfortRelief(params: {
  context: EveningComfortReliefContext;
  effectiveRateDiscountTime: DiscountTime;
  comfortAdjustmentBeforePercent: number;
}): EveningComfortReliefAnalysis {
  const forecasts = isRecord(params.context.hourlyForecasts)
    ? params.context.hourlyForecasts
    : {};
  const input16 = params.context.comparisonInputAvailable === false
    ? null : readHourlyForecast(forecasts["16"]);
  const input21 = params.context.comparisonInputAvailable === false
    ? null : readHourlyForecast(forecasts["21"]);
  const forecast16 = input16
    ? { ...input16, comfortScore: getHourlyForecastComfortScore(input16) }
    : null;
  const forecast21 = input21
    ? { ...input21, comfortScore: getHourlyForecastComfortScore(input21) }
    : null;
  const hasComparisonInput = forecast16 !== null && forecast21 !== null;
  const temperatureDifferenceC = hasComparisonInput
    ? Math.abs(forecast21.tempC - forecast16.tempC)
    : null;
  const eligibleSession = params.context.sessionDiscountTime === "15" ||
    params.context.sessionDiscountTime === "17";
  const temperatureDifferenceAtLeast5 = temperatureDifferenceC !== null &&
    temperatureDifferenceC >= 5;
  // clamp前の同じ尺度で比べる。未来時間帯の合算、暑さ抑制、時刻制限を混ぜない。
  const comfortDecreased = hasComparisonInput &&
    forecast21.comfortScore > forecast16.comfortScore;
  const conditionMet = eligibleSession && temperatureDifferenceAtLeast5 &&
    comfortDecreased;
  const applied = conditionMet && params.comfortAdjustmentBeforePercent < 0;
  const comfortAdjustmentAfterPercent = applied
    ? Math.min(0, params.comfortAdjustmentBeforePercent + 5)
    : params.comfortAdjustmentBeforePercent;

  return {
    version: 1,
    sessionDiscountTime: params.context.sessionDiscountTime,
    effectiveRateDiscountTime: params.effectiveRateDiscountTime,
    forecast16,
    forecast21,
    temperatureDifferenceC,
    eligibleSession,
    temperatureDifferenceAtLeast5,
    comfortDecreased,
    conditionMet,
    comfortAdjustmentBeforePercent: params.comfortAdjustmentBeforePercent,
    comfortAdjustmentAfterPercent,
    applied,
    reliefPercent: applied ? 5 : 0,
    reason: getReason({ eligibleSession, hasComparisonInput,
      temperatureDifferenceAtLeast5, comfortDecreased, applied }),
  };
}

function normalizeStoredHourlyComfort(raw: unknown): EveningHourlyComfortInput | null | undefined {
  if (raw === null) return null;
  const input = readHourlyForecast(raw);
  if (!input || !isRecord(raw) || typeof raw.comfortScore !== "number" ||
    !Number.isInteger(raw.comfortScore) || raw.comfortScore < -2 || raw.comfortScore > 6) {
    return undefined;
  }
  // 保存された比較scoreを保持する。新しい天候ruleで履歴を再評価しない。
  return { ...input, comfortScore: raw.comfortScore };
}

export function normalizeEveningComfortReliefAnalysis(
  raw: unknown,
): EveningComfortReliefAnalysis | undefined {
  if (!isRecord(raw) || raw.version !== 1 ||
    !isDiscountTime(raw.sessionDiscountTime) || !isDiscountTime(raw.effectiveRateDiscountTime) ||
    typeof raw.comfortAdjustmentBeforePercent !== "number" ||
    !Number.isFinite(raw.comfortAdjustmentBeforePercent) ||
    typeof raw.comfortAdjustmentAfterPercent !== "number" ||
    !Number.isFinite(raw.comfortAdjustmentAfterPercent)) return undefined;

  const forecast16 = normalizeStoredHourlyComfort(raw.forecast16);
  const forecast21 = normalizeStoredHourlyComfort(raw.forecast21);
  if (forecast16 === undefined || forecast21 === undefined) return undefined;
  const hasComparisonInput = forecast16 !== null && forecast21 !== null;
  const temperatureDifferenceC = hasComparisonInput
    ? Math.abs(forecast21.tempC - forecast16.tempC)
    : null;
  const eligibleSession = raw.sessionDiscountTime === "15" || raw.sessionDiscountTime === "17";
  const temperatureDifferenceAtLeast5 = temperatureDifferenceC !== null && temperatureDifferenceC >= 5;
  const comfortDecreased = hasComparisonInput && forecast21.comfortScore > forecast16.comfortScore;
  const conditionMet = eligibleSession && temperatureDifferenceAtLeast5 && comfortDecreased;
  const applied = conditionMet && raw.comfortAdjustmentBeforePercent < 0;
  const expectedAfter = applied
    ? Math.min(0, raw.comfortAdjustmentBeforePercent + 5)
    : raw.comfortAdjustmentBeforePercent;
  const reliefPercent = applied ? 5 : 0;
  const reason = getReason({ eligibleSession, hasComparisonInput,
    temperatureDifferenceAtLeast5, comfortDecreased, applied });
  if (raw.temperatureDifferenceC !== temperatureDifferenceC || raw.eligibleSession !== eligibleSession ||
    raw.temperatureDifferenceAtLeast5 !== temperatureDifferenceAtLeast5 ||
    raw.comfortDecreased !== comfortDecreased || raw.conditionMet !== conditionMet ||
    raw.applied !== applied || raw.comfortAdjustmentAfterPercent !== expectedAfter ||
    raw.reliefPercent !== reliefPercent || raw.reason !== reason) return undefined;

  return {
    version: 1,
    sessionDiscountTime: raw.sessionDiscountTime,
    effectiveRateDiscountTime: raw.effectiveRateDiscountTime,
    forecast16,
    forecast21,
    temperatureDifferenceC,
    eligibleSession,
    temperatureDifferenceAtLeast5,
    comfortDecreased,
    conditionMet,
    comfortAdjustmentBeforePercent: raw.comfortAdjustmentBeforePercent,
    comfortAdjustmentAfterPercent: raw.comfortAdjustmentAfterPercent,
    applied,
    reliefPercent,
    reason,
  };
}
