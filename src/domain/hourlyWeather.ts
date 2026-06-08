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
  if (tempC <= 27) return '26to27';
  if (tempC <= 30) return '28to30';
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

type DirectPrecipForecastEntry = {
  hourText: string;
  weather: ForecastWeatherKind;
};

function getDirectPrecipForecastEntries(
  weather: WeatherInput,
  discountTime: DiscountTime,
): DirectPrecipForecastEntry[] {
  switch (discountTime) {
    case '15':
      return (['16', '17', '18'] as ForecastHourKey[]).map((hour) => ({
        hourText: `${hour}時`,
        weather: weather.hourlyForecasts[hour].weather,
      }));
    case '17':
      return (['18', '19', '20'] as ForecastHourKey[]).map((hour) => ({
        hourText: `${hour}時`,
        weather: weather.hourlyForecasts[hour].weather,
      }));
    case '18':
      return (['19', '20', '21'] as ForecastHourKey[]).map((hour) => ({
        hourText: `${hour}時`,
        weather: weather.hourlyForecasts[hour].weather,
      }));
    case '19': {
      const hour20Weather = weather.hourlyForecasts['20'].weather;
      const virtual22Weather = hour20Weather === 'rain' || hour20Weather === 'snow'
        ? hour20Weather
        : 'sunny';

      return [
        { hourText: '20時', weather: hour20Weather },
        { hourText: '21時', weather: weather.hourlyForecasts['21'].weather },
        { hourText: '22時扱い', weather: virtual22Weather },
      ];
    }
    case '20':
      return [{ hourText: '21時', weather: weather.hourlyForecasts['21'].weather }];
  }
}

function getDirectPrecipRateBonus(params: {
  entries: DirectPrecipForecastEntry[];
  discountTime: DiscountTime;
}): { value: number; label: string | null } {
  const origin = params.entries[0];
  if (!origin) {
    return { value: 0, label: null };
  }

  if (origin.weather === 'snow') {
    const hasFollowUpSnow = params.entries.slice(1).some((entry) => entry.weather === 'snow');
    if (hasFollowUpSnow) {
      return { value: 20, label: `${origin.hourText}に雪、その後も雪` };
    }

    return { value: 15, label: `${origin.hourText}に雪` };
  }

  if (origin.weather !== 'rain') {
    return { value: 0, label: null };
  }

  const hasFollowUpRain = params.entries.slice(1).some((entry) => entry.weather === 'rain');
  if (hasFollowUpRain) {
    return { value: 10, label: `${origin.hourText}に雨、その後も雨` };
  }

  return { value: 5, label: `${origin.hourText}に雨` };
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

function getWeatherPointHours(discountTime: DiscountTime): ForecastHourKey[] {
  return getLaterForecastHours(discountTime);
}

function getWeatherPointRangeText(hours: ForecastHourKey[]): string | null {
  if (hours.length === 0) {
    return null;
  }

  const first = hours[0];
  const last = hours[hours.length - 1];
  return first === last ? `${first}時` : `${first}〜${last}時`;
}

function getTempWeatherPoint(tempC: number): number {
  if (tempC <= 5) return -2;
  if (tempC <= 10) return -1;
  if (tempC <= 15) return 0;
  if (tempC <= 20) return 1;
  if (tempC <= 25) return 2;
  if (tempC <= 27) return 1;
  if (tempC <= 30) return 0;
  if (tempC <= 35) return -1;
  return -2;
}

function getPrecipWeatherPoint(weather: ForecastWeatherKind): number {
  switch (weather) {
    case 'rain':
      return -1;
    case 'snow':
      return -2;
    default:
      return 0;
  }
}

function getWindWeatherPoint(entry: HourlyForecastEntry): number {
  if (entry.tempC <= 15) {
    if (entry.windMs >= 5) return -2;
    if (entry.windMs >= 3) return -1;
    return 0;
  }

  return entry.windMs >= 5 ? -1 : 0;
}

function getFutureWeatherPoint(entry: HourlyForecastEntry): number {
  return (
    getTempWeatherPoint(entry.tempC) +
    getPrecipWeatherPoint(entry.weather) +
    getWindWeatherPoint(entry)
  );
}

function getWeatherPointShift(score: number): -2 | -1 | 0 | 1 | 2 {
  if (score >= 7) return -2;
  if (score >= 4) return -1;
  if (score <= -7) return 2;
  if (score <= -4) return 1;
  return 0;
}

export function resolveWeatherInputForDiscount(
  weather: WeatherInput,
  discountTime: DiscountTime,
): ResolvedWeatherInput {
  const nearEntry = weather.hourlyForecasts[getNearForecastHour(discountTime)];
  const laterEntries = getLaterForecastHours(discountTime).map((hour) => weather.hourlyForecasts[hour]);
  const directPrecipRateBonus = getDirectPrecipRateBonus({
    entries: getDirectPrecipForecastEntries(weather, discountTime),
    discountTime,
  });

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

  const weatherPointHours = getWeatherPointHours(discountTime);
  const weatherPointScore = weatherPointHours.reduce(
    (sum, hour) => sum + getFutureWeatherPoint(weather.hourlyForecasts[hour]),
    0,
  );
  const weatherPointShift = getWeatherPointShift(weatherPointScore);
  const weatherPointRangeText = getWeatherPointRangeText(weatherPointHours);

  const next18TempDropShift: -1 | 0 | 1 = 0;
  const next18WindWorsenShift: 0 | 1 | 2 = 0;
  const next18WindWorsenKind: 'cold' | null = null;

  return {
    nearTermWeather: toNearTermWeather(nearEntry.weather),
    hasLaterPrecip: laterPrecipType !== null,
    laterPrecipType,
    precipitationRateBonus: directPrecipRateBonus.value,
    precipitationRateBonusLabel: directPrecipRateBonus.label,
    windLevel: toWindLevel(nearEntry.windMs),
    tempLevel: toTempLevel(nearEntry.tempC),
    weatherPointScore,
    weatherPointShift,
    weatherPointRangeText,
    next18TempDropShift,
    next18WindWorsenShift,
    next18WindWorsenKind,
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
  const nearTemp = typeof params.legacyWeather.nearTempLevel === 'string' ? params.legacyWeather.nearTempLevel : currentTemp;
  const nearWind = typeof params.legacyWeather.nearWindLevel === 'string' ? params.legacyWeather.nearWindLevel : currentWind;
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
  hourlyForecasts[nearHour].tempC = fromTempLevel(nearTemp);
  hourlyForecasts[nearHour].windMs = fromWindLevel(nearWind);

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
    const next18TempLevelRaw = typeof params.legacyWeather.next18TempLevel === 'string'
      ? params.legacyWeather.next18TempLevel
      : (typeof params.legacyWeather.next17TempLevel === 'string' ? params.legacyWeather.next17TempLevel : null);
    const next18WindLevelRaw = typeof params.legacyWeather.next18WindLevel === 'string'
      ? params.legacyWeather.next18WindLevel
      : (typeof params.legacyWeather.next17WindLevel === 'string' ? params.legacyWeather.next17WindLevel : null);

    if (next18TempLevelRaw !== null) {
      hourlyForecasts['18'].tempC = fromTempLevel(next18TempLevelRaw);
    }

    if (next18WindLevelRaw !== null) {
      hourlyForecasts['18'].windMs = fromWindLevel(next18WindLevelRaw);
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
    case '26to27':
      return 27;
    case '26to29':
    case '26to30':
    case '28to30':
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
