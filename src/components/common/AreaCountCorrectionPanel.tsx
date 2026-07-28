import { useState, type CSSProperties } from "react";
import type { AreaId, EditableAreaCountItem } from "../../domain/types.ts";

type AreaCountCorrectionPanelProps = {
  items: EditableAreaCountItem[];
  onSelect: (areaId: AreaId) => void;
};

const buttonStyle: CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #bbb",
  background: "#fff",
  color: "#111",
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
};

export function AreaCountCorrectionPanel({
  items,
  onSelect,
}: AreaCountCorrectionPanelProps) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <section style={{ marginTop: 16, width: "100%", minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        style={buttonStyle}
      >
        入力した残数を修正
      </button>

      {open ? (
        <div
          style={{
            display: "grid",
            gap: 8,
            marginTop: 8,
            padding: 10,
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "#fafafa",
          }}
        >
          <div style={{ fontSize: 13, color: "#555", lineHeight: 1.5 }}>
            修正するエリアを選んでください。
          </div>
          {items.map((item) => (
            <button
              key={item.areaId}
              type="button"
              onClick={() => onSelect(item.areaId)}
              style={{
                ...buttonStyle,
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                textAlign: "left",
              }}
            >
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                {item.areaName}
              </span>
              <span style={{ flexShrink: 0 }}>{item.count}個</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
