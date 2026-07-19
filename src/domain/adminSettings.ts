const ADMIN_PIN_HASH_KEY = "nebiki-helper/admin-pin-hash-v1";
const PIN_HASH_PREFIX = "sha256:";
const PIN_SALT = "nebiki-helper-admin-pin-v1:";

export const ADMIN_PIN_MIN_LENGTH = 4;
export const ADMIN_PIN_MAX_LENGTH = 8;

export function isValidAdminPinFormat(pin: string): boolean {
  return new RegExp(`^\\d{${ADMIN_PIN_MIN_LENGTH},${ADMIN_PIN_MAX_LENGTH}}$`).test(pin);
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasAdminPin(): boolean {
  const stored = getStorage()?.getItem(ADMIN_PIN_HASH_KEY);
  return typeof stored === "string" && stored.startsWith(PIN_HASH_PREFIX);
}

async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${PIN_SALT}${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${PIN_HASH_PREFIX}${hex}`;
}

export async function saveAdminPin(pin: string): Promise<void> {
  if (!isValidAdminPinFormat(pin)) {
    throw new Error("PINは4〜8桁の数字で設定してください。");
  }

  getStorage()?.setItem(ADMIN_PIN_HASH_KEY, await hashPin(pin));
}

export async function verifyAdminPin(pin: string): Promise<boolean> {
  const storage = getStorage();
  const stored = storage?.getItem(ADMIN_PIN_HASH_KEY);
  if (!storage || !stored) return false;

  return stored === (await hashPin(pin));
}
