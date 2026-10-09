import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { getAdvanceDiscountRate } from "../src/domain/advanceDiscount.ts";
import { getColdDeliGuide } from "../src/domain/coldDeliGuide.ts";
import { evaluateEveningComfortRelief, getEveningComfortReliefContext, normalizeEveningComfortReliefAnalysis } from "../src/domain/eveningComfortRelief.ts";
import type { EveningComfortReliefAnalysis } from "../src/domain/eveningComfortRelief.ts";
import { createDefaultHourlyForecasts, getHourlyForecastComfortScore, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { getTemperaturePoint, evaluateTemperatureComfort } from "../src/domain/temperatureComfort.ts";
import { getWeekdayBaseInfo, getBasisGuideDisplay } from "../src/domain/weekdayBase.ts";
import { buildCurrentNormalRatePresentation, shouldIgnoreNormalTimeRateCap } from "../src/hooks/nebikiApp/ratePresentation.ts";
import { buildRateDecisionSnapshot, normalizeRateDecisionSnapshot, reconstructRateDisplayFromSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { createDailySessionSnapshot, createReview19DaySnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { initializeFinalizedDayDataInMemory, normalizeFinalizedDayData } from "../src/domain/finalizedDayData.ts";
import { buildAllFinalizedDayDataExportPayload, buildDirectFinalizedDayDataExportPayload } from "../src/domain/separateDataExport.ts";
import { loadCurrentSession, saveCurrentSession, loadDailySessionSnapshots, saveDailySessionSnapshots, upsertDailySessionSnapshotSafely } from "../src/domain/storage.ts";
import { mergeDailySessionSnapshotArchiveOperations } from "../src/domain/historicalArchive.ts";
import type { RateDisplayScreen } from "../src/components/screens/RateDisplayScreen.tsx";
import type { AppState, DailySessionSnapshot, DemandCycle, DiscountTime, ForecastWeatherKind, GlobalDiscountAdjustmentPercent, ResolvedWeatherInput, SessionData } from "../src/domain/types.ts";

// Pure production calculations, production TSX rendering and real storage/export
// builders. This fixture never accesses the browser's or production stores.
class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
const memory = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
const DATE = "2026-09-08", CONFIRMED_AT = `${DATE}T08:10:00.000Z`;
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const noop = () => {};
const results: { name: string; ok: boolean; evidence?: unknown }[] = [];
function test(name: string, run: () => unknown) {
  const evidence = run(); results.push({ name, ok: true, evidence }); console.log(`PASS ${results.length}: ${name}`);
}

function session(params: { time?: DiscountTime; cycle?: DemandCycle; temp16?: number; temp21?: number; baseTemp?: number; wind?: number; weather?: ForecastWeatherKind; global?: GlobalDiscountAdjustmentPercent } = {}): SessionData {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const entry of Object.values(hourlyForecasts)) Object.assign(entry, { tempC: params.baseTemp ?? 23, windMs: params.wind ?? 2, weather: params.weather ?? "sunny" });
  hourlyForecasts["16"].tempC = params.temp16 ?? 23; hourlyForecasts["21"].tempC = params.temp21 ?? 18;
  return { ...getCurrentDataVersionInfo(), date: DATE, weekday: 2, discountTime: params.time ?? "17", demandCycle: params.cycle ?? "normal", globalDiscountAdjustmentPercent: params.global ?? 0,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false, weather: { hourlyForecasts, afterRainSky: null }, startedAt: `${DATE}T08:00:00.000Z` };
}
function context(value: SessionData) { return getEveningComfortReliefContext(value); }
function decision(value: SessionData, params: { effectiveTime?: DiscountTime; late?: boolean; early?: boolean; resolved?: ResolvedWeatherInput; areaAdjustment?: -10|-5|0|5|10; useRelief?: boolean } = {}) {
  const time = params.effectiveTime ?? value.discountTime;
  assert.notEqual(time, "20");
  const resolved = params.resolved ?? resolveWeatherInputForDiscount(value.weather, time);
  const reliefContext = params.useRelief === false ? undefined : context(value);
  const info = getWeekdayBaseInfo(value.weekday, time, resolved, value.date, value.demandCycle, reliefContext);
  const guide = getBasisGuideDisplay({ date: value.date, weekday: value.weekday, discountTime: time, demandCycle: value.demandCycle, weather: resolved, eveningComfortReliefContext: reliefContext });
  const state = createInitialState(value); state.session = value; state.screen = "rate_display"; state.currentAreaId = "bento_men";
  Object.assign(state.areaProgressMap.bento_men, { areaJudge: "normal", areaRateAdjustment: params.areaAdjustment ?? 0, areaCount: 20 });
  const presentation = buildCurrentNormalRatePresentation({ session: value, progress: state.areaProgressMap.bento_men, effectiveDiscountTime: time, weatherBonus: info.baseRateBonus + (params.late ? 5 : 0), ignoreTimeRateCap: shouldIgnoreNormalTimeRateCap(resolved), rateOffsetPercent: params.early ? -5 : 0 });
  assert.ok(presentation);
  const snapshot = buildRateDecisionSnapshot({ confirmedAt: CONFIRMED_AT, sessionDiscountTime: value.discountTime, effectiveRateDiscountTime: time as "15"|"17"|"18"|"19", calculationMode: params.early ? "early_next_minus5" : params.late ? "late_plus5" : "normal",
    weatherComfortAdjustmentPercent: info.baseRateBonus, areaJudge: "normal", areaRateAdjustment: params.areaAdjustment ?? 0, resolvedWeather: resolved, weekday: value.weekday, date: value.date,
    demandCycle: value.demandCycle, globalDiscountAdjustmentPercent: value.globalDiscountAdjustmentPercent, eveningComfortRelief: info.eveningComfortRelief });
  assert.deepEqual(json(presentation.display), snapshot.display, "actual display and confirmed snapshot arithmetic");
  assert.equal(guide.bonusTotal, info.baseRateBonus, "calculation explanation agrees");
  return { state, resolved, info, guide, presentation, snapshot };
}
function daily(value: ReturnType<typeof decision>): DailySessionSnapshot {
  const state: AppState = json(value.state); state.screen = "done"; state.currentAreaId = null;
  Object.assign(state.areaProgressMap.bento_men, { status: "completed", completedAt: CONFIRMED_AT, completedRateText: value.snapshot.displayedRateText, rateDecisionSnapshot: value.snapshot, rateDecisionSnapshotStatus: "captured" });
  const result = createDailySessionSnapshot({ capturedAt: CONFIRMED_AT, state, resolvedWeather: value.resolved, weekdayBaseInfo: value.info, basisGuide: value.guide, lateTimeBonus: 0, doneSummaryItems: [] });
  assert.ok(result); return result;
}
function relief(value: SessionData, before = -10, effectiveTime = value.discountTime) {
  return evaluateEveningComfortRelief({ context: context(value), effectiveRateDiscountTime: effectiveTime, comfortAdjustmentBeforePercent: before });
}
function rates(value: ReturnType<typeof decision>) { return [value.snapshot.displayedNormalRatePercent, value.snapshot.displayedManyRatePercent]; }

const componentModules = new Map<string, Record<string, unknown>>();
async function loadComponent(url: URL): Promise<Record<string, unknown>> {
  const cached = componentModules.get(url.href); if (cached) return cached;
  const raw = readFileSync(url, "utf8"), ast = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Render the actual details in their opened state. Browser tests exercise the
  // toggle click; this deterministic SSR fixture verifies the resulting text.
  const componentReact = url.pathname.endsWith("/WeekdayBasePanel.tsx")
    ? { ...React, useState: () => [true, noop] }
    : React;
  const dependencies = new Map<string, unknown>([["react", componentReact], ["react/jsx-runtime", jsxRuntime]]);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    assert.ok(ts.isStringLiteral(statement.moduleSpecifier)); const id = statement.moduleSpecifier.text;
    if (dependencies.has(id)) continue; assert.ok(id.startsWith("."));
    const target = [id, id + ".ts", id + ".tsx"].map(path => new URL(path, url)).find(candidate => existsSync(candidate)); assert.ok(target);
    dependencies.set(id, target.pathname.endsWith(".tsx") ? await loadComponent(target) : await import(target.href));
  }
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: (id: string) => { assert.ok(dependencies.has(id)); return dependencies.get(id); } });
  componentModules.set(url.href, exports); return exports;
}
const RuntimeRateScreen = (await loadComponent(new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url))).RateDisplayScreen as typeof RateDisplayScreen;
function markup(value: ReturnType<typeof decision>) { return renderToStaticMarkup(React.createElement(RuntimeRateScreen, { weekdayText: "火曜日", timeText: "17時", areaName: "弁当・麺", demandCycle: value.state.session!.demandCycle,
  discountTime: value.state.session!.discountTime, basisGuide: value.guide, rateDisplay: value.presentation.display, onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop })).replace(/<[^>]*>/g, ""); }

test("comparison uses the existing single-hour score with larger values meaning less comfortable", () => {
  const entries = [ {tempC:23,windMs:2,weather:"sunny"}, {tempC:18,windMs:2,weather:"sunny"}, {tempC:18,windMs:5,weather:"rain"}, {tempC:10,windMs:5,weather:"snow"} ] as const;
  assert.deepEqual(entries.map(getHourlyForecastComfortScore), [-2,-1,1,5]);
  assert.equal(getTemperaturePoint("21to25"), -2);
  const result = relief(session()); assert.equal(result.forecast16!.comfortScore,-2); assert.equal(result.forecast21!.comfortScore,-1);
  assert.equal(result.temperatureDifferenceC,5); assert.equal(result.comfortDecreased,true); assert.equal(result.conditionMet,true); return result;
});
test("exactly 5°C and super-comfortable→comfortable apply to both normal and summer 15/17", () => {
  const evidence = [];
  for (const cycle of ["normal","summer"] as const) for (const time of ["15","17"] as const) {
    const value = session({cycle,time}), before = decision(value,{useRelief:false}), after = decision(value);
    assert.ok(after.info.eveningComfortRelief?.applied); assert.equal(after.info.baseRateBonus,before.info.baseRateBonus+5);
    assert.equal(after.info.eveningComfortRelief.comfortAdjustmentAfterPercent, Math.min(0,after.info.eveningComfortRelief.comfortAdjustmentBeforePercent+5));
    assert.match(after.guide.bonusDetailLines!.join(" "),/超快適/);
    evidence.push({cycle,time,before:rates(before),after:rates(after),analysis:after.info.eveningComfortRelief});
  } return evidence;
});
test("sub-5°C, same and improved single-hour comfort leave actual displayed rates unchanged", () => {
  const evidence=[];
  for (const [temp16,temp21,reason] of [[23,19,"temperature_difference_below_5"],[18,27,"comfort_not_decreased"],[28,23,"comfort_not_decreased"]] as const) {
    const value=session({temp16,temp21}),before=decision(value,{useRelief:false}),after=decision(value);
    assert.equal(after.info.eveningComfortRelief?.applied,false); assert.equal(after.info.eveningComfortRelief?.reason,reason);
    assert.deepEqual(after.presentation.display,before.presentation.display); evidence.push({temp16,temp21,rates:rates(after),analysis:after.info.eveningComfortRelief});
  } return evidence;
});
test("absolute temperature difference permits a warming night whose comfort is worse", () => {
  const value=session({temp16:23,temp21:31}),after=decision(value),before=decision(value,{useRelief:false});
  assert.equal(after.info.eveningComfortRelief?.temperatureDifferenceC,8); assert.equal(after.info.eveningComfortRelief?.conditionMet,true);
  assert.equal(after.info.baseRateBonus,before.info.baseRateBonus+5); return {before:rates(before),after:rates(after)};
});
test("each limited B -10/-5/0/+5/+10 changes only the negative comfort term", () => {
  const evidence=[];
  for(const before of [-10,-5,0,5,10]) {
    const result=relief(session(),before); assert.equal(result.comfortAdjustmentAfterPercent,before<0?Math.min(0,before+5):before);
    assert.equal(result.reliefPercent,before<0?5:0); assert.equal(result.applied,before<0); evidence.push(result);
  }
  const value=session();
  for(const rawScore of [-2,-1,0,1,2]) {
    const resolved={...resolveWeatherInputForDiscount(value.weather,"17"),tempLevel:rawScore===-2?"21to25":rawScore===-1?"16to20":rawScore===0?"11to15":rawScore===1?"31to33":"36orMore",weatherPointShift:0} as ResolvedWeatherInput;
    const after=decision(value,{resolved}),before=decision(value,{resolved,useRelief:false});
    const b=before.info.baseRateBonus; assert.equal(after.info.baseRateBonus,b<0?Math.min(0,b+5):b);
    evidence.push({rawScore,before:rates(before),after:rates(after),analysis:after.info.eveningComfortRelief});
  } return evidence;
});
test("rain and snow limits run before relief and direct precipitation remains intact", () => {
  const evidence=[];
  for (const cycle of ["normal","summer"] as const) for (const time of ["15","17"] as const) for (const weather of ["sunny","rain","snow"] as const) {
    const value=session({cycle,time,weather}), before=decision(value,{useRelief:false}),after=decision(value);
    const analysis=after.info.eveningComfortRelief!;
    assert.equal(after.resolved.precipitationRateBonus,before.resolved.precipitationRateBonus);
    assert.equal(after.info.baseRateBonus,analysis.comfortAdjustmentAfterPercent + after.resolved.precipitationRateBonus);
    assert.equal(before.info.baseRateBonus,analysis.comfortAdjustmentBeforePercent + after.resolved.precipitationRateBonus);
    if(weather==="rain"&&time==="15")assert.deepEqual([analysis.comfortAdjustmentBeforePercent,analysis.comfortAdjustmentAfterPercent],[-5,0]);
    if(weather==="snow"||(weather==="rain"&&time==="17"))assert.deepEqual([analysis.comfortAdjustmentBeforePercent,analysis.comfortAdjustmentAfterPercent],[0,0]);
    evidence.push({cycle,time,weather,precip:after.resolved.precipitationRateBonus,before:rates(before),after:rates(after),analysis});
  } return evidence;
});
test("future aggregate, existing heat suppression and rate caps cannot enter the comparison", () => {
  const value=session(),original=relief(value); value.weather.hourlyForecasts["18"]={weather:"snow",tempC:-10,windMs:20};
  const changed=relief(value); assert.deepEqual(changed,original,"interior forecast hours never affect the two-hour comparison");
  const resolved=resolveWeatherInputForDiscount(value.weather,"17");
  const suppressed=evaluateTemperatureComfort({date:DATE,discountTime:"17",tempLevel:"34to35",previous:{date:DATE,discountTime:"15",tempLevel:"36orMore",temperatureFalling:false}});
  const after=decision(value,{resolved:{...resolved,tempLevel:"34to35",temperatureComfortAnalysis:suppressed,weatherPointScore:-100,weatherPointShift:2}});
  assert.equal(after.info.eveningComfortRelief?.forecast16?.comfortScore,-2);assert.equal(after.info.eveningComfortRelief?.forecast21?.comfortScore,-1); return after.info.eveningComfortRelief;
});
test("unclamped hourly scores detect deterioration within the same discomfort label while positive B stays unchanged",()=>{
  const value=session({temp16:10,temp21:5,weather:"snow",wind:5}),analysis=relief(value,10);
  assert.equal(analysis.forecast16?.comfortScore,5);assert.equal(analysis.forecast21?.comfortScore,6);assert.equal(analysis.conditionMet,true);assert.equal(analysis.applied,false);assert.equal(analysis.comfortAdjustmentAfterPercent,10);
  return analysis;
});
test("independent 18:30/19:30/20:30 are excluded; original 15/17 early and delayed calculations retain eligibility", () => {
  const evidence=[];
  for(const time of ["18","19"] as const) { const value=session({time}),before=decision(value,{useRelief:false}),after=decision(value); assert.equal(after.info.eveningComfortRelief?.eligibleSession,false);assert.deepEqual(rates(after),rates(before));evidence.push({time,before:rates(before),after:rates(after)}); }
  assert.equal(relief(session({time:"20"}),-10).applied,false);
  for(const [original,effective,late,early] of [["15","15",true,false],["15","17",false,true],["17","18",false,true],["17","17",true,false]] as const) {
    const value=session({time:original}),after=decision(value,{effectiveTime:effective,late,early}),before=decision(value,{effectiveTime:effective,late,early,useRelief:false});
    assert.equal(after.info.eveningComfortRelief?.sessionDiscountTime,original);assert.equal(after.info.eveningComfortRelief?.effectiveRateDiscountTime,effective);assert.equal(after.info.eveningComfortRelief?.applied,true);
    assert.equal(after.snapshot.lateTimeAdjustmentPercent,late?5:0);assert.equal(after.snapshot.earlyNextAdjustmentPercent,early?-5:0);
    evidence.push({original,effective,late,early,before:rates(before),after:rates(after)});
  } return evidence;
});
test("area/global adjustments and clamps keep their existing order in actual rates and snapshot", () => {
  const evidence=[];
  for(const time of ["15","17"] as const) for(const areaAdjustment of [-10,-5,0,5,10] as const) for(const global of [-5,0,5] as const) {
    const after=decision(session({time,global}),{areaAdjustment,late:true});
    const raw=(time==="15"?0:10)+after.info.baseRateBonus+5+areaAdjustment;
    assert.deepEqual(rates(after),[Math.max(0,Math.min(50,Math.max(0,Math.min(50,raw))+global)),Math.max(0,Math.min(50,Math.max(0,Math.min(50,raw+10))+global))]);
    evidence.push({time,areaAdjustment,global,rates:rates(after)});
  } return evidence;
});
test("advance and cold-deli guides receive the same new weather correction while their independent policies remain unchanged",()=>{
  const forbidden=["areaCount","areaCountRecords","areaProgressMap","currentAreaId","areaJudge","areaRateAdjustment","areaCountAdjustmentPercent","areaCountEvaluation","humanEvaluationDetails","evaluationAdjustment","quickAdjustment","decrease","decreaseAdjustment","medianCount","history","snapshots","productAdjustmentPolicy","productPolicy","productCount","quantity","lateTimeBonus","earlyNextMinus5Info","rateOffsetPercent","temperatureComfortAnalysis"];
  const protect=<T extends object>(value:T):T=>{for(const field of forbidden)Object.defineProperty(value,field,{get(){throw new Error(`independent guide accessed ${field}`);}});return value;};
  const evidence=[];
  for(const cycle of ["normal","summer"]as const)for(const time of ["15","17"]as const)for(const global of [-5,0,5]as const){
    const value=session({cycle,time,global});value.date="2026-09-04";value.weekday=5;
    const resolvedWeather=resolveWeatherInputForDiscount(value.weather,time),oldInfo=getWeekdayBaseInfo(value.weekday,time,resolvedWeather,value.date,cycle),newInfo=getWeekdayBaseInfo(value.weekday,time,resolvedWeather,value.date,cycle,context(value));
    const legacySession:{weather?:SessionData["weather"]}&Omit<SessionData,"weather">={...value};delete legacySession.weather;
    const oldInput=protect({session:protect(legacySession),resolvedWeather,isFixedTimeMode:false}),newInput=protect({session:protect(value),resolvedWeather,isFixedTimeMode:false});
    const beforeAdvance=getAdvanceDiscountRate(oldInput),afterAdvance=getAdvanceDiscountRate(newInput),beforeCold=getColdDeliGuide(oldInput),afterCold=getColdDeliGuide(newInput);
    assert.equal(newInfo.baseRateBonus,oldInfo.baseRateBonus+5);
    const beforeAdvanceExpected=time==="15"?Math.max(0,global):cycle==="summer"?10+global:15+global;
    const afterAdvanceExpected=time==="15"?Math.max(0,5+global):cycle==="summer"?15+global:20+global;
    assert.equal(beforeAdvance,beforeAdvanceExpected);assert.equal(afterAdvance,afterAdvanceExpected,"new W reaches advance before existing global/clamp");
    if(time==="17"){
      const beforeColdExpected=cycle==="summer"||global===-5?25+Math.max(0,global):30+Math.max(0,global);
      const afterColdExpected=cycle==="summer"&&global===-5?25:30+Math.max(0,global);
      assert.deepEqual(beforeCold,{discountTime:"17",ratePercent:beforeColdExpected});assert.deepEqual(afterCold,{discountTime:"17",ratePercent:afterColdExpected});
      if(cycle==="summer"&&global===0)assert.deepEqual([beforeCold?.ratePercent,afterCold?.ratePercent],[25,30],"existing 25% predicate changes result because W changes -10 to -5");
      if(cycle==="summer"&&global===-5)assert.deepEqual([beforeCold?.ratePercent,afterCold?.ratePercent],[25,25],"existing W=-5 plus global=-5 predicate retains 25%");
    }else{
      const expectedCold={discountTime:"15",highCount:global===-5?4:3,lowCount:global===-5?3:2,highRatePercent:20+Math.max(0,global),highFewRatePercent:15+Math.max(0,global),lowRatePercent:10+Math.max(0,global),lowFewRatePercent:5+Math.max(0,global)};
      assert.deepEqual(beforeCold,expectedCold);assert.deepEqual(afterCold,expectedCold,"negative W remains outside 15 cold-deli's positive addition policy");
    }
    evidence.push({cycle,time,date:value.date,nextDayIsHolidayOrWeekend:true,global,weatherBefore:oldInfo.baseRateBonus,weatherAfter:newInfo.baseRateBonus,advanceBefore:beforeAdvance,advanceAfter:afterAdvance,coldBefore:beforeCold,coldAfter:afterCold});
  }return evidence;
});
test("missing, null, nonfinite, out-of-range or invalid comparison input never becomes a 0°C forecast", () => {
  const invalidInputs = [undefined,null,{}, {"16":null,"21":{tempC:18,windMs:2,weather:"sunny"}}];
  for(const field of ["tempC","windMs","weather"] as const) for(const invalid of [undefined,null,"",NaN,Infinity,-Infinity]) {
    const map=json(session().weather.hourlyForecasts) as unknown as Record<string,Record<string,unknown>>;map["16"][field]=invalid;invalidInputs.push(map);
  }
  for(const [field,invalid]of [["tempC",-21],["tempC",46],["windMs",-1],["windMs",21],["weather","cloudy"]]as const){const map=json(session().weather.hourlyForecasts)as unknown as Record<string,Record<string,unknown>>;map["21"][field]=invalid;invalidInputs.push(map);}
  for(const hourlyForecasts of invalidInputs) {
    const result=evaluateEveningComfortRelief({context:{sessionDiscountTime:"17",hourlyForecasts},effectiveRateDiscountTime:"17",comfortAdjustmentBeforePercent:-5});
    assert.equal(result.applied,false);assert.equal(result.comfortAdjustmentAfterPercent,-5);assert.equal(result.reason,"comparison_input_unavailable");
  } return {invalidCases:invalidInputs.length};
});
test("repeated display and forecast changes start from original B every time", () => {
  const value=session({cycle:"summer"}),before=JSON.stringify(value),first=decision(value);
  for(let repeat=0;repeat<5;repeat++)assert.deepEqual(decision(value).snapshot,first.snapshot);
  assert.equal(JSON.stringify(value),before);
  value.weather.hourlyForecasts["21"].tempC=19;assert.equal(decision(value).info.eveningComfortRelief?.applied,false);
  value.weather.hourlyForecasts["21"].tempC=18;assert.deepEqual(decision(value).snapshot,first.snapshot);
  const normalized=normalizeLoadedState(json(first.state),first.state.sessionDraft); assert.equal(decision(normalized.session!).info.baseRateBonus,first.info.baseRateBonus);return {repeats:5,rates:rates(first)};
});
test("displayed wording preserves evaluation and shows 5 points with before/after values", () => {
  const evidence=[];
  for(const [time,cycle]of [["15","normal"],["17","normal"],["17","summer"]]as const) {
    const value=decision(session({time,cycle})),text=markup(value),analysis=value.info.eveningComfortRelief!;
    assert.match(text,/超快適/);assert.match(text,/5(?:ポイント|%|％)/);assert.ok(text.includes(String(analysis.comfortAdjustmentBeforePercent)));assert.ok(text.includes(String(analysis.comfortAdjustmentAfterPercent)));
    assert.ok(text.includes(value.snapshot.display!.many.main));evidence.push({time,cycle,text,analysis});
  } return evidence;
});
function assertMetadata(value: DailySessionSnapshot, expected: EveningComfortReliefAnalysis) {
  assert.deepEqual(value.areas.bento_men.rateDecisionSnapshot?.eveningComfortRelief,expected);
  assert.deepEqual(value.basis.eveningComfortRelief,expected);
  assert.equal(value.areas.bento_men.ratePercent,value.areas.bento_men.rateDecisionSnapshot!.displayedRatePercent);
}
test("captured metadata and actual rates agree through current, daily, finalized and analysis exports", () => {
  memory.clear();const value=decision(session({cycle:"summer"})),analysis=value.info.eveningComfortRelief!;
  value.state.areaProgressMap.bento_men.rateDecisionSnapshot=value.snapshot;saveCurrentSession(value.state);
  const current=normalizeLoadedState(loadCurrentSession(),value.state.sessionDraft);assert.deepEqual(current.areaProgressMap.bento_men.rateDecisionSnapshot,value.snapshot);
  const normalized=normalizeRateDecisionSnapshot(json(value.snapshot));assert.deepEqual(normalized,value.snapshot);assert.deepEqual(reconstructRateDisplayFromSnapshot(normalized!),json(value.presentation.display));
  assert.deepEqual(normalizeEveningComfortReliefAnalysis(json(analysis)),analysis);
  const captured=daily(value);assertMetadata(captured,analysis);saveDailySessionSnapshots([captured]);const saved=loadDailySessionSnapshots()[0];assertMetadata(saved,analysis);
  const day=createReview19DaySnapshot({capturedAt:CONFIRMED_AT,date:DATE,demandCycle:"summer",sessions:[saved],areaCountRecords:[]});assertMetadata(day.sessions[0],analysis);
  const finalized=initializeFinalizedDayDataInMemory({currentRecords:[],daySnapshot:day}).record;assertMetadata(finalized.sessions[0],analysis);
  const restored=normalizeFinalizedDayData(json(finalized));assert.ok(restored);assertMetadata(restored.sessions[0],analysis);
  const direct=buildDirectFinalizedDayDataExportPayload({record:restored,exportedAt:CONFIRMED_AT});assertMetadata(direct.daySnapshot.sessions[0],analysis);
  const all=buildAllFinalizedDayDataExportPayload({records:[restored],exportedAt:CONFIRMED_AT});assertMetadata(all.records[0].sessions[0],analysis);
  return {rates:rates(value),schema:getCurrentDataVersionInfo().dataSchemaVersion,analysis};
});
test("invalid optional historical comparison metadata is omitted without rejecting or recomputing captured rates",()=>{
  const original=decision(session({cycle:"summer"})).snapshot,evidence=[];
  for(const [field,invalid]of [["comfortAdjustmentAfterPercent",5],["temperatureDifferenceC",0],["comfortDecreased",false],["reason","not_target_session"],["version",2]]as const){
    const raw=json(original);(raw.eveningComfortRelief as unknown as Record<string,unknown>)[field]=invalid;
    const before=JSON.stringify(raw),normalized=normalizeRateDecisionSnapshot(raw);assert.ok(normalized);assert.equal(normalized.eveningComfortRelief,undefined);assert.deepEqual(normalized.display,original.display);assert.equal(normalized.displayedRatePercent,original.displayedRatePercent);assert.equal(normalized.weatherComfortAdjustmentPercent,original.weatherComfortAdjustmentPercent);assert.equal(JSON.stringify(raw),before);evidence.push({field,displayedRate:normalized.displayedRatePercent});
  }return evidence;
});
test("legacy captured evaluation, rate and historical bytes stay unchanged under new comparison forecasts", () => {
  memory.clear();const value=decision(session({cycle:"summer"}),{useRelief:false}),captured=daily(value);captured.appVersion="2026.8.9-45";captured.session.appVersion="2026.8.9-45";
  const oldRate=captured.areas.bento_men.rateDecisionSnapshot!,before=JSON.stringify(captured);assert.equal(oldRate.eveningComfortRelief,undefined);
  assert.deepEqual(normalizeRateDecisionSnapshot(json(oldRate)),oldRate);assert.deepEqual(reconstructRateDisplayFromSnapshot(oldRate),json(value.presentation.display));
  saveDailySessionSnapshots([captured]);const candidate=daily(decision(session({cycle:"summer"})));candidate.capturedAt=`${DATE}T09:00:00.000Z`;
  assert.equal(upsertDailySessionSnapshotSafely(candidate,{protectedDate:DATE}).ok,true);const stored=loadDailySessionSnapshots()[0];
  assert.deepEqual(stored.areas,json(captured.areas));assert.deepEqual(stored.basis,json(captured.basis));assert.equal(stored.capturedAt,captured.capturedAt);
  assert.deepEqual(mergeDailySessionSnapshotArchiveOperations([captured,candidate]),[json(captured)]);
  const day=createReview19DaySnapshot({capturedAt:CONFIRMED_AT,date:DATE,demandCycle:"summer",sessions:[captured],areaCountRecords:[]});
  const finalized=normalizeFinalizedDayData(day);assert.ok(finalized);const exported=buildAllFinalizedDayDataExportPayload({records:[finalized],exportedAt:CONFIRMED_AT});
  assert.deepEqual(exported.records[0].sessions[0].areas,json(captured.areas));assert.deepEqual(exported.records[0].sessions[0].basis,json(captured.basis));assert.equal(JSON.stringify(captured),before);
  return {historicalRates:rates(value),currentRates:rates(decision(session({cycle:"summer"}))),historyUnchanged:true};
});
if(process.env.EVENING_COMFORT_REPORT)writeFileSync(process.env.EVENING_COMFORT_REPORT,JSON.stringify({scope:"Production pure calculations, actual TSX SSR, storage and analysis export builders. Browser layout and full-hook actions have separate suites.",results},null,2));
console.log(`Evening comfort relief checks passed: ${results.length}/${results.length}`);
