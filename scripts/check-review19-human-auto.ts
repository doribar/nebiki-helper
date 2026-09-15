import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NORMAL_ROUTE, getNormalRoute } from "../src/domain/area.ts";
import { buildAllDataExportPayload } from "../src/domain/allDataExport.ts";
import { buildProductionAnalysis } from "../src/domain/analysisMetadata.ts";
import {
  HistoricalArchiveRepository,
  MemoryHistoricalArchiveAdapter,
} from "../src/domain/historicalArchive.ts";
import {
  createHumanEvaluationSelection,
  createReview19HumanEvaluationDetails,
  getEvaluationFromOddHumanScore,
} from "../src/domain/humanEvaluation.ts";
import {
  buildReview19DataQuality,
  buildReview19ExportPayload,
  createInitialReview19Result,
  getReview19AreaItems,
  normalizeReview19Result,
} from "../src/domain/review19.ts";
import { buildReview19HistoryStatistics } from "../src/domain/review19Evaluation.ts";
import { buildRemoteReview19Row, normalizeRemoteReview19Row } from "../src/domain/review19RemoteStorage.ts";
import {
  createReview19DaySnapshot,
  selectLatestReview19DayCheck,
} from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import type {
  AreaCountEvaluation,
  AreaId,
  DailySessionSnapshot,
  DemandCycle,
  HumanEvaluationSelection,
  Review19AreaEvaluation,
  Review19AutomaticEvaluation,
  Review19AreaSnapshot,
  Review19DayCheckSnapshot,
  Review19DaySnapshot,
  Review19Result,
} from "../src/domain/types.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [];

function test(name: string, run: () => void | Promise<void>) {
  tests.push({ name, run });
}

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// Explicit JSON captured from 9-25. Legacy compatibility must not depend on a
// runtime builder that would keep producing new automatic Review19 judgments.
const LEGACY_READY_AUTO: Review19AutomaticEvaluation = {
  autoEvaluation: "many",
  autoEvaluationStatus: "ready",
  autoEvaluationBasis: {
    ruleVersion: "area_count_median_v1", demandCycle: "normal",
    evaluationSource: "history", recommendationStatus: "ready",
    actualWeekday: "月", actualWeekdayGroup: "月水", comparisonMode: "weekday",
    sampleSize: 3, requiredSampleSize: 3, medianCount: 10,
    shortMedianCount: 10, longMedianCount: 10, shortSampleSize: 3, longSampleSize: 3,
    medianDownGuardApplied: false,
    smallDifferenceThreshold: 2, largeDifferenceThreshold: 4,
    lowerLargeThreshold: 6, lowerSmallThreshold: 8,
    upperSmallThreshold: 12, upperLargeThreshold: 14,
    baseEvaluation: "many", finalEvaluation: "many",
    decreaseAdjustment: {
      canUse: false, sampleSize: 0, requiredSampleSize: 3,
      previousDiscountTime: "18", direction: "none",
    },
  },
};
const LEGACY_INSUFFICIENT_AUTO: Review19AutomaticEvaluation = {
  autoEvaluation: null,
  autoEvaluationStatus: "insufficient",
  autoEvaluationBasis: {
    ruleVersion: "area_count_median_v1", demandCycle: "normal",
    evaluationSource: "history", recommendationStatus: "insufficient",
    actualWeekday: "月", actualWeekdayGroup: "月水", comparisonMode: "fallback_group",
    sampleSize: 0, requiredSampleSize: 3,
  },
};

const STATISTICS_KEYS = new Set([
  "ruleVersion", "demandCycle", "recommendationStatus", "actualWeekday",
  "actualWeekdayGroup", "comparisonMode", "threeDayHolidayMiddleReference",
  "sampleSize", "requiredSampleSize", "medianCount", "shortMedianCount",
  "longMedianCount", "shortSampleSize", "longSampleSize", "medianDownGuardApplied",
]);

function assertStatisticsOnly(evaluation: Review19AreaEvaluation) {
  assert.equal(Object.hasOwn(evaluation, "autoEvaluation"), false);
  assert.equal(Object.hasOwn(evaluation, "autoEvaluationStatus"), false);
  assert.ok(evaluation.autoEvaluationBasis, "history statistics are retained");
  for (const key of Object.keys(evaluation.autoEvaluationBasis)) {
    assert.ok(STATISTICS_KEYS.has(key), `unexpected classification field: ${key}`);
  }
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

function makeStatistics(params: {
  date?: string;
  weekday?: number;
  count?: number;
  demandCycle?: DemandCycle;
  records?: Review19Result[];
}) {
  const statistics = buildReview19HistoryStatistics({
    areaId: "bento_men",
    count: params.count ?? 10,
    date: params.date ?? "2026-08-03",
    weekday: params.weekday ?? 1,
    demandCycle: params.demandCycle ?? "normal",
    historicalRecords: params.records ?? [],
  });
  assertStatisticsOnly(statistics);
  assert.deepEqual(Object.keys(statistics), ["autoEvaluationBasis"]);
  return statistics;
}

function makeCompleteRecord(params: {
  date?: string;
  demandCycle?: DemandCycle;
  humanEvaluation?: AreaCountEvaluation;
  evaluation?: Review19AutomaticEvaluation;
} = {}): Review19Result {
  const date = params.date ?? "2026-08-03";
  const humanEvaluation = params.humanEvaluation ?? "few";
  const statistics = params.evaluation ?? makeStatistics({ date, demandCycle: params.demandCycle });
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
      ...statistics,
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

const RAW9_SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 2, 4, 8] as const;
const EVALUATIONS = ["few", "slightly_few", "normal", "slightly_many", "many"] as const;

function raw9Selection(index: number): HumanEvaluationSelection {
  const score = RAW9_SCORES[index];
  const lower = EVALUATIONS[Math.floor((score - 1) / 2)];
  const upper = score % 2 === 0 ? EVALUATIONS[score / 2] : undefined;
  // Include both orders for adjacent selections, which raw9 must preserve.
  const selection = upper && index > 8
    ? createHumanEvaluationSelection(upper, lower)
    : createHumanEvaluationSelection(lower, upper);
  assert.ok(selection);
  assert.equal(selection.humanEvaluationScore9, score);
  return selection;
}

function makeRaw9Record(demandCycle: DemandCycle): Review19Result {
  const date = "2026-08-03";
  const areaIds = getNormalRoute(date);
  assert.equal(areaIds.length, 12);
  const recordedAt = `${date}T19:05:00.000+09:00`;
  const record = createInitialReview19Result({
    date, demandCycle, sessionStartedAt: `${date}T17:00:00.000+09:00`,
    reviewStartedAt: `${date}T19:00:00.000+09:00`,
  });
  const historicalRecords = mondayNormalHistory.map((history) => ({
    ...history, demandCycle,
    areaCounts: Object.fromEntries(areaIds.map((areaId, index) => [areaId, 10 + index])),
    areaCountRecordedAt: Object.fromEntries(areaIds.map((areaId) => [areaId, history.recordedAt!])),
  }));
  for (const [index, areaId] of areaIds.entries()) {
    const selection = raw9Selection(index);
    const humanEvaluation = getEvaluationFromOddHumanScore(selection.humanEvaluationScore9);
    record.areaCounts[areaId] = 100 + index;
    record.areaCountRecordedAt[areaId] = recordedAt;
    record.areaEvaluations![areaId] = {
      ...(humanEvaluation ? { humanEvaluation } : {}),
      humanEvaluationDetails: createReview19HumanEvaluationDetails({ selection, demandCycle, evaluatedAt: recordedAt }),
      ...buildReview19HistoryStatistics({
        areaId, count: 100 + index, date, weekday: 1, demandCycle, historicalRecords,
      }),
    };
  }
  record.recordedAt = recordedAt;
  record.reviewCompletedAt = recordedAt;
  record.dataQuality = buildReview19DataQuality({
    date, areaCounts: record.areaCounts, areaEvaluations: record.areaEvaluations!, excludedAreaIds: [],
  });
  return record;
}

function assertRaw9Areas(record: Pick<Review19Result, "areaCounts" | "areaEvaluations" | "dataQuality">) {
  assert.equal(record.dataQuality.complete, true);
  assert.equal(record.dataQuality.humanEvaluationRecordedAreaCount, 12);
  assert.equal(Object.keys(record.areaEvaluations!).length, 12);
  for (const [index, areaId] of getNormalRoute("2026-08-03").entries()) {
    const evaluation = record.areaEvaluations?.[areaId];
    assert.ok(evaluation);
    assertStatisticsOnly(evaluation);
    assert.equal(record.areaCounts[areaId], 100 + index);
    assert.equal(evaluation.autoEvaluationBasis?.medianCount, 10 + index);
    assert.equal(evaluation.autoEvaluationBasis?.sampleSize, 3);
    assert.equal(evaluation.autoEvaluationBasis?.recommendationStatus, "ready");
    assert.equal(evaluation.humanEvaluationDetails?.humanEvaluationScore9, RAW9_SCORES[index]);
    assert.equal(evaluation.humanEvaluationDetails?.humanEvaluationScale, 9);
    assert.deepEqual(evaluation.humanEvaluationDetails?.humanEvaluationSelections, raw9Selection(index).humanEvaluationSelections);
    assert.equal(evaluation.humanEvaluationDetails?.resolutionReason, "review19_observation");
    assert.equal(evaluation.humanEvaluationDetails?.resolutionDirection, "not_applicable");
    assert.equal(evaluation.humanEvaluationDetails?.resolvedEvaluation, undefined);
    assert.equal(evaluation.humanEvaluationDetails?.automaticEvaluation, undefined);
    assert.equal(evaluation.humanEvaluationDetails?.evaluationAdjustment, undefined);
    assert.equal(evaluation.humanEvaluation, getEvaluationFromOddHumanScore(RAW9_SCORES[index]) ?? undefined);
  }
}

for (const demandCycle of ["normal", "summer"] as const) {
  test(`${demandCycle}: 12エリアのraw9と統計だけを保存・再読込・cloud変換・exportする`, async () => {
    const record = makeRaw9Record(demandCycle);
    record.daySnapshot = createReview19DaySnapshot({
      date: record.date, demandCycle, capturedAt: record.recordedAt!,
      sessions: [], areaCountRecords: [],
      review19Check: selectLatestReview19DayCheck([record], record.date, demandCycle),
    });
    const sourceBefore = JSON.stringify(record);
    assertRaw9Areas(record);
    const normalized = normalizeReview19Result(json(record));
    assert.ok(normalized);
    assertRaw9Areas(normalized);

    const adapter = new MemoryHistoricalArchiveAdapter();
    const repository = new HistoricalArchiveRepository(adapter);
    const saved = await repository.upsertReview19Records([normalized]);
    assert.equal(saved.ok, true);
    const reopened = await new HistoricalArchiveRepository(adapter).listReview19Records();
    assert.equal(reopened.ok, true);
    if (!reopened.ok) throw new Error(reopened.message);
    assert.equal(reopened.value.length, 1);
    const stored = reopened.value[0];
    assertRaw9Areas(stored);
    assertRaw9Areas(stored.daySnapshot!.review19Check!);
    assert.equal(stored.dataSchemaVersion, record.dataSchemaVersion);

    const cloudRow = buildRemoteReview19Row(stored);
    assert.equal(cloudRow.is_complete, true);
    assertRaw9Areas(cloudRow.payload);
    const remote = normalizeRemoteReview19Row(json(cloudRow), demandCycle);
    assert.ok(remote);
    assertRaw9Areas(remote);
    assertRaw9Areas(remote.daySnapshot!.review19Check!);

    const exportedAt = "2026-08-08T10:00:00.000Z";
    const exported = json(buildReview19ExportPayload({ records: [stored], exportedAt })).records[0];
    assertRaw9Areas(exported);
    assertRaw9Areas(exported.daySnapshot!.review19Check!);
    const allData = json(buildAllDataExportPayload({ dailyData: [stored.daySnapshot!], review19Data: [stored], exportedAt }));
    assertRaw9Areas(allData.dailyData[0].review19Check!);
    assert.equal(JSON.stringify(record), sourceBefore, "save, normalize and export do not mutate source data");
  });
}

test("新形式の統計basisへ紛れた判定・閾値・率・減り方を保存しない", () => {
  const evaluation = {
    ...makeStatistics({ records: mondayNormalHistory }),
    autoEvaluationBasis: {
      ...json(LEGACY_READY_AUTO.autoEvaluationBasis!),
      areaRateAdjustment: 10 as const,
    },
  };
  const normalized = normalizeReview19Result(makeCompleteRecord({ evaluation }));
  assert.ok(normalized?.areaEvaluations?.bento_men);
  assertStatisticsOnly(normalized.areaEvaluations.bento_men);
  assert.equal(normalized.areaEvaluations.bento_men.humanEvaluation, "few");
  assert.equal(normalized.areaEvaluations.bento_men.autoEvaluationBasis?.medianCount, 10);
  assert.equal(normalized.areaEvaluations.bento_men.autoEvaluationBasis?.sampleSize, 3);
});

test("人間評価だけ・壊れた統計・別cycle統計へauto/statusを補完しない", () => {
  for (const evaluation of [
    {},
    { autoEvaluationBasis: { ...LEGACY_READY_AUTO.autoEvaluationBasis!, sampleSize: -1 } },
    { autoEvaluationBasis: { ...LEGACY_READY_AUTO.autoEvaluationBasis!, demandCycle: "summer" as const } },
  ]) {
    const normalized = normalizeReview19Result(makeCompleteRecord({ evaluation }));
    assert.ok(normalized?.areaEvaluations?.bento_men);
    const area = normalized.areaEvaluations.bento_men;
    assert.equal(area.humanEvaluation, "few");
    assert.equal(Object.hasOwn(area, "autoEvaluation"), false);
    assert.equal(Object.hasOwn(area, "autoEvaluationStatus"), false);
    assert.equal(area.autoEvaluationBasis, undefined);
    assert.equal(normalized.dataQuality.complete, true);
  }
});

test("旧insufficientのnull/status/basisを保存・exportしても変更しない", () => {
  const record = makeCompleteRecord({ evaluation: json(LEGACY_INSUFFICIENT_AUTO) });
  const normalized = normalizeReview19Result(record)!;
  const exported = buildReview19ExportPayload({ records: [normalized], exportedAt: "2026-08-08T10:00:00.000Z" }).records[0];
  for (const candidate of [normalized, exported]) {
    const area = candidate.areaEvaluations!.bento_men!;
    assert.equal(area.autoEvaluation, null);
    assert.equal(area.autoEvaluationStatus, "insufficient");
    assert.deepEqual(json(area.autoEvaluationBasis), LEGACY_INSUFFICIENT_AUTO.autoEvaluationBasis);
    assert.equal(area.humanEvaluation, "few");
  }
});

function makeOperationSessions(record: Review19Result): DailySessionSnapshot[] {
  const weather = { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null };
  return (["15", "17"] as const).map((discountTime) => ({
    version: 1, capturedAt: `${record.date}T${discountTime}:10:00.000+09:00`,
    demandCycle: record.demandCycle, screen: "done", sessionEndReason: "completed",
    session: {
      date: record.date, weekday: 1, discountTime, demandCycle: record.demandCycle,
      startedAt: `${record.date}T${discountTime}:00:00.000+09:00`,
      manualWeekdayOverride: false, manualDiscountTimeOverride: false,
      weather, resolvedWeather: resolveWeatherInputForDiscount(weather, discountTime),
    },
    basis: { baseRateBonus: 0, lateTimeBonus: 0, totalRateBonus: 0, baseRateBonusReason: [] },
    areas: Object.fromEntries(getNormalRoute(record.date).map((areaId) => [areaId, {
      areaId, areaName: areaId, status: "completed", areaJudge: "normal",
      areaCount: 20, areaCountEvaluation: "few", areaCountEvaluationSource: "history",
      judgeText: "少ない", rateText: "10%", rateDecisionSnapshotStatus: "legacy_not_captured",
      measurementStatus: "measured",
    }])) as Record<AreaId, Review19AreaSnapshot>,
    doneSummaryItems: [], currentAreaId: null, review19ExcludedAreaIds: [],
  }));
}

for (const demandCycle of ["normal", "summer"] as const) {
  test(`${demandCycle}: 相反する旧autoがあっても製造分析は19時raw9だけを採用する`, () => {
    const record = makeRaw9Record(demandCycle);
    const legacy = json(record);
    for (const [index, areaId] of getNormalRoute(record.date).entries()) {
      legacy.areaEvaluations![areaId] = {
        ...legacy.areaEvaluations![areaId],
        ...json(LEGACY_READY_AUTO),
        autoEvaluationBasis: { ...json(LEGACY_READY_AUTO.autoEvaluationBasis!), demandCycle },
      };
      // Both extremes disagree with low or high human observations.
      if (RAW9_SCORES[index] > 4) {
        legacy.areaEvaluations![areaId]!.autoEvaluation = "few";
        legacy.areaEvaluations![areaId]!.autoEvaluationBasis!.baseEvaluation = "few";
        legacy.areaEvaluations![areaId]!.autoEvaluationBasis!.finalEvaluation = "few";
      }
    }
    const sessions = makeOperationSessions(record);
    const analyze = (candidate: Review19Result) => buildProductionAnalysis({
      date: candidate.date, demandCycle, areaIds: getNormalRoute(candidate.date),
      sessions, areaCountRecords: [],
      review19Check: selectLatestReview19DayCheck([candidate], candidate.date, demandCycle),
    });
    const baseline = analyze(normalizeReview19Result(record)!);
    const legacyNormalized = normalizeReview19Result(legacy)!;
    assert.equal(legacyNormalized.areaEvaluations!.bento_men!.autoEvaluationStatus, "ready");
    assert.deepEqual(analyze(legacyNormalized), baseline);
    const exportedLegacy = buildReview19ExportPayload({ records: [legacy], exportedAt: record.recordedAt! }).records[0];
    assert.deepEqual(analyze(exportedLegacy), baseline);
    for (const [index, areaId] of getNormalRoute(record.date).entries()) {
      const area = baseline.areas[areaId]!;
      assert.equal(area.checkpointSources?.["19"], "human_review19");
      assert.equal(area.checkpointScores["19"], RAW9_SCORES[index]);
      assert.equal(area.checkpointSourceScale["19"], 9);
      assert.equal(area.validCheckpointCount, 3);
      assert.equal(area.productionShortageSuspicion, RAW9_SCORES[index] <= 4 ? "strong" : "medium");
    }
  });
}

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

test("過去19:00履歴3件から中央値統計だけを算出する", () => {
  const result = makeStatistics({
    date: "2026-08-03",
    weekday: 1,
    count: 30,
    records: mondayNormalHistory,
  });
  assert.equal(result.autoEvaluationBasis.recommendationStatus, "ready");
  assert.equal(result.autoEvaluationBasis.medianCount, 10);
  assert.equal(result.autoEvaluationBasis.sampleSize, 3);
  assert.equal(result.autoEvaluationBasis.requiredSampleSize, 3);
  assert.equal(result.autoEvaluationBasis.comparisonMode, "weekday");
});

test("今日自身の19:00残数を中央値母集団へ含めない", () => {
  const result = makeStatistics({
    date: "2026-08-03",
    weekday: 1,
    records: [
      ...mondayNormalHistory.slice(0, 2),
      makeReview19Record({ date: "2026-08-03", count: 999 }),
    ],
  });
  assert.equal(result.autoEvaluationBasis.recommendationStatus, "insufficient");
  assert.ok(result.autoEvaluationBasis.sampleSize < 3);
});

test("通常と夏季モードの19:00履歴を混ぜない", () => {
  const normalOnly = makeStatistics({
    date: "2026-08-03",
    weekday: 1,
    demandCycle: "summer",
    records: mondayNormalHistory,
  });
  assert.equal(normalOnly.autoEvaluationBasis.recommendationStatus, "insufficient");

  const summerHistory = mondayNormalHistory.map((record) => ({
    ...record,
    demandCycle: "summer" as const,
  }));
  const summer = makeStatistics({
    date: "2026-08-03",
    weekday: 1,
    demandCycle: "summer",
    records: [...mondayNormalHistory, ...summerHistory],
  });
  assert.equal(summer.autoEvaluationBasis.recommendationStatus, "ready");
  assert.equal(summer.autoEvaluationBasis.demandCycle, "summer");
  assert.equal(summer.autoEvaluationBasis.sampleSize, 3);
});

test("同曜日3件を優先して統計を算出する", () => {
  const result = makeStatistics({
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
  const result = makeStatistics({
    date: "2026-08-05",
    weekday: 3,
    records: groupHistory,
  });
  assert.equal(result.autoEvaluationBasis.recommendationStatus, "ready");
  assert.equal(result.autoEvaluationBasis.comparisonMode, "fallback_group");
  assert.equal(result.autoEvaluationBasis.actualWeekdayGroup, "月水");
});

test("必要3件未満は統計のinsufficientを保持し自動判定を補完しない", () => {
  const result = makeStatistics({ records: mondayNormalHistory.slice(0, 2) });
  assert.equal(result.autoEvaluationBasis.recommendationStatus, "insufficient");
  assert.equal(result.autoEvaluationBasis.requiredSampleSize, 3);
});

test("夏季モードの今年2件へ前年履歴を足しても開始3件に数えない", () => {
  const records = [
    makeReview19Record({ date: "2026-07-06", count: 10, demandCycle: "summer" }),
    makeReview19Record({ date: "2026-07-13", count: 10, demandCycle: "summer" }),
    makeReview19Record({ date: "2025-08-04", count: 20, demandCycle: "summer" }),
    makeReview19Record({ date: "2025-08-11", count: 20, demandCycle: "summer" }),
  ];
  const result = makeStatistics({
    date: "2026-08-31",
    weekday: 1,
    demandCycle: "summer",
    records,
  });
  assert.equal(result.autoEvaluationBasis.recommendationStatus, "insufficient");
  assert.equal(result.autoEvaluationBasis.sampleSize, 2);
});

test("夏季モードは今年3件で開始し前年以前をlongとして分離する", () => {
  const records = [
    makeReview19Record({ date: "2026-07-06", count: 10, demandCycle: "summer" }),
    makeReview19Record({ date: "2026-07-13", count: 10, demandCycle: "summer" }),
    makeReview19Record({ date: "2026-07-27", count: 10, demandCycle: "summer" }),
    makeReview19Record({ date: "2025-08-04", count: 15, demandCycle: "summer" }),
  ];
  const result = makeStatistics({
    date: "2026-08-31",
    weekday: 1,
    demandCycle: "summer",
    records,
  });
  assert.equal(result.autoEvaluationBasis.recommendationStatus, "ready");
  assert.equal(result.autoEvaluationBasis.shortSampleSize, 3);
  assert.equal(result.autoEvaluationBasis.longSampleSize, 1);
  assert.equal(result.autoEvaluationBasis.shortMedianCount, 10);
  assert.equal(result.autoEvaluationBasis.longMedianCount, 15);
  assert.equal(result.autoEvaluationBasis.medianCount, 13);
});

test("旧JSONの人間評価と中央値評価が異なっても双方を上書きせず保持する", () => {
  const auto = json(LEGACY_READY_AUTO);
  const normalized = normalizeReview19Result(
    makeCompleteRecord({ humanEvaluation: "few", evaluation: auto }),
  );
  assert.equal(normalized?.areaEvaluations?.bento_men?.humanEvaluation, "few");
  assert.equal(normalized?.areaEvaluations?.bento_men?.autoEvaluation, "many");
  assert.deepEqual(json(normalized?.areaEvaluations?.bento_men?.autoEvaluationBasis), auto.autoEvaluationBasis);
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
  const autoEvaluation = buildReview19HistoryStatistics({
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

test("旧19:00 exportへhuman/auto/status/median/basis/demandCycleをそのまま含める", () => {
  const auto = json(LEGACY_READY_AUTO);
  const record = makeCompleteRecord({
    demandCycle: "summer",
    humanEvaluation: "few",
    evaluation: { ...auto, autoEvaluationBasis: { ...auto.autoEvaluationBasis!, demandCycle: "summer" } },
  });
  const payload = buildReview19ExportPayload({
    records: [record],
    exportedAt: "2026-08-08T10:00:00.000Z",
  });
  const exported = payload.records[0];
  assert.equal(exported.demandCycle, "summer");
  assert.equal(exported.areaEvaluations?.bento_men?.humanEvaluation, "few");
  assert.equal(
    exported.areaEvaluations?.bento_men?.humanEvaluationDetails
      ?.humanEvaluationScore9,
    1,
  );
  assert.equal(
    exported.areaEvaluations?.bento_men?.humanEvaluationDetails
      ?.humanEvaluationScale,
    5,
  );
  assert.equal(exported.areaEvaluations?.bento_men?.autoEvaluation, "many");
  assert.equal(exported.areaEvaluations?.bento_men?.autoEvaluationStatus, "ready");
  assert.equal(exported.areaEvaluations?.bento_men?.autoEvaluationBasis?.medianCount, 10);
  assert.deepEqual(json(exported.areaEvaluations?.bento_men?.autoEvaluationBasis), record.areaEvaluations?.bento_men?.autoEvaluationBasis);
});

test("daySnapshotと統合JSONから19:00のhumanと統計を追跡できる", () => {
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
  assert.equal(nested?.humanEvaluationDetails?.humanEvaluationScore9, 1);
  assert.equal(nested?.humanEvaluationDetails?.humanEvaluationScale, 5);
  assert.ok(nested);
  assertStatisticsOnly(nested);
  assert.equal(nested.autoEvaluationBasis?.recommendationStatus, "insufficient");
  assert.equal(payload.review19Data.length, 0);
});

test("fixed-time相当の空履歴では本番履歴を使わずinsufficientになる", () => {
  const result = makeStatistics({ records: [] });
  assert.equal(result.autoEvaluationBasis.recommendationStatus, "insufficient");
});

test("入力画面は共通9段階selectorを使い中央値・自動評価を表示しない", () => {
  const review19Source = readFileSync(
    new URL("../src/components/screens/Review19Screen.tsx", import.meta.url),
    "utf8",
  );
  const selectorSource = readFileSync(
    new URL("../src/components/common/HumanEvaluationSelector.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(review19Source.includes("HumanEvaluationSelector"));
  assert.ok(review19Source.includes('ariaLabel="人間目線の9段階残数評価"'));
  assert.ok(review19Source.includes('layout="compact"'));
  assert.ok(review19Source.includes("onLongPressActivated={cancelSwipeGesture}"));
  assert.ok(selectorSource.includes("evaluationText"));
  for (const value of [
    'value: "many"',
    'value: "slightly_many"',
    'value: "normal"',
    'value: "slightly_few"',
    'value: "few"',
  ]) {
    assert.ok(selectorSource.includes(value));
  }
  assert.ok(
    selectorSource.includes('gridTemplateColumns: "repeat(5, minmax(0, 1fr))"'),
  );
  assert.ok(review19Source.includes('overflowX: "hidden"'));
  assert.ok(!review19Source.includes("中央値"));
  assert.ok(!review19Source.includes("自動評価"));
  assert.ok(!review19Source.includes("autoEvaluation"));
  assert.ok(!selectorSource.includes("autoEvaluation"));
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

test("19:00統計adapterは通常残数履歴やSupabase保存処理を参照しない", () => {
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

for (const [index, entry] of tests.entries()) {
  await entry.run();
  console.log(`PASS: ${String(index + 1).padStart(2, "0")}. ${entry.name}`);
}
console.log(`Review19 human/statistics and legacy-auto checks passed: ${tests.length}/${tests.length}`);
