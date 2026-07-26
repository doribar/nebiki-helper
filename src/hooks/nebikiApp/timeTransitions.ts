import { NORMAL_ROUTE } from "../../domain/area.ts";
import type {
  AppState,
  AreaId,
  AreaProgress,
  DiscountTime,
  NextSessionSkipRecord,
  ScreenName,
  SessionData,
} from "../../domain/types.ts";
import { getBasisTimeText } from "./clock.ts";
import {
  createInitialAreaProgressMap,
  isValidAreaId,
  normalizeNormalFlowOrder,
} from "./stateNormalization.ts";

export function getWeekdayText(weekday: number): string {
  const map = ["日", "月", "火", "水", "木", "金", "土"];
  return `${map[weekday] ?? ""}曜日`;
}

export function getNextSkipTargetDiscountTime(
  discountTime: DiscountTime
): "18" | "19" | null {
  if (discountTime === "17") return "18";
  if (discountTime === "18") return "19";
  return null;
}

export function createAreaProgressMapWithAutoSkippedAreas(
  skippedRecords: NextSessionSkipRecord[]
): Record<AreaId, AreaProgress> {
  const base = createInitialAreaProgressMap();

  for (const record of skippedRecords) {
    if (!isValidAreaId(record.areaId) || !base[record.areaId]) continue;

    base[record.areaId] = {
      ...base[record.areaId],
      status: "auto_skipped_late_time",
      skipReason: "late_time",
      previousRateText: record.previousRateText,
      previousManyRateText: record.previousManyRateText,
      previousNormalRateText: record.previousNormalRateText,
      autoSkipKind: record.skipKind ?? "late_plus5",
      sourceDiscountTime: record.sourceDiscountTime,
      sourceSessionStartedAt: record.sourceSessionStartedAt,
      earlyDiscountCompletedAt: record.earlyDiscountCompletedAt,
      rateOrigin: "carried_from_early_discount",
    };
  }

  return base;
}

function isPreviousTimeUnfinished(progress: AreaProgress | undefined): boolean {
  if (!progress) return false;

  switch (progress.status) {
    case "unstarted":
    case "skipped_manual":
    case "postponed_few":
      return true;
    case "completed":
    case "auto_skipped_late_time":
      return false;
  }
}

export function createTimeSwitchPlan(params: {
  previousMap: Record<AreaId, AreaProgress>;
  skippedRecords: NextSessionSkipRecord[];
  targetDiscountTime: DiscountTime;
  completedAt?: string;
}): {
  areaProgressMap: Record<AreaId, AreaProgress>;
  normalFlowOrder: AreaId[];
} {
  const areaProgressMap = createInitialAreaProgressMap();
  const unfinishedAreaIds = params.targetDiscountTime === "20"
    ? []
    : NORMAL_ROUTE.filter((areaId) => isPreviousTimeUnfinished(params.previousMap[areaId]));
  const normalFlowOrder = normalizeNormalFlowOrder([
    ...unfinishedAreaIds,
    ...NORMAL_ROUTE,
  ]);

  const markAutoSkipped = (record: NextSessionSkipRecord) => {
    if (
      record.skipKind !== "early_next_minus5" ||
      !isValidAreaId(record.areaId) ||
      !areaProgressMap[record.areaId]
    ) {
      return;
    }

    areaProgressMap[record.areaId] = {
      ...areaProgressMap[record.areaId],
      status: "auto_skipped_late_time",
      skipReason: "late_time",
      previousRateText: record.previousRateText,
      previousManyRateText: record.previousManyRateText,
      previousNormalRateText: record.previousNormalRateText,
      autoSkipKind: "early_next_minus5",
      sourceDiscountTime: record.sourceDiscountTime,
      sourceSessionStartedAt: record.sourceSessionStartedAt,
      earlyDiscountCompletedAt: record.earlyDiscountCompletedAt,
      rateOrigin: "carried_from_early_discount",
    };
  };

  for (const record of params.skippedRecords) {
    markAutoSkipped(record);
  }

  return { areaProgressMap, normalFlowOrder };
}

export function buildAutoTimeSwitchDialogText(params: {
  from: DiscountTime;
  to: DiscountTime;
  prioritizeUnfinishedAreas: boolean;
}): string {
  const transitionText =
    params.to === "20"
      ? `次の値引時刻に近づいたため、${getBasisTimeText(params.to)}の最終値引に移行します。`
      : `次の値引時刻に近づいたため、${getBasisTimeText(params.to)}の値引に移行します。`;

  if (!params.prioritizeUnfinishedAreas || params.to === "20") {
    return transitionText;
  }

  return `${transitionText}\n${getBasisTimeText(params.from)}の値引で未完了のエリアから先に表示されます。`;
}

export function shouldPrioritizeUnfinishedAreasOnAutoTransition(screen: ScreenName): boolean {
  return (
    screen === "area_judge" ||
    screen === "rate_display" ||
    screen === "auto_skip_notice" ||
    screen === "auto_skip_count"
  );
}

export function finalizeUnmeasuredAreasForAutoTransition(
  state: AppState,
  finalizedAt: string,
): AppState {
  const areaProgressMap = (state.normalFlowOrder ?? NORMAL_ROUTE).reduce((acc, areaId) => {
    const progress = acc[areaId];
    if (!progress || typeof progress.areaCount === "number") {
      if (progress && typeof progress.areaCount === "number") {
        acc[areaId] = {
          ...progress,
          measurementStatus: "measured",
          missingReason: undefined,
          measurementRecordedAt: progress.measurementRecordedAt ?? progress.visitedAt,
        };
      }
      return acc;
    }
    if (progress.measurementStatus === "not_measured") return acc;

    acc[areaId] = {
      ...progress,
      measurementStatus: "not_measured",
      missingReason: "auto_time_transition",
      skipAcknowledgedAt: progress.skipAcknowledgedAt ?? finalizedAt,
    };
    return acc;
  }, { ...state.areaProgressMap });

  return {
    ...state,
    areaProgressMap,
  };
}

export function getFirstAvailableAreaId(
  areaProgressMap: Record<AreaId, AreaProgress>,
  normalFlowOrder: readonly AreaId[] = NORMAL_ROUTE
): AreaId | null {
  return normalFlowOrder.find((areaId) => areaProgressMap[areaId]?.status === "unstarted") ?? null;
}

export function refreshSessionDiscountTime(session: SessionData | null): {
  nextSession: SessionData | null;
  timeSwitchNotice: string | null;
} {
  // 実時間が次の値引帯に入っても、自動で打ち切り・移動しない。
  // 必要な場合はユーザーが開始画面から値引時刻を選び直す。
  return {
    nextSession: session,
    timeSwitchNotice: null,
  };
}
