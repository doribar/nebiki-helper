import { useState, type CSSProperties } from "react";
import { PrimaryButton } from "../layout/PrimaryButton.tsx";
import type { DoneSummaryItem } from "../../domain/types";

type DoneScreenProps = {
  onGoBack: () => void;
  onReturnHome: () => void;
  referenceText?: string;
  timeText?: string;
  summaryItems: DoneSummaryItem[];
  showDailyDataActions?: boolean;
  memo?: string;
  onSaveMemo?: (memo: string | null) => void;
  onExportDailyData?: (memo: string | null) => boolean | Promise<boolean>;
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
  showDailyDataActions = false,
  memo = "",
  onSaveMemo,
  onExportDailyData,
}: DoneScreenProps) {
  const [memoText, setMemoText] = useState(memo);
  const [memoSaved, setMemoSaved] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportDailyData = async () => {
    setExportError(null);
    try {
      const exported = await onExportDailyData?.(
        memoText === "" ? null : memoText,
      );
      if (!exported) {
        setMemoSaved(false);
        setExportError(
          "メモの保存に失敗したため、1日データは出力しませんでした。",
        );
        return;
      }
      setMemoSaved(true);
    } catch {
      setMemoSaved(false);
      setExportError(
        "メモの保存に失敗したため、1日データは出力しませんでした。",
      );
    }
  };

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

      {showDailyDataActions ? (
        <section
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 16,
            marginTop: 16,
            background: "#fff",
          }}
        >
          <label htmlFor="final-day-memo" style={{ display: "block", marginBottom: 8, fontWeight: 900 }}>
            任意メモ
          </label>
          <textarea
            id="final-day-memo"
            value={memoText}
            onChange={(event) => {
              setMemoText(event.currentTarget.value);
              setMemoSaved(false);
              setExportError(null);
            }}
            rows={4}
            style={{
              width: "100%",
              minWidth: 0,
              boxSizing: "border-box",
              resize: "vertical",
              border: "1px solid #bbb",
              borderRadius: 10,
              padding: 10,
              fontSize: 16,
              lineHeight: 1.5,
            }}
          />
          <button
            type="button"
            onClick={() => {
              setExportError(null);
              onSaveMemo?.(memoText === "" ? null : memoText);
              setMemoSaved(true);
            }}
            style={{ ...subActionButtonStyle, width: "100%", marginTop: 10 }}
          >
            メモを保存
          </button>
          {memoSaved ? (
            <div role="status" style={{ marginTop: 8, fontSize: 13, fontWeight: 800 }}>
              メモを保存しました。
            </div>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <PrimaryButton
              onClick={() => void handleExportDailyData()}
              disabled={!onExportDailyData}
            >
              1日データを出力
            </PrimaryButton>
          </div>
          {exportError ? (
            <div
              role="alert"
              style={{ marginTop: 8, color: "#b91c1c", fontSize: 13, fontWeight: 800 }}
            >
              {exportError}
            </div>
          ) : null}
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
