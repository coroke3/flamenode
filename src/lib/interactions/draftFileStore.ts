"use client";

const DB_NAME = "flamenode-local-drafts";
const DB_VERSION = 1;
const STORE_NAME = "files";

interface DraftFileRecord {
  key: string;
  blob: Blob;
  filename: string;
  mimeType: string;
  savedAt: number;
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function runRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const close = () => {
          try {
            db.close();
          } catch {
            // Closing an already-closed IndexedDB connection is harmless.
          }
        };
        try {
          const transaction = db.transaction(STORE_NAME, mode);
          const request = operation(transaction.objectStore(STORE_NAME));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => {
            close();
            reject(request.error ?? new Error("IndexedDB request failed"));
          };
          transaction.onabort = () => {
            close();
            reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
          };
          transaction.oncomplete = close;
        } catch (error) {
          close();
          reject(error);
        }
      }),
  );
}

export async function saveDraftFile(storageKey: string, file: File): Promise<boolean> {
  if (!storageKey || !canUseIndexedDb()) return false;
  try {
    await runRequest("readwrite", (store) =>
      store.put({
        key: storageKey,
        blob: file,
        filename: file.name || "draft-icon",
        mimeType: file.type || "application/octet-stream",
        savedAt: Date.now(),
      } satisfies DraftFileRecord),
    );
    return true;
  } catch {
    return false;
  }
}

export async function loadDraftFile(storageKey: string): Promise<File | null> {
  if (!storageKey || !canUseIndexedDb()) return null;
  try {
    const record = await runRequest<DraftFileRecord | undefined>("readonly", (store) =>
      store.get(storageKey),
    );
    const now = Date.now();
    const isExpired =
      !record ||
      !Number.isFinite(record.savedAt) ||
      now - record.savedAt > DRAFT_FILE_TTL_MS ||
      record.savedAt > now + 60_000;
    if (isExpired || !(record.blob instanceof Blob)) {
      if (record?.key) void deleteDraftFile(record.key);
      return null;
    }
    return new File([record.blob], record.filename || "draft-icon", {
      type: record.mimeType || record.blob.type || "application/octet-stream",
      lastModified: record.savedAt || Date.now(),
    });
  } catch {
    return null;
  }
}

export async function deleteDraftFile(storageKey: string): Promise<boolean> {
  if (!storageKey || !canUseIndexedDb()) return false;
  try {
    await runRequest("readwrite", (store) => store.delete(storageKey));
    return true;
  } catch {
    return false;
  }
}

export async function cleanupExpiredDraftFiles(ttlMs: number): Promise<number> {
  if (!canUseIndexedDb()) return 0;
  try {
    const records = await runRequest<DraftFileRecord[]>("readonly", (store) => store.getAll());
    const cutoff = Date.now() - Math.max(0, ttlMs);
    const expired = records.filter(
      (record) =>
        !record ||
        !Number.isFinite(record.savedAt) ||
        record.savedAt < cutoff ||
        record.savedAt > Date.now() + 60_000,
    );
    for (const record of expired) {
      if (record?.key) await deleteDraftFile(record.key);
    }
    return expired.length;
  } catch {
    return 0;
  }
}

export const DRAFT_FILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
