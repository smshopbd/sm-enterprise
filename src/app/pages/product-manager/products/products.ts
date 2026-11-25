import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, formatNumber } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { DataService, Product, ProductUnit, ProductVariant, Purchase, Sale } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { SessionService } from '../../../services/session';
import { IMAGE_ACCEPT, MediaService } from '../../../services/media';
import { PasscodeModal } from '../../../components/passcode-modal/passcode-modal';
import { parseVariationValues } from '../../../utils/variation-values';
import { hasProductModel, joinProductModels, productModelsOf, toggleProductModel } from '../../../utils/product-models';
import { NO_IMAGE } from '../../../utils/no-image';
import { searchProducts } from '../../../utils/product-search';
import { reorderInView } from '../../../utils/reorder';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';
import { scrollToListTopAfterRender } from '../../../utils/scroll-to-list-top';
import { persistedSignal } from '../../../utils/persisted-signal';
import { PAGE_SIZE_OPTIONS } from '../../../components/table-pagination/pagination';
import {
  ColumnLayout,
  ColumnSpec,
  ResolvedColumn,
  clampLayoutWidth,
  defaultColumnLayout,
  loadColumnLayout,
  saveColumnLayout
} from '../../../utils/column-layout';

type ComboField = 'category' | 'subCategory' | 'brand' | 'model';

/** One rendered list row; a searched variant product shows one row per variant. */
interface ProductRow {
  key: string;
  product: Product;
  display: Product;
}

/** Purchase vouchers that contain the product open in the details drawer. */
interface PurchaseHistoryRow {
  purchase: Purchase;
  quantity: number;
  amount: number;
  received: boolean;
}

/** Sales vouchers that contain the product open in the details drawer. */
interface SalesHistoryRow {
  sale: Sale;
  quantity: number;
  amount: number;
  cancelled: boolean;
}

const PRODUCT_TABLE_COLUMNS: ColumnSpec[] = [
  { key: 'sel', label: 'SEL', align: 'center', width: 40, min: 34, max: 56 },
  { key: 'sl', label: 'SL', align: 'center', width: 64, min: 48 },
  { key: 'product', label: 'PRODUCT', align: 'left', width: 330, min: 170 },
  { key: 'code', label: 'CODE', align: 'left', width: 120, min: 70 },
  { key: 'rack', label: 'RACK', align: 'left', width: 96, min: 60 },
  { key: 'type', label: 'TYPE', align: 'left', width: 104, min: 76 },
  { key: 'category', label: 'CATEGORY', align: 'left', width: 170, min: 90 },
  { key: 'brand', label: 'BRAND', align: 'left', width: 130, min: 70 },
  { key: 'model', label: 'MODEL', align: 'left', width: 110, min: 60 },
  { key: 'stock', label: 'STOCK', align: 'right', width: 138, min: 84 },
  { key: 'sales', label: 'SALES', align: 'right', width: 124, min: 76 },
  { key: 'purchase', label: 'PURCHASE', align: 'right', width: 130, min: 84 },
  { key: 'wholesale', label: 'WHOLESALE', align: 'right', width: 134, min: 84 },
  { key: 'unit', label: 'UNIT', align: 'center', width: 84, min: 52 },
  { key: 'action', label: 'ACTION', align: 'center', width: 150, min: 96 }
];

const PRODUCT_COL_SPECS: Record<string, ColumnSpec> = {};
for (const spec of PRODUCT_TABLE_COLUMNS) PRODUCT_COL_SPECS[spec.key] = spec;

const PRODUCT_TABLE_VIEW_KEY = 'sm_products_table_view_v1';

@Component({
  selector: 'app-products',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, DragDropModule, DmyDateDirective, PasscodeModal],
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">
      
      <!-- Page Header -->
      <div class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 text-white shadow-[0_18px_40px_-24px_rgba(13,148,136,0.8)] dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <span class="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-white/10 blur-3xl"></span>
        <span class="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-cyan-200/20 blur-3xl"></span>

        <div class="relative flex flex-wrap items-center gap-2.5 px-3.5 pt-3 pb-2.5">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 shadow-inner ring-1 ring-white/25">
            <mat-icon class="text-white" style="font-size:19px;width:19px;height:19px;">inventory_2</mat-icon>
          </span>
          <div class="min-w-0">
            <h1 class="text-[15px] font-black tracking-tight">{{ prefs.txt("সব পণ্য", "All Products") }}</h1>
            <p class="truncate text-[9.5px] font-bold uppercase tracking-[0.08em] text-teal-50/75">{{ prefs.txt("স্টক, মূল্য ও শ্রেণিবিন্যাসসহ পণ্য তালিকা", "Stock, pricing & classification") }}</p>
          </div>

          <div class="ml-auto flex shrink-0 items-center gap-1.5">
            <button (click)="exportExcel()" class="inline-flex items-center gap-1 rounded-lg border border-white/25 bg-white/10 px-2.5 py-1.5 text-[10.5px] font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/20 cursor-pointer">
              <mat-icon style="font-size:14px;width:14px;height:14px;">file_download</mat-icon>
              <span class="hidden sm:inline">{{ prefs.txt("এক্সেল এক্সপোর্ট", "Export Excel") }}</span>
            </button>
            <button (click)="openAddModal()" class="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[10.5px] font-black text-teal-800 shadow-lg shadow-teal-950/20 transition-transform active:scale-95 cursor-pointer">
              <mat-icon style="font-size:15px;width:15px;height:15px;">add_circle</mat-icon>
              {{ prefs.txt("নতুন পণ্য যোগ করুন", "Add New Product") }}
            </button>
          </div>
        </div>

        <div class="relative grid grid-cols-2 gap-1.5 px-3.5 pb-3 lg:grid-cols-4">
          <div class="flex items-center gap-2 rounded-xl bg-white/10 px-2.5 py-1.5 ring-1 ring-white/15 backdrop-blur-sm">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/15">
              <mat-icon style="font-size:15px;width:15px;height:15px;">inventory</mat-icon>
            </span>
            <span class="min-w-0 leading-tight">
              <span class="block text-[8.5px] font-black uppercase tracking-[0.1em] text-teal-50/70">{{ prefs.txt("মোট", "Total") }}</span>
              <span class="block truncate font-mono text-[15px] font-black">{{ totalProducts() }}</span>
            </span>
          </div>
          <div class="flex items-center gap-2 rounded-xl bg-white/10 px-2.5 py-1.5 ring-1 ring-white/15 backdrop-blur-sm">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/15">
              <mat-icon style="font-size:15px;width:15px;height:15px;">payments</mat-icon>
            </span>
            <span class="min-w-0 leading-tight">
              <span class="block text-[8.5px] font-black uppercase tracking-[0.1em] text-teal-50/70">{{ prefs.txt("স্টক ভ্যালু", "Stock Value") }}</span>
              <span class="block truncate font-mono text-[15px] font-black">৳ {{ stockValue() | number:'1.0-0' }}</span>
            </span>
          </div>
          <div class="flex items-center gap-2 rounded-xl bg-amber-300/15 px-2.5 py-1.5 ring-1 ring-amber-200/30 backdrop-blur-sm">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-300/20 text-amber-100">
              <mat-icon style="font-size:15px;width:15px;height:15px;">warning</mat-icon>
            </span>
            <span class="min-w-0 leading-tight">
              <span class="block text-[8.5px] font-black uppercase tracking-[0.1em] text-amber-100/80">{{ prefs.txt("স্টক কম", "Low Stock") }}</span>
              <span class="block truncate font-mono text-[15px] font-black text-amber-50">{{ lowStockCount() }}</span>
            </span>
          </div>
          <div class="flex items-center gap-2 rounded-xl bg-rose-400/15 px-2.5 py-1.5 ring-1 ring-rose-200/30 backdrop-blur-sm">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-rose-300/20 text-rose-100">
              <mat-icon style="font-size:15px;width:15px;height:15px;">production_quantity_limits</mat-icon>
            </span>
            <span class="min-w-0 leading-tight">
              <span class="block text-[8.5px] font-black uppercase tracking-[0.1em] text-rose-100/80">{{ prefs.txt("স্টক নেই", "Out of Stock") }}</span>
              <span class="block truncate font-mono text-[15px] font-black text-rose-50">{{ outOfStockCount() }}</span>
            </span>
          </div>
        </div>
      </div>

      <!-- Control Bar -->
      <div class="overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div class="flex flex-wrap items-center gap-2 p-2.5">

          <!-- Type Tabs -->
          <div class="inline-flex shrink-0 items-center gap-0.5 rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/70 dark:bg-slate-800/70 dark:ring-slate-700">
            <button
              (click)="setTab('all')"
              [class]="activeTab() === 'all' ? 'bg-white text-teal-700 shadow-sm ring-1 ring-teal-100 dark:bg-slate-900 dark:text-teal-300 dark:ring-teal-800' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900/60'"
              class="rounded-lg px-2.5 py-1.5 text-[10.5px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
            >
              <mat-icon class="text-sm">inventory</mat-icon>
              <span class="hidden sm:inline">{{ prefs.txt("সব", "All") }}</span>
              <span class="font-mono text-[10px] px-1.5 py-0.5 rounded-md" [class]="activeTab() === 'all' ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'bg-white/80 text-slate-500 dark:bg-slate-900/60 dark:text-slate-400'">{{ allCount() }}</span>
            </button>
            <button
              (click)="setTab('single')"
              [class]="activeTab() === 'single' ? 'bg-white text-teal-700 shadow-sm ring-1 ring-teal-100 dark:bg-slate-900 dark:text-teal-300 dark:ring-teal-800' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900/60'"
              class="rounded-lg px-2.5 py-1.5 text-[10.5px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
            >
              <mat-icon class="text-sm">inventory_2</mat-icon>
              <span class="hidden sm:inline">{{ prefs.txt("সিঙ্গেল", "Single") }}</span>
              <span class="font-mono text-[10px] px-1.5 py-0.5 rounded-md" [class]="activeTab() === 'single' ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'bg-white/80 text-slate-500 dark:bg-slate-900/60 dark:text-slate-400'">{{ singleCount() }}</span>
            </button>
            <button
              (click)="setTab('variant')"
              [class]="activeTab() === 'variant' ? 'bg-white text-teal-700 shadow-sm ring-1 ring-teal-100 dark:bg-slate-900 dark:text-teal-300 dark:ring-teal-800' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900/60'"
              class="rounded-lg px-2.5 py-1.5 text-[10.5px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
            >
              <mat-icon class="text-sm">dashboard_customize</mat-icon>
              <span class="hidden sm:inline">{{ prefs.txt("ভ্যারিয়েন্ট", "Variant") }}</span>
              <span class="font-mono text-[10px] px-1.5 py-0.5 rounded-md" [class]="activeTab() === 'variant' ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'bg-white/80 text-slate-500 dark:bg-slate-900/60 dark:text-slate-400'">{{ variantCount() }}</span>
            </button>
            <button
              (click)="setTab('service')"
              [class]="activeTab() === 'service' ? 'bg-white text-teal-700 shadow-sm ring-1 ring-teal-100 dark:bg-slate-900 dark:text-teal-300 dark:ring-teal-800' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900/60'"
              class="rounded-lg px-2.5 py-1.5 text-[10.5px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
            >
              <mat-icon class="text-sm">handyman</mat-icon>
              <span class="hidden sm:inline">{{ prefs.txt("সার্ভিস", "Service") }}</span>
              <span class="font-mono text-[10px] px-1.5 py-0.5 rounded-md" [class]="activeTab() === 'service' ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'bg-white/80 text-slate-500 dark:bg-slate-900/60 dark:text-slate-400'">{{ serviceCount() }}</span>
            </button>
          </div>

          <!-- Filters -->
          <div class="order-last flex w-full flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700" [title]="prefs.txt('ফিল্টার', 'Filter')"><mat-icon style="font-size:16px;width:16px;height:16px;">filter_alt</mat-icon></span>
            <select #brandFilter (change)="selectedBrand.set(brandFilter.value); resetPage()" [value]="selectedBrand()" class="h-8 w-[108px] rounded-lg border border-slate-200 bg-white px-2 text-[10.5px] font-semibold text-slate-600 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/15 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <option value="">{{ prefs.txt("সব ব্র্যান্ড", "All Brands") }}</option>
              @for (b of dataService.brands(); track b.id) {
                <option [value]="b.name">{{ b.name }}</option>
              }
            </select>
            <select #modelFilter (change)="selectedModel.set(modelFilter.value); resetPage()" [value]="selectedModel()" class="h-8 w-[108px] rounded-lg border border-slate-200 bg-white px-2 text-[10.5px] font-semibold text-slate-600 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/15 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <option value="">{{ prefs.txt("সব মডেল", "All Models") }}</option>
              @for (m of dataService.productModels(); track m.id) {
                <option [value]="m.name">{{ m.name }}</option>
              }
            </select>
            <select #categoryFilter (change)="selectedCategory.set(categoryFilter.value); resetPage()" [value]="selectedCategory()" [title]="prefs.txt('ক্যাটাগরি বা সাব ক্যাটাগরি বেছে ফিল্টার করুন', 'Filter by category or sub category')" class="h-8 w-[150px] rounded-lg border border-slate-200 bg-white px-2 text-[10.5px] font-semibold text-slate-600 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/15 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <option value="">{{ prefs.txt("সব ক্যাটাগরি", "All Categories") }}</option>
              @for (c of categoryFilterTree(); track c.id) {
                <optgroup [label]="c.name">
                  <option [value]="'c:' + c.id">{{ c.name }} · {{ prefs.txt("সব", "All") }}</option>
                  @for (sc of c.subs; track sc.id) {
                    <option [value]="'s:' + sc.id">{{ sc.name }}</option>
                  }
                </optgroup>
              }
            </select>

            <!-- Stock filter: buckets + exact quantity range -->
            <div class="relative" data-stock-filter-root>
              <button
                (click)="showStockFilter.set(!showStockFilter())"
                [class]="stockFilterActive() ? 'border-teal-400 bg-teal-50 text-teal-700 ring-1 ring-teal-200 dark:border-teal-600 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'"
                class="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[10.5px] font-semibold whitespace-nowrap transition-colors cursor-pointer focus:outline-none"
                [title]="prefs.txt('স্টক অনুযায়ী ফিল্টার করুন', 'Filter by stock on hand')"
              >
                <mat-icon class="text-sm">inventory_2</mat-icon>
                {{ stockFilterLabel() }}
                <mat-icon class="text-xs">expand_more</mat-icon>
              </button>

              @if (showStockFilter()) {
                <div class="absolute right-0 z-50 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl text-slate-800">
                  <p class="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <mat-icon class="text-xs text-teal-600">inventory_2</mat-icon>
                    {{ prefs.txt("স্টক ফিল্টার", "Stock filter") }}
                  </p>

                  <div class="grid grid-cols-2 gap-1.5">
                    @for (opt of stockQuickOptions; track opt.mode) {
                      <button (click)="applyStockMode(opt.mode)"
                        [class]="stockMode() === opt.mode ? 'bg-teal-600 text-white border-teal-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'"
                        class="rounded-lg border px-2 py-1.5 text-[10.5px] font-bold transition-colors cursor-pointer">
                        {{ prefs.txt(opt.bn, opt.en) }}
                      </button>
                    }
                  </div>

                  <div class="mt-2.5 border-t border-slate-100 pt-2">
                    <p class="mb-1 text-[9.5px] font-bold uppercase tracking-wider text-slate-400">{{ prefs.txt("নির্দিষ্ট পরিমাণ", "Exact quantity") }}</p>
                    <div class="flex items-center gap-1.5">
                      <input type="number" min="0" [value]="stockMinInput()" (input)="onStockMinInput($event)" [placeholder]="prefs.txt('সর্বনিম্ন', 'min')"
                        class="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] font-bold focus:border-teal-400 focus:bg-white focus:outline-none" />
                      <span class="text-slate-400">–</span>
                      <input type="number" min="0" [value]="stockMaxInput()" (input)="onStockMaxInput($event)" [placeholder]="prefs.txt('সর্বোচ্চ', 'max')"
                        class="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] font-bold focus:border-teal-400 focus:bg-white focus:outline-none" />
                    </div>
                    <button (click)="applyStockRange()" class="mt-1.5 w-full rounded-lg bg-slate-900 px-2 py-1.5 text-[10.5px] font-bold text-white transition-colors hover:bg-slate-800 cursor-pointer">
                      {{ prefs.txt("এই পরিমাণে দেখান", "Filter this quantity") }}
                    </button>
                  </div>

                  @if (stockFilterActive()) {
                    <button (click)="clearStockFilter()" class="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10.5px] font-bold text-rose-600 transition-colors hover:bg-rose-100 cursor-pointer">
                      <mat-icon class="text-xs">filter_alt_off</mat-icon> {{ prefs.txt("স্টক ফিল্টার মুছুন", "Clear stock filter") }}
                    </button>
                  }
                </div>
              }
            </div>
            @if (activeFilters() > 0) {
              <button (click)="clearFilters()" class="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-2 text-[10px] font-bold text-rose-600 transition-colors hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 cursor-pointer">
                <mat-icon class="text-xs">filter_alt_off</mat-icon> {{ prefs.txt("মুছুন", "Clear") }} ({{ activeFilters() }})
              </button>
            }

            <!-- Search -->
            <div class="relative ml-auto w-full sm:w-60 lg:w-72">
              <mat-icon class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" style="font-size:16px;width:16px;height:16px;">search</mat-icon>
              <input
                type="text"
                [placeholder]="prefs.txt('নাম, কোড, ব্র্যান্ড বা মডেল…', 'Search name, code, brand or model…')"
                [title]="prefs.txt('নাম, কোড, ব্র্যান্ড, মডেল বা ভ্যারিয়েন্ট লিখুন — একাধিক শব্দ / সামান্য বানান ভুলও চলবে', 'Search name, code, brand, model or variant; multiple words and small typos work')"
                [value]="searchQuery()"
                (input)="onSearchInput($event)"
                class="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-14 text-[11.5px] font-medium text-slate-700 transition-colors placeholder:text-slate-400 focus:border-teal-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
              @if (searchQuery()) {
                <button (click)="searchQuery.set('')" class="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 cursor-pointer" [title]="prefs.txt('সার্চ মুছুন', 'Clear search')">
                  <mat-icon style="font-size:15px;width:15px;height:15px;">close</mat-icon>
                </button>
              } @else {
                <span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-white px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700">{{ totalRows() }} {{ prefs.txt("টি", "items") }}</span>
              }
            </div>
          </div>

          <div class="ml-auto flex flex-wrap items-center gap-1.5 shrink-0">
            <!-- List / Grid View Toggle -->
            <div class="flex items-center rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200/70 dark:bg-slate-800/70 dark:ring-slate-700" role="group" [attr.aria-label]="prefs.txt('ভিউ মোড', 'View mode')">
              <button
                (click)="viewMode.set('list')"
                [class]="viewMode() === 'list' ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-900 dark:text-teal-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'"
                class="px-2 py-1.5 rounded-md flex items-center gap-1 text-[11px] font-bold transition-colors cursor-pointer"
                [title]="prefs.txt('তালিকা ভিউ', 'List view')"
              >
                <mat-icon class="text-sm">view_list</mat-icon>
                <span class="hidden sm:inline">{{ prefs.txt("তালিকা", "List") }}</span>
              </button>
              <button
                (click)="viewMode.set('grid')"
                [class]="viewMode() === 'grid' ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-900 dark:text-teal-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'"
                class="px-2 py-1.5 rounded-md flex items-center gap-1 text-[11px] font-bold transition-colors cursor-pointer"
                [title]="prefs.txt('গ্রিড ভিউ', 'Grid view')"
              >
                <mat-icon class="text-sm">grid_view</mat-icon>
                <span class="hidden sm:inline">{{ prefs.txt("গ্রিড", "Grid") }}</span>
              </button>
            </div>

            @if (viewMode() === 'list') {
            <!-- Column Visibility Selector -->
            <div class="relative">
              <button (click)="toggleColumnSelector()" class="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[10.5px] font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer">
                <mat-icon class="text-sm text-teal-600">view_column</mat-icon> <span class="hidden 2xl:inline">{{ prefs.txt("কলাম", "Columns") }}</span>
                <mat-icon class="text-xs">expand_more</mat-icon>
              </button>

              @if (showColumnSelector()) {
                <div class="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-2xl p-3 z-50 text-slate-800">
                  <div class="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                    <span class="font-bold text-xs text-slate-900 flex items-center gap-1">
                      <mat-icon class="text-xs text-teal-600">tune</mat-icon> {{ prefs.txt("টেবিলের কলাম টগল করুন", "Toggle Table Columns") }}
                    </span>
                    <button (click)="showColumnSelector.set(false)" class="text-slate-400 hover:text-slate-700 cursor-pointer">
                      <mat-icon class="text-sm">close</mat-icon>
                    </button>
                  </div>

                  <div class="space-y-1.5 max-h-64 overflow-y-auto pr-1 text-xs">
                    @for (c of allColumns(); track c.key) {
                      <label class="flex items-center gap-2 p-1 hover:bg-slate-50 rounded cursor-pointer font-semibold">
                        <input type="checkbox" [checked]="c.visible" (change)="toggleColumn(c.key)" class="accent-teal-600">
                        <span class="flex-1 truncate">{{ colLabel(c.key) }}</span>
                        <span class="font-mono text-[9.5px] text-slate-400 tabular-nums">{{ c.width }}px</span>
                      </label>
                    }
                  </div>

                  <div class="mt-2 flex items-start gap-1.5 rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5 text-[9.5px] font-medium leading-snug text-slate-500">
                    <mat-icon class="text-xs text-teal-500 shrink-0">drag_indicator</mat-icon>
                    <span>{{ prefs.txt('কলামের হেডার টেনে ক্রম বদলান, ডান প্রান্ত টেনে চওড়া বদলান।', 'Drag a header to reorder it; drag its right edge to resize.') }}</span>
                  </div>

                  <div class="border-t border-slate-100 pt-2 mt-2 flex justify-between">
                    <button (click)="selectAllColumns()" class="text-teal-600 hover:text-teal-800 text-[10px] font-bold cursor-pointer">{{ prefs.txt("সব নির্বাচন করুন", "Select All") }}</button>
                    <button (click)="resetColumns()" class="text-rose-600 hover:text-rose-800 text-[10px] font-bold cursor-pointer">{{ prefs.txt("ডিফল্ট রিসেট", "Reset Default") }}</button>
                  </div>
                </div>
              }
            </div>
            }

            <!-- Import Excel File Button -->
            <label
              class="flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[10.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              [class.opacity-60]="importing()"
              [class.pointer-events-none]="importing()"
              [title]="prefs.txt('এক্সেল ইমপোর্ট', 'Import Excel')">
              <mat-icon class="text-sm text-teal-600" [class.animate-spin]="importing()">{{ importing() ? 'progress_activity' : 'upload_file' }}</mat-icon>
              <span class="hidden 2xl:inline">{{ importing() ? prefs.txt('ইমপোর্ট হচ্ছে…', 'Importing…') : prefs.txt('ইমপোর্ট', 'Import') }}</span>
              <input type="file" accept=".xlsx,.csv" (change)="onFileImport($event)" [disabled]="importing()" class="hidden">
            </label>
          </div>
        </div>

        @if (otherTabHits().length) {
          <div class="border-t border-slate-100 px-2.5 py-2 dark:border-slate-800">
            <div class="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[10.5px] font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <mat-icon class="text-sm text-amber-500">alt_route</mat-icon>
              <span>{{ prefs.txt("এই লেখা অন্য ট্যাবেও ম্যাচ করেছে:", "This text also matched in another tab:") }}</span>
              @for (hit of otherTabHits(); track hit.type) {
                <button (click)="setTab(hit.type)" class="inline-flex items-center gap-1 rounded-md bg-white border border-amber-300 px-1.5 py-0.5 hover:bg-amber-100 cursor-pointer transition-colors dark:bg-slate-900 dark:border-amber-500/30">
                  <span class="capitalize">{{ hit.type }}</span>
                  <span class="font-mono text-[9.5px] font-bold text-amber-700 dark:text-amber-300">{{ hit.count }}</span>
                </button>
              }
            </div>
          </div>
        }
      </div>

      @if (selectedCount() > 0) {
        <div class="flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-white p-2.5 text-xs font-bold shadow-xs dark:border-teal-800 dark:bg-slate-900">
          <span class="flex items-center gap-1.5 text-teal-700">
            <mat-icon class="text-sm">task_alt</mat-icon> {{ selectedCount() }} {{ prefs.txt("টি নির্বাচিত", "selected") }}
          </span>
          <button (click)="exportSelected()" class="flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700">
            <mat-icon class="text-xs">file_download</mat-icon> {{ prefs.txt("নির্বাচিত এক্সেল", "Export selected") }}
          </button>
          <button (click)="deleteSelected()" class="flex cursor-pointer items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-white hover:bg-rose-700">
            <mat-icon class="text-xs">delete</mat-icon> {{ prefs.txt("নির্বাচিত ডিলিট", "Delete selected") }}
          </button>
          <button (click)="clearSelection()" class="flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <mat-icon class="text-xs">clear</mat-icon> {{ prefs.txt("মুছুন", "Clear") }}
          </button>
        </div>
      }

      <!-- List View: Products Table -->
      @if (viewMode() === 'list') {
      <div class="bg-white rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="products-table text-xs text-left border-collapse" [style.width.px]="tableWidthPx()" [style.minWidth.px]="tableWidthPx()">
            <colgroup>
              @for (c of visibleCols(); track c.key) {
                <col [attr.data-col]="c.key" [style.width.px]="c.width">
              }
            </colgroup>
            <thead>
              <tr class="bg-slate-50/70" cdkDropList orientation="horizontal" (cdkDropListDropped)="onColumnDrop($event)">
                @for (c of visibleCols(); track c.key) {
                  <th
                    class="col-head-cell relative px-3 py-2 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500 select-none"
                    [class.text-right]="c.align === 'right'"
                    [class.text-center]="c.align === 'center'"
                    cdkDrag
                    cdkDragLockAxis="x"
                  >
                    @if (c.key === 'sel') {
                      <input
                        type="checkbox"
                        class="size-3.5 cursor-pointer rounded accent-teal-600 align-middle"
                        [checked]="allSelected()"
                        [indeterminate]="someSelected()"
                        (change)="toggleAllRows()"
                        [title]="prefs.txt('এই পাতার সব সারি নির্বাচন করুন', 'Select every row on this page')"
                      >
                    } @else {
                      <div class="col-head-inner" cdkDragHandle [title]="prefs.txt('টেনে কলামের অবস্থান বদলান', 'Drag to reorder column') + ' · ' + colLabel(c.key)">
                        <mat-icon class="col-grip text-[13px]">drag_indicator</mat-icon>
                        <span class="col-label">{{ colLabel(c.key) }}</span>
                      </div>
                      <span
                        class="col-resizer"
                        [title]="prefs.txt('টেনে কলামের চওড়া বদলান', 'Drag to resize column')"
                        (mousedown)="startColumnResize($event, c.key)"
                        (click)="$event.stopPropagation()"
                      ></span>
                    }
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of pagedRows(); track row.key; let idx = $index) {
                @let p = row.display;
                <tr (click)="viewProduct(row.product)" class="group even:bg-slate-100/60 hover:bg-slate-200/60 dark:even:bg-slate-800/40 dark:hover:bg-slate-700/50 transition-colors cursor-pointer" [title]="prefs.txt('পণ্যের বিস্তারিত দেখতে ক্লিক করুন', 'Click to view product details')">
                  @for (c of visibleCols(); track c.key) {
                    @switch (c.key) {
                      @case ('sel') {
                        <td class="px-3 py-3 text-center align-middle" (click)="$event.stopPropagation()">
                          <input type="checkbox" class="size-3.5 cursor-pointer rounded accent-teal-600 align-middle" [checked]="isSelected(p.id)" (change)="toggleRow(p.id)">
                        </td>
                      }
                      @case ('sl') {
                        <td class="px-4 py-3 text-center align-middle">
                          <span class="font-mono text-[10.5px] font-semibold text-slate-500 tabular-nums">{{ (currentPage() - 1) * pageSize() + idx + 1 }}</span>
                        </td>
                      }
                      @case ('product') {
                        <td class="px-4 py-3 align-middle">
                          <div class="flex items-center gap-3">
                            <img [src]="p.image || noImage" alt="p" class="w-10 h-10 rounded-lg object-cover bg-slate-100 shrink-0" loading="lazy" decoding="async">
                            <div class="min-w-0">
                              <p [title]="hoverText(p)" class="min-w-0 font-semibold text-[12.5px] text-slate-800 leading-snug whitespace-normal break-words group-hover:text-teal-800 transition-colors">{{ p.name }}</p>
                              @if (p.variants?.length) {
                                <span class="mt-0.5 block text-[9.5px] font-semibold text-violet-600 dark:text-violet-300">{{ p.variants!.length }} {{ prefs.txt("ভ্যারিয়েন্ট", "variants") }}</span>
                              }
                            </div>
                          </div>
                        </td>
                      }
                      @case ('code') {
                        <td class="px-4 py-3 align-middle">
                          <span class="font-mono text-[10.5px] font-medium tracking-tight text-slate-500">{{ p.code }}</span>
                        </td>
                      }
                      @case ('rack') {
                        <td class="px-4 py-3 align-middle">
                          <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ p.rack }}</span>
                        </td>
                      }
                      @case ('type') {
                        <td class="px-4 py-3 align-middle">
                          <span class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] font-bold capitalize" [class]="typeBadgeClass(p.type)">
                            <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60"></span>{{ p.type }}
                          </span>
                        </td>
                      }
                      @case ('category') {
                        <td class="px-4 py-3 align-middle">
                          <span class="block text-[11px] font-semibold leading-tight text-slate-700">{{ p.category }}</span>
                          @if (p.subCategory) {
                            <span class="mt-0.5 block text-[9.5px] leading-tight text-slate-500">{{ p.subCategory }}</span>
                          }
                        </td>
                      }
                      @case ('brand') {
                        <td class="px-4 py-3 align-middle">
                          <span class="text-[11px] font-medium text-slate-600">{{ p.brand }}</span>
                        </td>
                      }
                      @case ('model') {
                        <td class="px-4 py-3 align-middle">
                          <span class="font-mono text-[10px] tracking-tight text-slate-500">{{ p.model }}</span>
                        </td>
                      }
                      @case ('stock') {
                        <td class="px-4 py-3 text-right align-middle">
                          <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold" [class]="stockBadgeClass(p.stock)">
                            <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60"></span>{{ p.stock }} {{ p.unit }}
                          </span>
                        </td>
                      }
                      @case ('sales') {
                        <td class="px-4 py-3 text-right align-middle whitespace-nowrap">
                          <span class="font-mono text-[11px] font-bold tabular-nums text-teal-700 dark:text-teal-400">{{ priceText(p, 'salesPrice') }}</span>
                        </td>
                      }
                      @case ('purchase') {
                        <td class="px-4 py-3 text-right align-middle whitespace-nowrap">
                          <span class="font-mono text-[10.5px] font-semibold tabular-nums text-slate-600">{{ priceText(p, 'purchasePrice') }}</span>
                        </td>
                      }
                      @case ('wholesale') {
                        <td class="px-4 py-3 text-right align-middle whitespace-nowrap">
                          <span class="font-mono text-[10.5px] font-semibold tabular-nums text-slate-500">{{ priceText(p, 'wholesalePrice') }}</span>
                        </td>
                      }
                      @case ('unit') {
                        <td class="px-4 py-3 text-center align-middle">
                          <span class="text-[9.5px] font-bold uppercase tracking-wide text-slate-500">{{ p.unit }}</span>
                        </td>
                      }
                      @case ('action') {
                        <td class="px-3 py-3 align-middle" (click)="$event.stopPropagation()">
                          <div class="flex items-center justify-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button (click)="viewProduct(row.product)" class="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-teal-700 hover:bg-teal-50 cursor-pointer transition-colors" [title]="prefs.txt('বিস্তারিত দেখুন', 'View Details')">
                              <mat-icon class="text-sm">visibility</mat-icon>
                            </button>
                            <button (click)="openEditModal(row.product)" class="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 cursor-pointer transition-colors" [title]="prefs.txt('পণ্য এডিট', 'Edit Product')">
                              <mat-icon class="text-sm">edit</mat-icon>
                            </button>
                            <button (click)="cloneProduct(row.product)" class="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 cursor-pointer transition-colors" [title]="prefs.txt('ক্লোন / ডুপ্লিকেট', 'Clone / Duplicate Product')">
                              <mat-icon class="text-sm">content_copy</mat-icon>
                            </button>
                            <button (click)="deleteProduct(row.product.id)" class="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer transition-colors" [title]="prefs.txt('পণ্য ডিলিট', 'Delete Product')">
                              <mat-icon class="text-sm">delete</mat-icon>
                            </button>
                          </div>
                        </td>
                      }
                    }
                  }
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="visibleCols().length" class="px-4 py-14 text-center">
                    <div class="flex flex-col items-center gap-2">
                      <span class="w-12 h-12 rounded-full bg-slate-50 ring-1 ring-slate-200 inline-flex items-center justify-center">
                        <mat-icon class="text-2xl text-slate-300">inventory_2</mat-icon>
                      </span>
                      <p class="text-[12px] font-semibold text-slate-500">{{ prefs.txt("কোনো পণ্য পাওয়া যায়নি", "No products found") }}</p>
                      <p class="text-[10px] text-slate-400">{{ prefs.txt("সার্চ বা ফিল্টার বদলে দেখুন।", "Try adjusting your search or filters.") }}</p>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (totalRows()) {
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-white">
          <div class="flex items-center gap-2.5 text-[10px] font-semibold text-slate-500">
            <span class="text-[9.5px] font-bold uppercase tracking-[0.1em] text-slate-500">{{ prefs.txt("প্রতি পেজে", "Rows per page") }}</span>
            <select [value]="pageSize()" (change)="setPageSize($event)" class="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-[10px] font-bold text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 cursor-pointer">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="40">40</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
              <option value="0">{{ prefs.txt("সব", "All") }}</option>
            </select>
            <span class="hidden md:inline text-slate-200">|</span>
            <span class="hidden md:inline text-slate-500">{{ prefs.txt("পেজ", "Page") }} <span class="font-mono font-bold text-slate-600">{{ currentPage() }}</span> {{ prefs.txt("/", "of") }} <span class="font-mono font-bold text-slate-600">{{ totalPages() }}</span></span>
          </div>

          <div class="flex items-center gap-1">
            <button (click)="goToPage(currentPage() - 1, $event)" [disabled]="currentPage() === 1" class="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-teal-700 dark:hover:text-teal-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors" [title]="prefs.txt('আগের পেজ', 'Previous page')">
              <mat-icon class="text-base">chevron_left</mat-icon>
            </button>
            @for (n of pageNumbers(); track n) {
              <button (click)="goToPage(n, $event)" class="h-8 min-w-8 px-2 rounded-lg text-[11px] font-bold tabular-nums transition-colors cursor-pointer" [class]="n === currentPage() ? 'bg-teal-700 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'">{{ n }}</button>
            }
            <button (click)="goToPage(currentPage() + 1, $event)" [disabled]="currentPage() === totalPages()" class="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-teal-700 dark:hover:text-teal-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors" [title]="prefs.txt('পরের পেজ', 'Next page')">
              <mat-icon class="text-base">chevron_right</mat-icon>
            </button>
          </div>
        </div>
        }
      </div>
      } @else {
      <!-- Grid View: Product Cards -->
      <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-3 bg-slate-50/50 dark:bg-slate-950/30">
        @for (row of pagedRows(); track row.key) {
          @let p = row.display;
          <div (click)="viewProduct(row.product)" class="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs transition-all hover:-translate-y-0.5 hover:border-teal-400 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-600 dark:hover:shadow-black/40">

            <!-- Photo banner -->
            <div class="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-950">
              <img [src]="p.image || noImage" [alt]="p.name" class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" loading="lazy" decoding="async">
              <label class="absolute left-2 top-2 grid size-6 cursor-pointer place-items-center rounded-lg bg-white/90 shadow-sm ring-1 ring-slate-900/10 backdrop-blur-sm dark:bg-slate-950/75 dark:ring-white/15" (click)="$event.stopPropagation()" [title]="prefs.txt('পণ্যটি নির্বাচন করুন', 'Select this product')">
                <input type="checkbox" class="size-3.5 cursor-pointer rounded accent-teal-600" [checked]="isSelected(p.id)" (change)="toggleRow(p.id)">
              </label>
              <span class="absolute right-2 top-2 rounded-full border px-2 py-0.5 text-[9.5px] font-bold capitalize backdrop-blur-sm" [class]="typeBadgeClass(p.type)">{{ p.type }}</span>
              <span class="absolute bottom-2 left-2 rounded-md bg-slate-950/55 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-white backdrop-blur-sm">{{ p.code }}</span>
              <span class="absolute bottom-2 right-2 rounded-md border px-1.5 py-0.5 font-mono text-[9.5px] font-bold" [class]="stockBadgeClass(p.stock)">{{ p.stock }} {{ p.unit }}</span>
            </div>

            <div class="flex flex-1 flex-col gap-2 p-3">
              <h3 [title]="hoverText(p)" class="line-clamp-2 text-[13px] font-bold leading-snug text-slate-800 dark:text-slate-100 group-hover:text-teal-800 dark:group-hover:text-teal-300">{{ p.name }}</h3>

              <div class="flex flex-wrap gap-1">
                <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{{ p.category }}</span>
                @if (p.variants?.length) {
                  <span class="rounded-md bg-violet-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30">{{ p.variants!.length }} {{ prefs.txt('ভ্যারিয়েন্ট', 'variants') }}</span>
                }
                @if (p.subCategory) {
                  <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ p.subCategory }}</span>
                }
                @if (p.brand && p.brand !== '-') {
                  <span class="rounded-md bg-sky-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30">{{ p.brand }}</span>
                }
              </div>

              <div class="mt-auto grid grid-cols-2 gap-1.5">
                <div class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700/70 dark:bg-slate-800/50">
                  <span class="block text-[9px] uppercase font-bold tracking-wide text-slate-400 dark:text-slate-500">{{ prefs.txt('স্টক', 'Stock') }}</span>
                  <span class="block font-mono font-bold text-[11px] mt-0.5" [class]="stockTextClass(p.stock)">{{ p.stock }} {{ p.unit }}</span>
                </div>
                <div class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700/70 dark:bg-slate-800/50">
                  <span class="block text-[9px] uppercase font-bold tracking-wide text-slate-400 dark:text-slate-500">{{ prefs.txt('ক্রয়', 'Purchase') }}</span>
                  <span class="block font-mono font-bold text-[11px] leading-tight text-slate-700 mt-0.5 dark:text-slate-200">{{ priceText(p, 'purchasePrice') }}</span>
                </div>
                <div class="rounded-lg bg-teal-50/80 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30 px-2 py-1.5">
                  <span class="block text-[9px] uppercase font-bold tracking-wide text-teal-600/80 dark:text-teal-400/90">{{ prefs.txt('বিক্রয় মূল্য', 'Sales Rate') }}</span>
                  <span class="block font-mono font-bold text-[11.5px] leading-tight text-teal-700 dark:text-teal-300 mt-0.5">{{ priceText(p, 'salesPrice') }}</span>
                </div>
                <div class="rounded-lg bg-sky-50/80 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 px-2 py-1.5">
                  <span class="block text-[9px] uppercase font-bold tracking-wide text-sky-600/80 dark:text-sky-400/90">{{ prefs.txt('পাইকারি মূল্য', 'Wholesale Rate') }}</span>
                  <span class="block font-mono font-bold text-[11.5px] leading-tight text-sky-700 dark:text-sky-300 mt-0.5">{{ priceText(p, 'wholesalePrice') }}</span>
                </div>
              </div>

              <div class="flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                <span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 inline-flex items-center gap-1">
                  <mat-icon style="font-size:13px;width:13px;height:13px;">grid_on</mat-icon> {{ p.rack || '—' }}
                </span>
                <div class="flex items-center gap-0.5" (click)="$event.stopPropagation()">
                  <button (click)="viewProduct(row.product)" class="w-7 h-7 inline-flex items-center justify-center text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-500/20 rounded-md cursor-pointer transition-colors" [title]="prefs.txt('বিস্তারিত দেখুন', 'View Details')">
                    <mat-icon class="text-sm">visibility</mat-icon>
                  </button>
                  <button (click)="openEditModal(row.product)" class="w-7 h-7 inline-flex items-center justify-center text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded-md cursor-pointer transition-colors" [title]="prefs.txt('পণ্য এডিট', 'Edit Product')">
                    <mat-icon class="text-sm">edit</mat-icon>
                  </button>
                  <button (click)="cloneProduct(row.product)" class="w-7 h-7 inline-flex items-center justify-center text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 rounded-md cursor-pointer transition-colors" [title]="prefs.txt('ক্লোন / ডুপ্লিকেট', 'Clone / Duplicate Product')">
                    <mat-icon class="text-sm">content_copy</mat-icon>
                  </button>
                  <button (click)="deleteProduct(row.product.id)" class="w-7 h-7 inline-flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 rounded-md cursor-pointer transition-colors" [title]="prefs.txt('পণ্য ডিলিট', 'Delete Product')">
                    <mat-icon class="text-sm">delete</mat-icon>
                  </button>
                </div>
              </div>
            </div>
          </div>
        } @empty {
          <div class="col-span-full bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-10 text-center text-slate-400 dark:text-slate-500">
            <mat-icon class="text-3xl text-slate-300 dark:text-slate-600">inventory_2</mat-icon>
            <p class="font-medium mt-1">{{ prefs.txt("এই ফিল্টারে কোনো পণ্য পাওয়া যায়নি।", "No products found matching filters.") }}</p>
          </div>
        }
        </div>

        @if (totalRows()) {
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div class="flex items-center gap-2.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            <span class="text-[9.5px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{{ prefs.txt("প্রতি পেজে", "Rows per page") }}</span>
            <select [value]="pageSize()" (change)="setPageSize($event)" class="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5 bg-white dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 cursor-pointer">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="40">40</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
              <option value="0">{{ prefs.txt("সব", "All") }}</option>
            </select>
            <span class="hidden md:inline text-slate-200 dark:text-slate-700">|</span>
            <span class="hidden md:inline text-slate-500 dark:text-slate-400">{{ prefs.txt("পেজ", "Page") }} <span class="font-mono font-bold text-slate-600 dark:text-slate-200">{{ currentPage() }}</span> {{ prefs.txt("/", "of") }} <span class="font-mono font-bold text-slate-600 dark:text-slate-200">{{ totalPages() }}</span></span>
          </div>

          <div class="flex items-center gap-1">
            <button (click)="goToPage(currentPage() - 1, $event)" [disabled]="currentPage() === 1" class="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-teal-700 dark:hover:text-teal-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors" [title]="prefs.txt('আগের পেজ', 'Previous page')">
              <mat-icon class="text-base">chevron_left</mat-icon>
            </button>
            @for (n of pageNumbers(); track n) {
              <button (click)="goToPage(n, $event)" class="h-8 min-w-8 px-2 rounded-lg text-[11px] font-bold tabular-nums transition-colors cursor-pointer" [class]="n === currentPage() ? 'bg-teal-700 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'">{{ n }}</button>
            }
            <button (click)="goToPage(currentPage() + 1, $event)" [disabled]="currentPage() === totalPages()" class="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-teal-700 dark:hover:text-teal-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors" [title]="prefs.txt('পরের পেজ', 'Next page')">
              <mat-icon class="text-base">chevron_right</mat-icon>
            </button>
          </div>
        </div>
        }
      </div>
      }

    </div>

    <!-- Slide-Over Drawer: Add / Edit Product matching Add Product.png -->
    @if (showAddModal()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end">
        <div class="bg-white w-full max-w-3xl sm:max-w-4xl h-full shadow-2xl flex flex-col overflow-hidden text-slate-800 animate-in slide-in-from-right duration-300">
          
          <!-- Drawer Header -->
          <div class="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20">
            <button (click)="requestCloseForm()" class="text-slate-700 hover:text-slate-900 font-bold text-base flex items-center gap-2 cursor-pointer transition-colors">
              <mat-icon class="text-slate-500">close</mat-icon>
              {{ isEditMode() ? prefs.txt("পণ্য এডিট", "Edit Product") : prefs.txt("নতুন পণ্য যোগ করুন", "Add New Product") }}
            </button>
            <button (click)="requestCloseForm()" class="text-slate-400 hover:text-slate-600 cursor-pointer" [title]="prefs.txt('বন্ধ', 'Close')">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          <!-- Drawer Form Body -->
          <div class="p-6 overflow-y-auto flex-1 space-y-4 text-xs font-sans text-slate-700 bg-white" (input)="onFormActivity()" (change)="onFormActivity()">
            
            @if (formError()) {
              <div class="sticky top-0 z-20 flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700 shadow-xs">
                <mat-icon class="text-sm shrink-0">error_outline</mat-icon>
                <span>{{ formError() }}</span>
              </div>
            }


            <!-- Section: Basic information -->
            <div class="flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
              <mat-icon class="text-sm text-teal-600">inventory_2</mat-icon>
              <span class="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">{{ prefs.txt("মৌলিক তথ্য", "Basic Information") }}</span>
              <span class="ml-auto text-[10px] font-medium text-slate-400"><span class="text-rose-500">*</span> {{ prefs.txt("চিহ্নিত ঘর আবশ্যক", "marked fields are required") }}</span>
            </div>

            <!-- Row 1: Type & Warehouse -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div class="md:col-span-2">
                <label class="block font-medium mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("ধরন", "Type") }}</label>
                <div id="product-type" tabindex="-1" class="grid grid-cols-3 gap-2 outline-none">
                  @for (t of productTypeOptions; track t.value) {
                    <button type="button" (click)="setFormType(t.value)" [attr.aria-pressed]="formType === t.value"
                      class="flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-bold transition-all cursor-pointer active:scale-[0.98]"
                      [class]="formType === t.value ? 'border-teal-500 bg-teal-50 text-teal-700 ring-2 ring-teal-100' : 'border-slate-300 bg-white text-slate-600 hover:border-teal-400 hover:bg-teal-50/50'">
                      <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
                      <span class="truncate">{{ prefs.txt(t.bn, t.en) }}</span>
                    </button>
                  }
                </div>
                <p class="mt-1 text-[10px] text-slate-400">{{ prefs.txt("ডিফল্ট সিঙ্গেল; সাইজ/রং ভেদে আলাদা হলে ভ্যারিয়েন্ট বাছুন।", "Single by default; pick Variant when sizes or colours differ.") }}</p>
              </div>

              <div>
                <label class="block font-medium mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("ওয়্যারহাউস", "Warehouse") }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500" [class.invalid-field]="isInvalid('Warehouse')">
                  <mat-icon class="text-slate-400 text-sm mr-2">storefront</mat-icon>
                  <select id="product-warehouse" [(ngModel)]="formWarehouse" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    <option value="">{{ prefs.txt("ওয়্যারহাউস নির্বাচন করুন...", "Select Warehouse...") }}</option>
                    @for (w of dataService.warehouses(); track w) {
                      <option [value]="w">{{ w }}</option>
                    }
                  </select>
                </div>
              </div>
            </div>

            <!-- Row 2: Image & Name / Slug / Rack Number -->
            <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
              <!-- Image Upload Box -->
              <div class="md:col-span-3">
                <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("ইমেজ", "Image") }}</label>
                <div class="border-2 border-dashed border-slate-200 rounded-xl p-3 flex flex-col items-center justify-center h-28 cursor-pointer hover:border-teal-500 hover:bg-teal-50/30 transition-all text-slate-400 hover:text-teal-600 relative">
                  <input type="file" (change)="onImageSelect($event)" [accept]="imageAccept" class="absolute inset-0 opacity-0 cursor-pointer">
                  @if (formImagePreview()) {
                    <img [src]="formImagePreview()" [attr.alt]="prefs.txt('প্রিভিউ', 'Preview')" class="w-full h-full object-cover rounded-lg" loading="lazy" decoding="async">
                    <button type="button" (click)="$event.stopPropagation(); removeImage()" class="absolute top-1 right-1 z-20 w-5 h-5 inline-flex items-center justify-center rounded-full bg-slate-900/70 text-white hover:bg-rose-600 transition-colors cursor-pointer" [title]="prefs.txt('ছবি মুছুন', 'Remove image')">
                      <mat-icon class="text-[12px] w-[12px] h-[12px] leading-[12px]">close</mat-icon>
                    </button>
                  } @else {
                    <mat-icon class="text-2xl">add</mat-icon>
                    <span class="text-[11px] font-medium mt-1">{{ prefs.txt("আপলোড", "Upload") }}</span>
                  }
                </div>
                <p class="mt-1 text-[10px] text-slate-400">{{ prefs.txt("যেকোনো ছবি ফরম্যাট · সর্বোচ্চ 10 MB", "Any image format · max 10 MB") }}</p>
              </div>

              <!-- Name, Slug & Rack Number -->
              <div class="md:col-span-9 space-y-3">
                <div>
                  <label class="block font-medium mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("নাম", "Name") }}</label>
                  <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500" [class.invalid-field]="isInvalid('Name')">
                    <mat-icon class="text-slate-400 text-sm mr-2">person_outline</mat-icon>
                    <input id="product-name" type="text" autocomplete="off" [(ngModel)]="formName" (input)="onNameInput()" [placeholder]="prefs.txt('নাম লিখুন', 'Enter Name')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-900">
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="block font-medium mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("স্লাগ", "Slug") }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500" [class.invalid-field]="isInvalid('Slug')">
                      <mat-icon class="text-slate-400 text-sm mr-2">format_list_bulleted</mat-icon>
                      <input id="product-slug" type="text" autocomplete="off" [(ngModel)]="formSlug" (input)="onSlugInput()" (blur)="onSlugBlur()" [placeholder]="prefs.txt('স্লাগ লিখুন', 'Enter Slug')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                      <button type="button" (click)="regenerateSlug()" class="text-slate-400 hover:text-teal-600 px-1 cursor-pointer" [title]="prefs.txt('নাম থেকে নতুন করে তৈরি করুন', 'Regenerate from name')">
                        <mat-icon class="text-sm">refresh</mat-icon>
                      </button>
                    </div>
                    <p class="mt-1 text-[10px] text-slate-400">{{ prefs.txt("নাম থেকে স্বয়ংক্রিয়ভাবে তৈরি হয়েছে; আপনি এডিট করতে পারেন।", "Auto-generated from the name; you can edit it.") }}</p>
                  </div>

                  <div>
                    <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("র‍্যাক নম্বর", "Rack Number") }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <mat-icon class="text-slate-400 text-sm mr-2">grid_3x3</mat-icon>
                      <input type="text" [(ngModel)]="formRack" [placeholder]="prefs.txt('র‍্যাক নম্বর লিখুন', 'Enter Rack Number')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Row 3: Category & Sub Category -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="relative">
                <label class="block font-medium mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("ক্যাটাগরি", "Category") }}</label>
                <div class="flex items-center gap-1.5">
                  <button id="product-category" type="button" data-combo-root (click)="toggleCombo('category')" [attr.aria-expanded]="isComboOpen('category')" class="min-w-0 flex-1 flex items-center border rounded-lg px-2.5 py-1.5 bg-white cursor-pointer text-left transition-all" [class.border-slate-300]="!isComboOpen('category')" [class.border-teal-500]="isComboOpen('category')" [class.ring-2]="isComboOpen('category')" [class.ring-teal-500]="isComboOpen('category')" [class.invalid-field]="isInvalid('Category')">
                    <mat-icon class="text-slate-400 text-sm mr-2 shrink-0">folder_open</mat-icon>
                    <span class="flex-1 truncate text-xs font-medium" [class.text-slate-400]="!formCategory" [class.text-slate-800]="!!formCategory">{{ formCategory || prefs.txt("ক্যাটাগরি নির্বাচন করুন...", "Select Category...") }}</span>
                    <mat-icon class="text-slate-400 text-sm shrink-0 transition-transform duration-150" [class.rotate-180]="isComboOpen('category')">expand_more</mat-icon>
                  </button>
                  <button type="button" (click)="openQuickCategoryModal()" class="border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg p-1.5 transition-colors cursor-pointer" [title]="prefs.txt('নতুন ক্যাটাগরি যোগ করুন', 'Add New Category')">
                    <mat-icon class="text-sm">add</mat-icon>
                  </button>
                </div>
                @if (isComboOpen('category')) {
                  <div data-combo-root class="absolute left-0 right-0 top-full mt-1 z-30 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                    <div class="border-b border-slate-100 p-2">
                      <div class="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 focus-within:ring-2 focus-within:ring-teal-500">
                        <mat-icon class="text-slate-400 text-sm shrink-0">search</mat-icon>
                        <input id="combo-category-search" type="text" [value]="comboSearch().category" (input)="onComboSearch('category', $event)" (keydown.escape)="$event.stopPropagation(); closeCombo()" [placeholder]="prefs.txt('ক্যাটাগরি খুঁজুন...', 'Search category...')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                      </div>
                    </div>
                    <ul class="max-h-52 overflow-y-auto py-1">
                      <li>
                        <button type="button" (mousedown)="$event.preventDefault()" (click)="selectCombo('category', '')" class="w-full px-3 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50">{{ prefs.txt("ক্যাটাগরি নির্বাচন করুন...", "Select Category...") }}</button>
                      </li>
                      @for (c of filteredCategories(); track c.id) {
                        <li>
                          <button type="button" (mousedown)="$event.preventDefault()" (click)="selectCombo('category', c.name)" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-slate-50" [class]="formCategory === c.name ? 'bg-teal-50 text-teal-700' : 'text-slate-700'">
                            <span class="truncate">{{ c.name }}</span>
                            @if (formCategory === c.name) {
                              <mat-icon class="text-sm text-teal-600">check</mat-icon>
                            }
                          </button>
                        </li>
                      } @empty {
                        <li class="px-3 py-3 text-center text-[11px] font-medium text-slate-400">{{ prefs.txt("কোনো ক্যাটাগরি পাওয়া যায়নি", "No category found") }}</li>
                      }
                    </ul>
                  </div>
                }
              </div>

              <div class="relative">
                <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("সাব ক্যাটাগরি", "Sub Category") }}</label>
                <div class="flex items-center gap-1.5">
                  <button type="button" data-combo-root (click)="toggleCombo('subCategory')" [attr.aria-expanded]="isComboOpen('subCategory')" class="min-w-0 flex-1 flex items-center border rounded-lg px-2.5 py-1.5 bg-white cursor-pointer text-left transition-all" [class.border-slate-300]="!isComboOpen('subCategory')" [class.border-teal-500]="isComboOpen('subCategory')" [class.ring-2]="isComboOpen('subCategory')" [class.ring-teal-500]="isComboOpen('subCategory')">
                    <mat-icon class="text-slate-400 text-sm mr-2 shrink-0">folder_open</mat-icon>
                    <span class="flex-1 truncate text-xs font-medium" [class.text-slate-400]="!formSubCategory" [class.text-slate-800]="!!formSubCategory">{{ formSubCategory || prefs.txt("সাব ক্যাটাগরি নির্বাচন করুন...", "Select Sub Category...") }}</span>
                    <mat-icon class="text-slate-400 text-sm shrink-0 transition-transform duration-150" [class.rotate-180]="isComboOpen('subCategory')">expand_more</mat-icon>
                  </button>
                  <button type="button" (click)="openQuickSubCategoryModal()" class="border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg p-1.5 transition-colors cursor-pointer" [title]="prefs.txt('নতুন সাব ক্যাটাগরি যোগ করুন', 'Add New Sub Category')">
                    <mat-icon class="text-sm">add</mat-icon>
                  </button>
                </div>
                @if (isComboOpen('subCategory')) {
                  <div data-combo-root class="absolute left-0 right-0 top-full mt-1 z-30 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                    <div class="border-b border-slate-100 p-2">
                      <div class="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 focus-within:ring-2 focus-within:ring-teal-500">
                        <mat-icon class="text-slate-400 text-sm shrink-0">search</mat-icon>
                        <input id="combo-subCategory-search" type="text" [value]="comboSearch().subCategory" (input)="onComboSearch('subCategory', $event)" (keydown.escape)="$event.stopPropagation(); closeCombo()" [placeholder]="prefs.txt('সাব ক্যাটাগরি খুঁজুন...', 'Search sub category...')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                      </div>
                    </div>
                    <ul class="max-h-52 overflow-y-auto py-1">
                      <li>
                        <button type="button" (mousedown)="$event.preventDefault()" (click)="selectCombo('subCategory', '')" class="w-full px-3 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50">{{ prefs.txt("সাব ক্যাটাগরি নির্বাচন করুন...", "Select Sub Category...") }}</button>
                      </li>
                      @for (sc of filteredSubCategories(); track sc.id) {
                        <li>
                          <button type="button" (mousedown)="$event.preventDefault()" (click)="selectCombo('subCategory', sc.name)" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-slate-50" [class]="formSubCategory === sc.name ? 'bg-teal-50 text-teal-700' : 'text-slate-700'">
                            <span class="truncate">{{ sc.name }}</span>
                            @if (formSubCategory === sc.name) {
                              <mat-icon class="text-sm text-teal-600">check</mat-icon>
                            }
                          </button>
                        </li>
                      } @empty {
                        <li class="px-3 py-3 text-center text-[11px] font-medium text-slate-400">{{ prefs.txt("কোনো সাব ক্যাটাগরি পাওয়া যায়নি", "No sub category found") }}</li>
                      }
                    </ul>
                  </div>
                }
              </div>
            </div>

            <!-- Row 4: Brand & Product Models -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="relative">
                <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("ব্র্যান্ড", "Brand") }}</label>
                <div class="flex items-center gap-1.5">
                  <button type="button" data-combo-root (click)="toggleCombo('brand')" [attr.aria-expanded]="isComboOpen('brand')" class="min-w-0 flex-1 flex items-center border rounded-lg px-2.5 py-1.5 bg-white cursor-pointer text-left transition-all" [class.border-slate-300]="!isComboOpen('brand')" [class.border-teal-500]="isComboOpen('brand')" [class.ring-2]="isComboOpen('brand')" [class.ring-teal-500]="isComboOpen('brand')">
                    <mat-icon class="text-slate-400 text-sm mr-2 shrink-0">sell</mat-icon>
                    <span class="flex-1 truncate text-xs font-medium" [class.text-slate-400]="!formBrand" [class.text-slate-800]="!!formBrand">{{ formBrand || prefs.txt("ব্র্যান্ড নির্বাচন করুন...", "Select Brand...") }}</span>
                    <mat-icon class="text-slate-400 text-sm shrink-0 transition-transform duration-150" [class.rotate-180]="isComboOpen('brand')">expand_more</mat-icon>
                  </button>
                  <button type="button" (click)="openQuickBrandModal()" class="border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg p-1.5 transition-colors cursor-pointer" [title]="prefs.txt('নতুন ব্র্যান্ড যোগ করুন', 'Add New Brand')">
                    <mat-icon class="text-sm">add</mat-icon>
                  </button>
                </div>
                @if (isComboOpen('brand')) {
                  <div data-combo-root class="absolute left-0 right-0 top-full mt-1 z-30 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                    <div class="border-b border-slate-100 p-2">
                      <div class="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 focus-within:ring-2 focus-within:ring-teal-500">
                        <mat-icon class="text-slate-400 text-sm shrink-0">search</mat-icon>
                        <input id="combo-brand-search" type="text" [value]="comboSearch().brand" (input)="onComboSearch('brand', $event)" (keydown.escape)="$event.stopPropagation(); closeCombo()" [placeholder]="prefs.txt('ব্র্যান্ড খুঁজুন...', 'Search brand...')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                      </div>
                    </div>
                    <ul class="max-h-52 overflow-y-auto py-1">
                      <li>
                        <button type="button" (mousedown)="$event.preventDefault()" (click)="selectCombo('brand', '')" class="w-full px-3 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50">{{ prefs.txt("ব্র্যান্ড নির্বাচন করুন...", "Select Brand...") }}</button>
                      </li>
                      @for (b of filteredBrands(); track b.id) {
                        <li>
                          <button type="button" (mousedown)="$event.preventDefault()" (click)="selectCombo('brand', b.name)" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-slate-50" [class]="formBrand === b.name ? 'bg-teal-50 text-teal-700' : 'text-slate-700'">
                            <span class="truncate">{{ b.name }}</span>
                            @if (formBrand === b.name) {
                              <mat-icon class="text-sm text-teal-600">check</mat-icon>
                            }
                          </button>
                        </li>
                      } @empty {
                        <li class="px-3 py-3 text-center text-[11px] font-medium text-slate-400">{{ prefs.txt("কোনো ব্র্যান্ড পাওয়া যায়নি", "No brand found") }}</li>
                      }
                    </ul>
                  </div>
                }
              </div>

              <div class="relative">
                <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("প্রোডাক্ট মডেল", "Product Models") }}</label>
                <div class="flex items-center gap-1.5">
                  <button type="button" data-combo-root (click)="toggleCombo('model')" [attr.aria-expanded]="isComboOpen('model')" class="min-w-0 flex-1 flex items-center border rounded-lg px-2.5 py-1.5 bg-white cursor-pointer text-left transition-all" [class.border-slate-300]="!isComboOpen('model')" [class.border-teal-500]="isComboOpen('model')" [class.ring-2]="isComboOpen('model')" [class.ring-teal-500]="isComboOpen('model')">
                    <mat-icon class="text-slate-400 text-sm mr-2 shrink-0">widgets</mat-icon>
                    <span class="flex-1 truncate text-xs font-medium" [class.text-slate-400]="!formModel" [class.text-slate-800]="!!formModel">{{ formModel || prefs.txt("প্রোডাক্ট মডেল নির্বাচন করুন...", "Select Product Models...") }}</span>
                    @if (formModelList().length > 1) {
                      <span class="shrink-0 rounded-full bg-teal-100 px-1.5 py-0.5 text-[9px] font-black text-teal-700">{{ formModelList().length }}</span>
                    }
                    <mat-icon class="text-slate-400 text-sm shrink-0 transition-transform duration-150" [class.rotate-180]="isComboOpen('model')">expand_more</mat-icon>
                  </button>
                  <button type="button" (click)="openQuickModelModal()" class="border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg p-1.5 transition-colors cursor-pointer" [title]="prefs.txt('নতুন মডেল যোগ করুন', 'Add New Model')">
                    <mat-icon class="text-sm">add</mat-icon>
                  </button>
                </div>
                @if (isComboOpen('model')) {
                  <div data-combo-root class="absolute left-0 right-0 top-full mt-1 z-30 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                    <div class="border-b border-slate-100 p-2">
                      <div class="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 focus-within:ring-2 focus-within:ring-teal-500">
                        <mat-icon class="text-slate-400 text-sm shrink-0">search</mat-icon>
                        <input id="combo-model-search" type="text" [value]="comboSearch().model" (input)="onComboSearch('model', $event)" (keydown.escape)="$event.stopPropagation(); closeCombo()" [placeholder]="prefs.txt('মডেল খুঁজুন...', 'Search product model...')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                      </div>
                    </div>
                    <ul class="max-h-52 overflow-y-auto py-1">
                      <li>
                        <button type="button" (mousedown)="$event.preventDefault()" (click)="clearFormModels()" class="w-full px-3 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50">{{ prefs.txt("প্রোডাক্ট মডেল নির্বাচন করুন...", "Select Product Models...") }}</button>
                      </li>
                      @for (m of filteredModels(); track m.id) {
                        <li>
                          <button type="button" (mousedown)="$event.preventDefault()" (click)="toggleFormModel(m.name)" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-slate-50" [class]="isFormModel(m.name) ? 'bg-teal-50 text-teal-700' : 'text-slate-700'">
                            <span class="truncate">{{ m.name }}</span>
                            @if (isFormModel(m.name)) {
                              <mat-icon class="text-sm text-teal-600">check</mat-icon>
                            }
                          </button>
                        </li>
                      } @empty {
                        <li class="px-3 py-3 text-center text-[11px] font-medium text-slate-400">{{ prefs.txt("কোনো মডেল পাওয়া যায়নি", "No product model found") }}</li>
                      }
                    </ul>
                  </div>
                }
              </div>
            </div>

            <!-- Row 5: Unit & Quantity Alert -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block font-medium mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("একক", "Unit") }}</label>
                <div class="flex items-center gap-1.5">
                  <div class="flex-1 flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500" [class.invalid-field]="isInvalid('Unit')">
                    <mat-icon class="text-slate-400 text-sm mr-2">straighten</mat-icon>
                    <select id="product-unit" [(ngModel)]="formUnit" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                      @if (!formUnit) {
                        <option value="">{{ prefs.txt("একক নির্বাচন করুন...", "Select Unit...") }}</option>
                      }
                      @if (formUnit && !unitOptions().includes(formUnit)) {
                        <option [value]="formUnit">{{ formUnit }}</option>
                      }
                      @for (u of unitOptions(); track u) {
                        <option [value]="u">{{ u }}</option>
                      }
                    </select>
                  </div>
                  <button type="button" (click)="openQuickUnitModal()" class="border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg p-1.5 transition-colors cursor-pointer" [title]="prefs.txt('নতুন একক যোগ করুন', 'Add New Unit')">
                    <mat-icon class="text-sm">add</mat-icon>
                  </button>
                </div>
              </div>

              <div>
                <label class="block font-medium mb-1.5 text-slate-700">
                  {{ prefs.txt("কোয়ান্টিটি অ্যালার্ট", "Quantity Alert") }}
                  <mat-icon class="text-[14px] leading-none text-slate-400 align-middle inline-block cursor-pointer" [title]="prefs.txt('লো-স্টক অ্যালার্টের ন্যূনতম সীমা', 'Minimum stock threshold for low stock alert')">info_outline</mat-icon>
                </label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-2">subtitles</mat-icon>
                  <input type="number" min="0" [(ngModel)]="formQuantityAlert" [placeholder]="prefs.txt('কোয়ান্টিটি অ্যালার্ট লিখুন', 'Enter Quantity Alert')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                </div>
              </div>
            </div>

            <!-- Row 5b: Multi-unit selling setup -->
            @if (formType === 'single') {
              <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
                <label class="flex items-start justify-between gap-3 cursor-pointer">
                  <div>
                    <p class="font-bold text-xs text-slate-800">{{ prefs.txt("মাল্টি ইউনিট পণ্য (ঐচ্ছিক)", "Multi-Unit Product (optional)") }}</p>
                    <p class="text-[10px] text-slate-500 leading-snug">{{ prefs.txt("একই স্টক থেকেই গজ/কেজি/গ্রাম/পিস বিক্রি হবে — শুধু বিক্রির সময় ক্যাশিয়ার ইউনিট বাছবেন, প্রতিটি ইউনিটের দর আলাদা বসবে।", "One shared stock for গজ/কেজি/গ্রাম/পিস — the cashier only picks the unit at sale time, each with its own price.") }}</p>
                  </div>
                  <input type="checkbox" class="mt-1 h-4 w-4 shrink-0 accent-teal-700 cursor-pointer" [(ngModel)]="formMultiUnit" (ngModelChange)="onMultiUnitToggle($event)" />
                </label>
                @if (formMultiUnit) {
                  <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-100 bg-teal-50/70 px-2 py-1.5">
                    <span class="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700">
                      <mat-icon class="text-[13px]">inventory</mat-icon>{{ prefs.txt("স্টক একটাই:", "Shared stock:") }} {{ formUnit || prefs.txt('বেস ইউনিট', 'base unit') }}
                    </span>
                    <button type="button" (click)="addFormUnit()" class="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-white text-teal-700 hover:bg-teal-50 px-2 py-1.5 text-[11px] font-bold cursor-pointer">
                      <mat-icon class="text-sm">add</mat-icon>{{ prefs.txt("ইউনিট", "Unit") }}
                    </button>
                  </div>
                  @for (unit of formUnits; track $index; let i = $index) {
                    <div class="grid grid-cols-2 md:grid-cols-12 gap-2 items-center rounded-lg border border-slate-200 bg-white p-2">
                      <div class="md:col-span-3">
                        <select [(ngModel)]="unit.name" (ngModelChange)="onUnitRowChange()" class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium bg-white outline-none focus:ring-2 focus:ring-teal-500">
                          <option value="">{{ prefs.txt("ইউনিট বাছুন...", "Select unit...") }}</option>
                          @for (option of unitOptions(); track option) {
                            @if (option !== formUnit) {
                              <option [value]="option">{{ option }}</option>
                            }
                          }
                        </select>
                      </div>
                      <div class="md:col-span-4 flex flex-wrap items-center gap-1">
                        @if (unit.inverse) {
                          <span class="text-[11px] font-bold text-slate-600 shrink-0">1 {{ formUnit }}</span>
                        } @else {
                          <span class="text-[11px] font-bold text-slate-600 shrink-0 max-w-[80px] truncate">1 {{ unit.name || '…' }}</span>
                        }
                        <span class="text-[11px] font-bold text-slate-400 shrink-0">=</span>
                        <input type="number" min="0" step="any" [(ngModel)]="unit.factor" class="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-teal-500" [placeholder]="prefs.txt('১', '1')">
                        <span class="text-[11px] font-bold text-slate-500 shrink-0 max-w-[80px] truncate">{{ unit.inverse ? (unit.name || '…') : formUnit }}</span>
                        <button type="button" (click)="toggleUnitDirection(i)" class="shrink-0 grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:text-teal-700 hover:bg-teal-50 cursor-pointer" [title]="prefs.txt('কোন পাশ এক — দিক বদলান', 'Swap which side is one')">
                          <mat-icon class="text-sm">swap_horiz</mat-icon>
                        </button>
                      </div>
                      <div class="md:col-span-3 flex items-center overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                        <span class="bg-slate-100 border-r border-slate-300 px-2 py-1.5 font-bold text-slate-600 text-[10px] whitespace-nowrap">TK/{{ unit.name || '…' }}</span>
                        <input type="number" min="0" step="any" [(ngModel)]="unit.price" [placeholder]="autoUnitPrice(unit) ? prefs.txt('অটো ', 'auto ') + autoUnitPrice(unit) : prefs.txt('এই এককের দর', 'price per unit')" class="w-full px-2 py-1.5 text-xs font-mono font-bold outline-none">
                      </div>
                      <div class="md:col-span-2 flex justify-end">
                        <button type="button" (click)="removeFormUnit(i)" class="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer" [title]="prefs.txt('সরান', 'Remove')">
                          <mat-icon class="text-base">close</mat-icon>
                        </button>
                      </div>
                    </div>
                  }
                  <p class="text-[10px] text-slate-400">{{ prefs.txt("প্রতিটি ইউনিটের দর আলাদা বসাতে পারবেন — যেমন ১ কেজি ১৭০ TK আর ১ পিস ১২ TK। রূপান্তর খালি রাখলে ১:১ হিসাবে একই স্টক কমবে; কেজি↔গ্রাম বা রোল↔গজ মেলাতে চাইলে রূপান্তর দিন (১ প্যাকেট = ১৫ পিস হলে swap চিহ্নে দিক বদলান)।", "Give each unit its own price — e.g. 1 কেজি at 170 TK and 1 pcs at 12 TK. Leave the conversion blank to share the stock one-for-one; enter one when কেজি↔গ্রাম or roll↔গজ must reconcile (tap swap for 1 packet = 15 pcs).") }}</p>
                }
              </div>
            }

            <!-- Row 6: Barcode Symbology & Item Code -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block font-medium mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("বারকোড সিম্বলজি", "Barcode Symbology") }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500" [class.invalid-field]="isInvalid('Barcode Symbology')">
                  <mat-icon class="text-slate-400 text-sm mr-2">qr_code_2</mat-icon>
                  <select id="product-barcode" [(ngModel)]="formBarcodeSymbology" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    <option value="">{{ prefs.txt("বারকোড সিম্বলজি নির্বাচন করুন...", "Select Barcode Symbology...") }}</option>
                    <option value="CODE128">CODE128</option>
                    <option value="CODE39">CODE39</option>
                    <option value="EAN8">EAN8</option>
                    <option value="EAN13">EAN13</option>
                    <option value="UPCA">UPCA</option>
                  </select>
                </div>
                <p class="mt-1 text-[10px] text-slate-400">{{ prefs.txt("ডিফল্ট CODE128 — না জানলে এটাই রাখুন।", "CODE128 is set by default — keep it if unsure.") }}</p>
              </div>

              <div>
                <label class="block font-medium mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("আইটেম কোড", "Item Code") }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500" [class.invalid-field]="isInvalid('Item Code')">
                  <mat-icon class="text-slate-400 text-sm mr-2">grid_3x3</mat-icon>
                  <input id="product-code" type="text" autocomplete="off" [(ngModel)]="formCode" [placeholder]="prefs.txt('আইটেম কোড লিখুন', 'Enter Item Code')" class="w-full bg-transparent outline-none text-xs font-mono font-medium text-slate-900">
                  <button type="button" (click)="generateRandomCode()" class="text-slate-400 hover:text-slate-700 px-1 cursor-pointer" [title]="prefs.txt('অটো কোড তৈরি করুন', 'Auto Generate Code')">
                    <mat-icon class="text-sm">qr_code_scanner</mat-icon>
                  </button>
                </div>
                <p class="mt-1 text-[10px] text-slate-400">
                  @if (isEditMode()) {
                    {{ prefs.txt("কোড না বদলেই হালনাগাদ করতে পারবেন — শুধু অন্য পণ্যের সাথে মিলে গেলে কোড বদলাতে হবে।", "You can update without changing the code — change it only if it clashes with another product.") }}
                  } @else {
                    {{ prefs.txt("ইউনিক হতে হবে; আইকনে চাপলে অটো কোড তৈরি হবে।", "Must be unique; tap the icon to generate one.") }}
                  }
                </p>
              </div>
            </div>

            <!-- Price & Tax OR Variants Details Section -->
            @if (formType === 'variant') {
              <!-- Variants Details Section matching variantion from 1.png -->
              <div class="space-y-4 pt-2">
                <div class="border-b border-slate-700 pb-1">
                  <h4 class="font-bold text-sm text-slate-900">{{ prefs.txt("ভ্যারিয়েন্টের বিবরণ", "Variants Details") }}</h4>
                </div>

                <!-- Tax Dropdown -->
                <div>
                  <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("ট্যাক্স", "Tax") }}</label>
                  <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                    <span class="text-slate-400 font-bold text-xs mr-2">%</span>
                    <select [(ngModel)]="formTax" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                      <option value="">{{ prefs.txt("ট্যাক্স নির্বাচন করুন...", "Select Tax...") }}</option>
                      <option value="0">{{ prefs.txt("ট্যাক্স নেই (0%)", "No Tax (0%)") }}</option>
                      <option value="5">{{ prefs.txt("ভ্যাট 5%", "VAT 5%") }}</option>
                      <option value="10">{{ prefs.txt("ভ্যাট 10%", "VAT 10%") }}</option>
                      <option value="15">{{ prefs.txt("ভ্যাট 15%", "VAT 15%") }}</option>
                    </select>
                  </div>
                </div>

                <!-- Alert Banner -->
                <div class="bg-sky-50 border border-sky-200 text-sky-800 rounded-xl p-3 text-xs flex items-center gap-2 shadow-2xs">
                  <mat-icon class="text-sky-500 text-base flex-shrink-0">info</mat-icon>
                  <span class="font-medium text-[11px] leading-tight">{{ prefs.txt("নিচের ড্রপডাউন থেকে ভ্যারিয়েন্ট ও ভ্যারিয়েন্ট টাইপ বেছে নিয়ে + ভ্যারিয়েশন যোগ করুন বাটনে ক্লিক করুন।", "Select Variant and Variant Type From Below Dropdown and Then Click on + Add Variation Button") }}</span>
                </div>

                <!-- Row: Select Variation, Select Variant Value & Add Button -->
                <div class="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  <div class="sm:col-span-5">
                    <select id="product-variation" [value]="selectedVariationId() || ''" (change)="onVariationChange($event)" class="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-teal-500">
                      <option value="">{{ prefs.txt("ভ্যারিয়েশন নির্বাচন করুন...", "Select Variation...") }}</option>
                      @for (v of dataService.variations(); track v.id) {
                        <option [value]="v.id">{{ v.name }}</option>
                      }
                    </select>
                  </div>

                  <div class="sm:col-span-4">
                    <select [(ngModel)]="selectedVariantValue" [disabled]="!selectedVariationId()" class="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-400">
                      <option value="">{{ prefs.txt("ভ্যারিয়েন্ট ভ্যালু নির্বাচন করুন...", "Select Variant Value...") }}</option>
                      @for (val of availableVariantValues(); track val) {
                        <option [value]="val">{{ val }}</option>
                      }
                    </select>
                  </div>

                  <div class="sm:col-span-3 flex justify-end">
                    <button id="product-variant-add" type="button" (click)="addVariantRow()" [disabled]="!selectedVariationId() || !selectedVariantValue()" class="w-full bg-slate-100 hover:bg-teal-500 hover:text-white disabled:bg-slate-100 disabled:text-slate-400 text-slate-600 border border-slate-300 font-semibold px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:cursor-not-allowed">
                      <mat-icon class="text-xs">add</mat-icon> {{ prefs.txt("ভ্যারিয়েশন যোগ করুন", "Add Variation") }}
                    </button>
                  </div>
                </div>

                <!-- Variants Table -->
                <div id="product-variants" class="border border-slate-200 rounded-xl overflow-x-auto shadow-2xs mt-3" [class.invalid-field]="isInvalid('Variant')">
                  <table class="w-full min-w-[640px] text-xs text-left border-collapse">
                    <thead>
                      <tr class="bg-teal-600 text-white font-bold uppercase text-[10px] tracking-wider">
                        <th class="p-2.5 text-center w-10">{{ prefs.txt("ক্রম", "SL") }}</th>
                        <th class="p-2.5">{{ prefs.txt("ছবি", "IMAGE") }}</th>
                        <th class="p-2.5">{{ prefs.txt("ভ্যারিয়েশন", "VARIATION") }}</th>
                        <th class="p-2.5">{{ prefs.txt("ভ্যারিয়েন্ট ভ্যালু", "VARIANT VALUE") }}</th>
                        <th class="p-2.5">{{ prefs.txt("আইটেম কোড", "ITEM CODE") }}</th>
                        <th class="p-2.5 text-right">{{ prefs.txt("পাইকারি মূল্য", "WHOLESALE PRICE") }}</th>
                        <th class="p-2.5 text-center w-28">{{ prefs.txt("অ্যাকশন", "ACTION") }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 bg-white">
                      @for (item of addedVariants(); track item.id; let idx = $index) {
                        <tr class="hover:bg-slate-50 transition-colors">
                          <td class="p-2 text-center font-bold text-slate-500">{{ idx + 1 }}</td>
                          <td class="p-2">
                            <img [src]="item.image || formImagePreview() || noImage" [attr.alt]="prefs.txt('ভ্যারিয়েন্ট ছবি', 'Variant Image')" class="w-7 h-7 rounded object-cover border border-slate-200" loading="lazy" decoding="async">
                          </td>
                          <td class="p-2 font-semibold text-slate-800">{{ item.variationName }}</td>
                          <td class="p-2">
                            <span class="font-mono text-teal-700 bg-teal-50 font-semibold rounded px-2 py-0.5 inline-block text-[11px] border border-teal-200">{{ item.variantValue }}</span>
                          </td>
                          <td class="p-2">
                            <span class="font-mono text-[11px] font-semibold text-slate-600">{{ item.itemCode || '—' }}</span>
                          </td>
                          <td class="p-2 text-right">
                            <input type="number" min="0" [(ngModel)]="item.wholesalePrice" class="w-24 border border-slate-300 rounded px-2 py-1 text-right font-mono font-bold text-slate-800 outline-none focus:ring-1 focus:ring-teal-500">
                          </td>
                          <td class="p-2 text-center">
                            <div class="flex items-center justify-center gap-1">
                              <button type="button" (click)="openEditVariantModal(idx)" class="text-amber-600 hover:text-amber-800 dark:text-amber-200 p-1 cursor-pointer rounded hover:bg-amber-50" [title]="prefs.txt('ভ্যারিয়েশনের বিবরণ এডিট করুন', 'Edit Variation Details')">
                                <mat-icon class="text-sm">edit</mat-icon>
                              </button>
                              <button type="button" (click)="cloneVariantRow(idx)" class="text-blue-600 hover:text-blue-800 p-1 cursor-pointer rounded hover:bg-blue-50" [title]="prefs.txt('ভ্যারিয়েন্ট রো ক্লোন করুন', 'Clone Variant Row')">
                                <mat-icon class="text-sm">content_copy</mat-icon>
                              </button>
                              <button type="button" (click)="removeVariantRow(idx)" class="text-rose-600 hover:text-rose-800 p-1 cursor-pointer rounded hover:bg-rose-50" [title]="prefs.txt('ভ্যারিয়েন্ট রো ডিলিট করুন', 'Delete Variant Row')">
                                <mat-icon class="text-sm">delete</mat-icon>
                              </button>
                            </div>
                          </td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="7" class="p-8 text-center bg-teal-50/20">
                            <div class="flex flex-col items-center justify-center text-slate-400">
                              <mat-icon class="text-4xl text-slate-300 mb-1">inventory_2</mat-icon>
                              <span class="text-xs font-medium">{{ prefs.txt("তথ্য নেই", "No data") }}</span>
                            </div>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                <p class="text-[10px] font-medium" [class.text-rose-600]="isInvalid('Variant')" [class.text-slate-400]="!isInvalid('Variant')">
                  {{ prefs.txt("কমপক্ষে একটি ভ্যারিয়েন্ট রো প্রয়োজন। এডিট অ্যাকশন থেকে ওই ভ্যারিয়েন্টের আইটেম কোড, মূল্য ও প্রারম্ভিক স্টক ঠিক করুন।", "At least one variant row is required. Use the edit action to set that variant's item code, prices and opening stock.") }}
                </p>

                @if (isEditMode()) {
                  <div class="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <span class="font-semibold text-slate-600">{{ prefs.txt("বর্তমান স্টক", "Current Stock") }}</span>
                    <span class="font-mono font-bold text-slate-900">{{ editingCurrentStock() }} {{ formUnit }}</span>
                  </div>
                  <p class="text-[10px] font-medium text-slate-400">{{ prefs.txt("ভ্যারিয়েন্ট পণ্যের স্টক প্রতি ভ্যারিয়েন্ট রো-এর এডিট থেকে বদলান।", "Change a variant product's stock from each variant row's edit action.") }}</p>
                }

              </div>
            } @else {
              <!-- Single Type Product Price & Tax Section -->
              <!-- Price & Tax Section Header -->
              <div class="pt-2">
                <h4 class="font-bold text-sm text-slate-900 border-b border-slate-200 pb-1">{{ prefs.txt("মূল্য ও ট্যাক্স", "Price & Tax") }}</h4>
              </div>

              <!-- Row 7: Tax & MRP -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("ট্যাক্স", "Tax") }}</label>
                  <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                    <span class="text-slate-400 font-bold text-xs mr-2">%</span>
                    <select [(ngModel)]="formTax" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                      <option value="">{{ prefs.txt("ট্যাক্স নির্বাচন করুন...", "Select Tax...") }}</option>
                      <option value="0">{{ prefs.txt("ট্যাক্স নেই (0%)", "No Tax (0%)") }}</option>
                      <option value="5">{{ prefs.txt("ভ্যাট 5%", "VAT 5%") }}</option>
                      <option value="10">{{ prefs.txt("ভ্যাট 10%", "VAT 10%") }}</option>
                      <option value="15">{{ prefs.txt("ভ্যাট 15%", "VAT 15%") }}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("এমআরপি", "MRP") }}</label>
                  <div class="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-teal-500">
                    <span class="bg-slate-100 border-r border-slate-300 px-3 py-1.5 font-bold text-slate-600 text-xs">TK</span>
                    <input type="number" min="0" [(ngModel)]="formMrp" placeholder="0" class="w-full px-2.5 py-1.5 bg-transparent outline-none text-xs font-mono font-bold text-slate-800">
                  </div>
                </div>
              </div>

              <!-- Row 8: Purchase Price & Wholesale Price -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block font-medium mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("ক্রয় মূল্য", "Purchase Price") }}</label>
                  <div class="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-teal-500" [class.invalid-field]="isInvalid('Purchase Price')">
                    <span class="bg-slate-100 border-r border-slate-300 px-3 py-1.5 font-bold text-slate-600 text-xs">TK</span>
                    <input id="product-purchase-price" type="number" min="0" [(ngModel)]="formPurchasePrice" placeholder="0" class="w-full px-2.5 py-1.5 bg-transparent outline-none text-xs font-mono font-bold text-slate-800">
                    <select [(ngModel)]="formPurchaseTaxMode" class="bg-slate-50 border-l border-slate-300 px-2 py-1.5 outline-none text-xs font-medium text-slate-600">
                      <option value="">{{ prefs.txt("ট্যাক্স টাইপ", "Tax Type") }}</option>
                      <option value="without">{{ prefs.txt("ট্যাক্স ছাড়া", "Without Tax") }}</option>
                      <option value="with">{{ prefs.txt("ট্যাক্স সহ", "With Tax") }}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("পাইকারি মূল্য", "Wholesale Price") }}</label>
                  <div class="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-teal-500">
                    <span class="bg-slate-100 border-r border-slate-300 px-3 py-1.5 font-bold text-slate-600 text-xs">TK</span>
                    <input type="number" min="0" [(ngModel)]="formWholesalePrice" [placeholder]="prefs.txt('পাইকারি মূল্য লিখুন', 'Enter Wholesale Price')" class="w-full px-2.5 py-1.5 bg-transparent outline-none text-xs font-mono font-bold text-slate-800">
                  </div>
                </div>
              </div>

              <!-- Row 9: Sales Price & Wholesale Quantity -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block font-medium mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("বিক্রয় মূল্য", "Sales Price") }}</label>
                  <div class="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-teal-500" [class.invalid-field]="isInvalid('Sales Price')">
                    <span class="bg-slate-100 border-r border-slate-300 px-3 py-1.5 font-bold text-slate-600 text-xs">TK</span>
                    <input id="product-sales-price" type="number" min="0" [(ngModel)]="formSalesPrice" placeholder="0" class="w-full px-2.5 py-1.5 bg-transparent outline-none text-xs font-mono font-bold text-teal-700">
                    <select [(ngModel)]="formSalesTaxMode" class="bg-slate-50 border-l border-slate-300 px-2 py-1.5 outline-none text-xs font-medium text-slate-600">
                      <option value="">{{ prefs.txt("ট্যাক্স টাইপ", "Tax Type") }}</option>
                      <option value="without">{{ prefs.txt("ট্যাক্স ছাড়া", "Without Tax") }}</option>
                      <option value="with">{{ prefs.txt("ট্যাক্স সহ", "With Tax") }}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("পাইকারি পরিমাণ", "Wholesale Quantity") }}</label>
                  <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                    <mat-icon class="text-slate-400 text-sm mr-2">subtitles</mat-icon>
                    <input type="number" min="0" [(ngModel)]="formWholesaleQuantity" [placeholder]="prefs.txt('ন্যূনতম পরিমাণ লিখুন', 'Enter Minimum Quantity')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                  </div>
                </div>
              </div>

              <!-- Row 10: Warranty period -->
              @if (formType !== 'service') {
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-medium mb-1.5 text-slate-700">
                      {{ prefs.txt("ওয়ারেন্টি মেয়াদ", "Warranty Period") }}
                      <mat-icon class="text-[14px] leading-none text-slate-400 align-middle inline-block cursor-pointer" [title]="prefs.txt('বিক্রয়ের তারিখ থেকে এই মেয়াদ ধরে ওয়ারেন্টি রেজিস্টারে দেখাবে। ০ রাখলে ওয়ারেন্টি থাকবে না।', 'Warranty runs this many days from the sale date. 0 means no warranty.')">info_outline</mat-icon>
                    </label>
                    <div class="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <mat-icon class="text-slate-400 text-sm mx-2.5">verified_user</mat-icon>
                      <input id="product-warranty-days" type="number" min="0" step="1" [(ngModel)]="formWarrantyDays" [placeholder]="prefs.txt('যেমন ১৮০', 'e.g. 180')" class="w-full py-1.5 pr-2 bg-transparent outline-none text-xs font-mono font-bold text-slate-800">
                      <span class="bg-slate-50 border-l border-slate-300 px-3 py-1.5 text-[11px] font-medium text-slate-500">{{ prefs.txt("দিন", "days") }}</span>
                    </div>
                  </div>
                  <div>
                    <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("দ্রুত মেয়াদ বাছাই", "Quick Pick") }}</label>
                    <div class="flex flex-wrap items-center gap-1.5">
                      @for (preset of warrantyPresets; track preset.days) {
                        <button type="button" (click)="setWarrantyDays(preset.days)" class="rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors cursor-pointer" [class]="warrantyDaysValue() === preset.days ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'">{{ prefs.txt(preset.bn, preset.en) }}</button>
                      }
                    </div>
                  </div>
                </div>
              }

              @if (formType !== 'service') {
                <!-- Section: Stock -->
                <div class="pt-2">
                  <h4 class="font-bold text-sm text-slate-900 border-b border-slate-200 pb-1">{{ prefs.txt("স্টক ও ইনভেন্টরি", "Stock & Inventory") }}</h4>
                </div>

                <!-- Edit adjusts the live count; a new product starts with opening stock. -->
                @if (isEditMode()) {
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("বর্তমান স্টক", "Current Stock") }}
                        <span class="ml-1 font-normal text-[10px] text-slate-400">{{ prefs.txt("প্রারম্ভিক", "opening") }} {{ formOpeningStock === '' ? '0' : formOpeningStock }} {{ formUnit }}{{ formOpeningStockDate ? ' · ' + formOpeningStockDate : '' }}</span>
                      </label>
                      <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500">
                        <mat-icon class="text-slate-400 text-sm mr-2">inventory_2</mat-icon>
                        <input type="number" min="0" [(ngModel)]="formCurrentStock" placeholder="0" [disabled]="!canEditStock()" class="w-full bg-transparent outline-none text-xs font-mono font-bold text-slate-800 disabled:text-slate-500">
                        <span class="text-[10px] font-bold text-slate-400 ml-2">{{ formUnit }}</span>
                      </div>
                    </div>

                    <div>
                      <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("প্রারম্ভিক স্টক ও তারিখ", "Opening Stock & Date") }}
                        <span class="ml-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold" [class]="openingUnlocked() ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'">
                          <mat-icon style="font-size:10px;width:10px;height:10px;">{{ openingUnlocked() ? 'lock_open' : 'lock' }}</mat-icon>
                          {{ openingUnlocked() ? prefs.txt('অ্যাডমিন আনলক', 'Admin unlocked') : prefs.txt('শুধু অ্যাডমিন', 'Admin only') }}
                        </span>
                      </label>
                      @if (openingUnlocked() && canEditStock()) {
                        <div class="space-y-1.5">
                          <div class="flex items-center border-2 border-teal-400 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                            <mat-icon class="text-teal-600 text-sm mr-2">subtitles</mat-icon>
                            <input id="product-opening-stock" type="number" min="0" [(ngModel)]="formOpeningStock" placeholder="0" class="w-full bg-transparent outline-none text-xs font-mono font-bold text-slate-800">
                            <span class="text-[10px] font-bold text-slate-400 mx-1">{{ formUnit }}</span>
                            <button type="button" (click)="lockOpening('product')" class="shrink-0 p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer" [title]="prefs.txt('আবার লক করুন', 'Lock again')">
                              <mat-icon class="text-sm">lock</mat-icon>
                            </button>
                          </div>
                          <div class="flex items-center border-2 border-teal-400 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                            <mat-icon class="text-teal-600 text-sm mr-2">calendar_today</mat-icon>
                            <input id="product-opening-date" type="date" appDmyDate [(ngModel)]="formOpeningStockDate" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                          </div>
                          <p class="text-[10px] leading-snug text-slate-500">{{ prefs.txt('এটি শুধু প্রারম্ভিক ভিত্তি বদলায়। চলতি স্টক বদলাতে পাশের “বর্তমান স্টক” ঘর ব্যবহার করুন।', 'This changes the historical baseline only. Use the Current Stock field beside it to change the live count.') }}</p>
                        </div>
                      } @else {
                        <div class="flex items-center border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-100">
                          <mat-icon class="text-slate-400 text-sm mr-2">lock</mat-icon>
                          <span class="w-full font-mono font-bold text-xs text-slate-700">{{ formOpeningStock === '' ? '0' : formOpeningStock }} {{ formUnit }} · {{ formOpeningStockDate || '—' }}</span>
                          @if (canEditStock()) {
                            <button type="button" (click)="askOpeningUnlock('product')" class="shrink-0 inline-flex items-center gap-0.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100 cursor-pointer transition-colors">
                              <mat-icon style="font-size:12px;width:12px;height:12px;">key</mat-icon> {{ prefs.txt('আনলক', 'Unlock') }}
                            </button>
                          }
                        </div>
                      }
                    </div>
                  </div>
                } @else {
                  <!-- Row 10: Opening Stock & Opening Stock Date -->
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("প্রারম্ভিক স্টক", "Opening Stock") }}</label>
                      <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500">
                        <mat-icon class="text-slate-400 text-sm mr-2">subtitles</mat-icon>
                        <input type="number" min="0" [(ngModel)]="formOpeningStock" placeholder="0" [disabled]="!canEditStock()" class="w-full bg-transparent outline-none text-xs font-mono font-bold text-slate-800 disabled:text-slate-500">
                      </div>
                    </div>

                    <div>
                      <label class="block font-medium mb-1.5 text-slate-700">{{ prefs.txt("প্রারম্ভিক স্টকের তারিখ", "Opening Stock Date") }}</label>
                      <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                        <mat-icon class="text-slate-400 text-sm mr-2">calendar_today</mat-icon>
                        <input type="date" appDmyDate [(ngModel)]="formOpeningStockDate" [disabled]="!canEditStock()" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800 disabled:text-slate-500">
                      </div>
                    </div>
                  </div>
                }
              } @else {
                <div class="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-medium text-sky-800">
                  <mat-icon class="text-sm text-sky-500 shrink-0">info</mat-icon>
                  {{ prefs.txt("সার্ভিস পণ্যের স্টক হিসাব থাকে না, তাই স্টকের ঘরগুলো দেখানো হচ্ছে না।", "Services hold no stock, so inventory fields are hidden.") }}
                </div>
              }
            }

          </div>

          <!-- Drawer Footer Action Buttons -->
          <div class="bg-white border-t border-slate-200 p-4 flex items-center justify-end gap-2.5 sticky bottom-0 z-20">
            <button type="button" (click)="saveProductForm(false)" class="bg-teal-500 hover:bg-teal-600 text-white font-bold px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer">
              <mat-icon class="text-sm">edit_note</mat-icon> {{ isEditMode() ? prefs.txt("হালনাগাদ করুন", "Update") : prefs.txt("তৈরি করুন", "Create") }}
            </button>
            @if (!isEditMode()) {
              <button type="button" (click)="saveProductForm(true)" class="bg-teal-500 hover:bg-teal-600 text-white font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer">
                <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt("সংরক্ষণ করে চালিয়ে যান", "Save & Continue") }}
              </button>
            }
            <button type="button" (click)="requestCloseForm()" class="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold px-4 py-2 rounded-lg text-xs transition-colors cursor-pointer">
              {{ prefs.txt("বাতিল", "Cancel") }}
            </button>
          </div>

        </div>
      </div>
    }

    <!-- Slide-Over Drawer: Product Data View (opens from the right) -->
    @if (viewingProduct(); as p) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end drawer-backdrop" (click)="closeView()">
        <div class="bg-white w-full sm:w-1/2 sm:min-w-[560px] h-full shadow-2xl flex flex-col overflow-hidden text-slate-800 drawer-slide-in" (click)="$event.stopPropagation()">

          <!-- Drawer Header -->
          <div class="bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between sticky top-0 z-20">
            <h2 class="font-bold text-sm text-slate-900 flex items-center gap-2">
              <mat-icon class="text-teal-600 text-base">inventory_2</mat-icon> {{ prefs.txt("পণ্যের বিস্তারিত", "Product Details") }}
            </h2>
            <button (click)="closeView()" class="text-slate-400 hover:text-slate-700 cursor-pointer" [title]="prefs.txt('বন্ধ', 'Close')" [attr.aria-label]="prefs.txt('বন্ধ', 'Close')">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          <!-- Drawer Body -->
          <div class="p-5 overflow-y-auto flex-1 space-y-5 text-xs">

            <!-- Product Hero -->
            <div class="flex items-center gap-3">
              <img [src]="p.image || noImage" [attr.alt]="prefs.txt('পণ্য', 'Product')" class="w-16 h-16 rounded-xl object-cover border border-slate-200" loading="lazy" decoding="async">
              <div class="min-w-0">
                <h3 class="font-bold text-base text-slate-900 leading-snug break-words">{{ p.name }}</h3>
                <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span class="font-mono text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">{{ p.code }}</span>
                  <span class="text-[10px] font-bold uppercase text-teal-700 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5">{{ p.type }}</span>
                </div>
              </div>
            </div>

            <!-- Key Figures -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div class="rounded-xl border p-2.5" [class]="p.stock > 0 ? 'bg-teal-50/60 border-teal-200' : 'bg-rose-50 border-rose-200'">
                <span class="block text-[10px] font-semibold uppercase tracking-wide" [class]="p.stock > 0 ? 'text-teal-700' : 'text-rose-600'">{{ prefs.txt("স্টক", "Stock") }}</span>
                <span class="block font-mono font-bold text-sm mt-0.5" [class]="p.stock > 0 ? 'text-teal-800' : 'text-rose-700'">{{ p.stock }} {{ p.unit }}</span>
              </div>
              <div class="rounded-xl bg-teal-50/70 border border-teal-200 p-2.5">
                <span class="block text-[10px] font-semibold uppercase tracking-wide text-teal-700">{{ prefs.txt("বিক্রয়", "Sales") }}</span>
                <span class="block font-mono font-bold text-sm mt-0.5 text-teal-900">{{ p.salesPrice | number:'1.2-2' }} TK</span>
              </div>
              <div class="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                <span class="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ prefs.txt("ক্রয়", "Purchase") }}</span>
                <span class="block font-mono font-bold text-sm mt-0.5 text-slate-900">{{ p.purchasePrice | number:'1.2-2' }} TK</span>
              </div>
              <div class="rounded-xl bg-sky-50/70 border border-sky-200 p-2.5">
                <span class="block text-[10px] font-semibold uppercase tracking-wide text-sky-700">{{ prefs.txt("পাইকারি", "Wholesale") }}</span>
                <span class="block font-mono font-bold text-sm mt-0.5 text-sky-900">{{ p.wholesalePrice | number:'1.2-2' }} TK</span>
              </div>
            </div>

            <!-- Classification -->
            <div>
              <h4 class="font-bold text-xs text-slate-900 border-b border-slate-200 pb-1 mb-1">{{ prefs.txt("শ্রেণিবিন্যাস", "Classification") }}</h4>
              <dl class="divide-y divide-slate-100">
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("ক্যাটাগরি", "Category") }}</dt>
                  <dd class="font-semibold text-slate-800 text-right">{{ p.category }}</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("সাব ক্যাটাগরি", "Sub Category") }}</dt>
                  <dd class="font-semibold text-slate-800 text-right">{{ p.subCategory || '—' }}</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("ব্র্যান্ড", "Brand") }}</dt>
                  <dd class="font-semibold text-slate-800 text-right">{{ p.brand }}</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("মডেল", "Model") }}</dt>
                  <dd class="font-semibold text-slate-800 text-right">{{ p.model }}</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("ধরন", "Type") }}</dt>
                  <dd class="font-semibold text-slate-800 text-right capitalize">{{ p.type }}</dd>
                </div>
                <div class="flex items-center justify-between gap-3 py-2">
                  <dt class="text-slate-500 font-medium shrink-0">{{ prefs.txt("স্লাগ", "Slug") }}</dt>
                  <dd class="font-mono font-semibold text-slate-800 text-right break-all">{{ p.slug || '—' }}</dd>
                </div>
              </dl>
            </div>

            <!-- Variants -->
            @if (p.variants?.length) {
              <div>
                <h4 class="font-bold text-xs text-slate-900 border-b border-slate-200 pb-1 mb-1">
                  {{ prefs.txt('ভ্যারিয়েন্ট', 'Variants') }} <span class="text-slate-400">({{ p.variants?.length }})</span>
                </h4>
                <div class="mt-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table class="w-full text-[11px] border-collapse">
                    <thead>
                      <tr class="bg-slate-50/80 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">
                        <th class="px-2 py-1.5 text-center w-8">{{ prefs.txt("ক্রম", "SL") }}</th>
                        <th class="px-2 py-1.5 text-left">{{ prefs.txt("ভ্যারিয়েন্ট", "Variant") }}</th>
                        <th class="px-2 py-1.5 text-left">{{ prefs.txt("আইটেম কোড", "Item Code") }}</th>
                        <th class="px-2 py-1.5 text-right">{{ prefs.txt("বিক্রয় মূল্য", "Sale Price") }}</th>
                        <th class="px-2 py-1.5 text-right">{{ prefs.txt("পাইকারি মূল্য", "Wholesale") }}</th>
                        <th class="px-2 py-1.5 text-right">{{ prefs.txt("স্টক", "Stock") }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      @for (v of p.variants || []; track v.id; let i = $index) {
                        <tr class="hover:bg-teal-50/40 transition-colors">
                          <td class="px-2 py-2 text-center font-mono text-[10px] text-slate-400 tabular-nums">{{ i + 1 }}</td>
                          <td class="px-2 py-2">
                            <div class="flex items-center gap-2 min-w-0">
                              <img [src]="v.image || noImage" alt="" class="w-6 h-6 rounded-md object-cover border border-slate-200 shrink-0" loading="lazy" decoding="async">
                              <span class="truncate">
                                <span class="font-semibold text-slate-600">{{ v.variationName }}</span>
                                <span class="text-slate-300"> · </span>
                                <span class="font-mono font-semibold text-teal-700">{{ v.variantValue }}</span>
                              </span>
                            </div>
                          </td>
                          <td class="px-2 py-2 font-mono text-[10px] tracking-tight text-slate-500">{{ v.itemCode }}</td>
                          <td class="px-2 py-2 text-right align-middle whitespace-nowrap">
                            <span class="text-[9px] font-bold text-teal-600/60">৳</span>
                            <span class="font-mono font-bold tabular-nums text-teal-700">{{ v.salesPrice | number:'1.2-2' }}</span>
                          </td>
                          <td class="px-2 py-2 text-right align-middle whitespace-nowrap">
                            <span class="text-[9px] font-bold text-sky-600/60">৳</span>
                            <span class="font-mono font-bold tabular-nums text-sky-700">{{ v.wholesalePrice | number:'1.2-2' }}</span>
                          </td>
                          <td class="px-2 py-2 text-right align-middle whitespace-nowrap">
                            <span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold" [class]="stockBadgeClass(v.openingStock)">
                              <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60"></span>{{ v.openingStock }} {{ p.unit }}
                            </span>
                          </td>
                        </tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr class="bg-slate-50/80 border-t border-slate-200 text-[10px]">
                        <td colspan="3" class="px-2 py-1.5 text-right font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt('মোট', 'From') }}</td>
                        <td class="px-2 py-1.5 text-right font-mono font-bold tabular-nums text-teal-700">
                          <span class="text-[9px] font-normal text-slate-400">{{ prefs.txt("থেকে", "from") }}</span>৳{{ variantMin(p, 'salesPrice') | number:'1.2-2' }}
                        </td>
                        <td class="px-2 py-1.5 text-right font-mono font-bold tabular-nums text-sky-700">
                          <span class="text-[9px] font-normal text-slate-400">{{ prefs.txt("থেকে", "from") }}</span>৳{{ variantMin(p, 'wholesalePrice') | number:'1.2-2' }}
                        </td>
                        <td class="px-2 py-1.5 text-right font-mono font-bold tabular-nums text-slate-700">{{ variantStockSum(p) }} {{ p.unit }}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            }

            <!-- Stock & Location -->
            <div>
              <h4 class="font-bold text-xs text-slate-900 border-b border-slate-200 pb-1 mb-1">{{ prefs.txt("স্টক ও অবস্থান", "Stock & Location") }}</h4>
              <dl class="divide-y divide-slate-100">
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("স্টক", "Stock") }}</dt>
                  <dd class="font-mono font-semibold text-slate-800">{{ p.stock }} {{ p.unit }}</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("একক", "Unit") }}</dt>
                  <dd class="font-semibold text-slate-800">{{ p.unit }}</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("র‍্যাক", "Rack") }}</dt>
                  <dd class="font-semibold text-slate-800">{{ p.rack }}</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("ওয়্যারহাউস", "Warehouse") }}</dt>
                  <dd class="font-semibold text-slate-800">{{ p.warehouse || '—' }}</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("প্রারম্ভিক স্টক", "Opening Stock") }}</dt>
                  <dd class="font-mono font-semibold text-slate-800">{{ p.openingStock ?? '—' }}</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("প্রারম্ভিক স্টকের তারিখ", "Opening Stock Date") }}</dt>
                  <dd class="font-semibold text-slate-800">{{ p.openingStockDate || '—' }}</dd>
                </div>
              </dl>
            </div>

            <!-- Purchase History -->
            <div>
              <h4 class="font-bold text-xs text-slate-900 border-b border-slate-200 pb-1 mb-1 flex items-center justify-between gap-2">
                <span>{{ prefs.txt("ক্রয় হিস্টরি", "Purchase History") }}</span>
                @if (purchaseHistory().length) {
                  <span class="text-[10px] font-semibold text-slate-400">{{ purchaseHistory().length }} {{ prefs.txt("টি ক্রয়", "purchases") }}</span>
                }
              </h4>

              @if (purchaseHistory().length) {
                <div class="grid grid-cols-3 gap-2 mt-1.5 mb-2">
                  <div class="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5 text-center">
                    <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt("ক্রয়", "Purchases") }}</span>
                    <span class="block font-mono font-bold text-sm text-slate-900 mt-0.5">{{ purchaseHistorySummary().entries }}</span>
                  </div>
                  <div class="rounded-lg bg-teal-50/70 border border-teal-200 px-2 py-1.5 text-center">
                    <span class="block text-[9px] font-bold uppercase tracking-wide text-teal-700">{{ prefs.txt("স্টকে ঢুকেছে", "Stock In") }}</span>
                    <span class="block font-mono font-bold text-sm text-teal-900 mt-0.5">{{ purchaseHistorySummary().receivedQty }} {{ p.unit }}</span>
                  </div>
                  <div class="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5 text-center">
                    <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt("সর্বশেষ ক্রয়", "Last Purchase") }}</span>
                    <span class="block font-mono font-bold text-sm text-slate-900 mt-0.5">{{ purchaseHistorySummary().lastDate || '—' }}</span>
                  </div>
                </div>

                <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table class="w-full text-[11px] border-collapse">
                    <thead>
                      <tr class="bg-slate-50/80 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">
                        <th class="px-2 py-1.5 text-left">{{ prefs.txt("তারিখ", "Date") }}</th>
                        <th class="px-2 py-1.5 text-left">{{ prefs.txt("ভাউচার", "Voucher") }}</th>
                        <th class="px-2 py-1.5 text-left">{{ prefs.txt("সরবরাহকারী", "Supplier") }}</th>
                        <th class="px-2 py-1.5 text-right">{{ prefs.txt("পরিমাণ", "Qty") }}</th>
                        <th class="px-2 py-1.5 text-right">{{ prefs.txt("মোট মূল্য", "Amount") }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      @for (row of purchaseHistory(); track row.purchase.id) {
                        <tr class="transition-colors" [class]="row.received ? 'hover:bg-teal-50/40' : 'bg-slate-50/50 text-slate-400'">
                          <td class="px-2 py-2 font-mono whitespace-nowrap">{{ row.purchase.date }}</td>
                          <td class="px-2 py-2 whitespace-nowrap">
                            <span class="font-mono font-semibold" [class]="row.received ? 'text-teal-700' : 'text-slate-500'">{{ row.purchase.invoice }}</span>
                            @if (!row.received) {
                              <span class="ml-1 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700" [title]="prefs.txt('এখনো স্টকে যোগ হয়নি', 'Not added to stock yet')">{{ row.purchase.status }}</span>
                            }
                          </td>
                          <td class="px-2 py-2 max-w-[140px] truncate" [title]="row.purchase.supplierName">{{ row.purchase.supplierName || '—' }}</td>
                          <td class="px-2 py-2 text-right font-mono font-bold whitespace-nowrap" [class]="row.received ? 'text-teal-800' : ''">{{ row.quantity }} {{ p.unit }}</td>
                          <td class="px-2 py-2 text-right font-mono whitespace-nowrap">{{ row.amount | number:'1.2-2' }} TK</td>
                        </tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr class="bg-slate-50/80 border-t border-slate-200 text-[10px]">
                        <td colspan="3" class="px-2 py-1.5 text-right font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt("মোট", "Total") }}</td>
                        <td class="px-2 py-1.5 text-right font-mono font-bold tabular-nums text-teal-800">{{ purchaseHistorySummary().receivedQty }} {{ p.unit }}</td>
                        <td class="px-2 py-1.5 text-right font-mono font-bold tabular-nums text-slate-900">{{ purchaseHistorySummary().amount | number:'1.2-2' }} TK</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p class="mt-1.5 text-[10px] leading-relaxed text-slate-400">{{ prefs.txt("শুধু Received ক্রয় স্টকে যোগ হয়; অন্যান্য অবস্থার ভাউচার তথ্যের জন্য দেখানো হচ্ছে।", "Only Received purchases add to stock; other vouchers are shown for reference.") }}</p>
              } @else {
                <p class="py-3 text-center text-[11px] text-slate-400">{{ prefs.txt("এই পণ্যের কোনো ক্রয় রেকর্ড নেই।", "No purchase records for this product.") }}</p>
              }
            </div>

            <!-- Sales History -->
            <div>
              <h4 class="font-bold text-xs text-slate-900 border-b border-slate-200 pb-1 mb-1 flex items-center justify-between gap-2">
                <span>{{ prefs.txt("বিক্রয় হিস্টরি", "Sales History") }}</span>
                @if (salesHistory().length) {
                  <span class="text-[10px] font-semibold text-slate-400">{{ salesHistory().length }} {{ prefs.txt("টি বিক্রয়", "sales") }}</span>
                }
              </h4>

              @if (salesHistory().length) {
                <div class="grid grid-cols-3 gap-2 mt-1.5 mb-2">
                  <div class="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5 text-center">
                    <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt("বিক্রয়", "Sales") }}</span>
                    <span class="block font-mono font-bold text-sm text-slate-900 mt-0.5">{{ salesHistorySummary().entries }}</span>
                  </div>
                  <div class="rounded-lg bg-teal-50/70 border border-teal-200 px-2 py-1.5 text-center">
                    <span class="block text-[9px] font-bold uppercase tracking-wide text-teal-700">{{ prefs.txt("বিক্রি হয়েছে", "Sold") }}</span>
                    <span class="block font-mono font-bold text-sm text-teal-900 mt-0.5">{{ salesHistorySummary().soldQty }} {{ p.unit }}</span>
                  </div>
                  <div class="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5 text-center">
                    <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt("সর্বশেষ বিক্রয়", "Last Sale") }}</span>
                    <span class="block font-mono font-bold text-sm text-slate-900 mt-0.5">{{ salesHistorySummary().lastDate || '—' }}</span>
                  </div>
                </div>

                <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table class="w-full text-[11px] border-collapse">
                    <thead>
                      <tr class="bg-slate-50/80 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">
                        <th class="px-2 py-1.5 text-left">{{ prefs.txt("তারিখ", "Date") }}</th>
                        <th class="px-2 py-1.5 text-left">{{ prefs.txt("ভাউচার", "Voucher") }}</th>
                        <th class="px-2 py-1.5 text-left">{{ prefs.txt("ক্রেতা", "Customer") }}</th>
                        <th class="px-2 py-1.5 text-right">{{ prefs.txt("পরিমাণ", "Qty") }}</th>
                        <th class="px-2 py-1.5 text-right">{{ prefs.txt("মোট মূল্য", "Amount") }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      @for (row of salesHistory(); track row.sale.id) {
                        <tr class="transition-colors" [class]="row.cancelled ? 'bg-slate-50/50 text-slate-400' : 'hover:bg-teal-50/40'">
                          <td class="px-2 py-2 font-mono whitespace-nowrap">{{ row.sale.date }}</td>
                          <td class="px-2 py-2 whitespace-nowrap">
                            <span class="font-mono font-semibold" [class]="row.cancelled ? 'text-slate-500' : 'text-teal-700'">{{ row.sale.invoice }}</span>
                            @if (row.cancelled) {
                              <span class="ml-1 inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-700" [title]="prefs.txt('বাতিল ভাউচার হিসাবে ধরা হয়নি', 'Cancelled voucher, excluded from totals')">{{ row.sale.status }}</span>
                            }
                          </td>
                          <td class="px-2 py-2 max-w-[140px] truncate" [title]="row.sale.customerName">{{ row.sale.customerName || '—' }}</td>
                          <td class="px-2 py-2 text-right font-mono font-bold whitespace-nowrap" [class]="row.cancelled ? '' : 'text-teal-800'">{{ row.quantity }} {{ p.unit }}</td>
                          <td class="px-2 py-2 text-right font-mono whitespace-nowrap">{{ row.amount | number:'1.2-2' }} TK</td>
                        </tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr class="bg-slate-50/80 border-t border-slate-200 text-[10px]">
                        <td colspan="3" class="px-2 py-1.5 text-right font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt("মোট", "Total") }}</td>
                        <td class="px-2 py-1.5 text-right font-mono font-bold tabular-nums text-teal-800">{{ salesHistorySummary().soldQty }} {{ p.unit }}</td>
                        <td class="px-2 py-1.5 text-right font-mono font-bold tabular-nums text-slate-900">{{ salesHistorySummary().amount | number:'1.2-2' }} TK</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p class="mt-1.5 text-[10px] leading-relaxed text-slate-400">{{ prefs.txt("বাতিল বিক্রয় হিস্টরিতে তথ্যের জন্য দেখানো হচ্ছে, মোট হিসাবে ধরা হয়নি।", "Cancelled sales are shown for reference and left out of the totals.") }}</p>
              } @else {
                <p class="py-3 text-center text-[11px] text-slate-400">{{ prefs.txt("এই পণ্যের কোনো বিক্রয় রেকর্ড নেই।", "No sales records for this product.") }}</p>
              }
            </div>

            <!-- Pricing & Barcode -->
            <div>
              <h4 class="font-bold text-xs text-slate-900 border-b border-slate-200 pb-1 mb-1">{{ prefs.txt("মূল্য ও বারকোড", "Pricing & Barcode") }}</h4>
              <dl class="divide-y divide-slate-100">
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("এমআরপি", "MRP") }}</dt>
                  <dd class="font-mono font-semibold text-slate-800">{{ (p.mrp ?? 0) | number:'1.2-2' }} TK</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("ক্রয় মূল্য", "Purchase Price") }}</dt>
                  <dd class="font-mono font-semibold text-slate-800">{{ p.purchasePrice | number:'1.2-2' }} TK</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("পাইকারি মূল্য", "Wholesale Price") }}</dt>
                  <dd class="font-mono font-semibold text-slate-800">{{ p.wholesalePrice | number:'1.2-2' }} TK</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("বিক্রয় মূল্য", "Sales Price") }}</dt>
                  <dd class="font-mono font-bold text-teal-700">{{ p.salesPrice | number:'1.2-2' }} TK</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("ট্যাক্স", "Tax") }}</dt>
                  <dd class="font-semibold text-slate-800">{{ p.tax ?? 0 }}%</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("বারকোড সিম্বলজি", "Barcode Symbology") }}</dt>
                  <dd class="font-semibold text-slate-800">{{ p.barcodeSymbology || '—' }}</dd>
                </div>
                <div class="flex items-center justify-between py-2">
                  <dt class="text-slate-500 font-medium">{{ prefs.txt("আইটেম কোড", "Item Code") }}</dt>
                  <dd class="font-mono font-semibold text-slate-800">{{ p.code }}</dd>
                </div>
              </dl>
            </div>

          </div>

          <!-- Drawer Footer -->
          <div class="bg-white border-t border-slate-200 p-4 flex items-center justify-end gap-2.5 sticky bottom-0 z-20">
            <button (click)="editFromView(p)" class="bg-teal-500 hover:bg-teal-600 text-white font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer">
              <mat-icon class="text-sm">edit</mat-icon> {{ prefs.txt("পণ্য এডিট", "Edit Product") }}
            </button>
            <button (click)="closeView()" class="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold px-4 py-2 rounded-lg text-xs transition-colors cursor-pointer">
              {{ prefs.txt("বন্ধ", "Close") }}
            </button>
          </div>

        </div>
      </div>
    }

    <!-- Quick Add Category Modal -->
    @if (showQuickAddCategoryModal()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[60] flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden text-slate-800 animate-in zoom-in-95 duration-200">
          <div class="bg-slate-50 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-sm text-slate-900 flex items-center gap-2">
              <mat-icon class="text-teal-600 text-base">folder_open</mat-icon> {{ prefs.txt("নতুন ক্যাটাগরি যোগ করুন", "Add New Category") }}
            </h3>
            <button (click)="showQuickAddCategoryModal.set(false)" class="text-slate-400 hover:text-slate-600 cursor-pointer">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          <div class="p-5 space-y-4 text-xs">
            @if (quickAddError()) {
              <div class="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                <mat-icon class="text-sm shrink-0">error_outline</mat-icon>
                <span>{{ quickAddError() }}</span>
              </div>
            }
            <div>
              <label class="block font-semibold mb-1 text-slate-700">* {{ prefs.txt("ক্যাটাগরির নাম", "Category Name") }}</label>
              <input type="text" [(ngModel)]="quickCategoryName" [placeholder]="prefs.txt('ক্যাটাগরির নাম লিখুন', 'Enter Category Name')" class="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 font-medium">
            </div>
          </div>

          <div class="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="showQuickAddCategoryModal.set(false)" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-slate-700 cursor-pointer">{{ prefs.txt("বাতিল", "Cancel") }}</button>
            <button (click)="saveQuickCategory()" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg cursor-pointer">{{ prefs.txt("ক্যাটাগরি সংরক্ষণ", "Save Category") }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Quick Add Sub Category Modal -->
    @if (showQuickAddSubCategoryModal()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[60] flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden text-slate-800 animate-in zoom-in-95 duration-200">
          <div class="bg-slate-50 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-sm text-slate-900 flex items-center gap-2">
              <mat-icon class="text-teal-600 text-base">folder_open</mat-icon> {{ prefs.txt("নতুন সাব ক্যাটাগরি যোগ করুন", "Add New Sub Category") }}
            </h3>
            <button (click)="showQuickAddSubCategoryModal.set(false)" class="text-slate-400 hover:text-slate-600 cursor-pointer">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          <div class="p-5 space-y-4 text-xs">
            @if (quickAddError()) {
              <div class="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                <mat-icon class="text-sm shrink-0">error_outline</mat-icon>
                <span>{{ quickAddError() }}</span>
              </div>
            }
            <div>
              <label class="block font-semibold mb-1 text-slate-700">* {{ prefs.txt("সাব ক্যাটাগরির নাম", "Sub Category Name") }}</label>
              <input type="text" [(ngModel)]="quickSubCategoryName" [placeholder]="prefs.txt('সাব ক্যাটাগরির নাম লিখুন', 'Enter Sub Category Name')" class="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 font-medium">
            </div>
            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("প্যারেন্ট ক্যাটাগরি", "Parent Category") }}</label>
              <select [(ngModel)]="quickSubCategoryParent" class="w-full border border-slate-300 rounded-lg p-2.5 bg-white font-medium">
                <option value="">{{ prefs.txt("ক্যাটাগরি নির্বাচন করুন...", "Select Category...") }}</option>
                @for (c of dataService.categories(); track c.id) {
                  <option [value]="c.name">{{ c.name }}</option>
                }
              </select>
            </div>
          </div>

          <div class="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="showQuickAddSubCategoryModal.set(false)" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-slate-700 cursor-pointer">{{ prefs.txt("বাতিল", "Cancel") }}</button>
            <button (click)="saveQuickSubCategory()" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg cursor-pointer">{{ prefs.txt("সাব ক্যাটাগরি সংরক্ষণ", "Save Sub Category") }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Quick Add Brand Modal -->
    @if (showQuickAddBrandModal()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[60] flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden text-slate-800 animate-in zoom-in-95 duration-200">
          <div class="bg-slate-50 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-sm text-slate-900 flex items-center gap-2">
              <mat-icon class="text-teal-600 text-base">sell</mat-icon> {{ prefs.txt("নতুন ব্র্যান্ড যোগ করুন", "Add New Brand") }}
            </h3>
            <button (click)="showQuickAddBrandModal.set(false)" class="text-slate-400 hover:text-slate-600 cursor-pointer">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          <div class="p-5 space-y-4 text-xs">
            @if (quickAddError()) {
              <div class="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                <mat-icon class="text-sm shrink-0">error_outline</mat-icon>
                <span>{{ quickAddError() }}</span>
              </div>
            }
            <div>
              <label class="block font-semibold mb-1 text-slate-700">* {{ prefs.txt("ব্র্যান্ডের নাম", "Brand Name") }}</label>
              <input type="text" [(ngModel)]="quickBrandName" [placeholder]="prefs.txt('ব্র্যান্ডের নাম লিখুন', 'Enter Brand Name')" class="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 font-medium">
            </div>
          </div>

          <div class="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="showQuickAddBrandModal.set(false)" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-slate-700 cursor-pointer">{{ prefs.txt("বাতিল", "Cancel") }}</button>
            <button (click)="saveQuickBrand()" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg cursor-pointer">{{ prefs.txt("ব্র্যান্ড সংরক্ষণ", "Save Brand") }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Quick Add Product Model Modal -->
    @if (showQuickAddModelsModal()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[60] flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden text-slate-800 animate-in zoom-in-95 duration-200">
          <div class="bg-slate-50 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-sm text-slate-900 flex items-center gap-2">
              <mat-icon class="text-teal-600 text-base">widgets</mat-icon> {{ prefs.txt("নতুন প্রোডাক্ট মডেল যোগ করুন", "Add New Product Model") }}
            </h3>
            <button (click)="showQuickAddModelsModal.set(false)" class="text-slate-400 hover:text-slate-600 cursor-pointer">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          <div class="p-5 space-y-4 text-xs">
            @if (quickAddError()) {
              <div class="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                <mat-icon class="text-sm shrink-0">error_outline</mat-icon>
                <span>{{ quickAddError() }}</span>
              </div>
            }
            <div>
              <label class="block font-semibold mb-1 text-slate-700">* {{ prefs.txt("মডেলের নাম", "Model Name") }}</label>
              <input type="text" [(ngModel)]="quickModelName" [placeholder]="prefs.txt('মডেলের নাম লিখুন', 'Enter Product Model Name')" class="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 font-medium">
            </div>
          </div>

          <div class="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="showQuickAddModelsModal.set(false)" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-slate-700 cursor-pointer">{{ prefs.txt("বাতিল", "Cancel") }}</button>
            <button (click)="saveQuickModel()" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg cursor-pointer">{{ prefs.txt("মডেল সংরক্ষণ", "Save Model") }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Quick Add Unit Modal -->
    @if (showQuickAddUnitModal()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[60] flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden text-slate-800 animate-in zoom-in-95 duration-200">
          <div class="bg-slate-50 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-sm text-slate-900 flex items-center gap-2">
              <mat-icon class="text-teal-600 text-base">straighten</mat-icon> {{ prefs.txt("নতুন একক যোগ করুন", "Add New Unit") }}
            </h3>
            <button (click)="showQuickAddUnitModal.set(false)" class="text-slate-400 hover:text-slate-600 cursor-pointer">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          <div class="p-5 space-y-4 text-xs">
            @if (quickAddError()) {
              <div class="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                <mat-icon class="text-sm shrink-0">error_outline</mat-icon>
                <span>{{ quickAddError() }}</span>
              </div>
            }
            <div>
              <label class="block font-semibold mb-1 text-slate-700">* {{ prefs.txt("এককের নাম (যেমন: লিটার, বক্স, কার্টন)", "Unit Name (e.g., Litre, Box, Carton)") }}</label>
              <input type="text" [(ngModel)]="quickUnitName" [placeholder]="prefs.txt('এককের নাম লিখুন', 'Enter Unit Name')" class="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 font-medium">
            </div>
          </div>

          <div class="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="showQuickAddUnitModal.set(false)" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-slate-700 cursor-pointer">{{ prefs.txt("বাতিল", "Cancel") }}</button>
            <button (click)="saveQuickUnit()" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg cursor-pointer">{{ prefs.txt("একক সংরক্ষণ", "Save Unit") }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Edit Variation Modal matching Edit_Variation_bb18fe79.png -->
    @if (showEditVariationModal()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[70] flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden text-slate-800 animate-in zoom-in-95 duration-200">
          
          <div class="p-5 pb-2 border-b border-slate-100 flex items-center justify-between">
            <h3 class="font-bold text-base text-slate-900">{{ prefs.txt("ভ্যারিয়েশন এডিট", "Edit Variation") }}</h3>
            <button (click)="showEditVariationModal.set(false)" class="text-slate-400 hover:text-slate-600 cursor-pointer">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          <div class="p-5 space-y-4 text-xs overflow-y-auto max-h-[75vh]">

            @if (variantEditError()) {
              <div class="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                <mat-icon class="text-sm shrink-0">error_outline</mat-icon>
                <span>{{ variantEditError() }}</span>
              </div>
            }

            <!-- Top Row: Image Upload & Item Code -->
            <div class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-start">
              <!-- Image Box -->
              <div class="sm:col-span-4 flex flex-col items-center">
                <label class="block font-semibold mb-1 text-slate-700 self-start">{{ prefs.txt("ইমেজ", "Image") }}</label>
                <label class="w-28 h-28 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-teal-500 bg-slate-50 transition-colors relative overflow-hidden group">
                  @if (editVariantImagePreview()) {
                    <img [src]="editVariantImagePreview()" [attr.alt]="prefs.txt('ভ্যারিয়েন্ট প্রিভিউ', 'Variant Preview')" class="w-full h-full object-cover rounded-lg" loading="lazy" decoding="async">
                    <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold transition-opacity">{{ prefs.txt("পরিবর্তন করুন", "Change") }}</div>
                  } @else {
                    <mat-icon class="text-slate-400 text-xl mb-1">add</mat-icon>
                    <span class="text-slate-500 text-[11px] font-medium">{{ prefs.txt("আপলোড", "Upload") }}</span>
                  }
                  <input type="file" [accept]="imageAccept" (change)="onEditVariantImageSelect($event)" class="hidden">
                </label>
              </div>

              <!-- Item Code, Quantity Alert & MRP -->
              <div class="sm:col-span-8 space-y-3">
                <div>
                  <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("আইটেম কোড", "Item Code") }}</label>
                  <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                    <mat-icon class="text-slate-400 text-sm mr-2">grid_3x3</mat-icon>
                    <input type="text" autocomplete="off" [(ngModel)]="editVariantItemCode" (input)="variantEditError.set('')" [placeholder]="prefs.txt('আইটেম কোড লিখুন', 'Enter Item Code')" class="w-full bg-transparent outline-none text-xs font-mono font-bold text-slate-900">
                    <button type="button" (click)="generateEditVariantCode()" class="text-slate-400 hover:text-slate-700 px-1 cursor-pointer" [title]="prefs.txt('কোড তৈরি করুন', 'Generate Code')">
                      <mat-icon class="text-sm">qr_code_scanner</mat-icon>
                    </button>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700 flex items-center gap-1">
                      {{ prefs.txt("কোয়ান্টিটি অ্যালার্ট", "Quantity Alert") }} <mat-icon class="text-slate-400 text-[10px]">info</mat-icon>
                    </label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <mat-icon class="text-slate-400 text-sm mr-1">subtitles</mat-icon>
                      <input type="number" min="0" [(ngModel)]="editVariantQuantityAlert" class="w-full bg-transparent outline-none text-xs font-bold text-slate-900">
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("এমআরপি", "MRP") }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <span class="text-slate-500 font-bold text-xs mr-1">TK</span>
                      <input type="number" min="0" [(ngModel)]="editVariantMrp" class="w-full bg-transparent outline-none text-xs font-bold text-slate-900">
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Tax -->
            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("ট্যাক্স", "Tax") }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">subtitles</mat-icon>
                <select [(ngModel)]="editVariantTax" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                  <option value="">{{ prefs.txt("ট্যাক্স নির্বাচন করুন...", "Select Tax...") }}</option>
                  <option value="0">{{ prefs.txt("ট্যাক্স নেই (0%)", "No Tax (0%)") }}</option>
                  <option value="5">{{ prefs.txt("ভ্যাট 5%", "VAT 5%") }}</option>
                  <option value="10">{{ prefs.txt("ভ্যাট 10%", "VAT 10%") }}</option>
                  <option value="15">{{ prefs.txt("ভ্যাট 15%", "VAT 15%") }}</option>
                </select>
              </div>
            </div>

            <!-- Purchase Price & Wholesale Price -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("ক্রয় মূল্য", "Purchase Price") }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-500">
                  <span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-1.5 border-r border-slate-300">TK</span>
                  <input type="number" min="0" [(ngModel)]="editVariantPurchasePrice" class="w-full p-1.5 outline-none text-xs font-bold text-slate-900">
                  <select [(ngModel)]="editVariantPurchaseTaxType" class="bg-slate-50 border-l border-slate-300 px-2 py-1.5 text-xs text-slate-600 outline-none">
                    <option value="without">{{ prefs.txt("ট্যাক্স ছাড়া", "Without Tax") }}</option>
                    <option value="with">{{ prefs.txt("ট্যাক্স সহ", "With Tax") }}</option>
                  </select>
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("পাইকারি মূল্য", "Wholesale Price") }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-500">
                  <span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-1.5 border-r border-slate-300">TK</span>
                  <input type="number" min="0" [(ngModel)]="editVariantWholesalePrice" class="w-full p-1.5 outline-none text-xs font-bold text-slate-900">
                </div>
              </div>
            </div>

            <!-- Sales Price & Wholesale Quantity -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("বিক্রয় মূল্য", "Sales Price") }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-500">
                  <span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-1.5 border-r border-slate-300">TK</span>
                  <input type="number" min="0" [(ngModel)]="editVariantSalesPrice" class="w-full p-1.5 outline-none text-xs font-bold text-slate-900">
                  <select [(ngModel)]="editVariantSalesTaxType" class="bg-slate-50 border-l border-slate-300 px-2 py-1.5 text-xs text-slate-600 outline-none">
                    <option value="without">{{ prefs.txt("ট্যাক্স ছাড়া", "Without Tax") }}</option>
                    <option value="with">{{ prefs.txt("ট্যাক্স সহ", "With Tax") }}</option>
                  </select>
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("পাইকারি পরিমাণ", "Wholesale Quantity") }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-1">subtitles</mat-icon>
                  <input type="number" min="0" [(ngModel)]="editVariantWholesaleQuantity" [placeholder]="prefs.txt('ন্যূনতম পরিমাণ লিখুন', 'Enter Minimum Quantity')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-900">
                </div>
              </div>
            </div>

            <!-- Opening Stock & Opening Stock Date -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("প্রারম্ভিক স্টক", "Opening Stock") }}
                  @if (isEditMode() && !variantOpeningUnlocked() && canEditStock()) {
                    <button type="button" (click)="askOpeningUnlock('variant')" class="ml-1 inline-flex items-center gap-0.5 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 hover:bg-amber-100 cursor-pointer align-middle transition-colors">
                      <mat-icon style="font-size:10px;width:10px;height:10px;">key</mat-icon> {{ prefs.txt('আনলক', 'Unlock') }}
                    </button>
                  }
                </label>
                @if ((!isEditMode() || variantOpeningUnlocked()) && canEditStock()) {
                  <div class="flex items-center border rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-500 px-2 py-1" [class]="isEditMode() ? 'border-2 border-teal-400' : 'border-slate-300'">
                    <mat-icon class="text-slate-400 text-sm mr-1">subtitles</mat-icon>
                    <input id="variant-opening-stock" type="number" min="0" [(ngModel)]="editVariantOpeningStock" class="w-full outline-none text-xs font-bold text-slate-900">
                    <span class="text-slate-500 font-medium text-xs px-1">{{ formUnit || prefs.txt("একক", "Unit") }}</span>
                    @if (isEditMode()) {
                      <button type="button" (click)="lockOpening('variant')" class="shrink-0 p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer" [title]="prefs.txt('আবার লক করুন', 'Lock again')">
                        <mat-icon class="text-sm">lock</mat-icon>
                      </button>
                    }
                  </div>
                } @else {
                  <div class="flex items-center border border-slate-200 rounded-lg px-2 py-1.5 bg-slate-100">
                    <mat-icon class="text-slate-400 text-sm mr-1">lock</mat-icon>
                    <span class="w-full font-mono font-bold text-xs text-slate-700">{{ editVariantOpeningStock }} {{ formUnit || prefs.txt("একক", "Unit") }}</span>
                  </div>
                }
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("প্রারম্ভিক স্টকের তারিখ", "Opening Stock Date") }}</label>
                @if (!isEditMode() || variantOpeningUnlocked()) {
                  <div class="flex items-center border rounded-lg px-2 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500" [class]="isEditMode() ? 'border-2 border-teal-400' : 'border-slate-300'">
                    <mat-icon class="text-teal-600 text-sm mr-1.5">calendar_today</mat-icon>
                    <input id="variant-opening-date" type="date" appDmyDate [(ngModel)]="editVariantOpeningStockDate" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                  </div>
                } @else {
                  <div class="flex items-center border border-slate-200 rounded-lg px-2 py-1.5 bg-slate-100">
                    <mat-icon class="text-slate-400 text-sm mr-1.5">lock</mat-icon>
                    <span class="w-full font-mono font-bold text-xs text-slate-700">{{ editVariantOpeningStockDate || '—' }}</span>
                  </div>
                }
              </div>
            </div>

          </div>

          <!-- Footer Buttons matching Edit_Variation_bb18fe79.png -->
          <div class="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button type="button" (click)="saveVariantEdit()" class="px-5 py-2 bg-teal-500 hover:bg-teal-600 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs cursor-pointer transition-colors">
              <mat-icon class="text-sm">check_circle</mat-icon> {{ prefs.txt("হালনাগাদ করুন", "Update") }}
            </button>
            <button type="button" (click)="showEditVariationModal.set(false)" class="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer transition-colors">
              {{ prefs.txt("বাতিল", "Cancel") }}
            </button>
          </div>

        </div>
      </div>
    }

    <!-- Product hover info is shown as plain text via the title attribute. -->

    @if (openingPasscodeFor()) {
      <app-passcode-modal
        [title]="prefs.txt('প্রারম্ভিক স্টক আনলক করুন', 'Unlock opening stock')"
        [message]="prefs.txt('প্রারম্ভিক স্টক ও তারিখ বদলানো শুধু অ্যাডমিনের জন্য। এডিট করতে Admin PIN দিন।', 'Changing opening stock and its date is Admin-only. Enter the Admin PIN to edit.')"
        [elevate]="openingPasscodeFor() === 'variant'"
        (verified)="onOpeningVerified()"
        (close)="openingPasscodeFor.set(null)"
      />
    }

  `,
  styles: [`
    @keyframes drawerSlideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
    @keyframes drawerFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .drawer-slide-in {
      animation: drawerSlideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .drawer-backdrop {
      animation: drawerFadeIn 0.2s ease-out both;
    }
    .invalid-field {
      border-color: #fb7185 !important;
      box-shadow: 0 0 0 2px rgba(251, 113, 133, 0.25) !important;
    }
  `]
})
export class Products {
  dataService = inject(DataService);
  readonly prefs = inject(PreferencesService);
  readonly session = inject(SessionService);

  /** Stock numbers follow the owner lock; the grant lets a chosen user edit them while unlocked. */
  readonly canEditStock = computed(() => {
    const user = this.session.currentUser();
    if (!user) return false;
    if (this.session.isMain(user)) return true;
    if (this.dataService.voucherSettings().lockStock) return false;
    return user.role === 'Admin' || this.session.has('editStock');
  });
  readonly noImage = NO_IMAGE;
  private notify = inject(NotificationService);
  private media = inject(MediaService);
  readonly imageAccept = IMAGE_ACCEPT;

  activeTab = signal<string>('all');
  selectedBrand = signal<string>('');
  selectedModel = signal<string>('');
  selectedCategory = signal<string>('');
  searchQuery = signal<string>('');
  readonly importing = signal(false);

  /** Categories with their sub-categories, for one grouped filter dropdown. */
  readonly categoryFilterTree = computed(() => {
    const subs = this.dataService.subCategories();
    return this.dataService.categories().map(category => ({
      id: category.id,
      name: category.name,
      subs: subs
        .filter(sc => this.sameCategory(sc.parentCategory, category.name))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    }));
  });

  /** Decoded category/sub-category filter; `c:` = whole category, `s:` = one sub-category. */
  readonly categoryFilterMatch = computed<{ category: string; subCategory: string }>(() => {
    const value = this.selectedCategory();
    if (!value) return { category: '', subCategory: '' };
    if (value.startsWith('s:')) {
      const id = Number(value.slice(2));
      const sub = this.dataService.subCategories().find(sc => sc.id === id);
      return { category: sub?.parentCategory ?? '', subCategory: sub?.name ?? '' };
    }
    if (value.startsWith('c:')) {
      const id = Number(value.slice(2));
      const category = this.dataService.categories().find(c => c.id === id);
      return { category: category?.name ?? '', subCategory: '' };
    }
    return { category: value, subCategory: '' };
  });

  private sameCategory(a: string, b: string): boolean {
    return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
  }

  // Stock-on-hand filter: quick buckets or an exact min–max range.
  stockMode = signal<'all' | 'in' | 'low' | 'out' | 'range'>('all');
  stockMin = signal<number | null>(null);
  stockMax = signal<number | null>(null);
  stockMinInput = signal<string>('');
  stockMaxInput = signal<string>('');
  showStockFilter = signal<boolean>(false);
  readonly stockQuickOptions: { mode: 'all' | 'in' | 'low' | 'out'; bn: string; en: string }[] = [
    { mode: 'all', bn: 'সব স্টক', en: 'All stock' },
    { mode: 'in', bn: 'স্টক আছে', en: 'In stock' },
    { mode: 'low', bn: 'কম স্টক ১–৫', en: 'Low 1–5' },
    { mode: 'out', bn: 'স্টক নেই', en: 'Out of stock' }
  ];
  stockFilterActive = computed(() => this.stockMode() !== 'all');
  showAddModal = signal<boolean>(false);
  viewingProduct = signal<Product | null>(null);
  readonly purchaseHistory = computed<PurchaseHistoryRow[]>(() => {
    const product = this.viewingProduct();
    if (!product) return [];
    const rows: PurchaseHistoryRow[] = [];
    for (const purchase of this.dataService.purchases()) {
      // The item code survives catalogue re-imports that mint a new product id.
      const lines = (purchase.items ?? []).filter(item =>
        item.productId === product.id
        || (!!item.itemCode && item.itemCode === product.code)
        || (!item.productId && item.productName === product.name));
      if (!lines.length) continue;
      rows.push({
        purchase,
        quantity: lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
        amount: lines.reduce((sum, line) =>
          sum + (Number(line.subtotal) || (Number(line.quantity) || 0) * (Number(line.purchasePrice) || 0)), 0),
        received: purchase.status === 'Received'
      });
    }
    return rows.sort((a, b) => this.purchaseSortKey(b.purchase).localeCompare(this.purchaseSortKey(a.purchase)));
  });
  readonly purchaseHistorySummary = computed(() => {
    const rows = this.purchaseHistory();
    return {
      entries: rows.length,
      receivedQty: rows.filter(row => row.received).reduce((sum, row) => sum + row.quantity, 0),
      amount: rows.reduce((sum, row) => sum + row.amount, 0),
      lastDate: rows.length ? rows[0].purchase.date : ''
    };
  });
  readonly salesHistory = computed<SalesHistoryRow[]>(() => {
    const product = this.viewingProduct();
    if (!product) return [];
    const rows: SalesHistoryRow[] = [];
    for (const sale of this.dataService.sales()) {
      // Older lines carry no product id, so the name is the only link left.
      const lines = (sale.items ?? []).filter(item =>
        item.productId === product.id
        || (!item.productId && item.productName === product.name));
      if (!lines.length) continue;
      rows.push({
        sale,
        quantity: lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
        amount: lines.reduce((sum, line) =>
          sum + (Number(line.total) || (Number(line.quantity) || 0) * (Number(line.salesPrice) || 0)), 0),
        cancelled: sale.status === 'Cancelled'
      });
    }
    return rows.sort((a, b) => this.saleSortKey(b.sale).localeCompare(this.saleSortKey(a.sale)));
  });
  readonly salesHistorySummary = computed(() => {
    const rows = this.salesHistory();
    return {
      entries: rows.length,
      soldQty: rows.filter(row => !row.cancelled).reduce((sum, row) => sum + row.quantity, 0),
      amount: rows.filter(row => !row.cancelled).reduce((sum, row) => sum + row.amount, 0),
      lastDate: rows.length ? rows[0].sale.date : ''
    };
  });
  viewMode = persistedSignal<'list' | 'grid'>('sm_products_view_v1', 'list', value => value === 'grid' ? 'grid' : 'list');
  isEditMode = signal<boolean>(false);
  editingProductId = signal<number | null>(null);

  private destroyRef = inject(DestroyRef);

  constructor() {
    // Header global search lands here with ?q= — without this the query never reaches the list.
    // The stock bell adds ?stock=low|out so it opens exactly that filtered list.
    inject(ActivatedRoute).queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const stock = params.get('stock');
      const stockMode = stock === 'in' || stock === 'low' || stock === 'out' ? stock : null;
      if (stockMode) this.applyStockMode(stockMode);
      const q = params.get('q');
      if (q) this.searchQuery.set(q);
      else if (stockMode) this.searchQuery.set('');
      this.resetPage();
    });

    if (typeof document === 'undefined') return;
    const closeCombosOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (this.showStockFilter() && !target?.closest('[data-stock-filter-root]')) {
        this.showStockFilter.set(false);
      }
      if (target?.closest('[data-combo-root]')) return;
      if (this.comboOpen()) this.closeCombo();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (this.showStockFilter()) {
        this.showStockFilter.set(false);
      } else if (this.comboOpen()) {
        this.closeCombo();
      } else if (this.showEditVariationModal()) {
        this.showEditVariationModal.set(false);
      } else if (this.showQuickAddCategoryModal()) {
        this.showQuickAddCategoryModal.set(false);
      } else if (this.showQuickAddSubCategoryModal()) {
        this.showQuickAddSubCategoryModal.set(false);
      } else if (this.showQuickAddBrandModal()) {
        this.showQuickAddBrandModal.set(false);
      } else if (this.showQuickAddModelsModal()) {
        this.showQuickAddModelsModal.set(false);
      } else if (this.showQuickAddUnitModal()) {
        this.showQuickAddUnitModal.set(false);
      } else if (this.showAddModal()) {
        this.requestCloseForm();
      } else if (this.viewingProduct()) {
        this.closeView();
      }
    };
    document.addEventListener('click', closeCombosOnOutsideClick);
    document.addEventListener('keydown', handleEscape);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('click', closeCombosOnOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    });
  }

  totalProducts = computed(() => this.dataService.products().length);
  singleCount = computed(() => this.searchFiltered('single').length);
  variantCount = computed(() => this.searchFiltered('variant').length);
  serviceCount = computed(() => this.searchFiltered('service').length);
  allCount = computed(() => this.searchFiltered('all').length);
  stockValue = computed(() => this.dataService.products().reduce((sum, p) => sum + (Number(p.stock) || 0) * (Number(p.purchasePrice) || 0), 0));
  lowStockCount = computed(() => this.dataService.products().filter(p => p.type !== 'service' && p.stock > 0 && p.stock <= this.lowStockThreshold(p)).length);
  outOfStockCount = computed(() => this.dataService.products().filter(p => p.type !== 'service' && p.stock <= 0).length);
  activeFilters = computed(() => [this.selectedBrand(), this.selectedModel(), this.selectedCategory()].filter(v => !!v).length + (this.searchQuery().trim() ? 1 : 0) + (this.stockFilterActive() ? 1 : 0));

  selectedIds = signal<Set<number>>(new Set<number>());
  selectedCount = computed(() => this.selectedIds().size);
  allSelected = computed(() => {
    const list = this.pagedProducts();
    return list.length > 0 && list.every(p => this.selectedIds().has(p.id));
  });
  someSelected = computed(() => {
    const list = this.pagedProducts();
    const picked = list.filter(p => this.selectedIds().has(p.id)).length;
    return picked > 0 && picked < list.length;
  });

  page = signal(1);
  pageSize = persistedSignal<number>('sm_products_page_size_v1', 40, value => {
    const size = Number(value);
    return size === 0 || PAGE_SIZE_OPTIONS.includes(size) ? size : 40;
  });
  totalPages = computed(() => this.pageSize() === 0 ? 1 : Math.max(1, Math.ceil(this.totalRows() / this.pageSize())));
  currentPage = computed(() => Math.min(this.page(), this.totalPages()));
  pagedRows = computed<ProductRow[]>(() => {
    const rows = this.rows();
    if (this.pageSize() === 0) return rows;
    const start = (this.currentPage() - 1) * this.pageSize();
    return rows.slice(start, start + this.pageSize());
  });
  pagedProducts = computed(() => this.pagedRows().map(row => row.display));
  pageNumbers = computed(() => {
    const total = this.totalPages();
    const cur = this.currentPage();
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    let start = Math.max(1, cur - 3);
    const end = Math.min(total, start + 6);
    start = Math.max(1, end - 6);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  // Column visibility, order and widths — all user-adjustable and persisted
  showColumnSelector = signal<boolean>(false);
  tableLayout = signal<ColumnLayout>(loadColumnLayout(PRODUCT_TABLE_VIEW_KEY, PRODUCT_TABLE_COLUMNS));

  visibleCols = computed<ResolvedColumn[]>(() => {
    const layout = this.tableLayout();
    return layout.order
      .filter(key => layout.visible[key])
      .map(key => ({ ...PRODUCT_COL_SPECS[key], width: layout.widths[key] }));
  });

  tableWidthPx = computed(() => this.visibleCols().reduce((sum, col) => sum + col.width, 0));

  allColumns = computed(() => {
    const layout = this.tableLayout();
    return layout.order.map(key => ({
      key,
      label: PRODUCT_COL_SPECS[key].label,
      width: layout.widths[key],
      visible: !!layout.visible[key]
    }));
  });

  private readonly bnColLabels: Record<string, string> = {
    sel: 'নির্বাচন', sl: 'ক্রম', product: 'পণ্য', code: 'আইটেম কোড', rack: 'র‍্যাক', type: 'ধরন',
    category: 'ক্যাটাগরি', brand: 'ব্র্যান্ড', model: 'মডেল', stock: 'স্টক',
    sales: 'বিক্রয়', purchase: 'ক্রয়', wholesale: 'পাইকারি', unit: 'একক', action: 'অ্যাকশন'
  };

  /** Header text for the active language; specs keep the English label as the stored default. */
  colLabel(key: string): string {
    const spec = PRODUCT_COL_SPECS[key];
    const bn = this.bnColLabels[key];
    if (!spec || !bn) return spec?.label ?? key;
    return this.prefs.txt(bn, spec.label);
  }

  toggleColumnSelector() {
    this.showColumnSelector.update(v => !v);
  }

  // Reactive Form Inputs State matching Add Product.png
  formName = '';
  formSlug = '';
  formCategory = '';
  formSubCategory = '';
  formBrand = '';
  formModel = '';
  formUnit = '';
  /** Extra selling units; stock always stays counted in formUnit. */
  formUnits: { name: string; factor: number | string; price: number | string; inverse: boolean }[] = [];
  /** Dedicated multi-unit setup: one shared stock, unit picked at sale time. */
  formMultiUnit = false;
  formRack = '';
  formCode = '';
  formWarehouse = '';
  formQuantityAlert: number | string | null = '';
  formBarcodeSymbology = '';
  formTax = '';
  formMrp: number | string | null = '';
  formPurchasePrice: number | string | null = '';
  formPurchaseTaxMode = '';
  formSalesPrice: number | string | null = '';
  formSalesTaxMode = '';
  formWholesalePrice: number | string | null = '';
  formWholesaleQuantity: number | string | null = '';
  formWarrantyDays: number | string | null = '';
  formOpeningStock: number | string | null = '';
  formOpeningStockDate = '';
  /** The live stock number the edit drawer writes; opening stock stays the baseline. */
  formCurrentStock: number | string | null = '';
  readonly warrantyPresets: { days: number; bn: string; en: string }[] = [
    { days: 0, bn: 'না', en: 'None' },
    { days: 7, bn: '৭ দিন', en: '7 days' },
    { days: 30, bn: '৩০ দিন', en: '30 days' },
    { days: 90, bn: '৯০ দিন', en: '90 days' },
    { days: 180, bn: '৬ মাস', en: '6 months' },
    { days: 365, bn: '১ বছর', en: '1 year' }
  ];
  formType: 'single' | 'variant' | 'service' | '' = '';
  /** Friendly type picker: the three product shapes explained at a glance. */
  readonly productTypeOptions: { value: Product['type']; icon: string; bn: string; en: string }[] = [
    { value: 'single', icon: 'inventory_2', bn: 'সিঙ্গেল', en: 'Single' },
    { value: 'variant', icon: 'category', bn: 'ভ্যারিয়েন্ট', en: 'Variant' },
    { value: 'service', icon: 'handyman', bn: 'সার্ভিস', en: 'Service' }
  ];
  formImagePreview = signal<string>('');
  formError = signal<string>('');
  invalidFields = signal<string[]>([]);
  formDirty = signal<boolean>(false);
  /** Opening stock is a locked baseline; an Admin PIN unlocks it for this edit. */
  openingUnlocked = signal<boolean>(false);
  variantOpeningUnlocked = signal<boolean>(false);
  /** Which opening-stock editor is asking for the Admin PIN. */
  openingPasscodeFor = signal<'product' | 'variant' | null>(null);
  private slugTouched = false;

  quickAddError = signal<string>('');
  variantEditError = signal<string>('');

  editingCurrentStock = computed(() => {
    const id = this.editingProductId();
    if (!id) return 0;
    return this.dataService.products().find(p => p.id === id)?.stock ?? 0;
  });

  // Searchable category / sub category / brand / model dropdowns
  comboOpen = signal<ComboField | null>(null);
  comboSearch = signal<Record<ComboField, string>>({ category: '', subCategory: '', brand: '', model: '' });

  filteredCategories = computed(() => this.filterBySearch(this.dataService.categories(), this.comboSearch().category));
  filteredSubCategories = computed(() => {
    const category = this.formCategory;
    const items = category
      ? this.dataService.subCategories().filter(sc => sc.parentCategory === category)
      : this.dataService.subCategories();
    return this.filterBySearch(items, this.comboSearch().subCategory);
  });
  filteredBrands = computed(() => this.filterBySearch(this.dataService.brands(), this.comboSearch().brand));
  filteredModels = computed(() => this.filterBySearch(this.dataService.productModels(), this.comboSearch().model));

  private filterBySearch<T extends { name: string }>(items: T[], query: string): T[] {
    const q = query.trim().toLowerCase();
    return q ? items.filter(item => item.name.toLowerCase().includes(q)) : items;
  }

  isComboOpen(field: ComboField): boolean {
    return this.comboOpen() === field;
  }

  toggleCombo(field: ComboField) {
    if (this.comboOpen() === field) {
      this.closeCombo();
      return;
    }
    this.comboOpen.set(field);
    this.comboSearch.update(s => ({ ...s, [field]: '' }));
    if (typeof document !== 'undefined') {
      window.setTimeout(() => document.getElementById(`combo-${field}-search`)?.focus({ preventScroll: true }), 0);
    }
  }

  closeCombo() {
    this.comboOpen.set(null);
  }

  onComboSearch(field: ComboField, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.comboSearch.update(s => ({ ...s, [field]: value }));
  }

  selectCombo(field: ComboField, value: string) {
    if (field === 'category') {
      this.formCategory = value;
      const subCategories = this.dataService.subCategories();
      const valid = !value || subCategories.some(sc => sc.parentCategory === value && sc.name === this.formSubCategory);
      if (!valid) this.formSubCategory = '';
    } else if (field === 'subCategory') {
      this.formSubCategory = value;
    } else if (field === 'brand') {
      this.formBrand = value;
    } else {
      this.formModel = value;
    }
    this.onFormActivity();
    this.closeCombo();
  }

  /** Models already chosen in the form (the field stores them comma-separated). */
  formModelList(): string[] {
    return productModelsOf(this.formModel);
  }

  isFormModel(name: string): boolean {
    return hasProductModel(this.formModel, name);
  }

  /** Ticking a model keeps the list open so several can be picked at once. */
  toggleFormModel(name: string) {
    this.formModel = toggleProductModel(this.formModel, name);
    this.onFormActivity();
  }

  clearFormModels() {
    this.formModel = '';
    this.onFormActivity();
  }

  onFormActivity() {
    this.formError.set('');
    this.invalidFields.set([]);
    this.formDirty.set(true);
  }

  setFormType(type: Product['type']) {
    if (this.formType === type) return;
    this.formType = type;
    this.onFormActivity();
  }

  markDirty() {
    this.formDirty.set(true);
  }

  warrantyDaysValue(): number {
    return this.toNumber(this.formWarrantyDays);
  }

  setWarrantyDays(days: number) {
    this.formWarrantyDays = days > 0 ? days : '';
    this.onFormActivity();
  }

  private readonly fieldLabels: Record<string, [string, string]> = {
    'Name': ['নাম', 'Name'],
    'Type': ['ধরন', 'Type'],
    'Warehouse': ['ওয়্যারহাউস', 'Warehouse'],
    'Category': ['ক্যাটাগরি', 'Category'],
    'Unit': ['একক', 'Unit'],
    'Barcode Symbology': ['বারকোড সিম্বলজি', 'Barcode Symbology'],
    'Item Code': ['আইটেম কোড', 'Item Code'],
    'Slug': ['স্লাগ', 'Slug'],
    'Purchase Price': ['ক্রয় মূল্য', 'Purchase Price'],
    'Sales Price': ['বিক্রয় মূল্য', 'Sales Price'],
    'Variant': ['ভ্যারিয়েন্ট', 'Variant'],
    'Variant Item Code': ['ভ্যারিয়েন্ট আইটেম কোড', 'Variant Item Code']
  };

  private fieldLabel(field: string): string {
    const pair = this.fieldLabels[field];
    return pair ? this.prefs.txt(pair[0], pair[1]) : field;
  }

  isInvalid(field: string): boolean {
    return this.invalidFields().includes(field);
  }

  showToast(message: string, kind: 'success' | 'error' = 'success') {
    this.notify.toast(message, kind);
  }

  // Variant Type Product State
  selectedVariationId = signal<number | null>(null);
  selectedVariantValue = signal<string>('');

  selectedVariation = computed(() => {
    const id = this.selectedVariationId();
    if (!id) return null;
    return this.dataService.variations().find(v => v.id === id) || null;
  });

  availableVariantValues = computed(() => {
    const v = this.selectedVariation();
    if (!v) return [];
    return parseVariationValues(v.values);
  });

  addedVariants = signal<ProductVariant[]>([]);

  // Edit Variation Modal State matching Edit_Variation_bb18fe79.png
  showEditVariationModal = signal<boolean>(false);
  editingVariantIndex = signal<number | null>(null);
  editVariantImagePreview = signal<string>('');
  editVariantItemCode = '';
  editVariantQuantityAlert = 0;
  editVariantMrp = 0;
  editVariantTax = '';
  editVariantPurchasePrice = 0;
  editVariantPurchaseTaxType = '';
  editVariantWholesalePrice = 0;
  editVariantSalesPrice = 0;
  editVariantSalesTaxType = '';
  editVariantWholesaleQuantity: number | string = '';
  editVariantOpeningStock = 0;
  editVariantOpeningStockDate = '';

  openEditVariantModal(index: number) {
    const item = this.addedVariants()[index];
    if (!item) return;
    this.editingVariantIndex.set(index);
    this.variantEditError.set('');
    this.editVariantImagePreview.set(item.image || '');
    this.editVariantItemCode = item.itemCode || '';
    this.editVariantQuantityAlert = item.quantityAlert ?? 0;
    this.editVariantMrp = item.mrp ?? 0;
    this.editVariantTax = item.tax != null ? String(item.tax) : '';
    this.editVariantPurchasePrice = item.purchasePrice ?? 0;
    this.editVariantPurchaseTaxType = item.purchaseTaxType || '';
    this.editVariantWholesalePrice = item.wholesalePrice ?? 0;
    this.editVariantSalesPrice = item.salesPrice ?? 0;
    this.editVariantSalesTaxType = item.salesTaxType || '';
    this.editVariantWholesaleQuantity = item.wholesaleQuantity ?? '';
    this.editVariantOpeningStock = item.openingStock ?? 0;
    this.editVariantOpeningStockDate = item.openingStockDate || '';
    this.showEditVariationModal.set(true);
  }

  saveVariantEdit() {
    const idx = this.editingVariantIndex();
    if (idx === null) return;

    const itemCode = this.editVariantItemCode.trim();
    if (!itemCode) {
      this.variantEditError.set(this.prefs.txt('ভ্যারিয়েন্টের আইটেম কোড দিতে হবে।', 'Variant Item Code is required.'));
      return;
    }
    const duplicate = this.addedVariants().some((v, i) => i !== idx && v.itemCode.trim() === itemCode);
    if (duplicate) {
      this.variantEditError.set(this.prefs.txt(`ভ্যারিয়েন্ট আইটেম কোড "${itemCode}" অন্য একটি ভ্যারিয়েন্টে ইতিমধ্যে ব্যবহৃত হয়েছে।`, `Variant Item Code "${itemCode}" is already used by another variant.`));
      return;
    }

    this.addedVariants.update(list => {
      const updated = [...list];
      if (updated[idx]) {
        updated[idx] = {
          ...updated[idx],
          image: this.editVariantImagePreview() || updated[idx].image,
          itemCode,
          quantityAlert: this.optionalNumber(this.editVariantQuantityAlert),
          mrp: this.optionalNumber(this.editVariantMrp),
          tax: this.editVariantTax !== '' ? Number(this.editVariantTax) : undefined,
          purchasePrice: Number(this.editVariantPurchasePrice) || 0,
          purchaseTaxType: this.editVariantPurchaseTaxType || undefined,
          wholesalePrice: Number(this.editVariantWholesalePrice) || 0,
          salesPrice: Number(this.editVariantSalesPrice) || 0,
          salesTaxType: this.editVariantSalesTaxType || undefined,
          wholesaleQuantity: this.optionalNumber(this.editVariantWholesaleQuantity),
          openingStock: this.canEditStock() ? (Number(this.editVariantOpeningStock) || 0) : updated[idx].openingStock,
          openingStockDate: this.canEditStock() ? (this.editVariantOpeningStockDate || undefined) : updated[idx].openingStockDate
        };
      }
      return updated;
    });

    this.markDirty();
    this.showEditVariationModal.set(false);
    this.showToast(this.prefs.txt('ভ্যারিয়েন্ট হালনাগাদ হয়েছে।', 'Variant updated.'));
  }

  cloneVariantRow(index: number) {
    const item = this.addedVariants()[index];
    if (!item) return;
    const cloned: ProductVariant = {
      ...item,
      id: this.dataService.newId(),
      variantValue: `${item.variantValue} (Copy)`,
      itemCode: this.nextVariantCode()
    };
    this.addedVariants.update(list => [...list, cloned]);
    this.markDirty();
  }

  generateEditVariantCode() {
    this.editVariantItemCode = String(Math.floor(100000000 + Math.random() * 900000000));
  }

  async onEditVariantImageSelect(e: Event) {
    const picked = await this.media.pick(e, 'variants', this.editVariantItemCode || 'variant');
    if (!picked.ok) {
      if (picked.error) this.variantEditError.set(picked.error);
      return;
    }
    this.editVariantImagePreview.set(picked.image.ref);
    this.variantEditError.set(picked.image.note ?? '');
  }

  onVariationChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    this.selectedVariationId.set(val ? Number(val) : null);
    this.selectedVariantValue.set('');
  }

  addVariantRow() {
    const v = this.selectedVariation();
    const val = this.selectedVariantValue();
    if (!v || !val) {
      this.formError.set(this.prefs.txt('রো যোগ করার আগে ভ্যারিয়েশন ও ভ্যারিয়েন্ট ভ্যালু দুটিই নির্বাচন করুন।', 'Select both a Variation and a Variant Value before adding a row.'));
      return;
    }
    const newVariant: ProductVariant = {
      id: this.dataService.newId(),
      variationId: v.id,
      variationName: v.name,
      variantValue: val,
      purchasePrice: this.toNumber(this.formPurchasePrice),
      wholesalePrice: this.toNumber(this.formWholesalePrice),
      salesPrice: this.toNumber(this.formSalesPrice),
      image: this.formImagePreview() || '',
      itemCode: this.nextVariantCode(),
      openingStock: 0
    };
    this.addedVariants.update(list => [...list, newVariant]);
    this.selectedVariantValue.set('');
    this.onFormActivity();
  }

  private nextVariantCode(): string {
    const base = this.formCode.trim();
    if (!base) return '';
    const used = new Set(this.addedVariants().map(v => v.itemCode.trim()));
    let index = this.addedVariants().length + 1;
    let code = `${base}-${index}`;
    while (used.has(code)) code = `${base}-${++index}`;
    return code;
  }

  private toNumber(value: number | string | null | undefined): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private optionalNumber(value: number | string | null | undefined): number | undefined {
    return value === '' || value === null || value === undefined ? undefined : Number(value);
  }

  removeVariantRow(index: number) {
    this.addedVariants.update(list => list.filter((_, i) => i !== index));
    this.markDirty();
  }

  private searchFiltered(type: string): Product[] {
    const brand = this.selectedBrand();
    const model = this.selectedModel();
    const cat = this.categoryFilterMatch();
    const q = this.searchQuery().trim();

    let list = this.dataService.products();
    if (type !== 'all') list = list.filter(p => p.type === type);
    if (brand) list = list.filter(p => p.brand === brand);
    if (model) list = list.filter(p => hasProductModel(p.model, model));
    if (cat.subCategory) list = list.filter(p => p.category === cat.category && (p.subCategory || '') === cat.subCategory);
    else if (cat.category) list = list.filter(p => p.category === cat.category);

    const stock = this.stockMode();
    if (stock !== 'all') {
      // Services hold no stock, so a stock filter only makes sense for physical goods.
      list = list.filter(p => p.type !== 'service');
      if (stock === 'in') list = list.filter(p => p.stock > 0);
      else if (stock === 'low') list = list.filter(p => p.stock > 0 && p.stock <= this.lowStockThreshold(p));
      else if (stock === 'out') list = list.filter(p => p.stock <= 0);
      else {
        const min = this.stockMin();
        const max = this.stockMax();
        list = list.filter(p =>
          (min === null || p.stock >= min) && (max === null || p.stock <= max));
      }
    }

    if (q) list = searchProducts(list, q);
    // Newest first: ids are creation timestamps, so a just-saved product leads
    // even when the collection arrived from another device or a restore.
    else list = [...list].sort((a, b) => b.id - a.id);

    return list;
  }

  stockFilterLabel(): string {
    const mode = this.stockMode();
    if (mode === 'in') return this.prefs.txt('স্টক আছে', 'In stock');
    if (mode === 'low') return this.prefs.txt('কম স্টক', 'Low stock');
    if (mode === 'out') return this.prefs.txt('স্টক নেই', 'Out of stock');
    if (mode === 'range') {
      const min = this.stockMin() ?? 0;
      const max = this.stockMax();
      return `${min}–${max ?? '∞'}`;
    }
    return this.prefs.txt('স্টক', 'Stock');
  }

  /** Matches the header bell: a product's own minimum wins, else the shop default of 5. */
  lowStockThreshold(p: Product): number {
    return p.minQty && p.minQty > 0 ? p.minQty : 5;
  }

  applyStockMode(mode: 'all' | 'in' | 'low' | 'out') {
    this.stockMode.set(mode);
    this.stockMin.set(null);
    this.stockMax.set(null);
    this.stockMinInput.set('');
    this.stockMaxInput.set('');
    this.showStockFilter.set(false);
    this.resetPage();
  }

  onStockMinInput(e: Event) {
    this.stockMinInput.set((e.target as HTMLInputElement).value);
  }

  onStockMaxInput(e: Event) {
    this.stockMaxInput.set((e.target as HTMLInputElement).value);
  }

  applyStockRange() {
    const minText = this.stockMinInput().trim();
    const maxText = this.stockMaxInput().trim();
    const min = minText === '' ? null : Math.max(0, Number(minText));
    const max = maxText === '' ? null : Math.max(0, Number(maxText));
    if (min === null && max === null) {
      this.clearStockFilter();
      return;
    }
    this.stockMin.set(min);
    this.stockMax.set(max);
    this.stockMode.set('range');
    this.showStockFilter.set(false);
    this.resetPage();
  }

  clearStockFilter() {
    this.stockMode.set('all');
    this.stockMin.set(null);
    this.stockMax.set(null);
    this.stockMinInput.set('');
    this.stockMaxInput.set('');
    this.showStockFilter.set(false);
    this.resetPage();
  }

  filteredProducts = computed(() => this.searchFiltered(this.activeTab()));

  /** The manager lists each product once; its variants live inside the product. */
  rows = computed<ProductRow[]>(() => this.filteredProducts().map(product => ({
    key: `p-${product.id}`,
    product,
    display: product
  })));

  totalRows = computed(() => this.rows().length);

  otherTabHits = computed(() => {
    if (!this.searchQuery().trim()) return [];
    return (['single', 'variant', 'service'] as const)
      .filter(type => type !== this.activeTab())
      .map(type => ({ type, count: this.searchFiltered(type).length }))
      .filter(hit => hit.count > 0);
  });

  onSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.searchQuery.set(target.value);
    this.resetPage();
  }

  setTab(tab: string) {
    this.activeTab.set(tab);
    this.resetPage();
  }

  goToPage(page: number, event?: Event) {
    this.page.set(Math.min(Math.max(1, page), this.totalPages()));
    scrollToListTopAfterRender(event?.target as Element | null);
  }

  setPageSize(e: Event) {
    const value = Number((e.target as HTMLSelectElement).value);
    this.pageSize.set(value >= 0 ? value : 10);
    this.resetPage();
    scrollToListTopAfterRender(e.target as Element | null);
  }

  resetPage() {
    this.page.set(1);
  }

  clearFilters() {
    this.selectedBrand.set('');
    this.selectedModel.set('');
    this.selectedCategory.set('');
    this.searchQuery.set('');
    this.clearStockFilter();
    this.resetPage();
  }

  toggleColumn(colName: string) {
    this.tableLayout.update(layout => ({
      ...layout,
      visible: { ...layout.visible, [colName]: !layout.visible[colName] }
    }));
    this.saveTableView();
  }

  selectAllColumns() {
    this.tableLayout.update(layout => {
      const visible: Record<string, boolean> = {};
      for (const key of layout.order) visible[key] = true;
      return { ...layout, visible: { ...layout.visible, ...visible } };
    });
    this.saveTableView();
  }

  resetColumns() {
    this.tableLayout.set(defaultColumnLayout(PRODUCT_TABLE_COLUMNS));
    this.saveTableView();
  }

  private saveTableView() {
    saveColumnLayout(PRODUCT_TABLE_VIEW_KEY, this.tableLayout());
  }

  onColumnDrop(event: CdkDragDrop<ResolvedColumn[]>) {
    if (event.previousIndex === event.currentIndex) return;
    const layout = this.tableLayout();
    const visibleKeys = this.visibleCols().map(col => col.key);
    const nextOrder = reorderInView<string>(
      layout.order, visibleKeys, event.previousIndex, event.currentIndex, key => key
    );
    this.tableLayout.set({ ...layout, order: nextOrder });
    this.saveTableView();
  }

  startColumnResize(event: MouseEvent, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const table = (event.target as HTMLElement).closest('table');
    const colEl = table?.querySelector<HTMLElement>(`col[data-col="${key}"]`);
    const startWidth = this.tableLayout().widths[key] ?? 0;

    const onMove = (moveEvent: MouseEvent) => {
      const spec = PRODUCT_COL_SPECS[key];
      const width = clampLayoutWidth(spec, startWidth + moveEvent.clientX - startX);
      if (colEl) colEl.style.width = `${width}px`;
    };
    const onUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const spec = PRODUCT_COL_SPECS[key];
      const width = clampLayoutWidth(spec, startWidth + upEvent.clientX - startX);
      if (width !== startWidth) {
        this.tableLayout.update(layout => ({ ...layout, widths: { ...layout.widths, [key]: width } }));
        this.saveTableView();
      } else if (colEl) {
        colEl.style.width = `${startWidth}px`;
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  onNameInput() {
    if (!this.slugTouched) this.formSlug = this.buildSlug(this.formName);
  }

  onSlugInput() {
    this.slugTouched = true;
  }

  onSlugBlur() {
    this.formSlug = this.normalizeSlug(this.formSlug);
  }

  regenerateSlug() {
    this.formSlug = this.buildSlug(this.formName);
    this.slugTouched = false;
    this.onFormActivity();
  }

  private normalizeSlug(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private ensureUniqueSlug(slug: string, ignoreId: number | null): string {
    const base = slug || 'product';
    const taken = new Set(
      this.dataService.products()
        .filter(p => p.id !== ignoreId)
        .map(p => (p.slug || '').toLowerCase())
        .filter(Boolean)
    );
    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  private readonly bnConsonants: Record<string, string> = {
    'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng',
    'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n',
    'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh', 'ণ': 'n',
    'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n',
    'প': 'p', 'ফ': 'ph', 'ব': 'b', 'ভ': 'bh', 'ম': 'm',
    'য': 'y', 'র': 'r', 'ল': 'l', 'শ': 'sh', 'ষ': 'sh', 'স': 's', 'হ': 'h',
    'ড়': 'r', 'ঢ়': 'rh', 'য়': 'y'
  };
  private readonly bnVowelSigns: Record<string, string> = {
    'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ৃ': 'ri',
    'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou'
  };
  private readonly bnIndependentVowels: Record<string, string> = {
    'অ': 'o', 'আ': 'a', 'ই': 'i', 'ঈ': 'i', 'উ': 'u', 'ঊ': 'u', 'ঋ': 'ri',
    'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou'
  };
  private readonly bnMarks: Record<string, string> = {
    'ৎ': 't', 'ং': 'ng', 'ঃ': 'h', 'ঁ': 'n'
  };
  private readonly bnDigits: Record<string, string> = {
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
    '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9'
  };

  private buildSlug(value: string): string {
    const chars = Array.from(value.normalize('NFC').toLowerCase());
    let out = '';
    let i = 0;

    while (i < chars.length) {
      const ch = chars[i];
      const next = chars[i + 1];

      // ড় / ঢ় / য় are usually written as base + nukta (and NFC keeps them
      // decomposed), so romanize that sequence explicitly before the plain
      // consonant rules pick up the base letter.
      if (next === '়' && (ch === 'ড' || ch === 'ঢ' || ch === 'য')) {
        out += ch === 'ড' ? 'r' : ch === 'ঢ' ? 'rh' : 'y';
        i += 2;
        const sign = this.bnVowelSigns[chars[i]];
        if (sign) {
          out += sign;
          i += 1;
        } else if (chars[i] === '্') {
          i += 1;
        } else if (chars[i] && /[\p{L}\p{M}\p{N}]/u.test(chars[i])) {
          out += 'o';
        }
        continue;
      }

      const consonant = this.bnConsonants[ch];
      if (consonant) {
        if (next === '্') {
          out += consonant;
          i += 2;
          continue;
        }
        const sign = this.bnVowelSigns[next];
        if (sign) {
          out += consonant + sign;
          i += 2;
          continue;
        }
        // Inherent vowel: keep it except at a word's end (Bengali schwa deletion)
        out += consonant + (next && /[\p{L}\p{M}\p{N}]/u.test(next) ? 'o' : '');
        i += 1;
        continue;
      }

      if (this.bnMarks[ch]) {
        out += this.bnMarks[ch];
        i += 1;
        continue;
      }
      if (this.bnIndependentVowels[ch]) {
        out += this.bnIndependentVowels[ch];
        i += 1;
        continue;
      }
      if (this.bnDigits[ch]) {
        out += this.bnDigits[ch];
        i += 1;
        continue;
      }
      if (/[\p{L}\p{M}\p{N}]/u.test(ch)) {
        out += ch;
        i += 1;
        continue;
      }
      out += ' ';
      i += 1;
    }

    return out
      .replace(/[\u0980-\u09FF]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async onImageSelect(e: Event) {
    // Any camera-sized picture is squeezed to the product cap and, when
    // Cloudinary is configured, uploaded there instead of living in the database.
    const picked = await this.media.pick(e, 'products', this.formName || 'product');
    if (!picked.ok) {
      if (picked.error) this.formError.set(picked.error);
      return;
    }
    this.formImagePreview.set(picked.image.ref);
    this.formError.set(picked.image.note ?? '');
    this.markDirty();
  }

  removeImage() {
    this.formImagePreview.set('');
    this.markDirty();
  }

  generateRandomCode() {
    this.formCode = String(Math.floor(100000000 + Math.random() * 900000000));
    this.onFormActivity();
  }

  // Quick Add Modal Signals
  showQuickAddCategoryModal = signal<boolean>(false);
  showQuickAddSubCategoryModal = signal<boolean>(false);
  showQuickAddBrandModal = signal<boolean>(false);
  showQuickAddModelsModal = signal<boolean>(false);
  showQuickAddUnitModal = signal<boolean>(false);

  quickCategoryName = '';
  quickSubCategoryName = '';
  quickSubCategoryParent = '';
  quickBrandName = '';
  quickModelName = '';
  quickUnitName = '';

  readonly unitOptions = computed(() => this.dataService.unitNames());

  private nameExists(items: { name: string }[], name: string): boolean {
    const needle = name.trim().toLowerCase();
    return items.some(item => item.name.trim().toLowerCase() === needle);
  }

  openQuickCategoryModal() {
    this.quickCategoryName = '';
    this.quickAddError.set('');
    this.showQuickAddCategoryModal.set(true);
  }

  saveQuickCategory() {
    const name = this.quickCategoryName.trim();
    if (!name) {
      this.quickAddError.set(this.prefs.txt('ক্যাটাগরির নাম দিতে হবে।', 'Category name is required.'));
      return;
    }
    if (this.nameExists(this.dataService.categories(), name)) {
      this.quickAddError.set(this.prefs.txt(`"${name}" ক্যাটাগরি ইতিমধ্যে আছে।`, `Category "${name}" already exists.`));
      return;
    }
    const newCat = {
      id: this.dataService.newId(),
      name,
      logo: '',
      productCount: 0,
      status: 'Enabled' as const
    };
    this.dataService.categories.update(cats => [newCat, ...cats]);
    this.formCategory = name;
    this.formSubCategory = '';
    this.quickAddError.set('');
    this.showQuickAddCategoryModal.set(false);
    this.onFormActivity();
  }

  openQuickSubCategoryModal() {
    this.quickSubCategoryName = '';
    this.quickSubCategoryParent = this.formCategory || '';
    this.quickAddError.set('');
    this.showQuickAddSubCategoryModal.set(true);
  }

  saveQuickSubCategory() {
    const name = this.quickSubCategoryName.trim();
    if (!name) {
      this.quickAddError.set(this.prefs.txt('সাব ক্যাটাগরির নাম দিতে হবে।', 'Sub category name is required.'));
      return;
    }
    const parent = this.quickSubCategoryParent || this.formCategory;
    if (!parent) {
      this.quickAddError.set(this.prefs.txt('একটি প্যারেন্ট ক্যাটাগরি নির্বাচন করুন।', 'Select a parent category.'));
      return;
    }
    const duplicate = this.dataService.subCategories()
      .some(sc => sc.parentCategory === parent && sc.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      this.quickAddError.set(this.prefs.txt(`${parent}-এর নিচে "${name}" সাব ক্যাটাগরি ইতিমধ্যে আছে।`, `Sub category "${name}" already exists under ${parent}.`));
      return;
    }
    const baseSlug = this.buildSlug(name) || `sub-category-${Date.now()}`;
    const taken = new Set(this.dataService.subCategories().map(sc => (sc.slug || '').toLowerCase()).filter(Boolean));
    let slug = baseSlug;
    let suffix = 2;
    while (taken.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    const newSubCat = {
      id: this.dataService.newId(),
      name,
      slug,
      parentCategory: parent,
      logo: '',
      productCount: 0,
      status: 'Enabled' as const
    };
    this.dataService.subCategories.update(subCats => [newSubCat, ...subCats]);
    this.formSubCategory = name;
    this.quickAddError.set('');
    this.showQuickAddSubCategoryModal.set(false);
    this.onFormActivity();
  }

  openQuickBrandModal() {
    this.quickBrandName = '';
    this.quickAddError.set('');
    this.showQuickAddBrandModal.set(true);
  }

  saveQuickBrand() {
    const name = this.quickBrandName.trim();
    if (!name) {
      this.quickAddError.set(this.prefs.txt('ব্র্যান্ডের নাম দিতে হবে।', 'Brand name is required.'));
      return;
    }
    if (this.nameExists(this.dataService.brands(), name)) {
      this.quickAddError.set(this.prefs.txt(`"${name}" ব্র্যান্ড ইতিমধ্যে আছে।`, `Brand "${name}" already exists.`));
      return;
    }
    const newBrand = {
      id: this.dataService.newId(),
      name,
      logo: '',
      productCount: 0
    };
    this.dataService.brands.update(b => [newBrand, ...b]);
    this.formBrand = name;
    this.quickAddError.set('');
    this.showQuickAddBrandModal.set(false);
    this.onFormActivity();
  }

  openQuickModelModal() {
    this.quickModelName = '';
    this.quickAddError.set('');
    this.showQuickAddModelsModal.set(true);
  }

  saveQuickModel() {
    const name = this.quickModelName.trim();
    if (!name) {
      this.quickAddError.set(this.prefs.txt('মডেলের নাম দিতে হবে।', 'Model name is required.'));
      return;
    }
    if (this.nameExists(this.dataService.productModels(), name)) {
      this.quickAddError.set(this.prefs.txt(`"${name}" মডেল ইতিমধ্যে আছে।`, `Model "${name}" already exists.`));
      return;
    }
    const newModel = {
      id: this.dataService.newId(),
      name,
      logo: '',
    };
    this.dataService.productModels.update(m => [newModel, ...m]);
    this.formModel = toggleProductModel(this.formModel, name);
    this.quickAddError.set('');
    this.showQuickAddModelsModal.set(false);
    this.onFormActivity();
  }

  openQuickUnitModal() {
    this.quickUnitName = '';
    this.quickAddError.set('');
    this.showQuickAddUnitModal.set(true);
  }

  saveQuickUnit() {
    const name = this.quickUnitName.trim();
    const result = this.dataService.addUnit(name);
    if (!result.ok) {
      this.quickAddError.set(result.error === 'duplicate'
        ? this.prefs.txt(`"${name}" একক ইতিমধ্যে আছে।`, `Unit "${name}" already exists.`)
        : this.prefs.txt('এককের নাম দিতে হবে।', 'Unit name is required.'));
      return;
    }
    this.formUnit = name;
    this.quickAddError.set('');
    this.showQuickAddUnitModal.set(false);
    this.onFormActivity();
  }

  addFormUnit() {
    this.formMultiUnit = true;
    this.formUnits = [...this.formUnits, { name: '', factor: '', price: '', inverse: false }];
    this.onFormActivity();
  }

  /** Turning the dedicated mode off drops the extra-unit rows with it. */
  onMultiUnitToggle(enabled: boolean) {
    this.formMultiUnit = enabled;
    if (!enabled) this.formUnits = [];
    this.onFormActivity();
  }

  removeFormUnit(index: number) {
    this.formUnits = this.formUnits.filter((_, i) => i !== index);
    this.onFormActivity();
  }

  /** Flips "১ পিস = ১৫ প্যাকেট" ⇄ "১ প্যাকেট = ১৫ পিস" without losing the number. */
  toggleUnitDirection(index: number) {
    this.formUnits = this.formUnits.map((row, i) => i === index ? { ...row, inverse: !row.inverse } : row);
    this.onFormActivity();
  }

  onUnitRowChange() {
    this.onFormActivity();
  }

  /**
   * The stored factor: base units per one unit. "১ প্যাকেট = ৪০ পিস" stores 1/40.
   * A blank box means the unit shares the stock one-for-one (factor 1).
   */
  private unitFactorFromRow(row: { factor: number | string; inverse?: boolean }): number {
    if (row.factor === '' || row.factor === null || row.factor === undefined) return 1;
    const value = Number(row.factor) || 0;
    if (!(value > 0)) return 0;
    return row.inverse ? 1 / value : value;
  }

  /** Placeholder price for a blank field: base price × conversion (or ÷ in inverse mode). */
  autoUnitPrice(unit: { factor: number | string; inverse?: boolean }): string {
    const factor = this.unitFactorFromRow(unit);
    const base = this.toNumber(this.formSalesPrice);
    return factor > 0 && base > 0 ? String(Math.round(base * factor * 100) / 100) : '';
  }

  private normalizedUnits(): ProductUnit[] | undefined {
    const rows = this.formUnits
      .map(row => ({
        name: String(row.name || '').trim(),
        factor: this.unitFactorFromRow(row),
        price: Number(row.price)
      }))
      .filter(row => row.name !== '');
    if (!rows.length) return undefined;
    return rows.map(row => ({
      name: row.name,
      factor: Math.round(row.factor * 1e6) / 1e6,
      price: row.price > 0 ? Math.round(row.price * 100) / 100 : undefined
    }));
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.closeCombo();
    this.editingProductId.set(null);
    this.formName = '';
    this.formSlug = '';
    this.formCategory = '';
    this.formSubCategory = '';
    this.formBrand = '';
    this.formModel = '';
    // Most items are counted in pieces; Settings → Unit decides what that is.
    this.formUnit = this.dataService.defaultUnitName();
    this.formUnits = [];
    this.formMultiUnit = false;
    this.formRack = '';
    this.formCode = '';
    // Sensible defaults: most products are single items stored in the shop,
    // and CODE128 is what virtually every handheld scanner reads.
    this.formWarehouse = this.dataService.warehouses()[0] ?? 'SM Warehouse';
    this.formQuantityAlert = '';
    this.formBarcodeSymbology = 'CODE128';
    this.formTax = '';
    this.formMrp = '';
    this.formPurchasePrice = '';
    this.formPurchaseTaxMode = '';
    this.formSalesPrice = '';
    this.formSalesTaxMode = '';
    this.formWholesalePrice = '';
    this.formWholesaleQuantity = '';
    this.formWarrantyDays = '';
    this.formOpeningStock = '';
    this.formOpeningStockDate = '';
    this.formCurrentStock = '';
    this.formType = 'single';
    this.formImagePreview.set('');
    this.formError.set('');
    this.invalidFields.set([]);
    this.comboSearch.set({ category: '', subCategory: '', brand: '', model: '' });
    this.selectedVariationId.set(null);
    this.selectedVariantValue.set('');
    this.addedVariants.set([]);
    this.variantEditError.set('');
    this.quickAddError.set('');
    this.slugTouched = false;
    this.formDirty.set(false);
    this.resetOpeningUnlock();
    this.showAddModal.set(true);
    this.focusFormField('product-name');
  }

  openEditModal(p: Product) {
    this.isEditMode.set(true);
    this.closeCombo();
    this.editingProductId.set(p.id);
    this.formName = p.name;
    this.formSlug = p.slug || this.buildSlug(p.name);
    this.formCategory = p.category;
    this.formSubCategory = p.subCategory || '';
    this.formBrand = p.brand;
    this.formModel = p.model;
    this.formUnit = p.unit;
    this.formMultiUnit = (p.units || []).length > 0;
    this.formUnits = (p.units || []).map(u => {
      const factor = Number(u.factor) || 0;
      const inverse = factor > 0 && factor < 1;
      return {
        name: u.name,
        // A shared unit (factor 1) shows an empty box so it stays 1:1 on save.
        factor: factor === 1 ? '' : inverse ? Math.round((1 / factor) * 1000) / 1000 : u.factor,
        price: u.price ?? '',
        inverse
      };
    });
    this.formRack = p.rack;
    this.formWarehouse = p.warehouse || '';
    this.formCode = p.code;
    this.formQuantityAlert = p.minQty ?? '';
    this.formBarcodeSymbology = p.barcodeSymbology || '';
    this.formTax = p.tax != null ? String(p.tax) : '';
    this.formMrp = p.mrp ?? '';
    this.formPurchasePrice = p.purchasePrice;
    this.formPurchaseTaxMode = p.purchaseTaxMode || '';
    this.formSalesPrice = p.salesPrice;
    this.formSalesTaxMode = p.salesTaxMode || '';
    this.formWholesalePrice = p.wholesalePrice;
    this.formWholesaleQuantity = p.wholesaleQuantity ?? '';
    this.formWarrantyDays = p.warrantyDays ?? '';
    this.formOpeningStock = p.openingStock ?? p.stock;
    this.formOpeningStockDate = p.openingStockDate || '';
    this.formCurrentStock = p.stock;
    this.formType = p.type;
    this.formImagePreview.set(p.image || '');
    this.formError.set('');
    this.invalidFields.set([]);
    this.comboSearch.set({ category: '', subCategory: '', brand: '', model: '' });
    this.selectedVariationId.set(null);
    this.selectedVariantValue.set('');
    this.addedVariants.set((p.variants || []).map(v => ({ ...v })));
    this.variantEditError.set('');
    this.quickAddError.set('');
    this.slugTouched = true;
    this.formDirty.set(false);
    this.resetOpeningUnlock();
    this.showAddModal.set(true);
    this.focusFormField('product-name');
  }

  private focusFormField(id: string) {
    if (typeof document === 'undefined') return;
    window.setTimeout(() => document.getElementById(id)?.focus({ preventScroll: true }), 60);
  }

  /** Opening stock is Admin-locked; the PIN unlocks the editable fields for this edit. */
  askOpeningUnlock(target: 'product' | 'variant') {
    if (!this.canEditStock()) return;
    this.openingPasscodeFor.set(target);
  }

  onOpeningVerified() {
    if (this.openingPasscodeFor() === 'variant') this.variantOpeningUnlocked.set(true);
    else this.openingUnlocked.set(true);
    this.openingPasscodeFor.set(null);
  }

  /** Locking again throws away the unsaved opening numbers. */
  lockOpening(target: 'product' | 'variant') {
    if (target === 'variant') {
      const item = this.addedVariants()[this.editingVariantIndex() ?? -1];
      this.editVariantOpeningStock = item?.openingStock ?? 0;
      this.editVariantOpeningStockDate = item?.openingStockDate || '';
      this.variantOpeningUnlocked.set(false);
      return;
    }
    const existing = this.dataService.products().find(p => p.id === this.editingProductId());
    this.formOpeningStock = existing?.openingStock ?? existing?.stock ?? '';
    this.formOpeningStockDate = existing?.openingStockDate || '';
    this.openingUnlocked.set(false);
  }

  private resetOpeningUnlock() {
    this.openingUnlocked.set(false);
    this.variantOpeningUnlocked.set(false);
    this.openingPasscodeFor.set(null);
  }

  async requestCloseForm() {
    if (this.formDirty()) {
      const confirmed = await this.notify.confirm(this.prefs.txt('আপনার অসংরক্ষিত পরিবর্তন রয়েছে। সংরক্ষণ না করেই বন্ধ করবেন?', 'You have unsaved changes. Close without saving?'), {
        title: this.prefs.txt('পরিবর্তন বাতিল করবেন?', 'Discard changes?'),
        kind: 'warning',
        confirmText: this.prefs.txt('বাতিল করুন', 'Discard'),
        cancelText: this.prefs.txt('এডিট চালিয়ে যান', 'Keep editing')
      });
      if (!confirmed) return;
    }
    this.showAddModal.set(false);
    this.formDirty.set(false);
    this.closeCombo();
  }

  cloneProduct(p: Product) {
    const cloneCode = String(Math.floor(100000000 + Math.random() * 900000000));
    const variants = (p.variants || []).map((v, index) => ({
      ...v,
      id: this.dataService.newId(),
      itemCode: `${cloneCode}-${index + 1}`
    }));
    const clone = {
      name: `${p.name} (Copy)`,
      slug: this.ensureUniqueSlug(p.slug ? `${p.slug}-copy` : this.buildSlug(`${p.name} copy`), null),
      code: cloneCode,
      rack: p.rack,
      warehouse: p.warehouse,
      type: p.type,
      category: p.category,
      subCategory: p.subCategory,
      brand: p.brand,
      model: p.model,
      stock: p.stock,
      unit: p.unit,
      units: p.units?.map(u => ({ ...u })),
      purchasePrice: p.purchasePrice,
      salesPrice: p.salesPrice,
      wholesalePrice: p.wholesalePrice,
      image: p.image,
      barcodeSymbology: p.barcodeSymbology,
      tax: p.tax,
      openingStock: p.openingStock,
      openingStockDate: p.openingStockDate,
      mrp: p.mrp,
      minQty: p.minQty,
      purchaseTaxMode: p.purchaseTaxMode,
      salesTaxMode: p.salesTaxMode,
      wholesaleQuantity: p.wholesaleQuantity,
      warrantyDays: p.warrantyDays,
      variants: variants.length ? variants : undefined
    };
    this.dataService.addProduct(clone);
    this.revealNewProduct(clone);
    this.session.log('Product Cloned', `"${p.name}" → "${clone.name}" (${clone.code})`);
    this.showToast(this.prefs.txt(`"${clone.name}" নামে পণ্য ক্লোন হয়েছে।`, `Product cloned as "${clone.name}".`));
  }

  saveProductForm(continueAdding = false) {
    const type = this.formType as Product['type'];
    const isEdit = this.isEditMode() && !!this.editingProductId();
    const existing = isEdit ? this.dataService.products().find(p => p.id === this.editingProductId()) : undefined;
    const variantRows = type === 'variant' ? this.addedVariants() : [];

    const missing: string[] = [];
    if (!this.formName.trim()) missing.push('Name');
    if (!this.formType) missing.push('Type');
    if (!this.formWarehouse) missing.push('Warehouse');
    if (!this.formCategory) missing.push('Category');
    if (!this.formUnit) missing.push('Unit');
    if (!this.formBarcodeSymbology) missing.push('Barcode Symbology');
    if (!this.formCode.trim()) missing.push('Item Code');
    if (!this.formSlug.trim()) missing.push('Slug');

    if (type === 'variant') {
      if (!variantRows.length) missing.push('Variant');
      if (variantRows.some(v => !v.itemCode.trim())) missing.push('Variant Item Code');
    } else {
      if (this.formPurchasePrice === '' || this.formPurchasePrice === null) missing.push('Purchase Price');
      if (this.formSalesPrice === '' || this.formSalesPrice === null) missing.push('Sales Price');
    }

    if (missing.length) {
      this.invalidFields.set(missing.includes('Variant Item Code') ? [...missing, 'Variant'] : missing);
      this.formError.set(this.prefs.txt(`আবশ্যক তথ্য পূরণ করুন: ${missing.map(f => this.fieldLabel(f)).join(', ')}।`, `Please complete the required fields: ${missing.join(', ')}.`));
      this.focusFirstInvalid(missing);
      return;
    }

    const numericValues: (number | string | null | undefined)[] = [
      this.formMrp, this.formPurchasePrice, this.formSalesPrice, this.formWholesalePrice,
      this.formWholesaleQuantity, this.formWarrantyDays, this.formOpeningStock, this.formCurrentStock, this.formQuantityAlert,
      ...this.formUnits.flatMap(u => [u.factor, u.price]),
      ...variantRows.flatMap(v => [v.purchasePrice, v.salesPrice, v.wholesalePrice, v.openingStock, v.mrp, v.wholesaleQuantity, v.quantityAlert])
    ];
    if (numericValues.some(v => v !== '' && v !== null && v !== undefined && !Number.isFinite(Number(v)))) {
      this.formError.set(this.prefs.txt('সংখ্যার ঘরে সঠিক সংখ্যা লিখুন।', 'Numeric fields must contain valid numbers.'));
      return;
    }
    if (numericValues.some(v => v !== '' && v !== null && v !== undefined && Number(v) < 0)) {
      this.formError.set(this.prefs.txt('মান ঋণাত্মক হতে পারে না।', 'Values cannot be negative.'));
      return;
    }

    const units = type === 'single' ? this.normalizedUnits() : undefined;
    const unitError = this.validateUnits(units);
    if (unitError) {
      this.formError.set(unitError);
      return;
    }

    const code = this.formCode.trim();
    const duplicateCode = this.dataService.products()
      .some(p => p.code === code && p.id !== this.editingProductId());
    if (duplicateCode) {
      this.invalidFields.set(['Item Code']);
      this.formError.set(this.prefs.txt(`আইটেম কোড "${code}" ইতিমধ্যে আছে। অন্য কোড ব্যবহার করুন।`, `Item Code "${code}" already exists. Please use a different code.`));
      this.focusFirstInvalid(['Item Code']);
      return;
    }

    const variants: ProductVariant[] = variantRows.map(v => ({
      ...v,
      itemCode: v.itemCode.trim(),
      purchasePrice: Number(v.purchasePrice) || 0,
      wholesalePrice: Number(v.wholesalePrice) || 0,
      salesPrice: Number(v.salesPrice) || 0,
      openingStock: Number(v.openingStock) || 0,
      quantityAlert: this.optionalNumber(v.quantityAlert),
      mrp: this.optionalNumber(v.mrp),
      tax: this.optionalNumber(v.tax),
      wholesaleQuantity: this.optionalNumber(v.wholesaleQuantity),
      openingStockDate: v.openingStockDate || undefined
    }));

    if (variants.length) {
      const takenCodes = new Set(
        this.dataService.products()
          .filter(p => p.id !== this.editingProductId())
          .flatMap(p => [p.code, ...(p.variants || []).map(v => v.itemCode)])
      );
      takenCodes.add(code);
      const seen = new Set<string>();
      const duplicateVariant = variants.find(v => {
        const variantCode = v.itemCode.toLowerCase();
        if (takenCodes.has(v.itemCode) || seen.has(variantCode)) return true;
        seen.add(variantCode);
        return false;
      });
      if (duplicateVariant) {
        this.invalidFields.set(['Variant']);
        this.formError.set(this.prefs.txt(`ভ্যারিয়েন্ট আইটেম কোড "${duplicateVariant.itemCode}" ইতিমধ্যে আছে। অন্য কোড ব্যবহার করুন।`, `Variant Item Code "${duplicateVariant.itemCode}" already exists. Please use a different code.`));
        this.focusFirstInvalid(['Variant']);
        return;
      }
    }

    // The owner's stock lock wins over any number a stale or scripted form still holds.
    if (!this.canEditStock()) {
      for (const variant of variants) {
        const previous = existing?.variants?.find(v => v.itemCode === variant.itemCode);
        variant.openingStock = previous?.openingStock ?? 0;
        variant.openingStockDate = previous?.openingStockDate;
      }
    }

    const slug = this.ensureUniqueSlug(
      this.normalizeSlug(this.formSlug) || this.buildSlug(this.formName),
      this.editingProductId()
    );
    this.formSlug = slug;

    const isVariant = type === 'variant';
    // A new product's opening stock is its first stock. On an edit the drawer
    // writes the live count directly, so the number typed is the number the
    // shop sees; the baseline only moves once an Admin PIN unlocked it.
    const variantOpening = variants.reduce((sum, v) => sum + (Number(v.openingStock) || 0), 0);
    const openingStock = isVariant
      ? variantOpening
      : isEdit && existing
        ? this.openingUnlocked()
          ? this.toNumber(this.formOpeningStock)
          : this.toNumber(existing.openingStock ?? existing.stock)
        : this.toNumber(this.formOpeningStock);
    const previousOpening = !existing ? openingStock
      : existing.type === 'variant'
        ? (existing.variants ?? []).reduce((sum, v) => sum + (Number(v.openingStock) || 0), 0)
        : existing.openingStock ?? existing.stock;
    const stock = isVariant && isEdit && existing
      // Variant stock is the sum of its variant rows, so the edit moves it by
      // the same difference as the variant opening stocks.
      ? Math.round((existing.stock + (variantOpening - previousOpening)) * 100) / 100
      : isVariant
        ? variantOpening
        : isEdit && existing
          ? this.toNumber(this.formCurrentStock)
          : openingStock;
    if (isEdit && existing && stock < 0) {
      this.formError.set(this.prefs.txt(
        'এই প্রারম্ভিক স্টকে বর্তমান স্টক ঋণাত্মক হয়ে যাবে। আগের বিক্রয়-ক্রয়ের কারণে কমাতে হলে স্টক পেজ থেকে প্রকৃত গণনা বসান।',
        'That opening stock would push the current stock below zero. Use the Stock page reconcile to set the counted quantity instead.'
      ));
      return;
    }
    const minPositive = (values: number[]) => {
      const positives = values.filter(v => v > 0);
      return positives.length ? Math.min(...positives) : 0;
    };
    const derivedMrp = isVariant ? minPositive(variants.map(v => v.mrp ?? 0)) : 0;

    const payload = {
      name: this.formName.trim(),
      slug,
      code,
      rack: this.formRack.trim(),
      warehouse: this.formWarehouse,
      type,
      category: this.formCategory,
      subCategory: this.formSubCategory || undefined,
      brand: this.formBrand,
      model: joinProductModels(this.formModelList()),
      stock: this.canEditStock() ? stock : (existing?.stock ?? 0),
      unit: this.formUnit,
      units,
      purchasePrice: isVariant ? minPositive(variants.map(v => v.purchasePrice)) : this.toNumber(this.formPurchasePrice),
      salesPrice: isVariant ? minPositive(variants.map(v => v.salesPrice)) : this.toNumber(this.formSalesPrice),
      wholesalePrice: isVariant ? minPositive(variants.map(v => v.wholesalePrice)) : this.toNumber(this.formWholesalePrice),
      image: this.formImagePreview() || '',
      barcodeSymbology: this.formBarcodeSymbology,
      tax: this.optionalNumber(this.formTax),
      openingStock: this.canEditStock() ? openingStock : (isEdit && existing ? previousOpening : 0),
      openingStockDate: !this.canEditStock()
        ? (isEdit && existing ? (existing.openingStockDate || undefined) : undefined)
        : isVariant
        ? variants.map(v => v.openingStockDate).filter((d): d is string => !!d).sort()[0]
        : isEdit && existing && !this.openingUnlocked()
          ? (existing.openingStockDate || undefined)
          : (this.formOpeningStockDate || undefined),
      mrp: isVariant ? (derivedMrp || undefined) : this.optionalNumber(this.formMrp),
      minQty: this.optionalNumber(this.formQuantityAlert),
      purchaseTaxMode: this.formPurchaseTaxMode || undefined,
      salesTaxMode: this.formSalesTaxMode || undefined,
      wholesaleQuantity: this.optionalNumber(this.formWholesaleQuantity),
      warrantyDays: type === 'service' ? undefined : this.optionalNumber(this.formWarrantyDays),
      variants: variants.length ? variants : undefined
    };

    if (isEdit) {
      this.dataService.updateProduct({ id: this.editingProductId()!, ...payload });
      const stockNote = existing && existing.stock !== payload.stock
        ? ` · স্টক ${existing.stock} → ${payload.stock}`
        : '';
      const openingNote = existing && this.openingUnlocked() && previousOpening !== openingStock
        ? ` · প্রারম্ভিক ${previousOpening} → ${openingStock} (Admin PIN)`
        : '';
      this.session.log('Product Updated', `${payload.name} (${payload.code})${stockNote}${openingNote}`);
      this.showToast(this.prefs.txt('পণ্য সফলভাবে হালনাগাদ হয়েছে।', 'Product updated successfully.'));
    } else {
      this.dataService.addProduct(payload);
      this.revealNewProduct(payload);
      this.session.log('Product Created', `${payload.name} (${payload.code}) · স্টক ${payload.stock}`);
      this.showToast(this.prefs.txt('পণ্য সফলভাবে তৈরি হয়েছে।', 'Product created successfully.'));
    }

    this.formDirty.set(false);
    this.invalidFields.set([]);
    this.resetOpeningUnlock();
    if (continueAdding && !isEdit) {
      this.openAddModal();
    } else {
      this.showAddModal.set(false);
      this.closeCombo();
    }
  }

  private validateUnits(units: ProductUnit[] | undefined): string {
    if (!units?.length) return '';
    const baseKey = (this.formUnit || '').trim().toLowerCase();
    const seen = new Set<string>();
    for (const unit of units) {
      const key = unit.name.toLowerCase();
      if (!unit.name) return this.prefs.txt('অতিরিক্ত ইউনিটের নাম দিন।', 'Give the extra unit a name.');
      if (key === baseKey) return this.prefs.txt(`"${unit.name}" বেস ইউনিটের নামেই আছে — আলাদা কোনো ইউনিট বেছে নিন।`, `"${unit.name}" is the base unit — pick a different one.`);
      if (seen.has(key)) return this.prefs.txt(`"${unit.name}" ইউনিট একাধিকবার যোগ করা আছে।`, `Unit "${unit.name}" is added more than once.`);
      seen.add(key);
      if (!(unit.factor > 0)) return this.prefs.txt(`"${unit.name}" এর রূপান্তর ০ এর চেয়ে বড় হতে হবে, অথবা খালি রাখলে ১:১ ধরা হবে।`, `The conversion for "${unit.name}" must be greater than 0, or leave it blank for 1:1.`);
    }
    return '';
  }

  private revealNewProduct(product: Pick<Product, 'type' | 'brand' | 'model' | 'category' | 'subCategory'>) {
    this.activeTab.set(product.type);
    this.resetPage();
    if (this.selectedBrand() && this.selectedBrand() !== product.brand) this.selectedBrand.set('');
    if (this.selectedModel() && !hasProductModel(product.model, this.selectedModel())) this.selectedModel.set('');
    if (this.selectedCategory()) {
      const filter = this.categoryFilterMatch();
      const visible = filter.subCategory
        ? product.category === filter.category && (product.subCategory || '') === filter.subCategory
        : product.category === filter.category;
      if (!visible) this.selectedCategory.set('');
    }
    if (this.searchQuery().trim()) this.searchQuery.set('');
  }

  private focusFirstInvalid(fields: string[]) {
    if (typeof document === 'undefined') return;
    const map: Record<string, string> = {
      'Name': 'product-name',
      'Type': 'product-type',
      'Warehouse': 'product-warehouse',
      'Category': 'product-category',
      'Unit': 'product-unit',
      'Barcode Symbology': 'product-barcode',
      'Item Code': 'product-code',
      'Slug': 'product-slug',
      'Purchase Price': 'product-purchase-price',
      'Sales Price': 'product-sales-price',
      'Variant': 'product-variation',
      'Variant Item Code': 'product-variant-add'
    };
    const id = fields.map(field => map[field]).find(Boolean);
    if (!id) return;
    window.setTimeout(() => {
      const element = document.getElementById(id);
      element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element?.focus({ preventScroll: true });
    }, 60);
  }

  async deleteProduct(id: number) {
    const product = this.dataService.products().find(p => p.id === id);
    const confirmed = await this.notify.confirm(
      product ? this.prefs.txt(`"${product.name}" ক্যাটালগ থেকে স্থায়ীভাবে মুছে যাবে।`, `"${product.name}" will be permanently removed from the catalogue.`) : this.prefs.txt('এই পণ্যটি স্থায়ীভাবে মুছে যাবে।', 'This product will be permanently removed.'),
      {
        title: this.prefs.txt('পণ্যটি ডিলিট করবেন?', 'Delete this product?'),
        kind: 'error',
        confirmText: this.prefs.txt('ডিলিট', 'Delete')
      }
    );
    if (confirmed) {
      this.dataService.deleteProduct(id);
      this.session.log('Product Deleted', `${product ? `${product.name} (${product.code})` : `ID ${id}`}`);
      this.showToast(this.prefs.txt('পণ্য ডিলিট হয়েছে।', 'Product deleted.'));
    }
  }

  isSelected(id: number): boolean {
    return this.selectedIds().has(id);
  }

  toggleRow(id: number) {
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedIds.set(next);
  }

  toggleAllRows() {
    if (this.allSelected()) {
      this.selectedIds.set(new Set<number>());
      return;
    }
    this.selectedIds.set(new Set(this.pagedProducts().map(p => p.id)));
  }

  clearSelection() {
    this.selectedIds.set(new Set<number>());
  }

  exportSelected() {
    const ids = this.selectedIds();
    const list = this.filteredProducts().filter(p => ids.has(p.id));
    if (!list.length) return;
    this.dataService.exportProductsToExcel(list, 'Selected_Products');
  }

  async deleteSelected() {
    const ids = this.selectedIds();
    const list = this.dataService.products().filter(p => ids.has(p.id));
    if (!list.length) return;
    const confirmed = await this.notify.confirm(
      this.prefs.txt(`${list.length} টি পণ্য ক্যাটালগ থেকে স্থায়ীভাবে মুছে যাবে।`, `${list.length} products will be permanently removed from the catalogue.`),
      {
        title: this.prefs.txt('নির্বাচিত পণ্য ডিলিট করবেন?', 'Delete selected products?'),
        kind: 'error',
        confirmText: this.prefs.txt('ডিলিট', 'Delete')
      }
    );
    if (!confirmed) return;
    for (const product of list) this.dataService.deleteProduct(product.id);
    this.session.log('Products Deleted', `${list.length} টি পণ্য: ${list.slice(0, 5).map(p => p.name).join(', ')}${list.length > 5 ? '…' : ''}`);
    this.clearSelection();
    this.showToast(this.prefs.txt(`${list.length} টি পণ্য ডিলিট হয়েছে।`, `${list.length} products deleted.`));
  }

  viewProduct(p: Product) {
    this.viewingProduct.set(p);
  }

  /** Purchase dates are DD-MM-YYYY; createdAt keeps the true order when present. */
  private purchaseSortKey(purchase: Purchase): string {
    if (purchase.createdAt) return purchase.createdAt;
    const [day, month, year] = (purchase.date || '').split('-');
    return `${year || ''}-${month || ''}-${day || ''}`;
  }

  /** Sale dates are DD-MM-YYYY, so the newest invoice sorts by rebuilt ISO date. */
  private saleSortKey(sale: Sale): string {
    const [day, month, year] = (sale.date || '').split('-');
    const key = `${year || ''}-${month || ''}-${day || ''}`;
    return `${key}|${String(sale.id ?? '').padStart(8, '0')}`;
  }

  hoverText(p: Product): string {
    const money = (v: number) => `৳${(Number(v) || 0).toFixed(2)}`;
    const lines = [
      p.name,
      this.prefs.txt(`কোড: ${p.code} | টাইপ: ${p.type}`, `Code: ${p.code} | Type: ${p.type}`),
      this.prefs.txt(`ক্যাটাগরি: ${p.category}${p.subCategory ? ' / ' + p.subCategory : ''}`, `Category: ${p.category}${p.subCategory ? ' / ' + p.subCategory : ''}`),
      this.prefs.txt(`ব্র্যান্ড: ${p.brand} | মডেল: ${p.model} | র্যাক: ${p.rack || '—'}`, `Brand: ${p.brand} | Model: ${p.model} | Rack: ${p.rack || '—'}`),
      this.prefs.txt(`স্টক: ${p.stock} ${p.unit} | বিক্রয়: ${money(p.salesPrice)} | ক্রয়: ${money(p.purchasePrice)} | পাইকারি: ${money(p.wholesalePrice)}`, `Stock: ${p.stock} ${p.unit} | Sales: ${money(p.salesPrice)} | Purchase: ${money(p.purchasePrice)} | Wholesale: ${money(p.wholesalePrice)}`),
    ];
    if (p.variants?.length) lines.push(this.prefs.txt(`ভ্যারিয়েশন: ${p.variants.length} টি`, `Variations: ${p.variants.length}`));
    return lines.join('\n');
  }

  closeView() {
    this.viewingProduct.set(null);
  }

  editFromView(p: Product) {
    this.closeView();
    this.openEditModal(p);
  }

  typeBadgeClass(type: Product['type']): string {
    if (type === 'variant') return 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30';
    if (type === 'service') return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30';
    return 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30';
  }

  variantStockSum(p: Product): number {
    return (p.variants || []).reduce((sum, v) => sum + (Number(v.openingStock) || 0), 0);
  }

  variantMin(p: Product, field: 'salesPrice' | 'wholesalePrice'): number {
    const values = (p.variants || []).map(v => Number(v[field]) || 0).filter(value => value > 0);
    return values.length ? Math.min(...values) : 0;
  }

  /** Variant products price every variant separately, so cards and rows show the whole span. */
  priceText(p: Product, field: 'salesPrice' | 'wholesalePrice' | 'purchasePrice'): string {
    const variantPrices = (p.variants || [])
      .map(variant => Number(variant[field]) || 0)
      .filter(value => value > 0);
    const min = variantPrices.length ? Math.min(...variantPrices) : Number(p[field]) || 0;
    const max = variantPrices.length ? Math.max(...variantPrices) : min;
    const money = (value: number) => `৳${formatNumber(value, 'en-US', '1.2-2')}`;
    return max > min ? `${money(min)} – ${money(max)}` : money(min);
  }

  stockBadgeClass(stock: number): string {
    if (stock <= 0) return 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40';
    if (stock <= 5) return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40';
  }

  stockTextClass(stock: number): string {
    if (stock <= 0) return 'text-rose-600 dark:text-rose-400';
    if (stock <= 5) return 'text-amber-600 dark:text-amber-400';
    return 'text-emerald-700 dark:text-emerald-400';
  }

  exportExcel() {
    this.dataService.exportProductsToExcel(this.filteredProducts(), 'Products_Master_List');
  }

  async onFileImport(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file || this.importing()) return;
    const count = (value: number) => formatNumber(value, 'en-IN');
    try {
      this.importing.set(true);
      const preview = await this.dataService.analyzeProductImport(file);
      this.importing.set(false);
      if (!preview.totalRows) {
        this.showToast(this.prefs.txt('এই ফাইলে কোনো পণ্য পাওয়া যায়নি।', 'No products were found in this file.'), 'error');
        return;
      }
      const lines = [
        this.prefs.txt(`ফাইল: ${file.name}`, `File: ${file.name}`),
        this.prefs.txt(
          `পণ্য সারি: ${count(preview.totalRows)} • নতুন: ${count(preview.added)} • আপডেট: ${count(preview.updated)}${preview.skipped ? ` • বাদ: ${count(preview.skipped)}` : ''}`,
          `Rows: ${count(preview.totalRows)} • New: ${count(preview.added)} • Updated: ${count(preview.updated)}${preview.skipped ? ` • Skipped: ${count(preview.skipped)}` : ''}`
        )
      ];
      if (preview.variants) {
        lines.push(this.prefs.txt(`ভ্যারিয়েশন: ${count(preview.variants)}`, `Variations: ${count(preview.variants)}`));
      }
      lines.push(this.prefs.txt(
        `নতুন ক্যাটাগরি: ${count(preview.newCategories.length)} • সাব-ক্যাটাগরি: ${count(preview.newSubCategories.length)} • ব্র্যান্ড: ${count(preview.newBrands.length)} • মডেল: ${count(preview.newModels.length)}`,
        `New categories: ${count(preview.newCategories.length)} • sub-categories: ${count(preview.newSubCategories.length)} • brands: ${count(preview.newBrands.length)} • models: ${count(preview.newModels.length)}`
      ));
      if (preview.warnings.length) lines.push('', ...preview.warnings.slice(0, 4));
      lines.push('', this.prefs.txt('ইমপোর্ট শুরু করবেন?', 'Start the import?'));
      const confirmed = await this.notify.confirm(lines.join('\n'), {
        title: this.prefs.txt('এক্সেল ইমপোর্ট — যাচাই', 'Excel import — review'),
        kind: 'info',
        confirmText: this.prefs.txt('ইমপোর্ট করুন', 'Import'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      });
      if (!confirmed) return;
      this.importing.set(true);
      // Let the spinner paint before the row-by-row build blocks the main thread.
      await new Promise(resolve => setTimeout(resolve, 50));
      const result = await this.dataService.importProducts(file);
      const masters = result.newCategories.length + result.newSubCategories.length
        + result.newBrands.length + result.newModels.length;
      this.session.log('Product Import', `${file.name}: নতুন ${result.added}, আপডেট ${result.updated}${result.variants ? `, ভ্যারিয়েশন ${result.variants}` : ''}${result.skipped ? `, বাদ ${result.skipped}` : ''}`);
      this.showToast(this.prefs.txt(
        `${count(result.added)}টি নতুন পণ্য, ${count(result.updated)}টি আপডেট${result.variants ? `, ${count(result.variants)}টি ভ্যারিয়েশন` : ''}${result.skipped ? `, ${count(result.skipped)}টি সারি বাদ` : ''}${masters ? `; ${count(masters)}টি নতুন ক্যাটাগরি/সাব-ক্যাটাগরি/ব্র্যান্ড/মডেল তৈরি হয়েছে` : ''}।`,
        `Imported ${count(result.added)} new products, updated ${count(result.updated)}${result.variants ? `, ${count(result.variants)} variants` : ''}${result.skipped ? `, skipped ${count(result.skipped)}` : ''}${masters ? `; created ${count(masters)} new masters` : ''}.`
      ));
    } catch (error) {
      this.showToast(this.prefs.txt(
        `ইমপোর্ট ব্যর্থ: ${error instanceof Error ? error.message : String(error)}`,
        `Import failed: ${error instanceof Error ? error.message : String(error)}`
      ), 'error');
    } finally {
      this.importing.set(false);
    }
  }
}
