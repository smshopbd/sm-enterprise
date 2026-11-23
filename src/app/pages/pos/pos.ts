import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, inject, Injector, signal, computed, viewChild, OnInit } from '@angular/core';
import { CommonModule, formatNumber } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormControl, FormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  DataService, Party, Product, ProductVariant, Sale, SaleItem,
  BATTERY_KINDS, BatteryAdjustmentItem, BatteryKind, BatteryUnit, SalesReturnItem, WarrantyClaimInfo,
  hasPartyRole, hasSalesRole, salesAccountOf
} from '../../services/data';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { MediaService } from '../../services/media';
import { ProductSearchEntry, searchProductEntries, variantLabel } from '../../utils/product-search';
import { saleItemDisplayName } from '../../utils/sale-item-label';
import { productUnitChoices, unitChoiceOf, unitFactorOf } from '../../utils/product-units';
import { hasProductModel } from '../../utils/product-models';
import { formatQtyInput, roundQty } from '../../utils/quantity';
import { DmyDateDirective } from '../../directives/dmy-date.directive';
import { toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';
import { localDateIso } from '../../utils/local-date';
import { NO_IMAGE } from '../../utils/no-image';
import { GeoSelect } from '../../components/geo-select/geo-select';
import { LoadMore } from '../../components/load-more/load-more';
import { BarcodeScanner } from '../../components/barcode-scanner/barcode-scanner';
import { ShareInvoiceComponent } from '../../components/share-invoice/share-invoice';
import { findScanMatch } from '../../utils/barcode-scan';
import { WARRANTY_STATUS_IN_PROGRESS, isWarrantyCompleted } from '../../utils/warranty';
import { qrDataUrl } from '../../utils/qr-code';
import { saleQrText } from '../../utils/voucher-qr';
import { printPosReceipt } from '../../utils/pos-receipt-print';

interface CartItem {
  product: Product;
  quantity: number;
  price: number;
  discount: number;
  discountType: 'fixed' | 'percent';
}

type PosPaymentMethod = 'Cash' | 'Card' | 'bKash' | 'Nagad';

type DrillLevel = 'category' | 'subcategory' | 'brand' | 'model';

interface PosReceipt {
  invoice: string;
  date: string;
  time: string;
  customer: string;
  phone: string;
  cashier: string;
  method: string;
  items: SaleItem[];
  subtotal: number;
  tax: number;
  discount: number;
  shipping: number;
  warrantyTransport: number;
  damage: number;
  previousDue: number;
  batteryCredit: number;
  returnsCredit: number;
  total: number;
  paid: number;
  change: number;
  due: number;
  /** Offline QR data URL for the public voucher page; empty when disabled. */
  qrUrl?: string;
  /** Optional memo text typed at checkout; printed above the QR. */
  notes?: string;
  warranty?: WarrantyClaimInfo;
}

@Component({
  selector: 'app-pos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, MatIconModule, GeoSelect, DmyDateDirective, LoadMore, BarcodeScanner, ShareInvoiceComponent],
  template: `
    <div class="h-full min-h-0 flex flex-col overflow-hidden text-slate-800 dark:text-slate-100 text-xs select-none bg-[#f8fafc] dark:bg-slate-950">

      <ng-template #customerListTpl>
        <button type="button" (click)="selectCustomer(null)"
          class="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left border-b border-slate-100">
          <span class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
            <mat-icon class="text-base">directions_walk</mat-icon>
          </span>
          <span class="font-bold text-slate-700">{{ prefs.t('pos.walkIn') }}</span>
          @if (selectedCustomerName() === 'Walk In Customer') {
            <mat-icon class="ml-auto text-teal-600 text-base">check</mat-icon>
          }
        </button>
        <div class="max-h-[55vh] sm:max-h-[min(16rem,46vh)] overflow-y-auto overscroll-contain">
          @for (p of customerResults(); track p.id; let i = $index) {
            <button type="button" (click)="selectCustomer(p)"
              class="w-full flex items-center gap-2 px-3 py-2 border-b border-slate-50 last:border-0 text-left hover:bg-teal-50/60 transition-colors"
              [class.bg-teal-50]="i === customerIndex()">
              <span class="w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-black shrink-0">{{ p.name.charAt(0) }}</span>
              <span class="min-w-0 flex-1">
                <span class="block font-bold text-slate-800 truncate">{{ p.name }}</span>
                <span class="block text-[10px] text-slate-500 truncate">{{ rolesOf(p) }} • {{ p.phone || prefs.t('pos.noPhone') }}</span>
              </span>
              <span class="text-right shrink-0">
                <span class="block text-[9px] uppercase text-slate-400 font-bold">{{ prefs.t('pos.previousDue') }}</span>
                <span class="block font-mono font-bold" [class.text-rose-600]="dueOf(p) > 0">{{ dueOf(p) | number:'1.2-2' }}</span>
              </span>
            </button>
          } @empty {
            <p class="px-3 py-5 text-center text-slate-400 font-semibold">{{ prefs.t('pos.noCustomer') }}</p>
          }
        </div>
      </ng-template>

      <ng-template #searchHitTpl let-hit>
        <div (click)="pickSearchHit(hit)"
          class="p-2.5 hover:bg-teal-50 active:bg-teal-100 dark:hover:bg-teal-950/40 dark:active:bg-teal-950/60 cursor-pointer flex items-center gap-3 border-b border-slate-50 dark:border-slate-800 last:border-b-0">
          <img [src]="hit.variant?.image || hit.product.image || noImage" [alt]="hit.product.name" class="w-10 h-10 object-cover rounded shrink-0" referrerpolicy="no-referrer" loading="lazy" decoding="async" />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-bold text-slate-800 dark:text-slate-100 leading-tight truncate">{{ hit.product.name }}
              @if (hit.variant) {
                <span class="ml-1 inline-flex items-center rounded bg-violet-100 px-1 py-0.5 text-[8.5px] font-black text-violet-700 align-middle">{{ variantLabelOf(hit.variant) }}</span>
              }
              @if (entryStock(hit) <= 0) {
                <span class="ml-1 inline-flex items-center rounded bg-rose-100 px-1 py-0.5 text-[8.5px] font-black text-rose-600 align-middle">{{ prefs.txt('স্টক নেই', 'Out of stock') }}</span>
              }
            </div>
            <div class="text-[10px] text-slate-600 dark:text-slate-400 font-semibold mt-0.5 grid grid-cols-2 gap-x-2">
              <span class="truncate">Code: {{ entryCode(hit) }}</span>
              <span class="truncate">Category: {{ hit.product.category }}</span>
              <span class="truncate">Brand: {{ hit.product.brand }}</span>
              <span class="truncate">Model: {{ hit.product.model }}</span>
              <span class="font-bold" [class.text-rose-600]="entryStock(hit) <= 0" [class.text-teal-700]="entryStock(hit) > 0">Stock: {{ entryStock(hit) }} {{ hit.product.unit }}</span>
              <span class="font-bold text-teal-700 dark:text-teal-300">Sale: {{ entrySale(hit) | number:'1.2-2' }} TK</span>
              <span class="font-bold text-sky-700 dark:text-sky-300">WS: {{ entryWholesaleText(hit) }}</span>
            </div>
          </div>
          <mat-icon class="text-teal-600 text-base shrink-0">add_circle</mat-icon>
        </div>
      </ng-template>

      <ng-template #returnResultsTpl>
        @for (inv of returnInvoiceMatches(); track inv.id) {
          <div>
            <div class="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-600 dark:text-slate-300">
              <span class="flex items-center gap-1 min-w-0">
                <mat-icon style="font-size:12px;width:12px;height:12px;" class="text-teal-600">receipt_long</mat-icon>
                <span class="font-mono truncate">{{ inv.invoice }}</span>
                <span class="truncate">— {{ inv.customerName }}</span>
              </span>
              <span class="shrink-0">{{ inv.date }}</span>
            </div>
            @for (it of inv.items; track it.id) {
              <button type="button" (click)="returnFromInvoiceItem(inv, it)"
                class="w-full text-left px-2.5 py-2 hover:bg-teal-50/80 active:bg-teal-100 dark:hover:bg-teal-950/40 dark:active:bg-teal-950/60 flex items-center justify-between gap-2">
                <span class="min-w-0">
                  <span class="block font-bold text-slate-900 dark:text-slate-100 text-[11px] truncate">{{ savedItemLabel(it) }}</span>
                  <span class="block text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('বিক্রি', 'Sold') }}: {{ it.quantity }} {{ it.unit || 'pcs' }} | {{ inv.invoice }}</span>
                </span>
                <span class="text-right shrink-0 font-mono font-bold text-teal-800 dark:text-teal-300 text-[11px]">{{ it.salesPrice | number:'1.2-2' }} TK</span>
              </button>
            }
          </div>
        }
        @for (hit of returnProductMatches(); track hit.product.id + '-' + (hit.variant?.id ?? 0)) {
          <button type="button" (click)="returnFromProduct(hit.product, hit.variant)"
            class="w-full text-left px-2.5 py-2 hover:bg-teal-50/80 active:bg-teal-100 dark:hover:bg-teal-950/40 dark:active:bg-teal-950/60 flex items-center justify-between gap-2">
            <span class="min-w-0">
              <span class="block font-bold text-slate-900 dark:text-slate-100 text-[11px] truncate">{{ hit.product.name }}
                @if (hit.variant) {
                  <span class="ml-1 inline-flex items-center rounded bg-violet-100 px-1 py-0.5 text-[8.5px] font-black text-violet-700 align-middle">{{ variantLabelOf(hit.variant) }}</span>
                }
              </span>
              <span class="block text-[10px] text-slate-500 dark:text-slate-400 font-mono">Code: {{ entryCode(hit) }} | Stock: {{ entryStock(hit) }} {{ hit.product.unit || 'pcs' }}</span>
            </span>
            <span class="text-right shrink-0 font-mono font-bold text-teal-800 dark:text-teal-300 text-[11px]">{{ entrySale(hit) | number:'1.2-2' }} TK</span>
          </button>
        }
        @if (returnInvoiceMatches().length === 0 && returnProductMatches().length === 0) {
          <p class="px-2.5 py-2.5 text-center text-slate-500 text-[11px]">{{ prefs.txt('কোনো পণ্য বা ভাউচার পাওয়া যায়নি।', 'No product or invoice found.') }}</p>
        }
      </ng-template>

      @if (isPhone()) {
        <div class="flex-1 min-h-0 flex flex-col bg-[#eef4f3] dark:bg-slate-950" [formGroup]="posForm">

          <!-- Phone header -->
          <div class="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 py-2">
            <div class="flex items-center gap-2">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-800 text-white shadow-sm">
                <mat-icon style="font-size:20px;width:20px;height:20px;">point_of_sale</mat-icon>
              </span>
              <div class="min-w-0 flex-1 leading-tight">
                <p class="text-[13px] font-black tracking-tight text-slate-800 dark:text-slate-100">POS</p>
                <p class="truncate text-[9.5px] font-bold uppercase tracking-wide text-slate-400">
                  {{ nextInvoiceNo() }} · {{ prefs.txt('দ্রুত বিক্রয়', 'Quick sale') }}
                </p>
              </div>
              @if (!session.has('editPrice')) {
                <span class="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-1.5 py-1 text-[9px] font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  [title]="prefs.t('pos.priceLocked')">
                  <mat-icon style="font-size:13px;width:13px;height:13px;">lock</mat-icon>
                </span>
              }
              <button type="button" (click)="togglePosQr()" [attr.aria-pressed]="settings().showPosQrCode"
                [title]="settings().showPosQrCode ? prefs.txt('POS রশিদে QR চালু আছে — বন্ধ করতে চাপুন', 'POS receipt QR is on — tap to turn off') : prefs.txt('POS রশিদে QR বন্ধ আছে — চালু করতে চাপুন', 'POS receipt QR is off — tap to turn on')"
                class="grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-colors active:scale-95"
                [ngClass]="settings().showPosQrCode
                  ? 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
                  : 'border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500'">
                <mat-icon style="font-size:20px;width:20px;height:20px;">qr_code_2</mat-icon>
              </button>
              @if (mobileTab() === 'products') {
                <button type="button" (click)="mobileTab.set('cart')" [attr.aria-label]="prefs.t('pos.cart')"
                  class="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors active:scale-95 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <mat-icon style="font-size:20px;width:20px;height:20px;">shopping_cart</mat-icon>
                  @if (cartCount() > 0) {
                    <span class="absolute -right-1 -top-1 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[9px] font-black leading-4 text-white">{{ cartCount() }}</span>
                  }
                </button>
              }
            </div>
          </div>

          @if (mobileTab() === 'products') {
            <!-- Search + customer -->
            <div class="shrink-0 px-3 pt-2.5">
              <div class="flex items-center gap-2">
                <div class="relative min-w-0 flex-1">
                  <mat-icon class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" style="font-size:19px;width:19px;height:19px;">search</mat-icon>
                  <input
                    #posSearch
                    type="text"
                    [formControl]="searchControl"
                    (input)="openPhoneSearch()"
                    (keydown.enter)="addFirstSearchResult()"
                    [placeholder]="prefs.txt('পণ্যের নাম, কোড বা বারকোড…', 'Name, code or barcode…')"
                    autocomplete="off"
                    class="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-9 text-[16px] font-semibold text-slate-800 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  @if (searchQuery()) {
                    <button type="button" (click)="searchControl.setValue(''); closePhoneSearch()"
                      [attr.aria-label]="prefs.txt('সার্চ মুছুন', 'Clear search')"
                      class="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 active:bg-slate-100 dark:active:bg-slate-800">
                      <mat-icon style="font-size:17px;width:17px;height:17px;">close</mat-icon>
                    </button>
                  }
                </div>
                <button type="button" (click)="openCustomerPicker()" [attr.aria-label]="prefs.t('pos.searchCustomer')"
                  class="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl border transition-colors active:scale-95"
                  [class]="selectedParty() ? 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-950/50 dark:text-teal-300' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'">
                  <mat-icon style="font-size:21px;width:21px;height:21px;">person_search</mat-icon>
                  @if (selectedParty()) {
                    <span class="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900"></span>
                  }
                </button>
              </div>

              @if (selectedParty(); as c) {
                <div class="mt-2 flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50/80 px-2.5 py-1.5 text-[10px] font-bold text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100">
                  <mat-icon style="font-size:13px;width:13px;height:13px;">badge</mat-icon>
                  <span class="min-w-0 flex-1 truncate">{{ c.name }}</span>
                  @if (dealerPricing()) {
                    <span class="shrink-0 rounded bg-sky-100 px-1 py-0.5 text-[8.5px] font-black uppercase text-sky-700">{{ prefs.txt('পাইকারি', 'Wholesale') }}</span>
                  }
                  <span class="shrink-0 whitespace-nowrap text-[9.5px] font-semibold text-teal-800 dark:text-teal-200">
                    {{ prefs.t('pos.previousDue') }}:
                    <b class="font-mono" [class.text-rose-600]="dueOf(c) > 0">{{ dueOf(c) | number:'1.2-2' }}</b>
                  </span>
                </div>
              }
            </div>

            <!-- Category chips -->
            <div class="shrink-0 pt-2">
              <div #categoryChips class="flex gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                @if (currentView() !== 'all') {
                  <button type="button" (click)="navigateBack()"
                    [title]="prefs.txt(drillFolderName() + ' থেকে ফিরে যান', 'Back from ' + drillFolderName())"
                    class="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 active:scale-95 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    <mat-icon style="font-size:15px;width:15px;height:15px;">arrow_back</mat-icon>
                    {{ prefs.txt('ফিরে যান', 'Back') }}
                  </button>
                  <span class="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-2.5 text-[11px] font-bold text-teal-800 shadow-[0_2px_8px_rgba(13,148,136,0.3)] ring-2 ring-teal-200 dark:border-teal-700 dark:bg-teal-950/50 dark:text-teal-200">
                    <mat-icon style="font-size:15px;width:15px;height:15px;">folder_open</mat-icon>
                    <span class="max-w-[104px] truncate">{{ drillFolderName() }}</span>
                  </span>
                }
                <button type="button" (click)="pickCategory('All')"
                  class="h-8 shrink-0 rounded-full border px-3 text-[11px] font-bold transition-colors active:scale-95"
                  [ngClass]="currentView() === 'all' ? 'border-transparent bg-teal-600 text-white shadow-[0_3px_10px_rgba(13,148,136,0.45)] ring-2 ring-teal-300/70' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'">
                  {{ prefs.txt('সব', 'All') }}
                </button>
                @switch (currentView()) {
                  @case ('all') {
                    @for (cat of activeCategories(); track cat.id) {
                      <button type="button" (click)="pickCategory(cat.name)"
                        [title]="isLastOpened('category', cat.name) ? prefs.txt('সর্বশেষ খোলা ফোল্ডার', 'Last opened folder') : cat.name"
                        class="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[11px] font-bold transition-colors active:scale-95"
                        [ngClass]="selectedCategory() === cat.name ? 'border-transparent bg-teal-600 text-white shadow-[0_3px_10px_rgba(13,148,136,0.45)] ring-2 ring-teal-300/70' : isLastOpened('category', cat.name) ? 'border-teal-300 bg-teal-50 text-teal-800 ring-2 ring-teal-200 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-200' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'">
                        @if (isLastOpened('category', cat.name)) {
                          <mat-icon style="font-size:14px;width:14px;height:14px;">folder_open</mat-icon>
                        }
                        {{ cat.name }}
                      </button>
                    }
                  }
                  @case ('category') {
                    @for (sub of activeSubCategories(); track sub.id) {
                      <button type="button" (click)="pickSubCategory(sub.name)"
                        [title]="isLastOpened('subcategory', sub.name) ? prefs.txt('সর্বশেষ খোলা ফোল্ডার', 'Last opened folder') : sub.name"
                        class="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[11px] font-bold transition-colors active:scale-95"
                        [ngClass]="selectedSubCategory() === sub.name ? 'border-transparent bg-teal-600 text-white shadow-[0_3px_10px_rgba(13,148,136,0.45)] ring-2 ring-teal-300/70' : isLastOpened('subcategory', sub.name) ? 'border-teal-300 bg-teal-50 text-teal-800 ring-2 ring-teal-200 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-200' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'">
                        @if (isLastOpened('subcategory', sub.name)) {
                          <mat-icon style="font-size:14px;width:14px;height:14px;">folder_open</mat-icon>
                        }
                        {{ sub.name }}
                      </button>
                    }
                  }
                  @case ('subcategory') {
                    @for (brand of activeBrands(); track brand.id) {
                      <button type="button" (click)="pickBrand(brand.name)"
                        [title]="isLastOpened('brand', brand.name) ? prefs.txt('সর্বশেষ খোলা ফোল্ডার', 'Last opened folder') : brand.name"
                        class="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[11px] font-bold transition-colors active:scale-95"
                        [ngClass]="selectedBrand() === brand.name ? 'border-transparent bg-teal-600 text-white shadow-[0_3px_10px_rgba(13,148,136,0.45)] ring-2 ring-teal-300/70' : isLastOpened('brand', brand.name) ? 'border-teal-300 bg-teal-50 text-teal-800 ring-2 ring-teal-200 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-200' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'">
                        @if (isLastOpened('brand', brand.name)) {
                          <mat-icon style="font-size:14px;width:14px;height:14px;">folder_open</mat-icon>
                        }
                        {{ brand.name }}
                      </button>
                    }
                  }
                  @case ('brand') {
                    @for (model of activeModels(); track model.id) {
                      <button type="button" (click)="pickModel(model.name)"
                        [title]="isLastOpened('model', model.name) ? prefs.txt('সর্বশেষ খোলা ফোল্ডার', 'Last opened folder') : model.name"
                        class="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[11px] font-bold transition-colors active:scale-95"
                        [ngClass]="selectedModel() === model.name ? 'border-transparent bg-teal-600 text-white shadow-[0_3px_10px_rgba(13,148,136,0.45)] ring-2 ring-teal-300/70' : isLastOpened('model', model.name) ? 'border-teal-300 bg-teal-50 text-teal-800 ring-2 ring-teal-200 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-200' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'">
                        @if (isLastOpened('model', model.name)) {
                          <mat-icon style="font-size:14px;width:14px;height:14px;">folder_open</mat-icon>
                        }
                        {{ model.name }}
                      </button>
                    }
                  }
                  @case ('model') {
                    <span class="flex h-8 shrink-0 items-center gap-1 rounded-full border border-transparent bg-teal-600 px-3 text-[11px] font-bold text-white">
                      <mat-icon style="font-size:14px;width:14px;height:14px;">filter_alt</mat-icon>
                      {{ selectedModel() }}
                    </span>
                  }
                }
              </div>
            </div>

            <!-- Product grid -->
            <div #mobileProductGrid class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
              <div class="grid grid-cols-3 gap-1.5 sm:gap-2 content-start">
                @for (p of visibleProducts(); track p.id) {
                  <button type="button" (click)="addToCart(p)" [disabled]="p.stock <= 0" [title]="p.name"
                    class="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition active:scale-[0.97] disabled:opacity-55 disabled:grayscale dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
                    <span class="relative block aspect-square w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                      <img [src]="p.image || noImage" [alt]="p.name"
                        class="h-full w-full object-cover transition-transform duration-200 group-active:scale-105"
                        referrerpolicy="no-referrer" loading="lazy" decoding="async" />
                      <span class="absolute left-1 top-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-white/90 px-1 py-0.5 font-mono text-[8px] font-bold text-slate-600 backdrop-blur-sm dark:bg-slate-950/80 dark:text-slate-300">{{ p.code }}</span>
                      @if (p.stock <= 0) {
                        <span class="absolute bottom-1 right-1 rounded bg-rose-600 px-1 py-0.5 text-[8px] font-black uppercase text-white">{{ prefs.txt('শেষ', 'Out') }}</span>
                      } @else {
                        <span class="absolute bottom-1 right-1 rounded bg-slate-900/70 px-1 py-0.5 text-[8px] font-bold text-white backdrop-blur-sm">{{ p.stock }} {{ p.unit }}</span>
                      }
                    </span>
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5 p-1.5">
                      <span class="line-clamp-2 min-h-[2.3em] text-[10.5px] font-black leading-[1.15] tracking-tight text-slate-800 dark:text-slate-100">{{ p.name }}</span>
                      <span class="truncate text-[8.5px] font-semibold text-slate-400 dark:text-slate-500">
                        {{ p.brand && p.brand !== '-' ? p.brand : p.category }}
                      </span>
                      <span class="mt-auto flex items-center justify-between gap-0.5 pt-1">
                        <span class="min-w-0 truncate font-mono text-[11px] font-black tracking-tight text-teal-700 dark:text-teal-300">
                          {{ p.salesPrice | number:'1.2-2' }}<span class="ml-0.5 text-[8px] font-bold">TK</span>
                        </span>
                        <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal-600 text-white shadow-sm dark:bg-teal-500">
                          <mat-icon style="font-size:13px;width:13px;height:13px;">add</mat-icon>
                        </span>
                      </span>
                    </span>
                  </button>
                } @empty {
                  <div class="col-span-full py-14 text-center text-slate-400 dark:text-slate-500">
                    <mat-icon style="font-size:36px;width:36px;height:36px;" class="text-slate-300">inventory_2</mat-icon>
                    <p class="mt-1 text-[11px] font-semibold">{{ prefs.txt('এই নির্বাচনে কোনো পণ্য নেই', 'No products in this selection') }}</p>
                  </div>
                }
                @if (remainingProducts() > 0) {
                  <app-load-more class="col-span-full mt-1" [remaining]="remainingProducts()"
                    [label]="prefs.txt('আরও পণ্য দেখুন', 'Load more products')" (load)="showMoreProducts()" />
                }
              </div>
            </div>

            <!-- Floating cart bar -->
            @if (cartCount() > 0) {
              <div class="shrink-0 border-t border-slate-200 bg-white px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] dark:border-slate-800 dark:bg-slate-900">
                <button type="button" (click)="mobileTab.set('cart')"
                  class="flex w-full items-center justify-between gap-2 rounded-2xl bg-gradient-to-r from-teal-600 to-teal-700 px-3 py-2 text-white shadow-lg shadow-teal-900/25 transition active:scale-[0.99]">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15">
                      <mat-icon style="font-size:19px;width:19px;height:19px;">shopping_basket</mat-icon>
                      <span class="absolute -right-1 -top-1 min-w-4 rounded-full bg-white px-1 text-center text-[9px] font-black leading-4 text-teal-700">{{ cartCount() }}</span>
                    </span>
                    <span class="min-w-0 text-left leading-tight">
                      <span class="block text-[12px] font-black">{{ cartCount() }} {{ prefs.t('pos.items') }}</span>
                      <span class="block truncate text-[9.5px] font-semibold text-teal-50/90">{{ prefs.txt('কার্ট দেখে পেমেন্ট করুন', 'Review cart & pay') }}</span>
                    </span>
                  </span>
                  <span class="flex shrink-0 items-center gap-1">
                    <span class="whitespace-nowrap font-mono text-[14px] font-black">{{ payTotal() | number:'1.2-2' }} TK</span>
                    <mat-icon style="font-size:18px;width:18px;height:18px;">chevron_right</mat-icon>
                  </span>
                </button>
              </div>
            }
          } @else {
            <!-- Cart screen -->
            <div class="shrink-0 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
              <button type="button" (click)="mobileTab.set('products')" [attr.aria-label]="prefs.t('pos.products')"
                class="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 active:scale-95 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <mat-icon style="font-size:19px;width:19px;height:19px;">arrow_back</mat-icon>
              </button>
              <div class="min-w-0 flex-1 leading-tight">
                <p class="text-[13px] font-black text-slate-800 dark:text-slate-100">
                  {{ prefs.t('pos.cart') }}
                  <span class="ml-1 rounded-full bg-teal-100 px-1.5 py-0.5 text-[9.5px] font-black text-teal-700 dark:bg-teal-950/70 dark:text-teal-300">{{ cartCount() }} {{ prefs.t('pos.items') }}</span>
                </p>
                <p class="truncate text-[9.5px] font-bold uppercase tracking-wide text-slate-400">{{ nextInvoiceNo() }}</p>
              </div>
              <button type="button" (click)="resetCart()" [disabled]="!cartArray.length" [title]="prefs.txt('কার্ট খালি করুন', 'Clear cart')"
                class="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 active:scale-95 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <mat-icon style="font-size:18px;width:18px;height:18px;">delete_sweep</mat-icon>
              </button>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2.5 space-y-2">
              <!-- Customer -->
              <button type="button" (click)="openCustomerPicker()"
                class="flex w-full items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800">
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                  <mat-icon style="font-size:18px;width:18px;height:18px;">person</mat-icon>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('কাস্টমার', 'Customer') }}</span>
                  <span class="block truncate text-[12px] font-black text-slate-800 dark:text-slate-100">{{ customerLabel() }}</span>
                </span>
                @if (selectedParty(); as c) {
                  <span class="shrink-0 text-right">
                    <span class="block text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.t('pos.previousDue') }}</span>
                    <span class="block font-mono text-[11px] font-black" [class.text-rose-600]="dueOf(c) > 0">{{ dueOf(c) | number:'1.2-2' }}</span>
                  </span>
                }
                <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  <mat-icon style="font-size:16px;width:16px;height:16px;">swap_horiz</mat-icon>
                </span>
              </button>

              <!-- Order status -->
              <div class="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
                <mat-icon class="text-slate-400" style="font-size:16px;width:16px;height:16px;">flag</mat-icon>
                <select formControlName="status" [attr.aria-label]="prefs.txt('অর্ডার স্ট্যাটাস', 'Order status')"
                  class="min-w-0 flex-1 bg-transparent py-1 text-[11px] font-bold text-slate-700 outline-none dark:text-slate-200">
                  <option value="Ordered">{{ prefs.txt('অর্ডারকৃত', 'Ordered') }}</option>
                  <option value="Processing">{{ prefs.txt('প্রক্রিয়াধীন', 'Processing') }}</option>
                  <option value="Shipping">{{ prefs.txt('শিপিং', 'Shipping') }}</option>
                  <option value="Completed">{{ prefs.txt('সম্পন্ন', 'Completed') }}</option>
                  <option value="Service Provider">{{ prefs.txt('সার্ভিস প্রোভাইডার', 'Service Provider') }}</option>
                  <option value="Cancelled">{{ prefs.txt('বাতিল', 'Cancelled') }}</option>
                </select>
                <mat-icon class="pointer-events-none text-slate-400" style="font-size:18px;width:18px;height:18px;">expand_more</mat-icon>
              </div>

              <!-- Cart lines -->
              <div formArrayName="cart" class="space-y-2">
                @for (item of cartArray.controls; track item; let idx = $index) {
                  <div [formGroupName]="idx"
                    class="rounded-2xl border p-2.5 shadow-xs text-slate-800 dark:text-slate-100"
                    [ngClass]="cartItemTheme(idx)">
                    <div class="flex items-start gap-2">
                      <img [src]="item.value.product.image || noImage" [alt]="item.value.product.name"
                        class="h-11 w-11 shrink-0 rounded-xl border border-white/70 object-cover dark:border-slate-700"
                        referrerpolicy="no-referrer" loading="lazy" decoding="async" />
                      <div class="min-w-0 flex-1">
                        <p class="line-clamp-2 text-[11.5px] font-black leading-tight">{{ item.value.product.name }}</p>
                        @if (item.value.variant) {
                          <p class="text-[9px] font-bold text-violet-700 dark:text-violet-300">{{ variantLabelOf(item.value.variant) }}</p>
                        }
                        <p class="mt-0.5 truncate text-[9px] font-semibold text-slate-600 dark:text-slate-400">
                          {{ prefs.txt('কোড', 'Code') }} {{ item.value.product.code }} ·
                          {{ prefs.txt('স্টক', 'Stock') }} {{ item.value.variant ? item.value.variant.openingStock : item.value.product.stock }} {{ item.value.product.unit }}
                        </p>
                        @if (lineUnitNote(item.value)) {
                          <p class="mt-0.5 truncate text-[9px] font-bold text-teal-700 dark:text-teal-300">
                            {{ lineUnitNote(item.value) }} · {{ item.value.quantity }} {{ item.value.unit }} = {{ lineBaseQty(item.value) }} {{ item.value.product.unit }}
                          </p>
                        }
                      </div>
                      <button type="button" (click)="removeItem(idx)" [attr.aria-label]="prefs.txt('সরান', 'Remove')"
                        class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/70 text-rose-500 active:scale-95 dark:bg-slate-900/60">
                        <mat-icon style="font-size:16px;width:16px;height:16px;">delete</mat-icon>
                      </button>
                    </div>

                    <div class="mt-2 flex items-center justify-between gap-2">
                      <div class="flex items-center overflow-hidden rounded-xl border border-slate-300/70 bg-white dark:border-slate-600 dark:bg-slate-900">
                        <button type="button" (click)="bumpQty(idx, -1)" [attr.aria-label]="prefs.txt('বিয়োগ', 'Decrease')"
                          class="grid h-9 w-9 place-items-center text-[17px] font-black text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-slate-800">−</button>
                        <input type="number" formControlName="quantity"
                          [attr.max]="maxLineQty(item)"
                          (change)="onQtyInput(idx, $event)"
                          class="h-9 w-11 border-x border-slate-300/70 bg-transparent text-center text-[12px] font-black outline-none dark:border-slate-600 dark:text-slate-100" />
                        <button type="button" (click)="bumpQty(idx, 1)" [attr.aria-label]="prefs.txt('যোগ', 'Increase')"
                          class="grid h-9 w-9 place-items-center text-[17px] font-black text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-slate-800">+</button>
                      </div>

                      <label class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        {{ prefs.txt('দর', 'Rate') }}
                        <input type="number" formControlName="price" [readonly]="!session.has('editPrice')"
                          [title]="session.has('editPrice') ? '' : prefs.t('pos.priceLocked')"
                          class="w-16 rounded-lg border border-slate-300/70 bg-white px-1 py-1.5 text-center font-mono text-[11px] font-bold outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 read-only:bg-slate-100/70 read-only:text-slate-500 dark:read-only:bg-slate-800" />
                      </label>

                      @if (unitChoicesFor(item.value.product).length > 1) {
                        <select formControlName="unit" (change)="onCartUnitChange(idx, $any($event.target).value)"
                          [title]="prefs.txt('বিক্রয়ের একক', 'Selling unit')"
                          class="rounded-lg border border-teal-300/70 bg-white px-1 py-1.5 text-[10px] font-bold text-teal-700 outline-none dark:border-teal-700 dark:bg-slate-900 dark:text-teal-300">
                          @for (choice of unitChoicesFor(item.value.product); track choice.name) {
                            <option [value]="choice.name">{{ choice.name }}</option>
                          }
                        </select>
                      }
                    </div>

                    <div class="mt-2 flex items-center justify-between gap-2 border-t border-slate-900/10 pt-2 dark:border-slate-100/10">
                      <div class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        {{ prefs.txt('ছাড়', 'Disc') }}
                        <div class="flex items-center overflow-hidden rounded-lg border border-slate-300/70 bg-white dark:border-slate-600 dark:bg-slate-900"
                          [class.opacity-60]="!session.has('editPrice')">
                          <select formControlName="discountType" [disabled]="!session.has('editPrice')"
                            class="border-r border-slate-300/70 bg-transparent px-1 py-1 text-[9.5px] font-black outline-none dark:border-slate-600 dark:text-slate-100">
                            <option value="fixed">TK</option>
                            <option value="percent">%</option>
                          </select>
                          <input type="number" formControlName="discount" [readonly]="!session.has('editPrice')"
                            class="w-10 bg-transparent py-1 text-center text-[11px] font-bold outline-none dark:text-slate-100" />
                        </div>
                      </div>
                      <div class="text-right leading-none">
                        <span class="block text-[8.5px] font-bold uppercase tracking-wide text-slate-500">{{ prefs.t('pos.subtotal') }}</span>
                        <b class="font-mono text-[13px] font-black text-teal-700 dark:text-teal-300">{{ calculateItemSubtotal(item.value) | number:'1.2-2' }}</b>
                      </div>
                    </div>
                  </div>
                } @empty {
                  <div class="rounded-2xl border border-dashed border-slate-300 bg-white/70 py-10 text-center dark:border-slate-700 dark:bg-slate-900/70">
                    <mat-icon class="text-slate-300" style="font-size:38px;width:38px;height:38px;">shopping_cart</mat-icon>
                    <p class="mt-1 px-6 text-[11px] font-semibold text-slate-400">{{ prefs.t('pos.emptyCart') }}</p>
                    <button type="button" (click)="mobileTab.set('products')"
                      class="mt-3 inline-flex items-center gap-1 rounded-full bg-teal-600 px-4 py-2 text-[11px] font-black text-white active:scale-95">
                      <mat-icon style="font-size:15px;width:15px;height:15px;">grid_view</mat-icon>
                      {{ prefs.txt('পণ্য দেখুন', 'Browse products') }}
                    </button>
                  </div>
                }
              </div>

              <!-- Charges & discount -->
              @if (cartArray.length) {
                <div #phoneChargesPanel class="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <button type="button" (click)="togglePhoneCharges()"
                    class="flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-800">
                    <mat-icon class="text-teal-600 dark:text-teal-400" style="font-size:18px;width:18px;height:18px;">tune</mat-icon>
                    <span class="min-w-0 flex-1">
                      <span class="block text-[11px] font-black text-slate-800 dark:text-slate-100">{{ prefs.txt('চার্জ ও ছাড়', 'Charges & discount') }}</span>
                      <span class="block truncate text-[9px] font-semibold text-slate-400">
                        {{ prefs.txt('ট্যাক্স', 'Tax') }} {{ (formValue().orderTax || 0) }}% · {{ prefs.txt('ছাড়', 'Disc') }} {{ orderDiscountAmount() | number:'1.0-2' }}
                      </span>
                    </span>
                    <mat-icon class="text-slate-400 transition-transform" [class.rotate-180]="phoneChargesOpen()" style="font-size:20px;width:20px;height:20px;">expand_more</mat-icon>
                  </button>
                  @if (phoneChargesOpen()) {
                    <div class="grid grid-cols-2 gap-2 border-t border-slate-100 px-3 py-2.5 dark:border-slate-800">
                      <label class="block">
                        <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt('ট্যাক্স %', 'Tax %') }}</span>
                        <input type="number" inputmode="decimal" formControlName="orderTax"
                          class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right font-mono text-[12px] font-bold outline-none focus:border-teal-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
                      </label>
                      <label class="block">
                        <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt('অর্ডার ছাড়', 'Order discount') }}</span>
                        <div class="mt-1 flex items-center overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
                          <select formControlName="discountType"
                            class="border-r border-slate-300 bg-slate-50 px-1 py-1.5 text-[9.5px] font-black outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                            <option value="fixed">TK</option>
                            <option value="percent">%</option>
                          </select>
                          <input type="number" inputmode="decimal" formControlName="discountAmount" [readonly]="!session.has('editPrice')"
                            class="w-full min-w-0 bg-transparent px-2 py-1.5 text-right font-mono text-[12px] font-bold outline-none dark:text-slate-100 read-only:text-slate-500" />
                        </div>
                      </label>
                      <label class="block">
                        <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt('পরিবহন', 'Transport') }}</span>
                        <input type="number" inputmode="decimal" formControlName="shippingAmount"
                          class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right font-mono text-[12px] font-bold outline-none focus:border-teal-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
                      </label>
                      <label class="block">
                        <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">{{ prefs.txt('ড্যামেজ', 'Damage') }}</span>
                        <input type="number" inputmode="decimal" formControlName="damageAmount"
                          class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right font-mono text-[12px] font-bold outline-none focus:border-teal-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
                      </label>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Sticky total + pay -->
            <div class="shrink-0 border-t border-slate-200 bg-white px-3 pt-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] shadow-[0_-6px_16px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900">
              <div class="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                <span>{{ prefs.t('pos.subtotal') }} <b class="font-mono text-slate-700 dark:text-slate-200">{{ cartSubtotal() | number:'1.2-2' }}</b></span>
                @if (orderDiscountAmount() > 0) {
                  <span class="text-rose-500">{{ prefs.txt('ছাড়', 'Disc') }} −<b class="font-mono">{{ orderDiscountAmount() | number:'1.2-2' }}</b></span>
                }
                <span>{{ prefs.txt('আইটেম', 'Items') }} <b class="font-mono text-slate-700 dark:text-slate-200">{{ cartCount() }}</b></span>
              </div>
              <div class="flex items-center gap-2">
                <div class="min-w-0 flex-1 leading-none">
                  <span class="block text-[8.5px] font-black uppercase tracking-wide text-slate-400">{{ prefs.txt('সর্বমোট', 'Grand total') }}</span>
                  <span class="mt-0.5 block truncate font-mono text-[19px] font-black text-teal-700 dark:text-teal-300">
                    {{ payTotal() | number:'1.2-2' }}<span class="ml-0.5 text-[10px] font-bold">TK</span>
                  </span>
                </div>
                <button type="button" (click)="checkoutWarranty()" class="shrink-0 rounded-lg border border-teal-300 dark:border-teal-700 px-2 py-2 text-[11px] font-bold text-teal-700 dark:text-teal-300">
                  {{ prefs.txt('ওয়ারেন্টি ক্লেইম', 'Warranty claim') }}
                </button>
                <button type="button" (click)="checkout()" [disabled]="!cartArray.length && !hasWarrantyClaim()"
                  class="flex h-12 shrink-0 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-teal-600 to-teal-700 px-5 text-[12px] font-black uppercase tracking-wide text-white shadow-lg shadow-teal-900/25 active:scale-95 disabled:opacity-40 disabled:shadow-none">
                  <mat-icon style="font-size:18px;width:18px;height:18px;">credit_card</mat-icon>
                  {{ prefs.t('pos.payment') }}
                </button>
              </div>
            </div>
          }
        </div>
      } @else {
      <!-- POS Top Bar -->
      <div class="relative shrink-0 overflow-hidden border-b border-teal-900/30 bg-gradient-to-r from-teal-800 via-teal-700 to-teal-600 text-white shadow-[0_10px_24px_-16px_rgba(15,23,42,0.7)] dark:border-slate-800 dark:from-slate-900 dark:via-teal-950 dark:to-slate-900">
        <span class="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-white/10 blur-2xl"></span>
        <span class="pointer-events-none absolute -bottom-20 -left-8 h-36 w-36 rounded-full bg-cyan-300/20 blur-2xl"></span>

        <div class="relative flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 shadow-inner ring-1 ring-white/25">
              <mat-icon class="text-white" style="font-size:20px;width:20px;height:20px;">point_of_sale</mat-icon>
            </span>
            <div class="min-w-0 leading-tight">
              <div class="flex min-w-0 items-center gap-2">
                <h1 class="text-base font-black tracking-tight">POS</h1>
                <span class="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold ring-1 ring-white/20 backdrop-blur-sm">
                  <mat-icon style="font-size:12px;width:12px;height:12px;">shopping_bag</mat-icon>
                  {{ cartCount() }} {{ prefs.t('pos.items') }}
                  @if (cartCount() > 0) {
                    <span class="text-teal-50/60">·</span>
                    <span class="font-mono">{{ payTotal() | number:'1.2-2' }} TK</span>
                  }
                </span>
              </div>
              <p class="mt-0.5 truncate text-[9.5px] font-bold uppercase tracking-[0.08em] text-teal-50/70">
                {{ nextInvoiceNo() }} · {{ prefs.txt('দ্রুত বিক্রয়', 'Quick sale') }}
              </p>
            </div>
          </div>

          <div class="hidden md:flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 text-[10px] font-bold text-teal-50 backdrop-blur-sm">
            <span class="flex items-center gap-1">
              <kbd class="rounded-md border border-white/25 bg-white/15 px-1.5 py-0.5 font-mono text-[9.5px] text-white">F2</kbd>
              {{ prefs.txt('খুঁজুন', 'Search') }}
            </span>
            <span class="h-3 w-px bg-white/20"></span>
            <span class="flex items-center gap-1">
              <kbd class="rounded-md border border-white/25 bg-white/15 px-1.5 py-0.5 font-mono text-[9.5px] text-white">F4</kbd>
              {{ prefs.txt('খালি করুন', 'Clear') }}
            </span>
            <span class="h-3 w-px bg-white/20"></span>
            <span class="flex items-center gap-1">
              <kbd class="rounded-md border border-white/25 bg-white/15 px-1.5 py-0.5 font-mono text-[9.5px] text-white">F8</kbd>
              {{ prefs.txt('পেমেন্ট', 'Pay') }}
            </span>
            <span class="h-3 w-px bg-white/20"></span>
            <span class="flex items-center gap-1">
              <kbd class="rounded-md border border-white/25 bg-white/15 px-1.5 py-0.5 font-mono text-[9.5px] text-white">Esc</kbd>
              {{ prefs.txt('বন্ধ', 'Close') }}
            </span>
          </div>

          <button type="button" (click)="togglePosQr()" [attr.aria-pressed]="settings().showPosQrCode"
            [title]="settings().showPosQrCode ? prefs.txt('POS রশিদে QR চালু আছে — বন্ধ করতে চাপুন', 'POS receipt QR is on — tap to turn off') : prefs.txt('POS রশিদে QR বন্ধ আছে — চালু করতে চাপুন', 'POS receipt QR is off — tap to turn on')"
            class="flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[10px] font-bold transition-colors active:scale-95"
            [ngClass]="settings().showPosQrCode
              ? 'border-white/30 bg-white/20 text-white ring-1 ring-white/20'
              : 'border-white/10 bg-white/5 text-teal-50/50'">
            <mat-icon style="font-size:15px;width:15px;height:15px;">qr_code_2</mat-icon>
            <span class="hidden sm:inline">{{ prefs.txt('QR', 'QR') }}</span>
          </button>

          @if (!session.has('editPrice')) {
            <span class="flex shrink-0 items-center gap-1 rounded-lg border border-amber-200/60 bg-amber-300/95 px-2 py-1 text-[10px] font-black text-amber-950 shadow-sm" [title]="prefs.t('pos.priceLocked')">
              <mat-icon style="font-size:14px;width:14px;height:14px;">lock</mat-icon>
              <span class="hidden sm:inline">{{ prefs.t('pos.priceLocked') }}</span>
            </span>
          }
        </div>
      </div>

      <!-- Mobile view switch -->
      <div class="lg:hidden flex gap-1.5 px-2 pt-2 shrink-0">
        <button type="button" (click)="mobileTab.set('products')"
          class="flex-1 py-2 rounded-lg border font-bold text-[11px] flex items-center justify-center gap-1 transition-colors"
          [ngClass]="mobileTab() === 'products' ? 'bg-teal-700 border-teal-600 text-white shadow-sm' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'">
          <mat-icon style="font-size:16px;width:16px;height:16px;">grid_view</mat-icon> {{ prefs.t('pos.products') }}
        </button>
        <button type="button" (click)="mobileTab.set('cart')"
          class="flex-1 py-2 rounded-lg border font-bold text-[11px] flex items-center justify-center gap-1 transition-colors"
          [ngClass]="mobileTab() === 'cart' ? 'bg-teal-700 border-teal-600 text-white shadow-sm' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'">
          <mat-icon style="font-size:16px;width:16px;height:16px;">shopping_cart</mat-icon> {{ prefs.t('pos.cart') }}
          @if (cartCount() > 0) {
            <span class="px-1.5 rounded-full text-[10px] font-mono"
              [ngClass]="mobileTab() === 'cart' ? 'bg-white/25 text-white' : 'bg-teal-100 text-teal-700'">{{ cartCount() }}</span>
          }
        </button>
      </div>

      <div class="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden p-2 gap-2" [formGroup]="posForm">

        <!-- Left Column: Checkout Cart & Summary -->
        <div class="w-full lg:w-1/2 flex flex-col h-full overflow-hidden gap-2 lg:flex"
          [class.hidden]="mobileTab() === 'products'">

          <div class="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col flex-1 overflow-hidden">
            <!-- Customer & Order Top Controls -->
            <div class="p-2.5 sm:p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
              <div class="flex flex-col sm:flex-row sm:items-center gap-2">
                <div class="flex items-center gap-2 w-full shrink-0 sm:w-auto sm:flex-1 sm:min-w-0">
                  <div #customerWrap class="flex-1 min-w-0 relative">
                    <div class="relative">
                      <mat-icon class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" style="font-size:18px;width:18px;height:18px;">person_search</mat-icon>
                      <input
                        type="text"
                        [value]="customerOpen() ? customerQuery() : customerLabel()"
                        (click)="openCustomerPicker()"
                        (input)="onCustomerInput($event)"
                        (keydown)="onCustomerKeydown($event)"
                        [readOnly]="isPhone()"
                        [attr.aria-expanded]="customerOpen()"
                        [placeholder]="prefs.t('pos.searchCustomer')"
                        autocomplete="off"
                        class="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg pl-9 pr-16 py-2 text-xs font-semibold bg-white outline-none cursor-pointer sm:cursor-text focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
                      <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                        @if (selectedCustomerName() !== 'Walk In Customer') {
                          <button type="button" (click)="clearCustomer()" class="p-1 text-slate-400 hover:text-rose-500" [title]="prefs.txt('মুছুন', 'Clear')">
                            <mat-icon class="text-base">close</mat-icon>
                          </button>
                        }
                        <mat-icon class="text-slate-400 pointer-events-none">expand_more</mat-icon>
                      </div>
                    </div>

                    @if (customerOpen() && !isPhone()) {
                      <div class="absolute z-40 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                        <ng-container [ngTemplateOutlet]="customerListTpl" />
                      </div>
                    }
                  </div>

                  <button type="button" (click)="openNewCustomer()" [title]="prefs.t('pos.newCustomer')" [attr.aria-label]="prefs.t('pos.newCustomer')"
                    class="bg-teal-700 hover:bg-teal-800 active:bg-teal-800 text-white h-11 sm:h-10 px-3 rounded-xl flex items-center justify-center gap-1 shrink-0 cursor-pointer shadow-sm border border-teal-800/15 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus-visible:ring-offset-1 dark:ring-offset-slate-900">
                    <mat-icon class="text-base">person_add</mat-icon>
                    <span class="font-bold text-[11px] whitespace-nowrap">{{ prefs.txt('নতুন', 'New') }}</span>
                  </button>
                </div>

                <div class="w-full sm:w-auto flex-none flex items-center gap-1.5 h-11 sm:h-10 border border-slate-300 rounded-lg pl-2 pr-1 bg-white dark:border-slate-600 dark:bg-slate-900 focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-500">
                  <mat-icon class="text-slate-400 pointer-events-none shrink-0" style="font-size:16px;width:16px;height:16px;">flag</mat-icon>
                  <select formControlName="status" [attr.aria-label]="prefs.txt('অর্ডার স্ট্যাটাস', 'Order status')"
                    class="flex-1 sm:w-auto min-w-0 h-full border-0 bg-transparent pl-0 pr-1 text-xs font-semibold outline-none cursor-pointer dark:text-slate-100">
                    <option value="Ordered">{{ prefs.txt('অর্ডারকৃত', 'Ordered') }}</option>
                    <option value="Processing">{{ prefs.txt('প্রক্রিয়াধীন', 'Processing') }}</option>
                    <option value="Shipping">{{ prefs.txt('শিপিং', 'Shipping') }}</option>
                    <option value="Completed">{{ prefs.txt('সম্পন্ন', 'Completed') }}</option>
                    <option value="Service Provider">{{ prefs.txt('সার্ভিস প্রোভাইডার', 'Service Provider') }}</option>
                    <option value="Cancelled">{{ prefs.txt('বাতিল', 'Cancelled') }}</option>
                  </select>
                </div>
              </div>

              @if (selectedParty(); as c) {
                <div class="flex items-center gap-2 text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                  <mat-icon class="text-teal-600" style="font-size:14px;width:14px;height:14px;">badge</mat-icon>
                  <span class="font-bold text-slate-700 truncate">{{ c.name }}</span>
                  @if (dealerPricing()) {
                    <span class="inline-flex items-center gap-0.5 rounded border border-sky-300 bg-sky-50 px-1 py-0.5 text-[9px] font-black text-sky-700 shrink-0" [title]="prefs.txt('ডিলার — পাইকারি মূল্য', 'Dealer — wholesale price')">
                      <mat-icon style="font-size:11px;width:11px;height:11px;">sell</mat-icon> {{ prefs.txt('পাইকারি', 'Wholesale') }}
                    </span>
                  }
                  <span class="text-slate-400 truncate hidden sm:inline">{{ c.phone || c.address }}</span>
                  <span class="ml-auto shrink-0 text-slate-500">
                    {{ prefs.t('pos.previousDue') }}:
                    <b class="font-mono" [class.text-rose-600]="dueOf(c) > 0">{{ dueOf(c) | number:'1.2-2' }} TK</b>
                  </span>
                </div>
              }

              <!-- Barcode / Search Box -->
              <div class="relative flex items-center group gap-2">
                <input
                  #posSearch
                  type="text"
                  [placeholder]="prefs.txt('নাম, কোড, ব্র্যান্ড, মডেল বা ভ্যারিয়েন্ট খুঁজুন; বারকোড স্ক্যান (F2)', 'Search name, code, brand, model or variant; scan barcode (F2)')"
                  [formControl]="searchControl"
                  (input)="openPhoneSearch()"
                  (keydown.enter)="addFirstSearchResult()"
                  class="flex-1 border border-slate-300 rounded-lg pl-3 pr-10 py-2 text-sm max-sm:text-[16px] font-semibold placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500/20 outline-none"
                />
                <button
                  type="button"
                  (click)="cameraScanner()?.launch()"
                  [title]="prefs.txt('ক্যামেরা দিয়ে বারকোড স্ক্যান করুন', 'Scan barcode with camera')"
                  class="absolute right-1.5 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-700 transition-colors hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/70 dark:text-teal-300 dark:hover:bg-teal-900/60"
                >
                  <mat-icon style="font-size:18px;width:18px;height:18px;">photo_camera</mat-icon>
                </button>

                <!-- Search Results Dropdown (desktop) -->
                @if (searchEntries().length > 0 && !isPhone()) {
                    <div class="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl max-h-96 overflow-y-auto">
                        @for (hit of searchEntries(); track hit.product.id + '-' + (hit.variant?.id ?? 0)) {
                            <ng-container [ngTemplateOutlet]="searchHitTpl" [ngTemplateOutletContext]="{ $implicit: hit }" />
                        }
                    </div>
                }
              </div>
            </div>

            <!-- Cart Items -->
            <div class="flex-1 overflow-auto p-2" formArrayName="cart">
              @if (!cartArray.length) {
                <div class="h-full min-h-[160px] flex flex-col items-center justify-center text-slate-400 gap-1">
                  <mat-icon class="text-slate-300" style="font-size:40px;width:40px;height:40px;">shopping_cart</mat-icon>
                  <p class="font-semibold text-center px-4">{{ prefs.t('pos.emptyCart') }}</p>
                </div>
              } @else {
                <!-- Cart item cards: one border, one distinct color per product -->
                <div class="space-y-1.5">
                  @for (item of cartArray.controls; track item; let idx = $index) {
                    <div [formGroupName]="idx"
                      class="rounded-xl border p-2 text-slate-800 dark:text-slate-100 shadow-2xs hover:shadow-md transition-shadow"
                      [ngClass]="cartItemTheme(idx)">
                      <div class="flex items-start gap-2">
                        <span class="w-5 h-5 shrink-0 rounded-md text-[10px] font-black flex items-center justify-center mt-0.5"
                          [ngClass]="cartBadgeTheme(idx)">{{ idx + 1 }}</span>
                        <img [src]="item.value.product.image || noImage" [alt]="item.value.product.name"
                          class="w-10 h-10 rounded-lg object-cover shrink-0 border border-white/70 dark:border-slate-700" referrerpolicy="no-referrer"  loading="lazy" decoding="async" />
                        <div class="flex-1 min-w-[150px]">
                          <p class="font-bold text-[11px] leading-tight break-words">{{ item.value.product.name }}</p>
                          @if (item.value.variant) {
                            <p class="text-[9px] font-bold text-violet-700 dark:text-violet-300">{{ prefs.t('pos.variant') }}: {{ variantLabelOf(item.value.variant) }}</p>
                          }
                          <div class="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-slate-600 dark:text-slate-400 leading-tight">
                            <span>{{ prefs.t('pos.productCode') }}: <b class="font-mono text-slate-800 dark:text-slate-200">{{ item.value.product.code }}</b></span>
                            <span>{{ prefs.t('pos.category') }}: <b class="text-slate-800 dark:text-slate-200">{{ item.value.product.category }}</b></span>
                            <span>{{ prefs.t('pos.subCategory') }}: <b class="text-slate-800 dark:text-slate-200">{{ item.value.product.subCategory || '-' }}</b></span>
                            <span>{{ prefs.t('pos.brand') }}: <b class="text-slate-800 dark:text-slate-200">{{ item.value.product.brand }}</b></span>
                            <span>{{ prefs.t('pos.model') }}: <b class="text-slate-800 dark:text-slate-200">{{ item.value.product.model }}</b></span>
                            <span>{{ prefs.t('pos.stock') }}: <b class="text-slate-800 dark:text-slate-200">{{ item.value.variant ? item.value.variant.openingStock : item.value.product.stock }} {{ item.value.product.unit }}</b></span>
                            @if (lineUnitNote(item.value)) {
                              <span class="font-bold text-teal-700 dark:text-teal-300">
                                {{ lineUnitNote(item.value) }} · {{ item.value.quantity }} {{ item.value.unit }} = {{ lineBaseQty(item.value) }} {{ item.value.product.unit }}
                              </span>
                            }
                            <span>{{ prefs.t('pos.wholesale') }}: <b class="font-mono text-slate-800 dark:text-slate-200">{{ item.value.product.wholesalePrice | number:'1.2-2' }} TK</b></span>
                            <span>{{ prefs.t('pos.rack') }}: <b class="text-slate-800 dark:text-slate-200">{{ item.value.product.rack }}</b></span>
                          </div>
                        </div>
                        <button type="button" (click)="removeItem(idx)" class="text-rose-500 hover:text-rose-600 shrink-0 p-0.5" [title]="prefs.txt('সরান', 'Remove')">
                          <mat-icon class="text-base">delete</mat-icon>
                        </button>
                      </div>

                      <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <div class="flex items-center gap-0.5">
                          <button type="button" (click)="bumpQty(idx, -1)" class="w-5 h-5 rounded bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-black leading-none border border-black/5 dark:border-slate-600">−</button>
                          <input type="number" formControlName="quantity"
                            [attr.max]="maxLineQty(item)"
                            (change)="onQtyInput(idx, $event)"
                            class="w-9 border border-black/10 dark:border-slate-600 rounded bg-white/80 dark:bg-slate-900 p-0.5 text-center font-bold outline-none text-[11px]" />
                          <button type="button" (click)="bumpQty(idx, 1)" class="w-5 h-5 rounded bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-black leading-none border border-black/5 dark:border-slate-600">+</button>
                        </div>

                        <div class="flex items-center gap-1">
                          <span class="text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400">{{ prefs.txt('মূল্য', 'Price') }}</span>
                          <input type="number" formControlName="price" [readonly]="!session.has('editPrice')"
                            [title]="session.has('editPrice') ? '' : prefs.t('pos.priceLocked')"
                            [class]="session.has('editPrice')
                              ? 'w-16 border border-black/10 dark:border-slate-600 rounded bg-white/80 dark:bg-slate-900 p-0.5 text-center font-bold outline-none text-[11px]'
                              : 'w-16 border border-black/10 dark:border-slate-600 rounded bg-white/50 dark:bg-slate-800 p-0.5 text-center font-bold outline-none text-[11px] text-slate-500 dark:text-slate-400 cursor-not-allowed'" />
                        </div>

                        @if (unitChoicesFor(item.value.product).length > 1) {
                          <select formControlName="unit" (change)="onCartUnitChange(idx, $any($event.target).value)"
                            [title]="prefs.txt('বিক্রয়ের একক', 'Selling unit')"
                            class="rounded border border-teal-300/80 bg-white px-1 p-0.5 text-[10px] font-bold text-teal-700 outline-none dark:border-teal-700 dark:bg-slate-900 dark:text-teal-300">
                            @for (choice of unitChoicesFor(item.value.product); track choice.name) {
                              <option [value]="choice.name">{{ choice.name }}</option>
                            }
                          </select>
                        }

                        <div class="flex items-center gap-1">
                          <span class="text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400">{{ prefs.txt('ছাড়', 'Disc') }}</span>
                          <div class="flex items-center border border-black/10 dark:border-slate-600 rounded overflow-hidden bg-white/80 dark:bg-slate-900"
                            [class.opacity-60]="!session.has('editPrice')">
                            <select formControlName="discountType" [disabled]="!session.has('editPrice')" class="bg-transparent p-0.5 font-bold outline-none border-r border-black/10 dark:border-slate-600 text-[10px] dark:text-slate-100 disabled:cursor-not-allowed">
                              <option value="fixed">TK</option>
                              <option value="percent">%</option>
                            </select>
                            <input type="number" formControlName="discount" [readonly]="!session.has('editPrice')"
                              [title]="session.has('editPrice') ? '' : prefs.t('pos.priceLocked')"
                              class="w-9 p-0.5 text-center font-bold outline-none text-[11px] bg-transparent dark:text-slate-100 disabled:cursor-not-allowed" />
                          </div>
                        </div>

                        <div class="ml-auto flex items-center gap-1">
                          <span class="text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400">{{ prefs.txt('উপমোট', 'Subtotal') }}</span>
                          <b class="font-mono text-teal-700 dark:text-teal-300 text-[12px]">{{ calculateItemSubtotal(item.value) | number:'1.2-2' }} TK</b>
                        </div>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Summary & Payment Bar (compact, pinned to bottom) -->
            <div class="mt-auto bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-2 py-1.5 sm:px-2.5 sm:py-2 flex flex-col gap-1.5 shrink-0 shadow-[0_-2px_8px_rgba(15,23,42,0.05)]">

              <div class="flex items-center justify-between gap-2 text-[9px] font-bold uppercase text-slate-500 dark:text-slate-400 px-0.5">
                <span class="inline-flex items-center gap-1">
                  <mat-icon class="text-[11px] w-[11px] h-[11px] leading-none">shopping_basket</mat-icon>
                  {{ cartCount() }} {{ prefs.t('pos.items') }}
                </span>
                <span>{{ prefs.t('pos.subtotal') }}:
                  <b class="font-mono normal-case text-slate-700 dark:text-slate-200">{{ cartSubtotal() | number:'1.2-2' }} TK</b>
                </span>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-1.5">
                <label class="flex items-center gap-1 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 rounded-md px-1.5 py-1 focus-within:border-teal-400 focus-within:ring-1 focus-within:ring-teal-500/20 transition-colors">
                  <span class="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase whitespace-nowrap">{{ prefs.txt('ট্যাক্স %', 'Tax %') }}</span>
                  <input type="number" formControlName="orderTax" class="w-full min-w-0 bg-transparent text-[11px] font-bold text-right outline-none dark:text-slate-100" />
                </label>
                <label class="flex items-center gap-1 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 rounded-md px-1.5 py-1 focus-within:border-teal-400 focus-within:ring-1 focus-within:ring-teal-500/20 transition-colors">
                  <span class="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase whitespace-nowrap">{{ prefs.txt('ছাড়', 'Disc') }}</span>
                  <select formControlName="discountType"
                    class="bg-transparent text-[9px] font-black uppercase outline-none border-r border-slate-300 dark:border-slate-600 pr-0.5 dark:text-slate-100 cursor-pointer">
                    <option value="fixed">TK</option>
                    <option value="percent">%</option>
                  </select>
                  <input type="number" formControlName="discountAmount" [readonly]="!session.has('editPrice')"
                    [title]="session.has('editPrice') ? '' : prefs.t('pos.priceLocked')"
                    class="w-full min-w-0 bg-transparent text-[11px] font-bold text-right outline-none dark:text-slate-100 read-only:text-slate-500" />
                </label>
                <label class="flex items-center gap-1 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 rounded-md px-1.5 py-1 focus-within:border-teal-400 focus-within:ring-1 focus-within:ring-teal-500/20 transition-colors">
                  <span class="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase whitespace-nowrap">{{ prefs.txt('পরিবহন', 'Transport') }}</span>
                  <input type="number" formControlName="shippingAmount" class="w-full min-w-0 bg-transparent text-[11px] font-bold text-right outline-none dark:text-slate-100" />
                </label>
                <label class="flex items-center gap-1 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 rounded-md px-1.5 py-1 focus-within:border-teal-400 focus-within:ring-1 focus-within:ring-teal-500/20 transition-colors">
                  <span class="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase whitespace-nowrap">{{ prefs.txt('ড্যামেজ', 'Damage') }}</span>
                  <input type="number" formControlName="damageAmount" class="w-full min-w-0 bg-transparent text-[11px] font-bold text-right outline-none dark:text-slate-100" />
                </label>
              </div>

              <div class="flex items-center gap-1.5 sm:gap-2 bg-slate-50 dark:bg-slate-800/60 p-1 sm:p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                <div class="flex flex-col leading-none shrink-0">
                  <span class="text-[8px] font-black text-slate-500 dark:text-slate-400 uppercase">{{ prefs.txt('সর্বমোট', 'Grand Total') }}</span>
                  <input type="number" step="0.01" formControlName="grandTotal"
                    class="text-sm sm:text-base font-black text-teal-700 dark:text-teal-300 font-mono w-20 sm:w-24 bg-transparent outline-none" />
                </div>
                <button type="button" (click)="resetCart()" [title]="prefs.txt('কার্ট খালি করুন (F4)', 'Clear cart (F4)')"
                  class="border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 p-1.5 rounded-md shrink-0 transition-colors">
                  <mat-icon class="text-[16px] w-4 h-4 leading-none">refresh</mat-icon>
                </button>
                <button type="button" (click)="checkoutWarranty()" class="shrink-0 rounded-lg border border-teal-300 dark:border-teal-700 px-2 py-2 text-[11px] font-bold text-teal-700 dark:text-teal-300">
                  {{ prefs.txt('ওয়ারেন্টি ক্লেইম', 'Warranty claim') }}
                </button>
                <button type="button" (click)="checkout()" [disabled]="!cartArray.length && !hasWarrantyClaim()"
                  class="flex-1 justify-center bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-black px-2 py-1.5 rounded-md uppercase tracking-wide text-[11px] flex items-center gap-1 transition-colors">
                  <mat-icon class="text-[15px] w-[15px] h-[15px] leading-none">credit_card</mat-icon> {{ prefs.txt('পেমেন্ট করুন', 'PAY NOW') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Column: Product Browser -->
        <div class="flex-1 min-w-0 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col h-full overflow-hidden lg:flex"
          [class.hidden]="mobileTab() === 'cart'">
          <!-- Drilldown Area -->
          <div class="relative shrink-0 border-b border-slate-200 dark:border-slate-800">
          <div #categoryTiles class="p-2 flex items-center gap-2 overflow-x-auto bg-slate-50/70 dark:bg-slate-950/50">
            @if (currentView() !== 'all') {
                <button (click)="navigateBack()"
                  [title]="prefs.txt(drillFolderName() + ' থেকে ফিরে যান', 'Back from ' + drillFolderName())"
                  class="flex flex-col items-center justify-center w-[74px] h-16 rounded-xl border-2 border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 shrink-0 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    <mat-icon class="text-slate-600 dark:text-slate-300">arrow_back</mat-icon>
                    <span class="text-[9px] font-bold uppercase text-slate-600 dark:text-slate-300">{{ prefs.txt('ফিরে যান', 'Back') }}</span>
                </button>
                <span class="flex flex-col items-center justify-center w-[74px] h-16 rounded-xl border-2 border-teal-500 bg-teal-50 shadow-[0_3px_10px_rgba(13,148,136,0.35)] ring-2 ring-teal-300/70 dark:bg-teal-950/60 shrink-0">
                    <mat-icon class="text-teal-600 dark:text-teal-300">folder_open</mat-icon>
                    <span class="text-[10px] font-bold uppercase truncate w-full px-1 text-center text-teal-800 dark:text-teal-200">{{ drillFolderName() }}</span>
                </span>
            }
            @switch (currentView()) {
                @case ('all') {
                    <button (click)="pickCategory('All')"
                      [ngClass]="selectedCategory() === 'All' ? 'border-teal-500 bg-teal-50 shadow-[0_3px_10px_rgba(13,148,136,0.35)] ring-2 ring-teal-300/70 dark:bg-teal-950/60' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'"
                      class="flex flex-col items-center justify-center w-[74px] h-16 rounded-xl border-2 shrink-0 transition-colors">
                      <mat-icon [ngClass]="selectedCategory() === 'All' ? 'text-teal-600 dark:text-teal-300' : 'text-slate-400'">grid_view</mat-icon>
                      <span class="text-[10px] font-bold uppercase truncate w-full px-1 dark:text-slate-200">{{ prefs.txt('সব', 'All') }}</span>
                    </button>
                    @for (cat of activeCategories(); track cat.id) {
                      <button (click)="pickCategory(cat.name)"
                        [title]="isLastOpened('category', cat.name) ? prefs.txt('সর্বশেষ খোলা ফোল্ডার', 'Last opened folder') : cat.name"
                        [ngClass]="selectedCategory() === cat.name ? 'border-teal-500 bg-teal-50 shadow-[0_3px_10px_rgba(13,148,136,0.35)] ring-2 ring-teal-300/70 dark:bg-teal-950/60' : isLastOpened('category', cat.name) ? 'border-teal-300 bg-teal-50/70 ring-2 ring-teal-200 dark:border-teal-700 dark:bg-teal-950/40' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'"
                        class="flex flex-col items-center justify-center w-[74px] h-16 rounded-xl border-2 shrink-0 transition-colors">
                        <mat-icon [ngClass]="selectedCategory() === cat.name ? 'text-teal-600 dark:text-teal-300' : isLastOpened('category', cat.name) ? 'text-teal-500 dark:text-teal-400' : 'text-slate-400'">{{ isLastOpened('category', cat.name) ? 'folder_open' : 'folder' }}</mat-icon>
                        <span class="text-[10px] font-bold uppercase truncate w-full px-1 dark:text-slate-200">{{ cat.name }}</span>
                      </button>
                    }
                }
                @case ('category') {
                    @for (sub of activeSubCategories(); track sub.id) {
                      <button (click)="pickSubCategory(sub.name)"
                        [title]="isLastOpened('subcategory', sub.name) ? prefs.txt('সর্বশেষ খোলা ফোল্ডার', 'Last opened folder') : sub.name"
                        [ngClass]="selectedSubCategory() === sub.name ? 'border-teal-500 bg-teal-50 shadow-[0_3px_10px_rgba(13,148,136,0.35)] ring-2 ring-teal-300/70 dark:bg-teal-950/60' : isLastOpened('subcategory', sub.name) ? 'border-teal-300 bg-teal-50/70 ring-2 ring-teal-200 dark:border-teal-700 dark:bg-teal-950/40' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'"
                        class="flex flex-col items-center justify-center w-[74px] h-16 rounded-xl border-2 shrink-0 transition-colors">
                        <mat-icon [ngClass]="selectedSubCategory() === sub.name ? 'text-teal-600 dark:text-teal-300' : isLastOpened('subcategory', sub.name) ? 'text-teal-500 dark:text-teal-400' : 'text-slate-400'">{{ isLastOpened('subcategory', sub.name) ? 'folder_open' : 'category' }}</mat-icon>
                        <span class="text-[10px] font-bold uppercase truncate w-full px-1 dark:text-slate-200">{{ sub.name }}</span>
                      </button>
                    }
                }
                @case ('subcategory') {
                    @for (brand of activeBrands(); track brand.id) {
                      <button (click)="pickBrand(brand.name)"
                        [title]="isLastOpened('brand', brand.name) ? prefs.txt('সর্বশেষ খোলা ফোল্ডার', 'Last opened folder') : brand.name"
                        [ngClass]="selectedBrand() === brand.name ? 'border-teal-500 bg-teal-50 shadow-[0_3px_10px_rgba(13,148,136,0.35)] ring-2 ring-teal-300/70 dark:bg-teal-950/60' : isLastOpened('brand', brand.name) ? 'border-teal-300 bg-teal-50/70 ring-2 ring-teal-200 dark:border-teal-700 dark:bg-teal-950/40' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'"
                        class="flex flex-col items-center justify-center w-[74px] h-16 rounded-xl border-2 shrink-0 transition-colors">
                        <mat-icon [ngClass]="selectedBrand() === brand.name ? 'text-teal-600 dark:text-teal-300' : isLastOpened('brand', brand.name) ? 'text-teal-500 dark:text-teal-400' : 'text-slate-400'">{{ isLastOpened('brand', brand.name) ? 'folder_open' : 'branding_watermark' }}</mat-icon>
                        <span class="text-[10px] font-bold uppercase truncate w-full px-1 dark:text-slate-200">{{ brand.name }}</span>
                      </button>
                    }
                }
                @case ('brand') {
                    @for (model of activeModels(); track model.id) {
                      <button (click)="pickModel(model.name)"
                        [title]="isLastOpened('model', model.name) ? prefs.txt('সর্বশেষ খোলা ফোল্ডার', 'Last opened folder') : model.name"
                        [ngClass]="selectedModel() === model.name ? 'border-teal-500 bg-teal-50 shadow-[0_3px_10px_rgba(13,148,136,0.35)] ring-2 ring-teal-300/70 dark:bg-teal-950/60' : isLastOpened('model', model.name) ? 'border-teal-300 bg-teal-50/70 ring-2 ring-teal-200 dark:border-teal-700 dark:bg-teal-950/40' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'"
                        class="flex flex-col items-center justify-center w-[74px] h-16 rounded-xl border-2 shrink-0 transition-colors">
                        <mat-icon [ngClass]="selectedModel() === model.name ? 'text-teal-600 dark:text-teal-300' : isLastOpened('model', model.name) ? 'text-teal-500 dark:text-teal-400' : 'text-slate-400'">{{ isLastOpened('model', model.name) ? 'folder_open' : 'layers' }}</mat-icon>
                        <span class="text-[10px] font-bold uppercase truncate w-full px-1 dark:text-slate-200">{{ model.name }}</span>
                      </button>
                    }
                }
            }
          </div>
          <div class="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-slate-50 to-transparent dark:from-slate-950"></div>
          </div>

          <!-- Always four product columns on desktop, per the shop's shelf layout -->
          <div #desktopProductGrid class="flex-1 overflow-y-auto p-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 bg-slate-50/40 dark:bg-slate-950/40 content-start">
            @for (p of visibleProducts(); track p.id) {
              <div (click)="addToCart(p)"
                [class.opacity-60]="p.stock <= 0"
                [class.grayscale]="p.stock <= 0"
                [class.cursor-pointer]="p.stock > 0"
                [class.cursor-not-allowed]="p.stock <= 0"
                class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 hover:border-teal-500 dark:hover:border-teal-400 hover:shadow-lg dark:hover:shadow-black/40 transition-all flex flex-col group active:scale-[0.98]">
                <div class="relative w-full aspect-square bg-slate-100 dark:bg-slate-800 rounded-lg mb-2 overflow-hidden">
                    <img [src]="p.image || noImage" [alt]="p.name" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" referrerpolicy="no-referrer" loading="lazy" decoding="async">
                    <span class="absolute top-1 left-1 text-[9px] font-bold bg-white/85 dark:bg-slate-950/80 px-1 rounded text-teal-700 dark:text-teal-300 backdrop-blur-sm">{{ prefs.txt('কোড', 'Code') }}: {{ p.code.slice(-5) }}</span>
                    @if (p.stock <= 0) {
                      <span class="absolute bottom-1 right-1 text-[9px] font-black bg-rose-600 text-white px-1.5 py-0.5 rounded">{{ prefs.txt('শেষ', 'OUT') }}</span>
                    } @else {
                      <span class="absolute bottom-1 right-1 text-[9px] font-bold bg-white/85 dark:bg-slate-950/80 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded backdrop-blur-sm">{{ p.stock }} {{ p.unit }}</span>
                    }
                </div>
                <h4 class="font-black text-slate-800 dark:text-slate-100 text-[11px] leading-tight mb-1 line-clamp-2 tracking-tight">{{ p.name }}</h4>
                <p class="text-[9px] text-slate-500 dark:text-slate-400 truncate mb-1">{{ p.category }}{{ p.brand && p.brand !== '-' ? ' • ' + p.brand : '' }}</p>
                <div class="mt-auto pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1">
                  <span class="font-black text-teal-700 dark:text-teal-300 text-[13px] font-mono tracking-tighter whitespace-nowrap">{{ p.salesPrice | number:'1.2-2' }} TK</span>
                  <mat-icon class="text-teal-600 dark:text-teal-400 text-base opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">add_circle</mat-icon>
                </div>
              </div>
            } @empty {
              <div class="col-span-full py-10 text-center text-slate-400 dark:text-slate-500 font-semibold">{{ prefs.txt('এই নির্বাচনে কোনো পণ্য নেই', 'No products in this selection') }}</div>
            }
            @if (remainingProducts() > 0) {
              <app-load-more class="col-span-full mt-1" [remaining]="remainingProducts()"
                [label]="prefs.txt('আরও পণ্য দেখুন', 'Load more products')" (load)="showMoreProducts()" />
            }
          </div>
        </div>
      </div>
      }

      <!-- Checkout sheet — mirrors Add Sale's charges, payments & FINAL ACCOUNT SUMMARY -->
      @if (isPayModalOpen()) {
        <div class="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
          <div class="bg-white dark:bg-slate-900 w-full sm:max-w-5xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[94dvh] overflow-hidden ring-1 ring-black/5 dark:ring-white/10">

            <!-- Header -->
            <div class="shrink-0 bg-gradient-to-r from-teal-800 via-teal-700 to-teal-600 px-4 py-3 text-white">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 class="font-black text-sm sm:text-base flex items-center gap-1.5">
                    <mat-icon class="text-base">point_of_sale</mat-icon>
                    {{ prefs.t('pos.payment') }}
                  </h2>
                  <p class="text-[10px] sm:text-[11px] text-teal-100 font-mono mt-0.5 truncate">{{ nextInvoiceNo() }} • {{ customerLabel() }}</p>
                </div>
                <div class="text-right shrink-0">
                  <p class="text-[9px] font-black uppercase tracking-widest text-teal-100">{{ prefs.t('pos.totalPayable') }}</p>
                  <p class="font-mono font-black text-2xl sm:text-3xl leading-none">{{ totalPayable() | number:'1.2-2' }} <span class="text-xs font-bold">TK</span></p>
                </div>
                <button type="button" (click)="isPayModalOpen.set(false)" class="p-1 -mr-1 text-teal-100/80 hover:text-white shrink-0">
                  <mat-icon class="text-base">close</mat-icon>
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto overscroll-contain bg-slate-50/70 dark:bg-slate-950/40">
              <div class="p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3 items-start">

                <!-- LEFT: charges & payments -->
                <div class="space-y-3">
                  <section class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <header class="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                      <span class="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">{{ prefs.t('pos.method') }}</span>
                      <span class="text-[10px] font-bold text-teal-700 dark:text-teal-300">{{ methodLabel(paymentMethod()) }}</span>
                    </header>
                    <div class="p-2.5 grid grid-cols-4 gap-1.5">
                      @for (m of paymentMethods; track m) {
                        <button type="button" (click)="setMethod(m)"
                          class="border rounded-xl py-2 flex flex-col items-center gap-0.5 font-bold transition-colors cursor-pointer"
                          [ngClass]="paymentMethod() === m ? 'border-teal-600 bg-teal-50 text-teal-700 ring-2 ring-teal-500/20 dark:border-teal-500 dark:bg-teal-950/60 dark:text-teal-300' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'">
                          <mat-icon class="text-base">{{ methodIcon(m) }}</mat-icon>
                          <span class="text-[10px]">{{ methodLabel(m) }}</span>
                        </button>
                      }
                    </div>
                  </section>

                  <section class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <header class="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                      <mat-icon class="text-teal-600 dark:text-teal-400" style="font-size:15px;width:15px;height:15px;">tune</mat-icon>
                      <span class="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">{{ prefs.txt('চার্জ ও ডিসকাউন্ট', 'Charges & Discount') }}</span>
                    </header>
                    <div class="p-3 space-y-2.5">
                      <div>
                        <div class="flex items-center justify-between gap-2">
                          <label class="text-[11px] font-bold text-slate-700 dark:text-slate-200">{{ prefs.txt('অর্ডার ডিসকাউন্ট', 'Order Discount') }}</label>
                          <div class="inline-flex rounded-md border border-slate-300 dark:border-slate-600 overflow-hidden text-[9px] font-black">
                            <button type="button" (click)="setPayDiscountType('fixed')"
                              class="px-2 py-1 transition-colors cursor-pointer"
                              [class]="payDiscountType() !== 'percent' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'">TK</button>
                            <button type="button" (click)="setPayDiscountType('percent')"
                              class="px-2 py-1 border-l border-slate-300 dark:border-slate-600 transition-colors cursor-pointer"
                              [class]="payDiscountType() === 'percent' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'">%</button>
                          </div>
                        </div>
                        <div class="mt-1 flex items-center gap-2">
                          <input type="number" min="0" step="any" [formControl]="posForm.controls.discountAmount"
                            [readonly]="!session.has('editPrice')"
                            [title]="session.has('editPrice') ? '' : prefs.t('pos.priceLocked')"
                            class="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-300 bg-white dark:bg-slate-950 outline-none focus:border-teal-500 read-only:bg-slate-100 dark:read-only:bg-slate-800 read-only:text-slate-500" />
                          @if (orderDiscountAmount() > 0) {
                            <span class="shrink-0 text-[10px] font-mono font-black text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-md px-2 py-1">−{{ orderDiscountAmount() | number:'1.2-2' }}</span>
                          }
                        </div>
                      </div>

                      <div class="grid grid-cols-2 gap-2">
                        <label class="block">
                          <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400">{{ prefs.txt('পরিবহন ও শ্রমিক', 'Transport & Labour') }}</span>
                          <input type="number" min="0" step="any" [formControl]="posForm.controls.shippingAmount"
                            class="w-full mt-0.5 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-right font-mono font-bold dark:bg-slate-950 dark:text-slate-100 outline-none focus:border-teal-500" />
                        </label>
                        <label class="block">
                          <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400">{{ prefs.txt('ওয়ারেন্টি পরিবহন', 'Warranty Transport') }}</span>
                          <input type="number" min="0" step="any" [formControl]="posForm.controls.warrantyTransport"
                            class="w-full mt-0.5 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-right font-mono font-bold dark:bg-slate-950 dark:text-slate-100 outline-none focus:border-teal-500" />
                        </label>
                        <label class="block">
                          <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400">{{ prefs.txt('ট্যাক্স %', 'Tax %') }}</span>
                          <input type="number" min="0" step="any" [formControl]="posForm.controls.orderTax"
                            class="w-full mt-0.5 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-right font-mono font-bold dark:bg-slate-950 dark:text-slate-100 outline-none focus:border-teal-500" />
                        </label>
                        <label class="block">
                          <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400">{{ prefs.txt('ড্যামেজ', 'Damage') }}</span>
                          <input type="number" min="0" step="any" [formControl]="posForm.controls.damageAmount"
                            class="w-full mt-0.5 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-right font-mono font-bold dark:bg-slate-950 dark:text-slate-100 outline-none focus:border-teal-500" />
                        </label>
                      </div>
                    </div>
                  </section>

                  <section class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <header class="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                      <span class="flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <mat-icon class="text-teal-600 dark:text-teal-400" style="font-size:15px;width:15px;height:15px;">battery_charging_full</mat-icon>
                        <span class="truncate">{{ prefs.txt('পুরাতন ব্যাটারি জমা', 'Old Battery Credit') }}</span>
                      </span>
                      <input type="checkbox" [checked]="batteryEnabled()" (change)="toggleBattery($event)"
                        class="w-4 h-4 accent-teal-600 cursor-pointer shrink-0" [attr.aria-label]="prefs.txt('পুরাতন ব্যাটারি জমা', 'Old battery credit')" />
                    </header>
                    @if (batteryEnabled()) {
                      <div class="p-2.5 space-y-2">
                        @for (adj of batteryAdjustments(); track adj.id; let idx = $index) {
                          <div class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/40 p-2 space-y-1.5">
                            <div class="flex items-center gap-1.5">
                              <select [value]="adj.kindKey || 'scrap'" (change)="onBatteryKind(idx, $event)"
                                class="flex-1 min-w-0 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1 text-[11px] font-semibold bg-white dark:bg-slate-900 dark:text-slate-100 focus:border-teal-500 outline-none">
                                @for (k of batteryKinds; track k.key) { <option [value]="k.key">{{ batteryKindLabel(k) }}</option> }
                              </select>
                              @if ((adj.kindKey || 'scrap') === 'other') {
                                <select [value]="adj.unit || 'kg'" (change)="onBatteryUnit(idx, $event)"
                                  class="w-16 shrink-0 border border-slate-300 dark:border-slate-600 rounded-md px-1 py-1 text-[11px] font-semibold bg-white dark:bg-slate-900 dark:text-slate-100 focus:border-teal-500 outline-none">
                                  <option value="kg">{{ prefs.txt('কেজি', 'Kg') }}</option>
                                  <option value="pcs">{{ prefs.txt('পিস', 'Pcs') }}</option>
                                </select>
                              }
                              <button type="button" (click)="removeBatteryRow(idx)" class="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0">
                                <mat-icon class="text-sm">delete</mat-icon>
                              </button>
                            </div>
                            <div class="grid grid-cols-3 gap-1.5">
                              <label class="block">
                                <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{{ prefs.txt('পরিমাণ', 'Qty') }} ({{ (adj.unit || 'kg') === 'pcs' ? prefs.txt('পিস', 'Pcs') : prefs.txt('কেজি', 'Kg') }})</span>
                                <input type="number" min="0" [attr.step]="(adj.unit || 'kg') === 'pcs' ? 1 : 0.1"
                                  [value]="adj.weightKg" (input)="updateBatteryWeight(idx, $event)" (blur)="normalizeBatteryWeight(idx, $event)"
                                  class="w-full border border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-1 text-[11px] font-mono font-bold text-center bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none" />
                              </label>
                              <label class="block">
                                <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{{ prefs.txt('দর', 'Rate') }}</span>
                                <input type="number" min="0" step="any" [value]="adj.ratePerKg" (input)="updateBatteryRate(idx, $event)"
                                  class="w-full border border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-1 text-[11px] font-mono font-bold text-right bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none" />
                              </label>
                              <div>
                                <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{{ prefs.txt('টাকা', 'Amount') }}</span>
                                <span class="block py-1 font-mono font-black text-[11px] text-teal-700 dark:text-teal-300">{{ adj.total | number:'1.2-2' }}</span>
                              </div>
                            </div>
                          </div>
                        }
                        <button type="button" (click)="addBatteryRow()" class="w-full border border-dashed border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 rounded-md py-1 flex items-center justify-center">
                          <mat-icon class="text-sm">add</mat-icon>
                        </button>
                      </div>
                    }
                    <div class="bg-slate-50 dark:bg-slate-950/40 border-t border-slate-200 dark:border-slate-800 rounded-b-xl px-3 py-2 flex items-center justify-between text-[11px] font-bold">
                      <span class="text-slate-600 dark:text-slate-300">{{ prefs.txt('মোট ব্যাটারি জমা (ক্রেডিট)', 'Total battery credit') }}:</span>
                      <span class="font-mono text-slate-900 dark:text-slate-100">{{ oldBatteryCredit() | number:'1.2-2' }} TK</span>
                    </div>
                  </section>

                  <section class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <header class="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                      <span class="flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <mat-icon class="text-teal-600 dark:text-teal-400" style="font-size:15px;width:15px;height:15px;">assignment_return</mat-icon>
                        <span class="truncate">{{ prefs.txt('ফেরত মাল জমা', 'Returned Goods') }}</span>
                      </span>
                      <input type="checkbox" [checked]="returnsEnabled()" (change)="toggleReturns($event)"
                        class="w-4 h-4 accent-teal-600 cursor-pointer shrink-0" [attr.aria-label]="prefs.txt('ফেরত মাল জমা', 'Returned goods')" />
                    </header>
                    @if (returnsEnabled()) {
                      <div class="relative p-2.5 border-b border-slate-100 dark:border-slate-800">
                        <label class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-1">{{ prefs.txt('পণ্যের নাম বা ভাউচার নম্বর দিয়ে রিটার্ন আইটেম খুঁজুন', 'Find return item by product name or invoice no.') }}</label>
                        <div class="relative">
                          <mat-icon class="absolute left-2 top-1.5 text-slate-400" style="font-size:14px;width:14px;height:14px;">search</mat-icon>
                          <input type="text" [value]="returnSearchQuery()" (input)="onReturnSearch($event)" (focus)="returnSearchOpen.set(true)"
                            [placeholder]="prefs.txt('যেমন: SF Battery 100AH অথবা SALE-220', 'e.g. SF Battery 100AH or SALE-220')"
                            class="w-full border-2 border-teal-500/40 focus:border-teal-600 rounded-lg py-1.5 pl-8 pr-7 bg-white dark:bg-slate-950 dark:text-slate-100 font-semibold text-[11px] max-sm:text-[16px] outline-none" />
                          @if (returnSearchQuery()) {
                            <button type="button" (click)="clearReturnSearch()" class="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600">
                              <mat-icon class="text-sm">close</mat-icon>
                            </button>
                          }
                        </div>
                        @if (returnSearchOpen() && returnSearchQuery() && !isPhone()) {
                          <div class="absolute z-40 left-2.5 right-2.5 mt-1 bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-800 rounded-xl shadow-xl max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                            <ng-container [ngTemplateOutlet]="returnResultsTpl" />
                          </div>
                        }
                      </div>

                      @if (returnRows().length > 0) {
                        <div class="p-2.5 space-y-2">
                          @for (ret of returnRows(); track ret.id; let idx = $index) {
                            <div class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/40 p-2 space-y-1.5">
                              <div class="flex items-center gap-1.5">
                                <input type="text" [value]="ret.item" (input)="updateReturnItem(idx, $event)" [placeholder]="prefs.txt('পণ্য / মূল ইনভয়েস', 'Item / Original Invoice')"
                                  class="flex-1 min-w-0 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1 text-[11px] font-semibold bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none" />
                                <button type="button" (click)="removeReturnRow(idx)" class="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0">
                                  <mat-icon class="text-sm">delete</mat-icon>
                                </button>
                              </div>
                              <div class="grid grid-cols-3 gap-1.5">
                                <label class="block">
                                  <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">Qty / Unit</span>
                                  <input type="text" [value]="ret.qty" (input)="updateReturnQty(idx, $event)" placeholder="3 pcs"
                                    class="w-full border border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-1 text-[11px] font-semibold text-center bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none" />
                                </label>
                                <label class="block">
                                  <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{{ prefs.txt('রেট (টাকা)', 'Rate (TK)') }}</span>
                                  <input type="number" min="0" step="any" [value]="ret.rate" (input)="updateReturnRate(idx, $event)"
                                    class="w-full border border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-1 text-[11px] font-mono font-bold text-right bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none" />
                                </label>
                                <div>
                                  <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{{ prefs.txt('পরিমাণ', 'Amount') }}</span>
                                  <span class="block py-1 font-mono font-black text-[11px] text-teal-700 dark:text-teal-300">{{ ret.amount | number:'1.2-2' }}</span>
                                </div>
                              </div>
                            </div>
                          }
                        </div>
                      }
                    }
                    <div class="bg-slate-50 dark:bg-slate-950/40 border-t border-slate-200 dark:border-slate-800 rounded-b-xl px-3 py-2 flex items-center justify-between text-[11px] font-bold">
                      <span class="text-slate-600 dark:text-slate-300">{{ prefs.txt('মোট ফেরত জমা (ক্রেডিট)', 'Total return credit') }}:</span>
                      <span class="font-mono text-slate-900 dark:text-slate-100">{{ returnsCredit() | number:'1.2-2' }} TK</span>
                    </div>
                  </section>

                  <section class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <header class="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                      <span class="flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <mat-icon class="text-teal-600 dark:text-teal-400" style="font-size:15px;width:15px;height:15px;">verified_user</mat-icon>
                        <span class="truncate">{{ prefs.txt('ওয়ারেন্টি পণ্য গ্রহণ', 'Warranty product receipt') }}</span>
                      </span>
                      <input type="checkbox" [checked]="hasWarrantyClaim()" (change)="toggleWarranty($event)"
                        class="w-4 h-4 accent-teal-600 cursor-pointer shrink-0" [attr.aria-label]="prefs.txt('ওয়ারেন্টি ক্লেইম', 'Warranty claim')" />
                    </header>
                    @if (hasWarrantyClaim()) {
                      <div class="p-2.5 grid grid-cols-2 gap-1.5">
                        <label class="block">
                          <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                            {{ prefs.txt('ক্লেইম নং', 'Claim No.') }}
                            <span class="ml-1 rounded bg-teal-100 dark:bg-teal-900 px-1 text-[8px] font-black uppercase text-teal-700 dark:text-teal-300">{{ prefs.txt('অটো', 'Auto') }}</span>
                          </span>
                          <input type="text" [value]="warranty.claimNo" readonly tabindex="-1" class="w-full border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 rounded-md px-1.5 py-1 text-[11px] font-black font-mono text-teal-800 dark:text-teal-300 outline-none" />
                        </label>
                        <label class="block">
                          <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{{ prefs.txt('মূল ইনভয়েস', 'Original Invoice') }}</span>
                          <input type="text" list="pos-warranty-invoices" [(ngModel)]="warranty.originalInvoice" [placeholder]="nextInvoiceNo()" class="w-full border border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none" />
                          <datalist id="pos-warranty-invoices">
                            @for (inv of warrantyInvoiceOptions(); track inv) { <option [value]="inv"></option> }
                          </datalist>
                        </label>
                        <div class="col-span-2">
                          <label class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5" for="pos-warranty-battery">{{ prefs.txt('ব্যাটারি', 'Battery') }} <span class="text-rose-500">*</span></label>
                          <div class="relative z-40">
                            <input id="pos-warranty-battery" type="text" [ngModel]="warranty.battery" (ngModelChange)="onWarrantyBatteryInput($event)" (focus)="warrantyBatteryOpen.set(true)" autocomplete="off" [placeholder]="prefs.txt('নাম লিখুন বা পণ্য সার্চ করুন', 'Type a name or search a product')" class="w-full border border-slate-300 dark:border-slate-600 rounded-md pl-2 pr-8 py-1.5 text-[11px] font-semibold bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none" />
                            <button type="button" (click)="warrantyBatteryOpen.set(!warrantyBatteryOpen())" [attr.aria-label]="prefs.txt('পণ্য তালিকা', 'Product list')" class="absolute right-1 top-1 h-6 w-6 text-slate-400">
                              <mat-icon style="font-size:16px;width:16px;height:16px;">{{ warrantyBatteryOpen() ? 'expand_less' : 'expand_more' }}</mat-icon>
                            </button>
                            @if (warrantyBatteryOpen()) {
                              <div class="fixed inset-0 z-30" (click)="warrantyBatteryOpen.set(false)"></div>
                              <div class="absolute left-0 right-0 top-full z-40 mt-1 max-h-52 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 shadow-xl">
                                @for (p of warrantyBatteryFiltered(); track p.name) {
                                  <button type="button" (click)="pickWarrantyBattery(p.name)" class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-teal-50 dark:hover:bg-teal-950">
                                    <span class="truncate font-semibold text-slate-700 dark:text-slate-200">{{ p.name }}</span>
                                    <span class="shrink-0 text-[9px] font-bold text-slate-400">{{ p.code }}</span>
                                  </button>
                                } @empty {
                                  <p class="px-2 py-2 text-[10px] font-semibold text-amber-600">{{ prefs.txt('কোনো পণ্য মেলেনি — লেখা নামেই সেভ হবে', 'No product match — saved as typed') }}</p>
                                }
                              </div>
                            }
                          </div>
                          @if (warrantyMatchedProduct(); as product) {
                            <p class="mt-1 text-[9px] font-semibold text-teal-700 dark:text-teal-300">{{ product.code }} • {{ prefs.txt('স্টক', 'Stock') }}: {{ product.stock }} {{ product.unit }} @if (product.warrantyDays) { • {{ product.warrantyDays }} {{ prefs.txt('দিনের ওয়ারেন্টি', 'days warranty') }} }</p>
                          } @else if ((warranty.battery || '').trim()) {
                            <p class="mt-1 text-[9px] font-semibold text-amber-600">{{ prefs.txt('পণ্য তালিকায় নেই — লেখা নামেই সেভ হবে', 'Not in the product list — saved as typed') }}</p>
                          }
                        </div>
                        <label class="block">
                          <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{{ prefs.txt('পরিমাণ', 'Quantity') }}</span>
                          <div class="flex">
                            <input type="text" inputmode="decimal" [(ngModel)]="warranty.quantity" placeholder="1" class="w-full min-w-0 border border-slate-300 dark:border-slate-600 rounded-l-md px-1.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none" />
                            <span class="shrink-0 border border-l-0 border-slate-300 dark:border-slate-600 rounded-r-md px-2 py-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">{{ warrantyUnit() }}</span>
                          </div>
                        </label>
                        <label class="block">
                          <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{{ prefs.txt('গ্রহণ তারিখ', 'Receive Date') }}</span>
                          <input type="date" appDmyDate [(ngModel)]="warranty.receiveDate" class="w-full border border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none" />
                        </label>
                        <label class="block">
                          <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{{ prefs.txt('পণ্য কোড/IMEI', 'Product Code / IMEI') }}</span>
                          <input type="text" [(ngModel)]="warranty.oldSerial" class="w-full border border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none" />
                        </label>
                        <label class="col-span-2 block">
                          <span class="block text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">{{ prefs.txt('নোট / সমস্যা', 'Note / Issue') }}</span>
                          <textarea [(ngModel)]="warranty.notes" rows="2" [placeholder]="prefs.txt('ঐচ্ছিক — সমস্যা বা মন্তব্য লিখুন', 'Optional — issue or remark')" class="w-full border border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-1 text-[11px] font-semibold bg-white dark:bg-slate-950 dark:text-slate-100 focus:border-teal-500 outline-none"></textarea>
                        </label>
                        <p class="col-span-2 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/40 px-2 py-1.5 text-[9px] leading-snug text-teal-800 dark:text-teal-300">
                          {{ prefs.txt('সেভ করলে ক্লেইম নম্বর অটো তৈরি হয়ে ওয়ারেন্টি ম্যানেজমেন্টের তালিকা, রেজিস্টার ও গ্রহণ স্টকে সংরক্ষিত হবে। নতুন ব্যাটারি বিক্রি করলে কার্টে পণ্য যোগ করুন।', 'Saving auto-generates the claim number and stores it in Warranty Management — list, register and received stock. Add the new battery as a cart line when you sell one.') }}
                        </p>
                      </div>
                    }
                  </section>

                  <section class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <header class="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                      <mat-icon class="text-emerald-600 dark:text-emerald-400" style="font-size:15px;width:15px;height:15px;">payments</mat-icon>
                      <span class="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">{{ prefs.txt('নগদ ও ব্যাংক', 'Cash & Bank') }}</span>
                    </header>
                    <div class="p-3 space-y-2.5">
                      <div class="grid grid-cols-2 gap-2">
                        <label class="block">
                          <span class="text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-400">{{ prefs.t('pos.cashReceived') }}</span>
                          <input type="number" inputmode="decimal" min="0" step="0.01" [value]="cashInput()" (input)="onCashInput($event)"
                            class="w-full mt-1 border-2 border-emerald-200 dark:border-emerald-800 rounded-lg px-2.5 py-2 text-lg font-black font-mono text-emerald-900 dark:text-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/30 outline-none focus:border-emerald-500" />
                        </label>
                        <label class="block">
                          <span class="text-[10px] font-black uppercase text-sky-700 dark:text-sky-400">{{ prefs.txt('ব্যাংক / ডিজিটাল', 'Bank / Digital') }}</span>
                          <input type="number" inputmode="decimal" min="0" step="0.01" [value]="bankInput()" (input)="onBankInput($event)"
                            class="w-full mt-1 border-2 border-sky-200 dark:border-sky-800 rounded-lg px-2.5 py-2 text-lg font-black font-mono text-sky-900 dark:text-sky-200 bg-sky-50/40 dark:bg-sky-950/30 outline-none focus:border-sky-500" />
                        </label>
                      </div>
                      <div class="flex gap-1.5">
                        <button type="button" (click)="setTender('exact')" class="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg py-1.5 text-[10px] font-bold hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-slate-200">{{ prefs.t('pos.exact') }}</button>
                        @for (amt of quickAmounts; track amt) {
                          <button type="button" (click)="setTender(amt)" class="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg py-1.5 text-[10px] font-bold font-mono hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-slate-200">{{ amt }}</button>
                        }
                      </div>
                      <label class="block">
                        <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400">{{ prefs.txt('পেমেন্ট রেফারেন্স / মেমো নোট', 'Payment Reference / Memo Note') }}</span>
                        <input type="text" [value]="paymentNotes()" (input)="onPayNotes($event)" [placeholder]="prefs.txt('ঐচ্ছিক — রশিদে প্রিন্ট হবে (যেমন: বিকাশ TXN-001)', 'Optional — printed on the receipt (e.g. bKash TXN-001)')"
                          class="w-full mt-0.5 border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 font-semibold dark:bg-slate-950 dark:text-slate-100 outline-none focus:border-teal-500" />
                      </label>
                    </div>
                  </section>
                </div>

                <!-- RIGHT: final account summary -->
                <div class="space-y-3 lg:sticky lg:top-3">
                  <section class="overflow-hidden rounded-xl border border-[#cbd5d5] dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
                    <div class="flex items-center justify-between gap-2 border-b border-[#cbd5d5] dark:border-slate-700 bg-[#edf4f2] dark:bg-slate-800 px-3 py-2">
                      <span class="text-[11px] font-black tracking-wide text-[#17252c] dark:text-slate-100">{{ prefs.txt('চূড়ান্ত হিসাবের সারাংশ', 'Final Account Summary') }}</span>
                      <span class="font-mono text-[10px] text-slate-500 dark:text-slate-400">{{ nextInvoiceNo() }}</span>
                    </div>
                    <table class="w-full border-collapse text-[11px]">
                      <tbody>
                        <tr>
                          <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('চলতি নিট বিল (+)', 'Current Net Bill (+)') }}</td>
                          <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ itemsNet() | number:'1.2-2' }}</td>
                        </tr>
                        @if (orderDiscountAmount() > 0) {
                          <tr>
                            <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('অর্ডার ডিসকাউন্ট (-)', 'Order Discount (-)') }}</td>
                            <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ orderDiscountAmount() | number:'1.2-2' }}</td>
                          </tr>
                        }
                        @if (taxAmount() > 0) {
                          <tr>
                            <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('ট্যাক্স (+)', 'Tax (+)') }}</td>
                            <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ taxAmount() | number:'1.2-2' }}</td>
                          </tr>
                        }
                        @if (transportLabour() > 0) {
                          <tr>
                            <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('পরিবহন ও শ্রম চার্জ (+)', 'Transport & Labour Charge (+)') }}</td>
                            <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ transportLabour() | number:'1.2-2' }}</td>
                          </tr>
                        }
                        @if (warrantyTransport() > 0) {
                          <tr>
                            <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('ওয়ারেন্টি পরিবহন চার্জ (+)', 'Warranty Transport Charge (+)') }}</td>
                            <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ warrantyTransport() | number:'1.2-2' }}</td>
                          </tr>
                        }
                        @if (damageAmount() > 0) {
                          <tr>
                            <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('ড্যামেজ চার্জ (+)', 'Damage Charge (+)') }}</td>
                            <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ damageAmount() | number:'1.2-2' }}</td>
                          </tr>
                        }
                        <tr class="font-bold">
                          <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800/70 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('মোট ভাউচার বিল', 'TOTAL VOUCHER BILL') }}</td>
                          <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800/70 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ payTotal() | number:'1.2-2' }}</td>
                        </tr>
                        @if (previousDueAmount() > 0) {
                          <tr>
                            <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('আগের বাকি (+)', 'Previous Balance (+)') }}</td>
                            <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ previousDueAmount() | number:'1.2-2' }}</td>
                          </tr>
                        }
                        <tr class="font-bold">
                          <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800/70 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('সর্বমোট পরিশোধযোগ্য', 'TOTAL PAYABLE') }}</td>
                          <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800/70 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ totalPayable() | number:'1.2-2' }}</td>
                        </tr>
                        @if (cashPaid() > 0) {
                          <tr>
                            <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('নগদ গ্রহণ (-)', 'Cash Received (-)') }}</td>
                            <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ cashPaid() | number:'1.2-2' }}</td>
                          </tr>
                        }
                        @if (bankPaid() > 0) {
                          <tr>
                            <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('ব্যাংক পেমেন্ট গ্রহণ (-)', 'Bank Payment Received (-)') }}</td>
                            <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ bankPaid() | number:'1.2-2' }}</td>
                          </tr>
                        }
                        @if (oldBatteryCredit() > 0) {
                          <tr>
                            <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('পুরাতন ব্যাটারি ক্রেডিট (-)', 'Old Battery Credit (-)') }}</td>
                            <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ oldBatteryCredit() | number:'1.2-2' }}</td>
                          </tr>
                        }
                        @if (returnsCredit() > 0) {
                          <tr>
                            <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('ফেরত মাল ক্রেডিট (-)', 'Returned Goods Credit (-)') }}</td>
                            <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ returnsCredit() | number:'1.2-2' }}</td>
                          </tr>
                        }
                        <tr class="font-bold">
                          <td class="w-[67%] border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800/70 px-2 py-[7px] text-[10.5px] text-[#17252c] dark:text-slate-200">{{ prefs.txt('মোট পেমেন্ট / ক্রেডিট', 'TOTAL PAYMENTS / CREDITS') }}</td>
                          <td class="whitespace-nowrap border-b border-[#d8dfe1] dark:border-slate-700 bg-[#f3f7f6] dark:bg-slate-800/70 px-2 py-[7px] text-right font-mono text-[10.5px] tabular-nums text-[#17252c] dark:text-slate-200">{{ paymentsAndCredits() | number:'1.2-2' }}</td>
                        </tr>
                        <tr class="font-bold text-white">
                          <td class="bg-[#087d6c] px-2 py-2 text-[11px]">{{ finalBalanceLabel() }}</td>
                          <td class="whitespace-nowrap bg-[#087d6c] px-2 py-2 text-right font-mono text-[11px] tabular-nums">{{ finalBalanceAmount() | number:'1.2-2' }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div class="grid grid-cols-2 gap-2 border-t border-[#cbd5d5] dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 p-2.5">
                      <div class="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 px-2 py-1.5">
                        <div class="text-[9px] font-black uppercase text-emerald-600 dark:text-emerald-400">{{ prefs.t('pos.change') }}</div>
                        <div class="font-mono font-black text-emerald-700 dark:text-emerald-300">{{ changeDue() | number:'1.2-2' }}</div>
                      </div>
                      <div class="rounded-lg border px-2 py-1.5"
                        [ngClass]="remainingDue() > 0
                          ? 'bg-rose-50 border-rose-100 dark:bg-rose-950/50 dark:border-rose-900'
                          : 'bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-700'">
                        <div class="text-[9px] font-black uppercase" [class.text-rose-500]="remainingDue() > 0" [class.text-slate-500]="remainingDue() === 0">{{ prefs.t('pos.remainingDue') }}</div>
                        <div class="font-mono font-black" [class.text-rose-600]="remainingDue() > 0" [class.text-slate-800]="remainingDue() === 0" [class.dark:text-slate-100]="remainingDue() === 0">{{ remainingDue() | number:'1.2-2' }}</div>
                      </div>
                    </div>
                  </section>

                  @if (paymentError()) {
                    <p class="text-[11px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
                      <mat-icon class="text-rose-500 shrink-0" style="font-size:14px;width:14px;height:14px;">error</mat-icon>
                      <span>{{ paymentError() }}</span>
                    </p>
                  }

                  @if (selectedParty(); as c) {
                    <div class="flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5">
                      <span class="w-8 h-8 rounded-full bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
                        <mat-icon class="text-base">person</mat-icon>
                      </span>
                      <div class="min-w-0">
                        <p class="font-bold text-slate-800 dark:text-slate-100 text-[11px] truncate">{{ c.name }}</p>
                        <p class="text-[10px] text-slate-500 dark:text-slate-400 truncate">{{ rolesOf(c) }}</p>
                        <p class="text-[10px] font-semibold text-slate-600 dark:text-slate-300 mt-0.5">
                          {{ prefs.t('pos.previousDue') }}:
                          <b class="font-mono" [class.text-rose-600]="dueOf(c) > 0">{{ dueOf(c) | number:'1.2-2' }} TK</b>
                        </p>
                      </div>
                    </div>
                  }
                </div>
              </div>
            </div>

            <div class="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex gap-2 shrink-0">
              <button type="button" (click)="isPayModalOpen.set(false)" class="flex-1 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded-xl py-3 font-bold text-slate-700 dark:text-slate-200">{{ prefs.t('common.cancel') }}</button>
              <button type="button" (click)="confirmPayment()" class="flex-[2] bg-teal-700 hover:bg-teal-800 text-white rounded-xl py-3 font-black uppercase flex items-center justify-center gap-2">
                <mat-icon class="text-base">check_circle</mat-icon>
                {{ prefs.t('pos.completeSale') }}
                <span class="font-mono normal-case">• {{ totalPayable() | number:'1.2-2' }} TK</span>
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Phone search results: floats above the soft keyboard so every row stays tappable -->
      @if (isPhone() && phoneSearchOpen() && searchEntries().length > 0) {
        <div class="fixed left-2 right-2 z-[62] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          [style.bottom.px]="keyboardInset() + 8"
          [style.maxHeight.px]="phoneSheetMaxHeight()">
          <div class="shrink-0 flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/60">
            <mat-icon class="shrink-0 text-teal-600" style="font-size:16px;width:16px;height:16px;">search</mat-icon>
            <p class="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">
              <span class="font-mono text-teal-700 dark:text-teal-300">“{{ searchQuery() }}”</span>
              <span class="text-slate-400"> • {{ searchEntries().length }} {{ prefs.txt('টি ফলাফল', 'results') }}</span>
            </p>
            <button type="button" (click)="closePhoneSearch()" [attr.aria-label]="prefs.txt('বন্ধ করুন', 'Close')"
              class="shrink-0 -mr-1 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            @for (hit of searchEntries(); track hit.product.id + '-' + (hit.variant?.id ?? 0)) {
              <ng-container [ngTemplateOutlet]="searchHitTpl" [ngTemplateOutletContext]="{ $implicit: hit }" />
            }
          </div>
        </div>
      }

      <!-- Phone return-item results (inside the checkout sheet): same keyboard-safe treatment -->
      @if (isPhone() && isPayModalOpen() && returnSearchOpen() && returnSearchQuery().trim()) {
        <div class="fixed left-2 right-2 z-[66] flex flex-col overflow-hidden rounded-2xl border border-teal-200 bg-white shadow-2xl dark:border-teal-800 dark:bg-slate-900"
          [style.bottom.px]="keyboardInset() + 8"
          [style.maxHeight.px]="phoneSheetMaxHeight()">
          <div class="shrink-0 flex items-center gap-2 border-b border-teal-100 bg-teal-50/70 px-3 py-2 dark:border-teal-900 dark:bg-teal-950/40">
            <mat-icon class="shrink-0 text-teal-600" style="font-size:16px;width:16px;height:16px;">assignment_return</mat-icon>
            <p class="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">
              <span class="font-mono text-teal-700 dark:text-teal-300">“{{ returnSearchQuery() }}”</span>
            </p>
            <button type="button" (click)="clearReturnSearch()" [attr.aria-label]="prefs.txt('বন্ধ করুন', 'Close')"
              class="shrink-0 -mr-1 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>
          <div class="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] dark:divide-slate-800">
            <ng-container [ngTemplateOutlet]="returnResultsTpl" />
          </div>
        </div>
      }

      <!-- Customer picker (phone): bottom sheet -->
      @if (customerOpen() && isPhone()) {
        <div class="fixed inset-0 z-[62] bg-slate-900/60 backdrop-blur-sm flex items-end justify-center"
          [style.paddingBottom.px]="keyboardInset()" (click)="customerOpen.set(false)">
          <div class="bg-white dark:bg-slate-900 w-full rounded-t-2xl shadow-2xl max-h-[88dvh] flex flex-col" (click)="$event.stopPropagation()"
            [style.maxHeight]="keyboardInset() > 0 ? phoneSheetMaxHeight() + 'px' : null">
            <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h2 class="font-black text-sm flex items-center gap-1.5 dark:text-slate-100">
                <mat-icon class="text-teal-600 dark:text-teal-400 text-base">person_search</mat-icon>
                {{ prefs.txt('কাস্টমার নির্বাচন', 'Select customer') }}
              </h2>
              <button type="button" (click)="customerOpen.set(false)" [attr.aria-label]="prefs.txt('বন্ধ করুন', 'Close')" class="p-1 text-slate-400 hover:text-slate-700">
                <mat-icon class="text-base">close</mat-icon>
              </button>
            </div>
            <div class="px-3 pt-3 shrink-0">
              <input type="text" [value]="customerQuery()" (input)="onCustomerInput($event)" (keydown)="onCustomerKeydown($event)"
                [placeholder]="prefs.t('pos.searchCustomer')" autocomplete="off"
                class="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-xl px-3 py-2.5 text-sm max-sm:text-[16px] font-semibold outline-none focus:border-teal-500" />
            </div>
            <div class="overflow-y-auto overscroll-contain flex-1 min-h-0 py-2">
              <ng-container [ngTemplateOutlet]="customerListTpl" />
            </div>
            <div class="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-200 dark:border-slate-800 shrink-0">
              <button type="button" (click)="openNewCustomer()" class="w-full bg-teal-700 hover:bg-teal-800 active:bg-teal-800 text-white rounded-xl py-3 font-black flex items-center justify-center gap-1.5">
                <mat-icon class="text-base">person_add</mat-icon> {{ prefs.t('pos.newCustomer') }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- New customer modal -->
      @if (isCustomerModalOpen()) {
        <div class="fixed inset-0 z-[65] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
          <form [formGroup]="customerForm" (ngSubmit)="saveNewCustomer()"
            class="bg-white dark:bg-slate-900 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto overscroll-contain">
            <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 class="font-black text-sm flex items-center gap-1.5 dark:text-slate-100">
                <mat-icon class="text-teal-600 dark:text-teal-400 text-base">person_add</mat-icon> {{ prefs.t('pos.newCustomer') }}
              </h2>
              <button type="button" (click)="isCustomerModalOpen.set(false)" class="p-1 text-slate-400 hover:text-slate-700">
                <mat-icon class="text-base">close</mat-icon>
              </button>
            </div>
            <div class="p-4 space-y-2.5">
              <div>
                <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">{{ prefs.t('pos.customerName') }} *</label>
                <input formControlName="name" type="text" [placeholder]="prefs.txt('মোঃ রহিম উদ্দিন', 'e.g. John Doe')"
                  class="w-full border border-slate-300 rounded-lg px-3 py-2 font-semibold focus:border-teal-500 outline-none" />
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">{{ prefs.t('pos.phone') }}</label>
                  <input formControlName="phone" type="tel" placeholder="01XXXXXXXXX"
                    class="w-full border border-slate-300 rounded-lg px-3 py-2 font-semibold focus:border-teal-500 outline-none" />
                </div>
                <div>
                  <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">{{ prefs.t('pos.customerType') }}</label>
                  <select formControlName="type" class="w-full border border-slate-300 rounded-lg px-2 py-2 font-semibold bg-white focus:border-teal-500 outline-none">
                    <option value="Customer">{{ prefs.txt('কাস্টমার', 'Customer') }}</option>
                    <option value="Corporate Customer">{{ prefs.txt('কর্পোরেট কাস্টমার', 'Corporate Customer') }}</option>
                    <option value="Dealer">{{ prefs.txt('ডিলার', 'Dealer') }}</option>
                  </select>
                </div>
              </div>
              <app-geo-select
                [(division)]="customerDivision"
                [(district)]="customerDistrict"
                [(upazila)]="customerUpazila">
              </app-geo-select>
              <div>
                <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">{{ prefs.txt('ঠিকানা', 'Address') }}</label>
                <textarea [(ngModel)]="customerAddress" [ngModelOptions]="{standalone: true}" rows="2" [placeholder]="prefs.txt('বাসা/রোড, এলাকা, উপজেলা, জেলা...', 'House/road, area, upazila, district...')"
                  class="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 text-xs font-medium focus:border-teal-500 outline-none resize-none"></textarea>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <span class="block text-[10px] font-bold uppercase text-slate-500 mb-1">{{ prefs.txt('প্রোফাইল ছবি', 'Profile photo') }}</span>
                  <label class="flex items-center justify-center gap-1 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg py-2 text-[11px] text-slate-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                    <mat-icon class="text-sm">photo_camera</mat-icon> {{ customerPhoto() ? prefs.txt('পরিবর্তন', 'Change') : prefs.txt('ছবি যোগ', 'Add photo') }}
                    <input type="file" accept="image/*" (change)="onCustomerPhoto($event)" class="hidden" />
                  </label>
                  @if (customerPhoto()) {
                    <img [src]="customerPhoto()" alt="photo" class="mt-1 w-10 h-10 rounded-full object-cover border"  loading="lazy" decoding="async" />
                  }
                </div>
                <div>
                  <span class="block text-[10px] font-bold uppercase text-slate-500 mb-1">{{ prefs.txt('ভোটার ডকুমেন্ট', 'Voter document') }}</span>
                  <label class="flex items-center justify-center gap-1 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg py-2 text-[11px] text-slate-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                    <mat-icon class="text-sm">badge</mat-icon> {{ customerDoc() ? prefs.txt('পরিবর্তন', 'Change') : prefs.txt('ডক যোগ', 'Add doc') }}
                    <input type="file" accept="image/*" (change)="onCustomerDoc($event)" class="hidden" />
                  </label>
                  @if (customerDoc()) {
                    <img [src]="customerDoc()" alt="document" class="mt-1 h-10 w-16 rounded object-cover border"  loading="lazy" decoding="async" />
                  }
                </div>
              </div>
              <p class="text-[10px] text-slate-400">{{ prefs.txt('ছবি ও ডকুমেন্ট ঐচ্ছিক।', 'Photo and document are optional.') }}</p>
              @if (customerError()) {
                <p class="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">{{ customerError() }}</p>
              }
            </div>
            <div class="px-4 py-3 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button type="button" (click)="isCustomerModalOpen.set(false)" class="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg font-semibold text-slate-700 dark:text-slate-200">{{ prefs.t('common.cancel') }}</button>
              <button type="submit" [disabled]="savingCustomer()" class="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg font-bold disabled:opacity-60">{{ prefs.t('common.save') }}</button>
            </div>
          </form>
        </div>
      }

      <!-- POS receipt (80mm) -->
      @if (receipt(); as r) {
        <div class="fixed inset-0 z-[70] bg-slate-900/70 flex items-center justify-center p-3">
          <div class="bg-white rounded-xl shadow-2xl w-full max-w-[330px] overflow-hidden flex flex-col max-h-[92dvh]">
            <div class="px-3 py-2 border-b border-slate-200 flex items-center justify-between no-print shrink-0">
              <span class="font-bold text-slate-700 text-xs flex items-center gap-1">
                <mat-icon class="text-emerald-600 text-sm">check_circle</mat-icon> {{ prefs.t('pos.saleComplete') }}
              </span>
              <div class="flex items-center gap-1">
                <app-share-invoice
                  [iconOnly]="true"
                  [paperEl]="receiptPaper"
                  [fileName]="'Invoice_' + r.invoice"
                  [title]="'POS Receipt ' + r.invoice"
                  [message]="receiptShareText(r)"
                  [pdfWidthMm]="80"
                />
                <button type="button" (click)="closeReceipt()" class="p-1 text-slate-400 hover:text-slate-700">
                  <mat-icon class="text-sm">close</mat-icon>
                </button>
              </div>
            </div>

            <div class="overflow-y-auto">
              <div #receiptPaper id="receipt-print-area" class="receipt-paper p-4 text-slate-900 bg-white"
                [attr.data-pos-shop]="(settings().businessNamePart1 + ' ' + settings().businessNamePart2).trim()"
                [attr.data-pos-doc]="prefs.t('pos.receipt')"
                [attr.data-pos-invoice]="r.invoice"
                [attr.data-pos-page-word]="prefs.txt('পৃষ্ঠা', 'Page')"
                [attr.data-pos-continued]="prefs.txt('পরবর্তী পৃষ্ঠা', 'continued')">
                <div data-pos="head" class="text-center border-b border-dashed border-slate-400 pb-2">
                  <p class="font-black text-sm tracking-wide">{{ settings().businessNamePart1 }} {{ settings().businessNamePart2 }}</p>
                  <p class="text-[10px]">{{ settings().address }}</p>
                  <p class="text-[10px]">{{ prefs.txt('মোবাইল', 'Mobile') }}: {{ settings().mobile }}</p>
                  <p class="font-black text-[11px] mt-1 uppercase tracking-wider">{{ prefs.t('pos.receipt') }}</p>
                </div>

                <div data-pos="meta" class="text-[10px] space-y-0.5 mt-2">
                  <div class="flex justify-between gap-2"><span>{{ prefs.t('pos.invoice') }}</span><b class="font-mono">{{ r.invoice }}</b></div>
                  <div class="flex justify-between gap-2"><span>{{ prefs.t('common.date') }}</span><b>{{ r.date }} {{ r.time }}</b></div>
                  <div class="flex justify-between gap-2"><span>{{ prefs.t('pos.cashier') }}</span><b>{{ r.cashier }}</b></div>
                  <div class="flex justify-between gap-2"><span>{{ prefs.t('common.name') }}</span><b class="text-right">{{ r.customer }}</b></div>
                  <div class="flex justify-between gap-2"><span>{{ prefs.t('pos.phone') }}</span><b>{{ r.phone || '—' }}</b></div>
                </div>

                <table data-pos="items" class="w-full text-[10px] mt-2 border-collapse">
                  <thead>
                    <tr class="border-y border-dashed border-slate-400 text-left">
                      <th class="py-1 font-bold">{{ prefs.txt('পণ্য', 'Item') }}</th>
                      <th class="py-1 font-bold text-center whitespace-nowrap">{{ prefs.txt('পরিমাণ × দর', 'Qty × Rate') }}</th>
                      <th class="py-1 font-bold text-right">{{ prefs.txt('টাকা', 'Amount') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (it of r.items; track it.id) {
                      <tr class="align-top border-b border-dotted border-slate-200 last:border-0">
                        <td class="py-0.5 pr-1">{{ savedItemLabel(it) }}</td>
                        <td class="py-0.5 text-center whitespace-nowrap">{{ it.quantity }} {{ it.unit }} × {{ it.salesPrice | number:'1.2-2' }}
                          @if (receiptLineNote(it)) {
                            <div class="text-[8px] text-slate-500">{{ receiptLineNote(it) }}</div>
                          }
                        </td>
                        <td class="py-0.5 text-right font-mono whitespace-nowrap">{{ it.total | number:'1.2-2' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>

                @if (r.warranty; as w) {
                  <div data-pos="extra" class="text-[10px] mt-2 pt-2 border-t border-dashed border-slate-400 space-y-0.5">
                    <p class="font-black uppercase tracking-wide">{{ prefs.txt('ওয়ারেন্টি ক্লেইম', 'Warranty Claim') }}</p>
                    @if (w.claimNo) {
                      <div class="flex justify-between gap-2"><span>{{ prefs.txt('ক্লেইম নং', 'Claim No.') }}</span><b class="font-mono">{{ w.claimNo }}</b></div>
                    }
                    @if (w.originalInvoice) {
                      <div class="flex justify-between gap-2"><span>{{ prefs.txt('মূল ইনভয়েস', 'Original Invoice') }}</span><b class="font-mono">{{ w.originalInvoice }}</b></div>
                    }
                    @if (w.battery) {
                      <div class="flex justify-between gap-2"><span>{{ prefs.txt('ব্যাটারি', 'Battery') }}</span><b>{{ w.battery }}{{ w.quantity ? ' × ' + w.quantity : '' }}</b></div>
                    }
                    @if (w.newSerial || w.oldSerial) {
                      <div class="flex justify-between gap-2"><span>{{ prefs.txt('নতুন সিরিয়াল', 'New Serial') }}</span><b class="font-mono">{{ w.newSerial || w.oldSerial }}</b></div>
                    }
                    @if (w.replacementProductName) {
                      <div class="flex justify-between gap-2"><span>{{ prefs.txt('নতুন ব্যাটারি', 'Replacement') }}</span><b class="text-right">{{ w.replacementProductName }}{{ w.replacementQty ? ' × ' + w.replacementQty : '' }}</b></div>
                    }
                    <div class="flex justify-between gap-2"><span>{{ prefs.txt('স্ট্যাটাস', 'Status') }}</span><b>{{ warrantyStatusLabel(w.status) }}</b></div>
                  </div>
                }

                <div data-pos="summary" class="text-[10px] mt-2 pt-2 border-t border-dashed border-slate-400 space-y-0.5">
                  <div class="flex justify-between"><span>{{ prefs.t('pos.subtotal') }}</span><span class="font-mono">{{ r.subtotal | number:'1.2-2' }}</span></div>
                  @if (r.tax > 0) {
                    <div class="flex justify-between"><span>{{ prefs.t('pos.tax') }}</span><span class="font-mono">{{ r.tax | number:'1.2-2' }}</span></div>
                  }
                  @if (r.discount > 0) {
                    <div class="flex justify-between"><span>Order Discount</span><span class="font-mono">-{{ r.discount | number:'1.2-2' }}</span></div>
                  }
                  @if (r.shipping > 0) {
                    <div class="flex justify-between"><span>Transport & Labour</span><span class="font-mono">{{ r.shipping | number:'1.2-2' }}</span></div>
                  }
                  @if (r.warrantyTransport > 0) {
                    <div class="flex justify-between"><span>Warranty Transport</span><span class="font-mono">{{ r.warrantyTransport | number:'1.2-2' }}</span></div>
                  }
                  @if (r.damage > 0) {
                    <div class="flex justify-between"><span>Damage</span><span class="font-mono">{{ r.damage | number:'1.2-2' }}</span></div>
                  }
                  @if (r.previousDue > 0) {
                    <div class="flex justify-between"><span>Previous Balance</span><span class="font-mono">{{ r.previousDue | number:'1.2-2' }}</span></div>
                  }
                  <div class="flex justify-between font-black text-sm border-t border-slate-400 mt-1 pt-1">
                    <span>TOTAL</span><span class="font-mono">{{ r.total | number:'1.2-2' }} TK</span>
                  </div>
                  <div class="flex justify-between mt-1"><span>{{ r.method }}</span><span class="font-mono">{{ r.paid | number:'1.2-2' }}</span></div>
                  @if (r.batteryCredit > 0) {
                    <div class="flex justify-between"><span>Old Battery Credit</span><span class="font-mono">-{{ r.batteryCredit | number:'1.2-2' }}</span></div>
                  }
                  @if (r.returnsCredit > 0) {
                    <div class="flex justify-between"><span>Returned Goods</span><span class="font-mono">-{{ r.returnsCredit | number:'1.2-2' }}</span></div>
                  }
                  @if (r.change > 0) {
                    <div class="flex justify-between"><span>{{ prefs.t('pos.change') }}</span><span class="font-mono">{{ r.change | number:'1.2-2' }}</span></div>
                  }
                  @if (r.due > 0) {
                    <div class="flex justify-between font-bold text-rose-700"><span>{{ prefs.t('pos.remainingDue') }}</span><span class="font-mono">{{ r.due | number:'1.2-2' }}</span></div>
                  }
                </div>

                <p data-pos="footer" class="text-[10px] text-center mt-2 font-semibold">{{ prefs.t('pos.thankYou') }}</p>
                <p data-pos="footer" class="text-[9px] text-center text-slate-500 mt-0.5">Powered by SM Enterprise</p>

                @if (r.notes) {
                  <div data-pos="notes" class="mt-2 border-t border-dashed border-slate-400 pt-2 text-[10px] leading-snug">
                    <b>{{ prefs.txt('নোট', 'Note') }}:</b> {{ r.notes }}
                  </div>
                }

                @if (r.qrUrl) {
                  <div data-pos="qr" class="mt-2 flex justify-center">
                    <img [src]="r.qrUrl" alt="Voucher QR" class="w-[72px] h-[72px]" />
                  </div>
                }
              </div>
            </div>

            <div class="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-200 bg-slate-50 flex gap-2 no-print shrink-0">
              <button type="button" (click)="printReceipt()" class="flex-1 bg-teal-700 hover:bg-teal-800 text-white rounded-lg py-2.5 font-bold flex items-center justify-center gap-1">
                <mat-icon class="text-base">print</mat-icon> {{ prefs.t('pos.printReceipt') }}
              </button>
              <button type="button" (click)="closeReceipt()" class="flex-1 bg-white border border-slate-300 text-slate-700 rounded-lg py-2.5 font-bold">{{ prefs.t('pos.newSale') }}</button>
            </div>
          </div>
        </div>
      }

      <app-barcode-scanner #scanCam [continuous]="true" (scanned)="onCameraScan($event)" />
    </div>
  `
})
export class Pos implements OnInit {
  dataService = inject(DataService);
  fb = inject(FormBuilder);
  private readonly injector = inject(Injector);
  session = inject(SessionService);
  prefs = inject(PreferencesService);
  notify = inject(NotificationService);
  media = inject(MediaService);
  readonly noImage = NO_IMAGE;

  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('posSearch');
  readonly cameraScanner = viewChild<BarcodeScanner>('scanCam');
  private readonly categoryChips = viewChild<ElementRef<HTMLElement>>('categoryChips');
  private readonly mobileProductGrid = viewChild<ElementRef<HTMLElement>>('mobileProductGrid');
  private readonly categoryTiles = viewChild<ElementRef<HTMLElement>>('categoryTiles');
  private readonly desktopProductGrid = viewChild<ElementRef<HTMLElement>>('desktopProductGrid');
  private readonly drillScroll = new Map<string, { strip: number; grid: number }>();

  posForm = this.fb.group({
    customer: ['Walk In Customer'],
    status: ['Completed'],
    orderTax: [0],
    discountAmount: [0],
    discountType: ['fixed'],
    shippingAmount: [0],
    warrantyTransport: [0],
    damageAmount: [0],
    grandTotal: [0],
    cart: this.fb.array([])
  });

  searchControl = new FormControl('');
  searchQuery = toSignal(this.searchControl.valueChanges.pipe(startWith('')), { initialValue: '' });

  selectedCategory = signal<string>('All');
  selectedSubCategory = signal<string | null>(null);
  selectedBrand = signal<string | null>(null);
  selectedModel = signal<string | null>(null);
  mobileTab = signal<'products' | 'cart'>('products');
  /** Phone cart keeps charges folded away until the cashier needs them. */
  readonly phoneChargesOpen = signal(false);
  readonly phoneChargesPanel = viewChild<ElementRef<HTMLElement>>('phoneChargesPanel');

  togglePhoneCharges() {
    this.phoneChargesOpen.update(open => !open);
    if (!this.phoneChargesOpen()) return;
    // The panel sits below the item cards, so opening it alone would stay off-screen.
    setTimeout(() => this.phoneChargesPanel()?.nativeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  togglePosQr() {
    const enabled = !this.settings().showPosQrCode;
    this.dataService.updateVoucherSettings({ showPosQrCode: enabled });
    this.notify.success(
      enabled ? this.prefs.txt('POS রশিদে QR কোড চালু হয়েছে', 'QR code on POS receipt turned on')
              : this.prefs.txt('POS রশিদে QR কোড বন্ধ হয়েছে', 'QR code on POS receipt turned off'),
      this.prefs.txt('QR কোড', 'QR code')
    );
  }

  private readonly viewportWidth = signal(typeof window === 'undefined' ? 1200 : window.innerWidth);
  readonly isPhone = computed(() => this.viewportWidth() < 640);

  /** Visible height of the browser window minus the soft keyboard (visualViewport when available). */
  readonly visibleHeight = signal(typeof window === 'undefined' ? 800 : window.innerHeight);
  /** Pixels the soft keyboard covers at the bottom of the layout viewport. */
  readonly keyboardInset = signal(0);
  /** Sheet height that always clears the keyboard, so dropdown lists stay reachable. */
  readonly phoneSheetMaxHeight = computed(() =>
    Math.max(220, Math.min(540, Math.round(this.visibleHeight()) - 88)));

  private readonly destroyRef = inject(DestroyRef);

  @HostListener('window:resize')
  onWindowResize() {
    this.viewportWidth.set(window.innerWidth);
    this.syncVisualViewport();
  }

  private syncVisualViewport() {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const height = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    this.visibleHeight.set(Math.round(height));
    this.keyboardInset.set(Math.max(0, Math.round(window.innerHeight - height - top)));
  }

  // Phone search overlays live above the keyboard so the results list never hides behind it
  readonly phoneSearchOpen = signal<boolean>(false);

  openPhoneSearch() {
    if (this.isPhone()) this.phoneSearchOpen.set(true);
  }

  closePhoneSearch() {
    this.phoneSearchOpen.set(false);
  }

  pickSearchHit(hit: ProductSearchEntry) {
    this.addToCart(hit.product, hit.variant);
    this.searchControl.setValue('');
    this.phoneSearchOpen.set(false);
  }

  // Customer picker
  readonly customerWrap = viewChild<ElementRef<HTMLElement>>('customerWrap');
  customerOpen = signal<boolean>(false);
  customerQuery = signal<string>('');
  customerIndex = signal<number>(0);
  selectedCustomerName = signal<string>('Walk In Customer');
  selectedPartyId = signal<number | undefined>(undefined);

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent) {
    if (!this.customerOpen() || this.isPhone()) return;
    const target = event.target as Node | null;
    if (target && this.customerWrap()?.nativeElement.contains(target)) return;
    this.customerOpen.set(false);
  }

  selectedParty = computed<Party | null>(() =>
    this.dataService.partyForReference(this.selectedPartyId(), this.selectedCustomerName()) ?? null
  );

  dealerPricing = computed(() => {
    const party = this.selectedParty();
    return party ? hasPartyRole(party, 'Dealer') : false;
  });

  dueOf(party: Party): number {
    return salesAccountOf(party).due;
  }

  rolesOf(party: Party): string {
    const roles = party.roles && party.roles.length ? party.roles : [party.type];
    return Array.from(new Set(roles)).join(' • ');
  }

  customerLabel = computed(() =>
    this.selectedCustomerName() === 'Walk In Customer'
      ? this.prefs.t('pos.walkIn')
      : this.selectedCustomerName()
  );

  customerResults = computed(() => {
    const q = this.customerQuery().toLowerCase().trim();
    const list = this.dataService.parties().filter(p => hasSalesRole(p));
    if (!q) return list.slice(0, 40);
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.phone || '').toLowerCase().includes(q) ||
      (p.companyName || '').toLowerCase().includes(q)
    ).slice(0, 40);
  });

  // New customer modal
  isCustomerModalOpen = signal<boolean>(false);
  customerError = signal<string>('');
  customerForm = this.fb.group({
    name: ['', Validators.required],
    phone: [''],
    type: ['Customer']
  });
  customerPhoto = signal<string>('');
  customerDoc = signal<string>('');
  savingCustomer = signal<boolean>(false);
  customerDivision = '';
  customerDistrict = '';
  customerUpazila = '';
  customerAddress = '';

  // Payment (checkout sheet mirrors Add Sale's charges & payments)
  isPayModalOpen = signal<boolean>(false);
  cashInput = signal<string>('');
  bankInput = signal<string>('');
  private autoTender: string | null = null;
  paymentNotes = signal<string>('');
  paymentMethod = signal<PosPaymentMethod>('Cash');
  paymentError = signal<string>('');
  receipt = signal<PosReceipt | null>(null);

  readonly paymentMethods: PosPaymentMethod[] = ['Cash', 'Card', 'bKash', 'Nagad'];
  readonly quickAmounts = [500, 1000, 5000];

  // Same voucher credits as Add Sale: old battery, returned goods, warranty claim
  readonly batteryKinds = BATTERY_KINDS;
  readonly batteryEnabled = signal<boolean>(false);
  readonly batteryAdjustments = signal<BatteryAdjustmentItem[]>([]);
  readonly returnsEnabled = signal<boolean>(false);
  readonly returnRows = signal<SalesReturnItem[]>([]);
  readonly returnSearchQuery = signal<string>('');
  readonly returnSearchOpen = signal<boolean>(false);
  readonly hasWarrantyClaim = signal<boolean>(false);
  warranty: WarrantyClaimInfo = this.emptyWarrantyClaim();

  private emptyWarrantyClaim(): WarrantyClaimInfo {
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

  /** Line-discounted item total — Add Sale's "Current Net Bill". */
  readonly itemsNet = computed(() => this.cartSubtotal());

  readonly orderDiscountAmount = computed(() => {
    const value = Math.max(0, Number((this.formValue() as any).discountAmount) || 0);
    const net = this.itemsNet();
    const amount = (this.formValue() as any).discountType === 'percent' ? net * value / 100 : value;
    return this.round2(Math.min(amount, net));
  });

  readonly taxAmount = computed(() => {
    const rate = Math.max(0, Number((this.formValue() as any).orderTax) || 0);
    return this.round2(this.itemsNet() * rate / 100);
  });

  readonly transportLabour = computed(() => Math.max(0, Number((this.formValue() as any).shippingAmount) || 0));
  readonly warrantyTransport = computed(() => Math.max(0, Number((this.formValue() as any).warrantyTransport) || 0));
  readonly damageAmount = computed(() => Math.max(0, Number((this.formValue() as any).damageAmount) || 0));

  /** TOTAL VOUCHER BILL — the figure Add Sale stores as the sale's total. */
  readonly payTotal = computed(() => Math.max(0, this.round2(
    this.itemsNet()
    - this.orderDiscountAmount()
    + this.taxAmount()
    + this.transportLabour()
    + this.warrantyTransport()
    + this.damageAmount()
  )));

  readonly previousDueAmount = computed(() => {
    const party = this.selectedParty();
    return party ? Math.max(0, this.round2(this.dueOf(party))) : 0;
  });

  readonly totalPayable = computed(() => this.round2(this.payTotal() + this.previousDueAmount()));

  readonly oldBatteryCredit = computed(() => this.batteryEnabled()
    ? this.round2(this.batteryAdjustments().reduce((acc, b) => acc + (Number(b.total) || 0), 0))
    : 0);
  readonly returnsCredit = computed(() => this.returnsEnabled()
    ? this.round2(this.returnRows().reduce((acc, r) => acc + (Number(r.amount) || 0), 0))
    : 0);
  readonly creditsTotal = computed(() => this.round2(this.oldBatteryCredit() + this.returnsCredit()));
  /** What the customer still has to hand over after trade-in credits. */
  readonly netPayable = computed(() => Math.max(0, this.round2(this.totalPayable() - this.creditsTotal())));
  readonly paymentsAndCredits = computed(() => this.round2(this.paidNow() + this.creditsTotal()));

  readonly cashPaid = computed(() =>
    Math.min(Math.max(0, Number(this.cashInput()) || 0), this.netPayable()));
  readonly bankPaid = computed(() =>
    Math.min(Math.max(0, Number(this.bankInput()) || 0),
      Math.max(0, this.round2(this.netPayable() - this.cashPaid()))));
  readonly paidNow = computed(() => this.round2(this.cashPaid() + this.bankPaid()));

  readonly changeDue = computed(() =>
    Math.max(0, this.round2((Number(this.cashInput()) || 0) + (Number(this.bankInput()) || 0) - this.netPayable())));

  readonly remainingDue = computed(() => Math.max(0, this.round2(this.netPayable() - this.paidNow())));

  readonly finalBalance = computed(() => this.round2(this.totalPayable() - this.paymentsAndCredits()));
  readonly finalBalanceLabel = computed(() =>
    this.finalBalance() < 0
      ? this.prefs.txt('গ্রাহকের অগ্রিম', 'CUSTOMER ADVANCE')
      : (this.finalBalance() === 0
        ? this.prefs.txt('সম্পূর্ণ পরিশোধিত', 'PAID IN FULL')
        : this.prefs.txt('চূড়ান্ত বাকি', 'FINAL DUE BALANCE')));
  readonly finalBalanceAmount = computed(() => Math.abs(this.finalBalance()));
  readonly payDiscountType = computed(() =>
    (this.formValue() as any).discountType === 'percent' ? 'percent' : 'fixed');

  formValue = toSignal(this.posForm.valueChanges.pipe(startWith(this.posForm.value)), {
    initialValue: this.posForm.value as any
  });

  cartCount = computed(() => {
    const items: any[] = (this.formValue() as any).cart || [];
    return this.round2(items.reduce((acc, i) => acc + (Number(i.quantity) || 0), 0));
  });

  cartSubtotal = computed(() => {
    const items: any[] = (this.formValue() as any).cart || [];
    return this.round2(items.reduce((acc, i) => acc + this.calculateItemSubtotal(i), 0));
  });

  nextInvoiceNo = computed(() => this.dataService.peekSaleVoucherNo());
  settings = computed(() => this.dataService.voucherSettings());

  ngOnInit() {
    this.posForm.valueChanges.subscribe(() => {
        this.updateGrandTotal();
    });
    this.syncVisualViewport();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      const onChange = () => this.syncVisualViewport();
      vv.addEventListener('resize', onChange);
      vv.addEventListener('scroll', onChange);
      this.destroyRef.onDestroy(() => {
        vv.removeEventListener('resize', onChange);
        vv.removeEventListener('scroll', onChange);
      });
    }
  }

  @HostListener('document:keydown', ['$event'])
  onShortcut(event: KeyboardEvent) {
    if (event.key === 'F2') {
      event.preventDefault();
      this.searchInput()?.nativeElement.focus();
      this.searchInput()?.nativeElement.select();
      return;
    }
    if (event.key === 'F4') {
      event.preventDefault();
      this.resetCart();
      return;
    }
    if (event.key === 'F8') {
      event.preventDefault();
      if (this.cartArray.length && !this.isPayModalOpen() && !this.receipt()) this.checkout();
      return;
    }
    if (event.key === 'Escape') {
      if (this.phoneSearchOpen()) this.phoneSearchOpen.set(false);
      else if (this.returnSearchOpen()) this.returnSearchOpen.set(false);
      else if (this.receipt()) this.closeReceipt();
      else if (this.isCustomerModalOpen()) this.isCustomerModalOpen.set(false);
      else if (this.customerOpen()) this.customerOpen.set(false);
      else if (this.isPayModalOpen()) this.isPayModalOpen.set(false);
    }
  }

  get cartArray() {
    return this.posForm.get('cart') as FormArray;
  }

  get cartItems() {
    return this.cartArray.value;
  }

  calculateItemSubtotal(item: any): number {
    const base = (item.quantity || 0) * (item.price || 0);
    if (item.discountType === 'percent') {
        return base - (base * (item.discount || 0) / 100);
    }
    return base - (item.discount || 0);
  }

  private readonly cartItemThemes = [
    'border-amber-400 bg-amber-100 dark:border-amber-600/70 dark:bg-amber-900/30',
    'border-sky-400 bg-sky-100 dark:border-sky-600/70 dark:bg-sky-900/30',
    'border-rose-400 bg-rose-100 dark:border-rose-600/70 dark:bg-rose-900/30',
    'border-emerald-400 bg-emerald-100 dark:border-emerald-600/70 dark:bg-emerald-900/30',
    'border-violet-400 bg-violet-100 dark:border-violet-600/70 dark:bg-violet-900/30',
    'border-orange-400 bg-orange-100 dark:border-orange-600/70 dark:bg-orange-900/30',
    'border-cyan-400 bg-cyan-100 dark:border-cyan-600/70 dark:bg-cyan-900/30',
    'border-fuchsia-400 bg-fuchsia-100 dark:border-fuchsia-600/70 dark:bg-fuchsia-900/30'
  ];

  private readonly cartBadgeThemes = [
    'bg-amber-500 text-white',
    'bg-sky-500 text-white',
    'bg-rose-500 text-white',
    'bg-emerald-500 text-white',
    'bg-violet-500 text-white',
    'bg-orange-500 text-white',
    'bg-cyan-500 text-white',
    'bg-fuchsia-500 text-white'
  ];

  cartItemTheme(index: number): string {
    return this.cartItemThemes[index % this.cartItemThemes.length];
  }

  cartBadgeTheme(index: number): string {
    return this.cartBadgeThemes[index % this.cartBadgeThemes.length];
  }

  // Computed to determine current view level
  currentView = computed(() => {
    if (this.selectedModel()) return 'model';
    if (this.selectedBrand()) return 'brand';
    if (this.selectedSubCategory()) return 'subcategory';
    if (this.selectedCategory() !== 'All') return 'category';
    return 'all';
  });

  /** Folder the user drilled into; the back chip shows it so the path stays visible. */
  readonly drillFolderName = computed(() => {
    switch (this.currentView()) {
      case 'category': return this.selectedCategory();
      case 'subcategory': return this.selectedSubCategory() ?? '';
      case 'brand': return this.selectedBrand() ?? '';
      case 'model': return this.selectedModel() ?? '';
      default: return '';
    }
  });

  /** Remembered after backing out, so the shelf still shows which folder was opened last. */
  readonly lastOpenedFolder = signal<{ level: DrillLevel; name: string } | null>(null);

  isLastOpened(level: DrillLevel, name: string): boolean {
    const last = this.lastOpenedFolder();
    return !!last && last.level === level && last.name === name;
  }

  // Navigate back logic
  navigateBack() {
    this.rememberDrillPosition();
    if (this.selectedModel()) {
      this.lastOpenedFolder.set({ level: 'model', name: this.selectedModel()! });
      this.selectedModel.set(null);
    } else if (this.selectedBrand()) {
      this.lastOpenedFolder.set({ level: 'brand', name: this.selectedBrand()! });
      this.selectedBrand.set(null);
    } else if (this.selectedSubCategory()) {
      this.lastOpenedFolder.set({ level: 'subcategory', name: this.selectedSubCategory()! });
      this.selectedSubCategory.set(null);
    } else if (this.selectedCategory() !== 'All') {
      this.lastOpenedFolder.set({ level: 'category', name: this.selectedCategory() });
      this.selectedCategory.set('All');
    }
    this.resetProductLimit();
    this.restoreDrillPosition();
  }

  /** The drill level currently on screen, used to remember where the shelf was scrolled. */
  private drillKey(): string {
    return `${this.selectedCategory()}|${this.selectedSubCategory() ?? ''}|${this.selectedBrand() ?? ''}|${this.selectedModel() ?? ''}`;
  }

  private rememberDrillPosition() {
    const strip = (this.categoryTiles() ?? this.categoryChips())?.nativeElement;
    const grid = (this.desktopProductGrid() ?? this.mobileProductGrid())?.nativeElement;
    if (!strip && !grid) return;
    this.drillScroll.set(this.drillKey(), {
      strip: strip?.scrollLeft ?? 0,
      grid: grid?.scrollTop ?? 0
    });
  }

  /** After the new level renders, put the shelf strip and product grid back where they were. */
  private restoreDrillPosition() {
    const saved = this.drillScroll.get(this.drillKey());
    afterNextRender(() => {
      const strip = (this.categoryTiles() ?? this.categoryChips())?.nativeElement;
      const grid = (this.desktopProductGrid() ?? this.mobileProductGrid())?.nativeElement;
      if (strip) strip.scrollLeft = saved?.strip ?? 0;
      if (grid) grid.scrollTop = saved?.grid ?? 0;
    }, { injector: this.injector });
  }

  readonly activeCategories = computed(() => {
    const products = this.dataService.products();
    return this.dataService.categories().filter(c => products.some(p => p.category === c.name));
  });

  readonly activeSubCategories = computed(() => {
    const cat = this.selectedCategory();
    const products = this.dataService.products();
    return this.dataService.subCategories().filter(sub =>
      sub.parentCategory === cat && products.some(p => p.subCategory === sub.name)
    );
  });

  readonly activeBrands = computed(() => {
    const cat = this.selectedCategory();
    const sub = this.selectedSubCategory();
    const products = this.dataService.products();
    return this.dataService.brands().filter(brand =>
      products.some(p => p.category === cat && p.subCategory === sub && p.brand === brand.name)
    );
  });

  readonly activeModels = computed(() => {
    const cat = this.selectedCategory();
    const sub = this.selectedSubCategory();
    const brand = this.selectedBrand();
    const products = this.dataService.products();
    return this.dataService.productModels().filter(model =>
      products.some(p => p.category === cat && p.subCategory === sub && p.brand === brand && hasProductModel(p.model, model.name))
    );
  });

  // Filter logic based on hierarchy
  displayProducts = computed(() => {
    let list = this.dataService.products();
    if (this.selectedCategory() !== 'All') list = list.filter(p => p.category === this.selectedCategory());
    if (this.selectedSubCategory()) list = list.filter(p => p.subCategory === this.selectedSubCategory());
    if (this.selectedBrand()) list = list.filter(p => p.brand === this.selectedBrand());
    if (this.selectedModel()) list = list.filter(p => hasProductModel(p.model, this.selectedModel()));
    return list;
  });

  /** Phone shelves mount a page at a time so a big catalogue cannot freeze the browser. */
  readonly productPageSize = 24;
  private readonly productLimit = signal(this.productPageSize);

  readonly visibleProducts = computed(() =>
    this.displayProducts().slice(0, Math.max(this.productPageSize, this.productLimit())));
  readonly remainingProducts = computed(() =>
    Math.max(0, this.displayProducts().length - this.visibleProducts().length));

  showMoreProducts() {
    this.productLimit.update(limit => limit + this.productPageSize);
  }

  private resetProductLimit() {
    this.productLimit.set(this.productPageSize);
  }

  pickCategory(name: string) {
    this.rememberDrillPosition();
    this.selectedCategory.set(name);
    this.selectedSubCategory.set(null);
    this.selectedBrand.set(null);
    this.selectedModel.set(null);
    if (name === 'All') this.lastOpenedFolder.set(null);
    this.resetProductLimit();
    this.restoreDrillPosition();
  }

  pickSubCategory(name: string) {
    this.rememberDrillPosition();
    this.selectedSubCategory.set(name);
    this.selectedBrand.set(null);
    this.selectedModel.set(null);
    this.resetProductLimit();
    this.restoreDrillPosition();
  }

  pickBrand(name: string) {
    this.rememberDrillPosition();
    this.selectedBrand.set(name);
    this.selectedModel.set(null);
    this.resetProductLimit();
    this.restoreDrillPosition();
  }

  pickModel(name: string) {
    this.rememberDrillPosition();
    this.selectedModel.set(name);
    this.resetProductLimit();
    this.restoreDrillPosition();
  }

  searchEntries = computed(() => {
    const q = this.searchQuery()?.trim() || '';
    if (!q) return [];
    return searchProductEntries(this.dataService.products(), q).slice(0, 30);
  });

  /** A searched variant answers with its own code, stock and rates. */
  entryStock(hit: ProductSearchEntry): number {
    return Math.max(0, Number(hit.variant ? hit.variant.openingStock : hit.product.stock) || 0);
  }

  entryCode(hit: ProductSearchEntry): string {
    return hit.variant?.itemCode || hit.product.code;
  }

  entrySale(hit: ProductSearchEntry): number {
    return Number(hit.variant ? hit.variant.salesPrice : hit.product.salesPrice) || 0;
  }

  entryWholesale(hit: ProductSearchEntry): number {
    return Number(hit.variant ? hit.variant.wholesalePrice : hit.product.wholesalePrice) || 0;
  }

  entryWholesaleText(hit: ProductSearchEntry): string {
    const rate = this.entryWholesale(hit);
    return rate > 0 ? `${formatNumber(rate, 'en-US', '1.2-2')} TK` : '—';
  }

  variantLabelOf(v: ProductVariant): string {
    return variantLabel(v);
  }

  saleLineName(product: Product, variant?: ProductVariant): string {
    const value = (variant?.variantValue || variant?.variationName || '').trim();
    return value ? `${product.name} - ${value}` : product.name;
  }

  savedItemLabel(item: SaleItem): string {
    return saleItemDisplayName(item, this.dataService.products());
  }

  // ---------------- Customer picker ----------------

  openCustomerPicker() {
    this.customerQuery.set('');
    this.customerIndex.set(0);
    this.customerOpen.set(true);
  }

  onCustomerInput(event: Event) {
    this.customerQuery.set((event.target as HTMLInputElement).value);
    this.customerIndex.set(0);
    this.customerOpen.set(true);
  }

  onCustomerKeydown(event: KeyboardEvent) {
    const list = this.customerResults();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.customerOpen.set(true);
      this.customerIndex.set(Math.min(this.customerIndex() + 1, Math.max(0, list.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.customerIndex.set(Math.max(this.customerIndex() - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const picked = list[this.customerIndex()];
      if (picked) this.selectCustomer(picked);
      return;
    }
    if (event.key === 'Escape') {
      this.customerOpen.set(false);
      (event.target as HTMLInputElement).blur();
      return;
    }
    if (event.key === 'Tab') {
      this.customerOpen.set(false);
    }
  }

  selectCustomer(party: Party | null) {
    const wasDealer = this.dealerPricing();
    const name = party ? party.name : 'Walk In Customer';
    this.selectedPartyId.set(party?.id);
    this.selectedCustomerName.set(name);
    this.posForm.patchValue({ customer: name });
    this.customerOpen.set(false);
    this.customerQuery.set('');
    this.customerIndex.set(0);
    const isDealer = this.dealerPricing();
    if (isDealer !== wasDealer) this.repriceCart(isDealer);
  }

  /** Dealer lines follow wholesalePrice while they still carry the previous default price. */
  private repriceCart(dealer: boolean) {
    for (const ctrl of this.cartArray.controls) {
      const product = ctrl.value.product as Product;
      const variant = ctrl.value.variant as ProductVariant | null;
      const retail = variant?.salesPrice ?? product.salesPrice;
      const wholesale = variant?.wholesalePrice ?? product.wholesalePrice;
      const previous = dealer ? retail : (Number(wholesale) > 0 ? Number(wholesale) : retail);
      const next = dealer && Number(wholesale) > 0 ? Number(wholesale) : retail;
      if (Math.abs((Number(ctrl.value.price) || 0) - previous) < 0.005) {
        ctrl.patchValue({ price: next });
      }
    }
    this.updateGrandTotal();
  }

  clearCustomer() {
    this.selectCustomer(null);
  }

  openNewCustomer() {
    this.customerOpen.set(false);
    this.customerError.set('');
    this.customerPhoto.set('');
    this.customerDoc.set('');
    this.customerDivision = '';
    this.customerDistrict = '';
    this.customerUpazila = '';
    this.customerAddress = '';
    this.customerForm.reset({ name: '', phone: '', type: 'Customer' });
    this.isCustomerModalOpen.set(true);
  }

  async onCustomerPhoto(e: Event) {
    const picked = await this.media.pick(e, 'parties', this.customerForm.getRawValue().name || 'party');
    if (!picked.ok) {
      if (picked.error) this.notify.error(picked.error, this.prefs.txt('ছবি', 'Image'));
      return;
    }
    this.customerPhoto.set(picked.image.ref);
    if (picked.image.note) this.notify.warning(picked.image.note, 'Cloudinary');
  }

  async onCustomerDoc(e: Event) {
    const picked = await this.media.pick(e, 'parties', (this.customerForm.getRawValue().name || 'party') + '-voter');
    if (!picked.ok) {
      if (picked.error) this.notify.error(picked.error, this.prefs.txt('ডকুমেন্ট', 'Document'));
      return;
    }
    this.customerDoc.set(picked.image.ref);
    if (picked.image.note) this.notify.warning(picked.image.note, 'Cloudinary');
  }

  saveNewCustomer() {
    const raw = this.customerForm.getRawValue();
    const name = (raw.name || '').trim();
    if (!name) {
      this.customerError.set(this.prefs.t('pos.nameRequired'));
      return;
    }
    const duplicate = this.dataService.parties().some(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      this.customerError.set(this.prefs.t('pos.duplicateCustomer'));
      return;
    }
    const phoneOwner = this.dataService.partyByPhone(raw.phone);
    if (phoneOwner) {
      this.customerError.set(this.prefs.txt(
        `এই মোবাইল নাম্বারেই “${phoneOwner.name}” পার্টি আছে। এক নাম্বারে দুটি পার্টি আইডি চলবে না।`,
        `This mobile number already belongs to “${phoneOwner.name}”. One number cannot have two party IDs.`
      ));
      return;
    }

    this.savingCustomer.set(true);
    try {
      const created = this.dataService.addParty({
        name,
        companyName: 'N/A',
        type: (raw.type || 'Customer') as Party['type'],
        roles: [(raw.type || 'Customer') as Party['type']],
        total: 0,
        paid: 0,
        due: 0,
        status: 'Enabled',
        inHand: '0 Pcs',
        zone: this.customerDistrict || '-',
        email: '-',
        phone: (raw.phone || '').trim() || undefined,
        createdAt: localDateIso(),
        address: [this.customerAddress, this.customerUpazila, this.customerDistrict, this.customerDivision].filter(Boolean).join(', ') || 'Khulna',
        addressText: this.customerAddress.trim() || undefined,
        division: this.customerDivision || undefined,
        district: this.customerDistrict || undefined,
        upazila: this.customerUpazila || undefined,
        thana: this.customerUpazila || undefined,
        documents: this.customerDoc() || '-',
        profileImage: this.customerPhoto() || undefined,
        nextPayment: '-'
      });

      this.selectCustomer(created);
      this.session.log('Customer Added', `${name} — POS`);
      this.isCustomerModalOpen.set(false);
    } finally {
      this.savingCustomer.set(false);
    }
  }

  // ---------------- Cart ----------------

  unitChoicesFor(product: Product | null | undefined) {
    return productUnitChoices(product);
  }

  /** "১ ডজন = ১২ পিস" (or "১ প্যাকেট = ১৫ পিস") for extra-unit lines; empty for base-unit lines. */
  lineUnitNote(item: any): string {
    const base = item?.product?.unit || 'pcs';
    const unit = item?.unit || base;
    const factor = this.lineFactor({ value: item });
    if (unit === base || !(factor > 0) || factor === 1) return '';
    if (factor > 1) return `১ ${unit} = ${factor} ${base}`;
    return `১ ${base} = ${Math.round((1 / factor) * 1000) / 1000} ${unit}`;
  }

  /** The line's quantity converted back to the product's base unit. */
  lineBaseQty(item: any): number {
    return this.round2((Number(item?.quantity) || 0) * this.lineFactor({ value: item }));
  }

  /** Stock of the cart line's product/variant, counted in its base unit. */
  private lineStock(product: Product | undefined, variant: ProductVariant | undefined): number | null {
    if (!product || product.type === 'service') return null;
    return Math.max(0, Number(variant ? variant.openingStock : product.stock) || 0);
  }

  private lineFactor(control: { value: { unit?: string; unitFactor?: number; product?: Product } }): number {
    const factor = Number(control.value.unitFactor);
    if (factor > 0) return factor;
    return unitFactorOf(control.value.product, control.value.unit);
  }

  /** Base-unit stock already reserved by the cart's other lines of the same product/variant. */
  private reservedElsewhere(control: { value: any }): number {
    const { product, variant } = control.value;
    const variantId = variant?.id ?? null;
    const index = this.cartArray.controls.indexOf(control as any);
    return this.cartArray.controls.reduce((sum, line, i) =>
      i !== index
      && line.value.product?.id === product?.id
      && (line.value.variant?.id ?? null) === variantId
        ? sum + (Number(line.value.quantity) || 0) * this.lineFactor(line)
        : sum, 0);
  }

  /** Base-unit stock this line may still take, after sibling lines of the same product. */
  private lineStockLeft(control: { value: any }): number | null {
    const { product, variant } = control.value;
    const stock = this.lineStock(product, variant);
    if (stock == null) return null;
    return Math.max(0, stock - this.reservedElsewhere(control));
  }

  /** Whole units of the line's chosen unit the unreserved stock can cover. */
  maxLineQty(control: { value: any }): number | null {
    const left = this.lineStockLeft(control);
    if (left == null) return null;
    return Math.floor(left / this.lineFactor(control) + 1e-9);
  }

  onCartUnitChange(index: number, unitName?: string) {
    const control = this.cartArray.at(index);
    const product = control?.value.product;
    if (!control || !product) return;
    // Price from the newly picked unit's own rate, even before the control's
    // value has settled, so a ডজন line never keeps the পিস rate.
    const choice = unitChoiceOf(product, unitName ?? control.value.unit);
    const price = this.dealerPricing() && choice.wholesalePrice > 0 ? choice.wholesalePrice : choice.price;
    const factor = choice.factor;
    const left = this.lineStockLeft(control);
    const maxUnits = left == null ? Infinity : Math.floor(left / factor + 1e-9);
    // Switching to a bigger unit (পিস → ডজন) can outgrow the remaining stock.
    const qty = Math.min(Math.max(1, Number(control.value.quantity) || 1), Math.max(1, maxUnits));
    control.patchValue({ unit: choice.name, unitFactor: factor, price, quantity: qty });
    this.updateGrandTotal();
  }

  addToCart(product: Product, variant?: ProductVariant) {
    const variantId = variant?.id ?? null;
    const unit = product.unit || 'pcs';
    const unitFactor = unitFactorOf(product, unit);
    const retail = variant?.salesPrice ?? product.salesPrice;
    const wholesale = variant?.wholesalePrice ?? product.wholesalePrice;
    const price = this.dealerPricing() && Number(wholesale) > 0 ? Number(wholesale) : retail;
    const items = this.cartArray.controls;
    // One line per selling unit: a পিস line and a ডজন line of the same product
    // keep their own unit price and quantity instead of merging.
    const existing = items.find(i =>
      i.value.product.id === product.id
      && (i.value.variant?.id ?? null) === variantId
      && (i.value.unit || product.unit) === unit
      && Number(i.value.price) === price);

    if (product.type !== 'service') {
      const stock = Math.max(0, Number(variant ? variant.openingStock : product.stock) || 0);
      const name = variant ? product.name + ' - ' + variantLabel(variant) : product.name;
      if (stock <= 0) {
        this.notify.warning(this.prefs.txt(`${name} স্টকে নেই — বিক্রি করা যাবে না।`, `${name} is out of stock — cannot sell.`), this.prefs.txt('স্টক শেষ', 'Out of stock'));
        return;
      }
      if (existing) {
        const max = this.maxLineQty(existing);
        if (max != null && (Number(existing.value.quantity) || 0) + 1 > max) {
          this.notify.warning(this.prefs.txt(`${name}: স্টকে মাত্র ${stock} ${unit} আছে।`, `${name}: only ${stock} ${unit} in stock.`), this.prefs.txt('স্টক সীমা', 'Stock limit'));
          return;
        }
      } else {
        // Stock is counted in the base unit, so lines sold in কেজি must convert.
        const inCart = items.reduce((sum, c) =>
          c.value.product?.id === product.id && (c.value.variant?.id ?? null) === variantId
            ? sum + (Number(c.value.quantity) || 0) * this.lineFactor(c) : sum, 0);
        if (inCart + 1 > stock) {
          this.notify.warning(this.prefs.txt(`${name}: স্টকে মাত্র ${stock} ${unit} আছে।`, `${name}: only ${stock} ${unit} in stock.`), this.prefs.txt('স্টক সীমা', 'Stock limit'));
          return;
        }
      }
    }

    if (existing) {
      existing.patchValue({ quantity: existing.value.quantity + 1 });
    } else {
      // Newest line sits on top of the cart so the cashier sees it at once;
      // the saved invoice restores the order the items were added in.
      this.cartArray.insert(0, this.fb.group({
        product: [product],
        variant: [variant ?? null],
        unit: [unit],
        unitFactor: [unitFactor],
        quantity: [1],
        price: [price],
        discount: [0],
        discountType: ['fixed']
      }));
    }
    this.updateGrandTotal();
  }

  addFirstSearchResult() {
    const hit = this.resolveScanHit((this.searchQuery() || '').trim().toLowerCase());
    if (!hit) return;
    this.addToCart(hit.product, hit.variant);
    this.searchControl.setValue('');
  }

  /** Camera scan: strict code match only, never a fuzzy first hit. */
  onCameraScan(raw: string) {
    const hit = findScanMatch(this.dataService.products(), raw);
    if (!hit) {
      this.notify.warning(
        this.prefs.txt(`স্ক্যান করা কোডের সাথে কোনো পণ্য মেলেনি: "${raw}"`, `No product matches the scanned code: "${raw}"`),
        this.prefs.txt('পণ্য পাওয়া যায়নি', 'Product not found')
      );
      return;
    }
    this.addToCart(hit.product, hit.variant);
    const label = hit.variant ? `${hit.product.name} - ${variantLabel(hit.variant)}` : hit.product.name;
    this.notify.success(
      this.prefs.txt(`${label} কার্টে যোগ হয়েছে।`, `${label} added to cart.`),
      this.prefs.txt('যোগ হয়েছে', 'Added')
    );
  }

  /** One typed/scanned code must land on the cheapest ambiguity: variant item code first, product last. */
  private resolveScanHit(query: string): { product: Product; variant?: ProductVariant } | null {
    if (!query) return null;
    const products = this.dataService.products();

    for (const product of products) {
      const variant = (product.variants || []).find(v =>
        String(v.itemCode ?? '').trim().toLowerCase() === query ||
        `${product.name} - ${v.variantValue}`.trim().toLowerCase() === query);
      if (variant) return { product, variant };
    }

    const parent = products.find(p =>
      String(p.code ?? '').trim().toLowerCase() === query ||
      p.name.trim().toLowerCase() === query);
    if (parent) return { product: parent };

    const first = this.searchEntries()[0];
    if (!first) return null;
    return { product: first.product, variant: first.variant };
  }

  bumpQty(index: number, delta: number) {
    const control = this.cartArray.at(index);
    if (!control) return;
    const quantity = Math.max(1, (Number(control.value.quantity) || 0) + delta);
    const product = control.value.product;
    const variant = control.value.variant;
    if (delta > 0 && product?.type !== 'service') {
      const stock = Math.max(0, Number(variant ? variant.openingStock : product?.stock) || 0);
      const max = this.maxLineQty(control);
      if (max != null && quantity > max) {
        this.notify.warning(this.prefs.txt(`${variant ? product.name + ' - ' + variantLabel(variant) : product.name}: স্টকে মাত্র ${stock} ${product.unit || 'pcs'} আছে।`, `${variant ? product.name + ' - ' + variantLabel(variant) : product.name}: only ${stock} ${product.unit || 'pcs'} in stock.`), this.prefs.txt('স্টক সীমা', 'Stock limit'));
        return;
      }
    }
    control.patchValue({ quantity });
    this.updateGrandTotal();
  }

  /** Direct typing in the qty box clamps to the stock on hand. */
  onQtyInput(index: number, event: Event) {
    const control = this.cartArray.at(index);
    if (!control) return;
    const product = control.value.product;
    const variant = control.value.variant;
    let quantity = Math.floor(Number((event.target as HTMLInputElement).value) || 0);
    if (quantity < 1) quantity = 1;
    if (product?.type !== 'service') {
      const stock = Math.max(0, Number(variant ? variant.openingStock : product?.stock) || 0);
      const max = this.maxLineQty(control);
      if (max != null && quantity > max) {
        quantity = Math.max(1, max);
        this.notify.warning(this.prefs.txt(`${variant ? product.name + ' - ' + variantLabel(variant) : product.name}: স্টকে মাত্র ${stock} ${product.unit || 'pcs'} আছে।`, `${variant ? product.name + ' - ' + variantLabel(variant) : product.name}: only ${stock} ${product.unit || 'pcs'} in stock.`), this.prefs.txt('স্টক সীমা', 'Stock limit'));
      }
    }
    control.patchValue({ quantity });
    this.updateGrandTotal();
  }

  removeItem(index: number) {
    this.cartArray.removeAt(index);
    this.updateGrandTotal();
  }

  updateGrandTotal() {
    const values = this.posForm.getRawValue();
    const items = values.cart || [];
    const subtotal = items.reduce((acc: number, i: any) => acc + this.calculateItemSubtotal(i), 0);
    const discountValue = Math.max(0, Number(values.discountAmount) || 0);
    const discount = Math.min(
      values.discountType === 'percent' ? subtotal * discountValue / 100 : discountValue,
      subtotal
    );
    const tax = subtotal * ((values.orderTax || 0) / 100);
    const calculatedTotal = subtotal + tax - discount
      + (values.shippingAmount || 0)
      + (values.warrantyTransport || 0)
      + (values.damageAmount || 0);

    const currentControlValue = this.posForm.get('grandTotal')?.value;

    // Only patch if the difference is significant to avoid fighting manual edits
    // and ensure decimal precision
    if (Math.abs((currentControlValue || 0) - calculatedTotal) > 0.001) {
        this.posForm.patchValue({
            grandTotal: parseFloat(calculatedTotal.toFixed(2))
        }, { emitEvent: false });
    }
  }

  resetCart() {
    this.cartArray.clear();
    this.posForm.patchValue({
      discountAmount: 0,
      discountType: 'fixed',
      shippingAmount: 0,
      warrantyTransport: 0,
      damageAmount: 0,
      orderTax: 0,
      grandTotal: 0
    });
    this.cashInput.set('');
    this.bankInput.set('');
    this.paymentNotes.set('');
    this.paymentError.set('');
    this.searchControl.setValue('');
    this.resetVoucherCredits();
  }

  // ---------------- Payment ----------------

  checkout() {
    if (!this.cartArray.length && !this.hasWarrantyClaim()) return;
    this.cashInput.set(String(this.netPayable()));
    this.autoTender = String(this.netPayable());
    this.bankInput.set('');
    this.paymentNotes.set('');
    this.paymentMethod.set('Cash');
    this.paymentError.set('');
    this.isPayModalOpen.set(true);
  }

  setMethod(method: PosPaymentMethod) {
    this.paymentMethod.set(method);
    this.paymentError.set('');
    if (method === 'Cash') {
      this.cashInput.set(String(this.netPayable()));
      this.bankInput.set('');
    } else {
      this.bankInput.set(String(this.netPayable()));
      this.cashInput.set('');
    }
    this.autoTender = String(this.netPayable());
  }

  setTender(value: number | 'exact') {
    this.cashInput.set(String(value === 'exact' ? this.netPayable() : value));
    this.autoTender = value === 'exact' ? String(this.netPayable()) : null;
    this.paymentError.set('');
  }

  onCashInput(event: Event) {
    this.cashInput.set((event.target as HTMLInputElement).value);
    this.autoTender = null;
    this.paymentError.set('');
  }

  onBankInput(event: Event) {
    this.bankInput.set((event.target as HTMLInputElement).value);
    this.autoTender = null;
    this.paymentError.set('');
  }

  /** Trade-in credits change what is due, so an auto-filled tender follows them. */
  private syncTender() {
    if (this.autoTender === null) return;
    const net = String(this.netPayable());
    if (this.cashInput() === this.autoTender) this.cashInput.set(net);
    else if (this.bankInput() === this.autoTender) this.bankInput.set(net);
    this.autoTender = net;
  }

  onPayNotes(event: Event) {
    this.paymentNotes.set((event.target as HTMLInputElement).value);
  }

  setPayDiscountType(type: 'fixed' | 'percent') {
    this.posForm.patchValue({ discountType: type });
    this.paymentError.set('');
  }

  methodIcon(method: PosPaymentMethod): string {
    switch (method) {
      case 'Cash': return 'payments';
      case 'Card': return 'credit_card';
      default: return 'phone_android';
    }
  }

  methodLabel(method: PosPaymentMethod): string {
    if (method === 'Cash') return this.prefs.t('pos.cash');
    if (method === 'Card') return this.prefs.t('pos.card');
    return method;
  }

  // ---------------- Voucher credits (old battery / returns / warranty) ----------------

  batteryKindLabel(kind: BatteryKind): string {
    return this.prefs.language() === 'en' ? kind.en : kind.bn;
  }

  toggleBattery(event: Event) {
    const on = (event.target as HTMLInputElement).checked;
    this.batteryEnabled.set(on);
    if (on && !this.batteryAdjustments().length) this.addBatteryRow();
    this.syncTender();
  }

  addBatteryRow() {
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
    this.syncTender();
  }

  onBatteryKind(index: number, event: Event) {
    const kindKey = (event.target as HTMLSelectElement).value;
    const kind = BATTERY_KINDS.find(k => k.key === kindKey) || BATTERY_KINDS[0];
    this.batteryAdjustments.update(items => items.map((item, i) => i === index ? {
      ...item,
      kindKey: kind.key,
      description: this.batteryKindLabel(kind),
      unit: kind.unit === 'either' ? (item.unit || 'kg') : kind.unit
    } : item));
  }

  onBatteryUnit(index: number, event: Event) {
    const unit = (event.target as HTMLSelectElement).value as BatteryUnit;
    this.batteryAdjustments.update(items =>
      items.map((item, i) => i === index ? { ...item, unit } : item));
  }

  removeBatteryRow(index: number) {
    this.batteryAdjustments.update(items => items.filter((_, i) => i !== index));
    this.syncTender();
  }

  updateBatteryWeight(index: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const unit = this.batteryAdjustments()[index]?.unit || 'kg';
    const value = roundQty(Number(input.value) || 0, unit);
    if (unit === 'pcs' && input.value !== String(value)) input.value = String(value);
    this.batteryAdjustments.update(items => items.map((item, i) =>
      i === index ? { ...item, weightKg: value, total: this.round2(value * item.ratePerKg) } : item));
    this.syncTender();
  }

  normalizeBatteryWeight(index: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const row = this.batteryAdjustments()[index];
    input.value = formatQtyInput(row?.weightKg ?? 0, row?.unit || 'kg');
  }

  updateBatteryRate(index: number, event: Event) {
    const value = Number((event.target as HTMLInputElement).value) || 0;
    this.batteryAdjustments.update(items => items.map((item, i) =>
      i === index ? { ...item, ratePerKg: value, total: this.round2(item.weightKg * value) } : item));
    this.syncTender();
  }

  toggleReturns(event: Event) {
    this.returnsEnabled.set((event.target as HTMLInputElement).checked);
    this.syncTender();
  }

  returnInvoiceMatches = computed<Sale[]>(() => {
    const query = this.returnSearchQuery().trim().toLowerCase();
    if (!query) return [];
    return this.dataService.sales()
      .filter(s => (s.invoice || '').toLowerCase().includes(query))
      .slice(0, 3);
  });

  returnProductMatches = computed<ProductSearchEntry[]>(() => {
    const query = this.returnSearchQuery().trim();
    if (!query) return [];
    return searchProductEntries(this.dataService.products(), query).slice(0, 8);
  });

  onReturnSearch(event: Event) {
    this.returnSearchQuery.set((event.target as HTMLInputElement).value);
    this.returnSearchOpen.set(true);
  }

  clearReturnSearch() {
    this.returnSearchQuery.set('');
    this.returnSearchOpen.set(false);
  }

  returnFromProduct(product: Product, variant?: ProductVariant) {
    const variantName = variant ? variantLabel(variant) : '';
    this.addReturnRow(variantName ? `${product.name} - ${variantName}` : product.name,
      variant?.salesPrice ?? product.salesPrice, product.unit || 'pcs');
  }

  returnFromInvoiceItem(sale: Sale, item: SaleItem) {
    this.addReturnRow(`${this.savedItemLabel(item)} / ${sale.invoice}`, item.salesPrice, item.unit || 'pcs');
  }

  private addReturnRow(itemName: string, rate: number, unit: string) {
    const safeRate = this.round2(rate);
    this.returnRows.update(items => [
      ...items,
      { id: this.dataService.newId(), item: itemName, qty: `1 ${unit}`, rate: safeRate, amount: safeRate }
    ]);
    this.clearReturnSearch();
    this.syncTender();
  }

  removeReturnRow(index: number) {
    this.returnRows.update(items => items.filter((_, i) => i !== index));
    this.syncTender();
  }

  updateReturnItem(index: number, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.returnRows.update(items => items.map((item, i) => i === index ? { ...item, item: value } : item));
  }

  updateReturnQty(index: number, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const qty = parseFloat(value) || 0;
    this.returnRows.update(items => items.map((item, i) =>
      i === index ? { ...item, qty: value, amount: this.round2(qty * item.rate) } : item));
    this.syncTender();
  }

  updateReturnRate(index: number, event: Event) {
    const value = Number((event.target as HTMLInputElement).value) || 0;
    this.returnRows.update(items => items.map((item, i) => {
      if (i !== index) return item;
      return { ...item, rate: value, amount: this.round2((parseFloat(item.qty) || 0) * value) };
    }));
    this.syncTender();
  }

  toggleWarranty(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked;
    this.hasWarrantyClaim.set(enabled);
    if (!enabled) return;
    if (!(this.warranty.claimNo || '').trim()) {
      this.warranty.claimNo = this.dataService.peekWarrantyReceiptNo();
    }
    if (!this.warranty.receiveDate) this.warranty.receiveDate = localDateIso();
    if (!this.warranty.quantity) this.warranty.quantity = '1';
  }

  readonly warrantyInvoiceOptions = computed(() => this.dataService.sales()
    .filter(s => s.status !== 'Cancelled' && !!(s.invoice || '').trim())
    .map(s => s.invoice).slice(0, 300));

  readonly warrantyBatteryOpen = signal(false);
  readonly warrantyBatteryQuery = signal('');
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
  readonly warrantyBatteryFiltered = computed(() => {
    const all = this.warrantyBatteryOptions();
    const query = this.warrantyBatteryQuery().trim().toLowerCase();
    if (!query || all.some(p => p.name.toLowerCase() === query)) return all;
    return all.filter(p => p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query));
  });

  warrantyMatchedProduct() {
    const name = (this.warranty.battery || '').trim().toLowerCase();
    return name ? this.dataService.products().find(p => (p.name || '').trim().toLowerCase() === name) : undefined;
  }

  warrantyUnit(): string {
    return this.warrantyMatchedProduct()?.unit || 'pcs';
  }

  onWarrantyBatteryInput(name: string) {
    this.warranty.battery = name || '';
    this.warrantyBatteryQuery.set(name || '');
    const product = this.warrantyMatchedProduct();
    this.warranty.productId = product?.id;
    this.warranty.warrantyDays = product?.warrantyDays ? Math.round(product.warrantyDays) : undefined;
    if (!(Number(this.warranty.quantity) > 0)) this.warranty.quantity = '1';
  }

  pickWarrantyBattery(name: string) {
    this.onWarrantyBatteryInput(name);
    this.warrantyBatteryOpen.set(false);
  }

  checkoutWarranty() {
    this.hasWarrantyClaim.set(true);
    if (!(this.warranty.claimNo || '').trim()) this.warranty.claimNo = this.dataService.peekWarrantyReceiptNo();
    if (!this.warranty.receiveDate) this.warranty.receiveDate = localDateIso();
    if (!(Number(this.warranty.quantity) > 0)) this.warranty.quantity = '1';
    this.checkout();
  }

  warrantyStatusLabel(status: string): string {
    if (isWarrantyCompleted(status)) return this.prefs.txt('পরিবর্তন সম্পন্ন', 'Replaced');
    if ((status || '').trim() === 'বাতিল') return this.prefs.txt('বাতিল', 'Cancelled');
    return this.prefs.txt('প্রক্রিয়াধীন', 'In progress');
  }

  private warrantyClaimError(): string {
    if (!(this.warranty.battery || '').trim()) {
      return this.prefs.txt('ওয়ারেন্টি ব্যাটারির নাম / মডেল দিন।', 'Enter the warranty battery name / model.');
    }
    return '';
  }

  private resetVoucherCredits() {
    this.batteryEnabled.set(false);
    this.batteryAdjustments.set([]);
    this.returnsEnabled.set(false);
    this.returnRows.set([]);
    this.returnSearchQuery.set('');
    this.returnSearchOpen.set(false);
    this.hasWarrantyClaim.set(false);
    this.warrantyBatteryOpen.set(false);
    this.warrantyBatteryQuery.set('');
    this.warranty = this.emptyWarrantyClaim();
  }

  confirmPayment() {
    try { this.performPayment(); }
    catch (error) { this.paymentError.set(error instanceof Error ? error.message : 'Sale rejected.'); }
  }

  private performPayment() {
    // The cart shows newest-first; the invoice and receipt keep the order the
    // items were added in.
    const cart = [...this.cartItems].reverse();
    if (!cart.length && !this.hasWarrantyClaim()) return;

    if (this.hasWarrantyClaim()) {
      if (!(this.warranty.claimNo || '').trim()) {
        this.warranty.claimNo = this.dataService.peekWarrantyReceiptNo();
      }
      const claimError = this.warrantyClaimError();
      if (claimError) {
        this.paymentError.set(claimError);
        return;
      }
    }

    const stockOf = (item: any) => Math.max(0, Number(item.variant ? item.variant.openingStock : item.product?.stock) || 0);
    const lineBaseQty = (item: any) => (Number(item.quantity) || 0) * (Number(item.unitFactor) > 0 ? Number(item.unitFactor) : 1);
    const overStock = cart.find((item: any) =>
      item.product?.type !== 'service'
      && lineBaseQty(item) > stockOf(item));
    if (overStock) {
      const stock = stockOf(overStock);
      this.paymentError.set(this.prefs.txt(`${overStock.variant ? (overStock.product.name + ' - ' + variantLabel(overStock.variant)) : overStock.product.name}: স্টকে মাত্র ${stock} ${overStock.product.unit || 'pcs'} আছে — এর বেশি বিক্রি করা যাবে না।`, `${overStock.variant ? (overStock.product.name + ' - ' + variantLabel(overStock.variant)) : overStock.product.name}: only ${stock} ${overStock.product.unit || 'pcs'} in stock — cannot sell more than that.`));
      return;
    }

    const batteryRows = this.batteryEnabled()
      ? this.batteryAdjustments().filter(b => (Number(b.total) || 0) > 0)
      : [];
    const batteryTotal = this.round2(batteryRows.reduce((acc, b) => acc + (Number(b.total) || 0), 0));
    const returnCredits = this.returnsEnabled()
      ? this.returnRows().filter(r => (r.item || '').trim() !== '' || (Number(r.amount) || 0) > 0)
      : [];
    const returnedTotal = this.round2(returnCredits.reduce((acc, r) => acc + (Number(r.amount) || 0), 0));

    const paid = this.paidNow();
    const total = this.payTotal();
    const due = Math.max(0, this.round2(total - paid - batteryTotal - returnedTotal));
    const method = this.paymentMethod();
    const customerName = this.selectedCustomerName();
    const party = this.selectedParty();

    if (customerName === 'Walk In Customer' && this.remainingDue() > 0) {
      this.paymentError.set(this.prefs.t('pos.walkInDue'));
      return;
    }

    const saleItems: SaleItem[] = cart.map((item: any, idx: number) => ({
      id: idx + 1,
      productId: item.product.id,
      variantId: item.variant?.id,
      productName: this.saleLineName(item.product, item.variant),
      quantity: item.quantity,
      unit: item.unit || item.product.unit,
      unitFactor: Number(item.unitFactor) > 0 ? Number(item.unitFactor) : unitFactorOf(item.product, item.unit),
      salesPrice: item.price,
      originalPrice: item.product.salesPrice,
      discount: item.discount,
      discountType: item.discountType,
      total: this.round2(this.calculateItemSubtotal(item))
    }));

    const invoiceNum = this.buildNextInvoice();
    if (this.hasWarrantyClaim() && !(this.warranty.originalInvoice || '').trim()) {
      this.warranty.originalInvoice = invoiceNum;
    }
    const date = localDateIso();
    const taxRate = Math.max(0, Number(this.posForm.value.orderTax) || 0);
    const tax = this.taxAmount();
    const orderDiscount = Math.max(0, Number(this.posForm.value.discountAmount) || 0);
    const orderDiscountType = this.payDiscountType();
    const subtotal = this.itemsNet();
    const rawSubtotal = this.round2(cart.reduce((acc: number, i: any) =>
      acc + (Number(i.quantity) || 0) * (Number(i.price) || 0), 0));
    const lineDiscount = Math.max(0, this.round2(rawSubtotal - subtotal));
    const shipping = this.transportLabour();
    const warrantyTransport = this.warrantyTransport();
    const damage = this.damageAmount();
    const cash = this.cashPaid();
    const bank = this.bankPaid();
    const memoNote = this.paymentNotes().trim();
    const notes = [
      memoNote,
      `POS Checkout • ${this.methodLabel(method)} • Tax: ${taxRate}% | Transport: ${shipping} | Warranty: ${warrantyTransport} | Damage: ${damage}`,
      batteryTotal > 0 ? `Old Battery: ${batteryTotal}` : '',
      returnedTotal > 0 ? `Returned: ${returnedTotal}` : ''
    ].filter(Boolean).join(' • ');
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const cashier = this.session.currentUser()?.name || 'Admin';

    const savedSale = this.dataService.addSale({
      invoice: invoiceNum,
      warehouse: this.dataService.warehouses()[0] ?? 'SM Warehouse',
      date,
      customerName,
      partyId: party?.id,
      shopName: party?.companyName && !['N/A', '-'].includes(party.companyName.trim()) ? party.companyName.trim() : undefined,
      mobile: (party?.phone || '').trim() || undefined,
      address: party?.address && party.address !== '-' ? party.address : undefined,
      preparedBy: cashier,
      status: this.posForm.value.status as any,
      total,
      paid,
      due,
      previousDue: this.previousDueAmount(),
      paymentStatus: due <= 0 ? 'Paid' : (paid > 0 ? 'Partially Paid' : 'Unpaid'),
      nextPayDate: '-',
      notes,
      memoNote: memoNote || undefined,
      subtotal,
      discount: lineDiscount,
      discountType: 'fixed',
      orderDiscount,
      orderDiscountType,
      shipping,
      warrantyTransport,
      taxAmount: tax,
      damageAmount: damage,
      cashReceived: cash,
      bankPayment: bank,
      paymentMode: cash > 0 && bank > 0 ? 'Mixed' : (cash > 0 ? 'Cash' : method),
      items: saleItems,
      returns: this.returnsEnabled() ? returnCredits : undefined,
      warranty: this.hasWarrantyClaim() ? this.warranty : undefined,
      batteryAdjustments: batteryRows.length ? batteryRows : undefined,
      batteryAdjustmentTotal: batteryTotal
    });

    // Another device may have taken the peeked number first; the saved bill is the truth.
    const finalInvoice = savedSale.invoice || invoiceNum;
    this.session.log('POS Sale', `${finalInvoice} — ${customerName} — ${total.toFixed(2)} TK (${method})`);

    const qrSettings = this.settings();
    const textQr = qrSettings.qrMode === 'text';
    const qrUrl = qrSettings.showPosQrCode && (textQr ? !!savedSale.invoice : !!savedSale.shareKey)
      ? qrDataUrl(
          textQr
            ? saleQrText(savedSale, qrSettings)
            : `${window.location.origin}/v/sale/${encodeURIComponent(savedSale.shareKey as string)}`,
          240,
          textQr ? 'L' : 'M'
        )
      : '';

    this.receipt.set({
      invoice: finalInvoice,
      date: this.formatDate(date),
      time,
      customer: customerName === 'Walk In Customer' ? this.prefs.t('pos.walkIn') : customerName,
      phone: this.selectedParty()?.phone || '',
      cashier,
      method: cash > 0 && bank > 0 ? 'Mixed' : this.methodLabel(method),
      items: saleItems,
      subtotal,
      tax,
      discount: this.orderDiscountAmount(),
      shipping,
      warrantyTransport,
      damage,
      previousDue: this.previousDueAmount(),
      batteryCredit: batteryTotal,
      returnsCredit: returnedTotal,
      total,
      paid,
      change: this.changeDue(),
      due,
      qrUrl,
      notes: memoNote || undefined,
      warranty: savedSale.warranty ? { ...savedSale.warranty } : undefined
    });

    this.isPayModalOpen.set(false);
    this.resetCart();
  }

  closeReceipt() {
    this.receipt.set(null);
    this.mobileTab.set('products');
    setTimeout(() => this.searchInput()?.nativeElement.focus(), 50);
  }

  /** An unfinished cart or voucher credit rows count as unsaved work in POS. */
  hasUnsavedWork(): boolean {
    return this.cartArray.length > 0
      || this.batteryAdjustments().length > 0
      || this.returnRows().length > 0
      || this.hasWarrantyClaim();
  }

  async confirmLeave(): Promise<boolean> {
    if (!this.hasUnsavedWork()) return true;
    return this.notify.confirm(
      this.prefs.txt('এই বিক্রয়ের কার্টে পণ্য আছে কিন্তু বিল সম্পন্ন হয়নি। বের হলে কার্টের সব পণ্য মুছে যাবে।', 'The cart has items but the bill is not completed. Leaving will clear the cart.'),
      {
        title: this.prefs.txt('POS ছেড়ে যাবেন?', 'Leave POS?'),
        kind: 'warning',
        confirmText: this.prefs.txt('হ্যাঁ, বের হন', 'Yes, leave'),
        cancelText: this.prefs.txt('এখানে থাকুন', 'Stay here')
      }
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (!this.hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  receiptShareText(r: PosReceipt): string {
    const lines = [
      `${this.settings().businessNamePart1} ${this.settings().businessNamePart2}`.trim(),
      `${this.prefs.txt('ইনভয়েস', 'Invoice')}: ${r.invoice}`,
      `${this.prefs.txt('মোট', 'Total')}: ${r.total.toFixed(2)} TK`,
    ];
    if (r.due > 0) lines.push(`${this.prefs.txt('বাকি', 'Due')}: ${r.due.toFixed(2)} TK`);
    return lines.join('\n');
  }

  /** "= 24 পিস" under a receipt line sold in an extra unit (২ ডজন). */
  receiptLineNote(item: SaleItem): string {
    const factor = Number(item.unitFactor) || 1;
    if (factor <= 1) return '';
    const product = this.dataService.products().find(p =>
      item.productId != null ? p.id === item.productId : p.name === item.productName);
    const quantity = this.round2((Number(item.quantity) || 0) * factor);
    return product?.unit ? `= ${quantity} ${product.unit}` : `= ${quantity}`;
  }

  /**
   * Prints the slip alone at the top of an A4 sheet (210×297mm) for a laser
   * printer such as the Canon LBP 6030. A long bill continues onto further
   * sheets with the shop header repeated instead of shrinking to fit one page.
   */
  printReceipt() {
    printPosReceipt(document.getElementById('receipt-print-area'));
  }

  // ---------------- Helpers ----------------

  private buildNextInvoice(): string {
    return this.dataService.peekSaleVoucherNo();
  }

  private formatDate(value: string): string {
    if (!value) return '-';
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!iso) return value;
    return `${iso[3]}-${iso[2]}-${iso[1]}`;
  }

  private round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
