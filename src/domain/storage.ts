import type { AppState, AreaId, NextSessionSkipRecord } from "./types";

export const STORAGE_KEYS = {
  currentSession: "nebiki-helper/current-session",
  nextSessionSkipRecords: "nebiki-helper/next-session-skip-records",
} as const;

function safeParseJSON<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function loadCurrentSession(): AppState | null {
  const raw = localStorage.getItem(STORAGE_KEYS.currentSession);
  return safeParseJSON<AppState | null>(raw, null);
}

export function saveCurrentSession(state: AppState): void {
  localStorage.setItem(STORAGE_KEYS.currentSession, JSON.stringify(state));
}

export function clearCurrentSession(): void {
  localStorage.removeItem(STORAGE_KEYS.currentSession);
}

export function loadNextSessionSkipRecords(): NextSessionSkipRecord[] {
  const raw = localStorage.getItem(STORAGE_KEYS.nextSessionSkipRecords);
  return safeParseJSON<NextSessionSkipRecord[]>(raw, []);
}

export function saveNextSessionSkipRecords(records: NextSessionSkipRecord[]): void {
  localStorage.setItem(
    STORAGE_KEYS.nextSessionSkipRecords,
    JSON.stringify(records)
  );
}

export function appendNextSessionSkipRecords(
  recordsToAdd: NextSessionSkipRecord[]
): void {
  if (recordsToAdd.length === 0) return;

  const current = loadNextSessionSkipRecords();
  const merged = [...current];

  for (const record of recordsToAdd) {
    const exists = merged.some(
      (r) =>
        r.date === record.date &&
        r.targetDiscountTime === record.targetDiscountTime &&
        r.areaId === record.areaId
    );

    if (!exists) {
      merged.push(record);
    }
  }

  saveNextSessionSkipRecords(merged);
}

export function consumeNextSessionSkipAreaIds(params: {
  date: string;
  targetDiscountTime: "18" | "19";
}): AreaId[] {
  const current = loadNextSessionSkipRecords();

  const matched = current.filter(
    (r) =>
      r.date === params.date &&
      r.targetDiscountTime === params.targetDiscountTime
  );

  const remaining = current.filter(
    (r) =>
      !(
        r.date === params.date &&
        r.targetDiscountTime === params.targetDiscountTime
      )
  );

  saveNextSessionSkipRecords(remaining);

  return matched.map((r) => r.areaId);
}