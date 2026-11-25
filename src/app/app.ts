import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Header } from './components/header/header';
import { Sidebar } from './components/sidebar/sidebar';
import { Login } from './components/login/login';
import { Notifications } from './components/notifications/notifications';
import { PageDataService } from './services/page-data';
import { SessionService } from './services/session';
import { PreferencesService } from './services/preferences';
import { StorageService } from './services/storage';
import { CloudService } from './services/cloud';
import { DataService } from './services/data';
import { BackupService } from './services/backup';
import { persistedSignal } from './utils/persisted-signal';
import { SearchableSelectService } from './services/searchable-select';
import { DigitLocalizer } from './services/digit-localizer';
import { SwUpdate } from '@angular/service-worker';

/** A local database can load in well under a second, so the splash would blink
 *  past on refresh. Keep it on screen long enough to actually be seen. */
const SPLASH_MIN_MS = 1400;
/** The first visit on a device also downloads the whole shop from Supabase. */
const FIRST_SPLASH_MIN_MS = 2600;
/** A dead or throttled network must not hold the app on the splash forever. */
const STARTUP_SYNC_TIMEOUT_MS = 20_000;
const FIRST_RUN_KEY = 'sm_first_boot_v1';
/** Tabs stay open all day, so ask the server for a published build regularly. */
const UPDATE_CHECK_MS = 5 * 60 * 1000;
/** How often a downloaded build retries once the page becomes safe to reload. */
const UPDATE_RETRY_MS = 5_000;
/** Never swap a build right after a save; the splash would look like a freeze. */
const UPDATE_QUIET_MS = 20_000;
/** Remember which build was already swapped so a stale worker cannot reload-loop. */
const UPDATE_GUARD_KEY = 'sm_update_swapped_v1';
/** A corrupt install may repair itself once a minute, not in a reload loop. */
const RECOVERY_GUARD_KEY = 'sm_update_recovery_v1';

/** Routed form pages expose this so a reload can be held back mid-entry. */
interface UnsavedAware {
  hasUnsavedWork?: () => boolean;
}

const RESTRICTED: { prefix: string; area: 'reports' | 'accounts' | 'settings' | 'users' | 'pos' | 'hrm' }[] = [
  { prefix: '/reports', area: 'reports' },
  { prefix: '/accounts', area: 'accounts' },
  { prefix: '/cash-bank', area: 'accounts' },
  { prefix: '/settings', area: 'settings' },
  { prefix: '/recycle-bin', area: 'users' },
  { prefix: '/pos', area: 'pos' },
  { prefix: '/hrm', area: 'hrm' }
];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Header, Sidebar, Login, Notifications],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  session = inject(SessionService);
  prefs = inject(PreferencesService);
  storage = inject(StorageService);
  cloud = inject(CloudService);
  data = inject(DataService);
  private backup = inject(BackupService);
  private searchable = inject(SearchableSelectService);
  private digits = inject(DigitLocalizer);
  private pages = inject(PageDataService);
  private router = inject(Router);
  /** Absent in dev builds and on the server, where no service worker exists. */
  private readonly swUpdate = inject(SwUpdate, { optional: true });

  /** A downloaded build waiting for the tab to be safe to reload. */
  readonly updateReady = signal(false);
  private swapTimer: ReturnType<typeof setInterval> | undefined;
  /** Live page instance, used to check whether anything is half-typed. */
  private outletPage: UnsavedAware | null = null;
  private pendingUpdateHash = '';
  /** A save's writes finish with dialogs closed, so the reload waits for calm. */
  private lastDataWriteAt = 0;

  /** Data pull for the page on screen, shown as a slim line above the content. */
  readonly pageLoading = this.pages.loading;
  /** Re-adding the class replays the short enter animation on every navigation. */
  readonly pageAnimating = signal(false);

  /** Shop name shown on the startup splash while the background sync runs. */
  readonly shopName = computed(() => {
    const s = this.data.voucherSettings();
    return `${s.businessNamePart1} ${s.businessNamePart2}`.trim();
  });

  sidebarOpen = signal<boolean>(false);
  sidebarCollapsed = persistedSignal<boolean>('sm_sidebar_collapsed_v1', false, value => value === true);
  readonly startupLoading = signal(true);
  readonly startupMessage = computed(() => this.prefs.txt('আপনার দোকানের ডেটা প্রস্তুত করা হচ্ছে…', 'Preparing your shop data…'));
  readonly startupWarning = signal('');
  readonly startupSyncFailed = signal(false);
  private readonly splashStartedAt = Date.now();
  /** First launch on this browser has no local rows yet, so hold the splash while syncing. */
  private firstRun = this.detectFirstRun();
  private initialRedirectDone = false;
  /** A customer opening a printed QR link has no account, so it renders outside the chrome. */
  readonly publicLink = signal<boolean>(this.isPublicLink(this.router.url));

  constructor() {
    this.prefs.applyTheme();
    // Every number on screen follows the UI language; values stay numeric in
    // storage and only the rendered text is rewritten.
    this.digits.start();
    // The session is device-wide: every tab and reload keeps the login until
    // the user signs out (or their account is changed remotely).
    this.searchable.start();
    // A swap immediately after a save shows the splash over the success screen,
    // which reads as a frozen app. Cloud config and session writes do not count.
    this.storage.onWrite(key => {
      if (key.startsWith('sm_cloud_') || key === 'sm_session_v1' || key === 'sm_device_key_v1') return;
      this.lastDataWriteAt = Date.now();
    });

    // A published build is picked up and swapped in without the user clearing
    // the browser cache; the service worker drops the old caches on activation.
    // The reload itself waits until no half-entered sale or open dialog would
    // be lost.
    if (this.swUpdate?.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter(event => event.type === 'VERSION_READY'))
        .subscribe(event => this.queueUpdate((event as { latest?: { hash?: string } }).latest?.hash ?? ''));
      // A broken install (usually a stale cache mix after a deploy) is only
      // repaired by loading the freshly published files again.
      this.swUpdate.unrecoverable.subscribe(() => this.reloadForRecovery());
      void this.swUpdate.checkForUpdate().catch(() => undefined);
      if (typeof window !== 'undefined') {
        window.setInterval(() => {
          if (document.visibilityState === 'visible') {
            void this.swUpdate!.checkForUpdate().catch(() => undefined);
          }
        }, UPDATE_CHECK_MS);
        // A tab coming back into view checks immediately; one going away can
        // take the update safely since nobody is typing into it.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            void this.swUpdate!.checkForUpdate().catch(() => undefined);
          } else {
            this.applyUpdateIfSafe();
          }
        });
      }
    }

    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(e => {
        this.publicLink.set(this.isPublicLink(e.urlAfterRedirects.split('?')[0]));
        this.enforceAccess();
        // While the splash is up, loadStartupData already syncs the landing page;
        // entering here would pull the same collections twice.
        if (!this.publicLink() && !this.startupLoading()) this.pages.enter(e.urlAfterRedirects);
        if (!this.publicLink()) this.animatePage();
      });

    effect(() => {
      const user = this.session.currentUser();
      this.enforceAccess();
      if (!user || this.startupLoading() || this.publicLink() || this.initialRedirectDone) return;

      const path = this.router.url.split('?')[0];
      this.initialRedirectDone = true;
      // The cloud gate only opens after a login, so the serial blocks are
      // reserved here instead of at startup (where the writes would be denied).
      void this.data.warmDocNumbers().catch(() => undefined);
      this.backup.startAutoBackup();
      if (path === '/' || path === '/dashboard') {
        void this.router.navigateByUrl(this.landingPath()).catch(() => undefined);
      }
    });

    // Startup must never surface as a global "data problem" toast: the splash
    // warning and the cloud badge already report a failed first sync.
    void this.loadStartupData().catch(error => console.error('[SM Enterprise] startup failed', error));
  }

  applyUpdate(): void {
    this.updateReady.set(false);
    this.stopSwapTimer();
    // If this build is still the waiting one after the reload, the automatic
    // path stays off and only the banner can try again.
    this.rememberSwappedBuild();
    if (!this.swUpdate) {
      this.reloadNow();
      return;
    }
    // Even if activation reports a problem, a reload re-checks the manifest and
    // serves whichever build is complete.
    void this.swUpdate.activateUpdate()
      .then(() => this.reloadNow())
      .catch(() => this.reloadNow());
  }

  /** The routed page changed; remember it so a reload never drops its typing. */
  onPageActivate(component: unknown): void {
    this.outletPage = (component ?? null) as UnsavedAware | null;
  }

  /** A new build finished downloading: swap as soon as the screen is safe. */
  private queueUpdate(hash: string): void {
    this.pendingUpdateHash = hash;
    this.updateReady.set(true);
    this.applyUpdateIfSafe();
    this.swapTimer ??= setInterval(() => this.applyUpdateIfSafe(), UPDATE_RETRY_MS);
  }

  private applyUpdateIfSafe(): void {
    if (!this.updateReady()) {
      this.stopSwapTimer();
      return;
    }
    // The same build becoming ready again right after a swap means the worker
    // still serves the old files; reloading again would only loop the splash.
    if (this.sameBuildWasSwapped()) {
      this.stopSwapTimer();
      return;
    }
    if (!this.canSwapNow()) return;
    this.applyUpdate();
  }

  private stopSwapTimer(): void {
    if (this.swapTimer === undefined) return;
    clearInterval(this.swapTimer);
    this.swapTimer = undefined;
  }

  /** Reloading discards whatever is typed into the open page or dialog. */
  private canSwapNow(): boolean {
    if (typeof document === 'undefined') return false;
    // A save closes its dialog and clears focus, so without this the success
    // screen would be replaced by the startup splash within seconds.
    if (Date.now() - this.lastDataWriteAt < UPDATE_QUIET_MS) return false;
    if (this.outletPage?.hasUnsavedWork?.()) return false;
    if (this.hasOpenDialog()) return false;
    // An empty focused box (login, search) is not work in progress.
    return !this.hasTypedValue(document.activeElement as HTMLElement | null);
  }

  private rememberSwappedBuild(): void {
    if (!this.pendingUpdateHash) return;
    try {
      localStorage.setItem(UPDATE_GUARD_KEY, JSON.stringify({ hash: this.pendingUpdateHash, at: Date.now() }));
    } catch {
      /* private mode */
    }
  }

  /** A stale worker re-offers the build it already tried to swap. */
  private sameBuildWasSwapped(): boolean {
    if (!this.pendingUpdateHash) return false;
    try {
      const saved = JSON.parse(localStorage.getItem(UPDATE_GUARD_KEY) ?? 'null') as { hash?: string; at?: number } | null;
      return !!saved?.hash && saved.hash === this.pendingUpdateHash
        && Date.now() - Number(saved.at ?? 0) < 10 * 60_000;
    } catch {
      return false;
    }
  }

  /** A corrupt install gets one repair reload a minute instead of a loop. */
  private reloadForRecovery(): void {
    try {
      const last = Number(sessionStorage.getItem(RECOVERY_GUARD_KEY) ?? '0');
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem(RECOVERY_GUARD_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
    this.reloadNow();
  }

  /** Dropdown panels keep hidden dialogs in the DOM, so only visible ones count. */
  private hasOpenDialog(): boolean {
    const dialogs = document.querySelectorAll<HTMLElement>('mat-dialog-container, [role="dialog"]');
    return Array.from(dialogs).some(el => el.getClientRects().length > 0
      && getComputedStyle(el).visibility !== 'hidden');
  }

  private hasTypedValue(el: HTMLElement | null): boolean {
    if (!el) return false;
    if (el.isContentEditable) return (el.textContent ?? '').trim().length > 0;
    if (el instanceof HTMLSelectElement) return true;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim().length > 0;
    return false;
  }

  private reloadNow(): void {
    if (typeof window !== 'undefined') window.location.reload();
  }

  /**
   * Pages paint immediately from local data; this only softens the swap so a
   * click never feels like the app stopped between two screens.
   */
  private animatePage(): void {
    if (typeof window === 'undefined') return;
    this.pageAnimating.set(false);
    // Drop the class, let the browser register it, then re-add so the
    // animation restarts on every navigation.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => this.pageAnimating.set(true));
    });
  }

  private async loadStartupData(): Promise<void> {
    if (typeof window === 'undefined') {
      // Server-rendered HTML would otherwise paint the login page for a few
      // milliseconds before the browser restores the saved session. Keep the
      // splash as the first paint; public voucher links still render directly.
      if (this.publicLink()) this.startupLoading.set(false);
      return;
    }

    if (this.publicLink()) {
      this.startupLoading.set(false);
      return;
    }

    if (!this.storage.ready()) {
      await this.holdSplash();
      this.startupLoading.set(false);
      return;
    }

    const warnings: string[] = [];
    if (this.cloud.environmentWarning()) {
      warnings.push(this.cloud.environmentWarning());
    }
    try {
      if (this.cloud.isEnabled() && this.cloud.config().autoSync && this.session.currentUser()) {
        // A device that already holds the shop opens immediately; the page it
        // lands on pulls only its own collections. A first run (or wiped device)
        // waits for that same page, never for the whole shop.
        const initial = this.initialPath();
        const hasLocalData = this.data.products().length > 0 || this.data.parties().length > 0;
        if (this.firstRun || !hasLocalData) {
          try {
            await this.bootWithDeadline(this.firstRun, this.pages.keysFor(initial));
            this.pages.markLoaded(initial);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.cloud.status.set('error');
            this.cloud.statusMessage.set(message);
          }
          if (this.cloud.status() === 'error') {
            this.startupSyncFailed.set(true);
            warnings.push(`Supabase: ${this.cloud.statusMessage() || this.prefs.txt('ডেটা সিঙ্ক করা যায়নি।', 'data could not be synced.')}`);
          }
        } else {
          this.pages.enter(initial, true);
        }
      }

    } finally {
      await this.holdSplash();
      this.startupWarning.set(warnings.join(' '));
      this.startupLoading.set(false);
    }
  }

  /**
   * The splash may wait for a first-run cloud download, but never indefinitely:
   * the boot keeps running behind the app and a later failure raises the normal
   * status warning instead of freezing startup.
   */
  private async bootWithDeadline(forcePull: boolean, keys: string[]): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.cloud.boot(forcePull, keys),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(this.prefs.txt(
            'ক্লাউড সময়মতো সাড়া দেয়নি; ডিভাইসে থাকা ডেটা দিয়ে শুরু হচ্ছে।',
            'The cloud did not respond in time; starting with the data on this device.'
          ))), STARTUP_SYNC_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Refresh always shows the splash first; a restored session goes straight into the app. */
  private async holdSplash(): Promise<void> {
    const min = this.firstRun ? FIRST_SPLASH_MIN_MS : SPLASH_MIN_MS;
    const remaining = min - (Date.now() - this.splashStartedAt);
    if (remaining > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, remaining));
    }
    if (this.firstRun) {
      this.firstRun = false;
      try {
        localStorage.setItem(FIRST_RUN_KEY, '1');
      } catch {
        // private mode — the next launch simply waits the first-run time again
      }
    }
  }

  private detectFirstRun(): boolean {
    try {
      return typeof localStorage !== 'undefined' && !localStorage.getItem(FIRST_RUN_KEY);
    } catch {
      return false;
    }
  }

  /** A phone-shaped screen opens straight into the till; wider screens into the catalogue. */
  private phoneLayout(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
  }

  /**
   * Landing page after login. Users without POS access still land on the
   * catalogue, otherwise `enforceAccess` would bounce them into the dashboard.
   */
  private landingPath(): string {
    return this.phoneLayout() && this.session.canSee('pos') ? '/pos' : '/product-manager/products';
  }

  /** The page the browser will actually land on after the startup redirect. */
  private initialPath(): string {
    const path = this.router.url.split('?')[0] || '/';
    return path === '/' || path === '/dashboard' ? this.landingPath() : path;
  }

  private isPublicLink(url: string): boolean {
    const path = url.split('?')[0] || '';
    return path.startsWith('/v/') || path === '/scan';
  }

  private enforceAccess() {
    const user = this.session.currentUser();
    if (!user) return;
    const url = this.router.url.split('?')[0];
    const hit = RESTRICTED.find(r => url.startsWith(r.prefix));
    if (hit && !this.session.canSee(hit.area)) {
      this.router.navigate(['/dashboard']);
    }
  }

  toggleSidebar() {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      this.sidebarCollapsed.update(v => !v);
      return;
    }
    this.sidebarOpen.update(open => !open);
    if (this.sidebarOpen()) {
      this.sidebarCollapsed.set(false);
    }
  }

  toggleCollapse() {
    this.sidebarCollapsed.update(v => !v);
  }
}
