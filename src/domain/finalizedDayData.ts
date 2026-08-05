import type {
  DailySessionSnapshot,
  DemandCycle,
  Review19DaySnapshot,
  Review19Snapshot,
} from "./types.ts";
import { normalizeDemandCycle } from "./demandCycle.ts";

export const FINALIZED_DAY_DATA_STORAGE_KEY =
  "nebiki-helper/finalized-day-data" as const;

/**
 * 旧データとの互換用入力型。
 * 新規保存時は normalizeFinalizedDayData() により StoredFinalizedDayData へ確定する。
 */
export type FinalizedDayData = Review19DaySnapshot & {
  recordId?: string | null;
  finalizedAt?: string | null;
  memo?: string | null;
  discardCount?: number | null;
};

/** アプリが正式記録として保存・返却する正規化済みの日次データ。 */
export type StoredFinalizedDayData = FinalizedDayData & {
  recordId: string;
  finalizedAt: string;
  memo: string | null;
  discardCount: number | null;
};

export type FinalizedDayMetadataPatch = {
  memo?: string | null;
  discardCount?: number | null;
};

export type FinalizedDayWriteResult = {
  records: StoredFinalizedDayData[];
  record: StoredFinalizedDayData;
  created: boolean;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function applyAreaSnapshotDemandCycle(
  areas: DailySessionSnapshot["areas"] | Review19Snapshot["areas"],
  demandCycle: DemandCycle,
): void {
  if (!areas || typeof areas !== "object") return;
  for (const area of Object.values(areas)) {
    if (!area || typeof area !== "object") continue;
    if (area.rateDecisionSnapshot) {
      area.rateDecisionSnapshot.demandCycle = demandCycle;
    }
    if (area.areaCountDecisionBasis) {
      area.areaCountDecisionBasis.demandCycle = demandCycle;
    }
  }
}

/** 旧日次の欠損値を通常扱いにし、1営業日内の保存データへ同じサイクルを伝播する。 */
export function normalizeReview19DaySnapshotDemandCycle(
  snapshot: Review19DaySnapshot,
): Review19DaySnapshot {
  const cloned = clone(snapshot);
  const firstSession = cloned.sessions.find(
    (session) => session && typeof session === "object",
  );
  const firstAreaCountRecord = cloned.areaCountRecords.find(
    (record) => record && typeof record === "object",
  );
  const demandCycle = normalizeDemandCycle(
    cloned.demandCycle ??
      cloned.review19Check?.demandCycle ??
      firstSession?.demandCycle ??
      firstSession?.session?.demandCycle ??
      firstAreaCountRecord?.demandCycle,
  );
  cloned.demandCycle = demandCycle;

  for (const session of cloned.sessions) {
    if (!session || typeof session !== "object") continue;
    session.demandCycle = demandCycle;
    if (session.session && typeof session.session === "object") {
      session.session.demandCycle = demandCycle;
    }
    applyAreaSnapshotDemandCycle(session.areas, demandCycle);
  }

  for (const record of cloned.areaCountRecords) {
    if (!record || typeof record !== "object") continue;
    record.demandCycle = demandCycle;
    if (record.decisionBasis) {
      record.decisionBasis.demandCycle = demandCycle;
    }
  }

  const review19Check = cloned.review19Check;
  if (review19Check && typeof review19Check === "object") {
    review19Check.demandCycle = demandCycle;
    if (
      review19Check.reference &&
      typeof review19Check.reference === "object"
    ) {
      review19Check.reference.demandCycle = demandCycle;
    }
    if (
      review19Check.snapshot &&
      typeof review19Check.snapshot === "object"
    ) {
      review19Check.snapshot.demandCycle = demandCycle;
      if (
        review19Check.snapshot.session &&
        typeof review19Check.snapshot.session === "object"
      ) {
        review19Check.snapshot.session.demandCycle = demandCycle;
      }
      if (
        review19Check.snapshot.reviewReference &&
        typeof review19Check.snapshot.reviewReference === "object"
      ) {
        review19Check.snapshot.reviewReference.demandCycle = demandCycle;
      }
      applyAreaSnapshotDemandCycle(
        review19Check.snapshot.areas,
        demandCycle,
      );
    }
  }

  return cloned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function getStableRecordId(date: string): string {
  return `nebiki-day:${date}`;
}

function normalizeMemo(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeDiscardCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

export function normalizeFinalizedDayData(
  raw: unknown,
): StoredFinalizedDayData | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== 1) return null;
  if (typeof raw.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    return null;
  }
  if (!isValidTimestamp(raw.capturedAt)) return null;
  if (!Array.isArray(raw.sessions) || !Array.isArray(raw.areaCountRecords)) {
    return null;
  }

  const cloned = normalizeReview19DaySnapshotDemandCycle(
    raw as unknown as Review19DaySnapshot,
  ) as FinalizedDayData;
  return {
    ...cloned,
    recordId:
      typeof raw.recordId === "string" && raw.recordId.trim()
        ? raw.recordId
        : getStableRecordId(raw.date),
    finalizedAt: isValidTimestamp(raw.finalizedAt)
      ? raw.finalizedAt
      : raw.capturedAt,
    memo: normalizeMemo(raw.memo),
    discardCount: normalizeDiscardCount(raw.discardCount),
  };
}

function getExecutionTime(record: FinalizedDayData): number {
  const value = record.finalizedAt ?? record.capturedAt;
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareFinalizedDayData(
  a: StoredFinalizedDayData,
  b: StoredFinalizedDayData,
): number {
  const dateCompare = a.date.localeCompare(b.date);
  if (dateCompare !== 0) return dateCompare;

  const timeCompare = getExecutionTime(a) - getExecutionTime(b);
  if (timeCompare !== 0) return timeCompare;

  return a.recordId.localeCompare(b.recordId);
}

/** 日付ごとに実施日時が最新の正式記録を1件だけ残し、時系列順に返す。 */
export function selectAllFinalizedDayData(
  records: readonly FinalizedDayData[],
): StoredFinalizedDayData[] {
  const latestByDate = new Map<string, StoredFinalizedDayData>();

  for (const raw of records) {
    const record = normalizeFinalizedDayData(raw);
    if (!record) continue;

    const current = latestByDate.get(record.date);
    if (!current || compareFinalizedDayData(current, record) <= 0) {
      latestByDate.set(record.date, record);
    }
  }

  return [...latestByDate.values()].sort(compareFinalizedDayData).map(clone);
}

/** 対象日付、同日なら正式確定日時を基準に最新1件を返す。 */
export function selectLatestFinalizedDayData(
  records: readonly FinalizedDayData[],
): StoredFinalizedDayData | null {
  return selectAllFinalizedDayData(records).at(-1) ?? null;
}

/** 日本時間の対象日付に対応する正式記録を返す。前日メタデータ更新用。 */
export function selectFinalizedDayDataByDate(
  records: readonly FinalizedDayData[],
  date: string,
): StoredFinalizedDayData | null {
  return (
    selectAllFinalizedDayData(records).find((record) => record.date === date) ??
    null
  );
}

/** 完了画面が保持する安定IDから、日時による再選定をせず正式記録を得る。 */
export function selectFinalizedDayDataByRecordId(
  records: readonly FinalizedDayData[],
  recordId: string,
): StoredFinalizedDayData | null {
  return (
    selectAllFinalizedDayData(records).find(
      (record) => record.recordId === recordId,
    ) ?? null
  );
}

function createStoredRecord(params: {
  daySnapshot: Review19DaySnapshot;
  finalizedAt?: string;
}): StoredFinalizedDayData {
  const normalized = normalizeFinalizedDayData({
    ...clone(params.daySnapshot),
    recordId: getStableRecordId(params.daySnapshot.date),
    finalizedAt: isValidTimestamp(params.finalizedAt)
      ? params.finalizedAt
      : params.daySnapshot.capturedAt,
    memo: null,
    discardCount: null,
  });

  if (!normalized) {
    throw new Error("正式な1日データとして保存できない形式です。");
  }
  return normalized;
}

/**
 * 初回確定。対象日の正式記録が既にある場合は本体もメタデータも変更しない。
 */
export function initializeFinalizedDayDataInMemory(params: {
  currentRecords: readonly FinalizedDayData[];
  daySnapshot: Review19DaySnapshot;
  finalizedAt?: string;
}): FinalizedDayWriteResult {
  const current = selectAllFinalizedDayData(params.currentRecords);
  const existing = current.find(
    (record) => record.date === params.daySnapshot.date,
  );
  if (existing) {
    return {
      records: current.map(clone),
      record: clone(existing),
      created: false,
    };
  }

  const record = createStoredRecord(params);
  return {
    records: [...current, record].sort(compareFinalizedDayData).map(clone),
    record: clone(record),
    created: true,
  };
}

/**
 * 明示的な本体置換。recordId・初回確定日時・メタデータは維持し、
 * Review19DaySnapshot部分だけを差し替える。
 */
export function replaceFinalizedDayDataCoreInMemory(params: {
  currentRecords: readonly FinalizedDayData[];
  daySnapshot: Review19DaySnapshot;
  finalizedAt?: string;
}): FinalizedDayWriteResult {
  const current = selectAllFinalizedDayData(params.currentRecords);
  const existing = current.find(
    (record) => record.date === params.daySnapshot.date,
  );

  if (!existing) {
    return initializeFinalizedDayDataInMemory(params);
  }

  const replacement = createStoredRecord(params);
  const record: StoredFinalizedDayData = {
    ...replacement,
    recordId: existing.recordId,
    finalizedAt: existing.finalizedAt,
    memo: existing.memo,
    discardCount: existing.discardCount,
  };
  const records = current
    .map((item) => (item.date === record.date ? record : item))
    .sort(compareFinalizedDayData)
    .map(clone);

  return { records, record: clone(record), created: false };
}

/** メモと廃棄個数だけを更新し、確定済みスナップショット本体には触れない。 */
export function patchFinalizedDayDataMetadataInMemory(params: {
  currentRecords: readonly FinalizedDayData[];
  date: string;
  patch: FinalizedDayMetadataPatch;
}): {
  records: StoredFinalizedDayData[];
  record: StoredFinalizedDayData | null;
} {
  const current = selectAllFinalizedDayData(params.currentRecords);
  const existing = current.find((record) => record.date === params.date);
  if (!existing) return { records: current.map(clone), record: null };

  const record: StoredFinalizedDayData = {
    ...existing,
    memo: Object.prototype.hasOwnProperty.call(params.patch, "memo")
      ? normalizeMemo(params.patch.memo)
      : existing.memo,
    discardCount: Object.prototype.hasOwnProperty.call(
      params.patch,
      "discardCount",
    )
      ? normalizeDiscardCount(params.patch.discardCount)
      : existing.discardCount,
  };
  const records = current.map((item) =>
    item.date === params.date ? clone(record) : clone(item),
  );
  return { records, record: clone(record) };
}

/** 完了画面が保持する安定IDの記録だけを更新し、別日の日次データには触れない。 */
export function patchFinalizedDayDataMetadataByRecordIdInMemory(params: {
  currentRecords: readonly FinalizedDayData[];
  recordId: string;
  patch: FinalizedDayMetadataPatch;
}): {
  records: StoredFinalizedDayData[];
  record: StoredFinalizedDayData | null;
} {
  const current = selectAllFinalizedDayData(params.currentRecords);
  const existing = current.find(
    (record) => record.recordId === params.recordId,
  );
  if (!existing) return { records: current.map(clone), record: null };

  const record: StoredFinalizedDayData = {
    ...existing,
    memo: Object.prototype.hasOwnProperty.call(params.patch, "memo")
      ? normalizeMemo(params.patch.memo)
      : existing.memo,
    discardCount: Object.prototype.hasOwnProperty.call(
      params.patch,
      "discardCount",
    )
      ? normalizeDiscardCount(params.patch.discardCount)
      : existing.discardCount,
  };
  const records = current.map((item) =>
    item.recordId === params.recordId ? clone(record) : clone(item),
  );
  return { records, record: clone(record) };
}

function getLocalStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function loadFinalizedDayData(): StoredFinalizedDayData[] {
  const storage = getLocalStorage();
  if (!storage) return [];

  try {
    const raw = JSON.parse(
      storage.getItem(FINALIZED_DAY_DATA_STORAGE_KEY) ?? "[]",
    ) as unknown;
    return Array.isArray(raw) ? selectAllFinalizedDayData(raw as FinalizedDayData[]) : [];
  } catch {
    return [];
  }
}

export function saveFinalizedDayData(
  records: readonly FinalizedDayData[],
): StoredFinalizedDayData[] {
  const normalized = selectAllFinalizedDayData(records);
  getLocalStorage()?.setItem(
    FINALIZED_DAY_DATA_STORAGE_KEY,
    JSON.stringify(normalized),
  );
  return normalized.map(clone);
}

export function initializeFinalizedDayData(params: {
  daySnapshot: Review19DaySnapshot;
  finalizedAt?: string;
}): FinalizedDayWriteResult {
  const result = initializeFinalizedDayDataInMemory({
    currentRecords: loadFinalizedDayData(),
    ...params,
  });
  saveFinalizedDayData(result.records);
  return { ...result, records: result.records.map(clone), record: clone(result.record) };
}

export function replaceFinalizedDayDataCore(params: {
  daySnapshot: Review19DaySnapshot;
  finalizedAt?: string;
}): FinalizedDayWriteResult {
  const result = replaceFinalizedDayDataCoreInMemory({
    currentRecords: loadFinalizedDayData(),
    ...params,
  });
  saveFinalizedDayData(result.records);
  return { ...result, records: result.records.map(clone), record: clone(result.record) };
}

export function patchFinalizedDayDataMetadata(params: {
  date: string;
  patch: FinalizedDayMetadataPatch;
}): StoredFinalizedDayData | null {
  const result = patchFinalizedDayDataMetadataInMemory({
    currentRecords: loadFinalizedDayData(),
    ...params,
  });
  if (!result.record) return null;
  saveFinalizedDayData(result.records);
  return clone(result.record);
}

export function patchFinalizedDayDataMetadataByRecordId(params: {
  recordId: string;
  patch: FinalizedDayMetadataPatch;
}): StoredFinalizedDayData | null {
  const result = patchFinalizedDayDataMetadataByRecordIdInMemory({
    currentRecords: loadFinalizedDayData(),
    ...params,
  });
  if (!result.record) return null;
  saveFinalizedDayData(result.records);
  return clone(result.record);
}
