import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, StaffAdvance as StaffAdvanceRecord, hasPartyRole } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';
import { DmyDateDirective } from '../../directives/dmy-date.directive';
import { HrmNav } from './hrm-nav';

interface StaffChoice {
  name: string;
  code: string;
  designation: string;
  phone: string;
  status: string;
  staffId?: number;
}

@Component({
  selector: 'app-staff-advance',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, DmyDateDirective, HrmNav],
  styles: `
    /* Sticky column-title band so rows scroll under the teal header. */
    .pt-sticky {
      position: sticky;
      top: 0;
      z-index: 5;
      background-color: var(--sm-brand, #0d9488);
    }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">
      <app-hrm-nav />

      <!-- Page Header -->
      <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-lg">handshake</mat-icon>
            </span>
            <div>
              <h1 class="text-xl font-bold">{{ prefs.txt('স্টাফ অ্যাডভান্স', 'Staff Advance') }}</h1>
              <p class="text-[11px] text-teal-50/85">Dashboard / HRM · {{ prefs.txt('কর্মীর অগ্রিম ও আদায়', 'Staff advance & recovery') }}</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button (click)="exportExcel()" class="flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon style="font-size:15px;width:15px;height:15px;">description</mat-icon> Excel
            </button>
            <button (click)="printPage()" class="flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon style="font-size:15px;width:15px;height:15px;">print</mat-icon> Print
            </button>
            <button (click)="openAddModal()" class="flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon style="font-size:15px;width:15px;height:15px;">add</mat-icon> {{ prefs.txt('নতুন এডভান্স', 'Add New') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Status Tabs -->
      <div class="no-print bg-white p-2 rounded-xl shadow-xs border border-slate-200 flex items-center gap-2 overflow-x-auto">
        @for (t of tabDefs(); track t.value) {
          @if (activeTab() === t.value) {
            <button
              (click)="setTab(t.value)"
              class="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-teal-700 text-white shadow-2xs cursor-pointer"
            >
              <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
              <span>{{ t.label }}</span>
              <span class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-white/25 text-[10px] font-black">{{ tabCount(t.value) }}</span>
            </button>
          } @else {
            <button
              (click)="setTab(t.value)"
              class="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
            >
              <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
              <span>{{ t.label }}</span>
              <span class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-black text-slate-600 dark:text-slate-300">{{ tabCount(t.value) }}</span>
            </button>
          }
        }
      </div>

      <!-- Search Bar & Summary Chips -->
      <div class="no-print bg-white p-3 rounded-xl shadow-xs border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div class="relative w-full sm:max-w-sm">
          <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
          <input
            type="text"
            [placeholder]="prefs.txt('অ্যাডভান্স নম্বর, স্টাফের নাম বা তারিখ দিয়ে খুঁজুন...', 'Search by advance no, staff name or date...')"
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ activeTabLabel() }} · {{ filteredAdvances().length }} {{ prefs.txt('টি', 'rows') }}
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ prefs.txt('মোট এডভান্স', 'Total advance') }} <b class="font-mono text-slate-800 dark:text-slate-200">{{ totals().total | number:'1.2-2' }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200">
            {{ prefs.txt('রিকভার', 'Recovered') }} <b class="font-mono text-emerald-600 dark:text-emerald-400">{{ totals().recovered | number:'1.2-2' }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200">
            {{ prefs.txt('বাকি', 'Balance') }} <b class="font-mono text-rose-600 dark:text-rose-400">{{ totals().balance | number:'1.2-2' }}</b>
          </span>
        </div>
      </div>

      <!-- Main Advance Table (desktop / print) -->
      <div class="list-print-shell hidden lg:block bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div id="list-printable-area" class="overflow-auto max-h-[72vh]">
          <table class="w-full min-w-[1080px] text-xs text-left border-collapse text-slate-700 dark:text-slate-200">
            <thead>
              <tr class="text-white font-bold uppercase text-[11px] tracking-wider">
                <th class="p-2.5 text-center w-10 pt-sticky">SL</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('অ্যাডভান্স নম্বর', 'ADVANCE NO') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('স্টাফ', 'STAFF') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('তারিখ', 'DATE') }}</th>
                <th class="p-2.5 text-right pt-sticky">{{ prefs.txt('পরিমাণ', 'AMOUNT') }}</th>
                <th class="p-2.5 text-right pt-sticky">{{ prefs.txt('রিকভারড', 'RECOVERED') }}</th>
                <th class="p-2.5 text-right pt-sticky">{{ prefs.txt('বাকি', 'BALANCE') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('মাধ্যম', 'MODE') }}</th>
                <th class="p-2.5 text-center pt-sticky">{{ prefs.txt('অবস্থা', 'STATUS') }}</th>
                <th class="p-2.5 text-center w-28 pt-sticky">{{ prefs.txt('অ্যাকশন', 'ACTION') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (r of pager.paged(); track r.id; let idx = $index) {
                <tr class="hover:bg-[#e2e8f0] transition-colors">
                  <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-mono font-bold text-teal-800 dark:text-teal-300">{{ r.advanceNo }}</td>
                  <td class="p-2.5">
                    <div class="flex items-center gap-1.5 max-w-[200px]">
                      <span class="w-6 h-6 rounded-full bg-teal-700/15 text-teal-700 dark:text-teal-300 flex items-center justify-center text-[10px] font-black shrink-0">{{ initials(r.staffName) }}</span>
                      <span class="font-bold text-slate-800 dark:text-slate-100 truncate" [title]="r.staffName">{{ r.staffName }}</span>
                    </div>
                    @if (r.purpose) {
                      <p class="text-[10px] text-slate-500 truncate ml-[30px]" [title]="r.purpose">{{ r.purpose }}</p>
                    }
                  </td>
                  <td class="p-2.5 text-slate-500 whitespace-nowrap">{{ displayDate(r.date) }}</td>
                  <td class="p-2.5 text-right font-mono font-bold text-slate-800 dark:text-slate-100">{{ r.amount | number:'1.2-2' }} TK</td>
                  <td class="p-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">{{ r.recoveredAmount | number:'1.2-2' }} TK</td>
                  <td class="p-2.5 text-right font-mono font-bold" [class]="balanceClass(r)">{{ balanceOf(r) | number:'1.2-2' }} TK</td>
                  <td class="p-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap" [title]="r.mode">{{ accountLabel(r) }}</td>
                  <td class="p-2.5 text-center">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap" [class]="statusBadge(r.status)">{{ statusLabel(r.status) }}</span>
                  </td>
                  <td class="p-2.5 text-center">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="openEditModal(r)" class="p-1 text-amber-600 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-950/60 rounded cursor-pointer" [title]="prefs.txt('এডভান্স সম্পাদনা', 'Edit Advance')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      <button (click)="recoverRecord(r)" class="p-1 text-emerald-600 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-950/60 rounded cursor-pointer" [title]="prefs.txt('এডভান্স রিকভার', 'Recover Advance')">
                        <mat-icon class="text-sm">attach_money</mat-icon>
                      </button>
                      @if (session.has('deleteRecords')) {
                        <button (click)="deleteAdvance(r.id)" class="p-1 text-rose-600 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-950/60 rounded cursor-pointer" [title]="prefs.txt('এডভান্স মুছুন', 'Delete Advance')">
                          <mat-icon class="text-sm">delete</mat-icon>
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="10" class="p-10 text-center">
                    <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
                      <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                        <mat-icon class="text-2xl text-slate-300">payments</mat-icon>
                      </span>
                      <p class="text-xs font-semibold">{{ prefs.txt('এই স্ট্যাটাসে কোনো স্টাফ এডভান্স পাওয়া যায়নি।', 'No staff advance found for this status.') }}</p>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <app-table-pagination
          [total]="pager.total()"
          [page]="pager.currentPage()"
          [pageSize]="pager.pageSize()"
          (pageChange)="pager.setPage($event)"
          (pageSizeChange)="pager.setPageSize($event)"
        />
      </div>

      <!-- Advance Cards (mobile / tablet) -->
      <div class="no-print lg:hidden bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden divide-y divide-slate-100">
        @for (r of pager.paged(); track r.id; let idx = $index) {
          <div class="p-3 space-y-2.5">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-8 h-8 rounded-full bg-teal-700/15 text-teal-700 dark:text-teal-300 flex items-center justify-center text-xs font-black shrink-0">{{ initials(r.staffName) }}</span>
                <span class="min-w-0">
                  <span class="block font-bold text-teal-800 dark:text-teal-300 text-sm truncate">{{ r.staffName }}</span>
                  <span class="block text-[10px] text-slate-500 truncate">{{ r.advanceNo }} • SL {{ pager.offset() + idx + 1 }}</span>
                </span>
              </div>
              <span class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="statusBadge(r.status)">{{ statusLabel(r.status) }}</span>
            </div>

            <div class="grid grid-cols-3 gap-2 text-center bg-slate-50 rounded-lg p-2">
              <div>
                <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('এডভান্স', 'Advance') }}</p>
                <p class="font-mono font-bold text-slate-800 dark:text-slate-100 text-[11px]">{{ r.amount | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-[9px] uppercase font-bold text-emerald-600 dark:text-emerald-400">{{ prefs.txt('রিকভার', 'Recovered') }}</p>
                <p class="font-mono font-semibold text-emerald-600 dark:text-emerald-400 text-[11px]">{{ r.recoveredAmount | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-[9px] uppercase font-bold text-rose-600 dark:text-rose-400">{{ prefs.txt('বাকি', 'Balance') }}</p>
                <p class="font-mono font-bold text-[11px]" [class]="balanceClass(r)">{{ balanceOf(r) | number:'1.2-2' }}</p>
              </div>
            </div>

            <div class="flex items-center justify-between gap-2 text-[10px] text-slate-500 flex-wrap">
              <span class="inline-flex items-center gap-1">
                <mat-icon class="text-xs">account_balance_wallet</mat-icon>{{ accountLabel(r) }}
              </span>
              <span class="inline-flex items-center gap-1">
                <mat-icon class="text-xs">event</mat-icon>{{ displayDate(r.date) }}
              </span>
              @if (r.purpose) {
                <span class="inline-flex items-center gap-1 truncate max-w-[160px]" [title]="r.purpose">
                  <mat-icon class="text-xs">note</mat-icon>{{ r.purpose }}
                </span>
              }
            </div>

            <div class="flex items-center gap-1">
              <button (click)="recoverRecord(r)" class="flex-1 inline-flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">attach_money</mat-icon> {{ prefs.txt('রিকভার', 'Recover') }}
              </button>
              <button (click)="openEditModal(r)" class="inline-flex items-center justify-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">edit</mat-icon>
              </button>
              @if (session.has('deleteRecords')) {
                <button (click)="deleteAdvance(r.id)" class="inline-flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                  <mat-icon class="text-sm">delete</mat-icon>
                </button>
              }
            </div>
          </div>
        } @empty {
          <div class="p-8 text-center">
            <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
              <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                <mat-icon class="text-2xl text-slate-300">payments</mat-icon>
              </span>
              <p class="text-xs font-semibold">{{ prefs.txt('এই স্ট্যাটাসে কোনো স্টাফ এডভান্স পাওয়া যায়নি।', 'No staff advance found for this status.') }}</p>
            </div>
          </div>
        }

        <app-table-pagination
          [total]="pager.total()"
          [page]="pager.currentPage()"
          [pageSize]="pager.pageSize()"
          (pageChange)="pager.setPage($event)"
          (pageSizeChange)="pager.setPageSize($event)"
        />
      </div>

    </div>

    <!-- Right Side-Over Drawer: Add / Edit Staff Advance -->
    @if (showAddDrawer()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end">
        <div class="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden text-slate-800 animate-in slide-in-from-right duration-300">

          <!-- Drawer Header -->
          <div class="bg-white border-b border-slate-200 p-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <button (click)="closeDrawer()" class="text-slate-400 hover:text-slate-700 cursor-pointer p-1 rounded-full hover:bg-slate-100 transition-colors">
                <mat-icon class="text-lg">close</mat-icon>
              </button>
              <h2 class="text-base font-bold text-slate-900">
                {{ isEditMode() ? prefs.txt('স্টাফ অ্যাডভান্স সম্পাদনা', 'Edit Staff Advance') : prefs.txt('নতুন স্টাফ অ্যাডভান্স', 'Add New Staff Advance') }}
              </h2>
            </div>
            @if (editingRecord(); as rec) {
              <span class="font-mono text-[11px] font-bold text-teal-800 dark:text-teal-300">{{ rec.advanceNo }}</span>
            }
          </div>

          <!-- Drawer Body -->
          <div class="flex-1 overflow-y-auto p-6 space-y-4">

            @if (!isEditMode()) {
              <p class="inline-flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                <mat-icon class="text-xs text-teal-600 dark:text-teal-400">info</mat-icon> {{ prefs.txt('এডভান্স নম্বর স্বয়ংক্রিয়ভাবে তৈরি হবে।', 'The advance number is generated automatically.') }}
              </p>
            }

            <!-- Staff Name -->
            <div>
              <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-200"><span class="text-rose-500">*</span> {{ prefs.txt('স্টাফের নাম', 'Staff name') }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">badge</mat-icon>
                <select
                  [ngModel]="formStaffName"
                  (ngModelChange)="setStaff($event)"
                  class="w-full bg-transparent outline-none text-xs font-medium text-slate-800 dark:text-slate-100"
                >
                  <option value="" disabled>{{ prefs.txt('ডাটাবেস থেকে স্টাফ বেছে নিন', 'Pick a staff from the database') }}</option>
                  @if (formStaffName && !isKnownStaff(formStaffName)) {
                    <option [value]="formStaffName">{{ formStaffName }}</option>
                  }
                  @for (s of staffChoices(); track s.name) {
                    <option [value]="s.name">{{ s.name }}{{ s.code ? ' · ' + s.code : '' }}{{ s.status === 'Inactive' ? ' · Inactive' : '' }}</option>
                  }
                </select>
              </div>
              @if (selectedStaffInfo(); as s) {
                <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  @if (s.code) { <span class="font-mono font-bold text-teal-700 dark:text-teal-300">{{ s.code }}</span> }
                  @if (s.designation) { <span>{{ s.designation }}</span> }
                  @if (s.phone) { <span>· {{ s.phone }}</span> }
                </p>
              } @else if (staffChoices().length === 0) {
                <p class="text-[10px] text-amber-600 dark:text-amber-400 mt-1">{{ prefs.txt('ডাটাবেসে কোনো কর্মী নেই — HRM → Employee Info থেকে কর্মী যোগ করুন।', 'No staff in the database yet — add employees from HRM → Employee Info.') }}</p>
              }
            </div>

            <!-- Date & Amount -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-200"><span class="text-rose-500">*</span> {{ prefs.txt('তারিখ', 'Date') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-2">calendar_today</mat-icon>
                  <input type="date" appDmyDate [(ngModel)]="formDate" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800 dark:text-slate-100" />
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-200"><span class="text-rose-500">*</span> {{ prefs.txt('এডভান্সের পরিমাণ', 'Advance amount') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-500">
                  <span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-1.5 border-r border-slate-300">TK</span>
                  <input type="number" step="0.01" min="0" [(ngModel)]="formAmount" class="w-full p-1.5 outline-none text-xs font-bold text-slate-900 dark:text-slate-100" />
                </div>
              </div>
            </div>

            <!-- Account & Status -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-200">{{ prefs.txt('যে অ্যাকাউন্ট থেকে দিচ্ছেন', 'Account to pay from') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-slate-400 text-sm mr-2">account_balance_wallet</mat-icon>
                  <select [(ngModel)]="formAccountId" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800 dark:text-slate-100">
                    <option [ngValue]="null" disabled>{{ prefs.txt('অ্যাকাউন্ট বেছে নিন', 'Choose an account') }}</option>
                    @for (a of accounts(); track a.id) {
                      <option [ngValue]="a.id">{{ a.name }} — {{ a.type }} · ৳{{ dataService.walletBalance(a.id) | number:'1.2-2' }}</option>
                    }
                  </select>
                </div>
                <p class="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{{ prefs.txt('সংরক্ষণ করলে এই অ্যাকাউন্ট থেকে টাকা কমবে; আদায় করলে ফেরত জমা হবে।', 'Saving deducts from this account; recovering adds the money back.') }}</p>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-200">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                  <mat-icon class="text-emerald-500 dark:text-emerald-400 text-sm mr-2">check_circle</mat-icon>
                  <select [(ngModel)]="formStatus" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800 dark:text-slate-100">
                    @for (s of statuses; track s) {
                      <option [value]="s">{{ statusLabel(s) }}</option>
                    }
                  </select>
                </div>
              </div>
            </div>

            <!-- Purpose -->
            <div>
              <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-200">{{ prefs.txt('উদ্দেশ্য', 'Purpose') }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">note</mat-icon>
                <input type="text" [(ngModel)]="formPurpose" [placeholder]="prefs.txt('চিকিৎসা খরচ / পরিবারের খরচ...', 'Medical expense / family expense...')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800 dark:text-slate-100" />
              </div>
            </div>

            <!-- Note -->
            <div>
              <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-200">{{ prefs.txt('নোট / মন্তব্য', 'Note / remarks') }}</label>
              <textarea
                rows="3"
                [(ngModel)]="formNote"
                [placeholder]="prefs.txt('অতিরিক্ত তথ্য লিখে রাখুন...', 'Write any extra details...')"
                class="w-full border border-slate-300 rounded-lg px-2.5 py-2 bg-white text-xs font-medium text-slate-800 dark:text-slate-100 focus-within:ring-2 focus-within:ring-teal-500 outline-none resize-none"
              ></textarea>
            </div>

            <!-- Recovered summary (edit only) -->
            @if (editingRecord(); as rec) {
              <div class="grid grid-cols-3 gap-2 text-center bg-slate-50 rounded-lg p-3 border border-slate-200">
                <div>
                  <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('এডভান্স', 'Advance') }}</p>
                  <p class="font-mono font-bold text-slate-800 dark:text-slate-100 text-[12px]">{{ rec.amount | number:'1.2-2' }}</p>
                </div>
                <div>
                  <p class="text-[9px] uppercase font-bold text-emerald-600 dark:text-emerald-400">{{ prefs.txt('রিকভার হয়েছে', 'Recovered') }}</p>
                  <p class="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-[12px]">{{ rec.recoveredAmount | number:'1.2-2' }}</p>
                </div>
                <div>
                  <p class="text-[9px] uppercase font-bold text-rose-600 dark:text-rose-400">{{ prefs.txt('বাকি', 'Balance') }}</p>
                  <p class="font-mono font-bold text-rose-600 dark:text-rose-400 text-[12px]">{{ balanceOf(rec) | number:'1.2-2' }}</p>
                </div>
              </div>
              <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('রিকভারের টাকা টেবিলের টাকা বাটন থেকে যোগ করুন — এখানে শুধু দেখানো হচ্ছে।', 'Add recovered money from the money button in the table — this is display only.') }}</p>
            }

          </div>

          <!-- Drawer Footer -->
          <div class="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
            <button (click)="closeDrawer()" class="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors">
              {{ prefs.txt('বাতিল', 'Cancel') }}
            </button>
            <button (click)="saveAdvanceForm()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-2xs cursor-pointer transition-colors">
              <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ করুন', 'Save') }}
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class StaffAdvance {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  session = inject(SessionService);
  prefs = inject(PreferencesService);

  readonly statuses: StaffAdvanceRecord['status'][] = ['Pending', 'Approved', 'Recovered', 'Cancelled'];
  readonly accounts = computed(() => this.dataService.walletAccounts().filter(a => a.status === 'Enabled'));

  activeTab = signal<string>('All');
  searchQuery = signal<string>('');
  showAddDrawer = signal<boolean>(false);
  isEditMode = signal<boolean>(false);
  editingId = signal<number | null>(null);

  formStaffId: number | null = null;
  formStaffName = '';
  formDate = this.todayIso();
  formAmount = 0;
  formAccountId: number | null = null;
  formPurpose = '';
  formStatus: StaffAdvanceRecord['status'] = 'Pending';
  formNote = '';

  readonly tabDefs = computed(() => [
    { value: 'All', label: this.prefs.txt('সব', 'All'), icon: 'payments' },
    { value: 'Pending', label: this.prefs.txt('পেন্ডিং', 'Pending'), icon: 'hourglass_empty' },
    { value: 'Approved', label: this.prefs.txt('অনুমোদিত', 'Approved'), icon: 'verified' },
    { value: 'Recovered', label: this.prefs.txt('রিকভারড', 'Recovered'), icon: 'loop' },
    { value: 'Cancelled', label: this.prefs.txt('বাতিল', 'Cancelled'), icon: 'block' }
  ]);

  /** HRM employee records first, then legacy party-only staff, de-duplicated by name. */
  staffChoices = computed(() => {
    const list: StaffChoice[] = [];
    const seen = new Set<string>();
    const push = (choice: StaffChoice) => {
      const key = choice.name.toLowerCase();
      if (!choice.name || seen.has(key)) return;
      seen.add(key);
      list.push(choice);
    };
    for (const s of this.dataService.hrmStaff()) {
      push({
        name: (s.name || '').trim(),
        code: (s.code || '').trim(),
        designation: (s.designation || '').trim(),
        phone: (s.phone || '').trim(),
        status: s.status,
        staffId: s.id
      });
    }
    for (const p of this.dataService.parties()) {
      if (!hasPartyRole(p, 'Staff Member')) continue;
      push({
        name: (p.name || '').trim(),
        code: '',
        designation: this.prefs.txt('স্টাফ সদস্য', 'Staff member'),
        phone: (p.phone || '').trim(),
        status: ''
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'bn'));
  });

  isKnownStaff(name: string): boolean {
    const key = (name || '').trim().toLowerCase();
    return !!key && this.staffChoices().some(s => s.name.toLowerCase() === key);
  }

  selectedStaffInfo(): StaffChoice | null {
    const key = (this.formStaffName || '').trim().toLowerCase();
    if (!key) return null;
    return this.staffChoices().find(s => s.name.toLowerCase() === key) ?? null;
  }

  setStaff(name: string) {
    this.formStaffName = name || '';
    this.formStaffId = this.selectedStaffInfo()?.staffId ?? null;
  }

  editingRecord = computed(() => {
    const id = this.editingId();
    if (id === null) return null;
    return this.dataService.staffAdvances().find(r => r.id === id) ?? null;
  });

  tabCount(value: string): number {
    const list = this.dataService.staffAdvances();
    return value === 'All' ? list.length : list.filter(r => r.status === value).length;
  }

  setTab(tab: string) {
    this.activeTab.set(tab);
    this.pager.setPage(1);
  }

  activeTabLabel(): string {
    const tab = this.tabDefs().find(t => t.value === this.activeTab());
    return tab ? tab.label : this.prefs.txt('সব', 'All');
  }

  filteredAdvances = computed(() => {
    let list = this.dataService.staffAdvances();
    const tab = this.activeTab();
    const q = this.searchQuery().toLowerCase().trim();

    if (tab !== 'All') {
      list = list.filter(r => r.status === tab);
    }

    if (q) {
      list = list.filter(r =>
        r.advanceNo.toLowerCase().includes(q) ||
        r.staffName.toLowerCase().includes(q) ||
        r.date.toLowerCase().includes(q) ||
        this.displayDate(r.date).toLowerCase().includes(q) ||
        (r.purpose || '').toLowerCase().includes(q)
      );
    }

    return list;
  });

  readonly pager = createPager(() => this.filteredAdvances());

  totals = computed(() => {
    const list = this.filteredAdvances();
    const round = (v: number) => Math.round(v * 100) / 100;
    const total = round(list.reduce((acc, r) => acc + (Number(r.amount) || 0), 0));
    const recovered = round(list.reduce((acc, r) => acc + (Number(r.recoveredAmount) || 0), 0));
    return { total, recovered, balance: round(total - recovered) };
  });

  balanceOf(r: StaffAdvanceRecord): number {
    return Math.round(((Number(r.amount) || 0) - (Number(r.recoveredAmount) || 0)) * 100) / 100;
  }

  balanceClass(r: StaffAdvanceRecord): string {
    const balance = this.balanceOf(r);
    if (balance > 0) return 'text-rose-600 dark:text-rose-400';
    if (balance < 0) return 'text-emerald-600 dark:text-emerald-400';
    return 'text-slate-400';
  }

  statusLabel(status: StaffAdvanceRecord['status']): string {
    const map: Record<StaffAdvanceRecord['status'], string> = {
      Pending: this.prefs.txt('পেন্ডিং', 'Pending'),
      Approved: this.prefs.txt('অনুমোদিত', 'Approved'),
      Recovered: this.prefs.txt('রিকভারড', 'Recovered'),
      Cancelled: this.prefs.txt('বাতিল', 'Cancelled')
    };
    return map[status] || status;
  }

  statusBadge(status: StaffAdvanceRecord['status']): string {
    const map: Record<StaffAdvanceRecord['status'], string> = {
      Pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
      Approved: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300',
      Recovered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
      Cancelled: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
    };
    return map[status];
  }

  initials(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  displayDate(value: string): string {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || '').trim());
    return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : (value || '-');
  }

  accountLabel(r: StaffAdvanceRecord): string {
    const account = r.accountId ? this.dataService.walletAccounts().find(a => a.id === r.accountId) : null;
    return account ? account.name : r.mode;
  }

  private modeForAccount(accountId: number | null): StaffAdvanceRecord['mode'] {
    const account = this.accounts().find(a => a.id === accountId);
    return account ? account.type : 'Cash';
  }

  onSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.searchQuery.set(target.value);
    this.pager.setPage(1);
  }

  private todayIso(): string {
    return localDateIso();
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.editingId.set(null);
    this.formStaffId = null;
    this.formStaffName = '';
    this.formDate = this.todayIso();
    this.formAmount = 0;
    this.formAccountId = this.accounts()[0]?.id ?? null;
    this.formPurpose = '';
    this.formStatus = 'Pending';
    this.formNote = '';
    this.showAddDrawer.set(true);
  }

  openEditModal(r: StaffAdvanceRecord) {
    this.isEditMode.set(true);
    this.editingId.set(r.id);
    this.formStaffName = r.staffName || '';
    this.formStaffId = r.staffId ?? this.selectedStaffInfo()?.staffId ?? null;
    this.formDate = /^(\d{4})-(\d{2})-(\d{2})/.exec((r.date || '').trim()) ? r.date.trim().slice(0, 10) : this.todayIso();
    this.formAmount = r.amount || 0;
    this.formAccountId = r.accountId ?? null;
    this.formPurpose = r.purpose || '';
    this.formStatus = r.status || 'Pending';
    this.formNote = r.note || '';
    this.showAddDrawer.set(true);
  }

  closeDrawer() {
    this.showAddDrawer.set(false);
    this.editingId.set(null);
  }

  saveAdvanceForm() {
    const staffName = this.formStaffName.trim();
    if (!staffName) {
      this.notify.error(this.prefs.txt('ডাটাবেস থেকে স্টাফ নির্বাচন করুন।', 'Select a staff from the database.'), this.prefs.txt('স্টাফ নেই', 'No staff'));
      return;
    }
    const amount = Math.round((Number(this.formAmount) || 0) * 100) / 100;
    if (amount <= 0) {
      this.notify.error(this.prefs.txt('এডভান্সের পরিমাণ শূন্যের বেশি হতে হবে।', 'Advance amount must be greater than zero.'), this.prefs.txt('পরিমাণ ভুল', 'Invalid amount'));
      return;
    }
    if (this.formStatus !== 'Cancelled' && !this.formAccountId) {
      this.notify.warning(this.prefs.txt('টাকা যে অ্যাকাউন্ট থেকে যাবে সেটি নির্বাচন করুন।', 'Select the account the money comes from.'));
      return;
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(this.formDate || '') ? this.formDate : this.todayIso();
    const purpose = this.formPurpose.trim();
    const note = this.formNote.trim();
    const staffId = this.formStaffId ?? this.selectedStaffInfo()?.staffId;
    const accountId = this.formAccountId ?? undefined;
    const mode = this.modeForAccount(this.formAccountId);

    if (this.isEditMode() && this.editingId() !== null) {
      this.dataService.updateStaffAdvance(this.editingId() as number, {
        staffName,
        staffId,
        date,
        amount,
        mode,
        accountId,
        purpose,
        status: this.formStatus,
        note
      });
      this.notify.success(this.prefs.txt(`${staffName} এর এডভান্স রেকর্ড আপডেট হয়েছে।`, `${staffName}'s advance record updated.`));
    } else {
      const created = this.dataService.addStaffAdvance({
        staffName,
        staffId,
        date,
        amount,
        recoveredAmount: 0,
        mode,
        accountId,
        purpose,
        status: this.formStatus,
        note
      });
      this.notify.success(this.prefs.txt(`এডভান্স সংরক্ষিত হয়েছে: ${created.advanceNo}`, `Advance saved: ${created.advanceNo}`));
    }

    this.showAddDrawer.set(false);
    this.editingId.set(null);
  }

  async recoverRecord(r: StaffAdvanceRecord) {
    const balance = this.balanceOf(r);
    if (balance <= 0) {
      this.notify.info(this.prefs.txt(`${r.advanceNo} — এই এডভান্স আগেই রিকভার হয়ে গেছে।`, `${r.advanceNo} — this advance is already fully recovered.`), this.prefs.txt('রিকভার সম্পন্ন', 'Recovery complete'));
      return;
    }

    const raw = await this.notify.prompt(
      this.prefs.txt(`${r.staffName} — বাকি আছে ${balance.toFixed(2)} টাকা।`, `${r.staffName} — balance is ${balance.toFixed(2)} TK.`),
      balance.toFixed(2),
      {
        title: this.prefs.txt('এডভান্স রিকভার', 'Recover Advance'),
        inputLabel: this.prefs.txt('রিকভারের পরিমাণ', 'Recovery amount'),
        placeholder: '0.00',
        confirmText: this.prefs.txt('রিকভার করুন', 'Recover'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (raw === null) return;

    const amount = Math.round((Number(String(raw).replace(/[^\d.-]/g, '')) || 0) * 100) / 100;
    if (!amount || amount <= 0) {
      this.notify.error(this.prefs.txt('সঠিক পরিমাণ লিখুন।', 'Enter a valid amount.'), this.prefs.txt('পরিমাণ নেই', 'No amount'));
      return;
    }
    if (amount > balance) {
      this.notify.warning(this.prefs.txt(`বাকি ${balance.toFixed(2)} টাকার বেশি রিকভার করা যাবে না।`, `Cannot recover more than the remaining ${balance.toFixed(2)} TK.`), this.prefs.txt('বেশি পরিমাণ', 'Too much'));
      return;
    }

    this.dataService.recoverStaffAdvance(r.id, amount, {
      accountId: r.accountId,
      date: localDateIso(),
      postToWallet: true
    });
    const remaining = Math.max(0, Math.round((balance - amount) * 100) / 100);
    const account = r.accountId ? this.dataService.walletAccounts().find(a => a.id === r.accountId) : null;
    this.notify.success(
      this.prefs.txt(
        `${amount.toFixed(2)} টাকা রিকভার হয়েছে। বাকি ${remaining.toFixed(2)} টাকা।${account ? ` ${account.name} অ্যাকাউন্টে জমা হয়েছে।` : ''}`,
        `${amount.toFixed(2)} TK recovered. Remaining ${remaining.toFixed(2)} TK.${account ? ` Credited to ${account.name}.` : ''}`
      ),
      this.prefs.txt('রিকভার সফল', 'Recovery successful')
    );
  }

  async deleteAdvance(id: number) {
    const confirmed = await this.notify.confirm(
      this.prefs.txt('এই এডভান্সের রেকর্ড স্থায়ীভাবে মুছে যাবে।', 'This advance record will be permanently deleted.'),
      {
        title: this.prefs.txt('এডভান্স মুছে ফেলবেন?', 'Delete this advance?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছুন', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (confirmed) {
      this.dataService.deleteStaffAdvance(id);
      this.notify.success(this.prefs.txt('স্টাফ এডভান্স মুছে ফেলা হয়েছে।', 'Staff advance deleted.'));
    }
  }

  exportExcel() {
    this.dataService.exportToExcel(this.filteredAdvances(), 'Staff_Advance_List');
  }

  printPage() {
    document.body.classList.add('print-list');
    const cleanup = () => {
      document.body.classList.remove('print-list');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 3000);
  }
}
