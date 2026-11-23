import { ChangeDetectionStrategy, Component, OnInit, WritableSignal, computed, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  DataService, LedgerPayment, Party, PartySide,
  accountOf, hasPurchaseRole, hasSalesRole, partyPhones, partyRoles, promiseRemaining,
  purchaseAccountOf, salesAccountOf
} from '../../services/data';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { localDateIso } from '../../utils/local-date';
import { DmyDateDirective } from '../../directives/dmy-date.directive';
import { PartyStatement } from '../party-statement/party-statement';
import { PartyReminderDialog } from '../party-reminder-dialog/party-reminder-dialog';

interface LedgerRow {
  key: string;
  date: string;
  type: 'sale' | 'purchase' | 'payment' | 'return' | 'opening';
  ref: string;
  note: string;
  debit: number;
  credit: number;
  balance: number;
  payment?: LedgerPayment;
}

interface DepositRow {
  key: string;
  at: number;
  dateLabel: string;
  time: string;
  mode: string;
  amount: number;
  ref: string;
  note: string;
}

/** Top-level categories inside the party profile. */
type ProfileTab = 'history' | 'deposits' | 'sales' | 'purchase' | 'info';

/** Rows a profile table renders per batch; the rest load on demand. */
const PROFILE_ROWS = 25;

@Component({
  selector: 'app-party-ledger',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, DmyDateDirective, PartyStatement, PartyReminderDialog],
  template: `
    @if (!paymentOnly()) {
    <div class="fixed inset-0 z-50 flex justify-end select-none">
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs" (click)="close.emit()"></div>

      <div class="relative bg-white w-full max-w-3xl h-full shadow-2xl flex flex-col overflow-hidden text-slate-800">
        <!-- Party profile header -->
        <div class="relative shrink-0 overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 text-white">
          <div class="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/10"></div>
          <div class="pointer-events-none absolute -left-12 bottom-0 h-28 w-28 rounded-full bg-white/5"></div>

          <div class="relative flex items-start gap-3 px-4 pt-4">
            <div class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/15 text-xl font-black ring-4 ring-white/25">
              @if (avatarUrl()) {
                <img [src]="avatarUrl()" [alt]="party().name" class="h-full w-full object-cover">
              } @else {
                {{ initials() }}
              }
            </div>

            <div class="min-w-0 flex-1">
              <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-100">{{ prefs.txt('পার্টি প্রোফাইল', 'Party Profile') }}</p>
              <h2 class="truncate text-lg font-black leading-tight">{{ party().name }}</h2>
              <div class="mt-1 flex flex-wrap items-center gap-1.5">
                @for (role of roleLabels(); track role) {
                  <span class="rounded-full border border-white/25 bg-white/15 px-2 py-0.5 text-[10px] font-bold">{{ role }}</span>
                }
                <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  [class]="party().status === 'Enabled' ? 'bg-emerald-300/25 text-emerald-50' : 'bg-rose-300/25 text-rose-50'">
                  <span class="h-1.5 w-1.5 rounded-full" [class]="party().status === 'Enabled' ? 'bg-emerald-300' : 'bg-rose-300'"></span>
                  {{ party().status }}
                </span>
                @if (dash(party().role)) {
                  <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold">{{ party().role }}</span>
                }
              </div>
              @if (headline()) {
                <p class="mt-1 truncate text-[11px] text-teal-50/90">{{ headline() }}</p>
              }
            </div>

            <div class="flex shrink-0 items-center gap-1">
              <button (click)="showStatement.set(true)" class="rounded-full p-1.5 transition-colors hover:bg-white/15"
                [title]="prefs.txt('স্টেটমেন্ট ও PDF ডাউনলোড', 'Statement & PDF download')"
                [attr.aria-label]="prefs.txt('স্টেটমেন্ট ও PDF ডাউনলোড', 'Statement & PDF download')">
                <mat-icon class="text-base">picture_as_pdf</mat-icon>
              </button>
              <button (click)="edit.emit()" class="rounded-full p-1.5 transition-colors hover:bg-white/15" [title]="prefs.txt('পার্টি এডিট করুন', 'Edit party')">
                <mat-icon class="text-base">edit</mat-icon>
              </button>
              <button (click)="close.emit()" class="rounded-full p-1.5 transition-colors hover:bg-white/15" [attr.aria-label]="prefs.t('common.close')">
                <mat-icon class="text-base">close</mat-icon>
              </button>
            </div>
          </div>

          <div class="relative mt-3 flex flex-wrap items-center gap-1.5 px-4 pb-4 text-[11px] font-semibold">
            @for (number of partyPhones(party()); track number) {
              <a [href]="'tel:' + number" class="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 transition-colors hover:bg-white/25">
                <mat-icon class="text-[13px]">call</mat-icon> {{ number }}
              </a>
            }
            @if (dash(party().email)) {
              <a [href]="'mailto:' + party().email" class="inline-flex max-w-[220px] items-center gap-1 truncate rounded-full bg-white/15 px-2.5 py-1 transition-colors hover:bg-white/25">
                <mat-icon class="text-[13px]">mail</mat-icon> {{ party().email }}
              </a>
            }
            @if (location()) {
              <span class="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-white/10 px-2.5 py-1">
                <mat-icon class="text-[13px]">place</mat-icon> {{ location() }}
              </span>
            }
            @if (memberSince()) {
              <span class="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-teal-50">
                <mat-icon class="text-[13px]">event</mat-icon> {{ prefs.txt('সদস্য', 'Member') }}: {{ memberSince() }}
              </span>
            }
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <button (click)="openPayment()" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-2 rounded-lg flex items-center gap-1 shadow-2xs">
              <mat-icon class="text-sm">payments</mat-icon>
              {{ isSupplier() ? prefs.t('ledger.recordPayment') : prefs.t('ledger.recordPayment') }}
            </button>
            @if (isSupplier()) {
              <button (click)="openReturn()" class="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-2 rounded-lg flex items-center gap-1 shadow-2xs">
                <mat-icon class="text-sm">assignment_return</mat-icon>
                {{ prefs.t('ledger.supplierReturn') }}
              </button>
            }
            @if (lastPayment()) {
              <button (click)="showReceipt(lastPayment()!)" class="bg-slate-700 hover:bg-slate-800 text-white font-bold px-3 py-2 rounded-lg flex items-center gap-1 shadow-2xs">
                <mat-icon class="text-sm">print</mat-icon>
                {{ prefs.t('ledger.printReceipt') }}
              </button>
            }
            <button (click)="showStatement.set(true)" class="border border-teal-600 bg-white text-teal-700 hover:bg-teal-50 font-bold px-3 py-2 rounded-lg flex items-center gap-1 shadow-2xs">
              <mat-icon class="text-sm">description</mat-icon>
              {{ prefs.txt('স্টেটমেন্ট (PDF)', 'Statement (PDF)') }}
            </button>
            @if (canFixOpening()) {
              <button (click)="fixOpening.emit()" class="border border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 font-bold px-3 py-2 rounded-lg flex items-center gap-1 shadow-2xs dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200"
                [title]="prefs.txt('অ্যাডমিন পাসওয়ার্ড দিয়ে ওপেনিং ব্যালেন্স সংশোধন', 'Correct the opening balance with the admin password')">
                <mat-icon class="text-sm">currency_exchange</mat-icon>
                {{ prefs.txt('ওপেনিং সংশোধন', 'Fix opening') }}
              </button>
            }
            @if (!isSupplier()) {
              <button (click)="showReminder.set(true)" class="border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 font-bold px-3 py-2 rounded-lg flex items-center gap-1 shadow-2xs dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <mat-icon class="text-sm">notifications_active</mat-icon>
                {{ prefs.txt('রিমাইন্ডার', 'Reminder') }}
              </button>
            }
            <span class="text-[10px] text-slate-400 ml-auto">{{ prefs.t('common.opening') }}: {{ openingBalance() | number:'1.2-2' }} TK</span>
          </div>

          @if (reminderSummary(); as reminder) {
            <button type="button" (click)="showReminder.set(true)"
              class="flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-2.5 py-2 text-left text-[11px] transition hover:bg-amber-100/70 dark:border-amber-500/30 dark:bg-amber-500/10 dark:hover:bg-amber-500/15">
              <mat-icon class="text-[15px] text-amber-600 dark:text-amber-300">notifications_active</mat-icon>
              <span class="font-black text-amber-800 dark:text-amber-300">{{ reminder.title }}</span>
              <span class="font-mono font-bold" [class]="reminder.overdue ? 'text-rose-600 dark:text-rose-300' : 'text-amber-700 dark:text-amber-200'">{{ reminder.amount }} TK</span>
              <span class="text-[10px] font-semibold text-amber-700/80 dark:text-amber-300/80">{{ reminder.left }}</span>
              <mat-icon class="ml-auto text-[14px] text-amber-600 dark:text-amber-300">chevron_right</mat-icon>
            </button>
          }

          @if (savedMsg()) {
            <div class="bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5">
              <mat-icon class="text-sm">check_circle</mat-icon> {{ savedMsg() }}
            </div>
          }

          <!-- Profile categories -->
          <div class="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1">
            @for (tab of profileTabs(); track tab.key) {
              <button type="button" (click)="profileTab.set(tab.key)"
                [class]="activeProfileTab() === tab.key
                  ? 'bg-white text-teal-700 ring-1 ring-teal-200 shadow-sm'
                  : 'text-slate-500 hover:bg-white/70'"
                class="flex min-w-[96px] flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition-colors">
                <mat-icon class="text-sm">{{ tab.icon }}</mat-icon>
                <span class="truncate">{{ prefs.txt(tab.bn, tab.en) }}</span>
                @if (tab.count !== undefined) {
                  <span class="rounded-full px-1.5 text-[9px] font-black"
                    [class]="activeProfileTab() === tab.key ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-600'">{{ tab.count }}</span>
                }
              </button>
            }
          </div>

          @if (activeProfileTab() === 'history') {
          <!-- Separate books for a party that both buys and sells -->
          @if (showSideTabs()) {
            <div class="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1">
              <button type="button" (click)="setSide('sales')"
                [class]="bookSide() === 'sales' ? 'bg-white ring-1 ring-teal-200 shadow-sm' : 'hover:bg-white/70'"
                class="rounded-lg px-2.5 py-2 text-left transition-colors">
                <span class="flex items-center gap-1 text-[11px] font-black" [class]="bookSide() === 'sales' ? 'text-teal-700' : 'text-slate-500'">
                  <mat-icon class="text-sm">trending_up</mat-icon> {{ prefs.txt('বিক্রয় হিসাব', 'Sales book') }}
                </span>
                <span class="mt-0.5 block text-[9px] font-semibold text-slate-500">
                  {{ prefs.txt('বাকি', 'Due') }} {{ (sideStats().sales.due < 0 ? -sideStats().sales.due : sideStats().sales.due) | number:'1.2-2' }} TK
                </span>
              </button>
              <button type="button" (click)="setSide('purchase')"
                [class]="bookSide() === 'purchase' ? 'bg-white ring-1 ring-amber-200 shadow-sm' : 'hover:bg-white/70'"
                class="rounded-lg px-2.5 py-2 text-left transition-colors">
                <span class="flex items-center gap-1 text-[11px] font-black" [class]="bookSide() === 'purchase' ? 'text-amber-700' : 'text-slate-500'">
                  <mat-icon class="text-sm">shopping_cart</mat-icon> {{ prefs.txt('ক্রয় হিসাব', 'Purchase book') }}
                </span>
                <span class="mt-0.5 block text-[9px] font-semibold text-slate-500">
                  {{ prefs.txt('প্রদেয়', 'Payable') }} {{ (sideStats().purchase.due < 0 ? -sideStats().purchase.due : sideStats().purchase.due) | number:'1.2-2' }} TK
                </span>
              </button>
            </div>
          }

          <!-- Summary for the selected book -->
          <div class="grid grid-cols-3 gap-2">
            <div class="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <p class="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                <mat-icon class="text-[11px]">receipt_long</mat-icon>
                {{ isSupplier() ? prefs.t('ledger.purchases') : prefs.t('ledger.sales') }}
              </p>
              <p class="mt-0.5 font-mono text-sm font-black text-slate-900">{{ account().total | number:'1.2-2' }} TK</p>
            </div>
            <div class="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5">
              <p class="flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                <mat-icon class="text-[11px]">check_circle</mat-icon>
                {{ isSupplier() ? prefs.txt('পরিশোধিত', 'Paid') : prefs.t('common.paid') }}
              </p>
              <p class="mt-0.5 font-mono text-sm font-black text-emerald-700">{{ account().paid | number:'1.2-2' }} TK</p>
            </div>
            <div class="rounded-lg border p-2.5" [class]="account().due > 0 ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-200'">
              <p class="flex items-center gap-1 text-[10px] font-semibold" [class]="account().due > 0 ? 'text-rose-700' : 'text-slate-500'">
                <mat-icon class="text-[11px]">{{ account().due > 0 ? 'error_outline' : 'verified_user' }}</mat-icon>
                {{ isSupplier() ? prefs.txt('প্রদেয়', 'Payable') : prefs.t('ledger.dueAmount') }}
              </p>
              <p class="mt-0.5 font-mono text-sm font-black" [class]="account().due > 0 ? 'text-rose-700' : 'text-slate-700'">
                {{ (account().due < 0 ? -account().due : account().due) | number:'1.2-2' }} TK
              </p>
            </div>
          </div>

          @if (account().advance > 0) {
            <div class="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-700">
              <mat-icon class="text-sm">savings</mat-icon>
              {{ isSupplier() ? prefs.txt('অগ্রিম পরিশোধ', 'Advance payment') : prefs.txt('অগ্রিম জমা', 'Advance deposit') }}: {{ account().advance | number:'1.2-2' }} TK — {{ prefs.txt('পরবর্তী বিলে সমন্বয় হবে।', 'will be adjusted in the next bill.') }}
            </div>
          }

          <!-- Transactions -->
          <div class="border border-slate-200 rounded-xl overflow-hidden">
            <div class="bg-slate-50 px-3 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-bold text-slate-800">{{ prefs.t('ledger.transactions') }} ({{ rows().length }})</h3>
              <div class="flex min-w-0 items-center gap-2">
                <span class="hidden text-[10px] text-slate-400 sm:inline">{{ prefs.txt('সারিতে ক্লিক করে বিস্তারিত দেখুন', 'Click a row for details') }}</span>
                @if (dash(party().address)) {
                  <span class="max-w-[45%] truncate text-[10px] text-slate-500">{{ dash(party().address) }}</span>
                }
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full min-w-[680px] text-left border-collapse">
                <thead>
                  <tr class="bg-slate-100 text-slate-600 uppercase text-[10px] font-bold">
                    <th class="p-2 text-center w-10">{{ prefs.txt('ক্রম', 'SL') }}</th>
                    <th class="p-2">{{ prefs.t('common.date') }}</th>
                    <th class="p-2">{{ prefs.t('common.type') }}</th>
                    <th class="p-2">{{ prefs.t('ledger.invoice') }}</th>
                    <th class="p-2 text-right">{{ prefs.t('ledger.debit') }}</th>
                    <th class="p-2 text-right">{{ prefs.t('ledger.credit') }}</th>
                    <th class="p-2 text-right">{{ prefs.t('common.balance') }}</th>
                    <th class="p-2 text-center w-10"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <tr class="bg-slate-50/60">
                    <td class="p-2"></td>
                    <td class="p-2 text-slate-400" colspan="5">{{ prefs.t('ledger.opening') }}</td>
                    <td class="p-2 text-right font-mono font-bold text-slate-700">{{ openingBalance() | number:'1.2-2' }}</td>
                    <td></td>
                  </tr>
                  @if (!dataService.hydrated()) {
                    @for (s of [1, 2, 3]; track s) {
                      <tr class="animate-pulse">
                        <td class="p-2"><div class="mx-auto h-3 w-4 rounded bg-slate-200"></div></td>
                        <td class="p-2"><div class="h-3 w-16 rounded bg-slate-200"></div></td>
                        <td class="p-2"><div class="h-3 w-14 rounded bg-slate-200"></div></td>
                        <td class="p-2"><div class="h-3 w-24 rounded bg-slate-200"></div></td>
                        <td class="p-2"><div class="ml-auto h-3 w-14 rounded bg-slate-200"></div></td>
                        <td class="p-2"><div class="ml-auto h-3 w-14 rounded bg-slate-200"></div></td>
                        <td class="p-2"><div class="ml-auto h-3 w-16 rounded bg-slate-200"></div></td>
                        <td></td>
                      </tr>
                    }
                  } @else {
                    @for (row of visibleHistoryRows(); track row.key; let idx = $index) {
                      <tr
                        (click)="openRow(row)"
                        (keydown.enter)="openRow(row)"
                        tabindex="0"
                        [attr.aria-label]="prefs.txt('লেনদেনের বিস্তারিত: ', 'Transaction details: ') + row.ref"
                        class="cursor-pointer transition-colors hover:bg-teal-50/50 focus-visible:bg-teal-50 focus-visible:outline-none"
                      >
                        <td class="p-2 text-center text-[10px] font-bold text-slate-400">{{ idx + 1 }}</td>
                        <td class="p-2 whitespace-nowrap text-slate-500">{{ formatDate(row.date) }}</td>
                        <td class="p-2">
                          <span [class]="badgeClass(row.type)">{{ typeLabel(row.type) }}</span>
                        </td>
                        <td class="p-2 font-semibold text-slate-800">
                          {{ row.ref }}
                          @if (row.note) {
                            <span class="block max-w-[160px] truncate text-[10px] font-normal text-slate-400">{{ row.note }}</span>
                          }
                        </td>
                        <td class="p-2 text-right font-mono text-rose-600">{{ row.debit ? (row.debit | number:'1.2-2') : '-' }}</td>
                        <td class="p-2 text-right font-mono text-emerald-600">{{ row.credit ? (row.credit | number:'1.2-2') : '-' }}</td>
                        <td class="p-2 text-right font-mono font-bold text-slate-900">{{ row.balance | number:'1.2-2' }}</td>
                        <td class="p-2 text-center">
                          @if (row.payment) {
                            <button (click)="$event.stopPropagation(); showReceipt(row.payment!)" class="text-slate-500 hover:text-teal-700" [title]="prefs.t('ledger.printReceipt')">
                              <mat-icon class="text-sm">print</mat-icon>
                            </button>
                          } @else {
                            <mat-icon class="text-[15px] text-slate-300">chevron_right</mat-icon>
                          }
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="8" class="p-8 text-center text-slate-400">{{ prefs.t('common.noData') }}</td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
            @if (rows().length > visibleHistoryRows().length) {
              <button type="button" (click)="showMore(historyLimit, rows().length)"
                class="w-full border-t border-slate-100 px-3 py-2 text-[10px] font-bold text-teal-700 hover:bg-teal-50 cursor-pointer">
                {{ prefs.txt('আরও ২৫টি লেনদেন দেখুন', 'Show 25 more transactions') }} · {{ rows().length - visibleHistoryRows().length }} {{ prefs.txt('বাকি', 'left') }}
              </button>
            }
          </div>
          }

          <!-- Deposit history: its own category so it never crowds the ledger rows -->
          @if (activeProfileTab() === 'deposits') {
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div class="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5">
                <p class="flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                  <mat-icon class="text-[11px]">savings</mat-icon>{{ prefs.txt('মোট জমা', 'Total deposited') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black text-emerald-700">{{ depositTotal() | number:'1.2-2' }} TK</p>
              </div>
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <p class="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                  <mat-icon class="text-[11px]">receipt_long</mat-icon>{{ prefs.txt('জমার সংখ্যা', 'Deposit entries') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black text-slate-900">{{ deposits().length }}</p>
              </div>
              <div class="col-span-2 rounded-lg border border-sky-100 bg-sky-50 p-2.5 sm:col-span-1">
                <p class="flex items-center gap-1 text-[10px] font-semibold text-sky-700">
                  <mat-icon class="text-[11px]">savings</mat-icon>{{ prefs.txt('অগ্রিম জমা', 'Advance') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black text-sky-700">{{ account().advance | number:'1.2-2' }} TK</p>
              </div>
            </div>

            <div class="border border-slate-200 rounded-xl overflow-hidden">
              <div class="bg-gradient-to-r from-emerald-50 to-teal-50 px-3 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                  <mat-icon class="text-sm text-emerald-600">savings</mat-icon>
                  <h3 class="font-bold text-slate-800 text-sm">{{ prefs.txt('জমার ইতিহাস', 'Deposits') }}</h3>
                </div>
                <span class="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500">{{ deposits().length }} {{ prefs.txt('টি', 'entries') }}</span>
              </div>
              @if (deposits().length) {
                <div class="max-h-[26rem] overflow-y-auto divide-y divide-slate-100">
                  @for (row of visibleDeposits(); track row.key) {
                    <div class="flex items-start gap-2 px-3 py-2 hover:bg-emerald-50/40">
                      <div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <mat-icon class="text-[15px]">{{ isSupplier() ? 'payments' : 'south_west' }}</mat-icon>
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="text-[11px] font-bold text-slate-800">{{ row.dateLabel }}</span>
                          @if (row.time) {
                            <span class="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
                              <mat-icon class="text-[10px]">schedule</mat-icon>{{ row.time }}
                            </span>
                          }
                          <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">{{ row.mode }}</span>
                        </div>
                        @if (row.note) {
                          <p class="mt-0.5 text-[10px] text-slate-500 break-words">{{ row.note }}</p>
                        }
                        <p class="text-[9px] text-slate-400">{{ isSupplier() ? prefs.txt('রিসিট / ভাউচার', 'Receipt / Voucher') : prefs.txt('রিসিট / ইনভয়েস', 'Receipt / Invoice') }}: {{ row.ref }}</p>
                      </div>
                      <div class="shrink-0 text-right">
                        <p class="font-mono text-sm font-black text-emerald-700">+{{ row.amount | number:'1.2-2' }}</p>
                        <p class="text-[9px] text-slate-400">TK</p>
                      </div>
                    </div>
                  }
                </div>
                @if (deposits().length > visibleDeposits().length) {
                  <button type="button" (click)="showMore(depositsLimit, deposits().length)"
                    class="w-full border-t border-slate-100 px-3 py-2 text-[10px] font-bold text-teal-700 hover:bg-teal-50 cursor-pointer">
                    {{ prefs.txt('আরও ২৫টি জমা দেখুন', 'Show 25 more deposits') }} · {{ deposits().length - visibleDeposits().length }} {{ prefs.txt('বাকি', 'left') }}
                  </button>
                }
              } @else {
                <div class="px-3 py-10 text-center">
                  <mat-icon class="text-2xl text-slate-300">savings</mat-icon>
                  <p class="mt-1 text-[11px] text-slate-400">{{ prefs.txt('এখনো কোনো জমা নেই।', 'No deposits yet.') }}</p>
                </div>
              }
            </div>
          }

          <!-- Sales account: invoice-wise, independent from the ledger history -->
          @if (activeProfileTab() === 'sales') {
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <p class="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                  <mat-icon class="text-[11px]">receipt_long</mat-icon>{{ prefs.txt('মোট বিক্রয়', 'Total sales') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black text-slate-900">{{ sideStats().sales.total | number:'1.2-2' }} TK</p>
              </div>
              <div class="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5">
                <p class="flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                  <mat-icon class="text-[11px]">check_circle</mat-icon>{{ prefs.t('common.paid') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black text-emerald-700">{{ sideStats().sales.paid | number:'1.2-2' }} TK</p>
              </div>
              <div class="rounded-lg border p-2.5" [class]="sideStats().sales.due > 0 ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-200'">
                <p class="flex items-center gap-1 text-[10px] font-semibold" [class]="sideStats().sales.due > 0 ? 'text-rose-700' : 'text-slate-500'">
                  <mat-icon class="text-[11px]">{{ sideStats().sales.due > 0 ? 'error_outline' : 'verified_user' }}</mat-icon>{{ prefs.t('ledger.dueAmount') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black" [class]="sideStats().sales.due > 0 ? 'text-rose-700' : 'text-slate-700'">
                  {{ (sideStats().sales.due < 0 ? -sideStats().sales.due : sideStats().sales.due) | number:'1.2-2' }} TK
                </p>
              </div>
              <div class="rounded-lg border border-sky-100 bg-sky-50 p-2.5">
                <p class="flex items-center gap-1 text-[10px] font-semibold text-sky-700">
                  <mat-icon class="text-[11px]">savings</mat-icon>{{ prefs.txt('অগ্রিম জমা', 'Advance') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black text-sky-700">{{ sideStats().sales.advance | number:'1.2-2' }} TK</p>
              </div>
            </div>

            <div class="border border-slate-200 rounded-xl overflow-hidden">
              <div class="bg-gradient-to-r from-teal-50 to-teal-100/60 px-3 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                  <mat-icon class="text-sm text-teal-600">trending_up</mat-icon>
                  <h3 class="font-bold text-slate-800 text-sm">{{ prefs.txt('সেলস হিসাব', 'Sales account') }}</h3>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500">{{ salesInvoices().length }} {{ prefs.txt('টি ইনভয়েস', 'invoices') }}</span>
                  <span class="rounded-full bg-teal-600 px-2 py-0.5 text-[9px] font-bold text-white">{{ prefs.txt('মোট', 'Total') }} {{ sideStats().sales.total | number:'1.2-2' }} TK</span>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full min-w-[640px] text-left border-collapse">
                  <thead>
                    <tr class="bg-slate-100 text-slate-600 uppercase text-[10px] font-bold">
                      <th class="p-2 text-center w-10">{{ prefs.txt('ক্রম', 'SL') }}</th>
                      <th class="p-2">{{ prefs.t('common.date') }}</th>
                      <th class="p-2">{{ prefs.t('ledger.invoice') }}</th>
                      <th class="p-2 text-center">{{ prefs.txt('আইটেম', 'Items') }}</th>
                      <th class="p-2 text-right">{{ prefs.t('common.total') }}</th>
                      <th class="p-2 text-right">{{ prefs.t('common.paid') }}</th>
                      <th class="p-2 text-right">{{ prefs.t('ledger.dueAmount') }}</th>
                      <th class="p-2 text-center">{{ prefs.txt('পেমেন্ট', 'Payment') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (s of visibleSalesInvoices(); track s.id; let idx = $index) {
                      <tr (click)="openInvoice('sale', s.invoice)" (keydown.enter)="openInvoice('sale', s.invoice)" tabindex="0"
                        class="cursor-pointer transition-colors hover:bg-teal-50/50 focus-visible:bg-teal-50 focus-visible:outline-none">
                        <td class="p-2 text-center text-[10px] font-bold text-slate-400">{{ idx + 1 }}</td>
                        <td class="p-2 whitespace-nowrap text-slate-500">{{ formatDate(s.date) }}</td>
                        <td class="p-2 font-semibold text-slate-800">{{ s.invoice }}</td>
                        <td class="p-2 text-center text-slate-500">{{ s.items?.length || 0 }}</td>
                        <td class="p-2 text-right font-mono font-bold text-slate-900">{{ s.total | number:'1.2-2' }}</td>
                        <td class="p-2 text-right font-mono text-emerald-600">{{ s.paid | number:'1.2-2' }}</td>
                        <td class="p-2 text-right font-mono font-bold" [class]="s.due > 0 ? 'text-rose-600' : 'text-slate-400'">{{ (s.due < 0 ? -s.due : s.due) | number:'1.2-2' }}</td>
                        <td class="p-2 text-center">
                          <span class="rounded-full px-1.5 py-0.5 text-[9px] font-bold" [class]="paymentClass(s.paymentStatus)">{{ paymentLabel(s.paymentStatus) }}</span>
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="8" class="p-8 text-center text-slate-400">{{ prefs.txt('এই পার্টির কোনো বিক্রয় পাওয়া যায়নি।', 'No sales for this party.') }}</td>
                      </tr>
                    }
                  </tbody>
                  @if (salesInvoices().length) {
                    <tfoot>
                      <tr class="bg-slate-50 font-bold text-slate-800">
                        <td class="p-2" colspan="4">{{ prefs.txt('সর্বমোট', 'Grand total') }}</td>
                        <td class="p-2 text-right font-mono">{{ sideStats().sales.total | number:'1.2-2' }}</td>
                        <td class="p-2 text-right font-mono text-emerald-700">{{ sideStats().sales.paid | number:'1.2-2' }}</td>
                        <td class="p-2 text-right font-mono text-rose-600">{{ (sideStats().sales.due < 0 ? -sideStats().sales.due : sideStats().sales.due) | number:'1.2-2' }}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  }
                </table>
              </div>
              @if (salesInvoices().length > visibleSalesInvoices().length) {
                <button type="button" (click)="showMore(salesLimit, salesInvoices().length)"
                  class="w-full border-t border-slate-100 px-3 py-2 text-[10px] font-bold text-teal-700 hover:bg-teal-50 cursor-pointer">
                  {{ prefs.txt('আরও ২৫টি ইনভয়েস দেখুন', 'Show 25 more invoices') }} · {{ salesInvoices().length - visibleSalesInvoices().length }} {{ prefs.txt('বাকি', 'left') }}
                </button>
              }
            </div>
          }

          <!-- Purchase account: invoice-wise, independent from the ledger history -->
          @if (activeProfileTab() === 'purchase') {
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <p class="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                  <mat-icon class="text-[11px]">shopping_bag</mat-icon>{{ prefs.txt('মোট ক্রয়', 'Total purchases') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black text-slate-900">{{ sideStats().purchase.total | number:'1.2-2' }} TK</p>
              </div>
              <div class="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5">
                <p class="flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                  <mat-icon class="text-[11px]">check_circle</mat-icon>{{ prefs.txt('পরিশোধিত', 'Paid') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black text-emerald-700">{{ sideStats().purchase.paid | number:'1.2-2' }} TK</p>
              </div>
              <div class="rounded-lg border p-2.5" [class]="sideStats().purchase.due > 0 ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-200'">
                <p class="flex items-center gap-1 text-[10px] font-semibold" [class]="sideStats().purchase.due > 0 ? 'text-rose-700' : 'text-slate-500'">
                  <mat-icon class="text-[11px]">{{ sideStats().purchase.due > 0 ? 'error_outline' : 'verified_user' }}</mat-icon>{{ prefs.txt('প্রদেয়', 'Payable') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black" [class]="sideStats().purchase.due > 0 ? 'text-rose-700' : 'text-slate-700'">
                  {{ (sideStats().purchase.due < 0 ? -sideStats().purchase.due : sideStats().purchase.due) | number:'1.2-2' }} TK
                </p>
              </div>
              <div class="rounded-lg border border-sky-100 bg-sky-50 p-2.5">
                <p class="flex items-center gap-1 text-[10px] font-semibold text-sky-700">
                  <mat-icon class="text-[11px]">savings</mat-icon>{{ prefs.txt('অগ্রিম পরিশোধ', 'Advance paid') }}
                </p>
                <p class="mt-0.5 font-mono text-sm font-black text-sky-700">{{ sideStats().purchase.advance | number:'1.2-2' }} TK</p>
              </div>
            </div>

            <div class="border border-slate-200 rounded-xl overflow-hidden">
              <div class="bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                  <mat-icon class="text-sm text-amber-600">shopping_cart</mat-icon>
                  <h3 class="font-bold text-slate-800 text-sm">{{ prefs.txt('ক্রয় হিসাব', 'Purchase account') }}</h3>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500">{{ purchaseInvoices().length }} {{ prefs.txt('টি ভাউচার', 'vouchers') }}</span>
                  <span class="rounded-full bg-amber-600 px-2 py-0.5 text-[9px] font-bold text-white">{{ prefs.txt('মোট', 'Total') }} {{ sideStats().purchase.total | number:'1.2-2' }} TK</span>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full min-w-[640px] text-left border-collapse">
                  <thead>
                    <tr class="bg-slate-100 text-slate-600 uppercase text-[10px] font-bold">
                      <th class="p-2 text-center w-10">{{ prefs.txt('ক্রম', 'SL') }}</th>
                      <th class="p-2">{{ prefs.t('common.date') }}</th>
                      <th class="p-2">{{ prefs.t('ledger.invoice') }}</th>
                      <th class="p-2 text-center">{{ prefs.txt('আইটেম', 'Items') }}</th>
                      <th class="p-2 text-right">{{ prefs.t('common.total') }}</th>
                      <th class="p-2 text-right">{{ prefs.txt('পরিশোধিত', 'Paid') }}</th>
                      <th class="p-2 text-right">{{ prefs.txt('প্রদেয়', 'Payable') }}</th>
                      <th class="p-2 text-center">{{ prefs.txt('পেমেন্ট', 'Payment') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (p of visiblePurchaseInvoices(); track p.id; let idx = $index) {
                      <tr (click)="openInvoice('purchase', p.invoice)" (keydown.enter)="openInvoice('purchase', p.invoice)" tabindex="0"
                        class="cursor-pointer transition-colors hover:bg-amber-50/60 focus-visible:bg-amber-50 focus-visible:outline-none">
                        <td class="p-2 text-center text-[10px] font-bold text-slate-400">{{ idx + 1 }}</td>
                        <td class="p-2 whitespace-nowrap text-slate-500">{{ formatDate(p.date) }}</td>
                        <td class="p-2 font-semibold text-slate-800">{{ p.invoice }}</td>
                        <td class="p-2 text-center text-slate-500">{{ p.items?.length || 0 }}</td>
                        <td class="p-2 text-right font-mono font-bold text-slate-900">{{ p.total | number:'1.2-2' }}</td>
                        <td class="p-2 text-right font-mono text-emerald-600">{{ p.paid | number:'1.2-2' }}</td>
                        <td class="p-2 text-right font-mono font-bold" [class]="p.due > 0 ? 'text-rose-600' : 'text-slate-400'">{{ (p.due < 0 ? -p.due : p.due) | number:'1.2-2' }}</td>
                        <td class="p-2 text-center">
                          <span class="rounded-full px-1.5 py-0.5 text-[9px] font-bold" [class]="paymentClass(p.paymentStatus)">{{ paymentLabel(p.paymentStatus) }}</span>
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="8" class="p-8 text-center text-slate-400">{{ prefs.txt('এই পার্টির কোনো ক্রয় পাওয়া যায়নি।', 'No purchases for this party.') }}</td>
                      </tr>
                    }
                  </tbody>
                  @if (purchaseInvoices().length) {
                    <tfoot>
                      <tr class="bg-slate-50 font-bold text-slate-800">
                        <td class="p-2" colspan="4">{{ prefs.txt('সর্বমোট', 'Grand total') }}</td>
                        <td class="p-2 text-right font-mono">{{ sideStats().purchase.total | number:'1.2-2' }}</td>
                        <td class="p-2 text-right font-mono text-emerald-700">{{ sideStats().purchase.paid | number:'1.2-2' }}</td>
                        <td class="p-2 text-right font-mono text-rose-600">{{ (sideStats().purchase.due < 0 ? -sideStats().purchase.due : sideStats().purchase.due) | number:'1.2-2' }}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  }
                </table>
              </div>
              @if (purchaseInvoices().length > visiblePurchaseInvoices().length) {
                <button type="button" (click)="showMore(purchaseLimit, purchaseInvoices().length)"
                  class="w-full border-t border-slate-100 px-3 py-2 text-[10px] font-bold text-amber-700 hover:bg-amber-50 cursor-pointer">
                  {{ prefs.txt('আরও ২৫টি ভাউচার দেখুন', 'Show 25 more vouchers') }} · {{ purchaseInvoices().length - visiblePurchaseInvoices().length }} {{ prefs.txt('বাকি', 'left') }}
                </button>
              }
            </div>
          }

          <!-- Party full information -->
          @if (activeProfileTab() === 'info' && details().length) {
            <div class="border border-slate-200 rounded-xl overflow-hidden">
              <div class="bg-slate-50 px-2.5 py-1.5 border-b border-slate-200 flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                  <mat-icon class="text-[13px] text-teal-600">contact_page</mat-icon>
                  <h3 class="font-bold text-slate-800 text-xs">{{ prefs.txt('সকল তথ্য', 'Profile Details') }}</h3>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="rounded-full bg-white border border-slate-200 px-1.5 py-0.5 text-[8px] font-bold text-slate-500">
                    {{ details().length }} {{ prefs.txt('তথ্য', 'fields') }}
                  </span>
                  @if (details().length > DETAILS_PREVIEW) {
                    <button (click)="showAllDetails.set(!showAllDetails())" class="rounded-full bg-teal-600 px-2 py-0.5 text-[8px] font-bold text-white hover:bg-teal-700">
                      {{ showAllDetails() ? prefs.txt('কম দেখুন', 'Show less') : prefs.txt('সব দেখুন', 'Show all') }}
                    </button>
                  }
                </div>
              </div>
              <dl class="grid grid-cols-2 sm:grid-cols-4 gap-1 p-2">
                @for (item of visibleDetails(); track item.label) {
                  <div class="min-w-0 rounded-md bg-slate-50/70 px-1.5 py-1">
                    <dt class="text-[8px] uppercase font-bold tracking-wide text-slate-400 truncate">{{ item.label }}</dt>
                    <dd class="text-[10px] font-semibold text-slate-800 break-words leading-tight">{{ item.value }}</dd>
                  </div>
                }
              </dl>
            </div>
          }
        </div>
      </div>
    </div>
    }

    <!-- Payment modal -->
    @if (showPayment()) {
      <div class="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3" (click)="closePayment()">
        <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden" (click)="$event.stopPropagation()">
          <div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div class="min-w-0">
              <h3 class="font-bold text-sm flex items-center gap-1.5">
                <mat-icon class="text-emerald-600 text-base">payments</mat-icon>
                {{ prefs.t('ledger.recordPayment') }}
              </h3>
              @if (paymentOnly()) {
                <p class="mt-0.5 truncate text-[10px] font-semibold text-slate-500">{{ party().name }}</p>
              }
            </div>
            <button (click)="closePayment()" class="text-slate-400 hover:text-slate-700">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>
          <div class="p-4 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ prefs.t('common.amount') }} (TK)</label>
                <input type="number" min="0" step="0.01" [(ngModel)]="payAmount" class="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold text-right focus:border-teal-500 focus:outline-none" placeholder="0.00" />
              </div>
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ prefs.t('common.discount') }} (TK)</label>
                <input type="number" min="0" step="0.01" [(ngModel)]="payDiscount" class="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold text-right focus:border-teal-500 focus:outline-none" placeholder="0.00" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ prefs.t('common.mode') }}</label>
                <select [(ngModel)]="payMode" class="w-full border border-slate-300 rounded-lg p-2 bg-white focus:border-teal-500 focus:outline-none">
                  <option value="Cash">{{ prefs.txt('নগদ', 'Cash') }}</option>
                  <option value="Bank">{{ prefs.txt('ব্যাংক', 'Bank') }}</option>
                  <option value="bKash">bKash</option>
                  <option value="Nagad">Nagad</option>
                </select>
              </div>
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ prefs.t('common.date') }}</label>
                <input type="date" appDmyDate [(ngModel)]="payDate" class="w-full border border-slate-300 rounded-lg p-2 focus:border-teal-500 focus:outline-none" />
              </div>
            </div>
            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ prefs.t('common.note') }}</label>
              <input type="text" [(ngModel)]="payNote" class="w-full border border-slate-300 rounded-lg p-2 focus:border-teal-500 focus:outline-none" placeholder="..." />
            </div>
            <p class="text-[10px] text-slate-500">{{ isSupplier() ? prefs.txt('প্রদেয়', 'Payable') : prefs.t('ledger.dueAmount') }}: <b class="font-mono text-rose-600">{{ (account().due < 0 ? -account().due : account().due) | number:'1.2-2' }} TK</b></p>
            @if (formError()) {
              <p class="text-rose-600 font-semibold bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5">{{ formError() }}</p>
            }
          </div>
          <div class="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="closePayment()" class="px-3 py-2 bg-white border border-slate-300 rounded-lg font-semibold text-slate-700">{{ prefs.t('common.cancel') }}</button>
            <button (click)="savePayment()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold">{{ prefs.t('common.save') }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Supplier return modal -->
    @if (showReturn()) {
      <div class="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
        <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
          <div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-sm flex items-center gap-1.5">
              <mat-icon class="text-amber-600 text-base">assignment_return</mat-icon>
              {{ prefs.t('ledger.supplierReturn') }}
            </h3>
            <button (click)="showReturn.set(false)" class="text-slate-400 hover:text-slate-700">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>
          <div class="p-4 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ prefs.t('common.amount') }} (TK)</label>
                <input type="number" min="0" step="0.01" [(ngModel)]="returnAmount" class="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold text-right focus:border-teal-500 focus:outline-none" placeholder="0.00" />
              </div>
              <div>
                <label class="block font-semibold text-slate-600 mb-1">{{ prefs.t('common.date') }}</label>
                <input type="date" appDmyDate [(ngModel)]="returnDate" class="w-full border border-slate-300 rounded-lg p-2 focus:border-teal-500 focus:outline-none" />
              </div>
            </div>
            <div>
              <label class="block font-semibold text-slate-600 mb-1">{{ prefs.t('common.note') }}</label>
              <input type="text" [(ngModel)]="returnNote" class="w-full border border-slate-300 rounded-lg p-2 focus:border-teal-500 focus:outline-none" [placeholder]="prefs.txt('ড্যামেজ / ভুল পণ্য ফেরত...', 'Damaged / wrong item return...')" />
            </div>
            @if (formError()) {
              <p class="text-rose-600 font-semibold bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5">{{ formError() }}</p>
            }
          </div>
          <div class="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="showReturn.set(false)" class="px-3 py-2 bg-white border border-slate-300 rounded-lg font-semibold text-slate-700">{{ prefs.t('common.cancel') }}</button>
            <button (click)="saveReturn()" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold">{{ prefs.t('common.save') }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Transaction detail -->
    @if (selectedRow(); as row) {
      <div class="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs" (click)="selectedRow.set(null)">
        <div class="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" (click)="$event.stopPropagation()">
          <div class="flex items-start justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div class="min-w-0">
              <p class="text-[9px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('লেনদেনের বিস্তারিত', 'Transaction details') }}</p>
              <h3 class="truncate text-sm font-black text-slate-900">{{ row.ref || '—' }}</h3>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <span [class]="badgeClass(row.type)">{{ typeLabel(row.type) }}</span>
              <button (click)="selectedRow.set(null)" class="text-slate-400 hover:text-slate-700" [attr.aria-label]="prefs.t('common.close')">
                <mat-icon class="text-sm">close</mat-icon>
              </button>
            </div>
          </div>

          <div class="space-y-2 p-3">
            <div class="grid grid-cols-2 gap-2">
              <div class="rounded-lg bg-slate-50 px-2 py-1.5">
                <p class="text-[8px] font-bold uppercase text-slate-400">{{ prefs.t('common.date') }}</p>
                <p class="text-[11px] font-bold text-slate-800">{{ formatDate(row.date) }}</p>
              </div>
              <div class="rounded-lg bg-slate-50 px-2 py-1.5">
                <p class="text-[8px] font-bold uppercase text-slate-400">{{ prefs.t('common.balance') }}</p>
                <p class="font-mono text-[11px] font-black text-slate-900">{{ row.balance | number:'1.2-2' }} TK</p>
              </div>
              <div class="rounded-lg bg-rose-50 px-2 py-1.5">
                <p class="text-[8px] font-bold uppercase text-rose-400">{{ prefs.t('ledger.debit') }}</p>
                <p class="font-mono text-[11px] font-black text-rose-700">{{ row.debit ? (row.debit | number:'1.2-2') : '-' }}</p>
              </div>
              <div class="rounded-lg bg-emerald-50 px-2 py-1.5">
                <p class="text-[8px] font-bold uppercase text-emerald-500">{{ prefs.t('ledger.credit') }}</p>
                <p class="font-mono text-[11px] font-black text-emerald-700">{{ row.credit ? (row.credit | number:'1.2-2') : '-' }}</p>
              </div>
            </div>

            @if (row.payment; as pay) {
              <div class="grid grid-cols-2 gap-2">
                <div class="rounded-lg border border-slate-200 px-2 py-1.5">
                  <p class="text-[8px] font-bold uppercase text-slate-400">{{ prefs.t('common.mode') }}</p>
                  <p class="text-[11px] font-bold text-slate-800">{{ pay.mode }}</p>
                </div>
                <div class="rounded-lg border border-slate-200 px-2 py-1.5">
                  <p class="text-[8px] font-bold uppercase text-slate-400">{{ prefs.t('ledger.receiptNo') }}</p>
                  <p class="text-[11px] font-bold text-slate-800">{{ pay.receiptNo }}</p>
                </div>
                @if ((pay.discount || 0) > 0) {
                  <div class="rounded-lg border border-slate-200 px-2 py-1.5">
                    <p class="text-[8px] font-bold uppercase text-slate-400">{{ prefs.t('common.discount') }}</p>
                    <p class="font-mono text-[11px] font-bold text-slate-800">{{ pay.discount | number:'1.2-2' }} TK</p>
                  </div>
                }
                @if ((pay.advance || 0) > 0) {
                  <div class="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5">
                    <p class="text-[8px] font-bold uppercase text-sky-500">{{ prefs.txt('অগ্রিম', 'Advance') }}</p>
                    <p class="font-mono text-[11px] font-bold text-sky-700">{{ pay.advance | number:'1.2-2' }} TK</p>
                  </div>
                }
              </div>
            }

            <div class="rounded-lg bg-slate-50 px-2 py-1.5">
              <p class="text-[8px] font-bold uppercase text-slate-400">{{ prefs.t('common.note') }}</p>
              <p class="text-[10px] font-semibold text-slate-700 break-words">{{ dash(row.note) || '—' }}</p>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
            @if (row.payment) {
              <button (click)="showReceipt(row.payment!)" class="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-800">
                <mat-icon class="text-xs">print</mat-icon> {{ prefs.t('ledger.printReceipt') }}
              </button>
            }
            <button (click)="selectedRow.set(null)" class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">
              {{ prefs.t('common.close') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Receipt preview / print -->
    @if (receipt()) {
      <div class="fixed inset-0 z-[70] bg-slate-900/70 flex items-center justify-center p-3">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div class="px-3 py-2 border-b flex items-center justify-between no-print">
            <span class="font-bold text-slate-700 text-xs">{{ prefs.t('common.receipt') }}</span>
            <div class="flex items-center gap-1">
              <button (click)="printReceipt()" class="bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1">
                <mat-icon class="text-xs">print</mat-icon> {{ prefs.t('common.print') }}
              </button>
              <button (click)="closeReceipt()" class="p-1 text-slate-400 hover:text-slate-700">
                <mat-icon class="text-sm">close</mat-icon>
              </button>
            </div>
          </div>

          <div id="receipt-print-area" class="p-4 text-slate-900">
            <div class="text-center border-b border-dashed border-slate-400 pb-2">
              <p class="font-black text-sm tracking-wide">{{ settings().businessNamePart1 }} {{ settings().businessNamePart2 }}</p>
              <p class="text-[10px]">{{ settings().address }}</p>
              <p class="text-[10px]">{{ prefs.txt('মোবাইল', 'Mobile') }}: {{ settings().mobile }}</p>
              <p class="font-bold text-[11px] mt-1 uppercase">{{ prefs.t('common.receipt') }}</p>
            </div>

            <div class="text-[10px] space-y-0.5 mt-2">
              <div class="flex justify-between"><span>{{ prefs.t('ledger.receiptNo') }}</span><b>{{ receipt()!.receiptNo }}</b></div>
              <div class="flex justify-between"><span>{{ prefs.t('common.date') }}</span><b>{{ formatDate(receipt()!.date) }}</b></div>
              <div class="flex justify-between"><span>{{ prefs.t('common.name') }}</span><b>{{ receipt()!.partyName }}</b></div>
              <div class="flex justify-between"><span>{{ prefs.t('common.phone') }}</span><b>{{ partyPhones(party()).join(', ') || '—' }}</b></div>
              <div class="flex justify-between"><span>{{ prefs.t('common.mode') }}</span><b>{{ receipt()!.mode }}</b></div>
            </div>

            <div class="border-y border-dashed border-slate-400 my-2 py-2">
              <div class="flex justify-between font-black text-sm">
                <span>{{ prefs.t('common.amount') }}</span>
                <span class="font-mono">{{ receipt()!.amount | number:'1.2-2' }} TK</span>
              </div>
              @if (receipt()!.discount > 0) {
                <div class="flex justify-between text-[10px] mt-1">
                  <span>{{ prefs.t('common.discount') }}</span>
                  <span class="font-mono">{{ receipt()!.discount | number:'1.2-2' }} TK</span>
                </div>
              }
              <div class="flex justify-between text-[10px] mt-1 text-slate-600">
                <span>{{ isSupplier() ? prefs.txt('প্রদেয়', 'Payable') : prefs.t('ledger.dueAmount') }}</span>
                <span class="font-mono">{{ (account().due < 0 ? -account().due : account().due) | number:'1.2-2' }} TK</span>
              </div>
            </div>

            @if (receipt()!.note) {
              <p class="text-[10px] text-slate-600">{{ prefs.t('common.note') }}: {{ receipt()!.note }}</p>
            }
            <p class="text-[10px] text-center mt-2">{{ prefs.t('ledger.receivedWithThanks') }}</p>
            <div class="mt-6 text-center text-[10px] border-t border-slate-400 pt-1">{{ prefs.t('ledger.authorizedBy') }}</div>
          </div>
        </div>
      </div>
    }

    @if (showReminder()) {
      <app-party-reminder-dialog [party]="party()" mode="set" (closed)="showReminder.set(false)" />
    }

    @if (showStatement()) {
      <app-party-statement
        [party]="party()"
        [side]="bookSide()"
        [rows]="rows()"
        [deposits]="deposits()"
        [openingBalance]="openingBalance()"
        [account]="account()"
        [depositTotal]="depositTotal()"
        (close)="showStatement.set(false)" />
    }
  `
})
export class PartyLedger implements OnInit {
  readonly party = input.required<Party>();
  protected readonly partyPhones = partyPhones;
  readonly autoPay = input<boolean>(false);
  /** Open straight into the payment form, without the profile drawer behind it. */
  readonly paymentOnly = input<boolean>(false);
  /** Prefills the amount box, e.g. the promised taka when collecting from the reminder board. */
  readonly paymentPrefill = input<number>(0);
  /** Preselect a book, e.g. purchases when opened from the supplier list. */
  readonly side = input<PartySide | undefined>(undefined);
  readonly close = output<void>();
  readonly edit = output<void>();
  /** Admin-only opening-balance correction, opened by the host page. */
  readonly canFixOpening = input<boolean>(false);
  readonly fixOpening = output<void>();
  /** Emits each saved receipt so hosts (the reminder board) can update the promise. */
  readonly paymentSaved = output<LedgerPayment>();

  private lastPartyId: number | null = null;
  private lastProfileKey = '';

  /** Latest dated promise; shown as one compact line above the profile tabs. */
  readonly reminderSummary = computed(() => {
    const promise = this.party().paymentPromise;
    if (!promise) return null;
    const remaining = promiseRemaining(this.party());
    if (remaining <= 0) return null;
    const overdue = this.dateValue(promise.date) < this.dateValue(localDateIso());
    return {
      title: this.prefs.txt('প্রতিশ্রুত তারিখ', 'Promised'),
      amount: `${this.formatDate(promise.date)} · ${promise.amount.toFixed(2)}`,
      left: remaining < promise.amount
        ? `${this.prefs.txt('বাকি', 'Left')} ${remaining.toFixed(2)} TK`
        : '',
      overdue
    };
  });
  showReminder = signal<boolean>(false);

  constructor() {
    effect(() => {
      const id = this.party().id;
      if (this.lastPartyId !== null && this.lastPartyId !== id) this.profileTab.set('history');
      this.lastPartyId = id;
    });
    // A profile can hold years of vouchers; render one window at a time instead
    // of the whole history, so opening a ledger never builds thousands of rows.
    effect(() => {
      const key = `${this.party().id}|${this.profileTab()}|${this.activeSide()}`;
      if (key === this.lastProfileKey) return;
      this.lastProfileKey = key;
      this.historyLimit.set(PROFILE_ROWS);
      this.depositsLimit.set(PROFILE_ROWS);
      this.salesLimit.set(PROFILE_ROWS);
      this.purchaseLimit.set(PROFILE_ROWS);
    });
  }

  dataService = inject(DataService);
  session = inject(SessionService);
  prefs = inject(PreferencesService);

  showPayment = signal<boolean>(false);
  showReturn = signal<boolean>(false);
  showStatement = signal<boolean>(false);
  receipt = signal<LedgerPayment | null>(null);
  savedMsg = signal<string>('');
  formError = signal<string>('');
  selectedRow = signal<LedgerRow | null>(null);

  readonly DETAILS_PREVIEW = 10;
  showAllDetails = signal<boolean>(false);
  visibleDetails = computed(() =>
    this.showAllDetails() ? this.details() : this.details().slice(0, this.DETAILS_PREVIEW)
  );

  openRow(row: LedgerRow) {
    this.selectedRow.set(row);
  }

  payAmount: number | null = null;
  payDiscount: number | null = null;
  payMode: LedgerPayment['mode'] = 'Cash';
  payDate = localDateIso();
  payNote = '';

  returnAmount: number | null = null;
  returnDate = localDateIso();
  returnNote = '';

  settings = computed(() => this.dataService.voucherSettings());

  /** The two books live side by side; the drawer shows one at a time. */
  readonly activeSide = signal<PartySide | null>(null);
  readonly account = computed(() => accountOf(this.party(), this.bookSide()));
  readonly isSupplier = computed(() => this.bookSide() === 'purchase');
  readonly bookSide = computed<PartySide>(() => {
    const preset = this.activeSide() ?? this.side();
    return preset ?? this.defaultSide();
  });
  readonly sideStats = computed(() => ({
    sales: salesAccountOf(this.party()),
    purchase: purchaseAccountOf(this.party())
  }));
  readonly sideChoices = computed<PartySide[]>(() => {
    const p = this.party();
    const sales = hasSalesRole(p) || this.sideStats().sales.total > 0 || this.sideStats().sales.due !== 0;
    const purchase = hasPurchaseRole(p) || this.sideStats().purchase.total > 0 || this.sideStats().purchase.due !== 0;
    const list: PartySide[] = [];
    if (sales) list.push('sales');
    if (purchase) list.push('purchase');
    return list.length ? list : ['sales'];
  });
  readonly showSideTabs = computed(() => this.sideChoices().length > 1);

  private defaultSide(): PartySide {
    const choices = this.sideChoices();
    return choices.includes('sales') ? 'sales' : 'purchase';
  }

  setSide(side: PartySide) {
    this.activeSide.set(side);
  }

  readonly profileTab = signal<ProfileTab>('history');

  readonly salesInvoices = computed(() => {
    const party = this.party();
    return this.dataService.sales()
      .filter(sale => this.sameName(sale.customerName, party.name) && sale.status !== 'Cancelled')
      .sort((a, b) => this.dateValue(b.date) - this.dateValue(a.date));
  });

  readonly purchaseInvoices = computed(() => {
    const party = this.party();
    return this.dataService.purchases()
      .filter(purchase => this.sameName(purchase.supplierName, party.name))
      .sort((a, b) => this.dateValue(b.date) - this.dateValue(a.date));
  });

  /** Categories the party actually has data for; info is always available. */
  readonly profileTabs = computed(() => {
    const tabs: { key: ProfileTab; bn: string; en: string; icon: string; count?: number }[] = [
      { key: 'history', bn: 'লেনদেন ইতিহাস', en: 'Transaction history', icon: 'receipt_long', count: this.rows().length },
      { key: 'deposits', bn: 'জমার ইতিহাস', en: 'Deposit history', icon: 'savings', count: this.deposits().length }
    ];
    if (this.sideChoices().includes('sales')) {
      tabs.push({ key: 'sales', bn: 'সেলস হিসাব', en: 'Sales account', icon: 'trending_up', count: this.salesInvoices().length });
    }
    if (this.sideChoices().includes('purchase')) {
      tabs.push({ key: 'purchase', bn: 'ক্রয় হিসাব', en: 'Purchase account', icon: 'shopping_cart', count: this.purchaseInvoices().length });
    }
    tabs.push({ key: 'info', bn: 'প্রোফাইল তথ্য', en: 'Profile details', icon: 'contact_page' });
    return tabs;
  });

  readonly activeProfileTab = computed<ProfileTab>(() => {
    const active = this.profileTab();
    return this.profileTabs().some(tab => tab.key === active) ? active : 'history';
  });

  /** Jumps from an invoice row into the matching ledger entry and its detail card. */
  openInvoice(kind: 'sale' | 'purchase', invoice: string) {
    this.profileTab.set('history');
    this.setSide(kind === 'purchase' ? 'purchase' : 'sales');
    const row = this.rows().find(item => item.type === kind && item.ref === invoice);
    if (row) this.selectedRow.set(row);
  }

  paymentClass(status: 'Paid' | 'Unpaid' | 'Partially Paid'): string {
    if (status === 'Paid') return 'bg-emerald-50 text-emerald-700';
    if (status === 'Partially Paid') return 'bg-amber-50 text-amber-700';
    return 'bg-rose-50 text-rose-700';
  }

  paymentLabel(status: 'Paid' | 'Unpaid' | 'Partially Paid'): string {
    if (status === 'Paid') return this.prefs.txt('পরিশোধিত', 'Paid');
    if (status === 'Partially Paid') return this.prefs.txt('আংশিক', 'Partial');
    return this.prefs.txt('বাকি', 'Unpaid');
  }

  dash(value?: string): string {
    const v = (value || '').trim();
    return v && v !== '-' && v.toUpperCase() !== 'N/A' ? v : '';
  }

  roleLabel(role: Party['type']): string {
    if (role === 'Supplier') return this.prefs.txt('সরবরাহকারী', 'Supplier');
    if (role === 'Dealer') return this.prefs.txt('ডিলার', 'Dealer');
    if (role === 'Staff Member') return this.prefs.txt('স্টাফ', 'Staff');
    if (role === 'Corporate Customer') return this.prefs.txt('কর্পোরেট', 'Corporate');
    return this.prefs.txt('কাস্টমার', 'Customer');
  }

  roleLabels(): string[] {
    return partyRoles(this.party()).map(role => this.roleLabel(role));
  }

  sideLabel(side: PartySide): string {
    return side === 'purchase' ? this.prefs.txt('ক্রয় হিসাব', 'Purchase book') : this.prefs.txt('বিক্রয় হিসাব', 'Sales book');
  }

  /** Placeholder avatars from old seed data show random photos, so fall back to initials. */
  avatarUrl(): string {
    const url = this.party().profileImage || '';
    return url && !url.includes('picsum.photos') ? url : '';
  }

  initials(): string {
    return (this.party().name || '?').trim().charAt(0).toUpperCase();
  }

  headline(): string {
    const p = this.party();
    return [this.dash(p.companyName), this.dash(p.zone), this.dash(p.inHand)].filter(Boolean).join(' · ');
  }

  location(): string {
    const p = this.party();
    const parts = [p.areaRoadHouse, p.thana, p.upazila, p.district, p.division]
      .map(value => this.dash(value))
      .filter(Boolean);
    return Array.from(new Set(parts)).join(', ');
  }

  memberSince(): string {
    const raw = this.dash(this.party().createdAt);
    return raw ? this.formatDate(raw) : '';
  }

  readonly details = computed(() => {
    const p = this.party();
    const money = (value?: number | string | null) => `${this.num(value).toFixed(2)} TK`;
    const clean = (value?: string) => (value && value !== '-' ? value : '');
    const items: { label: string; value: string }[] = [
      { label: this.prefs.txt('রোল', 'Roles'), value: partyRoles(p).join(', ') },
      { label: this.prefs.txt('ভূমিকা', 'Role'), value: clean(p.role) },
      { label: this.prefs.txt('স্ট্যাটাস', 'Status'), value: clean(p.status) },
      { label: this.prefs.txt('ফোন', 'Phone'), value: partyPhones(p).join(', ') },
      { label: this.prefs.txt('ইমেইল', 'Email'), value: clean(p.email) },
      { label: this.prefs.txt('ঠিকানা', 'Address'), value: clean(p.address) },
      { label: this.prefs.txt('বিভাগ', 'Division'), value: clean(p.division) },
      { label: this.prefs.txt('জেলা', 'District'), value: clean(p.district) },
      { label: this.prefs.txt('উপজেলা', 'Upazila'), value: clean(p.upazila) },
      { label: this.prefs.txt('থানা', 'Thana'), value: clean(p.thana) },
      { label: this.prefs.txt('এলাকা', 'Area'), value: clean(p.areaRoadHouse) },
      { label: this.prefs.txt('জোন', 'Zone'), value: clean(p.zone) },
      { label: this.prefs.txt('ওয়্যারহাউস', 'Warehouse'), value: clean(p.warehouse) },
      { label: this.prefs.txt('হাতে', 'In Hand'), value: clean(p.inHand) },
      { label: this.prefs.txt('অগ্রিম', 'Advance'), value: this.account().advance ? money(this.account().advance) : '' },
      { label: this.prefs.txt('ক্রেডিট পিরিয়ড', 'Credit Period'), value: p.creditPeriod ? `${p.creditPeriod} ${this.prefs.txt('দিন', 'days')}` : '' },
      { label: this.prefs.txt('ক্রেডিট লিমিট', 'Credit Limit'), value: p.creditLimit ? money(p.creditLimit) : '' },
      {
        label: this.prefs.txt('ওপেনিং ব্যালান্স', 'Opening Balance'),
        value: this.openingBalance()
          ? `${money(Math.abs(this.openingBalance()))} (${this.openingBalance() < 0 ? 'Receive' : 'Pay'})`
          : ''
      },
      { label: this.prefs.txt('ট্যাক্স নম্বর', 'Tax Number'), value: clean(p.taxNumber) },
      { label: this.prefs.txt('ডকুমেন্ট', 'Documents'), value: clean(p.documents) },
      { label: this.prefs.txt('পরবর্তী পেমেন্ট', 'Next Payment'), value: clean(p.nextPayment) },
      {
        label: this.prefs.txt('প্রতিশ্রুত তারিখ', 'Promised Date'),
        value: p.paymentPromise
          ? `${this.formatDate(p.paymentPromise.date)} · ${this.num(p.paymentPromise.amount).toFixed(2)} TK${this.num(p.paymentPromise.received) > 0 ? ` (${this.prefs.txt('আদায়', 'collected')} ${this.num(p.paymentPromise.received).toFixed(2)})` : ''}`
          : ''
      },
      { label: this.prefs.txt('রিমাইন্ডার ইতিহাস', 'Reminder History'), value: p.paymentPromise?.history?.length ? `${p.paymentPromise.history.length}` : '' },
      { label: this.prefs.txt('রিমার্কস', 'Remarks'), value: clean(p.remarks) },
      { label: this.prefs.txt('সদস্য', 'Member Since'), value: p.createdAt ? this.formatDate(p.createdAt) : '' }
    ];
    return items.filter(item => item.value);
  });

  rows = computed<LedgerRow[]>(() => {
    const party = this.party();
    const supplier = this.bookSide() === 'purchase';
    const list: LedgerRow[] = [];

    if (supplier) {
      for (const p of this.dataService.purchases().filter(x => this.sameName(x.supplierName, party.name))) {
        list.push({
          key: `pur-${p.id}`, date: p.date, type: 'purchase', ref: p.invoice,
          note: p.notes === '-' ? '' : p.notes, debit: 0, credit: this.num(p.total), balance: 0
        });
      }
      list.push(...this.voucherPaymentRows(party));
    } else {
      for (const s of this.dataService.sales().filter(x => this.sameName(x.customerName, party.name) && x.status !== 'Cancelled')) {
        list.push({
          key: `sale-${s.id}`, date: s.date, type: 'sale', ref: s.invoice,
          note: [s.notes && s.notes !== '-' ? s.notes : '', s.status].filter(Boolean).join(' · '),
          debit: this.num(s.total), credit: 0, balance: 0
        });
        const credits = this.num(this.dataService.saleCredits(s));
        if (credits > 0) {
          list.push({
            key: `scred-${s.id}`, date: s.date, type: 'payment', ref: s.invoice,
            note: this.prefs.txt('ব্যাটারি / ফেরত সমন্বয়', 'Battery / return adjustment'), debit: 0, credit: credits, balance: 0
          });
        }
      }
      list.push(...this.voucherPaymentRows(party));
      list.push(...this.creditNoteRows(party));
    }

    for (const pay of this.paymentsOf(party)) {
      const settled = this.paymentSettlement(pay);
      list.push({
        key: `pay-${pay.id}`, date: pay.date, type: 'payment', ref: pay.receiptNo,
        note: pay.note, debit: supplier ? settled : 0, credit: supplier ? 0 : settled, balance: 0, payment: pay
      });
    }

    if (supplier) {
      for (const ret of this.dataService.supplierReturns().filter(x => x.partyId === party.id && this.dataService.supplierReturnPosts(x.status))) {
        list.push({
          key: `ret-${ret.id}`, date: ret.date, type: 'return', ref: ret.returnNo,
          note: ret.note, debit: this.num(ret.amount), credit: 0, balance: 0
        });
      }
    }

    list.sort((a, b) => this.dateValue(a.date) - this.dateValue(b.date));
    let running = this.openingBalance();
    for (const row of list) {
      running += supplier ? row.credit - row.debit : row.debit - row.credit;
      row.balance = Math.round(running * 100) / 100;
    }
    return list;
  });

  ngOnInit() {
    if (this.paymentOnly() || this.autoPay()) this.openPayment();
  }

  openingBalance = computed(() => this.dataService.partyOpeningBalance(this.party(), this.bookSide()));

  lastPayment = computed(() => {
    const list = this.paymentsOf(this.party())
      .slice()
      .sort((a, b) => this.dateValue(b.date) - this.dateValue(a.date));
    return list[0] || null;
  });

  /** Receipts belong to the book they settled; a dual-role party has both kinds. */
  private paymentSide(pay: LedgerPayment): PartySide {
    if (pay.partyType === 'Supplier') return 'purchase';
    if (pay.partyType === 'Customer') return 'sales';
    return this.bookSide();
  }

  private paymentsOf(party: Party): LedgerPayment[] {
    const side = this.bookSide();
    return this.dataService.payments()
      .filter(x => (x.partyId === party.id || this.sameName(x.partyName, party.name)) && this.paymentSide(x) === side);
  }

  /** Every taka the party actually handed over: payment-book receipts plus money settled inside vouchers. */
  readonly deposits = computed<DepositRow[]>(() => {
    const party = this.party();
    const supplier = this.bookSide() === 'purchase';
    const list: DepositRow[] = [];

    for (const pay of this.paymentsOf(party)) {
      const amount = this.num(pay.amount);
      if (amount <= 0) continue;
      const discount = this.num(pay.discount);
      const note = [pay.note, discount > 0 ? `${this.prefs.txt('ডিসকাউন্ট', 'Discount')} ${discount.toFixed(2)} TK` : '']
        .filter(Boolean)
        .join(' · ');
      list.push({
        key: `pay-${pay.id}`,
        at: this.momentValue(pay.date, pay.createdAt),
        dateLabel: this.formatDate(pay.date),
        time: this.timeOf(pay.date, pay.createdAt),
        mode: pay.mode || 'Cash',
        amount,
        ref: pay.receiptNo,
        note
      });
    }

    if (supplier) {
      for (const p of this.dataService.purchases()
        .filter(x => this.sameName(x.supplierName, party.name) && this.num(x.paid) > 0)) {
        list.push({
          key: `vpur-${p.id}`,
          at: this.momentValue(p.date, p.createdAt),
          dateLabel: this.formatDate(p.date),
          time: this.timeOf(p.date, p.createdAt),
          mode: p.paymentMode || 'Cash',
          amount: this.num(p.paid),
          ref: p.invoice,
          note: this.dash(p.notes) || this.prefs.txt('ভাউচারে পরিশোধ', 'Paid in voucher')
        });
      }
    } else {
      for (const s of this.dataService.sales()
        .filter(x => this.sameName(x.customerName, party.name) && x.status !== 'Cancelled' && this.num(x.paid) > 0)) {
        list.push({
          key: `vpay-${s.id}`,
          at: this.momentValue(s.date),
          dateLabel: this.formatDate(s.date),
          time: '',
          mode: s.paymentMode || 'Cash',
          amount: this.num(s.paid),
          ref: s.invoice,
          note: this.dash(s.notes) || this.prefs.txt('ভাউচারে জমা', 'Received in voucher')
        });
      }
    }

    return list.sort((a, b) => b.at - a.at);
  });

  readonly depositTotal = computed(() => Math.round(this.deposits().reduce((sum, row) => sum + row.amount, 0) * 100) / 100);

  // Bounded windows: totals still use the full lists, only the visible rows are built.
  readonly historyLimit = signal(PROFILE_ROWS);
  readonly depositsLimit = signal(PROFILE_ROWS);
  readonly salesLimit = signal(PROFILE_ROWS);
  readonly purchaseLimit = signal(PROFILE_ROWS);

  readonly visibleHistoryRows = computed(() => this.rows().slice(0, this.historyLimit()));
  readonly visibleDeposits = computed(() => this.deposits().slice(0, this.depositsLimit()));
  readonly visibleSalesInvoices = computed(() => this.salesInvoices().slice(0, this.salesLimit()));
  readonly visiblePurchaseInvoices = computed(() => this.purchaseInvoices().slice(0, this.purchaseLimit()));

  showMore(limit: WritableSignal<number>, total: number) {
    limit.set(Math.min(total, limit() + PROFILE_ROWS));
  }

  /** Entry time is only shown when the receipt was recorded on the same day it is dated for. */
  private timeOf(date: string, createdAt?: string): string {
    if (!createdAt) return '';
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return '';
    const day = new Date(this.dateValue(date));
    if (!day.getTime()) return '';
    if (day.getFullYear() !== created.getFullYear() || day.getMonth() !== created.getMonth() || day.getDate() !== created.getDate()) return '';
    return created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  private momentValue(date: string, createdAt?: string): number {
    const day = this.dateValue(date);
    if (!createdAt) return day;
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return day;
    return day + created.getHours() * 3600000 + created.getMinutes() * 60000 + created.getSeconds() * 1000;
  }

  /**
   * Money settled inside a voucher (Sale.paid / Purchase.paid) never reaches the
   * party payment book, so the statement would show the party as fully unpaid.
   */
  private voucherPaymentRows(party: Party): LedgerRow[] {
    if (this.bookSide() === 'purchase') {
      return this.dataService.purchases()
        .filter(p => this.sameName(p.supplierName, party.name) && this.num(p.paid) > 0)
        .map(p => ({
          key: `vpur-${p.id}`, date: p.date, type: 'payment' as const, ref: p.invoice,
          note: this.prefs.txt('ভাউচারে পরিশোধ', 'Paid in voucher'), debit: this.num(p.paid), credit: 0, balance: 0
        }));
    }
    return this.dataService.sales()
      .filter(s => this.sameName(s.customerName, party.name) && s.status !== 'Cancelled' && this.num(s.paid) > 0)
      .map(s => ({
        key: `vpay-${s.id}`, date: s.date, type: 'payment' as const, ref: s.invoice,
        note: this.prefs.txt('ভাউচারে জমা', 'Received in voucher'), debit: 0, credit: this.num(s.paid), balance: 0
      }));
  }

  /** Posted credit notes settle part of an invoice without changing its printed total. */
  private creditNoteRows(party: Party): LedgerRow[] {
    const key = (party.name || '').trim().toLowerCase();
    return this.dataService.salesReturns()
      .filter(r => r.status === 'Posted' && (r.customerName || '').trim().toLowerCase() === key)
      .map(r => ({
        key: `sret-${r.id}`, date: r.date, type: 'return' as const, ref: r.creditNoteNo,
        note: this.prefs.txt('ক্রেডিট নোট', 'Credit note'), debit: 0, credit: this.num(r.amount), balance: 0
      }));
  }

  openPayment() {
    const prefill = this.num(this.paymentPrefill());
    this.payAmount = prefill > 0 ? prefill : null;
    this.payDiscount = 0;
    this.payMode = 'Cash';
    this.payDate = localDateIso();
    this.payNote = '';
    this.formError.set('');
    this.showPayment.set(true);
  }

  /** In payment-only mode dismissing the form closes the whole overlay. */
  closePayment() {
    this.showPayment.set(false);
    if (this.paymentOnly()) this.close.emit();
  }

  closeReceipt() {
    this.receipt.set(null);
    if (this.paymentOnly()) this.close.emit();
  }

  openReturn() {
    this.returnAmount = null;
    this.returnDate = localDateIso();
    this.returnNote = '';
    this.formError.set('');
    this.showReturn.set(true);
  }

  savePayment() {
    const amount = Number(this.payAmount) || 0;
    const discount = Number(this.payDiscount) || 0;
    if (amount <= 0) {
      this.formError.set(this.prefs.t('ledger.invalidAmount'));
      return;
    }
    const payment = this.dataService.recordPayment({
      partyId: this.party().id,
      partyName: this.party().name,
      partyType: this.isSupplier() ? 'Supplier' : 'Customer',
      side: this.bookSide(),
      amount,
      discount,
      mode: this.payMode,
      date: this.payDate,
      note: this.payNote
    });
    this.session.log(
      this.isSupplier() ? 'Supplier Payment' : 'Payment Received',
      `${this.party().name} — ${amount.toFixed(2)} TK (${payment.receiptNo})`
    );
    this.savedMsg.set(this.prefs.t('ledger.paymentSaved') + ` (${payment.receiptNo})`);
    this.showPayment.set(false);
    this.receipt.set(payment);
    this.paymentSaved.emit(payment);
  }

  saveReturn() {
    const amount = Number(this.returnAmount) || 0;
    if (amount <= 0) {
      this.formError.set(this.prefs.t('ledger.invalidAmount'));
      return;
    }
    const ret = this.dataService.recordSupplierReturn({
      partyId: this.party().id,
      partyName: this.party().name,
      amount,
      date: this.returnDate,
      note: this.returnNote
    });
    this.session.log('Supplier Return', `${this.party().name} — ${amount.toFixed(2)} TK (${ret.returnNo})`);
    this.savedMsg.set(this.prefs.t('ledger.returnSaved') + ` (${ret.returnNo})`);
    this.showReturn.set(false);
  }

  showReceipt(payment: LedgerPayment) {
    this.receipt.set(payment);
  }

  printReceipt() {
    const styleId = 'receipt-page-size';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = '@page { size: 80mm auto; margin: 4mm; }';
      document.head.appendChild(style);
    }
    setTimeout(() => {
      window.print();
      setTimeout(() => document.getElementById(styleId)?.remove(), 800);
    }, 80);
  }

  formatDate(value: string): string {
    const parsed = this.dateValue(value);
    if (!parsed) return value || '-';
    const d = new Date(parsed);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}-${month}-${d.getFullYear()}`;
  }

  typeLabel(type: LedgerRow['type']): string {
    switch (type) {
      case 'sale': return this.prefs.t('ledger.sales');
      case 'purchase': return this.prefs.t('ledger.purchases');
      case 'payment': return this.prefs.t('ledger.payments');
      case 'return': return this.prefs.t('ledger.returns');
      default: return this.prefs.t('ledger.opening');
    }
  }

  badgeClass(type: LedgerRow['type']): string {
    const base = 'inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ';
    if (type === 'payment') return base + 'bg-emerald-100 text-emerald-700';
    if (type === 'return') return base + 'bg-amber-100 text-amber-700';
    if (type === 'sale') return base + 'bg-rose-100 text-rose-700';
    return base + 'bg-slate-100 text-slate-600';
  }

  private sameName(a: string | undefined, b: string | undefined): boolean {
    return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()
      && (a || '').trim().length > 0;
  }

  /** Only the part of a receipt that cleared a due moves the statement; the excess is an advance. */
  private paymentSettlement(pay: LedgerPayment): number {
    return this.num(this.num(pay.amount) + this.num(pay.discount) - this.num(pay.advance));
  }

  /** Imported or legacy rows can hold strings; money maths must never produce NaN. */
  private num(value?: number | string | null): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private dateValue(value: string): number {
    if (!value) return 0;
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]).getTime();
    const dmy = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]).getTime();
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
