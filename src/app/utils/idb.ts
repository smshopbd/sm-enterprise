// Minimal promise wrapper over IndexedDB used by StorageService.
// Every helper degrades to a rejected promise when the platform has no IDB
// (SSR, private mode) so callers can fall back to their own in-memory cache.

export type IdbMode = 'readonly' | 'readwrite';

export function idbOpen(name: string, version: number, upgrade: (db: IDBDatabase, tx: IDBVersionChangeEvent) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb-unavailable'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, version);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = (event) => {
      upgrade(request.result, event);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
    request.onblocked = () => reject(new Error('indexeddb-blocked'));
  });
}

export function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return run<T>(db, store, 'readonly', tx => tx.objectStore(store).get(key));
}

export function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return run<T[]>(db, store, 'readonly', tx => tx.objectStore(store).getAll());
}

export function idbGetAllKeys(db: IDBDatabase, store: string): Promise<IDBValidKey[]> {
  return run<IDBValidKey[]>(db, store, 'readonly', tx => tx.objectStore(store).getAllKeys());
}

export function idbPut(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
  return run<IDBValidKey>(db, store, 'readwrite', tx => key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key));
}

export function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<undefined> {
  return run<undefined>(db, store, 'readwrite', tx => tx.objectStore(store).delete(key));
}

export function idbClear(db: IDBDatabase, store: string): Promise<undefined> {
  return run<undefined>(db, store, 'readwrite', tx => tx.objectStore(store).clear());
}

/** Queue all changes synchronously in one transaction; never publish before commit. */
export function idbWriteStores(db: IDBDatabase, stores: { name: string; rows: unknown[]; clear?: boolean }[]): Promise<void> {
  return transaction(db, stores.map(store => store.name), 'readwrite', tx => {
    for (const { name, rows, clear } of stores) {
      const store = tx.objectStore(name);
      if (clear) store.clear();
      for (const row of rows) store.put(row);
    }
    return () => undefined;
  });
}

function run<T>(db: IDBDatabase, store: string, mode: IdbMode, action: (tx: IDBTransaction) => IDBRequest): Promise<T> {
  return transaction(db, store, mode, tx => {
    const request = action(tx);
    return () => request.result as T;
  });
}

function transaction<T>(db: IDBDatabase, stores: string | string[], mode: IdbMode, action: (tx: IDBTransaction) => () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      reject(error);
      return;
    }
    let result: () => T;
    let failure: unknown;
    tx.oncomplete = () => resolve(result());
    // A request error bubbles before rollback finishes. Wait for abort so callers
    // cannot start a replacement while the failed transaction is still active.
    tx.onerror = () => { failure = tx.error ?? new Error('indexeddb-transaction-failed'); };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('indexeddb-transaction-aborted'));
    try {
      result = action(tx);
    } catch (error) {
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error);
      }
    }
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('blob-read-failed'));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body = ''] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
