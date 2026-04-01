import type {
  AfterRainSky,
  DiscountTime,
  LastSessionWeatherRecord,
  NearTermWeather,
  SessionDraft,
} from './types';

function getDiscountTimeOrder(discountTime: DiscountTime): number {
  switch (discountTime) {
    case '15':
      return 0;
    case '17':
      return 1;
    case '18':
      return 2;
    case '19':
      return 3;
    case '20':
      return 4;
  }
}

export function shouldOfferAfterRainRecovery(params: {
  sessionDate: string;
  sessionDiscountTime: DiscountTime;
  nearTermWeather: NearTermWeather;
  lastSessionWeather: LastSessionWeatherRecord | null;
}): boolean {
  if (params.nearTermWeather !== 'other') {
    return false;
  }

  const lastSessionWeather = params.lastSessionWeather;

  if (!lastSessionWeather) {
    return false;
  }

  if (lastSessionWeather.nearTermWeather !== 'rain') {
    return false;
  }

  if (lastSessionWeather.date !== params.sessionDate) {
    return false;
  }

  return (
    getDiscountTimeOrder(lastSessionWeather.discountTime) <
    getDiscountTimeOrder(params.sessionDiscountTime)
  );
}

export function applyAfterRainSelectionDefaults(params: {
  sessionDraft: SessionDraft;
  lastSessionWeather: LastSessionWeatherRecord | null;
}): SessionDraft {
  const shouldOffer = shouldOfferAfterRainRecovery({
    sessionDate: params.sessionDraft.date,
    sessionDiscountTime: params.sessionDraft.discountTime,
    nearTermWeather: params.sessionDraft.weather.nearTermWeather,
    lastSessionWeather: params.lastSessionWeather,
  });

  const nextAfterRainSky: AfterRainSky = shouldOffer
    ? params.sessionDraft.weather.afterRainSky ?? 'cloudy'
    : null;

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
