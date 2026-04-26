import type { CSSProperties } from "react";
import type { DoneSummaryItem } from "../../domain/types";
import { PrimaryButton } from "../layout/PrimaryButton";

type DoneScreenProps = {
  onReset: () => void;
  onGoBack: () => void;
  summaryItems: DoneSummaryItem[];
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

const summaryRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.1fr 1.6fr",
  gap: 12,
  alignItems: "start",
  padding: "10px 0",
  borderBottom: "1px solid #eee",
  fontSize: 13,
};

export function DoneScreen({ onReset, onGoBack, summaryItems }: DoneScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
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

      {summaryItems.length > 0 ? (
        <section
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 16,
            marginTop: 16,
            background: "#fff",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
            全エリアの値引率
          </div>

          <div
            style={{
              ...summaryRowStyle,
              fontWeight: 800,
              color: "#555",
              borderBottom: "2px solid #ddd",
            }}
          >
            <div>エリア</div>
            <div>値引率</div>
          </div>

          {summaryItems.map((item) => (
            <div key={item.areaId} style={summaryRowStyle}>
              <div style={{ fontWeight: 800 }}>{item.areaName}</div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800 }}>
                  多い → {item.manyRateText ?? item.rateText}
                </div>
                {item.manyNote ? (
                  <div style={{ color: "#666", whiteSpace: "pre-line" }}>
                    {item.manyNote}
                  </div>
                ) : null}
                <div style={{ fontWeight: 800 }}>
                  どちらでもない → {item.normalRateText ?? item.rateText}
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
