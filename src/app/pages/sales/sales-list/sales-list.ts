import { ChangeDetectionStrategy, Component, HostListener, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { BatteryAdjustmentItem, DataService, Party, Sale, SaleItem, SalesReturnItem } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { OrderLockService } from '../../../services/order-lock';
import { PreferencesService } from '../../../services/preferences';
import { InvoiceModal } from '../../../components/invoice-modal/invoice-modal';
import { ShareInvoiceComponent } from '../../../components/share-invoice/share-invoice';
import { PartyLedger } from '../../../components/party-ledger/party-ledger';
import { VoucherSettingsModal } from '../../../components/voucher-settings-modal/voucher-settings-modal';
import { PasscodeModal } from '../../../components/passcode-modal/passcode-modal';
import { DateRangeBar } from '../../../components/date-range-bar/date-range-bar';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { localDateIso } from '../../../utils/local-date';
import { DateRange, resolveDateRange } from '../../../utils/date-range';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';
import {
  ColumnLayout,
  ColumnSpec,
  ResolvedColumn,
  clampLayoutWidth,
  defaultColumnLayout,
  loadColumnLayout,
  saveColumnLayout
} from '../../../utils/column-layout';
import { reorderInView } from '../../../utils/reorder';
import { scrollToListTopAfterRender } from '../../../utils/scroll-to-list-top';
import { qrDataUrl } from '../../../utils/qr-code';
import { saleQrText } from '../../../utils/voucher-qr';
import { saleItemDisplayName } from '../../../utils/sale-item-label';
import { printPosReceipt } from '../../../utils/pos-receipt-print';

type Density = 'cozy' | 'compact';

interface SavedView {
  sortKey: string;
  sortDir: 'asc' | 'desc';
  density: Density;
}

const VIEW_KEY = 'sm_sales_view_v1';
const COLUMNS_KEY = 'sm_sales_cols_v1';
const DEFAULT_VIEW: SavedView = { sortKey: 'date', sortDir: 'desc', density: 'cozy' };

const SALES_COLUMNS: ColumnSpec[] = [
  { key: 'sel', label: 'Sel', align: 'center', width: 34, min: 30, max: 44 },
  { key: 'sl', label: 'SL', align: 'center', width: 44, min: 36, max: 64 },
  { key: 'invoice', label: 'Invoice', align: 'left', width: 152, min: 112, max: 260 },
  { key: 'date', label: 'Date', align: 'left', width: 112, min: 88, max: 170 },
  { key: 'warehouse', label: 'Warehouse', align: 'left', width: 122, min: 90, max: 220 },
  { key: 'customer', label: 'Customer', align: 'left', width: 214, min: 150, max: 340 },
  { key: 'preparedBy', label: 'Prepared By', align: 'left', width: 112, min: 80, max: 190 },
  { key: 'status', label: 'Status', align: 'left', width: 142, min: 112, max: 210 },
  { key: 'total', label: 'Total', align: 'right', width: 112, min: 84, max: 190 },
  { key: 'paid', label: 'Paid', align: 'right', width: 106, min: 78, max: 190 },
  { key: 'due', label: 'Due', align: 'right', width: 110, min: 80, max: 190 },
  { key: 'payment', label: 'Payment', align: 'center', width: 106, min: 78, max: 170 },
  { key: 'nextPay', label: 'Next Pay Date', align: 'left', width: 122, min: 90, max: 200 },
  { key: 'notes', label: 'Notes', align: 'left', width: 180, min: 110, max: 340, hidden: true },
  { key: 'action', label: 'Action', align: 'center', width: 130, min: 96, max: 200 }
];

const SALES_COL_SPECS: Record<string, ColumnSpec> = {};
for (const spec of SALES_COLUMNS) SALES_COL_SPECS[spec.key] = spec;

/** The leading columns that stay put while the table scrolls sideways. */
const PINNABLE_KEYS = ['sel', 'sl', 'invoice'];

const BN_COL_LABELS: Record<string, string> = {
  sel: 'নির্বাচন', sl: 'ক্রম', invoice: 'ইনভয়েস', date: 'তারিখ', warehouse: 'ওয়্যারহাউস',
  customer: 'কাস্টমার', preparedBy: 'প্রস্তুতকারী', status: 'স্ট্যাটাস', total: 'মোট',
  paid: 'পরিশোধ', due: 'বাকি', payment: 'পেমেন্ট', nextPay: 'পরবর্তী কিস্তি', notes: 'নোট', action: 'অ্যাকশন'
};

const STATUS_ORDER = ['Cancelled', 'Ordered', 'Processing', 'Shipping', 'Confirmed', 'Completed'];
const PAYMENT_ORDER: Sale['paymentStatus'][] = ['Unpaid', 'Partially Paid', 'Paid'];

function loadSavedView(): SavedView {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return DEFAULT_VIEW;
    const stored = JSON.parse(raw) as Partial<SavedView>;
    return {
      sortKey: typeof stored.sortKey === 'string' && stored.sortKey in SALES_COL_SPECS ? stored.sortKey : DEFAULT_VIEW.sortKey,
      sortDir: stored.sortDir === 'asc' ? 'asc' : 'desc',
      density: stored.density === 'compact' ? 'compact' : 'cozy'
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

function persistSavedView(view: SavedView): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // private mode / quota — the view simply starts from defaults next time
  }
}

@Component({
  selector: 'app-sales-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, MatIconModule, InvoiceModal, PartyLedger, VoucherSettingsModal, PasscodeModal, DateRangeBar, FormsModule, TablePagination, DragDropModule, DmyDateDirective, ShareInvoiceComponent],
  styles: `
    /* Geometry only. The cell colours live in styles.css, because component rules are
       attribute-scoped and a .dark ancestor selector there would never match. */
    .sl-table {
      table-layout: fixed;
      border-collapse: separate;
      border-spacing: 0;
    }
    .sl-table > thead > tr > th {
      position: sticky;
      top: 0;
      z-index: 20;
    }

    /* Pinned cells ride above the rest of the row. */
    .sl-table .pin { position: sticky; z-index: 15; }
    .sl-table > thead > tr > th.pin { z-index: 30; }
    .sl-table.dense > thead > tr > th,
    .sl-table.dense > tbody > tr > td { padding-top: 3px; padding-bottom: 3px; font-size: 10px; }

    .col-grip { cursor: grab; }
    .col-grip:active { cursor: grabbing; }
  `,
  template: `
    <div class="space-y-3.5">
      <!-- Title + view controls -->
      <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 text-white shadow-[0_18px_40px_-24px_rgba(13,148,136,0.8)] dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <span class="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-white/10 blur-3xl"></span>
        <span class="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-cyan-200/20 blur-3xl"></span>

        <div class="relative flex flex-wrap items-center gap-2.5 px-3.5 pt-3 pb-2.5">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 shadow-inner ring-1 ring-white/25">
            <mat-icon class="text-white" style="font-size:19px;width:19px;height:19px;">receipt_long</mat-icon>
          </span>
          <div class="min-w-0">
            <h1 class="truncate text-[15px] font-black tracking-tight">{{ prefs.txt('বিক্রয় তালিকা', 'Sales List') }}</h1>
            <p class="truncate text-[9.5px] font-bold uppercase tracking-[0.08em] text-teal-50/75">
              {{ prefs.txt('ড্যাশবোর্ড / বিক্রয়', 'Dashboard / Sales') }} ·
              <span class="font-mono">{{ sortedSales().length }} / {{ dataService.sales().length }}</span> {{ prefs.txt("টি রেকর্ড", "records") }}
            </p>
          </div>

          <div class="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
            <button
              (click)="isVoucherSettingsOpen.set(true)"
              class="inline-flex items-center gap-1 rounded-lg border border-white/25 bg-white/10 px-2.5 py-1.5 text-[10.5px] font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/20 cursor-pointer"
              [title]="prefs.txt('ভাউচার কাস্টমাইজেশন', 'Voucher customization')"
            >
              <mat-icon style="font-size:14px;width:14px;height:14px;">tune</mat-icon>
              <span class="hidden md:inline">{{ prefs.txt('ভাউচার সেটিংস', 'Voucher settings') }}</span>
            </button>
            <button (click)="exportExcel()" class="inline-flex items-center gap-1 rounded-lg border border-white/25 bg-white/10 px-2.5 py-1.5 text-[10.5px] font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/20 cursor-pointer">
              <mat-icon style="font-size:14px;width:14px;height:14px;">file_download</mat-icon>
              <span class="hidden sm:inline">{{ prefs.txt('এক্সেল', 'Excel') }}</span>
            </button>
            <button (click)="printPage()" class="inline-flex items-center gap-1 rounded-lg border border-white/25 bg-white/10 px-2.5 py-1.5 text-[10.5px] font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/20 cursor-pointer">
              <mat-icon style="font-size:14px;width:14px;height:14px;">print</mat-icon>
              <span class="hidden sm:inline">{{ prefs.txt('প্রিন্ট', 'Print') }}</span>
            </button>
            <a routerLink="/sales/add" class="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[10.5px] font-black text-teal-800 shadow-lg shadow-teal-950/20 transition-transform active:scale-95">
              <mat-icon style="font-size:15px;width:15px;height:15px;">add</mat-icon>
              {{ prefs.txt('নতুন বিক্রয়', 'New sale') }}
            </a>
          </div>
        </div>

        <div class="relative grid grid-cols-2 gap-1.5 px-3.5 pb-3 lg:grid-cols-4">
          <div class="flex items-center gap-2 rounded-xl bg-white/10 px-2.5 py-1.5 ring-1 ring-white/15 backdrop-blur-sm">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/15">
              <mat-icon style="font-size:15px;width:15px;height:15px;">payments</mat-icon>
            </span>
            <span class="min-w-0 leading-tight">
              <span class="block text-[8.5px] font-black uppercase tracking-[0.1em] text-teal-50/70">{{ prefs.txt('মোট বিক্রয়', 'Total sales') }}</span>
              <span class="block truncate font-mono text-[14.5px] font-black">৳ {{ totals().total | number:'1.2-2' }}</span>
            </span>
          </div>
          <div class="flex items-center gap-2 rounded-xl bg-emerald-300/15 px-2.5 py-1.5 ring-1 ring-emerald-200/30 backdrop-blur-sm">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-300/20 text-emerald-100">
              <mat-icon style="font-size:15px;width:15px;height:15px;">task_alt</mat-icon>
            </span>
            <span class="min-w-0 leading-tight">
              <span class="block text-[8.5px] font-black uppercase tracking-[0.1em] text-emerald-100/80">{{ prefs.txt('পরিশোধ', 'Paid') }}</span>
              <span class="block truncate font-mono text-[14.5px] font-black text-emerald-50">৳ {{ totals().paid | number:'1.2-2' }}</span>
            </span>
          </div>
          <div class="flex items-center gap-2 rounded-xl bg-rose-400/15 px-2.5 py-1.5 ring-1 ring-rose-200/30 backdrop-blur-sm">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-rose-300/20 text-rose-100">
              <mat-icon style="font-size:15px;width:15px;height:15px;">pending_actions</mat-icon>
            </span>
            <span class="min-w-0 leading-tight">
              <span class="block text-[8.5px] font-black uppercase tracking-[0.1em] text-rose-100/80">{{ prefs.txt('বাকি', 'Due') }}</span>
              <span class="block truncate font-mono text-[14.5px] font-black text-rose-50">৳ {{ totals().due | number:'1.2-2' }}</span>
            </span>
          </div>
          <div class="flex items-center gap-2 rounded-xl bg-white/10 px-2.5 py-1.5 ring-1 ring-white/15 backdrop-blur-sm" [title]="prefs.txt('আদায়ের হার', 'Collection rate')">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/15">
              <mat-icon style="font-size:15px;width:15px;height:15px;">percent</mat-icon>
            </span>
            <span class="min-w-0 flex-1 leading-tight">
              <span class="block text-[8.5px] font-black uppercase tracking-[0.1em] text-teal-50/70">{{ prefs.txt('আদায়ের হার', 'Collection rate') }}</span>
              <span class="flex items-center gap-1.5">
                <span class="block font-mono text-[14.5px] font-black">{{ collectionRate() }}%</span>
                <span class="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                  <span class="block h-full rounded-full bg-emerald-300" [style.width.%]="collectionRate()"></span>
                </span>
              </span>
            </span>
          </div>
        </div>
      </div>

      <!-- Status tabs + view controls -->
      <div class="no-print overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div class="flex flex-wrap items-center gap-2 p-2.5">
          <div class="inline-flex max-w-full shrink items-center gap-0.5 overflow-x-auto rounded-xl bg-slate-100/90 p-1 text-[11px] font-bold ring-1 ring-slate-200/70 dark:bg-slate-800/70 dark:ring-slate-700">
            @for (tab of tabs; track tab) {
              <button
                (click)="selectTab(tab)"
                class="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 transition-all active:scale-95 cursor-pointer"
                [class]="activeTab() === tab ? 'bg-white text-teal-700 shadow-sm ring-1 ring-teal-100 dark:bg-slate-900 dark:text-teal-300 dark:ring-teal-800' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900/60'"
              >
                <span class="size-1.5 rounded-full" [class]="tabDot(tab)" [style.opacity]="activeTab() === tab ? 1 : 0.55"></span>
                {{ tabLabel(tab) }}
                <span
                  class="rounded px-1 font-mono text-[9.5px] tabular-nums"
                  [class]="activeTab() === tab ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'bg-white/80 text-slate-500 dark:bg-slate-900/60 dark:text-slate-400'"
                >{{ tabCount(tab) }}</span>
              </button>
            }
          </div>

          <div class="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              (click)="toggleDensity()"
              class="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[10.5px] font-bold text-slate-700 transition-colors hover:bg-slate-50 active:scale-95 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              [title]="density() === 'compact' ? prefs.txt('প্রশস্ত ভিউতে যান', 'Switch to comfortable density') : prefs.txt('কম্প্যাক্ট ভিউতে যান', 'Switch to compact density')"
            >
              <mat-icon class="text-sm text-teal-600">{{ density() === 'compact' ? 'view_agenda' : 'format_line_spacing' }}</mat-icon>
              <span class="hidden sm:inline">{{ density() === 'compact' ? prefs.txt('কম্প্যাক্ট', 'Compact') : prefs.txt('প্রশস্ত', 'Cozy') }}</span>
            </button>

            <div class="relative">
              <button
                (click)="showColumnSelector.set(!showColumnSelector())"
                class="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[10.5px] font-bold text-slate-700 transition-colors hover:bg-slate-50 active:scale-95 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <mat-icon class="text-sm text-teal-600">view_column</mat-icon>
                <span class="hidden sm:inline">{{ prefs.txt('কলাম', 'Columns') }}</span>
                <span class="rounded bg-slate-100 px-1 font-mono text-[9.5px] tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{{ visibleCols().length }}</span>
                <mat-icon class="text-xs">expand_more</mat-icon>
              </button>

              @if (showColumnSelector()) {
                <div class="fixed inset-0 z-40" (click)="showColumnSelector.set(false)"></div>
                <div class="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                  <div class="mb-2 flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                    <span class="flex items-center gap-1 text-xs font-bold text-slate-900 dark:text-slate-100">
                      <mat-icon class="text-xs text-teal-600">tune</mat-icon> {{ prefs.txt('টেবিলের কলাম', 'Table columns') }}
                    </span>
                    <button (click)="showColumnSelector.set(false)" class="cursor-pointer text-slate-400 hover:text-slate-700">
                      <mat-icon class="text-sm">close</mat-icon>
                    </button>
                  </div>

                  <div class="max-h-72 space-y-1 overflow-y-auto pr-1 text-xs">
                    @for (c of allColumns(); track c.key) {
                      <label class="flex cursor-pointer items-center gap-2 rounded p-1 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800">
                        <input type="checkbox" class="accent-teal-600" [checked]="c.visible" (change)="toggleColumn(c.key)">
                        <span class="flex-1 truncate">{{ colLabel(c.key) }}</span>
                        <span class="font-mono text-[9.5px] tabular-nums text-slate-400">{{ c.width }}px</span>
                      </label>
                    }
                  </div>

                  <div class="mt-2 flex items-start gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[9.5px] font-medium leading-snug text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                    <mat-icon class="text-xs text-teal-500">drag_indicator</mat-icon>
                    <span>{{ prefs.txt('হেডার টেনে কলামের ক্রম বদলান, ডান প্রান্ত টেনে চওড়া বদলান। শিরোনামে ক্লিক করলে সেই কলাম দিয়ে সাজানো হয়।', 'Drag a header to reorder it, drag its right edge to resize it. Click a title to sort by that column.') }}</span>
                  </div>

                  <div class="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                    <button (click)="selectAllColumns()" class="cursor-pointer text-[10px] font-bold text-teal-600 hover:text-teal-800 dark:text-teal-400">{{ prefs.txt('সব দেখান', 'Show all') }}</button>
                    <button (click)="resetColumns()" class="cursor-pointer text-[10px] font-bold text-rose-600 hover:text-rose-800 dark:text-rose-400">{{ prefs.txt('ডিফল্টে ফেরান', 'Reset default') }}</button>
                  </div>
                </div>
              }
            </div>

            <button
              (click)="showFilters.set(!showFilters())"
              class="flex h-8 items-center gap-1 rounded-lg border px-2 text-[10.5px] font-bold transition-colors active:scale-95 cursor-pointer"
              [class]="activeFilterCount() > 0 ? 'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-600 dark:bg-teal-500/10 dark:text-teal-300' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'"
            >
              <mat-icon class="text-sm">filter_alt</mat-icon>
              {{ prefs.txt('ফিল্টার', 'Filters') }}
              @if (activeFilterCount() > 0) {
                <span class="grid size-4 place-items-center rounded-full bg-teal-600 font-mono text-[9px] text-white">{{ activeFilterCount() }}</span>
              }
            </button>
          </div>
        </div>

        <div class="px-2.5 pb-1">
          <app-date-range-bar [from]="dateFrom()" [to]="dateTo()" [toggleable]="true" (rangeChange)="onRangeChange($event)" />
        </div>

        <div class="flex flex-wrap items-center gap-2 border-t border-slate-100 px-2.5 py-2 dark:border-slate-800">
          <span class="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 font-mono text-[10px] font-bold text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700" [title]="prefs.txt('ফিল্টার করা / মোট বিক্রয়', 'Filtered / total sales')">
            <mat-icon class="text-teal-600" style="font-size:14px;width:14px;height:14px;">filter_alt</mat-icon>
            <b class="text-slate-900 dark:text-slate-100">{{ sortedSales().length }}</b>
            <span class="text-slate-300 dark:text-slate-600">/</span>{{ dataService.sales().length }}
            <span class="uppercase tracking-wide">{{ prefs.txt('রেকর্ড', 'records') }}</span>
          </span>

          <div class="relative ml-auto w-full sm:w-72">
            <mat-icon class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" style="font-size:16px;width:16px;height:16px;">search</mat-icon>
            <input
              id="sales-search"
              type="text"
              class="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-14 text-[11.5px] font-medium text-slate-700 transition-colors placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:placeholder:text-slate-500"
              [placeholder]="prefs.txt('ইনভয়েস, কাস্টমার, ফোন, আইটেম…', 'Search invoice, customer, phone, item…')"
              [title]="prefs.txt('ইনভয়েস, কাস্টমার, ফোন, দোকান, আইটেম বা নোট খুঁজুন…', 'Search invoice, customer, phone, shop, item or note…')"
              [value]="searchQuery()"
              (input)="onSearchInput($event)"
              (keydown.escape)="clearSearch()"
            />
            @if (searchQuery()) {
              <button (click)="clearSearch()" class="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 cursor-pointer" [title]="prefs.txt('সার্চ মুছুন', 'Clear search')">
                <mat-icon style="font-size:15px;width:15px;height:15px;">close</mat-icon>
              </button>
            } @else {
              <kbd class="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1 font-mono text-[9px] text-slate-400 sm:block dark:border-slate-700 dark:bg-slate-800">/</kbd>
            }
          </div>
        </div>

        @if (showFilters()) {
          <div class="mx-2.5 mb-2.5 mt-0.5 grid gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800/50">
            <div class="space-y-1.5">
              <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">{{ prefs.txt('ওয়্যারহাউস', 'Warehouse') }}</p>
              <select class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold focus:border-teal-500 focus:outline-none" [ngModel]="warehouseFilter()" (ngModelChange)="warehouseFilter.set($event)">
                <option value="All">{{ prefs.txt('সব ওয়্যারহাউস', 'All warehouses') }}</option>
                @for (w of warehouseOptions(); track w) {
                  <option [value]="w">{{ w }}</option>
                }
              </select>

              <p class="pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{{ prefs.txt('প্রস্তুতকারী', 'Prepared by') }}</p>
              <select class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold focus:border-teal-500 focus:outline-none" [ngModel]="preparedFilter()" (ngModelChange)="preparedFilter.set($event)">
                <option value="All">{{ prefs.txt('সবাই', 'Everyone') }}</option>
                @for (p of preparedOptions(); track p) {
                  <option [value]="p">{{ p }}</option>
                }
              </select>
            </div>

            <div class="space-y-1.5">
              <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">{{ prefs.txt('পেমেন্ট অবস্থা', 'Payment status') }}</p>
              <div class="flex flex-wrap gap-1">
                @for (ps of paymentFilters; track ps) {
                  <button
                    (click)="paymentFilter.set(ps); pager.setPage(1)"
                    class="rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors cursor-pointer"
                    [class]="paymentFilter() === ps ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'"
                  >{{ paymentLabel(ps) }}</button>
                }
              </div>
              <label class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10.5px] font-bold text-slate-600">
                <input type="checkbox" class="accent-rose-600" [ngModel]="onlyDue()" (ngModelChange)="onlyDue.set($event); pager.setPage(1)">
                {{ prefs.txt('শুধু বাকিসহ', 'Only with due') }}
              </label>
              <label class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10.5px] font-bold text-slate-600">
                <input type="checkbox" class="accent-amber-600" [ngModel]="onlyOverdue()" (ngModelChange)="onlyOverdue.set($event); pager.setPage(1)">
                {{ prefs.txt('কিস্তি অতিক্রান্ত', 'Instalment overdue') }}
              </label>
            </div>
          </div>
        }

        @if (filterChips().length) {
          <div class="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-2.5 py-2 text-[10px] font-bold dark:border-slate-800">
            <span class="text-slate-400">{{ prefs.txt('সক্রিয় ফিল্টার:', 'Active filters:') }}</span>
            @for (chip of filterChips(); track chip.key) {
              <button (click)="clearChip(chip.key)" class="flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-teal-800 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 cursor-pointer">
                <span class="max-w-[180px] truncate">{{ chip.label }}</span>
                <mat-icon class="text-[12px]">close</mat-icon>
              </button>
            }
            <button (click)="clearAllFilters()" class="cursor-pointer rounded-full px-2 py-0.5 text-rose-600 hover:bg-rose-50">{{ prefs.txt('সব মুছুন', 'Clear all') }}</button>
          </div>
        }
      </div>

      @if (selectedCount() > 0) {
        <div class="no-print flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-white p-2.5 text-xs font-bold shadow-xs">
          <span class="flex items-center gap-1.5 text-teal-700">
            <mat-icon class="text-sm">task_alt</mat-icon> {{ selectedCount() }} {{ prefs.txt('টি নির্বাচিত', 'selected') }}
          </span>
          <button (click)="exportSelected()" class="flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700">
            <mat-icon class="text-xs">description</mat-icon> {{ prefs.txt('নির্বাচিত এক্সপোর্ট', 'Export selected') }}
          </button>
          <button (click)="clearSelection()" class="flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100">
            <mat-icon class="text-xs">clear</mat-icon> {{ prefs.txt('মুছুন', 'Clear') }}
          </button>
        </div>
      }

      <!-- Page strip: rows on this page, their sums and the expander toggle -->
      <div class="no-print flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10.5px] font-bold text-slate-600 shadow-xs">
        <span class="flex items-center gap-1">
          <mat-icon class="text-sm text-teal-600">format_list_bulleted</mat-icon>
          {{ prefs.txt('এই পাতায়', 'On this page') }} <b class="font-mono tabular-nums text-slate-900">{{ pager.paged().length }}</b>
        </span>
        <span class="h-3.5 w-px bg-slate-200"></span>
        <span>{{ prefs.txt('মোট', 'Total') }} <b class="font-mono tabular-nums text-slate-900">৳{{ pageTotals().total | number:'1.2-2' }}</b></span>
        <span>{{ prefs.txt('পরিশোধ', 'Paid') }} <b class="font-mono tabular-nums text-emerald-600">{{ pageTotals().paid | number:'1.2-2' }}</b></span>
        <span>{{ prefs.txt('বাকি', 'Due') }} <b class="font-mono tabular-nums text-rose-600">{{ pageTotals().due | number:'1.2-2' }}</b></span>
          <span class="ml-auto flex items-center gap-1.5">
            <span class="hidden rounded-lg bg-slate-100 px-2 py-1 font-mono text-[9.5px] text-slate-500 sm:block">
              {{ prefs.txt('সাজানো:', 'sorted by:') }} {{ colLabel(sortKey()) }} · {{ sortDir() === 'asc' ? prefs.txt('উর্ধ্বমুখী', 'asc') : prefs.txt('নিম্নমুখী', 'desc') }}
            </span>
          </span>
      </div>
      <!-- Sales table: one grid, user-arranged columns, pinned invoice rail -->
      <div class="list-print-shell hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:block">
        <div id="list-printable-area" class="max-h-[72vh] overflow-auto">
          <table class="sl-table w-full text-left text-[11px] text-slate-700" [class.dense]="density() === 'compact'" [style.minWidth.px]="tableWidthPx()">
            <colgroup>
              @for (c of visibleCols(); track c.key) {
                <col [attr.data-col]="c.key" [style.width.px]="c.width">
              }
            </colgroup>

            <thead>
              <tr cdkDropList orientation="horizontal" (cdkDropListDropped)="onColumnDrop($event)">
                @for (c of visibleCols(); track c.key) {
                  <th
                    class="relative select-none px-2 py-2 text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-white"
                    [class.pin]="pinLeft()[c.key] !== undefined"
                    [class.pin-edge]="pinEdge()[c.key]"
                    [style.left.px]="pinLeft()[c.key]"
                    [class.text-right]="c.align === 'right'"
                    [class.text-center]="c.align === 'center'"
                    cdkDrag
                    cdkDragLockAxis="x"
                  >
                    @if (c.key === 'sel') {
                      <input
                        type="checkbox"
                        class="cursor-pointer rounded accent-white align-middle"
                        [checked]="allSelected()"
                        [indeterminate]="someSelected()"
                        (change)="toggleAllRows()"
                        [title]="prefs.txt('এই পাতার সব সারি নির্বাচন করুন', 'Select every row on this page')"
                      >
                    } @else {
                      <div class="flex items-center gap-1" [class.justify-end]="c.align === 'right'" [class.justify-center]="c.align === 'center'">
                        <span class="col-grip shrink-0 text-white/60" cdkDragHandle [title]="prefs.txt('টেনে কলাম সরান', 'Drag to move this column')">
                          <mat-icon class="text-[13px] leading-none">drag_indicator</mat-icon>
                        </span>
                        <button
                          type="button"
                          (click)="sortBy(c.key)"
                          class="flex min-w-0 cursor-pointer items-center gap-0.5 text-left text-white/90 hover:text-white"
                          [title]="sortHint(c.key)"
                        >
                          <span class="truncate">{{ colLabel(c.key) }}</span>
                          <mat-icon class="shrink-0 text-[12px] leading-none" [class]="sortKey() === c.key ? 'text-white' : 'text-white/50'">{{ sortIcon(c.key) }}</mat-icon>
                        </button>
                      </div>
                      <span
                        class="col-resizer"
                        [title]="prefs.txt('টেনে চওড়া বদলান', 'Drag to resize this column')"
                        (mousedown)="startColumnResize($event, c.key)"
                        (click)="$event.stopPropagation()"
                      ></span>
                    }
                  </th>
                }
              </tr>
            </thead>

            <tbody>
              @for (s of pager.paged(); track s.id; let idx = $index) {
                <tr
                  class="rowline cursor-pointer"
                  [class.alt]="idx % 2 === 1"
                  [class.picked]="isSelected(s.id)"
                  (click)="openRowDetails(s)"
                  [title]="prefs.txt('বিস্তারিত দেখতে ক্লিক করুন', 'Click to open details')"
                >
                  @for (c of visibleCols(); track c.key) {
                    @switch (c.key) {
                      @case ('sel') {
                        <td class="px-2 py-2 text-center align-middle" [class.pin]="pinLeft()['sel'] !== undefined" [class.pin-edge]="pinEdge()['sel']" [style.left.px]="pinLeft()['sel']">
                          <input type="checkbox" class="cursor-pointer rounded accent-teal-600 align-middle" [checked]="isSelected(s.id)" (click)="$event.stopPropagation()" (change)="toggleRow(s.id)">
                        </td>
                      }
                      @case ('sl') {
                        <td class="px-2 py-2 text-center align-middle" [class.pin]="pinLeft()['sl'] !== undefined" [class.pin-edge]="pinEdge()['sl']" [style.left.px]="pinLeft()['sl']">
                          <span class="font-mono text-[10px] font-bold tabular-nums text-slate-400">{{ pager.offset() + idx + 1 }}</span>
                        </td>
                      }
                      @case ('invoice') {
                        <td class="px-2 py-2 align-middle" [class.pin]="pinLeft()['invoice'] !== undefined" [class.pin-edge]="pinEdge()['invoice']" [style.left.px]="pinLeft()['invoice']">
                          <div class="flex min-w-0 items-center gap-1">
                            <button type="button" (click)="openInvoice(s); $event.stopPropagation()" class="group min-w-0 cursor-pointer text-left" [title]="prefs.txt('ভাউচার দেখুন', 'Open voucher')">
                              <span class="flex min-w-0 items-center gap-1">
                                <mat-icon class="shrink-0 text-[13px] leading-none text-teal-600">receipt_long</mat-icon>
                                <span class="truncate text-[10.5px] font-extrabold text-teal-800 group-hover:underline">{{ s.invoice }}</span>
                              </span>
                              <span class="block text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ itemCount(s) }} {{ prefs.txt('আইটেম', 'items') }}</span>
                              @if (hasWarranty(s)) {
                                <span class="mt-0.5 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-px text-[8px] font-black uppercase tracking-wide text-amber-700">
                                  <mat-icon class="text-[10px] leading-none">verified_user</mat-icon> {{ prefs.txt('ওয়ারেন্টি', 'Warranty') }}
                                </span>
                              }
                            </button>
                          </div>
                        </td>
                      }
                      @case ('date') {
                        <td class="px-2 py-2 align-middle">
                          <span class="block font-mono text-[10.5px] font-semibold tabular-nums text-slate-700">{{ displayDate(s.date) }}</span>
                          <span class="block text-[9px] font-bold" [class]="dayTone(s.date)">{{ relativeDay(s.date) }}</span>
                        </td>
                      }
                      @case ('warehouse') {
                        <td class="px-2 py-2 align-middle">
                          <span class="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-600">
                            <mat-icon class="shrink-0 text-[12px] leading-none text-slate-400">warehouse</mat-icon>
                            <span class="truncate">{{ clean(s.warehouse) }}</span>
                          </span>
                        </td>
                      }
                      @case ('customer') {
                        <td class="px-2 py-2 align-middle">
                          <button
                            type="button"
                            (click)="openCustomerLedger(s); $event.stopPropagation()"
                            class="group flex w-full min-w-0 cursor-pointer items-center gap-2 text-left"
                            [title]="prefs.txt('কাস্টমারের বিস্তারিত তথ্য ও লেজার দেখুন', 'Open customer details and ledger')"
                          >
                            <span class="grid size-7 shrink-0 place-items-center rounded-full bg-teal-100 text-[9.5px] font-extrabold text-teal-800">{{ initials(s.customerName) }}</span>
                            <span class="min-w-0">
                              <span class="block truncate text-[11px] font-bold text-slate-800 group-hover:text-teal-700 group-hover:underline">{{ clean(s.customerName) }}</span>
                              @if (s.shopName || s.mobile) {
                                <span class="block truncate text-[9px] font-medium text-slate-400">{{ contactLine(s) }}</span>
                              }
                            </span>
                          </button>
                        </td>
                      }
                      @case ('preparedBy') {
                        <td class="px-2 py-2 align-middle">
                          <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600">
                            <mat-icon class="text-[13px] leading-none text-slate-400">badge</mat-icon>{{ clean(s.preparedBy) }}
                          </span>
                        </td>
                      }
                      @case ('status') {
                        <td class="px-2 py-2 align-middle">
                          <div class="flex items-center gap-1">
                            @if (orderLock.isLocked(s)) {
                              <span class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9.5px] font-bold text-amber-700" [title]="prefs.txt('কনফার্ম করা অর্ডার লক করা', 'Confirmed orders are locked')">
                                <mat-icon class="text-[12px] leading-none">lock</mat-icon>{{ s.status }}
                              </span>
                              <button
                                type="button"
                                (click)="requestEditAccess(s, 'status'); $event.stopPropagation()"
                                class="cursor-pointer rounded bg-amber-500 p-1 text-white hover:bg-amber-600"
                                [title]="prefs.txt('পাসকোড দিয়ে আনলক করুন', 'Unlock with passcode')"
                              >
                                <mat-icon class="text-[13px] leading-none">key</mat-icon>
                              </button>
                            } @else {
                              <select
                                [ngModel]="s.status"
                                (ngModelChange)="onStatusChange(s, $event)"
                                (click)="$event.stopPropagation()"
                                class="w-full min-w-0 max-w-[130px] cursor-pointer rounded-full border px-2 py-1 text-[9.5px] font-bold focus:outline-none"
                                [class]="statusClass(s.status)"
                                [title]="prefs.txt('স্ট্যাটাস বদলান', 'Change status')"
                              >
                                @for (st of statuses; track st) {
                                  <option [value]="st">{{ tabLabel(st) }}</option>
                                }
                              </select>
                              @if (orderLock.isLockable(s.status)) {
                                <button type="button" (click)="lockSale(s); $event.stopPropagation()" class="cursor-pointer rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" [title]="prefs.txt('লক করে দিন', 'Lock this order')">
                                  <mat-icon class="text-[13px] leading-none">lock_open</mat-icon>
                                </button>
                              }
                            }
                          </div>
                        </td>
                      }
                      @case ('total') {
                        <td class="px-2 py-2 text-right align-middle">
                          <span class="font-mono text-[11px] font-extrabold tabular-nums text-slate-900">{{ s.total | number:'1.2-2' }}</span>
                          <span class="text-[9px] font-bold text-slate-400"> ৳</span>
                        </td>
                      }
                      @case ('paid') {
                        <td class="px-2 py-2 text-right align-middle">
                          <span class="font-mono text-[10.5px] font-bold tabular-nums text-emerald-600">{{ s.paid | number:'1.2-2' }}</span>
                          <span class="mt-1 block h-1 overflow-hidden rounded-full bg-slate-200">
                            <span class="block h-full rounded-full bg-emerald-500 transition-[width] duration-300" [style.width.%]="pctPaid(s)"></span>
                          </span>
                        </td>
                      }
                      @case ('due') {
                        <td class="px-2 py-2 text-right align-middle">
                          @if (s.due > 0.004) {
                            <span class="rounded-md bg-rose-50 px-1.5 py-0.5 font-mono text-[10.5px] font-extrabold tabular-nums text-rose-600">{{ s.due | number:'1.2-2' }}</span>
                          } @else {
                            <span class="font-mono text-[10px] font-semibold tabular-nums text-emerald-600">0.00</span>
                          }
                        </td>
                      }
                      @case ('payment') {
                        <td class="px-2 py-2 text-center align-middle">
                          <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold" [class]="paymentClass(s.paymentStatus)">
                            <span class="size-1.5 rounded-full bg-current"></span>{{ paymentLabel(s.paymentStatus) }}
                          </span>
                        </td>
                      }
                      @case ('nextPay') {
                        <td class="px-2 py-2 align-middle">
                          @switch (dueState(s)) {
                            @case ('overdue') {
                              <span class="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-700" [title]="prefs.txt('কিস্তির তারিখ পেরিয়ে গেছে', 'Instalment date has passed')">
                                <mat-icon class="text-[12px] leading-none">error</mat-icon>{{ shortDate(s.nextPayDate) }} · {{ overdueDays(s) }}{{ prefs.txt(' দিন', ' d') }}
                              </span>
                            }
                            @case ('soon') {
                              <span class="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700" [title]="prefs.txt('আসন্ন কিস্তি', 'Instalment due soon')">
                                <mat-icon class="text-[12px] leading-none">schedule</mat-icon>{{ shortDate(s.nextPayDate) }}
                              </span>
                            }
                            @case ('later') {
                              <span class="font-mono text-[10px] tabular-nums text-slate-500">{{ shortDate(s.nextPayDate) }}</span>
                            }
                            @default {
                              <span class="text-slate-300">—</span>
                            }
                          }
                        </td>
                      }
                      @case ('notes') {
                        <td class="px-2 py-2 align-middle">
                          <span class="block max-w-[200px] truncate text-[10px] text-slate-500" [title]="s.notes">{{ clean(s.notes) }}</span>
                        </td>
                      }
                      @case ('action') {
                        <td class="px-2 py-2 text-center align-middle">
                          <div class="flex items-center justify-center gap-1" (click)="$event.stopPropagation()">
                            <button type="button" (click)="openInvoice(s)" class="cursor-pointer rounded-md bg-teal-700 p-1 text-white hover:bg-teal-800" [title]="prefs.txt('ভাউচার দেখুন', 'View voucher')">
                              <mat-icon class="text-sm leading-none">visibility</mat-icon>
                            </button>
                            <button type="button" (click)="openInvoice(s)" class="cursor-pointer rounded-md bg-purple-600 p-1 text-white hover:bg-purple-700" [title]="prefs.txt('ভাউচার / প্রিন্ট', 'Voucher &amp; print')">
                              <mat-icon class="text-sm leading-none">print</mat-icon>
                            </button>
                            <button type="button" (click)="openPaymentModal(s)" class="cursor-pointer rounded-md bg-emerald-600 p-1 text-white hover:bg-emerald-700" [title]="prefs.txt('পেমেন্ট যোগ করুন', 'Add payment')">
                              <mat-icon class="text-sm leading-none">payments</mat-icon>
                            </button>
                            <button type="button" (click)="openActionModalForSale(s, $event)" class="cursor-pointer rounded-md bg-slate-600 p-1 text-white hover:bg-slate-700" [title]="prefs.txt('আরও অপশন', 'More options')">
                              <mat-icon class="text-sm leading-none">more_horiz</mat-icon>
                            </button>
                          </div>
                        </td>
                      }
                    }
                  }
                </tr>

              } @empty {
                <tr>
                  <td [attr.colspan]="visibleCols().length" class="p-12 text-center">
                    <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
                      <span class="grid size-12 place-items-center rounded-full bg-slate-100">
                        <mat-icon class="text-2xl text-slate-300">receipt_long</mat-icon>
                      </span>
                      <p class="text-xs font-semibold">{{ prefs.txt('এই ফিল্টারে কোনো বিক্রয় পাওয়া যায়নি।', 'No sales match these filters.') }}</p>
                      @if (activeFilterCount() || searchQuery()) {
                        <button (click)="clearAllFilters()" class="mt-1 rounded-lg border border-slate-200 px-3 py-1 text-[10px] font-bold text-teal-700 hover:bg-teal-50 cursor-pointer">
                          {{ prefs.txt('ফিল্টার মুছে সব দেখুন', 'Clear filters and show all') }}
                        </button>
                      }
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
          (pageChange)="onPageChange($event, 'list-printable-area')"
          (pageSizeChange)="onPageSizeChange($event, 'list-printable-area')"
        />
      </div>
      <!-- Mobile / tablet cards -->
      <div id="sales-mobile-list" class="mcards no-print overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:hidden">
        <div class="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-2 text-[10px] font-bold">
          <span class="shrink-0 text-slate-400">{{ prefs.txt('সাজান:', 'Sort by:') }}</span>
          @for (key of mobileSortKeys; track key) {
            <button
              (click)="sortBy(key)"
              class="min-h-9 shrink-0 rounded-full border px-2.5 py-1.5 transition-colors cursor-pointer"
              [class]="sortKey() === key ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600'"
            >{{ colLabel(key) }}</button>
          }
          <button
            (click)="toggleSortDir()"
            class="ml-auto shrink-0 rounded-full border border-slate-200 bg-white p-1.5 text-slate-600 cursor-pointer"
            [title]="sortDir() === 'asc' ? prefs.txt('উর্ধ্বমুখী', 'Ascending') : prefs.txt('নিম্নমুখী', 'Descending')"
          >
            <mat-icon class="text-sm leading-none">{{ sortDir() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
          </button>
        </div>

        <div class="divide-y divide-slate-100">
          @for (s of pager.paged(); track s.id) {
            <article
              class="mcard min-h-9 cursor-pointer space-y-2.5 p-3"
              [class.picked]="isSelected(s.id)"
              (click)="openRowDetails(s)"
              [title]="prefs.txt('বিস্তারিত দেখতে ট্যাপ করুন', 'Tap to open details')"
            >
              <div class="flex items-start gap-2">
                <input
                  type="checkbox"
                  class="mt-1 size-4 shrink-0 cursor-pointer accent-teal-600"
                  [checked]="isSelected(s.id)"
                  (click)="$event.stopPropagation()"
                  (change)="toggleRow(s.id)"
                  [title]="prefs.txt('নির্বাচন করুন', 'Select')"
                >
                <button type="button" (click)="openInvoice(s); $event.stopPropagation()" class="min-w-0 flex-1 cursor-pointer text-left">
                  <span class="flex items-center gap-1">
                    <mat-icon class="shrink-0 text-[15px] leading-none text-teal-600">receipt_long</mat-icon>
                    <span class="truncate text-[12.5px] font-extrabold text-teal-800">{{ s.invoice }}</span>
                  </span>
                  <span class="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9.5px] font-semibold text-slate-500">
                    <span class="font-mono tabular-nums">{{ displayDate(s.date) }}</span>
                    <span class="text-slate-300">•</span>
                    <span [class]="dayTone(s.date)">{{ relativeDay(s.date) }}</span>
                    <span class="text-slate-300">•</span>
                    <span>{{ itemCount(s) }} {{ prefs.txt('আইটেম', 'items') }}</span>
                    @if (hasWarranty(s)) {
                      <span class="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-px text-[8.5px] font-black uppercase tracking-wide text-amber-700">
                        <mat-icon class="text-[10px] leading-none">verified_user</mat-icon> {{ prefs.txt('ওয়ারেন্টি', 'Warranty') }}
                      </span>
                    }
                  </span>
                </button>
                <span class="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold" [class]="statusClass(s.status)">{{ s.status }}</span>
              </div>

              <button type="button" (click)="openCustomerLedger(s); $event.stopPropagation()" class="flex min-h-9 w-full min-w-0 cursor-pointer items-center gap-2 text-left">
                <span class="grid size-8 shrink-0 place-items-center rounded-full bg-teal-100 text-[10px] font-extrabold text-teal-800">{{ initials(s.customerName) }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[11.5px] font-bold text-slate-800">{{ clean(s.customerName) }}</span>
                  <span class="block truncate text-[9.5px] text-slate-400">{{ contactLine(s) || clean(s.warehouse) }}</span>
                </span>
                <mat-icon class="shrink-0 text-sm leading-none text-slate-300">receipt_long</mat-icon>
              </button>

              <div class="rounded-xl border border-slate-200 bg-slate-50 p-2">
                <div class="grid grid-cols-3 gap-1 text-center">
                  <div>
                    <p class="text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('মোট', 'Total') }}</p>
                    <p class="font-mono text-[11.5px] font-extrabold tabular-nums text-slate-800">{{ s.total | number:'1.2-2' }}</p>
                  </div>
                  <div>
                    <p class="text-[8.5px] font-bold uppercase tracking-wide text-emerald-500">{{ prefs.txt('পরিশোধ', 'Paid') }}</p>
                    <p class="font-mono text-[11.5px] font-bold tabular-nums text-emerald-600">{{ s.paid | number:'1.2-2' }}</p>
                  </div>
                  <div>
                    <p class="text-[8.5px] font-bold uppercase tracking-wide text-rose-400">{{ prefs.txt('বাকি', 'Due') }}</p>
                    <p class="font-mono text-[11.5px] font-extrabold tabular-nums text-rose-600">{{ s.due | number:'1.2-2' }}</p>
                  </div>
                </div>
                <div class="mt-2 flex items-center gap-2">
                  <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <span class="block h-full rounded-full bg-emerald-500" [style.width.%]="pctPaid(s)"></span>
                  </span>
                  <span class="font-mono text-[9.5px] font-bold tabular-nums text-slate-500">{{ pctPaid(s) }}%</span>
                  <span class="rounded-full px-1.5 py-0.5 text-[8.5px] font-bold" [class]="paymentClass(s.paymentStatus)">{{ paymentLabel(s.paymentStatus) }}</span>
                </div>
              </div>

              @if (dueState(s) !== 'none') {
                <div class="flex flex-wrap items-center gap-1.5 text-[9.5px] font-bold">
                  <span
                    class="inline-flex items-center gap-1 rounded-lg px-2 py-1"
                    [class]="dueState(s) === 'overdue' ? 'bg-rose-50 text-rose-700' : dueState(s) === 'soon' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'"
                  >
                    <mat-icon class="text-[12px] leading-none">{{ dueState(s) === 'overdue' ? 'error' : 'schedule' }}</mat-icon>
                    {{ prefs.txt('কিস্তি', 'Instalment') }} {{ shortDate(s.nextPayDate) }}
                    @if (dueState(s) === 'overdue') { · {{ overdueDays(s) }}{{ prefs.txt(' দিন বাকি', ' d late') }} }
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-slate-600">
                    <mat-icon class="text-[12px] leading-none">warehouse</mat-icon>{{ clean(s.warehouse) }}
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-slate-600">
                    <mat-icon class="text-[12px] leading-none">badge</mat-icon>{{ clean(s.preparedBy) }}
                  </span>
                </div>
              }

              <div class="flex items-center gap-1.5" (click)="$event.stopPropagation()">
                @if (orderLock.isLocked(s)) {
                  <button
                    type="button"
                    (click)="requestEditAccess(s, 'status')"
                    class="flex min-h-[38px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg bg-amber-500 px-2 text-[10px] font-bold text-white active:scale-95"
                  >
                    <mat-icon class="text-sm leading-none">lock</mat-icon>{{ prefs.txt('আনলক করুন', 'Unlock to change') }}
                  </button>
                } @else {
                  <select
                    [ngModel]="s.status"
                    (ngModelChange)="onStatusChange(s, $event)"
                    class="min-h-[38px] min-w-0 flex-1 cursor-pointer rounded-lg border px-2 text-[10px] font-bold focus:outline-none"
                    [class]="statusClass(s.status)"
                  >
                    @for (st of statuses; track st) {
                      <option [value]="st">{{ tabLabel(st) }}</option>
                    }
                  </select>
                  @if (orderLock.isLockable(s.status)) {
                    <button type="button" (click)="lockSale(s)" class="grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100" [title]="prefs.txt('লক করুন', 'Lock')">
                      <mat-icon class="text-sm leading-none">lock_open</mat-icon>
                    </button>
                  }
                }
                <button type="button" (click)="openPaymentModal(s)" class="grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-lg bg-emerald-600 text-white active:scale-95" [title]="prefs.txt('পেমেন্ট যোগ করুন', 'Add payment')">
                  <mat-icon class="text-sm leading-none">payments</mat-icon>
                </button>
                <button type="button" (click)="openActionModalForSale(s, $event)" class="grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-lg bg-slate-600 text-white active:scale-95" [title]="prefs.txt('আরও অপশন', 'More options')">
                  <mat-icon class="text-sm leading-none">more_horiz</mat-icon>
                </button>
              </div>

            </article>
          } @empty {
            <div class="p-10 text-center">
              <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
                <span class="grid size-12 place-items-center rounded-full bg-slate-100">
                  <mat-icon class="text-2xl text-slate-300">receipt_long</mat-icon>
                </span>
                <p class="text-xs font-semibold">{{ prefs.txt('এই ফিল্টারে কোনো বিক্রয় পাওয়া যায়নি।', 'No sales match these filters.') }}</p>
                @if (activeFilterCount() || searchQuery()) {
                  <button (click)="clearAllFilters()" class="mt-1 cursor-pointer rounded-lg border border-slate-200 px-3 py-1 text-[10px] font-bold text-teal-700 hover:bg-teal-50">
                    {{ prefs.txt('ফিল্টার মুছে সব দেখুন', 'Clear filters and show all') }}
                  </button>
                }
              </div>
            </div>
          }
        </div>

        <app-table-pagination
          [total]="pager.total()"
          [page]="pager.currentPage()"
          [pageSize]="pager.pageSize()"
          (pageChange)="onPageChange($event, 'sales-mobile-list')"
          (pageSizeChange)="onPageSizeChange($event, 'sales-mobile-list')"
        />
      </div>
    </div>

    <!-- Row details popup: opens when a row is clicked or a card is tapped -->
    @if (rowDetails(); as s) {
      <div class="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-2xs sm:p-4" (click)="closeRowDetails()">
        <div
          role="dialog"
          aria-modal="true"
          class="animate-in fade-in zoom-in-95 duration-150 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          (click)="$event.stopPropagation()"
        >
          <header class="flex shrink-0 items-start justify-between gap-3 bg-teal-700 px-4 py-3 text-white">
            <div class="min-w-0">
              <p class="flex items-center gap-1.5 text-[13px] font-extrabold">
                <mat-icon class="text-base leading-none">receipt_long</mat-icon>{{ s.invoice }}
              </p>
              <p class="mt-0.5 text-[10px] font-semibold text-teal-50">
                {{ displayDate(s.date) }} · {{ relativeDay(s.date) }} · {{ itemCount(s) }} {{ prefs.txt('আইটেম', 'items') }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span class="rounded-full border border-white/40 bg-white/15 px-2 py-0.5 text-[10px] font-bold">{{ s.status }}</span>
              <button (click)="closeRowDetails()" class="cursor-pointer rounded-lg p-1 hover:bg-white/20" [title]="prefs.txt('বন্ধ করুন', 'Close')">
                <mat-icon class="text-base leading-none">close</mat-icon>
              </button>
            </div>
          </header>

          <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
            <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <div class="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-800/60">
                <p class="text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('মোট', 'Total') }}</p>
                <p class="font-mono text-[12px] font-extrabold tabular-nums text-slate-900 dark:text-white">৳{{ money(s.total) }}</p>
              </div>
              <div class="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-800/60">
                <p class="text-[8.5px] font-bold uppercase tracking-wide text-emerald-500">{{ prefs.txt('পরিশোধ', 'Paid') }}</p>
                <p class="font-mono text-[12px] font-extrabold tabular-nums text-emerald-600">{{ money(s.paid) }}</p>
              </div>
              <div class="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-800/60">
                <p class="text-[8.5px] font-bold uppercase tracking-wide text-rose-400">{{ prefs.txt('বাকি', 'Due') }}</p>
                <p class="font-mono text-[12px] font-extrabold tabular-nums text-rose-600">{{ money(s.due) }}</p>
              </div>
              <div class="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-800/60">
                <p class="text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('পেমেন্ট', 'Payment') }}</p>
                <p class="mt-0.5"><span class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold" [class]="paymentClass(s.paymentStatus)">{{ paymentLabel(s.paymentStatus) }}</span></p>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              <div class="rounded-xl border border-slate-200 px-2.5 py-2 dark:border-slate-800">
                <p class="text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('কাস্টমার', 'Customer') }}</p>
                <p class="truncate text-[11px] font-bold">{{ clean(s.customerName) }}</p>
                <p class="truncate text-[9.5px] text-slate-500">{{ contactLine(s) || '—' }}</p>
              </div>
              <div class="rounded-xl border border-slate-200 px-2.5 py-2 dark:border-slate-800">
                <p class="text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('ওয়্যারহাউস', 'Warehouse') }}</p>
                <p class="truncate text-[11px] font-bold">{{ clean(s.warehouse) }}</p>
                <p class="truncate text-[9.5px] text-slate-500">{{ prefs.txt('প্রস্তুতকারী', 'Prepared by') }}: {{ clean(s.preparedBy) }}</p>
              </div>
              <div class="rounded-xl border border-slate-200 px-2.5 py-2 dark:border-slate-800">
                <p class="text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('কিস্তির তারিখ', 'Next payment') }}</p>
                <p class="text-[11px] font-bold" [class]="dayTone(s.nextPayDate)">{{ displayDate(s.nextPayDate) }}</p>
                <p class="truncate text-[9.5px] text-slate-500">{{ relativeDay(s.nextPayDate) }}</p>
              </div>
            </div>

            <div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <p class="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[9.5px] font-extrabold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/60">
                <mat-icon class="text-sm text-teal-600">inventory_2</mat-icon>
                {{ prefs.txt('আইটেম তালিকা', 'Items') }} ({{ itemCount(s) }})
              </p>
              @if (itemCount(s)) {
                <table class="w-full text-left text-[10px]">
                  <thead>
                    <tr class="text-[8.5px] uppercase tracking-wide text-slate-400">
                      <th class="px-2.5 py-1 font-bold">#</th>
                      <th class="py-1 font-bold">{{ prefs.txt('পণ্য', 'Product') }}</th>
                      <th class="py-1 text-right font-bold">{{ prefs.txt('পরিমাণ', 'Qty') }}</th>
                      <th class="py-1 text-right font-bold">{{ prefs.txt('দর', 'Rate') }}</th>
                      <th class="px-2.5 py-1 text-right font-bold">{{ prefs.txt('মোট', 'Total') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (it of s.items || []; track it.id; let i = $index) {
                      <tr class="border-t border-slate-100 dark:border-slate-800">
                        <td class="px-2.5 py-1 font-mono tabular-nums text-slate-400">{{ i + 1 }}</td>
                        <td class="py-1 pr-2 font-semibold">{{ itemName(it) }}</td>
                        <td class="py-1 text-right font-mono tabular-nums text-slate-500">{{ it.quantity }} {{ it.unit }}</td>
                        <td class="py-1 text-right font-mono tabular-nums text-slate-500">{{ money(it.salesPrice) }}</td>
                        <td class="px-2.5 py-1 text-right font-mono font-bold tabular-nums">{{ money(it.total) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              } @else {
                <p class="px-2.5 py-3 text-[10px] font-semibold text-slate-400">{{ prefs.txt('এই ভাউচারে আইটেম রেকর্ড নেই।', 'No items recorded on this voucher.') }}</p>
              }
            </div>

            @if (moneyMetrics(s).length) {
              <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                @for (metric of moneyMetrics(s); track metric.label) {
                  <div class="rounded-xl border border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
                    <p class="text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ metric.label }}</p>
                    <p class="font-mono text-[10.5px] font-extrabold tabular-nums" [class]="metric.tone">{{ metric.value }}</p>
                  </div>
                }
              </div>
            }

            @if (s.shopName || s.mobile || s.address) {
              <div class="space-y-0.5 rounded-xl border border-slate-200 px-2.5 py-2 text-[10px] dark:border-slate-800">
                <p class="text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('কাস্টমার যোগাযোগ', 'Customer contact') }}</p>
                @if (s.shopName) {
                  <p class="flex items-center gap-1 font-bold"><mat-icon class="text-[12px] text-slate-400">storefront</mat-icon>{{ s.shopName }}</p>
                }
                @if (s.mobile) {
                  <p class="flex items-center gap-1 font-mono text-slate-500"><mat-icon class="text-[12px] text-slate-400">phone</mat-icon>{{ s.mobile }}</p>
                }
                @if (s.address) {
                  <p class="leading-snug text-slate-500">{{ s.address }}</p>
                }
              </div>
            }

            @if (clean(s.notes) !== '—') {
              <div class="rounded-xl border border-slate-200 px-2.5 py-2 text-[10px] dark:border-slate-800">
                <p class="mb-0.5 text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('নোট', 'Notes') }}</p>
                <p class="leading-snug text-slate-600 dark:text-slate-300">{{ s.notes }}</p>
              </div>
            }

            @if ((s.returns || []).length) {
              <p class="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700">
                {{ prefs.txt('ফেরত', 'Returns') }}: {{ (s.returns || []).length }} {{ prefs.txt('টি আইটেম', 'items') }}
              </p>
            }

            <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-2.5 py-2 text-[10px] font-bold dark:border-slate-800">
              <span class="text-slate-500">{{ prefs.txt('আদায় হার', 'Collected') }}</span>
              <span class="flex items-center gap-2">
                <span class="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <span class="block h-full rounded-full bg-emerald-500 transition-[width] duration-300" [style.width.%]="pctPaid(s)"></span>
                </span>
                <b class="font-mono tabular-nums">{{ pctPaid(s) }}%</b>
              </span>
            </div>
          </div>

          <footer class="flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-t border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
            <button type="button" (click)="closeRowDetails(); openCustomerLedger(s)" class="flex min-h-9 cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[10.5px] font-bold text-slate-700 hover:bg-slate-100 active:scale-95 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
              <mat-icon class="text-sm text-teal-600">people</mat-icon>{{ prefs.txt('কাস্টমারের বিস্তারিত', 'Customer details') }}
            </button>
            <button type="button" (click)="closeRowDetails(); openPaymentModal(s)" class="flex min-h-9 cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[10.5px] font-bold text-white hover:bg-emerald-700 active:scale-95">
              <mat-icon class="text-sm leading-none">payments</mat-icon>{{ prefs.txt('পেমেন্ট যোগ', 'Add payment') }}
            </button>
            <button type="button" (click)="closeRowDetails(); openInvoice(s)" class="flex min-h-9 cursor-pointer items-center gap-1 rounded-lg bg-teal-700 px-3 text-[10.5px] font-bold text-white hover:bg-teal-800 active:scale-95">
              <mat-icon class="text-sm leading-none">receipt_long</mat-icon>{{ prefs.txt('ভাউচার দেখুন', 'View voucher') }}
            </button>
          </footer>
        </div>
      </div>
    }

    <!-- Invoice Modal (Sidebar Drawer) -->
    @if (selectedInvoice()) {
      <app-invoice-modal [sale]="selectedInvoice()!" (closeModal)="selectedInvoice.set(null)" />
    }

    <!-- POS Invoice: the 80mm thermal slip, rebuilt from a saved sale -->
    @if (posInvoiceSale(); as s) {
      <div class="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-2xs flex items-center justify-center p-3" (click)="closePosInvoice()">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-[330px] max-h-[92vh] overflow-hidden flex flex-col" (click)="$event.stopPropagation()">
          <div class="px-3 py-2 border-b border-slate-200 flex items-center justify-between no-print shrink-0">
            <span class="font-bold text-slate-700 text-xs flex items-center gap-1">
              <mat-icon class="text-blue-600 text-sm">point_of_sale</mat-icon> {{ prefs.txt('পিওএস ইনভয়েস', 'POS Invoice') }}
            </span>
            <div class="flex items-center gap-1">
              <app-share-invoice
                [iconOnly]="true"
                [paperEl]="posInvoicePaper"
                [fileName]="'Invoice_' + s.invoice"
                [title]="'POS Invoice ' + s.invoice"
                [message]="posShareText(s)"
                [pdfWidthMm]="80"
              />
              <button type="button" (click)="closePosInvoice()" class="p-1 text-slate-400 hover:text-slate-700">
                <mat-icon class="text-sm">close</mat-icon>
              </button>
            </div>
          </div>

          <div class="overflow-y-auto">
            <div #posInvoicePaper id="pos-invoice-print-area" class="receipt-paper p-4 text-slate-900 bg-white"
              [attr.data-pos-shop]="(dataService.voucherSettings().businessNamePart1 + ' ' + dataService.voucherSettings().businessNamePart2).trim()"
              [attr.data-pos-doc]="prefs.txt('পিওএস ইনভয়েস', 'POS INVOICE')"
              [attr.data-pos-invoice]="s.invoice"
              [attr.data-pos-page-word]="prefs.txt('পৃষ্ঠা', 'Page')"
              [attr.data-pos-continued]="prefs.txt('পরবর্তী পৃষ্ঠা', 'continued')">
              <div data-pos="head" class="text-center border-b border-dashed border-slate-400 pb-2">
                <p class="font-black text-sm tracking-wide">{{ dataService.voucherSettings().businessNamePart1 }} {{ dataService.voucherSettings().businessNamePart2 }}</p>
                <p class="text-[10px]">{{ dataService.voucherSettings().address }}</p>
                @if (dataService.voucherSettings().mobile) {
                  <p class="text-[10px]">{{ prefs.txt('মোবাইল', 'Mobile') }}: {{ dataService.voucherSettings().mobile }}</p>
                }
                <p class="font-black text-[11px] mt-1 uppercase tracking-wider">{{ prefs.txt('পিওএস ইনভয়েস', 'POS INVOICE') }}</p>
              </div>

              <div data-pos="meta" class="text-[10px] space-y-0.5 mt-2">
                <div class="flex justify-between gap-2"><span>{{ prefs.txt('ইনভয়েস', 'Invoice') }}</span><b class="font-mono">{{ s.invoice }}</b></div>
                <div class="flex justify-between gap-2"><span>{{ prefs.txt('তারিখ', 'Date') }}</span><b>{{ s.date }}</b></div>
                <div class="flex justify-between gap-2"><span>{{ prefs.txt('প্রস্তুতকারী', 'Prepared by') }}</span><b>{{ s.preparedBy || '—' }}</b></div>
                <div class="flex justify-between gap-2"><span>{{ prefs.txt('কাস্টমার', 'Customer') }}</span><b class="text-right">{{ s.customerName || 'Walk-in' }}</b></div>
                <div class="flex justify-between gap-2"><span>{{ prefs.txt('মোবাইল', 'Phone') }}</span><b>{{ s.mobile || '—' }}</b></div>
              </div>

              <table data-pos="items" class="w-full text-[10px] mt-2 border-collapse">
                <thead>
                  <tr class="border-y border-dashed border-slate-400 text-left">
                    <th class="py-1 font-bold">{{ prefs.txt('পণ্য', 'Item') }}</th>
                    <th class="py-1 font-bold text-center whitespace-nowrap">{{ prefs.txt('পরিমাণ × দর', 'Qty × Rate') }}</th>
                    <th class="py-1 font-bold text-right">{{ prefs.txt('টাকা', 'Amount') }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (it of s.items; track it.id) {
                    <tr class="align-top border-b border-dotted border-slate-200 last:border-0">
                      <td class="py-0.5 pr-1">{{ itemName(it) }}</td>
                      <td class="py-0.5 text-center whitespace-nowrap">{{ it.quantity }} × {{ it.salesPrice | number:'1.2-2' }}</td>
                      <td class="py-0.5 text-right font-mono whitespace-nowrap">{{ it.total | number:'1.2-2' }}</td>
                    </tr>
                  }
                </tbody>
              </table>

              @if (posBatteryRows(s).length) {
                <div data-pos="extra" class="text-[10px] mt-2 pt-2 border-t border-dashed border-slate-400 space-y-0.5">
                  <p class="font-black uppercase tracking-wide">{{ prefs.txt('পুরাতন ব্যাটারি সমন্বয়', 'Old Battery Adjustment') }}</p>
                  @for (b of posBatteryRows(s); track b.id) {
                    <div class="flex justify-between gap-2">
                      <span>{{ b.description || '—' }} · {{ b.weightKg }} {{ b.unit || 'kg' }} × {{ b.ratePerKg | number:'1.2-2' }}</span>
                      <span class="font-mono whitespace-nowrap">{{ b.total | number:'1.2-2' }}</span>
                    </div>
                  }
                  <div class="flex justify-between font-bold">
                    <span>{{ prefs.txt('মোট ব্যাটারি জমা', 'Battery Total') }}</span>
                    <span class="font-mono">{{ posBatteryTotal(s) | number:'1.2-2' }}</span>
                  </div>
                </div>
              }

              @if (posReturnRows(s).length) {
                <div data-pos="extra" class="text-[10px] mt-2 pt-2 border-t border-dashed border-slate-400 space-y-0.5">
                  <p class="font-black uppercase tracking-wide">{{ prefs.txt('ফেরত মাল সমন্বয়', 'Returned Goods Adjustment') }}</p>
                  @for (r of posReturnRows(s); track r.id) {
                    <div class="flex justify-between gap-2">
                      <span>{{ r.item || '—' }} · {{ r.qty || '1' }} × {{ r.rate | number:'1.2-2' }}</span>
                      <span class="font-mono whitespace-nowrap">{{ r.amount | number:'1.2-2' }}</span>
                    </div>
                  }
                  <div class="flex justify-between font-bold">
                    <span>{{ prefs.txt('মোট ফেরত সমন্বয়', 'Returns Total') }}</span>
                    <span class="font-mono">{{ posReturnTotal(s) | number:'1.2-2' }}</span>
                  </div>
                </div>
              }

              @if (s.warranty?.claimNo) {
                <div data-pos="extra" class="text-[10px] mt-2 pt-2 border-t border-dashed border-slate-400 space-y-0.5">
                  <p class="font-black uppercase tracking-wide">{{ prefs.txt('ওয়ারেন্টি ক্লেইম', 'Warranty Claim') }}</p>
                  <div class="flex justify-between gap-2"><span>{{ prefs.txt('ক্লেইম নং', 'Claim No.') }}</span><b class="font-mono">{{ s.warranty?.claimNo }}</b></div>
                  @if (s.warranty?.originalInvoice) {
                    <div class="flex justify-between gap-2"><span>{{ prefs.txt('মূল ইনভয়েস', 'Original Invoice') }}</span><b class="font-mono">{{ s.warranty?.originalInvoice }}</b></div>
                  }
                  @if (s.warranty?.battery) {
                    <div class="flex justify-between gap-2"><span>{{ prefs.txt('ব্যাটারি', 'Battery') }}</span><b>{{ s.warranty?.battery }}</b></div>
                  }
                </div>
              }

              <div data-pos="summary" class="text-[10px] mt-2 pt-2 border-t border-dashed border-slate-400 space-y-0.5">
                <div class="flex justify-between"><span>{{ prefs.txt('সাবটোটাল', 'Subtotal') }}</span><span class="font-mono">{{ saleSubtotal(s) | number:'1.2-2' }}</span></div>
                @if ((s.taxAmount ?? 0) > 0) {
                  <div class="flex justify-between"><span>{{ prefs.txt('ট্যাক্স', 'Tax') }}</span><span class="font-mono">{{ s.taxAmount | number:'1.2-2' }}</span></div>
                }
                @if (saleDiscountTotal(s) > 0) {
                  <div class="flex justify-between"><span>{{ prefs.txt('ডিসকাউন্ট', 'Discount') }}</span><span class="font-mono">-{{ saleDiscountTotal(s) | number:'1.2-2' }}</span></div>
                }
                @if ((s.shipping ?? 0) > 0) {
                  <div class="flex justify-between"><span>{{ prefs.txt('শিপিং', 'Shipping') }}</span><span class="font-mono">{{ s.shipping | number:'1.2-2' }}</span></div>
                }
                @if ((s.warrantyTransport ?? 0) > 0) {
                  <div class="flex justify-between"><span>{{ prefs.txt('ওয়ারেন্টি যাতায়াত', 'Warranty Transport') }}</span><span class="font-mono">{{ s.warrantyTransport | number:'1.2-2' }}</span></div>
                }
                @if ((s.damageAmount ?? 0) > 0) {
                  <div class="flex justify-between"><span>{{ prefs.txt('ড্যামেজ', 'Damage') }}</span><span class="font-mono">{{ s.damageAmount | number:'1.2-2' }}</span></div>
                }
                @if ((s.previousDue ?? 0) > 0) {
                  <div class="flex justify-between"><span>{{ prefs.txt('আগের বাকি', 'Previous Balance') }}</span><span class="font-mono">{{ s.previousDue | number:'1.2-2' }}</span></div>
                }
                <div class="flex justify-between font-black text-sm border-t border-slate-400 mt-1 pt-1">
                  <span>{{ prefs.txt('সর্বমোট', 'TOTAL') }}</span><span class="font-mono">{{ s.total | number:'1.2-2' }} TK</span>
                </div>
                <div class="flex justify-between mt-1"><span>{{ s.paymentMode || prefs.txt('নগদ', 'Cash') }}</span><span class="font-mono">{{ s.paid | number:'1.2-2' }}</span></div>
                @if (posBatteryTotal(s) > 0) {
                  <div class="flex justify-between"><span>{{ prefs.txt('পুরাতন ব্যাটারি ক্রেডিট', 'Old Battery Credit') }}</span><span class="font-mono">-{{ posBatteryTotal(s) | number:'1.2-2' }}</span></div>
                }
                @if (posReturnTotal(s) > 0) {
                  <div class="flex justify-between"><span>{{ prefs.txt('ফেরত মাল ক্রেডিট', 'Returned Goods Credit') }}</span><span class="font-mono">-{{ posReturnTotal(s) | number:'1.2-2' }}</span></div>
                }
                @if ((s.due ?? 0) > 0) {
                  <div class="flex justify-between font-bold text-rose-700"><span>{{ prefs.txt('বাকি', 'Remaining Due') }}</span><span class="font-mono">{{ s.due | number:'1.2-2' }}</span></div>
                }
              </div>

              <p data-pos="footer" class="text-[10px] text-center mt-2 font-semibold">{{ prefs.txt('ধন্যবাদ, আবার আসবেন!', 'Thank you, visit again!') }}</p>
              <p data-pos="footer" class="text-[9px] text-center text-slate-500 mt-0.5">Powered by SM Enterprise</p>

              @if (s.memoNote) {
                <div data-pos="notes" class="text-[10px] mt-2 pt-2 border-t border-dashed border-slate-400 leading-snug">
                  <b>{{ prefs.txt('নোট', 'Note') }}:</b> {{ s.memoNote }}
                </div>
              }

              @if (posInvoiceQr()) {
                <div data-pos="qr" class="mt-2 flex justify-center">
                  <img [src]="posInvoiceQr()" alt="Voucher QR" class="w-[72px] h-[72px]" />
                </div>
              }
            </div>
          </div>

          <div class="p-3 border-t border-slate-200 bg-slate-50 flex gap-2 no-print shrink-0">
            <button type="button" (click)="printPosInvoice()" class="flex-1 bg-teal-700 hover:bg-teal-800 text-white rounded-lg py-2.5 font-bold flex items-center justify-center gap-1">
              <mat-icon class="text-base">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
            <button type="button" (click)="closePosInvoice()" class="flex-1 bg-white border border-slate-300 text-slate-700 rounded-lg py-2.5 font-bold">{{ prefs.txt('বন্ধ করুন', 'Close') }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Customer Ledger Drawer (opened from the CUSTOMER name) -->
    @if (ledgerParty(); as p) {
      <app-party-ledger [party]="p" [side]="'sales'" (close)="ledgerParty.set(null)" />
    }

    <!-- Voucher Customization & Settings Modal -->
    @if (isVoucherSettingsOpen()) {
      <app-voucher-settings-modal (closeModal)="isVoucherSettingsOpen.set(false)" />
    }

    <!-- Action Settings Popup Modal (Robust, never clipped by table overflow) -->
    @if (actionMenuSale()) {
      <div class="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4" (click)="closeActionModal()">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xs max-h-[88vh] overflow-y-auto border border-slate-200 text-xs text-slate-800 animate-in fade-in zoom-in-95 duration-150" (click)="$event.stopPropagation()">
          
          <div class="bg-teal-700 text-white px-4 py-3 flex items-center justify-between">
            <div>
              <h3 class="font-bold text-sm">Invoice #{{ actionMenuSale()?.invoice }}</h3>
              <p class="text-[10px] text-teal-100">{{ prefs.txt('কার্যক্রম নির্বাচন', 'Select action') }}</p>
            </div>
            <button (click)="closeActionModal()" class="text-white hover:bg-teal-700 p-1 rounded">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          @if (orderLock.isLocked(actionMenuSale()!)) {
            <div class="px-4 py-2 bg-amber-50 border-b border-amber-100 text-amber-800 text-[10px] font-semibold flex items-start gap-1.5">
              <mat-icon class="text-xs mt-0.5">lock</mat-icon>
              <span>{{ prefs.txt('কনফার্ম করা অর্ডার লক করা আছে। ইডিট / ডিলিট করতে পাসকোড লাগবে।', 'Confirmed orders are locked. A passcode is required to edit or delete.') }}</span>
            </div>
          }

          <div class="py-2 divide-y divide-slate-100 text-xs font-semibold">
            <div class="py-1">
              <button
                (click)="handleActionOption('Edit')"
                class="w-full px-4 py-2 text-slate-700 hover:bg-teal-50 hover:text-teal-900 flex items-center gap-2 text-left"
              >
                <mat-icon class="text-sm text-teal-600">edit</mat-icon> {{ prefs.txt('এডিট', 'Edit') }}
              </button>
              <button
                (click)="handleActionOption('View Payments')"
                class="w-full px-4 py-2 text-slate-700 hover:bg-teal-50 hover:text-teal-900 flex items-center gap-2 text-left"
              >
                <mat-icon class="text-sm text-teal-600">receipt_long</mat-icon> {{ prefs.txt('পেমেন্ট দেখুন', 'View Payments') }}
              </button>
              <button
                (click)="handleActionOption('Add New Payment')"
                class="w-full px-4 py-2 text-slate-700 hover:bg-teal-50 hover:text-teal-900 flex items-center gap-2 text-left"
              >
                <mat-icon class="text-sm text-emerald-600">payments</mat-icon> {{ prefs.txt('নতুন পেমেন্ট', 'Add New Payment') }}
              </button>
              <button
                (click)="handleActionOption('POS Invoice')"
                class="w-full px-4 py-2 text-slate-700 hover:bg-teal-50 hover:text-teal-900 flex items-center gap-2 text-left"
              >
                <mat-icon class="text-sm text-blue-600">point_of_sale</mat-icon> {{ prefs.txt('পিওএস ইনভয়েস', 'POS Invoice') }}
              </button>
              <button
                (click)="handleActionOption('Add Expense')"
                class="w-full px-4 py-2 text-slate-700 hover:bg-teal-50 hover:text-teal-900 flex items-center gap-2 text-left"
              >
                <mat-icon class="text-sm text-amber-600">money_off</mat-icon> {{ prefs.txt('খরচ যোগ করুন', 'Add Expense') }}
              </button>
              <button
                (click)="handleActionOption('Download Invoice')"
                class="w-full px-4 py-2 text-slate-700 hover:bg-teal-50 hover:text-teal-900 flex items-center gap-2 text-left"
              >
                <mat-icon class="text-sm text-purple-600">download</mat-icon> {{ prefs.txt('ইনভয়েস ডাউনলোড', 'Download Invoice') }}
              </button>
              <button
                (click)="handleActionOption('Print Invoice')"
                class="w-full px-4 py-2 text-slate-700 hover:bg-teal-50 hover:text-teal-900 flex items-center gap-2 text-left"
              >
                <mat-icon class="text-sm text-teal-700">print</mat-icon> {{ prefs.txt('ইনভয়েস প্রিন্ট', 'Print Invoice') }}
              </button>
              <button
                (click)="handleActionOption('Voucher Settings')"
                class="w-full px-4 py-2 text-slate-700 hover:bg-teal-50 hover:text-teal-900 flex items-center gap-2 text-left"
              >
                <mat-icon class="text-sm text-slate-800">tune</mat-icon> {{ prefs.txt('ভাউচার সেটিংস', 'Voucher Settings') }}
              </button>
            </div>
            <div class="py-1">
              <button
                (click)="handleActionOption('Delete')"
                class="w-full px-4 py-2 text-rose-600 hover:bg-rose-50 flex items-center gap-2 text-left font-bold"
              >
                <mat-icon class="text-sm text-rose-600">delete</mat-icon> {{ prefs.txt('ডিলিট', 'Delete') }}
              </button>
            </div>
          </div>

        </div>
      </div>
    }

    <!-- Add New Payment Modal -->
    @if (selectedSaleForPayment()) {
      <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto border border-slate-200 text-xs text-slate-800 animate-in fade-in zoom-in-95 duration-200">
          
          <!-- Modal Header -->
          <div class="flex items-center justify-between bg-teal-700 text-white p-4">
            <div>
              <h2 class="text-base font-bold">{{ prefs.txt('নতুন পেমেন্ট যোগ করুন', 'Add New Payment') }}</h2>
              <p class="text-[11px] text-teal-100">{{ prefs.txt('ইনভয়েস', 'Invoice') }}: {{ selectedSaleForPayment()?.invoice }} | {{ prefs.txt('কাস্টমার', 'Customer') }}: {{ selectedSaleForPayment()?.customerName }}</p>
            </div>
            <button (click)="closePaymentModal()" class="text-white hover:bg-teal-700 p-1.5 rounded-lg transition-colors">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          <!-- Modal Body -->
          <div class="p-5 space-y-4">
            
            <!-- Row 1: Payment Date & Payment Mode -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-bold text-rose-600 mb-1">* {{ prefs.txt('পেমেন্টের তারিখ', 'Payment Date') }}</label>
                <div class="relative">
                  <input
                    type="date"
                    appDmyDate
                    [(ngModel)]="paymentDate"
                    class="w-full border border-slate-300 rounded-lg p-2 font-semibold bg-white focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label class="block font-bold text-rose-600 mb-1">* {{ prefs.txt('পেমেন্ট মাধ্যম', 'Payment Mode') }}</label>
                <div class="flex items-center gap-1">
                  <select [(ngModel)]="paymentMode" class="w-full border border-slate-300 rounded-lg p-2 font-semibold bg-white focus:border-teal-500 focus:outline-none">
                    <option value="Cash">{{ prefs.txt('নগদ', 'Cash') }}</option>
                    <option value="Bank Transfer">{{ prefs.txt('ব্যাংক ট্রান্সফার', 'Bank Transfer') }}</option>
                    <option value="bKash / Nagad">{{ prefs.txt('বিকাশ / নগদ', 'bKash / Nagad') }}</option>
                    <option value="Cheque">{{ prefs.txt('চেক', 'Cheque') }}</option>
                  </select>
                  <button class="bg-teal-700 text-white p-2 rounded-lg shrink-0">
                    <mat-icon class="text-xs">add</mat-icon>
                  </button>
                </div>
              </div>
            </div>

            <!-- Row 2: Amount & Discount Amount -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-bold text-rose-600 mb-1">* {{ prefs.txt('পরিমাণ', 'Amount') }} (TK)</label>
                <div class="relative">
                  <span class="absolute left-2.5 top-2 text-slate-400 font-bold">TK</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    [(ngModel)]="paymentAmount"
                    placeholder="{{ prefs.txt('পরিমাণ লিখুন', 'Enter Amount') }}"
                    class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-teal-900 bg-white focus:border-teal-500 focus:outline-none"
                  />
                </div>
                <div class="text-[10px] text-rose-600 font-bold mt-0.5">
                  {{ prefs.txt('সর্বোচ্চ পরিমাণ', 'Max. Amount') }}: {{ selectedSaleForPayment()?.due | number:'1.2-2' }} TK
                </div>
              </div>

              <div>
                <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('ডিসকাউন্টের পরিমাণ', 'Discount Amount') }}</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  [(ngModel)]="paymentDiscount"
                  placeholder="{{ prefs.txt('যেমন ৫০', 'e.g. 50') }}"
                  class="w-full p-2 border border-slate-300 rounded-lg font-mono font-semibold text-emerald-700 bg-white focus:border-teal-500 focus:outline-none"
                />
              </div>
            </div>

            <!-- Row 3: Notes -->
            <div>
              <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('নোট', 'Notes') }}</label>
              <textarea
                [(ngModel)]="paymentNotes"
                rows="2"
                placeholder="{{ prefs.txt('পেমেন্ট নোট বা মন্তব্য...', 'Payment notes or remarks...') }}"
                class="w-full p-2 border border-slate-300 rounded-lg bg-white focus:border-teal-500 focus:outline-none"
              ></textarea>
            </div>

            <!-- Row 4: Next Payment Date -->
            <div>
              <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('পরবর্তী পেমেন্টের তারিখ', 'Next Payment Date') }}</label>
              <div class="flex items-center gap-2 mb-2">
                <input
                  type="date"
                  appDmyDate
                  [(ngModel)]="nextPaymentDate"
                  class="w-full border border-slate-300 rounded-lg p-2 font-semibold bg-white focus:border-teal-500 focus:outline-none"
                />
              </div>
              <div class="flex items-center gap-1.5 text-[11px]">
                <span class="text-slate-500 font-semibold">{{ prefs.txt('দ্রুত তারিখ', 'Presets') }}:</span>
                <button (click)="setPresetDays(7)" type="button" class="bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold px-2 py-1 rounded border border-teal-200">
                  +7 {{ prefs.txt('দিন', 'Days') }}
                </button>
                <button (click)="setPresetDays(15)" type="button" class="bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold px-2 py-1 rounded border border-teal-200">
                  +15 {{ prefs.txt('দিন', 'Days') }}
                </button>
                <button (click)="setPresetDays(30)" type="button" class="bg-purple-50 hover:bg-purple-100 text-purple-800 font-bold px-2 py-1 rounded border border-purple-200">
                  +1 {{ prefs.txt('মাস', 'Month') }}
                </button>
              </div>
            </div>

          </div>

          <!-- Modal Footer -->
          <div class="bg-slate-50 px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              (click)="closePaymentModal()"
              class="border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold px-4 py-2 rounded-lg transition-colors"
            >
              {{ prefs.txt('বাতিল', 'Cancel') }}
            </button>
            <button
              (click)="submitPayment()"
              class="bg-teal-700 hover:bg-teal-800 text-white font-bold px-5 py-2 rounded-lg flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ করুন', 'Create') }}
            </button>
          </div>

        </div>
      </div>
    }

    <!-- Passcode Modal for locked / confirmed orders -->
    @if (unlockRequest(); as req) {
      <app-passcode-modal
        [title]="prefs.txt('লক করা ইনভয়েস #', 'Locked Invoice #') + req.sale.invoice"
        [message]="prefs.txt('কনফার্ম করা অর্ডার লক করা আছে। ইডিট করার জন্য পাসকোড দিন।', 'This confirmed order is locked. Enter the passcode to edit it.')"
        (verified)="onPasscodeVerified($event)"
        (close)="unlockRequest.set(null)"
      />
    }
  `
})
export class SalesList {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  private readonly router = inject(Router);
  readonly orderLock = inject(OrderLockService);
  readonly prefs = inject(PreferencesService);

  readonly tabs = ['All', 'Overdue', 'Ordered', 'Processing', 'Shipping', 'Confirmed', 'Completed', 'Cancelled'];
  readonly statuses: Sale['status'][] = ['Ordered', 'Confirmed', 'Processing', 'Shipping', 'Completed', 'Cancelled'];
  readonly paymentFilters: ('All' | Sale['paymentStatus'])[] = ['All', 'Paid', 'Partially Paid', 'Unpaid'];
  readonly mobileSortKeys = ['date', 'invoice', 'customer', 'total', 'due'];

  activeTab = signal<string>('All');
  searchQuery = signal<string>('');
  selectedInvoice = signal<Sale | null>(null);
  posInvoiceSale = signal<Sale | null>(null);
  /** Same offline voucher QR as the A4 invoice, sized for the 80mm slip. */
  readonly posInvoiceQr = computed(() => {
    const sale = this.posInvoiceSale();
    const settings = this.dataService.voucherSettings();
    if (!sale || !settings.showPosQrCode) return '';
    if (typeof window === 'undefined') return '';
    if (settings.qrMode === 'text') return qrDataUrl(saleQrText(sale, settings), 240, 'L');
    if (!sale.shareKey) return '';
    return qrDataUrl(`${window.location.origin}/v/sale/${encodeURIComponent(sale.shareKey)}`, 240);
  });
  ledgerParty = signal<Party | null>(null);
  selectedIds = signal<Set<number>>(new Set<number>());
  rowDetails = signal<Sale | null>(null);

  // Column order/width/visibility, sorting and density survive a reload.
  private readonly storedView = loadSavedView();
  tableLayout = signal<ColumnLayout>(loadColumnLayout(COLUMNS_KEY, SALES_COLUMNS));
  showColumnSelector = signal<boolean>(false);
  sortKey = signal<string>(this.storedView.sortKey);
  sortDir = signal<'asc' | 'desc'>(this.storedView.sortDir);
  density = signal<Density>(this.storedView.density);

  showFilters = signal<boolean>(false);
  /** The list opens on today's business, with any window available from the date bar. */
  private readonly initialRange = resolveDateRange('today');
  dateFrom = signal<string>(this.initialRange.from);
  dateTo = signal<string>(this.initialRange.to);
  warehouseFilter = signal<string>('All');
  preparedFilter = signal<string>('All');
  paymentFilter = signal<Sale['paymentStatus'] | 'All'>('All');
  onlyDue = signal<boolean>(false);
  onlyOverdue = signal<boolean>(false);

  selectedCount = computed(() => this.selectedIds().size);

  allSelected = computed(() => {
    const list = this.filteredSales();
    return list.length > 0 && list.every(s => this.selectedIds().has(s.id));
  });

  someSelected = computed(() => {
    const list = this.filteredSales();
    const picked = list.filter(s => this.selectedIds().has(s.id)).length;
    return picked > 0 && picked < list.length;
  });

  totals = computed(() => {
    const list = this.filteredSales();
    const sum = (pick: (s: Sale) => number) => this.round2(list.reduce((acc, s) => acc + (Number(pick(s)) || 0), 0));
    return { total: sum(s => s.total), paid: sum(s => s.paid), due: sum(s => s.due) };
  });

  isSelected(id: number): boolean {
    return this.selectedIds().has(id);
  }

  toggleRow(id: number) {
    const next = new Set(this.selectedIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedIds.set(next);
  }

  toggleAllRows() {
    if (this.allSelected()) {
      this.selectedIds.set(new Set<number>());
      return;
    }
    this.selectedIds.set(new Set(this.filteredSales().map(s => s.id)));
  }

  clearSelection() {
    this.selectedIds.set(new Set<number>());
  }

  exportSelected() {
    const ids = this.selectedIds();
    const list = this.dataService.sales().filter(s => ids.has(s.id));
    if (!list.length) {
      this.notify.warning(this.prefs.txt('কোনো সারি নির্বাচন করা হয়নি।', 'No row has been selected.'), this.prefs.txt('নির্বাচন নেই', 'Nothing selected'));
      return;
    }
    this.dataService.exportToExcel(list, 'Sales_Selected');
  }

  private round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  openCustomerLedger(sale: Sale) {
    const name = (sale.customerName || '').trim();
    if (!name) {
      this.notify.warning(this.prefs.txt('এই ভাউচারে কাস্টমারের নাম নেই।', 'This voucher has no customer name.'), this.prefs.txt('কাস্টমার নেই', 'No customer'));
      return;
    }
    const lower = name.toLowerCase();
    const known = this.dataService.parties().find(p =>
      p.name.toLowerCase() === lower || (p.companyName || '').toLowerCase() === lower);
    const own = this.dataService.sales().filter(s =>
      (s.customerName || '').trim().toLowerCase() === lower && s.status !== 'Cancelled');

    const total = this.round2(own.reduce((acc, s) => acc + (Number(s.total) || 0), 0));
    const paid = this.round2(own.reduce((acc, s) => acc + (Number(s.paid) || 0), 0));
    const due = this.round2(own.reduce((acc, s) => acc + (Number(s.due) || 0), 0));
    const latest = own.slice().sort((a, b) => this.dayNumber(b.date) - this.dayNumber(a.date))[0] || sale;

    this.ledgerParty.set({
      ...(known ?? this.placeholderParty(name)),
      id: known?.id ?? 0,
      name: known?.name || name,
      type: known?.type ?? 'Customer',
      companyName: known?.companyName || latest.shopName || '',
      phone: known?.phone || latest.mobile || '',
      address: known?.address || latest.address || '',
      nextPayment: known?.nextPayment || latest.nextPayDate,
      total,
      paid,
      due
    });
  }

  private placeholderParty(name: string): Party {
    return {
      id: 0,
      name,
      companyName: '',
      type: 'Customer',
      total: 0,
      paid: 0,
      due: 0,
      status: 'Enabled',
      inHand: '-',
      zone: '',
      email: '',
      phone: '',
      address: '',
      createdAt: new Date().toISOString()
    };
  }

  private dayNumber(value?: string): number {
    const text = (value || '').trim();
    const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
    if (dmy) return Number(dmy[3] + dmy[2] + dmy[1]);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return Number(iso[1] + iso[2] + iso[3]);
    const stamp = Date.parse(text);
    return Number.isNaN(stamp) ? 0 : stamp;
  }

  // Voucher Customization Settings Modal State
  isVoucherSettingsOpen = signal<boolean>(false);

  // Action Menu Popup Modal state
  actionMenuSale = signal<Sale | null>(null);

  // Locked-order passcode request
  unlockRequest = signal<{ sale: Sale; action: 'edit' | 'status' | 'delete' } | null>(null);

  // Payment Modal State
  selectedSaleForPayment = signal<Sale | null>(null);
  paymentDate = localDateIso();
  paymentMode = 'Cash';
  paymentAmount = 0;
  paymentDiscount = 0;
  paymentNotes = '';
  nextPaymentDate = '';

  filteredSales = computed(() => {
    let list = this.dataService.sales();
    const tab = this.activeTab();

    if (tab === 'Overdue') {
      list = list.filter(s => this.dueState(s) === 'overdue');
    } else if (tab !== 'All') {
      list = list.filter(s => s.status === tab);
    }

    const from = this.dateFrom();
    const to = this.dateTo();
    if (from || to) {
      list = list.filter(s => {
        const iso = this.toIso(s.date);
        if (!iso) return false;
        return (!from || iso >= from) && (!to || iso <= to);
      });
    }

    if (this.warehouseFilter() !== 'All') {
      list = list.filter(s => (s.warehouse || '') === this.warehouseFilter());
    }
    if (this.preparedFilter() !== 'All') {
      list = list.filter(s => (s.preparedBy || '') === this.preparedFilter());
    }
    if (this.paymentFilter() !== 'All') {
      list = list.filter(s => s.paymentStatus === this.paymentFilter());
    }
    if (this.onlyDue()) {
      list = list.filter(s => this.round2(s.due) > 0);
    }
    if (this.onlyOverdue()) {
      list = list.filter(s => this.dueState(s) === 'overdue');
    }

    const terms = this.searchQuery().toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length) {
      list = list.filter(s => this.matchesSearch(s, terms));
    }

    return list;
  });

  sortedSales = computed(() => {
    const key = this.sortKey();
    if (!SALES_COL_SPECS[key] || key === 'sel' || key === 'sl' || key === 'action') {
      return this.filteredSales();
    }
    const direction = this.sortDir() === 'asc' ? 1 : -1;
    // Same-day invoices share a date, so the id sequence keeps the newest sale
    // of the day on top instead of burying it under the rest of the block.
    return [...this.filteredSales()].sort((a, b) => this.compareSales(a, b, key) * direction || (a.id - b.id) * direction);
  });

  readonly pager = createPager(() => this.sortedSales());

  /** Every page or page-size jump starts reading from the top of the list again. */
  onPageChange(page: number, anchorId: string) {
    this.pager.setPage(page);
    scrollToListTopAfterRender(document.getElementById(anchorId));
  }

  onPageSizeChange(size: number, anchorId: string) {
    this.pager.setPageSize(size);
    scrollToListTopAfterRender(document.getElementById(anchorId));
  }

  /** Angular has no `slash` key alias, so match the literal key instead. */
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (this.rowDetails()) this.closeRowDetails();
      return;
    }
    if (this.rowDetails()) return;
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const el = event.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    event.preventDefault();
    document.getElementById('sales-search')?.focus();
  }

  onStatusChange(sale: Sale, newStatus: Sale['status']) {
    if (this.orderLock.isLocked(sale)) {
      this.requestEditAccess(sale, 'status');
      return;
    }
    this.dataService.updateSaleStatus(sale.id, newStatus);
    if (this.orderLock.isLockable(newStatus)) {
      this.orderLock.lock(sale.id);
    }
  }

  lockSale(sale: Sale) {
    this.orderLock.lock(sale.id);
  }

  requestEditAccess(sale: Sale, action: 'edit' | 'status' | 'delete') {
    if (this.orderLock.isLocked(sale)) {
      this.unlockRequest.set({ sale, action });
      return;
    }
    this.runUnlockedAction(sale, action);
  }

  onPasscodeVerified(code: string) {
    const req = this.unlockRequest();
    if (!req) return;
    if (!this.orderLock.unlock(req.sale.id, code)) return;
    this.unlockRequest.set(null);
    this.runUnlockedAction(req.sale, req.action);
  }

  private runUnlockedAction(sale: Sale, action: 'edit' | 'status' | 'delete') {
    if (action === 'edit') {
      this.router.navigate(['/sales/add'], { queryParams: { edit: sale.id } });
    } else if (action === 'delete') {
      this.confirmDelete(sale);
    }
  }

  private async confirmDelete(sale: Sale) {
    const confirmed = await this.notify.confirm(this.prefs.txt(`ইনভয়েস #${sale.invoice} স্থায়ীভাবে মুছে ফেলা হবে।`, `Invoice #${sale.invoice} will be permanently deleted.`), {
      title: this.prefs.txt('এই ইনভয়েসটি মুছে ফেলবেন?', 'Delete this invoice?'),
      kind: 'error',
      confirmText: this.prefs.txt('মুছুন', 'Delete')
    });
    if (confirmed) {
      this.dataService.deleteSale(sale.id);
      this.orderLock.lock(sale.id);
      this.notify.success(this.prefs.txt(`ইনভয়েস #${sale.invoice} মুছে ফেলা হয়েছে।`, `Invoice #${sale.invoice} deleted.`));
    }
  }

  onSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.searchQuery.set(target.value);
    this.pager.setPage(1);
  }

  openInvoice(s: Sale) {
    this.selectedInvoice.set(s);
  }

  /** POS Invoice: the 80mm slip from the POS page, rebuilt from a saved sale. */
  closePosInvoice() {
    this.posInvoiceSale.set(null);
  }

  saleSubtotal(s: Sale): number {
    return s.subtotal ?? this.itemsTotal(s);
  }

  saleDiscountTotal(s: Sale): number {
    return (Number(s.discount) || 0) + (Number(s.orderDiscount) || 0);
  }

  posBatteryRows(s: Sale): BatteryAdjustmentItem[] {
    return (s.batteryAdjustments ?? []).filter(b => (Number(b.total) || 0) > 0);
  }

  posBatteryTotal(s: Sale): number {
    const explicit = Number(s.batteryAdjustmentTotal) || 0;
    if (explicit > 0) return explicit;
    return this.round2(this.posBatteryRows(s).reduce((acc, b) => acc + (Number(b.total) || 0), 0));
  }

  posReturnRows(s: Sale): SalesReturnItem[] {
    return (s.returns ?? []).filter(r => (Number(r.amount) || 0) > 0);
  }

  posReturnTotal(s: Sale): number {
    return this.round2(this.posReturnRows(s).reduce((acc, r) => acc + (Number(r.amount) || 0), 0));
  }

  posShareText(s: Sale): string {
    const vs = this.dataService.voucherSettings();
    const lines = [
      `${vs.businessNamePart1} ${vs.businessNamePart2}`.trim(),
      `${this.prefs.txt('ইনভয়েস', 'Invoice')}: ${s.invoice}`,
      `${this.prefs.txt('মোট', 'Total')}: ${(s.total ?? 0).toFixed(2)} TK`,
    ];
    const due = s.due ?? 0;
    if (due > 0) lines.push(`${this.prefs.txt('বাকি', 'Due')}: ${due.toFixed(2)} TK`);
    return lines.join('\n');
  }

  printPosInvoice() {
    printPosReceipt(document.getElementById('pos-invoice-print-area'));
  }

  openActionModalForSale(sale: Sale, event: MouseEvent) {
    event.stopPropagation();
    this.actionMenuSale.set(sale);
  }

  closeActionModal() {
    this.actionMenuSale.set(null);
  }

  handleActionOption(option: string) {
    const sale = this.actionMenuSale();
    if (!sale) return;
    this.closeActionModal();

    switch (option) {
      case 'Edit':
        this.requestEditAccess(sale, 'edit');
        break;
      case 'View Payments':
        this.notify.alert(
          `${this.prefs.txt('পরিশোধ', 'Paid')}: ৳ ${sale.paid}\n${this.prefs.txt('বাকি', 'Due')}: ৳ ${sale.due}\n${this.prefs.txt('পেমেন্ট স্ট্যাটাস', 'Payment status')}: ${this.paymentLabel(sale.paymentStatus)}`,
          {
            title: this.prefs.txt('পেমেন্টের বিস্তারিত', 'Payment details') + ` · ${this.prefs.txt('ইনভয়েস', 'Invoice')} #${sale.invoice}`,
            kind: 'info',
            confirmText: this.prefs.txt('বন্ধ করুন', 'Close')
          }
        );
        break;
      case 'Add New Payment':
        this.openPaymentModal(sale);
        break;
      case 'POS Invoice':
        this.posInvoiceSale.set(sale);
        break;
      case 'Download Invoice':
      case 'Print Invoice':
        this.openInvoice(sale);
        break;
      case 'Voucher Settings':
        this.isVoucherSettingsOpen.set(true);
        break;
      case 'Add Expense':
        this.notify.alert(this.prefs.txt(`ইনভয়েস #${sale.invoice}-এর জন্য খরচ এন্ট্রি।`, `Expense entry for invoice #${sale.invoice}.`), {
          title: this.prefs.txt('খরচ যোগ করুন', 'Add expense'),
          kind: 'info',
          confirmText: this.prefs.txt('বন্ধ করুন', 'Close')
        });
        break;
      case 'Delete':
        this.requestEditAccess(sale, 'delete');
        break;
    }
  }

  openPaymentModal(s: Sale) {
    this.selectedSaleForPayment.set(s);
    this.paymentAmount = s.due;
    this.paymentDiscount = 0;
    this.paymentNotes = '';
    this.paymentDate = localDateIso();
    this.nextPaymentDate = '';
  }

  closePaymentModal() {
    this.selectedSaleForPayment.set(null);
  }

  setPresetDays(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    this.nextPaymentDate = localDateIso(d);
  }

  submitPayment() {
    const sale = this.selectedSaleForPayment();
    if (!sale) return;

    const amt = Number(this.paymentAmount) || 0;
    const disc = Number(this.paymentDiscount) || 0;

    if (amt <= 0 && disc <= 0) {
      this.notify.error(this.prefs.txt('দয়া করে পেমেন্টের পরিমাণ অথবা ডিসকাউন্ট লিখুন।', 'Please enter a payment amount or a discount.'), this.prefs.txt('কোনো পরিমাণ নেই', 'No amount'));
      return;
    }

    this.dataService.addPaymentToSale(sale.id, {
      amount: amt,
      discount: disc,
      paymentMode: this.paymentMode,
      notes: this.paymentNotes,
      nextPaymentDate: this.nextPaymentDate,
      paymentDate: this.paymentDate
    });

    this.notify.success(this.prefs.txt(`ভাউচার #${sale.invoice}-এর পেমেন্ট সফলভাবে সম্পন্ন হয়েছে।`, `Payment for voucher #${sale.invoice} was recorded successfully.`));
    this.closePaymentModal();
  }

  exportExcel() {
    this.dataService.exportToExcel(this.filteredSales(), 'Sales_Transactions');
  }

  printPage() {
    if (document.getElementById('printable-area')) {
      window.print();
      return;
    }
    // No voucher open: reveal the list itself for this print run only.
    document.body.classList.add('print-list');
    const cleanup = () => {
      document.body.classList.remove('print-list');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 3000);
  }

  // ---------------------------------------------------------------- column engine

  visibleCols = computed<ResolvedColumn[]>(() => {
    const layout = this.tableLayout();
    return layout.order
      .filter(key => layout.visible[key])
      .map(key => ({ ...SALES_COL_SPECS[key], width: layout.widths[key] }));
  });

  allColumns = computed(() => {
    const layout = this.tableLayout();
    return layout.order.map(key => ({
      key,
      label: SALES_COL_SPECS[key].label,
      width: layout.widths[key],
      visible: !!layout.visible[key]
    }));
  });

  tableWidthPx = computed(() => this.visibleCols().reduce((sum, col) => sum + col.width, 0));

  /** Left offsets for the leading pinned columns; the run ends at the first unpinned one. */
  pinLeft = computed<Record<string, number>>(() => {
    const offsets: Record<string, number> = {};
    let left = 0;
    for (const col of this.visibleCols()) {
      if (!PINNABLE_KEYS.includes(col.key)) break;
      offsets[col.key] = left;
      left += col.width;
    }
    return offsets;
  });

  pinEdge = computed<Record<string, boolean>>(() => {
    const pinned = Object.keys(this.pinLeft());
    const edge: Record<string, boolean> = {};
    pinned.forEach((key, index) => (edge[key] = index === pinned.length - 1));
    return edge;
  });

  colLabel(key: string): string {
    const spec = SALES_COL_SPECS[key];
    const bn = BN_COL_LABELS[key];
    if (!spec || !bn) return spec?.label ?? key;
    return this.prefs.txt(bn, spec.label);
  }

  toggleColumn(key: string) {
    const layout = this.tableLayout();
    const visible = { ...layout.visible, [key]: !layout.visible[key] };
    if (!Object.values(visible).some(v => v)) return;
    this.saveLayout({ ...layout, visible });
  }

  selectAllColumns() {
    const layout = this.tableLayout();
    const visible: Record<string, boolean> = {};
    for (const key of Object.keys(layout.visible)) visible[key] = true;
    this.saveLayout({ ...layout, visible });
  }

  resetColumns() {
    const layout = defaultColumnLayout(SALES_COLUMNS);
    this.tableLayout.set(layout);
    saveColumnLayout(COLUMNS_KEY, layout);
    this.pager.setPage(1);
  }

  private saveLayout(layout: ColumnLayout) {
    this.tableLayout.set(layout);
    saveColumnLayout(COLUMNS_KEY, layout);
  }

  onColumnDrop(event: CdkDragDrop<ResolvedColumn[]>) {
    if (event.previousIndex === event.currentIndex) return;
    const layout = this.tableLayout();
    const visibleKeys = this.visibleCols().map(col => col.key);
    const order = reorderInView<string>(layout.order, visibleKeys, event.previousIndex, event.currentIndex, key => key);
    this.saveLayout({ ...layout, order });
  }

  startColumnResize(event: MouseEvent, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const table = (event.target as HTMLElement).closest('table');
    const colEl = table?.querySelector<HTMLElement>(`col[data-col="${key}"]`);
    const startWidth = this.tableLayout().widths[key] ?? 0;
    const spec = SALES_COL_SPECS[key];

    const widthAt = (clientX: number) => clampLayoutWidth(spec, startWidth + clientX - startX);

    const onMove = (moveEvent: MouseEvent) => {
      if (colEl) colEl.style.width = `${widthAt(moveEvent.clientX)}px`;
    };
    const onUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const width = widthAt(upEvent.clientX);
      if (width !== startWidth) {
        const layout = this.tableLayout();
        this.saveLayout({ ...layout, widths: { ...layout.widths, [key]: width } });
      } else if (colEl) {
        colEl.style.width = `${startWidth}px`;
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ---------------------------------------------------------------------- sorting

  sortable(key: string): boolean {
    return !!SALES_COL_SPECS[key] && key !== 'sel' && key !== 'action';
  }

  sortBy(key: string) {
    if (!this.sortable(key)) return;
    if (this.sortKey() === key) {
      this.sortDir.update(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'date' || key === 'total' || key === 'paid' || key === 'due' || key === 'nextPay' ? 'desc' : 'asc');
    }
    this.persistView();
    this.pager.setPage(1);
  }

  toggleSortDir() {
    this.sortDir.update(d => (d === 'asc' ? 'desc' : 'asc'));
    this.persistView();
  }

  sortIcon(key: string): string {
    if (!this.sortable(key)) return '';
    if (this.sortKey() !== key) return 'unfold_more';
    return this.sortDir() === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  sortHint(key: string): string {
    const label = this.colLabel(key);
    if (!this.sortable(key)) return this.prefs.txt('এই কলামে সাজানো যায় না', 'This column cannot be sorted');
    if (this.sortKey() !== key) return this.prefs.txt(`${label} দিয়ে সাজান`, `Sort by ${label}`);
    return this.prefs.txt(
      `${label} · ${this.sortDir() === 'asc' ? 'উর্ধ্বমুখী' : 'নিম্নমুখী'} — দিক বদলান`,
      `${label} · ${this.sortDir()} — click to flip the direction`
    );
  }

  private compareSales(a: Sale, b: Sale, key: string): number {
    switch (key) {
      case 'sl':
        return a.id - b.id;
      case 'invoice':
        return a.invoice.localeCompare(b.invoice, 'en', { numeric: true });
      case 'date':
        return this.dayNumber(a.date) - this.dayNumber(b.date);
      case 'nextPay':
        return this.dayNumber(a.nextPayDate) - this.dayNumber(b.nextPayDate);
      case 'customer':
        return (a.customerName || '').localeCompare(b.customerName || '', 'bn');
      case 'warehouse':
        return (a.warehouse || '').localeCompare(b.warehouse || '', 'bn');
      case 'preparedBy':
        return (a.preparedBy || '').localeCompare(b.preparedBy || '', 'bn');
      case 'status':
        return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      case 'payment':
        return PAYMENT_ORDER.indexOf(a.paymentStatus) - PAYMENT_ORDER.indexOf(b.paymentStatus);
      case 'notes':
        return (a.notes || '').localeCompare(b.notes || '', 'bn');
      default:
        return (Number(a[key as 'total']) || 0) - (Number(b[key as 'total']) || 0);
    }
  }

  toggleDensity() {
    this.density.update(d => (d === 'cozy' ? 'compact' : 'cozy'));
    this.persistView();
  }

  private persistView() {
    persistSavedView({ sortKey: this.sortKey(), sortDir: this.sortDir(), density: this.density() });
  }

  // ---------------------------------------------------------------------- summaries

  collectionRate(): number {
    const { total, paid } = this.totals();
    if (total <= 0) return 0;
    return Math.min(100, Math.round((paid / total) * 100));
  }

  pageTotals() {
    const list = this.pager.paged();
    const sum = (pick: (s: Sale) => number) => this.round2(list.reduce((acc, s) => acc + (Number(pick(s)) || 0), 0));
    return { total: sum(s => s.total), paid: sum(s => s.paid), due: sum(s => s.due) };
  }

  selectTab(tab: string) {
    this.activeTab.set(tab);
    this.pager.setPage(1);
  }

  tabCount(tab: string): number {
    const list = this.dataService.sales();
    if (tab === 'All') return list.length;
    if (tab === 'Overdue') return list.filter(s => this.dueState(s) === 'overdue').length;
    return list.filter(s => s.status === tab).length;
  }

  tabLabel(tab: string): string {
    const map: Record<string, [string, string]> = {
      All: ['সব বিক্রয়', 'All sales'],
      Overdue: ['ওভারডিউ', 'Overdue'],
      Ordered: ['অর্ডারড', 'Ordered'],
      Processing: ['প্রসেসিং', 'Processing'],
      Shipping: ['শিপিং', 'Shipping'],
      Confirmed: ['কনফার্মড', 'Confirmed'],
      Completed: ['কমপ্লিটেড', 'Completed'],
      Cancelled: ['বাতিল', 'Cancelled']
    };
    const pair = map[tab];
    return pair ? this.prefs.txt(pair[0], pair[1]) : tab;
  }

  tabDot(tab: string): string {
    const map: Record<string, string> = {
      All: 'bg-slate-500',
      Overdue: 'bg-rose-500',
      Ordered: 'bg-slate-400',
      Processing: 'bg-violet-500',
      Shipping: 'bg-sky-500',
      Confirmed: 'bg-teal-500',
      Completed: 'bg-emerald-500',
      Cancelled: 'bg-rose-400'
    };
    return map[tab] ?? 'bg-slate-400';
  }

  // ------------------------------------------------------------------------ badges

  statusClass(status: Sale['status']): string {
    const map: Record<Sale['status'], string> = {
      Completed: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
      Confirmed: 'border border-teal-200 bg-teal-50 text-teal-700',
      Shipping: 'border border-sky-200 bg-sky-50 text-sky-700',
      Processing: 'border border-violet-200 bg-violet-50 text-violet-700',
      Ordered: 'border border-slate-200 bg-slate-50 text-slate-700',
      Cancelled: 'border border-rose-200 bg-rose-50 text-rose-700'
    };
    return map[status] ?? 'border border-slate-200 bg-slate-50 text-slate-700';
  }

  paymentClass(status: Sale['paymentStatus']): string {
    if (status === 'Paid') return 'bg-emerald-50 text-emerald-700';
    if (status === 'Partially Paid') return 'bg-amber-50 text-amber-700';
    return 'bg-rose-50 text-rose-700';
  }

  paymentLabel(value: 'All' | Sale['paymentStatus']): string {
    if (value === 'All') return this.prefs.txt('সব', 'All');
    if (value === 'Paid') return this.prefs.txt('পরিশোধিত', 'Paid');
    if (value === 'Partially Paid') return this.prefs.txt('আংশিক', 'Partial');
    return this.prefs.txt('বাকি', 'Unpaid');
  }

  pctPaid(s: Sale): number {
    const total = Number(s.total) || 0;
    const paid = Number(s.paid) || 0;
    if (total <= 0) return this.round2(Number(s.due) || 0) > 0 ? 0 : 100;
    return Math.max(0, Math.min(100, Math.round((paid / total) * 100)));
  }

  // --------------------------------------------------------------------- due states

  dueState(s: Sale): 'overdue' | 'soon' | 'later' | 'none' {
    if (this.round2(s.due) <= 0) return 'none';
    const diff = this.dayDiff(s.nextPayDate);
    if (diff === null) return 'none';
    if (diff < 0) return 'overdue';
    if (diff <= 7) return 'soon';
    return 'later';
  }

  overdueDays(s: Sale): number {
    return Math.abs(this.dayDiff(s.nextPayDate) ?? 0);
  }

  /** Days from local midnight to the given date; negative when it already passed. */
  private dayDiff(value?: string): number | null {
    const date = this.parseDate(value);
    if (!date) return null;
    const now = new Date();
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((target - today) / 86400000);
  }

  relativeDay(value?: string): string {
    const diff = this.dayDiff(value);
    if (diff === null) return this.prefs.txt('তারিখ নেই', 'no date');
    if (diff === 0) return this.prefs.txt('আজ', 'today');
    if (diff === -1) return this.prefs.txt('গতকাল', 'yesterday');
    if (diff === 1) return this.prefs.txt('আগামীকাল', 'tomorrow');
    return diff < 0
      ? this.prefs.txt(`${-diff} দিন আগে`, `${-diff} d ago`)
      : this.prefs.txt(`${diff} দিন পরে`, `in ${diff} d`);
  }

  itemName(item: SaleItem): string {
    return saleItemDisplayName(item, this.dataService.products());
  }

  dayTone(value?: string): string {
    const diff = this.dayDiff(value);
    if (diff === null) return 'text-slate-400';
    if (diff === 0) return 'text-emerald-600';
    if (diff < 0) return 'text-slate-400';
    return 'text-sky-600';
  }

  // --------------------------------------------------------------------- formatting

  private parseDate(value?: string): Date | null {
    const text = (value || '').trim();
    if (!text || text === '-') return null;
    const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text);
    if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const stamp = Date.parse(text);
    return Number.isNaN(stamp) ? null : new Date(stamp);
  }

  toIso(value?: string): string {
    const date = this.parseDate(value);
    return date ? localDateIso(date) : '';
  }

  displayDate(value?: string): string {
    const raw = (value || '').trim();
    if (!raw || raw === '-') return '—';
    const date = this.parseDate(raw);
    if (!date) return raw;
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${date.getFullYear()}`;
  }

  shortDate(value?: string): string {
    const date = this.parseDate(value);
    if (!date) return '—';
    const months =
      this.prefs.language() === 'en'
        ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        : ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগ', 'সেপ্ট', 'অক্টো', 'নভে', 'ডিসে'];
    return `${date.getDate()} ${months[date.getMonth()]}`;
  }

  money(value: number): string {
    return (Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  clean(value?: string | null): string {
    const text = (value || '').trim();
    return !text || text === '-' ? '—' : text;
  }

  initials(name?: string): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    const first = Array.from(parts[0])[0] ?? '';
    const second = parts.length > 1 ? Array.from(parts[1])[0] ?? '' : '';
    return (first + second).toUpperCase();
  }

  contactLine(s: Sale): string {
    return [s.shopName, s.mobile].map(v => (v || '').trim()).filter(Boolean).join(' · ');
  }

  itemCount(s: Sale): number {
    return (s.items || []).length;
  }

  /** A voucher carries a real warranty claim (status alone is not enough). */
  hasWarranty(s: Sale): boolean {
    const w = s.warranty;
    if (!w) return false;
    return [w.claimNo, w.originalInvoice, w.battery, w.oldSerial, w.newSerial]
      .some(v => String(v ?? '').trim() !== '');
  }

  private itemsTotal(s: Sale): number {
    return this.round2((s.items || []).reduce((acc, it) => acc + (Number(it.total) || 0), 0));
  }

  moneyMetrics(s: Sale): { label: string; value: string; tone: string }[] {
    const rows: { label: string; value: string; tone: string }[] = [];
    const add = (bn: string, en: string, value: number | undefined, tone = 'text-slate-800') => {
      const numeric = Number(value) || 0;
      if (Math.abs(numeric) < 0.005) return;
      rows.push({ label: this.prefs.txt(bn, en), value: this.money(numeric), tone });
    };
    add('সাবটোটাল', 'Subtotal', s.subtotal ?? this.itemsTotal(s));
    add('ডিসকাউন্ট', 'Discount', (s.discount ?? 0) + (s.orderDiscount ?? 0), 'text-amber-700');
    add('শিপিং', 'Shipping', s.shipping, 'text-sky-700');
    add('নগদ', 'Cash', s.cashReceived, 'text-emerald-700');
    add('ব্যাংক', 'Bank', s.bankPayment, 'text-emerald-700');
    add('আগের বাকি', 'Previous due', s.previousDue, 'text-rose-700');
    add(
      'ফেরত',
      'Returns',
      (s.returns || []).reduce((acc, r) => acc + (Number(r.amount) || 0), 0),
      'text-rose-700'
    );
    return rows;
  }

  // ------------------------------------------------------------------- search & filters

  private haystack(s: Sale): string {
    return [
      s.invoice,
      s.customerName,
      s.shopName,
      s.mobile,
      s.notes,
      s.preparedBy,
      s.warehouse,
      s.status,
      s.paymentStatus,
      s.date,
      this.displayDate(s.date),
      (s.items || []).map(it => it.productName).join(' ')
    ]
      .map(value => (value || '').toString().toLowerCase())
      .join(' ');
  }

  private matchesSearch(s: Sale, terms: string[]): boolean {
    const hay = this.haystack(s);
    return terms.every(term => hay.includes(term));
  }

  warehouseOptions = computed(() => this.uniqueValues(this.dataService.sales().map(s => s.warehouse)));

  preparedOptions = computed(() => this.uniqueValues(this.dataService.sales().map(s => s.preparedBy)));

  private uniqueValues(values: (string | undefined)[]): string[] {
    const seen = new Set<string>();
    for (const value of values) {
      const text = (value || '').trim();
      if (text && text !== '-') seen.add(text);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b, 'bn'));
  }

  onRangeChange(range: DateRange) {
    this.dateFrom.set(range.from);
    this.dateTo.set(range.to);
    this.pager.setPage(1);
  }

  activeFilterCount(): number {
    let count = 0;
    if (this.warehouseFilter() !== 'All') count++;
    if (this.preparedFilter() !== 'All') count++;
    if (this.paymentFilter() !== 'All') count++;
    if (this.onlyDue()) count++;
    if (this.onlyOverdue()) count++;
    return count;
  }

  filterChips(): { key: string; label: string }[] {
    const chips: { key: string; label: string }[] = [];
    if (this.warehouseFilter() !== 'All') {
      chips.push({ key: 'warehouse', label: `${this.prefs.txt('ওয়্যারহাউস', 'Warehouse')}: ${this.warehouseFilter()}` });
    }
    if (this.preparedFilter() !== 'All') {
      chips.push({ key: 'prepared', label: `${this.prefs.txt('প্রস্তুতকারী', 'Prepared by')}: ${this.preparedFilter()}` });
    }
    if (this.paymentFilter() !== 'All') {
      chips.push({ key: 'payment', label: `${this.prefs.txt('পেমেন্ট', 'Payment')}: ${this.paymentLabel(this.paymentFilter())}` });
    }
    if (this.onlyDue()) {
      chips.push({ key: 'due', label: this.prefs.txt('শুধু বাকিসহ', 'Only with due') });
    }
    if (this.onlyOverdue()) {
      chips.push({ key: 'overdue', label: this.prefs.txt('কিস্তি অতিক্রান্ত', 'Instalment overdue') });
    }
    return chips;
  }

  clearChip(key: string) {
    switch (key) {
      case 'warehouse':
        this.warehouseFilter.set('All');
        break;
      case 'prepared':
        this.preparedFilter.set('All');
        break;
      case 'payment':
        this.paymentFilter.set('All');
        break;
      case 'due':
        this.onlyDue.set(false);
        break;
      case 'overdue':
        this.onlyOverdue.set(false);
        break;
    }
    this.pager.setPage(1);
  }

  clearAllFilters() {
    this.activeTab.set('All');
    this.searchQuery.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.warehouseFilter.set('All');
    this.preparedFilter.set('All');
    this.paymentFilter.set('All');
    this.onlyDue.set(false);
    this.onlyOverdue.set(false);
    this.pager.setPage(1);
  }

  clearSearch() {
    this.searchQuery.set('');
    this.pager.setPage(1);
  }

  // -------------------------------------------------------------------- row details

  openRowDetails(sale: Sale) {
    this.rowDetails.set(sale);
  }

  closeRowDetails() {
    this.rowDetails.set(null);
  }
}
