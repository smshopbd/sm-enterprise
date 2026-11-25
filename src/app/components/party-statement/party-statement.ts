import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import * as htmlToImage from 'html-to-image';
import { jsPDF } from 'jspdf';
import { DataService, Party, PartySide, PartySideAccount, partyPhones, partyRoles } from '../../services/data';
import { PreferencesService } from '../../services/preferences';
import { localizeAddress } from '../../utils/bd-geo';
import { NotificationService } from '../../services/notification';
import { localDateIso } from '../../utils/local-date';

/** Shape of one ledger row as built by the party drawer. */
export interface StatementRow {
  key: string;
  date: string;
  type: string;
  ref: string;
  note: string;
  debit: number;
  credit: number;
  balance: number;
}

/** One receipt/payment the party actually handed over. */
export interface StatementDepositRow {
  key: string;
  at: number;
  dateLabel: string;
  time: string;
  mode: string;
  amount: number;
  ref: string;
  note: string;
}

interface DocTxRow extends StatementRow {
  sl: number;
}

interface StatementPage {
  index: number;
  total: number;
  first: boolean;
  txTitle: boolean;
  tx: DocTxRow[];
  depTitle: boolean;
  dep: StatementDepositRow[];
  tail: boolean;
}

const PAGE_BODY = 1049;
const HEAD_FIRST = 280;
const HEAD_NEXT = 56;
const SECTION = 60;
const TABLE_HEAD = 24;
const TX_ROW = 27;
const DEP_ROW = 33;
const TAIL = 140;

@Component({
  selector: 'app-party-statement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  styles: [`
    .pst-page { position: relative; width: 794px; height: 1123px; flex: 0 0 auto; padding: 28px 32px 46px; background: #fff; color: #17252c;
      font: 11px/1.4 Calibri, 'Kalpurush', sans-serif; box-sizing: border-box; overflow: hidden; print-color-adjust: exact; }
    .pst-page * { box-sizing: border-box; }
    .pst-accent { position: absolute; top: 0; left: 0; right: 0; height: 6px; background: linear-gradient(90deg, var(--pst-accent, #087d6c), #22b8a6); }
    .pst-letterhead { height: 92px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 2px solid var(--pst-accent, #087d6c); }
    .pst-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .pst-logo { position: relative; overflow: hidden; width: 64px; height: 53px; flex: 0 0 64px; }
    .pst-logo img { position: absolute; width: 430.08px; max-width: none; left: -36.4px; top: -25.2px; }
    .pst-brand h1 { margin: 0; font-size: 20px; line-height: 1.15; font-weight: 700; color: var(--pst-accent, #087d6c); }
    .pst-brand p { margin: 1px 0 0; font-size: 10px; color: #596770; }
    .pst-docmeta { text-align: right; flex: 0 0 auto; }
    .pst-docmeta h2 { margin: 0; font-size: 12.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--pst-accent, #087d6c); }
    .pst-docno { margin: 2px 0 0; font: 700 13px/1.2 ui-monospace, monospace; letter-spacing: .03em; color: #0f172a; }
    .pst-docmeta p { margin: 1px 0 0; font-size: 9.5px; color: #596770; }
    .pst-compact { height: 44px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
      border-bottom: 2px solid var(--pst-accent, #087d6c); font-size: 10px; color: #596770; }
    .pst-compact b { color: var(--pst-accent, #087d6c); font-size: 12px; }
    .pst-profile { margin-top: 12px; height: 96px; display: grid; grid-template-columns: 1.35fr 1fr 1.05fr; border: 1px solid #cbd5d5; border-radius: 6px; overflow: hidden; }
    .pst-profile-main { padding: 9px 12px; min-width: 0; border-right: 1px dashed #dbe4e3; }
    .pst-eyebrow { margin: 0; font-size: 8.5px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #94a3a6; }
    .pst-profile-main h3 { margin: 1px 0 0; font-size: 15px; line-height: 1.2; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pst-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .pst-chips span { padding: 1px 7px; border-radius: 999px; border: 1px solid #cbd5d5; background: #f5f8f8; font-size: 8.5px; font-weight: 700; color: #475659; }
    .pst-chips span.pst-on { border-color: #a7d8cd; background: #e8f5f1; color: #0b6b5d; }
    .pst-sub { margin: 4px 0 0; font-size: 9.5px; color: #596770; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pst-kv { padding: 8px 10px; border-right: 1px dashed #dbe4e3; min-width: 0; }
    .pst-kv:last-child { border-right: 0; }
    .pst-kv p { display: flex; justify-content: space-between; gap: 8px; margin: 0 0 4px; font-size: 9px; }
    .pst-kv p span { color: #849295; flex: 0 0 auto; }
    .pst-kv p b { font-weight: 700; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pst-summary { margin-top: 10px; height: 64px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .pst-sum { border: 1px solid #dbe4e3; border-radius: 6px; padding: 7px 10px; background: #fbfcfc; min-width: 0; }
    .pst-sum p { margin: 0; font-size: 8.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #849295; }
    .pst-sum strong { display: inline-block; margin-top: 2px; font: 800 15px/1.15 ui-monospace, monospace; color: #17252c; }
    .pst-sum em { font-style: normal; font-size: 8.5px; font-weight: 700; color: #849295; margin-left: 3px; }
    .pst-sum.paid { border-color: #bbe6d3; background: #f2fbf6; }
    .pst-sum.paid strong { color: #0f7a4f; }
    .pst-sum.due { border-color: #f3c9c9; background: #fdf5f5; }
    .pst-sum.due strong { color: #b42318; }
    .pst-sum.dep { border-color: #bfe3e0; background: #f2fafa; }
    .pst-sum.dep strong { color: #0b6b5d; }
    .pst-sec { margin-top: 12px; height: 22px; display: flex; align-items: center; gap: 8px; font-size: 9.5px; font-weight: 800;
      letter-spacing: .12em; text-transform: uppercase; color: var(--pst-accent, #087d6c); }
    .pst-sec::before { content: ''; width: 3px; height: 12px; border-radius: 2px; background: var(--pst-accent, #087d6c); }
    .pst-sec::after { content: ''; flex: 1; height: 1px; background: #dbe4e3; }
    .pst-sec .pst-count { order: 2; padding: 0 7px; border-radius: 999px; background: #eef4f3; color: #475659; font-size: 8.5px; letter-spacing: 0; }
    .pst-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    /* The printable-area wrapper keeps the app's dark table skin off the paper; zebra rows are paper-only. */
    .pst-page .pst-table tbody tr { background: #fff; }
    .pst-page .pst-table tbody tr:nth-child(even) { background: #fbfcfc; }
    .pst-table thead th { height: 24px; padding: 0 6px; background: #eef4f3; border-bottom: 1px solid #cbd5d5; font-size: 8.5px; font-weight: 700;
      letter-spacing: .04em; text-transform: uppercase; color: #475659; text-align: left; }
    .pst-table td { height: 26px; padding: 0 6px; border-bottom: 1px solid #edf1f1; font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pst-table .num { text-align: right; font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
    .pst-table .ctr { text-align: center; color: #849295; font-size: 8.5px; font-weight: 700; }
    .pst-table .debit { color: #b42318; }
    .pst-table .credit { color: #0f7a4f; }
    .pst-table .bal { font-weight: 700; color: #17252c; }
    .pst-table td.ref b { font-weight: 700; }
    .pst-table td.ref .note { color: #849295; font-size: 8.5px; }
    .pst-table tr.pst-open td { background: #f8fafa; color: #596770; font-style: italic; }
    .pst-tag { display: inline-block; padding: 0 6px; border-radius: 3px; font-size: 8px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; }
    .pst-tag.sale { background: #fdeaea; color: #b42318; }
    .pst-tag.purchase { background: #e8eefb; color: #2b4c9b; }
    .pst-tag.payment { background: #e6f6ee; color: #0f7a4f; }
    .pst-tag.return { background: #fdf3e2; color: #9a5b06; }
    .pst-tag.opening { background: #eef1f2; color: #596770; }
    .pst-dep td { height: 32px; }
    .pst-totals { margin-top: 12px; height: 54px; display: grid; grid-template-columns: repeat(3, 1fr) 1.2fr; border: 1px solid #cbd5d5; border-radius: 6px; overflow: hidden; }
    .pst-totals > div { padding: 8px 10px; border-right: 1px dashed #dbe4e3; }
    .pst-totals > div:last-child { border-right: 0; }
    .pst-totals span { display: block; font-size: 8.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #849295; }
    .pst-totals b { display: block; margin-top: 2px; font: 800 13px/1.2 ui-monospace, monospace; color: #17252c; }
    .pst-totals .close { background: #f2fafa; }
    .pst-totals .close b { color: var(--pst-accent, #087d6c); }
    .pst-totals em { font-style: normal; font-size: 8.5px; color: #849295; }
    .pst-sign { margin-top: 18px; height: 44px; display: flex; justify-content: space-between; gap: 60px; }
    .pst-sign > div { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; border-top: 1px solid #849295; padding-top: 4px; }
    .pst-sign p { margin: 0; font-size: 9.5px; font-weight: 700; color: #334155; }
    .pst-sign small { font-size: 8px; color: #849295; }
    .pst-foot { position: absolute; left: 32px; right: 32px; bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
      border-top: 1px solid #dbe4e3; padding-top: 5px; font-size: 8.5px; color: #849295; }
    .pst-toolbar { position: sticky; top: 0; z-index: 20; }
    .pst-scroll { min-height: 100%; width: max-content; margin: 0 auto; padding: 0 16px 32px; }
    @media print {
      .pst-page { break-after: page; }
      .pst-page:last-child { break-after: auto; }
    }
  `],
  template: `
    <div class="fixed inset-0 z-[70] overflow-auto bg-slate-900/75 backdrop-blur-xs">
      <div class="pst-scroll">
        <div class="pst-toolbar mx-auto mb-3 flex max-w-[794px] flex-wrap items-center justify-between gap-2 rounded-xl border border-white/15 bg-slate-900/85 px-3 py-2 text-white shadow-lg">
          <div class="min-w-0">
            <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-200/80">
              <mat-icon class="text-[12px]">description</mat-icon>
              {{ prefs.txt('ডকুমেন্ট', 'Document') }}
            </p>
            <h2 class="truncate text-sm font-bold leading-tight">{{ prefs.txt('পার্টি লেনদেন স্টেটমেন্ট', 'Party Ledger Statement') }}</h2>
            <p class="truncate text-[10px] text-slate-300">{{ party().name }} · {{ bookLabel() }}</p>
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

        <div id="pst-root" class="printable-area flex flex-col items-center gap-4">
          @for (page of pages(); track page.index) {
            <section class="pst-page" [style.--pst-accent]="shop().accentColor || '#087d6c'">
              <div class="pst-accent"></div>

              @if (page.first) {
                <div class="pst-letterhead">
                  <div class="pst-brand">
                    @if (shop().showLogo) {
                      <div class="pst-logo"><img src="assets/sm-logo.jpg" alt="logo" /></div>
                    }
                    <div>
                      <h1>{{ shop().businessNamePart1 }} {{ shop().businessNamePart2 }}</h1>
                      <p>{{ shop().address }}</p>
                      <p>{{ shop().mobile }}{{ shop().email ? ' · ' + shop().email : '' }}</p>
                    </div>
                  </div>
                  <div class="pst-docmeta">
                    <h2>{{ prefs.txt('পার্টি লেনদেন স্টেটমেন্ট', 'Party Ledger Statement') }}</h2>
                    <p class="pst-docno">{{ statementNo() }}</p>
                    <p>{{ prefs.txt('তৈরি', 'Generated') }}: {{ generatedAt() }}</p>
                    <p>{{ bookLabel() }}</p>
                  </div>
                </div>
              } @else {
                <div class="pst-compact">
                  <span><b>{{ shop().businessNamePart1 }} {{ shop().businessNamePart2 }}</b> · {{ prefs.txt('স্টেটমেন্ট চলমান', 'Statement continued') }}</span>
                  <span>{{ party().name }} · {{ statementNo() }}</span>
                </div>
              }

              @if (page.first) {
                <div class="pst-profile">
                  <div class="pst-profile-main">
                    <p class="pst-eyebrow">{{ prefs.txt('পার্টি প্রোফাইল', 'Party Profile') }}</p>
                    <h3>{{ party().name }}</h3>
                    <div class="pst-chips">
                      @for (role of roleLabels(); track role) {
                        <span>{{ role }}</span>
                      }
                      <span [class.pst-on]="party().status === 'Enabled'">{{ party().status }}</span>
                    </div>
                    @if (companyLine()) {
                      <p class="pst-sub">{{ companyLine() }}</p>
                    }
                  </div>
                  <div class="pst-kv">
                    <p><span>{{ prefs.txt('মোবাইল', 'Mobile') }}</span><b>{{ partyPhones(party()).join(', ') || '—' }}</b></p>
                    <p><span>{{ prefs.txt('ইমেইল', 'Email') }}</span><b>{{ party().email || '—' }}</b></p>
                    <p><span>{{ prefs.txt('সদস্য', 'Member since') }}</span><b>{{ memberSince() || '—' }}</b></p>
                  </div>
                  <div class="pst-kv">
                    <p><span>{{ prefs.txt('ঠিকানা', 'Address') }}</span><b>{{ addressLine() || '—' }}</b></p>
                    <p><span>{{ prefs.txt('ওপেনিং', 'Opening') }}</span><b>{{ money(openingBalance()) }} TK</b></p>
                    <p><span>{{ prefs.txt('অবস্থা', 'Status') }}</span><b>{{ party().status }}</b></p>
                  </div>
                </div>

                <div class="pst-summary">
                  <div class="pst-sum">
                    <p>{{ isPurchase() ? prefs.txt('মোট ক্রয়', 'Total purchases') : prefs.txt('মোট বিক্রয়', 'Total sales') }}</p>
                    <strong>{{ money(account().total) }}</strong><em>TK</em>
                  </div>
                  <div class="pst-sum paid">
                    <p>{{ prefs.txt('পরিশোধিত', 'Paid') }}</p>
                    <strong>{{ money(account().paid) }}</strong><em>TK</em>
                  </div>
                  <div class="pst-sum due">
                    <p>{{ isPurchase() ? prefs.txt('প্রদেয়', 'Payable') : prefs.txt('বাকি', 'Due') }}</p>
                    <strong>{{ money(absDue()) }}</strong><em>TK</em>
                  </div>
                  <div class="pst-sum dep">
                    <p>{{ prefs.txt('মোট জমা', 'Total deposits') }}</p>
                    <strong>{{ money(depositTotal()) }}</strong><em>TK</em>
                  </div>
                </div>
              }

              @if (page.tx.length) {
                @if (page.txTitle) {
                  <div class="pst-sec">
                    {{ prefs.txt('লেনদেনের বিবরণ', 'Transaction details') }}
                    <span class="pst-count">{{ txCount() }} {{ prefs.txt('টি', 'rows') }}</span>
                  </div>
                }
                <table class="pst-table pst-tx">
                  <colgroup>
                    <col style="width:34px"><col style="width:76px"><col style="width:92px"><col>
                    <col style="width:82px"><col style="width:82px"><col style="width:88px">
                  </colgroup>
                  <thead>
                    <tr>
                      <th class="ctr">{{ prefs.txt('ক্রম', 'SL') }}</th>
                      <th>{{ prefs.txt('তারিখ', 'Date') }}</th>
                      <th>{{ prefs.txt('ধরন', 'Type') }}</th>
                      <th>{{ prefs.txt('রেফারেন্স / বিবরণ', 'Reference / Details') }}</th>
                      <th class="num">{{ prefs.txt('ডেবিট', 'Debit') }}</th>
                      <th class="num">{{ prefs.txt('ক্রেডিট', 'Credit') }}</th>
                      <th class="num">{{ prefs.txt('ব্যালেন্স', 'Balance') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of page.tx; track row.key) {
                      <tr [class.pst-open]="row.type === 'opening'">
                        <td class="ctr">{{ row.sl || '' }}</td>
                        <td>{{ row.date ? formatDate(row.date) : '—' }}</td>
                        <td><span class="pst-tag" [class]="'pst-tag ' + row.type">{{ typeLabel(row.type) }}</span></td>
                        <td class="ref"><b>{{ row.ref }}</b>@if (row.note) {<span class="note"> · {{ row.note }}</span>}</td>
                        <td class="num debit">{{ row.debit ? money(row.debit) : '—' }}</td>
                        <td class="num credit">{{ row.credit ? money(row.credit) : '—' }}</td>
                        <td class="num bal">{{ money(row.balance) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }

              @if (page.dep.length) {
                @if (page.depTitle) {
                  <div class="pst-sec">
                    {{ prefs.txt('পেমেন্ট ও জমার ইতিহাস', 'Payment & deposit history') }}
                    <span class="pst-count">{{ deposits().length }} {{ prefs.txt('টি', 'entries') }}</span>
                  </div>
                }
                <table class="pst-table pst-dep">
                  <colgroup>
                    <col style="width:80px"><col style="width:64px"><col style="width:72px"><col style="width:138px"><col><col style="width:92px">
                  </colgroup>
                  <thead>
                    <tr>
                      <th>{{ prefs.txt('তারিখ', 'Date') }}</th>
                      <th>{{ prefs.txt('সময়', 'Time') }}</th>
                      <th>{{ prefs.txt('মাধ্যম', 'Mode') }}</th>
                      <th>{{ prefs.txt('রিসিট / ভাউচার', 'Receipt / Voucher') }}</th>
                      <th>{{ prefs.txt('বিবরণ', 'Details') }}</th>
                      <th class="num">{{ prefs.txt('জমা', 'Deposit') }} (TK)</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of page.dep; track row.key) {
                      <tr>
                        <td>{{ row.dateLabel }}</td>
                        <td>{{ row.time || '—' }}</td>
                        <td>{{ row.mode || 'Cash' }}</td>
                        <td>{{ row.ref }}</td>
                        <td>{{ row.note || '—' }}</td>
                        <td class="num credit">{{ money(row.amount) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }

              @if (page.tail) {
                <div class="pst-totals">
                  <div><span>{{ prefs.txt('মোট ডেবিট', 'Total debit') }}</span><b>{{ money(totalDebit()) }}</b></div>
                  <div><span>{{ prefs.txt('মোট ক্রেডিট', 'Total credit') }}</span><b>{{ money(totalCredit()) }}</b></div>
                  <div><span>{{ prefs.txt('মোট জমা', 'Total deposits') }}</span><b>{{ money(depositTotal()) }}</b></div>
                  <div class="close">
                    <span>{{ prefs.txt('সমাপনী ব্যালেন্স', 'Closing balance') }}</span>
                    <b>{{ money(closingBalance()) }}</b>
                    <em>{{ isPurchase() ? prefs.txt('প্রদেয়', 'Payable') : prefs.txt('বাকি', 'Due') }}</em>
                  </div>
                </div>

                <div class="pst-sign">
                  <div>
                    <p>{{ prefs.txt('কাস্টমারের স্বাক্ষর', 'Customer signature') }}</p>
                    <small>{{ party().name }}</small>
                  </div>
                  <div>
                    <p>{{ prefs.txt('অনুমোদিত স্বাক্ষর', 'Authorized signature') }}</p>
                    <small>{{ shop().businessNamePart1 }} {{ shop().businessNamePart2 }}</small>
                  </div>
                </div>
              }

              <footer class="pst-foot">
                <span>{{ shop().businessNamePart1 }} {{ shop().businessNamePart2 }} · {{ shop().mobile }}</span>
                <span>{{ statementNo() }} · {{ prefs.txt('তৈরি', 'Generated') }} {{ generatedAt() }}</span>
                <span>{{ prefs.txt('পৃষ্ঠা', 'Page') }} {{ page.index }} / {{ page.total }}</span>
              </footer>
            </section>
          }
        </div>
      </div>
    </div>
  `
})
export class PartyStatement {
  private dataService = inject(DataService);
  private host: ElementRef<HTMLElement> = inject(ElementRef);
  private notify = inject(NotificationService);
  readonly prefs = inject(PreferencesService);

  readonly party = input.required<Party>();
  protected readonly partyPhones = partyPhones;
  readonly side = input.required<PartySide>();
  readonly rows = input.required<StatementRow[]>();
  readonly deposits = input.required<StatementDepositRow[]>();
  readonly openingBalance = input<number>(0);
  readonly account = input.required<PartySideAccount>();
  readonly depositTotal = input<number>(0);
  readonly close = output<void>();

  readonly shop = this.dataService.voucherSettings;
  readonly busy = signal(false);
  private readonly createdAt = new Date();

  readonly isPurchase = computed(() => this.side() === 'purchase');
  readonly bookLabel = computed(() => this.isPurchase()
    ? this.prefs.txt('ক্রয় হিসাব', 'Purchase book')
    : this.prefs.txt('বিক্রয় হিসাব', 'Sales book'));
  readonly statementNo = computed(() => `PS-${String(this.party().id).padStart(4, '0')}-${localDateIso().replace(/-/g, '')}`);
  readonly generatedAt = computed(() => this.createdAt.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }));
  readonly absDue = computed(() => Math.abs(Number(this.account().due) || 0));
  readonly txCount = computed(() => this.rows().length);
  readonly totalDebit = computed(() => this.round(this.rows().reduce((sum, row) => sum + this.num(row.debit), 0)));
  readonly totalCredit = computed(() => this.round(this.rows().reduce((sum, row) => sum + this.num(row.credit), 0)));
  readonly closingBalance = computed(() => {
    const list = this.rows();
    return list.length ? this.num(list[list.length - 1].balance) : this.num(this.openingBalance());
  });

  readonly roleLabels = computed(() => partyRoles(this.party()).map(role => {
    if (role === 'Supplier') return this.prefs.txt('সরবরাহকারী', 'Supplier');
    if (role === 'Dealer') return this.prefs.txt('ডিলার', 'Dealer');
    if (role === 'Staff Member') return this.prefs.txt('স্টাফ', 'Staff');
    if (role === 'Corporate Customer') return this.prefs.txt('কর্পোরেট', 'Corporate');
    return this.prefs.txt('কাস্টমার', 'Customer');
  }));

  readonly companyLine = computed(() => {
    const p = this.party();
    return [p.companyName, p.zone, p.inHand].map(value => this.clean(value)).filter(Boolean).join(' · ');
  });

  readonly addressLine = computed(() => {
    const p = this.party();
    const parts = [p.areaRoadHouse, p.thana, p.upazila, p.district, p.division]
      .map(value => this.clean(value))
      .filter(Boolean);
    return localizeAddress(Array.from(new Set(parts)).join(', ') || this.clean(p.address), this.prefs.language());
  });

  readonly memberSince = computed(() => {
    const raw = this.clean(this.party().createdAt);
    return raw ? this.formatDate(raw) : '';
  });

  private readonly docTx = computed<DocTxRow[]>(() => {
    const list: DocTxRow[] = [{
      key: 'opening',
      sl: 0,
      date: '',
      type: 'opening',
      ref: this.prefs.txt('ওপেনিং ব্যালান্স', 'Opening balance'),
      note: '',
      debit: 0,
      credit: 0,
      balance: this.num(this.openingBalance())
    }];
    this.rows().forEach((row, index) => list.push({ ...row, sl: index + 1 }));
    return list;
  });

  private readonly docDeposits = computed(() =>
    [...this.deposits()].sort((a, b) => a.at - b.at));

  /** Fixed-height A4 pages, packed in code so the PDF never splits a row. */
  readonly pages = computed<StatementPage[]>(() => {
    const pages: StatementPage[] = [];
    const blank = (first: boolean): StatementPage => ({
      index: 0, total: 0, first, txTitle: false, tx: [], depTitle: false, dep: [], tail: false
    });

    let page = blank(true);
    pages.push(page);
    let used = HEAD_FIRST;

    const tx = this.docTx();
    if (tx.length) {
      if (used + SECTION + TABLE_HEAD + TX_ROW > PAGE_BODY) {
        page = blank(false);
        pages.push(page);
        used = HEAD_NEXT + TABLE_HEAD;
      } else {
        used += SECTION + TABLE_HEAD;
      }
      page.txTitle = true;
      for (const row of tx) {
        if (used + TX_ROW > PAGE_BODY) {
          page = blank(false);
          pages.push(page);
          used = HEAD_NEXT + TABLE_HEAD;
        }
        page.tx.push(row);
        used += TX_ROW;
      }
    }

    const deposits = this.docDeposits();
    if (deposits.length) {
      if (used + SECTION + TABLE_HEAD + DEP_ROW > PAGE_BODY) {
        page = blank(false);
        pages.push(page);
        used = HEAD_NEXT + TABLE_HEAD;
      } else {
        used += SECTION + TABLE_HEAD;
      }
      page.depTitle = true;
      for (const row of deposits) {
        if (used + DEP_ROW > PAGE_BODY) {
          page = blank(false);
          pages.push(page);
          used = HEAD_NEXT + TABLE_HEAD;
        }
        page.dep.push(row);
        used += DEP_ROW;
      }
    }

    if (used + TAIL > PAGE_BODY) {
      page = blank(false);
      pages.push(page);
      used = HEAD_NEXT;
    }
    page.tail = true;

    pages.forEach((item, index) => {
      item.index = index + 1;
      item.total = pages.length;
    });
    return pages;
  });

  readonly fileName = computed(() => {
    const safe = (this.party().name || 'party').replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\s+/g, '-');
    return `Statement-${safe || 'party'}-${localDateIso()}`;
  });

  money(value: number | string | null | undefined): string {
    return this.num(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatDate(value: string): string {
    const parsed = this.dateValue(value);
    if (!parsed) return value || '—';
    const date = new Date(parsed);
    return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
  }

  typeLabel(type: string): string {
    if (type === 'sale') return this.prefs.txt('বিক্রয়', 'Sale');
    if (type === 'purchase') return this.prefs.txt('ক্রয়', 'Purchase');
    if (type === 'payment') return this.prefs.txt('পেমেন্ট', 'Payment');
    if (type === 'return') return this.prefs.txt('ফেরত', 'Return');
    return this.prefs.txt('ওপেনিং', 'Opening');
  }

  async downloadPdf(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.whenFontsReady();
      const nodes = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.pst-page'));
      if (!nodes.length) return;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      for (let index = 0; index < nodes.length; index++) {
        const image = await this.capture(nodes[index]);
        if (index > 0) pdf.addPage('a4', 'portrait');
        pdf.addImage(image, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      }
      pdf.save(`${this.fileName()}.pdf`);
    } catch {
      this.notify.error(this.prefs.txt('PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।', 'Could not create the PDF. Please try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  async print(): Promise<void> {
    const root = this.host.nativeElement.querySelector<HTMLElement>('#pst-root');
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
      doc.title = `${this.prefs.txt('পার্টি স্টেটমেন্ট', 'Party Statement')} ${this.statementNo()}`;
      for (const source of document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel="stylesheet"]')) {
        const style = source.cloneNode(true) as HTMLElement;
        if (style instanceof HTMLLinkElement && new URL(style.href).origin !== location.origin) continue;
        doc.head.appendChild(style);
      }
      const pageStyle = doc.createElement('style');
      pageStyle.textContent = '@page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; } .pst-page { break-after: page; print-color-adjust: exact; } .pst-page:last-child { break-after: auto; }';
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

  private clean(value?: string): string {
    const text = (value || '').trim();
    return text && text !== '-' && text.toUpperCase() !== 'N/A' ? text : '';
  }

  private num(value?: number | string | null): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private dateValue(value: string): number {
    if (!value) return 0;
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]).getTime();
    const dmy = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]).getTime();
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
