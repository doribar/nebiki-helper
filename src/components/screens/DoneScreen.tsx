import type { CSSProperties } from "react";
import type { DoneSummaryItem } from "../../domain/types";

type DoneScreenProps = {
  onGoBack: () => void;
  onReturnHome: () => void;
  referenceText?: string;
  timeText?: string;
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

function getReferenceBaseText(referenceText: string): string {
  return referenceText.replace(/を基準に考えて$/, "");
}

function getReferenceWeekdayBaseText(referenceText: string, timeText: string): string {
  const baseText = getReferenceBaseText(referenceText);
  const suffix = `の${timeText}`;
  return baseText.endsWith(suffix)
    ? baseText.slice(0, -suffix.length)
    : baseText;
}

function BasisTimeMiniPanel({
  referenceText,
  timeText,
}: {
  referenceText: string;
  timeText: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        padding: "10px 12px",
        borderRadius: 10,
        background: "#f7f7f7",
        border: "1px solid #e0e0e0",
        fontSize: 13,
        color: "#333",
        lineHeight: 1.5,
        marginBottom: 12,
      }}
    >
      <div>
        <strong>今日の曜日：</strong>
        {getReferenceWeekdayBaseText(referenceText, timeText)}
      </div>
      <div>
        <strong>値引時刻：</strong>
        {timeText}
      </div>
    </div>
  );
}

export function DoneScreen({
  onGoBack,
  onReturnHome,
  referenceText,
  timeText,
  summaryItems,
}: DoneScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 16, marginBottom: 12 }}>
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

          {referenceText && timeText ? (
            <BasisTimeMiniPanel referenceText={referenceText} timeText={timeText} />
          ) : null}

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
                {item.rateText === "スキップ済み" ? (
                  <>
                    <div style={{ fontWeight: 800 }}>スキップ済み</div>
                    {item.statusText ? (
                      <div style={{ color: "#666", whiteSpace: "pre-line" }}>
                        {item.statusText}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 800 }}>
                      多い → {item.manyRateText ?? item.rateText}
                    </div>
                    <div style={{ fontWeight: 800 }}>
                      どちらでもない → {item.normalRateText ?? item.rateText}
                    </div>
                    {item.statusText ? (
                      <div style={{ color: "#666", whiteSpace: "pre-line" }}>
                        {item.statusText}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={onReturnHome} style={{ ...subActionButtonStyle, width: "100%" }}>
          トップに戻る
        </button>
      </div>
    </main>
  );
}
