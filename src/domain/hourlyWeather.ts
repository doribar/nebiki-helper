import type {
  DiscountTime,
  ForecastHourKey,
  ForecastWeatherKind,
  HourlyForecastEntry,
  HourlyForecastMap,
  LaterPrecipType,
  NearTermWeather,
  ResolvedWeatherInput,
  TempLevel,
  WeatherInput,
  WindLevel,
} from './types';

export const FORECAST_HOUR_KEYS: ForecastHourKey[] = [
  '15', '16', '17', '18', '19', '20', '21',
];

export function createDefaultHourlyForecasts(): HourlyForecastMap {
  return FORECAST_HOUR_KEYS.reduce((acc, hour) => {
    acc[hour] = {
      weather: 'sunny',
      tempC: 15,
      windMs: 2,
    };
    return acc;
  }, {} as HourlyForecastMap);
}

export function cloneHourlyForecasts(hourlyForecasts: HourlyForecastMap): HourlyForecastMap {
  return FORECAST_HOUR_KEYS.reduce((acc, hour) => {
    acc[hour] = { ...hourlyForecasts[hour] };
    return acc;
  }, {} as HourlyForecastMap);
}

export function cycleForecastWeather(current: ForecastWeatherKind): ForecastWeatherKind {
  switch (current) {
    case 'sunny':
      return 'rain';
    case 'rain':
      return 'snow';
    case 'snow':
      return 'sunny';
  }
}

export function getForecastWeatherLabel(weather: ForecastWeatherKind): string {
  switch (weather) {
    case 'sunny':
      return '晴れ';
    case 'rain':
      return '雨';
    case 'snow':
      return '雪';
  }
}

export function getForecastWeatherSymbol(weather: ForecastWeatherKind): string {
  switch (weather) {
    case 'sunny':
      return '☀';
    case 'rain':
      return '☂';
    case 'snow':
      return '❄';
  }
}

export function toTempLevel(tempC: number): TempLevel {
  if (tempC <= 5) return '5orLess';
  if (tempC <= 10) return '6to10';
  if (tempC <= 15) return '11to15';
  if (tempC <= 20) return '16to20';
  if (tempC <= 25) return '21to25';
  if (tempC <= 30) return '26to30';
  if (tempC <= 35) return '31to35';
  return '36orMore';
}

export function toWindLevel(windMs: number): WindLevel {
  if (windMs <= 2) return '2orLess';
  if (windMs <= 4) return '3to4';
  return '5orMore';
}

export function toNearTermWeather(weather: ForecastWeatherKind): NearTermWeather {
  switch (weather) {
    case 'rain':
      return 'rain';
    case 'snow':
      return 'snow';
    default:
      return 'other';
  }
}

function getCurrentForecastHour(discountTime: DiscountTime): ForecastHourKey {
  switch (discountTime) {
    case '15':
      return '15';
    case '17':
      return '17';
    case '18':
      return '18';
    case '19':
      return '19';
    case '20':
      return '20';
  }
}

function getNearForecastHour(discountTime: DiscountTime): ForecastHourKey {
  switch (discountTime) {
    case '15':
      return '16';
    case '17':
      return '18';
    case '18':
      return '19';
    case '19':
      return '20';
    case '20':
      return '21';
  }
}

function getLaterForecastHours(discountTime: DiscountTime): ForecastHourKey[] {
  switch (discountTime) {
    case '15':
      return ['17', '18', '19', '20', '21'];
    case '17':
      return ['19', '20', '21'];
    case '18':
      return ['20', '21'];
    case '19':
      return ['21'];
    case '20':
      return [];
  }
}

export function resolveWeatherInputForDiscount(
  weather: WeatherInput,
  discountTime: DiscountTime,
): ResolvedWeatherInput {
  const currentEntry = weather.hourlyForecasts[getCurrentForecastHour(discountTime)];
  const nearEntry = weather.hourlyForecasts[getNearForecastHour(discountTime)];
  const laterEntries = getLaterForecastHours(discountTime).map((hour) => weather.hourlyForecasts[hour]);

  let laterPrecipType: LaterPrecipType = null;
  for (const entry of laterEntries) {
    if (entry.weather === 'rain') {
      laterPrecipType = 'rain';
      break;
    }

    if (entry.weather === 'snow') {
      laterPrecipType = 'snow';
      break;
    }
  }

  const current15 = weather.hourlyForecasts['15'];
  const current17 = weather.hourlyForecasts['17'];
  const next17TempDropShift: 0 | 1 =
    discountTime === '15' && current17.tempC <= current15.tempC - 5 ? 1 : 0;
  const next17WindWorsenShift: 0 | 1 =
    discountTime === '15' && next17TempDropShift === 1 && current17.windMs > current15.windMs ? 1 : 0;

  return {
    nearTermWeather: toNearTermWeather(nearEntry.weather),
    hasLaterPrecip: laterPrecipType !== null,
    laterPrecipType,
    windLevel: toWindLevel(currentEntry.windMs),
    tempLevel: toTempLevel(currentEntry.tempC),
    next17TempDropShift,
    next17WindWorsenShift,
    afterRainSky: weather.afterRainSky,
  };
}

export function getNearTermWeatherForDiscount(
  weather: WeatherInput,
  discountTime: DiscountTime,
): NearTermWeather {
  return resolveWeatherInputForDiscount(weather, discountTime).nearTermWeather;
}

export function normalizeHourlyForecastEntry(raw: unknown, fallback?: HourlyForecastEntry): HourlyForecastEntry {
  const base: HourlyForecastEntry = fallback ?? { weather: 'sunny', tempC: 15, windMs: 2 };
  if (!raw || typeof raw !== 'object') {
    return { ...base };
  }

  const source = raw as Record<string, unknown>;
  const weather = source.weather === 'sunny' || source.weather === 'rain' || source.weather === 'snow'
    ? source.weather
    : base.weather;
  const tempC = typeof source.tempC === 'number' && Number.isFinite(source.tempC)
    ? Math.max(-20, Math.min(45, Math.round(source.tempC)))
    : base.tempC;
  const windMs = typeof source.windMs === 'number' && Number.isFinite(source.windMs)
    ? Math.max(0, Math.min(20, Math.round(source.windMs)))
    : base.windMs;

  return { weather, tempC, windMs };
}

export function buildHourlyForecastsFromLegacy(params: {
  legacyWeather: Record<string, unknown>;
  discountTime: DiscountTime;
}): HourlyForecastMap {
  const currentTemp = typeof params.legacyWeather.tempLevel === 'string' ? params.legacyWeather.tempLevel : null;
  const currentWind = typeof params.legacyWeather.windLevel === 'string' ? params.legacyWeather.windLevel : null;
  const baseTempC = fromTempLevel(currentTemp);
  const baseWindMs = fromWindLevel(currentWind);
  const hourlyForecasts = FORECAST_HOUR_KEYS.reduce((acc, hour) => {
    acc[hour] = {
      weather: 'sunny',
      tempC: baseTempC,
      windMs: baseWindMs,
    };
    return acc;
  }, {} as HourlyForecastMap);
  const currentHour = getCurrentForecastHour(params.discountTime);
  const nearHour = getNearForecastHour(params.discountTime);

  hourlyForecasts[currentHour] = {
    weather: 'sunny',
    tempC: baseTempC,
    windMs: baseWindMs,
  };

  const nearTermWeather = params.legacyWeather.nearTermWeather;
  if (nearTermWeather === 'rain' || nearTermWeather === 'snow') {
    hourlyForecasts[nearHour].weather = nearTermWeather;
  }

  if (params.legacyWeather.hasLaterPrecip === true) {
    const laterHours = getLaterForecastHours(params.discountTime);
    if (laterHours.length > 0) {
      const laterType = params.legacyWeather.laterPrecipType === 'snow' ? 'snow' : 'rain';
      hourlyForecasts[laterHours[0]].weather = laterType;
    }
  }

  if (params.discountTime === '15') {
    const next17TempLevel = typeof params.legacyWeather.next17TempLevel === 'string'
      ? params.legacyWeather.next17TempLevel
      : null;
    const next17WindLevel = typeof params.legacyWeather.next17WindLevel === 'string'
      ? params.legacyWeather.next17WindLevel
      : null;

    if (next17TempLevel !== null) {
      hourlyForecasts['17'].tempC = fromTempLevel(next17TempLevel);
    }

    if (next17WindLevel !== null) {
      hourlyForecasts['17'].windMs = fromWindLevel(next17WindLevel);
    }
  }

  return hourlyForecasts;
}

function fromTempLevel(level: unknown): number {
  switch (level) {
    case '5orLess':
      return 5;
    case '6to10':
    case '10orLess':
      return 8;
    case '11to15':
      return 13;
    case '16to20':
      return 18;
    case '21to25':
      return 23;
    case '26to29':
    case '26to30':
    case '26orMore':
      return 28;
    case '30to34':
    case '31to35':
      return 33;
    case '35orMore':
    case '36orMore':
      return 36;
    default:
      return 15;
  }
}

function fromWindLevel(level: unknown): number {
  switch (level) {
    case '2orLess':
      return 2;
    case '3to4':
      return 4;
    case '5orMore':
      return 5;
    default:
      return 2;
  }
}
