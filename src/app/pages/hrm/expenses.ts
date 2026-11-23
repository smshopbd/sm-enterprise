import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, Expense } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { SessionService } from '../../services/session';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';
import { HrmNav } from './hrm-nav';

const CATEGORIES = [
  'দোকান খরচ', 'পরিবহন', 'বিদ্যুৎ বিল', 'পানির বিল', 'মোবাইল বিল',
  'চা-নাস্তা', 'মেরামত', 'স্টেশনারি', 'অন্যান্য'
];

@Component({
  selector: 'app-hrm-expenses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, HrmNav],
  styles: `
    .exp-sticky { position: sticky; top: 0; z-index: 5; background-color: var(--sm-brand, #0d9488); }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">
      <app-hrm-nav />

      <div class="bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 rounded-xl p-4 text-white shadow-sm">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-bold flex items-center gap-2"><mat-icon>receipt_long</mat-icon> {{ prefs.txt('দোকানের দৈনিক খরচ', 'Daily shop expense') }}</h1>
            <p class="text-[11px] text-teal-50/90">{{ prefs.txt('প্রতিটি খরচ নির্বাচিত অ্যাকাউন্ট থেকে কাটা হবে — মূল ব্যালেন্স সঙ্গে সঙ্গে আপডেট হবে।', 'Every expense is deducted from the selected account — the main balance updates instantly.') }}</p>
          </div>
          <div class="flex items-center gap-2">
            <label class="inline-flex items-center gap-1.5 bg-white/15 border border-white/25 rounded-lg px-2.5 py-1.5">
              <mat-icon class="text-sm">calendar_month</mat-icon>
              <input type="month" [ngModel]="month()" (ngModelChange)="setMonth($event)"
                class="bg-transparent outline-none text-xs font-bold text-white [color-scheme:dark]">
            </label>
            <button (click)="openAdd()" class="inline-flex items-center gap-1 bg-white text-teal-800 font-bold px-3 py-2 rounded-lg shadow-2xs cursor-pointer hover:bg-teal-50">
              <mat-icon class="text-sm">add_circle</mat-icon> {{ prefs.txt('খরচ যোগ', 'Add expense') }}
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('আজকের খরচ', "Today's expense") }}</p>
            <p class="text-lg font-black font-mono">{{ todayTotal() | number:'1.0-2' }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('এই মাসের খরচ', 'This month') }}</p>
            <p class="text-lg font-black font-mono">{{ monthTotal() | number:'1.0-2' }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('এন্ট্রি', 'Entries') }}</p>
            <p class="text-lg font-black font-mono">{{ filtered().length }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('মূল ব্যালেন্স', 'Main balance') }}</p>
            <p class="text-lg font-black font-mono">{{ data.mainBalance() | number:'1.0-2' }}</p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div class="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
          <p class="font-bold text-slate-900">{{ monthLabel() }} — {{ prefs.txt('খরচের তালিকা', 'Expense list') }}</p>
          <div class="flex items-center gap-3">
            <span class="text-[10px] text-slate-400 hidden sm:inline">{{ prefs.txt('অ্যাকাউন্ট ছাড়া পুরোনো খরচ ব্যালেন্সে পোস্ট হয়নি', 'Older expenses without an account were not posted to the balance') }}</span>
            <button (click)="exportRows()" class="inline-flex items-center gap-1 text-emerald-700 font-bold hover:underline cursor-pointer">
              <mat-icon class="text-sm">description</mat-icon> Excel
            </button>
          </div>
        </div>
        <div class="hidden lg:block overflow-auto max-h-[62vh]">
          <table class="w-full min-w-[860px] text-xs text-left border-collapse">
            <thead>
              <tr class="text-white font-bold uppercase text-[11px] tracking-wider">
                <th class="p-2.5 w-10 text-center exp-sticky">SL</th>
                <th class="p-2.5 exp-sticky">{{ prefs.txt('খরচ', 'Expense') }}</th>
                <th class="p-2.5 exp-sticky">{{ prefs.txt('ক্যাটাগরি', 'Category') }}</th>
                <th class="p-2.5 exp-sticky">{{ prefs.txt('তারিখ', 'Date') }}</th>
                <th class="p-2.5 text-right exp-sticky">{{ prefs.txt('টাকা', 'Amount') }}</th>
                <th class="p-2.5 exp-sticky">{{ prefs.txt('অ্যাকাউন্ট', 'Account') }}</th>
                <th class="p-2.5 exp-sticky">{{ prefs.txt('নোট', 'Note') }}</th>
                <th class="p-2.5 text-center w-24 exp-sticky">{{ prefs.txt('অ্যাকশন', 'Actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (e of pager.paged(); track e.id; let idx = $index) {
                <tr class="hover:bg-[#e2e8f0]">
                  <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-semibold text-slate-800">{{ e.title }}</td>
                  <td class="p-2.5">
                    <span class="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600">{{ categoryLabel(e.category) }}</span>
                  </td>
                  <td class="p-2.5 text-slate-500">{{ displayDate(e.date) }}</td>
                  <td class="p-2.5 text-right font-mono font-bold text-rose-600">{{ e.amount | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-slate-600">
                    @if (e.accountId) {
                      {{ accountName(e.accountId) }}
                    } @else {
                      <span class="text-[10px] text-amber-600 font-semibold">{{ prefs.txt('পোস্ট হয়নি', 'Not posted') }}</span>
                    }
                  </td>
                  <td class="p-2.5 text-slate-500 max-w-[200px] truncate" [title]="e.note">{{ e.note || '—' }}</td>
                  <td class="p-2.5 text-center">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="openEdit(e)" class="p-1 text-amber-600 hover:bg-amber-100 rounded cursor-pointer" [title]="prefs.txt('এডিট', 'Edit')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      @if (session.has('deleteRecords')) {
                        <button (click)="remove(e)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer" [title]="prefs.txt('মুছুন', 'Delete')">
                          <mat-icon class="text-sm">delete</mat-icon>
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="p-10 text-center text-slate-400">
                  <mat-icon class="text-3xl text-slate-300">receipt_long</mat-icon>
                  <p class="text-xs font-semibold mt-1">{{ prefs.txt('এই মাসে কোনো খরচ যোগ করা হয়নি।', 'No expenses recorded this month.') }}</p>
                </td></tr>
              }
            </tbody>
          </table>
        </div>
        <div class="lg:hidden divide-y divide-slate-100">
          @for (e of pager.paged(); track e.id) {
            <div class="p-3 flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-bold text-slate-800 truncate">{{ e.title }}</p>
                <p class="text-[10px] text-slate-500">{{ categoryLabel(e.category) }} • {{ displayDate(e.date) }}</p>
                <p class="text-[10px] text-slate-500">{{ e.accountId ? accountName(e.accountId) : prefs.txt('ব্যালেন্সে পোস্ট হয়নি', 'Not posted to balance') }}</p>
              </div>
              <div class="text-right shrink-0">
                <p class="font-mono font-black text-rose-600">৳ {{ e.amount | number:'1.2-2' }}</p>
                <div class="flex items-center gap-1 justify-end mt-1">
                  <button (click)="openEdit(e)" class="p-1 text-amber-600 hover:bg-amber-100 rounded cursor-pointer"><mat-icon class="text-sm">edit</mat-icon></button>
                  @if (session.has('deleteRecords')) {
                    <button (click)="remove(e)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer"><mat-icon class="text-sm">delete</mat-icon></button>
                  }
                </div>
              </div>
            </div>
          } @empty {
            <div class="p-8 text-center text-slate-400 text-xs font-semibold">{{ prefs.txt('এই মাসে কোনো খরচ যোগ করা হয়নি।', 'No expenses recorded this month.') }}</div>
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
            <p class="font-bold text-sm">{{ editingId() ? prefs.txt('খরচ সম্পাদনা', 'Edit expense') : prefs.txt('নতুন দৈনিক খরচ', 'New daily expense') }}</p>
            <button (click)="closeForm()" class="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full cursor-pointer">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>
          <div class="p-4 space-y-3">
            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('খরচের বিবরণ', 'Expense description') }}</label>
              <input [(ngModel)]="formTitle" [placeholder]="prefs.txt('যেমন: দোকানের চা-নাস্তা', 'e.g. shop tea & snacks')" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-400">
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ক্যাটাগরি', 'Category') }}</label>
                <select [(ngModel)]="formCategory" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
                  @for (c of categories; track c) {
                    <option [value]="c">{{ categoryLabel(c) }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('টাকার পরিমাণ', 'Amount') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg overflow-hidden">
                  <span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-2 border-r border-slate-300">৳</span>
                  <input type="number" step="0.01" min="0" [ngModel]="formAmount()" (ngModelChange)="formAmount.set(+$event || 0)"
                    class="w-full p-2 outline-none text-xs font-bold font-mono">
                </div>
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('অ্যাকাউন্ট', 'Account') }}</label>
                <select [(ngModel)]="formAccountId" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
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
          </div>
          <div class="bg-slate-50 px-4 py-3 border-t border-slate-200 flex justify-between items-center gap-2">
            <span class="text-[11px] font-bold text-emerald-700">{{ prefs.txt('মূল ব্যালেন্স থেকে কাটবে:', 'Deducted from main balance:') }} ৳{{ formAmount() | number:'1.2-2' }}</span>
            <div class="flex gap-2">
              <button (click)="closeForm()" class="px-4 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
              <button (click)="save()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ', 'Save') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `
})
export class HrmExpenses {
  data = inject(DataService);
  prefs = inject(PreferencesService);
  private notify = inject(NotificationService);
  session = inject(SessionService);

  readonly categories = CATEGORIES;
  readonly month = signal(localDateIso().slice(0, 7));
  readonly accounts = computed(() => this.data.walletAccounts().filter(a => a.status === 'Enabled'));

  readonly filtered = computed(() => {
    const month = this.month();
    return [...this.data.expenses()]
      .filter(e => (e.date || '').startsWith(month))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  });

  readonly pager = createPager<Expense>(() => this.filtered());

  readonly monthTotal = computed(() => this.round(this.filtered().reduce((acc, e) => acc + (e.amount || 0), 0)));

  readonly todayTotal = computed(() => {
    const today = localDateIso();
    return this.round(this.data.expenses().filter(e => e.date === today).reduce((acc, e) => acc + (e.amount || 0), 0));
  });

  readonly formOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly formAmount = signal(0);
  formTitle = '';
  formCategory = CATEGORIES[0];
  formAccountId: number | null = null;
  formDate = localDateIso();
  formNote = '';

  setMonth(value: string) {
    if (!value) return;
    this.month.set(value);
    this.pager.setPage(1);
  }

  monthLabel(): string {
    const parts = this.month().split('-');
    const index = Number(parts[1]) - 1;
    const date = new Date(Number(parts[0]), index, 1);
    if (!parts[1] || Number.isNaN(date.getTime())) return this.month();
    return this.prefs.language() === 'bn'
      ? date.toLocaleDateString('bn-BD', { month: 'long', year: 'numeric' })
      : date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  categoryLabel(value: string): string {
    const map: Record<string, [string, string]> = {
      'দোকান খরচ': ['দোকান খরচ', 'Shop expense'],
      'পরিবহন': ['পরিবহন', 'Transport'],
      'বিদ্যুৎ বিল': ['বিদ্যুৎ বিল', 'Electricity bill'],
      'পানির বিল': ['পানির বিল', 'Water bill'],
      'মোবাইল বিল': ['মোবাইল বিল', 'Mobile bill'],
      'চা-নাস্তা': ['চা-নাস্তা', 'Tea & snacks'],
      'মেরামত': ['মেরামত', 'Repairs'],
      'স্টেশনারি': ['স্টেশনারি', 'Stationery'],
      'অন্যান্য': ['অন্যান্য', 'Other']
    };
    const pair = map[value];
    return pair ? this.prefs.txt(pair[0], pair[1]) : (value || '—');
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
    this.formTitle = '';
    this.formCategory = CATEGORIES[0];
    this.formAmount.set(0);
    this.formAccountId = this.accounts()[0]?.id ?? null;
    this.formDate = localDateIso();
    this.formNote = '';
    this.formOpen.set(true);
  }

  openEdit(e: Expense) {
    this.editingId.set(e.id);
    this.formTitle = e.title;
    this.formCategory = e.category || CATEGORIES[0];
    this.formAmount.set(e.amount || 0);
    this.formAccountId = e.accountId ?? this.accounts()[0]?.id ?? null;
    this.formDate = e.date || localDateIso();
    this.formNote = e.note || '';
    this.formOpen.set(true);
  }

  closeForm() {
    this.formOpen.set(false);
  }

  save() {
    const title = (this.formTitle || '').trim();
    if (!title) {
      this.notify.warning(this.prefs.txt('খরচের বিবরণ লিখুন।', 'Enter an expense description.'));
      return;
    }
    const amount = this.round(this.formAmount());
    if (amount <= 0) {
      this.notify.warning(this.prefs.txt('খরচের পরিমাণ লিখুন।', 'Enter the expense amount.'));
      return;
    }
    if (!this.formAccountId) {
      this.notify.warning(this.prefs.txt('কোন অ্যাকাউন্ট থেকে টাকা গেছে তা নির্বাচন করুন।', 'Select the account the money came from.'));
      return;
    }
    const payload = {
      title,
      amount,
      category: this.formCategory,
      date: this.formDate || localDateIso(),
      note: (this.formNote || '').trim(),
      accountId: this.formAccountId
    };
    const id = this.editingId();
    if (id) {
      this.data.updateExpense(id, payload);
      this.notify.success(this.prefs.txt('খরচ আপডেট হয়েছে — মূল ব্যালেন্স সমন্বয় হয়েছে।', 'Expense updated — main balance adjusted.'));
    } else {
      this.data.addExpense(payload);
      this.notify.success(this.prefs.txt(`৳${amount} খরচ সংরক্ষিত — মূল ব্যালেন্স থেকে কাটা হয়েছে।`, `৳${amount} expense saved — deducted from the main balance.`));
    }
    this.closeForm();
    this.pager.setPage(1);
  }

  async remove(e: Expense) {
    const ok = await this.notify.confirm(
      `${e.title} — ৳${e.amount}. ${e.accountId ? this.prefs.txt('টাকা মূল ব্যালেন্সে ফেরত যাবে।', 'The amount will be returned to the main balance.') : ''}`,
      { title: this.prefs.txt('খরচ মুছবেন?', 'Delete this expense?'), kind: 'error', confirmText: this.prefs.txt('মুছুন', 'Delete'), cancelText: this.prefs.txt('বাতিল', 'Cancel') }
    );
    if (!ok) return;
    this.data.deleteExpense(e.id);
    this.notify.success(this.prefs.txt('খরচ মুছে ফেলা হয়েছে।', 'Expense deleted.'));
  }

  exportRows() {
    this.data.exportToExcel(this.filtered().map(e => ({
      Title: e.title,
      Category: e.category,
      Date: e.date,
      Amount: e.amount,
      Account: e.accountId ? this.accountName(e.accountId) : '',
      Note: e.note
    })), `HRM_Daily_Expense_${this.month()}`);
  }
}
