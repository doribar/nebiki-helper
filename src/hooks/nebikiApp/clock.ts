import type {
  AppState,
  DiscountTime,
  DoneNextSessionInfo,
  Review19Result,
} from "../../domain/types";

let runtimeNowOverrideMs: number | null = null;

export function setRuntimeNowOverride(date?: Date | null): void {
  runtimeNowOverrideMs = date ? date.getTime() : null;
}

export function getRuntimeNow(): Date {
  return runtimeNowOverrideMs === null
    ? new Date()
    : new Date(runtimeNowOverrideMs);
}

export function getRuntimeNowMs(): number {
  return runtimeNowOverrideMs === null ? Date.now() : runtimeNowOverrideMs;
}

/** 毎分00秒・30秒までの時間。境界ちょうどなら次の境界を予約する。 */
export function getNextAlignedRuntimeClockDelayMs(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return 30000;
  const elapsedMs = ((nowMs % 30000) + 30000) % 30000;
  return 30000 - elapsedMs;
}

/** 表示時計だけを更新し、毎回実時計から次の00秒・30秒を予約し直す。 */
export function startAlignedRuntimeClock(
  onUpdate: (nowMs: number) => void,
  getNowMs: () => number = getRuntimeNowMs,
): () => void {
  let timeoutId: number | undefined;
  let generation = 0;
  let disposed = false;

  const cancelPending = () => {
    generation += 1;
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    timeoutId = undefined;
  };

  const refresh = () => {
    if (disposed) return;
    cancelPending();
    onUpdate(getNowMs());
    if (disposed) return;
    const scheduledGeneration = generation;
    const delayMs = getNextAlignedRuntimeClockDelayMs(getNowMs());
    timeoutId = window.setTimeout(() => {
      if (disposed || scheduledGeneration !== generation) return;
      timeoutId = undefined;
      refresh();
    }, delayMs);
  };

  const onVisibilityChange = () => {
    if (!document.hidden) refresh();
  };
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", onVisibilityChange);
  refresh();

  return () => {
    disposed = true;
    cancelPending();
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

export function formatLocalDate(date = getRuntimeNow()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveDiscountTime(date = getRuntimeNow()): DiscountTime {
  const minutes = date.getHours() * 60 + date.getMinutes();

  // 通常の新規値引は15時・17時だけ。冷惣菜の開始準備に合わせて20分前に切り替える。
  return minutes < 16 * 60 + 40 ? "15" : "17";
}

export function getBasisTimeText(discountTime: DiscountTime): string {
  switch (discountTime) {
    case "15":
      return "15時";
    case "17":
      return "17時";
    case "18":
      return "18時30分";
    case "19":
      return "19時30分";
    case "20":
      return "20時30分";
  }
}

export function getNextDoneDiscountInfo(
  discountTime: DiscountTime,
  now: Date,
): DoneNextSessionInfo | null {
  const minutes = now.getHours() * 60 + now.getMinutes();

  const infoByTime: Partial<
    Record<
      DiscountTime,
      {
        label: string;
        unlockMinutes: number;
        unlockText: string;
        targetDiscountTime: DiscountTime;
      }
    >
  > = {
    "15": {
      label: "17時の値引に進む",
      unlockMinutes: 16 * 60 + 40,
      unlockText: "16:40からタップできます",
      targetDiscountTime: "17",
    },
  };

  const info = infoByTime[discountTime];
  if (!info) return null;

  return {
    label: info.label,
    canStart: minutes >= info.unlockMinutes,
    unlockText: minutes >= info.unlockMinutes ? null : info.unlockText,
    targetDiscountTime: info.targetDiscountTime,
  };
}

export function canStartReview19FromCurrentState(params: {
  state: AppState;
  now: Date;
  records?: Review19Result[];
}): boolean {
  const { state, now } = params;

  const currentDate = formatLocalDate(now);
  if (state.review19?.date === currentDate && state.review19.recordedAt) {
    return false;
  }
  if (
    params.records?.some(
      (record) => record.date === currentDate && Boolean(record.recordedAt),
    )
  ) {
    return false;
  }

  return true;
}

export function buildTimeSwitchNotice(to: DiscountTime): string {
  if (to === "20") {
    return "20時30分を過ぎたため、19時30分の値引を打ち切り、20時30分の最終値引を開始します。";
  }

  if (to === "19") {
    return "19時30分を過ぎたため、18時30分の値引を打ち切り、19時30分の値引を開始します。";
  }

  if (to === "18") {
    return "18時30分を過ぎたため、17時の値引を打ち切り、18時30分の値引を開始します。";
  }

  return `現在時刻が${getBasisTimeText(
    to,
  )}を過ぎたため、ここから${getBasisTimeText(to)}の基準で表示します。`;
}
