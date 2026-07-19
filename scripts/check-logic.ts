import assert from 'node:assert/strict';
import {
  buildMergedBonusDisplay,
  getBasisGuideDisplay,
  getWeekdayBaseInfo,
} from '../src/domain/weekdayBase.ts';
import { getFinalTimeGuide, getFinalTimeInstructionSteps, getNormalTimeRateDisplay } from '../src/domain/discount.ts';
import {
  buildCalculatorDraftKey,
  clearCalculatorDraft,
  loadCalculatorDraft,
  saveCalculatorDraft,
} from '../src/domain/calculatorDraft.ts';
import { shouldOfferAfterRainRecovery } from '../src/domain/afterRain.ts';
import { getTrainingStepConfig, parseExplicitTrainingStepFromHash, parseTrainingStepFromHash } from '../src/domain/trainingMode.ts';
import { isTrainingStep, isValidAdminPinFormat } from '../src/domain/adminSettings.ts';
import {
  buildAutomaticDayExportPayload,
  getAutomaticDayExportFilename,
} from '../src/domain/dayExport.ts';
import {
  getEarlyNextMinus5CompletedText,
  getEarlyNextMinus5NoticeText,
  getEarlyNextMinus5TargetDiscountTime,
  shouldReserveEarlyNextMinus5OnAutoTransition,
} from '../src/domain/earlyNextMinus5.ts';
import { getNextPendingCandidate, getPendingResumeScreen } from '../src/domain/pending.ts';
import { AREA_MASTERS, DONE_SUMMARY_ROUTE, NORMAL_ROUTE } from '../src/domain/area.ts';
import {
  appendReview19RecordInMemory,
  buildReview19DataQuality,
  buildReview19ExportPayload,
  createInitialReview19Result,
  getReview19ExportBatch,
  getUnexportedReview19Records,
  markReview19RecordsExportedInMemory,
  normalizeReview19Result,
} from '../src/domain/review19.ts';
import {
  createDefaultHourlyForecasts,
  buildHourlyForecastsFromLegacy,
  resolveRainSandwichedHourlyForecasts,
  resolveWeatherInputForDiscount,
} from '../src/domain/hourlyWeather.ts';
import {
  appendNavigationHistory,
  cloneNavigationSnapshot,
  createNavigationSnapshot,
  popNavigationHistory,
} from '../src/domain/navigationHistory.ts';
import {
  appendSkipRecordsInMemory,
  consumeSkipRecordsInMemory,
  isDailySessionSnapshotDateConsistent,
  isAppStateSessionCurrentForDate,
  sanitizePersistedNebikiStateForDate,
} from '../src/domain/storage.ts';
import {
  buildAreaCountDecisionBasis,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  getAreaCountSameItemLimit,
  normalizeAreaCountRecords,
  shouldForceAreaCountFallbackWeekdayGroup,
} from '../src/domain/areaCountHistory.ts';
import type {
  AreaId,
  AppState,
  DiscountTime,
  LastSessionWeatherRecord,
  NextSessionSkipRecord,
  WeatherInput,
  WeekdayBaseLabel,
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
    bonusDetailIncludes?: string[];
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
      bonusDetailIncludes: ['16時気温 21〜25度 -2点', '未来天候ポイント +10pt（17〜21時） -2点'],
      bonusCalcIncludes: ['快適度補正：超快適 -10%'],
    },
  },
  {
    name: '直近低温と低温風は快適度で不快に寄せる',
    weekday: 5,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '6to10', windLevel: '5orMore' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 10,
      bonusDetailIncludes: ['16時気温 6〜10度 +1点', '風 5m以上（15度以下） +2点', '未来天候ポイント -15pt（17〜21時） +2点'],
      bonusCalcIncludes: ['快適度補正：不快 +10%'],
    },
  },
  {
    name: '起点時刻の雨は +5%',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ nearTermWeather: 'rain' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 5,
      bonusCalcIncludes: ['16時に雨 +5%'],
      bonusResultIncludes: ['値引率補正は+5%'],
    },
  },
  {
    name: '起点雨かつその後も雨は +10%',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ nearTermWeather: 'rain', hasLaterPrecip: true, laterPrecipType: 'rain' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 10,
      bonusCalcIncludes: ['16時に雨、その後も雨 +10%'],
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
      bonusCalcIncludes: ['20時に雨、その後も雨 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '起点以外の雪は直接値引率補正にしない',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ hasLaterPrecip: true, laterPrecipType: 'snow' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      bonusCalcAbsent: true,
    },
  },
  {
    name: '17時以降の不快は +10%',
    weekday: 1,
    discountTime: '17',
    weatherSpec: weather({ tempLevel: '36orMore', windLevel: '5orMore' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 10,
      bonusDetailIncludes: ['18時気温 36度以上 +2点', '風 5m以上 +1点', '未来天候ポイント -9pt（19〜21時） +2点'],
      bonusCalcIncludes: ['快適度補正：不快 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '15時の超快適は -10%',
    weekday: 0,
    discountTime: '15',
    weatherSpec: weather({ tempLevel: '21to25' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: -10,
      bonusCalcIncludes: ['快適度補正：超快適 -10%'],
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
    name: '起点時刻の雪は +15%',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ nearTermWeather: 'snow' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 15,
      bonusCalcIncludes: ['16時に雪 +15%'],
      bonusResultIncludes: ['値引率補正は+15%'],
    },
  },
  {
    name: '起点雪かつその後も雪は +20%',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({ nearTermWeather: 'snow', hasLaterPrecip: true, laterPrecipType: 'snow' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 20,
      bonusCalcIncludes: ['16時に雪、その後も雪 +20%'],
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
    name: 'GW連休3日目の翌日15時は快適度で少し不快に寄せる',
    date: '2026-05-05',
    weekday: 2,
    discountTime: '15',
    weatherSpec: weather({}),
    expected: {
      adjusted: '月水',
      baseRateBonus: 5,
      bonusDetailIncludes: ['GW連休3日目の翌日 +1点'],
      bonusCalcIncludes: ['快適度補正：少し不快 +5%'],
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
      ryomi: { areaId: 'ryomi', status: 'unstarted', areaJudge: null },
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
      weekdaySummary: '基本値引率：25%（金曜日・19時30分）',
      bonusSummary: '値引率補正：+10％',
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


type ManyThresholdPlus5NoteCase = {
  name: string;
  discountTime: Exclude<DiscountTime, '20'>;
  weatherBonus: number;
  isSunday?: boolean;
  ignoreTimeRateCap?: boolean;
  weekdayBase?: WeekdayBaseLabel;
  expectedNoteIncludes?: string[];
  expectedNoteExcludes?: string[];
};

const manyThresholdPlus5NoteCases: ManyThresholdPlus5NoteCase[] = [
  {
    name: '火木基準は10個以上を+15%目安として表示する',
    discountTime: '15',
    weatherBonus: -10,
    expectedNoteIncludes: ['多いのうち10個以上は 5%'],
  },
  {
    name: '火木基準で多いが5%なら10個以上は10%目安を表示する',
    discountTime: '15',
    weatherBonus: -5,
    expectedNoteIncludes: ['多いのうち10個以上は 10%'],
  },
  {
    name: '月水基準でも10個以上を+15%目安として表示する',
    discountTime: '15',
    weatherBonus: 0,
    weekdayBase: '月水',
    expectedNoteIncludes: ['多いのうち10個以上は 15%'],
  },
  {
    name: '金土日基準でも10個以上を+15%目安として表示する',
    discountTime: '15',
    weatherBonus: 0,
    isSunday: true,
    weekdayBase: '金土',
    expectedNoteIncludes: [
      '多いのうち10個以上は 15%',
    ],
  },
  {
    name: '19時30分も時刻別上限なしで10個以上の追加目安を表示する',
    discountTime: '19',
    weatherBonus: 0,
    expectedNoteIncludes: ['多いのうち10個以上は 45%'],
  },
  {
    name: '雨雪補正中も絶対上限50%を超える多い個数目安は表示しない',
    discountTime: '19',
    weatherBonus: 20,
    ignoreTimeRateCap: true,
    expectedNoteExcludes: ['多いのうち10個以上は 55%', '多いのうち10個以上は 65%'],
  },
];

let passed = 0;

{
  try {
    assert.equal(getAreaCountSameItemLimit({ weekdayBase: '月水' }), 10);
    assert.equal(getAreaCountSameItemLimit({ weekdayBase: '火木' }), 10);
    assert.equal(getAreaCountSameItemLimit({ weekdayBase: '金土' }), 10);
    assert.equal(getAreaCountSameItemLimit({ weekdayBase: '日' }), 10);
    assert.equal(getAreaCountSameItemLimit({ weekday: 1, discountTime: '15' }), 10);
    assert.equal(getAreaCountSameItemLimit({ weekday: 0, discountTime: '17' }), 10);
    console.log('PASS: 同じ商品カウント上限は曜日・時刻に関係なく10個固定');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 同じ商品カウント上限は曜日・時刻に関係なく10個固定');
    console.error(error);
    process.exitCode = 1;
  }
}




{
  try {
    assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 0, discountTime: '15', date: '2026-07-05' }), '金土日');
    assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 0, discountTime: '17', date: '2026-07-05' }), '火木日');
    assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 0, discountTime: '17', date: '2026-07-19' }), '三連休中日');
    assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 1, discountTime: '15', date: '2026-07-20' }), '月水');
    assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 1, discountTime: '17', date: '2026-07-20' }), '月水');
    assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 1, discountTime: '17', date: '2026-11-02' }), '金土');
    assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 5, discountTime: '17', date: '2026-07-03' }), '金土');
    assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 5, discountTime: '17', date: '2026-03-20' }), '金土');
    assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 6, discountTime: '17', date: '2028-01-01' }), '金土');
    assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 0, discountTime: '17', date: '2026-05-03' }), '金土');
    console.log('PASS: 暫定比較グループは時刻別3グループと祝前日例外を適用する');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 暫定比較グループの時刻別3グループ・祝前日例外');
    console.error(error);
    process.exitCode = 1;
  }
}

{
  try {
    assert.equal(shouldForceAreaCountFallbackWeekdayGroup({ weekday: 1, date: '2026-11-02' }), true);
    assert.equal(shouldForceAreaCountFallbackWeekdayGroup({ weekday: 5, date: '2026-03-20' }), true);
    assert.equal(shouldForceAreaCountFallbackWeekdayGroup({ weekday: 6, date: '2028-01-01' }), false);
    assert.equal(shouldForceAreaCountFallbackWeekdayGroup({ weekday: 1, date: '2026-07-20' }), true);
    assert.equal(shouldForceAreaCountFallbackWeekdayGroup({ weekday: 0, date: '2026-07-05' }), false);

    const fridayHolidayRecords = [
      {
        date: '2026-03-13',
        sessionStartedAt: '2026-03-13T08:00:00.000Z',
        recordedAt: '2026-03-13T08:01:00.000Z',
        areaId: 'bento_men',
        discountTime: '17',
        actualWeekday: '金',
        actualWeekdayGroup: '金土日',
        count: 10,
      },
      {
        date: '2026-03-06',
        sessionStartedAt: '2026-03-06T08:00:00.000Z',
        recordedAt: '2026-03-06T08:01:00.000Z',
        areaId: 'bento_men',
        discountTime: '17',
        actualWeekday: '金',
        actualWeekdayGroup: '金土日',
        count: 12,
      },
      {
        date: '2026-02-27',
        sessionStartedAt: '2026-02-27T08:00:00.000Z',
        recordedAt: '2026-02-27T08:01:00.000Z',
        areaId: 'bento_men',
        discountTime: '17',
        actualWeekday: '金',
        actualWeekdayGroup: '金土日',
        count: 14,
      },
    ];
    const fridayHolidayRecommendation = getAreaCountRecommendation({
      records: fridayHolidayRecords,
      areaId: 'bento_men',
      discountTime: '17',
      weekday: 5,
      date: '2026-03-20',
      count: 12,
    });
    assert.equal(fridayHolidayRecommendation.status, 'ready');
    assert.equal(fridayHolidayRecommendation.comparisonMode, 'fallback_group');

    const saturdayHolidayRecommendation = getAreaCountRecommendation({
      records: [
        {
          date: '2027-12-25',
          sessionStartedAt: '2027-12-25T08:00:00.000Z',
          recordedAt: '2027-12-25T08:01:00.000Z',
          areaId: 'bento_men',
          discountTime: '17',
          actualWeekday: '土',
          actualWeekdayGroup: '金土日',
          count: 10,
        },
        {
          date: '2027-12-18',
          sessionStartedAt: '2027-12-18T08:00:00.000Z',
          recordedAt: '2027-12-18T08:01:00.000Z',
          areaId: 'bento_men',
          discountTime: '17',
          actualWeekday: '土',
          actualWeekdayGroup: '金土日',
          count: 12,
        },
        {
          date: '2027-12-11',
          sessionStartedAt: '2027-12-11T08:00:00.000Z',
          recordedAt: '2027-12-11T08:01:00.000Z',
          areaId: 'bento_men',
          discountTime: '17',
          actualWeekday: '土',
          actualWeekdayGroup: '金土日',
          count: 14,
        },
      ],
      areaId: 'bento_men',
      discountTime: '17',
      weekday: 6,
      date: '2028-01-01',
      count: 12,
    });
    assert.equal(saturdayHolidayRecommendation.status, 'ready');
    assert.equal(saturdayHolidayRecommendation.comparisonMode, 'weekday');

    console.log('PASS: 祝日まわりは金曜祝日を暫定固定、土曜祝日は曜日データ優先で扱う');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 祝日まわりの暫定グループ優先ルール');
    console.error(error);
    process.exitCode = 1;
  }
}

{
  try {
    const records = [
      {
        date: '2026-06-26',
        sessionStartedAt: '2026-06-26T09:00:00.000Z',
        recordedAt: '2026-06-26T09:05:00.000Z',
        areaId: 'bento_men',
        discountTime: '15',
        actualWeekday: '金',
        actualWeekdayGroup: '金土日',
        count: 0,
      },
      {
        date: '2026-06-19',
        sessionStartedAt: '2026-06-19T09:00:00.000Z',
        recordedAt: '2026-06-19T09:05:00.000Z',
        areaId: 'bento_men',
        discountTime: '15',
        actualWeekday: '金',
        actualWeekdayGroup: '金土日',
        count: 4,
      },
      {
        date: '2026-06-19',
        sessionStartedAt: '2026-06-19T10:00:00.000Z',
        recordedAt: '2026-06-19T10:05:00.000Z',
        areaId: 'bento_men',
        discountTime: '15',
        actualWeekday: '金',
        actualWeekdayGroup: '金土日',
        count: 9,
      },
      {
        date: '2026-06-12',
        sessionStartedAt: '2026-06-12T09:00:00.000Z',
        recordedAt: '2026-06-12T09:05:00.000Z',
        areaId: 'bento_men',
        discountTime: '15',
        actualWeekday: '金',
        actualWeekdayGroup: '金土日',
        count: 8,
      },
    ];

    const recommendation = getAreaCountRecommendation({
      records,
      areaId: 'bento_men',
      discountTime: '15',
      weekday: 5,
      weather: toWeatherInput('15', weather({})),
      date: '2026-06-26',
      count: 5,
    });

    assert.equal(recommendation.status, 'insufficient');
    assert.equal(recommendation.sampleSize, 2);
    assert.equal(recommendation.detailLines.some((line) => line.includes('同じ曜日の記録：2/3件')), true);
    assert.deepEqual(recommendation.matchedRecords.map((record) => record.date), ['2026-06-12', '2026-06-19']);
    assert.equal(recommendation.matchedRecords.find((record) => record.date === '2026-06-19')?.count, 9);

    console.log('PASS: エリア残数判定は今日の記録を除外し、同日同エリア同時刻は最新1件だけ使う');
    passed += 1;
  } catch (error) {
    console.error('FAIL: エリア残数判定の過去データ絞り込み');
    console.error(error);
    process.exitCode = 1;
  }
}

{
  try {
    const hourlyForecasts = createDefaultHourlyForecasts();
    hourlyForecasts['16'].weather = 'rain';
    hourlyForecasts['17'].weather = 'sunny';
    hourlyForecasts['18'].weather = 'rain';
    hourlyForecasts['19'].weather = 'snow';
    hourlyForecasts['20'].weather = 'rain';

    const resolved = resolveRainSandwichedHourlyForecasts(hourlyForecasts);
    assert.equal(resolved['17'].weather, 'rain');
    assert.equal(resolved['19'].weather, 'snow');
    assert.equal(hourlyForecasts['17'].weather, 'sunny');

    const longGapForecasts = createDefaultHourlyForecasts();
    longGapForecasts['15'].weather = 'rain';
    longGapForecasts['16'].weather = 'sunny';
    longGapForecasts['17'].weather = 'sunny';
    longGapForecasts['18'].weather = 'rain';
    const longGapResolved = resolveRainSandwichedHourlyForecasts(longGapForecasts);
    assert.equal(longGapResolved['16'].weather, 'sunny');
    assert.equal(longGapResolved['17'].weather, 'sunny');

    console.log('PASS: 雨に直接1枠だけ挟まれた晴れ時刻だけ計算上雨扱い、雪は雪のまま');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 雨に挟まれた時刻の天気補正');
    console.error(error);
    process.exitCode = 1;
  }
}

{
  try {
    const hourlyForecasts = createDefaultHourlyForecasts();
    hourlyForecasts['16'].weather = 'rain';
    hourlyForecasts['18'].weather = 'rain';
    const resolvedWeather = resolveWeatherInputForDiscount({ hourlyForecasts, afterRainSky: null }, '15');

    assert.equal(resolvedWeather.precipitationRateBonus, 10);
    assert.equal(resolvedWeather.weatherPointScore, -2);
    console.log('PASS: 雨に挟まれた晴れ時刻は値引率補正と未来天候ポイントに反映する');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 雨に挟まれた時刻を値引率計算に反映する');
    console.error(error);
    process.exitCode = 1;
  }
}

{
  const weatherInput = toWeatherInput('15', weather({ tempLevel: '28to30' }));
  const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, '15');
  const info = getWeekdayBaseInfo(2, '15', resolvedWeather, '2026-04-01');
  const guide = getBasisGuideDisplay({ date: '2026-04-01', weekday: 2, discountTime: '15', weather: resolvedWeather });

  try {
    assert.equal(resolvedWeather.weatherPointScore, 0);
    assert.equal(resolvedWeather.weatherPointShift, 0);
    assert.equal(info.adjusted, '火木');
    assert.ok(guide.weekdayCalcText?.includes('基本値引率の内訳：15時 → 0%'));
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
    assert.ok(guide.bonusDetailLines?.some((line) => line.includes('16時気温 21〜25度 -2点')));
    assert.ok(guide.bonusDetailLines?.some((line) => line.includes('未来天候ポイント +10pt（17〜21時） -2点')));
    console.log('PASS: 直近21〜25度と未来21〜25度ならベースと未来ポイントで緩める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 16〜21時が21〜25度なら天候ポイントで2点緩める');
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
    assert.ok(guide.bonusDetailLines?.some((line) => line.includes('16時気温 26〜27度 -1点')));
    assert.ok(guide.bonusDetailLines?.some((line) => line.includes('未来天候ポイント +5pt（17〜21時） -1点')));
    console.log('PASS: 直近26〜27度と未来26〜27度ならベースと未来ポイントで緩める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 16〜21時が26〜27度なら天候ポイントで1点緩める');
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
    assert.ok(guide.bonusDetailLines?.every((line) => !line.includes('16時気温 11〜15度')) ?? true);
    assert.ok(guide.bonusDetailLines?.every((line) => !line.includes('未来天候ポイント')) ?? true);
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
    assert.ok(guide.bonusDetailLines?.some((line) => line.includes('16時気温 6〜10度 +1点')));
    assert.ok(guide.bonusDetailLines?.some((line) => line.includes('未来天候ポイント -5pt（17〜21時） +1点')));
    console.log('PASS: 直近6〜10度と未来6〜10度ならベースと未来ポイントで1点強める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 16〜21時が6〜10度なら天候ポイントで1点強める');
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
    assert.ok(guide.bonusDetailLines?.some((line) => line.includes('未来天候ポイント +9pt（17〜21時） -2点')));
    console.log('PASS: 暑さが抜けて夜が快適な日は未来天候ポイントで2点緩める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 暑さが抜けて夜が快適な日は天候ポイントで2点緩める');
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
    assert.ok(guide.bonusDetailLines?.some((line) => line.includes('未来天候ポイント -7pt（17〜21時） +2点')));
    console.log('PASS: 夕方以降に冷え込む日は未来天候ポイントで2点強める');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 夕方以降に冷え込む日は天候ポイントで2点強める');
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

    for (const text of testCase.expected.bonusDetailIncludes ?? []) {
      assert.ok(
        guide.bonusDetailLines?.some((line) => line.includes(text)),
        `bonusDetailLines に「${text}」がありません`
      );
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
  const hourlyForecasts = createDefaultHourlyForecasts();
  hourlyForecasts['19'].weather = 'rain';
  hourlyForecasts['20'].weather = 'rain';
  const resolvedWeather = resolveWeatherInputForDiscount({ hourlyForecasts, afterRainSky: null }, '17');
  const info = getWeekdayBaseInfo(2, '17', resolvedWeather, '2026-04-07');
  const guide = getBasisGuideDisplay({
    date: '2026-04-07',
    weekday: 2,
    discountTime: '17',
    weather: resolvedWeather,
  });

  assert.equal(info.baseRateBonus, 0);
  assert.equal(guide.bonusCalcText, undefined);
  console.log('PASS: 17時は18時が雨でなければ19時・20時が雨でも直接補正しない');
  passed += 1;
} catch (error) {
  console.error('FAIL: 17時は18時が雨でなければ19時・20時が雨でも直接補正しない');
  console.error(error);
  process.exitCode = 1;
}

try {
  const hourlyForecasts = createDefaultHourlyForecasts();
  hourlyForecasts['18'].weather = 'rain';
  hourlyForecasts['20'].weather = 'rain';
  const resolvedWeather = resolveWeatherInputForDiscount({ hourlyForecasts, afterRainSky: null }, '17');
  const info = getWeekdayBaseInfo(2, '17', resolvedWeather, '2026-04-07');
  const guide = getBasisGuideDisplay({
    date: '2026-04-07',
    weekday: 2,
    discountTime: '17',
    weather: resolvedWeather,
  });

  assert.equal(info.baseRateBonus, 10);
  assert.ok(guide.bonusCalcText?.includes('18時に雨、その後も雨 +10%'));
  console.log('PASS: 17時は18時雨を起点に19時か20時も雨なら +10%');
  passed += 1;
} catch (error) {
  console.error('FAIL: 17時は18時雨を起点に19時か20時も雨なら +10%');
  console.error(error);
  process.exitCode = 1;
}

try {
  const merged = buildMergedBonusDisplay({
    baseBonusParts: ['天候・気温による補正 -5%'],
    baseRateBonus: -5,
    lateTimeBonus: 5,
  });
  assert.ok(merged.bonusCalcText?.includes('天候・気温による補正 -5%'));
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

    assert.ok(basisGuide.weekdaySummaryText?.startsWith('基本値引率：'));
    assert.equal(mergedBonus.bonusSummaryText, scenarioCase.expected.bonusSummary);

    console.log(`PASS: ${scenarioCase.name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${scenarioCase.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}


for (const manyThresholdPlus5Case of manyThresholdPlus5NoteCases) {
  const display = getNormalTimeRateDisplay({
    discountTime: manyThresholdPlus5Case.discountTime,
    weatherBonus: manyThresholdPlus5Case.weatherBonus,
    areaJudge: 'normal',
    isSunday: manyThresholdPlus5Case.isSunday,
    ignoreTimeRateCap: manyThresholdPlus5Case.ignoreTimeRateCap,
    weekdayBase: manyThresholdPlus5Case.weekdayBase,
  });

  try {
    const note = display.many.note ?? '';

    for (const expected of manyThresholdPlus5Case.expectedNoteIncludes ?? []) {
      assert.ok(note.includes(expected), `missing expected note text: ${expected}`);
    }

    for (const unexpected of manyThresholdPlus5Case.expectedNoteExcludes ?? []) {
      assert.ok(!note.includes(unexpected), `unexpected note text remained: ${unexpected}`);
    }

    console.log(`PASS: ${manyThresholdPlus5Case.name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${manyThresholdPlus5Case.name}`);
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
  assert.equal(capped15.normal.main, '25%');
  assert.equal(capped15.many.main, '35%');

  const capped17 = getNormalTimeRateDisplay({
    discountTime: '17',
    weatherBonus: 10,
    areaJudge: 'many',
  });
  assert.equal(capped17.normal.main, '30%');
  assert.equal(capped17.many.main, '40%');

  const capped19 = getNormalTimeRateDisplay({
    discountTime: '19',
    weatherBonus: 10,
    areaJudge: 'normal',
  });
  assert.equal(capped19.normal.main, '40%');
  assert.equal(capped19.many.main, '50%');

  const uncappedRainOrSnow = getNormalTimeRateDisplay({
    discountTime: '19',
    weatherBonus: 20,
    areaJudge: 'many',
    ignoreTimeRateCap: true,
  });
  assert.equal(uncappedRainOrSnow.normal.main, '50%');
  assert.equal(uncappedRainOrSnow.many.main, '50%');

  console.log('PASS: 通常値引は時刻別上限なしで絶対上限50%');
  passed += 1;
} catch (error) {
  console.error('FAIL: 通常値引は時刻別上限なしで絶対上限50%');
  console.error(error);
  process.exitCode = 1;
}

const holidayBasicRateCases = [
  {
    name: '祝日の15時でも基本値引率は時刻固定',
    date: '2026-01-01',
    weekday: 4,
    discountTime: '15' as DiscountTime,
    expectedCalcText: '基本値引率の内訳：15時 → 0%',
  },
  {
    name: '祝日17時以降で翌日も休日でも基本値引率は時刻固定',
    date: '2026-09-22',
    weekday: 2,
    discountTime: '17' as DiscountTime,
    expectedCalcText: '基本値引率の内訳：17時 → 10%',
  },
  {
    name: '祝日17時以降で翌日が平日でも基本値引率は時刻固定',
    date: '2026-01-12',
    weekday: 1,
    discountTime: '17' as DiscountTime,
    expectedCalcText: '基本値引率の内訳：17時 → 10%',
  },
  {
    name: '祝日に挟まれた休日でも基本値引率は時刻固定',
    date: '2026-09-22',
    weekday: 2,
    discountTime: '17' as DiscountTime,
    expectedCalcText: '基本値引率の内訳：17時 → 10%',
  },
];

for (const holidayCase of holidayBasicRateCases) {
  try {
    const weatherInput = toWeatherInput(holidayCase.discountTime, weather({}));
    const resolvedWeather = resolveWeatherInputForDiscount(weatherInput, holidayCase.discountTime);
    const guide = getBasisGuideDisplay({
      date: holidayCase.date,
      weekday: holidayCase.weekday,
      discountTime: holidayCase.discountTime,
      weather: resolvedWeather,
    });

    assert.ok(guide.weekdayCalcText?.includes(holidayCase.expectedCalcText));
    assert.equal(guide.noticeText, undefined);
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
  assert.equal(normalized?.ratingStatus, 'recorded');
  assert.equal(normalized?.ratingScores?.bento_men, 1);
  assert.equal(normalized?.ratingScores?.tempura, 0);
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
  assert.equal(records[0].ratingScores?.bento_men, 1);
  console.log('PASS: 19時チェックは値引状況スナップショット・点数・値引率数値を保持する');
  passed += 1;
} catch (error) {
  console.error('FAIL: 19時チェックは値引状況スナップショット・点数・値引率数値を保持する');
  console.error(error);
  process.exitCode = 1;
}

try {
  const currentCountBasedRecord = normalizeReview19Result({
    date: '2026-07-10',
    sessionStartedAt: '2026-07-10T07:47:18.899Z',
    ratings: { bento_men: 'just_right' } as never,
    ratingScores: { bento_men: 0 } as never,
    areaCounts: { bento_men: 100 },
    excludedAreaIds: [],
    excludeReasons: {},
  });

  assert.equal(currentCountBasedRecord?.ratingStatus, 'not_collected');
  assert.equal(currentCountBasedRecord?.ratings, null);
  assert.equal(currentCountBasedRecord?.ratingScores, null);

  const initial = createInitialReview19Result({
    date: '2026-07-15',
    sessionStartedAt: '2026-07-15T08:00:00.000Z',
  });
  assert.equal(initial.ratingStatus, 'not_collected');
  assert.equal(initial.ratings, null);
  assert.equal(initial.ratingScores, null);
  assert.equal(initial.review19Status, 'recorded');
  assert.equal(initial.dataSchemaVersion, 2);
  assert.ok(initial.appVersion);

  const notApplicable = createInitialReview19Result({
    date: '2026-07-15',
    sessionStartedAt: '2026-07-15T08:00:00.000Z',
    review19Status: 'not_applicable',
  });
  assert.equal(notApplicable.review19Status, 'not_applicable');
  assert.equal(notApplicable.dataQuality.complete, true);
  assert.equal(notApplicable.dataQuality.expectedAreaCount, 0);
  console.log('PASS: 残数入力方式の19時チェックは未収集評価をちょうどいいとして保存しない');
  passed += 1;
} catch (error) {
  console.error('FAIL: 残数入力方式の19時チェックは未収集評価をちょうどいいとして保存しない');
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


const finalMinimum = getFinalTimeGuide({
  weekday: 1,
  weather21: 'sunny',
  temp21C: 20,
  comfortScore: 0,
});
assert.equal(finalMinimum.count3OrMore.main, '50%');
assert.equal(finalMinimum.count2.main, '40%');
assert.equal(finalMinimum.count1.main, '30%');
assert.deepEqual(
  getFinalTimeInstructionSteps(finalMinimum).map((step) => [step.subject, step.rate]),
  [
    ['3個以上ある商品を', '50%'],
    ['2個ある商品を', '40%'],
    ['1個の商品を', '30%'],
  ],
);

const finalMiddle = getFinalTimeGuide({
  weekday: 1,
  weather21: 'sunny',
  temp21C: 31,
  comfortScore: 1,
});
assert.equal(finalMiddle.count3OrMore.main, '50%');
assert.equal(finalMiddle.count2.main, '50%');
assert.equal(finalMiddle.count1.main, '40%');
assert.deepEqual(
  getFinalTimeInstructionSteps(finalMiddle).map((step) => [step.subject, step.rate]),
  [
    ['2個以上ある商品を', '50%'],
    ['1個の商品を', '40%'],
  ],
);

const finalHotSevere = getFinalTimeGuide({
  weekday: 1,
  weather21: 'sunny',
  temp21C: 36,
  comfortScore: 2,
});
assert.equal(finalHotSevere.count2.main, '50%');
assert.equal(finalHotSevere.count1.main, '40%');

const finalStrongColdOutsideMidwinter = getFinalTimeGuide({
  weekday: 1,
  weather21: 'sunny',
  temp21C: 5,
  comfortScore: 2,
});
assert.equal(finalStrongColdOutsideMidwinter.count3OrMore.main, '50%');
assert.equal(finalStrongColdOutsideMidwinter.count2.main, '50%');
assert.equal(finalStrongColdOutsideMidwinter.count1.main, '50%');
assert.deepEqual(
  getFinalTimeInstructionSteps(finalStrongColdOutsideMidwinter).map((step) => [step.subject, step.rate]),
  [['すべての商品を', '50%']],
);

const finalRainMinimum = getFinalTimeGuide({
  weekday: 1,
  weather21: 'rain',
  temp21C: 20,
  comfortScore: 0,
});
assert.equal(finalRainMinimum.count2.main, '50%');
assert.equal(finalRainMinimum.count1.main, '40%');

const finalRainColdFeelsWorse = getFinalTimeGuide({
  weekday: 1,
  weather21: 'rain',
  temp21C: 10,
  comfortScore: 1,
});
assert.equal(finalRainColdFeelsWorse.count1.main, '50%');

const finalDryColdSameConditions = getFinalTimeGuide({
  weekday: 1,
  weather21: 'sunny',
  temp21C: 10,
  comfortScore: 1,
});
assert.equal(finalDryColdSameConditions.count1.main, '40%');

const finalRainStrongCold = getFinalTimeGuide({
  weekday: 1,
  weather21: 'rain',
  temp21C: 5,
  comfortScore: 2,
});
assert.equal(finalRainStrongCold.count1.main, '50%');

const finalSnowFriday = getFinalTimeGuide({
  weekday: 5,
  weather21: 'snow',
  temp21C: 2,
  comfortScore: 0,
});
assert.equal(finalSnowFriday.count1.main, '50%');

const finalFridayMiddleToMinimum = getFinalTimeGuide({
  weekday: 5,
  weather21: 'sunny',
  temp21C: 31,
  comfortScore: 1,
});
assert.equal(finalFridayMiddleToMinimum.count2.main, '40%');
assert.equal(finalFridayMiddleToMinimum.count1.main, '30%');

const finalSaturdayStrongColdToMiddle = getFinalTimeGuide({
  weekday: 6,
  weather21: 'sunny',
  temp21C: 5,
  comfortScore: 2,
});
assert.equal(finalSaturdayStrongColdToMiddle.count2.main, '50%');
assert.equal(finalSaturdayStrongColdToMiddle.count1.main, '40%');

const finalFridayRainMaxToMiddle = getFinalTimeGuide({
  weekday: 5,
  weather21: 'rain',
  temp21C: 5,
  comfortScore: 2,
});
assert.equal(finalFridayRainMaxToMiddle.count2.main, '50%');
assert.equal(finalFridayRainMaxToMiddle.count1.main, '40%');

const finalCountAboveMovesTowardC = getFinalTimeGuide({
  weekday: 1,
  weather21: 'sunny',
  temp21C: 20,
  comfortScore: 0,
  areaCountEvaluation: 'slightly_many',
});
assert.equal(finalCountAboveMovesTowardC.count1.main, '40%');

const finalCountBelowMovesTowardA = getFinalTimeGuide({
  weekday: 1,
  weather21: 'sunny',
  temp21C: 5,
  comfortScore: 2,
  areaCountEvaluation: 'slightly_few',
});
assert.equal(finalCountBelowMovesTowardA.count1.main, '40%');

const finalRainCountBelowKeepsRainFloor = getFinalTimeGuide({
  weekday: 1,
  weather21: 'rain',
  temp21C: 20,
  comfortScore: 0,
  areaCountEvaluation: 'few',
});
assert.equal(finalRainCountBelowKeepsRainFloor.count1.main, '40%');

const finalSnowCountBelowStaysMaximum = getFinalTimeGuide({
  weekday: 1,
  weather21: 'snow',
  temp21C: 0,
  comfortScore: 0,
  areaCountEvaluation: 'few',
});
assert.equal(finalSnowCountBelowStaysMaximum.count1.main, '50%');

console.log('PASS: 最終値引の21時天候・雨の体感・金土・20時30分残数補正ロジック');
passed += 1;

{
  try {
    const records = [
      {
        date: '2026-06-23',
        sessionStartedAt: '2026-06-23T11:30:00.000Z',
        recordedAt: '2026-06-23T11:35:00.000Z',
        areaId: 'bento_men',
        discountTime: '20',
        actualWeekday: '火',
        actualWeekdayGroup: '火木',
        count: 10,
      },
      {
        date: '2026-06-30',
        sessionStartedAt: '2026-06-30T11:30:00.000Z',
        recordedAt: '2026-06-30T11:35:00.000Z',
        areaId: 'bento_men',
        discountTime: '20',
        actualWeekday: '火',
        actualWeekdayGroup: '火木',
        count: 10,
      },
      {
        date: '2026-07-07',
        sessionStartedAt: '2026-07-07T11:30:00.000Z',
        recordedAt: '2026-07-07T11:35:00.000Z',
        areaId: 'bento_men',
        discountTime: '20',
        actualWeekday: '火',
        actualWeekdayGroup: '火木',
        count: 10,
      },
    ] as const;

    const nearMedian = getAreaCountRecommendation({
      records: [...records],
      areaId: 'bento_men',
      discountTime: '20',
      weekday: 2,
      date: '2026-07-14',
      count: 10,
    });
    const aboveMedian = getAreaCountRecommendation({
      records: [...records],
      areaId: 'bento_men',
      discountTime: '20',
      weekday: 2,
      date: '2026-07-14',
      count: 12,
    });
    const belowMedian = getAreaCountRecommendation({
      records: [...records],
      areaId: 'bento_men',
      discountTime: '20',
      weekday: 2,
      date: '2026-07-14',
      count: 8,
    });

    assert.equal(nearMedian.status, 'ready');
    assert.equal(nearMedian.suggestedEvaluation, 'normal');
    assert.equal(aboveMedian.suggestedEvaluation, 'slightly_many');
    assert.equal(belowMedian.suggestedEvaluation, 'slightly_few');
    assert.equal(aboveMedian.summaryText.includes('C側へ1段階'), true);
    assert.equal(belowMedian.summaryText.includes('A側へ1段階'), true);

    console.log('PASS: 20時30分残数は中央値付近・上寄り・下寄りで最終値引基準を補正できる');
    passed += 1;
  } catch (error) {
    console.error('FAIL: 20時30分残数の中央値補正');
    console.error(error);
    process.exitCode = 1;
  }
}


const sundayRateDisplay = getNormalTimeRateDisplay({
  discountTime: '15',
  weatherBonus: 0,
  areaJudge: 'normal',
  isSunday: true,
  weekdayBase: '金土',
});
assert.equal(sundayRateDisplay.many.main, '10%');
assert.equal(Object.hasOwn(sundayRateDisplay, 'slightlyMany'), false);
assert.ok(!(sundayRateDisplay.many.note ?? '').includes('多いのうち5個以上'));
assert.ok((sundayRateDisplay.many.note ?? '').includes('多いのうち10個以上は 15%'));

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
passed += 1;



const absoluteCapRateDisplay = getNormalTimeRateDisplay({
  discountTime: '19',
  weatherBonus: 10,
  areaJudge: 'normal',
  ignoreTimeRateCap: true,
  areaRateAdjustment: 5,
});
assert.equal(absoluteCapRateDisplay.many.main, '50%');
assert.equal(absoluteCapRateDisplay.normal.main, '45%');
assert.ok(!(absoluteCapRateDisplay.many.note ?? '').includes('55%'));
console.log('PASS: 通常値引きは雨雪補正やエリア補正込みでも50%を超えない');
passed += 1;






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
      ryomi: { areaId: 'ryomi', status: 'skipped_manual', areaJudge: null },
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
      'ryomi',
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
      'ryomi',
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
      ryomi: { areaId: 'ryomi', status: 'skipped_manual', areaJudge: null },
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
      'ryomi',
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
      'ryomi',
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
      ryomi: { areaId: 'ryomi', status: 'skipped_manual', areaJudge: null },
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
      'ryomi',
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
      ryomi: { areaId: 'ryomi', status: 'skipped_manual', areaJudge: null },
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
      'ryomi',
      'chuka_fish',
      'yakitori',
      'fry_chicken',
      'croquette',
      'tempura',
      'bento_men',
    ],
  });

  assert.equal(candidate?.areaId, 'ryomi');
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
    'chuka_fish',
    'yakitori',
    'fry_chicken',
    'croquette',
    'ryomi',
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
      ryomi: 'just_right',
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
  assert.equal(payload.dataSchemaVersion, 2);
  assert.ok(payload.appVersion);
  assert.equal(payload.dataQuality.recordedCount, 10);
  assert.equal(payload.dataQuality.notApplicableCount, 0);

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

const totalChecks = 92;


{
  const historicalDates = ['2026-06-19', '2026-06-26', '2026-07-03'];
  const records = historicalDates.flatMap((date, index) => [
    {
      date,
      sessionStartedAt: `${date}T08:00:00.000Z`,
      recordedAt: `${date}T10:00:00.000Z`,
      areaId: 'bento_men' as const,
      discountTime: '19' as const,
      actualWeekday: '金' as const,
      actualWeekdayGroup: '金土日' as const,
      count: 98 + index * 2,
    },
  ]);
  const recommendation = getAreaCountRecommendation({
    records,
    areaId: 'bento_men',
    discountTime: '19',
    weekday: 5,
    date: '2026-07-10',
    count: 130,
  });
  const basis = buildAreaCountDecisionBasis({
    recommendation,
    evaluationSource: 'history',
    finalEvaluation: recommendation.suggestedEvaluation,
    areaRateAdjustment: recommendation.areaRateAdjustment,
  });
  const normalized = normalizeAreaCountRecords([{
    date: '2026-07-10',
    sessionStartedAt: '2026-07-10T08:00:00.000Z',
    recordedAt: '2026-07-10T10:00:00.000Z',
    areaId: 'bento_men',
    discountTime: '19',
    actualWeekday: '金',
    actualWeekdayGroup: '金土日',
    count: 130,
    evaluationSource: 'history',
    decisionBasis: basis,
  }]);

  assert.equal(normalized[0]?.evaluationSource, 'history');
  assert.equal(normalized[0]?.decisionBasis?.recommendationStatus, 'ready');
  assert.equal(normalized[0]?.decisionBasis?.medianCount, 100);
  assert.equal(normalized[0]?.decisionBasis?.comparisonMode, 'weekday');
  assert.equal(normalized[0]?.decisionBasis?.finalEvaluation, 'many');

  const repackRecommendation = getAreaCountRecommendation({
    records: historicalDates.map((date) => ({
      date,
      sessionStartedAt: `${date}T08:00:00.000Z`,
      recordedAt: `${date}T09:00:00.000Z`,
      areaId: 'bento_men',
      discountTime: '18',
      actualWeekday: '金',
      actualWeekdayGroup: '金土日',
      count: 100,
    })),
    areaId: 'bento_men',
    discountTime: '18',
    weekday: 5,
    date: '2026-07-10',
    count: 120,
  });
  assert.equal(repackRecommendation.decreaseRecommendation?.previousDiscountTime, undefined);

  const addedProductionRecommendation = getAreaCountRecommendation({
    records: historicalDates.map((date) => ({
      date,
      sessionStartedAt: `${date}T08:00:00.000Z`,
      recordedAt: `${date}T09:00:00.000Z`,
      areaId: 'ryomi',
      discountTime: '17',
      actualWeekday: '金',
      actualWeekdayGroup: '金土日',
      count: 100,
    })),
    areaId: 'ryomi',
    discountTime: '17',
    weekday: 5,
    date: '2026-07-10',
    count: 120,
  });
  assert.equal(addedProductionRecommendation.decreaseRecommendation?.previousDiscountTime, undefined);
  passed += 1;
}


{
  const date = '2026-07-15';
  const missingAreaId = NORMAL_ROUTE.at(-1) as AreaId;
  const areaCounts = Object.fromEntries(
    NORMAL_ROUTE.filter((areaId) => areaId !== missingAreaId).map((areaId, index) => [areaId, index]),
  ) as Partial<Record<AreaId, number>>;
  const normalized = normalizeReview19Result({
    date,
    sessionStartedAt: '2026-07-15T08:00:00.000Z',
    reviewStartedAt: '2026-07-15T10:00:00.000Z',
    areaCountRecordedAt: { bento_men: '2026-07-15T10:01:00.000Z' },
    ratingStatus: 'not_collected',
    ratings: null,
    ratingScores: null,
    areaCounts,
    excludedAreaIds: [],
    excludeReasons: {},
    recordedAt: '2026-07-15T10:10:00.000Z',
  });

  assert.equal(normalized?.reviewCompletedAt, '2026-07-15T10:10:00.000Z');
  assert.equal(normalized?.areaCountRecordedAt.bento_men, '2026-07-15T10:01:00.000Z');
  assert.equal(normalized?.dataQuality.complete, false);
  assert.deepEqual(normalized?.dataQuality.missingAreaIds, [missingAreaId]);

  const completedQuality = buildReview19DataQuality({
    date,
    areaCounts,
    excludedAreaIds: [missingAreaId],
  });
  assert.equal(completedQuality.complete, true);
  assert.equal(completedQuality.recordedAreaCount + completedQuality.excludedAreaCount, NORMAL_ROUTE.length);
  passed += 1;
}


{
  const normalized = normalizeAreaCountRecords([
    {
      date: '2026-07-10',
      sessionStartedAt: '2026-07-10T07:47:18.899Z',
      recordedAt: '2026-07-10T08:00:00.000Z',
      areaId: 'bento_men',
      discountTime: '17',
      actualWeekdayGroup: '金土日',
      count: 146,
      userJudge: 'slightly_many',
      suggestedEvaluation: 'slightly_many',
      areaRateAdjustment: 5,
    },
  ]);
  assert.equal(normalized[0]?.userJudge, 'slightly_many');
  passed += 1;
}

{
  const baseSnapshot = {
    version: 1 as const,
    capturedAt: '2026-07-10T09:00:00.000Z',
    rateLogicVersion: 'time_basic_rate_v1' as const,
    screen: 'done' as const,
    session: {
      date: '2026-07-10',
      weekday: 5,
      discountTime: '15' as const,
      startedAt: '2026-07-10T05:42:33.928Z',
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
      resolvedWeather: resolveWeatherInputForDiscount(
        { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
        '15'
      ),
    },
    basis: {
      rateLogicVersion: 'time_basic_rate_v1' as const,
      baseRateBonus: 0,
      lateTimeBonus: 0,
      totalRateBonus: 0,
      baseRateBonusReason: [],
    },
    areas: {} as never,
    doneSummaryItems: [],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  };
  assert.equal(isDailySessionSnapshotDateConsistent(baseSnapshot), true);
  assert.equal(
    isDailySessionSnapshotDateConsistent({
      ...baseSnapshot,
      session: { ...baseSnapshot.session, startedAt: '2026-07-09T08:06:25.060Z' },
    }),
    false
  );
  passed += 1;
}

{
  const currentDayState = makeState({
    session: {
      ...makeState({}).session!,
      date: '2026-07-10',
      startedAt: '2026-07-10T07:47:18.899Z',
    },
  });
  const previousDayState = makeState({
    screen: 'done',
    session: {
      ...makeState({}).session!,
      date: '2026-07-09',
      startedAt: '2026-07-09T08:06:25.060Z',
    },
  });

  assert.equal(isAppStateSessionCurrentForDate(currentDayState, '2026-07-10'), true);
  assert.equal(isAppStateSessionCurrentForDate(previousDayState, '2026-07-10'), false);
  passed += 1;
}

{
  const previousDayState = makeState({
    screen: 'done',
    session: {
      ...makeState({}).session!,
      date: '2026-07-10',
      startedAt: '2026-07-09T08:06:25.060Z',
    },
  });
  const runtimeState = {
    areaJudgeSelection: null,
    resumeTargetScreen: 'done' as const,
    timeSwitchTarget: null,
    undoSnapshot: null,
    screenHistory: [],
  };
  const sanitized = sanitizePersistedNebikiStateForDate(
    {
      currentSession: previousDayState,
      workSessionCheckpoint: previousDayState,
      runtimeState,
      nextSessionSkipRecords: [],
      lastSessionWeather: null,
      lastUsedSessionDraft: null,
      dailyMessageState: { date: '2026-07-10', shownMessageIds: [] },
    },
    '2026-07-10'
  );

  assert.equal(sanitized.currentSession, null);
  assert.equal(sanitized.workSessionCheckpoint, null);
  assert.equal(sanitized.runtimeState, null);
  passed += 1;
}


{
  const at = (hours: number, minutes: number) =>
    new Date(2026, 6, 12, hours, minutes, 0, 0).getTime();

  assert.equal(
    getEarlyNextMinus5TargetDiscountTime({
      discountTime: '17',
      manualDiscountTimeOverride: false,
      nowMs: at(17, 59),
    }),
    null
  );
  assert.equal(
    getEarlyNextMinus5TargetDiscountTime({
      discountTime: '17',
      manualDiscountTimeOverride: false,
      nowMs: at(18, 0),
    }),
    '18'
  );
  assert.equal(
    getEarlyNextMinus5TargetDiscountTime({
      discountTime: '17',
      manualDiscountTimeOverride: false,
      nowMs: at(18, 24),
    }),
    '18'
  );
  assert.equal(
    getEarlyNextMinus5TargetDiscountTime({
      discountTime: '17',
      manualDiscountTimeOverride: false,
      nowMs: at(18, 25),
    }),
    null
  );
  passed += 1;
}

{
  const at = (hours: number, minutes: number) =>
    new Date(2026, 6, 12, hours, minutes, 0, 0).getTime();

  assert.equal(
    getEarlyNextMinus5TargetDiscountTime({
      discountTime: '18',
      manualDiscountTimeOverride: false,
      nowMs: at(18, 59),
    }),
    null
  );
  assert.equal(
    getEarlyNextMinus5TargetDiscountTime({
      discountTime: '18',
      manualDiscountTimeOverride: false,
      nowMs: at(19, 0),
    }),
    '19'
  );
  assert.equal(
    getEarlyNextMinus5TargetDiscountTime({
      discountTime: '18',
      manualDiscountTimeOverride: false,
      nowMs: at(19, 24),
    }),
    '19'
  );
  assert.equal(
    getEarlyNextMinus5TargetDiscountTime({
      discountTime: '18',
      manualDiscountTimeOverride: false,
      nowMs: at(19, 25),
    }),
    null
  );
  passed += 1;
}

{
  const nowMs = new Date(2026, 6, 12, 19, 10, 0, 0).getTime();
  assert.equal(
    getEarlyNextMinus5TargetDiscountTime({
      discountTime: '18',
      manualDiscountTimeOverride: true,
      nowMs,
    }),
    null
  );
  assert.equal(
    getEarlyNextMinus5NoticeText('19'),
    '19時を過ぎたため、19時30分の値引率より5%弱めて表示しています。\nこのエリアは19時30分値引ではスキップします。'
  );
  assert.equal(
    getEarlyNextMinus5CompletedText('19'),
    '19:00以降に、19時30分値引率より5%弱めて値引済みです。'
  );
  passed += 1;
}

{
  assert.equal(
    shouldReserveEarlyNextMinus5OnAutoTransition({
      screen: 'rate_display',
      currentTargetDiscountTime: '19',
      nextTargetDiscountTime: '19',
    }),
    true
  );
  assert.equal(
    shouldReserveEarlyNextMinus5OnAutoTransition({
      screen: 'area_judge',
      currentTargetDiscountTime: '19',
      nextTargetDiscountTime: '19',
    }),
    false
  );
  assert.equal(
    shouldReserveEarlyNextMinus5OnAutoTransition({
      screen: 'rate_display',
      currentTargetDiscountTime: '18',
      nextTargetDiscountTime: '19',
    }),
    false
  );

  const reserved = appendSkipRecordsInMemory({
    currentRecords: [],
    recordsToAdd: [
      {
        date: '2026-07-15',
        targetDiscountTime: '19',
        areaId: 'bento_men',
        skipKind: 'early_next_minus5',
        previousNormalRateText: '25%',
      },
    ],
  });
  const consumed = consumeSkipRecordsInMemory({
    currentRecords: reserved,
    date: '2026-07-15',
    targetDiscountTime: '19',
  });
  assert.deepEqual(consumed.skippedAreaIds, ['bento_men']);
  assert.equal(consumed.skippedRecords[0]?.skipKind, 'early_next_minus5');
  assert.equal(consumed.remainingRecords.length, 0);
  passed += 1;
}



{
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
  const runtimeGlobal = globalThis as typeof globalThis & {
    window?: { sessionStorage: Storage };
  };
  runtimeGlobal.window = { sessionStorage: storage };

  const key = buildCalculatorDraftKey({
    kind: 'area-count',
    scopeId: 'session-1',
    areaId: 'bento_men',
  });
  saveCalculatorDraft(key, { text: '12+8', open: true });
  assert.deepEqual(loadCalculatorDraft(key), { text: '12+8', open: true });
  clearCalculatorDraft(key);
  assert.equal(loadCalculatorDraft(key), null);

  delete runtimeGlobal.window;
  passed += 1;
}

{
  const daySnapshot = {
    version: 1 as const,
    review19Status: 'not_performed' as const,
    capturedAt: '2026-07-14T11:30:00.000Z',
    date: '2026-07-14',
    rateLogicVersion: 'time_basic_rate_v1' as const,
    sessions: [],
    areaCountRecords: [],
  };
  const payload = buildAutomaticDayExportPayload({
    exportedAt: '2026-07-14T11:30:00.000Z',
    date: '2026-07-14',
    daySnapshot,
  });

  assert.equal(payload.format, 'nebiki-helper-day-export');
  assert.equal(payload.dataSchemaVersion, 2);
  assert.ok(payload.appVersion);
  assert.equal(payload.trigger, 'final-counts-complete');
  assert.equal(payload.daySnapshot.date, '2026-07-14');
  assert.equal(getAutomaticDayExportFilename('2026-07-14'), 'nebiki-day-2026-07-14.json');
  passed += 1;
}


{
  const date = '2026-07-14';
  const missingAreaId = NORMAL_ROUTE.at(-1) as AreaId;
  const areaCountRecords = (['15', '17', '18', '19', '20'] as DiscountTime[]).flatMap(
    (discountTime) => NORMAL_ROUTE
      .filter((areaId) => discountTime !== '15' || areaId !== missingAreaId)
      .map((areaId, index) => ({
        date,
        sessionStartedAt: `${date}T05:00:00.000Z`,
        recordedAt: `${date}T${String(6 + index).padStart(2, '0')}:00:00.000Z`,
        areaId,
        discountTime,
        actualWeekday: '火' as const,
        actualWeekdayGroup: '火木' as const,
        count: index,
      })),
  );
  areaCountRecords.push({
    ...areaCountRecords.find((record) => record.discountTime === '17' && record.areaId === 'bento_men')!,
    sessionStartedAt: `${date}T05:30:00.000Z`,
    recordedAt: `${date}T10:30:00.000Z`,
  });
  const payload = buildAutomaticDayExportPayload({
    exportedAt: `${date}T12:00:00.000Z`,
    date,
    daySnapshot: {
      version: 1,
      review19Status: 'not_performed',
      capturedAt: `${date}T12:00:00.000Z`,
      date,
      sessions: [],
      areaCountRecords,
    },
  });
  const fifteenQuality = payload.dataQuality.coverageByDiscountTime.find(
    (item) => item.discountTime === '15',
  );
  const seventeenQuality = payload.dataQuality.coverageByDiscountTime.find(
    (item) => item.discountTime === '17',
  );

  assert.equal(payload.dataQuality.complete, false);
  assert.equal(payload.dataQuality.completeDiscountTimeCount, 3);
  assert.deepEqual(fifteenQuality?.missingAreaIds, [missingAreaId]);
  assert.deepEqual(seventeenQuality?.duplicateAreaIds, ['bento_men']);
  passed += 1;
}


{
  assert.equal(parseTrainingStepFromHash('#/step1'), 'step1');
  assert.equal(parseTrainingStepFromHash('#/step6'), 'step6');
  assert.equal(parseTrainingStepFromHash('#/step8'), 'step8');
  assert.equal(parseTrainingStepFromHash(''), 'step8');

  const step2 = getTrainingStepConfig('step2');
  assert.equal(step2.showProductAmountReference, true);
  assert.equal(step2.showManyThresholdRule, false);

  const step4 = getTrainingStepConfig('step4');
  assert.equal(step4.showManyThresholdRule, true);
  assert.deepEqual(step4.noticeItemIds, [
    'twoLeftNotMany',
    'oneLeftFew',
    'step4TenOrMoreNotAlwaysMany',
  ]);

  const step5 = getTrainingStepConfig('step5');
  assert.ok(step5.noticeItemIds.includes('step4TenOrMoreNotAlwaysMany'));
  assert.ok(step5.noticeItemIds.includes('steadyStandardMinus'));
  assert.equal(step5.noticeItemIds.includes('badAppearancePlus'), false);

  const step8 = getTrainingStepConfig('step8');
  assert.equal(step8.showAdvancedReference, true);
  assert.ok(step8.noticeItemIds.includes('advertisementTrendMinus'));
  passed += 1;
}


{
  assert.equal(parseExplicitTrainingStepFromHash('#/step3'), 'step3');
  assert.equal(parseExplicitTrainingStepFromHash(''), null);
  assert.equal(isTrainingStep('step8'), true);
  assert.equal(isTrainingStep('step9'), false);
  assert.equal(isValidAdminPinFormat('1234'), true);
  assert.equal(isValidAdminPinFormat('12345678'), true);
  assert.equal(isValidAdminPinFormat('123'), false);
  assert.equal(isValidAdminPinFormat('12a4'), false);
  passed += 1;
}



console.log(`\n${passed} / ${totalChecks} checks passed.`);

process.exit(process.exitCode ?? 0);
