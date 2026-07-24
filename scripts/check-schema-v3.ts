import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getNormalRoute } from "../src/domain/area.ts";
import type { AreaCountRecord } from "../src/domain/areaCountHistory.ts";
import { buildAutomaticDayExportDataQuality } from "../src/domain/dayExport.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import {
  buildEarlyNextMinus5RateDecisionSnapshot,
  buildLatePlus5RateDecisionSnapshot,
  buildNormalRateDecisionSnapshot,
  reconstructRateDisplayFromSnapshot,
} from "../src/domain/rateDecisionSnapshot.ts";
import {
  loadDailySessionSnapshots,
  saveDailySessionSnapshots,
  upsertDailySessionSnapshot,
} from "../src/domain/storage.ts";
import type {
  AppState,
  AreaId,
  AreaProgress,
  DailySessionSnapshot,
  ResolvedWeatherInput,
  Review19AreaSnapshot,
  Review19DaySnapshot,
  SessionDraft,
} from "../src/domain/types.ts";
import {
  acknowledgeAutoSkippedProgress,
  finalizeUnmeasuredAreasForAutoTransition,
  normalizeAreaProgressMap,
  processEarlyNextMinus5AreaNormally,
  recordAutoSkippedCountOnlyProgress,
  startAutoSkippedCountOnlyProgress,
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

const versionInfo = getCurrentDataVersionInfo();
const resolvedWeather: ResolvedWeatherInput = {
  nearTermWeather: "other",
  hasLaterPrecip: false,
  laterPrecipType: null,
  precipitationRateBonus: 0,
  precipitationRateBonusLabel: null,
  windLevel: "2orLess",
  tempLevel: "21to25",
  weatherPointScore: 0,
  weatherPointShift: 0,
  weatherPointRangeText: null,
  next18TempDropShift: 0,
  next18WindWorsenShift: 0,
  next18WindWorsenKind: null,
  afterRainSky: null,
};

let passed = 0;
function test(name: string, body: () => void) {
  body();
  passed += 1;
  console.log(`PASS: ${name}`);
}

const normal1830 = buildNormalRateDecisionSnapshot({
  confirmedAt: "2026-07-21T09:55:00.000Z",
  sessionDiscountTime: "18",
  weatherComfortAdjustmentPercent: 0,
  areaJudge: "normal",
  areaRateAdjustment: 0,
  resolvedWeather,
  weekday: 2,
  date: "2026-07-21",
});
const early1930 = buildEarlyNextMinus5RateDecisionSnapshot({
  confirmedAt: "2026-07-21T10:05:00.000Z",
  sessionDiscountTime: "18",
  effectiveRateDiscountTime: "19",
  weatherComfortAdjustmentPercent: 0,
  areaJudge: "normal",
  areaRateAdjustment: 0,
  resolvedWeather,
  weekday: 2,
  date: "2026-07-21",
});
const late1730 = buildLatePlus5RateDecisionSnapshot({
  confirmedAt: "2026-07-21T08:50:00.000Z",
  sessionDiscountTime: "17",
  weatherComfortAdjustmentPercent: 0,
  areaJudge: "normal",
  areaRateAdjustment: 0,
  resolvedWeather,
  weekday: 2,
  date: "2026-07-21",
});

test("1. 18:30で19時前に確定した率は18:30通常率として固定", () => {
  assert.equal(normal1830.sessionDiscountTime, "18");
  assert.equal(normal1830.effectiveRateDiscountTime, "18");
  assert.equal(normal1830.calculationMode, "normal");
  assert.equal(reconstructRateDisplayFromSnapshot(normal1830)?.normal.main, normal1830.displayedRateText);
});
test("2. 19:00〜19:24の先取り率はearly_next_minus5として固定", () => {
  assert.equal(early1930.sessionDiscountTime, "18");
  assert.equal(early1930.effectiveRateDiscountTime, "19");
  assert.equal(early1930.calculationMode, "early_next_minus5");
  assert.equal(early1930.earlyNextAdjustmentPercent, -5);
});
test("3. 遅い時間帯+5%は独立した計算モードで固定", () => {
  assert.equal(late1730.calculationMode, "late_plus5");
  assert.equal(late1730.lateTimeAdjustmentPercent, 5);
});
test("4. スナップショット内訳から実表示率を再現可能", () => {
  assert.equal(
    early1930.normalRatePercent,
    Math.max(0, Math.min(50, early1930.normalRateAfterBaseLimitsPercent - 5)),
  );
  assert.equal(reconstructRateDisplayFromSnapshot(early1930)?.normal.main, early1930.displayedRateText);
});
test("5. 率スナップショットは深くfreezeされる", () => {
  assert.equal(Object.isFrozen(normal1830), true);
  assert.equal(Object.isFrozen(normal1830.otherAdjustments.productPolicy), true);
});
test("6. 15時確定スナップショットは後の時計に依存しない", () => {
  const at15 = buildNormalRateDecisionSnapshot({
    confirmedAt: "2026-07-21T06:30:00.000Z",
    sessionDiscountTime: "15",
    weatherComfortAdjustmentPercent: 0,
    areaJudge: "normal",
    areaRateAdjustment: 0,
    resolvedWeather,
    weekday: 2,
    date: "2026-07-21",
  });
  const serialized = JSON.stringify(at15);
  assert.equal(JSON.stringify(at15), serialized);
  assert.equal(at15.sessionDiscountTime, "15");
});
test("7. 19:30確定スナップショットは20:15以降にも再計算不要", () => {
  const at1930 = buildNormalRateDecisionSnapshot({
    confirmedAt: "2026-07-21T10:45:00.000Z",
    sessionDiscountTime: "19",
    weatherComfortAdjustmentPercent: 5,
    areaJudge: "normal",
    areaRateAdjustment: 0,
    resolvedWeather,
    weekday: 2,
    date: "2026-07-21",
  });
  assert.equal(reconstructRateDisplayFromSnapshot(at1930)?.normal.main, at1930.displayedRateText);
  assert.equal(at1930.confirmedAt, "2026-07-21T10:45:00.000Z");
});

const date = "2026-11-10";
const route = getNormalRoute(date);
function makeAreaSnapshot(areaId: AreaId): Review19AreaSnapshot {
  return {
    areaId,
    areaName: areaId,
    status: "completed",
    areaJudge: "normal",
    judgeText: "普通",
    rateText: normal1830.displayedRateText,
    ratePercent: normal1830.displayedRatePercent,
    normalRateText: normal1830.display?.normal.main,
    normalRatePercent: normal1830.displayedNormalRatePercent,
    manyRateText: normal1830.display?.many.main,
    manyRatePercent: normal1830.displayedManyRatePercent,
    completedAt: normal1830.confirmedAt,
    rateDecisionSnapshot: normal1830,
    rateDecisionSnapshotStatus: "captured",
    measurementStatus: "measured",
  };
}

const areas = Object.fromEntries(route.map((areaId) => [areaId, makeAreaSnapshot(areaId)])) as Record<AreaId, Review19AreaSnapshot>;
const baseSnapshot: DailySessionSnapshot = {
  version: 1,
  ...versionInfo,
  capturedAt: "2026-11-10T10:00:00+09:00",
  basisCapturedAt: "2026-11-10T10:00:00+09:00",
  sessionEndReason: "completed",
  screen: "done",
  session: {
    ...versionInfo,
    date,
    weekday: 2,
    discountTime: "18",
    startedAt: "2026-11-10T09:00:00+09:00",
    manualWeekdayOverride: false,
    manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
    resolvedWeather,
  },
  basis: {
    rateLogicVersion: "time_basic_rate_v1",
    baseRateBonus: 0,
    lateTimeBonus: 0,
    totalRateBonus: 0,
    baseRateBonusReason: [],
  },
  areas,
  doneSummaryItems: [],
  currentAreaId: null,
  review19ExcludedAreaIds: [],
};

test("8. 同一完了状態の再保存ではbasisとエリア確定値を凍結", () => {
  saveDailySessionSnapshots([]);
  upsertDailySessionSnapshot(baseSnapshot);
  const clockAdvanced: DailySessionSnapshot = JSON.parse(JSON.stringify(baseSnapshot));
  clockAdvanced.capturedAt = "2026-11-10T10:30:00+09:00";
  clockAdvanced.basis.totalRateBonus = 99;
  clockAdvanced.areas[route[0]].rateText = "50%";
  upsertDailySessionSnapshot(clockAdvanced);
  const stored = loadDailySessionSnapshots()[0];
  assert.equal(stored.capturedAt, baseSnapshot.capturedAt);
  assert.equal(stored.basis.totalRateBonus, 0);
  assert.equal(stored.areas[route[0]].rateText, normal1830.displayedRateText);
  assert.deepEqual(stored.areas[route[0]].rateDecisionSnapshot, normal1830);
});
test("9. 旧完了データへ架空のスナップショットを生成しない", () => {
  const normalized = normalizeAreaProgressMap({
    bento_men: {
      areaId: "bento_men",
      status: "completed",
      areaJudge: "normal",
      completedRateText: "30%",
    },
  });
  assert.equal(normalized.bento_men.rateDecisionSnapshot, undefined);
  assert.equal(normalized.bento_men.rateDecisionSnapshotStatus, "legacy_not_captured");
});

function autoSkipProgress(areaId: AreaId): AreaProgress {
  return {
    areaId,
    status: "auto_skipped_late_time",
    areaJudge: null,
    autoSkipKind: "early_next_minus5",
    sourceDiscountTime: "18",
    sourceSessionStartedAt: "2026-11-10T09:00:00+09:00",
    earlyDiscountCompletedAt: "2026-11-10T09:50:00+09:00",
    previousRateText: "25%",
  };
}

test("10. 残数だけ記録するルートは正式時刻の実測値を保持", () => {
  const started = startAutoSkippedCountOnlyProgress(autoSkipProgress(route[0]));
  const measured = recordAutoSkippedCountOnlyProgress(started, 7.4, "2026-11-10T10:35:00+09:00");
  assert.equal(measured.areaCount, 7);
  assert.equal(measured.measurementStatus, "measured");
  assert.equal(measured.earlyDiscountResolution, "count_only");
  assert.equal(measured.rateOrigin, "carried_from_early_discount");
  assert.equal(measured.rateDecisionSnapshot, undefined);
});
test("11. 測定せずスキップは残数を補完せず理由を構造化", () => {
  const skipped = acknowledgeAutoSkippedProgress(autoSkipProgress(route[0]), "2026-11-10T10:36:00+09:00");
  assert.equal(skipped.areaCount, undefined);
  assert.equal(skipped.measurementStatus, "not_measured");
  assert.equal(skipped.missingReason, "early_next_minus5_skipped");
  assert.equal(skipped.earlyDiscountResolution, "not_measured");
  assert.equal(skipped.rateOrigin, "carried_from_early_discount");
  assert.equal(skipped.sourceDiscountTime, "18");
});
test("12. 今回は値引するルートは古い率・残数を消し正式時刻で再入力", () => {
  const progress = { ...autoSkipProgress(route[0]), areaCount: 99, previousNormalRateText: "25%" };
  const state = {
    screen: "auto_skip_notice",
    session: null,
    sessionDraft: {} as SessionDraft,
    areaProgressMap: { [route[0]]: progress },
    normalFlowOrder: route,
    currentAreaId: route[0],
    lastReferenceAreaId: null,
    currentFlow: "normal",
    pendingDeferredAreaIds: [],
    timeSwitchNotice: null,
    finalTimeStep: 0,
    review19: null,
    review19ExcludedAreaIds: [],
  } as unknown as AppState;
  const next = processEarlyNextMinus5AreaNormally(state);
  assert.equal(next.screen, "area_judge");
  assert.equal(next.areaProgressMap[route[0]].areaCount, undefined);
  assert.equal(next.areaProgressMap[route[0]].previousRateText, undefined);
  assert.equal(next.areaProgressMap[route[0]].earlyDiscountResolution, "process_normally");
});
test("13. 自動遷移は残った未測定エリアへ理由を確定", () => {
  const progressMap = Object.fromEntries(route.map((areaId) => [areaId, { areaId, status: "unstarted", areaJudge: null }])) as Record<AreaId, AreaProgress>;
  progressMap[route[0]] = { ...progressMap[route[0]], areaCount: 3 };
  const state = { areaProgressMap: progressMap, normalFlowOrder: route } as AppState;
  const finalized = finalizeUnmeasuredAreasForAutoTransition(state, "2026-11-10T11:25:00+09:00");
  assert.equal(finalized.areaProgressMap[route[0]].measurementStatus, "measured");
  assert.equal(finalized.areaProgressMap[route[1]].measurementStatus, "not_measured");
  assert.equal(finalized.areaProgressMap[route[1]].missingReason, "auto_time_transition");
  assert.equal(finalized.areaProgressMap[route[1]].areaCount, undefined);
});

const incompleteAreaId = route.at(-1)!;
const qualityAreas = JSON.parse(JSON.stringify(areas)) as Record<AreaId, Review19AreaSnapshot>;
qualityAreas[incompleteAreaId] = {
  ...qualityAreas[incompleteAreaId],
  status: "auto_skipped_late_time",
  measurementStatus: "not_measured",
  missingReason: "early_next_minus5_skipped",
  areaCount: undefined,
};
const records: AreaCountRecord[] = route.slice(0, -1).map((areaId, index) => ({
  ...versionInfo,
  date,
  sessionStartedAt: baseSnapshot.session.startedAt,
  recordedAt: `2026-11-10T10:${String(index).padStart(2, "0")}:00+09:00`,
  areaId,
  discountTime: "18",
  actualWeekday: "火",
  actualWeekdayGroup: "火木日",
  count: index + 1,
}));
const daySnapshot: Review19DaySnapshot = {
  version: 1,
  ...versionInfo,
  capturedAt: "2026-11-10T12:00:00+09:00",
  date,
  review19Status: "not_performed",
  sessions: [{ ...baseSnapshot, areas: qualityAreas }],
  areaCountRecords: records,
};

test("14. 作業完了と測定完了を品質情報で分離", () => {
  const quality = buildAutomaticDayExportDataQuality({ date, daySnapshot });
  const at18 = quality.coverageByDiscountTime.find((item) => item.discountTime === "18")!;
  assert.equal(at18.processComplete, true);
  assert.equal(at18.measurementComplete, false);
  assert.deepEqual(at18.notMeasuredAreaIds, [incompleteAreaId]);
  assert.equal(at18.missingReasons[incompleteAreaId], "early_next_minus5_skipped");
});
test("15. 未測定エリアには架空のAreaCountRecordを作らない", () => {
  assert.equal(records.some((record) => record.areaId === incompleteAreaId), false);
});

const allSources = [
  "../src/hooks/useNebikiApp.ts",
  "../src/components/screens/DoneScreen.tsx",
  "../src/components/screens/StartScreen.tsx",
  "../src/components/common/AdminSettingsDialog.tsx",
  "../src/domain/discount.ts",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
test("16. 新規not_applicable作成アクション・対象外UIを削除", () => {
  assert.equal(allSources.includes("markReview19NotApplicable"), false);
  assert.equal(allSources.includes("19:00チェック対象外"), false);
});
test("17. 10個以上+5%の表示・計算を主要実装から削除", () => {
  assert.equal(allSources.includes("10個以上"), false);
  assert.equal(allSources.includes("manyThreshold"), false);
});
test("18. schema v3とbuildIdを全バージョン情報へ付与", () => {
  assert.equal(versionInfo.dataSchemaVersion, 3);
  assert.ok(versionInfo.appVersion);
  assert.ok(versionInfo.buildId);
});

console.log(`\nschema v3・保存品質回帰テスト: ${passed}/18件成功`);
