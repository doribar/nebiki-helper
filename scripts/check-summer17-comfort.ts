import assert from "node:assert/strict";
import {
  createDefaultHourlyForecasts,
  getWeatherInputForecastHours,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import { evaluateTemperatureComfort } from "../src/domain/temperatureComfort.ts";
import {
  getBasisGuideDisplay,
  getWeekdayBaseInfo,
} from "../src/domain/weekdayBase.ts";
import type {
  DemandCycle,
  DiscountTime,
  ForecastWeatherKind,
  ResolvedWeatherInput,
  WeatherInput,
} from "../src/domain/types.ts";

const DATE = "2026-09-13";
const TIMES = ["15", "17", "18", "19"] as const;
const CYCLES = ["normal", "summer"] as const;
const RAW_CASES = [
  { tempC: 25, raw: -2 },
  { tempC: 26, raw: -1 },
  { tempC: 15, raw: 0 },
  { tempC: 33, raw: 1 },
  { tempC: 36, raw: 2 },
] as const;

function createWeather(
  discountTime: DiscountTime,
  tempC: number,
  kind: ForecastWeatherKind = "sunny",
  continuing = false,
): WeatherInput {
  const hourlyForecasts = createDefaultHourlyForecasts();
  const [nearHour, nextHour] = getWeatherInputForecastHours(discountTime);
  assert.ok(nearHour);
  hourlyForecasts[nearHour] = { weather: kind, tempC, windMs: 2 };
  if (continuing && nextHour) hourlyForecasts[nextHour].weather = kind;
  return { hourlyForecasts, afterRainSky: null };
}

function assertCoreAndDisplay(params: {
  demandCycle?: DemandCycle;
  discountTime: DiscountTime;
  weather: ResolvedWeatherInput;
  raw: number;
  bonus: number;
}) {
  const before = structuredClone(params.weather);
  const info = getWeekdayBaseInfo(
    0, params.discountTime, params.weather, DATE, params.demandCycle,
  );
  const guide = getBasisGuideDisplay({
    date: DATE,
    weekday: 0,
    discountTime: params.discountTime,
    demandCycle: params.demandCycle,
    weather: params.weather,
  });
  assert.equal(info.weekdayShift, params.raw);
  assert.equal(info.baseRateBonus, params.bonus);
  assert.equal(guide.bonusTotal, params.bonus);
  assert.equal(
    guide.bonusSummaryText,
    params.bonus === 0 ? "値引率補正：なし"
      : `値引率補正：${params.bonus > 0 ? "+" : ""}${params.bonus}％`,
  );
  const parts = guide.bonusCalcParts ?? [];
  assert.equal(parts.reduce((sum, part) => {
    const match = / ([+-]?\d+)%$/.exec(part);
    assert.ok(match, part);
    return sum + Number(match[1]);
  }, 0), params.bonus);
  assert.equal(
    guide.bonusCalcText,
    parts.length ? `値引率補正の内訳：${parts.join(" ＋ ")}` : undefined,
  );
  assert.equal(
    guide.bonusResultText,
    parts.length
      ? `計算の結果、値引率補正は${params.bonus > 0 ? "+" : ""}${params.bonus}%${params.bonus === 0 ? "、補正はありません" : ""}。`
      : undefined,
  );
  assert.deepEqual(
    info.baseRateBonusReason,
    params.bonus !== 0 ? [guide.bonusCalcText, guide.bonusResultText] : [],
  );
  assert.deepEqual(params.weather, before, "計算と表示で解決済み天候を変更しない");
  return { info, guide };
}

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS: ${name}`);
}

// raw -2 / -1 / 0 / +1 / +2それぞれの快適度補正。雨雪加算は別に検証する。
const EXPECTED = {
  normal: {
    "15": { dry: [-10, -5, 0, 5, 10], rain: [-5, -5, 0, 5, 10] },
    "17": { dry: [-5, -5, 0, 5, 10], rain: [0, 0, 0, 5, 10] },
    "18": { dry: [-5, -5, 0, 5, 10], rain: [0, 0, 0, 5, 10] },
    "19": { dry: [-5, -5, 0, 5, 10], rain: [0, 0, 0, 5, 10] },
  },
  summer: {
    "15": { dry: [-10, -5, 0, 5, 10], rain: [-5, -5, 0, 5, 10] },
    "17": { dry: [-10, -5, 0, 5, 10], rain: [0, 0, 0, 5, 10] },
    "18": { dry: [-5, -5, 0, 5, 10], rain: [0, 0, 0, 5, 10] },
    "19": { dry: [-5, -5, 0, 5, 10], rain: [0, 0, 0, 5, 10] },
  },
} as const;

for (const demandCycle of CYCLES) {
  for (const discountTime of TIMES) {
    for (const precipitation of [
      { kind: "sunny", continuing: false },
      { kind: "rain", continuing: false },
      { kind: "rain", continuing: true },
      { kind: "snow", continuing: false },
      { kind: "snow", continuing: true },
    ] as const) {
      test(`${demandCycle} ${discountTime}時 ${precipitation.kind}/${precipitation.continuing ? "継続" : "単発"} raw全5段階`, () => {
        RAW_CASES.forEach(({ tempC, raw }, index) => {
          const weather = resolveWeatherInputForDiscount(
            createWeather(discountTime, tempC, precipitation.kind, precipitation.continuing),
            discountTime,
          );
          const continuing = precipitation.continuing || discountTime === "19";
          const direct = precipitation.kind === "sunny" ? 0
            : precipitation.kind === "rain" ? (continuing ? 10 : 5)
            : (continuing ? 20 : 15);
          assert.equal(weather.precipitationRateBonus, direct);
          assert.equal(weather.weatherPointShift, 0);
          const comfort = precipitation.kind === "snow" ? 0
            : EXPECTED[demandCycle][discountTime][precipitation.kind === "rain" ? "rain" : "dry"][index];
          const { guide } = assertCoreAndDisplay({
            demandCycle, discountTime, weather, raw, bonus: direct + comfort,
          });
          if (precipitation.kind === "snow") {
            assert.ok(guide.bonusDetailLines.includes("雪のため快適度補正は使いません。"));
            assert.ok(guide.bonusCalcParts?.every((part) => !part.includes("快適度補正")));
          } else {
            const signed = comfort > 0 ? `+${comfort}` : `${comfort}`;
            assert.ok(guide.bonusDetailLines.some((part) => part.includes(`快適度補正 ${signed}%`)));
          }
          if (precipitation.kind === "sunny" && demandCycle === "summer" && discountTime === "17") {
            assert.doesNotMatch(JSON.stringify(guide), /17時以降のため快適方向は-5%まで/);
          }
          if (precipitation.kind === "sunny" && raw === -2 && comfort === -5) {
            assert.match(guide.bonusCalcText ?? "", /17時以降のため快適方向は-5%まで/);
          }
        });
      });
    }
  }
}

test("cycle省略は全時刻でnormal互換、20:30の快適度上限も従来どおり", () => {
  for (const discountTime of [...TIMES, "20"] as const) {
    const weather = resolveWeatherInputForDiscount(createWeather(discountTime, 25), discountTime);
    const omitted = assertCoreAndDisplay({ discountTime, weather, raw: -2, bonus: discountTime === "15" ? -10 : -5 });
    const normal = assertCoreAndDisplay({ demandCycle: "normal", discountTime, weather, raw: -2, bonus: discountTime === "15" ? -10 : -5 });
    assert.deepEqual(omitted, normal);
    if (discountTime === "20") {
      assertCoreAndDisplay({ demandCycle: "summer", discountTime, weather, raw: -2, bonus: -5 });
    }
  }
});

test("9/13晴れ25〜26度・弱風、適用気温-2/未来6pt/-1点は夏17時-10%、normal-5%", () => {
  const input = createWeather("17", 25);
  input.hourlyForecasts["16"].tempC = 26;
  input.hourlyForecasts["17"].tempC = 26;
  for (const hour of ["19", "20", "21"] as const) input.hourlyForecasts[hour].tempC = 25;
  const resolved = resolveWeatherInputForDiscount(input, "17");
  const analysis = evaluateTemperatureComfort({ date: DATE, discountTime: "17", tempLevel: resolved.tempLevel });
  assert.equal(analysis.appliedTemperaturePoint, -2);
  assert.equal(resolved.weatherPointScore, 6);
  assert.equal(resolved.weatherPointShift, -1);
  assert.equal(resolved.windLevel, "2orLess");
  assert.equal(resolved.precipitationRateBonus, 0);
  const weather = { ...resolved, temperatureComfortAnalysis: analysis };
  const { guide } = assertCoreAndDisplay({ demandCycle: "summer", discountTime: "17", weather, raw: -3, bonus: -10 });
  assert.equal(guide.bonusSummaryText, "値引率補正：-10％");
  assert.equal(guide.bonusCalcText, "値引率補正の内訳：快適度補正：超快適 -10%");
  assert.equal(guide.bonusResultText, "計算の結果、値引率補正は-10%。");
  assert.ok(guide.bonusDetailLines.some((line) => line.includes("18時気温 21〜25度 -2点")));
  assert.ok(guide.bonusDetailLines.some((line) => line.includes("未来天候ポイント +6pt（19〜21時） -1点")));
  assert.doesNotMatch(JSON.stringify(guide), /快適方向は-5%まで/);
  assertCoreAndDisplay({ demandCycle: "normal", discountTime: "17", weather, raw: -3, bonus: -5 });
});

test("雨上がりの晴れ・曇りは全cycle/時刻で追加補正を作らない", () => {
  for (const demandCycle of CYCLES) for (const discountTime of TIMES) {
    const weather = resolveWeatherInputForDiscount(createWeather(discountTime, 25), discountTime);
    const bonus = EXPECTED[demandCycle][discountTime].dry[0];
    const baseline = assertCoreAndDisplay({ demandCycle, discountTime, weather, raw: -2, bonus });
    for (const afterRainSky of ["sunny", "cloudy"] as const) {
      assert.deepEqual(assertCoreAndDisplay({ demandCycle, discountTime, weather: { ...weather, afterRainSky }, raw: -2, bonus }), baseline);
    }
  }
});

test("気温低下中の暑さ加点抑制と解析snapshotは夏17時でも維持", () => {
  const input = createWeather("17", 33);
  for (const hour of ["19", "20", "21"] as const) input.hourlyForecasts[hour].tempC = 25;
  const resolved = resolveWeatherInputForDiscount(input, "17");
  const analysis = evaluateTemperatureComfort({
    date: DATE, discountTime: "17", tempLevel: resolved.tempLevel,
    previous: { date: DATE, discountTime: "15", tempLevel: "34to35", temperatureFalling: false },
  });
  assert.equal(analysis.temperatureFalling, true);
  assert.equal(analysis.originalTemperaturePoint, 1);
  assert.equal(analysis.appliedTemperaturePoint, 0);
  assert.equal(analysis.temperaturePointSuppressed, true);
  for (const demandCycle of CYCLES) {
    const { guide } = assertCoreAndDisplay({ demandCycle, discountTime: "17", weather: { ...resolved, temperatureComfortAnalysis: analysis }, raw: -1, bonus: -5 });
    assert.ok(guide.bonusDetailLines.includes("気温低下中のため、暑さによる加点なし"));
    assertCoreAndDisplay({ demandCycle, discountTime: "17", weather: resolved, raw: 0, bonus: 0 });
  }
});

test("近接風の気温別閾値と正方向clampは維持", () => {
  for (const fixture of [
    { tempC: 25, windMs: 4, raw: -2, normal: -5, summer: -10 },
    { tempC: 25, windMs: 5, raw: -1, normal: -5, summer: -5 },
    { tempC: 26, windMs: 5, raw: 0, normal: 0, summer: 0 },
    { tempC: 10, windMs: 2, raw: 1, normal: 5, summer: 5 },
    { tempC: 10, windMs: 3, raw: 2, normal: 10, summer: 10 },
    { tempC: 10, windMs: 5, raw: 3, normal: 10, summer: 10 },
  ]) {
    const input = createWeather("17", fixture.tempC);
    input.hourlyForecasts["18"].windMs = fixture.windMs;
    const weather = resolveWeatherInputForDiscount(input, "17");
    for (const demandCycle of CYCLES) assertCoreAndDisplay({ demandCycle, discountTime: "17", weather, raw: fixture.raw, bonus: fixture[demandCycle] });
  }
});

test("未来天候ポイントの気温・雨雪・風と閾値は維持し、起点晴れの後発雨雪を直接加算しない", () => {
  for (const fixture of [
    { tempC: 25, kind: "sunny", windMs: 2, score: 6, shift: -1, bonus: -5 },
    { tempC: 26, kind: "sunny", windMs: 2, score: 3, shift: 0, bonus: 0 },
    { tempC: 36, kind: "sunny", windMs: 2, score: -6, shift: 1, bonus: 5 },
    { tempC: 36, kind: "sunny", windMs: 5, score: -9, shift: 2, bonus: 10 },
    { tempC: 15, kind: "rain", windMs: 2, score: -3, shift: 0, bonus: 0 },
    { tempC: 15, kind: "snow", windMs: 2, score: -6, shift: 1, bonus: 5 },
    { tempC: 15, kind: "sunny", windMs: 3, score: -3, shift: 0, bonus: 0 },
    { tempC: 15, kind: "sunny", windMs: 5, score: -6, shift: 1, bonus: 5 },
  ] as const) {
    const input = createWeather("17", 15);
    for (const hour of ["19", "20", "21"] as const) {
      input.hourlyForecasts[hour] = { weather: fixture.kind, tempC: fixture.tempC, windMs: fixture.windMs };
    }
    const weather = resolveWeatherInputForDiscount(input, "17");
    assert.equal(weather.weatherPointScore, fixture.score);
    assert.equal(weather.weatherPointShift, fixture.shift);
    assert.equal(weather.weatherPointRangeText, "19〜21時");
    assert.equal(weather.precipitationRateBonus, 0);
    assert.equal(weather.hasLaterPrecip, fixture.kind !== "sunny");
    assert.equal(weather.next18TempDropShift, 0);
    assert.equal(weather.next18WindWorsenShift, 0);
    assert.equal(weather.next18WindWorsenKind, null);
    for (const demandCycle of CYCLES) assertCoreAndDisplay({ demandCycle, discountTime: "17", weather, raw: fixture.shift, bonus: fixture.bonus });
  }
  for (const kind of ["rain", "snow"] as const) {
    const input = createWeather("17", 25);
    for (const hour of ["19", "20", "21"] as const) input.hourlyForecasts[hour].tempC = 25;
    input.hourlyForecasts["19"].weather = kind;
    const weather = resolveWeatherInputForDiscount(input, "17");
    assert.equal(weather.precipitationRateBonus, 0);
    assert.equal(weather.weatherPointScore, kind === "rain" ? 5 : 4);
    assert.equal(weather.weatherPointShift, -1);
    assertCoreAndDisplay({ demandCycle: "summer", discountTime: "17", weather, raw: -3, bonus: -10 });
    assertCoreAndDisplay({ demandCycle: "normal", discountTime: "17", weather, raw: -3, bonus: -5 });
  }
});

console.log(`${passed}/${passed} summer17 comfort checks passed`);
