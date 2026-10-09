import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import { useNebikiApp as runProductionHook } from "../src/hooks/useNebikiApp.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { cloneHourlyForecasts, createDefaultHourlyForecasts, FORECAST_HOUR_KEYS, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { getEveningComfortReliefContext, isValidEveningComfortForecastEntry } from "../src/domain/eveningComfortRelief.ts";
import { getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { buildRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import * as storage from "../src/domain/storage.ts";
import { buildStartDefaultDraft, createInitialSessionDraft, createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import type { AppState, DemandCycle, DiscountTime, SessionData, UseNebikiAppResult } from "../src/domain/types.ts";

// Run the complete production hook, its handlers and synchronous effects.
// React scheduling, the clock, browser events and persistence are memory fixtures.
// This is separate from native browser layout/paint/IDB verification.
process.env.TZ = "Asia/Tokyo";
const NativeDate = Date, DATE = "2026-09-08";
let fixedMs = new NativeDate(`${DATE}T17:05:00+09:00`).getTime();
class FixtureDate extends NativeDate {
  constructor(value?: string | number | Date) { super(value === undefined ? fixedMs : value); }
  static now() { return fixedMs; }
}
Object.defineProperty(globalThis, "Date", { configurable: true, value: FixtureDate });
class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const memory = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
const intervals = new Map<number, () => void>();
let timerId = 0;
const events = { addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, "document", { configurable: true, value: { ...events, hidden: false } });
Object.defineProperty(globalThis, "window", { configurable: true, value: { ...events,
  setInterval(callback: () => void) { const id = ++timerId; intervals.set(id, callback); return id; }, clearInterval(id: number) { intervals.delete(id); },
  setTimeout() { return ++timerId; }, clearTimeout() {}, confirm() { return true; }, alert(message: string) { throw new Error(message); } } });
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) => a !== undefined && b !== undefined && a.length === b.length && a.every((value,index) => Object.is(value,b[index]));
class HookFixture {
  slots: Slot[] = []; index = 0; dirty = false; effects: { callback: () => void | (() => void); slot: Slot }[] = [];
  app!: UseNebikiAppResult;
  next() { return this.slots[this.index++] ??= {}; }
  dispatcher = {
    useRef: <T>(initial: T) => { const slot=this.next();if(!("value"in slot))slot.value={current:initial};return slot.value as {current:T}; },
    useState: <T>(initial: T|(()=>T)): [T,(value:T|((previous:T)=>T))=>void] => {
      const slot=this.next();if(!("value"in slot))slot.value=typeof initial==="function"?(initial as ()=>T)():initial;
      return [slot.value as T,value=>{const next=typeof value==="function"?(value as (previous:T)=>T)(slot.value as T):value;if(!Object.is(next,slot.value)){slot.value=next;this.dirty=true;}}];
    },
    useMemo: <T>(callback:()=>T,deps:readonly unknown[])=>{const slot=this.next();if(!("value"in slot)||!sameDeps(slot.deps,deps)){slot.value=callback();slot.deps=deps;}return slot.value as T;},
    useCallback: <T>(callback:T,deps:readonly unknown[])=>this.dispatcher.useMemo(()=>callback,deps),
    useEffect: (callback:()=>void|(()=>void),deps?:readonly unknown[])=>{const slot=this.next();if(!sameDeps(slot.deps,deps)){slot.deps=deps;this.effects.push({callback,slot});}},
  };
  render() {
    this.index=0;this.dirty=false;this.effects=[];
    const internals=React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as {H:unknown},previous=internals.H;internals.H=this.dispatcher;
    try{this.app=runProductionHook();}finally{internals.H=previous;}
  }
  settle(force=false) {
    if(force||this.dirty||!this.app)this.render();
    for(let pass=0;pass<15;pass++) {
      for(const {callback,slot}of this.effects) {
        const text=String(callback);
        // Exact production callbacks execute; unrelated asynchronous archive and
        // network hydration are intentionally outside this deterministic suite.
        if(!/app-state-effect|runtime-state-effect|daily-session-completion|appendNavigationHistory|previousRenderRef\.current|setLastUsedSessionDraft|syncAfterRainSelection|syncDraftTime|setAreaJudgeSelection|setInterval\(updateNow|setNowMs\(getRuntimeNowMs|window\.addEventListener\("storage", refresh\)|earlyNextMinus5TargetDiscountTime/.test(text))continue;
        slot.cleanup?.();const cleanup=callback();slot.cleanup=typeof cleanup==="function"?cleanup:undefined;
      }
      if(!this.dirty)return;this.render();
    }assert.fail("synchronous production hook effects settle within 15 passes");
  }
  close(){this.slots.forEach(slot=>slot.cleanup?.());}
}
function state(params:{time?:DiscountTime;cycle?:DemandCycle;temp16?:number;temp21?:number;onlyLast?:boolean}={}):AppState {
  const time=params.time??"17",hourlyForecasts=createDefaultHourlyForecasts();for(const forecast of Object.values(hourlyForecasts))Object.assign(forecast,{weather:"sunny",tempC:23,windMs:2});
  hourlyForecasts["16"].tempC=params.temp16??23;hourlyForecasts["21"].tempC=params.temp21??18;
  const session:SessionData={...getCurrentDataVersionInfo(),date:DATE,weekday:2,discountTime:time,demandCycle:params.cycle??"normal",manualWeekdayOverride:false,manualDiscountTimeOverride:false,
    globalDiscountAdjustmentPercent:0,weather:{hourlyForecasts,afterRainSky:null},startedAt:`${DATE}T${time==="15"?"06":"08"}:00:00.000Z`};
  const value=createInitialState(session);value.session=session;value.screen="rate_display";value.currentAreaId="bento_men";
  Object.assign(value.areaProgressMap.bento_men,{areaCount:20,areaJudge:"normal",areaCountEvaluation:"normal",areaCountEvaluationSource:"manual",areaRateAdjustment:0});
  if(params.onlyLast)for(const [areaId,progress]of Object.entries(value.areaProgressMap))if(areaId!=="bento_men")Object.assign(progress,{status:"completed",areaJudge:"normal",areaRateAdjustment:0,completedAt:`${DATE}T08:04:00.000Z`,completedRateText:"10%",completedNormalRateText:"10%",completedManyRateText:"20%"});
  return value;
}
function fixture(raw:AppState,clock="17:05") {
  fixedMs=new NativeDate(`${DATE}T${clock}:00+09:00`).getTime();memory.clear();memory.values.set(storage.STORAGE_KEYS.currentSession,JSON.stringify(raw));memory.values.set(storage.STORAGE_KEYS.workSessionCheckpoint,JSON.stringify(raw));
  const hook=new HookFixture();hook.settle(true);return hook;
}
function rates(hook:HookFixture){return [hook.app.derived.rateDisplay?.normal.main,hook.app.derived.rateDisplay?.many.main];}
function guide(hook:HookFixture){return hook.app.derived.basisGuide.eveningComfortRelief!;}
function verifyPure(hook:HookFixture){const session=hook.app.state.session!;const effectiveTime=guide(hook).effectiveRateDiscountTime;const resolved=resolveWeatherInputForDiscount(session.weather,effectiveTime);const info=getWeekdayBaseInfo(session.weekday,effectiveTime,resolved,session.date,session.demandCycle,getEveningComfortReliefContext(session));assert.deepEqual(guide(hook),info.eveningComfortRelief);}
const results:{name:string;ok:boolean;evidence?:unknown;error?:string}[]=[];
function test(name:string,run:()=>unknown){try{const evidence=run();results.push({name,ok:true,evidence});console.log(`PASS ${results.length}: ${name}`);}catch(error){results.push({name,ok:false,error:String(error)});console.error(`FAIL ${results.length}: ${name}`,error);}}

test("actual hook display handles exact5/sub5/same/improved in both seasons and original 15/17 sessions",()=>{
  const evidence=[];
  for(const cycle of ["normal","summer"]as const)for(const time of ["15","17"]as const)for(const [temp16,temp21,expected]of [[23,18,true],[23,19,false],[18,27,false],[28,23,false]]as const){
    const hook=fixture(state({cycle,time,temp16,temp21}),time==="15"?"15:05":"17:05");assert.equal(guide(hook).applied,expected);verifyPure(hook);
    evidence.push({cycle,time,temp16,temp21,rates:rates(hook),analysis:guide(hook)});hook.close();
  }return evidence;
});
test("actual original15 delayed and original17 early-next use original eligibility with existing offsets",()=>{
  const evidence=[];
  for(const [time,clock,effective]of [["15","16:05","15"],["17","18:05","18"]]as const){const hook=fixture(state({time}),clock);verifyPure(hook);assert.equal(hook.app.state.session!.discountTime,time);assert.equal(guide(hook).sessionDiscountTime,time);assert.equal(guide(hook).effectiveRateDiscountTime,effective);assert.equal(guide(hook).applied,true);
    const visible=rates(hook),analysis=structuredClone(guide(hook));hook.app.actions.goToNextArea();hook.settle();const progress=hook.app.state.areaProgressMap.bento_men,snapshot=progress.rateDecisionSnapshot!;
    assert.deepEqual([progress.completedNormalRateText,progress.completedManyRateText],visible);assert.deepEqual(snapshot.eveningComfortRelief,analysis);assert.equal(snapshot.sessionDiscountTime,time);assert.equal(snapshot.effectiveRateDiscountTime,effective);
    assert.equal(snapshot.calculationMode,time==="15"?"late_plus5":"early_next_minus5");assert.equal(snapshot.lateTimeAdjustmentPercent,time==="15"?5:0);assert.equal(snapshot.earlyNextAdjustmentPercent,time==="17"?-5:0);
    evidence.push({time,clock,effective,visible,snapshot});hook.close();}return evidence;
});
test("independent evening sessions remain outside the condition in the complete hook",()=>{
  const evidence=[];for(const [time,clock]of [["18","18:35"],["19","19:35"]]as const){const hook=fixture(state({time}),clock);verifyPure(hook);assert.equal(guide(hook).eligibleSession,false);assert.equal(guide(hook).applied,false);evidence.push({time,clock,rates:rates(hook)});hook.close();}
  const raw=state({time:"20"});raw.screen="final_time";const final=fixture(raw,"20:35");assert.equal(guide(final).eligibleSession,false);assert.equal(guide(final).applied,false);assert.equal(final.app.derived.rateDisplay,null);
  const countRates=[final.app.derived.finalGuide?.count1.main,final.app.derived.finalGuide?.count2.main,final.app.derived.finalGuide?.count3OrMore.main];assert.deepEqual(countRates,["30%","40%","50%"]);evidence.push({time:"20",clock:"20:35",rates:countRates});final.close();return evidence;
});
test("real completion action and daily effect freeze shown rates, comparison inputs and correction metadata",()=>{
  const evidence=[];
  for(const [cycle,time]of [["normal","15"],["normal","17"],["summer","17"]]as const){const hook=fixture(state({cycle,time,onlyLast:true}),time==="15"?"15:05":"17:05"),visible=rates(hook),analysis=structuredClone(guide(hook));
    hook.app.actions.goToNextArea();hook.settle();assert.equal(hook.app.state.screen,"done");const progress=hook.app.state.areaProgressMap.bento_men;
    assert.deepEqual([progress.completedNormalRateText,progress.completedManyRateText],visible);assert.deepEqual(progress.rateDecisionSnapshot?.eveningComfortRelief,analysis);
    const daily=storage.loadDailySessionSnapshots().find(value=>value.session.startedAt===hook.app.state.session!.startedAt);assert.ok(daily);assert.deepEqual(daily.areas.bento_men.rateDecisionSnapshot?.eveningComfortRelief,analysis);assert.deepEqual(daily.basis.eveningComfortRelief,analysis);
    assert.equal(daily.areas.bento_men.rateText,visible[0]);evidence.push({cycle,time,visible,analysis});hook.close();}return evidence;
});
test("re-render, current/checkpoint reload and forecast changes never add relief cumulatively",()=>{
  let hook=fixture(state({cycle:"summer"}));const first=rates(hook),firstAnalysis=structuredClone(guide(hook)),identity=hook.app.state.session!.startedAt;
  for(let render=0;render<5;render++){hook.settle(true);assert.deepEqual(rates(hook),first);assert.deepEqual(guide(hook),firstAnalysis);}
  hook.close();hook=new HookFixture();hook.settle(true);assert.deepEqual(rates(hook),first);assert.deepEqual(guide(hook),firstAnalysis);
  const updates=[];
  for(const [temp21,expected]of [[19,false],[18,true],[19,false],[18,true]]as const){hook.app.actions.startEditingConditions();hook.settle();const current=hook.app.state.sessionDraft.weather;
    hook.app.actions.updateSessionDraft({weather:{...current,hourlyForecasts:{...current.hourlyForecasts,"21":{...current.hourlyForecasts["21"],tempC:temp21}}}});hook.settle();hook.app.actions.startSession();hook.settle();
    assert.equal(hook.app.state.session!.startedAt,identity);assert.equal(guide(hook).applied,expected);if(expected){assert.deepEqual(rates(hook),first);assert.deepEqual(guide(hook),firstAnalysis);}updates.push({temp21,rates:rates(hook),analysis:guide(hook)});
  }hook.close();return{renders:5,reload:true,updates};
});
test("missing or invalid restored forecasts stay ineligible after fallback normalization and reload",()=>{
  const evidence=[];
  for(const kind of ["missingHour","missingTemperature","nullTemperature","invalidWind","invalidWeather"]as const){const raw=state(),forecasts=raw.session!.weather.hourlyForecasts as unknown as Record<string,Record<string,unknown>>;
    if(kind==="missingHour")delete forecasts["16"];if(kind==="missingTemperature")delete forecasts["16"].tempC;if(kind==="nullTemperature")forecasts["16"].tempC=null;if(kind==="invalidWind")forecasts["21"].windMs=-1;if(kind==="invalidWeather")forecasts["21"].weather="bad";
    raw.sessionDraft.weather=raw.session!.weather;let hook=fixture(raw);assert.equal(guide(hook).applied,false);assert.equal(guide(hook).reason,"comparison_input_unavailable");
    const visible=rates(hook);hook.close();hook=new HookFixture();hook.settle(true);assert.deepEqual(rates(hook),visible);assert.equal(guide(hook).reason,"comparison_input_unavailable");evidence.push({kind,visible,analysis:guide(hook),marker:hook.app.state.session!.weather.eveningComfortUnavailableForecastHours});hook.close();
  }return evidence;
});
test("actual Start confirmation handler and actual hook patch merge clear only explicitly confirmed comparison inputs",()=>{
  const raw=state({time:"15"});raw.session!.weather.eveningComfortUnavailableForecastHours=["16","21"];raw.sessionDraft.weather=raw.session!.weather;
  const hook=fixture(raw,"15:05");hook.app.actions.startEditingConditions();hook.settle();
  const source=readFileSync(new URL("../src/components/screens/StartScreen.tsx",import.meta.url),"utf8"),ast=ts.createSourceFile("StartScreen.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const find=(name:string,kind:"function"|"variable")=>{const matches:ts.Node[]=[];const visit=(node:ts.Node)=>{if(kind==="function"&&ts.isFunctionDeclaration(node)&&node.name?.text===name)matches.push(node);if(kind==="variable"&&ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name)matches.push(node);ts.forEachChild(node,visit);};visit(ast);assert.equal(matches.length,1);return matches[0];};
  const empty=Object.fromEntries(FORECAST_HOUR_KEYS.map(hour=>[hour,{weather:false,temp:false,wind:false}]));
  const ui:Record<string,unknown>={sessionDraft:hook.app.state.sessionDraft,activeHours:FORECAST_HOUR_KEYS,confirmedInputs:empty,isFinalTime:false,INPUT_FIELDS:["weather","temp","wind"],FORECAST_HOUR_KEYS,
    cloneHourlyForecasts,isValidEveningComfortForecastEntry,hasUserAdvancedWeatherInputRef:{current:false},
    setConfirmedInputs:(update:(current:unknown)=>unknown)=>{ui.confirmedInputs=update(ui.confirmedInputs);},
    onChangeSessionDraft:(patch:Parameters<typeof hook.app.actions.updateSessionDraft>[0])=>{hook.app.actions.updateSessionDraft(patch);hook.settle();ui.sessionDraft=hook.app.state.sessionDraft;}};
  const run=(code:string)=>runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,ui);
  for(const name of ["getInputHoursForField","createEmptyConfirmationMap","createCorrectionConfirmationMap"])ui[name]=run(`${find(name,"function").getText(ast)}\n${name};`);
  const declaration=find("applyHourlyChange","variable")as ts.VariableDeclaration;assert.ok(declaration.initializer);
  const apply=run(`(${declaration.initializer.getText(ast)});`)as(hour:string,field:string,patch:Record<string,unknown>,confirm?:boolean)=>void;
  apply("16","temp",{tempC:23},false);assert.deepEqual(hook.app.state.sessionDraft.weather.eveningComfortUnavailableForecastHours,["16","21"],"typing a temperature is not full input confirmation");
  const correction=run(`createCorrectionConfirmationMap([{hour:"16",field:"weather"},{hour:"21",field:"wind"}],["16","21"]);`)as typeof empty;
  for(const hour of ["16","21"])assert.deepEqual(JSON.parse(JSON.stringify(correction[hour])),{weather:false,temp:false,wind:false},"correction reopening cannot auto-confirm missing comparison input");
  apply("16","weather",{weather:"sunny"});apply("16","temp",{tempC:23});assert.deepEqual(hook.app.state.sessionDraft.weather.eveningComfortUnavailableForecastHours,["16","21"]);
  apply("16","wind",{windMs:2});assert.deepEqual(hook.app.state.sessionDraft.weather.eveningComfortUnavailableForecastHours,["21"],"automatic copy to a later hour keeps its missing marker");
  apply("21","weather",{weather:"sunny"});apply("21","temp",{tempC:18});assert.deepEqual(hook.app.state.sessionDraft.weather.eveningComfortUnavailableForecastHours,["21"]);
  apply("21","wind",{windMs:2});assert.equal(hook.app.state.sessionDraft.weather.eveningComfortUnavailableForecastHours?.length??0,0,"the last marker clears through the production hook's weather merge");
  hook.app.actions.startSession();hook.settle();assert.equal(guide(hook).conditionMet,true);assert.equal(guide(hook).applied,true);assert.equal(guide(hook).forecast16?.tempC,23);assert.equal(guide(hook).forecast21?.tempC,18);
  const evidence={rates:rates(hook),analysis:guide(hook),marker:hook.app.state.sessionDraft.weather.eveningComfortUnavailableForecastHours??null};hook.close();return evidence;
});
test("new defaults and a new business day preserve values but require today's 16/21 comparison inputs",()=>{
  fixedMs=new NativeDate(`${DATE}T17:05:00+09:00`).getTime();
  assert.deepEqual(createInitialSessionDraft().weather.eveningComfortUnavailableForecastHours,["16","21"]);
  const valid=state().sessionDraft,validBefore=JSON.stringify(valid);assert.equal(buildStartDefaultDraft(valid).weather.eveningComfortUnavailableForecastHours,undefined,"same-day complete legacy input is compatible");
  const old={...structuredClone(valid),date:"2026-09-07"},oldBefore=JSON.stringify(old),current=buildStartDefaultDraft(old);
  assert.equal(current.date,DATE);assert.deepEqual(current.weather.hourlyForecasts,old.weather.hourlyForecasts);assert.deepEqual(current.weather.eveningComfortUnavailableForecastHours,["16","21"]);
  const raw=createInitialState(old);raw.screen="start";raw.session=null;const hook=fixture(raw);
  assert.equal(hook.app.state.sessionDraft.date,DATE);assert.deepEqual(hook.app.state.sessionDraft.weather.hourlyForecasts,old.weather.hourlyForecasts);assert.deepEqual(hook.app.state.sessionDraft.weather.eveningComfortUnavailableForecastHours,["16","21"]);
  // Completing the current 17 session input confirms 21, while 16 is outside
  // that session's input hours and remains unavailable for this new rule.
  const weather=hook.app.state.sessionDraft.weather;hook.app.actions.updateSessionDraft({weather:{...weather,hourlyForecasts:structuredClone(weather.hourlyForecasts),eveningComfortUnavailableForecastHours:["16"]}});hook.settle();hook.app.actions.startSession();hook.settle();
  assert.equal(hook.app.state.session!.discountTime,"17");assert.equal(guide(hook).reason,"comparison_input_unavailable");assert.equal(guide(hook).applied,false);assert.equal(guide(hook).forecast16,null);assert.equal(guide(hook).forecast21?.tempC,18);
  const evidence={currentDate:hook.app.state.session!.date,rates:rates(hook),analysis:guide(hook)};hook.close();assert.equal(JSON.stringify(valid),validBefore);assert.equal(JSON.stringify(old),oldBefore);return evidence;
});
test("actual unstarted draft midnight and explicit date edits invalidate comparison availability without erasing weather",()=>{
  const raw=createInitialState(state().sessionDraft);raw.screen="start";raw.session=null;const weatherBefore=JSON.stringify(raw.sessionDraft.weather.hourlyForecasts),hook=fixture(raw,"23:59");
  fixedMs=new NativeDate("2026-09-09T00:00:01+09:00").getTime();for(const callback of [...intervals.values()])callback();hook.settle();
  assert.equal(hook.app.state.sessionDraft.date,"2026-09-09");assert.deepEqual(hook.app.state.sessionDraft.weather.eveningComfortUnavailableForecastHours,["16","21"]);assert.equal(JSON.stringify(hook.app.state.sessionDraft.weather.hourlyForecasts),weatherBefore);
  hook.app.actions.updateSessionDraft({date:DATE,weather:{...hook.app.state.sessionDraft.weather,eveningComfortUnavailableForecastHours:[]}});hook.settle();assert.deepEqual(hook.app.state.sessionDraft.weather.eveningComfortUnavailableForecastHours,["16","21"]);
  assert.equal(JSON.stringify(hook.app.state.sessionDraft.weather.hourlyForecasts),weatherBefore);const evidence={midnightDate:"2026-09-09",weatherRetained:true,marker:hook.app.state.sessionDraft.weather.eveningComfortUnavailableForecastHours};hook.close();return evidence;
});
test("old completed progress snapshots keep captured evaluation and rates while current forecasts receive new relief",()=>{
  const raw=state({cycle:"summer",onlyLast:true}),session=raw.session!;const resolved=resolveWeatherInputForDiscount(session.weather,"17"),oldInfo=getWeekdayBaseInfo(session.weekday,"17",resolved,session.date,session.demandCycle);
  const oldRate=buildRateDecisionSnapshot({confirmedAt:`${DATE}T08:04:00.000Z`,sessionDiscountTime:"17",effectiveRateDiscountTime:"17",calculationMode:"normal",weatherComfortAdjustmentPercent:oldInfo.baseRateBonus,areaJudge:"normal",areaRateAdjustment:0,resolvedWeather:resolved,weekday:session.weekday,date:session.date,demandCycle:"summer",globalDiscountAdjustmentPercent:0});
  Object.assign(raw.areaProgressMap.bento_men,{status:"completed",completedAt:`${DATE}T08:04:00.000Z`,completedRateText:oldRate.displayedRateText,completedNormalRateText:oldRate.display!.normal.main,completedManyRateText:oldRate.display!.many.main,rateDecisionSnapshot:oldRate,rateDecisionSnapshotStatus:"captured"});raw.screen="done";raw.currentAreaId=null;
  const rawBefore=JSON.stringify(raw),before=JSON.stringify(normalizeLoadedState(structuredClone(raw),raw.sessionDraft).areaProgressMap),hook=fixture(raw);assert.equal(JSON.stringify(hook.app.state.areaProgressMap),before);assert.deepEqual(hook.app.state.areaProgressMap.bento_men.rateDecisionSnapshot,oldRate);
  hook.settle(true);assert.equal(JSON.stringify(hook.app.state.areaProgressMap),before);hook.close();const reload=new HookFixture();reload.settle(true);assert.equal(JSON.stringify(reload.app.state.areaProgressMap),before);reload.close();assert.equal(JSON.stringify(raw),rawBefore);return{oldRates:[oldRate.displayedNormalRatePercent,oldRate.displayedManyRatePercent],rawInputBytesUnchanged:true,normalizedProgressBytesUnchanged:true};
});
if(process.env.EVENING_COMFORT_FLOW_REPORT)writeFileSync(process.env.EVENING_COMFORT_FLOW_REPORT,JSON.stringify({scope:"Complete production useNebikiApp handlers and synchronous effects with deterministic React/browser/storage fixture. No real DOM, IndexedDB hydration, network or native touch.",results},null,2));
const failed=results.filter(value=>!value.ok).length;console.log(`Evening comfort flow checks: ${results.length-failed}/${results.length}`);if(failed)process.exitCode=1;
