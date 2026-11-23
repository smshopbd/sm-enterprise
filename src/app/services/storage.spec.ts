import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BackupPayload, mergeBackupData, StorageService } from './storage';

/** Transactional memory double: no real IndexedDB, localStorage or network. */
function memoryDb() {
  const stores = new Map(['collections', 'media', 'meta'].map(name => [name, new Map<string, Record<string, unknown>>()]));
  const control = { abortNext: false, hold: false, commits: [] as (() => void)[], transactions: 0, active: 0, maxActive: 0 };
  const db = {
    transaction(names: string | string[]) {
      control.transactions++;
      control.active++;
      control.maxActive = Math.max(control.active, control.maxActive);
      const scope = typeof names === 'string' ? [names] : names;
      const staged = new Map(scope.map(name => [name, new Map(stores.get(name)!)]));
      let aborted = false;
      const fail = control.abortNext;
      control.abortNext = false;
      const tx = {
        error: null as Error | null,
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        onerror: null as (() => void) | null,
        abort() { aborted = true; },
        objectStore(name: string) {
          const rows = staged.get(name)!;
          return {
            put(value: Record<string, unknown>) {
              const key = String(value['key'] ?? value['id']);
              rows.set(key, { ...value });
              return { result: key };
            },
            clear() { rows.clear(); return { result: undefined }; },
            delete(key: string) { rows.delete(key); return { result: undefined }; },
            get(key: string) { return { result: rows.get(key) }; },
            getAll() { return { result: [...rows.values()] }; },
          };
        },
      };
      const commit = () => {
        control.active--;
        if (aborted || fail) {
          tx.error = new Error('transaction aborted');
          tx.onabort?.();
        } else {
          for (const [name, rows] of staged) stores.set(name, rows);
          tx.oncomplete?.();
        }
      };
      if (control.hold) control.commits.push(commit);
      else queueMicrotask(commit);
      return tx;
    },
  } as unknown as IDBDatabase;
  return { db, stores, control };
}

function memoryLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
    key: index => [...values.keys()][index] ?? null,
  };
}

const PRODUCTS = 'sm_products_v2';
const backup = (): BackupPayload => ({
  app: 'sm-enterprise-x1', kind: 'full-backup', schema: 1, exportedAt: '2026-11-10T00:00:00.000Z',
  collections: { [PRODUCTS]: [{ id: 'new' }] },
  media: [{ id: 'new-image', dataUrl: 'data:image/png;base64,YQ==', contentType: 'image/png',
    bytes: 1, width: 1, height: 1, createdAt: '2026-11-10T00:00:00.000Z', remoteUrl: 'https://example.invalid/image.png' }],
});

describe('StorageService persistence', () => {
  let service: StorageService;
  let disk: ReturnType<typeof memoryDb>;
  let local: Storage;
  let revoke: ReturnType<typeof vi.fn<(url: string) => void>>;
  interface Internals { db?: IDBDatabase; cache: Map<string, unknown>; pending: Set<string>; objectUrls: Map<string, string> }
  const internals = () => service as unknown as Internals;

  beforeEach(() => {
    vi.useFakeTimers();
    local = memoryLocalStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', memoryLocalStorage());
    revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static override revokeObjectURL = revoke;
      static override createObjectURL = vi.fn(() => 'blob:isolated');
    });
    TestBed.configureTestingModule({ providers: [StorageService, { provide: PLATFORM_ID, useValue: 'browser' }] });
    service = TestBed.inject(StorageService);
    disk = memoryDb();
    internals().db = disk.db;
    internals().cache.set(PRODUCTS, [{ id: 'old' }]);
    disk.stores.get('collections')!.set(PRODUCTS, { key: PRODUCTS, value: [{ id: 'old' }] });
    disk.stores.get('media')!.set('old-image', { id: 'old-image', blob: new Blob(['old']), bytes: 3 });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('persists an edit scheduled after an explicit flush', async () => {
    service.write(PRODUCTS, ['first']);
    const flush = service.flush();
    await vi.advanceTimersByTimeAsync(0);
    await flush;
    service.write(PRODUCTS, ['second']);
    await vi.advanceTimersByTimeAsync(40);
    expect(disk.stores.get('collections')!.get(PRODUCTS)!['value']).toEqual(['second']);
  });

  it('saves from every tab and mirrors login keys to localStorage', () => {
    service.write(PRODUCTS, ['other-tab']);
    service.write('sm_session_v1', { username: 'owner' });
    service.write('sm_cloud_key_v1', 'a'.repeat(64));
    service.write('sm_device_key_v1', 'b'.repeat(32));
    expect(service.read(PRODUCTS)).toEqual(['other-tab']);
    expect(service.read('sm_session_v1')).toEqual({ username: 'owner' });
    expect(service.read('sm_cloud_key_v1')).toBe('a'.repeat(64));
    expect(service.read('sm_device_key_v1')).toBe('b'.repeat(32));
    expect(local.getItem('sm_cloud_key_v1')).toBe(JSON.stringify('a'.repeat(64)));
  });

  it('skips a save that matches the stored value so open tabs never echo', () => {
    const written: string[] = [];
    service.onWrite(key => written.push(key));
    service.write(PRODUCTS, [{ id: 'old' }]);
    expect(written).toEqual([]);
    service.write(PRODUCTS, [{ id: 'new' }]);
    expect(written).toEqual([PRODUCTS]);
  });

  it('adopts a collection saved in another tab and notifies open pages', async () => {
    const notified = vi.fn();
    service.onRemoteChange(notified);
    disk.stores.get('collections')!.set(PRODUCTS, { key: PRODUCTS, value: [{ id: 'from-other-tab' }] });
    await (service as unknown as { refreshKey(key: string): Promise<void> }).refreshKey(PRODUCTS);
    expect(service.read(PRODUCTS)).toEqual([{ id: 'from-other-tab' }]);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it('drops collections another tab wiped during a restore', async () => {
    disk.stores.get('collections')!.clear();
    await (service as unknown as { refreshAll(): Promise<void> }).refreshAll();
    expect(service.read(PRODUCTS)).toBeNull();
  });

  it('exports collections without image bytes', async () => {
    const pending = service.exportCollections();
    await vi.advanceTimersByTimeAsync(0);
    const payload = await pending;
    expect(payload.collections[PRODUCTS]).toEqual([{ id: 'old' }]);
    expect(payload.media).toEqual([]);
  });

  it('rethrows failed flush, retains keys, and retries the latest value', async () => {
    disk.control.abortNext = true;
    service.write(PRODUCTS, ['first']);
    service.write('sm_sales_v1', ['sale']);
    const rejected = expect(service.flush()).rejects.toThrow('transaction aborted');
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
    expect(internals().pending.size).toBe(2);
    expect(service.lastError()).toContain('transaction aborted');
    expect(disk.stores.get('collections')!.get(PRODUCTS)!['value']).toEqual([{ id: 'old' }]);
    service.write(PRODUCTS, ['latest']);
    const retry = service.flush();
    await vi.advanceTimersByTimeAsync(0);
    await retry;
    expect(disk.stores.get('collections')!.get(PRODUCTS)!['value']).toEqual(['latest']);
    expect(disk.stores.get('collections')!.get('sm_sales_v1')!['value']).toEqual(['sale']);
  });

  it('reports background failures without an unhandled rejection or retry loop', async () => {
    disk.control.abortNext = true;
    service.write(PRODUCTS, ['failed']);
    await vi.advanceTimersByTimeAsync(40);
    expect(service.lastError()).toContain('transaction aborted');
    const attempts = disk.control.transactions;
    await vi.advanceTimersByTimeAsync(5000);
    expect(disk.control.transactions).toBe(attempts);
    expect(internals().pending.has(PRODUCTS)).toBe(true);
  });

  it('serializes overlapping drains and persists an in-flight edit last', async () => {
    disk.control.hold = true;
    service.write(PRODUCTS, ['first']);
    await vi.advanceTimersByTimeAsync(40);
    service.write(PRODUCTS, ['second']);
    const flush = service.flush();
    await vi.advanceTimersByTimeAsync(40);
    expect(disk.control.transactions).toBe(1);
    disk.control.hold = false;
    disk.control.commits.shift()!();
    await flush;
    expect(disk.control.maxActive).toBe(1);
    expect(disk.stores.get('collections')!.get(PRODUCTS)!['value']).toEqual(['second']);
  });

  it.each([
    { collections: null }, { collections: [] }, { kind: 'other' }, { schema: 99 }, { exportedAt: 'bad' },
    { media: null }, { media: [{ ...backup().media[0], dataUrl: 'not-an-image' }] },
    { media: [{ ...backup().media[0], bytes: 99 }] }, { media: [backup().media[0], backup().media[0]] },
    { media: [{ ...backup().media[0], remoteUrl: 'javascript:alert(1)' }] },
    { collections: { [PRODUCTS]: undefined } },
  ])('rejects malformed backup without mutation: %j', async patch => {
    service.write(PRODUCTS, ['pending']);
    local.setItem(PRODUCTS, 'legacy');
    await expect(service.importBackup({ ...backup(), ...patch } as unknown as BackupPayload)).rejects.toThrow();
    expect(service.read(PRODUCTS)).toEqual(['pending']);
    expect(internals().pending.has(PRODUCTS)).toBe(true);
    expect(local.getItem(PRODUCTS)).toBe('legacy');
    expect(disk.control.transactions).toBe(0);
    expect(disk.stores.get('media')!.has('old-image')).toBe(true);
  });

  it('preserves cache, pending writes, fallback strings and URLs on transaction abort', async () => {
    service.write(PRODUCTS, ['pending']);
    local.setItem(PRODUCTS, 'legacy');
    internals().objectUrls.set('old-image', 'blob:old');
    disk.control.abortNext = true;
    await expect(service.importBackup(backup())).rejects.toThrow('transaction aborted');
    expect(service.read(PRODUCTS)).toEqual(['pending']);
    expect(internals().pending.has(PRODUCTS)).toBe(true);
    expect(local.getItem(PRODUCTS)).toBe('legacy');
    expect(disk.stores.get('media')!.has('old-image')).toBe(true);
    expect(disk.stores.get('collections')!.get(PRODUCTS)!['value']).toEqual([{ id: 'old' }]);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('atomically replaces both stores, removes owned fallbacks and revokes obsolete URLs', async () => {
    const obsolete = ['sm_warranty_receipts_v1', 'sm_warranty_replacements_v1', 'sm_warranty_stock_v1', 'sm_warranty_settings_v1', 'sm_recycle_v1'];
    for (const key of [PRODUCTS, ...obsolete]) local.setItem(key, '["stale"]');
    for (const key of ['sm_cloud_config_v1', 'sm_sync_ids_v1', 'sm_device_key_v1']) local.setItem(key, 'keep');
    internals().objectUrls.set('old-image', 'blob:old');
    disk.control.hold = true;
    const restoring = service.importBackup(backup());
    await Promise.resolve();
    expect(service.read(PRODUCTS)).toEqual([{ id: 'old' }]);
    expect(() => service.write(PRODUCTS, ['racing'])).toThrow('restore');
    disk.control.commits.shift()!();
    const report = await restoring;
    expect(report.media).toBe(1);
    expect(disk.control.transactions).toBe(1);
    expect(service.read(PRODUCTS)).toEqual([{ id: 'new' }]);
    expect([...disk.stores.get('media')!.keys()]).toEqual(['new-image']);
    expect(disk.stores.get('media')!.get('new-image')!['remoteUrl']).toBe(backup().media[0].remoteUrl);
    for (const key of [PRODUCTS, ...obsolete]) expect(local.getItem(key)).toBeNull();
    for (const key of obsolete) expect(service.read(key)).toBeNull();
    for (const key of ['sm_cloud_config_v1', 'sm_sync_ids_v1', 'sm_device_key_v1']) expect(local.getItem(key)).toBe('keep');
    expect(revoke).toHaveBeenCalledWith('blob:old');
  });

  it('preserves existing media and merges collections atomically', async () => {
    const report = await service.importBackup(backup(), 'merge');
    expect(report.media).toBe(1);
    expect(service.read(PRODUCTS)).toEqual([{ id: 'old' }, { id: 'new' }]);
    expect([...disk.stores.get('media')!.keys()]).toEqual(['old-image', 'new-image']);
  });

  it('exports and imports media remoteUrl', async () => {
    await service.importBackup(backup());
    // FileReader uses the DOM event loop, not the fake timer clock.
    vi.useRealTimers();
    const exported = await service.exportBackup();
    expect(exported.media[0].remoteUrl).toBe(backup().media[0].remoteUrl);
    await service.importBackup(exported);
    expect((await service.getMedia('new-image'))!.remoteUrl).toBe(backup().media[0].remoteUrl);
  });

  it('requires IDB for restore and reports fallback quota errors without deleting configuration', async () => {
    internals().db = undefined;
    local.setItem('sm_session_v1', 'session');
    local.setItem('sm_cloud_config_v1', 'config');
    await expect(service.importBackup(backup())).rejects.toThrow('requires IndexedDB');
    expect(service.read(PRODUCTS)).toEqual([{ id: 'old' }]);
    vi.spyOn(local, 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
    service.write(PRODUCTS, ['unsaved']);
    expect(service.lastError()).toBe('quota exceeded');
    expect(local.getItem('sm_session_v1')).toBe('session');
    expect(local.getItem('sm_cloud_config_v1')).toBe('config');
  });

  it('does not begin a replacement if fallback cleanup fails', async () => {
    local.setItem(PRODUCTS, 'legacy');
    local.setItem('sm_recycle_v1', 'recycle');
    const remove = local.removeItem.bind(local);
    vi.spyOn(local, 'removeItem').mockImplementation(key => {
      if (key === 'sm_recycle_v1') throw new Error('storage denied');
      remove(key);
    });
    await expect(service.importBackup(backup())).rejects.toThrow('storage denied');
    expect(local.getItem(PRODUCTS)).toBe('legacy');
    expect(service.read(PRODUCTS)).toEqual([{ id: 'old' }]);
    expect(disk.control.transactions).toBe(0);
  });

  it('wipes both stores and obsolete fallback keys only after commit', async () => {
    local.setItem('sm_recycle_v1', '["stale"]');
    local.setItem('sm_cloud_config_v1', 'keep');
    internals().objectUrls.set('old-image', 'blob:old');
    await service.wipe();
    expect(disk.stores.get('collections')!.size).toBe(0);
    expect(disk.stores.get('media')!.size).toBe(0);
    expect(service.keys()).toEqual([]);
    expect(service.read('sm_recycle_v1')).toBeNull();
    expect(local.getItem('sm_cloud_config_v1')).toBe('keep');
    expect(revoke).toHaveBeenCalledWith('blob:old');
  });
});

describe('mergeBackupData', () => {
  it('adds remote records without replacing local records with the same id', () => {
    const local = [
      { id: 'sale-1', total: 500 },
      { id: 'sale-local', total: 250 }
    ];
    const remote = [
      { id: 'sale-1', total: 700 },
      { id: 'sale-remote', total: 300 }
    ];

    expect(mergeBackupData(local, remote)).toEqual({
      value: [
        { id: 'sale-1', total: 500 },
        { id: 'sale-local', total: 250 },
        { id: 'sale-remote', total: 300 }
      ],
      conflicts: 1
    });
  });

  it('keeps existing settings while filling fields that only exist remotely', () => {
    expect(mergeBackupData(
      { shopName: 'Local name', localOnly: true },
      { shopName: 'Remote name', currency: 'BDT' }
    )).toEqual({
      value: { shopName: 'Local name', localOnly: true, currency: 'BDT' },
      conflicts: 1
    });
  });

  it('preserves local values when a scalar value conflicts', () => {
    expect(mergeBackupData(10, 12)).toEqual({ value: 10, conflicts: 1 });
  });
});
