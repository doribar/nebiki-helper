import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { normalizeDemandCycle } from "../src/domain/demandCycle.ts";
import { getEarlyNextMinus5TargetDiscountTime } from "../src/domain/earlyNextMinus5.ts";
import { normalizeGlobalDiscountAdjustmentPercent } from "../src/domain/globalDiscountAdjustment.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import {
  cloneAppState, cloneLastSessionWeatherRecord, cloneSkipRecords,
  createNavigationSnapshot, popNavigationHistory,
} from "../src/domain/navigationHistory.ts";
import type { NavigationSnapshot } from "../src/domain/navigationHistory.ts";
import { getNextPendingCandidate, getPendingResumeScreen } from "../src/domain/pending.ts";
import { buildRateDecisionSnapshot, normalizeRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import {
  consumeSkipRecordsInMemory, loadCurrentSession, loadDailySessionSnapshots,
  saveCurrentSession, saveDailySessionSnapshots,
} from "../src/domain/storage.ts";
import type {
  AppState, GlobalDiscountAdjustmentPercent, NextSessionSkipRecord,
  RateDecisionSnapshot, ScreenName, SessionData,
} from "../src/domain/types.ts";
import { buildMergedBonusDisplay, getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { formatLocalDate } from "../src/hooks/nebikiApp/clock.ts";
import { getNextNormalFlowAreaId, getNextNormalFlowAreaIdWithWrap, getNormalFlowScreenForArea } from "../src/hooks/nebikiApp/normalFlow.ts";
import {
  buildCompletedRateSnapshot, buildCurrentNormalRatePresentation,
  buildNextSessionSkipRecord, shouldIgnoreNormalTimeRateCap,
} from "../src/hooks/nebikiApp/ratePresentation.ts";
import { createReview19StartState, getAutomaticReview19TransitionKey } from "../src/hooks/nebikiApp/review19Flow.ts";
import { createDailySessionSnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { resolveSessionTemperatureComfort } from "../src/hooks/nebikiApp/temperatureComfortState.ts";
import { createTimeSwitchPlan, getNextSkipTargetDiscountTime, refreshSessionDiscountTime } from "../src/hooks/nebikiApp/timeTransitions.ts";

// Execute current production hook declarations with in-memory boundaries.
// This is a domain/hook workflow test, not an interactive browser check.
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
const DATE = "2026-10-01";
const at = (hour: number, minute = 0) => new Date(2026, 9, 1, hour, minute);
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const tests: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void) => tests.push({ name, run });

function fixture(global: GlobalDiscountAdjustmentPercent = 0): AppState {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const forecast of Object.values(hourlyForecasts)) {
    forecast.weather = "sunny";
    forecast.tempC = 24;
    forecast.windMs = 2;
  }
  // The target 18:30 weather differs from 17:00, exposing wrong weather wiring.
  hourlyForecasts["19"] = { weather: "rain", tempC: 24, windMs: 2 };
  const session: SessionData = {
    ...getCurrentDataVersionInfo(), date: DATE, weekday: 4, discountTime: "17",
    demandCycle: "normal", manualWeekdayOverride: false,
    manualDiscountTimeOverride: false, globalDiscountAdjustmentPercent: global,
    weather: { hourlyForecasts, afterRainSky: null }, startedAt: at(17).toISOString(),
  };
  const state = createInitialState(session);
  state.session = session;
  state.screen = "rate_display";
  state.currentAreaId = "bento_men";
  state.areaProgressMap.bento_men = {
    ...state.areaProgressMap.bento_men, areaJudge: "normal", areaCount: 10,
    areaRateAdjustment: 0, visitedAt: at(17, 30).toISOString(),
  };
  return state;
}

const hookSource = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
const hookAst = ts.createSourceFile("useNebikiApp.ts", hookSource, ts.ScriptTarget.Latest, true);
function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  const matches: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(hookAst);
  assert.equal(matches.length, 1, "one matching current production hook declaration");
  return matches[0];
}
function execute(source: string, context: Record<string, unknown>): unknown {
  return runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
}
function hookValue<T>(name: string, context: Record<string, unknown>): T {
  const declaration = findNode((node) => ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) && node.name.text === name) as ts.VariableDeclaration;
  assert.ok(declaration.initializer);
  const value = execute(`(${declaration.initializer.getText(hookAst)});`, context) as T;
  context[name] = value;
  return value;
}
function installAction(name: string, context: Record<string, unknown>): void {
  const declaration = findNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  context[name] = execute(`${declaration.getText(hookAst)}\n${name};`, context);
}
function runEarlyTargetEffect(context: Record<string, unknown>): void {
  const call = findNode((node) => ts.isCallExpression(node) &&
    node.expression.getText(hookAst) === "useEffect" &&
    Boolean(node.arguments[0]?.getText(hookAst).includes("progress.earlyNextMinus5TargetDiscountTime"))) as ts.CallExpression;
  execute(`(${call.arguments[0].getText(hookAst)})();`, context);
}

function harness(state = fixture(), now = at(18, 40)) {
  const context: Record<string, unknown> = {
    Date, state, nowMs: now.getTime(), isTestMode: false, applyObonRule: true,
    lastSessionWeather: null, areaJudgeSelection: null, resumeTargetScreen: null,
    screenHistoryRef: { current: [] as NavigationSnapshot[] },
    suppressHistoryPushRef: { current: false }, weatherConfirmationSubmittingRef: { current: false },
    nextSessionSkipRecordsRef: { current: [] as NextSessionSkipRecord[] },
    useMemo: (factory: () => unknown) => factory(),
    getRuntimeNow: () => new Date(context.nowMs as number),
    getHistoricalDailySessionSnapshotsForDate: () => [],
    getEarlyNextMinus5TargetDiscountTime, getWeekdayBaseInfo, getBasisGuideDisplay,
    resolveSessionTemperatureComfort, normalizeDemandCycle, normalizeGlobalDiscountAdjustmentPercent,
    shouldIgnoreNormalTimeRateCap, buildMergedBonusDisplay, buildRateDecisionSnapshot,
    buildCurrentNormalRatePresentation, buildCompletedRateSnapshot, buildNextSessionSkipRecord,
    refreshSessionDiscountTime, getNextNormalFlowAreaId, getNextNormalFlowAreaIdWithWrap,
    getNormalFlowScreenForArea, getNextSkipTargetDiscountTime, getNextPendingCandidate, getPendingResumeScreen,
    createNavigationSnapshot, cloneAppState, cloneLastSessionWeatherRecord, popNavigationHistory,
    window: { confirm: () => { throw new Error("unexpected weather confirmation"); } },
    finalGuide: null, lateTimeBonusNotice: null,
    setState: (update: AppState | ((previous: AppState) => AppState)) => {
      context.state = typeof update === "function" ? update(context.state as AppState) : update;
    },
    setUndoSnapshot: () => {}, setUndoNotice: () => {}, setWeatherConfirmationPending: () => {},
    setAreaJudgeSelection: (value: unknown) => { context.areaJudgeSelection = value; },
    setResumeTargetScreen: (value: ScreenName | null) => { context.resumeTargetScreen = value; },
    setTimeSwitchTarget: () => {},
    setLastSessionWeather: (value: unknown) => { context.lastSessionWeather = value; },
    replaceNextSessionSkipRecords: (records: NextSessionSkipRecord[]) => {
      (context.nextSessionSkipRecordsRef as { current: NextSessionSkipRecord[] }).current = cloneSkipRecords(records);
    },
    appendNextSessionSkipRecords: (records: NextSessionSkipRecord[]) => {
      (context.nextSessionSkipRecordsRef as { current: NextSessionSkipRecord[] }).current.push(...cloneSkipRecords(records));
    },
  };
  for (const name of ["buildNavigationSnapshot", "createUndoSnapshot", "restoreNavigationSnapshot",
    "moveToNextPendingOrDone", "goToNextArea", "goBackOneScreen"]) installAction(name, context);
  function render() {
    const current = context.state as AppState;
    context.sessionSource = current.session ?? current.sessionDraft;
    hookValue("sessionSourceResolvedWeather", context);
    hookValue("weekdayBaseInfo", context);
    const early = hookValue<{ targetDiscountTime: "18" | "19"; weekdayBaseInfo: ReturnType<typeof getWeekdayBaseInfo> } | null>("earlyNextMinus5Info", context);
    hookValue("lateTimeBonus", context);
    hookValue("basisGuide", context);
    hookValue("ignoreNormalTimeRateCap", context);
    const effective = hookValue("effectiveRateDiscountTime", context);
    hookValue("effectiveRateIgnoreTimeRateCap", context);
    hookValue("currentAreaProgress", context);
    const presentation = hookValue<ReturnType<typeof buildCurrentNormalRatePresentation>>("ratePresentation", context);
    context.rateDisplay = presentation?.display ?? null;
    const areaId = current.currentAreaId;
    context.clickedAreaId = areaId;
    context.clickedProgress = areaId ? current.areaProgressMap[areaId] : null;
    context.completedAt = new Date(context.nowMs as number).toISOString();
    const snapshot = hookValue<RateDecisionSnapshot | null>("clickedRateDecisionSnapshot", context);
    runEarlyTargetEffect(context);
    return { early, effective, presentation, snapshot };
  }
  return {
    context, render,
    get state() { return context.state as AppState; },
    get skips() { return (context.nextSessionSkipRecordsRef as { current: NextSessionSkipRecord[] }).current; },
    next: context.goToNextArea as () => void,
    back: context.goBackOneScreen as () => void,
    remember: () => (context.screenHistoryRef as { current: NavigationSnapshot[] }).current.push(
      (context.buildNavigationSnapshot as () => NavigationSnapshot)(),
    ),
  };
}

function assertEarly(decision: ReturnType<ReturnType<typeof harness>["render"]>, label = "") {
  assert.equal(decision.early?.targetDiscountTime, "18", label);
  assert.equal(decision.effective, "18", label);
  assert.ok(decision.snapshot, label);
  assert.equal(decision.snapshot.sessionDiscountTime, "17", label);
  assert.equal(decision.snapshot.effectiveRateDiscountTime, "18", label);
  assert.equal(decision.snapshot.calculationMode, "early_next_minus5", label);
  assert.equal(decision.snapshot.earlyNextAdjustmentPercent, -5, label);
  assert.equal(decision.snapshot.lateTimeAdjustmentPercent, 0, label);
  assert.deepEqual(json(decision.snapshot.display), json(decision.presentation?.display), label);
}

for (const [hour, minute] of [[17, 59], [18, 0], [18, 24], [18, 25], [18, 30], [18, 40], [18, 54]]) {
  test(`actual hook ${hour}:${String(minute).padStart(2, "0")} keeps the correct session/effective time and snapshot`, () => {
    const workflow = harness(fixture(), at(hour, minute));
    const decision = workflow.render();
    assert.equal(workflow.state.session?.discountTime, "17");
    if (hour === 17) {
      assert.equal(decision.early, null);
      assert.equal(decision.effective, "17");
      assert.equal(decision.snapshot?.sessionDiscountTime, "17");
      assert.equal(decision.snapshot?.effectiveRateDiscountTime, "17");
      assert.equal(decision.snapshot?.calculationMode, "normal");
      assert.equal(decision.snapshot?.earlyNextAdjustmentPercent, 0);
    } else {
      assertEarly(decision);
      assert.equal(workflow.state.areaProgressMap.bento_men.earlyNextMinus5TargetDiscountTime, "18");
    }
  });
}

test("17:00 early target has no upper clock bound; actual Review19 flow ends it", () => {
  for (const [hour, minute] of [[18, 55], [19, 25], [23, 59]]) {
    assert.equal(getEarlyNextMinus5TargetDiscountTime({
      discountTime: "17", manualDiscountTimeOverride: false, nowMs: at(hour, minute).getTime(),
    }), "18");
  }
  const before = fixture();
  assert.equal(getAutomaticReview19TransitionKey({ state: before, now: at(18, 54), records: [], isTestMode: false }), null);
  assert.ok(getAutomaticReview19TransitionKey({ state: before, now: at(18, 55), records: [], isTestMode: false }));
  const reviewed = createReview19StartState({ currentState: before, sourceState: before,
    now: at(18, 55), snapshots: [], lastSessionWeather: null });
  assert.equal(reviewed.session?.discountTime, "17");
  for (const screen of ["review19_weather", "review19", "review19_done"] as const) {
    const decision = harness({ ...reviewed, screen }, at(18, 55)).render();
    assert.equal(decision.early, null, screen);
  }
  assertEarly(harness({ ...fixture(), screen: "done" }, at(18, 54)).render());
});

test("explicit 18:30 session ends the 17:00 early rate; the existing 18→19 boundary is unchanged", () => {
  const state = fixture();
  state.session = { ...state.session!, discountTime: "18", startedAt: at(18, 30).toISOString() };
  for (const [hour, minute, target] of [[18, 54, null], [19, 0, "19"], [19, 24, "19"], [19, 25, null]] as const) {
    assert.equal(harness(state, at(hour, minute)).render().early?.targetDiscountTime ?? null, target);
  }
});

test("manual weekday selection is independent; explicit manual time suppression is preserved", () => {
  for (const weekday of [0, 4, 6]) {
    const normal = fixture();
    normal.session = { ...normal.session!, weekday, manualWeekdayOverride: false };
    const override = json(normal);
    override.session!.manualWeekdayOverride = true;
    const first = harness(normal).render();
    const second = harness(override).render();
    assertEarly(first);
    assertEarly(second);
    assert.deepEqual(second.snapshot, first.snapshot);
  }
  const manualTime = fixture();
  manualTime.session!.manualDiscountTimeOverride = true;
  const suppressed = harness(manualTime).render();
  assert.equal(suppressed.early, null);
  assert.equal(suppressed.effective, "17");
  assert.equal(suppressed.snapshot?.calculationMode, "normal");
});

test("target weather and global -5/0/+5 apply exactly once to actual display and snapshot", () => {
  const decisions = ([-5, 0, 5] as const).map((global) => harness(fixture(global)).render());
  for (const decision of decisions) {
    assertEarly(decision);
    const snapshot = decision.snapshot!;
    assert.equal(snapshot.weatherComfortAdjustmentPercent, decision.early!.weekdayBaseInfo.baseRateBonus);
    assert.equal(snapshot.normalRateBeforeLimitsPercent,
      snapshot.basicRatePercent + snapshot.weatherComfortAdjustmentPercent,
      "weather must be added once before limits");
    assert.equal(snapshot.normalRatePercent, snapshot.normalRateAfterBaseLimitsPercent - 5);
    assert.equal(snapshot.displayedNormalRatePercent,
      snapshot.normalRatePercent + snapshot.globalDiscountAdjustmentPercent!,
      "global adjustment must be added once after early offset");
    assert.equal(snapshot.displayedManyRatePercent,
      snapshot.manyRatePercent + snapshot.globalDiscountAdjustmentPercent!);
  }
  assert.equal(decisions[1].snapshot!.displayedNormalRatePercent - decisions[0].snapshot!.displayedNormalRatePercent, 5);
  assert.equal(decisions[2].snapshot!.displayedNormalRatePercent - decisions[1].snapshot!.displayedNormalRatePercent, 5);
});

test("reload, actual next-area action and actual back action keep effective18 after 18:25", () => {
  const workflow = harness(fixture(), at(18, 24));
  assertEarly(workflow.render());
  saveCurrentSession(workflow.state);
  const restored = normalizeLoadedState(loadCurrentSession(), workflow.state.sessionDraft);
  const resumed = harness(restored, at(18, 40));
  assertEarly(resumed.render());
  resumed.remember();
  resumed.next();
  assert.equal(resumed.state.session?.discountTime, "17");
  assert.equal(resumed.state.currentAreaId, "tempura");
  assert.equal(resumed.state.areaProgressMap.bento_men.rateDecisionSnapshot?.effectiveRateDiscountTime, "18");
  resumed.state.areaProgressMap.tempura.areaJudge = "normal";
  resumed.state.areaProgressMap.tempura.areaRateAdjustment = 0;
  resumed.state.screen = "rate_display";
  assertEarly(resumed.render());
  resumed.back();
  assert.equal(resumed.state.currentAreaId, "bento_men");
  assert.equal(resumed.state.screen, "rate_display");
  assertEarly(resumed.render());
  saveCurrentSession(resumed.state);
  assertEarly(harness(normalizeLoadedState(loadCurrentSession(), resumed.state.sessionDraft), at(18, 54)).render());
});

test("actual completion after 18:25 reserves effective18 skip and next18 consumes it", () => {
  const workflow = harness(fixture(), at(18, 40));
  const decision = workflow.render();
  workflow.next();
  const saved = workflow.state.areaProgressMap.bento_men.rateDecisionSnapshot;
  assert.equal(saved?.effectiveRateDiscountTime, "18");
  assert.equal(saved?.sessionDiscountTime, "17");
  assert.equal(saved?.calculationMode, "early_next_minus5");
  assert.deepEqual(saved, decision.snapshot);
  assert.equal(workflow.skips.length, 1);
  assert.equal(workflow.skips[0].targetDiscountTime, "18");
  assert.equal(workflow.skips[0].sourceDiscountTime, "17");
  assert.equal(workflow.skips[0].skipKind, "early_next_minus5");
  const consumed = consumeSkipRecordsInMemory({ currentRecords: workflow.skips, date: DATE, targetDiscountTime: "18" });
  assert.deepEqual(consumed.skippedAreaIds, ["bento_men"]);
  const plan = createTimeSwitchPlan({ previousMap: workflow.state.areaProgressMap,
    skippedRecords: consumed.skippedRecords, targetDiscountTime: "18", date: DATE });
  assert.equal(plan.areaProgressMap.bento_men.autoSkipKind, "early_next_minus5");
  assert.equal(plan.areaProgressMap.bento_men.status, "auto_skipped_late_time");
});

test("completed before18 snapshot is unchanged while later areas, daily save and reload use effective18", () => {
  const workflow = harness(fixture(), at(17, 59));
  workflow.render();
  workflow.next();
  const old = json(workflow.state.areaProgressMap.bento_men.rateDecisionSnapshot!);
  assert.equal(old.effectiveRateDiscountTime, "17");
  assert.equal(old.calculationMode, "normal");
  workflow.context.nowMs = at(18, 40).getTime();
  workflow.state.screen = "rate_display";
  workflow.state.areaProgressMap.tempura.areaJudge = "normal";
  workflow.state.areaProgressMap.tempura.areaRateAdjustment = 0;
  assertEarly(workflow.render());
  workflow.next();
  assert.deepEqual(workflow.state.areaProgressMap.bento_men.rateDecisionSnapshot, old);
  assert.equal(workflow.state.areaProgressMap.tempura.rateDecisionSnapshot?.effectiveRateDiscountTime, "18");
  saveCurrentSession(workflow.state);
  const restored = normalizeLoadedState(loadCurrentSession(), workflow.state.sessionDraft);
  assert.deepEqual(restored.areaProgressMap.bento_men.rateDecisionSnapshot, old);
  assert.deepEqual(normalizeRateDecisionSnapshot(json(old)), old);
  const resolvedWeather = workflow.context.sessionSourceResolvedWeather as ReturnType<typeof resolveSessionTemperatureComfort>["resolvedWeather"];
  const daily = createDailySessionSnapshot({ capturedAt: at(18, 54).toISOString(), state: restored,
    resolvedWeather, weekdayBaseInfo: workflow.context.weekdayBaseInfo as ReturnType<typeof getWeekdayBaseInfo>,
    basisGuide: workflow.context.basisGuide as ReturnType<typeof getBasisGuideDisplay>,
    lateTimeBonus: 0, doneSummaryItems: [],
  });
  assert.ok(daily);
  saveDailySessionSnapshots([daily]);
  const savedDaily = loadDailySessionSnapshots()[0];
  assert.equal(savedDaily.session.discountTime, "17");
  assert.deepEqual(savedDaily.areas.bento_men.rateDecisionSnapshot, old);
  assert.equal(savedDaily.areas.tempura.rateDecisionSnapshot?.effectiveRateDiscountTime, "18");
});

let passed = 0;
for (const entry of tests) {
  entry.run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")}: ${entry.name}`);
}
assert.equal(formatLocalDate(at(18, 40)), DATE);
console.log(`Early-next 17 continuity checks passed: ${passed}/${tests.length}`);
