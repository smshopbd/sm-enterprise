import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { BatteryVoucher, DataService } from '../../services/data';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { dmyFromIso } from '../../utils/local-date';
import { QtyPipe } from '../../utils/quantity';
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
  selector: 'app-battery-voucher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, VoucherSettingsModal, QtyPipe],
  styles: [`
    @font-face { font-family: 'Bangla Voucher'; src: url('/assets/fonts/bangla.ttf') format('truetype'); font-display: swap; }
    .bv-sheet { position: relative; background: #fff; box-sizing: border-box; margin: 0 auto; display: flex; flex-direction: column; font: 12px/1.4 Calibri, 'Kalpurush', 'Bangla Voucher', sans-serif; color: #17252c; }
    .bv-sheet *, .bv-sheet *::before, .bv-sheet *::after { box-sizing: border-box; }
    .bv-sheet h1 { font-size: 24px; line-height: 1.2; margin: 0; color: var(--v-accent, #087d6c); font-weight: 700; }
    .bv-header { display: flex; justify-content: space-between; gap: 12px; border-bottom: 3px solid var(--v-accent, #087d6c); padding-bottom: 8px; }
    .bv-brand { display: flex; align-items: center; gap: 10px; }
    .bv-logo { position: relative; overflow: hidden; width: 64px; height: 53px; flex: 0 0 64px; }
    .bv-logo img { position: absolute; width: 430.08px; max-width: none; left: -36.4px; top: -25.2px; }
    .bv-muted { color: #596770; font-size: 10.5px; margin: 3px 0; }
    .bv-right { text-align: right; }
    .bv-title { text-align: center; margin: 12px 0; }
    .bv-title span { display: inline-block; background: var(--v-accent, #087d6c); color: #fff; font-weight: 700; font-size: 14px; padding: 5px 18px; border-radius: 4px; letter-spacing: .03em; }
    .bv-meta { display: flex; justify-content: space-between; gap: 12px; border: 1px solid #cbd5d5; padding: 8px 12px; font-size: 11.5px; margin-bottom: 10px; }
    .bv-meta b { font-weight: 700; }
    .bv-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .bv-table th, .bv-table td { padding: 6px 8px; border: 1px solid #cbd5d5; text-align: left; }
    .bv-table th { background: #edf4f2; font-size: 10.5px; font-weight: 700; }
    .bv-num { text-align: right !important; white-space: nowrap; }
    .bv-sum td { background: #f3f7f6; font-weight: 700; }
    .bv-split { display: flex; gap: 14px; margin-top: 14px; align-items: flex-start; }
    .bv-notes { flex: 1; border: 1px solid #cbd5d5; padding: 8px; font-size: 11px; white-space: pre-line; min-height: 90px; }
    .bv-account { width: 46%; border: 1px solid #cbd5d5; }
    .bv-account td { padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #e2e8e8; }
    .bv-account td:first-child { width: 62%; }
    .bv-account .bv-final td { background: var(--v-accent, #087d6c); color: #fff; font-weight: 700; font-size: 12px; }
    .bv-profit td { color: #087d6c; font-weight: 700; }
    .bv-sign { display: flex; justify-content: space-between; align-items: flex-end; margin-top: auto; padding-top: 60px; font-size: 11px; }
    .bv-sign > span { border-top: 1px solid #849295; padding: 6px 18px; }
    .bv-sign-approve { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
    .bv-sign-img { max-height: 44px; max-width: 160px; object-fit: contain; margin-bottom: 5px; filter: grayscale(1); }
    .bv-footer { border-top: 1px solid #cbd5d5; margin-top: 10px; padding-top: 5px; font-size: 10px; color: #596770; text-align: center; }
    .voucher-print-scaler { margin: 0 auto; }
    .voucher-print-paper { background: #fff; display: grid; box-sizing: border-box; overflow: hidden; transform-origin: top left; box-shadow: 0 14px 34px rgba(15,23,42,.2); }
    .voucher-print-paper.sheet-multi .voucher-cell { outline: 1px dashed #cbd5e1; outline-offset: -1px; }
    .voucher-cell { position: relative; display: flex; justify-content: center; align-items: flex-start; overflow: hidden; min-width: 0; min-height: 0; background: #fff; }
    .voucher-copy-box { position: relative; overflow: hidden; flex: 0 0 auto; }
    .voucher-copy-box > .printable-area { transform-origin: top left; max-width: none !important; margin: 0 !important; }
    @media screen and (max-width: 767px) {
      .bv-sheet { padding: 16px; font-size: 10px; }
      .bv-logo { width: 48px; height: 40px; flex: 0 0 48px; }
      .bv-logo img { width: 325px; left: -27.5px; top: -19px; }
    }
  `],
  template: `
    @if (voucher(); as v) {
      <div class="fixed inset-0 z-50 flex justify-end no-print">
        <div (click)="close.emit()" class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs"></div>
        <div class="relative w-full max-w-4xl h-full bg-slate-100 shadow-2xl flex flex-col z-10 overflow-hidden border-l border-slate-300">
          <div class="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div class="flex items-center gap-2">
              <button (click)="close.emit()" class="text-slate-500 hover:text-slate-800 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer" [title]="prefs.txt('বন্ধ করুন', 'Close')">
                <mat-icon>close</mat-icon>
              </button>
              <span class="font-extrabold text-sm text-slate-800 font-mono">{{ typeLabel() }} · {{ v.voucherNo }}</span>
            </div>
            <div class="flex items-center gap-2 text-xs">
              @if (canEdit()) {
                <button (click)="edit.emit()" class="bg-amber-500 hover:bg-amber-600 text-white font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                  <mat-icon class="text-xs">edit_note</mat-icon> {{ prefs.txt('এডিট', 'Edit') }}
                </button>
              }
              <button (click)="isSettingsOpen.set(true)" class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-xs">tune</mat-icon> {{ prefs.txt('সেটিংস', 'Settings') }}
              </button>
              <div class="relative group">
                <button class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                  <mat-icon class="text-xs">download</mat-icon> {{ prefs.txt('ডাউনলোড', 'Download') }}
                </button>
                <div class="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl hidden group-hover:block group-focus-within:block z-50 overflow-hidden">
                  <button (click)="exportAs('html')" class="w-full px-4 py-2 text-left hover:bg-blue-50 text-slate-700 flex items-center gap-2"><mat-icon class="text-amber-600 text-sm">code</mat-icon> HTML</button>
                  <button (click)="exportAs('pdf')" class="w-full px-4 py-2 text-left hover:bg-blue-50 text-slate-700 flex items-center gap-2 border-t border-slate-100"><mat-icon class="text-rose-500 text-sm">picture_as_pdf</mat-icon> PDF</button>
                  <button (click)="exportAs('jpg')" class="w-full px-4 py-2 text-left hover:bg-blue-50 text-slate-700 flex items-center gap-2 border-t border-slate-100"><mat-icon class="text-teal-500 text-sm">image</mat-icon> JPG</button>
                  <button (click)="exportAs('png')" class="w-full px-4 py-2 text-left hover:bg-blue-50 text-slate-700 flex items-center gap-2 border-t border-slate-100"><mat-icon class="text-indigo-500 text-sm">photo</mat-icon> PNG</button>
                </div>
              </div>
              <select [ngModel]="layoutPreset()" (ngModelChange)="setLayoutPreset($event)" class="bg-white border border-slate-300 text-slate-700 text-[11px] font-bold rounded-lg px-2 py-1.5 cursor-pointer">
                @for (option of layoutOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
              </select>
              <button (click)="onPrint()" class="bg-purple-600 hover:bg-purple-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-xs">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-4 sm:p-5">
            <div class="voucher-print-scaler" [style.width.px]="sheet().sheetW * previewScale()" [style.height.px]="sheet().sheetH * previewScale()">
              <div class="voucher-print-paper" [class.sheet-multi]="sheet().copies > 1"
                [style.width.px]="sheet().sheetW" [style.height.px]="sheet().sheetH"
                [style.padding.px]="sheet().pad" [style.gap.px]="sheet().gap"
                [style.grid-template-columns]="'repeat(' + sheet().cols + ', minmax(0, 1fr))'"
                [style.grid-template-rows]="'repeat(' + sheet().rows + ', minmax(0, 1fr))'"
                [style.transform]="'scale(' + previewScale() + ')'">
                @for (copy of copies(); track $index) {
                  <div class="voucher-cell">
                    <div class="voucher-copy-box" [style.width.px]="sheet().designW * copyScale()" [style.height.px]="copyHeight() * copyScale()">
                      <div class="bv-sheet printable-area" [style.width.px]="sheet().designW" [style.min-height.px]="sheet().designH" [style.padding.px]="sheet().margin"
                        [style.transform]="'scale(' + copyScale() + ')'" [style.--v-accent]="settings().accentColor" [style.font-family]="fontStack()">
                        <div class="bv-header">
                          <div>
                            <div class="bv-brand">
                              @if (settings().showLogo) {
                                <div class="bv-logo">
                                  <img src="assets/sm-logo.jpg" alt="SM logo" />
                                </div>
                              }
                              <h1>{{ settings().businessNamePart1 }} {{ settings().businessNamePart2 }}</h1>
                            </div>
                            <p class="bv-muted">{{ settings().address }}</p>
                            @if (settings().mobile) { <p class="bv-muted">{{ prefs.txt('মোবাইল', 'Mobile') }}: {{ settings().mobile }}</p> }
                          </div>
                          <div class="bv-right">
                            <p class="bv-muted">{{ prefs.txt('ভাউচার নং', 'Voucher No') }}</p>
                            <b style="font-size:15px">{{ v.voucherNo }}</b>
                            <p class="bv-muted">{{ prefs.txt('তারিখ', 'Date') }}: {{ fmtDate(v.date) }}</p>
                          </div>
                        </div>

                        <div class="bv-title"><span>{{ typeLabel() }}</span></div>

                        <div class="bv-meta">
                          <div>
                            <p class="bv-muted">{{ v.type === 'purchase' ? prefs.txt('বিক্রেতার নাম', 'Seller') : prefs.txt('গ্রাহকের নাম', 'Customer') }}</p>
                            <b>{{ v.partyName || '—' }}</b>
                            <p class="bv-muted">{{ prefs.txt('মোবাইল', 'Mobile') }}: {{ partyPhone() || '—' }}</p>
                          </div>
                          @if (v.type !== 'exchange') {
                            <div>
                              <p class="bv-muted">{{ prefs.txt('লট / রেফারেন্স', 'Lot / Reference') }}</p>
                              <b>{{ v.lot || '—' }}</b>
                            </div>
                          }
                          <div>
                            <p class="bv-muted">{{ prefs.txt('প্রস্তুতকারী', 'Prepared by') }}</p>
                            <b>{{ v.preparedBy }}</b>
                          </div>
                        </div>

                        @if (v.type === 'exchange') {
                          <table class="bv-table">
                            <thead>
                              <tr>
                                <th>{{ prefs.txt('বিবরণ', 'Description') }}</th>
                                <th>{{ prefs.txt('লট / সিরিয়াল', 'Lot / Serial') }}</th>
                                <th class="bv-num">{{ prefs.txt('ওজন (কেজি)', 'Weight (kg)') }}</th>
                                <th>{{ prefs.txt('অবস্থা', 'Condition') }}</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>{{ prefs.txt('প্রাপ্ত ব্যাটারি', 'Received battery') }}</td>
                                <td>{{ v.receivedId || '—' }}</td>
                                <td class="bv-num">{{ v.receivedKg || 0 | qty:'kg' }}</td>
                                <td>{{ v.receivedCondition === 'usable' ? prefs.txt('ব্যবহারযোগ্য', 'Usable') : prefs.txt('স্ক্র্যাপ', 'Scrap') }}</td>
                              </tr>
                              <tr>
                                <td>{{ prefs.txt('দেওয়া ব্যাটারি', 'Given battery') }}</td>
                                <td>{{ v.givenId || '—' }}</td>
                                <td class="bv-num">{{ v.givenKg || 0 | qty:'kg' }}</td>
                                <td>{{ prefs.txt('ব্যবহারযোগ্য', 'Usable') }}</td>
                              </tr>
                            </tbody>
                          </table>
                        } @else {
                          <table class="bv-table">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>{{ prefs.txt('ধরন', 'Kind') }}</th>
                                <th class="bv-num">{{ prefs.txt('পরিমাণ', 'Qty') }}</th>
                                <th class="bv-num">{{ prefs.txt('দর', 'Rate') }}</th>
                                <th class="bv-num">{{ prefs.txt('মোট', 'Amount') }}</th>
                              </tr>
                            </thead>
                            <tbody>
                              @for (line of v.lines; track $index) {
                                <tr>
                                  <td>{{ $index + 1 }}</td>
                                  <td>{{ line.kind }}</td>
                                  <td class="bv-num">{{ line.kg | qty:line.unit }} {{ (line.unit === 'pcs') ? prefs.txt('পিস', 'pcs') : prefs.txt('কেজি', 'kg') }}</td>
                                  <td class="bv-num">{{ line.rate.toFixed(2) }}</td>
                                  <td class="bv-num">{{ (line.kg * line.rate).toFixed(2) }}</td>
                                </tr>
                              }
                              <tr class="bv-sum">
                                <td colspan="2">{{ prefs.txt('মোট', 'Total') }}</td>
                                <td class="bv-num">{{ v.totalKg | qty:totalUnit(v) }}</td>
                                <td></td>
                                <td class="bv-num">{{ v.total.toFixed(2) }}</td>
                              </tr>
                            </tbody>
                          </table>
                        }

                        <div class="bv-split">
                          <div class="bv-notes">
                            <b>{{ prefs.txt('নোট', 'Notes') }}</b>
                            <p>{{ v.notes || '—' }}</p>
                            @if (v.ref) { <p class="bv-muted">{{ prefs.txt('রেফারেন্স', 'Reference') }}: {{ v.ref }}</p> }
                          </div>
                          <table class="bv-account">
                            <tbody>
                              <tr><td>{{ v.type === 'purchase' ? prefs.txt('ক্রয় মূল্য', 'Purchase value') : v.type === 'sale' ? prefs.txt('বিক্রয় মূল্য', 'Sale value') : prefs.txt('বদলি ফি', 'Exchange fee') }}</td><td class="bv-num">{{ v.total.toFixed(2) }}</td></tr>
                              <tr><td>{{ prefs.txt('নগদ', 'Cash') }}</td><td class="bv-num">{{ v.cash.toFixed(2) }}</td></tr>
                              <tr><td>{{ prefs.txt('ব্যাংক', 'Bank') }}</td><td class="bv-num">{{ v.bank.toFixed(2) }}</td></tr>
                              <tr><td>{{ v.mobileType || 'bKash' }}</td><td class="bv-num">{{ v.mobile.toFixed(2) }}</td></tr>
                              <tr class="bv-sum"><td>{{ v.type === 'purchase' ? prefs.txt('মোট প্রদান', 'Total paid') : prefs.txt('মোট প্রাপ্তি', 'Total received') }}</td><td class="bv-num">{{ v.paid.toFixed(2) }}</td></tr>
                              <tr class="bv-final"><td>{{ v.due > 0 ? prefs.txt('বাকি', 'Balance due') : prefs.txt('পরিশোধিত', 'Settled') }}</td><td class="bv-num">{{ v.due.toFixed(2) }}</td></tr>
                              @if (v.type === 'sale') {
                                @if (costIncomplete(v)) {
                                  <tr><td>{{ prefs.txt('লটের খরচ', 'Lot cost') }}</td><td class="bv-num">{{ prefs.txt('ক্রয়খরচ অসম্পূর্ণ', 'Cost incomplete') }}</td></tr>
                                } @else {
                                  <tr><td>{{ prefs.txt('লটের খরচ', 'Lot cost') }}</td><td class="bv-num">{{ costOf(v).toFixed(2) }}</td></tr>
                                  <tr class="bv-profit"><td>{{ prefs.txt('লাভ', 'Profit') }}</td><td class="bv-num">{{ profit().toFixed(2) }}</td></tr>
                                }
                              }
                              @if (v.type === 'exchange') {
                                <tr class="bv-profit"><td>{{ prefs.txt('বদলি আয়', 'Exchange income') }}</td><td class="bv-num">{{ profit().toFixed(2) }}</td></tr>
                              }
                            </tbody>
                          </table>
                        </div>

                        <div class="bv-sign">
                          <span>{{ prefs.txt('গ্রাহক / বিক্রেতার স্বাক্ষর', 'Customer / Seller signature') }}</span>
                          <span class="bv-sign-approve">
                            @if (settings().showSignatureImage && settings().signatureImage) {
                              <img class="bv-sign-img" [src]="settings().signatureImage" alt="Authorized signature" />
                            }
                            {{ settings().signatureTitle }}
                          </span>
                        </div>
                        <div class="bv-footer">{{ settings().businessNamePart1 }} {{ settings().businessNamePart2 }} · {{ prefs.txt('পুরাতন ব্যাটারি ম্যানেজমেন্ট', 'Old Battery Management') }}</div>
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
export class BatteryVoucherComponent implements AfterViewChecked, OnDestroy {
  private dataService = inject(DataService);
  private notify = inject(NotificationService);
  private host = inject(ElementRef<HTMLElement>);
  prefs = inject(PreferencesService);

  voucher = input<BatteryVoucher | null>(null);
  canEdit = input(true);
  close = output<void>();
  edit = output<void>();

  readonly settings = this.dataService.voucherSettings;
  readonly isSettingsOpen = signal(false);
  readonly sheet = computed(() => resolveVoucherSheet(this.settings()));
  readonly copies = computed(() => Array.from({ length: this.sheet().copies }, (_, i) => i));
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
  readonly fontStack = () => {
    const family = this.settings().fontFamily || 'Kalpurush';
    return `'${family}', 'Bangla Voucher', Calibri, sans-serif`;
  };

  readonly typeLabel = computed(() => {
    const type = this.voucher()?.type;
    if (type === 'purchase') return this.prefs.txt('পুরোনো ব্যাটারি ক্রয়', 'Old Battery Purchase');
    if (type === 'sale') return this.prefs.txt('পুরোনো ব্যাটারি কেজিতে/পিস বিক্রি', 'Old Battery Sale (kg/pcs)');
    return this.prefs.txt('ভালো পুরোনো ব্যাটারি বদল', 'Old Battery Exchange');
  });

  fmtDate(value: string): string {
    return dmyFromIso(value) || value;
  }

  /** Summary lines count in pieces only when every line is pieces. */
  totalUnit(v: BatteryVoucher): 'pcs' | 'kg' {
    return v.lines.length && v.lines.every(line => line.unit === 'pcs') ? 'pcs' : 'kg';
  }

  readonly profit = computed(() => {
    const v = this.voucher();
    return v ? this.dataService.batteryVoucherProfit(v) : 0;
  });

  costOf(v: BatteryVoucher): number {
    return this.dataService.batteryVoucherCost(v);
  }

  costIncomplete(v: BatteryVoucher): boolean {
    return this.dataService.batteryVoucherCostIncomplete(v);
  }

  /** Party mobile by linked id, else by name — vouchers store no phone of their own. */
  readonly partyPhone = computed(() => {
    const v = this.voucher();
    if (!v) return '';
    const byId = v.partyId != null ? this.dataService.parties().find(p => p.id === v.partyId) : undefined;
    const name = (v.partyName || '').trim().toLowerCase();
    const party = byId || (name ? this.dataService.parties().find(p => (p.name || '').trim().toLowerCase() === name) : undefined);
    return (party?.phone || '').trim();
  });

  private resizeObserver?: ResizeObserver;
  private observedCopy?: HTMLElement;

  @HostListener('window:resize')
  onWindowResize() { this.viewportWidth.set(window.innerWidth); }

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

  ngOnDestroy() { this.resizeObserver?.disconnect(); }

  private measureCopy() {
    const copy = this.observedCopy;
    if (!copy) return;
    const height = copy.offsetHeight;
    if (height > 0 && Math.abs(height - this.copyHeight()) > 1) this.copyHeight.set(height);
  }

  setLayoutPreset(preset: string) {
    if (preset === 'CUSTOM') { this.isSettingsOpen.set(true); return; }
    this.dataService.updateVoucherSettings(presetSettings(preset as VoucherLayoutPreset));
  }

  onPrint() {
    this.runVoucherJob(printVoucherSheet, 'প্রিন্ট করা যায়নি। আবার চেষ্টা করুন।', 'Print failed');
  }

  exportAs(kind: 'html' | 'pdf' | 'jpg' | 'png') {
    const runner = { html: downloadVoucherHtml, pdf: downloadVoucherPdf, jpg: downloadVoucherJpg, png: downloadVoucherPng }[kind];
    this.runVoucherJob(runner, `${kind.toUpperCase()} ফাইল তৈরি করা যায়নি।`, `${kind.toUpperCase()} export failed`);
  }

  private runVoucherJob(runner: (target: VoucherPrintTarget) => Promise<void | number>, bn: string, en: string) {
    const paperEl = this.host.nativeElement.querySelector('.voucher-print-paper') as HTMLElement | null;
    const v = this.voucher();
    if (!paperEl || !v) return;
    runner({ paperEl, sheet: this.sheet(), fileName: `Battery_${v.voucherNo}`, title: `${this.typeLabel()} ${v.voucherNo}` })
      .catch(err => { console.error(en, err); this.notify.error(bn, en); });
  }
}
