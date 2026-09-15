import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { getNormalRoute } from "../src/domain/area.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { createHumanEvaluationSelection, createReview19HumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import { downloadJsonFiles, type JsonDownloadRuntime } from "../src/domain/jsonDownload.ts";
import { buildNormalRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { buildReview19DataQuality } from "../src/domain/review19.ts";
import { buildReview19HistoryStatistics } from "../src/domain/review19Evaluation.ts";
import {
  buildAllReview19DataExportPayloadsByDemandCycle,
  buildDirectReview19DataExportPayload,
  buildLatestReview19DataExportPayload,
  getDemandCycleAllExportFilename,
  selectAllReview19Data,
} from "../src/domain/separateDataExport.ts";
import type { AppState, DemandCycle, Review19Result, SessionDraft } from "../src/domain/types.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import { createReview19StartState } from "../src/hooks/nebikiApp/review19Flow.ts";
import {
  createDailySessionSnapshot,
  createReview19DaySnapshot,
  createReview19Snapshot,
  selectLatestReview19DayCheck,
} from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState } from "../src/hooks/nebikiApp/stateNormalization.ts";

const DATE = "2026-09-06";
const EXPORTED_AT = "2026-09-06T10:20:00.000Z";
const RECORDED_AT = "2026-09-06T10:15:00.000Z";
const tests: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push({ name, run });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// Build a complete, rich record through the same domain builders used by the
// application. Distinct source versions prove export does not rewrite history.
function fixture(demandCycle: DemandCycle = "normal"): AppState {
  const draft: SessionDraft = {
    date: DATE, weekday: 0, discountTime: "17", demandCycle,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
  draft.weather.hourlyForecasts["19"] = { weather: "rain", tempC: 24, windMs: 3 };
  const state = createInitialState(draft);
  state.session = {
    ...draft, startedAt: `${DATE}T08:00:00.000Z`, dataSchemaVersion: 3,
    appVersion: "2026.8.9-20", buildId: "source-build-preserved", globalDiscountAdjustmentPercent: 5,
  };
  state.screen = "done";
  const resolvedWeather = resolveWeatherInputForDiscount(draft.weather, "17");
  state.areaProgressMap.inari = {
    ...state.areaProgressMap.inari,
    status: "completed", areaJudge: "many", areaCount: 38,
    areaCountEvaluation: "many", measurementStatus: "measured",
    completedAt: `${DATE}T08:05:00.000Z`,
    rateDecisionSnapshot: buildNormalRateDecisionSnapshot({
      confirmedAt: `${DATE}T08:05:00.000Z`, sessionDiscountTime: "17", demandCycle,
      weatherComfortAdjustmentPercent: 0, areaJudge: "many", resolvedWeather,
      weekday: 0, date: DATE, globalDiscountAdjustmentPercent: 5,
    }),
  };
  const snapshotArgs = {
    capturedAt: RECORDED_AT, resolvedWeather,
    weekdayBaseInfo: getWeekdayBaseInfo(0, "17", resolvedWeather, DATE),
    basisGuide: getBasisGuideDisplay({ date: DATE, weekday: 0, discountTime: "17", demandCycle, weather: resolvedWeather }),
    lateTimeBonus: 0, doneSummaryItems: [],
  };
  const daily = createDailySessionSnapshot({ ...snapshotArgs, state });
  assert.ok(daily);
  const started = createReview19StartState({
    currentState: state, sourceState: state, now: new Date(`${DATE}T10:00:00.000Z`),
    snapshots: [daily], lastSessionWeather: null,
  });
  const record = started.review19!;
  for (const [index, areaId] of getNormalRoute(DATE).entries()) {
    const count = 5 + index;
    record.areaCounts[areaId] = count;
    record.areaCountRecordedAt[areaId] = RECORDED_AT;
    record.areaEvaluations![areaId] = {
      humanEvaluation: "slightly_many",
      humanEvaluationDetails: createReview19HumanEvaluationDetails({
        selection: createHumanEvaluationSelection("slightly_many")!, demandCycle,
        evaluatedAt: RECORDED_AT,
      }),
      ...buildReview19HistoryStatistics({ areaId, count, date: DATE, weekday: 0, demandCycle, historicalRecords: [] }),
    };
  }
  record.review19Status = "recorded";
  record.recordedAt = RECORDED_AT;
  record.reviewCompletedAt = RECORDED_AT;
  record.dataQuality = buildReview19DataQuality({
    date: DATE, areaCounts: record.areaCounts, areaEvaluations: record.areaEvaluations,
    excludedAreaIds: [],
  });
  record.snapshot = createReview19Snapshot({
    ...snapshotArgs, session: state.session, areaProgressMap: state.areaProgressMap,
    excludedAreaIds: [], reviewReference: record.reference,
  });
  record.calendarContext = record.reference?.calendarContext;
  record.analysisWeatherContext = record.reference?.analysisWeatherContext;
  record.daySnapshot = createReview19DaySnapshot({
    date: DATE, demandCycle, capturedAt: RECORDED_AT,
    sessions: [daily], areaCountRecords: [], review19Check: selectLatestReview19DayCheck([record], DATE, demandCycle),
  });
  record.productionAnalysis = record.daySnapshot.productionAnalysis;
  started.screen = "review19_done";
  return started;
}

const hookSource = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
const hookAst = ts.createSourceFile("useNebikiApp.ts", hookSource, ts.ScriptTarget.Latest, true);
function hookFunction(name: string): string {
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(hookAst);
  assert.ok(found, `actual hook function ${name} exists`);
  return ts.transpileModule(`${found.getText(hookAst)}\n${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

function freezeTree(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const nested of Object.values(value)) freezeTree(nested);
}

type DownloadedFile = {
  filename: string;
  blob: Blob;
  clicked: boolean;
  appended: boolean;
  removed: boolean;
};

function downloadRuntime(failClick = false) {
  const files: DownloadedFile[] = [];
  const revoked: string[] = [];
  let pendingBlob: Blob;
  const runtime: JsonDownloadRuntime = {
    createObjectUrl: (blob) => { pendingBlob = blob; return "blob:test-" + files.length; },
    revokeObjectUrl: (url) => { revoked.push(url); },
    createLink: () => {
      const file = { filename: "", blob: pendingBlob, clicked: false, appended: false, removed: false };
      files.push(file);
      const link = {
        href: "", download: "",
        click: () => {
          if (failClick) throw new Error("download blocked");
          file.filename = link.download;
          file.clicked = true;
        },
        remove: () => { file.removed = true; },
      };
      return link;
    },
    appendLink: (link) => {
      const index = Number(link.href.split("-").at(-1));
      files[index].appended = true;
    },
    scheduleCleanup: (cleanup) => cleanup(),
  };
  return { runtime, files, revoked };
}

// Run the actual action and shared actual downloadJsonFile/downloadJsonFiles
// chain. Only browser DOM/object URL operations are observable substitutes;
// production code performs serialization and Blob creation.
function completedDownloadHarness(params: {
  state?: AppState;
  fixedTime?: boolean;
  failClick?: boolean;
} = {}) {
  const state = params.state ?? fixture();
  const archive = [json(state.review19)];
  const outbox = [{ payloadKind: "ref_v1", date: DATE }];
  const cloud = { status: "pending", lastSyncedAt: null };
  const unexpected: string[] = [];
  const deny = (name: string) => () => {
    unexpected.push(name);
    throw new Error("download must not call " + name);
  };
  const protectedData = { state, archive, outbox, cloud };
  const before = JSON.stringify(protectedData);
  freezeTree(protectedData);
  const download = downloadRuntime(params.failClick);
  const context: Record<string, unknown> = {
    state, archivedReview19RecordsRef: { current: archive },
    getRuntimeNow: () => new Date(EXPORTED_AT), isTestMode: params.fixedTime ?? false,
    buildDirectReview19DataExportPayload,
    downloadJsonFiles: (items: Parameters<typeof downloadJsonFiles>[0]) => downloadJsonFiles(items, download.runtime),
    navigator: { clipboard: { writeText: deny("clipboard.writeText") } },
    localStorage: { setItem: deny("localStorage.setItem"), removeItem: deny("localStorage.removeItem") },
    indexedDB: { open: deny("indexedDB.open") },
    window: { alert: deny("alert"), showSaveFilePicker: deny("showSaveFilePicker"), open: deny("window.open") },
    setState: deny("setState"), saveReview19: deny("saveReview19"),
    enqueueReview19Sync: deny("enqueueReview19Sync"), syncLocalDataToSupabase: deny("syncLocalDataToSupabase"),
    fetch: deny("fetch"),
  };
  context.downloadJsonFile = runInNewContext(hookFunction("downloadJsonFile"), context);
  return {
    run: runInNewContext(hookFunction("exportCompletedReview19Data"), context) as () => boolean,
    state, ...download,
    assertUnchanged: () => {
      assert.equal(JSON.stringify(protectedData), before, "completion/archive/outbox/cloud unchanged");
      assert.deepEqual(unexpected, [], "no clipboard, storage, alert, popup or network side effects");
    },
  };
}

for (const cycle of ["normal", "summer"] as const) {
  test(cycle + ": completed download uses the exact existing direct export and pretty JSON", async () => {
    const state = fixture(cycle);
    const expected = buildDirectReview19DataExportPayload({ record: state.review19!, exportedAt: EXPORTED_AT });
    const harness = completedDownloadHarness({ state });
    assert.equal(harness.run(), true);
    assert.equal(harness.files.length, 1);
    const file = harness.files[0];
    assert.equal(file.clicked, true);
    assert.equal(file.appended, true);
    assert.equal(file.removed, true);
    assert.equal(file.filename, "nebiki-review19-" + DATE + ".json");
    assert.equal(file.blob.type, "application/json;charset=utf-8");
    const serialized = await file.blob.text();
    assert.equal(serialized, JSON.stringify(expected, null, 2));
    const payload = JSON.parse(serialized);
    assert.deepEqual(payload, json(expected));
    for (const key of ["format", "version", "dataSchemaVersion", "appVersion", "buildId", "records", "dataQuality"]) {
      assert.deepEqual(payload[key], json(expected)[key as keyof typeof expected]);
    }
    assert.equal(payload.records[0].dataQuality.complete, true);
    assert.equal(Object.keys(payload.records[0].areaCounts).length, getNormalRoute(DATE).length);
    assert.deepEqual(harness.revoked, ["blob:test-0"]);
    harness.assertUnchanged();
  });
}

test("download preserves rich reference/weather/human/statistics/production/snapshot metadata", async () => {
  const harness = completedDownloadHarness();
  assert.equal(harness.run(), true);
  const record = JSON.parse(await harness.files[0].blob.text()).records[0];
  for (const key of ["calendarContext", "analysisWeatherContext", "productionAnalysis", "reference", "snapshot", "daySnapshot"]) {
    assert.ok(record[key], "nonempty fixture and exported " + key);
  }
  assert.equal(record.reference.weather.hourlyForecasts["19"].weather, "rain");
  assert.equal(record.areaEvaluations.inari.humanEvaluationDetails.humanEvaluationScore9, 7);
  assert.equal(record.areaEvaluations.inari.autoEvaluationBasis.recommendationStatus, "insufficient");
  for (const evaluation of Object.values(record.areaEvaluations)) {
    assert.equal(Object.hasOwn(evaluation as object, "autoEvaluation"), false);
    assert.equal(Object.hasOwn(evaluation as object, "autoEvaluationStatus"), false);
  }
  assert.ok(record.areaEvaluations.inari.autoEvaluationBasis);
  assert.ok(record.snapshot.areas.inari.rateDecisionSnapshot);
  assert.ok(record.daySnapshot.sessions[0].areas.inari.rateDecisionSnapshot);
  assert.equal(record.snapshot.session.buildId, "source-build-preserved");
  assert.equal(record.snapshot.session.globalDiscountAdjustmentPercent, 5);
  harness.assertUnchanged();
});

for (const invalid of ["wrong-screen", "missing-record", "not-recorded", "missing-recorded-at"] as const) {
  test(invalid + ": no incomplete/unrelated completion data is downloaded", () => {
    const state = fixture();
    if (invalid === "wrong-screen") state.screen = "review19";
    if (invalid === "missing-record") state.review19 = null;
    if (invalid === "not-recorded") state.review19!.review19Status = "not_applicable";
    if (invalid === "missing-recorded-at") delete state.review19!.recordedAt;
    const harness = completedDownloadHarness({ state });
    assert.equal(harness.run(), false);
    assert.deepEqual(harness.files, []);
    harness.assertUnchanged();
  });
}

test("fixed-time completion export remains read-only", () => {
  const harness = completedDownloadHarness({ fixedTime: true });
  assert.equal(harness.run(), true);
  harness.assertUnchanged();
});

test("a failed browser download leaves completion untouched and releases its URL", () => {
  const harness = completedDownloadHarness({ failClick: true });
  assert.equal(harness.run(), false);
  assert.equal(harness.state.screen, "review19_done");
  assert.equal(harness.state.review19?.review19Status, "recorded");
  assert.equal(harness.state.review19?.recordedAt, RECORDED_AT);
  assert.equal(harness.files[0].clicked, false);
  assert.equal(harness.files[0].removed, true);
  assert.deepEqual(harness.revoked, ["blob:test-0"]);
  harness.assertUnchanged();
});

function settingsHarness(records: Review19Result[]) {
  const download = downloadRuntime();
  const before = JSON.stringify(records);
  freezeTree(records);
  const context: Record<string, unknown> = {
    archivedReview19RecordsRef: { current: records },
    getRuntimeNow: () => new Date(EXPORTED_AT),
    selectAllReview19Data, buildAllReview19DataExportPayloadsByDemandCycle,
    buildLatestReview19DataExportPayload, getDemandCycleAllExportFilename,
    downloadJsonFiles: (items: Parameters<typeof downloadJsonFiles>[0]) => downloadJsonFiles(items, download.runtime),
  };
  context.downloadJsonFile = runInNewContext(hookFunction("downloadJsonFile"), context);
  return {
    ...download,
    all: runInNewContext(hookFunction("exportAllReview19Data"), context) as () => boolean,
    latest: runInNewContext(hookFunction("exportLatestReview19Data"), context) as () => boolean,
    assertUnchanged: () => assert.equal(JSON.stringify(records), before),
  };
}

test("settings all Review19 export still downloads each cycle with unchanged JSON", async () => {
  const records = [fixture("normal").review19!, fixture("summer").review19!];
  const expected = buildAllReview19DataExportPayloadsByDemandCycle({ records, exportedAt: EXPORTED_AT });
  const harness = settingsHarness(records);
  assert.equal(harness.all(), true);
  assert.equal(harness.files.length, 2);
  for (const [index, file] of harness.files.entries()) {
    assert.equal(file.clicked, true);
    assert.equal(await file.blob.text(), JSON.stringify(expected[index].payload, null, 2));
    assert.equal(file.filename, getDemandCycleAllExportFilename({ dataKind: "review19", demandCycle: expected[index].demandCycle, exportedAt: EXPORTED_AT }));
  }
  harness.assertUnchanged();
});

test("settings latest Review19 export still downloads the selected record unchanged", async () => {
  const older = fixture().review19!;
  older.date = "2026-09-05";
  const records = [fixture().review19!, older];
  const expected = buildLatestReview19DataExportPayload({ records, exportedAt: EXPORTED_AT });
  const harness = settingsHarness(records);
  assert.equal(harness.latest(), true);
  assert.equal(harness.files.length, 1);
  assert.equal(harness.files[0].clicked, true);
  assert.equal(harness.files[0].filename, "nebiki-review19-" + DATE + ".json");
  assert.equal(await harness.files[0].blob.text(), JSON.stringify(expected, null, 2));
  harness.assertUnchanged();
});

test("empty settings archive continues to return false without download", () => {
  const harness = settingsHarness([]);
  assert.equal(harness.all(), false);
  assert.equal(harness.latest(), false);
  assert.deepEqual(harness.files, []);
});

const screenSource = readFileSync(new URL("../src/components/screens/Review19DoneScreen.tsx", import.meta.url), "utf8");
type ScreenProps = { onExportReview19Data: () => void; onGoBack: () => void; onReturnHome: () => void };
function compileScreen() {
  const output = ts.transpileModule(screenSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(output, {
    exports,
    require: (id: string) => {
      if (id === "react") return React;
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id.endsWith("/PrimaryButton")) return {
        PrimaryButton: (props: Record<string, unknown>) => React.createElement("button", props),
      };
      throw new Error("Unexpected screen dependency: " + id);
    },
  });
  return exports.Review19DoneScreen as (props: ScreenProps) => React.ReactElement;
}

test("actual completion screen shows JSON download and removes clipboard-only UI", () => {
  const Screen = compileScreen();
  const markup = renderToStaticMarkup(React.createElement(Screen, {
    onExportReview19Data: () => undefined, onGoBack: () => undefined, onReturnHome: () => undefined,
  }));
  assert.match(markup, /JSONをダウンロード/);
  assert.match(markup, /ChatGPTに添付/);
  assert.doesNotMatch(markup, /ChatGPT用にコピー|コピー中|コピーしました|コピーできませんでした/);
  assert.doesNotMatch(screenSource, /clipboard|copyStatus|copying|copyInFlight|useEffect|useState|useRef/);
  assert.doesNotMatch(hookSource, /copyCompletedReview19Data/);
});

test("actual completion button invokes direct download without navigation", async () => {
  const harness = completedDownloadHarness();
  let navigations = 0;
  const Screen = compileScreen();
  const rendered = Screen({
    onExportReview19Data: harness.run,
    onGoBack: () => { navigations += 1; },
    onReturnHome: () => { navigations += 1; },
  });
  function elements(node: React.ReactNode): Array<React.ReactElement<Record<string, unknown>>> {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!React.isValidElement<Record<string, unknown>>(node)) return [];
    return [node, ...elements(node.props.children as React.ReactNode)];
  }
  const button = elements(rendered).find((element) => element.props.children === "JSONをダウンロード");
  assert.ok(button);
  (button.props.onClick as () => void)();
  assert.equal(navigations, 0);
  assert.equal(harness.files.length, 1);
  assert.equal(harness.files[0].clicked, true);
  assert.equal(JSON.parse(await harness.files[0].blob.text()).records[0].recordedAt, RECORDED_AT);
  harness.assertUnchanged();
});

test("settings UI retains both Review19 download operations", () => {
  const settingsSource = readFileSync(new URL("../src/components/common/AdminSettingsDialog.tsx", import.meta.url), "utf8");
  assert.match(settingsSource, /19:00チェックデータを全件出力/);
  assert.match(settingsSource, /最新の19:00チェックデータを出力/);
  assert.match(settingsSource, /onExportAllReview19Data/);
  assert.match(settingsSource, /onExportLatestReview19Data/);
});

for (const [index, entry] of tests.entries()) {
  await entry.run();
  console.log("PASS: " + String(index + 1).padStart(2, "0") + ". " + entry.name);
}
console.log("Review19 download checks: " + tests.length + "/" + tests.length + " passed");
