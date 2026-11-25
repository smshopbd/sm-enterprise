import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, LedgerPayment, Party, hasSalesRole, isWalkInCustomer, salesAccountOf } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { SessionService } from '../../../services/session';
import { PreferencesService } from '../../../services/preferences';
import { localizeAddress } from '../../../utils/bd-geo';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { localDateIso } from '../../../utils/local-date';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';

const MODES: LedgerPayment['mode'][] = ['Cash', 'Bank', 'bKash', 'Nagad'];

const MODE_META: Record<LedgerPayment['mode'], { label: string; icon: string; tile: string }> = {
  Cash: { label: 'Cash', icon: 'payments', tile: 'bg-emerald-600' },
  Bank: { label: 'Bank', icon: 'account_balance', tile: 'bg-cyan-700' },
  bKash: { label: 'bKash', icon: 'smartphone', tile: 'bg-pink-600' },
  Nagad: { label: 'Nagad', icon: 'phone_android', tile: 'bg-orange-500' }
};

@Component({
  selector: 'app-payment-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, DmyDateDirective],
  styles: `
    .pt-sticky { position: sticky; top: 0; z-index: 5; background-color: var(--sm-brand, #0d9488); }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none dark:text-slate-200">

      <section class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
        <div class="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">price_check</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                <span>{{ prefs.txt('বিক্রয়', 'Sales') }}</span>
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                <span>{{ prefs.txt('পেমেন্ট গ্রহণ', 'Payment In') }}</span>
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('পেমেন্ট গ্রহণ', 'Payment In') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('গ্রাহকের কাছ থেকে জমা — বিক্রয় বিল, পূর্বের বকেয়া বা অগ্রিম।', 'Collect from customers — sales bills, old dues or advances.') }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button (click)="exportExcel()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon class="text-sm text-emerald-200">description</mat-icon> {{ prefs.txt('এক্সেল', 'Excel') }}
            </button>
            <button (click)="printPage()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon class="text-sm">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
            <button (click)="openAdd()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon class="text-sm">add</mat-icon> {{ prefs.txt('নতুন জমা', 'New collection') }}
            </button>
          </div>
        </div>
      </section>

      <section class="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div class="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <mat-icon class="text-lg">savings</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{{ prefs.txt('মোট জমা', 'Total received') }}</p>
              <p class="truncate font-mono text-base font-bold text-slate-900 dark:text-white">৳ {{ totals().amount | number:'1.2-2' }}</p>
            </div>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/60 dark:text-teal-300">
              <mat-icon class="text-lg">today</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{{ prefs.txt('আজকের জমা', "Today's received") }}</p>
              <p class="truncate font-mono text-base font-bold text-teal-700 dark:text-teal-300">৳ {{ totals().today | number:'1.2-2' }}</p>
            </div>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
              <mat-icon class="text-lg">local_offer</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{{ prefs.txt('ডিসকাউন্ট / মাফ', 'Discount / waiver') }}</p>
              <p class="truncate font-mono text-base font-bold text-amber-600 dark:text-amber-400">৳ {{ totals().discount | number:'1.2-2' }}</p>
            </div>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <mat-icon class="text-lg">receipt_long</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{{ activeTabLabel() }}</p>
              <p class="truncate font-mono text-base font-bold text-slate-900 dark:text-white">{{ filtered().length }} {{ prefs.txt('টি রসিদ', 'receipts') }}</p>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex items-center gap-2 overflow-x-auto pb-0.5">
            @for (t of tabs(); track t.value) {
              @if (activeTab() === t.value) {
                <button (click)="setTab(t.value)" class="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 py-2 text-[11.5px] font-bold text-white shadow-sm shadow-teal-900/20 cursor-pointer">
                  <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
                  <span>{{ t.label }}</span>
                  <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/25 px-1.5 text-[10px] font-black">{{ tabCount(t.value) }}</span>
                </button>
              } @else {
                <button (click)="setTab(t.value)" class="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-transparent px-3.5 py-2 text-[11.5px] font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer">
                  <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
                  <span>{{ t.label }}</span>
                  <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-black text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{{ tabCount(t.value) }}</span>
                </button>
              }
            }
          </div>
          <div class="relative w-full lg:max-w-sm">
            <mat-icon class="absolute left-3 top-2.5 text-sm text-slate-400">search</mat-icon>
            <input
              type="text"
              [placeholder]="prefs.txt('রশিদ নম্বর বা গ্রাহকের নাম দিয়ে খুঁজুন...', 'Search by receipt no or customer name...')"
              [value]="searchQuery()"
              (input)="onSearch($event)"
              class="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-[11.5px] text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>
      </section>

      <div class="list-print-shell hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:block">
        <div id="list-printable-area" class="max-h-[72vh] overflow-auto">
          <table class="w-full min-w-[1080px] border-collapse text-left text-xs text-slate-700 dark:text-slate-200">
            <thead>
              <tr class="text-[10.5px] font-bold uppercase tracking-wider text-white">
                <th class="pt-sticky w-10 p-2.5 text-center">SL</th>
                <th class="pt-sticky p-2.5">{{ prefs.txt('রশিদ', 'RECEIPT NO') }}</th>
                <th class="pt-sticky p-2.5">{{ prefs.txt('তারিখ', 'DATE') }}</th>
                <th class="pt-sticky p-2.5">{{ prefs.txt('গ্রাহক', 'CUSTOMER') }}</th>
                <th class="pt-sticky p-2.5 text-right">{{ prefs.txt('পরিমাণ', 'AMOUNT') }}</th>
                <th class="pt-sticky p-2.5 text-right">{{ prefs.txt('ডিসকাউন্ট', 'DISCOUNT') }}</th>
                <th class="pt-sticky p-2.5 text-center">{{ prefs.txt('মাধ্যম', 'MODE') }}</th>
                <th class="pt-sticky min-w-[180px] p-2.5">{{ prefs.txt('নোট', 'NOTE') }}</th>
                <th class="pt-sticky w-20 p-2.5 text-center">{{ prefs.txt('অ্যাকশন', 'ACTION') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              @for (p of pager.paged(); track p.id; let idx = $index) {
                <tr class="transition-colors hover:bg-teal-50/60 dark:hover:bg-slate-800/70">
                  <td class="p-2.5 text-center font-bold text-slate-500 dark:text-slate-400">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-mono font-bold text-teal-800 dark:text-teal-300">{{ p.receiptNo }}</td>
                  <td class="p-2.5 whitespace-nowrap">{{ displayDate(p.date) }}</td>
                  <td class="p-2.5 font-bold text-slate-800 dark:text-slate-100">{{ p.partyName }}</td>
                  <td class="p-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{{ p.amount | number:'1.2-2' }} TK</td>
                  <td class="p-2.5 text-right font-mono text-amber-600 dark:text-amber-400">{{ p.discount | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-center">
                    <span class="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{{ modeLabel(p.mode) }}</span>
                  </td>
                  <td class="p-2.5"><div class="max-w-[220px] truncate" [title]="p.note">{{ p.note || '-' }}</div></td>
                  <td class="p-2.5 text-center">
                    <div class="flex items-center justify-center gap-1">
                      @if (session.has('deleteRecords') && canEditMoney()) {
                        <button (click)="openEdit(p)" class="rounded-md p-1 text-teal-700 transition hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-950/50 cursor-pointer" [title]="prefs.txt('রশিদ সংশোধন করুন — নম্বর অপরিবর্তিত থাকবে', 'Edit receipt — number stays the same')">
                          <mat-icon class="text-sm">edit</mat-icon>
                        </button>
                        <button (click)="deleteRecord(p.id)" class="rounded-md p-1 text-rose-600 transition hover:bg-rose-100 dark:hover:bg-rose-950/50 cursor-pointer" [title]="prefs.txt('রশিদ মুছুন (হিসাব সমন্বয় হবে)', 'Delete receipt (account will be adjusted)')">
                          <mat-icon class="text-sm">delete</mat-icon>
                        </button>
                      } @else {
                        <span class="text-[10px] text-slate-400">—</span>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="9" class="p-10 text-center">
                    <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
                      <span class="grid h-12 w-12 place-items-center rounded-full bg-slate-100 dark:bg-slate-800">
                        <mat-icon class="text-2xl text-slate-300 dark:text-slate-600">receipt</mat-icon>
                      </span>
                      <p class="text-xs font-semibold">{{ prefs.txt('এই মাধ্যমে এখনো কোনো জমা নেই।', 'No collection found for this mode yet.') }}</p>
                    </div>
                  </td>
                </tr>
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

      <div class="no-print divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900 lg:hidden">
        @for (p of pager.paged(); track p.id; let idx = $index) {
          <div class="space-y-2.5 p-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-bold text-teal-800 dark:text-teal-300">{{ p.partyName }}</p>
                <p class="font-mono text-[10px] text-slate-500 dark:text-slate-400">{{ p.receiptNo }} • SL {{ pager.offset() + idx + 1 }}</p>
              </div>
              <span class="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{{ modeLabel(p.mode) }}</span>
            </div>

            <div class="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2 text-center dark:bg-slate-950/60">
              <div>
                <p class="text-[9px] font-bold uppercase text-emerald-500">{{ prefs.txt('জমা', 'Received') }}</p>
                <p class="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{{ p.amount | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-[9px] font-bold uppercase text-amber-500">{{ prefs.txt('ডিসকাউন্ট', 'Discount') }}</p>
                <p class="font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400">{{ p.discount | number:'1.2-2' }}</p>
              </div>
            </div>

            <div class="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
              <span class="inline-flex items-center gap-1"><mat-icon class="text-xs">event</mat-icon>{{ displayDate(p.date) }}</span>
              <span class="max-w-[50%] truncate" [title]="p.note">{{ p.note || prefs.txt('নোট নেই', 'No note') }}</span>
            </div>

            @if (session.has('deleteRecords') && canEditMoney()) {
              <div class="grid grid-cols-2 gap-2">
                <button (click)="openEdit(p)" class="inline-flex items-center justify-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1.5 text-[11px] font-bold text-teal-700 transition hover:bg-teal-100 dark:border-teal-900 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:bg-teal-900/50 cursor-pointer">
                  <mat-icon class="text-sm">edit</mat-icon> {{ prefs.txt('সংশোধন', 'Edit') }}
                </button>
                <button (click)="deleteRecord(p.id)" class="inline-flex items-center justify-center gap-1 rounded-lg bg-rose-600 px-2 py-1.5 text-[11px] font-bold text-white transition hover:bg-rose-700 cursor-pointer">
                  <mat-icon class="text-sm">delete</mat-icon> {{ prefs.txt('মুছুন', 'Delete') }}
                </button>
              </div>
            }
          </div>
        } @empty {
          <div class="p-8 text-center">
            <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
              <span class="grid h-12 w-12 place-items-center rounded-full bg-slate-100 dark:bg-slate-800">
                <mat-icon class="text-2xl text-slate-300 dark:text-slate-600">receipt</mat-icon>
              </span>
              <p class="text-xs font-semibold">{{ prefs.txt('এই মাধ্যমে এখনো কোনো জমা নেই।', 'No collection found for this mode yet.') }}</p>
            </div>
          </div>
        }

        <app-table-pagination
          [total]="pager.total()"
          [page]="pager.currentPage()"
          [pageSize]="pager.pageSize()"
          (pageChange)="pager.setPage($event)"
          (pageSizeChange)="pager.setPageSize($event)"
        />
      </div>
    </div>

    @if (showDrawer()) {
      <div data-entry="payment-in" class="fixed inset-0 z-50 overflow-y-auto bg-[#eaf2ef] text-slate-800 dark:bg-slate-950 dark:text-slate-200">
        <div class="mx-auto w-full max-w-[1380px] space-y-4 px-3 pb-36 pt-4 sm:px-5">

          <header class="flex flex-col gap-4 rounded-2xl border border-teal-900/10 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center">
            <div class="flex min-w-0 flex-1 items-center gap-3.5">
              <div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-600 to-teal-600 text-white shadow-lg shadow-teal-900/25">
                <mat-icon class="text-2xl">price_check</mat-icon>
              </div>
              <div class="min-w-0">
                <h1 class="truncate text-lg font-bold leading-tight text-slate-900 dark:text-white">{{ editingId() ? prefs.txt('পেমেন্ট রশিদ সংশোধন', 'Edit payment receipt') : prefs.txt('পেমেন্ট গ্রহণ (গ্রাহক জমা)', 'Payment In (Customer collection)') }}</h1>
                <p class="text-[11.5px] text-slate-500 dark:text-slate-400">
                  @if (editingPayment(); as ep) {
                    <span class="inline-flex items-center gap-1 font-bold text-teal-700 dark:text-teal-300"><mat-icon class="text-[14px]">receipt_long</mat-icon>{{ ep.receiptNo }}</span>
                    — {{ prefs.txt('পরিমাণ, তারিখ বা মাধ্যম সংশোধন করুন; রশিদ নম্বর একই থাকবে।', 'Correct the amount, date or mode; the receipt number stays the same.') }}
                  } @else {
                    {{ prefs.txt('বিক্রয় বিল, পূর্বের বকেয়া বা অগ্রিম — যেকোনো মাধ্যম দিয়ে জমা নিন', 'Collect sales bills, old dues or advances through any mode') }}
                  }
                </p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button (click)="useFull()" [disabled]="partyDue() <= 0" [class]="preset() === 'full'
                ? 'inline-flex items-center gap-1.5 rounded-xl border border-teal-700 bg-teal-700 px-3.5 py-2 text-[11.5px] font-bold text-white shadow-md shadow-teal-900/20'
                : 'inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[11.5px] font-bold text-slate-600 transition hover:border-teal-300 hover:bg-teal-50/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'">
                <mat-icon class="text-base">done_all</mat-icon> {{ prefs.txt('সম্পূর্ণ বকেয়া', 'Full due') }}
              </button>
              <button (click)="useHalf()" [disabled]="partyDue() <= 0" [class]="preset() === 'half'
                ? 'inline-flex items-center gap-1.5 rounded-xl border border-teal-700 bg-teal-700 px-3.5 py-2 text-[11.5px] font-bold text-white shadow-md shadow-teal-900/20'
                : 'inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[11.5px] font-bold text-slate-600 transition hover:border-teal-300 hover:bg-teal-50/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'">
                <mat-icon class="text-base">percent</mat-icon> {{ prefs.txt('অর্ধেক', 'Half') }}
              </button>
              <button (click)="useCustom()" [class]="preset() === 'custom'
                ? 'inline-flex items-center gap-1.5 rounded-xl border border-teal-700 bg-teal-700 px-3.5 py-2 text-[11.5px] font-bold text-white shadow-md shadow-teal-900/20'
                : 'inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[11.5px] font-bold text-slate-600 transition hover:border-teal-300 hover:bg-teal-50/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'">
                <mat-icon class="text-base">edit</mat-icon> {{ prefs.txt('কাস্টম', 'Custom') }}
              </button>
              <button (click)="closeDrawer()" class="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-rose-950/40 cursor-pointer" [title]="prefs.txt('ফিরে যান', 'Go back')">
                <mat-icon class="text-lg">close</mat-icon>
              </button>
            </div>
          </header>

          <div class="grid items-start gap-4 lg:grid-cols-[1.85fr_1fr]">
            <div class="flex min-w-0 flex-col gap-4">

              <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <h2 class="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <mat-icon class="text-[18px] text-teal-600 dark:text-teal-400">person</mat-icon> {{ prefs.txt('গ্রাহকের তথ্য', 'Customer information') }}
                  </h2>
                  @if (selectedParty(); as sp) {
                    <span class="rounded-md bg-teal-50 px-2 py-0.5 font-mono text-[10px] font-bold text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">ID #{{ sp.id }}</span>
                  }
                </div>
                <div class="grid gap-3.5 p-4 sm:grid-cols-[1.6fr_1fr]">
                  <div>
                    <label class="mb-1.5 block text-[11.5px] font-semibold text-slate-700 dark:text-slate-300">{{ prefs.txt('গ্রাহক বাছুন', 'Select customer') }} <span class="text-rose-500">*</span></label>
                    <select data-field="party" [(ngModel)]="formPartyId" [disabled]="!!editingId()" class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[12.5px] text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-900 dark:disabled:text-slate-400">
                      <option [ngValue]="null">— {{ prefs.txt('গ্রাহক বাছুন', 'Select customer') }} —</option>
                      @for (p of customerParties(); track p.id) {
                        <option [ngValue]="p.id">{{ p.name }}{{ dueOf(p) > 0 ? ' — ' + prefs.txt('বাকি', 'due') + ' ' + (dueOf(p) | number:'1.2-2') : '' }}</option>
                      }
                    </select>
                  </div>
                  <div>
                    <label class="mb-1.5 block text-[11.5px] font-semibold text-slate-700 dark:text-slate-300">{{ prefs.txt('মোবাইল', 'Mobile') }}</label>
                    <input type="text" readonly [value]="selectedParty()?.phone || '—'" class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-[12.5px] text-slate-600 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300" />
                  </div>
                  @if (selectedParty(); as sp) {
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-slate-500 dark:text-slate-400 sm:col-span-2">
                      @if (sp.companyName) {
                        <span class="inline-flex items-center gap-1"><mat-icon class="text-[14px]">business</mat-icon>{{ sp.companyName }}</span>
                      }
                      @if (sp.addressText || sp.address) {
                        <span class="inline-flex min-w-0 items-center gap-1"><mat-icon class="text-[14px]">place</mat-icon><span class="truncate">{{ addr(sp.addressText || sp.address) }}</span></span>
                      }
                      <span class="inline-flex items-center gap-1"><mat-icon class="text-[14px]">verified_user</mat-icon>{{ sp.status }}</span>
                    </div>
                  }
                </div>
              </section>

              <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <h2 class="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <mat-icon class="text-[18px] text-teal-600 dark:text-teal-400">account_balance_wallet</mat-icon> {{ prefs.txt('পেমেন্টের মাধ্যম ও পরিমাণ', 'Payment mode and amount') }}
                  </h2>
                </div>
                <div class="space-y-4 p-4">

                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-600 text-white"><mat-icon class="text-base">shopping_bag</mat-icon></span>
                      <div class="min-w-0">
                        <p class="text-[10px] font-bold text-slate-500 dark:text-slate-400">{{ prefs.txt('মোট বিক্রয়', 'Total sales') }}</p>
                        <p class="truncate font-mono text-[15px] font-bold text-slate-900 dark:text-white">৳ {{ partyTotal() | number:'1.2-2' }}</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
                      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-600 text-white"><mat-icon class="text-base">check_circle</mat-icon></span>
                      <div class="min-w-0">
                        <p class="text-[10px] font-bold text-emerald-700/80 dark:text-emerald-300/80">{{ prefs.txt('মোট জমা হয়েছে', 'Total received') }}</p>
                        <p class="truncate font-mono text-[15px] font-bold text-emerald-800 dark:text-emerald-300">৳ {{ partyPaid() | number:'1.2-2' }}</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3 dark:border-rose-900 dark:bg-rose-950/40">
                      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-600 text-white"><mat-icon class="text-base">receipt_long</mat-icon></span>
                      <div class="min-w-0">
                        <p class="text-[10px] font-bold text-rose-700/80 dark:text-rose-300/80">{{ prefs.txt('বর্তমান বকেয়া', 'Current due') }}</p>
                        <p class="truncate font-mono text-[15px] font-bold text-rose-700 dark:text-rose-300">৳ {{ partyDue() | number:'1.2-2' }}</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p class="mb-2 text-[11.5px] font-semibold text-slate-700 dark:text-slate-300">{{ prefs.txt('জমার মাধ্যম', 'Collection mode') }}</p>
                    <div class="flex flex-wrap gap-2">
                      @for (m of modes; track m) {
                        <button (click)="formMode = m" [class]="formMode === m
                          ? 'inline-flex items-center gap-2 rounded-xl border-[1.5px] border-teal-600 bg-teal-50 px-3.5 py-2 text-[11.5px] font-bold text-teal-800 shadow-sm dark:border-teal-500 dark:bg-teal-950/60 dark:text-teal-200'
                          : 'inline-flex items-center gap-2 rounded-xl border-[1.5px] border-slate-300 bg-white px-3.5 py-2 text-[11.5px] font-bold text-slate-600 transition hover:border-teal-300 hover:bg-teal-50/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'">
                          <span [class]="'grid h-5 w-5 place-items-center rounded-md text-white ' + modeMeta(m).tile"><mat-icon class="text-[13px]">{{ modeMeta(m).icon }}</mat-icon></span>
                          {{ modeLabel(m) }}
                        </button>
                      }
                    </div>
                  </div>

                  <div class="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label class="mb-1.5 block text-[11.5px] font-semibold text-slate-700 dark:text-slate-300">{{ prefs.txt('জমার পরিমাণ', 'Collection amount') }} <span class="text-rose-500">*</span></label>
                      <div class="flex items-center overflow-hidden rounded-xl border border-slate-300 bg-white transition focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950">
                        <span class="grid h-11 w-11 shrink-0 place-items-center border-r border-slate-200 bg-slate-50 text-sm font-bold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">৳</span>
                        <input data-field="amount" type="number" min="0" step="0.01" [(ngModel)]="formAmount" class="w-full bg-transparent px-3 py-2.5 text-right font-mono text-base font-bold text-slate-900 outline-none placeholder:text-slate-400 dark:text-white" placeholder="0.00" />
                      </div>
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11.5px] font-semibold text-slate-700 dark:text-slate-300">{{ prefs.txt('ডিসকাউন্ট / মাফ', 'Discount / waiver') }}</label>
                      <div class="flex items-center overflow-hidden rounded-xl border border-slate-300 bg-white transition focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950">
                        <span class="grid h-11 w-11 shrink-0 place-items-center border-r border-slate-200 bg-slate-50 text-sm font-bold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">৳</span>
                        <input data-field="discount" type="number" min="0" step="0.01" [(ngModel)]="formDiscount" class="w-full bg-transparent px-3 py-2.5 text-right font-mono text-base font-bold text-slate-900 outline-none placeholder:text-slate-400 dark:text-white" placeholder="0.00" />
                      </div>
                    </div>
                    <div class="sm:col-span-2">
                      <label class="mb-1.5 block text-[11.5px] font-semibold text-slate-700 dark:text-slate-300">{{ prefs.txt('জমার তারিখ', 'Collection date') }}</label>
                      <input data-field="date" type="date" appDmyDate [(ngModel)]="formDate" class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[12.5px] text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 sm:max-w-[240px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
                    </div>
                  </div>

                  <div class="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">
                    <mat-icon class="mt-0.5 text-[15px] text-teal-600 dark:text-teal-400">info</mat-icon>
                    <span>{{ prefs.txt('বকেয়ার চেয়ে বেশি জমা দিলে অতিরিক্ত অংশ পরবর্তী বিলে সমন্বয়ের জন্য অগ্রিম হিসেবে জমা থাকবে।', 'Paying more than the due keeps the extra amount as an advance for future bills.') }}</span>
                  </div>
                </div>
              </section>

              <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <h2 class="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <mat-icon class="text-[18px] text-teal-600 dark:text-teal-400">history</mat-icon> {{ prefs.txt('সর্বশেষ জমা', 'Recent collections') }}
                  </h2>
                  @if (selectedParty()) {
                    <span class="text-[10px] font-bold text-slate-400 dark:text-slate-500">{{ prefs.txt('সর্বোচ্চ ৫টি', 'Latest 5') }}</span>
                  }
                </div>
                @if (!selectedParty()) {
                  <p class="px-4 py-8 text-center text-[11.5px] text-slate-400">{{ prefs.txt('জমার ইতিহাস দেখতে আগে গ্রাহক বাছুন।', 'Select a customer to see the collection history.') }}</p>
                } @else if (!recentPartyPayments().length) {
                  <p class="px-4 py-8 text-center text-[11.5px] text-slate-400">{{ prefs.txt('এই গ্রাহকের কোনো পূর্বের জমা নেই।', 'This customer has no previous collection.') }}</p>
                } @else {
                  <div class="overflow-x-auto">
                    <table class="w-full min-w-[520px] text-left text-[11.5px]">
                      <thead class="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">
                        <tr>
                          <th class="px-4 py-2 font-bold">{{ prefs.txt('তারিখ', 'Date') }}</th>
                          <th class="px-4 py-2 font-bold">{{ prefs.txt('রশিদ', 'Receipt') }}</th>
                          <th class="px-4 py-2 font-bold">{{ prefs.txt('মাধ্যম', 'Mode') }}</th>
                          <th class="px-4 py-2 text-right font-bold">{{ prefs.txt('পরিমাণ', 'Amount') }}</th>
                          <th class="px-4 py-2 font-bold">{{ prefs.txt('নোট', 'Note') }}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                        @for (p of recentPartyPayments(); track p.id) {
                          <tr class="hover:bg-teal-50/50 dark:hover:bg-slate-800/60">
                            <td class="whitespace-nowrap px-4 py-2 text-slate-600 dark:text-slate-300">{{ displayDate(p.date) }}</td>
                            <td class="px-4 py-2 font-mono font-bold text-teal-700 dark:text-teal-300">{{ p.receiptNo }}</td>
                            <td class="px-4 py-2">
                              <span class="inline-flex items-center gap-1.5">
                                <span [class]="'grid h-4 w-4 place-items-center rounded text-white ' + modeMeta(p.mode).tile"><mat-icon class="text-[10px]">{{ modeMeta(p.mode).icon }}</mat-icon></span>
                                {{ modeLabel(p.mode) }}
                              </span>
                            </td>
                            <td class="px-4 py-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">৳ {{ p.amount | number:'1.2-2' }}</td>
                            <td class="max-w-[220px] truncate px-4 py-2 text-slate-500 dark:text-slate-400" [title]="p.note">{{ p.note || '—' }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </section>
            </div>

            <div class="flex min-w-0 flex-col gap-4">

              <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <h2 class="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <mat-icon class="text-[18px] text-teal-600 dark:text-teal-400">summarize</mat-icon> {{ prefs.txt('পেমেন্ট সারসংক্ষেপ', 'Payment summary') }}
                  </h2>
                </div>
                <div class="px-4 py-2">
                  <div class="flex items-center justify-between gap-3 border-b border-dashed border-slate-200 py-2.5 text-[11.5px] dark:border-slate-800">
                    <span class="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                      <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-600 dark:bg-cyan-950/50 dark:text-cyan-400"><mat-icon class="text-[15px]">shopping_bag</mat-icon></span>
                      {{ prefs.txt('মোট বিক্রয়', 'Total sales') }}
                    </span>
                    <b class="whitespace-nowrap font-mono text-[12px] text-slate-800 dark:text-slate-100">৳ {{ partyTotal() | number:'1.2-2' }}</b>
                  </div>
                  <div class="flex items-center justify-between gap-3 border-b border-dashed border-slate-200 py-2.5 text-[11.5px] dark:border-slate-800">
                    <span class="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                      <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400"><mat-icon class="text-[15px]">check_circle</mat-icon></span>
                      {{ prefs.txt('পূর্বে জমা হয়েছে', 'Previously received') }}
                    </span>
                    <b class="whitespace-nowrap font-mono text-[12px] text-emerald-700 dark:text-emerald-400">৳ {{ partyPaid() | number:'1.2-2' }}</b>
                  </div>
                  <div class="my-2 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11.5px] dark:border-rose-900 dark:bg-rose-950/40">
                    <span class="flex min-w-0 items-center gap-2 font-bold text-rose-700 dark:text-rose-300">
                      <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-rose-600 text-white"><mat-icon class="text-[15px]">receipt_long</mat-icon></span>
                      {{ prefs.txt('মোট পরিশোধযোগ্য', 'Total payable') }}
                    </span>
                    <b class="whitespace-nowrap font-mono text-[13px] text-rose-700 dark:text-rose-300">৳ {{ partyDue() | number:'1.2-2' }}</b>
                  </div>
                  <div class="flex items-center justify-between gap-3 border-b border-dashed border-slate-200 py-2.5 text-[11.5px] dark:border-slate-800">
                    <span class="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                      <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400"><mat-icon class="text-[15px]">remove_circle</mat-icon></span>
                      {{ prefs.txt('এই জমা', 'This collection') }} ({{ modeLabel(formMode) }})
                    </span>
                    <b class="whitespace-nowrap font-mono text-[12px] text-slate-800 dark:text-slate-100">(−) ৳ {{ money(formAmount) | number:'1.2-2' }}</b>
                  </div>
                  <div class="flex items-center justify-between gap-3 border-b border-dashed border-slate-200 py-2.5 text-[11.5px] dark:border-slate-800">
                    <span class="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                      <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400"><mat-icon class="text-[15px]">local_offer</mat-icon></span>
                      {{ prefs.txt('ডিসকাউন্ট / মাফ', 'Discount / waiver') }}
                    </span>
                    <b class="whitespace-nowrap font-mono text-[12px] text-slate-800 dark:text-slate-100">(−) ৳ {{ money(formDiscount) | number:'1.2-2' }}</b>
                  </div>
                  <div class="my-2 flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-[11.5px] dark:border-teal-900 dark:bg-teal-950/40">
                    <span class="flex min-w-0 items-center gap-2 font-bold text-teal-800 dark:text-teal-200">
                      <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-teal-600 text-white"><mat-icon class="text-[15px]">payments</mat-icon></span>
                      {{ prefs.txt('মোট জমা', 'Total received') }}
                    </span>
                    <b class="whitespace-nowrap font-mono text-[13px] text-teal-800 dark:text-teal-200">৳ {{ paymentTotal() | number:'1.2-2' }}</b>
                  </div>
                  <div class="mb-2 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11.5px] dark:border-slate-800 dark:bg-slate-950/60">
                    <span class="flex min-w-0 items-center gap-2 font-semibold text-slate-600 dark:text-slate-300">
                      <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><mat-icon class="text-[15px]">balance</mat-icon></span>
                      {{ prefs.txt('জমার পর বকেয়া', 'Due after collection') }}
                    </span>
                    <b class="whitespace-nowrap font-mono text-[13px]" [class]="afterDue() > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'">৳ {{ afterDue() | number:'1.2-2' }}</b>
                  </div>
                  @if (afterAdvance() > 0) {
                    <div class="mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11.5px] font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                      <span class="flex min-w-0 items-center gap-2">
                        <mat-icon class="text-[16px]">savings</mat-icon> {{ prefs.txt('অগ্রিম হিসেবে থাকবে', 'Kept as advance') }}
                      </span>
                      <b class="whitespace-nowrap font-mono text-[13px]">৳ {{ afterAdvance() | number:'1.2-2' }}</b>
                    </div>
                  }
                </div>
              </section>

              <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <h2 class="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <mat-icon class="text-[18px] text-teal-600 dark:text-teal-400">donut_small</mat-icon> {{ prefs.txt('মাধ্যমভিত্তিক জমা', 'Collections by mode') }}
                  </h2>
                </div>
                <div class="px-4 py-2">
                  @for (row of modeTotals(); track row.mode) {
                    <div class="flex items-center justify-between gap-3 border-b border-dashed border-slate-200 py-2.5 text-[11.5px] last:border-0 dark:border-slate-800">
                      <span class="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                        <span [class]="'grid h-6 w-6 shrink-0 place-items-center rounded-md text-white ' + row.tile"><mat-icon class="text-[13px]">{{ row.icon }}</mat-icon></span>
                        {{ row.label }}
                      </span>
                      <b class="whitespace-nowrap font-mono text-[12px]" [class]="row.total > 0 ? 'text-slate-800 dark:text-slate-100' : 'text-slate-300 dark:text-slate-600'">৳ {{ row.total | number:'1.2-2' }}</b>
                    </div>
                  }
                </div>
              </section>

              <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <h2 class="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <mat-icon class="text-[18px] text-teal-600 dark:text-teal-400">edit_note</mat-icon> {{ prefs.txt('পেমেন্ট নোট', 'Payment note') }}
                  </h2>
                </div>
                <div class="p-4">
                  <textarea data-field="note" [(ngModel)]="formNote" rows="3" [placeholder]="prefs.txt('যেমন: বর্তমান বিলের আংশিক পরিশোধ...', 'e.g. partial payment of the current bill...')" class="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[12px] leading-relaxed text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"></textarea>
                </div>
              </section>
            </div>
          </div>
        </div>

        <footer class="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div class="mx-auto flex w-full max-w-[1380px] flex-wrap items-center gap-3 px-3 py-3 sm:px-5">
            <div class="flex flex-wrap gap-2.5">
              <div class="flex items-center gap-2.5 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 dark:border-teal-900 dark:bg-teal-950/50">
                <mat-icon class="text-lg text-teal-700 dark:text-teal-300">savings</mat-icon>
                <div>
                  <p class="text-[9.5px] font-bold uppercase tracking-wide text-teal-700/80 dark:text-teal-300/80">{{ prefs.txt('মোট পেমেন্ট', 'Total payment') }}</p>
                  <p class="font-mono text-[14px] font-bold leading-tight text-teal-800 dark:text-teal-200">৳ {{ paymentTotal() | number:'1.2-2' }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 dark:border-slate-800 dark:bg-slate-950/60">
                <mat-icon class="text-lg text-cyan-700 dark:text-cyan-400">balance</mat-icon>
                <div>
                  <p class="text-[9.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{{ prefs.txt('জমার পরে বকেয়া', 'Due after collection') }}</p>
                  <p class="font-mono text-[14px] font-bold leading-tight" [class]="afterDue() > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'">৳ {{ afterDue() | number:'1.2-2' }}</p>
                </div>
              </div>
            </div>
            <div class="ml-auto flex flex-1 items-center justify-end gap-2 sm:flex-none">
              <button (click)="closeDrawer()" class="inline-flex items-center gap-1 rounded-xl border-[1.5px] border-rose-200 bg-rose-50 px-4 py-2.5 text-[12px] font-bold text-rose-600 transition hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-900/50 cursor-pointer">
                <mat-icon class="text-base">close</mat-icon> {{ prefs.txt('বাতিল', 'Cancel') }}
              </button>
              <button data-field="save" (click)="save()" class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-teal-600 to-teal-600 px-6 py-2.5 text-[12.5px] font-bold text-white shadow-lg shadow-teal-900/25 transition hover:brightness-110 sm:flex-none cursor-pointer">
                <mat-icon class="text-base">{{ editingId() ? 'save' : 'check_circle' }}</mat-icon> {{ editingId() ? prefs.txt('সংশোধন সংরক্ষণ', 'Save changes') : prefs.txt('জমা করুন', 'Receive now') }}
              </button>
            </div>
          </div>
        </footer>
      </div>
    }
  `
})
export class PaymentIn {
  readonly dataService = inject(DataService);
  private readonly notify = inject(NotificationService);
  readonly session = inject(SessionService);
  readonly prefs = inject(PreferencesService);

  addr(value?: string): string {
    return localizeAddress(value, this.prefs.language());
  }

  /** Receipt correction changes a party's money; the owner lock and permission both apply. */
  readonly canEditMoney = computed(() => {
    const user = this.session.currentUser();
    if (!user) return false;
    if (this.session.isMain(user)) return true;
    if (this.dataService.voucherSettings().lockPartyMoney) return false;
    return user.role === 'Admin' || this.session.has('editPartyMoney');
  });

  readonly tabs = computed(() => [
    { value: 'All', label: this.prefs.txt('সব', 'All'), icon: 'payments' },
    { value: 'Cash', label: this.prefs.txt('নগদ', 'Cash'), icon: 'attach_money' },
    { value: 'Bank', label: this.prefs.txt('ব্যাংক', 'Bank'), icon: 'account_balance' },
    { value: 'bKash', label: this.prefs.txt('বিকাশ', 'bKash'), icon: 'smartphone' },
    { value: 'Nagad', label: this.prefs.txt('নাগাদ', 'Nagad'), icon: 'phone_android' }
  ]);
  readonly modes = MODES;

  activeTab = signal('All');
  searchQuery = signal('');
  showDrawer = signal(false);
  /** Set while an existing receipt is being corrected; null means a new receipt. */
  editingId = signal<number | null>(null);

  formPartyId: number | null = null;
  formAmount: number | null = null;
  formDiscount: number | null = 0;
  formMode: LedgerPayment['mode'] = 'Cash';
  formDate = this.today();
  formNote = '';

  customerParties = computed(() =>
    this.dataService.parties().filter(p => hasSalesRole(p) && !isWalkInCustomer(p.name))
  );

  dueOf(party: Party): number {
    return salesAccountOf(party).due;
  }

  readonly salesAccountOf = salesAccountOf;

  customerPayments = computed(() =>
    this.dataService.payments().filter(p => p.partyType === 'Customer')
  );

  filtered = computed<LedgerPayment[]>(() => {
    const tab = this.activeTab();
    const q = this.searchQuery().toLowerCase().trim();
    let list = this.customerPayments();
    if (tab !== 'All') list = list.filter(p => p.mode === tab);
    if (q) {
      list = list.filter(p =>
        p.receiptNo.toLowerCase().includes(q) ||
        p.partyName.toLowerCase().includes(q) ||
        p.date.includes(q));
    }
    return list;
  });

  readonly pager = createPager(() => this.filtered());

  totals = computed(() => {
    const list = this.filtered();
    const today = this.today();
    return {
      amount: this.money(list.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
      discount: this.money(list.reduce((s, p) => s + (Number(p.discount) || 0), 0)),
      today: this.money(list.filter(p => p.date === today).reduce((s, p) => s + (Number(p.amount) || 0), 0))
    };
  });

  // Plain method: formPartyId is not a signal, so a computed here would cache stale.
  selectedParty(): Party | undefined {
    const id = this.formPartyId;
    return id ? this.dataService.parties().find(p => p.id === id) : undefined;
  }

  /** The receipt being corrected, or null for a new collection. */
  editingPayment(): LedgerPayment | null {
    const id = this.editingId();
    return id ? this.dataService.payments().find(p => p.id === id) ?? null : null;
  }

  partyTotal(): number {
    const party = this.selectedParty();
    return party ? this.money(salesAccountOf(party).total) : 0;
  }

  /**
   * While editing, the previews must ignore the receipt being replaced —
   * the same reversal `updatePayment` performs before applying the new values.
   */
  partyPaid(): number {
    const party = this.selectedParty();
    if (!party) return 0;
    return this.money(salesAccountOf(party).paid - (this.editingPayment()?.amount ?? 0));
  }

  partyDue(): number {
    const party = this.selectedParty();
    if (!party) return 0;
    const book = salesAccountOf(party);
    const old = this.editingPayment();
    if (!old) return this.money(book.due);
    return this.money(book.due + this.settledPart(old) - this.money(old.advance || 0));
  }

  private settledPart(payment: LedgerPayment): number {
    const advance = this.money(payment.advance || 0);
    return this.money(Math.max(0, this.money(payment.amount) + this.money(payment.discount) - advance));
  }

  recentPartyPayments(): LedgerPayment[] {
    const id = this.formPartyId;
    if (!id) return [];
    return this.dataService.payments().filter(p => p.partyId === id).slice(0, 5);
  }

  modeTotals(): { mode: LedgerPayment['mode']; label: string; icon: string; tile: string; total: number }[] {
    const id = this.formPartyId;
    const rows = MODES.map(mode => ({ mode, ...MODE_META[mode], label: this.modeLabel(mode), total: 0 }));
    if (!id) return rows;
    for (const p of this.dataService.payments()) {
      if (p.partyId !== id) continue;
      const row = rows.find(r => r.mode === p.mode);
      if (row) row.total = this.money(row.total + (Number(p.amount) || 0));
    }
    return rows;
  }

  tabCount(value: string): number {
    if (value === 'All') return this.customerPayments().length;
    return this.customerPayments().filter(p => p.mode === value).length;
  }

  activeTabLabel(): string {
    return this.tabs().find(t => t.value === this.activeTab())?.label ?? this.prefs.txt('সব', 'All');
  }

  modeLabel(mode: LedgerPayment['mode']): string {
    const map: Record<LedgerPayment['mode'], string> = {
      Cash: this.prefs.txt('নগদ', 'Cash'),
      Bank: this.prefs.txt('ব্যাংক', 'Bank'),
      bKash: this.prefs.txt('বিকাশ', 'bKash'),
      Nagad: this.prefs.txt('নাগাদ অ্যাপ', 'Nagad')
    };
    return map[mode] || mode;
  }

  modeMeta(mode: LedgerPayment['mode']) {
    return MODE_META[mode] ?? MODE_META.Cash;
  }

  setTab(value: string) {
    this.activeTab.set(value);
    this.pager.setPage(1);
  }

  onSearch(e: Event) {
    this.searchQuery.set((e.target as HTMLInputElement).value);
    this.pager.setPage(1);
  }

  today(): string {
    return localDateIso();
  }

  money(value: number | null | undefined): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  displayDate(value: string): string {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || '').trim());
    return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : (value || '-');
  }

  paymentTotal(): number {
    return this.money(this.money(this.formAmount) + this.money(this.formDiscount));
  }

  settlementEffect(): number {
    return this.money(Math.min(Math.max(0, this.partyDue()), this.paymentTotal()));
  }

  advanceEffect(): number {
    return this.money(this.paymentTotal() - this.settlementEffect());
  }

  afterDue(): number {
    return this.money(Math.max(0, this.partyDue() - this.paymentTotal()));
  }

  afterAdvance(): number {
    return this.money(Math.max(0, this.paymentTotal() - this.partyDue()));
  }

  preset(): 'full' | 'half' | 'custom' {
    const due = this.partyDue();
    const amount = this.money(this.formAmount);
    const discount = this.money(this.formDiscount);
    if (due <= 0 || discount !== 0) return 'custom';
    if (amount === due) return 'full';
    if (amount === this.money(due / 2)) return 'half';
    return 'custom';
  }

  useFull() {
    if (this.partyDue() <= 0) return;
    this.formAmount = this.partyDue();
    this.formDiscount = 0;
  }

  useHalf() {
    if (this.partyDue() <= 0) return;
    this.formAmount = this.money(this.partyDue() / 2);
    this.formDiscount = 0;
  }

  useCustom() {
    this.formAmount = null;
    this.formDiscount = 0;
  }

  openAdd() {
    this.editingId.set(null);
    this.formPartyId = null;
    this.formAmount = null;
    this.formDiscount = 0;
    this.formMode = 'Cash';
    this.formDate = this.today();
    this.formNote = '';
    this.showDrawer.set(true);
  }

  /** Corrects a receipt without deleting it and losing the receipt number. */
  openEdit(payment: LedgerPayment) {
    if (!this.canEditMoney()) {
      this.notify.warning(this.prefs.txt('পার্টির টাকা এডিট মালিক লক করে রেখেছেন।', 'The owner has locked party money edits.'), this.prefs.txt('লক করা আছে', 'Locked'));
      return;
    }
    this.editingId.set(payment.id);
    this.formPartyId = payment.partyId;
    this.formAmount = payment.amount;
    this.formDiscount = payment.discount ?? 0;
    this.formMode = payment.mode;
    this.formDate = payment.date;
    this.formNote = payment.note ?? '';
    this.showDrawer.set(true);
  }

  closeDrawer() {
    this.editingId.set(null);
    this.showDrawer.set(false);
  }

  save() {
    const party = this.customerParties().find(p => p.id === this.formPartyId);
    if (!party) {
      this.notify.error(this.prefs.txt('গ্রাহক বাছুন।', 'Select a customer.'), this.prefs.txt('গ্রাহক নেই', 'No customer'));
      return;
    }
    const amount = this.money(this.formAmount);
    if (amount <= 0) {
      this.notify.error(this.prefs.txt('জমার পরিমাণ ০ এর বেশি হতে হবে।', 'Collection amount must be greater than 0.'), this.prefs.txt('ভুল পরিমাণ', 'Invalid amount'));
      return;
    }

    const editing = this.editingId();
    if (editing) {
      const updated = this.dataService.updatePayment(editing, {
        amount,
        discount: this.money(this.formDiscount),
        mode: this.formMode,
        date: this.formDate || this.today(),
        note: this.formNote.trim()
      });
      if (!updated) {
        this.notify.error(this.prefs.txt('রশিদটি পাওয়া যায়নি।', 'This receipt no longer exists.'), this.prefs.txt('আপডেট হয়নি', 'Not updated'));
        return;
      }
      this.notify.success(this.prefs.txt(
        `${updated.receiptNo} রশিদ সংশোধন হয়েছে — ${party.name}, ${amount.toFixed(2)} TK।`,
        `Receipt ${updated.receiptNo} updated — ${party.name}, ${amount.toFixed(2)} TK.`
      ));
      this.closeDrawer();
      return;
    }

    const payment = this.dataService.recordPayment({
      partyId: party.id,
      partyName: party.name,
      partyType: 'Customer',
      amount,
      discount: this.money(this.formDiscount),
      mode: this.formMode,
      date: this.formDate || this.today(),
      note: this.formNote.trim()
    });

    this.notify.success(this.prefs.txt(
      `${party.name} — ${amount.toFixed(2)} TK জমা হয়েছে (${payment.receiptNo})।`,
      `${party.name} — ${amount.toFixed(2)} TK received (${payment.receiptNo}).`
    ));
    this.showDrawer.set(false);
  }

  async deleteRecord(id: number) {
    if (!this.canEditMoney()) {
      this.notify.warning(this.prefs.txt('পার্টির টাকা এডিট মালিক লক করে রেখেছেন।', 'The owner has locked party money edits.'), this.prefs.txt('লক করা আছে', 'Locked'));
      return;
    }
    const confirmed = await this.notify.confirm(
      this.prefs.txt('রশিদ মুছে ফেললে গ্রাহকের জমা ও বাকি হিসাব ফিরে যাবে।', 'Deleting this receipt will reverse the customer collection and due.'),
      {
        title: this.prefs.txt('রশিদ মুছে ফেলবেন?', 'Delete this receipt?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছুন', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    this.dataService.deletePayment(id);
    this.notify.success(this.prefs.txt('রশিদ মুছে ফেলা হয়েছে।', 'Receipt deleted.'));
  }

  exportExcel() {
    this.dataService.exportToExcel(this.filtered(), 'Payment_In');
  }

  printPage() {
    document.body.classList.add('print-list');
    const cleanup = () => {
      document.body.classList.remove('print-list');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 3000);
  }
}
