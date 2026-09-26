import assert from "node:assert/strict";
import { getColdDeliGuide, type ColdDeliGuide } from "../src/domain/coldDeliGuide.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import { evaluateTemperatureComfort } from "../src/domain/temperatureComfort.ts";
import type {
  DemandCycle,
  DiscountTime,
  GlobalDiscountAdjustmentPercent,
  ResolvedWeatherInput,
  WeatherInput,
} from "../src/domain/types.ts";
import { getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";

type GuideSession = NonNullable<Parameters<typeof getColdDeliGuide>[0]["session"]>;

const FRIDAY = "2026-09-04";
const THURSDAY = "2026-09-03";
const neutralWeather: ResolvedWeatherInput = {
  nearTermWeather: "other",
  hasLaterPrecip: false,
  laterPrecipType: null,
  precipitationRateBonus: 0,
  precipitationRateBonusLabel: null,
  windLevel: "2orLess",
  tempLevel: "28to30",
  weatherPointScore: 0,
  weatherPointShift: 0,
  weatherPointRangeText: null,
  next18TempDropShift: 0,
  next18WindWorsenShift: 0,
  next18WindWorsenKind: null,
  afterRainSky: null,
};

function session(patch: Partial<GuideSession> = {}): GuideSession {
  return {
    date: FRIDAY,
    weekday: 5,
    discountTime: "17",
    demandCycle: "normal",
    globalDiscountAdjustmentPercent: 0,
    ...patch,
  };
}

function guide(
  sessionPatch: Partial<GuideSession> = {},
  weatherPatch: Partial<ResolvedWeatherInput> = {},
) {
  return getColdDeliGuide({
    session: session(sessionPatch),
    resolvedWeather: { ...neutralWeather, ...weatherPatch },
    isFixedTimeMode: false,
  });
}

function expectedFifteen(
  highCount: number,
  lowCount: number,
  rates: readonly [number, number, number, number] = [20, 15, 10, 5],
): Extract<ColdDeliGuide, { discountTime: "15" }> {
  return {
    discountTime: "15", highCount, lowCount,
    highRatePercent: rates[0], highFewRatePercent: rates[1],
    lowRatePercent: rates[2], lowFewRatePercent: rates[3],
  };
}

const weatherForBonus: Record<-10 | -5 | 0 | 5 | 10, Partial<ResolvedWeatherInput>> = {
  [-10]: { tempLevel: "21to25" },
  [-5]: { tempLevel: "26to27" },
  0: {},
  5: { tempLevel: "34to35" },
  10: { tempLevel: "36orMore" },
};

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

for (const scenario of [
  { date: THURSDAY, adjustment: 0, highCount: 2, lowCount: 1 },
  { date: FRIDAY, adjustment: 0, highCount: 3, lowCount: 2 },
  { date: THURSDAY, adjustment: -5, highCount: 3, lowCount: 2 },
  { date: FRIDAY, adjustment: -5, highCount: 4, lowCount: 3 },
] as const) {
  test(`15時 ${scenario.date} 全体${scenario.adjustment}: ${scenario.highCount}個以上/${scenario.lowCount}個`, () => {
    assert.deepEqual(guide({
      discountTime: "15",
      date: scenario.date,
      globalDiscountAdjustmentPercent: scenario.adjustment,
    }), expectedFifteen(scenario.highCount, scenario.lowCount));
  });
}

test("15時の全体+5と旧session補正欠損は個数境界へ加算しない", () => {
  for (const [date, highCount] of [[THURSDAY, 2], [FRIDAY, 3]] as const) {
    for (const adjustment of [5, undefined] as const) {
      assert.deepEqual(guide({
        discountTime: "15", date, globalDiscountAdjustmentPercent: adjustment,
      }), expectedFifteen(highCount, highCount - 1,
        adjustment === 5 ? [25, 20, 15, 10] : [20, 15, 10, 5]));
    }
  }
});

for (const scenario of [
  { weatherBonus: 0, global: 0, rates: [20, 15, 10, 5], counts: [2, 3] },
  { weatherBonus: 5, global: 0, rates: [25, 20, 15, 10], counts: [2, 3] },
  { weatherBonus: 0, global: 5, rates: [25, 20, 15, 10], counts: [2, 3] },
  { weatherBonus: 5, global: 5, rates: [30, 25, 20, 15], counts: [2, 3] },
  { weatherBonus: 10, global: 5, rates: [35, 30, 25, 20], counts: [2, 3] },
  { weatherBonus: 10, global: -5, rates: [30, 25, 20, 15], counts: [3, 4] },
  { weatherBonus: -10, global: 5, rates: [25, 20, 15, 10], counts: [2, 3] },
  { weatherBonus: -10, global: -5, rates: [20, 15, 10, 5], counts: [3, 4] },
] as const) {
  test(`15時 天候${scenario.weatherBonus}/全体${scenario.global}を相殺せず4率へ加算`, () => {
    for (const demandCycle of ["normal", "summer"] as const) {
      [THURSDAY, FRIDAY].forEach((date, index) => {
        const weather = { ...neutralWeather, ...weatherForBonus[scenario.weatherBonus] };
        assert.equal(getWeekdayBaseInfo(5, "15", weather, date, demandCycle).baseRateBonus,
          scenario.weatherBonus);
        const highCount = scenario.counts[index];
        assert.deepEqual(guide({
          date, discountTime: "15", demandCycle,
          globalDiscountAdjustmentPercent: scenario.global,
        }, weather), expectedFifteen(highCount, highCount - 1, scenario.rates));
      });
    }
  });
}

for (const scenario of [
  { weatherBonus: 0, global: 0, date: FRIDAY, rate: 30 },
  { weatherBonus: 5, global: 0, date: FRIDAY, rate: 35 },
  { weatherBonus: 0, global: 5, date: FRIDAY, rate: 35 },
  { weatherBonus: 10, global: 5, date: FRIDAY, rate: 45 },
  { weatherBonus: 10, global: -5, date: FRIDAY, rate: 40 },
  { weatherBonus: -10, global: 0, date: FRIDAY, rate: 25 },
  { weatherBonus: -10, global: -5, date: FRIDAY, rate: 25 },
  { weatherBonus: -10, global: 5, date: FRIDAY, rate: 30 },
  { weatherBonus: -5, global: -5, date: FRIDAY, rate: 25 },
  { weatherBonus: -5, global: 0, date: FRIDAY, rate: 30 },
  { weatherBonus: -5, global: 5, date: FRIDAY, rate: 35 },
  { weatherBonus: -10, global: -5, date: THURSDAY, rate: 30 },
  { weatherBonus: -10, global: 5, date: THURSDAY, rate: 35 },
] as const) {
  test(`17時 ${scenario.date} 天候${scenario.weatherBonus}/全体${scenario.global}は判定後${scenario.rate}%`, () => {
    const weather = { ...neutralWeather, ...weatherForBonus[scenario.weatherBonus] };
    assert.equal(getWeekdayBaseInfo(5, "17", weather, scenario.date, "summer").baseRateBonus,
      scenario.weatherBonus);
    assert.deepEqual(guide({
      date: scenario.date, demandCycle: "summer",
      globalDiscountAdjustmentPercent: scenario.global,
    }, weather), { discountTime: "17", ratePercent: scenario.rate });
  });
}

for (const scenario of [
  { name: "翌日土曜", date: "2026-09-04", holiday: true },
  { name: "翌日日曜", date: "2026-09-05", holiday: true },
  { name: "翌日平日", date: "2026-09-06", holiday: false },
  { name: "翌日法定祝日", date: "2026-02-10", holiday: true },
  { name: "翌日振替休日", date: "2024-02-11", holiday: true },
  { name: "翌日国民の休日", date: "2026-09-21", holiday: true },
  { name: "年跨ぎの元日", date: "2026-12-31", holiday: true },
  { name: "翌日お盆だけの平日", date: "2026-08-12", holiday: false },
  { name: "翌日お盆と土曜", date: "2026-08-14", holiday: true },
] as const) {
  test(`${scenario.name}は実日付で判定し手動weekdayを参照しない`, () => {
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      assert.deepEqual(guide({
        date: scenario.date, weekday, discountTime: "15",
      }), expectedFifteen(scenario.holiday ? 3 : 2, scenario.holiday ? 2 : 1));
      assert.deepEqual(guide({
        date: scenario.date, weekday, globalDiscountAdjustmentPercent: -5,
      }, { tempLevel: "21to25" }), {
        discountTime: "17", ratePercent: scenario.holiday ? 25 : 30,
      });
    }
  });
}

type WeatherCase = {
  name: string;
  demandCycle: DemandCycle;
  weather: Partial<ResolvedWeatherInput>;
  bonus: number;
  rates: readonly [number, number, number];
  weekdayRates: readonly [number, number, number];
};
const weatherCases: WeatherCase[] = [
  { name: "通常・無補正", demandCycle: "normal", weather: {}, bonus: 0, rates: [30, 30, 35], weekdayRates: [30, 30, 35] },
  { name: "通常・快適乾燥", demandCycle: "normal", weather: { tempLevel: "21to25" }, bonus: -5, rates: [25, 30, 35], weekdayRates: [30, 30, 35] },
  { name: "夏・超快適乾燥", demandCycle: "summer", weather: { tempLevel: "21to25" }, bonus: -10, rates: [25, 25, 30], weekdayRates: [30, 30, 35] },
  { name: "夏・快適乾燥", demandCycle: "summer", weather: { tempLevel: "26to27" }, bonus: -5, rates: [25, 30, 35], weekdayRates: [30, 30, 35] },
  { name: "夏・無補正", demandCycle: "summer", weather: {}, bonus: 0, rates: [30, 30, 35], weekdayRates: [30, 30, 35] },
  { name: "通常・快適でも雨", demandCycle: "normal", weather: { tempLevel: "21to25", nearTermWeather: "rain", precipitationRateBonus: 5 }, bonus: 5, rates: [35, 35, 40], weekdayRates: [35, 35, 40] },
  { name: "夏・超快適でも継続雨", demandCycle: "summer", weather: { tempLevel: "21to25", nearTermWeather: "rain", precipitationRateBonus: 10 }, bonus: 10, rates: [40, 40, 45], weekdayRates: [40, 40, 45] },
  { name: "夏・雪", demandCycle: "summer", weather: { tempLevel: "21to25", nearTermWeather: "snow", precipitationRateBonus: 15 }, bonus: 15, rates: [45, 45, 50], weekdayRates: [45, 45, 50] },
  { name: "通常・暑い", demandCycle: "normal", weather: { tempLevel: "36orMore" }, bonus: 10, rates: [40, 40, 45], weekdayRates: [40, 40, 45] },
];

for (const scenario of weatherCases) {
  test(`17時 ${scenario.name}: 全体-5/0/+5と翌日休日の組合せ`, () => {
    const weather = { ...neutralWeather, ...scenario.weather };
    assert.equal(getWeekdayBaseInfo(5, "17", weather, FRIDAY, scenario.demandCycle).baseRateBonus, scenario.bonus);
    const adjustments: GlobalDiscountAdjustmentPercent[] = [-5, 0, 5];
    adjustments.forEach((adjustment, index) => {
      assert.deepEqual(guide({
        demandCycle: scenario.demandCycle, globalDiscountAdjustmentPercent: adjustment,
      }, scenario.weather), { discountTime: "17", ratePercent: scenario.rates[index] });
      assert.deepEqual(guide({
        date: THURSDAY, demandCycle: scenario.demandCycle,
        globalDiscountAdjustmentPercent: adjustment,
      }, scenario.weather), { discountTime: "17", ratePercent: scenario.weekdayRates[index] });
    });
  });
}

test("17時は全体補正欠損を-5と見なさず、cycle欠損は既存normal互換", () => {
  assert.deepEqual(guide({ globalDiscountAdjustmentPercent: undefined }, {
    tempLevel: "21to25",
  }), { discountTime: "17", ratePercent: 30 });
  assert.deepEqual(guide({ demandCycle: undefined, globalDiscountAdjustmentPercent: -5 }, {
    tempLevel: "21to25",
  }), { discountTime: "17", ratePercent: 25 });
  assert.deepEqual(guide({ discountTime: "15", globalDiscountAdjustmentPercent: undefined }, {
    tempLevel: "36orMore",
  }), expectedFifteen(3, 2, [30, 25, 20, 15]));
  assert.deepEqual(guide({ globalDiscountAdjustmentPercent: undefined }, {
    tempLevel: "36orMore",
  }), { discountTime: "17", ratePercent: 40 });
});

test("15/17時はnormal/summerそれぞれの既存時間別天候の合計補正を使う", () => {
  for (const demandCycle of ["normal", "summer"] as const) {
    for (const weatherKind of ["sunny", "rain"] as const) {
      const hourlyForecasts = createDefaultHourlyForecasts();
      for (const entry of Object.values(hourlyForecasts)) {
        entry.weather = weatherKind;
        entry.tempC = 25;
        entry.windMs = 2;
      }
      const raw: WeatherInput = { hourlyForecasts, afterRainSky: null };
      for (const discountTime of ["15", "17"] as const) {
        const resolvedWeather = resolveWeatherInputForDiscount(raw, discountTime);
        const bonus = weatherKind === "rain"
          ? discountTime === "15" ? 5 : 10
          : discountTime === "15" || demandCycle === "summer" ? -10 : -5;
        assert.equal(getWeekdayBaseInfo(5, discountTime, resolvedWeather, FRIDAY, demandCycle).baseRateBonus,
          bonus);
        assert.deepEqual(getColdDeliGuide({
          session: session({ discountTime, demandCycle, globalDiscountAdjustmentPercent: 5 }),
          resolvedWeather, isFixedTimeMode: false,
        }), discountTime === "15"
          ? expectedFifteen(3, 2, weatherKind === "rain" ? [30, 25, 20, 15] : [25, 20, 15, 10])
          : { discountTime: "17", ratePercent: weatherKind === "rain" ? 45 : demandCycle === "summer" ? 30 : 35 });
      }
    }
  }
});

test("17時は気温低下snapshotを含む既存補正値を使用する", () => {
  const temperatureComfortAnalysis = evaluateTemperatureComfort({
    date: FRIDAY, discountTime: "17", tempLevel: "34to35",
    previous: { date: FRIDAY, discountTime: "15", tempLevel: "36orMore", temperatureFalling: false },
  });
  assert.equal(temperatureComfortAnalysis.temperaturePointSuppressed, true);
  const weather: ResolvedWeatherInput = {
    ...neutralWeather, tempLevel: "34to35", weatherPointShift: -1,
    weatherPointScore: 6, weatherPointRangeText: "19〜21時",
  };
  assert.deepEqual(guide({ globalDiscountAdjustmentPercent: -5 }, weather), {
    discountTime: "17", ratePercent: 30,
  });
  assert.deepEqual(guide({ globalDiscountAdjustmentPercent: -5 }, {
    ...weather, temperatureComfortAnalysis,
  }), { discountTime: "17", ratePercent: 25 });
});

test("15時はnormal/summerや天候補正を個数条件へ適用しない", () => {
  for (const demandCycle of ["normal", "summer"] as const) {
    for (const tempLevel of ["21to25", "36orMore"] as const) {
      assert.deepEqual(guide({
        discountTime: "15", demandCycle, globalDiscountAdjustmentPercent: -5,
      }, { tempLevel }), expectedFifteen(4, 3,
        tempLevel === "36orMore" ? [30, 25, 20, 15] : [20, 15, 10, 5]));
    }
  }
});

test("15時の雨+5と快適度-5は合計0として扱い、雨のプラスだけを再加算しない", () => {
  const weather: ResolvedWeatherInput = {
    ...neutralWeather, nearTermWeather: "rain", precipitationRateBonus: 5,
    tempLevel: "21to25",
  };
  for (const demandCycle of ["normal", "summer"] as const) {
    assert.equal(getWeekdayBaseInfo(5, "15", weather, FRIDAY, demandCycle).baseRateBonus, 0);
    assert.deepEqual(guide({
      discountTime: "15", demandCycle, globalDiscountAdjustmentPercent: 5,
    }, weather), expectedFifteen(3, 2, [25, 20, 15, 10]));
  }
});

test("風と未来天候を含む既存補正の合計を使い、個々のプラス要素を足し直さない", () => {
  const weather: ResolvedWeatherInput = {
    ...neutralWeather, windLevel: "5orMore", weatherPointShift: -1,
    weatherPointScore: 6, weatherPointRangeText: "19〜21時",
  };
  for (const demandCycle of ["normal", "summer"] as const) {
    for (const discountTime of ["15", "17"] as const) {
      assert.equal(getWeekdayBaseInfo(5, discountTime, weather, FRIDAY, demandCycle).baseRateBonus, 0);
      assert.deepEqual(guide({
        discountTime, demandCycle, globalDiscountAdjustmentPercent: 5,
      }, weather), discountTime === "15"
        ? expectedFifteen(3, 2, [25, 20, 15, 10])
        : { discountTime: "17", ratePercent: 35 });
    }
  }
});

test("15/17時の気温snapshotを既存補正に反映してからプラス分を加算する", () => {
  for (const discountTime of ["15", "17"] as const) {
    const temperatureComfortAnalysis = evaluateTemperatureComfort({
      date: FRIDAY, discountTime, tempLevel: "34to35",
      previous: { date: FRIDAY, discountTime: "15", tempLevel: "36orMore", temperatureFalling: false },
    });
    assert.equal(temperatureComfortAnalysis.temperaturePointSuppressed, discountTime === "17");
    const weather: ResolvedWeatherInput = {
      ...neutralWeather, tempLevel: "34to35", temperatureComfortAnalysis,
    };
    assert.equal(getWeekdayBaseInfo(5, discountTime, weather, FRIDAY, "normal").baseRateBonus,
      discountTime === "15" ? 5 : 0);
    assert.deepEqual(guide({ discountTime, globalDiscountAdjustmentPercent: 5 }, weather),
      discountTime === "15"
        ? expectedFifteen(3, 2, [30, 25, 20, 15])
        : { discountTime: "17", ratePercent: 35 });
  }
});

test("既存の継続雪W=+20は全体-5/0/+5の全てで17時の最終率が50%となる", () => {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const entry of Object.values(hourlyForecasts)) {
    entry.weather = "snow";
    entry.tempC = 25;
    entry.windMs = 2;
  }
  for (const discountTime of ["15", "17"] as const) {
    const resolvedWeather = resolveWeatherInputForDiscount({ hourlyForecasts, afterRainSky: null }, discountTime);
    assert.equal(getWeekdayBaseInfo(5, discountTime, resolvedWeather, FRIDAY, "normal").baseRateBonus, 20);
    for (const globalDiscountAdjustmentPercent of [-5, 0, 5] as const) {
      assert.deepEqual(getColdDeliGuide({
        session: session({ discountTime, globalDiscountAdjustmentPercent }),
        resolvedWeather, isFixedTimeMode: false,
      }), discountTime === "15"
        ? expectedFifteen(globalDiscountAdjustmentPercent === -5 ? 4 : 3,
          globalDiscountAdjustmentPercent === -5 ? 3 : 2,
          globalDiscountAdjustmentPercent === 5 ? [45, 40, 35, 30] : [40, 35, 30, 25])
        : { discountTime: "17", ratePercent: 50 });
    }
  }
});

// Real hourly-weather inputs currently produce at most W=20. These deliberately
// synthetic resolved-weather fixtures exercise each final-rate cap independently
// through the existing numeric weather field, without production hooks or changes.
for (const scenario of [
  { bonus: 29.5, rates: [49.5, 44.5, 39.5, 34.5] },
  { bonus: 30, rates: [50, 45, 40, 35] },
  { bonus: 30.5, rates: [50, 45.5, 40.5, 35.5] },
  { bonus: 34.5, rates: [50, 49.5, 44.5, 39.5] },
  { bonus: 35, rates: [50, 50, 45, 40] },
  { bonus: 35.5, rates: [50, 50, 45.5, 40.5] },
  { bonus: 39.5, rates: [50, 50, 49.5, 44.5] },
  { bonus: 40, rates: [50, 50, 50, 45] },
  { bonus: 40.5, rates: [50, 50, 50, 45.5] },
  { bonus: 44.5, rates: [50, 50, 50, 49.5] },
  { bonus: 45, rates: [50, 50, 50, 50] },
  { bonus: 45.5, rates: [50, 50, 50, 50] },
] as const) {
  test(`15時 synthetic resolved weatherの追加${scenario.bonus}で各率を独立に50%上限とする`, () => {
    for (const demandCycle of ["normal", "summer"] as const) {
      for (const global of [-5, 0, 5] as const) {
        const weather: ResolvedWeatherInput = {
          ...neutralWeather, nearTermWeather: "rain",
          precipitationRateBonus: scenario.bonus - Math.max(global, 0),
        };
        assert.equal(getWeekdayBaseInfo(5, "15", weather, FRIDAY, demandCycle).baseRateBonus,
          scenario.bonus - Math.max(global, 0));
        const highCount = global === -5 ? 4 : 3;
        assert.deepEqual(guide({
          discountTime: "15", demandCycle, globalDiscountAdjustmentPercent: global,
        }, weather), expectedFifteen(highCount, highCount - 1, scenario.rates));
      }
    }
  });
}

test("17時 synthetic resolved weatherの49.5/50/50.5%を丸めず最後に上限制御する", () => {
  for (const global of [-5, 0, 5] as const) {
    for (const [addition, expected] of [[19.5, 49.5], [20, 50], [20.5, 50]] as const) {
      const weather: ResolvedWeatherInput = {
        ...neutralWeather, nearTermWeather: "rain",
        precipitationRateBonus: addition - Math.max(global, 0),
      };
      assert.equal(getWeekdayBaseInfo(5, "17", weather, FRIDAY, "normal").baseRateBonus,
        addition - Math.max(global, 0));
      assert.deepEqual(guide({ globalDiscountAdjustmentPercent: global }, weather),
        { discountTime: "17", ratePercent: expected });
    }
  }
});

test("既存天候経路の数値へ冷惣菜独自の丸めを追加しない", () => {
  const weather: ResolvedWeatherInput = {
    ...neutralWeather, nearTermWeather: "rain", precipitationRateBonus: 0.5,
  };
  assert.equal(getWeekdayBaseInfo(5, "15", weather, FRIDAY, "normal").baseRateBonus, 0.5);
  assert.deepEqual(guide({ discountTime: "15", globalDiscountAdjustmentPercent: 5 }, weather),
    expectedFifteen(3, 2, [25.5, 20.5, 15.5, 10.5]));
  assert.deepEqual(guide({ globalDiscountAdjustmentPercent: 5 }, weather),
    { discountTime: "17", ratePercent: 35.5 });
});

test("fixed-time・session未開始・18:30/19:30/20:30は天候を読まず対象外", () => {
  const mustNotReadWeather = new Proxy(neutralWeather, {
    get() { throw new Error("対象外では天候を参照しない"); },
  });
  const times: DiscountTime[] = ["15", "17", "18", "19", "20"];
  for (const discountTime of times) {
    assert.equal(getColdDeliGuide({
      session: session({ discountTime }), resolvedWeather: mustNotReadWeather, isFixedTimeMode: true,
    }), null);
    if (discountTime !== "15" && discountTime !== "17") {
      assert.equal(getColdDeliGuide({
        session: session({ discountTime }), resolvedWeather: mustNotReadWeather, isFixedTimeMode: false,
      }), null);
    }
  }
  assert.equal(getColdDeliGuide({
    session: null, resolvedWeather: mustNotReadWeather, isFixedTimeMode: false,
  }), null);
});

test("AreaCount・中央値・商品属性・数量・quick/decrease・raw天候を参照しない", () => {
  function forbidOtherFields<T extends object>(value: T): T {
    for (const field of [
      "areaCount", "areaCountRecords", "areaProgressMap", "currentAreaId", "areaJudge",
      "areaCountEvaluation", "areaRateAdjustment", "humanEvaluationDetails",
      "areaCountAdjustmentPercent", "evaluationAdjustment", "quickAdjustment",
      "decrease", "decreaseAdjustment", "medianCount", "history", "snapshots",
      "productAdjustmentPolicy", "productPolicy", "productCount", "quantity",
      "lateTimeBonus", "earlyNextMinus5Info", "rateOffsetPercent", "weather",
      "temperatureComfortAnalysis",
    ]) {
      Object.defineProperty(value, field, {
        get() { throw new Error(`冷惣菜ガイドから${field}を参照した`); },
      });
    }
    return value;
  }
  for (const discountTime of ["15", "17"] as const) {
    const input = forbidOtherFields({
      session: forbidOtherFields(session({ discountTime })),
      resolvedWeather: neutralWeather, isFixedTimeMode: false,
    });
    assert.deepEqual(getColdDeliGuide(input), discountTime === "15"
      ? expectedFifteen(3, 2)
      : { discountTime: "17", ratePercent: 30 });
  }
});

test("表示計算はlocalStorage・sessionStorage・IndexedDBへアクセスしない", () => {
  const storageNames = ["localStorage", "sessionStorage", "indexedDB"] as const;
  const original = storageNames.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  try {
    for (const name of storageNames) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { throw new Error(`冷惣菜ガイドから${name}へアクセスした`); },
      });
    }
    assert.deepEqual(guide({ discountTime: "15" }), expectedFifteen(3, 2));
    assert.deepEqual(guide({ demandCycle: "summer" }, { tempLevel: "21to25" }), {
      discountTime: "17", ratePercent: 25,
    });
  } finally {
    storageNames.forEach((name, index) => {
      const descriptor = original[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});

test("繰返し計算は入力・解決済み天候・気温snapshotを変更しない", () => {
  const analysis = Object.freeze(evaluateTemperatureComfort({
    date: FRIDAY, discountTime: "17", tempLevel: "21to25",
  }));
  for (const discountTime of ["15", "17"] as const) {
    const input = Object.freeze({
      session: Object.freeze(session({ discountTime, demandCycle: "summer" })),
      resolvedWeather: Object.freeze({
        ...neutralWeather, tempLevel: "21to25" as const, temperatureComfortAnalysis: analysis,
      }),
      isFixedTimeMode: false,
    });
    const before = JSON.stringify(input);
    for (let index = 0; index < 3; index += 1) {
      assert.deepEqual(getColdDeliGuide(input), discountTime === "15"
        ? expectedFifteen(3, 2)
        : { discountTime: "17", ratePercent: 25 });
    }
    assert.equal(JSON.stringify(input), before);
  }
});

console.log(`Cold deli guide checks passed: ${passed}/${passed}`);
