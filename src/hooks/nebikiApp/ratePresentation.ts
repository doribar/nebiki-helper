import type {
  AreaId,
  AreaJudge,
  AreaProgress,
  DiscountTime,
  GlobalDiscountAdjustmentPercent,
  NextSessionSkipRecord,
  RateDisplayData,
  ResolvedWeatherInput,
  SessionData,
} from "../../domain/types";
import { getNormalTimeRateDisplay } from "../../domain/discount";
import { resolveWeatherInputForDiscount } from "../../domain/hourlyWeather.ts";
import {
  applyGlobalDiscountAdjustmentToDisplay,
  normalizeGlobalDiscountAdjustmentPercent,
} from "../../domain/globalDiscountAdjustment.ts";

export function clampDisplayRate(value: number): number {
  return Math.max(0, Math.min(50, value));
}

function applyRateOffsetToText(text: string, offset: number): string {
  return text.replace(/(\d+)%/g, (_match, valueText: string) => {
    const value = Number(valueText);
    if (!Number.isFinite(value)) return _match;
    return `${clampDisplayRate(value + offset)}%`;
  });
}

export function applyRateOffsetToDisplay(
  display: RateDisplayData,
  offset: number,
): RateDisplayData {
  return {
    many: {
      main: applyRateOffsetToText(display.many.main, offset),
      note: display.many.note
        ? applyRateOffsetToText(display.many.note, offset)
        : undefined,
    },
    normal: {
      main: applyRateOffsetToText(display.normal.main, offset),
      note: display.normal.note
        ? applyRateOffsetToText(display.normal.note, offset)
        : undefined,
    },
    few: {
      main: applyRateOffsetToText(display.few.main, offset),
      note: display.few.note
        ? applyRateOffsetToText(display.few.note, offset)
        : undefined,
    },
  };
}

/**
 * 現在の値引率表示と完了画面の現在推奨値で共有する、純粋な表示計算。
 * 時刻境界の判定や天候解決は呼び出し側で既存ロジックを用い、
 * ここでは渡された有効時刻・補正をそのまま通常表示へ反映する。
 */
export type CurrentNormalRatePresentation = {
  /** 既存補正・先取り補正まで反映し、全体補正だけ未適用の表示。 */
  baseDisplay: RateDisplayData;
  /** 全体補正を最終段で1回だけ適用した実表示。 */
  display: RateDisplayData;
  globalDiscountAdjustmentPercent: GlobalDiscountAdjustmentPercent;
};

export function buildCurrentNormalRatePresentation(params: {
  session: SessionData | null;
  progress: AreaProgress | null | undefined;
  effectiveDiscountTime: DiscountTime | null | undefined;
  weatherBonus: number;
  ignoreTimeRateCap: boolean;
  rateOffsetPercent?: number;
}): CurrentNormalRatePresentation | null {
  const { session, progress, effectiveDiscountTime } = params;
  if (
    !session ||
    session.discountTime === "20" ||
    !progress?.areaJudge ||
    !effectiveDiscountTime ||
    effectiveDiscountTime === "20"
  ) {
    return null;
  }

  const display = getNormalTimeRateDisplay({
    discountTime: effectiveDiscountTime,
    weekday: session.weekday,
    date: session.date,
    weatherBonus: params.weatherBonus,
    areaJudge: progress.areaJudge,
    isSunday: session.weekday === 0 && effectiveDiscountTime === "15",
    ignoreTimeRateCap: params.ignoreTimeRateCap,
    areaRateAdjustment: progress.areaRateAdjustment,
  });
  const rateOffsetPercent = params.rateOffsetPercent ?? 0;

  const baseDisplay = rateOffsetPercent === 0
    ? display
    : applyRateOffsetToDisplay(display, rateOffsetPercent);
  const globalDiscountAdjustmentPercent =
    normalizeGlobalDiscountAdjustmentPercent(
      session.globalDiscountAdjustmentPercent,
    );

  return {
    baseDisplay,
    display: applyGlobalDiscountAdjustmentToDisplay(
      baseDisplay,
      globalDiscountAdjustmentPercent,
    ),
    globalDiscountAdjustmentPercent,
  };
}

export function buildCurrentNormalRateDisplay(
  params: Parameters<typeof buildCurrentNormalRatePresentation>[0],
): RateDisplayData | null {
  return buildCurrentNormalRatePresentation(params)?.display ?? null;
}

export function getAreaJudgeText(judge: AreaJudge): string {
  switch (judge) {
    case "many":
      return "多い";
    case "normal":
      return "どちらでもない";
    case "few":
      return "少ない";
    default:
      return "未判定";
  }
}

export function getAreaStatusText(
  progress: AreaProgress,
): string | undefined {
  switch (progress.status) {
    case "completed":
      return undefined;
    case "skipped_manual":
      return "未完了（スキップ中）";
    case "postponed_few":
      return "未完了（少ないため後回し）";
    case "auto_skipped_late_time":
      return progress.autoSkipKind === "early_next_minus5"
        ? "スキップ済み（先取り値引済み）"
        : "スキップ済み（前回+5%で値引済み）";
    case "unstarted":
      return "未完了";
  }
}

export type CompletedRateSnapshot = Pick<
  AreaProgress,
  "completedRateText" | "completedManyRateText" | "completedNormalRateText"
>;

export function getProgressNormalRateText(
  progress: AreaProgress,
): string | undefined {
  return progress.completedNormalRateText ?? progress.completedRateText;
}

export function getProgressManyRateText(
  progress: AreaProgress,
): string | undefined {
  return progress.completedManyRateText ?? progress.completedRateText;
}

export function shouldIgnoreNormalTimeRateCap(
  weather: ResolvedWeatherInput,
): boolean {
  if (typeof weather.precipitationRateBonus === "number") {
    return weather.precipitationRateBonus > 0;
  }

  // 旧データ互換: 以前のResolvedWeatherInputには直近1枠の雨雪だけが入っていた。
  return (
    weather.nearTermWeather === "rain" || weather.nearTermWeather === "snow"
  );
}

export function buildCompletedRateSnapshot(params: {
  session: SessionData | null;
  progress: AreaProgress;
  weatherBonus: number;
  rateDisplayOverride?: RateDisplayData | null;
}): CompletedRateSnapshot {
  const { session, progress, weatherBonus } = params;

  if (!session || session.discountTime === "20" || !progress.areaJudge) {
    return {};
  }

  const display =
    params.rateDisplayOverride ??
    (() => {
      const resolvedWeather = resolveWeatherInputForDiscount(
        session.weather,
        session.discountTime,
      );

      const baseDisplay = getNormalTimeRateDisplay({
        discountTime: session.discountTime,
        weekday: session.weekday,
        date: session.date,
        weatherBonus,
        areaJudge: progress.areaJudge,
        isSunday: session.weekday === 0 && session.discountTime === "15",
        ignoreTimeRateCap: shouldIgnoreNormalTimeRateCap(resolvedWeather),
        areaRateAdjustment: progress.areaRateAdjustment,
      });
      return applyGlobalDiscountAdjustmentToDisplay(
        baseDisplay,
        normalizeGlobalDiscountAdjustmentPercent(
          session.globalDiscountAdjustmentPercent,
        ),
      );
    })();

  return {
    completedRateText: display.normal.main,
    completedManyRateText: display.many.main,
    completedNormalRateText: display.normal.main,
  };
}

export function buildNextSessionSkipRecord(params: {
  date: string;
  targetDiscountTime: "18" | "19";
  areaId: AreaId;
  rateSnapshot: CompletedRateSnapshot;
  skipKind?: "late_plus5" | "early_next_minus5";
  sourceSession: SessionData;
  earlyDiscountCompletedAt: string;
}): NextSessionSkipRecord {
  return {
    date: params.date,
    demandCycle: params.sourceSession.demandCycle ?? "normal",
    targetDiscountTime: params.targetDiscountTime,
    areaId: params.areaId,
    previousRateText: params.rateSnapshot.completedRateText,
    previousManyRateText: params.rateSnapshot.completedManyRateText,
    previousNormalRateText: params.rateSnapshot.completedNormalRateText,
    skipKind: params.skipKind,
    sourceDiscountTime:
      params.sourceSession.discountTime === "17" ||
      params.sourceSession.discountTime === "18"
        ? params.sourceSession.discountTime
        : undefined,
    sourceSessionStartedAt: params.sourceSession.startedAt,
    earlyDiscountCompletedAt: params.earlyDiscountCompletedAt,
  };
}
