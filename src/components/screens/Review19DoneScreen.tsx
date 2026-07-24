import type { CSSProperties } from "react";
import { PrimaryButton } from "../layout/PrimaryButton";

type Review19DoneScreenProps = {
  allDataCount: number;
  onExportAllData: () => void;
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
  allDataCount,
  onExportAllData,
  onReturnHome,
}: Review19DoneScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
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
          1日通しデータと19:00チェックデータを、重複を除いて1つのJSONへ出力します。
        </div>

        <div>
          <PrimaryButton onClick={onExportAllData} disabled={allDataCount === 0}>
            全データを出力
          </PrimaryButton>
        </div>
      </section>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton onClick={onReturnHome}>トップに戻る</PrimaryButton>
      </div>

    </main>
  );
}
