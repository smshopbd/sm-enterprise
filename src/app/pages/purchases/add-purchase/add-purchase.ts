import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import {
  DataService,
  Product,
  ProductVariant,
  Purchase,
  PurchaseItem,
  hasPartyRole,
  hasPurchaseRole
} from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { SessionService } from '../../../services/session';
import { productSearchScore, variantLabel } from '../../../utils/product-search';
import { PurchaseVoucher } from '../../../components/purchase-voucher/purchase-voucher';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';
import { localDateIso } from '../../../utils/local-date';

interface ProductOption {
  product: Product;
  variant?: ProductVariant;
  label: string;
  code: string;
  price: number;
  stock: number;
  variantInfo?: string;
}

@Component({
  selector: 'app-add-purchase',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, PurchaseVoucher, DmyDateDirective],
  template: `
    <div class="space-y-4 text-xs text-slate-800" (click)="closeResults()">

      <!-- Title bar -->
      <div class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <button (click)="goBack()" class="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl bg-white/15 ring-1 ring-white/25 transition-colors hover:bg-white/25" [title]="prefs.txt('ক্রয় ইতিহাসে ফিরে যান', 'Back to purchase history')">
              <mat-icon class="text-lg">arrow_back</mat-icon>
            </button>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                <span>{{ prefs.txt('ক্রয়', 'Purchases') }}</span>
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                <span>{{ editPurchaseId() !== null ? prefs.txt('সম্পাদনা', 'Edit') : prefs.txt('নতুন ক্রয়', 'New purchase') }}</span>
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">
                {{ editPurchaseId() !== null ? prefs.txt('ক্রয় সম্পাদনা', 'Edit Purchase') : prefs.txt('ক্রয়', 'Purchases') }}
              </h1>
              <p class="truncate text-[11px] text-teal-50/85">
                {{ prefs.txt('ভাউচার', 'Voucher') }} #{{ invoiceNo() }} — {{ editPurchaseId() !== null ? prefs.txt('তথ্য হালনাগাদ করুন', 'update the entry') : prefs.txt('সরবরাহকারীর কাছ থেকে নতুন ক্রয় এন্ট্রি', 'new purchase entry from supplier') }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button (click)="goBack()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              {{ prefs.txt('বাতিল', 'Cancel') }}
            </button>
            <button (click)="savePurchase()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon class="text-sm">save</mat-icon> {{ editPurchaseId() !== null ? prefs.txt('আপডেট', 'Update') : prefs.txt('সংরক্ষণ', 'Save') }}
            </button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] gap-4 items-start">

        <!-- Main entry column -->
        <div class="space-y-4 min-w-0">

          <!-- Voucher number card -->
          <div class="rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50 via-white to-white p-4 shadow-xs dark:border-teal-900/60 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <label for="purchase-invoice" class="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
                  <mat-icon class="text-base text-teal-600">receipt_long</mat-icon>
                  {{ prefs.txt('ভাউচার নম্বর', 'Voucher No.') }}
                </label>
                <p class="mt-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  {{ prefs.txt('নিজের মতো নম্বর লিখুন — নতুন সিরিয়াল PUR-3001 থেকে শুরু', 'Type your own number — the series starts at PUR-3001') }}
                </p>
              </div>
              <input
                id="purchase-invoice"
                type="text"
                [ngModel]="invoiceNo()"
                (ngModelChange)="invoiceNo.set($event)"
                maxlength="24"
                spellcheck="false"
                [placeholder]="prefs.txt('যেমন PUR-3001', 'e.g. PUR-3001')"
                class="w-full rounded-lg border border-teal-300 bg-white px-3 py-2 font-mono text-sm font-black text-teal-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200 sm:w-60 dark:border-teal-800 dark:bg-slate-950 dark:text-teal-300"
              >
            </div>
          </div>

          <!-- Supplier / warehouse card -->
          <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="block font-bold text-slate-700 mb-1.5"><span class="text-rose-500">*</span> {{ prefs.txt('সরবরাহকারী', 'Supplier') }}</label>
                <div class="flex items-center gap-1.5">
                  <div class="relative flex-1" (click)="$event.stopPropagation()">
                    <div class="flex items-center border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <mat-icon class="text-slate-400 text-sm mx-2 shrink-0">person</mat-icon>
                      <input
                        type="text"
                        [ngModel]="supplierQuery()"
                        (ngModelChange)="onSupplierSearch($event)"
                        (focus)="showSupplierResults.set(true)"
                        (keydown.enter)="selectFirstSupplier($event)"
                        (keydown.escape)="showSupplierResults.set(false)"
                        [placeholder]="prefs.txt('সরবরাহকারীর নাম / ফোন দিয়ে খুঁজুন...', 'Search supplier name / phone...')"
                        class="w-full bg-transparent outline-none py-2 font-semibold text-slate-800"
                      >
                      <button type="button" (click)="showSupplierResults.set(!showSupplierResults())" class="px-2 py-1 text-slate-400 hover:text-teal-700 cursor-pointer shrink-0" [title]="prefs.txt('সরবরাহকারী দেখুন', 'Show suppliers')">
                        <mat-icon class="text-base">expand_more</mat-icon>
                      </button>
                    </div>

                    @if (showSupplierResults()) {
                      <div class="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-40 max-h-64 overflow-y-auto">
                        @for (s of supplierResults(); track s.id) {
                          <button
                            type="button"
                            (click)="selectSupplier(s.name, s.id)"
                            class="w-full text-left px-3 py-2 hover:bg-teal-50/70 border-b border-slate-100 last:border-0 flex items-center gap-2 cursor-pointer"
                          >
                            <span class="w-7 h-7 rounded-md bg-teal-50 border border-teal-100 text-teal-700 inline-flex items-center justify-center shrink-0">
                              <mat-icon class="text-sm">store</mat-icon>
                            </span>
                            <span class="min-w-0 flex-1">
                              <span class="block font-bold text-slate-800 truncate">{{ s.name }}</span>
                              @if (s.companyName && s.companyName !== s.name) {
                                <span class="block text-[10px] text-slate-400 truncate">{{ s.companyName }}</span>
                              }
                            </span>
                            @if (s.phone) {
                              <span class="text-[10px] font-mono text-slate-500 shrink-0">{{ s.phone }}</span>
                            }
                          </button>
                        } @empty {
                          <p class="px-3 py-4 text-center text-slate-400">{{ prefs.txt('কোনো সরবরাহকারী পাওয়া যায়নি।', 'No supplier found.') }}</p>
                        }
                      </div>
                    }
                  </div>
                </div>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1.5"><span class="text-rose-500">*</span> {{ prefs.txt('ওয়্যারহাউস', 'Warehouse') }}</label>
                <div class="flex items-center gap-1.5">
                  <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white flex-1 focus-within:ring-2 focus-within:ring-teal-500">
                    <mat-icon class="text-slate-400 text-sm mr-2">warehouse</mat-icon>
                    <select [(ngModel)]="warehouse" class="w-full bg-transparent outline-none font-semibold text-slate-800">
                      @for (w of warehouses(); track w) {
                        <option [value]="w">{{ w }}</option>
                      }
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <!-- Product search -->
            <div class="space-y-2">
              <label class="block font-bold text-slate-700">{{ prefs.txt('পণ্য', 'Product') }}</label>
              <div class="relative" (click)="$event.stopPropagation()">
                <div class="flex items-center border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <input
                    type="text"
                    [ngModel]="productSearch()"
                    (ngModelChange)="onProductSearch($event)"
                    (focus)="showResults.set(productSearch().length > 0)"
                    (keydown.enter)="addFirstResult($event)"
                    [placeholder]="prefs.txt('নাম, কোড, ব্র্যান্ড, মডেল বা ভ্যারিয়েন্ট লিখুন (একাধিক শব্দ / ছোট বানান ভুলও চলবে)', 'Type name, code, brand, model or variant (multiple words / minor typos allowed)')"
                    class="w-full bg-transparent outline-none px-3 py-2.5 font-medium"
                  >
                  <button (click)="showResults.set(productSearch().length > 0)" class="px-2.5 py-2 text-slate-400 hover:text-teal-700 cursor-pointer" [title]="prefs.txt('পণ্য খুঁজুন', 'Search products')">
                    <mat-icon class="text-base">search</mat-icon>
                  </button>
                </div>

                @if (showResults() && productSearch().trim()) {
                  <div class="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-72 overflow-y-auto">
                    @for (option of results(); track option.product.id + '-' + (option.variant?.id || 0)) {
                      <button (click)="addOption(option); $event.stopPropagation()" class="w-full text-left px-3 py-2 hover:bg-teal-50/70 border-b border-slate-100 last:border-0 flex items-center justify-between gap-2 cursor-pointer">
                        <span class="flex items-center gap-2 min-w-0">
                          <span class="w-7 h-7 rounded-md bg-teal-50 border border-teal-100 text-teal-700 inline-flex items-center justify-center shrink-0">
                            <mat-icon class="text-sm">inventory_2</mat-icon>
                          </span>
                          <span class="min-w-0">
                            <span class="block font-bold text-slate-800 truncate">{{ option.label }}</span>
                            <span class="block text-[10px] font-mono text-slate-400 truncate">{{ option.code || '—' }} · {{ prefs.txt('স্টক', 'Stock') }}: {{ option.stock }} {{ option.product.unit }}</span>
                            @if (option.variantInfo) {
                              <span class="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200 text-[9px] font-bold text-violet-700 truncate max-w-full">{{ prefs.txt('ভ্যারিয়েন্ট', 'Variant') }}: {{ option.variantInfo }}</span>
                            }
                          </span>
                        </span>
                        <span class="font-mono text-[11px] font-bold text-slate-600 shrink-0">{{ option.price | number:'1.2-2' }} TK</span>
                      </button>
                    } @empty {
                      <p class="px-3 py-4 text-center text-slate-400">{{ prefs.txt('মিলে এমন কোনো পণ্য পাওয়া যায়নি।', 'No matching product found.') }}</p>
                    }
                  </div>
                }
              </div>
            </div>
          </div>

          <!-- Items card -->
          <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div class="hidden md:block overflow-x-auto">
              <table class="w-full min-w-[720px] text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-teal-600 text-white">
                    <th class="px-3 py-2.5 text-center w-12 font-bold uppercase tracking-wider text-[10px]">{{ prefs.txt('ক্রম', 'SL') }}</th>
                    <th class="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px]">{{ prefs.txt('পণ্য', 'Product') }}</th>
                    <th class="px-3 py-2.5 text-center w-24 font-bold uppercase tracking-wider text-[10px]">{{ prefs.txt('পরিমাণ', 'Quantity') }}</th>
                    <th class="px-3 py-2.5 text-center w-28 font-bold uppercase tracking-wider text-[10px]">{{ prefs.txt('ক্রয় মূল্য', 'Purchase Price') }}</th>
                    <th class="px-3 py-2.5 text-center w-28 font-bold uppercase tracking-wider text-[10px]">{{ prefs.txt('উপমোট', 'Subtotal') }}</th>
                    <th class="px-3 py-2.5 text-center w-16 font-bold uppercase tracking-wider text-[10px]">{{ prefs.txt('অ্যাকশন', 'Action') }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of items(); track item.id; let i = $index) {
                    <tr class="border-b border-slate-100 hover:bg-slate-50/60 align-middle">
                      <td class="px-3 py-2 text-center font-mono text-slate-500">{{ i + 1 }}</td>
                      <td class="px-3 py-2">
                        <p class="font-bold text-slate-800">{{ item.productName }}</p>
                        <p class="text-[10px] font-mono text-slate-400">{{ item.itemCode || '—' }}</p>
                      </td>
                      <td class="px-3 py-2 text-center">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          [value]="item.quantity"
                          (input)="updateQuantity(item.id, $event)"
                          class="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-center font-mono font-semibold focus:border-teal-500 focus:outline-none"
                        >
                      </td>
                      <td class="px-3 py-2 text-center">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          [value]="item.purchasePrice"
                          (input)="updatePrice(item.id, $event)"
                          class="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-right font-mono font-semibold focus:border-teal-500 focus:outline-none"
                        >
                      </td>
                      <td class="px-3 py-2 text-right font-mono font-bold text-slate-800">{{ item.subtotal | number:'1.2-2' }} TK</td>
                      <td class="px-3 py-2 text-center">
                        <button (click)="removeItem(item.id)" class="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg cursor-pointer" [title]="prefs.txt('পণ্য সরান', 'Remove item')">
                          <mat-icon class="text-sm">delete</mat-icon>
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="p-16 text-center">
                        <div class="flex flex-col items-center gap-1 text-slate-400">
                          <mat-icon class="text-3xl text-slate-300">shopping_cart</mat-icon>
                          <p class="font-bold text-slate-500">{{ prefs.txt('কোনো পণ্য নেই', 'No data') }}</p>
                          <p class="text-[11px]">{{ prefs.txt('ক্রয়ের পণ্য যোগ করতে উপরে সার্চ করুন।', 'Search above to add purchase items.') }}</p>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <!-- Mobile item cards -->
            <div class="md:hidden divide-y divide-slate-100">
              @for (item of items(); track item.id; let i = $index) {
                <div class="p-3 space-y-2">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="font-bold text-slate-800 text-xs truncate">SL {{ i + 1 }} • {{ item.productName }}</p>
                      <p class="text-[10px] font-mono text-slate-400 truncate">{{ item.itemCode || '—' }}</p>
                    </div>
                    <button (click)="removeItem(item.id)" class="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer" [title]="prefs.txt('পণ্য সরান', 'Remove item')">
                      <mat-icon class="text-base">delete</mat-icon>
                    </button>
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="block text-[10px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('পরিমাণ', 'Quantity') }}</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        [value]="item.quantity"
                        (input)="updateQuantity(item.id, $event)"
                        class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-center font-mono font-semibold focus:border-teal-500 focus:outline-none"
                      >
                    </div>
                    <div>
                      <label class="block text-[10px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('ক্রয় মূল্য', 'Purchase Price') }}</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        [value]="item.purchasePrice"
                        (input)="updatePrice(item.id, $event)"
                        class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-right font-mono font-semibold focus:border-teal-500 focus:outline-none"
                      >
                    </div>
                  </div>
                  <div class="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5">
                    <span class="text-[10px] font-bold uppercase text-slate-500">{{ prefs.txt('উপমোট', 'Subtotal') }}</span>
                    <b class="font-mono text-teal-700">{{ item.subtotal | number:'1.2-2' }} TK</b>
                  </div>
                </div>
              } @empty {
                <div class="p-10 flex flex-col items-center gap-1 text-slate-400">
                  <mat-icon class="text-3xl text-slate-300">shopping_cart</mat-icon>
                  <p class="font-bold text-slate-500">{{ prefs.txt('কোনো পণ্য নেই', 'No data') }}</p>
                  <p class="text-[11px] text-center">{{ prefs.txt('ক্রয়ের পণ্য যোগ করতে উপরে সার্চ করুন।', 'Search above to add purchase items.') }}</p>
                </div>
              }
            </div>

            <div class="flex items-center justify-end gap-6 bg-slate-100/80 border-t border-slate-200 px-4 py-2.5">
              <span class="font-black text-slate-500 uppercase tracking-wider text-[10px]">{{ prefs.txt('মোট:', 'Total:') }}</span>
              <span class="font-mono font-black text-lg text-teal-700">{{ subtotal() | number:'1.2-2' }} TK</span>
            </div>
          </div>

          <!-- Payment bar -->
          <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <div>
                <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('ডিসকাউন্ট', 'Discount') }}</label>
                <div class="flex items-center gap-1.5">
                  <select
                    [ngModel]="discountType()"
                    (ngModelChange)="discountType.set($event)"
                    class="w-16 border border-slate-300 rounded-lg px-1.5 py-2 bg-white font-semibold focus:border-teal-500 focus:outline-none"
                  >
                    <option value="fixed">TK</option>
                    <option value="percent">%</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    [ngModel]="discountValue()"
                    (ngModelChange)="discountValue.set(numberValue($event))"
                    [placeholder]="prefs.txt('ডিসকাউন্ট', 'Discount')"
                    class="w-full border border-slate-300 rounded-lg px-2.5 py-2 font-mono font-semibold focus:border-teal-500 focus:outline-none"
                  >
                </div>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('শিপিং', 'Shipping') }}</label>
                <div class="flex items-center gap-1.5">
                  <span class="w-9 h-9 rounded-lg bg-amber-50 border border-amber-100 text-amber-700 inline-flex items-center justify-center shrink-0">
                    <mat-icon class="text-sm">local_shipping</mat-icon>
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    [ngModel]="shipping()"
                    (ngModelChange)="shipping.set(numberValue($event))"
                    placeholder="0"
                    class="w-full border border-slate-300 rounded-lg px-2.5 py-2 font-mono font-semibold focus:border-teal-500 focus:outline-none"
                  >
                  <span class="text-[10px] font-bold text-slate-400">TK</span>
                </div>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('পরবর্তী পেমেন্ট তারিখ', 'Next Payment Date') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-2">event</mat-icon>
                  <input type="date" appDmyDate [(ngModel)]="nextPayDate" class="w-full bg-transparent outline-none font-semibold">
                </div>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('পরিশোধিত পেমেন্ট', 'Paid Payment') }}</label>
                <div class="flex items-center gap-1.5">
                  <select
                    [(ngModel)]="paymentMode"
                    class="w-24 border border-slate-300 rounded-lg px-1.5 py-2 bg-white font-semibold focus:border-teal-500 focus:outline-none"
                  >
                    @for (mode of paymentModes; track mode) {
                      <option [value]="mode">{{ paymentModeLabel(mode) }}</option>
                    }
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    [ngModel]="paidAmount()"
                    (ngModelChange)="paidAmount.set(numberValue($event))"
                    placeholder="0"
                    class="w-full border border-slate-300 rounded-lg px-2.5 py-2 font-mono font-semibold focus:border-teal-500 focus:outline-none"
                  >
                  <button type="button" (click)="savePurchase()" [attr.aria-label]="prefs.txt('ক্রয় সংরক্ষণ', 'Save purchase')" class="w-9 h-9 rounded-xl bg-teal-700 hover:bg-teal-800 text-white inline-flex items-center justify-center shrink-0 cursor-pointer shadow-sm transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus-visible:ring-offset-1 dark:ring-offset-slate-900" [title]="prefs.txt('ক্রয় সংরক্ষণ', 'Save purchase')">
                    <mat-icon class="text-base">add</mat-icon>
                  </button>
                </div>
                <button (click)="payFull()" class="text-[10px] font-bold uppercase tracking-wider text-teal-700 hover:text-teal-900 mt-1 cursor-pointer">{{ prefs.txt('সম্পূর্ণ পরিশোধ', 'Pay Full') }}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Right sidebar -->
        <div class="space-y-4">
          <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
            <div>
              <label class="block font-bold text-slate-700 mb-1.5"><span class="text-rose-500">*</span> {{ prefs.txt('ক্রয়ের তারিখ', 'Purchase Date') }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">event</mat-icon>
                <input type="date" appDmyDate [(ngModel)]="purchaseDate" class="w-full bg-transparent outline-none font-semibold">
              </div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1.5"><span class="text-rose-500">*</span> {{ prefs.txt('অর্ডার স্ট্যাটাস', 'Order Status') }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">verified</mat-icon>
                <select [(ngModel)]="orderStatus" class="w-full bg-transparent outline-none font-semibold text-slate-800">
                  @for (status of orderStatuses; track status) {
                    <option [value]="status">{{ orderStatusLabel(status) }}</option>
                  }
                </select>
              </div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('অর্ডার ট্যাক্স', 'Order Tax') }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">percent</mat-icon>
                <select [ngModel]="orderTax()" (ngModelChange)="orderTax.set($event)" class="w-full bg-transparent outline-none font-semibold text-slate-800">
                  @for (tax of taxOptions; track tax) {
                    <option [value]="tax">{{ tax === 'No Tax' ? prefs.txt('কোনো ট্যাক্স নেই', 'No Tax') : tax }}</option>
                  }
                </select>
              </div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('ক্রয়কারী', 'Purchaser') }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">person_pin</mat-icon>
                <select [(ngModel)]="purchaser" class="w-full bg-transparent outline-none font-semibold text-slate-800">
                  @for (person of purchasers(); track person) {
                    <option [value]="person">{{ person }}</option>
                  }
                </select>
              </div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('কিস্তি', 'Installments') }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">event_repeat</mat-icon>
                <select [(ngModel)]="installments" class="w-full bg-transparent outline-none font-semibold text-slate-800">
                  <option value="None">{{ prefs.txt('কোনোটি নয়', 'None') }}</option>
                  @for (n of installmentOptions; track n) {
                    <option [value]="n">{{ n }} {{ n === 1 ? prefs.txt('কিস্তি', 'Installment') : prefs.txt('কিস্তি', 'Installments') }}</option>
                  }
                </select>
              </div>
            </div>

            <button (click)="showNote.set(!showNote())" class="w-full border border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/40 rounded-xl py-2 text-slate-600 hover:text-teal-700 font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer">
              <mat-icon class="text-sm">{{ showNote() ? 'remove' : 'add' }}</mat-icon> {{ showNote() ? prefs.txt('নোট লুকান', 'Hide Note') : prefs.txt('নোট যোগ করুন', 'Add Note') }}
            </button>
            @if (showNote()) {
              <textarea
                [(ngModel)]="notes"
                rows="3"
                [placeholder]="prefs.txt('ক্রয়ের নোট লিখুন...', 'Write purchase note...')"
                class="w-full border border-slate-300 rounded-lg px-2.5 py-2 font-medium focus:border-teal-500 focus:outline-none resize-none"
              ></textarea>
            }
          </div>

          <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div class="px-4 py-2.5 border-b border-slate-100">
              <p class="font-bold text-slate-800 flex items-center gap-1.5"><mat-icon class="text-sm text-teal-600">receipt_long</mat-icon> {{ prefs.txt('সারসংক্ষেপ', 'Summary') }}</p>
            </div>
            <div class="p-4 space-y-1.5">
              <div class="flex justify-between">
                <span class="text-slate-500">{{ prefs.txt('উপমোট', 'Subtotal') }}</span>
                <span class="font-mono font-semibold">{{ subtotal() | number:'1.2-2' }} TK</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">{{ prefs.txt('ডিসকাউন্ট', 'Discount') }}</span>
                <span class="font-mono font-semibold text-rose-600">- {{ discountAmount() | number:'1.2-2' }} TK</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">{{ prefs.txt('শিপিং', 'Shipping') }}</span>
                <span class="font-mono font-semibold">{{ shipping() | number:'1.2-2' }} TK</span>
              </div>
              @if (taxAmount() > 0) {
                <div class="flex justify-between">
                  <span class="text-slate-500">{{ prefs.txt('অর্ডার ট্যাক্স', 'Order Tax') }}</span>
                  <span class="font-mono font-semibold">{{ taxAmount() | number:'1.2-2' }} TK</span>
                </div>
              }
              <div class="flex justify-between pt-1.5 border-t border-slate-200">
                <span class="font-black text-slate-800">{{ prefs.txt('সর্বমোট', 'Total') }}</span>
                <span class="font-mono font-black text-teal-700">{{ grandTotal() | number:'1.2-2' }} TK</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">{{ prefs.txt('পরিশোধিত পেমেন্ট', 'Paid Payment') }}</span>
                <span class="font-mono font-semibold text-emerald-700">{{ paidAmount() | number:'1.2-2' }} TK</span>
              </div>
              <div class="flex justify-between border-t border-slate-200 pt-1.5">
                <span class="font-bold text-slate-700">{{ prefs.txt('বাকি পরিমাণ', 'Due Amount') }}</span>
                <span class="font-mono font-black text-rose-600">{{ dueAmount() | number:'1.2-2' }} TK</span>
              </div>
            </div>
            <div class="p-3 pt-0">
              <button (click)="savePurchase()" class="w-full bg-teal-700 hover:bg-teal-800 text-white font-extrabold py-2.5 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer">
                <mat-icon class="text-sm">save</mat-icon> {{ editPurchaseId() !== null ? prefs.txt('ক্রয় আপডেট', 'Update Purchase') : prefs.txt('ক্রয় সংরক্ষণ', 'Save Purchase') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    @if (voucher(); as saved) {
      <app-purchase-voucher [purchase]="saved" (close)="closeVoucher()" />
    }
  `
})
export class AddPurchase implements OnInit {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  readonly prefs = inject(PreferencesService);
  private session = inject(SessionService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly invoiceNo = signal(this.dataService.nextPurchaseInvoice());
  readonly editPurchaseId = signal<number | null>(null);
  private editingPurchase: Purchase | null = null;
  supplierName = '';
  selectedPartyId?: number;
  supplierQuery = signal('');
  showSupplierResults = signal(false);
  warehouse = 'SM Warehouse';
  warehouses = signal<string[]>(this.loadWarehouses());

  orderStatus: Purchase['status'] = 'Received';
  orderTax = signal('No Tax');
  purchaser = 'Admin';
  installments = 'None';
  paymentMode = 'Cash';
  purchaseDate = localDateIso();
  nextPayDate = '';

  productSearch = signal('');
  showResults = signal(false);
  items = signal<PurchaseItem[]>([]);

  discountType = signal<'fixed' | 'percent'>('fixed');
  discountValue = signal(0);
  shipping = signal(0);
  paidAmount = signal(0);
  showNote = signal(false);
  notes = '';

  voucher = signal<Purchase | null>(null);

  readonly paymentModes = ['Cash', 'Bank', 'bKash', 'Nagad', 'Due'];
  readonly orderStatuses: Purchase['status'][] = ['Received', 'Pending', 'Ordered', 'Manufacturing'];
  readonly taxOptions = ['No Tax', '5% VAT', '7.5% VAT', '10% VAT', '15% VAT'];
  readonly installmentOptions = Array.from({ length: 12 }, (_, index) => index + 1);

  paymentModeLabel(mode: string): string {
    switch (mode) {
      case 'Cash': return this.prefs.txt('নগদ', 'Cash');
      case 'Bank': return this.prefs.txt('ব্যাংক', 'Bank');
      case 'Due': return this.prefs.txt('বাকি', 'Due');
      default: return mode;
    }
  }

  orderStatusLabel(status: Purchase['status']): string {
    switch (status) {
      case 'Received': return this.prefs.txt('গৃহীত', 'Received');
      case 'Pending': return this.prefs.txt('অপেক্ষমাণ', 'Pending');
      case 'Ordered': return this.prefs.txt('অর্ডারকৃত', 'Ordered');
      case 'Manufacturing': return this.prefs.txt('উৎপাদনাধীন', 'Manufacturing');
      default: return status;
    }
  }

  suppliers = computed(() => this.dataService.parties().filter(party => hasPurchaseRole(party)));

  supplierResults = computed(() => {
    const query = this.supplierQuery().trim().toLowerCase();
    const list = this.suppliers();
    if (!query) return list;
    return list.filter(supplier =>
      supplier.name.toLowerCase().includes(query) ||
      (supplier.companyName || '').toLowerCase().includes(query) ||
      (supplier.phone || '').toLowerCase().includes(query)
    );
  });

  purchasers = computed(() => {
    const names = this.dataService.parties()
      .filter(party => hasPartyRole(party, 'Staff Member'))
      .map(party => party.name);
    return ['Admin', ...Array.from(new Set(names))];
  });

  private allOptions = computed<ProductOption[]>(() =>
    this.dataService.products().flatMap(product => {
      const variants = product.variants || [];
      if (!variants.length) {
        return [{
          product,
          label: product.name,
          code: product.code,
          price: product.purchasePrice || 0,
          stock: product.stock || 0
        }];
      }
      return variants.map(variant => ({
        product,
        variant,
        label: `${product.name} - ${variant.variantValue}`,
        code: variant.itemCode || product.code,
        price: variant.purchasePrice || product.purchasePrice || 0,
        stock: variant.openingStock || 0,
        variantInfo: [variantLabel(variant), variant.itemCode].filter(Boolean).join(' · ')
      }));
    })
  );

  results = computed(() => {
    const query = this.productSearch().trim();
    if (!query) return [];
    return this.allOptions()
      .map((option, index) => ({
        option,
        index,
        score: productSearchScore(option.product, query, option.variant)
      }))
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(result => result.option)
      .slice(0, 10);
  });

  subtotal = computed(() => this.items().reduce((sum, item) => sum + item.subtotal, 0));

  discountAmount = computed(() => {
    const value = this.discountValue();
    if (this.discountType() === 'percent') {
      return Math.min(this.subtotal(), this.subtotal() * value / 100);
    }
    return Math.min(this.subtotal(), value);
  });

  taxAmount = computed(() => {
    const match = this.orderTax().match(/([\d.]+)%/);
    if (!match) return 0;
    const base = this.subtotal() - this.discountAmount() + this.shipping();
    return Math.max(0, base * Number(match[1]) / 100);
  });

  grandTotal = computed(() =>
    Math.max(0, this.subtotal() - this.discountAmount() + this.shipping() + this.taxAmount())
  );

  dueAmount = computed(() => Math.max(0, this.grandTotal() - this.paidAmount()));

  ngOnInit() {
    const raw = this.route.snapshot.queryParamMap.get('edit');
    if (!raw) return;

    const purchase = this.dataService.purchases().find(p => p.id === Number(raw));
    if (!purchase) {
      this.notify.error(
        this.prefs.txt('ক্রয় ভাউচার পাওয়া যায়নি।', 'Purchase voucher not found.'),
        this.prefs.txt('পাওয়া যায়নি', 'Not found')
      );
      this.router.navigate(['/purchases']);
      return;
    }

    this.editingPurchase = purchase;
    this.editPurchaseId.set(purchase.id);
    this.invoiceNo.set(purchase.invoice);
    this.supplierName = purchase.supplierName;
    this.selectedPartyId = this.dataService.partyForReference(purchase.partyId, purchase.supplierName)?.id ?? purchase.partyId;
    this.supplierQuery.set(purchase.supplierName);
    this.warehouse = purchase.warehouse;
    this.orderStatus = purchase.status;
    this.orderTax.set(purchase.orderTax || 'No Tax');
    this.purchaser = purchase.purchaser || 'Admin';
    this.installments = purchase.installments || 'None';
    this.paymentMode = purchase.paymentMode || 'Cash';
    this.purchaseDate = this.toInputDate(purchase.date) || localDateIso();
    this.nextPayDate = this.toInputDate(purchase.nextPayDate);
    this.items.set((purchase.items || []).map(item => ({ ...item })));
    this.discountType.set(purchase.discountType || 'fixed');
    this.discountValue.set(Number(purchase.discount) || 0);
    this.shipping.set(Number(purchase.shipping) || 0);
    this.paidAmount.set(Number(purchase.paid) || 0);
    this.notes = purchase.notes || '';
    this.showNote.set(!!purchase.notes);
  }

  private toInputDate(value?: string): string {
    if (!value || value === '-') return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
    return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : '';
  }

  numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  onProductSearch(value: string) {
    this.productSearch.set(value);
    this.showResults.set(value.trim().length > 0);
  }

  closeResults() {
    this.showResults.set(false);
    this.showSupplierResults.set(false);
  }

  onSupplierSearch(value: string) {
    this.supplierQuery.set(value);
    this.showSupplierResults.set(true);
    const exact = this.suppliers().find(supplier =>
      supplier.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    this.supplierName = exact ? exact.name : '';
  }

  selectSupplier(name: string, partyId?: number) {
    this.selectedPartyId = partyId ?? this.dataService.partyForReference(undefined, name)?.id;
    this.supplierName = name;
    this.supplierQuery.set(name);
    this.showSupplierResults.set(false);
  }

  selectFirstSupplier(event: Event) {
    event.preventDefault();
    const first = this.supplierResults()[0];
    if (first) this.selectSupplier(first.name);
  }

  addFirstResult(event: Event) {
    event.preventDefault();
    const first = this.results()[0];
    if (first) this.addOption(first);
  }

  addOption(option: ProductOption) {
    const product = option.product;
    const variant = option.variant;
    const existing = this.items().find(item =>
      item.productId === product.id && (item.variantId || 0) === (variant?.id || 0)
    );

    if (existing) {
      this.updateQuantity(existing.id, existing.quantity + 1);
    } else {
      const item: PurchaseItem = {
        id: this.dataService.newId(),
        productId: product.id,
        productName: option.label,
        itemCode: option.code,
        unit: product.unit,
        quantity: 1,
        purchasePrice: option.price,
        subtotal: option.price,
        variantId: variant?.id,
        variantValue: variant?.variantValue
      };
      this.items.update(list => [...list, item]);
    }

    this.productSearch.set('');
    this.showResults.set(false);
  }

  updateQuantity(itemId: number, value: number | Event) {
    const quantity = typeof value === 'number'
      ? value
      : this.numberValue((value.target as HTMLInputElement).value);
    this.items.update(list => list.map(item =>
      item.id === itemId
        ? { ...item, quantity, subtotal: Math.round(quantity * item.purchasePrice * 100) / 100 }
        : item
    ));
  }

  updatePrice(itemId: number, value: number | Event) {
    const price = typeof value === 'number'
      ? value
      : this.numberValue((value.target as HTMLInputElement).value);
    this.items.update(list => list.map(item =>
      item.id === itemId
        ? { ...item, purchasePrice: price, subtotal: Math.round(item.quantity * price * 100) / 100 }
        : item
    ));
  }

  removeItem(itemId: number) {
    this.items.update(list => list.filter(item => item.id !== itemId));
  }

  payFull() {
    this.paidAmount.set(this.grandTotal());
  }

  savePurchase() {
    try { this.performSavePurchase(); }
    catch (error) { this.notify.error(error instanceof Error ? error.message : 'Purchase rejected.'); }
  }

  private performSavePurchase() {
    if (this.voucher()) return;
    const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(this.purchaseDate) ? this.purchaseDate : '';
    if (!dateIso) {
      this.notify.error(
        this.prefs.txt('ক্রয়ের তারিখ সঠিকভাবে দিন (দিন/মাস/বছর)।', 'Enter a valid purchase date (dd/mm/yyyy).'),
        this.prefs.txt('তারিখ নেই', 'Missing date')
      );
      return;
    }
    const supplier = this.supplierName.trim();
    if (!supplier) {
      this.notify.error(
        this.prefs.txt('সরবরাহকারী বাছুন।', 'Please select a supplier.'),
        this.prefs.txt('সরবরাহকারী নেই', 'Missing supplier')
      );
      return;
    }
    if (!this.items().length) {
      this.notify.error(
        this.prefs.txt('ক্রয়ে অন্তত একটি পণ্য যোগ করুন।', 'Add at least one product to the purchase.'),
        this.prefs.txt('কোনো পণ্য নেই', 'No items')
      );
      return;
    }

    const invalid = this.items().find(item => item.quantity <= 0);
    if (invalid) {
      this.notify.error(
        this.prefs.txt(
          `"${invalid.productName}" এর পরিমাণ ০ এর বেশি হতে হবে।`,
          `Quantity for "${invalid.productName}" must be greater than zero.`
        ),
        this.prefs.txt('অসঠিক পরিমাণ', 'Invalid quantity')
      );
      return;
    }

    const invoice = this.invoiceNo().trim();
    if (!invoice) {
      this.notify.error(
        this.prefs.txt('ভাউচার নম্বর লিখুন।', 'Enter a voucher number.'),
        this.prefs.txt('ভাউচার নম্বর নেই', 'Missing voucher number')
      );
      return;
    }
    const editingId = this.editPurchaseId();
    const clash = this.dataService.purchases().find(p =>
      p.id !== editingId && (p.invoice || '').trim().toLowerCase() === invoice.toLowerCase()
    );
    if (clash) {
      this.notify.error(
        this.prefs.txt(
          `"${invoice}" ভাউচার নম্বরটি ইতিমধ্যে ব্যবহৃত হয়েছে। অন্য নম্বর দিন।`,
          `Voucher "${invoice}" is already in use. Enter a different number.`
        ),
        this.prefs.txt('ভাউচার নম্বর ব্যবহৃত', 'Voucher number taken')
      );
      return;
    }

    const total = this.grandTotal();
    if (this.paidAmount() > total) {
      this.notify.error(
        this.prefs.txt('পরিশোধিত টাকা ক্রয়ের সর্বমোটের চেয়ে বেশি হতে পারে না।', 'Paid amount cannot be greater than the purchase total.'),
        this.prefs.txt('অসঠিক পেমেন্ট', 'Invalid payment')
      );
      return;
    }

    const paid = Math.round(this.paidAmount() * 100) / 100;
    const due = Math.max(0, Math.round((total - paid) * 100) / 100);
    const now = new Date();
    // Stored dates on purchases are dd-mm-yyyy; the picker hands back ISO.
    const [isoYear, isoMonth, isoDay] = dateIso.split('-');
    const formattedDate = `${isoDay}-${isoMonth}-${isoYear}`;

    const payload: Omit<Purchase, 'id'> = {
      invoice,
      warehouse: this.warehouse,
      date: formattedDate,
      supplierName: supplier,
      partyId: this.selectedPartyId,
      preparedBy: this.editingPurchase?.preparedBy || 'Admin',
      status: this.orderStatus,
      total: Math.round(total * 100) / 100,
      paid,
      due: Math.round(due * 100) / 100,
      paymentStatus: paid <= 0 ? 'Unpaid' : due === 0 ? 'Paid' : 'Partially Paid',
      nextPayDate: this.nextPayDate || '-',
      notes: this.notes.trim(),
      items: this.items().map(item => ({ ...item })),
      orderTax: this.orderTax(),
      taxAmount: Math.round(this.taxAmount() * 100) / 100,
      purchaser: this.purchaser,
      installments: this.installments,
      discount: this.discountValue(),
      discountType: this.discountType(),
      shipping: this.shipping(),
      paymentMode: this.paymentMode,
      createdAt: this.editingPurchase?.createdAt || now.toISOString()
    };

    if (editingId !== null) {
      this.dataService.updatePurchase(editingId, payload);
      this.session.log('Purchase Updated', `${payload.invoice} — ${payload.status} — ${payload.total.toFixed(2)} TK`);
      this.notify.success(
        this.prefs.txt(`${payload.invoice} আপডেট হয়েছে এবং স্টক সমন্বয় হয়েছে।`, `${payload.invoice} updated and stock reconciled.`),
        this.prefs.txt('ক্রয় আপডেট হয়েছে', 'Purchase updated')
      );
      this.voucher.set({ ...payload, id: editingId });
      return;
    }

    const saved = this.dataService.recordPurchase(payload);
    this.session.log('Purchase Created', `${saved.invoice} — ${saved.status} — ${(saved.total || 0).toFixed(2)} TK`);

    const quantity = this.items().reduce((sum, item) => sum + item.quantity, 0);
    // Stock only moves on Received; pending stages must not claim they added stock.
    const stockNote = payload.status === 'Received'
      ? this.prefs.txt(` ${quantity} আইটেম স্টকে যোগ হয়েছে।`, ` ${quantity} item${quantity === 1 ? '' : 's'} added to stock.`)
      : this.prefs.txt(' ক্রয় গ্রহণ হলে স্টকে যোগ হবে।', ' Stock will be added once the purchase is received.');
    this.notify.success(
      this.prefs.txt(`${saved.invoice} সংরক্ষিত হয়েছে।${stockNote}`, `${saved.invoice} saved.${stockNote}`),
      this.prefs.txt('ক্রয় সংরক্ষিত হয়েছে', 'Purchase saved')
    );
    this.voucher.set(saved);
  }

  /** Anything the shopkeeper typed into this purchase but has not saved yet. */
  hasUnsavedWork(): boolean {
    if (this.leaving || this.voucher()) return false;
    return this.editPurchaseId() !== null
      || this.items().length > 0
      || this.supplierName.trim() !== ''
      || this.supplierQuery().trim() !== ''
      || this.discountValue() > 0
      || this.shipping() > 0
      || this.paidAmount() > 0
      || this.notes.trim() !== ''
      || this.orderTax() !== 'No Tax';
  }

  private leaving = false;

  async confirmLeave(): Promise<boolean> {
    if (!this.hasUnsavedWork()) return true;
    const leave = await this.notify.confirm(
      this.prefs.txt(
        'এই ক্রয় ভাউচারে আপনার দেওয়া তথ্য এখনো সেভ হয়নি। বের হলে সরবরাহকারী, পণ্য ও পেমেন্টের সব পরিবর্তন হারিয়ে যাবে।',
        'This purchase voucher has unsaved changes. If you leave, the supplier, product and payment changes will be lost.'
      ),
      {
        title: this.prefs.txt('পাতা ছেড়ে যাবেন?', 'Leave this page?'),
        kind: 'warning',
        confirmText: this.prefs.txt('হ্যাঁ, বের হন', 'Yes, leave'),
        cancelText: this.prefs.txt('এখানে থাকুন', 'Stay here')
      }
    );
    if (leave) this.leaving = true;
    return leave;
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (!this.hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  closeVoucher() {
    this.voucher.set(null);
    this.leaving = true;
    const savedDate = this.purchaseDate;
    this.router.navigate(
      ['/purchases'],
      savedDate ? { state: { purchaseDate: savedDate } } : {}
    );
  }

  goBack() {
    this.router.navigate(['/purchases']);
  }

  private loadWarehouses(): string[] {
    const saved = (this.dataService.warehouses() ?? []).filter(item => typeof item === 'string' && item.trim());
    return saved.length ? saved : ['SM Warehouse'];
  }

  private saveWarehouses(list: string[]) {
    this.dataService.warehouses.set(list);
  }
}
