import type { CSSProperties } from "react";
import type { DiscountTime } from "../../domain/types.ts";
import { getEarlyNextMinus5CompletedText } from "../../domain/earlyNextMinus5.ts";
import { ScreenHeader } from "../layout/ScreenHeader";

type AutoSkipNoticeScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
  onConfirm: () => void;
  onProcessNormally: () => void;
  autoSkipKind?: "late_plus5" | "early_next_minus5";
  discountTime?: DiscountTime;
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
  onProcessNormally,
  autoSkipKind = "late_plus5",
  discountTime,
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
          <div>
            <h2 style={{ margin: "0 0 10px", fontSize: 20, lineHeight: 1.4 }}>
              このエリアは先取り値引済みです
            </h2>
            <p style={{ margin: "0 0 10px", color: "#444", fontSize: 15, lineHeight: 1.6, textAlign: "left" }}>
              先取り値引を行っているため、通常は今回の値引をスキップします。現在の残数を確認して、追加で値引することもできます。
            </p>
            <div style={{ marginBottom: 18, fontSize: 14, fontWeight: 700, color: "#555" }}>
              {getEarlyNextMinus5CompletedText(discountTime === "19" ? "19" : "18")}
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <button
                type="button"
                onClick={onConfirm}
                style={{
                  width: "100%",
                  minHeight: 52,
                  border: "1px solid #aaa",
                  borderRadius: 14,
                  padding: "12px 16px",
                  background: "#fff",
                  color: "#222",
                  fontSize: 16,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                スキップする
              </button>
              <button
                type="button"
                onClick={onProcessNormally}
                style={{
                  width: "100%",
                  minHeight: 52,
                  border: 0,
                  borderRadius: 14,
                  padding: "12px 16px",
                  background: "#111",
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                今回は値引する
              </button>
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

        {autoSkipKind !== "early_next_minus5" ? (
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
        ) : null}
      </section>

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={onReturnHome} style={{ ...subActionButtonStyle, width: "100%" }}>
          トップに戻る
        </button>
      </div>
    </main>
  );
}
