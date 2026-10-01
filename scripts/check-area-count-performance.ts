import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  getActualWeekdayLabel,
  getAreaCountRecommendation,
  prepareAreaCountCalculationPopulation,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { createInitialReview19Result } from "../src/domain/review19.ts";
import {
  buildReview19HistoryStatistics,
  prepareReview19HistoryPopulation,
} from "../src/domain/review19Evaluation.ts";
import type { AreaId, Review19Result } from "../src/domain/types.ts";

const areaIds: AreaId[] = ["bento_men", "tempura", "ryomi", "autumn", "croquette", "fry_chicken", "yakitori", "chuka_fish", "onigiri", "sushi", "inari", "hosomaki"];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  console.log(`PASS: ${name}`);
}
function history(size: number): AreaCountRecord[] {
  return Array.from({ length: size }, (_, index) => {
    const day = new Date("2026-03-01T00:00:00.000Z");
    day.setUTCDate(day.getUTCDate() + Math.floor(index / 24));
    const date = day.toISOString().slice(0, 10);
    const discountTime = index % 2 ? "17" : "15";
    return {
      dataSchemaVersion: 3,
      appVersion: "2026.8.9-36",
      demandCycle: index % 3 ? "normal" : "summer",
      date,
      sessionStartedAt: `${date}T${discountTime === "15" ? "06" : "08"}:00:00.000Z`,
      recordedAt: `${date}T${discountTime === "15" ? "06" : "08"}:05:00.000Z`,
      areaId: areaIds[Math.floor(index % 24 / 2)],
      discountTime,
      actualWeekday: getActualWeekdayLabel(day.getUTCDay()),
      actualWeekdayGroup: "月水",
      count: 10 + (index * 13) % 50,
      decisionBasis: { ruleVersion: "area_count_median_v1", recommendationStatus: "ready", sampleSize: 16, requiredSampleSize: 3, medianCount: 30 },
    };
  });
}
const params = { areaId: "bento_men" as const, discountTime: "17" as const, date: "2026-10-01", weekday: 4, demandCycle: "normal" as const, count: 40 };

for (const size of [500, 1000, 2000]) {
  check(`${size}: count changes reuse preparation without reading raw history or sorting full history`, () => {
    let reads = 0;
    const records = history(size).map(record => new Proxy(record, {
      get(target, key, receiver) { reads += 1; return Reflect.get(target, key, receiver); },
    }));
    const preparedPopulation = prepareAreaCountCalculationPopulation(records);
    assert.equal(preparedPopulation.recordCount, size);
    assert.ok(reads > 0, "preparation must inspect the source");
    reads = 0;
    const sortedSizes: number[] = [];
    const originalSort = Array.prototype.sort;
    Array.prototype.sort = function <T>(this: T[], compare?: (a: T, b: T) => number): T[] {
      sortedSizes.push(this.length);
      return originalSort.call(this, compare) as T[];
    };
    const start = performance.now();
    try {
      for (let count = 0; count < 100; count += 1) {
        getAreaCountRecommendation({ ...params, records, preparedPopulation, count });
      }
    } finally {
      Array.prototype.sort = originalSort;
    }
    const elapsed = performance.now() - start;
    assert.equal(reads, 0, "warm calculations must not normalize, canonicalize or read the input history again");
    assert.ok(sortedSizes.every(length => length <= 52), "warm sorting is limited to selected median windows");
    assert.ok(elapsed < 5000, `100 warm calculations exceeded loose 5-second smoke limit: ${elapsed}ms`);
    console.log(`  ${size} records: 100 warm calls ${elapsed.toFixed(2)}ms; raw-history reads ${reads}; largest sorted window ${Math.max(0, ...sortedSizes)}`);
  });
}

check("prepared and fresh recommendations match across areas, times, calendar rules and cycles", () => {
  const records = history(500);
  records.push(...records.slice(0, 80).map((record, index) => ({ ...copy(record), demandCycle: index % 2 ? "normal" : "summer" } as AreaCountRecord)));
  const before = JSON.stringify(records);
  const preparedPopulation = prepareAreaCountCalculationPopulation(records);
  for (const areaId of areaIds) {
    for (const discountTime of ["15", "17", "18", "19", "20"] as const) {
      for (const date of ["2026-03-10", "2026-08-15", "2026-09-21", "2026-10-01"]) {
        for (const demandCycle of ["normal", "summer"] as const) {
          const context = { ...params, records, areaId, discountTime, date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), demandCycle };
          assert.deepEqual(getAreaCountRecommendation({ ...context, preparedPopulation }), getAreaCountRecommendation(context));
        }
      }
    }
  }
  assert.equal(JSON.stringify(records), before, "source records must remain unchanged");
});

check("mutable legacy calls stay fresh; prepared snapshots and returned records are independent", () => {
  const records = history(2000).filter(record => record.areaId === "bento_men" && record.discountTime === "17");
  for (const record of records) record.count = 10;
  const preparedPopulation = prepareAreaCountCalculationPopulation(records);
  const first = getAreaCountRecommendation({ ...params, records, preparedPopulation });
  assert.equal(first.medianCount, 10);
  first.matchedRecords[0].count = 999;
  first.matchedRecords[0].decisionBasis!.medianCount = 999;
  first.matchedRecords.length = 0;
  assert.equal(getAreaCountRecommendation({ ...params, records, preparedPopulation }).medianCount, 10);
  assert.ok(!Object.isFrozen(records[0]), "preparation must not freeze caller input");
  for (const record of records) record.count = 50;
  assert.equal(getAreaCountRecommendation({ ...params, records }).medianCount, 50);
  assert.equal(getAreaCountRecommendation({ ...params, records, preparedPopulation }).medianCount, 10);
  const nextPopulation = prepareAreaCountCalculationPopulation(records);
  assert.notEqual(nextPopulation, preparedPopulation);
  assert.equal(getAreaCountRecommendation({ ...params, records, preparedPopulation: nextPopulation }).medianCount, 50);
});

check("Review19 preparation reuses all area metadata and remains an immutable snapshot", () => {
  const source: Review19Result[] = Array.from({ length: 80 }, (_, index) => {
    const day = new Date("2026-04-01T00:00:00Z");
    day.setUTCDate(day.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    const record = createInitialReview19Result({ date, sessionStartedAt: `${date}T10:00:00Z`, demandCycle: index % 2 ? "normal" : "summer" });
    record.recordedAt = `${date}T10:05:00Z`;
    for (const areaId of areaIds) record.areaCounts[areaId] = 10 + index % 20;
    return record;
  });
  source[0].excludedAreaIds.push("tempura");
  let reads = 0;
  const historicalRecords = source.map(record => new Proxy(record, {
    get(target, key, receiver) { reads += 1; return Reflect.get(target, key, receiver); },
  }));
  const preparedHistory = prepareReview19HistoryPopulation(historicalRecords);
  assert.equal(preparedHistory.recordCount, 80);
  assert.equal(preparedHistory.areaObservationCount, 80 * areaIds.length - 1);
  for (const areaId of areaIds) {
    const context = { ...params, areaId, historicalRecords };
    assert.deepEqual(buildReview19HistoryStatistics({ ...context, preparedHistory }), buildReview19HistoryStatistics(context));
  }
  const expected = buildReview19HistoryStatistics({ ...params, historicalRecords, preparedHistory });
  reads = 0;
  for (let index = 0; index < 100; index += 1) {
    buildReview19HistoryStatistics({ ...params, areaId: areaIds[index % areaIds.length], historicalRecords, preparedHistory, count: index });
  }
  assert.equal(reads, 0, "warm Review19 calls must not reconvert full historical records");
  for (const record of source) record.areaCounts.bento_men = 99;
  assert.deepEqual(buildReview19HistoryStatistics({ ...params, historicalRecords, preparedHistory }), expected);
  assert.equal(buildReview19HistoryStatistics({ ...params, historicalRecords }).autoEvaluationBasis.medianCount, 99);
});

check("actual hook and AreaJudge memo dependencies reuse clock renders and invalidate changed history/count/context", () => {
  const hookSource = ts.createSourceFile("useNebikiApp.ts", readFileSync("src/hooks/useNebikiApp.ts", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const judgeSource = ts.createSourceFile("AreaJudgeScreen.tsx", readFileSync("src/components/screens/AreaJudgeScreen.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function initializer(source: ts.SourceFile, name: string): string {
    let found: ts.Expression | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node.initializer;
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(found, `actual ${name} declaration must exist`);
    return found.getText(source);
  }
  // Execute the actual production memo expressions with persistent dependency
  // slots. This tests memo wiring, not a browser or the full React tree.
  const slots: Array<{ deps: readonly unknown[]; value: unknown }> = [];
  let cursor = 0;
  function memoSlot<T>(create: () => T, deps: readonly unknown[]): T {
    const index = cursor++;
    const previous = slots[index];
    if (previous && previous.deps.length === deps.length && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return previous.value as T;
    const value = create();
    slots[index] = { deps: [...deps], value };
    return value;
  }
  let prepareCalls = 0;
  let recommendationCalls = 0;
  let reviewPrepareCalls = 0;
  let reviewMergeCalls = 0;
  const records = history(1000);
  const context = {
    useMemo: memoSlot,
    useCallback: <T>(callback: T, deps: readonly unknown[]) => memoSlot(() => callback, deps),
    prepareAreaCountCalculationPopulation: (values: AreaCountRecord[]) => { prepareCalls += 1; return prepareAreaCountCalculationPopulation(values); },
    buildAreaCountRecommendation: (values: Parameters<typeof getAreaCountRecommendation>[0]) => { recommendationCalls += 1; return getAreaCountRecommendation(values); },
    areaCountRecords: records,
    state: { currentAreaId: params.areaId, session: { discountTime: params.discountTime, date: params.date, weekday: params.weekday, demandCycle: params.demandCycle } },
    applyObonRule: true,
    areaCountAssistEnabled: true,
    parsedAreaCount: 30,
    isTestMode: false,
    archivedReview19RecordsRef: { current: [] as Review19Result[] },
    remoteReview19HistoryRef: { current: [] as Review19Result[] },
    review19HistoryPopulationRef: { current: null as unknown },
    prepareReview19HistoryPopulation: (values: Review19Result[]) => { reviewPrepareCalls += 1; return prepareReview19HistoryPopulation(values); },
    mergeReview19MedianHistory: (values: { localRecords: Review19Result[]; remoteRecords: Review19Result[] }) => { reviewMergeCalls += 1; return [...values.localRecords, ...values.remoteRecords]; },
    render: undefined as unknown as () => { recommendation: ReturnType<typeof getAreaCountRecommendation>; getReview: () => unknown },
  };
  const code = `globalThis.render = () => {
    const areaCountCalculationPopulation = ${initializer(hookSource, "areaCountCalculationPopulation")};
    const getCurrentAreaCountRecommendation = ${initializer(hookSource, "getCurrentAreaCountRecommendation")};
    const getAreaCountRecommendation = getCurrentAreaCountRecommendation;
    const areaCountRecommendation = ${initializer(judgeSource, "areaCountRecommendation")};
    const getPreparedReview19History = ${initializer(hookSource, "getPreparedReview19History")};
    return { recommendation: areaCountRecommendation, getReview: getPreparedReview19History };
  };`;
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const render = () => { cursor = 0; return context.render(); };
  const first = render();
  for (let tick = 0; tick < 40; tick += 1) assert.equal(render().recommendation, first.recommendation);
  assert.equal(prepareCalls, 1);
  assert.equal(recommendationCalls, 1);
  context.parsedAreaCount = 31;
  render();
  assert.equal(prepareCalls, 1);
  assert.equal(recommendationCalls, 2);
  context.areaCountRecords = [...records];
  render();
  assert.equal(prepareCalls, 2);
  assert.equal(recommendationCalls, 3);
  context.state = { ...context.state, session: { ...context.state.session, weekday: 1 } };
  render();
  assert.equal(prepareCalls, 2);
  assert.equal(recommendationCalls, 4);
  const firstReview = first.getReview();
  for (let index = 0; index < 20; index += 1) assert.equal(render().getReview(), firstReview);
  assert.equal(reviewPrepareCalls, 1);
  assert.equal(reviewMergeCalls, 1);
  context.archivedReview19RecordsRef.current = [];
  render().getReview();
  assert.equal(reviewPrepareCalls, 2);
  context.remoteReview19HistoryRef.current = [];
  render().getReview();
  assert.equal(reviewPrepareCalls, 3);
  context.isTestMode = true;
  render().getReview();
  assert.equal(reviewPrepareCalls, 4);
  assert.equal(reviewMergeCalls, 3, "test-mode history must stay empty");
});

console.log(`AreaCount performance checks passed: ${checks}/${checks}`);
