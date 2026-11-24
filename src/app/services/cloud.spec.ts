import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BACKEND_VERSION_KEY, CLOUD_CONFIG_KEY, CloudService } from './cloud';
import { DataService } from './data';
import { NotificationService } from './notification';
import { StorageService } from './storage';

interface Row { collection: string; row_id: string; data: Record<string, unknown>; updated_at?: string }
const PRODUCTS = 'sm_products_v2';
const WAREHOUSES = 'sm_warehouses_v1';
const SETTINGS = 'sm_voucher_settings_v2';

function installLocalStorage(): void {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value)
  } });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function signature(value: unknown): string {
  const text = canonical(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x85ebca6b;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function fakeClient(initial: Row[] = []) {
  const table = new Map(initial.map(row => [`${row.collection}:${row.row_id}`, structuredClone(row)]));
  const blockedDeletes = new Set<string>();
  const failingDeletes = new Set<string>();
  /** Server clock: every accepted write stamps a newer `updated_at`. */
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  const stamp = () => new Date(clock += 1000).toISOString();
  for (const row of table.values()) row.updated_at ??= stamp();
  /** Payload downloads, so a test can prove an idle sync downloads nothing. */
  const reads = { full: {} as Record<string, number>, delta: {} as Record<string, number>, deltaRows: 0 };
  let beforeWrite: (() => void) | undefined;
  const client = {
    from() {
      let mode: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
      let payload: Row | Partial<Row> | undefined;
      let collectionValue: string | undefined;
      let rowValue: string | undefined;
      let since = false;
      const order: { column: string; ascending: boolean }[] = [];
      const filters: ((row: Row) => boolean)[] = [];
      let start = 0;
      let end = 999;
      const bump = (row: Row) => { row.updated_at = stamp(); };
      const sortRows = (rows: Row[]) => {
        if (!order.length) return rows;
        return [...rows].sort((a, b) => {
          for (const clause of order) {
            const left = String((a as unknown as Record<string, unknown>)[clause.column] ?? '');
            const right = String((b as unknown as Record<string, unknown>)[clause.column] ?? '');
            const diff = left < right ? -1 : left > right ? 1 : 0;
            if (diff) return clause.ascending ? diff : -diff;
          }
          return 0;
        });
      };
      const run = () => {
        if (mode !== 'select') {
          beforeWrite?.();
          beforeWrite = undefined;
        }
        if (mode === 'insert') {
          const row = payload as Row;
          const key = `${row.collection}:${row.row_id}`;
          if (table.has(key)) return { data: null, error: { code: '23505', message: 'duplicate' } };
          bump(row);
          table.set(key, structuredClone(row));
          return { data: [{ row_id: row.row_id }], error: null };
        }
        if (mode === 'upsert') {
          const row = payload as Row;
          const key = `${row.collection}:${row.row_id}`;
          table.set(key, { ...structuredClone(table.get(key) ?? row), ...structuredClone(row), updated_at: stamp() } as Row);
          return { data: [{ row_id: row.row_id }], error: null };
        }
        const matches = [...table.values()].filter(row => filters.every(match => match(row)));
        if (mode === 'delete') {
          if (matches.some(row => failingDeletes.has(row.collection))) throw new Error('network down');
          // Mimics row-level security: a blocked collection reports no rows.
          const removed = matches.filter(row => !blockedDeletes.has(row.collection));
          for (const row of removed) table.delete(`${row.collection}:${row.row_id}`);
          return { data: removed.map(row => ({ row_id: row.row_id })), error: null };
        }
        if (mode === 'update') {
          for (const row of matches) {
            Object.assign(row, structuredClone(payload));
            bump(row);
          }
          return { data: matches.map(row => ({ row_id: row.row_id })), error: null };
        }
        const page = structuredClone(sortRows(matches).slice(start, end + 1));
        if (collectionValue) {
          if (since) {
            reads.delta[collectionValue] = (reads.delta[collectionValue] ?? 0) + 1;
            reads.deltaRows += page.length;
          } else if (end > 0 && !rowValue) {
            reads.full[collectionValue] = (reads.full[collectionValue] ?? 0) + 1;
          }
        }
        return { data: page, error: null };
      };
      const builder = {
        select: () => builder,
        order: (column: string, options?: { ascending?: boolean }) => {
          order.push({ column, ascending: options?.ascending !== false });
          return builder;
        },
        range: (a: number, b: number) => { start = a; end = b; return builder; },
        insert: (row: Row) => { mode = 'insert'; payload = row; return builder; },
        upsert: (row: Row) => { mode = 'upsert'; payload = row; return builder; },
        update: (row: Partial<Row>) => { mode = 'update'; payload = row; return builder; },
        delete: () => { mode = 'delete'; return builder; },
        eq: (column: string, value: unknown) => {
          if (column === 'collection' && typeof value === 'string') collectionValue = value;
          if (column === 'row_id' && typeof value === 'string') rowValue = value;
          filters.push(row => column === 'data' ? canonical(row.data) === canonical(JSON.parse(String(value))) :
            String((row as unknown as Record<string, unknown>)[column]) === String(value));
          return builder;
        },
        gt: (column: string, value: unknown) => {
          if (column === 'updated_at') since = true;
          filters.push(row => String((row as unknown as Record<string, unknown>)[column] ?? '') > String(value));
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          const allowed = new Set(values.map(String));
          filters.push(row => allowed.has(String((row as unknown as Record<string, unknown>)[column])));
          return builder;
        },
        then: (resolve: (value: unknown) => void) => resolve(run())
      };
      return builder;
    },
    channel: () => ({ on: () => ({ subscribe: () => undefined }) }),
    removeChannel: () => undefined
  };
  return {
    client: client as unknown as SupabaseClient,
    table,
    reads,
    beforeWrite: (fn: () => void) => { beforeWrite = fn; },
    blockDelete: (collection: string) => void blockedDeletes.add(collection),
    failDelete: (collection: string) => void failingDeletes.add(collection),
    touch: (id: string, data: Record<string, unknown>, collection = PRODUCTS) => {
      // An edit arrives well after the rows it sits next to, outside the re-read window.
      clock += 600_000;
      table.set(`${collection}:${id}`, { collection, row_id: id, data: structuredClone(data), updated_at: stamp() });
    }
  };
}

interface Product { id: string; name: string; optional?: string }
function setup(initial: Product[] = [{ id: 'p1', name: 'A' }], remote: Row[] = [], localSettings: Record<string, unknown> | null = null) {
  installLocalStorage();
  const values = new Map<string, unknown>([[PRODUCTS, initial]]);
  if (localSettings) values.set(SETTINGS, localSettings);
  const products = signal(initial);
  const warehouses = signal<string[]>([]);
  const settings = signal<Record<string, unknown> | null>(localSettings);
  const writes: string[] = [];
  const storage = {
    isWriter: () => true,
    flush: async () => undefined,
    read: <T,>(key: string) => (values.get(key) ?? null) as T | null,
    write: (key: string, value: unknown) => {
      writes.push(key);
      values.set(key, value);
      if (key === PRODUCTS) products.set(value as Product[]);
      if (key === WAREHOUSES) warehouses.set(value as string[]);
      if (key === SETTINGS) settings.set(value as Record<string, unknown> | null);
    },
    onWrite: () => () => undefined,
    importBackup: async (payload: { collections?: Record<string, unknown> }) => {
      const keep = payload.collections ?? {};
      values.clear();
      for (const [key, value] of Object.entries(keep)) values.set(key, value);
      products.set((keep[PRODUCTS] as Product[]) ?? []);
      warehouses.set((keep[WAREHOUSES] as string[]) ?? []);
      settings.set((keep[SETTINGS] as Record<string, unknown> | null) ?? null);
      return { collections: Object.keys(keep).length, records: 0, media: 0, conflicts: 0, skipped: [] };
    }
  } as unknown as StorageService;
  const data = {
    collections: () => [{ key: PRODUCTS, signal: products }, { key: WAREHOUSES, signal: warehouses }],
    voucherSettings: settings
  } as unknown as DataService;
  TestBed.configureTestingModule({ providers: [
    { provide: StorageService, useValue: storage }, { provide: DataService, useValue: data }
  ] });
  const service = TestBed.inject(CloudService);
  service.load();
  service.save({ supabase: { url: 'https://example.supabase.co', anonKey: 'public-test-key', shopKey: 'test-shop', enabled: true }, autoSync: true });
  // Sync is gated by the verified login-derived key; seed both without booting.
  Object.assign(service as unknown as { userKeyValue: string; keyVerified: boolean },
    { userKeyValue: 'a'.repeat(64), keyVerified: true });
  const cloud = fakeClient(remote);
  (service as unknown as { supabase: () => Promise<SupabaseClient> }).supabase = async () => cloud.client;
  return { service, products, warehouses, settings, writes, ...cloud };
}

function internal(service: CloudService) {
  return service as unknown as {
    pushed: Map<string, Map<string, string>>;
    synced: Map<string, Set<string>>;
    editTimes: Map<string, Map<string, string>>;
    refreshPending(): void;
    applyRealtime(row: Row): Promise<void>;
    outbox: Set<string>;
    retryOutbox(): Promise<void>;
    stampLocalEdits(key: string): void;
  };
}
function row(id: string, data: Record<string, unknown>, collection = PRODUCTS): Row {
  return { collection, row_id: id, data };
}
function baseline(service: CloudService, data: Record<string, unknown>, id = 'p1'): void {
  internal(service).pushed.set(PRODUCTS, new Map([[id, signature(data)]]));
}

describe('CloudService reconciliation', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('takes the newest server row when this device has no edit time', async () => {
    const { service, products } = setup([{ id: 'p1', name: 'Local cache' }], [row('p1', { id: 'p1', name: 'Remote edit' })]);
    baseline(service, { id: 'p1', name: 'Old' });
    const report = await service.pullAll();
    expect(report.conflicts).toBe(0);
    expect(products()).toEqual([{ id: 'p1', name: 'Remote edit' }]);
    expect(service.syncConflicts()).toHaveLength(0);
  });

  it('publishes a pulled collection once, not once per row', async () => {
    const remote = [
      row('p1', { id: 'p1', name: 'A' }), row('p2', { id: 'p2', name: 'B' }), row('p3', { id: 'p3', name: 'C' })
    ];
    const { service, products, writes } = setup([], remote);
    await service.pullAll();
    expect(products()).toEqual([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }]);
    expect(writes.filter(key => key === PRODUCTS)).toHaveLength(1);
  });

  it('keeps a local edit stamped later than the server row', async () => {
    const { service, products, table } = setup([{ id: 'p1', name: 'Local edit' }], [row('p1', { id: 'p1', name: 'Remote edit' })]);
    baseline(service, { id: 'p1', name: 'Old' });
    internal(service).editTimes.set(PRODUCTS, new Map([['p1', '2099-01-01T00:00:00.000Z']]));
    await service.pullAll();
    expect(products()).toEqual([{ id: 'p1', name: 'Local edit' }]);
    await service.pushCollection(PRODUCTS);
    expect(table.get(`${PRODUCTS}:p1`)!.data['name']).toBe('Local edit');
  });

  it('accepts a remote edit when the local row still matches the baseline', async () => {
    const { service, products } = setup([{ id: 'p1', name: 'Old' }], [row('p1', { id: 'p1', name: 'New' })]);
    baseline(service, { id: 'p1', name: 'Old' });
    const report = await service.pullAll();
    expect(report.error).toBeUndefined();
    expect(products()).toEqual([{ id: 'p1', name: 'New' }]);
  });

  it('ships an offline deletion as a conditional tombstone', async () => {
    const { service, products, table } = setup([], [row('p1', { id: 'p1', name: 'A' })]);
    baseline(service, { id: 'p1', name: 'A' });
    internal(service).synced.set(PRODUCTS, new Set(['p1']));
    internal(service).editTimes.set(PRODUCTS, new Map([['p1', new Date().toISOString()]]));
    await service.pushCollection(PRODUCTS);
    expect(products()).toEqual([]);
    expect(typeof table.get(`${PRODUCTS}:p1`)!.data['__deleted']).toBe('string');
  });

  it('removes a tombstoned row on pull and keeps its deletion acknowledged', async () => {
    const { service, products } = setup([{ id: 'p1', name: 'A' }], [row('p1', { __deleted: '2026-11-07T00:00:00.000Z' })]);
    baseline(service, { id: 'p1', name: 'A' });
    await service.pullAll();
    expect(products()).toEqual([]);
    await service.pullAll();
    expect(products()).toEqual([]);
    expect(service.pendingRows()).toBe(0);
  });

  it('retries a newer local edit after a competing cloud write', async () => {
    const { service, products, table, beforeWrite } = setup([{ id: 'p1', name: 'Local' }], [row('p1', { id: 'p1', name: 'Old' })]);
    baseline(service, { id: 'p1', name: 'Old' });
    internal(service).editTimes.set(PRODUCTS, new Map([['p1', '2099-01-01T00:00:00.000Z']]));
    beforeWrite(() => { table.get(`${PRODUCTS}:p1`)!.data = { id: 'p1', name: 'Competing' }; });
    await service.pushCollection(PRODUCTS);
    expect(table.get(`${PRODUCTS}:p1`)!.data['name']).toBe('Local');
    expect(products()).toEqual([{ id: 'p1', name: 'Local' }]);
    expect(service.syncConflicts()).toHaveLength(0);
  });

  it('uploads a saved collection even when the page no longer shows it', async () => {
    const { service, table } = setup([{ id: 'p1', name: 'Saved sale' }], []);
    internal(service).outbox.add(PRODUCTS);
    await internal(service).retryOutbox();
    expect(table.get(`${PRODUCTS}:p1`)!.data['name']).toBe('Saved sale');
    expect(internal(service).outbox.size).toBe(0);
  });

  it('uploads a local row that never reached the outbox', async () => {
    const { service, table } = setup([{ id: 'p1', name: 'Saved by an older build' }], []);
    await internal(service).retryOutbox();
    expect(table.get(`${PRODUCTS}:p1`)!.data['name']).toBe('Saved by an older build');
    expect(internal(service).outbox.size).toBe(0);
  });

  it('keeps a failed upload queued without a popup and clears it after a later retry', async () => {
    const { service, table, beforeWrite } = setup([{ id: 'p1', name: 'Saved sale' }], []);
    const helper = internal(service);
    helper.outbox.add(PRODUCTS);
    let offline = true;
    beforeWrite(() => { if (offline) { offline = false; throw new Error('offline'); } });
    await helper.retryOutbox();
    expect(helper.outbox.has(PRODUCTS)).toBe(true);
    expect(service.status()).toBe('error');
    expect(service.statusMessage()).toContain('offline');
    expect(TestBed.inject(NotificationService).toasts()).toHaveLength(0);
    await helper.retryOutbox();
    expect(table.get(`${PRODUCTS}:p1`)!.data['name']).toBe('Saved sale');
    expect(helper.outbox.size).toBe(0);
    expect(service.status()).toBe('online');
    expect(TestBed.inject(NotificationService).toasts()).toHaveLength(0);
  });

  it('does not let a leftover copy revive a row the server deleted', async () => {
    const deletedAt = '2026-11-07T00:00:00.000Z';
    const { service, products, table } = setup([{ id: 'p1', name: 'Stale copy' }], [row('p1', { __deleted: deletedAt })]);
    const helper = internal(service);
    helper.pushed.set(PRODUCTS, new Map([['p1', `deleted:${deletedAt}`]]));
    helper.synced.set(PRODUCTS, new Set(['p1']));
    // Any local array rewrite used to stamp this leftover as a fresh edit.
    helper.stampLocalEdits(PRODUCTS);
    expect(helper.editTimes.get(PRODUCTS)?.has('p1') ?? false).toBe(false);
    await service.pushCollection(PRODUCTS);
    expect(table.get(`${PRODUCTS}:p1`)!.data['__deleted']).toBe(deletedAt);
    expect(products()).toEqual([]);
  });

  it('adds a row from realtime using the current server value', async () => {
    const { service, products, table } = setup([], []);
    table.set(`${PRODUCTS}:p2`, row('p2', { id: 'p2', name: 'Current' }));
    await internal(service).applyRealtime(row('p2', { id: 'p2', name: 'Delayed echo' }));
    expect(products()).toEqual([{ id: 'p2', name: 'Current' }]);
  });

  it('catches up even when the last pull timestamp is recent', async () => {
    const { service, products } = setup([{ id: 'p1', name: 'A' }], [row('p2', { id: 'p2', name: 'B' })]);
    service.save({ lastPullAt: new Date().toISOString() });
    await service.boot();
    expect(products()).toContainEqual({ id: 'p2', name: 'B' });
  });

  it('clears business rows with tombstones while preserving accounts, settings and counters', async () => {
    const { service, table, products } = setup([{ id: 'p1', name: 'A' }], [
      row('p1', { id: 'p1', name: 'A' }), row('owner', { id: 'owner' }, 'sm_users_v1'),
      row('settings', { title: 'Shop' }, SETTINGS), row('INV', { next: 7 }, '__counters')
    ]);
    await service.pauseSync();
    expect(await service.deleteAllRows()).toBe(1);
    expect(table.has(`${PRODUCTS}:p1`)).toBe(true);
    expect(typeof table.get(`${PRODUCTS}:p1`)!.data['__deleted']).toBe('string');
    expect(table.has('sm_users_v1:owner')).toBe(true);
    expect(table.get('__counters:INV')!.data['next']).toBe(7);
    expect(products()).toEqual([{ id: 'p1', name: 'A' }]);
  });

  it('wipes this device’s cached shop but keeps voucher settings when a hard reset runs offline', async () => {
    const saved = { signatureImage: 'data:image/png;base64,AAAA', greetingText: 'ধন্যবাদ' };
    const { service, products, settings } = setup([{ id: 'p1', name: 'A' }], [], saved);
    service.save({ supabase: { url: 'https://example.supabase.co', anonKey: 'public-test-key', enabled: false } });
    const result = await service.hardReset();
    expect(result.ok).toBe(true);
    expect(products()).toEqual([]);
    expect(settings()).toEqual(saved);
    expect(service.pendingRows()).toBe(0);
  });

  it('deletes every cloud business row, keeps accounts and voucher settings, and records the reset marker', async () => {
    const { service, products, settings, table } = setup([{ id: 'p1', name: 'A' }], [
      row('p1', { id: 'p1', name: 'A' }), row('n0', { value: 'Main' }, WAREHOUSES),
      row('owner', { id: 'owner' }, 'sm_users_v1'), row('settings', { title: 'Shop' }, SETTINGS)
    ], { signatureImage: 'data:image/png;base64,AAAA' });
    expect(await service.hardReset()).toEqual({ ok: true, deleted: 2 });
    expect(products()).toEqual([]);
    expect(settings()).toEqual({ signatureImage: 'data:image/png;base64,AAAA' });
    expect([...table.keys()].sort()).toEqual(['sm_meta_v1:reset', 'sm_users_v1:owner', 'sm_voucher_settings_v2:settings']);
    expect(table.get('sm_meta_v1:reset')!.data['resetAt']).toEqual(expect.any(String));
  });

  it('keeps this device intact and withdraws the marker when rows cannot be deleted', async () => {
    const { service, products, table, blockDelete } = setup(
      [{ id: 'p1', name: 'A' }], [row('p1', { id: 'p1', name: 'A' })]
    );
    blockDelete(PRODUCTS);
    expect(await service.hardReset()).toEqual({ ok: false, error: 'incomplete' });
    expect(products()).toEqual([{ id: 'p1', name: 'A' }]);
    expect(table.has(`${PRODUCTS}:p1`)).toBe(true);
    expect(table.has('sm_meta_v1:reset')).toBe(false);
  });

  it('withdraws the reset marker when a delete request fails mid-way', async () => {
    const { service, products, table, failDelete } = setup(
      [{ id: 'p1', name: 'A' }], [row('p1', { id: 'p1', name: 'A' })]
    );
    failDelete(PRODUCTS);
    expect(await service.hardReset()).toEqual({ ok: false, error: 'network down' });
    expect(products()).toEqual([{ id: 'p1', name: 'A' }]);
    expect(table.has('sm_meta_v1:reset')).toBe(false);
  });

  it('requires explicit restored-data review before uploading', async () => {
    const { service, table } = setup([{ id: 'p1', name: 'Restored' }], [row('p1', { id: 'p1', name: 'Cloud' })]);
    await service.pauseSync();
    await service.markRestoredData();
    service.resumeAfterMaintenance();
    await expect(service.pushCollection(PRODUCTS)).rejects.toThrow();
    const report = await service.reconcileRestoredData();
    expect(report.conflicts).toBe(1);
    expect(service.restoreIntent()).not.toBeNull();
    expect((await service.chooseRemote(PRODUCTS, 'p1')).resolved).toBe(true);
    expect(service.restoreIntent()).toBeNull();
    expect(service.config().autoSync).toBe(false);
    expect(table.get(`${PRODUCTS}:p1`)!.data['name']).toBe('Cloud');
    expect(service.syncConflicts()).toHaveLength(0);
  });

  it('maps a legacy warehouse tombstone to its recorded name after a reorder', async () => {
    const { service, warehouses, table } = setup([], [
      row('n0', { value: 'A' }, WAREHOUSES), row('n1', { value: 'B' }, WAREHOUSES)
    ]);
    warehouses.set(['A', 'B']);
    await service.pullAll();
    warehouses.set(['B', 'A']);
    table.set(`${WAREHOUSES}:n0`, row('n0', { __deleted: '2026-11-07T00:00:00.000Z' }, WAREHOUSES));
    await service.pullAll();
    expect(warehouses()).toEqual(['B']);
  });

  it('pulls voucher settings even though no list page owns them', async () => {
    const { service, settings } = setup([], [row('settings', { title: 'Updated shop' }, SETTINGS)]);
    await service.pullAll();
    expect(settings()?.['title']).toBe('Updated shop');
  });

  it('normalizes undefined properties and server key order out of pending counts', async () => {
    const { service, products, table } = setup([{ id: 'p1', name: 'A', optional: undefined }]);
    await service.pushCollection(PRODUCTS);
    const stored = table.get(`${PRODUCTS}:p1`)!.data;
    products.set([{ name: stored['name'], id: stored['id'] } as Product]);
    internal(service).refreshPending();
    expect(service.pendingRows()).toBe(0);
    expect(stored).not.toHaveProperty('optional');
  });

  it('adopts a newly deployed backend once, then keeps a later manual change', () => {
    installLocalStorage();
    const values = new Map<string, unknown>([[CLOUD_CONFIG_KEY, {
      supabase: { url: 'https://old.supabase.co', anonKey: 'old-key', shopKey: 'old', enabled: true },
      cloudinary: { cloudName: 'old-cloud', uploadPreset: 'old-preset', folder: 'old', enabled: true },
      autoSync: true,
      lastPushAt: null,
      lastPullAt: null
    }]]);
    const storage = {
      isWriter: () => true,
      flush: async () => undefined,
      read: <T,>(key: string) => (values.get(key) ?? null) as T | null,
      write: (key: string, value: unknown) => { values.set(key, value); },
      onWrite: () => () => undefined
    } as unknown as StorageService;
    const data = {
      collections: () => [],
      voucherSettings: signal<Record<string, unknown> | null>(null)
    } as unknown as DataService;
    TestBed.configureTestingModule({ providers: [
      { provide: StorageService, useValue: storage }, { provide: DataService, useValue: data }
    ] });
    const service = TestBed.inject(CloudService);
    Object.assign(service as unknown as { runtimeConfig: unknown }, {
      runtimeConfig: {
        supabase: { url: 'https://new.supabase.co', anonKey: 'new-key', shopKey: '', enabled: true },
        cloudinary: { cloudName: 'new-cloud', uploadPreset: 'new-preset', folder: 'new', enabled: true },
        version: 'backend-v2'
      }
    });

    service.load();
    expect(service.config().supabase.url).toBe('https://new.supabase.co');
    expect(values.get(BACKEND_VERSION_KEY)).toBe('backend-v2');

    service.save({ supabase: { url: 'https://custom.supabase.co', anonKey: 'custom-key', shopKey: '', enabled: true } });
    service.load();
    expect(service.config().supabase.url).toBe('https://custom.supabase.co');
  });

  it('does not replace a saved backend when the deployment version is unchanged', () => {
    installLocalStorage();
    const values = new Map<string, unknown>([[CLOUD_CONFIG_KEY, {
      supabase: { url: 'https://custom.supabase.co', anonKey: 'custom-key', shopKey: '', enabled: true },
      cloudinary: { cloudName: 'custom-cloud', uploadPreset: 'custom-preset', folder: 'custom', enabled: true },
      autoSync: true,
      lastPushAt: null,
      lastPullAt: null
    }], [BACKEND_VERSION_KEY, 'backend-v2']]);
    const storage = {
      isWriter: () => true,
      flush: async () => undefined,
      read: <T,>(key: string) => (values.get(key) ?? null) as T | null,
      write: (key: string, value: unknown) => { values.set(key, value); },
      onWrite: () => () => undefined
    } as unknown as StorageService;
    const data = {
      collections: () => [],
      voucherSettings: signal<Record<string, unknown> | null>(null)
    } as unknown as DataService;
    TestBed.configureTestingModule({ providers: [
      { provide: StorageService, useValue: storage }, { provide: DataService, useValue: data }
    ] });
    const service = TestBed.inject(CloudService);
    Object.assign(service as unknown as { runtimeConfig: unknown }, {
      runtimeConfig: {
        supabase: { url: 'https://new.supabase.co', anonKey: 'new-key', shopKey: '', enabled: true },
        cloudinary: { cloudName: 'new-cloud', uploadPreset: 'new-preset', folder: 'new', enabled: true },
        version: 'backend-v2'
      }
    });

    service.load();
    expect(service.config().supabase.url).toBe('https://custom.supabase.co');
  });
});

describe('incremental pulls', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('downloads no rows on a sync where the cloud did not change', async () => {
    const { service, products, reads } = setup([{ id: 'p1', name: 'A' }], [row('p1', { id: 'p1', name: 'A' })]);
    await service.boot(false, [PRODUCTS]);
    const full = reads.full[PRODUCTS] ?? 0;
    expect(full).toBe(1);

    await service.syncPage([PRODUCTS]);
    await service.syncPage([PRODUCTS]);
    expect(reads.full[PRODUCTS] ?? 0).toBe(full);
    expect(reads.delta[PRODUCTS] ?? 0).toBe(0);
    expect(products()).toEqual([{ id: 'p1', name: 'A' }]);
  });

  it('downloads only the rows stamped after the watermark', async () => {
    const old = (id: string, name: string, at: string) => ({ ...row(id, { id, name }), updated_at: at });
    const { service, products, reads, touch } = setup(
      [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }],
      [
        old('p1', 'A', '2025-12-01T00:00:00.000Z'), old('p2', 'B', '2025-12-02T00:00:00.000Z'),
        old('p3', 'C', '2025-12-03T00:00:00.000Z')
      ]
    );
    await service.boot(false, [PRODUCTS]);
    const full = reads.full[PRODUCTS] ?? 0;
    reads.deltaRows = 0;

    touch('p3', { id: 'p3', name: 'Edited elsewhere' });
    await service.syncPage([PRODUCTS]);
    expect(reads.full[PRODUCTS] ?? 0).toBe(full);
    expect(reads.delta[PRODUCTS]).toBe(1);
    expect(reads.deltaRows).toBe(1);
    expect(products()).toContainEqual({ id: 'p3', name: 'Edited elsewhere' });
    expect(products()).toContainEqual({ id: 'p1', name: 'A' });
    expect(products()).toContainEqual({ id: 'p2', name: 'B' });
  });

  it('applies a deletion delivered as a newer tombstone', async () => {
    const { service, products, touch } = setup(
      [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
      [row('p1', { id: 'p1', name: 'A' }), row('p2', { id: 'p2', name: 'B' })]
    );
    await service.boot(false, [PRODUCTS]);
    touch('p1', { __deleted: '2026-02-01T00:00:00.000Z' });
    await service.syncPage([PRODUCTS]);
    expect(products()).toEqual([{ id: 'p2', name: 'B' }]);
  });

  it('rebuilds a collection whose local copy disappeared even though marks survived', async () => {
    const { service, products, reads } = setup([{ id: 'p1', name: 'A' }], [row('p1', { id: 'p1', name: 'A' })]);
    await service.boot(false, [PRODUCTS]);
    const full = reads.full[PRODUCTS] ?? 0;

    products.set([]);
    await service.syncPage([PRODUCTS]);
    expect(reads.full[PRODUCTS] ?? 0).toBe(full + 1);
    expect(products()).toEqual([{ id: 'p1', name: 'A' }]);
  });

  it('reads a single row for a realtime echo', async () => {
    const { service, products, reads, touch } = setup([{ id: 'p1', name: 'A' }], [row('p1', { id: 'p1', name: 'A' })]);
    await service.boot(false, [PRODUCTS]);
    const full = reads.full[PRODUCTS] ?? 0;
    touch('p1', { id: 'p1', name: 'Remote' });
    await internal(service).applyRealtime(row('p1', { id: 'p1', name: 'Remote' }));
    expect(products()).toEqual([{ id: 'p1', name: 'Remote' }]);
    expect(reads.full[PRODUCTS] ?? 0).toBe(full);
  });
});