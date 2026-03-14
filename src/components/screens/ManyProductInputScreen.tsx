import { ScreenHeader } from "../layout/ScreenHeader";
import { PrimaryButton } from "../layout/PrimaryButton";

type ManyProductInputScreenProps = {
  weekdayText: string;
  timeText: string;
  areaName: string;
  draftValues: string[];
  onChangeDraftValues: (next: string[]) => void;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function ManyProductInputScreen({
  weekdayText,
  timeText,
  areaName,
  draftValues,
  onChangeDraftValues,
  onAddRow,
  onRemoveRow,
  onSave,
  onCancel,
}: ManyProductInputScreenProps) {
  function updateRow(index: number, value: string) {
    const next = [...draftValues];
    next[index] = value;
    onChangeDraftValues(next);
  }

  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <ScreenHeader
        weekdayText={weekdayText}
        timeText={timeText}
        areaName={areaName}
      />

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 12 }}>
          このエリアで多かった商品を入力してください
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {draftValues.map((value, index) => (
            <div key={index} style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={value}
                onChange={(e) => updateRow(index, e.target.value)}
                placeholder="商品名"
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #ccc",
                }}
              />

              {draftValues.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onRemoveRow(index)}
                  style={{
                    padding: "0 12px",
                    borderRadius: 10,
                    border: "1px solid #ccc",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  削除
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onAddRow}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "#fff",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          行を追加
        </button>
      </section>

      <div style={{ display: "grid", gap: 10 }}>
        <PrimaryButton onClick={onSave}>保存して戻る</PrimaryButton>

        <button
          type="button"
          onClick={onCancel}
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
          入力せず戻る
        </button>
      </div>
    </main>
  );
}