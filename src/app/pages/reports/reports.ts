import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { downloadWorkbook } from '../../utils/spreadsheet';
import { DataService, Sale, SalesReturn } from '../../services/data';
import {
  categoryProfitRows, productProfitRows, returnedItemsOf, soldItemsOf, ProductProfitRow, SoldItem
} from '../../utils/report-analytics';
import { productStockValuation } from '../../utils/stock-valuation';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { DmyDateDirective } from '../../directives/dmy-date.directive';
import {
  DATE_RANGE_PRESETS, DateRangeKind, resolveDateRange, toIsoDate
} from '../../utils/date-range';

type ReportTab = 'money' | 'overview' | 'products' | 'categories' | 'stock';
type FlowGranularity = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface FlowRow {
  key: string;
  label: string;
  sales: number;
  purchases: number;
  batteryPurchase: number;
  batterySale: number;
  net: number;
}

@Component({
  selector: 'app-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, DmyDateDirective],
  template: `
    @if (!session.canSee('reports')) {
      <div class="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
        <mat-icon class="text-4xl text-slate-300 block mb-2">lock</mat-icon>
        {{ prefs.t('settings.onlyAdmin') }}
      </div>
    } @else {
      <div class="space-y-4 text-xs text-slate-800">
        <!-- Header -->
        <div class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
          <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
          <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
          <div class="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                <mat-icon class="text-xl">bar_chart</mat-icon>
              </span>
              <div class="min-w-0">
                <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                  <span>{{ prefs.txt('হিসাব', 'Accounts') }}</span>
                  <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                  <span>{{ prefs.txt('রিপোর্ট', 'Reports') }}</span>
                </p>
                <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.t('reports.title') }}</h1>
                <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('লাভ-ক্ষতি, ক্যাশ ফ্লো, পণ্য ও স্টক মূল্যের বিশ্লেষণ।', 'Profit & loss, cash flow, product and stock value analysis.') }}</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <label class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-[10px] font-bold backdrop-blur-sm">
                {{ prefs.t('reports.from') }}
                <input type="date" appDmyDate [ngModel]="fromDate()" (ngModelChange)="setFromDate($event)"
                  class="bg-transparent text-[11px] font-bold text-white outline-none [color-scheme:dark]" />
              </label>
              <label class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-[10px] font-bold backdrop-blur-sm">
                {{ prefs.t('reports.to') }}
                <input type="date" appDmyDate [ngModel]="toDate()" (ngModelChange)="setToDate($event)"
                  class="bg-transparent text-[11px] font-bold text-white outline-none [color-scheme:dark]" />
              </label>
              <button (click)="exportWorkbook()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
                <mat-icon class="text-sm text-emerald-200">description</mat-icon> {{ prefs.t('common.excel') }}
              </button>
              <button (click)="printReport()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
                <mat-icon class="text-sm">print</mat-icon> {{ prefs.t('common.print') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Tabs -->
        <div class="bg-white p-2 rounded-xl shadow-xs border border-slate-200 flex items-center gap-1.5 overflow-x-auto">
          <button (click)="setTab('money')" [class]="tab() === 'money' ? activeTabClass : idleTabClass">
            <mat-icon class="text-sm align-middle mr-1">swap_vert</mat-icon>{{ prefs.txt('আয়-ব্যয়', 'Money Flow') }}
          </button>
          <button (click)="setTab('overview')" [class]="tab() === 'overview' ? activeTabClass : idleTabClass">{{ prefs.t('reports.profitLoss') }}</button>
          <button (click)="setTab('products')" [class]="tab() === 'products' ? activeTabClass : idleTabClass">{{ prefs.t('reports.productProfit') }}</button>
          <button (click)="setTab('categories')" [class]="tab() === 'categories' ? activeTabClass : idleTabClass">{{ prefs.t('reports.categoryProfit') }}</button>
          <button (click)="setTab('stock')" [class]="tab() === 'stock' ? activeTabClass : idleTabClass">{{ prefs.t('reports.stockValue') }}</button>
        </div>

        <div id="printable-area" class="space-y-4">
          <div class="hidden print:block text-center">
            <p class="font-black text-base">{{ settings().businessNamePart1 }} {{ settings().businessNamePart2 }}</p>
            <p class="text-[11px]">{{ settings().address }} • {{ settings().mobile }}</p>
            <p class="font-bold text-xs mt-1">{{ reportTitle() }}</p>
            <p class="text-[10px]">{{ displayRange() }}</p>
          </div>

          <!-- Money flow (sales / purchases + battery, daily → yearly) -->
          @if (tab() === 'money') {
            <div class="no-print bg-white rounded-xl border border-slate-200 shadow-xs p-2.5 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
              <div class="flex items-center gap-1.5 overflow-x-auto">
                @for (preset of rangePresets; track preset.kind) {
                  <button (click)="pickRange(preset.kind)"
                    [class]="rangeKind() === preset.kind ? activeTabClass : idleTabClass">
                    {{ prefs.txt(preset.bn, preset.en) }}
                  </button>
                }
              </div>
              <div class="flex items-center gap-1.5 overflow-x-auto">
                <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">{{ prefs.txt('হিসাবের ভিত্তি', 'Group by') }}</span>
                @for (g of granularities; track g.key) {
                  <button (click)="setGranularity(g.key)"
                    [class]="granularity() === g.key ? 'bg-slate-800 text-white px-2.5 py-1 rounded-lg font-bold whitespace-nowrap' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 px-2.5 py-1 rounded-lg font-semibold whitespace-nowrap'">
                    {{ prefs.txt(g.bn, g.en) }}
                  </button>
                }
              </div>
            </div>

            <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              <div class="bg-white border border-emerald-200 rounded-xl p-3.5 shadow-2xs">
                <div class="flex items-center justify-between gap-1">
                  <p class="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{{ prefs.txt('বিক্রয় থেকে আয়', 'Sales Income') }}</p>
                  <mat-icon class="text-emerald-500 text-sm">trending_up</mat-icon>
                </div>
                <p class="text-lg font-black font-mono text-emerald-700 mt-1">{{ moneyTotals().sales | number:'1.2-2' }}</p>
                <p class="text-[9.5px] text-slate-400">{{ salesInRange().length }} {{ prefs.txt('ভাউচার', 'vouchers') }}</p>
              </div>
              <div class="bg-white border border-rose-200 rounded-xl p-3.5 shadow-2xs">
                <div class="flex items-center justify-between gap-1">
                  <p class="text-[10px] font-bold uppercase tracking-wide text-rose-700">{{ prefs.txt('ক্রয় থেকে ব্যয়', 'Purchase Expense') }}</p>
                  <mat-icon class="text-rose-500 text-sm">trending_down</mat-icon>
                </div>
                <p class="text-lg font-black font-mono text-rose-600 mt-1">{{ moneyTotals().purchases | number:'1.2-2' }}</p>
                <p class="text-[9.5px] text-slate-400">{{ purchasesInRange().length }} {{ prefs.txt('ভাউচার', 'vouchers') }}</p>
              </div>
              <div class="bg-white border border-amber-200 rounded-xl p-3.5 shadow-2xs">
                <div class="flex items-center justify-between gap-1">
                  <p class="text-[10px] font-bold uppercase tracking-wide text-amber-700">{{ prefs.txt('ব্যাটারি ক্রয় ব্যয়', 'Battery Purchase') }}</p>
                  <mat-icon class="text-amber-500 text-sm">battery_charging_full</mat-icon>
                </div>
                <p class="text-lg font-black font-mono text-amber-700 mt-1">{{ moneyTotals().batteryPurchase | number:'1.2-2' }}</p>
                <p class="text-[9.5px] text-slate-400">{{ moneyTotals().batteryPurchaseCount }} {{ prefs.txt('ভাউচার', 'vouchers') }}</p>
              </div>
              <div class="bg-white border border-teal-200 rounded-xl p-3.5 shadow-2xs">
                <div class="flex items-center justify-between gap-1">
                  <p class="text-[10px] font-bold uppercase tracking-wide text-teal-700">{{ prefs.txt('ব্যাটারি বিক্রয় আয়', 'Battery Sales') }}</p>
                  <mat-icon class="text-teal-500 text-sm">battery_5_bar</mat-icon>
                </div>
                <p class="text-lg font-black font-mono text-teal-700 mt-1">{{ moneyTotals().batterySale | number:'1.2-2' }}</p>
                <p class="text-[9.5px] text-slate-400">{{ moneyTotals().batterySaleCount }} {{ prefs.txt('ভাউচার', 'vouchers') }}</p>
              </div>
              <div class="col-span-2 lg:col-span-1 rounded-xl p-3.5 shadow-2xs border"
                [class]="moneyTotals().net >= 0 ? 'bg-teal-50/70 border-teal-200' : 'bg-rose-50/70 border-rose-200'">
                <div class="flex items-center justify-between gap-1">
                  <p class="text-[10px] font-bold uppercase tracking-wide" [class]="moneyTotals().net >= 0 ? 'text-teal-700' : 'text-rose-700'">{{ prefs.txt('নিট ক্যাশফ্লো', 'Net Cash Flow') }}</p>
                  <mat-icon class="text-sm" [class]="moneyTotals().net >= 0 ? 'text-teal-500' : 'text-rose-500'">account_balance</mat-icon>
                </div>
                <p class="text-lg font-black font-mono mt-1" [class]="moneyTotals().net >= 0 ? 'text-teal-800' : 'text-rose-700'">{{ moneyTotals().net | number:'1.2-2' }}</p>
                <p class="text-[9.5px] text-slate-500">{{ prefs.txt('আয় − ব্যয়', 'In − Out') }}</p>
              </div>
            </div>

            <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div class="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="font-bold text-slate-800">{{ prefs.txt('আয়-ব্যয়ের ধারা', 'Money Flow Trend') }}</h2>
                  <p class="text-[10px] text-slate-500">{{ displayRange() }} — {{ granularityLabel() }}</p>
                </div>
                <span class="text-[10px] font-bold text-slate-400">{{ moneyRows().length }} {{ prefs.txt('টি পিরিয়ড', 'periods') }}</span>
              </div>

              <div class="overflow-x-auto">
                <table class="w-full min-w-[860px] text-left border-collapse">
                  <thead>
                    <tr class="bg-slate-50/80 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      <th class="px-3 py-2.5 border-b border-slate-200">{{ prefs.txt('সময়', 'PERIOD') }}</th>
                      <th class="px-3 py-2.5 border-b border-slate-200 text-right text-emerald-700">{{ prefs.txt('বিক্রয় আয়', 'SALES IN') }}</th>
                      <th class="px-3 py-2.5 border-b border-slate-200 text-right text-rose-600">{{ prefs.txt('ক্রয় ব্যয়', 'PURCHASE OUT') }}</th>
                      <th class="px-3 py-2.5 border-b border-slate-200 text-right text-amber-700">{{ prefs.txt('ব্যাটারি ক্রয়', 'BATTERY BUY') }}</th>
                      <th class="px-3 py-2.5 border-b border-slate-200 text-right text-teal-700">{{ prefs.txt('ব্যাটারি বিক্রয়', 'BATTERY SALE') }}</th>
                      <th class="px-3 py-2.5 border-b border-slate-200 text-right">{{ prefs.txt('নিট', 'NET') }}</th>
                      <th class="px-3 py-2.5 border-b border-slate-200 w-40">{{ prefs.txt('তুলনা', 'COMPARE') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (row of moneyRows(); track row.key) {
                      <tr class="even:bg-slate-100/60 hover:bg-teal-50/40 transition-colors">
                        <td class="px-3 py-2 font-bold text-slate-800 whitespace-nowrap">{{ row.label }}</td>
                        <td class="px-3 py-2 text-right font-mono font-semibold text-emerald-700">{{ row.sales | number:'1.2-2' }}</td>
                        <td class="px-3 py-2 text-right font-mono font-semibold text-rose-600">{{ row.purchases | number:'1.2-2' }}</td>
                        <td class="px-3 py-2 text-right font-mono text-amber-700">{{ row.batteryPurchase | number:'1.2-2' }}</td>
                        <td class="px-3 py-2 text-right font-mono text-teal-700">{{ row.batterySale | number:'1.2-2' }}</td>
                        <td class="px-3 py-2 text-right font-mono font-black" [class.text-emerald-700]="row.net >= 0" [class.text-rose-600]="row.net < 0">{{ row.net | number:'1.2-2' }}</td>
                        <td class="px-3 py-2">
                          <div class="space-y-1">
                            <div class="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div class="h-full rounded-full bg-emerald-500" [style.width.%]="barWidth(row.sales + row.batterySale)"></div>
                            </div>
                            <div class="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div class="h-full rounded-full bg-rose-500" [style.width.%]="barWidth(row.purchases + row.batteryPurchase)"></div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="7" class="px-3 py-10 text-center text-slate-400">
                          <mat-icon class="text-3xl text-slate-300 block mb-1">insights</mat-icon>
                          {{ prefs.txt('এই সময়ে কোনো বিক্রয় বা ক্রয় নেই।', 'No sales or purchases in this period.') }}
                        </td>
                      </tr>
                    }
                  </tbody>
                  <tfoot>
                    <tr class="bg-teal-50/70 border-t-2 border-teal-200 font-black text-slate-800">
                      <td class="px-3 py-2.5">{{ prefs.txt('সর্বমোট', 'TOTAL') }}</td>
                      <td class="px-3 py-2.5 text-right font-mono text-emerald-700">{{ moneyTotals().sales | number:'1.2-2' }}</td>
                      <td class="px-3 py-2.5 text-right font-mono text-rose-600">{{ moneyTotals().purchases | number:'1.2-2' }}</td>
                      <td class="px-3 py-2.5 text-right font-mono text-amber-700">{{ moneyTotals().batteryPurchase | number:'1.2-2' }}</td>
                      <td class="px-3 py-2.5 text-right font-mono text-teal-700">{{ moneyTotals().batterySale | number:'1.2-2' }}</td>
                      <td class="px-3 py-2.5 text-right font-mono" [class.text-emerald-700]="moneyTotals().net >= 0" [class.text-rose-600]="moneyTotals().net < 0">{{ moneyTotals().net | number:'1.2-2' }}</td>
                      <td class="px-3 py-2.5"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <p class="text-[10px] text-slate-400">
              {{ prefs.txt('বিক্রয় আয় = বিক্রয় ভাউচারের সর্বমোট − পোস্টেড ক্রেডিট নোট; ক্রয় ব্যয় = ক্রয় ভাউচারের সর্বমোট; ব্যাটারি ক্রয় = ম্যানুয়াল ব্যাটারি ক্রয় ভাউচার (বিক্রয় বিলের সাথে সমন্বিত পুরাতন ব্যাটারি বাদ); ব্যাটারি বিক্রয় = ব্যাটারি বিক্রয় ও বদল ফি।', 'Sales income = sales voucher totals minus posted credit notes; purchase expense = purchase voucher totals; battery purchase = manual battery purchase vouchers (trade-ins settled inside a sale invoice are excluded); battery sales = battery sale vouchers plus exchange fees.') }}
            </p>
          }

          <!-- Overview -->
          @if (tab() === 'overview') {
            <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              @for (card of summaryCards(); track card.label) {
                <div class="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <p class="text-slate-500 font-semibold">{{ card.label }}</p>
                  <p class="text-lg font-black font-mono mt-1" [class]="card.color">{{ card.value | number:'1.2-2' }} TK</p>
                </div>
              }
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div class="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                <div class="bg-slate-50 px-4 py-2.5 border-b border-slate-200 font-bold">{{ prefs.t('reports.profitLoss') }}</div>
                <div class="p-4 space-y-1.5 font-mono">
                  <div class="flex justify-between"><span>{{ prefs.t('reports.sales') }}</span><span>{{ totals().sales | number:'1.2-2' }}</span></div>
                  <div class="flex justify-between"><span>{{ prefs.t('reports.cogs') }}</span><span>{{ totals().cogs | number:'1.2-2' }}</span></div>
                  <div class="flex justify-between border-t border-slate-200 pt-1.5 font-black text-teal-800"><span>{{ prefs.t('reports.gross') }}</span><span>{{ totals().gross | number:'1.2-2' }}</span></div>
                  <div class="flex justify-between"><span>{{ prefs.t('reports.expenses') }}</span><span>{{ totals().expenses | number:'1.2-2' }}</span></div>
                  <div class="flex justify-between border-t border-slate-200 pt-1.5 font-black text-lg" [class.text-emerald-700]="totals().net >= 0" [class.text-rose-600]="totals().net < 0">
                    <span>{{ prefs.t('reports.net') }}</span><span>{{ totals().net | number:'1.2-2' }}</span>
                  </div>
                </div>
              </div>

              <div class="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                <div class="bg-slate-50 px-4 py-2.5 border-b border-slate-200 font-bold">{{ prefs.t('cash.title') }}</div>
                <div class="p-4 space-y-1.5 font-mono">
                  <div class="flex justify-between"><span>{{ prefs.t('cash.cashSales') }}</span><span>{{ totals().cashCollected | number:'1.2-2' }}</span></div>
                  <div class="flex justify-between"><span>{{ prefs.t('cash.bankSales') }}</span><span>{{ totals().bankCollected | number:'1.2-2' }}</span></div>
                  <div class="flex justify-between"><span>{{ prefs.t('common.due') }}</span><span class="text-rose-600">{{ totals().due | number:'1.2-2' }}</span></div>
                  <div class="flex justify-between border-t border-slate-200 pt-1.5"><span>{{ prefs.t('ledger.payments') }} ({{ paymentsInRange().length }})</span><span>{{ totals().payments | number:'1.2-2' }}</span></div>
                  <div class="flex justify-between"><span>{{ prefs.t('reports.qtySold') }}</span><span>{{ totals().qty | number:'1.0-2' }}</span></div>
                  <div class="flex justify-between"><span>{{ prefs.t('common.total') }} {{ prefs.t('ledger.invoice') }}</span><span>{{ salesInRange().length }}</span></div>
                </div>
              </div>
            </div>

            <p class="text-[10px] text-slate-400">
              {{ prefs.txt(costKnownCount() + ' / ' + itemRows().length + ' বিক্রীত আইটেমের ক্রয়মূল্য পণ্য মাস্টার থেকে মিলেছে (ভ্যারিয়েন্ট হলে ভ্যারিয়েন্টের নিজস্ব ক্রয়মূল্য)।', costKnownCount() + ' / ' + itemRows().length + ' sold items had a purchase cost matched from the product master (a variant uses its own cost).') }}
              {{ prefs.txt('বাকিগুলোর ক্রয়মূল্য ০ ধরা হয়েছে। পণ্যভিত্তিক আয় = লাইন মোট − অর্ডার ছাড়ের আনুপাতিক অংশ; ফ্রেইট/ডেলিভারি চার্জ পণ্যের আয়ের বাইরে।', 'The rest were costed at 0. Product revenue = line total minus its share of the order discount; freight/delivery charges are outside product revenue.') }}
              {{ prefs.txt('পোস্টেড ক্রেডিট নোট আয় থেকে বাদ; রিস্টক থাকলে ওই পণ্যের খরচও ফেরত, নাহলে খরচ থেকে যায় (লোকসান)। খরচ = দৈনিক খরচ + বেতন + পরিশোধিত দোকান ভাড়া।', 'Posted credit notes reduce sales; restocked goods give their cost back, damaged returns keep it (shown as loss). Expenses = daily expenses + salary + paid shop rent.') }}
            </p>
          }

          <!-- Product profit -->
          @if (tab() === 'products') {
            <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div class="overflow-x-auto">
                <table class="w-full min-w-[780px] text-left border-collapse">
                  <thead>
                    <tr class="bg-teal-700 text-white uppercase text-[10px] font-bold">
                      <th class="p-2.5 text-center w-10">SL</th>
                      <th class="p-2.5">{{ prefs.t('common.name') }}</th>
                      <th class="p-2.5">{{ prefs.t('nav.categories') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.qtySold') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.revenue') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.cost') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.profit') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.margin') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (row of productsPager.paged(); track row.key; let idx = $index) {
                      <tr class="hover:bg-teal-50/40">
                        <td class="p-2.5 text-center text-slate-400">{{ productsPager.offset() + idx + 1 }}</td>
                        <td class="p-2.5 font-semibold text-slate-800">{{ row.name }}</td>
                        <td class="p-2.5 text-slate-500">{{ row.category }}</td>
                        <td class="p-2.5 text-right font-mono">{{ row.qty | number:'1.0-2' }}</td>
                        <td class="p-2.5 text-right font-mono">{{ row.revenue | number:'1.2-2' }}</td>
                        <td class="p-2.5 text-right font-mono">
                          {{ row.cost | number:'1.2-2' }}
                          @if (!row.costKnown) { <span class="text-rose-500" [title]="prefs.txt('ক্রয়মূল্য পাওয়া যায়নি', 'Purchase cost not found')">*</span> }
                        </td>
                        <td class="p-2.5 text-right font-mono font-bold" [class.text-emerald-700]="row.profit >= 0" [class.text-rose-600]="row.profit < 0">{{ row.profit | number:'1.2-2' }}</td>
                        <td class="p-2.5 text-right font-mono">{{ row.margin | number:'1.1-1' }}%</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="8" class="p-8 text-center text-slate-400">{{ prefs.t('common.noData') }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>

              <app-table-pagination
                [total]="productsPager.total()"
                [page]="productsPager.currentPage()"
                [pageSize]="productsPager.pageSize()"
                (pageChange)="productsPager.setPage($event)"
                (pageSizeChange)="productsPager.setPageSize($event)"
              />
            </div>
          }

          <!-- Category profit -->
          @if (tab() === 'categories') {
            <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div class="overflow-x-auto">
                <table class="w-full min-w-[640px] text-left border-collapse">
                  <thead>
                    <tr class="bg-teal-700 text-white uppercase text-[10px] font-bold">
                      <th class="p-2.5 text-center w-10">SL</th>
                      <th class="p-2.5">{{ prefs.t('nav.categories') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.qtySold') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.revenue') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.cost') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.profit') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.margin') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (row of categoriesPager.paged(); track row.key; let idx = $index) {
                      <tr class="hover:bg-teal-50/40">
                        <td class="p-2.5 text-center text-slate-400">{{ categoriesPager.offset() + idx + 1 }}</td>
                        <td class="p-2.5 font-semibold text-slate-800">{{ row.name }}</td>
                        <td class="p-2.5 text-right font-mono">{{ row.qty | number:'1.0-2' }}</td>
                        <td class="p-2.5 text-right font-mono">{{ row.revenue | number:'1.2-2' }}</td>
                        <td class="p-2.5 text-right font-mono">{{ row.cost | number:'1.2-2' }}</td>
                        <td class="p-2.5 text-right font-mono font-bold" [class.text-emerald-700]="row.profit >= 0" [class.text-rose-600]="row.profit < 0">{{ row.profit | number:'1.2-2' }}</td>
                        <td class="p-2.5 text-right font-mono">{{ row.margin | number:'1.1-1' }}%</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="7" class="p-8 text-center text-slate-400">{{ prefs.t('common.noData') }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>

              <app-table-pagination
                [total]="categoriesPager.total()"
                [page]="categoriesPager.currentPage()"
                [pageSize]="categoriesPager.pageSize()"
                (pageChange)="categoriesPager.setPage($event)"
                (pageSizeChange)="categoriesPager.setPageSize($event)"
              />
            </div>
          }

          <!-- Stock valuation -->
          @if (tab() === 'stock') {
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                <p class="text-slate-500 font-semibold">{{ prefs.t('reports.stockCost') }}</p>
                <p class="text-lg font-black font-mono text-teal-700 mt-1">{{ dataService.stockValueCost() | number:'1.2-2' }} TK</p>
              </div>
              <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                <p class="text-slate-500 font-semibold">{{ prefs.t('reports.stockSales') }}</p>
                <p class="text-lg font-black font-mono text-emerald-600 mt-1">{{ dataService.stockValueSales() | number:'1.2-2' }} TK</p>
              </div>
              <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                <p class="text-slate-500 font-semibold">{{ prefs.t('reports.profit') }} ({{ prefs.txt('সম্ভাব্য', 'estimated') }})</p>
                <p class="text-lg font-black font-mono text-emerald-700 mt-1">{{ dataService.stockValueSales() - dataService.stockValueCost() | number:'1.2-2' }} TK</p>
              </div>
            </div>

            <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div class="overflow-x-auto">
                <table class="w-full min-w-[820px] text-left border-collapse">
                  <thead>
                    <tr class="bg-teal-700 text-white uppercase text-[10px] font-bold">
                      <th class="p-2.5">{{ prefs.t('common.name') }}</th>
                      <th class="p-2.5">{{ prefs.t('nav.categories') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.txt('স্টক', 'Stock') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.cost') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.stockCost') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.stockSales') }}</th>
                      <th class="p-2.5 text-right">{{ prefs.t('reports.profit') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (row of stockPager.paged(); track row.product.id) {
                      <tr class="hover:bg-teal-50/40">
                        <td class="p-2.5 font-semibold text-slate-800">{{ row.product.name }}</td>
                        <td class="p-2.5 text-slate-500">{{ row.product.category }}</td>
                        <td class="p-2.5 text-right font-mono" [class.text-rose-600]="row.product.stock <= 5">{{ row.product.stock | number:'1.0-2' }} {{ row.product.unit }}</td>
                        <td class="p-2.5 text-right font-mono">{{ row.valuation.costPrice | number:'1.2-2' }}</td>
                        <td class="p-2.5 text-right font-mono">{{ row.valuation.cost | number:'1.2-2' }}</td>
                        <td class="p-2.5 text-right font-mono">{{ row.valuation.sales | number:'1.2-2' }}</td>
                        <td class="p-2.5 text-right font-mono font-bold" [class.text-emerald-700]="row.valuation.sales >= row.valuation.cost" [class.text-rose-600]="row.valuation.sales < row.valuation.cost">{{ row.valuation.sales - row.valuation.cost | number:'1.2-2' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <app-table-pagination
                [total]="stockPager.total()"
                [page]="stockPager.currentPage()"
                [pageSize]="stockPager.pageSize()"
                (pageChange)="stockPager.setPage($event)"
                (pageSizeChange)="stockPager.setPageSize($event)"
              />
            </div>
          }
        </div>
      </div>
    }
  `
})
export class Reports {
  dataService = inject(DataService);
  session = inject(SessionService);
  prefs = inject(PreferencesService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly activeTabClass = 'bg-teal-700 text-white px-3 py-1.5 rounded-lg font-bold whitespace-nowrap';
  readonly idleTabClass = 'text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap';

  tab = signal<ReportTab>('money');
  fromDate = signal<string>(resolveDateRange('month').from);
  toDate = signal<string>(resolveDateRange('month').to);
  rangeKind = signal<DateRangeKind>('month');
  granularity = signal<FlowGranularity>('daily');

  readonly rangePresets = DATE_RANGE_PRESETS;
  readonly granularities: { key: FlowGranularity; bn: string; en: string }[] = [
    { key: 'daily', bn: 'দৈনিক', en: 'Daily' },
    { key: 'weekly', bn: 'সাপ্তাহিক', en: 'Weekly' },
    { key: 'monthly', bn: 'মাসিক', en: 'Monthly' },
    { key: 'yearly', bn: 'বার্ষিক', en: 'Yearly' }
  ];

  private readonly bnMonths = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
  private readonly enMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab') as ReportTab | null;
      if (tab && ['money', 'overview', 'products', 'categories', 'stock'].includes(tab)) {
        this.tab.set(tab);
      }
    });
  }

  setTab(tab: ReportTab) {
    this.tab.set(tab);
    this.resetPages();
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  pickRange(kind: DateRangeKind) {
    const range = resolveDateRange(kind);
    this.rangeKind.set(kind);
    this.fromDate.set(range.from);
    this.toDate.set(range.to);
    this.granularity.set(kind === 'today' || kind === 'week' || kind === 'month'
      ? 'daily'
      : kind === 'year' ? 'monthly' : 'yearly');
    this.resetPages();
  }

  setGranularity(value: FlowGranularity) {
    this.granularity.set(value);
  }

  setFromDate(value: string) {
    this.rangeKind.set('custom');
    this.fromDate.set(value);
    this.resetPages();
  }

  setToDate(value: string) {
    this.rangeKind.set('custom');
    this.toDate.set(value);
    this.resetPages();
  }

  granularityLabel(): string {
    const found = this.granularities.find(g => g.key === this.granularity());
    return found ? this.prefs.txt(found.bn, found.en) : '';
  }

  settings = computed(() => this.dataService.voucherSettings());

  salesInRange = computed<Sale[]>(() => {
    const from = this.boundary(this.fromDate(), false);
    const to = this.boundary(this.toDate(), true);
    return this.dataService.sales().filter(s => {
      if (s.status === 'Cancelled') return false;
      const ts = this.dateValue(s.date);
      return ts >= from && ts <= to;
    });
  });

  paymentsInRange = computed(() => {
    const from = this.boundary(this.fromDate(), false);
    const to = this.boundary(this.toDate(), true);
    return this.dataService.payments().filter(p => {
      const ts = this.dateValue(p.date);
      return ts >= from && ts <= to;
    });
  });

  expensesInRange = computed(() => {
    const from = this.boundary(this.fromDate(), false);
    const to = this.boundary(this.toDate(), true);
    return this.dataService.expenses().filter(e => {
      const ts = this.dateValue(e.date);
      return ts >= from && ts <= to;
    });
  });

  salaryInRange = computed(() => {
    const from = this.boundary(this.fromDate(), false);
    const to = this.boundary(this.toDate(), true);
    return this.dataService.salaryPayments().filter(p => {
      const ts = this.dateValue(p.date);
      return ts >= from && ts <= to;
    });
  });

  rentInRange = computed(() => {
    const from = this.boundary(this.fromDate(), false);
    const to = this.boundary(this.toDate(), true);
    return this.dataService.rentPayments().filter(r => {
      if (r.status !== 'Paid') return false;
      const ts = this.dateValue(r.date);
      return ts >= from && ts <= to;
    });
  });

  /** Posted credit notes in the period; drafts and cancelled notes move nothing. */
  returnsInRange = computed<SalesReturn[]>(() => {
    const from = this.boundary(this.fromDate(), false);
    const to = this.boundary(this.toDate(), true);
    return this.dataService.salesReturns().filter(note => {
      if (note.status !== 'Posted') return false;
      const ts = this.dateValue(note.date);
      return ts >= from && ts <= to;
    });
  });

  /** Daily expenses plus the wages and shop rent that actually left the wallet. */
  operatingExpenses = computed(() =>
    this.expensesInRange().reduce((acc, e) => acc + (Number(e.amount) || 0), 0)
    + this.salaryInRange().reduce((acc, p) => acc + (Number(p.netPay) || 0), 0)
    + this.rentInRange().reduce((acc, r) => acc + (Number(r.amount) || 0), 0)
  );

  batteryInRange = computed(() => {
    const from = this.boundary(this.fromDate(), false);
    const to = this.boundary(this.toDate(), true);
    return this.dataService.batteryVouchers().filter(v => {
      const ts = this.dateValue(v.date);
      return ts >= from && ts <= to;
    });
  });

  batteryProfit = computed(() =>
    this.batteryInRange().reduce((acc, v) => acc + this.dataService.batteryVoucherProfit(v), 0)
  );

  purchasesInRange = computed(() => {
    const from = this.boundary(this.fromDate(), false);
    const to = this.boundary(this.toDate(), true);
    return this.dataService.purchases().filter(p => {
      const ts = this.dateValue(p.date);
      return ts >= from && ts <= to;
    });
  });

  /** Money that came in and went out, split by plain goods and battery trade. */
  moneyTotals = computed(() => {
    const salesBeforeReturns = this.salesInRange().reduce((acc, s) => acc + (Number(s.total) || 0), 0);
    const returns = this.returnsInRange().reduce((acc, note) => acc + (Number(note.amount) || 0), 0);
    const sales = salesBeforeReturns - returns;
    const purchases = this.purchasesInRange().reduce((acc, p) => acc + (Number(p.total) || 0), 0);
    const batteryVouchers = this.batteryInRange();
    const purchaseVouchers = batteryVouchers.filter(v => v.type === 'purchase' && v.source !== 'sale-adjustment');
    const saleVouchers = batteryVouchers.filter(v => v.type === 'sale' || v.type === 'exchange');
    const batteryPurchase = purchaseVouchers.reduce((acc, v) => acc + (Number(v.total) || 0), 0);
    const batterySale = saleVouchers.reduce((acc, v) => acc + (Number(v.type === 'sale' ? v.total : (v.fee ?? v.total)) || 0), 0);
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      sales: round(sales),
      returns: round(returns),
      purchases: round(purchases),
      batteryPurchase: round(batteryPurchase),
      batterySale: round(batterySale),
      batteryPurchaseCount: purchaseVouchers.length,
      batterySaleCount: saleVouchers.length,
      net: round(sales - purchases - batteryPurchase + batterySale)
    };
  });

  moneyRows = computed<FlowRow[]>(() => {
    const buckets = new Map<string, { sales: number; purchases: number; batteryPurchase: number; batterySale: number }>();
    const bucket = (key: string) => {
      let entry = buckets.get(key);
      if (!entry) {
        entry = { sales: 0, purchases: 0, batteryPurchase: 0, batterySale: 0 };
        buckets.set(key, entry);
      }
      return entry;
    };
    const add = (date: string, field: keyof ReturnType<typeof bucket>, amount: number) => {
      const iso = toIsoDate(date);
      if (!iso || !this.inRange(iso) || !amount) return;
      bucket(this.bucketKey(iso))[field] += amount;
    };

    for (const sale of this.salesInRange()) add(sale.date, 'sales', Number(sale.total) || 0);
    for (const note of this.returnsInRange()) add(note.date, 'sales', -(Number(note.amount) || 0));
    for (const purchase of this.purchasesInRange()) add(purchase.date, 'purchases', Number(purchase.total) || 0);
    for (const voucher of this.batteryInRange()) {
      if (voucher.type === 'purchase' && voucher.source !== 'sale-adjustment') {
        add(voucher.date, 'batteryPurchase', Number(voucher.total) || 0);
      } else if (voucher.type === 'sale') {
        add(voucher.date, 'batterySale', Number(voucher.total) || 0);
      } else if (voucher.type === 'exchange') {
        add(voucher.date, 'batterySale', Number(voucher.fee ?? voucher.total) || 0);
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, entry]) => ({
        key,
        label: this.bucketLabel(key),
        sales: round(entry.sales),
        purchases: round(entry.purchases),
        batteryPurchase: round(entry.batteryPurchase),
        batterySale: round(entry.batterySale),
        net: round(entry.sales + entry.batterySale - entry.purchases - entry.batteryPurchase)
      }));
  });

  /** Longest bar in the trend table, so both directions share one scale. */
  private flowScale = computed(() => this.moneyRows().reduce((max, row) => Math.max(
    max,
    row.sales + row.batterySale,
    row.purchases + row.batteryPurchase
  ), 0));

  barWidth(value: number): number {
    const scale = this.flowScale();
    if (!scale) return 0;
    return Math.max(2, Math.round((value / scale) * 100));
  }

  private inRange(iso: string): boolean {
    const from = toIsoDate(this.fromDate()) || '0000-01-01';
    const to = toIsoDate(this.toDate()) || '9999-12-31';
    return iso >= from && iso <= to;
  }

  private bucketKey(iso: string): string {
    const granularity = this.granularity();
    if (granularity === 'yearly') return iso.slice(0, 4);
    if (granularity === 'monthly') return iso.slice(0, 7);
    if (granularity === 'weekly') {
      const date = new Date(`${iso}T00:00:00`);
      // Bangladesh weeks run Saturday → Friday, matching the list pages.
      date.setDate(date.getDate() - ((date.getDay() + 1) % 7));
      return isoFromDate(date);
    }
    return iso;
  }

  private bucketLabel(key: string): string {
    const monthly = this.prefs.language() === 'bn' ? this.bnMonths : this.enMonths;
    if (this.granularity() === 'yearly') return key;
    if (this.granularity() === 'monthly') {
      const [year, month] = key.split('-').map(Number);
      return `${monthly[month - 1] || month} ${year}`;
    }
    if (this.granularity() === 'weekly') {
      const start = new Date(`${key}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return `${this.formatDate(isoFromDate(start))} — ${this.formatDate(isoFromDate(end))}`;
    }
    return this.formatDate(key);
  }

  itemRows = computed<SoldItem[]>(() => [
    ...this.salesInRange().flatMap(sale => soldItemsOf(sale, this.dataService.products())),
    ...this.returnsInRange().flatMap(note => returnedItemsOf(note, this.dataService.products()))
  ]);

  costKnownCount = computed(() => this.itemRows().filter(row => !!row.product).length);

  productPerformance = computed<ProductProfitRow[]>(() => productProfitRows(this.itemRows()));

  readonly productsPager = createPager(() => this.productPerformance());

  categoryPerformance = computed<ProductProfitRow[]>(() => categoryProfitRows(this.productPerformance()));

  readonly categoriesPager = createPager(() => this.categoryPerformance());

  readonly stockRows = computed(() => this.dataService.products().map(product => ({
    product,
    valuation: productStockValuation(product)
  })));

  readonly stockPager = createPager(() => this.stockRows());

  resetPages() {
    this.productsPager.setPage(1);
    this.categoriesPager.setPage(1);
    this.stockPager.setPage(1);
  }

  totals = computed(() => {
    const sales = this.moneyTotals().sales;
    const cogs = this.productPerformance().reduce((acc, r) => acc + r.cost, 0);
    const expenses = this.operatingExpenses();
    const cashCollected = this.salesInRange().reduce((acc, s) => {
      if (typeof s.cashReceived === 'number') return acc + s.cashReceived;
      return acc + (s.paymentStatus === 'Paid' ? s.paid : 0);
    }, 0);
    const bankCollected = this.salesInRange().reduce((acc, s) => acc + (s.bankPayment || 0), 0);
    const due = this.salesInRange().reduce((acc, s) => acc + (s.due || 0), 0);
    const payments = this.paymentsInRange().reduce((acc, p) => acc + p.amount, 0);
    const qty = this.itemRows().reduce((acc, r) => acc + r.baseQty, 0);
    const batteryProfit = this.batteryProfit();
    return { sales, cogs, expenses, gross: sales - cogs, net: sales - cogs - expenses + batteryProfit, batteryProfit, cashCollected, bankCollected, due, payments, qty };
  });

  summaryCards = computed(() => [
    { label: this.prefs.t('reports.sales'), value: this.totals().sales, color: 'text-slate-900' },
    { label: this.prefs.t('reports.cogs'), value: this.totals().cogs, color: 'text-amber-700' },
    { label: this.prefs.t('reports.gross'), value: this.totals().gross, color: 'text-teal-700' },
    { label: this.prefs.t('reports.expenses'), value: this.totals().expenses, color: 'text-rose-600' },
    { label: this.prefs.t('reports.net'), value: this.totals().net, color: this.totals().net >= 0 ? 'text-emerald-600' : 'text-rose-600' },
    { label: this.prefs.txt('ব্যাটারি লাভ', 'Battery Profit'), value: this.totals().batteryProfit, color: 'text-teal-700' },
    { label: this.prefs.t('reports.stockCost'), value: this.dataService.stockValueCost(), color: 'text-indigo-600' }
  ]);

  reportTitle = computed(() => {
    switch (this.tab()) {
      case 'money': return this.prefs.txt('আয়-ব্যয়ের হিসাব', 'Money Flow Statement');
      case 'products': return this.prefs.t('reports.productProfit');
      case 'categories': return this.prefs.t('reports.categoryProfit');
      case 'stock': return this.prefs.t('reports.stockValue');
      default: return this.prefs.t('reports.profitLoss');
    }
  });

  displayRange = computed(() => `${this.formatDate(this.fromDate())} — ${this.formatDate(this.toDate())}`);

  exportWorkbook() {
    const summaryRows = [
      { Metric: 'Sales (net of returns)', Value: this.totals().sales },
      { Metric: 'Sales Returns', Value: this.moneyTotals().returns },
      { Metric: 'Cost of Goods', Value: this.totals().cogs },
      { Metric: 'Gross Profit', Value: this.totals().gross },
      { Metric: 'Expenses', Value: this.totals().expenses },
      { Metric: 'Daily Expenses', Value: this.expensesInRange().reduce((acc, e) => acc + (Number(e.amount) || 0), 0) },
      { Metric: 'Salary Paid', Value: this.salaryInRange().reduce((acc, p) => acc + (Number(p.netPay) || 0), 0) },
      { Metric: 'Rent Paid', Value: this.rentInRange().reduce((acc, r) => acc + (Number(r.amount) || 0), 0) },
      { Metric: 'Net Profit', Value: this.totals().net },
      { Metric: 'Battery Profit', Value: this.totals().batteryProfit },
      { Metric: 'Cash Collected', Value: this.totals().cashCollected },
      { Metric: 'Bank Collected', Value: this.totals().bankCollected },
      { Metric: 'Due', Value: this.totals().due },
      { Metric: 'Stock at Cost', Value: this.dataService.stockValueCost() },
      { Metric: 'Stock at Sale Value', Value: this.dataService.stockValueSales() }
    ];
    const productRows = this.productPerformance().map(r => ({
      Product: r.name, Category: r.category, Qty: r.qty,
      Revenue: r.revenue, Cost: r.cost, Profit: r.profit, MarginPercent: r.margin
    }));
    const categoryRows = this.categoryPerformance().map(r => ({
      Category: r.name, Qty: r.qty, Revenue: r.revenue, Cost: r.cost, Profit: r.profit, MarginPercent: r.margin
    }));
    const stockRows = this.stockRows().map(({ product: p, valuation: v }) => ({
      Product: p.name, Category: p.category, Stock: p.stock, Unit: p.unit,
      PurchasePrice: v.costPrice, SalesPrice: v.salesPrice,
      StockValueCost: v.cost,
      StockValueSales: v.sales
    }));

    const moneyRows = this.moneyRows().map(row => ({
      Period: row.label,
      SalesIncome: row.sales,
      PurchaseExpense: row.purchases,
      BatteryPurchase: row.batteryPurchase,
      BatterySale: row.batterySale,
      Net: row.net
    }));
    void downloadWorkbook(`Reports_${this.fromDate()}_${this.toDate()}.xlsx`, [
      { name: 'Summary', rows: summaryRows },
      { name: 'Money Flow', rows: moneyRows },
      { name: 'Product Profit', rows: productRows },
      { name: 'Category Profit', rows: categoryRows },
      { name: 'Stock Valuation', rows: stockRows }
    ]).then(() => this.session.log('Export', `Reports exported (${this.fromDate()} to ${this.toDate()})`))
      .catch(error => this.notify.error(error instanceof Error ? error.message : String(error), this.prefs.txt('এক্সপোর্ট ব্যর্থ', 'Export failed')));
  }

  printReport() {
    this.session.log('Print', `Report printed (${this.fromDate()} to ${this.toDate()})`);
    setTimeout(() => window.print(), 80);
  }

  private boundary(value: string, endOfDay: boolean): number {
    const ts = this.dateValue(value);
    if (!ts) return endOfDay ? Number.MAX_SAFE_INTEGER : 0;
    return endOfDay ? ts + 86399999 : ts;
  }

  private dateValue(value: string): number {
    if (!value) return 0;
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]).getTime();
    const dmy = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]).getTime();
    return 0;
  }

  private formatDate(value: string): string {
    const ts = this.dateValue(value);
    if (!ts) return value || '-';
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  }
}

function isoFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
