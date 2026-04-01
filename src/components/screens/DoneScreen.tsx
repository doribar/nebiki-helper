import type { CSSProperties } from "react";
import { PrimaryButton } from "../layout/PrimaryButton";

type DoneScreenProps = {
  onReset: () => void;
  onGoBack: () => void;
};

const subActionButtonStyle: CSSProperties = {
  minWidth: 88,
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #ccc",
  background: "#fff",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

export function DoneScreen({ onReset, onGoBack }: DoneScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, marginBottom: 12 }}>
        <button type="button" onClick={onGoBack} style={subActionButtonStyle}>
          戻る
        </button>
      </div>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 20,
          marginTop: 8,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>
          すべてのエリアの確認が
          <br />
          終わりました
        </div>

        <div style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>
          値引作業は完了です。
        </div>

        <PrimaryButton onClick={onReset}>最初の画面に戻る</PrimaryButton>
      </section>
    </main>
  );
}
