import type { CSSProperties } from "react";
import { ScreenHeader } from "../layout/ScreenHeader";

type AutoSkipNoticeScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
  onConfirm: () => void;
  autoSkipKind?: "late_plus5" | "early_next_minus5";
  onGoBack: () => void;
  onReturnHome: () => void;
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

export function AutoSkipNoticeScreen({
  weekdayText,
  timeText,
  areaName,
  onConfirm,
  autoSkipKind = "late_plus5",
  onGoBack,
  onReturnHome,
}: AutoSkipNoticeScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
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

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 20,
          background: "#fff",
          textAlign: "center",
        }}
      >
        {autoSkipKind === "early_next_minus5" ? (
          <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.7, marginBottom: 18 }}>
            {areaName}エリアは
            <br />
            先取り値引済みのため
            <br />
            今回はスキップします。
            <div style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: "#555" }}>
              18:00以降に、18時30分値引率より5%弱めて値引済みです。
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.7, marginBottom: 18 }}>
            {areaName}エリアは
            <br />
            前回の値引で+5%で値引きしているため
            <br />
            今回はスキップします。
          </div>
        )}

        <button
          type="button"
          onClick={onConfirm}
          style={{
            width: "100%",
            border: 0,
            borderRadius: 14,
            padding: "14px 16px",
            background: "#111",
            color: "#fff",
            fontSize: 16,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          OK
        </button>
      </section>

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={onReturnHome} style={{ ...subActionButtonStyle, width: "100%" }}>
          トップに戻る
        </button>
      </div>
    </main>
  );
}
