import type { AppState, AreaId, DiscountTime, ManyProductRecord } from "./types";

export const STORAGE_KEYS = {
  currentSession: "nebiki-helper/current-session",
  manyProducts: "nebiki-helper/many-products",
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

export function loadManyProducts(): ManyProductRecord[] {
  const raw = localStorage.getItem(STORAGE_KEYS.manyProducts);
  return safeParseJSON<ManyProductRecord[]>(raw, []);
}

export function saveManyProducts(records: ManyProductRecord[]): void {
  localStorage.setItem(STORAGE_KEYS.manyProducts, JSON.stringify(records));
}

export function appendManyProducts(recordsToAdd: ManyProductRecord[]): void {
  const current = loadManyProducts();
  const next = [...current, ...recordsToAdd];
  saveManyProducts(next);
}

export function clearManyProducts(): void {
  localStorage.removeItem(STORAGE_KEYS.manyProducts);
}

/**
 * 同じエリア・同じ時間帯の「直近日」の多い商品を返す
 */
export function getPreviousManyProducts(params: {
  areaId: AreaId;
  discountTime: DiscountTime;
  currentDate: string;
}): string[] {
  const records = loadManyProducts();

  const filtered = records.filter((record) => {
    return (
      record.areaId === params.areaId &&
      record.discountTime === params.discountTime &&
      record.recordedDate < params.currentDate
    );
  });

  if (filtered.length === 0) return [];

  const sorted = [...filtered].sort((a, b) =>
    b.recordedDate.localeCompare(a.recordedDate)
  );

  const latestDate = sorted[0].recordedDate;

  return sorted
    .filter((r) => r.recordedDate === latestDate)
    .map((r) => r.productName);
}