import type { CSSProperties } from "react";
import type { FinalGuideData, FinalTimeStep } from "../../domain/types";
import { ScreenHeader } from "../layout/ScreenHeader";
import { PrimaryButton } from "../layout/PrimaryButton";

type FinalTimeScreenProps = {
  weekdayText: string;
  timeText: string;
  timeSwitchNotice?: string | null;
  finalGuide: FinalGuideData;
  finalStep: FinalTimeStep;
  onAdvance: () => void;
  onBack: () => void;
  onBackToTop: () => void;
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

export function FinalTimeScreen({
  weekdayText,
  timeText,
  timeSwitchNotice,
  finalGuide,
  finalStep,
  onAdvance,
  onBack,
  onBackToTop,
}: FinalTimeScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <ScreenHeader
        weekdayText={weekdayText}
        timeText={timeText}
        areaName={null}
        rightAction={
          <button type="button" onClick={onBack} style={subActionButtonStyle}>
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
          20時30分は最終値引です
        </div>
        <div style={{ lineHeight: 1.7 }}>
          なるべく商品が多いエリアから値引きを始めてください。
        </div>
      </section>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
        }}
      >
        {finalStep === 0 ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.7 }}>
              3個以上ある商品を
              <br />
              {finalGuide.count3OrMore.main}値引きしてください。
            </div>

            <div style={{ marginTop: 20 }}>
              <PrimaryButton onClick={onAdvance}>終わった</PrimaryButton>
            </div>
          </>
        ) : null}

        {finalStep === 1 ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.7 }}>
              2個ある商品を
              <br />
              {finalGuide.count2.main}値引きしてください。
            </div>

            <div style={{ marginTop: 20 }}>
              <PrimaryButton onClick={onAdvance}>終わった</PrimaryButton>
            </div>
          </>
        ) : null}

        {finalStep === 2 ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.7 }}>
              1個の商品を
              <br />
              {finalGuide.count1.main}値引きしてください。
            </div>

            <div style={{ marginTop: 20 }}>
              <PrimaryButton onClick={onAdvance}>終わった</PrimaryButton>
            </div>
          </>
        ) : null}

        {finalStep === 3 ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.7 }}>
              本日の値引きは以上です。
            </div>

            <div style={{ marginTop: 20 }}>
              <PrimaryButton onClick={onBackToTop}>トップに戻る</PrimaryButton>
            </div>
          </>
        ) : null}
      </section>

    </main>
  );
}
