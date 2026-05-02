import type { AreaId, DiscountTime } from "./types";

const DB_NAME = "nebiki-helper-photo-capture";
const DB_VERSION = 1;
const STORE_NAME = "capturedPhotos";

export type PersistedCapturedPhotoSlot = {
  id: string;
  sessionDate: string;
  discountTime: DiscountTime;
  areaId: AreaId;
  slotId: string;
  file: File;
  updatedAt: string;
};

function sessionPrefix(sessionDate: string, discountTime: DiscountTime): string {
  return `${sessionDate}:${discountTime}`;
}

function photoKey(sessionDate: string, discountTime: DiscountTime, areaId: AreaId, slotId: string): string {
  return `${sessionPrefix(sessionDate, discountTime)}:${areaId}:${slotId}`;
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error("IndexedDB が利用できません。"));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB を開けませんでした。"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let request: IDBRequest<T> | void;

    transaction.oncomplete = () => {
      db.close();
      resolve(request ? request.result : undefined);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("IndexedDB の処理に失敗しました。"));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error("IndexedDB の処理が中断されました。"));
    };

    request = action(store);
  });
}

function normalizeRecord(value: unknown): PersistedCapturedPhotoSlot | null {
  const record = value as Partial<PersistedCapturedPhotoSlot> | null;
  if (!record?.id || !record.sessionDate || !record.discountTime || !record.areaId || !record.slotId) {
    return null;
  }
  if (!(record.file instanceof File)) return null;
  return record as PersistedCapturedPhotoSlot;
}

export async function savePersistedCapturedPhotoSlot(params: {
  sessionDate: string;
  discountTime: DiscountTime;
  areaId: AreaId;
  slotId: string;
  file: File;
}): Promise<void> {
  if (!isIndexedDbAvailable()) return;

  const record: PersistedCapturedPhotoSlot = {
    id: photoKey(params.sessionDate, params.discountTime, params.areaId, params.slotId),
    sessionDate: params.sessionDate,
    discountTime: params.discountTime,
    areaId: params.areaId,
    slotId: params.slotId,
    file: params.file,
    updatedAt: new Date().toISOString(),
  };

  await withStore("readwrite", (store) => store.put(record));
}

export async function loadPersistedCapturedPhotoSlots(params: {
  sessionDate: string;
  discountTime: DiscountTime;
}): Promise<PersistedCapturedPhotoSlot[]> {
  if (!isIndexedDbAvailable()) return [];

  const all = await withStore<PersistedCapturedPhotoSlot[]>("readonly", (store) => store.getAll());
  const prefix = sessionPrefix(params.sessionDate, params.discountTime);
  return (all ?? [])
    .map(normalizeRecord)
    .filter((record): record is PersistedCapturedPhotoSlot => Boolean(record))
    .filter((record) => record.id.startsWith(`${prefix}:`));
}

export async function deletePersistedCapturedPhotosForArea(params: {
  sessionDate: string;
  discountTime: DiscountTime;
  areaId: AreaId;
}): Promise<void> {
  if (!isIndexedDbAvailable()) return;

  const records = await loadPersistedCapturedPhotoSlots(params);
  const ids = records
    .filter((record) => record.areaId === params.areaId)
    .map((record) => record.id);

  if (ids.length === 0) return;

  await withStore("readwrite", (store) => {
    for (const id of ids) {
      store.delete(id);
    }
  });
}

export async function clearPersistedCapturedPhotosForSession(params: {
  sessionDate: string;
  discountTime: DiscountTime;
}): Promise<void> {
  if (!isIndexedDbAvailable()) return;

  const records = await loadPersistedCapturedPhotoSlots(params);
  if (records.length === 0) return;

  await withStore("readwrite", (store) => {
    for (const record of records) {
      store.delete(record.id);
    }
  });
}
