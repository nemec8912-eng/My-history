/** Минимальная обёртка над IndexedDB: локальный кэш медиафайлов, метаданных и данных приложения. */

const DB_NAME = "my-history";
const DB_VERSION = 1;

export const STORES = {
  blobs: "blobs", // ключ: `${mediaId}:${variant}`
  meta: "media", // ключ: mediaId
  kv: "kv", // произвольные данные (поездки в локальном режиме, очереди, кэш)
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
    req.onsuccess = () => {
      const db = req.result;
      // Safari иногда закрывает соединение («Connection to Indexed Database server lost») — открываем заново.
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/**
 * Запись считается выполненной только после фиксации транзакции (oncomplete):
 * переполненная память или отказ Safari сохранить файл приходят как abort уже после onsuccess запроса.
 */
function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest, retry = true): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(store, mode);
        } catch (e) {
          // Соединение закрыто — одна повторная попытка с новым соединением.
          dbPromise = null;
          if (retry) return run<T>(store, mode, fn, false).then(resolve, reject);
          return reject(e);
        }
        let result: T;
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => {
          result = req.result as T;
          if (mode === "readonly") resolve(result);
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error ?? req.error ?? new Error("Не удалось сохранить на устройстве"));
        tx.onerror = () => reject(tx.error ?? req.error);
      })
  );
}

/** Чтение и запись одного ключа в одной транзакции — без гонок между параллельными изменениями. */
function update<T>(store: string, key: string, fn: (cur: T | undefined) => T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        const st = tx.objectStore(store);
        let next: T;
        const g = st.get(key);
        g.onsuccess = () => {
          next = fn(g.result as T | undefined);
          st.put(next, key);
        };
        tx.oncomplete = () => resolve(next);
        tx.onabort = () => reject(tx.error ?? new Error("Не удалось сохранить на устройстве"));
        tx.onerror = () => reject(tx.error);
      })
  );
}

export const idb = {
  get: <T>(store: string, key: string) => run<T | undefined>(store, "readonly", (s) => s.get(key)),
  set: (store: string, key: string, value: unknown) => run<IDBValidKey>(store, "readwrite", (s) => s.put(value, key)),
  del: (store: string, key: string) => run<undefined>(store, "readwrite", (s) => s.delete(key)),
  keys: (store: string) => run<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()),
  update,
};
