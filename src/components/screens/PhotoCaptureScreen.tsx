import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import type { AreaId, PhotoCaptureSlotView } from "../../domain/types";
import { createPhotoObjectPreviewUrl } from "../../domain/photoJudge";
import { ScreenHeader } from "../layout/ScreenHeader";
import { PrimaryButton } from "../layout/PrimaryButton";

type PhotoCaptureScreenProps = {
  weekdayText: string;
  timeText: string;
  slots: PhotoCaptureSlotView[];
  completedCount: number;
  totalCount: number;
  photoJudgeBaseUrl: string;
  onChangePhotoJudgeBaseUrl: (url: string) => void;
  onCapturePhoto: (areaId: AreaId, slotId: string, file: File, previewUrl?: string) => void;
  onStartWithPhotos: () => void;
  onStartWithoutPhotos: () => void;
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

function groupSlots(slots: PhotoCaptureSlotView[]) {
  const groups: Array<{ areaId: AreaId; areaName: string; slots: PhotoCaptureSlotView[] }> = [];
  for (const slot of slots) {
    const current = groups[groups.length - 1];
    if (current?.areaId === slot.areaId) {
      current.slots.push(slot);
    } else {
      groups.push({ areaId: slot.areaId, areaName: slot.areaName, slots: [slot] });
    }
  }
  return groups;
}

export function PhotoCaptureScreen({
  weekdayText,
  timeText,
  slots,
  completedCount,
  totalCount,
  photoJudgeBaseUrl,
  onChangePhotoJudgeBaseUrl,
  onCapturePhoto,
  onStartWithPhotos,
  onStartWithoutPhotos,
  onGoBack,
}: PhotoCaptureScreenProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeSlotRef = useRef<PhotoCaptureSlotView | null>(null);
  const slotButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [activeSlot, setActiveSlot] = useState<PhotoCaptureSlotView | null>(null);
  const [processingSlotKey, setProcessingSlotKey] = useState<string | null>(null);
  const [focusAfterCaptureKey, setFocusAfterCaptureKey] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [failedPreviewKeys, setFailedPreviewKeys] = useState<Record<string, true>>({});
  const allCaptured = completedCount === totalCount;

  useEffect(() => {
    if (!focusAfterCaptureKey || processingSlotKey) return;

    const capturedIndex = slots.findIndex(
      (slot) => `${slot.areaId}:${slot.slotId}` === focusAfterCaptureKey
    );
    if (capturedIndex < 0) {
      setFocusAfterCaptureKey(null);
      return;
    }

    const nextSlot = slots.slice(capturedIndex + 1).find((slot) => !slot.captured);
    if (!nextSlot) {
      setFocusAfterCaptureKey(null);
      return;
    }

    const nextKey = `${nextSlot.areaId}:${nextSlot.slotId}`;
    window.setTimeout(() => {
      slotButtonRefs.current[nextKey]?.focus();
      slotButtonRefs.current[nextKey]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 0);
    setFocusAfterCaptureKey(null);
  }, [focusAfterCaptureKey, processingSlotKey, slots]);

  function openCamera(slot: PhotoCaptureSlotView) {
    setCaptureError(null);
    activeSlotRef.current = slot;
    setActiveSlot(slot);
    inputRef.current?.click();
  }

  async function handlePhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const slot = activeSlotRef.current ?? activeSlot;
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) {
      activeSlotRef.current = null;
      setActiveSlot(null);
      return;
    }
    if (!slot) {
      setCaptureError("撮影枠の取得に失敗しました。もう一度撮影してください。");
      return;
    }

    const key = `${slot.areaId}:${slot.slotId}`;
    setProcessingSlotKey(key);
    setCaptureError(null);
    try {
      const previewUrl = createPhotoObjectPreviewUrl(file);
      setFailedPreviewKeys((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
      onCapturePhoto(slot.areaId, slot.slotId, file, previewUrl);
      setFocusAfterCaptureKey(key);
      activeSlotRef.current = null;
      setActiveSlot(null);
    } catch (error) {
      // プレビュー用URL作成で失敗しても、撮影自体は保存する。
      onCapturePhoto(slot.areaId, slot.slotId, file);
      setFocusAfterCaptureKey(key);
      activeSlotRef.current = null;
      setActiveSlot(null);
      setCaptureError(
        error instanceof Error
          ? `${error.message} 撮影済みとして保存しました。`
          : "サムネイル表示に失敗しましたが、撮影済みとして保存しました。"
      );
    } finally {
      setProcessingSlotKey(null);
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <ScreenHeader
        weekdayText={weekdayText}
        timeText={timeText}
        areaName="写真撮影"
        rightAction={
          <button type="button" onClick={onGoBack} style={subActionButtonStyle}>
            戻る
          </button>
        }
      />

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          background: "#fafafa",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>
          細巻きから順に写真を撮ってください
        </div>
        <div style={{ lineHeight: 1.7, fontSize: 14 }}>
          値引は弁当・麺類から始まります。撮影後、AI判定は弁当・麺類から順番に裏で進めます。
        </div>
        <div style={{ marginTop: 10, fontWeight: 800 }}>
          撮影済み: {completedCount} / {totalCount}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: "#666", lineHeight: 1.6 }}>
          撮影直後は写真をすぐ保存します。重い圧縮処理は値引開始後のアップロード時に回し、撮影中に止まりにくくしています。
        </div>
      </section>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoSelected}
        style={{ display: "none" }}
      />

      {captureError ? (
        <section
          style={{
            border: "1px solid #f0b3b3",
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
            background: "#fff5f5",
            color: "#9a1b1b",
            lineHeight: 1.6,
            fontSize: 14,
          }}
        >
          {captureError}
        </section>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        {groupSlots(slots).map((group) => (
          <section
            key={group.areaId}
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 14,
              background: "#fff",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 10 }}>{group.areaName}</div>
            <div style={{ display: "grid", gap: 10 }}>
              {group.slots.map((slot) => {
                const key = `${slot.areaId}:${slot.slotId}`;
                const isProcessing = processingSlotKey === key;
                return (
                  <button
                    key={key}
                    ref={(element) => {
                      slotButtonRefs.current[key] = element;
                    }}
                    type="button"
                    onClick={() => openCamera(slot)}
                    disabled={Boolean(processingSlotKey)}
                    style={{
                      border: slot.captured ? "2px solid #2f5ef5" : "1px solid #ccc",
                      borderRadius: 12,
                      padding: 10,
                      background: slot.captured ? "#f3f8ff" : "#fff",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 10,
                      alignItems: "center",
                      textAlign: "left",
                      cursor: processingSlotKey ? "wait" : "pointer",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800 }}>{slot.slotLabel}</div>
                      <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                        {isProcessing ? "画像を準備中..." : slot.captured ? "撮影済み。タップで撮り直し" : "タップして撮影"}
                      </div>
                    </div>
                    {slot.previewUrl && !failedPreviewKeys[key] ? (
                      <img
                        src={slot.previewUrl}
                        alt={`${group.areaName} ${slot.slotLabel}`}
                        loading="lazy"
                        decoding="async"
                        onError={() => {
                          setFailedPreviewKeys((current) => ({ ...current, [key]: true }));
                        }}
                        style={{
                          width: 72,
                          height: 72,
                          objectFit: "cover",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                        }}
                      />
                    ) : slot.captured ? (
                      <div
                        aria-label={`${group.areaName} ${slot.slotLabel} 撮影済み`}
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: 10,
                          border: "1px solid #b7c6ff",
                          background: "#eaf1ff",
                          display: "grid",
                          placeItems: "center",
                          color: "#2f5ef5",
                          fontSize: 12,
                          fontWeight: 800,
                          textAlign: "center",
                          lineHeight: 1.3,
                        }}
                      >
                        撮影済み
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginTop: 16,
          background: "#fafafa",
        }}
      >
        <details>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            写真判定サーバー設定
          </summary>
          <input
            type="text"
            value={photoJudgeBaseUrl}
            onChange={(event) => onChangePhotoJudgeBaseUrl(event.currentTarget.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginTop: 8,
              padding: 10,
              borderRadius: 10,
              border: "1px solid #ccc",
              fontSize: 14,
            }}
          />
        </details>
      </section>

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton onClick={onStartWithPhotos} disabled={!allCaptured}>
          撮影を終えて値引開始
        </PrimaryButton>
        {!allCaptured ? (
          <div style={{ fontSize: 13, color: "#666", textAlign: "center" }}>
            写真ありで始めるには、すべての写真を撮ってください。
          </div>
        ) : null}
        <button type="button" onClick={onStartWithoutPhotos} style={subActionButtonStyle}>
          写真なしで値引開始
        </button>
      </div>
    </main>
  );
}
