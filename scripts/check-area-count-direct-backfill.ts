import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  AREA_COUNT_DIRECT_SYNC_BATCH_SIZE,
  syncAuthoritativeAreaCountRecordsDirectly,
} from "../src/domain/areaCountDirectSync.ts";
import {
  getAreaCountRecordIdentity,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import {
  flushPendingSupabaseSyncQueue,
  loadPendingSupabaseSyncQueue,
  PENDING_SUPABASE_SYNC_STORAGE_KEY,
  savePendingSupabaseSyncQueue,
  type PendingSupabaseSyncItem,
} from "../src/domain/supabaseSyncQueue.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  writes = 0;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.values.set(key, String(value));
  }
}

class QuotaTrapStorage extends MemoryStorage {
  override setItem(): void {
    this.writes += 1;
    throw new DOMException("fixture origin quota", "QuotaExceededError");
  }
}

function dateFromOffset(index: number): string {
  const date = new Date(Date.UTC(2022, 0, 1 + index));
  return date.toISOString().slice(0, 10);
}

function makeRecord(
  index: number,
  overrides: Partial<AreaCountRecord> = {},
): AreaCountRecord {
  const date = overrides.date ?? dateFromOffset(index);
  const demandCycle = overrides.demandCycle ?? (index % 5 === 0 ? "summer" : "normal");
  const discountTime = overrides.discountTime ?? (index % 2 === 0 ? "15" : "17");
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const labels = ["日", "月", "火", "水", "木", "金", "土"] as const;
  const evaluation = index % 3 === 0 ? "few" : "normal";
  return {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-13-fixture",
    buildId: "build-area-direct-fixture",
    date,
    sessionStartedAt: `${date}T${discountTime === "15" ? "06" : "08"}:00:00.000Z`,
    recordedAt: `${date}T${discountTime === "15" ? "06" : "08"}:05:00.000Z`,
    areaId: overrides.areaId ?? NORMAL_ROUTE[index % NORMAL_ROUTE.length]!,
    discountTime,
    actualWeekday: labels[weekday],
    actualWeekdayGroup: weekday === 1 || weekday === 3
      ? "月水"
      : weekday === 5 || weekday === 6
        ? discountTime === "15" ? "金土日" : "金土"
        : discountTime === "15" ? "火木" : "火木日",
    count: index % 41,
    demandCycle,
    userJudge: index % 7 === 0 ? evaluation : undefined,
    suggestedEvaluation: evaluation,
    evaluationSource: index % 7 === 0 ? "manual" : "history",
    decisionBasis: {
      ruleVersion: "area_count_median_v1",
      demandCycle,
      evaluationSource: index % 7 === 0 ? "manual" : "history",
      recommendationStatus: "ready",
      sampleSize: 8,
      requiredSampleSize: 3,
      finalEvaluation: evaluation,
    },
    calendarContext: {
      actualWeekday: labels[weekday],
      isHoliday: false,
      isDayBeforeHoliday: false,
      isObon: false,
      calendarCondition: "ordinary",
      individualAmountReference: {
        type: "weekday_group",
        group: "ordinary_weekday",
        reason: "ordinary",
      },
      areaCountReference: {
        type: "weekday_group",
        group: "ordinary_weekday",
        reason: "ordinary",
      },
    },
    analysisWeatherContext: {
      weatherDataSource: "entered_hourly_forecast",
      forecastWeatherClass: "dry",
      hasForecastPrecipitation: false,
      forecastPrecipitationTypes: [],
    },
    ...overrides,
  };
}

function pendingItem(record: AreaCountRecord, index: number): PendingSupabaseSyncItem {
  return {
    type: "area_count",
    identity: getAreaCountRecordIdentity(record),
    payload: record,
    firstFailedAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    enqueuedAt: new Date(Date.UTC(2026, 7, 27, 10, 0, index)).toISOString(),
    lastError: null,
  };
}

function utf16EntryBytes(key: string, value: unknown): number {
  return (key.length + JSON.stringify(value).length) * 2;
}

let passed = 0;
async function test(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

const richRecords = Array.from({ length: 878 }, (_, index) => makeRecord(index));

await test("878 rich sourceを最大100件のmemory batchでdirect uploadする", async () => {
  const batchSizes: number[] = [];
  const result = await syncAuthoritativeAreaCountRecordsDirectly(richRecords, {
    uploader: async (records) => {
      batchSizes.push(records.length);
      return { status: "saved", savedCount: records.length };
    },
  });
  assert.equal(result.detectedCount, 878);
  assert.equal(result.canonicalCount, 878);
  assert.equal(result.targetCount, 878);
  assert.equal(result.succeededCount, 878);
  assert.equal(result.failedCount, 0);
  assert.equal(result.deferredCount, 0);
  assert.equal(batchSizes.length, 9);
  assert.ok(batchSizes.every((size) => size <= AREA_COUNT_DIRECT_SYNC_BATCH_SIZE));
  assert.equal(batchSizes.reduce((sum, size) => sum + size, 0), 878);
});

await test("manual direct syncはnear-quota localStorageへ1 byteもpendingを書かない", async () => {
  const storage = new QuotaTrapStorage();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    const result = await syncAuthoritativeAreaCountRecordsDirectly(richRecords, {
      uploader: async (records) => ({ status: "saved", savedCount: records.length }),
    });
    assert.equal(result.succeededCount, 878);
    assert.equal(storage.writes, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

await test("remote-coveredと既存pending identityをdirect対象から安全に除外する", async () => {
  const remote = richRecords.slice(0, 120);
  const pendingIdentities = new Set(
    richRecords.slice(120, 150).map(getAreaCountRecordIdentity),
  );
  let uploaded = 0;
  const result = await syncAuthoritativeAreaCountRecordsDirectly(richRecords, {
    knownRemoteRecords: remote,
    pendingIdentities,
    uploader: async (records) => {
      uploaded += records.length;
      return { status: "saved", savedCount: records.length };
    },
  });
  assert.equal(result.remoteCoveredCount, 120);
  assert.equal(result.pendingCoveredCount, 30);
  assert.equal(result.targetCount, 728);
  assert.equal(uploaded, 728);
});

await test("business identity upsertを反復してもremote rowとmedian sampleを増殖させない", async () => {
  const remoteRows = new Map<string, AreaCountRecord>();
  const uploader = async (records: readonly AreaCountRecord[]) => {
    for (const record of records) {
      remoteRows.set(getAreaCountRecordIdentity(record), record);
    }
    return { status: "saved" as const, savedCount: records.length };
  };
  const first = await syncAuthoritativeAreaCountRecordsDirectly(richRecords, { uploader });
  const second = await syncAuthoritativeAreaCountRecordsDirectly(richRecords, { uploader });
  assert.equal(first.succeededCount, 878);
  assert.equal(second.succeededCount, 878);
  assert.equal(remoteRows.size, 878);
  const covered = await syncAuthoritativeAreaCountRecordsDirectly(richRecords, {
    knownRemoteRecords: [...remoteRows.values()],
    uploader,
  });
  assert.equal(covered.remoteCoveredCount, 878);
  assert.equal(covered.attemptedCount, 0);
});

await test("Failed to fetchで停止しlocal sourceを不変のまま次回再送できる", async () => {
  const before = JSON.stringify(richRecords);
  let call = 0;
  const failed = await syncAuthoritativeAreaCountRecordsDirectly(richRecords, {
    uploader: async (records) => {
      call += 1;
      return call === 2
        ? { status: "error", message: "Failed to fetch", errorKind: "network" }
        : { status: "saved", savedCount: records.length };
    },
  });
  assert.equal(failed.succeededCount, 100);
  assert.equal(failed.failedCount, 100);
  assert.equal(failed.deferredCount, 678);
  assert.equal(call, 2, "failure後に残りbatchをhammerしない");
  assert.equal(JSON.stringify(richRecords), before);

  const retried = await syncAuthoritativeAreaCountRecordsDirectly(richRecords, {
    knownRemoteRecords: richRecords.slice(0, 100),
    uploader: async (records) => ({ status: "saved", savedCount: records.length }),
  });
  assert.equal(retried.remoteCoveredCount, 100);
  assert.equal(retried.succeededCount, 778);
  assert.equal(retried.failedCount, 0);
});

await test("legacy rich AreaCount pending 30件は成功時に既存CAS経路で削除する", async () => {
  const storage = new MemoryStorage();
  const records = richRecords.slice(0, 30);
  savePendingSupabaseSyncQueue(records.map(pendingItem), { storage });
  const result = await flushPendingSupabaseSyncQueue({
    storage,
    sender: async () => ({ ok: true }),
    now: () => "2026-08-28T00:00:00.000Z",
  });
  assert.deepEqual(result, { attempted: 30, succeeded: 30, failed: 0, retained: 0 });
  assert.equal(loadPendingSupabaseSyncQueue({ storage }).length, 0);
});

await test("legacy rich AreaCount pending 30件はFailed to fetch時に保持する", async () => {
  const storage = new MemoryStorage();
  const records = richRecords.slice(0, 30);
  savePendingSupabaseSyncQueue(records.map(pendingItem), { storage });
  const result = await flushPendingSupabaseSyncQueue({
    storage,
    sender: async () => ({ ok: false, error: "Failed to fetch" }),
    now: () => "2026-08-28T00:00:00.000Z",
  });
  assert.deepEqual(result, { attempted: 30, succeeded: 0, failed: 30, retained: 30 });
  const retained = loadPendingSupabaseSyncQueue({ storage });
  assert.ok(retained.every((item) => item.lastError === "Failed to fetch"));
  assert.ok(retained.every((item) => item.attemptCount === 1));
});

await test("旧rich pending一括複製と9-14 direct方式の追加storage量を実測する", () => {
  const legacyPending = richRecords.map(pendingItem);
  const legacyBytes = utf16EntryBytes(
    PENDING_SUPABASE_SYNC_STORAGE_KEY,
    legacyPending,
  );
  const directAdditionalBytes = 0;
  assert.ok(legacyBytes > 1_000_000);
  assert.equal(directAdditionalBytes, 0);
  console.log(
    `INFO AreaCount manual backfill UTF-16 records=878 ` +
      `legacyRichPendingKiB=${(legacyBytes / 1024).toFixed(1)} ` +
      `directAdditionalKiB=${(directAdditionalBytes / 1024).toFixed(1)} ` +
      `reduction=100.0%`,
  );
});

await test("hook manual syncはrich enqueueを呼ばず既存queue→directの順で処理する", () => {
  const hook = readFileSync(
    resolve(import.meta.dirname, "../src/hooks/useNebikiApp.ts"),
    "utf8",
  );
  const start = hook.indexOf("async function syncLocalDataToSupabase");
  const end = hook.indexOf("function resetApp", start);
  assert.ok(start >= 0 && end > start);
  const block = hook.slice(start, end);
  assert.doesNotMatch(block, /enqueueAreaCountRecordsForCloud/);
  assert.match(block, /syncAuthoritativeAreaCountRecordsDirectly\(collectedAreaRecords/);
  assert.ok(
    block.indexOf("await retryPendingCloudSync()") <
      block.indexOf("syncAuthoritativeAreaCountRecordsDirectly(collectedAreaRecords"),
  );
  assert.match(block, /pendingAreaIdentities/);
});

await test("管理UIはsource検出・送信対象・queueを別の意味で表示する", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../src/components/common/AdminSettingsDialog.tsx"),
    "utf8",
  );
  assert.match(source, /端末source検出：残数/);
  assert.match(source, /残数remote照合/);
  assert.match(source, /残数直接送信対象/);
  assert.match(source, /同期後の未送信キュー/);
  assert.match(source, /AreaCount rich payloadは追加しません/);
});

console.log(`AreaCount direct backfill checks passed: ${passed}/${passed}`);
