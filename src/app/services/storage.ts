import { Injectable, inject, signal } from '@angular/core';
import { PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  blobToDataUrl,
  dataUrlToBlob,
  idbWriteStores,
  idbDelete,
  idbGet,
  idbGetAll,
  idbOpen,
  idbPut,
} from '../utils/idb';

export interface MediaRecord {
  id: string;
  blob: Blob;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: string;
  remoteUrl?: string;
}

export interface MediaSummary {
  id: string;
  bytes: number;
  width: number;
  height: number;
  contentType: string;
  createdAt: string;
  remoteUrl?: string;
}

export type BackupCollections = Record<string, unknown>;

export interface BackupPayload {
  app: 'sm-enterprise-x1';
  kind: 'full-backup';
  schema: number;
  exportedAt: string;
  collections: BackupCollections;
  media: { id: string; dataUrl: string; contentType: string; bytes: number; width: number; height: number; createdAt: string; remoteUrl?: string }[];
}

export interface ImportReport {
  collections: number;
  records: number;
  media: number;
  conflicts: number;
  skipped: string[];
}

/**
 * The application database.
 *
 * Data lives in IndexedDB (`sm_enterprise`) with an in-memory mirror so the
 * existing synchronous signal plumbing keeps working: every collection is one
 * record keyed by its storage name, images are Blobs in the `media` store, and
 * `meta` holds the one-time migration flag plus atomic document counters.
 * If IndexedDB is unavailable the same API falls back to localStorage.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  static readonly DB_NAME = 'sm_enterprise';
  static readonly DB_VERSION = 1;
  static readonly COLLECTIONS_STORE = 'collections';
  static readonly MEDIA_STORE = 'media';
  static readonly META_STORE = 'meta';

  private platformId = inject(PLATFORM_ID);
  private db?: IDBDatabase;
  private cache = new Map<string, unknown>();
  private pending = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private draining?: Promise<void>;
  private restoring = false;
  private objectUrls = new Map<string, string>();
  private mediaVersion = 0;
  /** localStorage keys folded into the database the first time it opens. */
  private static readonly LEGACY_KEYS = [
    'sm_products_v2', 'sm_categories_v2', 'sm_sub_categories_v2', 'sm_brands_v2',
    'sm_product_models_v2', 'sm_variations_v2', 'sm_parties_v1', 'sm_sales_v1',
    'sm_purchases_v1', 'sm_expenses_v1', 'sm_payments_v1', 'sm_supplier_returns_v1',
    'sm_cash_closings_v1', 'sm_sales_returns_v1', 'sm_staff_advances_v1', 'sm_quotations_v1',
    'sm_installments_v1', 'sm_wallet_accounts_v1', 'sm_wallet_txns_v1', 'sm_observations_v1',
    'sm_hrm_staff_v1', 'sm_attendance_v1', 'sm_hrm_leaves_v1', 'sm_salary_payments_v1', 'sm_rent_payments_v1',
    'sm_online_requests_v1', 'sm_damage_records_v1', 'sm_warranties_v1',
    'sm_battery_vouchers_v1', 'sm_warranty_receipts_v1', 'sm_warranty_replacements_v1',
    'sm_warranty_stock_v1', 'sm_warranty_settings_v1', 'sm_recycle_v1',
    'sm_warehouses_v1', 'sm_voucher_settings_v2', 'sm_users_v1', 'sm_session_v1', 'sm_audit_v1',
    'sm_cloud_key_v1',
    'sm_voucher_view_v1', 'sm_parties_view_v1', 'sm_purchase_view_v1', 'sm_expenses_view_v1',
  ];

  ready = signal(false);
  backend = signal<'indexeddb' | 'localstorage'>('localstorage');
  lastError = signal<string | null>(null);
  // ------------------------------------------------------------------
  // Multi-tab: every tab writes. A collection is one whole array, so the last
  // save of that collection wins, and each save is broadcast to the other tabs,
  // which reload the changed collection in place.
  // ------------------------------------------------------------------
  // Login state is per-device, not shop data: mirror it to localStorage as well
  // so a refresh right after login still finds it, before the queued IndexedDB
  // write lands (read() falls back to this copy).
  private static readonly LOCAL_MIRROR = new Set(['sm_session_v1', 'sm_cloud_key_v1', 'sm_device_key_v1']);
  /** Stable per browser tab (sessionStorage survives a reload). */
  private readonly tabId = (() => {
    try {
      const existing = sessionStorage.getItem('sm_tab_id');
      if (existing) return existing;
      const id = `tab-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem('sm_tab_id', id);
      return id;
    } catch {
      return `tab-${Math.random().toString(36).slice(2, 10)}`;
    }
  })();

  private channel?: BroadcastChannel;

  private watchOtherTabs(): void {
    this.bindStorageFallback();
    if (typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel('sm_enterprise_tabs');
    this.channel.onmessage = (event: MessageEvent<{ id: string; kind: string; key?: string }>) => {
      if (event.data?.id === this.tabId) return;
      if (event.data?.kind === 'data' && event.data.key) void this.refreshKey(event.data.key);
      if (event.data?.kind === 'reload') void this.refreshAll();
    };
  }

  /** Without IndexedDB each collection is a localStorage value, so the storage event is the channel. */
  private bindStorageFallback(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    window.addEventListener('storage', event => {
      if (this.db || !event.key) return;
      const value = this.parseLocal<unknown>(event.key);
      if (value === null) this.cache.delete(event.key);
      else this.cache.set(event.key, value);
      for (const listener of this.remoteListeners) listener();
    });
  }

  private remoteListeners = new Set<() => void>();

  /** Fires when another tab saved, so open pages refresh in place. */
  onRemoteChange(listener: () => void): () => void {
    this.remoteListeners.add(listener);
    return () => this.remoteListeners.delete(listener);
  }

  private sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  /** A restore or wipe replaced the whole database; pick it up wholesale. */
  private async refreshAll(): Promise<void> {
    const db = this.db;
    if (!db || this.restoring) return;
    try {
      const cache = this.cache;
      const rows = await idbGetAll<{ key: string; value: unknown }>(db, StorageService.COLLECTIONS_STORE);
      if (this.restoring || this.cache !== cache) return;
      const present = new Set(rows.map(row => row.key));
      for (const key of [...this.cache.keys()]) if (!present.has(key)) this.cache.delete(key);
      for (const row of rows) this.cache.set(row.key, row.value);
      for (const listener of this.remoteListeners) listener();
    } catch {
      /* the restoring tab's next save broadcasts again */
    }
  }

  private async refreshKey(key: string): Promise<void> {
    const db = this.db;
    if (!db || this.restoring) return;
    try {
      const cache = this.cache;
      const row = await idbGet<{ value: unknown }>(db, StorageService.COLLECTIONS_STORE, key);
      if (this.restoring || this.cache !== cache) return;
      this.cache.set(key, row ? row.value : null);
      for (const listener of this.remoteListeners) listener();
    } catch {
      /* the next save from the other tab will retry */
    }
  }

  private writeListeners = new Set<(key: string) => void>();

  /** Called for every collection write — the cloud sync subscribes to this. */
  onWrite(listener: (key: string) => void): () => void {
    this.writeListeners.add(listener);
    return () => this.writeListeners.delete(listener);
  }

  async init(): Promise<void> {
    if (this.ready()) return;
    if (!isPlatformBrowser(this.platformId)) {
      this.ready.set(true);
      return;
    }
    try {
      this.db = await idbOpen(StorageService.DB_NAME, StorageService.DB_VERSION, (db) => {
        if (!db.objectStoreNames.contains(StorageService.COLLECTIONS_STORE)) {
          db.createObjectStore(StorageService.COLLECTIONS_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(StorageService.MEDIA_STORE)) {
          db.createObjectStore(StorageService.MEDIA_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(StorageService.META_STORE)) {
          db.createObjectStore(StorageService.META_STORE, { keyPath: 'key' });
        }
      });
      this.backend.set('indexeddb');
      const rows = await idbGetAll<{ key: string; value: unknown }>(this.db, StorageService.COLLECTIONS_STORE);
      for (const row of rows) this.cache.set(row.key, row.value);
      await this.migrateLegacy();
      // Queued writes must land if the tab is hidden or closed a moment later.
      window.addEventListener('pagehide', () => { this.drainInBackground(); });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.drainInBackground();
      });
    } catch (error) {
      this.db = undefined;
      this.backend.set('localstorage');
      this.lastError.set(this.text(error));
      this.loadFromLocalStorage();
    }
    this.watchOtherTabs();
    this.ready.set(true);
  }

  /** Synchronous read of the mirrored value; null means "never stored". */
  read<T>(key: string): T | null {
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      return value === undefined || value === null ? null : (value as T);
    }
    const legacy = this.parseLocal<T>(key);
    if (legacy !== null) this.cache.set(key, legacy);
    return legacy;
  }

  write(key: string, value: unknown): void {
    this.assertNotRestoring();
    // Auto-save effects rerun after another tab's change arrives; saving an
    // identical value would broadcast it back as a fresh write and the tabs
    // would keep refreshing each other forever.
    if (this.cache.has(key) && this.sameValue(this.cache.get(key), value)) return;
    this.cache.set(key, value);
    for (const listener of this.writeListeners) listener(key);
    if (StorageService.LOCAL_MIRROR.has(key) && isPlatformBrowser(this.platformId)) {
      // The session must survive a refresh that happens right after login, before
      // the queued IndexedDB write lands; read() already falls back to this copy.
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota/private mode — the IndexedDB copy still follows */
      }
    }
    if (this.db) {
      this.pending.add(key);
      this.schedule();
    } else if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        this.lastError.set(this.text(error));
      }
    }
  }

  remove(key: string): void {
    this.assertNotRestoring();
    this.cache.delete(key);
    this.pending.delete(key);
    if (this.db) {
      void idbDelete(this.db, StorageService.COLLECTIONS_STORE, key).catch(error => this.lastError.set(this.text(error)));
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  keys(): string[] {
    return [...this.cache.keys()].filter(k => this.cache.get(k) !== null);
  }

  /** Force every queued collection write to hit the database now. */
  async flush(): Promise<void> {
    // DataService persists through Angular effects, which are scheduled rather
    // than synchronous, so an edit made a moment ago may not be queued yet.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    this.cancelDrainTimer();
    this.assertNotRestoring();
    await this.drain();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.drainInBackground();
    }, 40);
  }

  private cancelDrainTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private drainInBackground(): void {
    if (this.restoring) return;
    // Retain failed writes for an explicit flush or subsequent edit, not an
    // automatic retry loop (quota failures can persist indefinitely).
    void this.drain().catch(error => this.lastError.set(this.text(error)));
  }

  private drain(): Promise<void> {
    if (this.draining) return this.draining;
    const task = this.drainPending();
    this.draining = task.finally(() => { this.draining = undefined; });
    return this.draining;
  }

  private async drainPending(): Promise<void> {
    const db = this.db;
    if (!db) return;
    while (this.pending.size) {
      const key = this.pending.values().next().value!;
      // Remove just this version; an edit during the transaction queues the key
      // again, and the serialized loop persists the newer value afterwards.
      this.pending.delete(key);
      try {
        await idbPut(db, StorageService.COLLECTIONS_STORE, { key, value: this.cache.get(key), updatedAt: new Date().toISOString() });
      } catch (error) {
        if (this.cache.has(key)) this.pending.add(key);
        this.cancelDrainTimer();
        this.lastError.set(this.text(error));
        throw error;
      }
      this.channel?.postMessage({ id: this.tabId, kind: 'data', key });
    }
    if (!this.pending.size) this.lastError.set(null);
  }

  private assertNotRestoring(): void {
    if (this.restoring) throw new Error('A database restore is in progress.');
  }

  private async migrateLegacy(): Promise<void> {
    const db = this.db;
    if (!db) return;
    const done = await idbGet<{ value: boolean }>(db, StorageService.META_STORE, 'legacy-migrated');
    if (done?.value) return;
    const moved: string[] = [];
    for (const key of StorageService.LEGACY_KEYS) {
      const value = this.parseLocal<unknown>(key);
      if (value === null || this.cache.has(key)) continue;
      this.cache.set(key, value);
      await idbPut(db, StorageService.COLLECTIONS_STORE, { key, value, updatedAt: new Date().toISOString() });
      moved.push(key);
    }
    await idbPut(db, StorageService.META_STORE, { key: 'legacy-migrated', value: true, moved });
  }

  private loadFromLocalStorage(): void {
    for (const key of StorageService.LEGACY_KEYS) {
      const value = this.parseLocal<unknown>(key);
      if (value !== null) this.cache.set(key, value);
    }
  }

  private parseLocal<T>(key: string): T | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      // Values written by older builds could be bare strings (session username).
      try {
        const raw = localStorage.getItem(key);
        return raw === null || raw === '' ? null : (raw as unknown as T);
      } catch {
        return null;
      }
    }
  }

  // ------------------------------------------------------------------
  // media store
  // ------------------------------------------------------------------
  async putMedia(record: MediaRecord): Promise<void> {
    this.assertNotRestoring();
    if (!this.db) throw new Error('media requires indexeddb');
    await idbPut(this.db, StorageService.MEDIA_STORE, record);
    this.mediaVersion++;
    const url = this.objectUrls.get(record.id);
    if (url) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(record.id);
    }
  }

  async getMedia(id: string): Promise<MediaRecord | undefined> {
    if (!this.db) return undefined;
    return idbGet<MediaRecord>(this.db, StorageService.MEDIA_STORE, id);
  }

  async listMedia(): Promise<MediaSummary[]> {
    if (!this.db) return [];
    const rows = await idbGetAll<MediaRecord>(this.db, StorageService.MEDIA_STORE);
    return rows
      .map(r => ({ id: r.id, bytes: r.bytes, width: r.width, height: r.height, contentType: r.contentType, createdAt: r.createdAt, remoteUrl: r.remoteUrl }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async deleteMedia(id: string): Promise<void> {
    this.assertNotRestoring();
    if (!this.db) return;
    await idbDelete(this.db, StorageService.MEDIA_STORE, id);
    this.mediaVersion++;
    const url = this.objectUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(id);
    }
  }

  /** Object URL for a stored image, cached for the life of the session. */
  async mediaUrl(id: string): Promise<string | null> {
    const existing = this.objectUrls.get(id);
    if (existing) return existing;
    const version = this.mediaVersion;
    const record = await this.getMedia(id);
    if (version !== this.mediaVersion) return this.mediaUrl(id);
    if (!record) return null;
    const cached = this.objectUrls.get(id);
    if (cached) return cached;
    const url = URL.createObjectURL(record.blob);
    this.objectUrls.set(id, url);
    return url;
  }

  // ------------------------------------------------------------------
  // meta / atomic counters
  // ------------------------------------------------------------------
  async nextCounter(name: string): Promise<number> {
    const db = this.db;
    if (!db) return Date.now();
    const row = await idbGet<{ key: string; value: number }>(db, StorageService.META_STORE, `counter:${name}`);
    const next = (row?.value ?? 0) + 1;
    await idbPut(db, StorageService.META_STORE, { key: `counter:${name}`, value: next });
    return next;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    if (!this.db) return;
    await idbPut(this.db, StorageService.META_STORE, { key, value, updatedAt: new Date().toISOString() });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    if (!this.db) return undefined;
    const row = await idbGet<{ key: string; value: T }>(this.db, StorageService.META_STORE, key);
    return row?.value;
  }

  // ------------------------------------------------------------------
  // whole-database backup / restore
  // ------------------------------------------------------------------
  async exportBackup(): Promise<BackupPayload> {
    await this.flush();
    const collections: BackupCollections = {};
    for (const key of this.keys()) collections[key] = this.read(key);
    const media: BackupPayload['media'] = [];
    if (this.db) {
      const rows = await idbGetAll<MediaRecord>(this.db, StorageService.MEDIA_STORE);
      for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
        media.push({
          id: row.id,
          dataUrl: await blobToDataUrl(row.blob),
          contentType: row.contentType,
          bytes: row.bytes,
          width: row.width,
          height: row.height,
          createdAt: row.createdAt,
          remoteUrl: row.remoteUrl,
        });
      }
    }
    return { app: 'sm-enterprise-x1', kind: 'full-backup', schema: StorageService.DB_VERSION, exportedAt: new Date().toISOString(), collections, media };
  }

  /** Collections only: image blobs stay out, records keep their Cloudinary links. */
  async exportCollections(): Promise<BackupPayload> {
    await this.flush();
    const collections: BackupCollections = {};
    for (const key of this.keys()) collections[key] = this.read(key);
    return { app: 'sm-enterprise-x1', kind: 'full-backup', schema: StorageService.DB_VERSION,
      exportedAt: new Date().toISOString(), collections, media: [] };
  }

  async importBackup(payload: BackupPayload, mode: 'replace' | 'merge' = 'replace'): Promise<ImportReport> {
    this.assertNotRestoring();
    // Validation and decoding must finish before even cancelling pending writes.
    const validated = validateBackup(payload);
    if (mode !== 'replace' && mode !== 'merge') throw new Error('Invalid restore mode.');
    const db = this.db;
    if (!db) throw new Error('Restore requires IndexedDB; localStorage cannot be replaced atomically.');
    const report: ImportReport = { collections: 0, records: 0, media: 0, conflicts: 0, skipped: [] };
    this.restoring = true;
    this.cancelDrainTimer();
    let rollbackLocal: (() => void) | undefined;
    try {
      // Wait for an already-running drain, without flushing or discarding queued
      // edits. They stay intact if staging or the replacement transaction fails.
      await this.draining;
      const staged = mode === 'replace' ? new Map<string, unknown>() : new Map(this.cache);
      for (const [key, value] of Object.entries(validated.collections)) {
        const merged = mode === 'merge'
          ? mergeBackupData(staged.has(key) ? staged.get(key) : this.parseLocal(key), value)
          : { value, conflicts: 0 };
        staged.set(key, merged.value);
        report.conflicts += merged.conflicts;
        report.collections++;
        report.records += Array.isArray(value) ? value.length : 1;
      }
      const existingMedia = mode === 'merge'
        ? new Set((await idbGetAll<MediaRecord>(db, StorageService.MEDIA_STORE)).map(row => row.id))
        : new Set<string>();
      const media = validated.media.filter(item => {
        if (!existingMedia.has(item.id)) return true;
        report.conflicts++;
        return false;
      });
      // Remove only owned/known collection fallbacks, never a broad sm_* prefix.
      // Save exact strings so an aborted IDB transaction can restore them.
      rollbackLocal = this.dropLocalStorage(mode === 'replace'
        ? [...StorageService.LEGACY_KEYS, ...this.cache.keys(), ...staged.keys()]
        : [...staged.keys()]);
      await idbWriteStores(db, [
        { name: StorageService.COLLECTIONS_STORE, clear: mode === 'replace', rows: [...staged].map(([key, value]) => ({ key, value, updatedAt: new Date().toISOString() })) },
        { name: StorageService.MEDIA_STORE, clear: mode === 'replace', rows: media },
        { name: StorageService.META_STORE, rows: [{ key: 'legacy-migrated', value: true }] },
      ]);
      rollbackLocal = undefined;
      this.cache = staged;
      this.pending.clear();
      this.lastError.set(null);
      if (mode === 'replace') this.revokeObjectUrls();
      report.media = media.length;
      // Other tabs hold the replaced snapshot in memory until told otherwise.
      this.channel?.postMessage({ id: this.tabId, kind: 'reload' });
      return report;
    } catch (error) {
      try {
        rollbackLocal?.();
      } catch (rollbackError) {
        const failure = new Error(`${this.text(error)}; localStorage rollback failed: ${this.text(rollbackError)}`);
        this.lastError.set(failure.message);
        throw failure;
      }
      this.lastError.set(this.text(error));
      throw error;
    } finally {
      this.restoring = false;
      // No automatic retries after a failed restore. An explicit flush or edit
      // can retry the retained pending writes.
    }
  }

  /** Remove every record — used by the "clear all data" action. */
  async wipe(): Promise<void> {
    this.assertNotRestoring();
    if (this.db) {
      await this.importBackup({ app: 'sm-enterprise-x1', kind: 'full-backup', schema: StorageService.DB_VERSION,
        exportedAt: new Date().toISOString(), collections: {}, media: [] });
      return;
    }
    try {
      this.dropLocalStorage([...StorageService.LEGACY_KEYS, ...this.cache.keys()]);
      this.cache.clear();
      this.pending.clear();
      this.cancelDrainTimer();
      this.revokeObjectUrls();
    } catch (error) {
      this.lastError.set(this.text(error));
      throw error;
    }
  }

  private revokeObjectUrls(): void {
    this.mediaVersion++;
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  private dropLocalStorage(keys: string[]): () => void {
    if (!isPlatformBrowser(this.platformId)) return () => undefined;
    const saved = new Map<string, string>();
    // Read everything before removing anything (access may be denied).
    for (const key of new Set(keys)) {
      const value = localStorage.getItem(key);
      if (value !== null) saved.set(key, value);
    }
    const removed = new Map<string, string>();
    const rollback = () => {
      for (const [key, value] of removed) localStorage.setItem(key, value);
    };
    try {
      for (const [key, value] of saved) {
        localStorage.removeItem(key);
        removed.set(key, value);
      }
    } catch (error) {
      rollback();
      throw error;
    }
    return rollback;
  }

  async usage(): Promise<{ collections: number; records: number; media: number; mediaBytes: number }> {
    const media = await this.listMedia();
    let records = 0;
    for (const key of this.keys()) {
      const value = this.read<unknown>(key);
      records += Array.isArray(value) ? value.length : 1;
    }
    return {
      collections: this.keys().length,
      records,
      media: media.length,
      mediaBytes: media.reduce((sum, m) => sum + (m.bytes || 0), 0),
    };
  }

  private text(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

function validateBackup(payload: unknown): { collections: BackupCollections; media: MediaRecord[] } {
  const invalid = () => new Error('Invalid or unsupported full backup.');
  const date = (value: unknown) => typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
  if (!isRecord(payload) || payload['app'] !== 'sm-enterprise-x1' || payload['kind'] !== 'full-backup'
      || payload['schema'] !== StorageService.DB_VERSION || !date(payload['exportedAt'])
      || !isRecord(payload['collections']) || !Array.isArray(payload['media'])) throw invalid();
  const seen = new Set<object>();
  const validateJson = (value: unknown): void => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || seen.has(value)) throw invalid();
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw invalid();
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw invalid();
      validateJson(child);
    }
    seen.delete(value);
  };
  validateJson(payload['collections']);
  if (Object.keys(payload['collections']).some(key => !key.trim())) throw invalid();
  // Detach staged values from the caller while asynchronous work is in progress.
  const collections = JSON.parse(JSON.stringify(payload['collections'])) as BackupCollections;
  const ids = new Set<string>();
  const media = payload['media'].map((item: unknown): MediaRecord => {
    if (!isRecord(item) || typeof item['id'] !== 'string' || !item['id'].trim() || ids.has(item['id'])
        || typeof item['dataUrl'] !== 'string' || !/^data:[^,]*;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item['dataUrl'])
        || typeof item['contentType'] !== 'string' || !item['contentType'].trim() || !date(item['createdAt'])
        || !['bytes', 'width', 'height'].every(key => typeof item[key] === 'number' && Number.isSafeInteger(item[key]) && item[key] >= 0)) throw invalid();
    if (item['remoteUrl'] !== undefined) {
      if (typeof item['remoteUrl'] !== 'string') throw invalid();
      const url = new URL(item['remoteUrl']);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid();
    }
    const blob = dataUrlToBlob(item['dataUrl']);
    if (blob.size !== item['bytes']) throw invalid();
    ids.add(item['id']);
    return { id: item['id'], blob, contentType: item['contentType'], bytes: item['bytes'] as number,
      width: item['width'] as number, height: item['height'] as number, createdAt: item['createdAt'] as string,
      ...(item['remoteUrl'] === undefined ? {} : { remoteUrl: item['remoteUrl'] as string }) };
  });
  return { collections, media };
}

export function mergeBackupData(local: unknown, remote: unknown): { value: unknown; conflicts: number } {
  if (local === null || local === undefined) return { value: remote, conflicts: 0 };

  if (Array.isArray(local) && Array.isArray(remote)) {
    const merged = [...local];
    const localIds = new Set(local.filter(hasId).map(item => String(item['id'])));
    const localValues = new Set(local.filter(item => !hasId(item)).map(item => JSON.stringify(item)));
    let conflicts = 0;

    for (const item of remote) {
      if (hasId(item)) {
        const id = String(item['id']);
        if (localIds.has(id)) {
          const current = merged.find(value => hasId(value) && String(value['id']) === id);
          if (JSON.stringify(current) !== JSON.stringify(item)) conflicts++;
          continue;
        }
        localIds.add(id);
        merged.push(item);
        continue;
      }
      const serialized = JSON.stringify(item);
      if (!localValues.has(serialized)) {
        localValues.add(serialized);
        merged.push(item);
      }
    }

    return { value: merged, conflicts };
  }

  if (isRecord(local) && isRecord(remote)) {
    const merged: Record<string, unknown> = { ...local };
    let conflicts = 0;
    for (const [key, remoteValue] of Object.entries(remote)) {
      if (!(key in local)) {
        merged[key] = remoteValue;
        continue;
      }
      const result = mergeBackupData(local[key], remoteValue);
      merged[key] = result.value;
      conflicts += result.conflicts;
    }
    return { value: merged, conflicts };
  }

  return {
    value: local,
    conflicts: JSON.stringify(local) === JSON.stringify(remote) ? 0 : 1
  };
}

function hasId(value: unknown): value is Record<string, unknown> & { id: unknown } {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'id' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
