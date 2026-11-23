import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, Party, ReminderHistoryEntry, promiseRemaining, salesAccountOf } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { SessionService } from '../../services/session';
import { DmyDateDirective } from '../../directives/dmy-date.directive';
import { localDateIso } from '../../utils/local-date';

/** Sets or moves the date the party promised to pay part of the due. */
@Component({
  selector: 'app-party-reminder-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, DmyDateDirective],
  template: `
    <div class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs" (click)="closed.emit()">
      <div class="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" (click)="$event.stopPropagation()">
        <div class="relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 px-5 py-4 text-white">
          <div class="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl"></div>
          <div class="relative flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                <mat-icon class="text-lg">notifications_active</mat-icon>
              </span>
              <div class="min-w-0">
                <p class="text-[9px] font-bold uppercase tracking-[0.14em] text-teal-50/70">{{ prefs.txt('বাকি আদায়ের রিমাইন্ডার', 'Due reminder') }}</p>
                <h3 class="truncate text-sm font-bold">{{ mode() === 'date' ? prefs.txt('তারিখ বদল', 'Change date') : prefs.txt('প্রতিশ্রুত তারিখ ও টাকা', 'Promise date & amount') }}</h3>
                <p class="truncate text-[10px] text-teal-50/85">{{ party().name }}</p>
              </div>
            </div>
            <button (click)="closed.emit()" class="rounded-full p-1 text-white/80 hover:bg-white/15 hover:text-white cursor-pointer" [attr.aria-label]="prefs.txt('বন্ধ', 'Close')">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>
        </div>

        <div class="space-y-3 p-5 text-xs">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-300">* {{ prefs.txt('প্রতিশ্রুত তারিখ', 'Promise date') }}</label>
              <input type="date" appDmyDate [(ngModel)]="formDate" (ngModelChange)="error.set('')"
                class="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-semibold text-slate-800 focus:border-teal-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            </div>
            <div>
              <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-300">{{ prefs.txt('দেওয়ার কথা (TK)', 'Promised (TK)') }}</label>
              <input type="number" min="0" step="0.01" [(ngModel)]="formAmount" [readonly]="mode() === 'date'" (ngModelChange)="error.set('')"
                class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right font-mono font-bold text-slate-800 focus:border-teal-500 focus:outline-none read-only:bg-slate-100 read-only:text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:read-only:bg-slate-800/60">
            </div>
          </div>
          <p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            {{ prefs.txt('মোট বকেয়া', 'Total due') }}: <b class="font-mono text-slate-800 dark:text-slate-100">{{ due() | number:'1.2-2' }} TK</b>
            · {{ prefs.txt('বাকি প্রতিশ্রুতি', 'Promise left') }}: <b class="font-mono text-rose-600 dark:text-rose-300">{{ remaining() | number:'1.2-2' }} TK</b>
          </p>

          <div>
            <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-300">{{ prefs.txt('যোগাযোগের / ফলোআপ নোট', 'Contact / follow-up note') }}</label>
            <textarea rows="2" [(ngModel)]="formNote" (ngModelChange)="error.set('')"
              [placeholder]="prefs.txt('যেমন: ফোন করা হয়েছে, আগামীকাল টাকা দেবেন…', 'e.g. called the customer, promised tomorrow…')"
              class="w-full resize-none rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-slate-100"
              [ngClass]="error() ? 'border-rose-400' : 'border-slate-300 dark:border-slate-600'"></textarea>
          </div>

          @if (error()) {
            <p class="text-[10px] font-bold text-rose-600 dark:text-rose-300">{{ error() }}</p>
          }

          @if (history().length) {
            <div class="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60">
              <p class="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('ইতিহাস', 'History') }}</p>
              <ul class="max-h-32 space-y-1 overflow-y-auto pr-1">
                @for (entry of history(); track entry.at + entry.kind) {
                  <li class="flex items-start gap-1.5 text-[10px] leading-snug text-slate-600 dark:text-slate-300">
                    <mat-icon class="mt-0.5 shrink-0 text-[12px] text-slate-400">{{ kindIcon(entry.kind) }}</mat-icon>
                    <span class="min-w-0 break-words"><b>{{ kindLabel(entry.kind) }}</b>{{ entryLine(entry) }}</span>
                  </li>
                }
              </ul>
            </div>
          }

          <p class="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-medium leading-snug text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <mat-icon class="mr-1 align-middle text-xs">info</mat-icon>
            {{ prefs.txt('তারিখ বদলালে পাওনা বা লেজারের টাকার অঙ্ক বদলাবে না; আগের তারিখ ও নোট ইতিহাসে থাকবে।', 'Changing the date never touches dues or the ledger; earlier dates and notes stay in the history.') }}
          </p>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-900">
          <button (click)="closed.emit()" class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            {{ prefs.txt('বাতিল', 'Cancel') }}
          </button>
          <button (click)="save()" class="flex items-center gap-1 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-emerald-700 cursor-pointer">
            <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ', 'Save') }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class PartyReminderDialog implements OnInit {
  readonly party = input.required<Party>();
  readonly mode = input<'set' | 'date'>('set');
  readonly closed = output<void>();

  readonly dataService = inject(DataService);
  private notify = inject(NotificationService);
  prefs = inject(PreferencesService);
  private session = inject(SessionService);

  formDate = '';
  formAmount = 0;
  formNote = '';
  readonly error = signal('');

  readonly due = computed(() => Math.max(0, salesAccountOf(this.live()).due));
  readonly remaining = computed(() => promiseRemaining(this.live()));
  readonly history = computed<ReminderHistoryEntry[]>(() =>
    [...(this.live().paymentPromise?.history ?? [])].reverse().slice(0, 12)
  );

  ngOnInit() {
    const promise = this.party().paymentPromise;
    this.formDate = promise?.date || localDateIso();
    this.formAmount = this.mode() === 'date'
      ? Math.round((promise?.amount ?? 0) * 100) / 100
      : this.remaining() || this.due();
    this.formNote = '';
  }

  private live(): Party {
    return this.dataService.parties().find(p => p.id === this.party().id) ?? this.party();
  }

  save() {
    const date = (this.formDate || '').trim();
    const amount = Math.round((Number(this.formAmount) || 0) * 100) / 100;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      this.error.set(this.prefs.txt('সঠিক তারিখ বেছে নিন।', 'Pick a valid date.'));
      return;
    }
    if (this.mode() !== 'date' && amount <= 0) {
      this.error.set(this.prefs.txt('যত টাকা দেওয়ার কথা, সেই অঙ্কটি লিখুন।', 'Enter the promised amount.'));
      return;
    }
    const party = this.live();
    const promise = this.dataService.setPaymentPromise(party.id, { date, amount: amount || this.remaining(), note: this.formNote });
    if (!promise) {
      this.error.set(this.prefs.txt('রিমাইন্ডার সংরক্ষণ করা যায়নি।', 'The reminder could not be saved.'));
      return;
    }
    this.session.log(
      'Payment Reminder',
      `${party.name} — ${date} · ${promise.amount.toFixed(2)} TK${this.formNote.trim() ? ` · ${this.formNote.trim()}` : ''}`
    );
    this.notify.success(
      this.prefs.txt(`“${party.name}” এর রিমাইন্ডার সংরক্ষিত হয়েছে।`, `Reminder saved for “${party.name}”.`),
      this.prefs.txt('রিমাইন্ডার', 'Reminder')
    );
    this.closed.emit();
  }

  kindLabel(kind: ReminderHistoryEntry['kind']): string {
    switch (kind) {
      case 'set': return this.prefs.txt('প্রতিশ্রুতি', 'Promise');
      case 'date': return this.prefs.txt('তারিখ বদল', 'Date change');
      case 'note': return this.prefs.txt('নোট', 'Note');
      case 'payment': return this.prefs.txt('আদায়', 'Collected');
      default: return this.prefs.txt('সম্পন্ন', 'Completed');
    }
  }

  kindIcon(kind: ReminderHistoryEntry['kind']): string {
    switch (kind) {
      case 'set': return 'flag';
      case 'date': return 'event';
      case 'note': return 'sticky_note_2';
      case 'payment': return 'payments';
      default: return 'task_alt';
    }
  }

  entryLine(entry: ReminderHistoryEntry): string {
    const parts: string[] = [];
    if (entry.kind === 'date' && entry.oldDate) parts.push(`${this.shortDate(entry.oldDate)} → ${this.shortDate(entry.date)}`);
    else if (entry.date) parts.push(this.shortDate(entry.date));
    if (entry.amount != null) parts.push(`${entry.amount.toFixed(2)} TK`);
    if (entry.text) parts.push(entry.text);
    return parts.length ? ` — ${parts.join(' · ')}` : '';
  }

  private shortDate(iso?: string): string {
    const value = (iso || '').slice(0, 10);
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
  }
}
