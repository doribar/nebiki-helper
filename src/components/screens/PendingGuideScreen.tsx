import { ScreenHeader } from "../layout/ScreenHeader";
import { PrimaryButton } from "../layout/PrimaryButton";

type PendingGuideScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
  reasonText: string;
  onOpen: () => void;
  onPostponeAgain: () => void;
  onMarkCompleted: () => void;
};

export function PendingGuideScreen({
  weekdayText,
  timeText,
  areaName,
  reasonText,
  onOpen,
  onPostponeAgain,
  onMarkCompleted,
}: PendingGuideScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <ScreenHeader
        weekdayText={weekdayText}
        timeText={timeText}
        areaName={null}
      />

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>
          次に処理するエリア
        </div>

        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>
          {areaName}
        </div>

        <div style={{ fontSize: 15 }}>理由：{reasonText}</div>
      </section>

      <div style={{ display: "grid", gap: 10 }}>
        <PrimaryButton onClick={onOpen}>
          このエリアを開く
        </PrimaryButton>

        <button
          type="button"
          onClick={onPostponeAgain}
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid #ccc",
            background: "#fff",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          さらに後回し
        </button>

        <button
          type="button"
          onClick={onMarkCompleted}
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid #ccc",
            background: "#fff",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          処理済みにする
        </button>
      </div>
    </main>
  );
}