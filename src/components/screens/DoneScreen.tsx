import type { CSSProperties } from "react";
import type { DoneSummaryItem } from "../../domain/types";
import type { TrainingStepConfig } from "../../domain/trainingMode";

type DoneScreenProps = {
  onGoBack: () => void;
  onReturnHome: () => void;
  referenceText?: string;
  timeText?: string;
  canStartReview19?: boolean;
  onStartReview19?: () => void;
  summaryItems: DoneSummaryItem[];
  trainingStepConfig: TrainingStepConfig;
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
  canStartReview19 = false,
  onStartReview19,
  summaryItems,
  trainingStepConfig,
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

        {canStartReview19 && onStartReview19 ? (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={onStartReview19}
              style={{
                width: "100%",
                border: "1px solid #111",
                borderRadius: 14,
                padding: "14px 16px",
                background: "#fff",
                color: "#111",
                fontSize: 16,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              19:00残数チェック
            </button>
          </div>
        ) : null}
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

          {trainingStepConfig.showAdvancedReference && referenceText && timeText ? (
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
                    {!trainingStepConfig.showManyProductRate ? (
                      <div style={{ fontWeight: 800 }}>
                        表示値引率 → {item.normalRateText ?? item.rateText}
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 800 }}>
                          多い → {item.manyRateText ?? item.rateText}
                        </div>
                        {trainingStepConfig.showManyThresholdRule && item.manyNote ? (
                          <div style={{ color: "#666", whiteSpace: "pre-line" }}>
                            {item.manyNote}
                          </div>
                        ) : null}
                        <div style={{ fontWeight: 800 }}>
                          {trainingStepConfig.showFewProductRule ? "どちらでもない" : "多くない"} → {item.normalRateText ?? item.rateText}
                        </div>
                      </>
                    )}
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
