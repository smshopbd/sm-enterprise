import { ChangeDetectionStrategy, Component, HostListener, effect, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { NotificationService, NotifyKind } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';

@Component({
  selector: 'app-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <!-- Toast stack -->
    <div class="pointer-events-none fixed right-4 top-4 z-[120] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2.5">
      @for (t of notify.toasts(); track t.id) {
        <div
          class="notif-toast pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-xl border bg-white p-3 pr-9 shadow-xl dark:bg-slate-900"
          [class]="toastBorder(t.kind)"
          role="status"
          aria-live="polite"
        >
          <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border" [class]="iconBox(t.kind)">
            <mat-icon class="text-base">{{ icon(t.kind) }}</mat-icon>
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-bold uppercase tracking-wide" [class]="titleColor(t.kind)">{{ t.title || kindTitle(t.kind) }}</p>
            <p class="mt-0.5 whitespace-pre-line text-xs font-medium leading-snug text-slate-700 dark:text-slate-200">{{ t.message }}</p>
          </div>
          <button type="button" (click)="notify.dismiss(t.id)" class="absolute right-2 top-2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" [title]="prefs.txt('বন্ধ করুন', 'Dismiss')" [attr.aria-label]="prefs.txt('নোটিফিকেশন বন্ধ করুন', 'Dismiss notification')">
            <mat-icon class="text-sm">close</mat-icon>
          </button>
          <span class="notif-progress absolute bottom-0 left-0 h-0.5" [class]="progressColor(t.kind)" [style.animation-duration.ms]="t.duration"></span>
        </div>
      }
    </div>

    <!-- Alert / Confirm / Prompt dialog -->
    @if (notify.dialog(); as d) {
      <div class="notif-fade fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" (click)="notify.close(false)">
        <div
          class="notif-pop w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          (click)="$event.stopPropagation()"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="d.title"
        >
          <div class="flex items-start gap-3 px-5 pt-5">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border" [class]="iconBox(d.tone)">
              <mat-icon class="text-xl">{{ icon(d.tone) }}</mat-icon>
            </span>
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100">{{ d.title }}</h3>
              <p class="mt-1 whitespace-pre-line text-xs font-medium leading-relaxed text-slate-600 dark:text-slate-300">{{ d.message }}</p>
            </div>
            <button type="button" (click)="notify.close(false)" class="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" [title]="prefs.txt('বন্ধ করুন', 'Close')" [attr.aria-label]="prefs.txt('বন্ধ করুন', 'Close')">
              <mat-icon class="text-base">close</mat-icon>
            </button>
          </div>

          @if (d.kind === 'prompt') {
            <div class="px-5 pt-4">
              <label class="mb-1.5 block text-[11px] font-semibold text-slate-600 dark:text-slate-300" for="notify-dialog-input">{{ d.inputLabel || prefs.txt('মান', 'Value') }}</label>
              <input
                id="notify-dialog-input"
                type="text"
                [value]="notify.dialogInput()"
                (input)="notify.dialogInput.set($any($event.target).value)"
                [attr.placeholder]="d.placeholder || ''"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
            </div>
          }

          <div class="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-950/40">
            @if (d.kind !== 'alert') {
              <button
                type="button"
                data-dialog-cancel
                (click)="notify.close(false)"
                class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {{ d.cancelText }}
              </button>
            }
            <button
              id="notify-dialog-confirm"
              type="button"
              (click)="accept()"
              class="rounded-lg px-4 py-2 text-xs font-bold text-white shadow-sm transition-all active:scale-95"
              [class]="confirmClass(d.tone)"
            >
              {{ d.confirmText }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes notifToastIn {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes notifFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes notifPopIn {
      from { opacity: 0; transform: translateY(6px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes notifProgress {
      from { width: 100%; }
      to { width: 0%; }
    }
    .notif-toast {
      animation: notifToastIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .notif-fade {
      animation: notifFadeIn 0.15s ease-out both;
    }
    .notif-pop {
      animation: notifPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .notif-progress {
      animation-name: notifProgress;
      animation-timing-function: linear;
      animation-fill-mode: both;
    }
  `]
})
export class Notifications {
  notify = inject(NotificationService);
  prefs = inject(PreferencesService);
  private lastFocused: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const dialog = this.notify.dialog();
      if (typeof document === 'undefined') return;
      if (!dialog) {
        if (this.lastFocused) {
          const previous = this.lastFocused;
          this.lastFocused = null;
          setTimeout(() => previous.focus({ preventScroll: true }), 30);
        }
        return;
      }
      this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setTimeout(() => {
        const target = document.getElementById(dialog.kind === 'prompt' ? 'notify-dialog-input' : 'notify-dialog-confirm');
        target?.focus({ preventScroll: true });
      }, 60);
    });
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.notify.dialog()) this.notify.close(false);
  }

  @HostListener('document:keydown.enter', ['$event'])
  onEnter(event: Event) {
    const dialog = this.notify.dialog();
    if (!dialog) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-dialog-cancel]')) return;
    event.preventDefault();
    this.accept();
  }

  accept() {
    const dialog = this.notify.dialog();
    if (!dialog) return;
    if (dialog.kind === 'prompt') {
      this.notify.close(this.notify.dialogInput());
    } else {
      this.notify.close(true);
    }
  }

  icon(kind: NotifyKind) {
    return {
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      info: 'info'
    }[kind];
  }

  kindTitle(kind: NotifyKind) {
    return {
      success: this.prefs.txt('সফল', 'Success'),
      error: this.prefs.txt('কিছু ভুল হয়েছে', 'Something went wrong'),
      warning: this.prefs.txt('মনে রাখুন', 'Heads up'),
      info: this.prefs.txt('নোটিশ', 'Notice')
    }[kind];
  }

  iconBox(kind: NotifyKind) {
    return {
      success: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30',
      error: 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30',
      warning: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30',
      info: 'bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/30'
    }[kind];
  }

  toastBorder(kind: NotifyKind) {
    return {
      success: 'border-emerald-200 dark:border-emerald-500/30',
      error: 'border-rose-200 dark:border-rose-500/30',
      warning: 'border-amber-200 dark:border-amber-500/30',
      info: 'border-sky-200 dark:border-sky-500/30'
    }[kind];
  }

  titleColor(kind: NotifyKind) {
    return {
      success: 'text-emerald-600 dark:text-emerald-400',
      error: 'text-rose-600 dark:text-rose-400',
      warning: 'text-amber-600 dark:text-amber-400',
      info: 'text-sky-600 dark:text-sky-400'
    }[kind];
  }

  progressColor(kind: NotifyKind) {
    return {
      success: 'bg-emerald-500',
      error: 'bg-rose-500',
      warning: 'bg-amber-500',
      info: 'bg-sky-500'
    }[kind];
  }

  confirmClass(kind: NotifyKind) {
    return {
      success: 'bg-emerald-600 hover:bg-emerald-700',
      error: 'bg-rose-600 hover:bg-rose-700',
      warning: 'bg-amber-500 hover:bg-amber-600',
      info: 'bg-teal-600 hover:bg-teal-700'
    }[kind];
  }
}
