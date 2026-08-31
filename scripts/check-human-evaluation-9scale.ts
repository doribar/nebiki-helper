import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  areHumanEvaluationsAdjacent,
  createHumanEvaluationSelection,
  createReview19HumanEvaluationDetails,
  getEvaluationFromOddHumanScore,
  getHumanEvaluationSecondChoices,
  getLegacyHumanEvaluationDetails,
  HUMAN_EVALUATION_LONG_PRESS_MS,
  normalizeHumanEvaluationDetails,
  resolveHumanEvaluationDetails,
  resolveHumanEvaluationForDiscount,
} from "../src/domain/humanEvaluation.ts";
import { buildRemoteAreaCountRow } from "../src/domain/areaCountRemoteStorage.ts";
import { DATA_SCHEMA_VERSION } from "../src/domain/dataVersion.ts";
import type { AreaCountRecord } from "../src/domain/areaCountHistory.ts";
import type {
  AreaCountEvaluation,
  DemandCycle,
  HumanEvaluationScore9,
  HumanEvaluationSelection,
} from "../src/domain/types.ts";

let passed = 0;
let failed = 0;

function test(name: string, run: () => void) {
  try {
    run();
    passed += 1;
    console.log(`PASS: ${String(passed + failed).padStart(2, "0")}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${String(passed + failed).padStart(2, "0")}. ${name}`);
    console.error(error);
  }
}

const EVALUATIONS_ASCENDING: AreaCountEvaluation[] = [
  "few",
  "slightly_few",
  "normal",
  "slightly_many",
  "many",
];

const ODD_CASES: Array<{
  evaluation: AreaCountEvaluation;
  score: HumanEvaluationScore9;
}> = [
  { evaluation: "few", score: 1 },
  { evaluation: "slightly_few", score: 3 },
  { evaluation: "normal", score: 5 },
  { evaluation: "slightly_many", score: 7 },
  { evaluation: "many", score: 9 },
];

const EVEN_CASES: Array<{
  lower: AreaCountEvaluation;
  higher: AreaCountEvaluation;
  score: HumanEvaluationScore9;
}> = [
  { lower: "few", higher: "slightly_few", score: 2 },
  { lower: "slightly_few", higher: "normal", score: 4 },
  { lower: "normal", higher: "slightly_many", score: 6 },
  { lower: "slightly_many", higher: "many", score: 8 },
];

function requireSelection(
  first: AreaCountEvaluation,
  second?: AreaCountEvaluation,
): HumanEvaluationSelection {
  const selection = createHumanEvaluationSelection(first, second);
  assert.ok(selection, `${first}/${second ?? "single"} must be selectable`);
  return selection;
}

function assertRejected(raw: unknown, label: string) {
  assert.equal(
    normalizeHumanEvaluationDetails(raw),
    undefined,
    `${label} must be rejected`,
  );
}

test("the shared long-press threshold stays at 500 ms", () => {
  assert.equal(HUMAN_EVALUATION_LONG_PRESS_MS, 500);
});

test("single selections cover all five odd scores without changing the raw choice", () => {
  const observedScores: HumanEvaluationScore9[] = [];

  for (const { evaluation, score } of ODD_CASES) {
    const selection = requireSelection(evaluation);
    const sameItemSelection = requireSelection(evaluation, evaluation);
    const before = JSON.stringify(selection);
    const details = resolveHumanEvaluationForDiscount({
      selection,
      demandCycle: "normal",
      sessionDiscountTime: "15",
      nowMs: Date.parse("2026-08-09T06:00:00.000Z"),
      evaluatedAt: "2026-08-09T06:00:00.000Z",
    });

    observedScores.push(selection.humanEvaluationScore9);
    assert.deepEqual(selection, {
      humanEvaluationScore9: score,
      humanEvaluationSelections: [evaluation],
    });
    assert.deepEqual(sameItemSelection, selection);
    assert.equal(getEvaluationFromOddHumanScore(score), evaluation);
    assert.equal(details.humanEvaluationScore9, score);
    assert.deepEqual(details.humanEvaluationSelections, [evaluation]);
    assert.equal(details.humanEvaluationScale, 9);
    assert.equal(details.resolvedEvaluation, evaluation);
    assert.equal(details.resolutionDirection, "none");
    assert.equal(details.resolutionReason, "single_selection");
    assert.equal(JSON.stringify(selection), before, "resolver mutated raw selection");
    assert.ok(normalizeHumanEvaluationDetails(details));
  }

  assert.deepEqual(observedScores, [1, 3, 5, 7, 9]);
});

test("adjacent pairs cover all even scores in either order and reject non-adjacent pairs", () => {
  const observedScores = new Set<HumanEvaluationScore9>();

  for (let firstIndex = 0; firstIndex < EVALUATIONS_ASCENDING.length; firstIndex += 1) {
    const first = EVALUATIONS_ASCENDING[firstIndex];
    const expectedSecondChoices = EVALUATIONS_ASCENDING.filter(
      (_, secondIndex) => Math.abs(firstIndex - secondIndex) <= 1,
    );
    assert.deepEqual(getHumanEvaluationSecondChoices(first), expectedSecondChoices);

    for (let secondIndex = 0; secondIndex < EVALUATIONS_ASCENDING.length; secondIndex += 1) {
      const second = EVALUATIONS_ASCENDING[secondIndex];
      const adjacent = Math.abs(firstIndex - secondIndex) === 1;
      assert.equal(areHumanEvaluationsAdjacent(first, second), adjacent);

      if (Math.abs(firstIndex - secondIndex) > 1) {
        assert.equal(
          createHumanEvaluationSelection(first, second),
          null,
          `non-adjacent ${first}/${second} was accepted`,
        );
      }
    }
  }

  for (const { lower, higher, score } of EVEN_CASES) {
    const ascending = requireSelection(lower, higher);
    const reversed = requireSelection(higher, lower);
    observedScores.add(ascending.humanEvaluationScore9);
    observedScores.add(reversed.humanEvaluationScore9);
    assert.equal(ascending.humanEvaluationScore9, score);
    assert.equal(reversed.humanEvaluationScore9, score);
    assert.deepEqual(ascending.humanEvaluationSelections, [lower, higher]);
    assert.deepEqual(reversed.humanEvaluationSelections, [higher, lower]);
    assert.equal(getEvaluationFromOddHumanScore(score), null);
  }

  assert.deepEqual([...observedScores].sort((a, b) => a - b), [2, 4, 6, 8]);
});

test("scores 1 through 9 are all constructible and no other score is normalized", () => {
  const scores = [
    ...ODD_CASES.map(({ evaluation }) => requireSelection(evaluation).humanEvaluationScore9),
    ...EVEN_CASES.map(({ lower, higher }) =>
      requireSelection(lower, higher).humanEvaluationScore9
    ),
  ].sort((a, b) => a - b);
  assert.deepEqual(scores, [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  const valid = resolveHumanEvaluationForDiscount({
    selection: requireSelection("few"),
    demandCycle: "normal",
    sessionDiscountTime: "15",
    nowMs: 0,
    evaluatedAt: "1970-01-01T00:00:00.000Z",
  });
  assertRejected({ ...valid, humanEvaluationScore9: 0 }, "score 0");
  assertRejected({ ...valid, humanEvaluationScore9: 10 }, "score 10");
  assertRejected({ ...valid, humanEvaluationScore9: 1.5 }, "fractional score");
});

test("normal-cycle even scores resolve lower at 15 and higher from 17", () => {
  for (const { lower, higher, score } of EVEN_CASES) {
    const selection = requireSelection(higher, lower);
    const rawBefore = JSON.stringify(selection);
    const at15 = resolveHumanEvaluationForDiscount({
      selection,
      demandCycle: "normal",
      sessionDiscountTime: "15",
      nowMs: Date.parse("2026-08-09T06:00:00.000Z"),
      evaluatedAt: "2026-08-09T06:00:00.000Z",
    });
    const at17 = resolveHumanEvaluationForDiscount({
      selection,
      demandCycle: "normal",
      sessionDiscountTime: "17",
      nowMs: Date.parse("2026-08-09T08:00:00.000Z"),
      evaluatedAt: "2026-08-09T08:00:00.000Z",
    });

    assert.equal(at15.humanEvaluationScore9, score);
    assert.deepEqual(at15.humanEvaluationSelections, [higher, lower]);
    assert.equal(at15.resolvedEvaluation, lower);
    assert.equal(at15.resolutionDirection, "lower");
    assert.equal(at15.resolutionReason, "normal_15");
    assert.equal(at17.resolvedEvaluation, higher);
    assert.equal(at17.resolutionDirection, "higher");
    assert.equal(at17.resolutionReason, "normal_17_or_later");
    assert.equal(JSON.stringify(selection), rawBefore, "raw pair changed during resolution");
    assert.ok(normalizeHumanEvaluationDetails(at15));
    assert.ok(normalizeHumanEvaluationDetails(at17));
  }
});

test("summer-cycle even scores switch at JST 17:59/18:00", () => {
  const beforeMs = Date.UTC(2026, 7, 9, 8, 59);
  const afterMs = Date.UTC(2026, 7, 9, 9, 0);

  for (const { lower, higher } of EVEN_CASES) {
    const selection = requireSelection(lower, higher);
    const before = resolveHumanEvaluationForDiscount({
      selection,
      demandCycle: "summer",
      sessionDiscountTime: "18",
      nowMs: beforeMs,
      evaluatedAt: new Date(beforeMs).toISOString(),
    });
    const after = resolveHumanEvaluationForDiscount({
      selection,
      demandCycle: "summer",
      sessionDiscountTime: "18",
      nowMs: afterMs,
      evaluatedAt: new Date(afterMs).toISOString(),
    });

    assert.equal(before.resolvedEvaluation, lower);
    assert.equal(before.resolutionDirection, "lower");
    assert.equal(before.resolutionReason, "summer_before_1800");
    assert.equal(after.resolvedEvaluation, higher);
    assert.equal(after.resolutionDirection, "higher");
    assert.equal(after.resolutionReason, "summer_1800_or_later");
    assert.ok(normalizeHumanEvaluationDetails(before));
    assert.ok(normalizeHumanEvaluationDetails(after));
  }
});

test("summer-cycle guidance points match 15:00/17:00 lower and 18:30 higher", () => {
  const selection = requireSelection("normal", "slightly_few");
  const cases = [
    { discountTime: "15" as const, nowMs: Date.UTC(2026, 7, 9, 6, 0), expected: "lower" },
    { discountTime: "17" as const, nowMs: Date.UTC(2026, 7, 9, 8, 0), expected: "lower" },
    { discountTime: "18" as const, nowMs: Date.UTC(2026, 7, 9, 9, 30), expected: "higher" },
  ];

  for (const entry of cases) {
    const details = resolveHumanEvaluationForDiscount({
      selection,
      demandCycle: "summer",
      sessionDiscountTime: entry.discountTime,
      nowMs: entry.nowMs,
      evaluatedAt: new Date(entry.nowMs).toISOString(),
    });
    assert.equal(details.resolutionDirection, entry.expected);
  }
});

test("resolution preserves raw score, selection order, and caller-owned objects", () => {
  const selection = requireSelection("normal", "slightly_few");
  const selectionBefore = JSON.stringify(selection);
  const details = resolveHumanEvaluationForDiscount({
    selection,
    demandCycle: "normal",
    sessionDiscountTime: "17",
    nowMs: Date.parse("2026-08-09T08:00:00.000Z"),
    evaluatedAt: "2026-08-09T08:00:00.000Z",
  });
  const detailsBefore = JSON.stringify(details);
  const normalized = normalizeHumanEvaluationDetails(details);

  assert.equal(details.humanEvaluationScore9, selection.humanEvaluationScore9);
  assert.deepEqual(details.humanEvaluationSelections, selection.humanEvaluationSelections);
  assert.deepEqual(normalized?.humanEvaluationSelections, ["normal", "slightly_few"]);
  assert.equal(JSON.stringify(selection), selectionBefore);
  assert.equal(JSON.stringify(details), detailsBefore);
  assert.notEqual(normalized, details, "normalization should return a defensive object");
  assert.notEqual(
    normalized?.humanEvaluationSelections,
    details.humanEvaluationSelections,
    "normalization should return a defensive selection tuple",
  );
});

test("legacy five-level values derive compatible odd raw scores", () => {
  for (const { evaluation, score } of ODD_CASES) {
    const legacy = getLegacyHumanEvaluationDetails(evaluation);
    const derived = resolveHumanEvaluationDetails(undefined, evaluation);
    assert.deepEqual(legacy, {
      humanEvaluationScore9: score,
      humanEvaluationScale: 5,
      humanEvaluationSelections: [evaluation],
      resolvedEvaluation: evaluation,
      resolutionDirection: "none",
      resolutionReason: "legacy_5_level",
    });
    assert.deepEqual(derived, legacy);
    const normalized = normalizeHumanEvaluationDetails(legacy);
    assert.equal(normalized?.humanEvaluationScale, 5);
    assert.equal(normalized?.humanEvaluationScore9, score);
    assert.equal(normalized?.resolvedEvaluation, evaluation);
  }
});

test("normalizer rejects malformed cross-field combinations", () => {
  const evaluatedAt = "2026-08-09T06:00:00.000Z";
  const even = resolveHumanEvaluationForDiscount({
    selection: requireSelection("few", "slightly_few"),
    demandCycle: "normal",
    sessionDiscountTime: "15",
    nowMs: Date.parse(evaluatedAt),
    evaluatedAt,
  });
  const odd = resolveHumanEvaluationForDiscount({
    selection: requireSelection("normal"),
    demandCycle: "normal",
    sessionDiscountTime: "15",
    nowMs: Date.parse(evaluatedAt),
    evaluatedAt,
  });
  const review = createReview19HumanEvaluationDetails({
    selection: requireSelection("few", "slightly_few"),
    demandCycle: "normal",
    evaluatedAt: "2026-08-09T10:00:00.000Z",
  });

  const malformed: Array<[string, unknown]> = [
    ["score/selection mismatch", { ...even, humanEvaluationScore9: 4 }],
    [
      "non-adjacent pair",
      { ...even, humanEvaluationScore9: 2, humanEvaluationSelections: ["few", "normal"] },
    ],
    ["scale 5 with a pair", { ...even, humanEvaluationScale: 5 }],
    ["even pair marked as single", { ...even, resolutionReason: "single_selection" }],
    ["odd item marked as range", { ...odd, resolutionReason: "normal_15" }],
    ["wrong lower resolved value", { ...even, resolvedEvaluation: "slightly_few" }],
    ["wrong lower direction", { ...even, resolutionDirection: "higher" }],
    ["15 session marked 17+", { ...even, resolutionReason: "normal_17_or_later" }],
    ["normal reason with summer cycle", { ...even, demandCycle: "summer" }],
    ["invalid evaluatedAt", { ...even, evaluatedAt: "not-a-date" }],
    ["review observation with resolved value", { ...review, resolvedEvaluation: "few" }],
    ["review observation with discount direction", { ...review, resolutionDirection: "lower" }],
    ["review observation outside 19", { ...review, sessionDiscountTime: "18" }],
  ];

  for (const [label, raw] of malformed) assertRejected(raw, label);
});

test("summer reason must agree with evaluatedAt across the JST boundary", () => {
  const beforeMs = Date.UTC(2026, 7, 9, 8, 59);
  const afterMs = Date.UTC(2026, 7, 9, 9, 0);
  const before = resolveHumanEvaluationForDiscount({
    selection: requireSelection("few", "slightly_few"),
    demandCycle: "summer",
    sessionDiscountTime: "18",
    nowMs: beforeMs,
    evaluatedAt: new Date(beforeMs).toISOString(),
  });
  const after = resolveHumanEvaluationForDiscount({
    selection: requireSelection("few", "slightly_few"),
    demandCycle: "summer",
    sessionDiscountTime: "18",
    nowMs: afterMs,
    evaluatedAt: new Date(afterMs).toISOString(),
  });

  assertRejected(
    { ...before, evaluatedAt: new Date(afterMs).toISOString() },
    "before-18 reason with an 18:00 timestamp",
  );
  assertRejected(
    { ...after, evaluatedAt: new Date(beforeMs).toISOString() },
    "18+ reason with a 17:59 timestamp",
  );
});

test("Review19 records raw odd/even observations without resolving for discount", () => {
  const cases: Array<{ selection: HumanEvaluationSelection; demandCycle: DemandCycle }> = [
    { selection: requireSelection("normal"), demandCycle: "normal" },
    { selection: requireSelection("slightly_many", "normal"), demandCycle: "summer" },
  ];

  for (const { selection, demandCycle } of cases) {
    const rawBefore = JSON.stringify(selection);
    const details = createReview19HumanEvaluationDetails({
      selection,
      demandCycle,
      evaluatedAt: "2026-08-09T10:00:00.000Z",
    });
    assert.equal(details.humanEvaluationScore9, selection.humanEvaluationScore9);
    assert.deepEqual(details.humanEvaluationSelections, selection.humanEvaluationSelections);
    assert.equal(details.humanEvaluationScale, 9);
    assert.equal(details.resolvedEvaluation, undefined);
    assert.equal(Object.hasOwn(details, "resolvedEvaluation"), false);
    assert.equal(details.resolutionDirection, "not_applicable");
    assert.equal(details.resolutionReason, "review19_observation");
    assert.equal(details.sessionDiscountTime, "19");
    assert.equal(JSON.stringify(selection), rawBefore);
    assert.ok(normalizeHumanEvaluationDetails(details));
  }
});

test("both manual UIs retain one shared five-button selector and long-press safeguards", () => {
  const selectorSource = readFileSync(
    new URL("../src/components/common/HumanEvaluationSelector.tsx", import.meta.url),
    "utf8",
  );
  const areaJudgeSource = readFileSync(
    new URL("../src/components/screens/AreaJudgeScreen.tsx", import.meta.url),
    "utf8",
  );
  const review19Source = readFileSync(
    new URL("../src/components/screens/Review19Screen.tsx", import.meta.url),
    "utf8",
  );
  const displayOptionsBlock =
    selectorSource.match(/const DISPLAY_OPTIONS:[\s\S]*?=\s*\[([\s\S]*?)\n\];/)?.[1] ?? "";
  const displayedValues = [...displayOptionsBlock.matchAll(/\bvalue:\s*"([^"]+)"/g)]
    .map((match) => match[1]);

  assert.deepEqual(displayedValues, [
    "many",
    "slightly_many",
    "normal",
    "slightly_few",
    "few",
  ]);
  assert.ok(selectorSource.includes("HUMAN_EVALUATION_LONG_PRESS_MS"));
  assert.ok(selectorSource.includes("onPointerUp={handlePointerUp}"));
  assert.ok(selectorSource.includes("suppressNextClickRef.current = true"));
  assert.ok(selectorSource.includes("onClickCapture={(event) =>"));
  assert.ok(selectorSource.includes("event.preventDefault()"));
  assert.ok(selectorSource.includes("event.stopPropagation()"));
  assert.ok(selectorSource.includes("onPointerCancel={handlePointerCancel}"));
  assert.ok(selectorSource.includes("onLostPointerCapture={handleLostPointerCapture}"));
  assert.ok(selectorSource.includes("POINTER_MOVE_CANCEL_PX"));
  assert.ok(selectorSource.includes('window.addEventListener("blur"'));
  assert.ok(selectorSource.includes('document.addEventListener("visibilitychange"'));
  assert.ok(selectorSource.includes("onClick={cancelIntermediateSelection}"));
  assert.ok(selectorSource.includes("navigator.vibrate(15)"));
  assert.ok(selectorSource.includes("onContextMenu={(event) => event.preventDefault()}"));
  assert.ok(selectorSource.includes('gridTemplateColumns: "repeat(5, minmax(0, 1fr))"'));

  for (const [name, source, layout] of [
    ["AreaJudge", areaJudgeSource, "stacked"],
    ["Review19", review19Source, "compact"],
  ] as const) {
    assert.match(source, /import\s+\{\s*HumanEvaluationSelector\s*\}/);
    assert.equal((source.match(/<HumanEvaluationSelector\b/g) ?? []).length, 1);
    assert.ok(source.includes(`layout="${layout}"`), `${name} lost ${layout} layout`);
    assert.ok(
      source.includes("onLongPressActivated={cancelSwipeGesture}"),
      `${name} no longer cancels swipe after a long press`,
    );
  }
});

test("the hook resolves discount values with the fixed-time-aware runtime clock", () => {
  const hookSource = readFileSync(
    new URL("../src/hooks/useNebikiApp.ts", import.meta.url),
    "utf8",
  );
  const resolverCallIndex = hookSource.indexOf("resolveHumanEvaluationForDiscount({");
  const actionClockIndex = hookSource.lastIndexOf(
    "const actionNow = getRuntimeNow();",
    resolverCallIndex,
  );
  const resolverBlockEnd = hookSource.indexOf(
    "const resolvedManualEvaluation",
    resolverCallIndex,
  );
  const resolverBlock = hookSource.slice(actionClockIndex, resolverBlockEnd);

  assert.match(hookSource, /setRuntimeNowOverride\(params\?\.testNow\s*\?\?\s*null\)/);
  assert.ok(resolverCallIndex >= 0);
  assert.ok(actionClockIndex >= 0 && actionClockIndex < resolverCallIndex);
  assert.ok(resolverBlockEnd > resolverCallIndex);
  assert.ok(resolverBlock.includes("const actionAt = actionNow.toISOString();"));
  assert.ok(resolverBlock.includes("resolveHumanEvaluationForDiscount({"));
  assert.ok(resolverBlock.includes("nowMs: actionNow.getTime()"));
  assert.ok(resolverBlock.includes("evaluatedAt: actionAt"));
  assert.ok(!resolverBlock.includes("Date.now()"));
  assert.ok(!resolverBlock.includes("new Date("));
  assert.ok(hookSource.includes("manualAreaCountResult ?? readyAreaCountResult"));

  const updateReview19Start = hookSource.indexOf("function updateReview19AreaCount(");
  const updateReview19End = hookSource.indexOf("function skipReview19Area(", updateReview19Start);
  const updateReview19Block = hookSource.slice(updateReview19Start, updateReview19End);
  assert.ok(updateReview19Start >= 0 && updateReview19End > updateReview19Start);
  assert.ok(updateReview19Block.includes("createReview19HumanEvaluationDetails({"));
  assert.ok(!updateReview19Block.includes("resolveHumanEvaluationForDiscount({"));
});

test("raw metadata roundtrips losslessly through the cycle-aware Supabase JSONB row", () => {
  const details = resolveHumanEvaluationForDiscount({
    selection: requireSelection("few", "slightly_few"),
    demandCycle: "normal",
    sessionDiscountTime: "17",
    nowMs: Date.parse("2026-08-09T08:00:00.000Z"),
    evaluatedAt: "2026-08-09T08:00:00.000Z",
  });
  const localRecord: AreaCountRecord = {
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    appVersion: "test",
    buildId: "test-build",
    demandCycle: "normal",
    date: "2026-08-09",
    sessionStartedAt: "2026-08-09T08:00:00.000Z",
    recordedAt: "2026-08-09T08:01:00.000Z",
    areaId: "bento_men",
    discountTime: "17",
    actualWeekday: "日",
    actualWeekdayGroup: "金土日",
    count: 42,
    userJudge: details.resolvedEvaluation,
    humanEvaluationDetails: details,
  };
  const remoteRow = buildRemoteAreaCountRow(localRecord);

  assert.equal(DATA_SCHEMA_VERSION, 3);
  assert.deepEqual(Object.keys(remoteRow).sort(), [
    "actual_weekday",
    "actual_weekday_group",
    "app_version",
    "area_id",
    "build_id",
    "count",
    "data_schema_version",
    "date",
    "demand_cycle",
    "discount_time",
    "record_details",
    "recorded_at",
    "session_started_at",
  ]);
  assert.equal(remoteRow.demand_cycle, "normal");
  assert.equal(
    remoteRow.record_details?.humanEvaluationDetails?.humanEvaluationScore9,
    2,
  );
  assert.equal(
    remoteRow.record_details?.humanEvaluationDetails?.resolvedEvaluation,
    "slightly_few",
  );
  assert.deepEqual(
    remoteRow.record_details?.humanEvaluationDetails?.humanEvaluationSelections,
    ["few", "slightly_few"],
  );

  const sqlFiles = [
    "supabase_area_count_records.sql",
    "supabase_area_count_records_backup.sql",
    "supabase_area_count_records_migration.sql",
    "supabase_area_count_records_rollback.sql",
    "supabase_area_count_records_verify.sql",
  ];
  for (const filename of sqlFiles) {
    const source = readFileSync(new URL(`../${filename}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /human[_ ]?evaluation/i, `${filename} gained a human-evaluation column`);
    assert.doesNotMatch(source, /score9|score_9/i, `${filename} gained a nine-scale column`);
  }

  const canonicalSql = readFileSync(
    new URL("../supabase_area_count_records.sql", import.meta.url),
    "utf8",
  );
  for (const column of [
    "data_schema_version",
    "app_version",
    "build_id",
    "date",
    "session_started_at",
    "recorded_at",
    "area_id",
    "discount_time",
    "actual_weekday",
    "actual_weekday_group",
    "count",
  ]) {
    assert.match(canonicalSql, new RegExp(`\\b${column}\\b`));
  }
  for (const removedColumn of [
    "weekday_base",
    "comfort_point",
    "user_judge",
    "suggested_evaluation",
    "area_rate_adjustment",
    "evaluation_source",
    "decision_basis",
  ]) {
    assert.doesNotMatch(canonicalSql, new RegExp(`\\b${removedColumn}\\b`));
  }
  const cloudMigration = readFileSync(
    new URL("../supabase_area_count_records_cloud_sync_migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(cloudMigration, /record_details\s+jsonb/i);
  assert.match(cloudMigration, /demand_cycle/i);
});

if (failed > 0) {
  console.error(`Human evaluation 9-scale checks failed: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
} else {
  console.log(`Human evaluation 9-scale checks passed: ${passed}/${passed}`);
}
