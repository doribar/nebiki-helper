import { createElement, type CSSProperties } from "react";

export const DAY_BEFORE_HOLIDAY_NOTICE_TEXT =
  "ただし明日は祝日なので、夜の来客を考慮した上で判断してください。";

const noticeStyle: CSSProperties = {
  margin: "0 0 14px",
  padding: "10px 12px",
  border: "2px solid #b45309",
  borderRadius: 10,
  background: "#fff7ed",
  color: "#7c2d12",
  fontSize: 14,
  lineHeight: 1.6,
};

export function DayBeforeHolidayNotice({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return createElement(
    "aside",
    {
      role: "note",
      "aria-label": "祝前日の注意",
      style: noticeStyle,
    },
    createElement("strong", null, DAY_BEFORE_HOLIDAY_NOTICE_TEXT),
  );
}
