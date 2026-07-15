export const SYSTEM_BACK_GUARD_STATE_KEY = "__nebikiSystemBackGuard";

export function withSystemBackGuardState(state: unknown): Record<string, unknown> {
  const baseState =
    state && typeof state === "object" && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : {};

  return {
    ...baseState,
    [SYSTEM_BACK_GUARD_STATE_KEY]: true,
  };
}
