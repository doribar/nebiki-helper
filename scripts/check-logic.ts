import assert from 'node:assert/strict';
import {
  buildMergedBonusDisplay,
  getBasisGuideDisplay,
  getWeekdayBaseInfo,
} from '../src/domain/weekdayBase.ts';
import { getFinalTimeGuide } from '../src/domain/discount.ts';
import { shouldOfferAfterRainRecovery } from '../src/domain/afterRain.ts';
import type { DiscountTime, WeatherInput } from '../src/domain/types.ts';

type Case = {
  name: string;
  weekday: number;
  discountTime: DiscountTime;
  weather: WeatherInput;
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

function weather(partial: Partial<WeatherInput>): WeatherInput {
  return {
    nearTermWeather: 'other',
    hasLaterPrecip: false,
    laterPrecipType: null,
    windLevel: '2orLess',
    tempLevel: '11to15',
    afterRainSky: null,
    ...partial,
  };
}

const cases: Case[] = [
  {
    name: '乾いた日・基準変化なし',
    weekday: 2,
    discountTime: '15',
    weather: weather({}),
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
    weather: weather({ tempLevel: '6to10', windLevel: '3to4' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['6〜10度 +1段', '風速3m以上（15度以下） +1段'],
      weekdayResultIncludes: ['曜日基準補正は+2段', '月曜・水曜の基準を使用します'],
    },
  },
  {
    name: '超低気温で上限に当たった乾いた日は +5%',
    weekday: 1,
    discountTime: '15',
    weather: weather({ tempLevel: '5orLess' }),
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
    weather: weather({ tempLevel: '5orLess', nearTermWeather: 'rain' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 10,
      bonusCalcIncludes: ['30分〜1時間後 雨 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '16〜20度は1段弱める',
    weekday: 2,
    discountTime: '15',
    weather: weather({ tempLevel: '16to20' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['16〜20度 -1段'],
      weekdayResultIncludes: ['曜日基準補正は-1段', '金曜・土曜の基準を使用します'],
    },
  },
  {
    name: '16〜20度と風速5m以上は相殺される',
    weekday: 2,
    discountTime: '15',
    weather: weather({ tempLevel: '16to20', windLevel: '5orMore' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['16〜20度 -1段', '風速5m以上 +1段'],
      weekdayResultIncludes: ['曜日基準補正は0段', '火曜・木曜の基準のままです'],
    },
  },
  {
    name: '21〜25度で17時以降の下限に当たる乾いた日は -5%',
    weekday: 5,
    discountTime: '17',
    weather: weather({ tempLevel: '21to25' }),
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
    weather: weather({ tempLevel: '21to25' }),
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
    weather: weather({ hasLaterPrecip: true, laterPrecipType: 'rain' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 5,
      weekdayCalcIncludes: ['1時間30分後〜23時 雨 +1段'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +5%'],
    },
  },
  {
    name: '1時間30分後〜23時の雪は曜日基準を2段強める',
    weekday: 5,
    discountTime: '15',
    weather: weather({ hasLaterPrecip: true, laterPrecipType: 'snow' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['1時間30分後〜23時 雪 +2段'],
      weekdayResultIncludes: ['曜日基準補正は+2段'],
    },
  },
  {
    name: '26〜30度は補正なし',
    weekday: 2,
    discountTime: '15',
    weather: weather({ tempLevel: '26to30' }),
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
    weather: weather({ tempLevel: '31to35' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      weekdayCalcIncludes: ['31〜35度 +1段'],
    },
  },
  {
    name: '36度以上は2段強める',
    weekday: 4,
    discountTime: '15',
    weather: weather({ tempLevel: '36orMore' }),
    expected: {
      adjusted: '月水',
      baseRateBonus: 5,
      weekdayCalcIncludes: ['36度以上 +2段'],
      bonusCalcIncludes: ['曜日基準で補正しきれない分 +5%'],
    },
  },
  {
    name: '近い時間の雪は +20%',
    weekday: 2,
    discountTime: '15',
    weather: weather({ nearTermWeather: 'snow' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 20,
      bonusCalcIncludes: ['30分〜1時間後 雪 +20%'],
      bonusResultIncludes: ['値引率補正は+20%'],
    },
  },
  {
    name: '近い雨がある日は下限に当たっても -5% を入れない',
    weekday: 5,
    discountTime: '17',
    weather: weather({ tempLevel: '21to25', nearTermWeather: 'rain' }),
    expected: {
      adjusted: '金土',
      baseRateBonus: 10,
      bonusCalcIncludes: ['30分〜1時間後 雨 +10%'],
      bonusResultIncludes: ['値引率補正は+10%'],
    },
  },
  {
    name: '雨上がり後の晴れは1段弱める',
    weekday: 2,
    discountTime: '17',
    weather: weather({ afterRainSky: 'sunny' }),
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
    weather: weather({ afterRainSky: 'cloudy' }),
    expected: {
      adjusted: '火木',
      baseRateBonus: 0,
      bonusCalcAbsent: true,
    },
  },
];

let passed = 0;

for (const testCase of cases) {
  const info = getWeekdayBaseInfo(
    testCase.weekday,
    testCase.discountTime,
    testCase.weather
  );
  const guide = getBasisGuideDisplay({
    weekday: testCase.weekday,
    discountTime: testCase.discountTime,
    weather: testCase.weather,
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

console.log(`\n${passed} / ${cases.length + 2} checks passed.`);

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

console.log('PASS: 最終値引き点数ロジック');
