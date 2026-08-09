import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  AreaCountEvaluation,
  HumanEvaluationDetails,
  HumanEvaluationSelection,
} from "../../domain/types.ts";
import {
  createHumanEvaluationSelection,
  getHumanEvaluationSecondChoices,
  HUMAN_EVALUATION_LONG_PRESS_MS,
} from "../../domain/humanEvaluation.ts";
import { evaluationText } from "../../domain/areaCountHistory.ts";

const POINTER_MOVE_CANCEL_PX = 12;
const CLICK_SUPPRESSION_TIMEOUT_MS = 1000;

type ActivePointer = {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
};

const DISPLAY_OPTIONS: Array<{
  value: AreaCountEvaluation;
  color: string;
  selectedBackground: string;
  subLabel?: string;
}> = [
  { value: "many", color: "#b71c1c", selectedBackground: "#ffebee", subLabel: "+10%" },
  { value: "slightly_many", color: "#b71c1c", selectedBackground: "#ffebee", subLabel: "+5%" },
  { value: "normal", color: "#1b5e20", selectedBackground: "#e8f5e9", subLabel: "±0%" },
  { value: "slightly_few", color: "#0d47a1", selectedBackground: "#e3f2fd", subLabel: "-5%" },
  { value: "few", color: "#0d47a1", selectedBackground: "#e3f2fd", subLabel: "-10%" },
];

function getLabelLines(evaluation: AreaCountEvaluation): string[] {
  const label = evaluationText(evaluation);
  return label.startsWith("やや") ? ["やや", label.slice(2)] : [label];
}

export function HumanEvaluationSelector({
  ariaLabel,
  disabled = false,
  layout,
  resetKey,
  value,
  showRateAdjustments = false,
  onLongPressActivated,
  onCommit,
}: {
  ariaLabel: string;
  disabled?: boolean;
  layout: "stacked" | "compact";
  resetKey?: string;
  value?: HumanEvaluationDetails | null;
  showRateAdjustments?: boolean;
  onLongPressActivated?: () => void;
  onCommit: (selection: HumanEvaluationSelection) => void;
}) {
  const effectiveResetKey = resetKey ?? ariaLabel;
  const [intermediateSelection, setIntermediateSelection] = useState<{
    resetKey: string;
    value: AreaCountEvaluation | null;
  }>(() => ({ resetKey: effectiveResetKey, value: null }));
  if (intermediateSelection.resetKey !== effectiveResetKey) {
    // 同じresetKeyへ後で戻っても、以前の中間選択を復活させない。
    setIntermediateSelection({ resetKey: effectiveResetKey, value: null });
  }
  const firstSelection =
    intermediateSelection.resetKey === effectiveResetKey
      ? intermediateSelection.value
      : null;
  const timerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<ActivePointer | null>(null);
  const pointerCaptureTargetRef = useRef<HTMLButtonElement | null>(null);
  const longPressActivatedRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const suppressionCleanupRef = useRef<number | null>(null);

  const clearLongPressTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearSuppressionCleanup = useCallback(() => {
    if (suppressionCleanupRef.current !== null) {
      window.clearTimeout(suppressionCleanupRef.current);
      suppressionCleanupRef.current = null;
    }
  }, []);

  const clearClickSuppression = useCallback(() => {
    clearSuppressionCleanup();
    suppressNextClickRef.current = false;
  }, [clearSuppressionCleanup]);

  const scheduleClickSuppressionCleanup = useCallback(() => {
    clearSuppressionCleanup();
    suppressionCleanupRef.current = window.setTimeout(() => {
      suppressionCleanupRef.current = null;
      suppressNextClickRef.current = false;
    }, CLICK_SUPPRESSION_TIMEOUT_MS);
  }, [clearSuppressionCleanup]);

  const releasePointerCapture = useCallback((pointerId: number | null) => {
    const target = pointerCaptureTargetRef.current;
    pointerCaptureTargetRef.current = null;
    if (!target || pointerId === null) return;

    try {
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // 画面遷移・DOM差し替え後にcaptureが既に解放済みでもcleanupを継続する。
    }
  }, []);

  const clearPendingPress = useCallback(() => {
    clearLongPressTimer();
    const pointerId = pointerStartRef.current?.pointerId ?? null;
    pointerStartRef.current = null;
    longPressActivatedRef.current = false;
    releasePointerCapture(pointerId);
  }, [clearLongPressTimer, releasePointerCapture]);

  const cancelActivePointer = useCallback(() => {
    const hadActivePointer = pointerStartRef.current !== null;
    clearPendingPress();
    if (!hadActivePointer) return;

    suppressNextClickRef.current = true;
    scheduleClickSuppressionCleanup();
  }, [clearPendingPress, scheduleClickSuppressionCleanup]);

  const cancelIntermediateSelection = useCallback(() => {
    clearPendingPress();
    clearClickSuppression();
    setIntermediateSelection({ resetKey: effectiveResetKey, value: null });
  }, [clearClickSuppression, clearPendingPress, effectiveResetKey]);

  useEffect(
    () => () => {
      clearPendingPress();
      clearSuppressionCleanup();
    },
    [clearPendingPress, clearSuppressionCleanup],
  );
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelActivePointer();
    };
    window.addEventListener("blur", cancelActivePointer);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", cancelActivePointer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [cancelActivePointer]);
  useEffect(() => {
    if (disabled) cancelActivePointer();
  }, [cancelActivePointer, disabled]);
  useEffect(() => {
    // resetKey変更時は描画上ただちにidle扱いにし、外部gesture資源だけを後始末する。
    clearPendingPress();
    clearClickSuppression();
  }, [clearClickSuppression, clearPendingPress, effectiveResetKey]);

  const commit = (first: AreaCountEvaluation, second?: AreaCountEvaluation) => {
    const selection = createHumanEvaluationSelection(first, second);
    if (!selection) return;
    cancelIntermediateSelection();
    onCommit(selection);
  };

  const handlePointerDown = (
    evaluation: AreaCountEvaluation,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    if (!event.isPrimary) {
      cancelActivePointer();
      return;
    }

    // 新しいpointer gestureは、直前のlong-press用one-shot抑止より常に優先する。
    clearClickSuppression();
    if (disabled || firstSelection !== null) return;

    clearPendingPress();
    longPressActivatedRef.current = false;
    pointerStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    pointerCaptureTargetRef.current = event.currentTarget;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture非対応・既に無効なpointerでもtimer/cancel経路は維持する。
    }
    const pointerId = event.pointerId;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const activePointer = pointerStartRef.current;
      if (
        !activePointer ||
        activePointer.pointerId !== pointerId ||
        activePointer.moved
      ) {
        return;
      }
      longPressActivatedRef.current = true;
      suppressNextClickRef.current = true;
      onLongPressActivated?.();
      setIntermediateSelection({
        resetKey: effectiveResetKey,
        value: evaluation,
      });
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try {
          navigator.vibrate(15);
        } catch {
          // 振動非対応・拒否端末でも視覚フィードバックだけで継続する。
        }
      }
    }, HUMAN_EVALUATION_LONG_PRESS_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointerStartRef.current;
    if (
      !start ||
      start.pointerId !== event.pointerId ||
      start.moved ||
      longPressActivatedRef.current
    ) {
      return;
    }
    if (
      Math.abs(event.clientX - start.x) > POINTER_MOVE_CANCEL_PX ||
      Math.abs(event.clientY - start.y) > POINTER_MOVE_CANCEL_PX
    ) {
      clearLongPressTimer();
      start.moved = true;
      suppressNextClickRef.current = true;
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const activePointer = pointerStartRef.current;
    if (!activePointer || activePointer.pointerId !== event.pointerId) return;

    const shouldSuppressClick =
      longPressActivatedRef.current ||
      activePointer.moved ||
      suppressNextClickRef.current;
    clearLongPressTimer();
    pointerStartRef.current = null;
    longPressActivatedRef.current = false;
    if (shouldSuppressClick) {
      suppressNextClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      scheduleClickSuppressionCleanup();
    }
    releasePointerCapture(event.pointerId);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerStartRef.current?.pointerId !== event.pointerId) return;
    // 500ms成立済みの中間モードは維持し、pointer gestureだけを終了する。
    cancelActivePointer();
  };

  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerStartRef.current?.pointerId === event.pointerId) {
      cancelActivePointer();
    }
  };

  const handleClick = (evaluation: AreaCountEvaluation) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (disabled) return;
    if (firstSelection === null) {
      commit(evaluation);
      return;
    }
    if (!getHumanEvaluationSecondChoices(firstSelection).includes(evaluation)) return;
    commit(firstSelection, evaluation);
  };

  const allowedSecondChoices = firstSelection
    ? new Set(getHumanEvaluationSecondChoices(firstSelection))
    : null;
  const committedSelections = new Set(value?.humanEvaluationSelections ?? []);
  const isCompact = layout === "compact";
  const containerStyle: CSSProperties = isCompact
    ? {
        display: "grid",
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        gap: 4,
        marginTop: 8,
        minWidth: 0,
      }
    : { display: "grid", gap: 10 };

  return (
    <div>
      <div
        aria-label={ariaLabel}
        data-human-evaluation-selector="true"
        data-intermediate-selection={firstSelection ?? ""}
        style={containerStyle}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDownCapture={(event) => {
          if (event.button === 0 && event.isPrimary) clearClickSuppression();
        }}
        onClickCapture={(event) => {
          if (!suppressNextClickRef.current) return;
          if (event.detail === 0) {
            // Enter/Space/programmatic clickはpointer由来のghost clickではない。
            clearClickSuppression();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          clearClickSuppression();
        }}
      >
        {DISPLAY_OPTIONS.map((option) => {
          const selected =
            option.value === firstSelection || committedSelections.has(option.value);
          const invalidSecond =
            allowedSecondChoices !== null && !allowedSecondChoices.has(option.value);
          const optionDisabled = disabled || invalidSecond;
          const labelLines = getLabelLines(option.value);
          return (
            <button
              key={option.value}
              type="button"
              disabled={optionDisabled}
              aria-pressed={selected}
              aria-label={evaluationText(option.value)}
              data-evaluation={option.value}
              data-long-press-first={option.value === firstSelection ? "true" : "false"}
              onPointerDown={(event) => handlePointerDown(option.value, event)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onLostPointerCapture={handleLostPointerCapture}
              onClick={() => handleClick(option.value)}
              style={{
                minWidth: 0,
                minHeight: isCompact ? 52 : 50,
                width: "100%",
                padding: isCompact ? "5px 1px" : "12px 16px",
                borderRadius: 10,
                border:
                  option.value === firstSelection
                    ? "3px solid #7c3aed"
                    : selected
                      ? "2px solid #2f5ef5"
                      : "1px solid #ccc",
                background: selected
                  ? option.selectedBackground
                  : optionDisabled
                    ? "#eee"
                    : "#fff",
                color: optionDisabled ? "#999" : option.color,
                fontSize: isCompact ? 12 : 16,
                fontWeight: 900,
                lineHeight: 1.15,
                textAlign: isCompact ? "center" : "left",
                cursor: optionDisabled ? "not-allowed" : "pointer",
                touchAction: "manipulation",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTouchCallout: "none",
                opacity: invalidSecond ? 0.45 : 1,
              }}
            >
              {isCompact ? (
                labelLines.map((line, index) => (
                  <span key={line}>
                    {index > 0 ? <br /> : null}
                    {line}
                  </span>
                ))
              ) : (
                <>
                  {evaluationText(option.value)}
                  {showRateAdjustments && option.subLabel ? (
                    <span style={{ marginLeft: 6, color: "#555", fontSize: 13 }}>
                      ({option.subLabel})
                    </span>
                  ) : null}
                </>
              )}
            </button>
          );
        })}
      </div>

      {firstSelection ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 9,
            border: "1px solid #c4b5fd",
            background: "#f5f3ff",
            color: "#4c1d95",
            fontSize: 13,
            fontWeight: 800,
            lineHeight: 1.5,
          }}
        >
          隣の項目を選ぶと中間評価。同じ項目でもう一度選ぶと単独評価です。
          <button
            type="button"
            onClick={cancelIntermediateSelection}
            style={{
              display: "block",
              marginTop: 5,
              padding: 0,
              border: 0,
              background: "transparent",
              color: "#4c1d95",
              fontSize: 13,
              fontWeight: 900,
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            中間選択をやめる
          </button>
        </div>
      ) : null}
    </div>
  );
}
