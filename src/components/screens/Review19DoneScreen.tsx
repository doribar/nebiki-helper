import type { CSSProperties } from "react";
import { PrimaryButton } from "../layout/PrimaryButton";

type Review19DoneScreenProps = {
  unexportedCount: number;
  totalCount: number;
  shouldRecommendExport: boolean;
  onExportUnexported: () => void;
  onExportAll: () => void;
  onReturnHome: () => void;
};

const cardStyle: CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 12,
  padding: 20,
  marginTop: 16,
  background: "#fff",
};

export function Review19DoneScreen({
  unexportedCount,
  totalCount,
  shouldRecommendExport,
  onExportUnexported,
  onExportAll,
  onReturnHome,
}: Review19DoneScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <section
        style={{
          ...cardStyle,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 12 }}>
          19時売場チェックを
          <br />
          記録しました
        </div>
        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.7 }}>
          値引終了画面とは別に、振り返りデータの保存状況を確認できます。
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>
          19:00チェックデータ
        </div>

        {shouldRecommendExport ? (
          <div
            style={{
              border: "1px solid #f0d58c",
              borderRadius: 12,
              padding: 12,
              background: "#fff8df",
              fontSize: 14,
              color: "#5c4400",
              lineHeight: 1.7,
              fontWeight: 800,
              marginBottom: 14,
            }}
          >
            19:00チェックデータが{unexportedCount}回分たまりました。
            <br />
            分析用に出力するのがおすすめです。
          </div>
        ) : null}

        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.7, marginBottom: 14 }}>
          未出力データ：{unexportedCount}回分
          <br />
          保存済みデータ：{totalCount}回分
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <PrimaryButton onClick={onExportUnexported} disabled={unexportedCount === 0}>
            未出力データを出力
          </PrimaryButton>
          <button
            type="button"
            onClick={onExportAll}
            disabled={totalCount === 0}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #ccc",
              background: totalCount === 0 ? "#eee" : "#fff",
              color: totalCount === 0 ? "#999" : "#111",
              fontSize: 14,
              fontWeight: 700,
              cursor: totalCount === 0 ? "not-allowed" : "pointer",
            }}
          >
            全データを出力
          </button>
        </div>
      </section>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton onClick={onReturnHome}>トップに戻る</PrimaryButton>
      </div>

    </main>
  );
}
