import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import * as htmlToImage from 'html-to-image';
import { jsPDF } from 'jspdf';
import { DataService } from '../../services/data';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { localDateIso } from '../../utils/local-date';

/** One party row as printed on the A4 list. */
export interface PartyListRow {
  sl: number;
  name: string;
  company: string;
  roles: string;
  phone: string;
  address: string;
  total: number;
  paid: number;
  due: number;
}

export interface PartyListTotals {
  total: number;
  paid: number;
  due: number;
}

/** Fallback row caps used until the on-screen rows are measured. */
export const A4_LIST_ROWS_FIRST = 30;
/** Rows that fit under the compact header on the following pages. */
export const A4_LIST_ROWS_NEXT = 36;

export function paginatePartyRows(
  rows: readonly PartyListRow[],
  firstCap = A4_LIST_ROWS_FIRST,
  nextCap = A4_LIST_ROWS_NEXT
): PartyListRow[][] {
  if (!rows.length) return [];
  const pages: PartyListRow[][] = [rows.slice(0, firstCap)];
  for (let start = firstCap; start < rows.length; start += nextCap) {
    pages.push(rows.slice(start, start + nextCap));
  }
  return pages;
}

/**
 * Splits measured row heights into pages so wrapped text never spills past the
 * page footer. Returns the number of rows on each page.
 */
export function paginatePartyRowsByHeight(
  heights: readonly number[],
  firstRoom: number,
  nextRoom: number
): number[] {
  if (!heights.length) return [];
  const sizes: number[] = [];
  let index = 0;
  let room = firstRoom;
  while (index < heights.length) {
    let used = 0;
    let count = 0;
    while (index < heights.length) {
      const height = Math.max(1, heights[index]);
      if (count > 0 && used + height > room) break;
      used += height;
      count++;
      index++;
      if (used >= room) break;
    }
    sizes.push(count);
    room = nextRoom;
  }
  return sizes;
}

interface PartyListPage {
  index: number;
  first: boolean;
  last: boolean;
  rows: PartyListRow[];
}

@Component({
  selector: 'app-party-list-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  styles: [`
    /* Contrast tuned for mono laser printers (e.g. Canon LBP 6030): larger type, darker greys, stronger rules. */
    .plt-page { position: relative; width: 794px; height: 1123px; flex: 0 0 auto; padding: 28px 32px 46px; background: #fff; color: #0f172a;
      font: 11.5px/1.35 Calibri, 'Kalpurush', sans-serif; box-sizing: border-box; overflow: hidden; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .plt-page * { box-sizing: border-box; }
    .plt-accent { position: absolute; top: 0; left: 0; right: 0; height: 6px; background: linear-gradient(90deg, var(--plt-accent, #087d6c), #22b8a6); }
    .plt-letterhead { min-height: 92px; padding: 4px 0 6px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 2px solid var(--plt-accent, #087d6c); }
    .plt-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .plt-brand > div { min-width: 0; }
    .plt-logo { position: relative; overflow: hidden; width: 64px; height: 53px; flex: 0 0 64px; }
    .plt-logo img { position: absolute; width: 430.08px; max-width: none; left: -36.4px; top: -25.2px; }
    .plt-brand h1 { margin: 0; font-size: 20px; line-height: 1.15; font-weight: 700; color: var(--plt-accent, #087d6c); overflow-wrap: anywhere; }
    .plt-brand p { margin: 1px 0 0; font-size: 10.5px; font-weight: 600; color: #334155; overflow-wrap: anywhere; }
    .plt-docmeta { text-align: right; flex: 0 0 auto; }
    .plt-docmeta h2 { margin: 0; font-size: 12.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--plt-accent, #087d6c); }
    .plt-docno { margin: 2px 0 0; font: 700 13px/1.2 ui-monospace, monospace; letter-spacing: .03em; color: #0f172a; }
    .plt-docmeta p { margin: 1px 0 0; font-size: 10px; font-weight: 600; color: #334155; }
    .plt-compact { height: 44px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
      border-bottom: 2px solid var(--plt-accent, #087d6c); font-size: 10.5px; font-weight: 600; color: #334155; }
    .plt-compact b { color: var(--plt-accent, #087d6c); font-size: 12px; }
    .plt-compact > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .plt-filters { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
    .plt-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-height: 21px; padding: 1px 8px; border-radius: 999px;
      border: 1px solid #8fa0a6; background: #f5f8f8; font-size: 9.5px; font-weight: 700; color: #334155; white-space: nowrap; }
    .plt-chip b { font-weight: 800; color: #0f172a; min-width: 0; max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
    .plt-chip.on { border-color: #6fae9f; background: #e8f5f1; color: #075e50; }
    .plt-summary { margin-top: 8px; height: 60px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .plt-sum { border: 1px solid #a9b8bc; border-radius: 6px; padding: 5px 10px; background: #fbfcfc; min-width: 0; }
    .plt-sum p { margin: 0; font-size: 9px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #3f4f56; }
    .plt-sum strong { display: inline-block; margin-top: 1px; font: 800 15.5px/1.15 ui-monospace, monospace; color: #0f172a; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .plt-sum em { font-style: normal; font-size: 9px; font-weight: 700; color: #3f4f56; margin-left: 3px; }
    .plt-sum.total { border-color: #8ab5ad; background: #f2fafa; }
    .plt-sum.total strong { color: #075e50; }
    .plt-sum.paid { border-color: #86c6a7; background: #f2fbf6; }
    .plt-sum.paid strong { color: #0b5f3d; }
    .plt-sum.due { border-color: #d9a1a1; background: #fdf5f5; }
    .plt-sum.due strong { color: #9b1c15; }
    .plt-sec { margin-top: 10px; min-height: 22px; display: flex; align-items: center; gap: 8px; font-size: 10px; font-weight: 800;
      letter-spacing: .12em; text-transform: uppercase; color: var(--plt-accent, #087d6c); }
    .plt-sec::before { content: ''; width: 3px; height: 13px; border-radius: 2px; background: var(--plt-accent, #087d6c); }
    .plt-sec::after { content: ''; flex: 1; height: 1px; background: #b6c2c5; }
    .plt-sec .plt-count { order: 2; padding: 0 7px; border-radius: 999px; border: 1px solid #a9b8bc; background: #eef4f3; color: #334155; font-size: 9px; letter-spacing: 0; }
    .plt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    /* Paper-only skin: the app's dark table styles must not bleed into the printable sheet. */
    .plt-page .plt-table tbody tr { background: #fff; }
    .plt-page .plt-table tbody tr:nth-child(even) { background: #f6f8f8; }
    .plt-table thead th { height: 24px; padding: 0 5px; vertical-align: middle; white-space: nowrap; background: #e6edec; border-top: 1px solid #8fa0a6; border-bottom: 1px solid #7d8f95; font-size: 10px; font-weight: 800;
      letter-spacing: .03em; text-transform: uppercase; color: #1f2d33; text-align: left; }
    /* Wrapped cell text: long names/addresses stay complete instead of being ellipsised. */
    .plt-table td { padding: 3px 5px; border-bottom: 1px solid #c8d3d6; font-size: 11px; line-height: 1.25; color: #0f172a; vertical-align: middle; overflow-wrap: anywhere; }
    .plt-table .num { text-align: right; font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; overflow-wrap: normal; }
    .plt-table .ctr { text-align: center; color: #3f4f56; font-size: 10px; font-weight: 700; overflow-wrap: normal; }
    .plt-table .due-pos { color: #9b1c15; font-weight: 800; }
    .plt-table .due-neg { color: #0b5f3d; font-weight: 800; }
    .plt-name b { display: block; font-size: 11px; line-height: 1.15; font-weight: 700; }
    .plt-name span { display: block; font-size: 9px; line-height: 1.15; font-weight: 600; color: #3f4f56; }
    .plt-empty td { height: 60px; text-align: center; color: #3f4f56; font-size: 10.5px; font-style: italic; }
    .plt-foot { position: absolute; left: 32px; right: 32px; bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
      border-top: 1px solid #b6c2c5; padding-top: 5px; font-size: 9.5px; font-weight: 600; color: #3f4f56; }
    .plt-toolbar { position: sticky; top: 0; z-index: 20; }
    .plt-scroll { min-height: 100%; width: max-content; margin: 0 auto; padding: 0 16px 32px; }
    /* Off-screen twin of the table: same fonts/widths, used to measure wrapped row heights. */
    .plt-measure { position: fixed; left: -12000px; top: 0; width: 794px; padding: 0 32px; background: #fff; visibility: hidden; pointer-events: none;
      font: 11.5px/1.35 Calibri, 'Kalpurush', sans-serif; color: #0f172a; }
    @media print {
      .plt-page { break-after: page; }
      .plt-page:last-child { break-after: auto; }
    }
  `],
  template: `
    <div class="fixed inset-0 z-[70] overflow-auto bg-slate-900/75 backdrop-blur-xs">
      <div class="plt-scroll">
        <div class="plt-toolbar mx-auto mb-3 flex max-w-[794px] flex-wrap items-center justify-between gap-2 rounded-xl border border-white/15 bg-slate-900/85 px-3 py-2 text-white shadow-lg">
          <div class="min-w-0">
            <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-200/80">
              <mat-icon class="text-[12px]">groups</mat-icon>
              {{ prefs.txt('ডকুমেন্ট', 'Document') }}
            </p>
            <h2 class="truncate text-sm font-bold leading-tight">{{ prefs.txt('পার্টি তালিকা', 'Party List') }}</h2>
            <p class="truncate text-[10px] text-slate-300">{{ title() }} · {{ rows().length }} {{ prefs.txt('জন', 'parties') }}</p>
          </div>
          <div class="flex items-center gap-1.5">
            <button (click)="downloadPdf()" [disabled]="busy()"
              class="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-teal-400 disabled:cursor-wait disabled:opacity-60">
              <mat-icon class="text-sm">{{ busy() ? 'hourglass_top' : 'picture_as_pdf' }}</mat-icon>
              {{ busy() ? prefs.txt('তৈরি হচ্ছে…', 'Preparing…') : prefs.txt('PDF ডাউনলোড', 'Download PDF') }}
            </button>
            <button (click)="print()" [disabled]="busy()"
              class="flex items-center gap-1 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-white/20 disabled:opacity-60">
              <mat-icon class="text-sm">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
            <button (click)="close.emit()" [attr.aria-label]="prefs.txt('বন্ধ করুন', 'Close')"
              class="flex items-center gap-1 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-white/20">
              <mat-icon class="text-sm">close</mat-icon> {{ prefs.txt('বন্ধ', 'Close') }}
            </button>
          </div>
        </div>

        <div id="plt-root" class="printable-area flex flex-col items-center gap-4">
          @for (page of pages(); track page.index) {
            <section class="plt-page" [style.--plt-accent]="shop().accentColor || '#087d6c'">
              <div class="plt-accent"></div>

              @if (page.first) {
                <div class="plt-letterhead">
                  <div class="plt-brand">
                    @if (shop().showLogo) {
                      <div class="plt-logo"><img src="assets/sm-logo.jpg" alt="logo" /></div>
                    }
                    <div>
                      <h1>{{ shop().businessNamePart1 }} {{ shop().businessNamePart2 }}</h1>
                      <p>{{ shop().address }}</p>
                      <p>{{ shop().mobile }}{{ shop().email ? ' · ' + shop().email : '' }}</p>
                    </div>
                  </div>
                  <div class="plt-docmeta">
                    <h2>{{ prefs.txt('পার্টি তালিকা', 'Party List') }}</h2>
                    <p class="plt-docno">{{ docNo() }}</p>
                    <p>{{ prefs.txt('তৈরি', 'Generated') }}: {{ generatedAt }}</p>
                    <p>{{ scope() }}</p>
                  </div>
                </div>

                <div class="plt-filters">
                  <span class="plt-chip on">{{ prefs.txt('ধরন', 'Type') }}: <b>{{ title() }}</b></span>
                  <span class="plt-chip">{{ prefs.txt('হিসাব', 'Book') }}: <b>{{ scope() }}</b></span>
                  <span class="plt-chip">{{ prefs.txt('সাজানো', 'Sorted') }}: <b>{{ sortText() }}</b></span>
                  @if (search()) {
                    <span class="plt-chip">{{ prefs.txt('সার্চ', 'Search') }}: <b>“{{ search() }}”</b></span>
                  }
                </div>

                <div class="plt-summary">
                  <div class="plt-sum">
                    <p>{{ prefs.txt('মোট পার্টি', 'Total parties') }}</p>
                    <strong>{{ rows().length }}</strong><em>{{ prefs.txt('জন', 'parties') }}</em>
                  </div>
                  <div class="plt-sum total">
                    <p>{{ prefs.txt('মোট হিসাব', 'Total billed') }}</p>
                    <strong>{{ money(totals().total) }}</strong><em>TK</em>
                  </div>
                  <div class="plt-sum paid">
                    <p>{{ prefs.txt('পরিশোধিত', 'Paid') }}</p>
                    <strong>{{ money(totals().paid) }}</strong><em>TK</em>
                  </div>
                  <div class="plt-sum due">
                    <p>{{ dueLabel() }}</p>
                    <strong>{{ money(totals().due) }}</strong><em>TK</em>
                  </div>
                </div>

                <div class="plt-sec">
                  {{ prefs.txt('পার্টি তালিকা', 'Party list') }}
                  <span class="plt-count">{{ rows().length }}</span>
                </div>
              } @else {
                <div class="plt-compact">
                  <span><b>{{ shop().businessNamePart1 }} {{ shop().businessNamePart2 }}</b> · {{ prefs.txt('তালিকা চলমান', 'List continued') }}</span>
                  <span>{{ title() }} · {{ docNo() }}</span>
                </div>
              }

              <table class="plt-table">
                <colgroup>
                  <col style="width: 22px" />
                  <col style="width: 188px" />
                  <col style="width: 82px" />
                  <col style="width: 88px" />
                  <col style="width: 150px" />
                  <col style="width: 68px" />
                  <col style="width: 66px" />
                  <col style="width: 66px" />
                </colgroup>
                <thead>
                  <tr>
                    <th class="ctr">#</th>
                    <th>{{ prefs.txt('নাম', 'Name') }}</th>
                    <th>{{ prefs.txt('ধরন', 'Type') }}</th>
                    <th>{{ prefs.txt('মোবাইল', 'Mobile') }}</th>
                    <th>{{ prefs.txt('ঠিকানা', 'Address') }}</th>
                    <th class="num">{{ prefs.txt('মোট', 'Total') }}</th>
                    <th class="num">{{ prefs.txt('পরিশোধিত', 'Paid') }}</th>
                    <th class="num">{{ dueLabel() }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of page.rows; track row.sl) {
                    <tr>
                      <td class="ctr">{{ row.sl }}</td>
                      <td class="plt-name">
                        <b>{{ row.name }}</b>
                        @if (row.company) { <span>{{ row.company }}</span> }
                      </td>
                      <td>{{ row.roles }}</td>
                      <td>{{ row.phone }}</td>
                      <td>{{ row.address }}</td>
                      <td class="num">{{ money(row.total) }}</td>
                      <td class="num">{{ money(row.paid) }}</td>
                      <td class="num" [class.due-pos]="row.due > 0" [class.due-neg]="row.due < 0">{{ money(row.due) }}</td>
                    </tr>
                  }
                  @if (!page.rows.length) {
                    <tr class="plt-empty">
                      <td colspan="8">{{ prefs.txt('কোনো পার্টি পাওয়া যায়নি।', 'No parties found.') }}</td>
                    </tr>
                  }
                </tbody>
              </table>

              <div class="plt-foot">
                <span>{{ shop().businessNamePart1 }} {{ shop().businessNamePart2 }} · {{ prefs.txt('পার্টি তালিকা', 'Party list') }} · {{ docNo() }}</span>
                <span>{{ prefs.txt('পৃষ্ঠা', 'Page') }} {{ page.index + 1 }} / {{ pages().length }}</span>
              </div>
            </section>
          }
        </div>

        <div id="plt-measure" class="plt-measure" aria-hidden="true">
          <table class="plt-table">
            <colgroup>
              <col style="width: 22px" />
              <col style="width: 188px" />
              <col style="width: 82px" />
              <col style="width: 88px" />
              <col style="width: 150px" />
              <col style="width: 68px" />
              <col style="width: 66px" />
              <col style="width: 66px" />
            </colgroup>
            <tbody>
              @for (row of rows(); track row.sl) {
                <tr>
                  <td class="ctr">{{ row.sl }}</td>
                  <td class="plt-name">
                    <b>{{ row.name }}</b>
                    @if (row.company) { <span>{{ row.company }}</span> }
                  </td>
                  <td>{{ row.roles }}</td>
                  <td>{{ row.phone }}</td>
                  <td>{{ row.address }}</td>
                  <td class="num">{{ money(row.total) }}</td>
                  <td class="num">{{ money(row.paid) }}</td>
                  <td class="num" [class.due-pos]="row.due > 0" [class.due-neg]="row.due < 0">{{ money(row.due) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class PartyListDocument implements OnInit, AfterViewInit {
  private dataService = inject(DataService);
  private notify = inject(NotificationService);
  readonly prefs = inject(PreferencesService);
  private host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly shop = this.dataService.voucherSettings;

  rows = input.required<PartyListRow[]>();
  title = input('');
  scope = input('');
  search = input('');
  dueLabel = input('');
  sortText = input('');
  totals = input.required<PartyListTotals>();
  close = output<void>();

  readonly busy = signal(false);
  private measurePasses = 0;

  readonly docNo = computed(() => `PL-${localDateIso()}`);
  readonly generatedAt = this.formatStamp(new Date());
  readonly fileName = `Party-List-${localDateIso()}`;

  readonly pages = signal<PartyListPage[]>([]);

  ngOnInit(): void {
    this.pages.set(this.fallbackPages());
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.measure(), 0);
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => this.measure()).catch(() => undefined);
    }
  }

  private fallbackPages(): PartyListPage[] {
    const chunks = paginatePartyRows(this.rows());
    const list = chunks.length ? chunks : [[] as PartyListRow[]];
    return list.map((pageRows, index) => ({
      index,
      first: index === 0,
      last: index === list.length - 1,
      rows: pageRows
    }));
  }

  /**
   * Splits the list using the real rendered row heights (wrapped names,
   * addresses and companies make rows taller than a fixed height).
   */
  private measure(): void {
    if (typeof document === 'undefined') return;
    const host = this.host.nativeElement;
    const rows = this.rows();
    const table = host.querySelector<HTMLTableElement>('#plt-measure table');
    const page = host.querySelector<HTMLElement>('.plt-page');
    if (!rows.length || !table || !page) return;
    const bodyRows = Array.from(table.querySelectorAll<HTMLElement>('tbody tr'));
    if (bodyRows.length !== rows.length) return;
    const pageRect = page.getBoundingClientRect();
    const foot = page.querySelector<HTMLElement>('.plt-foot');
    if (!pageRect.height || !foot) return;
    const thead = page.querySelector<HTMLElement>('thead');
    const theadHeight = thead ? thead.getBoundingClientRect().height : 0;
    const footerTop = foot.getBoundingClientRect().top - pageRect.top;
    const firstRow = page.querySelector<HTMLElement>('tbody tr');
    const sec = page.querySelector<HTMLElement>('.plt-sec');
    const rowsStart1 = firstRow
      ? firstRow.getBoundingClientRect().top - pageRect.top
      : (sec ? sec.getBoundingClientRect().bottom - pageRect.top : pageRect.height * 0.3) + theadHeight;
    const second = host.querySelectorAll<HTMLElement>('.plt-page')[1];
    let rowsStart2: number;
    if (second) {
      const secondRect = second.getBoundingClientRect();
      const secondRow = second.querySelector<HTMLElement>('tbody tr');
      rowsStart2 = secondRow ? secondRow.getBoundingClientRect().top - secondRect.top : secondRect.height * 0.1;
    } else {
      const compact = page.querySelector<HTMLElement>('.plt-compact');
      rowsStart2 = 28 + (compact ? compact.getBoundingClientRect().height : 44) + 12 + theadHeight;
    }
    const heights = bodyRows.map(tr => tr.getBoundingClientRect().height);
    if (heights.some(height => !height)) return;
    const firstRoom = Math.max(40, footerTop - 8 - rowsStart1);
    const nextRoom = Math.max(40, footerTop - 8 - rowsStart2);
    const sizes = paginatePartyRowsByHeight(heights, firstRoom, nextRoom);
    const out: PartyListPage[] = [];
    let cursor = 0;
    for (let index = 0; index < sizes.length; index++) {
      out.push({ index, first: index === 0, last: index === sizes.length - 1, rows: rows.slice(cursor, cursor + sizes[index]) });
      cursor += sizes[index];
    }
    if (cursor !== rows.length) return;
    this.pages.set(out);
    if (this.measurePasses < 1) {
      this.measurePasses++;
      setTimeout(() => this.measure(), 60);
    }
  }

  money(value: number | string | null | undefined): string {
    const n = Math.round((Number(value) || 0) * 100) / 100;
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async downloadPdf(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.measure();
      await new Promise(resolve => setTimeout(resolve, 60));
      await this.whenFontsReady();
      this.measure();
      await new Promise(resolve => setTimeout(resolve, 60));
      const nodes = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.plt-page'));
      if (!nodes.length) return;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      for (let index = 0; index < nodes.length; index++) {
        const image = await this.capture(nodes[index]);
        if (index > 0) pdf.addPage('a4', 'portrait');
        pdf.addImage(image, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      }
      pdf.save(`${this.fileName}.pdf`);
    } catch {
      this.notify.error(this.prefs.txt('PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।', 'Could not create the PDF. Please try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  async print(): Promise<void> {
    this.measure();
    await new Promise(resolve => setTimeout(resolve, 60));
    const root = this.host.nativeElement.querySelector<HTMLElement>('#plt-root');
    if (!root) return;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:794px;height:1123px;border:0;background:#fff;';
    document.body.appendChild(frame);
    try {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !win) throw new Error('Print frame could not be created.');
      doc.open();
      doc.write('<!doctype html><html lang="bn"><head><meta charset="utf-8"></head><body></body></html>');
      doc.close();
      doc.title = `${this.prefs.txt('পার্টি তালিকা', 'Party List')} ${this.docNo()}`;
      for (const source of document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel="stylesheet"]')) {
        const style = source.cloneNode(true) as HTMLElement;
        if (style instanceof HTMLLinkElement && new URL(style.href).origin !== location.origin) continue;
        doc.head.appendChild(style);
      }
      const pageStyle = doc.createElement('style');
      pageStyle.textContent = '@page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; } .plt-page { break-after: page; print-color-adjust: exact; } .plt-page:last-child { break-after: auto; }';
      doc.head.appendChild(pageStyle);
      const clone = root.cloneNode(true) as HTMLElement;
      clone.style.cssText = 'display:flex;flex-direction:column;gap:0;';
      for (const image of Array.from(clone.querySelectorAll('img'))) {
        image.src = new URL(image.getAttribute('src') || '', document.baseURI).href;
      }
      doc.body.appendChild(clone);
      await Promise.race([doc.fonts.ready, new Promise(resolve => setTimeout(resolve, 4000))]);
      const cleanup = () => { win.removeEventListener('afterprint', cleanup); frame.remove(); };
      win.addEventListener('afterprint', cleanup);
      setTimeout(cleanup, 90000);
      win.focus();
      win.print();
    } catch {
      frame.remove();
      this.notify.error(this.prefs.txt('প্রিন্ট করা যায়নি। আবার চেষ্টা করুন।', 'Print failed. Please try again.'));
    }
  }

  private async capture(el: HTMLElement): Promise<string> {
    const options = { quality: 0.97, pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: false };
    try {
      return await htmlToImage.toJpeg(el, options);
    } catch {
      return await htmlToImage.toJpeg(el, { ...options, skipFonts: true });
    }
  }

  private async whenFontsReady(): Promise<void> {
    await Promise.race([document.fonts.ready.then(() => undefined), new Promise<void>(resolve => setTimeout(resolve, 3000))]);
  }

  private formatStamp(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}-${month}-${date.getFullYear()}, ${hours}:${minutes}`;
  }
}
