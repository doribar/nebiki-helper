import type { ForecastHourKey } from "./types";
import { FORECAST_HOUR_KEYS } from "./hourlyWeather";

export const FIXED_TIME_TEMPERATURE_STORAGE_KEY =
  "nebiki-helper/fixed-time-temperature-by-date-v1";

type TemperatureByHour = Partial<Record<ForecastHourKey, number>>;

type FixedTimeTemperatureStore = {
  version: 1;
  byDate: Record<string, TemperatureByHour>;
};

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isValidTemperature(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -5 &&
    value <= 40
  );
}

function normalizeTemperatureByHour(raw: unknown): TemperatureByHour {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  return FORECAST_HOUR_KEYS.reduce((result, hour) => {
    const value = (raw as Record<string, unknown>)[hour];
    if (isValidTemperature(value)) result[hour] = value;
    return result;
  }, {} as TemperatureByHour);
}

function readStore(): FixedTimeTemperatureStore {
  if (typeof localStorage === "undefined") {
    return { version: 1, byDate: {} };
  }

  try {
    const parsed = JSON.parse(
      localStorage.getItem(FIXED_TIME_TEMPERATURE_STORAGE_KEY) ?? "null",
    ) as Partial<FixedTimeTemperatureStore> | null;
    if (!parsed || parsed.version !== 1 || !parsed.byDate || typeof parsed.byDate !== "object") {
      return { version: 1, byDate: {} };
    }

    const byDate = Object.entries(parsed.byDate).reduce((result, [date, values]) => {
      if (!isValidDate(date)) return result;
      const normalized = normalizeTemperatureByHour(values);
      if (Object.keys(normalized).length > 0) result[date] = normalized;
      return result;
    }, {} as Record<string, TemperatureByHour>);

    return { version: 1, byDate };
  } catch {
    return { version: 1, byDate: {} };
  }
}

function writeStore(store: FixedTimeTemperatureStore): boolean {
  if (typeof localStorage === "undefined") return false;

  try {
    localStorage.setItem(
      FIXED_TIME_TEMPERATURE_STORAGE_KEY,
      JSON.stringify(store),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadFixedTimeTemperatures(params: {
  enabled: boolean;
  date: string;
}): TemperatureByHour {
  if (!params.enabled || !isValidDate(params.date)) return {};
  return { ...readStore().byDate[params.date] };
}

export function saveFixedTimeTemperature(params: {
  enabled: boolean;
  date: string;
  hour: ForecastHourKey;
  tempC: number;
}): boolean {
  if (
    !params.enabled ||
    !isValidDate(params.date) ||
    !FORECAST_HOUR_KEYS.includes(params.hour) ||
    !isValidTemperature(params.tempC)
  ) {
    return false;
  }

  const store = readStore();
  store.byDate[params.date] = {
    ...store.byDate[params.date],
    [params.hour]: params.tempC,
  };
  return writeStore(store);
}

export function saveFixedTimeTemperatures(params: {
  enabled: boolean;
  date: string;
  values: TemperatureByHour;
}): boolean {
  if (!params.enabled || !isValidDate(params.date)) return false;

  const normalized = normalizeTemperatureByHour(params.values);
  if (Object.keys(normalized).length === 0) return false;

  const store = readStore();
  store.byDate[params.date] = {
    ...store.byDate[params.date],
    ...normalized,
  };
  return writeStore(store);
}
