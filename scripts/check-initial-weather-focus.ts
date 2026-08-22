import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shouldAutoScrollWeatherInputTarget } from "../src/domain/weatherInputAutoAdvance.ts";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("fresh起動では最初のweather targetへ自動scrollしない", () => {
  assert.equal(
    shouldAutoScrollWeatherInputTarget({
      isContinuationEntry: false,
      hasUserAdvanced: false,
      targetKey: "weather-16",
      lastScrolledTargetKey: null,
    }),
    false,
  );
});

test("最初の確認後は16時から17時へ従来どおり自動scrollする", () => {
  assert.equal(
    shouldAutoScrollWeatherInputTarget({
      isContinuationEntry: false,
      hasUserAdvanced: true,
      targetKey: "weather-17",
      lastScrolledTargetKey: null,
    }),
    true,
  );
});

test("17時確認後は18時へ連続scrollし、同じtargetを二重scrollしない", () => {
  assert.equal(
    shouldAutoScrollWeatherInputTarget({
      isContinuationEntry: false,
      hasUserAdvanced: true,
      targetKey: "weather-18",
      lastScrolledTargetKey: "weather-17",
    }),
    true,
  );
  assert.equal(
    shouldAutoScrollWeatherInputTarget({
      isContinuationEntry: false,
      hasUserAdvanced: true,
      targetKey: "weather-18",
      lastScrolledTargetKey: "weather-18",
    }),
    false,
  );
});

test("resumeと自動時刻遷移は既存の初回scrollを維持する", () => {
  assert.equal(
    shouldAutoScrollWeatherInputTarget({
      isContinuationEntry: true,
      hasUserAdvanced: false,
      targetKey: "weather-18",
      lastScrolledTargetKey: null,
    }),
    true,
  );
});

test("fixed-time freshも初回だけ抑止し、入力後は共通の連続scrollを使う", () => {
  for (const targetKey of ["weather-16", "weather-18"]) {
    assert.equal(
      shouldAutoScrollWeatherInputTarget({
        isContinuationEntry: false,
        hasUserAdvanced: false,
        targetKey,
        lastScrolledTargetKey: null,
      }),
      false,
    );
  }
  assert.equal(
    shouldAutoScrollWeatherInputTarget({
      isContinuationEntry: false,
      hasUserAdvanced: true,
      targetKey: "weather-17",
      lastScrolledTargetKey: null,
    }),
    true,
  );
});

test("weather correctionは対象欄への既存scrollを維持できる", () => {
  assert.equal(
    shouldAutoScrollWeatherInputTarget({
      isContinuationEntry: false,
      hasUserAdvanced: true,
      targetKey: "wind-21",
      lastScrolledTargetKey: null,
    }),
    true,
  );
});

test("StartScreenはDOM focusを追加せずscroll gateと入力進行を配線する", () => {
  const startScreen = source("src/components/screens/StartScreen.tsx");
  const helper = source("src/domain/weatherInputAutoAdvance.ts");

  assert.ok(startScreen.includes("shouldAutoScrollWeatherInputTarget({"));
  assert.ok(startScreen.includes("isContinuationEntry: Boolean(startButtonLabel)"));
  assert.ok(startScreen.includes("hasUserAdvancedWeatherInputRef.current = true;"));
  assert.ok(startScreen.includes("lastAutoScrolledWeatherTargetKeyRef.current = key;"));
  assert.equal(startScreen.match(/scrollIntoView\(/g)?.length, 1);
  assert.ok(!startScreen.includes("autoFocus"));
  assert.ok(!startScreen.includes(".focus("));
  assert.ok(!helper.includes('"16"'));
});

test("targetがない完了状態では自動scrollしない", () => {
  assert.equal(
    shouldAutoScrollWeatherInputTarget({
      isContinuationEntry: true,
      hasUserAdvanced: true,
      targetKey: null,
      lastScrolledTargetKey: "wind-21",
    }),
    false,
  );
});
