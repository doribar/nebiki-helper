import type { ReactNode } from "react";

type ScreenHeaderProps = {
  weekdayText: string;
  timeText: string;
  areaName: string | null;
  titleFontSize?: number;
  rightAction?: ReactNode;
  titleContent?: ReactNode;
};

export function ScreenHeader({
  weekdayText,
  timeText,
  areaName,
  titleFontSize,
  rightAction,
  titleContent,
}: ScreenHeaderProps) {
  const titleText = [weekdayText, timeText].filter(Boolean).join(" ");

  return (
    <header style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: titleFontSize ?? 24, fontWeight: 700 }}>
            {titleContent ?? titleText}
          </div>

          {areaName ? (
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
              {areaName}
            </div>
          ) : null}
        </div>

        {rightAction ? <div style={{ flexShrink: 0 }}>{rightAction}</div> : null}
      </div>
    </header>
  );
}
