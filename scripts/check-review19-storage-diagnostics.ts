import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { persistCompletedReview19LocalFirst } from "../src/domain/review19CompletionStorage.ts";
import {
  buildReview19StorageFailureAlert,
  createReview19StorageFailureDiagnostic,
  reportReview19StorageFailureDiagnostic,
} from "../src/domain/review19StorageDiagnostics.ts";
import {
  STORAGE_KEYS,
  attemptStorageOperation,
  type StorageOperationResult,
} from "../src/domain/storage.ts";
import type { Review19Result } from "../src/domain/types.ts";

let passed = 0;

function test(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

function success(
  key: string,
  operation: "set" | "remove" = "set",
): StorageOperationResult {
  return { ok: true, key, operation };
}

function failure(params: {
  key?: string;
  errorName: string;
  quotaExceeded: boolean;
  operation?: "set" | "remove";
}): StorageOperationResult {
  return {
    ok: false,
    key: params.key ?? STORAGE_KEYS.review19Records,
    operation: params.operation ?? "set",
    errorName: params.errorName,
    quotaExceeded: params.quotaExceeded,
  };
}

const completeRecord = {
  date: "2026-08-24",
  demandCycle: "summer",
  sessionStartedAt: "2026-08-24T19:00:00.000+09:00",
  recordedAt: "2026-08-24T19:12:00.000+09:00",
} as Review19Result;

const originalWarn = console.warn;
console.warn = () => undefined;

try {
  test("QuotaExceededErrorの正本再失敗はstage別attemptと安全なUI文言を返す", () => {
    let localCalls = 0;
    let releaseCalls = 0;
    let cloudCalls = 0;
    const result = persistCompletedReview19LocalFirst(completeRecord, {
      saveLocal: () => {
        localCalls += 1;
        return failure({
          errorName: "QuotaExceededError",
          quotaExceeded: true,
        });
      },
      enqueueCloud: () => {
        cloudCalls += 1;
        return true;
      },
      releaseAuxiliary: () => {
        releaseCalls += 1;
        return [
          success(STORAGE_KEYS.runtimeState, "remove"),
          success(STORAGE_KEYS.workSessionCheckpoint, "remove"),
        ];
      },
    });

    assert.equal(result.localSaved, false);
    assert.equal(localCalls, 2);
    assert.equal(releaseCalls, 1);
    assert.equal(cloudCalls, 0);
    assert.equal(result.localAttempts.length, 2);
    assert.equal(result.cloudQueueAttempts.length, 0);

    const diagnostic = createReview19StorageFailureDiagnostic({
      stage: "authoritative_local_save",
      finalResult: result.localResult,
      attempts: result.localAttempts,
    });
    const message = buildReview19StorageFailureAlert(diagnostic);
    assert.equal(diagnostic.errorName, "QuotaExceededError");
    assert.equal(diagnostic.quotaExceeded, true);
    assert.equal(diagnostic.retryAttempted, true);
    assert.match(message, /保存先：19時チェック端末正本/);
    assert.match(message, /操作：書き込み/);
    assert.match(message, /エラー：QuotaExceededError/);
    assert.match(message, /容量上限エラー：はい/);
    assert.match(message, /再試行：実施済み（失敗）/);
    assert.match(message, /ブラウザ保存領域の上限/);
    assert.match(message, /端末本体の空き容量不足を示すものとは限りません/);
    assert.doesNotMatch(message, /端末の空き容量を確認/);
  });

  test("SecurityErrorはcleanupもretryもせず実際のerrorNameを表示する", () => {
    const captured = attemptStorageOperation({
      key: STORAGE_KEYS.review19Records,
      operation: "set",
      run: () => {
        throw new DOMException("fixture security detail", "SecurityError");
      },
    });
    let localCalls = 0;
    let releaseCalls = 0;
    const result = persistCompletedReview19LocalFirst(completeRecord, {
      saveLocal: () => {
        localCalls += 1;
        return captured;
      },
      enqueueCloud: () => true,
      releaseAuxiliary: () => {
        releaseCalls += 1;
        return [];
      },
    });
    const diagnostic = createReview19StorageFailureDiagnostic({
      stage: "authoritative_local_save",
      finalResult: result.localResult,
      attempts: result.localAttempts,
    });
    const message = buildReview19StorageFailureAlert(diagnostic);

    assert.equal(localCalls, 1);
    assert.equal(releaseCalls, 0);
    assert.equal(result.localAttempts.length, 1);
    assert.equal(diagnostic.errorName, "SecurityError");
    assert.equal(diagnostic.quotaExceeded, false);
    assert.equal(diagnostic.retryAttempted, false);
    assert.match(message, /エラー：SecurityError/);
    assert.match(message, /容量上限エラー：いいえ/);
    assert.match(message, /再試行：未実施/);
    assert.match(message, /アクセスが拒否されました/);
    assert.doesNotMatch(message, /ブラウザ保存領域の上限/);
    assert.doesNotMatch(message, /fixture security detail/);
  });

  test("errorName欠損や不正値はUnknownErrorへ安全化し本文を漏らさない", () => {
    const diagnostic = createReview19StorageFailureDiagnostic({
      stage: "authoritative_local_save",
      finalResult: failure({
        errorName: "SecurityError\nAuthorization: Bearer record-payload-secret",
        quotaExceeded: false,
      }),
      attempts: [],
    });
    const message = buildReview19StorageFailureAlert(diagnostic);
    assert.equal(diagnostic.errorName, "UnknownError");
    assert.match(message, /エラー：UnknownError/);
    assert.doesNotMatch(message, /Authorization|Bearer|record-payload-secret/);

    const missing = createReview19StorageFailureDiagnostic({
      stage: "authoritative_local_save",
      finalResult: null,
      attempts: [],
    });
    assert.equal(missing.errorName, "UnknownError");
  });

  test("StorageUnavailableErrorも推測せず取得済みerrorNameとして表示する", () => {
    const diagnostic = createReview19StorageFailureDiagnostic({
      stage: "authoritative_local_save",
      finalResult: failure({
        errorName: "StorageUnavailableError",
        quotaExceeded: false,
      }),
      attempts: [
        failure({
          errorName: "StorageUnavailableError",
          quotaExceeded: false,
        }),
      ],
    });
    const message = buildReview19StorageFailureAlert(diagnostic);
    assert.match(message, /エラー：StorageUnavailableError/);
    assert.match(message, /容量上限エラー：いいえ/);
    assert.match(message, /再試行：未実施/);
    assert.doesNotMatch(message, /ブラウザ保存領域の上限|端末の空き容量/);
  });

  test("Quota初回失敗後の1回retry成功は正本保存・cloud準備へ進む", () => {
    let localCalls = 0;
    let releaseCalls = 0;
    let cloudCalls = 0;
    const result = persistCompletedReview19LocalFirst(completeRecord, {
      saveLocal: () => {
        localCalls += 1;
        return localCalls === 1
          ? failure({ errorName: "QuotaExceededError", quotaExceeded: true })
          : success(STORAGE_KEYS.review19Records);
      },
      enqueueCloud: () => {
        cloudCalls += 1;
        return true;
      },
      releaseAuxiliary: () => {
        releaseCalls += 1;
        return [];
      },
    });

    assert.equal(result.localSaved, true);
    assert.equal(result.cloudQueuePrepared, true);
    assert.equal(localCalls, 2);
    assert.equal(releaseCalls, 1);
    assert.equal(cloudCalls, 1);
    assert.equal(result.localAttempts.length, 2);
    assert.equal(result.localResult.ok, true);
  });

  test("pending-only SecurityErrorは正本成功と明確に区別する", () => {
    const result = persistCompletedReview19LocalFirst(completeRecord, {
      saveLocal: () => success(STORAGE_KEYS.review19Records),
      enqueueCloud: () => {
        throw new DOMException("fixture pending security", "SecurityError");
      },
      releaseAuxiliary: () => [],
    });
    const diagnostic = createReview19StorageFailureDiagnostic({
      stage: "cloud_queue_prepare",
      finalResult: result.cloudQueueResult,
      attempts: result.cloudQueueAttempts,
    });
    const message = buildReview19StorageFailureAlert(diagnostic);

    assert.equal(result.localSaved, true);
    assert.equal(result.cloudQueuePrepared, false);
    assert.equal(result.localAttempts.length, 1);
    assert.equal(result.cloudQueueAttempts.length, 1);
    assert.match(message, /19時チェックは端末へ保存されました/);
    assert.match(message, /保存先：クラウド同期用の未送信キュー/);
    assert.match(message, /エラー：SecurityError/);
    assert.match(message, /端末正本は保存されています/);
    assert.doesNotMatch(message, /^19時チェックを端末へ保存できませんでした/);
  });

  test("pending quota再失敗もstage別に最大1回retryとして記録する", () => {
    let queueCalls = 0;
    let releaseCalls = 0;
    const result = persistCompletedReview19LocalFirst(completeRecord, {
      saveLocal: () => success(STORAGE_KEYS.review19Records),
      enqueueCloud: () => {
        queueCalls += 1;
        throw new DOMException("fixture pending quota", "QuotaExceededError");
      },
      releaseAuxiliary: () => {
        releaseCalls += 1;
        return [];
      },
    });
    const diagnostic = createReview19StorageFailureDiagnostic({
      stage: "cloud_queue_prepare",
      finalResult: result.cloudQueueResult,
      attempts: result.cloudQueueAttempts,
    });

    assert.equal(result.localSaved, true);
    assert.equal(result.cloudQueuePrepared, false);
    assert.equal(queueCalls, 2);
    assert.equal(releaseCalls, 1);
    assert.equal(result.cloudQueueAttempts.length, 2);
    assert.equal(diagnostic.retryAttempted, true);
    assert.equal(diagnostic.quotaExceeded, true);
  });

  test("同じ失敗状態で完了を複数回試しても各attempt内retryは1回だけ", () => {
    let localCalls = 0;
    let releaseCalls = 0;
    let cloudCalls = 0;
    const before = JSON.stringify(completeRecord);
    const dependencies = {
      saveLocal: () => {
        localCalls += 1;
        return failure({ errorName: "QuotaExceededError", quotaExceeded: true });
      },
      enqueueCloud: () => {
        cloudCalls += 1;
        return true;
      },
      releaseAuxiliary: () => {
        releaseCalls += 1;
        return [];
      },
    };

    const first = persistCompletedReview19LocalFirst(completeRecord, dependencies);
    const second = persistCompletedReview19LocalFirst(completeRecord, dependencies);
    assert.equal(first.localAttempts.length, 2);
    assert.equal(second.localAttempts.length, 2);
    assert.equal(localCalls, 4);
    assert.equal(releaseCalls, 2);
    assert.equal(cloudCalls, 0);
    assert.equal(JSON.stringify(completeRecord), before);
    assert.equal(completeRecord.sessionStartedAt, "2026-08-24T19:00:00.000+09:00");
  });

  test("safe console diagnosticはstorage metadataだけを出力する", () => {
    const calls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };
    const diagnostic = createReview19StorageFailureDiagnostic({
      stage: "authoritative_local_save",
      finalResult: failure({
        errorName: "QuotaExceededError",
        quotaExceeded: true,
      }),
      attempts: [
        failure({ errorName: "QuotaExceededError", quotaExceeded: true }),
        failure({ errorName: "QuotaExceededError", quotaExceeded: true }),
      ],
    });
    reportReview19StorageFailureDiagnostic(diagnostic);
    const serialized = JSON.stringify(calls);
    assert.match(serialized, /review19-storage-failure/);
    assert.match(serialized, /QuotaExceededError/);
    assert.doesNotMatch(serialized, /review19-records|sessionStartedAt|payload|credential/);
    console.warn = () => undefined;
  });

  test("hookは正本とpendingの診断stageを分け、正本失敗時だけdone前にreturnする", () => {
    const hookSource = readFileSync(
      new URL("../src/hooks/useNebikiApp.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(hookSource, /19時チェックを端末へ保存できませんでした。端末の空き容量/);
    assert.match(
      hookSource,
      /if \(!persistenceResult\.localSaved\)[\s\S]*?stage: "authoritative_local_save"[\s\S]*?buildReview19StorageFailureAlert\(diagnostic\)[\s\S]*?return;/,
    );
    assert.match(
      hookSource,
      /else \{[\s\S]*?stage: "cloud_queue_prepare"[\s\S]*?buildReview19StorageFailureAlert\(diagnostic\)/,
    );
    assert.match(
      hookSource,
      /if \(!persistenceResult\.localSaved\)[\s\S]*?return;[\s\S]*?screen: "review19_done"/,
    );
  });
} finally {
  console.warn = originalWarn;
}

console.log(`Review19 storage diagnostics checks passed: ${passed}/${passed}`);
