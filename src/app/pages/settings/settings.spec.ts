import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Settings } from './settings';
import { DataService } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { CloudService } from '../../services/cloud';
import type { CloudSyncConflict, RestoreSyncIntent, SyncReport } from '../../services/cloud';
import { StorageService } from '../../services/storage';
import { BackupService } from '../../services/backup';

const report = (patch: Partial<SyncReport> = {}): SyncReport => ({
  pushed: 2, deleted: 0, pulled: 3, collections: 1, ms: 1200, ...patch
});

const conflict: CloudSyncConflict = {
  id: 'products:p1', collection: 'sm_products_v2', rowId: 'p1',
  detectedAt: '2026-11-10T00:00:00.000Z', local: { name: 'Local' }, remote: { name: 'Cloud' }
};

describe('Settings cloud review controls', () => {
  let component: Settings;
  let confirm: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let notifyInfo: ReturnType<typeof vi.fn>;
  let hasPermission: ReturnType<typeof vi.fn>;
  let chooseLocal: ReturnType<typeof vi.fn>;
  let chooseRemote: ReturnType<typeof vi.fn>;
  let reconcile: ReturnType<typeof vi.fn>;
  let conflicts: ReturnType<typeof signal<CloudSyncConflict[]>>;

  beforeEach(() => {
    confirm = vi.fn(async () => true);
    notifySuccess = vi.fn();
    notifyInfo = vi.fn();
    hasPermission = vi.fn(() => true);
    conflicts = signal<CloudSyncConflict[]>([conflict]);
    chooseLocal = vi.fn(async () => {
      conflicts.set([]);
      return { resolved: true };
    });
    chooseRemote = vi.fn(async () => ({ resolved: true }));
    reconcile = vi.fn(async () => report());
    TestBed.configureTestingModule({
      providers: [
        { provide: DataService, useValue: { voucherSettings: signal({}) } },
        { provide: NotificationService, useValue: { confirm, success: notifySuccess, info: notifyInfo, error: vi.fn() } },
        { provide: SessionService, useValue: { has: hasPermission, canSee: () => true, log: vi.fn(), auditLogs: signal([]), rolePermissions: () => [] } },
        { provide: PreferencesService, useValue: { txt: (bn: string) => bn, language: signal('bn'), t: (key: string) => key } },
        {
          provide: CloudService, useValue: {
            config: signal({
              supabase: { url: '', anonKey: '', shopKey: '', enabled: true },
              cloudinary: { cloudName: '', uploadPreset: '', folder: '', enabled: false },
              autoSync: false, lastPushAt: null, lastPullAt: null
            }),
            status: signal('online'), syncConflicts: conflicts,
            restoreIntent: signal<RestoreSyncIntent | null>(null),
            pendingRows: signal(0), isEnabled: () => true,
            pushAll: vi.fn(async () => report()), pullAll: vi.fn(async () => report()),
            reconcileRestoredData: reconcile, chooseLocal, chooseRemote
          }
        },
        { provide: StorageService, useValue: { usage: vi.fn(async () => ({ collections: 0, records: 0, media: 0, mediaBytes: 0 })) } },
        { provide: BackupService, useValue: { clientId: signal('') } }
      ]
    });
    component = TestBed.runInInjectionContext(() => new Settings());
  });

  afterEach(() => TestBed.resetTestingModule());

  it('surfaces conflict counts in ordinary sync results', async () => {
    const cloud = TestBed.inject(CloudService) as unknown as { pushAll: ReturnType<typeof vi.fn> };
    cloud.pushAll.mockResolvedValueOnce(report({ conflicts: 2 }));
    await component.runSync('push');
    expect(component.cloudSync().busy).toBe(false);
    expect(component.cloudSync().message).toContain('2টি সংঘাত');
  });

  it('reports restore-review conflicts without claiming success', async () => {
    reconcile.mockResolvedValueOnce(report({ conflicts: 1 }));
    await component.reviewRestoredData();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(notifyInfo).toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(component.cloudSync().busy).toBe(false);
  });

  it('requires confirmation before replacing either version', async () => {
    confirm.mockResolvedValueOnce(false);
    await component.resolveConflict(conflict, 'local');
    expect(confirm).toHaveBeenCalledOnce();
    expect(chooseLocal).not.toHaveBeenCalled();
    expect(component.conflictBusy()).toBe('');
  });

  it('applies the local choice and reports when no conflicts remain', async () => {
    await component.resolveConflict(conflict, 'local');
    expect(chooseLocal).toHaveBeenCalledWith(conflict.collection, conflict.rowId);
    expect(component.cloudSync().message).toContain('সব সংঘাত সমাধান হয়েছে');
    expect(notifySuccess).toHaveBeenCalled();
    expect(component.conflictBusy()).toBe('');
  });

  it('asks for a fresh decision when the remote version changed', async () => {
    chooseRemote.mockResolvedValueOnce({ resolved: false, reason: 'remote-changed' });
    await component.resolveConflict(conflict, 'remote');
    expect(notifyInfo).toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(component.cloudSync().message).toContain('পুনরায়');
  });

  it('blocks destructive resolution and restore review without settings permission', async () => {
    hasPermission.mockReturnValue(false);
    await component.resolveConflict(conflict, 'remote');
    await component.reviewRestoredData();
    expect(confirm).not.toHaveBeenCalled();
    expect(chooseRemote).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('renders deleted and structured snapshots readably', () => {
    expect(component.snapshot(null)).toBe('মুছে ফেলা হয়েছে');
    expect(component.snapshot({ name: 'পণ্য' })).toContain('"name": "পণ্য"');
  });
});