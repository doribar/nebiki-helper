import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getNormalRoute } from "../src/domain/area.ts";
import { buildProductionAnalysis } from "../src/domain/analysisMetadata.ts";
import { isBusinessMonth, monthFromBusinessDate, resolveBusinessMonth } from "../src/domain/businessMonth.ts";
import {
  enqueueReview19RecordForCloud,
  resolveQueuedReview19Record,
  sendPendingSupabaseSyncItem,
} from "../src/domain/cloudSync.ts";
import { getCurrentDataVersionInfo } from "../src/domain/dataVersion.ts";
import { buildAutomaticDayExportPayload } from "../src/domain/dayExport.ts";
import { normalizeFinalizedDayData } from "../src/domain/finalizedDayData.ts";
import {
  HISTORICAL_ARCHIVE_REVIEW19_STORE,
  HistoricalArchiveRepository,
  MemoryHistoricalArchiveAdapter,
  getReview19ArchiveOperationKey,
} from "../src/domain/historicalArchive.ts";
import { createReview19HumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import {
  advanceReview19SourceUpdatedAt,
  buildReview19DataQuality,
  buildReview19ExportPayload,
  cloneReview19Result,
  createInitialReview19Result,
  normalizeReview19Result,
} from "../src/domain/review19.ts";
import { persistCompletedReview19LocalFirstAsync } from "../src/domain/review19CompletionStorage.ts";
import { buildReview19HistoryStatistics } from "../src/domain/review19Evaluation.ts";
import { buildRemoteReview19Row, normalizeRemoteReview19Row } from "../src/domain/review19RemoteStorage.ts";
import {
  buildAllFinalizedDayDataExportPayload,
  buildAllReview19DataExportPayload,
  buildAllReview19DataExportPayloadsByDemandCycle,
  buildDirectReview19DataExportPayload,
  buildLatestReview19DataExportPayload,
} from "../src/domain/separateDataExport.ts";
import {
  STORAGE_KEYS,
  loadCurrentSession,
  loadReview19Records,
  loadWorkSessionCheckpoint,
  saveCurrentSession,
  saveWorkSessionCheckpoint,
} from "../src/domain/storage.ts";
import { loadPendingSupabaseSyncQueue } from "../src/domain/supabaseSyncQueue.ts";
import type { AppState, Review19Result } from "../src/domain/types.ts";
import { createReview19DaySnapshot, selectLatestReview19DayCheck } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { createInitialState, normalizeLoadedState } from "../src/hooks/nebikiApp/stateNormalization.ts";

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const EXPORTED_AT = "2026-10-02T12:00:00.000Z";
let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  console.log(`PASS: ${String(++passed).padStart(2, "0")}. ${name}`);
}

class TrackingStorage implements Storage {
  private values = new Map<string, string>();
  writes = 0;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.writes++; this.values.delete(key); }
  setItem(key: string, value: string): void { this.writes++; this.values.set(key, String(value)); }
}

class TrackingArchive extends MemoryHistoricalArchiveAdapter {
  writes = 0;
  override async putMany(...args: Parameters<MemoryHistoricalArchiveAdapter["putMany"]>): Promise<void> {
    this.writes++;
    await super.putMany(...args);
  }
}

const storage = new TrackingStorage();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

function makeRecord(date = "2026-10-02", timestamp = `${date}T10:05:00.000Z`): Review19Result {
  const initial = createInitialReview19Result({
    date,
    demandCycle: date.slice(5, 7) === "09" ? "summer" : "normal",
    sessionStartedAt: timestamp,
    reviewStartedAt: timestamp,
  });
  for (const [index, areaId] of getNormalRoute(date).entries()) {
    initial.areaCounts[areaId] = index + 6;
    initial.areaCountRecordedAt[areaId] = timestamp;
    initial.areaEvaluations![areaId] = {
      humanEvaluation: "normal",
      humanEvaluationDetails: createReview19HumanEvaluationDetails({
        selection: { humanEvaluationScore9: 5, humanEvaluationSelections: ["normal"] },
        demandCycle: initial.demandCycle!, evaluatedAt: timestamp,
      }),
    };
  }
  const record: Review19Result = {
    ...initial,
    recordedAt: timestamp,
    reviewCompletedAt: timestamp,
    sourceUpdatedAt: timestamp,
    dataQuality: buildReview19DataQuality({ ...initial, areaEvaluations: initial.areaEvaluations! }),
  };
  record.daySnapshot = createReview19DaySnapshot({
    date, demandCycle: record.demandCycle, capturedAt: timestamp,
    sessions: [], areaCountRecords: [],
    review19Check: selectLatestReview19DayCheck([record], date, record.demandCycle),
  });
  record.productionAnalysis = record.daySnapshot.productionAnalysis;
  return record;
}

function legacyRecord(date = "2026-09-14"): Review19Result {
  const record = json(makeRecord(date));
  delete record.businessMonth;
  delete record.daySnapshot!.businessMonth;
  delete record.daySnapshot!.review19Check!.businessMonth;
  return record;
}

function assertCopies(record: Review19Result, month: number): void {
  assert.equal(record.businessMonth, month);
  assert.equal(record.daySnapshot?.businessMonth, month);
  assert.equal(record.daySnapshot?.review19Check?.businessMonth, month);
}

function stateFor(record: Review19Result): AppState {
  const state = createInitialState();
  state.screen = "review19";
  state.review19 = record;
  state.session = null;
  return state;
}

// Execute the application's actual completion and fixed-time save handlers.
// The harness substitutes only state/clock/storage dependencies.
const hookSource = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
const hookAst = ts.createSourceFile("useNebikiApp.ts", hookSource, ts.ScriptTarget.Latest, true);
function hookFunction(name: string): string {
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(hookAst);
  assert.ok(found, `actual hook function ${name} exists`);
  return ts.transpileModule(`${found.getText(hookAst)}\n${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

function completionContext(state: AppState) {
  return {
    state, monthFromBusinessDate, getNormalRoute, getCurrentDataVersionInfo,
    advanceReview19SourceUpdatedAt, buildReview19DataQuality, createReview19DaySnapshot,
    getRuntimeNow: () => new Date("2026-10-02T10:10:00.000Z"),
    isTestMode: false, areaCountRecords: [],
    getHistoricalDailySessionSnapshotsForDate: () => [],
  };
}

try {
  await test("新規Review19は1〜12月を営業日だけから保存しschema3を維持する", () => {
    for (let month = 1; month <= 12; month++) {
      const date = `2026-${String(month).padStart(2, "0")}-02`;
      const record = createInitialReview19Result({ date, sessionStartedAt: "2025-12-31T23:59:59.000Z" });
      assert.equal(record.businessMonth, month);
      assert.equal(record.dataSchemaVersion, 3);
      assert.ok(isBusinessMonth(record.businessMonth));
    }
    for (const value of [0, 13, 1.5, "10", NaN, Infinity, null, undefined]) {
      assert.equal(isBusinessMonth(value), false);
    }
    for (const date of ["2026-13-02", "2026-02-29", "2026-10-00", "2026-10-02T00:00:00Z"]) {
      assert.equal(monthFromBusinessDate(date), undefined);
    }
  });

  await test("実completion handlerがrecord・review19Check・daySnapshotへ同じ営業月を保存する", () => {
    const source = legacyRecord("2026-10-02");
    const before = JSON.stringify(source);
    const context = completionContext(stateFor(source));
    const complete = runInNewContext(hookFunction("buildRecordedReview19Result"), context) as () => Review19Result;
    const record = json(complete());
    assertCopies(record, 10);
    assert.equal(record.dataSchemaVersion, 3);
    assert.equal(record.dataQuality.complete, true);
    assert.equal(JSON.stringify(source), before);
  });

  await test("UTC前月/翌月timestampでも営業日dateの月をarchive・remoteに保持する", async () => {
    const adapter = new TrackingArchive();
    const repository = new HistoricalArchiveRepository(adapter);
    for (const [date, timestamp, month] of [
      ["2026-10-01", "2026-09-30T23:59:00.000Z", 10],
      ["2026-09-30", "2026-10-01T00:01:00.000Z", 9],
      ["2027-01-01", "2026-12-31T23:59:00.000Z", 1],
      ["2026-12-31", "2027-01-01T00:01:00.000Z", 12],
    ] as const) {
      const record = makeRecord(date, timestamp);
      assertCopies(record, month);
      const saved = await repository.upsertReview19Records([record]);
      assert.equal(saved.ok, true);
      const restored = await repository.getReview19Record({
        date, demandCycle: record.demandCycle!, sessionStartedAt: record.sessionStartedAt,
      });
      assert.ok(restored.ok && restored.value);
      assertCopies(restored.value, month);
      const row = json(buildRemoteReview19Row(restored.value));
      const remote = normalizeRemoteReview19Row(row, record.demandCycle!);
      assert.ok(remote);
      assertCopies(remote, month);
      assert.equal(row.data_schema_version, 3);
    }
  });

  await test("authoritative archive保存後lightweight outboxから解決・送信して全copyを維持する", async () => {
    storage.clear();
    const repository = new HistoricalArchiveRepository(new TrackingArchive());
    const record = makeRecord();
    const result = await persistCompletedReview19LocalFirstAsync(record, {
      saveAuthoritative: async (value) => {
        const saved = await repository.upsertReview19Records([value]);
        assert.equal(saved.ok, true);
        return { ok: true, key: "nebiki-helper-history/review19", operation: "set" };
      },
      enqueueCloud: enqueueReview19RecordForCloud,
      releaseAuxiliary: () => [],
    });
    assert.equal(result.localSaved, true);
    assert.equal(result.cloudQueuePrepared, true);
    const [pending] = loadPendingSupabaseSyncQueue();
    assert.ok(pending);
    assert.equal("businessMonth" in (pending.payload as object), false);
    assert.equal("daySnapshot" in (pending.payload as object), false);
    assert.equal(storage.getItem(STORAGE_KEYS.review19Records), null);
    const archived = await repository.listReview19Records();
    assert.ok(archived.ok);
    assertCopies(resolveQueuedReview19Record(pending, archived.value)!, 10);
    let uploaded: Review19Result | undefined;
    const sent = await sendPendingSupabaseSyncItem(pending, {
      loadReview19ArchiveSources: async () => archived.value,
      upsertReview19Record: async (value) => {
        const row = json(buildRemoteReview19Row(value));
        uploaded = normalizeRemoteReview19Row(row, value.demandCycle!)!;
        return { status: "saved" };
      },
    });
    assert.equal(sent.ok, true);
    assert.ok(uploaded);
    assertCopies(uploaded, 10);
  });

  await test("current/checkpointのJSON copyと復元も新規monthを保持する", () => {
    storage.clear();
    const state = stateFor(makeRecord());
    state.session = {
      ...state.sessionDraft, date: state.review19!.date, weekday: 5,
      demandCycle: state.review19!.demandCycle, discountTime: "17",
      startedAt: state.review19!.sessionStartedAt,
    };
    saveCurrentSession(state);
    saveWorkSessionCheckpoint(state);
    assertCopies(loadCurrentSession()!.review19!, 10);
    assertCopies(loadWorkSessionCheckpoint()!.review19!, 10);
    // Existing recovery resumes an unsaved review; completed reviews reset to Start.
    delete state.review19!.recordedAt;
    saveCurrentSession(state);
    const recovered = normalizeLoadedState(loadCurrentSession(), state.sessionDraft);
    assert.equal(recovered.screen, "review19");
    assertCopies(recovered.review19!, 10);
  });

  await test("新規JSON download・latest/all・cycle別・日次exportでmonthが確認できる", () => {
    const record = makeRecord();
    const builders = [
      buildReview19ExportPayload({ records: [record], exportedAt: EXPORTED_AT }),
      buildDirectReview19DataExportPayload({ record, exportedAt: EXPORTED_AT }),
      buildLatestReview19DataExportPayload({ records: [record], exportedAt: EXPORTED_AT })!,
      buildAllReview19DataExportPayload({ records: [record], exportedAt: EXPORTED_AT }),
      buildAllReview19DataExportPayloadsByDemandCycle({ records: [record], exportedAt: EXPORTED_AT })[0].payload,
    ];
    for (const payload of builders) {
      assertCopies(json(payload).records[0], 10);
      assert.equal(payload.dataSchemaVersion, 3);
    }
    const day = record.daySnapshot!;
    const daily = buildAutomaticDayExportPayload({ date: record.date, daySnapshot: day, exportedAt: EXPORTED_AT });
    assert.equal(daily.daySnapshot.businessMonth, 10);
    assert.equal(daily.daySnapshot.review19Check?.businessMonth, 10);
    const finalized = normalizeFinalizedDayData(day)!;
    const allDays = buildAllFinalizedDayDataExportPayload({ records: [finalized], exportedAt: EXPORTED_AT });
    assert.equal(allDays.records[0].businessMonth, 10);
    assert.equal(allDays.records[0].review19Check?.businessMonth, 10);
  });

  await test("legacy正常化・archive/remote読込はmonth欠損を保持しstorageを一切書き換えない", async () => {
    storage.clear();
    const record = legacyRecord();
    const adapter = new TrackingArchive();
    await adapter.putMany(HISTORICAL_ARCHIVE_REVIEW19_STORE, [{
      key: getReview19ArchiveOperationKey(record), date: record.date,
      demandCycle: record.demandCycle!, sessionStartedAt: record.sessionStartedAt, record,
    }]);
    const repository = new HistoricalArchiveRepository(adapter);
    const originalArchive = JSON.stringify(await adapter.getAll(HISTORICAL_ARCHIVE_REVIEW19_STORE));
    storage.setItem(STORAGE_KEYS.review19Records, JSON.stringify([record]));
    const originalLocal = storage.getItem(STORAGE_KEYS.review19Records);
    adapter.writes = 0;
    storage.writes = 0;
    const archived = await repository.listReview19Records();
    assert.ok(archived.ok);
    const remote = normalizeRemoteReview19Row(json(buildRemoteReview19Row(record)), record.demandCycle!)!;
    for (const read of [normalizeReview19Result(record)!, cloneReview19Result(record)!, loadReview19Records()[0], archived.value[0], remote]) {
      assert.equal("businessMonth" in read, false);
      assert.equal("businessMonth" in read.daySnapshot!, false);
      assert.equal("businessMonth" in read.daySnapshot!.review19Check!, false);
      assert.equal(resolveBusinessMonth(read), 9);
    }
    assert.equal(selectLatestReview19DayCheck([record], record.date)?.businessMonth, undefined);
    assert.equal(normalizeFinalizedDayData(record.daySnapshot)?.businessMonth, undefined);
    assert.equal(storage.writes, 0);
    assert.equal(adapter.writes, 0);
    assert.equal(storage.getItem(STORAGE_KEYS.review19Records), originalLocal);
    assert.equal(JSON.stringify(await adapter.getAll(HISTORICAL_ARCHIVE_REVIEW19_STORE)), originalArchive);
  });

  await test("legacy export fallbackは独立copyのdateから導出し過去record/storageへ埋め戻さない", () => {
    const record = legacyRecord();
    const before = JSON.stringify(record);
    storage.setItem(STORAGE_KEYS.review19Records, JSON.stringify([record]));
    storage.writes = 0;
    const direct = buildDirectReview19DataExportPayload({ record, exportedAt: EXPORTED_AT });
    const all = buildAllReview19DataExportPayload({ records: [record], exportedAt: EXPORTED_AT });
    assertCopies(direct.records[0], 9);
    assertCopies(all.records[0], 9);
    const day = buildAutomaticDayExportPayload({ date: record.date, daySnapshot: record.daySnapshot!, exportedAt: EXPORTED_AT });
    assert.equal(day.daySnapshot.businessMonth, 9);
    assert.equal(day.daySnapshot.review19Check?.businessMonth, 9);
    assert.equal(JSON.stringify(record), before);
    assert.equal(storage.getItem(STORAGE_KEYS.review19Records), `[${before}]`);
    assert.equal(storage.writes, 0);
  });

  await test("保存monthは整数1..12だけ保持し不正値は削除・exportだけ営業月fallbackする", () => {
    for (const value of [0, 13, 4.5, "10", null]) {
      const record = makeRecord();
      record.businessMonth = value as number;
      record.daySnapshot!.businessMonth = value as number;
      record.daySnapshot!.review19Check!.businessMonth = value as number;
      const normalized = normalizeReview19Result(record)!;
      assert.equal("businessMonth" in normalized, false);
      assert.equal("businessMonth" in normalized.daySnapshot!, false);
      assert.equal("businessMonth" in normalized.daySnapshot!.review19Check!, false);
      const day = normalizeFinalizedDayData(record.daySnapshot)!;
      assert.equal("businessMonth" in day, false);
      assert.equal("businessMonth" in day.review19Check!, false);
      assertCopies(buildReview19ExportPayload({ records: [record], exportedAt: EXPORTED_AT }).records[0], 10);
    }
    const explicit = makeRecord();
    explicit.businessMonth = 7;
    assert.equal(normalizeReview19Result(explicit)?.businessMonth, 7);
    assert.equal(resolveBusinessMonth(explicit), 7);
  });

  await test("month metadata有無でReview19統計・productionAnalysisが完全一致する", () => {
    const records = ["2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18"].map((date) => makeRecord(date));
    const legacy = records.map((record) => {
      const copy = json(record);
      delete copy.businessMonth;
      delete copy.daySnapshot!.businessMonth;
      delete copy.daySnapshot!.review19Check!.businessMonth;
      return copy;
    });
    const params = { areaId: "onigiri" as const, count: 12, date: "2026-10-02", weekday: 5, demandCycle: "normal" as const };
    const withMonth = buildReview19HistoryStatistics({ ...params, historicalRecords: records });
    assert.deepEqual(withMonth, buildReview19HistoryStatistics({ ...params, historicalRecords: legacy }));
    assert.ok(withMonth.autoEvaluationBasis.sampleSize >= 3);
    const newRecord = makeRecord();
    const oldRecord = legacyRecord("2026-10-02");
    const analysis = (record: Review19Result) => buildProductionAnalysis({
      date: record.date, demandCycle: record.demandCycle!, areaIds: record.expectedAreaIds!,
      sessions: [], areaCountRecords: [], review19Check: record.daySnapshot!.review19Check,
    });
    assert.deepEqual(analysis(newRecord), analysis(oldRecord));
    assert.deepEqual(normalizeReview19Result(newRecord)?.productionAnalysis, normalizeReview19Result(oldRecord)?.productionAnalysis);
  });

  await test("fixed-time実save handlerはmonthを表示用recordへ保持してproduction書込を行わない", async () => {
    storage.clear();
    storage.writes = 0;
    let state = stateFor(makeRecord());
    let persistenceCalls = 0;
    const deny = () => { persistenceCalls++; throw new Error("fixed-time production write"); };
    const context = {
      ...completionContext(state), isTestMode: true, review19SaveInFlightRef: { current: false },
      setState: (update: (previous: AppState) => AppState) => { state = update(state); },
      persistCompletedReview19LocalFirstAsync: deny, saveReview19ToHistoricalArchive: deny,
      enqueueReview19RecordForCloud: deny, releaseAuxiliaryStorageForReview19: deny,
    };
    const complete = runInNewContext(hookFunction("buildRecordedReview19Result"), context) as () => Review19Result;
    Object.assign(context, { buildRecordedReview19Result: complete });
    const save = runInNewContext(hookFunction("saveReview19"), context) as () => Promise<void>;
    await save();
    assert.equal(state.screen, "review19_done");
    assertCopies(state.review19!, 10);
    assert.equal(persistenceCalls, 0);
    assert.equal(storage.writes, 0);
  });
} finally {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
}

console.log(`\n${passed} Review19 businessMonth checks passed.`);
