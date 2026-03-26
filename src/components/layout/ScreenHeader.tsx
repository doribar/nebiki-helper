

type ScreenHeaderProps = {
  weekdayText: string;
  timeText: string;
  areaName: string | null;
  titleFontSize?: number;
};

export function ScreenHeader({
  weekdayText,
  timeText,
  areaName,
  titleFontSize,
}: ScreenHeaderProps) {
  return (
    <header style={{ marginBottom: 16 }}>
      <div style={{ fontSize: titleFontSize ?? 28, fontWeight: 700 }}>
        {weekdayText} {timeText}
      </div>

      {areaName ? (
        <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
          {areaName}
        </div>
      ) : null}
    </header>
  );
}