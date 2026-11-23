import { Injectable, inject, signal } from '@angular/core';
import type { Sale } from './data';
import { SessionService } from './session';

const LOCKED_STATUSES: ReadonlySet<string> = new Set([
  'Confirmed',
  'Processing',
  'Shipping',
  'Completed'
]);

@Injectable({ providedIn: 'root' })
export class OrderLockService {
  private session = inject(SessionService);
  private readonly unlocks = signal<{ version: number; ids: ReadonlySet<number> }>({ version: -1, ids: new Set() });

  isLockable(status: string): boolean {
    return LOCKED_STATUSES.has(status);
  }

  isLocked(sale: Pick<Sale, 'id' | 'status'>): boolean {
    return this.isLockable(sale.status) && !this.isUnlocked(sale.id);
  }

  isUnlocked(id: number): boolean {
    const unlocks = this.unlocks();
    return !!this.session.currentUser() && unlocks.version === this.session.authorizationVersion()
      && unlocks.ids.has(id);
  }

  unlock(id: number, passcode: string): boolean {
    // Local supervisor check only; server authorization is still required.
    if (!this.session.verifyAdminPin(passcode)) {
      return false;
    }
    const version = this.session.authorizationVersion();
    this.unlocks.update(unlocks => {
      const ids = new Set(unlocks.version === version ? unlocks.ids : []);
      ids.add(id);
      return { version, ids };
    });
    return true;
  }

  lock(id: number): void {
    this.unlocks.update(unlocks => {
      if (!unlocks.ids.has(id)) return unlocks;
      const ids = new Set(unlocks.ids);
      ids.delete(id);
      return { ...unlocks, ids };
    });
  }
}
