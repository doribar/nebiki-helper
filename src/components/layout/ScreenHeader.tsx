

type ScreenHeaderProps = {
  weekdayText: string;
  timeText: string;
  areaName?: string | null;
};

export function ScreenHeader({
  weekdayText,
  timeText,
  areaName,
}: ScreenHeaderProps) {
  return (
    <header style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>
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