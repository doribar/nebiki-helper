type WeekdayBasePanelProps = {
  reasonText?: string;
  changeText?: string;
  bonusText?: string;
};

export function WeekdayBasePanel({
  reasonText,
  changeText,
  bonusText,
}: WeekdayBasePanelProps) {
  if (!reasonText && !changeText && !bonusText) {
    return null;
  }

  return (
    <section
      style={{
        border: "1px solid #ddd",
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
        background: "#fafafa",
      }}
    >
      {reasonText ? (
        <div
          style={{
            fontWeight: 700,
            marginBottom: changeText || bonusText ? 6 : 0,
          }}
        >
          {reasonText}
        </div>
      ) : null}

      {changeText ? (
        <div style={{ marginBottom: bonusText ? 6 : 0 }}>{changeText}</div>
      ) : null}

      {bonusText ? <div>{bonusText}</div> : null}
    </section>
  );
}