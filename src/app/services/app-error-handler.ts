import { ErrorHandler, Injectable, inject } from '@angular/core';
import { NotificationService } from './notification';
import { PreferencesService } from './preferences';

export type GlobalErrorKind = 'benign' | 'stale-chunk' | 'unknown';

/**
 * Lazy routes and the Excel reader are separate files. Right after a deploy an
 * already-open tab can ask for a file the new release replaced, which Chrome,
 * Firefox and Safari all report with their own wording.
 */
const STALE_CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\w.-]+ failed/i;

/** Browser noise that must never reach the shop owner as a data-problem toast. */
const BENIGN = /ResizeObserver loop|^Script error\.?$/i;

/**
 * A dropped request during startup or a background pull is a sync problem, not
 * a data-processing problem: the cloud badge and page warnings already say so,
 * and showing the generic data toast on every refresh would only alarm the shop
 * owner. This covers Chrome, Firefox, Safari and Android WebView wording.
 */
const TRANSIENT = /Failed to fetch|Load failed|NetworkError|Network request failed|net::ERR_|TimeoutError|timed out|timed out waiting|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|network connection was lost|server with the specified hostname could not be found|internet connection appears to be offline/i;

/**
 * A reload paints the splash and starts a background pull of the landing page.
 * Anything thrown in that window is startup noise (the splash warning and the
 * cloud badge already report it), so the generic data toast waits it out.
 */
const BOOT_AT = Date.now();
const BOOT_QUIET_MS = 30_000;

export function classifyGlobalError(error: unknown): GlobalErrorKind {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (BENIGN.test(message)) return 'benign';
  if (STALE_CHUNK.test(message)) return 'stale-chunk';
  if (TRANSIENT.test(message)) return 'benign';
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return 'benign';
  return 'unknown';
}

/**
 * A single malformed record must never leave the shop owner staring at a blank
 * screen: log the real error for diagnosis and show one calm warning toast.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private notify = inject(NotificationService);
  private prefs = inject(PreferencesService);
  private lastToastAt = 0;

  handleError(error: unknown): void {
    console.error('[SM Enterprise]', error);
    const kind = classifyGlobalError(error);
    if (kind === 'benign') return;
    if (kind === 'stale-chunk') {
      this.recoverFromStaleChunk();
      return;
    }
    if (Date.now() - BOOT_AT < BOOT_QUIET_MS) return;
    this.showGenericToast();
  }

  /**
   * A reload downloads the fresh index and chunk names. The guard stops a
   * cached index that keeps pointing at missing chunks from looping forever.
   */
  private recoverFromStaleChunk(): void {
    const key = 'sm_chunk_reload_at';
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(key)) || 0;
    } catch {
      /* private mode — reload still works, it just cannot be throttled */
    }
    if (typeof location !== 'undefined' && Date.now() - last > 30_000) {
      try {
        sessionStorage.setItem(key, String(Date.now()));
      } catch {
        /* ignore */
      }
      location.reload();
      return;
    }
    try {
      this.notify.warning(
        this.prefs.txt('অ্যাপের নতুন অংশ লোড করা যায়নি — ইন্টারনেট সংযোগ দেখে পেজ রিফ্রেশ করুন।', 'A new part of the app could not load — check your internet connection and refresh the page.'),
        this.prefs.txt('লোড সমস্যা', 'Loading problem')
      );
    } catch {
      /* notification bus not ready yet — the console log is enough */
    }
  }

  private showGenericToast(): void {
    const now = Date.now();
    if (now - this.lastToastAt < 5000) return;
    this.lastToastAt = now;
    try {
      this.notify.error(
        this.prefs.txt('কিছু ডেটা প্রসেস করা যায়নি — পেজ রিফ্রেশ করে আবার চেষ্টা করুন।', 'Some data could not be processed — refresh the page and try again.'),
        this.prefs.txt('ডেটা সমস্যা', 'Data problem')
      );
    } catch {
      /* notification bus not ready yet — the console log above is enough */
    }
  }
}
