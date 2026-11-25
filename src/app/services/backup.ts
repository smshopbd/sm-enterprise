import { Injectable, computed, inject, signal } from '@angular/core';
import { StorageService, BackupPayload } from './storage';
import { CLOUD_CONFIG_KEY, CLOUD_KEY_STORAGE, CloudService } from './cloud';
import { SESSION_KEY, SessionService } from './session';
import { DataService } from './data';
import { PreferencesService } from './preferences';
import { localDateIso } from '../utils/local-date';

/** Free Cloudinary plans reject raw files above 10 MB. */
const MAX_CLOUD_BYTES = 9 * 1024 * 1024;
const BACKUP_INDEX_KEY = 'sm_backup_index_v1';
const INDEX_LIMIT = 60;
/** Credentials and login state never leave the device inside a backup file. */
const OMIT_FROM_BACKUP = [CLOUD_CONFIG_KEY, CLOUD_KEY_STORAGE, SESSION_KEY, 'sm_device_key_v1', BACKUP_INDEX_KEY];
const KEEP_ON_RESTORE = [CLOUD_CONFIG_KEY, CLOUD_KEY_STORAGE, SESSION_KEY, 'sm_device_key_v1', BACKUP_INDEX_KEY];

const AUTO_KEY = 'sm_backup_auto_v1';
const LAST_KEY = 'sm_backup_last_v1';
const AUTO_CHECK_MS = 30 * 60 * 1000;

/** A backup is due when the newest one was not taken on the shop's current day. */
export function dailyBackupDue(lastAt: string | null | undefined, today = localDateIso()): boolean {
  if (!lastAt) return true;
  const parsed = new Date(lastAt);
  if (Number.isNaN(parsed.getTime())) return true;
  return localDateIso(parsed) !== today;
}

/** One Cloudinary folder per shop-local day: `<base>/backups/2026-11-12`. */
export function backupFolderFor(base: string, day = localDateIso()): string {
  return [base, 'backups', day].filter(Boolean).join('/');
}

/** Sortable file name; seconds keep two backups on the same day apart. */
export function backupFileName(now = new Date()): string {
  const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(value => (value < 10 ? `0${value}` : String(value))).join('');
  return `sm-x1-backup-${localDateIso(now)}-${stamp}.json`;
}

/** Automatic backup is on unless the shop switched it off (`0`). */
export function autoBackupEnabled(stored: string | null): boolean {
  return stored !== '0';
}

/** A readable list name: no path separators, always ends in `.json`, 80 characters at most. */
export function normalizeBackupName(input: string): string {
  const cleaned = Array.from(input)
    .map(ch => ('<>:"/\\|?*'.includes(ch) || ch.charCodeAt(0) < 32 ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  if (!cleaned) return '';
  return /\.json$/i.test(cleaned) ? cleaned : `${cleaned}.json`;
}

export interface CloudBackupEntry {
  id: string;
  name: string;
  url: string;
  bytes: number;
  /** Images embedded in the file; always 0 for data-only files (legacy entries may differ). */
  media: number;
  mode: 'full' | 'data';
  createdAt: string;
}

export interface BackupJob {
  busy: boolean;
  message: string;
  error?: string;
}

/**
 * Whole-database backup: a single JSON file kept on this computer or uploaded
 * to the shop's own Cloudinary account as a raw asset. No OAuth setup is
 * required — Cloudinary already stores the shop's images.
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private storage = inject(StorageService);
  private cloud = inject(CloudService);
  private data = inject(DataService);
  private prefs = inject(PreferencesService);
  private session = inject(SessionService);

  readonly job = signal<BackupJob>({ busy: false, message: '' });
  readonly cloudFiles = signal<CloudBackupEntry[]>([]);
  readonly autoBackup = signal(false);
  readonly lastBackupAt = signal('');
  readonly autoStatus = signal('');
  /** Cloudinary needs a cloud name and an unsigned preset; both live in Settings → Cloud. */
  readonly cloudReady = computed(() => this.cloud.isCloudinaryEnabled());

  constructor() {
    try {
      this.autoBackup.set(autoBackupEnabled(localStorage.getItem(AUTO_KEY)));
      this.lastBackupAt.set(localStorage.getItem(LAST_KEY) ?? '');
    } catch {
      /* private mode / SSR */
    }
  }

  /** True when the newest backup (manual or automatic) is from today. */
  backedUpToday(): boolean {
    return !dailyBackupDue(this.lastBackupAt());
  }

  setAutoBackup(value: boolean): void {
    this.autoBackup.set(value);
    try {
      if (value) localStorage.setItem(AUTO_KEY, '1');
      else localStorage.setItem(AUTO_KEY, '0');
    } catch {
      /* private mode */
    }
    this.autoStatus.set(value
      ? this.prefs.txt('প্রতিদিনের ব্যাকআপ চালু — দিনে একবার Cloudinary-তে নিজেই যাবে।', 'Daily backup is on — one automatic upload to Cloudinary per day.')
      : this.prefs.txt('স্বয়ংক্রিয় ব্যাকআপ বন্ধ — "এখনই ব্যাকআপ পাঠান" দিয়ে নিজে চালাতে পারবেন।', 'Automatic backup is off — use "Back up now" to run one yourself.'));
    if (value) void this.autoBackupIfDue();
  }

  // ------------------------------------------------------------------
  // local JSON file
  // ------------------------------------------------------------------
  async build(): Promise<BackupPayload> {
    const payload = await this.storage.exportBackup();
    for (const key of OMIT_FROM_BACKUP) delete payload.collections[key];
    return payload;
  }

  /**
   * Online backups stay data-only: the JSON keeps each record's Cloudinary
   * image link and the image bytes never enter the file. The result is a
   * normal app backup that the file-import screen can restore at any time.
   */
  async buildDataOnly(): Promise<BackupPayload> {
    const payload = await this.storage.exportCollections();
    for (const key of OMIT_FROM_BACKUP) delete payload.collections[key];
    return payload;
  }

  async download(): Promise<{ name: string; bytes: number }> {
    this.job.set({ busy: true, message: this.prefs.txt('ব্যাকআপ ফাইল তৈরি হচ্ছে…', 'Building the backup file…') });
    try {
      const payload = await this.build();
      const text = JSON.stringify(payload);
      const name = `sm-x1-backup-${localDateIso()}.json`;
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      this.job.set({ busy: false, message: this.prefs.txt(`${name} (${this.mb(text.length)}) ডাউনলোড হয়েছে।`, `${name} (${this.mb(text.length)}) downloaded.`) });
      return { name, bytes: text.length };
    } catch (error) {
      this.job.set({ busy: false, message: '', error: this.text(error) });
      throw error;
    }
  }

  async parse(file: File): Promise<BackupPayload> {
    const text = await file.text();
    let payload: BackupPayload;
    try {
      payload = JSON.parse(text) as BackupPayload;
    } catch {
      throw new Error(this.prefs.txt('ফাইলটি পড়া যায়নি — এটি সঠিক JSON ব্যাকআপ নয়।', 'Could not read the file — it is not a valid JSON backup.'));
    }
    return this.validate(payload);
  }

  async restore(payload: BackupPayload, mode: 'replace' | 'merge'): Promise<string> {
    if (!payload?.collections || typeof payload.collections !== 'object' || Array.isArray(payload.collections)) {
      throw new Error(this.prefs.txt('ব্যাকআপের ডাটা সঠিক নয়।', 'Invalid backup collections.'));
    }
    if (!this.session.has('manageSettings')) throw new Error(this.prefs.txt('শুধু অ্যাডমিন এই কাজ করতে পারবেন।', 'Only an administrator can perform this action.'));
    await this.cloud.pauseSync();
    try {
      const collections = { ...payload.collections };
      for (const key of OMIT_FROM_BACKUP) delete collections[key];
      Object.assign(collections, this.snapshot(KEEP_ON_RESTORE));
      const report = await this.storage.importBackup({ ...payload, collections }, mode);
      this.data.reloadFromStorage();
      await this.cloud.markRestoredData();
      this.cloud.save({ autoSync: false });
      await this.storage.flush();
      return this.prefs.txt(
        `${report.collections} কালেকশন, ${report.records} রেকর্ড, ${report.media} ছবি${report.conflicts ? ` · ${report.conflicts} সংঘাতে স্থানীয় ডেটা রাখা হয়েছে` : ''}। ক্লাউড অটো সিঙ্ক বন্ধ রাখা হয়েছে—ডাটা যাচাই করে সেটিংস থেকে সিঙ্ক করুন।`,
        `${report.collections} collections, ${report.records} records, ${report.media} images${report.conflicts ? ` · local data kept in ${report.conflicts} conflicts` : ''}. Cloud auto-sync is off; review the restored data before syncing in Settings.`
      );
    } finally {
      this.cloud.resumeAfterMaintenance();
    }
  }

  private snapshot(keys: string[]): Record<string, unknown> {
    const saved: Record<string, unknown> = {};
    for (const key of keys) {
      const value = this.storage.read(key);
      if (value !== null) saved[key] = value;
    }
    return saved;
  }

  // ------------------------------------------------------------------
  // Cloudinary raw uploads
  // ------------------------------------------------------------------
  /**
   * Uploads a data-only JSON file to the shop's own Cloudinary account, filed
   * under a folder named after the local day. Image bytes are never uploaded
   * here — the records already carry their Cloudinary links.
   */
  async push(): Promise<CloudBackupEntry> {
    this.job.set({
      busy: true,
      message: this.prefs.txt('Cloudinary-তে ব্যাকআপ পাঠানো হচ্ছে…', 'Uploading the backup to Cloudinary…')
    });
    try {
      const { cloudName, uploadPreset, folder } = this.cloud.config().cloudinary;
      if (!cloudName || !uploadPreset) {
        throw new Error(this.prefs.txt(
          'Cloudinary কনফিগ নেই — Settings → Cloud ট্যাবে Cloud name ও unsigned preset সেভ করুন।',
          'Cloudinary is not configured — save the cloud name and unsigned preset in Settings → Cloud.'
        ));
      }
      const payload = await this.buildDataOnly();
      const body = JSON.stringify(payload);
      const bytes = new Blob([body]).size;
      if (bytes > MAX_CLOUD_BYTES) {
        throw new Error(this.prefs.txt(
          `JSON ফাইলটি ${this.mb(bytes)} — Cloudinary-র সীমার বেশি।`,
          `The JSON file is ${this.mb(bytes)} — above Cloudinary’s limit.`
        ));
      }

      const now = new Date();
      const name = backupFileName(now);
      const publicId = `${name.replace(/\.json$/, '')}-${Math.random().toString(36).slice(2, 8)}`;
      const form = new FormData();
      form.append('file', new Blob([body], { type: 'application/json' }), name);
      form.append('upload_preset', uploadPreset);
      form.append('folder', backupFolderFor(folder, localDateIso(now)));
      form.append('public_id', publicId);

      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, { method: 'POST', body: form });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.secure_url) {
        throw new Error(json?.error?.message || `HTTP ${response.status}`);
      }

      const entry: CloudBackupEntry = {
        id: String(json.public_id ?? publicId),
        name,
        url: String(json.secure_url),
        bytes: Number(json.bytes ?? bytes),
        media: 0,
        mode: 'data',
        createdAt: new Date().toISOString()
      };
      this.remember(entry);
      this.markBackedUp();
      this.job.set({
        busy: false,
        message: this.prefs.txt(
          `${name} Cloudinary-তে জমা হয়েছে (${this.mb(bytes)}, শুধু JSON ডাটা)।`,
          `${name} saved to Cloudinary (${this.mb(bytes)}, JSON data only).`
        )
      });
      return entry;
    } catch (error) {
      this.job.set({ busy: false, message: '', error: this.text(error) });
      throw error;
    }
  }

  /** The index travels with the shop through Supabase, so every device lists the same files. */
  listBackups(): CloudBackupEntry[] {
    const raw = this.storage.read(BACKUP_INDEX_KEY);
    const list = (Array.isArray(raw) ? (raw as CloudBackupEntry[]).filter(entry => !!entry?.url) : [])
      .slice()
      .sort((a, b) => this.stamp(b.createdAt) - this.stamp(a.createdAt));
    this.cloudFiles.set(list);
    // Another device's upload counts as today's backup for this shop.
    const newest = list.length ? this.stamp(list[0].createdAt) : 0;
    if (newest > this.stamp(this.lastBackupAt())) {
      this.lastBackupAt.set(list[0].createdAt);
      try {
        localStorage.setItem(LAST_KEY, list[0].createdAt);
      } catch {
        /* private mode */
      }
    }
    return list;
  }

  /** Saves a copy of a cloud backup file to this computer. */
  async downloadFile(entry: CloudBackupEntry): Promise<{ name: string; bytes: number }> {
    this.job.set({ busy: true, message: this.prefs.txt(`${entry.name} নামানো হচ্ছে…`, `Downloading ${entry.name}…`) });
    try {
      const response = await fetch(entry.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const name = /\.json$/i.test(entry.name) ? entry.name : `${entry.name}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      this.job.set({ busy: false, message: this.prefs.txt(`${name} (${this.mb(blob.size)}) ডাউনলোড হয়েছে।`, `${name} (${this.mb(blob.size)}) downloaded.`) });
      return { name, bytes: blob.size };
    } catch (error) {
      this.job.set({ busy: false, message: '', error: this.text(error) });
      throw error;
    }
  }

  /** Renames an entry in the shared list; the Cloudinary asset keeps its own public id. */
  renameEntry(entry: CloudBackupEntry, rawName: string): CloudBackupEntry {
    const name = normalizeBackupName(rawName);
    if (!name) {
      throw new Error(this.prefs.txt('নতুন নাম দিন।', 'Enter a new name.'));
    }
    const list = this.listBackups();
    const target = list.find(item => item.id === entry.id);
    if (!target) {
      throw new Error(this.prefs.txt('ব্যাকআপটি তালিকায় নেই — আবার তালিকা দেখুন।', 'That backup is no longer in the list — refresh it.'));
    }
    if (list.some(item => item.id !== entry.id && item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(this.prefs.txt('এই নামে আরেকটি ব্যাকআপ আছে — অন্য নাম দিন।', 'Another backup already uses that name — pick a different one.'));
    }
    const updated: CloudBackupEntry = { ...target, name };
    this.writeIndex(list.map(item => (item.id === entry.id ? updated : item)));
    return updated;
  }

  async downloadEntry(entry: CloudBackupEntry): Promise<BackupPayload> {
    this.job.set({ busy: true, message: this.prefs.txt(`${entry.name} নামানো হচ্ছে…`, `Downloading ${entry.name}…`) });
    try {
      const response = await fetch(entry.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      let payload: BackupPayload;
      try {
        payload = JSON.parse(text) as BackupPayload;
      } catch {
        throw new Error(this.prefs.txt('ফাইলটি পড়া যায়নি — ব্যাকআপটি নষ্ট হতে পারে।', 'Could not read the file — the backup may be damaged.'));
      }
      const valid = this.validate(payload);
      this.job.set({ busy: false, message: this.prefs.txt(`${entry.name} পড়া হয়েছে — এখন রিস্টোর করুন।`, `${entry.name} loaded — now restore it.`) });
      return valid;
    } catch (error) {
      this.job.set({ busy: false, message: '', error: this.text(error) });
      throw error;
    }
  }

  /** Removes the entry from the list only; the file itself must be deleted in Cloudinary. */
  removeEntry(entry: CloudBackupEntry): void {
    const next = this.listBackups().filter(item => item.id !== entry.id);
    this.writeIndex(next);
  }

  async autoBackupIfDue(): Promise<'sent' | 'skipped' | 'failed'> {
    if (!this.autoBackup() || !this.cloudReady()) return 'skipped';
    if (!this.session.currentUser() || !this.session.has('manageSettings')) return 'skipped';
    // The shared list tells whether another device already uploaded today.
    this.listBackups();
    if (this.backedUpToday()) return 'skipped';
    try {
      const entry = await this.push();
      this.autoStatus.set(this.prefs.txt(
        `আজকের ব্যাকআপ সম্পন্ন — ${entry.name} (${this.mb(entry.bytes)})।`,
        `Today’s backup is done — ${entry.name} (${this.mb(entry.bytes)}).`
      ));
      return 'sent';
    } catch (error) {
      this.autoStatus.set(this.prefs.txt(`স্বয়ংক্রিয় ব্যাকআপ ব্যর্থ: ${this.text(error)}`, `Automatic backup failed: ${this.text(error)}`));
      return 'failed';
    }
  }

  /** Re-checks the daily backup while the tab stays open all day. */
  startAutoBackup(): void {
    if (typeof window === 'undefined') return;
    if (!this.autoStarted) {
      this.autoStarted = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void this.autoBackupIfDue();
      });
      window.setInterval(() => {
        if (!document.hidden) void this.autoBackupIfDue();
      }, AUTO_CHECK_MS);
      window.setTimeout(() => void this.autoBackupIfDue(), 10_000);
    }
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------
  private autoStarted = false;

  private validate(payload: BackupPayload): BackupPayload {
    if (payload?.app !== 'sm-enterprise-x1' || !payload.collections || typeof payload.collections !== 'object' || Array.isArray(payload.collections)) {
      throw new Error(this.prefs.txt('এই ফাইলটি এই এ্যাপের ব্যাকআপ নয়।', 'This file is not a backup from this app.'));
    }
    return payload;
  }

  private remember(entry: CloudBackupEntry): void {
    const next = [entry, ...this.listBackups().filter(item => item.id !== entry.id)].slice(0, INDEX_LIMIT);
    this.writeIndex(next);
  }

  private writeIndex(list: CloudBackupEntry[]): void {
    this.storage.write(BACKUP_INDEX_KEY, list);
    this.cloudFiles.set(list);
    void this.cloud.pushCollection(BACKUP_INDEX_KEY).catch(() => 0);
  }

  private markBackedUp(): void {
    const at = new Date().toISOString();
    this.lastBackupAt.set(at);
    try {
      localStorage.setItem(LAST_KEY, at);
    } catch {
      /* private mode */
    }
  }

  private mb(bytes: number): string {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`;
  }

  private stamp(iso: string | null | undefined): number {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? ms : 0;
  }

  private text(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
