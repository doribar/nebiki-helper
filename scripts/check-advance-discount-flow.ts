import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { normalizeDemandCycle } from "../src/domain/demandCycle.ts";
import { lockDemandCycleForDate } from "../src/domain/demandCycleStorage.ts";
import { normalizeGlobalDiscountAdjustmentPercent } from "../src/domain/globalDiscountAdjustment.ts";
import { cloneHourlyForecasts, createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { appendNavigationHistory, cloneAppState, cloneSkipRecords, createNavigationSnapshot } from "../src/domain/navigationHistory.ts";
import type { NavigationSnapshot } from "../src/domain/navigationHistory.ts";
import { supportsObonCalendarRule } from "../src/domain/obon.ts";
import {
  consumeSkipRecordsInMemory, loadCurrentSession, loadDailySessionSnapshots,
  loadPersistedNebikiStateForDate, loadRuntimeState, loadWorkSessionCheckpoint,
  normalizeDailyMessageState, saveCurrentSession, savePersistedNebikiStateWithAuxiliaryRecovery,
  saveRuntimeStateSafely, saveWorkSessionCheckpointSafely, STORAGE_KEYS,
  upsertDailySessionSnapshotSafely,
} from "../src/domain/storage.ts";
import type { AppState, DailySessionSnapshot, DemandCycle, DiscountTime, NextSessionSkipRecord, ScreenName, SessionDraft } from "../src/domain/types.ts";
import { matchesWeatherConfirmationDraft } from "../src/domain/weatherConfirmation.ts";
import type { WeatherConfirmationPending } from "../src/domain/weatherConfirmation.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { isAutoSkipNoticePending } from "../src/hooks/nebikiApp/autoSkipFlow.ts";
import { buildTimeSwitchNotice, formatLocalDate } from "../src/hooks/nebikiApp/clock.ts";
import { getFirstNormalFlowAreaId, getNormalFlowScreenForArea } from "../src/hooks/nebikiApp/normalFlow.ts";
import { createDailySessionSnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import {
  buildStartDefaultDraft, clonePersistedNebikiStateSnapshot, createInitialAreaProgressMap,
  createInitialState, isValidDiscountTime, normalizeLoadedState,
  normalizeReview19ExcludedAreaIds, normalizeSessionDraft, syncAfterRainSelection,
} from "../src/hooks/nebikiApp/stateNormalization.ts";
import { resolveSessionTemperatureComfort } from "../src/hooks/nebikiApp/temperatureComfortState.ts";
import { createAreaProgressMapWithAutoSkippedAreas, createTimeSwitchPlan, getFirstAvailableAreaId } from "../src/hooks/nebikiApp/timeTransitions.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";

// These are local, in-memory fixtures. No browser, network, or production store is used.
class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
const memory = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
const today = new Date();
const DATE = formatLocalDate(today);
const at = (hour: number, minute = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute);
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const tests: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void) => tests.push({ name, run });

function fresh(time: DiscountTime = "15", cycle: DemandCycle = "normal"): AppState {
  const draft: SessionDraft = {
    date: DATE, weekday: 1, discountTime: time, demandCycle: cycle,
    manualWeekdayOverride: true, manualDiscountTimeOverride: false,
    weatherInputLockedDiscountTime: time,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
  draft.weather.hourlyForecasts["18"] = { weather: "rain", tempC: 24, windMs: 2 };
  return createInitialState(draft);
}

// Like the existing Review19 workflow harness, execute actual hook declarations.
// Only React setters and external boundaries are controlled; session planning,
// weather, navigation and persistence all use the production implementations.
const hookSource = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
const hookAst = ts.createSourceFile("useNebikiApp.ts", hookSource, ts.ScriptTarget.Latest, true);
function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(hookAst);
  assert.ok(found, "production declaration exists");
  return found;
}
function execute(expression: string, context: Record<string, unknown>): unknown {
  return runInNewContext(ts.transpileModule(expression, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
}
function installAction(name: string, context: Record<string, unknown>): void {
  const declaration = findNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  context[name] = execute(`${declaration.getText(hookAst)}\n${name};`, context);
}
function runEffect(marker: string, context: Record<string, unknown>): void {
  const call = findNode((node) => ts.isCallExpression(node) &&
    node.expression.getText(hookAst) === "useEffect" &&
    node.arguments[0]?.getText(hookAst).includes(marker)) as ts.CallExpression;
  execute(`(${call.arguments[0].getText(hookAst)})();`, context);
}

function harness(options: { state?: AppState; now?: Date; fixed?: boolean; resume?: ScreenName | null } = {}) {
  const initial = options.state ?? fresh();
  const snapshots: DailySessionSnapshot[] = [];
  const changed: AppState[] = [];
  const context: Record<string, unknown> = {
    Date, state: initial, isTestMode: options.fixed ?? false,
    activeDemandCycle: initial.sessionDraft.demandCycle,
    globalDiscountAdjustmentPercent: 5,
    demandCycleState: { selectedCycle: initial.sessionDraft.demandCycle, lockedDate: null, lockedCycle: null },
    resumeTargetScreen: options.resume ?? null, timeSwitchTarget: null,
    weatherConfirmationPending: null, weatherConfirmationSubmittingRef: { current: false },
    suppressHistoryPushRef: { current: false }, screenHistoryRef: { current: [] as NavigationSnapshot[] },
    previousRenderRef: { current: null }, nextSessionSkipRecordsRef: { current: [] as NextSessionSkipRecord[] },
    nextSessionSkipRecords: [], lastSessionWeather: null, lastUsedSessionDraft: initial.sessionDraft,
    dailyMessageState: normalizeDailyMessageState(null), areaJudgeSelection: null, undoSnapshot: null,
    getRuntimeNow: () => options.now ?? at(Number(initial.sessionDraft.discountTime)),
    NORMAL_ROUTE, formatLocalDate, cloneHourlyForecasts, cloneSkipRecords,
    getCurrentDataVersionInfo, normalizeDemandCycle, normalizeGlobalDiscountAdjustmentPercent,
    supportsObonCalendarRule, lockDemandCycleForDate, resolveSessionTemperatureComfort,
    consumeSkipRecordsInMemory, createTimeSwitchPlan, createInitialAreaProgressMap,
    createAreaProgressMapWithAutoSkippedAreas, getFirstNormalFlowAreaId, getNormalFlowScreenForArea,
    getFirstAvailableAreaId, isAutoSkipNoticePending, isValidDiscountTime,
    normalizeReview19ExcludedAreaIds, buildTimeSwitchNotice, buildStartDefaultDraft,
    normalizeSessionDraft, syncAfterRainSelection, createInitialState,
    matchesWeatherConfirmationDraft, createDailySessionSnapshot, getBasisGuideDisplay, getWeekdayBaseInfo,
    cloneAppState, createNavigationSnapshot, appendNavigationHistory,
    clonePersistedNebikiStateSnapshot, savePersistedNebikiStateWithAuxiliaryRecovery,
    saveWorkSessionCheckpointSafely, saveRuntimeStateSafely,
    getHistoricalDailySessionSnapshotsForDate: () => snapshots,
    upsertDailySessionSnapshotSafely: (snapshot: DailySessionSnapshot) => {
      snapshots.push(json(snapshot));
      return upsertDailySessionSnapshotSafely(snapshot, { protectedDate: DATE });
    },
    reportStorageOperationFailures: () => {}, persistDemandCycleStateSafely: () => true,
    setDemandCycleState: (value: unknown) => { context.demandCycleState = value; },
    setLastUsedSessionDraft: (update: (draft: SessionDraft) => SessionDraft) => {
      context.lastUsedSessionDraft = update(context.lastUsedSessionDraft as SessionDraft);
    },
    setState: (next: AppState | ((prev: AppState) => AppState)) => {
      const previous = context.state as AppState;
      const updated = typeof next === "function" ? next(previous) : next;
      if (updated !== previous) changed.push(updated);
      context.state = updated;
    },
    replaceNextSessionSkipRecords: (records: NextSessionSkipRecord[]) => {
      context.nextSessionSkipRecords = records;
      (context.nextSessionSkipRecordsRef as { current: NextSessionSkipRecord[] }).current = records;
    },
    setResumeTargetScreen: (value: ScreenName | null) => { context.resumeTargetScreen = value; },
    setTimeSwitchTarget: (value: DiscountTime | null) => { context.timeSwitchTarget = value; },
    setWeatherConfirmationPending: (value: WeatherConfirmationPending | null) => { context.weatherConfirmationPending = value; },
    setUndoSnapshot: () => {}, setUndoNotice: () => {}, setAreaJudgeSelection: () => {},
    window: { alert: (message: string) => { throw new Error(message); } },
  };
  for (const action of ["buildNavigationSnapshot", "buildDraftFromSource", "resolveResumeState", "startSession", "requestWeatherConfirmation",
    "confirmWeatherInput", "continueAfterAdvanceDiscount", "startEditingConditions", "openNextSessionInput"]) {
    installAction(action, context);
  }
  return {
    context, changed, snapshots,
    get state() { return context.state as AppState; },
    start: context.startSession as () => void,
    request: context.requestWeatherConfirmation as () => void,
    confirm: context.confirmWeatherInput as () => void,
    proceed: context.continueAfterAdvanceDiscount as () => void,
    edit: context.startEditingConditions as () => void,
    openNext: context.openNextSessionInput as (time: DiscountTime, options: { preserveCurrentSession: boolean; lockDiscountTime: boolean }) => boolean,
    navigate: () => runEffect("const historyResult = appendNavigationHistory", context),
    persist: () => {
      runEffect("app-state-effect", context);
      runEffect("runtime-state-effect", context);
      // The existing completion effect must not invent completed 15/17 snapshots.
      runEffect("daily-session-completion", context);
    },
  };
}

function assertUnmeasured(state: AppState): void {
  assert.equal(Object.keys(state.areaProgressMap).length, NORMAL_ROUTE.length);
  for (const area of Object.values(state.areaProgressMap)) {
    assert.equal(area.status, "unstarted");
    assert.equal(area.areaJudge, null);
    for (const key of ["areaCount", "areaCountEvaluation", "humanEvaluationDetails", "areaCountDecisionBasis",
      "completedAt", "completedRateText", "rateDecisionSnapshot", "visitedAt"]) {
      assert.equal(area[key as keyof typeof area], undefined, `no fabricated ${key}`);
    }
  }
}
function restoredHook(verify: (app: ReturnType<typeof useNebikiApp>) => void): void {
  function Probe() {
    verify(useNebikiApp());
    return createElement("span", null, "restored");
  }
  assert.equal(renderToString(createElement(Probe)), "<span>restored</span>");
}

for (const time of ["15", "17"] as const) {
  for (const cycle of ["normal", "summer"] as const) {
    test(`${time}/${cycle}: confirmation waits for both explicit actions and preserves unmeasured work`, () => {
      const h = harness({ state: fresh(time, cycle) });
      h.confirm();
      assert.equal(h.state.session, null);
      h.request();
      assert.equal(h.state.screen, "start");
      assert.equal(h.state.session, null);
      h.confirm();
      assert.equal(h.state.screen, "advance_discount");
      assert.equal(h.state.session?.discountTime, time);
      assert.equal(h.state.session?.demandCycle, cycle);
      assertUnmeasured(h.state);
      const pending = h.state;
      h.confirm();
      assert.equal(h.state, pending, "repeat weather confirm cannot restart the session");
      h.persist();
      assert.equal(h.state, pending, "effects do not bypass the instruction");
      assert.equal(h.snapshots.length, 0);
      const expectedKeys = new Set([
        STORAGE_KEYS.currentSession, STORAGE_KEYS.workSessionCheckpoint, STORAGE_KEYS.runtimeState,
        STORAGE_KEYS.nextSessionSkipRecords, STORAGE_KEYS.lastUsedSessionDraft, STORAGE_KEYS.dailyMessageState,
      ]);
      assert.ok([...memory.values.keys()].every((key) => expectedKeys.has(key)), "no AreaCount, Review19, finalized or learning record writes");
      const session = h.state.session;
      const map = h.state.areaProgressMap;
      h.proceed();
      assert.equal(h.state.screen, "area_judge");
      assert.equal(h.state.currentAreaId, NORMAL_ROUTE[0]);
      assert.equal(h.state.session, session);
      assert.equal(h.state.areaProgressMap, map);
      assert.deepEqual(json({ ...h.state, screen: pending.screen }), json(pending));
      assertUnmeasured(h.state);
      const after = h.state;
      h.proceed();
      assert.equal(h.state, after, "repeat continue is a no-op");
      assert.equal(h.changed.length, 2);
    });
  }
  test(`${time}: current/checkpoint and actual hook reload retain pending then completed instruction`, () => {
    const h = harness({ state: fresh(time) });
    h.start();
    for (const pending of [true, false]) {
      if (!pending) h.proceed();
      h.persist();
      const expected = pending ? "advance_discount" : "area_judge";
      assert.equal(loadCurrentSession()?.screen, expected);
      assert.equal(loadWorkSessionCheckpoint()?.screen, expected);
      assert.deepEqual(json(loadCurrentSession()?.areaProgressMap), json(h.state.areaProgressMap));
      assert.deepEqual(json(loadWorkSessionCheckpoint()?.session), json(h.state.session));
      assert.equal(loadDailySessionSnapshots().length, 0, "no fake completion snapshot");
      restoredHook((app) => {
        assert.equal(app.state.screen, expected);
        assert.equal(Boolean(app.derived.advanceDiscountInstruction), pending);
        assert.deepEqual(json(app.state.areaProgressMap), json(normalizeLoadedState(h.state, h.state.sessionDraft).areaProgressMap));
      });
      // Recover through the real startup checkpoint selection after a start/reset crash.
      saveCurrentSession(fresh(time));
      restoredHook((fromCheckpoint) => {
        assert.equal(fromCheckpoint.state.screen, expected);
        assert.equal(fromCheckpoint.state.session?.startedAt, h.state.session?.startedAt);
        assert.equal(Boolean(fromCheckpoint.derived.advanceDiscountInstruction), pending);
      });
    }
  });
  test(`${time}: pending condition edit/reload resumes instruction, later edit keeps normal work`, () => {
    let h = harness({ state: fresh(time) });
    h.start();
    const startedAt = h.state.session?.startedAt;
    h.edit();
    h.persist();
    assert.equal(loadRuntimeState()?.resumeTargetScreen, "advance_discount");
    restoredHook((app) => assert.equal(app.state.screen, "start"));
    const loaded = loadPersistedNebikiStateForDate(DATE);
    assert.ok(loaded.currentSession);
    h = harness({ state: normalizeLoadedState(loaded.currentSession, loaded.currentSession.sessionDraft), resume: loaded.runtimeState?.resumeTargetScreen });
    h.state.sessionDraft.weather.hourlyForecasts["18"].tempC = 28;
    h.request(); h.confirm();
    assert.equal(h.state.screen, "advance_discount");
    assert.equal(h.state.session?.startedAt, startedAt);
    assert.equal(h.state.session?.weather.hourlyForecasts["18"].tempC, 28);
    h.proceed();
    const map = h.state.areaProgressMap;
    h.edit(); h.request(); h.confirm();
    assert.equal(h.state.screen, "area_judge");
    assert.equal(h.state.areaProgressMap, map);
    assert.equal(h.state.session?.startedAt, startedAt);
  });
  for (const screen of ["rate_display", "done"] as const) {
    test(`${time}/${screen}: legacy started session resumes adopted work without a new instruction`, () => {
      const h = harness({ state: fresh(time) });
      h.start(); h.proceed();
      const area = h.state.areaProgressMap[NORMAL_ROUTE[0]];
      area.areaJudge = "normal";
      area.areaCount = 19;
      area.areaCountEvaluation = "slightly_many";
      if (screen === "done") h.state.currentAreaId = null;
      h.state.screen = screen;
      const map = h.state.areaProgressMap;
      const startedAt = h.state.session?.startedAt;
      h.edit(); h.request(); h.confirm();
      assert.equal(h.state.screen, screen);
      assert.equal(h.state.areaProgressMap, map);
      assert.equal(h.state.session?.startedAt, startedAt);
      assert.equal(h.state.areaProgressMap[NORMAL_ROUTE[0]].areaCount, 19);
      assert.equal(h.state.areaProgressMap[NORMAL_ROUTE[0]].areaCountEvaluation, "slightly_many");
    });
  }
}

for (const time of ["18", "19", "20"] as const) {
  test(`${time}: normal start bypasses advance instruction`, () => {
    const h = harness({ state: fresh(time) });
    h.request(); h.confirm();
    assert.equal(h.state.screen, "area_judge");
    const before = h.state;
    h.proceed();
    assert.equal(h.state, before);
    assertUnmeasured(h.state);
  });
}
for (const time of ["15", "17", "18", "19", "20"] as const) {
  test(`${time}: fixed-time start and effects leave production storage untouched`, () => {
    memory.setItem(STORAGE_KEYS.currentSession, "sentinel-current");
    memory.setItem(STORAGE_KEYS.workSessionCheckpoint, "sentinel-checkpoint");
    const before = [...memory.values];
    const h = harness({ state: fresh(time), fixed: true });
    h.request(); h.confirm(); h.proceed(); h.persist();
    assert.equal(h.state.screen, "area_judge");
    assert.deepEqual([...memory.values], before);
    assert.equal(h.snapshots.length, 0);
  });
}

test("continue uses the existing current area/normal-flow helper and skips the instruction in navigation history", () => {
  const h = harness(); h.start();
  const pending = h.state;
  pending.currentAreaId = NORMAL_ROUTE[4];
  const snapshot = createNavigationSnapshot({ state: pending, areaJudgeSelection: null, resumeTargetScreen: null, nextSessionSkipRecords: [], lastSessionWeather: null });
  h.proceed();
  assert.equal(h.state.currentAreaId, NORMAL_ROUTE[4]);
  const navigation = appendNavigationHistory({ history: [], previousSnapshot: snapshot, nextState: h.state,
    suppressHistoryPush: (h.context.suppressHistoryPushRef as { current: boolean }).current });
  assert.deepEqual(navigation.history, []);
  assert.equal(navigation.suppressHistoryPush, false);
  assert.deepEqual(json({ ...h.state, screen: pending.screen }), json(pending));
});

test("continue falls back to first remaining area or done without changing the map", () => {
  for (const allComplete of [false, true]) {
    const h = harness(); h.start();
    h.state.currentAreaId = null;
    for (const [index, areaId] of NORMAL_ROUTE.entries()) {
      if (allComplete || index < 3) h.state.areaProgressMap[areaId].status = "completed";
    }
    const map = h.state.areaProgressMap;
    h.proceed();
    assert.equal(h.state.currentAreaId, allComplete ? null : NORMAL_ROUTE[3]);
    assert.equal(h.state.screen, allComplete ? "done" : "area_judge");
    assert.equal(h.state.areaProgressMap, map);
  }
});

test("condition-edit navigation cannot return to completed instruction and preserves other-session history", () => {
  const h = harness(); h.navigate(); h.start(); h.navigate();
  h.edit(); h.navigate(); h.request(); h.confirm(); h.navigate();
  const history = h.context.screenHistoryRef as { current: NavigationSnapshot[] };
  assert.ok(history.current.some((item) => item.state.screen === "advance_discount"));
  assert.ok(history.current.some((item) => item.resumeTargetScreen === "advance_discount"));
  const otherSession = createNavigationSnapshot({ state: h.state, areaJudgeSelection: null,
    resumeTargetScreen: "advance_discount", nextSessionSkipRecords: [], lastSessionWeather: null });
  const anotherStart = json(otherSession);
  anotherStart.state.session!.startedAt = at(14).toISOString();
  const anotherTime = json(otherSession);
  anotherTime.state.session!.discountTime = "17";
  const anotherDate = json(otherSession);
  anotherDate.state.session!.date = "2000-01-01";
  const normalWork = json(otherSession);
  normalWork.state.screen = "area_judge";
  normalWork.resumeTargetScreen = null;
  const preserved = [anotherStart, anotherTime, anotherDate, normalWork];
  const initialStart = json(history.current.filter((item) => item.state.session === null));
  history.current.unshift(...preserved);
  const expectedHistory = [...preserved, ...initialStart];
  const stateBefore = h.state;
  h.proceed(); h.navigate(); h.persist();
  assert.deepEqual(json(history.current), expectedHistory);
  assert.deepEqual(json(loadRuntimeState()?.screenHistory), expectedHistory);
  assert.deepEqual(json({ ...h.state, screen: stateBefore.screen }), json(stateBefore));
});

test("15 to 17 starts the instruction after the existing time-switch plan and preserves prior snapshots", () => {
  const initial = harness(); initial.start(); initial.proceed();
  initial.state.areaProgressMap[NORMAL_ROUTE[0]] = { ...initial.state.areaProgressMap[NORMAL_ROUTE[0]], status: "completed", areaJudge: "normal", areaCount: 32 };
  initial.state.areaProgressMap[NORMAL_ROUTE[1]].areaJudge = "few";
  const source = json(initial.state);
  const resolvedWeather = resolveWeatherInputForDiscount(source.session!.weather, "15");
  const snapshot = createDailySessionSnapshot({ capturedAt: at(16, 40).toISOString(), state: source, resolvedWeather,
    weekdayBaseInfo: getWeekdayBaseInfo(source.session!.weekday, "15", resolvedWeather, DATE),
    basisGuide: getBasisGuideDisplay({ date: DATE, weekday: source.session!.weekday, discountTime: "15", demandCycle: "normal", weather: resolvedWeather }),
    lateTimeBonus: 0, doneSummaryItems: [] });
  assert.ok(snapshot);
  assert.equal(upsertDailySessionSnapshotSafely(snapshot, { protectedDate: DATE }).ok, true);
  const storedBefore = memory.getItem(STORAGE_KEYS.dailySessionSnapshots);
  const h = harness({ state: source, now: at(17) });
  assert.equal(h.openNext("17", { preserveCurrentSession: true, lockDiscountTime: true }), true);
  assert.equal(h.state.session?.discountTime, "15");
  h.request(); h.confirm();
  assert.equal(h.state.screen, "advance_discount");
  assert.equal(h.state.session?.discountTime, "17");
  assert.equal(h.state.session?.startedAt, at(17).toISOString());
  const plan = createTimeSwitchPlan({ previousMap: source.areaProgressMap, skippedRecords: [], targetDiscountTime: "17", completedAt: at(17).toISOString() });
  assert.deepEqual(json(h.state.areaProgressMap), json(plan.areaProgressMap));
  assert.deepEqual(json(h.state.normalFlowOrder), json(plan.normalFlowOrder));
  assert.ok(h.state.review19ExcludedAreaIds.includes(NORMAL_ROUTE[1]));
  h.persist(); h.proceed(); h.persist();
  assert.equal(memory.getItem(STORAGE_KEYS.dailySessionSnapshots), storedBefore);
  assert.equal(loadDailySessionSnapshots()[0].areas[NORMAL_ROUTE[0]].areaCount, 32);
  assert.equal(source.areaProgressMap[NORMAL_ROUTE[0]].areaCount, 32);
});

for (const screen of ["review19_weather", "review19", "review19_done", "done", "rate_display", "start"] as const) {
  test(`${screen}: unrelated continue callback cannot change state or history`, () => {
    const h = harness(); h.start();
    h.state.screen = screen;
    const before = h.state;
    h.proceed();
    assert.equal(h.state, before);
    assert.equal((h.context.suppressHistoryPushRef as { current: boolean }).current, false);
  });
}

let passed = 0;
for (const { name, run } of tests) {
  memory.clear();
  try { run(); passed += 1; console.log(`PASS: ${name}`); }
  catch (error) { console.error(`FAIL: ${name}`); throw error; }
}
console.log(`Advance discount flow: ${passed}/${tests.length} PASS`);
