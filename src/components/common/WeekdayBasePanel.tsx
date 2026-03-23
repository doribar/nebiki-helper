type WeekdayBasePanelProps = {
  noticeText?: string;
  reasonText?: string;
  changeText?: string;
  bonusText?: string;
};

export function WeekdayBasePanel({
  noticeText,
  reasonText,
  changeText,
  bonusText,
}: WeekdayBasePanelProps) {
  if (!noticeText && !reasonText && !changeText && !bonusText) {
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
      {noticeText ? <div style={{ marginBottom: 8 }}>{noticeText}</div> : null}
      {reasonText ? <div>{reasonText}</div> : null}
      {changeText ? <div>{changeText}</div> : null}
      {bonusText ? <div>{bonusText}</div> : null}
    </section>
  );
}