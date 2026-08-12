import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  getWeatherInputForecastHours,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import {
  FIXED_TIME_TEMPERATURE_STORAGE_KEY,
  loadFixedTimeTemperatures,
  saveFixedTimeTemperature,
  saveFixedTimeTemperatures,
} from "../src/domain/fixedTimeTemperatureMemory.ts";
import {
  matchesWeatherConfirmationDraft,
  normalizeWeatherConfirmationPending,
  restoreWeatherConfirmationPending,
} from "../src/domain/weatherConfirmation.ts";
import {
  buildSameDayConfirmedHourlyWeather,
  buildWeatherConfirmationDisplayRows,
} from "../src/domain/weatherConfirmationDisplay.ts";
import {
  loadRuntimeState,
  saveRuntimeState,
  STORAGE_KEYS,
} from "../src/domain/storage.ts";
import type {
  DailySessionSnapshot,
  DiscountTime,
  ForecastHourKey,
  HourlyForecastEntry,
  SessionData,
} from "../src/domain/types.ts";
import {
  createInitialSessionDraft,
  createInitialState,
} from "../src/hooks/nebikiApp/stateNormalization.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new MemoryStorage(),
});

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (relativePath: string) =>
  readFileSync(`${root}/${relativePath}`, "utf8").replaceAll("\r\n", "\n");

function createSession(params: {
  date: string;
  discountTime: DiscountTime;
  startedAt: string;
  entries?: Partial<Record<ForecastHourKey, HourlyForecastEntry>>;
}): SessionData {
  const draft = createInitialSessionDraft();
  draft.date = params.date;
  draft.discountTime = params.discountTime;
  for (const [hour, entry] of Object.entries(params.entries ?? {})) {
    draft.weather.hourlyForecasts[hour as ForecastHourKey] = { ...entry! };
  }
  return { ...draft, startedAt: params.startedAt };
}

function createWeatherSnapshot(params: {
  session: SessionData;
  capturedAt: string;
  screen?: DailySessionSnapshot["screen"];
  sessionEndReason?: DailySessionSnapshot["sessionEndReason"];
}): DailySessionSnapshot {
  return {
    version: 1,
    capturedAt: params.capturedAt,
    screen: params.screen ?? "done",
    sessionEndReason: params.sessionEndReason,
    session: {
      ...params.session,
      resolvedWeather: resolveWeatherInputForDiscount(
        params.session.weather,
        params.session.discountTime,
      ),
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

test("値引時刻ごとの天候確認対象を時刻順に返す", () => {
  assert.deepEqual(getWeatherInputForecastHours("15"), ["16", "17", "18", "19", "20", "21"]);
  assert.deepEqual(getWeatherInputForecastHours("17"), ["18", "19", "20", "21"]);
  assert.deepEqual(getWeatherInputForecastHours("18"), ["19", "20", "21"]);
  assert.deepEqual(getWeatherInputForecastHours("19"), ["20", "21"]);
  assert.deepEqual(getWeatherInputForecastHours("20"), ["21"]);
});

test("確認待ちランタイム値は許可値だけを正規化する", () => {
  assert.deepEqual(
    normalizeWeatherConfirmationPending({ date: "2026-07-29", discountTime: "18" }),
    { date: "2026-07-29", discountTime: "18" },
  );
  assert.equal(normalizeWeatherConfirmationPending({ date: "2026/07/29", discountTime: "18" }), null);
  assert.equal(normalizeWeatherConfirmationPending({ date: "2026-07-29", discountTime: "16" }), null);
  assert.equal(normalizeWeatherConfirmationPending(null), null);
});

test("確認待ちは同日・開始画面・同じ値引時刻の入力だけを復元する", () => {
  const draft = {
    ...createInitialSessionDraft(),
    date: "2026-07-29",
    discountTime: "18" as const,
  };
  const raw = { date: draft.date, discountTime: draft.discountTime };

  assert.deepEqual(
    restoreWeatherConfirmationPending({
      raw,
      screen: "start",
      sessionDraft: draft,
      currentDate: draft.date,
    }),
    raw,
  );
  assert.equal(
    restoreWeatherConfirmationPending({
      raw,
      screen: "area_judge",
      sessionDraft: draft,
      currentDate: draft.date,
    }),
    null,
  );
  assert.equal(
    restoreWeatherConfirmationPending({
      raw,
      screen: "start",
      sessionDraft: { ...draft, discountTime: "19" },
      currentDate: draft.date,
    }),
    null,
  );
  assert.equal(
    restoreWeatherConfirmationPending({
      raw,
      screen: "start",
      sessionDraft: draft,
      currentDate: "2026-07-30",
    }),
    null,
  );
});

test("確認待ちの一致判定は日付・時刻・開始画面をすべて検証する", () => {
  const draft = {
    ...createInitialSessionDraft(),
    date: "2026-07-29",
    discountTime: "17" as const,
  };
  const pending = { date: draft.date, discountTime: draft.discountTime };

  assert.equal(matchesWeatherConfirmationDraft({ pending, screen: "start", sessionDraft: draft }), true);
  assert.equal(matchesWeatherConfirmationDraft({ pending, screen: "done", sessionDraft: draft }), false);
  assert.equal(matchesWeatherConfirmationDraft({ pending: null, screen: "start", sessionDraft: draft }), false);
});

test("旧ランタイム保存は確認待ちなしとして読み込める", () => {
  localStorage.clear();
  localStorage.setItem("nebiki-helper/runtime-state", JSON.stringify({
    areaJudgeSelection: null,
    resumeTargetScreen: null,
    timeSwitchTarget: null,
    undoSnapshot: null,
    screenHistory: [],
  }));
  assert.equal(loadRuntimeState()?.weatherConfirmationPending, null);
});

test("確認待ち状態を既存ランタイムキーへ保存・復元できる", () => {
  localStorage.clear();
  saveRuntimeState({
    areaJudgeSelection: null,
    resumeTargetScreen: null,
    timeSwitchTarget: null,
    undoSnapshot: null,
    screenHistory: [],
    weatherConfirmationPending: { date: "2026-07-29", discountTime: "19" },
  });
  assert.deepEqual(loadRuntimeState()?.weatherConfirmationPending, {
    date: "2026-07-29",
    discountTime: "19",
  });
});

test("固定時刻用気温キャッシュは固定モードだけで日付・時刻別の気温を保持する", () => {
  localStorage.clear();

  assert.equal(
    saveFixedTimeTemperature({
      enabled: false,
      date: "2026-07-29",
      hour: "16",
      tempC: 31,
    }),
    false,
  );
  assert.equal(localStorage.getItem(FIXED_TIME_TEMPERATURE_STORAGE_KEY), null);

  assert.equal(
    saveFixedTimeTemperature({
      enabled: true,
      date: "2026-07-29",
      hour: "16",
      tempC: 31,
    }),
    true,
  );
  assert.equal(
    saveFixedTimeTemperatures({
      enabled: true,
      date: "2026-07-29",
      values: { "17": 30, "21": 27 },
    }),
    true,
  );
  assert.equal(
    saveFixedTimeTemperature({
      enabled: true,
      date: "2026-07-30",
      hour: "16",
      tempC: 25,
    }),
    true,
  );

  assert.deepEqual(loadFixedTimeTemperatures({ enabled: true, date: "2026-07-29" }), {
    "16": 31,
    "17": 30,
    "21": 27,
  });
  assert.deepEqual(loadFixedTimeTemperatures({ enabled: true, date: "2026-07-30" }), {
    "16": 25,
  });
  assert.deepEqual(loadFixedTimeTemperatures({ enabled: false, date: "2026-07-29" }), {});

  const storedBeforeDisabledWrites = localStorage.getItem(
    FIXED_TIME_TEMPERATURE_STORAGE_KEY,
  );
  assert.equal(
    saveFixedTimeTemperature({
      enabled: false,
      date: "2026-07-29",
      hour: "16",
      tempC: 10,
    }),
    false,
  );
  assert.equal(
    saveFixedTimeTemperatures({
      enabled: false,
      date: "2026-07-29",
      values: { "16": 10, "18": 12 },
    }),
    false,
  );
  assert.equal(
    localStorage.getItem(FIXED_TIME_TEMPERATURE_STORAGE_KEY),
    storedBeforeDisabledWrites,
  );

  const stored = JSON.parse(
    localStorage.getItem(FIXED_TIME_TEMPERATURE_STORAGE_KEY) ?? "null",
  ) as Record<string, unknown>;
  const serialized = JSON.stringify(stored);
  assert.equal(serialized.includes("weather"), false);
  assert.equal(serialized.includes("windMs"), false);
  assert.deepEqual(stored, {
    version: 1,
    byDate: {
      "2026-07-29": { "16": 31, "17": 30, "21": 27 },
      "2026-07-30": { "16": 25 },
    },
  });
});

test("固定時刻用気温キャッシュは不正な日付・時刻・気温を保存・復元しない", () => {
  localStorage.clear();
  assert.equal(
    saveFixedTimeTemperature({
      enabled: true,
      date: "2026-02-30",
      hour: "16",
      tempC: 20,
    }),
    false,
  );
  assert.equal(
    saveFixedTimeTemperature({
      enabled: true,
      date: "2026-07-29",
      hour: "22" as ForecastHourKey,
      tempC: 20,
    }),
    false,
  );
  for (const invalidTemp of [-6, 40.5, 41, Number.NaN]) {
    assert.equal(
      saveFixedTimeTemperature({
        enabled: true,
        date: "2026-07-29",
        hour: "16",
        tempC: invalidTemp,
      }),
      false,
    );
  }
  assert.equal(localStorage.getItem(FIXED_TIME_TEMPERATURE_STORAGE_KEY), null);

  localStorage.setItem(
    FIXED_TIME_TEMPERATURE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      byDate: {
        "2026-07-29": {
          "16": 20,
          "17": 20.5,
          "18": -6,
          "19": 41,
          "20": "30",
          "22": 25,
        },
        "2026-02-30": { "16": 10 },
      },
    }),
  );
  assert.deepEqual(loadFixedTimeTemperatures({ enabled: true, date: "2026-07-29" }), {
    "16": 20,
  });
  assert.deepEqual(loadFixedTimeTemperatures({ enabled: true, date: "2026-02-30" }), {});
});

test("同日確定天候は対象時刻だけを時系列で合成し、別日・未完了を除外する", () => {
  const date = "2026-07-29";
  const session15 = createSession({
    date,
    discountTime: "15",
    startedAt: "2026-07-29T06:00:00.000Z",
    entries: {
      "16": { weather: "rain", tempC: 16, windMs: 1 },
      "17": { weather: "sunny", tempC: 17, windMs: 2 },
      "18": { weather: "sunny", tempC: 18, windMs: 3 },
    },
  });
  const session17 = createSession({
    date,
    discountTime: "17",
    startedAt: "2026-07-29T08:00:00.000Z",
    entries: {
      // 17時セッションでは16・17時は入力対象外なので、この値は採用しない。
      "16": { weather: "snow", tempC: 40, windMs: 15 },
      "17": { weather: "snow", tempC: 39, windMs: 14 },
      "18": { weather: "rain", tempC: 28, windMs: 4 },
      "19": { weather: "rain", tempC: 27, windMs: 5 },
    },
  });
  const interrupted18 = createSession({
    date,
    discountTime: "18",
    startedAt: "2026-07-29T09:30:00.000Z",
    entries: {
      "19": { weather: "snow", tempC: 19, windMs: 6 },
    },
  });
  const current18 = createSession({
    date,
    discountTime: "18",
    startedAt: "2026-07-29T09:40:00.000Z",
    entries: {
      "19": { weather: "sunny", tempC: 29, windMs: 7 },
    },
  });
  const incomplete = createSession({
    date,
    discountTime: "18",
    startedAt: "2026-07-29T09:45:00.000Z",
    entries: {
      "19": { weather: "rain", tempC: 38, windMs: 12 },
    },
  });
  const otherDate = createSession({
    date: "2026-07-28",
    discountTime: "15",
    startedAt: "2026-07-28T06:00:00.000Z",
    entries: {
      "16": { weather: "snow", tempC: 5, windMs: 15 },
    },
  });

  const result = buildSameDayConfirmedHourlyWeather({
    date,
    snapshots: [
      createWeatherSnapshot({ session: session17, capturedAt: "2026-07-29T08:30:00.000Z" }),
      createWeatherSnapshot({ session: session15, capturedAt: "2026-07-29T07:00:00.000Z" }),
      createWeatherSnapshot({
        session: interrupted18,
        capturedAt: "2026-07-29T09:35:00.000Z",
        screen: "area_judge",
        sessionEndReason: "auto_time_transition",
      }),
      createWeatherSnapshot({
        session: incomplete,
        capturedAt: "2026-07-29T09:50:00.000Z",
        screen: "area_judge",
      }),
      createWeatherSnapshot({ session: otherDate, capturedAt: "2026-07-28T07:00:00.000Z" }),
    ],
    currentSession: current18,
  });

  assert.deepEqual(result["16"], { weather: "rain", tempC: 16, windMs: 1 });
  assert.deepEqual(result["17"], { weather: "sunny", tempC: 17, windMs: 2 });
  assert.deepEqual(result["18"], { weather: "rain", tempC: 28, windMs: 4 });
  assert.deepEqual(result["19"], { weather: "sunny", tempC: 29, windMs: 7 });
});

test("確認表示モデルは常に16〜21時で、current・同日確定・固定気温・欠損の順に解決する", () => {
  const draft = createInitialSessionDraft();
  draft.date = "2026-07-29";
  draft.discountTime = "19";
  draft.weather.hourlyForecasts["20"] = { weather: "rain", tempC: 30, windMs: 8 };
  draft.weather.hourlyForecasts["21"] = { weather: "snow", tempC: 21, windMs: 9 };
  const confirmedHourlyWeather = {
    "17": { weather: "sunny", tempC: 17, windMs: 2 },
    "19": { weather: "rain", tempC: 19, windMs: 4 },
    // activeな20時はcurrent draftが優先される。
    "20": { weather: "sunny", tempC: 5, windMs: 1 },
  } as const;
  const fixedTimeTemperatures = { "16": 16, "17": 35 } as const;
  const draftBefore = JSON.stringify(draft);
  const confirmedBefore = JSON.stringify(confirmedHourlyWeather);
  const fixedBefore = JSON.stringify(fixedTimeTemperatures);
  const resolvedBefore = resolveWeatherInputForDiscount(draft.weather, draft.discountTime);

  const rows = buildWeatherConfirmationDisplayRows({
    sessionDraft: draft,
    activeHours: getWeatherInputForecastHours(draft.discountTime),
    confirmedHourlyWeather,
    fixedTimeTemperatures,
  });

  assert.deepEqual(rows.map((row) => row.hour), ["16", "17", "18", "19", "20", "21"]);
  assert.deepEqual(rows.map((row) => row.isPast), [true, true, true, true, false, false]);
  assert.deepEqual(rows[0], {
    hour: "16",
    isPast: true,
    weather: null,
    tempC: 16,
    windMs: null,
  });
  assert.deepEqual(rows[1], {
    hour: "17",
    isPast: true,
    weather: "sunny",
    tempC: 17,
    windMs: 2,
  });
  assert.deepEqual(rows[2], {
    hour: "18",
    isPast: true,
    weather: null,
    tempC: null,
    windMs: null,
  });
  assert.deepEqual(rows[3], {
    hour: "19",
    isPast: true,
    weather: "rain",
    tempC: 19,
    windMs: 4,
  });
  assert.deepEqual(rows[4], {
    hour: "20",
    isPast: false,
    weather: "rain",
    tempC: 30,
    windMs: 8,
  });
  assert.deepEqual(rows[5], {
    hour: "21",
    isPast: false,
    weather: "snow",
    tempC: 21,
    windMs: 9,
  });

  assert.equal(JSON.stringify(draft), draftBefore);
  assert.equal(JSON.stringify(confirmedHourlyWeather), confirmedBefore);
  assert.equal(JSON.stringify(fixedTimeTemperatures), fixedBefore);
  assert.deepEqual(
    resolveWeatherInputForDiscount(draft.weather, draft.discountTime),
    resolvedBefore,
  );
});

test("確認表示モデルの過去判定は値引時刻ごとの入力対象だけを現在列にする", () => {
  for (const discountTime of ["15", "17", "18", "19", "20"] as const) {
    const draft = createInitialSessionDraft();
    draft.discountTime = discountTime;
    const activeHours = getWeatherInputForecastHours(discountTime);
    const rows = buildWeatherConfirmationDisplayRows({
      sessionDraft: draft,
      activeHours,
      confirmedHourlyWeather: {},
      fixedTimeTemperatures: {},
    });

    assert.deepEqual(rows.map((row) => row.hour), ["16", "17", "18", "19", "20", "21"]);
    assert.deepEqual(
      rows.filter((row) => !row.isPast).map((row) => row.hour),
      activeHours,
    );
  }
});

test("再読み込み時は入力値・対象時刻・確認待ちを保持し、正式セッションを作らない", () => {
  localStorage.clear();
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const draft = {
    ...createInitialSessionDraft(),
    date,
    weekday: now.getDay(),
    discountTime: "18" as const,
    weatherInputLockedDiscountTime: "18" as const,
  };
  draft.weather.hourlyForecasts["19"] = {
    weather: "rain",
    tempC: 31,
    windMs: 5,
  };
  const storedState = createInitialState(draft);
  localStorage.setItem(STORAGE_KEYS.currentSession, JSON.stringify(storedState));
  localStorage.setItem(STORAGE_KEYS.lastUsedSessionDraft, JSON.stringify(draft));
  saveRuntimeState({
    areaJudgeSelection: null,
    resumeTargetScreen: null,
    timeSwitchTarget: null,
    undoSnapshot: null,
    screenHistory: [],
    weatherConfirmationPending: { date, discountTime: "18" },
  });

  function Probe() {
    const app = useNebikiApp();
    assert.equal(app.derived.weatherConfirmationPending, true);
    assert.equal(app.state.screen, "start");
    assert.equal(app.state.session, null);
    assert.equal(app.state.sessionDraft.discountTime, "18");
    assert.equal(app.state.sessionDraft.weatherInputLockedDiscountTime, "18");
    assert.deepEqual(app.state.sessionDraft.weather.hourlyForecasts["19"], {
      weather: "rain",
      tempC: 31,
      windMs: 5,
    });
    return createElement("span", null, "restored");
  }

  assert.equal(renderToString(createElement(Probe)), "<span>restored</span>");
});

test("確認用一覧の参照では天候補正の解決結果を変更しない", () => {
  const draft = createInitialSessionDraft();
  draft.discountTime = "15";
  draft.weather.hourlyForecasts["16"] = { weather: "rain", tempC: 33, windMs: 4 };
  draft.weather.hourlyForecasts["17"] = { weather: "sunny", tempC: 32, windMs: 3 };
  draft.weather.hourlyForecasts["18"] = { weather: "snow", tempC: 2, windMs: 6 };
  const before = resolveWeatherInputForDiscount(draft.weather, draft.discountTime);

  const rows = getWeatherInputForecastHours(draft.discountTime).map((hour) => ({
    hour,
    ...draft.weather.hourlyForecasts[hour],
  }));
  assert.equal(rows.length, 6);

  const after = resolveWeatherInputForDiscount(draft.weather, draft.discountTime);
  assert.deepEqual(after, before);
});

test("最終風速後は確認要求だけを行い、確定操作だけが既存開始処理へ接続される", () => {
  const startSource = source("src/components/screens/StartScreen.tsx");
  const routerSource = source("src/app/AppRouter.tsx");
  const hookSource = source("src/hooks/useNebikiApp.ts");

  assert.ok(startSource.includes("onRequestWeatherConfirmation();"));
  assert.ok(startSource.includes("onClick={onRequestWeatherConfirmation}"));
  assert.ok(routerSource.includes("onStart={actions.confirmWeatherInput}"));
  assert.ok(!routerSource.includes("onStart={actions.startSession}"));

  const confirmBlock = hookSource.slice(
    hookSource.indexOf("function confirmWeatherInput()"),
    hookSource.indexOf("const areaCountAssistEnabled"),
  );
  assert.ok(confirmBlock.includes("weatherConfirmationSubmittingRef.current"));
  assert.equal(confirmBlock.match(/startSession\(\);/g)?.length, 1);
});

test("修正操作は入力値を消去せず、最後の入力だけ再確定待ちへ戻す", () => {
  const startSource = source("src/components/screens/StartScreen.tsx");
  const hookSource = source("src/hooks/useNebikiApp.ts");
  const correctionBlock = startSource.slice(
    startSource.indexOf("function createCorrectionConfirmationMap"),
    startSource.indexOf("export function StartScreen"),
  );
  const editBlock = hookSource.slice(
    hookSource.indexOf("function editWeatherInput()"),
    hookSource.indexOf("function confirmWeatherInput()"),
  );

  assert.ok(correctionBlock.includes("fieldOrder.at(-1)"));
  assert.ok(correctionBlock.includes("= false"));
  assert.ok(editBlock.includes("setWeatherConfirmationPending(null)"));
  assert.ok(!editBlock.includes("sessionDraft"));
});

test("確認画面は時刻列と天候・気温・風速行を固定表で揃える", () => {
  const panelSource = source("src/components/screens/WeatherConfirmationPanel.tsx");
  assert.ok(panelSource.includes("入力した天候を確認してください"));
  assert.ok(panelSource.includes("天気"));
  assert.ok(panelSource.includes("<table"));
  assert.ok(panelSource.includes("<thead>"));
  assert.ok(panelSource.includes("<tbody>"));
  assert.ok(panelSource.includes('scope="col"'));
  assert.ok(panelSource.includes('scope="row"'));
  assert.ok(panelSource.includes("getForecastWeatherSymbol"));
  assert.ok(panelSource.includes("getForecastWeatherLabel"));
  assert.ok(panelSource.includes("℃"));
  assert.ok(panelSource.includes("m/s"));
  assert.ok(panelSource.includes('tableLayout: "fixed"'));
  assert.ok(panelSource.includes('width: "100%"'));
  assert.ok(panelSource.includes('overflowX: "hidden"'));
  assert.ok(!panelSource.includes('role="list"'));
  assert.ok(!panelSource.includes("<article"));
  assert.ok(!panelSource.includes("gridTemplateColumns"));
  assert.ok(!panelSource.includes("minWidth: 560"));
  assert.ok(!panelSource.includes('overflowX: "auto"'));
});

test("対象時刻と天候・気温・風速は同じhours順で列を作る", () => {
  const panelSource = source("src/components/screens/WeatherConfirmationPanel.tsx");
  const tableBlock = panelSource.slice(
    panelSource.indexOf("<table"),
    panelSource.indexOf("</table>") + "</table>".length,
  );
  const weatherRow = tableBlock.slice(
    tableBlock.indexOf("天気"),
    tableBlock.indexOf("気温"),
  );
  const temperatureRow = tableBlock.slice(
    tableBlock.indexOf("気温"),
    tableBlock.indexOf("風速"),
  );
  const windRow = tableBlock.slice(tableBlock.indexOf("風速"));

  assert.ok(tableBlock.includes("<colgroup>"));
  assert.equal(tableBlock.match(/rows\.map\(/g)?.length, 5);
  assert.ok(weatherRow.includes("getForecastWeatherSymbol(row.weather)"));
  assert.ok(weatherRow.includes('aria-label={getForecastWeatherLabel(row.weather)}'));
  assert.ok(temperatureRow.includes('row.tempC ?? "－"'));
  assert.ok(windRow.includes('row.windMs ?? "－"'));
  assert.ok(temperatureRow.indexOf("℃") < temperatureRow.indexOf("rows.map"));
  assert.ok(windRow.indexOf("m/s") < windRow.indexOf("rows.map"));
  assert.ok(tableBlock.includes("row.isPast"));
  assert.ok(panelSource.includes("入力を修正"));
  assert.ok(panelSource.includes("この内容で確定"));
});

test("修正リクエストと自動失効・履歴復元を区別する", () => {
  const startSource = source("src/components/screens/StartScreen.tsx");
  const hookSource = source("src/hooks/useNebikiApp.ts");
  const editBlock = hookSource.slice(
    hookSource.indexOf("function editWeatherInput()"),
    hookSource.indexOf("function confirmWeatherInput()"),
  );
  const pendingInvalidationBlock = hookSource.slice(
    hookSource.indexOf("if (!weatherConfirmationPending) return;"),
    hookSource.indexOf("if (!undoNotice) return;"),
  );
  const restoreNavigationBlock = hookSource.slice(
    hookSource.indexOf("function restoreNavigationSnapshot"),
    hookSource.indexOf("function pushCurrentNavigationSnapshot"),
  );

  assert.ok(editBlock.includes("setWeatherCorrectionRequestId"));
  assert.ok(!pendingInvalidationBlock.includes("setWeatherCorrectionRequestId"));
  assert.ok(restoreNavigationBlock.includes("setWeatherConfirmationPending(null)"));
  assert.ok(startSource.includes("previousWeatherCorrectionRequestIdRef"));
  assert.ok(startSource.includes("createCorrectionConfirmationMap(fieldOrder)"));
});

test("StartScreen・AppRouter・確認Panelが表示専用モデルと固定時刻キャッシュを正しく配線する", () => {
  const startSource = source("src/components/screens/StartScreen.tsx");
  const routerSource = source("src/app/AppRouter.tsx");
  const panelSource = source("src/components/screens/WeatherConfirmationPanel.tsx");

  assert.ok(routerSource.includes("previousSession={state.session}"));
  assert.ok(routerSource.includes("isFixedTimeMode={testNow instanceof Date}"));

  assert.ok(startSource.includes("buildSameDayConfirmedHourlyWeather"));
  assert.ok(startSource.includes("buildWeatherConfirmationDisplayRows"));
  assert.ok(startSource.includes("loadFixedTimeTemperatures"));
  assert.ok(startSource.includes("saveFixedTimeTemperature"));
  assert.ok(startSource.includes("saveFixedTimeTemperatures"));
  assert.ok(startSource.includes("fixedTimeTemperatures: isFixedTimeMode"));
  assert.ok(startSource.includes("rows={weatherConfirmationRows}"));

  const singleSaveBlock = startSource.slice(
    startSource.indexOf("const confirmTemperature"),
    startSource.indexOf("const confirmWeatherInput"),
  );
  const bulkSaveBlock = startSource.slice(
    startSource.indexOf("const confirmWeatherInput"),
    startSource.indexOf("const handleWeekdayWheel"),
  );
  assert.ok(singleSaveBlock.includes("if (isFixedTimeMode)"));
  assert.ok(singleSaveBlock.includes("saveFixedTimeTemperature"));
  assert.ok(bulkSaveBlock.includes("if (isFixedTimeMode)"));
  assert.ok(bulkSaveBlock.includes("saveFixedTimeTemperatures"));

  assert.ok(panelSource.includes("rows: WeatherConfirmationDisplayRow[]"));
  assert.ok(!panelSource.includes("sessionDraft: SessionDraft"));
  assert.ok(panelSource.includes("rows.map"));
  assert.ok(panelSource.includes("row.isPast"));
  assert.ok(panelSource.includes('row.tempC ?? "－"'));
  assert.ok(panelSource.includes('row.windMs ?? "－"'));
});

console.log(`Weather confirmation checks passed: ${passed}/19`);
