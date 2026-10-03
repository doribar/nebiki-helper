/** Calendar month of an ISO business date; timestamps and the local clock are never used. */
export function monthFromBusinessDate(date: string): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return undefined;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return undefined;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2
    ? leapYear ? 29 : 28
    : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day <= daysInMonth ? month : undefined;
}

export function isBusinessMonth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12;
}

/** Read/export fallback for legacy records; this does not mutate the source record. */
export function resolveBusinessMonth(record: {
  date: string;
  businessMonth?: unknown;
}): number | undefined {
  return isBusinessMonth(record.businessMonth)
    ? record.businessMonth
    : monthFromBusinessDate(record.date);
}
