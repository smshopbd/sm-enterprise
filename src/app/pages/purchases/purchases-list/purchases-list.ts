import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DataService, Party, Purchase } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { SessionService } from '../../../services/session';
import { PurchaseVoucher } from '../../../components/purchase-voucher/purchase-voucher';
import { PartyLedger } from '../../../components/party-ledger/party-ledger';
import { DateRangeBar } from '../../../components/date-range-bar/date-range-bar';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { DateRange, inDateRange, resolveDateRange, toIsoDate } from '../../../utils/date-range';
import { PreferencesService } from '../../../services/preferences';

type PurchaseTab = 'All' | 'Received' | 'Unpaid' | 'Paid';

@Component({
  selector: 'app-purchases-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, PurchaseVoucher, PartyLedger, DateRangeBar, TablePagination],
  template: `
    <div class="space-y-4 text-xs text-slate-800">

      <!-- Title bar -->
      <div class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">history</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                <span>{{ prefs.txt('ক্রয়', 'Purchases') }}</span>
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                <span>{{ prefs.txt('ইতিহাস', 'History') }}</span>
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('ক্রয়ের ইতিহাস', 'Purchase History') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('সব ক্রয় ভাউচার, পরিশোধ ও পাওনার সারসংক্ষেপ।', 'All purchase vouchers, payments and dues at a glance.') }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button (click)="exportExcel()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon class="text-sm text-emerald-200">download</mat-icon> {{ prefs.txt('এক্সেল', 'Excel') }}
            </button>
            <button (click)="openNewPurchase()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon class="text-sm">add_circle</mat-icon> {{ prefs.txt('নতুন ক্রয়', 'New Purchase') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 text-teal-700 inline-flex items-center justify-center shrink-0">
            <mat-icon class="text-lg">receipt_long</mat-icon>
          </span>
          <div>
            <p class="text-[9px] uppercase tracking-wider font-bold text-slate-400">{{ prefs.txt('মোট ক্রয়', 'Total Purchases') }}</p>
            <p class="font-mono text-lg font-extrabold leading-tight text-slate-900">{{ rangePurchases().length }}</p>
          </div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-sky-50 border border-sky-100 text-sky-700 inline-flex items-center justify-center shrink-0">
            <mat-icon class="text-lg">shopping_bag</mat-icon>
          </span>
          <div>
            <p class="text-[9px] uppercase tracking-wider font-bold text-slate-400">{{ prefs.txt('ক্রয়ের পরিমাণ', 'Purchase Amount') }}</p>
            <p class="font-mono text-lg font-extrabold leading-tight text-slate-900">{{ totalAmount() | number:'1.2-2' }}</p>
          </div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 inline-flex items-center justify-center shrink-0">
            <mat-icon class="text-lg">paid</mat-icon>
          </span>
          <div>
            <p class="text-[9px] uppercase tracking-wider font-bold text-slate-400">{{ prefs.txt('পরিশোধিত', 'Paid') }}</p>
            <p class="font-mono text-lg font-extrabold leading-tight text-emerald-700">{{ totalPaid() | number:'1.2-2' }}</p>
          </div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 inline-flex items-center justify-center shrink-0">
            <mat-icon class="text-lg">account_balance_wallet</mat-icon>
          </span>
          <div>
            <p class="text-[9px] uppercase tracking-wider font-bold text-slate-400">{{ prefs.txt('বাকি', 'Due') }}</p>
            <p class="font-mono text-lg font-extrabold leading-tight text-rose-600">{{ totalDue() | number:'1.2-2' }}</p>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div class="p-2 border-b border-slate-100 overflow-x-auto flex items-center gap-2 font-semibold">
          @for (tab of tabs(); track tab.value) {
            <button
              (click)="activeTab.set(tab.value); pager.setPage(1)"
              [class]="activeTab() === tab.value ? 'bg-teal-700 text-white px-3 py-1.5 rounded-lg shadow-2xs' : 'text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg'"
              class="cursor-pointer whitespace-nowrap"
            >
              {{ tab.label }} ({{ tab.value === 'All' ? rangePurchases().length : tabCount(tab.value) }})
            </button>
          }
        </div>

        <div class="border-b border-slate-100 px-3 py-2.5">
          <app-date-range-bar [from]="dateFrom()" [to]="dateTo()" (rangeChange)="onRangeChange($event)" />
        </div>

        <div class="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="relative w-full sm:max-w-md">
            <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
            <input
              type="text"
              [placeholder]="prefs.txt('ভাউচার, সরবরাহকারী, ওয়্যারহাউস বা তারিখ খুঁজুন...', 'Search voucher, supplier, warehouse or date...')"
              [value]="searchQuery()"
              (input)="onSearchInput($event)"
              class="w-full pl-9 pr-8 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
            @if (searchQuery()) {
              <button (click)="searchQuery.set(''); pager.setPage(1)" class="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer" [title]="prefs.txt('সার্চ মুছুন', 'Clear search')">
                <mat-icon class="text-sm">close</mat-icon>
              </button>
            }
          </div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">{{ filteredPurchases().length }} {{ prefs.txt('ভাউচার', 'vouchers') }}</span>
        </div>

        <!-- Phone cards -->
        <div class="sm:hidden divide-y divide-slate-100">
          @for (p of pager.paged(); track p.id) {
            <div (click)="viewPurchase(p)" class="p-3 active:bg-slate-50 transition-colors">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="font-mono text-[12px] font-bold text-teal-800 truncate">+ {{ p.invoice }}</p>
                  <button (click)="openSupplier(p, $event)" class="mt-1 flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-teal-700 min-w-0 cursor-pointer">
                    <mat-icon class="text-[13px] w-[13px] h-[13px] leading-none text-slate-400 shrink-0">person</mat-icon>
                    <span class="truncate">{{ p.supplierName }}</span>
                  </button>
                  <p class="mt-1 text-[10px] text-slate-400 truncate">{{ p.date }} · {{ p.warehouse }}</p>
                </div>
                <div class="text-right shrink-0">
                  <p class="font-mono text-xs font-extrabold text-slate-900 whitespace-nowrap">{{ p.total | number:'1.2-2' }} TK</p>
                  @if (p.due > 0) {
                    <p class="font-mono text-[10px] font-bold text-rose-600 whitespace-nowrap">{{ prefs.txt('বাকি', 'Due') }} {{ p.due | number:'1.2-2' }}</p>
                  }
                  <span class="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold border" [class]="statusClass(p.status)">
                    <span class="w-1.5 h-1.5 rounded-full" [class]="statusDot(p.status)"></span>
                    {{ statusLabel(p.status) }}
                  </span>
                </div>
              </div>
              <div class="mt-2 flex items-center justify-between gap-2">
                <span class="text-[10px] font-semibold text-slate-400 truncate">{{ p.items?.length || 0 }} {{ prefs.txt('পণ্য', 'items') }} · {{ paymentStatusLabel(p.paymentStatus) }}</span>
                <div class="flex items-center gap-1 shrink-0" (click)="$event.stopPropagation()">
                  <button (click)="viewPurchase(p)" class="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 px-2 py-1 text-[10.5px] font-bold cursor-pointer">
                    <mat-icon class="text-[13px] w-[13px] h-[13px] leading-none">receipt</mat-icon> {{ prefs.txt('ভাউচার', 'Voucher') }}
                  </button>
                  <button (click)="editPurchase(p)" class="p-1.5 rounded-lg text-amber-600 active:bg-amber-100 cursor-pointer" [title]="prefs.txt('ক্রয় সম্পাদনা', 'Edit purchase')">
                    <mat-icon class="text-sm">edit</mat-icon>
                  </button>
                  @if (session.has('deleteRecords')) {
                    <button (click)="deletePurchase(p)" class="p-1.5 rounded-lg text-rose-600 active:bg-rose-100 cursor-pointer" [title]="prefs.txt('ক্রয় মুছুন', 'Delete purchase')">
                      <mat-icon class="text-sm">delete</mat-icon>
                    </button>
                  }
                </div>
              </div>
            </div>
          } @empty {
            <div class="p-10 text-center">
              <mat-icon class="text-3xl text-slate-300">receipt_long</mat-icon>
              <p class="font-bold text-slate-600">{{ prefs.txt('কোনো ক্রয় ভাউচার পাওয়া যায়নি', 'No purchase vouchers found') }}</p>
            </div>
          }
        </div>

        <div class="hidden sm:block overflow-x-auto">
          <table class="w-full min-w-[1050px] text-xs text-left border-collapse">
            <thead>
              <tr class="bg-slate-50/80">
                <th class="px-3 py-2.5 text-center w-12 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('ক্রম', 'SL') }}</th>
                <th class="px-3 py-2.5 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('ভাউচার', 'Voucher') }}</th>
                <th class="px-3 py-2.5 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('তারিখ', 'Date') }}</th>
                <th class="px-3 py-2.5 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('সরবরাহকারী', 'Supplier') }}</th>
                <th class="px-3 py-2.5 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('ওয়্যারহাউস', 'Warehouse') }}</th>
                <th class="px-3 py-2.5 text-center border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('পণ্য', 'Items') }}</th>
                <th class="px-3 py-2.5 text-center border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</th>
                <th class="px-3 py-2.5 text-right border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('সর্বমোট', 'Total') }}</th>
                <th class="px-3 py-2.5 text-right border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('পরিশোধিত', 'Paid') }}</th>
                <th class="px-3 py-2.5 text-right border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('বাকি', 'Due') }}</th>
                <th class="px-3 py-2.5 text-center border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('পেমেন্ট', 'Payment') }}</th>
                <th class="px-3 py-2.5 text-center border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('অ্যাকশন', 'Action') }}</th>
              </tr>
            </thead>
            <tbody>
              @for (p of pager.paged(); track p.id; let idx = $index) {
                <tr (click)="viewPurchase(p)" [title]="prefs.txt('ক্রয় ভাউচার দেখুন', 'View purchase voucher')" class="even:bg-slate-100/60 hover:bg-teal-50/50 transition-colors cursor-pointer">
                  <td class="px-3 py-2.5 text-center font-mono text-[10.5px] font-semibold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="px-3 py-2.5">
                    <span class="font-mono font-bold text-teal-800">+ {{ p.invoice }}</span>
                  </td>
                  <td class="px-3 py-2.5 text-slate-500 whitespace-nowrap">{{ p.date }}</td>
                  <td class="px-3 py-2.5">
                    <button
                      (click)="openSupplier(p, $event)"
                      class="flex items-center gap-1.5 font-semibold text-slate-800 hover:text-teal-700 hover:underline min-w-0 cursor-pointer"
                      [title]="prefs.txt('সরবরাহকারীর তথ্য দেখুন', 'View supplier information')"
                    >
                      <mat-icon class="text-sm text-slate-400 shrink-0">person</mat-icon>
                      <span class="truncate">{{ p.supplierName }}</span>
                    </button>
                  </td>
                  <td class="px-3 py-2.5 text-slate-600">{{ p.warehouse }}</td>
                  <td class="px-3 py-2.5 text-center">
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold border"
                      [class]="(p.items?.length || 0) ? 'bg-teal-50 text-teal-700 border-teal-100' : 'bg-slate-100 text-slate-400 border-slate-200'">
                      {{ p.items?.length || 0 }}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 text-center">
                    <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border"
                      [class]="statusClass(p.status)">
                      <span class="w-1.5 h-1.5 rounded-full" [class]="statusDot(p.status)"></span>
                      {{ statusLabel(p.status) }}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 text-right font-mono font-bold text-slate-800 whitespace-nowrap">{{ p.total | number:'1.2-2' }} TK</td>
                  <td class="px-3 py-2.5 text-right font-mono font-semibold text-emerald-700 whitespace-nowrap">{{ p.paid | number:'1.2-2' }} TK</td>
                  <td class="px-3 py-2.5 text-right font-mono font-bold text-rose-600 whitespace-nowrap">{{ p.due | number:'1.2-2' }} TK</td>
                  <td class="px-3 py-2.5 text-center">
                    <span class="font-semibold text-[10.5px]"
                      [class]="p.paymentStatus === 'Paid' ? 'text-emerald-600' : (p.paymentStatus === 'Unpaid' ? 'text-rose-600' : 'text-amber-600')">
                      {{ paymentStatusLabel(p.paymentStatus) }}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 text-center" (click)="$event.stopPropagation()">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="viewPurchase(p)" class="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-700 px-2 py-1 font-bold cursor-pointer" [title]="prefs.txt('ক্রয় ভাউচার দেখুন', 'View purchase voucher')">
                        <mat-icon class="text-sm">receipt</mat-icon> {{ prefs.txt('ভাউচার', 'Voucher') }}
                      </button>
                      <button (click)="editPurchase(p)" class="p-1.5 rounded-lg text-amber-600 hover:bg-amber-100 cursor-pointer" [title]="prefs.txt('ক্রয় সম্পাদনা', 'Edit purchase')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      @if (session.has('deleteRecords')) {
                        <button (click)="deletePurchase(p)" class="p-1.5 rounded-lg text-rose-600 hover:bg-rose-100 cursor-pointer" [title]="prefs.txt('ক্রয় মুছুন', 'Delete purchase')">
                          <mat-icon class="text-sm">delete</mat-icon>
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="12" class="p-14 text-center">
                    <div class="flex flex-col items-center gap-1 text-slate-400">
                      <mat-icon class="text-3xl text-slate-300">receipt_long</mat-icon>
                      <p class="font-bold text-slate-600">{{ prefs.txt('কোনো ক্রয় ভাউচার পাওয়া যায়নি', 'No purchase vouchers found') }}</p>
                      <p class="text-[11px]">{{ searchQuery() || activeTab() !== 'All'
                        ? prefs.txt('অন্য ফিল্টার চেষ্টা করুন।', 'Try a different filter.')
                        : (dateFrom() || dateTo())
                          ? prefs.txt('এই তারিখ পরিসরে কোনো ক্রয় নেই — অন্য পরিসর বা সব সময় বাছুন।', 'No purchases in this date range — pick another range or All time.')
                          : prefs.txt('শুরু করতে প্রথম ক্রয় তৈরি করুন।', 'Create your first purchase to get started.') }}</p>
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

        <div class="px-4 py-2.5 border-t border-slate-200 bg-slate-50/60 text-[10px] font-semibold text-slate-400">
          {{ prefs.txt('দেখানো হচ্ছে', 'Showing') }} {{ filteredPurchases().length }} / {{ rangePurchases().length }} {{ prefs.txt('ক্রয় ভাউচার', 'purchase vouchers') }}
        </div>
      </div>
    </div>

    @if (selectedPurchase(); as purchase) {
      <app-purchase-voucher [purchase]="purchase" (close)="selectedPurchase.set(null)" />
    }

    @if (ledgerParty(); as party) {
      <app-party-ledger [party]="party" [side]="'purchase'" (close)="ledgerParty.set(null)" />
    }
  `
})
export class PurchasesList {
  dataService = inject(DataService);
  private router = inject(Router);
  private notify = inject(NotificationService);
  readonly session = inject(SessionService);
  readonly prefs = inject(PreferencesService);

  readonly tabs = computed(() => [
    { value: 'All' as PurchaseTab, label: this.prefs.txt('সব', 'All'), icon: 'receipt_long' },
    { value: 'Received' as PurchaseTab, label: this.prefs.txt('গৃহীত', 'Received'), icon: 'inventory_2' },
    { value: 'Unpaid' as PurchaseTab, label: this.prefs.txt('বাকি', 'Unpaid'), icon: 'schedule' },
    { value: 'Paid' as PurchaseTab, label: this.prefs.txt('পরিশোধিত', 'Paid'), icon: 'paid' }
  ]);
  activeTab = signal<PurchaseTab>('All');
  searchQuery = signal('');
  selectedPurchase = signal<Purchase | null>(null);
  ledgerParty = signal<Party | null>(null);
  /** Purchase bills are often entered with an earlier date, so open on this month. */
  private readonly initialRange = resolveDateRange('month');
  dateFrom = signal(this.initialRange.from);
  dateTo = signal(this.initialRange.to);

  purchases = computed(() => this.dataService.purchases());

  constructor() {
    // Coming back from a save, widen "today" just enough to include the saved bill
    // (purchases are often entered with an earlier bill date).
    const focus = this.savedPurchaseDate();
    if (!focus) return;
    const today = resolveDateRange('today').from;
    this.dateFrom.set(focus < today ? focus : today);
    this.dateTo.set(focus > today ? focus : today);
  }

  private savedPurchaseDate(): string {
    try {
      const state = history.state as { purchaseDate?: string } | null;
      return toIsoDate(state?.purchaseDate);
    } catch {
      return '';
    }
  }

  rangePurchases = computed(() => {
    const from = this.dateFrom();
    const to = this.dateTo();
    return this.purchases().filter(purchase => inDateRange(purchase.date, from, to));
  });

  totalAmount = computed(() => this.filteredPurchases().reduce((sum, purchase) => sum + purchase.total, 0));
  totalPaid = computed(() => this.filteredPurchases().reduce((sum, purchase) => sum + purchase.paid, 0));
  totalDue = computed(() => this.filteredPurchases().reduce((sum, purchase) => sum + purchase.due, 0));

  filteredPurchases = computed(() => {
    let list = this.rangePurchases();
    const tab = this.activeTab();
    const query = this.searchQuery().toLowerCase().trim();

    if (tab === 'Received') list = list.filter(purchase => purchase.status === 'Received');
    if (tab === 'Unpaid') list = list.filter(purchase => purchase.paymentStatus === 'Unpaid');
    if (tab === 'Paid') list = list.filter(purchase => purchase.paymentStatus === 'Paid');

    if (query) {
      list = list.filter(purchase =>
        purchase.invoice.toLowerCase().includes(query) ||
        purchase.supplierName.toLowerCase().includes(query) ||
        purchase.warehouse.toLowerCase().includes(query) ||
        purchase.date.toLowerCase().includes(query)
      );
    }

    return list;
  });

  readonly pager = createPager(() => this.filteredPurchases());

  tabCount(tab: PurchaseTab): number {
    if (tab === 'Received') return this.rangePurchases().filter(purchase => purchase.status === 'Received').length;
    if (tab === 'Unpaid') return this.rangePurchases().filter(purchase => purchase.paymentStatus === 'Unpaid').length;
    if (tab === 'Paid') return this.rangePurchases().filter(purchase => purchase.paymentStatus === 'Paid').length;
    return this.rangePurchases().length;
  }

  onRangeChange(range: DateRange) {
    this.dateFrom.set(range.from);
    this.dateTo.set(range.to);
    this.pager.setPage(1);
  }

  onSearchInput(event: Event) {
    this.searchQuery.set((event.target as HTMLInputElement).value);
    this.pager.setPage(1);
  }

  statusLabel(status: Purchase['status']): string {
    switch (status) {
      case 'Received': return this.prefs.txt('গৃহীত', 'Received');
      case 'Pending': return this.prefs.txt('অপেক্ষমাণ', 'Pending');
      case 'Ordered': return this.prefs.txt('অর্ডারকৃত', 'Ordered');
      case 'Manufacturing': return this.prefs.txt('উৎপাদনাধীন', 'Manufacturing');
      default: return status;
    }
  }

  paymentStatusLabel(status: Purchase['paymentStatus']): string {
    switch (status) {
      case 'Paid': return this.prefs.txt('পরিশোধিত', 'Paid');
      case 'Unpaid': return this.prefs.txt('বাকি', 'Unpaid');
      case 'Partially Paid': return this.prefs.txt('আংশিক পরিশোধিত', 'Partially Paid');
      default: return status;
    }
  }

  statusClass(status: Purchase['status']): string {
    switch (status) {
      case 'Received': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'Pending': return 'bg-amber-50 text-amber-700 border-amber-100';
      case 'Ordered': return 'bg-sky-50 text-sky-700 border-sky-100';
      default: return 'bg-violet-50 text-violet-700 border-violet-100';
    }
  }

  statusDot(status: Purchase['status']): string {
    switch (status) {
      case 'Received': return 'bg-emerald-500';
      case 'Pending': return 'bg-amber-500';
      case 'Ordered': return 'bg-sky-500';
      default: return 'bg-violet-500';
    }
  }

  viewPurchase(purchase: Purchase) {
    this.selectedPurchase.set(purchase);
  }

  openSupplier(purchase: Purchase, event: MouseEvent) {
    event.stopPropagation();
    const name = (purchase.supplierName || '').trim().toLowerCase();
    const party = this.dataService.parties().find(
      item => (item.name || '').trim().toLowerCase() === name
    );
    if (!party) {
      this.notify.info(
        this.prefs.txt(`"${purchase.supplierName}" পার্টি তালিকায় পাওয়া যায়নি।`, `Supplier "${purchase.supplierName}" was not found in the party list.`),
        this.prefs.txt('সরবরাহকারী পাওয়া যায়নি', 'Supplier not found')
      );
      return;
    }
    this.ledgerParty.set(party);
  }

  openNewPurchase() {
    this.router.navigate(['/purchases/add']);
  }

  editPurchase(purchase: Purchase) {
    this.router.navigate(['/purchases/add'], { queryParams: { edit: purchase.id } });
  }

  async deletePurchase(purchase: Purchase) {
    const confirmed = await this.notify.confirm(
      this.prefs.txt(
        `ভাউচার #${purchase.invoice} স্থায়ীভাবে মুছে ফেললে এর স্টক সমন্বয় ফিরিয়ে নেওয়া হবে।`,
        `Deleting voucher #${purchase.invoice} permanently will roll back its stock adjustment.`
      ),
      {
        title: this.prefs.txt('এই ক্রয়টি মুছে ফেলবেন?', 'Delete this purchase?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছুন', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    this.dataService.deletePurchase(purchase.id);
    this.notify.success(
      this.prefs.txt(`ক্রয় #${purchase.invoice} মুছে ফেলা হয়েছে এবং স্টক ফিরিয়ে দেওয়া হয়েছে।`, `Purchase #${purchase.invoice} deleted and stock restored.`)
    );
  }

  exportExcel() {
    this.dataService.exportToExcel(this.filteredPurchases(), 'Purchase_History');
  }
}
