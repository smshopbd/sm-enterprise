import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, DamageRecord, Product, ProductVariant } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';
import { DmyDateDirective } from '../../directives/dmy-date.directive';

interface DamageOption {
  product: Product;
  variant?: ProductVariant;
}

interface ProductChoice extends DamageOption {
  label: string;
  stock: number;
  price: number;
  unit: string;
}

@Component({
  selector: 'app-damage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, DmyDateDirective],
  styles: `
    /* Sticky column-title band so rows scroll under the teal header. */
    .pt-sticky {
      position: sticky;
      top: 0;
      z-index: 5;
      background-color: var(--sm-brand, #0d9488);
    }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">

      <!-- Page Header -->
      <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">warning</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                <span>{{ prefs.txt('ইনভেন্টরি', 'Inventory') }}</span>
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                <span>{{ prefs.txt('ড্যামেজ', 'Damage') }}</span>
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('ড্যামেজ রেকর্ড', 'Damage records') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('নষ্ট, ভাঙা বা মেয়াদোত্তীর্ণ পণ্যের ক্ষতি ও স্টক সমন্বয়।', 'Loss and stock adjustment for damaged, broken or expired goods.') }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button (click)="exportExcel()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon class="text-sm text-emerald-200">description</mat-icon> {{ prefs.txt('এক্সেল', 'Excel') }}
            </button>
            <button (click)="printPage()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon class="text-sm">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
            <button (click)="openAddModal()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon class="text-sm">add</mat-icon> {{ prefs.txt('নতুন ড্যামেজ', 'New damage') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Status Tabs -->
      <div class="no-print bg-white p-2 rounded-xl shadow-xs border border-slate-200 flex items-center gap-2 overflow-x-auto">
        @for (t of tabDefs(); track t.value) {
          @if (activeTab() === t.value) {
            <button
              (click)="activeTab.set(t.value); pager.setPage(1)"
              class="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-teal-700 text-white shadow-2xs cursor-pointer"
            >
              <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
              <span>{{ t.label }}</span>
              <span class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-white/25 text-[10px] font-black">{{ tabCount(t.value) }}</span>
            </button>
          } @else {
            <button
              (click)="activeTab.set(t.value); pager.setPage(1)"
              class="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
            >
              <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
              <span>{{ t.label }}</span>
              <span class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-black text-slate-600 dark:text-slate-300">{{ tabCount(t.value) }}</span>
            </button>
          }
        }
      </div>

      <!-- Search Bar & Summary -->
      <div class="no-print bg-white p-3 rounded-xl shadow-xs border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div class="relative w-full sm:max-w-sm">
          <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
          <input
            type="text"
            [placeholder]="prefs.txt('ড্যামেজ নম্বর, পণ্য, ওয়্যারহাউস বা তারিখ দিয়ে খুঁজুন...', 'Search by damage no, product, warehouse or date...')"
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ activeTabLabel() }} · {{ filteredRecords().length }} {{ prefs.txt('টি', 'rows') }}
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200">
            {{ prefs.txt('মোট ক্ষতি', 'Total loss') }} <b class="font-mono text-rose-600 dark:text-rose-400">{{ totals().loss | number:'1.2-2' }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200">
            {{ prefs.txt('রিপোর্টেড', 'Reported') }} <b class="font-mono text-amber-700 dark:text-amber-300">{{ totals().reported }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200">
            {{ prefs.txt('রেজলভ', 'Resolved') }} <b class="font-mono text-emerald-600 dark:text-emerald-400">{{ totals().resolved }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ prefs.txt('কাটা স্টক', 'Deducted stock') }} <b class="font-mono text-slate-800">{{ totals().deductedQty }}</b> {{ prefs.txt('পিস', 'pcs') }}
          </span>
        </div>
      </div>

      <!-- Damage Table (desktop / print) -->
      <div class="list-print-shell hidden lg:block bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div id="list-printable-area" class="overflow-auto max-h-[72vh]">
          <table class="w-full min-w-[1080px] text-xs text-left border-collapse text-slate-700 dark:text-slate-200">
            <thead>
              <tr class="text-white font-bold uppercase text-[11px] tracking-wider">
                <th class="p-2.5 text-center w-10 pt-sticky">SL</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('ড্যামেজ নং', 'DAMAGE NO') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('তারিখ', 'DATE') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('পণ্য', 'PRODUCT') }}</th>
                <th class="p-2.5 text-right pt-sticky">{{ prefs.txt('পরিমাণ', 'QTY') }}</th>
                <th class="p-2.5 text-right pt-sticky">{{ prefs.txt('ইউনিট কস্ট', 'UNIT COST') }}</th>
                <th class="p-2.5 text-right pt-sticky">{{ prefs.txt('ক্ষতি', 'LOSS') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('ওয়্যারহাউস', 'WAREHOUSE') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('করণীয়', 'ACTION') }}</th>
                <th class="p-2.5 text-center pt-sticky">{{ prefs.txt('স্ট্যাটাস', 'STATUS') }}</th>
                <th class="p-2.5 text-center pt-sticky">{{ prefs.txt('স্টক', 'STOCK') }}</th>
                <th class="p-2.5 text-center w-28 pt-sticky">{{ prefs.txt('অ্যাকশন', 'ACTION') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (d of pager.paged(); track d.id; let idx = $index) {
                <tr class="hover:bg-[#e2e8f0] transition-colors">
                  <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-mono font-bold text-slate-800">{{ d.damageNo }}</td>
                  <td class="p-2.5 text-slate-500 whitespace-nowrap">{{ displayDate(d.date) }}</td>
                  <td class="p-2.5">
                    <div class="max-w-[220px] truncate font-bold text-teal-800 dark:text-teal-300" [title]="d.productName">{{ d.productName }}</div>
                    <div class="text-[10px] text-slate-400 truncate" [title]="d.reason">{{ d.reason || '-' }}</div>
                  </td>
                  <td class="p-2.5 text-right font-mono font-semibold text-slate-700 dark:text-slate-200">{{ d.quantity | number:'1.0-0' }}</td>
                  <td class="p-2.5 text-right font-mono text-slate-600">{{ d.unitCost | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-right font-mono font-bold text-rose-600 dark:text-rose-400">{{ d.lossAmount | number:'1.2-2' }} TK</td>
                  <td class="p-2.5 text-slate-600">{{ d.warehouse || '-' }}</td>
                  <td class="p-2.5">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap" [class]="actionBadge(d.action)">{{ actionLabel(d.action) }}</span>
                  </td>
                  <td class="p-2.5 text-center">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap" [class]="statusBadge(d.status)">{{ statusLabel(d.status) }}</span>
                  </td>
                  <td class="p-2.5 text-center">
                    @if (d.stockDeducted) {
                      <span class="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                        <mat-icon class="text-xs">remove_shopping_cart</mat-icon>{{ prefs.txt('কাটা', 'Deducted') }}
                      </span>
                    } @else {
                      <span class="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-500">
                        <mat-icon class="text-xs">shopping_cart</mat-icon>{{ prefs.txt('থামল', 'Kept') }}
                      </span>
                    }
                  </td>
                  <td class="p-2.5 text-center">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="openEditModal(d)" class="p-1 text-amber-600 hover:bg-amber-100 rounded cursor-pointer" [title]="prefs.txt('ড্যামেজ সম্পাদনা', 'Edit damage')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      @if (session.has('deleteRecords')) {
                        <button (click)="deleteRecord(d)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer" [title]="prefs.txt('ড্যামেজ মুছুন', 'Delete damage')">
                          <mat-icon class="text-sm">delete</mat-icon>
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="12" class="p-10 text-center">
                    <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
                      <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                        <mat-icon class="text-2xl text-slate-300">warning</mat-icon>
                      </span>
                      <p class="text-xs font-semibold">{{ prefs.txt('এই স্ট্যাটাসে কোনো ড্যামেজ রেকর্ড পাওয়া যায়নি।', 'No damage record found for this status.') }}</p>
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

      <!-- Damage Cards (mobile / tablet) -->
      <div class="no-print lg:hidden bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden divide-y divide-slate-100">
        @for (d of pager.paged(); track d.id; let idx = $index) {
          <div class="p-3 space-y-2.5">
            <div class="flex items-start justify-between gap-2">
              <button (click)="openEditModal(d)" class="group min-w-0 text-left cursor-pointer">
                <span class="block font-bold text-teal-800 dark:text-teal-300 text-sm truncate group-hover:underline">{{ d.productName }}</span>
                <span class="block text-[10px] text-slate-500 font-mono truncate">{{ d.damageNo }} • SL {{ pager.offset() + idx + 1 }}</span>
              </button>
              <span class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="statusBadge(d.status)">{{ statusLabel(d.status) }}</span>
            </div>

            <div class="grid grid-cols-3 gap-2 text-center bg-slate-50 rounded-lg p-2">
              <div>
                <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('পরিমাণ', 'QTY') }}</p>
                <p class="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px]">{{ d.quantity | number:'1.0-0' }}</p>
              </div>
              <div>
                <p class="text-[9px] uppercase font-bold text-rose-400">{{ prefs.txt('ক্ষতি', 'Loss') }}</p>
                <p class="font-mono font-bold text-[11px] text-rose-600 dark:text-rose-400">{{ d.lossAmount | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('স্টক', 'Stock') }}</p>
                <p class="text-[11px] font-bold" [class]="d.stockDeducted ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-300'">{{ d.stockDeducted ? prefs.txt('কাটা', 'Deducted') : prefs.txt('থামল', 'Kept') }}</p>
              </div>
            </div>

            <div class="flex items-center justify-between gap-2 text-[10px] text-slate-500 flex-wrap">
              <span class="inline-flex items-center gap-1"><mat-icon class="text-xs">event</mat-icon>{{ displayDate(d.date) }}</span>
              <span class="inline-flex items-center gap-1"><mat-icon class="text-xs">warehouse</mat-icon>{{ d.warehouse || '-' }}</span>
              <span class="inline-flex items-center gap-1"><mat-icon class="text-xs">build</mat-icon>{{ actionLabel(d.action) }}</span>
            </div>

            <div class="flex items-center gap-1">
              <button (click)="openEditModal(d)" class="flex-1 inline-flex items-center justify-center gap-1 bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">edit</mat-icon> {{ prefs.txt('সম্পাদনা', 'Edit') }}
              </button>
              @if (session.has('deleteRecords')) {
                <button (click)="deleteRecord(d)" class="inline-flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                  <mat-icon class="text-sm">delete</mat-icon>
                </button>
              }
            </div>
          </div>
        } @empty {
          <div class="p-8 text-center">
            <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
              <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                <mat-icon class="text-2xl text-slate-300">warning</mat-icon>
              </span>
              <p class="text-xs font-semibold">{{ prefs.txt('এই স্ট্যাটাসে কোনো ড্যামেজ রেকর্ড পাওয়া যায়নি।', 'No damage record found for this status.') }}</p>
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

    <!-- Right Side-Over Drawer: Add / Edit Damage -->
    @if (showAddDrawer()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end">
        <div class="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden text-slate-800 animate-in slide-in-from-right duration-300">

          <div class="bg-white border-b border-slate-200">
            <div class="p-4 flex items-center justify-between border-b border-slate-100">
              <div class="flex items-center gap-2">
                <button (click)="closeDrawer()" class="text-slate-400 hover:text-slate-700 cursor-pointer p-1 rounded-full hover:bg-slate-100 transition-colors">
                  <mat-icon class="text-lg">close</mat-icon>
                </button>
                <h2 class="text-base font-bold text-slate-900">
                  {{ isEditMode() ? prefs.txt('ড্যামেজ রেকর্ড সম্পাদনা', 'Edit damage record') : prefs.txt('নতুন ড্যামেজ রেকর্ড', 'New damage record') }}
                </h2>
              </div>
              <span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">{{ prefs.txt('মোট', 'Total') }} {{ dataService.damageRecords().length }} {{ prefs.txt('টি', 'rows') }}</span>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-6 space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('তারিখ', 'Date') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-slate-400 text-sm mr-2">calendar_today</mat-icon>
                  <input type="date" appDmyDate [(ngModel)]="formDate" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('ওয়্যারহাউস', 'Warehouse') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-slate-400 text-sm mr-2">warehouse</mat-icon>
                  <select [(ngModel)]="formWarehouse" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    @for (w of dataService.warehouses(); track w) {
                      <option [value]="w">{{ w }}</option>
                    }
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('পণ্যের নাম', 'Product name') }}</label>
              <div class="relative">
                <div class="flex items-center rounded-xl border border-slate-300 bg-white shadow-xs transition focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/25">
                  <mat-icon class="ml-3 shrink-0 text-base text-teal-600">inventory_2</mat-icon>
                  <input type="text" [ngModel]="formProductName" (ngModelChange)="onProductTyping($event)"
                    (focus)="openProductList()" (blur)="onProductBlur()" (keydown)="onProductKeydown($event)"
                    [placeholder]="prefs.txt('পণ্য লিখুন বা বাছুন...', 'Type or pick a product...')" autocomplete="off" role="combobox"
                    aria-controls="damage-product-list"
                    [attr.aria-expanded]="productOpen()" aria-autocomplete="list"
                    class="w-full bg-transparent px-2.5 py-2.5 text-xs font-semibold text-slate-800 outline-none">
                  @if (formProductName) {
                    <button type="button" (mousedown)="$event.preventDefault()" (click)="clearProduct()" class="mr-0.5 p-1 text-slate-400 hover:text-rose-500 cursor-pointer" [title]="prefs.txt('পণ্য মুছুন', 'Clear product')">
                      <mat-icon class="text-sm">close</mat-icon>
                    </button>
                  }
                  <mat-icon class="mr-2 shrink-0 text-base text-slate-400 transition-transform" [class.rotate-180]="productOpen()">expand_more</mat-icon>
                </div>

                @if (productOpen()) {
                  <div id="damage-product-list" class="absolute z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/15">
                    <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-1.5">
                      <span class="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">{{ prefs.txt('পণ্য বাছুন', 'Pick a product') }}</span>
                      <span class="font-mono text-[9.5px] font-bold text-slate-400">{{ filteredProductChoices().length }}</span>
                    </div>
                    @if (filteredProductChoices().length) {
                      <div class="max-h-64 overflow-y-auto p-1">
                        @for (opt of filteredProductChoices(); track opt.label; let i = $index) {
                          <button type="button" (mousedown)="$event.preventDefault()" (click)="pickProduct(opt)"
                            [class]="i === productActive() ? 'bg-teal-50' : 'hover:bg-slate-50'"
                            class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors cursor-pointer">
                            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border"
                              [class]="opt.variant ? 'border-violet-100 bg-violet-50 text-violet-600' : 'border-teal-100 bg-teal-50 text-teal-700'">
                              <mat-icon class="text-base">{{ opt.variant ? 'tune' : 'inventory_2' }}</mat-icon>
                            </span>
                            <span class="min-w-0 flex-1">
                              <span class="block truncate text-[11.5px] font-bold text-slate-800">{{ opt.label }}</span>
                              <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] font-semibold text-slate-400">
                                @if (opt.variant) {
                                  <span class="font-mono text-violet-500">{{ opt.variant.itemCode }}</span>
                                }
                                <span>{{ prefs.txt('স্টক', 'Stock') }} <b class="font-mono" [class]="opt.stock > 0 ? 'text-emerald-600' : 'text-rose-500'">{{ opt.stock }}</b> {{ opt.unit }}</span>
                                <span>{{ prefs.txt('ক্রয়', 'Cost') }} <b class="font-mono text-slate-600">{{ opt.price | number:'1.2-2' }}</b></span>
                              </span>
                            </span>
                            @if (isPicked(opt)) {
                              <mat-icon class="shrink-0 text-base text-teal-600">check_circle</mat-icon>
                            }
                          </button>
                        }
                      </div>
                    } @else {
                      <div class="flex flex-col items-center gap-1 px-4 py-6 text-center">
                        <mat-icon class="text-2xl text-slate-300">search_off</mat-icon>
                        <p class="text-[11px] font-bold text-slate-500">{{ prefs.txt('এই নামে কোনো পণ্য পাওয়া যায়নি', 'No product matches this name') }}</p>
                        <p class="text-[10px] text-slate-400">{{ prefs.txt('পুরো নাম বা অন্য বানান দিয়ে খুঁজে দেখুন।', 'Try the full name or a different spelling.') }}</p>
                      </div>
                    }
                  </div>
                }
              </div>

              @if (matchedOption(); as opt) {
                <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                  @if (opt.variant) {
                    <span class="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-violet-700">
                      <mat-icon class="text-xs">tune</mat-icon> {{ matchedLabel() }} · {{ opt.variant.itemCode }}
                    </span>
                  }
                  <span class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-500">
                    <mat-icon class="text-xs text-slate-400">inventory</mat-icon>
                    {{ prefs.txt('লভ্য স্টক', 'Available stock') }} <b class="font-mono text-slate-800">{{ matchedStock() }}</b> {{ opt.product.unit || prefs.txt('পিস', 'pcs') }}
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-500">
                    <mat-icon class="text-xs text-slate-400">payments</mat-icon>
                    {{ prefs.txt('ক্রয় মূল্য', 'Purchase price') }}
                    <b class="font-mono text-slate-800">{{ (opt.variant ? opt.variant.purchasePrice : opt.product.purchasePrice) | number:'1.2-2' }}</b>
                  </span>
                </div>
              } @else {
                @if (formProductName) {
                  <p class="mt-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1">
                    <mat-icon class="text-xs">error</mat-icon>
                    {{ prefs.txt('এই নামে কোনো পণ্য নেই — স্ট্যাটাস এগোলেও স্টক কমবে না।', 'No product with this name — stock will not be deducted even after the status advances.') }}
                  </p>
                }
              }
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('পরিমাণ', 'Quantity') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <input type="number" min="0" step="1" [ngModel]="formQty" (ngModelChange)="onQtyChange($event)"
                    class="w-full bg-transparent outline-none text-xs font-bold font-mono text-slate-900">
                  <span class="text-slate-500 text-[10px] font-bold">{{ prefs.txt('পিস', 'pcs') }}</span>
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ইউনিট কস্ট', 'Unit cost') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-400">
                  <span class="bg-slate-100 text-slate-600 font-bold px-2 py-1.5 border-r border-slate-300 text-[10px]">TK</span>
                  <input type="number" min="0" step="0.01" [ngModel]="formUnitCost" (ngModelChange)="onUnitCostChange($event)"
                    class="w-full p-1.5 outline-none text-xs font-bold font-mono text-slate-900">
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('মোট ক্ষতি', 'Total loss') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-400">
                  <span class="bg-slate-100 text-slate-600 font-bold px-2 py-1.5 border-r border-slate-300 text-[10px]">TK</span>
                  <input type="number" min="0" step="0.01" [ngModel]="formLoss" (ngModelChange)="onLossChange($event)"
                    class="w-full p-1.5 outline-none text-xs font-bold font-mono text-slate-900">
                </div>
              </div>
            </div>

            @if (qtyExceedsStock()) {
              <div class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <mat-icon class="text-sm">warning</mat-icon>
                {{ prefs.txt('লভ্য স্টকের', 'Available stock is') }} ({{ matchedStock() }}) {{ prefs.txt('এর চেয়ে বেশি পরিমাণ দেওয়া হয়েছে।', '— quantity exceeds it.') }}
              </div>
            }

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('কারণ', 'Reason') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-slate-400 text-sm mr-2">report_problem</mat-icon>
                  <input type="text" [(ngModel)]="formReason" [placeholder]="prefs.txt('ভাঙা / পানি লেগা / মেয়াদ শেষ', 'Broken / water damage / expired')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('করণীয়', 'Action') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-slate-400 text-sm mr-2">build</mat-icon>
                  <select [(ngModel)]="formAction" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    @for (a of actionDefs(); track a) {
                      <option [value]="a">{{ actionLabel(a) }}</option>
                    }
                  </select>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('স্ট্যাটাস', 'Status') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-emerald-500 text-sm mr-2">check_circle</mat-icon>
                  <select [(ngModel)]="formStatus" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    @for (s of statusDefs(); track s) {
                      <option [value]="s">{{ statusLabel(s) }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="sm:col-span-1 flex items-end">
                <p class="text-[10px] font-semibold text-slate-500 leading-4">
                  @if (formStatus === 'Reported') {
                    {{ prefs.txt('এখন শুধু রিপোর্ট — স্টক কাটা হবে না।', 'Report only for now — stock will not be deducted.') }}
                  } @else {
                    {{ prefs.txt('স্ট্যাটাস Reported ছাড়িয়ে গেলেই পণ্যের স্টক কেটে নেওয়া হবে।', 'Once the status passes Reported, product stock will be deducted.') }}
                  }
                </p>
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('নোট / মন্তব্য', 'Note / remarks') }}</label>
              <textarea rows="3" [(ngModel)]="formNote" [placeholder]="prefs.txt('কার সামনে, কীভাবে নষ্ট হয়েছে...', 'In whose presence, how it got damaged...')"
                class="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium text-slate-800 focus:ring-2 focus:ring-teal-400 focus:outline-none"></textarea>
            </div>
          </div>

          <div class="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
            <button (click)="closeDrawer()" class="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer transition-colors">
              {{ prefs.txt('বাতিল', 'Cancel') }}
            </button>
            <button (click)="saveDamageForm()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-2xs cursor-pointer transition-colors">
              <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ করুন', 'Save') }}
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class Damage {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  session = inject(SessionService);
  prefs = inject(PreferencesService);

  activeTab = signal<string>('All');
  searchQuery = signal<string>('');
  showAddDrawer = signal<boolean>(false);
  isEditMode = signal<boolean>(false);
  editingDamageId = signal<number | null>(null);
  productOpen = signal<boolean>(false);
  productActive = signal<number>(0);

  readonly statusDefs = signal<DamageRecord['status'][]>(['Reported', 'Approved', 'Resolved']);
  readonly actionDefs = signal<DamageRecord['action'][]>(['Scrapped', 'Repaired', 'Returned to Supplier', 'Written Off']);

  // Form state
  formDate = localDateIso();
  formProductName = '';
  formQty = 0;
  formUnitCost = 0;
  formLoss = 0;
  formWarehouse = 'SM Warehouse';
  formReason = '';
  formAction: DamageRecord['action'] = 'Scrapped';
  formStatus: DamageRecord['status'] = 'Reported';
  formNote = '';
  lossManual = false;

  readonly productChoices = computed<ProductChoice[]>(() =>
    this.dataService.products().flatMap(p => {
      const unit = p.unit || this.prefs.txt('পিস', 'pcs');
      const variants = p.variants || [];
      if (!variants.length) {
        return [{
          label: p.name,
          product: p,
          stock: Number(p.stock) || 0,
          price: Number(p.purchasePrice) || 0,
          unit
        }];
      }
      return variants.map(v => ({
        label: `${p.name} - ${v.variantValue}`,
        product: p,
        variant: v,
        stock: Number(v.openingStock) || 0,
        price: Number(v.purchasePrice) || 0,
        unit
      }));
    })
  );

  filteredProductChoices(): ProductChoice[] {
    const q = (this.formProductName || '').toLowerCase().trim();
    const list = this.productChoices();
    if (!q) return list.slice(0, 60);
    const parts = q.split(/\s+/);
    return list.filter(choice => {
      const hay = `${choice.label} ${choice.variant?.itemCode || ''}`.toLowerCase();
      return parts.every(part => hay.includes(part));
    }).slice(0, 60);
  }

  openProductList() {
    this.productOpen.set(true);
    const key = (this.formProductName || '').trim().toLowerCase();
    const list = this.filteredProductChoices();
    const at = list.findIndex(choice => choice.label.toLowerCase() === key);
    this.productActive.set(at >= 0 ? at : 0);
  }

  onProductTyping(value: string) {
    this.productOpen.set(true);
    this.productActive.set(0);
    this.onProductNameChange(value);
  }

  onProductKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.productOpen.set(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.productOpen()) {
        this.openProductList();
        return;
      }
      const list = this.filteredProductChoices();
      if (!list.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.productActive.set((this.productActive() + step + list.length) % list.length);
      return;
    }
    if (event.key === 'Enter' && this.productOpen()) {
      const choice = this.filteredProductChoices()[this.productActive()];
      if (choice) {
        event.preventDefault();
        this.pickProduct(choice);
      }
    }
  }

  onProductBlur() {
    setTimeout(() => this.productOpen.set(false), 120);
  }

  pickProduct(choice: ProductChoice) {
    this.formProductName = choice.label;
    this.formUnitCost = choice.price;
    this.syncLoss();
    this.productOpen.set(false);
  }

  clearProduct() {
    this.formProductName = '';
    this.productActive.set(0);
    this.productOpen.set(true);
  }

  isPicked(choice: ProductChoice): boolean {
    return choice.label.trim().toLowerCase() === (this.formProductName || '').trim().toLowerCase();
  }

  readonly tabDefs = computed(() => [
    { value: 'All', label: this.prefs.txt('সব রেকর্ড', 'All records'), icon: 'warning' },
    { value: 'Reported', label: this.prefs.txt('রিপোর্টেড', 'Reported'), icon: 'report' },
    { value: 'Approved', label: this.prefs.txt('অনুমোদিত', 'Approved'), icon: 'verified' },
    { value: 'Resolved', label: this.prefs.txt('রেজলভ', 'Resolved'), icon: 'task_alt' }
  ]);

  tabCount(value: string): number {
    const list = this.dataService.damageRecords();
    return value === 'All' ? list.length : list.filter(d => d.status === value).length;
  }

  activeTabLabel(): string {
    const tab = this.tabDefs().find(t => t.value === this.activeTab());
    return tab ? tab.label : this.prefs.txt('সব রেকর্ড', 'All records');
  }

  filteredRecords = computed(() => {
    let list = this.dataService.damageRecords();
    const tab = this.activeTab();
    const q = this.searchQuery().toLowerCase().trim();

    if (tab !== 'All') list = list.filter(d => d.status === tab);

    if (q) {
      list = list.filter(d =>
        d.damageNo.toLowerCase().includes(q) ||
        (d.productName || '').toLowerCase().includes(q) ||
        (d.warehouse || '').toLowerCase().includes(q) ||
        (d.reason || '').toLowerCase().includes(q) ||
        this.displayDate(d.date).includes(q)
      );
    }

    return list;
  });

  readonly pager = createPager(() => this.filteredRecords());

  totals = computed(() => {
    const list = this.filteredRecords();
    return {
      loss: Math.round(list.reduce((acc, d) => acc + (Number(d.lossAmount) || 0), 0) * 100) / 100,
      reported: list.filter(d => d.status === 'Reported').length,
      resolved: list.filter(d => d.status === 'Resolved').length,
      deductedQty: list.filter(d => d.stockDeducted).reduce((acc, d) => acc + (Number(d.quantity) || 0), 0)
    };
  });

  onSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.searchQuery.set(target.value);
    this.pager.setPage(1);
  }

  displayDate(value: string): string {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || '').trim());
    return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : (value || '-');
  }

  isoDay(value: string): string {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || '').trim());
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : (value || '');
  }

  statusBadge(status: DamageRecord['status']): string {
    const map: Record<DamageRecord['status'], string> = {
      'Reported': 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
      'Approved': 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
      'Resolved': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
    };
    return map[status] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }

  actionLabel(action: DamageRecord['action']): string {
    const map: Record<DamageRecord['action'], string> = {
      'Scrapped': this.prefs.txt('স্ক্র্যাপ', 'Scrapped'),
      'Repaired': this.prefs.txt('মেরামত', 'Repaired'),
      'Returned to Supplier': this.prefs.txt('সরবরাহকারীকে ফেরত', 'Returned to supplier'),
      'Written Off': this.prefs.txt('খরচ হিসেবে খারিজ', 'Written off')
    };
    return map[action] || action;
  }

  statusLabel(status: DamageRecord['status']): string {
    const map: Record<DamageRecord['status'], string> = {
      'Reported': this.prefs.txt('রিপোর্টেড', 'Reported'),
      'Approved': this.prefs.txt('অনুমোদিত', 'Approved'),
      'Resolved': this.prefs.txt('রেজলভ', 'Resolved')
    };
    return map[status] || status;
  }

  actionBadge(action: DamageRecord['action']): string {
    const map: Record<DamageRecord['action'], string> = {
      'Scrapped': 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
      'Repaired': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300',
      'Returned to Supplier': 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300',
      'Written Off': 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
    };
    return map[action] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }

  /** Stock/product lookup for the drawer; plain methods so hand-typed names stay reactive. */
  matchedOption(): DamageOption | null {
    const key = (this.formProductName || '').trim().toLowerCase();
    if (!key) return null;
    for (const p of this.dataService.products()) {
      for (const v of p.variants || []) {
        if (`${p.name} - ${v.variantValue}`.trim().toLowerCase() === key) {
          return { product: p, variant: v };
        }
      }
      if ((p.name || '').trim().toLowerCase() === key) return { product: p };
    }
    return null;
  }

  matchedStock(): number {
    const hit = this.matchedOption();
    if (!hit) return 0;
    return Number(hit.variant ? hit.variant.openingStock : hit.product.stock) || 0;
  }

  matchedLabel(): string {
    const hit = this.matchedOption();
    if (!hit) return '';
    return hit.variant ? `${hit.variant.variationName} · ${hit.variant.variantValue}` : '';
  }

  qtyExceedsStock(): boolean {
    return !!this.matchedOption() && this.formQty > 0 && this.formQty > this.matchedStock();
  }

  onProductNameChange(value: string) {
    this.formProductName = value || '';
    const hit = this.matchedOption();
    if (hit) this.formUnitCost = Number(hit.variant ? hit.variant.purchasePrice : hit.product.purchasePrice) || 0;
    this.syncLoss();
  }

  onQtyChange(value: number) {
    this.formQty = Number(value) || 0;
    this.syncLoss();
  }

  onUnitCostChange(value: number) {
    this.formUnitCost = Number(value) || 0;
    this.syncLoss();
  }

  onLossChange(value: number) {
    this.formLoss = Number(value) || 0;
    this.lossManual = true;
  }

  private syncLoss() {
    if (this.lossManual) return;
    this.formLoss = Math.round((this.formQty * this.formUnitCost) * 100) / 100;
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.editingDamageId.set(null);
    this.formDate = localDateIso();
    this.formProductName = '';
    this.formQty = 0;
    this.formUnitCost = 0;
    this.formLoss = 0;
    this.formWarehouse = 'SM Warehouse';
    this.formReason = '';
    this.formAction = 'Scrapped';
    this.formStatus = 'Reported';
    this.formNote = '';
    this.lossManual = false;
    this.showAddDrawer.set(true);
  }

  openEditModal(d: DamageRecord) {
    this.isEditMode.set(true);
    this.editingDamageId.set(d.id);
    this.formDate = this.isoDay(d.date);
    this.formProductName = d.productName || '';
    this.formQty = d.quantity || 0;
    this.formUnitCost = d.unitCost || 0;
    this.formLoss = d.lossAmount || 0;
    this.formWarehouse = d.warehouse || 'SM Warehouse';
    this.formReason = d.reason || '';
    this.formAction = d.action;
    this.formStatus = d.status;
    this.formNote = d.note || '';
    // A stored loss amount may already include labour or partial-value judgement.
    this.lossManual = true;
    this.showAddDrawer.set(true);
  }

  closeDrawer() {
    this.showAddDrawer.set(false);
  }

  saveDamageForm() {
    const cleanProduct = (this.formProductName || '').trim();
    if (!cleanProduct) {
      this.notify.error(this.prefs.txt('পণ্যের নাম লিখুন।', 'Enter the product name.'), this.prefs.txt('পণ্য নেই', 'No product'));
      return;
    }
    if (this.formQty <= 0) {
      this.notify.error(this.prefs.txt('নষ্ট পণ্যের পরিমাণ ০ এর বেশি দিন।', 'Damaged quantity must be greater than 0.'), this.prefs.txt('পরিমাণ ভুল', 'Invalid quantity'));
      return;
    }
    if (!this.isoDay(this.formDate)) {
      this.notify.error(this.prefs.txt('তারিখ লিখুন।', 'Enter the date.'), this.prefs.txt('তারিখ নেই', 'No date'));
      return;
    }
    const variantId = this.matchedOption()?.variant?.id;

    const lossAmount = Math.round((Number(this.formLoss) || 0) * 100) / 100;

    if (this.isEditMode() && this.editingDamageId() !== null) {
      const patch: Partial<DamageRecord> = {
        date: this.isoDay(this.formDate),
        productName: cleanProduct,
        variantId,
        quantity: this.formQty,
        unitCost: Number(this.formUnitCost) || 0,
        lossAmount,
        warehouse: this.formWarehouse,
        reason: (this.formReason || '').trim(),
        action: this.formAction,
        status: this.formStatus,
        note: (this.formNote || '').trim()
      };
      this.dataService.updateDamageRecord(this.editingDamageId()!, patch);
      this.notify.success(this.prefs.txt('ড্যামেজ রেকর্ড আপডেট হয়েছে এবং স্টক ঠিক করা হয়েছে।', 'Damage record updated and stock adjusted.'));
    } else {
      this.dataService.addDamageRecord({
        date: this.isoDay(this.formDate),
        productName: cleanProduct,
        variantId,
        quantity: this.formQty,
        unitCost: Number(this.formUnitCost) || 0,
        lossAmount,
        warehouse: this.formWarehouse,
        reason: (this.formReason || '').trim(),
        action: this.formAction,
        status: this.formStatus,
        stockDeducted: false,
        note: (this.formNote || '').trim()
      });
      this.notify.success(this.prefs.txt('নতুন ড্যামেজ রেকর্ড সংরক্ষিত হয়েছে।', 'New damage record saved.'));
    }

    this.showAddDrawer.set(false);
  }

  async deleteRecord(d: DamageRecord) {
    const confirmed = await this.notify.confirm(
      d.stockDeducted
        ? this.prefs.txt(`${d.damageNo} রেকর্ডটি মুছলে কাটা ${d.quantity} পিস স্টক ফিরে আসবে।`, `Deleting ${d.damageNo} will return ${d.quantity} pcs of deducted stock.`)
        : this.prefs.txt(`${d.damageNo} রেকর্ডটি স্থায়ীভাবে মুছে যাবে।`, `${d.damageNo} will be deleted permanently.`),
      {
        title: this.prefs.txt('ড্যামেজ রেকর্ড মুছে ফেলবেন?', 'Delete this damage record?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছুন', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (confirmed) {
      this.dataService.deleteDamageRecord(d.id);
      this.notify.success(this.prefs.txt('ড্যামেজ রেকর্ড মুছে ফেলা হয়েছে।', 'Damage record deleted.'));
    }
  }

  exportExcel() {
    this.dataService.exportToExcel(this.filteredRecords(), 'Damage_Records');
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
