import { useEffect, useState, type CSSProperties } from "react";
import type { AreaJudge, SkipTargetOption } from "../../domain/types";
import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { ScreenHeader } from "../layout/ScreenHeader";

type AreaJudgeScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
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
  onJudge: (judge: Exclude<AreaJudge, null>) => void;
  onSkip: () => void;
  onGoBack: () => void;
  canChooseSkipTarget?: boolean;
  skipTargetOptions?: SkipTargetOption[];
  onChooseSkipTarget?: (areaId: SkipTargetOption["areaId"]) => void;
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
  basisGuide,
  pendingBanner,
  timeSwitchNotice,
  onJudge,
  onSkip,
  onGoBack,
  canChooseSkipTarget: _canChooseSkipTarget = false,
  skipTargetOptions = [],
  onChooseSkipTarget,
}: AreaJudgeScreenProps) {
  const referencePrefix = basisGuide.referenceText.replace("を基準に考えて", "");
  const [showSkipTargetPicker, setShowSkipTargetPicker] = useState(false);

  useEffect(() => {
    setShowSkipTargetPicker(false);
  }, [areaName, skipTargetOptions.length]);

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

      {pendingBanner ? (
        <section
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            まだ値引きをしていないエリアが{pendingBanner.remainingCount}個あります。
          </div>
          <div>
            {pendingBanner.reason === "manual"
              ? "手動でスキップしたエリアから表示しています。"
              : "少ないため後回しにしたエリアを表示しています。"}
          </div>
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

        <div style={{ display: "grid", gap: 10 }}>
          <JudgeOptionButton
            label="多い"
            selected={false}
            onClick={() => onJudge("many")}
          />
          <JudgeOptionButton
            label="どちらでもない"
            selected={false}
            onClick={() => onJudge("normal")}
          />
          <JudgeOptionButton
            label="少ない"
            subLabel="後回しします"
            selected={false}
            onClick={() => onJudge("few")}
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
          disabled={skipTargetOptions.length === 0}
          style={{
            ...subActionButtonStyle,
            opacity: skipTargetOptions.length === 0 ? 0.45 : 1,
            cursor: skipTargetOptions.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          スキップ先を選ぶ
        </button>

        {skipTargetOptions.length > 0 && showSkipTargetPicker ? (
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>まだ値引きが終わっていないエリア</div>
            <div style={{ display: "grid", gap: 8 }}>
              {skipTargetOptions.map((option) => (
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
