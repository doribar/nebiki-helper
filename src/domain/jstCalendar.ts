const JST_TIME_ZONE = "Asia/Tokyo";
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function formatJstCalendarDate(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function getPreviousCalendarDate(date: string): string | null {
  if (!CALENDAR_DATE_PATTERN.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return null;
  }

  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export function getPreviousJstCalendarDate(date: Date): string | null {
  const current = formatJstCalendarDate(date);
  return current ? getPreviousCalendarDate(current) : null;
}
