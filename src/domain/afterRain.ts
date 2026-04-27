import type {
  AfterRainSky,
  DiscountTime,
  LastSessionWeatherRecord,
  NearTermWeather,
  SessionDraft,
} from './types';

export function shouldOfferAfterRainRecovery(_params: {
  sessionDate: string;
  sessionDiscountTime: DiscountTime;
  nearTermWeather: NearTermWeather;
  lastSessionWeather: LastSessionWeatherRecord | null;
}): boolean {
  return false;
}

export function applyAfterRainSelectionDefaults(params: {
  sessionDraft: SessionDraft;
  lastSessionWeather: LastSessionWeatherRecord | null;
}): SessionDraft {
  const nextAfterRainSky: AfterRainSky = null;

  if (params.sessionDraft.weather.afterRainSky === nextAfterRainSky) {
    return params.sessionDraft;
  }

  return {
    ...params.sessionDraft,
    weather: {
      ...params.sessionDraft.weather,
      afterRainSky: nextAfterRainSky,
    },
  };
}
