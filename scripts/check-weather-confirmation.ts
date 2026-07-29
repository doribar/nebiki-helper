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
  matchesWeatherConfirmationDraft,
  normalizeWeatherConfirmationPending,
  restoreWeatherConfirmationPending,
} from "../src/domain/weatherConfirmation.ts";
import {
  loadRuntimeState,
  saveRuntimeState,
  STORAGE_KEYS,
} from "../src/domain/storage.ts";
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

test("確認画面は既存記号と単位を使い、横幅固定を持たない", () => {
  const panelSource = source("src/components/screens/WeatherConfirmationPanel.tsx");
  assert.ok(panelSource.includes("入力した天候を確認してください"));
  assert.ok(panelSource.includes("getForecastWeatherSymbol"));
  assert.ok(panelSource.includes("getForecastWeatherLabel"));
  assert.ok(panelSource.includes("℃"));
  assert.ok(panelSource.includes("m/s"));
  assert.ok(panelSource.includes("minmax(0, 1fr)"));
  assert.ok(panelSource.includes('overflowX: "hidden"'));
  assert.ok(!panelSource.includes("minWidth: 560"));
  assert.ok(!panelSource.includes('overflowX: "auto"'));
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

console.log(`Weather confirmation checks passed: ${passed}/12`);
