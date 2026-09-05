import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import { createInitialReview19Result } from "../src/domain/review19.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
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
} from "../src/hooks/nebikiApp/clock.ts";
import {
  createReview19StartState,
  getAutomaticReview19TransitionKey,
  selectReview19SourceState,
} from "../src/hooks/nebikiApp/review19Flow.ts";
import {
  createDailySessionSnapshot,
  createReview19DaySnapshot,
} from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import {
  createInitialState,
  normalizeLoadedState,
} from "../src/hooks/nebikiApp/stateNormalization.ts";
import {
  buildAutoTimeSwitchDialogText,
  finalizeUnmeasuredAreasForAutoTransition,
  shouldPrioritizeUnfinishedAreasOnAutoTransition,
} from "../src/hooks/nebikiApp/timeTransitions.ts";

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

test("manual start can still restore saved same-day 17 source after an 18:30 session", () => {
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
} = {}): ActionHarness {
  const state = params.state ?? fixture();
  const now = params.now ?? at(18, 55);
  const events: string[] = [];
  const snapshots: DailySessionSnapshot[] = [];
  const sources: AppState[] = [];
  const published: AppState[] = [];
  const input = snapshotInputs(state);
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
    getHistoricalDailySessionSnapshotsForDate: (date: string) => snapshots.filter((item) => item.session.date === date),
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

for (const [hour, minute] of [[18, 25], [18, 54]]) {
  test(`actual hook ${hour}:${minute} still opens 18:30 weather with the existing dialog`, () => {
    const harness = hookHarness({ now: at(hour, minute) });
    harness.run({ autoTransition: true });
    assert.ok(harness.events.includes("open:18"));
    assert.equal(harness.events.filter((event) => event.startsWith("alert:")).length, 1);
    assert.match(harness.events.find((event) => event.startsWith("alert:"))!, /18時30分/);
    assert.equal(harness.published.length, 0);
  });
}

test("actual hook 18:24 performs no transition or persistence", () => {
  const harness = hookHarness({ now: at(18, 24) });
  harness.run({ autoTransition: true });
  assert.deepEqual(harness.events, []);
});

for (const [hour, minute] of [[18, 55], [19, 0], [19, 25], [20, 30]]) {
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

test("actual hook keeps an already claimed 18:30 transition from acquiring Review19 priority", () => {
  const harness = hookHarness({ state: fixture("17", "area_judge") });
  harness.context.autoTransitionInFlightKeyRef = { current: [DATE, STARTED_AT, "17", "18"].join("|") };
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
  const harness = hookHarness({ state: fixture("18", "start"), savedSource: source, now: at(19, 0) });
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

test("actual hook fixed-time keeps the existing route and performs no production snapshot/source writes", () => {
  const harness = hookHarness({ isTestMode: true });
  harness.run({ autoTransition: true });
  assert.equal(harness.sources.length, 0);
  assert.equal(harness.snapshots.length, 0);
  assert.equal(harness.published.length, 0);
  assert.ok(harness.events.includes("open:18"));
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
  });
}

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
