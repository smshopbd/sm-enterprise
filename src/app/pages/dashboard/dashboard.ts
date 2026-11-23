import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DataService } from '../../services/data';
import {
  hasPurchaseRole, hasSalesRole, partyPhones, promiseRemaining, purchaseAccountOf, salesAccountOf, Party
} from '../../services/data';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { InvoiceModal } from '../../components/invoice-modal/invoice-modal';
import { DateRangeBar } from '../../components/date-range-bar/date-range-bar';
import { PartyLedger } from '../../components/party-ledger/party-ledger';
import { PartyReminderDialog } from '../../components/party-reminder-dialog/party-reminder-dialog';
import { Sale } from '../../services/data';
import { dmyFromIso, localDateIso } from '../../utils/local-date';
import { saleLineBaseQty } from '../../utils/product-units';
import {
  DATE_RANGE_PRESETS,
  DateRange,
  activeDateRangeKind,
  inDateRange,
  previousDateRange,
  rangeDayCount,
  toIsoDate
} from '../../utils/date-range';

interface TrendInfo {
  icon: string;
  label: string;
  short: string;
  className: string;
}

interface StatSub {
  label: string;
  value: number;
  unit: 'TK' | 'pcs';
  tone: string;
}

interface StatCard {
  key: string;
  icon: string;
  tone: string;
  label: string;
  value: number;
  href: string;
  trend?: TrendInfo | null;
  subs: StatSub[];
}

interface DayBar {
  iso: string;
  label: string;
  cash: number;
  due: number;
  profit: number;
  total: number;
  totalPct: number;
  cashSharePct: number;
  dueSharePct: number;
  isToday: boolean;
}

interface PaymentMethodRow {
  label: string;
  amount: number;
  percent: number;
  color: string;
}

type ReminderBucket = 'overdue' | 'today' | 'tomorrow' | 'dayafter' | 'later';

interface ReminderRow {
  id: number;
  name: string;
  typeLabel: string;
  companyName: string;
  phone: string;
  due: number;
  promised: number;
  received: number;
  remaining: number;
  date: string;
  dateLabel: string;
  daysLate: number;
  bucket: ReminderBucket;
  statusLabel: string;
  statusClass: string;
  note: string;
  noteLabel: string;
}

interface StockWatchRow {
  id: number;
  name: string;
  category: string;
  stock: number;
  unit: string;
  min: number;
  rank: number;
  ratio: number;
  badge: string;
  badgeClass: string;
  thumbClass: string;
  icon: string;
}

interface QuickAction {
  label: string;
  icon: string;
  href: string;
  tone: string;
}

interface AlertTile {
  key: string;
  label: string;
  count: number;
  icon: string;
  tone: string;
  href: string;
}

const PAYMENT_MODES: { mode: 'Cash' | 'Bank' | 'bKash' | 'Nagad'; label: string; color: string }[] = [
  { mode: 'Cash', label: 'Cash', color: '#10b981' },
  { mode: 'Bank', label: 'Bank', color: '#0ea5e9' },
  { mode: 'bKash', label: 'bKash', color: '#f43f5e' },
  { mode: 'Nagad', label: 'Nagad', color: '#f59e0b' }
];

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_BN = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগ', 'সেপ্ট', 'অক্টো', 'নভে', 'ডিসে'];

const STOCK_BADGE = [
  'bg-rose-50 text-rose-600 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25',
  'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25',
  'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25',
  'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25'
];

const STOCK_THUMB = [
  'bg-rose-50 text-rose-500 dark:bg-rose-500/10 dark:text-rose-300',
  'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
  'bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300'
];

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, MatIconModule, InvoiceModal, DateRangeBar, PartyLedger, PartyReminderDialog],
  template: `
    <div class="space-y-5">

      <!-- Hero banner -->
      <section class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950 sm:p-5">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

        <div class="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">space_dashboard</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                {{ prefs.txt('ড্যাশবোর্ড', 'Dashboard') }}
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                {{ prefs.txt('সারসংক্ষেপ', 'Overview') }}
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">
                {{ prefs.txt('স্বাগতম', 'Welcome') }}, {{ session.currentUser()?.name || 'Admin' }}
              </h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('আজকের ব্যবসার চিত্র এক নজরে', 'Today’s business at a glance') }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold backdrop-blur-sm">
              <mat-icon class="text-[14px]">calendar_month</mat-icon>{{ todayFullLabel() }}
            </span>
            <a routerLink="/product-manager/products"
              class="inline-flex items-center gap-1.5 rounded-lg border border-amber-200/40 bg-amber-400/20 px-3 py-1.5 text-[11px] font-bold text-amber-50 backdrop-blur-sm transition hover:bg-amber-400/30">
              <mat-icon class="text-[14px]">priority_high</mat-icon>{{ dataService.lowStockProducts().length }} {{ prefs.txt('লো স্টক', 'low stock') }}
            </a>
            <a routerLink="/pos"
              class="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition hover:bg-teal-50">
              <mat-icon class="text-[16px]">point_of_sale</mat-icon>{{ prefs.txt('POS খুলুন', 'Open POS') }}
            </a>
          </div>
        </div>
      </section>

      <app-date-range-bar [from]="periodRange().from" [to]="periodRange().to" (rangeChange)="onPeriodChange($event)" />

      <!-- Stat cards -->
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 sm:gap-4">
        @for (card of statCards(); track card.key) {
          <a [routerLink]="card.href"
            class="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md dark:hover:border-teal-500/40">
            <div class="flex items-start justify-between gap-2">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" [class]="toneTile(card.tone)">
                <mat-icon class="text-[18px]">{{ card.icon }}</mat-icon>
              </span>
              @if (card.trend; as trend) {
                <span class="inline-flex max-w-[7.5rem] items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold" [class]="trendChip(trend)" [attr.title]="trend.label">
                  <mat-icon class="shrink-0 text-[12px]">{{ trend.icon }}</mat-icon><span class="truncate">{{ trend.short }}</span>
                </span>
              }
            </div>
            <div class="min-w-0">
              <p class="truncate text-[11px] font-semibold text-slate-500" [attr.title]="card.label">{{ card.label }}</p>
              <p class="mt-0.5 font-mono font-black leading-tight" [class]="valueClass(card.value)"
                [attr.title]="(card.value | number:'1.2-2') + ' TK'">
                {{ card.value | number:'1.2-2' }} <span class="text-[10px] font-bold text-slate-400">TK</span>
              </p>
            </div>
            @if (card.subs.length) {
              <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold">
                @for (sub of card.subs; track sub.label) {
                  <span class="inline-flex items-center gap-1 text-slate-400">
                    {{ sub.label }}
                    <span class="font-mono" [class]="sub.tone">{{ sub.value | number:'1.0-2' }} {{ sub.unit === 'TK' ? 'TK' : prefs.txt('টি', 'pcs') }}</span>
                  </span>
                }
              </div>
            }
          </a>
        }
      </div>

      <!-- Due collection reminders -->
      <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs dark:border-slate-700">
        <div class="relative overflow-hidden bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 px-4 py-3 text-white dark:from-slate-900 dark:via-slate-900 dark:to-teal-900">
          <div class="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl"></div>
          <div class="relative flex flex-wrap items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
                <mat-icon class="text-lg">notifications_active</mat-icon>
              </span>
              <div class="min-w-0">
                <h2 class="truncate text-sm font-bold leading-tight">{{ prefs.txt('বকেয়া আদায়ের রিমাইন্ডার', 'Due collection reminders') }}</h2>
                <p class="truncate text-[10px] text-teal-50/85">{{ prefs.txt('প্রতিশ্রুত তারিখ অনুযায়ী নিজে থেকেই আপডেট হয়', 'Updates itself as the dates move') }}</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-[10px] font-semibold">
              <span class="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1">
                {{ prefs.txt('মোট বকেয়া', 'Total due') }} <span class="font-mono text-[11px] font-black">{{ reminderTotals().due | number:'1.2-2' }} TK</span>
              </span>
              <span class="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1">
                {{ prefs.txt('এই তারিখে দেওয়ার কথা', 'Promised') }} <span class="font-mono text-[11px] font-black">{{ reminderTotals().promised | number:'1.2-2' }} TK</span>
              </span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 border-b border-slate-200 p-3 sm:grid-cols-4 dark:border-slate-700">
          @for (tile of reminderTiles(); track tile.key) {
            <button type="button" (click)="toggleReminderFilter(tile.key)"
              class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm cursor-pointer"
              [class]="reminderFilter() === tile.key ? tile.activeClass : tile.idleClass">
              <span class="min-w-0">
                <span class="block truncate text-[10px] font-bold">{{ tile.label }}</span>
                <span class="block truncate font-mono text-[9px] opacity-80">{{ tile.promised | number:'1.0-2' }} TK</span>
              </span>
              <span class="shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-black" [class]="tile.badgeClass">{{ tile.count }}</span>
            </button>
          }
        </div>

        <div class="flex flex-col gap-2 border-b border-slate-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
          <div class="flex flex-wrap gap-1">
            @for (seg of reminderSegments(); track seg.key) {
              <button type="button" (click)="reminderFilter.set(seg.key)"
                class="rounded-full px-2.5 py-1 text-[10px] font-bold transition cursor-pointer"
                [class]="reminderFilter() === seg.key
                  ? 'bg-teal-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'">
                {{ seg.label }} <span class="font-mono">({{ seg.count }})</span>
              </button>
            }
          </div>
          <label class="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 sm:w-56">
            <mat-icon class="text-[14px]">search</mat-icon>
            <input [value]="reminderSearch()" (input)="reminderSearch.set($any($event.target).value)"
              [placeholder]="prefs.txt('কাস্টমার / ফোন খুঁজুন', 'Search customer / phone')"
              class="w-full min-w-0 border-0 bg-transparent p-0 text-[11px] font-semibold text-slate-700 focus:outline-none dark:text-slate-100" />
          </label>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[860px] text-left text-xs">
            <thead class="bg-slate-50 text-[9px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th class="px-3 py-2">#</th>
                <th class="px-3 py-2">{{ prefs.txt('কাস্টমার / ডিলার', 'Customer / dealer') }}</th>
                <th class="px-3 py-2 text-right">{{ prefs.txt('মোট বকেয়া', 'Total due') }}</th>
                <th class="px-3 py-2 text-right">{{ prefs.txt('দেওয়ার কথা', 'Promised') }}</th>
                <th class="px-3 py-2">{{ prefs.txt('প্রতিশ্রুত তারিখ', 'Promise date') }}</th>
                <th class="px-3 py-2">{{ prefs.txt('অবস্থা', 'Status') }}</th>
                <th class="px-3 py-2 text-right">{{ prefs.txt('করনীয়', 'Action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              @for (row of reminderVisibleRows(); track row.id; let i = $index) {
                <tr class="cursor-pointer transition hover:bg-teal-50/50 dark:hover:bg-teal-500/5"
                  [class]="focusedReminder()?.id === row.id ? 'bg-teal-50/70 dark:bg-teal-500/10' : ''"
                  (click)="reminderFocus.set(row.id)">
                  <td class="px-3 py-2 font-mono text-[10px] text-slate-400">{{ i + 1 }}</td>
                  <td class="px-3 py-2">
                    <p class="truncate font-bold text-slate-800 dark:text-slate-100">{{ row.name }}</p>
                    <p class="truncate text-[10px] text-slate-400">
                      {{ row.typeLabel }}@if (row.companyName) {<span> · {{ row.companyName }}</span>}
                    </p>
                  </td>
                  <td class="px-3 py-2 text-right font-mono font-bold text-rose-600 dark:text-rose-300">{{ row.due | number:'1.2-2' }}</td>
                  <td class="px-3 py-2 text-right font-mono font-bold text-teal-700 dark:text-teal-300">
                    {{ row.promised | number:'1.2-2' }}
                    @if (row.received > 0) {
                      <span class="block text-[9px] font-semibold text-amber-600 dark:text-amber-300">
                        {{ prefs.txt('বাকি', 'left') }} {{ row.remaining | number:'1.2-2' }}
                      </span>
                    }
                  </td>
                  <td class="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">{{ row.dateLabel }}</td>
                  <td class="px-3 py-2">
                    <span class="inline-flex rounded-full px-2 py-0.5 text-[9px] font-black ring-1" [class]="row.statusClass">{{ row.statusLabel }}</span>
                  </td>
                  <td class="px-3 py-2">
                    <div class="flex items-center justify-end gap-1" (click)="$event.stopPropagation()">
                      @if (row.phone) {
                        <a [href]="'tel:' + row.phone" [attr.title]="row.phone"
                          class="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-sky-600 hover:bg-sky-50 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-300">
                          <mat-icon class="text-[14px]">call</mat-icon>
                        </a>
                      }
                      <button type="button" (click)="openReminderCollect(row)"
                        class="flex items-center gap-0.5 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700 cursor-pointer">
                        <mat-icon class="text-[12px]">payments</mat-icon>{{ prefs.txt('আদায়', 'Collect') }}
                      </button>
                      <button type="button" (click)="openReminderDate(row)"
                        class="flex items-center gap-0.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 cursor-pointer">
                        <mat-icon class="text-[12px]">event_repeat</mat-icon>{{ prefs.txt('তারিখ বদল', 'Change date') }}
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="px-3 py-8 text-center">
                    <mat-icon class="text-3xl text-slate-300 dark:text-slate-600">event_available</mat-icon>
                    <p class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-300">{{ prefs.txt('কোনো সক্রিয় প্রতিশ্রুতি নেই', 'No active promises') }}</p>
                    <p class="mt-0.5 text-[10px] text-slate-400">{{ prefs.txt('পার্টিস প্রোফাইলে “রিমাইন্ডার” চেপে প্রতিশ্রুত তারিখ ও টাকার অঙ্ক দিন।', 'Open a party profile and set a promise date and amount from “Reminder”.') }}</p>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (focusedReminder(); as focus) {
          <div class="border-t border-amber-200/70 bg-amber-50/70 px-3 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">
                <mat-icon class="text-[13px]">sticky_note_2</mat-icon> {{ prefs.txt('ফলোআপ নোট', 'Follow-up note') }} · {{ focus.name }}
              </p>
              <button type="button" (click)="openReminderDate(focus)"
                class="flex items-center gap-0.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-50 dark:border-amber-500/30 dark:bg-slate-800 dark:text-amber-200 cursor-pointer">
                <mat-icon class="text-[12px]">event</mat-icon>{{ prefs.txt('নতুন প্রতিশ্রুত তারিখ', 'New promise date') }}
              </button>
            </div>
            <p class="mt-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              {{ focus.note || prefs.txt('এখনো কোনো যোগাযোগের নোট নেই।', 'No contact note yet.') }}
            </p>
            @if (focus.noteLabel) {
              <p class="mt-0.5 text-[9px] font-semibold text-slate-400">{{ prefs.txt('সর্বশেষ যোগাযোগ', 'Last contact') }} · {{ focus.noteLabel }}</p>
            }
          </div>
        }

        <div class="flex items-center gap-1.5 border-t border-emerald-200/70 bg-emerald-50/70 px-3 py-1.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-300">
          <mat-icon class="text-[13px]">info</mat-icon>
          {{ prefs.txt('আদায় লিখলে বকেয়া আপডেট হবে • সম্পূর্ণ আদায় হলে সক্রিয় তালিকা থেকে সরবে • শুধু তারিখ বদলালে টাকার অঙ্ক বদলাবে না', 'Collecting updates the due • a fully collected promise leaves the active list • changing only the date never changes any amount') }}
        </div>
      </section>

      <!-- Chart + business summary -->
      <div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <!-- Sales Summary Bar Chart -->
        <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs xl:col-span-2">
          <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-bold text-slate-800">{{ chartTitle() }}</h3>
              <p class="mt-0.5 text-[11px] text-slate-400">{{ prefs.txt('নগদ ও বাকি বিক্রয়ের তুলনা, রেখা = আনুমানিক লাভ', 'Cash vs due sales, line = estimated profit') }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-3 text-[10px] font-semibold">
              <span class="flex items-center gap-1 text-teal-600 dark:text-teal-300"><span class="h-2 w-2 rounded-full bg-teal-500"></span>{{ prefs.txt('নগদ', 'Cash') }} {{ shortMoney(chartCash()) }}</span>
              <span class="flex items-center gap-1 text-rose-500 dark:text-rose-300"><span class="h-2 w-2 rounded-full bg-rose-300"></span>{{ prefs.txt('বাকি', 'Due') }} {{ shortMoney(chartDue()) }}</span>
              <span class="flex items-center gap-1 text-emerald-600 dark:text-emerald-300"><span class="h-0.5 w-4 rounded bg-emerald-500"></span>{{ prefs.txt('লাভ', 'Profit') }} {{ shortMoney(chartProfit()) }}</span>
            </div>
          </div>

          <div class="flex gap-2">
            <div class="flex h-48 w-9 shrink-0 flex-col justify-between pb-5 text-right font-mono text-[9px] leading-none text-slate-400">
              <span>{{ shortMoney(chartMax()) }}</span>
              <span>{{ shortMoney(chartMax() / 2) }}</span>
              <span>0</span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="relative h-48 overflow-x-auto">
                <div class="relative h-full" [style.min-width.px]="salesChart().length * 18">
                  <div class="absolute inset-x-0 bottom-5 top-0">
                    <div class="absolute inset-x-0 top-0 border-t border-dashed border-slate-200 dark:border-slate-700"></div>
                    <div class="absolute inset-x-0 top-1/2 border-t border-dashed border-slate-100 dark:border-slate-800"></div>
                    <div class="absolute inset-x-0 bottom-0 border-t border-slate-200 dark:border-slate-700"></div>

                    <div class="relative flex h-full items-end gap-1 px-1">
                      @for (bar of salesChart(); track bar.iso; let i = $index) {
                        <div class="relative flex h-full min-w-[12px] max-w-[44px] flex-1 flex-col items-center justify-end">
                          <div class="flex w-full flex-col justify-end overflow-hidden rounded-t-md transition-opacity hover:opacity-85"
                            [style.height.%]="bar.totalPct"
                            [attr.title]="bar.label + ' · ' + prefs.txt('নগদ', 'Cash') + ' ' + (bar.cash | number:'1.2-2') + ' TK · ' + prefs.txt('বাকি', 'Due') + ' ' + (bar.due | number:'1.2-2') + ' TK · ' + prefs.txt('লাভ', 'Profit') + ' ' + (bar.profit | number:'1.2-2') + ' TK'">
                            <div class="w-full bg-gradient-to-b from-rose-300 to-rose-400 dark:from-rose-400/80 dark:to-rose-500/70" [style.height.%]="bar.dueSharePct"></div>
                            <div class="w-full bg-gradient-to-b from-teal-400 to-teal-600" [class.rounded-t]="bar.due <= 0" [style.height.%]="bar.cashSharePct"></div>
                          </div>
                          <span class="absolute -bottom-4 whitespace-nowrap text-[8.5px]"
                            [class]="bar.isToday ? 'font-bold text-emerald-600 dark:text-emerald-300' : 'text-slate-400'">{{ showBarLabel(i) ? bar.label : '' }}</span>
                        </div>
                      }
                    </div>

                    @if (chartHasProfit()) {
                      <svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                        <polyline [attr.points]="chartLinePoints()" fill="none" stroke="#059669" stroke-width="2"
                          stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>
                      </svg>
                    }
                  </div>

                  @if (!chartTotal()) {
                    <p class="absolute inset-0 flex items-center justify-center pb-6 text-[11px] font-semibold text-slate-400">
                      {{ chartEmptyLabel() }}
                    </p>
                  }
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Business summary -->
        <div class="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="text-sm font-bold text-slate-800">{{ prefs.txt('ব্যবসার সারসংক্ষেপ', 'Business summary') }}</h3>
            <span class="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{{ periodLabel() }}</span>
          </div>

          <dl class="flex-1 space-y-2.5 text-xs">
            <div class="flex items-center justify-between border-b border-dashed border-slate-200 pb-2 dark:border-slate-700">
              <dt class="flex items-center gap-1.5 text-slate-500"><mat-icon class="text-[15px] text-teal-500">sell</mat-icon>{{ prefs.txt('মোট বিক্রয়', 'Total sales') }}</dt>
              <dd class="font-mono font-bold text-slate-800">{{ summary().sales | number:'1.2-2' }} TK</dd>
            </div>
            <div class="flex items-center justify-between border-b border-dashed border-slate-200 pb-2 dark:border-slate-700">
              <dt class="flex items-center gap-1.5 text-slate-500"><mat-icon class="text-[15px] text-sky-500">shopping_cart</mat-icon>{{ prefs.txt('মোট ক্রয়', 'Total purchases') }}</dt>
              <dd class="font-mono font-bold text-slate-800">{{ summary().purchases | number:'1.2-2' }} TK</dd>
            </div>
            <div class="flex items-center justify-between border-b border-dashed border-slate-200 pb-2 dark:border-slate-700">
              <dt class="flex items-center gap-1.5 text-slate-500">
                <mat-icon class="text-[15px] text-emerald-500">trending_up</mat-icon>{{ prefs.txt('আনুমানিক লাভ', 'Estimated profit') }}
                <span class="rounded bg-emerald-50 px-1.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{{ summary().margin }}%</span>
              </dt>
              <dd class="font-mono font-bold text-emerald-600 dark:text-emerald-300">{{ summary().profit | number:'1.2-2' }} TK</dd>
            </div>
            <div class="flex items-center justify-between border-b border-dashed border-slate-200 pb-2 dark:border-slate-700">
              <dt class="flex items-center gap-1.5 text-slate-500"><mat-icon class="text-[15px] text-amber-500">savings</mat-icon>{{ prefs.txt('বাকি আদায়', 'Due collection') }}</dt>
              <dd class="font-mono font-bold text-slate-800">{{ summary().collection | number:'1.2-2' }} TK</dd>
            </div>
            <div class="flex items-center justify-between pb-1">
              <dt class="flex items-center gap-1.5 text-slate-500"><mat-icon class="text-[15px] text-rose-500">receipt_long</mat-icon>{{ prefs.txt('মোট খরচ', 'Total expense') }}</dt>
              <dd class="font-mono font-bold text-rose-600 dark:text-rose-300">{{ summary().expense | number:'1.2-2' }} TK</dd>
            </div>
          </dl>

          <div class="mt-3 rounded-xl bg-gradient-to-r from-teal-700 to-teal-600 px-4 py-3 text-white shadow-sm">
            <p class="text-[10px] font-bold uppercase tracking-wider text-emerald-50/90">{{ prefs.txt('নিট ক্যাশ', 'Net cash') }}</p>
            <p class="mt-0.5 font-mono text-xl font-black">{{ summary().netCash | number:'1.2-2' }} TK</p>
            <p class="mt-0.5 text-[10px] text-emerald-50/80">{{ prefs.txt('নগদ বিক্রয় + বাকি আদায় − খরচ', 'Cash sales + collections − expense') }}</p>
          </div>
        </div>
      </div>


      <!-- Stock watch + quick actions + cash collection -->
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div class="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 class="text-sm font-bold text-slate-800">{{ prefs.txt('স্টক নজরদারি', 'Stock watch') }}</h3>
              <p class="mt-0.5 text-[11px] text-slate-400">{{ prefs.txt('যেসব পণ্য আগে রিঅর্ডার করা দরকার', 'Products that need reordering first') }}</p>
            </div>
            <a routerLink="/stock" class="shrink-0 whitespace-nowrap text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-300">{{ prefs.txt('স্টক রিপোর্ট →', 'Stock report →') }}</a>
          </div>

          <div class="space-y-2">
            @for (row of stockWatch(); track row.id) {
              <a routerLink="/product-manager/products"
                class="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 transition hover:border-teal-200 hover:bg-teal-50/60 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-teal-500/40 dark:hover:bg-teal-500/10">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" [class]="row.thumbClass">
                  <mat-icon class="text-[18px]">{{ row.icon }}</mat-icon>
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-bold text-slate-800" [attr.title]="row.name">{{ row.name }}</p>
                  <p class="truncate text-[10px] text-slate-400">{{ row.category }} · {{ prefs.txt('ন্যূনতম', 'min') }} {{ row.min }}</p>
                </div>
                <div class="shrink-0 text-right">
                  <p class="font-mono text-xs font-black text-slate-800">{{ row.stock }} <span class="text-[9px] font-bold text-slate-400">{{ row.unit }}</span></p>
                  <span class="mt-0.5 inline-block rounded-full px-1.5 text-[9px] font-bold ring-1" [class]="row.badgeClass">{{ row.badge }}</span>
                </div>
              </a>
            } @empty {
              <p class="p-6 text-center text-[11px] font-semibold text-slate-400">{{ prefs.txt('কোনো পণ্য নেই।', 'No products yet.') }}</p>
            }
          </div>

          <div class="mt-3 grid grid-cols-3 gap-2 text-center">
            <div class="rounded-lg border border-slate-200 px-2 py-2 dark:border-slate-700">
              <p class="text-[9px] font-bold text-slate-400">{{ prefs.txt('মোট পণ্য', 'Products') }}</p>
              <p class="font-mono text-base font-black text-teal-700 dark:text-teal-300">{{ dataService.products().length }}</p>
            </div>
            <div class="rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p class="text-[9px] font-bold text-amber-700 dark:text-amber-300">{{ prefs.txt('লো স্টক', 'Low') }}</p>
              <p class="font-mono text-base font-black text-amber-700 dark:text-amber-300">{{ lowInStockCount() }}</p>
            </div>
            <div class="rounded-lg border border-rose-200 bg-rose-50 px-2 py-2 dark:border-rose-500/30 dark:bg-rose-500/10">
              <p class="text-[9px] font-bold text-rose-600 dark:text-rose-300">{{ prefs.txt('স্টক শেষ', 'Out') }}</p>
              <p class="font-mono text-base font-black text-rose-600 dark:text-rose-300">{{ outOfStockCount() }}</p>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div class="mb-3">
            <h3 class="text-sm font-bold text-slate-800">{{ prefs.txt('দ্রুত কাজ', 'Quick actions') }}</h3>
            <p class="mt-0.5 text-[11px] text-slate-400">{{ prefs.txt('দৈনন্দিন কাজ এক ক্লিকে', 'Daily tasks in one click') }}</p>
          </div>
          <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            @for (qa of quickActions(); track qa.href) {
              <a [routerLink]="qa.href"
                class="group flex flex-col items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-2 py-3 text-center transition hover:-translate-y-0.5 hover:border-teal-200 hover:bg-white hover:shadow-sm dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-teal-500/40 dark:hover:bg-slate-800">
                <span class="flex h-10 w-10 items-center justify-center rounded-xl transition group-hover:scale-105" [class]="qaTile(qa.tone)">
                  <mat-icon class="text-[20px]">{{ qa.icon }}</mat-icon>
                </span>
                <span class="text-[10px] font-bold leading-tight text-slate-600 dark:text-slate-300">{{ qa.label }}</span>
              </a>
            }
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div class="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 class="text-sm font-bold text-slate-800">{{ prefs.txt('নগদ কালেকশন', 'Cash collection') }}</h3>
              <p class="mt-0.5 text-[11px] text-slate-400">{{ prefs.txt('ওয়ালেট ও ব্যাংক হিসাব', 'Wallet & bank accounts') }}</p>
            </div>
            <a routerLink="/wallet" class="shrink-0 whitespace-nowrap text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-300">{{ prefs.txt('ওয়ালেট →', 'Wallet →') }}</a>
          </div>

          <dl class="space-y-2 text-xs">
            <div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
              <dt class="flex items-center gap-1.5 text-slate-500"><mat-icon class="text-[15px] text-slate-400">account_balance</mat-icon>{{ prefs.txt('প্রারম্ভিক', 'Opening') }}</dt>
              <dd class="font-mono font-bold text-slate-700">{{ cashCollection().opening | number:'1.2-2' }} TK</dd>
            </div>
            <div class="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-500/10">
              <dt class="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300"><mat-icon class="text-[15px]">south_west</mat-icon>{{ prefs.txt('আদায়', 'Received') }}</dt>
              <dd class="font-mono font-bold text-emerald-700 dark:text-emerald-300">+{{ cashCollection().inflow | number:'1.2-2' }} TK</dd>
            </div>
            <div class="flex items-center justify-between rounded-lg bg-rose-50 px-3 py-2 dark:bg-rose-500/10">
              <dt class="flex items-center gap-1.5 text-rose-600 dark:text-rose-300"><mat-icon class="text-[15px]">north_east</mat-icon>{{ prefs.txt('খরচ/প্রদান', 'Paid out') }}</dt>
              <dd class="font-mono font-bold text-rose-600 dark:text-rose-300">−{{ cashCollection().outflow | number:'1.2-2' }} TK</dd>
            </div>
          </dl>

          <div class="mt-3 rounded-xl bg-gradient-to-r from-teal-700 to-teal-500 px-4 py-3 text-white shadow-sm">
            <div class="flex items-center justify-between">
              <p class="text-[10px] font-bold uppercase tracking-wider text-teal-50/90">{{ prefs.txt('মূল ব্যালেন্স', 'Main balance') }}</p>
              <span class="rounded-full bg-white/15 px-1.5 text-[9px] font-bold">{{ cashCollection().accountCount }} {{ prefs.txt('অ্যাকাউন্ট', 'accounts') }}</span>
            </div>
            <p class="mt-0.5 font-mono text-xl font-black">{{ cashCollection().closing | number:'1.2-2' }} TK</p>
          </div>
          <a routerLink="/cash-bank" class="mt-2 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:border-teal-200 hover:text-teal-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-teal-500/40 dark:hover:text-teal-300">
            {{ prefs.txt('ক্যাশ ও ব্যাংক বিবরণ', 'Cash & bank details') }}
            <mat-icon class="text-[16px]">chevron_right</mat-icon>
          </a>
        </div>
      </div>

      <!-- Payment mix + top selling + due customers -->
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <!-- Payment Methods Donut -->
        <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-sm font-bold text-slate-800">{{ prefs.txt('পেমেন্ট মাধ্যম', 'Payment methods') }}</h3>
            <span class="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{{ periodLabel() }}</span>
          </div>

          <div class="flex items-center justify-center py-2">
            <div class="relative flex h-36 w-36 items-center justify-center rounded-full shadow-inner" [style.background]="paymentMethods().gradient">
              <div class="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white text-center dark:bg-slate-900"
                [attr.title]="(paymentMethods().total | number:'1.2-2') + ' TK'">
                <span class="text-[9px] font-bold uppercase text-slate-400">{{ prefs.txt('আদায়', 'Received') }}</span>
                <span class="font-mono text-sm font-black text-slate-800">{{ shortMoney(paymentMethods().total) }}</span>
                <span class="text-[9px] font-bold text-slate-400">TK</span>
              </div>
            </div>
          </div>

          <div class="mt-4 space-y-2 text-xs">
            @for (m of paymentMethods().rows; track m.label) {
              <div class="flex items-center justify-between gap-2">
                <span class="flex items-center gap-1.5 text-slate-600">
                  <span class="h-2.5 w-2.5 rounded-full" [style.background]="m.color"></span>{{ m.label }}
                </span>
                <span class="truncate font-mono font-bold" [class]="m.amount > 0 ? 'text-slate-800' : 'text-slate-400'">
                  {{ m.amount | number:'1.2-2' }} TK <span class="font-normal text-slate-400">({{ m.percent }}%)</span>
                </span>
              </div>
            }
          </div>
        </div>

        <!-- Top Selling Products -->
        <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div class="mb-4 flex items-start justify-between gap-2">
            <h3 class="text-sm font-bold text-slate-800">{{ prefs.txt('সর্বাধিক বিক্রিত পণ্য', 'Top selling products') }} · {{ periodLabel() }}</h3>
            <a routerLink="/product-manager/products" class="shrink-0 whitespace-nowrap text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-300">{{ prefs.txt('সব দেখুন →', 'View all →') }}</a>
          </div>

          <div class="space-y-2.5 text-xs">
            @for (item of topSelling(); track item.name; let idx = $index) {
              <div class="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/50">
                <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black" [class]="rankClass(idx)">{{ idx + 1 }}</span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="truncate font-bold text-slate-800">{{ item.name }}</p>
                    <span class="shrink-0 font-mono font-bold text-emerald-600 dark:text-emerald-300">{{ item.amount | number:'1.2-2' }} TK</span>
                  </div>
                  <div class="mt-1 flex items-center gap-2">
                    <div class="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div class="h-full rounded-full bg-gradient-to-r from-teal-400 to-teal-600" [style.width.%]="item.share"></div>
                    </div>
                    <span class="shrink-0 text-[9px] font-semibold text-slate-400">{{ item.qty }} {{ prefs.txt('পিস', 'pcs') }}</span>
                  </div>
                </div>
              </div>
            } @empty {
              <p class="p-6 text-center text-[11px] font-semibold text-slate-400">{{ prefs.txt('এই সময়ে কোনো বিক্রয় নেই।', 'No sales in this period.') }}</p>
            }
          </div>
        </div>

        <!-- Top Due Customers -->
        <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div class="mb-4 flex items-start justify-between gap-2">
            <h3 class="text-sm font-bold text-slate-800">{{ prefs.txt('বাকিদার গ্রাহক', 'Due customers') }} · {{ prefs.txt('শীর্ষ ৫', 'Top 5') }}</h3>
            <a routerLink="/parties" class="shrink-0 whitespace-nowrap text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-300">{{ prefs.txt('সব দেখুন →', 'View all →') }}</a>
          </div>

          <div class="space-y-2 text-xs">
            @for (party of topDueCustomers(); track party.id; let idx = $index) {
              <div class="flex items-center gap-2.5 rounded-lg border border-slate-100 px-2.5 py-2 dark:border-slate-800">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-[10px] font-black text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{{ initialsOf(party.name) }}</span>
                <span class="min-w-0 flex-1 truncate font-medium text-slate-700">{{ idx + 1 }}. {{ party.name }}</span>
                <span class="shrink-0 font-mono font-bold text-rose-600 dark:text-rose-300">{{ salesDueOf(party) | number:'1.2-2' }} TK</span>
              </div>
            } @empty {
              <p class="p-6 text-center text-[11px] font-semibold text-slate-400">{{ prefs.txt('কোনো বাকি নেই।', 'No dues.') }}</p>
            }
          </div>
        </div>
      </div>


      <!-- Alerts strip -->
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        @for (a of alerts(); track a.key) {
          <a [routerLink]="a.href"
            class="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 shadow-2xs transition hover:-translate-y-0.5 hover:shadow-sm"
            [class]="a.count > 0 ? alertTile(a.tone) : alertTile('slate')">
            <mat-icon class="shrink-0 text-[18px]">{{ a.icon }}</mat-icon>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[10px] font-semibold opacity-80" [attr.title]="a.label">{{ a.label }}</p>
              <p class="font-mono text-lg font-black leading-tight">{{ a.count }}</p>
            </div>
          </a>
        }
      </div>


      <!-- Quick Recent Sales Table -->
      <div class="bg-white rounded-xl shadow-2xs border border-slate-200 overflow-hidden">
        <div class="bg-gradient-to-r from-teal-700 to-teal-500 text-white px-4 py-3 flex items-center justify-between gap-3">
          <h3 class="font-bold text-sm flex items-center gap-2">
            <mat-icon class="text-sm">receipt_long</mat-icon> {{ prefs.txt('সাম্প্রতিক বিক্রয়', 'Recent sales') }} · {{ periodLabel() }}
          </h3>
          <a routerLink="/sales" class="text-xs text-teal-100 hover:text-white font-semibold whitespace-nowrap">{{ prefs.txt('বিক্রয় তালিকা →', 'Go to sales →') }}</a>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-xs text-left">
            <thead class="bg-slate-50 text-slate-600 font-bold uppercase border-b border-slate-200">
              <tr>
                <th class="p-3">{{ prefs.txt('ইনভয়েস', 'INVOICE') }}</th>
                <th class="p-3">{{ prefs.txt('ওয়্যারহাউস', 'WAREHOUSE') }}</th>
                <th class="p-3">{{ prefs.txt('তারিখ', 'DATE') }}</th>
                <th class="p-3">{{ prefs.txt('গ্রাহক', 'CUSTOMER') }}</th>
                <th class="p-3">{{ prefs.txt('অবস্থা', 'STATUS') }}</th>
                <th class="p-3 text-right">{{ prefs.txt('সর্বমোট', 'TOTAL') }}</th>
                <th class="p-3 text-right">{{ prefs.txt('পরিশোধ', 'PAID') }}</th>
                <th class="p-3 text-right">{{ prefs.txt('বাকি', 'DUE') }}</th>
                <th class="p-3 text-center">{{ prefs.txt('কাজ', 'ACTION') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (s of recentSales(); track s.id) {
                <tr class="hover:bg-slate-50">
                  <td class="p-3 font-bold text-teal-700 cursor-pointer" (click)="openInvoice(s)">{{ s.invoice }}</td>
                  <td class="p-3 text-slate-600">{{ s.warehouse }}</td>
                  <td class="p-3 text-slate-600">{{ displayDate(s.date) }}</td>
                  <td class="p-3 font-semibold text-slate-800">{{ s.customerName }}</td>
                  <td class="p-3">
                    <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1" [class]="statusPill(s.status)">
                      <span class="h-1.5 w-1.5 rounded-full bg-current opacity-70"></span>{{ s.status }}
                    </span>
                  </td>
                  <td class="p-3 text-right font-mono font-bold">{{ s.total | number:'1.2-2' }} TK</td>
                  <td class="p-3 text-right font-mono text-emerald-600 font-semibold">{{ s.paid | number:'1.2-2' }} TK</td>
                  <td class="p-3 text-right font-mono text-rose-600 font-semibold">{{ s.due | number:'1.2-2' }} TK</td>
                  <td class="p-3 text-center">
                    <button (click)="openInvoice(s)" class="text-teal-600 hover:text-teal-800 p-1">
                      <mat-icon class="text-sm">visibility</mat-icon>
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="9" class="p-10 text-center text-slate-400 font-semibold">
                    {{ prefs.txt('এই সময়ে কোনো বিক্রয় নেই — অন্য তারিখ বেছে নিন বা পিওএস থেকে শুরু করুন।', 'No sales in this period — pick another date or start from POS.') }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

    </div>

    @if (selectedInvoice()) {
      <app-invoice-modal [sale]="selectedInvoice()!" (closeModal)="selectedInvoice.set(null)" />
    }

    @if (liveReminderParty(); as rp) {
      <app-party-ledger [party]="rp" [paymentOnly]="true" [paymentPrefill]="reminderPrefill()"
        (close)="closeReminderLedger()" />
    }

    @if (reminderDateParty(); as dp) {
      <app-party-reminder-dialog [party]="dp" mode="date" (closed)="reminderDateParty.set(null)" />
    }
  `
})
export class Dashboard {
  dataService = inject(DataService);
  session = inject(SessionService);
  prefs = inject(PreferencesService);
  selectedInvoice = signal<Sale | null>(null);

  readonly todayIso = localDateIso();
  readonly todayFullLabel = computed(() => new Date(`${this.todayIso}T00:00:00`)
    .toLocaleDateString(this.prefs.language() === 'bn' ? 'bn-BD' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));

  /** The dashboard opens on today; the bar switches to day/week/month/year or a custom window. */
  periodFrom = signal(localDateIso());
  periodTo = signal(localDateIso());

  readonly periodRange = computed<DateRange>(() => ({ from: this.periodFrom(), to: this.periodTo() }));

  onPeriodChange(range: DateRange) {
    this.periodFrom.set(range.from);
    this.periodTo.set(range.to);
  }

  readonly periodDayCount = computed(() => rangeDayCount(this.periodFrom(), this.periodTo()));
  readonly periodLabel = computed(() => {
    const kind = activeDateRangeKind(this.periodFrom(), this.periodTo());
    const preset = DATE_RANGE_PRESETS.find(item => item.kind === kind);
    if (preset) return this.prefs.txt(preset.bn, preset.en);
    const from = dmyFromIso(this.periodFrom());
    const to = dmyFromIso(this.periodTo());
    if (!from && !to) return this.prefs.txt('সব সময়', 'All time');
    return from === to ? from : `${from || '…'} – ${to || '…'}`;
  });

  private readonly previousRange = computed(() => previousDateRange(this.periodFrom(), this.periodTo()));

  private salesInRange(from: string, to: string): Sale[] {
    return this.dataService.sales().filter(s => s.status !== 'Cancelled' && inDateRange(s.date, from, to));
  }

  private readonly periodSales = computed(() => this.salesInRange(this.periodFrom(), this.periodTo()));
  private readonly previousSales = computed(() => this.salesInRange(this.previousRange().from, this.previousRange().to));

  readonly periodSalesTotal = computed(() =>
    this.money(this.periodSales().reduce((sum, s) => sum + (Number(s.total) || 0), 0))
  );
  private readonly previousSalesTotal = computed(() =>
    this.money(this.previousSales().reduce((sum, s) => sum + (Number(s.total) || 0), 0))
  );

  readonly periodCashSales = computed(() =>
    this.money(this.periodSales().reduce((sum, s) => sum + this.cashOf(s), 0))
  );

  readonly periodBankSales = computed(() =>
    this.money(this.periodSales().reduce((sum, s) => sum + (Number(s.bankPayment) || 0), 0))
  );

  readonly periodDueSales = computed(() =>
    this.money(this.periodSales().reduce((sum, s) => sum + (Number(s.due) || 0), 0))
  );
  private readonly previousDueSales = computed(() =>
    this.money(this.previousSales().reduce((sum, s) => sum + (Number(s.due) || 0), 0))
  );

  readonly periodDueCollection = computed(() =>
    this.money(this.customerPaymentsInRange(this.periodFrom(), this.periodTo())
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0))
  );
  private readonly previousDueCollection = computed(() =>
    this.money(this.customerPaymentsInRange(this.previousRange().from, this.previousRange().to)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0))
  );

  readonly periodExpense = computed(() =>
    this.money(this.expenseInRange(this.periodFrom(), this.periodTo()))
  );
  private readonly previousExpense = computed(() =>
    this.money(this.expenseInRange(this.previousRange().from, this.previousRange().to))
  );

  readonly periodPurchaseTotal = computed(() =>
    this.money(this.dataService.purchases()
      .filter(p => inDateRange(p.date, this.periodFrom(), this.periodTo()))
      .reduce((sum, p) => sum + (Number(p.total) || 0), 0))
  );

  readonly periodEstimatedProfit = computed(() => this.estimatedProfitInRange(this.periodFrom(), this.periodTo()));
  private readonly previousEstimatedProfit = computed(() =>
    this.estimatedProfitInRange(this.previousRange().from, this.previousRange().to)
  );

  private readonly compareBasis = computed(() => {
    const singleDay = this.periodFrom() && this.periodFrom() === this.periodTo();
    return singleDay && this.periodFrom() === this.todayIso
      ? this.prefs.txt('গতকালের তুলনায়', 'vs yesterday')
      : this.prefs.txt('আগের সময়ের তুলনায়', 'vs previous period');
  });

  readonly periodSalesTrend = computed(() => this.trend(this.periodSalesTotal(), this.previousSalesTotal()));
  readonly periodDueTrend = computed(() => this.trend(this.periodDueSales(), this.previousDueSales()));
  readonly periodCollectionTrend = computed(() => this.trend(this.periodDueCollection(), this.previousDueCollection()));
  readonly periodExpenseTrend = computed(() => this.trend(this.periodExpense(), this.previousExpense()));

  readonly statCards = computed<StatCard[]>(() => {
    return [
      {
        key: 'sales', icon: 'trending_up', tone: 'emerald', href: '/sales',
        label: this.prefs.txt('মোট বিক্রয়', 'Total sales'),
        value: this.periodSalesTotal(), trend: this.periodSalesTrend(),
        subs: [
          { label: this.prefs.txt('নগদ', 'Cash'), value: this.periodCashSales(), unit: 'TK', tone: 'text-emerald-600 dark:text-emerald-300' },
          { label: this.prefs.txt('বাকি', 'Due'), value: this.periodDueSales(), unit: 'TK', tone: 'text-rose-500 dark:text-rose-300' }
        ]
      },
      {
        key: 'cash', icon: 'payments', tone: 'sky', href: '/sales',
        label: this.prefs.txt('নগদ বিক্রয়', 'Cash sales'),
        value: this.periodCashSales(),
        subs: [{ label: this.prefs.txt('ব্যাংক/কার্ড', 'Bank'), value: this.periodBankSales(), unit: 'TK', tone: 'text-sky-600 dark:text-sky-300' }]
      },
      {
        key: 'due', icon: 'credit_card_off', tone: 'rose', href: '/sales',
        label: this.prefs.txt('বাকি বিক্রয়', 'Due sales'),
        value: this.periodDueSales(), trend: this.periodDueTrend(), subs: []
      },
      {
        key: 'collection', icon: 'savings', tone: 'amber', href: '/sales/payment-in',
        label: this.prefs.txt('বাকি আদায়', 'Due collection'),
        value: this.periodDueCollection(), trend: this.periodCollectionTrend(), subs: []
      },
      {
        key: 'expense', icon: 'receipt_long', tone: 'orange', href: '/hrm/expenses',
        label: this.prefs.txt('মোট খরচ', 'Total expense'),
        value: this.periodExpense(), trend: this.periodExpenseTrend(), subs: []
      },
      {
        key: 'balance', icon: 'account_balance_wallet', tone: 'teal', href: '/wallet',
        label: this.prefs.txt('মূল ব্যালেন্স', 'Main balance'),
        value: this.dataService.mainBalance(),
        subs: [{ label: this.prefs.txt('অ্যাকাউন্ট', 'Accounts'), value: this.dataService.walletAccounts().length, unit: 'pcs', tone: 'text-teal-600 dark:text-teal-300' }]
      }
    ];
  });

  readonly summary = computed(() => {
    const sales = this.periodSalesTotal();
    const purchases = this.periodPurchaseTotal();
    const profit = this.periodEstimatedProfit();
    const collection = this.periodDueCollection();
    const expense = this.periodExpense();
    return {
      sales,
      purchases,
      profit,
      collection,
      expense,
      margin: sales > 0 ? Math.round((profit / sales) * 1000) / 10 : 0,
      netCash: this.money(this.periodCashSales() + collection - expense)
    };
  });

  /** Wallet movements in the chosen window; opening is derived so it always reconciles with the live balance. */
  readonly cashCollection = computed(() => {
    let inflow = 0;
    let outflow = 0;
    for (const txn of this.dataService.walletTransactions()) {
      if (!inDateRange(txn.date, this.periodFrom(), this.periodTo())) continue;
      const amount = Number(txn.amount) || 0;
      if (txn.direction === 'In') inflow += amount;
      else outflow += amount;
    }
    const closing = this.dataService.mainBalance();
    return {
      opening: this.money(closing - inflow + outflow),
      inflow: this.money(inflow),
      outflow: this.money(outflow),
      closing,
      accountCount: this.dataService.walletAccounts().length
    };
  });

  readonly stockWatch = computed<StockWatchRow[]>(() => {
    const rows = this.dataService.products().map(product => {
      const stock = Number(product.stock) || 0;
      const min = Number(product.minQty) > 0 ? Number(product.minQty) : 5;
      const rank = stock <= 0 ? 0 : stock <= min ? 1 : stock <= min * 2 ? 2 : 3;
      const category = product.category || this.prefs.txt('সাধারণ', 'General');
      const haystack = `${category} ${product.name}`;
      const icon = /batter|ব্যাটারি/i.test(haystack) ? 'battery_charging_full'
        : /tyre|tire|টায়ার/i.test(haystack) ? 'trip_origin'
          : /charger|চার্জার/i.test(haystack) ? 'electrical_services'
            : 'inventory_2';
      return {
        id: product.id,
        name: product.name,
        category,
        stock,
        unit: product.unit || this.prefs.txt('পিস', 'pcs'),
        min,
        rank,
        ratio: stock / min,
        icon,
        badge: rank === 0
          ? this.prefs.txt('স্টক শেষ', 'Out')
          : rank === 1
            ? this.prefs.txt('লো স্টক', 'Low')
            : rank === 2
              ? this.prefs.txt('সতর্ক', 'Watch')
              : this.prefs.txt('যথেষ্ট', 'OK'),
        badgeClass: STOCK_BADGE[rank],
        thumbClass: STOCK_THUMB[rank]
      };
    });

    const risky = rows.filter(row => row.rank <= 1);
    return (risky.length ? risky : rows)
      .sort((a, b) => a.rank - b.rank || a.ratio - b.ratio || a.name.localeCompare(b.name))
      .slice(0, 6);
  });

  readonly quickActions = computed<QuickAction[]>(() => [
    { label: this.prefs.txt('POS বিক্রয়', 'POS sale'), icon: 'point_of_sale', href: '/pos', tone: 'teal' },
    { label: this.prefs.txt('নতুন ক্রয়', 'New purchase'), icon: 'shopping_cart', href: '/purchases/add', tone: 'sky' },
    { label: this.prefs.txt('ব্যাটারি বিক্রয়', 'Battery sale'), icon: 'battery_charging_full', href: '/battery/sale', tone: 'amber' },
    { label: this.prefs.txt('হাজিরা', 'Attendance'), icon: 'fact_check', href: '/hrm/attendance', tone: 'violet' },
    { label: this.prefs.txt('খরচ এন্ট্রি', 'Add expense'), icon: 'receipt_long', href: '/hrm/expenses', tone: 'rose' },
    { label: this.prefs.txt('পার্টি তালিকা', 'Parties'), icon: 'groups', href: '/parties', tone: 'emerald' }
  ]);

  readonly alerts = computed<AlertTile[]>(() => [
    { key: 'low', label: this.prefs.txt('লো স্টক পণ্য', 'Low stock'), count: this.dataService.lowStockProducts().length, icon: 'inventory_2', tone: 'rose', href: '/product-manager/products' },
    { key: 'next', label: this.prefs.txt('পরিশোধ মেয়াদোত্তীর্ণ', 'Overdue payments'), count: this.overdueNextPaymentCount(), icon: 'schedule', tone: 'amber', href: '/sales' },
    { key: 'credit', label: this.prefs.txt('ক্রেডিট লিমিট ছাড়িয়েছে', 'Credit limit exceeded'), count: this.creditLimitExceededCount(), icon: 'block', tone: 'amber', href: '/parties' },
    { key: 'd30', label: this.prefs.txt('৩০+ দিন বাকি', 'Due over 30 days'), count: this.overdueSalesCount(30), icon: 'history', tone: 'orange', href: '/sales' },
    { key: 'd60', label: this.prefs.txt('৬০+ দিন বাকি', 'Due over 60 days'), count: this.overdueSalesCount(60), icon: 'history_toggle_off', tone: 'rose', href: '/sales' },
    { key: 'supplier', label: this.prefs.txt('সরবরাহকারী পাওনা', 'Supplier payables'), count: this.supplierDueCount(), icon: 'account_balance_wallet', tone: 'sky', href: '/parties' }
  ]);

  /** <=31 days plot every day, <=120 days plot weeks, longer spans plot months. */
  readonly chartMode = computed<'day' | 'week' | 'month'>(() => {
    const days = this.periodDayCount();
    if (!days) return 'month';
    if (days <= 31) return 'day';
    if (days <= 120) return 'week';
    return 'month';
  });

  readonly chartTitle = computed(() => {
    const label = this.periodLabel();
    if (this.chartMode() === 'day') return `${this.prefs.txt('দৈনিক বিক্রয়', 'Daily sales')} · ${label}`;
    if (this.chartMode() === 'week') return `${this.prefs.txt('সাপ্তাহিক বিক্রয়', 'Weekly sales')} · ${label}`;
    return `${this.prefs.txt('মাসিক বিক্রয়', 'Monthly sales')} · ${label}`;
  });

  readonly chartEmptyLabel = computed(() => {
    if (this.chartMode() === 'day') return this.prefs.txt('এই সময়ে কোনো বিক্রয় হয়নি।', 'No sales in this period.');
    if (this.chartMode() === 'week') return this.prefs.txt('এই সময়ে কোনো সাপ্তাহিক বিক্রয় নেই।', 'No weekly sales in this period.');
    return this.prefs.txt('এই সময়ে কোনো মাসিক বিক্রয় নেই।', 'No monthly sales in this period.');
  });

  readonly salesChart = computed<DayBar[]>(() => {
    const buckets = this.chartBuckets(this.chartMode(), this.periodFrom(), this.periodTo());
    const sales = this.dataService.sales().filter(s => s.status !== 'Cancelled');

    const days = buckets.map(bucket => {
      const rows = sales.filter(s => {
        const iso = toIsoDate(s.date);
        return !!iso && iso >= bucket.start && iso <= bucket.end;
      });
      const cash = this.money(rows.reduce((sum, s) => sum + this.cashOf(s), 0));
      const due = this.money(rows.reduce((sum, s) => sum + (Number(s.due) || 0), 0));
      const profit = this.money(this.profitOfSales(rows));
      return {
        iso: bucket.start,
        label: bucket.label,
        cash,
        due,
        profit,
        total: this.money(cash + due),
        isToday: this.todayIso >= bucket.start && this.todayIso <= bucket.end
      };
    });

    const max = this.niceMax(Math.max(0, ...days.map(day => day.total)));
    return days.map(day => ({
      ...day,
      totalPct: day.total > 0 ? Math.max(2, (day.total / max) * 100) : 0,
      cashSharePct: day.total > 0 ? (day.cash / day.total) * 100 : 0,
      dueSharePct: day.total > 0 ? (day.due / day.total) * 100 : 0
    }));
  });

  readonly chartTotal = computed(() => this.salesChart().reduce((sum, day) => sum + day.total, 0));
  readonly chartCash = computed(() => this.money(this.salesChart().reduce((sum, day) => sum + day.cash, 0)));
  readonly chartDue = computed(() => this.money(this.salesChart().reduce((sum, day) => sum + day.due, 0)));
  readonly chartProfit = computed(() => this.money(this.salesChart().reduce((sum, day) => sum + day.profit, 0)));
  readonly chartMax = computed(() => this.niceMax(Math.max(0, ...this.salesChart().map(day => day.total))));
  readonly chartProfitMax = computed(() => this.niceMax(Math.max(0, ...this.salesChart().map(day => day.profit))));
  readonly chartHasProfit = computed(() => this.salesChart().some(day => day.profit > 0));

  /** Profit polyline in a 0-100 viewBox so it stretches with the bars. */
  readonly chartLinePoints = computed(() => {
    const bars = this.salesChart();
    const max = this.chartProfitMax();
    if (bars.length < 2 || max <= 0) return '';
    return bars.map((bar, index) => {
      const x = ((index + 0.5) / bars.length) * 100;
      const y = 100 - Math.max(0, Math.min(100, (bar.profit / max) * 100));
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  });

  showBarLabel(index: number): boolean {
    const length = this.salesChart().length;
    if (!length) return false;
    const step = Math.max(1, Math.ceil(length / 8));
    return index % step === 0 || index === length - 1;
  }

  private chartBuckets(mode: 'day' | 'week' | 'month', from: string, to: string): { start: string; end: string; label: string }[] {
    const buckets: { start: string; end: string; label: string }[] = [];

    if (mode === 'day') {
      let cursor = this.parseIso(from || this.dateShift(-6));
      const last = this.parseIso(to || this.todayIso);
      while (cursor && last && cursor <= last && buckets.length < 62) {
        const iso = localDateIso(cursor);
        buckets.push({ start: iso, end: iso, label: this.shortDate(iso) });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }
      return buckets;
    }

    if (mode === 'week') {
      const startRef = this.parseIso(from || this.dateShift(-83));
      const endRef = this.parseIso(to || this.todayIso);
      if (!startRef || !endRef) return [];
      const cursor = new Date(startRef.getFullYear(), startRef.getMonth(), startRef.getDate());
      cursor.setDate(cursor.getDate() - ((cursor.getDay() + 1) % 7));
      const hardEnd = localDateIso(endRef);
      while (cursor <= endRef && buckets.length < 60) {
        const start = localDateIso(cursor);
        const weekEnd = localDateIso(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 6));
        buckets.push({ start, end: weekEnd < hardEnd ? weekEnd : hardEnd, label: this.shortDate(start) });
        cursor.setDate(cursor.getDate() + 7);
      }
      return buckets;
    }

    const endRef = this.parseIso(to || this.todayIso);
    if (!endRef) return [];
    let year: number;
    let month: number;
    if (from) {
      const startRef = this.parseIso(from);
      if (!startRef) return [];
      year = startRef.getFullYear();
      month = startRef.getMonth();
    } else {
      year = endRef.getFullYear();
      month = endRef.getMonth() - 11;
      while (month < 0) {
        month += 12;
        year -= 1;
      }
    }

    const hardEnd = localDateIso(endRef);
    while (buckets.length < 60) {
      const cursor = new Date(year, month, 1);
      if (cursor > endRef) break;
      const start = localDateIso(cursor);
      const monthEnd = localDateIso(new Date(year, month + 1, 0));
      buckets.push({ start, end: monthEnd < hardEnd ? monthEnd : hardEnd, label: this.monthLabel(cursor) });
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return buckets;
  }

  readonly paymentMethods = computed<{ total: number; rows: PaymentMethodRow[]; gradient: string }>(() => {
    // Money actually received in the chosen period: counter receipts from those
    // sales plus due collections. Sales only store "cash" and "everything else",
    // so a POS bKash/Nagad sale is split by its recorded mode and the rest books as bank.
    const received = new Map<string, number>();
    const add = (mode: string, amount: number) => {
      const value = Number(amount) || 0;
      if (value > 0) received.set(mode, (received.get(mode) ?? 0) + value);
    };
    for (const sale of this.periodSales()) {
      add('Cash', this.cashOf(sale));
      const bank = Number(sale.bankPayment) || 0;
      if (bank > 0) add(sale.paymentMode === 'bKash' || sale.paymentMode === 'Nagad' ? sale.paymentMode : 'Bank', bank);
    }
    for (const payment of this.customerPaymentsInRange(this.periodFrom(), this.periodTo())) add(payment.mode, payment.amount);

    const rows = PAYMENT_MODES.map(({ mode, label, color }) => ({ label, color, amount: this.money(received.get(mode) ?? 0) }));
    const total = this.money(rows.reduce((sum, row) => sum + row.amount, 0));
    const detail = rows.map(row => ({
      ...row,
      percent: total > 0 ? Math.round((row.amount / total) * 1000) / 10 : 0
    }));

    if (total <= 0) {
      return { total, rows: detail, gradient: 'conic-gradient(#e2e8f0 0deg 360deg)' };
    }

    let cursor = 0;
    const stops = detail.map(row => {
      const start = cursor;
      cursor += (row.amount / total) * 360;
      return `${row.color} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
    });
    return { total, rows: detail, gradient: `conic-gradient(${stops.join(', ')})` };
  });

  readonly recentSales = computed(() =>
    [...this.periodSales()]
      .sort((a, b) => {
        const byDate = this.isoDate(b.date).localeCompare(this.isoDate(a.date));
        return byDate !== 0 ? byDate : b.id - a.id;
      })
      .slice(0, 5)
  );

  readonly topSelling = computed(() => {
    const grouped = new Map<string, { name: string; qty: number; amount: number }>();
    for (const sale of this.periodSales()) {
      for (const item of sale.items || []) {
        const name = item.productName || '—';
        const row = grouped.get(name) ?? { name, qty: 0, amount: 0 };
        row.qty += saleLineBaseQty(item);
        row.amount += Number(item.total) || 0;
        grouped.set(name, row);
      }
    }
    const rows = [...grouped.values()].sort((a, b) => b.amount - a.amount).slice(0, 4);
    const top = Math.max(1, ...rows.map(row => row.amount));
    return rows.map(row => ({
      name: row.name,
      qty: Math.round(row.qty * 100) / 100,
      amount: this.money(row.amount),
      share: Math.max(4, Math.round((row.amount / top) * 100))
    }));
  });

  readonly topDueCustomers = computed(() =>
    this.dataService.parties()
      .filter(p => hasSalesRole(p) && salesAccountOf(p).due > 0)
      .sort((a, b) => salesAccountOf(b).due - salesAccountOf(a).due)
      .slice(0, 5)
  );

  /** Re-reads the clock every minute so the reminder list rolls over at midnight on its own. */
  private readonly reminderClock = signal(localDateIso());
  readonly reminderFilter = signal<'all' | ReminderBucket>('all');
  readonly reminderSearch = signal('');
  readonly reminderFocus = signal<number | null>(null);
  readonly reminderParty = signal<Party | null>(null);
  readonly reminderPrefill = signal(0);
  readonly reminderDateParty = signal<Party | null>(null);

  constructor() {
    const timer = setInterval(() => {
      const now = localDateIso();
      if (now !== this.reminderClock()) this.reminderClock.set(now);
    }, 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  readonly liveReminderParty = computed(() => {
    const open = this.reminderParty();
    if (!open) return null;
    return this.dataService.parties().find(p => p.id === open.id) ?? open;
  });

  /** Promises that still have something to collect, overdue first, then today, tomorrow, day after. */
  readonly reminderRows = computed<ReminderRow[]>(() => {
    const today = this.reminderClock();
    const todayValue = Date.parse(`${today}T00:00:00`);
    const order: Record<ReminderBucket, number> = { overdue: 0, today: 1, tomorrow: 2, dayafter: 3, later: 4 };
    const rows: ReminderRow[] = [];
    for (const party of this.dataService.parties()) {
      const promise = party.paymentPromise;
      if (!promise || party.status !== 'Enabled' || !hasSalesRole(party)) continue;
      const remaining = promiseRemaining(party);
      if (remaining <= 0) continue;
      const date = this.isoDate(promise.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const daysLate = Math.round((todayValue - Date.parse(`${date}T00:00:00`)) / 86_400_000);
      const bucket: ReminderBucket = daysLate > 0 ? 'overdue'
        : daysLate === 0 ? 'today'
          : daysLate === -1 ? 'tomorrow'
            : daysLate === -2 ? 'dayafter' : 'later';
      const status = this.reminderStatus(bucket, daysLate, date);
      const note = this.reminderNote(party);
      rows.push({
        id: party.id,
        name: party.name,
        typeLabel: party.type || 'Customer',
        companyName: party.companyName || '',
        phone: partyPhones(party)[0] || '',
        due: this.money(salesAccountOf(party).due),
        promised: this.money(promise.amount),
        received: this.money(promise.received),
        remaining,
        date,
        dateLabel: this.shortDate(date),
        daysLate,
        bucket,
        statusLabel: status.label,
        statusClass: status.className,
        note: note.text,
        noteLabel: note.label
      });
    }
    return rows.sort((a, b) => order[a.bucket] - order[b.bucket]
      || a.date.localeCompare(b.date)
      || b.due - a.due);
  });

  readonly reminderVisibleRows = computed(() => {
    const filter = this.reminderFilter();
    const query = this.reminderSearch().trim().toLowerCase();
    return this.reminderRows().filter(row => {
      if (filter !== 'all' && row.bucket !== filter) return false;
      if (!query) return true;
      return row.name.toLowerCase().includes(query)
        || row.companyName.toLowerCase().includes(query)
        || row.phone.toLowerCase().includes(query);
    });
  });

  readonly reminderTotals = computed(() => {
    const rows = this.reminderVisibleRows();
    return {
      due: this.money(rows.reduce((sum, row) => sum + row.due, 0)),
      promised: this.money(rows.reduce((sum, row) => sum + row.remaining, 0))
    };
  });

  readonly focusedReminder = computed(() => {
    const rows = this.reminderVisibleRows();
    return rows.find(row => row.id === this.reminderFocus()) ?? rows[0] ?? null;
  });

  readonly reminderTiles = computed(() => {
    const rows = this.reminderRows();
    const build = (key: ReminderBucket, label: string, idleClass: string, activeClass: string, badgeClass: string) => {
      const list = rows.filter(row => row.bucket === key);
      return {
        key, label, idleClass, activeClass, badgeClass,
        count: list.length,
        promised: this.money(list.reduce((sum, row) => sum + row.remaining, 0))
      };
    };
    return [
      build('overdue', this.prefs.txt('তারিখ পার হয়ে গেছে', 'Overdue'),
        'border-rose-200 bg-rose-50/60 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
        'border-rose-400 bg-rose-100 text-rose-800 ring-2 ring-rose-300/60 dark:border-rose-400 dark:bg-rose-500/20 dark:text-rose-200',
        'bg-rose-600 text-white'),
      build('today', this.prefs.txt('আজ', 'Today'),
        'border-amber-200 bg-amber-50/60 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
        'border-amber-400 bg-amber-100 text-amber-800 ring-2 ring-amber-300/60 dark:border-amber-400 dark:bg-amber-500/20 dark:text-amber-200',
        'bg-amber-500 text-white'),
      build('tomorrow', this.prefs.txt('আগামীকাল', 'Tomorrow'),
        'border-sky-200 bg-sky-50/60 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
        'border-sky-400 bg-sky-100 text-sky-800 ring-2 ring-sky-300/60 dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-200',
        'bg-sky-600 text-white'),
      build('dayafter', this.prefs.txt('পরশু', 'Day after'),
        'border-teal-200 bg-teal-50/60 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300',
        'border-teal-400 bg-teal-100 text-teal-800 ring-2 ring-teal-300/60 dark:border-teal-400 dark:bg-teal-500/20 dark:text-teal-200',
        'bg-teal-600 text-white')
    ];
  });

  readonly reminderSegments = computed(() => {
    const rows = this.reminderRows();
    const count = (bucket: ReminderBucket) => rows.filter(row => row.bucket === bucket).length;
    return [
      { key: 'all' as const, label: this.prefs.txt('সব', 'All'), count: rows.length },
      { key: 'overdue' as const, label: this.prefs.txt('তারিখ পার হয়েছে', 'Overdue'), count: count('overdue') },
      { key: 'today' as const, label: this.prefs.txt('আজ', 'Today'), count: count('today') },
      { key: 'tomorrow' as const, label: this.prefs.txt('আগামীকাল', 'Tomorrow'), count: count('tomorrow') },
      { key: 'dayafter' as const, label: this.prefs.txt('পরশু', 'Day after'), count: count('dayafter') }
    ];
  });

  toggleReminderFilter(key: ReminderBucket) {
    this.reminderFilter.update(current => current === key ? 'all' : key);
  }

  openReminderCollect(row: ReminderRow) {
    const party = this.dataService.parties().find(p => p.id === row.id);
    if (!party) return;
    this.reminderPrefill.set(row.remaining);
    this.reminderParty.set(party);
  }

  closeReminderLedger() {
    this.reminderParty.set(null);
    this.reminderPrefill.set(0);
  }

  openReminderDate(row: ReminderRow) {
    const party = this.dataService.parties().find(p => p.id === row.id);
    if (party) this.reminderDateParty.set(party);
  }

  private reminderStatus(bucket: ReminderBucket, daysLate: number, date: string): { label: string; className: string } {
    switch (bucket) {
      case 'overdue':
        return {
          label: `${daysLate} ${this.prefs.txt('দিন পার', 'days late')}`,
          className: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25'
        };
      case 'today':
        return {
          label: this.prefs.txt('আজ', 'Today'),
          className: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25'
        };
      case 'tomorrow':
        return {
          label: this.prefs.txt('আগামীকাল', 'Tomorrow'),
          className: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25'
        };
      case 'dayafter':
        return {
          label: this.prefs.txt('পরশু', 'Day after'),
          className: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/25'
        };
      default:
        return {
          label: this.shortDate(date),
          className: 'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600'
        };
    }
  }

  private reminderNote(party: Party): { text: string; label: string } {
    const history = party.paymentPromise?.history ?? [];
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry.text?.trim()) {
        return { text: entry.text.trim(), label: this.historyLabel(entry.at) };
      }
    }
    return { text: (party.paymentPromise?.note || '').trim(), label: '' };
  }

  private historyLabel(iso: string): string {
    const date = (iso || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? this.shortDate(date) : '';
  }

  salesDueOf(party: Party): number {
    return salesAccountOf(party).due;
  }

  initialsOf(name: string): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.length ? parts.map(part => part.charAt(0).toUpperCase()).join('') : '—';
  }

  readonly overdueNextPaymentCount = computed(() =>
    this.dataService.sales().filter(s => {
      const due = Number(s.due) || 0;
      return s.status !== 'Cancelled' && due > 0 && this.daysOverdue(s.nextPayDate) > 0;
    }).length
  );

  readonly creditLimitExceededCount = computed(() =>
    this.dataService.parties().filter(p =>
      (Number(p.creditLimit) || 0) > 0 && salesAccountOf(p).due > (Number(p.creditLimit) || 0)
    ).length
  );

  overdueSalesCount(days: number): number {
    return this.dataService.sales().filter(s =>
      s.status !== 'Cancelled' && (Number(s.due) || 0) > 0 && this.daysOverdue(s.nextPayDate) >= days
    ).length;
  }

  supplierDueCount(): number {
    return this.dataService.parties().filter(p => hasPurchaseRole(p) && purchaseAccountOf(p).due > 0).length;
  }

  outOfStockCount(): number {
    return this.dataService.products().filter(p => (p.stock || 0) <= 0).length;
  }

  lowInStockCount(): number {
    return this.dataService.lowStockProducts().filter(p => (p.stock || 0) > 0).length;
  }

  adequateStockCount(): number {
    return this.dataService.products().filter(p => (p.stock || 0) > (p.minQty && p.minQty > 0 ? p.minQty : 5)).length;
  }

  statusPill(status: Sale['status']): string {
    switch (status) {
      case 'Completed': return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25';
      case 'Cancelled': return 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25';
      case 'Shipping': return 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25';
      case 'Processing': return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25';
      default: return 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/25';
    }
  }

  /** Literal class strings so Tailwind's scanner emits them. */
  toneTile(tone: string): string {
    switch (tone) {
      case 'emerald': return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300';
      case 'sky': return 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300';
      case 'rose': return 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300';
      case 'amber': return 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300';
      case 'orange': return 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300';
      case 'teal': return 'bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300';
      case 'violet': return 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300';
      default: return 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300';
    }
  }

  trendChip(trend: TrendInfo): string {
    if (trend.className.includes('emerald')) return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    if (trend.className.includes('rose')) return 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300';
    return 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300';
  }

  qaTile(tone: string): string {
    return this.toneTile(tone);
  }

  alertTile(tone: string): string {
    switch (tone) {
      case 'rose': return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300';
      case 'amber': return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300';
      case 'orange': return 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300';
      case 'sky': return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300';
      default: return 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400';
    }
  }

  rankClass(index: number): string {
    if (index === 0) return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300';
    if (index === 1) return 'bg-slate-200 text-slate-600 dark:bg-slate-600/40 dark:text-slate-200';
    if (index === 2) return 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300';
    return 'bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300';
  }

  shortMoney(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1e7) return `${(value / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
    if (abs >= 1e5) return `${(value / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
    return `${Math.round(value)}`;
  }

  displayDate(value: string): string {
    const iso = this.isoDate(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : (value || '-');
  }

  openInvoice(s: Sale) {
    this.selectedInvoice.set(s);
  }

  private isoDate(value: string): string {
    const text = (value || '').trim();
    const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
    return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : text.slice(0, 10);
  }

  private dateShift(days: number): string {
    const [year, month, day] = this.todayIso.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private shortDate(iso: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return iso;
    const months = this.prefs.language() === 'en' ? MONTHS_EN : MONTHS_BN;
    return `${Number(match[3])} ${months[Number(match[2]) - 1]}`;
  }

  private daysOverdue(value: string): number {
    const iso = this.isoDate(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 0;
    const diff = Date.parse(`${this.todayIso}T00:00:00`) - Date.parse(`${iso}T00:00:00`);
    return Math.floor(diff / 86_400_000);
  }

  private customerPaymentsInRange(from: string, to: string) {
    return this.dataService.payments().filter(p =>
      p.partyType === 'Customer' && inDateRange(p.date, from, to)
    );
  }

  private expenseInRange(from: string, to: string): number {
    return this.money(this.dataService.expenses()
      .filter(e => inDateRange(e.date, from, to))
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0));
  }

  private estimatedProfitInRange(from: string, to: string): number {
    return this.money(this.profitOfSales(this.salesInRange(from, to)));
  }

  private profitOfSales(sales: Sale[]): number {
    const products = this.dataService.products();
    let profit = 0;
    for (const sale of sales) {
      // Item totals already net their line discounts, so only the order-level
      // discount is left to remove from revenue here.
      const revenue = (sale.items || []).reduce((sum, item) => sum + (Number(item.total) || 0), 0)
        - (Number(sale.orderDiscount) || 0);
      profit += revenue;
      for (const item of sale.items || []) {
        const product = item.productId != null
          ? products.find(p => p.id === item.productId)
          : products.find(p => p.name === item.productName);
        const cost = Number(product?.purchasePrice) || 0;
        profit -= cost * saleLineBaseQty(item);
      }
    }
    return profit;
  }

  private niceMax(value: number): number {
    if (!(value > 0)) return 1000;
    const power = Math.pow(10, Math.floor(Math.log10(value)));
    const scaled = value / power;
    const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return step * power;
  }

  private parseIso(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private monthLabel(date: Date): string {
    const months = this.prefs.language() === 'en' ? MONTHS_EN : MONTHS_BN;
    return `${months[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`;
  }

  private cashOf(sale: Sale): number {
    if (typeof sale.cashReceived === 'number') return Number(sale.cashReceived) || 0;
    return Math.max(0, (Number(sale.paid) || 0) - (Number(sale.bankPayment) || 0));
  }

  /** No previous-period data means no honest percentage, so the card shows no chip. */
  private trend(current: number, previous: number): TrendInfo | null {
    if (previous <= 0) return null;
    const basis = this.compareBasis();
    const percent = Math.round(((current - previous) / previous) * 1000) / 10;
    if (percent === 0) return { icon: 'remove', label: `0% ${basis}`, short: '0%', className: 'text-slate-400' };
    return percent > 0
      ? { icon: 'trending_up', label: `+${percent}% ${basis}`, short: `+${percent}%`, className: 'text-emerald-600' }
      : { icon: 'trending_down', label: `${percent}% ${basis}`, short: `${percent}%`, className: 'text-rose-500' };
  }

  /** Shrinks the value type before the number can get clipped inside a narrow card. */
  valueClass(value: number): string {
    const abs = Math.abs(Number(value) || 0);
    if (abs >= 1e7) return 'text-base';
    if (abs >= 1e6) return 'text-[15px] sm:text-lg';
    return 'text-lg sm:text-xl';
  }

  private money(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }
}
