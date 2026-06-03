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
import {
  appendReview19RecordInMemory,
  buildReview19ExportPayload,
  createInitialReview19Result,
  getReview19ExportBatch,
  getUnexportedReview19Records,
  markReview19RecordsExportedInMemory,
  normalizeReview19Result,
} from '../src/domain/review19.ts';
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
    tempLevel: '28to30',
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
    name: '乾いた日・直近28〜30度・未来も28〜30度なら基準変化なし',
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
    name: '直近21〜25度と未来21〜25度はベースと未来ポイントで緩める',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '21to25' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: -10,
      weekdayCalcIncludes: ['16時気温 21〜25度 -2段', '未来天候ポイント +10pt（17〜21時） -2段'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 -10%'],
    },
  },
  {
    name: '直近低温と低温風はベース側で拾い未来ポイントも加算する',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '6to10', windLevel: '5orMore' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 5,
      weekdayCalcIncludes: ['16時気温 6〜10度 +1段', '風 5m以上（15度以下） +2段', '未来天候ポイント -15pt（17〜21時） +2段'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +5%'],
    },
  },
  {
    name: '対象時間帯の雨1回は +5%',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ nearTermWeather: 'rain' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 5,
      bonusCalcIncludes: ['16〜18時に雨1回 +5%'],
      bonusResultIncludes: ['値引率補正は+5%'],
    },
  },
  {
    name: '対象時間帯の雨2回以上は +10%',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ nearTermWeather: 'rain', hasLaterPrecip: true, laterPrecipType: 'rain' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 10,
      bonusCalcIncludes: ['16〜18時に雨2回以上 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '19時30分は20時雨なら22時も雨扱いで +10%',
    weekday: 2,
    discountTime: '19',
    weatherSpec: weather({ nearTermWeather: 'rain' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 10,
      bonusCalcIncludes: ['20〜22時扱いに雨2回以上 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '対象時間帯の雪1時間は +20%',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ hasLaterPrecip: true, laterPrecipType: 'snow' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 20,
      bonusCalcIncludes: ['16〜18時に雪 +20%'],
      bonusResultIncludes: ['値引率補正は+20%'],
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
      weekdayCalcIncludes: ['18時気温 36度以上 +2段', '風 5m以上 +1段', '未来天候ポイント -9pt（19〜21時） +2段'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '15時の金土日基準で下方向2段あふれは -10%',
    weekday: 0,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '21to25' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: -10,
      bonusCalcIncludes: ['曜日基準で補正しきれない分 -10%'],
      bonusResultIncludes: ['値引率補正は-10%'],
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
    name: '16時の雪は +20%',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ nearTermWeather: 'snow' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 20,
      bonusCalcIncludes: ['16〜18時に雪 +20%'],
      bonusResultIncludes: ['値引率補正は+20%'],
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
    name: 'GW連休3日目の翌日15時は金土日基準から1段強める',
    date: '2026-05-05',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({}),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['GW連休3日目の翌日 +1段'],
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
    name: '運用シナリオ: 水曜日17時・18時に雨1回あり',
    weekday: 3,
    discountTime: '17',
    weatherSpec: weather({ nearTermWeather: 'rain' }),
    expected: {
      weekdaySummary: '曜日基準補正：なし',
      bonusSummary: '値引率補正：+5％',
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
      bonusSummary: '値引率補正：+10％',
      finalRates: { count3OrMore: '50%', count2: '40%', count1: '30%' },
    },
  },
  {
    name: '運用シナリオ: 15時に直近温暖で未来も温暖寄り（金土日統合後は余り-5%）',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({
      tempLevel: '16to20',
      windLevel: '2orLess',
      next18TempLevel: '6to10',
      next18WindLevel: '5orMore',
    }),
    expected: {
      weekdaySummary: '曜日基準補正：なし',
      bonusSummary: '値引率補正：-5％',
      finalRates: { count3OrMore: '50%', count2: '40%', count1: '30%' },
    },
  },
];


type ManyTenOrMoreNoteCase = {
  name: string;
  discountTime: Exclude<DiscountTime, '20'>;
  weatherBonus: number;
  isSunday?: boolean;
  ignoreTimeRateCap?: boolean;
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
    name: '19時30分は40%上限に当たる場合は多い10個以上の同率注記を表示しない',
    discountTime: '19',
    weatherBonus: 0,
    expectedNoteExcludes: ['多いのうち10個以上は 40%'],
  },
  {
    name: '雨雪補正中は時刻別上限を外して多い10個以上の目安も上げる',
    discountTime: '19',
    weatherBonus: 20,
    ignoreTimeRateCap: true,
    expectedNoteIncludes: ['多いのうち10個以上は 70%'],
  },
];

let passed = 0;

{
  const weatherInput = toWeatherInput('15', weather({ tempLevel: '28to30' }));
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(2, '15', resolvedWeather, '2026-04-01');
  const guide = getBasisGuideDisplay({ date: '2026-04-01', weekday: 2, discountTime: '15', weather: resolvedWeather });

  try {
    assert.equal(resolvedWeather.weatherPointScore, 0);
    assert.equal(resolvedWeather.weatherPointShift, 0);
    assert.equal(info.adjusted, '火木');
    assert.equal(guide.weekdayCalcText, undefined);
    console.log('PASS: 28〜30度が続く日は天候ポイント補正なし');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 28〜30度が続く日は天候ポイント補正なし');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}

{
  const weatherInput = toWeatherInput('15', weather({ tempLevel: '21to25' }));
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(2, '15', resolvedWeather, '2026-04-01');
  const guide = getBasisGuideDisplay({ date: '2026-04-01', weekday: 2, discountTime: '15', weather: resolvedWeather });

  try {
    assert.equal(resolvedWeather.weatherPointScore, 10);
    assert.equal(resolvedWeather.weatherPointShift, -2);
    assert.equal(info.adjusted, '金土');
    assert.ok(guide.weekdayCalcText?.includes('16時気温 21〜25度 -2段'));
    assert.ok(guide.weekdayCalcText?.includes('未来天候ポイント +10pt（17〜21時） -2段'));
    console.log('PASS: 直近21〜25度と未来21〜25度ならベースと未来ポイントで緩める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 16〜21時が21〜25度なら天候ポイントで2段緩める');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}

{
  const weatherInput = toWeatherInput('15', weather({ tempLevel: '26to27' }));
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(2, '15', resolvedWeather, '2026-04-01');
  const guide = getBasisGuideDisplay({ date: '2026-04-01', weekday: 2, discountTime: '15', weather: resolvedWeather });

  try {
    assert.equal(resolvedWeather.weatherPointScore, 5);
    assert.equal(resolvedWeather.weatherPointShift, -1);
    assert.equal(info.adjusted, '金土');
    assert.ok(guide.weekdayCalcText?.includes('16時気温 26〜27度 -1段'));
    assert.ok(guide.weekdayCalcText?.includes('未来天候ポイント +5pt（17〜21時） -1段'));
    console.log('PASS: 直近26〜27度と未来26〜27度ならベースと未来ポイントで緩める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 16〜21時が26〜27度なら天候ポイントで1段緩める');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}

{
  const weatherInput = toWeatherInput('15', weather({ tempLevel: '11to15' }));
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(2, '15', resolvedWeather, '2026-04-01');
  const guide = getBasisGuideDisplay({ date: '2026-04-01', weekday: 2, discountTime: '15', weather: resolvedWeather });

  try {
    assert.equal(resolvedWeather.weatherPointScore, 0);
    assert.equal(resolvedWeather.weatherPointShift, 0);
    assert.equal(info.adjusted, '火木');
    assert.ok(guide.weekdayCalcText?.includes('16時気温 11〜15度 0段') || !guide.weekdayCalcText?.includes('16時気温 11〜15度'));
    assert.ok(!guide.weekdayCalcText?.includes('未来天候ポイント'));
    console.log('PASS: 未来11〜15度は未来天候ポイントでマイナスにしない');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 未来11〜15度は未来天候ポイントでマイナスにしない');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}

{
  const weatherInput = toWeatherInput('15', weather({ tempLevel: '6to10' }));
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(5, '15', resolvedWeather, '2026-04-03');
  const guide = getBasisGuideDisplay({ date: '2026-04-03', weekday: 5, discountTime: '15', weather: resolvedWeather });

  try {
    assert.equal(resolvedWeather.weatherPointScore, -5);
    assert.equal(resolvedWeather.weatherPointShift, 1);
    assert.equal(info.adjusted, '月水');
    assert.ok(guide.weekdayCalcText?.includes('16時気温 6〜10度 +1段'));
    assert.ok(guide.weekdayCalcText?.includes('未来天候ポイント -5pt（17〜21時） +1段'));
    console.log('PASS: 直近6〜10度と未来6〜10度ならベースと未来ポイントで1段強める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 16〜21時が6〜10度なら天候ポイントで1段強める');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}

{
  const weatherInput = toWeatherInput('15', weather({ tempLevel: '28to30' }));
  weatherInput.hourlyForecasts['16'].tempC = 30;
  weatherInput.hourlyForecasts['17'].tempC = 27;
  weatherInput.hourlyForecasts['18'].tempC = 25;
  weatherInput.hourlyForecasts['19'].tempC = 24;
  weatherInput.hourlyForecasts['20'].tempC = 23;
  weatherInput.hourlyForecasts['21'].tempC = 22;
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(2, '15', resolvedWeather, '2026-04-01');
  const guide = getBasisGuideDisplay({ date: '2026-04-01', weekday: 2, discountTime: '15', weather: resolvedWeather });

  try {
    assert.equal(resolvedWeather.weatherPointScore, 9);
    assert.equal(resolvedWeather.weatherPointShift, -2);
    assert.equal(info.adjusted, '金土');
    assert.ok(guide.weekdayCalcText?.includes('未来天候ポイント +9pt（17〜21時） -2段'));
    console.log('PASS: 暑さが抜けて夜が快適な日は未来天候ポイントで2段緩める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 暑さが抜けて夜が快適な日は天候ポイントで2段緩める');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
    console.error('actual resolvedWeather =', resolvedWeather);
    process.exitCode = 1;
  }
}

{
  const weatherInput = toWeatherInput('15', weather({ tempLevel: '28to30' }));
  weatherInput.hourlyForecasts['16'].tempC = 28;
  weatherInput.hourlyForecasts['17'].tempC = 15;
  weatherInput.hourlyForecasts['18'].tempC = 10;
  weatherInput.hourlyForecasts['19'].tempC = 5;
  weatherInput.hourlyForecasts['20'].tempC = 4;
  weatherInput.hourlyForecasts['21'].tempC = 3;
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(5, '15', resolvedWeather, '2026-04-03');
  const guide = getBasisGuideDisplay({ date: '2026-04-03', weekday: 5, discountTime: '15', weather: resolvedWeather });

  try {
    assert.equal(resolvedWeather.weatherPointScore, -7);
    assert.equal(resolvedWeather.weatherPointShift, 2);
    assert.equal(info.adjusted, '月水');
    assert.ok(guide.weekdayCalcText?.includes('未来天候ポイント -7pt（17〜21時） +2段'));
    console.log('PASS: 夕方以降に冷え込む日は未来天候ポイントで2段強める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 夕方以降に冷え込む日は天候ポイントで2段強める');
    console.error(error);
    console.error('actual info =', info);
    console.error('actual guide =', guide);
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
    ignoreTimeRateCap: manyTenOrMoreCase.ignoreTimeRateCap,
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



try {
  const capped15 = getNormalTimeRateDisplay({
    discountTime: '15',
    weatherBonus: 15,
    areaJudge: 'many',
  });
  assert.equal(capped15.normal.main, '20%');
  assert.equal(capped15.many.main, '20%');

  const capped17 = getNormalTimeRateDisplay({
    discountTime: '17',
    weatherBonus: 10,
    areaJudge: 'many',
  });
  assert.equal(capped17.normal.main, '30%');
  assert.equal(capped17.many.main, '30%');

  const capped19 = getNormalTimeRateDisplay({
    discountTime: '19',
    weatherBonus: 10,
    areaJudge: 'normal',
  });
  assert.equal(capped19.normal.main, '40%');
  assert.equal(capped19.many.main, '40%');

  const uncappedRainOrSnow = getNormalTimeRateDisplay({
    discountTime: '19',
    weatherBonus: 20,
    areaJudge: 'many',
    ignoreTimeRateCap: true,
  });
  assert.equal(uncappedRainOrSnow.normal.main, '60%');
  assert.equal(uncappedRainOrSnow.many.main, '70%');

  console.log('PASS: 通常時は時刻別上限、雨雪補正中は上限なし');
  passed += 1;
} catch (error) {
  console.error('FAIL: 通常時は時刻別上限、雨雪補正中は上限なし');
  console.error(error);
  process.exitCode = 1;
}

const holidayWeekdayBaseCases = [
  {
    name: '祝日の15時は金土日基準を使う',
    date: '2026-01-01',
    weekday: 4,
    discountTime: '15' as DiscountTime,
    expectedAdjusted: '金土',
    expectedNotice: '祝日の15時は金曜・土曜・日曜の基準',
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

try {
  const rawReview19 = {
    date: '2026-05-09',
    sessionStartedAt: '2026-05-09T08:00:00.000Z',
    ratings: { bento_men: 'remained_slightly_too_much' },
    recordedAt: '2026-05-09T10:00:00.000Z',
    reference: {
      date: '2026-05-09',
      weekday: 6,
      discountTime: '19',
      weather: { hourlyForecasts: {}, afterRainSky: null },
      resolvedWeather: { nearTermWeather: 'other' },
      basis: { originalWeekdayBase: '金土', adjustedWeekdayBase: '火木', weekdayShift: 1, baseRateBonus: 0, baseRateBonusReason: [] },
    },
    snapshot: {
      version: 1,
      capturedAt: '2026-05-09T10:00:00.000Z',
      session: { date: '2026-05-09', discountTime: '17' },
      areas: { bento_men: { rateText: '20%', manyRateText: '30%', normalRateText: '引かない' } },
    },
  };
  const normalized = normalizeReview19Result(rawReview19 as never);
  assert.equal(normalized?.snapshot?.version, 1);
  assert.equal(normalized?.snapshot?.areas.bento_men.rateText, '20%');
  assert.equal(normalized?.snapshot?.areas.bento_men.ratePercent, 20);
  assert.equal(normalized?.snapshot?.areas.bento_men.manyRatePercent, 30);
  assert.equal(normalized?.snapshot?.areas.bento_men.normalRatePercent, 0);
  assert.equal(normalized?.ratingScores.bento_men, 1);
  assert.equal(normalized?.ratingScores.tempura, 0);
  assert.equal(normalized?.reference?.discountTime, '19');
  assert.equal(normalized?.reference?.basis.adjustedWeekdayBase, '火木');

  const records = appendReview19RecordInMemory({
    currentRecords: [],
    recordToAdd: normalized!,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].snapshot?.version, 1);
  assert.equal(records[0].snapshot?.areas.bento_men.rateText, '20%');
  assert.equal(records[0].snapshot?.areas.bento_men.ratePercent, 20);
  assert.equal(records[0].ratingScores.bento_men, 1);
  console.log('PASS: 19時チェックは値引状況スナップショット・点数・値引率数値を保持する');
  passed += 1;
} catch (error) {
  console.error('FAIL: 19時チェックは値引状況スナップショット・点数・値引率数値を保持する');
  console.error(error);
  process.exitCode = 1;
}


try {
  const review = createInitialReview19Result({
    date: '2026-05-10',
    sessionStartedAt: '2026-05-10T08:00:00.000Z',
    excludedAreaIds: ['bento_men', 'tempura', 'bento_men'],
  });

  assert.deepEqual(review.excludedAreaIds, ['bento_men', 'tempura']);
  assert.equal(review.excludeReasons.bento_men, 'few_at_15_and_17');

  const normalized = normalizeReview19Result({
    ...review,
    snapshot: {
      version: 1,
      capturedAt: '2026-05-10T10:00:00.000Z',
      session: { date: '2026-05-10', discountTime: '17' },
      areas: {
        bento_men: {
          areaId: 'bento_men',
          areaName: '弁当・麺類',
          reviewExcluded: true,
          reviewExcludeReason: 'few_at_15',
          status: 'completed',
          areaJudge: 'few',
          judgeText: '少ない',
          rateText: '引かない',
        },
      },
    } as never,
  });

  assert.equal(normalized?.excludedAreaIds.includes('bento_men'), true);
  assert.equal(normalized?.snapshot?.areas.bento_men.reviewExcluded, true);
  assert.equal(normalized?.snapshot?.areas.bento_men.reviewExcludeReason, 'few_at_15_and_17');

  console.log('PASS: 15時・17時ともに少ない判定したエリアは19時チェック対象外として保存できる');
  passed += 1;
} catch (error) {
  console.error('FAIL: 15時・17時ともに少ない判定したエリアは19時チェック対象外として保存できる');
  console.error(error);
  process.exitCode = 1;
}


console.log(`\n${passed} / ${cases.length + scenarioCases.length + manyTenOrMoreNoteCases.length + 25} checks passed.`);

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


try {
  const records = Array.from({ length: 12 }, (_, index) => ({
    date: `2026-05-${`${index + 1}`.padStart(2, '0')}`,
    sessionStartedAt: `2026-05-${`${index + 1}`.padStart(2, '0')}T17:00:00.000Z`,
    recordedAt: `2026-05-${`${index + 1}`.padStart(2, '0')}T19:20:00.000Z`,
    ratings: {
      bento_men: 'just_right',
      tempura: 'just_right',
      croquette: 'just_right',
      fry_chicken: 'just_right',
      yakitori: 'just_right',
      chuka_fish: 'just_right',
      balance_bento: 'just_right',
      onigiri: 'just_right',
      sushi: 'just_right',
      futomaki_chumaki: 'just_right',
      inari: 'just_right',
      hosomaki: 'just_right',
    },
  }));

  const batch = getReview19ExportBatch(records, 10);
  assert.equal(batch.length, 10);
  assert.equal(batch[0]?.date, '2026-05-01');
  assert.equal(batch[9]?.date, '2026-05-10');

  const payload = buildReview19ExportPayload({
    records: batch,
    exportedAt: '2026-05-20T10:00:00.000Z',
  });
  assert.equal(payload.count, 10);
  assert.equal(payload.format, 'nebiki-helper-review19-export');

  const marked = markReview19RecordsExportedInMemory({
    currentRecords: records,
    recordsToMark: batch,
    exportedAt: '2026-05-20T10:00:00.000Z',
  });
  assert.equal(getUnexportedReview19Records(marked).length, 2);
  assert.equal(getUnexportedReview19Records(marked)[0]?.date, '2026-05-11');
  console.log('PASS: 19時チェック未出力データは古い10日分を出力対象にして出力済みにできる');
  passed += 1;
} catch (error) {
  console.error('FAIL: 19時チェック未出力データは古い10日分を出力対象にして出力済みにできる');
  console.error(error);
  process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
