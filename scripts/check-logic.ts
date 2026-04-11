import assert from 'node:assert/strict';
import {
  buildMergedBonusDisplay,
  getBasisGuideDisplay,
  getWeekdayBaseInfo,
} from '../src/domain/weekdayBase.ts';
import { getFinalTimeGuide, getNormalTimeRateDisplay } from '../src/domain/discount.ts';
import { shouldOfferAfterRainRecovery } from '../src/domain/afterRain.ts';
import { getNextPendingCandidate, getPendingResumeScreen } from '../src/domain/pending.ts';
import { buildHourlyForecastsFromLegacy, resolveWeatherInputForDiscount } from '../src/domain/hourlyWeather.ts';
import {
  appendNavigationHistory,
  cloneNavigationSnapshot,
  createNavigationSnapshot,
  popNavigationHistory,
} from '../src/domain/navigationHistory.ts';
import type {
  AppState,
  DiscountTime,
  LastSessionWeatherRecord,
  NextSessionSkipRecord,
  WeatherInput,
} from '../src/domain/types.ts';

type LegacyWeatherSpec = Record<string, unknown> & { afterRainSky?: 'cloudy' | 'sunny' | null };

type Case = {
  name: string;
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
    next17WindLevel: null,
    next17TempLevel: null,
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
    name: '近い時間の雨は +10% を残しつつ頭打ち +5% を入れない',
    weekday: 1,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '5orLess', nearTermWeather: 'rain' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 10,
      bonusCalcIncludes: ['近い雨 +10%'],
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
      weekdayCalcIncludes: ['後の雨 +1段'],
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
      weekdayCalcIncludes: ['後の雪 +2段'],
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
    name: '15時で17時予報の気温が5度以上低い日は1段強める',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({
      tempLevel: '16to20',
      windLevel: '2orLess',
      next17TempLevel: '11to15',
      next17WindLevel: '2orLess',
    }),
    expected: {
      adjusted: '金土',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['気温 16〜20度 -1段', '17時予報で5度以上低下 +1段'],
      weekdayResultIncludes: ['曜日基準補正は0段', '金曜・土曜の基準のままです'],
    },
  },
  {
    name: '15時で17時予報の気温低下と風強まりで補正しきれない分 +5% に届く',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({
      tempLevel: '31to35',
      windLevel: '2orLess',
      next17TempLevel: '11to15',
      next17WindLevel: '5orMore',
    }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 5,
      weekdayCalcIncludes: ['気温 31〜35度 +1段', '17時予報で5度以上低下 +1段', '17時予報で風も強まる +1段'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +5%'],
      bonusResultIncludes: ['値引率補正は+5%'],
    },
  },
  {
    name: '26〜30度は補正なし',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '26to30' }),
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
    name: '近い時間の雪は +20%',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ nearTermWeather: 'snow' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 20,
      bonusCalcIncludes: ['近い雪 +20%'],
      bonusResultIncludes: ['値引率補正は+20%'],
    },
  },
  {
    name: '近い雨がある日は下限に当たっても -5% を入れない',
    weekday: 5,
    discountTime: '17',
    weatherSpec: weather({ tempLevel: '21to25', nearTermWeather: 'rain' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: 10,
      bonusCalcIncludes: ['近い雨 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '雨上がり後の晴れは1段弱める',
    weekday: 2,
    discountTime: '17',
    weatherSpec: weather({ afterRainSky: 'sunny' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['雨上がり後 晴れ -1段'],
      weekdayResultIncludes: ['曜日基準補正は-1段'],
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
      sekihan_takikomi: { areaId: 'sekihan_takikomi', status: 'unstarted', areaJudge: null },
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
    name: '運用シナリオ: 水曜日17時・近い雨あり',
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
      finalRates: { count3OrMore: '40%', count2: '30%', count1: '20%' },
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
      weekdaySummary: '曜日基準補正：火木→金土',
      bonusSummary: '値引率補正：なし',
      finalRates: { count3OrMore: '40%', count2: '30%', count1: '20%' },
    },
  },
  {
    name: '運用シナリオ: 月曜日17時・近い雨と時刻接近が重なる',
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
    name: '運用シナリオ: 15時に17時の寒さと風の強まりを先読みする',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({
      tempLevel: '16to20',
      windLevel: '2orLess',
      next17TempLevel: '11to15',
      next17WindLevel: '5orMore',
    }),
    expected: {
      weekdaySummary: '曜日基準補正：金土→火木',
      bonusSummary: '値引率補正：なし',
      finalRates: { count3OrMore: '50%', count2: '40%', count1: '30%' },
    },
  },
];


type RepeatManyNoteCase = {
  name: string;
  discountTime: Exclude<DiscountTime, '20'>;
  weatherBonus: number;
  expectedNoteIncludes: string[];
};

const repeatManyNoteCases: RepeatManyNoteCase[] = [
  {
    name: '多い 10% でも前回多い商品の目安を表示する',
    discountTime: '17',
    weatherBonus: -10,
    expectedNoteIncludes: ['5個以下 → 10%', '6〜9個 → 15%', '10個以上 → 20%'],
  },
  {
    name: '多い 15% でも前回多い商品の目安を表示する',
    discountTime: '17',
    weatherBonus: -5,
    expectedNoteIncludes: ['5個以下 → 15%', '6〜9個 → 20%', '10個以上 → 25%'],
  },
];

let passed = 0;

for (const testCase of cases) {
  const weatherInput = toWeatherInput(testCase.discountTime, testCase.weatherSpec);
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, testCase.discountTime);
  const info = getWeekdayBaseInfo(
    testCase.weekday,
    testCase.discountTime,
    resolvedWeather
  );
  const guide = getBasisGuideDisplay({
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
    true
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
  console.log('PASS: 雨上がり後入力の表示条件');
  passed += 1;
} catch (error) {
  console.error('FAIL: 雨上がり後入力の表示条件');
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


for (const repeatManyCase of repeatManyNoteCases) {
  const display = getNormalTimeRateDisplay({
    discountTime: repeatManyCase.discountTime,
    weatherBonus: repeatManyCase.weatherBonus,
    areaJudge: 'normal',
  });

  try {
    assert.ok(display.many.note, 'many.note should exist');
    for (const expected of repeatManyCase.expectedNoteIncludes) {
      assert.ok(display.many.note?.includes(expected), `missing expected note text: ${expected}`);
    }

    console.log(`PASS: ${repeatManyCase.name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${repeatManyCase.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(`\n${passed} / ${cases.length + scenarioCases.length + repeatManyNoteCases.length + 9} checks passed.`);

const finalLow = getFinalTimeGuide({
  weekdayShift: -1,
  rateBonus: 0,
});
assert.equal(finalLow.count3OrMore.main, '40%');
assert.equal(finalLow.count2.main, '30%');
assert.equal(finalLow.count1.main, '20%');
assert.equal(finalLow.score, -1);

const finalHigh = getFinalTimeGuide({
  weekdayShift: 1,
  rateBonus: 0,
});
assert.equal(finalHigh.count3OrMore.main, '50%');
assert.equal(finalHigh.count2.main, '40%');
assert.equal(finalHigh.count1.main, '30%');
assert.equal(finalHigh.score, 1);

const finalBonusRaised = getFinalTimeGuide({
  weekdayShift: 0,
  rateBonus: 10,
});
assert.equal(finalBonusRaised.count3OrMore.main, '50%');
assert.equal(finalBonusRaised.scoreBreakdown.rateBonusPoints, 2);

const finalBonusLowered = getFinalTimeGuide({
  weekdayShift: 0,
  rateBonus: -10,
});
assert.equal(finalBonusLowered.count3OrMore.main, '40%');
assert.equal(finalBonusLowered.scoreBreakdown.rateBonusPoints, -2);

console.log('PASS: 最終値引き点数ロジック');


const sundayRateDisplay = getNormalTimeRateDisplay({
  discountTime: '15',
  weatherBonus: 0,
  areaJudge: 'normal',
  isSunday: true,
});
assert.equal(sundayRateDisplay.slightlyMany?.main, '5%');

const nonSundayRateDisplay = getNormalTimeRateDisplay({
  discountTime: '15',
  weatherBonus: 0,
  areaJudge: 'normal',
  isSunday: false,
});
assert.equal(nonSundayRateDisplay.slightlyMany, undefined);

const sundayEveningRateDisplay = getNormalTimeRateDisplay({
  discountTime: '17',
  weatherBonus: 0,
  areaJudge: 'normal',
  isSunday: true,
});
assert.equal(sundayEveningRateDisplay.normal.main, '10%');
assert.equal(sundayEveningRateDisplay.slightlyMany, undefined);
assert.equal(sundayEveningRateDisplay.many.main, '20%');

console.log('PASS: 日曜15時だけ やや多い を表示する');




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

  assert.equal(candidate?.areaId, 'croquette');
  console.log('PASS: pending は理由より近さを優先して選ぶ');
  passed += 1;
} catch (error) {
  console.error('FAIL: pending は理由より近さを優先して選ぶ');
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

  assert.equal(candidate?.areaId, 'sushi');
  console.log('PASS: 再スキップした pending は一時的に後ろへ回しつつ残りから近い順に選ぶ');
  passed += 1;
} catch (error) {
  console.error('FAIL: 再スキップした pending は一時的に後ろへ回しつつ残りから近い順に選ぶ');
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

  assert.equal(candidate?.areaId, 'croquette');
  console.log('PASS: deferred しか残っていない場合は理由指定よりも残り pending を近い順に再開する');
  passed += 1;
} catch (error) {
  console.error('FAIL: deferred しか残っていない場合は理由指定よりも残り pending を近い順に再開する');
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
