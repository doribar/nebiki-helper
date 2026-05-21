import { NORMAL_ROUTE, getAreaName } from './area.ts';
import type { AreaId, Review19Rating, Review19Result, SessionData, ScreenName } from './types.ts';

export const REVIEW19_RATINGS: Array<{ value: Review19Rating; label: string }> = [
  { value: 'decreased_too_much', label: '減りすぎ' },
  { value: 'decreased_slightly_too_much', label: 'やや減りすぎ' },
  { value: 'just_right', label: 'ちょうどいい' },
  { value: 'remained_slightly_too_much', label: 'やや残りすぎ' },
  { value: 'remained_too_much', label: '残りすぎ' },
];

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
  return minutes >= 19 * 60;
}
