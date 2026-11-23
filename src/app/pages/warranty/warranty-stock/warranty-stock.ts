import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DataService, WarrantyPool, WarrantyStockMovement, WarrantyStockRow } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { SessionService } from '../../../services/session';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';
import { dmyFromIso, localDateIso } from '../../../utils/local-date';
import { isoDay } from '../../../utils/warranty';

type MovementReason = WarrantyStockMovement['reason'];
interface UnitBalance extends WarrantyStockRow {
  pools: WarrantyPool[];
  lastDates: Record<WarrantyPool, string>;
}
interface AdjustmentForm {
  pool: WarrantyPool;
  direction: 1 | -1;
  productId: number | null;
  quantity: number | null;
  date: string;
  serialNumber: string;
  note: string;
}

interface SupplierForm {
  mode: 'out' | 'in';
  pool: WarrantyPool;
  productId: number | null;
  productName: string;
  unit: string;
  quantity: number | null;
  date: string;
  serialNumber: string;
  supplierName: string;
  refNo: string;
  note: string;
}

interface MovementEditForm {
  pool: WarrantyPool;
  direction: 1 | -1;
  quantity: number | null;
  date: string;
  serialNumber: string;
  refNo: string;
  note: string;
}

@Component({
  selector: 'app-warranty-stock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, RouterLinkActive, TablePagination, DmyDateDirective],
  template: `
    <div class="space-y-4 text-xs text-slate-800 dark:text-slate-200">
      <header class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

        <div class="relative space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                <mat-icon class="text-xl">{{ isLedgerView ? 'history' : 'inventory_2' }}</mat-icon>
              </span>
              <div class="min-w-0">
                <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                  {{ prefs.txt('ওয়ারেন্টি', 'Warranty') }}
                  <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                  {{ prefs.txt('গ্রহণ স্টক', 'Intake Stock') }}
                  @if (isLedgerView) {
                    <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                    {{ prefs.txt('লেনদেন', 'Movements') }}
                  }
                </p>
                <h1 class="truncate text-xl font-bold leading-tight">
                  {{ isLedgerView
                    ? prefs.txt('গ্রহণ স্টক — স্টক লেনদেনের ইতিহাস', 'Intake Stock — Movement History')
                    : prefs.txt('গ্রহণ স্টক — বর্তমান ব্যালেন্স', 'Intake Stock — Current Balances') }}
                </h1>
                <p class="truncate text-[11px] text-teal-50/85">
                  {{ isLedgerView
                    ? prefs.txt('প্রতিটি স্টক ইন/আউট, সাপ্লায়ার লেনদেন ও সমন্বয়ের পূর্ণ ইতিহাস।', 'Full history of every stock in/out, supplier movement and adjustment.')
                    : prefs.txt('গ্রহণ ও পরিবর্তন স্টকে বর্তমানে কোন পণ্য কত আছে দেখুন। এগুলো মূল বিক্রয় স্টক নয়।', 'See what each pool currently holds. These are separate from main sales stock.') }}
                </p>
              </div>
            </div>
            @if (!isLedgerView && isAdmin()) {
              <div class="flex gap-2 shrink-0">
                <button type="button" (click)="openAdjustment(1, $event)" class="inline-flex items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 transition hover:bg-teal-50 cursor-pointer">
                  <mat-icon class="text-xs">add</mat-icon>{{ prefs.txt('স্টক ইন', 'Stock In') }}
                </button>
                <button type="button" (click)="openAdjustment(-1, $event)" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer">
                  <mat-icon class="text-xs">remove</mat-icon>{{ prefs.txt('স্টক আউট', 'Stock Out') }}
                </button>
              </div>
            }
          </div>
          @if (!isAdmin()) {
            <p class="flex items-center gap-1.5 rounded-lg border border-amber-200/40 bg-amber-400/15 px-2.5 py-1.5 text-[11px] font-semibold text-amber-50">
              <mat-icon class="text-[14px]">lock</mat-icon>
              {{ prefs.txt('এই স্টকের ডাটা শুধু অ্যাডমিন এডিট বা ডিলিট করতে পারবেন।', 'Only an admin can edit or delete this stock data.') }}
            </p>
          }
          <nav class="flex flex-wrap items-center gap-1.5 border-t border-white/15 pt-3 font-bold">
            <a routerLink="/warranty/stock" [routerLinkActive]="'border-white bg-white text-teal-800! hover:bg-white!'" [routerLinkActiveOptions]="{ exact: true }"
              class="rounded-lg border border-white/20 px-3 py-1.5 text-[11px] text-white/85 transition hover:bg-white/10">
              {{ prefs.txt('বর্তমান ব্যালেন্স', 'Current Balances') }}
            </a>
            <a routerLink="/warranty/stock/ledger" [routerLinkActive]="'border-white bg-white text-teal-800! hover:bg-white!'"
              class="rounded-lg border border-white/20 px-3 py-1.5 text-[11px] text-white/85 transition hover:bg-white/10">
              {{ prefs.txt('স্টক লেনদেনের ইতিহাস', 'Movement History') }}
            </a>
          </nav>
        </div>
      </header>

      @if (!isLedgerView) {
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3" [attr.aria-label]="prefs.txt('ওয়ারেন্টি স্টক নির্বাচন', 'Select warranty pool')">
          @for (pool of pools; track pool) {
            <button type="button" (click)="selectPool(pool)" [attr.aria-pressed]="selectedPool() === pool"
              class="pool-card panel p-4 text-left cursor-pointer" [class.pool-active]="selectedPool() === pool">
              <div class="flex items-center justify-between gap-2">
                <h2 class="font-bold text-sm flex items-center gap-2">
                  <mat-icon class="text-teal-600">{{ pool === 'received' ? 'assignment_return' : 'swap_horiz' }}</mat-icon>
                  {{ poolLabel(pool) }}
                </h2>
                @if (selectedPool() === pool) { <mat-icon class="text-teal-600">check_circle</mat-icon> }
              </div>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {{ pool === 'received'
                  ? prefs.txt('গ্রাহকের কাছ থেকে গ্রহণ করা ত্রুটিপূর্ণ পণ্য', 'Faulty units received from customers')
                  : prefs.txt('গ্রাহককে দেওয়ার জন্য প্রস্তুত পরিবর্তনের পণ্য', 'Replacement units available for customers') }}
              </p>
              <p class="mt-2"><strong class="text-lg font-mono text-teal-700 dark:text-teal-300">{{ balanceCount(pool) }}</strong>
                <span class="ml-2 text-[11px]">{{ prefs.txt('অশূন্য পণ্য / একক ব্যালেন্স', 'non-zero product / unit balances') }}</span>
              </p>
            </button>
          }
        </div>
      } @else {
        <div class="flex flex-wrap items-center gap-2" [attr.aria-label]="prefs.txt('ওয়ারেন্টি স্টক নির্বাচন', 'Select warranty pool')">
          @for (pool of pools; track pool) {
            <button type="button" (click)="selectPool(pool)" [attr.aria-pressed]="selectedPool() === pool"
              class="pool-chip" [class.pool-active]="selectedPool() === pool">
              <mat-icon class="text-[14px]">{{ pool === 'received' ? 'assignment_return' : 'swap_horiz' }}</mat-icon>
              {{ poolLabel(pool) }}
              <span class="count">{{ balanceCount(pool) }}</span>
            </button>
          }
        </div>
      }

      @if (!isLedgerView) {
      <section class="panel overflow-hidden" aria-labelledby="ws-balances-title">
        <header class="p-3 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 id="ws-balances-title" class="font-bold text-sm">{{ poolLabel(selectedPool()) }} — {{ prefs.txt('বর্তমান ব্যালেন্স', 'Current Balances') }}</h2>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{{ prefs.txt('প্রতিটি একক আলাদা দেখানো হয়। কোনো পণ্যের লেনদেনের ইতিহাস দেখতে "স্টক লেনদেনের ইতিহাস" পেজে যান।', 'Units are kept separate. Open the movement history page to see how any balance was built.') }}</p>
          </div>
          <label class="block sm:w-64">
            <span class="app-label">{{ prefs.txt('পণ্য / একক খুঁজুন', 'Search product / unit') }}</span>
            <input type="search" [ngModel]="balanceQuery()" (ngModelChange)="onBalanceQuery($event)" class="app-input" />
          </label>
        </header>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[540px] text-left">
            <thead class="bg-teal-700 text-white text-[10px] uppercase tracking-wide">
              <tr>
                <th class="p-2.5 w-12">{{ prefs.txt('ক্রম', 'SL') }}</th>
                <th class="p-2.5">{{ prefs.txt('পণ্য', 'Product') }}</th>
                <th class="p-2.5 text-right">{{ prefs.txt('ব্যালেন্স', 'Balance') }}</th>
                <th class="p-2.5">{{ prefs.txt('একক', 'Unit') }}</th>
                <th class="p-2.5">{{ prefs.txt('শেষ লেনদেন', 'Last Movement') }}</th>
                @if (isAdmin()) {
                  <th class="p-2.5 text-right no-print">{{ prefs.txt('অ্যাকশন', 'Action') }}</th>
                }
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              @for (row of balancePager.paged(); track row.key; let idx = $index) {
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td class="p-2.5 text-slate-400 font-mono">{{ balancePager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-semibold">{{ row.productName }}</td>
                  <td class="p-2.5 text-right font-mono font-bold" [class.text-rose-600]="row[selectedPool()] < 0">{{ row[selectedPool()] | number:'1.0-6' }}</td>
                  <td class="p-2.5">{{ row.unit || prefs.txt('অনির্দিষ্ট', 'Unspecified') }}</td>
                  <td class="p-2.5 text-slate-500 dark:text-slate-400">{{ dateText(row.lastDates[selectedPool()]) }}</td>
                  @if (isAdmin()) {
                    <td class="p-2.5 text-right no-print">
                      <button type="button" (click)="openSupplier(row)" class="inline-flex items-center gap-1 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-2 py-1 text-[10px] font-bold text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/50 cursor-pointer">
                        <mat-icon class="text-[14px]">local_shipping</mat-icon>
                        {{ selectedPool() === 'received' ? prefs.txt('সাপ্লায়ারকে পাঠান', 'Send to supplier') : prefs.txt('সাপ্লায়ার ফেরত', 'Supplier return') }}
                      </button>
                    </td>
                  }
                </tr>
              } @empty {
                <tr><td [attr.colspan]="isAdmin() ? 6 : 5" class="p-8 text-center text-slate-500 dark:text-slate-400">{{ prefs.txt('এই স্টকে কোনো মিলে যাওয়া ব্যালেন্স নেই।', 'No matching balances in this pool.') }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        <app-table-pagination [total]="balancePager.total()" [page]="balancePager.currentPage()" [pageSize]="balancePager.pageSize()"
          (pageChange)="balancePager.setPage($event)" (pageSizeChange)="balancePager.setPageSize($event)" />
      </section>
      }

      @if (isLedgerView) {
      <section class="panel overflow-hidden" aria-labelledby="ws-ledger-title">
        <header class="p-3 border-b border-slate-200 dark:border-slate-700">
          <h2 id="ws-ledger-title" class="font-bold text-sm">{{ poolLabel(selectedPool()) }} — {{ prefs.txt('স্টক লেনদেনের ইতিহাস', 'Movement Ledger') }}</h2>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{{ prefs.txt('ধনাত্মক পরিমাণ স্টক বাড়ায়, ঋণাত্মক পরিমাণ কমায়। ভুল সংশোধনে অ্যাডমিন লেনদেন এডিট বা ডিলিট করতে পারেন।', 'Positive quantities add stock; negative quantities remove stock. An admin can edit or delete a movement to correct a mistake.') }}</p>
          <div class="grid grid-cols-2 lg:grid-cols-6 gap-2 mt-3">
            <label class="block col-span-2 lg:col-span-2">
              <span class="app-label">{{ prefs.txt('সার্চ', 'Search') }}</span>
              <input type="search" [ngModel]="movementQuery()" (ngModelChange)="onMovementQuery($event)" class="app-input"
                [placeholder]="prefs.txt('পণ্য, সিরিয়াল, রেফারেন্স, কারণ, নোট...', 'Product, serial, reference, reason, note...')" />
            </label>
            <label class="block">
              <span class="app-label">{{ prefs.txt('কারণ', 'Reason') }}</span>
              <select [ngModel]="reasonFilter()" (ngModelChange)="onReason($event)" class="app-input">
                <option value="">{{ prefs.txt('সব কারণ', 'All reasons') }}</option>
                @for (reason of reasons; track reason) { <option [ngValue]="reason">{{ reasonLabel(reason) }}</option> }
              </select>
            </label>
            <label class="block">
              <span class="app-label">{{ prefs.txt('দিক', 'Direction') }}</span>
              <select [ngModel]="directionFilter()" (ngModelChange)="onDirection($event)" class="app-input">
                <option value="">{{ prefs.txt('ইন ও আউট', 'In and out') }}</option>
                <option value="in">{{ prefs.txt('স্টক ইন (+)', 'Stock in (+)') }}</option>
                <option value="out">{{ prefs.txt('স্টক আউট (−)', 'Stock out (−)') }}</option>
              </select>
            </label>
            <label class="block">
              <span class="app-label">{{ prefs.txt('শুরুর তারিখ', 'From') }}</span>
              <input type="date" appDmyDate [ngModel]="fromDate()" (ngModelChange)="onFrom($event)" class="app-input" />
            </label>
            <label class="block">
              <span class="app-label">{{ prefs.txt('শেষ তারিখ', 'To') }}</span>
              <input type="date" appDmyDate [ngModel]="toDate()" (ngModelChange)="onTo($event)" class="app-input" />
            </label>
          </div>
          <div class="flex items-center justify-between mt-2 gap-2">
            <span class="text-[11px] text-slate-500 dark:text-slate-400">{{ movementPager.total() }} {{ prefs.txt('লেনদেন', 'movements') }}</span>
            <button type="button" (click)="clearFilters()" class="text-teal-700 dark:text-teal-300 font-bold cursor-pointer">{{ prefs.txt('ফিল্টার মুছুন', 'Clear filters') }}</button>
          </div>
          @if (dateFilterError()) { <p role="alert" class="mt-2 text-rose-600 dark:text-rose-400">{{ dateFilterError() }}</p> }
        </header>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[950px] text-left">
            <thead class="bg-teal-700 text-white text-[10px] uppercase tracking-wide">
              <tr>
                <th class="p-2.5">{{ prefs.txt('তারিখ', 'Date') }}</th>
                <th class="p-2.5">{{ prefs.txt('পণ্য', 'Product') }}</th>
                <th class="p-2.5">{{ prefs.txt('সিরিয়াল / IMEI', 'Serial / IMEI') }}</th>
                <th class="p-2.5 text-right">{{ prefs.txt('পরিমাণ', 'Signed Qty') }}</th>
                <th class="p-2.5">{{ prefs.txt('একক', 'Unit') }}</th>
                <th class="p-2.5">{{ prefs.txt('কারণ', 'Reason') }}</th>
                <th class="p-2.5">{{ prefs.txt('রেফারেন্স', 'Reference') }}</th>
                <th class="p-2.5">{{ prefs.txt('নোট', 'Note') }}</th>
                @if (isAdmin()) {
                  <th class="p-2.5 text-right no-print">{{ prefs.txt('অ্যাকশন', 'Action') }}</th>
                }
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              @for (row of movementPager.paged(); track row.id) {
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td class="p-2.5 whitespace-nowrap text-slate-500 dark:text-slate-400">{{ dateText(row.date) }}</td>
                  <td class="p-2.5 font-semibold">{{ row.productName }}</td>
                  <td class="p-2.5 font-mono break-all">{{ row.serialNumber || '—' }}</td>
                  <td class="p-2.5 text-right whitespace-nowrap font-mono font-bold" [class.text-teal-600]="row.quantity > 0" [class.text-rose-600]="row.quantity < 0">{{ row.quantity > 0 ? '+' : '' }}{{ row.quantity | number:'1.0-6' }}</td>
                  <td class="p-2.5">{{ row.unit || prefs.txt('অনির্দিষ্ট', 'Unspecified') }}</td>
                  <td class="p-2.5">{{ reasonLabel(row.reason) }}</td>
                  <td class="p-2.5 font-mono text-teal-700 dark:text-teal-300">
                    {{ row.refNo || '—' }}
                    @if (row.claimId !== null && row.claimId !== undefined) { <span class="block text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('ক্লেইম আইডি', 'Claim ID') }}: {{ row.claimId }}</span> }
                  </td>
                  <td class="p-2.5 max-w-xs whitespace-pre-line break-words">{{ row.note || '—' }}</td>
                  @if (isAdmin()) {
                    <td class="p-2.5 text-right no-print whitespace-nowrap">
                      <button type="button" (click)="openMovementEdit(row)" class="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" [attr.aria-label]="prefs.txt('লেনদেন এডিট', 'Edit movement')">
                        <mat-icon class="text-[14px]">edit</mat-icon>
                      </button>
                      @if (row.claimId === null || row.claimId === undefined) {
                        <button type="button" (click)="deleteMovement(row)" class="ml-1 inline-flex items-center gap-0.5 rounded-lg border border-rose-200 dark:border-rose-800 px-2 py-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer" [attr.aria-label]="prefs.txt('লেনদেন ডিলিট', 'Delete movement')">
                          <mat-icon class="text-[14px]">delete</mat-icon>
                        </button>
                      } @else {
                        <span class="ml-1 inline-flex align-middle text-slate-400 dark:text-slate-500" [title]="prefs.txt('ক্লেইম/গ্রহণের লেনদেন — ডিলিট লক করা আছে', 'Claim/receipt movement — deletion is locked')">
                          <mat-icon class="text-[14px]">lock</mat-icon>
                        </span>
                      }
                    </td>
                  }
                </tr>
              } @empty {
                <tr><td [attr.colspan]="isAdmin() ? 9 : 8" class="p-8 text-center text-slate-500 dark:text-slate-400">{{ prefs.txt('কোনো মিলে যাওয়া লেনদেন নেই।', 'No matching movements.') }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        <app-table-pagination [total]="movementPager.total()" [page]="movementPager.currentPage()" [pageSize]="movementPager.pageSize()"
          (pageChange)="movementPager.setPage($event)" (pageSizeChange)="movementPager.setPageSize($event)" />
      </section>
      }
    </div>

    @if (adjustmentOpen()) {
      <div class="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" (click)="closeAdjustment()">
        <section #adjustmentDialog tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="ws-adjust-title"
          class="panel w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl text-xs text-slate-800 dark:text-slate-200"
          (click)="$event.stopPropagation()" (keydown.escape)="closeAdjustment(); $event.stopPropagation()">
          <header class="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
            <h2 id="ws-adjust-title" class="font-bold text-base">{{ prefs.txt('ম্যানুয়াল স্টক সমন্বয়', 'Manual Stock Adjustment') }}</h2>
            <button type="button" (click)="closeAdjustment()" [disabled]="saving()" [attr.aria-label]="prefs.txt('বন্ধ করুন', 'Close')" class="text-slate-500 cursor-pointer"><mat-icon>close</mat-icon></button>
          </header>
          <form (ngSubmit)="saveAdjustment()" novalidate>
            <fieldset [disabled]="saving()" class="p-4 grid grid-cols-2 gap-3">
              <label class="block">
                <span class="app-label">{{ prefs.txt('স্টক', 'Pool') }}</span>
                <select name="pool" [ngModel]="form().pool" (ngModelChange)="set('pool', $event)" [disabled]="saving()" class="app-input">
                  @for (pool of pools; track pool) { <option [ngValue]="pool">{{ poolLabel(pool) }}</option> }
                </select>
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('দিক', 'Direction') }}</span>
                <select name="direction" [ngModel]="form().direction" (ngModelChange)="set('direction', $event)" [disabled]="saving()" class="app-input">
                  <option [ngValue]="1">{{ prefs.txt('স্টক ইন (+)', 'Stock in (+)') }}</option>
                  <option [ngValue]="-1">{{ prefs.txt('স্টক আউট (−)', 'Stock out (−)') }}</option>
                </select>
              </label>
              <label class="block col-span-2">
                <span class="app-label">{{ prefs.txt('পণ্য', 'Product') }} *</span>
                <select name="productId" [ngModel]="form().productId" (ngModelChange)="pickProduct($event)" [disabled]="saving()" class="app-input" required>
                  <option [ngValue]="null">{{ prefs.txt('পণ্য নির্বাচন করুন', 'Select product') }}</option>
                  @for (product of products(); track product.id) { <option [ngValue]="product.id">{{ product.name }} · {{ product.code }} · {{ product.unit }}</option> }
                </select>
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('তারিখ', 'Date') }} *</span>
                <input name="date" type="date" appDmyDate [ngModel]="form().date" (ngModelChange)="set('date', $event)" class="app-input" required />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('পরিমাণ', 'Quantity') }} *</span>
                <input name="quantity" type="number" min="0.01" step="0.01" [ngModel]="form().quantity" (ngModelChange)="set('quantity', $event)" class="app-input font-mono" required />
                <span class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('সর্বোচ্চ দুই দশমিক', 'Up to two decimal places') }}</span>
              </label>
              <div class="col-span-2 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 p-2">
                {{ prefs.txt('নির্বাচিত পণ্যের একক', 'Product unit') }}: <b>{{ product()?.unit || '—' }}</b>
                <span class="ml-3">{{ prefs.txt('এই স্টকে ব্যালেন্স', 'Balance in this pool') }}: <b class="font-mono">{{ available() | number:'1.0-6' }}</b> {{ product()?.unit }}</span>
                <p class="text-[10px] mt-1">{{ prefs.txt('পণ্যের এককেই সমন্বয় হবে; মূল স্টক পরিবর্তন হবে না।', 'Adjustments use the product unit; main stock is not changed.') }}</p>
              </div>
              <label class="block col-span-2">
                <span class="app-label">{{ prefs.txt('সিরিয়াল / IMEI (ঐচ্ছিক)', 'Serial / IMEI (optional)') }}</span>
                <input name="serial" [ngModel]="form().serialNumber" (ngModelChange)="set('serialNumber', $event)" class="app-input font-mono" />
              </label>
              <label class="block col-span-2">
                <span class="app-label">{{ prefs.txt('নোট / সমন্বয়ের কারণ', 'Note / adjustment reason') }}</span>
                <textarea name="note" rows="3" [ngModel]="form().note" (ngModelChange)="set('note', $event)" class="app-input resize-y"></textarea>
              </label>
              <p class="col-span-2 text-[11px] text-slate-500 dark:text-slate-400">{{ settings().allowNegativeStock
                ? prefs.txt('সেটিংস অনুযায়ী ঋণাত্মক স্টক অনুমোদিত।', 'Negative stock is permitted by warranty settings.')
                : prefs.txt('স্টক আউটের পর ব্যালেন্স ঋণাত্মক হতে পারবে না।', 'Stock out cannot make the balance negative.') }}</p>
            </fieldset>
            @if (formError()) { <p role="alert" class="mx-4 mb-3 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">{{ formError() }}</p> }
            <footer class="p-4 pt-0 flex justify-end gap-2">
              <button type="button" (click)="closeAdjustment()" [disabled]="saving()" class="secondary-button">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
              <button type="submit" [disabled]="saving()" class="primary-button">{{ prefs.txt('সমন্বয় সংরক্ষণ', 'Save Adjustment') }}</button>
            </footer>
          </form>
        </section>
      </div>
    }

    @if (supplierOpen()) {
      <div class="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" (click)="closeSupplier()">
        <section role="dialog" aria-modal="true" aria-labelledby="ws-supplier-title"
          class="panel w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl text-xs text-slate-800 dark:text-slate-200"
          (click)="$event.stopPropagation()">
          <header class="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
            <div>
              <h2 id="ws-supplier-title" class="font-bold text-base flex items-center gap-1.5">
                <mat-icon class="text-teal-600">local_shipping</mat-icon>
                {{ supplierForm().mode === 'out' ? prefs.txt('সাপ্লায়ারকে পাঠান', 'Send to Supplier') : prefs.txt('সাপ্লায়ার থেকে ফেরত', 'Supplier Return') }}
              </h2>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {{ supplierForm().mode === 'out'
                  ? prefs.txt('ত্রুটিপূর্ণ ইউনিট গ্রহণ স্টক থেকে বের হবে; রেফারেন্স ও সরবরাহকারী লেজারে থাকবে।', 'The faulty unit leaves received stock; supplier and reference stay in the ledger.')
                  : prefs.txt('সরবরাহকারী যে রিপ্লেসমেন্ট/মেরামত করা ইউনিট দিল তা রিপ্লেসমেন্ট স্টকে যোগ হবে।', 'The replacement/repair unit from the supplier enters replacement stock.') }}
              </p>
            </div>
            <button type="button" (click)="closeSupplier()" [disabled]="supplierSaving()" [attr.aria-label]="prefs.txt('বন্ধ করুন', 'Close')" class="text-slate-500 cursor-pointer"><mat-icon>close</mat-icon></button>
          </header>
          <form (ngSubmit)="saveSupplier()" novalidate>
            <fieldset [disabled]="supplierSaving()" class="p-4 grid grid-cols-2 gap-3">
              <div class="col-span-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-2">
                <b>{{ supplierForm().productName }}</b> · {{ supplierForm().unit }}
                <span class="ml-2">{{ prefs.txt('বর্তমান ব্যালেন্স', 'Current balance') }}: <b class="font-mono">{{ supplierBalance() | number:'1.0-6' }}</b></span>
              </div>
              <label class="block">
                <span class="app-label">{{ prefs.txt('তারিখ', 'Date') }} *</span>
                <input name="supplierDate" type="date" appDmyDate [ngModel]="supplierForm().date" (ngModelChange)="setSupplier('date', $event)" class="app-input" required />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('পরিমাণ', 'Quantity') }} *</span>
                <input name="supplierQty" type="number" min="0.01" step="0.01" [ngModel]="supplierForm().quantity" (ngModelChange)="setSupplier('quantity', $event)" class="app-input font-mono" required />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('সিরিয়াল', 'Serial') }}</span>
                <input name="supplierSerial" [ngModel]="supplierForm().serialNumber" (ngModelChange)="setSupplier('serialNumber', $event)" class="app-input font-mono" />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('সরবরাহকারী', 'Supplier') }}</span>
                <input name="supplierName" [ngModel]="supplierForm().supplierName" (ngModelChange)="setSupplier('supplierName', $event)" class="app-input" [placeholder]="prefs.txt('নাম', 'Name')" />
              </label>
              <label class="block col-span-2">
                <span class="app-label">{{ prefs.txt('রেফারেন্স / চালান নম্বর', 'Reference / Challan No') }}</span>
                <input name="supplierRef" [ngModel]="supplierForm().refNo" (ngModelChange)="setSupplier('refNo', $event)" class="app-input font-mono" [placeholder]="prefs.txt('যেমন: SUP-778', 'e.g. SUP-778')" />
              </label>
              <label class="block col-span-2">
                <span class="app-label">{{ prefs.txt('নোট', 'Note') }}</span>
                <textarea name="supplierNote" rows="2" [ngModel]="supplierForm().note" (ngModelChange)="setSupplier('note', $event)" class="app-input resize-y"></textarea>
              </label>
            </fieldset>
            @if (supplierError()) { <p role="alert" class="mx-4 mb-3 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">{{ supplierError() }}</p> }
            <footer class="p-4 pt-0 flex justify-end gap-2">
              <button type="button" (click)="closeSupplier()" [disabled]="supplierSaving()" class="secondary-button">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
              <button type="submit" [disabled]="supplierSaving()" class="primary-button">{{ prefs.txt('সংরক্ষণ', 'Save') }}</button>
            </footer>
          </form>
        </section>
      </div>
    }

    @if (editingMovement(); as movement) {
      <div class="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" (click)="closeMovementEdit()">
        <section role="dialog" aria-modal="true" aria-labelledby="ws-edit-title"
          class="panel w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl text-xs text-slate-800 dark:text-slate-200"
          (click)="$event.stopPropagation()">
          <header class="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
            <div>
              <h2 id="ws-edit-title" class="font-bold text-base flex items-center gap-1.5">
                <mat-icon class="text-teal-600">edit</mat-icon>
                {{ prefs.txt('লেনদেন এডিট', 'Edit Movement') }}
              </h2>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{{ movement.productName }} · {{ movement.unit }} · {{ reasonLabel(movement.reason) }}</p>
            </div>
            <button type="button" (click)="closeMovementEdit()" [disabled]="editSaving()" [attr.aria-label]="prefs.txt('বন্ধ করুন', 'Close')" class="text-slate-500 cursor-pointer"><mat-icon>close</mat-icon></button>
          </header>
          <form (ngSubmit)="saveMovementEdit()" novalidate>
            <fieldset [disabled]="editSaving()" class="p-4 grid grid-cols-2 gap-3">
              <label class="block">
                <span class="app-label">{{ prefs.txt('স্টক', 'Pool') }}</span>
                <select name="editPool" [disabled]="movement.claimId !== null && movement.claimId !== undefined" [ngModel]="editForm().pool" (ngModelChange)="setEdit('pool', $event)" class="app-input">
                  @for (pool of pools; track pool) { <option [ngValue]="pool">{{ poolLabel(pool) }}</option> }
                </select>
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('দিক', 'Direction') }}</span>
                <select name="editDirection" [disabled]="movement.claimId !== null && movement.claimId !== undefined" [ngModel]="editForm().direction" (ngModelChange)="setEdit('direction', $event)" class="app-input">
                  <option [ngValue]="1">{{ prefs.txt('স্টক ইন (+)', 'Stock in (+)') }}</option>
                  <option [ngValue]="-1">{{ prefs.txt('স্টক আউট (−)', 'Stock out (−)') }}</option>
                </select>
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('তারিখ', 'Date') }} *</span>
                <input name="editDate" type="date" appDmyDate [ngModel]="editForm().date" (ngModelChange)="setEdit('date', $event)" class="app-input" required />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('পরিমাণ', 'Quantity') }} *</span>
                <input name="editQuantity" type="number" min="0.01" step="0.01" [disabled]="movement.claimId !== null && movement.claimId !== undefined" [ngModel]="editForm().quantity" (ngModelChange)="setEdit('quantity', $event)" class="app-input font-mono" required />
              </label>
              <label class="block col-span-2">
                <span class="app-label">{{ prefs.txt('সিরিয়াল / IMEI', 'Serial / IMEI') }}</span>
                <input name="editSerial" [ngModel]="editForm().serialNumber" (ngModelChange)="setEdit('serialNumber', $event)" class="app-input font-mono" />
              </label>
              <label class="block col-span-2">
                <span class="app-label">{{ prefs.txt('রেফারেন্স', 'Reference') }}</span>
                <input name="editRef" [ngModel]="editForm().refNo" (ngModelChange)="setEdit('refNo', $event)" class="app-input font-mono" />
              </label>
              <label class="block col-span-2">
                <span class="app-label">{{ prefs.txt('নোট', 'Note') }}</span>
                <textarea name="editNote" rows="2" [ngModel]="editForm().note" (ngModelChange)="setEdit('note', $event)" class="app-input resize-y"></textarea>
              </label>
              @if (movement.claimId !== null && movement.claimId !== undefined) {
                <p class="col-span-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-2 text-[11px] text-amber-800 dark:text-amber-200">
                  {{ prefs.txt('এই লেনদেনটি একটি ক্লেইম বা গ্রহণের সাথে যুক্ত — স্টক, দিক ও পরিমাণ লক করা আছে। শুধু তারিখ, সিরিয়াল, রেফারেন্স ও নোট বদলানো যাবে; স্টক বদলাতে হলে ক্লেইম/গ্রহণটি নিজে সম্পাদনা করুন।', 'This movement belongs to a claim or receipt — pool, direction and quantity are locked. Only date, serial, reference and note can change; edit the claim/receipt itself to move stock.') }}
                </p>
              }
            </fieldset>
            @if (editError()) { <p role="alert" class="mx-4 mb-3 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">{{ editError() }}</p> }
            <footer class="p-4 pt-0 flex justify-end gap-2">
              <button type="button" (click)="closeMovementEdit()" [disabled]="editSaving()" class="secondary-button">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
              <button type="submit" [disabled]="editSaving()" class="primary-button">{{ prefs.txt('সংরক্ষণ', 'Save') }}</button>
            </footer>
          </form>
        </section>
      </div>
    }
  `,
  styles: [`
    .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
    .pool-active { border-color: #0d9488; background: #f0fdfa; box-shadow: 0 0 0 1px #0d9488; }
    .pool-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px 10px; font-size: 11px; font-weight: 700; color: #475569; background: #fff; cursor: pointer; }
    .pool-chip:hover { background: #f8fafc; }
    .pool-chip.pool-active { color: #0f766e; }
    .pool-chip .count { border-radius: 999px; background: rgba(148,163,184,.2); padding: 1px 7px; font-family: ui-monospace, monospace; }
    :host-context(.dark) .pool-chip { border-color: #475569; color: #cbd5e1; background: #0f172a; }
    :host-context(.dark) .pool-chip:hover { background: #1e293b; }
    :host-context(.dark) .pool-chip.pool-active { color: #5eead4; }
    .app-label { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: #64748b; margin-bottom: 3px; }
    .app-input { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; padding: 7px 9px; font-size: 12px; color: #0f172a; outline: none; }
    .app-input:focus { border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13,148,136,.15); }
    .primary-button, .secondary-button { border-radius: 8px; padding: 7px 12px; font-weight: 700; cursor: pointer; }
    .primary-button { background: #0d9488; color: #fff; border: 1px solid #0d9488; }
    .primary-button:hover { background: #0f766e; }
    .secondary-button { border: 1px solid #cbd5e1; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible { outline: 2px solid #0d9488; outline-offset: 3px; }
    :host-context(.dark) .panel { background: #0f172a; border-color: #334155; }
    :host-context(.dark) .pool-active { background: #042f2e; border-color: #0d9488; }
    :host-context(.dark) .app-label { color: #94a3b8; }
    :host-context(.dark) .app-input { background: #0b1220; border-color: #475569; color: #e2e8f0; }
    :host-context(.dark) .secondary-button { border-color: #475569; }
  `]
})
export class WarrantyStock {
  private readonly data = inject(DataService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionService);
  readonly prefs = inject(PreferencesService);
  /** Intake stock is admin-owned; everyone else sees it read-only. */
  readonly isAdmin = computed(() => this.session.currentUser()?.role === 'Admin');
  /** Balances and movement history are separate routes; only one renders at a time. */
  readonly isLedgerView = this.route.snapshot.data['stockView'] === 'ledger';
  readonly settings = this.data.warrantySettings;
  readonly pools: WarrantyPool[] = ['received', 'replacement'];
  readonly reasons: MovementReason[] = ['receipt', 'replacement', 'supplier', 'disposal', 'manual', 'return'];
  readonly selectedPool = signal<WarrantyPool>('received');
  readonly balanceQuery = signal('');
  readonly movementQuery = signal('');
  readonly reasonFilter = signal<MovementReason | ''>('');
  readonly directionFilter = signal<'' | 'in' | 'out'>('');
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly adjustmentOpen = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly form = signal<AdjustmentForm>(this.emptyForm('received', 1));
  readonly supplierOpen = signal(false);
  readonly supplierSaving = signal(false);
  readonly supplierError = signal('');
  readonly supplierForm = signal<SupplierForm>(this.emptySupplierForm());
  readonly editingMovement = signal<WarrantyStockMovement | null>(null);
  readonly editSaving = signal(false);
  readonly editError = signal('');
  readonly editForm = signal<MovementEditForm>({
    pool: 'received', direction: 1, quantity: null, date: '', serialNumber: '', refNo: '', note: ''
  });
  private readonly adjustmentDialog = viewChild<ElementRef<HTMLElement>>('adjustmentDialog');
  private returnFocus: HTMLElement | null = null;

  readonly products = computed(() => this.data.products().filter(p => p.type !== 'service').slice().sort((a, b) => a.name.localeCompare(b.name)));
  readonly product = computed(() => this.products().find(p => p.id === this.form().productId));

  readonly balances = computed<UnitBalance[]>(() => {
    const rows = new Map<string, UnitBalance>();
    for (const movement of this.data.warrantyStockMovements()) {
      const unit = (movement.unit || '').trim();
      const key = this.unitKey(movement.productId, movement.productName, unit);
      const row: UnitBalance = rows.get(key) ?? {
        key, productId: movement.productId, productName: movement.productName, unit,
        received: 0, replacement: 0, lastDate: '', pools: [], lastDates: { received: '', replacement: '' }
      };
      row[movement.pool] += movement.quantity;
      if (!row.pools.includes(movement.pool)) row.pools.push(movement.pool);
      const date = isoDay(movement.date);
      if (date > row.lastDate) row.lastDate = date;
      if (date > row.lastDates[movement.pool]) row.lastDates[movement.pool] = date;
      rows.set(key, row);
    }
    return [...rows.values()].map(row => ({
      ...row, received: this.cleanQuantity(row.received), replacement: this.cleanQuantity(row.replacement)
    })).sort((a, b) => a.productName.localeCompare(b.productName) || a.unit.localeCompare(b.unit));
  });
  readonly filteredBalances = computed(() => {
    const query = this.balanceQuery().trim().toLowerCase();
    return this.balances().filter(row => row.pools.includes(this.selectedPool())
      && (!query || `${row.productName} ${row.unit}`.toLowerCase().includes(query)));
  });
  readonly balancePager = createPager(() => this.filteredBalances());
  readonly available = computed(() => {
    const product = this.product();
    if (!product) return 0;
    const key = this.unitKey(product.id, product.name, product.unit);
    return this.balances().find(row => row.key === key)?.[this.form().pool] ?? 0;
  });
  readonly dateFilterError = computed(() => {
    const from = this.fromDate(), to = this.toDate();
    if ((from && !this.validDate(from)) || (to && !this.validDate(to))) {
      return this.prefs.txt('ফিল্টারে সঠিক তারিখ দিন।', 'Enter valid filter dates.');
    }
    return from && to && from > to
      ? this.prefs.txt('শুরুর তারিখ শেষ তারিখের পরে হতে পারবে না।', 'From date must not be after To date.') : '';
  });
  readonly filteredMovements = computed(() => {
    if (this.dateFilterError()) return [];
    const query = this.movementQuery().trim().toLowerCase();
    const from = this.fromDate(), to = this.toDate(), reason = this.reasonFilter(), direction = this.directionFilter();
    return this.data.warrantyStockMovements().filter(row => {
      if (row.pool !== this.selectedPool() || (reason && row.reason !== reason)) return false;
      if (direction === 'in' && row.quantity <= 0 || direction === 'out' && row.quantity >= 0) return false;
      const date = isoDay(row.date);
      if ((from || to) && !this.validDate(date)) return false;
      if (from && date < from || to && date > to) return false;
      return !query || [row.productName, row.serialNumber, row.unit, row.reason, this.reasonLabel(row.reason), row.refNo, row.claimId, row.note]
        .some(value => String(value ?? '').toLowerCase().includes(query));
    }).sort((a, b) => isoDay(b.date).localeCompare(isoDay(a.date)) || b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  });
  readonly movementPager = createPager(() => this.filteredMovements());

  constructor() {
    effect(() => this.adjustmentDialog()?.nativeElement.focus());
  }

  poolLabel(pool: WarrantyPool): string {
    return pool === 'received' ? this.prefs.txt('গ্রহণ স্টক', 'Received Stock') : this.prefs.txt('পরিবর্তন স্টক', 'Replacement Stock');
  }

  reasonLabel(reason: MovementReason): string {
    switch (reason) {
      case 'receipt': return this.prefs.txt('গ্রাহকের পণ্য গ্রহণ', 'Customer receipt');
      case 'replacement': return this.prefs.txt('গ্রাহককে পরিবর্তন', 'Customer replacement');
      case 'supplier': return this.prefs.txt('সাপ্লায়ার লেনদেন', 'Supplier movement');
      case 'disposal': return this.prefs.txt('নিষ্পত্তি', 'Disposal');
      case 'manual': return this.prefs.txt('ম্যানুয়াল সমন্বয়', 'Manual adjustment');
      case 'return': return this.prefs.txt('ফেরত / বিপরীত এন্ট্রি', 'Return / reversal');
      default: return reason;
    }
  }

  balanceCount(pool: WarrantyPool): number { return this.balances().filter(row => row[pool] !== 0).length; }
  dateText(value: string): string { return dmyFromIso(isoDay(value)) || '—'; }
  selectPool(pool: WarrantyPool) { this.selectedPool.set(pool); this.balancePager.setPage(1); this.movementPager.setPage(1); }
  onBalanceQuery(value: string) { this.balanceQuery.set(value); this.balancePager.setPage(1); }
  onMovementQuery(value: string) { this.movementQuery.set(value); this.movementPager.setPage(1); }
  onReason(value: MovementReason | '') { this.reasonFilter.set(value); this.movementPager.setPage(1); }
  onDirection(value: '' | 'in' | 'out') { this.directionFilter.set(value); this.movementPager.setPage(1); }
  onFrom(value: string) { this.fromDate.set(value); this.movementPager.setPage(1); }
  onTo(value: string) { this.toDate.set(value); this.movementPager.setPage(1); }
  clearFilters() {
    this.movementQuery.set(''); this.reasonFilter.set(''); this.directionFilter.set(''); this.fromDate.set(''); this.toDate.set('');
    this.movementPager.setPage(1);
  }

  set<K extends keyof AdjustmentForm>(key: K, value: AdjustmentForm[K]) {
    if (this.saving()) return;
    this.form.update(current => ({ ...current, [key]: value }));
    this.formError.set('');
  }

  pickProduct(productId: number | null) {
    this.set('productId', productId);
    this.set('serialNumber', '');
  }

  openAdjustment(direction: 1 | -1, event?: Event) {
    if (!this.isAdmin()) return;
    this.returnFocus = event?.currentTarget as HTMLElement | null;
    this.form.set(this.emptyForm(this.selectedPool(), direction));
    this.formError.set('');
    this.adjustmentOpen.set(true);
  }

  closeAdjustment() {
    if (this.saving()) return;
    this.adjustmentOpen.set(false);
    this.returnFocus?.focus();
  }

  openSupplier(row: UnitBalance) {
    if (!this.isAdmin()) return;
    const pool = this.selectedPool();
    this.supplierForm.set({
      mode: pool === 'received' ? 'out' : 'in',
      pool,
      productId: row.productId ?? null,
      productName: row.productName,
      unit: row.unit,
      quantity: 1,
      date: localDateIso(),
      serialNumber: '',
      supplierName: '',
      refNo: '',
      note: ''
    });
    this.supplierError.set('');
    this.supplierOpen.set(true);
  }

  closeSupplier() {
    if (this.supplierSaving()) return;
    this.supplierOpen.set(false);
  }

  supplierBalance(): number {
    const form = this.supplierForm();
    const balance = this.data.warrantyStockOf(form.productId ?? undefined, form.productName, form.unit);
    return form.pool === 'received' ? balance.received : balance.replacement;
  }

  setSupplier<K extends keyof SupplierForm>(key: K, value: SupplierForm[K]) {
    if (this.supplierSaving()) return;
    this.supplierForm.update(current => ({ ...current, [key]: value }));
    this.supplierError.set('');
  }

  saveSupplier() {
    if (this.supplierSaving() || !this.isAdmin()) return;
    const form = this.supplierForm();
    const quantity = form.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      this.supplierError.set(this.prefs.txt('শূন্যের বেশি পরিমাণ দিন।', 'Quantity must be greater than zero.')); return;
    }
    const rounded = Math.round(quantity * 100) / 100;
    if (!Number.isSafeInteger(Math.round(quantity * 100)) || Math.abs(quantity - rounded) > 1e-9) {
      this.supplierError.set(this.prefs.txt('সর্বোচ্চ দুই দশমিকের পরিমাণ দিন।', 'Enter a quantity with at most two decimal places.')); return;
    }
    if (!this.validDate(form.date)) {
      this.supplierError.set(this.prefs.txt('সঠিক তারিখ দিন।', 'Enter a valid date.')); return;
    }
    this.supplierSaving.set(true);
    this.supplierError.set('');
    try {
      const supplierNote = [
        form.supplierName.trim() ? `${this.prefs.txt('সরবরাহকারী', 'Supplier')}: ${form.supplierName.trim()}` : '',
        form.note.trim()
      ].filter(Boolean).join(' · ');
      const result = this.data.adjustWarrantyStock({
        pool: form.pool,
        direction: form.mode === 'out' ? -1 : 1,
        productId: form.productId ?? undefined,
        productName: form.productName,
        unit: form.unit,
        quantity: rounded,
        date: form.date,
        serialNumber: form.serialNumber.trim(),
        reason: 'supplier',
        refNo: form.refNo.trim() || (form.mode === 'out' ? 'SUPPLIER-OUT' : 'SUPPLIER-IN'),
        note: supplierNote
      });
      if (!result.ok) {
        this.supplierError.set(result.error === 'shortage'
          ? this.prefs.txt('স্টকে পর্যাপ্ত ইউনিট নেই।', 'Not enough units in this pool.')
          : this.prefs.txt('সাপ্লায়ার লেনদেন সংরক্ষণ করা যায়নি।', 'Could not save the supplier movement.'));
        return;
      }
      this.supplierOpen.set(false);
      this.notify.success(form.mode === 'out'
        ? this.prefs.txt('ত্রুটিপূর্ণ ইউনিট সাপ্লায়ারকে পাঠানো হয়েছে; লেজারে রেকর্ড আছে।', 'Faulty unit sent to supplier; the ledger keeps the record.')
        : this.prefs.txt('সাপ্লায়ার ফেরত ইউনিট রিপ্লেসমেন্ট স্টকে যোগ হয়েছে।', 'Supplier return added to replacement stock.'));
      this.session.log('Warranty Stock Supplier Movement',
        `${form.productName} · ${form.mode === 'out' ? '−' : '+'}${rounded} ${form.unit} · ${this.poolLabel(form.pool)}`);
    } catch {
      this.supplierError.set(this.prefs.txt('লেনদেন নিশ্চিত করা যায়নি; লেজার দেখে আবার চেষ্টা করুন।', 'Could not confirm the movement; check the ledger before retrying.'));
    } finally {
      this.supplierSaving.set(false);
    }
  }

  openMovementEdit(row: WarrantyStockMovement) {
    if (!this.isAdmin()) return;
    const signed = Number(row.quantity) || 0;
    this.editingMovement.set(row);
    this.editForm.set({
      pool: row.pool,
      direction: signed < 0 ? -1 : 1,
      quantity: Math.abs(signed) || null,
      date: isoDay(row.date),
      serialNumber: row.serialNumber || '',
      refNo: row.refNo || '',
      note: row.note || ''
    });
    this.editError.set('');
  }

  closeMovementEdit() {
    if (this.editSaving()) return;
    this.editingMovement.set(null);
  }

  setEdit<K extends keyof MovementEditForm>(key: K, value: MovementEditForm[K]) {
    if (this.editSaving()) return;
    this.editForm.update(current => ({ ...current, [key]: value }));
    this.editError.set('');
  }

  saveMovementEdit() {
    const movement = this.editingMovement();
    if (!movement || this.editSaving() || !this.isAdmin()) return;
    const form = this.editForm(), quantity = form.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      this.editFail(this.prefs.txt('শূন্যের বেশি পরিমাণ দিন।', 'Quantity must be greater than zero.')); return;
    }
    const rounded = Math.round(quantity * 100) / 100;
    if (!Number.isSafeInteger(Math.round(quantity * 100)) || Math.abs(quantity - rounded) > 1e-9) {
      this.editFail(this.prefs.txt('সর্বোচ্চ দুই দশমিকের পরিমাণ দিন।', 'Enter a quantity with at most two decimal places.')); return;
    }
    if (!this.validDate(form.date)) {
      this.editFail(this.prefs.txt('সঠিক তারিখ দিন।', 'Enter a valid date.')); return;
    }
    const signed = rounded * form.direction;
    this.editSaving.set(true);
    this.editError.set('');
    try {
      const result = this.data.updateWarrantyStockMovement(movement.id, {
        pool: form.pool,
        quantity: signed,
        date: form.date,
        serialNumber: form.serialNumber,
        refNo: form.refNo,
        note: form.note
      });
      if (!result.ok) {
        this.editFail(result.error === 'shortage'
          ? this.prefs.txt('এই পরিবর্তনে ব্যালেন্স ঋণাত্মক হয়ে যাবে।', 'This change would make the balance negative.')
          : result.error === 'claimed'
            ? this.prefs.txt('ক্লেইম/গ্রহণের লেনদেনে স্টক, দিক বা পরিমাণ বদলানো যাবে না।', 'A claim-linked movement cannot change its stock, direction or quantity.')
            : this.prefs.txt('লেনদেন এডিট করা যায়নি।', 'Could not edit the movement.'));
        return;
      }
      this.editingMovement.set(null);
      this.notify.success(this.prefs.txt('লেনদেন আপডেট হয়েছে।', 'Movement updated.'));
      this.session.log('Warranty Stock Edited',
        `${movement.productName} · ${movement.quantity > 0 ? '+' : ''}${movement.quantity} → ${signed > 0 ? '+' : ''}${signed} ${movement.unit}`);
    } catch {
      this.editFail(this.prefs.txt('লেনদেন আপডেট হয়েছে কি না নিশ্চিত করা যায়নি।', 'Could not confirm the movement update.'));
    } finally {
      this.editSaving.set(false);
    }
  }

  async deleteMovement(row: WarrantyStockMovement) {
    if (!this.isAdmin()) return;
    if (row.claimId !== null && row.claimId !== undefined) {
      this.notify.error(this.prefs.txt('ক্লেইম/গ্রহণের লেনদেন ডিলিট করা যায় না — ক্লেইম বা ভাউচারটি নিজে ডিলিট/বাতিল করুন।', 'A claim-linked movement cannot be deleted — delete or cancel the claim/voucher instead.'));
      return;
    }
    const confirmed = await this.notify.confirm(
      this.prefs.txt(
        `${row.productName} (${row.serialNumber || row.refNo || row.unit}) এর এই লেনদেনটি ডিলিট করবেন? ব্যালেন্স নতুন করে হিসাব হবে।`,
        `Delete this ${row.productName} movement? Balances will be recalculated.`
      ),
      {
        title: this.prefs.txt('লেনদেন ডিলিট', 'Delete Movement'),
        confirmText: this.prefs.txt('ডিলিট', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    const result = this.data.deleteWarrantyStockMovement(row.id);
    if (!result.ok) {
      this.notify.error(result.error === 'shortage'
        ? this.prefs.txt('এই লেনদেন মুছলে ব্যালেন্স ঋণাত্মক হয়ে যাবে।', 'Deleting this movement would make the balance negative.')
        : this.prefs.txt('লেনদেন ডিলিট করা যায়নি।', 'Could not delete the movement.'));
      return;
    }
    this.notify.success(this.prefs.txt('লেনদেন ডিলিট হয়েছে।', 'Movement deleted.'));
    this.session.log('Warranty Stock Deleted',
      `${row.productName} · ${row.quantity > 0 ? '+' : ''}${row.quantity} ${row.unit} · ${row.serialNumber || row.refNo || '—'}`);
  }

  saveAdjustment() {
    if (this.saving() || !this.isAdmin()) return;
    const form = this.form(), product = this.product(), quantity = form.quantity;
    if (!product || !product.name.trim() || !product.unit?.trim()) {
      this.fail(this.prefs.txt('এককসহ একটি বৈধ পণ্য নির্বাচন করুন।', 'Select a valid product with a unit.')); return;
    }
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      this.fail(this.prefs.txt('সসীম ও শূন্যের বেশি পরিমাণ দিন।', 'Quantity must be finite and greater than zero.')); return;
    }
    const rounded = Math.round(quantity * 100) / 100;
    if (rounded <= 0 || !Number.isSafeInteger(Math.round(quantity * 100)) || Math.abs(quantity - rounded) > 1e-9) {
      this.fail(this.prefs.txt('নিরাপদ সীমার মধ্যে সর্বোচ্চ দুই দশমিকের পরিমাণ দিন।', 'Enter a quantity within the supported range, with at most two decimal places.')); return;
    }
    if (!this.validDate(form.date)) {
      this.fail(this.prefs.txt('একটি সঠিক তারিখ দিন।', 'Enter a valid calendar date.')); return;
    }
    if (!this.pools.includes(form.pool) || (form.direction !== 1 && form.direction !== -1)) {
      this.fail(this.prefs.txt('সঠিক স্টক ও দিক নির্বাচন করুন।', 'Select a valid stock pool and direction.')); return;
    }
    if (form.direction === -1 && !this.settings().allowNegativeStock && rounded > this.available()) {
      this.fail(this.prefs.txt('নির্বাচিত স্টকে এই এককের পর্যাপ্ত পণ্য নেই।', 'Insufficient stock in this pool and unit.')); return;
    }
    this.saving.set(true);
    this.formError.set('');
    try {
      const result = this.data.adjustWarrantyStock({
        pool: form.pool, direction: form.direction, productId: product.id, productName: product.name.trim(), unit: product.unit.trim(),
        quantity: rounded, date: form.date, serialNumber: form.serialNumber.trim(), note: form.note.trim()
      });
      if (!result.ok) {
        this.fail(result.error === 'shortage'
          ? this.prefs.txt('স্টক অপর্যাপ্ত। বর্তমান ব্যালেন্স দেখে আবার চেষ্টা করুন।', 'Insufficient stock. Check the current balance and try again.')
          : this.prefs.txt('স্টক সমন্বয় সংরক্ষণ করা যায়নি। পণ্য ও পরিমাণ যাচাই করুন।', 'Could not save the adjustment. Check the product and quantity.'));
        return;
      }
      this.selectPool(form.pool);
      this.adjustmentOpen.set(false);
      this.returnFocus?.focus();
      this.notify.success(this.prefs.txt('স্টক সমন্বয় সংরক্ষিত হয়েছে; ইতিহাস অক্ষত আছে।', 'Stock adjustment saved; movement history retained.'));
      this.session.log('Warranty Stock Adjustment',
        `${product.name} · ${form.direction === 1 ? '+' : '−'}${rounded} ${product.unit} · ${this.poolLabel(form.pool)}`);
    } catch {
      this.fail(this.prefs.txt('সমন্বয় সম্পন্ন হয়েছে কি না নিশ্চিত করা যায়নি। আবার দেওয়ার আগে লেনদেনের ইতিহাস যাচাই করুন।', 'Could not confirm the adjustment. Check the ledger before retrying to avoid a duplicate.'));
    } finally {
      this.saving.set(false);
    }
  }

  private fail(message: string) { this.formError.set(message); this.notify.error(message); }
  private editFail(message: string) { this.editError.set(message); this.notify.error(message); }
  private unitKey(productId: number | undefined, productName: string, unit: string): string {
    return this.data.warrantyStockKey(productId, productName, unit);
  }
  private cleanQuantity(value: number): number { return Math.round(value * 1e6) / 1e6; }
  private validDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  private emptyForm(pool: WarrantyPool, direction: 1 | -1): AdjustmentForm {
    return { pool, direction, productId: null, quantity: 1, date: localDateIso(), serialNumber: '', note: '' };
  }

  private emptySupplierForm(): SupplierForm {
    return {
      mode: 'out', pool: 'received', productId: null, productName: '', unit: '',
      quantity: 1, date: localDateIso(), serialNumber: '', supplierName: '', refNo: '', note: ''
    };
  }
}
