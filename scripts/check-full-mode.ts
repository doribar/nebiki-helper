import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import {
  FULL_MODE_NOTICE_TEXTS,
  getCanonicalUrlForLegacyHash,
} from "../src/domain/fullMode.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT } from "../src/domain/rateDecisionSnapshot.ts";
import { loadCurrentSession, saveCurrentSession, STORAGE_KEYS } from "../src/domain/storage.ts";
import type { AppState, AreaId, AreaProgress, SessionDraft } from "../src/domain/types.ts";
import { normalizeLoadedState } from "../src/hooks/useNebikiApp.ts";

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
const startSource = source("../src/components/screens/StartScreen.tsx");
const rateSource = source("../src/components/screens/RateDisplayScreen.tsx");
const doneSource = source("../src/components/screens/DoneScreen.tsx");
const autoSkipSource = source("../src/components/screens/AutoSkipNoticeScreen.tsx");
const hookSource = source("../src/hooks/useNebikiApp.ts");
const discountSource = source("../src/domain/discount.ts");

const draft: SessionDraft = {
  date: "2026-07-20",
  weekday: 1,
  discountTime: "17",
  manualWeekdayOverride: false,
  manualDiscountTimeOverride: false,
  weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
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

let passed = 0;
function test(name: string, body: () => void) {
  body();
  passed += 1;
  console.log(`PASS: ${name}`);
}

test("1. 簡易モードのアプリ・Hook・ドメイン実装を削除", () => {
  assert.equal(existsSync(new URL("../src/app/SimpleModeApp.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/hooks/useSimpleMode.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/domain/simpleMode.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/domain/appMode.ts", import.meta.url)), false);
});
test("2. 設定画面にモード切替を表示しない", () => {
  assert.equal(settingsSource.includes("使用モード"), false);
  assert.equal(settingsSource.includes("簡易モード"), false);
});
test("3. 起動は詳細相当の単一AppRouterだけを使用", () => {
  assert.equal(appSource.includes("SimpleModeApp"), false);
  assert.ok(appSource.includes("<AppRouter"));
});
test("4. 旧モード設定は起動時に除去する", () => {
  assert.ok(appSource.includes('removeItem("nebiki-helper/app-mode-v1")'));
  assert.ok(appSource.includes('removeItem("nebiki-helper/simple-mode-state-v1")'));
});

for (const [number, hash] of [[5, "#/step1"], [6, "#/step4"], [7, "#/step8"]] as const) {
  test(`${number}. ${hash}は正規URLへ移行`, () => {
    assert.equal(getCanonicalUrlForLegacyHash({ pathname: "/", search: "", hash }), "/");
  });
}
test("8. 旧URL移行時もクエリを保持", () => {
  assert.equal(
    getCanonicalUrlForLegacyHash({ pathname: "/app/", search: "?testTime=1700", hash: "#/step1" }),
    "/app/?testTime=1700",
  );
  assert.ok(appSource.includes("history.replaceState"));
});
test("9. 旧Step情報を持つセッションを復元可能", () => {
  const legacy = { ...createState(), trainingStep: "step1", trainingStepConfig: { step: "step1" } };
  localStorage.setItem(STORAGE_KEYS.currentSession, JSON.stringify(legacy));
  const normalized = normalizeLoadedState(loadCurrentSession(), draft) as AppState & Record<string, unknown>;
  assert.equal(normalized.screen, "area_judge");
  assert.equal("trainingStep" in normalized, false);
  assert.equal("trainingStepConfig" in normalized, false);
});
test("10. 新規保存データにStep情報を追加しない", () => {
  saveCurrentSession(createState());
  const stored = localStorage.getItem(STORAGE_KEYS.currentSession) ?? "";
  assert.equal(stored.includes("trainingStep"), false);
});

const rate = getNormalTimeRateDisplay({
  discountTime: "17",
  weatherBonus: 5,
  areaJudge: "normal",
  areaRateAdjustment: 0,
  weekdayBase: "火木日",
});
test("11. 通常商品の既存値引率を維持", () => assert.equal(rate.normal.main, "15%"));
test("12. 多い商品の既存値引率を維持", () => assert.equal(rate.many.main, "25%"));
test("13. 10個以上+5%の専用noteを削除", () => assert.equal(rate.many.note, undefined));
test("14. 10個以上専用計算コードを削除", () => {
  assert.equal(discountSource.includes("10個以上"), false);
  assert.equal(discountSource.includes("manyThreshold"), false);
});

test("15. 注意事項は補正商品を統合した5項目", () => {
  assert.equal(FULL_MODE_NOTICE_TEXTS.length, 5);
  assert.equal(FULL_MODE_NOTICE_TEXTS.some((text) => text.includes("10個以上")), false);
});
test("16. -10%商品を1項目へ統合", () => assert.ok(FULL_MODE_NOTICE_TEXTS.includes("定番商品・夜によく売れる商品・広告商品は、表示値引率から-10%")));
test("17. -10%商品の分類を維持", () => {
  const notice = FULL_MODE_NOTICE_TEXTS.find((text) => text.includes("-10%")) ?? "";
  assert.ok(notice.includes("定番商品"));
  assert.ok(notice.includes("夜によく売れる商品"));
  assert.ok(notice.includes("広告商品"));
});
test("18. +10%商品を1項目へ統合", () => assert.ok(FULL_MODE_NOTICE_TEXTS.includes("見た目が悪い個別商品・不人気な商品は、表示値引率に+10%")));
test("19. +10%商品の分類を維持", () => {
  const notice = FULL_MODE_NOTICE_TEXTS.find((text) => text.includes("+10%")) ?? "";
  assert.ok(notice.includes("見た目が悪い個別商品"));
  assert.ok(notice.includes("不人気な商品"));
});
test("20. 広告商品は常時-10%の文言", () => {
  assert.ok(FULL_MODE_NOTICE_TEXTS.some((text) => text.includes("広告商品") && text.includes("-10%")));
  assert.equal(FULL_MODE_NOTICE_TEXTS.some((text) => text.includes("売れ方が順調なら")), false);
});
test("21. 保存スナップショットでも広告補正は常時-10%", () => {
  assert.equal(PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT.advertisementPercent, -10);
  assert.equal(PRODUCT_ADJUSTMENT_POLICY_SNAPSHOT.advertisementMode, "always");
});
test("22. 値引画面に広告の追加判断分岐がない", () => {
  assert.equal(rateSource.includes("売れ方が順調"), false);
  assert.equal(hookSource.includes("advertisementSales"), false);
});

test("23. 先取り値引済み画面は3択", () => {
  assert.ok(autoSkipSource.includes("残数だけ記録する"));
  assert.ok(autoSkipSource.includes("今回は値引する"));
  assert.ok(autoSkipSource.includes("測定せずスキップする"));
});
test("24. 先取り3ルートをRouterへ接続", () => {
  assert.ok(routerSource.includes("onRecordCountOnly={actions.startAutoSkippedAreaCountOnly}"));
  assert.ok(routerSource.includes("onProcessNormally={actions.processAutoSkippedAreaNormally}"));
  assert.ok(routerSource.includes("onSkipWithoutMeasurement={actions.skipAutoSkippedAreaWithoutMeasurement}"));
});
test("25. 18:30完了画面に19:00開始ボタンがない", () => assert.equal(doneSource.includes("19:00チェックを始める"), false));
test("26. 天候入力側の19:00開始導線は維持", () => assert.ok(startSource.includes("19:00チェックを始める")));
test("27. UIに19:00チェック対象外操作がない", () => {
  assert.equal(startSource.includes("19:00チェック対象外"), false);
  assert.equal(routerSource.includes("markReview19NotApplicable"), false);
  assert.equal(hookSource.includes("markReview19NotApplicable"), false);
});
test("28. 19時チェックと1日データを全件・最新の4導線へ分離", () => {
  for (const label of [
    "19:00チェックデータを全件出力",
    "最新の19:00チェックデータを出力",
    "1日データを全件出力",
    "最新の1日データを出力",
  ]) {
    assert.ok(settingsSource.includes(label));
  }
  assert.equal(settingsSource.includes("全データを出力"), false);
  assert.ok(routerSource.includes("actions.exportCompletedReview19Data()"));
  assert.ok(routerSource.includes("actions.exportCompletedDailyData(memo)"));
});
test("29. 天候入力の予報キーは16〜21時だけ", () => {
  assert.deepEqual(Object.keys(createDefaultHourlyForecasts()), ["16", "17", "18", "19", "20", "21"]);
});
test("30. schema v3・appVersion・buildIdをアプリ情報に持つ", () => {
  const version = getCurrentDataVersionInfo();
  const packageVersion = (JSON.parse(source("../package.json")) as { version: string }).version;
  assert.equal(version.dataSchemaVersion, 3);
  assert.ok(/^2026\.8\.5-/.test(packageVersion));
  assert.ok(version.buildId.length > 0);
});
test("31. 通常日の曜日グループを維持", () => assert.equal(getAreaCountComparisonWeekdayGroup({ weekday: 2, discountTime: "17", date: "2026-07-21" }), "火木日"));
test("32. 祝前日の曜日グループを維持", () => assert.equal(getAreaCountComparisonWeekdayGroup({ weekday: 1, discountTime: "17", date: "2026-11-02" }), "金土"));
test("33. 三連休中日の専用分類を維持", () => assert.equal(getAreaCountFallbackWeekdayGroup({ weekday: 0, discountTime: "17", date: "2026-07-19" }), "三連休中日"));
test("34. 一般の祝前日注意を維持", () => assert.equal(shouldShowDayBeforeHolidayNotice({ sessionDate: "2026-11-02", discountTime: "17" }), true));
test("35. 三連休中日注意を維持", () => assert.equal(shouldShowThreeDayHolidayMiddleNotice({ sessionDate: "2026-07-19", discountTime: "17" }), true));
test("36. 翌日平日祝日注意を維持", () => assert.equal(shouldShowHolidayBeforeNormalWeekdayNotice({ sessionDate: "2026-07-20", discountTime: "15" }), true));

console.log(`\n統一詳細モード回帰テスト: ${passed}/36件成功`);
