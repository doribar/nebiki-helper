import { createElement, type CSSProperties } from "react";

export const DAY_BEFORE_HOLIDAY_NOTICE_TEXT =
  "明日は祝日のため、金曜日・土曜日と同じ基準になっています。";

export const THREE_DAY_HOLIDAY_MIDDLE_NOTICE_TEXT =
  "今日は三連休の中日のため、通常の日曜夜と金曜・土曜夜の中間の基準になっています。";

export const HOLIDAY_BEFORE_NORMAL_WEEKDAY_NOTICE_TEXT =
  "今日は祝日で明日は平日のため、日曜日と同じ基準になっています。";

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

export function ThreeDayHolidayMiddleNotice({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return createElement(
    "aside",
    {
      role: "note",
      "aria-label": "三連休中日の注意",
      style: noticeStyle,
    },
    createElement("strong", null, THREE_DAY_HOLIDAY_MIDDLE_NOTICE_TEXT),
  );
}

export function HolidayBeforeNormalWeekdayNotice({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return createElement(
    "aside",
    {
      role: "note",
      "aria-label": "翌日平日祝日の注意",
      style: noticeStyle,
    },
    createElement("strong", null, HOLIDAY_BEFORE_NORMAL_WEEKDAY_NOTICE_TEXT),
  );
}
