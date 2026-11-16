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
import { getAreaEvaluationQuickAdjustments, getAreaEvaluationQuickAdjustmentBase } from "../src/domain/areaEvaluationAdjustment.ts";
import { buildAnalysisWeatherContext, buildSessionAnalysisCalendarContext } from "../src/domain/analysisMetadata.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { normalizeDemandCycle } from "../src/domain/demandCycle.ts";
import { createHumanEvaluationSelection, resolveHumanEvaluationForDiscount } from "../src/domain/humanEvaluation.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { cloneAppState, createNavigationSnapshot, popNavigationHistory, type NavigationSnapshot } from "../src/domain/navigationHistory.ts";
import { retainAreaProgressInNavigationSnapshot } from "../src/hooks/nebikiApp/decreaseSuppression.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import type { AppState, AreaCountEvaluation, AreaId, DemandCycle, DiscountTime, HumanEvaluationAdjustment, HumanEvaluationSelection, SessionDraft } from "../src/domain/types.ts";

const DATE = "2026-09-08";
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
    getRuntimeNow: () => new Date(Date.parse(`${DATE}T${time === "15" ? "06" : "08"}:10:00.000Z`) + clockCalls++),
    getAreaEvaluationQuickAdjustments, getAreaEvaluationQuickAdjustmentBase, createHumanEvaluationSelection, resolveHumanEvaluationForDiscount,
    normalizeDemandCycle, buildAreaCountDecisionBasis, buildSessionAnalysisCalendarContext,
    buildAnalysisWeatherContext, getCurrentDataVersionInfo, getActualWeekdayLabel,
    getAreaCountFallbackWeekdayGroup, isAreaCountAssistTarget, mergeAreaCountRecordCollections,
    cloneAreaCountRecords, getAreaCountRecordIdentity, setAreaCountDecreaseAdjustmentSuppressed,
    retainAreaProgressInNavigationSnapshot,
    getAreaCountRateAdjustment: evaluationToRateAdjustment,
    getCurrentAreaCountRecommendation: (newCount: number) => {
      recommendationCalls += 1;
      return rawRecommendation(newCount);
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
  const code = ["applyAreaJudgeSelection", "judgeCurrentArea", "applyAreaEvaluationAdjustment", "goBackOneScreen", "undoLastAction"].map(actionDeclaration).join("\n");
  const actions = runInNewContext(ts.transpileModule(`${code}\n({judge:judgeCurrentArea, quick:applyAreaEvaluationAdjustment, back:goBackOneScreen, undo:undoLastAction});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context) as {
    judge: (judge: "normal", count: number, manual?: AreaCountEvaluation, staple?: number | null, human?: HumanEvaluationSelection) => Promise<void>;
    quick: (direction: HumanEvaluationAdjustment["direction"]) => Promise<void>;
    back: () => void; undo: () => void;
  };
  return { context, attempts, writes, actions, rawRecommendation, get syncCalls() { return syncCalls; }, get recommendationCalls() { return recommendationCalls; } };
}


function adopted(value: ReturnType<typeof harness>, expected: AreaCountEvaluation) {
  const progress = value.context.state.areaProgressMap[value.context.state.currentAreaId!];
  assert.equal(progress.areaCountEvaluation, expected); assert.equal(progress.areaRateAdjustment, evaluationToRateAdjustment(expected));
  assert.equal(progress.areaCountDecisionBasis?.finalEvaluation, expected);
  assert.equal(progress.areaCountDecisionBasis?.decreaseAdjustment?.mode, "reference_only_v1");
  assert.equal(progress.areaCountDecisionBasis?.decreaseAdjustment?.applied, false);
  assert.equal(progress.areaCountDecisionBasis?.decreaseAdjustment?.suppressed, undefined);
  const latest = value.writes.at(-1); if (latest) { assert.equal(latest.suggestedEvaluation, expected); assert.equal(latest.decisionBasis?.finalEvaluation, expected); }
}
function seedLegacy(h: ReturnType<typeof harness>, suppressed = false) {
  const p = h.context.currentAreaProgress, basis = p.areaCountDecisionBasis!;
  delete basis.decreaseAdjustment!.mode; delete basis.decreaseAdjustment!.applied;
  basis.finalEvaluation = suppressed ? "normal" : "slightly_many"; basis.areaRateAdjustment = suppressed ? 0 : 5;
  if (suppressed) { basis.decreaseAdjustment!.suppressed = true; basis.decreaseAdjustment!.suppressionReason = "additional_production"; }
  p.areaCountEvaluation = basis.finalEvaluation; p.areaRateAdjustment = basis.areaRateAdjustment;
  return json(p);
}

test("retired hook toggle and navigation rewrite actions are absent", () => {
  assert.doesNotMatch(hookSource, /function toggleCurrentAreaDecreaseAdjustmentSuppression|function retainCurrentAreaNavigationProgress/);
});
test("bad-reference automatic adoption is residual only and quick lower/higher never accumulates", async () => {
  const h = harness(); adopted(h, "normal");
  for (let n = 0; n < 3; n++) { await h.actions.quick("lower"); adopted(h, "slightly_few"); await h.actions.quick("higher"); adopted(h, "slightly_many"); }
  assert.equal(h.context.currentAreaProgress.humanEvaluationDetails?.evaluationAdjustment?.originalEvaluation, "normal");
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.baseEvaluation, "normal");
});
test("legacy prior correction and cancellation both use residual quick baseline without restoring the old layer", async () => {
  for (const suppressed of [false, true]) {
    const h = harness(); seedLegacy(h, suppressed); await h.actions.quick("lower"); adopted(h, "slightly_few");
    assert.equal(h.context.currentAreaProgress.humanEvaluationDetails?.automaticEvaluation, "normal");
    await h.actions.quick("higher"); adopted(h, "slightly_many");
  }
});
test("quick changes only the current cycle-aware AreaCount identity and preserves other observations", async () => {
  const h = harness(), before = json(h.context.areaCountRecords), original = h.context.state;
  const current = { ...h.context.areaCountRecords.at(-1)!, comfortPoint: 17 }, opposite = { ...current, demandCycle: "summer" as const, comfortPoint: 99 };
  h.context.areaCountRecords = [opposite, ...h.context.areaCountRecords.slice(0, -1), current];
  await h.actions.quick("lower");
  assert.equal(h.writes.at(-1)?.demandCycle, "normal");
  assert.deepEqual(json(h.context.areaCountRecords.filter(row => row.date !== DATE)).sort((a,b) => getAreaCountRecordIdentity(a).localeCompare(getAreaCountRecordIdentity(b))), before.filter(row => row.date !== DATE).sort((a,b) => getAreaCountRecordIdentity(a).localeCompare(getAreaCountRecordIdentity(b))));
  assert.equal(h.context.state.areaProgressMap.tempura, original.areaProgressMap.tempura);
  assert.equal(h.context.state.session, original.session); assert.equal(h.context.state.finalTimeStep, original.finalTimeStep);
  assert.equal(h.context.areaCountRecords.find(row => getAreaCountRecordIdentity(row) === getAreaCountRecordIdentity(opposite))?.comfortPoint, 99);
});
test("slightly-few residual base keeps its own quick choices despite bad reference", async () => {
  const h = harness({ medianCount: 24 }); adopted(h, "slightly_few");
  await h.actions.quick("lower"); adopted(h, "few"); await h.actions.quick("higher"); adopted(h, "normal");
});
test("real undo restores new reference automatic state and raw evidence", async () => {
  const h = harness(), initial = json(h.context.state); await h.actions.quick("lower"); adopted(h, "slightly_few"); h.actions.undo(); assert.deepEqual(json(h.context.state), initial);
});
test("undo restores an old absent-mode adoption exactly after an explicit new quick", async () => {
  const h = harness(); seedLegacy(h, true); const initial = json(h.context.state);
  await h.actions.quick("higher"); adopted(h, "slightly_many"); h.actions.undo(); assert.deepEqual(json(h.context.state), initial);
});
test("all nine explicit human observations preserve human raw9 and resolution in both demand cycles", async () => {
  for (let score = 1; score <= 9; score++) {
    const h = harness({ cycle: score % 2 ? "normal" : "summer" }), index = Math.floor((score - 1) / 2);
    const selection = createHumanEvaluationSelection(EVALUATIONS[index], score % 2 ? undefined : EVALUATIONS[index + 1])!;
    const expected = resolveHumanEvaluationForDiscount({ selection, demandCycle: score % 2 ? "normal" : "summer", sessionDiscountTime: "17", nowMs: new Date(`${DATE}T08:10:00.000Z`).getTime(), evaluatedAt: `${DATE}T08:10:00.000Z` });
    await h.actions.judge("normal", 20, undefined, undefined, selection);
    adopted(h, expected.resolvedEvaluation); assert.equal(h.context.currentAreaProgress.humanEvaluationDetails?.humanEvaluationScore9, score);
    assert.equal(h.context.currentAreaProgress.humanEvaluationDetails?.automaticEvaluation, "normal");
  }
});
test("all five manual final choices override residual and reference without altering raw decrease", async () => {
  for (const evaluation of EVALUATIONS) { const h = harness(); const direction = h.context.currentAreaProgress.areaCountDecisionBasis?.decreaseAdjustment?.direction;
    await h.actions.judge("normal", 20, evaluation); adopted(h, evaluation); assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.decreaseAdjustment?.direction, direction); }
});
test("rejudging a legacy saved result without an explicit manual choice replaces only its new adoption", async () => {
  const h = harness(); seedLegacy(h); await h.actions.judge("normal", 20); adopted(h, "normal");
});
test("correcting a legacy suppressed count uses the new count and no suppression metadata", async () => {
  const h = harness(); seedLegacy(h, true); h.context.state = { ...h.context.state, screen: "area_judge" }; await h.actions.judge("normal", 18);
  adopted(h, "slightly_few"); assert.equal(h.context.currentAreaProgress.areaCount, 18);
  assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.decreaseAdjustment?.currentDecreaseRate, 0.1);
});
test("count correction undo restores the old count, saved adopted result and metadata atomically", async () => {
  const h = harness(); seedLegacy(h, true); h.context.state = { ...h.context.state, screen: "area_judge" }; const before = json(h.context.state);
  await h.actions.judge("normal", 18); h.actions.undo(); assert.deepEqual(json(h.context.state), before);
});
test("ordinary count changes preserve the raw classification and residual evaluation", async () => {
  const h = harness(); await h.actions.judge("normal", 1); adopted(h, "few"); assert.equal(h.context.currentAreaProgress.areaCountDecisionBasis?.decreaseAdjustment?.direction, "none");
});
test("back restores the existing atomic navigation snapshot without special suppression retention", async () => {
  const h = harness(), target = json(h.context.screenHistoryRef.current.at(-1)!.state); await h.actions.judge("normal", 18); h.actions.back(); assert.deepEqual(json(h.context.state), target);
});
test("local-first write failure leaves canonical state/history unchanged and does not sync", async () => {
  const h = harness({ failSave: true }), state = h.context.state, records = h.context.areaCountRecords, navigation = h.context.screenHistoryRef.current;
  await h.actions.quick("lower"); assert.equal(h.attempts.length, 1); assert.equal(h.writes.length, 0); assert.equal(h.syncCalls, 0);
  assert.equal(h.context.state, state); assert.equal(h.context.areaCountRecords, records); assert.equal(h.context.screenHistoryRef.current, navigation);
});
test("fixed mode and other screens keep quick actions read-only", async () => {
  for (const options of [{ fixed: true }, { screen: "area_judge" as const }]) {
    const h = harness(options), state = h.context.state, records = h.context.areaCountRecords;
    await h.actions.quick("lower"); assert.equal(h.attempts.length, 0); assert.equal(h.context.state, state); assert.equal(h.context.areaCountRecords, records);
  }
});
test("legacy saved metadata missing optional source/final survives normalization without added marker", () => {
  for (const field of ["evaluationSource", "finalEvaluation"] as const) {
    const h = harness(); seedLegacy(h, true); delete h.context.currentAreaProgress.areaCountDecisionBasis![field];
    const row = { ...h.context.areaCountRecords.at(-1)!, decisionBasis: h.context.currentAreaProgress.areaCountDecisionBasis };
    const recovered = normalizeAreaCountRecords([row])[0].decisionBasis!; assert.equal(recovered[field], undefined);
    assert.equal(recovered.decreaseAdjustment?.suppressed, true); assert.equal(Object.hasOwn(recovered.decreaseAdjustment!, "mode"), false);
  }
});
test("legacy navigation helper remains immutable and limited to same-area/same-session references", () => {
  const h = harness(); seedLegacy(h, true); const state = h.context.state, progress = { ...state.areaProgressMap[AREA] };
  const old = snapshot({ ...state, screen: "area_judge" }), before = json(old), retained = retainAreaProgressInNavigationSnapshot(old, state, AREA, progress);
  assert.notEqual(retained, old); assert.equal(retained.state.areaProgressMap[AREA], progress); assert.deepEqual(json(old), before);
  for (const patch of [{ currentAreaId: "tempura" as const }, { screen: "start" as const }, { session: { ...state.session!, date: "2026-09-09" } }]) {
    const other = snapshot({ ...state, ...patch }); assert.equal(retainAreaProgressInNavigationSnapshot(other, state, AREA, progress), other);
  }
});
for (const item of tests) { await item.run(); console.log(`PASS ${item.name}`); }
console.log(`Decrease suppression compatibility/new reference flow checks passed: ${tests.length}/${tests.length}`);
