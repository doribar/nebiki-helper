import assert from "node:assert/strict";
import { getAreaRouteFromStoredIds, getNormalRoute, LEGACY_AREA_MASTERS } from "../src/domain/area.ts";
import { createHumanEvaluationSelection, resolveHumanEvaluationForDiscount } from "../src/domain/humanEvaluation.ts";
import {
  getCurrentAreaSkipDecision, getNextPendingCandidate, getNextPriorityPendingCandidate,
  getPendingRemainingCount, getSkipTargetOptions,
} from "../src/domain/pending.ts";
import type { AreaCountEvaluation, AreaId, AreaProgress } from "../src/domain/types.ts";
import {
  getFirstNormalFlowAreaId, getNextNormalFlowAreaId, getNextNormalFlowAreaIdWithWrap,
  getNormalFlowContinuationAreaId, hasRemainingNormalFlowArea,
} from "../src/hooks/nebikiApp/normalFlow.ts";

const route = getNormalRoute("2026-10-19");
const tests: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void) => tests.push({ name, run });
function fixture(): Record<AreaId, AreaProgress> {
  return Object.fromEntries(LEGACY_AREA_MASTERS.map(({ id }) => [id, {
    areaId: id, status: "completed", areaJudge: "normal",
  }])) as Record<AreaId, AreaProgress>;
}
function skipped(areaId: AreaId, evaluation?: AreaCountEvaluation): AreaProgress {
  return { areaId, status: "skipped_manual", areaJudge: "normal", areaCountEvaluation: evaluation };
}
function priority(map: Record<AreaId, AreaProgress>, referenceAreaId: AreaId = "chuka_fish") {
  return getNextPriorityPendingCandidate({ areaProgressMap: map, referenceAreaId, normalFlowOrder: route });
}

test("many and slightly_many share one distance group regardless of insertion or skip order", () => {
  const map = fixture();
  map.fry_chicken = skipped("fry_chicken", "many");
  map.yakitori = skipped("yakitori", "slightly_many");
  assert.equal(priority(map)?.areaId, "yakitori");
  const reversed = Object.fromEntries(Object.entries(map).reverse()) as Record<AreaId, AreaProgress>;
  assert.equal(priority(reversed)?.areaId, "yakitori");
});

test("equal physical distance uses existing area order for a stable tie", () => {
  const map = fixture();
  map.yakitori = skipped("yakitori", "many");
  map.tempura = skipped("tempura", "slightly_many");
  const reversed = Object.fromEntries(Object.entries(map).reverse()) as Record<AreaId, AreaProgress>;
  assert.equal(priority(reversed, "croquette")?.areaId, "tempura");
});

test("the adopted evaluation overrides raw automatic and three-level areaJudge", () => {
  const map = fixture();
  map.fry_chicken = { ...skipped("fry_chicken", "normal"), areaJudge: "many",
    humanEvaluationDetails: { humanEvaluationScale: 5, humanEvaluationScore9: 5,
      humanEvaluationSelections: ["normal"], automaticEvaluation: "many", resolvedEvaluation: "normal",
      resolutionDirection: "none", resolutionReason: "legacy_5_level" } };
  assert.equal(priority(map), null);
  map.fry_chicken = { ...map.fry_chicken, areaCountEvaluation: "slightly_many", areaJudge: "normal",
    humanEvaluationDetails: { ...map.fry_chicken.humanEvaluationDetails!, automaticEvaluation: "normal",
      humanEvaluationScore9: 7, humanEvaluationSelections: ["slightly_many"], resolvedEvaluation: "slightly_many" } };
  assert.equal(priority(map)?.areaId, "fry_chicken");
  map.fry_chicken = { ...map.fry_chicken, areaCountEvaluation: "normal" };
  assert.equal(priority(map), null, "latest direct adopted value wins over older fallback metadata");
});

test("saved human intermediate resolution is used without resolving it again at return time", () => {
  const map = fixture();
  const selection = createHumanEvaluationSelection("normal", "slightly_many")!;
  const resolved = resolveHumanEvaluationForDiscount({ selection, demandCycle: "summer",
    sessionDiscountTime: "17", nowMs: Date.parse("2026-08-01T17:59:00+09:00"),
    evaluatedAt: "2026-08-01T17:59:00+09:00" });
  map.yakitori = { ...skipped("yakitori"), humanEvaluationDetails: resolved };
  assert.equal(priority(map), null);
  map.yakitori.humanEvaluationDetails = resolveHumanEvaluationForDiscount({ selection,
    demandCycle: "summer", sessionDiscountTime: "17", nowMs: Date.parse("2026-08-01T18:00:00+09:00"),
    evaluatedAt: "2026-08-01T18:00:00+09:00" });
  assert.equal(priority(map)?.areaId, "yakitori");
});

test("decision final fallback is adopted while a raw many base alone cannot create priority", () => {
  const map = fixture();
  map.yakitori = { ...skipped("yakitori"), areaCountDecisionBasis: {
    ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 3, requiredSampleSize: 3,
    baseEvaluation: "normal", finalEvaluation: "slightly_many",
  } };
  assert.equal(priority(map)?.areaId, "yakitori");
  map.yakitori.areaCountDecisionBasis = { ...map.yakitori.areaCountDecisionBasis!,
    baseEvaluation: "many", finalEvaluation: undefined };
  assert.equal(priority(map), null);
});

test("only explicit manual skips with an adopted many-side evaluation qualify", () => {
  const map = fixture();
  for (const status of ["unstarted", "completed", "postponed_few", "auto_skipped_late_time"] as const) {
    map.yakitori = { ...skipped("yakitori", "many"), status };
    assert.equal(priority(map), null, status);
  }
  for (const evaluation of [undefined, "normal", "slightly_few", "few"] as const) {
    map.yakitori = skipped("yakitori", evaluation);
    assert.equal(priority(map), null, String(evaluation));
  }
  map.yakitori = { ...skipped("yakitori"), areaJudge: "many" };
  assert.equal(priority(map), null, "three-level many is insufficient");
});

test("disabled and off-route seasonal targets are excluded even when preserved in the map", () => {
  const map = fixture();
  map.autumn = skipped("autumn", "many");
  map.ryomi = skipped("ryomi", "many");
  const before = structuredClone(map);
  assert.equal(priority(map), null);
  assert.equal(getNextPriorityPendingCandidate({ areaProgressMap: map, referenceAreaId: "tempura",
    normalFlowOrder: [...route, "autumn"] }), null);
  assert.deepEqual(map, before);
});

test("reference area never immediately selects itself and candidates are checked afresh", () => {
  const map = fixture();
  map.fry_chicken = skipped("fry_chicken", "many");
  map.yakitori = skipped("yakitori", "slightly_many");
  assert.equal(priority(map, "yakitori")?.areaId, "fry_chicken");
  map.yakitori.status = "completed";
  assert.equal(priority(map)?.areaId, "fry_chicken");
  map.fry_chicken.areaCountEvaluation = "normal";
  assert.equal(priority(map), null);
});

test("general pending retains ordinary and few work independently of new priority", () => {
  const map = fixture();
  map.fry_chicken = skipped("fry_chicken", "normal");
  map.tempura = { areaId: "tempura", status: "postponed_few", areaJudge: "few" };
  assert.equal(priority(map), null);
  assert.equal(getNextPendingCandidate({ areaProgressMap: map, referenceAreaId: "chuka_fish",
    normalFlowOrder: route })?.areaId, "fry_chicken");
  map.fry_chicken.status = "completed";
  assert.equal(getNextPendingCandidate({ areaProgressMap: map, referenceAreaId: "chuka_fish",
    normalFlowOrder: route })?.areaId, "tempura");
});

test("disabled saved pending is not counted or offered as a skip destination", () => {
  const map = fixture();
  map.autumn = skipped("autumn", "many");
  map.yakitori = skipped("yakitori", "many");
  const before = structuredClone(map);
  assert.equal(getPendingRemainingCount(map), 1);
  assert.deepEqual(getSkipTargetOptions({ areaProgressMap: map, currentAreaId: "yakitori" }), []);
  assert.equal(getCurrentAreaSkipDecision({ areaProgressMap: map, currentAreaId: "yakitori" }).canSkip, false);
  assert.equal(getNextPendingCandidate({ areaProgressMap: map, referenceAreaId: "yakitori" }), null);
  assert.deepEqual(map, before);
});

test("all normal traversal skips disabled saved work without modifying historical route or observations", () => {
  const map = fixture();
  map.autumn = { ...map.autumn, status: "unstarted", areaCount: 24, areaCountEvaluation: "many" };
  map.croquette = { ...map.croquette, status: "unstarted", areaJudge: null };
  const savedRoute = getAreaRouteFromStoredIds("2026-10-19", [...route, "autumn"]);
  const before = structuredClone({ map, savedRoute });
  assert.ok(savedRoute.includes("autumn"));
  assert.equal(getFirstNormalFlowAreaId(map, savedRoute), "croquette");
  assert.equal(getNextNormalFlowAreaId(map, "tempura", savedRoute), "croquette");
  assert.equal(getNextNormalFlowAreaIdWithWrap(map, "hosomaki", savedRoute), "croquette");
  map.croquette.status = "completed";
  assert.equal(hasRemainingNormalFlowArea(map, "tempura", savedRoute), false);
  map.croquette.status = "unstarted";
  assert.deepEqual({ map, savedRoute }, before);
});

test("normal continuation starts at the saved destination, skips finished work and never wraps backward", () => {
  const map = fixture();
  map.tempura = { ...map.tempura, status: "unstarted" };
  map.onigiri = { ...map.onigiri, status: "unstarted" };
  map.sushi = { ...map.sushi, status: "unstarted" };
  assert.equal(getNormalFlowContinuationAreaId(map, "onigiri", route), "onigiri");
  map.onigiri.status = "completed";
  assert.equal(getNormalFlowContinuationAreaId(map, "onigiri", route), "sushi");
  map.sushi.status = "completed";
  assert.equal(getNormalFlowContinuationAreaId(map, "onigiri", route), null);
  assert.equal(getNormalFlowContinuationAreaId(map, null, route), null);
});

test("an untouched auto-skip notice remains normal work but disabled notices do not", () => {
  const map = fixture();
  map.autumn = { ...map.autumn, status: "auto_skipped_late_time", visitedAt: undefined };
  map.onigiri = { ...map.onigiri, status: "auto_skipped_late_time", visitedAt: undefined };
  const savedRoute = getAreaRouteFromStoredIds("2026-10-19", [...route, "autumn"]);
  assert.equal(getFirstNormalFlowAreaId(map, savedRoute), "onigiri");
  map.onigiri.visitedAt = "2026-10-19T08:00:00Z";
  assert.equal(getFirstNormalFlowAreaId(map, savedRoute), null);
});

let passed = 0;
for (const { name, run } of tests) {
  try { run(); passed += 1; console.log(`PASS: ${name}`); }
  catch (error) { process.exitCode = 1; console.error(`FAIL: ${name}`, error); }
}
console.log(`\n${passed} / ${tests.length} priority pending55 pure checks passed.`);
