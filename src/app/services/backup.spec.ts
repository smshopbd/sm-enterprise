import { autoBackupEnabled, backupFileName, backupFolderFor, dailyBackupDue, normalizeBackupName } from './backup';

describe('daily Drive backup', () => {
  it('is due when nothing was backed up yet', () => {
    expect(dailyBackupDue('')).toBe(true);
    expect(dailyBackupDue(null)).toBe(true);
  });

  it('skips a second upload on the same local day', () => {
    const morning = new Date(2026, 10, 12, 9, 30);
    expect(dailyBackupDue(morning.toISOString(), '2026-11-12')).toBe(false);
  });

  it('is due again once the local day changes', () => {
    const lastNight = new Date(2026, 10, 11, 23, 50);
    expect(dailyBackupDue(lastNight.toISOString(), '2026-11-12')).toBe(true);
  });

  it('treats an unreadable timestamp as due', () => {
    expect(dailyBackupDue('not-a-date', '2026-11-12')).toBe(true);
  });
});

describe('Cloudinary backup layout', () => {
  it('files each day under its own folder', () => {
    expect(backupFolderFor('sm-enterprise', '2026-11-12')).toBe('sm-enterprise/backups/2026-11-12');
    expect(backupFolderFor('', '2026-11-12')).toBe('backups/2026-11-12');
  });

  it('names files with the day and a to-the-second time', () => {
    expect(backupFileName(new Date(2026, 10, 12, 9, 5, 7))).toBe('sm-x1-backup-2026-11-12-090507.json');
  });

  it('turns automatic backup on when this device never chose a setting', () => {
    expect(autoBackupEnabled(null)).toBe(true);
    expect(autoBackupEnabled('1')).toBe(true);
    expect(autoBackupEnabled('0')).toBe(false);
  });

  it('cleans a renamed backup into a safe file name', () => {
    expect(normalizeBackupName('  নভেম্বর শেষ  ')).toBe('নভেম্বর শেষ.json');
    expect(normalizeBackupName('month/end:2026?.json')).toBe('month end 2026 .json');
    expect(normalizeBackupName('backup.JSON')).toBe('backup.JSON');
    expect(normalizeBackupName('   ')).toBe('');
    expect(normalizeBackupName('a'.repeat(120))).toBe(`${'a'.repeat(80)}.json`);
  });
});
