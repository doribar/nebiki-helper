import { normalizeDemandCycle } from "./demandCycle.ts";
import {
  getReview19SourceUpdatedAt,
  normalizeReview19Result,
} from "./review19.ts";
import type { DemandCycle, Review19Result } from "./types.ts";

export const REVIEW19_PENDING_REFERENCE_KIND = "review19_ref_v1" as const;

/**
 * A durable Review19 outbox entry points at an existing local source instead
 * of duplicating its rich snapshot/daySnapshot payload in localStorage.
 */
export type Review19PendingReferenceV1 = {
  kind: typeof REVIEW19_PENDING_REFERENCE_KIND;
  date: string;
  demandCycle: DemandCycle;
  sessionStartedAt: string;
  sourceUpdatedAt: string;
  recordedAt: string | null;
  complete: boolean;
};

type Review19Revision = Omit<Review19PendingReferenceV1, "kind">;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function cloneRecord(record: Review19Result): Review19Result {
  return JSON.parse(JSON.stringify(record)) as Review19Result;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  if (!isObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalizeJsonValue(value[key]);
      return result;
    }, {});
}

function areNormalizedRecordsEqual(
  first: Review19Result,
  second: Review19Result,
): boolean {
  return JSON.stringify(canonicalizeJsonValue(first)) ===
    JSON.stringify(canonicalizeJsonValue(second));
}

export function getReview19PendingBusinessIdentity(
  record: Pick<Review19Result, "date" | "demandCycle">,
): string {
  return JSON.stringify([record.date, normalizeDemandCycle(record.demandCycle)]);
}

function buildRevisionFromRecord(
  record: Review19Result,
): Review19Revision | null {
  const normalized = normalizeReview19Result(record);
  if (!normalized || normalized.review19Status !== "recorded") return null;
  const sourceUpdatedAt = getReview19SourceUpdatedAt(normalized);
  if (
    !isValidDate(normalized.date) ||
    !isValidTimestamp(normalized.sessionStartedAt) ||
    !isValidTimestamp(sourceUpdatedAt)
  ) {
    return null;
  }
  const recordedAt = isValidTimestamp(normalized.recordedAt)
    ? normalized.recordedAt
    : null;
  return {
    date: normalized.date,
    demandCycle: normalizeDemandCycle(normalized.demandCycle),
    sessionStartedAt: normalized.sessionStartedAt,
    sourceUpdatedAt,
    recordedAt,
    complete: normalized.dataQuality.complete,
  };
}

export function buildReview19PendingReference(
  record: Review19Result,
): Review19PendingReferenceV1 | null {
  const revision = buildRevisionFromRecord(record);
  return revision
    ? { kind: REVIEW19_PENDING_REFERENCE_KIND, ...revision }
    : null;
}

export function normalizeReview19PendingReference(
  value: unknown,
): Review19PendingReferenceV1 | null {
  if (!isObject(value) || value.kind !== REVIEW19_PENDING_REFERENCE_KIND) {
    return null;
  }
  if (
    !isValidDate(value.date) ||
    (value.demandCycle !== "normal" && value.demandCycle !== "summer") ||
    !isValidTimestamp(value.sessionStartedAt) ||
    !isValidTimestamp(value.sourceUpdatedAt) ||
    !(
      value.recordedAt === null ||
      isValidTimestamp(value.recordedAt)
    ) ||
    typeof value.complete !== "boolean"
  ) {
    return null;
  }
  return {
    kind: REVIEW19_PENDING_REFERENCE_KIND,
    date: value.date,
    demandCycle: value.demandCycle,
    sessionStartedAt: value.sessionStartedAt,
    sourceUpdatedAt: value.sourceUpdatedAt,
    recordedAt: value.recordedAt,
    complete: value.complete,
  };
}

export function normalizeLegacyReview19PendingPayload(
  value: unknown,
): Review19Result | null {
  if (normalizeReview19PendingReference(value)) return null;
  const normalized = normalizeReview19Result(
    value as Partial<Review19Result> | null | undefined,
  );
  return normalized?.review19Status === "recorded" ? normalized : null;
}

function getRevisionFromPendingPayload(value: unknown): Review19Revision | null {
  const reference = normalizeReview19PendingReference(value);
  if (reference) {
    return {
      date: reference.date,
      demandCycle: reference.demandCycle,
      sessionStartedAt: reference.sessionStartedAt,
      sourceUpdatedAt: reference.sourceUpdatedAt,
      recordedAt: reference.recordedAt,
      complete: reference.complete,
    };
  }
  const legacy = normalizeLegacyReview19PendingPayload(value);
  return legacy ? buildRevisionFromRecord(legacy) : null;
}

function isFinal(revision: Review19Revision): boolean {
  return revision.recordedAt !== null;
}

function canRevisionSupersede(
  current: Review19Revision,
  incoming: Review19Revision,
): boolean {
  if (isFinal(current) && !isFinal(incoming)) return false;
  const currentTime = Date.parse(current.sourceUpdatedAt);
  const incomingTime = Date.parse(incoming.sourceUpdatedAt);
  return Number.isFinite(incomingTime) &&
    (!Number.isFinite(currentTime) || incomingTime > currentTime);
}

export function shouldReplaceReview19PendingPayload(
  currentPayload: unknown,
  incomingRecord: Review19Result,
): boolean {
  const current = getRevisionFromPendingPayload(currentPayload);
  const incoming = buildRevisionFromRecord(incomingRecord);
  if (!incoming) return false;
  if (!current) return true;
  if (
    getReview19PendingBusinessIdentity(current) !==
    getReview19PendingBusinessIdentity(incoming)
  ) {
    return false;
  }
  return canRevisionSupersede(current, incoming);
}

function candidateCoversReference(
  candidate: Review19Revision,
  reference: Review19PendingReferenceV1,
): boolean {
  if (
    getReview19PendingBusinessIdentity(candidate) !==
    getReview19PendingBusinessIdentity(reference)
  ) {
    return false;
  }
  if (reference.recordedAt !== null && candidate.recordedAt === null) {
    return false;
  }
  if (reference.complete && !candidate.complete) return false;
  return Date.parse(candidate.sourceUpdatedAt) >=
    Date.parse(reference.sourceUpdatedAt);
}

function compareResolutionCandidates(
  first: { revision: Review19Revision; record: Review19Result },
  second: { revision: Review19Revision; record: Review19Result },
  reference: Review19PendingReferenceV1,
): number {
  const firstFinal = Number(isFinal(first.revision));
  const secondFinal = Number(isFinal(second.revision));
  if (firstFinal !== secondFinal) return secondFinal - firstFinal;

  // Once finality is equal, sourceUpdatedAt is the Review19 CAS revision.
  // Completeness must not make an older partial win over a newer correction.
  const timestampCompare =
    Date.parse(second.revision.sourceUpdatedAt) -
    Date.parse(first.revision.sourceUpdatedAt);
  if (timestampCompare !== 0) return timestampCompare;

  const firstComplete = Number(first.revision.complete);
  const secondComplete = Number(second.revision.complete);
  if (firstComplete !== secondComplete) return secondComplete - firstComplete;

  const firstExact = Number(
    first.revision.sessionStartedAt === reference.sessionStartedAt,
  );
  const secondExact = Number(
    second.revision.sessionStartedAt === reference.sessionStartedAt,
  );
  return secondExact - firstExact;
}

/**
 * Resolves a reference only from caller-provided local sources. It never
 * fabricates a record from identity metadata and never accepts an older
 * revision. A newer final source may satisfy an older partial reference.
 */
export function resolveReview19PendingReference(
  referenceValue: unknown,
  sources: readonly (Review19Result | null | undefined)[],
): Review19Result | null {
  const reference = normalizeReview19PendingReference(referenceValue);
  if (!reference) return null;

  const candidates = sources.flatMap((source) => {
    if (!source) return [];
    const normalized = normalizeReview19Result(source);
    if (!normalized || normalized.review19Status !== "recorded") return [];
    const revision = buildRevisionFromRecord(normalized);
    if (!revision || !candidateCoversReference(revision, reference)) return [];
    return [{ revision, record: normalized }];
  });
  candidates.sort((first, second) =>
    compareResolutionCandidates(first, second, reference)
  );
  return candidates[0] ? cloneRecord(candidates[0].record) : null;
}

/** Returns true only when the sent authoritative revision safely covers an outbox item. */
export function isReview19PendingPayloadCoveredByRecord(
  pendingPayload: unknown,
  sentRecord: Review19Result,
): boolean {
  const sent = buildRevisionFromRecord(sentRecord);
  const pending = getRevisionFromPendingPayload(pendingPayload);
  if (!sent || !pending) return false;
  if (
    getReview19PendingBusinessIdentity(sent) !==
    getReview19PendingBusinessIdentity(pending)
  ) {
    return false;
  }
  if (isFinal(pending) && !isFinal(sent)) return false;
  if (pending.complete && !sent.complete) return false;

  const sentTime = Date.parse(sent.sourceUpdatedAt);
  const pendingTime = Date.parse(pending.sourceUpdatedAt);
  if (sentTime > pendingTime) return true;
  if (sentTime < pendingTime) return false;

  const reference = normalizeReview19PendingReference(pendingPayload);
  if (reference) {
    return sent.sessionStartedAt === reference.sessionStartedAt;
  }
  const legacy = normalizeLegacyReview19PendingPayload(pendingPayload);
  const normalizedSent = normalizeReview19Result(sentRecord);
  return Boolean(
    legacy &&
      normalizedSent &&
      (
        areNormalizedRecordsEqual(legacy, normalizedSent) ||
        (
          !isFinal(pending) &&
          isFinal(sent) &&
          sent.sessionStartedAt === pending.sessionStartedAt
        )
      ),
  );
}
