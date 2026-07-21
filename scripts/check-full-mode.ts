import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  getAreaCountComparisonWeekdayGroup,
  getAreaCountFallbackWeekdayGroup,
} from "../src/domain/areaCountHistory.ts";
import {
  shouldShowDayBeforeHolidayNotice,
  shouldShowHolidayBeforeNormalWeekdayNotice,
  shouldShowThreeDayHolidayMiddleNotice,
} from "../src/domain/dayBeforeHolidayNotice.ts";
import { getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import {
  FULL_MODE_NOTICE_TEXTS,
  getCanonicalUrlForLegacyHash,
} from "../src/domain/fullMode.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { loadCurrentSession, saveCurrentSession, STORAGE_KEYS } from "../src/domain/storage.ts";
import type {
  AppState,
  AreaId,
  AreaProgress,
  SessionDraft,
} from "../src/domain/types.ts";
import {
  getInitialTimeSwitchTarget,
  normalizeLoadedState,
} from "../src/hooks/useNebikiApp.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new MemoryStorage(),
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const appSource = source("../src/app/App.tsx");
const routerSource = source("../src/app/AppRouter.tsx");
const settingsSource = source("../src/components/common/AdminSettingsDialog.tsx");
const areaJudgeSource = source("../src/components/screens/AreaJudgeScreen.tsx");
const rateSource = source("../src/components/screens/RateDisplayScreen.tsx");
const doneSource = source("../src/components/screens/DoneScreen.tsx");
const autoSkipSource = source("../src/components/screens/AutoSkipNoticeScreen.tsx");
const simpleSource = source("../src/app/SimpleModeApp.tsx");
const hookSource = source("../src/hooks/useNebikiApp.ts");
const typeSource = source("../src/domain/types.ts");
const uiAndLogicSource = [
  appSource,
  routerSource,
  settingsSource,
  areaJudgeSource,
  rateSource,
  doneSource,
  autoSkipSource,
  hookSource,
  typeSource,
].join("\n");

const draft: SessionDraft = {
  date: "2026-07-20",
  weekday: 1,
  discountTime: "17",
  manualWeekdayOverride: false,
  manualDiscountTimeOverride: false,
  weather: {
    hourlyForecasts: createDefaultHourlyForecasts(),
    afterRainSky: null,
  },
};

const progressMap = Object.fromEntries(
  NORMAL_ROUTE.map((areaId) => [
    areaId,
    { areaId, status: "unstarted", areaJudge: null } satisfies AreaProgress,
  ]),
) as Record<AreaId, AreaProgress>;

function createState(): AppState {
  return {
    screen: "area_judge",
    session: { ...draft, startedAt: "2026-07-20T08:00:00.000Z" },
    sessionDraft: draft,
    areaProgressMap: progressMap,
    normalFlowOrder: [...NORMAL_ROUTE],
    currentAreaId: NORMAL_ROUTE[0],
    lastReferenceAreaId: null,
    currentFlow: "normal",
    pendingDeferredAreaIds: [],
    timeSwitchNotice: null,
    finalTimeStep: 0,
    review19: null,
    review19ExcludedAreaIds: [],
  };
}

const formerFullModeRate = getNormalTimeRateDisplay({
  discountTime: "17",
  weatherBonus: 5,
  areaJudge: "normal",
  areaRateAdjustment: 0,
  weekdayBase: "火木日",
});

let passed = 0;
function test(name: string, body: () => void) {
  try {
    body();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

test("1. 設定画面に習熟段階の選択を表示しない", () => {
  assert.equal(settingsSource.includes("使用するステップ"), false);
  assert.equal(settingsSource.includes("このステップに変更する"), false);
});
test("2. 画面コードに旧段階名を表示する分岐がない", () => assert.equal(/step[1-8]/i.test(uiAndLogicSource), false));
test("3. 通常起動は完成版UIだけを組み立てる", () => {
  assert.equal(uiAndLogicSource.includes("trainingStepConfig."), false);
  assert.ok(rateSource.includes("どちらでもない商品"));
});
for (const [number, hash] of [[4, "#/step1"], [5, "#/step4"], [6, "#/step8"]] as const) {
  test(`${number}. ${hash}は完成版の正規URLへ移行する`, () => {
    assert.equal(getCanonicalUrlForLegacyHash({ pathname: "/", search: "", hash }), "/");
  });
}
test("7. 旧URL移行は動作確認クエリを保持する", () => {
  assert.equal(getCanonicalUrlForLegacyHash({ pathname: "/app/", search: "?testTime=1700", hash: "#/step1" }), "/app/?testTime=1700");
  assert.ok(appSource.includes("history.replaceState"));
});
for (const [number, oldValue] of [[8, "step1"], [9, "step4"], [10, "step8"]] as const) {
  test(`${number}. 保存済み${oldValue}は完成版の計算を制限しない`, () => {
    localStorage.setItem("nebiki-helper/preferred-training-step-v1", oldValue);
    assert.equal(getNormalTimeRateDisplay({ discountTime: "17", weatherBonus: 5, areaJudge: "normal", areaRateAdjustment: 0, weekdayBase: "火木日" }).many.main, formerFullModeRate.many.main);
  });
}
test("11. 残数入力を常に表示する", () => assert.ok(areaJudgeSource.includes("このエリア全体で、消費期限が今日までの商品数は？")));
test("12. 履歴不足時の手動5段階判定を常に表示する", () => {
  for (const label of ["多い", "やや多い", "普通", "やや少ない", "少ない"]) assert.ok(areaJudgeSource.includes(`label="${label}"`));
});
test("13. 10個以上商品の追加5%を維持する", () => assert.ok(formerFullModeRate.many.note?.includes("10個以上は 30%")));
test("14. 定番商品の-10%指示を常時表示する", () => assert.ok(FULL_MODE_NOTICE_TEXTS.includes("定番商品は、表示値引率から-10%")));
test("15. 夜によく売れる商品の-10%指示を常時表示する", () => assert.ok(FULL_MODE_NOTICE_TEXTS.includes("夜によく売れる商品は、表示値引率から-10%")));
test("16. 見た目が悪い商品の+10%指示を常時表示する", () => assert.ok(FULL_MODE_NOTICE_TEXTS.includes("見た目が悪い個別商品は、表示値引率に+10%")));
test("17. 不人気商品の+10%指示を常時表示する", () => assert.ok(FULL_MODE_NOTICE_TEXTS.includes("不人気な商品は、表示値引率に+10%")));
test("18. 商品の減り方を含む判断を常時表示する", () => assert.ok(FULL_MODE_NOTICE_TEXTS.some((text) => text.includes("商品の減り方"))));
test("19. 広告商品の当日判断を常時表示する", () => assert.ok(FULL_MODE_NOTICE_TEXTS.some((text) => text.startsWith("広告商品は"))));
test("20. 旧完成版の計算スナップショットと一致する", () => {
  assert.deepEqual(formerFullModeRate, { many: { main: "25%", note: "多いのうち10個以上は 30%" }, few: { main: "引かない" }, normal: { main: "15%" } });
});
test("21. 指定文言を除いた注意事項8項目を固定表示する", () => {
  assert.equal(FULL_MODE_NOTICE_TEXTS.length, 8);
  assert.ok(rateSource.includes("FULL_MODE_NOTICE_ITEMS.map"));
  assert.ok(rateSource.includes("<NoticeItems />"));
});
test("22. 注意事項に段階別ID・分岐がない", () => {
  assert.equal(rateSource.includes("NoticeItemId"), false);
  assert.equal(rateSource.includes("noticeItemIds"), false);
});
test("23. 習熟段階向け説明をUIから除去する", () => assert.equal(/新人|習熟段階|step[1-8]/i.test(uiAndLogicSource), false));
test("24. 一般の祝前日注意を段階条件なしで表示する", () => assert.equal(shouldShowDayBeforeHolidayNotice({ sessionDate: "2026-11-02", discountTime: "17" }), true));
test("25. 三連休中日注意を段階条件なしで表示する", () => assert.equal(shouldShowThreeDayHolidayMiddleNotice({ sessionDate: "2026-07-19", discountTime: "17" }), true));
test("26. 翌日平日祝日注意を段階条件なしで表示する", () => assert.equal(shouldShowHolidayBeforeNormalWeekdayNotice({ sessionDate: "2026-07-20", discountTime: "15" }), true));
test("27. 祝日注意の優先順位と二重表示防止を維持する", () => {
  assert.equal(shouldShowDayBeforeHolidayNotice({ sessionDate: "2026-07-19", discountTime: "17" }), false);
  assert.equal(shouldShowHolidayBeforeNormalWeekdayNotice({ sessionDate: "2026-07-19", discountTime: "17" }), false);
  assert.equal(shouldShowThreeDayHolidayMiddleNotice({ sessionDate: "2026-07-19", discountTime: "17" }), true);
});
test("28. 旧段階情報を持つセッションを復元できる", () => {
  const legacy = { ...createState(), trainingStep: "step1", trainingStepConfig: { step: "step1" } };
  localStorage.setItem(STORAGE_KEYS.currentSession, JSON.stringify(legacy));
  const normalized = normalizeLoadedState(loadCurrentSession(), draft);
  assert.equal(normalized.screen, "area_judge");
});
test("29. 旧セッション復元後は段階情報を処理状態から除去する", () => {
  const legacy = { ...createState(), trainingStep: "step4", trainingStepConfig: { step: "step4" } };
  const normalized = normalizeLoadedState(legacy as AppState, draft) as AppState & Record<string, unknown>;
  assert.equal("trainingStep" in normalized, false);
  assert.equal("trainingStepConfig" in normalized, false);
});
test("30. 既存残数履歴の通常曜日グループを利用できる", () => assert.equal(getAreaCountComparisonWeekdayGroup({ weekday: 2, discountTime: "17", date: "2026-07-21" }), "火木日"));
test("31. Supabase履歴と同じ曜日グループ正規化を維持する", () => assert.ok(source("../src/domain/areaCountRemoteStorage.ts").includes("normalizeAreaCountRecords")));
test("32. 新規セッション保存が成功する", () => {
  saveCurrentSession(createState());
  assert.equal(loadCurrentSession()?.session?.discountTime, "17");
});
test("33. 新規保存データに段階情報を追加しない", () => {
  saveCurrentSession(createState());
  const stored = localStorage.getItem(STORAGE_KEYS.currentSession) ?? "";
  assert.equal(stored.includes("trainingStep"), false);
});
test("34. 通常日の曜日グループを維持する", () => assert.equal(getAreaCountComparisonWeekdayGroup({ weekday: 5, discountTime: "17", date: "2026-07-24" }), "金土"));
test("35. 祝前日の曜日グループを維持する", () => assert.equal(getAreaCountComparisonWeekdayGroup({ weekday: 1, discountTime: "17", date: "2026-11-02" }), "金土"));
test("36. 三連休中日の専用基準を維持する", () => assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 0, discountTime: "17", date: "2026-07-19" }), "三連休中日"));
test("37. 翌日平日祝日の日曜日基準を維持する", () => assert.equal(getAreaCountComparisonWeekdayGroup({ weekday: 1, discountTime: "17", date: "2026-07-20" }), "火木日"));
test("38. 19時チェック処理から段階分岐を除去しても参照処理を維持する", () => {
  assert.ok(hookSource.includes("selectReview19SourceState"));
  assert.equal(hookSource.includes("trainingStepConfig."), false);
  assert.equal(hookSource.includes('=== "step1"'), false);
});
test("39. 自動時刻遷移の復元判定を維持する", () => assert.equal(getInitialTimeSwitchTarget("18", false), "18"));
test("40. 再読み込み用状態を正規化して残数入力画面を維持する", () => assert.equal(normalizeLoadedState(createState(), draft).currentAreaId, NORMAL_ROUTE[0]));
test("41. 固定完成版の値引計算は保存済み旧段階値に依存しない", () => {
  localStorage.setItem("nebiki-helper/preferred-training-step-v1", "step1");
  const step1Result = getNormalTimeRateDisplay({ discountTime: "17", weatherBonus: 5, areaJudge: "normal", areaRateAdjustment: 0, weekdayBase: "火木日" });
  localStorage.setItem("nebiki-helper/preferred-training-step-v1", "step8");
  const step8Result = getNormalTimeRateDisplay({ discountTime: "17", weatherBonus: 5, areaJudge: "normal", areaRateAdjustment: 0, weekdayBase: "火木日" });
  assert.deepEqual(step1Result, step8Result);
});

test("42. 詳細モードから10個以上を多いと断定しない注意文だけを削除する", () => {
  assert.equal(FULL_MODE_NOTICE_TEXTS.includes("10個以上あっても、必ず「多い」になるわけではありません。"), false);
  assert.equal(rateSource.includes("10個以上あっても"), false);
});
test("43. 先取り値引済みエリアに説明と2つの未選択ボタンを表示する", () => {
  assert.ok(autoSkipSource.includes("このエリアは先取り値引済みです"));
  assert.ok(autoSkipSource.includes("現在の残数を確認して、追加で値引することもできます。"));
  assert.ok(autoSkipSource.includes("スキップする"));
  assert.ok(autoSkipSource.includes("今回は値引する"));
});
test("44. 先取り選択画面に内部向け表現を表示しない", () => {
  assert.equal(autoSkipSource.includes("弁当側"), false);
  assert.equal(autoSkipSource.includes("自動スキップ解除"), false);
});
test("45. 詳細モードだけが先取り済みエリアの通常処理アクションを接続する", () => {
  assert.ok(routerSource.includes("onProcessNormally={actions.processAutoSkippedAreaNormally}"));
  assert.equal(simpleSource.includes("processAutoSkippedAreaNormally"), false);
});
test("46. スキップと通常処理は既存のエリア進捗を使い分ける", () => {
  assert.ok(hookSource.includes("acknowledgeAutoSkippedProgress"));
  assert.ok(hookSource.includes("processEarlyNextMinus5AreaNormally"));
});

console.log(`\n完成版固定テスト: ${passed}/46件成功`);
