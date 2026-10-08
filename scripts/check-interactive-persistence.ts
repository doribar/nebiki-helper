import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppState, SessionDraft } from "../src/domain/types.ts";
import type { NavigationSnapshot } from "../src/domain/navigationHistory.ts";
import type { UseNebikiAppResult } from "../src/domain/types.ts";

// Execute the complete production hook and its real actions/effect callbacks.
// This deterministic dispatcher controls React scheduling only. Browser/IDB
// hydration and paint are covered separately by the production Edge suite.
const projectRoot = resolve(process.env.PERSISTENCE_PROJECT_ROOT ?? import.meta.dirname + "/..");
const load = (path: string) => import(pathToFileURL(resolve(projectRoot, path)).href);
const [{ default: React }, { useNebikiApp: runProductionHook }, navigation, storage, normalization, weather, rateSnapshots] = await Promise.all([
  load("node_modules/react/index.js"), load("src/hooks/useNebikiApp.ts"),
  load("src/domain/navigationHistory.ts"), load("src/domain/storage.ts"),
  load("src/hooks/nebikiApp/stateNormalization.ts"), load("src/domain/hourlyWeather.ts"),
  load("src/domain/rateDecisionSnapshot.ts"),
]);
process.env.TZ = "Asia/Tokyo";
const NativeDate = Date;
let fixedMs = new NativeDate("2026-10-01T17:05:00+09:00").getTime();
class FixtureDate extends NativeDate {
  constructor(value?: string | number | Date) { super(value === undefined ? fixedMs : value); }
  static now() { return fixedMs; }
}
Object.defineProperty(globalThis, "Date", { configurable: true, value: FixtureDate });

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  reads: string[] = [];
  writes: string[] = [];
  failures = new Map<string, number>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { this.reads.push(key); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.writes.push(key);
    const count = this.failures.get(key) ?? 0;
    if (count) {
      this.failures.set(key, count - 1);
      const error = new Error("Synthetic quota"); error.name = "QuotaExceededError"; throw error;
    }
    this.values.set(key, String(value));
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); this.reads = []; this.writes = []; this.failures.clear(); }
}
const memory = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
const intervals = new Map<number, () => void>();
const listeners = new Map<string, Set<() => void>>();
let timerId = 0;
const events = {
  addEventListener(name: string, callback: () => void) {
    const callbacks = listeners.get(name) ?? new Set<() => void>(); callbacks.add(callback); listeners.set(name, callbacks);
  },
  removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); },
};
Object.defineProperty(globalThis, "document", { configurable: true, value: { ...events, hidden: false } });
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  ...events,
  setInterval(callback: () => void) { const id = ++timerId; intervals.set(id, callback); return id; },
  clearInterval(id: number) { intervals.delete(id); },
  setTimeout() { return ++timerId; }, clearTimeout() {},
  confirm() { return true; }, alert(message: string) { throw new Error(message); },
} });

type Slot = { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void };
const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
class HookFixture {
  private params?: { testNow?: Date | null };
  constructor(params?: { testNow?: Date | null }) { this.params = params; }
  slots: Slot[] = []; index = 0; dirty = false; renderCount = 0;
  effects: { callback: () => void | (() => void); slot: Slot }[] = [];
  memoPreparations = { areaCount: 0, review19: 0 };
  app!: UseNebikiAppResult;
  dispatcher = {
    useRef: <T>(initial: T) => {
      const slot = this.next(); if (!("value" in slot)) slot.value = { current: initial };
      return slot.value as { current: T };
    },
    useState: <T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] => {
      const slot = this.next();
      if (!("value" in slot)) slot.value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slot.value as T, (value) => {
        const next = typeof value === "function" ? (value as (previous: T) => T)(slot.value as T) : value;
        if (!Object.is(next, slot.value)) { slot.value = next; this.dirty = true; }
      }];
    },
    useMemo: <T>(callback: () => T, dependencies: readonly unknown[]) => {
      const slot = this.next();
      if (!("value" in slot) || !sameDeps(slot.dependencies, dependencies)) {
        const text = String(callback);
        if (text.includes("prepareAreaCountCalculationPopulation")) this.memoPreparations.areaCount++;
        if (text.includes("prepareReview19HistoryPopulation")) this.memoPreparations.review19++;
        slot.value = callback(); slot.dependencies = dependencies;
      }
      return slot.value as T;
    },
    useCallback: <T>(callback: T, dependencies: readonly unknown[]) => this.dispatcher.useMemo(() => callback, dependencies),
    useEffect: (callback: () => void | (() => void), dependencies?: readonly unknown[]) => {
      const slot = this.next();
      if (!sameDeps(slot.dependencies, dependencies)) {
        slot.dependencies = dependencies; this.effects.push({ callback, slot });
      }
    },
  };
  next() { const index = this.index++; return this.slots[index] ?? (this.slots[index] = {}); }
  render() {
    this.renderCount++;
    this.index = 0; this.dirty = false; this.effects = [];
    // useState/useMemo above are called by the actual imported React functions.
    const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown };
    const previous = internals.H; internals.H = this.dispatcher;
    try { this.app = runProductionHook(this.params); } finally { internals.H = previous; }
  }
  settle(forceRender = false) {
    if (forceRender || this.dirty || !this.app) this.render();
    for (let passes = 0; passes < 15; passes++) {
      for (const { callback, slot } of this.effects) {
        const text = String(callback);
        // Keep unrelated network/archive async effects outside this fixture;
        // all synchronous persistence/navigation/draft effects execute verbatim.
        if (!/app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|setInterval\(updateNow|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)/.test(text)) continue;
        slot.cleanup?.(); const cleanup = callback(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      }
      if (!this.dirty) return;
      this.render();
    }
    assert.fail("synchronous hook effects settle within 15 passes");
  }
  close() { this.slots.forEach(slot => slot.cleanup?.()); }
}

function initial(active = false): AppState {
  const draft: SessionDraft = {
    date: "2026-10-01", weekday: 4, discountTime: "17", demandCycle: "normal",
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: weather.createDefaultHourlyForecasts(), afterRainSky: null },
  };
  for (const forecast of Object.values(draft.weather.hourlyForecasts)) Object.assign(forecast, { weather: "sunny", tempC: 24, windMs: 2 });
  const state = normalization.createInitialState(draft) as AppState;
  if (active) state.session = { ...draft, startedAt: "2026-10-01T08:00:00.000Z", appVersion: "2026.8.9-37", dataSchemaVersion: 3, buildId: "synthetic-persistence-regression" };
  return state;
}
function fixture(options: {
  active?: boolean; historyCount?: number; checkpointOnly?: boolean; undo?: boolean; done?: boolean;
  rawState?: AppState; pendingWeather?: { date: string; discountTime: SessionDraft["discountTime"] };
} = {}) {
  memory.clear(); const state = options.rawState ?? initial(options.active);
  if (options.done) {
    state.screen="done";state.currentAreaId=null;
    for(const progress of Object.values(state.areaProgressMap))Object.assign(progress,{status:"completed",areaJudge:"normal",areaCount:12,
      areaRateAdjustment:0,areaCountEvaluation:"normal",areaCountEvaluationSource:"manual",measurementStatus:"measured",completedAt:"2026-10-01T08:04:00.000Z"});
  }
  const snapshot: NavigationSnapshot = navigation.createNavigationSnapshot({ state, areaJudgeSelection: null,
    resumeTargetScreen: null, nextSessionSkipRecords: [], lastSessionWeather: null });
  if (!options.checkpointOnly) memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(state));
  if (options.active) memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(state));
  memory.values.set(storage.STORAGE_KEYS.runtimeState, JSON.stringify({areaJudgeSelection:null,resumeTargetScreen:null,timeSwitchTarget:null,
    undoSnapshot:options.undo ? snapshot : null,screenHistory:Array.from({length:options.historyCount??0},()=>snapshot),weatherConfirmationPending:options.pendingWeather??null}));
  const hook = new HookFixture(); hook.settle(true); return hook;
}
const stringify = JSON.stringify, parse = JSON.parse;
function stateClones(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if ("sessionDraft" in value && "areaProgressMap" in value && "screen" in value) return 1;
  return Object.values(value).reduce<number>((count, item) => count + stateClones(item), 0);
}
function measure(action: () => void) {
  memory.reads = []; memory.writes = [];
  const counts = { stringify: 0, parse: 0, fullAppStateDeepClones: 0, localStorageReads: 0, localStorageWrites: 0, runtimeWrites: 0, currentWrites: 0, checkpointWrites: 0, historyClonePayloads: 0 };
  JSON.stringify = ((value: unknown, ...args: unknown[]) => { counts.stringify++; return Reflect.apply(stringify, JSON, [value, ...args]); }) as typeof JSON.stringify;
  JSON.parse = ((value: string, ...args: unknown[]) => {
    counts.parse++; const out: unknown = Reflect.apply(parse, JSON, [value, ...args]); const states = stateClones(out);
    counts.fullAppStateDeepClones += states;
    if (Array.isArray(out) || (out && typeof out === "object" && "state" in out)) counts.historyClonePayloads += states;
    return out;
  }) as typeof JSON.parse;
  try { action(); } finally { JSON.stringify = stringify; JSON.parse = parse; }
  counts.localStorageReads = memory.reads.length; counts.localStorageWrites = memory.writes.length;
  counts.runtimeWrites = memory.writes.filter(key => key === storage.STORAGE_KEYS.runtimeState).length;
  counts.currentWrites = memory.writes.filter(key => key === storage.STORAGE_KEYS.currentSession).length;
  counts.checkpointWrites = memory.writes.filter(key => key === storage.STORAGE_KEYS.workSessionCheckpoint).length;
  return counts;
}
function changeTemperature(hook: HookFixture, tempC: number) {
  const input = hook.app.state.sessionDraft.weather;
  hook.app.actions.updateSessionDraft({weather:{...input,hourlyForecasts:{...input.hourlyForecasts,"18":{...input.hourlyForecasts["18"],tempC}}}});
  hook.settle();
}
const results: { name: string; ok: boolean; evidence?: unknown; error?: string }[] = [];
function test(name: string, run: () => unknown) {
  try { const evidence = run(); results.push({name,ok:true,evidence}); console.log("PASS:",name); }
  catch(error) { results.push({name,ok:false,error:String(error)}); console.error("FAIL:",name,String(error)); }
}

test("fresh weather and continuous temperature edits persist immediately without runtime/history work", () => {
  const hook=fixture(); const evidence=[];
  for(const tempC of [2,25,26]) {
    const counts=measure(()=>changeTemperature(hook,tempC)); evidence.push(counts);
    assert.equal(counts.runtimeWrites,0); assert.equal(counts.historyClonePayloads,0);
    assert.equal(counts.fullAppStateDeepClones,1,"one isolated snapshot for the changed AppState");
    assert.equal(counts.currentWrites,1,"the auxiliary draft commit does not rewrite current session");
    assert.equal(storage.loadCurrentSession().sessionDraft.weather.hourlyForecasts["18"].tempC,tempC);
    assert.ok(!memory.reads.includes(storage.STORAGE_KEYS.review19Records));
  }
  hook.close(); return evidence;
});
test("24 history entries keep runtime bytes unchanged during weather edits", () => {
  const hook=fixture({active:true,historyCount:24}); const before=memory.values.get(storage.STORAGE_KEYS.runtimeState);
  const counts=measure(()=>changeTemperature(hook,27));
  assert.equal(counts.runtimeWrites,0); assert.equal(counts.historyClonePayloads,0);
  assert.equal(memory.values.get(storage.STORAGE_KEYS.runtimeState),before);
  assert.equal(memory.values.get(storage.STORAGE_KEYS.currentSession),memory.values.get(storage.STORAGE_KEYS.workSessionCheckpoint));
  hook.close(); return counts;
});
test("render only and 30 second clock updates do not persist or rebuild histories", () => {
  const hook=fixture({active:true,historyCount:24}); const prepared={...hook.memoPreparations};
  const render=measure(()=>hook.settle(true));
  assert.equal(render.localStorageWrites,0); assert.equal(render.historyClonePayloads,0);
  const clock=measure(()=>{fixedMs+=30000;for(const callback of intervals.values())callback();hook.settle();});
  assert.equal(clock.localStorageWrites,0);assert.equal(clock.historyClonePayloads,0);assert.deepEqual(hook.memoPreparations,prepared);
  hook.close(); return {render,clock};
});
test("real hook weather confirmation, next, back, undo and reload retain observation values", () => {
  const hook=fixture();changeTemperature(hook,28);
  hook.app.actions.requestWeatherConfirmation();hook.settle();
  hook.app.actions.confirmWeatherInput();hook.settle();
  assert.ok(hook.app.state.session);assert.equal(hook.app.state.screen,"advance_discount");
  const runtime=storage.loadRuntimeState();assert.equal(runtime.screenHistory.length,1);
  hook.app.actions.goBackOneScreen();hook.settle();assert.equal(hook.app.state.screen,"start");
  assert.equal(hook.app.state.sessionDraft.weather.hourlyForecasts["18"].tempC,28);
  hook.close();const reload=new HookFixture();reload.settle(true);
  assert.equal(reload.app.state.sessionDraft.weather.hourlyForecasts["18"].tempC,28);reload.close();
  const undo=fixture({active:true,undo:true});changeTemperature(undo,29);undo.app.actions.undoLastAction();undo.settle();
  assert.equal(undo.app.state.sessionDraft.weather.hourlyForecasts["18"].tempC,24);undo.close();
});
test("checkpoint alone resumes current business session after crash", () => {
  const hook=fixture({active:true,checkpointOnly:true});assert.ok(hook.app.state.session);
  assert.equal(hook.app.state.session.startedAt,"2026-10-01T08:00:00.000Z");changeTemperature(hook,30);
  hook.close();memory.values.delete(storage.STORAGE_KEYS.currentSession);
  const recovery=new HookFixture();recovery.settle(true);
  assert.equal(recovery.app.state.sessionDraft.weather.hourlyForecasts["18"].tempC,30);recovery.close();
});
test("October normal operation lock settles and remains quiet on later renders", () => {
  const hook=fixture({active:true});assert.ok(hook.renderCount<=3,"season and operation lock effects do not alternate");
  const counts=measure(()=>hook.settle(true));assert.equal(counts.localStorageWrites,0);assert.equal(counts.localStorageReads,0);
  const renders=hook.renderCount;hook.close();return {renders,counts};
});
test("a storage event refreshes history views once and later renders use the refreshed memory", () => {
  const hook=fixture();const source=initial(true);source.screen="done";
  memory.values.set(storage.STORAGE_KEYS.review19SourceState,JSON.stringify(source));
  const event={key:storage.STORAGE_KEYS.review19SourceState,storageArea:memory};
  measure(()=>{for(const callback of listeners.get("storage")??[])(callback as (event:unknown)=>void)(event);hook.settle();});
  assert.ok(memory.reads.includes(storage.STORAGE_KEYS.review19SourceState),"changed source is reread");
  const stable=measure(()=>hook.settle(true));assert.equal(stable.localStorageReads,0);assert.equal(stable.localStorageWrites,0);
  hook.close();return stable;
});
test("Done journal writes settle without repeated history invalidation and stay stable on clock updates", () => {
  const hook=fixture({active:true,done:true});assert.ok(hook.renderCount<=5,"completion cache refresh reaches a stable journal");
  const saved=storage.readRawDailySessionSnapshotJournal();assert.ok(saved);
  const snapshots=storage.loadDailySessionSnapshots();assert.equal(snapshots.length,1);
  assert.equal(snapshots[0].session.startedAt,"2026-10-01T08:00:00.000Z");
  const counts=measure(()=>{fixedMs+=30000;for(const callback of intervals.values())callback();hook.settle();});
  assert.equal(counts.currentWrites,0);assert.equal(counts.runtimeWrites,0);
  assert.equal(storage.readRawDailySessionSnapshotJournal(),saved,"clock updates keep confirmed completion bytes");
  const renders=hook.renderCount;hook.close();return {renders,counts};
});
test("navigation shares immutable retained entries and isolates only new/restored snapshots", () => {
  const state=initial(true);const original=navigation.createNavigationSnapshot({state,areaJudgeSelection:null,resumeTargetScreen:null,nextSessionSkipRecords:[],lastSessionWeather:null});
  const history=[original];
  assert.equal(navigation.appendNavigationHistory({history,previousSnapshot:original,nextState:state,suppressHistoryPush:false}).history,history);
  const next={...state,screen:"area_judge"};
  const appended=navigation.appendNavigationHistory({history,previousSnapshot:original,nextState:next,suppressHistoryPush:false});
  assert.equal(appended.history[0],original);assert.notEqual(appended.history[1],original);
  original.state.sessionDraft.weather.hourlyForecasts["18"].tempC=31;
  assert.equal(appended.history[1].state.sessionDraft.weather.hourlyForecasts["18"].tempC,24);
  const popped=navigation.popNavigationHistory(appended.history);assert.equal(popped.history[0],original);
  popped.previousSnapshot.state.sessionDraft.weather.hourlyForecasts["18"].tempC=32;
  assert.equal(appended.history[1].state.sessionDraft.weather.hourlyForecasts["18"].tempC,24);
});
test("one serialized normalized state is reused across current/checkpoint and quota retry", () => {
  memory.clear();const state=initial(true);state.session!.demandCycle="summer";state.sessionDraft.demandCycle="normal";
  const snapshot=normalization.clonePersistedNebikiStateSnapshot({currentSession:state,nextSessionSkipRecords:[],lastSessionWeather:null,lastUsedSessionDraft:state.sessionDraft,dailyMessageState:storage.normalizeDailyMessageState(null)});
  const serialized=JSON.stringify(snapshot.currentSession);memory.failures.set(storage.STORAGE_KEYS.currentSession,1);
  const counts=measure(()=>{
    const results=storage.savePersistedNebikiStateWithAuxiliaryRecovery(snapshot,{currentSessionSerialized:serialized});
    assert.equal(results.filter((result:{key:string})=>result.key===storage.STORAGE_KEYS.currentSession).length,2);
    assert.equal(storage.saveWorkSessionCheckpointSafely(snapshot.currentSession,serialized).ok,true);
  });
  assert.equal(memory.values.get(storage.STORAGE_KEYS.currentSession),serialized);
  assert.equal(memory.values.get(storage.STORAGE_KEYS.workSessionCheckpoint),serialized);
  assert.equal(storage.loadCurrentSession().sessionDraft.demandCycle,"summer");
  assert.equal(state.sessionDraft.demandCycle,"normal");
  assert.equal(counts.fullAppStateDeepClones,0);return counts;
});
test("unchanged current/checkpoint skip writes and missing or stale copies are recreated", () => {
  memory.clear();const state=initial(true);const serialized=JSON.stringify(state);
  storage.saveCurrentSession(state,serialized);storage.saveWorkSessionCheckpoint(state,serialized);
  const unchanged=measure(()=>{storage.saveCurrentSession(state,serialized);storage.saveWorkSessionCheckpoint(state,serialized);});
  assert.equal(unchanged.localStorageWrites,0);
  memory.values.delete(storage.STORAGE_KEYS.currentSession);memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint,"stale");
  const restored=measure(()=>{storage.saveCurrentSession(state,serialized);storage.saveWorkSessionCheckpoint(state,serialized);});
  assert.equal(restored.currentWrites,1);assert.equal(restored.checkpointWrites,1);
  assert.equal(memory.values.get(storage.STORAGE_KEYS.currentSession),serialized);assert.equal(memory.values.get(storage.STORAGE_KEYS.workSessionCheckpoint),serialized);
  return {unchanged,restored};
});
test("runtime serialization keeps the 24-entry cap and independent durable undo/history values", () => {
  memory.clear();const state=initial(true);const snapshot=navigation.createNavigationSnapshot({state,areaJudgeSelection:null,resumeTargetScreen:null,nextSessionSkipRecords:[],lastSessionWeather:null});
  const history=Array.from({length:30},(_,index)=>({...snapshot,state:{...state,finalTimeStep:index}}));
  const counts=measure(()=>storage.saveRuntimeState({areaJudgeSelection:null,resumeTargetScreen:null,timeSwitchTarget:null,
    undoSnapshot:snapshot,screenHistory:history,weatherConfirmationPending:{date:"2026-10-01",discountTime:"17"}}));
  assert.equal(counts.parse,0);assert.equal(counts.stringify,1);
  snapshot.state.sessionDraft.weather.hourlyForecasts["18"].tempC=33;
  const loaded=storage.loadRuntimeState();assert.equal(loaded.screenHistory.length,24);assert.equal(loaded.screenHistory[0].state.finalTimeStep,6);
  assert.equal(loaded.undoSnapshot.state.sessionDraft.weather.hourlyForecasts["18"].tempC,24);
  loaded.screenHistory[0].state.sessionDraft.weather.hourlyForecasts["18"].tempC=34;
  assert.equal(storage.loadRuntimeState().screenHistory[0].state.sessionDraft.weather.hourlyForecasts["18"].tempC,24);
  return counts;
});

test("legacy active 15/18/19 no-switch resumes preserve original time, identity and adopted progress", () => {
  fixedMs = new NativeDate("2026-10-01T17:05:00+09:00").getTime();
  const evidence = [];
  for (const time of ["15", "18", "19"] as const) {
    const saved = initial(true);
    saved.session!.discountTime = time; saved.session!.manualDiscountTimeOverride = true;
    saved.sessionDraft.discountTime = time; saved.sessionDraft.manualDiscountTimeOverride = true;
    saved.currentAreaId = "bento_men"; saved.screen = "start";
    Object.assign(saved.areaProgressMap.bento_men, { areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaCountEvaluationSource: "manual", areaRateAdjustment: 0 });
    const before = JSON.stringify(saved);
    const hook = fixture({ active: true, rawState: saved });
    assert.equal(hook.app.state.session?.discountTime, time);
    assert.equal(hook.app.state.sessionDraft.discountTime, time, "start screen draft follows the existing operation");
    assert.equal(hook.app.state.session?.manualDiscountTimeOverride, false);
    assert.equal(hook.app.state.sessionDraft.manualDiscountTimeOverride, false);
    const progress = JSON.stringify(hook.app.state.areaProgressMap);
    hook.app.actions.startSession(); hook.settle();
    assert.equal(hook.app.state.session?.discountTime, time);
    assert.equal(hook.app.state.session?.startedAt, saved.session!.startedAt);
    assert.equal(JSON.stringify(hook.app.state.areaProgressMap), progress);
    assert.equal(hook.app.state.session?.manualDiscountTimeOverride, false);
    assert.equal(JSON.stringify(saved), before);
    evidence.push({ originalTime: time, resumedTime: hook.app.state.session?.discountTime, startedAt: hook.app.state.session?.startedAt, count: hook.app.state.areaProgressMap.bento_men.areaCount });
    hook.close();
  }
  return evidence;
});

test("legacy pending weather cannot restore retired manual time or its mismatched confirmation", () => {
  fixedMs = new NativeDate("2026-10-01T17:05:00+09:00").getTime();
  const saved = initial(); saved.sessionDraft.discountTime = "15"; saved.sessionDraft.manualDiscountTimeOverride = true;
  const hook = fixture({ rawState: saved, pendingWeather: { date: saved.sessionDraft.date, discountTime: "15" } });
  assert.equal(hook.app.state.sessionDraft.discountTime, "17");
  assert.equal(hook.app.state.sessionDraft.manualDiscountTimeOverride, false);
  assert.equal(hook.app.derived.weatherConfirmationPending, false);
  assert.equal(hook.app.state.session, null);
  hook.close(); return { retiredDraftTime: "17", pendingWeather: false };
});

test("valid weather hold across 18:25 resumes its confirmation and starts at the held time", () => {
  fixedMs = new NativeDate("2026-10-01T18:25:00+09:00").getTime();
  const saved = initial(); saved.sessionDraft.weatherInputLockedDiscountTime = "17";
  const hook = fixture({ rawState: saved, pendingWeather: { date: saved.sessionDraft.date, discountTime: "17" } });
  assert.equal(hook.app.state.sessionDraft.discountTime, "17");
  assert.equal(hook.app.state.sessionDraft.weatherInputLockedDiscountTime, "17");
  assert.equal(hook.app.derived.weatherConfirmationPending, true);
  hook.app.actions.confirmWeatherInput(); hook.settle();
  assert.equal(hook.app.state.session?.discountTime, "17");
  assert.equal(hook.app.state.session?.manualDiscountTimeOverride, false);
  const resumedTime = hook.app.state.session?.discountTime; hook.close(); return { boundary: "18:25", resumedTime };
});

test("legacy undo restoration retires active manual time without rewriting the retained snapshot", () => {
  fixedMs = new NativeDate("2026-10-01T17:05:00+09:00").getTime();
  const saved = initial(true); saved.session!.manualDiscountTimeOverride = true; saved.sessionDraft.manualDiscountTimeOverride = true;
  saved.screen = "rate_display"; saved.currentAreaId = "bento_men";
  Object.assign(saved.areaProgressMap.bento_men, { areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaCountEvaluationSource: "manual", areaRateAdjustment: 0 });
  const before = JSON.stringify(saved);
  const hook = fixture({ active: true, rawState: saved, undo: true });
  const retained = storage.loadRuntimeState().undoSnapshot;
  assert.equal(retained.state.session.manualDiscountTimeOverride, true);
  const retainedBefore = JSON.stringify(retained);
  hook.app.actions.undoLastAction(); hook.settle();
  assert.equal(hook.app.state.session?.manualDiscountTimeOverride, false);
  assert.equal(hook.app.state.sessionDraft.manualDiscountTimeOverride, false);
  assert.equal(hook.app.state.session?.discountTime, "17");
  assert.equal(hook.app.state.session?.startedAt, saved.session!.startedAt);
  assert.equal(hook.app.state.areaProgressMap.bento_men.areaCount, 20);
  assert.equal(JSON.stringify(retained), retainedBefore);
  assert.equal(JSON.stringify(saved), before);
  hook.close(); return { retainedManualFlag: true, restoredManualFlag: false, count: 20 };
});

function legacyWeekdayState(active = false): AppState {
  const saved = initial(active);
  saved.sessionDraft.weekday = 2; saved.sessionDraft.manualWeekdayOverride = true;
  if (saved.session) { saved.session.weekday = 2; saved.session.manualWeekdayOverride = true; }
  return saved;
}
function assertAutomaticBusinessWeekday(hook: HookFixture, date: string, weekday: number) {
  assert.equal(hook.app.state.sessionDraft.date, date);
  assert.equal(hook.app.state.sessionDraft.weekday, weekday);
  assert.equal(hook.app.state.sessionDraft.manualWeekdayOverride, false);
  if (hook.app.state.session) {
    assert.equal(hook.app.state.session.date, date);
    assert.equal(hook.app.state.session.weekday, weekday);
    assert.equal(hook.app.state.session.manualWeekdayOverride, false);
  }
}

test("legacy weekday draft reload starts and saves the natural business weekday", () => {
  fixedMs = new NativeDate("2026-10-01T17:05:00+09:00").getTime();
  const saved = legacyWeekdayState(); const before = JSON.stringify(saved);
  const hook = fixture({ rawState: saved });
  assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
  assert.equal(hook.app.derived.weekdayText, "木曜日");
  hook.app.actions.startSession(); hook.settle();
  assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
  const persisted = storage.loadCurrentSession();
  assert.equal(persisted.session.weekday, 4); assert.equal(persisted.session.manualWeekdayOverride, false);
  assert.equal(hook.app.actions.getCurrentAreaCountRecommendation(20).actualWeekday, "木");
  assert.equal(JSON.stringify(saved), before);
  hook.close(); return { displayed: "木曜日", savedWeekday: 4, areaCountActualWeekday: "木" };
});

test("a valid legacy weekday weather confirmation reload starts with natural weekday and held time", () => {
  fixedMs = new NativeDate("2026-10-01T18:25:00+09:00").getTime();
  const saved = legacyWeekdayState(); saved.sessionDraft.weatherInputLockedDiscountTime = "17";
  const hook = fixture({ rawState: saved, pendingWeather: { date: "2026-10-01", discountTime: "17" } });
  assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
  assert.equal(hook.app.derived.weatherConfirmationPending, true);
  hook.app.actions.confirmWeatherInput(); hook.settle();
  assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
  assert.equal(hook.app.state.session?.discountTime, "17");
  hook.close(); return { weekday: 4, heldTime: "17", resumedConfirmation: true };
});

test("legacy Done re-entry retires weekday without changing its completed journal or count", () => {
  fixedMs = new NativeDate("2026-10-01T17:05:00+09:00").getTime();
  const hook = fixture({ active: true, done: true, rawState: legacyWeekdayState(true) });
  assert.equal(hook.app.state.session?.manualWeekdayOverride, true, "completed legacy source remains readable");
  const journal = storage.readRawDailySessionSnapshotJournal();
  const completed = JSON.stringify(hook.app.state.areaProgressMap.bento_men);
  hook.app.actions.startAreaCountCorrection("bento_men"); hook.settle();
  assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
  assert.equal(hook.app.state.screen, "area_judge");
  assert.equal(hook.app.state.areaProgressMap.bento_men.areaCount, 12);
  assert.equal(JSON.stringify(hook.app.state.areaProgressMap.bento_men), completed);
  assert.equal(storage.readRawDailySessionSnapshotJournal(), journal);
  hook.close(); return { completedCount: 12, completedJournalUnchanged: true, newOperationalWeekday: 4 };
});

test("legacy current and checkpoint weekday restore retain confirmed evaluation and completion snapshots", () => {
  fixedMs = new NativeDate("2026-10-01T17:05:00+09:00").getTime();
  const evidence = [];
  for (const checkpointOnly of [false, true]) {
    const saved = legacyWeekdayState(true); saved.screen = "rate_display"; saved.currentAreaId = "bento_men";
    Object.assign(saved.areaProgressMap.bento_men, {
      areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaCountEvaluationSource: "manual", areaRateAdjustment: 0,
      humanEvaluationDetails: { humanEvaluationScore9: 4, humanEvaluationScale: 9, humanEvaluationSelections: ["slightly_few", "normal"],
        resolvedEvaluation: "normal", resolutionDirection: "higher", resolutionReason: "normal_17_or_later", demandCycle: "normal", sessionDiscountTime: "17", evaluatedAt: "2026-10-01T07:58:00.000Z" },
    });
    const snapshot = rateSnapshots.buildNormalRateDecisionSnapshot({
      confirmedAt: "2026-10-01T08:02:00.000Z", sessionDiscountTime: "17", demandCycle: "normal", weekday: 2, date: "2026-10-01",
      weatherComfortAdjustmentPercent: 0, areaJudge: "normal", areaRateAdjustment: 0,
      resolvedWeather: weather.resolveWeatherInputForDiscount(saved.session!.weather, "17"),
    });
    Object.assign(saved.areaProgressMap.sushi, { status: "completed", areaCount: 12, areaJudge: "normal", areaCountEvaluation: "normal",
      areaCountEvaluationSource: "manual", areaRateAdjustment: 0, completedAt: "2026-10-01T08:02:00.000Z",
      completedRateText: "10%", completedNormalRateText: "10%", completedManyRateText: "20%", rateDecisionSnapshot: snapshot });
    const expected = normalization.normalizeLoadedState(saved, initial().sessionDraft).areaProgressMap;
    const hook = fixture({ active: true, checkpointOnly, rawState: saved });
    assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
    assert.equal(hook.app.state.session?.startedAt, saved.session?.startedAt);
    assert.equal(JSON.stringify(hook.app.state.areaProgressMap), JSON.stringify(expected));
    assert.equal(hook.app.state.areaProgressMap.bento_men.humanEvaluationDetails?.humanEvaluationScore9, 4);
    assert.equal(hook.app.state.areaProgressMap.bento_men.humanEvaluationDetails?.resolvedEvaluation, "normal");
    assert.equal(hook.app.state.areaProgressMap.bento_men.humanEvaluationDetails?.evaluatedAt, "2026-10-01T07:58:00.000Z");
    assert.deepEqual(hook.app.state.areaProgressMap.sushi.rateDecisionSnapshot, snapshot);
    const persisted = storage.loadWorkSessionCheckpoint();
    assert.equal(persisted.session.weekday, 4); assert.equal(persisted.session.manualWeekdayOverride, false);
    assert.deepEqual(persisted.areaProgressMap.sushi.rateDecisionSnapshot, snapshot);
    hook.close(); evidence.push({ checkpointOnly, preservedCount: 20, completedNormalRate: "10%", resolvedEvaluation: "normal" });
  }
  return evidence;
});

test("undo and back restore an automatic weekday while retained navigation metadata remains legacy", () => {
  fixedMs = new NativeDate("2026-10-01T17:05:00+09:00").getTime();
  const evidence = [];
  for (const operation of ["undo", "back"] as const) {
    const saved = legacyWeekdayState(true); saved.screen = "rate_display"; saved.currentAreaId = "bento_men";
    Object.assign(saved.areaProgressMap.bento_men, { areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaCountEvaluationSource: "manual", areaRateAdjustment: 0 });
    const hook = fixture({ active: true, rawState: saved, undo: operation === "undo", historyCount: operation === "back" ? 1 : 0 });
    const retained = operation === "undo" ? storage.loadRuntimeState().undoSnapshot : storage.loadRuntimeState().screenHistory[0];
    assert.equal(retained.state.session.manualWeekdayOverride, true);
    const before = JSON.stringify(retained);
    if (operation === "undo") hook.app.actions.undoLastAction(); else hook.app.actions.goBackOneScreen();
    hook.settle(); assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
    assert.equal(hook.app.state.areaProgressMap.bento_men.areaCount, 20);
    assert.equal(hook.app.state.session?.startedAt, saved.session?.startedAt);
    assert.equal(JSON.stringify(retained), before);
    hook.close(); evidence.push({ operation, retainedLegacyFlag: true, restoredFlag: false });
  }
  return evidence;
});

test("condition editing and no-switch resume preserve original session time, identity and automatic weekday", () => {
  fixedMs = new NativeDate("2026-10-01T17:05:00+09:00").getTime();
  for (const time of ["15", "17", "18", "19"] as const) {
    const saved = legacyWeekdayState(true); saved.session!.discountTime = time; saved.sessionDraft.discountTime = time;
    saved.screen = "rate_display"; saved.currentAreaId = "bento_men";
    Object.assign(saved.areaProgressMap.bento_men, { areaCount: 20, areaJudge: "normal", areaCountEvaluation: "normal", areaCountEvaluationSource: "manual", areaRateAdjustment: 0 });
    const hook = fixture({ active: true, rawState: saved });
    const progress = JSON.stringify(hook.app.state.areaProgressMap);
    hook.app.actions.startEditingConditions(); hook.settle();
    assert.equal(hook.app.state.screen, "start"); assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
    hook.app.actions.startSession(); hook.settle(); assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
    assert.equal(hook.app.state.session?.discountTime, time); assert.equal(hook.app.state.session?.startedAt, saved.session?.startedAt);
    assert.equal(JSON.stringify(hook.app.state.areaProgressMap), progress);
    hook.close();
  }
  return { sessionTimes: ["15", "17", "18", "19"], weekday: 4 };
});

test("an unstarted draft crosses midnight with new date/weekday and clears the old weather lock", () => {
  fixedMs = new NativeDate("2026-10-01T23:59:59+09:00").getTime();
  const saved = legacyWeekdayState(); saved.sessionDraft.weatherInputLockedDiscountTime = "17";
  const hook = fixture({ rawState: saved }); assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
  fixedMs = new NativeDate("2026-10-02T00:00:01+09:00").getTime();
  for (const callback of intervals.values()) callback(); hook.settle();
  assertAutomaticBusinessWeekday(hook, "2026-10-02", 5);
  assert.equal(hook.app.state.sessionDraft.weatherInputLockedDiscountTime, null);
  assert.equal(storage.loadCurrentSession().sessionDraft.weekday, 5);
  hook.close(); return { before: "2026-10-01 木", after: "2026-10-02 金", session: null };
});

test("an active session across midnight retains its business date and that day's weekday during condition editing", () => {
  fixedMs = new NativeDate("2026-10-01T23:59:59+09:00").getTime();
  const saved = legacyWeekdayState(true); saved.screen = "rate_display"; saved.currentAreaId = "bento_men";
  const hook = fixture({ active: true, rawState: saved });
  fixedMs = new NativeDate("2026-10-02T00:00:01+09:00").getTime();
  for (const callback of intervals.values()) callback(); hook.settle();
  assert.equal(hook.app.state.session?.date, "2026-10-01"); assert.equal(hook.app.state.session?.weekday, 4);
  hook.app.actions.startEditingConditions(); hook.settle();
  assertAutomaticBusinessWeekday(hook, "2026-10-01", 4);
  assert.equal(hook.app.derived.weekdayText, "木曜日");
  assert.equal(hook.app.state.session?.startedAt, saved.session?.startedAt);
  hook.app.actions.startSession(); hook.settle();
  assertAutomaticBusinessWeekday(hook, "2026-10-02", 5);
  assert.notEqual(hook.app.state.session?.startedAt, saved.session?.startedAt, "the existing date gate starts a fresh day instead of relabeling old work");
  hook.close(); return { businessDateWhileEditing: "2026-10-01", weekdayWhileEditing: 4, newlyStartedDate: "2026-10-02", newlyStartedWeekday: 5 };
});

test("old-day current and checkpoint reload still obey the existing date gate", () => {
  fixedMs = new NativeDate("2026-10-02T17:05:00+09:00").getTime();
  const saved = legacyWeekdayState(true); saved.screen = "rate_display"; saved.currentAreaId = "bento_men";
  const hook = fixture({ active: true, rawState: saved });
  assert.equal(hook.app.state.session, null, "an ordinary previous-day session is not resumed");
  assertAutomaticBusinessWeekday(hook, "2026-10-02", 5);
  assert.equal(storage.loadWorkSessionCheckpoint(), null);
  assert.equal(saved.session?.date, "2026-10-01"); assert.equal(saved.session?.manualWeekdayOverride, true);
  hook.close(); return { previousDayResumed: false, newDraftDate: "2026-10-02", naturalWeekday: 5 };
});

test("fixed clock starts with its calendar weekday and leaves production operational storage untouched", () => {
  fixedMs = new NativeDate("2026-10-01T17:05:00+09:00").getTime();
  memory.clear(); const saved = legacyWeekdayState(true);
  memory.values.set(storage.STORAGE_KEYS.currentSession, JSON.stringify(saved));
  memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint, JSON.stringify(saved));
  const before = new Map(memory.values);
  const hook = new HookFixture({ testNow: new Date("2026-11-03T17:05:00+09:00") }); hook.settle(true);
  assert.equal(hook.app.state.sessionDraft.date, "2026-11-03"); assert.equal(hook.app.state.sessionDraft.weekday, 2);
  hook.app.actions.startSession(); hook.settle();
  assert.equal(hook.app.state.session?.date, "2026-11-03"); assert.equal(hook.app.state.session?.weekday, 2);
  for (const [key, value] of before) assert.equal(memory.values.get(key), value);
  const productionKeys = new Set(Object.values(storage.STORAGE_KEYS));
  assert.equal(memory.writes.filter(key => productionKeys.has(key)).length, 0);
  assert.equal(memory.values.has(storage.STORAGE_KEYS.areaCountRecords), false);
  hook.close(); return { fixedDate: "2026-11-03", naturalWeekday: 2, productionWrites: 0 };
});

if(process.env.PERSISTENCE_REPORT)writeFileSync(process.env.PERSISTENCE_REPORT,JSON.stringify({projectRoot,scope:"Actual production hook with deterministic React dispatcher; synchronous effect/action regression, not DOM/paint timing.",results},null,2));
const failed=results.filter(result=>!result.ok).length;
console.log(`Interactive persistence checks: ${results.length-failed}/${results.length}`);
if(failed)process.exitCode=1;
