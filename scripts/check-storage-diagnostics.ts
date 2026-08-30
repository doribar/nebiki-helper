import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NEBIKI_KNOWN_LOCAL_STORAGE_KEYS,
  NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES,
  collectNebikiStorageUsageDiagnostic,
  ensureNebikiLocalStorageHeadroom,
  formatStorageKiB,
  type StorageDiagnosticStorage,
} from "../src/domain/storageDiagnostics.ts";

class MemoryStorage implements StorageDiagnosticStorage {
  protected readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  seed(key: string, value: unknown): void {
    this.values.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  remove(key: string): void {
    this.values.delete(key);
  }
}

class SecurityErrorStorage extends MemoryStorage {
  override getItem(key: string): string | null {
    if (key === "nebiki-helper/current-session") {
      const error = new Error("not displayed");
      error.name = "SecurityError";
      throw error;
    }
    return super.getItem(key);
  }
}

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

const now = () => new Date("2026-08-29T00:00:00.000Z");

await test("全known keyと未知のnebiki-helper keyを匿名列挙する", async () => {
  const storage = new MemoryStorage();
  storage.seed("nebiki-helper/review19-records", [{ id: 1 }, { id: 2 }]);
  storage.seed("nebiki-helper/future-key-v1", { private: "hidden" });
  storage.seed("unrelated-origin-key", "ignored");
  const diagnostic = await collectNebikiStorageUsageDiagnostic({
    storage,
    estimateProvider: null,
    now,
  });
  assert.equal(diagnostic.status, "ready");
  assert.equal(
    diagnostic.localStorage.knownKeyCount,
    NEBIKI_KNOWN_LOCAL_STORAGE_KEYS.length,
  );
  assert.equal(diagnostic.localStorage.presentKeyCount, 2);
  assert.equal(diagnostic.localStorage.unknownPrefixedKeyCount, 1);
  assert.ok(
    diagnostic.localStorage.entries.some(
      (entry) => entry.key === "nebiki-helper/future-key-v1",
    ),
  );
  assert.ok(
    diagnostic.localStorage.entries.every(
      (entry) => entry.key !== "unrelated-origin-key",
    ),
  );
});

await test("UTF-16 key+value bytesとrecord countを正確に算出する", async () => {
  const storage = new MemoryStorage();
  const key = "nebiki-helper/review19-records";
  const value = JSON.stringify([{ x: "あ" }, { x: "b" }]);
  storage.seed(key, value);
  const diagnostic = await collectNebikiStorageUsageDiagnostic({
    storage,
    estimateProvider: null,
    now,
  });
  const entry = diagnostic.localStorage.entries.find(
    (candidate) => candidate.key === key,
  );
  assert.equal(entry?.approxBytes, (key.length + value.length) * 2);
  assert.equal(entry?.recordCount, 2);
  assert.equal(diagnostic.localStorage.totalApproxBytes, entry?.approxBytes);
});

await test("fixed-time byDateは日付件数をrecord countとして返す", async () => {
  const storage = new MemoryStorage();
  storage.seed("nebiki-helper/fixed-time-temperature-by-date-v1", {
    version: 1,
    byDate: {
      "2026-08-28": { "16": 30 },
      "2026-08-29": { "16": 31 },
    },
  });
  const diagnostic = await collectNebikiStorageUsageDiagnostic({
    storage,
    estimateProvider: null,
    now,
  });
  assert.equal(
    diagnostic.localStorage.entries.find(
      (entry) =>
        entry.key === "nebiki-helper/fixed-time-temperature-by-date-v1",
    )?.recordCount,
    2,
  );
});

await test("payload本文・token・credentialをdiagnosticへ含めない", async () => {
  const storage = new MemoryStorage();
  storage.seed("nebiki-helper/current-session", {
    access_token: "SECRET_ACCESS_TOKEN_123",
    product: "PRIVATE_PRODUCT_BODY_456",
    authorization: "Bearer PRIVATE_789",
  });
  const diagnostic = await collectNebikiStorageUsageDiagnostic({
    storage,
    estimateProvider: null,
    now,
  });
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, /SECRET_ACCESS_TOKEN_123/);
  assert.doesNotMatch(serialized, /PRIVATE_PRODUCT_BODY_456/);
  assert.doesNotMatch(serialized, /Bearer PRIVATE_789/);
});

await test("2.25 MiB soft budgetとheadroomを返す", async () => {
  const storage = new MemoryStorage();
  storage.seed("nebiki-helper/current-session", { screen: "start" });
  const diagnostic = await collectNebikiStorageUsageDiagnostic({
    storage,
    estimateProvider: null,
    now,
  });
  assert.equal(
    diagnostic.localStorage.softBudgetBytes,
    NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES,
  );
  assert.equal(
    diagnostic.localStorage.headroomBytes,
    NEBIKI_LOCAL_STORAGE_SOFT_BUDGET_BYTES -
      diagnostic.localStorage.totalApproxBytes,
  );
  assert.equal(diagnostic.localStorage.overBudgetBytes, 0);
});

await test("key別top sizeは降順かつ指定件数に限定する", async () => {
  const storage = new MemoryStorage();
  storage.seed("nebiki-helper/current-session", "x".repeat(100));
  storage.seed("nebiki-helper/runtime-state", "x".repeat(300));
  storage.seed("nebiki-helper/daily-message-state", "x".repeat(200));
  const diagnostic = await collectNebikiStorageUsageDiagnostic({
    storage,
    estimateProvider: null,
    topEntryLimit: 2,
    now,
  });
  assert.deepEqual(
    diagnostic.localStorage.topEntries.map((entry) => entry.key),
    ["nebiki-helper/runtime-state", "nebiki-helper/daily-message-state"],
  );
});

await test("archive count/statusは外部summaryだけを統合する", async () => {
  const diagnostic = await collectNebikiStorageUsageDiagnostic({
    storage: new MemoryStorage(),
    archive: {
      review19Count: 180,
      finalizedDayCount: 180,
      migrationStatus: "complete",
    },
    estimateProvider: null,
    now,
  });
  assert.deepEqual(diagnostic.archive, {
    review19Count: 180,
    finalizedDayCount: 180,
    migrationStatus: "complete",
  });
});

await test("navigator.storage estimateはorigin参考値でlocalStorage quotaと表現しない", async () => {
  const diagnostic = await collectNebikiStorageUsageDiagnostic({
    storage: new MemoryStorage(),
    estimateProvider: async () => ({ usage: 1_000, quota: 5_000 }),
    now,
  });
  assert.deepEqual(diagnostic.originEstimate, {
    available: true,
    usageBytes: 1_000,
    quotaBytes: 5_000,
    headroomBytes: 4_000,
    errorName: null,
    isLocalStorageQuota: false,
  });
});

await test("SecurityErrorをpayloadなしpartial diagnosticへ変換する", async () => {
  const storage = new SecurityErrorStorage();
  storage.seed("nebiki-helper/current-session", { private: "never returned" });
  const diagnostic = await collectNebikiStorageUsageDiagnostic({
    storage,
    estimateProvider: null,
    now,
  });
  assert.equal(diagnostic.status, "partial");
  const entry = diagnostic.localStorage.entries.find(
    (candidate) => candidate.key === "nebiki-helper/current-session",
  );
  assert.equal(entry?.readable, false);
  assert.equal(entry?.errorName, "SecurityError");
  assert.doesNotMatch(JSON.stringify(diagnostic), /never returned/);
});

await test("storage unavailableでもthrowせず構造化する", async () => {
  const diagnostic = await collectNebikiStorageUsageDiagnostic({
    storage: null,
    estimateProvider: null,
    now,
  });
  assert.equal(diagnostic.status, "unavailable");
  assert.equal(diagnostic.localStorage.totalApproxBytes, 0);
  assert.equal(diagnostic.localStorage.entries.length, 0);
});

await test("headroom十分ならcleanupを呼ばない", async () => {
  const storage = new MemoryStorage();
  storage.seed("nebiki-helper/current-session", { screen: "start" });
  let cleanupCalls = 0;
  const result = await ensureNebikiLocalStorageHeadroom({
    requiredAdditionalBytes: 100,
    storage,
    estimateProvider: null,
    softBudgetBytes: 10_000,
    cleanup: () => {
      cleanupCalls += 1;
    },
    now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.cleanupAttempted, false);
  assert.equal(cleanupCalls, 0);
});

await test("headroom不足時はreview済みcleanupを最大1回だけ呼び再計測する", async () => {
  const storage = new MemoryStorage();
  storage.seed("nebiki-helper/runtime-state", "x".repeat(1_000));
  let cleanupCalls = 0;
  const result = await ensureNebikiLocalStorageHeadroom({
    requiredAdditionalBytes: 200,
    storage,
    estimateProvider: null,
    softBudgetBytes: 1_000,
    cleanup: () => {
      cleanupCalls += 1;
      storage.remove("nebiki-helper/runtime-state");
    },
    now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.cleanupAttempted, true);
  assert.equal(result.cleanupSucceeded, true);
  assert.equal(cleanupCalls, 1);
  assert.ok(
    result.after.localStorage.totalApproxBytes <
      result.before.localStorage.totalApproxBytes,
  );
});

await test("cleanup failureをerrorNameだけで返しrecursive retryしない", async () => {
  const storage = new MemoryStorage();
  storage.seed("nebiki-helper/runtime-state", "x".repeat(1_000));
  let cleanupCalls = 0;
  const result = await ensureNebikiLocalStorageHeadroom({
    requiredAdditionalBytes: 200,
    storage,
    estimateProvider: null,
    softBudgetBytes: 1_000,
    cleanup: () => {
      cleanupCalls += 1;
      const error = new Error("private cleanup detail");
      error.name = "SecurityError";
      throw error;
    },
    now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.cleanupAttempted, true);
  assert.equal(result.cleanupSucceeded, false);
  assert.equal(result.cleanupErrorName, "SecurityError");
  assert.equal(cleanupCalls, 1);
  assert.doesNotMatch(JSON.stringify(result), /private cleanup detail/);
});

await test("diagnostic/preflight moduleにraw storage writeを追加しない", () => {
  const source = readFileSync(
    new URL("../src/domain/storageDiagnostics.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\.setItem\s*\(/);
  assert.doesNotMatch(source, /\.removeItem\s*\(/);
});

await test("format helperはpayloadに触れずKiBだけを返す", () => {
  assert.equal(formatStorageKiB(2_304), "2.3 KiB");
});

console.log(`Storage diagnostics checks passed: ${passed}/15`);


