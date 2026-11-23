import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DataService, Product, StockAdjustment, StockAdjustmentReason } from '../../services/data';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { SessionService } from '../../services/session';

type StockStatus = 'ok' | 'low' | 'out' | 'service';
type StockSortKey = 'name' | 'category' | 'warehouse' | 'stock' | 'price' | 'value';

@Component({
  selector: 'app-stock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, TablePagination],
  host: { '(document:keydown.escape)': 'closeAdjust()' },
  template: `
    <div class="space-y-4 text-xs text-slate-800">
      <div class="bg-white p-4 rounded-xl shadow-xs border border-slate-200 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 class="text-xl font-bold text-slate-900">{{ prefs.txt('স্টক ইনভেন্টরি', 'Stock Inventory') }}</h1>
          <p class="text-xs text-slate-500">{{ prefs.txt('ড্যাশবোর্ড / স্টক — স্টক রিপোর্ট', 'Dashboard / Stock - Stock Report') }}</p>
        </div>
        <button (click)="exportExcel()" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-1.5 rounded-lg flex items-center gap-1 self-start sm:self-auto">
          <mat-icon class="text-xs">description</mat-icon> {{ prefs.txt('এক্সেল এক্সপোর্ট', 'Excel Export') }}
        </button>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <button type="button" (click)="setStatus('all')"
          class="text-left bg-white p-3.5 rounded-xl shadow-2xs border transition-all cursor-pointer"
          [class]="statusFilter() === 'all' ? 'border-teal-500 ring-1 ring-teal-400' : 'border-slate-200 hover:border-teal-300'">
          <span class="text-slate-500">{{ prefs.txt('মোট পণ্য', 'Total Products') }}</span>
          <p class="text-xl font-black text-teal-800 font-mono mt-1">{{ totalProducts() }}</p>
        </button>
        <button type="button" (click)="setStatus('ok')"
          class="text-left bg-white p-3.5 rounded-xl shadow-2xs border transition-all cursor-pointer"
          [class]="statusFilter() === 'ok' ? 'border-emerald-500 ring-1 ring-emerald-400' : 'border-slate-200 hover:border-emerald-300'">
          <span class="text-emerald-600 font-semibold">{{ prefs.txt('স্টক আছে', 'In Stock') }}</span>
          <p class="text-xl font-black text-emerald-800 font-mono mt-1">{{ statusCounts().ok }}</p>
        </button>
        <button type="button" (click)="setStatus('low')"
          class="text-left bg-white p-3.5 rounded-xl shadow-2xs border transition-all cursor-pointer"
          [class]="statusFilter() === 'low' ? 'border-amber-500 ring-1 ring-amber-400' : 'border-slate-200 hover:border-amber-300'">
          <span class="text-amber-700 font-semibold">{{ prefs.txt('কম স্টক', 'Low Stock') }}</span>
          <p class="text-xl font-black text-amber-700 font-mono mt-1">{{ statusCounts().low }}</p>
        </button>
        <button type="button" (click)="setStatus('out')"
          class="text-left bg-white p-3.5 rounded-xl shadow-2xs border transition-all cursor-pointer"
          [class]="statusFilter() === 'out' ? 'border-rose-500 ring-1 ring-rose-400' : 'border-slate-200 hover:border-rose-300'">
          <span class="text-rose-600 font-semibold">{{ prefs.txt('স্টক শেষ', 'Out of Stock') }}</span>
          <p class="text-xl font-black text-rose-600 font-mono mt-1">{{ statusCounts().out }}</p>
        </button>
        <div class="col-span-2 md:col-span-1 bg-white p-3.5 rounded-xl shadow-2xs border border-slate-200">
          <span class="text-slate-500 font-semibold">{{ prefs.txt('স্টকের মূল্য', 'Stock Valuation') }}</span>
          <p class="text-xl font-black text-slate-900 font-mono mt-1">{{ stockValue() | number:'1.2-2' }} TK</p>
        </div>
      </div>

      @if (isAdmin()) {
        <div class="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2 text-[11px] font-semibold text-teal-800">
          <mat-icon class="text-teal-600" style="font-size:16px;width:16px;height:16px;">fact_check</mat-icon>
          <span>{{ prefs.txt('পণ্যের পাশে সমন্বয় বাটনে চেপে হাতে গোনা প্রকৃত স্টক লিখুন — নতুন পাওয়া পণ্য বা ঘাটতি স্টকে বসে যাবে, ক্রয়-বিক্রয়ের হিসাব অপরিবর্তিত থাকবে।', 'Use the reconcile button beside a product to enter the physically counted stock — extra or missing units are booked without touching purchase or sale records.') }}</span>
        </div>
      }

      <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div class="border-b border-slate-200 bg-slate-50/70 px-3 py-2.5 flex flex-col lg:flex-row lg:items-center gap-2 justify-between">
          <div class="relative w-full lg:max-w-xs">
            <mat-icon class="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" style="font-size:16px;width:16px;height:16px;">search</mat-icon>
            <input
              type="search"
              [value]="query()"
              (input)="onQuery($event)"
              [placeholder]="prefs.txt('নাম, কোড, ক্যাটাগরি বা ব্র্যান্ড দিয়ে খুঁজুন', 'Search by name, code, category or brand')"
              class="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-7 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-teal-500"
            />
            @if (query()) {
              <button (click)="clearSearch()" class="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer" [attr.aria-label]="prefs.txt('সার্চ মুছুন', 'Clear search')">
                <mat-icon style="font-size:16px;width:16px;height:16px;">close</mat-icon>
              </button>
            }
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            @for (f of statusFilters; track f.key) {
              <button (click)="setStatus(f.key)"
                class="rounded-full border px-2.5 py-1 text-[10px] font-bold cursor-pointer transition-colors"
                [class]="statusFilter() === f.key
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'">
                {{ prefs.txt(f.bn, f.en) }}
                <span class="ml-0.5 opacity-70">{{ statusCounts()[f.key] }}</span>
              </button>
            }
            <span class="ml-1 text-[10px] font-bold text-slate-400 whitespace-nowrap">
              {{ filtered().length }} / {{ totalProducts() }}
            </span>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[900px] text-xs text-left">
            <thead class="bg-teal-700 text-white font-bold uppercase text-[10px] tracking-wide">
              <tr>
                <th class="p-2.5">
                  <button (click)="toggleSort('name')" class="inline-flex items-center gap-0.5 uppercase cursor-pointer hover:text-teal-100">
                    {{ prefs.txt('পণ্য', 'PRODUCT') }}
                    <mat-icon style="font-size:13px;width:13px;height:13px;">{{ sortIcon('name') }}</mat-icon>
                  </button>
                </th>
                <th class="p-2.5">
                  <button (click)="toggleSort('category')" class="inline-flex items-center gap-0.5 uppercase cursor-pointer hover:text-teal-100">
                    {{ prefs.txt('ক্যাটাগরি', 'CATEGORY') }}
                    <mat-icon style="font-size:13px;width:13px;height:13px;">{{ sortIcon('category') }}</mat-icon>
                  </button>
                </th>
                <th class="p-2.5">
                  <button (click)="toggleSort('warehouse')" class="inline-flex items-center gap-0.5 uppercase cursor-pointer hover:text-teal-100">
                    {{ prefs.txt('ওয়্যারহাউস', 'WAREHOUSE') }}
                    <mat-icon style="font-size:13px;width:13px;height:13px;">{{ sortIcon('warehouse') }}</mat-icon>
                  </button>
                </th>
                <th class="p-2.5">{{ prefs.txt('অবস্থা', 'STATUS') }}</th>
                <th class="p-2.5 text-right">
                  <button (click)="toggleSort('stock')" class="inline-flex items-center gap-0.5 uppercase cursor-pointer hover:text-teal-100 ml-auto">
                    {{ prefs.txt('স্টক', 'STOCK') }}
                    <mat-icon style="font-size:13px;width:13px;height:13px;">{{ sortIcon('stock') }}</mat-icon>
                  </button>
                </th>
                <th class="p-2.5 text-right">
                  <button (click)="toggleSort('price')" class="inline-flex items-center gap-0.5 uppercase cursor-pointer hover:text-teal-100 ml-auto">
                    {{ prefs.txt('একক মূল্য', 'UNIT PRICE') }}
                    <mat-icon style="font-size:13px;width:13px;height:13px;">{{ sortIcon('price') }}</mat-icon>
                  </button>
                </th>
                <th class="p-2.5 text-right">
                  <button (click)="toggleSort('value')" class="inline-flex items-center gap-0.5 uppercase cursor-pointer hover:text-teal-100 ml-auto">
                    {{ prefs.txt('মূল্যায়ন', 'VALUATION') }}
                    <mat-icon style="font-size:13px;width:13px;height:13px;">{{ sortIcon('value') }}</mat-icon>
                  </button>
                </th>
                @if (isAdmin()) {
                  <th class="p-2.5 text-center">{{ prefs.txt('সমন্বয়', 'RECONCILE') }}</th>
                }
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (p of pager.paged(); track p.id) {
                <tr class="hover:bg-teal-50/40 transition-colors">
                  <td class="p-2.5">
                    <span class="font-bold text-slate-800">{{ p.name }}</span>
                    <span class="block font-mono text-[10px] text-slate-400">
                      {{ p.code }}
                      @if (p.variants?.length) {
                        · {{ prefs.txt('ভ্যারিয়েন্ট', 'Variants') }}: {{ p.variants?.length }}
                      }
                    </span>
                  </td>
                  <td class="p-2.5 text-slate-700">
                    {{ p.category }}
                    @if (p.subCategory) {
                      <span class="block text-[10px] text-slate-400">{{ p.subCategory }}</span>
                    }
                  </td>
                  <td class="p-2.5 text-slate-600 whitespace-nowrap">{{ p.warehouse || '—' }}</td>
                  <td class="p-2.5">
                    <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap" [class]="statusClass(p)">
                      {{ statusLabel(p) }}
                    </span>
                  </td>
                  <td class="p-2.5 text-right font-mono font-bold whitespace-nowrap" [class]="statusOf(p) === 'out' ? 'text-rose-600' : statusOf(p) === 'low' ? 'text-amber-600' : 'text-teal-800'">
                    {{ p.type === 'service' ? '—' : p.stock }} <span class="text-[10px] font-semibold text-slate-400">{{ p.type === 'service' ? '' : p.unit }}</span>
                  </td>
                  <td class="p-2.5 text-right font-mono whitespace-nowrap">{{ p.salesPrice | number:'1.2-2' }} TK</td>
                  <td class="p-2.5 text-right font-mono font-bold text-slate-900 whitespace-nowrap">{{ (p.stock * p.salesPrice) | number:'1.2-2' }} TK</td>
                  @if (isAdmin()) {
                    <td class="p-2.5 text-center">
                      <button
                        (click)="openAdjust(p)"
                        [disabled]="p.type === 'service'"
                        [title]="p.type === 'service'
                          ? prefs.txt('সার্ভিস পণ্যের স্টক নেই', 'Service products have no stock')
                          : prefs.txt('প্রকৃত স্টক মিলিয়ে বসান', 'Reconcile the physical stock')"
                        class="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[10px] font-bold text-teal-700 hover:bg-teal-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <mat-icon style="font-size:14px;width:14px;height:14px;">tune</mat-icon>
                        {{ prefs.txt('সমন্বয়', 'Reconcile') }}
                      </button>
                    </td>
                  }
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="isAdmin() ? 8 : 7" class="p-8 text-center">
                    <mat-icon class="text-slate-300" style="font-size:32px;width:32px;height:32px;">inventory_2</mat-icon>
                    <p class="mt-1 font-semibold text-slate-500">
                      {{ prefs.txt('কোনো পণ্য পাওয়া যায়নি।', 'No products found.') }}
                    </p>
                    @if (query() || statusFilter() !== 'all') {
                      <button (click)="clearFilters()" class="mt-2 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1 text-[10px] font-bold text-teal-700 hover:bg-teal-100 cursor-pointer">
                        {{ prefs.txt('ফিল্টার মুছে সব দেখুন', 'Clear filters and show all') }}
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
            <tfoot class="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-700">
              <tr>
                <td class="p-2.5" colspan="4">{{ filtered().length }} {{ prefs.txt('টি পণ্য', 'products') }}</td>
                <td class="p-2.5 text-right font-mono whitespace-nowrap">{{ totalStock() | number:'1.0-2' }}</td>
                <td class="p-2.5"></td>
                <td class="p-2.5 text-right font-mono text-slate-900 whitespace-nowrap">{{ filteredValue() | number:'1.2-2' }} TK</td>
                @if (isAdmin()) {
                  <td class="p-2.5"></td>
                }
              </tr>
            </tfoot>
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

      @if (isAdmin()) {
        <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
          <div class="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
            <h2 class="font-bold text-slate-900 flex items-center gap-1.5">
              <mat-icon class="text-teal-600" style="font-size:18px;width:18px;height:18px;">history</mat-icon>
              {{ prefs.txt('স্টক সমন্বয়ের ইতিহাস', 'Stock Reconciliation History') }}
            </h2>
            <span class="text-[10px] font-bold text-slate-400">{{ dataService.stockAdjustments().length }} {{ prefs.txt('টি', 'entries') }}</span>
          </div>
          @if (recentAdjustments().length) {
            <div class="overflow-x-auto">
              <table class="w-full min-w-[760px] text-[11px] text-left">
                <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[9px] tracking-wide">
                  <tr>
                    <th class="px-2.5 py-2">{{ prefs.txt('তারিখ', 'DATE') }}</th>
                    <th class="px-2.5 py-2">{{ prefs.txt('পণ্য', 'PRODUCT') }}</th>
                    <th class="px-2.5 py-2 text-right">{{ prefs.txt('আগে', 'BEFORE') }}</th>
                    <th class="px-2.5 py-2 text-right">{{ prefs.txt('পরে', 'AFTER') }}</th>
                    <th class="px-2.5 py-2 text-right">{{ prefs.txt('পরিবর্তন', 'CHANGE') }}</th>
                    <th class="px-2.5 py-2">{{ prefs.txt('কারণ', 'REASON') }}</th>
                    <th class="px-2.5 py-2">{{ prefs.txt('নোট', 'NOTE') }}</th>
                    <th class="px-2.5 py-2">{{ prefs.txt('ব্যবহারকারী', 'BY') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (a of recentAdjustments(); track a.id) {
                    <tr class="hover:bg-slate-50">
                      <td class="px-2.5 py-2 font-mono whitespace-nowrap">{{ a.date }}</td>
                      <td class="px-2.5 py-2">
                        <span class="font-semibold text-slate-800">{{ a.productName }}</span>
                        <span class="block font-mono text-[9px] text-slate-400">{{ a.code }}</span>
                        @if (a.variants.length) {
                          <span class="block text-[9px] text-slate-500">{{ variantSummary(a) }}</span>
                        }
                      </td>
                      <td class="px-2.5 py-2 text-right font-mono">{{ a.previousStock }} {{ a.unit }}</td>
                      <td class="px-2.5 py-2 text-right font-mono font-bold">{{ a.newStock }} {{ a.unit }}</td>
                      <td class="px-2.5 py-2 text-right font-mono font-bold whitespace-nowrap"
                        [class]="a.delta > 0 ? 'text-emerald-600' : 'text-rose-600'">
                        {{ a.delta > 0 ? '+' : '' }}{{ a.delta }}
                      </td>
                      <td class="px-2.5 py-2 whitespace-nowrap">{{ reasonLabel(a.reason) }}</td>
                      <td class="px-2.5 py-2 max-w-48 break-words">{{ a.note || '—' }}</td>
                      <td class="px-2.5 py-2">{{ a.user || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="px-3 py-6 text-center text-slate-400">
              {{ prefs.txt('এখনো কোনো সমন্বয় হয়নি।', 'No reconciliation yet.') }}
            </p>
          }
        </div>
      }
    </div>

    <!-- Reconcile Stock drawer -->
    @if (adjustOpen() && adjustProduct(); as p) {
      <div class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex justify-end" (click)="closeAdjust()">
        <aside role="dialog" aria-modal="true" (click)="$event.stopPropagation()"
          class="relative w-full max-w-md h-dvh max-h-dvh bg-white shadow-2xl flex flex-col overflow-hidden border-l border-slate-200 animate-in slide-in-from-right duration-300">
          <div class="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <mat-icon class="text-teal-600" style="font-size:18px;width:18px;height:18px;">fact_check</mat-icon>
                {{ prefs.txt('স্টক সমন্বয়', 'Reconcile Stock') }}
              </h3>
              <p class="text-[11px] text-slate-500 mt-0.5 truncate">
                {{ p.name }} · {{ p.code }}
                @if (p.variants?.length) {
                  <span class="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">{{ p.variants?.length }} {{ prefs.txt('ভ্যারিয়েন্ট', 'variants') }}</span>
                }
              </p>
            </div>
            <button (click)="closeAdjust()" class="text-slate-400 hover:text-slate-700 cursor-pointer" [attr.aria-label]="prefs.txt('বন্ধ', 'Close')">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          <!-- Always visible while the list scrolls, so the live change never leaves the screen. -->
          <div class="flex items-center justify-between gap-2 border-b px-4 py-2"
            [class]="adjustDelta() > 0 ? 'border-emerald-200 bg-emerald-50' : adjustDelta() < 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'">
            <span class="font-semibold" [class]="adjustDelta() > 0 ? 'text-emerald-700' : adjustDelta() < 0 ? 'text-rose-600' : 'text-slate-500'">
              {{ prefs.txt('স্টকের পরিবর্তন', 'Stock change') }}
            </span>
            <span class="font-mono font-bold text-right" [class]="adjustDelta() > 0 ? 'text-emerald-700' : adjustDelta() < 0 ? 'text-rose-600' : 'text-slate-500'">
              {{ adjustDelta() > 0 ? '+' : '' }}{{ adjustDelta() }} {{ p.unit }} → {{ adjustNextStock() }} {{ p.unit }}
            </span>
          </div>

          <div class="p-4 overflow-y-auto overscroll-contain flex-1 min-h-0 space-y-3">
            <div class="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <span class="font-semibold text-slate-600">{{ prefs.txt('অ্যাপে বর্তমান স্টক', 'Current stock in the app') }}</span>
              <span class="font-mono font-bold text-slate-900">{{ p.stock }} {{ p.unit }}</span>
            </div>

            @if (p.variants?.length) {
              <div class="space-y-2">
                <p class="font-bold text-slate-700">{{ prefs.txt('প্রকৃত গণনা — ভ্যারিয়েন্ট অনুযায়ী', 'Physical count per variant') }}</p>
                @for (v of p.variants || []; track v.id) {
                  <div class="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
                    <span class="min-w-0 flex-1">
                      <span class="block font-semibold text-slate-800 truncate">{{ v.variantValue }}</span>
                      <span class="block text-[10px] text-slate-400">{{ prefs.txt('বর্তমান', 'Current') }}: {{ v.openingStock }} {{ p.unit }}</span>
                    </span>
                    <input
                      type="number"
                      inputmode="decimal"
                      min="0"
                      step="0.01"
                      [value]="variantValue(v.id)"
                      (input)="onVariantCount(v.id, $event)"
                      class="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right font-mono font-bold text-slate-800 outline-none focus:border-teal-500"
                    />
                    <span class="text-[10px] font-bold text-slate-400 w-8">{{ p.unit }}</span>
                  </div>
                }
              </div>
            } @else {
              <label class="block">
                <span class="block font-bold text-slate-700 mb-1">{{ prefs.txt('প্রকৃত গণনা (স্টকে যা পাওয়া গেছে)', 'Physical count (what is actually in stock)') }}</span>
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="0.01"
                    [value]="adjustValue()"
                    (input)="onCount($event)"
                    class="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-right font-mono font-bold text-slate-800 outline-none focus:border-teal-500"
                  />
                  <span class="text-[11px] font-bold text-slate-500">{{ p.unit }}</span>
                </div>
              </label>
            }

            <label class="block">
              <span class="block font-bold text-slate-700 mb-1">{{ prefs.txt('সমন্বয়ের কারণ', 'Reason') }}</span>
              <select
                [value]="adjustReason()"
                (change)="onReason($event)"
                class="w-full rounded-lg border border-slate-300 px-2.5 py-2 font-semibold text-slate-800 outline-none focus:border-teal-500"
              >
                @for (r of adjustReasons; track r.key) {
                  <option [value]="r.key">{{ prefs.txt(r.bn, r.en) }}</option>
                }
              </select>
            </label>

            <label class="block">
              <span class="block font-bold text-slate-700 mb-1">{{ prefs.txt('নোট (ঐচ্ছিক)', 'Note (optional)') }}</span>
              <textarea
                rows="2"
                [value]="adjustNote()"
                (input)="onNote($event)"
                [placeholder]="prefs.txt('যেমন: গুদামের পেছনে অতিরিক্ত ৫ পিস পাওয়া গেছে', 'e.g. 5 extra pieces found behind the rack')"
                class="w-full rounded-lg border border-slate-300 px-2.5 py-2 font-medium text-slate-800 outline-none focus:border-teal-500 resize-none"
              ></textarea>
            </label>

            @if (adjustError()) {
              <p class="text-[11px] font-bold text-rose-600">{{ adjustError() }}</p>
            }

            <p class="text-[10px] text-slate-400">
              {{ prefs.txt('শুধু স্টকের সংখ্যা বদলাবে; ক্রয়, বিক্রয় ও হিসাবের রেকর্ড অপরিবর্তিত থাকবে। এই সমন্বয় ইতিহাসে সংরক্ষিত হবে।', 'Only the stock number changes; purchase, sale and ledger records stay untouched. This adjustment is kept in the history.') }}
            </p>
          </div>

          <div class="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="closeAdjust()" class="rounded-lg bg-slate-100 hover:bg-slate-200 px-4 py-2 font-semibold text-slate-700 cursor-pointer">
              {{ prefs.txt('বাতিল', 'Cancel') }}
            </button>
            <button (click)="saveAdjustment()" class="rounded-lg bg-teal-600 hover:bg-teal-700 px-4 py-2 font-bold text-white cursor-pointer">
              {{ prefs.txt('সমন্বয় সংরক্ষণ', 'Save Adjustment') }}
            </button>
          </div>
        </aside>
      </div>
    }
  `
})
export class Stock {
  dataService = inject(DataService);
  readonly prefs = inject(PreferencesService);
  readonly session = inject(SessionService);
  private readonly notify = inject(NotificationService);

  readonly query = signal('');
  readonly statusFilter = signal<'all' | StockStatus>('all');
  readonly sortKey = signal<StockSortKey>('name');
  readonly sortDir = signal<'asc' | 'desc'>('asc');

  readonly statusFilters: { key: 'all' | StockStatus; bn: string; en: string }[] = [
    { key: 'all', bn: 'সব', en: 'All' },
    { key: 'ok', bn: 'স্টক আছে', en: 'In stock' },
    { key: 'low', bn: 'কম স্টক', en: 'Low' },
    { key: 'out', bn: 'স্টক শেষ', en: 'Out' },
    { key: 'service', bn: 'সার্ভিস', en: 'Service' }
  ];

  readonly statusCounts = computed(() => {
    const counts: Record<'all' | StockStatus, number> = { all: 0, ok: 0, low: 0, out: 0, service: 0 };
    for (const product of this.dataService.products()) {
      counts.all++;
      counts[this.statusOf(product)]++;
    }
    return counts;
  });

  readonly filtered = computed(() => {
    const needle = this.query().trim().toLowerCase();
    const status = this.statusFilter();
    const rows = this.dataService.products().filter(product => {
      if (status !== 'all' && this.statusOf(product) !== status) return false;
      if (!needle) return true;
      return [product.name, product.code, product.category, product.subCategory,
        product.brand, product.model, product.warehouse, product.unit]
        .some(value => (value || '').toLowerCase().includes(needle));
    });
    return this.sorted(rows);
  });

  readonly pager = createPager(() => this.filtered());

  readonly totalStock = computed(() =>
    this.round(this.filtered().reduce((sum, product) => sum + (Number(product.stock) || 0), 0))
  );

  readonly filteredValue = computed(() =>
    this.filtered().reduce((sum, product) => sum + (Number(product.stock) || 0) * (Number(product.salesPrice) || 0), 0)
  );

  readonly totalProducts = computed(() => this.dataService.products().length);
  readonly stockValue = computed(() => this.dataService.stockValueSales());

  readonly isAdmin = computed(() => this.session.currentUser()?.role === 'Admin');
  readonly recentAdjustments = computed(() => this.dataService.stockAdjustments().slice(0, 25));

  readonly adjustReasons: { key: StockAdjustmentReason; bn: string; en: string }[] = [
    { key: 'found', bn: 'নতুন পণ্য পাওয়া গেছে', en: 'Found extra stock' },
    { key: 'count', bn: 'গণনা সংশোধন', en: 'Count correction' },
    { key: 'damage', bn: 'ড্যামেজ / নষ্ট', en: 'Damage / loss' },
    { key: 'return', bn: 'ফেরত পাওয়া গেছে', en: 'Returned to stock' },
    { key: 'other', bn: 'অন্যান্য', en: 'Other' }
  ];

  readonly adjustOpen = signal(false);
  readonly adjustProduct = signal<Product | null>(null);
  readonly adjustValue = signal(0);
  readonly variantValues = signal<Record<number, number>>({});
  readonly adjustReason = signal<StockAdjustmentReason>('found');
  readonly adjustNote = signal('');
  readonly adjustError = signal('');

  readonly adjustDelta = computed(() => {
    const product = this.adjustProduct();
    if (!product) return 0;
    const current = this.round(product.stock);
    if (product.variants?.length) {
      const values = this.variantValues();
      return this.round(product.variants.reduce((delta, variant) => {
        const next = values[variant.id];
        if (next === undefined || !Number.isFinite(next)) return delta;
        return delta + this.round(next) - this.round(variant.openingStock);
      }, 0));
    }
    const next = this.adjustValue();
    return Number.isFinite(next) ? this.round(next) - current : 0;
  });

  readonly adjustNextStock = computed(() => {
    const product = this.adjustProduct();
    return product ? this.round(this.round(product.stock) + this.adjustDelta()) : 0;
  });

  openAdjust(p: Product) {
    if (!this.isAdmin() || p.type === 'service') return;
    this.adjustProduct.set(p);
    this.adjustValue.set(this.round(p.stock));
    this.variantValues.set(Object.fromEntries(
      (p.variants ?? []).map(variant => [variant.id, this.round(variant.openingStock)])
    ));
    this.adjustReason.set('found');
    this.adjustNote.set('');
    this.adjustError.set('');
    this.lockPageScroll();
    this.adjustOpen.set(true);
  }

  closeAdjust() {
    this.adjustOpen.set(false);
    this.adjustProduct.set(null);
    this.adjustError.set('');
    this.unlockPageScroll();
  }

  /** The drawer owns the scroll; the page behind it must stay put. */
  private scrollLocked = false;
  private scrollRoot?: HTMLElement;
  private savedRootOverflow = '';
  private savedBodyOverflow = '';

  constructor() {
    inject(DestroyRef).onDestroy(() => this.unlockPageScroll());
  }

  private lockPageScroll() {
    if (typeof document === 'undefined' || this.scrollLocked) return;
    this.scrollLocked = true;
    // The page scrolls inside the app's <main>, so locking <body> alone still
    // lets the page move behind the drawer.
    this.scrollRoot = document.querySelector<HTMLElement>('.app-scroll') ?? undefined;
    this.savedRootOverflow = this.scrollRoot?.style.overflow ?? '';
    if (this.scrollRoot) this.scrollRoot.style.overflow = 'hidden';
    this.savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  private unlockPageScroll() {
    if (typeof document === 'undefined' || !this.scrollLocked) return;
    this.scrollLocked = false;
    if (this.scrollRoot) this.scrollRoot.style.overflow = this.savedRootOverflow;
    this.scrollRoot = undefined;
    document.body.style.overflow = this.savedBodyOverflow;
  }

  onCount(event: Event) {
    this.adjustValue.set(Number((event.target as HTMLInputElement).value));
  }

  onVariantCount(variantId: number, event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    this.variantValues.update(values => ({ ...values, [variantId]: value }));
  }

  variantValue(variantId: number): number {
    return this.variantValues()[variantId] ?? 0;
  }

  onReason(event: Event) {
    this.adjustReason.set((event.target as HTMLSelectElement).value as StockAdjustmentReason);
  }

  onNote(event: Event) {
    this.adjustNote.set((event.target as HTMLTextAreaElement).value);
  }

  saveAdjustment() {
    const product = this.adjustProduct();
    if (!product || !this.isAdmin()) return;
    this.adjustError.set('');
    const counted = product.variants?.length
      ? { variants: { ...this.variantValues() } }
      : { quantity: this.adjustValue() };
    const result = this.dataService.adjustProductStock(product.id, counted, {
      reason: this.adjustReason(),
      note: this.adjustNote(),
      user: this.session.currentUser()?.name || ''
    });
    if (!result.ok) {
      this.adjustError.set(this.adjustErrorText(result.error));
      return;
    }
    const adjustment = result.adjustment!;
    const delta = `${adjustment.delta > 0 ? '+' : ''}${adjustment.delta} ${adjustment.unit}`;
    this.session.log('Stock Reconciled', `${adjustment.productName}: ${adjustment.previousStock} → ${adjustment.newStock} (${delta}) · ${this.reasonLabel(adjustment.reason)}${adjustment.note ? ' · ' + adjustment.note : ''}`);
    this.notify.success(
      this.prefs.txt(
        `${adjustment.productName}: স্টক ${adjustment.previousStock} → ${adjustment.newStock} (${delta})`,
        `${adjustment.productName}: stock ${adjustment.previousStock} → ${adjustment.newStock} (${delta})`
      ),
      this.prefs.txt('স্টক সমন্বয় হয়েছে', 'Stock reconciled')
    );
    this.closeAdjust();
  }

  reasonLabel(reason: string): string {
    const found = this.adjustReasons.find(r => r.key === reason);
    return found ? this.prefs.txt(found.bn, found.en) : reason;
  }

  variantSummary(adjustment: StockAdjustment): string {
    return adjustment.variants
      .map(change => `${change.variantValue}: ${change.previous} → ${change.next}`)
      .join(', ');
  }

  private adjustErrorText(error?: string): string {
    switch (error) {
      case 'missing':
        return this.prefs.txt('পণ্যটি পাওয়া যায়নি।', 'Product not found.');
      case 'service':
        return this.prefs.txt('সার্ভিস পণ্যের স্টক সমন্বয় করা যায় না।', 'Service products have no stock to reconcile.');
      case 'reason':
        return this.prefs.txt('সমন্বয়ের কারণ বেছে নিন।', 'Choose a reason for the adjustment.');
      case 'quantity':
        return this.prefs.txt('সঠিক স্টক সংখ্যা লিখুন (০ বা তার বেশি)।', 'Enter a valid stock count (0 or more).');
      case 'nochange':
        return this.prefs.txt('গণনা করা স্টক বর্তমান স্টকের সমান — কোনো পরিবর্তন নেই।', 'The counted stock matches the current stock — nothing to change.');
      case 'negative':
        return this.prefs.txt('সমন্বয়ের পর স্টক ঋণাত্মক হয়ে যাচ্ছে।', 'This adjustment would make the stock negative.');
      case 'variant':
        return this.prefs.txt('এই পণ্যের কোনো ভ্যারিয়েন্ট নেই।', 'This product has no variants.');
      default:
        return this.prefs.txt('সমন্বয় সংরক্ষণ করা যায়নি।', 'Could not save the adjustment.');
    }
  }

  private round(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  statusOf(product: Product): StockStatus {
    if (product.type === 'service') return 'service';
    const stock = Number(product.stock) || 0;
    if (stock <= 0) return 'out';
    const min = product.minQty && product.minQty > 0 ? product.minQty : 5;
    return stock <= min ? 'low' : 'ok';
  }

  statusLabel(product: Product): string {
    switch (this.statusOf(product)) {
      case 'out': return this.prefs.txt('স্টক শেষ', 'Out of stock');
      case 'low': return this.prefs.txt('কম স্টক', 'Low stock');
      case 'service': return this.prefs.txt('সার্ভিস', 'Service');
      default: return this.prefs.txt('স্টক আছে', 'In stock');
    }
  }

  statusClass(product: Product): string {
    switch (this.statusOf(product)) {
      case 'out': return 'border-rose-200 bg-rose-50 text-rose-700';
      case 'low': return 'border-amber-200 bg-amber-50 text-amber-700';
      case 'service': return 'border-slate-200 bg-slate-100 text-slate-600';
      default: return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    }
  }

  onQuery(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
    this.pager.setPage(1);
  }

  clearSearch() {
    this.query.set('');
    this.pager.setPage(1);
  }

  setStatus(status: 'all' | StockStatus) {
    this.statusFilter.set(status);
    this.pager.setPage(1);
  }

  clearFilters() {
    this.query.set('');
    this.statusFilter.set('all');
    this.pager.setPage(1);
  }

  toggleSort(key: StockSortKey) {
    if (this.sortKey() === key) {
      this.sortDir.update(direction => direction === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'stock' || key === 'price' || key === 'value' ? 'desc' : 'asc');
    }
    this.pager.setPage(1);
  }

  sortIcon(key: StockSortKey): string {
    if (this.sortKey() !== key) return 'unfold_more';
    return this.sortDir() === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  private sortValue(product: Product, key: StockSortKey): string | number {
    switch (key) {
      case 'stock': return Number(product.stock) || 0;
      case 'price': return Number(product.salesPrice) || 0;
      case 'value': return (Number(product.stock) || 0) * (Number(product.salesPrice) || 0);
      case 'category': return `${product.category} ${product.subCategory || ''}`.toLowerCase();
      case 'warehouse': return (product.warehouse || '').toLowerCase();
      default: return (product.name || '').toLowerCase();
    }
  }

  private sorted(rows: Product[]): Product[] {
    const key = this.sortKey();
    const direction = this.sortDir() === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = this.sortValue(a, key);
      const right = this.sortValue(b, key);
      const diff = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), undefined, { numeric: true });
      return diff * direction || a.name.localeCompare(b.name);
    });
  }

  exportExcel() {
    // Exports what the table is showing: the search and status filters apply.
    const rows = this.filtered().map(p => {
      const stock = p.stock || 0;
      return {
        'Product Name': p.name,
        'Item Code': p.code,
        'Category': p.category,
        'Brand': p.brand,
        'Current Stock': stock,
        'Unit': p.unit || 'পিস',
        'Unit Price (Sales)': p.salesPrice || 0,
        'Valuation (Sales)': Number((stock * (p.salesPrice || 0)).toFixed(2)),
        'Valuation (Cost)': Number((stock * (p.purchasePrice || 0)).toFixed(2)),
        'Alert Qty': p.minQty && p.minQty > 0 ? p.minQty : 5,
        'Stock Status': stock <= 0 ? 'Out of Stock' : stock <= (p.minQty && p.minQty > 0 ? p.minQty : 5) ? 'Low Stock' : 'Adequate',
        'Warehouse': p.warehouse || 'SM Warehouse'
      };
    });
    this.dataService.exportToExcel(rows, 'Stock_Report');
  }
}
