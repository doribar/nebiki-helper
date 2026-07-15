export const SYSTEM_BACK_GUARD_STATE_KEY = "__nebikiSystemBackGuard";
export const SYSTEM_BACK_GUARD_ID_KEY = "__nebikiSystemBackGuardId";
export const SYSTEM_BACK_GUARD_LEVEL_KEY = "__nebikiSystemBackGuardLevel";
export const SYSTEM_BACK_GUARD_MAX_LEVEL = 8;

export type SystemBackGuardState = {
  guardId: string;
  level: number;
};

export function createSystemBackGuardId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `nebiki-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function withSystemBackGuardState(
  state: unknown,
  guardId = "legacy",
  level = SYSTEM_BACK_GUARD_MAX_LEVEL,
): Record<string, unknown> {
  const baseState =
    state && typeof state === "object" && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : {};

  return {
    ...baseState,
    [SYSTEM_BACK_GUARD_STATE_KEY]: true,
    [SYSTEM_BACK_GUARD_ID_KEY]: guardId,
    [SYSTEM_BACK_GUARD_LEVEL_KEY]: level,
  };
}

export function readSystemBackGuardState(state: unknown): SystemBackGuardState | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;

  const record = state as Record<string, unknown>;
  if (record[SYSTEM_BACK_GUARD_STATE_KEY] !== true) return null;

  const guardId = record[SYSTEM_BACK_GUARD_ID_KEY];
  const level = record[SYSTEM_BACK_GUARD_LEVEL_KEY];
  if (typeof guardId !== "string" || typeof level !== "number" || !Number.isInteger(level)) {
    return null;
  }

  return { guardId, level };
}
