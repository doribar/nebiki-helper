import assert from "node:assert/strict";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import {
  DAILY_SESSION_SNAPSHOT_BYTE_BUDGET,
  DAILY_SESSION_SNAPSHOT_MAX_RECORDS,
  STORAGE_KEYS,
  estimateLocalStorageEntryBytes,
  loadDailySessionSnapshots,
  loadPersistedNebikiStateForDate,
  removeStorageKeySafely,
  retainDailySessionSnapshotsWithinBudget,
  upsertDailySessionSnapshotSafely,
} from "../src/domain/storage.ts";
import { FINALIZED_DAY_DATA_STORAGE_KEY } from "../src/domain/finalizedDayData.ts";
import { buildSessionAnalysisCalendarContext } from "../src/domain/analysisMetadata.ts";
import type {
  DailySessionSnapshot,
  DemandCycle,
  DiscountTime,
} from "../src/domain/types.ts";

let passed = 0;

function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

class ControlledStorage implements Storage {
  private readonly values = new Map<string, string>();
  readonly setAttempts: string[] = [];
  readonly removeAttempts: string[] = [];
  failDailySnapshotSets = 0;
  failReads = false;
  failReadsAfterDailySnapshotQuota = false;
  readonly failRemoveKeys = new Set<string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
    this.setAttempts.length = 0;
    this.removeAttempts.length = 0;
    this.failDailySnapshotSets = 0;
    this.failReads = false;
    this.failReadsAfterDailySnapshotQuota = false;
    this.failRemoveKeys.clear();
  }

  getItem(key: string): string | null {
    if (this.failReads) {
      throw new DOMException("fixture read denied", "SecurityError");
    }
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.removeAttempts.push(key);
    if (this.failRemoveKeys.has(key)) {
      throw new DOMException("fixture remove failure", "InvalidStateError");
    }
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.setAttempts.push(key);
    if (
      key === STORAGE_KEYS.dailySessionSnapshots &&
      this.failDailySnapshotSets > 0
    ) {
      this.failDailySnapshotSets -= 1;
      if (this.failReadsAfterDailySnapshotQuota) {
        this.failReads = true;
      }
      throw new DOMException("fixture quota", "QuotaExceededError");
    }
    this.values.set(key, String(value));
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const weather = {
  hourlyForecasts: createDefaultHourlyForecasts(),
  afterRainSky: null,
};

function makeSnapshot(params: {
  date: string;
  discountTime?: DiscountTime;
  demandCycle?: DemandCycle;
  startedSuffix?: string;
  padding?: number;
  preObonOrdinary?: boolean;
}): DailySessionSnapshot {
  const discountTime = params.discountTime ?? "15";
  const startedSuffix = params.startedSuffix ?? "00";
  const startedAt = `${params.date}T12:${startedSuffix}:00.000+09:00`;
  const demandCycle = params.demandCycle ?? "normal";
  const calendarContext = buildSessionAnalysisCalendarContext({
    date: params.date,
    weekday: 4,
    discountTime,
    sessionStartedAt: startedAt,
    manualWeekdayOverride: false,
    applyObonRule: !params.preObonOrdinary,
    areaDecisionBases: [],
  });

  return {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: params.preObonOrdinary ? "2026.8.9-5" : "2026.8.9-7",
    buildId: "build-storage-fixture",
    capturedAt: `${params.date}T12:${startedSuffix}:30.000+09:00`,
    demandCycle,
    calendarContext,
    sessionEndReason: "completed",
    screen: "done",
    session: {
      dataSchemaVersion: 3,
      appVersion: params.preObonOrdinary ? "2026.8.9-5" : "2026.8.9-7",
      buildId: "build-storage-fixture",
      date: params.date,
      weekday: 4,
      discountTime,
      demandCycle,
      startedAt,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather,
      resolvedWeather: {
        rain: false,
        snow: false,
        tempLevel: "26to27",
        windLevel: "under5",
        precipitationRateBonus: 0,
        weatherPointScore: 0,
      },
    },
    basis: {
      baseRateBonus: 0,
      lateTimeBonus: 0,
      totalRateBonus: 0,
      baseRateBonusReason: [],
      noticeText: "x".repeat(params.padding ?? 0),
    },
    areas: {},
    doneSummaryItems: [],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  };
}

function setFinalizedDates(storage: ControlledStorage, dates: string[]): void {
  storage.seed(
    FINALIZED_DAY_DATA_STORAGE_KEY,
    JSON.stringify(
      dates.map((date) => ({
        version: 1,
        date,
        sessions: [],
        areaCountRecords: [],
      })),
    ),
  );
}

const storage = new ControlledStorage();
const previousStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

try {
  test("daily snapshotは件数120に加えて1MiBのUTF-16概算budgetを持つ", () => {
    assert.equal(DAILY_SESSION_SNAPSHOT_MAX_RECORDS, 120);
    assert.equal(DAILY_SESSION_SNAPSHOT_BYTE_BUDGET, 1024 * 1024);
    assert.equal(estimateLocalStorageEntryBytes("ab", "日本"), 8);
  });

  test("retentionは日付groupを分断せず新しい未確定日を優先する", () => {
    const snapshots = [
      makeSnapshot({ date: "2026-08-10", startedSuffix: "00", padding: 250 }),
      makeSnapshot({ date: "2026-08-10", startedSuffix: "01", padding: 250 }),
      makeSnapshot({ date: "2026-08-11", startedSuffix: "00", padding: 250 }),
      makeSnapshot({ date: "2026-08-11", startedSuffix: "01", padding: 250 }),
    ];
    const oneGroupBytes = retainDailySessionSnapshotsWithinBudget(
      snapshots.slice(0, 2),
      { byteBudget: 10 * 1024 * 1024 },
    ).retainedApproxBytes;
    const retained = retainDailySessionSnapshotsWithinBudget(snapshots, {
      byteBudget: oneGroupBytes + 64,
      maxRecords: 120,
      finalizedDates: new Set(["2026-08-10", "2026-08-11"]),
    });
    assert.deepEqual(
      [...new Set(retained.snapshots.map((item) => item.session.date))],
      ["2026-08-11"],
    );
    assert.equal(retained.retainedCount, 2);
    assert.equal(retained.prunedCount, 2);
  });

  test("未finalized日は唯一のlegacy export/backfill fallbackなのでbudget超過でも削除しない", () => {
    const snapshots = [
      makeSnapshot({ date: "2026-08-10", padding: 500 }),
      makeSnapshot({ date: "2026-08-11", padding: 500 }),
    ];
    const retained = retainDailySessionSnapshotsWithinBudget(snapshots, {
      byteBudget: 1,
      maxRecords: 0,
      finalizedDates: new Set(),
    });
    assert.equal(retained.retainedCount, 2);
    assert.equal(retained.prunedCount, 0);
    assert.equal(retained.requiredHistoryExceededBudget, true);
  });

  test("protected current dateはbudgetを超えても全sessionを保持する", () => {
    const snapshots = [
      makeSnapshot({ date: "2026-08-15", startedSuffix: "00", padding: 500 }),
      makeSnapshot({ date: "2026-08-15", startedSuffix: "01", padding: 500 }),
      makeSnapshot({ date: "2026-08-14", startedSuffix: "00", padding: 500 }),
    ];
    const retained = retainDailySessionSnapshotsWithinBudget(snapshots, {
      protectedDates: ["2026-08-15"],
      finalizedDates: new Set(["2026-08-14"]),
      byteBudget: 1,
      maxRecords: 0,
    });
    assert.equal(retained.retainedCount, 2);
    assert.equal(retained.protectedDateExceededBudget, true);
    assert.ok(
      retained.snapshots.every((item) => item.session.date === "2026-08-15"),
    );
  });

  test("容量競合時はfinalized dayへ封印済みの重複copyを低優先にする", () => {
    const finalized = makeSnapshot({ date: "2026-08-13", padding: 500 });
    const unsealed = makeSnapshot({ date: "2026-08-12", padding: 500 });
    const budget = retainDailySessionSnapshotsWithinBudget([unsealed], {
      byteBudget: 10 * 1024 * 1024,
    }).retainedApproxBytes + 64;
    const retained = retainDailySessionSnapshotsWithinBudget(
      [finalized, unsealed],
      {
        finalizedDates: new Set(["2026-08-13"]),
        byteBudget: budget,
      },
    );
    assert.deepEqual(
      retained.snapshots.map((item) => item.session.date),
      ["2026-08-12"],
    );
  });

  test("legacy ordinary Obon recordとnormal/summer factをretentionで書き換えない", () => {
    const legacy = makeSnapshot({
      date: "2026-08-13",
      demandCycle: "normal",
      preObonOrdinary: true,
    });
    const summer = makeSnapshot({
      date: "2026-08-16",
      demandCycle: "summer",
    });
    const retained = retainDailySessionSnapshotsWithinBudget([legacy, summer]);
    const restoredLegacy = retained.snapshots.find(
      (item) => item.session.date === "2026-08-13",
    );
    assert.equal(restoredLegacy?.demandCycle, "normal");
    assert.equal(restoredLegacy?.calendarContext?.calendarCondition, "ordinary");
    assert.equal(
      retained.snapshots.find((item) => item.session.date === "2026-08-16")
        ?.demandCycle,
      "summer",
    );
  });

  test("通常upsertは同一identityを増殖させず対象日を保存する", () => {
    storage.clear();
    const snapshot = makeSnapshot({ date: "2026-08-15" });
    assert.equal(upsertDailySessionSnapshotSafely(snapshot).ok, true);
    assert.equal(upsertDailySessionSnapshotSafely(snapshot).ok, true);
    assert.equal(loadDailySessionSnapshots().length, 1);
  });

  test("quota時は補助runtime/checkpointだけを解放し対象日だけで1回retryする", () => {
    storage.clear();
    const old = makeSnapshot({ date: "2026-08-14" });
    storage.seed(STORAGE_KEYS.dailySessionSnapshots, JSON.stringify([old]));
    storage.seed(STORAGE_KEYS.runtimeState, "runtime-derived");
    storage.seed(STORAGE_KEYS.workSessionCheckpoint, "checkpoint-duplicate");
    storage.seed(STORAGE_KEYS.review19Records, "review-authoritative");
    storage.seed("nebiki-helper/area-count-records-v2", "area-authoritative");
    storage.seed("nebiki-helper/pending-supabase-sync-v1", "queue-authoritative");
    setFinalizedDates(storage, ["2026-08-14"]);
    storage.failDailySnapshotSets = 1;

    const result = upsertDailySessionSnapshotSafely(
      makeSnapshot({ date: "2026-08-15" }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.quotaExceeded, true);
    assert.equal(result.retried, true);
    assert.equal(
      storage.setAttempts.filter(
        (key) => key === STORAGE_KEYS.dailySessionSnapshots,
      ).length,
      2,
    );
    assert.deepEqual(
      loadDailySessionSnapshots().map((item) => item.session.date),
      ["2026-08-15"],
    );
    assert.equal(storage.getItem(STORAGE_KEYS.runtimeState), null);
    assert.equal(storage.getItem(STORAGE_KEYS.workSessionCheckpoint), null);
    assert.equal(
      storage.getItem(STORAGE_KEYS.review19Records),
      "review-authoritative",
    );
    assert.equal(
      storage.getItem("nebiki-helper/area-count-records-v2"),
      "area-authoritative",
    );
    assert.equal(
      storage.getItem("nebiki-helper/pending-supabase-sync-v1"),
      "queue-authoritative",
    );
  });

  test("retry後もquotaなら例外を漏らさず既存snapshotを維持する", () => {
    storage.clear();
    const old = makeSnapshot({ date: "2026-08-14" });
    storage.seed(STORAGE_KEYS.dailySessionSnapshots, JSON.stringify([old]));
    storage.failDailySnapshotSets = 2;

    const result = upsertDailySessionSnapshotSafely(
      makeSnapshot({ date: "2026-08-15" }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.retried, true);
    assert.equal(result.failure?.ok, false);
    assert.deepEqual(
      loadDailySessionSnapshots().map((item) => item.session.date),
      ["2026-08-14"],
    );
  });

  test("quota後にreadがSecurityErrorでも準備済みfinalized集合でretryする", () => {
    storage.clear();
    const old = makeSnapshot({ date: "2026-08-14" });
    storage.seed(STORAGE_KEYS.dailySessionSnapshots, JSON.stringify([old]));
    setFinalizedDates(storage, ["2026-08-14"]);
    storage.failDailySnapshotSets = 1;
    storage.failReadsAfterDailySnapshotQuota = true;

    const result = upsertDailySessionSnapshotSafely(
      makeSnapshot({ date: "2026-08-15" }),
    );

    assert.equal(result.ok, true);
    assert.equal(result.quotaExceeded, true);
    assert.equal(result.retried, true);
    assert.equal(
      storage.setAttempts.filter(
        (key) => key === STORAGE_KEYS.dailySessionSnapshots,
      ).length,
      2,
    );
    assert.equal(result.retainedCount, 1);
    assert.equal(result.prunedCount, 1);
    storage.failReads = false;
    assert.deepEqual(
      loadDailySessionSnapshots().map((item) => item.session.date),
      ["2026-08-15"],
    );
  });

  test("無効snapshotはwriteせず既存履歴を変更しない", () => {
    storage.clear();
    const invalid = makeSnapshot({ date: "2026-08-15" });
    invalid.session.startedAt = "2026-08-14T12:00:00.000+09:00";
    const result = upsertDailySessionSnapshotSafely(invalid);
    assert.equal(result.ok, true);
    assert.equal(result.attempts.length, 0);
    assert.equal(storage.setAttempts.length, 0);
  });

  test("snapshot前処理のSecurityErrorもReact側へ漏らさず失敗結果にする", () => {
    storage.clear();
    storage.failReads = true;
    const result = upsertDailySessionSnapshotSafely(
      makeSnapshot({ date: "2026-08-15" }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.retried, false);
    assert.equal(result.failure?.ok, false);
    assert.equal(result.failure?.ok ? null : result.failure?.errorName, "SecurityError");
    assert.equal(storage.setAttempts.length, 0);
    storage.failReads = false;
  });

  test("localStorage不在もsnapshot保存成功と誤判定しない", () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    try {
      const result = upsertDailySessionSnapshotSafely(
        makeSnapshot({ date: "2026-08-15" }),
      );
      assert.equal(result.ok, false);
      assert.equal(result.retried, false);
      assert.equal(result.failure?.ok, false);
      assert.equal(
        result.failure?.ok ? null : result.failure?.errorName,
        "ReferenceError",
      );
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: storage,
      });
    }
  });

  test("safe removeはremoveItem例外を結果化して呼び出し元へ漏らさない", () => {
    storage.clear();
    storage.seed("fixture/key", "value");
    storage.failRemoveKeys.add("fixture/key");
    const result = removeStorageKeySafely("fixture/key");
    assert.equal(result.ok, false);
    assert.equal(result.operation, "remove");
    assert.equal(storage.getItem("fixture/key"), "value");
  });

  test("起動時のstale session cleanup失敗でもsanitized stateを返す", () => {
    storage.clear();
    const staleSession = {
      session: {
        date: "2026-08-14",
        startedAt: "2026-08-14T12:00:00.000+09:00",
      },
    };
    storage.seed(STORAGE_KEYS.currentSession, JSON.stringify(staleSession));
    storage.seed(
      STORAGE_KEYS.workSessionCheckpoint,
      JSON.stringify(staleSession),
    );
    storage.seed(
      STORAGE_KEYS.runtimeState,
      JSON.stringify({
        areaJudgeSelection: null,
        resumeTargetScreen: null,
        timeSwitchTarget: null,
        undoSnapshot: null,
        screenHistory: [],
      }),
    );
    storage.failRemoveKeys.add(STORAGE_KEYS.currentSession);
    storage.failRemoveKeys.add(STORAGE_KEYS.workSessionCheckpoint);
    storage.failRemoveKeys.add(STORAGE_KEYS.runtimeState);
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const restored = loadPersistedNebikiStateForDate("2026-08-15");
      assert.equal(restored.currentSession, null);
      assert.equal(restored.workSessionCheckpoint, null);
      assert.equal(restored.runtimeState, null);
    } finally {
      console.warn = originalWarn;
    }
  });

  console.log(`\ndaily session snapshot storage安全性: ${passed}/${passed}件成功`);
} finally {
  if (previousStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", previousStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}
