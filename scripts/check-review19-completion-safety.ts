import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  persistCompletedReview19LocalFirst,
} from "../src/domain/review19CompletionStorage.ts";
import {
  buildReview19DataQuality,
  createInitialReview19Result,
} from "../src/domain/review19.ts";
import { createReview19HumanEvaluationDetails } from "../src/domain/humanEvaluation.ts";
import {
  STORAGE_KEYS,
  appendReview19RecordSafely,
  attemptStorageOperation,
  loadReview19Records,
  releaseAuxiliaryStorageForReview19,
  savePersistedNebikiState,
  savePersistedNebikiStateSafely,
  savePersistedNebikiStateWithAuxiliaryRecovery,
  type StorageOperationResult,
} from "../src/domain/storage.ts";
import {
  createInitialState,
  normalizeLoadedState,
} from "../src/hooks/nebikiApp/stateNormalization.ts";
import type {
  AppState,
  AreaId,
  Review19AreaEvaluation,
  Review19Result,
} from "../src/domain/types.ts";

let passed = 0;

function test(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

class ControlledStorage implements Storage {
  private values = new Map<string, string>();
  readonly setAttempts: string[] = [];
  readonly removeAttempts: string[] = [];
  readonly failSetKeys = new Set<string>();

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
    this.removeAttempts.push(key);
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.setAttempts.push(key);
    if (this.failSetKeys.has(key)) {
      throw new DOMException("fixture quota", "QuotaExceededError");
    }
    this.values.set(key, String(value));
  }
}

function quotaFailure(key: string): StorageOperationResult {
  return {
    ok: false,
    key,
    operation: "set",
    errorName: "QuotaExceededError",
    quotaExceeded: true,
  };
}

function success(key: string, operation: "set" | "remove" = "set"): StorageOperationResult {
  return { ok: true, key, operation };
}

function makeCompleteReview19(): Review19Result {
  const date = "2026-08-15";
  const recordedAt = `${date}T19:05:00.000+09:00`;
  const initial = createInitialReview19Result({
    date,
    demandCycle: "summer",
    sessionStartedAt: `${date}T17:00:00.000+09:00`,
    reviewStartedAt: `${date}T19:00:00.000+09:00`,
  });
  const areaCounts: Partial<Record<AreaId, number>> = {};
  const areaCountRecordedAt: Partial<Record<AreaId, string>> = {};
  const areaEvaluations: Partial<Record<AreaId, Review19AreaEvaluation>> = {};

  for (const [index, areaId] of NORMAL_ROUTE.entries()) {
    areaCounts[areaId] = index + 1;
    areaCountRecordedAt[areaId] = recordedAt;
    areaEvaluations[areaId] = {
      humanEvaluation: "normal",
      humanEvaluationDetails: createReview19HumanEvaluationDetails({
        selection: {
          humanEvaluationScore9: 5,
          humanEvaluationSelections: ["normal"],
        },
        demandCycle: "summer",
        evaluatedAt: recordedAt,
      }),
      autoEvaluation: null,
      autoEvaluationStatus: "insufficient",
    };
  }

  return {
    ...initial,
    areaCounts,
    areaCountRecordedAt,
    areaEvaluations,
    reviewCompletedAt: recordedAt,
    sourceUpdatedAt: recordedAt,
    recordedAt,
    dataQuality: buildReview19DataQuality({
      date,
      areaCounts,
      areaEvaluations,
      excludedAreaIds: [],
    }),
  };
}

const previousStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const storage = new ControlledStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

const originalWarn = console.warn;
console.warn = () => undefined;

try {
  const completeRecord = makeCompleteReview19();

  test("12エリアの残数・human raw9が揃ったrecordはcompleteになる", () => {
    assert.equal(NORMAL_ROUTE.length, 12);
    assert.equal(completeRecord.dataQuality.complete, true);
    assert.equal(completeRecord.dataQuality.measurementComplete, true);
    assert.equal(completeRecord.dataQuality.humanEvaluationComplete, true);
    assert.equal(Object.keys(completeRecord.areaCounts).length, 12);
    assert.equal(
      completeRecord.areaEvaluations?.bento_men?.humanEvaluationDetails
        ?.humanEvaluationScore9,
      5,
    );
  });

  test("通常容量では端末正本→cloud queueの順に1回ずつ保存する", () => {
    const order: string[] = [];
    const result = persistCompletedReview19LocalFirst(completeRecord, {
      saveLocal: () => {
        order.push("local");
        return success(STORAGE_KEYS.review19Records);
      },
      enqueueCloud: () => {
        order.push("cloud");
        return true;
      },
      releaseAuxiliary: () => {
        order.push("recovery");
        return [];
      },
    });
    assert.deepEqual(order, ["local", "cloud"]);
    assert.equal(result.localSaved, true);
    assert.equal(result.cloudQueuePrepared, true);
    assert.equal(result.cloudQueueChanged, true);
  });

  test("Review19正本のquota失敗時はruntime→checkpointを解放して1回再試行する", () => {
    let saveCount = 0;
    const order: string[] = [];
    const result = persistCompletedReview19LocalFirst(completeRecord, {
      saveLocal: () => {
        saveCount += 1;
        order.push(`local-${saveCount}`);
        return saveCount === 1
          ? quotaFailure(STORAGE_KEYS.review19Records)
          : success(STORAGE_KEYS.review19Records);
      },
      enqueueCloud: () => {
        order.push("cloud");
        return true;
      },
      releaseAuxiliary: () => {
        order.push("release-runtime", "release-checkpoint");
        return [
          success(STORAGE_KEYS.runtimeState, "remove"),
          success(STORAGE_KEYS.workSessionCheckpoint, "remove"),
        ];
      },
    });
    assert.deepEqual(order, [
      "local-1",
      "release-runtime",
      "release-checkpoint",
      "local-2",
      "cloud",
    ]);
    assert.equal(result.localSaved, true);
  });

  test("正本を再試行しても保存不能ならcloudへ進まず完了扱いにしない", () => {
    let cloudCalls = 0;
    const result = persistCompletedReview19LocalFirst(completeRecord, {
      saveLocal: () => quotaFailure(STORAGE_KEYS.review19Records),
      enqueueCloud: () => {
        cloudCalls += 1;
        return true;
      },
      releaseAuxiliary: () => [
        success(STORAGE_KEYS.runtimeState, "remove"),
        success(STORAGE_KEYS.workSessionCheckpoint, "remove"),
      ],
    });
    assert.equal(result.localSaved, false);
    assert.equal(result.cloudQueuePrepared, false);
    assert.equal(cloudCalls, 0);
  });

  test("cloud queueのquota失敗は正本を維持したまま補助領域解放後に再試行する", () => {
    let queueCalls = 0;
    const result = persistCompletedReview19LocalFirst(completeRecord, {
      saveLocal: () => success(STORAGE_KEYS.review19Records),
      enqueueCloud: () => {
        queueCalls += 1;
        if (queueCalls === 1) {
          throw new DOMException("fixture quota", "QuotaExceededError");
        }
        return true;
      },
      releaseAuxiliary: () => [
        success(STORAGE_KEYS.runtimeState, "remove"),
        success(STORAGE_KEYS.workSessionCheckpoint, "remove"),
      ],
    });
    assert.equal(result.localSaved, true);
    assert.equal(result.cloudQueuePrepared, true);
    assert.equal(queueCalls, 2);
  });

  test("cloud queueが再試行後も失敗しても例外を外へ投げず端末正本を保持する", () => {
    assert.doesNotThrow(() => {
      const result = persistCompletedReview19LocalFirst(completeRecord, {
        saveLocal: () => success(STORAGE_KEYS.review19Records),
        enqueueCloud: () => {
          throw new DOMException("fixture quota", "QuotaExceededError");
        },
        releaseAuxiliary: () => [
          success(STORAGE_KEYS.runtimeState, "remove"),
          success(STORAGE_KEYS.workSessionCheckpoint, "remove"),
        ],
      });
      assert.equal(result.localSaved, true);
      assert.equal(result.cloudQueuePrepared, false);
    });
  });

  test("同じ完成recordを再保存してもReview19は重複しない", () => {
    storage.clear();
    assert.equal(appendReview19RecordSafely(completeRecord).ok, true);
    assert.equal(appendReview19RecordSafely(completeRecord).ok, true);
    const records = loadReview19Records();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.dataQuality.complete, true);
  });

  test("reload正規化後も完成recordは残りincompleteへ戻らない", () => {
    const loaded = {
      ...createInitialState(),
      screen: "review19_done",
      review19: completeRecord,
    } as AppState;
    const normalized = normalizeLoadedState(loaded, loaded.sessionDraft);
    assert.equal(normalized.screen, "start");
    assert.equal(normalized.review19, null);
    const records = loadReview19Records();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.recordedAt, completeRecord.recordedAt);
    assert.equal(records[0]?.dataQuality.complete, true);
  });

  test("補助AppState writeがquotaでも他の小さいkey保存を継続してstructured resultを返す", () => {
    storage.clear();
    storage.failSetKeys.add(STORAGE_KEYS.currentSession);
    const state = createInitialState();
    const results = savePersistedNebikiStateSafely({
      currentSession: state,
      workSessionCheckpoint: null,
      runtimeState: null,
      nextSessionSkipRecords: [],
      lastSessionWeather: null,
      lastUsedSessionDraft: state.sessionDraft,
      dailyMessageState: { date: state.sessionDraft.date, shownMessageIds: [] },
    });
    assert.equal(results.find((result) => result.key === STORAGE_KEYS.currentSession)?.ok, false);
    assert.equal(
      results.find((result) => result.key === STORAGE_KEYS.lastUsedSessionDraft)?.ok,
      true,
    );
    assert.equal(
      results.find((result) => result.key === STORAGE_KEYS.dailyMessageState)?.ok,
      true,
    );
    storage.failSetKeys.delete(STORAGE_KEYS.currentSession);
  });

  test("旧effect相当の一括保存はcurrentSession quotaを未処理例外として送出していた", () => {
    storage.clear();
    storage.failSetKeys.add(STORAGE_KEYS.currentSession);
    const state = createInitialState();
    assert.throws(
      () =>
        savePersistedNebikiState({
          currentSession: state,
          workSessionCheckpoint: null,
          runtimeState: null,
          nextSessionSkipRecords: [],
          lastSessionWeather: null,
          lastUsedSessionDraft: state.sessionDraft,
          dailyMessageState: { date: state.sessionDraft.date, shownMessageIds: [] },
        }),
      (error: unknown) =>
        error instanceof DOMException && error.name === "QuotaExceededError",
    );
    storage.failSetKeys.delete(STORAGE_KEYS.currentSession);
  });

  test("currentSession quota時はruntime→checkpoint解放後にcurrentSessionを1回再試行する", () => {
    storage.clear();
    storage.setItem(STORAGE_KEYS.runtimeState, "large-runtime");
    storage.setItem(STORAGE_KEYS.workSessionCheckpoint, "large-checkpoint");
    const setAttemptOffset = storage.setAttempts.length;
    const removeAttemptOffset = storage.removeAttempts.length;
    let currentAttempts = 0;
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string) => {
      if (key === STORAGE_KEYS.currentSession) {
        currentAttempts += 1;
        if (
          storage.getItem(STORAGE_KEYS.runtimeState) ||
          storage.getItem(STORAGE_KEYS.workSessionCheckpoint)
        ) {
          throw new DOMException("fixture quota", "QuotaExceededError");
        }
      }
      originalSetItem(key, value);
    };
    const state = createInitialState();
    const results = savePersistedNebikiStateWithAuxiliaryRecovery({
      currentSession: state,
      workSessionCheckpoint: null,
      runtimeState: null,
      nextSessionSkipRecords: [],
      lastSessionWeather: null,
      lastUsedSessionDraft: state.sessionDraft,
      dailyMessageState: { date: state.sessionDraft.date, shownMessageIds: [] },
    });
    assert.equal(currentAttempts, 2);
    assert.deepEqual(storage.setAttempts.slice(setAttemptOffset, setAttemptOffset + 2), [
      STORAGE_KEYS.currentSession,
      STORAGE_KEYS.nextSessionSkipRecords,
    ]);
    assert.deepEqual(storage.removeAttempts.slice(removeAttemptOffset, removeAttemptOffset + 2), [
      STORAGE_KEYS.runtimeState,
      STORAGE_KEYS.workSessionCheckpoint,
    ]);
    assert.equal(
      results.filter((result) => result.key === STORAGE_KEYS.currentSession).at(-1)?.ok,
      true,
    );
    storage.setItem = originalSetItem;
  });

  test("runtime/checkpoint解放はcurrentSession・Review19・pending queueを削除しない", () => {
    storage.clear();
    const protectedKeys = [
      STORAGE_KEYS.currentSession,
      STORAGE_KEYS.review19Records,
      "nebiki-helper/pending-supabase-sync-v1",
    ];
    for (const key of [
      ...protectedKeys,
      STORAGE_KEYS.runtimeState,
      STORAGE_KEYS.workSessionCheckpoint,
    ]) {
      storage.setItem(key, "fixture");
    }
    const results = releaseAuxiliaryStorageForReview19();
    assert.equal(results.every((result) => result.ok), true);
    assert.deepEqual(storage.removeAttempts.slice(-2), [
      STORAGE_KEYS.runtimeState,
      STORAGE_KEYS.workSessionCheckpoint,
    ]);
    for (const key of protectedKeys) assert.equal(storage.getItem(key), "fixture");
  });

  test("QuotaExceededErrorはthrowせずquota diagnosticへ正規化する", () => {
    const result = attemptStorageOperation({
      key: "fixture/key",
      operation: "set",
      run: () => {
        throw new DOMException("fixture quota", "QuotaExceededError");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorName, "QuotaExceededError");
      assert.equal(result.quotaExceeded, true);
    }
  });

  test("hookは正本保存成功後だけreview19_doneへ遷移しqueue失敗をalertする", () => {
    const hookSource = readFileSync(
      new URL("../src/hooks/useNebikiApp.ts", import.meta.url),
      "utf8",
    );
    assert.match(hookSource, /persistCompletedReview19LocalFirst\(recordedReview\)/);
    assert.match(hookSource, /if \(!persistenceResult\.localSaved\)[\s\S]*?return;/);
    assert.match(
      hookSource,
      /if \(persistenceResult\.cloudQueuePrepared\)[\s\S]*?void retryPendingCloudSync\(\);[\s\S]*?else \{[\s\S]*?window\.alert/,
    );
    assert.match(hookSource, /screen: "review19_done"/);
    assert.match(
      hookSource,
      /catch \(error\)[\s\S]*?reportStorageOperationFailures\("cloud-sync-retry"/,
    );
  });

  test("最後の観測値はReact state flushを待たずfinal saveへ直接渡す", () => {
    const screenSource = readFileSync(
      new URL("../src/components/screens/Review19Screen.tsx", import.meta.url),
      "utf8",
    );
    assert.match(screenSource, /hasAllObservationsAfter\(latestObservation\)/);
    assert.match(screenSource, /window\.setTimeout\(\(\) => onSave\(latestObservation\), 0\)/);
  });

  test("review19_done routerと既存完了メッセージを維持する", () => {
    const routerSource = readFileSync(
      new URL("../src/app/AppRouter.tsx", import.meta.url),
      "utf8",
    );
    const doneSource = readFileSync(
      new URL("../src/components/screens/Review19DoneScreen.tsx", import.meta.url),
      "utf8",
    );
    assert.match(routerSource, /case "review19_done"[\s\S]*?<Review19DoneScreen/);
    assert.match(doneSource, /19時売場チェックを[\s\S]*?記録しました/);
  });

  const completedState = {
    ...createInitialState(),
    screen: "review19_done",
    review19: completeRecord,
  } as AppState;
  const navigationSnapshot = {
    state: completedState,
    areaJudgeSelection: null,
    resumeTargetScreen: null,
    nextSessionSkipRecords: [],
    lastSessionWeather: null,
  };
  const sizeSummary = {
    review19Records: Buffer.byteLength(JSON.stringify([completeRecord]), "utf8"),
    currentSession: Buffer.byteLength(JSON.stringify(completedState), "utf8"),
    workSessionCheckpoint: Buffer.byteLength(JSON.stringify(completedState), "utf8"),
    runtimeStateWithOneHistory: Buffer.byteLength(
      JSON.stringify({
        areaJudgeSelection: null,
        resumeTargetScreen: null,
        timeSwitchTarget: null,
        undoSnapshot: null,
        screenHistory: [navigationSnapshot],
      }),
      "utf8",
    ),
    pendingReview19: Buffer.byteLength(
      JSON.stringify([
        {
          type: "review19",
          identity: JSON.stringify([completeRecord.date, completeRecord.demandCycle]),
          payload: completeRecord,
          firstFailedAt: null,
          lastAttemptAt: null,
          attemptCount: 0,
          enqueuedAt: completeRecord.recordedAt,
          lastError: null,
        },
      ]),
      "utf8",
    ),
  };
  console.log(`INFO: synthetic storage bytes=${JSON.stringify(sizeSummary)}`);
} finally {
  console.warn = originalWarn;
  if (previousStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", previousStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}

console.log(`Review19 completion safety checks passed: ${passed}/${passed}`);
