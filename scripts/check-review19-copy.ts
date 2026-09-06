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
import { buildReview19AutomaticEvaluation } from "../src/domain/review19Evaluation.ts";
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
      ...buildReview19AutomaticEvaluation({ areaId, count, date: DATE, weekday: 0, demandCycle, historicalRecords: [] }),
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

function copyHarness(params: {
  state?: AppState;
  clipboard?: "ready" | "reject" | "missing" | "missing-method" | "no-navigator";
  fixedTime?: boolean;
} = {}) {
  const state = params.state ?? fixture();
  const archive = [json(state.review19)];
  const outbox = [{ payloadKind: "ref_v1", date: DATE }];
  const cloud = { status: "pending", lastSyncedAt: null };
  const writes: string[] = [];
  const unexpected: string[] = [];
  const deny = (name: string) => () => {
    unexpected.push(name);
    throw new Error(`copy must not call ${name}`);
  };
  const protectedData = { state, archive, outbox, cloud };
  const before = JSON.stringify(protectedData);
  freezeTree(protectedData);
  const clipboard = {
    writeText: async (value: string) => {
      assert.equal(typeof value, "string");
      writes.push(value);
      if (params.clipboard === "reject") throw new Error("NotAllowedError");
    },
  };
  const context: Record<string, unknown> = {
    state, archivedReview19RecordsRef: { current: archive },
    getRuntimeNow: () => new Date(EXPORTED_AT), isTestMode: params.fixedTime ?? false,
    buildDirectReview19DataExportPayload,
    downloadJsonFile: deny("downloadJsonFile"), downloadJsonFiles: deny("downloadJsonFiles"),
    Blob: deny("Blob"), URL: { createObjectURL: deny("createObjectURL") },
    document: { createElement: deny("createElement"), execCommand: deny("execCommand") },
    localStorage: { setItem: deny("localStorage.setItem"), removeItem: deny("localStorage.removeItem") },
    indexedDB: { open: deny("indexedDB.open") },
    window: { alert: deny("alert"), showSaveFilePicker: deny("showSaveFilePicker") },
    setState: deny("setState"), saveReview19: deny("saveReview19"),
    enqueueReview19Sync: deny("enqueueReview19Sync"), syncLocalDataToSupabase: deny("syncLocalDataToSupabase"),
    fetch: deny("fetch"),
  };
  if (params.clipboard !== "no-navigator") context.navigator = {
    clipboard: params.clipboard === "missing" ? undefined : params.clipboard === "missing-method" ? {} : clipboard,
  };
  const run = runInNewContext(hookFunction("copyCompletedReview19Data"), context) as () => Promise<boolean>;
  return {
    run, state, writes, unexpected,
    assertUnchanged: () => {
      assert.equal(JSON.stringify(protectedData), before, "record/archive/outbox/cloud unchanged");
      assert.deepEqual(unexpected, [], "no download, storage, alert or network side effects");
    },
  };
}

for (const cycle of ["normal", "summer"] as const) {
  test(`${cycle}: actual copy action writes the exact pretty-printed existing export`, async () => {
    const state = fixture(cycle);
    const expected = buildDirectReview19DataExportPayload({ record: state.review19!, exportedAt: EXPORTED_AT });
    const harness = copyHarness({ state });
    assert.equal(await harness.run(), true);
    assert.deepEqual(harness.writes, [JSON.stringify(expected, null, 2)]);
    const payload = JSON.parse(harness.writes[0]);
    assert.deepEqual(payload, json(expected));
    for (const key of ["format", "version", "dataSchemaVersion", "appVersion", "buildId", "records", "dataQuality"]) {
      assert.deepEqual(payload[key], json(expected)[key as keyof typeof expected]);
    }
    assert.equal(payload.records[0].dataQuality.complete, true);
    assert.equal(Object.keys(payload.records[0].areaCounts).length, getNormalRoute(DATE).length);
    harness.assertUnchanged();
  });
}

test("copy preserves rich reference/weather/human/auto/production/snapshot metadata", async () => {
  const harness = copyHarness();
  assert.equal(await harness.run(), true);
  const record = JSON.parse(harness.writes[0]).records[0];
  for (const key of ["calendarContext", "analysisWeatherContext", "productionAnalysis", "reference", "snapshot", "daySnapshot"]) {
    assert.ok(record[key], `nonempty fixture and exported ${key}`);
  }
  assert.equal(record.reference.weather.hourlyForecasts["19"].weather, "rain");
  assert.equal(record.areaEvaluations.inari.humanEvaluationDetails.humanEvaluationScore9, 7);
  assert.equal(record.areaEvaluations.inari.autoEvaluationStatus, "insufficient");
  assert.ok(record.areaEvaluations.inari.autoEvaluationBasis);
  assert.ok(record.snapshot.areas.inari.rateDecisionSnapshot);
  assert.ok(record.daySnapshot.sessions[0].areas.inari.rateDecisionSnapshot);
  assert.equal(record.snapshot.session.buildId, "source-build-preserved");
  assert.equal(record.snapshot.session.globalDiscountAdjustmentPercent, 5);
  harness.assertUnchanged();
});

for (const clipboard of ["reject", "missing", "missing-method", "no-navigator"] as const) {
  test(`${clipboard}: safe failure retains completion and has no fallback download/storage`, async () => {
    const harness = copyHarness({ clipboard });
    assert.equal(await harness.run(), false);
    assert.equal(harness.state.screen, "review19_done");
    assert.equal(harness.state.review19?.review19Status, "recorded");
    assert.equal(harness.state.review19?.recordedAt, RECORDED_AT);
    harness.assertUnchanged();
  });
}

for (const invalid of ["wrong-screen", "missing-record", "not-recorded", "missing-recorded-at"] as const) {
  test(`${invalid}: clipboard never receives an incomplete/unrelated record`, async () => {
    const state = fixture();
    if (invalid === "wrong-screen") state.screen = "review19";
    if (invalid === "missing-record") state.review19 = null;
    if (invalid === "not-recorded") state.review19!.review19Status = "not_applicable";
    if (invalid === "missing-recorded-at") delete state.review19!.recordedAt;
    const harness = copyHarness({ state });
    assert.equal(await harness.run(), false);
    assert.deepEqual(harness.writes, []);
    harness.assertUnchanged();
  });
}

test("fixed-time copy has the same read-only behavior", async () => {
  const harness = copyHarness({ fixedTime: true });
  assert.equal(await harness.run(), true);
  harness.assertUnchanged();
});

function settingsHarness(records: Review19Result[]) {
  const files: Array<{ filename: string; blob: Blob; clicked: boolean }> = [];
  let pendingBlob: Blob;
  const runtime: JsonDownloadRuntime = {
    createObjectUrl: (blob) => { pendingBlob = blob; return `blob:test-${files.length}`; },
    revokeObjectUrl: () => undefined,
    createLink: () => {
      const file = { filename: "", blob: pendingBlob, clicked: false };
      files.push(file);
      const link = {
        href: "", download: "",
        click: () => { file.filename = link.download; file.clicked = true; },
        remove: () => undefined,
      };
      return link;
    },
    appendLink: () => undefined,
    scheduleCleanup: (cleanup) => cleanup(),
  };
  const before = JSON.stringify(records);
  freezeTree(records);
  const context: Record<string, unknown> = {
    archivedReview19RecordsRef: { current: records },
    getRuntimeNow: () => new Date(EXPORTED_AT),
    selectAllReview19Data, buildAllReview19DataExportPayloadsByDemandCycle,
    buildLatestReview19DataExportPayload, getDemandCycleAllExportFilename,
    downloadJsonFiles: (items: Parameters<typeof downloadJsonFiles>[0]) => downloadJsonFiles(items, runtime),
  };
  context.downloadJsonFile = runInNewContext(hookFunction("downloadJsonFile"), context);
  return {
    files,
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
  assert.equal(harness.files[0].filename, `nebiki-review19-${DATE}.json`);
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
type ScreenProps = { onCopyReview19Data: () => Promise<boolean>; onGoBack: () => void; onReturnHome: () => void };
function compileScreen(reactRuntime: unknown, windowRuntime: unknown = {}) {
  const output = ts.transpileModule(screenSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(output, {
    exports, window: windowRuntime,
    require: (id: string) => {
      if (id === "react") return reactRuntime;
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id.endsWith("/PrimaryButton")) return {
        PrimaryButton: (props: Record<string, unknown>) => React.createElement("button", props),
      };
      throw new Error(`Unexpected screen dependency: ${id}`);
    },
  });
  return exports.Review19DoneScreen as (props: ScreenProps) => React.ReactElement;
}

test("actual completion screen renders ChatGPT copy and no old download action", () => {
  const Screen = compileScreen(React);
  const markup = renderToStaticMarkup(React.createElement(Screen, {
    onCopyReview19Data: async () => true, onGoBack: () => undefined, onReturnHome: () => undefined,
  }));
  assert.match(markup, /ChatGPT用にコピー/);
  assert.doesNotMatch(markup, /19:00チェックデータを出力|JSONをダウンロード|download=/);
});

// Execute the current component and its event handler; only React scheduling
// and browser timers are controlled. Browser coverage separately checks real DOM.
function screenHarness(onCopyReview19Data: () => Promise<boolean>) {
  const values: unknown[] = [];
  const effects = new Map<number, { dependencies: unknown[]; cleanup?: () => void }>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let cursor = 0;
  let nextTimer = 1;
  const Screen = compileScreen({
    useState: (initial: unknown) => {
      const slot = cursor++;
      if (!(slot in values)) values[slot] = initial;
      return [values[slot], (next: unknown) => { values[slot] = next; }];
    },
    useRef: (initial: unknown) => {
      const slot = cursor++;
      if (!(slot in values)) values[slot] = { current: initial };
      return values[slot];
    },
    useEffect: (effect: () => (() => void) | undefined, dependencies: unknown[]) => {
      const slot = cursor++;
      const previous = effects.get(slot);
      if (previous && dependencies.every((value, index) => Object.is(value, previous.dependencies[index]))) return;
      previous?.cleanup?.();
      effects.set(slot, { dependencies, cleanup: effect() });
    },
  }, {
    setTimeout: (callback: () => void, delay: number) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const render = () => {
    cursor = 0;
    return Screen({ onCopyReview19Data, onGoBack: () => undefined, onReturnHome: () => undefined });
  };
  function elements(node: React.ReactNode): Array<React.ReactElement<Record<string, unknown>>> {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!React.isValidElement<Record<string, unknown>>(node)) return [];
    return [node, ...elements(node.props.children as React.ReactNode)];
  }
  const copyButton = () => {
    const button = elements(render()).find((element) =>
      element.props.children === "ChatGPT用にコピー" || element.props.children === "コピー中…",
    );
    assert.ok(button);
    return button;
  };
  return {
    click: () => (copyButton().props.onClick as () => Promise<void>)(),
    busy: () => copyButton().props.disabled,
    markup: () => renderToStaticMarkup(render()),
    timers,
    unmount: () => { for (const effect of effects.values()) effect.cleanup?.(); },
  };
}

test("actual UI shows inline success, then clears it after five seconds", async () => {
  const harness = screenHarness(async () => true);
  await harness.click();
  assert.match(harness.markup(), /role="status"[^>]*>コピーしました/);
  assert.equal(harness.busy(), false);
  assert.equal(harness.timers.size, 1);
  const timer = [...harness.timers.values()][0];
  assert.equal(timer.delay, 5000);
  timer.callback();
  assert.doesNotMatch(harness.markup(), />コピーしました/);
});

for (const failure of ["false", "throw"] as const) {
  test(`actual UI ${failure} displays a persistent inline error without leaving completion`, async () => {
    const harness = screenHarness(async () => {
      if (failure === "throw") throw new Error("clipboard unavailable");
      return false;
    });
    await harness.click();
    const markup = harness.markup();
    assert.match(markup, /コピーできませんでした/);
    assert.match(markup, /記録しました/);
    assert.match(markup, /ChatGPT用にコピー/);
    assert.equal(harness.busy(), false);
    assert.equal(harness.timers.size, 0);
  });
}

test("UI blocks concurrent clicks and permits retry after a rejected copy", async () => {
  let calls = 0;
  let resolve: (value: boolean) => void = () => undefined;
  const harness = screenHarness(() => {
    calls += 1;
    return new Promise<boolean>((finish) => { resolve = finish; });
  });
  const first = harness.click();
  assert.equal(harness.busy(), true);
  await harness.click();
  assert.equal(calls, 1);
  resolve(false);
  await first;
  assert.match(harness.markup(), /コピーできませんでした/);
  const retry = harness.click();
  assert.equal(calls, 2);
  resolve(true);
  await retry;
  assert.match(harness.markup(), /コピーしました/);
  assert.doesNotMatch(harness.markup(), /コピーできませんでした/);
  harness.unmount();
  assert.equal(harness.timers.size, 0, "success timer is cleaned up on navigation");
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
  console.log(`PASS: ${String(index + 1).padStart(2, "0")}. ${entry.name}`);
}
console.log(`Review19 copy checks: ${tests.length}/${tests.length} passed`);
