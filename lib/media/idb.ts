/** Минимальная обёртка над IndexedDB: локальный кэш медиафайлов и метаданных. */

const DB_NAME = "my-history";
const DB_VERSION = 1;

export const STORES = {
  blobs: "blobs", // ключ: `${mediaId}:${variant}`
  meta: "media", // ключ: mediaId
  kv: "kv", // произвольные данные (поездки в локальном режиме)
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB недоступен"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

export const idb = {
  get: <T>(store: string, key: string) => run<T | undefined>(store, "readonly", (s) => s.get(key)),
  set: (store: string, key: string, value: unknown) => run<IDBValidKey>(store, "readwrite", (s) => s.put(value, key)),
  del: (store: string, key: string) => run<undefined>(store, "readwrite", (s) => s.delete(key)),
  keys: (store: string) => run<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()),
};
