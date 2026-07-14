import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AreaId, Review19AreaItem } from "../../domain/types";
import { PrimaryButton } from "../layout/PrimaryButton";
import { useSwipeToSkip } from "../../hooks/useSwipeToSkip";
import {
  buildCalculatorDraftKey,
  clearCalculatorDraft,
  loadCalculatorDraft,
  saveCalculatorDraft,
} from "../../domain/calculatorDraft";

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

function normalizeAdditionFormula(value: string): string {
  return value
    .replace(/[^0-9+]/g, "")
    .replace(/\+{2,}/g, "+")
    .replace(/^\+/, "");
}

function calculateAdditionResult(value: string): number | null {
  const normalized = normalizeAdditionFormula(value).replace(/\+$/, "");
  if (!normalized) return null;

  const parts = normalized.split("+");
  if (parts.some((part) => part === "")) return null;

  const total = parts.reduce((sum, part) => sum + Number(part), 0);
  if (!Number.isFinite(total) || total < 0) return null;
  return Math.round(total);
}

type Review19ScreenProps = {
  items: Review19AreaItem[];
  calculatorDraftScope: string;
  onChangeAreaCount: (areaId: AreaId, count: number) => void;
  onSave: (latestAreaCount?: { areaId: AreaId; count: number }, latestExcludedAreaId?: AreaId) => void;
  onReturnHome: () => void;
};

export function Review19Screen({
  items,
  calculatorDraftScope,
  onChangeAreaCount,
  onSave,
  onReturnHome,
}: Review19ScreenProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [orderedAreaIds, setOrderedAreaIds] = useState<AreaId[]>(() =>
    items.map((item) => item.areaId),
  );
  const activeAreaId = orderedAreaIds[activeIndex] ?? null;
  const activeItem = activeAreaId
    ? items.find((item) => item.areaId === activeAreaId) ?? null
    : null;
  const [countText, setCountText] = useState(() => getCountText(activeItem?.count));
  const [showCountCalculator, setShowCountCalculator] = useState(true);
  const [countCalculatorText, setCountCalculatorText] = useState("");
  const parsedCount = parseCount(countText);
  const countCalculatorResult = calculateAdditionResult(countCalculatorText);

  useEffect(() => {
    setOrderedAreaIds(items.map((item) => item.areaId));
    setActiveIndex(0);
  }, [items.map((item) => item.areaId).join("|")]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, orderedAreaIds.length - 1)));
  }, [orderedAreaIds.length]);

  useEffect(() => {
    const calculatorDraftKey = activeItem
      ? buildCalculatorDraftKey({
          kind: "review19-count",
          scopeId: calculatorDraftScope,
          areaId: activeItem.areaId,
        })
      : null;
    const calculatorDraft = calculatorDraftKey
      ? loadCalculatorDraft(calculatorDraftKey)
      : null;

    setCountText(getCountText(activeItem?.count));
    setShowCountCalculator(calculatorDraft?.open ?? true);
    setCountCalculatorText(calculatorDraft?.text ?? "");
  }, [activeItem?.areaId, activeItem?.count, calculatorDraftScope]);

  const recordedCount = useMemo(
    () => items.filter((item) => !item.excluded && typeof item.count === "number").length,
    [items],
  );
  const targetCount = useMemo(
    () => items.filter((item) => !item.excluded).length,
    [items],
  );

  const hasAllCountsAfter = (latestAreaCount?: { areaId: AreaId; count: number }) => {
    return items
      .filter((item) => !item.excluded)
      .every((item) => {
        if (latestAreaCount?.areaId === item.areaId) return true;
        return typeof item.count === "number";
      });
  };

  const moveToNextArea = () => {
    setActiveIndex((index) => Math.min(orderedAreaIds.length - 1, index + 1));
  };

  const handleDigit = (digit: string) => {
    setCountText((current) => {
      const next = current === "0" ? digit : `${current}${digit}`;
      return next.replace(/^0+(?=\d)/, "");
    });
  };

  const handleBackspace = () => {
    setCountText((current) => current.slice(0, -1));
  };

  const openCountCalculator = () => {
    setCountCalculatorText(countText);
    setShowCountCalculator(true);
  };

  const handleCountCalculatorDigit = (digit: string) => {
    setCountCalculatorText((current) => {
      const next = normalizeAdditionFormula(`${current}${digit}`);
      return next.replace(/(^|\+)0+(?=\d)/g, "$1");
    });
  };

  const handleCountCalculatorPlus = () => {
    setCountCalculatorText((current) => {
      const normalized = normalizeAdditionFormula(current);
      if (!normalized || normalized.endsWith("+")) return normalized;
      return `${normalized}+`;
    });
  };

  const handleCountCalculatorBackspace = () => {
    setCountCalculatorText((current) => current.slice(0, -1));
  };

  const getCountCalculatorDraftKey = (areaId: AreaId) =>
    buildCalculatorDraftKey({
      kind: "review19-count",
      scopeId: calculatorDraftScope,
      areaId,
    });

  const clearCountCalculatorDraft = (areaId: AreaId) => {
    clearCalculatorDraft(getCountCalculatorDraftKey(areaId));
  };

  const saveCountCalculatorDraft = (areaId: AreaId) => {
    if (showCountCalculator && countCalculatorText) {
      saveCalculatorDraft(getCountCalculatorDraftKey(areaId), {
        text: countCalculatorText,
        open: true,
      });
      return;
    }

    clearCountCalculatorDraft(areaId);
  };

  const completeCountCalculator = () => {
    if (countCalculatorResult !== null) {
      setCountText(String(countCalculatorResult));
    }
    if (activeItem) {
      clearCountCalculatorDraft(activeItem.areaId);
    }
    setShowCountCalculator(false);
  };

  const goSkip = () => {
    if (!activeItem || activeItem.excluded) return;
    if (orderedAreaIds.length <= 1) return;

    saveCountCalculatorDraft(activeItem.areaId);

    setOrderedAreaIds((current) => {
      const index = current.indexOf(activeItem.areaId);
      if (index < 0) return current;
      const next = current.filter((areaId) => areaId !== activeItem.areaId);
      next.push(activeItem.areaId);
      return next;
    });
    setActiveIndex((index) => Math.min(index, orderedAreaIds.length - 2));
  };

  const goNext = () => {
    if (!activeItem) return;

    const latestAreaCount =
      !activeItem.excluded && parsedCount !== null
        ? { areaId: activeItem.areaId, count: parsedCount }
        : undefined;

    if (!activeItem.excluded) {
      if (parsedCount === null) return;
      clearCountCalculatorDraft(activeItem.areaId);
      onChangeAreaCount(activeItem.areaId, parsedCount);
    }

    if (hasAllCountsAfter(latestAreaCount)) {
      window.setTimeout(() => onSave(latestAreaCount), 0);
      return;
    }

    moveToNextArea();
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
  const latestAreaCount =
    activeItem && !activeItem.excluded && parsedCount !== null
      ? { areaId: activeItem.areaId, count: parsedCount }
      : undefined;
  const willComplete = hasAllCountsAfter(latestAreaCount);
  const swipeToSkipHandlers = useSwipeToSkip({
    onSwipeLeft: goSkip,
    enabled: Boolean(activeItem && !activeItem.excluded && orderedAreaIds.length > 1),
  });

  return (
    <main {...swipeToSkipHandlers} style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <section style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>
          19時残数チェック
        </div>
        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.7 }}>
          17時値引き後、19:00時点で消費期限が今日までの商品が何個残っているかを記録します。
        </div>
      </section>

      <section style={{ ...cardStyle, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#555" }}>
            {activeIndex + 1} / {items.length}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#555" }}>
            入力済み {recordedCount} / {targetCount}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 900, flex: 1 }}>
            {activeItem.areaName}
          </div>
          {!activeItem.excluded ? (
            <button
              type="button"
              onClick={openCountCalculator}
              style={{
                ...subActionButtonStyle,
                width: "auto",
                minWidth: 72,
                padding: "8px 10px",
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              電卓
            </button>
          ) : null}
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
            {showCountCalculator ? (
              <section
                style={{
                  border: "1px solid #d6d6d6",
                  borderRadius: 12,
                  padding: 12,
                  background: "#fafafa",
                  marginBottom: 12,
                }}
              >
                <div
                  aria-live="polite"
                  style={{
                    minHeight: 44,
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #bbb",
                    background: "#fff",
                    fontSize: 20,
                    fontWeight: 900,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    color: countCalculatorText ? "#111" : "#999",
                    overflowWrap: "anywhere",
                    textAlign: "right",
                  }}
                >
                  {countCalculatorText || "0"}
                </div>
                <div style={{ marginTop: 6, fontSize: 14, fontWeight: 800, textAlign: "right", color: "#333" }}>
                  合計：{countCalculatorResult ?? 0}
                </div>
                <div
                  aria-label="19時残数用電卓キーパッド"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => handleCountCalculatorDigit(digit)}
                      style={{
                        padding: "10px 0",
                        borderRadius: 10,
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
                    onClick={() => handleCountCalculatorDigit("0")}
                    style={{
                      padding: "10px 0",
                      borderRadius: 10,
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
                    onClick={handleCountCalculatorPlus}
                    disabled={!countCalculatorText || countCalculatorText.endsWith("+")}
                    style={{
                      padding: "10px 0",
                      borderRadius: 10,
                      border: "1px solid #ccc",
                      background: countCalculatorText && !countCalculatorText.endsWith("+") ? "#fff" : "#eee",
                      color: countCalculatorText && !countCalculatorText.endsWith("+") ? "#111" : "#999",
                      fontSize: 18,
                      fontWeight: 900,
                      cursor: countCalculatorText && !countCalculatorText.endsWith("+") ? "pointer" : "not-allowed",
                    }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={handleCountCalculatorBackspace}
                    disabled={!countCalculatorText}
                    style={{
                      padding: "10px 0",
                      borderRadius: 10,
                      border: "1px solid #ccc",
                      background: countCalculatorText ? "#fff" : "#eee",
                      color: countCalculatorText ? "#111" : "#999",
                      fontSize: 18,
                      fontWeight: 900,
                      cursor: countCalculatorText ? "pointer" : "not-allowed",
                    }}
                    aria-label="電卓を1文字削除"
                  >
                    ⌫
                  </button>
                </div>
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={completeCountCalculator}
                    disabled={countCalculatorResult === null}
                    style={{
                      ...subActionButtonStyle,
                      width: "100%",
                      border: countCalculatorResult !== null ? "2px solid #2f5ef5" : "1px solid #ccc",
                      background: countCalculatorResult !== null ? "#e8f0ff" : "#eee",
                      color: countCalculatorResult !== null ? "#111" : "#999",
                      cursor: countCalculatorResult !== null ? "pointer" : "not-allowed",
                    }}
                  >
                    完了
                  </button>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: "#555", lineHeight: 1.6 }}>
                  「完了」を押すと、合計を残数入力に入れます。
                </div>
              </section>
            ) : null}
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
                {willComplete ? "記録" : "次へ"}
              </button>
            </div>
            <button
              type="button"
              onClick={goSkip}
              style={{
                ...subActionButtonStyle,
                borderColor: "#ddd",
                color: "#666",
                marginTop: 4,
              }}
            >
              今はスキップ（画面左スワイプ）
            </button>
          </>
        )}

        {activeItem.excluded ? (
          <PrimaryButton onClick={goNext}>{willComplete ? "記録して終了" : "次へ"}</PrimaryButton>
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
