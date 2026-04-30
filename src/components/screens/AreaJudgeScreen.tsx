import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import type { AreaJudge, PhotoJudgeFeedbackRecord, SkipTargetOption } from "../../domain/types";
import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { ScreenHeader } from "../layout/ScreenHeader";
import {
  getPhotoJudgeBaseUrl,
  requestPhotoJudge,
  setPhotoJudgeBaseUrl as savePhotoJudgeBaseUrl,
  type PhotoJudgeResult,
} from "../../domain/photoJudge";

type AreaJudgeScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
  showJudgeGuide?: boolean;
  basisGuide: {
    noticeText?: string;
    weekdaySummaryText?: string;
    weekdayDetailLines?: string[];
    bonusSummaryText?: string;
    bonusDetailLines?: string[];
    referenceText: string;
  };
  pendingBanner?: {
    remainingCount: number;
    reason: "manual" | "few";
  } | null;
  timeSwitchNotice?: string | null;
  currentPhotoJudgeFeedback?: PhotoJudgeFeedbackRecord | null;
  onJudge: (
    judge: Exclude<AreaJudge, null>,
    photoJudgeFeedback?: { photoGroupId: string; apiBaseUrl: string } | null
  ) => void;
  onSkip: () => void;
  onGoBack: () => void;
  canChooseSkipTarget?: boolean;
  skipTargetOptions?: SkipTargetOption[];
  onChooseSkipTarget?: (areaId: SkipTargetOption["areaId"]) => void;
  onJudgeGuideShown?: () => void;
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

function JudgeOptionButton({
  label,
  subLabel,
  selected,
  onClick,
}: {
  label: string;
  subLabel?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        padding: "14px 16px",
        borderRadius: 12,
        border: selected ? "2px solid #2f5ef5" : "1px solid #ccc",
        background: selected ? "#e8f0ff" : "#fff",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 800 }}>
        {label}
        {subLabel ? (
          <span style={{ fontSize: 13, color: "#555", fontWeight: 600, marginLeft: 6 }}>
            ({subLabel})
          </span>
        ) : null}
      </div>
    </button>
  );
}

export function AreaJudgeScreen({
  weekdayText,
  timeText,
  areaName,
  showJudgeGuide = false,
  basisGuide,
  timeSwitchNotice,
  currentPhotoJudgeFeedback = null,
  onJudge,
  onSkip,
  onGoBack,
  canChooseSkipTarget = false,
  skipTargetOptions = [],
  onChooseSkipTarget,
  onJudgeGuideShown,
}: AreaJudgeScreenProps) {
  const referencePrefix = basisGuide.referenceText.replace("を基準に考えて", "");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [showSkipTargetPicker, setShowSkipTargetPicker] = useState(false);
  const [displayJudgeGuide, setDisplayJudgeGuide] = useState(showJudgeGuide);
  const [photoJudgeBaseUrl, setPhotoJudgeBaseUrlState] = useState(() => getPhotoJudgeBaseUrl());
  const [photoJudgeResult, setPhotoJudgeResult] = useState<PhotoJudgeResult | null>(null);
  const [photoJudgeError, setPhotoJudgeError] = useState<string | null>(null);
  const [photoJudgeLoading, setPhotoJudgeLoading] = useState(false);
  const [lastPhotoFiles, setLastPhotoFiles] = useState<File[]>([]);
  const skipTargetGroups = [
    {
      label: "スキップしたエリア",
      options: skipTargetOptions.filter((option) => option.status === "skipped_manual"),
    },
    {
      label: "少ないため後回ししたエリア",
      options: skipTargetOptions.filter((option) => option.status === "postponed_few"),
    },
    {
      label: "未着手のエリア",
      options: skipTargetOptions.filter((option) => option.status === "unstarted"),
    },
  ].filter((group) => group.options.length > 0);

  useEffect(() => {
    setShowSkipTargetPicker(false);
    setDisplayJudgeGuide(showJudgeGuide);
    setPhotoJudgeResult(null);
    setPhotoJudgeError(null);
    setPhotoJudgeLoading(false);
    setLastPhotoFiles([]);
  }, [areaName, showJudgeGuide]);

  useEffect(() => {
    if (!displayJudgeGuide) return;
    onJudgeGuideShown?.();
  }, [displayJudgeGuide, onJudgeGuideShown]);

  function updatePhotoJudgeBaseUrl(url: string) {
    setPhotoJudgeBaseUrlState(url);
    savePhotoJudgeBaseUrl(url);
  }

  async function submitPhotoJudgeRequest(photos: File[]) {
    if (photos.length === 0) {
      setPhotoJudgeError("写真が選択されませんでした。もう一度撮ってください。");
      return;
    }

    setPhotoJudgeLoading(true);
    setPhotoJudgeError(null);
    setPhotoJudgeResult(null);

    try {
      const result = await requestPhotoJudge({
        apiBaseUrl: photoJudgeBaseUrl,
        areaName,
        weekdayText,
        timeText,
        photos,
      });
      setPhotoJudgeResult(result);
    } catch (error) {
      setPhotoJudgeError(
        error instanceof Error
          ? error.message
          : "写真判定でエラーが発生しました。もう一度送信してください。"
      );
    } finally {
      setPhotoJudgeLoading(false);
    }
  }

  async function handlePhotoInputChange(event: ChangeEvent<HTMLInputElement>) {
    const photos = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    setLastPhotoFiles(photos);
    await submitPhotoJudgeRequest(photos);
  }

  async function handleRetryPhotoJudge() {
    await submitPhotoJudgeRequest(lastPhotoFiles);
  }

  function handleJudge(judge: Exclude<AreaJudge, null>) {
    const photoJudgeFeedback = photoJudgeResult?.photoGroupId
      ? {
          apiBaseUrl: photoJudgeBaseUrl,
          photoGroupId: photoJudgeResult.photoGroupId,
        }
      : currentPhotoJudgeFeedback?.photoGroupId
      ? {
          apiBaseUrl: currentPhotoJudgeFeedback.apiBaseUrl,
          photoGroupId: currentPhotoJudgeFeedback.photoGroupId,
        }
      : null;

    onJudge(judge, photoJudgeFeedback);
  }

  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
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

      {timeSwitchNotice ? (
        <section
          style={{
            border: "1px solid #ead28b",
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
            background: "#fff8e1",
          }}
        >
          <div>{timeSwitchNotice}</div>
        </section>
      ) : null}

      <WeekdayBasePanel
        noticeText={basisGuide.noticeText}
        weekdaySummaryText={basisGuide.weekdaySummaryText}
        weekdayDetailLines={basisGuide.weekdayDetailLines}
        bonusSummaryText={basisGuide.bonusSummaryText}
        bonusDetailLines={basisGuide.bonusDetailLines}
      />

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 18,
            marginBottom: 14,
            lineHeight: 1.7,
          }}
        >
          <span style={{ fontWeight: 800 }}>{referencePrefix}</span>
          <span>を基準に考えて</span>
          <br />
          <span>このエリア全体の商品数は？</span>
        </div>

        {displayJudgeGuide ? (
          <div
            style={{
              border: "1px solid #f0d38a",
              borderRadius: 12,
              padding: 12,
              marginBottom: 14,
              background: "#fffaf0",
              fontSize: 14,
              lineHeight: 1.7,
            }}
          >
            まずエリアが多いかどうかを確認し、当てはまれば「多い」を選択してください。
            多くなければ次に少ないかどうかを確認し、当てはまれば「少ない」を選択してください。
            どちらにも当てはまらない場合は「どちらでもない」を選択してください。
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 10 }}>
          <JudgeOptionButton
            label="多い"
            selected={false}
            onClick={() => handleJudge("many")}
          />
          <JudgeOptionButton
            label="どちらでもない"
            selected={false}
            onClick={() => handleJudge("normal")}
          />
          <JudgeOptionButton
            label="少ない"
            subLabel="後回しします"
            selected={false}
            onClick={() => handleJudge("few")}
          />
        </div>
      </section>

      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <button type="button" onClick={onSkip} style={subActionButtonStyle}>
          今はスキップ
        </button>

        <button
          type="button"
          onClick={() => setShowSkipTargetPicker((current) => !current)}
          disabled={!(canChooseSkipTarget && skipTargetOptions.length > 0)}
          style={{
            ...subActionButtonStyle,
            background: canChooseSkipTarget && skipTargetOptions.length > 0 ? "#fff" : "#eee",
            color: canChooseSkipTarget && skipTargetOptions.length > 0 ? "#000" : "#999",
            cursor: canChooseSkipTarget && skipTargetOptions.length > 0 ? "pointer" : "not-allowed",
          }}
        >
          スキップ先を選ぶ
        </button>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          background: "#fafafa",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 10 }}>写真で参考判定（任意）</div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handlePhotoInputChange}
          style={{ display: "none" }}
        />
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          disabled={photoJudgeLoading}
          style={{
            ...subActionButtonStyle,
            width: "100%",
            background: photoJudgeLoading ? "#eee" : "#fff",
            color: photoJudgeLoading ? "#777" : "#000",
            cursor: photoJudgeLoading ? "wait" : "pointer",
          }}
        >
          {photoJudgeLoading ? "判定中..." : "写真を撮る"}
        </button>

        {lastPhotoFiles.length > 0 ? (
          <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>
            撮影済み写真: {lastPhotoFiles.length}枚
          </div>
        ) : null}

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            写真判定サーバー設定
          </summary>
          <input
            type="text"
            value={photoJudgeBaseUrl}
            onChange={(event) => updatePhotoJudgeBaseUrl(event.currentTarget.value)}
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

        {photoJudgeError ? (
          <div
            style={{
              marginTop: 12,
              border: "1px solid #f1b5b5",
              borderRadius: 12,
              padding: 12,
              background: "#fff5f5",
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>写真判定に失敗しました</div>
            <div>{photoJudgeError}</div>
            {lastPhotoFiles.length > 0 ? (
              <button
                type="button"
                onClick={handleRetryPhotoJudge}
                disabled={photoJudgeLoading}
                style={{
                  ...subActionButtonStyle,
                  width: "100%",
                  marginTop: 10,
                  background: photoJudgeLoading ? "#eee" : "#fff",
                  color: photoJudgeLoading ? "#777" : "#000",
                  cursor: photoJudgeLoading ? "wait" : "pointer",
                }}
              >
                同じ写真でもう一度送信
              </button>
            ) : null}
          </div>
        ) : null}

        {!photoJudgeResult && currentPhotoJudgeFeedback?.photoGroupId ? (
          <div
            style={{
              marginTop: 12,
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 12,
              background: "#fff",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            前回撮った写真判定を保持しています。選び直した場合は、値引完了時に最後の判定だけ保存します。
          </div>
        ) : null}

        {photoJudgeResult ? (
          <div
            style={{
              marginTop: 12,
              border: "1px solid #b9d7ff",
              borderRadius: 12,
              padding: 12,
              background: "#f3f8ff",
              lineHeight: 1.7,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 4 }}>
              参考判定：{photoJudgeResult.suggestion ?? "判定なし"}
              {photoJudgeResult.confidence ? `（自信度：${photoJudgeResult.confidence}）` : ""}
            </div>
            {photoJudgeResult.reason.length > 0 ? (
              <div style={{ fontSize: 14 }}>
                {photoJudgeResult.reason.map((line) => (
                  <div key={line}>・{line}</div>
                ))}
              </div>
            ) : null}
            <div style={{ fontSize: 13, color: "#555", marginTop: 8 }}>
              最終判断は売場を見て選択してください。
            </div>
          </div>
        ) : null}
      </section>

        {canChooseSkipTarget && skipTargetOptions.length > 0 && showSkipTargetPicker ? (
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ display: "grid", gap: 12 }}>
              {skipTargetGroups.map((group) => (
                <div key={group.label}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{group.label}</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {group.options.map((option) => (
                      <button
                        key={option.areaId}
                        type="button"
                        onClick={() => onChooseSkipTarget?.(option.areaId)}
                        style={{
                          ...subActionButtonStyle,
                          width: "100%",
                          textAlign: "left",
                        }}
                      >
                        {option.areaName}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          background: "#fafafa",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>迷ったら…</div>
        <div style={{ lineHeight: 1.8 }}>
          <div>今使っている曜日基準が</div>
          <div>
            月・水または火・木
            <span style={{ color: "#e65100", fontWeight: 700 }}>➡多い側に寄せる</span>
          </div>
          <div>
            金・土または日
            <span style={{ color: "#e65100", fontWeight: 700 }}>➡少ない側に寄せる</span>
          </div>
        </div>
      </section>
    </main>
  );
}
