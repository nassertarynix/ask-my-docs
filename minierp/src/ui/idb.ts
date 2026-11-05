/**
 * Where the database file lives between visits: one record in IndexedDB.
 * Every function degrades quietly (returns null / false) when IndexedDB is not available,
 * e.g. in some private windows, so the app still works for the session, just without saving.
 */
const NAME = 'minierp';
const STORE = 'files';
const KEY = 'database';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function loadBytes(): Promise<Uint8Array | null> {
  try {
    const value = await withStore<unknown>('readonly', (store) => store.get(KEY));
    return value instanceof Uint8Array ? value : null;
  } catch {
    return null;
  }
}

export async function saveBytes(bytes: Uint8Array): Promise<boolean> {
  try {
    await withStore('readwrite', (store) => store.put(bytes, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function clearBytes(): Promise<boolean> {
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
    return true;
  } catch {
    return false;
  }
}
