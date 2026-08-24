import type { StorageOperationResult } from "./storage.ts";

export type Review19StorageFailureStage =
  | "authoritative_local_save"
  | "cloud_queue_prepare";

export type Review19StorageFailureDiagnostic = {
  stage: Review19StorageFailureStage;
  operation: "set" | "remove";
  errorName: string;
  quotaExceeded: boolean;
  retryAttempted: boolean;
  retrySucceeded: false;
};

const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

function normalizeStorageErrorName(errorName: unknown): string {
  if (typeof errorName !== "string") return "UnknownError";
  const normalized = errorName.trim();
  return SAFE_ERROR_NAME_PATTERN.test(normalized)
    ? normalized
    : "UnknownError";
}

export function createReview19StorageFailureDiagnostic(params: {
  stage: Review19StorageFailureStage;
  finalResult: StorageOperationResult | null;
  attempts: readonly StorageOperationResult[];
}): Review19StorageFailureDiagnostic {
  const failure = params.finalResult && !params.finalResult.ok
    ? params.finalResult
    : null;

  return {
    stage: params.stage,
    operation: failure?.operation ?? "set",
    errorName: normalizeStorageErrorName(failure?.errorName),
    quotaExceeded: failure?.quotaExceeded ?? false,
    retryAttempted: params.attempts.length > 1,
    retrySucceeded: false,
  };
}

function getStorageTargetLabel(stage: Review19StorageFailureStage): string {
  return stage === "authoritative_local_save"
    ? "19時チェック端末正本"
    : "クラウド同期用の未送信キュー";
}

function getOperationLabel(operation: "set" | "remove"): string {
  return operation === "set" ? "書き込み" : "削除";
}

function getFailureExplanation(
  diagnostic: Review19StorageFailureDiagnostic,
): string | null {
  if (diagnostic.quotaExceeded) {
    return "このアプリで利用できるブラウザ保存領域の上限に達した可能性があります。端末本体の空き容量不足を示すものとは限りません。";
  }
  if (diagnostic.errorName === "SecurityError") {
    return "ブラウザ保存領域へのアクセスが拒否されました。原因はこの情報だけでは確定できません。";
  }
  return null;
}

export function buildReview19StorageFailureAlert(
  diagnostic: Review19StorageFailureDiagnostic,
): string {
  const isAuthoritative = diagnostic.stage === "authoritative_local_save";
  const explanation = getFailureExplanation(diagnostic);
  const retryLabel = diagnostic.retryAttempted
    ? "実施済み（失敗）"
    : "未実施";
  const lines = [
    isAuthoritative
      ? "19時チェックを端末へ保存できませんでした。"
      : "19時チェックは端末へ保存されましたが、クラウド同期の準備に失敗しました。",
    "",
    `保存先：${getStorageTargetLabel(diagnostic.stage)}`,
    `操作：${getOperationLabel(diagnostic.operation)}`,
    `エラー：${diagnostic.errorName}`,
    `容量上限エラー：${diagnostic.quotaExceeded ? "はい" : "いいえ"}`,
    `再試行：${retryLabel}`,
  ];

  if (explanation) {
    lines.push("", explanation);
  }

  lines.push(
    "",
    isAuthoritative
      ? "入力内容は保持されています。原因を確認してから、もう一度「完了」を押してください。"
      : "19時チェック端末正本は保存されています。管理設定の「端末内データをSupabaseへ同期」から再送できます。",
  );

  return lines.join("\n");
}

export function reportReview19StorageFailureDiagnostic(
  diagnostic: Review19StorageFailureDiagnostic,
): void {
  console.warn("[review19-storage-failure]", {
    stage: diagnostic.stage,
    operation: diagnostic.operation,
    errorName: diagnostic.errorName,
    quotaExceeded: diagnostic.quotaExceeded,
    retryAttempted: diagnostic.retryAttempted,
    retrySucceeded: diagnostic.retrySucceeded,
  });
}
