import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getAreaEvaluationLowerQuickAdjustmentDelayMs } from "../src/domain/areaEvaluationAdjustment.ts";
import { getEarlyNextMinus5TargetDiscountTime, shouldReserveEarlyNextMinus5OnAutoTransition } from "../src/domain/earlyNextMinus5.ts";
import { getEveningComfortReliefContext } from "../src/domain/eveningComfortRelief.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { getCalendarWeekday } from "../src/domain/japaneseHoliday.ts";
import { normalizeDemandCycle } from "../src/domain/demandCycle.ts";
import { normalizeGlobalDiscountAdjustmentPercent } from "../src/domain/globalDiscountAdjustment.ts";
import { getFinalTimeGuide } from "../src/domain/discount.ts";
import { buildEarlyNextMinus5RateDecisionSnapshot, buildFinalDiscountGuideSnapshot, buildNormalRateDecisionSnapshot, buildRateDecisionSnapshot, normalizeRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import type { AppState, DemandCycle, DiscountTime, RateDecisionSnapshot, SessionData } from "../src/domain/types.ts";
import { getWeekdayBaseInfo, getBasisGuideDisplay } from "../src/domain/weekdayBase.ts";
import { formatLocalDate, getNextDoneDiscountInfo, resolveDiscountTime } from "../src/hooks/nebikiApp/clock.ts";
import { getOperationalEarlyNextMinus5TargetDiscountTime, shouldReserveOperationalEarlyNextMinus5OnAutoTransition } from "../src/hooks/nebikiApp/operationalTime.ts";
import { buildCurrentNormalRatePresentation, shouldIgnoreNormalTimeRateCap } from "../src/hooks/nebikiApp/ratePresentation.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { resolveSessionTemperatureComfort } from "../src/hooks/nebikiApp/temperatureComfortState.ts";
import { getNextSkipTargetDiscountTime } from "../src/hooks/nebikiApp/timeTransitions.ts";
import { getAutomaticReview19TransitionKey } from "../src/hooks/nebikiApp/review19Flow.ts";

// Executes current production hook declarations and pure domain modules.
// These are deterministic hook/domain checks; browser interaction is separate.
process.env.TZ = "Asia/Tokyo";
const DATE = "2026-09-08";
const at = (hour: number, minute = 0, second = 0) => new Date(2026, 8, 8, hour, minute, second);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let passed = 0;
function test(name: string, run: () => void) { run(); console.log(`PASS ${++passed}: ${name}`); }
function fixture(time: DiscountTime = "17", cycle: DemandCycle = "normal"): AppState {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const entry of Object.values(hourlyForecasts)) Object.assign(entry, {weather:"other",tempC:28,windMs:2});
  const session: SessionData = {date:DATE,weekday:2,discountTime:time,demandCycle:cycle,
    manualWeekdayOverride:false,manualDiscountTimeOverride:false,globalDiscountAdjustmentPercent:0,
    weather:{hourlyForecasts,afterRainSky:null},startedAt:at(time === "15" ? 15 : 17).toISOString()};
  const state = createInitialState(session); state.session=session; state.screen="rate_display"; state.currentAreaId="bento_men";
  Object.assign(state.areaProgressMap.bento_men,{areaJudge:"normal",areaCount:20,areaRateAdjustment:0});
  return state;
}
const hookSource = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("useNebikiApp.ts",hookSource,ts.ScriptTarget.Latest,true);
function find(predicate:(node:ts.Node)=>boolean):ts.Node {
  const nodes:ts.Node[]=[];const visit=(node:ts.Node)=>{if(predicate(node))nodes.push(node);ts.forEachChild(node,visit);};visit(ast);
  assert.equal(nodes.length,1,"one production declaration");return nodes[0];
}
function execute(source:string,context:Record<string,unknown>):unknown {
  return runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
}
function value<T>(name:string,context:Record<string,unknown>):T {
  const declaration=find(node=>ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name) as ts.VariableDeclaration;
  assert.ok(declaration.initializer);return context[name]=execute(`(${declaration.initializer.getText(ast)});`,context) as T;
}
function decision(time:DiscountTime,now:Date,cycle:DemandCycle="normal") {
  const state=fixture(time,cycle);
  const context:Record<string,unknown>={Date,state,nowMs:now.getTime(),actionNow:now,getAreaEvaluationLowerQuickAdjustmentDelayMs,isTestMode:false,applyObonRule:true,
    sessionSource:state.session,lastSessionWeather:null,savedDailySessionSnapshots:[],useMemo:(get:()=>unknown)=>get(),
    getOperationalEarlyNextMinus5TargetDiscountTime,getWeekdayBaseInfo,getBasisGuideDisplay,getEveningComfortReliefContext,
    resolveSessionTemperatureComfort,normalizeDemandCycle,normalizeGlobalDiscountAdjustmentPercent,
    shouldIgnoreNormalTimeRateCap,buildCurrentNormalRatePresentation,buildRateDecisionSnapshot,
    clickedAreaId:"bento_men",clickedProgress:state.areaProgressMap.bento_men,completedAt:now.toISOString(),finalGuide:null};
  for(const name of ["sessionSourceResolvedWeather","weekdayBaseInfo","earlyNextMinus5Info","lateTimeBonus","ignoreNormalTimeRateCap",
    "effectiveRateDiscountTime","effectiveRateIgnoreTimeRateCap","currentAreaProgress"]) value(name,context);
  const presentation=value<ReturnType<typeof buildCurrentNormalRatePresentation>>("ratePresentation",context);
  value("daytimeSession",context);
  assert.equal(value("actionLateTimeBonus",context),context.lateTimeBonus,"fresh click preparation agrees with the same-clock display bonus");
  const snapshot=value<RateDecisionSnapshot>("clickedRateDecisionSnapshot",context);
  return {state,context,presentation,snapshot};
}

test("new automatic time is15 before16:40 and17 for the remaining day, including retired night boundaries",()=>{
  for(const [hour,minute,expected] of [[0,0,"15"],[16,39,"15"],[16,40,"17"],[18,0,"17"],[18,25,"17"],[19,25,"17"],[20,25,"17"],[23,59,"17"]] as const){
    assert.equal(resolveDiscountTime(at(hour,minute)),expected);
  }
  assert.equal(resolveDiscountTime(at(16,39,59)),"15");
});
test("Done next session has only15→17, with the existing16:40 unlock",()=>{
  assert.equal(getNextDoneDiscountInfo("15",at(16,39))?.canStart,false);
  assert.equal(getNextDoneDiscountInfo("15",at(16,40))?.canStart,true);
  assert.equal(getNextDoneDiscountInfo("15",at(16,40))?.targetDiscountTime,"17");
  for(const time of ["17","18","19","20"] as const)for(const [h,m] of [[18,25],[19,25],[20,25],[23,59]])assert.equal(getNextDoneDiscountInfo(time,at(h,m)),null);
});
test("actual draft clock sync keeps a legitimate15/17 weather lock across16:40 and later night boundaries",()=>{
  const declaration=find(node=>ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==="syncDraftTime") as ts.VariableDeclaration;
  assert.ok(declaration.initializer);
  for(const lock of [null,"15","17"] as const){
    let state=fixture("15");state.session=null;state.screen="start";state.sessionDraft.discountTime=lock??"15";state.sessionDraft.weatherInputLockedDiscountTime=lock;
    for(const now of [at(16,40),at(18,25),at(19,25),at(20,25)]){
      execute(`(${declaration.initializer.getText(ast)})();`,{isTestMode:false,timeSwitchTarget:null,getRuntimeNow:()=>now,
        resolveDiscountTime,formatLocalDate,getCalendarWeekday,setState:(update:(state:AppState)=>AppState)=>{state=update(state);}});
      assert.equal(state.sessionDraft.discountTime,lock??"17");assert.equal(state.sessionDraft.weatherInputLockedDiscountTime,lock);
    }
  }
});
test("operation early and reservation helpers cannot introduce a night target, while legacy helpers retain old behavior",()=>{
  for(const time of ["15","17","18","19","20"] as const)for(const [h,m] of [[18,0],[18,25],[19,0],[19,25],[20,25]]){
    assert.equal(getOperationalEarlyNextMinus5TargetDiscountTime({discountTime:time,manualDiscountTimeOverride:false,nowMs:at(h,m).getTime()}),null);
    assert.equal(getNextSkipTargetDiscountTime(time),null);
  }
  const reservation={screen:"rate_display",currentTargetDiscountTime:"18" as const,nextTargetDiscountTime:"18"};
  assert.equal(shouldReserveOperationalEarlyNextMinus5OnAutoTransition(reservation),false);
  assert.equal(shouldReserveEarlyNextMinus5OnAutoTransition(reservation),true);
  assert.equal(getEarlyNextMinus5TargetDiscountTime({discountTime:"17",manualDiscountTimeOverride:false,nowMs:at(18,25).getTime()}),"18");
  assert.equal(getEarlyNextMinus5TargetDiscountTime({discountTime:"18",manualDiscountTimeOverride:false,nowMs:at(19,0).getTime()}),"19");
});
for(const cycle of ["normal","summer"] as const)for(const [hour,minute] of [[17,59],[18,0],[18,25],[19,25],[20,25]]){
  test(`actual ${cycle}17 hook ${hour}:${minute} keeps17 and applies only the18:00+ late5`,()=>{
    const result=decision("17",at(hour,minute),cycle);
    const late=hour>=18?5:0;
    assert.equal(result.context.earlyNextMinus5Info,null);assert.equal(result.context.effectiveRateDiscountTime,"17");
    assert.deepEqual([result.presentation?.display.normal.main,result.presentation?.display.many.main],[`${10+late}%`,`${20+late}%`]);
    assert.equal(result.snapshot.sessionDiscountTime,"17");assert.equal(result.snapshot.effectiveRateDiscountTime,"17");
    assert.equal(result.snapshot.calculationMode,late?"late_plus5":"normal");assert.equal(result.snapshot.earlyNextAdjustmentPercent,0);assert.equal(result.snapshot.lateTimeAdjustmentPercent,late);
    assert.deepEqual(clone(result.snapshot.display),clone(result.presentation?.display));
  });
}
test("actual15 hook retains+5 at16:00 and captures late_plus5 while its session identity stays15",()=>{
  const before=decision("15",at(15,59)),after=decision("15",at(16));
  assert.deepEqual([before.presentation?.display.normal.main,before.presentation?.display.many.main],["0%","10%"]);
  assert.deepEqual([after.presentation?.display.normal.main,after.presentation?.display.many.main],["5%","15%"]);
  assert.equal(after.snapshot.sessionDiscountTime,"15");assert.equal(after.snapshot.effectiveRateDiscountTime,"15");
  assert.equal(after.snapshot.calculationMode,"late_plus5");assert.equal(after.snapshot.lateTimeAdjustmentPercent,5);
});
test("Review19 remains18:55+ without an upper bound or a night-input reservation dependency",()=>{
  const state=fixture();assert.equal(getAutomaticReview19TransitionKey({state,now:at(18,54)}),null);
  for(const [hour,minute]of [[18,55],[19,25],[20,25],[23,59]])assert.ok(getAutomaticReview19TransitionKey({state,now:at(hour,minute),hasTransitionedTo1830:true}));
});
test("captured legacy night18/19/20 and early snapshots remain unchanged under generic normalization",()=>{
  const resolvedWeather=resolveWeatherInputForDiscount(fixture().session!.weather,"17");
  const common={confirmedAt:at(18,5).toISOString(),weatherComfortAdjustmentPercent:0,areaJudge:"normal" as const,areaRateAdjustment:0 as const,resolvedWeather};
  const legacy=[buildNormalRateDecisionSnapshot({...common,sessionDiscountTime:"18"}),buildNormalRateDecisionSnapshot({...common,sessionDiscountTime:"19"}),
    buildEarlyNextMinus5RateDecisionSnapshot({...common,sessionDiscountTime:"17",effectiveRateDiscountTime:"18"}),
    buildEarlyNextMinus5RateDecisionSnapshot({...common,sessionDiscountTime:"18",effectiveRateDiscountTime:"19"}),
    buildFinalDiscountGuideSnapshot({confirmedAt:common.confirmedAt,resolvedWeather,finalGuide:getFinalTimeGuide({weekday:2,weather21:"snow",temp21C:28,comfortScore:0})})]
    .map(snapshot=>({...clone(snapshot),appVersion:"2026.8.9-48",buildId:"legacy48-captured"}));
  assert.deepEqual(legacy.map(snapshot=>snapshot.displayedRateText),["20%","30%","15%","25%","50%"]);
  for(const snapshot of legacy){
    const state=fixture(snapshot.sessionDiscountTime),before=JSON.stringify(snapshot);
    state.screen="done";state.currentAreaId=null;Object.assign(state.areaProgressMap.bento_men,{status:"completed",rateDecisionSnapshot:snapshot,
      completedRateText:snapshot.displayedRateText,completedNormalRateText:snapshot.displayedRateText,completedManyRateText:`${snapshot.displayedManyRatePercent}%`});
    const normalized=normalizeLoadedState(clone(state),state.sessionDraft);
    assert.equal(normalized.session?.discountTime,state.session!.discountTime);assert.deepEqual(normalized.areaProgressMap.bento_men.rateDecisionSnapshot,snapshot);
    assert.deepEqual(normalizeRateDecisionSnapshot(clone(snapshot)),snapshot);assert.equal(JSON.stringify(snapshot),before);
  }
});
console.log(`daytime time49 checks passed: ${passed}/${passed}`);
