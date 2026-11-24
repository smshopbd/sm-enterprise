import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage';
import { CLOUD_KEY_STORAGE, CloudService } from './cloud';
import {
  cloudKeyHash, deriveCloudKey, hashSecret, isStoredSecret, needsStretch, sha256Hex, verifySecret, type StoredSecret
} from '../utils/secret';

export type UserRole = 'Admin' | 'Salesman' | 'Accountant';

export type Permission =
  | 'manageUsers'
  | 'editPrice'
  | 'deleteRecords'
  | 'viewReports'
  | 'viewAccounts'
  | 'cashClosing'
  | 'manageSettings'
  | 'usePos'
  | 'viewHrm';

export const ALL_PERMISSIONS: Permission[] = [
  'manageUsers', 'editPrice', 'deleteRecords', 'viewReports',
  'viewAccounts', 'cashClosing', 'manageSettings', 'usePos', 'viewHrm'
];

export interface UserAccount {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  active: boolean;
  /** Explicit per-user grants; absent means "use the role defaults". */
  permissions?: Permission[];
  /** Compressed avatar reference: data URL off-cloud, Cloudinary URL once uploaded. */
  photo?: string;
  /** the shop owner account — password resettable, never deletable */
  main?: boolean;
  secret?: StoredSecret;
  /** SHA-256 of the password-derived cloud key the database policy matches. */
  cloudHash?: string;
  /** only present on records written before passwords were hashed */
  pin?: string;
}

export type AuditCategory =
  | 'sales' | 'purchases' | 'battery' | 'parties' | 'products' | 'stock'
  | 'accounts' | 'warranty' | 'settings' | 'security' | 'data' | 'other';

export interface AuditCategoryMeta {
  key: AuditCategory;
  bn: string;
  en: string;
}

export const AUDIT_CATEGORIES: AuditCategoryMeta[] = [
  { key: 'sales', bn: 'বিক্রয় ও POS', en: 'Sales & POS' },
  { key: 'purchases', bn: 'ক্রয়', en: 'Purchases' },
  { key: 'battery', bn: 'ব্যাটারি', en: 'Battery' },
  { key: 'parties', bn: 'পার্টি ও লেজার', en: 'Parties & Ledger' },
  { key: 'products', bn: 'পণ্য', en: 'Products' },
  { key: 'stock', bn: 'স্টক', en: 'Stock' },
  { key: 'accounts', bn: 'হিসাব ও ক্যাশ', en: 'Accounts & Cash' },
  { key: 'warranty', bn: 'ওয়ারেন্টি', en: 'Warranty' },
  { key: 'settings', bn: 'সেটিংস', en: 'Settings' },
  { key: 'security', bn: 'ইউজার ও নিরাপত্তা', en: 'Users & Security' },
  { key: 'data', bn: 'ব্যাকআপ ও ডাটা', en: 'Backup & Data' },
  { key: 'other', bn: 'অন্যান্য', en: 'Other' }
];

/**
 * Categories come from the action name so every call site stays a plain
 * log(action, detail); actions shared by pages (Print, Export) must therefore
 * keep the meaning of the page that writes them.
 */
const AUDIT_CATEGORY_BY_ACTION: Record<string, AuditCategory> = {
  'POS Sale': 'sales',
  'Sale Created': 'sales',
  'Sale Updated': 'sales',
  'Sale Deleted': 'sales',
  'Purchase Created': 'purchases',
  'Purchase Updated': 'purchases',
  'Purchase Deleted': 'purchases',
  'Battery Voucher': 'battery',
  'Party Created': 'parties',
  'Party Updated': 'parties',
  'Party Deleted': 'parties',
  'Party Opening Changed': 'parties',
  'Opening Balance Corrected': 'parties',
  'Supplier Payment': 'parties',
  'Payment Received': 'parties',
  'Supplier Payment Edited': 'parties',
  'Payment Received Edited': 'parties',
  'Supplier Return': 'parties',
  'Customer Added': 'parties',
  'Product Created': 'products',
  'Product Updated': 'products',
  'Product Deleted': 'products',
  'Product Cloned': 'products',
  'Products Deleted': 'products',
  'Product Import': 'products',
  'Brand Created': 'products',
  'Brand Updated': 'products',
  'Brand Deleted': 'products',
  'Model Created': 'products',
  'Model Updated': 'products',
  'Model Deleted': 'products',
  'Category Created': 'products',
  'Category Updated': 'products',
  'Category Deleted': 'products',
  'Sub Category Created': 'products',
  'Sub Category Updated': 'products',
  'Sub Category Deleted': 'products',
  'Stock Reconciled': 'stock',
  'Cash Closing': 'accounts',
  'Delete': 'accounts',
  'Print': 'accounts',
  'Export': 'accounts',
  'Warranty Stock Supplier Movement': 'warranty',
  'Warranty Stock Edited': 'warranty',
  'Warranty Stock Deleted': 'warranty',
  'Warranty Stock Adjustment': 'warranty',
  'Settings Changed': 'settings',
  'Theme Changed': 'settings',
  'Settings Reset': 'settings',
  'Warehouse Added': 'settings',
  'Warehouse Renamed': 'settings',
  'Warehouse Deleted': 'settings',
  'Unit Added': 'settings',
  'Unit Renamed': 'settings',
  'Unit Deleted': 'settings',
  'Default Unit Set': 'settings',
  'Admin Setup': 'security',
  'Login': 'security',
  'Logout': 'security',
  'User Created': 'security',
  'User Updated': 'security',
  'User Deleted': 'security',
  'Password Changed': 'security',
  'Audit Cleared': 'security',
  'Cloud Settings': 'data',
  'Cloud Sync': 'data',
  'Supabase Test': 'data',
  'Cloudinary Test': 'data',
  'Restore Review': 'data',
  'Sync Conflict': 'data',
  'Backup Exported': 'data',
  'Backup Imported': 'data',
  'Cloud Backup': 'data',
  'Audit Exported': 'data',
  'Hard Reset': 'data'
};

export function auditCategoryOf(action: string): AuditCategory {
  return AUDIT_CATEGORY_BY_ACTION[(action || '').trim()] ?? 'other';
}

export interface AuditEntry {
  id: number;
  at: string;
  user: string;
  role: UserRole;
  category: AuditCategory;
  action: string;
  detail: string;
}

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  Admin: [...ALL_PERMISSIONS],
  Salesman: ['usePos'],
  Accountant: ['viewReports', 'viewAccounts', 'cashClosing']
};

export const USERS_KEY = 'sm_users_v1';
export const SESSION_KEY = 'sm_session_v1';
export const AUDIT_KEY = 'sm_audit_v2';
/** Pre-category trail; dropped on load so it never returns through sync. */
export const LEGACY_AUDIT_KEY = 'sm_audit_v1';
/** Only the last three days are kept, per the shop's audit policy. */
export const AUDIT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const AUDIT_MAX_ENTRIES = 2000;
/** Local integrity check only: a hostile client can read this key and forge tokens. */
const DEVICE_KEY = 'sm_device_key_v1';

export const MAIN_ADMIN = {
  name: 'SM Enterprise Admin',
  username: 'smenterprise.saju@gmail.com'
};

/**
 * Gmail ignores dots in the local part, so both spellings of the owner address
 * must reach the same account. Other domains stay case-insensitive only.
 */
export function canonicalUsername(value: string): string {
  const name = (value || '').trim().toLowerCase();
  const at = name.indexOf('@');
  if (at < 0) return name;
  const local = name.slice(0, at);
  const domain = name.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return name;
  return `${local.replace(/\./g, '')}@gmail.com`;
}

interface StoredSession {
  username: string;
  token: string;
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private storage = inject(StorageService);
  private destroyRef = inject(DestroyRef);
  // Optional so the local-only unit tests can run without a cloud.
  private cloud = inject(CloudService, { optional: true });
  private readonly authorizationRevision = signal(0);
  /** Local supervisor overrides must not outlive login or authorization changes. */
  readonly authorizationVersion = this.authorizationRevision.asReadonly();

  readonly users = signal<UserAccount[]>([]);
  readonly currentUser = signal<UserAccount | null>(null);
  readonly auditLogs = signal<AuditEntry[]>([]);

  /** Runs once the database is hydrated; replaces the old constructor loads. */
  load(): void {
    this.dropLegacyAudit();
    this.readFromStorage();
    this.restoreCloudKey();
    this.persistUsers();
    this.watchStorage();
  }

  /** Admin seeded on a fresh device has no password until it is set here. */
  needsSetup(): boolean {
    const main = this.users().find(user => this.isMain(user));
    return !!main && !main.secret;
  }

  /**
   * First-run setup: claims the shop with the password the owner chooses.
   * The same password later rebuilds the cloud key on every device.
   */
  async setupMainAdmin(pin: string): Promise<{ ok: boolean; error?: string }> {
    const main = this.users().find(user => this.isMain(user));
    if (!main) return { ok: false, error: 'missing' };
    if (main.secret) return { ok: false, error: 'exists' };
    const secret = (pin || '').trim();
    if (secret.length < 6) return { ok: false, error: 'short' };
    const key = deriveCloudKey(secret);
    const cloudHash = cloudKeyHash(key);

    if (this.cloud?.isEnabled()) {
      const rows = await this.cloud.pullUsers(key);
      if (rows === null) return { ok: false, error: 'cloud' };
      // Another device already claimed the shop with a different password.
      // A seeded row without a password does not count as claimed.
      if (this.upgradeSecrets(rows as unknown as UserAccount[]).some(user => isStoredSecret(user.secret))) {
        return { ok: false, error: 'exists' };
      }
      if (await this.cloud.isClaimed() === true) return { ok: false, error: 'exists' };
    }

    const next: UserAccount = { ...main, secret: hashSecret(secret), cloudHash };
    this.users.update(list => list.map(user => (user.id === main.id ? next : user)));
    this.persistUsers();
    this.cloud?.setUserKey(key);
    if (this.cloud?.isEnabled()) {
      const claimed = await this.cloud.claimAccount(next as unknown as Record<string, unknown>);
      if (!claimed) {
        // Distinguish "another device already set a password" from a network failure.
        const taken = await this.cloud.isClaimed() === true;
        this.cloud.clearUserKey();
        this.users.update(list => list.map(user => (user.id === main.id ? main : user)));
        this.persistUsers();
        return { ok: false, error: taken ? 'exists' : 'cloud' };
      }
    }
    this.startSession(next);
    this.cloud?.startSync();
    this.log('Admin Setup', 'প্রথমবারের অ্যাডমিন পাসওয়ার্ড সেট হয়েছে');
    return { ok: true };
  }

  async login(username: string, pin: string): Promise<{ ok: boolean; error?: string }> {
    const value = (pin || '').trim();
    const wanted = canonicalUsername(username);
    let user = this.users().find(u => canonicalUsername(u.username) === wanted);

    if (user && verifySecret(user.secret, value)) {
      if (!user.active) return { ok: false, error: 'inactive' };
      let changed = false;
      if (needsStretch(user.secret)) {
        // A correct legacy PIN is the only chance to re-hash it: the clear value
        // exists right here and nowhere else.
        user = { ...user, secret: hashSecret(value) };
        changed = true;
      }
      if (!user.cloudHash) {
        // Accounts created before the login-based cloud key get claimed now.
        user = { ...user, cloudHash: cloudKeyHash(deriveCloudKey(value)) };
        changed = true;
      }
      if (changed) {
        const next = user;
        this.users.update(list => list.map(u => (u.id === next.id ? next : u)));
        this.persistUsers();
      }
      this.startSession(user);
      const key = deriveCloudKey(value);
      this.cloud?.setUserKey(key);
      if (this.cloud?.isEnabled()) {
        // The shop is either already claimed (probe) or brand new (claim now).
        // Sync stays off when the server cannot confirm the key.
        if (await this.cloud.isClaimed() === false) {
          await this.cloud.claimAccount(user as unknown as Record<string, unknown>);
        } else {
          await this.cloud.probeKey();
        }
      }
      this.cloud?.startSync();
      this.log('Login', `${user.name} লগইন করেছেন`);
      return { ok: true };
    }

    // A new device has no accounts yet: the typed password rebuilds the cloud
    // key and pulls the shop's account list before verifying it locally.
    const remote = await this.pullCloudUsers(value);
    if (remote) {
      const match = remote.users.find(u => canonicalUsername(u.username) === wanted);
      if (match && match.active && verifySecret(match.secret, value)) {
        this.users.set(remote.users);
        this.persistUsers();
        this.startSession(match);
        this.cloud?.setUserKey(remote.key);
        // The account list was read with this exact key, so the gate already passed.
        this.cloud?.markKeyVerified();
        this.cloud?.startSync();
        this.log('Login', `${match.name} ক্লাউড অ্যাকাউন্ট থেকে লগইন করেছেন`);
        return { ok: true };
      }
    }

    // A brand-new shop has no password yet: the first sign-in on the owner
    // account is what establishes it, so no separate setup screen is needed.
    const main = this.users().find(u => this.isMain(u));
    if (main && !main.secret && canonicalUsername(main.username) === wanted) {
      // Another device may already have claimed the shop with its own password.
      if (this.cloud?.isEnabled() && await this.cloud.isClaimed() === true) {
        return { ok: false, error: 'exists' };
      }
      return this.setupMainAdmin(value);
    }
    return { ok: false, error: 'invalid' };
  }

  logout() {
    const user = this.currentUser();
    if (user) this.log('Logout', `${user.name} লগআউট করেছেন`);
    this.revokeSession();
  }

  /**
   * Factory reset: erases the cloud shop (account rows stay, so the owner can
   * still sign in) and this device's cached business data. The caller reloads,
   * which lands on the login page with a completely empty shop.
   */
  async hardReset(): Promise<{ ok: boolean; deleted?: number; error?: string }> {
    this.revalidateSession();
    const user = this.currentUser();
    if (!user || !this.isMain(user) || !this.has('manageSettings')) return { ok: false, error: 'forbidden' };
    if (!this.cloud) return { ok: false, error: 'cloud' };
    const result = await this.cloud.hardReset();
    if (!result.ok) return result;
    this.clearAudit();
    this.log('Hard Reset', `${user.name} পুরো ডাটাবেস মুছে নতুন করে শুরু করেছেন`);
    this.authorizationRevision.update(value => value + 1);
    this.currentUser.set(null);
    this.storage.write(SESSION_KEY, null);
    return result;
  }

  has(permission: Permission): boolean {
    this.revalidateSession();
    const user = this.currentUser();
    return !!user && this.permissionsOf(user).includes(permission);
  }

  /** The owner always keeps full control; everyone else uses their explicit grants. */
  permissionsOf(user: UserAccount): Permission[] {
    if (this.isMain(user)) return [...ALL_PERMISSIONS];
    if (Array.isArray(user.permissions)) return this.sanitizePermissions(user.permissions);
    return this.rolePermissions(user.role);
  }

  canSee(area: 'reports' | 'accounts' | 'settings' | 'users' | 'pos' | 'hrm'): boolean {
    this.revalidateSession();
    const user = this.currentUser();
    if (!user) return false;
    if (this.isMain(user)) return true;
    if (area === 'settings') return this.has('manageSettings') || this.has('manageUsers');
    if (area === 'users') return this.has('manageUsers');
    if (area === 'reports') return this.has('viewReports');
    if (area === 'accounts') return this.has('viewAccounts');
    if (area === 'pos') return this.has('usePos');
    return this.has('viewHrm');
  }

  log(action: string, detail: string) {
    const user = this.currentUser();
    const entry: AuditEntry = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      at: new Date().toISOString(),
      user: user ? user.name : 'System',
      role: user ? user.role : 'Admin',
      category: auditCategoryOf(action),
      action,
      detail
    };
    this.auditLogs.set(this.pruneAudit([entry, ...this.auditLogs()]));
    this.storage.write(AUDIT_KEY, this.auditLogs());
  }

  /** Wipes this device's trail; callers log their own reason afterwards. */
  clearAudit(): void {
    this.auditLogs.set([]);
    this.storage.write(AUDIT_KEY, []);
  }

  /** Drops entries older than the retention window and caps runaway growth. */
  private pruneAudit(list: AuditEntry[]): AuditEntry[] {
    if (!Array.isArray(list)) return [];
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    return list
      .filter(entry => entry && typeof entry.at === 'string' && Date.parse(entry.at) >= cutoff)
      .map(entry => ({ ...entry, category: entry.category ?? auditCategoryOf(entry.action) }))
      .slice(0, AUDIT_MAX_ENTRIES);
  }

  addUser(input: Omit<UserAccount, 'id' | 'secret' | 'pin' | 'cloudHash'> & { pin: string }): { ok: boolean; error?: string } {
    if (!this.has('manageUsers')) return { ok: false, error: 'forbidden' };
    if (!this.isRole(input.role)) return { ok: false, error: 'role' };
    if (typeof input.active !== 'boolean') return { ok: false, error: 'active' };
    const secret = (input.pin || '').trim();
    if (!input.name.trim() || !input.username.trim() || !secret) {
      return { ok: false, error: 'required' };
    }
    if (secret.length < 6) return { ok: false, error: 'short' };
    if (this.users().some(u => u.username.toLowerCase() === input.username.trim().toLowerCase())) {
      return { ok: false, error: 'duplicate' };
    }
    const user: UserAccount = {
      id: this.nextUserId(),
      name: input.name.trim(),
      username: input.username.trim(),
      role: input.role,
      active: input.active,
      photo: this.sanitizePhoto(input.photo),
      secret: hashSecret(secret),
      cloudHash: cloudKeyHash(deriveCloudKey(secret))
    };
    if (Array.isArray(input.permissions)) user.permissions = this.sanitizePermissions(input.permissions);
    if (!user.photo) delete user.photo;
    this.users.update(list => [...list, user]);
    this.persistUsers();
    void this.cloud?.pushUsersNow();
    this.log('User Created', `${user.name} (${user.role}) ইউজার তৈরি হয়েছে`);
    return { ok: true };
  }

  async updateUser(updated: Omit<UserAccount, 'secret' | 'pin' | 'cloudHash'> & { id: number; pin?: string; currentPin?: string }): Promise<{ ok: boolean; error?: string }> {
    if (!this.has('manageUsers')) return { ok: false, error: 'forbidden' };
    if (!this.isRole(updated.role)) return { ok: false, error: 'role' };
    if (typeof updated.active !== 'boolean') return { ok: false, error: 'active' };
    if (!updated.name.trim() || !updated.username.trim()) {
      return { ok: false, error: 'required' };
    }
    if (this.users().some(u => u.id !== updated.id && u.username.toLowerCase() === updated.username.trim().toLowerCase())) {
      return { ok: false, error: 'duplicate' };
    }
    const existing = this.users().find(u => u.id === updated.id);
    if (!existing) return { ok: false, error: 'missing' };
    if (this.isMain(existing) && (updated.role !== 'Admin' || !updated.active)) {
      return { ok: false, error: 'main' };
    }
    if (existing.role === 'Admin' && existing.active && (updated.role !== 'Admin' || !updated.active)
      && !this.hasOtherAdmin(existing.id)) return { ok: false, error: 'last-admin' };
    const secret = (updated.pin || '').trim();
    if (secret && this.currentUser()?.id === existing.id
      && !verifySecret(existing.secret, (updated.currentPin || '').trim())) {
      return { ok: false, error: 'invalid' };
    }
    if (secret && secret.length < 6) return { ok: false, error: 'short' };
    const next: UserAccount = {
      id: updated.id,
      name: updated.name.trim(),
      username: updated.username.trim(),
      role: updated.role,
      active: updated.active,
      main: this.isMain(existing),
      // The owner is never lockable: keep the stored grants out of the way.
      photo: this.sanitizePhoto(updated.photo),
      secret: secret ? hashSecret(secret) : existing.secret,
      cloudHash: secret ? cloudKeyHash(deriveCloudKey(secret)) : existing.cloudHash
    };
    if (!next.main && Array.isArray(updated.permissions)) {
      next.permissions = this.sanitizePermissions(updated.permissions);
    }
    if (!next.photo) delete next.photo;
    if (secret && this.currentUser()?.id === existing.id) {
      return this.rotatePassword(next, secret);
    }
    this.saveUser(next);
    this.afterUsersChanged(secret);
    this.log('User Updated', `${next.name} (${next.role}) ইউজার আপডেট হয়েছে`);
    return { ok: true };
  }

  /** Verifies the current password before accepting a new one. */
  async changePassword(id: number, current: string, next: string): Promise<{ ok: boolean; error?: string }> {
    this.revalidateSession();
    const user = this.currentUser();
    if (!user || user.id !== id) return { ok: false, error: 'forbidden' };
    if (!verifySecret(user.secret, (current || '').trim())) return { ok: false, error: 'invalid' };
    const secret = (next || '').trim();
    if (secret.length < 6) return { ok: false, error: 'short' };
    // Deliberately bypass only the management gate, not password verification.
    const updated: UserAccount = {
      ...user,
      secret: hashSecret(secret),
      cloudHash: cloudKeyHash(deriveCloudKey(secret))
    };
    return this.rotatePassword(updated, secret);
  }

  deleteUser(id: number): { ok: boolean; error?: string } {
    if (!this.has('manageUsers')) return { ok: false, error: 'forbidden' };
    const target = this.users().find(u => u.id === id);
    if (!target) return { ok: false, error: 'missing' };
    if (this.isMain(target)) return { ok: false, error: 'main' };
    if (target.role === 'Admin' && target.active && !this.hasOtherAdmin(id)) {
      return { ok: false, error: 'last-admin' };
    }
    if (this.currentUser()?.id === id) return { ok: false, error: 'self' };
    this.users.update(list => list.filter(u => u.id !== id));
    this.persistUsers();
    void this.cloud?.pushUsersNow();
    this.log('User Deleted', `${target.name} ইউজার মুছে ফেলা হয়েছে`);
    return { ok: true };
  }

  rolePermissions(role: UserRole): Permission[] {
    return this.isRole(role) ? [...ROLE_PERMISSIONS[role]] : [];
  }

  sanitizePermissions(value: unknown): Permission[] {
    if (!Array.isArray(value)) return [];
    return ALL_PERMISSIONS.filter(permission => value.includes(permission));
  }

  private sanitizePhoto(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const photo = value.trim();
    if (!/^(data:image\/|https:\/\/)/i.test(photo) || photo.length > 400_000) return undefined;
    return photo;
  }

  private isRole(role: unknown): role is UserRole {
    return role === 'Admin' || role === 'Salesman' || role === 'Accountant';
  }

  private hasOtherAdmin(id: number): boolean {
    return this.users().some(user => user.id !== id && user.role === 'Admin'
      && user.active && isStoredSecret(user.secret));
  }

  /**
   * The database accepts the new account row only from the old key, so the
   * upload happens before this device switches to the new key.
   */
  private async rotatePassword(next: UserAccount, secret: string): Promise<{ ok: boolean; error?: string }> {
    const before = this.users().find(user => user.id === next.id);
    this.saveUser(next);
    const key = deriveCloudKey(secret);
    if (!this.cloud?.isEnabled() || !this.cloud.hasUserKey()) {
      this.cloud?.setUserKey(key);
      this.log('Password Changed', `${next.name} পাসওয়ার্ড পরিবর্তন করেছেন`);
      return { ok: true };
    }
    const pushed = await this.cloud.pushUsersNow();
    if (!pushed) {
      if (before) this.saveUser(before);
      return { ok: false, error: 'sync' };
    }
    this.cloud.setUserKey(key);
    this.cloud.startSync();
    this.log('Password Changed', `${next.name} পাসওয়ার্ড পরিবর্তন করেছেন`);
    return { ok: true };
  }

  private afterUsersChanged(secretChanged: string): void {
    if (secretChanged && this.cloud?.isEnabled()) void this.cloud.pushUsersNow();
  }

  private saveUser(next: UserAccount): void {
    this.users.update(list => list.map(user => user.id === next.id ? next : user));
    if (this.currentUser()?.id === next.id) {
      if (next.active) this.startSession(next);
      else this.revokeSession();
    }
    this.persistUsers();
  }

  isMain(user: UserAccount): boolean {
    return user.main === true
      || canonicalUsername(user.username) === canonicalUsername(MAIN_ADMIN.username);
  }

  /** Supervisor override: an enabled Admin's PIN unlocks a locked voucher. */
  verifyAdminPin(pin: string): boolean {
    this.revalidateSession();
    if (!this.currentUser()) return false;
    const value = (pin || '').trim();
    if (!value) return false;
    return this.users().some(u => u.role === 'Admin' && u.active && verifySecret(u.secret, value));
  }

  private async pullCloudUsers(secret: string): Promise<{ users: UserAccount[]; key: string } | null> {
    if (!this.cloud?.isEnabled()) return null;
    const key = deriveCloudKey(secret);
    const rows = await this.cloud.pullUsers(key);
    if (!rows) return null;
    return { users: this.upgradeSecrets(rows as unknown as UserAccount[]), key };
  }

  private findActive(stored: unknown): UserAccount | null {
    // Legacy usernames are not proof of login. Require reauthentication.
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
    const session = stored as Partial<StoredSession>;
    if (typeof session.username !== 'string' || typeof session.token !== 'string'
      || !/^[a-f0-9]{64}$/.test(session.token)) return null;
    const user = this.users().find(u => u.username === session.username && u.active
      && this.isRole(u.role) && isStoredSecret(u.secret));
    return user && session.token === this.sessionToken(user) ? user : null;
  }

  private startSession(user: UserAccount): void {
    // Creating the device key emits onWrite; do it before publishing a new
    // currentUser so that refresh cannot revoke a half-written login.
    const session: StoredSession = { username: user.username, token: this.sessionToken(user) };
    this.authorizationRevision.update(value => value + 1);
    this.currentUser.set(user);
    this.storage.write(SESSION_KEY, session);
  }

  private revokeSession(): void {
    const stored = this.storage.read<unknown>(SESSION_KEY);
    if (this.currentUser() || stored !== null) this.authorizationRevision.update(value => value + 1);
    this.currentUser.set(null);
    this.cloud?.clearUserKey();
    // A null write (unlike remove) notifies StorageService's subscribers and
    // other tabs. Clear state first; the nested onWrite then does nothing.
    if (stored !== null) this.storage.write(SESSION_KEY, null);
  }

  private revalidateSession(): void {
    const stored = this.storage.read<unknown>(SESSION_KEY);
    const fresh = this.findActive(stored);
    const current = this.currentUser();
    if (!current) {
      if (stored !== null && !fresh) this.revokeSession();
      return; // Remote writes never sign a logged-out tab in.
    }
    if (!fresh || current.id !== fresh.id || this.sessionToken(current) !== this.sessionToken(fresh)) {
      this.revokeSession();
    } else if (current !== fresh) {
      this.currentUser.set(fresh);
    }
  }

  private sessionToken(user: UserAccount): string {
    // Bind every credential field, not just the hash: metadata changes revoke
    // existing local sessions too. This is not a server-authenticated identity.
    return sha256Hex(JSON.stringify([this.deviceKey(), user.id, user.username, user.role,
      user.active, user.secret?.alg, user.secret?.salt, user.secret?.hash, user.secret?.iterations]));
  }

  private deviceKey(): string {
    const saved = this.storage.read<string>(DEVICE_KEY);
    if (typeof saved === 'string' && /^[a-f0-9]{32}$/.test(saved)) return saved;
    const bytes = new Uint8Array(16);
    const crypto$ = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
    if (crypto$?.getRandomValues) crypto$.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    const key = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    this.storage.write(DEVICE_KEY, key);
    return key;
  }

  /** A restored session without a cloud key must log in once more. */
  private restoreCloudKey(): void {
    const stored = this.storage.read<string>(CLOUD_KEY_STORAGE);
    const key = typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored) ? stored : '';
    if (!this.currentUser()) {
      if (key) this.cloud?.clearUserKey();
      return;
    }
    if (!key) {
      this.revokeSession();
      return;
    }
    this.cloud?.setUserKey(key);
    // A reload keeps the login, so the shop must resume syncing on its own.
    this.cloud?.startSync();
  }

  private dropLegacyAudit(): void {
    if (this.storage.read<unknown>(LEGACY_AUDIT_KEY) !== null) this.storage.remove(LEGACY_AUDIT_KEY);
  }

  private readFromStorage(): void {
    const stored = this.storage.read<UserAccount[]>(USERS_KEY);
    // Only an absent collection is a fresh install; [] must not reseed an owner.
    this.users.set(this.upgradeSecrets(stored === null ? [this.mainAdmin()] : stored));
    this.auditLogs.set(this.pruneAudit(this.storage.read<AuditEntry[]>(AUDIT_KEY) ?? []));
    const session = this.storage.read<unknown>(SESSION_KEY);
    this.currentUser.set(this.findActive(session));
    if (session !== null && !this.currentUser()) this.revokeSession();
  }

  private refreshUsers(): void {
    const users = this.upgradeSecrets(this.storage.read<UserAccount[]>(USERS_KEY) ?? []);
    if (JSON.stringify(users) !== JSON.stringify(this.users())) {
      this.authorizationRevision.update(value => value + 1);
      this.users.set(users);
    }
    this.revalidateSession();
  }

  /** Cloud writes and cross-tab refreshes both invalidate stale credentials. */
  private watchStorage(): void {
    if (this.watching) return;
    this.watching = true;
    const stopWrite = this.storage.onWrite(key => {
      if (key === USERS_KEY) {
        this.refreshUsers();
      } else if (key === SESSION_KEY || key === DEVICE_KEY) {
        this.revalidateSession();
      } else if (key === AUDIT_KEY) {
        this.auditLogs.set(this.pruneAudit(this.storage.read<AuditEntry[]>(AUDIT_KEY) ?? []));
      }
    });
    const stopRemote = this.storage.onRemoteChange(() => {
      this.refreshUsers();
      this.auditLogs.set(this.pruneAudit(this.storage.read<AuditEntry[]>(AUDIT_KEY) ?? []));
    });
    this.destroyRef.onDestroy(() => {
      stopWrite();
      stopRemote();
    });
  }

  private watching = false;

  private nextUserId(): number {
    return this.users().reduce((max, u) => Math.max(max, u.id + 1), Date.now());
  }

  private mainAdmin(): UserAccount {
    return {
      id: 1,
      name: MAIN_ADMIN.name,
      username: MAIN_ADMIN.username,
      role: 'Admin',
      active: true,
      main: true
      // No secret: the shop password is chosen on first login, never shipped in the bundle.
    };
  }

  private persistUsers() {
    this.authorizationRevision.update(value => value + 1);
    const clean = this.users().map(u => {
      const next: UserAccount = { ...u };
      delete next.pin;
      return next;
    });
    // A launch rewrites the same accounts; skipping the identical write keeps
    // them from looking like fresh local edits in last-write-wins.
    const stored = this.storage.read<UserAccount[]>(USERS_KEY);
    if (stored !== null && JSON.stringify(stored) === JSON.stringify(clean)) return;
    this.storage.write(USERS_KEY, clean);
  }

  /** Older builds kept the PIN in clear text; replace it with a salted hash. */
  private upgradeSecrets(list: UserAccount[]): UserAccount[] {
    if (!Array.isArray(list)) return [];
    return list.filter(user => user && typeof user === 'object' && Number.isSafeInteger(user.id)
      && typeof user.name === 'string' && typeof user.username === 'string' && !!user.username.trim()
      && this.isRole(user.role) && typeof user.active === 'boolean').map(user => {
      const clean: UserAccount = { ...user };
      delete clean.pin;
      if (Array.isArray(clean.permissions)) clean.permissions = this.sanitizePermissions(clean.permissions);
      else delete clean.permissions;
      const photo = this.sanitizePhoto(clean.photo);
      if (photo) clean.photo = photo;
      else delete clean.photo;
      // One owner identity on every device. Gmail treats dotted spellings as
      // the same address, so an older "smenterprisesaju@..." is renamed here.
      if (clean.main === true || canonicalUsername(clean.username) === canonicalUsername(MAIN_ADMIN.username)) {
        clean.main = true;
        clean.username = MAIN_ADMIN.username;
      }
      if (clean.secret) return clean;
      const legacy = typeof user.pin === 'string' ? user.pin.trim() : '';
      // No secret and no legacy PIN means "not set yet" — the first sign-in on
      // the owner account sets it, never a known default password.
      return legacy ? { ...clean, secret: hashSecret(legacy) } : clean;
    });
  }
}
