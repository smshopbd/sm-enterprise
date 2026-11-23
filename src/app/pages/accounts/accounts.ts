import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { downloadWorkbook } from '../../utils/spreadsheet';
import {
  DataService, LedgerPayment, Party,
  hasPurchaseRole, hasSalesRole, purchaseAccountOf, salesAccountOf
} from '../../services/data';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { PartyLedger } from '../../components/party-ledger/party-ledger';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';

@Component({
  selector: 'app-accounts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, PartyLedger, TablePagination],
  template: `
    @if (!session.canSee('accounts')) {
      <div class="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
        <mat-icon class="text-4xl text-slate-300 block mb-2">lock</mat-icon>
        {{ prefs.t('settings.onlyAdmin') }}
      </div>
    } @else {
      <div class="space-y-4 text-xs text-slate-800">
        <!-- Header -->
        <div class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
          <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
          <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
          <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                <mat-icon class="text-xl">account_balance</mat-icon>
              </span>
              <div class="min-w-0">
                <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                  <span>{{ prefs.txt('হিসাব', 'Accounts') }}</span>
                  <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                  <span>{{ prefs.txt('সারসংক্ষেপ', 'Summary') }}</span>
                </p>
                <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.t('accounts.title') }}</h1>
                <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('গ্রাহক ও সরবরাহকারীর লেনদেন, পাওনা এবং আদায়ের সারসংক্ষেপ।', 'Customer and supplier ledgers, dues and collection summary.') }}</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button (click)="exportWorkbook()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
                <mat-icon class="text-sm text-emerald-200">description</mat-icon> {{ prefs.t('common.excel') }}
              </button>
              <button (click)="printPage()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
                <mat-icon class="text-sm">print</mat-icon> {{ prefs.t('common.print') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Summary cards -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
            <div class="flex items-center justify-between">
              <span class="text-slate-500 font-semibold">{{ prefs.t('accounts.receivable') }}</span>
              <mat-icon class="text-rose-500 text-base">south_west</mat-icon>
            </div>
            <p class="text-xl font-black text-rose-600 font-mono mt-1">{{ dataService.totalReceivable() | number:'1.2-2' }} TK</p>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
            <div class="flex items-center justify-between">
              <span class="text-slate-500 font-semibold">{{ prefs.t('accounts.payable') }}</span>
              <mat-icon class="text-amber-500 text-base">north_east</mat-icon>
            </div>
            <p class="text-xl font-black text-amber-600 font-mono mt-1">{{ dataService.totalPayable() | number:'1.2-2' }} TK</p>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
            <div class="flex items-center justify-between">
              <span class="text-slate-500 font-semibold">{{ prefs.t('accounts.collected') }}</span>
              <mat-icon class="text-emerald-500 text-base">payments</mat-icon>
            </div>
            <p class="text-xl font-black text-emerald-600 font-mono mt-1">{{ collectedToday() | number:'1.2-2' }} TK</p>
            <p class="text-[10px] text-slate-400 mt-0.5">{{ prefs.t('common.total') }}: {{ totalCollected() | number:'1.2-2' }} TK</p>
          </div>
        </div>

        <!-- Tabs & search -->
        <div class="bg-white p-2 rounded-xl shadow-xs border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 overflow-x-auto">
            <button (click)="setTab('customers')" [class]="tab() === 'customers' ? activeTabClass : idleTabClass">
              {{ prefs.t('accounts.customerLedger') }} ({{ customers().length }})
            </button>
            <button (click)="setTab('suppliers')" [class]="tab() === 'suppliers' ? activeTabClass : idleTabClass">
              {{ prefs.t('accounts.supplierLedger') }} ({{ suppliers().length }})
            </button>
            <button (click)="setTab('payments')" [class]="tab() === 'payments' ? activeTabClass : idleTabClass">
              {{ prefs.t('accounts.payments') }} ({{ dataService.payments().length }})
            </button>
          </div>
          <div class="relative w-full sm:w-64">
            <mat-icon class="absolute left-2.5 top-2 text-slate-400 text-sm">search</mat-icon>
            <input type="text" [value]="query()" (input)="onSearch($event)" [placeholder]="prefs.t('common.search') + '...'"
              class="w-full border border-slate-300 rounded-lg pl-8 pr-2 py-1.5 focus:border-teal-500 focus:outline-none" />
          </div>
        </div>

        <!-- Party tables -->
        @if (tab() !== 'payments') {
          <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full min-w-[780px] text-left border-collapse">
                <thead>
                  <tr class="bg-teal-700 text-white uppercase text-[10px] font-bold tracking-wide">
                    <th class="p-2.5 text-center w-10">SL</th>
                    <th class="p-2.5">{{ prefs.t('common.name') }}</th>
                    <th class="p-2.5">{{ prefs.t('common.phone') }}</th>
                    <th class="p-2.5 text-right">{{ prefs.t('common.total') }}</th>
                    <th class="p-2.5 text-right">{{ prefs.t('common.paid') }}</th>
                    <th class="p-2.5 text-right">{{ prefs.t('common.due') }}</th>
                    <th class="p-2.5 text-center w-24">{{ prefs.t('common.actions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (p of partiesPager.paged(); track p.id; let idx = $index) {
                    <tr class="hover:bg-teal-50/40 cursor-pointer" (click)="openLedger(p)">
                      <td class="p-2.5 text-center text-slate-400 font-bold">{{ partiesPager.offset() + idx + 1 }}</td>
                      <td class="p-2.5">
                        <p class="font-bold text-teal-800">{{ p.name }}</p>
                        <p class="text-[10px] text-slate-400">{{ p.companyName }}</p>
                      </td>
                      <td class="p-2.5 text-slate-600">{{ p.phone || '-' }}</td>
                      <td class="p-2.5 text-right font-mono text-slate-800">{{ rowTotal(p) | number:'1.2-2' }}</td>
                      <td class="p-2.5 text-right font-mono text-emerald-600">{{ rowPaid(p) | number:'1.2-2' }}</td>
                      <td class="p-2.5 text-right font-mono font-bold" [class.text-rose-600]="rowDue(p) > 0" [class.text-slate-400]="rowDue(p) <= 0">{{ rowDue(p) | number:'1.2-2' }}</td>
                      <td class="p-2.5 text-center">
                        <button (click)="openLedger(p); $event.stopPropagation()" class="text-teal-600 hover:text-teal-800 p-1" [title]="prefs.t('accounts.viewLedger')">
                          <mat-icon class="text-sm">menu_book</mat-icon>
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="p-8 text-center text-slate-400">{{ prefs.t('common.noData') }}</td></tr>
                  }
                </tbody>
              </table>
            </div>

            <app-table-pagination
              [total]="partiesPager.total()"
              [page]="partiesPager.currentPage()"
              [pageSize]="partiesPager.pageSize()"
              (pageChange)="partiesPager.setPage($event)"
              (pageSizeChange)="partiesPager.setPageSize($event)"
            />
          </div>
        }

        <!-- Payment history -->
        @if (tab() === 'payments') {
          <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full min-w-[760px] text-left border-collapse">
                <thead>
                  <tr class="bg-teal-700 text-white uppercase text-[10px] font-bold tracking-wide">
                    <th class="p-2.5">{{ prefs.t('ledger.receiptNo') }}</th>
                    <th class="p-2.5">{{ prefs.t('common.date') }}</th>
                    <th class="p-2.5">{{ prefs.t('common.name') }}</th>
                    <th class="p-2.5">{{ prefs.t('common.type') }}</th>
                    <th class="p-2.5">{{ prefs.t('common.mode') }}</th>
                    <th class="p-2.5 text-right">{{ prefs.t('common.amount') }}</th>
                    <th class="p-2.5 text-right">{{ prefs.t('common.discount') }}</th>
                    <th class="p-2.5 text-center w-20">{{ prefs.t('common.actions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (payment of paymentsPager.paged(); track payment.id) {
                    <tr class="hover:bg-teal-50/40">
                      <td class="p-2.5 font-bold text-teal-800">{{ payment.receiptNo }}</td>
                      <td class="p-2.5 text-slate-500">{{ formatDate(payment.date) }}</td>
                      <td class="p-2.5 font-semibold text-slate-800">{{ payment.partyName }}</td>
                      <td class="p-2.5">
                        <span [class]="payment.partyType === 'Supplier' ? 'bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-bold' : 'bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px] font-bold'">
                          {{ payment.partyType }}
                        </span>
                      </td>
                      <td class="p-2.5 text-slate-600">{{ payment.mode }}</td>
                      <td class="p-2.5 text-right font-mono font-bold text-emerald-700">{{ payment.amount | number:'1.2-2' }}</td>
                      <td class="p-2.5 text-right font-mono text-slate-500">{{ payment.discount ? (payment.discount | number:'1.2-2') : '-' }}</td>
                      <td class="p-2.5 text-center">
                        <button (click)="openPaymentParty(payment)" class="text-teal-600 hover:text-teal-800 p-1" [title]="prefs.t('accounts.viewLedger')">
                          <mat-icon class="text-sm">menu_book</mat-icon>
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="8" class="p-8 text-center text-slate-400">{{ prefs.t('common.noData') }}</td></tr>
                  }
                </tbody>
              </table>
            </div>

            <app-table-pagination
              [total]="paymentsPager.total()"
              [page]="paymentsPager.currentPage()"
              [pageSize]="paymentsPager.pageSize()"
              (pageChange)="paymentsPager.setPage($event)"
              (pageSizeChange)="paymentsPager.setPageSize($event)"
            />
          </div>
        }
      </div>

      @if (selectedParty(); as lp) {
        <app-party-ledger [party]="lp"
          [side]="tab() === 'suppliers' ? 'purchase' : 'sales'"
          (close)="selectedParty.set(null)" />
      }
    }
  `
})
export class Accounts {
  dataService = inject(DataService);
  session = inject(SessionService);
  prefs = inject(PreferencesService);
  private notify = inject(NotificationService);

  readonly activeTabClass = 'bg-teal-700 text-white px-3 py-1.5 rounded-lg font-bold whitespace-nowrap';
  readonly idleTabClass = 'text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap';

  tab = signal<'customers' | 'suppliers' | 'payments'>('customers');
  query = signal<string>('');
  selectedParty = signal<Party | null>(null);

  // A party with both roles appears on both books — each side keeps its own balance.
  customers = computed(() => this.dataService.parties().filter(p => hasSalesRole(p)));
  suppliers = computed(() => this.dataService.parties().filter(p => hasPurchaseRole(p)));

  rowTotal(p: Party): number {
    return this.tab() === 'suppliers' ? purchaseAccountOf(p).total : salesAccountOf(p).total;
  }

  rowPaid(p: Party): number {
    return this.tab() === 'suppliers' ? purchaseAccountOf(p).paid : salesAccountOf(p).paid;
  }

  rowDue(p: Party): number {
    return this.tab() === 'suppliers' ? purchaseAccountOf(p).due : salesAccountOf(p).due;
  }

  visibleParties = computed(() => {
    const q = this.query().trim().toLowerCase();
    const source = this.tab() === 'suppliers' ? this.suppliers() : this.customers();
    const list = q
      ? source.filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.companyName.toLowerCase().includes(q) ||
          (p.phone || '').toLowerCase().includes(q))
      : source;
    return [...list].sort((a, b) => this.rowDue(b) - this.rowDue(a));
  });

  readonly partiesPager = createPager(() => this.visibleParties());

  visiblePayments = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = q
      ? this.dataService.payments().filter(p =>
          p.partyName.toLowerCase().includes(q) ||
          p.receiptNo.toLowerCase().includes(q) ||
          p.mode.toLowerCase().includes(q))
      : this.dataService.payments();
    return [...list].sort((a, b) => this.dateValue(b.date) - this.dateValue(a.date));
  });

  readonly paymentsPager = createPager(() => this.visiblePayments());

  /** Money received from customers; supplier payments go the other way and are not "collected". */
  private receipts = computed(() => this.dataService.payments().filter(p => p.partyType === 'Customer'));

  totalCollected = computed(() => this.receipts().reduce((acc, p) => acc + p.amount, 0));

  collectedToday = computed(() => {
    const today = localDateIso();
    return this.receipts()
      .filter(p => p.date === today)
      .reduce((acc, p) => acc + p.amount, 0);
  });

  setTab(value: 'customers' | 'suppliers' | 'payments') {
    this.tab.set(value);
    this.partiesPager.setPage(1);
    this.paymentsPager.setPage(1);
  }

  onSearch(e: Event) {
    this.query.set((e.target as HTMLInputElement).value);
    this.partiesPager.setPage(1);
    this.paymentsPager.setPage(1);
  }

  openLedger(party: Party) {
    this.selectedParty.set(party);
  }

  openPaymentParty(payment: LedgerPayment) {
    const party = this.dataService.parties().find(p => p.id === payment.partyId || p.name === payment.partyName);
    if (party) this.selectedParty.set(party);
  }

  exportWorkbook() {
    const customerRows = this.customers().map((p, i) => {
      const acc = salesAccountOf(p);
      return {
        SL: i + 1, Name: p.name, Company: p.companyName, Phone: p.phone || '-',
        Total: acc.total, Paid: acc.paid, Due: acc.due
      };
    });
    const supplierRows = this.suppliers().map((p, i) => {
      const acc = purchaseAccountOf(p);
      return {
        SL: i + 1, Name: p.name, Company: p.companyName, Phone: p.phone || '-',
        Total: acc.total, Paid: acc.paid, Due: acc.due
      };
    });
    const paymentRows = this.visiblePayments().map(p => ({
      Receipt: p.receiptNo, Date: this.formatDate(p.date), Party: p.partyName,
      Type: p.partyType, Mode: p.mode, Amount: p.amount, Discount: p.discount, Note: p.note
    }));
    void downloadWorkbook(`Accounts_Ledger_${localDateIso()}.xlsx`, [
      { name: 'Customer Ledger', rows: customerRows },
      { name: 'Supplier Ledger', rows: supplierRows },
      { name: 'Payments', rows: paymentRows }
    ]).then(() => this.session.log('Export', 'Accounts ledger exported to Excel'))
      .catch(error => this.notify.error(error instanceof Error ? error.message : String(error), this.prefs.txt('এক্সপোর্ট ব্যর্থ', 'Export failed')));
  }

  printPage() {
    this.session.log('Print', 'Accounts ledger printed');
    setTimeout(() => window.print(), 50);
  }

  formatDate(value: string): string {
    const ts = this.dateValue(value);
    if (!ts) return value || '-';
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  }

  private dateValue(value: string): number {
    if (!value) return 0;
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]).getTime();
    const dmy = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]).getTime();
    return 0;
  }
}
