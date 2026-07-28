import type { CSSProperties } from "react";
import { PrimaryButton } from "../layout/PrimaryButton";

type Review19DoneScreenProps = {
  onExportReview19Data: () => void;
  onGoBack: () => void;
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
  onExportReview19Data,
  onGoBack,
  onReturnHome,
}: Review19DoneScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onGoBack}
          style={{
            minWidth: 88,
            minHeight: 44,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #ccc",
            background: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          戻る
        </button>
      </div>
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
          保存データ
        </div>
        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.7, marginBottom: 14 }}>
          今回保存した19:00チェックデータを1件だけ出力します。
        </div>

        <div>
          <PrimaryButton onClick={onExportReview19Data}>
            19:00チェックデータを出力
          </PrimaryButton>
        </div>
      </section>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton onClick={onReturnHome}>トップに戻る</PrimaryButton>
      </div>

    </main>
  );
}
