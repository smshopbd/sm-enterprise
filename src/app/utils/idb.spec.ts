import { vi } from 'vitest';
import { idbGet, idbPut, idbWriteStores } from './idb';

/** Controlled request/transaction events; never opens a browser database. */
function controlledDb() {
  const request = { result: 'saved-key', onsuccess: null as (() => void) | null };
  const store = { put: vi.fn(() => request), get: vi.fn(() => request), clear: vi.fn() };
  const tx = {
    error: null as Error | null,
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    objectStore: vi.fn(() => store),
    abort: vi.fn(() => queueMicrotask(() => tx.onabort?.())),
  };
  const transaction = vi.fn(() => tx);
  return { db: { transaction } as unknown as IDBDatabase, transaction, tx, request, store };
}

describe('IndexedDB transaction promises', () => {
  it('does not resolve a put on request success, only on transaction complete', async () => {
    const { db, tx, request } = controlledDb();
    const resolved = vi.fn();
    const pending = idbPut(db, 'collections', { key: 'k' }).then(resolved);
    request.onsuccess?.();
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    tx.oncomplete?.();
    await pending;
    expect(resolved).toHaveBeenCalledWith('saved-key');
  });

  it('rejects an abort after a successful request', async () => {
    const { db, tx, request } = controlledDb();
    const pending = idbPut(db, 'collections', { key: 'k' });
    request.onsuccess?.();
    tx.error = new Error('commit failed');
    tx.onabort?.();
    await expect(pending).rejects.toThrow('commit failed');
  });

  it('waits for rollback after a transaction error', async () => {
    const { db, tx } = controlledDb();
    const rejected = vi.fn();
    const pending = idbPut(db, 'collections', { key: 'k' }).catch(rejected);
    tx.error = new Error('quota');
    tx.onerror?.();
    await Promise.resolve();
    expect(rejected).not.toHaveBeenCalled();
    tx.onabort?.();
    await pending;
    expect(rejected).toHaveBeenCalledWith(tx.error);
  });

  it('returns read results after transaction completion', async () => {
    const { db, tx } = controlledDb();
    const pending = idbGet(db, 'collections', 'k');
    tx.oncomplete?.();
    await expect(pending).resolves.toBe('saved-key');
  });

  it('clears and writes all replacement stores in one readwrite transaction', async () => {
    const { db, tx, store, transaction } = controlledDb();
    const pending = idbWriteStores(db, [
      { name: 'collections', clear: true, rows: [{ key: 'k', value: [] }] },
      { name: 'media', clear: true, rows: [{ id: 'image' }] },
    ]);
    expect(transaction).toHaveBeenCalledExactlyOnceWith(['collections', 'media'], 'readwrite');
    expect(store.clear).toHaveBeenCalledTimes(2);
    expect(store.put).toHaveBeenCalledTimes(2);
    tx.oncomplete?.();
    await expect(pending).resolves.toBeUndefined();
  });

  it('aborts previously queued clears when staging a put throws', async () => {
    const { db, tx, store } = controlledDb();
    store.put.mockImplementation(() => { throw new Error('DataCloneError'); });
    const pending = idbWriteStores(db, [
      { name: 'collections', clear: true, rows: [{ key: 'uncloneable' }] },
      { name: 'media', clear: true, rows: [] },
    ]);
    await expect(pending).rejects.toThrow('DataCloneError');
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(tx.abort).toHaveBeenCalledOnce();
  });

  it('rejects transaction creation failures', async () => {
    const { db, transaction } = controlledDb();
    transaction.mockImplementation(() => { throw new Error('database closed'); });
    await expect(idbPut(db, 'collections', {})).rejects.toThrow('database closed');
  });
});
