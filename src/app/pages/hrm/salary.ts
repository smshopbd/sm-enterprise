import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, HrmStaff, SalaryPayment } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { SessionService } from '../../services/session';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';
import { HrmNav } from './hrm-nav';

interface PayrollRow {
  staff: HrmStaff;
  daysInMonth: number;
  present: number;
  late: number;
  leave: number;
  /** Leave days without pay; already excluded from paidDays. */
  unpaid: number;
  paidDays: number;
  perDay: number;
  basicPay: number;
  advanceOpen: number;
  netPay: number;
  paid?: SalaryPayment;
}

@Component({
  selector: 'app-hrm-salary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, HrmNav],
  styles: `
    .sal-sticky { position: sticky; top: 0; z-index: 5; background-color: var(--sm-brand, #0d9488); }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">
      <app-hrm-nav />

      <div class="bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 rounded-xl p-4 text-white shadow-sm">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-bold flex items-center gap-2"><mat-icon>payments</mat-icon> {{ prefs.txt('বেতন', 'Payroll') }}</h1>
            <p class="text-[11px] text-teal-50/90">{{ prefs.txt('হাজিরার দিন অনুযায়ী বেতন হিসাব — পরিশোধের টাকা সরাসরি মূল ব্যালেন্স থেকে কমবে।', 'Salary is calculated from attendance days — payments come straight out of the main balance.') }}</p>
          </div>
          <label class="inline-flex items-center gap-1.5 bg-white/15 border border-white/25 rounded-lg px-2.5 py-1.5 self-start sm:self-auto">
            <mat-icon class="text-sm">calendar_month</mat-icon>
            <input type="month" [ngModel]="month()" (ngModelChange)="setMonth($event)"
              class="bg-transparent outline-none text-xs font-bold text-white [color-scheme:dark]">
          </label>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('কর্মী', 'Employees') }}</p>
            <p class="text-lg font-black font-mono">{{ rows().length }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('মোট উপস্থিত দিন', 'Total attended days') }}</p>
            <p class="text-lg font-black font-mono">{{ totals().paidDays }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('বাকি বেতন', 'Salary due') }}</p>
            <p class="text-lg font-black font-mono">{{ totals().due | number:'1.0-2' }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('এই মাসে পরিশোধ', 'Paid this month') }}</p>
            <p class="text-lg font-black font-mono">{{ totals().paid | number:'1.0-2' }}</p>
          </div>
        </div>
      </div>

      <!-- Payroll table -->
      <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div class="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <p class="font-bold text-slate-900">{{ prefs.txt('মাসিক বেতন শিট', 'Monthly payroll sheet') }} — {{ monthLabel() }}</p>
          <button (click)="exportPayroll()" class="inline-flex items-center gap-1 text-emerald-700 font-bold hover:underline cursor-pointer">
            <mat-icon class="text-sm">description</mat-icon> {{ prefs.txt('এক্সেল', 'Excel') }}
          </button>
        </div>
        <div class="overflow-auto max-h-[62vh]">
          <table class="w-full min-w-[980px] text-xs text-left border-collapse">
            <thead>
              <tr class="text-white font-bold uppercase text-[11px] tracking-wider">
                <th class="p-2.5 w-10 text-center sal-sticky">SL</th>
                <th class="p-2.5 sal-sticky">{{ prefs.txt('কর্মচারী', 'Employee') }}</th>
                <th class="p-2.5 text-right sal-sticky">{{ prefs.txt('মাসিক বেতন', 'Monthly salary') }}</th>
                <th class="p-2.5 text-center sal-sticky">{{ prefs.txt('উপস্থিত / কাজের দিন', 'Attended / working days') }}</th>
                <th class="p-2.5 text-center sal-sticky">{{ prefs.txt('দেরি', 'Late') }}</th>
                <th class="p-2.5 text-center sal-sticky">{{ prefs.txt('ছুটি', 'Leave') }}</th>
                <th class="p-2.5 text-right sal-sticky">{{ prefs.txt('দিন-প্রতি', 'Per day') }}</th>
                <th class="p-2.5 text-right sal-sticky">{{ prefs.txt('প্রাপ্য', 'Earned') }}</th>
                <th class="p-2.5 text-right sal-sticky">{{ prefs.txt('অগ্রিম', 'Advance') }}</th>
                <th class="p-2.5 text-center sal-sticky">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</th>
                <th class="p-2.5 text-center w-32 sal-sticky">{{ prefs.txt('অ্যাকশন', 'Action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (r of pager.paged(); track r.staff.id; let idx = $index) {
                <tr class="hover:bg-[#e2e8f0] transition-colors">
                  <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5">
                    <div class="flex items-center gap-2">
                      <span class="w-7 h-7 rounded-full bg-teal-700/15 text-teal-700 flex items-center justify-center text-[10px] font-black">{{ initials(r.staff.name) }}</span>
                      <div>
                        <p class="font-bold text-teal-800">{{ r.staff.name }}</p>
                        <p class="text-[10px] text-slate-500 font-mono">{{ r.staff.code }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="p-2.5 text-right font-mono font-bold">{{ r.staff.monthlySalary | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-center">
                    <span class="font-mono font-bold text-slate-800">{{ r.paidDays }}</span>
                    <span class="text-slate-400"> / {{ r.daysInMonth }}</span>
                  </td>
                  <td class="p-2.5 text-center font-mono" [class]="r.late ? 'text-amber-600 font-bold' : 'text-slate-400'">{{ r.late }}</td>
                  <td class="p-2.5 text-center font-mono">
                    <span class="text-sky-600">{{ r.leave }}</span>
                    @if (r.unpaid) {
                      <span class="ml-0.5 inline-flex rounded px-1 py-0.5 text-[9px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                        [title]="prefs.txt('অবৈতনিক ছুটি — বেতন থেকে বাদ', 'Unpaid leave — excluded from pay')">−{{ r.unpaid }}</span>
                    }
                  </td>
                  <td class="p-2.5 text-right font-mono text-slate-600">{{ r.perDay | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-right font-mono font-bold text-slate-900">{{ r.basicPay | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-right font-mono" [class]="r.advanceOpen ? 'text-rose-600 font-bold' : 'text-slate-400'">{{ r.advanceOpen | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-center">
                    @if (r.paid) {
                      <span class="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800">{{ prefs.txt('পরিশোধিত', 'Paid') }}</span>
                    } @else {
                      <span class="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800">{{ prefs.txt('বাকি', 'Due') }}</span>
                    }
                  </td>
                  <td class="p-2.5 text-center">
                    @if (r.paid) {
                      <div class="flex items-center justify-center gap-1">
                        <span class="font-mono text-[11px] font-bold text-emerald-700">{{ r.paid.netPay | number:'1.2-2' }}</span>
                        @if (session.has('deleteRecords')) {
                          <button (click)="removePayment(r.paid)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer" [title]="prefs.txt('বেতন বাতিল', 'Cancel salary payment')">
                            <mat-icon class="text-sm">delete</mat-icon>
                          </button>
                        }
                      </div>
                    } @else {
                      <button (click)="openPay(r.staff)" class="inline-flex items-center gap-1 bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg cursor-pointer">
                        <mat-icon class="text-sm">payments</mat-icon> {{ prefs.txt('বেতন দিন', 'Pay salary') }}
                      </button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="11" class="p-10 text-center text-slate-400">
                    <mat-icon class="text-3xl text-slate-300">payments</mat-icon>
                    <p class="text-xs font-semibold mt-1">{{ prefs.txt('কোনো সক্রিয় কর্মচারী নেই।', 'No active employees.') }}</p>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-table-pagination [total]="pager.total()" [page]="pager.currentPage()" [pageSize]="pager.pageSize()"
          (pageChange)="pager.setPage($event)" (pageSizeChange)="pager.setPageSize($event)" />
      </div>

      <!-- Payment history -->
      <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div class="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <p class="font-bold text-slate-900">{{ prefs.txt('বেতন পরিশোধের ইতিহাস', 'Salary payment history') }}</p>
          <span class="text-[11px] text-slate-500">{{ history().length }} {{ prefs.txt('টি ভাউচার', 'vouchers') }}</span>
        </div>
        <div class="overflow-auto max-h-[50vh]">
          <table class="w-full min-w-[860px] text-xs text-left border-collapse">
            <thead>
              <tr class="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                <th class="p-2.5">{{ prefs.txt('ভাউচার', 'Voucher') }}</th>
                <th class="p-2.5">{{ prefs.txt('কর্মচারী', 'Employee') }}</th>
                <th class="p-2.5">{{ prefs.txt('মাস', 'Month') }}</th>
                <th class="p-2.5 text-center">{{ prefs.txt('দিন', 'Days') }}</th>
                <th class="p-2.5 text-right">{{ prefs.txt('বেসিক', 'Basic') }}</th>
                <th class="p-2.5 text-right">{{ prefs.txt('ভাতা', 'Allowance') }}</th>
                <th class="p-2.5 text-right">{{ prefs.txt('কর্তন', 'Deduction') }}</th>
                <th class="p-2.5 text-right">{{ prefs.txt('অগ্রিম', 'Advance') }}</th>
                <th class="p-2.5 text-right">{{ prefs.txt('নেট', 'Net') }}</th>
                <th class="p-2.5">{{ prefs.txt('অ্যাকাউন্ট', 'Account') }}</th>
                <th class="p-2.5">{{ prefs.txt('তারিখ', 'Date') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (p of historyPager.paged(); track p.id) {
                <tr class="hover:bg-[#e2e8f0]">
                  <td class="p-2.5 font-mono font-bold text-teal-700">{{ p.voucherNo }}</td>
                  <td class="p-2.5 font-semibold">{{ p.staffName }}</td>
                  <td class="p-2.5 font-mono">{{ monthName(p.month) }}</td>
                  <td class="p-2.5 text-center font-mono">{{ p.presentDays + p.lateDays + p.leaveDays }}/{{ p.workingDays }}</td>
                  <td class="p-2.5 text-right font-mono">{{ p.basicPay | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-right font-mono text-emerald-700">{{ p.allowance | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-right font-mono text-rose-600">{{ p.deduction | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-right font-mono text-amber-700">{{ p.advanceAdjusted | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-right font-mono font-bold">{{ p.netPay | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-slate-600">{{ accountName(p.accountId) }}</td>
                  <td class="p-2.5 text-slate-500">{{ displayDate(p.date) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="11" class="p-8 text-center text-slate-400 text-xs font-semibold">{{ prefs.txt('এখনো কোনো বেতন পরিশোধ হয়নি।', 'No salary has been paid yet.') }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        <app-table-pagination [total]="historyPager.total()" [page]="historyPager.currentPage()" [pageSize]="historyPager.pageSize()"
          (pageChange)="historyPager.setPage($event)" (pageSizeChange)="historyPager.setPageSize($event)" />
      </div>
    </div>

    <!-- Pay modal -->
    @if (payStaff(); as s) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3" (click)="closePay()">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden text-slate-800" (click)="$event.stopPropagation()">
          <div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <p class="font-bold text-sm">{{ prefs.txt('বেতন পরিশোধ', 'Pay salary') }} — {{ s.name }}</p>
              <p class="text-[10px] text-slate-500">{{ s.code }} · {{ monthLabel() }}</p>
            </div>
            <button (click)="closePay()" class="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full cursor-pointer">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>

          <div class="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div><p class="text-[10px] text-slate-500 font-bold">{{ prefs.txt('উপস্থিত', 'Attended') }}</p><p class="font-mono font-black">{{ pay().paidDays }}</p></div>
              <div><p class="text-[10px] text-slate-500 font-bold">{{ prefs.txt('দিন-প্রতি', 'Per day') }}</p><p class="font-mono font-black">{{ pay().perDay | number:'1.2-2' }}</p></div>
              <div><p class="text-[10px] text-slate-500 font-bold">{{ prefs.txt('বেসিক', 'Basic') }}</p><p class="font-mono font-black">{{ pay().basicPay | number:'1.2-2' }}</p></div>
              <div><p class="text-[10px] text-slate-500 font-bold">{{ prefs.txt('অগ্রিম বাকি', 'Advance due') }}</p><p class="font-mono font-black text-rose-600">{{ pay().advanceOpen | number:'1.2-2' }}</p></div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ভাতা', 'Allowance') }}</label>
                <input type="number" step="0.01" min="0" [ngModel]="formAllowance()" (ngModelChange)="formAllowance.set(+$event || 0)"
                  class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-teal-400">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('কর্তন', 'Deduction') }}</label>
                <input type="number" step="0.01" min="0" [ngModel]="formDeduction()" (ngModelChange)="formDeduction.set(+$event || 0)"
                  class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-teal-400">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('অগ্রিম সমন্বয়', 'Advance adjustment') }}</label>
                <input type="number" step="0.01" min="0" [ngModel]="formAdvance()" (ngModelChange)="formAdvance.set(+$event || 0)"
                  class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-bold font-mono outline-none focus:ring-2 focus:ring-teal-400">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('যে অ্যাকাউন্ট থেকে দিচ্ছেন', 'Account to pay from') }}</label>
                <select [(ngModel)]="formAccountId" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-400">
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

            <div class="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
              <span class="font-bold text-emerald-800">{{ prefs.txt('নেট প্রদেয়', 'Net payable') }}</span>
              <span class="font-mono font-black text-lg text-emerald-700">৳ {{ netPay() | number:'1.2-2' }}</span>
            </div>
            <p class="text-[10px] text-slate-400">{{ prefs.txt('পরিশোধ করলে এই টাকা “মূল ব্যালেন্স” (ওয়ালেট) থেকে কমে যাবে এবং অগ্রিম বাকি থাকলে তা সমন্বয় হবে।', 'Paying deducts this amount from the “main balance” (wallet) and adjusts any open advance.') }}</p>
          </div>

          <div class="bg-slate-50 px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="closePay()" class="px-4 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
            <button (click)="confirmPay()" [disabled]="payable() <= 0"
              class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('বেতন পরিশোধ করুন', 'Pay salary') }}
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class HrmSalary {
  data = inject(DataService);
  prefs = inject(PreferencesService);
  private notify = inject(NotificationService);
  session = inject(SessionService);

  readonly month = signal(localDateIso().slice(0, 7));
  readonly payStaff = signal<HrmStaff | null>(null);
  readonly accounts = computed(() => this.data.walletAccounts().filter(a => a.status === 'Enabled'));

  readonly rows = computed<PayrollRow[]>(() => {
    const month = this.month();
    const parts = month.split('-');
    const year = Number(parts[0]);
    const mon = Number(parts[1]);
    const daysInMonth = year && mon ? new Date(year, mon, 0).getDate() : 30;
    const records = this.data.attendanceInMonth(month);
    return this.data.hrmStaff()
      .filter(s => s.status !== 'Inactive')
      .map(staff => {
        const mine = records.filter(a => a.staffId === staff.id);
        const present = mine.filter(a => a.status === 'Present').length;
        const late = mine.filter(a => a.status === 'Late').length;
        const leave = mine.filter(a => a.status === 'Leave').length;
        const paidDays = present + late + leave;
        const perDay = this.round(staff.monthlySalary / daysInMonth);
        const basicPay = this.round(perDay * paidDays);
        const advanceOpen = this.advanceOpen(staff);
        return {
          staff,
          daysInMonth,
          present,
          late,
          leave,
          unpaid: this.data.unpaidLeaveInMonth(staff.id, month),
          paidDays,
          perDay,
          basicPay,
          advanceOpen,
          netPay: this.round(Math.max(0, basicPay - Math.min(advanceOpen, basicPay))),
          paid: this.data.salaryPaidFor(staff.id, month)
        };
      });
  });

  readonly pager = createPager<PayrollRow>(() => this.rows());
  readonly history = computed(() => [...this.data.salaryPayments()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
  readonly historyPager = createPager<SalaryPayment>(() => this.history());

  readonly totals = computed(() => {
    const rows = this.rows();
    return {
      paidDays: rows.reduce((acc, r) => acc + r.paidDays, 0),
      due: this.round(rows.filter(r => !r.paid).reduce((acc, r) => acc + r.netPay, 0)),
      paid: this.round(rows.filter(r => r.paid).reduce((acc, r) => acc + (r.paid!.netPay || 0), 0))
    };
  });

  // pay form
  readonly formAllowance = signal(0);
  readonly formDeduction = signal(0);
  readonly formAdvance = signal(0);
  formAccountId: number | null = null;
  formDate = localDateIso();
  formNote = '';

  readonly pay = computed(() => {
    const staff = this.payStaff();
    if (!staff) return { paidDays: 0, perDay: 0, basicPay: 0, advanceOpen: 0 };
    const row = this.buildRow(staff);
    return { paidDays: row.paidDays, perDay: row.perDay, basicPay: row.basicPay, advanceOpen: row.advanceOpen };
  });

  /** Salary + allowance − deduction: what is owed before any advance is adjusted. */
  readonly payable = computed(() => {
    const p = this.pay();
    return this.round(p.basicPay + this.formAllowance() - this.formDeduction());
  });

  readonly netPay = computed(() => {
    return this.round(Math.max(0, this.payable() - this.formAdvance()));
  });

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

  initials(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  accountName(id: number): string {
    return this.data.walletAccounts().find(a => a.id === id)?.name || '—';
  }

  private round(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private advanceOpen(staff: HrmStaff): number {
    return this.data.staffAdvanceOpen(staff.id, staff.name);
  }

  private buildRow(staff: HrmStaff): PayrollRow {
    const month = this.month();
    const parts = month.split('-');
    const daysInMonth = new Date(Number(parts[0]), Number(parts[1]), 0).getDate() || 30;
    const mine = this.data.attendanceInMonth(month).filter(a => a.staffId === staff.id);
    const present = mine.filter(a => a.status === 'Present').length;
    const late = mine.filter(a => a.status === 'Late').length;
    const leave = mine.filter(a => a.status === 'Leave').length;
    const paidDays = present + late + leave;
    const perDay = this.round(staff.monthlySalary / daysInMonth);
    const basicPay = this.round(perDay * paidDays);
    const advanceOpen = this.advanceOpen(staff);
    return {
      staff,
      daysInMonth,
      present,
      late,
      leave,
      unpaid: this.data.unpaidLeaveInMonth(staff.id, month),
      paidDays,
      perDay,
      basicPay,
      advanceOpen,
      netPay: this.round(Math.max(0, basicPay - Math.min(advanceOpen, basicPay))),
      paid: this.data.salaryPaidFor(staff.id, month)
    };
  }

  openPay(staff: HrmStaff) {
    if (this.data.salaryPaidFor(staff.id, this.month())) {
      this.notify.info(this.prefs.txt(`${staff.name} — ${this.monthLabel()} মাসের বেতন আগেই পরিশোধ হয়েছে।`, `${staff.name} — salary for ${this.monthLabel()} has already been paid.`));
      return;
    }
    const row = this.buildRow(staff);
    this.payStaff.set(staff);
    this.formAllowance.set(0);
    this.formDeduction.set(0);
    this.formAdvance.set(this.round(Math.min(row.advanceOpen, row.basicPay)));
    this.formAccountId = this.accounts()[0]?.id ?? null;
    this.formDate = localDateIso();
    this.formNote = '';
  }

  closePay() {
    this.payStaff.set(null);
  }

  confirmPay() {
    const staff = this.payStaff();
    const row = staff ? this.buildRow(staff) : null;
    if (!staff || !row) return;
    // A salary fully covered by an advance moves no cash, so no account is needed.
    if (this.netPay() > 0 && !this.formAccountId) {
      this.notify.warning(this.prefs.txt('টাকা কাটা হবে এমন একটি অ্যাকাউন্ট নির্বাচন করুন।', 'Select an account to deduct the money from.'));
      return;
    }
    if (this.data.salaryPaidFor(staff.id, this.month())) {
      this.notify.warning(this.prefs.txt('এই মাসের বেতন আগেই পরিশোধ হয়েছে।', 'This month’s salary has already been paid.'));
      this.closePay();
      return;
    }
    const allowance = this.round(this.formAllowance());
    const deduction = this.round(this.formDeduction());
    const advance = this.round(Math.min(this.formAdvance(), row.advanceOpen));

    this.data.addSalaryPayment({
      staffId: staff.id,
      staffCode: staff.code,
      staffName: staff.name,
      month: this.month(),
      workingDays: row.daysInMonth,
      presentDays: row.present,
      lateDays: row.late,
      leaveDays: row.leave,
      monthlySalary: staff.monthlySalary,
      perDay: row.perDay,
      basicPay: row.basicPay,
      allowance,
      deduction,
      advanceAdjusted: advance,
      netPay: this.netPay(),
      date: this.formDate || localDateIso(),
      accountId: this.formAccountId ?? 0,
      note: (this.formNote || '').trim()
    });
    this.notify.success(this.netPay() > 0
      ? this.prefs.txt(`${staff.name} — ৳${this.netPay()} বেতন পরিশোধ হয়েছে (মূল ব্যালেন্স থেকে কাটা হয়েছে)।`, `${staff.name} — ৳${this.netPay()} salary paid (deducted from the main balance).`)
      : this.prefs.txt(`${staff.name} — পুরো বেতন অগ্রিম দিয়ে সমন্বয় হয়েছে, কোনো নগদ প্রযোজ্য নয়।`, `${staff.name} — the salary was fully adjusted against the advance; no cash is due.`));
    this.closePay();
    this.pager.setPage(1);
    this.historyPager.setPage(1);
  }

  async removePayment(payment: SalaryPayment) {
    const ok = await this.notify.confirm(
      this.prefs.txt(`${payment.staffName} — ${this.monthName(payment.month)} মাসের বেতন ভাউচার মুছে গেলে ওয়ালেটের টাকা ফেরত যোগ হবে।`, `${payment.staffName} — deleting the ${this.monthName(payment.month)} salary voucher will refund the wallet.`),
      { title: this.prefs.txt('বেতন ভাউচার বাতিল করবেন?', 'Cancel this salary voucher?'), kind: 'error', confirmText: this.prefs.txt('মুছুন', 'Delete'), cancelText: this.prefs.txt('বাতিল', 'Cancel') }
    );
    if (!ok) return;
    this.data.deleteSalaryPayment(payment.id);
    this.notify.success(this.prefs.txt('বেতন ভাউচার বাতিল হয়েছে, টাকা মূল ব্যালেন্সে ফেরত গেছে।', 'Salary voucher cancelled, the money went back to the main balance.'));
  }

  exportPayroll() {
    this.data.exportToExcel(this.rows().map(r => ({
      Code: r.staff.code,
      Name: r.staff.name,
      Month: this.month(),
      MonthlySalary: r.staff.monthlySalary,
      Present: r.present,
      Late: r.late,
      Leave: r.leave,
      UnpaidLeave: r.unpaid,
      PaidDays: r.paidDays,
      WorkingDays: r.daysInMonth,
      PerDay: r.perDay,
      BasicPay: r.basicPay,
      AdvanceOpen: r.advanceOpen,
      Status: r.paid ? 'Paid' : 'Due'
    })), `HRM_Payroll_${this.month()}`);
  }
}
