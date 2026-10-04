import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getNormalRoute } from "../src/domain/area.ts";
import {
  HistoricalArchiveRepository,
  LEGACY_REVIEW19_STORAGE_KEY,
  MemoryHistoricalArchiveAdapter,
  getReview19ArchiveOperationKey,
  mergeReview19ArchiveOperations,
} from "../src/domain/historicalArchive.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import { createHumanEvaluationSelection, createReview19HumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import { downloadJsonFiles, type JsonDownloadRuntime } from "../src/domain/jsonDownload.ts";
import { buildNormalRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { buildReview19DataQuality, cloneReview19Result } from "../src/domain/review19.ts";
import { buildReview19HistoryStatistics } from "../src/domain/review19Evaluation.ts";
import { loadRemoteReview19Records } from "../src/domain/review19RemoteStorage.ts";
import {
  buildAllReview19DataExportPayload,
  buildAllReview19DataExportPayloadsByDemandCycle,
  getAllReview19ExportFilename,
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

const EXPORTED_AT = "2026-10-04T15:23:45.000Z";
const DATES = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-04"];
const tests: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push({ name, run });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type ExportPayload = ReturnType<typeof buildAllReview19DataExportPayload>;

// Rich records come from the production session/Review19 builders. The missing
// count and human observation on 9/30 remain an actual incomplete recorded day.
function fixture(date: string, demandCycle: DemandCycle, incomplete = false): Review19Result {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const recordedAt = `${date}T10:15:00.000Z`;
  const draft: SessionDraft = {
    date, weekday, discountTime: "17", demandCycle,
    manualWeekdayOverride: false, manualDiscountTimeOverride: false,
    weather: { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
  };
  draft.weather.hourlyForecasts["19"] = { weather: "rain", tempC: 24, windMs: 3 };
  const state = createInitialState(draft);
  state.session = {
    ...draft, startedAt: `${date}T08:00:00.000Z`, dataSchemaVersion: 3,
    appVersion: "2026.8.9-40", buildId: `source-${date}`, globalDiscountAdjustmentPercent: 5,
  };
  state.screen = "done";
  const resolvedWeather = resolveWeatherInputForDiscount(draft.weather, "17");
  state.areaProgressMap.inari = {
    ...state.areaProgressMap.inari, status: "completed", areaJudge: "many",
    areaCount: 38, areaCountEvaluation: "many", measurementStatus: "measured",
    completedAt: `${date}T08:05:00.000Z`,
    rateDecisionSnapshot: buildNormalRateDecisionSnapshot({
      confirmedAt: `${date}T08:05:00.000Z`, sessionDiscountTime: "17", demandCycle,
      weatherComfortAdjustmentPercent: 0, areaJudge: "many", resolvedWeather,
      weekday, date, globalDiscountAdjustmentPercent: 5,
    }),
  };
  const snapshotArgs = {
    capturedAt: recordedAt, resolvedWeather,
    weekdayBaseInfo: getWeekdayBaseInfo(weekday, "17", resolvedWeather, date),
    basisGuide: getBasisGuideDisplay({ date, weekday, discountTime: "17", demandCycle, weather: resolvedWeather }),
    lateTimeBonus: 0, doneSummaryItems: [],
  };
  const daily = createDailySessionSnapshot({ ...snapshotArgs, state });
  assert.ok(daily);
  const started = createReview19StartState({
    currentState: state, sourceState: state, now: new Date(`${date}T10:00:00.000Z`),
    snapshots: [daily], lastSessionWeather: null,
  });
  const record = started.review19!;
  for (const [index, areaId] of getNormalRoute(date).entries()) {
    const count = 5 + index;
    record.areaCounts[areaId] = count;
    record.areaCountRecordedAt[areaId] = recordedAt;
    record.areaEvaluations![areaId] = {
      humanEvaluation: "slightly_many",
      humanEvaluationDetails: createReview19HumanEvaluationDetails({
        selection: createHumanEvaluationSelection("slightly_many")!, demandCycle, evaluatedAt: recordedAt,
      }),
      ...buildReview19HistoryStatistics({ areaId, count, date, weekday, demandCycle, historicalRecords: [] }),
    };
  }
  if (incomplete) {
    delete record.areaCounts.inari;
    delete record.areaCountRecordedAt.inari;
    delete record.areaEvaluations!.inari;
  }
  record.review19Status = "recorded";
  record.recordedAt = recordedAt;
  record.reviewCompletedAt = recordedAt;
  record.sourceUpdatedAt = recordedAt;
  record.appVersion = "2026.8.9-40";
  record.buildId = `review-source-${date}`;
  record.dataQuality = buildReview19DataQuality({
    date, expectedAreaIds: record.expectedAreaIds, areaCounts: record.areaCounts,
    areaEvaluations: record.areaEvaluations, excludedAreaIds: [],
  });
  record.snapshot = createReview19Snapshot({
    ...snapshotArgs, session: state.session, areaProgressMap: state.areaProgressMap,
    excludedAreaIds: [], reviewReference: record.reference,
  });
  record.calendarContext = record.reference?.calendarContext;
  record.analysisWeatherContext = record.reference?.analysisWeatherContext;
  record.daySnapshot = createReview19DaySnapshot({
    date, demandCycle, capturedAt: recordedAt, sessions: [daily], areaCountRecords: [],
    review19Check: selectLatestReview19DayCheck([record], date, demandCycle),
  });
  record.productionAnalysis = record.daySnapshot.productionAnalysis;
  // The hook's archive ref contains normalized repository records, rather than
  // the temporary session-scoped context assembled during completion.
  const canonical = cloneReview19Result(record);
  assert.ok(canonical);
  return canonical;
}

const sixRecords = DATES.map((date, index) => fixture(date, index < 3 ? "summer" : "normal", index === 2));
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

type DownloadedFile = { filename: string; blob: Blob; clicked: boolean; removed: boolean };
function downloadHarness(params: {
  records: Review19Result[];
  activeCycle?: DemandCycle;
  failure?: "url" | "click";
}) {
  const records = json(params.records);
  const protectedData = {
    records,
    state: { screen: "start", session: { demandCycle: params.activeCycle ?? "normal" } } as Pick<AppState, "screen" | "session">,
    demandCycleState: { activeDemandCycle: params.activeCycle ?? "normal", lockedDate: "2026-10-04" },
    outbox: [{ payloadKind: "ref_v1", date: DATES[2] }], cloud: { status: "pending", lastSyncedAt: null },
  };
  const before = JSON.stringify(protectedData);
  freezeTree(protectedData);
  const files: DownloadedFile[] = [];
  const appended: string[] = [];
  const revoked: string[] = [];
  const calls: Array<Parameters<typeof downloadJsonFiles>[0]> = [];
  const unexpected: string[] = [];
  const deny = (name: string) => () => {
    unexpected.push(name);
    throw new Error(`all export must not call ${name}`);
  };
  let pendingBlob: Blob;
  const runtime: JsonDownloadRuntime = {
    createObjectUrl: (blob) => {
      if (params.failure === "url") throw new Error("URL creation blocked");
      pendingBlob = blob;
      return `blob:all-${files.length}`;
    },
    revokeObjectUrl: (url) => { revoked.push(url); },
    createLink: () => {
      const file = { filename: "", blob: pendingBlob, clicked: false, removed: false };
      files.push(file);
      const link = {
        href: "", download: "",
        click: () => {
          file.filename = link.download;
          if (params.failure === "click") throw new Error("Download blocked");
          file.clicked = true;
        },
        remove: () => { file.removed = true; },
      };
      return link;
    },
    appendLink: (link) => { appended.push(link.download); },
    scheduleCleanup: (cleanup) => cleanup(),
  };
  const context: Record<string, unknown> = {
    ...protectedData, demandCycle: params.activeCycle ?? "normal",
    archivedReview19RecordsRef: { current: records },
    getRuntimeNow: () => new Date(EXPORTED_AT), buildAllReview19DataExportPayload, getAllReview19ExportFilename,
    downloadJsonFiles: (items: Parameters<typeof downloadJsonFiles>[0]) => {
      calls.push(items);
      return downloadJsonFiles(items, runtime);
    },
    window: { open: deny("popup"), alert: deny("alert") },
    navigator: { clipboard: { writeText: deny("clipboard") } },
    localStorage: { setItem: deny("localStorage write"), removeItem: deny("localStorage delete") },
    indexedDB: { open: deny("IndexedDB write") }, fetch: deny("network"),
    setState: deny("setState"), setDemandCycleState: deny("setDemandCycleState"),
    saveReview19: deny("saveReview19"), enqueueReview19Sync: deny("outbox write"),
    syncLocalDataToSupabase: deny("cloud sync"),
  };
  return {
    files, calls, revoked, appended,
    run: runInNewContext(hookFunction("exportAllReview19Data"), context) as () => boolean,
    assertUnchanged: () => {
      assert.equal(JSON.stringify(protectedData), before, "archive/current cycle/outbox/cloud unchanged");
      assert.deepEqual(unexpected, [], "no storage, clipboard, popup, navigation or network side effects");
    },
  };
}

function assertSixRecords(payload: ExportPayload): void {
  assert.equal(payload.format, "nebiki-helper-review19-export");
  assert.equal(payload.version, 1);
  assert.equal(payload.dataSchemaVersion, 3);
  assert.equal(payload.exportedAt, EXPORTED_AT);
  assert.equal(payload.count, 6);
  assert.equal(payload.dataQuality.recordedCount, 6);
  assert.equal(payload.dataQuality.completeRecordCount, 5);
  assert.equal(payload.dataQuality.incompleteRecordCount, 1);
  assert.deepEqual(payload.records.map((record) => record.date), DATES);
  assert.equal(payload.records.filter((record) => record.demandCycle === "normal").length, 3);
  assert.equal(payload.records.filter((record) => record.demandCycle === "summer").length, 3);
  assert.equal(Object.hasOwn(payload, "exportFilter"), false);
  assert.deepEqual(payload.dataQuality.incompleteRecords.map((record) => record.date), [DATES[2]]);
  assert.deepEqual(payload.dataQuality.incompleteRecords[0].missingAreaIds, ["inari"]);
  assert.deepEqual(payload.dataQuality.incompleteRecords[0].missingHumanEvaluationAreaIds, ["inari"]);
}

test("six-date all action downloads one file with 6 recorded / 5 complete / 1 incomplete", async () => {
  const records = [sixRecords[5], sixRecords[2], sixRecords[0], sixRecords[4], sixRecords[1], sixRecords[3]];
  const harness = downloadHarness({ records });
  assert.equal(harness.run(), true);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].length, 1);
  assert.equal(harness.files.length, 1);
  const file = harness.files[0];
  assert.equal(file.filename, "nebiki-review19-all-20261005-0023.json");
  assert.equal(file.clicked, true);
  assert.equal(file.removed, true);
  assert.equal(file.blob.type, "application/json;charset=utf-8");
  const text = await file.blob.text();
  assert.equal(text, JSON.stringify(buildAllReview19DataExportPayload({ records, exportedAt: EXPORTED_AT }), null, 2));
  assertSixRecords(JSON.parse(text) as ExportPayload);
  assert.deepEqual(harness.appended, [file.filename]);
  assert.deepEqual(harness.revoked, ["blob:all-0"]);
  harness.assertUnchanged();
});

test("normal and summer active settings produce identical all JSON and preserve demandCycle state", async () => {
  const normal = downloadHarness({ records: sixRecords, activeCycle: "normal" });
  const summer = downloadHarness({ records: sixRecords, activeCycle: "summer" });
  assert.equal(normal.run(), true);
  assert.equal(summer.run(), true);
  assert.equal(normal.files.length, 1);
  assert.equal(summer.files.length, 1);
  assert.equal(await normal.files[0].blob.text(), await summer.files[0].blob.text());
  assert.equal(normal.files[0].filename, summer.files[0].filename);
  normal.assertUnchanged();
  summer.assertUnchanged();
});

test("all JSON keeps source versions, all rich metadata, raw9, statistics, seasonal route and rate snapshots", async () => {
  const before = JSON.stringify(sixRecords);
  const harness = downloadHarness({ records: sixRecords });
  assert.equal(harness.run(), true);
  const payload = JSON.parse(await harness.files[0].blob.text()) as ExportPayload;
  assertSixRecords(payload);
  for (const [index, record] of payload.records.entries()) {
    const source = sixRecords[index];
    assert.equal(record.appVersion, "2026.8.9-40");
    assert.equal(record.buildId, `review-source-${record.date}`);
    assert.equal(record.demandCycle, source.demandCycle);
    assert.equal(record.recordedAt, source.recordedAt);
    for (const key of ["calendarContext", "analysisWeatherContext", "productionAnalysis", "reference", "snapshot", "daySnapshot"] as const) {
      assert.ok(record[key], `rich metadata present: ${record.date} ${key}`);
      assert.deepEqual(json(record[key]), json(source[key]), `source metadata preserved: ${record.date} ${key}`);
    }
    assert.deepEqual(record.expectedAreaIds, getNormalRoute(record.date));
    assert.equal(record.expectedAreaIds?.includes(index < 3 ? "ryomi" : "autumn"), true);
    assert.equal(record.reference?.weather.hourlyForecasts["19"].weather, "rain");
    assert.equal(record.areaEvaluations?.bento_men?.humanEvaluationDetails?.humanEvaluationScore9, 7);
    assert.equal(record.areaEvaluations?.bento_men?.autoEvaluationBasis?.recommendationStatus, "insufficient");
    assert.equal(Object.hasOwn(record.areaEvaluations?.bento_men ?? {}, "autoEvaluation"), false);
    assert.equal(record.snapshot?.session.buildId, `source-${record.date}`);
    assert.equal(record.snapshot?.session.globalDiscountAdjustmentPercent, 5);
    assert.ok(record.snapshot?.areas.inari.rateDecisionSnapshot);
    assert.ok(record.daySnapshot?.sessions[0].areas.inari.rateDecisionSnapshot);
    assert.equal(record.snapshot?.session.demandCycle, source.demandCycle);
    assert.equal(record.daySnapshot?.demandCycle, source.demandCycle);
  }
  assert.equal(Object.hasOwn(payload.records[2].areaCounts, "inari"), false);
  assert.equal(Object.hasOwn(payload.records[2].areaEvaluations ?? {}, "inari"), false);
  assert.equal(JSON.stringify(sixRecords), before);
  harness.assertUnchanged();
});

test("normal-only and summer-only archives each download one all filename without a cycle filter", async () => {
  for (const cycle of ["normal", "summer"] as const) {
    const records = sixRecords.filter((record) => record.demandCycle === cycle);
    const harness = downloadHarness({ records, activeCycle: cycle === "normal" ? "summer" : "normal" });
    assert.equal(harness.run(), true);
    assert.equal(harness.files.length, 1);
    assert.equal(harness.files[0].filename, "nebiki-review19-all-20261005-0023.json");
    const payload = JSON.parse(await harness.files[0].blob.text()) as ExportPayload;
    assert.equal(payload.count, 3);
    assert.ok(payload.records.every((record) => record.demandCycle === cycle));
    assert.equal(Object.hasOwn(payload, "exportFilter"), false);
    harness.assertUnchanged();
  }
});

test("JST filename covers UTC rollover, midnight, explicit offset and invalid timestamp fallback", () => {
  assert.equal(getAllReview19ExportFilename(EXPORTED_AT), "nebiki-review19-all-20261005-0023.json");
  assert.equal(getAllReview19ExportFilename("2026-09-30T15:00:00.000Z"), "nebiki-review19-all-20261001-0000.json");
  assert.equal(getAllReview19ExportFilename("2026-10-01T00:00:00+09:00"), "nebiki-review19-all-20261001-0000.json");
  assert.equal(getAllReview19ExportFilename("invalid"), "nebiki-review19-all.json");
});

test("empty archive and legacy not-applicable-only archive return false without a download call", () => {
  for (const records of [[], [{ ...sixRecords[0], review19Status: "not_applicable" as const }]]) {
    const harness = downloadHarness({ records });
    assert.equal(harness.run(), false);
    assert.deepEqual(harness.files, []);
    assert.deepEqual(harness.calls, []);
    harness.assertUnchanged();
  }
});

for (const failure of ["url", "click"] as const) {
  test(`${failure} download failure returns false and preserves records, active cycle, outbox and cloud`, () => {
    const harness = downloadHarness({ records: sixRecords, activeCycle: "summer", failure });
    assert.equal(harness.run(), false);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].length, 1);
    assert.ok(harness.files.every((file) => !file.clicked));
    if (failure === "click") {
      assert.equal(harness.files[0].removed, true);
      assert.deepEqual(harness.revoked, ["blob:all-0"]);
    }
    harness.assertUnchanged();
  });
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let runtimeSequence = 0;
async function archiveFixture(params: {
  local?: Review19Result[];
  archive?: Review19Result[];
  migrationFailure?: boolean;
}) {
  const storage = new MemoryStorage();
  if (params.local?.length) storage.setItem(LEGACY_REVIEW19_STORAGE_KEY, JSON.stringify(params.local));
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  const adapter = new MemoryHistoricalArchiveAdapter();
  const repository = new HistoricalArchiveRepository(adapter);
  if (params.archive?.length) {
    const saved = await repository.upsertReview19Records(params.archive);
    assert.equal(saved.ok, true);
  }
  if (params.migrationFailure) adapter.fault = "write";
  // Isolate only the runtime singleton; every imported archive/storage helper
  // is the unchanged production implementation, using its memory test adapter.
  const runtime = await import(new URL(`../src/domain/historicalArchiveRuntime.ts?all-export-fixture=${++runtimeSequence}`, import.meta.url).href) as typeof import("../src/domain/historicalArchiveRuntime.ts");
  const hydrated = await runtime.initializeHistoricalArchiveRuntime({ repository, storage });
  return { adapter, repository, storage, runtime, hydrated };
}

test("actual archive migration + remote cache dedupe local/archive/remote and preserve incomplete day", async () => {
  const original = json(sixRecords);
  const newerIncomplete = json(original[2]);
  newerIncomplete.sourceUpdatedAt = `${DATES[2]}T10:16:00.000Z`;
  const local = [original[1], original[3], original[4]];
  const archive = [original[0], original[1], original[2]];
  const remote = [original[0], original[1], newerIncomplete, original[5]];
  const before = JSON.stringify({ local, archive, remote });
  const source = await archiveFixture({ local, archive });
  assert.equal(source.hydrated.status, "complete");
  assert.equal(source.hydrated.review19Records.length, 5);
  const cached = await source.runtime.cacheRemoteReview19InHistoricalArchive(remote);
  assert.equal(cached.ok, true);
  if (!cached.ok) throw new Error(cached.message);
  assert.equal(cached.value.length, 6);
  assert.equal(new Set(cached.value.map(getReview19ArchiveOperationKey)).size, 6);
  const canonical = mergeReview19ArchiveOperations([...archive, ...local, ...remote]);
  assert.deepEqual(cached.value, canonical);
  const incomplete = cached.value.find((record) => record.date === DATES[2]);
  assert.equal(incomplete?.dataQuality.complete, false);
  assert.equal(incomplete?.sourceUpdatedAt, newerIncomplete.sourceUpdatedAt);
  const harness = downloadHarness({ records: source.runtime.getHistoricalArchiveRuntimeSnapshot().review19Records });
  assert.equal(harness.run(), true);
  assert.equal(harness.files.length, 1);
  assertSixRecords(JSON.parse(await harness.files[0].blob.text()) as ExportPayload);
  assert.equal(JSON.stringify({ local, archive, remote }), before);
  harness.assertUnchanged();
});

test("canonical export retains valid same-date different session and cycle identities in execution order", async () => {
  const first = fixture(DATES[1], "summer");
  const second = json(first);
  second.sessionStartedAt = `${DATES[1]}T09:00:00.000Z`;
  second.reviewCompletedAt = `${DATES[1]}T10:20:00.000Z`;
  second.recordedAt = second.reviewCompletedAt;
  second.sourceUpdatedAt = second.reviewCompletedAt;
  const differentCycle = fixture(DATES[1], "normal");
  const repository = new HistoricalArchiveRepository(new MemoryHistoricalArchiveAdapter());
  const merged = await repository.upsertReview19Records([second, first, differentCycle, json(first), json(second)]);
  assert.equal(merged.ok, true);
  if (!merged.ok) throw new Error(merged.message);
  assert.equal(merged.value.length, 3);
  assert.equal(new Set(merged.value.map(getReview19ArchiveOperationKey)).size, 3);
  const harness = downloadHarness({ records: merged.value });
  assert.equal(harness.run(), true);
  const payload = JSON.parse(await harness.files[0].blob.text()) as ExportPayload;
  assert.equal(payload.count, 3);
  assert.deepEqual(payload.records.map((record) => record.date), [DATES[1], DATES[1], DATES[1]]);
  assert.deepEqual(payload.records.map((record) => record.sessionStartedAt), [first.sessionStartedAt, first.sessionStartedAt, second.sessionStartedAt]);
  assert.deepEqual(payload.records.map((record) => record.demandCycle).sort(), ["normal", "summer", "summer"]);
  harness.assertUnchanged();
});

test("local-only and remote-only canonical runtime records remain available to actual all action", async () => {
  for (const provenance of ["local", "remote"] as const) {
    const source = await archiveFixture({ local: provenance === "local" ? json(sixRecords) : [] });
    if (provenance === "remote") {
      assert.equal(source.hydrated.review19Records.length, 0);
      const cached = await source.runtime.cacheRemoteReview19InHistoricalArchive(sixRecords);
      assert.equal(cached.ok, true);
    }
    const harness = downloadHarness({ records: source.runtime.getHistoricalArchiveRuntimeSnapshot().review19Records });
    assert.equal(harness.run(), true);
    assert.equal(harness.files.length, 1);
    assertSixRecords(JSON.parse(await harness.files[0].blob.text()) as ExportPayload);
    harness.assertUnchanged();
  }
});

test("remote load/cache failure keeps authoritative local/archive all export usable", async () => {
  const source = await archiveFixture({ local: json(sixRecords.slice(3)), archive: json(sixRecords.slice(0, 3)) });
  const before = source.runtime.getHistoricalArchiveRuntimeSnapshot().review19Records;
  const remoteLoad = await loadRemoteReview19Records("summer", {
    config: { url: "https://fixture.invalid", anonKey: "fixture-public-key" },
    fetchImpl: async () => { throw new Error("fixture offline"); },
  });
  assert.equal(remoteLoad.status, "error");
  source.adapter.fault = "write";
  const remoteCache = await source.runtime.cacheRemoteReview19InHistoricalArchive([fixture("2026-10-03", "normal")]);
  assert.equal(remoteCache.ok, false);
  const after = source.runtime.getHistoricalArchiveRuntimeSnapshot().review19Records;
  assert.deepEqual(after, before);
  const harness = downloadHarness({ records: after });
  assert.equal(harness.run(), true);
  assertSixRecords(JSON.parse(await harness.files[0].blob.text()) as ExportPayload);
  harness.assertUnchanged();
});

test("failed legacy migration retains source bytes and exports cycle-less compatibility record as normal", async () => {
  const legacy = json(sixRecords[3]);
  delete legacy.demandCycle;
  delete legacy.businessMonth;
  const local = [legacy];
  const bytes = JSON.stringify(local);
  const source = await archiveFixture({ local, migrationFailure: true });
  assert.equal(source.hydrated.status, "partial");
  assert.equal(source.storage.getItem(LEGACY_REVIEW19_STORAGE_KEY), bytes);
  assert.equal(source.hydrated.review19Records.length, 1);
  const harness = downloadHarness({ records: source.hydrated.review19Records, activeCycle: "summer" });
  assert.equal(harness.run(), true);
  const payload = JSON.parse(await harness.files[0].blob.text()) as ExportPayload;
  assert.equal(payload.count, 1);
  assert.equal(payload.records[0].demandCycle, "normal");
  assert.equal(payload.records[0].businessMonth, 10, "existing export-only businessMonth compatibility remains");
  assert.equal(Object.hasOwn(source.hydrated.review19Records[0], "businessMonth"), false);
  assert.equal(Object.hasOwn(payload, "exportFilter"), false);
  assert.equal(source.storage.getItem(LEGACY_REVIEW19_STORAGE_KEY), bytes);
  assert.equal(JSON.stringify(local), bytes);
  harness.assertUnchanged();
});

test("explicit normal/summer domain builders keep cycle filtering and 3+3 fixture partition", () => {
  const exports = buildAllReview19DataExportPayloadsByDemandCycle({ records: sixRecords, exportedAt: EXPORTED_AT });
  assert.equal(exports.length, 2);
  assert.deepEqual(exports.map(({ demandCycle }) => demandCycle), ["normal", "summer"]);
  for (const { demandCycle, payload } of exports) {
    assert.equal(payload.count, 3);
    assert.deepEqual(payload.exportFilter, { demandCycle });
    assert.ok(payload.records.every((record) => record.demandCycle === demandCycle));
  }
});

try {
  for (const [index, entry] of tests.entries()) {
    await entry.run();
    console.log(`PASS: ${String(index + 1).padStart(2, "0")}. ${entry.name}`);
  }
  console.log(`Review19 all export checks: ${tests.length}/${tests.length} passed`);
  console.log("Required six-date fixture: count=6 recorded=6 complete=5 incomplete=1 normal=3 summer=3; one JSON file");
} finally {
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
}
