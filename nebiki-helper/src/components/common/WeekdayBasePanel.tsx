import { useState } from "react";

type WeekdayBasePanelProps = {
  noticeText?: string;
  weekdaySummaryText?: string;
  weekdayDetailLines?: string[];
  bonusSummaryText?: string;
  bonusDetailLines?: string[];
};

function DetailToggleRow({
  summaryText,
  detailLines,
}: {
  summaryText?: string;
  detailLines?: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!summaryText) {
    return null;
  }

  const hasDetails = Boolean(detailLines && detailLines.length > 0);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 700 }}>{summaryText}</div>
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setIsOpen((current) => !current)}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #bbb",
              background: "#fff",
              fontSize: 13,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {isOpen ? "内訳を閉じる" : "内訳を表示"}
          </button>
        ) : null}
      </div>

      {hasDetails && isOpen ? (
        <div
          style={{
            borderRadius: 10,
            background: "#fff",
            border: "1px solid #e3e3e3",
            padding: 10,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            {detailLines?.map((line) => (
              <div key={line} style={{ fontSize: 14 }}>
                ・{line}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WeekdayBasePanel({
  noticeText,
  weekdaySummaryText,
  weekdayDetailLines,
  bonusSummaryText,
  bonusDetailLines,
}: WeekdayBasePanelProps) {
  if (!noticeText && !weekdaySummaryText && !bonusSummaryText) {
    return null;
  }

  return (
    <section
      style={{
        border: "1px solid #ddd",
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        background: "#fafafa",
      }}
    >
      <div style={{ display: "grid", gap: 12, lineHeight: 1.7 }}>
        {noticeText ? <div>{noticeText}</div> : null}

        <DetailToggleRow
          summaryText={weekdaySummaryText}
          detailLines={weekdayDetailLines}
        />

        <DetailToggleRow
          summaryText={bonusSummaryText}
          detailLines={bonusDetailLines}
        />
      </div>
    </section>
  );
}
