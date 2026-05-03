type DateParts = {
  year: number;
  month: number;
  day: number;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseDateString(dateString: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day };
}

function formatDate(parts: DateParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toUtcDate(parts: DateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function getWeekdayFromParts(parts: DateParts): number {
  return toUtcDate(parts).getUTCDay();
}

function getWeekday(dateString: string): number | null {
  const parts = parseDateString(dateString);
  return parts ? getWeekdayFromParts(parts) : null;
}

function addDays(parts: DateParts, days: number): DateParts {
  const date = toUtcDate(parts);
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): number {
  const firstWeekday = getWeekdayFromParts({ year, month, day: 1 });
  const offset = (weekday - firstWeekday + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

function springEquinoxDay(year: number): number {
  // 1980〜2099向けの近似式。国立天文台の正式発表と完全一致しない将来年はありえる。
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnEquinoxDay(year: number): number {
  // 1980〜2099向けの近似式。国立天文台の正式発表と完全一致しない将来年はありえる。
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function buildBaseHolidaySet(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (month: number, day: number) => holidays.add(formatDate({ year, month, day }));

  add(1, 1); // 元日
  add(1, nthWeekdayOfMonth(year, 1, 1, 2)); // 成人の日
  add(2, 11); // 建国記念の日
  add(2, 23); // 天皇誕生日
  add(3, springEquinoxDay(year)); // 春分の日
  add(4, 29); // 昭和の日
  add(5, 3); // 憲法記念日
  add(5, 4); // みどりの日
  add(5, 5); // こどもの日
  add(7, nthWeekdayOfMonth(year, 7, 1, 3)); // 海の日
  add(8, 11); // 山の日
  add(9, nthWeekdayOfMonth(year, 9, 1, 3)); // 敬老の日
  add(9, autumnEquinoxDay(year)); // 秋分の日
  add(10, nthWeekdayOfMonth(year, 10, 1, 2)); // スポーツの日
  add(11, 3); // 文化の日
  add(11, 23); // 勤労感謝の日

  return holidays;
}

function buildHolidayOrObservedSet(year: number): Set<string> {
  const holidays = buildBaseHolidaySet(year);
  const baseHolidayDates = [...holidays].sort();

  for (const dateString of baseHolidayDates) {
    const parts = parseDateString(dateString);
    if (!parts) continue;
    if (getWeekdayFromParts(parts) !== 0) continue;

    let substitute = addDays(parts, 1);
    while (substitute.year === year && holidays.has(formatDate(substitute))) {
      substitute = addDays(substitute, 1);
    }
    if (substitute.year === year) {
      holidays.add(formatDate(substitute));
    }
  }

  for (let month = 1; month <= 12; month += 1) {
    const lastDay = daysInMonth(year, month);
    for (let day = 1; day <= lastDay; day += 1) {
      const current = { year, month, day };
      const currentString = formatDate(current);
      if (holidays.has(currentString)) continue;

      const previous = addDays(current, -1);
      const next = addDays(current, 1);
      if (previous.year !== year || next.year !== year) continue;
      if (holidays.has(formatDate(previous)) && holidays.has(formatDate(next))) {
        holidays.add(currentString);
      }
    }
  }

  return holidays;
}

const holidayCache = new Map<number, Set<string>>();

function getHolidaySet(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const built = buildHolidayOrObservedSet(year);
  holidayCache.set(year, built);
  return built;
}

export function addDaysToDateString(dateString: string, days: number): string {
  const parts = parseDateString(dateString);
  if (!parts) return dateString;
  return formatDate(addDays(parts, days));
}

export function isJapaneseHolidayOrObserved(dateString: string): boolean {
  const parts = parseDateString(dateString);
  if (!parts) return false;
  return getHolidaySet(parts.year).has(dateString);
}

export function isWeekendDate(dateString: string): boolean {
  const weekday = getWeekday(dateString);
  return weekday === 0 || weekday === 6;
}

export function isJapaneseHolidayOrWeekend(dateString: string): boolean {
  return isWeekendDate(dateString) || isJapaneseHolidayOrObserved(dateString);
}
