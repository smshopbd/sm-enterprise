import { Injectable, computed, inject } from '@angular/core';
import { CloudService } from './cloud';
import { PageDataService } from './page-data';

/**
 * Shell-level cloud state for the header chip. Page data loading is reported
 * separately by PageDataService; this only folds both into the small chip.
 */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly cloud = inject(CloudService);
  private readonly pages = inject(PageDataService);

  /**
   * True while a deliberate sync is running (boot, a manual push or the open
   * page refreshing its collections). Queued rows alone must not keep a
   * pulsing chip in the header.
   */
  readonly syncing = computed(() => {
    const config = this.cloud.config();
    if (!config.supabase?.enabled || !config.autoSync) return false;
    if (this.cloud.status() === 'error') return false;
    return this.cloud.status() === 'connecting' || this.pages.loading();
  });

  readonly online = computed(() => this.cloud.status() !== 'error');
}
