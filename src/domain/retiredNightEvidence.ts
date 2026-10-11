import type { RetiredNightOperation, RetiredNightOperationEvidence } from "./types.ts";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, stableValue(child)]));
}

/** Merge only retirement evidence; historical decisions and completion stay intact. */
export function mergeRetiredNightOperationEvidence(
  current: RetiredNightOperation | undefined,
  candidate: RetiredNightOperation | undefined,
  selectedBasisStatus?: RetiredNightOperation["basisCaptureStatus"],
): RetiredNightOperation | undefined {
  if (!current && !candidate) return undefined;
  const entries = new Map<string, RetiredNightOperationEvidence>();
  for (const entry of [...(current?.evidence ?? []), ...(candidate?.evidence ?? [])]) {
    const key = JSON.stringify(stableValue(entry));
    if (!entries.has(key)) entries.set(key, JSON.parse(JSON.stringify(entry)) as RetiredNightOperationEvidence);
  }
  const retiredAt = [current?.retiredAt, candidate?.retiredAt]
    .filter((value): value is string => typeof value === "string")
    .sort()[0];
  return {
    reason: "night_workflow_retired",
    retiredAt,
    basisCaptureStatus: selectedBasisStatus ??
      (current?.basisCaptureStatus === "preserved" || candidate?.basisCaptureStatus === "preserved"
        ? "preserved" : "unavailable"),
    evidence: [...entries].sort(([left], [right]) => left.localeCompare(right)).map(([, entry]) => entry),
  };
}
