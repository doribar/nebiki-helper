export const PENDING_SUPABASE_SYNC_STORAGE_KEY =
  "nebiki-helper/pending-supabase-sync-v1" as const;

export type SupabaseSyncItemType = "area_count" | "review19";

export type PendingSupabaseSyncItem = {
  type: SupabaseSyncItemType;
  identity: string;
  payload: unknown;
  firstFailedAt: string | null;
  lastAttemptAt: string | null;
  attemptCount: number;
  enqueuedAt: string;
  lastError: string | null;
};

export type SupabaseSyncQueueStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type EnqueuePendingSupabaseSyncInput = Pick<
  PendingSupabaseSyncItem,
  "type" | "identity" | "payload"
> &
  Partial<
    Pick<
      PendingSupabaseSyncItem,
      | "firstFailedAt"
      | "lastAttemptAt"
      | "attemptCount"
      | "enqueuedAt"
      | "lastError"
    >
  >;

export type SupabaseSyncSendResult =
  | void
  | boolean
  | { ok: boolean; error?: unknown };

export type SupabaseSyncSender = (
  item: Readonly<PendingSupabaseSyncItem>,
) => SupabaseSyncSendResult | Promise<SupabaseSyncSendResult>;

export type FlushPendingSupabaseSyncResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  retained: number;
};

type QueueOptions = {
  storage?: SupabaseSyncQueueStorage | null;
};

type EnqueueOptions = QueueOptions & {
  now?: () => string;
};

export type FlushPendingSupabaseSyncOptions = QueueOptions & {
  sender: SupabaseSyncSender;
  now?: () => string;
};

function getDefaultStorage(): SupabaseSyncQueueStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function resolveStorage(
  storage: SupabaseSyncQueueStorage | null | undefined,
): SupabaseSyncQueueStorage | null {
  return storage === undefined ? getDefaultStorage() : storage;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimestampOrNull(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function cloneJsonValue(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Supabase sync payload must be JSON serializable");
  }
  return JSON.parse(serialized) as unknown;
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

function getPayloadFingerprint(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(cloneJsonValue(value)));
}

export function areSupabaseSyncPayloadsEqual(
  first: unknown,
  second: unknown,
): boolean {
  try {
    return getPayloadFingerprint(first) === getPayloadFingerprint(second);
  } catch {
    return false;
  }
}

function getQueueItemKey(
  item: Pick<PendingSupabaseSyncItem, "type" | "identity">,
): string {
  return JSON.stringify([item.type, item.identity]);
}

function normalizePendingItem(raw: unknown): PendingSupabaseSyncItem | null {
  if (!isObject(raw)) return null;
  if (raw.type !== "area_count" && raw.type !== "review19") return null;
  if (typeof raw.identity !== "string" || raw.identity.trim() === "") {
    return null;
  }
  if (!isTimestampOrNull(raw.firstFailedAt)) return null;
  if (!isTimestampOrNull(raw.lastAttemptAt)) return null;
  if (
    typeof raw.attemptCount !== "number" ||
    !Number.isInteger(raw.attemptCount) ||
    raw.attemptCount < 0
  ) {
    return null;
  }
  if (
    typeof raw.enqueuedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.enqueuedAt))
  ) {
    return null;
  }
  if (raw.lastError !== null && typeof raw.lastError !== "string") return null;

  try {
    return {
      type: raw.type,
      identity: raw.identity,
      payload: cloneJsonValue(raw.payload),
      firstFailedAt: raw.firstFailedAt,
      lastAttemptAt: raw.lastAttemptAt,
      attemptCount: raw.attemptCount,
      enqueuedAt: raw.enqueuedAt,
      lastError: raw.lastError,
    };
  } catch {
    return null;
  }
}

function clonePendingItem(
  item: PendingSupabaseSyncItem,
): PendingSupabaseSyncItem {
  return {
    ...item,
    payload: cloneJsonValue(item.payload),
  };
}

export function normalizePendingSupabaseSyncQueue(
  raw: unknown,
): PendingSupabaseSyncItem[] {
  if (!Array.isArray(raw)) return [];

  const itemsByKey = new Map<string, PendingSupabaseSyncItem>();
  for (const candidate of raw) {
    const item = normalizePendingItem(candidate);
    if (!item) continue;
    itemsByKey.set(getQueueItemKey(item), item);
  }

  return [...itemsByKey.values()].sort((first, second) => {
    const enqueuedAtComparison = first.enqueuedAt.localeCompare(
      second.enqueuedAt,
    );
    return enqueuedAtComparison !== 0
      ? enqueuedAtComparison
      : getQueueItemKey(first).localeCompare(getQueueItemKey(second));
  });
}

function parseQueue(raw: string | null): PendingSupabaseSyncItem[] {
  if (!raw) return [];
  try {
    return normalizePendingSupabaseSyncQueue(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function loadPendingSupabaseSyncQueue(
  options: QueueOptions = {},
): PendingSupabaseSyncItem[] {
  const storage = resolveStorage(options.storage);
  if (!storage) return [];
  return parseQueue(storage.getItem(PENDING_SUPABASE_SYNC_STORAGE_KEY)).map(
    clonePendingItem,
  );
}

export function savePendingSupabaseSyncQueue(
  items: readonly PendingSupabaseSyncItem[],
  options: QueueOptions = {},
): PendingSupabaseSyncItem[] {
  const normalized = normalizePendingSupabaseSyncQueue(items);
  const storage = resolveStorage(options.storage);
  if (storage) {
    storage.setItem(
      PENDING_SUPABASE_SYNC_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  }
  return normalized.map(clonePendingItem);
}

export function clearPendingSupabaseSyncQueue(
  options: QueueOptions = {},
): void {
  resolveStorage(options.storage)?.removeItem(
    PENDING_SUPABASE_SYNC_STORAGE_KEY,
  );
}

export function upsertPendingSupabaseSyncItem(
  currentItems: readonly PendingSupabaseSyncItem[],
  input: EnqueuePendingSupabaseSyncInput,
  enqueuedAt: string,
): PendingSupabaseSyncItem[] {
  if (!Number.isFinite(Date.parse(enqueuedAt))) {
    throw new TypeError("enqueuedAt must be a valid timestamp");
  }
  if (input.type !== "area_count" && input.type !== "review19") {
    throw new TypeError("Unknown Supabase sync item type");
  }
  if (typeof input.identity !== "string" || input.identity.trim() === "") {
    throw new TypeError("Supabase sync identity must not be empty");
  }

  const payload = cloneJsonValue(input.payload);
  const current = normalizePendingSupabaseSyncQueue(currentItems);
  const key = getQueueItemKey(input);
  const existing = current.find((item) => getQueueItemKey(item) === key);
  if (existing && areSupabaseSyncPayloadsEqual(existing.payload, payload)) {
    return current.map(clonePendingItem);
  }

  const firstFailedAt = input.firstFailedAt ?? null;
  const lastAttemptAt = input.lastAttemptAt ?? null;
  const replacement = normalizePendingItem({
    type: input.type,
    identity: input.identity,
    payload,
    firstFailedAt,
    lastAttemptAt,
    attemptCount: input.attemptCount ?? 0,
    enqueuedAt: input.enqueuedAt ?? enqueuedAt,
    lastError: input.lastError ?? null,
  });
  if (!replacement) {
    throw new TypeError("Invalid Supabase sync queue item metadata");
  }

  return normalizePendingSupabaseSyncQueue([
    ...current.filter((item) => getQueueItemKey(item) !== key),
    replacement,
  ]);
}

export function enqueuePendingSupabaseSync(
  input: EnqueuePendingSupabaseSyncInput,
  options: EnqueueOptions = {},
): PendingSupabaseSyncItem[] {
  const now = (options.now ?? defaultNow)();
  const next = upsertPendingSupabaseSyncItem(
    loadPendingSupabaseSyncQueue(options),
    input,
    now,
  );
  return savePendingSupabaseSyncQueue(next, options);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  try {
    return JSON.stringify(error) || "Supabase sync failed";
  } catch {
    return "Supabase sync failed";
  }
}

function getSendFailure(result: SupabaseSyncSendResult): unknown | null {
  if (result === false) return "Supabase sync sender returned false";
  if (isObject(result) && result.ok === false) {
    return result.error ?? "Supabase sync sender returned ok: false";
  }
  return null;
}

async function flushQueue(
  options: FlushPendingSupabaseSyncOptions,
): Promise<FlushPendingSupabaseSyncResult> {
  const now = options.now ?? defaultNow;
  const initialItems = loadPendingSupabaseSyncQueue(options);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const initialItem of initialItems) {
    const key = getQueueItemKey(initialItem);
    const beforeAttempt = loadPendingSupabaseSyncQueue(options);
    const currentItem = beforeAttempt.find(
      (item) => getQueueItemKey(item) === key,
    );
    if (
      !currentItem ||
      !areSupabaseSyncPayloadsEqual(
        currentItem.payload,
        initialItem.payload,
      )
    ) {
      continue;
    }

    const attemptedAt = now();
    const itemToSend: PendingSupabaseSyncItem = {
      ...currentItem,
      payload: cloneJsonValue(currentItem.payload),
      lastAttemptAt: attemptedAt,
      attemptCount: currentItem.attemptCount + 1,
    };
    savePendingSupabaseSyncQueue(
      beforeAttempt.map((item) =>
        getQueueItemKey(item) === key ? itemToSend : item,
      ),
      options,
    );
    attempted += 1;

    let failure: unknown | null = null;
    try {
      failure = getSendFailure(await options.sender(clonePendingItem(itemToSend)));
    } catch (error) {
      failure = error;
    }

    const latest = loadPendingSupabaseSyncQueue(options);
    const latestItem = latest.find((item) => getQueueItemKey(item) === key);
    const payloadIsCurrent = Boolean(
      latestItem &&
        areSupabaseSyncPayloadsEqual(latestItem.payload, itemToSend.payload),
    );

    if (failure === null) {
      succeeded += 1;
      if (payloadIsCurrent) {
        savePendingSupabaseSyncQueue(
          latest.filter((item) => getQueueItemKey(item) !== key),
          options,
        );
      }
      continue;
    }

    failed += 1;
    if (latestItem && payloadIsCurrent) {
      savePendingSupabaseSyncQueue(
        latest.map((item) =>
          getQueueItemKey(item) === key
            ? {
                ...item,
                firstFailedAt: item.firstFailedAt ?? attemptedAt,
                lastError: toErrorMessage(failure),
              }
            : item,
        ),
        options,
      );
    }
  }

  return {
    attempted,
    succeeded,
    failed,
    retained: loadPendingSupabaseSyncQueue(options).length,
  };
}

let inFlightFlush: Promise<FlushPendingSupabaseSyncResult> | null = null;

export function flushPendingSupabaseSyncQueue(
  options: FlushPendingSupabaseSyncOptions,
): Promise<FlushPendingSupabaseSyncResult> {
  if (inFlightFlush) return inFlightFlush;

  const pending = flushQueue(options);
  const locked = pending.finally(() => {
    if (inFlightFlush === locked) inFlightFlush = null;
  });
  inFlightFlush = locked;
  return locked;
}
