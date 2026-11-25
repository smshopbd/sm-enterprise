import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, Purchase, PurchaseItem } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { localizeAddress } from '../../utils/bd-geo';
import { VoucherSettingsModal } from '../voucher-settings-modal/voucher-settings-modal';
import {
  VOUCHER_LAYOUT_OPTIONS,
  VoucherLayoutPreset,
  VoucherPrintTarget,
  downloadVoucherHtml,
  downloadVoucherJpg,
  downloadVoucherPdf,
  downloadVoucherPng,
  layoutPresetOf,
  presetSettings,
  printVoucherSheet,
  resolveVoucherSheet,
} from '../../utils/voucher-print';

@Component({
  selector: 'app-purchase-voucher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, VoucherSettingsModal],
  styles: [`
    @font-face {
      font-family: 'Bangla Voucher';
      src: url('/assets/fonts/bangla.ttf') format('truetype');
      font-display: swap;
    }
    .sp-invoice {
      position: relative;
      background: #fff;
      box-sizing: border-box;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      font: 12px/1.35 Calibri, 'Kalpurush', 'Bangla Voucher', sans-serif;
      color: #17252c;
    }
    .sp-invoice *, .sp-invoice *::before, .sp-invoice *::after { box-sizing: border-box; }
    .sp-invoice h1 { font-size: 25px; line-height: 1.2; margin: 0; color: var(--v-accent, #087d6c); white-space: nowrap; font-weight: 700; }
    .sp-invoice h2 { font-size: 15px; margin: 0; font-weight: 700; }
    .sp-invoice h3 { font-size: 11.5px; margin: 0; padding: 5px 8px; background: #edf4f2; border-bottom: 1px solid #cbd5d5; font-weight: 700; }
    .sp-invoice p { margin: 3px 0; }
    .sp-header { display: flex; justify-content: space-between; border-bottom: 3px solid var(--v-accent, #087d6c); padding-bottom: 7px; }
    .sp-right { text-align: right; }
    .sp-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
    .sp-logo { position: relative; overflow: hidden; width: 64px; height: 53px; flex: 0 0 64px; }
    .sp-logo img { position: absolute; width: 430.08px; max-width: none; left: -36.4px; top: -25.2px; }
    .sp-muted { color: #596770; font-size: 10.5px; }
    .sp-customer { margin: 3px 0 8px; padding: 0 10px; border: 2px solid #cbd5d5; border-radius: 0; display: flex; justify-content: space-between; min-height: 75px; font-size: 11.5px; }
    .sp-customer-title { font-size: 16.5px; font-weight: 900; }
    .sp-customer-meta { padding-top: 5px; }
    .sp-customer-meta p { margin: 4px 0 8px; }
    .sp-customer-meta b { font-weight: 400; }
    .sp-table { width: 100%; border-collapse: collapse; }
    .sp-table th, .sp-table td { padding: 6px; border-bottom: 1px solid #d8dfe1; text-align: left; vertical-align: top; }
    .sp-table th { font-size: 10.5px; background: #edf4f2; font-weight: 700; }
    .sp-num { text-align: right !important; white-space: nowrap; }
    .sp-items { border: 1px solid #cbd5d5; color: #000; font-size: 12px; font-weight: 900; margin-top: -7px; }
    .sp-items td { height: 29px; }
    .sp-invoice.sp-grid .sp-items th, .sp-invoice.sp-grid .sp-items td { border: 1px solid #cbd5d5; }
    .sp-sum { font-weight: bold; background: #f3f7f6; }
    .sp-split { display: flex; gap: 12px; margin-top: 36px; align-items: flex-start; }
    .sp-left { width: 55%; }
    .sp-left-bottom { align-self: stretch; display: flex; flex-direction: column; justify-content: flex-end; }
    .sp-left-bottom .sp-block:last-child { margin-bottom: 0; }
    .sp-account { width: 45%; border: 1px solid #cbd5d5; align-self: flex-start; }
    .sp-block { border: 1px solid #cbd5d5; margin-bottom: 8px; }
    .sp-block .sp-table th, .sp-block .sp-table td { padding: 5px; font-size: 11px; }
    .sp-account .sp-table td { padding: 7px 6px; font-size: 10.5px; }
    .sp-account .sp-table td:first-child { width: 67%; }
    .sp-account .sp-table .sp-sum td { background: #f3f7f6; font-weight: bold; }
    .sp-account .sp-table .sp-final { background: var(--v-accent, #087d6c); color: #fff; font-weight: bold; }
    .sp-account .sp-table .sp-final td { font-size: 12px; padding: 8px 6px; background: var(--v-accent, #087d6c); }
    .sp-note { padding: 7px; font-size: 11px; line-height: 1.7; white-space: pre-line; }
    .sp-sign { display: flex; justify-content: space-around; align-items: flex-end; gap: 16px; margin-top: auto; padding-top: 75px; font-size: 11px; }
    .sp-sign-item { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
    .sp-sign-item span { border-top: 1px solid #849295; padding: 6px 14px 0; min-width: 150px; max-width: 100%; text-align: center; }
    .sp-sign-img { max-height: 44px; max-width: 160px; object-fit: contain; margin-bottom: 5px; filter: grayscale(1); }
    .sp-footer { border-top: 1px solid #cbd5d5; margin-top: 7px; padding-top: 4px; font-size: 10.5px; }
    .sp-invoice .sp-greeting { text-align: center; font-weight: 700; color: var(--v-accent, #087d6c); margin: 140px 0 16px; font-size: 12px; }
    .sp-terms { border-top: 1px solid #cbd5d5; margin-top: 10px; padding-top: 5px; font-size: 10px; color: #596770; }
    .sp-terms p { margin: 2px 0; }
    .sp-watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; overflow: hidden; z-index: 0; }
    .sp-watermark span { font-size: 42px; font-weight: 900; color: #0f172a; letter-spacing: 0.1em; white-space: nowrap; }
    .voucher-print-scaler { margin: 0 auto; }
    .voucher-print-paper {
      background: #fff;
      display: grid;
      box-sizing: border-box;
      overflow: hidden;
      transform-origin: top left;
      box-shadow: 0 14px 34px rgba(15, 23, 42, 0.2);
    }
    .voucher-print-paper.sheet-multi .voucher-cell {
      outline: 1px dashed #cbd5e1;
      outline-offset: -1px;
    }
    .voucher-cell {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      overflow: hidden;
      min-width: 0;
      min-height: 0;
      background: #fff;
    }
    .voucher-copy-box { position: relative; overflow: hidden; flex: 0 0 auto; }
    .voucher-copy-box > .printable-area {
      transform-origin: top left;
      max-width: none !important;
      margin: 0 !important;
    }
    @media screen and (max-width: 767px) {
      .sp-invoice { padding: 16px; font-size: 10px; }
      .sp-invoice h1 { font-size: 17px; white-space: normal; }
      .sp-invoice h2 { font-size: 12px; }
      .sp-header { flex-direction: column; gap: 6px; }
      .sp-right { text-align: left; }
      .sp-logo { width: 48px; height: 40px; flex: 0 0 48px; }
      .sp-logo img { width: 325px; left: -27.5px; top: -19px; }
      .sp-customer { flex-direction: column; min-height: 0; gap: 4px; font-size: 10.5px; }
      .sp-split { flex-direction: column; margin-top: 18px; }
      .sp-left, .sp-account { width: 100%; }
      .sp-table th, .sp-table td { padding: 4px; }
      .sp-table th { font-size: 9px; }
      .sp-items td { height: auto; }
      .sp-block .sp-table th, .sp-block .sp-table td { padding: 4px; font-size: 9.5px; }
      .sp-account .sp-table td { padding: 6px 4px; font-size: 10px; }
      .sp-account .sp-table td:first-child { width: 62%; }
      .sp-num { white-space: normal; }
      .sp-sign { gap: 8px; font-size: 9.5px; }
      .sp-sign-item span { padding: 5px 8px 0; min-width: 96px; }
      .sp-note { font-size: 9.5px; }
      .sp-footer { font-size: 9.5px; }
    }
    @media print {
      .sp-invoice { max-width: none; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sp-block, .sp-items, .sp-account, .sp-sign, .sp-footer { break-inside: avoid; }
      .voucher-overlay { position: static !important; display: block !important; overflow: visible !important; }
      .voucher-drawer {
        position: static !important;
        display: block !important;
        width: 100% !important;
        max-width: none !important;
        height: auto !important;
        overflow: visible !important;
        border: 0 !important;
        box-shadow: none !important;
        background: #fff !important;
      }
      .voucher-scroll {
        display: block !important;
        flex: none !important;
        height: auto !important;
        overflow: visible !important;
      }
      .voucher-print-scaler {
        width: auto !important;
        height: auto !important;
        overflow: visible !important;
        margin: 0 !important;
      }
      .voucher-print-paper {
        transform: none !important;
        box-shadow: none !important;
      }
    }
  `],
  template: `
    @if (purchase(); as p) {
      <div class="voucher-overlay fixed inset-0 z-50 flex justify-end overflow-hidden select-none">

        <div
          (click)="close.emit()"
          class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity no-print"
        ></div>

        <div class="voucher-drawer relative w-full max-w-4xl h-full bg-slate-100 shadow-2xl flex flex-col z-10 overflow-hidden border-l border-slate-300 animate-in slide-in-from-right duration-300">

          <div class="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print shrink-0 shadow-xs">

            <div class="flex items-center gap-2 flex-wrap">
              <button
                (click)="close.emit()"
                class="text-slate-500 hover:text-slate-800 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                title="{{ prefs.txt('ড্রয়ার বন্ধ করুন', 'Close Drawer') }}"
              >
                <mat-icon>close</mat-icon>
              </button>

              <span class="font-extrabold text-sm text-slate-800 font-mono">Purchase Voucher #{{ p.invoice }}</span>
            </div>

            <div class="flex items-center gap-2 text-xs">
              @if (!viewMode()) {
                <button
                  (click)="isSettingsOpen.set(true)"
                  class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 shadow-2xs cursor-pointer"
                  title="{{ prefs.txt('ভাউচার কাস্টমাইজেশন', 'Voucher customisation') }}"
                >
                  <mat-icon class="text-xs">tune</mat-icon> {{ prefs.txt('ভাউচার সেটিংস', 'Voucher settings') }}
                </button>
              }

              <div class="relative group">
                <button
                  class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <mat-icon class="text-xs">download</mat-icon> Download
                </button>
                <div class="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl hidden group-hover:block group-focus-within:block z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                  <button (click)="exportAs('html')" class="w-full px-4 py-2 text-left hover:bg-blue-50 text-slate-700 flex items-center gap-2">
                    <mat-icon class="text-amber-600 text-sm">code</mat-icon> Save as HTML
                  </button>
                  <button (click)="exportAs('pdf')" class="w-full px-4 py-2 text-left hover:bg-blue-50 text-slate-700 flex items-center gap-2 border-t border-slate-100">
                    <mat-icon class="text-rose-500 text-sm">picture_as_pdf</mat-icon> Save as PDF
                  </button>
                  <button (click)="exportAs('jpg')" class="w-full px-4 py-2 text-left hover:bg-blue-50 text-slate-700 flex items-center gap-2 border-t border-slate-100">
                    <mat-icon class="text-teal-500 text-sm">image</mat-icon> Save as JPG
                  </button>
                  <button (click)="exportAs('png')" class="w-full px-4 py-2 text-left hover:bg-blue-50 text-slate-700 flex items-center gap-2 border-t border-slate-100">
                    <mat-icon class="text-indigo-500 text-sm">photo</mat-icon> Save as PNG
                  </button>
                </div>
              </div>

              <select
                [ngModel]="layoutPreset()"
                (ngModelChange)="setLayoutPreset($event)"
                class="bg-white border border-slate-300 text-slate-700 text-[11px] font-bold rounded-lg px-2 py-1.5 cursor-pointer"
                title="{{ prefs.txt('কাগজের আকার ও ভাউচার লেআউট', 'Print paper size and voucher layout') }}"
              >
                @for (option of layoutOptions; track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>

              <button
                (click)="onPrint()"
                class="bg-purple-600 hover:bg-purple-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-2xs cursor-pointer"
              >
                <mat-icon class="text-xs">print</mat-icon> Print
              </button>
            </div>

          </div>

          <div class="voucher-scroll flex-1 overflow-y-auto p-4 sm:p-5">

            <!-- Simulated print paper: one sheet with 1, 2 or 4 scaled voucher copies -->
            <div
              class="voucher-print-scaler"
              [style.width.px]="sheet().sheetW * previewScale()"
              [style.height.px]="sheet().sheetH * previewScale()"
            >
              <div
                class="voucher-print-paper"
                [class.sheet-multi]="sheet().copies > 1"
                [style.width.px]="sheet().sheetW"
                [style.height.px]="sheet().sheetH"
                [style.padding.px]="sheet().pad"
                [style.gap.px]="sheet().gap"
                [style.grid-template-columns]="'repeat(' + sheet().cols + ', minmax(0, 1fr))'"
                [style.grid-template-rows]="'repeat(' + sheet().rows + ', minmax(0, 1fr))'"
                [style.transform]="'scale(' + previewScale() + ')'"
              >
                @for (copy of copies(); track $index) {
                  <div class="voucher-cell">
                    <div
                      class="voucher-copy-box"
                      [style.width.px]="sheet().designW * copyScale()"
                      [style.height.px]="copyHeight() * copyScale()"
                    >

            <div
              class="sp-invoice printable-area"
              [class.sp-grid]="settings().showColumnBorders"
              [style.width.px]="sheet().designW"
              [style.min-height.px]="sheet().designH"
              [style.padding.px]="sheet().margin"
              [style.transform]="'scale(' + copyScale() + ')'"
              [style.--v-accent]="settings().accentColor"
              [style.font-family]="fontStack()"
            >
              <div class="sp-header">
                <div>
                  <div class="sp-brand">
                    @if (settings().showLogo) {
                      <div class="sp-logo">
                        <img src="assets/sm-logo.jpg" alt="SM logo" />
                      </div>
                    }
                    <h1>{{ settings().businessNamePart1 }} {{ settings().businessNamePart2 }}</h1>
                  </div>
                  <p class="sp-muted">{{ settings().address }}</p>
                  @if (settings().mobile) {
                    <p class="sp-muted">Mobile: {{ settings().mobile }}</p>
                  }
                </div>
                <div class="sp-right">
                  <h2>PURCHASE &amp; PAYMENT VOUCHER</h2>
                  <p>Voucher No: {{ p.invoice }}</p>
                  <p>Date: <span>{{ formatVoucherDate(p.date) }}</span></p>
                </div>
              </div>

              <div class="sp-customer">
                <div>
                  <p><b class="sp-customer-title">Supplier / Business: {{ p.supplierName }}</b></p>
                  <p>Name: {{ p.supplierName }}</p>
                  <p>Mobile: {{ supplierPhone() || '—' }}</p>
                  @if (supplier()?.address) {
                    <p>Address: {{ supplierAddress() }}</p>
                  }
                </div>
                <div class="sp-right sp-customer-meta">
                  @if (p.purchaser) {
                    <p>Purchaser: {{ p.purchaser }}</p>
                  }
                  @if (p.nextPayDate && p.nextPayDate !== '-') {
                    <p><b>বাকি পরিশোধের তারিখঃ {{ formatVoucherDate(p.nextPayDate) }}</b></p>
                  }
                </div>
              </div>

              <table class="sp-table sp-items">
                <thead>
                  <tr>
                    <th style="width:5%">SL</th>
                    <th style="width:34%">Product Description</th>
                    <th class="sp-num" style="width:14%">Qty / Unit</th>
                    <th class="sp-num">Unit Price</th>
                    <th class="sp-num" style="width:15%">Line Discount</th>
                    <th class="sp-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of items(); track item.id; let idx = $index) {
                    <tr>
                      <td>{{ idx + 1 }}</td>
                      <td>{{ item.productName }}</td>
                      <td class="sp-num">{{ item.quantity }} {{ item.unit || 'pcs' }}</td>
                      <td class="sp-num">{{ item.purchasePrice | number:'1.2-2' }}</td>
                      <td class="sp-num">{{ lineDiscount(item) === 0 ? '—' : (lineDiscount(item) | number:'1.2-2') }}</td>
                      <td class="sp-num">{{ item.subtotal | number:'1.2-2' }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6">No items in this voucher.</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="sp-sum">
                    <td colspan="5">CURRENT NET BILL (AFTER DISCOUNTS)</td>
                    <td class="sp-num">{{ summary().currentNetBill | number:'1.2-2' }}</td>
                  </tr>
                </tfoot>
              </table>

              <div class="sp-split">
                <div class="sp-left" [class.sp-left-bottom]="!hasDetailBlocks()">

                  @if (p.installments && p.installments !== 'None') {
                    <div class="sp-block">
                      <h3>INSTALLMENT PLAN</h3>
                      <div class="sp-note">{{ p.installments }}</div>
                    </div>
                  }

                  @if (p.notes) {
                    <div class="sp-block">
                      <h3>PURCHASE NOTES</h3>
                      <div class="sp-note">{{ p.notes }}</div>
                    </div>
                  }
                </div>

                @if (settings().showSummary) {
                <div class="sp-account">
                  <h3>FINAL ACCOUNT SUMMARY</h3>
                  <table class="sp-table">
                    <tbody>
                      <tr>
                        <td>Current Net Bill (+)</td>
                        <td class="sp-num">{{ summary().currentNetBill | number:'1.2-2' }}</td>
                      </tr>
                      @if (summary().transportLabour > 0) {
                        <tr>
                          <td>Transport &amp; Labour Charge (+)</td>
                          <td class="sp-num">{{ summary().transportLabour | number:'1.2-2' }}</td>
                        </tr>
                      }
                      @if (summary().orderTax > 0) {
                        <tr>
                          <td>Order Tax (+)</td>
                          <td class="sp-num">{{ summary().orderTax | number:'1.2-2' }}</td>
                        </tr>
                      }
                      <tr class="sp-sum">
                        <td>TOTAL PAYABLE</td>
                        <td class="sp-num">{{ summary().totalPayable | number:'1.2-2' }}</td>
                      </tr>
                      @if (summary().paid > 0) {
                        <tr>
                          <td>Paid{{ p.paymentMode ? ' · ' + p.paymentMode : '' }} (-)</td>
                          <td class="sp-num">{{ summary().paid | number:'1.2-2' }}</td>
                        </tr>
                      }
                      <tr class="sp-sum">
                        <td>TOTAL PAYMENTS / CREDITS</td>
                        <td class="sp-num">{{ summary().totalPaymentsCredits | number:'1.2-2' }}</td>
                      </tr>
                      <tr class="sp-final">
                        <td>{{ summary().balanceLabel }}</td>
                        <td class="sp-num">{{ summary().balanceAmount | number:'1.2-2' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                }
              </div>

              @if (settings().showGreeting && voucherGreeting()) {
                <p class="sp-greeting">{{ voucherGreeting() }}</p>
              }
              @if (settings().showTerms) {
                <div class="sp-terms" [style.font-size.px]="settings().termsFontSize">
                  @for (term of voucherTerms(); track term) {
                    <p>{{ term }}</p>
                  }
                </div>
              }

              <div class="sp-sign">
                <div class="sp-sign-item">
                  <span>সরবরাহকারীর স্বাক্ষর</span>
                </div>
                <div class="sp-sign-item">
                  @if (settings().showSignatureImage && settings().signatureImage) {
                    <img class="sp-sign-img" [src]="settings().signatureImage" alt="Authorized signature" />
                  }
                  <span>{{ settings().signatureTitle }}</span>
                </div>
              </div>

              @if (settings().showWatermark) {
                <div class="sp-watermark" [style.opacity]="settings().watermarkOpacity" [style.transform]="'rotate(' + settings().watermarkRotation + 'deg)'">
                  <span>{{ settings().watermarkText || 'SM ENTERPRISE' }}</span>
                </div>
              }
            </div>

                    </div>
                  </div>
                }
              </div>
            </div>

          </div>

        </div>

      </div>

      @if (isSettingsOpen()) {
        <app-voucher-settings-modal voucherType="purchase" (closeModal)="isSettingsOpen.set(false)" />
      }
    }
  `
})
export class PurchaseVoucher implements AfterViewChecked, OnDestroy {
  private dataService = inject(DataService);
  private notify = inject(NotificationService);
  private host = inject(ElementRef<HTMLElement>);
  readonly prefs = inject(PreferencesService);

  purchase = input<Purchase | null>(null);
  close = output<void>();
  viewMode = input(false);

  readonly settings = this.dataService.voucherSettings;
  readonly isSettingsOpen = signal(false);

  readonly sheet = computed(() => resolveVoucherSheet(this.settings()));
  readonly copies = computed(() => Array.from({ length: this.sheet().copies }, (_, index) => index));
  readonly copyHeight = signal(1000);
  readonly copyScale = computed(() => {
    const sheet = this.sheet();
    return Math.min(1, sheet.cellW / sheet.designW, sheet.cellH / Math.max(1, this.copyHeight()));
  });

  private readonly viewportWidth = signal(typeof window === 'undefined' ? 1200 : window.innerWidth);
  readonly previewScale = computed(() => {
    const available = Math.max(260, Math.min(848, this.viewportWidth() - 48));
    return Math.min(1, available / this.sheet().sheetW);
  });
  readonly layoutPreset = computed(() => layoutPresetOf(this.settings()));
  readonly layoutOptions = VOUCHER_LAYOUT_OPTIONS;

  private resizeObserver?: ResizeObserver;
  private observedCopy?: HTMLElement;

  @HostListener('window:resize')
  onWindowResize() {
    this.viewportWidth.set(window.innerWidth);
  }

  ngAfterViewChecked() {
    const copy = this.host.nativeElement.querySelector('.printable-area');
    if (!copy) return;
    if (this.observedCopy !== copy) {
      this.observedCopy = copy;
      this.resizeObserver ??= new ResizeObserver(() => this.measureCopy());
      this.resizeObserver.disconnect();
      this.resizeObserver.observe(copy);
    }
    this.measureCopy();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }

  private measureCopy() {
    const copy = this.observedCopy;
    if (!copy) return;
    const height = copy.offsetHeight;
    if (height > 0 && Math.abs(height - this.copyHeight()) > 1) this.copyHeight.set(height);
  }

  setLayoutPreset(preset: string) {
    if (preset === 'CUSTOM') {
      this.isSettingsOpen.set(true);
      return;
    }
    this.dataService.updateVoucherSettings(presetSettings(preset as VoucherLayoutPreset));
  }

  onPrint() {
    this.runVoucherJob(printVoucherSheet, 'প্রিন্ট করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।', 'Print failed');
  }

  exportAs(kind: 'html' | 'pdf' | 'jpg' | 'png') {
    const runner = { html: downloadVoucherHtml, pdf: downloadVoucherPdf, jpg: downloadVoucherJpg, png: downloadVoucherPng }[kind];
    this.runVoucherJob(runner, `${kind.toUpperCase()} ফাইল তৈরি করা যায়নি।`, `${kind.toUpperCase()} export failed`);
  }

  private runVoucherJob(runner: (target: VoucherPrintTarget) => Promise<void | number>, messageBn: string, messageEn: string) {
    const paperEl = this.host.nativeElement.querySelector('.voucher-print-paper') as HTMLElement | null;
    if (!paperEl) return;
    const invoice = this.purchase()?.invoice ?? '';
    runner({ paperEl, sheet: this.sheet(), fileName: `Purchase_${invoice}`, title: `Purchase Voucher ${invoice}` })
      .catch(err => {
        console.error(messageEn, err);
        this.notify.error(messageBn, messageEn);
      });
  }

  readonly supplier = computed(() => {
    const name = (this.purchase()?.supplierName || '').trim().toLowerCase();
    if (!name) return null;
    return this.dataService.parties().find(party => (party.name || '').trim().toLowerCase() === name) ?? null;
  });

  readonly supplierPhone = computed(() => (this.supplier()?.phone || '').trim());
  readonly supplierAddress = computed(() => localizeAddress(this.supplier()?.address, this.prefs.language()));

  readonly items = computed(() => this.purchase()?.items ?? []);

  readonly hasDetailBlocks = computed(() => {
    const p = this.purchase();
    if (!p) return false;
    return !!(p.installments && p.installments !== 'None') || !!p.notes;
  });

  readonly summary = computed(() => {
    const p = this.purchase();
    if (!p) {
      return {
        currentNetBill: 0,
        transportLabour: 0,
        orderTax: 0,
        totalPayable: 0,
        paid: 0,
        totalPaymentsCredits: 0,
        balanceAmount: 0,
        balanceLabel: 'PAID IN FULL',
      };
    }

    const itemsTotal = round2(this.items().reduce((sum, item) => sum + (item.subtotal || 0), 0));
    const discount = p.discountType === 'percent'
      ? round2(itemsTotal * (p.discount || 0) / 100)
      : round2(p.discount || 0);
    const currentNetBill = round2(Math.max(0, itemsTotal - discount));
    const transportLabour = round2(p.shipping || 0);
    const orderTax = round2(p.taxAmount || 0);
    const totalPayable = round2(p.total ?? (currentNetBill + transportLabour + orderTax));
    const paid = round2(p.paid || 0);
    const totalPaymentsCredits = paid;
    const finalBalance = round2(p.due ?? (totalPayable - paid));

    return {
      currentNetBill,
      transportLabour,
      orderTax,
      totalPayable,
      paid,
      totalPaymentsCredits,
      balanceAmount: Math.abs(finalBalance),
      balanceLabel: finalBalance < 0 ? 'ADVANCE PAID TO SUPPLIER' : (finalBalance === 0 ? 'PAID IN FULL' : 'FINAL DUE BALANCE'),
    };
  });

  lineDiscount(item: PurchaseItem): number {
    const gross = (item.quantity || 0) * (item.purchasePrice || 0);
    return Math.max(0, round2(gross - (item.subtotal || 0)));
  }

  formatVoucherDate(value?: string): string {
    if (!value) return '';
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
    return value;
  }

  readonly fontStack = () => {
    const family = this.settings().fontFamily || 'Kalpurush';
    return `Calibri, '${family}', 'Bangla Voucher', sans-serif`;
  };

  readonly voucherGreeting = computed(() => this.settings().purchaseGreeting);
  readonly voucherTerms = computed(() =>
    [this.settings().purchaseTerm1, this.settings().purchaseTerm2].filter(term => !!term)
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
