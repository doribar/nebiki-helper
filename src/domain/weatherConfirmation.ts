import type { DiscountTime, ScreenName, SessionDraft } from "./types";

export type WeatherConfirmationPending = {
  date: string;
  discountTime: DiscountTime;
};

function isDiscountTime(value: unknown): value is DiscountTime {
  return (
    value === "15" ||
    value === "17" ||
    value === "18" ||
    value === "19" ||
    value === "20"
  );
}

export function normalizeWeatherConfirmationPending(
  raw: unknown,
): WeatherConfirmationPending | null {
  if (!raw || typeof raw !== "object") return null;

  const candidate = raw as Partial<WeatherConfirmationPending>;
  if (
    typeof candidate.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date) ||
    !isDiscountTime(candidate.discountTime)
  ) {
    return null;
  }

  return {
    date: candidate.date,
    discountTime: candidate.discountTime,
  };
}

export function restoreWeatherConfirmationPending(params: {
  raw: unknown;
  screen: ScreenName | undefined;
  sessionDraft: Partial<SessionDraft> | null | undefined;
  currentDate: string;
}): WeatherConfirmationPending | null {
  const pending = normalizeWeatherConfirmationPending(params.raw);
  if (!pending || params.screen !== "start" || !params.sessionDraft) return null;
  if (pending.date !== params.currentDate) return null;
  if (
    params.sessionDraft.date !== pending.date ||
    params.sessionDraft.discountTime !== pending.discountTime
  ) {
    return null;
  }

  return pending;
}

export function matchesWeatherConfirmationDraft(params: {
  pending: WeatherConfirmationPending | null;
  screen: ScreenName;
  sessionDraft: SessionDraft;
}): boolean {
  return Boolean(
    params.pending &&
      params.screen === "start" &&
      params.pending.date === params.sessionDraft.date &&
      params.pending.discountTime === params.sessionDraft.discountTime,
  );
}
