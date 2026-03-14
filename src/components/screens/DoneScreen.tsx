import { PrimaryButton } from "../layout/PrimaryButton";

type DoneScreenProps = {
  onReset: () => void;
};

export function DoneScreen({ onReset }: DoneScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 20,
          marginTop: 32,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>
          すべてのエリアの確認が
          <br />
          終わりました
        </div>

        <div style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>
          値引作業は完了です。
        </div>

        <PrimaryButton onClick={onReset}>
          最初の画面に戻る
        </PrimaryButton>
      </section>
    </main>
  );
}