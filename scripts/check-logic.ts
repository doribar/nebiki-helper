import assert from 'node:assert/strict';
import {
  buildMergedBonusDisplay,
  getBasisGuideDisplay,
  getWeekdayBaseInfo,
} from '../src/domain/weekdayBase.ts';
import { getFinalTimeGuide, getNormalTimeRateDisplay } from '../src/domain/discount.ts';
import { shouldOfferAfterRainRecovery } from '../src/domain/afterRain.ts';
import { getNextPendingCandidate, getPendingResumeScreen } from '../src/domain/pending.ts';
import { AREA_MASTERS, DONE_SUMMARY_ROUTE, NORMAL_ROUTE } from '../src/domain/area.ts';
import { buildHourlyForecastsFromLegacy, resolveWeatherInputForDiscount } from '../src/domain/hourlyWeather.ts';
import {
  appendNavigationHistory,
  cloneNavigationSnapshot,
  createNavigationSnapshot,
  popNavigationHistory,
} from '../src/domain/navigationHistory.ts';
import { appendSkipRecordsInMemory } from '../src/domain/storage.ts';
import type {
  AreaId,
  AppState,
  DiscountTime,
  LastSessionWeatherRecord,
  NextSessionSkipRecord,
  WeatherInput,
} from '../src/domain/types.ts';

type LegacyWeatherSpec = Record<string, unknown> & { afterRainSky?: 'cloudy' | 'sunny' | null };

type Case = {
  name: string;
  date?: string;
  weekday: number;
  discountTime: DiscountTime;
  weatherSpec: LegacyWeatherSpec;
  expected: {
    adjusted: string;
    baseRateBonus: number;
    weekdayCalcIncludes?: string[];
    weekdayResultIncludes?: string[];
    bonusCalcIncludes?: string[];
    bonusResultIncludes?: string[];
    bonusCalcAbsent?: boolean;
  };
};

function weather(partial: LegacyWeatherSpec): LegacyWeatherSpec {
  return {
    nearTermWeather: 'other',
    hasLaterPrecip: false,
    laterPrecipType: null,
    windLevel: '2orLess',
    tempLevel: '11to15',
    next18WindLevel: null,
    next18TempLevel: null,
    afterRainSky: null,
    ...partial,
  };
}

function toWeatherInput(discountTime: DiscountTime, spec: LegacyWeatherSpec): WeatherInput {
  return {
    hourlyForecasts: buildHourlyForecastsFromLegacy({ legacyWeather: spec, discountTime }),
    afterRainSky: spec.afterRainSky ?? null,
  };
}

const cases: Case[] = [
  {
    name: '乾いた日・基準変化なし',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({}),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      bonusCalcAbsent: true,
    },
  },
  {
    name: '低気温 + 風速3m以上は2段強める',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '6to10', windLevel: '3to4' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['気温 6〜10度 +1段', '風 3m以上（15度以下） +1段'],
      weekdayResultIncludes: ['曜日基準補正は+2段', '月曜・水曜の基準を使用します'],
    },
  },
  {
    name: '超低気温で上限に当たった乾いた日は +5%',
    weekday: 1,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '5orLess' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 5,
      weekdayResultIncludes: ['上限に当たるため月曜・水曜の基準を使用します'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +5%'],
      bonusResultIncludes: ['値引率補正は+5%'],
    },
  },
  {
    name: '16時の雨は +10% を残しつつ頭打ち +5% を入れない',
    weekday: 1,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '5orLess', nearTermWeather: 'rain' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 10,
      bonusCalcIncludes: ['16時に雨 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '16〜20度は1段弱める',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '16to20' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['気温 16〜20度 -1段'],
      weekdayResultIncludes: ['曜日基準補正は-1段', '金曜・土曜の基準を使用します'],
    },
  },
  {
    name: '16〜20度と風速5m以上は相殺される',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '16to20', windLevel: '5orMore' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['気温 16〜20度 -1段', '風 5m以上 +1段'],
      weekdayResultIncludes: ['曜日基準補正は0段', '火曜・木曜の基準のままです'],
    },
  },
  {
    name: '21〜25度で17時以降の下限に当たる乾いた日は -5%',
    weekday: 5,
    discountTime: '17',
    weatherSpec: weather({ tempLevel: '21to25' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: -5,
      bonusCalcIncludes: ['曜日基準で補正しきれない分 -5%'],
      bonusResultIncludes: ['値引率補正は-5%'],
    },
  },
  {
    name: '日曜17時以降は火木基準から始まり下限は金土',
    weekday: 0,
    discountTime: '17',
    weatherSpec: weather({ tempLevel: '21to25' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: -5,
      weekdayResultIncludes: ['金曜・土曜の基準を使用します'],
    },
  },
  {
    name: '1時間30分後〜23時の雨で上限に当たったら +5% はかかる',
    weekday: 1,
    discountTime: '15',
    weatherSpec: weather({ hasLaterPrecip: true, laterPrecipType: 'rain' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 5,
      weekdayCalcIncludes: ['17〜21時に雨 +1段'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +5%'],
    },
  },
  {
    name: '1時間30分後〜23時の雪は曜日基準を2段強める',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({ hasLaterPrecip: true, laterPrecipType: 'snow' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['17〜21時に雪 +2段'],
      weekdayResultIncludes: ['曜日基準補正は+2段'],
    },
  },
  {
    name: '17時以降の上方向2段あふれは +10%',
    weekday: 1,
    discountTime: '17',
    weatherSpec: weather({ tempLevel: '36orMore', windLevel: '5orMore' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 10,
      weekdayCalcIncludes: ['気温 36度以上 +2段', '風 5m以上 +1段'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '15時の下方向2段あふれは -10%',
    weekday: 0,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '21to25' }),
    expected: {
      adjusted: '日',
      baseRateBonus: -10,
      bonusCalcIncludes: ['曜日基準で補正しきれない分 -10%'],
      bonusResultIncludes: ['値引率補正は-10%'],
    },
  },
  {
    name: '15時と18時の気温差が6度以上なら1段強める',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({
      tempLevel: '16to20',
      windLevel: '2orLess',
      next18TempLevel: '6to10',
      next18WindLevel: '2orLess',
    }),
    expected: {
      adjusted: '金土',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['気温 16〜20度 -1段', '15時と18時の気温差が6度以上（18時が15度以下） +1段'],
      weekdayResultIncludes: ['曜日基準補正は0段', '金曜・土曜の基準のままです'],
    },
  },
  {
    name: '15時と18時の気温差6度以上と風強まりで補正しきれない分 +5% に届く',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({
      tempLevel: '31to35',
      windLevel: '2orLess',
      next18TempLevel: '6to10',
      next18WindLevel: '5orMore',
    }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 5,
      weekdayCalcIncludes: ['気温 31〜35度 +1段', '15時と18時の気温差が6度以上（18時が15度以下） +1段', '18時が15度以下で風3m以上に強まる +1段'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +5%'],
      bonusResultIncludes: ['値引率補正は+5%'],
    },
  },
  {
    name: '26〜27度は1段弱める',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '26to27' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['気温 26〜27度 -1段'],
      weekdayResultIncludes: ['曜日基準補正は-1段', '金曜・土曜の基準を使用します'],
    },
  },
  {
    name: '28〜30度は補正なし',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '28to30' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      bonusCalcAbsent: true,
    },
  },
  {
    name: '31〜35度は1段強める',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '31to35' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['気温 31〜35度 +1段'],
    },
  },
  {
    name: '36度以上は2段強める',
    weekday: 4,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '36orMore' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 5,
      weekdayCalcIncludes: ['気温 36度以上 +2段'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +5%'],
    },
  },
  {
    name: '16時の雪は +20%',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ nearTermWeather: 'snow' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 20,
      bonusCalcIncludes: ['16時に雪 +20%'],
      bonusResultIncludes: ['値引率補正は+20%'],
    },
  },
  {
    name: '18時の雨がある日は下限に当たっても -5% を入れない',
    weekday: 5,
    discountTime: '17',
    weatherSpec: weather({ tempLevel: '21to25', nearTermWeather: 'rain' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: 10,
      bonusCalcIncludes: ['18時に雨 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '雨上がり後の晴れは補正なし',
    weekday: 2,
    discountTime: '17',
    weatherSpec: weather({ afterRainSky: 'sunny' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      bonusCalcAbsent: true,
    },
  },
  {
    name: '雨上がり後のくもりは補正なし',
    weekday: 2,
    discountTime: '17',
    weatherSpec: weather({ afterRainSky: 'cloudy' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      bonusCalcAbsent: true,
    },
  },
  {
    name: 'GW連休3日目の翌日15時は曜日基準を1段強める',
    date: '2026-05-05',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({}),
    expected: {
      adjusted: '金土',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['GW連休3日目の翌日 +1段'],
      weekdayResultIncludes: ['曜日基準補正は+1段', '金曜・土曜の基準を使用します'],
    },
  },
  {
    name: 'GW連休3日目の翌日17時は曜日基準を2段強める',
    date: '2026-05-05',
    weekday: 2,
    discountTime: '17',
    weatherSpec: weather({}),
    expected: {
      adjusted: '月水',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['GW連休3日目の翌日 +2段'],
      weekdayResultIncludes: ['曜日基準補正は+2段', '月曜・水曜の基準を使用します'],
    },
  },
  {
    name: '2025年のGW連休3日目翌日17時も曜日基準を2段強める',
    date: '2025-05-06',
    weekday: 2,
    discountTime: '17',
    weatherSpec: weather({}),
    expected: {
      adjusted: '月水',
      baseRateBonus: 5,
      weekdayCalcIncludes: ['GW連休3日目の翌日 +2段'],
      weekdayResultIncludes: ['曜日基準補正は+2段', '上限に当たるため月曜・水曜の基準を使用します'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +5%'],
      bonusResultIncludes: ['値引率補正は+5%'],
    },
  },
  {
    name: 'GW連休3日目の翌日でも18時30分以降は追加しない',
    date: '2026-05-05',
    weekday: 2,
    discountTime: '18',
    weatherSpec: weather({}),
    expected: {
      adjusted: '金土',
      baseRateBonus: 0,
      bonusCalcAbsent: true,
    },
  },
];



function makeState(partial: Partial<AppState>): AppState {
  return {
    screen: 'start',
    session: null,
    sessionDraft: {
      date: '2026-04-01',
      weekday: 3,
      discountTime: '15',
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather: toWeatherInput('15', weather({})),
    },
    areaProgressMap: {
      bento_men: { areaId: 'bento_men', status: 'unstarted', areaJudge: null },
      hosomaki: { areaId: 'hosomaki', status: 'unstarted', areaJudge: null },
      inari: { areaId: 'inari', status: 'unstarted', areaJudge: null },
      futomaki_chumaki: { areaId: 'futomaki_chumaki', status: 'unstarted', areaJudge: null },
      sushi: { areaId: 'sushi', status: 'unstarted', areaJudge: null },
      onigiri: { areaId: 'onigiri', status: 'unstarted', areaJudge: null },
      balance_bento: { areaId: 'balance_bento', status: 'unstarted', areaJudge: null },
      chuka_fish: { areaId: 'chuka_fish', status: 'unstarted', areaJudge: null },
      yakitori: { areaId: 'yakitori', status: 'unstarted', areaJudge: null },
      fry_chicken: { areaId: 'fry_chicken', status: 'unstarted', areaJudge: null },
      croquette: { areaId: 'croquette', status: 'unstarted', areaJudge: null },
      tempura: { areaId: 'tempura', status: 'unstarted', areaJudge: null },
    },
    currentAreaId: null,
    lastReferenceAreaId: null,
    currentFlow: 'normal',
    pendingDeferredAreaIds: [],
    timeSwitchNotice: null,
    finalTimeStep: 0,
    ...partial,
  };
}

function makeNavigationSnapshot(params: {
  state: AppState;
  nextSessionSkipRecords?: NextSessionSkipRecord[];
  lastSessionWeather?: LastSessionWeatherRecord | null;
}) {
  return createNavigationSnapshot({
    state: params.state,
    areaJudgeSelection: params.state.currentAreaId ? 'normal' : null,
    resumeTargetScreen: null,
    nextSessionSkipRecords: params.nextSessionSkipRecords ?? [],
    lastSessionWeather: params.lastSessionWeather ?? null,
  });
}

type ScenarioCase = {
  name: string;
  weekday: number;
  discountTime: DiscountTime;
  weatherSpec: LegacyWeatherSpec;
  lateTimeBonus?: number;
  expected: {
    weekdaySummary: string;
    bonusSummary: string;
    finalRates?: { count3OrMore: string; count2: string; count1: string };
  };
};

const scenarioCases: ScenarioCase[] = [
  {
    name: '運用シナリオ: 水曜日17時・18時に雨あり',
    weekday: 3,
    discountTime: '17',
    weatherSpec: weather({ nearTermWeather: 'rain' }),
    expected: {
      weekdaySummary: '曜日基準補正：なし',
      bonusSummary: '値引率補正：+10％',
      finalRates: { count3OrMore: '50%', count2: '40%', count1: '30%' },
    },
  },
  {
    name: '運用シナリオ: 日曜日15時・暑めで客足やや戻る',
    weekday: 0,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '21to25' }),
    expected: {
      weekdaySummary: '曜日基準補正：なし',
      bonusSummary: '値引率補正：-10％',
      finalRates: { count3OrMore: '50%', count2: '40%', count1: '30%' },
    },
  },
  {
    name: '運用シナリオ: 金曜日19時30分・猛暑で風も強い',
    weekday: 5,
    discountTime: '19',
    weatherSpec: weather({ tempLevel: '36orMore', windLevel: '5orMore' }),
    expected: {
      weekdaySummary: '曜日基準補正：金土→月水',
      bonusSummary: '値引率補正：+5％',
      finalRates: { count3OrMore: '50%', count2: '40%', count1: '30%' },
    },
  },
  {
    name: '運用シナリオ: 火曜日17時・雨上がり後に晴れ',
    weekday: 2,
    discountTime: '17',
    weatherSpec: weather({ afterRainSky: 'sunny' }),
    expected: {
      weekdaySummary: '曜日基準補正：なし',
      bonusSummary: '値引率補正：なし',
      finalRates: { count3OrMore: '50%', count2: '40%', count1: '30%' },
    },
  },
  {
    name: '運用シナリオ: 月曜日17時・18時の雨と時刻接近が重なる',
    weekday: 1,
    discountTime: '17',
    weatherSpec: weather({ nearTermWeather: 'rain' }),
    lateTimeBonus: 5,
    expected: {
      weekdaySummary: '曜日基準補正：なし',
      bonusSummary: '値引率補正：+15％',
      finalRates: { count3OrMore: '50%', count2: '40%', count1: '30%' },
    },
  },
  {
    name: '運用シナリオ: 15時に18時の寒さと風の強まりを先読みする',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({
      tempLevel: '16to20',
      windLevel: '2orLess',
      next18TempLevel: '6to10',
      next18WindLevel: '5orMore',
    }),
    expected: {
      weekdaySummary: '曜日基準補正：金土→火木',
      bonusSummary: '値引率補正：なし',
      finalRates: { count3OrMore: '50%', count2: '40%', count1: '30%' },
    },
  },
];


type ManyTenOrMoreNoteCase = {
  name: string;
  discountTime: Exclude<DiscountTime, '20'>;
  weatherBonus: number;
  isSunday?: boolean;
  expectedNoteIncludes?: string[];
  expectedNoteExcludes?: string[];
};

const manyTenOrMoreNoteCases: ManyTenOrMoreNoteCase[] = [
  {
    name: '多いが引かないでも10個以上は10%目安を表示する',
    discountTime: '15',
    weatherBonus: -10,
    expectedNoteIncludes: ['多いのうち10個以上は 10%'],
  },
  {
    name: '多いが5%なら10個以上は15%目安を表示する',
    discountTime: '15',
    weatherBonus: -5,
    expectedNoteIncludes: ['多いのうち10個以上は 15%'],
  },
  {
    name: '15時でも多い10個以上の+10%目安を表示する',
    discountTime: '15',
    weatherBonus: 0,
    expectedNoteIncludes: ['多いのうち10個以上は 20%'],
  },
  {
    name: '日曜15時はやや多いを出さず10個以上補足だけを表示する',
    discountTime: '15',
    weatherBonus: 0,
    isSunday: true,
    expectedNoteIncludes: [
      '多いのうち10個以上は 20%',
    ],
  },
  {
    name: '30%上限に当たる場合は多い10個以上の同率注記を表示しない',
    discountTime: '19',
    weatherBonus: 0,
    expectedNoteExcludes: ['多いのうち10個以上は 30%'],
  },
];

let passed = 0;


{
  const weatherInput: WeatherInput = {
    hourlyForecasts: buildHourlyForecastsFromLegacy({ legacyWeather: weather({}), discountTime: '15' }),
    afterRainSky: null,
  };
  weatherInput.hourlyForecasts['16'].tempC = 27;
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(2, '15', resolvedWeather, '2026-04-01');
  const guide = getBasisGuideDisplay({
    date: '2026-04-01',
    weekday: 2,
    discountTime: '15',
    weather: resolvedWeather,
  });

  try {
    assert.equal(resolvedWeather.tempLevel, '26to27');
    assert.equal(info.adjusted, '金土');
    assert.equal(info.baseRateBonus, 0);
    assert.ok(guide.weekdayCalcText?.includes('気温 26〜27度 -1段'), 'weekdayCalcText に「気温 26〜27度 -1段」がありません');
    console.log('PASS: 27度は26〜27度として1段弱める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 27度は26〜27度として1段弱める');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    process.exitCode = 1;
  }
}

{
  const weatherInput: WeatherInput = {
    hourlyForecasts: buildHourlyForecastsFromLegacy({ legacyWeather: weather({}), discountTime: '15' }),
    afterRainSky: null,
  };
  weatherInput.hourlyForecasts['16'].tempC = 28;
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(2, '15', resolvedWeather, '2026-04-01');
  const guide = getBasisGuideDisplay({
    date: '2026-04-01',
    weekday: 2,
    discountTime: '15',
    weather: resolvedWeather,
  });

  try {
    assert.equal(resolvedWeather.tempLevel, '28to30');
    assert.equal(info.adjusted, '火木');
    assert.equal(info.baseRateBonus, 0);
    assert.equal(guide.weekdayCalcText, undefined);
    console.log('PASS: 28度は28〜30度として補正なし');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 28度は28〜30度として補正なし');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    process.exitCode = 1;
  }
}



{
  const weatherInput: WeatherInput = {
    hourlyForecasts: buildHourlyForecastsFromLegacy({ legacyWeather: weather({}), discountTime: '15' }),
    afterRainSky: null,
  };
  weatherInput.hourlyForecasts['15'].tempC = 30;
  weatherInput.hourlyForecasts['16'].tempC = 28;
  weatherInput.hourlyForecasts['18'].tempC = 24;
  weatherInput.hourlyForecasts['15'].windMs = 2;
  weatherInput.hourlyForecasts['18'].windMs = 5;
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(2, '15', resolvedWeather, '2026-04-01');
  const guide = getBasisGuideDisplay({
    date: '2026-04-01',
    weekday: 2,
    discountTime: '15',
    weather: resolvedWeather,
  });

  try {
    assert.equal(resolvedWeather.next18TempDropShift, -1);
    assert.equal(resolvedWeather.next18WindWorsenShift, 0);
    assert.equal(info.adjusted, '金土');
    assert.ok(guide.weekdayCalcText?.includes('15時と18時の気温差が6度以上（18時が21〜25度） -1段'), 'weekdayCalcText に快適化の-1段がありません');
    assert.ok(!guide.weekdayCalcText?.includes('風3m以上に強まる'), '快適な18時では風強まり補正を出さない');
    console.log('PASS: 30度から24度に下がる場合は1段弱め、風強まりは加えない');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 30度から24度に下がる場合は1段弱め、風強まりは加えない');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}


{
  const weatherInput: WeatherInput = {
    hourlyForecasts: buildHourlyForecastsFromLegacy({ legacyWeather: weather({}), discountTime: '15' }),
    afterRainSky: null,
  };
  weatherInput.hourlyForecasts['15'].tempC = 31;
  weatherInput.hourlyForecasts['16'].tempC = 31;
  weatherInput.hourlyForecasts['18'].tempC = 25;
  weatherInput.hourlyForecasts['16'].windMs = 2;
  weatherInput.hourlyForecasts['15'].windMs = 2;
  weatherInput.hourlyForecasts['18'].windMs = 2;
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(5, '15', resolvedWeather, '2026-04-03');
  const guide = getBasisGuideDisplay({
    date: '2026-04-03',
    weekday: 5,
    discountTime: '15',
    weather: resolvedWeather,
  });

  try {
    assert.equal(resolvedWeather.tempLevel, '31to35');
    assert.equal(resolvedWeather.next18TempDropShift, -1);
    assert.equal(resolvedWeather.next18WindWorsenShift, 0);
    assert.equal(info.adjusted, '金土');
    assert.equal(info.baseRateBonus, 0);
    assert.ok(guide.weekdayCalcText?.includes('気温 31〜35度 +1段'), 'weekdayCalcText に通常気温補正の+1段がありません');
    assert.ok(guide.weekdayCalcText?.includes('15時と18時の気温差が6度以上（18時が21〜25度） -1段'), 'weekdayCalcText に快適化の-1段がありません');
    assert.ok(guide.weekdayResultText?.includes('曜日基準補正は0段'), 'weekdayResultText が相殺後0段を示していません');
    console.log('PASS: 15時31度・16時31度・18時25度は+1段と-1段が相殺される');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 15時31度・16時31度・18時25度は+1段と-1段が相殺される');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}

{
  const weatherInput: WeatherInput = {
    hourlyForecasts: buildHourlyForecastsFromLegacy({ legacyWeather: weather({}), discountTime: '15' }),
    afterRainSky: null,
  };
  weatherInput.hourlyForecasts['15'].tempC = 31;
  weatherInput.hourlyForecasts['16'].tempC = 25;
  weatherInput.hourlyForecasts['18'].tempC = 25;
  weatherInput.hourlyForecasts['15'].windMs = 2;
  weatherInput.hourlyForecasts['16'].windMs = 2;
  weatherInput.hourlyForecasts['18'].windMs = 2;
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(2, '15', resolvedWeather, '2026-04-07');
  const guide = getBasisGuideDisplay({
    date: '2026-04-07',
    weekday: 2,
    discountTime: '15',
    weather: resolvedWeather,
  });

  try {
    assert.equal(resolvedWeather.tempLevel, '21to25');
    assert.equal(resolvedWeather.next18TempDropShift, -1);
    assert.equal(resolvedWeather.next18WindWorsenShift, 0);
    assert.equal(info.adjusted, '日');
    assert.equal(info.baseRateBonus, -5);
    assert.ok(guide.weekdayCalcText?.includes('気温 21〜25度 -2段'), 'weekdayCalcText に通常気温補正の-2段がありません');
    assert.ok(guide.weekdayCalcText?.includes('15時と18時の気温差が6度以上（18時が21〜25度） -1段'), 'weekdayCalcText に気温差補正の-1段がありません');
    assert.ok(!guide.weekdayCalcText?.includes('15時と18時の気温差が6度以上 +1段'), '旧仕様の+1段表示が残っています');
    assert.ok(guide.weekdaySummaryText?.includes('火木→日'), '曜日基準が火木→日になっていません');
    assert.ok(guide.bonusCalcText?.includes('曜日基準で補正しきれない分 -5%'), '下限超過分の-5%がありません');
    console.log('PASS: 火曜15時31度・16時25度・18時25度は旧仕様の+1段にならない');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 火曜15時31度・16時25度・18時25度は旧仕様の+1段にならない');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}

{
  const weatherInput: WeatherInput = {
    hourlyForecasts: buildHourlyForecastsFromLegacy({ legacyWeather: weather({}), discountTime: '15' }),
    afterRainSky: null,
  };
  weatherInput.hourlyForecasts['15'].tempC = 21;
  weatherInput.hourlyForecasts['16'].tempC = 28;
  weatherInput.hourlyForecasts['18'].tempC = 15;
  weatherInput.hourlyForecasts['15'].windMs = 2;
  weatherInput.hourlyForecasts['18'].windMs = 2;
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(5, '15', resolvedWeather, '2026-04-03');
  const guide = getBasisGuideDisplay({
    date: '2026-04-03',
    weekday: 5,
    discountTime: '15',
    weather: resolvedWeather,
  });

  try {
    assert.equal(resolvedWeather.next18TempDropShift, 1);
    assert.equal(resolvedWeather.next18WindWorsenShift, 0);
    assert.equal(info.adjusted, '火木');
    assert.ok(guide.weekdayCalcText?.includes('15時と18時の気温差が6度以上（18時が15度以下） +1段'), 'weekdayCalcText に寒さの+1段がありません');
    console.log('PASS: 18時が15度以下に下がる場合は気温差で1段強める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 18時が15度以下に下がる場合は気温差で1段強める');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}

{
  const weatherInput: WeatherInput = {
    hourlyForecasts: buildHourlyForecastsFromLegacy({ legacyWeather: weather({}), discountTime: '15' }),
    afterRainSky: null,
  };
  weatherInput.hourlyForecasts['15'].tempC = 21;
  weatherInput.hourlyForecasts['16'].tempC = 28;
  weatherInput.hourlyForecasts['18'].tempC = 15;
  weatherInput.hourlyForecasts['15'].windMs = 2;
  weatherInput.hourlyForecasts['18'].windMs = 3;
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(5, '15', resolvedWeather, '2026-04-03');
  const guide = getBasisGuideDisplay({
    date: '2026-04-03',
    weekday: 5,
    discountTime: '15',
    weather: resolvedWeather,
  });

  try {
    assert.equal(resolvedWeather.next18TempDropShift, 1);
    assert.equal(resolvedWeather.next18WindWorsenShift, 1);
    assert.equal(info.adjusted, '月水');
    assert.ok(guide.weekdayCalcText?.includes('18時が15度以下で風3m以上に強まる +1段'), 'weekdayCalcText に寒い時の風強まり+1段がありません');
    console.log('PASS: 寒い18時で風が3m以上に強まる場合だけ追加で1段強める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 寒い18時で風が3m以上に強まる場合だけ追加で1段強める');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}

{
  const weatherInput: WeatherInput = {
    hourlyForecasts: buildHourlyForecastsFromLegacy({ legacyWeather: weather({}), discountTime: '15' }),
    afterRainSky: null,
  };
  weatherInput.hourlyForecasts['15'].tempC = 21;
  weatherInput.hourlyForecasts['16'].tempC = 28;
  weatherInput.hourlyForecasts['18'].tempC = 15;
  weatherInput.hourlyForecasts['15'].windMs = 1;
  weatherInput.hourlyForecasts['18'].windMs = 2;
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(5, '15', resolvedWeather, '2026-04-03');

  try {
    assert.equal(resolvedWeather.next18TempDropShift, 1);
    assert.equal(resolvedWeather.next18WindWorsenShift, 0);
    assert.equal(info.adjusted, '火木');
    console.log('PASS: 風が強まっても18時側が3m未満なら風強まり補正なし');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 風が強まっても18時側が3m未満なら風強まり補正なし');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}



for (const testCase of cases) {
  const weatherInput = toWeatherInput(testCase.discountTime, testCase.weatherSpec);
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, testCase.discountTime);
  const info = getWeekdayBaseInfo(
    testCase.weekday,
    testCase.discountTime,
    resolvedWeather,
    testCase.date
  );
  const guide = getBasisGuideDisplay({
    date: testCase.date,
    weekday: testCase.weekday,
    discountTime: testCase.discountTime,
    weather: resolvedWeather,
  });

  try {
    assert.equal(info.adjusted, testCase.expected.adjusted);
    assert.equal(info.baseRateBonus, testCase.expected.baseRateBonus);

    if (testCase.expected.bonusCalcAbsent) {
      assert.equal(guide.bonusCalcText, undefined);
      assert.equal(guide.bonusResultText, undefined);
    }

    for (const text of testCase.expected.weekdayCalcIncludes ?? []) {
      assert.ok(guide.weekdayCalcText?.includes(text), `weekdayCalcText に「${text}」がありません`);
    }

    for (const text of testCase.expected.weekdayResultIncludes ?? []) {
      assert.ok(guide.weekdayResultText?.includes(text), `weekdayResultText に「${text}」がありません`);
    }

    for (const text of testCase.expected.bonusCalcIncludes ?? []) {
      assert.ok(guide.bonusCalcText?.includes(text), `bonusCalcText に「${text}」がありません`);
    }

    for (const text of testCase.expected.bonusResultIncludes ?? []) {
      assert.ok(guide.bonusResultText?.includes(text), `bonusResultText に「${text}」がありません`);
    }

    console.log(`PASS: ${testCase.name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${testCase.name}`);
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    process.exitCode = 1;
  }
}

try {
  const merged = buildMergedBonusDisplay({
    baseBonusParts: ['曜日基準で補正しきれない分 -5%'],
    baseRateBonus: -5,
    lateTimeBonus: 5,
  });
  assert.ok(merged.bonusCalcText?.includes('曜日基準で補正しきれない分 -5%'));
  assert.ok(merged.bonusCalcText?.includes('次の基準時刻が近い +5%'));
  assert.ok(merged.bonusResultText?.includes('値引率補正は0%'));
  console.log('PASS: 値引率補正の内訳と合計0%を表示');
  passed += 1;
} catch (error) {
  console.error('FAIL: 値引率補正の内訳と合計0%を表示');
  console.error(error);
  process.exitCode = 1;
}

try {
  assert.equal(
    shouldOfferAfterRainRecovery({
      sessionDate: '2026-04-01',
      sessionDiscountTime: '17',
      nearTermWeather: 'other',
      lastSessionWeather: {
        date: '2026-04-01',
        discountTime: '15',
        nearTermWeather: 'rain',
      },
    }),
    false
  );
  assert.equal(
    shouldOfferAfterRainRecovery({
      sessionDate: '2026-04-01',
      sessionDiscountTime: '17',
      nearTermWeather: 'other',
      lastSessionWeather: {
        date: '2026-04-01',
        discountTime: '15',
        nearTermWeather: 'snow',
      },
    }),
    false
  );
  assert.equal(
    shouldOfferAfterRainRecovery({
      sessionDate: '2026-04-01',
      sessionDiscountTime: '15',
      nearTermWeather: 'other',
      lastSessionWeather: {
        date: '2026-04-01',
        discountTime: '17',
        nearTermWeather: 'rain',
      },
    }),
    false
  );
  console.log('PASS: 雨上がり後入力は表示しない');
  passed += 1;
} catch (error) {
  console.error('FAIL: 雨上がり後入力は表示しない');
  console.error(error);
  process.exitCode = 1;
}

try {
  const previous = makeNavigationSnapshot({
    state: makeState({ screen: 'rate_display', currentAreaId: 'bento_men' }),
  });
  const result = appendNavigationHistory({
    history: [],
    previousSnapshot: previous,
    nextState: makeState({ screen: 'area_judge', currentAreaId: 'hosomaki' }),
    suppressHistoryPush: false,
  });
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].state.screen, 'rate_display');
  console.log('PASS: 戻る履歴は画面遷移で積まれる');
  passed += 1;
} catch (error) {
  console.error('FAIL: 戻る履歴は画面遷移で積まれる');
  console.error(error);
  process.exitCode = 1;
}

try {
  const previous = makeNavigationSnapshot({
    state: makeState({ screen: 'area_judge', currentAreaId: 'bento_men' }),
  });
  const result = appendNavigationHistory({
    history: [],
    previousSnapshot: previous,
    nextState: makeState({ screen: 'area_judge', currentAreaId: 'hosomaki' }),
    suppressHistoryPush: false,
  });
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].state.currentAreaId, 'bento_men');
  console.log('PASS: 戻る履歴は同じ画面でもエリア変更で積まれる');
  passed += 1;
} catch (error) {
  console.error('FAIL: 戻る履歴は同じ画面でもエリア変更で積まれる');
  console.error(error);
  process.exitCode = 1;
}

try {
  const previous = makeNavigationSnapshot({
    state: makeState({ screen: 'final_time', finalTimeStep: 1 }),
  });
  const result = appendNavigationHistory({
    history: [],
    previousSnapshot: previous,
    nextState: makeState({ screen: 'final_time', finalTimeStep: 2 }),
    suppressHistoryPush: false,
  });
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].state.finalTimeStep, 1);
  console.log('PASS: 戻る履歴は最終値引ステップ変更で積まれる');
  passed += 1;
} catch (error) {
  console.error('FAIL: 戻る履歴は最終値引ステップ変更で積まれる');
  console.error(error);
  process.exitCode = 1;
}

try {
  const previous = makeNavigationSnapshot({
    state: makeState({ screen: 'rate_display', currentAreaId: 'bento_men' }),
  });
  const result = appendNavigationHistory({
    history: [],
    previousSnapshot: previous,
    nextState: makeState({ screen: 'rate_display', currentAreaId: 'bento_men' }),
    suppressHistoryPush: false,
  });
  assert.equal(result.history.length, 0);
  console.log('PASS: 戻る履歴は同じ画面・同じエリアでは増えない');
  passed += 1;
} catch (error) {
  console.error('FAIL: 戻る履歴は同じ画面・同じエリアでは増えない');
  console.error(error);
  process.exitCode = 1;
}

try {
  const previous = makeNavigationSnapshot({
    state: makeState({ screen: 'rate_display', currentAreaId: 'bento_men' }),
  });
  const result = appendNavigationHistory({
    history: [previous],
    previousSnapshot: previous,
    nextState: makeState({ screen: 'area_judge', currentAreaId: 'hosomaki' }),
    suppressHistoryPush: true,
  });
  assert.equal(result.history.length, 1);
  assert.equal(result.suppressHistoryPush, false);
  console.log('PASS: 戻る直後は履歴を積まず suppress を解除する');
  passed += 1;
} catch (error) {
  console.error('FAIL: 戻る直後は履歴を積まず suppress を解除する');
  console.error(error);
  process.exitCode = 1;
}

try {
  const snapshot1 = makeNavigationSnapshot({
    state: makeState({ screen: 'area_judge', currentAreaId: 'bento_men' }),
  });
  const snapshot2 = makeNavigationSnapshot({
    state: makeState({ screen: 'rate_display', currentAreaId: 'bento_men' }),
    nextSessionSkipRecords: [
      { date: '2026-04-01', targetDiscountTime: '18', areaId: 'bento_men' },
    ],
    lastSessionWeather: {
      date: '2026-04-01',
      discountTime: '17',
      nearTermWeather: 'rain',
    },
  });
  const popped = popNavigationHistory([snapshot1, snapshot2]);
  assert.equal(popped.history.length, 1);
  assert.equal(popped.previousSnapshot?.state.screen, 'rate_display');
  assert.deepEqual(popped.previousSnapshot?.nextSessionSkipRecords, snapshot2.nextSessionSkipRecords);
  assert.deepEqual(popped.previousSnapshot?.lastSessionWeather, snapshot2.lastSessionWeather);
  console.log('PASS: 戻る復元スナップショットは次回スキップと前回天気も含む');
  passed += 1;
} catch (error) {
  console.error('FAIL: 戻る復元スナップショットは次回スキップと前回天気も含む');
  console.error(error);
  process.exitCode = 1;
}

try {
  const original = makeNavigationSnapshot({
    state: makeState({ screen: 'done', currentAreaId: null }),
    nextSessionSkipRecords: [
      { date: '2026-04-01', targetDiscountTime: '19', areaId: 'hosomaki' },
    ],
    lastSessionWeather: {
      date: '2026-04-01',
      discountTime: '18',
      nearTermWeather: 'rain',
    },
  });
  const cloned = cloneNavigationSnapshot(original);
  original.state.screen = 'start';
  original.nextSessionSkipRecords[0].areaId = 'bento_men';
  if (original.lastSessionWeather) {
    original.lastSessionWeather.nearTermWeather = 'other';
  }
  assert.equal(cloned.state.screen, 'done');
  assert.equal(cloned.nextSessionSkipRecords[0].areaId, 'hosomaki');
  assert.equal(cloned.lastSessionWeather?.nearTermWeather, 'rain');
  console.log('PASS: 戻るスナップショットはディープコピーされる');
  passed += 1;
} catch (error) {
  console.error('FAIL: 戻るスナップショットはディープコピーされる');
  console.error(error);
  process.exitCode = 1;
}

for (const scenarioCase of scenarioCases) {
  try {
    const scenarioWeather = toWeatherInput(scenarioCase.discountTime, scenarioCase.weatherSpec);
    const resolvedScenarioWeather = resolveWeatherInputForDiscount(
      scenarioWeather,
      scenarioCase.discountTime,
    );
    const basisGuide = getBasisGuideDisplay({
      weekday: scenarioCase.weekday,
      discountTime: scenarioCase.discountTime,
      weather: resolvedScenarioWeather,
    });
    const weekdayInfo = getWeekdayBaseInfo(
      scenarioCase.weekday,
      scenarioCase.discountTime,
      resolvedScenarioWeather
    );
    const mergedBonus = buildMergedBonusDisplay({
      baseBonusParts: basisGuide.bonusCalcParts,
      baseRateBonus: weekdayInfo.baseRateBonus,
      lateTimeBonus: scenarioCase.lateTimeBonus ?? 0,
    });

    assert.equal(basisGuide.weekdaySummaryText, scenarioCase.expected.weekdaySummary);
    assert.equal(mergedBonus.bonusSummaryText, scenarioCase.expected.bonusSummary);

    if (scenarioCase.expected.finalRates) {
      const finalGuide = getFinalTimeGuide({
        weekdayShift: weekdayInfo.weekdayShift,
        rateBonus: mergedBonus.bonusTotal,
      });
      assert.equal(finalGuide.count3OrMore.main, scenarioCase.expected.finalRates.count3OrMore);
      assert.equal(finalGuide.count2.main, scenarioCase.expected.finalRates.count2);
      assert.equal(finalGuide.count1.main, scenarioCase.expected.finalRates.count1);
    }

    console.log(`PASS: ${scenarioCase.name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${scenarioCase.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}


for (const manyTenOrMoreCase of manyTenOrMoreNoteCases) {
  const display = getNormalTimeRateDisplay({
    discountTime: manyTenOrMoreCase.discountTime,
    weatherBonus: manyTenOrMoreCase.weatherBonus,
    areaJudge: 'normal',
    isSunday: manyTenOrMoreCase.isSunday,
  });

  try {
    const note = display.many.note ?? '';

    for (const expected of manyTenOrMoreCase.expectedNoteIncludes ?? []) {
      assert.ok(note.includes(expected), `missing expected note text: ${expected}`);
    }

    for (const unexpected of manyTenOrMoreCase.expectedNoteExcludes ?? []) {
      assert.ok(!note.includes(unexpected), `unexpected note text remained: ${unexpected}`);
    }

    console.log(`PASS: ${manyTenOrMoreCase.name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${manyTenOrMoreCase.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}


const holidayWeekdayBaseCases = [
  {
    name: '祝日の15時は日曜日基準を使う',
    date: '2026-01-01',
    weekday: 4,
    discountTime: '15' as DiscountTime,
    expectedAdjusted: '日',
    expectedNotice: '祝日の15時は日曜日の基準',
  },
  {
    name: '祝日17時以降で翌日も休日なら金土基準を使う',
    date: '2026-09-22',
    weekday: 2,
    discountTime: '17' as DiscountTime,
    expectedAdjusted: '金土',
    expectedNotice: '翌日も休日・祝日',
  },
  {
    name: '祝日17時以降で翌日が平日なら火木基準を使う',
    date: '2026-01-12',
    weekday: 1,
    discountTime: '17' as DiscountTime,
    expectedAdjusted: '火木',
    expectedNotice: '翌日が平日',
  },
  {
    name: '祝日に挟まれた休日も翌日休日判定に使う',
    date: '2026-09-22',
    weekday: 2,
    discountTime: '17' as DiscountTime,
    expectedAdjusted: '金土',
    expectedNotice: '翌日も休日・祝日',
  },
];

for (const holidayCase of holidayWeekdayBaseCases) {
  try {
    const weatherInput = toWeatherInput(holidayCase.discountTime, weather({}));
    const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, holidayCase.discountTime);
    const info = getWeekdayBaseInfo(
      holidayCase.weekday,
      holidayCase.discountTime,
      resolvedWeather,
      holidayCase.date
    );
    const guide = getBasisGuideDisplay({
      date: holidayCase.date,
      weekday: holidayCase.weekday,
      discountTime: holidayCase.discountTime,
      weather: resolvedWeather,
    });

    assert.equal(info.adjusted, holidayCase.expectedAdjusted);
    assert.ok(guide.noticeText?.includes(holidayCase.expectedNotice));
    console.log(`PASS: ${holidayCase.name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${holidayCase.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}


try {
  const beforeNextArea = makeNavigationSnapshot({
    state: makeState({
      screen: 'rate_display',
      currentAreaId: 'bento_men',
      areaProgressMap: {
        ...makeState({}).areaProgressMap,
        bento_men: { areaId: 'bento_men', status: 'unstarted', areaJudge: 'normal' },
      },
    }),
    nextSessionSkipRecords: [],
  });

  const afterNextAreaState = makeState({
    screen: 'area_judge',
    currentAreaId: 'hosomaki',
    areaProgressMap: {
      ...makeState({}).areaProgressMap,
      bento_men: {
        areaId: 'bento_men',
        status: 'completed',
        areaJudge: 'normal',
        completedAt: '2026-05-09T10:00:00.000Z',
      },
    },
  });

  const historyResult = appendNavigationHistory({
    history: [],
    previousSnapshot: beforeNextArea,
    nextState: afterNextAreaState,
    suppressHistoryPush: false,
  });
  const popped = popNavigationHistory(historyResult.history);

  assert.equal(popped.previousSnapshot?.state.screen, 'rate_display');
  assert.equal(popped.previousSnapshot?.state.areaProgressMap.bento_men.status, 'unstarted');
  assert.deepEqual(popped.previousSnapshot?.nextSessionSkipRecords, []);
  console.log('PASS: 次のエリアへ後に戻ると完遂扱いと次回スキップ予約を取り消す');
  passed += 1;
} catch (error) {
  console.error('FAIL: 次のエリアへ後に戻ると完遂扱いと次回スキップ予約を取り消す');
  console.error(error);
  process.exitCode = 1;
}

try {
  const records = appendSkipRecordsInMemory({
    currentRecords: [],
    recordsToAdd: [
      {
        date: '2026-05-09',
        targetDiscountTime: '18',
        areaId: 'bento_men',
      },
    ],
  });

  assert.deepEqual(records, [
    {
      date: '2026-05-09',
      targetDiscountTime: '18',
      areaId: 'bento_men',
    },
  ]);
  console.log('PASS: 戻らず完遂したエリアだけ次回スキップ予約として残る');
  passed += 1;
} catch (error) {
  console.error('FAIL: 戻らず完遂したエリアだけ次回スキップ予約として残る');
  console.error(error);
  process.exitCode = 1;
}

console.log(`\n${passed} / ${cases.length + scenarioCases.length + manyTenOrMoreNoteCases.length + 23} checks passed.`);

const finalLow = getFinalTimeGuide({
  weekdayShift: -1,
  rateBonus: 0,
});
assert.equal(finalLow.count3OrMore.main, '50%');
assert.equal(finalLow.count2.main, '40%');
assert.equal(finalLow.count1.main, '30%');
assert.equal(finalLow.score, 0);

const finalHigh = getFinalTimeGuide({
  weekdayShift: 1,
  rateBonus: 0,
});
assert.equal(finalHigh.count3OrMore.main, '50%');
assert.equal(finalHigh.count2.main, '40%');
assert.equal(finalHigh.count1.main, '30%');
assert.equal(finalHigh.score, 0);

const finalBonusRaised = getFinalTimeGuide({
  weekdayShift: 0,
  rateBonus: 10,
});
assert.equal(finalBonusRaised.count3OrMore.main, '50%');
assert.equal(finalBonusRaised.scoreBreakdown.rateBonusPoints, 0);

const finalBonusLowered = getFinalTimeGuide({
  weekdayShift: 0,
  rateBonus: -10,
});
assert.equal(finalBonusLowered.count3OrMore.main, '50%');
assert.equal(finalBonusLowered.scoreBreakdown.rateBonusPoints, 0);

console.log('PASS: 最終値引き点数ロジック');


const sundayRateDisplay = getNormalTimeRateDisplay({
  discountTime: '15',
  weatherBonus: 0,
  areaJudge: 'normal',
  isSunday: true,
});
assert.equal(sundayRateDisplay.many.main, '10%');
assert.equal(Object.hasOwn(sundayRateDisplay, 'slightlyMany'), false);
assert.ok(!(sundayRateDisplay.many.note ?? '').includes('多いのうち5個以上'));
assert.ok((sundayRateDisplay.many.note ?? '').includes('多いのうち10個以上は 20%'));

const nonSundayRateDisplay = getNormalTimeRateDisplay({
  discountTime: '15',
  weatherBonus: 0,
  areaJudge: 'normal',
  isSunday: false,
});
assert.equal(Object.hasOwn(nonSundayRateDisplay, 'slightlyMany'), false);
assert.ok(!(nonSundayRateDisplay.many.note ?? '').includes('多いのうち5個以上'));

const sundayEveningRateDisplay = getNormalTimeRateDisplay({
  discountTime: '17',
  weatherBonus: 0,
  areaJudge: 'normal',
  isSunday: true,
});
assert.equal(sundayEveningRateDisplay.normal.main, '10%');
assert.equal(Object.hasOwn(sundayEveningRateDisplay, 'slightlyMany'), false);
assert.equal(sundayEveningRateDisplay.many.main, '20%');

console.log('PASS: 日曜15時は旧専用行も5個以上補足も出さず10個以上補足だけを表示する');





try {
  assert.deepEqual(NORMAL_ROUTE.slice(7), [
    'onigiri',
    'sushi',
    'futomaki_chumaki',
    'inari',
    'hosomaki',
  ]);
  assert.deepEqual(DONE_SUMMARY_ROUTE.slice(0, 5), [
    'hosomaki',
    'inari',
    'futomaki_chumaki',
    'sushi',
    'onigiri',
  ]);
  console.log('PASS: おにぎり以降は寿司・太巻・いなり・細巻きの順番、完了画面は細巻きから表示する');
  passed += 1;
} catch (error) {
  console.error('FAIL: おにぎり以降は寿司・太巻・いなり・細巻きの順番、完了画面は細巻きから表示する');
  console.error(error);
  process.exitCode = 1;
}

try {
  const candidate = getNextPendingCandidate({
    areaProgressMap: {
      ...makeState({}).areaProgressMap,
      croquette: { areaId: 'croquette', status: 'postponed_few', areaJudge: 'few' },
      tempura: { areaId: 'tempura', status: 'skipped_manual', areaJudge: null },
      sushi: { areaId: 'sushi', status: 'postponed_few', areaJudge: 'few' },
      hosomaki: { areaId: 'hosomaki', status: 'skipped_manual', areaJudge: null },
    },
    referenceAreaId: 'fry_chicken',
  });

  assert.equal(candidate?.areaId, 'tempura');
  console.log('PASS: pending は手動スキップを少ないより優先して選ぶ');
  passed += 1;
} catch (error) {
  console.error('FAIL: pending は手動スキップを少ないより優先して選ぶ');
  console.error(error);
  process.exitCode = 1;
}

try {
  const candidate = getNextPendingCandidate({
    areaProgressMap: {
      ...makeState({}).areaProgressMap,
      croquette: { areaId: 'croquette', status: 'postponed_few', areaJudge: 'few' },
      tempura: { areaId: 'tempura', status: 'skipped_manual', areaJudge: null },
      sushi: { areaId: 'sushi', status: 'postponed_few', areaJudge: 'few' },
    },
    referenceAreaId: 'fry_chicken',
    deferredAreaIds: ['croquette', 'tempura'],
  });

  assert.equal(candidate?.areaId, 'tempura');
  console.log('PASS: 手動スキップが残っている間は deferred でも少ないより優先して再開する');
  passed += 1;
} catch (error) {
  console.error('FAIL: 手動スキップが残っている間は deferred でも少ないより優先して再開する');
  console.error(error);
  process.exitCode = 1;
}

try {
  const candidate = getNextPendingCandidate({
    areaProgressMap: {
      ...makeState({}).areaProgressMap,
      croquette: { areaId: 'croquette', status: 'postponed_few', areaJudge: 'few' },
      tempura: { areaId: 'tempura', status: 'skipped_manual', areaJudge: null },
    },
    referenceAreaId: 'fry_chicken',
    deferredAreaIds: ['croquette', 'tempura'],
    preferredReason: 'manual',
  });

  assert.equal(candidate?.areaId, 'tempura');
  console.log('PASS: deferred だけの手動スキップでも少ないより優先して再開する');
  passed += 1;
} catch (error) {
  console.error('FAIL: deferred だけの手動スキップでも少ないより優先して再開する');
  console.error(error);
  process.exitCode = 1;
}

try {
  const candidate = getNextPendingCandidate({
    areaProgressMap: {
      ...makeState({}).areaProgressMap,
      hosomaki: { areaId: 'hosomaki', status: 'skipped_manual', areaJudge: null },
      inari: { areaId: 'inari', status: 'skipped_manual', areaJudge: null },
      futomaki_chumaki: { areaId: 'futomaki_chumaki', status: 'skipped_manual', areaJudge: null },
      sushi: { areaId: 'sushi', status: 'skipped_manual', areaJudge: null },
      onigiri: { areaId: 'onigiri', status: 'skipped_manual', areaJudge: null },
      balance_bento: { areaId: 'balance_bento', status: 'skipped_manual', areaJudge: null },
      chuka_fish: { areaId: 'chuka_fish', status: 'skipped_manual', areaJudge: null },
      yakitori: { areaId: 'yakitori', status: 'skipped_manual', areaJudge: null },
      fry_chicken: { areaId: 'fry_chicken', status: 'skipped_manual', areaJudge: null },
      croquette: { areaId: 'croquette', status: 'skipped_manual', areaJudge: null },
      tempura: { areaId: 'tempura', status: 'skipped_manual', areaJudge: null },
      bento_men: { areaId: 'bento_men', status: 'skipped_manual', areaJudge: null },
    },
    referenceAreaId: 'hosomaki',
    deferredAreaIds: [
      'sushi',
      'futomaki_chumaki',
      'inari',
      'hosomaki',
      'onigiri',
      'balance_bento',
      'chuka_fish',
      'yakitori',
      'fry_chicken',
      'croquette',
      'tempura',
      'bento_men',
      'tempura',
      'croquette',
      'fry_chicken',
      'yakitori',
      'chuka_fish',
      'balance_bento',
      'onigiri',
      'hosomaki',
    ],
  });

  assert.equal(candidate?.areaId, 'inari');
  console.log('PASS: 全部スキップ後も細巻きからいなり方向へ進む');
  passed += 1;
} catch (error) {
  console.error('FAIL: 全部スキップ後も細巻きからいなり方向へ進む');
  console.error(error);
  process.exitCode = 1;
}

try {
  const candidate = getNextPendingCandidate({
    areaProgressMap: {
      ...makeState({}).areaProgressMap,
      hosomaki: { areaId: 'hosomaki', status: 'skipped_manual', areaJudge: null },
      inari: { areaId: 'inari', status: 'skipped_manual', areaJudge: null },
      futomaki_chumaki: { areaId: 'futomaki_chumaki', status: 'skipped_manual', areaJudge: null },
      sushi: { areaId: 'sushi', status: 'skipped_manual', areaJudge: null },
      onigiri: { areaId: 'onigiri', status: 'skipped_manual', areaJudge: null },
      balance_bento: { areaId: 'balance_bento', status: 'skipped_manual', areaJudge: null },
      chuka_fish: { areaId: 'chuka_fish', status: 'skipped_manual', areaJudge: null },
      yakitori: { areaId: 'yakitori', status: 'skipped_manual', areaJudge: null },
      fry_chicken: { areaId: 'fry_chicken', status: 'skipped_manual', areaJudge: null },
      croquette: { areaId: 'croquette', status: 'skipped_manual', areaJudge: null },
      tempura: { areaId: 'tempura', status: 'skipped_manual', areaJudge: null },
      bento_men: { areaId: 'bento_men', status: 'skipped_manual', areaJudge: null },
    },
    referenceAreaId: 'inari',
    deferredAreaIds: [
      'sushi',
      'futomaki_chumaki',
      'inari',
      'hosomaki',
      'onigiri',
      'balance_bento',
      'chuka_fish',
      'yakitori',
      'fry_chicken',
      'croquette',
      'tempura',
      'bento_men',
      'tempura',
      'croquette',
      'fry_chicken',
      'yakitori',
      'chuka_fish',
      'balance_bento',
      'onigiri',
      'hosomaki',
      'inari',
    ],
  });

  assert.equal(candidate?.areaId, 'futomaki_chumaki');
  console.log('PASS: 全部スキップ後もいなりと細巻きだけで往復しない');
  passed += 1;
} catch (error) {
  console.error('FAIL: 全部スキップ後もいなりと細巻きだけで往復しない');
  console.error(error);
  process.exitCode = 1;
}
try {
  const candidate = getNextPendingCandidate({
    areaProgressMap: {
      ...makeState({}).areaProgressMap,
      onigiri: { areaId: 'onigiri', status: 'skipped_manual', areaJudge: null },
      balance_bento: { areaId: 'balance_bento', status: 'skipped_manual', areaJudge: null },
      chuka_fish: { areaId: 'chuka_fish', status: 'skipped_manual', areaJudge: null },
      yakitori: { areaId: 'yakitori', status: 'skipped_manual', areaJudge: null },
      fry_chicken: { areaId: 'fry_chicken', status: 'skipped_manual', areaJudge: null },
      croquette: { areaId: 'croquette', status: 'skipped_manual', areaJudge: null },
      tempura: { areaId: 'tempura', status: 'skipped_manual', areaJudge: null },
      bento_men: { areaId: 'bento_men', status: 'skipped_manual', areaJudge: null },
    },
    referenceAreaId: 'bento_men',
    deferredAreaIds: [
      'onigiri',
      'balance_bento',
      'chuka_fish',
      'yakitori',
      'fry_chicken',
      'croquette',
      'tempura',
      'bento_men',
    ],
  });

  assert.equal(candidate?.areaId, 'tempura');
  console.log('PASS: スキップで弁当・麺類の端に来たら寿司方向へ折り返す');
  passed += 1;
} catch (error) {
  console.error('FAIL: スキップで弁当・麺類の端に来たら寿司方向へ折り返す');
  console.error(error);
  process.exitCode = 1;
}

try {
  const candidate = getNextPendingCandidate({
    areaProgressMap: {
      ...makeState({}).areaProgressMap,
      onigiri: { areaId: 'onigiri', status: 'skipped_manual', areaJudge: null },
      balance_bento: { areaId: 'balance_bento', status: 'skipped_manual', areaJudge: null },
      chuka_fish: { areaId: 'chuka_fish', status: 'skipped_manual', areaJudge: null },
      yakitori: { areaId: 'yakitori', status: 'skipped_manual', areaJudge: null },
      fry_chicken: { areaId: 'fry_chicken', status: 'skipped_manual', areaJudge: null },
      croquette: { areaId: 'croquette', status: 'skipped_manual', areaJudge: null },
      tempura: { areaId: 'tempura', status: 'skipped_manual', areaJudge: null },
      bento_men: { areaId: 'bento_men', status: 'skipped_manual', areaJudge: null },
    },
    referenceAreaId: 'tempura',
    deferredAreaIds: [
      'onigiri',
      'balance_bento',
      'chuka_fish',
      'yakitori',
      'fry_chicken',
      'croquette',
      'tempura',
      'bento_men',
    ],
  });

  assert.equal(candidate?.areaId, 'croquette');
  console.log('PASS: 折り返し後は同じ端へ戻らず寿司方向の次エリアへ進む');
  passed += 1;
} catch (error) {
  console.error('FAIL: 折り返し後は同じ端へ戻らず寿司方向の次エリアへ進む');
  console.error(error);
  process.exitCode = 1;
}


try {
  const allSkippedMap = {
    ...makeState({}).areaProgressMap,
    ...Object.fromEntries(
      AREA_MASTERS.map((area) => [
        area.id,
        { areaId: area.id, status: 'skipped_manual' as const, areaJudge: null },
      ])
    ),
  };
  let currentAreaId: AreaId = 'sushi';
  let deferredAreaIds: AreaId[] = ['sushi'];
  const sequence: string[] = [];

  for (let index = 0; index < 28; index += 1) {
    const candidate = getNextPendingCandidate({
      areaProgressMap: allSkippedMap,
      referenceAreaId: currentAreaId,
      deferredAreaIds,
    });

    assert.ok(candidate);
    sequence.push(candidate.areaId);
    currentAreaId = candidate.areaId;
    deferredAreaIds = [...deferredAreaIds, candidate.areaId];
  }

  assert.deepEqual(sequence.slice(0, 12), [
    'futomaki_chumaki',
    'inari',
    'hosomaki',
    'onigiri',
    'balance_bento',
    'chuka_fish',
    'yakitori',
    'fry_chicken',
    'croquette',
    'tempura',
    'bento_men',
    'tempura',
  ]);
  assert.ok(!sequence.join(',').includes('futomaki_chumaki,sushi,futomaki_chumaki,sushi'));
  console.log('PASS: スキップ連打でも太巻・中巻と寿司だけで往復しない');
  passed += 1;
} catch (error) {
  console.error('FAIL: スキップ連打でも太巻・中巻と寿司だけで往復しない');
  console.error(error);
  process.exitCode = 1;
}

try {
  assert.equal(
    getPendingResumeScreen({ areaId: 'bento_men', status: 'skipped_manual', areaJudge: 'many' }),
    'rate_display'
  );
  console.log('PASS: 手動スキップ済みでも判定済みエリアは値引率表示から再開する');
  passed += 1;
} catch (error) {
  console.error('FAIL: 手動スキップ済みでも判定済みエリアは値引率表示から再開する');
  console.error(error);
  process.exitCode = 1;
}

try {
  assert.equal(
    getPendingResumeScreen({ areaId: 'bento_men', status: 'skipped_manual', areaJudge: null }),
    'area_judge'
  );
  console.log('PASS: 手動スキップで未判定エリアはエリアジャッジから再開する');
  passed += 1;
} catch (error) {
  console.error('FAIL: 手動スキップで未判定エリアはエリアジャッジから再開する');
  console.error(error);
  process.exitCode = 1;
}

try {
  assert.equal(
    getPendingResumeScreen({ areaId: 'bento_men', status: 'postponed_few', areaJudge: 'few' }),
    'rate_display'
  );
  console.log('PASS: 少ない後回し済みエリアは値引率表示から再開する');
  passed += 1;
} catch (error) {
  console.error('FAIL: 少ない後回し済みエリアは値引率表示から再開する');
  console.error(error);
  process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
