import type { DiscountTime } from "./types.ts";

export type EarlyNextMinus5TargetDiscountTime = "18" | "19";

export function getEarlyNextMinus5TargetDiscountTime(params: {
  discountTime: DiscountTime;
  manualDiscountTimeOverride: boolean;
  nowMs: number;
}): EarlyNextMinus5TargetDiscountTime | null {
  if (params.manualDiscountTimeOverride) return null;

  const now = new Date(params.nowMs);
  const minutes = now.getHours() * 60 + now.getMinutes();

  if (
    params.discountTime === "17" &&
    minutes >= 18 * 60 &&
    minutes < 18 * 60 + 25
  ) {
    return "18";
  }

  if (
    params.discountTime === "18" &&
    minutes >= 19 * 60 &&
    minutes < 19 * 60 + 25
  ) {
    return "19";
  }

  return null;
}

export function getEarlyNextMinus5NoticeText(
  targetDiscountTime: EarlyNextMinus5TargetDiscountTime
): string {
  if (targetDiscountTime === "19") {
    return "19時を過ぎたため、19時30分の値引率より5%弱めて表示しています。\nこのエリアは19時30分値引ではスキップします。";
  }

  return "18時を過ぎたため、18時30分の値引率より5%弱めて表示しています。\nこのエリアは18時30分値引ではスキップします。";
}

export function getEarlyNextMinus5CompletedText(
  targetDiscountTime: EarlyNextMinus5TargetDiscountTime
): string {
  if (targetDiscountTime === "19") {
    return "19:00以降に、19時30分値引率より5%弱めて値引済みです。";
  }

  return "18:00以降に、18時30分値引率より5%弱めて値引済みです。";
}
export function shouldReserveEarlyNextMinus5OnAutoTransition(params: {
  screen: string;
  currentTargetDiscountTime: EarlyNextMinus5TargetDiscountTime | null;
  nextTargetDiscountTime: string;
}): boolean {
  return (
    params.screen === "rate_display" &&
    params.currentTargetDiscountTime !== null &&
    params.currentTargetDiscountTime === params.nextTargetDiscountTime
  );
}

