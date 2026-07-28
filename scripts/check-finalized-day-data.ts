import assert from "node:assert/strict";
import {
  FINALIZED_DAY_DATA_STORAGE_KEY,
  initializeFinalizedDayData,
  initializeFinalizedDayDataInMemory,
  loadFinalizedDayData,
  normalizeFinalizedDayData,
  patchFinalizedDayDataMetadata,
  patchFinalizedDayDataMetadataInMemory,
  replaceFinalizedDayDataCoreInMemory,
  selectAllFinalizedDayData,
  selectFinalizedDayDataByDate,
  selectFinalizedDayDataByRecordId,
  selectLatestFinalizedDayData,
  type StoredFinalizedDayData,
} from "../src/domain/finalizedDayData.ts";
import {
  buildAllFinalizedDayDataExportPayload,
  buildAllReview19DataExportPayload,
  buildDirectFinalizedDayDataExportPayload,
  buildDirectReview19DataExportPayload,
  buildLatestFinalizedDayDataExportPayload,
  buildLatestReview19DataExportPayload,
  selectAllReview19Data,
  selectLatestReview19Data,
} from "../src/domain/separateDataExport.ts";
import type {
  Review19DaySnapshot,
  Review19Result,
} from "../src/domain/types.ts";

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

function makeDay(
  date: string,
  capturedAt: string,
  review19Status: Review19DaySnapshot["review19Status"] = "not_performed",
): Review19DaySnapshot {
  return {
    version: 1,
    capturedAt,
    date,
    review19Status,
    sessions: [],
    areaCountRecords: [],
  };
}

function makeReview(params: {
  date: string;
  sessionStartedAt: string;
  reviewStartedAt?: string;
  reviewCompletedAt?: string;
  recordedAt?: string;
  status?: "recorded" | "not_applicable";
}): Review19Result {
  return {
    review19Status: params.status ?? "recorded",
    date: params.date,
    sessionStartedAt: params.sessionStartedAt,
    reviewStartedAt: params.reviewStartedAt,
    reviewCompletedAt: params.reviewCompletedAt,
    recordedAt: params.recordedAt,
    areaCountRecordedAt: {},
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCounts: {},
    excludedAreaIds: [],
    excludeReasons: {},
    dataQuality: {
      expectedAreaCount: 0,
      recordedAreaCount: 0,
      excludedAreaCount: 0,
      missingAreaIds: [],
      duplicateAreaIds: [],
      complete: true,
      processComplete: true,
      measurementComplete: true,
      notMeasuredAreaIds: [],
      missingReasons: {},
    },
  };
}

function withoutMetadata(record: StoredFinalizedDayData): unknown {
  const cloned = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  delete cloned.recordId;
  delete cloned.finalizedAt;
  delete cloned.memo;
  delete cloned.discardCount;
  return cloned;
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

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
    this.values.set(key, value);
  }
}

test("旧形式の日次を安定ID・nullメタデータ付きで正規化", () => {
  const normalized = normalizeFinalizedDayData(
    makeDay("2026-07-27", "2026-07-27T20:35:00+09:00"),
  );
  assert.ok(normalized);
  assert.equal(normalized.recordId, "nebiki-day:2026-07-27");
  assert.equal(normalized.finalizedAt, "2026-07-27T20:35:00+09:00");
  assert.equal(normalized.memo, null);
  assert.equal(normalized.discardCount, null);
});

test("初回確定後の再呼出しでは確定済み本体を上書きしない", () => {
  const first = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-27", "2026-07-27T20:35:00+09:00"),
  });
  const second = initializeFinalizedDayDataInMemory({
    currentRecords: first.records,
    daySnapshot: makeDay(
      "2026-07-27",
      "2026-07-27T23:59:00+09:00",
      "recorded",
    ),
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual(second.record, first.record);
  assert.equal(second.records.length, 1);
});

test("メタデータpatchは確定済みスナップショット本体を変更しない", () => {
  const initialized = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-27", "2026-07-27T20:35:00+09:00"),
  });
  const patched = patchFinalizedDayDataMetadataInMemory({
    currentRecords: initialized.records,
    date: "2026-07-27",
    patch: { memo: "売場メモ", discardCount: 0 },
  });

  assert.ok(patched.record);
  assert.equal(patched.record.memo, "売場メモ");
  assert.equal(patched.record.discardCount, 0);
  assert.deepEqual(
    withoutMetadata(patched.record),
    withoutMetadata(initialized.record),
  );
});

test("明示的core置換だけが本体を差し替え、ID・確定日時・メタデータを維持", () => {
  const initialized = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-27", "2026-07-27T20:35:00+09:00"),
  });
  const withMetadata = patchFinalizedDayDataMetadataInMemory({
    currentRecords: initialized.records,
    date: "2026-07-27",
    patch: { memo: "維持", discardCount: 4 },
  });
  const replaced = replaceFinalizedDayDataCoreInMemory({
    currentRecords: withMetadata.records,
    daySnapshot: makeDay(
      "2026-07-27",
      "2026-07-27T20:45:00+09:00",
      "recorded",
    ),
  });

  assert.equal(replaced.record.recordId, initialized.record.recordId);
  assert.equal(replaced.record.finalizedAt, initialized.record.finalizedAt);
  assert.equal(replaced.record.memo, "維持");
  assert.equal(replaced.record.discardCount, 4);
  assert.equal(replaced.record.capturedAt, "2026-07-27T20:45:00+09:00");
  assert.equal(replaced.record.review19Status, "recorded");
});

test("日次selectorは対象日付、同日なら正式確定日時で最新を選ぶ", () => {
  const olderSameDay = normalizeFinalizedDayData({
    ...makeDay("2026-07-27", "2026-07-27T20:50:00+09:00"),
    recordId: "old",
    finalizedAt: "2026-07-27T20:35:00+09:00",
  })!;
  const newerSameDay = normalizeFinalizedDayData({
    ...makeDay("2026-07-27", "2026-07-27T20:40:00+09:00"),
    recordId: "new",
    finalizedAt: "2026-07-27T20:45:00+09:00",
  })!;
  const nextDate = normalizeFinalizedDayData({
    ...makeDay("2026-07-28", "2026-07-28T20:30:00+09:00"),
    finalizedAt: "2026-07-28T20:30:00+09:00",
  })!;

  const all = selectAllFinalizedDayData([
    nextDate,
    olderSameDay,
    newerSameDay,
  ]);
  assert.deepEqual(all.map((record) => record.recordId), ["new", nextDate.recordId]);
  assert.equal(selectLatestFinalizedDayData(all)?.date, "2026-07-28");
  assert.equal(
    selectFinalizedDayDataByDate(all, "2026-07-27")?.recordId,
    "new",
  );
  assert.equal(selectFinalizedDayDataByDate(all, "2026-07-26"), null);
  assert.equal(
    selectFinalizedDayDataByRecordId(all, nextDate.recordId)?.date,
    "2026-07-28",
  );
});

test("専用localStorageキーへ日付ごとに正式記録を保存", () => {
  const previousStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  try {
    const initialized = initializeFinalizedDayData({
      daySnapshot: makeDay("2026-07-27", "2026-07-27T20:35:00+09:00"),
    });
    assert.equal(initialized.created, true);
    assert.ok(storage.getItem(FINALIZED_DAY_DATA_STORAGE_KEY));
    assert.equal(loadFinalizedDayData().length, 1);

    const patched = patchFinalizedDayDataMetadata({
      date: "2026-07-27",
      patch: { memo: "保存済み", discardCount: 2 },
    });
    assert.equal(patched?.memo, "保存済み");
    assert.equal(loadFinalizedDayData()[0]?.discardCount, 2);
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
});

test("19時selectorは保存日時ではなく対象日・実施日時で最新を選ぶ", () => {
  const earlierExecutionLaterSave = makeReview({
    date: "2026-07-27",
    sessionStartedAt: "2026-07-27T18:30:00+09:00",
    reviewCompletedAt: "2026-07-27T19:05:00+09:00",
    recordedAt: "2026-07-27T23:59:00+09:00",
  });
  const laterExecutionEarlierSave = makeReview({
    date: "2026-07-27",
    sessionStartedAt: "2026-07-27T18:40:00+09:00",
    reviewCompletedAt: "2026-07-27T19:20:00+09:00",
    recordedAt: "2026-07-27T19:21:00+09:00",
  });
  const nextDay = makeReview({
    date: "2026-07-28",
    sessionStartedAt: "2026-07-28T18:30:00+09:00",
    reviewCompletedAt: "2026-07-28T19:01:00+09:00",
    recordedAt: "2026-07-28T19:02:00+09:00",
  });
  const legacyExcluded = makeReview({
    date: "2026-07-29",
    sessionStartedAt: "2026-07-29T18:30:00+09:00",
    status: "not_applicable",
  });

  const sameDay = selectAllReview19Data([
    laterExecutionEarlierSave,
    earlierExecutionLaterSave,
  ]);
  assert.equal(
    selectLatestReview19Data(sameDay)?.sessionStartedAt,
    laterExecutionEarlierSave.sessionStartedAt,
  );
  const all = selectAllReview19Data([
    nextDay,
    legacyExcluded,
    earlierExecutionLaterSave,
    laterExecutionEarlierSave,
  ]);
  assert.equal(all.length, 3);
  assert.equal(selectLatestReview19Data(all)?.date, "2026-07-28");
});

test("日次全件payloadへ19時データを混在させない", () => {
  const first = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-27", "2026-07-27T20:35:00+09:00"),
  }).record;
  const second = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-28", "2026-07-28T20:35:00+09:00"),
  }).record;
  const payload = buildAllFinalizedDayDataExportPayload({
    records: [second, first],
    exportedAt: "2026-07-28T21:00:00+09:00",
  });

  assert.equal(payload.format, "nebiki-helper-day-data-export");
  assert.equal(payload.count, 2);
  assert.deepEqual(payload.records.map((record) => record.date), [
    "2026-07-27",
    "2026-07-28",
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "review19Data"), false);
});

test("19時全件・最新payloadへ日次データを混在させない", () => {
  const older = makeReview({
    date: "2026-07-27",
    sessionStartedAt: "2026-07-27T18:30:00+09:00",
    reviewCompletedAt: "2026-07-27T19:10:00+09:00",
  });
  const latest = makeReview({
    date: "2026-07-28",
    sessionStartedAt: "2026-07-28T18:30:00+09:00",
    reviewCompletedAt: "2026-07-28T19:10:00+09:00",
  });
  const allPayload = buildAllReview19DataExportPayload({
    records: [latest, older],
    exportedAt: "2026-07-28T21:00:00+09:00",
  });
  const latestPayload = buildLatestReview19DataExportPayload({
    records: [older, latest],
    exportedAt: "2026-07-28T21:00:00+09:00",
  });

  assert.equal(allPayload.count, 2);
  assert.equal(latestPayload?.count, 1);
  assert.equal(latestPayload?.records[0]?.date, "2026-07-28");
  assert.equal(Object.prototype.hasOwnProperty.call(allPayload, "dailyData"), false);
  assert.equal(
    buildLatestReview19DataExportPayload({ records: [], exportedAt: "x" }),
    null,
  );
});

test("完了画面用builderは検索せず渡された1件を出力", () => {
  const day = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-27", "2026-07-27T20:35:00+09:00"),
  }).record;
  const directDay = buildDirectFinalizedDayDataExportPayload({
    record: day,
    exportedAt: "2026-07-28T10:00:00+09:00",
  });
  assert.equal(directDay.daySnapshot.date, "2026-07-27");

  const review = makeReview({
    date: "2026-07-27",
    sessionStartedAt: "2026-07-27T18:30:00+09:00",
    reviewCompletedAt: "2026-07-27T19:10:00+09:00",
  });
  const directReview = buildDirectReview19DataExportPayload({
    record: review,
    exportedAt: "2026-07-28T10:00:00+09:00",
  });
  assert.equal(directReview.count, 1);
  assert.equal(directReview.records[0]?.sessionStartedAt, review.sessionStartedAt);
});

test("最新日次payloadは空ならnull、存在時は最新1件", () => {
  assert.equal(
    buildLatestFinalizedDayDataExportPayload({ records: [], exportedAt: "x" }),
    null,
  );
  const first = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-27", "2026-07-27T20:35:00+09:00"),
  }).record;
  const second = initializeFinalizedDayDataInMemory({
    currentRecords: [],
    daySnapshot: makeDay("2026-07-28", "2026-07-28T20:35:00+09:00"),
  }).record;
  const payload = buildLatestFinalizedDayDataExportPayload({
    records: [second, first],
    exportedAt: "2026-07-28T21:00:00+09:00",
  });
  assert.equal(payload?.daySnapshot.date, "2026-07-28");
});

console.log(`\n確定日次・分離出力テスト: ${passed}/11件成功`);
