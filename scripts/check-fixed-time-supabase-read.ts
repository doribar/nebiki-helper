import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getAreaCountRecommendation,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { resolveAreaCountHistorySource } from "../src/domain/areaCountHistorySource.ts";
import {
  buildRemoteAreaCountRow,
  loadRemoteAreaCountRecords,
  type RemoteAreaCountLoadResult,
} from "../src/domain/areaCountRemoteStorage.ts";
import type { DemandCycle } from "../src/domain/types.ts";

const CURRENT_DATE = "2026-08-20";

function record(params: {
  date: string;
  count: number;
  demandCycle: DemandCycle;
  recordedAt?: string;
}): AreaCountRecord {
  return {
    date: params.date,
    sessionStartedAt: `${params.date}T06:00:00.000Z`,
    recordedAt: params.recordedAt ?? `${params.date}T06:30:00.000Z`,
    areaId: "sushi",
    discountTime: "17",
    actualWeekday: "木",
    actualWeekdayGroup: "火木日",
    count: params.count,
    demandCycle: params.demandCycle,
  };
}

const normalHistory = ["2026-07-23", "2026-07-30", "2026-08-06"].map(
  (date) => record({ date, count: 100, demandCycle: "normal" }),
);
const summerHistory = ["2026-07-23", "2026-07-30", "2026-08-06"].map(
  (date) => record({ date, count: 10, demandCycle: "summer" }),
);
const productionLocalOnly = record({
  date: "2026-07-16",
  count: 999,
  demandCycle: "normal",
});
const remoteResults: RemoteAreaCountLoadResult[] = [
  { status: "ready", records: normalHistory },
  { status: "ready", records: summerHistory },
];

let passed = 0;
function test(name: string, body: () => void | Promise<void>) {
  return Promise.resolve()
    .then(body)
    .then(() => {
      passed += 1;
      console.log(`PASS: ${name}`);
    });
}

await test("1. fixed-time history source is production Supabase rows only", () => {
  const source = resolveAreaCountHistorySource({
    mode: "fixed_time_readonly",
    localRecords: [productionLocalOnly],
    remoteResults,
  });
  assert.equal(source.remoteStatus, "ready");
  assert.equal(source.shouldPersistProductionCache, false);
  assert.equal(source.records.length, 6);
  assert.equal(source.records.some((item) => item.count === 999), false);
});

await test("2. production mode retains the existing local plus remote merge", () => {
  const source = resolveAreaCountHistorySource({
    mode: "production",
    localRecords: [productionLocalOnly],
    remoteResults,
  });
  assert.equal(source.remoteStatus, "ready");
  assert.equal(source.shouldPersistProductionCache, false);
  assert.equal(source.records.length, 7);
  assert.equal(source.records.some((item) => item.count === 999), true);
});

await test("3. fixed-time normal and summer medians stay separated", () => {
  const source = resolveAreaCountHistorySource({
    mode: "fixed_time_readonly",
    remoteResults,
  });
  const normal = getAreaCountRecommendation({
    records: source.records,
    areaId: "sushi",
    discountTime: "17",
    weekday: 4,
    date: CURRENT_DATE,
    demandCycle: "normal",
    count: 10,
  });
  const summer = getAreaCountRecommendation({
    records: source.records,
    areaId: "sushi",
    discountTime: "17",
    weekday: 4,
    date: CURRENT_DATE,
    demandCycle: "summer",
    count: 10,
  });
  assert.equal(normal.status, "ready");
  assert.equal(summer.status, "ready");
  assert.equal(normal.medianCount, 100);
  assert.equal(summer.medianCount, 10);
  assert.equal(normal.suggestedEvaluation, "few");
  assert.equal(summer.suggestedEvaluation, "normal");
  assert.equal(normal.matchedRecords.every((item) => item.demandCycle === "normal"), true);
  assert.equal(summer.matchedRecords.every((item) => item.demandCycle === "summer"), true);
});

await test("4. fixed-time uses exactly the normal recommendation algorithm", () => {
  const productionSource = resolveAreaCountHistorySource({
    mode: "production",
    localRecords: [],
    remoteResults,
  });
  const fixedSource = resolveAreaCountHistorySource({
    mode: "fixed_time_readonly",
    remoteResults,
  });
  for (const fixture of [
    {
      date: "2026-08-20",
      weekday: 4,
      applyObonRule: true,
      comparisonMode: "weekday" as const,
      actualWeekday: "木" as const,
      actualWeekdayGroup: "火木日" as const,
      status: "ready" as const,
    },
    {
      date: "2026-11-23",
      weekday: 1,
      applyObonRule: true,
      comparisonMode: "holiday_before_normal_weekday" as const,
      actualWeekday: "月" as const,
      actualWeekdayGroup: "翌日平日祝日" as const,
      status: "ready" as const,
    },
    {
      date: "2027-08-13",
      weekday: 5,
      applyObonRule: true,
      comparisonMode: "fallback_group" as const,
      actualWeekday: "金" as const,
      actualWeekdayGroup: "金土" as const,
      status: "insufficient" as const,
    },
  ]) {
    const params = {
      areaId: "sushi" as const,
      discountTime: "17" as const,
      demandCycle: "normal" as const,
      count: 10,
      ...fixture,
    };
    const production = getAreaCountRecommendation({
      ...params,
      records: productionSource.records,
    });
    const fixed = getAreaCountRecommendation({
      ...params,
      records: fixedSource.records,
    });
    assert.deepEqual(fixed, production);
    assert.equal(fixed.status, fixture.status);
    assert.equal(fixed.comparisonMode, fixture.comparisonMode);
    assert.equal(fixed.actualWeekday, fixture.actualWeekday);
    assert.equal(fixed.actualWeekdayGroup, fixture.actualWeekdayGroup);
  }
});

await test("5. remote failure never blocks fixed-time and invents no history", () => {
  const source = resolveAreaCountHistorySource({
    mode: "fixed_time_readonly",
    localRecords: [productionLocalOnly],
    remoteResults: [
      { status: "error", message: "offline", errorKind: "network" },
      { status: "disabled" },
    ],
  });
  assert.equal(source.remoteStatus, "error");
  assert.deepEqual(source.records, []);
  assert.equal(source.shouldPersistProductionCache, false);
});

await test("6. Supabase AreaCount history request is GET and cycle-filtered", async () => {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method });
    return new Response(
      JSON.stringify([
        buildRemoteAreaCountRow(summerHistory[0]!),
        buildRemoteAreaCountRow(normalHistory[0]!),
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const result = await loadRemoteAreaCountRecords("summer", {
    config: { url: "https://example.supabase.co", anonKey: "fixture-anon" },
    fetchImpl,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "GET");
  assert.match(calls[0]?.url ?? "", /demand_cycle=eq\.summer/);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.demandCycle, "summer");
  }
});

await test("7. hook keeps fixed-time production writes structurally gated", () => {
  const hook = readFileSync(
    new URL("../src/hooks/useNebikiApp.ts", import.meta.url),
    "utf8",
  );
  const fixedBranchStart = hook.indexOf(
    "if (isTestMode) {\n      // Fixed-time observations",
  );
  const remoteBranch = hook.slice(
    fixedBranchStart,
    hook.indexOf("\n\n    void Promise.all([", fixedBranchStart),
  );
  assert.match(remoteBranch, /mode: "fixed_time_readonly"/);
  assert.doesNotMatch(remoteBranch, /saveLocalAreaCountRecords/);
  assert.doesNotMatch(remoteBranch, /loadRemoteReview19Records/);

  const judgeBlock = hook.slice(
    hook.indexOf("function judgeCurrentArea"),
    hook.indexOf("function goBackOneScreen"),
  );
  assert.match(judgeBlock, /!isTestMode\s*&&[\s\S]*persistAreaCountRecordSafely/);
  const reviewSaveBlock = hook.slice(
    hook.indexOf("function saveReview19("),
    hook.indexOf("function start19DiscountAfterReview"),
  );
  assert.match(reviewSaveBlock, /if \(!isTestMode\)/);
  const syncBlock = hook.slice(
    hook.indexOf("async function syncLocalDataToSupabase"),
    hook.indexOf("function resetApp"),
  );
  assert.match(syncBlock, /if \(isTestMode\)/);
  assert.match(syncBlock, /skippedReason: "fixed_time_mode"/);
});

assert.equal(passed, 7);
console.log(`PASS: fixed-time Supabase read-only ${passed}/7`);
