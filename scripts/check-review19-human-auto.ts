import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NORMAL_ROUTE, getNormalRoute } from "../src/domain/area.ts";
import { buildAllDataExportPayload } from "../src/domain/allDataExport.ts";
import {
  buildReview19DataQuality,
  buildReview19ExportPayload,
  createInitialReview19Result,
  getReview19AreaItems,
  normalizeReview19Result,
} from "../src/domain/review19.ts";
import { buildReview19AutomaticEvaluation } from "../src/domain/review19Evaluation.ts";
import type {
  AreaCountEvaluation,
  AreaId,
  DemandCycle,
  Review19AreaEvaluation,
  Review19DayCheckSnapshot,
  Review19DaySnapshot,
  Review19Result,
} from "../src/domain/types.ts";

let passed = 0;

function test(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

function makeReview19Record(params: {
  date: string;
  count: number;
  demandCycle?: DemandCycle;
  areaId?: AreaId;
  sessionSuffix?: string;
}): Review19Result {
  const areaId = params.areaId ?? "bento_men";
  const sessionSuffix = params.sessionSuffix ?? "000000";
  const initial = createInitialReview19Result({
    date: params.date,
    demandCycle: params.demandCycle,
    sessionStartedAt: `${params.date}T10:${sessionSuffix.slice(0, 2)}:${sessionSuffix.slice(2, 4)}.000+09:00`,
    reviewStartedAt: `${params.date}T19:00:00.000+09:00`,
  });
  const recordedAt = `${params.date}T19:05:00.000+09:00`;
  return {
    ...initial,
    areaCounts: { [areaId]: params.count },
    areaCountRecordedAt: { [areaId]: recordedAt },
    reviewCompletedAt: recordedAt,
    recordedAt,
  };
}

function makeAuto(params: {
  date?: string;
  weekday?: number;
  count?: number;
  demandCycle?: DemandCycle;
  records?: Review19Result[];
}) {
  return buildReview19AutomaticEvaluation({
    areaId: "bento_men",
    count: params.count ?? 10,
    date: params.date ?? "2026-08-03",
    weekday: params.weekday ?? 1,
    demandCycle: params.demandCycle ?? "normal",
    historicalRecords: params.records ?? [],
  });
}

function makeCompleteRecord(params: {
  date?: string;
  demandCycle?: DemandCycle;
  humanEvaluation?: AreaCountEvaluation;
  autoEvaluation?: ReturnType<typeof makeAuto>;
} = {}): Review19Result {
  const date = params.date ?? "2026-08-03";
  const humanEvaluation = params.humanEvaluation ?? "few";
  const autoEvaluation = params.autoEvaluation ?? makeAuto({ date });
  const includedAreaId: AreaId = "bento_men";
  const excludedAreaIds = getNormalRoute(date).filter(
    (areaId) => areaId !== includedAreaId,
  );
  const initial = createInitialReview19Result({
    date,
    demandCycle: params.demandCycle,
    sessionStartedAt: `${date}T17:00:00.000+09:00`,
    reviewStartedAt: `${date}T19:00:00.000+09:00`,
    excludedAreaIds,
  });
  const recordedAt = `${date}T19:05:00.000+09:00`;
  const areaEvaluations: Partial<Record<AreaId, Review19AreaEvaluation>> = {
    [includedAreaId]: {
      humanEvaluation,
      ...autoEvaluation,
    },
  };
  return {
    ...initial,
    demandCycle: params.demandCycle ?? "normal",
    areaCounts: { [includedAreaId]: 103 },
    areaCountRecordedAt: { [includedAreaId]: recordedAt },
    areaEvaluations,
    reviewCompletedAt: recordedAt,
    recordedAt,
    dataQuality: buildReview19DataQuality({
      date,
      areaCounts: { [includedAreaId]: 103 },
      areaEvaluations,
      excludedAreaIds,
    }),
  };
}

const mondayNormalHistory = [
  makeReview19Record({ date: "2026-07-13", count: 10 }),
  makeReview19Record({ date: "2026-07-20", count: 10 }),
  makeReview19Record({ date: "2026-07-27", count: 10 }),
];

test("残数だけでは人間評価不足のため19:00チェックは完了しない", () => {
  const date = "2026-08-03";
  const excludedAreaIds = getNormalRoute(date).filter((id) => id !== "bento_men");
  const quality = buildReview19DataQuality({
    date,
    areaCounts: { bento_men: 12 },
    areaEvaluations: {},
    excludedAreaIds,
  });
  assert.equal(quality.measurementComplete, true);
  assert.equal(quality.humanEvaluationComplete, false);
  assert.equal(quality.processComplete, false);
  assert.deepEqual(quality.missingHumanEvaluationAreaIds, ["bento_men"]);
});

test("19:00 exportの品質情報から人間評価の欠損エリアを判別できる", () => {
  const date = "2026-08-03";
  const excludedAreaIds = getNormalRoute(date).filter((id) => id !== "bento_men");
  const initial = createInitialReview19Result({
    date,
    sessionStartedAt: `${date}T17:00:00.000+09:00`,
    reviewStartedAt: `${date}T19:00:00.000+09:00`,
    excludedAreaIds,
  });
  const areaCounts = { bento_men: 12 } as const;
  const record: Review19Result = {
    ...initial,
    areaCounts,
    areaCountRecordedAt: { bento_men: `${date}T19:05:00.000+09:00` },
    recordedAt: `${date}T19:05:00.000+09:00`,
    dataQuality: buildReview19DataQuality({
      date,
      areaCounts,
      areaEvaluations: {},
      excludedAreaIds,
    }),
  };
  const payload = buildReview19ExportPayload({
    records: [record],
    exportedAt: `${date}T19:10:00.000+09:00`,
  });
  assert.deepEqual(
    payload.dataQuality.incompleteRecords[0]?.missingHumanEvaluationAreaIds,
    ["bento_men"],
  );
});

test("残数と人間5段階評価が揃うと完了できる", () => {
  const record = makeCompleteRecord();
  assert.equal(record.dataQuality.complete, true);
  assert.equal(record.dataQuality.measurementComplete, true);
  assert.equal(record.dataQuality.humanEvaluationComplete, true);
});

test("除外エリアには残数も人間評価も要求しない", () => {
  const date = "2026-08-03";
  const quality = buildReview19DataQuality({
    date,
    areaCounts: {},
    areaEvaluations: {},
    excludedAreaIds: getNormalRoute(date),
  });
  assert.equal(quality.complete, true);
  assert.equal(quality.humanEvaluationExpectedAreaCount, 0);
});

test("過去19:00履歴3件から既存5段階中央値評価を算出する", () => {
  const result = makeAuto({
    date: "2026-08-03",
    weekday: 1,
    count: 30,
    records: mondayNormalHistory,
  });
  assert.equal(result.autoEvaluationStatus, "ready");
  assert.equal(result.autoEvaluation, "many");
  assert.equal(result.autoEvaluationBasis.medianCount, 10);
  assert.equal(result.autoEvaluationBasis.sampleSize, 3);
  assert.equal(result.autoEvaluationBasis.requiredSampleSize, 3);
  assert.equal(result.autoEvaluationBasis.comparisonMode, "weekday");
});

test("今日自身の19:00残数を中央値母集団へ含めない", () => {
  const result = makeAuto({
    date: "2026-08-03",
    weekday: 1,
    records: [
      ...mondayNormalHistory.slice(0, 2),
      makeReview19Record({ date: "2026-08-03", count: 999 }),
    ],
  });
  assert.equal(result.autoEvaluationStatus, "insufficient");
  assert.equal(result.autoEvaluation, null);
  assert.ok(result.autoEvaluationBasis.sampleSize < 3);
});

test("通常と夏季モードの19:00履歴を混ぜない", () => {
  const normalOnly = makeAuto({
    date: "2026-08-03",
    weekday: 1,
    demandCycle: "summer",
    records: mondayNormalHistory,
  });
  assert.equal(normalOnly.autoEvaluationStatus, "insufficient");

  const summerHistory = mondayNormalHistory.map((record) => ({
    ...record,
    demandCycle: "summer" as const,
  }));
  const summer = makeAuto({
    date: "2026-08-03",
    weekday: 1,
    demandCycle: "summer",
    records: [...mondayNormalHistory, ...summerHistory],
  });
  assert.equal(summer.autoEvaluationStatus, "ready");
  assert.equal(summer.autoEvaluationBasis.demandCycle, "summer");
  assert.equal(summer.autoEvaluationBasis.sampleSize, 3);
});

test("同曜日3件を優先して評価する", () => {
  const result = makeAuto({
    date: "2026-08-03",
    weekday: 1,
    records: mondayNormalHistory,
  });
  assert.equal(result.autoEvaluationBasis.comparisonMode, "weekday");
  assert.equal(result.autoEvaluationBasis.actualWeekday, "月");
});

test("同曜日不足時は既存曜日グループへfallbackする", () => {
  const groupHistory = [
    makeReview19Record({ date: "2026-06-01", count: 10 }),
    makeReview19Record({ date: "2026-06-08", count: 10 }),
    makeReview19Record({ date: "2026-06-15", count: 10 }),
  ];
  const result = makeAuto({
    date: "2026-08-05",
    weekday: 3,
    records: groupHistory,
  });
  assert.equal(result.autoEvaluationStatus, "ready");
  assert.equal(result.autoEvaluationBasis.comparisonMode, "fallback_group");
  assert.equal(result.autoEvaluationBasis.actualWeekdayGroup, "月水");
});

test("必要3件未満は普通ではなくinsufficientとnullを保存する", () => {
  const result = makeAuto({ records: mondayNormalHistory.slice(0, 2) });
  assert.equal(result.autoEvaluationStatus, "insufficient");
  assert.equal(result.autoEvaluation, null);
  assert.equal(result.autoEvaluationBasis.recommendationStatus, "insufficient");
});

test("夏季モードの今年2件へ前年履歴を足しても開始3件に数えない", () => {
  const records = [
    makeReview19Record({ date: "2026-07-06", count: 10, demandCycle: "summer" }),
    makeReview19Record({ date: "2026-07-13", count: 10, demandCycle: "summer" }),
    makeReview19Record({ date: "2025-08-04", count: 20, demandCycle: "summer" }),
    makeReview19Record({ date: "2025-08-11", count: 20, demandCycle: "summer" }),
  ];
  const result = makeAuto({
    date: "2026-08-31",
    weekday: 1,
    demandCycle: "summer",
    records,
  });
  assert.equal(result.autoEvaluationStatus, "insufficient");
  assert.equal(result.autoEvaluationBasis.sampleSize, 2);
});

test("夏季モードは今年3件で開始し前年以前をlongとして分離する", () => {
  const records = [
    makeReview19Record({ date: "2026-07-06", count: 10, demandCycle: "summer" }),
    makeReview19Record({ date: "2026-07-13", count: 10, demandCycle: "summer" }),
    makeReview19Record({ date: "2026-07-27", count: 10, demandCycle: "summer" }),
    makeReview19Record({ date: "2025-08-04", count: 15, demandCycle: "summer" }),
  ];
  const result = makeAuto({
    date: "2026-08-31",
    weekday: 1,
    demandCycle: "summer",
    records,
  });
  assert.equal(result.autoEvaluationStatus, "ready");
  assert.equal(result.autoEvaluationBasis.shortSampleSize, 3);
  assert.equal(result.autoEvaluationBasis.longSampleSize, 1);
  assert.equal(result.autoEvaluationBasis.shortMedianCount, 10);
  assert.equal(result.autoEvaluationBasis.longMedianCount, 15);
  assert.equal(result.autoEvaluationBasis.medianCount, 13);
});

test("人間評価と中央値評価が異なっても双方を上書きせず保持する", () => {
  const auto = makeAuto({
    date: "2026-08-03",
    weekday: 1,
    count: 30,
    records: mondayNormalHistory,
  });
  const normalized = normalizeReview19Result(
    makeCompleteRecord({ humanEvaluation: "few", autoEvaluation: auto }),
  );
  assert.equal(normalized?.areaEvaluations?.bento_men?.humanEvaluation, "few");
  assert.equal(normalized?.areaEvaluations?.bento_men?.autoEvaluation, "many");
});

test("在庫増加に見える異常値も入力値のまま保存する", () => {
  const record = makeCompleteRecord();
  const normalized = normalizeReview19Result(record);
  assert.equal(normalized?.areaCounts.bento_men, 103);
  assert.equal(normalized?.areaEvaluations?.bento_men?.humanEvaluation, "few");
});

test("旧19:00データは読み込めるが人間評価を普通へ補完しない", () => {
  const legacy = makeReview19Record({ date: "2026-07-27", count: 10 });
  const normalized = normalizeReview19Result(legacy);
  assert.deepEqual(normalized?.areaEvaluations, {});
  assert.equal(normalized?.dataQuality.humanEvaluationComplete, false);
  assert.ok(normalized?.dataQuality.missingHumanEvaluationAreaIds.includes("bento_men"));
});

test("旧rating系は新しい人間残数評価へ流用しない", () => {
  const legacy = {
    ...makeReview19Record({ date: "2026-06-20", count: 10 }),
    ratingStatus: "recorded" as const,
    ratings: Object.fromEntries(
      NORMAL_ROUTE.map((areaId) => [areaId, "just_right"]),
    ),
  };
  const normalized = normalizeReview19Result(legacy as Review19Result);
  assert.equal(normalized?.ratingStatus, "recorded");
  assert.deepEqual(normalized?.areaEvaluations, {});
});

test("人間評価は自動評価データが壊れていても独立して保持する", () => {
  const source = makeReview19Record({ date: "2026-08-03", count: 12 });
  const normalized = normalizeReview19Result({
    ...source,
    areaEvaluations: {
      bento_men: {
        humanEvaluation: "slightly_few",
        autoEvaluation: "many",
        autoEvaluationStatus: "ready",
      },
    },
  } as Partial<Review19Result>);
  assert.equal(
    normalized?.areaEvaluations?.bento_men?.humanEvaluation,
    "slightly_few",
  );
  assert.equal(normalized?.areaEvaluations?.bento_men?.autoEvaluation, null);
  assert.equal(
    normalized?.areaEvaluations?.bento_men?.autoEvaluationStatus,
    "insufficient",
  );
  assert.equal(
    normalized?.areaEvaluations?.bento_men?.autoEvaluationBasis,
    undefined,
  );
});

test("19:00対象エリアは既存の通常ルートを維持する", () => {
  assert.deepEqual(
    getReview19AreaItems().map((item) => item.areaId),
    NORMAL_ROUTE,
  );

  const areaId = NORMAL_ROUTE[0];
  const date = "2026-08-03";
  const initial = createInitialReview19Result({
    date,
    sessionStartedAt: `${date}T17:00:00.000+09:00`,
  });
  const autoEvaluation = buildReview19AutomaticEvaluation({
    areaId,
    count: 8,
    date,
    weekday: 1,
    demandCycle: "normal",
    historicalRecords: [],
  });
  const normalized = normalizeReview19Result({
    ...initial,
    areaCounts: { [areaId]: 8 },
    areaEvaluations: {
      [areaId]: {
        humanEvaluation: "normal",
        ...autoEvaluation,
      },
    },
  });
  assert.equal(normalized?.areaCounts[areaId], 8);
  assert.equal(
    normalized?.areaEvaluations?.[areaId]?.humanEvaluation,
    "normal",
  );
});

test("19:00 exportへhuman/auto/status/median/basis/demandCycleを含める", () => {
  const auto = makeAuto({
    date: "2026-08-03",
    weekday: 1,
    count: 30,
    records: mondayNormalHistory,
  });
  const record = makeCompleteRecord({
    demandCycle: "summer",
    humanEvaluation: "few",
    autoEvaluation: { ...auto, autoEvaluationBasis: { ...auto.autoEvaluationBasis, demandCycle: "summer" } },
  });
  const payload = buildReview19ExportPayload({
    records: [record],
    exportedAt: "2026-08-08T10:00:00.000Z",
  });
  const exported = payload.records[0];
  assert.equal(exported.demandCycle, "summer");
  assert.equal(exported.areaEvaluations?.bento_men?.humanEvaluation, "few");
  assert.equal(exported.areaEvaluations?.bento_men?.autoEvaluation, "many");
  assert.equal(exported.areaEvaluations?.bento_men?.autoEvaluationStatus, "ready");
  assert.equal(exported.areaEvaluations?.bento_men?.autoEvaluationBasis?.medianCount, 10);
});

test("daySnapshotと統合JSONから19:00のhuman/autoを追跡できる", () => {
  const record = makeCompleteRecord();
  const review19Check: Review19DayCheckSnapshot = {
    version: 1,
    dataSchemaVersion: record.dataSchemaVersion,
    appVersion: record.appVersion,
    buildId: record.buildId,
    demandCycle: record.demandCycle,
    review19Status: "recorded",
    recordedAt: record.recordedAt as string,
    sessionStartedAt: record.sessionStartedAt,
    reviewStartedAt: record.reviewStartedAt,
    reviewCompletedAt: record.reviewCompletedAt,
    areaCountRecordedAt: record.areaCountRecordedAt,
    ratingStatus: record.ratingStatus,
    ratings: record.ratings,
    ratingScores: record.ratingScores,
    areaCounts: record.areaCounts,
    areaEvaluations: record.areaEvaluations,
    excludedAreaIds: record.excludedAreaIds,
    excludeReasons: record.excludeReasons,
    dataQuality: record.dataQuality,
  };
  const daySnapshot: Review19DaySnapshot = {
    version: 1,
    dataSchemaVersion: record.dataSchemaVersion,
    appVersion: record.appVersion,
    buildId: record.buildId,
    capturedAt: record.recordedAt as string,
    date: record.date,
    demandCycle: record.demandCycle,
    review19Status: "recorded",
    sessions: [],
    review19Check,
    areaCountRecords: [],
  };
  const payload = buildAllDataExportPayload({
    dailyData: [daySnapshot],
    review19Data: [record],
    exportedAt: "2026-08-08T10:00:00.000Z",
  });
  const nested = payload.dailyData[0].review19Check?.areaEvaluations?.bento_men;
  assert.equal(nested?.humanEvaluation, "few");
  assert.equal(nested?.autoEvaluationStatus, "insufficient");
  assert.equal(payload.review19Data.length, 0);
});

test("fixed-time相当の空履歴では本番履歴を使わずinsufficientになる", () => {
  const result = makeAuto({ records: [] });
  assert.equal(result.autoEvaluationStatus, "insufficient");
  assert.equal(result.autoEvaluation, null);
});

test("入力画面は人間5段階だけを表示し中央値・自動評価を表示しない", () => {
  const source = readFileSync(
    new URL("../src/components/screens/Review19Screen.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("evaluationText"));
  for (const value of [
    'value: "many"',
    'value: "slightly_many"',
    'value: "normal"',
    'value: "slightly_few"',
    'value: "few"',
  ]) {
    assert.ok(source.includes(value));
  }
  assert.ok(source.includes('gridTemplateColumns: "repeat(5, minmax(0, 1fr))"'));
  assert.ok(source.includes('overflowX: "hidden"'));
  assert.ok(!source.includes("中央値"));
  assert.ok(!source.includes("自動評価"));
  assert.ok(!source.includes("autoEvaluation"));
});

test("完了画面にも中央値の答え合わせを追加していない", () => {
  const source = readFileSync(
    new URL("../src/components/screens/Review19DoneScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(!source.includes("autoEvaluation"));
  assert.ok(!source.includes("中央値"));
  assert.ok(!source.includes("一致"));
});

test("19:00自動評価adapterは通常残数履歴やSupabase保存処理を参照しない", () => {
  const source = readFileSync(
    new URL("../src/domain/review19Evaluation.ts", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes('discountTime: REVIEW19_DISCOUNT_TIME'));
  assert.ok(!source.includes("areaCountRemoteStorage"));
  assert.ok(!source.includes("upsertAreaCountRecord"));
  assert.ok(!/from\s+["'][^"']*supabase/i.test(source));
  assert.ok(!/\b(?:insert|upsert|update|delete)\s*\(/i.test(source));
});

console.log(`Review19 human/auto evaluation checks passed: ${passed}/${passed}`);
