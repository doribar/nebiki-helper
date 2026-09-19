import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { AdminSettingsDialog } from "../src/components/common/AdminSettingsDialog.tsx";
import type { DoneScreen } from "../src/components/screens/DoneScreen.tsx";
import type { Review19DoneScreen } from "../src/components/screens/Review19DoneScreen.tsx";
import type { StartScreen } from "../src/components/screens/StartScreen.tsx";
import { getNormalRoute } from "../src/domain/area.ts";
import { collectAreaCountBackfillRecords } from "../src/domain/areaCountBackfill.ts";
import {
  FINALIZED_DAY_DATA_STORAGE_KEY, loadFinalizedDayData,
  replaceFinalizedDayDataCoreInMemory, type FinalizedDayData,
} from "../src/domain/finalizedDayData.ts";
import {
  HistoricalArchiveRepository, MemoryHistoricalArchiveAdapter,
} from "../src/domain/historicalArchive.ts";
import {
  getHistoricalArchiveRuntimeSnapshot, initializeHistoricalArchiveRuntime,
} from "../src/domain/historicalArchiveRuntime.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import {
  createHumanEvaluationSelection, createReview19HumanEvaluationDetails,
  getLegacyHumanEvaluationDetails,
} from "../src/domain/humanEvaluation.ts";
import { buildReview19DataQuality, createInitialReview19Result } from "../src/domain/review19.ts";
import { buildDirectReview19DataExportPayload } from "../src/domain/separateDataExport.ts";
import { STORAGE_KEYS } from "../src/domain/storage.ts";
import type { DemandCycle, DiscountTime, SessionDraft } from "../src/domain/types.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import {
  createDailySessionSnapshot, createReview19DaySnapshot, selectLatestReview19DayCheck,
} from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";
import { useNebikiApp } from "../src/hooks/useNebikiApp.ts";

// Actual TSX components and local dependencies, using the established SSR
// loader from check-advance-discount-ui. Only browser/storage boundaries are
// in memory; production UI, hook, archive and domain code run unchanged.
const modules = new Map<string, Record<string, unknown>>();
async function loadComponent(url: URL): Promise<Record<string, unknown>> {
  const cached = modules.get(url.href);
  if (cached) return cached;
  const source = readFileSync(url, "utf8");
  const ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dependencies = new Map<string, unknown>([["react", React], ["react/jsx-runtime", jsxRuntime]]);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
    const id = statement.moduleSpecifier.text;
    if (dependencies.has(id)) continue;
    assert.ok(id.startsWith("."), "local component dependency: " + id);
    const target = [id, id + ".ts", id + ".tsx"]
      .map((candidate) => new URL(candidate, url)).find((candidate) => existsSync(candidate));
    assert.ok(target, "actual dependency exists: " + id);
    dependencies.set(id, target.pathname.endsWith(".tsx") ? await loadComponent(target) : await import(target.href));
  }
  const exports: Record<string, unknown> = {};
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(output, {
    exports,
    require: (id: string) => {
      assert.ok(dependencies.has(id), "dependency loaded: " + id);
      return dependencies.get(id);
    },
  });
  modules.set(url.href, exports);
  return exports;
}
const RuntimeDone = (await loadComponent(new URL("../src/components/screens/DoneScreen.tsx", import.meta.url))).DoneScreen as typeof DoneScreen;
const RuntimeStart = (await loadComponent(new URL("../src/components/screens/StartScreen.tsx", import.meta.url))).StartScreen as typeof StartScreen;
const RuntimeSettings = (await loadComponent(new URL("../src/components/common/AdminSettingsDialog.tsx", import.meta.url))).AdminSettingsDialog as typeof AdminSettingsDialog;
const RuntimeReviewDone = (await loadComponent(new URL("../src/components/screens/Review19DoneScreen.tsx", import.meta.url))).Review19DoneScreen as typeof Review19DoneScreen;

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
const memory = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memory });
const DATE = "2026-09-10";
const CAPTURED_AT = `${DATE}T10:10:00.000Z`;
const ROUTE = getNormalRoute(DATE);
const noop = () => {};
const tests: { name: string; run: () => void | Promise<void> }[] = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push({ name, run });

type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
function text(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return React.isValidElement<Record<string, unknown>>(node) ? text(node.props.children as React.ReactNode) : "";
}
function render(renderScreen: () => React.ReactNode) {
  let tree: React.ReactNode = null;
  function Probe() { tree = renderScreen(); return tree; }
  const markup = renderToStaticMarkup(React.createElement(Probe));
  return { markup, nodes: elements(tree) };
}
function click(rendered: ReturnType<typeof render>, label: string): void {
  const node = rendered.nodes.find((item) => typeof item.props.onClick === "function" && text(item) === label);
  assert.ok(node, "clickable control: " + label);
  (node.props.onClick as () => void)();
}
function draft(time: DiscountTime, cycle: DemandCycle = "normal"): SessionDraft {
  return {
    date: DATE, weekday: 4, discountTime: time, demandCycle: cycle,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
}

for (const cycle of ["normal", "summer"] as const) {
  for (const time of ["15", "17", "18", "19", "20"] as const) {
    test(`Done ${cycle}/${time}: stale daily props cannot restore UI; navigation and rates remain`, () => {
      let back = 0, home = 0, next = 0, obsolete = 0;
      const label = `${cycle === "summer" ? "夏・" : ""}木曜日・${time}時`;
      const props = {
        onGoBack: () => { back += 1; }, onReturnHome: () => { home += 1; },
        onStart1830: time === "17" ? () => { next += 1; } : undefined,
        referenceConditionLabel: label,
        summaryItems: ROUTE.map((areaId) => ({ areaId, areaName: areaId, rateText: "20%", manyRateText: "30%", normalRateText: "20%" })),
        showDailyDataActions: true, memo: "legacy hidden memo",
        onSaveMemo: () => { obsolete += 1; }, onExportDailyData: () => { obsolete += 1; return true; },
      };
      const rendered = render(() => RuntimeDone(props));
      assert.doesNotMatch(rendered.markup, /1日データ|任意メモ|メモを保存|textarea|final-day-memo|legacy hidden memo/);
      assert.equal((rendered.markup.match(/aria-label="判定の基準"/g) ?? []).length, 1);
      assert.ok(rendered.markup.includes(label));
      assert.ok(rendered.markup.includes("全エリアの値引率"));
      for (const areaId of ROUTE) assert.ok(rendered.markup.includes(areaId));
      assert.equal((rendered.markup.match(/多い → 30%/g) ?? []).length, ROUTE.length);
      click(rendered, "戻る"); click(rendered, "トップに戻る");
      if (time === "17") click(rendered, "18:30値引を開始");
      else assert.doesNotMatch(rendered.markup, /18:30値引を開始/);
      assert.deepEqual([back, home, next, obsolete], [1, 1, time === "17" ? 1 : 0, 0]);
    });
  }
  for (const fixed of [false, true]) {
    test(`Start ${cycle}/${fixed ? "fixed" : "production"}: previous-day records no longer create discard input`, () => {
      let obsolete = 0;
      const props = {
        sessionDraft: draft("17", cycle), previousSession: null, isFixedTimeMode: fixed,
        weatherGuideText: { nearTermWeatherGuide: "", laterPrecipGuide: "", laterPrecipTypeGuide: "", windGuide: "", tempGuide: "" },
        showAfterRainRecoverySelector: false, onChangeSessionDraft: noop,
        weatherConfirmationPending: false, weatherCorrectionRequestId: 0,
        onRequestWeatherConfirmation: noop, onEditWeatherInput: noop, onStart: noop,
        demandCycle: cycle, summerModeAvailable: true, canChangeDemandCycle: true, onChangeDemandCycle: () => true,
        now: new Date(`${DATE}T08:00:00.000Z`),
        previousDayDiscardTarget: { date: "2026-09-09", count: 7 },
        onSavePreviousDayDiscardCount: () => { obsolete += 1; },
      };
      const rendered = render(() => RuntimeStart(props));
      assert.doesNotMatch(rendered.markup, /廃棄|前日の1日データ|discard|対象日：/);
      assert.ok(rendered.markup.includes("値引ヘルパー"));
      assert.ok(rendered.markup.includes("16時"));
      assert.equal(obsolete, 0);
    });
  }
}

test("Settings keeps two Review19 export controls and ignores obsolete daily export props", () => {
  let all = 0, latest = 0, obsolete = 0;
  const props = {
    review19Count: 4, onClose: noop,
    onExportAllReview19Data: () => { all += 1; return true; },
    onExportLatestReview19Data: () => { latest += 1; return true; },
    dailyCount: 99, onExportAllDailyData: () => { obsolete += 1; return true; },
    onExportLatestDailyData: () => { obsolete += 1; return true; },
  };
  const rendered = render(() => RuntimeSettings(props));
  assert.doesNotMatch(rendered.markup, /1日データ|日次データ|全データを出力/);
  assert.ok(rendered.markup.includes("19:00チェックデータ（4件）"));
  click(rendered, "19:00チェックデータを全件出力");
  click(rendered, "最新の19:00チェックデータを出力");
  assert.deepEqual([all, latest, obsolete], [1, 1, 0]);
  assert.ok(rendered.markup.includes("端末保存容量を確認"));
  assert.ok(rendered.markup.includes("端末内データをSupabaseへ同期"));
});

test("Review19 completion keeps download, back and home callbacks", () => {
  let downloads = 0, back = 0, home = 0;
  const rendered = render(() => RuntimeReviewDone({
    onExportReview19Data: () => { downloads += 1; }, onGoBack: () => { back += 1; }, onReturnHome: () => { home += 1; },
  }));
  click(rendered, "JSONをダウンロード"); click(rendered, "戻る"); click(rendered, "トップに戻る");
  assert.deepEqual([downloads, back, home], [1, 1, 1]);
  assert.doesNotMatch(rendered.markup, /1日データ|任意メモ/);
});

function richLegacyFixture() {
  const sessions = (["15", "17"] as const).map((time) => {
    const input = draft(time, "summer");
    const state = createInitialState(input);
    state.session = { ...input, startedAt: `${DATE}T${time}:00:00+09:00` };
    state.screen = "done";
    for (const areaId of ROUTE) {
      state.areaProgressMap[areaId] = {
        ...state.areaProgressMap[areaId], areaJudge: "normal", status: "completed",
        areaCount: time === "15" ? 8 : 4, areaCountEvaluation: "few", areaCountEvaluationSource: "manual",
        humanEvaluationDetails: getLegacyHumanEvaluationDetails("few"), measurementStatus: "measured",
        measurementRecordedAt: `${DATE}T${time}:05:00+09:00`,
        completedAt: `${DATE}T${time}:05:00+09:00`,
      };
    }
    const resolvedWeather = resolveWeatherInputForDiscount(input.weather, time);
    const snapshot = createDailySessionSnapshot({
      state, capturedAt: `${DATE}T${time}:05:00+09:00`, resolvedWeather,
      weekdayBaseInfo: getWeekdayBaseInfo(4, time, resolvedWeather, DATE),
      basisGuide: getBasisGuideDisplay({ date: DATE, weekday: 4, discountTime: time, demandCycle: "summer", weather: resolvedWeather }),
      lateTimeBonus: 0, doneSummaryItems: [],
    });
    assert.ok(snapshot);
    return snapshot;
  });
  const review = createInitialReview19Result({ date: DATE, demandCycle: "summer", sessionStartedAt: `${DATE}T19:00:00+09:00` });
  for (const areaId of ROUTE) {
    review.areaCounts[areaId] = 2;
    review.areaCountRecordedAt[areaId] = CAPTURED_AT;
    review.areaEvaluations![areaId] = {
      humanEvaluation: "few",
      humanEvaluationDetails: createReview19HumanEvaluationDetails({
        selection: createHumanEvaluationSelection("few")!, demandCycle: "summer", evaluatedAt: CAPTURED_AT,
      }),
    };
  }
  review.recordedAt = CAPTURED_AT;
  review.reviewCompletedAt = CAPTURED_AT;
  review.dataQuality = buildReview19DataQuality({ date: DATE, areaCounts: review.areaCounts, areaEvaluations: review.areaEvaluations, excludedAreaIds: [] });
  const records = collectAreaCountBackfillRecords({ dailySessionSnapshots: sessions, nowMs: Date.parse(CAPTURED_AT) });
  assert.equal(records.length, 24);
  const day = createReview19DaySnapshot({
    date: DATE, demandCycle: "summer", capturedAt: CAPTURED_AT, sessions, areaCountRecords: records,
    review19Check: selectLatestReview19DayCheck([review], DATE, "summer"),
  });
  review.daySnapshot = day;
  review.productionAnalysis = day.productionAnalysis;
  const legacy: FinalizedDayData = { ...day, recordId: "retained-legacy-day", finalizedAt: CAPTURED_AT, memo: "旧版の完了メモ", discardCount: 7 };
  return { sessions, review, legacy };
}
const fixture = richLegacyFixture();

test("Legacy memo/discard and 15/17/19 production analysis survive reading and core replacement", () => {
  const raw = JSON.stringify([fixture.legacy]);
  memory.setItem(FINALIZED_DAY_DATA_STORAGE_KEY, raw);
  const [loaded] = loadFinalizedDayData();
  assert.ok(loaded);
  assert.equal(loaded.memo, "旧版の完了メモ"); assert.equal(loaded.discardCount, 7);
  assert.equal(loaded.recordId, "retained-legacy-day");
  assert.equal(memory.getItem(FINALIZED_DAY_DATA_STORAGE_KEY), raw, "read does not rewrite history");
  const analysis = loaded.productionAnalysis?.areas[ROUTE[0]];
  assert.equal(analysis?.productionShortageSuspicion, "strong");
  assert.deepEqual(analysis?.checkpointSources, { "15": "manual", "17": "manual", "19": "human_review19" });
  assert.equal(analysis?.checkpointScores["19"], 1);
  assert.deepEqual(loaded.sessions, fixture.legacy.sessions);
  const replacement = replaceFinalizedDayDataCoreInMemory({ currentRecords: [loaded], daySnapshot: fixture.review.daySnapshot! });
  assert.equal(replacement.record.memo, loaded.memo); assert.equal(replacement.record.discardCount, loaded.discardCount);
  assert.equal(replacement.record.recordId, loaded.recordId); assert.equal(replacement.record.finalizedAt, loaded.finalizedAt);
});

test("Verified archive migration retains legacy metadata, sessions, Review19 and analysis", async () => {
  memory.setItem(STORAGE_KEYS.dailySessionSnapshots, JSON.stringify(fixture.sessions));
  memory.setItem(STORAGE_KEYS.review19Records, JSON.stringify([fixture.review]));
  const repository = new HistoricalArchiveRepository(new MemoryHistoricalArchiveAdapter());
  const archive = await initializeHistoricalArchiveRuntime({ repository, storage: memory });
  assert.equal(archive.status, "complete");
  assert.equal(archive.finalizedDayRecords.length, 1); assert.equal(archive.dailySessionSnapshots.length, 2); assert.equal(archive.review19Records.length, 1);
  const stored = archive.finalizedDayRecords[0];
  assert.equal(stored.memo, "旧版の完了メモ"); assert.equal(stored.discardCount, 7);
  assert.equal(stored.sessions.length, 2); assert.equal(stored.areaCountRecords.length, 24);
  assert.equal(stored.productionAnalysis?.areas[ROUTE[0]]?.productionShortageSuspicion, "strong");
  assert.equal(memory.getItem(FINALIZED_DAY_DATA_STORAGE_KEY), null, "verified source migrates to archive");
  const readBack = await repository.listFinalizedDays();
  assert.ok(readBack.ok); assert.deepEqual(readBack.value, archive.finalizedDayRecords);
});

test("Internal archive remains an authoritative backfill source without duplicate observations", () => {
  const archive = getHistoricalArchiveRuntimeSnapshot();
  const result = collectAreaCountBackfillRecords({
    finalizedDayRecords: archive.finalizedDayRecords, review19Records: archive.review19Records,
    dailySessionSnapshots: archive.dailySessionSnapshots, nowMs: Date.parse(CAPTURED_AT),
  });
  const finalizedOnly = collectAreaCountBackfillRecords({ finalizedDayRecords: archive.finalizedDayRecords, nowMs: Date.parse(CAPTURED_AT) });
  assert.equal(result.length, 24); assert.equal(finalizedOnly.length, 24);
  assert.deepEqual(result.map((record) => [record.areaId, record.discountTime, record.count]).sort(), finalizedOnly.map((record) => [record.areaId, record.discountTime, record.count]).sort());
  assert.ok(result.every((record) => record.demandCycle === "summer" && record.evaluationSource === "manual"));
});

test("Review19 JSON still carries daySnapshot and production analysis without changing archive", () => {
  const archive = getHistoricalArchiveRuntimeSnapshot();
  const before = JSON.stringify(archive);
  const payload = buildDirectReview19DataExportPayload({ record: archive.review19Records[0], exportedAt: CAPTURED_AT });
  assert.equal(payload.dataSchemaVersion, 3); assert.equal(payload.count, 1);
  assert.equal(payload.records[0].daySnapshot?.sessions.length, 2);
  assert.equal(payload.records[0].daySnapshot?.areaCountRecords.length, 24);
  assert.equal(payload.records[0].productionAnalysis?.areas[ROUTE[0]]?.productionShortageSuspicion, "strong");
  assert.equal(JSON.stringify(archive), before);
  assert.equal(JSON.stringify(getHistoricalArchiveRuntimeSnapshot()), before);
});

test("Actual hook exposes only Review19 exports and retains internal archive diagnostics", async () => {
  // A test-only SSR observer resolves the actual hook facade after rendering,
  // so the asynchronous diagnostic can run outside the render phase.
  const app = await new Promise<ReturnType<typeof useNebikiApp>>((resolve) => {
    function Probe() { resolve(useNebikiApp()); return React.createElement("span", null, "hook"); }
    assert.equal(renderToStaticMarkup(React.createElement(Probe)), "<span>hook</span>");
  });
  for (const name of ["saveFinalizedDayMemo", "savePreviousDayDiscardCount", "exportAllDailyData", "exportLatestDailyData", "exportCompletedDailyData", "exportAllData"]) {
    assert.equal(Object.hasOwn(app.actions, name), false, "removed action: " + name);
  }
  for (const name of ["finalizedDayMemo", "previousDayDiscardTarget", "allDataExport"]) assert.equal(Object.hasOwn(app.derived, name), false);
  assert.deepEqual(Object.keys(app.derived.dataExport), ["review19Count"]);
  assert.equal(app.derived.dataExport.review19Count, 1);
  for (const action of [app.actions.exportAllReview19Data, app.actions.exportLatestReview19Data, app.actions.exportCompletedReview19Data]) assert.equal(typeof action, "function");
  assert.equal(Object.hasOwn(app.state, "finalizedDayRecordId"), true);
  const diagnostic = await app.actions.getStorageUsageDiagnostic();
  assert.equal(diagnostic.archive.finalizedDayCount, 1);
  assert.equal(diagnostic.archive.dailySessionSnapshotCount, 2);
  assert.equal(diagnostic.archive.review19Count, 1);
});

for (const [index, entry] of tests.entries()) {
  await entry.run();
  console.log(`PASS ${index + 1}: ${entry.name}`);
}
console.log(`Daily UI removal checks passed: ${tests.length}/${tests.length}`);
