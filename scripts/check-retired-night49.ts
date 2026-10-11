import assert from "node:assert/strict";
import {
  HistoricalArchiveRepository,
  MemoryHistoricalArchiveAdapter,
  mergeDailySessionSnapshotArchiveOperations,
} from "../src/domain/historicalArchive.ts";
import {
  loadDailySessionSnapshots,
  loadPersistedNebikiState,
  saveCurrentSession,
  saveDailySessionSnapshots,
  saveWorkSessionCheckpoint,
  STORAGE_KEYS,
  upsertDailySessionSnapshotSafely,
} from "../src/domain/storage.ts";
import type { AppState, DailySessionSnapshot, DiscountTime, SessionDraft } from "../src/domain/types.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { buildNormalRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { createNavigationSnapshot } from "../src/domain/navigationHistory.ts";
import {
  createInitialState,
  getInitialTimeSwitchTarget,
  normalizeLoadedState,
  normalizeSessionDraft,
} from "../src/hooks/nebikiApp/stateNormalization.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import {
  buildRetiredNightDoneSummaryItems,
  buildRetiredNightSnapshot,
  collectRetiredNightOperations,
  hasRetiredNightSession,
  isRetiredNightDiscountOperation,
  retireNightOperationalState,
} from "../src/hooks/nebikiApp/retiredNightOperation.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function makeDraft(time: DiscountTime = "18"): SessionDraft {
  return {
    date: "2026-10-10", weekday: 6, discountTime: time, demandCycle: "normal",
    manualWeekdayOverride: false, manualDiscountTimeOverride: true,
    weatherInputLockedDiscountTime: time,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
}

function makeState(time: DiscountTime = "18", screen: AppState["screen"] = "rate_display"): AppState {
  const draft = makeDraft(time);
  const startedAt = new Date(2026, 9, 10, Number(time), 30).toISOString();
  const confirmedAt = new Date(2026, 9, 10, Number(time), 35).toISOString();
  const state = createInitialState(draft);
  state.session = { ...clone(draft), startedAt, dataSchemaVersion: 3, appVersion: "2026.8.9-48", buildId: "fixture-old" };
  state.screen = screen;
  state.currentAreaId = "tempura";
  state.areaProgressMap.onigiri = {
    areaId: "onigiri", status: "completed", areaJudge: "normal", areaCount: 13,
    visitedAt: confirmedAt, completedAt: confirmedAt, completedRateText: "31%",
    humanEvaluationDetails: {
      humanEvaluationScore9: 5, humanEvaluationScale: 9,
      humanEvaluationSelections: ["normal"], automaticEvaluation: "slightly_many",
      resolvedEvaluation: "normal", resolutionDirection: "none", resolutionReason: "single_selection",
      sessionDiscountTime: time, evaluatedAt: confirmedAt,
    },
    rateDecisionSnapshot: buildNormalRateDecisionSnapshot({
      confirmedAt, sessionDiscountTime: time,
      resolvedWeather: resolveWeatherInputForDiscount(draft.weather, time),
      weatherComfortAdjustmentPercent: 5, areaRateAdjustment: 0, areaJudge: "normal",
    }),
    rateDecisionSnapshotStatus: "captured", measurementStatus: "measured",
    measurementRecordedAt: confirmedAt, rateOrigin: "confirmed_now",
  };
  state.areaProgressMap.tempura = {
    areaId: "tempura", status: "auto_skipped_late_time", areaJudge: null,
    measurementStatus: "not_measured", missingReason: "early_next_minus5_skipped",
    autoSkipKind: "early_next_minus5", earlyNextMinus5TargetDiscountTime: "19",
    sourceDiscountTime: "17", sourceSessionStartedAt: "original-source-17",
    visitedAt: confirmedAt, earlyDiscountResolution: "not_measured",
  };
  state.areaProgressMap.inari = {
    areaId: "inari", status: "completed", areaJudge: "many", areaCount: 6,
    completedRateText: "37%", completedManyRateText: "47%", completedNormalRateText: "37%",
    completedAt: confirmedAt, measurementStatus: "measured", rateDecisionSnapshotStatus: "legacy_not_captured",
  };
  return state;
}

function makeSnapshot(state: AppState): DailySessionSnapshot {
  assert.ok(state.session);
  const resolvedWeather = resolveWeatherInputForDiscount(state.session.weather, state.session.discountTime);
  const snapshot = createDailySessionSnapshot({
    state, capturedAt: new Date(2026, 9, 10, Number(state.session.discountTime), 40).toISOString(),
    resolvedWeather,
    weekdayBaseInfo: getWeekdayBaseInfo(state.session.weekday, state.session.discountTime, resolvedWeather, state.session.date),
    basisGuide: getBasisGuideDisplay({
      date: state.session.date, weekday: state.session.weekday,
      discountTime: state.session.discountTime, weather: resolvedWeather,
    }),
    lateTimeBonus: 0, doneSummaryItems: buildRetiredNightDoneSummaryItems(state),
  });
  assert.ok(snapshot);
  return snapshot;
}

function collect(state: AppState, checkpoint: AppState | null = null) {
  const [operation] = collectRetiredNightOperations({
    currentSession: state, workSessionCheckpoint: checkpoint, runtimeState: null,
  });
  assert.ok(operation);
  return operation;
}

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push({ name, run });
const storage = new MemoryStorage();
const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

try {
  test("historical normalizers retain every night time and operation targets accept only 15/17", () => {
    for (const time of ["18", "19", "20"] as const) {
      const state = makeState(time);
      assert.equal(normalizeSessionDraft(state.sessionDraft).discountTime, time);
      assert.equal(normalizeLoadedState(state, makeDraft("17")).session?.discountTime, time);
      assert.equal(getInitialTimeSwitchTarget(time, false), null);
    }
    assert.equal(getInitialTimeSwitchTarget("15", false), "15");
    assert.equal(getInitialTimeSwitchTarget("17", false), "17");
    assert.equal(getInitialTimeSwitchTarget("17", true), null);
  });

  test("night restoration is isolated from UI for every work screen, including old Done", () => {
    for (const time of ["18", "19", "20"] as const) {
      for (const screen of ["start", "area_judge", "rate_display", "final_time", "done"] as const) {
        const state = makeState(time, screen);
        const before = clone(state);
        const reset = retireNightOperationalState(state, makeDraft("17"));
        assert.equal(reset.screen, "start");
        assert.equal(reset.session, null);
        assert.equal(reset.sessionDraft.discountTime, "17");
        assert.equal(reset.sessionDraft.manualDiscountTimeOverride, false);
        assert.equal(reset.sessionDraft.weatherInputLockedDiscountTime, null);
        assert.equal(reset.areaProgressMap.tempura.status, "unstarted");
        assert.equal(reset.areaProgressMap.tempura.earlyNextMinus5TargetDiscountTime, undefined);
        assert.deepEqual(state, before);
      }
    }
  });

  test("Review19 internal 19 and ordinary 15/17 are preserved", () => {
    for (const screen of ["review19_weather", "review19", "review19_done"] as const) {
      const state = makeState("19", screen);
      assert.equal(hasRetiredNightSession(state), true);
      assert.equal(isRetiredNightDiscountOperation(state), false);
      assert.equal(retireNightOperationalState(state, makeDraft("17")), state);
      assert.equal(collectRetiredNightOperations({ currentSession: state, workSessionCheckpoint: null, runtimeState: null }).length, 0);
    }
    for (const time of ["15", "17"] as const) {
      const state = makeState(time);
      assert.equal(retireNightOperationalState(state, makeDraft("17")), state);
    }
  });

  test("collector retains independent current/checkpoint/undo/history/source variants", () => {
    const state = makeState();
    const checkpoint = clone(state);
    checkpoint.areaProgressMap.onigiri.areaCount = 21;
    const navigation = createNavigationSnapshot({
      state: checkpoint, areaJudgeSelection: "normal", resumeTargetScreen: "rate_display",
      nextSessionSkipRecords: [], lastSessionWeather: null,
    });
    const operations = collectRetiredNightOperations({
      currentSession: state, workSessionCheckpoint: checkpoint, review19SourceState: state,
      runtimeState: { undoSnapshot: navigation, screenHistory: [navigation, navigation],
        timeSwitchTarget: "20", resumeTargetScreen: "rate_display", areaJudgeSelection: null },
    });
    assert.equal(operations.length, 1);
    assert.equal(operations[0].evidence.length, 5);
    assert.equal(operations[0].state.areaProgressMap.onigiri.areaCount, 13);
    checkpoint.areaProgressMap.onigiri.areaCount = 99;
    assert.equal(operations[0].evidence.find((entry) => entry.source === "work_session_checkpoint")?.state.areaProgressMap.onigiri.areaCount, 21);
  });

  test("old raw persistence can be collected before date cleanup without writing it", () => {
    storage.clear();
    const state = makeState();
    saveCurrentSession(state);
    saveWorkSessionCheckpoint(state);
    const beforeCurrent = storage.getItem(STORAGE_KEYS.currentSession);
    const beforeCheckpoint = storage.getItem(STORAGE_KEYS.workSessionCheckpoint);
    const raw = loadPersistedNebikiState();
    assert.equal(collectRetiredNightOperations(raw).length, 1);
    assert.equal(storage.getItem(STORAGE_KEYS.currentSession), beforeCurrent);
    assert.equal(storage.getItem(STORAGE_KEYS.workSessionCheckpoint), beforeCheckpoint);
  });

  test("existing snapshots preserve their captured decision, basis, area statuses and times", () => {
    const state = makeState();
    const existing = makeSnapshot(state);
    existing.basis.baseRateBonus = 7;
    existing.basisCapturedAt = "original-basis-time";
    const before = clone(existing);
    const retired = buildRetiredNightSnapshot({ operation: collect(state), capturedAt: "2026-10-11T10:00:00Z", existingSnapshot: existing });
    assert.ok(retired);
    const { retiredOperation, ...unchanged } = retired;
    assert.deepEqual(unchanged, before);
    assert.equal(retiredOperation?.basisCaptureStatus, "preserved");
    assert.deepEqual(retiredOperation?.evidence[0].state, clone(state));
    assert.deepEqual(clone(existing), before);
  });

  test("fallback exports only real confirmed rate text and preserves unmeasured evidence", () => {
    const state = makeState();
    const fallback = makeSnapshot(state);
    const retired = buildRetiredNightSnapshot({ operation: collect(state), capturedAt: "2026-10-11T10:00:00Z", fallbackSnapshot: fallback });
    assert.ok(retired);
    assert.equal(retired.retiredOperation?.basisCaptureStatus, "unavailable");
    assert.equal(retired.session.discountTime, "18");
    assert.equal(retired.screen, "rate_display");
    assert.equal(retired.sessionEndReason, undefined);
    assert.equal(retired.areas.inari.rateText, "37%");
    assert.equal(retired.areas.tempura.areaCount, undefined);
    assert.equal(retired.areas.tempura.measurementStatus, "not_measured");
    assert.equal(retired.areas.tempura.missingReason, "early_next_minus5_skipped");
    assert.deepEqual(retired.areas.onigiri.humanEvaluationDetails, state.areaProgressMap.onigiri.humanEvaluationDetails);
    assert.deepEqual(retired.areas.onigiri.rateDecisionSnapshot, clone(state.areaProgressMap.onigiri.rateDecisionSnapshot));
  });

  test("missing or mismatched snapshot identity fails safely without rewriting 18 as 17", () => {
    const state = makeState();
    assert.equal(buildRetiredNightSnapshot({ operation: collect(state), capturedAt: "now" }), null);
    assert.equal(buildRetiredNightSnapshot({ operation: collect(state), capturedAt: "now", fallbackSnapshot: makeSnapshot(makeState("17")) }), null);
  });

  test("archive same-signature merge retains new evidence and exact historical capture", async () => {
    const state = makeState();
    const existing = makeSnapshot(state);
    const checkpoint = clone(state);
    checkpoint.areaProgressMap.onigiri.areaCount = 21;
    const retired = buildRetiredNightSnapshot({ operation: collect(state, checkpoint), capturedAt: "2026-10-11T10:00:00Z", existingSnapshot: existing })!;
    const adapter = new MemoryHistoricalArchiveAdapter();
    const repository = new HistoricalArchiveRepository(adapter);
    assert.equal((await repository.upsertDailySessionSnapshots([existing])).ok, true);
    assert.equal((await repository.upsertDailySessionSnapshots([retired])).ok, true);
    const readback = await repository.listDailySessionSnapshots();
    assert.equal(readback.ok, true);
    if (!readback.ok) return;
    assert.equal(readback.value.length, 1);
    const saved = readback.value[0];
    assert.deepEqual(saved.areas, clone(existing.areas));
    assert.deepEqual(saved.basis, clone(existing.basis));
    assert.equal(saved.capturedAt, existing.capturedAt);
    assert.equal(saved.retiredOperation?.evidence.length, 2);
    assert.deepEqual(mergeDailySessionSnapshotArchiveOperations([saved, existing, retired]), [saved]);
  });

  test("local journal keeps retired evidence when ordinary duplicate snapshots are upserted", () => {
    storage.clear();
    const state = makeState();
    const existing = makeSnapshot(state);
    const retired = buildRetiredNightSnapshot({ operation: collect(state), capturedAt: "2026-10-11T10:00:00Z", existingSnapshot: existing })!;
    saveDailySessionSnapshots([existing]);
    assert.equal(upsertDailySessionSnapshotSafely(retired).ok, true);
    assert.equal(upsertDailySessionSnapshotSafely(existing).ok, true);
    const [saved] = loadDailySessionSnapshots();
    assert.deepEqual(saved.retiredOperation, retired.retiredOperation);
    assert.deepEqual(saved.areas, clone(existing.areas));
    assert.deepEqual(saved.basis, clone(existing.basis));
  });

  test("archive failure leaves original current/checkpoint unchanged and retry preserves evidence", async () => {
    storage.clear();
    const state = makeState();
    saveCurrentSession(state);
    saveWorkSessionCheckpoint(state);
    const sourceBytes = [storage.getItem(STORAGE_KEYS.currentSession), storage.getItem(STORAGE_KEYS.workSessionCheckpoint)];
    const retired = buildRetiredNightSnapshot({ operation: collect(state), capturedAt: "2026-10-11T10:00:00Z", fallbackSnapshot: makeSnapshot(state) })!;
    const adapter = new MemoryHistoricalArchiveAdapter();
    const repository = new HistoricalArchiveRepository(adapter);
    adapter.fault = "write";
    assert.equal((await repository.upsertDailySessionSnapshots([retired])).ok, false);
    assert.deepEqual([storage.getItem(STORAGE_KEYS.currentSession), storage.getItem(STORAGE_KEYS.workSessionCheckpoint)], sourceBytes);
    adapter.fault = null;
    assert.equal((await repository.upsertDailySessionSnapshots([retired])).ok, true);
    const readback = await repository.listDailySessionSnapshots();
    assert.equal(readback.ok, true);
    if (readback.ok) assert.deepEqual(readback.value[0].retiredOperation?.evidence[0].state, clone(state));
    assert.deepEqual([storage.getItem(STORAGE_KEYS.currentSession), storage.getItem(STORAGE_KEYS.workSessionCheckpoint)], sourceBytes);
  });

  test("date mismatch is detectable by readback and cannot be repaired with a fabricated date", async () => {
    const state = makeState();
    state.session!.date = "2026-10-09";
    state.sessionDraft.date = "2026-10-09";
    const retired = buildRetiredNightSnapshot({ operation: collect(state), capturedAt: "2026-10-11T10:00:00Z", fallbackSnapshot: makeSnapshot(state) })!;
    const repository = new HistoricalArchiveRepository(new MemoryHistoricalArchiveAdapter());
    assert.equal((await repository.upsertDailySessionSnapshots([retired])).ok, true);
    const readback = await repository.listDailySessionSnapshots();
    assert.equal(readback.ok, true);
    if (readback.ok) assert.equal(readback.value.length, 0);
    assert.equal(retired.retiredOperation?.evidence[0].state.session?.date, "2026-10-09");
  });

  test("actual daily 15/17 evidence remains exportable without a synthetic 20 session", () => {
    const sessions = [makeSnapshot(makeState("15", "done")), makeSnapshot(makeState("17", "done"))];
    const snapshot = createReview19DaySnapshot({
      capturedAt: "2026-10-10T11:00:00Z", date: "2026-10-10", demandCycle: "normal",
      areaCountRecords: [], sessions,
    });
    assert.deepEqual(snapshot.sessions.map((entry) => entry.session.discountTime), ["15", "17"]);
    assert.equal(snapshot.review19Status, "not_performed");
    assert.equal(snapshot.review19Check, undefined);
    assert.equal(JSON.parse(JSON.stringify(snapshot)).sessions.length, 2);
  });

  for (const entry of tests) {
    await entry.run();
    console.log(`PASS ${entry.name}`);
  }
  console.log(`retired-night49: ${tests.length}/${tests.length} PASS`);
} finally {
  if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
  else Reflect.deleteProperty(globalThis, "localStorage");
}
