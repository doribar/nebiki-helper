import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  buildAreaCountDecisionBasis,
  cloneAreaCountRecords,
  evaluationToRateAdjustment,
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  getAreaCountRecordIdentity,
  isAreaCountAssistTarget,
  mergeAreaCountRecordCollections,
  normalizeAreaCountRecords,
  prepareAreaCountCalculationPopulation,
  setAreaCountDecreaseAdjustmentSuppressed,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { getAreaEvaluationQuickAdjustments } from "../src/domain/areaEvaluationAdjustment.ts";
import { buildAnalysisWeatherContext, buildSessionAnalysisCalendarContext } from "../src/domain/analysisMetadata.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { normalizeDemandCycle } from "../src/domain/demandCycle.ts";
import { createHumanEvaluationSelection, resolveHumanEvaluationForDiscount } from "../src/domain/humanEvaluation.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { cloneAppState, createNavigationSnapshot, popNavigationHistory, type NavigationSnapshot } from "../src/domain/navigationHistory.ts";
import { retainAreaProgressInNavigationSnapshot, retainSuppressedDecreaseRecommendation } from "../src/hooks/nebikiApp/decreaseSuppression.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import type { AppState, AreaCountEvaluation, AreaId, DemandCycle, DiscountTime, HumanEvaluationAdjustment, HumanEvaluationSelection, SessionDraft } from "../src/domain/types.ts";

const DATE = "2026-09-08";
const AT = `${DATE}T08:10:00.000Z`;
const AREA = "bento_men";
const EVALUATIONS: AreaCountEvaluation[] = ["few", "slightly_few", "normal", "slightly_many", "many"];
const tests: { name: string; run: () => void | Promise<void> }[] = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push({ name, run });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const hookSource = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
const hookAst = ts.createSourceFile("useNebikiApp.ts", hookSource, ts.ScriptTarget.Latest, true);
function actionDeclaration(name: string): string {
  let result: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node;
    ts.forEachChild(node, visit);
  };
  visit(hookAst);
  assert.ok(result, `production action ${name} exists`);
  return result.getText(hookAst);
}

function record(date: string, areaId: AreaId, time: DiscountTime, count: number, cycle: DemandCycle = "normal"): AreaCountRecord {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return {
    ...getCurrentDataVersionInfo(), date, areaId, discountTime: time, count,
    demandCycle: cycle, sessionStartedAt: `${date}T08:00:00.000Z`, recordedAt: `${date}T08:05:00.000Z`,
    actualWeekday: getActualWeekdayLabel(weekday),
    actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({ date, weekday, discountTime: time }),
  };
}
function snapshot(state: AppState): NavigationSnapshot {
  return createNavigationSnapshot({ state, areaJudgeSelection: "normal", resumeTargetScreen: null, nextSessionSkipRecords: [], lastSessionWeather: null });
}

// Run the real production declarations. Only React setters, local-first storage,
// clock, finalization and cloud boundaries are injected; recommendation/domain
// functions and the navigation-retention helper remain the production code.
function harness(options: {
  areaId?: AreaId; time?: DiscountTime; cycle?: DemandCycle;
  count?: number; medianCount?: number; previous?: number;
  fixed?: boolean; screen?: AppState["screen"]; failSave?: boolean;
} = {}) {
  const areaId = options.areaId ?? AREA;
  const time = options.time ?? "17";
  const cycle = options.cycle ?? "normal";
  const count = options.count ?? 20;
  const medianCount = options.medianCount ?? 20;
  const previousTime = time === "19" ? "18" : "15";
  const history = ["2026-08-18", "2026-08-25", "2026-09-01"].flatMap((date) => [
    record(date, areaId, time, medianCount, cycle),
    record(date, areaId, previousTime, medianCount * 5, cycle),
  ]);
  history.push(record(DATE, areaId, previousTime, options.previous ?? 20, cycle));
  const preparedPopulation = prepareAreaCountCalculationPopulation(history);
  const rawRecommendation = (newCount: number) => getAreaCountRecommendation({ records: history, preparedPopulation, areaId, discountTime: time, date: DATE, weekday: 2, demandCycle: cycle, count: newCount });
  const automatic = rawRecommendation(count);
  const draft: SessionDraft = { date: DATE, weekday: 2, discountTime: time, demandCycle: cycle, manualWeekdayOverride: false, manualDiscountTimeOverride: false, weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null } };
  const state = createInitialState(draft);
  state.session = { ...draft, ...getCurrentDataVersionInfo(), startedAt: `${DATE}T08:00:00.000Z` };
  state.currentAreaId = areaId;
  state.screen = options.screen ?? "rate_display";
  state.areaProgressMap[areaId] = {
    ...state.areaProgressMap[areaId], areaCount: count, areaJudge: "normal",
    areaCountEvaluation: automatic.suggestedEvaluation, areaCountEvaluationSource: "history", areaRateAdjustment: automatic.areaRateAdjustment,
    areaCountDecisionBasis: buildAreaCountDecisionBasis({ recommendation: automatic, evaluationSource: "history", finalEvaluation: automatic.suggestedEvaluation, areaRateAdjustment: automatic.areaRateAdjustment }),
  };
  const savedCurrent = { ...record(DATE, areaId, time, count, cycle), suggestedEvaluation: automatic.suggestedEvaluation, evaluationSource: "history" as const, areaRateAdjustment: automatic.areaRateAdjustment, decisionBasis: state.areaProgressMap[areaId].areaCountDecisionBasis };
  const attempts: AreaCountRecord[] = [];
  const writes: AreaCountRecord[] = [];
  let clockCalls = 0;
  let syncCalls = 0;
  let recommendationCalls = 0;
  const context = {
    state, isTestMode: options.fixed ?? false, failSave: options.failSave ?? false,
    areaCountRecords: [...history, savedCurrent],
    currentAreaProgress: state.areaProgressMap[areaId],
    undoSnapshot: null as NavigationSnapshot | null,
    screenHistoryRef: { current: [snapshot({ ...state, screen: "area_judge" }), snapshot({ ...state, finalTimeStep: 0 })] },
    previousRenderRef: { current: snapshot(state) as NavigationSnapshot | null },
    suppressHistoryPushRef: { current: false }, remoteAreaCountHistoryRef: { current: [] as AreaCountRecord[] },
    applyObonRule: true,
    getRuntimeNow: () => new Date(Date.parse(AT) + clockCalls++),
    getAreaEvaluationQuickAdjustments, createHumanEvaluationSelection, resolveHumanEvaluationForDiscount,
    normalizeDemandCycle, buildAreaCountDecisionBasis, buildSessionAnalysisCalendarContext,
    buildAnalysisWeatherContext, getCurrentDataVersionInfo, getActualWeekdayLabel,
    getAreaCountFallbackWeekdayGroup, isAreaCountAssistTarget, mergeAreaCountRecordCollections,
    cloneAreaCountRecords, getAreaCountRecordIdentity, setAreaCountDecreaseAdjustmentSuppressed,
    retainAreaProgressInNavigationSnapshot,
    getAreaCountRateAdjustment: evaluationToRateAdjustment,
    getCurrentAreaCountRecommendation: (newCount: number) => {
      recommendationCalls += 1;
      return retainSuppressedDecreaseRecommendation({ recommendation: rawRecommendation(newCount), previousBasis: context.state.areaProgressMap[areaId]?.areaCountDecisionBasis, areaId, discountTime: time });
    },
    createUndoSnapshot: () => snapshot(context.state),
    setUndoSnapshot: (value: NavigationSnapshot | null | ((previous: NavigationSnapshot | null) => NavigationSnapshot | null)) => { context.undoSnapshot = typeof value === "function" ? value(context.undoSnapshot) : value; },
    setUndoNotice: () => {}, setAreaJudgeSelection: () => {}, setCloudSyncVersion: () => {},
    retryPendingCloudSync: async () => { syncCalls += 1; },
    finalizeFinalDayData: async () => ({ record: null, storageFailed: false }),
    removeReview19ExcludedAreaId: (ids: string[], id: string) => ids.filter((item) => item !== id),
    persistAreaCountRecordSafely: (next: AreaCountRecord) => {
      attempts.push(json(next));
      if (context.failSave) return null;
      writes.push(json(next));
      return normalizeAreaCountRecords([next]);
    },
    setAreaCountRecords: (value: AreaCountRecord[] | ((previous: AreaCountRecord[]) => AreaCountRecord[])) => { context.areaCountRecords = typeof value === "function" ? value(context.areaCountRecords) : value; },
    setState: (updater: (previous: AppState) => AppState) => { context.state = updater(context.state); },
    popNavigationHistory,
    restoreNavigationSnapshot: (saved: NavigationSnapshot) => { context.state = cloneAppState(saved.state); },
    window: { confirm: () => true },
  };
  Object.defineProperty(context, "currentAreaProgress", { get: () => context.state.currentAreaId ? context.state.areaProgressMap[context.state.currentAreaId] : undefined });
  const code = ["applyAreaJudgeSelection", "judgeCurrentArea", "retainCurrentAreaNavigationProgress", "toggleCurrentAreaDecreaseAdjustmentSuppression", "applyAreaEvaluationAdjustment", "goBackOneScreen", "undoLastAction"].map(actionDeclaration).join("\n");
  const actions = runInNewContext(ts.transpileModule(`${code}\n({toggle:toggleCurrentAreaDecreaseAdjustmentSuppression, judge:judgeCurrentArea, quick:applyAreaEvaluationAdjustment, back:goBackOneScreen, undo:undoLastAction});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context) as {
    toggle: () => Promise<void>;
    judge: (judge: "normal", count: number, manual?: AreaCountEvaluation, staple?: number | null, human?: HumanEvaluationSelection) => Promise<void>;
    quick: (direction: HumanEvaluationAdjustment["direction"]) => Promise<void>;
    back: () => void; undo: () => void;
  };
  return { context, attempts, writes, actions, rawRecommendation, get syncCalls() { return syncCalls; }, get recommendationCalls() { return recommendationCalls; } };
}

function adopted(value: ReturnType<typeof harness>, expected: AreaCountEvaluation, suppressed: boolean) {
  const progress = value.context.state.areaProgressMap[value.context.state.currentAreaId!];
  assert.equal(progress.areaCountEvaluation, expected);
  assert.equal(progress.areaRateAdjustment, evaluationToRateAdjustment(expected));
  assert.equal(progress.areaCountDecisionBasis?.finalEvaluation, expected);
  assert.equal(progress.areaCountDecisionBasis?.decreaseAdjustment?.suppressed === true, suppressed);
  assert.equal(progress.areaCountDecisionBasis?.decreaseAdjustment?.direction, "more_many");
  if (suppressed) assert.equal(progress.areaCountDecisionBasis?.decreaseAdjustment?.suppressionReason, "additional_production");
  const latest = value.writes.at(-1);
  if (latest) {
    assert.equal(latest.suggestedEvaluation, expected);
    assert.equal(latest.decisionBasis?.finalEvaluation, expected);
    assert.equal(latest.decisionBasis?.decreaseAdjustment?.suppressed === true, suppressed);
  }
}

test("real toggle cancels/restores/repeats from saved raw base without calculating history", async () => {
  const h = harness();
  const initial = json(h.context.currentAreaProgress.areaCountDecisionBasis!.decreaseAdjustment);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    await h.actions.toggle();
    adopted(h, "normal", true);
    const { suppressed, suppressionReason, ...raw } = json(h.context.currentAreaProgress.areaCountDecisionBasis!.decreaseAdjustment!);
    assert.equal(suppressed, true);
    assert.equal(suppressionReason, "additional_production");
    assert.deepEqual(raw, initial);
    await h.actions.toggle();
    adopted(h, "slightly_many", false);
    assert.deepEqual(json(h.context.currentAreaProgress.areaCountDecisionBasis!.decreaseAdjustment), initial);
  }
  assert.equal(h.writes.length, 6);
  assert.equal(h.recommendationCalls, 0);
});

test("real toggle changes only the current AreaCount record and preserves other objects", async () => {
  const h = harness();
  const previousState = h.context.state;
  const previousRecords = h.context.areaCountRecords;
  const identity = getAreaCountRecordIdentity(previousRecords.at(-1)!);
  const siblings = previousRecords.filter((item) => getAreaCountRecordIdentity(item) !== identity);
  await h.actions.toggle();
  assert.notEqual(h.context.areaCountRecords, previousRecords);
  assert.equal(h.context.areaCountRecords.length, previousRecords.length);
  for (const record of siblings) assert.equal(h.context.areaCountRecords.find((candidate) => getAreaCountRecordIdentity(candidate) === getAreaCountRecordIdentity(record)), record);
  assert.equal(h.context.state.areaProgressMap.tempura, previousState.areaProgressMap.tempura);
  assert.equal(h.context.state.session, previousState.session);
  assert.equal(h.context.state.finalTimeStep, previousState.finalTimeStep);
  assert.equal(h.recommendationCalls, 0);
});

test("toggle selects saved metadata from its cycle-aware identity", async () => {
  const h = harness();
  const current = { ...h.context.areaCountRecords.at(-1)!, comfortPoint: 17 };
  const opposite = { ...current, demandCycle: "summer" as const, comfortPoint: 99 };
  h.context.areaCountRecords = [opposite, ...h.context.areaCountRecords.slice(0, -1), current];
  await h.actions.toggle();
  assert.equal(h.writes.at(-1)?.demandCycle, "normal");
  assert.equal(h.writes.at(-1)?.comfortPoint, 17);
  assert.equal(h.context.areaCountRecords.find((candidate) => getAreaCountRecordIdentity(candidate) === getAreaCountRecordIdentity(opposite)), opposite);
});

test("slightly-few base cancels normal correction and restores exactly once", async () => {
  const h = harness({ medianCount: 24 });
  assert.equal(h.context.currentAreaProgress.areaCountEvaluation, "normal");
  await h.actions.toggle();
  adopted(h, "slightly_few", true);
  await h.actions.toggle();
  adopted(h, "normal", false);
});

test("cancel then quick lower retains metadata, restore preserves human, opposite quick uses original", async () => {
  const h = harness();
  await h.actions.toggle();
  await h.actions.quick("lower");
  adopted(h, "slightly_few", true);
  assert.equal(h.context.currentAreaProgress.areaCountEvaluationSource, "manual");
  assert.equal(h.context.currentAreaProgress.humanEvaluationDetails?.automaticEvaluation, "normal");
  assert.equal(h.context.currentAreaProgress.humanEvaluationDetails?.evaluationAdjustment?.originalEvaluation, "normal");
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.baseEvaluation, "normal");
  await h.actions.toggle();
  adopted(h, "slightly_few", false);
  await h.actions.quick("higher");
  adopted(h, "slightly_many", false);
  assert.equal(h.context.currentAreaProgress.humanEvaluationDetails?.evaluationAdjustment?.originalEvaluation, "normal");
});

test("quick before cancel preserves the existing quick base/original/final semantics", async () => {
  const h = harness();
  await h.actions.quick("lower");
  adopted(h, "normal", false);
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.baseEvaluation, "slightly_many");
  const human = json(h.context.currentAreaProgress.humanEvaluationDetails);
  await h.actions.toggle();
  adopted(h, "normal", true);
  assert.deepEqual(json(h.context.currentAreaProgress.humanEvaluationDetails), human);
  await h.actions.toggle();
  adopted(h, "normal", false);
  await h.actions.quick("higher");
  adopted(h, "many", false);
  assert.equal(h.context.currentAreaProgress.humanEvaluationDetails?.evaluationAdjustment?.originalEvaluation, "slightly_many");
});

test("cancel then quick then real undo restores prior automatic state and cancellation", async () => {
  const h = harness();
  await h.actions.toggle();
  const cancelled = json(h.context.state);
  await h.actions.quick("lower");
  adopted(h, "slightly_few", true);
  h.actions.undo();
  assert.deepEqual(json(h.context.state), cancelled);
  assert.equal(h.context.currentAreaProgress.areaCountEvaluation, "normal");
  assert.equal(h.context.currentAreaProgress.humanEvaluationDetails, undefined);
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.decreaseAdjustment?.suppressed, true);
});

test("all nine explicit human observations retain their final/resolution through cancel and restore", async () => {
  for (let score = 1; score <= 9; score += 1) {
    const h = harness({ cycle: score % 2 ? "normal" : "summer" });
    const index = Math.floor((score - 1) / 2);
    const selection = createHumanEvaluationSelection(EVALUATIONS[index], score % 2 ? undefined : EVALUATIONS[index + 1]);
    assert.ok(selection);
    await h.actions.judge("normal", 20, undefined, undefined, selection);
    const human = json(h.context.currentAreaProgress.humanEvaluationDetails);
    const final = h.context.currentAreaProgress.areaCountEvaluation!;
    await h.actions.toggle();
    adopted(h, final, true);
    assert.deepEqual(json(h.context.currentAreaProgress.humanEvaluationDetails), human);
    await h.actions.toggle();
    adopted(h, final, false);
    assert.deepEqual(json(h.context.currentAreaProgress.humanEvaluationDetails), human);
  }
});

test("legacy basis missing optional source/final keeps authoritative manual progress", async () => {
  for (const missingField of ["evaluationSource", "finalEvaluation"] as const) {
    const h = harness();
    const selection = createHumanEvaluationSelection("few")!;
    await h.actions.judge("normal", 20, undefined, undefined, selection);
    delete h.context.currentAreaProgress.areaCountDecisionBasis![missingField];
    const human = json(h.context.currentAreaProgress.humanEvaluationDetails);
    await h.actions.toggle();
    adopted(h, "few", true);
    assert.deepEqual(json(h.context.currentAreaProgress.humanEvaluationDetails), human);
    await h.actions.toggle();
    adopted(h, "few", false);
  }
});

test("corrected count retains cancellation, uses new raw base/rate, back shows corrected count", async () => {
  const h = harness();
  await h.actions.toggle();
  h.context.state = { ...h.context.state, screen: "area_judge" };
  await h.actions.judge("normal", 18);
  adopted(h, "slightly_few", true);
  assert.equal(h.context.currentAreaProgress.areaCount, 18);
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.baseEvaluation, "slightly_few");
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.decreaseAdjustment?.currentDecreaseRate, 0.1);
  h.actions.back();
  assert.equal(h.context.currentAreaProgress.areaCount, 18);
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.decreaseAdjustment?.suppressed, true);
  h.context.state = { ...h.context.state, screen: "rate_display" };
  await h.actions.toggle();
  adopted(h, "normal", false);
});

test("count correction undo retains the prior cancelled count and automatic evaluation", async () => {
  const h = harness();
  await h.actions.toggle();
  h.context.state = { ...h.context.state, screen: "area_judge" };
  const previous = json(h.context.state);
  await h.actions.judge("normal", 18);
  h.actions.undo();
  assert.deepEqual(json(h.context.state), previous);
  assert.equal(h.context.currentAreaProgress.areaCount, 20);
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.decreaseAdjustment?.suppressed, true);
});

test("count change to ordinary decrease drops inapplicable exception rather than changing raw direction", async () => {
  const h = harness();
  await h.actions.toggle();
  await h.actions.judge("normal", 1);
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.decreaseAdjustment?.direction, "none");
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.decreaseAdjustment?.suppressed, undefined);
  assert.equal(h.context.currentAreaProgress.areaCountEvaluation, "few");
});

test("local-first write failure leaves canonical state/history/navigation untouched", async () => {
  const h = harness({ failSave: true });
  const previousState = h.context.state;
  const previousRecords = h.context.areaCountRecords;
  const previousNavigation = h.context.screenHistoryRef.current;
  const previousRender = h.context.previousRenderRef.current;
  await h.actions.toggle();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.syncCalls, 0);
  assert.equal(h.context.state, previousState);
  assert.equal(h.context.areaCountRecords, previousRecords);
  assert.equal(h.context.screenHistoryRef.current, previousNavigation);
  assert.equal(h.context.previousRenderRef.current, previousRender);
});

test("fixed mode, other time/area, good/normal and other screen actions do nothing", async () => {
  for (const options of [
    { fixed: true }, { time: "19" as const }, { time: "18" as const },
    { areaId: "sushi" as const }, { screen: "area_judge" as const },
    { count: 1, previous: 100 }, { count: 4, previous: 20 },
  ]) {
    const h = harness(options);
    const previousState = h.context.state;
    const previousRecords = h.context.areaCountRecords;
    await h.actions.toggle();
    assert.equal(h.attempts.length, 0);
    assert.equal(h.context.state, previousState);
    assert.equal(h.context.areaCountRecords, previousRecords);
  }
});

test("navigation retention changes only same-area/same-session references and no old inputs", () => {
  const h = harness();
  const state = h.context.state;
  const basis = setAreaCountDecreaseAdjustmentSuppressed({ areaId: AREA, discountTime: "17", basis: state.areaProgressMap[AREA].areaCountDecisionBasis!, suppressed: true })!;
  const progress = { ...state.areaProgressMap[AREA], areaCountDecisionBasis: basis, areaCountEvaluation: basis.finalEvaluation, areaRateAdjustment: basis.areaRateAdjustment };
  const old = snapshot({ ...state, screen: "area_judge" });
  const before = json(old);
  const retained = retainAreaProgressInNavigationSnapshot(old, state, AREA, progress);
  assert.notEqual(retained, old);
  assert.equal(retained.state.areaProgressMap[AREA], progress);
  assert.equal(retained.state.areaProgressMap.tempura, old.state.areaProgressMap.tempura);
  assert.deepEqual(json(old), before);
  for (const patch of [
    { currentAreaId: "tempura" as const }, { screen: "start" as const },
    { session: { ...state.session!, discountTime: "19" as const } },
    { session: { ...state.session!, date: "2026-09-09" } },
    { session: { ...state.session!, startedAt: `${DATE}T08:01:00.000Z` } },
  ]) {
    const other = snapshot({ ...state, ...patch });
    assert.equal(retainAreaProgressInNavigationSnapshot(other, state, AREA, progress), other);
  }
});

for (const item of tests) {
  await item.run();
  console.log(`PASS ${item.name}`);
}
console.log(`Decrease suppression flow checks passed: ${tests.length}/${tests.length}`);
