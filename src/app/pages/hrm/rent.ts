import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, RentPayment } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { SessionService } from '../../services/session';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';
import { HrmNav } from './hrm-nav';

@Component({
  selector: 'app-hrm-rent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, HrmNav],
  styles: `
    .rent-sticky { position: sticky; top: 0; z-index: 5; background-color: var(--sm-brand, #0d9488); }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">
      <app-hrm-nav />

      <div class="bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 rounded-xl p-4 text-white shadow-sm">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-bold flex items-center gap-2"><mat-icon>storefront</mat-icon> {{ prefs.txt('দোকানের ভাড়ার হিসাব', 'Shop rent records') }}</h1>
            <p class="text-[11px] text-teal-50/90">{{ prefs.txt('ভাড়া “পরিশোধিত” হলে টাকা সরাসরি মূল ব্যালেন্স (ওয়ালেট) থেকে কাটা হবে।', 'When rent is marked “paid”, the amount is deducted straight from the main balance (wallet).') }}</p>
          </div>
          <div class="flex items-center gap-2">
            <label class="inline-flex items-center gap-1.5 bg-white/15 border border-white/25 rounded-lg px-2.5 py-1.5">
              <mat-icon class="text-sm">calendar_month</mat-icon>
              <input type="month" [ngModel]="month()" (ngModelChange)="setMonth($event)"
                class="bg-transparent outline-none text-xs font-bold text-white [color-scheme:dark]">
            </label>
            <button (click)="openAdd()" class="inline-flex items-center gap-1 bg-white text-teal-800 font-bold px-3 py-2 rounded-lg shadow-2xs cursor-pointer hover:bg-teal-50">
              <mat-icon class="text-sm">add_circle</mat-icon> {{ prefs.txt('ভাড়া যোগ', 'Add rent') }}
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('এই মাসের ভাড়া', 'Rent this month') }}</p>
            <p class="text-lg font-black font-mono">{{ totals().total | number:'1.0-2' }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('পরিশোধিত', 'Paid') }}</p>
            <p class="text-lg font-black font-mono">{{ totals().paid | number:'1.0-2' }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('বাকি', 'Due') }}</p>
            <p class="text-lg font-black font-mono">{{ totals().due | number:'1.0-2' }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('মূল ব্যালেন্স', 'Main balance') }}</p>
            <p class="text-lg font-black font-mono">{{ data.mainBalance() | number:'1.0-2' }}</p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div class="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <p class="font-bold text-slate-900">{{ monthLabel() }} — {{ prefs.txt('ভাড়ার তালিকা', 'Rent list') }}</p>
          <button (click)="exportRows()" class="inline-flex items-center gap-1 text-emerald-700 font-bold hover:underline cursor-pointer">
            <mat-icon class="text-sm">description</mat-icon> {{ prefs.txt('এক্সেল', 'Excel') }}
          </button>
        </div>
        <div class="hidden lg:block overflow-auto max-h-[62vh]">
          <table class="w-full min-w-[900px] text-xs text-left border-collapse">
            <thead>
              <tr class="text-white font-bold uppercase text-[11px] tracking-wider">
                <th class="p-2.5 w-10 text-center rent-sticky">SL</th>
                <th class="p-2.5 rent-sticky">{{ prefs.txt('ভাউচার', 'Voucher') }}</th>
                <th class="p-2.5 rent-sticky">{{ prefs.txt('খাত', 'Head') }}</th>
                <th class="p-2.5 rent-sticky">{{ prefs.txt('মাস', 'Month') }}</th>
                <th class="p-2.5 text-right rent-sticky">{{ prefs.txt('টাকা', 'Amount') }}</th>
                <th class="p-2.5 text-center rent-sticky">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</th>
                <th class="p-2.5 rent-sticky">{{ prefs.txt('অ্যাকাউন্ট', 'Account') }}</th>
                <th class="p-2.5 rent-sticky">{{ prefs.txt('তারিখ', 'Date') }}</th>
                <th class="p-2.5 rent-sticky">{{ prefs.txt('নোট', 'Note') }}</th>
                <th class="p-2.5 text-center w-24 rent-sticky">{{ prefs.txt('অ্যাকশন', 'Action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (r of pager.paged(); track r.id; let idx = $index) {
                <tr class="hover:bg-[#e2e8f0]">
                  <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-mono font-bold text-teal-700">{{ r.voucherNo }}</td>
                  <td class="p-2.5 font-semibold text-slate-800">{{ r.title }}</td>
                  <td class="p-2.5 font-mono text-slate-600">{{ monthName(r.month) }}</td>
                  <td class="p-2.5 text-right font-mono font-bold">{{ r.amount | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-center">
                    <span class="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="r.status === 'Paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                      {{ r.status === 'Paid' ? prefs.txt('পরিশোধিত', 'Paid') : prefs.txt('বাকি', 'Due') }}
                    </span>
                  </td>
                  <td class="p-2.5 text-slate-600">{{ r.status === 'Paid' ? accountName(r.accountId) : '—' }}</td>
                  <td class="p-2.5 text-slate-500">{{ displayDate(r.date) }}</td>
                  <td class="p-2.5 text-slate-500 max-w-[160px] truncate" [title]="r.note">{{ r.note || '—' }}</td>
                  <td class="p-2.5 text-center">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="openEdit(r)" class="p-1 text-amber-600 hover:bg-amber-100 rounded cursor-pointer" [title]="prefs.txt('এডিট', 'Edit')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      @if (session.has('deleteRecords')) {
                        <button (click)="remove(r)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer" [title]="prefs.txt('মুছুন', 'Delete')">
                          <mat-icon class="text-sm">delete</mat-icon>
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="10" class="p-10 text-center text-slate-400">
                  <mat-icon class="text-3xl text-slate-300">storefront</mat-icon>
                  <p class="text-xs font-semibold mt-1">{{ prefs.txt('এই মাসে কোনো ভাড়ার এন্ট্রি নেই।', 'No rent entries this month.') }}</p>
                </td></tr>
              }
            </tbody>
          </table>
        </div>
        <div class="lg:hidden divide-y divide-slate-100">
          @for (r of pager.paged(); track r.id) {
            <div class="p-3 flex items-start justify-between gap-2">
              <div>
                <p class="font-bold text-slate-800">{{ r.title }}</p>
                <p class="text-[10px] text-slate-500 font-mono">{{ r.voucherNo }} • {{ monthName(r.month) }}</p>
                <p class="text-[10px] text-slate-500">{{ displayDate(r.date) }} · {{ r.status === 'Paid' ? accountName(r.accountId) : prefs.txt('বাকি', 'Due') }}</p>
              </div>
              <div class="text-right">
                <p class="font-mono font-black text-slate-900">৳ {{ r.amount | number:'1.2-2' }}</p>
                <span class="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="r.status === 'Paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                  {{ r.status === 'Paid' ? prefs.txt('পরিশোধিত', 'Paid') : prefs.txt('বাকি', 'Due') }}
                </span>
              </div>
            </div>
          } @empty {
            <div class="p-8 text-center text-slate-400 text-xs font-semibold">{{ prefs.txt('এই মাসে কোনো ভাড়ার এন্ট্রি নেই।', 'No rent entries this month.') }}</div>
          }
        </div>
        <app-table-pagination [total]="pager.total()" [page]="pager.currentPage()" [pageSize]="pager.pageSize()"
          (pageChange)="pager.setPage($event)" (pageSizeChange)="pager.setPageSize($event)" />
      </div>
    </div>

    @if (formOpen()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3" (click)="closeForm()">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden text-slate-800" (click)="$event.stopPropagation()">
          <div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <p class="font-bold text-sm">{{ editingId() ? prefs.txt('ভাড়ার এন্ট্রি সম্পাদনা', 'Edit rent entry') : prefs.txt('নতুন ভাড়ার এন্ট্রি', 'New rent entry') }}</p>
            <button (click)="closeForm()" class="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full cursor-pointer">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>
          <div class="p-4 space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('খাত / বিবরণ', 'Head / description') }}</label>
                <input [(ngModel)]="formTitle" [placeholder]="prefs.txt('দোকান ভাড়া', 'Shop rent')" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-400">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('মাস', 'Month') }}</label>
                <input type="month" [(ngModel)]="formMonth" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('টাকার পরিমাণ', 'Amount') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg overflow-hidden">
                  <span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-2 border-r border-slate-300">৳</span>
                  <input type="number" step="0.01" min="0" [ngModel]="formAmount()" (ngModelChange)="formAmount.set(+$event || 0)"
                    class="w-full p-2 outline-none text-xs font-bold font-mono">
                </div>
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</label>
                <select [(ngModel)]="formStatus" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
                  <option value="Due">{{ prefs.txt('বাকি (এখনো দিইনি)', 'Due (not paid yet)') }}</option>
                  <option value="Paid">{{ prefs.txt('পরিশোধিত', 'Paid') }}</option>
                </select>
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('অ্যাকাউন্ট', 'Account') }}</label>
                <select [(ngModel)]="formAccountId" [disabled]="formStatus !== 'Paid'"
                  class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none disabled:bg-slate-100">
                  @for (a of accounts(); track a.id) {
                    <option [ngValue]="a.id">{{ a.name }} — ৳{{ data.walletBalance(a.id) | number:'1.2-2' }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('তারিখ', 'Date') }}</label>
                <input type="date" [(ngModel)]="formDate" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
              </div>
            </div>
            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('নোট', 'Note') }}</label>
              <input [(ngModel)]="formNote" [placeholder]="prefs.txt('মন্তব্য (ঐচ্ছিক)', 'Comment (optional)')" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs outline-none">
            </div>
            @if (formStatus === 'Paid') {
              <p class="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2">
                {{ prefs.txt('পরিশোধিত রাখলে', 'Marking it paid deducts') }} ৳{{ formAmount() | number:'1.2-2' }} {{ prefs.txt('মূল ব্যালেন্স থেকে কেটে নেওয়া হবে', 'from the main balance') }} ({{ prefs.txt('ভাউচার', 'voucher') }}: {{ editingId() ? prefs.txt('আপডেট', 'update') : prefs.txt('নতুন', 'new') }}).
              </p>
            }
          </div>
          <div class="bg-slate-50 px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="closeForm()" class="px-4 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
            <button (click)="save()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ', 'Save') }}
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class HrmRent {
  data = inject(DataService);
  prefs = inject(PreferencesService);
  private notify = inject(NotificationService);
  session = inject(SessionService);

  readonly month = signal(localDateIso().slice(0, 7));
  readonly accounts = computed(() => this.data.walletAccounts().filter(a => a.status === 'Enabled'));

  readonly filtered = computed(() => {
    const month = this.month();
    return [...this.data.rentPayments()]
      .filter(r => r.month === month)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  });

  readonly pager = createPager<RentPayment>(() => this.filtered());

  readonly totals = computed(() => {
    const rows = this.filtered();
    return {
      total: this.round(rows.reduce((acc, r) => acc + (r.amount || 0), 0)),
      paid: this.round(rows.filter(r => r.status === 'Paid').reduce((acc, r) => acc + (r.amount || 0), 0)),
      due: this.round(rows.filter(r => r.status === 'Due').reduce((acc, r) => acc + (r.amount || 0), 0))
    };
  });

  readonly formOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly formAmount = signal(0);
  formTitle = 'দোকান ভাড়া';
  formMonth = localDateIso().slice(0, 7);
  formStatus: RentPayment['status'] = 'Due';
  formAccountId: number | null = null;
  formDate = localDateIso();
  formNote = '';

  setMonth(value: string) {
    if (!value) return;
    this.month.set(value);
    this.pager.setPage(1);
  }

  monthLabel(): string {
    return this.monthName(this.month());
  }

  monthName(month: string): string {
    const parts = (month || '').split('-');
    const index = Number(parts[1]) - 1;
    const date = new Date(Number(parts[0]), index, 1);
    if (!parts[1] || Number.isNaN(date.getTime())) return month;
    return this.prefs.language() === 'bn'
      ? date.toLocaleDateString('bn-BD', { month: 'long', year: 'numeric' })
      : date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  displayDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (value || '-');
  }

  accountName(id: number): string {
    return this.data.walletAccounts().find(a => a.id === id)?.name || '—';
  }

  private round(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  openAdd() {
    this.editingId.set(null);
    this.formTitle = 'দোকান ভাড়া';
    this.formMonth = this.month();
    const previous = this.data.rentPayments()
      .filter(r => r.month === this.month())
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
    this.formAmount.set(previous?.amount ?? 0);
    this.formStatus = 'Due';
    this.formAccountId = this.accounts()[0]?.id ?? null;
    this.formDate = localDateIso();
    this.formNote = '';
    this.formOpen.set(true);
  }

  openEdit(r: RentPayment) {
    this.editingId.set(r.id);
    this.formTitle = r.title || 'দোকান ভাড়া';
    this.formMonth = r.month || this.month();
    this.formAmount.set(r.amount || 0);
    this.formStatus = r.status;
    this.formAccountId = r.accountId || this.accounts()[0]?.id || null;
    this.formDate = r.date || localDateIso();
    this.formNote = r.note || '';
    this.formOpen.set(true);
  }

  closeForm() {
    this.formOpen.set(false);
  }

  save() {
    const amount = this.round(this.formAmount());
    if (amount <= 0) {
      this.notify.warning(this.prefs.txt('ভাড়ার পরিমাণ লিখুন।', 'Enter the rent amount.'));
      return;
    }
    if (this.formStatus === 'Paid' && !this.formAccountId) {
      this.notify.warning(this.prefs.txt('কোন অ্যাকাউন্ট থেকে টাকা গেছে তা নির্বাচন করুন।', 'Select the account the money came from.'));
      return;
    }
    const payload = {
      month: this.formMonth || this.month(),
      title: (this.formTitle || 'দোকান ভাড়া').trim(),
      amount,
      date: this.formDate || localDateIso(),
      accountId: this.formAccountId ?? this.accounts()[0]?.id ?? 0,
      status: this.formStatus,
      note: (this.formNote || '').trim()
    };
    const id = this.editingId();
    if (id) {
      this.data.updateRentPayment(id, payload);
      this.notify.success(this.prefs.txt('ভাড়ার এন্ট্রি আপডেট হয়েছে।', 'Rent entry updated.'));
    } else {
      this.data.addRentPayment(payload);
      this.notify.success(this.formStatus === 'Paid'
        ? this.prefs.txt('ভাড়া পরিশোধ সংরক্ষিত — মূল ব্যালেন্স থেকে কাটা হয়েছে।', 'Rent payment saved — deducted from the main balance.')
        : this.prefs.txt('ভাড়ার বাকি এন্ট্রি সংরক্ষিত হয়েছে।', 'Unpaid rent entry saved.'));
    }
    this.closeForm();
    this.pager.setPage(1);
  }

  async remove(r: RentPayment) {
    const ok = await this.notify.confirm(
      this.prefs.txt(`${r.title} — ${this.monthName(r.month)} (৳${r.amount}). পরিশোধিত হলে টাকা মূল ব্যালেন্সে ফেরত যাবে।`, `${r.title} — ${this.monthName(r.month)} (৳${r.amount}). If paid, the amount will be refunded to the main balance.`),
      { title: this.prefs.txt('ভাড়ার এন্ট্রি মুছবেন?', 'Delete this rent entry?'), kind: 'error', confirmText: this.prefs.txt('মুছুন', 'Delete'), cancelText: this.prefs.txt('বাতিল', 'Cancel') }
    );
    if (!ok) return;
    this.data.deleteRentPayment(r.id);
    this.notify.success(this.prefs.txt('ভাড়ার এন্ট্রি মুছে ফেলা হয়েছে।', 'Rent entry deleted.'));
  }

  exportRows() {
    this.data.exportToExcel(this.filtered().map(r => ({
      Voucher: r.voucherNo,
      Title: r.title,
      Month: r.month,
      Amount: r.amount,
      Status: r.status,
      Account: r.status === 'Paid' ? this.accountName(r.accountId) : '',
      Date: r.date,
      Note: r.note
    })), `HRM_Rent_${this.month()}`);
  }
}
