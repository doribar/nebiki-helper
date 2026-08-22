export type WeatherInputAutoAdvanceDecision = {
  isContinuationEntry: boolean;
  hasUserAdvanced: boolean;
  targetKey: string | null;
  lastScrolledTargetKey: string | null;
};

/**
 * Controls the existing visual auto-advance between hourly weather fields.
 *
 * A fresh top-screen entry intentionally leaves the initial field in place so
 * the title, app version, and demand cycle remain visible. Once the user
 * confirms a field, or when an existing resume/time-transition flow opens the
 * screen, later targets keep the existing scroll behavior.
 */
export function shouldAutoScrollWeatherInputTarget(
  decision: WeatherInputAutoAdvanceDecision,
): boolean {
  if (!decision.targetKey) return false;
  if (!decision.isContinuationEntry && !decision.hasUserAdvanced) return false;
  return decision.targetKey !== decision.lastScrolledTargetKey;
}
