import { Injectable, inject, signal } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { StorageService } from './storage';
import { DataService } from './data';
import type { VoucherSettings } from './data';
import { cloudKeyHash } from '../utils/secret';

export const CLOUD_CONFIG_KEY = 'sm_cloud_config_v1';
/** Which generated deployment config this device has already adopted. */
export const BACKEND_VERSION_KEY = 'sm_cloud_backend_v1';
export const SYNC_CONFLICTS_KEY = 'sm_sync_conflicts_v1';
/** Password-derived gate key for this device; local only, never synced or backed up. */
export const CLOUD_KEY_STORAGE = 'sm_cloud_key_v1';
/** Supabase table created by supabase/new-project.sql */
export const ROWS_TABLE = 'sm_rows';
/** Shop-wide bookkeeping that is not business data (reset generation). */
export const META_COLLECTION = 'sm_meta_v1';
/** One row that tells every device the shop was wiped at this instant. */
export const RESET_ROW_ID = 'reset';
/** Last reset this device has already applied. */
const RESET_SEEN_KEY = 'sm_reset_seen_v1';
/** When each row was edited on this device; the losing side of last-write-wins. */
const SYNC_TIMES_KEY = 'sm_sync_times_v1';
const USER_COLLECTION = 'sm_users_v1';
const SESSION_STORAGE_KEY = 'sm_session_v1';

export interface CloudSyncConflict {
  id: string;
  collection: string;
  rowId: string;
  detectedAt: string;
  local: unknown;
  remote: unknown;
  /** Original server id (older warehouse rows used positional ids). */
  remoteRowId?: string;
}

export interface ConflictResolutionResult {
  resolved: boolean;
  reason?: 'remote-changed' | 'local-changed' | 'missing-conflict';
}

export interface RestoreSyncIntent {
  backend: string;
  restoredAt: string;
  /** Wire signatures of restored rows, including explicit known deletions. */
  rows: Record<string, Record<string, string>>;
  deletedKnownIds: Record<string, string[]>;
  reconciled: boolean;
}

export const RESTORE_SYNC_INTENT_KEY = 'sm_restore_sync_intent_v1';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /**
   * Shop passphrase checked by the database policies. The public anon key alone
   * must not be enough to read or wipe the shop, so every request carries it as
   * a header and supabase/new-project.sql compares its hash.
   */
  shopKey?: string;
  enabled: boolean;
}

export interface CloudinaryConfig {
  cloudName: string;
  uploadPreset: string;
  folder: string;
  enabled: boolean;
}

export interface CloudConfig {
  supabase: SupabaseConfig;
  cloudinary: CloudinaryConfig;
  autoSync: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  /** Server timestamp of the newest row this device has seen. */
  lastRemoteAt: string | null;
}

interface PublicCloudConfig {
  supabase: SupabaseConfig;
  cloudinary: CloudinaryConfig;
  version?: string;
}

export interface SyncReport {
  pushed: number;
  deleted: number;
  pulled: number;
  collections: number;
  ms: number;
  conflicts?: number;
  error?: string;
}

export interface CloudUploadResult {
  secureUrl: string;
  publicId: string;
  bytes: number;
}

const DEFAULT_CONFIG: CloudConfig = {
  supabase: { url: '', anonKey: '', shopKey: '', enabled: false },
  cloudinary: { cloudName: '', uploadPreset: '', folder: 'sm-enterprise', enabled: false },
  autoSync: true,
  lastPushAt: null,
  lastPullAt: null,
  lastRemoteAt: null
};

/** Collections that never leave the device (credentials and sessions live there). */
const NEVER_SYNC = [CLOUD_CONFIG_KEY, BACKEND_VERSION_KEY, SYNC_CONFLICTS_KEY, 'sm_session_v1', 'sm_device_key_v1', CLOUD_KEY_STORAGE, RESET_SEEN_KEY];
/**
 * Staff accounts and the audit trail are plain storage arrays rather than
 * DataService collections, but they still have to reach the shop's other
 * devices; the sync loops below treat them as extra collections.
 */
const EXTRA_SYNC_KEYS = ['sm_users_v1', 'sm_audit_v2', 'sm_backup_index_v1'];
/** Shared invoice counters; ignored by the data sync because no page owns it. */
const COUNTER_COLLECTION = '__counters';
/** Marks a deleted row. The value is when it was deleted; readers drop the item. */
const TOMBSTONE = '__deleted';
/** Row ids the server already knew, so a deletion made after a reload still ships. */
const SYNCED_IDS_KEY = 'sm_sync_ids_v1';
/** Row payload fingerprints already accepted by the server, so a reload does not re-upload everything. */
const SYNC_SIGS_KEY = 'sm_sync_sigs_v1';
/** Per collection: newest remote `updated_at` this device already applied. */
const PULL_MARKS_KEY = 'sm_pull_marks_v1';
/** Collections edited here whose rows the server has not accepted yet. */
const OUTBOX_KEY = 'sm_sync_outbox_v1';
const UPLOAD_FAILED_PREFIX = 'আপলোড হয়নি: ';
/** A write can commit just after our read with an older stamp; re-read this window. */
const PULL_OVERLAP_MS = 120_000;

const SETTINGS_KEY = 'sm_voucher_settings_v2';
const WAREHOUSES_KEY = 'sm_warehouses_v1';
const WAREHOUSE_IDS_KEY = 'sm_sync_warehouse_ids_v1';
const ABSENT = 'absent';
type Payload = Record<string, unknown>;
interface RemoteRow { collection: string; row_id: string; data: Payload; updated_at?: string }
export interface PublicRowFilter { column: string; value: string }
type Reconciliation = 'equal' | 'remote' | 'local' | 'conflict';

/** Working copy of one collection while a batch of remote rows is reconciled. */
interface RowDraft {
  key: string;
  mutable: boolean;
  isArray: boolean;
  list: unknown[];
  /** First index per row id, matching the old `findIndex` behaviour. */
  index: Map<string, number>;
  deleted: Set<number>;
  /** Current payload per row id; `null` means "not on this device". */
  payloads: Map<string, Payload | null>;
  objectValue?: unknown;
  changed: boolean;
}

@Injectable({ providedIn: 'root' })
export class CloudService {
  private storage = inject(StorageService);
  private data = inject(DataService);
  private runtimeConfig: { supabase: SupabaseConfig; cloudinary: CloudinaryConfig; version: string } = {
    supabase: DEFAULT_CONFIG.supabase,
    cloudinary: DEFAULT_CONFIG.cloudinary,
    version: ''
  };

  readonly config = signal<CloudConfig>({ ...DEFAULT_CONFIG });
  readonly environmentWarning = signal('');
  readonly status = signal<'off' | 'connecting' | 'online' | 'error'>('off');
  readonly statusMessage = signal('');
  readonly pendingRows = signal(0);
  readonly lastResult = signal<SyncReport | null>(null);
  readonly syncConflicts = signal<CloudSyncConflict[]>([]);

  private client?: SupabaseClient;
  private clientKey = '';
  /** Key derived from the signed-in password; empty means "not logged in". */
  private userKeyValue = '';
  /**
   * Set only after the server has matched this key to an active account. Until
   * then a pull would return an empty shop (RLS hides everything) and look like
   * a remote deletion, so no sync may run.
   */
  private keyVerified = false;
  /** Concurrent callers must share one client instead of each creating one. */
  private clientPromise?: Promise<SupabaseClient | null>;
  private clientPromiseKey = '';
  /** row_id -> JSON text of the payload last accepted by the server */
  private pushed = new Map<string, Map<string, string>>();
  /** collection -> row ids the server already knows; persisted across reloads. */
  private synced = new Map<string, Set<string>>();
  /** collection -> row id -> last local edit time; drives last-write-wins. */
  private editTimes = new Map<string, Map<string, string>>();
  /** collection -> newest remote timestamp already applied; keeps pulls incremental. */
  private pulledAt = new Map<string, string>();
  /**
   * Collections this device edited and the server has not accepted yet. Unlike
   * the page scope, this survives navigation and reloads, so a sale saved just
   * before the network dropped is retried until it actually lands.
   */
  private outbox = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private applyingRemote = false;
  private realtime?: { remove: () => void };
  private retryTimer?: ReturnType<typeof setTimeout>;
  private backgroundBound = false;
  private queue: Promise<void> = Promise.resolve();
  private queuedWork = 0;
  private paused = false;
  private subscriptionGeneration = 0;
  private warehouseIds = new Map<string, string>();
  private unlistenWrite?: () => void;
  /** Collections of the page on screen; automatic pulls stay inside this set. */
  private activeScope: string[] = [];
  /** A newer page entry supersedes the previous page's queued pull. */
  private pageSyncGeneration = 0;
  /**
   * One collection is reconciled into a working copy and written back once.
   * Writing the whole array and re-serialising the sync metadata per row made a
   * page pull block the main thread for seconds on a large shop.
   */
  private drafts = new Map<string, RowDraft>();
  private metadataDirty = false;
  private metadataTimer?: ReturnType<typeof setTimeout>;
  private pendingRefreshTimer?: ReturnType<typeof setTimeout>;
  readonly restoreIntent = signal<RestoreSyncIntent | null>(null);

  async loadRuntimeConfig(): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const response = await fetch('/assets/cloud-config.json', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const config = await response.json() as PublicCloudConfig;
      if (
        !config ||
        typeof config.supabase?.url !== 'string' ||
        typeof config.supabase?.anonKey !== 'string' ||
        typeof config.cloudinary?.cloudName !== 'string' ||
        typeof config.cloudinary?.uploadPreset !== 'string' ||
        typeof config.cloudinary?.folder !== 'string'
      ) {
        throw new Error('কনফিগারেশন ফাইলের ফরম্যাট সঠিক নয়।');
      }
      this.runtimeConfig = {
        supabase: { ...DEFAULT_CONFIG.supabase, ...config.supabase },
        cloudinary: { ...DEFAULT_CONFIG.cloudinary, ...config.cloudinary },
        version: typeof config.version === 'string' ? config.version : ''
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.environmentWarning.set(`ক্লাউড কনফিগারেশন লোড করা যায়নি (${detail}); .env.local ও পুনরায় তৈরি করা কনফিগারেশন যাচাই করুন।`);
    }
  }

  load(): void {
    this.userKeyValue = this.readUserKey();
    const saved = this.storage.read<Partial<CloudConfig>>(CLOUD_CONFIG_KEY);
    const runtime = this.runtimeConfig;
    // A saved configuration normally wins so a deliberate change is never
    // reverted. But when the app is deployed against a different backend, each
    // device must adopt that backend once — otherwise old phones keep syncing
    // to the retired project. The generated version identifies the backend,
    // so later manual changes survive subsequent deploys of the same backend.
    const runtimeVersion = runtime.supabase.url && runtime.supabase.anonKey ? runtime.version : '';
    const appliedVersion = this.storage.read<string>(BACKEND_VERSION_KEY) ?? '';
    const adoptDeployment = !!runtimeVersion && appliedVersion !== runtimeVersion &&
      backendIdentity(saved?.supabase?.url ?? '') !== backendIdentity(runtime.supabase.url);
    this.config.set({
      ...DEFAULT_CONFIG,
      ...saved,
      supabase: {
        ...DEFAULT_CONFIG.supabase,
        ...runtime.supabase,
        ...(adoptDeployment ? {} : saved?.supabase)
      },
      cloudinary: {
        ...DEFAULT_CONFIG.cloudinary,
        ...runtime.cloudinary,
        ...(adoptDeployment ? {} : saved?.cloudinary)
      }
    });
    if (adoptDeployment) {
      this.storage.write(BACKEND_VERSION_KEY, runtimeVersion);
      this.writeConfig();
    }
    this.loadDestinationMetadata();
    if (this.restoreIntent()) this.config.update(c => ({ ...c, autoSync: false }));
    // Older builds stopped every upload until a human picked a side. The shop
    // now runs last-write-wins, so those leftover entries are no longer blocking.
    if (!this.restoreIntent() && this.syncConflicts().length) {
      this.syncConflicts.set([]);
      this.persistConflicts();
    }
    this.unlistenWrite?.();
    this.unlistenWrite = this.storage.onWrite(key => {
      if (key === CLOUD_CONFIG_KEY) {
        if (!this.writingConfig) this.writeConfig();
        return;
      }
      if (!NEVER_SYNC.includes(key)) this.markChanged(key);
    });
    this.startBackgroundSync();
  }

  /** Network/tab events are the only trigger a normal user should ever need. */
  private startBackgroundSync(): void {
    if (this.backgroundBound || typeof window === 'undefined') return;
    this.backgroundBound = true;
    window.addEventListener('online', () => void this.beginSync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.beginSync();
    });
    // Realtime cannot present the shop key, so row-level security filters its
    // events. A quiet poll keeps two open devices in step instead.
    window.setInterval(() => {
      if (document.visibilityState === 'visible' && this.canAutoSync()) void this.beginSync();
    }, 45_000);
  }

  /** Every automatic ingress verifies the key before reading the shop. */
  private async beginSync(): Promise<void> {
    if (!this.canAutoSync()) return;
    try {
      if (!this.keyVerified && !(await this.verifyKey())) {
        // Staying quiet here is how a device keeps saving locally while its
        // owner believes the shop is in the cloud. Report it and keep retrying.
        this.reportGateClosed();
        return;
      }
      await this.resumeSync();
      await this.retryOutbox();
    } catch (error) {
      // Fire-and-forget callers (reload, focus, poll) must not raise an
      // unhandled rejection; the status badge and retry timer take over.
      this.status.set('error');
      this.statusMessage.set(error instanceof Error ? error.message : String(error));
      this.scheduleRetry();
    }
  }

  private verifying?: Promise<boolean>;

  private verifyKey(): Promise<boolean> {
    if (this.keyVerified) return Promise.resolve(true);
    if (!this.userKeyValue || !this.isEnabled()) return Promise.resolve(false);
    // Startup restore and the splash boot can both ask at once; the shop should
    // see one probe, not two competing ones.
    if (this.verifying) return this.verifying;
    this.verifying = (async () => {
      try {
        if (await this.isClaimed() !== true) return false;
        if (!await this.probeKey()) return false;
        // Another device may have wiped the shop while this one was closed.
        // Applying it here means stale caches never upload over the reset.
        if (await this.applyPendingReset()) return false;
        return true;
      } catch {
        // An unreachable backend is a retry, not a data problem: the caller
        // runs again on the next poll, focus or online event.
        return false;
      } finally {
        this.verifying = undefined;
      }
    })();
    return this.verifying;
  }

  private async resumeSync(): Promise<void> {
    if (!this.canAutoSync()) return;
    // A recent timestamp says nothing about updates missed while disconnected,
    // so the open page still re-reads its own collections.
    await this.syncPage(this.activeScope);
  }

  /**
   * A failed upload is shown as the persistent sync chip in the header, with
   * the reason in its tooltip — never as a popup that returns on every retry.
   */
  private noteUploadFailure(error: unknown): void {
    this.status.set('error');
    this.statusMessage.set(UPLOAD_FAILED_PREFIX + (error instanceof Error ? error.message : String(error)));
    this.scheduleRetry();
  }

  private syncBlockedMessage(): string {
    return 'ক্লাউডের সাথে সংযোগ যাচাই হয়নি — পাসওয়ার্ড ও ইন্টারনেট দেখুন। সংরক্ষিত ডেটা এই ডিভাইসে আছে, ইন্টারনেট ঠিক হলে নিজেই আপলোড হবে।';
  }

  /** A closed gate must look closed: red badge, a reason, and a retry. */
  private reportGateClosed(): void {
    this.status.set('error');
    this.statusMessage.set(this.syncBlockedMessage());
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (!this.canAutoSync() || this.retryTimer || typeof window === 'undefined') return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.beginSync();
    }, 30_000);
  }

  /**
   * StorageService fires its write listeners synchronously, so a listener that
   * writes the same key recurses until the stack overflows — and because the
   * queueing happens after the listeners, the value never reaches IndexedDB.
   */
  private writingConfig = false;

  private writeConfig(): void {
    this.writingConfig = true;
    try {
      this.storage.write(CLOUD_CONFIG_KEY, this.scrub(this.config()));
    } finally {
      this.writingConfig = false;
    }
  }

  save(next: Partial<CloudConfig>): void {
    const curr = this.config();
    const merged = {
      ...curr, ...next,
      supabase: { ...curr.supabase, ...next.supabase },
      cloudinary: { ...curr.cloudinary, ...next.cloudinary }
    };
    const switching = !!curr.supabase.url && (
      backendIdentity(curr.supabase.url) !== backendIdentity(merged.supabase.url) ||
      (!!curr.supabase.shopKey && curr.supabase.shopKey !== merged.supabase.shopKey)
    );
    if (switching && (this.queuedWork || this.timers.size || this.retryTimer || this.realtime ||
      this.restoreIntent() || this.syncConflicts().length ||
      this.collectionKeys().filter(key => key !== SETTINGS_KEY && key !== 'sm_users_v1').some(key => this.rows(key).length))) {
      throw new Error('স্থানীয় ব্যবসার ডেটা বা চলমান সিঙ্ক আছে — অন্য ক্লাউড/দোকানে পরিবর্তন করা যাবে না। আগে নিরাপদে ডেটা সরিয়ে সিঙ্ক বন্ধ করুন।');
    }
    if (merged.autoSync && this.restoreIntent()) {
      throw new Error('রিস্টোর করা ডেটা আগে স্পষ্টভাবে মিলিয়ে সংঘাত সমাধান করুন; অটো সিঙ্ক এখন চালু করা যাবে না।');
    }
    this.cancelScheduling();
    this.client = undefined;
    this.clientKey = '';
    this.clientPromise = undefined;
    this.clientPromiseKey = '';
    this.config.set(switching ? { ...merged, lastPullAt: null, lastPushAt: null } : merged);
    if (switching || backendIdentity(curr.supabase.url) !== backendIdentity(merged.supabase.url)) {
      this.synced.clear();
      this.pushed.clear();
      this.editTimes.clear();
      this.pulledAt.clear();
      this.outbox.clear();
      this.warehouseIds.clear();
      this.syncConflicts.set([]);
      this.restoreIntent.set(null);
      this.config.update(c => ({ ...c, lastRemoteAt: null }));
      this.persistMetadata();
      this.persistConflicts();
      this.persistRestoreIntent();
    }
    this.writeConfig();
    if (this.canAutoSync()) this.scheduleRetry();
  }

  /** Config is local-only: strip it out of anything we put in a backup or the cloud. */
  scrub<T extends Partial<CloudConfig>>(value: T): T {
    return { ...value };
  }

  isEnabled(): boolean {
    const c = this.config();
    return c.supabase.enabled && !!c.supabase.url && !!c.supabase.anonKey;
  }

  isCloudinaryEnabled(): boolean {
    const c = this.config();
    return c.cloudinary.enabled && !!c.cloudinary.cloudName && !!c.cloudinary.uploadPreset;
  }

  // ------------------------------------------------------------------
  // login-derived gate key
  // ------------------------------------------------------------------
  hasUserKey(): boolean {
    return !!this.userKeyValue;
  }

  userKey(): string {
    return this.userKeyValue;
  }

  /** Call after a successful login: every request now carries the shop gate. */
  setUserKey(key: string): void {
    const value = (key || '').trim();
    if (!/^[a-f0-9]{64}$/.test(value)) {
      this.clearUserKey();
      return;
    }
    if (this.userKeyValue === value) return;
    this.userKeyValue = value;
    this.keyVerified = false;
    this.storage.write(CLOUD_KEY_STORAGE, value);
    this.resetClient();
  }

  /**
   * Starts the normal pull/push cycle. Separate from setUserKey so the first
   * login can upload the owner account before any data read is attempted.
   */
  startSync(): void {
    void this.beginSync();
  }

  /** A row read already proved this key; skip the extra probe on this login. */
  markKeyVerified(): void {
    this.keyVerified = true;
  }

  clearUserKey(): void {
    if (!this.userKeyValue && this.storage.read(CLOUD_KEY_STORAGE) === null) return;
    this.userKeyValue = '';
    this.keyVerified = false;
    this.storage.write(CLOUD_KEY_STORAGE, null);
    this.cancelScheduling();
    this.resetClient();
    this.status.set('off');
    this.statusMessage.set('');
  }

  private resetClient(): void {
    this.client = undefined;
    this.clientKey = '';
    this.clientPromise = undefined;
    this.clientPromiseKey = '';
    ++this.subscriptionGeneration;
    this.realtime?.remove();
    this.realtime = undefined;
  }

  /**
   * Reads the shop's account list with a key derived from a typed password.
   * Runs before login, so it never changes the device's stored key.
   */
  async pullUsers(key: string): Promise<Record<string, unknown>[] | null> {
    if (!this.isEnabled()) return null;
    const value = (key || '').trim();
    if (!/^[a-f0-9]{64}$/.test(value)) return null;
    try {
      const client = await this.temporaryClient(value);
      if (!client) return null;
      const { data, error } = await client.from(ROWS_TABLE).select('row_id,data')
        .eq('collection', 'sm_users_v1').limit(1000);
      if (error) return null;
      return (data ?? [])
        .map(row => (row as { data?: unknown }).data)
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));
    } catch {
      return null;
    }
  }

  /** Whether this database already has a password-claimed owner account. */
  async isClaimed(): Promise<boolean | null> {
    if (!this.isEnabled()) return null;
    try {
      const client = await this.temporaryClient('');
      if (!client) return null;
      const { data, error } = await client.rpc('sm_is_claimed');
      if (error) return null;
      return data === true;
    } catch {
      return null;
    }
  }

  /** Confirms the stored key still matches an active account row. */
  async probeKey(): Promise<boolean> {
    if (!this.userKeyValue || !this.isEnabled()) return false;
    try {
      const client = await this.supabase();
      if (!client) return false;
      const { data, error } = await client.from(ROWS_TABLE).select('row_id')
        .eq('collection', 'sm_users_v1')
        .eq('data->>cloudHash', cloudKeyHash(this.userKeyValue))
        .limit(1);
      if (error || !data?.length) return false;
      this.keyVerified = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Writes the first account row before any sync runs. The database allows this
   * one window only while no account carries a cloudHash, so it can never
   * overwrite a shop another device already claimed.
   */
  async claimAccount(user: Record<string, unknown>): Promise<boolean> {
    if (!this.isEnabled()) return true;
    if (!this.userKeyValue) return false;
    const id = Number(user['id']);
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    try {
      if (await this.isClaimed() !== false) return false;
      const client = await this.temporaryClient(this.userKeyValue);
      if (!client) return false;
      const { error } = await client.from(ROWS_TABLE)
        .upsert({ collection: 'sm_users_v1', row_id: String(id), data: user },
          { onConflict: 'collection,row_id' });
      if (error) return false;
      // The server must now accept this key for reads before the shop is synced.
      return this.probeKey();
    } catch {
      return false;
    }
  }

  /** Uploads accounts with the current key (used before a password switch). */
  async pushUsersNow(): Promise<boolean> {
    if (!this.isEnabled()) return true;
    if (!this.userKeyValue) return false;
    try {
      await this.enqueue(async () => {
        await this.pushCollectionInternal(USER_COLLECTION);
      }, true);
      return true;
    } catch (error) {
      this.status.set('error');
      this.statusMessage.set(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private async temporaryClient(key: string): Promise<SupabaseClient | null> {
    const { url, anonKey } = this.config().supabase;
    if (!url || !anonKey) return null;
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: fetchWithTimeout,
        headers: key ? { 'x-shop-key': key } : {}
      }
    });
  }

  private readUserKey(): string {
    const value = this.storage.read<string>(CLOUD_KEY_STORAGE);
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : '';
  }

  async supabase(): Promise<SupabaseClient | null> {
    if (!this.isEnabled()) return null;
    const { url, anonKey } = this.config().supabase;
    const key = `${url}|${anonKey}|${this.userKeyValue}`;
    if (this.client && this.clientKey === key) return this.client;
    if (this.clientPromise && this.clientPromiseKey === key) return this.clientPromise;
    this.clientPromiseKey = key;
    const pending = (async () => {
      const { createClient } = await import('@supabase/supabase-js');
      // The config may have changed while the chunk was loading; a client for
      // the previous backend must never be handed to the new one.
      if (this.clientPromiseKey !== key) return null;
      const client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: fetchWithTimeout,
          headers: this.userKeyValue ? { 'x-shop-key': this.userKeyValue } : {}
        }
      });
      this.client = client;
      this.clientKey = key;
      this.status.set('online');
      this.statusMessage.set('Supabase সংযুক্ত');
      return client;
    })();
    this.clientPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.clientPromise === pending) this.clientPromise = undefined;
    }
  }

  /**
   * Read one collection straight from the shared rows table. The public
   * attendance page runs without a login and without the local database, so it
   * cannot go through the normal boot/pull cycle.
   */
  async fetchPublicRows<T>(
    collection: string,
    filter?: PublicRowFilter | PublicRowFilter[]
  ): Promise<T[]> {
    const client = await this.supabase();
    if (!client) return [];
    let query = client.from(ROWS_TABLE).select('row_id,data').eq('collection', collection).limit(5000);
    for (const item of Array.isArray(filter) ? filter : filter ? [filter] : []) {
      query = query.eq(item.column, item.value);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return ((data ?? []) as { data: T }[]).map(row => row.data);
  }

  /**
   * A printed voucher QR is opened by people with no login and no shop key, so
   * the rows table is closed to them. The server function releases only the one
   * voucher whose random shareKey was scanned — never a whole collection.
   */
  async fetchPublicVoucher(type: string, key: string): Promise<Record<string, unknown> | null> {
    const shareKey = (key || '').trim().toLowerCase();
    if (!/^[0-9a-z]{8,32}$/.test(shareKey)) return null;
    try {
      const client = await this.supabase();
      if (!client) return null;
      const { data, error } = await client.rpc('sm_public_voucher', { p_type: type, p_key: shareKey });
      if (error) return null;
      return data && typeof data === 'object' && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Public pages must follow the backend this build was deployed with. A phone
   * that once stored another shop's config would otherwise silently query the
   * old project and report the station as missing.
   */
  useDeploymentBackend(): void {
    const runtime = this.runtimeConfig;
    if (!runtime.supabase.url || !runtime.supabase.anonKey) return;
    const current = this.config().supabase;
    if (current.url === runtime.supabase.url && current.anonKey === runtime.supabase.anonKey) return;
    this.config.update(c => ({
      ...c,
      supabase: { ...c.supabase, ...runtime.supabase, enabled: true },
      cloudinary: { ...c.cloudinary, ...runtime.cloudinary }
    }));
    this.resetClient();
  }

  /** Write a single row without touching the local collections (public pages). */
  async upsertPublicRow(collection: string, rowId: string, data: Record<string, unknown>): Promise<boolean> {
    try {
      const client = await this.supabase();
      if (!client) return false;
      const { error } = await client
        .from(ROWS_TABLE)
        .upsert({ collection, row_id: rowId, data }, { onConflict: 'collection,row_id' });
      if (error) {
        this.status.set('error');
        this.statusMessage.set(error.message);
        return false;
      }
      return true;
    } catch (error) {
      // The station/staff snapshot is refreshed by timers; a dropped request
      // must resolve as "not saved" instead of an unhandled rejection.
      this.status.set('error');
      this.statusMessage.set(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async testSupabase(): Promise<{ ok: boolean; message: string }> {
    if (!this.config().supabase.url || !this.config().supabase.anonKey) {
      return { ok: false, message: 'Project URL এবং anon key দুটোই দিতে হবে।' };
    }
    if (!/^https:\/\/.+\.supabase\.co/.test(this.config().supabase.url)) {
      return { ok: false, message: 'URL দেখে মনে হচ্ছে Supabase প্রোজেক্ট নয় (https://xxxx.supabase.co)।' };
    }
    this.status.set('connecting');
    try {
      const client = await this.supabase();
      if (!client) return { ok: false, message: 'সংযোগ করা যায়নি।' };
      const { error } = await client.from(ROWS_TABLE).select('collection').limit(1);
      if (error) {
        this.status.set('error');
        this.statusMessage.set(error.message);
        return { ok: false, message: `টেবিল সমস্যা: ${error.message} — supabase/new-project.sql চালাতে হবে।` };
      }
      this.status.set('online');
      this.statusMessage.set('Supabase ঠিক আছে');
      return { ok: true, message: 'সংযোগ সফল — টেবিল পাওয়া গেছে।' };
    } catch (error) {
      this.status.set('error');
      const message = error instanceof Error ? error.message : String(error);
      this.statusMessage.set(message);
      return { ok: false, message };
    }
  }

  async testCloudinary(): Promise<{ ok: boolean; message: string }> {
    const { cloudName, uploadPreset } = this.config().cloudinary;
    if (!cloudName || !uploadPreset) {
      return { ok: false, message: 'Cloud name এবং unsigned upload preset লাগবে।' };
    }
    try {
      // 1x1 transparent PNG — proves the preset and folder really work.
      const pixel = dataUriToBlob(PX_PNG);
      const result = await this.uploadImage(pixel, 'tests', `sm-ping-${Date.now()}`);
      return { ok: true, message: `আপলোড সফল: ${result.secureUrl.slice(0, 68)}…` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `ব্যর্থ: ${this.cloudinaryHint(message)}` };
    }
  }

  /** Cloudinary answers in API jargon; translate the three failures this app can cause. */
  private cloudinaryHint(message: string): string {
    if (/whitelisted for unsigned uploads/i.test(message)) {
      return `${message}\n\nকরণীয়: Cloudinary Console → Settings (⚙️) → Upload ট্যাব → নিচে "Upload presets" → Add upload preset → "Signing Mode" = Unsigned → Save।\nতারপর ওই preset-এর নাম কপি করে এই ঘরে বসিয়ে সেভ করুন। বিল্ট-ইন "ml_default" preset কখনো unsigned হয় না।`;
    }
    if (/unknown cloud name|Invalid cloud name|cloud not found/i.test(message)) {
      return `${message}\n\nকরণীয়: Cloudinary Dashboard-এর উপরে যে "Cloud name" দেখাচ্ছে সেটি বসান (এখানে: ${this.config().cloudinary.cloudName})।`;
    }
    if (/preset.*not found|Upload preset doesn't exist|No such upload preset/i.test(message)) {
      return `${message}\n\nকরণীয়: Unsigned preset তৈরি হয়নি বা নামে এক অক্ষরেরও তফাত আছে — Console → Settings → Upload → Upload presets থেকে নামটি হুবহু কপি করুন।`;
    }
    if (/folder|not allowed/i.test(message)) {
      return `${message}\n\nকরণীয়: preset-এর "Folder" ঘরটি ফাঁকা রাখুন, অথবা Base folder-এর নামও সেই ফোল্ডার দিয়ে শুরু হতে হবে (এখানে: ${this.config().cloudinary.folder})।`;
    }
    return message;
  }

  /** One-line version for the image picker, where a full recipe would not fit. */
  cloudinaryShort(message: string): string {
    if (/whitelisted for unsigned uploads/i.test(message)) return 'upload preset টা Unsigned মোডে নয় — Console → Settings → Upload → Upload presets-এ নতুন unsigned preset বানান';
    if (/unknown cloud name|Invalid cloud name|cloud not found/i.test(message)) return 'Cloud name ভুল';
    if (/preset.*not found|Upload preset doesn't exist|No such upload preset/i.test(message)) return 'upload preset পাওয়া যায়নি';
    if (/folder|not allowed/i.test(message)) return 'preset-এর Folder restriction মিলছে না';
    return message.slice(0, 90);
  }

  /** Unsigned browser upload; `subfolder` keeps each area of the app separate. */
  async uploadImage(blob: Blob, subfolder: string, publicId: string): Promise<CloudUploadResult> {
    const { cloudName, uploadPreset, folder } = this.config().cloudinary;
    if (!cloudName || !uploadPreset) throw new Error('Cloudinary কনফিগ পূরণ করুন।');
    const form = new FormData();
    form.append('file', blob);
    form.append('upload_preset', uploadPreset);
    form.append('folder', [folder, subfolder].filter(Boolean).join('/'));
    form.append('public_id', publicId);
    // `overwrite` is not in Cloudinary's unsigned-upload whitelist, so sending it
    // rejects the whole request; every public_id here already carries a timestamp.
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: form
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.secure_url) {
      throw new Error(json?.error?.message || `HTTP ${response.status}`);
    }
    return { secureUrl: String(json.secure_url), publicId: String(json.public_id ?? publicId), bytes: blob.size };
  }

  /**
   * Claim a contiguous block of document numbers so two devices can never print
   * the same SALE/PUR invoice. Counters live in the same sm_rows table as a
   * collection the data sync never reads; the claim is an atomic
   * compare-and-set, because the anon key cannot create a table or function.
   * Returns the last number of the block, or null when offline/not configured.
   */
  async claimDocNos(prefix: string, size: number, floor: number): Promise<number | null> {
    if (!this.isEnabled() || size < 1 || size > 1000) return null;
    try {
      const client = await this.supabase();
      if (!client) return null;

      for (let attempt = 0; attempt < 8; attempt++) {
        const { data: row, error } = await client
          .from(ROWS_TABLE)
          .select('data')
          .eq('collection', COUNTER_COLLECTION)
          .eq('row_id', prefix)
          .maybeSingle();
        if (error) return null;

        if (!row) {
          const last = Math.max(floor, 1) + size - 1;
          const { error: insertError } = await client.from(ROWS_TABLE).insert({
            collection: COUNTER_COLLECTION,
            row_id: prefix,
            data: { next: last + 1 }
          });
          if (!insertError) return last;
          // Someone else created the counter first — read their value instead.
          if (insertError.code !== '23505') return null;
          continue;
        }

        const current = Number((row.data as { next?: unknown } | null)?.next);
        if (!Number.isFinite(current)) return null;
        const last = Math.max(current, floor, 1) + size - 1;
        const { data: updated, error: updateError } = await client
          .from(ROWS_TABLE)
          .update({ data: { next: last + 1 } })
          .eq('collection', COUNTER_COLLECTION)
          .eq('row_id', prefix)
          // Fails when another device moved the counter between our read and write.
          .filter('data->>next', 'eq', String(current))
          .select('row_id');
        if (updateError) return null;
        if (updated?.length) return last;
        // Lost the race against another device; back off so both do not retry in step.
        await new Promise<void>(resolve => setTimeout(resolve, 40 + Math.random() * 120 * (attempt + 1)));
      }
      return null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // row-level sync
  // ------------------------------------------------------------------
  private collectionKeys(): string[] {
    return [...new Set([...this.data.collections().map(c => c.key), ...EXTRA_SYNC_KEYS, SETTINGS_KEY])];
  }

  private value(key: string): unknown {
    if (key === SETTINGS_KEY) return this.data.voucherSettings();
    const entry = this.data.collections().find(c => c.key === key);
    return entry ? entry.signal() : this.storage.read(key);
  }

  private rows(key: string): { rowId: string; data: Payload }[] {
    const value = this.value(key);
    if (Array.isArray(value)) {
      return value.map((item, index) => ({ rowId: this.rowIdOf(key, item, index), data: this.encodeRow(key, item) }));
    }
    return value && typeof value === 'object' ? [{ rowId: 'settings', data: forSync(value as Payload) }] : [];
  }

  private rowIdOf(key: string, item: unknown, index: number): string {
    if (key === WAREHOUSES_KEY) return warehouseId(warehouseName(item));
    return item && typeof item === 'object' && 'id' in item ? String((item as { id: unknown }).id) : `n${index}`;
  }

  private encodeRow(key: string, item: unknown): Payload {
    return forSync(key === WAREHOUSES_KEY ? { value: warehouseName(item) } :
      item && typeof item === 'object' ? item : { value: item }) as Payload;
  }

  /**
   * Opens a working copy of one collection so a pull can reconcile every row
   * in memory and publish the result once. Read-only drafts only serve fast
   * payload lookups (the push path never changes local rows).
   */
  private beginDraft(key: string, mutable: boolean): void {
    const value = this.value(key);
    const payloads = new Map<string, Payload | null>();
    if (!Array.isArray(value)) {
      if (value && typeof value === 'object') payloads.set('settings', forSync(value as Payload) as Payload);
      this.drafts.set(key, { key, mutable, isArray: false, list: [], index: new Map(), deleted: new Set(), payloads, objectValue: value, changed: false });
      return;
    }
    const index = new Map<string, number>();
    const list = [...value];
    list.forEach((item, position) => {
      const id = this.rowIdOf(key, item, position);
      if (!index.has(id)) {
        index.set(id, position);
        payloads.set(id, this.encodeRow(key, item));
      }
    });
    this.drafts.set(key, { key, mutable, isArray: true, list, index, deleted: new Set(), payloads, changed: false });
  }

  /** Publishes the draft once (one storage write, one signal update). */
  private endDraft(key: string): void {
    const draft = this.drafts.get(key);
    if (!draft) return;
    this.drafts.delete(key);
    try {
      if (!draft.mutable || !draft.changed) return;
      const next: unknown = draft.isArray
        ? draft.list.filter((_, position) => !draft.deleted.has(position))
        : draft.objectValue;
      this.applyingRemote = true;
      try {
        this.storage.write(key, next);
        if (key === SETTINGS_KEY) this.data.voucherSettings.set(this.data.normalizeVoucherSettings(next as VoucherSettings));
        else this.data.collections().find(c => c.key === key)?.signal.set(next as never);
      } finally {
        this.applyingRemote = false;
      }
    } finally {
      this.scheduleMetadataFlush();
    }
  }

  /** Kicks the deferred metadata write once the last open draft is closed. */
  private scheduleMetadataFlush(): void {
    if (!this.metadataDirty || this.metadataTimer || this.drafts.size) return;
    this.metadataTimer = setTimeout(() => {
      this.metadataTimer = undefined;
      this.flushMetadata();
    }, 200);
  }

  /** Writes changed rows into the open draft instead of the whole collection. */
  private applyToDraft(key: string, id: string, payload: Payload | null, deleted: boolean): void {
    const draft = this.drafts.get(key)!;
    if (key === SETTINGS_KEY) {
      if (deleted) throw new Error('ভাউচার সেটিংস মুছে ফেলা সমর্থিত নয়।');
      draft.objectValue = keepLocalImages(draft.objectValue, payload);
      draft.payloads.set('settings', forSync(draft.objectValue as Payload) as Payload);
      draft.changed = true;
      return;
    }
    const found = draft.index.get(id);
    if (deleted) {
      if (found !== undefined) {
        draft.deleted.add(found);
        draft.changed = true;
      }
      draft.payloads.set(id, null);
      return;
    }
    const decoded = key === WAREHOUSES_KEY ? warehouseName(payload) :
      payload && Object.keys(payload).length === 1 && 'value' in payload ? payload['value'] : payload;
    let item = decoded;
    if (found === undefined) {
      if (!draft.isArray) return;
      draft.list.push(decoded);
      draft.index.set(id, draft.list.length - 1);
    } else {
      item = keepLocalImages(draft.list[found], decoded);
      draft.list[found] = item;
    }
    draft.payloads.set(id, this.encodeRow(key, item));
    draft.changed = true;
  }
  private assertOrdinary(): void {
    if (!this.isEnabled()) throw new Error('Supabase চালু নেই');
    if (this.restoreIntent()) throw new Error('রিস্টোরের পরে আগে reconcileRestoredData দিয়ে ডেটা মিলিয়ে সংঘাত সমাধান করুন।');
  }

  private canAutoSync(): boolean {
    return !this.paused && this.isEnabled() && this.config().autoSync
      && !this.restoreIntent() && !!this.userKeyValue && this.keyVerified;
  }

  /** Only public entry points enqueue; queued implementations never call wrappers. */
  private enqueue<T>(work: () => Promise<T>, maintenance = false): Promise<T> {
    if (this.paused && !maintenance) return Promise.reject(new Error('রক্ষণাবেক্ষণের জন্য ক্লাউড সিঙ্ক সাময়িক বন্ধ আছে।'));
    this.queuedWork++;
    const result = this.queue.then(work);
    this.queue = result.then(() => { this.queuedWork--; }, () => { this.queuedWork--; });
    return result;
  }

  private cancelScheduling(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    ++this.subscriptionGeneration;
    const old = this.realtime;
    this.realtime = undefined;
    old?.remove();
  }

  /** Gates immediately, then drains all work admitted before the gate closed. */
  pauseSync(): Promise<void> {
    this.paused = true;
    this.cancelScheduling();
    return this.queue;
  }

  resumeAfterMaintenance(): void {
    this.paused = false;
    if (this.canAutoSync()) void this.resumeSync().catch(() => undefined);
  }

  /** Call after durable restore + DataService reload, while still paused. */
  async markRestoredData(): Promise<void> {
    if (!this.paused || this.queuedWork) throw new Error('রিস্টোর চিহ্নিত করার আগে pauseSync সম্পূর্ণ হওয়া চাই।');
    this.config.update(c => ({ ...c, autoSync: false }));
    this.cancelScheduling();
    const rows: RestoreSyncIntent['rows'] = {};
    const deletedKnownIds: RestoreSyncIntent['deletedKnownIds'] = {};
    for (const key of this.collectionKeys()) {
      rows[key] = Object.fromEntries(this.rows(key).map(row => [row.rowId, signature(row.data)]));
      deletedKnownIds[key] = [...(this.synced.get(key) ?? [])].filter(id => !(id in rows[key]));
      for (const id of deletedKnownIds[key]) rows[key][id] = ABSENT;
    }
    this.restoreIntent.set({ backend: backendIdentity(this.config().supabase.url), restoredAt: new Date().toISOString(), rows, deletedKnownIds, reconciled: false });
    this.writeConfig();
    this.persistRestoreIntent();
    await this.storage.flush();
  }

  /** Explicit review only: differing restored rows become conflicts, never uploads. */
  reconcileRestoredData(): Promise<SyncReport> {
    return this.reportOperation(async report => {
      if (!this.isEnabled()) throw new Error('Supabase চালু নেই');
      if (!this.restoreIntent()) throw new Error('পর্যালোচনার জন্য রিস্টোর করা ডেটা নেই।');
      await this.pullAllInternal(report, true);
      this.restoreIntent.update(intent => intent ? { ...intent, reconciled: true } : null);
      this.finishRestoreReview();
      await this.storage.flush();
    });
  }

  private scopedKey(key: string): string {
    return `${key}:${encodeURIComponent(backendIdentity(this.config().supabase.url))}`;
  }

  private loadDestinationMetadata(): void {
    this.synced = this.readSyncedIds();
    this.pushed = this.readPushedSigs();
    this.editTimes = this.readEditTimes();
    this.pulledAt = this.readPullMarks();
    this.outbox = new Set(this.readMetadata<string[]>(OUTBOX_KEY) ?? []);
    this.warehouseIds = new Map(Object.entries(this.readMetadata<Record<string, string>>(WAREHOUSE_IDS_KEY) ?? {}));
    this.syncConflicts.set(this.storage.read<CloudSyncConflict[]>(this.scopedKey(SYNC_CONFLICTS_KEY)) ?? []);
    this.restoreIntent.set(this.storage.read<RestoreSyncIntent>(this.scopedKey(RESTORE_SYNC_INTENT_KEY)) ?? null);
  }

  private readMetadata<T>(key: string): T | null {
    try { return JSON.parse(localStorage.getItem(this.scopedKey(key)) ?? 'null') as T | null; }
    catch { return null; }
  }

  private readSyncedIds(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const [key, ids] of Object.entries(this.readMetadata<Record<string, unknown>>(SYNCED_IDS_KEY) ?? {})) {
      if (Array.isArray(ids)) out.set(key, new Set(ids.map(String)));
    }
    return out;
  }

  private readPushedSigs(): Map<string, Map<string, string>> {
    const out = new Map<string, Map<string, string>>();
    for (const [key, rows] of Object.entries(this.readMetadata<Record<string, unknown>>(SYNC_SIGS_KEY) ?? {})) {
      if (!rows || typeof rows !== 'object') continue;
      out.set(key, new Map(Object.entries(rows).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
    }
    return out;
  }

  private readEditTimes(): Map<string, Map<string, string>> {
    const out = new Map<string, Map<string, string>>();
    for (const [key, rows] of Object.entries(this.readMetadata<Record<string, unknown>>(SYNC_TIMES_KEY) ?? {})) {
      if (!rows || typeof rows !== 'object') continue;
      out.set(key, new Map(Object.entries(rows).filter((entry): entry is [string, string] =>
        typeof entry[1] === 'string' && Number.isFinite(Date.parse(entry[1])))));
    }
    return out;
  }

  private readPullMarks(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, at] of Object.entries(this.readMetadata<Record<string, unknown>>(PULL_MARKS_KEY) ?? {})) {
      if (typeof at === 'string' && Number.isFinite(Date.parse(at))) out.set(key, at);
    }
    return out;
  }

  private persistMetadata(): void {
    try {
      localStorage.setItem(this.scopedKey(SYNCED_IDS_KEY), JSON.stringify(Object.fromEntries([...this.synced].map(([key, ids]) => [key, [...ids]]))));
      localStorage.setItem(this.scopedKey(SYNC_SIGS_KEY), JSON.stringify(Object.fromEntries([...this.pushed].map(([key, rows]) => [key, Object.fromEntries(rows)]))));
      localStorage.setItem(this.scopedKey(SYNC_TIMES_KEY), JSON.stringify(Object.fromEntries([...this.editTimes].map(([key, rows]) => [key, Object.fromEntries(rows)]))));
      localStorage.setItem(this.scopedKey(WAREHOUSE_IDS_KEY), JSON.stringify(Object.fromEntries(this.warehouseIds)));
      localStorage.setItem(this.scopedKey(PULL_MARKS_KEY), JSON.stringify(Object.fromEntries(this.pulledAt)));
      localStorage.setItem(this.scopedKey(OUTBOX_KEY), JSON.stringify([...this.outbox]));
    } catch {
      // Never claim persistence succeeded: a reload without a baseline will
      // conservatively conflict rather than overwrite an unseen server value.
      this.environmentWarning.set('সিঙ্কের স্বীকৃত অবস্থা সংরক্ষণ হয়নি; পরেরবার সংঘাত পর্যালোচনা লাগতে পারে।');
    }
  }

  /**
   * Metadata is three JSON blobs covering every synced row. Re-writing them on
   * each acknowledged row is expensive, so a batch marks the state dirty and
   * persists it once when the collection or operation ends.
   */
  private markMetadataDirty(): void {
    this.metadataDirty = true;
    // While a collection draft is open its owner flushes at the end; a timer
    // here would only serialize the same state mid-loop.
    if (this.metadataTimer || this.drafts.size) return;
    this.metadataTimer = setTimeout(() => {
      this.metadataTimer = undefined;
      this.flushMetadata();
    }, 250);
  }

  private flushMetadata(): void {
    if (this.metadataTimer) {
      clearTimeout(this.metadataTimer);
      this.metadataTimer = undefined;
    }
    if (!this.metadataDirty) return;
    this.metadataDirty = false;
    this.persistMetadata();
  }

  /** The header badge is informational; one refresh per burst is enough. */
  private scheduleRefreshPending(): void {
    if (this.pendingRefreshTimer) return;
    this.pendingRefreshTimer = setTimeout(() => {
      this.pendingRefreshTimer = undefined;
      this.refreshPending();
    }, 80);
  }

  private persistConflicts(): void {
    this.storage.write(this.scopedKey(SYNC_CONFLICTS_KEY), this.syncConflicts());
  }

  private persistRestoreIntent(): void {
    this.storage.write(this.scopedKey(RESTORE_SYNC_INTENT_KEY), this.restoreIntent());
  }

  private finishRestoreReview(): void {
    const intent = this.restoreIntent();
    if (!intent) return;
    if (intent.reconciled && Object.values(intent.rows).every(rows => !Object.keys(rows).length)) this.restoreIntent.set(null);
    this.persistRestoreIntent();
  }

  private acknowledge(key: string, id: string, payload: Payload | null): void {
    const seen = this.pushed.get(key) ?? new Map<string, string>();
    seen.set(id, payload ? signature(payload) : ABSENT);
    this.pushed.set(key, seen);
    const ids = this.synced.get(key) ?? new Set<string>();
    ids.add(id); // Keep tombstones acknowledged so later pulls never resurrect them.
    this.synced.set(key, ids);
    const times = this.editTimes.get(key);
    if (times) {
      // Only drop the edit time when the acknowledged payload is still what
      // this device holds; a newer local edit keeps its own timestamp.
      const local = this.localPayload(key, id);
      if ((local ? signature(local) : ABSENT) === (payload ? signature(payload) : ABSENT)) times.delete(id);
      if (!times.size) this.editTimes.delete(key);
    }
    this.markMetadataDirty();
  }

  private completeIntentRow(key: string, id: string): void {
    const intent = this.restoreIntent();
    if (!intent?.rows[key] || !(id in intent.rows[key])) return;
    const rows = { ...intent.rows[key] };
    delete rows[id];
    this.restoreIntent.set({ ...intent, rows: { ...intent.rows, [key]: rows } });
    this.finishRestoreReview();
  }

  private recordConflict(key: string, id: string, local: Payload | null, remote: Payload | null, remoteRowId = id): void {
    const previous = this.syncConflicts().find(c => c.collection === key && c.rowId === id);
    const conflict: CloudSyncConflict = {
      id: previous?.id ?? `${key}:${id}:${Date.now().toString(36)}`,
      collection: key, rowId: id, remoteRowId, detectedAt: new Date().toISOString(),
      local: forSync(local), remote: forSync(remote)
    };
    this.syncConflicts.update(list => [...list.filter(c => c.collection !== key || c.rowId !== id), conflict]);
    this.persistConflicts();
  }

  private clearConflict(key: string, id: string): void {
    if (!this.syncConflicts().some(c => c.collection === key && c.rowId === id)) return;
    this.syncConflicts.update(list => list.filter(c => c.collection !== key || c.rowId !== id));
    this.persistConflicts();
  }

  private localPayload(key: string, id: string): Payload | null {
    const draft = this.drafts.get(key);
    if (draft) return draft.payloads.get(id) ?? null;
    return this.rows(key).find(row => row.rowId === id)?.data ?? null;
  }

  /** Changes only this row/singleton, never reloads unrelated business signals. */
  private applyLocal(key: string, id: string, payload: Payload | null): void {
    const deleted = !payload || isTombstone(payload);
    const draft = this.drafts.get(key);
    if (draft?.mutable) { this.applyToDraft(key, id, payload, deleted); return; }
    const before = this.value(key);
    let next: unknown;
    if (key === SETTINGS_KEY) {
      if (deleted) throw new Error('ভাউচার সেটিংস মুছে ফেলা সমর্থিত নয়।');
      next = keepLocalImages(before, payload);
    } else {
      const list = Array.isArray(before) ? [...before] : [];
      const index = this.rows(key).findIndex(row => row.rowId === id);
      if (deleted) { if (index >= 0) list.splice(index, 1); }
      else {
        const decoded = key === WAREHOUSES_KEY ? warehouseName(payload) :
          payload && Object.keys(payload).length === 1 && 'value' in payload ? payload['value'] : payload;
        if (index >= 0) list[index] = keepLocalImages(list[index], decoded);
        else list.push(decoded);
      }
      next = list;
    }
    this.applyingRemote = true;
    try {
      this.storage.write(key, next);
      if (key === SETTINGS_KEY) this.data.voucherSettings.set(this.data.normalizeVoucherSettings(next as VoucherSettings));
      else this.data.collections().find(c => c.key === key)?.signal.set(next as never);
    } finally { this.applyingRemote = false; }
  }

  /**
   * Last-write-wins. A local row carries the moment it was edited on this
   * device, and the server stamps `updated_at`; the newer side is kept. When
   * this device has no edit time for the row, the server value wins so opening
   * the app always shows the newest database state rather than an old cache.
   */
  private reconcileRow(key: string, id: string, remote: Payload | null, remoteRowId = id, restoring = false, remoteAt?: string): Reconciliation {
    const local = this.localPayload(key, id);
    const base = this.pushed.get(key)?.get(id);
    const localSig = local ? signature(local) : ABSENT;
    const remoteSig = remote ? signature(remote) : ABSENT;
    if (localSig === remoteSig || (!local && isTombstone(remote))) {
      this.acknowledge(key, id, remote);
      this.clearConflict(key, id);
      this.completeIntentRow(key, id);
      return 'equal';
    }
    // A restored file is an explicit review: never overwrite it silently.
    if (restoring && this.restoreIntent()?.rows[key]?.[id] !== undefined) {
      this.recordConflict(key, id, local, remote, remoteRowId);
      return 'conflict';
    }
    const localAt = this.editTimes.get(key)?.get(id);
    const localMs = localAt ? Date.parse(localAt) : NaN;
    const remoteMs = remoteAt ? Date.parse(remoteAt) : NaN;
    const localNewer = Number.isFinite(localMs) && (!Number.isFinite(remoteMs) || localMs > remoteMs);
    const takeRemote = (): Reconciliation => {
      this.applyLocal(key, id, remote);
      this.acknowledge(key, id, remote);
      return 'remote';
    };

    if (local) {
      // Nothing on the server to beat: this row still has to be uploaded.
      if (!remote) return 'local';
      // The server is unchanged since the last acknowledged write, so the
      // difference can only be this device's edit.
      if (!isTombstone(remote) && base === remoteSig) return 'local';
      return localNewer ? 'local' : takeRemote();
    }

    if (!remote) {
      // The server row no longer exists; there is nothing to restore.
      this.acknowledge(key, id, null);
      return 'equal';
    }
    // No local row: this is either a local deletion or a row new to this device.
    // A deletion edited more recently than the server copy stays deleted.
    if (base !== undefined && base !== ABSENT && localNewer) return 'local';
    return takeRemote();
  }

  /**
   * Records when each differing row was edited here. Runs on every local write
   * (even while offline or logged out) so the newer side is provable later.
   */
  private stampLocalEdits(key: string): void {
    const now = new Date().toISOString();
    const seen = this.pushed.get(key);
    const times = this.editTimes.get(key) ?? new Map<string, string>();
    const present = new Set<string>();
    let changed = false;
    for (const row of this.rows(key)) {
      present.add(row.rowId);
      const acknowledged = seen?.get(row.rowId);
      if (acknowledged === signature(row.data)) {
        if (times.delete(row.rowId)) changed = true;
      } else if (acknowledged?.startsWith('deleted:')) {
        // The server tombstoned this row and this device still holds a copy.
        // A whole-array rewrite must not stamp that leftover as a fresh edit,
        // otherwise it would be uploaded again and undo the deletion.
        if (times.delete(row.rowId)) changed = true;
      } else if (!times.has(row.rowId)) {
        times.set(row.rowId, now);
        changed = true;
      }
    }
    for (const id of this.synced.get(key) ?? []) {
      if (present.has(id) || times.has(id)) continue;
      const acknowledged = seen?.get(id);
      // A row the server knew and this device no longer has is a local deletion.
      if (acknowledged !== undefined && acknowledged !== ABSENT && !acknowledged.startsWith('deleted:')) {
        times.set(id, now);
        changed = true;
      }
    }
    if (times.size) this.editTimes.set(key, times);
    else this.editTimes.delete(key);
    if (changed) this.persistMetadata();
  }

  /** Newest server timestamp this device has seen, shown as "last DB update". */
  private noteRemoteUpdate(rows: RemoteRow[]): void {
    let newest = '';
    for (const row of rows) {
      if (row.updated_at && Date.parse(row.updated_at) > Date.parse(newest || '1970-01-01')) newest = row.updated_at;
    }
    if (!newest) return;
    const current = this.config().lastRemoteAt;
    if (current && Date.parse(current) >= Date.parse(newest)) return;
    this.config.update(c => ({ ...c, lastRemoteAt: newest }));
    this.writeConfig();
  }

  /** One tiny query for the real newest row, including collections off-page. */
  private async readLastRemoteAt(client: SupabaseClient): Promise<void> {
    const { data, error } = await client.from(ROWS_TABLE)
      .select('updated_at').order('updated_at', { ascending: false }).range(0, 0);
    if (error || !data?.length) return;
    const at = (data[0] as { updated_at?: unknown }).updated_at;
    if (typeof at === 'string') this.noteRemoteUpdate([{ collection: '', row_id: '', data: {}, updated_at: at }]);
  }

  private logicalId(row: RemoteRow): string | null {
    if (row.collection !== WAREHOUSES_KEY || !/^n\d+$/.test(row.row_id)) return row.row_id;
    if (!isTombstone(row.data)) {
      const id = warehouseId(warehouseName(row.data));
      this.warehouseIds.set(row.row_id, id);
      return id;
    }
    const known = this.warehouseIds.get(row.row_id);
    if (known) return known;
    // Guessing the current array position could delete an entirely different
    // warehouse after a reorder. Keep an explicit conflict for legacy ambiguity.
    this.recordConflict(row.collection, row.row_id, null, row.data);
    return null;
  }

  private async readRemote(client: SupabaseClient, collection?: string): Promise<RemoteRow[]> {
    const rows: RemoteRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let query = client.from(ROWS_TABLE).select('collection,row_id,data,updated_at');
      if (collection) query = query.eq('collection', collection);
      const { data, error } = await query.order('collection', { ascending: true }).order('row_id', { ascending: true }).range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as RemoteRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    this.noteRemoteUpdate(rows);
    return rows;
  }

  /**
   * Only the rows stamped after the watermark, oldest first, with the last
   * timestamp as the next cursor (no offsets: a row updated mid-read simply
   * lands in the next round).
   */
  private async readRemoteSince(client: SupabaseClient, collection: string, since: string): Promise<RemoteRow[]> {
    const rows: RemoteRow[] = [];
    const pageSize = 1000;
    let cursor = since;
    for (let guard = 0; guard < 100; guard++) {
      const { data, error } = await client.from(ROWS_TABLE).select('collection,row_id,data,updated_at')
        .eq('collection', collection)
        .gt('updated_at', cursor)
        .order('updated_at', { ascending: true })
        .range(0, pageSize - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as RemoteRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
      const last = page[page.length - 1].updated_at;
      // Rows sharing one timestamp cannot advance the cursor; a full pull is safer.
      if (!last || last === cursor) throw new Error('অগ্রগতি ছাড়া ডেল্টা সিঙ্ক থেমে গেছে।');
      cursor = last;
    }
    this.noteRemoteUpdate(rows);
    return rows;
  }

  /** One row, for a realtime echo that names exactly what changed. */
  private async readRemoteRow(client: SupabaseClient, collection: string, id: string): Promise<RemoteRow | undefined> {
    const { data, error } = await client.from(ROWS_TABLE).select('collection,row_id,data,updated_at')
      .eq('collection', collection).eq('row_id', id).range(0, 0);
    if (error) throw new Error(error.message);
    const row = ((data ?? []) as RemoteRow[])[0];
    if (row?.updated_at) this.noteRemoteUpdate([row]);
    return row;
  }

  /**
   * Nothing can be newer than the last remote timestamp this device observed,
   * so an unchanged shop needs no row download at all.
   */
  private unchanged(key: string): boolean {
    const mark = this.pulledAt.get(key);
    const newest = this.config().lastRemoteAt;
    if (!mark || !newest) return false;
    // Marks outlive an evicted local copy; a missing shop must be downloaded again.
    if (this.needsRebuild(key)) return false;
    return Date.parse(newest) <= Date.parse(mark);
  }

  /** The server knows rows for this collection, but the local copy is gone. */
  private needsRebuild(key: string): boolean {
    return !!this.synced.get(key)?.size && !this.rows(key).length;
  }

  /** Highest valid timestamp among the rows, never lower than the one already applied. */
  private newestAt(rows: RemoteRow[], since: string | null): string | null {
    let newest = since && Number.isFinite(Date.parse(since)) ? since : null;
    for (const row of rows) {
      const at = row.updated_at;
      if (!at || !Number.isFinite(Date.parse(at))) continue;
      if (!newest || Date.parse(at) > Date.parse(newest)) newest = at;
    }
    return newest;
  }

  private markPulled(key: string, at: string | null): void {
    if (!at) return;
    const current = this.pulledAt.get(key);
    if (current && Date.parse(current) >= Date.parse(at)) return;
    this.pulledAt.set(key, at);
    this.markMetadataDirty();
  }

  private remoteIndex(rows: RemoteRow[]): Map<string, RemoteRow> {
    const indexed = new Map<string, RemoteRow>();
    for (const row of rows) {
      const id = this.logicalId(row);
      if (id === null) continue;
      if (indexed.has(id)) throw new Error('একই গুদামের একাধিক ক্লাউড আইডি আছে; স্বয়ংক্রিয় পরিবর্তন বন্ধ রাখা হয়েছে।');
      indexed.set(id, row);
    }
    return indexed;
  }

  /** Conditional update, or collision-detecting insert. Never unconditional upsert. */
  private async writeRemote(client: SupabaseClient, key: string, id: string, payload: Payload, expected: Payload | null): Promise<boolean> {
    if (expected === null) {
      const { data, error } = await client.from(ROWS_TABLE).insert({ collection: key, row_id: id, data: payload }).select('row_id');
      if (error?.code === '23505') return false;
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error('ক্লাউডে লেখার অনুমতি নেই বা লেখা নিশ্চিত হয়নি।');
      return true;
    }
    const { data, error } = await client.from(ROWS_TABLE).update({ data: payload })
      .eq('collection', key).eq('row_id', id).eq('data', JSON.stringify(expected)).select('row_id');
    if (error) throw new Error(error.message);
    return !!data?.length;
  }

  private async competingWrite(client: SupabaseClient, key: string, id: string, remoteId: string): Promise<void> {
    const current = (await this.readRemote(client, key)).find(row => row.row_id === remoteId)?.data ?? null;
    this.recordConflict(key, id, this.localPayload(key, id), current, remoteId);
  }

  private markChanged(key: string): void {
    if (this.applyingRemote || NEVER_SYNC.includes(key) || !this.collectionKeys().includes(key)) return;
    // Timestamp the edit before any sync decision: an offline edit must still
    // win later against an older server copy. Startup writes happen before a
    // login and must not make cached rows look freshly edited.
    if (this.userKeyValue) this.stampLocalEdits(key);
    // Remember the edit before any network decision: a save that never reached
    // the server (offline, gate not verified, app closed) must still ship later.
    if (!this.outbox.has(key)) {
      this.outbox.add(key);
      this.markMetadataDirty();
    }
    if (!this.canAutoSync()) return;
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      if (!this.canAutoSync()) return;
      void this.enqueue(async () => {
        if (!this.canAutoSync()) return;
        // Another device may have reset the shop while this edit waited: the
        // reset wins, otherwise the stale rows would be uploaded again.
        if (await this.applyPendingReset()) return;
        if (this.canAutoSync()) await this.pushCollectionInternal(key);
      }).then(
        () => { this.dropFromOutboxIfLanded(key); this.flushMetadata(); },
        error => this.noteUploadFailure(error)
      );
    }, 1500));
    this.refreshPending();
  }

  /** Rows of one collection the server has not accepted yet (edits and deletions). */
  private pendingCount(key: string): number {
    const seen = this.pushed.get(key);
    const local = this.rows(key);
    let total = local.filter(row => seen?.get(row.rowId) !== signature(row.data)).length;
    const ids = new Set(local.map(row => row.rowId));
    total += [...(this.synced.get(key) ?? [])].filter(id => !ids.has(id) && seen?.get(id) !== ABSENT && !seen?.get(id)?.startsWith('deleted:')).length;
    return total;
  }

  private refreshPending(): void {
    let total = 0;
    for (const key of this.collectionKeys()) total += this.pendingCount(key);
    this.pendingRows.set(total);
  }

  pushCollection(key: string): Promise<number> {
    return this.enqueue(async () => {
      this.assertOrdinary();
      if (await this.applyPendingReset()) return 0;
      const count = await this.pushCollectionInternal(key);
      this.dropFromOutboxIfLanded(key);
      this.flushMetadata();
      return count;
    });
  }

  /** A collection leaves the outbox only once nothing in it is still unsent. */
  private dropFromOutboxIfLanded(key: string): boolean {
    if (!this.outbox.has(key) || this.pendingCount(key)) return false;
    this.outbox.delete(key);
    this.markMetadataDirty();
    return true;
  }

  /**
   * Anything the server has not accepted yet belongs in the outbox, even when
   * the edit came from a build or a tab that never recorded it (an older app
   * version, or a save that landed while that page was closing).
   */
  private seedOutbox(): void {
    for (const key of this.collectionKeys()) {
      if (this.outbox.has(key) || !this.pendingCount(key)) continue;
      this.outbox.add(key);
      this.markMetadataDirty();
    }
  }

  /**
   * Uploads every collection this device changed, whatever page is open. The
   * page scope only decides what to *read*; a failed upload must never wait for
   * the user to return to the page that produced it.
   */
  private retryOutbox(): Promise<void> {
    this.seedOutbox();
    if (!this.outbox.size) return Promise.resolve();
    return this.enqueue(async () => {
      if (!this.canAutoSync()) return;
      let failed = false;
      for (const key of [...this.outbox]) {
        if (!this.canAutoSync()) return;
        if (!this.collectionKeys().includes(key)) {
          this.outbox.delete(key);
          continue;
        }
        if (!this.pendingCount(key)) {
          this.outbox.delete(key);
          continue;
        }
        try {
          await this.pushCollectionInternal(key);
          this.dropFromOutboxIfLanded(key);
        } catch (error) {
          failed = true;
          this.noteUploadFailure(error);
          break;
        }
      }
      this.markMetadataDirty();
      this.flushMetadata();
      this.scheduleRefreshPending();
      // Clear only the warning this loop raised; a pull error keeps its message.
      if (!failed && !this.outbox.size && this.statusMessage().startsWith(UPLOAD_FAILED_PREFIX)) {
        this.status.set('online');
        this.statusMessage.set('');
      }
      if (failed) this.scheduleRetry();
    });
  }

  /**
   * Pull one collection only. The attendance page uses this on open so scans
   * made at the public station appear without pulling the whole shop.
   */
  pullCollection(key: string): Promise<number> {
    return this.enqueue(async () => {
      this.assertOrdinary();
      // The caller wants freshness now, so look at the newest stamp first.
      const client = await this.supabase();
      if (client) await this.readLastRemoteAt(client).catch(() => undefined);
      const count = await this.pullCollectionInternal(key);
      this.flushMetadata();
      return count;
    });
  }

  private async pullCollectionInternal(key: string): Promise<number> {
    if (!this.collectionKeys().includes(key)) return 0;
    if (this.unchanged(key)) return 0;
    const client = await this.supabase();
    if (!client) throw new Error('Supabase চালু নেই');
    const mark = this.pulledAt.get(key);
    const rebuild = this.needsRebuild(key);
    const delta = !rebuild && !!mark && Number.isFinite(Date.parse(mark));
    const since = delta ? new Date(Date.parse(mark!) - PULL_OVERLAP_MS).toISOString() : '';
    let remoteRows: RemoteRow[];
    try {
      remoteRows = delta ? await this.readRemoteSince(client, key, since) : await this.readRemote(client, key);
    } catch (error) {
      if (!delta) throw error;
      // A stalled cursor must not stall the shop; pay for one full read instead.
      remoteRows = await this.readRemote(client, key);
    }
    const remote = this.remoteIndex(remoteRows);
    // A delta only knows changed rows; the ones it omits are unchanged, not deleted.
    const ids = new Set(delta ? remote.keys() : [...remote.keys(), ...(this.synced.get(key) ?? [])]);
    let pulled = 0;
    this.beginDraft(key, true);
    try {
      for (const id of ids) {
        const row = remote.get(id);
        if (row) pulled++;
        this.reconcileRow(key, id, row?.data ?? null, row?.row_id ?? id, false, row?.updated_at);
      }
    } finally {
      this.endDraft(key);
    }
    this.rememberRemoteIds(key, remote.keys());
    this.markPulled(key, this.newestAt(remoteRows, this.config().lastRemoteAt));
    this.scheduleRefreshPending();
    return pulled;
  }

  /** A row read from the server counts as known, so a later local delete still ships. */
  private rememberRemoteIds(key: string, ids: Iterable<string>): void {
    const known = this.synced.get(key) ?? new Set<string>();
    let added = false;
    for (const id of ids) {
      if (known.has(id)) continue;
      known.add(id);
      added = true;
    }
    if (!added) return;
    this.synced.set(key, known);
    this.markMetadataDirty();
  }

  /** Declares which collections the open page shows; background pulls stay inside them. */
  setActiveScope(keys: string[]): void {
    this.activeScope = this.scopedKeys(keys);
  }

  private scopedKeys(keys: string[]): string[] {
    const known = new Set(this.collectionKeys());
    return [...new Set(keys)].filter(key => known.has(key));
  }

  /**
   * Three collections at a time: one round trip per collection used to make a
   * dashboard visit wait ~30 times the network latency. Each collection still
   * reconciles serially and keeps its own draft, so ordering stays intact.
   */
  private async pullCollections(keys: string[], current?: () => boolean): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < keys.length) {
        if (current && !current()) return;
        await this.pullCollectionInternal(keys[next++]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, keys.length) }, worker));
  }

  /**
   * Page-scoped sync: read only the collections the open page shows, then push
   * only those with local edits. Startup, the poll and tab-focus all use this,
   * so browsing one page never downloads the whole shop.
   */
  syncPage(keys: string[], claim = false): Promise<void> {
    const target = this.scopedKeys(keys);
    if (!target.length) return Promise.resolve();
    if (claim) this.pageSyncGeneration++;
    const generation = this.pageSyncGeneration;
    const current = () => generation === this.pageSyncGeneration;
    return this.enqueue(async () => {
      if (!current()) return;
      if (!this.keyVerified && !(await this.verifyKey())) { this.reportGateClosed(); return; }
      // An already-verified device still has to notice another device's hard
      // reset, otherwise its cached rows would be uploaded again.
      if (this.keyVerified && (await this.applyPendingReset())) return;
      if (!this.canAutoSync()) return;
      // One tiny row query tells every collection whether anything moved at all.
      const client = await this.supabase();
      if (client) await this.readLastRemoteAt(client).catch(() => undefined);
      await this.pullCollections(target, current);
      for (const key of target) {
        if (!current() || !this.pendingCount(key)) continue;
        try {
          await this.pushCollectionInternal(key);
          this.dropFromOutboxIfLanded(key);
        } catch (error) {
          // A pull problem and an upload problem need different words: the
          // shop keeps working, but the other devices do not have this edit yet.
          this.noteUploadFailure(error);
          break;
        }
      }
      this.flushMetadata();
      this.config.update(c => ({ ...c, lastPullAt: new Date().toISOString() }));
      this.writeConfig();
      if (client) await this.readLastRemoteAt(client).catch(() => undefined);
      // The gate just proved itself; a warning left from a closed gate is stale.
      if (this.status() === 'error' && this.statusMessage() === this.syncBlockedMessage()) {
        this.status.set('online');
        this.statusMessage.set('');
      }
      if (!this.realtime) await this.subscribeRealtime();
    }).catch(error => {
      this.status.set('error');
      this.statusMessage.set(error instanceof Error ? error.message : String(error));
      this.scheduleRetry();
    });
  }

  private async pushCollectionInternal(key: string, report?: SyncReport): Promise<number> {
    if (this.restoreIntent()) throw new Error('রিস্টোর করা ডেটা আগে স্পষ্টভাবে মিলিয়ে নিন।');
    if (!this.collectionKeys().includes(key)) return 0;
    const client = await this.supabase();
    if (!client) throw new Error('Supabase চালু নেই');
    const remote = this.remoteIndex(await this.readRemote(client, key));
    // Read-only: push never changes local rows, but the draft keeps the
    // per-row payload lookups O(1) on a large collection.
    this.beginDraft(key, false);
    const ids = new Set([...remote.keys(), ...this.rows(key).map(row => row.rowId), ...(this.synced.get(key) ?? [])]);
    let count = 0;
    try {
      for (const id of ids) {
        const row = remote.get(id);
        const decision = this.reconcileRow(key, id, row?.data ?? null, row?.row_id ?? id, false, row?.updated_at);
        if (decision !== 'local') continue;
        const local = this.localPayload(key, id);
        const payload = local ?? { [TOMBSTONE]: new Date().toISOString() };
        const remoteId = row?.row_id ?? id;
        if (!await this.writeRemote(client, key, remoteId, payload, row?.data ?? null)) {
          // Another device wrote between our read and this conditional write.
          // Re-read and let last-write-wins choose; retry only if we still win.
          const fresh = (await this.readRemote(client, key)).find(r => r.row_id === remoteId);
          const again = this.reconcileRow(key, id, fresh?.data ?? null, remoteId, false, fresh?.updated_at);
          if (again !== 'local') continue;
          const currentLocal = this.localPayload(key, id);
          const retryPayload = currentLocal ?? { [TOMBSTONE]: new Date().toISOString() };
          if (!await this.writeRemote(client, key, remoteId, retryPayload, fresh?.data ?? null)) continue;
          this.acknowledge(key, id, retryPayload);
          count++;
          if (report) { report.pushed++; if (!currentLocal) report.deleted++; }
          continue;
        }
        // A local edit made during the request remains dirty against this exact
        // sent payload. Realtime echoes are queued behind this acknowledgement.
        this.acknowledge(key, id, payload);
        count++;
        if (report) { report.pushed++; if (!local) report.deleted++; }
      }
    } finally {
      this.endDraft(key);
    }
    if (count) {
      this.config.update(c => ({ ...c, lastPushAt: new Date().toISOString() }));
      this.writeConfig();
    }
    this.scheduleRefreshPending();
    return count;
  }

  pushAll(): Promise<SyncReport> {
    return this.reportOperation(async report => {
      this.assertOrdinary();
      if (await this.applyPendingReset()) return;
      await this.pushAllInternal(report);
    });
  }

  private async pushAllInternal(report: SyncReport): Promise<void> {
    if (this.restoreIntent()) throw new Error('রিস্টোর করা ডেটা আগে স্পষ্টভাবে মিলিয়ে নিন।');
    for (const key of this.collectionKeys()) {
      if (await this.pushCollectionInternal(key, report)) report.collections++;
      this.dropFromOutboxIfLanded(key);
    }
    this.flushMetadata();
  }

  private async reportOperation(work: (report: SyncReport) => Promise<void>): Promise<SyncReport> {
    const started = Date.now();
    const report: SyncReport = { pushed: 0, deleted: 0, pulled: 0, collections: 0, ms: 0 };
    try { await this.enqueue(() => work(report)); }
    catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      this.status.set('error');
      this.statusMessage.set(report.error);
      this.scheduleRetry();
    }
    report.ms = Date.now() - started;
    report.conflicts = this.syncConflicts().length;
    this.refreshPending();
    this.lastResult.set(report);
    return report;
  }

  pullAll(): Promise<SyncReport> {
    return this.reportOperation(async report => {
      this.assertOrdinary();
      if (await this.applyPendingReset()) return;
      await this.pullAllInternal(report);
      await this.subscribeRealtime();
    });
  }

  private async pullAllInternal(report: SyncReport, restoring = false): Promise<void> {
    const client = await this.supabase();
    if (!client) throw new Error('Supabase চালু নেই');
    const rows = await this.readRemote(client);
    for (const key of this.collectionKeys()) {
      const remote = this.remoteIndex(rows.filter(row => row.collection === key));
      const ids = new Set([...remote.keys(), ...(this.synced.get(key) ?? []),
        ...(restoring ? Object.keys(this.restoreIntent()?.rows[key] ?? {}) : [])]);
      let changed = false;
      this.beginDraft(key, true);
      try {
        for (const id of ids) {
          const row = remote.get(id);
          const result = this.reconcileRow(key, id, row?.data ?? null, row?.row_id ?? id, restoring, row?.updated_at);
          if (row) report.pulled++;
          if (result === 'remote') {
            changed = true;
            if (!row || isTombstone(row.data)) report.deleted++;
          }
        }
      } finally {
        this.endDraft(key);
      }
      this.rememberRemoteIds(key, remote.keys());
      if (changed) report.collections++;
    }
    // A full read just applied everything, so every collection is current.
    const newest = this.newestAt(rows, this.config().lastRemoteAt);
    const marks = new Map<string, string>();
    for (const row of rows) {
      if (!row.updated_at) continue;
      const at = marks.get(row.collection);
      if (!at || Date.parse(row.updated_at) > Date.parse(at)) marks.set(row.collection, row.updated_at);
    }
    for (const key of this.collectionKeys()) this.markPulled(key, marks.get(key) ?? newest);
    this.flushMetadata();
    this.config.update(c => ({ ...c, lastPullAt: new Date().toISOString() }));
    this.writeConfig();
    this.refreshPending();
  }

  chooseRemote(collection: string, rowId: string): Promise<ConflictResolutionResult> {
    return this.resolveConflict(collection, rowId, 'remote');
  }

  chooseLocal(collection: string, rowId: string): Promise<ConflictResolutionResult> {
    return this.resolveConflict(collection, rowId, 'local');
  }

  private resolveConflict(key: string, id: string, choice: 'local' | 'remote'): Promise<ConflictResolutionResult> {
    return this.enqueue(async () => {
      if (!this.collectionKeys().includes(key)) throw new Error('এই কালেকশনে সংঘাত সমাধান সমর্থিত নয়।');
      if (key === WAREHOUSES_KEY && /^n\d+$/.test(id) && !this.warehouseIds.has(id)) {
        throw new Error('পুরোনো গুদামের অবস্থানভিত্তিক ডিলিট কোন নামের জন্য ছিল তা জানা নেই; ক্লাউডে ম্যানুয়াল পর্যালোচনা দরকার।');
      }
      const conflict = this.syncConflicts().find(c => c.collection === key && c.rowId === id);
      if (!conflict) return { resolved: false, reason: 'missing-conflict' };
      const local = this.localPayload(key, id);
      const client = await this.supabase();
      if (!client) throw new Error('Supabase চালু নেই');
      const remoteId = conflict.remoteRowId ?? id;
      const remote = (await this.readRemote(client, key)).find(row => row.row_id === remoteId)?.data ?? null;
      if (stableJson(forSync(remote)) !== stableJson(conflict.remote)) {
        this.recordConflict(key, id, this.localPayload(key, id), remote, remoteId);
        return { resolved: false, reason: 'remote-changed' };
      }
      if (stableJson(local) !== stableJson(conflict.local) || stableJson(local) !== stableJson(this.localPayload(key, id))) {
        this.recordConflict(key, id, this.localPayload(key, id), remote, remoteId);
        return { resolved: false, reason: 'local-changed' };
      }
      if (choice === 'remote') {
        this.applyLocal(key, id, remote);
        this.acknowledge(key, id, remote);
      } else {
        const payload = local ?? { [TOMBSTONE]: new Date().toISOString() };
        if (!await this.writeRemote(client, key, remoteId, payload, remote)) {
          await this.competingWrite(client, key, id, remoteId);
          return { resolved: false, reason: 'remote-changed' };
        }
        this.acknowledge(key, id, payload);
      }
      this.clearConflict(key, id);
      this.completeIntentRow(key, id);
      this.refreshPending();
      await this.storage.flush();
      return { resolved: true };
    });
  }

  /** Live updates from other devices/branches of the shop. */
  async subscribeRealtime(): Promise<void> {
    if (!this.canAutoSync()) return;
    const generation = ++this.subscriptionGeneration;
    const client = await this.supabase();
    if (!client || !this.canAutoSync() || generation !== this.subscriptionGeneration) return;
    this.realtime?.remove();
    this.realtime = undefined;
    const channel = client.channel('sm-rows')
      .on('postgres_changes', { event: '*', schema: 'public', table: ROWS_TABLE }, payload => {
        if (generation !== this.subscriptionGeneration || !this.canAutoSync()) return;
        if (payload.eventType === 'DELETE') { void this.resumeSync().catch(() => undefined); return; }
        void this.applyRealtime(payload.new as RemoteRow).catch(error => {
          this.status.set('error');
          this.statusMessage.set(error instanceof Error ? error.message : String(error));
          this.scheduleRetry();
        });
      })
      .subscribe(status => {
        if (generation !== this.subscriptionGeneration) return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.realtime?.remove();
          this.realtime = undefined;
          this.scheduleRetry();
        }
      });
    this.realtime = { remove: () => { void client.removeChannel(channel); } };
  }

  private applyRealtime(row?: { collection?: string; row_id?: string; data?: Payload; updated_at?: string }): Promise<void> {
    if (!this.canAutoSync() || !row?.collection || !row.row_id || !row.data || !this.collectionKeys().includes(row.collection)) return Promise.resolve();
    const event = forSync(row) as RemoteRow;
    if (row.updated_at) this.noteRemoteUpdate([{ ...event, updated_at: row.updated_at }]);
    return this.enqueue(async () => {
      if (!this.config().autoSync || this.restoreIntent()) return;
      const id = this.logicalId(event);
      if (id === null) return;
      // Even delayed echoes must not roll a clean, newer acknowledgement back.
      // Read the current row rather than trusting socket delivery order.
      const client = await this.supabase();
      if (!client) return;
      const current = await this.readRemoteRow(client, event.collection, event.row_id);
      this.reconcileRow(event.collection, id, current?.data ?? null, event.row_id, false, current?.updated_at);
      this.flushMetadata();
      this.refreshPending();
    });
  }

  async boot(_forcePull = false, keys?: string[]): Promise<void> {
    // After a reload the key is not verified yet; pulling before that returns an
    // RLS-empty shop and would look like every local row was deleted.
    if (!this.keyVerified && !(await this.verifyKey())) { this.reportGateClosed(); return; }
    if (this.keyVerified && (await this.applyPendingReset())) return;
    if (!this.canAutoSync()) return;
    const target = this.scopedKeys(keys?.length ? keys : this.activeScope);
    this.status.set('connecting');
    const report = await this.reportOperation(async result => {
      this.assertOrdinary();
      if (target.length) {
        const bootClient = await this.supabase();
        if (bootClient) await this.readLastRemoteAt(bootClient).catch(() => undefined);
        await this.pullCollections(target);
        for (const key of target) {
          if (this.pendingCount(key) && await this.pushCollectionInternal(key, result)) result.collections++;
          this.dropFromOutboxIfLanded(key);
        }
        this.flushMetadata();
      } else {
        // No page scope was supplied (older call paths); fall back to the shop.
        await this.pullAllInternal(result);
        await this.pushAllInternal(result);
      }
      const client = await this.supabase();
      if (client) await this.readLastRemoteAt(client).catch(() => undefined);
      await this.subscribeRealtime();
    });
    if (report.error) throw new Error(report.error);
    this.status.set(report.conflicts ? 'error' : 'online');
    this.statusMessage.set(report.conflicts ? `${report.conflicts} সংঘাত — সেটিংস থেকে পর্যালোচনা করুন।` : `${report.pulled} সারি মিলিয়ে দেখা হয়েছে`);
    if (report.conflicts) this.cancelScheduling();
    // A sale saved before the last reload may still be only on this device.
    void this.retryOutbox().catch(() => undefined);
  }

  /** Maintenance only: preserve identities and propagate deletions to every device. */
  async deleteAllRows(): Promise<number> {    return this.enqueue(async () => {
      if (!this.isEnabled()) return 0;
      if (!this.paused) throw new Error('ক্লাউড মুছে ফেলার আগে সিঙ্ক বিরতি দিন।');
      const client = await this.supabase();
      if (!client) throw new Error('Supabase চালু নেই');
      const rows = await this.readRemote(client);
      const keep = new Set(['sm_users_v1', SETTINGS_KEY, COUNTER_COLLECTION]);
      let count = 0;
      for (const row of rows) {
        if (keep.has(row.collection) || isTombstone(row.data)) continue;
        const id = this.logicalId(row);
        if (id === null) throw new Error('অস্পষ্ট পুরোনো গুদাম সারি আছে; মুছে ফেলা বন্ধ রাখা হয়েছে।');
        const payload = { [TOMBSTONE]: new Date().toISOString() };
        if (!await this.writeRemote(client, row.collection, row.row_id, payload, row.data)) {
          await this.competingWrite(client, row.collection, id, row.row_id);
          throw new Error('মুছে ফেলার সময় অন্য ডিভাইস সারিটি বদলেছে; স্থানীয় ডেটা অক্ষত আছে।');
        }
        this.acknowledge(row.collection, id, payload);
        count++;
      }
      if (this.syncConflicts().length) throw new Error('অমীমাংসিত সংঘাত আছে; নিরাপদে সব ডেটা মুছে ফেলা যায়নি।');
      await this.storage.flush();
      this.refreshPending();
      return count;
    }, true);
  }

  /**
   * Erases the whole cloud shop except the account rows, then clears this
   * device and records the reset so every other device wipes its old cache
   * instead of re-uploading it on the next sync.
   */
  async hardReset(): Promise<{ ok: boolean; deleted?: number; error?: string }> {
    try {
      return await this.enqueue(async () => {
        if (!this.isEnabled()) {
          await this.wipeLocalBusinessData();
          return { ok: true, deleted: 0 };
        }
        if (!this.keyVerified && !(await this.verifyKey())) return { ok: false, error: 'cloud' };
        const client = await this.supabase();
        if (!client) return { ok: false, error: 'cloud' };
        // The marker goes in before the first delete: other devices check it
        // before pushing, so rows they still hold cannot come back mid-reset.
        const resetAt = new Date().toISOString();
        if (!await this.writeResetMarker(client, resetAt)) return { ok: false, error: 'cloud' };
        let deleted = 0;
        let remaining: RemoteRow[];
        try {
          remaining = await this.businessRows(client);
          // A second pass catches rows another tab wrote between our batches.
          for (let pass = 0; pass < 2 && remaining.length; pass++) {
            const groups = new Map<string, string[]>();
            for (const row of remaining) {
              const ids = groups.get(row.collection) ?? [];
              ids.push(row.row_id);
              groups.set(row.collection, ids);
            }
            for (const [collection, ids] of groups) {
              for (const batch of chunks(ids, 100)) {
                deleted += await this.deleteRemote(client, collection, batch);
              }
            }
            remaining = await this.businessRows(client);
          }
        } catch (error) {
          return await this.abandonReset(client, resetAt, error instanceof Error ? error.message : String(error));
        }
        // Never report success and never wipe this device for a partial reset.
        if (remaining.length) return await this.abandonReset(client, resetAt, 'incomplete');
        try { localStorage.setItem(this.scopedKey(RESET_SEEN_KEY), resetAt); } catch { /* private mode */ }
        await this.wipeLocalBusinessData();
        return { ok: true, deleted };
      }, true);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Withdraws the marker of a reset that could not finish so no device wipes for nothing. */
  private async abandonReset(client: SupabaseClient, resetAt: string, error: string): Promise<{ ok: false; error: string }> {
    await this.deleteRemote(client, META_COLLECTION, [RESET_ROW_ID]).catch(() => 0);
    // Even when the marker cannot be withdrawn this device must keep its data
    // instead of wiping itself on the next sync for a reset that never finished.
    try { localStorage.setItem(this.scopedKey(RESET_SEEN_KEY), resetAt); } catch { /* private mode */ }
    return { ok: false, error };
  }

  /** Shop data only: accounts, voucher settings and the reset marker are not business rows. */
  private async businessRows(client: SupabaseClient): Promise<RemoteRow[]> {
    return (await this.readRemote(client)).filter(row => row.collection !== USER_COLLECTION
      && row.collection !== SETTINGS_KEY
      && !(row.collection === META_COLLECTION && row.row_id === RESET_ROW_ID));
  }

  /** `select` after delete returns only the rows the policy really removed. */
  private async deleteRemote(client: SupabaseClient, collection: string, ids: string[]): Promise<number> {
    const { data, error } = await client.from(ROWS_TABLE).delete()
      .eq('collection', collection).in('row_id', ids).select('row_id');
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  }

  private async writeResetMarker(client: SupabaseClient, resetAt: string): Promise<boolean> {
    const { data, error } = await client.from(ROWS_TABLE).upsert(
      { collection: META_COLLECTION, row_id: RESET_ROW_ID, data: { resetAt } },
      { onConflict: 'collection,row_id' }
    ).select('row_id');
    if (error) return false;
    return !Array.isArray(data) || data.length > 0;
  }

  /** A reset row newer than the last one this device applied wipes its cache. */
  private async applyPendingReset(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    let seenKey = '';
    try { seenKey = this.scopedKey(RESET_SEEN_KEY); } catch { return false; }
    try {
      const client = await this.supabase();
      if (!client) return false;
      const { data, error } = await client.from(ROWS_TABLE).select('data')
        .eq('collection', META_COLLECTION).eq('row_id', RESET_ROW_ID).range(0, 0);
      if (error) return false;
      const resetAt = (data?.[0] as { data?: { resetAt?: unknown } } | undefined)?.data?.resetAt;
      if (typeof resetAt !== 'string' || !Number.isFinite(Date.parse(resetAt))) return false;
      let seen = '';
      try { seen = localStorage.getItem(seenKey) ?? ''; } catch { return false; }
      if (seen === resetAt) return false;
      try { localStorage.setItem(seenKey, resetAt); } catch { /* wipe still proceeds */ }
      // A device that never held this shop has nothing to wipe. Reloading it
      // here would only throw away the login that just succeeded.
      if (!this.hasLocalShopData()) return false;
      // The reset is data-only: this device keeps its signed-in session.
      await this.wipeLocalBusinessData(true);
      window.location.reload();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Anchors that only exist once this device has actually held the shop. Seeded
   * collections (settings, wallets, warehouses) do not count.
   */
  private static readonly SHOP_DATA_KEYS = [
    'sm_products_v2', 'sm_parties_v1', 'sm_sales_v1', 'sm_purchases_v1',
    'sm_payments_v1', 'sm_expenses_v1'
  ];

  private hasLocalShopData(): boolean {
    return CloudService.SHOP_DATA_KEYS.some(key =>
      this.rows(key).length > 0 || (this.synced.get(key)?.size ?? 0) > 0
    );
  }

  /** Clears this device's cached shop while keeping accounts and backend settings. */
  private async wipeLocalBusinessData(keepLogin = false): Promise<void> {
    this.paused = true;
    this.cancelScheduling();
    const keep: Record<string, unknown> = {};
    const users = this.storage.read<unknown>(USER_COLLECTION);
    if (users !== null) keep[USER_COLLECTION] = users;
    // Voucher settings are branding, not books: the reset must not drop the
    // shop's signature image, terms and print layout.
    const voucherSettings = this.storage.read<unknown>(SETTINGS_KEY);
    if (voucherSettings !== null) keep[SETTINGS_KEY] = voucherSettings;
    const config = this.storage.read<unknown>(CLOUD_CONFIG_KEY);
    if (config !== null) keep[CLOUD_CONFIG_KEY] = config;
    const backend = this.storage.read<unknown>(BACKEND_VERSION_KEY);
    if (backend !== null) keep[BACKEND_VERSION_KEY] = backend;
    // A reset pushed by another device wipes shop data, not the local login.
    if (keepLogin) {
      for (const key of [SESSION_STORAGE_KEY, CLOUD_KEY_STORAGE]) {
        const value = this.storage.read<unknown>(key);
        if (value !== null) keep[key] = value;
      }
    }
    await this.storage.importBackup({
      app: 'sm-enterprise-x1',
      kind: 'full-backup',
      schema: StorageService.DB_VERSION,
      exportedAt: new Date().toISOString(),
      collections: keep,
      media: []
    });
    this.synced.clear();
    this.pushed.clear();
    this.editTimes.clear();
    this.pulledAt.clear();
    this.outbox.clear();
    this.warehouseIds.clear();
    this.syncConflicts.set([]);
    this.restoreIntent.set(null);
    this.config.update(c => ({ ...c, lastPushAt: null, lastPullAt: null, lastRemoteAt: null }));
    this.writeConfig();
    try {
      for (const key of [SYNCED_IDS_KEY, SYNC_SIGS_KEY, SYNC_TIMES_KEY, WAREHOUSE_IDS_KEY, PULL_MARKS_KEY, OUTBOX_KEY,
        SYNC_CONFLICTS_KEY, RESTORE_SYNC_INTENT_KEY,
        ...(keepLogin ? [] : [SESSION_STORAGE_KEY])]) {
        localStorage.removeItem(this.scopedKey(key));
      }
      if (!keepLogin) localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Private mode: the in-memory wipe and reload still clear this launch.
    }
    if (!keepLogin) this.clearUserKey();
  }

  snapshotMap(): Map<string, Map<string, string>> {
    return this.pushed;
  }
}

const CLOUD_REQUEST_TIMEOUT_MS = 15_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) abortFromRequest();
  else init?.signal?.addEventListener('abort', abortFromRequest, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error(`Cloud request timed out after ${CLOUD_REQUEST_TIMEOUT_MS / 1000} seconds.`)),
    CLOUD_REQUEST_TIMEOUT_MS
  );
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', abortFromRequest);
  });
};

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Supabase stores the rows, Cloudinary stores the pictures — a base64 image picked
 * while Cloudinary is off stays on this device and leaves the row blank.
 */
/**
 * Payload equality must not depend on key order: a row pulled from the cloud
 * comes back with the server's key order, so a plain JSON.stringify made every
 * such row look "pending" forever and kept the sync bar on screen.
 */
function stableJson(value: unknown): string {
  const normalized = forSync(value);
  if (Array.isArray(normalized)) return `[${normalized.map(stableJson).join(',')}]`;
  if (normalized && typeof normalized === 'object') {
    const record = normalized as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(normalized) ?? 'null';
}

function backendIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url.trim();
  }
}

function warehouseName(value: unknown): string {
  return String(value && typeof value === 'object' ? (value as Payload)['value'] ?? '' : value ?? '').trim();
}

function warehouseId(name: string): string {
  return `w:${encodeURIComponent(name.normalize('NFKC').toLocaleLowerCase())}`;
}

function isTombstone(value: unknown): boolean {
  return !!value && typeof value === 'object' && typeof (value as Payload)[TOMBSTONE] === 'string';
}

/**
 * Short fingerprint of a row payload. The full JSON is too large to keep for
 * every row in localStorage, and a fingerprint is all change detection needs.
 */
function signature(value: unknown): string {
  const normalized = forSync(value);
  if (isTombstone(normalized)) return `deleted:${String((normalized as Payload)[TOMBSTONE])}`;
  const text = stableJson(normalized);
  let h1 = 0x811c9dc5;
  let h2 = 0x85ebca6b;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function forSync<T>(value: T): T {
  if (typeof value === 'string') return (value.startsWith('data:image/') ? '' : value) as unknown as T;
  if (typeof value === 'number' && !Number.isFinite(value)) return null as unknown as T;
  if (value === undefined) return null as unknown as T;
  if (Array.isArray(value)) return value.map(item => forSync(item)) as unknown as T;
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString() as unknown as T;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) out[key] = forSync(item);
    }
    return out as unknown as T;
  }
  return value;
}

/** Keeps a locally held picture when the cloud row only carries the blank placeholder. */
function keepLocalImages<T>(local: T, remote: T): T {
  if (typeof local === 'string' && local.startsWith('data:image/') && (remote === '' || remote === null || remote === undefined)) return local;
  if (Array.isArray(local) && Array.isArray(remote)) {
    return remote.map((item, index) => keepLocalImages(local[index], item)) as unknown as T;
  }
  if (local && remote && typeof local === 'object' && typeof remote === 'object') {
    const out: Record<string, unknown> = { ...(remote as Record<string, unknown>) };
    for (const [key, item] of Object.entries(local as Record<string, unknown>)) {
      if (key in out && (out[key] === '' || out[key] === null)) out[key] = keepLocalImages(item, out[key]);
    }
    return out as unknown as T;
  }
  return remote;
}

const PX_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function dataUriToBlob(dataUri: string): Blob {
  const [head, body = ''] = dataUri.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
