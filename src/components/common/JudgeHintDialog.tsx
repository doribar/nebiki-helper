import { useState } from "react";
import { PrimaryButton } from "../layout/PrimaryButton";
import type { DemandCycle } from "../../domain/types";

function JudgeHintContent({
  purpose,
  demandCycle = "normal",
}: {
  purpose: "product" | "manual-area";
  demandCycle?: DemandCycle;
}) {
  const isSummerMode = demandCycle === "summer";

  return (
    <div style={{ lineHeight: 1.8 }}>
      {purpose === "product" ? (
        <>
          <div>
            ・商品が大パックと小パックで分かれている
            <span style={{ color: "#ab47bc", fontWeight: 700 }}>
              ➡大パックだけ値引
            </span>
          </div>
          <div>
            ・期限が近いものと遠いもので分かれている
            <span style={{ color: "#ab47bc", fontWeight: 700 }}>
              ➡近いものだけ値引
            </span>
          </div>

          <div style={{ marginTop: 14, marginBottom: 8 }}>
            ・分かれていなければ値引時刻が
          </div>
        </>
      ) : null}
      {purpose === "product" ? (
        <>
          <div>
            {isSummerMode ? "15時・17時" : "15時"}：
            <span style={{ color: "#e65100", fontWeight: 700 }}>少ない側に寄せる</span>
          </div>
          <div style={{ marginTop: 8 }}>
            {isSummerMode ? "18時以降" : "17時以降"}：
            <span style={{ color: "#e65100", fontWeight: 700 }}>多い側に寄せる</span>
          </div>
        </>
      ) : isSummerMode ? (
        <>
          <div>
            15時・17時：2つの間で迷う場合は選択肢を長押し。
            <br />中間評価として記録し、値引率は
            <span style={{ color: "#e65100", fontWeight: 700 }}>
              少ない側の判定
            </span>
            で計算します。
          </div>
          <div style={{ marginTop: 8 }}>
            18時以降：2つの間で迷う場合は選択肢を長押し。
            <br />中間評価として記録し、値引率は
            <span style={{ color: "#e65100", fontWeight: 700 }}>
              多い側の判定
            </span>
            で計算します。
          </div>
        </>
      ) : (
        <>
          <div>
            15時：2つの間で迷う場合は選択肢を長押し。
            <br />中間評価として記録し、値引率は
            <span style={{ color: "#e65100", fontWeight: 700 }}>
              少ない側の判定
            </span>
            で計算します。
          </div>
          <div style={{ marginTop: 8 }}>
            17時以降：2つの間で迷う場合は選択肢を長押し。
            <br />中間評価として記録し、値引率は
            <span style={{ color: "#e65100", fontWeight: 700 }}>
              多い側の判定
            </span>
            で計算します。
          </div>
        </>
      )}
    </div>
  );
}

export function JudgeHintDialog({
  onClose,
  purpose,
  demandCycle = "normal",
}: {
  onClose: () => void;
  purpose: "product" | "manual-area";
  demandCycle?: DemandCycle;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="judge-hint-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onTouchCancel={(event) => event.stopPropagation()}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 16,
          background: "#fff",
          padding: 18,
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.25)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          id="judge-hint-title"
          style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}
        >
          迷った時の判断基準
        </div>

        <JudgeHintContent
          purpose={purpose}
          demandCycle={demandCycle}
        />

        <div style={{ marginTop: 18 }}>
          <PrimaryButton onClick={onClose}>OK</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

export function ManualAreaJudgeHint({ demandCycle }: { demandCycle: DemandCycle }) {
  const [showHint, setShowHint] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setShowHint(true)}
        onTouchStart={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
        style={{
          border: 0,
          background: "transparent",
          color: "#555",
          fontSize: 14,
          fontWeight: 700,
          textDecoration: "underline",
          textUnderlineOffset: 3,
          cursor: "pointer",
          padding: "4px 0",
        }}
      >
        迷ったら…
      </button>
      {showHint ? (
        <JudgeHintDialog
          purpose="manual-area"
          demandCycle={demandCycle}
          onClose={() => setShowHint(false)}
        />
      ) : null}
    </div>
  );
}
