import type {
  DailySessionSnapshot,
  ForecastHourKey,
  ForecastWeatherKind,
  HourlyForecastEntry,
  SessionData,
  SessionDraft,
} from "./types";
import {
  FORECAST_HOUR_KEYS,
  getWeatherInputForecastHours,
} from "./hourlyWeather";

export type ConfirmedHourlyWeather = Partial<
  Record<ForecastHourKey, HourlyForecastEntry>
>;

export type WeatherConfirmationDisplayRow = {
  hour: ForecastHourKey;
  isPast: boolean;
  weather: ForecastWeatherKind | null;
  tempC: number | null;
  windMs: number | null;
};

type ConfirmedWeatherSource = Pick<
  SessionData,
  "date" | "discountTime" | "weather"
>;

function applyConfirmedSource(params: {
  result: ConfirmedHourlyWeather;
  date: string;
  source: ConfirmedWeatherSource | null | undefined;
}): void {
  if (!params.source || params.source.date !== params.date) return;

  for (const hour of getWeatherInputForecastHours(params.source.discountTime)) {
    const entry = params.source.weather.hourlyForecasts[hour];
    params.result[hour] = { ...entry };
  }
}

export function buildSameDayConfirmedHourlyWeather(params: {
  date: string;
  snapshots: DailySessionSnapshot[];
  currentSession?: SessionData | null;
}): ConfirmedHourlyWeather {
  const result: ConfirmedHourlyWeather = {};
  const snapshots = params.snapshots
    .filter(
      (snapshot) =>
        snapshot.session.date === params.date &&
        (snapshot.screen === "done" ||
          snapshot.sessionEndReason === "auto_time_transition"),
    )
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));

  for (const snapshot of snapshots) {
    applyConfirmedSource({
      result,
      date: params.date,
      source: snapshot.session,
    });
  }

  applyConfirmedSource({
    result,
    date: params.date,
    source: params.currentSession,
  });

  return result;
}

export function buildWeatherConfirmationDisplayRows(params: {
  sessionDraft: SessionDraft;
  activeHours: ForecastHourKey[];
  confirmedHourlyWeather: ConfirmedHourlyWeather;
  fixedTimeTemperatures: Partial<Record<ForecastHourKey, number>>;
}): WeatherConfirmationDisplayRow[] {
  const activeHourSet = new Set(params.activeHours);

  return FORECAST_HOUR_KEYS.map((hour) => {
    if (activeHourSet.has(hour)) {
      const current = params.sessionDraft.weather.hourlyForecasts[hour];
      return {
        hour,
        isPast: false,
        weather: current.weather,
        tempC: current.tempC,
        windMs: current.windMs,
      };
    }

    const confirmed = params.confirmedHourlyWeather[hour];
    return {
      hour,
      isPast: true,
      weather: confirmed?.weather ?? null,
      tempC:
        confirmed?.tempC ?? params.fixedTimeTemperatures[hour] ?? null,
      windMs: confirmed?.windMs ?? null,
    };
  });
}
