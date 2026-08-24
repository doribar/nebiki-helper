import { enqueueReview19RecordForCloud } from "./cloudSync.ts";
import {
  PENDING_SUPABASE_SYNC_STORAGE_KEY,
} from "./supabaseSyncQueue.ts";
import {
  appendReview19RecordSafely,
  attemptStorageOperation,
  releaseAuxiliaryStorageForReview19,
  reportStorageOperationFailures,
  type StorageOperationResult,
} from "./storage.ts";
import type { Review19Result } from "./types.ts";

export type Review19CompletionStorageResult = {
  localSaved: boolean;
  cloudQueuePrepared: boolean;
  cloudQueueChanged: boolean;
  localResult: StorageOperationResult;
  localAttempts: StorageOperationResult[];
  cloudQueueResult: StorageOperationResult | null;
  cloudQueueAttempts: StorageOperationResult[];
  recoveryResults: StorageOperationResult[];
};

type Review19CompletionStorageDependencies = {
  saveLocal: (record: Review19Result) => StorageOperationResult;
  enqueueCloud: (record: Review19Result) => boolean;
  releaseAuxiliary: () => StorageOperationResult[];
};

const DEFAULT_DEPENDENCIES: Review19CompletionStorageDependencies = {
  saveLocal: appendReview19RecordSafely,
  enqueueCloud: enqueueReview19RecordForCloud,
  releaseAuxiliary: releaseAuxiliaryStorageForReview19,
};

function attemptCloudEnqueue(
  record: Review19Result,
  enqueueCloud: (record: Review19Result) => boolean,
): { result: StorageOperationResult; changed: boolean } {
  let changed = false;
  const result = attemptStorageOperation({
    key: PENDING_SUPABASE_SYNC_STORAGE_KEY,
    operation: "set",
    run: () => {
      changed = enqueueCloud(record);
    },
  });
  return { result, changed };
}

/**
 * 完成済みReview19を端末正本→cloud outboxの順に保存する。
 * Quota時だけ、補助runtime history→重複checkpointの順に解放して各1回再試行する。
 */
export function persistCompletedReview19LocalFirst(
  record: Review19Result,
  dependencies: Review19CompletionStorageDependencies = DEFAULT_DEPENDENCIES,
): Review19CompletionStorageResult {
  const recoveryResults: StorageOperationResult[] = [];

  let localResult = dependencies.saveLocal(record);
  const localAttempts = [localResult];
  if (!localResult.ok && localResult.quotaExceeded) {
    recoveryResults.push(...dependencies.releaseAuxiliary());
    localResult = dependencies.saveLocal(record);
    localAttempts.push(localResult);
  }
  reportStorageOperationFailures("review19-local-save", [localResult]);
  reportStorageOperationFailures("review19-storage-recovery", recoveryResults);

  if (!localResult.ok) {
    return {
      localSaved: false,
      cloudQueuePrepared: false,
      cloudQueueChanged: false,
      localResult,
      localAttempts,
      cloudQueueResult: null,
      cloudQueueAttempts: [],
      recoveryResults,
    };
  }

  let cloudAttempt = attemptCloudEnqueue(record, dependencies.enqueueCloud);
  const cloudQueueAttempts = [cloudAttempt.result];
  if (!cloudAttempt.result.ok && cloudAttempt.result.quotaExceeded) {
    recoveryResults.push(...dependencies.releaseAuxiliary());
    cloudAttempt = attemptCloudEnqueue(record, dependencies.enqueueCloud);
    cloudQueueAttempts.push(cloudAttempt.result);
  }
  reportStorageOperationFailures("review19-cloud-enqueue", [cloudAttempt.result]);
  reportStorageOperationFailures("review19-storage-recovery", recoveryResults);

  return {
    localSaved: true,
    cloudQueuePrepared: cloudAttempt.result.ok,
    cloudQueueChanged: cloudAttempt.result.ok && cloudAttempt.changed,
    localResult,
    localAttempts,
    cloudQueueResult: cloudAttempt.result,
    cloudQueueAttempts,
    recoveryResults,
  };
}
