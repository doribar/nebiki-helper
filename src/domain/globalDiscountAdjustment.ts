import type {
  GlobalDiscountAdjustmentPercent,
  RateDisplayData,
  RateLine,
} from "./types.ts";
import {
  attemptStorageOperation,
  type StorageOperationResult,
} from "./storage.ts";

export const GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS = {
  production: "nebiki-helper/global-discount-adjustment-v1",
  fixedTime: "nebiki-helper/fixed-time-global-discount-adjustment-v1",
} as const;

export type GlobalDiscountAdjustmentState = {
  version: 1;
  date: string;
  adjustmentPercent: GlobalDiscountAdjustmentPercent;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isGlobalDiscountAdjustmentPercent(
  value: unknown,
): value is GlobalDiscountAdjustmentPercent {
  return value === -5 || value === 0 || value === 5;
}

export function normalizeGlobalDiscountAdjustmentPercent(
  value: unknown,
): GlobalDiscountAdjustmentPercent {
  return isGlobalDiscountAdjustmentPercent(value) ? value : 0;
}

export function normalizeGlobalDiscountAdjustmentState(
  raw: unknown,
  date: string,
): GlobalDiscountAdjustmentState {
  if (
    raw &&
    typeof raw === "object" &&
    (raw as { version?: unknown }).version === 1 &&
    (raw as { date?: unknown }).date === date &&
    isGlobalDiscountAdjustmentPercent(
      (raw as { adjustmentPercent?: unknown }).adjustmentPercent,
    )
  ) {
    return {
      version: 1,
      date,
      adjustmentPercent: (
        raw as { adjustmentPercent: GlobalDiscountAdjustmentPercent }
      ).adjustmentPercent,
    };
  }

  return { version: 1, date, adjustmentPercent: 0 };
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  return typeof localStorage === "undefined" ? null : localStorage;
}

/**
 * 前営業日の選択を継承しない。保存値の日付が要求日と違う場合は必ず0を返す。
 * read自体が利用できない環境も、業務開始を止めず0へ安全にfallbackする。
 */
export function loadGlobalDiscountAdjustmentState(params: {
  date: string;
  fixedTime: boolean;
  storage?: StorageLike;
}): GlobalDiscountAdjustmentState {
  if (!DATE_PATTERN.test(params.date)) {
    return { version: 1, date: params.date, adjustmentPercent: 0 };
  }
  const storage = resolveStorage(params.storage);
  if (!storage) {
    return { version: 1, date: params.date, adjustmentPercent: 0 };
  }

  try {
    const key = params.fixedTime
      ? GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS.fixedTime
      : GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS.production;
    const raw = storage.getItem(key);
    return normalizeGlobalDiscountAdjustmentState(
      raw ? (JSON.parse(raw) as unknown) : null,
      params.date,
    );
  } catch {
    return { version: 1, date: params.date, adjustmentPercent: 0 };
  }
}

/** raw writeはshared storage safety boundaryから呼ぶ。 */
export function saveGlobalDiscountAdjustmentState(params: {
  state: GlobalDiscountAdjustmentState;
  fixedTime: boolean;
  storage?: StorageLike;
}): StorageOperationResult {
  const storage = resolveStorage(params.storage);
  const key = params.fixedTime
    ? GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS.fixedTime
    : GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS.production;
  if (!storage) {
    return {
      ok: false,
      key,
      operation: "set",
      errorName: "StorageUnavailableError",
      quotaExceeded: false,
    };
  }
  const state = normalizeGlobalDiscountAdjustmentState(
    params.state,
    params.state.date,
  );
  return attemptStorageOperation({
    key,
    operation: "set",
    run: () => storage.setItem(key, JSON.stringify(state)),
  });
}

export function selectGlobalDiscountAdjustmentForDate(
  state: GlobalDiscountAdjustmentState,
  date: string,
): GlobalDiscountAdjustmentPercent {
  return state.date === date
    ? normalizeGlobalDiscountAdjustmentPercent(state.adjustmentPercent)
    : 0;
}

export function applyGlobalDiscountAdjustmentToRate(
  baseRatePercent: number,
  adjustmentPercent: GlobalDiscountAdjustmentPercent,
): number {
  return Math.max(0, Math.min(50, baseRatePercent + adjustmentPercent));
}

function applyAdjustmentToText(
  text: string,
  adjustmentPercent: GlobalDiscountAdjustmentPercent,
): string {
  return text.replace(/(\d+(?:\.\d+)?)%/g, (match, valueText: string) => {
    const value = Number(valueText);
    return Number.isFinite(value)
      ? `${applyGlobalDiscountAdjustmentToRate(value, adjustmentPercent)}%`
      : match;
  });
}

function applyAdjustmentToLine(
  line: RateLine,
  adjustmentPercent: GlobalDiscountAdjustmentPercent,
): RateLine {
  const baseIsNoDiscount = line.main.trim() === "引かない";
  const adjustedNoDiscountRate = applyGlobalDiscountAdjustmentToRate(
    0,
    adjustmentPercent,
  );
  return {
    main:
      baseIsNoDiscount && adjustedNoDiscountRate > 0
        ? `${adjustedNoDiscountRate}%`
        : applyAdjustmentToText(line.main, adjustmentPercent),
    ...(line.note
      ? { note: applyAdjustmentToText(line.note, adjustmentPercent) }
      : {}),
  };
}

/**
 * 曜日・残数・天候・時刻補正まで終えた通常表示へ、最後に一度だけ適用する。
 * 20時台のfinal guideはこの関数へ渡さず、既存のforced ruleをそのまま使う。
 */
export function applyGlobalDiscountAdjustmentToDisplay(
  baseDisplay: RateDisplayData,
  adjustmentPercent: GlobalDiscountAdjustmentPercent,
): RateDisplayData {
  if (adjustmentPercent === 0) {
    return {
      many: { ...baseDisplay.many },
      normal: { ...baseDisplay.normal },
      few: { ...baseDisplay.few },
    };
  }
  return {
    many: applyAdjustmentToLine(baseDisplay.many, adjustmentPercent),
    normal: applyAdjustmentToLine(baseDisplay.normal, adjustmentPercent),
    few: applyAdjustmentToLine(baseDisplay.few, adjustmentPercent),
  };
}

export function formatGlobalDiscountAdjustment(
  adjustmentPercent: GlobalDiscountAdjustmentPercent,
): string {
  if (adjustmentPercent > 0) return `+${adjustmentPercent}%`;
  if (adjustmentPercent < 0) return `${adjustmentPercent}%`;
  return "なし";
}
