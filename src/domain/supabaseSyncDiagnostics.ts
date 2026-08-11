import type {
  PendingSupabaseSyncItem,
  SupabaseSyncItemType,
} from "./supabaseSyncQueue.ts";

export type SupabaseSyncDiagnosticDemandCycle =
  | "normal"
  | "summer"
  | "unknown";

export type PendingSupabaseSyncErrorGroup = {
  type: SupabaseSyncItemType;
  demandCycle: SupabaseSyncDiagnosticDemandCycle;
  count: number;
  errorText: string | null;
  errorPreview: string;
  isErrorTruncated: boolean;
  attemptCountMin: number;
  attemptCountMax: number;
  firstFailedAt: string | null;
  lastAttemptAt: string | null;
};

export type PendingSupabaseSyncErrorDetails = {
  pendingCount: number;
  groupedItemCount: number;
  groups: PendingSupabaseSyncErrorGroup[];
};

export type SupabaseSyncErrorCopyMetadata = {
  appVersion: string;
  buildId: string;
};

const ERROR_NOT_RECORDED_TEXT = "エラー未記録";
const DEFAULT_ERROR_PREVIEW_LENGTH = 320;
const REDACTED = "[REDACTED]";
const REDACTED_ENV_FILE = "[REDACTED_ENV_FILE]";
const REDACTED_SUPABASE_URL = "[SUPABASE_URL]";

const SENSITIVE_FIELD_NAMES = [
  "authorization",
  "proxy-authorization",
  "apikey",
  "api_key",
  "api-key",
  "x-api-key",
  "supabase_anon_key",
  "supabase-anon-key",
  "anon_key",
  "anon-key",
  "service_role_key",
  "service-role-key",
  "access_token",
  "access-token",
  "refresh_token",
  "refresh-token",
  "id_token",
  "id-token",
  "client_secret",
  "client-secret",
  "auth_token",
  "auth-token",
  "password",
  "passwd",
  "cookie",
  "set-cookie",
] as const;

const SENSITIVE_FIELD_PATTERN = SENSITIVE_FIELD_NAMES.join("|");
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  `((?:["']?)(?:${SENSITIVE_FIELD_PATTERN})(?:["']?)\\s*[:=]\\s*)` +
    `(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|(?:Bearer|Basic)\\s+[^\\s,;&}\\]]+|[^\\s,;&}\\]]+)`,
  "gi",
);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDiagnosticError(error: string | null): string | null {
  if (typeof error !== "string") return null;
  const sanitized = sanitizeSupabaseDiagnosticText(error).trim();
  return sanitized === "" ? null : sanitized;
}

/**
 * Removes credentials from text that may be shown or copied from a device.
 * PostgreSQL/PostgREST diagnostics such as status, code, constraint, column,
 * message, details, and hint remain intact.
 */
export function sanitizeSupabaseDiagnosticText(text: string): string {
  let sanitized = String(text).replace(/\r\n?/g, "\n");

  // A Cookie header can contain several semicolon-delimited credentials.
  sanitized = sanitized.replace(
    /\b((?:set-)?cookie\s*:\s*)[^\r\n]*/gi,
    `$1${REDACTED}`,
  );

  // Redact complete JSON/header/assignment values for known credential fields.
  sanitized = sanitized.replace(
    SENSITIVE_ASSIGNMENT_PATTERN,
    (_match, prefix: string) => `${prefix}${REDACTED}`,
  );

  // Catch unlabelled authorization values and Supabase key formats.
  sanitized = sanitized.replace(
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
    REDACTED,
  );
  sanitized = sanitized.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    REDACTED,
  );
  sanitized = sanitized.replace(
    /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/gi,
    REDACTED,
  );
  sanitized = sanitized.replace(
    /\b((?:https?|postgres(?:ql)?):\/\/)[^\s/@:]+:[^\s/@]+@/gi,
    `$1${REDACTED}@`,
  );

  // A project URL and dotenv filename are not needed for queue diagnosis.
  sanitized = sanitized.replace(
    /\bhttps:\/\/[a-z0-9-]+\.supabase\.(?:co|in)(?=[:/?#\s]|$)/gi,
    REDACTED_SUPABASE_URL,
  );
  sanitized = sanitized.replace(
    /\.env(?:\.[a-z0-9_-]+)?\b/gi,
    REDACTED_ENV_FILE,
  );

  return sanitized;
}

function getPostgrestField(
  body: Record<string, unknown>,
  field:
    | "code"
    | "message"
    | "details"
    | "hint"
    | "constraint"
    | "column"
    | "schema"
    | "table",
): string | null {
  const value = body[field];
  if (typeof value === "string") {
    const sanitized = sanitizeSupabaseDiagnosticText(value).trim();
    return sanitized === "" ? null : sanitized;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * Builds a safe, lossless-enough lastError from a Supabase/PostgREST response.
 * Only the standard diagnostic fields are selected from JSON objects. For a
 * non-JSON body, the sanitized response text is retained for diagnosis.
 */
export function formatSupabaseHttpError(
  status: number,
  bodyText: string,
): string {
  const statusLabel = Number.isInteger(status) && status >= 100 && status <= 599
    ? `HTTP ${status}`
    : "HTTP error";
  const trimmedBody = String(bodyText).trim();
  if (trimmedBody === "") return statusLabel;

  try {
    const parsed = JSON.parse(trimmedBody) as unknown;
    if (isObject(parsed)) {
      const lines = ([
        "code",
        "message",
        "details",
        "hint",
        "constraint",
        "column",
        "schema",
        "table",
      ] as const)
        .flatMap((field) => {
          const value = getPostgrestField(parsed, field);
          return value === null ? [] : [`${field}: ${value}`];
        });
      if (lines.length > 0) return [statusLabel, ...lines].join("\n");
    }
    if (typeof parsed === "string" && parsed.trim() !== "") {
      return [
        statusLabel,
        `message: ${sanitizeSupabaseDiagnosticText(parsed).trim()}`,
      ].join("\n");
    }
  } catch {
    // Preserve a non-JSON response below after credential sanitization.
  }

  const safeBody = sanitizeSupabaseDiagnosticText(trimmedBody).trim();
  return safeBody === "" ? statusLabel : `${statusLabel}\nbody: ${safeBody}`;
}

/** Uses only the canonical payload field; missing or malformed legacy data is unknown. */
export function getPendingSupabaseSyncDemandCycle(
  item: Pick<PendingSupabaseSyncItem, "payload">,
): SupabaseSyncDiagnosticDemandCycle {
  if (!isObject(item.payload)) return "unknown";
  return item.payload.demandCycle === "normal" ||
    item.payload.demandCycle === "summer"
    ? item.payload.demandCycle
    : "unknown";
}

function getValidAttemptCount(value: number): number {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function pickTimestamp(
  current: string | null,
  candidate: string | null,
  direction: "earliest" | "latest",
): string | null {
  if (typeof candidate !== "string" || !Number.isFinite(Date.parse(candidate))) {
    return current;
  }
  if (current === null || !Number.isFinite(Date.parse(current))) return candidate;
  const currentTime = Date.parse(current);
  const candidateTime = Date.parse(candidate);
  return direction === "earliest"
    ? candidateTime < currentTime ? candidate : current
    : candidateTime > currentTime ? candidate : current;
}

function buildErrorPreview(
  errorText: string | null,
  maxLength = DEFAULT_ERROR_PREVIEW_LENGTH,
): Pick<PendingSupabaseSyncErrorGroup, "errorPreview" | "isErrorTruncated"> {
  const displayText = errorText ?? ERROR_NOT_RECORDED_TEXT;
  if (displayText.length <= maxLength) {
    return { errorPreview: displayText, isErrorTruncated: false };
  }
  return {
    errorPreview: `${displayText.slice(0, maxLength).trimEnd()}…`,
    isErrorTruncated: true,
  };
}

export function buildPendingSupabaseSyncErrorDetails(
  items: readonly PendingSupabaseSyncItem[],
): PendingSupabaseSyncErrorDetails {
  const groupsByKey = new Map<string, PendingSupabaseSyncErrorGroup>();

  for (const item of items) {
    const demandCycle = getPendingSupabaseSyncDemandCycle(item);
    const errorText = normalizeDiagnosticError(item.lastError);
    const key = JSON.stringify([item.type, demandCycle, errorText]);
    const attemptCount = getValidAttemptCount(item.attemptCount);
    const existing = groupsByKey.get(key);

    if (!existing) {
      groupsByKey.set(key, {
        type: item.type,
        demandCycle,
        count: 1,
        errorText,
        ...buildErrorPreview(errorText),
        attemptCountMin: attemptCount,
        attemptCountMax: attemptCount,
        firstFailedAt: pickTimestamp(null, item.firstFailedAt, "earliest"),
        lastAttemptAt: pickTimestamp(null, item.lastAttemptAt, "latest"),
      });
      continue;
    }

    existing.count += 1;
    existing.attemptCountMin = Math.min(existing.attemptCountMin, attemptCount);
    existing.attemptCountMax = Math.max(existing.attemptCountMax, attemptCount);
    existing.firstFailedAt = pickTimestamp(
      existing.firstFailedAt,
      item.firstFailedAt,
      "earliest",
    );
    existing.lastAttemptAt = pickTimestamp(
      existing.lastAttemptAt,
      item.lastAttemptAt,
      "latest",
    );
  }

  const groups = [...groupsByKey.values()];
  return {
    pendingCount: items.length,
    groupedItemCount: groups.reduce((sum, group) => sum + group.count, 0),
    groups,
  };
}

function appendAttemptDetails(
  lines: string[],
  group: PendingSupabaseSyncErrorGroup,
): void {
  if (group.attemptCountMin === group.attemptCountMax) {
    lines.push(`attemptCount: ${group.attemptCountMin}`);
  } else {
    lines.push(
      `attemptCountRange: ${group.attemptCountMin}-${group.attemptCountMax}`,
    );
  }
  if (group.firstFailedAt) lines.push(`firstFailedAt: ${group.firstFailedAt}`);
  if (group.lastAttemptAt) lines.push(`lastAttemptAt: ${group.lastAttemptAt}`);
}

export function buildSupabaseSyncErrorCopyText(
  details: PendingSupabaseSyncErrorDetails,
  metadata: SupabaseSyncErrorCopyMetadata,
): string {
  const lines = [
    "値引ヘルパー Supabase同期エラー",
    "",
    `appVersion: ${sanitizeSupabaseDiagnosticText(metadata.appVersion)}`,
    `buildId: ${sanitizeSupabaseDiagnosticText(metadata.buildId)}`,
    `pendingCount: ${details.pendingCount}`,
  ];

  details.groups.forEach((group, index) => {
    lines.push(
      "",
      `[${index + 1}]`,
      `type: ${group.type}`,
      `demandCycle: ${group.demandCycle}`,
      `count: ${group.count}`,
    );
    appendAttemptDetails(lines, group);
    lines.push("error:", group.errorText ?? ERROR_NOT_RECORDED_TEXT);
  });

  return sanitizeSupabaseDiagnosticText(lines.join("\n"));
}
