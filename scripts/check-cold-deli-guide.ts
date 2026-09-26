import assert from "node:assert/strict";
import { getColdDeliGuide } from "../src/domain/coldDeliGuide.ts";
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
    }), {
      discountTime: "15", highCount: scenario.highCount, lowCount: scenario.lowCount,
    });
  });
}

test("15時の全体+5と旧session補正欠損は個数境界へ加算しない", () => {
  for (const [date, highCount] of [[THURSDAY, 2], [FRIDAY, 3]] as const) {
    for (const adjustment of [5, undefined] as const) {
      assert.deepEqual(guide({
        discountTime: "15", date, globalDiscountAdjustmentPercent: adjustment,
      }), { discountTime: "15", highCount, lowCount: highCount - 1 });
    }
  }
});

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
      }), {
        discountTime: "15",
        highCount: scenario.holiday ? 3 : 2,
        lowCount: scenario.holiday ? 2 : 1,
      });
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
  rates: readonly [25 | 30, 25 | 30, 25 | 30];
};
const weatherCases: WeatherCase[] = [
  { name: "通常・無補正", demandCycle: "normal", weather: {}, bonus: 0, rates: [30, 30, 30] },
  { name: "通常・快適乾燥", demandCycle: "normal", weather: { tempLevel: "21to25" }, bonus: -5, rates: [25, 30, 30] },
  { name: "夏・超快適乾燥", demandCycle: "summer", weather: { tempLevel: "21to25" }, bonus: -10, rates: [25, 25, 25] },
  { name: "夏・快適乾燥", demandCycle: "summer", weather: { tempLevel: "26to27" }, bonus: -5, rates: [25, 30, 30] },
  { name: "夏・無補正", demandCycle: "summer", weather: {}, bonus: 0, rates: [30, 30, 30] },
  { name: "通常・快適でも雨", demandCycle: "normal", weather: { tempLevel: "21to25", nearTermWeather: "rain", precipitationRateBonus: 5 }, bonus: 5, rates: [30, 30, 30] },
  { name: "夏・超快適でも継続雨", demandCycle: "summer", weather: { tempLevel: "21to25", nearTermWeather: "rain", precipitationRateBonus: 10 }, bonus: 10, rates: [30, 30, 30] },
  { name: "夏・雪", demandCycle: "summer", weather: { tempLevel: "21to25", nearTermWeather: "snow", precipitationRateBonus: 15 }, bonus: 15, rates: [30, 30, 30] },
  { name: "通常・暑い", demandCycle: "normal", weather: { tempLevel: "36orMore" }, bonus: 10, rates: [30, 30, 30] },
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
      }, scenario.weather), { discountTime: "17", ratePercent: 30 });
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
});

test("17時は既存時間別天候を再解決せずnormal/summerの乾燥・雨を使う", () => {
  for (const demandCycle of ["normal", "summer"] as const) {
    for (const weatherKind of ["sunny", "rain"] as const) {
      const hourlyForecasts = createDefaultHourlyForecasts();
      for (const entry of Object.values(hourlyForecasts)) {
        entry.weather = weatherKind;
        entry.tempC = 25;
        entry.windMs = 2;
      }
      const raw: WeatherInput = { hourlyForecasts, afterRainSky: null };
      const resolvedWeather = resolveWeatherInputForDiscount(raw, "17");
      assert.equal(getWeekdayBaseInfo(5, "17", resolvedWeather, FRIDAY, demandCycle).baseRateBonus,
        weatherKind === "rain" ? 10 : demandCycle === "summer" ? -10 : -5);
      assert.deepEqual(getColdDeliGuide({
        session: session({ demandCycle }), resolvedWeather, isFixedTimeMode: false,
      }), {
        discountTime: "17",
        ratePercent: demandCycle === "summer" && weatherKind === "sunny" ? 25 : 30,
      });
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
  const mustNotReadWeather = new Proxy(neutralWeather, {
    get() { throw new Error("15時の冷惣菜ガイドは天候を参照しない"); },
  });
  for (const demandCycle of ["normal", "summer"] as const) {
    assert.deepEqual(getColdDeliGuide({
      session: session({ discountTime: "15", demandCycle, globalDiscountAdjustmentPercent: -5 }),
      resolvedWeather: mustNotReadWeather, isFixedTimeMode: false,
    }), { discountTime: "15", highCount: 4, lowCount: 3 });
  }
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
      ? { discountTime: "15", highCount: 3, lowCount: 2 }
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
    assert.deepEqual(guide({ discountTime: "15" }), {
      discountTime: "15", highCount: 3, lowCount: 2,
    });
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
        ? { discountTime: "15", highCount: 3, lowCount: 2 }
        : { discountTime: "17", ratePercent: 25 });
    }
    assert.equal(JSON.stringify(input), before);
  }
});

console.log(`Cold deli guide checks passed: ${passed}/31`);
