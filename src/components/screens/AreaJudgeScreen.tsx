import { WeekdayBasePanel } from "../common/WeekdayBasePanel";
import { ScreenHeader } from "../layout/ScreenHeader";
import { PrimaryButton } from "../layout/PrimaryButton";

type AreaJudgeScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
  basisGuide: {
    reasonText?: string;
    changeText?: string;
    bonusText?: string;
    referenceText: string;
  };
  onSelectMany: () => void;
  onSelectNormal: () => void;
  onSelectFew: () => void;
  onSkip: () => void;
};

export function AreaJudgeScreen({
  weekdayText,
  timeText,
  areaName,
  basisGuide,
  onSelectMany,
  onSelectNormal,
  onSelectFew,
  onSkip,
}: AreaJudgeScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <ScreenHeader
        weekdayText={weekdayText}
        timeText={timeText}
        areaName={areaName}
      />

      <WeekdayBasePanel
        reasonText={basisGuide.reasonText}
        changeText={basisGuide.changeText}
        bonusText={basisGuide.bonusText}
      />

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 14, lineHeight: 1.7 }}>
          {basisGuide.referenceText}
          <br />
          このエリア全体の商品数は？
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <PrimaryButton onClick={onSelectMany}>多い</PrimaryButton>
          <PrimaryButton onClick={onSelectNormal}>どちらでもない</PrimaryButton>
          <PrimaryButton onClick={onSelectFew}>
            少ない（後回しします）
          </PrimaryButton>
        </div>
      </section>

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
  ・今日が月火水木なら多い方に寄せる
  <br />
  ・今日が金土日なら少ない方に寄せる
</div>
      </section>

      <button
        type="button"
        onClick={onSkip}
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
        今はスキップ
      </button>
    </main>
  );
}