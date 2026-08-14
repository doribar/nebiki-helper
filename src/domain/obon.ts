const OBON_RULE_MINIMUM_APP_VERSION = [2026, 8, 9, 6] as const;

function parseDateString(
  dateString: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** Every August 13 through August 16, independent of legal-holiday status. */
export function isObonDate(dateString: string): boolean {
  const parts = parseDateString(dateString);
  return Boolean(
    parts &&
      parts.month === 8 &&
      parts.day >= 13 &&
      parts.day <= 16,
  );
}

/**
 * Prevents a restored session created before the Obon rule from changing its
 * already-adopted calendar basis after an application update.
 */
export function supportsObonCalendarRule(appVersion: unknown): boolean {
  if (typeof appVersion !== "string") return false;
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})-(\d+)$/.exec(
    appVersion.trim(),
  );
  if (!match) return false;

  const parts = match.slice(1).map(Number);
  for (let index = 0; index < OBON_RULE_MINIMUM_APP_VERSION.length; index += 1) {
    const actual = parts[index] ?? 0;
    const minimum = OBON_RULE_MINIMUM_APP_VERSION[index];
    if (actual !== minimum) return actual > minimum;
  }
  return true;
}
