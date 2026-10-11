import type {
  AppState,
  DailySessionSnapshot,
  DoneSummaryItem,
  RetiredNightOperationEvidence,
  SessionDraft,
} from "../../domain/types.ts";
import type { PersistedRuntimeState } from "../../domain/storage.ts";
import { mergeRetiredNightOperationEvidence } from "../../domain/retiredNightEvidence.ts";
import { getAreaName, getAreaRouteFromStoredIds } from "../../domain/area.ts";
import { createInitialState } from "./stateNormalization.ts";
import { resolveDiscountTime } from "./clock.ts";

export type CollectedRetiredNightOperation = {
  identity: string;
  /** The current operation is preferred; every recovery variant is retained. */
  state: AppState;
  evidence: RetiredNightOperationEvidence[];
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function operationIdentity(state: AppState): string | null {
  if (!state.session) return null;
  return JSON.stringify([
    state.session.date,
    state.session.discountTime,
    state.session.startedAt,
  ]);
}

export function hasRetiredNightSession(state: AppState | null | undefined): boolean {
  const time = state?.session?.discountTime;
  return time === "18" || time === "19" || time === "20";
}

/** Review19 uses the same historical time type but remains a live workflow. */
export function isRetiredNightDiscountOperation(state: AppState | null | undefined): boolean {
  return hasRetiredNightSession(state) && !state?.screen.startsWith("review19");
}

/** Read before date cleanup or normalization. No persisted evidence is mutated. */
export function collectRetiredNightOperations(params: {
  currentSession: AppState | null;
  workSessionCheckpoint: AppState | null;
  runtimeState: PersistedRuntimeState | null;
  review19SourceState?: AppState | null;
}): CollectedRetiredNightOperation[] {
  const candidates: Array<{ source: RetiredNightOperationEvidence["source"]; state: AppState | null }> = [
    { source: "current_session", state: params.currentSession },
    { source: "work_session_checkpoint", state: params.workSessionCheckpoint },
    { source: "review19_source", state: params.review19SourceState ?? null },
    { source: "undo", state: params.runtimeState?.undoSnapshot?.state ?? null },
    ...(params.runtimeState?.screenHistory ?? []).map((entry) => ({
      source: "history" as const,
      state: entry.state,
    })),
  ];
  const byIdentity = new Map<string, CollectedRetiredNightOperation>();
  for (const candidate of candidates) {
    if (!candidate.state || !isRetiredNightDiscountOperation(candidate.state)) continue;
    const identity = operationIdentity(candidate.state);
    if (!identity) continue;
    const evidence = { source: candidate.source, state: clone(candidate.state) };
    const operation = byIdentity.get(identity);
    if (!operation) {
      byIdentity.set(identity, {
        identity,
        state: clone(candidate.state),
        evidence: [evidence],
      });
    } else if (!operation.evidence.some((stored) => JSON.stringify(stored) === JSON.stringify(evidence))) {
      operation.evidence.push(evidence);
    }
  }
  return [...byIdentity.values()];
}

/** UI isolation only. The caller must archive and verify before saving this reset. */
export function retireNightOperationalState(state: AppState, safeDraft: SessionDraft): AppState {
  if (!isRetiredNightDiscountOperation(state)) return state;
  return createInitialState({
    ...clone(safeDraft),
    discountTime: safeDraft.discountTime === "15" || safeDraft.discountTime === "17"
      ? safeDraft.discountTime
      : resolveDiscountTime(),
    manualDiscountTimeOverride: false,
    weatherInputLockedDiscountTime: null,
  });
}

/** Only persisted confirmed text is eligible; no current-rate fallback is used. */
export function buildRetiredNightDoneSummaryItems(state: AppState): DoneSummaryItem[] {
  return getAreaRouteFromStoredIds(
    state.session?.date ?? state.sessionDraft.date,
    state.normalFlowOrder ?? Object.keys(state.areaProgressMap),
  ).map((areaId) => {
    const progress = state.areaProgressMap[areaId];
    const decision = progress?.rateDecisionSnapshot;
    const rateText = decision?.displayedRateText ?? progress?.completedRateText ?? "未記録";
    return {
      areaId,
      areaName: getAreaName(areaId),
      judgeText: progress?.areaJudge === "many" ? "多い"
        : progress?.areaJudge === "normal" ? "普通"
        : progress?.areaJudge === "few" ? "少ない" : "未記録",
      rateText,
      manyRateText: decision
        ? `${decision.displayedManyRatePercent}%` : progress?.completedManyRateText,
      normalRateText: decision?.displayedRateText ?? progress?.completedNormalRateText,
      statusText: progress?.status === "completed" ? undefined : "未完了",
    };
  });
}

/**
 * Preserve an existing capture verbatim and attach original recovery states.
 * A fallback comes from the existing snapshot builder, but its newly derived
 * session basis is explicitly unavailable as a historical adopted decision.
 * This helper never calculates rates, normalizes old evidence, or completes it.
 */
export function buildRetiredNightSnapshot(params: {
  operation: CollectedRetiredNightOperation;
  capturedAt: string;
  existingSnapshot?: DailySessionSnapshot | null;
  fallbackSnapshot?: DailySessionSnapshot | null;
}): DailySessionSnapshot | null {
  const base = params.existingSnapshot ?? params.fallbackSnapshot;
  if (!base || JSON.stringify([
    base.session.date, base.session.discountTime, base.session.startedAt,
  ]) !== params.operation.identity) return null;
  const snapshot = clone(base);
  snapshot.retiredOperation = mergeRetiredNightOperationEvidence(snapshot.retiredOperation, {
    reason: "night_workflow_retired",
    retiredAt: params.capturedAt,
    basisCaptureStatus: params.existingSnapshot ? "preserved" : "unavailable",
    evidence: params.operation.evidence,
  });
  return snapshot;
}
