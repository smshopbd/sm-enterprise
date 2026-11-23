import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import {
  DataService,
  CreditNoteItem,
  Party,
  Product,
  ProductVariant,
  SalesReturn,
  hasPartyRole,
  hasSalesRole,
  salesAccountOf
} from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { productSearchScore, variantLabel } from '../../../utils/product-search';
import { SessionService } from '../../../services/session';
import { ReturnNoteVoucher, ReturnNoteView } from '../../../components/return-note-voucher/return-note-voucher';
import { localDateIso } from '../../../utils/local-date';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';

interface CrOption {
  product: Product;
  variant?: ProductVariant;
  label: string;
  code: string;
  price: number;
  stock: number;
  variantInfo?: string;
}

interface CrLine {
  id: number;
  productId: number;
  productName: string;
  itemCode: string;
  unit: string;
  /** Base units per the returned unit; copied from the invoice line. */
  unitFactor?: number;
  quantity: number;
  unitPrice: number;
  total: number;
}

@Component({
  selector: 'app-sales-return-add',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, ReturnNoteVoucher, DmyDateDirective],
  template: `
    <div class="space-y-4 text-xs text-slate-800" (click)="closeResults()">

      <!-- Title bar -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl shadow-xs border border-slate-200">
        <div class="flex items-center gap-2 min-w-0">
          <button (click)="goBack()" class="p-1 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors shrink-0" [title]="prefs.txt('বিক্রয় ফেরতে ফিরে যান', 'Back to sales returns')">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <div class="min-w-0">
            <h1 class="text-base sm:text-lg font-bold text-slate-900 truncate">
              {{ editReturnId() !== null ? prefs.txt('বিক্রয় ফেরত সম্পাদনা', 'Edit Sales Return') : prefs.txt('বিক্রয় ফেরত / ক্রেডিট নোট', 'Sales Return / Cr. Note') }}
            </h1>
            <p class="text-[11px] text-slate-500 truncate">
              {{ prefs.txt('বিক্রয় / ফেরত', 'Sales / Return') }} — {{ prefs.txt('ক্রেডিট নোট', 'Cr. Note') }} #{{ creditNoteNo() }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button (click)="goBack()" class="border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold px-4 py-2 rounded-lg transition-all cursor-pointer">
            {{ viewOnly() ? prefs.txt('বন্ধ করুন', 'Close') : prefs.txt('বাতিল', 'Cancel') }}
          </button>
          @if (!viewOnly()) {
            <button (click)="openVoucher()" class="border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold px-4 py-2 rounded-lg flex items-center gap-1 transition-all cursor-pointer">
              <mat-icon class="text-sm">receipt_long</mat-icon> {{ prefs.txt('প্রিভিউ', 'Preview') }}
            </button>
            <button (click)="saveReturn()" class="justify-center bg-teal-700 hover:bg-teal-800 text-white font-extrabold px-5 py-2 rounded-lg flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer">
              <mat-icon class="text-sm">save</mat-icon> {{ editReturnId() !== null ? prefs.txt('আপডেট', 'Update') : prefs.txt('সংরক্ষণ', 'Save') }}
            </button>
          }
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] gap-4 items-start">

        <!-- Main entry column -->
        <div class="space-y-4 min-w-0">

          <!-- Customer / warehouse card -->
          <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="block font-bold text-slate-700 mb-1.5"><span class="text-rose-500">*</span> {{ prefs.txt('গ্রাহক', 'Customer') }}</label>
                <div class="flex items-center gap-1.5">
                  <div class="relative flex-1" (click)="$event.stopPropagation()">
                    <div class="flex items-center border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <mat-icon class="text-slate-400 text-sm mx-2 shrink-0">person</mat-icon>
                      <input
                        type="text"
                        [ngModel]="customerQuery()"
                        (ngModelChange)="onCustomerSearch($event)"
                        (focus)="showCustomerResults.set(true)"
                        (keydown.enter)="selectFirstCustomer($event)"
                        (keydown.escape)="showCustomerResults.set(false)"
                        [placeholder]="prefs.txt('গ্রাহকের নাম / ফোন দিয়ে খুঁজুন...', 'Search customer name / phone...')"
                        class="w-full bg-transparent outline-none py-2 font-semibold text-slate-800"
                      >
                      <button type="button" (click)="showCustomerResults.set(!showCustomerResults())" class="px-2 py-1 text-slate-400 hover:text-teal-700 cursor-pointer shrink-0" [title]="prefs.txt('গ্রাহক দেখুন', 'Show customers')">
                        <mat-icon class="text-base">expand_more</mat-icon>
                      </button>
                    </div>

                    @if (showCustomerResults()) {
                      <div class="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-40 max-h-64 overflow-y-auto">
                        @for (c of customerResults(); track c.id) {
                          <button
                            type="button"
                            (click)="selectCustomer(c)"
                            class="w-full text-left px-3 py-2 hover:bg-teal-50/70 border-b border-slate-100 last:border-0 flex items-center gap-2 cursor-pointer"
                          >
                            <span class="w-7 h-7 rounded-md bg-teal-50 border border-teal-100 text-teal-700 inline-flex items-center justify-center shrink-0">
                              <mat-icon class="text-sm">person</mat-icon>
                            </span>
                            <span class="min-w-0 flex-1">
                              <span class="block font-bold text-slate-800 truncate">{{ c.name }}</span>
                              @if (c.companyName && c.companyName !== c.name) {
                                <span class="block text-[10px] text-slate-400 truncate">{{ c.companyName }}</span>
                              }
                            </span>
                            @if (customerDueOf(c) > 0) {
                              <span class="text-[10px] font-mono text-rose-600 shrink-0">{{ prefs.txt('বকেয়া', 'Due') }} {{ customerDueOf(c) | number:'1.2-2' }}</span>
                            }
                          </button>
                        } @empty {
                          <p class="px-3 py-4 text-center text-slate-400">{{ prefs.txt('কোনো গ্রাহক পাওয়া যায়নি।', 'No customer found.') }}</p>
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

            <!-- Sales invoice picker -->
            <div>
              <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('বিক্রয় ইনভয়েস', 'Sales Invoice') }} <span class="text-[10px] font-medium text-slate-400">{{ prefs.txt('(বাছাই করলে গ্রাহক ও পণ্য বসে যাবে)', '(selecting fills customer and products)') }}</span></label>
              <div class="flex items-center gap-1.5">
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white flex-1 focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-2">receipt</mat-icon>
                  <select
                    [ngModel]="invoiceNumber()"
                    (ngModelChange)="pickInvoice($event)"
                    class="w-full bg-transparent outline-none font-mono font-semibold text-slate-800"
                  >
                    <option value="">{{ prefs.txt('— ইনভয়েস বাছুন (ঐচ্ছিক) —', '— Select invoice (optional) —') }}</option>
                    @for (s of saleOptions(); track s.invoice) {
                      <option [value]="s.invoice">{{ s.invoice }} • {{ s.customerName }} • {{ s.total | number:'1.2-2' }}</option>
                    }
                  </select>
                </div>
                @if (invoiceNumber()) {
                  <button (click)="clearInvoice()" class="h-10 px-3 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-600 font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer" [title]="prefs.txt('ইনভয়েস মুছুন', 'Clear invoice')">
                    <mat-icon class="text-sm">clear</mat-icon>
                  </button>
                }
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

            <!-- Scan barcode / IMEI -->
            <div class="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-2 items-end">
              <div class="lg:col-span-2">
                <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('বারকোড / IMEI স্ক্যান', 'Scan Barcode / IMEI') }}</label>
              </div>
              <div class="hidden lg:block"></div>
              <div class="flex items-center gap-1.5">
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white flex-1 focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-2">barcode</mat-icon>
                  <input
                    type="text"
                    [(ngModel)]="scanValue"
                    (keydown.enter)="addScannedItem($event)"
                    [placeholder]="prefs.txt('বারকোড / IMEI স্ক্যান করুন...', 'Scan Barcode / IMEI...')"
                    class="w-full bg-transparent outline-none font-mono font-medium"
                  >
                </div>
              </div>
            </div>
          </div>

          <!-- Items card -->
          <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full min-w-[720px] text-xs text-left border-collapse">
                <thead>
                  <tr class="bg-teal-600 text-white">
                    <th class="px-3 py-2.5 text-center w-12 font-bold uppercase tracking-wider text-[10px]">{{ prefs.txt('ক্রম', 'SL') }}</th>
                    <th class="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px]">{{ prefs.txt('পণ্য', 'Product') }}</th>
                    <th class="px-3 py-2.5 text-center w-24 font-bold uppercase tracking-wider text-[10px]">{{ prefs.txt('পরিমাণ', 'Quantity') }}</th>
                    <th class="px-3 py-2.5 text-center w-28 font-bold uppercase tracking-wider text-[10px]">{{ prefs.txt('ফেরত মূল্য', 'Return Price') }}</th>
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
                        <p class="mt-0.5 text-[10px] font-bold text-slate-400">{{ item.unit }}</p>
                      </td>
                      <td class="px-3 py-2 text-center">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          [value]="item.unitPrice"
                          (input)="updatePrice(item.id, $event)"
                          class="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-right font-mono font-semibold focus:border-teal-500 focus:outline-none"
                        >
                      </td>
                      <td class="px-3 py-2 text-right font-mono font-bold text-slate-800">{{ item.total | number:'1.2-2' }} TK</td>
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
                          <mat-icon class="text-3xl text-slate-300">assignment_return</mat-icon>
                          <p class="font-bold text-slate-500">{{ prefs.txt('কোনো পণ্য নেই', 'No data') }}</p>
                          <p class="text-[11px]">{{ prefs.txt('ফেরতের পণ্য যোগ করতে উপরে সার্চ করুন বা স্ক্যান করুন।', 'Search or scan a product above to add return items.') }}</p>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="flex items-center justify-end gap-6 bg-slate-100/80 border-t border-slate-200 px-4 py-2.5">
              <span class="font-black text-slate-500 uppercase tracking-wider text-[10px]">{{ prefs.txt('মোট:', 'Total:') }}</span>
              <span class="font-mono font-black text-lg text-teal-700">{{ subtotal() | number:'1.2-2' }} TK</span>
            </div>
          </div>

          <!-- Return details bar -->
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
                <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('ফেরতের কারণ', 'Return Reason') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-2">report</mat-icon>
                  <input
                    type="text"
                    [ngModel]="reason()"
                    (ngModelChange)="reason.set($event)"
                    [placeholder]="prefs.txt('যেমন: পণ্য খারাপ', 'e.g. Damaged product')"
                    class="w-full bg-transparent outline-none font-semibold"
                  >
                </div>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('ফেরতের তারিখ', 'Return Date') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-2">event</mat-icon>
                  <input type="date" appDmyDate [ngModel]="returnDate()" (ngModelChange)="returnDate.set($event)" class="w-full bg-transparent outline-none font-semibold">
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right sidebar -->
        <div class="space-y-4">
          <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
            <div>
              <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('অবস্থা', 'Status') }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">flag</mat-icon>
                <select [ngModel]="status()" (ngModelChange)="status.set($event)" class="w-full bg-transparent outline-none font-semibold text-slate-800">
                  <option value="Posted">{{ prefs.txt('পোস্টেড', 'Posted') }}</option>
                  <option value="Draft">{{ prefs.txt('খসড়া', 'Draft') }}</option>
                  <option value="Cancelled">{{ prefs.txt('বাতিল', 'Cancelled') }}</option>
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
              <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('ফেরত দিয়েছেন', 'Returned By') }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">person_pin</mat-icon>
                <select [ngModel]="returnedBy()" (ngModelChange)="returnedBy.set($event)" class="w-full bg-transparent outline-none font-semibold text-slate-800">
                  @for (person of staffNames(); track person) {
                    <option [value]="person">{{ person }}</option>
                  }
                </select>
              </div>
            </div>

            <label class="flex items-start gap-2 border border-slate-300 rounded-lg px-2.5 py-2 cursor-pointer hover:border-teal-500">
              <input type="checkbox" [ngModel]="restock()" (ngModelChange)="restock.set($event)" class="accent-teal-600 mt-0.5">
              <span class="leading-snug">
                <span class="block font-bold text-slate-700">{{ prefs.txt('স্টকে ফেরত', 'Restock') }}</span>
                <span class="block text-[10px] text-slate-500">{{ prefs.txt('পোস্টেড অবস্থায় ফেরত আসা পণ্য স্টকে যোগ হবে', 'Returned products will be added back to stock when posted') }}</span>
              </span>
            </label>

            <button (click)="showNote.set(!showNote())" class="w-full border border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/40 rounded-xl py-2 text-slate-600 hover:text-teal-700 font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer">
              <mat-icon class="text-sm">{{ showNote() ? 'remove' : 'add' }}</mat-icon> {{ showNote() ? prefs.txt('নোট লুকান', 'Hide Note') : prefs.txt('নোট যোগ করুন', 'Add Note') }}
            </button>
            @if (showNote()) {
              <textarea
                [ngModel]="note()"
                (ngModelChange)="note.set($event)"
                rows="3"
                [placeholder]="prefs.txt('ফেরতের নোট লিখুন...', 'Write return note...')"
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
              <div class="flex justify-between border-t border-slate-200 pt-1.5">
                <span class="font-bold text-slate-700">{{ prefs.txt('গ্রাহকের বকেয়া', 'Customer Due') }}</span>
                <span class="font-mono font-black text-rose-600">{{ customerDue() | number:'1.2-2' }} TK</span>
              </div>
              <p class="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 leading-relaxed">
                {{ prefs.txt('পোস্টেড করলে এই পরিমাণ ক্রেডিট নোট হিসেবে গ্রাহকের বকেয়া কমে যাবে।', 'Posting this will reduce the customer due by this amount as a credit note.') }}
              </p>
            </div>
            @if (!viewOnly()) {
              <div class="p-3 pt-0">
                <button (click)="saveReturn()" class="w-full bg-teal-700 hover:bg-teal-800 text-white font-extrabold py-2.5 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer">
                  <mat-icon class="text-sm">save</mat-icon> {{ editReturnId() !== null ? prefs.txt('ফেরত আপডেট করুন', 'Update Return') : prefs.txt('ফেরত সংরক্ষণ করুন', 'Save Return') }}
                </button>
              </div>
            }
          </div>
        </div>
      </div>
    </div>

    @if (voucher(); as saved) {
      <app-return-note-voucher [note]="saved" (close)="closeVoucher()" />
    }
  `
})
export class SalesReturnAdd implements OnInit {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  readonly prefs = inject(PreferencesService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private session = inject(SessionService);

  readonly creditNoteNo = signal(this.dataService.nextCreditNoteNo());
  readonly editReturnId = signal<number | null>(null);
  readonly viewOnly = signal(false);
  private editingReturn: SalesReturn | null = null;

  customer = signal<Party | null>(null);
  customerQuery = signal('');
  showCustomerResults = signal(false);
  warehouse = 'SM Warehouse';
  warehouses = signal<string[]>(this.loadWarehouses());

  invoiceNumber = signal('');
  returnDate = signal(this.today());
  reason = signal('');
  status = signal<'Posted' | 'Draft' | 'Cancelled'>('Posted');
  orderTax = signal('No Tax');
  restock = signal(true);
  returnedBy = signal(this.session.currentUser()?.name || this.dataService.voucherSettings().soldBy || 'Admin');

  productSearch = signal('');
  showResults = signal(false);
  scanValue = '';
  items = signal<CrLine[]>([]);
  private lineSeq = 1_000_000;

  discountType = signal<'fixed' | 'percent'>('fixed');
  discountValue = signal(0);
  shipping = signal(0);
  showNote = signal(false);
  note = signal('');

  voucher = signal<ReturnNoteView | null>(null);
  /** A preview drawer must not leave the form, but a saved note must not stay
   *  editable on a stale form either (saving twice would duplicate the note). */
  private voucherPreview = false;

  readonly taxOptions = ['No Tax', '5% VAT', '7.5% VAT', '10% VAT', '15% VAT'];

  customers = computed(() => this.dataService.parties().filter(party => hasSalesRole(party)));

  staffNames = computed(() => {
    const names = this.dataService.parties()
      .filter(party => hasPartyRole(party, 'Staff Member'))
      .map(party => party.name);
    return Array.from(new Set([this.returnedBy(), 'Admin', ...names]));
  });

  saleOptions = computed(() => this.dataService.sales());

  /** Old data can share an invoice number; prefer the newest sale, or the one
   *  belonging to the customer already picked on this form. */
  private saleForInvoice(invoice: string) {
    const sales = this.dataService.sales().filter(sale => sale.invoice === invoice);
    if (!sales.length) return undefined;
    const customerName = this.customer()?.name.trim().toLowerCase();
    const byCustomer = customerName
      ? sales.filter(sale => sale.customerName.trim().toLowerCase() === customerName)
      : [];
    return (byCustomer.length ? byCustomer : sales)
      .reduce((best, sale) => (sale.id > best.id ? sale : best));
  }

  customerResults = computed(() => {
    const query = this.customerQuery().trim().toLowerCase();
    const list = this.customers();
    if (!query) return list;
    return list.filter(customer =>
      customer.name.toLowerCase().includes(query) ||
      (customer.companyName || '').toLowerCase().includes(query) ||
      (customer.phone || '').toLowerCase().includes(query)
    );
  });

  private allOptions = computed<CrOption[]>(() =>
    this.dataService.products().flatMap(product => {
      const variants = product.variants || [];
      if (!variants.length) {
        return [{
          product,
          label: product.name,
          code: product.code,
          price: product.salesPrice || 0,
          stock: product.stock || 0
        }];
      }
      return variants.map(variant => ({
        product,
        variant,
        label: `${product.name} - ${variant.variantValue}`,
        code: variant.itemCode || product.code,
        price: variant.salesPrice || product.salesPrice || 0,
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

  subtotal = computed(() => this.items().reduce((sum, item) => sum + item.total, 0));

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

  customerDueOf(party: Party): number {
    return salesAccountOf(party).due;
  }

  customerDue = computed(() => {
    const selected = this.customer();
    if (selected) {
      const party = this.dataService.parties().find(item => item.id === selected.id);
      return party ? salesAccountOf(party).due : 0;
    }
    const sale = this.saleForInvoice(this.invoiceNumber());
    if (sale) return sale.due || 0;
    return 0;
  });

  ngOnInit() {
    const snapshot = this.route.snapshot;
    const viewId = Number(snapshot.queryParamMap.get('view'));
    const editId = Number(snapshot.queryParamMap.get('edit'));
    const target = viewId
      ? this.dataService.salesReturns().find(x => x.id === viewId)
      : editId
        ? this.dataService.salesReturns().find(x => x.id === editId)
        : null;

    if (viewId || editId) {
      if (!target) {
        this.notify.error(
          this.prefs.txt('বিক্রয় ফেরত রেকর্ড পাওয়া যায়নি।', 'Sales return record not found.'),
          this.prefs.txt('পাওয়া যায়নি', 'Not found')
        );
        this.router.navigate(['/sales/returns']);
        return;
      }
      this.viewOnly.set(!!viewId);
      this.loadRecord(target);
      if (viewId) this.voucher.set(this.buildView(target));
      return;
    }

    const invoice = snapshot.queryParamMap.get('invoice');
    if (invoice) this.pickInvoice(invoice);
  }

  private loadRecord(record: SalesReturn) {
    this.editingReturn = record;
    this.editReturnId.set(record.id);
    this.creditNoteNo.set(record.creditNoteNo);
    this.customer.set(this.customers().find(party => record.partyId
      ? party.id === record.partyId
      : party.name.trim().toLowerCase() === record.customerName.trim().toLowerCase()) ?? null);
    this.customerQuery.set(record.customerName);
    this.invoiceNumber.set(record.invoiceNumber || '');
    this.returnDate.set(record.date || this.today());
    this.reason.set(record.reason || '');
    this.status.set(record.status || 'Posted');
    this.orderTax.set(record.orderTax || 'No Tax');
    this.restock.set(!!record.restock);
    this.returnedBy.set(record.returnedBy || this.returnedBy());
    this.discountType.set(record.discountType || 'fixed');
    this.discountValue.set(Number(record.discount) || 0);
    this.shipping.set(Number(record.shipping) || 0);
    this.note.set(record.note || '');
    this.showNote.set(!!(record.note || '').trim());
    this.items.set(record.items.map((item) => {
      const options = this.allOptions();
      const option = options.find(o => o.label === item.productName)
        || options.find(o => o.product.id === item.productId || o.product.name === item.productName);
      const product = option?.product;
      const unitPrice = Number(item.unitPrice) || Number(option?.price ?? product?.salesPrice) || 0;
      const quantity = Number(item.quantity) || 0;
      return {
        id: this.lineSeq++,
        productId: product?.id ?? item.productId ?? 0,
        productName: item.productName,
        itemCode: item.itemCode || option?.code || product?.code || '',
        unit: item.unit || product?.unit || 'pcs',
        unitFactor: Number(item.unitFactor) > 0 ? Number(item.unitFactor) : 1,
        quantity,
        unitPrice,
        total: Number(item.total) || Math.round(quantity * unitPrice * 100) / 100
      };
    }));
  }

  pickInvoice(invoice: string) {
    this.invoiceNumber.set(invoice);
    if (!invoice) return;

    const sale = this.saleForInvoice(invoice);
    if (!sale) return;

    this.customer.set(this.customers().find(party =>
      party.name.trim().toLowerCase() === sale.customerName.trim().toLowerCase()
    ) ?? null);
    this.customerQuery.set(sale.customerName);
    this.showCustomerResults.set(false);
    if (sale.warehouse) this.warehouse = sale.warehouse;

    const lines: CrLine[] = sale.items.map((item) => {
      const option = this.allOptions().find(o => o.label === item.productName)
        || this.allOptions().find(o => o.product.id === item.productId || o.product.name === item.productName);
      const product = option?.product ?? this.dataService.products().find(p =>
        p.id === item.productId || p.name === item.productName
      );
      const unitPrice = Number(item.salesPrice) || Number(option?.price ?? product?.salesPrice) || 0;
      const quantity = Number(item.quantity) || 0;
      return {
        id: this.lineSeq++,
        productId: product?.id ?? 0,
        productName: item.productName,
        itemCode: option?.code || product?.code || '',
        unit: item.unit || product?.unit || 'pcs',
        unitFactor: Number(item.unitFactor) > 0 ? Number(item.unitFactor) : 1,
        quantity,
        unitPrice,
        total: Math.round(quantity * unitPrice * 100) / 100
      };
    });
    if (lines.length) this.items.set(lines);
  }

  clearInvoice() {
    this.invoiceNumber.set('');
  }

  today(): string {
    return localDateIso();
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
    this.showCustomerResults.set(false);
  }

  onCustomerSearch(value: string) {
    this.customerQuery.set(value);
    this.showCustomerResults.set(true);
    const exact = this.customers().find(customer =>
      customer.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    this.customer.set(exact ?? null);
  }

  selectCustomer(customer: Party) {
    this.customer.set(customer);
    this.customerQuery.set(customer.name);
    this.showCustomerResults.set(false);
  }

  selectFirstCustomer(event: Event) {
    event.preventDefault();
    const first = this.customerResults()[0];
    if (first) this.selectCustomer(first);
  }

  addFirstResult(event: Event) {
    event.preventDefault();
    const first = this.results()[0];
    if (first) this.addOption(first);
  }

  addOption(option: CrOption) {
    const product = option.product;
    const existing = this.items().find(item =>
      item.productId === product.id && item.itemCode === option.code);

    if (existing) {
      this.updateQuantity(existing.id, existing.quantity + 1);
    } else {
      const item: CrLine = {
        id: this.lineSeq++,
        productId: product.id,
        productName: option.label,
        itemCode: option.code,
        unit: product.unit,
        unitFactor: 1,
        quantity: 1,
        unitPrice: option.price,
        total: option.price
      };
      this.items.update(list => [...list, item]);
    }

    this.productSearch.set('');
    this.showResults.set(false);
  }

  addScannedItem(event?: Event) {
    event?.preventDefault();
    const code = this.scanValue.trim();
    if (!code) return;

    const query = code.toLowerCase();
    const found =
      this.allOptions().find(option => (option.code || '').toLowerCase() === query) ||
      this.allOptions().find(option => option.label.toLowerCase() === query);

    if (!found) {
      this.notify.warning(
        this.prefs.txt(`"${code}" এর জন্য কোনো পণ্য পাওয়া যায়নি। বারকোড / আইটেম কোড যাচাই করুন।`, `No product found for "${code}". Check the barcode / item code.`),
        this.prefs.txt('পণ্য পাওয়া যায়নি', 'Product not found')
      );
      return;
    }

    this.addOption(found);
    this.scanValue = '';
  }

  updateQuantity(itemId: number, value: number | Event) {
    const quantity = typeof value === 'number'
      ? value
      : this.numberValue((value.target as HTMLInputElement).value);
    this.items.update(list => list.map(item =>
      item.id === itemId
        ? { ...item, quantity, total: Math.round(quantity * item.unitPrice * 100) / 100 }
        : item
    ));
  }

  updatePrice(itemId: number, value: number | Event) {
    const price = typeof value === 'number'
      ? value
      : this.numberValue((value.target as HTMLInputElement).value);
    this.items.update(list => list.map(item =>
      item.id === itemId
        ? { ...item, unitPrice: price, total: Math.round(item.quantity * price * 100) / 100 }
        : item
    ));
  }

  removeItem(itemId: number) {
    this.items.update(list => list.filter(item => item.id !== itemId));
  }

  private payload() {
    const lines: CreditNoteItem[] = this.items().map(item => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: Math.round(item.unitPrice * 100) / 100,
      total: Math.round(item.total * 100) / 100,
      productId: item.productId,
      itemCode: item.itemCode,
      unit: item.unit,
      unitFactor: item.unitFactor && item.unitFactor > 0 ? item.unitFactor : 1
    }));

    return {
      creditNoteNo: this.creditNoteNo(),
      date: this.returnDate() || this.today(),
      invoiceNumber: this.invoiceNumber(),
      customerName: (this.customer()?.name || this.customerQuery()).trim(),
      partyId: this.customer()?.id,
      items: lines,
      amount: Math.round(this.grandTotal() * 100) / 100,
      reason: this.reason().trim(),
      note: this.note().trim(),
      restock: this.restock(),
      status: this.status(),
      discount: this.discountValue(),
      discountType: this.discountType(),
      shipping: this.shipping(),
      orderTax: this.orderTax(),
      taxAmount: Math.round(this.taxAmount() * 100) / 100,
      returnedBy: this.returnedBy()
    };
  }

  private validate(): boolean {
    if (!this.payload().customerName) {
      this.notify.error(
        this.prefs.txt('গ্রাহকের নাম দিন বা বাছুন।', 'Enter or select a customer name.'),
        this.prefs.txt('গ্রাহক নেই', 'Missing customer')
      );
      return false;
    }
    if (!this.items().length) {
      this.notify.error(
        this.prefs.txt('ফেরতে অন্তত একটি পণ্য যোগ করুন।', 'Add at least one product to the return.'),
        this.prefs.txt('পণ্য নেই', 'No items')
      );
      return false;
    }
    const invalid = this.items().find(item => item.quantity <= 0);
    if (invalid) {
      this.notify.error(
        this.prefs.txt(`"${invalid.productName}" এর পরিমাণ ০ এর বেশি হতে হবে।`, `Quantity for "${invalid.productName}" must be greater than 0.`),
        this.prefs.txt('ভুল পরিমাণ', 'Invalid quantity')
      );
      return false;
    }
    return true;
  }

  openVoucher() {
    if (this.voucher()) return;
    if (!this.validate()) return;
    const preview: SalesReturn = {
      ...this.payload(),
      id: this.editReturnId() ?? 0,
      createdAt: this.editingReturn?.createdAt ?? new Date().toISOString()
    };
    this.voucherPreview = true;
    this.voucher.set(this.buildView(preview));
  }

  saveReturn() {
    try { this.performSaveReturn(); }
    catch (error) { this.notify.error(error instanceof Error ? error.message : 'Return rejected.'); }
  }

  private performSaveReturn() {
    if (this.voucher()) return;
    if (!this.validate()) return;

    const input = this.payload();
    const editingId = this.editReturnId();

    if (editingId !== null) {
      const updated = this.dataService.updateSalesReturn(editingId, input);
      if (!updated) {
        this.notify.error(
          this.prefs.txt('রেকর্ড আপডেট করা যায়নি।', 'Could not update the record.'),
          this.prefs.txt('আপডেট ব্যর্থ', 'Update failed')
        );
        return;
      }
      this.notify.success(
        this.prefs.txt(`${updated.creditNoteNo} আপডেট হয়েছে।`, `${updated.creditNoteNo} updated.`),
        this.prefs.txt('ক্রেডিট নোট আপডেট', 'Credit note updated')
      );
      this.voucherPreview = false;
      this.leaving = true;
      this.voucher.set(this.buildView(updated));
      return;
    }

    const saved = this.dataService.recordSalesReturn({
      date: input.date,
      invoiceNumber: input.invoiceNumber,
      customerName: input.customerName,
      partyId: input.partyId,
      items: input.items,
      amount: input.amount,
      reason: input.reason,
      note: input.note,
      restock: input.restock,
      status: input.status,
      discount: input.discount,
      discountType: input.discountType,
      shipping: input.shipping,
      orderTax: input.orderTax,
      taxAmount: input.taxAmount,
      returnedBy: input.returnedBy
    });

    const restockNote = saved.restock && saved.status === 'Posted';
    this.notify.success(
      this.prefs.txt(
        `${saved.creditNoteNo} সংরক্ষিত হয়েছে। ${saved.items.length} পণ্য ফেরত${restockNote ? ', স্টকে যোগ হয়েছে' : ''}।`,
        `${saved.creditNoteNo} saved. ${saved.items.length} product(s) returned${restockNote ? ', added back to stock' : ''}.`
      ),
      this.prefs.txt('ক্রেডিট নোট সংরক্ষিত', 'Cr. Note saved')
    );
    this.voucherPreview = false;
    this.leaving = true;
    this.voucher.set(this.buildView(saved));
  }

  private buildView(record: SalesReturn): ReturnNoteView {
    const party = this.dataService.parties().find(p =>
      p.name.trim().toLowerCase() === (record.customerName || '').trim().toLowerCase()
    );
    const subtotal = Math.round((record.items || []).reduce((sum, item) =>
      sum + (item.total ?? item.quantity * (item.unitPrice ?? 0)), 0) * 100) / 100;

    return {
      kind: 'cr',
      sourceId: record.id,
      docNo: record.creditNoteNo,
      date: record.date,
      partyName: record.customerName,
      phone: party?.phone,
      address: party?.address,
      invoiceNumber: record.invoiceNumber,
      warehouse: this.warehouse,
      returnedBy: record.returnedBy,
      status: record.status,
      restock: record.restock,
      reason: record.reason,
      note: record.note ?? this.note(),
      lines: (record.items || []).map(item => ({
        productName: item.productName,
        itemCode: item.itemCode,
        quantity: item.quantity,
        unit: item.unit || 'pcs',
        unitPrice: item.unitPrice ?? 0,
        total: item.total ?? item.quantity * (item.unitPrice ?? 0)
      })),
      subtotal,
      discount: record.discountType === 'percent'
        ? Math.round(subtotal * (record.discount || 0) / 100 * 100) / 100
        : (record.discount || 0),
      shipping: record.shipping || 0,
      tax: record.taxAmount || 0,
      total: record.amount
    };
  }

  private leaving = false;

  /** Anything typed into this credit note but not saved yet. */
  hasUnsavedWork(): boolean {
    if (this.leaving || this.voucher()) return false;
    return this.editReturnId() !== null
      || this.items().length > 0
      || this.customer() !== null
      || this.customerQuery().trim() !== ''
      || this.invoiceNumber().trim() !== ''
      || this.reason().trim() !== ''
      || this.note().trim() !== ''
      || this.discountValue() > 0
      || this.shipping() > 0
      || this.orderTax() !== 'No Tax';
  }

  async confirmLeave(): Promise<boolean> {
    if (!this.hasUnsavedWork()) return true;
    const leave = await this.notify.confirm(
      this.prefs.txt(
        'এই ফেরত নোটে আপনার দেওয়া তথ্য এখনো সেভ হয়নি। বের হলে গ্রাহক, পণ্য ও ফেরতের সব পরিবর্তন হারিয়ে যাবে।',
        'This return note has unsaved changes. If you leave, the customer, product and return changes will be lost.'
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
    const leaveForm = !this.voucherPreview;
    this.voucherPreview = false;
    this.voucher.set(null);
    if (leaveForm) {
      this.leaving = true;
      this.router.navigate(['/sales/returns']);
    }
  }

  goBack() {
    this.router.navigate(['/sales/returns']);
  }

  private loadWarehouses(): string[] {
    const saved = (this.dataService.warehouses() ?? []).filter(item => typeof item === 'string' && item.trim());
    return saved.length ? saved : ['SM Warehouse', 'Main Warehouse', 'Branch Warehouse'];
  }

  private saveWarehouses(list: string[]) {
    this.dataService.warehouses.set(list);
  }
}
