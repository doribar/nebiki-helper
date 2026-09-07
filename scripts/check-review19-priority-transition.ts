import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  createDefaultHourlyForecasts,
  cloneHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import { createInitialReview19Result } from "../src/domain/review19.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { normalizeDemandCycle } from "../src/domain/demandCycle.ts";
import { lockDemandCycleForDate } from "../src/domain/demandCycleStorage.ts";
import { cloneSkipRecords } from "../src/domain/navigationHistory.ts";
import { normalizeGlobalDiscountAdjustmentPercent } from "../src/domain/globalDiscountAdjustment.ts";
import { supportsObonCalendarRule } from "../src/domain/obon.ts";
import {
  consumeSkipRecordsInMemory,
  loadDailySessionSnapshots,
  upsertDailySessionSnapshotSafely,
} from "../src/domain/storage.ts";
import { getHistoricalDailySessionSnapshotsForDate } from "../src/domain/historicalArchiveRuntime.ts";
import type {
  AppState,
  DailySessionSnapshot,
  DemandCycle,
  DiscountTime,
  Review19Result,
  SessionDraft,
} from "../src/domain/types.ts";
import {
  canStartReview19FromCurrentState,
  formatLocalDate,
  getNextDoneDiscountInfo,
  buildTimeSwitchNotice,
} from "../src/hooks/nebikiApp/clock.ts";
import {
  createReview19StartState,
  getAutomaticReview19TransitionKey,
  hasStarted1830Session,
  selectReview19SourceState,
} from "../src/hooks/nebikiApp/review19Flow.ts";
import {
  createDailySessionSnapshot,
  createReview19DaySnapshot,
} from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import {
  createInitialState,
  createInitialAreaProgressMap,
  buildStartDefaultDraft,
  isValidDiscountTime,
  normalizeLoadedState,
  normalizeReview19ExcludedAreaIds,
} from "../src/hooks/nebikiApp/stateNormalization.ts";
import {
  buildAutoTimeSwitchDialogText,
  createAreaProgressMapWithAutoSkippedAreas,
  createTimeSwitchPlan,
  finalizeUnmeasuredAreasForAutoTransition,
  shouldPrioritizeUnfinishedAreasOnAutoTransition,
} from "../src/hooks/nebikiApp/timeTransitions.ts";
import {
  getFirstNormalFlowAreaId,
  getNormalFlowScreenForArea,
} from "../src/hooks/nebikiApp/normalFlow.ts";
import { resolveSessionTemperatureComfort } from "../src/hooks/nebikiApp/temperatureComfortState.ts";

const DATE = "2026-09-05";
// Local calendar construction matches the production clock on every test host.
const at = (hour: number, minute: number, second = 0) =>
  new Date(2026, 8, 5, hour, minute, second);
const STARTED_AT = at(17, 0).toISOString();
const tests: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void) => tests.push({ name, run });

function fixture(
  discountTime: DiscountTime = "17",
  screen: AppState["screen"] = "done",
  demandCycle: DemandCycle = "normal",
): AppState {
  const draft: SessionDraft = {
    date: DATE,
    weekday: 6,
    discountTime,
    demandCycle,
    manualWeekdayOverride: true,
    manualDiscountTimeOverride: false,
    weather: {
      hourlyForecasts: createDefaultHourlyForecasts(),
      afterRainSky: null,
    },
  };
  draft.weather.hourlyForecasts["19"] = {
    weather: "rain",
    tempC: 24,
    windMs: 3,
  };
  const state = createInitialState(draft);
  state.screen = screen;
  state.session = {
    ...draft,
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-19",
    buildId: "baseline-fixture",
    startedAt: STARTED_AT,
    globalDiscountAdjustmentPercent: 5,
  };
  return state;
}

function reviewRecord(recorded = false, date = DATE): Review19Result {
  const record = createInitialReview19Result({
    date,
    demandCycle: "normal",
    sessionStartedAt: STARTED_AT,
    reviewStartedAt: at(19, 0).toISOString(),
    excludedAreaIds: [],
  });
  if (recorded) record.recordedAt = at(19, 15).toISOString();
  return record;
}

function snapshotInputs(state: AppState) {
  assert.ok(state.session);
  const resolvedWeather = resolveWeatherInputForDiscount(
    state.session.weather,
    state.session.discountTime,
  );
  return {
    resolvedWeather,
    weekdayBaseInfo: getWeekdayBaseInfo(
      state.session.weekday,
      state.session.discountTime,
      resolvedWeather,
      state.session.date,
    ),
    basisGuide: getBasisGuideDisplay({
      date: state.session.date,
      weekday: state.session.weekday,
      discountTime: state.session.discountTime,
      demandCycle: state.session.demandCycle,
      weather: resolvedWeather,
    }),
    lateTimeBonus: 0,
    doneSummaryItems: [],
  };
}

for (const [hour, minute, expectedCanStart] of [
  [18, 24, false],
  [18, 25, true],
  [18, 54, true],
] as const) {
  test(`${hour}:${minute}: existing 18:30 eligibility and no Review19 priority`, () => {
    const state = fixture();
    const next = getNextDoneDiscountInfo("17", at(hour, minute));
    assert.equal(next?.canStart, expectedCanStart);
    assert.equal(next?.targetDiscountTime, "18");
    assert.equal(getAutomaticReview19TransitionKey({ state, now: at(hour, minute) }), null);
  });
}

for (const [hour, minute] of [[18, 55], [19, 0], [19, 25], [20, 30], [23, 59]]) {
  test(`${hour}:${minute}: same-day 17 source has Review19 priority without an upper cutoff`, () => {
    const state = fixture();
    const key = getAutomaticReview19TransitionKey({ state, now: at(hour, minute) });
    assert.equal(typeof key, "string");
    assert.ok(key?.includes(STARTED_AT));
    assert.ok(key?.includes(DATE));
    const next = createReview19StartState({
      currentState: state,
      sourceState: state,
      now: at(hour, minute),
      snapshots: [],
      lastSessionWeather: null,
    });
    assert.equal(next.screen, "review19");
    assert.equal(next.session?.discountTime, "17");
    assert.equal(next.review19?.sessionStartedAt, STARTED_AT);
  });
}

test("18:54:59 stays below the Review19 boundary", () => {
  assert.equal(getAutomaticReview19TransitionKey({ state: fixture(), now: at(18, 54, 59) }), null);
});

for (const discountTime of ["15", "18", "19", "20"] as const) {
  test(`${discountTime} session is not eligible for the new Review19 route`, () => {
    assert.equal(getAutomaticReview19TransitionKey({
      state: fixture(discountTime),
      now: at(20, 30),
    }), null);
  });
}

for (const screen of ["start", "review19_weather", "review19", "review19_done"] as const) {
  test(`${screen} screen is not interrupted`, () => {
    assert.equal(getAutomaticReview19TransitionKey({
      state: fixture("17", screen),
      now: at(18, 55),
    }), null);
  });
}

for (const screen of ["done", "area_judge", "rate_display", "auto_skip_notice", "auto_skip_count"] as const) {
  test(`${screen} with a current 17 source can prioritize Review19`, () => {
    assert.ok(getAutomaticReview19TransitionKey({
      state: fixture("17", screen),
      now: at(18, 55),
    }));
  });
}

test("missing or previous-day session does not start Review19", () => {
  const missing = fixture();
  missing.session = null;
  assert.equal(getAutomaticReview19TransitionKey({ state: missing, now: at(18, 55) }), null);
  const yesterday = fixture();
  yesterday.session!.date = "2026-09-04";
  assert.equal(getAutomaticReview19TransitionKey({ state: yesterday, now: at(18, 55) }), null);
  assert.equal(getAutomaticReview19TransitionKey({
    state: fixture(),
    now: new Date(2026, 8, 6, 19, 0),
  }), null);
});

test("already offered 18:30 input suppresses priority even if preserved session still says 17", () => {
  assert.equal(getAutomaticReview19TransitionKey({
    state: fixture("17", "area_judge"),
    now: at(18, 55),
    hasTransitionedTo1830: true,
  }), null);
});

test("same-day pending or completed Review19 state prevents duplicate start", () => {
  for (const recorded of [false, true]) {
    const state = fixture();
    state.review19 = reviewRecord(recorded);
    assert.equal(getAutomaticReview19TransitionKey({ state, now: at(18, 55) }), null);
  }
});

test("archived same-day completion blocks; old-day and unrecorded history keep existing guard semantics", () => {
  const state = fixture();
  assert.equal(getAutomaticReview19TransitionKey({
    state,
    now: at(18, 55),
    records: [reviewRecord(true)],
  }), null);
  assert.ok(getAutomaticReview19TransitionKey({
    state,
    now: at(18, 55),
    records: [reviewRecord(true, "2026-09-04"), reviewRecord(false)],
  }));
});

test("fixed-time gets no new automatic Review19 route", () => {
  assert.equal(getAutomaticReview19TransitionKey({
    state: fixture(),
    now: at(18, 55),
    isTestMode: true,
  }), null);
});

test("manual discount override meaning is not changed by the new automatic selector", () => {
  const state = fixture();
  state.session!.manualDiscountTimeOverride = true;
  assert.ok(getAutomaticReview19TransitionKey({ state, now: at(18, 55) }));
});

for (const demandCycle of ["normal", "summer"] as const) {
  test(`${demandCycle}: shared Review19 builder preserves 17 identity, reference inputs, and weather`, () => {
    const source = fixture("17", "done", demandCycle);
    source.review19ExcludedAreaIds = ["tempura"];
    const before = JSON.stringify(source);
    const next = createReview19StartState({
      currentState: source,
      sourceState: source,
      now: at(18, 55),
      snapshots: [],
      lastSessionWeather: null,
    });
    assert.equal(JSON.stringify(source), before);
    assert.equal(next.session?.discountTime, "17");
    assert.equal(next.session?.startedAt, STARTED_AT);
    assert.equal(next.session?.globalDiscountAdjustmentPercent, 5);
    assert.equal(next.review19?.date, DATE);
    assert.equal(next.review19?.demandCycle, demandCycle);
    assert.equal(next.review19?.sessionStartedAt, STARTED_AT);
    assert.equal(next.review19?.reviewStartedAt, at(18, 55).toISOString());
    assert.equal(next.review19?.recordedAt, undefined);
    assert.equal(next.review19?.reference?.date, DATE);
    assert.equal(next.review19?.reference?.weekday, 6);
    assert.equal(next.review19?.reference?.discountTime, "19");
    assert.equal(next.review19?.reference?.demandCycle, demandCycle);
    assert.deepEqual(next.review19?.reference?.weather, source.session!.weather);
    assert.deepEqual(next.review19ExcludedAreaIds, ["tempura"]);
    assert.deepEqual(next.areaProgressMap, source.areaProgressMap);
    assert.equal(next.sessionDraft.discountTime, "19");
    assert.equal(next.sessionDraft.manualWeekdayOverride, true);
    assert.equal(next.sessionDraft.manualDiscountTimeOverride, false);
    assert.notEqual(next.sessionDraft.weather.hourlyForecasts, source.session!.weather.hourlyForecasts);
    assert.ok(Object.values(next.review19!.areaCounts).every((count) => count === null));
  });
}

test("unmeasured areas stay missing and 17 snapshot survives in Review19 daySnapshot without fake counts", () => {
  const original = fixture("17", "area_judge");
  original.currentAreaId = "bento_men";
  original.areaProgressMap.bento_men = {
    ...original.areaProgressMap.bento_men,
    areaCount: 0,
    measurementRecordedAt: at(17, 10).toISOString(),
  };
  original.areaProgressMap.inari = {
    ...original.areaProgressMap.inari,
    status: "completed",
    areaCount: 12,
    completedRateText: "30%",
  };
  original.areaProgressMap.tempura = {
    ...original.areaProgressMap.tempura,
    status: "auto_skipped_late_time",
    measurementStatus: "not_measured",
    missingReason: "early_next_minus5_skipped",
  };
  const before = JSON.stringify(original);
  const timestamp = at(18, 55).toISOString();
  const source = finalizeUnmeasuredAreasForAutoTransition(original, timestamp);
  assert.equal(JSON.stringify(original), before);
  assert.equal(source.areaProgressMap.bento_men.areaCount, 0);
  assert.equal(source.areaProgressMap.bento_men.measurementStatus, "measured");
  assert.equal(source.areaProgressMap.inari.areaCount, 12);
  assert.equal(source.areaProgressMap.inari.completedRateText, "30%");
  assert.equal(source.areaProgressMap.tempura.missingReason, "early_next_minus5_skipped");
  const untouched = NORMAL_ROUTE.filter((id) => !["bento_men", "inari", "tempura"].includes(id));
  for (const areaId of untouched) {
    const progress = source.areaProgressMap[areaId];
    assert.equal(progress.areaCount, undefined);
    assert.equal(progress.measurementStatus, "not_measured");
    assert.equal(progress.missingReason, "auto_time_transition");
    assert.equal(progress.skipAcknowledgedAt, timestamp);
    assert.equal(progress.areaCountEvaluation, undefined);
  }
  const snapshot = createDailySessionSnapshot({
    capturedAt: timestamp,
    state: source,
    ...snapshotInputs(source),
    sessionEndReason: "auto_time_transition",
  });
  assert.ok(snapshot);
  assert.equal(snapshot.session.discountTime, "17");
  assert.equal(snapshot.session.startedAt, STARTED_AT);
  assert.equal(snapshot.screen, "area_judge");
  for (const areaId of untouched) {
    assert.equal(snapshot.areas[areaId].areaCount, undefined);
    assert.equal(snapshot.areas[areaId].measurementStatus, "not_measured");
    assert.equal(snapshot.areas[areaId].missingReason, "auto_time_transition");
  }
  const restored = normalizeLoadedState(JSON.parse(JSON.stringify(source)), source.sessionDraft);
  const reviewState = createReview19StartState({
    currentState: original,
    sourceState: restored,
    now: at(18, 55),
    snapshots: [snapshot],
    lastSessionWeather: null,
  });
  assert.equal(reviewState.session?.discountTime, "17");
  assert.equal(reviewState.areaProgressMap.inari.areaCount, 12);
  for (const areaId of untouched) {
    assert.equal(reviewState.areaProgressMap[areaId].areaCount, undefined);
    assert.equal(reviewState.areaProgressMap[areaId].missingReason, "auto_time_transition");
  }
  const day = createReview19DaySnapshot({
    date: DATE,
    capturedAt: timestamp,
    demandCycle: "normal",
    areaCountRecords: [],
    sessions: [snapshot],
  });
  assert.equal(day.sessions.length, 1);
  assert.equal(day.sessions[0].session.discountTime, "17");
  assert.equal(day.sessions[0].sessionEndReason, "auto_time_transition");
  assert.deepEqual(day.areaCountRecords, []);
});

test("legacy source selector still reads saved 17 data without rewriting the existing 18 state", () => {
  const source = fixture("17", "done", "summer");
  source.areaProgressMap.inari.areaCount = 17;
  const current = fixture("18", "start");
  current.areaProgressMap.inari.areaCount = 99;
  const restored = selectReview19SourceState({
    currentState: current,
    savedSourceState: JSON.parse(JSON.stringify(source)),
    currentDate: DATE,
  });
  assert.ok(restored);
  assert.ok(canStartReview19FromCurrentState({ state: current, now: at(19, 0), records: [] }));
  const next = createReview19StartState({
    currentState: current,
    sourceState: restored,
    now: at(19, 0),
    snapshots: [],
    lastSessionWeather: null,
  });
  assert.equal(next.screen, "review19");
  assert.equal(next.session?.discountTime, "17");
  assert.equal(next.review19?.demandCycle, "summer");
  assert.equal(next.areaProgressMap.inari.areaCount, 17);
});

// Exercise the actual hook action with controlled React/browser/storage closures.
// No transition implementation is copied into this harness. The extracted body
// is compiled from the current application source and all domain logic is real.
const hookSource = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
const hookAst = ts.createSourceFile("useNebikiApp.ts", hookSource, ts.ScriptTarget.Latest, true);
function extractHookFunction(name: string): string {
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(hookAst);
  assert.ok(found, `hook function ${name} exists`);
  return ts.transpileModule(`${found.getText(hookAst)}\n${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

type ActionHarness = {
  run: (options?: { autoTransition?: boolean }) => void;
  runManual: () => void;
  events: string[];
  snapshots: DailySessionSnapshot[];
  sources: AppState[];
  published: AppState[];
  context: Record<string, unknown>;
};

function hookHarness(params: {
  state?: AppState;
  now?: Date;
  isTestMode?: boolean;
  sourceSaveOk?: boolean;
  snapshotSaveOk?: boolean;
  savedSource?: AppState;
  records?: Review19Result[];
  historicalSnapshots?: DailySessionSnapshot[];
} = {}): ActionHarness {
  const state = params.state ?? fixture();
  const now = params.now ?? at(18, 55);
  const events: string[] = [];
  const snapshots: DailySessionSnapshot[] = [];
  const persistedSnapshots: DailySessionSnapshot[] = [];
  const sources: AppState[] = [];
  const published: AppState[] = [];
  const input = snapshotInputs(state.session ? state : params.savedSource ?? fixture());
  const context: Record<string, unknown> = {
    Date,
    state,
    nowMs: now.getTime(),
    isTestMode: params.isTestMode ?? false,
    timeSwitchTarget: null,
    archivedReview19RecordsRef: { current: params.records ?? [] },
    autoTransitionInFlightKeyRef: { current: null },
    getRuntimeNow: () => now,
    getNextDoneDiscountInfo,
    getAutomaticReview19TransitionKey,
    hasStarted1830Session,
    finalizeUnmeasuredAreasForAutoTransition,
    createDailySessionSnapshot,
    sessionSourceResolvedWeather: input.resolvedWeather,
    weekdayBaseInfo: input.weekdayBaseInfo,
    basisGuide: input.basisGuide,
    lateTimeBonus: 0,
    capturedDoneSummaryItems: [],
    upsertDailySessionSnapshotSafely: (snapshot: DailySessionSnapshot) => {
      events.push("snapshot");
      snapshots.push(snapshot);
      if (params.snapshotSaveOk !== false) persistedSnapshots.push(snapshot);
      return { ok: params.snapshotSaveOk ?? true, attempts: [] };
    },
    reportStorageOperationFailures: () => undefined,
    persistReview19SourceStateSafely: (source: AppState) => {
      events.push("source");
      sources.push(source);
      return params.sourceSaveOk ?? true;
    },
    createReview19StartState: (args: Parameters<typeof createReview19StartState>[0]) => {
      events.push("build");
      return createReview19StartState(args);
    },
    getHistoricalDailySessionSnapshotsForDate: (date: string) => [
      ...(params.historicalSnapshots ?? []), ...persistedSnapshots,
    ].filter((item) => item.session.date === date),
    lastSessionWeather: null,
    canStartReview19FromCurrentState,
    selectReview19SourceState,
    loadReview19SourceState: () => params.savedSource ?? null,
    window: { alert: (message: string) => events.push(`alert:${message}`) },
    setState: (next: AppState | ((previous: AppState) => AppState)) => {
      events.push("setState");
      published.push(typeof next === "function" ? next(published.at(-1) ?? state) : next);
    },
    setUndoSnapshot: () => undefined,
    setUndoNotice: () => undefined,
    setAreaJudgeSelection: () => undefined,
    setResumeTargetScreen: () => undefined,
    setTimeSwitchTarget: () => undefined,
    shouldPrioritizeUnfinishedAreasOnAutoTransition,
    earlyNextMinus5Info: null,
    shouldReserveEarlyNextMinus5OnAutoTransition: () => false,
    appendNextSessionSkipRecords: () => { throw new Error("unexpected synthetic next-session skip"); },
    openNextSessionInput: (target: DiscountTime) => { events.push(`open:${target}`); return true; },
    buildAutoTimeSwitchDialogText,
    formatLocalDate,
  };
  context.buildReview19StartState = runInNewContext(extractHookFunction("buildReview19StartState"), context);
  const run = runInNewContext(extractHookFunction("startNextDoneSession"), context) as ActionHarness["run"];
  const runManual = runInNewContext(extractHookFunction("startReview19Manually"), context) as ActionHarness["runManual"];
  return { run, runManual, events, snapshots, sources, published, context };
}

for (const [hour, minute] of [[18, 24], [18, 25], [18, 30], [18, 54]]) {
  test(`actual hook ${hour}:${minute} stays at 17 without dialog, snapshot, skip reservation, or 18:30 input`, () => {
    const harness = hookHarness({ now: at(hour, minute) });
    harness.run({ autoTransition: true });
    assert.deepEqual(harness.events, []);
    assert.equal(harness.snapshots.length, 0);
    assert.equal(harness.published.length, 0);
  });
}

test("actual hook 18:24 performs no transition or persistence", () => {
  const harness = hookHarness({ now: at(18, 24) });
  harness.run({ autoTransition: true });
  assert.deepEqual(harness.events, []);
});

for (const [hour, minute] of [[18, 55], [19, 0], [19, 25], [20, 30], [23, 59]]) {
  test(`actual hook ${hour}:${minute} preserves source/snapshot and opens Review19 only after alert returns`, () => {
    const harness = hookHarness({ now: at(hour, minute), state: fixture("17", "area_judge") });
    harness.run({ autoTransition: true });
    assert.equal(harness.sources.length, 1);
    assert.equal(harness.snapshots.length, 1);
    assert.equal(harness.published.length, 1);
    assert.equal(harness.published[0].screen, "review19");
    assert.equal(harness.published[0].session?.discountTime, "17");
    assert.equal(harness.sources[0].session?.discountTime, "17");
    assert.equal(harness.snapshots[0].session.discountTime, "17");
    assert.equal(harness.snapshots[0].sessionEndReason, "auto_time_transition");
    assert.equal(harness.events.some((event) => event.startsWith("open:")), false);
    const alertIndex = harness.events.findIndex((event) => event.startsWith("alert:"));
    assert.ok(alertIndex > harness.events.indexOf("source"));
    assert.ok(alertIndex < harness.events.indexOf("setState"));
    assert.match(harness.events[alertIndex], /19時チェック/);
    assert.doesNotMatch(harness.events[alertIndex], /19時30分|18時30分/);
    assert.ok(Object.values(harness.sources[0].areaProgressMap).every((area) => area.areaCount === undefined));
  });
}

test("actual hook stale closures from timer/focus/visibility callbacks cannot duplicate the dialog/start", () => {
  const harness = hookHarness();
  // Re-enter while the blocking dialog is open, then repeat without a React
  // render: this is stricter than sequential 30-second/focus/visibility events.
  harness.context.window = {
    alert: (message: string) => {
      harness.events.push(`alert:${message}`);
      harness.run({ autoTransition: true });
    },
  };
  harness.run({ autoTransition: true });
  for (let repeat = 0; repeat < 4; repeat += 1) {
    harness.run({ autoTransition: true });
  }
  assert.equal(harness.events.filter((event) => event.startsWith("alert:")).length, 1);
  assert.equal(harness.published.length, 1);
  assert.equal(harness.snapshots.length, 1);
  assert.equal(harness.sources.length, 1);
});

test("actual hook does not interrupt a manually opened 18:30 weather input", () => {
  const harness = hookHarness({ state: fixture("17", "area_judge") });
  harness.context.timeSwitchTarget = "18";
  harness.run({ autoTransition: true });
  assert.deepEqual(harness.events, []);
});

test("actual hook explicit next-discount action keeps its manual semantics at 18:55", () => {
  const harness = hookHarness();
  harness.run();
  assert.deepEqual(harness.events, ["open:18"]);
});

test("actual manual hook uses the same builder, restores saved 17 source, and blocks repeat invocation", () => {
  const source = fixture("17", "done", "summer");
  source.areaProgressMap.inari.areaCount = 17;
  const current = fixture("17", "start");
  current.session = null;
  current.sessionDraft.discountTime = "18";
  const harness = hookHarness({ state: current, savedSource: source, now: at(19, 0) });
  harness.runManual();
  harness.runManual();
  assert.equal(harness.events.filter((event) => event === "build").length, 1);
  assert.equal(harness.published[0].screen, "review19");
  assert.equal(harness.published[0].review19?.demandCycle, "summer");
  assert.equal(harness.published[0].session?.discountTime, "17");
  assert.equal(harness.published[0].areaProgressMap.inari.areaCount, 17);
  assert.equal(harness.published[1], harness.published[0]);
  assert.equal(harness.events.some((event) => event.startsWith("alert:")), false);
});

test("actual manual hook still blocks a completed day and non-start screens", () => {
  for (const harness of [
    hookHarness({ state: fixture("17", "start"), records: [reviewRecord(true)] }),
    hookHarness({ state: fixture("17", "done") }),
  ]) {
    harness.runManual();
    assert.equal(harness.events.includes("build"), false);
    assert.equal(harness.published[0], harness.context.state);
  }
});

test("actual hook fixed-time does not auto-start 18:30 or Review19 and performs no production writes", () => {
  const harness = hookHarness({ isTestMode: true });
  harness.run({ autoTransition: true });
  assert.equal(harness.sources.length, 0);
  assert.equal(harness.snapshots.length, 0);
  assert.equal(harness.published.length, 0);
  assert.deepEqual(harness.events, []);
});

for (const stage of ["snapshot", "source"] as const) {
  test(`actual hook ${stage} persistence failure retains current 17 state and does not open Review19`, () => {
    const harness = hookHarness({
      snapshotSaveOk: stage !== "snapshot",
      sourceSaveOk: stage !== "source",
    });
    harness.run({ autoTransition: true });
    assert.equal(harness.published.length, 0);
    assert.equal(harness.events.some((event) => event.startsWith("open:")), false);
    assert.equal(harness.events.some((event) => event.includes("19時チェックの時間")), false);
    assert.equal((harness.context.autoTransitionInFlightKeyRef as { current: string | null }).current, null);
    harness.context.upsertDailySessionSnapshotSafely = (snapshot: DailySessionSnapshot) => {
      harness.snapshots.push(snapshot);
      return { ok: true, attempts: [] };
    };
    harness.context.persistReview19SourceStateSafely = (source: AppState) => {
      harness.sources.push(source);
      return true;
    };
    harness.run({ autoTransition: true });
    assert.equal(harness.published.length, 1);
    assert.equal(harness.published[0].screen, "review19");
  });
}

function nightSnapshot(state = fixture("18", "area_judge")): DailySessionSnapshot {
  const snapshot = createDailySessionSnapshot({
    capturedAt: at(18, 30).toISOString(), state, ...snapshotInputs(state),
  });
  assert.ok(snapshot);
  return snapshot;
}

test("18:30 draft alone is not night-session evidence, including a preserved 17 source", () => {
  const state = fixture("17", "start");
  state.sessionDraft.discountTime = "18";
  state.sessionDraft.weatherInputLockedDiscountTime = "18";
  assert.equal(hasStarted1830Session({ state, now: at(18, 55) }), false);
  state.session = null;
  assert.equal(hasStarted1830Session({ state, now: at(18, 55) }), false);
});

for (const [hour, minute] of [[18, 55], [19, 25], [20, 30], [23, 59]]) {
  test(`persisted same-day 18 snapshot suppresses 17→Review19 at ${hour}:${minute} after restore`, () => {
    const stored = JSON.stringify([nightSnapshot()]);
    const snapshots = JSON.parse(stored) as DailySessionSnapshot[];
    const state = normalizeLoadedState(JSON.parse(JSON.stringify(fixture())), fixture().sessionDraft);
    const before = JSON.stringify(snapshots);
    assert.equal(hasStarted1830Session({ state, now: at(hour, minute), snapshots }), true);
    const harness = hookHarness({ state, now: at(hour, minute), historicalSnapshots: snapshots });
    for (let event = 0; event < 4; event += 1) harness.run({ autoTransition: true });
    assert.deepEqual(harness.events, []);
    assert.equal(JSON.stringify(snapshots), before);
  });
}

test("old-day 18 snapshot does not suppress today's Review19", () => {
  const snapshots = [nightSnapshot()];
  const nextDate = new Date(2026, 8, 6, 18, 55);
  const state = fixture();
  state.session!.date = "2026-09-06";
  state.session!.startedAt = new Date(2026, 8, 6, 17, 0).toISOString();
  assert.equal(hasStarted1830Session({ state, now: nextDate, snapshots }), false);
  assert.ok(getAutomaticReview19TransitionKey({ state, now: nextDate, snapshots }));
});

test("legacy actual 18 session is evidence without relying on manual override, and existing Review19 stays unchanged", () => {
  for (const manualDiscountTimeOverride of [true, false]) {
    const state = fixture("18", "start");
    state.session!.manualDiscountTimeOverride = manualDiscountTimeOverride;
    state.review19 = reviewRecord(true);
    const before = JSON.stringify(state);
    assert.equal(hasStarted1830Session({ state, now: at(23, 59) }), true);
    const harness = hookHarness({ state });
    harness.runManual();
    assert.equal(harness.events.includes("build"), false);
    assert.equal(JSON.stringify(state), before);
  }
});

test("manual Review19 wrapper blocks persisted night evidence even after current session returns to 17", () => {
  const state = fixture("17", "start");
  const harness = hookHarness({ state, historicalSnapshots: [nightSnapshot()] });
  harness.runManual();
  assert.equal(harness.events.includes("build"), false);
  assert.equal(harness.published[0], state);
});

// Run the actual manual opening and session-start bodies. UI setters are
// controlled, while session planning, temperature, snapshot and cycle logic
// are the application implementations.
function manualStartHarness(params: {
  state?: AppState;
  now?: Date;
  isTestMode?: boolean;
  snapshotSaveOk?: boolean;
} = {}) {
  const state = params.state ?? fixture();
  const harness = hookHarness({ ...params, state, now: params.now ?? at(18, 30) });
  const { context, published, events } = harness;
  Object.assign(context, {
    NORMAL_ROUTE,
    normalizeDemandCycle,
    cloneHourlyForecasts,
    cloneSkipRecords,
    getCurrentDataVersionInfo,
    normalizeGlobalDiscountAdjustmentPercent,
    supportsObonCalendarRule,
    resolveSessionTemperatureComfort,
    lockDemandCycleForDate,
    consumeSkipRecordsInMemory,
    createTimeSwitchPlan,
    createInitialAreaProgressMap,
    createAreaProgressMapWithAutoSkippedAreas,
    createInitialState,
    buildStartDefaultDraft,
    getFirstNormalFlowAreaId,
    getNormalFlowScreenForArea,
    getWeekdayBaseInfo,
    getBasisGuideDisplay,
    isValidDiscountTime,
    normalizeReview19ExcludedAreaIds,
    buildTimeSwitchNotice,
    lastUsedSessionDraft: state.sessionDraft,
    activeDemandCycle: "normal",
    globalDiscountAdjustmentPercent: 5,
    demandCycleState: { selectedCycle: "normal", lockedDate: DATE, lockedCycle: "normal" },
    nextSessionSkipRecordsRef: { current: [] },
    weatherConfirmationSubmittingRef: { current: false },
    resumeTargetScreen: null,
    setWeatherConfirmationPending: () => undefined,
    setDemandCycleState: () => undefined,
    persistDemandCycleStateSafely: () => undefined,
    setLastUsedSessionDraft: () => undefined,
    setState: (next: AppState) => {
      events.push("setState");
      published.push(next);
      context.state = next;
    },
    setTimeSwitchTarget: (next: DiscountTime | null) => { context.timeSwitchTarget = next; },
    replaceNextSessionSkipRecords: () => events.push("replaceSkips"),
  });
  context.openNextSessionInput = runInNewContext(extractHookFunction("openNextSessionInput"), context);
  const start = runInNewContext(extractHookFunction("startSession"), context) as () => void;
  return { ...harness, start };
}

test("manual done action opens only locked 18 weather draft, with original 17 still current", () => {
  const harness = manualStartHarness();
  harness.run();
  const draftState = harness.published[0];
  assert.equal(draftState.screen, "start");
  assert.equal(draftState.session?.discountTime, "17");
  assert.equal(draftState.sessionDraft.discountTime, "18");
  assert.equal(draftState.sessionDraft.weatherInputLockedDiscountTime, "18");
  assert.equal(draftState.sessionDraft.manualDiscountTimeOverride, false);
  assert.equal(harness.context.timeSwitchTarget, "18");
  assert.equal(harness.snapshots.length, 0);
  assert.equal(hasStarted1830Session({ state: draftState, now: at(18, 30) }), false);
});

test("actual manual 18 start persists real unmeasured session before publishing without fake Review19 or AreaCount", () => {
  const state = fixture();
  state.areaProgressMap.inari = { ...state.areaProgressMap.inari, status: "completed", areaCount: 32 };
  state.review19 = reviewRecord(true);
  const reviewBefore = JSON.stringify(state.review19);
  const harness = manualStartHarness({ state });
  harness.run();
  harness.events.length = 0;
  harness.start();
  const started = harness.published.at(-1)!;
  assert.equal(started.session?.discountTime, "18");
  assert.equal(started.session?.startedAt, at(18, 30).toISOString());
  assert.equal(started.session?.manualDiscountTimeOverride, false);
  assert.equal(started.session?.globalDiscountAdjustmentPercent, 5);
  assert.equal(JSON.stringify(started.review19), reviewBefore);
  assert.ok(Object.values(started.areaProgressMap).every((area) => area.areaCount === undefined));
  assert.equal(harness.snapshots.length, 1);
  const snapshot = harness.snapshots[0];
  assert.ok(harness.events.indexOf("snapshot") < harness.events.indexOf("setState"));
  assert.equal(snapshot.session.discountTime, "18");
  assert.equal(snapshot.session.startedAt, started.session.startedAt);
  assert.equal(snapshot.screen, "area_judge");
  assert.equal(snapshot.sessionEndReason, undefined);
  assert.equal(snapshot.calendarContext?.areaCountReference[0]?.discountTime, "18");
  const expectedWeather = resolveSessionTemperatureComfort({
    date: DATE, discountTime: "18", weather: started.session.weather,
    snapshots: [], lastSessionWeather: null,
    existingAnalysis: started.session.temperatureComfortAnalysis,
  }).resolvedWeather;
  assert.deepEqual(snapshot.session.resolvedWeather, expectedWeather);
  assert.ok(Object.values(snapshot.areas).every((area) => area.areaCount === undefined));
  assert.deepEqual(snapshot.doneSummaryItems, []);
  const day = createReview19DaySnapshot({
    date: DATE, capturedAt: at(19, 0).toISOString(), demandCycle: "normal",
    sessions: harness.snapshots, areaCountRecords: [],
  });
  assert.deepEqual(day.sessions, []);
  assert.deepEqual(day.areaCountRecords, []);
  assert.equal(hasStarted1830Session({ state: fixture(), now: at(23, 59), snapshots: harness.snapshots }), true);
});

test("manual full time selector creates a fresh 18 session rather than relabelling the preserved 17 areas", () => {
  const state = fixture("17", "start");
  state.sessionDraft.discountTime = "18";
  state.sessionDraft.manualDiscountTimeOverride = true;
  state.areaProgressMap.inari = { ...state.areaProgressMap.inari, status: "completed", areaCount: 32 };
  const harness = manualStartHarness({ state });
  harness.start();
  const started = harness.published[0];
  assert.equal(started.session?.discountTime, "18");
  assert.equal(started.session?.manualDiscountTimeOverride, true);
  assert.notEqual(started.session?.startedAt, STARTED_AT);
  assert.equal(started.areaProgressMap.inari.areaCount, undefined);
  assert.equal(harness.snapshots.length, 1);
});

test("18 start snapshot failure retains the 17 source and permits retry without a false night marker", () => {
  const harness = manualStartHarness({ snapshotSaveOk: false });
  harness.run();
  const prior = harness.context.state as AppState;
  const before = JSON.stringify(prior);
  harness.start();
  assert.equal(harness.context.state, prior);
  assert.equal(JSON.stringify(prior), before);
  assert.equal(prior.session?.discountTime, "17");
  assert.equal(harness.published.length, 1);
  const readSnapshots = harness.context.getHistoricalDailySessionSnapshotsForDate as
    (date: string) => DailySessionSnapshot[];
  assert.equal(hasStarted1830Session({ state: prior, now: at(18, 55), snapshots: readSnapshots(DATE) }), false);
  harness.context.upsertDailySessionSnapshotSafely = () => ({ ok: true, attempts: [] });
  harness.start();
  assert.equal(harness.published.at(-1)?.session?.discountTime, "18");
});

test("fixed-time explicit 18 start executes its operational plan but never persists a night snapshot", () => {
  const harness = manualStartHarness({ isTestMode: true });
  harness.run();
  harness.start();
  assert.equal(harness.published.at(-1)?.session?.discountTime, "18");
  assert.equal(harness.sources.length, 0);
  assert.equal(harness.snapshots.length, 0);
});

test("actual 18 start journal roundtrip survives current-state replacement without generating Review19 or count records", () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const localStorage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
  try {
    const harness = manualStartHarness();
    harness.run();
    assert.equal(loadDailySessionSnapshots().length, 0);
    harness.context.upsertDailySessionSnapshotSafely = upsertDailySessionSnapshotSafely;
    harness.start();
    const persisted = loadDailySessionSnapshots();
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].session.discountTime, "18");
    assert.ok(Object.values(persisted[0].areas).every((area) => area.areaCount === undefined));
    assert.ok([...values.keys()].every((key) => key === "nebiki-helper/daily-session-snapshots"));
    const restored17 = normalizeLoadedState(JSON.parse(JSON.stringify(fixture())), fixture().sessionDraft);
    const reloaded = hookHarness({ state: restored17, now: at(23, 59) });
    reloaded.context.getHistoricalDailySessionSnapshotsForDate = getHistoricalDailySessionSnapshotsForDate;
    for (let event = 0; event < 4; event += 1) reloaded.run({ autoTransition: true });
    assert.deepEqual(reloaded.events, []);
    assert.equal(loadDailySessionSnapshots().length, 1);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("same-day authoritative Review19 and existing pending Review19 prevent actual automatic side effects", () => {
  const inProgress = fixture();
  inProgress.review19 = reviewRecord();
  for (const harness of [
    hookHarness({ records: [reviewRecord(true)] }),
    hookHarness({ state: inProgress }),
  ]) {
    harness.run({ autoTransition: true });
    assert.deepEqual(harness.events, []);
  }
});

let passed = 0;
for (const { name, run } of tests) {
  try {
    run();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}
console.log(`Review19 priority transition: ${passed}/${tests.length} PASS`);
