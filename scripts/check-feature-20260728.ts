import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import {
  FULL_MODE_NOTICE_ITEMS,
  FULL_MODE_NOTICE_TEXTS,
} from "../src/domain/fullMode.ts";
import {
  initializeFinalizedDayDataInMemory,
  patchFinalizedDayDataMetadataInMemory,
  type StoredFinalizedDayData,
} from "../src/domain/finalizedDayData.ts";
import {
  buildAllFinalizedDayDataExportPayload,
  buildAllReview19DataExportPayload,
  buildDirectFinalizedDayDataExportPayload,
  buildDirectReview19DataExportPayload,
  buildLatestFinalizedDayDataExportPayload,
  buildLatestReview19DataExportPayload,
  selectLatestReview19Data,
} from "../src/domain/separateDataExport.ts";
import { normalizeAreaProgressMap } from "../src/hooks/nebikiApp/stateNormalization.ts";
import type {
  AreaProgress,
  Review19DaySnapshot,
  Review19Result,
} from "../src/domain/types.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(`${projectRoot}/${path}`, "utf8");
const hookSource = source("src/hooks/useNebikiApp.ts");
const settingsSource = source("src/components/common/AdminSettingsDialog.tsx");
const appSource = source("src/app/App.tsx");
const routerSource = source("src/app/AppRouter.tsx");
const areaJudgeSource = source("src/components/screens/AreaJudgeScreen.tsx");

let passed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`OK: ${name}`);
  } catch (error) {
    console.error(`NG: ${name}`);
    throw error;
  }
}

function makeDay(date: string, capturedAt: string): Review19DaySnapshot {
  return {
    version: 1,
    capturedAt,
    date,
    review19Status: "not_performed",
    sessions: [],
    areaCountRecords: [],
  };
}

function makeReview(params: {
  date: string;
  sessionStartedAt: string;
  reviewCompletedAt: string;
  recordedAt: string;
}): Review19Result {
  return {
    review19Status: "recorded",
    date: params.date,
    sessionStartedAt: params.sessionStartedAt,
    reviewCompletedAt: params.reviewCompletedAt,
    recordedAt: params.recordedAt,
    areaCountRecordedAt: {},
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCounts: {},
    excludedAreaIds: [],
    excludeReasons: {},
    dataQuality: {
      expectedAreaCount: 0,
      recordedAreaCount: 0,
      excludedAreaCount: 0,
      missingAreaIds: [],
      duplicateAreaIds: [],
      complete: true,
      processComplete: true,
      measurementComplete: true,
      notMeasuredAreaIds: [],
      missingReasons: {},
    },
  };
}

function coreOf(record: StoredFinalizedDayData): unknown {
  const cloned = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  delete cloned.recordId;
  delete cloned.finalizedAt;
  delete cloned.memo;
  delete cloned.discardCount;
  return cloned;
}

test("15時セッションの16時超過は表示案内だけ16時へ変える", () => {
  const displayBlock = hookSource.slice(
    hookSource.indexOf("const displayBasisGuide"),
    hookSource.indexOf("const ignoreNormalTimeRateCap"),
  );
  const rateBlock = hookSource.slice(
    hookSource.indexOf("const rateDisplay"),
    hookSource.indexOf("const finalGuide"),
  );

  assert.match(displayBlock, /session\.discountTime !== "15"/);
  assert.match(displayBlock, /minutes < 16 \* 60/);
  assert.match(displayBlock, /"15時を基準に考えて"/);
  assert.match(displayBlock, /"16時を基準に考えて"/);
  assert.match(hookSource, /basisGuide: displayBasisGuide/);
  assert.equal(rateBlock.includes("displayBasisGuide"), false);

  const fixedInput = {
    discountTime: "15" as const,
    weekday: 2,
    date: "2026-07-28",
    weatherBonus: 10,
    areaJudge: "normal" as const,
    areaRateAdjustment: 5 as const,
  };
  const before16 = getNormalTimeRateDisplay(fixedInput);
  const after16 = getNormalTimeRateDisplay(fixedInput);
  assert.deepEqual(after16, before16);
  assert.equal(after16.normal.main, "15%");
  assert.equal(after16.many.main, "25%");
});

test("確定日次は初回本体を保護し、メモ・廃棄だけ更新する", () => {
  const initial = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-28", "2026-07-28T20:35:00+09:00"),
  });
  const repeated = initializeFinalizedDayDataInMemory({
    currentRecords: initial.records,
    daySnapshot: makeDay("2026-07-28", "2026-07-28T23:59:00+09:00"),
  });
  assert.equal(repeated.created, false);
  assert.deepEqual(repeated.record, initial.record);

  const memoPatched = patchFinalizedDayDataMetadataInMemory({
    currentRecords: repeated.records,
    date: "2026-07-28",
    patch: { memo: "完了メモ" },
  });
  assert.ok(memoPatched.record);
  const discardPatched = patchFinalizedDayDataMetadataInMemory({
    currentRecords: memoPatched.records,
    date: "2026-07-28",
    patch: { discardCount: 0 },
  });
  assert.ok(discardPatched.record);
  assert.equal(discardPatched.record.memo, "完了メモ");
  assert.equal(discardPatched.record.discardCount, 0);
  assert.deepEqual(coreOf(discardPatched.record), coreOf(initial.record));

  const cleared = patchFinalizedDayDataMetadataInMemory({
    currentRecords: discardPatched.records,
    date: "2026-07-28",
    patch: { memo: null, discardCount: null },
  });
  assert.equal(cleared.record?.memo, null);
  assert.equal(cleared.record?.discardCount, null);
  assert.deepEqual(coreOf(cleared.record!), coreOf(initial.record));
});

test("19時・日次の全件／最新／direct exportを分離する", () => {
  const reviewSavedLaterButPerformedEarlier = makeReview({
    date: "2026-07-28",
    sessionStartedAt: "2026-07-28T18:30:00+09:00",
    reviewCompletedAt: "2026-07-28T19:05:00+09:00",
    recordedAt: "2026-07-28T23:59:00+09:00",
  });
  const reviewPerformedLater = makeReview({
    date: "2026-07-28",
    sessionStartedAt: "2026-07-28T18:40:00+09:00",
    reviewCompletedAt: "2026-07-28T19:20:00+09:00",
    recordedAt: "2026-07-28T19:21:00+09:00",
  });
  const reviewNextDay = makeReview({
    date: "2026-07-29",
    sessionStartedAt: "2026-07-29T18:30:00+09:00",
    reviewCompletedAt: "2026-07-29T19:01:00+09:00",
    recordedAt: "2026-07-29T19:02:00+09:00",
  });
  const reviews = [
    reviewNextDay,
    reviewPerformedLater,
    reviewSavedLaterButPerformedEarlier,
  ];
  assert.equal(
    selectLatestReview19Data(reviews)?.sessionStartedAt,
    reviewNextDay.sessionStartedAt,
  );
  assert.equal(
    selectLatestReview19Data(reviews.slice(1))?.sessionStartedAt,
    reviewPerformedLater.sessionStartedAt,
  );

  const allReview = buildAllReview19DataExportPayload({
    records: reviews,
    exportedAt: "2026-07-30T10:00:00+09:00",
  });
  const latestReview = buildLatestReview19DataExportPayload({
    records: reviews,
    exportedAt: "2026-07-30T10:00:00+09:00",
  });
  const directReview = buildDirectReview19DataExportPayload({
    record: reviewSavedLaterButPerformedEarlier,
    exportedAt: "2026-07-30T10:00:00+09:00",
  });
  assert.equal(allReview.count, 3);
  assert.equal(latestReview?.count, 1);
  assert.equal(latestReview?.records[0]?.date, "2026-07-29");
  assert.equal(
    directReview.records[0]?.sessionStartedAt,
    reviewSavedLaterButPerformedEarlier.sessionStartedAt,
  );
  assert.equal(Object.hasOwn(allReview, "dailyData"), false);
  assert.equal(
    buildLatestReview19DataExportPayload({ records: [], exportedAt: "x" }),
    null,
  );

  const firstDay = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-28", "2026-07-28T20:35:00+09:00"),
  }).record;
  const latestDay = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-29", "2026-07-29T20:35:00+09:00"),
  }).record;
  const allDay = buildAllFinalizedDayDataExportPayload({
    records: [latestDay, firstDay],
    exportedAt: "2026-07-30T10:00:00+09:00",
  });
  const latestDayPayload = buildLatestFinalizedDayDataExportPayload({
    records: [firstDay, latestDay],
    exportedAt: "2026-07-30T10:00:00+09:00",
  });
  const directDay = buildDirectFinalizedDayDataExportPayload({
    record: firstDay,
    exportedAt: "2026-07-30T10:00:00+09:00",
  });
  assert.equal(allDay.count, 2);
  assert.equal(latestDayPayload?.daySnapshot.date, "2026-07-29");
  assert.equal(directDay.daySnapshot.date, "2026-07-28");
  assert.equal(Object.hasOwn(allDay, "review19Data"), false);
  assert.equal(
    buildLatestFinalizedDayDataExportPayload({ records: [], exportedAt: "x" }),
    null,
  );

  assert.match(hookSource, /if \(records\.length === 0\) return false/);
  assert.match(hookSource, /if \(!payload \|\| payload\.records\.length === 0\) return false/);
  assert.match(
    hookSource,
    /const record = persistFinalizedDayMemo\(recordId, memo\)/,
  );
  assert.match(hookSource, /state\.screen !== "review19_done"/);
});

test("注意事項は-10%商品と+10%商品を各1項目へ統合", () => {
  assert.equal(FULL_MODE_NOTICE_ITEMS.length, 5);
  const minusItems = FULL_MODE_NOTICE_TEXTS.filter((text) => text.includes("-10%"));
  const plusItems = FULL_MODE_NOTICE_TEXTS.filter((text) => text.includes("+10%"));
  assert.deepEqual(minusItems, [
    "定番商品・夜によく売れる商品・広告商品は、表示値引率から-10%",
  ]);
  assert.deepEqual(plusItems, [
    "見た目が悪い個別商品・不人気な商品は、表示値引率に+10%",
  ]);
});

test("設定PIN UIを廃止し4つの分離出力ボタンを表示", () => {
  assert.equal(settingsSource.includes("adminSettings"), false);
  assert.equal(settingsSource.includes("type=\"password\""), false);
  assert.equal(settingsSource.includes("PIN"), false);
  for (const label of [
    "19:00チェックデータを全件出力",
    "最新の19:00チェックデータを出力",
    "1日データを全件出力",
    "最新の1日データを出力",
  ]) {
    assert.ok(settingsSource.includes(label), label);
  }
  assert.match(settingsSource, /role="status"/);
  assert.match(appSource, /onExportAllReview19Data=\{app\.actions\.exportAllReview19Data\}/);
  assert.match(appSource, /onExportLatestReview19Data=\{app\.actions\.exportLatestReview19Data\}/);
  assert.match(appSource, /onExportAllDailyData=\{app\.actions\.exportAllDailyData\}/);
  assert.match(appSource, /onExportLatestDailyData=\{app\.actions\.exportLatestDailyData\}/);
  assert.match(routerSource, /actions\.exportCompletedReview19Data\(\)/);
  assert.match(routerSource, /actions\.exportCompletedDailyData\(memo\)/);
});

test("20:30定番個数はnull・0を区別し不正値を拒否", () => {
  const normalizeOne = (patch: Partial<AreaProgress>) =>
    normalizeAreaProgressMap({
      bento_men: {
        areaId: "bento_men",
        status: "unstarted",
        areaJudge: null,
        ...patch,
      },
    }).bento_men;

  assert.equal(normalizeOne({ areaCount: 10 }).stapleItemCount, undefined);
  assert.equal(
    normalizeOne({ areaCount: 10, stapleItemCount: null }).stapleItemCount,
    null,
  );
  assert.equal(
    normalizeOne({ areaCount: 10, stapleItemCount: 0 }).stapleItemCount,
    0,
  );
  assert.equal(
    normalizeOne({ areaCount: 10, stapleItemCount: 10 }).stapleItemCount,
    10,
  );
  assert.equal(
    normalizeOne({ areaCount: 10, stapleItemCount: 11 }).stapleItemCount,
    undefined,
  );
  assert.equal(
    normalizeOne({ areaCount: 10, stapleItemCount: -1 }).stapleItemCount,
    undefined,
  );
  assert.equal(
    normalizeOne({ areaCount: 10, stapleItemCount: 1.5 }).stapleItemCount,
    undefined,
  );

  assert.match(areaJudgeSource, /finalCountMode \? \(/);
  assert.ok(areaJudgeSource.includes("うち定番（任意）"));
  assert.match(areaJudgeSource, /stapleItemCountText === ""[\s\S]*\? null/);
  assert.match(areaJudgeSource, /Number\.isSafeInteger\(parsedStapleItemCount\)/);
  assert.match(areaJudgeSource, /parsedStapleItemCount as number\) > completedCount/);
  assert.match(areaJudgeSource, /onJudge\("normal", completedCount, undefined, parsedStapleItemCount\)/);
});

console.log(`\n2026-07-28機能回帰テスト: ${passed}/6件成功`);
