import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import type { AreaId, PhotoCaptureSlotView } from "../../domain/types";
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

const commonGuideItemStyle: CSSProperties = {
  margin: 0,
};

const slotGuideStyle: CSSProperties = {
  fontSize: 12,
  color: "#555",
  marginTop: 6,
  lineHeight: 1.45,
};

const COMMON_CAPTURE_GUIDE = [
  "売場幅と空きスペースが分かるよう、少し引いて撮る",
  "できるだけ毎回同じ位置・高さ・向きで撮る",
  "商品の積み重なり、残り量、広く薄い/狭く厚い残り方が分かるようにする",
  "ブレた、暗い、近すぎたと感じたら同じ枠を撮り直す",
];

const AREA_CAPTURE_GUIDES: Partial<Record<AreaId, string>> = {
  bento_men: "弁当・麺類は4枚セットで比較します。各区分の売場幅、空き、積み重なりが分かるように撮ってください。",
  fry_chicken: "フライ・鶏惣菜は2枚セットで比較します。フライ側と鶏惣菜側を混ぜず、それぞれの残量感が分かるように撮ってください。",
};

function getAreaCaptureGuide(areaId: AreaId): string {
  return (
    AREA_CAPTURE_GUIDES[areaId] ??
    "エリア全体の売場幅、空きスペース、商品の積み重なりが分かるように撮ってください。"
  );
}

function getSlotCaptureGuide(areaId: AreaId, slotLabel: string): string {
  if (areaId === "bento_men") {
    if (slotLabel === "正面") {
      return "弁当・麺類エリア全体の残り具合が分かるよう、正面から少し引いて撮る。";
    }
    if (slotLabel === "バラ側") {
      return "バラ弁当側の幅、空き、商品の山の高さが分かるように撮る。";
    }
    if (slotLabel === "寿司側") {
      return "寿司・丼側の残り量と空きスペースが分かるように撮る。";
    }
    if (slotLabel === "麺類") {
      return "麺類の売場幅、残り量、積み重なりが分かるように撮る。";
    }
  }

  if (areaId === "fry_chicken") {
    if (slotLabel === "フライ側") {
      return "フライ側の幅、トレーの空き、商品の積み上がり具合が分かるように撮る。";
    }
    if (slotLabel === "鶏惣菜側") {
      return "鶏惣菜側の幅、空き、残り量の厚みが分かるように撮る。";
    }
  }

  return "このエリア全体の売場幅、空き、残り量が分かるように少し引いて撮る。";
}

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
  const [inputResetKey, setInputResetKey] = useState(0);
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

  function resetActiveCapture() {
    activeSlotRef.current = null;
    setActiveSlot(null);
    setInputResetKey((current) => current + 1);
  }

  function openCamera(slot: PhotoCaptureSlotView) {
    setCaptureError(null);
    activeSlotRef.current = slot;
    setActiveSlot(slot);
    inputRef.current?.click();
  }

  function handlePhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const slot = activeSlotRef.current ?? activeSlot;
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";

    if (!file) {
      resetActiveCapture();
      return;
    }

    if (!slot) {
      setCaptureError("撮影枠の取得に失敗しました。もう一度撮影してください。");
      resetActiveCapture();
      return;
    }

    const key = `${slot.areaId}:${slot.slotId}`;
    setProcessingSlotKey(key);
    setCaptureError(null);

    try {
      // 撮影直後は、画像を画面に展開しない。
      // 画像プレビューや canvas 圧縮は再読込直後の低メモリ端末で落ちやすいため、
      // File だけを保存し、画面は軽い「撮影済み」枠で表す。
      onCapturePhoto(slot.areaId, slot.slotId, file);
      setFocusAfterCaptureKey(key);
    } catch (error) {
      setCaptureError(
        error instanceof Error
          ? `撮影データの保存に失敗しました。${error.message}`
          : "撮影データの保存に失敗しました。もう一度撮影してください。"
      );
    } finally {
      setProcessingSlotKey(null);
      resetActiveCapture();
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
        <div
          style={{
            marginTop: 12,
            border: "1px solid #d9e2ff",
            borderRadius: 12,
            padding: 12,
            background: "#f5f8ff",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>撮り方の目安</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.65, fontSize: 13 }}>
            {COMMON_CAPTURE_GUIDE.map((guide) => (
              <li key={guide} style={commonGuideItemStyle}>
                {guide}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.55 }}>
            AIは過去写真と今回写真を比べます。完全に同じ構図でなくてもよいですが、売場幅・空き・積み重なりが毎回見えるようにすると判定が安定しやすくなります。
          </div>
        </div>
        <div style={{ marginTop: 10, fontWeight: 800 }}>
          撮影済み: {completedCount} / {totalCount}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: "#666", lineHeight: 1.6 }}>
          安定性優先のため、撮影画面では実写真サムネイルを表示しません。撮影データは保持し、AI判定には送信します。
        </div>
      </section>

      <input
        key={inputResetKey}
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
            <div style={{ fontWeight: 800, marginBottom: 6 }}>{group.areaName}</div>
            <div style={{ fontSize: 13, color: "#555", lineHeight: 1.55, marginBottom: 10 }}>
              {getAreaCaptureGuide(group.areaId)}
            </div>
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
                        {isProcessing ? "保存中..." : slot.captured ? "撮影済み。タップで撮り直し" : "タップして撮影"}
                      </div>
                      <div style={slotGuideStyle}>{getSlotCaptureGuide(slot.areaId, slot.slotLabel)}</div>
                    </div>
                    {slot.captured ? (
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
