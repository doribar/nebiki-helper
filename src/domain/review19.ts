import { NORMAL_ROUTE, getAreaName } from './area.ts';
import type { AreaId, Review19Rating, Review19Reference, Review19Result, SessionData, ScreenName } from './types.ts';

export const REVIEW19_RATINGS: Array<{ value: Review19Rating; label: string }> = [
  { value: 'decreased_too_much', label: '減りすぎ' },
  { value: 'decreased_slightly_too_much', label: 'やや減りすぎ' },
  { value: 'just_right', label: 'ちょうどいい' },
  { value: 'remained_slightly_too_much', label: 'やや残りすぎ' },
  { value: 'remained_too_much', label: '残りすぎ' },
];

export const REVIEW19_EXPORT_BATCH_SIZE = 10;


export function createDefaultReview19Ratings(): Record<AreaId, Review19Rating> {
  return NORMAL_ROUTE.reduce((acc, areaId) => {
    acc[areaId] = 'just_right';
    return acc;
  }, {} as Record<AreaId, Review19Rating>);
}

export function createInitialReview19Result(params: {
  date: string;
  sessionStartedAt: string;
}): Review19Result {
  return {
    date: params.date,
    sessionStartedAt: params.sessionStartedAt,
    ratings: createDefaultReview19Ratings(),
  };
}

export function getReview19AreaItems(): Array<{ areaId: AreaId; areaName: string }> {
  return NORMAL_ROUTE.map((areaId) => ({ areaId, areaName: getAreaName(areaId) }));
}

export function isValidReview19Rating(value: unknown): value is Review19Rating {
  return REVIEW19_RATINGS.some((rating) => rating.value === value);
}

function cloneReview19Reference(raw?: Partial<Review19Reference> | null): Review19Reference | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (raw.discountTime !== '19') return undefined;
  if (typeof raw.date !== 'string' || typeof raw.weekday !== 'number') return undefined;
  if (!raw.weather || typeof raw.weather !== 'object') return undefined;
  if (!raw.resolvedWeather || typeof raw.resolvedWeather !== 'object') return undefined;
  if (!raw.basis || typeof raw.basis !== 'object') return undefined;

  return JSON.parse(JSON.stringify(raw)) as Review19Reference;
}

export function normalizeReview19Result(raw?: Partial<Review19Result> | null): Review19Result | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.date !== 'string' || typeof raw.sessionStartedAt !== 'string') return null;

  const base = createInitialReview19Result({
    date: raw.date,
    sessionStartedAt: raw.sessionStartedAt,
  });

  const sourceRatings = raw.ratings && typeof raw.ratings === 'object' ? raw.ratings : {};

  for (const areaId of NORMAL_ROUTE) {
    const rating = (sourceRatings as Partial<Record<AreaId, unknown>>)[areaId];
    if (isValidReview19Rating(rating)) {
      base.ratings[areaId] = rating;
    }
  }

  return {
    ...base,
    recordedAt: typeof raw.recordedAt === 'string' ? raw.recordedAt : undefined,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : undefined,
    reference: cloneReview19Reference(raw.reference),
    snapshot:
      raw.snapshot && typeof raw.snapshot === 'object'
        ? JSON.parse(JSON.stringify(raw.snapshot))
        : undefined,
  };
}

export function cloneReview19Result(record: Review19Result | null): Review19Result | null {
  const normalized = normalizeReview19Result(record);
  return normalized ? JSON.parse(JSON.stringify(normalized)) as Review19Result : null;
}

export function cloneReview19Records(records: Review19Result[]): Review19Result[] {
  return records
    .map((record) => cloneReview19Result(record))
    .filter((record): record is Review19Result => record !== null);
}

export function appendReview19RecordInMemory(params: {
  currentRecords: Review19Result[];
  recordToAdd: Review19Result;
}): Review19Result[] {
  const normalizedRecord = normalizeReview19Result(params.recordToAdd);
  if (!normalizedRecord?.recordedAt) {
    return cloneReview19Records(params.currentRecords);
  }

  const current = cloneReview19Records(params.currentRecords);
  const index = current.findIndex(
    (record) =>
      record.date === normalizedRecord.date &&
      record.sessionStartedAt === normalizedRecord.sessionStartedAt
  );

  if (index >= 0) {
    current[index] = normalizedRecord;
    return current;
  }

  return [...current, normalizedRecord];
}


function getReview19RecordKey(record: Review19Result): string {
  return `${record.date}::${record.sessionStartedAt}`;
}

export function getUnexportedReview19Records(records: Review19Result[]): Review19Result[] {
  return cloneReview19Records(records)
    .filter((record) => Boolean(record.recordedAt) && !record.exportedAt)
    .sort((a, b) => {
      const recordedCompare = (a.recordedAt ?? '').localeCompare(b.recordedAt ?? '');
      if (recordedCompare !== 0) return recordedCompare;
      return getReview19RecordKey(a).localeCompare(getReview19RecordKey(b));
    });
}

export function getReview19ExportBatch(records: Review19Result[], limit = REVIEW19_EXPORT_BATCH_SIZE): Review19Result[] {
  return getUnexportedReview19Records(records).slice(0, limit);
}

export function buildReview19ExportPayload(params: {
  records: Review19Result[];
  exportedAt: string;
}) {
  const records = cloneReview19Records(params.records);
  return {
    format: 'nebiki-helper-review19-export',
    version: 1,
    exportedAt: params.exportedAt,
    count: records.length,
    records,
  };
}

export function markReview19RecordsExportedInMemory(params: {
  currentRecords: Review19Result[];
  recordsToMark: Review19Result[];
  exportedAt: string;
}): Review19Result[] {
  const targetKeys = new Set(params.recordsToMark.map(getReview19RecordKey));

  return cloneReview19Records(params.currentRecords).map((record) => {
    if (!targetKeys.has(getReview19RecordKey(record))) return record;
    return {
      ...record,
      exportedAt: params.exportedAt,
    };
  });
}

export function shouldAutoStartReview19(params: {
  session: SessionData | null;
  screen: ScreenName;
  review19: Review19Result | null;
  now: Date;
}): boolean {
  const { session, screen, review19, now } = params;

  if (!session) return false;
  if (screen !== 'done') return false;
  if (session.discountTime !== '17') return false;
  if (review19?.date === session.date && review19.recordedAt) return false;
  if (review19?.date === session.date && !review19.recordedAt) return false;

  const currentDate = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
  if (currentDate !== session.date) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 19 * 60 + 15;
}
