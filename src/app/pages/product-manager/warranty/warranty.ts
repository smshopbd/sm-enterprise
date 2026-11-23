import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import {
  DataService,
  ProductWarranty,
  PURCHASE_PARTY_TYPES,
  SALES_PARTY_TYPES
} from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';
import { WarrantyQuickClaim } from '../../../components/warranty-quick-claim/warranty-quick-claim';
import { dmyFromIso, localDateIso } from '../../../utils/local-date';
import {
  WarrantyRegisterRow,
  WarrantyTab,
  isWarrantyCancelled,
  isWarrantyCompleted,
  isoDay,
  warrantyRemainingDays,
  warrantyRowMatches,
  warrantyRowsForTab
} from '../../../utils/warranty';

interface ManualForm {
  customerName: string;
  phoneNumber: string;
  productName: string;
  serialNumber: string;
  invoiceNumber: string;
  saleDate: string;
  warrantyDays: number | string | null;
  type: 'Selling' | 'Purchase';
  notes: string;
}

@Component({
  selector: 'app-warranty',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, DmyDateDirective, RouterLink, WarrantyQuickClaim],
  template: `
    <div class="space-y-4 text-xs text-slate-800">

      <!-- Header -->
      <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

        <div class="relative flex flex-col gap-3 xl:flex-row xl:items-center justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">verified_user</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                {{ prefs.txt('প্রোডাক্ট ম্যানেজার', 'Product Manager') }}
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                {{ prefs.txt('ওয়ারেন্টি', 'Warranty') }}
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt("ওয়ারেন্টি ব্যবস্থাপনা", "Warranty Management") }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt("ওয়ারেন্টি তালিকা, ক্লেইম ও গ্রহণ স্টক — সব এক জায়গা থেকে। যেকোনো সারিতে ক্লিক করে বিস্তারিত দেখুন।", "Warranty list, claims and intake stock in one place. Click any row to see details.") }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <a routerLink="/warranty/settings" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20">
              <mat-icon class="text-xs">tune</mat-icon> {{ prefs.txt("কাস্টমাইজ", "Customize") }}
            </a>
            <button (click)="exportExcel()" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer">
              <mat-icon class="text-xs">file_download</mat-icon> {{ prefs.txt("এক্সপোর্ট", "Export") }}
            </button>
            <button (click)="printPage()" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer">
              <mat-icon class="text-xs">print</mat-icon> {{ prefs.txt("লিস্ট প্রিন্ট", "Print List") }}
            </button>
            <button (click)="openManualEntry()" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer">
              <mat-icon class="text-xs">add</mat-icon> {{ prefs.txt("ম্যানুয়াল এন্ট্রি", "Manual Entry") }}
            </button>
            <button (click)="openQuickClaim()" class="inline-flex items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 transition hover:bg-teal-50 cursor-pointer">
              <mat-icon class="text-xs">assignment_return</mat-icon> {{ prefs.txt("ফেরত / ক্লেইম", "Return / Claim") }}
            </button>
          </div>
        </div>
      </div>

      <!-- Warranty pages -->
      <div class="no-print grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
        <a routerLink="/warranty/receive" class="group rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-sm transition">
          <div class="flex items-center justify-between gap-2">
            <span class="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 flex items-center justify-center"><mat-icon class="text-sm">assignment_return</mat-icon></span>
            <mat-icon class="text-slate-300 dark:text-slate-600 group-hover:text-teal-500">chevron_right</mat-icon>
          </div>
          <p class="mt-2 font-bold text-slate-800 dark:text-slate-100">{{ prefs.txt("গ্রহণ তালিকা", "Warranty Receiving") }}</p>
          <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ receiptCount() }} {{ prefs.txt("টি গ্রহণ", "receipts") }}</p>
        </a>
        <a routerLink="/warranty/replace" class="group rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-sm transition">
          <div class="flex items-center justify-between gap-2">
            <span class="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 flex items-center justify-center"><mat-icon class="text-sm">swap_horiz</mat-icon></span>
            <mat-icon class="text-slate-300 dark:text-slate-600 group-hover:text-teal-500">chevron_right</mat-icon>
          </div>
          <p class="mt-2 font-bold text-slate-800 dark:text-slate-100">{{ prefs.txt("পরিবর্তন তালিকা", "Warranty Replacement") }}</p>
          <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ replacementCount() }} {{ prefs.txt("টি পরিবর্তন", "replacements") }}</p>
        </a>
        <a routerLink="/warranty/stock" class="group rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-sm transition">
          <div class="flex items-center justify-between gap-2">
            <span class="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex items-center justify-center"><mat-icon class="text-sm">inventory_2</mat-icon></span>
            <mat-icon class="text-slate-300 dark:text-slate-600 group-hover:text-teal-500">chevron_right</mat-icon>
          </div>
          <p class="mt-2 font-bold text-slate-800 dark:text-slate-100">{{ prefs.txt("গ্রহণ স্টক — বর্তমান ব্যালেন্স", "Intake Stock — Current Balances") }}</p>
          <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ stockProductCount() }} {{ prefs.txt("টি পণ্যে স্টক", "products in stock") }}</p>
        </a>
        <a routerLink="/warranty/stock/ledger" class="group rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-sm transition">
          <div class="flex items-center justify-between gap-2">
            <span class="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 flex items-center justify-center"><mat-icon class="text-sm">history</mat-icon></span>
            <mat-icon class="text-slate-300 dark:text-slate-600 group-hover:text-teal-500">chevron_right</mat-icon>
          </div>
          <p class="mt-2 font-bold text-slate-800 dark:text-slate-100">{{ prefs.txt("গ্রহণ স্টক — স্টক লেনদেনের ইতিহাস", "Intake Stock — Movement History") }}</p>
          <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ movementCount() }} {{ prefs.txt("টি লেনদেন", "movements") }}</p>
        </a>
      </div>

      <!-- Summary -->
      <div class="no-print grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div class="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 px-3 py-2.5">
          <p class="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{{ prefs.txt("সক্রিয় ওয়ারেন্টি", "Active Warranty") }}</p>
          <p class="text-lg font-bold font-mono text-emerald-800 dark:text-emerald-200">{{ summary().active }}</p>
        </div>
        <div class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20 px-3 py-2.5">
          <p class="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">{{ prefs.txt("৩০ দিনে শেষ হবে", "Expiring in 30 Days") }}</p>
          <p class="text-lg font-bold font-mono text-amber-800 dark:text-amber-200">{{ summary().expiring }}</p>
        </div>
        <div class="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-900/20 px-3 py-2.5">
          <p class="text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">{{ prefs.txt("চলমান ক্লেইম", "Open Claims") }}</p>
          <p class="text-lg font-bold font-mono text-sky-800 dark:text-sky-200">{{ summary().claims }}</p>
        </div>
        <div class="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-900/20 px-3 py-2.5">
          <p class="text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">{{ prefs.txt("মেয়াদোত্তীর্ণ", "Expired") }}</p>
          <p class="text-lg font-bold font-mono text-rose-800 dark:text-rose-200">{{ summary().expired }}</p>
        </div>
      </div>

      <!-- List toolbar -->
      <div class="no-print bg-white dark:bg-slate-900 p-2.5 rounded-xl shadow-xs border border-slate-200 dark:border-slate-700 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div class="flex items-center gap-1 overflow-x-auto font-semibold">
          @for (tab of tabs; track tab.key) {
            <button
              (click)="selectTab(tab.key)"
              class="whitespace-nowrap cursor-pointer"
              [class]="activeTab() === tab.key ? 'bg-teal-700 text-white px-3 py-1.5 rounded-lg' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 py-1.5 rounded-lg'"
            >
              {{ prefs.txt(tab.bn, tab.en) }} ({{ tabCount(tab.key) }})
            </button>
          }
        </div>
        <div class="relative w-full lg:w-80 shrink-0">
          <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
          <input
            type="text"
            [placeholder]="prefs.txt('কাস্টমার, ফোন, সিরিয়াল, ইনভয়েস, ক্লেইম নম্বর খুঁজুন...', 'Search customer, phone, serial, invoice, claim no...')"
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            class="w-full pl-9 pr-9 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded-lg text-xs focus:ring-2 focus:ring-teal-500"
          />
          <span class="absolute right-3 top-2.5 text-[10px] font-bold text-slate-400">{{ filteredRows().length }}</span>
        </div>
      </div>

      <!-- Desktop table: click any row for details -->
      <div class="list-print-shell hidden lg:block bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div id="list-printable-area" class="overflow-x-auto">
          <div class="hidden print:block px-4 pt-4 pb-2">
            <h2 class="text-base font-bold text-slate-900">{{ prefs.txt("প্রোডাক্ট ওয়ারেন্টি", "Product Warranty") }} — {{ tabLabel(activeTab()) }}</h2>
            <p class="text-[10px] text-slate-600">SM Enterprise · {{ prefs.txt("প্রিন্টেড", "printed") }} {{ printStamp() }}</p>
          </div>
          <table class="w-full min-w-[1120px] text-xs text-left border-collapse">
            <thead>
              <tr class="bg-teal-700 text-white font-bold uppercase text-[11px] tracking-wider">
                <th class="p-2.5 text-center w-10">{{ prefs.txt("ক্রম", "SL") }}</th>
                <th class="p-2.5">{{ prefs.txt("কাস্টমার / সরবরাহকারী", "CUSTOMER / SUPPLIER") }}</th>
                <th class="p-2.5">{{ prefs.txt("ফোন", "PHONE") }}</th>
                <th class="p-2.5">{{ prefs.txt("পণ্য", "PRODUCT") }}</th>
                <th class="p-2.5">{{ prefs.txt("সিরিয়াল", "SERIAL") }}</th>
                <th class="p-2.5">{{ prefs.txt("ইনভয়েস", "INVOICE") }}</th>
                <th class="p-2.5">{{ prefs.txt("শুরুর তারিখ", "STARTED") }}</th>
                <th class="p-2.5">{{ prefs.txt("মেয়াদ শেষ", "EXPIRES") }}</th>
                <th class="p-2.5 text-center">{{ prefs.txt("বাকি", "REMAINING") }}</th>
                <th class="p-2.5 text-center">{{ prefs.txt("অবস্থা", "STATUS") }}</th>
                <th class="p-2.5 w-8 no-print"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (row of pager.paged(); track row.key; let idx = $index) {
                <tr
                  (click)="viewRow.set(row)"
                  (keydown.enter)="viewRow.set(row)"
                  tabindex="0"
                  [attr.aria-label]="prefs.txt('বিস্তারিত দেখুন', 'View details') + ': ' + row.productName"
                  class="hover:bg-teal-50/70 focus:bg-teal-50 focus:outline-hidden cursor-pointer transition-colors"
                >
                  <td class="p-2.5 text-center font-bold text-slate-400">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-bold text-slate-800">
                    {{ row.customerName || '-' }}
                    <span class="ml-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">{{ typeLabel(row) }}</span>
                  </td>
                  <td class="p-2.5 font-mono text-slate-600">{{ row.phoneNumber || '-' }}</td>
                  <td class="p-2.5 font-semibold text-teal-800">
                    {{ row.productName }}
                    @if (row.quantity) { <span class="font-normal text-slate-500">× {{ row.quantity }} {{ row.unit }}</span> }
                  </td>
                  <td class="p-2.5 font-mono font-bold text-slate-700">{{ row.serialNumber || '-' }}</td>
                  <td class="p-2.5 font-mono text-teal-700">{{ row.invoiceNumber || '-' }}</td>
                  <td class="p-2.5 text-slate-500">{{ dateText(row.date) }}</td>
                  <td class="p-2.5 text-slate-500">{{ dateText(row.expiryDate) || '-' }}</td>
                  <td class="p-2.5 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold" [class]="remainingClass(row)">{{ remainingText(row) }}</span>
                  </td>
                  <td class="p-2.5 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold" [class]="stateClass(row)">{{ stateLabel(row) }}</span>
                  </td>
                  <td class="p-2.5 text-center text-slate-300 no-print"><mat-icon class="text-sm">chevron_right</mat-icon></td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="11" class="p-12 text-center text-slate-400 italic">
                    <mat-icon class="text-4xl text-slate-300 block mb-1">verified_user</mat-icon>
                    @if (activeTab() === 'Selling' && !searchQuery()) {
                      {{ prefs.txt("এখনো কোনো বিক্রয় ওয়ারেন্টি নেই। প্রোডাক্ট ফর্মে ওয়ারেন্টি মেয়াদ (দিন) দিলে বিক্রয়ের পর এখানে অটো যোগ হবে।", "No selling warranty yet. Set a warranty period (days) on a product and it appears here after the sale.") }}
                    } @else {
                      {{ prefs.txt("এই সেকশনে কোনো তথ্য নেই।", "No data in this warranty section.") }}
                    }
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

      <!-- Mobile cards: tap a card for details -->
      <div class="lg:hidden space-y-2">
        @for (row of pager.paged(); track row.key) {
          <div
            role="button"
            tabindex="0"
            (click)="viewRow.set(row)"
            (keydown.enter)="viewRow.set(row)"
            class="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-xs space-y-2 cursor-pointer hover:border-teal-400 focus:border-teal-400 transition-colors"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="font-bold text-slate-900 dark:text-slate-100">{{ row.customerName || '-' }}</p>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{{ row.phoneNumber || '-' }}</p>
              </div>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap" [class]="stateClass(row)">{{ stateLabel(row) }}</span>
            </div>
            <p class="font-semibold text-teal-800 dark:text-teal-300">{{ row.productName }}</p>
            <div class="grid grid-cols-2 gap-1 text-[11px] text-slate-600 dark:text-slate-300">
              <span>{{ prefs.txt("সিরিয়াল", "Serial") }}: <b class="font-mono">{{ row.serialNumber || '-' }}</b></span>
              <span>{{ prefs.txt("ইনভয়েস", "Invoice") }}: <b class="font-mono">{{ row.invoiceNumber || '-' }}</b></span>
              <span>{{ prefs.txt("শুরু", "Started") }}: {{ dateText(row.date) }}</span>
              <span>{{ prefs.txt("মেয়াদ শেষ", "Expires") }}: {{ dateText(row.expiryDate) || '-' }}</span>
            </div>
            <div class="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold" [class]="remainingClass(row)">{{ remainingText(row) }}</span>
              <span class="flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-300">{{ prefs.txt("বিস্তারিত", "Details") }} <mat-icon class="text-sm">chevron_right</mat-icon></span>
            </div>
          </div>
        } @empty {
          <div class="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400 italic">
            <mat-icon class="text-4xl text-slate-300 block mb-1">verified_user</mat-icon>
            {{ prefs.txt("এই সেকশনে কোনো তথ্য নেই।", "No data in this warranty section.") }}
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

    <!-- Row detail modal -->
    @if (viewRow(); as row) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4" (click)="viewRow.set(null)">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 border border-slate-200 text-slate-800" (click)="$event.stopPropagation()">
          <div class="flex items-center justify-between border-b pb-3 mb-3">
            <h3 class="font-bold text-base text-slate-900 flex items-center gap-2">
              <mat-icon class="text-teal-600">verified_user</mat-icon> {{ prefs.txt("ওয়ারেন্টি বিস্তারিত", "Warranty Details") }}
            </h3>
            <button (click)="viewRow.set(null)" class="text-slate-400 hover:text-slate-600 cursor-pointer"><mat-icon>close</mat-icon></button>
          </div>

          <div class="flex items-center justify-between mb-3">
            <span class="px-2 py-1 rounded text-[11px] font-bold" [class]="stateClass(row)">{{ stateLabel(row) }}</span>
            <span class="px-2 py-1 rounded text-[11px] font-bold" [class]="remainingClass(row)">{{ remainingText(row) }}</span>
          </div>

          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
            <div><dt class="text-slate-500">{{ prefs.txt("কাস্টমার / সরবরাহকারী", "Customer / Supplier") }}</dt><dd class="font-bold text-slate-800">{{ row.customerName || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt("ফোন", "Phone") }}</dt><dd class="font-mono font-bold text-slate-800">{{ row.phoneNumber || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt("পণ্য", "Product") }}</dt><dd class="font-bold text-teal-800">{{ row.productName }} @if (row.quantity) { × {{ row.quantity }} {{ row.unit }} }</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt("সিরিয়াল", "Serial") }}</dt><dd class="font-mono font-bold text-slate-800">{{ row.serialNumber || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt("ইনভয়েস", "Invoice") }}</dt><dd class="font-mono font-bold text-teal-700">{{ row.invoiceNumber || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt("ধরন", "Type") }}</dt><dd class="font-bold text-slate-800">{{ typeLabel(row) }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt("শুরুর তারিখ", "Started") }}</dt><dd class="font-bold text-slate-800">{{ dateText(row.date) || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt("ওয়ারেন্টি মেয়াদ", "Warranty Period") }}</dt><dd class="font-bold text-slate-800">{{ periodText(row) }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt("মেয়াদ শেষ", "Expires") }}</dt><dd class="font-bold text-slate-800">{{ dateText(row.expiryDate) || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt("বাকি দিন", "Days Left") }}</dt><dd class="font-bold text-slate-800">{{ row.remainingDays }} {{ prefs.txt("দিন", "days") }}</dd></div>
          </dl>

          @if (row.claim; as claim) {
            <div class="mt-4 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
              <p class="font-bold text-sky-800 mb-2 flex items-center gap-1"><mat-icon class="text-sm">build</mat-icon> {{ prefs.txt("ওয়ারেন্টি ক্লেইম", "Warranty Claim") }}</p>
              <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                <div><dt class="text-slate-500">{{ prefs.txt("ক্লেইম নম্বর", "Claim No") }}</dt><dd class="font-mono font-bold text-slate-800">{{ claim.claimNo || '-' }}</dd></div>
                <div><dt class="text-slate-500">{{ prefs.txt("অবস্থা", "Status") }}</dt><dd class="font-bold text-slate-800">{{ claimStatusText(claim.status) }}</dd></div>
                <div><dt class="text-slate-500">{{ prefs.txt("মূল ইনভয়েস", "Original Invoice") }}</dt><dd class="font-mono font-bold text-slate-800">{{ claim.originalInvoice || '-' }}</dd></div>
                <div><dt class="text-slate-500">{{ prefs.txt("পুরাতন সিরিয়াল", "Old Serial") }}</dt><dd class="font-mono font-bold text-slate-800">{{ claim.oldSerial || '-' }}</dd></div>
                <div><dt class="text-slate-500">{{ prefs.txt("গ্রহণের তারিখ", "Received On") }}</dt><dd class="font-bold text-slate-800">{{ dateText(claim.receiveDate) || '-' }}</dd></div>
                <div><dt class="text-slate-500">{{ prefs.txt("রিসিট নম্বর", "Receipt No") }}</dt><dd class="font-mono font-bold text-slate-800">{{ claim.receiptNo || '-' }}</dd></div>
                <div><dt class="text-slate-500">{{ prefs.txt("নতুন সিরিয়াল", "New Serial") }}</dt><dd class="font-mono font-bold text-slate-800">{{ claim.newSerial || '-' }}</dd></div>
                <div><dt class="text-slate-500">{{ prefs.txt("ডেলিভারি নম্বর", "Delivery No") }}</dt><dd class="font-mono font-bold text-slate-800">{{ claim.deliveryNo || '-' }}</dd></div>
                <div><dt class="text-slate-500">{{ prefs.txt("প্রতিস্থাপনের তারিখ", "Replaced On") }}</dt><dd class="font-bold text-slate-800">{{ dateText(claim.replacementDate) || '-' }}</dd></div>
                <div><dt class="text-slate-500">{{ prefs.txt("প্রতিস্থাপন পণ্য", "Replacement Item") }}</dt><dd class="font-bold text-slate-800">{{ claim.replacementProductName || '-' }} @if (claim.replacementQty) { × {{ claim.replacementQty }} }</dd></div>
              </dl>
            </div>
          }

          @if (row.notes) {
            <p class="mt-3 text-[11px] text-slate-600">{{ prefs.txt("নোট", "Note") }}: {{ row.notes }}</p>
          }

          <div class="flex justify-end gap-2 mt-4 pt-3 border-t">
            @if (canClaim(row)) {
              <button (click)="openQuickClaim(row)" class="px-3 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-sm">assignment_return</mat-icon> {{ prefs.txt("ফেরত / ক্লেইম", "Return / Claim") }}
              </button>
            }
            @if (row.saleId) {
              <button (click)="openVoucher(row); viewRow.set(null)" class="px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-sm">receipt_long</mat-icon> {{ prefs.txt("ভাউচার খুলুন", "Open Voucher") }}
              </button>
            }
            @if (row.receiptId) {
              <a routerLink="/warranty/receive" (click)="viewRow.set(null)" class="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold flex items-center gap-1">
                <mat-icon class="text-sm">assignment_return</mat-icon> {{ prefs.txt("গ্রহণ তালিকা", "Intake List") }}
              </a>
            }
            @if (row.source === 'manual') {
              <button (click)="openManualEntry(row)" class="px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-sm">edit</mat-icon> {{ prefs.txt("এডিট", "Edit") }}
              </button>
              <button (click)="deleteManual(row)" class="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-sm">delete</mat-icon> {{ prefs.txt("ডিলিট", "Delete") }}
              </button>
            }
            @if (receiptIdOf(row); as receiptId) {
              <button (click)="editReceipt(receiptId)" class="px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-sm">edit</mat-icon> {{ prefs.txt("ক্লেইম এডিট", "Edit Claim") }}
              </button>
              <button (click)="deleteReceipt(row, receiptId)" class="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-sm">delete</mat-icon> {{ prefs.txt("ডিলিট", "Delete") }}
              </button>
            }
            <button (click)="viewRow.set(null)" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold cursor-pointer">{{ prefs.txt("বন্ধ", "Close") }}</button>
          </div>
        </div>
      </div>
    }

    <!-- Manual entry modal -->
    @if (showManualModal()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 border border-slate-200 text-slate-800">
          <div class="flex items-center justify-between border-b pb-3 mb-4">
            <h3 class="font-bold text-lg text-slate-900 flex items-center gap-2">
              <mat-icon class="text-teal-600">verified_user</mat-icon>
              {{ manualEditId() ? prefs.txt("ম্যানুয়াল এন্ট্রি এডিট", "Edit Manual Entry") : prefs.txt("ম্যানুয়াল ওয়ারেন্টি এন্ট্রি", "Manual Warranty Entry") }}
            </h3>
            <button (click)="closeManualEntry()" class="text-slate-400 hover:text-slate-600 cursor-pointer"><mat-icon>close</mat-icon></button>
          </div>

          <p class="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            {{ prefs.txt("অ্যাপ চালুর আগে বিক্রি হওয়া পণ্যের ওয়ারেন্টি এখানে হাতে লিখে রাখুন। নতুন বিক্রয়/ক্রয়ের জন্য কিছু লিখতে হবে না—ওগুলো নিজে থেকেই আসবে।", "Use this only for items sold before the app started. New sales and purchases appear here by themselves.") }}
          </p>

          <div class="space-y-3 text-xs">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("ধরন", "Type") }}</label>
                <select [ngModel]="manualForm.type" (ngModelChange)="onManualTypeChange($event)" class="w-full border border-slate-300 rounded-lg p-2 bg-white">
                  <option value="Selling">{{ prefs.txt("বিক্রয় (গ্রাহক)", "Selling (Customer)") }}</option>
                  <option value="Purchase">{{ prefs.txt("ক্রয় (সরবরাহকারী)", "Purchase (Supplier)") }}</option>
                </select>
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("ফোন নম্বর", "Phone Number") }}</label>
                <input type="text" [(ngModel)]="manualForm.phoneNumber" placeholder="01712345678" class="w-full border border-slate-300 rounded-lg p-2 font-mono">
                <p class="mt-1 text-[10px] text-slate-400">{{ prefs.txt('কাস্টমার বাছলে ফোন নম্বর নিজেই বসে যাবে', 'Fills in automatically when a party is picked') }}</p>
              </div>
            </div>

            <div>
              <label class="mb-1 flex items-center gap-1.5 font-semibold text-slate-700">
                <span>{{ prefs.txt("কাস্টমার / সরবরাহকারী", "Customer / Supplier") }} <span class="text-rose-500">*</span></span>
                <span class="rounded bg-teal-100 px-1 text-[9px] font-black uppercase text-teal-700">{{ prefs.txt('ডাটাবেস', 'Database') }}</span>
              </label>
              <select [ngModel]="manualForm.customerName" (ngModelChange)="onManualCustomerChange($event)" class="w-full border border-slate-300 rounded-lg p-2 bg-white">
                <option value="">{{ prefs.txt('— নাম বাছুন বা সার্চ করুন —', '— Pick or search a party —') }}</option>
                @if (manualForm.customerName && !manualCustomerIsListed()) {
                  <option [value]="manualForm.customerName">{{ manualForm.customerName }} — {{ prefs.txt('পুরাতন এন্ট্রি', 'archived') }}</option>
                }
                @for (party of manualPartyOptions(); track party.id) {
                  <option [value]="party.name">{{ party.name }}{{ party.phone ? ' — ' + party.phone : '' }}</option>
                }
              </select>
              @if (!manualPartyOptions().length) {
                <p class="mt-1 text-[10px] font-semibold text-amber-600">{{ prefs.txt('পার্টি তালিকা খালি — আগে পার্টিস পেজে কাস্টমার/সরবরাহকারী যোগ করুন।', 'Party list is empty — add a customer/supplier on the Parties page first.') }}</p>
              }
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="mb-1 flex items-center gap-1.5 font-semibold text-slate-700">
                  <span>{{ prefs.txt("পণ্যের নাম", "Product Name") }} <span class="text-rose-500">*</span></span>
                  <span class="rounded bg-teal-100 px-1 text-[9px] font-black uppercase text-teal-700">{{ prefs.txt('ডাটাবেস', 'Database') }}</span>
                </label>
                <select [ngModel]="manualForm.productName" (ngModelChange)="onManualProductChange($event)" class="w-full border border-slate-300 rounded-lg p-2 bg-white">
                  <option value="">{{ prefs.txt('— পণ্য বাছুন বা সার্চ করুন —', '— Pick or search a product —') }}</option>
                  @if (manualForm.productName && !manualProductIsListed()) {
                    <option [value]="manualForm.productName">{{ manualForm.productName }} — {{ prefs.txt('পুরাতন এন্ট্রি', 'archived') }}</option>
                  }
                  @for (product of manualProductOptions(); track product.name) {
                    <option [value]="product.name">{{ product.name }}{{ product.code ? ' · ' + product.code : '' }}</option>
                  }
                </select>
                @if (manualProductDays() > 0) {
                  <p class="mt-1 text-[10px] font-semibold text-teal-600">{{ prefs.txt('এই পণ্যের ওয়ারেন্টি', 'This product carries') }} {{ manualProductDays() }} {{ prefs.txt('দিন — মেয়াদ ঘরে বসে গেছে', 'days — period filled in') }}</p>
                }
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("সিরিয়াল নম্বর", "Serial Number") }}</label>
                <input type="text" [(ngModel)]="manualForm.serialNumber" [placeholder]="prefs.txt('যেমন: SF-BATT-9921', 'e.g. SF-BATT-9921')" class="w-full border border-slate-300 rounded-lg p-2 font-mono">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("ইনভয়েস নম্বর", "Invoice Number") }}</label>
                <input type="text" [(ngModel)]="manualForm.invoiceNumber" placeholder="SALE-211" class="w-full border border-slate-300 rounded-lg p-2 font-mono">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("শুরুর তারিখ", "Start Date") }} <span class="text-rose-500">*</span></label>
                <input type="date" appDmyDate [(ngModel)]="manualForm.saleDate" class="w-full border border-slate-300 rounded-lg p-2">
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("ওয়ারেন্টি মেয়াদ (দিন)", "Warranty Period (Days)") }} <span class="text-rose-500">*</span></label>
              <input type="number" min="1" [(ngModel)]="manualForm.warrantyDays" placeholder="180" class="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold">
              <div class="flex flex-wrap gap-1 mt-1.5">
                @for (preset of dayPresets; track preset) {
                  <button type="button" (click)="manualForm.warrantyDays = preset" class="rounded border px-2 py-0.5 text-[10px] font-bold cursor-pointer" [class]="manualDays() === preset ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'">{{ preset }}</button>
                }
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt("নোট", "Note") }}</label>
              <textarea [(ngModel)]="manualForm.notes" rows="2" class="w-full border border-slate-300 rounded-lg p-2" [placeholder]="prefs.txt('প্রয়োজন হলে কিছু লিখুন', 'Optional note')"></textarea>
            </div>

            @if (manualError()) {
              <p class="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] font-bold text-rose-700">{{ manualError() }}</p>
            }
          </div>

          <div class="flex justify-end gap-2 mt-5 pt-3 border-t">
            <button (click)="closeManualEntry()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold cursor-pointer">{{ prefs.txt("বাতিল", "Cancel") }}</button>
            <button (click)="saveManualEntry()" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold cursor-pointer">{{ prefs.txt("সংরক্ষণ", "Save") }}</button>
          </div>
        </div>
      </div>
    }

    @if (quickClaimOpen()) {
      <app-warranty-quick-claim [row]="quickClaimRow()" (close)="quickClaimOpen.set(false)" (saved)="onQuickClaimSaved()" />
    }
  `
})
export class Warranty {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  private router = inject(Router);
  readonly prefs = inject(PreferencesService);

  readonly tabs: { key: WarrantyTab; bn: string; en: string }[] = [
    { key: 'Selling', bn: 'বিক্রয়', en: 'Selling' },
    { key: 'Purchase', bn: 'ক্রয়', en: 'Purchase' },
    { key: 'Warranty Claims', bn: 'ওয়ারেন্টি ক্লেইম', en: 'Warranty Claims' },
    { key: 'Completed', bn: 'সম্পন্ন', en: 'Completed' },
    { key: 'Expired', bn: 'মেয়াদোত্তীর্ণ', en: 'Expired' }
  ];

  readonly dayPresets = [30, 90, 180, 365];

  activeTab = signal<WarrantyTab>('Selling');
  searchQuery = signal<string>('');
  showManualModal = signal<boolean>(false);
  viewRow = signal<WarrantyRegisterRow | null>(null);
  quickClaimOpen = signal<boolean>(false);
  quickClaimRow = signal<WarrantyRegisterRow | null>(null);
  manualEditId = signal<number | null>(null);
  manualError = signal<string>('');
  manualForm: ManualForm = this.emptyManualForm();

  readonly rows = computed(() => this.dataService.warrantyRegister());
  readonly tabRows = computed(() => warrantyRowsForTab(this.rows(), this.activeTab()));
  readonly filteredRows = computed(() =>
    this.tabRows().filter(row => warrantyRowMatches(row, this.searchQuery())));
  readonly pager = createPager(() => this.filteredRows());

  readonly summary = computed(() => {
    const rows = this.rows();
    return {
      active: rows.filter(r => r.state === 'Active').length,
      expiring: rows.filter(r => r.state === 'Active' && r.remainingDays > 0 && r.remainingDays <= 30).length,
      claims: rows.filter(r => r.state === 'Claimed').length,
      expired: rows.filter(r => r.state === 'Expired').length
    };
  });

  readonly receiptCount = computed(() => this.dataService.warrantyReceipts().length);
  readonly replacementCount = computed(() => this.dataService.warrantyReplacements().length);
  readonly stockProductCount = computed(() =>
    this.dataService.warrantyStockRows().filter(row => row.received !== 0 || row.replacement !== 0).length);
  readonly movementCount = computed(() => this.dataService.warrantyStockMovements().length);

  tabCount(tab: WarrantyTab): number {
    return warrantyRowsForTab(this.rows(), tab).length;
  }

  selectTab(tab: WarrantyTab) {
    this.activeTab.set(tab);
    this.pager.setPage(1);
  }

  onSearchInput(e: Event) {
    this.searchQuery.set((e.target as HTMLInputElement).value);
    this.pager.setPage(1);
  }

  tabLabel(tab: WarrantyTab): string {
    const found = this.tabs.find(t => t.key === tab);
    return found ? this.prefs.txt(found.bn, found.en) : tab;
  }

  typeLabel(row: WarrantyRegisterRow): string {
    return row.type === 'Purchase' ? this.prefs.txt('ক্রয়', 'Purchase') : this.prefs.txt('বিক্রয়', 'Selling');
  }

  stateLabel(row: WarrantyRegisterRow): string {
    switch (row.state) {
      case 'Active': return this.prefs.txt('সক্রিয়', 'Active');
      case 'Claimed': return this.prefs.txt('ক্লেইম চলছে', 'Under Claim');
      case 'Replaced': return this.prefs.txt('প্রতিস্থাপিত', 'Replaced');
      case 'Cancelled': return this.prefs.txt('ক্লেইম বাতিল', 'Claim Cancelled');
      default: return this.prefs.txt('মেয়াদোত্তীর্ণ', 'Expired');
    }
  }

  stateClass(row: WarrantyRegisterRow): string {
    const base = 'inline-block ';
    switch (row.state) {
      case 'Active': return base + 'bg-emerald-100 text-emerald-800';
      case 'Claimed': return base + 'bg-amber-100 text-amber-800';
      case 'Replaced': return base + 'bg-sky-100 text-sky-800';
      case 'Cancelled': return base + 'bg-slate-200 text-slate-700';
      default: return base + 'bg-rose-100 text-rose-700';
    }
  }

  remainingText(row: WarrantyRegisterRow): string {
    if (row.state === 'Replaced') return this.prefs.txt('প্রতিস্থাপন হয়েছে', 'Replaced');
    if (row.state === 'Claimed') return this.prefs.txt('ক্লেইম চলছে', 'In Claim');
    if (row.state === 'Cancelled') return '—';
    if (row.remainingDays > 0) return `${row.remainingDays} ${this.prefs.txt('দিন বাকি', 'days left')}`;
    return this.prefs.txt('মেয়াদ শেষ', 'Expired');
  }

  remainingClass(row: WarrantyRegisterRow): string {
    if (row.state === 'Replaced' || row.state === 'Cancelled') return 'bg-slate-100 text-slate-600';
    if (row.state === 'Claimed') return 'bg-amber-100 text-amber-800';
    if (row.remainingDays > 30) return 'bg-emerald-100 text-emerald-800';
    if (row.remainingDays > 0) return 'bg-amber-100 text-amber-800';
    return 'bg-rose-100 text-rose-700';
  }

  claimStatusText(status: string): string {
    if (isWarrantyCompleted(status)) return this.prefs.txt('প্রতিস্থাপন সম্পন্ন', 'Replacement Completed');
    if (isWarrantyCancelled(status)) return this.prefs.txt('বাতিল', 'Cancelled');
    if (!status || (status || '').includes('গ্রহণ')) return this.prefs.txt('প্রক্রিয়াধীন', 'In Progress');
    return status;
  }

  dateText(iso: string): string {
    return dmyFromIso(iso);
  }

  openVoucher(row: WarrantyRegisterRow) {
    if (!row.saleId) return;
    this.router.navigate(['/sales/add'], { queryParams: { edit: row.saleId } });
  }

  openQuickClaim(row?: WarrantyRegisterRow) {
    this.quickClaimRow.set(row ?? null);
    this.viewRow.set(null);
    this.quickClaimOpen.set(true);
  }

  /** The claim document behind a register row, so admin can edit/delete it here. */
  receiptIdOf(row: WarrantyRegisterRow): number | null {
    if (row.source === 'manual') return null;
    if (row.receiptId != null) return row.receiptId;
    const claimNo = (row.claim?.claimNo || '').trim();
    if (!claimNo) return null;
    return this.dataService.warrantyReceipts().find(receipt => receipt.claimNo === claimNo)?.id ?? null;
  }

  editReceipt(receiptId: number) {
    this.viewRow.set(null);
    this.router.navigate(['/warranty/receive', receiptId, 'edit']);
  }

  async deleteReceipt(row: WarrantyRegisterRow, receiptId: number) {
    const ok = await this.notify.confirm(
      this.prefs.txt(
        `${row.claim?.claimNo || 'ক্লেইম'} ডিলিট করবেন? গ্রহণ স্টক ও ভাউচারের ওয়ারেন্টি তথ্যও সরিয়ে নেওয়া হবে।`,
        `Delete claim ${row.claim?.claimNo || ''}? Its intake stock and the voucher’s warranty details will be removed too.`
      ),
      { title: this.prefs.txt('ক্লেইম ডিলিট নিশ্চিত করুন', 'Confirm Claim Delete') }
    );
    if (!ok) return;
    const result = this.dataService.deleteWarrantyReceipt(receiptId);
    if (!result.ok) {
      this.notify.error(result.error === 'replaced'
        ? this.prefs.txt('এই ক্লেইম থেকে পরিবর্তন তৈরি হয়েছে — আগে পরিবর্তনটি ডিলিট করুন।', 'A replacement was raised from this claim — delete that first.')
        : result.error === 'received-shortage'
          ? this.prefs.txt('গ্রহণ স্টক যথেষ্ট নয়, তাই এই ক্লেইম ডিলিট করা যাবে না।', 'Insufficient intake stock to delete this claim.')
          : this.prefs.txt('ক্লেইম পাওয়া যায়নি।', 'Claim not found.'));
      return;
    }
    this.viewRow.set(null);
    this.notify.success(this.prefs.txt('ক্লেইম ডিলিট হয়েছে।', 'Claim deleted.'));
  }

  onQuickClaimSaved() {
    this.quickClaimOpen.set(false);
    this.quickClaimRow.set(null);
  }

  canClaim(row: WarrantyRegisterRow): boolean {
    return row.type === 'Selling' && !row.claim;
  }

  periodText(row: WarrantyRegisterRow): string {
    if (row.warrantyMonths) return `${row.warrantyMonths} ${this.prefs.txt('মাস', 'months')}`;
    return row.warrantyDays ? `${row.warrantyDays} ${this.prefs.txt('দিন', 'days')}` : '-';
  }

  // ---------------- Manual entries ----------------

  readonly manualFormType = signal<'Selling' | 'Purchase'>('Selling');

  /** Parties that fit the chosen book, so a supplier never lands on a sales claim. */
  readonly manualPartyOptions = computed(() => {
    const roles = this.manualFormType() === 'Purchase' ? PURCHASE_PARTY_TYPES : SALES_PARTY_TYPES;
    return this.dataService.parties()
      .filter(party => {
        const list = party.roles?.length ? party.roles : [party.type];
        return list.some(role => roles.includes(role));
      })
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });

  /** Unique product names; the period saved on the product pre-fills the form. */
  readonly manualProductOptions = computed(() => {
    const seen = new Set<string>();
    const list: { name: string; code: string; warrantyDays: number }[] = [];
    for (const product of this.dataService.products()) {
      if (product.type === 'service') continue;
      const name = (product.name || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      list.push({ name, code: product.code || '', warrantyDays: Math.round(Number(product.warrantyDays) || 0) });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  });

  private emptyManualForm(): ManualForm {
    return {
      customerName: '',
      phoneNumber: '',
      productName: '',
      serialNumber: '',
      invoiceNumber: '',
      saleDate: localDateIso(),
      warrantyDays: '',
      type: 'Selling',
      notes: ''
    };
  }

  manualDays(): number {
    const n = Number(this.manualForm.warrantyDays);
    return Number.isFinite(n) ? n : 0;
  }

  manualCustomerIsListed(): boolean {
    return this.manualPartyOptions().some(party => party.name === this.manualForm.customerName);
  }

  manualProductIsListed(): boolean {
    return this.manualProductOptions().some(product => product.name === this.manualForm.productName);
  }

  manualProductDays(): number {
    return this.manualProductOptions().find(product => product.name === this.manualForm.productName)?.warrantyDays ?? 0;
  }

  onManualTypeChange(type: 'Selling' | 'Purchase') {
    this.manualForm.type = type;
    this.manualFormType.set(type);
    // A supplier is not a sales customer: switching books drops a stale pick.
    if (this.manualForm.customerName && !this.manualCustomerIsListed()) {
      this.manualForm.customerName = '';
      this.manualForm.phoneNumber = '';
    }
  }

  onManualCustomerChange(name: string) {
    this.manualForm.customerName = name || '';
    const party = this.dataService.parties().find(item => item.name === name);
    if (party?.phone) this.manualForm.phoneNumber = party.phone;
  }

  onManualProductChange(name: string) {
    this.manualForm.productName = name || '';
    const days = this.manualProductDays();
    if (days > 0) this.manualForm.warrantyDays = days;
  }

  openManualEntry(row?: WarrantyRegisterRow) {
    this.manualError.set('');
    if (row && row.source === 'manual' && row.manualId != null) {
      const stored = this.dataService.warranties().find(w => w.id === row.manualId);
      this.manualEditId.set(row.manualId);
      this.manualForm = {
        customerName: row.customerName,
        phoneNumber: row.phoneNumber,
        productName: row.productName,
        serialNumber: row.serialNumber,
        invoiceNumber: row.invoiceNumber,
        saleDate: row.date || localDateIso(),
        warrantyDays: row.warrantyDays || '',
        type: row.type,
        notes: stored?.notes || row.notes || ''
      };
      this.manualFormType.set(row.type);
    } else {
      this.manualEditId.set(null);
      this.manualForm = this.emptyManualForm();
      this.manualFormType.set('Selling');
    }
    this.viewRow.set(null);
    this.showManualModal.set(true);
  }

  closeManualEntry() {
    this.showManualModal.set(false);
    this.manualEditId.set(null);
    this.manualError.set('');
  }

  saveManualEntry() {
    const form = this.manualForm;
    const name = (form.customerName || '').trim();
    const product = (form.productName || '').trim();
    const date = isoDay(form.saleDate);
    const days = Math.round(this.manualDays());
    if (!name || !product || !date || days <= 0) {
      this.manualError.set(this.prefs.txt('কাস্টমার, পণ্য, শুরুর তারিখ ও ওয়ারেন্টি মেয়াদ (দিন) আবশ্যক।', 'Customer, product, start date and warranty period (days) are required.'));
      return;
    }
    const payload: Omit<ProductWarranty, 'id'> = {
      customerName: name,
      phoneNumber: (form.phoneNumber || '').trim(),
      productName: product,
      serialNumber: (form.serialNumber || '').trim(),
      invoiceNumber: (form.invoiceNumber || '').trim(),
      saleDate: date,
      warrantyDays: days,
      remainingDays: warrantyRemainingDays(date, days),
      type: form.type,
      notes: (form.notes || '').trim()
    };
    const editId = this.manualEditId();
    if (editId != null) {
      this.dataService.updateWarranty(editId, payload);
      this.notify.success(this.prefs.txt('ম্যানুয়াল ওয়ারেন্টি হালনাগাদ হয়েছে।', 'Manual warranty updated.'));
    } else {
      this.dataService.addWarranty(payload);
      this.notify.success(this.prefs.txt('ম্যানুয়াল ওয়ারেন্টি যোগ হয়েছে।', 'Manual warranty added.'));
    }
    this.closeManualEntry();
  }

  async deleteManual(row: WarrantyRegisterRow) {
    if (row.manualId == null) return;
    const ok = await this.notify.confirm(
      this.prefs.txt('এই ম্যানুয়াল ওয়ারেন্টি এন্ট্রিটি ডিলিট করবেন?', 'Delete this manual warranty entry?'),
      { title: this.prefs.txt('ডিলিট নিশ্চিত করুন', 'Confirm Delete') }
    );
    if (!ok) return;
    this.dataService.deleteWarranty(row.manualId);
    this.viewRow.set(null);
    this.notify.success(this.prefs.txt('এন্ট্রি ডিলিট হয়েছে।', 'Entry deleted.'));
  }

  exportExcel() {
    const rows = this.filteredRows().map((row, idx) => ({
      SL: idx + 1,
      Customer: row.customerName,
      Phone: row.phoneNumber,
      Product: row.productName,
      Serial: row.serialNumber,
      Invoice: row.invoiceNumber,
      Type: row.type,
      Started: row.date,
      Expires: row.expiryDate,
      'Remaining Days': row.remainingDays,
      State: row.state,
      Claim: row.claim?.claimNo || '',
      'Claim Status': row.claim?.status || ''
    }));
    this.dataService.exportToExcel(rows, 'Warranty_List');
  }

  printPage() {
    document.body.classList.add('print-list');
    const cleanup = () => {
      document.body.classList.remove('print-list');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  printStamp(): string {
    return new Date().toLocaleString('en-GB');
  }
}
