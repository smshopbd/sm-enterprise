import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule, formatNumber } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import {
  BATTERY_KINDS,
  BatteryAdjustmentItem,
  BatteryKind,
  BatteryUnit,
  DataService,
  Party,
  Product,
  ProductVariant,
  Sale,
  SaleItem,
  SalesReturnItem,
  WarrantyClaimInfo,
  hasPartyRole,
  hasSalesRole,
  salesAccountOf
} from '../../../services/data';
import { ProductSearchEntry, searchProductEntries, variantLabel } from '../../../utils/product-search';
import { productUnitChoices, saleLineBaseQty, unitChoiceOf, unitFactorOf, unitPriceOf } from '../../../utils/product-units';
import { NotificationService } from '../../../services/notification';
import { OrderLockService } from '../../../services/order-lock';
import { SessionService } from '../../../services/session';
import { PreferencesService } from '../../../services/preferences';
import { PasscodeModal } from '../../../components/passcode-modal/passcode-modal';
import { BarcodeScanner } from '../../../components/barcode-scanner/barcode-scanner';
import { findScanMatch } from '../../../utils/barcode-scan';
import { CanLeave } from '../../../guards/unsaved-changes';
import { dmyFromIso, isoFromDmy, localDateIso } from '../../../utils/local-date';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';
import { formatQtyInput, roundQty } from '../../../utils/quantity';
import { WARRANTY_STATUS_IN_PROGRESS } from '../../../utils/warranty';

@Component({
  selector: 'app-add-sale',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, PasscodeModal, DmyDateDirective, BarcodeScanner],
  template: `
    <div class="space-y-4 text-xs text-slate-800" (click)="onDocumentClick($event)">

      <!-- 1. Title Bar -->
      <div class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <button (click)="goBack()" class="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl bg-white/15 ring-1 ring-white/25 transition-colors hover:bg-white/25" [title]="prefs.txt('ফিরে যান', 'Go back')">
              <mat-icon class="text-lg">arrow_back</mat-icon>
            </button>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                <span>{{ prefs.txt('বিক্রয়', 'Sales') }}</span>
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                <span>{{ editSaleId() !== null ? prefs.txt('সম্পাদনা', 'Edit') : prefs.txt('নতুন বিক্রয়', 'New sale') }}</span>
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">
                {{ editSaleId() !== null ? prefs.txt('বিক্রয় সম্পাদনা', 'Edit Sale') : prefs.txt('নতুন বিক্রয়', 'Add New Sale') }}
              </h1>
              <p class="truncate text-[11px] text-teal-50/85">
                @if (editSaleId() !== null) {
                  {{ prefs.txt('ভাউচার অনুযায়ী সম্পূর্ণ বিক্রয় তথ্য হালনাগাদ করুন', 'Update the full sale entry per voucher') }}
                } @else {
                  {{ prefs.txt('ভাউচার অনুযায়ী সম্পূর্ণ বিক্রয় তথ্য এন্ট্রি করুন', 'Full sale entry per voucher') }}
                }
              </p>
            </div>
          </div>
          <span class="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 font-mono text-[11px] font-bold backdrop-blur-sm">
            <mat-icon class="text-sm text-teal-100">receipt_long</mat-icon>
            {{ prefs.txt('ভাউচার', 'Voucher') }} #{{ voucherNo }}
          </span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">

        <!-- LEFT: Entry Sections -->
        <div class="space-y-4 min-w-0">

          <!-- 2. Customer & Voucher -->
          <div class="bg-white p-4 rounded-xl shadow-xs border border-slate-200 space-y-3">
            <h3 class="font-bold text-slate-900 text-sm border-b pb-2 flex items-center justify-between gap-2">
              <span class="flex items-center gap-1.5">
                <mat-icon class="text-teal-600 text-sm">person</mat-icon>
                {{ prefs.txt('গ্রাহক ও ভাউচার', 'Customer & Voucher') }}
              </span>
              <div class="flex items-center gap-2 shrink-0">
                @if (showWholesaleSwitch()) {
                  <label
                    class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border cursor-pointer select-none transition-colors"
                    [class]="wholesaleMode
                      ? 'border-sky-300 bg-sky-50 text-sky-700'
                      : 'border-slate-200 bg-white text-slate-500'"
                    [title]="isDealerCustomer()
                      ? prefs.txt('ডিলার পার্টি — পণ্যের দাম পাইকারি মূল্য থেকে বসবে; প্রতিটি লাইনে দাম বদলানো যাবে', 'Dealer party — item prices come from the wholesale rate; each line can still be edited')
                      : prefs.txt('এই বিক্রয়ে পাইকারি মূল্য ব্যবহার করুন', 'Use wholesale price for this sale')"
                  >
                    <input
                      type="checkbox"
                      [checked]="wholesaleMode"
                      [disabled]="isDealerCustomer()"
                      (change)="setWholesaleMode($any($event.target).checked)"
                      class="w-3.5 h-3.5 accent-sky-600 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <span class="text-[10px] font-bold">{{ prefs.txt('পাইকারি', 'Wholesale') }}</span>
                  </label>
                }
                <input
                  id="customer-edit-toggle"
                  type="checkbox"
                  [(ngModel)]="customerEditEnabled"
                  class="w-4 h-4 accent-teal-600 cursor-pointer"
                  [attr.aria-label]="prefs.txt('গ্রাহকের তথ্য এডিট করুন', 'Edit customer details')"
                />
                <label for="customer-edit-toggle" class="text-[10px] font-bold text-slate-600 cursor-pointer" [title]="prefs.txt('চেক করলে গ্রাহকের তথ্য এডিট করা যাবে', 'Check to edit customer details')">{{ prefs.txt('এডিট', 'Edit') }}</label>
              </div>
            </h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div class="relative" id="customer-search-container">
                <label class="block font-bold text-rose-600 mb-1">* {{ prefs.txt('গ্রাহক', 'Customer') }}</label>
                <div class="relative">
                  <mat-icon class="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-base">person_search</mat-icon>
                  <input
                    type="text"
                    id="customer-search-input"
                    autocomplete="off"
                    [placeholder]="prefs.txt('গ্রাহক খুঁজুন', 'Search customer')"
                    [value]="customerPickerOpen() ? customerQuery() : customerName"
                    (focus)="openCustomerPicker()"
                    (click)="openCustomerPicker()"
                    (input)="onCustomerSearchInput($event)"
                    (keydown)="onCustomerKeydown($event)"
                    class="w-full border border-slate-300 rounded-lg py-2 pl-8 pr-8 bg-white font-semibold focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />
                  @if (customerName && customerName !== 'Walk In Customer') {
                    <button
                      type="button"
                      (click)="clearCustomer($event)"
                      class="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-rose-600 rounded"
                      [title]="prefs.txt('গ্রাহক মুছুন', 'Clear customer')"
                    >
                      <mat-icon class="text-base">close</mat-icon>
                    </button>
                  }
                </div>

                @if (customerPickerOpen()) {
                  <div class="absolute z-40 mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl max-h-64 overflow-y-auto">
                    <button
                      type="button"
                      (click)="selectCustomer('Walk In Customer')"
                      class="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-teal-50 transition-colors border-b border-slate-100"
                      [class.bg-teal-50]="customerName === 'Walk In Customer'"
                    >
                      <span class="w-7 h-7 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                        <mat-icon class="text-base">directions_walk</mat-icon>
                      </span>
                      <span class="font-bold text-slate-800">{{ prefs.txt('সাধারণ ক্রেতা (ওয়াক-ইন)', 'Walk In Customer') }}</span>
                    </button>

                    @for (p of customerResults(); track p.id) {
                      <button
                        type="button"
                        (click)="selectCustomer(p.name, p.id)"
                        class="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-teal-50 transition-colors border-b border-slate-50 last:border-0"
                        [class.bg-teal-50]="customerName === p.name"
                      >
                        <span class="w-7 h-7 rounded-full bg-teal-600 text-white font-bold flex items-center justify-center shrink-0 uppercase">
                          {{ p.name.charAt(0) }}
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block font-bold text-slate-800 truncate">{{ p.name }}</span>
                          <span class="block text-[10px] text-slate-500 truncate">
                            {{ p.companyName && p.companyName !== 'N/A' ? p.companyName + ' · ' : '' }}{{ p.phone || prefs.txt('ফোন নেই', 'No phone') }}
                          </span>
                        </span>
                        @if (dueOf(p) > 0) {
                          <span class="text-[10px] font-bold text-rose-600 shrink-0">{{ prefs.txt('বাকি', 'Due') }} {{ dueOf(p) | number:'1.2-2' }}</span>
                        }
                      </button>
                    }

                    @if (!customerResults().length) {
                      <div class="px-3 py-4 text-center text-slate-400">
                        <mat-icon class="text-2xl">person_off</mat-icon>
                        <p class="font-semibold">{{ prefs.txt('এই নামে কোনো গ্রাহক পাওয়া যায়নি', 'No customer found with this name') }}</p>
                      </div>
                    }
                  </div>
                }
              </div>

              @if (customerEditEnabled) {
                <div>
                  <label class="block font-bold text-teal-800 mb-1">* {{ prefs.txt('ভাউচার নাম্বার', 'Voucher No') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="voucherNo"
                    [class.border-rose-500]="isDuplicateVoucher()"
                    [class.bg-rose-50]="isDuplicateVoucher()"
                    class="w-full border-2 border-slate-300 rounded-lg p-2 font-mono font-bold text-xs focus:border-teal-500 focus:outline-none"
                  />
                  @if (isDuplicateVoucher()) {
                    <p class="text-[10px] text-rose-600 font-bold mt-0.5">{{ prefs.txt('এই ভাউচার নাম্বার আগেই ব্যবহৃত হয়েছে', 'This voucher number is already used') }}</p>
                  }
                </div>

                <div>
                  <label class="block font-bold text-teal-800 mb-1">* {{ prefs.txt('তারিখ', 'Date') }} (dd/mm/yyyy)</label>
                  <div class="flex gap-1">
                    <input
                      type="text"
                      inputmode="numeric"
                      placeholder="dd/mm/yyyy"
                      [value]="saleDateText"
                      (input)="onSaleDateText($event)"
                      (blur)="commitSaleDate()"
                      class="w-full border border-slate-300 focus:border-teal-500 rounded-lg p-2 font-semibold bg-white font-mono"
                    />
                    <button type="button" (click)="saleDatePicker.showPicker()" class="shrink-0 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 flex items-center cursor-pointer" [title]="prefs.txt('ক্যালেন্ডার', 'Calendar')">
                      <mat-icon class="text-base">calendar_month</mat-icon>
                    </button>
                    <input #saleDatePicker type="date" [value]="saleDate" (change)="onSaleDatePicked($event)" class="hidden" />
                  </div>
                </div>

                <div>
                  <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('পরবর্তী পেমেন্টের তারিখ', 'Next Payment Date') }} (dd/mm/yyyy)</label>
                  <div class="flex gap-1">
                    <input
                      type="text"
                      inputmode="numeric"
                      placeholder="dd/mm/yyyy"
                      [value]="nextPaymentText"
                      (input)="onNextPaymentText($event)"
                      (blur)="commitNextPayment()"
                      class="w-full border border-slate-300 focus:border-teal-500 rounded-lg p-2 font-semibold bg-white font-mono"
                    />
                    <button type="button" (click)="nextPaymentPicker.showPicker()" class="shrink-0 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 flex items-center cursor-pointer" [title]="prefs.txt('ক্যালেন্ডার', 'Calendar')">
                      <mat-icon class="text-base">calendar_month</mat-icon>
                    </button>
                    <input #nextPaymentPicker type="date" [value]="nextPaymentDate" (change)="onNextPaymentPicked($event)" class="hidden" />
                  </div>
                </div>

                <div class="sm:col-span-2">
                  <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('গ্রাহক / ব্যবসা (দোকানের নাম)', 'Customer / Business (Shop Name)') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="shopName"
                    [placeholder]="prefs.txt('যেমন: নমুনা অটো পার্টস', 'e.g. Sample Auto Parts')"
                    class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500"
                  />
                </div>

                <div>
                  <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('নাম', 'Name') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="customerName"
                    class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500"
                  />
                </div>

                <div>
                  <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('মোবাইল', 'Mobile') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="mobile"
                    placeholder="01XXXXXXXXX"
                    class="w-full border border-slate-300 rounded-lg p-2 font-mono font-semibold focus:border-teal-500"
                  />
                </div>

                <div class="sm:col-span-2">
                  <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('ঠিকানা', 'Address') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="address"
                    [placeholder]="prefs.txt('যেমন: শিরোমণি, খুলনা', 'e.g. Shiromoni, Khulna')"
                    class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500"
                  />
                </div>
              }

              <div>
                <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('পূর্বের বাকি', 'Previous Balance') }} (TK)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  [(ngModel)]="previousDue"
                  (ngModelChange)="updateCalculations()"
                  class="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold text-rose-700 bg-rose-50/30 focus:border-teal-500"
                />
              </div>

              <div>
                <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('প্রস্তুতকারক', 'Prepared by') }}</label>
                <input
                  type="text"
                  [(ngModel)]="preparedBy"
                  class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500"
                />
              </div>
            </div>

            @if (wholesaleMode) {
              <p class="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[10px] font-bold text-sky-700">
                <mat-icon class="text-sm">sell</mat-icon>
                {{ prefs.txt('পাইকারি মূল্য চালু — ' + (isDealerCustomer() ? 'ডিলার পার্টি' : 'এই কাস্টমার') + ' এর জন্য নতুন আইটেম পাইকারি মূল্য থেকে বসবে; প্রতিটি লাইনে দাম নিজের মতো বদলানো যাবে।', 'Wholesale pricing is on — new items use the wholesale rate for ' + (isDealerCustomer() ? 'the dealer party' : 'this customer') + '; each line price can still be edited.') }}
              </p>
            }
          </div>

          <!-- 3. Product Selection -->
          <div class="bg-white p-4 rounded-xl shadow-xs border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="relative md:col-span-2" id="product-search-container">
              <label class="block font-bold text-teal-800 mb-1 flex items-center gap-1">
                <mat-icon class="text-xs text-teal-600">search</mat-icon>
                * {{ prefs.txt('পণ্য অনুসন্ধান', 'Select Product') }}
              </label>
              <div class="relative">
                <input
                  #productSearchInput
                  type="text"
                  [value]="productSearchQuery()"
                  (input)="onSearchInput($event)"
                  (focus)="isSearchDropdownOpen.set(true)"
                  (keydown)="onProductSearchKeydown($event)"
                  [placeholder]="prefs.txt('নাম / কোড / ব্র্যান্ড / মডেল / ভ্যারিয়েন্ট — একাধিক শব্দ বা সামান্য বানান ভুলও চলবে; Enter প্রথম ফল যোগ করবে', 'Name / code / brand / model / variant — multiple words or slight typos are fine; Enter adds the first result')"
                  autocomplete="off"
                  class="w-full border-2 border-teal-500/50 focus:border-teal-600 dark:border-teal-700 rounded-lg py-2 pl-9 pr-16 bg-white dark:bg-slate-900 dark:text-slate-100 font-semibold text-slate-800 focus:outline-none"
                />
                <mat-icon class="absolute left-2.5 top-2.5 text-slate-400 text-sm">search</mat-icon>
                @if (productSearchQuery()) {
                  <button (click)="clearProductSearch()" class="absolute right-9 top-2.5 cursor-pointer text-slate-400 hover:text-slate-600">
                    <mat-icon class="text-sm">close</mat-icon>
                  </button>
                }
                <button type="button" (click)="cameraScanner()?.launch()"
                  [title]="prefs.txt('ক্যামেরা দিয়ে বারকোড স্ক্যান করুন', 'Scan barcode with camera')"
                  class="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-700 transition-colors hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/70 dark:text-teal-300 dark:hover:bg-teal-900/60">
                  <mat-icon style="font-size:18px;width:18px;height:18px;">photo_camera</mat-icon>
                </button>
              </div>

              @if (isSearchDropdownOpen() && filteredProducts().length > 0) {
                <div class="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-800 rounded-xl shadow-xl max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  @for (hit of filteredProducts(); track hit.product.id + '-' + (hit.variant?.id ?? 0); let i = $index) {
                    <div
                      (click)="selectSearchEntry(hit)"
                      (mouseenter)="searchIndex.set(i)"
                      class="w-full text-left p-2.5 transition-colors flex items-start gap-2.5 cursor-pointer border-l-2"
                      [ngClass]="i === searchIndex()
                        ? 'bg-teal-50/80 dark:bg-teal-950/60 border-teal-500'
                        : 'border-transparent hover:bg-teal-50/60 dark:hover:bg-slate-800/60'"
                    >
                      <div class="w-11 h-11 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center">
                        @if (hit.variant?.image || hit.product.image) {
                          <img [src]="hit.variant?.image || hit.product.image" [alt]="hit.product.name" class="w-full h-full object-cover" referrerpolicy="no-referrer"  loading="lazy" decoding="async" />
                        } @else {
                          <mat-icon class="text-slate-400 text-lg">inventory_2</mat-icon>
                        }
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="font-bold text-slate-900 dark:text-slate-100 text-xs truncate">{{ hit.product.name }}
                          @if (hit.variant) {
                            <span class="ml-1 inline-flex items-center rounded bg-violet-100 dark:bg-violet-950/70 px-1 py-0.5 text-[8.5px] font-black text-violet-700 dark:text-violet-300 align-middle">{{ variantLabelOf(hit.variant) }}</span>
                          }
                          @if (searchStock(hit) <= 0) {
                            <span class="ml-1 inline-flex items-center rounded bg-rose-100 px-1 py-0.5 text-[8.5px] font-black text-rose-600 dark:bg-rose-950 dark:text-rose-300 align-middle">{{ prefs.txt('স্টক নেই', 'Out of stock') }}</span>
                          }
                        </div>
                        <div class="text-[10px] text-slate-600 dark:text-slate-400 font-semibold mt-0.5 grid grid-cols-2 gap-x-2">
                          <span class="truncate">{{ prefs.txt('কোড', 'Code') }}: {{ searchCode(hit) }}</span>
                          <span class="truncate">{{ prefs.txt('ক্যাটাগরি', 'Category') }}: {{ hit.product.category || 'General' }}</span>
                          <span class="truncate">{{ prefs.txt('ব্র্যান্ড', 'Brand') }}: {{ hit.product.brand || '-' }}</span>
                          <span class="truncate">{{ prefs.txt('মডেল', 'Model') }}: {{ hit.product.model || '-' }}</span>
                          <span class="font-bold truncate" [ngClass]="searchStock(hit) <= 0 ? 'text-rose-600 dark:text-rose-400' : 'text-teal-700 dark:text-teal-300'">{{ prefs.txt('স্টক', 'Stock') }}: {{ searchStock(hit) }} {{ hit.product.unit || 'pcs' }}</span>
                          <span class="font-bold text-teal-700 dark:text-teal-300 font-mono">{{ prefs.txt('বিক্রয়', 'Sale') }}: {{ searchSale(hit) | number:'1.2-2' }} TK</span>
                          <span class="font-bold text-sky-700 dark:text-sky-300 font-mono">{{ prefs.txt('পাইকারি', 'Wholesale') }}: {{ searchWholesaleText(hit) }}</span>
                        </div>
                      </div>
                      <div class="text-right shrink-0">
                        <div class="font-mono font-bold text-teal-800 dark:text-teal-300 text-xs whitespace-nowrap">{{ quickPrice(hit.product, hit.variant) | number:'1.2-2' }} TK</div>
                        <mat-icon class="text-teal-600 dark:text-teal-400 text-base">add_circle</mat-icon>
                      </div>
                    </div>
                  }
                </div>
              } @else if (isSearchDropdownOpen() && productSearchQuery()) {
                <div class="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-3 text-center text-slate-500 dark:text-slate-400 text-xs">
                  {{ prefs.txt('কোনো পণ্য পাওয়া যায়নি', 'No products found') }}
                </div>
              }
            </div>
          </div>

          <!-- 4. Order Items -->
          <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
            <div class="px-4 py-3 bg-gradient-to-r from-teal-50 via-white to-white dark:from-teal-950/70 dark:via-slate-900 dark:to-slate-900 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <span class="font-extrabold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-1.5">
                <mat-icon class="text-teal-600 dark:text-teal-300 text-sm">shopping_cart</mat-icon>
                {{ prefs.txt('পণ্যের তালিকা', 'Order Items') }}
                <span class="ml-1 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-teal-600 dark:bg-teal-500 text-white dark:text-slate-900 text-[11px] font-black">{{ selectedProducts().length }}</span>
                @if (wholesaleMode) {
                  <span class="ml-1 inline-flex items-center gap-0.5 rounded-md border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/60 px-1.5 py-0.5 text-[9.5px] font-bold text-sky-700 dark:text-sky-300">
                    <mat-icon class="text-xs">sell</mat-icon> {{ prefs.txt('পাইকারি', 'Wholesale') }}
                  </span>
                }
              </span>
              @if (selectedProducts().length > 0) {
                <button (click)="clearAllItems()" class="text-rose-600 hover:text-rose-800 hover:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-300 dark:hover:bg-rose-500/10 text-xs font-bold flex items-center gap-1 px-2 py-1 rounded-lg transition-colors cursor-pointer">
                  <mat-icon class="text-sm">delete_sweep</mat-icon> {{ prefs.txt('সব মুছুন', 'Clear All') }}
                </button>
              }
            </div>

            <!-- Desktop table -->
            <div class="hidden md:block overflow-x-auto">
              <table class="w-full min-w-[880px] text-left border-collapse">
                <thead>
                  <tr class="bg-slate-100 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th class="p-2.5 w-12 text-center">#</th>
                    <th class="p-2.5 min-w-[220px]">{{ prefs.txt('পণ্য', 'Product') }}</th>
                    <th class="p-2.5 w-32 text-center">{{ prefs.txt('পরিমাণ', 'Qty') }}</th>
                    <th class="p-2.5 w-28 text-center">{{ prefs.txt('একক দর', 'Unit Price') }}</th>
                    <th class="p-2.5 w-36 text-center">{{ prefs.txt('ছাড়', 'Discount') }} (TK/%)</th>
                    <th class="p-2.5 w-32 text-right">{{ prefs.txt('লাইনের মোট', 'Line Total') }}</th>
                    <th class="p-2.5 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of cartRows(); track item.id; let idx = $index) {
                    <tr class="border-t border-slate-100 hover:bg-teal-50/40 transition-colors">
                      <td class="p-2.5 text-center align-middle">
                        <span class="inline-flex w-6 h-6 items-center justify-center rounded-full bg-slate-100 text-slate-500 text-[10px] font-black">{{ idx + 1 }}</span>
                      </td>
                      <td class="p-2.5">
                        <div class="flex items-center gap-2.5 min-w-0">
                          <div class="w-10 h-10 shrink-0 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center text-[13px] font-black text-slate-500 uppercase">
                            @if (getItemImage(item)) {
                              <img [src]="getItemImage(item)" [alt]="item.productName" class="w-full h-full object-cover" referrerpolicy="no-referrer"  loading="lazy" decoding="async" />
                            } @else {
                              {{ item.productName.charAt(0) }}
                            }
                          </div>
                          <div class="min-w-0">
                            <div class="font-bold text-slate-800 text-xs truncate">{{ item.productName }}</div>
                            <div class="text-[10px] text-slate-400 font-mono">{{ item.unit }} · @if (getItemDiscount(item) > 0) { <span class="line-through">{{ item.salesPrice | number:'1.0-2' }}</span> } @else { {{ item.salesPrice | number:'1.0-2' }} } </div>
                            @if (availableStock(item) !== null) {
                              <div class="text-[9.5px] font-bold" [class]="availableStock(item)! <= 0 ? 'text-rose-500' : 'text-slate-400'">{{ prefs.txt('স্টক', 'Stock') }}: {{ availableStock(item) }} {{ baseUnit(item) }}</div>
                            }
                          </div>
                        </div>
                      </td>
                      <td class="p-2.5 text-center">
                        <div class="inline-flex items-center rounded-lg border border-slate-300 overflow-hidden bg-white">
                          <button (click)="decrementQty(item)" class="w-7 h-8 bg-slate-50 hover:bg-slate-200 font-bold text-slate-600 flex items-center justify-center cursor-pointer" [title]="prefs.txt('কমান', 'Decrease')">−</button>
                          <input
                            type="number"
                            min="1"
                            [attr.max]="maxQtyFor(item)"
                            [(ngModel)]="item.quantity"
                            (ngModelChange)="onQuantityInput(item, $event)"
                            class="w-12 h-8 text-center font-mono font-bold text-slate-900 focus:bg-teal-50 outline-none border-x border-slate-200"
                          />
                          <button (click)="incrementQty(item)" class="w-7 h-8 bg-slate-50 hover:bg-teal-100 font-bold text-teal-700 flex items-center justify-center cursor-pointer" [title]="prefs.txt('বাড়ান', 'Increase')">+</button>
                        </div>
                        @if (hasUnitChoices(item)) {
                          <select [(ngModel)]="item.unit" (ngModelChange)="onLineUnitChange(item, $event)" class="mt-1 w-24 h-6 rounded-md border border-slate-300 bg-white px-1 text-[10px] font-bold text-slate-700 outline-none focus:border-teal-500">
                            @for (choice of unitChoices(item); track choice.name) {
                              <option [value]="choice.name">{{ choice.name }}</option>
                            }
                          </select>
                          @if (lineUnitNote(item)) {
                            <p class="mt-0.5 text-[9px] font-bold text-teal-700 whitespace-nowrap">{{ lineUnitNote(item) }}</p>
                            <p class="text-[9px] font-semibold text-slate-500 whitespace-nowrap">{{ item.quantity }} {{ item.unit }} = {{ lineBaseQty(item) }} {{ baseUnit(item) }}</p>
                          }
                        }
                      </td>
                      <td class="p-2.5 text-center">
                        <div class="inline-flex items-stretch rounded-lg border overflow-hidden"
                          [class]="session.has('editPrice') ? 'border-slate-300 bg-white focus-within:border-teal-600' : 'border-slate-200 bg-slate-100'">
                          <span class="px-1.5 py-1.5 bg-slate-100 text-[9px] font-black text-slate-500 flex items-center">TK</span>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            [(ngModel)]="item.salesPrice"
                            (ngModelChange)="updateCalculations()"
                            [readonly]="!session.has('editPrice')"
                            [class]="session.has('editPrice')
                              ? 'w-20 px-1.5 py-1.5 text-right font-mono font-bold text-teal-900 outline-none'
                              : 'w-20 px-1.5 py-1.5 text-right font-mono font-bold text-slate-500 cursor-not-allowed outline-none'"
                            [title]="session.has('editPrice') ? '' : prefs.t('pos.priceLocked')"
                          />
                        </div>
                      </td>
                      <td class="p-2.5">
                        <div class="flex flex-col items-center gap-1">
                          <div class="inline-flex rounded-md border border-slate-300 overflow-hidden text-[9px] font-black">
                            <button
                              type="button"
                              (click)="setLineDiscountType(item, 'fixed')"
                              class="px-2 py-0.5 transition-colors cursor-pointer"
                              [class]="item.discountType !== 'percent' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'"
                              [title]="prefs.txt('টাকায় ছাড়', 'Discount in taka')"
                            >TK</button>
                            <button
                              type="button"
                              (click)="setLineDiscountType(item, 'percent')"
                              class="px-2 py-0.5 border-l border-slate-300 transition-colors cursor-pointer"
                              [class]="item.discountType === 'percent' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'"
                              [title]="prefs.txt('শতাংশে ছাড়', 'Discount in percent')"
                            >%</button>
                          </div>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            [(ngModel)]="item.discount"
                            (ngModelChange)="updateCalculations()"
                            [readonly]="!session.has('editPrice')"
                            [class]="session.has('editPrice')
                              ? 'w-24 px-2 py-1 border border-slate-300 rounded-lg text-center font-mono font-bold text-emerald-700 bg-white focus:border-teal-600 outline-none'
                              : 'w-24 px-2 py-1 border border-slate-200 rounded-lg text-center font-mono font-bold text-slate-500 bg-slate-100 cursor-not-allowed outline-none'"
                            placeholder="0"
                            [title]="item.discountType === 'percent' ? prefs.txt('লাইনের মোটের শতাংশ ছাড়', 'Percentage discount on line total') : prefs.txt('স্থির টাকার ছাড়', 'Fixed discount in taka')"
                          />
                          @if (getItemDiscount(item) > 0) {
                            <span class="text-[10px] font-mono font-bold text-rose-600">-{{ getItemDiscount(item) | number:'1.2-2' }} TK</span>
                          }
                        </div>
                      </td>
                      <td class="p-2.5 text-right align-middle">
                        <div class="font-mono font-black text-teal-800 text-sm">{{ getItemSubtotal(item) | number:'1.2-2' }}</div>
                        <div class="text-[9px] font-bold uppercase tracking-wide text-slate-400">TK</div>
                      </td>
                      <td class="p-2.5 text-center align-middle">
                        <button (click)="removeItem(item.id)" class="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer" [title]="prefs.txt('সরান', 'Remove')">
                          <mat-icon class="text-base">close</mat-icon>
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="7" class="p-10 text-center">
                        <div class="inline-flex flex-col items-center gap-1 text-slate-400">
                          <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                            <mat-icon class="text-2xl text-slate-300">shopping_cart</mat-icon>
                          </span>
                          <p class="text-xs font-semibold">{{ prefs.txt('তালিকা খালি — উপরের সার্চ বা বারকোড থেকে পণ্য যোগ করুন', 'List is empty — add items from the search above or by barcode') }}</p>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <!-- Mobile cards -->
            <div class="md:hidden divide-y divide-slate-100">
              @for (item of cartRows(); track item.id; let idx = $index) {
                <div class="p-3 space-y-2.5">
                  <div class="flex items-start gap-2.5">
                    <div class="w-10 h-10 shrink-0 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center text-[13px] font-black text-slate-500 uppercase">
                      @if (getItemImage(item)) {
                        <img [src]="getItemImage(item)" [alt]="item.productName" class="w-full h-full object-cover" referrerpolicy="no-referrer"  loading="lazy" decoding="async" />
                      } @else {
                        {{ item.productName.charAt(0) }}
                      }
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="font-bold text-slate-800 text-sm truncate">{{ item.productName }}</p>
                      <p class="text-[10px] text-slate-400 font-mono">{{ prefs.txt('ক্রম', 'SL') }} {{ idx + 1 }} • {{ prefs.txt('একক', 'Unit') }}: {{ item.unit }}</p>
                    </div>
                    <button (click)="removeItem(item.id)" class="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50">
                      <mat-icon class="text-base">close</mat-icon>
                    </button>
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="block text-[10px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('পরিমাণ', 'QTY') }}</label>
                      <div class="inline-flex items-center rounded-lg border border-slate-300 overflow-hidden bg-white">
                        <button (click)="decrementQty(item)" class="w-7 h-8 bg-slate-50 font-bold text-slate-600">−</button>
                        <input
                          type="number"
                          min="1"
                          [(ngModel)]="item.quantity"
                          (ngModelChange)="updateCalculations()"
                          class="w-12 h-8 text-center font-mono font-bold text-slate-900 border-x border-slate-200 outline-none"
                        />
                        <button (click)="incrementQty(item)" class="w-7 h-8 bg-slate-50 font-bold text-teal-700">+</button>
                      </div>
                      @if (hasUnitChoices(item)) {
                        <select [(ngModel)]="item.unit" (ngModelChange)="onLineUnitChange(item, $event)" class="mt-1 w-full h-7 rounded-lg border border-slate-300 bg-white px-1.5 text-[11px] font-bold text-slate-700 outline-none focus:border-teal-500">
                          @for (choice of unitChoices(item); track choice.name) {
                            <option [value]="choice.name">{{ choice.name }}</option>
                          }
                        </select>
                        @if (lineUnitNote(item)) {
                          <p class="mt-0.5 text-[9px] font-bold text-teal-700">{{ lineUnitNote(item) }}</p>
                          <p class="text-[9px] font-semibold text-slate-500">{{ item.quantity }} {{ item.unit }} = {{ lineBaseQty(item) }} {{ baseUnit(item) }}</p>
                        }
                      }
                    </div>
                    <div>
                      <label class="block text-[10px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('একক দর', 'UNIT PRICE') }} (TK)</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        [(ngModel)]="item.salesPrice"
                        (ngModelChange)="updateCalculations()"
                        [readonly]="!session.has('editPrice')"
                        [class]="session.has('editPrice')
                          ? 'w-full border border-slate-300 focus:border-teal-600 rounded-lg p-1.5 text-right font-mono font-bold text-teal-900 bg-white'
                          : 'w-full border border-slate-200 rounded-lg p-1.5 text-right font-mono font-bold text-slate-500 bg-slate-100 cursor-not-allowed'"
                      />
                    </div>
                    <div>
                      <label class="block text-[10px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('ডিসকাউন্ট', 'DISCOUNT') }}</label>
                      <div class="flex items-center gap-1">
                        <div class="inline-flex rounded-md border border-slate-300 overflow-hidden text-[9px] font-black shrink-0">
                          <button type="button" (click)="setLineDiscountType(item, 'fixed')" class="px-2 py-1.5" [class]="item.discountType !== 'percent' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500'">TK</button>
                          <button type="button" (click)="setLineDiscountType(item, 'percent')" class="px-2 py-1.5 border-l border-slate-300" [class]="item.discountType === 'percent' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500'">%</button>
                        </div>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          [(ngModel)]="item.discount"
                          (ngModelChange)="updateCalculations()"
                          [readonly]="!session.has('editPrice')"
                          [class]="session.has('editPrice')
                            ? 'w-full min-w-0 border border-slate-300 focus:border-teal-600 rounded-lg p-1.5 text-right font-mono font-bold text-emerald-700 bg-white'
                            : 'w-full min-w-0 border border-slate-200 rounded-lg p-1.5 text-right font-mono font-bold text-slate-500 bg-slate-100 cursor-not-allowed'"
                        />
                      </div>
                    </div>
                    <div class="text-right">
                      <label class="block text-[10px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('লাইনের মোট', 'LINE TOTAL') }}</label>
                      <p class="font-mono font-black text-teal-800 text-sm p-1.5">{{ getItemSubtotal(item) | number:'1.2-2' }} TK</p>
                      @if (getItemDiscount(item) > 0) {
                        <p class="text-[10px] font-mono font-bold text-rose-600 -mt-1.5">-{{ getItemDiscount(item) | number:'1.2-2' }} TK</p>
                      }
                    </div>
                  </div>
                </div>
              } @empty {
                <p class="p-8 text-center text-xs font-semibold text-slate-400">{{ prefs.txt('তালিকা খালি — উপরের সার্চ বা বারকোড থেকে পণ্য যোগ করুন', 'List is empty — add items from the search above or by barcode') }}</p>
              }
            </div>

            <!-- Summary footer -->
            <div class="border-t border-slate-200 bg-slate-50 p-3 space-y-3">
              <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-600">
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200">
                  {{ prefs.txt('মোট পণ্য', 'Total Items') }} <b class="text-slate-900">{{ selectedProducts().length }}</b>
                </span>
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200">
                  {{ prefs.txt('মোট পরিমাণ', 'Total Qty') }} <b class="text-slate-900">{{ totalQuantity }}</b>
                </span>
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200">
                  {{ prefs.txt('লাইন ছাড়', 'Line Discounts') }} <b class="font-mono text-rose-600">{{ lineDiscountTotal | number:'1.2-2' }} TK</b>
                </span>
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200">
                  {{ prefs.txt('অর্ডার ছাড়', 'Order Discount') }} <b class="font-mono text-rose-600">-{{ orderDiscountAmount | number:'1.2-2' }} TK</b>
                </span>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-black uppercase tracking-wider text-slate-500">{{ prefs.txt('অর্ডার ছাড়', 'Order Discount') }}</span>
                  <div class="inline-flex rounded-md border border-slate-300 overflow-hidden text-[9px] font-black">
                    <button
                      type="button"
                      (click)="setOrderDiscountType('fixed')"
                      class="px-2 py-1 transition-colors cursor-pointer"
                      [class]="orderDiscountType !== 'percent' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'"
                    >TK</button>
                    <button
                      type="button"
                      (click)="setOrderDiscountType('percent')"
                      class="px-2 py-1 border-l border-slate-300 transition-colors cursor-pointer"
                      [class]="orderDiscountType === 'percent' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'"
                    >%</button>
                  </div>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    [(ngModel)]="orderDiscount"
                    (ngModelChange)="updateCalculations()"
                    [readonly]="!session.has('editPrice')"
                    [class]="session.has('editPrice')
                      ? 'w-24 border border-slate-300 focus:border-teal-600 rounded-lg px-2 py-1 text-right font-mono font-bold text-emerald-700 bg-white outline-none'
                      : 'w-24 border border-slate-200 rounded-lg px-2 py-1 text-right font-mono font-bold text-slate-500 bg-slate-100 cursor-not-allowed outline-none'"
                    placeholder="0"
                    [title]="orderDiscountType === 'percent' ? prefs.txt('সব পণ্যের মোটের শতাংশ ছাড়', 'Percentage discount on all items total') : prefs.txt('সব পণ্যের মোটের ওপর স্থির টাকার ছাড়', 'Fixed taka discount on all items total')"
                  />
                </div>
                <div class="flex items-center gap-2.5 bg-teal-700 text-white rounded-lg px-3 py-1.5 shadow-sm">
                  <span class="text-[9px] font-black uppercase tracking-wider opacity-80">{{ prefs.txt('বর্তমান নেট বিল', 'Current Net Bill') }}</span>
                  <span class="font-mono font-black text-base">{{ itemsAfterOrderDiscount | number:'1.2-2' }} TK</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 8. Charges & Payments -->
          <div class="bg-white p-4 rounded-xl shadow-xs border border-slate-200 space-y-3">
            <h3 class="font-bold text-slate-900 text-sm border-b pb-2 flex items-center gap-1.5">
              <mat-icon class="text-teal-600 text-sm">payments</mat-icon>
              {{ prefs.txt('চার্জ ও জমা', 'Charges & Payments') }}
            </h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('পরিবহন ও শ্রমিক', 'Transport & Labour') }} (TK)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  [(ngModel)]="transportLabour"
                  (ngModelChange)="updateCalculations()"
                  class="w-full border border-slate-300 focus:border-teal-500 rounded-lg p-2 font-mono font-bold"
                />
              </div>
              <div>
                <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('ওয়ারেন্টি পরিবহন', 'Warranty Transport') }} (TK)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  [(ngModel)]="warrantyTransport"
                  (ngModelChange)="updateCalculations()"
                  class="w-full border border-slate-300 focus:border-teal-500 rounded-lg p-2 font-mono font-bold"
                />
              </div>
              <div>
                <label class="block font-bold text-emerald-800 mb-1">{{ prefs.txt('নগদ গ্রহণ', 'Cash Received') }} (TK)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  [(ngModel)]="cashReceived"
                  (ngModelChange)="updateCalculations()"
                  class="w-full border border-emerald-300 focus:border-emerald-600 rounded-lg p-2 font-mono font-bold text-emerald-900 bg-emerald-50/30"
                />
              </div>
              <div>
                <label class="block font-bold text-emerald-800 mb-1">{{ prefs.txt('ব্যাংক / ডিজিটাল গ্রহণ', 'Bank Payment Received') }} (TK)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  [(ngModel)]="bankPayment"
                  (ngModelChange)="updateCalculations()"
                  class="w-full border border-emerald-300 focus:border-emerald-600 rounded-lg p-2 font-mono font-bold text-emerald-900 bg-emerald-50/30"
                />
              </div>
              <div class="sm:col-span-2 lg:col-span-4">
                <label class="block font-semibold text-slate-700 mb-1">{{ prefs.txt('পেমেন্ট রেফারেন্স ও মেমো নোট', 'Payment Reference & Memo Note') }}</label>
                <input
                  type="text"
                  [(ngModel)]="notes"
                  [placeholder]="prefs.txt('ঐচ্ছিক — ইনভয়েসে প্রিন্ট হবে (যেমন: ব্যাংক TXN-001)', 'Optional — printed on the invoice (e.g. Bank TXN-001)')"
                  class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500"
                />
              </div>
            </div>
          </div>

        </div>

        <!-- RIGHT: Credits, Returns, Warranty + Final Account Summary -->
        <div class="space-y-4">

          <!-- 5. Old Battery Credit -->
          <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-visible">
            <div class="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5 min-w-0">
                <mat-icon class="text-teal-600 text-sm shrink-0">battery_charging_full</mat-icon>
                <span class="truncate">{{ prefs.txt('পুরাতন ব্যাটারি জমা', 'Old Battery Credit') }}</span>
              </span>
              <div class="flex items-center shrink-0" [title]="prefs.txt('চেক করলে সক্রিয় হবে', 'Check to enable')">
                <input
                  type="checkbox"
                  [checked]="batteryEnabled()"
                  (change)="toggleBattery($event)"
                  class="w-4 h-4 accent-teal-600 cursor-pointer"
                  [attr.aria-label]="prefs.txt('পুরাতন ব্যাটারি জমা সক্রিয় করুন', 'Enable old battery credit')"
                />
              </div>
            </div>

            @if (batteryEnabled()) {
              <div class="p-2.5 space-y-2">
                @for (adj of batteryAdjustments(); track adj.id; let idx = $index) {
                  <div class="rounded-lg border border-slate-200 bg-slate-50/50 p-2 space-y-1.5">
                    <div class="flex items-center gap-1.5">
                      <select
                        [value]="adj.kindKey || 'scrap'"
                        (change)="onBatteryKind(idx, $event)"
                        class="flex-1 min-w-0 border border-slate-300 rounded-md px-2 py-1 text-[11px] font-semibold focus:border-teal-500 focus:outline-none bg-white"
                      >
                        @for (k of batteryKinds; track k.key) { <option [value]="k.key">{{ batteryKindLabel(k) }}</option> }
                      </select>
                      @if ((adj.kindKey || 'scrap') === 'other') {
                        <select
                          [value]="adj.unit || 'kg'"
                          (change)="onBatteryUnit(idx, $event)"
                          class="w-20 shrink-0 border border-slate-300 rounded-md px-1 py-1 text-[11px] font-semibold focus:border-teal-500 focus:outline-none bg-white"
                        >
                          <option value="kg">{{ prefs.txt('কেজি', 'Kg') }}</option>
                          <option value="pcs">{{ prefs.txt('পিস', 'Pcs') }}</option>
                        </select>
                      }
                      <button
                        type="button"
                        (click)="removeBatteryAdjustmentRow(idx)"
                        class="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 cursor-pointer shrink-0"
                      >
                        <mat-icon class="text-sm">delete</mat-icon>
                      </button>
                    </div>
                    <div class="grid grid-cols-3 gap-1.5">
                      <div>
                        <label class="block text-[9px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('পরিমাণ', 'Qty') }} ({{ (adj.unit || 'kg') === 'pcs' ? prefs.txt('পিস', 'Pcs') : prefs.txt('কেজি', 'Kg') }})</label>
                        <input
                          type="number"
                          [attr.step]="(adj.unit || 'kg') === 'pcs' ? 1 : 0.1"
                          min="0"
                          [value]="adj.weightKg"
                          (input)="updateBatteryWeight(idx, $event)"
                          (blur)="normalizeBatteryWeightInput(idx, $event)"
                          class="w-full border border-slate-300 rounded-md px-1.5 py-1 text-[11px] font-mono font-bold text-center focus:border-teal-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label class="block text-[9px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('দর', 'Rate') }} / {{ (adj.unit || 'kg') === 'pcs' ? prefs.txt('পিস', 'Pcs') : prefs.txt('কেজি', 'Kg') }}</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          [value]="adj.ratePerKg"
                          (input)="updateBatteryRate(idx, $event)"
                          class="w-full border border-slate-300 rounded-md px-1.5 py-1 text-[11px] font-mono font-bold text-right focus:border-teal-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label class="block text-[9px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('টাকা', 'Amount') }}</label>
                        <span class="block py-1 font-mono font-black text-[11px] text-slate-900">{{ adj.total | number:'1.2-2' }}</span>
                      </div>
                    </div>
                  </div>
                }
                <button
                  type="button"
                  (click)="addBatteryAdjustmentRow()"
                  class="w-full border border-dashed border-teal-300 text-teal-700 hover:bg-teal-50 rounded-md py-1 flex items-center justify-center cursor-pointer"
                  [title]="prefs.txt('আরও আইটেম যোগ করুন', 'Add more items')"
                >
                  <mat-icon class="text-sm">add</mat-icon>
                </button>
              </div>
            }

            <div class="bg-slate-50 border-t border-slate-200 rounded-b-xl px-3 py-2 flex items-center justify-between font-bold text-[11px]">
              <span class="text-slate-600">{{ prefs.txt('মোট ব্যাটারি জমা (ক্রেডিট)', 'Total battery credit') }}:</span>
              <span class="font-mono text-slate-900">{{ oldBatteryCredit | number:'1.2-2' }} TK</span>
            </div>
          </div>

          <!-- 6. Returned Goods -->
          <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-visible">
            <div class="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5 min-w-0">
                <mat-icon class="text-teal-600 text-sm shrink-0">assignment_return</mat-icon>
                <span class="truncate">{{ prefs.txt('ফেরত মাল জমা', 'Returned Goods') }}</span>
              </span>
              <div class="flex items-center shrink-0" [title]="prefs.txt('চেক করলে সক্রিয় হবে', 'Check to enable')">
                <input
                  type="checkbox"
                  [checked]="returnsEnabled()"
                  (change)="toggleReturns($event)"
                  class="w-4 h-4 accent-teal-600 cursor-pointer"
                  [attr.aria-label]="prefs.txt('ফেরত মাল জমা সক্রিয় করুন', 'Enable returned goods')"
                />
              </div>
            </div>

            @if (returnsEnabled()) {
            <div class="relative p-2.5 border-b border-slate-100" id="return-search-container">
              <label class="block text-[9px] font-bold text-slate-500 mb-1">
                {{ prefs.txt('পণ্যের নাম বা ভাউচার নম্বর দিয়ে রিটার্ন আইটেম খুঁজুন', 'Search return items by product name or voucher no') }}
              </label>
              <div class="relative">
                <mat-icon class="absolute left-2 top-1.5 text-slate-400 text-sm">search</mat-icon>
                <input
                  type="text"
                  [value]="returnSearchQuery()"
                  (input)="onReturnSearchInput($event)"
                  (focus)="isReturnSearchOpen.set(true)"
                  [placeholder]="prefs.txt('যেমন: SF Battery 100AH / ভ্যারিয়েন্ট কোড অথবা SALE-220', 'e.g. SF Battery 100AH / variant item code or SALE-220')"
                  class="w-full border-2 border-teal-500/40 focus:border-teal-600 rounded-lg py-1.5 pl-8 pr-7 bg-white font-semibold text-[11px] text-slate-800 focus:outline-none"
                />
                @if (returnSearchQuery()) {
                  <button type="button" (click)="clearReturnSearch()" class="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600">
                    <mat-icon class="text-sm">close</mat-icon>
                  </button>
                }
              </div>

              @if (isReturnSearchOpen() && returnSearchQuery()) {
                <div class="absolute z-40 left-2.5 right-2.5 mt-1 bg-white border border-teal-200 rounded-xl shadow-xl max-h-72 overflow-y-auto divide-y divide-slate-100">
                  @for (inv of returnInvoiceMatches(); track inv.id) {
                    <div>
                      <div class="px-2.5 py-1.5 bg-slate-50 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-600">
                        <span class="flex items-center gap-1 min-w-0">
                          <mat-icon class="text-xs text-teal-600">receipt_long</mat-icon>
                          <span class="font-mono truncate">{{ inv.invoice }}</span>
                          <span class="truncate">— {{ inv.customerName }}</span>
                        </span>
                        <span class="shrink-0">{{ inv.date }}</span>
                      </div>
                      @for (item of inv.items; track item.id) {
                        <button
                          type="button"
                          (click)="returnFromInvoiceItem(inv, item)"
                          class="w-full text-left px-2.5 py-1.5 hover:bg-teal-50/80 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <span class="min-w-0">
                            <span class="block font-bold text-slate-900 text-[11px] truncate">{{ item.productName }}</span>
                            <span class="block text-[10px] text-slate-500">{{ prefs.txt('বিক্রি', 'Sold') }}: {{ item.quantity }} {{ item.unit || 'pcs' }} | {{ inv.invoice }}</span>
                          </span>
                          <span class="text-right shrink-0 font-mono font-bold text-teal-800 text-[11px]">{{ item.salesPrice | number:'1.2-2' }} TK</span>
                        </button>
                      } @empty {
                        <p class="px-2.5 py-2 text-[10px] text-slate-400 italic">{{ prefs.txt('এই ইনভয়েসে কোনো আইটেম নেই।', 'This invoice has no items.') }}</p>
                      }
                    </div>
                  }

                  @for (hit of returnProductMatches(); track hit.product.id + '-' + (hit.variant?.id ?? 0)) {
                    <div
                      (click)="returnFromProduct(hit.product, hit.variant)"
                      class="w-full text-left px-2.5 py-1.5 hover:bg-teal-50/80 transition-colors cursor-pointer"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span class="min-w-0">
                          <span class="block font-bold text-slate-900 text-[11px] truncate">{{ hit.product.name }}
                            @if (hit.variant) {
                              <span class="ml-1 inline-flex items-center rounded bg-violet-100 px-1 py-0.5 text-[8.5px] font-black text-violet-700 align-middle">{{ variantLabelOf(hit.variant) }}</span>
                            }
                          </span>
                          <span class="block text-[10px] text-slate-500 font-mono">{{ prefs.txt('কোড', 'Code') }}: {{ searchCode(hit) }} | {{ prefs.txt('স্টক', 'Stock') }}: {{ searchStock(hit) }} {{ hit.product.unit || 'pcs' }}</span>
                        </span>
                        <span class="text-right shrink-0 font-mono font-bold text-teal-800 text-[11px]">{{ searchSale(hit) | number:'1.2-2' }} TK</span>
                      </div>
                    </div>
                  }

                  @if (returnInvoiceMatches().length === 0 && returnProductMatches().length === 0) {
                    <p class="px-2.5 py-2.5 text-center text-slate-500 text-[11px]">{{ prefs.txt('কোনো পণ্য বা ভাউচার পাওয়া যায়নি।', 'No product or voucher found.') }}</p>
                  }
                </div>
              }
            </div>

            @if (returns().length > 0) {
              <div class="p-2.5 space-y-2">
                @for (ret of returns(); track ret.id; let idx = $index) {
                  <div class="rounded-lg border border-slate-200 bg-slate-50/50 p-2 space-y-1.5">
                    <div class="flex items-center gap-1.5">
                      <input
                        type="text"
                        [value]="ret.item"
                        (input)="updateReturnItem(idx, $event)"
                        [placeholder]="prefs.txt('আইটেম / মূল ভাউচার', 'Item / Original Invoice')"
                        class="flex-1 min-w-0 border border-slate-300 rounded-md px-2 py-1 text-[11px] font-semibold focus:border-teal-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        (click)="removeReturnRow(idx)"
                        class="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 cursor-pointer shrink-0"
                      >
                        <mat-icon class="text-sm">delete</mat-icon>
                      </button>
                    </div>
                    <div class="grid grid-cols-3 gap-1.5">
                      <div>
                        <label class="block text-[9px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('পরিমাণ / একক', 'Qty / Unit') }}</label>
                        <input
                          type="text"
                          [value]="ret.qty"
                          (input)="updateReturnQty(idx, $event)"
                          placeholder="3 pcs"
                          class="w-full border border-slate-300 rounded-md px-1.5 py-1 text-[11px] font-semibold text-center focus:border-teal-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label class="block text-[9px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('দর', 'Rate') }} (TK)</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          [value]="ret.rate"
                          (input)="updateReturnRate(idx, $event)"
                          class="w-full border border-slate-300 rounded-md px-1.5 py-1 text-[11px] font-mono font-bold text-right focus:border-teal-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label class="block text-[9px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('টাকা', 'Amount') }}</label>
                        <span class="block py-1 font-mono font-black text-[11px] text-slate-900">{{ ret.amount | number:'1.2-2' }}</span>
                      </div>
                    </div>
                  </div>
                }
              </div>
            }
            }

            <div class="bg-slate-50 border-t border-slate-200 rounded-b-xl px-3 py-2 flex items-center justify-between font-bold text-[11px]">
              <span class="text-slate-600">{{ prefs.txt('মোট ফেরত জমা (ক্রেডিট)', 'Total return credit') }}:</span>
              <span class="font-mono text-slate-900">{{ returnsCredit | number:'1.2-2' }} TK</span>
            </div>
          </div>

          <!-- 7. Warranty Battery Claim -->
          <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
            <div class="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5 min-w-0">
                <mat-icon class="text-teal-600 text-sm shrink-0">verified_user</mat-icon>
                <span class="truncate">{{ prefs.txt('ওয়ারেন্টি পণ্য গ্রহণ', 'Warranty Product Receipt') }}</span>
              </span>
              <button
                type="button"
                (click)="onWarrantyToggle(!hasWarrantyClaim)"
                [attr.aria-pressed]="hasWarrantyClaim"
                [title]="prefs.txt('চাপলে ওয়ারেন্টি ক্লেইম ফরম খুলবে', 'Press to open the warranty claim form')"
                class="flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 transition-colors cursor-pointer"
                [class]="hasWarrantyClaim
                  ? 'border-teal-300 bg-teal-50 text-teal-700'
                  : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'"
              >
                <span class="relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors"
                  [class]="hasWarrantyClaim ? 'bg-teal-600' : 'bg-slate-300'">
                  <span class="inline-block h-2.5 w-2.5 rounded-full bg-white shadow transition-transform"
                    [class]="hasWarrantyClaim ? 'translate-x-[15px]' : 'translate-x-[2px]'"></span>
                </span>
                <span class="text-[9.5px] font-black">{{ hasWarrantyClaim ? prefs.txt('ক্লেইম সক্রিয়', 'Claim on') : prefs.txt('ক্লেইম যোগ করুন', 'Add claim') }}</span>
              </button>
            </div>

            @if (hasWarrantyClaim) {
              <div class="p-3 space-y-2.5">
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-[9px] font-bold text-slate-500 mb-0.5">
                      {{ prefs.txt('ক্লেইম নং', 'Claim No.') }}
                      <span class="ml-1 rounded bg-teal-100 px-1 text-[8px] font-black uppercase text-teal-700">{{ prefs.txt('অটো', 'Auto') }}</span>
                    </label>
                    <input type="text" [value]="warranty.claimNo" readonly tabindex="-1" [placeholder]="prefs.txt('অটো তৈরি হবে', 'Generated on save')" class="w-full cursor-default border border-teal-200 bg-teal-50 rounded-md px-1.5 py-1.5 text-[11px] font-black font-mono text-teal-800 focus:outline-none" />
                  </div>
                  <div>
                    <label class="block text-[9px] font-bold text-slate-500 mb-0.5">
                      {{ prefs.txt('মূল ইনভয়েস', 'Original Invoice') }}
                      <span class="ml-1 rounded bg-slate-100 px-1 text-[8px] font-black uppercase text-slate-500">{{ prefs.txt('পুরনো ভাউচার', 'Past') }}</span>
                    </label>
                    <input
                      type="text"
                      list="warrantyInvoiceList"
                      [(ngModel)]="warranty.originalInvoice"
                      [placeholder]="voucherNo || prefs.txt('মূল ইনভয়েস নম্বর', 'Original invoice no.')"
                      class="w-full border border-slate-300 rounded-md px-1.5 py-1.5 text-[11px] font-black font-mono focus:border-teal-500 focus:outline-none"
                    />
                    <datalist id="warrantyInvoiceList">
                      @for (inv of warrantyInvoiceOptions(); track inv) {
                        <option [value]="inv"></option>
                      }
                    </datalist>
                  </div>
                </div>

                <div>
                  <label class="mb-0.5 flex items-center justify-between gap-2">
                    <span class="text-[9px] font-bold text-slate-500">{{ prefs.txt('ব্যাটারি', 'Battery') }} <span class="text-rose-500">*</span></span>
                    <span class="text-[9px] font-semibold text-slate-400">{{ prefs.txt('নাম লিখুন বা পণ্য সার্চ করুন', 'Type a name or search a product') }}</span>
                  </label>
                  <div class="relative z-40">
                    <mat-icon class="pointer-events-none absolute left-2 top-[6px] text-[15px] text-slate-400">search</mat-icon>
                    <input
                      type="text"
                      [ngModel]="warranty.battery"
                      (ngModelChange)="onWarrantyBatteryInput($event)"
                      (focus)="warrantyBatteryOpen.set(true)"
                      (click)="warrantyBatteryOpen.set(true)"
                      autocomplete="off"
                      [placeholder]="prefs.txt('যেমন: SF 100Ah', 'e.g. SF 100Ah')"
                      class="w-full border border-slate-300 rounded-md py-1.5 pl-7 pr-7 text-[11px] font-semibold focus:border-teal-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      (click)="warrantyBatteryOpen.set(!warrantyBatteryOpen())"
                      class="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-teal-600"
                      [attr.aria-label]="prefs.txt('পণ্য তালিকা', 'Product list')"
                    >
                      <mat-icon class="text-[16px]">{{ warrantyBatteryOpen() ? 'expand_less' : 'expand_more' }}</mat-icon>
                    </button>
                    @if (warrantyBatteryOpen()) {
                      <div class="fixed inset-0 z-30" (click)="warrantyBatteryOpen.set(false)"></div>
                      <div class="absolute left-0 right-0 top-full z-40 mt-1 max-h-52 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
                        @for (p of warrantyBatteryFiltered(); track p.name) {
                          <button
                            type="button"
                            (click)="pickWarrantyBattery(p.name)"
                            class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-teal-50"
                          >
                            <span class="truncate font-semibold text-slate-700">{{ p.name }}</span>
                            <span class="shrink-0 text-[9px] font-bold text-slate-400">{{ p.code }}</span>
                          </button>
                        } @empty {
                          <p class="px-2 py-2 text-[10px] font-semibold text-amber-600">{{ prefs.txt('কোনো পণ্য মেলেনি — লেখা নামেই সেভ হবে', 'No product match — saved as typed') }}</p>
                        }
                      </div>
                    }
                  </div>
                  @if (warrantyMatchedProduct(); as product) {
                    <div class="mt-1 flex flex-wrap items-center gap-1 text-[9px] font-semibold">
                      <span class="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{{ product.code || product.name }}</span>
                      <span class="rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-600">{{ prefs.txt('স্টক', 'Stock') }}: {{ product.stock }} {{ product.unit }}</span>
                      @if (product.warrantyDays) {
                        <span class="rounded-full border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-teal-700">{{ product.warrantyDays }} {{ prefs.txt('দিনের ওয়ারেন্টি', 'days warranty') }}</span>
                      }
                    </div>
                  } @else if ((warranty.battery || '').trim()) {
                    <p class="mt-1 text-[9px] font-semibold text-amber-600">{{ prefs.txt('পণ্য তালিকায় নেই — লেখা নামেই সেভ হবে', 'Not in the product list — saved as typed') }}</p>
                  }
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-[9px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('পরিমাণ', 'Quantity') }}</label>
                    <div class="flex">
                      <input type="text" inputmode="decimal" [(ngModel)]="warranty.quantity" placeholder="1" class="w-full rounded-l-md border border-slate-300 px-1.5 py-1.5 text-[11px] font-semibold focus:border-teal-500 focus:outline-none" />
                      <span class="inline-flex shrink-0 items-center rounded-r-md border border-l-0 border-slate-300 bg-slate-50 px-2 text-[10px] font-bold text-slate-500">{{ warrantyUnit() }}</span>
                    </div>
                  </div>
                  <div>
                    <label class="block text-[9px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('গ্রহণ তারিখ', 'Receive Date') }}</label>
                    <input type="date" appDmyDate [(ngModel)]="warranty.receiveDate" class="w-full border border-slate-300 rounded-md px-1.5 py-1.5 text-[11px] font-semibold focus:border-teal-500 focus:outline-none" />
                  </div>
                </div>

                <div>
                  <label class="block text-[9px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('পণ্য কোড/IMEI', 'Product Code / IMEI') }}</label>
                  <input type="text" [(ngModel)]="warranty.oldSerial" [placeholder]="prefs.txt('ঐচ্ছিক — পুরনো সিরিয়াল বা আইএমইআই', 'Optional — old serial or IMEI')" class="w-full border border-slate-300 rounded-md px-1.5 py-1.5 text-[11px] font-mono focus:border-teal-500 focus:outline-none" />
                </div>

                <div>
                  <label class="block text-[9px] font-bold text-slate-500 mb-0.5">{{ prefs.txt('নোট / সমস্যা', 'Note / Issue') }}</label>
                  <textarea [(ngModel)]="warranty.notes" rows="2" [placeholder]="prefs.txt('ঐচ্ছিক — সমস্যা বা মন্তব্য লিখুন', 'Optional — issue or remark')" class="w-full border border-slate-300 rounded-md px-1.5 py-1.5 text-[11px] font-semibold focus:border-teal-500 focus:outline-none"></textarea>
                </div>

                <p class="flex gap-1 rounded-lg border border-teal-200 bg-teal-50/70 px-2 py-1.5 text-[9px] leading-snug text-teal-800">
                  <mat-icon class="mt-px shrink-0 text-[13px]">info</mat-icon>
                  <span>{{ prefs.txt('সেভ করলে ক্লেইম নম্বর অটো তৈরি হয়ে ওয়ারেন্টি ম্যানেজমেন্টের তালিকা, রেজিস্টার ও গ্রহণ স্টকে সংরক্ষিত হবে। নতুন ব্যাটারি বিক্রি করলে উপরের পণ্য তালিকায় যোগ করুন।', 'Saving auto-generates the claim number and stores it in Warranty Management — list, register and received stock. Add the new battery as a sale line above when you sell one.') }}</span>
                </p>
              </div>
            }
          </div>

          <!-- Final Account Summary (mirrors printed voucher) -->
          <div class="overflow-hidden border border-[#cbd5d5] bg-white text-xs dark:border-slate-700 dark:bg-slate-900">
            <div class="border-b border-[#cbd5d5] bg-[#edf4f2] px-2 py-[5px] text-[11.5px] font-bold text-[#17252c] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              {{ prefs.txt('চূড়ান্ত হিসাবের সারাংশ', 'Final Account Summary') }}
            </div>
            <table class="w-full border-collapse">
              <tbody>
                <tr>
                  <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('চলতি নিট বিল (+)', 'Current Net Bill (+)') }}</td>
                  <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ itemsNet | number:'1.2-2' }}</td>
                </tr>
                @if (orderDiscountAmount > 0) {
                  <tr>
                    <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('অর্ডার ডিসকাউন্ট (-)', 'Order Discount (-)') }}</td>
                    <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ orderDiscountAmount | number:'1.2-2' }}</td>
                  </tr>
                }
                @if (transportLabour > 0) {
                  <tr>
                    <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('পরিবহন ও শ্রম চার্জ (+)', 'Transport & Labour Charge (+)') }}</td>
                    <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ transportLabour | number:'1.2-2' }}</td>
                  </tr>
                }
                @if (warrantyTransport > 0) {
                  <tr>
                    <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('ওয়ারেন্টি পরিবহন চার্জ (+)', 'Warranty Transport Charge (+)') }}</td>
                    <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ warrantyTransport | number:'1.2-2' }}</td>
                  </tr>
                }
                <tr class="font-bold">
                  <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('মোট ভাউচার বিল', 'TOTAL VOUCHER BILL') }}</td>
                  <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ totalVoucherBill | number:'1.2-2' }}</td>
                </tr>
                <tr>
                  <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('আগের বাকি (+)', 'Previous Balance (+)') }}</td>
                  <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ previousDue | number:'1.2-2' }}</td>
                </tr>
                <tr class="font-bold">
                  <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('সর্বমোট পরিশোধযোগ্য', 'TOTAL PAYABLE') }}</td>
                  <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ totalPayable | number:'1.2-2' }}</td>
                </tr>
                @if (cashReceived > 0) {
                  <tr>
                    <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('নগদ গ্রহণ (-)', 'Cash Received (-)') }}</td>
                    <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ cashReceived | number:'1.2-2' }}</td>
                  </tr>
                }
                @if (bankPayment > 0) {
                  <tr>
                    <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('ব্যাংক পেমেন্ট গ্রহণ (-)', 'Bank Payment Received (-)') }}</td>
                    <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ bankPayment | number:'1.2-2' }}</td>
                  </tr>
                }
                @if (oldBatteryCredit > 0) {
                  <tr>
                    <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('পুরাতন ব্যাটারি ক্রেডিট (-)', 'Old Battery Credit (-)') }}</td>
                    <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ oldBatteryCredit | number:'1.2-2' }}</td>
                  </tr>
                }
                @if (returnsCredit > 0) {
                  <tr>
                    <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('ফেরত মাল ক্রেডিট (-)', 'Returned Goods Credit (-)') }}</td>
                    <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ returnsCredit | number:'1.2-2' }}</td>
                  </tr>
                }
                <tr class="font-bold">
                  <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800 px-1.5 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-100">{{ prefs.txt('মোট পেমেন্ট / ক্রেডিট', 'TOTAL PAYMENTS / CREDITS') }}</td>
                  <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800 px-1.5 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-100">{{ totalPaymentsCredits | number:'1.2-2' }}</td>
                </tr>
                <tr class="font-bold text-white">
                  <td class="bg-[#087d6c] px-1.5 py-2 text-[12px]">{{ finalBalanceLabel }}</td>
                  <td class="whitespace-nowrap bg-[#087d6c] px-1.5 py-2 text-right font-mono text-[12px] tabular-nums">{{ finalBalanceAmount | number:'1.2-2' }}</td>
                </tr>
              </tbody>
            </table>

            <div class="space-y-2.5 border-t border-[#cbd5d5] bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">{{ prefs.txt('অর্ডার স্ট্যাটাস', 'Order Status') }}</span>
                <div class="relative">
                  <select
                    [(ngModel)]="orderStatus"
                    class="w-36 appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-2.5 pr-7 text-[11px] font-bold cursor-pointer focus:border-teal-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    [ngClass]="{
                      'text-emerald-700 dark:text-emerald-300': orderStatus === 'Completed',
                      'text-amber-600 dark:text-amber-300': orderStatus === 'Ordered' || orderStatus === 'Processing',
                      'text-sky-700 dark:text-sky-300': orderStatus === 'Confirmed' || orderStatus === 'Shipping',
                      'text-rose-600 dark:text-rose-400': orderStatus === 'Cancelled'
                    }"
                    [attr.aria-label]="prefs.txt('অর্ডার স্ট্যাটাস', 'Order status')"
                  >
                    @for (s of orderStatuses; track s) {
                      <option [value]="s">{{ orderStatusLabel(s) }}</option>
                    }
                  </select>
                  <mat-icon class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 dark:text-slate-500">expand_more</mat-icon>
                </div>
              </div>

              <button
                (click)="saveSale()"
                [disabled]="isDuplicateVoucher()"
                class="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <mat-icon class="text-base">save</mat-icon>
                {{ editSaleId() !== null ? prefs.txt('আপডেট করুন', 'Update Sale') : prefs.txt('সংরক্ষণ করুন', 'Save Sale') }}
              </button>
            </div>
          </div>

          @if (isWalkInCustomer()) {
            <div class="rounded-xl border px-3 py-2 text-[11px] font-semibold flex items-start gap-1.5"
              [class]="finalBalance > 0 ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-teal-50 border-teal-200 text-teal-700'">
              <mat-icon class="text-sm shrink-0">{{ finalBalance > 0 ? 'error' : 'verified_user' }}</mat-icon>
              <span>
                {{ finalBalance > 0
                  ? prefs.txt('ওয়াক-ইন কাস্টমারের বাকি রাখা যাবে না — পুরো বিল পরিশোধ করুন অথবা পার্টি নির্বাচন করুন।', 'A walk-in customer cannot keep due — collect the full bill or select a party.')
                  : prefs.txt('ওয়াক-ইন কাস্টমার — বিল সম্পূর্ণ পরিশোধিত।', 'Walk-in customer — bill fully paid.') }}
              </span>
            </div>
          }
        </div>

      </div>

      <app-barcode-scanner #scanCam [continuous]="true" (scanned)="onBarcodeScan($event)" />
    </div>

    @if (showEditPasscode()) {
      <app-passcode-modal
        [title]="prefs.txt('ইনভয়েস লক করা আছে', 'Locked Invoice')"
        [message]="prefs.txt('এই ইনভয়েসটি কনফার্ম করা হয়েছে এবং লক করা আছে। ইডিট করার জন্য পাসকোড দিন।', 'This invoice is confirmed and locked. Enter the passcode to edit.')"
        (verified)="onEditPasscodeVerified($event)"
        (close)="cancelEditUnlock()"
      />
    }
  `
})
export class AddSale implements OnInit, CanLeave {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly orderLock = inject(OrderLockService);
  readonly session = inject(SessionService);
  readonly prefs = inject(PreferencesService);

  readonly editSaleId = signal<number | null>(null);
  readonly showEditPasscode = signal(false);
  private pendingEditSale: Sale | null = null;

  readonly orderStatuses: Sale['status'][] = ['Completed', 'Ordered', 'Confirmed', 'Processing', 'Shipping', 'Cancelled'];
  // A counter voucher is written after the goods leave the shop, so the stock
  // and the party books must post on save; pending stages stay opt-in.
  orderStatus: Sale['status'] = 'Completed';

  // Customer picker
  customerPickerOpen = signal(false);
  customerQuery = signal('');
  customerResults = computed(() => {
    const q = this.customerQuery().trim().toLowerCase();
    const partyList = this.dataService.parties().filter(p => hasSalesRole(p));
    if (!q) return partyList.slice(0, 40);
    return partyList.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.phone || '').toLowerCase().includes(q) ||
      (p.companyName || '').toLowerCase().includes(q)
    ).slice(0, 40);
  });

  // Voucher & customer
  voucherNo = this.getNextSequentialVoucherNo();
  saleDate = localDateIso();
  saleDateText = this.saleDate.split('-').reverse().join('/');
  nextPaymentDate = '';
  nextPaymentText = '';
  preparedBy = this.session.currentUser()?.name || this.dataService.voucherSettings().soldBy || 'Admin';

  customerName = 'Walk In Customer';
  selectedPartyId?: number;
  customerEditEnabled = false;
  shopName = '';
  mobile = '';
  address = '';
  previousDue = 0;
  notes = '';
  /** New lines default to wholesalePrice while on; Dealer parties turn this on automatically. */
  wholesaleMode = false;

  // Product search (same behaviour as the POS: type or scan, Enter adds the first hit)
  productSearchQuery = signal<string>('');
  isSearchDropdownOpen = signal<boolean>(false);
  searchIndex = signal<number>(0);
  private readonly productSearchInput = viewChild<ElementRef<HTMLInputElement>>('productSearchInput');
  readonly cameraScanner = viewChild<BarcodeScanner>('scanCam');

  filteredProducts = computed(() => {
    const query = this.productSearchQuery().trim();
    if (!query) return [];
    return searchProductEntries(this.dataService.products(), query).slice(0, 12);
  });

  /** A searched variant answers with its own code, stock and rates. */
  searchStock(hit: ProductSearchEntry): number {
    return Math.max(0, Number(hit.variant ? hit.variant.openingStock : hit.product.stock) || 0);
  }

  searchCode(hit: ProductSearchEntry): string {
    return hit.variant?.itemCode || hit.product.code;
  }

  searchSale(hit: ProductSearchEntry): number {
    return Number(hit.variant ? hit.variant.salesPrice : hit.product.salesPrice) || 0;
  }

  searchWholesale(hit: ProductSearchEntry): number {
    return Number(hit.variant ? hit.variant.wholesalePrice : hit.product.wholesalePrice) || 0;
  }

  searchWholesaleText(hit: ProductSearchEntry): string {
    const rate = this.searchWholesale(hit);
    return rate > 0 ? `${formatNumber(rate, 'en-US', '1.2-2')} TK` : '—';
  }

  variantLabelOf(v: ProductVariant): string {
    return variantLabel(v);
  }

  selectedProducts = signal<SaleItem[]>([]);
  /** Cart shows the newest line first; selectedProducts keeps entry order for the voucher. */
  readonly cartRows = computed(() => [...this.selectedProducts()].reverse());

  // Old battery credit (Scrap)
  batteryEnabled = signal(false);
  returnsEnabled = signal(false);
  batteryAdjustments = signal<BatteryAdjustmentItem[]>([]);
  readonly batteryKinds = BATTERY_KINDS;

  batteryKindLabel(kind: BatteryKind): string {
    return this.prefs.language() === 'en' ? kind.en : kind.bn;
  }

  // Returned goods
  returns = signal<SalesReturnItem[]>([]);

  // Return item search (by product name / code or invoice number)
  returnSearchQuery = signal<string>('');
  isReturnSearchOpen = signal<boolean>(false);

  returnInvoiceMatches = computed(() => {
    const query = this.returnSearchQuery().trim().toLowerCase();
    if (!query) return [];
    return this.dataService.sales()
      .filter(s => (s.invoice || '').toLowerCase().includes(query))
      .slice(0, 3);
  });

  returnProductMatches = computed(() => {
    const query = this.returnSearchQuery().trim();
    if (!query) return [];
    return searchProductEntries(this.dataService.products(), query).slice(0, 8);
  });

  // Warranty battery intake
  hasWarrantyClaim = false;
  warranty: WarrantyClaimInfo = this.emptyWarranty();

  /** Recent vouchers a returning battery can be traced back to. */
  readonly warrantyInvoiceOptions = computed(() =>
    this.dataService.sales()
      .filter(s => s.status !== 'Cancelled' && !!(s.invoice || '').trim())
      .map(s => s.invoice)
      .slice(0, 300)
  );

  /** Unique product names for the battery suggestions; typing is still allowed. */
  readonly warrantyBatteryOptions = computed(() => {
    const seen = new Set<string>();
    const options: { name: string; code: string }[] = [];
    for (const product of this.dataService.products()) {
      if (product.type === 'service') continue;
      const name = (product.name || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      options.push({ name, code: product.code || '' });
    }
    return options.sort((a, b) => a.name.localeCompare(b.name));
  });

  /** Custom combobox: clicking the field opens the list, typing narrows it. */
  warrantyBatteryOpen = signal(false);
  /** Mirrors the input text so the filtered list reacts to typing (signals only). */
  warrantyBatteryQuery = signal('');

  readonly warrantyBatteryFiltered = computed(() => {
    const all = this.warrantyBatteryOptions();
    const query = this.warrantyBatteryQuery().trim().toLowerCase();
    if (!query || all.some(p => p.name.toLowerCase() === query)) return all;
    return all.filter(p => p.name.toLowerCase().includes(query) || (p.code || '').toLowerCase().includes(query));
  });

  pickWarrantyBattery(name: string) {
    this.onWarrantyBatteryInput(name);
    this.warrantyBatteryOpen.set(false);
  }

  private emptyWarranty(): WarrantyClaimInfo {
    return {
      claimNo: '',
      originalInvoice: '',
      battery: '',
      quantity: '',
      receiveDate: '',
      receiptNo: '',
      oldSerial: '',
      replacementDate: '',
      deliveryNo: '',
      newSerial: '',
      status: WARRANTY_STATUS_IN_PROGRESS
    };
  }

  onWarrantyToggle(enabled: boolean) {
    this.hasWarrantyClaim = enabled;
    if (!enabled) {
      this.warrantyBatteryOpen.set(false);
      return;
    }
    if (!(this.warranty.claimNo || '').trim()) {
      this.warranty.claimNo = this.dataService.peekWarrantyReceiptNo();
    }
    if (!this.warranty.receiveDate) this.warranty.receiveDate = this.saleDate || localDateIso();
    if (!(Number(this.warranty.quantity) > 0)) this.warranty.quantity = '1';
  }

  warrantyMatchedProduct(): Product | undefined {
    const name = (this.warranty.battery || '').trim().toLowerCase();
    if (!name) return undefined;
    return this.dataService.products().find(p => (p.name || '').trim().toLowerCase() === name);
  }

  warrantyUnit(): string {
    return this.warrantyMatchedProduct()?.unit || 'pcs';
  }

  /**
   * Battery is a hybrid field: a picked product carries its id and warranty
   * period into the claim, while free text still saves as a custom name.
   */
  onWarrantyBatteryInput(name: string) {
    this.warranty.battery = name || '';
    this.warrantyBatteryQuery.set(name || '');
    const product = this.warrantyMatchedProduct();
    this.warranty.productId = product?.id;
    this.warranty.warrantyDays = product?.warrantyDays ? Math.round(product.warrantyDays) : undefined;
    if (!(Number(this.warranty.quantity) > 0)) this.warranty.quantity = '1';
  }

  private validateWarrantyClaim(): string {
    if (!(this.warranty.battery || '').trim()) {
      return this.prefs.txt('ওয়ারেন্টি ব্যাটারির নাম / মডেল দিন।', 'Enter the warranty battery name / model.');
    }
    return '';
  }

  // Totals
  totalQuantity = 0;
  itemsNet = 0;
  lineDiscountTotal = 0;
  orderDiscount = 0;
  orderDiscountType: 'fixed' | 'percent' = 'fixed';
  orderDiscountAmount = 0;
  itemsAfterOrderDiscount = 0;
  totalVoucherBill = 0;
  oldBatteryCredit = 0;
  returnsCredit = 0;
  transportLabour = 0;
  warrantyTransport = 0;
  cashReceived = 0;
  bankPayment = 0;
  totalPayable = 0;
  totalPaymentsCredits = 0;
  finalBalance = 0;
  finalBalanceAmount = 0;

  private round2(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  ngOnInit() {
    const raw = this.route.snapshot.queryParamMap.get('edit');
    if (!raw) return;

    const sale = this.dataService.sales().find(s => s.id === Number(raw));
    if (!sale) {
      this.notify.error(this.prefs.txt('ইনভয়েসটি খুঁজে পাওয়া যায়নি।', 'Invoice not found.'), this.prefs.txt('ইনভয়েস পাওয়া যায়নি', 'Invoice not found'));
      this.router.navigate(['/sales']);
      return;
    }

    this.editSaleId.set(sale.id);
    this.orderStatus = sale.status;

    if (this.orderLock.isLocked(sale)) {
      this.pendingEditSale = sale;
      this.showEditPasscode.set(true);
      return;
    }

    this.loadSale(sale);
  }

  private loadSale(sale: Sale) {
    this.voucherNo = sale.invoice;
    this.saleDate = this.toInputDate(sale.date);
    this.saleDateText = dmyFromIso(this.saleDate);
    this.orderStatus = sale.status;
    this.nextPaymentDate = this.toInputDate(sale.nextPayDate);
    this.nextPaymentText = dmyFromIso(this.nextPaymentDate);
    this.preparedBy = sale.preparedBy || 'Admin';
    this.customerName = sale.customerName || 'Walk In Customer';
    this.selectedPartyId = this.dataService.partyForReference(sale.partyId, sale.customerName)?.id ?? sale.partyId;
    this.wholesaleMode = this.isDealerCustomer();
    this.shopName = sale.shopName || '';
    this.mobile = sale.mobile || '';
    this.address = sale.address || '';
    this.previousDue = Number(sale.previousDue) || 0;
    this.notes = sale.notes || '';

    this.selectedProducts.set((sale.items || []).map(i => ({ ...i, discountType: i.discountType || 'fixed' })));
    this.batteryAdjustments.set((sale.batteryAdjustments || []).map(b => ({ ...b })));
    this.returns.set((sale.returns || []).map(r => ({ ...r })));
    this.batteryEnabled.set((sale.batteryAdjustments || []).length > 0);
    this.returnsEnabled.set((sale.returns || []).length > 0);

    this.hasWarrantyClaim = !!sale.warranty;
    this.warranty = { ...this.emptyWarranty(), ...(sale.warranty || {}) };
    this.warrantyBatteryQuery.set(this.warranty.battery || '');
    if (this.hasWarrantyClaim) {
      if (!(this.warranty.claimNo || '').trim()) {
        this.warranty.claimNo = this.dataService.peekWarrantyReceiptNo();
      }
      if (!(this.warranty.originalInvoice || '').trim()) this.warranty.originalInvoice = sale.invoice || '';
      if (!(this.warranty.receiveDate || '').trim()) this.warranty.receiveDate = sale.date || localDateIso();
      if (!(Number(this.warranty.quantity) > 0)) this.warranty.quantity = '1';
    }

    this.transportLabour = Number(sale.shipping) || 0;
    this.warrantyTransport = Number(sale.warrantyTransport) || 0;
    this.cashReceived = Number(sale.cashReceived) || 0;
    this.bankPayment = Number(sale.bankPayment) || 0;
    this.orderDiscount = Number(sale.orderDiscount) || 0;
    this.orderDiscountType = sale.orderDiscountType || 'fixed';

    this.updateCalculations();
  }

  private toInputDate(value?: string): string {
    if (!value || value === '-') return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
    return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : '';
  }

  onSaleDateText(e: Event) {
    this.saleDateText = (e.target as HTMLInputElement).value;
  }

  commitSaleDate() {
    const iso = isoFromDmy(this.saleDateText);
    if (iso) this.saleDate = iso;
    this.saleDateText = dmyFromIso(this.saleDate) || this.saleDateText;
  }

  onSaleDatePicked(e: Event) {
    const iso = (e.target as HTMLInputElement).value;
    if (!iso) return;
    this.saleDate = iso;
    this.saleDateText = dmyFromIso(iso);
  }

  onNextPaymentText(e: Event) {
    this.nextPaymentText = (e.target as HTMLInputElement).value;
  }

  commitNextPayment() {
    const iso = isoFromDmy(this.nextPaymentText);
    if (iso) this.nextPaymentDate = iso;
    this.nextPaymentText = dmyFromIso(this.nextPaymentDate) || this.nextPaymentText;
  }

  onNextPaymentPicked(e: Event) {
    const iso = (e.target as HTMLInputElement).value;
    if (!iso) return;
    this.nextPaymentDate = iso;
    this.nextPaymentText = dmyFromIso(iso);
  }

  onEditPasscodeVerified(code: string) {
    const sale = this.pendingEditSale;
    if (!sale) return;
    if (!this.orderLock.unlock(sale.id, code)) return;
    this.showEditPasscode.set(false);
    this.pendingEditSale = null;
    this.loadSale(sale);
  }

  cancelEditUnlock() {
    this.showEditPasscode.set(false);
    this.pendingEditSale = null;
    this.leaving = true;
    this.router.navigate(['/sales']);
  }

  onCustomerChange() {
    const party = this.dataService.parties().find(p => p.name === this.customerName);
    if (!party) {
      this.shopName = '';
      this.mobile = '';
      this.address = '';
      this.previousDue = 0;
    } else {
      const company = (party.companyName || '').trim();
      this.shopName = company && !['N/A', '-'].includes(company) ? company : '';
      this.mobile = party.phone || '';
      this.address = party.address && party.address !== '-' ? party.address : '';
      this.previousDue = party ? salesAccountOf(party).due : 0;
    }
    this.updateCalculations();
  }

  openCustomerPicker() {
    this.customerQuery.set('');
    this.customerPickerOpen.set(true);
  }

  onCustomerSearchInput(e: Event) {
    this.customerQuery.set((e.target as HTMLInputElement).value);
    this.customerPickerOpen.set(true);
  }

  onCustomerKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.customerPickerOpen.set(false);
      this.customerQuery.set('');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = this.customerResults()[0];
      this.selectCustomer(first ? first.name : 'Walk In Customer');
    }
  }

  selectCustomer(name: string, partyId?: number) {
    this.selectedPartyId = partyId ?? this.dataService.partyForReference(undefined, name)?.id;
    const previousMode = this.wholesaleMode;
    this.customerName = name;
    this.customerPickerOpen.set(false);
    this.customerQuery.set('');
    this.onCustomerChange();

    const nextMode = this.isDealerCustomer()
      ? true
      : this.dataService.voucherSettings().allowWholesalePrice
        ? previousMode
        : false;
    if (nextMode !== previousMode) {
      this.wholesaleMode = nextMode;
      this.repriceLines(previousMode, nextMode);
      this.updateCalculations();
    }
  }

  isDealerCustomer(): boolean {
    return this.dataService.parties().some(p => p.name === this.customerName && hasPartyRole(p, 'Dealer'));
  }

  dueOf(party: Party): number {
    return salesAccountOf(party).due;
  }

  orderStatusLabel(status: Sale['status']): string {
    const map: Record<string, [string, string]> = {
      Completed: ['সম্পন্ন', 'Completed'],
      Ordered: ['অর্ডারকৃত', 'Ordered'],
      Confirmed: ['কনফার্মড', 'Confirmed'],
      Processing: ['প্রক্রিয়াধীন', 'Processing'],
      Shipping: ['শিপিং', 'Shipping'],
      Cancelled: ['বাতিল', 'Cancelled']
    };
    const pair = map[status];
    return pair ? this.prefs.txt(pair[0], pair[1]) : status;
  }

  isWalkInCustomer(): boolean {
    return (this.customerName || '').trim() === 'Walk In Customer';
  }

  /** Dealers always price at wholesale; other customers need the business setting. */
  showWholesaleSwitch(): boolean {
    return this.isDealerCustomer() || this.dataService.voucherSettings().allowWholesalePrice;
  }

  setWholesaleMode(enabled: boolean) {
    if (enabled === this.wholesaleMode || (enabled && !this.showWholesaleSwitch())) return;
    const previousMode = this.wholesaleMode;
    this.wholesaleMode = enabled;
    this.repriceLines(previousMode, enabled);
    this.updateCalculations();
  }

  /** Price shown on search cards for the currently active pricing mode. */
  quickPrice(prod: Product, variant?: ProductVariant): number {
    const retail = variant?.salesPrice ?? prod.salesPrice;
    if (!this.wholesaleMode) return retail;
    const wholesale = variant?.wholesalePrice ?? prod.wholesalePrice;
    return Number(wholesale) > 0 ? Number(wholesale) : retail;
  }

  private pricedItem(item: SaleItem): { product?: Product; variant?: ProductVariant } {
    const products = this.dataService.products();
    const product = item.productId != null
      ? products.find(p => p.id === item.productId)
      : products.find(p => item.productName === p.name || item.productName.startsWith(`${p.name} - `));
    const variant = product
      ? (product.variants || []).find(v =>
        item.productName === `${product.name} - ${v.variantValue}` ||
        item.productName === `${product.name} - ${v.variationName}`)
      : undefined;
    return { product, variant };
  }

  /** Default price for the line's own unit, so multi-unit lines reprice correctly. */
  private defaultLinePrice(item: SaleItem, wholesale: boolean): number | null {
    const { product, variant } = this.pricedItem(item);
    if (!product) return null;
    if (variant) {
      const chosen = wholesale && Number(variant.wholesalePrice) > 0 ? Number(variant.wholesalePrice) : variant.salesPrice;
      return chosen == null ? null : Number(chosen);
    }
    const price = unitPriceOf(product, item.unit, wholesale);
    return price > 0 ? price : null;
  }

  /** Only reprice lines still sitting on the previous default, so manual price edits survive. */
  private repriceLines(previousMode: boolean, nextMode: boolean) {
    this.selectedProducts.update(items => items.map(item => {
      const previous = this.defaultLinePrice(item, previousMode);
      const next = this.defaultLinePrice(item, nextMode);
      if (previous == null || next == null) return item;
      if (Math.abs((Number(item.salesPrice) || 0) - previous) > 0.005) return item;
      return { ...item, originalPrice: next, salesPrice: next };
    }));
  }

  clearCustomer(e: Event) {
    e.stopPropagation();
    this.selectCustomer('Walk In Customer');
  }

  onSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.productSearchQuery.set(val);
    this.isSearchDropdownOpen.set(true);
    this.searchIndex.set(0);
  }

  onProductSearchKeydown(event: KeyboardEvent) {
    const list = this.filteredProducts();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.isSearchDropdownOpen.set(true);
      this.searchIndex.set(Math.min(this.searchIndex() + 1, Math.max(0, list.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.searchIndex.set(Math.max(this.searchIndex() - 1, 0));
      return;
    }
    if (event.key === 'Escape') {
      this.isSearchDropdownOpen.set(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Enter honours the row the arrow keys highlighted; exact codes still win.
      const highlighted = list[this.searchIndex()];
      const hit = this.resolveSearchHit(
        this.productSearchQuery(),
        highlighted ? [highlighted, ...list] : list);
      if (!hit) return;
      this.addProductToSale(hit.product, hit.variant);
      this.clearProductSearch();
      this.productSearchInput()?.nativeElement.focus();
    }
  }

  /**
   * One typed or scanned string must land on the cheapest ambiguity: an exact
   * variant item code first, then an exact product code/name, then the top hit.
   */
  private resolveSearchHit(query: string, hits = this.filteredProducts()): { product: Product; variant?: ProductVariant } | null {
    const q = (query || '').trim().toLowerCase();
    if (!q) return null;
    const products = this.dataService.products();

    for (const product of products) {
      const variant = (product.variants || []).find(v =>
        String(v.itemCode ?? '').trim().toLowerCase() === q ||
        `${product.name} - ${v.variantValue}`.trim().toLowerCase() === q);
      if (variant) return { product, variant };
    }

    const parent = products.find(p =>
      String(p.code ?? '').trim().toLowerCase() === q ||
      p.name.trim().toLowerCase() === q);
    if (parent) return { product: parent };

    const first = hits[0];
    return first ? { product: first.product, variant: first.variant } : null;
  }

  clearProductSearch() {
    this.productSearchQuery.set('');
    this.isSearchDropdownOpen.set(false);
    this.searchIndex.set(0);
  }

  selectSearchEntry(hit: ProductSearchEntry) {
    this.addProductToSale(hit.product, hit.variant);
    this.clearProductSearch();
    this.productSearchInput()?.nativeElement.focus();
  }

  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('#product-search-container')) {
      this.isSearchDropdownOpen.set(false);
    }
    if (!target.closest('#return-search-container')) {
      this.isReturnSearchOpen.set(false);
    }
    if (!target.closest('#customer-search-container')) {
      this.customerPickerOpen.set(false);
    }
  }

  onBarcodeScan(code: string) {
    const trimmed = (code || '').trim();
    if (!trimmed) return;
    const hit = findScanMatch(this.dataService.products(), trimmed);
    if (hit) {
      this.addProductToSale(hit.product, hit.variant);
      return;
    }
    this.notify.warning(this.prefs.txt(`কোড বা বারকোডের সাথে মিলে এমন কোনো পণ্য পাওয়া যায়নি: "${code}"`, `No product found matching code or barcode: "${code}"`), this.prefs.txt('পণ্য পাওয়া যায়নি', 'Product not found'));
  }

  private productOf(item: SaleItem): Product | undefined {
    const products = this.dataService.products();
    if (item.productId != null) {
      const byId = products.find(p => p.id === item.productId);
      if (byId) return byId;
    }
    return products.find(p => item.productName === p.name || item.productName.startsWith(`${p.name} - `));
  }

  /**
   * Sellable stock for a product. While editing a completed voucher its own
   * quantities are added back, because the old posting already deducted them.
   */
  private productStock(product: Product): number | null {
    if (product.type === 'service') return null;
    let stock = Number(product.stock) || 0;
    const editingId = this.editSaleId();
    if (editingId != null) {
      const previous = this.dataService.sales().find(s => s.id === editingId);
      if (previous?.status === 'Completed') {
        stock += (previous.items ?? []).reduce((sum, item) => {
          const same = item.productId != null
            ? item.productId === product.id
            : item.productName === product.name || item.productName.startsWith(`${product.name} - `);
          return same ? sum + saleLineBaseQty(item) : sum;
        }, 0);
      }
    }
    return stock;
  }

  availableStock(item: SaleItem): number | null {
    const product = this.productOf(item);
    return product ? this.productStock(product) : null;
  }

  /** Selling units for the line's product; only multi-unit products get a picker. */
  unitChoices(item: SaleItem) {
    return productUnitChoices(this.productOf(item));
  }

  hasUnitChoices(item: SaleItem): boolean {
    return this.unitChoices(item).length > 1;
  }

  /** The product's base unit, which is what `availableStock` is counted in. */
  baseUnit(item: SaleItem): string {
    return this.productOf(item)?.unit || item.unit || 'pcs';
  }

  /** "১ ডজন = ১২ পিস" (or "১ প্যাকেট = ১৫ পিস") for extra-unit lines; empty for base-unit lines. */
  lineUnitNote(item: SaleItem): string {
    const base = this.baseUnit(item);
    const factor = Number(item.unitFactor) > 0 ? Number(item.unitFactor) : 1;
    const unit = item.unit || base;
    if (unit === base || !(factor > 0) || factor === 1) return '';
    if (factor > 1) return `১ ${unit} = ${factor} ${base}`;
    return `১ ${base} = ${Math.round((1 / factor) * 1000) / 1000} ${unit}`;
  }

  /** The line's quantity converted back to the product's base unit. */
  lineBaseQty(item: SaleItem): number {
    return saleLineBaseQty(item);
  }

  /**
   * Whole units of the line's own unit that the base-unit stock can cover —
   * 5000 গ্রাম covers only 5 × ১ কেজি lines, so clamps must convert.
   */
  maxQtyFor(item: SaleItem): number | null {
    const stock = this.availableStock(item);
    if (stock == null) return null;
    const factor = Number(item.unitFactor) > 0 ? Number(item.unitFactor) : 1;
    return Math.floor(Math.max(0, stock - this.reservedElsewhere(item)) / factor + 1e-9);
  }

  /** Base-unit stock other lines of the same product already hold. */
  private reservedElsewhere(item: SaleItem): number {
    return this.selectedProducts().reduce((sum, line) =>
      line !== item && this.sameProductLine(line, item) ? sum + saleLineBaseQty(line) : sum, 0);
  }

  private sameProductLine(a: SaleItem, b: SaleItem): boolean {
    return a.productId != null && b.productId != null
      ? a.productId === b.productId
      : a.productName === b.productName;
  }

  private matchesProductLine(prod: Product, variant: ProductVariant | undefined, line: SaleItem): boolean {
    if (line.productId != null) return line.productId === prod.id;
    const variantName = variant ? (variant.variantValue || variant.variationName || '') : '';
    return line.productName === (variantName ? `${prod.name} - ${variantName}` : prod.name);
  }

  private notifyStockLimit(item: SaleItem, stock: number) {
    const unit = this.baseUnit(item);
    this.notify.warning(this.prefs.txt(`${item.productName}: স্টকে মাত্র ${stock} ${unit} আছে।`, `${item.productName}: only ${stock} ${unit} in stock.`), this.prefs.txt('স্টক সীমা', 'Stock limit'));
  }

  onLineUnitChange(item: SaleItem, unitName?: string) {
    const product = this.productOf(item);
    if (!product) return;
    // Always price from the newly picked unit's own rate, never the previous one.
    const choice = unitChoiceOf(product, unitName ?? item.unit);
    item.unit = choice.name;
    item.unitFactor = choice.factor;
    item.originalPrice = unitPriceOf(product, choice.name, this.wholesaleMode);
    item.salesPrice = item.originalPrice;
    const max = this.maxQtyFor(item);
    if (max != null && item.quantity > max) item.quantity = Math.max(1, max);
    this.selectedProducts.update(items => [...items]);
    this.updateCalculations();
  }

  private stockLimitMessage(product: Product, stock: number): string {
    return this.prefs.txt(`${product.name}: স্টকে মাত্র ${stock} ${product.unit || 'pcs'} আছে।`, `${product.name}: only ${stock} ${product.unit || 'pcs'} in stock.`);
  }

  addProductToSale(prod: Product, variant?: ProductVariant) {
    const variantName = variant ? (variant.variantValue || variant.variationName || '') : '';
    const lineName = variantName ? `${prod.name} - ${variantName}` : prod.name;
    const unit = prod.unit || 'pcs';
    const stock = this.productStock(prod);
    // One line per selling unit: a পিস line and a ডজন line of the same product
    // stay apart so each keeps its own unit price and quantity.
    const existing = this.selectedProducts().find(p =>
      p.productName === lineName && (p.unit || unit) === unit);
    if (stock != null) {
      const inCart = this.selectedProducts().reduce((sum, line) =>
        this.matchesProductLine(prod, variant, line) ? sum + saleLineBaseQty(line) : sum, 0);
      if (stock <= 0) {
        this.notify.warning(this.prefs.txt(`${prod.name} স্টকে নেই — বিক্রি করা যাবে না।`, `${prod.name} is out of stock — cannot sell.`), this.prefs.txt('স্টক শেষ', 'Out of stock'));
        return;
      }
      if (inCart + unitFactorOf(prod, unit) > stock) {
        this.notify.warning(this.stockLimitMessage(prod, stock), this.prefs.txt('স্টক সীমা', 'Stock limit'));
        return;
      }
    }
    const price = this.quickPrice(prod, variant);
    if (existing) {
      existing.quantity += 1;
      this.selectedProducts.update(items => [...items]);
    } else {
      this.selectedProducts.update(items => [
        ...items,
        {
          id: this.dataService.newId(),
          productId: prod.id,
          productName: lineName,
          quantity: 1,
          unit,
          unitFactor: unitFactorOf(prod, unit),
          originalPrice: price,
          salesPrice: price,
          discount: 0,
          discountType: 'fixed',
          total: price
        }
      ]);
    }
    this.updateCalculations();
  }

  incrementQty(item: SaleItem) {
    const max = this.maxQtyFor(item);
    if (max != null && item.quantity + 1 > max) {
      this.notifyStockLimit(item, this.availableStock(item) ?? 0);
      return;
    }
    item.quantity += 1;
    this.updateCalculations();
  }

  /** Typing a quantity clamps to the stock on hand instead of selling air. */
  onQuantityInput(item: SaleItem, value: unknown) {
    const max = this.maxQtyFor(item);
    let quantity = Math.floor(Number(value) || 0);
    if (quantity < 1) quantity = 1;
    if (max != null && quantity > max) {
      quantity = Math.max(1, max);
      this.notifyStockLimit(item, this.availableStock(item) ?? 0);
    }
    item.quantity = quantity;
    this.updateCalculations();
  }

  decrementQty(item: SaleItem) {
    if (item.quantity > 1) {
      item.quantity -= 1;
      this.updateCalculations();
    }
  }

  removeItem(id: number) {
    this.selectedProducts.update(items => items.filter(i => i.id !== id));
    this.updateCalculations();
  }

  clearAllItems() {
    this.selectedProducts.set([]);
    this.updateCalculations();
  }

  getItemDiscount(item: SaleItem): number {
    const raw = (Number(item.quantity) || 0) * (Number(item.salesPrice) || 0);
    const disc = Number(item.discount) || 0;
    const value = item.discountType === 'percent' ? (raw * disc) / 100 : disc;
    return Math.min(Math.max(0, value), raw);
  }

  getItemSubtotal(item: SaleItem): number {
    const raw = (Number(item.quantity) || 0) * (Number(item.salesPrice) || 0);
    const finalTotal = Math.max(0, this.round2(raw - this.getItemDiscount(item)));
    item.total = finalTotal;
    return finalTotal;
  }

  getItemImage(item: SaleItem): string {
    const product = this.dataService.products().find(p => p.name === item.productName);
    return product?.image || '';
  }

  setLineDiscountType(item: SaleItem, type: 'fixed' | 'percent') {
    item.discountType = type;
    this.selectedProducts.update(items => [...items]);
    this.updateCalculations();
  }

  setOrderDiscountType(type: 'fixed' | 'percent') {
    this.orderDiscountType = type;
    this.updateCalculations();
  }

  toggleBattery(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    this.batteryEnabled.set(on);
    if (on && !this.batteryAdjustments().length) {
      this.addBatteryAdjustmentRow();
      return;
    }
    this.updateCalculations();
  }

  toggleReturns(e: Event) {
    this.returnsEnabled.set((e.target as HTMLInputElement).checked);
    this.updateCalculations();
  }

  // Old battery rows
  addBatteryAdjustmentRow() {
    const kind = BATTERY_KINDS[0];
    this.batteryAdjustments.update(items => [
      ...items,
      {
        id: this.dataService.newId(),
        description: this.batteryKindLabel(kind),
        kindKey: kind.key,
        unit: kind.unit === 'either' ? 'kg' : kind.unit,
        weightKg: 0,
        ratePerKg: 135,
        total: 0
      }
    ]);
    this.updateCalculations();
  }

  onBatteryKind(idx: number, e: Event) {
    const kindKey = (e.target as HTMLSelectElement).value;
    const kind = BATTERY_KINDS.find(k => k.key === kindKey) || BATTERY_KINDS[0];
    this.batteryAdjustments.update(items => items.map((item, i) => i === idx ? {
      ...item,
      kindKey: kind.key,
      description: this.batteryKindLabel(kind),
      unit: kind.unit === 'either' ? (item.unit || 'kg') : kind.unit
    } : item));
  }

  onBatteryUnit(idx: number, e: Event) {
    const unit = (e.target as HTMLSelectElement).value as BatteryUnit;
    this.batteryAdjustments.update(items => items.map((item, i) => i === idx ? { ...item, unit } : item));
  }

  removeBatteryAdjustmentRow(idx: number) {
    this.batteryAdjustments.update(items => items.filter((_, i) => i !== idx));
    this.updateCalculations();
  }

  updateBatteryWeight(idx: number, e: Event) {
    const input = e.target as HTMLInputElement;
    const unit = this.batteryAdjustments()[idx]?.unit || 'kg';
    const val = roundQty(Number(input.value) || 0, unit);
    if (unit === 'pcs' && input.value !== String(val)) input.value = String(val);
    this.batteryAdjustments.update(items => items.map((item, i) =>
      i === idx ? { ...item, weightKg: val, total: this.round2(val * item.ratePerKg) } : item
    ));
    this.updateCalculations();
  }

  normalizeBatteryWeightInput(idx: number, e: Event) {
    const input = e.target as HTMLInputElement;
    const row = this.batteryAdjustments()[idx];
    input.value = formatQtyInput(row?.weightKg ?? 0, row?.unit || 'kg');
  }

  updateBatteryRate(idx: number, e: Event) {
    const val = Number((e.target as HTMLInputElement).value) || 0;
    this.batteryAdjustments.update(items => items.map((item, i) =>
      i === idx ? { ...item, ratePerKg: val, total: this.round2(item.weightKg * val) } : item
    ));
    this.updateCalculations();
  }

  // Returned goods rows
  onReturnSearchInput(e: Event) {
    this.returnSearchQuery.set((e.target as HTMLInputElement).value);
    this.isReturnSearchOpen.set(true);
  }

  clearReturnSearch() {
    this.returnSearchQuery.set('');
    this.isReturnSearchOpen.set(false);
  }

  returnFromProduct(prod: Product, variant?: ProductVariant) {
    const variantName = variant ? (variant.variantValue || variant.variationName || '') : '';
    this.addReturnFromSearch(
      variantName ? `${prod.name} - ${variantName}` : prod.name,
      variant?.salesPrice ?? prod.salesPrice,
      prod.unit || 'pcs'
    );
  }

  returnFromInvoiceItem(sale: Sale, item: SaleItem) {
    this.addReturnFromSearch(`${item.productName} / ${sale.invoice}`, item.salesPrice, item.unit || 'pcs');
  }

  private addReturnFromSearch(itemName: string, rate: number, unit: string) {
    const safeRate = this.round2(rate);
    this.returns.update(items => [
      ...items,
      {
        id: this.dataService.newId(),
        item: itemName,
        qty: `1 ${unit}`,
        rate: safeRate,
        amount: safeRate
      }
    ]);
    this.updateCalculations();
    this.clearReturnSearch();
  }

  removeReturnRow(idx: number) {
    this.returns.update(items => items.filter((_, i) => i !== idx));
    this.updateCalculations();
  }

  updateReturnItem(idx: number, e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.returns.update(items => items.map((item, i) => i === idx ? { ...item, item: val } : item));
  }

  updateReturnQty(idx: number, e: Event) {
    const val = (e.target as HTMLInputElement).value;
    const qty = parseFloat(val) || 0;
    this.returns.update(items => items.map((item, i) =>
      i === idx ? { ...item, qty: val, amount: this.round2(qty * item.rate) } : item
    ));
    this.updateCalculations();
  }

  updateReturnRate(idx: number, e: Event) {
    const val = Number((e.target as HTMLInputElement).value) || 0;
    this.returns.update(items => items.map((item, i) => {
      if (i !== idx) return item;
      const qty = parseFloat(item.qty) || 0;
      return { ...item, rate: val, amount: this.round2(qty * val) };
    }));
    this.updateCalculations();
  }

  updateCalculations() {
    const items = this.selectedProducts();
    this.totalQuantity = items.reduce((acc, i) => acc + (Number(i.quantity) || 0), 0);
    this.lineDiscountTotal = this.round2(items.reduce((acc, i) => acc + this.getItemDiscount(i), 0));
    this.itemsNet = this.round2(items.reduce((acc, i) => acc + this.getItemSubtotal(i), 0));

    const orderDiscountValue = Number(this.orderDiscount) || 0;
    const rawOrderDiscount = this.orderDiscountType === 'percent'
      ? (this.itemsNet * orderDiscountValue) / 100
      : orderDiscountValue;
    this.orderDiscountAmount = this.round2(Math.min(Math.max(0, rawOrderDiscount), this.itemsNet));
    this.itemsAfterOrderDiscount = this.round2(this.itemsNet - this.orderDiscountAmount);

    this.oldBatteryCredit = this.batteryEnabled()
      ? this.round2(this.batteryAdjustments().reduce((acc, b) => acc + (Number(b.total) || 0), 0))
      : 0;
    this.returnsCredit = this.returnsEnabled()
      ? this.round2(this.returns().reduce((acc, r) => acc + (Number(r.amount) || 0), 0))
      : 0;

    this.totalVoucherBill = this.round2(
      this.itemsAfterOrderDiscount +
      (Number(this.transportLabour) || 0) +
      (Number(this.warrantyTransport) || 0)
    );

    this.totalPayable = this.round2(
      (Number(this.previousDue) || 0) +
      this.totalVoucherBill
    );

    this.totalPaymentsCredits = this.round2(
      (Number(this.cashReceived) || 0) +
      (Number(this.bankPayment) || 0) +
      this.oldBatteryCredit +
      this.returnsCredit
    );

    this.finalBalance = this.round2(this.totalPayable - this.totalPaymentsCredits);
    this.finalBalanceAmount = Math.abs(this.finalBalance);
  }

  get finalBalanceLabel(): string {
    if (this.finalBalance < 0) return this.prefs.txt('গ্রাহকের অগ্রিম', 'CUSTOMER ADVANCE');
    if (this.finalBalance === 0) return this.prefs.txt('সম্পূর্ণ পরিশোধিত', 'PAID IN FULL');
    return this.prefs.txt('চূড়ান্ত বাকি', 'FINAL DUE BALANCE');
  }

  getNextSequentialVoucherNo(): string {
    return this.dataService.peekSaleVoucherNo();
  }

  isDuplicateVoucher(): boolean {
    const code = (this.voucherNo || '').trim().toLowerCase();
    if (!code) return false;
    const editingId = this.editSaleId();
    return this.dataService.sales().some(s =>
      s.id !== editingId && (s.invoice || '').trim().toLowerCase() === code
    );
  }

  /** Anything the shopkeeper typed but has not saved yet. */
  hasUnsavedWork(): boolean {
    return this.selectedProducts().length > 0
      || this.batteryAdjustments().length > 0
      || this.returns().length > 0
      || this.hasWarrantyClaim
      || this.editSaleId() !== null
      || (this.customerName || 'Walk In Customer') !== 'Walk In Customer'
      || (this.notes || '').trim() !== ''
      || (Number(this.cashReceived) || 0) !== 0
      || (Number(this.bankPayment) || 0) !== 0
      || (Number(this.orderDiscount) || 0) !== 0;
  }

  private leaving = false;

  /** Router guard: ask before dropping the half-typed voucher. */
  async confirmLeave(): Promise<boolean> {
    if (this.leaving) return true;
    if (!this.hasUnsavedWork()) return true;
    const leave = await this.notify.confirm(
      this.prefs.txt('এই ভাউচারে আপনার দেওয়া তথ্য এখনো সেভ হয়নি। বের হলে পণ্য, গ্রাহক ও পেমেন্টের সব পরিবর্তন হারিয়ে যাবে।', 'This voucher is not saved yet. Leaving will discard all item, customer and payment changes.'),
      {
        title: this.prefs.txt('পাতা ছেড়ে যাবেন?', 'Leave this page?'),
        kind: 'warning',
        confirmText: this.prefs.txt('হ্যাঁ, বের হন', 'Yes, leave'),
        cancelText: this.prefs.txt('এখানে থাকুন', 'Stay here')
      }
    );
    if (!leave) return false;
    this.markLeaving();
    return true;
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.leaving || !this.hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private markLeaving() {
    this.leaving = true;
    const editingId = this.editSaleId();
    if (editingId !== null) this.orderLock.lock(editingId);
  }

  goBack() {
    this.router.navigate(['/sales']);
  }

  saveSale() {
    try { this.performSaveSale(); }
    catch (error) { this.notify.error(error instanceof Error ? error.message : 'Sale rejected.'); }
  }

  private performSaveSale() {
    // A warranty claim alone is a valid voucher: the customer hands in a battery
    // and no new sale line is required.
    if (!this.selectedProducts().length && !this.hasWarrantyClaim) {
      this.notify.error(this.prefs.txt('অনুগ্রহ করে অন্তত একটি পণ্য যোগ করুন!', 'Please add at least one item!'), this.prefs.txt('কোনো পণ্য নেই', 'No items'));
      return;
    }

    if (!this.voucherNo || !this.voucherNo.trim()) {
      this.notify.error(this.prefs.txt('ভাউচার নাম্বার লিখুন!', 'Enter a voucher number!'), this.prefs.txt('ভাউচার নাম্বার প্রয়োজন', 'Voucher number required'));
      return;
    }

    if (this.isDuplicateVoucher()) {
      this.notify.error(
        this.prefs.txt(
          `"${this.voucherNo.trim()}" ভাউচার নাম্বারটি আগেই ব্যবহৃত হয়েছে।\nপরবর্তী খালি সিরিয়াল "${this.getNextSequentialVoucherNo()}" ব্যবহার করুন।`,
          `Voucher number "${this.voucherNo.trim()}" is already used.\nUse the next free serial "${this.getNextSequentialVoucherNo()}".`
        ),
        this.prefs.txt('ডুপ্লিকেট ভাউচার', 'Duplicate voucher')
      );
      return;
    }

    if (this.hasWarrantyClaim) {
      if (!(this.warranty.claimNo || '').trim()) {
        this.warranty.claimNo = this.dataService.peekWarrantyReceiptNo();
      }
      if (!(this.warranty.originalInvoice || '').trim()) this.warranty.originalInvoice = this.voucherNo.trim();
      const claimError = this.validateWarrantyClaim();
      if (claimError) {
        this.notify.error(claimError, this.prefs.txt('ওয়ারেন্টি ক্লেইম অসম্পূর্ণ', 'Incomplete warranty claim'));
        return;
      }
    }

    const overStock = this.selectedProducts().find(item => {
      const stock = this.availableStock(item);
      if (stock == null) return false;
      // Lines of the same product in different units share one base-unit stock.
      const baseQty = this.selectedProducts()
        .filter(line => this.sameProductLine(line, item))
        .reduce((sum, line) => sum + saleLineBaseQty(line), 0);
      return baseQty > stock;
    });
    if (overStock) {
      const stock = this.availableStock(overStock) ?? 0;
      const unit = this.baseUnit(overStock);
      this.notify.error(
        this.prefs.txt(
          `"${overStock.productName}" এর স্টক ${stock} ${unit} — এর বেশি বিক্রি করা যাবে না।`,
          `"${overStock.productName}" stock is ${stock} ${unit} — cannot sell more.`
        ),
        this.prefs.txt('স্টক অপর্যাপ্ত', 'Insufficient stock')
      );
      return;
    }

    const finalInvoice = this.voucherNo.trim();
    const finalDate = this.saleDate || localDateIso();
    const batteryRows = this.batteryEnabled()
      ? this.batteryAdjustments().filter(b => (Number(b.total) || 0) > 0)
      : [];
    const returnRows = this.returnsEnabled()
      ? this.returns().filter(r => (r.item || '').trim() !== '' || (Number(r.amount) || 0) > 0)
      : [];
    const oldBatteryTotal = this.round2(batteryRows.reduce((acc, b) => acc + (Number(b.total) || 0), 0));
    const returnedTotal = this.round2(returnRows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0));

    const currentBill = this.round2(this.itemsAfterOrderDiscount + (Number(this.transportLabour) || 0) + (Number(this.warrantyTransport) || 0));
    const paid = this.round2((Number(this.cashReceived) || 0) + (Number(this.bankPayment) || 0));
    const due = Math.max(0, this.round2(currentBill - paid - oldBatteryTotal - returnedTotal));
    const pStatus = due <= 0 ? 'Paid' : (paid > 0 ? 'Partially Paid' : 'Unpaid');

    // A walk-in has no account to carry a balance, so the bill must be settled now.
    if (this.isWalkInCustomer() && due > 0) {
      this.notify.error(
        this.prefs.txt('ওয়াক-ইন কাস্টমারের বাকি রাখা যাবে না। পুরো বিল পরিশোধ করুন অথবা একজন পার্টি নির্বাচন করুন।', 'A walk-in customer cannot keep due. Collect the full bill or select a party.'),
        this.prefs.txt('ওয়াক-ইন কাস্টমার', 'Walk-in customer')
      );
      return;
    }

    const payload: Omit<Sale, 'id' | 'status'> = {
      invoice: finalInvoice,
      warehouse: 'SM Warehouse',
      date: finalDate,
      customerName: this.customerName,
      partyId: this.selectedPartyId,
      shopName: this.shopName,
      mobile: this.mobile,
      address: this.address,
      preparedBy: this.preparedBy,
      subtotal: this.itemsNet,
      discount: this.lineDiscountTotal,
      discountType: 'fixed',
      orderDiscount: Number(this.orderDiscount) || 0,
      orderDiscountType: this.orderDiscountType,
      total: currentBill,
      paid,
      due,
      previousDue: Number(this.previousDue) || 0,
      paymentStatus: pStatus,
      nextPayDate: this.nextPaymentDate || '-',
      notes: this.notes,
      shipping: Number(this.transportLabour) || 0,
      warrantyTransport: Number(this.warrantyTransport) || 0,
      cashReceived: Number(this.cashReceived) || 0,
      bankPayment: Number(this.bankPayment) || 0,
      paymentMode: (Number(this.cashReceived) || 0) > 0 && (Number(this.bankPayment) || 0) > 0
        ? 'Mixed'
        : (Number(this.cashReceived) || 0) > 0 ? 'Cash' : (Number(this.bankPayment) || 0) > 0 ? 'Bank' : undefined,
      returns: returnRows,
      warranty: this.hasWarrantyClaim ? this.warranty : undefined,
      batteryAdjustments: batteryRows,
      batteryAdjustmentTotal: oldBatteryTotal,
      items: this.selectedProducts()
    };

    const editingId = this.editSaleId();
    if (editingId !== null) {
      this.dataService.updateSale(editingId, { ...payload, status: this.orderStatus });
      this.orderLock.lock(editingId);
      this.session.log('Sale Updated', `${finalInvoice} — ${this.customerName} — ${currentBill.toFixed(2)} TK`);
      this.notify.success(this.prefs.txt(`ভাউচার #${finalInvoice} সফলভাবে আপডেট হয়েছে।`, `Voucher #${finalInvoice} updated successfully.`));
    } else {
      const saved = this.dataService.addSale({ ...payload, status: this.orderStatus });
      this.session.log('Sale Created', `${saved.invoice} — ${this.customerName} — ${currentBill.toFixed(2)} TK`);
      this.notify.success(this.prefs.txt(`ভাউচার #${saved.invoice} সফলভাবে সংরক্ষিত হয়েছে।`, `Voucher #${saved.invoice} saved successfully.`));
    }
    this.leaving = true;
    this.goBack();
  }
}
