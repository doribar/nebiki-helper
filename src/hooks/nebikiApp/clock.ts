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

export function formatLocalDate(date = getRuntimeNow()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveDiscountTime(date = getRuntimeNow()): DiscountTime {
  const minutes = date.getHours() * 60 + date.getMinutes();

  // 天候入力・値引開始準備の時刻で自動切替する。
  // 15時・17時は冷惣菜値引もあるため20分前、それ以降は5分前。
  if (minutes < 16 * 60 + 40) return "15";
  if (minutes < 18 * 60 + 25) return "17";
  if (minutes < 19 * 60 + 25) return "18";
  if (minutes < 20 * 60 + 25) return "19";
  return "20";
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
    "17": {
      label: "18時30分の値引に進む",
      unlockMinutes: 18 * 60 + 25,
      unlockText: "18:25からタップできます",
      targetDiscountTime: "18",
    },
    "18": {
      label: "19時30分の値引に進む",
      unlockMinutes: 19 * 60 + 25,
      unlockText: "19:25からタップできます",
      targetDiscountTime: "19",
    },
    "19": {
      label: "20時30分の最終値引に進む",
      unlockMinutes: 20 * 60 + 25,
      unlockText: "20:25からタップできます",
      targetDiscountTime: "20",
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
