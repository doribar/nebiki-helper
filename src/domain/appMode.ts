export type AppMode = "detailed" | "simple";

export const APP_MODE_STORAGE_KEY = "nebiki-helper/app-mode-v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function isAppMode(value: unknown): value is AppMode {
  return value === "detailed" || value === "simple";
}

export function loadAppMode(storage: StorageLike | null = getBrowserStorage()): AppMode {
  if (!storage) return "detailed";

  try {
    const stored = storage.getItem(APP_MODE_STORAGE_KEY);
    return isAppMode(stored) ? stored : "detailed";
  } catch {
    return "detailed";
  }
}

export function saveAppMode(
  mode: AppMode,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  storage.setItem(APP_MODE_STORAGE_KEY, mode);
}

export function getAppModeLabel(mode: AppMode): string {
  return mode === "simple" ? "簡易モード" : "詳細モード";
}
