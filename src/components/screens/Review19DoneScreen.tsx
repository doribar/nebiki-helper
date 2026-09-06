import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PrimaryButton } from "../layout/PrimaryButton";

type Review19DoneScreenProps = {
  onCopyReview19Data: () => Promise<boolean>;
  onGoBack: () => void;
  onReturnHome: () => void;
};

const cardStyle: CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 12,
  padding: 20,
  marginTop: 16,
  background: "#fff",
};

export function Review19DoneScreen({
  onCopyReview19Data,
  onGoBack,
  onReturnHome,
}: Review19DoneScreenProps) {
  const [copyStatus, setCopyStatus] = useState<"success" | "error" | null>(null);
  const [copying, setCopying] = useState(false);
  const copyInFlight = useRef(false);

  useEffect(() => {
    if (copyStatus !== "success") return;
    const timer = window.setTimeout(() => setCopyStatus(null), 5000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  async function copyReview19Data() {
    if (copyInFlight.current) return;
    copyInFlight.current = true;
    setCopying(true);
    setCopyStatus(null);
    try {
      const copied = await onCopyReview19Data();
      setCopyStatus(copied ? "success" : "error");
    } catch {
      setCopyStatus("error");
    } finally {
      copyInFlight.current = false;
      setCopying(false);
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onGoBack}
          style={{
            minWidth: 88,
            minHeight: 44,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #ccc",
            background: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          戻る
        </button>
      </div>
      <section
        style={{
          ...cardStyle,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 12 }}>
          19時売場チェックを
          <br />
          記録しました
        </div>
        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.7 }}>
          値引終了画面とは別に、振り返りデータの保存状況を確認できます。
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>
          保存データ
        </div>
        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.7, marginBottom: 14 }}>
          今回保存した19時チェックデータをコピーして、ChatGPTのチャットに貼り付けられます。
        </div>

        <div>
          <PrimaryButton onClick={copyReview19Data} disabled={copying}>
            {copying ? "コピー中…" : "ChatGPT用にコピー"}
          </PrimaryButton>
        </div>
        <div
          role="status"
          aria-live="polite"
          style={{ marginTop: 10, fontSize: 14, lineHeight: 1.7, color: copyStatus === "error" ? "#b91c1c" : "#166534" }}
        >
          {copyStatus === "success" && "コピーしました"}
          {copyStatus === "error" && "コピーできませんでした。ブラウザの権限を確認するか、設定からJSONを出力してください。"}
        </div>
      </section>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton onClick={onReturnHome}>トップに戻る</PrimaryButton>
      </div>

    </main>
  );
}
