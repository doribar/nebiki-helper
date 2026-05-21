import type { CSSProperties } from "react";
import type { AreaId, Review19AreaItem, Review19Rating } from "../../domain/types";
import { REVIEW19_RATINGS } from "../../domain/review19.ts";
import { PrimaryButton } from "../layout/PrimaryButton";

const rowStyle: CSSProperties = {
  padding: "12px 0",
  borderBottom: "1px solid #eee",
  display: "grid",
  gap: 8,
};

const areaNameStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
};

const ratingGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
  gap: 6,
};

function getRatingButtonStyle(selected: boolean): CSSProperties {
  return {
    minHeight: 48,
    padding: "8px 4px",
    borderRadius: 10,
    border: selected ? "2px solid #111" : "1px solid #ccc",
    background: selected ? "#111" : "#fff",
    color: selected ? "#fff" : "#111",
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.25,
    cursor: "pointer",
  };
}

type Review19ScreenProps = {
  items: Review19AreaItem[];
  onChangeRating: (areaId: AreaId, rating: Review19Rating) => void;
  onSave: () => void;
};

export function Review19Screen({ items, onChangeRating, onSave }: Review19ScreenProps) {
  return (
    <main style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          background: "#fff",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>
          19時売場チェック
        </div>
        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.7 }}>
          15時・17時値引後の減り方を、エリアごとに記録します。
          <br />
          初期値はすべて「ちょうどいい」です。違うエリアだけ変更してください。
        </div>
      </section>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 16,
          marginTop: 16,
          background: "#fff",
        }}
      >
        {items.map((item) => (
          <div key={item.areaId} style={rowStyle}>
            <div style={areaNameStyle}>{item.areaName}</div>
            <div style={ratingGridStyle}>
              {REVIEW19_RATINGS.map((rating) => (
                <button
                  key={rating.value}
                  type="button"
                  onClick={() => onChangeRating(item.areaId, rating.value)}
                  style={getRatingButtonStyle(item.rating === rating.value)}
                >
                  {rating.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div style={{ marginTop: 20 }}>
        <PrimaryButton onClick={onSave}>記録して終了</PrimaryButton>
      </div>
    </main>
  );
}
