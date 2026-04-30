import { useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import type { AreaId, PhotoCaptureSlotView } from "../../domain/types";
import { compressPhotoForUpload } from "../../domain/photoJudge";
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
  onCapturePhoto: (areaId: AreaId, slotId: string, file: File) => void;
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
  const [activeSlot, setActiveSlot] = useState<PhotoCaptureSlotView | null>(null);
  const [processingSlotKey, setProcessingSlotKey] = useState<string | null>(null);
  const allCaptured = completedCount === totalCount;

  function openCamera(slot: PhotoCaptureSlotView) {
    setActiveSlot(slot);
    inputRef.current?.click();
  }

  async function handlePhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const slot = activeSlot;
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!slot || !file) return;

    const key = `${slot.areaId}:${slot.slotId}`;
    setProcessingSlotKey(key);
    try {
      const compressed = await compressPhotoForUpload(file);
      onCapturePhoto(slot.areaId, slot.slotId, compressed);
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
      </section>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoSelected}
        style={{ display: "none" }}
      />

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
                    {slot.previewUrl ? (
                      <img
                        src={slot.previewUrl}
                        alt={`${group.areaName} ${slot.slotLabel}`}
                        style={{
                          width: 72,
                          height: 72,
                          objectFit: "cover",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                        }}
                      />
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
