import assert from "node:assert/strict";
import * as React from "react";
import { useNebikiApp as runProductionHook } from "../src/hooks/useNebikiApp.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import { loadLocalAreaCountRecords } from "../src/domain/areaCountLocalStorage.ts";
import { HistoricalArchiveRepository, MemoryHistoricalArchiveAdapter, type HistoricalArchiveFailure } from "../src/domain/historicalArchive.ts";
import { initializeHistoricalArchiveRuntime } from "../src/domain/historicalArchiveRuntime.ts";
import { createNavigationSnapshot } from "../src/domain/navigationHistory.ts";
import { loadPendingSupabaseSyncQueue } from "../src/domain/supabaseSyncQueue.ts";
import * as storage from "../src/domain/storage.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import type { AppState, DemandCycle, DiscountTime, UseNebikiAppResult } from "../src/domain/types.ts";

// Complete production hook and real actions/effects with deterministic React
// scheduling and in-memory persistence. Production Edge paint/IDB is separate.
process.env.TZ = "Asia/Tokyo";
const NativeDate = Date;
const DATE = "2026-09-08";
let nowMs = new NativeDate(`${DATE}T17:05:00+09:00`).getTime();
class FixtureDate extends NativeDate {
  constructor(value?: string | number | Date) { super(value === undefined ? nowMs : value); }
  static now() { return nowMs; }
}
Object.defineProperty(globalThis, "Date", { configurable: true, value: FixtureDate });
class MemoryStorage implements Storage {
  values = new Map<string, string>();
  writes: string[] = [];
  removals: string[] = [];
  failWrites = new Set<string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.writes.push(key);
    if (this.failWrites.has(key)) throw Object.assign(new Error("Injected quota"), {name:"QuotaExceededError"});
    this.values.set(key, String(value));
  }
  removeItem(key: string) { this.removals.push(key); this.values.delete(key); }
  clear() { this.values.clear(); this.writes=[]; this.removals=[]; this.failWrites.clear(); }
}
const memory = new MemoryStorage();
const intervals = new Map<number, () => void>();
let timerId = 0;
const events = { addEventListener() {}, removeEventListener() {} };
let allowRetirementFailureAlert = false;
const retirementFailureAlerts: string[] = [];
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
Object.defineProperty(globalThis, "document", { configurable: true, value: { ...events, hidden: false } });
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  ...events,
  setInterval(callback: () => void) { const id = ++timerId; intervals.set(id, callback); return id; },
  clearInterval(id: number) { intervals.delete(id); },
  setTimeout() { return ++timerId; }, clearTimeout() {}, confirm() { return true; },
  alert(message: string) {
    if (allowRetirementFailureAlert && message.startsWith("旧夜枠の記録を退避できませんでした。")) { retirementFailureAlerts.push(message); return; }
    throw new Error(`Unexpected operational alert: ${message}`);
  },
} });
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const sameDeps = (left?: readonly unknown[], right?: readonly unknown[]) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
class HookFixture {
  includeRetiredPreservationEffect = false;
  effectRuns = { daily:0, appState:0, runtime:0, retiredPreservation:0 };
  slots: Slot[] = []; index = 0; dirty = false;
  effects: { callback: () => void | (() => void); slot: Slot }[] = [];
  app!: UseNebikiAppResult;
  next() { return this.slots[this.index++] ??= {}; }
  dispatcher = {
    useRef: <T>(initial: T) => { const slot = this.next(); if (!("value" in slot)) slot.value = { current: initial }; return slot.value as { current: T }; },
    useState: <T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] => {
      const slot = this.next(); if (!("value" in slot)) slot.value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slot.value as T, value => { const next = typeof value === "function" ? (value as (previous: T) => T)(slot.value as T) : value; if (!Object.is(next, slot.value)) { slot.value = next; this.dirty = true; } }];
    },
    useMemo: <T>(callback: () => T, deps: readonly unknown[]) => { const slot = this.next(); if (!("value" in slot) || !sameDeps(slot.deps, deps)) { slot.value = callback(); slot.deps = deps; } return slot.value as T; },
    useCallback: <T>(callback: T, deps: readonly unknown[]) => this.dispatcher.useMemo(() => callback, deps),
    useEffect: (callback: () => void | (() => void), deps?: readonly unknown[]) => { const slot = this.next(); if (!sameDeps(slot.deps, deps)) { slot.deps = deps; this.effects.push({ callback, slot }); } },
  };
  render() {
    this.index = 0; this.dirty = false; this.effects = [];
    const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown };
    const previous = internals.H; internals.H = this.dispatcher;
    try { this.app = runProductionHook(); } finally { internals.H = previous; }
  }
  settle(force = false) {
    if (force || this.dirty || !this.app) this.render();
    for (let pass = 0; pass < 15; pass++) {
      for (const { callback, slot } of this.effects) {
        // These real synchronous effects persist current/checkpoint/runtime,
        // clock and history. Async archive/network hydration is browser scope.
        const text=String(callback);
        const retirementEffect=this.includeRetiredPreservationEffect && /void preserveRetiredNightOperations\(\)/.test(text);
        if (!retirementEffect && !/app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|areaCompletionStateRef\.current|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|startAlignedRuntimeClock|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)|earlyNextMinus5TargetDiscountTime/.test(text)) continue;
        if (/daily-session-completion/.test(text)) this.effectRuns.daily++;
        if (/app-state-effect/.test(text)) this.effectRuns.appState++;
        if (/runtime-state-effect/.test(text)) this.effectRuns.runtime++;
        if (retirementEffect) this.effectRuns.retiredPreservation++;
        slot.cleanup?.(); const cleanup = callback(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      }
      if (!this.dirty) return;
      this.render();
    }
    assert.fail("synchronous production effects converge");
  }
  close() { this.slots.forEach(slot => slot.cleanup?.()); }
}
function state(time: DiscountTime, cycle: DemandCycle): AppState {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const value of Object.values(hourlyForecasts)) Object.assign(value, { weather: "sunny", tempC: 25, windMs: 2 });
  // Deliberately different18 forecasts expose accidental early18 weather use.
  hourlyForecasts["18"] = { weather: "snow", tempC: 10, windMs: 8 };
  const session = { ...getCurrentDataVersionInfo(), date: DATE, weekday: 2, discountTime: time, demandCycle: cycle,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false, globalDiscountAdjustmentPercent: 0,
    weather: { hourlyForecasts, afterRainSky: null }, startedAt: `${DATE}T${time === "15" ? "06" : "08"}:00:00.000Z` };
  const value = createInitialState(session);
  value.session = session; value.screen = "rate_display"; value.currentAreaId = "bento_men";
  Object.assign(value.areaProgressMap.bento_men, { areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaCountEvaluationSource: "manual", areaRateAdjustment: 0 });
  return value;
}
function fixture(raw: AppState, clock: string, runtime?: unknown) {
  nowMs = new NativeDate(`${DATE}T${clock}+09:00`).getTime(); memory.clear();
  memory.setItem(storage.STORAGE_KEYS.currentSession, JSON.stringify(raw));
  memory.setItem(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(raw));
  if (runtime) memory.setItem(storage.STORAGE_KEYS.runtimeState, JSON.stringify(runtime));
  const hook = new HookFixture(); hook.settle(true); return hook;
}
let passed = 0;
function test(name: string, run: () => void) { run(); passed += 1; console.log(`PASS ${passed}: ${name}`); }
for (const cycle of ["normal", "summer"] as const) {
  for (const [time, clock, bonus] of [["15", "15:59:59", 0], ["15", "16:00:00", 5], ["15", "16:39:59", 5], ["17", "17:59:59", 0], ["17", "18:00:00", 5], ["17", "18:54:59", 5]] as const) {
    test(`${cycle}/${time}/${clock}: actual display-completion keeps source time and late+${bonus}`, () => {
      const hook = fixture(state(time, cycle), clock);
      const shown = structuredClone(hook.app.derived.rateDisplay);
      assert.ok(shown);
      assert.equal(hook.app.state.session?.discountTime, time);
      assert.equal(hook.app.derived.doneNextSessionInfo?.targetDiscountTime, time === "15" ? "17" : undefined);
      hook.app.actions.goToNextArea(); hook.settle();
      const progress = hook.app.state.areaProgressMap.bento_men, snapshot = progress.rateDecisionSnapshot;
      assert.ok(snapshot);
      assert.equal(progress.completedNormalRateText, shown.normal.main);
      assert.equal(progress.completedManyRateText, shown.many.main);
      assert.equal(snapshot.sessionDiscountTime, time);
      assert.equal(snapshot.effectiveRateDiscountTime, time);
      assert.equal(snapshot.lateTimeAdjustmentPercent, bonus);
      assert.equal(snapshot.earlyNextAdjustmentPercent, 0);
      assert.equal(snapshot.calculationMode, bonus ? "late_plus5" : "normal");
      assert.equal(progress.earlyNextMinus5TargetDiscountTime, undefined);
      assert.deepEqual(storage.loadNextSessionSkipRecords(), []);
      const saved = structuredClone(progress);
      hook.close();
      const restored = new HookFixture(); restored.settle(true);
      assert.deepEqual(restored.app.state.areaProgressMap.bento_men, saved, "confirmed rates survive current/checkpoint reload");
      assert.deepEqual(storage.loadNextSessionSkipRecords(), []);
      restored.close();
    });
  }
}
test("actual17 Done next action cannot create night draft, state, snapshot or skip reservation", () => {
  const raw = state("17", "normal"); raw.screen = "done";
  const hook = fixture(raw, "18:54:59"), before = JSON.stringify(hook.app.state), stored = new Map(memory.values);
  hook.app.actions.startNextDoneSession(); hook.settle();
  assert.equal(JSON.stringify(hook.app.state), before);
  assert.deepEqual(memory.values, stored);
  assert.equal(hook.app.derived.doneNextSessionInfo, null);
  assert.deepEqual(storage.loadNextSessionSkipRecords(), []);
  hook.close();
});
let retainedRetirementOriginals: { keys: string[]; before: Array<string | null> } | null = null;
test("actual reset action retains current/checkpoint/runtime originals while night retirement is pending", () => {
  const raw = state("18", "normal");
  const navigation = { state: raw, areaJudgeSelection: "normal", resumeTargetScreen: null, nextSessionSkipRecords: [], lastSessionWeather: null };
  const runtime = { areaJudgeSelection: "normal", resumeTargetScreen: null, timeSwitchTarget: "18", undoSnapshot: navigation, screenHistory: [navigation] };
  const hook = fixture(raw, "18:54:00", runtime);
  const keys = [storage.STORAGE_KEYS.currentSession, storage.STORAGE_KEYS.workSessionCheckpoint, storage.STORAGE_KEYS.runtimeState];
  const before = keys.map(key => memory.getItem(key));
  retainedRetirementOriginals = { keys, before };
  allowRetirementFailureAlert = true;
  assert.equal(hook.app.state.screen, "start", "legacy night UI is isolated before archive work");
  hook.app.actions.resetApp(); hook.settle();
  assert.deepEqual(keys.map(key => memory.getItem(key)), before, "no reset/cleanup/effect may delete or replace unique pending evidence");
  assert.equal(hook.app.state.screen, "start");
  assert.equal(hook.app.derived.doneNextSessionInfo, null);
  hook.close();
});
await new Promise<void>(resolve => setTimeout(resolve, 0));
assert.equal(retirementFailureAlerts.length, 1, "missing IndexedDB reports a single expected retention failure");
assert.ok(retainedRetirementOriginals);
const retained = retainedRetirementOriginals as { keys: string[]; before: Array<string | null> };
assert.deepEqual(retained.keys.map(key => memory.getItem(key)), retained.before, "asynchronous failed retirement leaves originals intact");
assert.equal(passed, 14);
console.log(`Daytime operation49 existing full-hook: ${passed}/14 PASS`);

// The real repository is initialized against memory; only its write boundary is
// fault-injected below. Each case runs the production retirement effect and the
// same synchronous storage effects as the original cases.
memory.clear();
await initializeHistoricalArchiveRuntime({repository:new HistoricalArchiveRepository(new MemoryHistoricalArchiveAdapter()),storage:memory});
const originalArchiveWrite=HistoricalArchiveRepository.prototype.upsertDailySessionSnapshots;
const originalAlert=window.alert;
const failedArchiveWrite:HistoricalArchiveFailure={ok:false,operation:"write",errorName:"InjectedIndexedDbWriteFailure",message:"Injected failure"};
const flush=async()=>{for(let step=0;step<12;step++)await Promise.resolve();};
function doneState(time:"15"|"17"):AppState {
  const raw=state(time,"normal");raw.screen="done";raw.currentAreaId=null;
  for(const progress of Object.values(raw.areaProgressMap))Object.assign(progress,{status:"completed",areaJudge:"normal",areaCount:12,
    areaCountEvaluation:"normal",areaCountEvaluationSource:"manual",areaRateAdjustment:0,measurementStatus:"measured",
    completedAt:`${DATE}T08:04:00.000Z`,completedRateText:"10%",completedNormalRateText:"10%",completedManyRateText:"20%"});
  return raw;
}
function protectedDoneFixture(time:"15"|"17") {
  nowMs=new NativeDate(`${DATE}T17:05:00+09:00`).getTime();memory.clear();
  const current=doneState(time),checkpoint=structuredClone(current);
  checkpoint.areaProgressMap.bento_men.areaCount=13;
  const undo=state("18","normal"),history=state("19","normal");
  undo.areaProgressMap.bento_men.areaCount=111;undo.areaProgressMap.bento_men.completedRateText="31%";
  history.areaProgressMap.bento_men.areaCount=222;history.areaProgressMap.bento_men.completedRateText="47%";
  const navigation=(source:AppState)=>createNavigationSnapshot({state:source,areaJudgeSelection:null,resumeTargetScreen:null,nextSessionSkipRecords:[],lastSessionWeather:null});
  memory.setItem(storage.STORAGE_KEYS.currentSession,JSON.stringify(current));
  memory.setItem(storage.STORAGE_KEYS.workSessionCheckpoint,JSON.stringify(checkpoint));
  memory.setItem(storage.STORAGE_KEYS.runtimeState,JSON.stringify({areaJudgeSelection:null,resumeTargetScreen:null,timeSwitchTarget:null,
    undoSnapshot:navigation(undo),screenHistory:[navigation(history)],weatherConfirmationPending:null}));
  const originals=new Map([storage.STORAGE_KEYS.currentSession,storage.STORAGE_KEYS.workSessionCheckpoint,storage.STORAGE_KEYS.runtimeState]
    .map(key=>[key,memory.getItem(key)]));
  memory.writes=[];memory.removals=[];
  // A missed daily guard would enter quota cleanup and risk the unique runtime.
  memory.failWrites.add(storage.STORAGE_KEYS.dailySessionSnapshots);
  const hook=new HookFixture();hook.includeRetiredPreservationEffect=true;
  return {hook,originals,current};
}
let guardPassed=0;
try {
  for(const time of ["15","17"] as const)for(const mode of ["failed","pending"] as const){
    let releasePending:((failure:HistoricalArchiveFailure)=>void)|null=null;
    let archiveWrites=0;
    const alerts:string[]=[];
    window.alert=(message:string)=>{alerts.push(message);};
    HistoricalArchiveRepository.prototype.upsertDailySessionSnapshots=async()=>{
      archiveWrites++;
      return mode==="failed"?failedArchiveWrite:await new Promise<HistoricalArchiveFailure>(resolve=>{releasePending=resolve;});
    };
    const {hook,originals,current}=protectedDoneFixture(time);
    const currentBefore=JSON.stringify(current);
    const assertProtected=()=>{
      for(const [key,raw]of originals)assert.equal(memory.getItem(key),raw,`${time}/${mode}: original ${key} bytes remain authoritative`);
      assert.equal(memory.writes.filter(key=>originals.has(key)).length,0,"pending evidence is never rewritten by runtime/current/checkpoint effects");
      assert.equal(memory.writes.filter(key=>key===storage.STORAGE_KEYS.dailySessionSnapshots).length,0,"daily completion never enters a quota write");
      assert.equal(memory.removals.filter(key=>originals.has(key)).length,0,"aux cleanup cannot remove a unique recovery copy");
      assert.equal(JSON.stringify(current),currentBefore,"fixture source is unchanged");
    };
    try {
      hook.settle(true);await flush();
      assert.equal(archiveWrites,1,"the actual retirement effect attempts original-evidence preservation");
      assert.ok(hook.effectRuns.retiredPreservation>0);assert.ok(hook.effectRuns.daily>0);
      assert.ok(hook.effectRuns.appState>0);assert.ok(hook.effectRuns.runtime>0);
      assert.equal(hook.app.state.screen,"done");assert.equal(hook.app.state.session?.discountTime,time);
      assert.equal(hook.app.derived.canStartReview19Manually,false);
      assertProtected();
      const beforeActions=JSON.stringify(hook.app.state);
      hook.app.actions.resetApp();hook.settle();await flush();assertProtected();
      assert.equal(JSON.stringify(hook.app.state),beforeActions,"reset waits for archive verification");
      hook.app.actions.startNextDoneSession();hook.settle();await flush();assertProtected();
      assert.equal(JSON.stringify(hook.app.state),beforeActions,"next session waits for archive verification");
      hook.app.actions.startSession();hook.settle();await flush();assertProtected();
      assert.equal(JSON.stringify(hook.app.state),beforeActions,"start waits for archive verification");
      await hook.app.actions.saveReview19();hook.settle();await flush();assertProtected();
      assert.equal(JSON.stringify(hook.app.state),beforeActions,"Review19 save waits for archive verification");
      const synced=await hook.app.actions.syncLocalDataToSupabase();hook.settle();await flush();assertProtected();
      assert.equal(synced.allSynced,false);assert.equal(synced.failedCount,1);
      assert.equal(JSON.stringify(hook.app.state),beforeActions,"sync does not retire original recovery copies");
      // Correction can select a daytime observation, but the local-first count
      // boundary cannot commit it while original night evidence is unverified.
      hook.app.actions.startAreaCountCorrection("bento_men");hook.settle();assertProtected();
      assert.equal(hook.app.state.screen,"area_judge");
      const beforeCount=JSON.stringify(hook.app.state),recordsBefore=JSON.stringify(loadLocalAreaCountRecords()),pendingBefore=JSON.stringify(loadPendingSupabaseSyncQueue());
      await hook.app.actions.judgeCurrentArea("normal",123,"many");hook.settle();await flush();assertProtected();
      assert.equal(JSON.stringify(hook.app.state),beforeCount,"blocked AreaCount confirmation preserves the adopted observation state");
      assert.equal(JSON.stringify(loadLocalAreaCountRecords()),recordsBefore,"blocked AreaCount confirmation creates no local record");
      assert.equal(JSON.stringify(loadPendingSupabaseSyncQueue()),pendingBefore,"blocked AreaCount confirmation creates no pending record");
      if(mode==="pending"){
        assert.equal(archiveWrites,1,"concurrent retries share the still-pending archive operation");
        assert.equal(alerts.length,0,"an unresolved archive operation is still pending");
      }else{
        assert.ok(archiveWrites>=5,"failure guards retry the preservation boundary before allowing destructive actions");
        assert.equal(alerts.length,1,"repeated preservation failures emit one actionable notice");
      }
      guardPassed++;console.log(`PASS pending guard ${guardPassed}: ${time} Done + unique night runtime/${mode}`);
    }finally{
      if(releasePending){const resolve=releasePending as (failure:HistoricalArchiveFailure)=>void;resolve(failedArchiveWrite);await flush();assertProtected();}
      hook.close();
    }
  }
}finally{
  HistoricalArchiveRepository.prototype.upsertDailySessionSnapshots=originalArchiveWrite;
  window.alert=originalAlert;
  memory.failWrites.clear();
  Object.defineProperty(globalThis,"Date",{configurable:true,value:NativeDate});
}
assert.equal(guardPassed,4);
console.log(`Daytime operation49 full-hook: ${passed+guardPassed}/18 PASS (14 existing + 4 original-preservation guards)`);
