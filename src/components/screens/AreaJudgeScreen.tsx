import { useEffect, useState, type CSSProperties } from "react";
import type { AreaJudge, PhotoJudgeFeedbackRecord, PhotoJudgeQueueRecord, SkipTargetOption } from "../../domain/types";
import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { ScreenHeader } from "../layout/ScreenHeader";

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
  currentPhotoJudgeQueueRecord?: PhotoJudgeQueueRecord | null;
  photoJudgeBaseUrl: string;
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
  onRetryPhotoJudge?: () => void;
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
  aiRecommended = false,
  selected,
  onClick,
}: {
  label: string;
  subLabel?: string;
  aiRecommended?: boolean;
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
        border: aiRecommended ? "2px solid #2f5ef5" : selected ? "2px solid #2f5ef5" : "1px solid #ccc",
        background: aiRecommended ? "#e8f0ff" : selected ? "#e8f0ff" : "#fff",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 800 }}>
        {label}
        {aiRecommended ? (
          <span
            style={{
              display: "inline-block",
              fontSize: 12,
              color: "#fff",
              background: "#2f5ef5",
              fontWeight: 800,
              marginLeft: 8,
              padding: "2px 8px",
              borderRadius: 999,
              verticalAlign: "middle",
            }}
          >
            AI参考
          </span>
        ) : null}
        {subLabel ? (
          <span style={{ fontSize: 13, color: "#555", fontWeight: 600, marginLeft: 6 }}>
            ({subLabel})
          </span>
        ) : null}
      </div>
    </button>
  );
}

function PhotoJudgeStatusPanel({
  queueRecord,
  currentFeedback,
  onRetry,
}: {
  queueRecord?: PhotoJudgeQueueRecord | null;
  currentFeedback?: PhotoJudgeFeedbackRecord | null;
  onRetry?: () => void;
}) {
  if (!queueRecord && !currentFeedback?.photoGroupId) return null;

  const result = queueRecord?.result;

  return (
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

      {queueRecord?.status === "queued" ? (
        <div style={{ lineHeight: 1.7 }}>
          参考判定を準備中です。写真{queueRecord.photoCount}枚を順番に送信します。
        </div>
      ) : null}

      {queueRecord?.status === "uploading" ? (
        <div style={{ lineHeight: 1.7 }}>
          判定中です。待たずに売場を見て選択しても大丈夫です。
        </div>
      ) : null}

      {queueRecord?.status === "error" ? (
        <div
          style={{
            border: "1px solid #f1b5b5",
            borderRadius: 12,
            padding: 12,
            background: "#fff5f5",
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>写真判定に失敗しました</div>
          <div>{queueRecord.error ?? "写真判定でエラーが発生しました。"}</div>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              style={{ ...subActionButtonStyle, width: "100%", marginTop: 10 }}
            >
              このエリアをもう一度送信
            </button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div
          style={{
            border: "1px solid #b9d7ff",
            borderRadius: 12,
            padding: 12,
            background: "#f3f8ff",
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            参考判定：{result.suggestion ?? "判定なし"}
            {result.confidence ? `（自信度：${result.confidence}）` : ""}
          </div>
          {result.reason.length > 0 ? (
            <div style={{ fontSize: 14 }}>
              {result.reason.map((line) => (
                <div key={line}>・{line}</div>
              ))}
            </div>
          ) : null}
          <div style={{ fontSize: 13, color: "#555", marginTop: 8 }}>
            最終判断は売場を見て選択してください。
          </div>
        </div>
      ) : null}

      {!result && !queueRecord && currentFeedback?.photoGroupId ? (
        <div
          style={{
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
    </section>
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
  currentPhotoJudgeQueueRecord = null,
  photoJudgeBaseUrl,
  onJudge,
  onSkip,
  onGoBack,
  canChooseSkipTarget = false,
  skipTargetOptions = [],
  onChooseSkipTarget,
  onJudgeGuideShown,
  onRetryPhotoJudge,
}: AreaJudgeScreenProps) {
  const referencePrefix = basisGuide.referenceText.replace("を基準に考えて", "");
  const [showSkipTargetPicker, setShowSkipTargetPicker] = useState(false);
  const [displayJudgeGuide, setDisplayJudgeGuide] = useState(showJudgeGuide);
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
  }, [areaName, showJudgeGuide]);

  useEffect(() => {
    if (!displayJudgeGuide) return;
    onJudgeGuideShown?.();
  }, [displayJudgeGuide, onJudgeGuideShown]);

  const aiSuggestion = currentPhotoJudgeQueueRecord?.result?.suggestion ?? null;

  function handleJudge(judge: Exclude<AreaJudge, null>) {
    const result = currentPhotoJudgeQueueRecord?.result;
    const photoJudgeFeedback = result?.photoGroupId
      ? {
          apiBaseUrl: photoJudgeBaseUrl,
          photoGroupId: result.photoGroupId,
        }
      : currentPhotoJudgeFeedback?.photoGroupId
      ? {
          apiBaseUrl: currentPhotoJudgeFeedback.apiBaseUrl,
          photoGroupId: currentPhotoJudgeFeedback.photoGroupId,
        }
      : null;

    onJudge(judge, photoJudgeFeedback?.apiBaseUrl ? photoJudgeFeedback : null);
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

        <PhotoJudgeStatusPanel
          queueRecord={currentPhotoJudgeQueueRecord}
          currentFeedback={currentPhotoJudgeFeedback}
          onRetry={onRetryPhotoJudge}
        />

        <div style={{ display: "grid", gap: 10 }}>
          <JudgeOptionButton
            label="多い"
            aiRecommended={aiSuggestion === "多い"}
            selected={false}
            onClick={() => handleJudge("many")}
          />
          <JudgeOptionButton
            label="どちらでもない"
            aiRecommended={aiSuggestion === "どちらでもない"}
            selected={false}
            onClick={() => handleJudge("normal")}
          />
          <JudgeOptionButton
            label="少ない"
            subLabel="後回しします"
            aiRecommended={aiSuggestion === "少ない"}
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
