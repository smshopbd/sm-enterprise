import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, HrmLeave, LeaveStatus, LeaveType } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { SessionService } from '../../services/session';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';
import { DmyDateDirective } from '../../directives/dmy-date.directive';
import { HrmNav } from './hrm-nav';

interface LeaveRow extends HrmLeave {
  days: number;
  monthDays: number;
}

type LeaveTab = 'All' | LeaveStatus;

/**
 * Leave requests. Approval writes attendance rows for the range, so this page
 * is the single place that decides which days count as paid leave.
 */
@Component({
  selector: 'app-hrm-leave',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, DmyDateDirective, HrmNav],
  styles: `
    .lv-sticky { position: sticky; top: 0; z-index: 5; background-color: var(--sm-brand, #0d9488); }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">
      <app-hrm-nav />

      <!-- Header -->
      <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-lg">event_busy</mat-icon>
            </span>
            <div>
              <h1 class="text-xl font-bold">{{ prefs.txt('ছুটি ব্যবস্থাপনা', 'Leave Management') }}</h1>
              <p class="text-[11px] text-teal-50/85">{{ prefs.txt('আবেদন → অনুমোদন → হাজিরা ও বেতনে প্রতিফলন', 'Request → approval → reflected in attendance and payroll') }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <label class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5">
              <mat-icon class="text-sm">calendar_month</mat-icon>
              <input type="month" [ngModel]="month()" (ngModelChange)="setMonth($event)"
                class="bg-transparent outline-none text-[11px] font-bold text-white [color-scheme:dark]">
            </label>
            <button (click)="exportExcel()" class="flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon style="font-size:15px;width:15px;height:15px;">description</mat-icon> Excel
            </button>
            <button (click)="openAdd()" class="flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon style="font-size:15px;width:15px;height:15px;">add</mat-icon> {{ prefs.txt('নতুন ছুটি', 'New leave') }}
            </button>
          </div>
        </div>
        <div class="relative mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('অপেক্ষমাণ', 'Pending') }}</p>
            <p class="font-mono text-lg font-black">{{ stats().pending }}</p>
          </div>
          <div class="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('আজ ছুটিতে', 'On leave today') }}</p>
            <p class="font-mono text-lg font-black">{{ stats().today }}</p>
          </div>
          <div class="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('এই মাসে বেতনসহ ছুটি', 'Paid leave this month') }}</p>
            <p class="font-mono text-lg font-black">{{ stats().paidDays }} <span class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('দিন', 'days') }}</span></p>
          </div>
          <div class="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('অবৈতনিক ছুটি', 'Unpaid leave') }}</p>
            <p class="font-mono text-lg font-black">{{ stats().unpaidDays }}</p>
          </div>
        </div>
      </div>

      <!-- Status tabs + search -->
      <div class="no-print flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-1 overflow-x-auto">
          @for (t of tabDefs(); track t.value) {
            <button (click)="setTab(t.value)"
              class="shrink-0 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors"
              [class]="activeTab() === t.value ? 'bg-teal-700 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'">
              <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
              <span>{{ t.label }}</span>
              <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-black"
                [class]="activeTab() === t.value ? 'bg-white/25' : 'border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'">{{ tabCount(t.value) }}</span>
            </button>
          }
        </div>
        <div class="relative w-full sm:max-w-xs">
          <mat-icon class="absolute left-3 top-2.5 text-sm text-slate-400">search</mat-icon>
          <input type="text" [value]="searchQuery()" (input)="setSearch($any($event.target).value)"
            [placeholder]="prefs.txt('কর্মচারীর নাম বা কারণ…', 'Employee name or reason…')"
            class="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-teal-400">
        </div>
      </div>

      <!-- Table -->
      <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div class="max-h-[66vh] overflow-auto">
          <table class="w-full min-w-[920px] border-collapse text-left text-xs">
            <thead>
              <tr class="text-[11px] font-bold uppercase tracking-wider text-white">
                <th class="w-10 p-2.5 text-center lv-sticky">SL</th>
                <th class="p-2.5 lv-sticky">{{ prefs.txt('কর্মচারী', 'Employee') }}</th>
                <th class="p-2.5 lv-sticky">{{ prefs.txt('ধরন', 'Type') }}</th>
                <th class="p-2.5 lv-sticky">{{ prefs.txt('তারিখ', 'Dates') }}</th>
                <th class="p-2.5 text-center lv-sticky">{{ prefs.txt('দিন', 'Days') }}</th>
                <th class="p-2.5 lv-sticky">{{ prefs.txt('কারণ', 'Reason') }}</th>
                <th class="p-2.5 text-center lv-sticky">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</th>
                <th class="w-40 p-2.5 text-center lv-sticky">{{ prefs.txt('অ্যাকশন', 'Action') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (row of pager.paged(); track row.id; let idx = $index) {
                <tr class="transition-colors hover:bg-[#e2e8f0] dark:hover:bg-slate-800">
                  <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5">
                    <p class="font-bold text-teal-800 dark:text-teal-300">{{ row.staffName }}</p>
                    <p class="font-mono text-[10px] text-slate-500">{{ row.staffCode || '—' }}</p>
                  </td>
                  <td class="p-2.5">
                    <span class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold" [class]="typeBadge(row.type)">
                      <mat-icon style="font-size:12px;width:12px;height:12px;">{{ typeIcon(row.type) }}</mat-icon>
                      {{ typeLabel(row.type) }}
                    </span>
                  </td>
                  <td class="p-2.5 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    {{ displayDate(row.fromDate) }}
                    @if (row.toDate !== row.fromDate) { <span class="text-slate-400">→</span> {{ displayDate(row.toDate) }} }
                  </td>
                  <td class="p-2.5 text-center font-mono font-bold">{{ row.days }}</td>
                  <td class="max-w-[220px] truncate p-2.5 text-slate-600 dark:text-slate-300" [title]="row.reason">{{ row.reason || '—' }}</td>
                  <td class="p-2.5 text-center">
                    <span class="inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold" [class]="statusBadge(row.status)">{{ statusLabel(row.status) }}</span>
                  </td>
                  <td class="p-2.5">
                    <div class="flex items-center justify-center gap-1">
                      @if (row.status === 'Pending') {
                        <button (click)="decide(row, 'Approved')" class="inline-flex cursor-pointer items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700">
                          <mat-icon style="font-size:13px;width:13px;height:13px;">check</mat-icon>{{ prefs.txt('অনুমোদন', 'Approve') }}
                        </button>
                        <button (click)="decide(row, 'Rejected')" class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                          {{ prefs.txt('না', 'Reject') }}
                        </button>
                      } @else if (row.status === 'Approved') {
                        <button (click)="decide(row, 'Cancelled')" class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          <mat-icon style="font-size:13px;width:13px;height:13px;">undo</mat-icon>{{ prefs.txt('বাতিল', 'Cancel') }}
                        </button>
                      }
                      <button (click)="openEdit(row)" class="cursor-pointer rounded p-1 text-sky-700 hover:bg-sky-100 dark:text-sky-400 dark:hover:bg-sky-950" [title]="prefs.txt('সম্পাদনা', 'Edit')">
                        <mat-icon style="font-size:16px;width:16px;height:16px;">edit</mat-icon>
                      </button>
                      @if (session.has('deleteRecords')) {
                        <button (click)="remove(row)" class="cursor-pointer rounded p-1 text-rose-600 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-950" [title]="prefs.txt('মুছুন', 'Delete')">
                          <mat-icon style="font-size:16px;width:16px;height:16px;">delete</mat-icon>
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" class="p-10 text-center text-slate-400">
                    <mat-icon class="text-3xl text-slate-300">event_busy</mat-icon>
                    <p class="mt-1 text-xs font-semibold">{{ prefs.txt('এই তালিকায় কোনো ছুটির আবেদন নেই।', 'No leave requests in this list.') }}</p>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-table-pagination [total]="pager.total()" [page]="pager.currentPage()" [pageSize]="pager.pageSize()"
          (pageChange)="pager.setPage($event)" (pageSizeChange)="pager.setPageSize($event)" />
      </div>

      <p class="flex items-start gap-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
        <mat-icon style="font-size:14px;width:14px;height:14px;" class="mt-0.5 text-teal-600">info</mat-icon>
        {{ prefs.txt('অনুমোদিত ছুটি হাজিরা শিটে স্বয়ংক্রিয়ভাবে যোগ হয়। বেতনসহ ছুটি বেতনের দিনে গণ্য হয়, অবৈতনিক ছুটি অনুপস্থিত হিসেবে বাদ যায়। যে দিনে হাজিরা (স্ক্যান/ম্যানুয়াল) আছে সেই দিন ছুটি পরিবর্তন করে না।', 'Approved leave is written into the attendance sheet automatically. Paid leave counts in payroll, unpaid leave is deducted like an absence. A day that already has a punch is never overwritten.') }}
      </p>
    </div>

    <!-- Add / edit drawer -->
    @if (showDrawer()) {
      <div class="fixed inset-0 z-50 flex justify-end bg-slate-900/60 backdrop-blur-xs" (click)="closeDrawer()">
        <div class="flex h-full w-full max-w-xl flex-col overflow-hidden bg-white text-slate-800 shadow-2xl dark:bg-slate-900 dark:text-slate-100" (click)="$event.stopPropagation()">
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div>
              <p class="text-sm font-bold">{{ editingId() ? prefs.txt('ছুটি সম্পাদনা', 'Edit leave') : prefs.txt('নতুন ছুটির আবেদন', 'New leave request') }}</p>
              <p class="text-[10px] text-slate-500">{{ prefs.txt('অনুমোদন দিলে হাজিরা ও বেতনে যোগ হবে', 'Approving it updates attendance and payroll') }}</p>
            </div>
            <button (click)="closeDrawer()" class="cursor-pointer rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>

          <div class="flex-1 space-y-4 overflow-y-auto p-4">
            <div>
              <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-200"><span class="text-rose-500">*</span> {{ prefs.txt('কর্মচারী', 'Employee') }}</label>
              <div class="flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-teal-500 dark:border-slate-700 dark:bg-slate-800">
                <mat-icon class="mr-2 text-sm text-slate-400">badge</mat-icon>
                <select [(ngModel)]="formStaffId" (ngModelChange)="formError.set('')"
                  class="w-full bg-transparent text-xs font-medium outline-none dark:text-slate-100">
                  <option [ngValue]="null" disabled>{{ prefs.txt('কর্মচারী বেছে নিন', 'Choose an employee') }}</option>
                  @for (s of staffChoices(); track s.id) {
                    <option [ngValue]="s.id">{{ s.name }} · {{ s.code }}</option>
                  }
                </select>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-200">{{ prefs.txt('ছুটির ধরন', 'Leave type') }}</label>
                <div class="flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-teal-500 dark:border-slate-700 dark:bg-slate-800">
                  <mat-icon class="mr-2 text-sm" [class]="formType === 'Unpaid' ? 'text-rose-500' : 'text-teal-600'">{{ typeIcon(formType) }}</mat-icon>
                  <select [(ngModel)]="formType" class="w-full bg-transparent text-xs font-medium outline-none dark:text-slate-100">
                    @for (t of types; track t) {
                      <option [value]="t">{{ typeLabel(t) }}</option>
                    }
                  </select>
                </div>
                <p class="mt-1 text-[10px]" [class]="formType === 'Unpaid' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'">
                  {{ formType === 'Unpaid'
                    ? prefs.txt('এই দিনগুলো বেতনের দিন হিসেবে গণ্য হবে না।', 'These days are not paid.')
                    : prefs.txt('এই দিনগুলো পুরো বেতনে গণ্য হবে।', 'These days count as fully paid.') }}
                </p>
              </div>
              <div>
                <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-200">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</label>
                <div class="flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-teal-500 dark:border-slate-700 dark:bg-slate-800">
                  <mat-icon class="mr-2 text-sm text-emerald-500">verified</mat-icon>
                  <select [(ngModel)]="formStatus" class="w-full bg-transparent text-xs font-medium outline-none dark:text-slate-100">
                    <option value="Pending">{{ prefs.txt('অপেক্ষমাণ', 'Pending') }}</option>
                    <option value="Approved">{{ prefs.txt('সরাসরি অনুমোদিত', 'Approved directly') }}</option>
                  </select>
                </div>
                <p class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('এখনই অনুমোদন দিলে হাজিরা এখনই যোগ হবে।', 'Approving now writes the attendance immediately.') }}</p>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-200"><span class="text-rose-500">*</span> {{ prefs.txt('শুরুর তারিখ', 'From date') }}</label>
                <div class="flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-teal-500 dark:border-slate-700 dark:bg-slate-800">
                  <mat-icon class="mr-2 text-sm text-slate-400">calendar_today</mat-icon>
                  <input type="date" appDmyDate [(ngModel)]="formFrom" (ngModelChange)="formError.set('')"
                    class="w-full bg-transparent text-xs font-medium outline-none dark:text-slate-100">
                </div>
              </div>
              <div>
                <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-200"><span class="text-rose-500">*</span> {{ prefs.txt('শেষ তারিখ', 'To date') }}</label>
                <div class="flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-teal-500 dark:border-slate-700 dark:bg-slate-800">
                  <mat-icon class="mr-2 text-sm text-slate-400">event</mat-icon>
                  <input type="date" appDmyDate [(ngModel)]="formTo" (ngModelChange)="formError.set('')"
                    class="w-full bg-transparent text-xs font-medium outline-none dark:text-slate-100">
                </div>
              </div>
            </div>

            <div class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
              <span class="font-bold text-slate-600 dark:text-slate-300">{{ prefs.txt('মোট ছুটির দিন', 'Total leave days') }}</span>
              <span class="font-mono text-lg font-black text-teal-700 dark:text-teal-300">{{ formDays() }}</span>
            </div>

            <div>
              <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-200">{{ prefs.txt('কারণ', 'Reason') }}</label>
              <input [(ngModel)]="formReason" [placeholder]="prefs.txt('অসুস্থতা / পারিবারিক কারণ / জরুরি কাজ…', 'Illness / family / urgent work…')"
                class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            </div>

            <div>
              <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-200">{{ prefs.txt('নোট', 'Note') }}</label>
              <textarea rows="3" [(ngModel)]="formNote" [placeholder]="prefs.txt('অতিরিক্ত তথ্য (ঐচ্ছিক)', 'Extra details (optional)')"
                class="w-full resize-none rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"></textarea>
            </div>

            @if (formError()) {
              <p class="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <mat-icon class="text-sm">error</mat-icon>{{ formError() }}
              </p>
            }
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
            <button (click)="closeDrawer()" class="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
            <button (click)="save()" class="flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-emerald-700">
              <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ', 'Save') }}
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class HrmLeavePage {
  data = inject(DataService);
  private notify = inject(NotificationService);
  prefs = inject(PreferencesService);
  session = inject(SessionService);

  readonly types: LeaveType[] = ['Casual', 'Sick', 'Annual', 'Unpaid'];
  readonly month = signal(localDateIso().slice(0, 7));
  readonly activeTab = signal<LeaveTab>('All');
  readonly searchQuery = signal('');
  readonly showDrawer = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly formError = signal('');

  readonly tabDefs = computed<{ value: LeaveTab; label: string; icon: string }[]>(() => [
    { value: 'All', label: this.prefs.txt('সব', 'All'), icon: 'event_note' },
    { value: 'Pending', label: this.prefs.txt('অপেক্ষমাণ', 'Pending'), icon: 'hourglass_empty' },
    { value: 'Approved', label: this.prefs.txt('অনুমোদিত', 'Approved'), icon: 'verified' },
    { value: 'Rejected', label: this.prefs.txt('প্রত্যাখ্যাত', 'Rejected'), icon: 'block' },
    { value: 'Cancelled', label: this.prefs.txt('বাতিলকৃত', 'Cancelled'), icon: 'undo' }
  ]);

  readonly staffChoices = computed(() => this.data.hrmStaff()
    .slice()
    .sort((a, b) => Number(a.status === 'Inactive') - Number(b.status === 'Inactive')
      || (a.name || '').localeCompare(b.name || '', 'bn')));

  readonly rows = computed<LeaveRow[]>(() => {
    const month = this.month();
    return this.data.hrmLeaves()
      .map(leave => {
        const dates = this.data.leaveDates(leave.fromDate, leave.toDate);
        return {
          ...leave,
          days: dates.length,
          monthDays: dates.filter(d => d.startsWith(month)).length
        };
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  });

  readonly filtered = computed(() => {
    const tab = this.activeTab();
    const q = this.searchQuery().trim().toLowerCase();
    return this.rows()
      .filter(r => tab === 'All' || r.status === tab)
      .filter(r => !q || `${r.staffName} ${r.staffCode} ${r.reason} ${r.type}`.toLowerCase().includes(q));
  });

  readonly pager = createPager<LeaveRow>(() => this.filtered());

  readonly stats = computed(() => {
    const month = this.month();
    const today = localDateIso();
    const rows = this.rows();
    const approved = rows.filter(r => r.status === 'Approved');
    return {
      pending: rows.filter(r => r.status === 'Pending').length,
      today: approved.filter(r => r.fromDate <= today && r.toDate >= today).length,
      paidDays: approved.filter(r => r.type !== 'Unpaid').reduce((acc, r) => acc + r.monthDays, 0),
      unpaidDays: approved.filter(r => r.type === 'Unpaid').reduce((acc, r) => acc + r.monthDays, 0)
    };
  });

  // form
  formStaffId: number | null = null;
  formType: LeaveType = 'Casual';
  formFrom = localDateIso();
  formTo = localDateIso();
  formStatus: LeaveStatus = 'Pending';
  formReason = '';
  formNote = '';

  /** Plain form fields, so this stays a method instead of a computed. */
  formDays(): number {
    return this.data.leaveDates(this.formFrom, this.formTo).length;
  }

  setMonth(value: string) {
    if (!value) return;
    this.month.set(value);
  }

  setTab(tab: LeaveTab) {
    this.activeTab.set(tab);
    this.pager.setPage(1);
  }

  setSearch(value: string) {
    this.searchQuery.set(value ?? '');
    this.pager.setPage(1);
  }

  tabCount(tab: LeaveTab): number {
    const rows = this.rows();
    return tab === 'All' ? rows.length : rows.filter(r => r.status === tab).length;
  }

  typeLabel(type: LeaveType): string {
    const labels: Record<LeaveType, [string, string]> = {
      Casual: ['নৈমিত্তিক', 'Casual'],
      Sick: ['অসুস্থতা', 'Sick'],
      Annual: ['বার্ষিক', 'Annual'],
      Unpaid: ['অবৈতনিক', 'Unpaid']
    };
    const pair = labels[type];
    return pair ? this.prefs.txt(pair[0], pair[1]) : type;
  }

  typeIcon(type: LeaveType): string {
    return { Casual: 'event', Sick: 'healing', Annual: 'flight_takeoff', Unpaid: 'money_off' }[type] || 'event';
  }

  typeBadge(type: LeaveType): string {
    return type === 'Unpaid'
      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
      : 'bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300';
  }

  statusLabel(status: LeaveStatus): string {
    const labels: Record<LeaveStatus, [string, string]> = {
      Pending: ['অপেক্ষমাণ', 'Pending'],
      Approved: ['অনুমোদিত', 'Approved'],
      Rejected: ['প্রত্যাখ্যাত', 'Rejected'],
      Cancelled: ['বাতিল', 'Cancelled']
    };
    const pair = labels[status];
    return pair ? this.prefs.txt(pair[0], pair[1]) : status;
  }

  statusBadge(status: LeaveStatus): string {
    return {
      Pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
      Approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
      Rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
      Cancelled: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
    }[status];
  }

  displayDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (value || '—');
  }

  openAdd() {
    this.editingId.set(null);
    this.formStaffId = this.staffChoices()[0]?.id ?? null;
    this.formType = 'Casual';
    this.formFrom = localDateIso();
    this.formTo = localDateIso();
    this.formStatus = 'Pending';
    this.formReason = '';
    this.formNote = '';
    this.formError.set('');
    this.showDrawer.set(true);
  }

  openEdit(leave: LeaveRow) {
    this.editingId.set(leave.id);
    this.formStaffId = leave.staffId;
    this.formType = leave.type;
    this.formFrom = leave.fromDate;
    this.formTo = leave.toDate;
    this.formStatus = leave.status === 'Approved' ? 'Approved' : 'Pending';
    this.formReason = leave.reason;
    this.formNote = leave.note;
    this.formError.set('');
    this.showDrawer.set(true);
  }

  closeDrawer() {
    this.showDrawer.set(false);
  }

  save() {
    const staff = this.data.hrmStaff().find(s => s.id === this.formStaffId);
    if (!staff) {
      this.formError.set(this.prefs.txt('কর্মচারী বেছে নিন।', 'Choose an employee.'));
      return;
    }
    if (!this.formFrom || !this.formTo) {
      this.formError.set(this.prefs.txt('শুরু ও শেষ তারিখ দিন।', 'Enter both dates.'));
      return;
    }
    if (this.formTo < this.formFrom) {
      this.formError.set(this.prefs.txt('শেষ তারিখ শুরুর তারিখের আগে হতে পারে না।', 'The end date cannot be before the start date.'));
      return;
    }
    const days = this.data.leaveDates(this.formFrom, this.formTo).length;
    if (!days) {
      this.formError.set(this.prefs.txt('তারিখের সীমা সঠিক নয়।', 'The date range is not valid.'));
      return;
    }
    if (days > 90) {
      this.formError.set(this.prefs.txt('একবারে সর্বোচ্চ ৯০ দিনের ছুটি দেওয়া যাবে।', 'A single leave can be at most 90 days.'));
      return;
    }
    const overlap = this.data.overlappingLeave(this.formStaffId!, this.formFrom, this.formTo, this.editingId() ?? undefined);
    if (overlap) {
      this.formError.set(this.prefs.txt(
        `${overlap.staffName} — ${this.displayDate(overlap.fromDate)} থেকে ${this.displayDate(overlap.toDate)} পর্যন্ত একটি ${this.statusLabel(overlap.status)} ছুটি ইতিমধ্যে আছে।`,
        `${overlap.staffName} already has a ${this.statusLabel(overlap.status)} leave from ${this.displayDate(overlap.fromDate)} to ${this.displayDate(overlap.toDate)}.`
      ));
      return;
    }

    const payload = {
      staffId: staff.id,
      staffCode: staff.code,
      staffName: staff.name,
      fromDate: this.formFrom,
      toDate: this.formTo,
      type: this.formType,
      reason: (this.formReason || '').trim(),
      status: this.formStatus,
      note: (this.formNote || '').trim()
    };

    const id = this.editingId();
    if (id) {
      this.data.updateLeave(id, payload);
      this.notify.success(this.prefs.txt('ছুটির আবেদন আপডেট হয়েছে।', 'Leave request updated.'));
    } else {
      this.data.addLeave(payload);
      this.notify.success(this.formStatus === 'Approved'
        ? this.prefs.txt(`${staff.name} — ${days} দিনের ছুটি অনুমোদিত ও হাজিরায় যোগ হয়েছে।`, `${staff.name} — ${days} day(s) of leave approved and written to attendance.`)
        : this.prefs.txt(`${staff.name} — ছুটির আবেদন জমা হয়েছে।`, `${staff.name} — leave request submitted.`));
    }
    this.showDrawer.set(false);
    this.pager.setPage(1);
  }

  async decide(leave: LeaveRow, status: LeaveStatus) {
    if (status === 'Cancelled') {
      const ok = await this.notify.confirm(
        this.prefs.txt(`${leave.staffName} — এর ছুটি বাতিল করলে হাজিরার ছুটির দিনগুলো মুছে যাবে।`, `Cancelling ${leave.staffName}’s leave removes its attendance days.`),
        { title: this.prefs.txt('ছুটি বাতিল করবেন?', 'Cancel this leave?'), kind: 'error', confirmText: this.prefs.txt('বাতিল', 'Cancel leave'), cancelText: this.prefs.txt('না', 'No') }
      );
      if (!ok) return;
    }
    if (status === 'Approved') {
      const ok = await this.notify.confirm(
        this.prefs.txt(`${leave.staffName} — ${this.displayDate(leave.fromDate)} → ${this.displayDate(leave.toDate)} (${leave.days} দিন) অনুমোদন করবেন? হাজিরা শিটে ${leave.type === 'Unpaid' ? 'অনুপস্থিত' : 'ছুটি'} হিসেবে যোগ হবে।`,
          `Approve ${leave.days} day(s) for ${leave.staffName}? They will be written to attendance as ${leave.type === 'Unpaid' ? 'absent' : 'leave'}.`),
        { title: this.prefs.txt('ছুটি অনুমোদন', 'Approve leave'), kind: 'success', confirmText: this.prefs.txt('অনুমোদন', 'Approve'), cancelText: this.prefs.txt('না', 'No') }
      );
      if (!ok) return;
    }
    this.data.updateLeave(leave.id, { status });
    this.notify.success(status === 'Approved'
      ? this.prefs.txt('ছুটি অনুমোদিত হয়েছে এবং হাজিরায় যোগ হয়েছে।', 'Leave approved and added to attendance.')
      : status === 'Rejected'
        ? this.prefs.txt('ছুটির আবেদন প্রত্যাখ্যান করা হয়েছে।', 'Leave request rejected.')
        : this.prefs.txt('ছুটি বাতিল হয়েছে।', 'Leave cancelled.'));
  }

  async remove(leave: LeaveRow) {
    const ok = await this.notify.confirm(
      this.prefs.txt(`${leave.staffName} — এর ${this.displayDate(leave.fromDate)} → ${this.displayDate(leave.toDate)} ছুটির রেকর্ড স্থায়ীভাবে মুছে যাবে।`, `${leave.staffName}’s leave record will be deleted permanently.`),
      { title: this.prefs.txt('ছুটির রেকর্ড মুছবেন?', 'Delete this leave record?'), kind: 'error', confirmText: this.prefs.txt('মুছুন', 'Delete'), cancelText: this.prefs.txt('বাতিল', 'Cancel') }
    );
    if (!ok) return;
    this.data.deleteLeave(leave.id);
    this.notify.success(this.prefs.txt('ছুটির রেকর্ড মুছে ফেলা হয়েছে।', 'Leave record deleted.'));
  }

  exportExcel() {
    this.data.exportToExcel(this.filtered().map(r => ({
      Employee: r.staffName,
      Code: r.staffCode,
      Type: r.type,
      From: r.fromDate,
      To: r.toDate,
      Days: r.days,
      Reason: r.reason,
      Status: r.status,
      Note: r.note,
      Requested: r.createdAt,
      Decided: r.decidedAt
    })), 'HRM_Leave_Requests');
  }
}
