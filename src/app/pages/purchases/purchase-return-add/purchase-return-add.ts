import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import {
  DataService,
  Party,
  Product,
  ProductVariant,
  SupplierReturn,
  SupplierReturnItem,
  hasPartyRole,
  hasPurchaseRole,
  purchaseAccountOf
} from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { productSearchScore, variantLabel } from '../../../utils/product-search';
import { ReturnNoteVoucher, ReturnNoteView } from '../../../components/return-note-voucher/return-note-voucher';
import { localDateIso } from '../../../utils/local-date';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';

interface ReturnOption {
  product: Product;
  variant?: ProductVariant;
  label: string;
  code: string;
  price: number;
  stock: number;
  variantInfo?: string;
}

interface ReturnLine {
  id: number;
  productId: number;
  productName: string;
  itemCode: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

@Component({
  selector: 'app-purchase-return-add',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, ReturnNoteVoucher, DmyDateDirective],
  template: `
    <div class="space-y-4 text-xs text-slate-800" (click)="closeResults()">

      <!-- Title bar -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl shadow-xs border border-slate-200">
        <div class="flex items-center gap-2 min-w-0">
          <button (click)="goBack()" class="p-1 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors shrink-0" [title]="prefs.txt('ক্রয় ফেরতে ফিরে যান', 'Back to purchase returns')">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <div class="min-w-0">
            <h1 class="text-base sm:text-lg font-bold text-slate-900 truncate">
              {{ !viewOnly() && editReturnId() !== null ? prefs.txt('ক্রয় ফেরত সম্পাদনা', 'Edit Purchase Return') : prefs.txt('ক্রয় ফেরত / ডেবিট নোট', 'Purchase Return / Dr. Note') }}
            </h1>
            <p class="text-[11px] text-slate-500 truncate">
              {{ prefs.txt('ক্রয় / ফেরত', 'Purchases / Return') }} — {{ prefs.txt('ডেবিট নোট', 'Dr. Note') }} #{{ returnNo() }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button (click)="goBack()" class="border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold px-4 py-2 rounded-lg transition-all cursor-pointer">
            {{ viewOnly() ? prefs.txt('বন্ধ করুন', 'Close') : prefs.txt('বাতিল', 'Cancel') }}
          </button>
          @if (!viewOnly()) {
            <button (click)="saveReturn()" class="justify-center bg-teal-700 hover:bg-teal-800 text-white font-extrabold px-5 py-2 rounded-lg flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer">
              <mat-icon class="text-sm">save</mat-icon> {{ editReturnId() !== null ? prefs.txt('আপডেট', 'Update') : prefs.txt('সংরক্ষণ', 'Save') }}
            </button>
          }
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] gap-4 items-start">

        <!-- Main entry column -->
        <div class="space-y-4 min-w-0">

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
                            (click)="selectSupplier(s)"
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
                            @if (s.due > 0) {
                              <span class="text-[10px] font-mono text-rose-600 shrink-0">{{ prefs.txt('পাওনা', 'Due') }} {{ s.due | number:'1.2-2' }}</span>
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
                          <p class="text-[11px]">{{ prefs.txt('ফেরতের পণ্য যোগ করতে উপরে সার্চ করুন।', 'Search above to add return items.') }}</p>
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
                <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('ক্রয় ইনভয়েস', 'Purchase Invoice') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-2">receipt</mat-icon>
                  <input
                    type="text"
                    [(ngModel)]="invoiceNumber"
                    list="dr-note-invoices"
                    placeholder="PUR-1001"
                    class="w-full bg-transparent outline-none font-mono font-semibold"
                  >
                  <datalist id="dr-note-invoices">
                    @for (inv of invoiceOptions(); track inv) {
                      <option [value]="inv"></option>
                    }
                  </datalist>
                </div>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('ফেরতের তারিখ', 'Return Date') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-2">event</mat-icon>
                  <input type="date" appDmyDate [(ngModel)]="returnDate" class="w-full bg-transparent outline-none font-semibold">
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right sidebar -->
        <div class="space-y-4">
          <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
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
                <select [(ngModel)]="returnedBy" class="w-full bg-transparent outline-none font-semibold text-slate-800">
                  @for (person of staffNames(); track person) {
                    <option [value]="person">{{ person }}</option>
                  }
                </select>
              </div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1.5">{{ prefs.txt('ফেরতের কারণ', 'Return Reason') }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">report</mat-icon>
                <input
                  type="text"
                  [(ngModel)]="reason"
                  [placeholder]="prefs.txt('যেমন: ভুল পণ্য পাঠানো হয়েছে', 'e.g. Wrong product delivered')"
                  class="w-full bg-transparent outline-none font-semibold"
                >
              </div>
            </div>

            <button (click)="showNote.set(!showNote())" class="w-full border border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/40 rounded-xl py-2 text-slate-600 hover:text-teal-700 font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer">
              <mat-icon class="text-sm">{{ showNote() ? 'remove' : 'add' }}</mat-icon> {{ showNote() ? prefs.txt('নোট লুকান', 'Hide Note') : prefs.txt('নোট যোগ করুন', 'Add Note') }}
            </button>
            @if (showNote()) {
              <textarea
                [(ngModel)]="notes"
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
                <span class="font-bold text-slate-700">{{ prefs.txt('সরবরাহকারীর পাওনা', 'Supplier Due') }}</span>
                <span class="font-mono font-black text-rose-600">{{ supplierDue() | number:'1.2-2' }} TK</span>
              </div>
              <p class="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 leading-relaxed">
                {{ prefs.txt('সংরক্ষণ করলে এই পরিমাণ ডেবিট নোট হিসেবে সরবরাহকারীর পাওনা কমে যাবে এবং পণ্যের স্টক কমবে।', 'Saving this will reduce the supplier due as a debit note and decrease product stock.') }}
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
export class PurchaseReturnAdd implements OnInit {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  readonly prefs = inject(PreferencesService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly returnNo = signal(this.dataService.nextSupplierReturnNo());
  readonly editReturnId = signal<number | null>(null);
  readonly viewOnly = signal(false);
  private editingReturn: SupplierReturn | null = null;

  supplier = signal<Party | null>(null);
  supplierQuery = signal('');
  showSupplierResults = signal(false);
  warehouse = 'SM Warehouse';
  warehouses = signal<string[]>(this.loadWarehouses());

  orderTax = signal('No Tax');
  returnedBy = 'Admin';
  invoiceNumber = '';
  returnDate = this.today();
  reason = '';

  productSearch = signal('');
  showResults = signal(false);
  items = signal<ReturnLine[]>([]);
  private lineSeq = 1_000_000;

  discountType = signal<'fixed' | 'percent'>('fixed');
  discountValue = signal(0);
  shipping = signal(0);
  showNote = signal(false);
  notes = '';

  voucher = signal<ReturnNoteView | null>(null);

  readonly taxOptions = ['No Tax', '5% VAT', '7.5% VAT', '10% VAT', '15% VAT'];

  suppliers = computed(() => this.dataService.parties().filter(party => hasPurchaseRole(party)));

  staffNames = computed(() => {
    const names = this.dataService.parties()
      .filter(party => hasPartyRole(party, 'Staff Member'))
      .map(party => party.name);
    return ['Admin', ...Array.from(new Set(names))];
  });

  invoiceOptions = computed(() => this.dataService.purchases().map(purchase => purchase.invoice));

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

  private allOptions = computed<ReturnOption[]>(() =>
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

  supplierDue = computed(() => {
    const selected = this.supplier();
    if (!selected) return 0;
    const party = this.dataService.parties().find(item => item.id === selected.id);
    return party ? purchaseAccountOf(party).due : 0;
  });

  ngOnInit() {
    const snapshot = this.route.snapshot;
    const viewId = Number(snapshot.queryParamMap.get('view'));
    const editId = Number(snapshot.queryParamMap.get('edit'));
    const targetId = viewId || editId;
    if (!targetId) return;

    const record = this.dataService.supplierReturns().find(r => r.id === targetId);
    if (!record) {
      this.notify.error(
        this.prefs.txt('ফেরত রেকর্ড পাওয়া যায়নি।', 'Return record not found.'),
        this.prefs.txt('পাওয়া যায়নি', 'Not found')
      );
      this.router.navigate(['/purchases/returns']);
      return;
    }

    this.viewOnly.set(!!viewId);
    this.loadRecord(record);
    if (viewId) this.voucher.set(this.buildView(record));
  }

  private loadRecord(record: SupplierReturn) {
    this.editingReturn = record;
    this.editReturnId.set(record.id);
    this.returnNo.set(record.returnNo);
    this.supplier.set(this.dataService.parties().find(party => party.id === record.partyId) ?? null);
    this.supplierQuery.set(record.partyName);
    this.warehouse = record.warehouse || 'SM Warehouse';
    this.orderTax.set(record.orderTax || 'No Tax');
    this.returnedBy = record.returnedBy || 'Admin';
    this.invoiceNumber = record.invoiceNumber || '';
    this.returnDate = record.date;
    this.reason = record.reason || '';
    this.discountType.set(record.discountType || 'fixed');
    this.discountValue.set(Number(record.discount) || 0);
    this.shipping.set(Number(record.shipping) || 0);
    this.notes = record.note || '';
    this.showNote.set(!!record.note);
    this.items.set((record.items || []).map((item) => {
      const options = this.allOptions();
      const option = options.find(o => o.label === item.productName)
        || options.find(o => o.product.id === item.productId || o.product.name === item.productName);
      const product = option?.product ?? this.dataService.products().find(p => p.id === item.productId);
      const unitPrice = Number(item.unitPrice) || Number(option?.price ?? product?.purchasePrice) || 0;
      const quantity = Number(item.quantity) || 0;
      return {
        id: this.lineSeq++,
        productId: product?.id ?? item.productId ?? 0,
        productName: item.productName,
        itemCode: item.itemCode || option?.code || product?.code || '',
        unit: item.unit || product?.unit || 'pcs',
        quantity,
        unitPrice,
        total: Number(item.total) || Math.round(quantity * unitPrice * 100) / 100
      };
    }));
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
    this.showSupplierResults.set(false);
  }

  onSupplierSearch(value: string) {
    this.supplierQuery.set(value);
    this.showSupplierResults.set(true);
    const exact = this.suppliers().find(supplier =>
      supplier.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    this.supplier.set(exact ?? null);
  }

  selectSupplier(supplier: Party) {
    this.supplier.set(supplier);
    this.supplierQuery.set(supplier.name);
    this.showSupplierResults.set(false);
  }

  selectFirstSupplier(event: Event) {
    event.preventDefault();
    const first = this.supplierResults()[0];
    if (first) this.selectSupplier(first);
  }

  addFirstResult(event: Event) {
    event.preventDefault();
    const first = this.results()[0];
    if (first) this.addOption(first);
  }

  addOption(option: ReturnOption) {
    const product = option.product;
    const existing = this.items().find(item =>
      item.productId === product.id && item.itemCode === option.code);

    if (existing) {
      this.updateQuantity(existing.id, existing.quantity + 1);
    } else {
      const item: ReturnLine = {
        id: this.lineSeq++,
        productId: product.id,
        productName: option.label,
        itemCode: option.code,
        unit: product.unit,
        quantity: 1,
        unitPrice: option.price,
        total: option.price
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

  saveReturn() {
    try { this.performSaveReturn(); }
    catch (error) { this.notify.error(error instanceof Error ? error.message : 'Return rejected.'); }
  }

  private performSaveReturn() {
    if (this.voucher()) return;
    const supplier = this.supplier();
    if (!supplier) {
      this.notify.error(
        this.prefs.txt('সরবরাহকারী বাছুন।', 'Select a supplier.'),
        this.prefs.txt('সরবরাহকারী নেই', 'Missing supplier')
      );
      return;
    }
    if (!this.items().length) {
      this.notify.error(
        this.prefs.txt('ফেরতে অন্তত একটি পণ্য যোগ করুন।', 'Add at least one product to the return.'),
        this.prefs.txt('পণ্য নেই', 'No items')
      );
      return;
    }

    const invalid = this.items().find(item => item.quantity <= 0);
    if (invalid) {
      this.notify.error(
        this.prefs.txt(`"${invalid.productName}" এর পরিমাণ ০ এর বেশি হতে হবে।`, `Quantity for "${invalid.productName}" must be greater than 0.`),
        this.prefs.txt('ভুল পরিমাণ', 'Invalid quantity')
      );
      return;
    }

    // Editing reverses the old note's stock before applying this one, so the
    // quantity it already took out counts towards what can be returned again.
    const returnedBefore = new Map<number, number>();
    const oldStatus = (this.editingReturn?.status || '').trim().toLowerCase();
    if (this.editReturnId() !== null && oldStatus !== 'draft' && oldStatus !== 'cancelled' && oldStatus !== 'canceled') {
      for (const line of this.editingReturn?.items || []) {
        if (line.productId == null) continue;
        returnedBefore.set(line.productId, (returnedBefore.get(line.productId) || 0) + (Number(line.quantity) || 0));
      }
    }
    const overStock = this.items().find(item => {
      const product = this.dataService.products().find(p => p.id === item.productId);
      if (!product || product.type === 'service') return false;
      const available = (product.stock || 0) + (returnedBefore.get(item.productId) || 0);
      return item.quantity > available + 0.0001;
    });
    if (overStock) {
      // The service refuses to take stock below zero, so stop here instead of
      // letting the save throw after the warning looked like a soft notice.
      const available = (this.stockOf(overStock.productId) || 0) + (returnedBefore.get(overStock.productId) || 0);
      this.notify.error(
        this.prefs.txt(
          `"${overStock.productName}" ফেরতের পরিমাণ (${overStock.quantity}) স্টকের (${available}) বেশি — পরিমাণ কমিয়ে আবার চেষ্টা করুন।`,
          `Return quantity for "${overStock.productName}" (${overStock.quantity}) exceeds stock (${available}). Reduce the quantity and try again.`
        ),
        this.prefs.txt('স্টক অপর্যাপ্ত', 'Insufficient stock')
      );
      return;
    }

    const total = Math.round(this.grandTotal() * 100) / 100;
    const lines: SupplierReturnItem[] = this.items().map(item => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      itemCode: item.itemCode,
      unit: item.unit,
      unitPrice: Math.round(item.unitPrice * 100) / 100,
      total: Math.round(item.total * 100) / 100
    }));

    const payload = {
      partyId: supplier.id,
      partyName: supplier.name,
      amount: total,
      date: this.returnDate || this.today(),
      note: this.notes.trim(),
      items: lines,
      invoiceNumber: this.invoiceNumber.trim(),
      reason: this.reason.trim(),
      warehouse: this.warehouse,
      discount: this.discountValue(),
      discountType: this.discountType(),
      shipping: this.shipping(),
      orderTax: this.orderTax(),
      taxAmount: Math.round(this.taxAmount() * 100) / 100,
      returnedBy: this.returnedBy
    };

    const editingId = this.editReturnId();
    if (editingId !== null) {
      this.dataService.updateSupplierReturn(editingId, payload);
      this.notify.success(
        this.prefs.txt(`${this.returnNo()} আপডেট হয়েছে, স্টক ও হিসাব সমন্বয় হয়েছে।`, `${this.returnNo()} updated, stock and accounts adjusted.`),
        this.prefs.txt('ফেরত আপডেট', 'Return updated')
      );
      this.leaving = true;
      this.voucher.set(this.buildView({ ...payload, id: editingId, returnNo: this.returnNo(), createdAt: this.editingReturn?.createdAt || new Date().toISOString() }));
      return;
    }

    const saved = this.dataService.recordSupplierReturn(payload);
    this.notify.success(
      this.prefs.txt(`${saved.returnNo} সংরক্ষিত হয়েছে। ${this.items().length} পণ্য ফেরত, স্টক কমেছে।`, `${saved.returnNo} saved. ${this.items().length} product(s) returned, stock reduced.`),
      this.prefs.txt('ডেবিট নোট সংরক্ষিত', 'Dr. Note saved')
    );
    this.leaving = true;
    this.voucher.set(this.buildView(saved));
  }

  private stockOf(productId: number): number {
    return this.dataService.products().find(p => p.id === productId)?.stock ?? 0;
  }

  private buildView(record: SupplierReturn): ReturnNoteView {
    const party = this.dataService.parties().find(p => p.id === record.partyId);
    return {
      kind: 'dr',
      sourceId: record.id,
      docNo: record.returnNo,
      date: record.date,
      partyName: record.partyName,
      phone: party?.phone,
      address: party?.address,
      invoiceNumber: record.invoiceNumber,
      warehouse: record.warehouse,
      returnedBy: record.returnedBy,
      reason: record.reason,
      note: record.note,
      lines: (record.items || []).map(item => ({
        productName: item.productName,
        itemCode: item.itemCode,
        quantity: item.quantity,
        unit: item.unit || 'pcs',
        unitPrice: item.unitPrice ?? 0,
        total: item.total ?? item.quantity * (item.unitPrice ?? 0)
      })),
      subtotal: Math.round((record.items || []).reduce((sum, item) => sum + (item.total ?? item.quantity * (item.unitPrice ?? 0)), 0) * 100) / 100,
      discount: record.discountType === 'percent'
        ? Math.round(((record.items || []).reduce((sum, item) => sum + (item.total ?? 0), 0)) * (record.discount || 0) / 100 * 100) / 100
        : (record.discount || 0),
      shipping: record.shipping || 0,
      tax: record.taxAmount || 0,
      total: record.amount
    };
  }

  private leaving = false;

  /** Anything typed into this debit note but not saved yet. */
  hasUnsavedWork(): boolean {
    if (this.leaving || this.voucher()) return false;
    return this.editReturnId() !== null
      || this.items().length > 0
      || this.supplier() !== null
      || this.supplierQuery().trim() !== ''
      || this.invoiceNumber.trim() !== ''
      || this.reason.trim() !== ''
      || this.notes.trim() !== ''
      || this.discountValue() > 0
      || this.shipping() > 0
      || this.orderTax() !== 'No Tax';
  }

  async confirmLeave(): Promise<boolean> {
    if (!this.hasUnsavedWork()) return true;
    const leave = await this.notify.confirm(
      this.prefs.txt(
        'এই ফেরত নোটে আপনার দেওয়া তথ্য এখনো সেভ হয়নি। বের হলে সরবরাহকারী, পণ্য ও ফেরতের সব পরিবর্তন হারিয়ে যাবে।',
        'This return note has unsaved changes. If you leave, the supplier, product and return changes will be lost.'
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
    this.router.navigate(['/purchases/returns']);
  }

  goBack() {
    this.router.navigate(['/purchases/returns']);
  }

  private loadWarehouses(): string[] {
    const saved = (this.dataService.warehouses() ?? []).filter(item => typeof item === 'string' && item.trim());
    return saved.length ? saved : ['SM Warehouse', 'Main Warehouse', 'Branch Warehouse'];
  }

  private saveWarehouses(list: string[]) {
    this.dataService.warehouses.set(list);
  }
}
