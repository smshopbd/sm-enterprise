import { AfterViewChecked, ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject, input, OnDestroy, OnInit, output, signal, viewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, Sale, SaleItem } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { isWarrantyCancelled, isWarrantyCompleted } from '../../utils/warranty';
import { qrDataUrl } from '../../utils/qr-code';
import { localizeAddress } from '../../utils/bd-geo';
import { saleQrText } from '../../utils/voucher-qr';
import { saleItemDisplayName } from '../../utils/sale-item-label';
import { findProductForLine } from '../../utils/report-analytics';
import { takaInWords } from '../../utils/amount-words';
import { VoucherSettingsModal } from '../voucher-settings-modal/voucher-settings-modal';
import { ShareInvoiceComponent } from '../share-invoice/share-invoice';
import {
  downloadVoucherHtml,
  downloadVoucherJpg,
  downloadVoucherPdf,
  downloadVoucherPng,
  layoutPresetOf,
  presetSettings,
  printVoucherSheet,
  resolveVoucherSheet,
  VOUCHER_LAYOUT_OPTIONS,
  VoucherLayoutPreset,
  VoucherPrintTarget,
} from '../../utils/voucher-print';

export interface InvoicePagePlan {
  index: number;
  items: SaleItem[];
  firstIndex: number;
  continuation: boolean;
  tail: boolean;
  pageNo: number;
  pageCount: number;
  measure?: boolean;
}

interface InvoiceMetrics {
  rows: number[];
  firstHead: number;
  nextHead: number;
  tail: number;
}

/**
 * Packs item rows onto sheets so a long invoice grows pages instead of shrinking.
 * Page 1 carries the full letterhead, continuation pages a compact one, and the
 * last page must also fit the totals/blocks/signature tail, so it is packed last.
 * Rows are split to keep the *inside* sheets equally full; the closing sheet is
 * allowed to carry only the tail. Spreading the leftover space across page 1
 * would leave it visibly half empty, which is what this guards against.
 */
export function planInvoicePages(
  rowHeights: readonly number[],
  pageHeight: number,
  firstHead: number,
  nextHead: number,
  tail: number,
  bottomReserve = 26
): number[] {
  const rows = rowHeights.map(height => Math.max(1, height));
  const count = rows.length;
  if (!count) return [0];

  const singleRoom = Math.max(0, pageHeight - firstHead - tail);
  const total = rows.reduce((sum, height) => sum + height, 0);
  // A hair of overflow still fits once the sheet scales a fraction smaller; it
  // should not spill one lonely row onto an almost empty second sheet.
  if (total <= singleRoom + pageHeight * 0.005) return [count];

  const capFirst = Math.max(0, pageHeight - firstHead - bottomReserve);
  const capNext = Math.max(0, pageHeight - nextHead - bottomReserve);
  const capLast = Math.max(0, pageHeight - nextHead - tail);

  /** Rows starting at `start` that fit in `cap`; always makes progress. */
  const fitForward = (start: number, cap: number, limit = count): number => {
    let used = 0;
    let taken = 0;
    while (start + taken < limit) {
      const height = rows[start + taken];
      if (taken > 0 && used + height > cap) break;
      used += height;
      taken++;
    }
    return taken;
  };

  // The fewest sheets that still leave room for the closing tail on the last one.
  let sheetCount = 2;
  for (;;) {
    let packed = fitForward(0, capFirst);
    for (let middle = 0; middle < sheetCount - 2; middle++) packed += fitForward(packed, capNext);
    if (packed + fitForward(packed, capLast) >= count) break;
    sheetCount++;
  }

  const rooms: number[] = [];
  for (let index = 0; index < sheetCount; index++) {
    rooms.push(index === 0 ? capFirst : index === sheetCount - 1 ? capLast : capNext);
  }

  /**
   * Forward-packs rows, stopping each inside sheet `softBlank` px short of its
   * room. The closing sheet takes whatever is left and may be empty when the
   * rows already fill the earlier sheets. Null when the rows cannot be covered.
   */
  const pack = (softBlank: number): number[] | null => {
    const sizes: number[] = [];
    let cursor = 0;
    for (let index = 0; index < sheetCount; index++) {
      const last = index === sheetCount - 1;
      let take = 0;
      if (last) {
        let used = 0;
        for (let rest = cursor; rest < count; rest++) used += rows[rest];
        if (used > rooms[index]) return null;
        take = count - cursor;
      } else {
        const limit = Math.max(0, rooms[index] - softBlank);
        let used = 0;
        while (cursor + take < count) {
          const height = rows[cursor + take];
          if (used + height > limit) break;
          used += height;
          take++;
        }
        if (take === 0) return null;
      }
      sizes.push(take);
      cursor += take;
    }
    return cursor === count ? sizes : null;
  };

  /**
   * Wasted band at the bottom of the inside sheets: the largest one decides how
   * empty a page looks, the sum breaks ties. The closing sheet is excluded
   * because its tail is anchored to the foot of the page anyway.
   */
  const insideWaste = (sizes: number[]): { worst: number; total: number } => {
    let worst = 0;
    let total = 0;
    let cursor = 0;
    for (let index = 0; index < sizes.length - 1; index++) {
      let used = 0;
      for (let offset = 0; offset < sizes[index]; offset++) used += rows[cursor + offset];
      const gap = rooms[index] - used;
      worst = Math.max(worst, gap);
      total += gap;
      cursor += sizes[index];
    }
    return { worst, total };
  };

  let best: number[] | null = null;
  let bestWorst = Infinity;
  let bestTotal = Infinity;
  for (let blank = 0; blank <= capFirst + 1; blank++) {
    const sizes = pack(blank);
    if (!sizes) continue;
    const { worst, total: waste } = insideWaste(sizes);
    if (worst < bestWorst || (worst === bestWorst && waste < bestTotal)) {
      best = sizes;
      bestWorst = worst;
      bestTotal = waste;
    }
  }
  if (best) return best;

  // A sheet with almost no room can defeat the even split; pack forward instead.
  const sizes: number[] = [];
  let cursor = 0;
  for (let index = 0; index < sheetCount; index++) {
    const take = fitForward(cursor, rooms[index]);
    sizes.push(take);
    cursor += take;
  }
  return cursor === count ? sizes : [count];
}

@Component({
  selector: 'app-invoice-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, VoucherSettingsModal, ShareInvoiceComponent],
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
    .sp-split { display: flex; gap: 12px; align-items: flex-start; }
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
    .sp-note { padding: 7px; font-size: 12px; font-weight: 700; line-height: 1.7; white-space: pre-line; }
    .sp-wcontent { padding: 7px 8px; font-size: 11px; line-height: 1.55; }
    .sp-closing { margin-top: auto; }
    .sp-sign { display: flex; justify-content: space-between; align-items: flex-end; padding-top: 32px; font-size: 11px; }
    .sp-sign-item { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
    .sp-sign-item span { border-top: 1px solid #849295; padding: 6px 22px 0; min-width: 150px; text-align: center; }
    .sp-sign-img { max-height: 44px; max-width: 160px; object-fit: contain; margin-bottom: 5px; filter: grayscale(1); }
    .sp-sign-spacer { min-width: 150px; }
    .sp-footer { border-top: 1px solid #cbd5d5; margin-top: 7px; padding-top: 4px; font-size: 10.5px; }
    .sp-invoice .sp-greeting { text-align: center; font-weight: 700; color: var(--v-accent, #087d6c); margin: 10px 0 16px; font-size: 12px; }
    .sp-terms { border-top: 1px solid #cbd5d5; margin-top: 10px; padding-top: 5px; font-size: 10px; color: #596770; }
    .sp-terms p { margin: 2px 0; }
    .sp-copy-tag { display: flex; justify-content: flex-end; margin-bottom: 4px; padding-bottom: 2px; border-bottom: 1px dashed #cbd5d5; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #596770; }
    .sp-stamp { display: inline-block; margin-top: 4px; padding: 1px 8px; border: 1.5px solid currentColor; border-radius: 2px; font-size: 10px; font-weight: 900; letter-spacing: 0.12em; }
    .sp-stamp-paid { color: #047857; }
    .sp-stamp-due { color: #b91c1c; }
    .sp-stamp-advance { color: #1d4ed8; }
    .sp-words { margin-top: 6px; padding: 4px 7px; border: 1px solid #cbd5d5; background: #f8fafb; font-size: 11px; }
    .sp-item-meta { margin-top: 1px; font-size: 9px; font-weight: 400; color: #64748b; }
    .sp-qr { text-align: center; margin: 10px 0 2px; }
    .sp-qr img { width: 75px; height: 75px; display: inline-block; border: 0; border-radius: 0; padding: 0; margin-left: 50px; margin-bottom: 10px; }
    .sp-cont-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 2px solid var(--v-accent, #087d6c); padding-bottom: 5px; }
    .sp-cont-head h1 { font-size: 19px; }
    .sp-cont-meta { text-align: right; font-size: 10.5px; }
    .sp-cont-meta p { margin: 1px 0; }
    .sp-items-cont { margin-top: 6px; }
    .sp-page-foot { position: absolute; left: 34px; right: 34px; bottom: 10px; display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid #cbd5d5; padding-top: 3px; font-size: 9.5px; color: #596770; }
    .sp-watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; overflow: hidden; z-index: 0; }
    .sp-watermark span { font-size: 42px; font-weight: 900; color: #0f172a; letter-spacing: 0.1em; white-space: nowrap; }
    .sp-cancelled { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; overflow: hidden; z-index: 0; }
    .sp-cancelled span { font-size: 64px; font-weight: 900; color: #dc2626; opacity: 0.18; border: 6px solid #dc2626; border-radius: 10px; padding: 8px 28px; letter-spacing: 0.14em; white-space: nowrap; transform: rotate(-20deg); }
    .voucher-print-scaler { margin: 0 auto; }
    .voucher-measure { position: fixed; left: -12000px; top: 0; width: 1200px; visibility: hidden; pointer-events: none; z-index: -1; }
    .voucher-measure .sp-invoice { min-height: 0 !important; }
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
    @media print {
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
      .sp-invoice {
        max-width: none;
        margin: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
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
    }
  `],
  template: `
    <!-- Full-screen backdrop & Right-side slide-over sidebar drawer -->
    <div class="voucher-overlay fixed inset-0 z-50 flex justify-end overflow-hidden select-none">
      
      <!-- Backdrop Click to Close -->
      <div
        (click)="closeModal.emit()"
        class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity no-print"
      ></div>

      <!-- Right Slide-Over Sidebar Drawer -->
      <div
        class="voucher-drawer relative w-full max-w-4xl h-full bg-slate-100 shadow-2xl flex flex-col z-10 overflow-hidden border-l border-slate-300 animate-in slide-in-from-right duration-300"
      >
        
        <!-- Top Toolbar Header (Pinned at top of sidebar) -->
        <div class="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print shrink-0 shadow-xs">
          
          <div class="flex items-center gap-2 flex-wrap">
            <button
              (click)="closeModal.emit()"
              class="text-slate-500 hover:text-slate-800 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              title="{{ prefs.txt('ড্রয়ার বন্ধ করুন', 'Close Drawer') }}"
            >
              <mat-icon>close</mat-icon>
            </button>
            
            <span class="font-extrabold text-sm text-slate-800 font-mono">Invoice #{{ currentSale().invoice }}</span>
          </div>

          <!-- Right Action Buttons in Drawer Header -->
          <div class="flex items-center gap-2 text-xs">
            @if (!viewMode()) {
              <button
                (click)="isSettingsOpen.set(true)"
                class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 shadow-2xs cursor-pointer"
                [title]="prefs.txt('ভাউচার কাস্টমাইজেশন', 'Customize voucher')"
              >
                <mat-icon class="text-xs">tune</mat-icon> {{ prefs.txt('ভাউচার সেটিংস', 'Voucher settings') }}
              </button>
            }

            <!-- Download Dropdown -->
            <div class="relative">
              <button
                (click)="toggleDownload()"
                [disabled]="exporting()"
                class="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-2xs cursor-pointer"
              >
                @if (exporting()) {
                  <span class="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
                  {{ prefs.txt('তৈরি হচ্ছে…', 'Preparing…') }}
                } @else {
                  <mat-icon class="text-xs">download</mat-icon> {{ prefs.txt('ডাউনলোড', 'Download') }}
                }
              </button>
              @if (downloadOpen()) {
                <div class="fixed inset-0 z-40" (click)="downloadOpen.set(false)"></div>
                <div class="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                  <p class="px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">{{ prefs.txt('ফাইল ফরম্যাট', 'File format') }}</p>
                  @for (option of downloadOptions; track option.kind) {
                    <button (click)="pickDownload(option.kind)" class="w-full px-4 py-2 text-left hover:bg-blue-50 text-slate-700 flex items-center gap-2 border-t border-slate-100 first:border-t-0">
                      <mat-icon class="text-sm" [class]="option.iconClass">{{ option.icon }}</mat-icon>
                      <span class="flex-1">
                        <span class="block font-bold">{{ prefs.txt(option.bn, option.en) }}</span>
                        <span class="block text-[9.5px] text-slate-400">{{ prefs.txt(option.hintBn, option.hintEn) }}</span>
                      </span>
                    </button>
                  }
                </div>
              }
            </div>

            <app-share-invoice
              [paperEl]="sharePapers()[0]"
              [paperEls]="sharePapers()"
              [fileName]="'Invoice_' + currentSale().invoice"
              [title]="'Sales Invoice ' + currentSale().invoice"
              [message]="shareMessage()"
              [pdfWidthMm]="sheet().pageWmm"
              [pdfHeightMm]="sheet().pageHmm"
            />

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
              [disabled]="exporting()"
              class="bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-2xs cursor-pointer"
            >
              <mat-icon class="text-xs">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
          </div>

        </div>


        <!-- Scrollable Voucher Area -->
        <div class="voucher-scroll flex-1 overflow-y-auto p-4 sm:p-5">

          <!-- One invoice body shared by every printed page and the hidden measurer. -->
          <ng-template #invoiceTpl let-page let-copyLabel="copyLabel">
            <div class="sp-invoice printable-area" [class.sp-grid]="settings().showColumnBorders" [style.width.px]="sheet().designW" [style.min-height.px]="sheet().designH" [style.padding.px]="sheet().margin" [style.transform]="'scale(' + pageScale(page) + ')'" [style.--v-accent]="settings().accentColor" [style.font-family]="fontStack()">
              @if (copyLabel) {
                <div class="sp-copy-tag">{{ copyLabel }}</div>
              }
              @if (page.continuation) {
                <div class="sp-cont-head">
                  <div>
                    <h1 [style.color]="settings().businessColor1">{{ settings().businessNamePart1 }} <span [style.color]="settings().businessColor2">{{ settings().businessNamePart2 }}</span></h1>
                    <p class="sp-muted">{{ prefs.txt('একই ইনভয়েসের পরবর্তী পৃষ্ঠা', 'Continuation of the same invoice') }}</p>
                  </div>
                  <div class="sp-cont-meta">
                    <p><b>SALES &amp; PAYMENT INVOICE</b></p>
                    <p>Invoice No: {{ currentSale().invoice }} | Date: {{ formatVoucherDate(currentSale().date) }}</p>
                    <p>Customer: {{ currentSale().shopName || currentSale().customerName }}</p>
                  </div>
                </div>
              } @else {
              <div class="sp-header">
                <div>
                  <div class="sp-brand">
                    @if (settings().showLogo) {
                      <div class="sp-logo">
                        <img src="assets/sm-logo.jpg" alt="SM logo" />
                      </div>
                    }
                    <h1 [style.color]="settings().businessColor1">{{ settings().businessNamePart1 }} <span [style.color]="settings().businessColor2">{{ settings().businessNamePart2 }}</span></h1>
                  </div>
                  <p class="sp-muted">{{ settings().address }}</p>
                  @if (settings().mobile || settings().email) {
                    <p class="sp-muted">
                      @if (settings().mobile) { Mobile: {{ settings().mobile }} }
                      @if (settings().mobile && settings().email) { · }
                      @if (settings().email) { Email: {{ settings().email }} }
                    </p>
                  }
                  @if (settings().vatRegNo || settings().tradeLicenseNo) {
                    <p class="sp-muted">
                      @if (settings().vatRegNo) { VAT / BIN: {{ settings().vatRegNo }} }
                      @if (settings().vatRegNo && settings().tradeLicenseNo) { · }
                      @if (settings().tradeLicenseNo) { Trade License: {{ settings().tradeLicenseNo }} }
                    </p>
                  }
                </div>
                <div class="sp-right">
                  <h2>SALES &amp; PAYMENT INVOICE</h2>
                  <p>Invoice No: {{ currentSale().invoice }}</p>
                  <p>Date: <span>{{ formatVoucherDate(currentSale().date) }}</span></p>
                  @if (settings().showPaymentStatus && !cancelled()) {
                    <span
                      class="sp-stamp"
                      [class.sp-stamp-paid]="paymentStamp().tone === 'paid'"
                      [class.sp-stamp-due]="paymentStamp().tone === 'due'"
                      [class.sp-stamp-advance]="paymentStamp().tone === 'advance'"
                    >{{ paymentStamp().text }}</span>
                  }
                </div>
              </div>

              <div class="sp-customer">
                <div>
                  <p><b class="sp-customer-title">Customer / Business: {{ currentSale().shopName || currentSale().customerName }}</b></p>
                  <p>Name: {{ currentSale().customerName }}</p>
                  <p>Mobile: {{ customerMobile() || '—' }}</p>
                  @if (currentSale().address) {
                    <p>Address: {{ saleAddress() }}</p>
                  }
                </div>
                <div class="sp-right sp-customer-meta">
                  <p>Prepared by: {{ currentSale().preparedBy || settings().soldBy }}</p>
                  @if (showQR()) {
                    <div class="sp-qr">
                      <img [src]="qrUrl()" [style.width.px]="settings().qrSize" [style.height.px]="settings().qrSize" alt="QR Code" crossOrigin="anonymous" referrerpolicy="no-referrer" />
                    </div>
                  }
                  @if (currentSale().nextPayDate && currentSale().nextPayDate !== '-') {
                    <p><b>বাকি পরিশোধের তারিখঃ {{ formatVoucherDate(currentSale().nextPayDate) }}</b></p>
                  }
                </div>
              </div>
              }

              <table class="sp-table sp-items" [class.sp-items-cont]="page.continuation">
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
                  @for (item of page.items; track item.id; let idx = $index) {
                    <tr>
                      <td>{{ page.firstIndex + idx + 1 }}</td>
                      <td>{{ itemName(item) }}
                        @if (settings().showItemCode && itemMeta(item)) {
                          <div class="sp-item-meta">{{ itemMeta(item) }}</div>
                        }
                      </td>
                      <td class="sp-num">{{ item.quantity }} {{ item.unit || 'pcs' }}
                        @if (lineBaseQtyNote(item)) {
                          <div style="font-size:9px;color:#64748b">{{ lineBaseQtyNote(item) }}</div>
                        }
                      </td>
                      <td class="sp-num">{{ item.salesPrice | number:'1.2-2' }}</td>
                      <td class="sp-num">{{ lineDiscount(item) === 0 ? '—' : (lineDiscount(item) | number:'1.2-2') }}</td>
                      <td class="sp-num">{{ item.total | number:'1.2-2' }}</td>
                    </tr>
                  } @empty {
                    @if (page.pageCount === 1) {
                      <tr>
                        <td colspan="6">No items in this invoice.</td>
                      </tr>
                    }
                  }
                </tbody>
                @if (page.tail) {
                  <tfoot>
                    <tr class="sp-sum">
                      <td colspan="5">CURRENT NET BILL (AFTER LINE DISCOUNTS)</td>
                      <td class="sp-num">{{ salesPaymentNetBill() | number:'1.2-2' }}</td>
                    </tr>
                  </tfoot>
                }
              </table>

              @if (page.tail) {
              <div class="sp-split">
                <div class="sp-left" [class.sp-left-bottom]="!hasSalesPaymentDetailBlocks()">
                    @if (settings().showOldBatteries && salesPaymentOldBatteries().length > 0) {
                      <div class="sp-block">
                        <h3>পুরাতন ব্যাটারি জমা</h3>
                        <table class="sp-table">
                          <thead>
                            <tr>
                              <th>ধরণ / বিবরণ</th>
                              <th class="sp-num">Kg</th>
                              <th class="sp-num">Rate/kg</th>
                              <th class="sp-num">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (bat of salesPaymentOldBatteries(); track bat.id) {
                              <tr>
                                <td>{{ bat.description }}</td>
                                <td class="sp-num">{{ bat.weightKg }}</td>
                                <td class="sp-num">{{ bat.ratePerKg | number:'1.2-2' }}</td>
                                <td class="sp-num">{{ bat.total | number:'1.2-2' }}</td>
                              </tr>
                            }
                          </tbody>
                          <tfoot>
                            <tr class="sp-sum">
                              <td colspan="3">মোট ব্যাটারি জমা</td>
                              <td class="sp-num">{{ salesPaymentTotalBattery() | number:'1.2-2' }}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    }

                    @if (settings().showReturnedGoods && salesPaymentReturnItems().length > 0) {
                      <div class="sp-block">
                        <h3>ফেরত মাল জমা</h3>
                        <table class="sp-table">
                          <thead>
                            <tr>
                              <th>Item / Original Invoice</th>
                              <th class="sp-num">Qty / Unit</th>
                              <th class="sp-num">Rate</th>
                              <th class="sp-num">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (ret of salesPaymentReturnItems(); track ret.id) {
                              <tr>
                                <td>{{ ret.item }}</td>
                                <td class="sp-num">{{ ret.qty }}</td>
                                <td class="sp-num">{{ ret.rate | number:'1.2-2' }}</td>
                                <td class="sp-num">{{ ret.amount | number:'1.2-2' }}</td>
                              </tr>
                            }
                          </tbody>
                          <tfoot>
                            <tr class="sp-sum">
                              <td colspan="3">মোট ফেরত জমা</td>
                              <td class="sp-num">{{ salesPaymentTotalReturn() | number:'1.2-2' }}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    }

                    @if (warrantyForVoucher(); as w) {
                      <div class="sp-block sp-warranty">
                        <h3>{{ prefs.txt('ওয়ারেন্টি পণ্য গ্রহণ', 'WARRANTY PRODUCT RECEIPT') }}</h3>
                        <div class="sp-wcontent">
                          <b>{{ prefs.txt('ক্লেইম নং', 'Claim No.') }}: {{ w.claimNo || '-' }}</b>@if (w.originalInvoice) { <span> | {{ prefs.txt('মূল ইনভয়েস', 'Original Invoice') }}: {{ w.originalInvoice }}</span> }<br />
                          @if (w.battery || w.quantity) {
                            {{ prefs.txt('ব্যাটারি', 'Battery') }}: {{ w.battery || '-' }} | {{ prefs.txt('পরিমাণ', 'Qty') }}: {{ w.quantity || '-' }}<br />
                          }
                          @if (w.receiveDate) {
                            {{ prefs.txt('গ্রহণ', 'Received') }}: {{ formatVoucherDate(w.receiveDate) }}<br />
                          }
                          {{ prefs.txt('নতুন সিরিয়াল', 'New Serial') }}: {{ w.newSerial || w.oldSerial || '-' }}<br />
                          @if (w.replacementDate || w.deliveryNo) {
                            {{ prefs.txt('পরিবর্তনের তারিখ', 'Replacement Date') }}: {{ formatVoucherDate(w.replacementDate) || '-' }} | {{ prefs.txt('ডেলিভারি নং', 'Delivery') }}: {{ w.deliveryNo || '-' }}<br />
                          }
                          @if (w.replacementProductName) {
                            {{ prefs.txt('নতুন ব্যাটারি', 'Replacement') }}: {{ w.replacementProductName }}{{ w.replacementQty ? ' × ' + w.replacementQty : '' }}<br />
                          }
                          @if (w.status) {
                            {{ prefs.txt('স্ট্যাটাস', 'Status') }}: {{ warrantyStatusText(w.status) }}<br />
                          }
                          @if (settings().warrantyNote) {
                            <i>{{ settings().warrantyNote }}</i>
                          }
                        </div>
                      </div>
                    }

                    @if (settings().showNotes && (currentSale().memoNote || currentSale().notes)) {
                      <div class="sp-block">
                        <h3>PAYMENT REFERENCE &amp; NOTES</h3>
                        <div class="sp-note">{{ currentSale().memoNote || currentSale().notes }}</div>
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
                        <td class="sp-num">{{ salesPaymentSummary().currentNetBill | number:'1.2-2' }}</td>
                      </tr>
                      @if (salesPaymentSummary().orderDiscount > 0) {
                        <tr>
                          <td>Order Discount (-)</td>
                          <td class="sp-num">{{ salesPaymentSummary().orderDiscount | number:'1.2-2' }}</td>
                        </tr>
                      }
                      @if (salesPaymentSummary().taxAmount > 0) {
                        <tr>
                          <td>Tax (+)</td>
                          <td class="sp-num">{{ salesPaymentSummary().taxAmount | number:'1.2-2' }}</td>
                        </tr>
                      }
                      @if (salesPaymentSummary().transportLabour > 0) {
                        <tr>
                          <td>Transport &amp; Labour Charge (+)</td>
                          <td class="sp-num">{{ salesPaymentSummary().transportLabour | number:'1.2-2' }}</td>
                        </tr>
                      }
                      @if (salesPaymentSummary().warrantyTransport > 0) {
                        <tr>
                          <td>Warranty Transport Charge (+)</td>
                          <td class="sp-num">{{ salesPaymentSummary().warrantyTransport | number:'1.2-2' }}</td>
                        </tr>
                      }
                      @if (salesPaymentSummary().damageAmount > 0) {
                        <tr>
                          <td>Damage Charge (+)</td>
                          <td class="sp-num">{{ salesPaymentSummary().damageAmount | number:'1.2-2' }}</td>
                        </tr>
                      }
                      <tr class="sp-sum">
                        <td>TOTAL VOUCHER BILL</td>
                        <td class="sp-num">{{ salesPaymentSummary().totalVoucherBill | number:'1.2-2' }}</td>
                      </tr>
                      <tr>
                        <td>Previous Balance (+)</td>
                        <td class="sp-num">{{ salesPaymentSummary().previousBalance | number:'1.2-2' }}</td>
                      </tr>
                      <tr class="sp-sum">
                        <td>TOTAL PAYABLE</td>
                        <td class="sp-num">{{ salesPaymentSummary().totalPayable | number:'1.2-2' }}</td>
                      </tr>
                      @if (salesPaymentSummary().cashReceived > 0) {
                        <tr>
                          <td>Cash Received (-)</td>
                          <td class="sp-num">{{ salesPaymentSummary().cashReceived | number:'1.2-2' }}</td>
                        </tr>
                      }
                      @if (salesPaymentSummary().bankPayment > 0) {
                        <tr>
                          <td>Bank Payment Received (-)</td>
                          <td class="sp-num">{{ salesPaymentSummary().bankPayment | number:'1.2-2' }}</td>
                        </tr>
                      }
                      @if (salesPaymentSummary().oldBatteryCredit > 0) {
                        <tr>
                          <td>Old Battery Credit (-)</td>
                          <td class="sp-num">{{ salesPaymentSummary().oldBatteryCredit | number:'1.2-2' }}</td>
                        </tr>
                      }
                      @if (salesPaymentSummary().returnedGoodsCredit > 0) {
                        <tr>
                          <td>Returned Goods Credit (-)</td>
                          <td class="sp-num">{{ salesPaymentSummary().returnedGoodsCredit | number:'1.2-2' }}</td>
                        </tr>
                      }
                      <tr class="sp-sum">
                        <td>TOTAL PAYMENTS / CREDITS</td>
                        <td class="sp-num">{{ salesPaymentSummary().totalPaymentsCredits | number:'1.2-2' }}</td>
                      </tr>
                      <tr class="sp-final">
                        <td>{{ salesPaymentSummary().balanceLabel }}</td>
                        <td class="sp-num">{{ salesPaymentSummary().balanceAmount | number:'1.2-2' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                }
              </div>

              @if (settings().showAmountInWords) {
                <div class="sp-words"><b>{{ prefs.txt('কথায়', 'In Words') }}:</b> {{ inWords() }}</div>
              }

              <div class="sp-closing">
                @if (settings().showGreeting && settings().greetingText) {
                  <p class="sp-greeting">{{ settings().greetingText }}</p>
                }
                @if (settings().showTerms) {
                  <div class="sp-terms" [style.font-size.px]="settings().termsFontSize">
                    @if (settings().term1) { <p>{{ settings().term1 }}</p> }
                    @if (settings().term2) { <p>{{ settings().term2 }}</p> }
                  </div>
                }

                <div class="sp-sign">
                  <div class="sp-sign-item">
                    <span>ক্রেতার স্বাক্ষর</span>
                  </div>
                  <div class="sp-sign-item">
                    @if (settings().showSignatureImage && settings().signatureImage) {
                      <img class="sp-sign-img" [src]="settings().signatureImage" alt="Authorized signature" />
                    }
                    <span>{{ settings().signatureTitle }}</span>
                  </div>
                </div>
              </div>

              @if (settings().showWatermark) {
                <div class="sp-watermark" [style.opacity]="settings().watermarkOpacity" [style.transform]="'rotate(' + settings().watermarkRotation + 'deg)'">
                  <span>{{ settings().watermarkText || 'SM ENTERPRISE' }}</span>
                </div>
              }
              }

              @if (cancelled()) {
                <div class="sp-cancelled"><span>{{ prefs.txt('বাতিল', 'CANCELLED') }}</span></div>
              }

              <div class="sp-page-foot" [style.left.px]="sheet().margin" [style.right.px]="sheet().margin">
                <span>Invoice No: {{ currentSale().invoice }}</span>
                <span>{{ prefs.txt('পৃষ্ঠা', 'Page') }} {{ page.pageNo }} / {{ page.pageCount }}</span>
              </div>
            </div>
          </ng-template>

          <!-- Simulated print papers: one sheet per page, each with 1, 2 or 4 copies -->
          @for (page of pages(); track page.index) {
            <div
              class="voucher-print-scaler mb-5"
              [style.width.px]="sheet().sheetW * previewScale()"
              [style.height.px]="sheet().sheetH * previewScale()"
            >
              <div
                #voucherPaper
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
                      [style.width.px]="sheet().designW * pageScale(page)"
                      [style.height.px]="pageHeight(page) * pageScale(page)"
                    >
                      <ng-container *ngTemplateOutlet="invoiceTpl; context: { $implicit: page, copyLabel: copyLabel($index) }"></ng-container>
                    </div>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Off-screen twin used to measure wrapped rows and each page's overhead. -->
          <div class="voucher-measure" aria-hidden="true">
            <div class="voucher-measure-full">
              <ng-container *ngTemplateOutlet="invoiceTpl; context: { $implicit: measurePage(), copyLabel: copyLabel(0) }"></ng-container>
            </div>
            <div class="voucher-measure-cont">
              <ng-container *ngTemplateOutlet="invoiceTpl; context: { $implicit: continuationMeasurePage(), copyLabel: copyLabel(0) }"></ng-container>
            </div>
          </div>

        </div>

      </div>

    </div>

    <!-- Voucher Settings Modal (Triggerable from inside drawer or Sales page) -->
    @if (isSettingsOpen()) {
      <app-voucher-settings-modal (closeModal)="isSettingsOpen.set(false)" />
    }

  `
})
export class InvoiceModal implements OnInit, AfterViewChecked, OnDestroy {
  dataService = inject(DataService);
  readonly prefs = inject(PreferencesService);
  private notify = inject(NotificationService);
  private host = inject(ElementRef<HTMLElement>);

  sale = input.required<Sale>();
  closeModal = output<void>();
  viewMode = input(false);

  currentSale = signal<Sale>({} as Sale);

  /** Stored region names are English; the voucher prints them in the reader's language. */
  readonly saleAddress = computed(() => localizeAddress(this.currentSale().address, this.prefs.language()));

  // Global Voucher Settings from DataService
  readonly settings = this.dataService.voucherSettings;

  isSettingsOpen = signal<boolean>(false);
  downloadOpen = signal<boolean>(false);
  exporting = signal<boolean>(false);

  readonly downloadOptions: { kind: 'pdf' | 'jpg' | 'png' | 'html'; icon: string; iconClass: string; bn: string; en: string; hintBn: string; hintEn: string }[] = [
    { kind: 'pdf', icon: 'picture_as_pdf', iconClass: 'text-rose-500', bn: 'PDF ডকুমেন্ট', en: 'PDF document', hintBn: 'প্রিন্ট-রেডি, সবচেয়ে ভালো', hintEn: 'Print-ready, best quality' },
    { kind: 'jpg', icon: 'image', iconClass: 'text-teal-500', bn: 'JPG ছবি', en: 'JPG image', hintBn: 'হোয়াটসঅ্যাপে পাঠানোর জন্য', hintEn: 'For sending on WhatsApp' },
    { kind: 'png', icon: 'photo', iconClass: 'text-indigo-500', bn: 'PNG ছবি', en: 'PNG image', hintBn: 'সবচেয়ে পরিষ্কার ছবি', hintEn: 'Crisp lossless image' },
    { kind: 'html', icon: 'code', iconClass: 'text-amber-600', bn: 'HTML ফাইল', en: 'HTML file', hintBn: 'ব্রাউজারে খোলার জন্য', hintEn: 'Opens in any browser' }
  ];

  readonly sheet = computed(() => resolveVoucherSheet(this.settings()));
  readonly copies = computed(() => Array.from({ length: this.sheet().copies }, (_, index) => index));
  private readonly paperRefs = viewChildren<ElementRef<HTMLElement>>('voucherPaper');
  readonly sharePapers = computed(() => this.paperRefs().map(ref => ref.nativeElement));
  readonly copyHeight = signal(1000);
  readonly pageHeights = signal<number[]>([]);
  private readonly invoiceMetrics = signal<InvoiceMetrics | null>(null);

  readonly measurePage = computed<InvoicePagePlan>(() => ({
    index: -1,
    items: this.salesPaymentItems(),
    firstIndex: 0,
    continuation: false,
    tail: true,
    pageNo: 1,
    pageCount: 1,
    measure: true
  }));

  readonly continuationMeasurePage = computed<InvoicePagePlan>(() => ({
    index: -1,
    items: [],
    firstIndex: 0,
    continuation: true,
    tail: false,
    pageNo: 1,
    pageCount: 1,
    measure: true
  }));

  readonly pages = computed<InvoicePagePlan[]>(() => {
    const items = this.salesPaymentItems();
    const metrics = this.invoiceMetrics();
    const sizes = metrics && items.length
      ? planInvoicePages(metrics.rows, this.sheet().designH, metrics.firstHead, metrics.nextHead, metrics.tail)
      : [items.length];
    let cursor = 0;
    return sizes.map((size, index) => {
      const last = index === sizes.length - 1;
      const page: InvoicePagePlan = {
        index,
        items: items.slice(cursor, cursor + size),
        firstIndex: cursor,
        continuation: index > 0,
        tail: last,
        pageNo: index + 1,
        pageCount: sizes.length
      };
      cursor += size;
      return page;
      return page;
    });
  });

  private readonly viewportWidth = signal(typeof window === 'undefined' ? 1200 : window.innerWidth);
  readonly previewScale = computed(() => {
    const available = Math.max(1, Math.min(848, this.viewportWidth() - 48));
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
    const measure = this.host.nativeElement.querySelector('.voucher-measure .sp-invoice') as HTMLElement | null;
    if (!measure) return;
    if (this.observedCopy !== measure) {
      this.observedCopy = measure;
      this.resizeObserver ??= new ResizeObserver(() => this.measureLayout());
      this.resizeObserver.disconnect();
      this.resizeObserver.observe(measure);
    }
    this.measureLayout();
    this.watchMeasureAssets();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }

  private readonly watchedAssets = new WeakSet<HTMLImageElement>();
  private fontsWatched = false;

  /**
   * The twin holds the signature/QR images, whose height only lands after the
   * bitmap decodes. Re-measure then, otherwise the tail is undercounted and the
   * closing block overflows its sheet.
   */
  private watchMeasureAssets() {
    const root = this.host.nativeElement.querySelector('.voucher-measure') as HTMLElement | null;
    if (!root) return;
    if (!this.fontsWatched && typeof document !== 'undefined' && document.fonts) {
      this.fontsWatched = true;
      document.fonts.ready.then(() => this.measureLayout()).catch(() => undefined);
    }
    root.querySelectorAll<HTMLImageElement>('img').forEach(img => {
      if (img.complete || this.watchedAssets.has(img)) return;
      this.watchedAssets.add(img);
      img.addEventListener('load', () => this.measureLayout(), { once: true });
      img.addEventListener('error', () => this.measureLayout(), { once: true });
    });
  }

  private measureLayout() {
    this.measurePageHeights();
    this.measureInvoiceMetrics();
  }

  private measurePageHeights() {
    const host = this.host.nativeElement as HTMLElement;
    const copies = Array.from(host.querySelectorAll<HTMLElement>('.voucher-print-paper .printable-area'));
    if (!copies.length) return;
    const heights = copies.map(el => el.offsetHeight);
    if (heights.some(height => height <= 0)) return;
    this.copyHeight.set(heights[0]);
    const previous = this.pageHeights();
    if (heights.length === previous.length && heights.every((height, index) => Math.abs(height - previous[index]) <= 1)) return;
    this.pageHeights.set(heights);
  }

  /**
   * Measures the off-screen twin that always holds every row plus the closing
   * tail, so page splits stay exact even when the visible preview is split up.
   */
  private measureInvoiceMetrics() {
    const root = this.host.nativeElement.querySelector('.voucher-measure') as HTMLElement | null;
    const invoice = root?.querySelector<HTMLElement>('.voucher-measure-full .sp-invoice');
    const body = invoice?.querySelector<HTMLElement>('.sp-items tbody');
    if (!root || !invoice || !body) return;
    const invoiceRect = invoice.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const rows = Array.from(body.querySelectorAll<HTMLElement>('tr')).map(tr => tr.getBoundingClientRect().height);
    if (!rows.length || rows.some(height => height <= 0)) return;
    const firstHead = Math.ceil(bodyRect.top - invoiceRect.top);
    const tail = Math.ceil(invoiceRect.bottom - bodyRect.bottom);
    let nextHead = firstHead;
    const contInvoice = root.querySelector<HTMLElement>('.voucher-measure-cont .sp-invoice');
    const contBody = contInvoice?.querySelector<HTMLElement>('.sp-items tbody');
    if (contInvoice && contBody) {
      nextHead = Math.ceil(contBody.getBoundingClientRect().top - contInvoice.getBoundingClientRect().top);
    }
    const previous = this.invoiceMetrics();
    const unchanged = previous
      && previous.rows.length === rows.length
      && rows.every((height, index) => Math.abs(height - previous.rows[index]) <= 0.5)
      && Math.abs(firstHead - previous.firstHead) <= 1
      && Math.abs(nextHead - previous.nextHead) <= 1
      && Math.abs(tail - previous.tail) <= 1;
    if (!unchanged) this.invoiceMetrics.set({ rows, firstHead, nextHead, tail });
  }

  pageHeight(page: InvoicePagePlan): number {
    // Every sheet of a multi-sheet invoice is planned to fill exactly one design
    // page; honouring a stale measured height would scale the sheets differently
    // and make the same table rows render at different sizes.
    if (page.pageCount > 1) return Math.max(this.copyHeight(), this.sheet().designH);
    const measured = this.pageHeights()[page.index];
    return measured && measured > 0 ? measured : Math.max(this.copyHeight(), this.sheet().designH);
  }

  pageScale(page: InvoicePagePlan): number {
    if (page.measure) return 1;
    const sheet = this.sheet();
    return Math.min(1, sheet.cellW / sheet.designW, sheet.cellH / Math.max(1, this.pageHeight(page)));
  }

  readonly fontStack = () => {
    const family = this.settings().fontFamily || 'Kalpurush';
    return `Calibri, '${family}', 'Bangla Voucher', sans-serif`;
  };

  readonly showQR = computed(() => {
    const s = this.settings();
    if (!s.showQRCode) return false;
    return s.qrMode === 'text' ? !!this.currentSale().invoice : !!this.currentSale().shareKey;
  });

  /** Sale's own mobile first, then the linked party's phone by name. */
  readonly customerMobile = computed(() => {
    const sale = this.currentSale();
    const direct = (sale.mobile || '').trim();
    if (direct) return direct;
    const name = (sale.customerName || '').trim().toLowerCase();
    const party = name ? this.dataService.parties().find(p => (p.name || '').trim().toLowerCase() === name) : undefined;
    return (party?.phone || '').trim();
  });

  readonly qrUrl = computed(() => {
    const sale = this.currentSale();
    const settings = this.settings();
    if (typeof window === 'undefined') return '';
    if (settings.qrMode === 'text') return qrDataUrl(saleQrText(sale, settings), 360, 'L');
    const key = sale.shareKey ?? '';
    if (!key) return '';
    return qrDataUrl(`${window.location.origin}/v/sale/${encodeURIComponent(key)}`, 360);
  });

  readonly salesPaymentItems = computed(() => this.currentSale().items ?? []);

  readonly salesPaymentNetBill = computed(() => {
    return round2(this.salesPaymentItems().reduce((acc, it) => acc + (it.total || 0), 0));
  });

  itemName(item: SaleItem): string {
    return saleItemDisplayName(item, this.dataService.products());
  }

  /** Item code, brand and serial printed small under the description. */
  itemMeta(item: SaleItem): string {
    const product = findProductForLine(this.dataService.products(), item);
    const parts: string[] = [];
    if (product?.code) parts.push(`${this.prefs.txt('কোড', 'Code')}: ${product.code}`);
    if (product?.brand) parts.push(`${this.prefs.txt('ব্র্যান্ড', 'Brand')}: ${product.brand}`);
    if (item.serialNumber) parts.push(`S/N: ${item.serialNumber}`);
    return parts.join(' · ');
  }

  /** Customer / Office / Accounts / Transport copy name for multi-copy sheets. */
  copyLabel(index: number): string {
    if (!this.settings().showCopyLabels) return '';
    const labels = [
      this.prefs.txt('গ্রাহক কপি', 'Customer Copy'),
      this.prefs.txt('অফিস কপি', 'Office Copy'),
      this.prefs.txt('হিসাব কপি', 'Accounts Copy'),
      this.prefs.txt('পরিবহন কপি', 'Transport Copy')
    ];
    return labels[Math.min(Math.max(index, 0), labels.length - 1)];
  }

  lineDiscount(item: SaleItem): number {
    return Math.max(0, round2((item.quantity || 0) * (item.salesPrice || 0) - (item.total || 0)));
  }

  /** "= ২৪ পিস" under a line sold in an extra unit (১ ডজন = ১২ পিস, ১ কেজি = ১০০০ গ্রাম). */
  lineBaseQtyNote(item: SaleItem): string {
    const factor = Number(item.unitFactor) || 1;
    if (factor === 1) return '';
    const product = this.dataService.products().find(p =>
      item.productId != null ? p.id === item.productId : p.name === item.productName);
    const base = product?.unit || '';
    const quantity = Math.round((Number(item.quantity) || 0) * factor * 100) / 100;
    return base ? `= ${quantity} ${base}` : `= ${quantity}`;
  }

  formatVoucherDate(value?: string): string {
    if (!value) return '';
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
    return value;
  }

  readonly salesPaymentOldBatteries = computed(() => {
    return (this.currentSale().batteryAdjustments ?? []).filter(bat => (bat.total || 0) > 0);
  });

  readonly salesPaymentTotalBattery = computed(() => {
    return round2(this.salesPaymentOldBatteries().reduce((acc, it) => acc + (it.total || 0), 0));
  });

  readonly salesPaymentReturnItems = computed(() => this.currentSale().returns ?? []);

  readonly salesPaymentTotalReturn = computed(() => {
    return round2(this.salesPaymentReturnItems().reduce((acc, it) => acc + (it.amount || 0), 0));
  });

  readonly warrantyForVoucher = computed(() => {
    const w = this.currentSale().warranty;
    if (!w) return null;
    // The status always holds a value, so it cannot decide whether the block is
    // worth printing — only real claim details do.
    const hasContent = [
      w.claimNo, w.originalInvoice, w.battery, w.oldSerial, w.newSerial,
      w.receiptNo, w.deliveryNo, w.replacementProductName
    ].some(v => String(v ?? '').trim() !== '');
    return hasContent ? w : null;
  });

  warrantyStatusText(status: string): string {
    if (isWarrantyCompleted(status)) return this.prefs.txt('পরিবর্তন সম্পন্ন', 'Replaced');
    if (isWarrantyCancelled(status)) return this.prefs.txt('বাতিল', 'Cancelled');
    return this.prefs.txt('প্রক্রিয়াধীন', 'In progress');
  }

  readonly hasSalesPaymentDetailBlocks = computed(() => {
    return this.salesPaymentOldBatteries().length > 0
      || this.salesPaymentReturnItems().length > 0
      || this.warrantyForVoucher() !== null;
  });

  readonly salesPaymentSummary = computed(() => {
    const s = this.currentSale();
    const currentNetBill = this.salesPaymentNetBill();
    const previousBalance = s.previousDue ?? 0;
    const orderDiscount = round2(s.orderDiscount ?? 0);
    const taxAmount = round2(s.taxAmount ?? 0);
    const damageAmount = round2(s.damageAmount ?? 0);
    const transportLabour = s.shipping ?? 0;
    const warrantyTransport = s.warrantyTransport ?? 0;
    const totalVoucherBill = round2(currentNetBill - orderDiscount + taxAmount + damageAmount + transportLabour + warrantyTransport);
    const totalPayable = round2(previousBalance + totalVoucherBill);

    const bankPayment = s.bankPayment ?? 0;
    const cashReceived = s.cashReceived ?? Math.max(0, round2((s.paid ?? 0) - bankPayment));
    const oldBatteryCredit = this.salesPaymentTotalBattery();
    const returnedGoodsCredit = this.salesPaymentTotalReturn();
    const totalPaymentsCredits = round2(cashReceived + bankPayment + oldBatteryCredit + returnedGoodsCredit);
    const finalBalance = round2(totalPayable - totalPaymentsCredits);

    return {
      previousBalance,
      currentNetBill,
      orderDiscount,
      taxAmount,
      damageAmount,
      transportLabour,
      warrantyTransport,
      totalVoucherBill,
      totalPayable,
      cashReceived,
      bankPayment,
      oldBatteryCredit,
      returnedGoodsCredit,
      totalPaymentsCredits,
      finalBalance,
      balanceLabel: finalBalance < 0 ? 'CUSTOMER ADVANCE' : (finalBalance === 0 ? 'PAID IN FULL' : 'FINAL DUE BALANCE'),
      balanceAmount: Math.abs(finalBalance)
    };
  });

  /** PAID / DUE / ADVANCE stamp from the final voucher balance. */
  readonly paymentStamp = computed(() => {
    const balance = this.salesPaymentSummary().finalBalance;
    if (balance > 0.004) return { text: this.prefs.txt('বাকি', 'DUE'), tone: 'due' as const };
    if (balance < -0.004) return { text: this.prefs.txt('অগ্রিম', 'ADVANCE'), tone: 'advance' as const };
    return { text: this.prefs.txt('পরিশোধিত', 'PAID'), tone: 'paid' as const };
  });

  readonly cancelled = computed(() => this.currentSale().status === 'Cancelled');

  ngOnInit() {
    this.currentSale.set({ ...this.sale() });
  }

  readonly totalItemsQuantity = computed(() => {
    return this.salesPaymentItems().reduce((acc, item) => acc + (item.quantity || 0), 0);
  });

  readonly rawItemsSubtotal = computed(() => {
    return round2(this.salesPaymentItems().reduce((acc, item) => acc + (item.quantity || 0) * (item.salesPrice || 0), 0));
  });

  readonly calculatedDiscount = computed(() => {
    return Math.max(0, round2(this.rawItemsSubtotal() - this.salesPaymentNetBill()));
  });

  readonly totalBatteryAdjustment = computed(() => this.salesPaymentTotalBattery());

  readonly calculatedNetTotal = computed(() => {
    const total = this.currentSale().total;
    return typeof total === 'number' ? round2(total) : this.salesPaymentNetBill();
  });

  readonly calculatedPaidAmount = computed(() => {
    return this.currentSale().paid || 0;
  });

  readonly calculatedDueAmount = computed(() => {
    const due = this.currentSale().due;
    if (typeof due === 'number') return Math.max(0, round2(due));
    return Math.max(0, round2(this.calculatedNetTotal() - this.calculatedPaidAmount()));
  });

  readonly previousDue = computed(() => {
    return this.currentSale().previousDue ?? 0;
  });

  readonly totalDueIncludingPrevious = computed(() => {
    return Math.round((this.previousDue() + this.calculatedDueAmount()) * 100) / 100;
  });

  readonly inWords = computed(() => {
    return takaInWords(this.calculatedNetTotal(), this.prefs.language());
  });

  readonly shareMessage = computed(() => {
    const sale = this.currentSale();
    const lines = [
      `${this.settings().businessNamePart1} ${this.settings().businessNamePart2}`.trim(),
      `${this.prefs.txt('ইনভয়েস', 'Invoice')}: ${sale.invoice}`,
      `${this.prefs.txt('মোট', 'Total')}: ${this.calculatedNetTotal().toFixed(2)} TK`,
    ];
    const due = this.totalDueIncludingPrevious();
    if (due > 0) lines.push(`${this.prefs.txt('বাকি', 'Due')}: ${due.toFixed(2)} TK`);
    return lines.join('\n');
  });

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

  toggleDownload() {
    if (this.exporting()) return;
    this.downloadOpen.update(open => !open);
  }

  pickDownload(kind: 'pdf' | 'jpg' | 'png' | 'html') {
    this.downloadOpen.set(false);
    this.exportAs(kind);
  }

  exportAs(kind: 'html' | 'pdf' | 'jpg' | 'png') {
    const runner = { html: downloadVoucherHtml, pdf: downloadVoucherPdf, jpg: downloadVoucherJpg, png: downloadVoucherPng }[kind];
    this.runVoucherJob(runner, `${kind.toUpperCase()} ফাইল তৈরি করা যায়নি।`, `${kind.toUpperCase()} export failed`);
  }

  private runVoucherJob(runner: (target: VoucherPrintTarget) => Promise<void | number>, messageBn: string, messageEn: string) {
    const host = this.host.nativeElement as HTMLElement;
    const paperEls = Array.from(host.querySelectorAll('.voucher-print-paper')) as HTMLElement[];
    if (!paperEls.length) return;
    const invoice = this.currentSale().invoice;
    this.exporting.set(true);
    runner({ paperEl: paperEls[0], paperEls, sheet: this.sheet(), fileName: `Invoice_${invoice}`, title: `Sales Invoice ${invoice}` })
      .then(saved => {
        if (typeof saved === 'number' && saved > 1) {
          this.notify.info(this.prefs.txt(
            `${saved}টি পেজের ছবি ডাউনলোড হচ্ছে — ব্রাউজার একাধিক ফাইল অনুমতি চাইলে Allow চাপুন।`,
            `${saved} page images are downloading — allow multiple downloads if the browser asks.`
          ));
        }
      })
      .catch(err => {
        console.error(messageEn, err);
        this.notify.error(this.prefs.txt(messageBn, messageEn), messageEn);
      })
      .finally(() => this.exporting.set(false));
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
