import { useState, type CSSProperties, type FormEvent } from "react";
import { ScreenHeader } from "../layout/ScreenHeader";
import type { AreaId, EditableAreaCountItem } from "../../domain/types.ts";
import { AreaCountCorrectionPanel } from "../common/AreaCountCorrectionPanel.tsx";

type AutoSkipCountScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
  initialCount?: number | null;
  onSave: (count: number) => void;
  onGoBack: () => void;
  onReturnHome: () => void;
  editableAreaCounts?: EditableAreaCountItem[];
  onStartAreaCountCorrection?: (areaId: AreaId) => void;
};

const subActionButtonStyle: CSSProperties = {
  minHeight: 44,
  minWidth: 88,
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #ccc",
  background: "#fff",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

function toInitialCountText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : "";
}

function parseCount(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function AutoSkipCountScreen({
  weekdayText,
  timeText,
  areaName,
  initialCount,
  onSave,
  onGoBack,
  onReturnHome,
  editableAreaCounts = [],
  onStartAreaCountCorrection,
}: AutoSkipCountScreenProps) {
  const [countText, setCountText] = useState(() =>
    toInitialCountText(initialCount),
  );

  const parsedCount = parseCount(countText);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (parsedCount === null) return;
    onSave(parsedCount);
  };

  return (
    <main
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: 16,
        maxWidth: 560,
        margin: "0 auto",
        overflowX: "hidden",
      }}
    >
      <ScreenHeader
        weekdayText={weekdayText}
        timeText={timeText}
        areaName={areaName}
        rightAction={
          <button type="button" onClick={onGoBack} style={subActionButtonStyle}>
            戻る
          </button>
        }
      />

      <form onSubmit={handleSubmit}>
        <section
          style={{
            border: "1px solid #ddd",
            borderRadius: 14,
            padding: 18,
            background: "#fff",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              padding: "5px 9px",
              borderRadius: 999,
              background: "#f2f2f2",
              color: "#444",
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            値引時刻：{timeText}
          </div>

          <h2
            style={{
              margin: "14px 0 8px",
              fontSize: 20,
              lineHeight: 1.4,
            }}
          >
            現在の残数だけを記録します
          </h2>
          <p
            style={{
              margin: "0 0 16px",
              color: "#555",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            この画面では、値引判断や追加の値引率計算は行いません。
          </p>

          <label
            htmlFor="auto-skip-area-count"
            style={{
              display: "block",
              marginBottom: 8,
              fontSize: 15,
              fontWeight: 800,
            }}
          >
            このエリアの現在の残数
          </label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <input
              id="auto-skip-area-count"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={countText}
              onChange={(event) => {
                setCountText(event.currentTarget.value.replace(/[^0-9]/g, ""));
              }}
              aria-invalid={countText.length > 0 && parsedCount === null}
              placeholder="0"
              style={{
                width: "100%",
                minWidth: 0,
                boxSizing: "border-box",
                minHeight: 54,
                padding: "10px 12px",
                border: "2px solid #777",
                borderRadius: 12,
                background: "#fff",
                color: "#111",
                fontSize: 24,
                fontWeight: 900,
                textAlign: "right",
              }}
            />
            <span style={{ flexShrink: 0, fontSize: 16, fontWeight: 800 }}>
              個
            </span>
          </div>

          <button
            type="submit"
            disabled={parsedCount === null}
            style={{
              width: "100%",
              minHeight: 52,
              marginTop: 18,
              border: 0,
              borderRadius: 14,
              padding: "12px 16px",
              background: parsedCount === null ? "#ddd" : "#111",
              color: parsedCount === null ? "#777" : "#fff",
              fontSize: 16,
              fontWeight: 900,
              cursor: parsedCount === null ? "not-allowed" : "pointer",
            }}
          >
            残数を保存する
          </button>
        </section>
      </form>

      {onStartAreaCountCorrection ? (
        <AreaCountCorrectionPanel
          items={editableAreaCounts}
          onSelect={onStartAreaCountCorrection}
        />
      ) : null}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={onReturnHome}
          style={{ ...subActionButtonStyle, width: "100%" }}
        >
          トップに戻る
        </button>
      </div>
    </main>
  );
}
