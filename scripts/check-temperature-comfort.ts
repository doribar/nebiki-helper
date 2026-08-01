import assert from "node:assert/strict";
import {
  createDefaultHourlyForecasts,
  getWeatherInputForecastHours,
  resolveWeatherInputForDiscount,
  toTempLevel,
} from "../src/domain/hourlyWeather.ts";
import {
  buildNormalRateDecisionSnapshot,
  normalizeRateDecisionSnapshot,
} from "../src/domain/rateDecisionSnapshot.ts";
import {
  evaluateTemperatureComfort,
  getTemperaturePoint,
  normalizeTemperatureComfortAnalysis,
} from "../src/domain/temperatureComfort.ts";
import {
  getBasisGuideDisplay,
  getWeekdayBaseInfo,
} from "../src/domain/weekdayBase.ts";
import type {
  AppState,
  DailySessionSnapshot,
  DiscountTime,
  ForecastHourKey,
  ForecastWeatherKind,
  ResolvedWeatherInput,
  TemperatureComfortAnalysis,
  WeatherInput,
} from "../src/domain/types.ts";
import {
  createInitialSessionDraft,
  createInitialState,
  normalizeLoadedState,
} from "../src/hooks/nebikiApp/stateNormalization.ts";
import { resolveSessionTemperatureComfort } from "../src/hooks/nebikiApp/temperatureComfortState.ts";

const DATE = "2026-08-01";

function createWeather(params: {
  discountTime: DiscountTime;
  tempC: number;
  weather?: ForecastWeatherKind;
  windMs?: number;
  later?: Partial<
    Record<
      ForecastHourKey,
      { weather?: ForecastWeatherKind; tempC?: number; windMs?: number }
    >
  >;
}): WeatherInput {
  const hourlyForecasts = createDefaultHourlyForecasts();
  const nearHour = getWeatherInputForecastHours(params.discountTime)[0];
  assert.ok(nearHour);
  hourlyForecasts[nearHour] = {
    weather: params.weather ?? "sunny",
    tempC: params.tempC,
    windMs: params.windMs ?? 2,
  };
  for (const [hour, values] of Object.entries(params.later ?? {})) {
    const key = hour as ForecastHourKey;
    hourlyForecasts[key] = {
      ...hourlyForecasts[key],
      ...values,
    };
  }
  return { hourlyForecasts, afterRainSky: null };
}

function createSnapshot(params: {
  date?: string;
  discountTime: DiscountTime;
  tempC: number;
  capturedAt: string;
  analysis?: TemperatureComfortAnalysis;
}): DailySessionSnapshot {
  const date = params.date ?? DATE;
  const weather = createWeather({
    discountTime: params.discountTime,
    tempC: params.tempC,
  });
  const resolvedWeather = resolveWeatherInputForDiscount(
    weather,
    params.discountTime,
  );
  return {
    version: 1,
    capturedAt: params.capturedAt,
    sessionEndReason: "completed",
    screen: "done",
    session: {
      date,
      weekday: 6,
      discountTime: params.discountTime,
      startedAt: params.capturedAt,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather,
      resolvedWeather: params.analysis
        ? { ...resolvedWeather, temperatureComfortAnalysis: params.analysis }
        : resolvedWeather,
    },
    basis: {
      baseRateBonus: 0,
      lateTimeBonus: 0,
      totalRateBonus: 0,
      baseRateBonusReason: [],
    },
    areas: {} as DailySessionSnapshot["areas"],
    doneSummaryItems: [],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  };
}

function attachAnalysis(
  weather: ResolvedWeatherInput,
  analysis: TemperatureComfortAnalysis,
): ResolvedWeatherInput {
  return { ...weather, temperatureComfortAnalysis: analysis };
}

let passed = 0;
function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

test("1. 15:00の36度以上から17:00の34〜35度で暑さ加点を抑制する", () => {
  const previousSnapshot = createSnapshot({
    discountTime: "15",
    tempC: 36,
    capturedAt: "2026-08-01T06:30:00.000Z",
  });
  const currentWeather = createWeather({ discountTime: "17", tempC: 35 });
  const fromSnapshot = resolveSessionTemperatureComfort({
    date: DATE,
    discountTime: "17",
    weather: currentWeather,
    snapshots: [previousSnapshot],
  });

  assert.equal(fromSnapshot.analysis.previousTempLevel, "36orMore");
  assert.equal(fromSnapshot.analysis.currentTempLevel, "34to35");
  assert.equal(fromSnapshot.analysis.temperatureFalling, true);
  assert.equal(fromSnapshot.analysis.originalTemperaturePoint, 1);
  assert.equal(fromSnapshot.analysis.appliedTemperaturePoint, 0);
  assert.equal(fromSnapshot.analysis.temperaturePointSuppressed, true);

  // The in-memory last-session record is an equivalent fallback when no
  // finalized daily snapshot is available yet.
  const fromLastSession = resolveSessionTemperatureComfort({
    date: DATE,
    discountTime: "17",
    weather: currentWeather,
    lastSessionWeather: {
      date: DATE,
      discountTime: "15",
      nearTermWeather: "other",
      nearTempC: 36,
    },
  });
  assert.deepEqual(fromLastSession.analysis, fromSnapshot.analysis);
});

test("2. 気温低下中は18:30で同じ34〜35度区分でも維持する", () => {
  const at17 = evaluateTemperatureComfort({
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
  const at18 = evaluateTemperatureComfort({
    date: DATE,
    discountTime: "18",
    tempLevel: "34to35",
    previous: {
      date: DATE,
      discountTime: "17",
      tempLevel: "34to35",
      temperatureFalling: at17.temperatureFalling,
    },
  });
  assert.equal(at18.temperatureFalling, true);
  assert.equal(at18.originalTemperaturePoint, 1);
  assert.equal(at18.appliedTemperaturePoint, 0);

  const restored = resolveSessionTemperatureComfort({
    date: DATE,
    discountTime: "18",
    weather: createWeather({ discountTime: "18", tempC: 35 }),
    snapshots: [
      createSnapshot({
        discountTime: "17",
        tempC: 35,
        capturedAt: "2026-08-01T08:00:00.000Z",
      }),
    ],
    existingAnalysis: at18,
  });
  assert.equal(restored.analysis.temperatureFalling, true);
  assert.equal(restored.analysis.appliedTemperaturePoint, 0);
});

test("3. 気温低下中に31〜33度へ下がっても抑制を維持する", () => {
  const result = evaluateTemperatureComfort({
    date: DATE,
    discountTime: "19",
    tempLevel: "31to33",
    previous: {
      date: DATE,
      discountTime: "18",
      tempLevel: "34to35",
      temperatureFalling: true,
    },
  });
  assert.equal(result.temperatureFalling, true);
  assert.equal(result.originalTemperaturePoint, 1);
  assert.equal(result.appliedTemperaturePoint, 0);
});

test("4. 31〜33度から34〜35度へ再上昇すると抑制を解除する", () => {
  const result = evaluateTemperatureComfort({
    date: DATE,
    discountTime: "19",
    tempLevel: "34to35",
    previous: {
      date: DATE,
      discountTime: "18",
      tempLevel: "31to33",
      temperatureFalling: true,
    },
  });
  assert.equal(result.temperatureFalling, false);
  assert.equal(result.temperaturePointSuppressed, false);
  assert.equal(result.appliedTemperaturePoint, 1);
});

test("5. 34〜35度の同一区分では低下を開始せず、15:00でも抑制を開始しない", () => {
  const sameBand = evaluateTemperatureComfort({
    date: DATE,
    discountTime: "17",
    tempLevel: "34to35",
    previous: {
      date: DATE,
      discountTime: "15",
      tempLevel: "34to35",
      temperatureFalling: false,
    },
  });
  assert.equal(sameBand.temperatureFalling, false);
  assert.equal(sameBand.appliedTemperaturePoint, 1);

  const at15 = evaluateTemperatureComfort({
    date: DATE,
    discountTime: "15",
    tempLevel: "34to35",
    previous: {
      date: DATE,
      discountTime: "15",
      tempLevel: "36orMore",
      temperatureFalling: false,
    },
  });
  assert.equal(at15.temperatureFalling, false);
  assert.equal(at15.appliedTemperaturePoint, 1);
});

test("6. 35度から33度への低下は新区分で検出する", () => {
  assert.equal(toTempLevel(35), "34to35");
  assert.equal(toTempLevel(33), "31to33");
  const result = evaluateTemperatureComfort({
    date: DATE,
    discountTime: "17",
    tempLevel: toTempLevel(33),
    previous: {
      date: DATE,
      discountTime: "15",
      tempLevel: toTempLevel(35),
      temperatureFalling: false,
    },
  });
  assert.equal(result.temperatureFalling, true);
  assert.equal(result.appliedTemperaturePoint, 0);
});

test("7. 前回入力がない17:00は通常の気温点を使う", () => {
  const result = evaluateTemperatureComfort({
    date: DATE,
    discountTime: "17",
    tempLevel: "34to35",
  });
  assert.equal(result.previousTempLevel, null);
  assert.equal(result.temperatureFalling, false);
  assert.equal(result.appliedTemperaturePoint, 1);
});

test("8. 前日の気温は比較対象にせず日付跨ぎで状態をリセットする", () => {
  const result = evaluateTemperatureComfort({
    date: "2026-08-02",
    discountTime: "17",
    tempLevel: "34to35",
    previous: {
      date: DATE,
      discountTime: "20",
      tempLevel: "36orMore",
      temperatureFalling: true,
    },
  });
  assert.equal(result.previousTempLevel, null);
  assert.equal(result.previousTemperatureFalling, false);
  assert.equal(result.temperatureFalling, false);
  assert.equal(result.appliedTemperaturePoint, 1);
});

test("9. 寒い側の区分変化では気温低下中を発動しない", () => {
  const result = evaluateTemperatureComfort({
    date: DATE,
    discountTime: "17",
    tempLevel: "5orLess",
    previous: {
      date: DATE,
      discountTime: "15",
      tempLevel: "6to10",
      temperatureFalling: false,
    },
  });
  assert.equal(result.temperatureFalling, false);
  assert.equal(result.originalTemperaturePoint, 2);
  assert.equal(result.appliedTemperaturePoint, 2);
});

test("10. 抑制しても雨・雪・風・未来天候の算出値は変えない", () => {
  for (const precipitation of ["rain", "snow"] as const) {
    const weather = createWeather({
      discountTime: "17",
      tempC: 35,
      weather: precipitation,
      windMs: 6,
      later: {
        "19": { weather: precipitation, tempC: 31, windMs: 5 },
        "20": { weather: "sunny", tempC: 29, windMs: 4 },
        "21": { weather: "sunny", tempC: 28, windMs: 2 },
      },
    });
    const base = resolveWeatherInputForDiscount(weather, "17");
    const normalAnalysis = evaluateTemperatureComfort({
      date: DATE,
      discountTime: "17",
      tempLevel: base.tempLevel,
      previous: {
        date: DATE,
        discountTime: "15",
        tempLevel: "34to35",
        temperatureFalling: false,
      },
    });
    const fallingAnalysis = evaluateTemperatureComfort({
      date: DATE,
      discountTime: "17",
      tempLevel: base.tempLevel,
      previous: {
        date: DATE,
        discountTime: "15",
        tempLevel: "36orMore",
        temperatureFalling: false,
      },
    });
    const normalWeather = attachAnalysis(base, normalAnalysis);
    const fallingWeather = attachAnalysis(base, fallingAnalysis);

    assert.equal(normalWeather.precipitationRateBonus, fallingWeather.precipitationRateBonus);
    assert.equal(normalWeather.precipitationRateBonusLabel, fallingWeather.precipitationRateBonusLabel);
    assert.equal(normalWeather.windLevel, fallingWeather.windLevel);
    assert.equal(normalWeather.weatherPointScore, fallingWeather.weatherPointScore);
    assert.equal(normalWeather.weatherPointShift, fallingWeather.weatherPointShift);
    assert.equal(normalWeather.hasLaterPrecip, fallingWeather.hasLaterPrecip);
    assert.equal(normalWeather.laterPrecipType, fallingWeather.laterPrecipType);

    const normalBasis = getWeekdayBaseInfo(6, "17", normalWeather, DATE);
    const fallingBasis = getWeekdayBaseInfo(6, "17", fallingWeather, DATE);
    assert.equal(normalBasis.weekdayShift - fallingBasis.weekdayShift, 1);
    const display = getBasisGuideDisplay({
      date: DATE,
      weekday: 6,
      discountTime: "17",
      weather: fallingWeather,
    });
    assert.equal(
      display.bonusDetailLines.some((line) =>
        line.includes("気温低下中のため、暑さによる加点なし"),
      ),
      true,
    );
  }
});

test("11. 旧31〜35度区分は+1のまま読み込み、推測で新区分へ変換しない", () => {
  const legacy = normalizeTemperatureComfortAnalysis({
    version: 1,
    originalTemperaturePoint: 1,
    appliedTemperaturePoint: 1,
    temperatureFalling: false,
    previousTemperatureFalling: false,
    previousTempLevel: null,
    previousDiscountTime: null,
    currentTempLevel: "31to35",
    temperaturePointSuppressed: false,
  });
  assert.ok(legacy);
  assert.equal(legacy.currentTempLevel, "31to35");
  assert.equal(legacy.originalTemperaturePoint, 1);
  assert.equal(legacy.appliedTemperaturePoint, 1);
  assert.equal(getTemperaturePoint("31to35"), 1);

  const initialDraft = createInitialSessionDraft();
  initialDraft.date = DATE;
  initialDraft.weekday = 6;
  initialDraft.discountTime = "17";
  const legacyState = createInitialState(initialDraft);
  legacyState.screen = "area_judge";
  legacyState.session = {
    ...initialDraft,
    startedAt: "2026-08-01T08:00:00.000Z",
    weather: {
      nearTermWeather: "other",
      hasLaterPrecip: false,
      laterPrecipType: null,
      windLevel: "2orLess",
      nearWindLevel: "2orLess",
      tempLevel: "31to35",
      nearTempLevel: "31to35",
      afterRainSky: null,
    } as unknown as WeatherInput,
  };
  const restored = normalizeLoadedState(
    JSON.parse(JSON.stringify(legacyState)) as AppState,
    initialDraft,
  );
  assert.ok(restored.session);
  assert.equal(
    restored.session.temperatureComfortAnalysis?.currentTempLevel,
    "31to35",
  );
  assert.equal(
    restored.session.temperatureComfortAnalysis?.originalTemperaturePoint,
    1,
  );
  assert.equal(
    restored.session.temperatureComfortAnalysis?.appliedTemperaturePoint,
    1,
  );
  assert.equal(
    restored.session.temperatureComfortAnalysis?.temperatureFalling,
    false,
  );
  assert.equal(restored.session.legacyUnresolvedTempLevel, "31to35");
  const restoredCalculation = resolveSessionTemperatureComfort({
    date: restored.session.date,
    discountTime: restored.session.discountTime,
    weather: restored.session.weather,
    existingAnalysis: restored.session.temperatureComfortAnalysis,
    legacyUnresolvedTempLevel: restored.session.legacyUnresolvedTempLevel,
  });
  assert.equal(restoredCalculation.analysis.currentTempLevel, "31to35");
  assert.equal(restoredCalculation.analysis.originalTemperaturePoint, 1);
  assert.equal(restoredCalculation.analysis.appliedTemperaturePoint, 1);
  assert.equal(restoredCalculation.analysis.temperatureFalling, false);

  const currentResolved = resolveWeatherInputForDiscount(
    createWeather({ discountTime: "17", tempC: 33 }),
    "17",
  );
  const legacySnapshot = buildNormalRateDecisionSnapshot({
    confirmedAt: "2026-08-01T08:00:00.000Z",
    sessionDiscountTime: "17",
    resolvedWeather: {
      ...currentResolved,
      tempLevel: "31to35",
      temperatureComfortAnalysis: legacy,
    },
    weatherComfortAdjustmentPercent: 5,
    areaRateAdjustment: 0,
    areaJudge: "normal",
  });
  const normalizedLegacySnapshot = normalizeRateDecisionSnapshot(
    JSON.parse(JSON.stringify(legacySnapshot)) as unknown,
  );
  assert.ok(normalizedLegacySnapshot);
  assert.equal(normalizedLegacySnapshot.resolvedWeather.tempLevel, "31to35");
  assert.equal(
    normalizedLegacySnapshot.resolvedWeather.temperatureComfortAnalysis
      ?.currentTempLevel,
    "31to35",
  );

  const cannotGuessDecline = evaluateTemperatureComfort({
    date: DATE,
    discountTime: "17",
    tempLevel: "31to33",
    previous: {
      date: DATE,
      discountTime: "15",
      tempLevel: "31to35",
      temperatureFalling: false,
    },
  });
  assert.equal(cannotGuessDecline.temperatureFalling, false);
});

test("12. 新規31〜33度・34〜35度区分はスナップショットをJSON往復できる", () => {
  for (const [tempC, expectedLevel] of [
    [31, "31to33"],
    [33, "31to33"],
    [34, "34to35"],
    [35, "34to35"],
  ] as const) {
    const weather = createWeather({ discountTime: "17", tempC });
    const resolvedWeather = resolveWeatherInputForDiscount(weather, "17");
    const analysis = evaluateTemperatureComfort({
      date: DATE,
      discountTime: "17",
      tempLevel: resolvedWeather.tempLevel,
    });
    const snapshot = buildNormalRateDecisionSnapshot({
      confirmedAt: "2026-08-01T08:15:00.000Z",
      sessionDiscountTime: "17",
      resolvedWeather: attachAnalysis(resolvedWeather, analysis),
      weatherComfortAdjustmentPercent: 0,
      areaRateAdjustment: 0,
      areaJudge: "normal",
    });
    const normalized = normalizeRateDecisionSnapshot(
      JSON.parse(JSON.stringify(snapshot)) as unknown,
    );
    assert.ok(normalized);
    assert.equal(normalized.resolvedWeather.tempLevel, expectedLevel);
    assert.equal(
      normalized.resolvedWeather.temperatureComfortAnalysis?.currentTempLevel,
      expectedLevel,
    );
    assert.deepEqual(normalized, snapshot);
  }
});

assert.equal(passed, 12);
console.log(`${passed}/12 temperature comfort checks passed`);
