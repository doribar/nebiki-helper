import type { CSSProperties } from "react";
import { PrimaryButton } from "../layout/PrimaryButton";

type Review19DoneScreenProps = {
  unexportedCount: number;
  canExportTen: boolean;
  onExport: () => void;
  onStart19: () => void;
  onReset: () => void;
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
  canExportTen,
  onExport,
  onStart19,
  onReset,
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
          振り返りデータ
        </div>

        {canExportTen ? (
          <>
            <div style={{ fontSize: 14, color: "#444", lineHeight: 1.7, marginBottom: 16 }}>
              未出力の振り返りデータが{unexportedCount}日分あります。
              <br />
              古い順に10日分をJSONファイルとして保存できます。
            </div>
            <PrimaryButton onClick={onExport}>10日分のデータを出力</PrimaryButton>
          </>
        ) : (
          <div style={{ fontSize: 14, color: "#555", lineHeight: 1.7 }}>
            未出力の振り返りデータ：{unexportedCount}日分
            <br />
            10日分たまると、分析用データを出力できます。
          </div>
        )}
      </section>

      <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
        <PrimaryButton onClick={onStart19}>19時30分の値引に進む</PrimaryButton>
        <button
          type="button"
          onClick={onReset}
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid #ccc",
            background: "#fff",
            fontSize: 16,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          最初の画面に戻る
        </button>
      </div>
    </main>
  );
}
