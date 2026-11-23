import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { DataService } from '../../../services/data';
import { PreferencesService } from '../../../services/preferences';
import { NotificationService } from '../../../services/notification';
import { productSearchScore } from '../../../utils/product-search';
import { BarcodeFormat, BARCODE_FORMATS, normalizeSymbology, renderBarcodeSvg } from '../../../utils/barcode-render';
import {
  BARCODE_LABEL_PRESETS,
  BarcodeLabelPreset,
  BarcodeSheetLabel,
  buildBarcodeSheetHtml,
  labelTextSizes,
  pageSlots,
  printBarcodeSheetHtml,
  resolveLabelGrid,
} from '../../../utils/barcode-print';
import { standaloneHeadHtml } from '../../../utils/voucher-print';

interface BarcodeRow {
  key: string;
  name: string;
  code: string;
  price: number;
  symbology: BarcodeFormat;
}

interface PreviewLabel {
  key: string;
  name: string;
  priceText: string;
  text: string;
  svg: SafeHtml | null;
}

@Component({
  selector: 'app-print-barcode',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  styles: `
    .a4-preview { overflow-x: auto; }
    .a4-sheet {
      width: 210mm;
      min-height: 297mm;
      background: #fff;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
    }
    .barcode-label {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.4mm;
      padding: 0.8mm 1.2mm;
      overflow: hidden;
      border: 1px dashed #d6dde6;
      border-radius: 0.8mm;
      text-align: center;
      line-height: 1.1;
      color: #0f172a;
      background: #fff;
    }
    .barcode-label .shop {
      width: 100%;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .barcode-label .name {
      width: 100%;
      font-weight: 700;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .barcode-label .bars { width: 100%; display: flex; align-items: center; justify-content: center; }
    .barcode-label .bars svg { height: 100%; width: auto; max-width: 100%; display: block; }
    .barcode-label .code { font-family: 'Consolas', 'Courier New', monospace; font-weight: 700; letter-spacing: 0.06em; }
    .barcode-label .price { font-weight: 900; color: #0f766e; }
    .barcode-label.no-cut { border-color: transparent; }
    @media (max-width: 900px) { .a4-sheet { zoom: 0.62; } }
    @media (max-width: 560px) { .a4-sheet { zoom: 0.44; } }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800">
      <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">qr_code_scanner</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                <span>{{ prefs.txt('প্রোডাক্ট ম্যানেজার', 'Product Manager') }}</span>
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                <span>{{ prefs.txt('বারকোড', 'Barcode') }}</span>
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('বারকোড লেবেল ও A4 প্রিন্ট', 'Barcode Labels & A4 Print') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('CODE128 · CODE39 · EAN-13 · EAN-8 · UPC-A — A4 লেবেল শিটে স্ক্যানযোগ্য প্রিন্ট।', 'CODE128 · CODE39 · EAN-13 · EAN-8 · UPC-A — scan-ready printing on A4 label sheets.') }}</p>
            </div>
          </div>

          <button (click)="printBarcodes()" [disabled]="printing() || !matchedCount()"
            class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60">
            <mat-icon class="text-sm">{{ printing() ? 'hourglass_top' : 'print' }}</mat-icon>
            {{ printing() ? prefs.txt('শিট তৈরি হচ্ছে…', 'Building sheet…') : prefs.txt('A4 শিট প্রিন্ট', 'Print A4 Sheet') }}
          </button>
        </div>
      </div>

      <div class="no-print space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-slate-200" [title]="prefs.txt('ফিল্টার', 'Filter')"><mat-icon style="font-size:16px;width:16px;height:16px;">filter_alt</mat-icon></span>
          <div class="relative min-w-[180px] flex-1">
            <mat-icon class="absolute left-3 top-2.5 text-sm text-slate-400">search</mat-icon>
            <input type="text" [value]="searchQuery()" (input)="onSearch($event)"
              [placeholder]="prefs.txt('নাম, কোড, ব্র্যান্ড, মডেল বা ভ্যারিয়েন্ট…', 'Name, code, brand, model or variant…')"
              class="h-8 w-full rounded-lg border border-slate-300 py-1.5 pl-9 pr-8 text-xs focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500" />
            @if (searchQuery()) {
              <button (click)="searchQuery.set(''); resetSheet()" class="absolute right-2 top-1.5 cursor-pointer text-slate-400 hover:text-slate-600" [title]="prefs.txt('সার্চ মুছুন', 'Clear search')">
                <mat-icon class="text-sm">close</mat-icon>
              </button>
            }
          </div>
          <select [value]="selectedBrand()" (change)="onBrandChange($event)" [title]="prefs.txt('ব্র্যান্ড অনুযায়ী ফিল্টার', 'Filter by brand')"
            class="h-8 w-[118px] cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-[10.5px] font-semibold text-slate-600 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/15">
            <option value="">{{ prefs.txt('সব ব্র্যান্ড', 'All Brands') }}</option>
            @for (b of dataService.brands(); track b.id) {
              <option [value]="b.name">{{ b.name }}</option>
            }
          </select>
          <select [value]="selectedModel()" (change)="onModelChange($event)" [title]="prefs.txt('মডেল অনুযায়ী ফিল্টার', 'Filter by model')"
            class="h-8 w-[118px] cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-[10.5px] font-semibold text-slate-600 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/15">
            <option value="">{{ prefs.txt('সব মডেল', 'All Models') }}</option>
            @for (m of dataService.productModels(); track m.id) {
              <option [value]="m.name">{{ m.name }}</option>
            }
          </select>
          <select [value]="selectedCategory()" (change)="onCategoryChange($event)" [title]="prefs.txt('ক্যাটাগরি বা সাব ক্যাটাগরি বেছে ফিল্টার করুন', 'Filter by category or sub category')"
            class="h-8 w-[158px] cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-[10.5px] font-semibold text-slate-600 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/15">
            <option value="">{{ prefs.txt('সব ক্যাটাগরি', 'All Categories') }}</option>
            @for (c of categoryFilterTree(); track c.id) {
              <optgroup [label]="c.name">
                <option [value]="'c:' + c.id">{{ c.name }} · {{ prefs.txt('সব', 'All') }}</option>
                @for (sc of c.subs; track sc.id) {
                  <option [value]="'s:' + sc.id">{{ sc.name }}</option>
                }
              </optgroup>
            }
          </select>
          @if (activeFilters() > 0) {
            <button (click)="clearFilters()" class="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-2 text-[10px] font-bold text-rose-600 transition-colors hover:bg-rose-100 cursor-pointer">
              <mat-icon class="text-xs">filter_alt_off</mat-icon> {{ prefs.txt('মুছুন', 'Clear') }} ({{ activeFilters() }})
            </button>
          }
        </div>

        <div class="grid gap-2 border-t border-slate-100 pt-2 md:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          <label class="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {{ prefs.txt('শিট লেআউট', 'Sheet layout') }}
            <select [value]="presetValue()" (change)="onPresetChange($event)"
              class="cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] font-semibold normal-case tracking-normal text-slate-700 focus:border-teal-500 focus:outline-none">
              @for (preset of labelPresets; track preset.value) {
                <option [value]="preset.value">{{ prefs.txt(preset.labelBn, preset.labelEn) }}</option>
              }
            </select>
          </label>

          <label class="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {{ prefs.txt('সিম্বলজি', 'Symbology') }}
            <select [value]="symbology()" (change)="onSymbologyChange($event)"
              class="cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] font-semibold normal-case tracking-normal text-slate-700 focus:border-teal-500 focus:outline-none">
              <option value="auto">{{ prefs.txt('পণ্য অনুযায়ী', 'Per product') }}</option>
              @for (format of barcodeFormats; track format.value) {
                <option [value]="format.value">{{ format.label }}</option>
              }
            </select>
          </label>

          <label class="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {{ prefs.txt('প্রতি পণ্যে কপি', 'Copies per product') }}
            <select [value]="copies()" (change)="onCopiesChange($event)"
              class="cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] font-semibold normal-case tracking-normal text-slate-700 focus:border-teal-500 focus:outline-none">
              @for (count of copyOptions; track count) {
                <option [value]="count">{{ count }}</option>
              }
            </select>
          </label>

          <label class="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-slate-300 px-2 py-2 text-[11px] font-bold text-slate-600">
            <input type="checkbox" [checked]="cutLines()" (change)="cutLines.set($any($event.target).checked)" class="h-3.5 w-3.5 accent-teal-600" />
            {{ prefs.txt('কাটার লাইন', 'Cut lines') }}
          </label>
        </div>
      </div>

      <div class="no-print flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
        <div class="flex flex-wrap items-center gap-2">
          <span>
            {{ prefs.txt(matchedCount() + ' পণ্য · ' + totalLabels() + ' লেবেল · ' + pageCount() + ' পৃষ্ঠা', matchedCount() + ' products · ' + totalLabels() + ' labels · ' + pageCount() + ' pages') }}
          </span>
          @if (missingCodes() > 0) {
            <span class="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              <mat-icon class="text-xs">barcode</mat-icon>
              {{ prefs.txt(missingCodes() + 'টি পণ্যে কোড নেই — ওগুলো বারকোড ছাড়া যাবে', missingCodes() + ' products have no code — they print without bars') }}
            </span>
          }
        </div>

        <div class="flex items-center gap-1">
          <span class="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{{ prefs.txt('শীট', 'Sheet') }}</span>
          <button (click)="goToPage(currentPage() - 1)" [disabled]="currentPage() <= 1" class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40" [title]="prefs.txt('আগের পৃষ্ঠা', 'Previous page')">
            <mat-icon class="text-base">chevron_left</mat-icon>
          </button>
          @for (n of pageNumbers(); track n) {
            <button (click)="goToPage(n)" class="h-7 min-w-7 cursor-pointer rounded-lg px-1.5 text-[11px] font-bold tabular-nums transition-colors" [class]="n === currentPage() ? 'bg-teal-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'">{{ n }}</button>
          }
          <button (click)="goToPage(currentPage() + 1)" [disabled]="currentPage() >= pageCount()" class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40" [title]="prefs.txt('পরের পৃষ্ঠা', 'Next page')">
            <mat-icon class="text-base">chevron_right</mat-icon>
          </button>
          <span class="ml-1 font-mono text-[10px] font-bold tabular-nums text-slate-600">{{ currentPage() }} / {{ pageCount() }}</span>
        </div>
      </div>

      <div class="rounded-xl border border-slate-200 bg-slate-100 p-2 shadow-xs dark:bg-slate-900">
        <div class="a4-preview">
          <div class="a4-sheet mx-auto" data-plain-digits
            [style.display]="'grid'"
            [style.grid-template-columns]="'repeat(' + grid().cols + ', ' + grid().labelW + 'mm)'"
            [style.grid-auto-rows]="grid().labelH + 'mm'"
            [style.column-gap]="grid().gapX + 'mm'"
            [style.row-gap]="grid().gapY + 'mm'"
            [style.padding]="grid().marginY + 'mm ' + grid().marginX + 'mm'"
            [style.align-content]="'start'"
            [style.justify-content]="'start'">
            @for (label of previewLabels(); track label.key) {
              <div class="barcode-label" [class.no-cut]="!cutLines()">
                <p class="shop" [style.font-size]="sizes().shop + 'mm'">{{ shopName() }}</p>
                <p class="name" [style.font-size]="sizes().name + 'mm'">{{ label.name }}</p>
                @if (label.svg) {
                  <div class="bars" [style.height]="sizes().bars + 'mm'" [innerHTML]="label.svg"></div>
                }
                <p class="code" [style.font-size]="sizes().code + 'mm'">{{ label.text }}</p>
                <p class="price" [style.font-size]="sizes().price + 'mm'">{{ label.priceText }} TK</p>
              </div>
            } @empty {
              <p class="col-span-full p-10 text-center font-semibold text-slate-400">{{ prefs.txt('কোনো পণ্য পাওয়া যায়নি।', 'No products found.') }}</p>
            }
          </div>
        </div>
      </div>

      @if (pageCount() > 1) {
        <div class="no-print flex flex-wrap items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-xs">
          <button (click)="goToPage(1)" [disabled]="currentPage() <= 1" class="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40" [title]="prefs.txt('প্রথম পৃষ্ঠা', 'First page')">
            <mat-icon class="text-base">first_page</mat-icon>{{ prefs.txt('প্রথম', 'First') }}
          </button>
          <button (click)="goToPage(currentPage() - 1)" [disabled]="currentPage() <= 1" class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40" [title]="prefs.txt('আগের পৃষ্ঠা', 'Previous page')">
            <mat-icon class="text-base">chevron_left</mat-icon>
          </button>
          @for (n of pageNumbers(); track n) {
            <button (click)="goToPage(n)" class="h-7 min-w-7 cursor-pointer rounded-lg px-1.5 text-[11px] font-bold tabular-nums transition-colors" [class]="n === currentPage() ? 'bg-teal-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'">{{ n }}</button>
          }
          <button (click)="goToPage(currentPage() + 1)" [disabled]="currentPage() >= pageCount()" class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40" [title]="prefs.txt('পরের পৃষ্ঠা', 'Next page')">
            <mat-icon class="text-base">chevron_right</mat-icon>
          </button>
          <button (click)="goToPage(pageCount())" [disabled]="currentPage() >= pageCount()" class="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40" [title]="prefs.txt('শেষ পৃষ্ঠা', 'Last page')">
            {{ prefs.txt('শেষ', 'Last') }}<mat-icon class="text-base">last_page</mat-icon>
          </button>
        </div>
      }
    </div>
  `
})
export class PrintBarcode {
  readonly dataService = inject(DataService);
  readonly prefs = inject(PreferencesService);
  private readonly notify = inject(NotificationService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly copyOptions = [1, 2, 3, 5, 10];
  readonly labelPresets = BARCODE_LABEL_PRESETS;
  readonly barcodeFormats = BARCODE_FORMATS;

  readonly searchQuery = signal('');
  readonly selectedBrand = signal('');
  readonly selectedModel = signal('');
  readonly selectedCategory = signal('');
  readonly copies = signal(1);
  readonly presetValue = signal<BarcodeLabelPreset>('3x8');
  readonly symbology = signal<'auto' | BarcodeFormat>('auto');
  readonly cutLines = signal(true);
  readonly printing = signal(false);
  /** A4 sheet page on screen; printing always covers every page. */
  readonly sheetPage = signal(1);

  readonly grid = computed(() => resolveLabelGrid(this.presetValue()));
  readonly sizes = computed(() => labelTextSizes(this.grid()));
  readonly shopName = computed(() => {
    const settings = this.dataService.voucherSettings();
    return `${settings.businessNamePart1} ${settings.businessNamePart2}`.trim() || 'SM ENTERPRISE';
  });

  /** Categories with their sub-categories, for one grouped filter dropdown. */
  readonly categoryFilterTree = computed(() => {
    const subs = this.dataService.subCategories();
    return this.dataService.categories().map(category => ({
      id: category.id,
      name: category.name,
      subs: subs
        .filter(sc => this.sameCategory(sc.parentCategory, category.name))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    }));
  });

  /** Decoded category/sub-category filter; `c:` = whole category, `s:` = one sub-category. */
  private readonly categoryFilterMatch = computed<{ category: string; subCategory: string }>(() => {
    const value = this.selectedCategory();
    if (value.startsWith('s:')) {
      const sub = this.dataService.subCategories().find(sc => sc.id === Number(value.slice(2)));
      return { category: sub?.parentCategory ?? '', subCategory: sub?.name ?? '' };
    }
    if (value.startsWith('c:')) {
      const category = this.dataService.categories().find(c => c.id === Number(value.slice(2)));
      return { category: category?.name ?? '', subCategory: '' };
    }
    return { category: '', subCategory: '' };
  });

  readonly activeFilters = computed(() =>
    [this.selectedBrand(), this.selectedModel(), this.selectedCategory()].filter(Boolean).length
    + (this.searchQuery().trim() ? 1 : 0));

  private sameCategory(a: string, b: string): boolean {
    return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
  }

  private readonly matchedProducts = computed<BarcodeRow[]>(() => {
    const query = this.searchQuery().trim();
    const brand = this.selectedBrand();
    const model = this.selectedModel();
    const cat = this.categoryFilterMatch();
    const rows: { row: BarcodeRow; score: number; index: number }[] = [];
    let index = 0;
    for (const product of this.dataService.products()) {
      if (brand && product.brand !== brand) continue;
      if (model && product.model !== model) continue;
      if (cat.category && !this.sameCategory(product.category, cat.category)) continue;
      if (cat.subCategory && !this.sameCategory(product.subCategory || '', cat.subCategory)) continue;
      const variants = product.variants || [];
      if (!variants.length) {
        const score = query ? productSearchScore(product, query) : 0;
        if (!query || score > 0) {
          rows.push({
            row: {
              key: `p-${product.id}`,
              name: product.name,
              code: product.code,
              price: product.salesPrice,
              symbology: normalizeSymbology(product.barcodeSymbology),
            },
            score,
            index: index++,
          });
        }
        continue;
      }
      for (const variant of variants) {
        const score = query ? productSearchScore(product, query, variant) : 0;
        if (!query || score > 0) {
          rows.push({
            row: {
              key: `p-${product.id}-v-${variant.id}`,
              name: `${product.name} - ${variant.variantValue}`,
              code: variant.itemCode || product.code,
              price: variant.salesPrice,
              symbology: normalizeSymbology(product.barcodeSymbology),
            },
            score,
            index: index++,
          });
        }
      }
    }
    return rows
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(result => result.row);
  });

  readonly matchedCount = computed(() => this.matchedProducts().length);
  readonly totalLabels = computed(() => this.matchedCount() * this.copies());
  readonly perPage = computed(() => this.grid().cols * this.grid().rows);
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.totalLabels() / this.perPage())));
  readonly currentPage = computed(() => Math.min(Math.max(1, this.sheetPage()), this.pageCount()));
  readonly pageNumbers = computed(() => {
    const total = this.pageCount();
    const cur = this.currentPage();
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    let start = Math.max(1, cur - 3);
    const end = Math.min(total, start + 6);
    start = Math.max(1, end - 6);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });
  readonly missingCodes = computed(() => this.matchedProducts().filter(row => !row.code.trim()).length);

  readonly previewLabels = computed<PreviewLabel[]>(() =>
    pageSlots(this.matchedProducts(), this.copies(), this.perPage(), this.currentPage()).map(({ row, copy }) => {
      const barcode = this.renderFor(row);
      return {
        key: `${row.key}-${copy}`,
        name: row.name,
        priceText: (Number(row.price) || 0).toFixed(2),
        text: barcode?.text ?? row.code,
        svg: barcode ? this.sanitizer.bypassSecurityTrustHtml(barcode.svg) : null,
      };
    }));

  onSearch(event: Event) {
    this.searchQuery.set((event.target as HTMLInputElement).value);
    this.resetSheet();
  }

  onBrandChange(event: Event) {
    this.selectedBrand.set((event.target as HTMLSelectElement).value);
    this.resetSheet();
  }

  onModelChange(event: Event) {
    this.selectedModel.set((event.target as HTMLSelectElement).value);
    this.resetSheet();
  }

  onCategoryChange(event: Event) {
    this.selectedCategory.set((event.target as HTMLSelectElement).value);
    this.resetSheet();
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedBrand.set('');
    this.selectedModel.set('');
    this.selectedCategory.set('');
    this.resetSheet();
  }

  goToPage(page: number) {
    this.sheetPage.set(Math.min(Math.max(1, page), this.pageCount()));
  }

  resetSheet() {
    this.sheetPage.set(1);
  }

  onPresetChange(event: Event) {
    this.presetValue.set((event.target as HTMLSelectElement).value as BarcodeLabelPreset);
    this.resetSheet();
  }

  onSymbologyChange(event: Event) {
    this.symbology.set((event.target as HTMLSelectElement).value as 'auto' | BarcodeFormat);
  }

  onCopiesChange(event: Event) {
    const value = Number((event.target as HTMLSelectElement).value);
    this.copies.set(Number.isFinite(value) && value > 0 ? value : 1);
    this.resetSheet();
  }

  async printBarcodes() {
    const rows = this.matchedProducts();
    if (!rows.length || this.printing()) return;
    this.printing.set(true);
    try {
      const labels: BarcodeSheetLabel[] = [];
      for (const row of rows) {
        const barcode = this.renderFor(row);
        const label: BarcodeSheetLabel = {
          name: row.name,
          codeText: barcode?.text ?? row.code,
          price: row.price,
          svg: barcode?.svg ?? '',
        };
        for (let copy = 0; copy < this.copies(); copy++) labels.push(label);
      }
      const head = await standaloneHeadHtml('');
      const html = buildBarcodeSheetHtml({
        title: `${this.shopName()} — Barcode Labels`,
        shopName: this.shopName(),
        grid: this.grid(),
        cutLines: this.cutLines(),
        labels,
      }, head);
      await printBarcodeSheetHtml(html);
    } catch (error) {
      console.error('[SM Enterprise] barcode print failed', error);
      this.notify.error(
        this.prefs.txt('বারকোড শিট তৈরি করা যায়নি। আবার চেষ্টা করুন।', 'The barcode sheet could not be built. Please try again.'),
        this.prefs.txt('প্রিন্ট ব্যর্থ', 'Print failed')
      );
    } finally {
      this.printing.set(false);
    }
  }

  private renderFor(row: BarcodeRow) {
    const chosen = this.symbology();
    return renderBarcodeSvg(row.code, chosen === 'auto' ? row.symbology : chosen);
  }
}
