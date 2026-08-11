import { useState, type CSSProperties } from "react";
import { APP_VERSION, BUILD_ID, DATA_SCHEMA_VERSION } from "../../domain/dataVersion.ts";
import type { SupabaseBackfillResult } from "../../domain/types.ts";

type ExportAction = () => boolean | Promise<boolean>;

type AdminSettingsDialogProps = {
  review19Count?: number;
  dailyCount?: number;
  onExportAllReview19Data?: ExportAction;
  onExportLatestReview19Data?: ExportAction;
  onExportAllDailyData?: ExportAction;
  onExportLatestDailyData?: ExportAction;
  cloudSync?: {
    pendingCount: number;
    syncing: boolean;
    lastBackfillResult: SupabaseBackfillResult | null;
  };
  onSyncLocalDataToSupabase?: () => Promise<SupabaseBackfillResult>;
  onClose: () => void;
};

const panelStyle: CSSProperties = {
  width: "min(92vw, 520px)",
  maxWidth: "100%",
  boxSizing: "border-box",
  maxHeight: "88svh",
  overflowY: "auto",
  borderRadius: 22,
  background: "#fff",
  padding: 20,
  boxShadow: "0 20px 60px rgba(0, 0, 0, 0.28)",
};

const exportButtonStyle: CSSProperties = {
  width: "100%",
  minHeight: 52,
  borderRadius: 12,
  border: "1px solid #b91c1c",
  background: "#fff",
  color: "#991b1b",
  fontSize: 16,
  fontWeight: 900,
  cursor: "pointer",
};

export function AdminSettingsDialog({
  review19Count = 0,
  dailyCount = 0,
  onExportAllReview19Data,
  onExportLatestReview19Data,
  onExportAllDailyData,
  onExportLatestDailyData,
  cloudSync,
  onSyncLocalDataToSupabase,
  onClose,
}: AdminSettingsDialogProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runExport = async (
    action: ExportAction | undefined,
    emptyMessage: string,
  ) => {
    if (!action || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const exported = await action();
      setStatus(exported ? "JSONを出力しました。" : emptyMessage);
    } finally {
      setBusy(false);
    }
  };

  const runCloudSync = async () => {
    if (!onSyncLocalDataToSupabase || busy || cloudSync?.syncing) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await onSyncLocalDataToSupabase();
      if (result.skippedReason === "fixed_time_mode") {
        setStatus("時刻固定モードでは本番Supabaseへ同期しません。");
        return;
      }
      setStatus(
        result.allSynced
          ? `同期完了：成功 ${result.succeededCount}件、未同期 0件`
          : `同期結果：成功 ${result.succeededCount}件、失敗 ${result.failedCount}件、未同期 ${result.pendingCount}件`,
      );
    } catch (error) {
      setStatus(
        `同期処理を完了できませんでした：${error instanceof Error ? error.message : "不明なエラー"}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="設定"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(15, 23, 42, 0.58)",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section style={panelStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 26, lineHeight: 1.2 }}>設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="設定を閉じる"
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: "#fff",
              fontSize: 26,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: 20, color: "#475569", fontSize: 13, lineHeight: 1.6 }}>
          アプリ版: {APP_VERSION}
          <br />
          ビルドID: {BUILD_ID}
          <br />
          データ形式: {DATA_SCHEMA_VERSION}
        </div>

        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>保存データ</div>
        <div style={{ color: "#475569", fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>
          19:00チェックと1日データは、別々のJSONとして出力します。
        </div>

        <section style={{ marginBottom: 18 }}>
          <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 900 }}>
            19:00チェックデータ（{review19Count}件）
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runExport(onExportAllReview19Data, "19:00チェックデータがありません。")}
              style={exportButtonStyle}
            >
              19:00チェックデータを全件出力
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runExport(onExportLatestReview19Data, "19:00チェックデータがありません。")}
              style={exportButtonStyle}
            >
              最新の19:00チェックデータを出力
            </button>
          </div>
        </section>

        <section style={{ marginBottom: 18 }}>
          <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 900 }}>
            1日データ（{dailyCount}件）
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runExport(onExportAllDailyData, "1日データがありません。")}
              style={exportButtonStyle}
            >
              1日データを全件出力
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runExport(onExportLatestDailyData, "1日データがありません。")}
              style={exportButtonStyle}
            >
              最新の1日データを出力
            </button>
          </div>
        </section>

        <section
          style={{
            borderTop: "1px solid #e2e8f0",
            paddingTop: 16,
          }}
        >
          <div style={{ marginBottom: 6, fontSize: 16, fontWeight: 900 }}>
            Supabase同期
          </div>
          <div style={{ color: "#475569", fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>
            端末内の通常・夏季の残数履歴と19:00チェックをクラウドへ送ります。
            端末内データは削除しません。
            <br />
            クラウド未同期：{cloudSync?.pendingCount ?? 0}件
          </div>
          <button
            type="button"
            disabled={busy || cloudSync?.syncing || !onSyncLocalDataToSupabase}
            onClick={() => void runCloudSync()}
            style={{
              ...exportButtonStyle,
              borderColor: "#0369a1",
              color: "#075985",
              background: "#f0f9ff",
            }}
          >
            {busy || cloudSync?.syncing
              ? "同期中…"
              : "端末内データをSupabaseへ同期"}
          </button>
          {cloudSync?.lastBackfillResult ? (
            <div style={{ marginTop: 8, color: "#475569", fontSize: 12, lineHeight: 1.5 }}>
              検出：残数 {cloudSync.lastBackfillResult.detectedAreaCount}件・19:00 {cloudSync.lastBackfillResult.detectedReview19Count}件
              <br />
              送信対象 {cloudSync.lastBackfillResult.queuedCount}件
              <br />
              成功 {cloudSync.lastBackfillResult.succeededCount}件／失敗 {cloudSync.lastBackfillResult.failedCount}件／未同期 {cloudSync.lastBackfillResult.pendingCount}件
            </div>
          ) : null}
        </section>

        {status ? (
          <div
            role="status"
            style={{ marginTop: 14, padding: 10, borderRadius: 10, background: "#f1f5f9", fontSize: 14, fontWeight: 800 }}
          >
            {status}
          </div>
        ) : null}
      </section>
    </div>
  );
}
