import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AreaId, Review19AreaItem } from "../../domain/types";
import { PrimaryButton } from "../layout/PrimaryButton";

const cardStyle: CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
};

const subActionButtonStyle: CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #ccc",
  background: "#fff",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

function parseCount(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

function getCountText(count?: number): string {
  return typeof count === "number" && Number.isFinite(count) ? String(count) : "";
}

type Review19ScreenProps = {
  items: Review19AreaItem[];
  referenceLines: string[];
  onChangeAreaCount: (areaId: AreaId, count: number) => void;
  onSave: () => void;
  onReturnHome: () => void;
};

export function Review19Screen({
  items,
  referenceLines,
  onChangeAreaCount,
  onSave,
  onReturnHome,
}: Review19ScreenProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeItem = items[activeIndex] ?? null;
  const [countText, setCountText] = useState(() => getCountText(activeItem?.count));
  const parsedCount = parseCount(countText);
  const isLast = activeIndex >= items.length - 1;

  useEffect(() => {
    setCountText(getCountText(activeItem?.count));
  }, [activeItem?.areaId, activeItem?.count]);

  const recordedCount = useMemo(
    () => items.filter((item) => !item.excluded && typeof item.count === "number").length,
    [items],
  );
  const targetCount = useMemo(
    () => items.filter((item) => !item.excluded).length,
    [items],
  );

  const handleDigit = (digit: string) => {
    setCountText((current) => {
      const next = current === "0" ? digit : `${current}${digit}`;
      return next.replace(/^0+(?=\d)/, "");
    });
  };

  const handleBackspace = () => {
    setCountText((current) => current.slice(0, -1));
  };

  const goNext = () => {
    if (!activeItem) return;

    if (!activeItem.excluded) {
      if (parsedCount === null) return;
      onChangeAreaCount(activeItem.areaId, parsedCount);
    }

    if (isLast) {
      window.setTimeout(onSave, 0);
      return;
    }

    setActiveIndex((index) => Math.min(items.length - 1, index + 1));
  };

  if (!activeItem) {
    return (
      <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
        <section style={cardStyle}>
          <div style={{ fontSize: 22, fontWeight: 900 }}>19時残数チェック</div>
          <div style={{ marginTop: 8, fontSize: 14, color: "#555" }}>
            記録対象のエリアがありません。
          </div>
        </section>
        <div style={{ marginTop: 16 }}>
          <PrimaryButton onClick={onReturnHome}>トップに戻る</PrimaryButton>
        </div>
      </main>
    );
  }

  const canProceed = activeItem.excluded || parsedCount !== null;

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <section style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>
          19時残数チェック
        </div>
        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.7 }}>
          17時値引き後、19:00時点で消費期限が今日までの商品が何個残っているかを記録します。
          <br />
          値引判断前のエリア残数とは別データとして扱います。
        </div>
      </section>

      {referenceLines.length > 0 ? (
        <section
          style={{
            ...cardStyle,
            marginTop: 16,
            background: "#fafafa",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>
            19時30分値引の参考基準
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: "#444" }}>
            {referenceLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section style={{ ...cardStyle, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#555" }}>
            {activeIndex + 1} / {items.length}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#555" }}>
            入力済み {recordedCount} / {targetCount}
          </div>
        </div>

        <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 10 }}>
          {activeItem.areaName}
        </div>

        {activeItem.excluded ? (
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background: "#f5f5f5",
              color: "#555",
              fontSize: 14,
              fontWeight: 800,
              lineHeight: 1.7,
              marginBottom: 14,
            }}
          >
            {activeItem.excludeReasonText ?? "対象外"}
            <br />
            このエリアは19時残数チェックをスキップします。
          </div>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>
              19:00時点の残数は？
            </div>
            <div
              aria-live="polite"
              style={{
                width: "100%",
                boxSizing: "border-box",
                minHeight: 52,
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #bbb",
                background: "#fff",
                fontSize: 24,
                fontWeight: 900,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                color: countText ? "#111" : "#999",
                userSelect: "none",
                marginBottom: 10,
              }}
            >
              {countText || "未入力"}
            </div>
            <div
              aria-label="19時残数入力キーパッド"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
                marginBottom: 14,
              }}
            >
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleDigit(digit)}
                  style={{
                    padding: "12px 0",
                    borderRadius: 12,
                    border: "1px solid #ccc",
                    background: "#fff",
                    fontSize: 18,
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleDigit("0")}
                style={{
                  padding: "12px 0",
                  borderRadius: 12,
                  border: "1px solid #ccc",
                  background: "#fff",
                  fontSize: 18,
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                0
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                disabled={!countText}
                style={{
                  padding: "12px 0",
                  borderRadius: 12,
                  border: "1px solid #ccc",
                  background: countText ? "#fff" : "#eee",
                  color: countText ? "#111" : "#999",
                  fontSize: 18,
                  fontWeight: 900,
                  cursor: countText ? "pointer" : "not-allowed",
                }}
                aria-label="1文字削除"
              >
                ⌫
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!canProceed}
                style={{
                  padding: "12px 0",
                  borderRadius: 12,
                  border: canProceed ? "2px solid #2f5ef5" : "1px solid #ccc",
                  background: canProceed ? "#e8f0ff" : "#eee",
                  color: canProceed ? "#111" : "#999",
                  fontSize: 18,
                  fontWeight: 900,
                  cursor: canProceed ? "pointer" : "not-allowed",
                }}
              >
                {isLast ? "記録" : "次へ"}
              </button>
            </div>
          </>
        )}

        {activeItem.excluded ? (
          <PrimaryButton onClick={goNext}>{isLast ? "記録して終了" : "次へ"}</PrimaryButton>
        ) : null}
      </section>

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={onReturnHome} style={subActionButtonStyle}>
          トップに戻る
        </button>
      </div>
    </main>
  );
}
