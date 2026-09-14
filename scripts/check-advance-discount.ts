import assert from "node:assert/strict";
import { getAdvanceDiscountRate } from "../src/domain/advanceDiscount.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import { evaluateTemperatureComfort } from "../src/domain/temperatureComfort.ts";
import type {
  DiscountTime,
  GlobalDiscountAdjustmentPercent,
  ResolvedWeatherInput,
  WeatherInput,
} from "../src/domain/types.ts";

type AdvanceDiscountSession = NonNullable<
  Parameters<typeof getAdvanceDiscountRate>[0]["session"]
>;

const DATE = "2026-09-08";
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

function session(
  discountTime: DiscountTime = "17",
  adjustment: GlobalDiscountAdjustmentPercent = 0,
): AdvanceDiscountSession {
  return {
    date: DATE,
    weekday: 2,
    discountTime,
    globalDiscountAdjustmentPercent: adjustment,
  };
}

function rate(
  discountTime: DiscountTime,
  weather: Partial<ResolvedWeatherInput> = {},
  adjustment: GlobalDiscountAdjustmentPercent = 0,
): number | null {
  return getAdvanceDiscountRate({
    session: session(discountTime, adjustment),
    resolvedWeather: { ...neutralWeather, ...weather },
    isFixedTimeMode: false,
  });
}

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

test("15時・17時は基本率に商品が多い固定10ポイントだけを足す", () => {
  assert.equal(rate("15"), 10);
  assert.equal(rate("17"), 20);
});

test("session開始時の全体補正-5/0/+5を一度だけ適用する", () => {
  assert.deepEqual(
    ([-5, 0, 5] as const).map((value) => rate("15", {}, value)),
    [5, 10, 15],
  );
  assert.deepEqual(
    ([-5, 0, 5] as const).map((value) => rate("17", {}, value)),
    [15, 20, 25],
  );
});

test("全体補正を持たない旧sessionは0として読む", () => {
  const legacySession = session();
  delete legacySession.globalDiscountAdjustmentPercent;
  assert.equal(getAdvanceDiscountRate({
    session: legacySession,
    resolvedWeather: neutralWeather,
    isFixedTimeMode: false,
  }), 20);
});

test("15時の快適補正は0と負の合計を0へ制限し、+5は5にする", () => {
  const comfortable = { tempLevel: "21to25" as const };
  assert.equal(rate("15", comfortable, -5), 0);
  assert.equal(rate("15", comfortable, 0), 0);
  assert.equal(rate("15", comfortable, 5), 5);
  // 17時の例: 基本10 + 天候-5 + 全体-5 + 商品が多い10 = 10%。
  assert.deepEqual(
    ([-5, 0, 5] as const).map((value) => rate("17", comfortable, value)),
    [10, 15, 20],
  );
});

test("共通の50%上限は全体補正を加算した後に一度適用する", () => {
  // 現行の通常天候では到達しない大きな補正で、共通上限と適用順を検査する。
  const aboveLimit = {
    nearTermWeather: "snow" as const,
    precipitationRateBonus: 40,
  };
  assert.equal(rate("17", aboveLimit, -5), 50);
  assert.equal(rate("17", aboveLimit, 0), 50);
  assert.equal(rate("17", aboveLimit, 5), 50);
  assert.equal(rate("17", {
    nearTermWeather: "snow",
    precipitationRateBonus: 25,
  }, 5), 50);
});

test("気温・風・未来天候は既存快適補正に従う", () => {
  assert.equal(rate("15", { tempLevel: "36orMore" }), 20);
  assert.equal(rate("17", { windLevel: "5orMore" }), 25);
  assert.equal(rate("17", {
    weatherPointScore: -7,
    weatherPointShift: 2,
    weatherPointRangeText: "19〜21時",
  }), 30);
  assert.equal(rate("15", {
    weatherPointScore: 7,
    weatherPointShift: -2,
    weatherPointRangeText: "17〜21時",
  }), 0);
});

test("雨の快適方向制限は15時と17時で既存通り異なる", () => {
  const rain: Partial<ResolvedWeatherInput> = {
    nearTermWeather: "rain",
    precipitationRateBonus: 10,
    precipitationRateBonusLabel: "起点とその後も雨",
    tempLevel: "21to25",
  };
  assert.equal(rate("15", rain), 15);
  assert.equal(rate("17", rain), 30);
});

test("雪は既存通り快適度補正を使わず降雪補正を採用する", () => {
  for (const tempLevel of ["21to25", "36orMore"] as const) {
    assert.equal(rate("15", {
      tempLevel,
      nearTermWeather: "snow",
      precipitationRateBonus: 20,
      windLevel: "5orMore",
    }, 5), 35);
    assert.equal(rate("17", {
      tempLevel,
      nearTermWeather: "snow",
      precipitationRateBonus: 20,
      windLevel: "5orMore",
    }, 5), 45);
  }
});

test("実際の時間別天候の既存解決結果をそのまま受け取る", () => {
  for (const discountTime of ["15", "17"] as const) {
    const hourlyForecasts = createDefaultHourlyForecasts();
    for (const entry of Object.values(hourlyForecasts)) {
      entry.weather = "snow";
      entry.tempC = 4;
      entry.windMs = 5;
    }
    const weather: WeatherInput = { hourlyForecasts, afterRainSky: null };
    const resolvedWeather = resolveWeatherInputForDiscount(weather, discountTime);
    assert.equal(resolvedWeather.precipitationRateBonus, 20);
    assert.equal(getAdvanceDiscountRate({
      session: session(discountTime),
      resolvedWeather,
      isFixedTimeMode: false,
    }), discountTime === "15" ? 30 : 40);
  }
});

test("raw天候が異なっても解決済みの気温低下snapshotを再解決しない", () => {
  const analysis = evaluateTemperatureComfort({
    date: DATE,
    discountTime: "17",
    tempLevel: "34to35",
    previous: {
      date: DATE,
      discountTime: "15",
      tempLevel: "36orMore",
      temperatureFalling: false,
    },
  });
  assert.equal(analysis.temperaturePointSuppressed, true);
  const resolvedWeather: ResolvedWeatherInput = {
    ...neutralWeather,
    tempLevel: "34to35",
    temperatureComfortAnalysis: analysis,
  };
  for (const tempC of [4, 24, 37]) {
    const hourlyForecasts = createDefaultHourlyForecasts();
    for (const entry of Object.values(hourlyForecasts)) entry.tempC = tempC;
    const rawSession = {
      ...session(),
      weather: { hourlyForecasts, afterRainSky: null },
    };
    assert.equal(getAdvanceDiscountRate({
      session: rawSession,
      resolvedWeather,
      isFixedTimeMode: false,
    }), 20);
  }
  assert.equal(rate("17", { tempLevel: "34to35" }), 25);
});

test("既存weather計算の日付補正を保持し曜日基準を新設しない", () => {
  assert.equal(getAdvanceDiscountRate({
    session: { ...session("15"), date: "2026-05-05" },
    resolvedWeather: neutralWeather,
    isFixedTimeMode: false,
  }), 15);
  assert.equal(getAdvanceDiscountRate({
    session: { ...session("17"), date: "2026-05-05" },
    resolvedWeather: neutralWeather,
    isFixedTimeMode: false,
  }), 30);
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    assert.equal(getAdvanceDiscountRate({
      session: { ...session(), weekday },
      resolvedWeather: neutralWeather,
      isFixedTimeMode: false,
    }), 20);
  }
});

test("快適度0ではnormal/summerで同じsession天候・全体補正なら同じ率にする", () => {
  for (const demandCycle of ["normal", "summer"] as const) {
    const cycleSession = { ...session("17", 5), demandCycle };
    assert.equal(getAdvanceDiscountRate({
      session: cycleSession,
      resolvedWeather: neutralWeather,
      isFixedTimeMode: false,
    }), 25);
  }
});

test("fixed-time・session未開始・18:30/19:30/20:30は対象外", () => {
  const mustNotReadWeather = new Proxy(neutralWeather, {
    get() { throw new Error("対象外では天候を計算しない"); },
  });
  for (const discountTime of ["15", "17", "18", "19", "20"] as const) {
    assert.equal(getAdvanceDiscountRate({
      session: session(discountTime),
      resolvedWeather: mustNotReadWeather,
      isFixedTimeMode: true,
    }), null);
  }
  for (const discountTime of ["18", "19", "20"] as const) {
    assert.equal(getAdvanceDiscountRate({
      session: session(discountTime),
      resolvedWeather: mustNotReadWeather,
      isFixedTimeMode: false,
    }), null);
  }
  assert.equal(getAdvanceDiscountRate({
    session: null,
    resolvedWeather: mustNotReadWeather,
    isFixedTimeMode: false,
  }), null);
});

test("AreaCount・quick・decrease・中央値・履歴・商品policy・時刻補正を参照しない", () => {
  function forbidExtraFields<T extends object>(value: T): T {
    for (const field of [
      "areaCount", "areaCountRecords", "areaProgressMap", "currentAreaId", "areaJudge",
      "areaCountEvaluation", "areaRateAdjustment", "humanEvaluationDetails",
      "areaCountAdjustmentPercent", "evaluationAdjustment", "quickAdjustment",
      "decrease", "decreaseAdjustment", "medianCount",
      "history", "snapshots", "productAdjustmentPolicy", "productPolicy",
      "lateTimeBonus", "earlyNextMinus5Info", "rateOffsetPercent", "weather",
      "temperatureComfortAnalysis",
    ]) {
      Object.defineProperty(value, field, {
        enumerable: true,
        get() { throw new Error(`先行率から${field}を参照した`); },
      });
    }
    return value;
  }
  const input = forbidExtraFields({
    session: forbidExtraFields(session("17", 5)),
    resolvedWeather: neutralWeather,
    isFixedTimeMode: false,
  });
  assert.equal(getAdvanceDiscountRate(input), 25);
});

test("繰返し計算は入力と天候snapshotを変更しない", () => {
  const input = {
    session: Object.freeze(session("17", 5)),
    resolvedWeather: Object.freeze({ ...neutralWeather }),
    isFixedTimeMode: false,
  };
  const before = JSON.stringify(input);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(getAdvanceDiscountRate(input), 25);
  }
  assert.equal(JSON.stringify(input), before);
});

console.log(`Advance discount checks passed: ${passed}/15`);
