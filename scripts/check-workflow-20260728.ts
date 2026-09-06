import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatJstCalendarDate,
  getPreviousCalendarDate,
  getPreviousJstCalendarDate,
} from "../src/domain/jstCalendar.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import {
  createInitialState,
  normalizeLoadedState,
} from "../src/hooks/nebikiApp/stateNormalization.ts";
import type { AppState, SessionDraft } from "../src/domain/types.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(`${projectRoot}/${path}`, "utf8");
const hookSource = source("src/hooks/useNebikiApp.ts");
const routerSource = source("src/app/AppRouter.tsx");
const reviewSource = source("src/components/screens/Review19Screen.tsx");
const reviewDoneSource = source("src/components/screens/Review19DoneScreen.tsx");
const startSource = source("src/components/screens/StartScreen.tsx");
const doneSource = source("src/components/screens/DoneScreen.tsx");

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`OK: ${name}`);
}

test("日本時間の日付境界から必ず前日を選ぶ", () => {
  assert.equal(
    formatJstCalendarDate(new Date("2026-07-28T14:59:59.000Z")),
    "2026-07-28",
  );
  assert.equal(
    getPreviousJstCalendarDate(new Date("2026-07-28T14:59:59.000Z")),
    "2026-07-27",
  );
  assert.equal(
    formatJstCalendarDate(new Date("2026-07-28T15:00:00.000Z")),
    "2026-07-29",
  );
  assert.equal(
    getPreviousJstCalendarDate(new Date("2026-07-28T15:00:00.000Z")),
    "2026-07-28",
  );
  assert.equal(getPreviousCalendarDate("2026-01-01"), "2025-12-31");
  assert.equal(getPreviousCalendarDate("2026-02-30"), null);
});

test("残数修正コンテキストは再読込後もcount-only種別と復帰先を保持", () => {
  const draft: SessionDraft = {
    date: "2026-07-28",
    weekday: 2,
    discountTime: "19",
    manualWeekdayOverride: false,
    manualDiscountTimeOverride: false,
    weather: {
      hourlyForecasts: createDefaultHourlyForecasts(),
      afterRainSky: null,
    },
  };
  const state = createInitialState(draft) as AppState;
  state.areaCountCorrection = {
    mode: "auto_skip_count_only",
    targetAreaId: "bento_men",
    returnScreen: "rate_display",
    returnAreaId: "tempura",
    returnLastReferenceAreaId: "bento_men",
    returnCurrentFlow: "pending",
    returnPendingDeferredAreaIds: ["sushi"],
    returnFinalTimeStep: 2,
    returnTimeSwitchNotice: "復帰",
    returnHistoryLength: 4,
  };
  const restored = normalizeLoadedState(
    JSON.parse(JSON.stringify(state)) as AppState,
    draft,
  );
  assert.deepEqual(restored.areaCountCorrection, state.areaCountCorrection);
});

test("先取りcount-only修正は通常値引へ変換せずlocal-first同期経路で復帰", () => {
  const startBlock = hookSource.slice(
    hookSource.indexOf("function startAreaCountCorrection"),
    hookSource.indexOf("function startEditingConditions"),
  );
  const saveBlock = hookSource.slice(
    hookSource.indexOf("function saveAutoSkippedAreaCount"),
    hookSource.indexOf("function skipAutoSkippedAreaWithoutMeasurement"),
  );
  assert.match(startBlock, /earlyDiscountResolution === "count_only"/);
  assert.match(startBlock, /"auto_skip_count_only"/);
  assert.match(startBlock, /"auto_skip_count"/);
  assert.match(saveBlock, /persistAreaCountRecordSafely\(nextRecord\)/);
  assert.match(saveBlock, /if \(!nextAreaCountRecords\) return/);
  assert.match(saveBlock, /retryPendingCloudSync\(\)/);
  assert.match(saveBlock, /areaCountCorrection\.mode === "auto_skip_count_only"/);
  assert.match(saveBlock, /screen: correction\.returnScreen/);
});

test("20:30正式確定はdoneで再構築せずBack・再入力でも同じ正式IDを維持", () => {
  const snapshotEffect = hookSource.slice(
    hookSource.indexOf("// 20:30は全エリア入力完了時"),
    hookSource.indexOf("const savedReview19Records"),
  );
  const finalizer = hookSource.slice(
    hookSource.indexOf("function finalizeFinalDayData"),
    hookSource.indexOf("function judgeCurrentArea"),
  );
  const restore = hookSource.slice(
    hookSource.indexOf("function restoreNavigationSnapshot"),
    hookSource.indexOf("const previousRenderRef"),
  );
  assert.match(snapshotEffect, /discountTime === "20"\) return/);
  assert.match(finalizer, /!progress\.rateDecisionSnapshot/);
  assert.match(finalizer, /: progress\.rateDecisionSnapshot/);
  assert.match(finalizer, /initializeArchivedFinalizedDay/);
  assert.match(finalizer, /replaceArchivedFinalizedDay/);
  assert.match(restore, /restoredState\.finalizedDayRecordId = state\.finalizedDayRecordId/);
  assert.equal(routerSource.includes("shouldSkipFinalDoneScreen"), false);
});

test("19:00チェックは入力中・完了直後の戻ると残数修正とコピーを備える", () => {
  assert.ok(reviewSource.includes("入力した残数を修正"));
  assert.match(reviewSource, /countCorrectionReturnAreaId/);
  assert.match(reviewSource, /onGoBack\(\)/);
  assert.ok(reviewDoneSource.includes("戻る"));
  assert.ok(reviewDoneSource.includes("ChatGPT用にコピー"));
  assert.match(routerSource, /onGoBack=\{actions\.goBackOneScreen\}/);
  assert.match(routerSource, /onCopyReview19Data=\{actions\.copyCompletedReview19Data\}/);
});

test("判定確定前の現在エリアも入力済み残数の修正対象に含める", () => {
  const judgeSource = source("src/components/screens/AreaJudgeScreen.tsx");
  assert.match(judgeSource, /areaCountSubmitted && parsedAreaCount !== null/);
  assert.match(judgeSource, /\{ areaId, areaName, count: parsedAreaCount \}/);
  assert.match(judgeSource, /items=\{correctionAreaCounts\}/);
  assert.match(
    judgeSource,
    /parsedAreaCount !== null\s*\? String\(parsedAreaCount\)/,
  );
});

test("AreaJudgeから天候入力へ戻る場合だけ確認し、PIN UIは残さない", () => {
  const goBackBlock = hookSource.slice(
    hookSource.indexOf("function goBackOneScreen"),
    hookSource.indexOf("function startAreaCountCorrection"),
  );
  assert.match(goBackBlock, /state\.screen === "area_judge"/);
  assert.match(goBackBlock, /previousSnapshot\?\.state\.screen === "start"/);
  assert.ok(goBackBlock.includes("天候入力画面に戻りますか？"));
  assert.match(goBackBlock, /!window\.confirm/);
  assert.equal(
    existsSync(`${projectRoot}/src/domain/adminSettings.ts`),
    false,
  );
  assert.equal(source("src/components/common/AdminSettingsDialog.tsx").includes("PIN"), false);
});

test("前日廃棄・最終メモ・各完了画面の1件出力UIを接続", () => {
  assert.ok(startSource.includes("廃棄個数を入力"));
  assert.ok(startSource.includes("対象日："));
  assert.match(startSource, /discardCountText === "" \? null/);
  assert.ok(doneSource.includes("任意メモ"));
  assert.ok(doneSource.includes("1日データを出力"));
  assert.match(hookSource, /patch: \{ memo \}/);
  assert.match(hookSource, /patch: \{ discardCount: count \}/);
  assert.match(routerSource, /actions\.exportCompletedDailyData\(memo\)/);
});

console.log(`\n画面遷移・修正・日次確定回帰テスト: ${passed}/8件成功`);
