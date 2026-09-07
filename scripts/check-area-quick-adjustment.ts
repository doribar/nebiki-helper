import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  createAreaEvaluationQuickAdjustment,
  getAreaEvaluationQuickAdjustments,
} from "../src/domain/areaEvaluationAdjustment.ts";
import {
  buildAreaCountDecisionBasis,
  cloneAreaCountRecords,
  evaluationText,
  evaluationToRateAdjustment,
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  isAreaCountAssistTarget,
  mergeAreaCountRecordCollections,
  normalizeAreaCountRecords,
  type AreaCountRecommendation,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { buildRemoteAreaCountRow } from "../src/domain/areaCountRemoteStorage.ts";
import { buildAnalysisWeatherContext, buildSessionAnalysisCalendarContext } from "../src/domain/analysisMetadata.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { normalizeDemandCycle } from "../src/domain/demandCycle.ts";
import { buildAutomaticDayExportPayload } from "../src/domain/dayExport.ts";
import { initializeFinalizedDayDataInMemory } from "../src/domain/finalizedDayData.ts";
import { normalizeGlobalDiscountAdjustmentPercent } from "../src/domain/globalDiscountAdjustment.ts";
import {
  createHumanEvaluationSelection,
  normalizeHumanEvaluationDetails,
  resolveHumanEvaluationForDiscount,
} from "../src/domain/humanEvaluation.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { buildRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { createInitialReview19Result } from "../src/domain/review19.ts";
import { buildDirectReview19DataExportPayload } from "../src/domain/separateDataExport.ts";
import { loadCurrentSession, loadWorkSessionCheckpoint, saveCurrentSession, saveWorkSessionCheckpoint } from "../src/domain/storage.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot, createReview19Snapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import type {
  AppState,
  AreaCountEvaluation,
  DemandCycle,
  DiscountTime,
  HumanEvaluationAdjustment,
  SessionDraft,
} from "../src/domain/types.ts";

const DATE = "2026-09-08";
const AT = `${DATE}T08:10:00.000Z`;
const AREA = "bento_men";
const tests: { name: string; run: () => void | Promise<void> }[] = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push({ name, run });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function recommendation(evaluation: AreaCountEvaluation, cycle: DemandCycle = "normal"): AreaCountRecommendation {
  return {
    status: "ready", demandCycle: cycle, count: 24, sampleSize: 3, requiredSampleSize: 3,
    matchedRecords: [], actualWeekday: "火", actualWeekdayGroup: "火木", comparisonMode: "weekday",
    medianCount: 24, baseEvaluation: evaluation, suggestedEvaluation: evaluation,
    areaRateAdjustment: evaluationToRateAdjustment(evaluation), summaryText: evaluationText(evaluation), detailLines: [],
  };
}

function fixture(original: AreaCountEvaluation = "normal", time: DiscountTime = "17", cycle: DemandCycle = "normal"): AppState {
  const draft: SessionDraft = {
    date: DATE, weekday: 2, discountTime: time, demandCycle: cycle,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
  const state = createInitialState(draft);
  state.session = { ...draft, ...getCurrentDataVersionInfo(), startedAt: `${DATE}T08:00:00.000Z` };
  state.screen = "rate_display";
  state.currentAreaId = AREA;
  state.areaProgressMap[AREA] = {
    ...state.areaProgressMap[AREA], areaCount: 24, areaJudge: "normal",
    areaCountEvaluation: original, areaCountEvaluationSource: "history",
    areaRateAdjustment: evaluationToRateAdjustment(original),
    areaCountDecisionBasis: buildAreaCountDecisionBasis({
      recommendation: recommendation(original, cycle), evaluationSource: "history",
      finalEvaluation: original, areaRateAdjustment: evaluationToRateAdjustment(original),
    }),
  };
  return state;
}

const choices = (state: AppState, isTestMode = false) => getAreaEvaluationQuickAdjustments({
  screen: state.screen, discountTime: state.session!.discountTime, isTestMode,
  progress: state.currentAreaId ? state.areaProgressMap[state.currentAreaId] : undefined,
});

const mappings = [
  ["few", "higher", "slightly_few"],
  ["slightly_few", "lower", "few"],
  ["slightly_few", "higher", "normal"],
  ["normal", "lower", "slightly_few"],
  ["normal", "higher", "slightly_many"],
  ["slightly_many", "lower", "normal"],
  ["slightly_many", "higher", "many"],
  ["many", "lower", "slightly_many"],
] as const;

for (const [original, direction, final] of mappings) {
  test(`${original} / ${direction} produces exactly one step to ${final}`, () => {
    const adjustment = createAreaEvaluationQuickAdjustment(original, direction);
    assert.deepEqual(adjustment, {
      applied: true, source: "human", direction, steps: 1,
      originalEvaluation: original, finalEvaluation: final,
    });
    assert.deepEqual(choices(fixture(original)).find((choice) => choice.direction === direction), adjustment);
  });
}

test("few has no lower button and many has no higher button", () => {
  assert.equal(createAreaEvaluationQuickAdjustment("few", "lower"), null);
  assert.equal(createAreaEvaluationQuickAdjustment("many", "higher"), null);
  assert.deepEqual(choices(fixture("few")).map((choice) => choice.direction), ["higher"]);
  assert.deepEqual(choices(fixture("many")).map((choice) => choice.direction), ["lower"]);
});

test("normal and summer operational 15/17/18/19 sessions use the same quick choices", () => {
  for (const cycle of ["normal", "summer"] as const) {
    for (const time of ["15", "17", "18", "19"] as const) {
      assert.equal(choices(fixture("normal", time, cycle)).length, 2);
    }
  }
});

test("Review19, start, fixed-time and forced-50 screens have no quick choices", () => {
  for (const screen of ["review19", "review19_weather", "review19_done", "start", "final_time"] as const) {
    assert.deepEqual(choices({ ...fixture(), screen }), []);
  }
  assert.deepEqual(choices(fixture(), true), []);
  assert.deepEqual(choices(fixture("normal", "20")), []);
});

test("insufficient, disabled, missing recommendation/count and unknown auto have no quick choices", () => {
  for (const status of ["insufficient", "disabled"] as const) {
    const state = fixture();
    state.areaProgressMap[AREA].areaCountDecisionBasis!.recommendationStatus = status;
    assert.deepEqual(choices(state), []);
  }
  const absentBasis = fixture();
  delete absentBasis.areaProgressMap[AREA].areaCountDecisionBasis;
  assert.deepEqual(choices(absentBasis), []);
  const absentCount = fixture();
  delete absentCount.areaProgressMap[AREA].areaCount;
  assert.deepEqual(choices(absentCount), []);
  const unknownAuto = fixture();
  unknownAuto.areaProgressMap[AREA].areaCountEvaluationSource = "manual";
  assert.deepEqual(choices(unknownAuto), []);
});

// Execute production action declarations, with only external storage/React boundaries
// replaced. Assertions below inspect the actual records and AppState they produce.
const hookSource = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
const hookAst = ts.createSourceFile("useNebikiApp.ts", hookSource, ts.ScriptTarget.Latest, true);
function findNode<T extends ts.Node>(predicate: (node: ts.Node) => node is T): T {
  let result: T | undefined;
  const visit = (node: ts.Node): void => {
    if (predicate(node)) result = node;
    ts.forEachChild(node, visit);
  };
  visit(hookAst);
  assert.ok(result, "production declaration exists");
  return result;
}
function actionDeclaration(name: string): string {
  return findNode((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name,
  ).getText(hookAst);
}

function actionHarness(original: AreaCountEvaluation, options: {
  fixedTime?: boolean;
  screen?: AppState["screen"];
  decreaseBase?: AreaCountEvaluation;
  time?: DiscountTime;
  cycle?: DemandCycle;
} = {}) {
  const writes: AreaCountRecord[] = [];
  const state = fixture(original, options.time, options.cycle);
  if (options.screen) state.screen = options.screen;
  const originalRecommendation = recommendation(original, options.cycle);
  if (options.decreaseBase) {
    originalRecommendation.baseEvaluation = options.decreaseBase;
    originalRecommendation.decreaseRecommendation = {
      canUse: true, sampleSize: 3, requiredSampleSize: 3, previousDiscountTime: "15",
      previousCount: 48, currentDecreaseRate: 0.5, medianDecreaseRate: 0.2,
      direction: "more_few", detailLines: [],
    };
  }
  const context = {
    state,
    isTestMode: options.fixedTime ?? false,
    areaCountRecords: [] as AreaCountRecord[],
    remoteAreaCountHistoryRef: { current: [] },
    applyObonRule: true,
    getRuntimeNow: () => new Date(AT),
    getAreaEvaluationQuickAdjustments,
    createHumanEvaluationSelection,
    resolveHumanEvaluationForDiscount,
    normalizeDemandCycle,
    buildAreaCountDecisionBasis,
    buildSessionAnalysisCalendarContext,
    buildAnalysisWeatherContext,
    getCurrentDataVersionInfo,
    getActualWeekdayLabel,
    getAreaCountFallbackWeekdayGroup,
    isAreaCountAssistTarget,
    mergeAreaCountRecordCollections,
    cloneAreaCountRecords,
    getAreaCountRateAdjustment: evaluationToRateAdjustment,
    getCurrentAreaCountRecommendation: () => json(originalRecommendation),
    createUndoSnapshot: () => null,
    setUndoSnapshot: () => {},
    setUndoNotice: () => {},
    setAreaJudgeSelection: () => {},
    setCloudSyncVersion: () => {},
    retryPendingCloudSync: async () => {},
    finalizeFinalDayData: async () => ({ record: null, storageFailed: false }),
    removeReview19ExcludedAreaId: (ids: string[], areaId: string) => ids.filter((id) => id !== areaId),
    persistAreaCountRecordSafely: (record: AreaCountRecord) => {
      writes.push(json(record));
      return normalizeAreaCountRecords([record]);
    },
    setAreaCountRecords: (records: AreaCountRecord[]) => { context.areaCountRecords = records; },
    setState: (updater: (state: AppState) => AppState) => { context.state = updater(context.state); },
  };
  const code = ["applyAreaJudgeSelection", "judgeCurrentArea", "applyAreaEvaluationAdjustment"]
    .map(actionDeclaration).join("\n");
  const apply = runInNewContext(ts.transpileModule(`${code}\napplyAreaEvaluationAdjustment;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context) as (direction: HumanEvaluationAdjustment["direction"]) => Promise<void>;
  return { context, writes, apply };
}

function assertAdopted(state: AppState, record: AreaCountRecord, adjustment: HumanEvaluationAdjustment): void {
  const progress = state.areaProgressMap[AREA];
  assert.equal(progress.areaCountEvaluation, adjustment.finalEvaluation);
  assert.equal(record.suggestedEvaluation, adjustment.finalEvaluation);
  assert.equal(record.userJudge, adjustment.finalEvaluation);
  assert.equal(progress.humanEvaluationDetails?.automaticEvaluation, adjustment.originalEvaluation);
  assert.equal(record.humanEvaluationDetails?.automaticEvaluation, adjustment.originalEvaluation);
  assert.deepEqual(json(progress.humanEvaluationDetails?.evaluationAdjustment), adjustment);
  assert.deepEqual(record.humanEvaluationDetails?.evaluationAdjustment, adjustment);
  assert.equal(progress.areaCountDecisionBasis?.baseEvaluation, adjustment.originalEvaluation);
  assert.equal(progress.areaCountDecisionBasis?.finalEvaluation, adjustment.finalEvaluation);
  assert.equal(record.decisionBasis?.baseEvaluation, adjustment.originalEvaluation);
  assert.equal(record.decisionBasis?.finalEvaluation, adjustment.finalEvaluation);
  assert.equal(progress.areaRateAdjustment, evaluationToRateAdjustment(adjustment.finalEvaluation));
  assert.equal(record.areaRateAdjustment, evaluationToRateAdjustment(adjustment.finalEvaluation));
  assert.equal(progress.areaCountEvaluationSource, "manual");
  assert.equal(record.evaluationSource, "manual");
  assert.equal(normalizeHumanEvaluationDetails(record.humanEvaluationDetails)?.resolvedEvaluation, adjustment.finalEvaluation);
}

for (const [original, direction] of mappings) {
  test(`production quick action persists original/final/source/basis/rate for ${original} / ${direction}`, async () => {
    const harness = actionHarness(original);
    await harness.apply(direction);
    assert.equal(harness.writes.length, 1);
    assertAdopted(harness.context.state, harness.writes[0], createAreaEvaluationQuickAdjustment(original, direction)!);
  });
}

test("repeated lower and opposite higher are always relative to original auto normal", async () => {
  const harness = actionHarness("normal");
  await harness.apply("lower");
  await harness.apply("lower");
  assertAdopted(harness.context.state, harness.writes.at(-1)!, createAreaEvaluationQuickAdjustment("normal", "lower")!);
  assert.equal(choices(harness.context.state).length, 2);
  await harness.apply("higher");
  await harness.apply("higher");
  assertAdopted(harness.context.state, harness.writes.at(-1)!, createAreaEvaluationQuickAdjustment("normal", "higher")!);
  assert.equal(harness.context.areaCountRecords.length, 1, "same observation canonical identity is retained");
});

test("quick after decrease correction keeps original auto as base without changing decrease evidence", async () => {
  const harness = actionHarness("normal", { decreaseBase: "slightly_many" });
  await harness.apply("lower");
  assertAdopted(harness.context.state, harness.writes[0], createAreaEvaluationQuickAdjustment("normal", "lower")!);
  assert.equal(harness.writes[0].decisionBasis?.decreaseAdjustment?.direction, "more_few");
  assert.equal(harness.writes[0].decisionBasis?.decreaseAdjustment?.currentDecreaseRate, 0.5);
});

test("fixed-time and Review19 action calls perform no writes or state changes", async () => {
  for (const options of [{ fixedTime: true }, { screen: "review19" as const }, { time: "20" as const }]) {
    const harness = actionHarness("normal", options);
    const before = json(harness.context.state);
    await harness.apply("higher");
    assert.deepEqual(json(harness.context.state), before);
    assert.deepEqual(harness.writes, []);
  }
});

// Use the production completion expression, including its final adopted area adjustment.
function capturedRateFor(state: AppState) {
  const declaration = findNode((node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) && node.name.getText(hookAst) === "clickedRateDecisionSnapshot",
  );
  const code = `const ${declaration.getText(hookAst)}; clickedRateDecisionSnapshot;`;
  return runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    state, clickedAreaId: AREA, clickedProgress: state.areaProgressMap[AREA], completedAt: AT,
    finalGuide: null, effectiveRateDiscountTime: state.session!.discountTime,
    earlyNextMinus5Info: null, lateTimeBonus: 0, weekdayBaseInfo: { baseRateBonus: 10 },
    sessionSourceResolvedWeather: resolveWeatherInputForDiscount(state.session!.weather, state.session!.discountTime),
    effectiveRateIgnoreTimeRateCap: false, buildRateDecisionSnapshot, normalizeGlobalDiscountAdjustmentPercent,
  }) as ReturnType<typeof buildRateDecisionSnapshot>;
}

test("captured/displayed rate uses the final adopted adjustment for all eight quick paths", async () => {
  for (const [original, direction, final] of mappings) {
    const harness = actionHarness(original);
    await harness.apply(direction);
    const snapshot = capturedRateFor(harness.context.state);
    const expected = 20 + evaluationToRateAdjustment(final);
    assert.equal(snapshot.areaCountAdjustmentPercent, evaluationToRateAdjustment(final));
    assert.equal(snapshot.displayedRatePercent, expected);
    assert.equal(snapshot.display?.normal.main, `${expected}%`);
    assert.equal("evaluationAdjustment" in snapshot, false);
    assert.equal("humanEvaluationDetails" in snapshot, false);
  }
});

test("metadata survives current/checkpoint, snapshot, day, finalized, export and cloud record_details", async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    for (const direction of ["lower", "higher"] as const) {
      const harness = actionHarness("normal");
      await harness.apply(direction);
      const state = json(harness.context.state);
      const adjustment = createAreaEvaluationQuickAdjustment("normal", direction)!;
      state.areaProgressMap[AREA].rateDecisionSnapshot = capturedRateFor(state);
      saveCurrentSession(state);
      saveWorkSessionCheckpoint(state);
      for (const saved of [loadCurrentSession(), loadWorkSessionCheckpoint()]) {
        assert.ok(saved);
        const normalized = normalizeLoadedState(saved);
        assert.deepEqual(normalized.areaProgressMap[AREA].humanEvaluationDetails?.evaluationAdjustment, adjustment);
      }
      state.screen = "done";
      state.areaProgressMap[AREA].status = "completed";
      const resolvedWeather = resolveWeatherInputForDiscount(state.session!.weather, "17");
      const snapshotInputs = {
        capturedAt: AT, resolvedWeather, lateTimeBonus: 0, doneSummaryItems: [],
        weekdayBaseInfo: getWeekdayBaseInfo(2, "17", resolvedWeather, DATE),
        basisGuide: getBasisGuideDisplay({ date: DATE, weekday: 2, discountTime: "17", demandCycle: "normal", weather: resolvedWeather }),
      };
      const daily = createDailySessionSnapshot({ ...snapshotInputs, state });
      assert.ok(daily);
      const reviewSnapshot = createReview19Snapshot({
        ...snapshotInputs, session: state.session!, areaProgressMap: state.areaProgressMap, excludedAreaIds: [],
      });
      const day = createReview19DaySnapshot({ date: DATE, capturedAt: AT, demandCycle: "normal", sessions: [daily], areaCountRecords: harness.writes });
      const finalized = initializeFinalizedDayDataInMemory({ currentRecords: [], daySnapshot: day, finalizedAt: AT }).record;
      const dayExport = buildAutomaticDayExportPayload({ date: DATE, exportedAt: AT, daySnapshot: day });
      const review = createInitialReview19Result({ date: DATE, demandCycle: "normal", sessionStartedAt: state.session!.startedAt, reviewStartedAt: AT, excludedAreaIds: [] });
      review.review19Status = "recorded";
      review.recordedAt = AT;
      review.snapshot = reviewSnapshot;
      review.daySnapshot = day;
      const exported = buildDirectReview19DataExportPayload({ record: review, exportedAt: AT });
      const remote = buildRemoteAreaCountRow(harness.writes[0]);
      const propagated = [
        daily.areas[AREA].humanEvaluationDetails, reviewSnapshot.areas[AREA].humanEvaluationDetails,
        day.sessions[0].areas[AREA].humanEvaluationDetails, day.areaCountRecords[0].humanEvaluationDetails,
        finalized.sessions[0].areas[AREA].humanEvaluationDetails, finalized.areaCountRecords[0].humanEvaluationDetails,
        dayExport.daySnapshot.sessions[0].areas[AREA].humanEvaluationDetails,
        exported.records[0].snapshot!.areas[AREA].humanEvaluationDetails,
        exported.records[0].daySnapshot!.sessions[0].areas[AREA].humanEvaluationDetails,
        exported.records[0].daySnapshot!.areaCountRecords[0].humanEvaluationDetails,
        remote.record_details!.humanEvaluationDetails,
      ];
      for (const details of propagated) {
        assert.deepEqual(details?.evaluationAdjustment, adjustment);
        assert.equal(details?.automaticEvaluation, "normal");
        assert.equal(details?.resolvedEvaluation, adjustment.finalEvaluation);
      }
      assert.notEqual(daily.areas[AREA].humanEvaluationDetails, state.areaProgressMap[AREA].humanEvaluationDetails);
      assert.equal("evaluationAdjustment" in daily.areas[AREA].rateDecisionSnapshot!, false);
      assert.equal(exported.dataSchemaVersion, 3);
    }
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

const rateScreenSource = readFileSync(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url), "utf8");

test("rendered few/normal/many buttons identify destinations and only valid directions", () => {
  for (const original of ["few", "normal", "many"] as const) {
    const state = fixture(original);
    const html = rateScreenSource;
    assert.ok(choices(state).length >= 1);
    assert.ok(html.includes("evaluationText(adjustment.finalEvaluation)"));
    assert.equal((html.match(/key=\{adjustment\.direction\}/g) ?? []).length, 1);
    assert.ok(html.includes("自動判定を手動で変更") || html.includes("HumanEvaluationSelector"));
  }
});

test("quick keeps the opposite button/full manual available and shows final adopted evaluation", async () => {
  const harness = actionHarness("normal");
  await harness.apply("lower");
  const html = rateScreenSource;
  assert.ok(html.includes("evaluationText(adjustment.finalEvaluation)"));
  assert.ok(html.includes("onApplyAreaEvaluationAdjustment(adjustment.direction)"));
  assert.ok(html.includes("1段少ない側"));
  assert.ok(html.includes("採用判定"));
  assert.ok(html.includes("aria-pressed={"));
  assert.ok(html.includes("自動判定を手動で変更"));
  await harness.apply("higher");
  assert.ok(rateScreenSource.includes("1段多い側"));
});

test("rendered fixed-time and insufficient auto omit quick, full manual implementation remains", () => {
  assert.deepEqual(choices(fixture(), true), []);
  const insufficient = fixture();
  insufficient.areaProgressMap[AREA].areaCountDecisionBasis!.recommendationStatus = "insufficient";
  assert.equal(choices(insufficient).length, 0);
  const rateSource = rateScreenSource;
  assert.match(rateSource, /HumanEvaluationSelector/);
  const reviewSource = readFileSync(new URL("../src/components/screens/Review19Screen.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(reviewSource, /areaEvaluationQuickAdjustments|onApplyAreaEvaluationAdjustment/);
});

for (const { name, run } of tests) {
  await run();
  console.log(`PASS: ${name}`);
}
console.log(`area quick adjustment checks passed: ${tests.length}/${tests.length}`);
