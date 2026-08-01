import {
  getWeatherInputForecastHours,
  resolveWeatherInputForDiscount,
  toTempLevel,
} from "../../domain/hourlyWeather.ts";
import {
  evaluateTemperatureComfort,
  normalizeTemperatureComfortAnalysis,
} from "../../domain/temperatureComfort.ts";
import type {
  DailySessionSnapshot,
  DiscountTime,
  LastSessionWeatherRecord,
  ResolvedWeatherInput,
  SessionData,
  TempLevel,
  TemperatureComfortAnalysis,
  WeatherInput,
} from "../../domain/types.ts";

const DISCOUNT_TIME_ORDER: Record<DiscountTime, number> = {
  "15": 0,
  "17": 1,
  "18": 2,
  "19": 3,
  "20": 4,
};

const TEMP_LEVELS = new Set<TempLevel>([
  "5orLess",
  "6to10",
  "11to15",
  "16to20",
  "21to25",
  "26to27",
  "28to30",
  "26to30",
  "31to33",
  "34to35",
  "31to35",
  "36orMore",
]);

type TemperatureObservation = {
  date: string;
  discountTime: DiscountTime;
  tempLevel: TempLevel;
  temperatureFalling?: boolean;
};

export type ResolveSessionTemperatureComfortParams = {
  date: string;
  discountTime: DiscountTime;
  weather: WeatherInput;
  snapshots?: readonly DailySessionSnapshot[];
  lastSessionWeather?: LastSessionWeatherRecord | null;
  previousSession?: SessionData | null;
  existingAnalysis?: TemperatureComfortAnalysis | null;
  legacyUnresolvedTempLevel?: "31to35" | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDiscountTime(value: unknown): value is DiscountTime {
  return (
    value === "15" ||
    value === "17" ||
    value === "18" ||
    value === "19" ||
    value === "20"
  );
}

function isTempLevel(value: unknown): value is TempLevel {
  return typeof value === "string" && TEMP_LEVELS.has(value as TempLevel);
}

function isValidTempC(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -20 &&
    value <= 45
  );
}

export function getNearTemperatureC(
  weather: WeatherInput,
  discountTime: DiscountTime,
): number | undefined {
  const nearHour = getWeatherInputForecastHours(discountTime)[0];
  const rawWeather = weather as unknown;
  if (!nearHour || !isRecord(rawWeather)) return undefined;
  const hourlyForecasts = rawWeather.hourlyForecasts;
  if (!isRecord(hourlyForecasts)) return undefined;
  const entry = hourlyForecasts[nearHour];
  if (!isRecord(entry) || !isValidTempC(entry.tempC)) return undefined;
  return entry.tempC;
}

function getObservationFromWeather(params: {
  date: string;
  discountTime: DiscountTime;
  weather: WeatherInput;
  analysis?: unknown;
  legacyUnresolvedTempLevel?: "31to35" | null;
}): TemperatureObservation | null {
  const analysis = normalizeTemperatureComfortAnalysis(params.analysis);
  if (params.legacyUnresolvedTempLevel === "31to35") {
    return {
      date: params.date,
      discountTime: params.discountTime,
      tempLevel: "31to35",
      ...(analysis?.currentTempLevel === "31to35"
        ? { temperatureFalling: analysis.temperatureFalling }
        : {}),
    };
  }

  const tempC = getNearTemperatureC(params.weather, params.discountTime);
  if (tempC === undefined) return null;
  const tempLevel = toTempLevel(tempC);
  return {
    date: params.date,
    discountTime: params.discountTime,
    tempLevel,
    ...(analysis?.currentTempLevel === tempLevel
      ? { temperatureFalling: analysis.temperatureFalling }
      : {}),
  };
}

function getObservationFromSnapshot(
  snapshot: DailySessionSnapshot,
): TemperatureObservation | null {
  if (
    snapshot.screen !== "done" &&
    snapshot.sessionEndReason !== "auto_time_transition"
  ) {
    return null;
  }
  const session = snapshot.session as unknown;
  if (!isRecord(session) || typeof session.date !== "string") return null;
  if (!isDiscountTime(session.discountTime)) return null;

  const storedAnalysis = isRecord(session.resolvedWeather)
    ? normalizeTemperatureComfortAnalysis(
        session.resolvedWeather.temperatureComfortAnalysis,
      )
    : undefined;
  if (storedAnalysis?.currentTempLevel === "31to35") {
    return {
      date: session.date,
      discountTime: session.discountTime,
      tempLevel: "31to35",
      temperatureFalling: storedAnalysis.temperatureFalling,
    };
  }

  const fromActualWeather = getObservationFromWeather({
    date: session.date,
    discountTime: session.discountTime,
    weather: session.weather as WeatherInput,
    analysis: isRecord(session.resolvedWeather)
      ? session.resolvedWeather.temperatureComfortAnalysis
      : undefined,
  });
  if (fromActualWeather) return fromActualWeather;

  // 実気温がない旧データでは、旧区分を点数互換用にだけ保持する。
  // 31〜35℃を新しい2区分のどちらかへ推測しない。
  if (
    !isRecord(session.resolvedWeather) ||
    !isTempLevel(session.resolvedWeather.tempLevel)
  ) {
    return null;
  }
  const analysis = normalizeTemperatureComfortAnalysis(
    session.resolvedWeather.temperatureComfortAnalysis,
  );
  return {
    date: session.date,
    discountTime: session.discountTime,
    tempLevel: session.resolvedWeather.tempLevel,
    ...(analysis?.currentTempLevel === session.resolvedWeather.tempLevel
      ? { temperatureFalling: analysis.temperatureFalling }
      : {}),
  };
}

function getObservationFromLastSessionWeather(
  record: LastSessionWeatherRecord | null | undefined,
): TemperatureObservation | null {
  if (!record || !isDiscountTime(record.discountTime)) return null;
  const analysis = normalizeTemperatureComfortAnalysis(
    record.temperatureComfortAnalysis,
  );
  const tempLevel = isValidTempC(record.nearTempC)
    ? toTempLevel(record.nearTempC)
    : analysis?.currentTempLevel;
  if (!tempLevel) return null;
  return {
    date: record.date,
    discountTime: record.discountTime,
    tempLevel,
    ...(analysis?.currentTempLevel === tempLevel
      ? { temperatureFalling: analysis.temperatureFalling }
      : {}),
  };
}

function getExistingPreviousObservation(params: {
  date: string;
  analysis?: TemperatureComfortAnalysis | null;
}): TemperatureObservation | null {
  const analysis = normalizeTemperatureComfortAnalysis(params.analysis);
  if (
    !analysis ||
    analysis.previousTempLevel === null ||
    analysis.previousDiscountTime === null
  ) {
    return null;
  }
  return {
    date: params.date,
    discountTime: analysis.previousDiscountTime,
    tempLevel: analysis.previousTempLevel,
    temperatureFalling: analysis.previousTemperatureFalling,
  };
}

function replayPreviousObservations(params: {
  date: string;
  targetDiscountTime: DiscountTime;
  observations: readonly TemperatureObservation[];
}): TemperatureObservation | null {
  const targetOrder = DISCOUNT_TIME_ORDER[params.targetDiscountTime];
  const latestByDiscountTime = new Map<DiscountTime, TemperatureObservation>();

  for (const observation of params.observations) {
    if (
      observation.date !== params.date ||
      DISCOUNT_TIME_ORDER[observation.discountTime] >= targetOrder
    ) {
      continue;
    }
    // 呼び出し側の配列順を優先順位として扱い、後の確定情報で置き換える。
    latestByDiscountTime.set(observation.discountTime, observation);
  }

  const ordered = [...latestByDiscountTime.values()].sort(
    (left, right) =>
      DISCOUNT_TIME_ORDER[left.discountTime] -
      DISCOUNT_TIME_ORDER[right.discountTime],
  );
  let previous: TemperatureObservation | null = null;

  for (const observation of ordered) {
    if (!previous) {
      previous = {
        ...observation,
        temperatureFalling: observation.temperatureFalling ?? false,
      };
      continue;
    }

    const evaluated = evaluateTemperatureComfort({
      date: observation.date,
      discountTime: observation.discountTime,
      tempLevel: observation.tempLevel,
      previous: {
        date: previous.date,
        discountTime: previous.discountTime,
        tempLevel: previous.tempLevel,
        temperatureFalling: previous.temperatureFalling ?? false,
      },
    });
    previous = {
      ...observation,
      temperatureFalling:
        observation.temperatureFalling ?? evaluated.temperatureFalling,
    };
  }

  return previous;
}

export function resolveSessionTemperatureComfort(
  params: ResolveSessionTemperatureComfortParams,
): {
  resolvedWeather: ResolvedWeatherInput;
  analysis: TemperatureComfortAnalysis;
} {
  const resolvedWeather = resolveWeatherInputForDiscount(
    params.weather,
    params.discountTime,
  );
  const observations: TemperatureObservation[] = [];
  const snapshots = [...(params.snapshots ?? [])].sort((left, right) =>
    left.capturedAt.localeCompare(right.capturedAt),
  );
  for (const snapshot of snapshots) {
    const observation = getObservationFromSnapshot(snapshot);
    if (observation) observations.push(observation);
  }

  const lastObservation = getObservationFromLastSessionWeather(
    params.lastSessionWeather,
  );
  if (lastObservation) observations.push(lastObservation);

  if (params.previousSession) {
    const observation = getObservationFromWeather({
      date: params.previousSession.date,
      discountTime: params.previousSession.discountTime,
      weather: params.previousSession.weather,
      analysis: params.previousSession.temperatureComfortAnalysis,
      legacyUnresolvedTempLevel:
        params.previousSession.legacyUnresolvedTempLevel,
    });
    if (observation) observations.push(observation);
  }

  // 現在セッションが保持している直前観測は、同時刻の旧snapshotより優先する。
  const existingPrevious = getExistingPreviousObservation({
    date: params.date,
    analysis: params.existingAnalysis,
  });
  if (existingPrevious) observations.push(existingPrevious);

  const previous = replayPreviousObservations({
    date: params.date,
    targetDiscountTime: params.discountTime,
    observations,
  });
  const analysis = evaluateTemperatureComfort({
    date: params.date,
    discountTime: params.discountTime,
    tempLevel:
      params.legacyUnresolvedTempLevel === "31to35"
        ? "31to35"
        : resolvedWeather.tempLevel,
    previous: previous
      ? {
          date: previous.date,
          discountTime: previous.discountTime,
          tempLevel: previous.tempLevel,
          temperatureFalling: previous.temperatureFalling ?? false,
        }
      : null,
  });

  return {
    resolvedWeather: {
      ...resolvedWeather,
      ...(params.legacyUnresolvedTempLevel === "31to35"
        ? { tempLevel: "31to35" as const }
        : {}),
      temperatureComfortAnalysis: analysis,
    },
    analysis,
  };
}
