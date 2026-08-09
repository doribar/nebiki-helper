import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  AreaId,
  HumanEvaluationDetails,
  HumanEvaluationSelection,
  Review19AreaItem,
} from "../../domain/types";
import { PrimaryButton } from "../layout/PrimaryButton";
import { HumanEvaluationSelector } from "../common/HumanEvaluationSelector";
import { useSwipeToSkip } from "../../hooks/useSwipeToSkip";
import {
  buildCalculatorDraftKey,
  clearCalculatorDraft,
  loadCalculatorDraft,
  saveCalculatorDraft,
} from "../../domain/calculatorDraft";
import { resolveHumanEvaluationDetails } from "../../domain/humanEvaluation.ts";

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

function getCountText(count?: number): string {
  return typeof count === "number" && Number.isFinite(count)
    ? String(count)
    : "";
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

function getItemHumanEvaluationDetails(
  item?: Review19AreaItem | null,
): HumanEvaluationDetails | null {
  if (!item) return null;
  return (
    resolveHumanEvaluationDetails(
      item.humanEvaluationDetails,
      item.humanEvaluation,
    ) ?? null
  );
}

function createDisplayHumanEvaluationDetails(
  selection: HumanEvaluationSelection,
): HumanEvaluationDetails {
  return {
    ...selection,
    humanEvaluationScale: 9,
    resolutionDirection: "not_applicable",
    resolutionReason: "review19_observation",
  };
}

function getHumanEvaluationSelection(
  details: HumanEvaluationDetails,
): HumanEvaluationSelection {
  const [first, second] = details.humanEvaluationSelections;
  return {
    humanEvaluationScore9: details.humanEvaluationScore9,
    humanEvaluationSelections:
      second === undefined ? [first] : [first, second],
  };
}

type Review19ScreenProps = {
  items: Review19AreaItem[];
  calculatorDraftScope: string;
  onCompleteArea: (
    areaId: AreaId,
    count: number,
    humanEvaluationSelection: HumanEvaluationSelection,
  ) => void;
  onSave: (
    latestObservation?: {
      areaId: AreaId;
      count: number;
      humanEvaluationSelection: HumanEvaluationSelection;
    },
    latestExcludedAreaId?: AreaId,
  ) => void;
  onGoBack: () => void;
  onReturnHome: () => void;
};

export function Review19Screen({
  items,
  calculatorDraftScope,
  onCompleteArea,
  onSave,
  onGoBack,
  onReturnHome,
}: Review19ScreenProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [showCountCorrectionPicker, setShowCountCorrectionPicker] =
    useState(false);
  const [countCorrectionReturnAreaId, setCountCorrectionReturnAreaId] =
    useState<AreaId | null>(null);
  const [orderedAreaIds, setOrderedAreaIds] = useState<AreaId[]>(() =>
    items.map((item) => item.areaId),
  );
  const activeAreaId = orderedAreaIds[activeIndex] ?? null;
  const activeItem = activeAreaId
    ? (items.find((item) => item.areaId === activeAreaId) ?? null)
    : null;
  const [countCalculatorText, setCountCalculatorText] = useState(() =>
    getCountText(activeItem?.count),
  );
  const activeHumanEvaluationKey = activeItem
    ? `${calculatorDraftScope}:${activeItem.areaId}`
    : null;
  const [humanEvaluationDraft, setHumanEvaluationDraft] = useState<{
    key: string;
    details: HumanEvaluationDetails;
  } | null>(null);
  const humanEvaluationDetails =
    humanEvaluationDraft?.key === activeHumanEvaluationKey
      ? humanEvaluationDraft.details
      : getItemHumanEvaluationDetails(activeItem);
  const countCalculatorResult = calculateAdditionResult(countCalculatorText);

  useEffect(() => {
    setOrderedAreaIds(items.map((item) => item.areaId));
    setActiveIndex(0);
  }, [items.map((item) => item.areaId).join("|")]);

  useEffect(() => {
    setActiveIndex((index) =>
      Math.min(index, Math.max(0, orderedAreaIds.length - 1)),
    );
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

    setCountCalculatorText(
      calculatorDraft?.text ?? getCountText(activeItem?.count),
    );
  }, [activeItem?.areaId, activeItem?.count, calculatorDraftScope]);

  const recordedCount = useMemo(
    () =>
      items.filter(
        (item) =>
          !item.excluded &&
          typeof item.count === "number" &&
          getItemHumanEvaluationDetails(item) !== null,
      ).length,
    [items],
  );
  const targetCount = useMemo(
    () => items.filter((item) => !item.excluded).length,
    [items],
  );
  const recordedItems = useMemo(
    () =>
      items.filter(
        (item) =>
          typeof item.count === "number" && Number.isFinite(item.count),
      ),
    [items],
  );

  const hasAllObservationsAfter = (latestObservation?: {
    areaId: AreaId;
    count: number;
    humanEvaluationSelection: HumanEvaluationSelection;
  }) => {
    return items
      .filter((item) => !item.excluded)
      .every((item) => {
        if (latestObservation?.areaId === item.areaId) return true;
        return (
          typeof item.count === "number" &&
          getItemHumanEvaluationDetails(item) !== null
        );
      });
  };

  const moveToNextArea = () => {
    setActiveIndex((index) => Math.min(orderedAreaIds.length - 1, index + 1));
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
    if (countCalculatorText) {
      saveCalculatorDraft(getCountCalculatorDraftKey(areaId), {
        text: countCalculatorText,
        open: true,
      });
      return;
    }

    clearCountCalculatorDraft(areaId);
  };

  const handleGoBack = () => {
    if (activeItem) {
      saveCountCalculatorDraft(activeItem.areaId);
    }
    setShowCountCorrectionPicker(false);

    if (activeIndex > 0) {
      setCountCorrectionReturnAreaId(null);
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }

    onGoBack();
  };

  const startCountCorrection = (areaId: AreaId) => {
    if (activeItem) {
      saveCountCalculatorDraft(activeItem.areaId);
    }

    const targetIndex = orderedAreaIds.indexOf(areaId);
    if (targetIndex < 0) return;

    setCountCorrectionReturnAreaId(
      areaId === activeAreaId ? null : activeAreaId,
    );
    setShowCountCorrectionPicker(false);
    setActiveIndex(targetIndex);
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

  const completeCountEntry = () => {
    if (
      !activeItem ||
      activeItem.excluded ||
      countCalculatorResult === null ||
      humanEvaluationDetails === null
    ) {
      return;
    }

    const humanEvaluationSelection = getHumanEvaluationSelection(
      humanEvaluationDetails,
    );

    const latestObservation = {
      areaId: activeItem.areaId,
      count: countCalculatorResult,
      humanEvaluationSelection,
    };

    clearCountCalculatorDraft(activeItem.areaId);
    onCompleteArea(
      activeItem.areaId,
      countCalculatorResult,
      humanEvaluationSelection,
    );

    if (hasAllObservationsAfter(latestObservation)) {
      setCountCorrectionReturnAreaId(null);
      window.setTimeout(() => onSave(latestObservation), 0);
      return;
    }

    if (countCorrectionReturnAreaId) {
      const returnIndex = orderedAreaIds.indexOf(countCorrectionReturnAreaId);
      setCountCorrectionReturnAreaId(null);
      if (returnIndex >= 0) {
        setActiveIndex(returnIndex);
        return;
      }
    }

    moveToNextArea();
  };

  const goNextExcludedArea = () => {
    if (!activeItem || !activeItem.excluded) return;

    if (hasAllObservationsAfter()) {
      window.setTimeout(() => onSave(), 0);
      return;
    }

    moveToNextArea();
  };

  const { cancelSwipeGesture, ...swipeToSkipHandlers } = useSwipeToSkip({
    onSwipeLeft: goSkip,
    enabled: Boolean(
      activeItem && !activeItem.excluded && orderedAreaIds.length > 1,
    ),
  });

  if (!activeItem) {
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
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 12,
          }}
        >
          <button
            type="button"
            onClick={handleGoBack}
            style={{ ...subActionButtonStyle, width: "auto" }}
          >
            戻る
          </button>
        </div>
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

  const willCompleteExcluded =
    activeItem.excluded && hasAllObservationsAfter();

  return (
    <main
      {...swipeToSkipHandlers}
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: 16,
        maxWidth: 560,
        margin: "0 auto",
        overflowX: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 12,
        }}
      >
        <button
          type="button"
          onClick={handleGoBack}
          style={{ ...subActionButtonStyle, width: "auto" }}
        >
          戻る
        </button>
      </div>

      <section style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>
          19時残数チェック
        </div>
        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.7 }}>
          17時値引き後、19:00時点で消費期限が今日までの商品が何個残っているかを記録します。
        </div>
      </section>

      <section style={{ ...cardStyle, marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
          }}
        >
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
              <div
                style={{
                  marginTop: 6,
                  fontSize: 14,
                  fontWeight: 800,
                  textAlign: "right",
                  color: "#333",
                }}
              >
                合計：{countCalculatorResult ?? 0}
              </div>
              <div
                aria-label="19時残数入力・足し算電卓キーパッド"
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
                  onClick={() => handleCountCalculatorDigit("0")}
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
                  onClick={handleCountCalculatorPlus}
                  disabled={
                    !countCalculatorText || countCalculatorText.endsWith("+")
                  }
                  style={{
                    padding: "12px 0",
                    borderRadius: 12,
                    border: "1px solid #ccc",
                    background:
                      countCalculatorText && !countCalculatorText.endsWith("+")
                        ? "#fff"
                        : "#eee",
                    color:
                      countCalculatorText && !countCalculatorText.endsWith("+")
                        ? "#111"
                        : "#999",
                    fontSize: 18,
                    fontWeight: 900,
                    cursor:
                      countCalculatorText && !countCalculatorText.endsWith("+")
                        ? "pointer"
                        : "not-allowed",
                  }}
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={handleCountCalculatorBackspace}
                  disabled={!countCalculatorText}
                  style={{
                    padding: "12px 0",
                    borderRadius: 12,
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

              <div
                style={{
                  marginTop: 12,
                  fontSize: 14,
                  fontWeight: 900,
                  color: "#333",
                }}
              >
                売場を見た残数評価
              </div>
              <HumanEvaluationSelector
                ariaLabel="人間目線の9段階残数評価"
                disabled={countCalculatorResult === null}
                layout="compact"
                resetKey={activeHumanEvaluationKey ?? activeItem.areaId}
                value={humanEvaluationDetails}
                onLongPressActivated={cancelSwipeGesture}
                onCommit={(selection) => {
                  if (!activeHumanEvaluationKey) return;
                  setHumanEvaluationDraft({
                    key: activeHumanEvaluationKey,
                    details: createDisplayHumanEvaluationDetails(selection),
                  });
                }}
              />
              <button
                type="button"
                onClick={completeCountEntry}
                disabled={
                  countCalculatorResult === null ||
                  humanEvaluationDetails === null
                }
                style={{
                  ...subActionButtonStyle,
                  width: "100%",
                  marginTop: 10,
                  border:
                    countCalculatorResult !== null &&
                    humanEvaluationDetails !== null
                      ? "2px solid #2f5ef5"
                      : "1px solid #ccc",
                  background:
                    countCalculatorResult !== null &&
                    humanEvaluationDetails !== null
                      ? "#e8f0ff"
                      : "#eee",
                  color:
                    countCalculatorResult !== null &&
                    humanEvaluationDetails !== null
                      ? "#111"
                      : "#999",
                  cursor:
                    countCalculatorResult !== null &&
                    humanEvaluationDetails !== null
                      ? "pointer"
                      : "not-allowed",
                }}
              >
                完了
              </button>
            </section>
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
          <PrimaryButton onClick={goNextExcludedArea}>
            {willCompleteExcluded ? "記録して終了" : "次へ"}
          </PrimaryButton>
        ) : null}
      </section>

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={onReturnHome}
          style={subActionButtonStyle}
        >
          トップに戻る
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          onClick={() =>
            setShowCountCorrectionPicker((current) => !current)
          }
          aria-expanded={showCountCorrectionPicker}
          style={subActionButtonStyle}
        >
          入力した残数を修正
        </button>

        {showCountCorrectionPicker ? (
          <section
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginTop: 10,
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 12,
              background: "#fafafa",
              overflowX: "hidden",
            }}
          >
            {recordedItems.length > 0 ? (
              <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                {recordedItems.map((item) => (
                  <button
                    key={item.areaId}
                    type="button"
                    onClick={() => startCountCorrection(item.areaId)}
                    style={{
                      ...subActionButtonStyle,
                      minWidth: 0,
                      textAlign: "left",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {item.areaName}（{item.count}個）
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ color: "#666", fontSize: 14, lineHeight: 1.6 }}>
                入力済みのエリアはありません。
              </div>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
