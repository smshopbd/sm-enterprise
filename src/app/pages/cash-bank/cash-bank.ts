import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { downloadWorkbook } from '../../utils/spreadsheet';
import { CashClosing, DataService } from '../../services/data';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { PasscodeModal } from '../../components/passcode-modal/passcode-modal';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';
import { toIsoDate } from '../../utils/date-range';
import { DmyDateDirective } from '../../directives/dmy-date.directive';

type MoneyMode = 'Cash' | 'Bank' | 'bKash' | 'Nagad' | 'Rocket';

type MovementSource =
  | 'sale' | 'paymentIn' | 'batterySale' | 'walletIn'
  | 'purchase' | 'paymentOut' | 'batteryPurchase'
  | 'expense' | 'salary' | 'rent' | 'advance' | 'walletOut';

interface DayMovement {
  key: string;
  source: MovementSource;
  ref: string;
  label: string;
  mode: MoneyMode;
  direction: 'In' | 'Out';
  amount: number;
}

const MODE_ORDER: MoneyMode[] = ['Cash', 'Bank', 'bKash', 'Nagad', 'Rocket'];

const SOURCE_ORDER: Record<MovementSource, number> = {
  sale: 1, walletIn: 2, paymentIn: 3, batterySale: 4,
  purchase: 5, paymentOut: 6, batteryPurchase: 7,
  expense: 8, salary: 9, rent: 10, advance: 11, walletOut: 12
};

const MODE_LABELS: Record<MoneyMode, { bn: string; en: string }> = {
  Cash: { bn: 'ক্যাশ', en: 'Cash' },
  Bank: { bn: 'ব্যাংক', en: 'Bank' },
  bKash: { bn: 'বিকাশ', en: 'bKash' },
  Nagad: { bn: 'নগদ', en: 'Nagad' },
  Rocket: { bn: 'রকেট', en: 'Rocket' }
};

const MODE_BADGES: Record<MoneyMode, string> = {
  Cash: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
  Bank: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30',
  bKash: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
  Nagad: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  Rocket: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30'
};

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

@Component({
  selector: 'app-cash-bank',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule, PasscodeModal, TablePagination, DmyDateDirective],
  styles: `
    /* Printed-only receipt stays out of the way on the day-book and history pages. */
    @media screen {
      .print-offscreen { position: absolute; left: -10000px; top: 0; }
    }
  `,
  template: `
    @if (!session.canSee('accounts')) {
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center text-slate-500">
        <mat-icon class="text-4xl text-slate-300 block mb-2">lock</mat-icon>
        {{ prefs.t('settings.onlyAdmin') }}
      </div>
    } @else {
      <div class="space-y-4 text-xs text-slate-800 dark:text-slate-200">
        <!-- Header -->
        <div class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
          <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
          <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
          <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                <mat-icon class="text-xl">{{ cashView() === 'daybook' ? 'receipt_long' : cashView() === 'history' ? 'history' : 'savings' }}</mat-icon>
              </span>
              <div class="min-w-0">
                <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                  <span>{{ prefs.txt('হিসাব', 'Accounts') }}</span>
                  <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                  <span>{{ prefs.txt('ক্যাশ ও ব্যাংক', 'Cash & bank') }}</span>
                  @if (cashView() !== 'summary') {
                    <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                    <span>{{ cashView() === 'daybook' ? prefs.txt('দিনের লেনদেনের বই', 'Day book') : prefs.txt('ক্লোজিং হিস্ট্রি', 'Closing history') }}</span>
                  }
                </p>
                <h1 class="truncate text-xl font-bold leading-tight">
                  @switch (cashView()) {
                    @case ('daybook') { {{ prefs.txt('দিনের লেনদেনের বই', 'Day Book') }} }
                    @case ('history') { {{ prefs.txt('ক্লোজিং হিস্ট্রি', 'Closing History') }} }
                    @default { {{ prefs.t('cash.title') }} }
                  }
                </h1>
                <p class="truncate text-[11px] text-teal-50/85">
                  @switch (cashView()) {
                    @case ('daybook') { {{ prefs.txt('নির্বাচিত দিনের সব আয়-ব্যয় এক জায়গায় — বিক্রয়, ক্রয়, বাকি আদায়, ব্যাটারি, খরচ, বেতন ও ভাড়া।', 'Every money movement of the selected day — sales, purchases, dues, battery, expenses, salary and rent.') }} }
                    @case ('history') { {{ prefs.txt('সংরক্ষিত দৈনিক ক্লোজিং — প্রত্যাশিত ও গণনা করা ক্যাশের তুলনা।', 'Saved daily closings — expected versus counted cash.') }} }
                    @default { {{ prefs.txt('দিনের ক্যাশ ও ব্যাংক লেনদেন, প্রত্যাশিত ক্যাশ এবং পার্থক্য।', 'Daily cash and bank movement, expected cash and variance.') }} }
                  }
                </p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              @if (cashView() === 'daybook') {
                <label class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 backdrop-blur-sm">
                  <mat-icon class="text-sm text-teal-100">calendar_today</mat-icon>
                  <input type="date" appDmyDate [ngModel]="date()" (ngModelChange)="onDateChange($event)"
                    class="bg-transparent text-[11px] font-bold text-white outline-none [color-scheme:dark]" />
                </label>
              }
              @if (cashView() !== 'history') {
                <span class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-[10px] font-bold backdrop-blur-sm"
                  [title]="prefs.txt('প্রতিদিন রাত ১২টায় ক্যাশ পরের দিনে গড়ে যায় এবং ওপেনিং নতুন করে হিসাব হয়', 'Every midnight the cash day rolls over and the opening is re-derived')">
                  <mat-icon class="text-sm text-teal-100">autorenew</mat-icon>
                  <span class="text-teal-100/80">{{ prefs.txt('রিসেট', 'Reset') }}</span> {{ resetCountdown() }}
                </span>
              }
              <button (click)="exportExcel()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
                <mat-icon class="text-sm text-emerald-200">description</mat-icon> {{ prefs.t('common.excel') }}
              </button>
              @if (cashView() === 'summary') {
                <button (click)="printPage()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
                  <mat-icon class="text-sm">print</mat-icon> {{ prefs.t('common.print') }}
                </button>
              }
            </div>
          </div>
        </div>

        <!-- Sub-page navigation -->
        <nav class="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">
          <a routerLink="/cash-bank" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="bg-teal-600 text-white shadow-sm"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-black transition-colors hover:bg-teal-50 dark:hover:bg-teal-500/10">
            <mat-icon class="text-base">savings</mat-icon> {{ prefs.txt('ক্যাশ ও ব্যাংক', 'Cash & Bank') }}
          </a>
          <a routerLink="/cash-bank/day-book" routerLinkActive="bg-teal-600 text-white shadow-sm"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-black transition-colors hover:bg-teal-50 dark:hover:bg-teal-500/10">
            <mat-icon class="text-base">receipt_long</mat-icon> {{ prefs.txt('দিনের লেনদেনের বই', 'Day Book') }}
          </a>
          <a routerLink="/cash-bank/history" routerLinkActive="bg-teal-600 text-white shadow-sm"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-black transition-colors hover:bg-teal-50 dark:hover:bg-teal-500/10">
            <mat-icon class="text-base">history</mat-icon> {{ prefs.txt('ক্লোজিং হিস্ট্রি', 'Closing History') }}
          </a>
        </nav>

        @if (cashView() === 'summary') {
        <!-- Live cards -->
        <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs">
            <p class="text-slate-500 font-semibold flex items-center gap-1"><mat-icon class="text-sm text-slate-400">savings</mat-icon> {{ prefs.t('cash.opening') }}</p>
            <p class="text-lg font-black font-mono text-slate-800 dark:text-slate-100 mt-1">{{ openingCash() | number:'1.2-2' }} <span class="text-[10px]">TK</span></p>
            <p class="text-[10px] text-slate-400 truncate mt-0.5" [title]="openingSource()">{{ openingSource() }}</p>
          </div>
          <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs">
            <p class="text-slate-500 font-semibold flex items-center gap-1"><mat-icon class="text-sm text-emerald-500">call_received</mat-icon> {{ prefs.txt('ক্যাশ ইন', 'Cash In') }}</p>
            <p class="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">{{ cashIn() | number:'1.2-2' }} <span class="text-[10px]">TK</span></p>
            <p class="text-[10px] text-slate-400 mt-0.5">{{ cashInCount() }} {{ prefs.txt('টি লেনদেন', 'entries') }}</p>
          </div>
          <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs">
            <p class="text-slate-500 font-semibold flex items-center gap-1"><mat-icon class="text-sm text-rose-500">call_made</mat-icon> {{ prefs.txt('ক্যাশ আউট', 'Cash Out') }}</p>
            <p class="text-lg font-black font-mono text-rose-600 dark:text-rose-400 mt-1">{{ cashOut() | number:'1.2-2' }} <span class="text-[10px]">TK</span></p>
            <p class="text-[10px] text-slate-400 mt-0.5">{{ cashOutCount() }} {{ prefs.txt('টি লেনদেন', 'entries') }}</p>
          </div>
          <div class="bg-teal-50/70 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30 rounded-xl p-3.5 shadow-2xs">
            <p class="text-teal-700 dark:text-teal-300 font-semibold flex items-center gap-1"><mat-icon class="text-sm">point_of_sale</mat-icon> {{ prefs.t('cash.expected') }}</p>
            <p class="text-lg font-black font-mono text-teal-800 dark:text-teal-200 mt-1">{{ expectedCash() | number:'1.2-2' }} <span class="text-[10px]">TK</span></p>
            @if (difference() !== null) {
              <p class="text-[10px] font-bold mt-0.5" [class]="differenceTextClass()">
                {{ prefs.t('cash.difference') }}: {{ difference() | number:'1.2-2' }}
              </p>
            } @else {
              <p class="text-[10px] text-slate-400 mt-0.5">{{ prefs.txt('গণনা করা ক্যাশ লিখুন', 'Enter counted cash') }}</p>
            }
          </div>
          <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs col-span-2 lg:col-span-1">
            <p class="text-slate-500 font-semibold flex items-center gap-1"><mat-icon class="text-sm text-sky-500">account_balance</mat-icon> {{ prefs.txt('ব্যাংক / মোবাইল নিট', 'Bank / Mobile net') }}</p>
            <p class="text-lg font-black font-mono mt-1" [class.text-sky-700]="digitalNet() >= 0" [class.text-rose-600]="digitalNet() < 0">{{ digitalNet() | number:'1.2-2' }} <span class="text-[10px]">TK</span></p>
            <div class="flex flex-wrap gap-1 mt-1">
              @for (m of modeNets(); track m.mode) {
                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded border" [class]="modeBadgeClass(m.mode)">{{ m.label }} {{ m.net | number:'1.0-2' }}</span>
              }
            </div>
          </div>
        </div>

        <p class="flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          <mat-icon class="text-xs text-teal-500">bolt</mat-icon>
          {{ prefs.txt('এই পেজের রিড ও রাইট সাথে সাথে প্রতিফলিত হয় — নতুন লেনদেন বা সিঙ্ক হওয়া ডাটা সঙ্গে সঙ্গে উপরের হিসাবে আসবে।', 'Reads and writes reflect instantly — new transactions or synced rows change these figures immediately.') }}
        </p>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <!-- Closing form -->
          <div class="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
            <div class="bg-teal-700 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 class="font-bold text-sm flex items-center gap-1.5">
                <mat-icon class="text-sm">point_of_sale</mat-icon> {{ prefs.t('cash.closing') }}
                @if (editing()) {
                  <span class="text-[9px] font-bold bg-white/20 px-1.5 py-0.5 rounded">{{ prefs.txt('সম্পাদনা', 'Editing') }}</span>
                }
              </h2>
              <span class="text-[10px] text-teal-100">{{ formatDate(date()) }}</span>
            </div>

            <div class="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="sm:col-span-2">
                <label class="block font-semibold text-slate-600 dark:text-slate-400 mb-1">{{ prefs.t('common.date') }}</label>
                <div class="flex items-center gap-2">
                  <input type="date" appDmyDate [ngModel]="date()" (ngModelChange)="onDateChange($event)"
                    class="w-full sm:max-w-[180px] border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg p-2 font-mono font-bold focus:border-teal-500 focus:outline-none" />
                  <span class="text-[10px] text-slate-400">{{ prefs.txt('যেকোনো দিনের ক্লোজিং লিখতে বা এডিট করতে তারিখ বদলান', 'Change the date to close or edit any day') }}</span>
                </div>
              </div>
              <div>
                <label class="block font-semibold text-slate-600 dark:text-slate-400 mb-1">{{ prefs.t('cash.opening') }}</label>
                <input type="number" step="0.01" [ngModel]="openingCash()" (ngModelChange)="setOpeningCash($event)"
                  class="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg p-2 font-mono font-bold text-right focus:border-teal-500 focus:outline-none" />
                <p class="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                  <span class="truncate">{{ openingSource() }}</span>
                  @if (openingManual()) {
                    <button type="button" (click)="useAutoOpening()"
                      class="shrink-0 font-bold text-teal-600 hover:underline dark:text-teal-400 cursor-pointer">
                      {{ prefs.txt('স্বয়ংক্রিয়', 'Auto') }}
                    </button>
                  }
                </p>
              </div>
              <div>
                <label class="block font-semibold text-slate-600 dark:text-slate-400 mb-1">{{ prefs.t('cash.counted') }}</label>
                <input type="number" step="0.01" [ngModel]="countedCash()" (ngModelChange)="countedCash.set($event === null || $event === '' ? null : +$event)"
                  class="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg p-2 font-mono font-bold text-right focus:border-teal-500 focus:outline-none" placeholder="0.00" />
                <p class="text-[10px] text-slate-400 mt-1">{{ prefs.txt('ড্রয়ারে বাস্তবে যত টাকা আছে', 'Actual cash in the drawer') }}</p>
              </div>
              <div class="sm:col-span-2">
                <label class="block font-semibold text-slate-600 dark:text-slate-400 mb-1">{{ prefs.t('common.note') }}</label>
                <input type="text" [(ngModel)]="note" class="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg p-2 focus:border-teal-500 focus:outline-none"
                  [placeholder]="prefs.txt('পার্থক্যের কারণ / মন্তব্য...', 'Reason for difference / notes...')" />
              </div>
            </div>

            <div class="mx-4 mb-4 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <div class="flex justify-between px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60"><span>{{ prefs.t('cash.opening') }}</span><span class="font-mono">{{ openingCash() | number:'1.2-2' }}</span></div>
              <div class="flex justify-between px-3 py-1.5"><span>+ {{ prefs.t('cash.cashSales') }}</span><span class="font-mono text-emerald-700 dark:text-emerald-400">{{ cashSales() | number:'1.2-2' }}</span></div>
              <div class="flex justify-between px-3 py-1.5">
                <span>+ {{ prefs.txt('অন্যান্য ক্যাশ আদায়', 'Other cash received') }}</span>
                <span class="font-mono text-emerald-700 dark:text-emerald-400">{{ otherCashIn() | number:'1.2-2' }}</span>
              </div>
              <div class="flex justify-between px-3 pb-1.5 -mt-1 text-[10px] text-slate-400">
                <span class="pl-3">{{ prefs.txt('বাকি আদায়', 'Dues') }} {{ duesCashIn() | number:'1.2-2' }} · {{ prefs.txt('ব্যাটারি বিক্রয়', 'Battery sale') }} {{ batteryCashIn() | number:'1.2-2' }} · {{ prefs.txt('ম্যানুয়াল', 'Manual') }} {{ manualCashIn() | number:'1.2-2' }}</span>
                <span></span>
              </div>
              <div class="flex justify-between px-3 py-1.5"><span>− {{ prefs.txt('ক্রয় ও সাপ্লায়ার পরিশোধ', 'Purchases & supplier payments') }}</span><span class="font-mono text-rose-600 dark:text-rose-400">{{ purchaseCashOut() | number:'1.2-2' }}</span></div>
              <div class="flex justify-between px-3 py-1.5"><span>− {{ prefs.txt('ব্যাটারি ক্রয়', 'Battery purchase') }}</span><span class="font-mono text-rose-600 dark:text-rose-400">{{ batteryCashOut() | number:'1.2-2' }}</span></div>
              <div class="flex justify-between px-3 py-1.5"><span>− {{ prefs.txt('খরচ, বেতন, ভাড়া ও অগ্রিম', 'Expenses, salary, rent & advance') }}</span><span class="font-mono text-rose-600 dark:text-rose-400">{{ expensesForDate() | number:'1.2-2' }}</span></div>
              <div class="flex justify-between px-3 py-2 bg-teal-50 dark:bg-teal-500/10 border-t border-teal-100 dark:border-teal-500/30 font-black text-teal-800 dark:text-teal-200">
                <span>{{ prefs.t('cash.expected') }}</span>
                <span class="font-mono">{{ expectedCash() | number:'1.2-2' }} TK</span>
              </div>
              <div class="flex justify-between px-3 py-2 font-black" [class]="differenceTextClass()">
                <span>{{ prefs.t('cash.difference') }} ({{ differenceLabel() }})</span>
                <span class="font-mono">{{ difference() === null ? '—' : (difference() | number:'1.2-2') }} TK</span>
              </div>
            </div>

            <div class="px-4 pb-4 flex flex-wrap items-center gap-2">
              <button (click)="saveClosing()" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg flex items-center gap-1 shadow-2xs transition-all cursor-pointer">
                <mat-icon class="text-sm">save</mat-icon> {{ prefs.t('cash.saveClosing') }}
              </button>
              <button (click)="onDateChange(date())" class="border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold px-4 py-2 rounded-lg flex items-center gap-1 transition-colors cursor-pointer">
                <mat-icon class="text-sm">restart_alt</mat-icon> {{ prefs.txt('রিসেট', 'Reset') }}
              </button>
              @if (savedMsg()) {
                <span class="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <mat-icon class="text-sm">check_circle</mat-icon> {{ savedMsg() }}
                </span>
              }
              @if (formError()) {
                <span class="text-rose-600 font-semibold">{{ formError() }}</span>
              }
            </div>
          </div>

          <!-- Printable summary -->
          <ng-container *ngTemplateOutlet="printCard" />
        </div>
        }

        @if (cashView() === 'daybook') {
        <!-- Day book -->
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div class="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="font-bold text-sm flex items-center gap-1.5"><mat-icon class="text-sm text-teal-600">receipt_long</mat-icon> {{ prefs.txt('দিনের লেনদেনের বই', 'Day Book') }}</h2>
              <p class="text-[10px] text-slate-500">{{ prefs.txt('বিক্রয়, ক্রয়, বাকি আদায়, ব্যাটারি, খরচ, বেতন, ভাড়া — সব এক জায়গায়', 'Sales, purchases, dues, battery, expenses, salary, rent — in one place') }}</p>
            </div>
            <div class="flex items-center gap-2 text-[10px] font-bold">
              <span class="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{{ prefs.txt('ইন', 'In') }} {{ totalIn() | number:'1.2-2' }}</span>
              <span class="px-2 py-1 rounded-md bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{{ prefs.txt('আউট', 'Out') }} {{ totalOut() | number:'1.2-2' }}</span>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[780px] text-left border-collapse">
              <thead>
                <tr class="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase text-[10px] font-bold">
                  <th class="p-2.5 w-10">#</th>
                  <th class="p-2.5">{{ prefs.txt('বিবরণ', 'Description') }}</th>
                  <th class="p-2.5">{{ prefs.txt('রেফারেন্স', 'Reference') }}</th>
                  <th class="p-2.5">{{ prefs.txt('মাধ্যম', 'Mode') }}</th>
                  <th class="p-2.5 text-right">{{ prefs.txt('ইন', 'In') }}</th>
                  <th class="p-2.5 text-right">{{ prefs.txt('আউট', 'Out') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                @for (m of dayPager.paged(); track m.key; let i = $index) {
                  <tr class="hover:bg-teal-50/40 dark:hover:bg-teal-500/10">
                    <td class="p-2.5 text-slate-400 font-mono">{{ dayPager.offset() + i + 1 }}</td>
                    <td class="p-2.5">
                      <span class="font-bold text-slate-800 dark:text-slate-100">{{ sourceLabel(m.source) }}</span>
                      <span class="text-slate-500"> · {{ m.label || '—' }}</span>
                    </td>
                    <td class="p-2.5 font-mono text-slate-500">{{ m.ref || '—' }}</td>
                    <td class="p-2.5">
                      <span class="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold" [class]="modeBadgeClass(m.mode)">{{ modeLabel(m.mode) }}</span>
                    </td>
                    <td class="p-2.5 text-right font-mono text-emerald-700 dark:text-emerald-400">{{ m.direction === 'In' ? (m.amount | number:'1.2-2') : '' }}</td>
                    <td class="p-2.5 text-right font-mono text-rose-600 dark:text-rose-400">{{ m.direction === 'Out' ? (m.amount | number:'1.2-2') : '' }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="6" class="p-8 text-center text-slate-400">{{ prefs.txt('এই দিনে কোনো লেনদেন নেই।', 'No movement on this day.') }}</td></tr>
                }
              </tbody>
              @if (dayMovements().length) {
                <tfoot>
                  <tr class="bg-slate-50 dark:bg-slate-800/60 font-black text-slate-800 dark:text-slate-100">
                    <td colspan="4" class="p-2.5 text-right">{{ prefs.t('common.total') }}</td>
                    <td class="p-2.5 text-right font-mono text-emerald-700 dark:text-emerald-400">{{ totalIn() | number:'1.2-2' }}</td>
                    <td class="p-2.5 text-right font-mono text-rose-600 dark:text-rose-400">{{ totalOut() | number:'1.2-2' }}</td>
                  </tr>
                </tfoot>
              }
            </table>
          </div>
          <app-table-pagination
            [total]="dayPager.total()"
            [page]="dayPager.currentPage()"
            [pageSize]="dayPager.pageSize()"
            (pageChange)="dayPager.setPage($event)"
            (pageSizeChange)="dayPager.setPageSize($event)"
          />
        </div>
        }

        @if (cashView() === 'history') {
        <!-- History -->
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div class="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 class="font-bold text-sm flex items-center gap-1.5"><mat-icon class="text-sm text-teal-600">history</mat-icon> {{ prefs.t('cash.history') }}</h2>
            <span class="text-[10px] text-slate-500">{{ sortedClosings().length }}</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[960px] text-left border-collapse">
              <thead>
                <tr class="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase text-[10px] font-bold">
                  <th class="p-2.5">{{ prefs.t('common.date') }}</th>
                  <th class="p-2.5 text-right">{{ prefs.t('cash.opening') }}</th>
                  <th class="p-2.5 text-right">{{ prefs.t('cash.cashSales') }}</th>
                  <th class="p-2.5 text-right">{{ prefs.txt('অন্যান্য আদায় (নিট)', 'Other receipts (net)') }}</th>
                  <th class="p-2.5 text-right">{{ prefs.txt('ক্যাশ খরচ', 'Cash expenses') }}</th>
                  <th class="p-2.5 text-right">{{ prefs.t('cash.expected') }}</th>
                  <th class="p-2.5 text-right">{{ prefs.t('cash.counted') }}</th>
                  <th class="p-2.5 text-right">{{ prefs.t('cash.difference') }}</th>
                  <th class="p-2.5">{{ prefs.t('cash.closedBy') }}</th>
                  <th class="p-2.5 text-center w-24">{{ prefs.txt('অ্যাকশন', 'Actions') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                @for (closing of pager.paged(); track closing.id) {
                  <tr class="hover:bg-teal-50/40 dark:hover:bg-teal-500/10">
                    <td class="p-2.5 font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">{{ formatDate(closing.date) }}</td>
                    <td class="p-2.5 text-right font-mono">{{ closing.openingCash | number:'1.2-2' }}</td>
                    <td class="p-2.5 text-right font-mono">{{ closing.cashSales | number:'1.2-2' }}</td>
                    <td class="p-2.5 text-right font-mono">{{ closing.collections | number:'1.2-2' }}</td>
                    <td class="p-2.5 text-right font-mono">{{ closing.expenses | number:'1.2-2' }}</td>
                    <td class="p-2.5 text-right font-mono">{{ closing.expectedCash | number:'1.2-2' }}</td>
                    <td class="p-2.5 text-right font-mono font-bold">{{ closing.countedCash | number:'1.2-2' }}</td>
                    <td class="p-2.5 text-right font-mono font-bold" [class]="historyDiffClass(closing.difference)">
                      {{ closing.difference | number:'1.2-2' }}
                    </td>
                    <td class="p-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">{{ closing.closedBy }}</td>
                    <td class="p-2.5">
                      <div class="flex items-center justify-center gap-0.5">
                        <button (click)="printClosing(closing)" class="text-slate-500 hover:text-teal-700 dark:hover:text-teal-300 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" [title]="prefs.t('common.print')">
                          <mat-icon class="text-sm">print</mat-icon>
                        </button>
                        @if (isAdmin()) {
                          <button (click)="editClosing(closing)" class="text-amber-600 hover:text-amber-700 p-1 rounded hover:bg-amber-50 dark:hover:bg-amber-500/10" [title]="prefs.txt('সম্পাদনা', 'Edit')">
                            <mat-icon class="text-sm">edit</mat-icon>
                          </button>
                          <button (click)="askDelete(closing)" class="text-rose-600 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-500/10" [title]="prefs.txt('মুছুন', 'Delete')">
                            <mat-icon class="text-sm">delete</mat-icon>
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="10" class="p-8 text-center text-slate-400">{{ prefs.t('common.noData') }}</td></tr>
                }
              </tbody>
            </table>
          </div>

          <app-table-pagination
            [total]="pager.total()"
            [page]="pager.currentPage()"
            [pageSize]="pager.pageSize()"
            (pageChange)="pager.setPage($event)"
            (pageSizeChange)="pager.setPageSize($event)"
          />
        </div>

        <!-- Row-level print from history uses the same receipt, kept off-screen until printing. -->
        @if (printOverride()) {
          <div class="print-offscreen">
            <ng-container *ngTemplateOutlet="printCard" />
          </div>
        }
        }
      </div>

      <ng-template #printCard>
        <div id="printable-area" class="bg-white border border-slate-200 rounded-xl shadow-xs p-4 space-y-2 self-start">
          <div class="text-center border-b border-dashed border-slate-300 pb-2">
            <p class="font-black text-sm">{{ settings().businessNamePart1 }} {{ settings().businessNamePart2 }}</p>
            <p class="text-[10px] text-slate-500">{{ settings().address }}</p>
            @if (settings().mobile) {
              <p class="text-[10px] text-slate-500">{{ settings().mobile }}</p>
            }
            <p class="font-bold text-[11px] uppercase mt-1">{{ prefs.t('cash.closing') }}</p>
            <p class="text-[10px] text-slate-500">{{ formatDate(printData().date) }}</p>
          </div>
          <div class="space-y-1 font-mono">
            <div class="flex justify-between"><span>{{ prefs.t('cash.opening') }}</span><span>{{ printData().openingCash | number:'1.2-2' }}</span></div>
            <div class="flex justify-between"><span>{{ prefs.t('cash.cashSales') }}</span><span>{{ printData().cashSales | number:'1.2-2' }}</span></div>
            <div class="flex justify-between"><span>{{ prefs.txt('অন্যান্য আদায় (নিট)', 'Other receipts (net)') }}</span><span>{{ printData().collections | number:'1.2-2' }}</span></div>
            <div class="flex justify-between"><span>{{ prefs.txt('খরচ / বেতন / ভাড়া', 'Expenses / salary / rent') }}</span><span>{{ printData().expenses | number:'1.2-2' }}</span></div>
            <div class="flex justify-between border-t border-dashed border-slate-300 pt-1 font-black"><span>{{ prefs.t('cash.expected') }}</span><span>{{ printData().expectedCash | number:'1.2-2' }}</span></div>
            <div class="flex justify-between"><span>{{ prefs.t('cash.counted') }}</span><span>{{ printData().countedCash | number:'1.2-2' }}</span></div>
            <div class="flex justify-between font-black" [class.text-rose-600]="printData().difference < 0" [class.text-emerald-700]="printData().difference >= 0">
              <span>{{ prefs.t('cash.difference') }}</span><span>{{ printData().difference | number:'1.2-2' }}</span>
            </div>
            <div class="flex justify-between border-t border-dashed border-slate-300 pt-1 text-[11px]"><span>{{ prefs.txt('ব্যাংক / মোবাইল নিট', 'Bank / mobile net') }}</span><span>{{ printData().bankSales | number:'1.2-2' }}</span></div>
          </div>
          @if (printData().note) {
            <p class="text-[10px] text-slate-500">{{ prefs.t('common.note') }}: {{ printData().note }}</p>
          }
          <div class="text-[10px] flex justify-between pt-4 border-t border-slate-200">
            <span>{{ printData().closedBy || '—' }}</span>
            <span>{{ prefs.t('ledger.authorizedBy') }}</span>
          </div>
        </div>
      </ng-template>

      @if (pendingDelete(); as closing) {
        <app-passcode-modal
          [title]="prefs.txt('ক্যাশ ক্লোজিং মুছবেন?', 'Delete this cash closing?')"
          [message]="prefs.txt(formatDate(closing.date) + ' তারিখের ক্লোজিং মুছে ফেলা হবে। নিশ্চিত করতে Admin PIN দিন।', 'The closing of ' + formatDate(closing.date) + ' will be deleted. Enter the Admin PIN to confirm.')"
          (verified)="confirmDelete()"
          (close)="pendingDelete.set(null)"
        />
      }
    }
  `
})
export class CashBank implements OnInit, OnDestroy {
  readonly dataService = inject(DataService);
  readonly session = inject(SessionService);
  readonly prefs = inject(PreferencesService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly routeData = toSignal(this.route.data, { initialValue: {} as Record<string, unknown> });

  /** Each tab of Cash & Bank is its own routed page. */
  readonly cashView = computed<'summary' | 'daybook' | 'history'>(() => {
    const view = this.routeData()['cashView'];
    return view === 'daybook' || view === 'history' ? view : 'summary';
  });

  /** The live cash day: the shop's own calendar day, rolled at local midnight. */
  readonly date = signal<string>(localDateIso());
  /** null means "derive from the last closing"; a number is a deliberate manual entry. */
  private readonly openingOverride = signal<number | null>(null);
  readonly openingManual = computed(() => this.openingOverride() !== null);
  readonly countedCash = signal<number | null>(null);
  note = '';
  readonly savedMsg = signal('');
  readonly formError = signal('');
  readonly editing = signal(false);
  readonly pendingDelete = signal<CashClosing | null>(null);
  readonly printOverride = signal<CashClosing | null>(null);
  private readonly now = signal(Date.now());
  private clockTimer?: ReturnType<typeof setInterval>;
  private rolloverTimer?: ReturnType<typeof setTimeout>;

  readonly settings = computed(() => this.dataService.voucherSettings());
  readonly isAdmin = computed(() => this.session.currentUser()?.role === 'Admin');

  ngOnInit() {
    const requested = this.route.snapshot.queryParamMap.get('date');
    this.onDateChange(requested || this.date());
    if (typeof window === 'undefined') return;
    this.clockTimer = setInterval(() => this.now.set(Date.now()), 30_000);
    this.scheduleRollover();
  }

  ngOnDestroy() {
    if (this.clockTimer) clearInterval(this.clockTimer);
    if (this.rolloverTimer) clearTimeout(this.rolloverTimer);
  }

  /**
   * A 24-hour cash cycle: at local midnight the open page moves to the new day
   * and re-derives its opening cash. Dates an admin opened for review never move.
   */
  private scheduleRollover() {
    const now = new Date();
    const scheduledDay = localDateIso(now);
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    this.rolloverTimer = setTimeout(() => {
      this.now.set(Date.now());
      if (this.date() === scheduledDay) this.onDateChange(localDateIso());
      this.scheduleRollover();
    }, Math.max(1000, nextMidnight.getTime() - now.getTime()));
  }

  readonly nextResetMs = computed(() => {
    const now = new Date(this.now());
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    return Math.max(0, nextMidnight.getTime() - now.getTime());
  });

  readonly resetCountdown = computed(() => {
    const minutes = Math.ceil(this.nextResetMs() / 60_000);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return this.prefs.txt(`${h} ঘণ্টা ${m} মিনিট পরে`, `in ${h}h ${m}m`);
  });

  private savedClosing(day: string): CashClosing | undefined {
    return this.dataService.cashClosings().find(c => toIsoDate(c.date) === day);
  }

  /**
   * Opening cash is derived, not stored, for an unsaved day. Every read of the
   * underlying documents therefore updates the cards immediately — a sale typed
   * on another page, a sync from another device, or a midnight roll.
   */
  readonly openingCash = computed(() => {
    const override = this.openingOverride();
    if (override !== null) return override;
    const existing = this.savedClosing(this.date());
    if (existing) return round2(Number(existing.openingCash) || 0);
    return this.derivedOpening(this.date())?.amount ?? 0;
  });

  readonly openingSource = computed(() => {
    if (this.openingOverride() !== null) {
      return this.prefs.txt('ম্যানুয়াল ওপেনিং — আপনি লিখেছেন', 'Manual opening — entered by you');
    }
    if (this.savedClosing(this.date())) {
      return this.prefs.txt('সংরক্ষিত ক্লোজিং থেকে', 'From the saved closing');
    }
    const derived = this.derivedOpening(this.date());
    if (derived) return derived.source;
    return this.prefs.txt('প্রথম ক্লোজিং — হাতে থাকা ক্যাশ লিখুন', 'First closing — enter the cash on hand');
  });

  private derivedOpening(day: string): { amount: number; source: string } | null {
    if (!day) return null;
    const previous = this.previousClosing(day);
    if (!previous) return null;
    const gapDays = this.cashDaysBetween(toIsoDate(previous.date), day);
    const gapNet = gapDays.reduce((sum, gapDay) => sum + this.cashNet(gapDay), 0);
    return {
      amount: round2(Number(previous.countedCash) + gapNet),
      source: gapDays.length
        ? this.prefs.txt(`${this.formatDate(previous.date)} ক্লোজিং + ${gapDays.length} দিনের লেনদেন থেকে বহন`, `Carried from the ${this.formatDate(previous.date)} closing + ${gapDays.length} day(s) of movements`)
        : this.prefs.txt(`${this.formatDate(previous.date)} ক্লোজিং থেকে বহন`, `Carried from the ${this.formatDate(previous.date)} closing`)
    };
  }

  setOpeningCash(value: number | string) {
    const amount = typeof value === 'number' ? value : Number(value);
    this.openingOverride.set(round2(Number.isFinite(amount) ? amount : 0));
  }

  /** Drop the manual entry and follow the previous closing again. */
  useAutoOpening() {
    this.openingOverride.set(null);
    this.savedMsg.set('');
  }

  // ----------------------------------------------------------------
  // Day book: one row per real money movement, built from the documents
  // themselves so nothing (battery, salary, rent, advance) is missed.
  // ----------------------------------------------------------------
  private buildMovements(day: string): DayMovement[] {
    if (!day) return [];
    const rows: DayMovement[] = [];
    const add = (source: MovementSource, ref: string, label: string, mode: MoneyMode, direction: 'In' | 'Out', amount: number) => {
      const value = round2(amount);
      if (value <= 0) return;
      rows.push({
        key: `${source}:${ref}:${mode}:${direction}:${rows.length}`,
        source, ref, label: (label || '').trim(), mode, direction, amount: value
      });
    };

    for (const sale of this.dataService.sales()) {
      if (sale.status === 'Cancelled' || toIsoDate(sale.date) !== day) continue;
      const cash = typeof sale.cashReceived === 'number'
        ? sale.cashReceived
        : (sale.paymentStatus === 'Paid' ? Number(sale.paid) || 0 : 0);
      add('sale', sale.invoice, sale.customerName, 'Cash', 'In', cash);
      add('sale', sale.invoice, sale.customerName, this.saleBankMode(sale.paymentMode), 'In', Number(sale.bankPayment) || 0);
    }

    for (const purchase of this.dataService.purchases()) {
      if (toIsoDate(purchase.date) !== day) continue;
      add('purchase', purchase.invoice, purchase.supplierName, this.modeFromText(purchase.paymentMode), 'Out', Number(purchase.paid) || 0);
    }

    for (const payment of this.dataService.payments()) {
      if (toIsoDate(payment.date) !== day) continue;
      const supplier = payment.partyType === 'Supplier';
      add(supplier ? 'paymentOut' : 'paymentIn', payment.receiptNo, payment.partyName, payment.mode, supplier ? 'Out' : 'In', Number(payment.amount) || 0);
    }

    for (const voucher of this.dataService.batteryVouchers()) {
      if (voucher.source === 'sale-adjustment' || toIsoDate(voucher.date) !== day) continue;
      const purchase = voucher.type === 'purchase';
      const source: MovementSource = purchase ? 'batteryPurchase' : 'batterySale';
      const direction: 'In' | 'Out' = purchase ? 'Out' : 'In';
      add(source, voucher.voucherNo, voucher.partyName, 'Cash', direction, Number(voucher.cash) || 0);
      add(source, voucher.voucherNo, voucher.partyName, 'Bank', direction, Number(voucher.bank) || 0);
      add(source, voucher.voucherNo, voucher.partyName, voucher.mobileType === 'Nagad' ? 'Nagad' : 'bKash', direction, Number(voucher.mobile) || 0);
    }

    for (const expense of this.dataService.expenses()) {
      if (toIsoDate(expense.date) !== day) continue;
      add('expense', expense.category, expense.title, this.modeOfAccount(expense.accountId) ?? 'Cash', 'Out', Number(expense.amount) || 0);
    }

    for (const salary of this.dataService.salaryPayments()) {
      if (toIsoDate(salary.date) !== day) continue;
      add('salary', salary.voucherNo, salary.staffName, this.modeOfAccount(salary.accountId) ?? 'Cash', 'Out', Number(salary.netPay) || 0);
    }

    for (const rent of this.dataService.rentPayments()) {
      if (rent.status !== 'Paid' || toIsoDate(rent.date) !== day) continue;
      add('rent', rent.voucherNo, rent.title, this.modeOfAccount(rent.accountId) ?? 'Cash', 'Out', Number(rent.amount) || 0);
    }

    for (const advance of this.dataService.staffAdvances()) {
      if (advance.status === 'Cancelled' || toIsoDate(advance.date) !== day) continue;
      add('advance', advance.advanceNo, advance.staffName, this.modeOfAccount(advance.accountId) ?? advance.mode, 'Out', Number(advance.amount) || 0);
    }

    // Money a staff paid back against an advance comes in on its own date.
    for (const txn of this.dataService.walletTransactions()) {
      if (txn.source !== 'StaffAdvance' || txn.direction !== 'In' || toIsoDate(txn.date) !== day) continue;
      const mode = this.modeOfAccount(txn.accountId);
      if (mode) add('walletIn', txn.txnNo, txn.party || txn.note, mode, 'In', Number(txn.amount) || 0);
    }

    // Manual wallet rows only: everything else already came through its document
    // above, and counting both would double the drawer. Older battery rows carry
    // no source tag, so their voucher's posted ids are excluded explicitly.
    const batteryTxnIds = new Set(this.dataService.batteryVouchers().flatMap(v => v.walletTxnIds ?? []));
    for (const txn of this.dataService.walletTransactions()) {
      if (txn.source && txn.source !== 'Manual') continue;
      if (batteryTxnIds.has(txn.id)) continue;
      if (toIsoDate(txn.date) !== day) continue;
      const mode = this.modeOfAccount(txn.accountId);
      if (!mode) continue;
      add(txn.direction === 'In' ? 'walletIn' : 'walletOut', txn.txnNo, txn.party || txn.note, mode, txn.direction, Number(txn.amount) || 0);
    }

    return rows.sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || b.amount - a.amount);
  }

  readonly dayMovements = computed(() => this.buildMovements(toIsoDate(this.date())));

  readonly cashIn = computed(() => round2(this.dayMovements()
    .filter(m => m.direction === 'In' && m.mode === 'Cash')
    .reduce((sum, m) => sum + m.amount, 0)));

  readonly cashOut = computed(() => round2(this.dayMovements()
    .filter(m => m.direction === 'Out' && m.mode === 'Cash')
    .reduce((sum, m) => sum + m.amount, 0)));

  readonly cashInCount = computed(() => this.dayMovements().filter(m => m.direction === 'In' && m.mode === 'Cash').length);
  readonly cashOutCount = computed(() => this.dayMovements().filter(m => m.direction === 'Out' && m.mode === 'Cash').length);

  readonly totalIn = computed(() => round2(this.dayMovements()
    .filter(m => m.direction === 'In')
    .reduce((sum, m) => sum + m.amount, 0)));

  readonly totalOut = computed(() => round2(this.dayMovements()
    .filter(m => m.direction === 'Out')
    .reduce((sum, m) => sum + m.amount, 0)));

  private cashBySource(...sources: MovementSource[]): number {
    return round2(this.dayMovements()
      .filter(m => m.mode === 'Cash' && sources.includes(m.source))
      .reduce((sum, m) => sum + (m.direction === 'In' ? m.amount : -m.amount), 0));
  }

  readonly cashSales = computed(() => this.cashBySource('sale'));
  readonly duesCashIn = computed(() => this.cashBySource('paymentIn'));
  readonly batteryCashIn = computed(() => this.cashBySource('batterySale'));
  readonly manualCashIn = computed(() => this.cashBySource('walletIn'));
  readonly otherCashIn = computed(() => round2(this.duesCashIn() + this.batteryCashIn() + this.manualCashIn()));
  readonly purchaseCashOut = computed(() => round2(-this.cashBySource('purchase', 'paymentOut')));
  readonly batteryCashOut = computed(() => round2(-this.cashBySource('batteryPurchase')));
  readonly expensesForDate = computed(() => round2(-this.cashBySource('expense', 'salary', 'rent', 'advance', 'walletOut')));

  /** Kept for the closing row: other receipts net of purchase / battery pay-outs. */
  readonly collectionsNet = computed(() => round2(this.otherCashIn() - this.purchaseCashOut() - this.batteryCashOut()));

  readonly modeNets = computed(() => MODE_ORDER
    .filter(mode => mode !== 'Cash')
    .map(mode => ({
      mode,
      label: this.modeLabel(mode),
      net: round2(this.dayMovements()
        .filter(m => m.mode === mode)
        .reduce((sum, m) => sum + (m.direction === 'In' ? m.amount : -m.amount), 0))
    })));

  readonly digitalNet = computed(() => round2(this.modeNets().reduce((sum, m) => sum + m.net, 0)));

  readonly expectedCash = computed(() => round2(this.openingCash() + this.cashIn() - this.cashOut()));

  readonly difference = computed<number | null>(() => {
    const counted = this.countedCash();
    if (counted === null) return null;
    return round2(Number(counted) - this.expectedCash());
  });

  readonly sortedClosings = computed(() =>
    [...this.dataService.cashClosings()].sort((a, b) => (toIsoDate(b.date) || '').localeCompare(toIsoDate(a.date) || ''))
  );

  readonly pager = createPager(() => this.sortedClosings());
  readonly dayPager = createPager(() => this.dayMovements());

  readonly printData = computed<CashClosing>(() => this.printOverride() ?? {
    id: 0,
    date: this.date(),
    openingCash: this.openingCash(),
    cashSales: this.cashSales(),
    bankSales: this.digitalNet(),
    collections: this.collectionsNet(),
    expenses: this.expensesForDate(),
    expectedCash: this.expectedCash(),
    countedCash: Number(this.countedCash()) || 0,
    difference: this.difference() ?? 0,
    note: this.note,
    closedBy: this.session.currentUser()?.name || '—',
    closedAt: new Date().toISOString()
  });

  // ----------------------------------------------------------------
  // Daily closing
  // ----------------------------------------------------------------
  onDateChange(value: string) {
    // Clearing the field must not blank the whole day; the mask restores its
    // last value on blur, so the page simply keeps the day it was showing.
    const day = toIsoDate(value);
    if (!day) return;
    this.date.set(day);
    this.printOverride.set(null);
    this.savedMsg.set('');
    this.formError.set('');

    const existing = this.savedClosing(day);
    if (existing) {
      // Editing a saved closing shows exactly what was stored, including any
      // manual opening the admin used that day.
      this.openingOverride.set(round2(Number(existing.openingCash) || 0));
      this.countedCash.set(Number(existing.countedCash) || 0);
      this.note = existing.note || '';
      this.editing.set(true);
      return;
    }

    this.openingOverride.set(null);
    this.countedCash.set(null);
    this.note = '';
    this.editing.set(false);
  }

  private cashNet(day: string): number {
    return round2(this.buildMovements(day)
      .filter(m => m.mode === 'Cash')
      .reduce((sum, m) => sum + (m.direction === 'In' ? m.amount : -m.amount), 0));
  }

  private previousClosing(day: string): CashClosing | undefined {
    return this.sortedClosings().find(c => (toIsoDate(c.date) || '') < day);
  }

  /** Days after the last closing that already had cash movement but were never closed. */
  private cashDaysBetween(from: string, to: string): string[] {
    if (!from || !to) return [];
    const days = new Set<string>();
    const collect = (value: string) => {
      const iso = toIsoDate(value);
      if (iso && iso > from && iso < to) days.add(iso);
    };
    this.dataService.sales().forEach(x => { if (x.status !== 'Cancelled') collect(x.date); });
    this.dataService.purchases().forEach(x => collect(x.date));
    this.dataService.payments().forEach(x => collect(x.date));
    this.dataService.batteryVouchers().forEach(x => { if (x.source !== 'sale-adjustment') collect(x.date); });
    this.dataService.expenses().forEach(x => collect(x.date));
    this.dataService.salaryPayments().forEach(x => collect(x.date));
    this.dataService.rentPayments().forEach(x => { if (x.status === 'Paid') collect(x.date); });
    this.dataService.staffAdvances().forEach(x => { if (x.status !== 'Cancelled') collect(x.date); });
    this.dataService.walletTransactions().forEach(x => {
      if (!x.source || x.source === 'Manual' || (x.source === 'StaffAdvance' && x.direction === 'In')) collect(x.date);
    });
    return [...days].sort();
  }

  differenceLabel(): string {
    const diff = this.difference();
    if (diff === null) return this.prefs.txt('গণনা করুন', 'Enter count');
    if (Math.abs(diff) < 0.005) return this.prefs.t('cash.balanced');
    return diff < 0 ? this.prefs.t('cash.short') : this.prefs.t('cash.excess');
  }

  differenceTextClass(): string {
    const diff = this.difference();
    if (diff === null) return 'text-slate-500';
    if (Math.abs(diff) < 0.005) return 'text-emerald-700 dark:text-emerald-400';
    return diff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400';
  }

  historyDiffClass(diff: number): string {
    return diff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400';
  }

  saveClosing() {
    if (!this.date()) {
      this.formError.set(this.prefs.txt('তারিখ লিখুন', 'Enter a date'));
      return;
    }
    const counted = this.countedCash();
    if (counted === null || Number(counted) < 0) {
      this.formError.set(this.prefs.t('ledger.invalidAmount'));
      return;
    }
    this.formError.set('');
    const closing = this.dataService.saveCashClosing({
      date: this.date(),
      openingCash: this.openingCash(),
      cashSales: this.cashSales(),
      bankSales: this.digitalNet(),
      collections: this.collectionsNet(),
      expenses: this.expensesForDate(),
      expectedCash: this.expectedCash(),
      countedCash: Number(counted) || 0,
      difference: this.difference() ?? 0,
      note: this.note,
      closedBy: this.session.currentUser()?.name || 'Admin'
    });
    this.session.log('Cash Closing', `${closing.date} — expected ${closing.expectedCash.toFixed(2)}, counted ${closing.countedCash.toFixed(2)}`);
    this.savedMsg.set(this.prefs.t('cash.saved'));
    this.editing.set(true);
    this.printOverride.set(null);
  }

  // ----------------------------------------------------------------
  // Admin: edit / delete a saved closing
  // ----------------------------------------------------------------
  editClosing(closing: CashClosing) {
    if (!this.isAdmin()) return;
    const day = toIsoDate(closing.date);
    this.notify.success(this.prefs.txt('ক্লোজিংটি সম্পাদনার জন্য ফর্মে লোড হয়েছে।', 'Closing loaded into the form for editing.'));
    if (this.cashView() !== 'summary') {
      void this.router.navigate(['/cash-bank'], { queryParams: { date: day } });
      return;
    }
    this.onDateChange(day);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  askDelete(closing: CashClosing) {
    if (!this.isAdmin()) return;
    this.pendingDelete.set(closing);
  }

  confirmDelete() {
    const closing = this.pendingDelete();
    if (!closing) return;
    this.dataService.deleteCashClosing(closing.id);
    this.pendingDelete.set(null);
    this.session.log('Delete', `Cash closing ${closing.date} deleted`);
    this.notify.success(this.prefs.txt('ক্যাশ ক্লোজিং মুছে ফেলা হয়েছে।', 'Cash closing deleted.'));
    if (toIsoDate(closing.date) === this.date()) this.onDateChange(this.date());
  }

  // ----------------------------------------------------------------
  // Print / export
  // ----------------------------------------------------------------
  printClosing(closing: CashClosing) {
    this.printOverride.set(closing);
    setTimeout(() => window.print(), 80);
  }

  printPage() {
    this.printOverride.set(null);
    this.session.log('Print', `Cash closing report printed for ${this.date()}`);
    setTimeout(() => window.print(), 80);
  }

  exportExcel() {
    const dayRows = this.dayMovements().map((m, index) => ({
      SL: index + 1,
      Date: this.formatDate(this.date()),
      Source: this.sourceLabel(m.source),
      Reference: m.ref,
      Description: m.label,
      Mode: this.modeLabel(m.mode),
      Direction: m.direction,
      Amount: m.amount
    }));
    const closingRows = this.sortedClosings().map(c => ({
      Date: this.formatDate(c.date),
      Opening: c.openingCash,
      CashSales: c.cashSales,
      OtherReceipts: c.collections,
      CashExpenses: c.expenses,
      Expected: c.expectedCash,
      Counted: c.countedCash,
      Difference: c.difference,
      BankMobileNet: c.bankSales,
      Note: c.note,
      ClosedBy: c.closedBy
    }));
    void downloadWorkbook(`Cash_Closing_${localDateIso()}.xlsx`, [
      { name: 'Day Book', rows: dayRows.length ? dayRows : [{ SL: 1, Date: this.formatDate(this.date()), Note: 'No movement' }] },
      { name: 'Cash Closings', rows: closingRows.length ? closingRows : [{ Date: '—' }] }
    ]).then(() => this.session.log('Export', 'Cash day book and closing history exported to Excel'))
      .catch(error => this.notify.error(error instanceof Error ? error.message : String(error), this.prefs.txt('এক্সপোর্ট ব্যর্থ', 'Export failed')));
  }

  // ----------------------------------------------------------------
  // Labels and helpers
  // ----------------------------------------------------------------
  sourceLabel(source: MovementSource): string {
    switch (source) {
      case 'sale': return this.prefs.txt('বিক্রয়', 'Sale');
      case 'paymentIn': return this.prefs.txt('বাকি আদায়', 'Due received');
      case 'batterySale': return this.prefs.txt('ব্যাটারি বিক্রয়', 'Battery sale');
      case 'walletIn': return this.prefs.txt('ওয়ালেট জমা', 'Wallet deposit');
      case 'purchase': return this.prefs.txt('ক্রয়', 'Purchase');
      case 'paymentOut': return this.prefs.txt('সাপ্লায়ার পেমেন্ট', 'Supplier payment');
      case 'batteryPurchase': return this.prefs.txt('ব্যাটারি ক্রয়', 'Battery purchase');
      case 'expense': return this.prefs.txt('খরচ', 'Expense');
      case 'salary': return this.prefs.txt('বেতন', 'Salary');
      case 'rent': return this.prefs.txt('দোকান ভাড়া', 'Shop rent');
      case 'advance': return this.prefs.txt('স্টাফ অগ্রিম', 'Staff advance');
      case 'walletOut': return this.prefs.txt('ওয়ালেট খরচ', 'Wallet withdrawal');
      default: return '—';
    }
  }

  modeLabel(mode: MoneyMode): string {
    const label = MODE_LABELS[mode];
    return label ? this.prefs.txt(label.bn, label.en) : mode;
  }

  modeBadgeClass(mode: MoneyMode): string {
    return MODE_BADGES[mode] || MODE_BADGES.Cash;
  }

  private modeOfAccount(accountId?: number): MoneyMode | null {
    if (!accountId) return null;
    const account = this.dataService.walletAccounts().find(a => a.id === accountId);
    if (!account) return null;
    return this.modeFromText(account.type);
  }

  private modeFromText(value?: string): MoneyMode {
    const text = (value || '').trim();
    if (text === 'bKash') return 'bKash';
    if (text === 'Nagad') return 'Nagad';
    if (text === 'Rocket') return 'Rocket';
    if (text === 'Bank' || text === 'Card') return 'Bank';
    return 'Cash';
  }

  /** A non-cash sale leg is mobile only when the recorded mode says so; otherwise bank. */
  private saleBankMode(mode?: string): MoneyMode {
    const text = (mode || '').trim();
    if (text === 'bKash') return 'bKash';
    if (text === 'Nagad') return 'Nagad';
    return 'Bank';
  }

  formatDate(value: string): string {
    const iso = toIsoDate(value);
    if (!iso) return value || '-';
    const [year, month, day] = iso.split('-');
    return `${day}-${month}-${year}`;
  }

}
