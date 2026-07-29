import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FINALIZED_DAY_DATA_STORAGE_KEY,
  initializeFinalizedDayData,
  loadFinalizedDayData,
  patchFinalizedDayDataMetadataByRecordId,
  patchFinalizedDayDataMetadataByRecordIdInMemory,
  type StoredFinalizedDayData,
} from "../src/domain/finalizedDayData.ts";
import { buildDirectFinalizedDayDataExportPayload } from "../src/domain/separateDataExport.ts";
import type { Review19DaySnapshot } from "../src/domain/types.ts";

let passed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`OK: ${name}`);
  } catch (error) {
    console.error(`NG: ${name}`);
    throw error;
  }
}

function makeDay(date: string, capturedAt: string): Review19DaySnapshot {
  return {
    version: 1,
    capturedAt,
    date,
    review19Status: "not_performed",
    sessions: [],
    areaCountRecords: [],
  };
}

function withoutMetadata(record: StoredFinalizedDayData): unknown {
  const cloned = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  delete cloned.memo;
  delete cloned.discardCount;
  return cloned;
}

class ToggleFailStorage implements Storage {
  private readonly values = new Map<string, string>();
  failWrites = false;

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("storage write failed");
    this.values.set(key, value);
  }
}

function withStorage(fn: (storage: ToggleFailStorage) => void): void {
  const previousStorage = globalThis.localStorage;
  const storage = new ToggleFailStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    fn(storage);
  } finally {
    if (previousStorage) {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousStorage,
      });
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  }
}

test("recordId patch updates only the finalized record selected by the done screen", () => {
  const first = initializeFinalizedDayData({
    daySnapshot: makeDay("2026-07-28", "2026-07-28T20:31:00+09:00"),
  });
  const second = initializeFinalizedDayData({
    daySnapshot: makeDay("2026-07-29", "2026-07-29T20:31:00+09:00"),
  });
  const beforeFirst = first.record;
  const beforeSecond = second.record;

  const patched = patchFinalizedDayDataMetadataByRecordIdInMemory({
    currentRecords: [beforeFirst, beforeSecond],
    recordId: beforeSecond.recordId,
    patch: { memo: "current memo" },
  });

  assert.equal(patched.record?.recordId, beforeSecond.recordId);
  assert.equal(patched.record?.memo, "current memo");
  assert.deepEqual(
    patched.records.find((record) => record.recordId === beforeFirst.recordId),
    beforeFirst,
  );
});

test("memo patch does not rebuild the finalized daily snapshot core", () => {
  const initialized = initializeFinalizedDayData({
    daySnapshot: makeDay("2026-07-29", "2026-07-29T20:31:00+09:00"),
  }).record;
  const patched = patchFinalizedDayDataMetadataByRecordIdInMemory({
    currentRecords: [initialized],
    recordId: initialized.recordId,
    patch: { memo: "typed before export" },
  }).record;

  assert.ok(patched);
  assert.deepEqual(withoutMetadata(patched), withoutMetadata(initialized));
});

test("the direct one-record export contains the memo saved immediately before export", () => {
  const initialized = initializeFinalizedDayData({
    daySnapshot: makeDay("2026-07-29", "2026-07-29T20:31:00+09:00"),
  }).record;
  const updated = patchFinalizedDayDataMetadataByRecordIdInMemory({
    currentRecords: [initialized],
    recordId: initialized.recordId,
    patch: { memo: "not saved with the separate button" },
  }).record;
  assert.ok(updated);

  const payload = buildDirectFinalizedDayDataExportPayload({
    record: updated,
    exportedAt: "2026-07-29T20:40:00+09:00",
  });
  assert.equal(payload.daySnapshot.recordId, initialized.recordId);
  assert.equal(payload.daySnapshot.memo, "not saved with the separate button");
});

test("an empty memo is formally saved and exported as null", () => {
  const initialized = initializeFinalizedDayData({
    daySnapshot: makeDay("2026-07-29", "2026-07-29T20:31:00+09:00"),
  }).record;
  const withOldMemo = patchFinalizedDayDataMetadataByRecordIdInMemory({
    currentRecords: [initialized],
    recordId: initialized.recordId,
    patch: { memo: "old memo" },
  }).record;
  assert.ok(withOldMemo);
  const cleared = patchFinalizedDayDataMetadataByRecordIdInMemory({
    currentRecords: [withOldMemo],
    recordId: initialized.recordId,
    patch: { memo: null },
  }).record;
  assert.ok(cleared);

  const payload = buildDirectFinalizedDayDataExportPayload({
    record: cleared,
    exportedAt: "2026-07-29T20:41:00+09:00",
  });
  assert.equal(cleared.memo, null);
  assert.equal(payload.daySnapshot.memo, null);
});

test("a missing recordId never falls back to another finalized day", () => {
  const initialized = initializeFinalizedDayData({
    daySnapshot: makeDay("2026-07-29", "2026-07-29T20:31:00+09:00"),
  }).record;
  const result = patchFinalizedDayDataMetadataByRecordIdInMemory({
    currentRecords: [initialized],
    recordId: "nebiki-day:missing",
    patch: { memo: "must not be written" },
  });
  assert.equal(result.record, null);
  assert.deepEqual(result.records, [initialized]);
});

test("a storage failure preserves the old memo and surfaces an exception", () => {
  withStorage((storage) => {
    const initialized = initializeFinalizedDayData({
      daySnapshot: makeDay("2026-07-29", "2026-07-29T20:31:00+09:00"),
    }).record;
    assert.ok(storage.getItem(FINALIZED_DAY_DATA_STORAGE_KEY));
    storage.failWrites = true;

    assert.throws(
      () =>
        patchFinalizedDayDataMetadataByRecordId({
          recordId: initialized.recordId,
          patch: { memo: "new memo" },
        }),
      /storage write failed/,
    );

    storage.failWrites = false;
    assert.equal(loadFinalizedDayData()[0]?.memo, null);
  });
});

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const hookSource = fs.readFileSync(
  path.join(projectRoot, "src/hooks/useNebikiApp.ts"),
  "utf8",
);
const doneSource = fs.readFileSync(
  path.join(projectRoot, "src/components/screens/DoneScreen.tsx"),
  "utf8",
);
const routerSource = fs.readFileSync(
  path.join(projectRoot, "src/app/AppRouter.tsx"),
  "utf8",
);

test("export persists the current memo before creating the download payload", () => {
  const start = hookSource.indexOf(
    "function exportCompletedDailyData(memo: string | null)",
  );
  const end = hookSource.indexOf("async function exportAllData", start);
  const body = hookSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(body.includes("persistFinalizedDayMemo(recordId, memo)"));
  assert.ok(body.includes("if (!record || record.recordId !== recordId) return false"));
  assert.ok(
    body.indexOf("persistFinalizedDayMemo(recordId, memo)") <
      body.indexOf("downloadJsonFile("),
  );
  assert.ok(
    body.includes("buildDirectFinalizedDayDataExportPayload({ record, exportedAt })"),
  );
});

test("the done screen passes the unsaved current memo and keeps its save button", () => {
  assert.ok(doneSource.includes('memoText === "" ? null : memoText'));
  assert.ok(doneSource.includes("await onExportDailyData?.("));
  assert.ok(doneSource.includes("メモを保存"));
  assert.ok(doneSource.includes('role="alert"'));
  assert.ok(routerSource.includes("actions.exportCompletedDailyData(memo)"));
});

console.log(`\nMemo-before-export regression tests: ${passed}/8 passed`);
