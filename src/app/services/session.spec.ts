import '@angular/compiler';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { hashSecret, sha256Hex, verifySecret } from '../utils/secret';
import { OrderLockService } from './order-lock';
import { AUDIT_KEY, MAIN_ADMIN, SESSION_KEY, SessionService, USERS_KEY, type UserAccount, type UserRole } from './session';
import { StorageService } from './storage';

/** Isolated synchronous mirror; no IndexedDB, browser credentials or cloud. */
class MemoryStorage {
  readonly values = new Map<string, unknown>();
  readonly writes: string[] = [];
  readonly writeListeners = new Set<(key: string) => void>();
  readonly remoteListeners = new Set<() => void>();

  read<T>(key: string): T | null { return (this.values.get(key) ?? null) as T | null; }
  isWriter(): boolean { return true; }
  write(key: string, value: unknown): void {
    this.values.set(key, value);
    this.writes.push(key);
    if (this.writes.length > 100) throw new Error('storage notification loop');
    for (const listener of this.writeListeners) listener(key);
  }
  onWrite(listener: (key: string) => void): () => void {
    this.writeListeners.add(listener);
    return () => this.writeListeners.delete(listener);
  }
  onRemoteChange(listener: () => void): () => void {
    this.remoteListeners.add(listener);
    return () => this.remoteListeners.delete(listener);
  }
  remote(key: string, value: unknown): void {
    this.values.set(key, value);
    for (const listener of this.remoteListeners) listener();
  }
}

const password = 'test-password';
const secret = hashSecret(password);
const changedSecret = hashSecret('changed-password');
const owner: UserAccount = { id: 1, name: 'Owner', username: MAIN_ADMIN.username, role: 'Admin', active: true, main: true, secret };
const salesman: UserAccount = { id: 2, name: 'Sales', username: 'sales', role: 'Salesman', active: true, secret };
const accountant: UserAccount = { id: 3, name: 'Accounts', username: 'accounts', role: 'Accountant', active: true, secret };
const otherAdmin: UserAccount = { id: 4, name: 'Manager', username: 'manager', role: 'Admin', active: true, secret };
const newUser = { name: 'New', username: 'new', role: 'Salesman' as const, active: true, pin: password };

let storage: MemoryStorage;
let session: SessionService;

function load(users: UserAccount[] = [owner, salesman, accountant, otherAdmin]): void {
  storage.values.set(USERS_KEY, structuredClone(users));
  session.load();
}
async function login(user = owner): Promise<void> {
  expect(await session.login(user.username, password)).toEqual({ ok: true });
}

// Also runnable directly with Vitest while unrelated Angular bundles are in flux.
if (!getTestBed().platform) {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
}
afterEach(() => TestBed.resetTestingModule());

beforeEach(() => {
  storage = new MemoryStorage();
  TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: storage }] });
  session = TestBed.inject(SessionService);
});

describe('local session restoration', () => {
  it('rejects a legacy username and requires password login', async () => {
    storage.values.set(SESSION_KEY, owner.username);
    load();
    expect(session.currentUser()).toBeNull();
    expect(storage.read(SESSION_KEY)).toBeNull();
    expect(session.has('manageUsers')).toBe(false);
    expect((await session.login(owner.username, 'incorrect')).ok).toBe(false);await login();
    expect(session.currentUser()?.id).toBe(owner.id);
  });

  it('restores a valid structured session but rejects tampered tokens', async () => {
    load();await login();
    session.load();
    expect(session.currentUser()?.id).toBe(owner.id);
    storage.values.set(SESSION_KEY, { username: owner.username, token: 'a'.repeat(64) });
    session.load();
    expect(session.currentUser()).toBeNull();
    expect(storage.read(SESSION_KEY)).toBeNull();
  });

  it('seeds only a missing users collection, not an explicitly empty one', async () => {
    load([]);
    expect(session.users()).toEqual([]);
    expect(session.needsSetup()).toBe(false);
    expect((await session.setupMainAdmin(password)).ok).toBe(false);
  });

  it('allows first-run setup without shipping a default password', async () => {
    session.load();
    expect(session.needsSetup()).toBe(true);
    expect((await session.setupMainAdmin('short')).ok).toBe(false);
    expect((await session.setupMainAdmin(password)).ok).toBe(true);
    expect(session.has('manageUsers')).toBe(true);
    expect((await session.setupMainAdmin(password)).ok).toBe(false);
  });

  it('establishes the first password through the normal login form', async () => {
    session.load();
    expect(await session.login('nobody@example.com', password)).toEqual({ ok: false, error: 'invalid' });
    expect(session.needsSetup()).toBe(true);
    expect((await session.login(MAIN_ADMIN.username, 'short')).ok).toBe(false);
    expect(await session.login(MAIN_ADMIN.username, password)).toEqual({ ok: true });
    expect(session.currentUser()?.id).toBe(1);
    expect(session.needsSetup()).toBe(false);
  });

  it('upgrades known legacy passwords only after successful login', async () => {
    const salt = '0123456789abcdef';
    load([{ ...owner, secret: { alg: 'sha256+salt', salt, hash: sha256Hex(`${salt}:${password}`) } }]);
    expect((await session.login(owner.username, 'incorrect')).ok).toBe(false);
    expect(session.users()[0].secret?.alg).toBe('sha256+salt');await login();
    expect(session.users()[0].secret?.alg).toBe('sha256+salt+iter');
  });

  it('does not install duplicate watchers, and unsubscribes on destruction', async () => {
    load();
    session.load();
    expect(storage.writeListeners.size).toBe(1);
    expect(storage.remoteListeners.size).toBe(1);
    TestBed.resetTestingModule();
    expect(storage.writeListeners.size).toBe(0);
    expect(storage.remoteListeners.size).toBe(0);
  });
});

function reloadSession(): SessionService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: storage }] });
  const next = TestBed.inject(SessionService);
  next.load();
  return next;
}

describe('device-wide session', () => {
  it('keeps the login on a reload and in another tab', async () => {
    load();
    await login();
    expect(session.currentUser()?.id).toBe(owner.id);

    // A second tab (and every later reload) reads the same stored session.
    const secondTab = reloadSession();
    expect(secondTab.currentUser()?.id).toBe(owner.id);
    expect(storage.read(SESSION_KEY)).not.toBeNull();

    const thirdTab = reloadSession();
    expect(thirdTab.currentUser()?.id).toBe(owner.id);
  });

  it('stays signed out after logout in every tab', async () => {
    load();
    await login();
    session.logout();

    const reloaded = reloadSession();
    expect(reloaded.currentUser()).toBeNull();
    expect(storage.read(SESSION_KEY)).toBeNull();
  });

  it('signs out every tab when one of them logs out', async () => {
    load();
    await login();
    const otherTab = reloadSession();
    expect(otherTab.currentUser()?.id).toBe(owner.id);

    session.logout();
    // The write reaches the other tab through the shared storage.
    storage.remote(SESSION_KEY, null);
    expect(otherTab.currentUser()).toBeNull();
  });
});

describe('user management service permissions', () => {
  for (const actor of [null, salesman, accountant]) {
    it(`rejects management calls from ${actor?.role ?? 'a logged-out caller'}`, async () => {
      load();
      if (actor) await login(actor);
      const before = structuredClone(session.users());
      const writes = storage.writes.length;
      expect(session.addUser(newUser)).toEqual({ ok: false, error: 'forbidden' });
      expect(await session.updateUser({ ...salesman, role: 'Admin', pin: 'replacement' })).toEqual({ ok: false, error: 'forbidden' });
      expect(session.deleteUser(otherAdmin.id)).toEqual({ ok: false, error: 'forbidden' });
      expect(session.users()).toEqual(before);
      expect(storage.writes.length).toBe(writes);
    });
  }

  it('allows an authenticated admin to create, update/reset and delete another user', async () => {
    load();await login();
    expect(session.addUser(newUser).ok).toBe(true);
    expect((await session.updateUser({ ...salesman, role: 'Accountant', pin: 'replacement' })).ok).toBe(true);
    expect(verifySecret(session.users().find(user => user.id === salesman.id)?.secret, 'replacement')).toBe(true);
    expect(session.deleteUser(salesman.id).ok).toBe(true);
  });

  for (const role of ['SuperAdmin', '__proto__', 'toString', '', null]) {
    it(`rejects unsupported runtime roles (${String(role)})`, async () => {
      load();await login();
      const badRole = role as UserRole;
      expect(session.addUser({ ...newUser, role: badRole })).toEqual({ ok: false, error: 'role' });
      expect(await session.updateUser({ ...salesman, role: badRole })).toEqual({ ok: false, error: 'role' });
      expect(session.rolePermissions(badRole)).toEqual([]);
    });
  }

  it('does not expose mutable role permission arrays', async () => {
    load();
    session.rolePermissions('Salesman').push('manageUsers');await login(salesman);
    expect(session.has('manageUsers')).toBe(false);
  });

  it('rejects non-boolean active flags', async () => {
    load();await login();
    const active = 'false' as unknown as boolean;
    expect(session.addUser({ ...newUser, active }).ok).toBe(false);
    expect((await session.updateUser({ ...salesman, active })).ok).toBe(false);
  });

  it('prevents owner demotion, disabling and deletion, including after renaming', async () => {
    load();await login(otherAdmin);
    expect(await session.updateUser({ ...owner, role: 'Salesman' })).toEqual({ ok: false, error: 'main' });
    expect(await session.updateUser({ ...owner, active: false })).toEqual({ ok: false, error: 'main' });
    expect(session.deleteUser(owner.id)).toEqual({ ok: false, error: 'main' });
    expect((await session.updateUser({ ...owner, username: 'renamed-owner', main: false })).ok).toBe(true);
    expect(session.deleteUser(owner.id)).toEqual({ ok: false, error: 'main' });
  });

  for (const unusableAdmin of [{ ...owner, active: false }, { ...owner, secret: undefined }]) {
    it('does not count an inactive or passwordless admin as a last-admin replacement', async () => {
      load([otherAdmin, unusableAdmin, salesman]);await login(otherAdmin);
      expect(await session.updateUser({ ...otherAdmin, role: 'Salesman' })).toEqual({ ok: false, error: 'last-admin' });
      expect(await session.updateUser({ ...otherAdmin, active: false })).toEqual({ ok: false, error: 'last-admin' });
      expect(session.deleteUser(otherAdmin.id)).toEqual({ ok: false, error: 'last-admin' });
    });
  }

  it('allows self-demotion when another usable admin remains and removes management access', async () => {
    load();await login(otherAdmin);
    expect((await session.updateUser({ ...otherAdmin, role: 'Salesman' })).ok).toBe(true);
    expect(session.has('manageUsers')).toBe(false);
  });

  it('revokes a self-disabled session when another admin remains', async () => {
    load();await login(otherAdmin);
    expect((await session.updateUser({ ...otherAdmin, active: false })).ok).toBe(true);
    expect(session.currentUser()).toBeNull();
    expect(storage.read(SESSION_KEY)).toBeNull();
  });
});

describe('self-service password changes', () => {
  for (const actor of [owner, salesman, accountant]) {
    it(`requires the current password for the current ${actor.role}`, async () => {
      load();await login(actor);
      expect(await session.changePassword(actor.id, 'incorrect', 'replacement')).toEqual({ ok: false, error: 'invalid' });
      expect(await session.changePassword(actor.id, password, 'short')).toEqual({ ok: false, error: 'short' });
      expect(await session.changePassword(actor.id, password, 'replacement')).toEqual({ ok: true });
      expect(session.currentUser()?.id).toBe(actor.id);
      session.logout();
      expect((await session.login(actor.username, password)).ok).toBe(false);
      expect((await session.login(actor.username, 'replacement')).ok).toBe(true);
    });
  }

  it('does not permit password changes for another user or while logged out', async () => {
    load();
    expect((await session.changePassword(salesman.id, password, 'replacement')).error).toBe('forbidden');await login();
    expect((await session.changePassword(salesman.id, password, 'replacement')).error).toBe('forbidden');
  });

  it('does not let an admin bypass current-password verification through updateUser', async () => {
    load();await login();
    expect((await session.updateUser({ ...owner, pin: 'replacement' })).error).toBe('invalid');
    expect((await session.updateUser({ ...owner, pin: 'replacement', currentPin: 'incorrect' })).error).toBe('invalid');
    expect((await session.updateUser({ ...owner, pin: 'replacement', currentPin: password })).ok).toBe(true);
    expect(session.currentUser()?.id).toBe(owner.id);
  });
});

const revocations: [string, (users: UserAccount[]) => unknown][] = [
  ['empty collection', () => []],
  ['missing collection', () => null],
  ['removed user', users => users.filter(user => user.id !== owner.id)],
  ['inactive user', users => users.map(user => user.id === owner.id ? { ...user, active: false } : user)],
  ['changed password', users => users.map(user => user.id === owner.id ? { ...user, secret: changedSecret } : user)],
  ['changed salt', users => users.map(user => user.id === owner.id ? { ...user, secret: { ...secret, salt: '0'.repeat(16) } } : user)],
  ['changed rounds', users => users.map(user => user.id === owner.id ? { ...user, secret: { ...secret, iterations: 11999 } } : user)],
  ['changed algorithm', users => users.map(user => user.id === owner.id ? { ...user, secret: { ...secret, alg: 'sha256+salt', iterations: undefined } } : user)],
  ['changed role', users => users.map(user => user.id === owner.id ? { ...user, role: 'Salesman' } : user)],
  ['invalid role', users => users.map(user => user.id === owner.id ? { ...user, role: 'toString' } : user)]
];

for (const channel of ['write', 'remote'] as const) {
  describe(`${channel} authorization refresh`, () => {
    for (const [reason, change] of revocations) {
      it(`revokes session and supervisor overrides on ${reason}, without write loops`, async () => {
        load();await login();
        const locks = TestBed.inject(OrderLockService);
        expect(locks.unlock(10, password)).toBe(true);
        const before = storage.writes.length;
        storage[channel](USERS_KEY, change(session.users()));
        expect(session.currentUser()).toBeNull();
        expect(storage.read(SESSION_KEY)).toBeNull();
        expect(session.addUser(newUser).error).toBe('forbidden');
        expect(session.verifyAdminPin(password)).toBe(false);
        expect(locks.isLocked({ id: 10, status: 'Confirmed' })).toBe(true);
        // The injected users write, the session clear and the cloud key clear.
        expect(storage.writes.length - before).toBeLessThanOrEqual(3);
      });
    }

    it('revokes on session clearing and never revives an override on the next login', async () => {
      load();await login();
      const locks = TestBed.inject(OrderLockService);
      expect(locks.unlock(10, password)).toBe(true);
      storage[channel](SESSION_KEY, null);
      expect(session.currentUser()).toBeNull();await login();
      expect(locks.isUnlocked(10)).toBe(false);
    });

    it('preserves unchanged credentials and refreshes profile/audit data', async () => {
      load();await login();
      storage[channel](USERS_KEY, session.users().map(user => ({ ...user, name: 'Updated' })));
      expect(session.currentUser()?.name).toBe('Updated');
      expect(session.has('manageUsers')).toBe(true);
      storage[channel](AUDIT_KEY, []);
      expect(session.auditLogs()).toEqual([]);
    });
  });
}

describe('local supervisor override lifetime', () => {
  it('cannot unlock while logged out, and clears overrides synchronously on logout', async () => {
    load();
    const locks = TestBed.inject(OrderLockService);
    expect(locks.unlock(10, password)).toBe(false);await login(salesman);
    expect(locks.unlock(10, 'incorrect')).toBe(false);
    expect(locks.unlock(10, password)).toBe(true);
    expect(locks.isUnlocked(10)).toBe(true);
    session.logout();
    expect(locks.isUnlocked(10)).toBe(false);await login(salesman);
    expect(locks.isUnlocked(10)).toBe(false);
    expect(locks.unlock(11, password)).toBe(true);
    expect(locks.isUnlocked(10)).toBe(false);
    locks.lock(11);
    expect(locks.isUnlocked(11)).toBe(false);
  });

  it('revokes a supervisor override when that supervisor is disabled remotely', async () => {
    load([owner, salesman]);await login(salesman);
    const locks = TestBed.inject(OrderLockService);
    expect(locks.unlock(10, password)).toBe(true);
    storage.remote(USERS_KEY, session.users().map(user => user.id === owner.id ? { ...user, active: false } : user));
    expect(session.currentUser()?.id).toBe(salesman.id);
    expect(locks.isUnlocked(10)).toBe(false);
    expect(locks.unlock(10, password)).toBe(false);
  });

  it('does not clear overrides for unrelated cross-tab notifications', async () => {
    load();await login();
    const locks = TestBed.inject(OrderLockService);
    expect(locks.unlock(10, password)).toBe(true);
    const before = storage.writes.length;
    storage.remote('sm_products_v2', []);
    expect(locks.isUnlocked(10)).toBe(true);
    expect(storage.writes.length).toBe(before);
  });
});
