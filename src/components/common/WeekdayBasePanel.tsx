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
          display: "grid",
          gridTemplateColumns: hasDetails ? "minmax(0, 1fr) auto" : "1fr",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 700, minWidth: 0 }}>{summaryText}</div>
        {hasDetails ? (
          <button
            type="button"
            aria-label={isOpen ? "内訳を閉じる" : "内訳を表示"}
            title={isOpen ? "内訳を閉じる" : "内訳を表示"}
            onClick={() => setIsOpen((current) => !current)}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              borderRadius: 999,
              border: "1px solid #bbb",
              background: "#fff",
              fontSize: 13,
              lineHeight: "26px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {isOpen ? "▲" : "▼"}
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
