import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DataService, SalesReturn } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { SessionService } from '../../../services/session';
import { PreferencesService } from '../../../services/preferences';
import { DateRangeBar } from '../../../components/date-range-bar/date-range-bar';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { DateRange, inDateRange, resolveDateRange, toIsoDate } from '../../../utils/date-range';
import { dmyFromIso } from '../../../utils/local-date';

type SalesReturnTab = 'All' | SalesReturn['status'];

@Component({
  selector: 'app-sales-returns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, DateRangeBar, TablePagination],
  template: `
    <div class="space-y-4 text-xs text-slate-800 dark:text-slate-200">

      <!-- Title bar -->
      <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">published_with_changes</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                <span>{{ prefs.txt('বিক্রয়', 'Sales') }}</span>
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                <span>{{ prefs.txt('ফেরত', 'Returns') }}</span>
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('বিক্রয় ফেরত / ক্রেডিট নোট', 'Sales Return / Cr. Note') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('গ্রাহকের থেকে ফেরত আসা পণ্য ও ক্রেডিট নোটের হিসাব।', 'Goods returned by customers and their credit notes.') }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button (click)="exportExcel()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon class="text-sm text-emerald-200">download</mat-icon> {{ prefs.txt('এক্সেল', 'Excel') }}
            </button>
            <button (click)="printPage()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon class="text-sm">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
            <button (click)="openAdd()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon class="text-sm">add_circle</mat-icon> {{ prefs.txt('নতুন ফেরত', 'New Return') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div class="no-print grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-500/10 border border-teal-100 dark:border-teal-500/20 text-teal-700 dark:text-teal-300 inline-flex items-center justify-center shrink-0">
            <mat-icon class="text-lg">note_alt</mat-icon>
          </span>
          <div class="min-w-0">
            <p class="text-[9px] uppercase tracking-wider font-bold text-slate-400">{{ prefs.txt('ক্রেডিট নোট', 'Credit Notes') }}</p>
            <p class="font-mono text-lg font-extrabold leading-tight text-slate-900 dark:text-white">{{ filtered().length }}</p>
          </div>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 text-rose-600 dark:text-rose-300 inline-flex items-center justify-center shrink-0">
            <mat-icon class="text-lg">assignment_return</mat-icon>
          </span>
          <div class="min-w-0">
            <p class="text-[9px] uppercase tracking-wider font-bold text-slate-400">{{ prefs.txt('ফেরতের পরিমাণ', 'Return Amount') }}</p>
            <p class="font-mono text-lg font-extrabold leading-tight text-rose-600 dark:text-rose-300 truncate">{{ totals().amount | number:'1.2-2' }}</p>
          </div>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 inline-flex items-center justify-center shrink-0">
            <mat-icon class="text-lg">library_add_check</mat-icon>
          </span>
          <div class="min-w-0">
            <p class="text-[9px] uppercase tracking-wider font-bold text-slate-400">{{ prefs.txt('পোস্টেড', 'Posted') }}</p>
            <p class="font-mono text-lg font-extrabold leading-tight text-emerald-700 dark:text-emerald-300 truncate">{{ totals().posted | number:'1.2-2' }}</p>
          </div>
        </div>
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 text-amber-700 dark:text-amber-300 inline-flex items-center justify-center shrink-0">
            <mat-icon class="text-lg">edit_note</mat-icon>
          </span>
          <div class="min-w-0">
            <p class="text-[9px] uppercase tracking-wider font-bold text-slate-400">{{ prefs.txt('খসড়া', 'Draft') }}</p>
            <p class="font-mono text-lg font-extrabold leading-tight text-amber-700 dark:text-amber-300">{{ totals().draft }}</p>
          </div>
        </div>
      </div>

      <!-- Filters + list -->
      <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">

        <div class="p-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto flex items-center gap-2 font-semibold">
          @for (tab of tabs(); track tab.value) {
            <button
              (click)="setTab(tab.value)"
              [class]="activeTab() === tab.value
                ? 'bg-teal-700 text-white px-3 py-1.5 rounded-lg shadow-2xs'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 py-1.5 rounded-lg'"
              class="cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5"
            >
              <mat-icon class="text-sm">{{ tab.icon }}</mat-icon>
              {{ tab.label }}
              <span class="rounded-full px-1.5 text-[10px] font-black"
                [class]="activeTab() === tab.value ? 'bg-white/25' : 'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700'">
                {{ tabCount(tab.value) }}
              </span>
            </button>
          }
        </div>

        <div class="border-b border-slate-100 dark:border-slate-800 px-3 py-2.5">
          <app-date-range-bar [from]="dateFrom()" [to]="dateTo()" (rangeChange)="onRangeChange($event)" />
        </div>

        <div class="no-print p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="relative w-full sm:max-w-md">
            <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
            <input
              type="text"
              [placeholder]="prefs.txt('ক্রেডিট নোট, ইনভয়েস, গ্রাহক বা কারণ দিয়ে খুঁজুন...', 'Search credit note, invoice, customer or reason...')"
              [value]="searchQuery()"
              (input)="onSearch($event)"
              class="w-full pl-9 pr-8 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
            @if (searchQuery()) {
              <button (click)="searchQuery.set(''); pager.setPage(1)" class="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer" [title]="prefs.txt('সার্চ মুছুন', 'Clear search')">
                <mat-icon class="text-sm">close</mat-icon>
              </button>
            }
          </div>
          <div class="flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
            <span class="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">{{ filtered().length }} {{ prefs.txt('টি নোট', 'notes') }}</span>
            <span class="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">{{ prefs.txt('আইটেম', 'Items') }} <b class="font-mono text-slate-800 dark:text-slate-100">{{ totals().items }}</b></span>
          </div>
        </div>

        <!-- Desktop table -->
        <div class="list-print-shell hidden lg:block">
          <div id="list-printable-area" class="overflow-x-auto">
            <table class="w-full min-w-[1080px] text-xs text-left border-collapse">
              <thead>
                <tr class="bg-slate-50/80 dark:bg-slate-800/60">
                  <th class="px-3 py-2.5 text-center w-12 border-b border-slate-200 dark:border-slate-700 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('ক্রম', 'SL') }}</th>
                  <th class="px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('ক্রেডিট নোট', 'Credit Note') }}</th>
                  <th class="px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('তারিখ', 'Date') }}</th>
                  <th class="px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('ইনভয়েস', 'Invoice') }}</th>
                  <th class="px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('গ্রাহক', 'Customer') }}</th>
                  <th class="px-3 py-2.5 text-center border-b border-slate-200 dark:border-slate-700 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('আইটেম', 'Items') }}</th>
                  <th class="px-3 py-2.5 text-right border-b border-slate-200 dark:border-slate-700 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('পরিমাণ', 'Amount') }}</th>
                  <th class="px-3 py-2.5 text-center border-b border-slate-200 dark:border-slate-700 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('রিস্টক', 'Restock') }}</th>
                  <th class="px-3 py-2.5 text-center border-b border-slate-200 dark:border-slate-700 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('অবস্থা', 'Status') }}</th>
                  <th class="px-3 py-2.5 text-center border-b border-slate-200 dark:border-slate-700 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt('অ্যাকশন', 'Action') }}</th>
                </tr>
              </thead>
              <tbody>
                @for (r of pager.paged(); track r.id; let idx = $index) {
                  <tr (click)="viewItems(r)" [title]="prefs.txt('ক্রেডিট নোট দেখুন', 'View credit note')" class="even:bg-slate-100/60 dark:even:bg-slate-800/40 hover:bg-teal-50/50 dark:hover:bg-teal-500/10 transition-colors cursor-pointer">
                    <td class="px-3 py-2.5 text-center font-mono text-[10.5px] font-semibold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                    <td class="px-3 py-2.5">
                      <span class="font-mono font-bold text-teal-800 dark:text-teal-300">− {{ r.creditNoteNo }}</span>
                    </td>
                    <td class="px-3 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{{ displayDate(r.date) }}</td>
                    <td class="px-3 py-2.5 font-mono text-[11px] text-slate-600 dark:text-slate-300">{{ r.invoiceNumber || '—' }}</td>
                    <td class="px-3 py-2.5">
                      <div class="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100 min-w-0">
                        <mat-icon class="text-sm text-slate-400 shrink-0">person</mat-icon>
                        <span class="truncate">{{ r.customerName }}</span>
                      </div>
                    </td>
                    <td class="px-3 py-2.5 text-center">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold border bg-teal-50 text-teal-700 border-teal-100 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/25">
                        {{ r.items.length }}
                      </span>
                    </td>
                    <td class="px-3 py-2.5 text-right font-mono font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap">{{ r.amount | number:'1.2-2' }} TK</td>
                    <td class="px-3 py-2.5 text-center">
                      <span class="inline-flex items-center gap-1 text-[10.5px] font-bold"
                        [class]="r.restock ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'">
                        <mat-icon class="text-sm">{{ r.restock ? 'check_circle' : 'remove_circle_outline' }}</mat-icon>
                        {{ r.restock ? prefs.txt('হ্যাঁ', 'Yes') : prefs.txt('না', 'No') }}
                      </span>
                    </td>
                    <td class="px-3 py-2.5 text-center">
                      <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border" [class]="statusBadge(r.status)">
                        <span class="w-1.5 h-1.5 rounded-full" [class]="statusDot(r.status)"></span>
                        {{ statusLabel(r.status) }}
                      </span>
                    </td>
                    <td class="px-3 py-2.5 text-center" (click)="$event.stopPropagation()">
                      <div class="flex items-center justify-center gap-1">
                        <button (click)="viewItems(r)" class="inline-flex items-center gap-1 rounded-lg border border-teal-200 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10 hover:bg-teal-100 dark:hover:bg-teal-500/20 text-teal-700 dark:text-teal-300 px-2 py-1 font-bold cursor-pointer" [title]="prefs.txt('ক্রেডিট নোট দেখুন / প্রিন্ট', 'View / print credit note')">
                          <mat-icon class="text-sm">visibility</mat-icon> {{ prefs.txt('নোট', 'Note') }}
                        </button>
                        <button (click)="openEdit(r)" class="p-1.5 rounded-lg text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-500/15 cursor-pointer" [title]="prefs.txt('সম্পাদনা', 'Edit')">
                          <mat-icon class="text-sm">edit</mat-icon>
                        </button>
                        @if (session.has('deleteRecords')) {
                          <button (click)="deleteRecord(r.id)" class="p-1.5 rounded-lg text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-500/15 cursor-pointer" [title]="prefs.txt('মুছুন', 'Delete')">
                            <mat-icon class="text-sm">delete</mat-icon>
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="10" class="p-14 text-center">
                      <div class="flex flex-col items-center gap-1 text-slate-400">
                        <mat-icon class="text-3xl text-slate-300 dark:text-slate-600">assignment_return</mat-icon>
                        <p class="font-bold text-slate-600 dark:text-slate-300">{{ prefs.txt('কোনো বিক্রয় ফেরত পাওয়া যায়নি', 'No sales returns found') }}</p>
                        <p class="text-[11px]">{{ searchQuery() || activeTab() !== 'All' || dateFrom() || dateTo()
                          ? prefs.txt('অন্য সার্চ, ট্যাব বা তারিখ পরিসর চেষ্টা করুন।', 'Try another search, tab or date range.')
                          : prefs.txt('শুরু করতে প্রথম বিক্রয় ফেরত তৈরি করুন।', 'Create your first sales return to get started.') }}</p>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
              @if (filtered().length) {
                <tfoot>
                  <tr class="bg-slate-50/80 dark:bg-slate-800/60 border-t-2 border-slate-200 dark:border-slate-700 font-bold">
                    <td colspan="5" class="px-3 py-2.5 text-right text-[10px] uppercase tracking-wider text-slate-500">{{ prefs.txt('এই পৃষ্ঠার মোট', 'Page total') }}</td>
                    <td class="px-3 py-2.5 text-center font-mono text-[10.5px] text-slate-600 dark:text-slate-300">{{ pageItems() }}</td>
                    <td class="px-3 py-2.5 text-right font-mono text-rose-600 dark:text-rose-400 whitespace-nowrap">{{ pageAmount() | number:'1.2-2' }} TK</td>
                    <td colspan="3"></td>
                  </tr>
                </tfoot>
              }
            </table>
          </div>

          <app-table-pagination
            [total]="pager.total()"
            [page]="pager.currentPage()"
            [pageSize]="pager.pageSize()"
            (pageChange)="pager.setPage($event)"
            (pageSizeChange)="pager.setPageSize($event)"
          />

          <div class="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-[10px] font-semibold text-slate-400">
            {{ prefs.txt('দেখানো হচ্ছে', 'Showing') }} {{ pager.paged().length }} / {{ filtered().length }} {{ prefs.txt('ক্রেডিট নোট', 'credit notes') }}
          </div>
        </div>

        <!-- Mobile cards -->
        <div class="no-print lg:hidden divide-y divide-slate-100 dark:divide-slate-800">
          @for (r of pager.paged(); track r.id) {
            <div class="p-3 space-y-2.5">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{{ r.customerName }}</p>
                  <p class="text-[10px] text-slate-500 font-mono">− {{ r.creditNoteNo }} • {{ r.invoiceNumber || prefs.txt('ইনভয়েস নেই', 'No invoice') }}</p>
                </div>
                <span class="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="statusBadge(r.status)">{{ statusLabel(r.status) }}</span>
              </div>

              <div class="grid grid-cols-3 gap-2 text-center bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2">
                <div>
                  <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('আইটেম', 'Items') }}</p>
                  <p class="font-mono font-bold text-slate-800 dark:text-slate-100 text-[11px]">{{ r.items.length }}</p>
                </div>
                <div>
                  <p class="text-[9px] uppercase font-bold text-rose-400">{{ prefs.txt('ফেরত', 'Return') }}</p>
                  <p class="font-mono font-bold text-rose-600 dark:text-rose-400 text-[11px]">{{ r.amount | number:'1.2-2' }}</p>
                </div>
                <div>
                  <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('স্টক', 'Stock') }}</p>
                  <p class="font-mono font-bold text-[11px]" [class]="r.restock ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'">{{ r.restock ? prefs.txt('ফেরত', 'Back') : prefs.txt('না', 'No') }}</p>
                </div>
              </div>

              <div class="flex items-center justify-between gap-2 text-[10px] text-slate-500 flex-wrap">
                <span class="inline-flex items-center gap-1"><mat-icon class="text-xs">event</mat-icon>{{ displayDate(r.date) }}</span>
                <span class="truncate max-w-[55%]" [title]="r.reason">{{ r.reason || prefs.txt('কারণ নেই', 'No reason') }}</span>
              </div>

              <div class="flex items-center gap-1">
                <button (click)="viewItems(r)" class="flex-1 inline-flex items-center justify-center gap-1 bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                  <mat-icon class="text-sm">visibility</mat-icon> {{ prefs.txt('ক্রেডিট নোট', 'Credit Note') }}
                </button>
                <button (click)="openEdit(r)" class="inline-flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer" [title]="prefs.txt('সম্পাদনা', 'Edit')">
                  <mat-icon class="text-sm">edit</mat-icon>
                </button>
                @if (session.has('deleteRecords')) {
                  <button (click)="deleteRecord(r.id)" class="inline-flex items-center justify-center bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer" [title]="prefs.txt('মুছুন', 'Delete')">
                    <mat-icon class="text-sm">delete</mat-icon>
                  </button>
                }
              </div>
            </div>
          } @empty {
            <div class="p-10 text-center">
              <div class="flex flex-col items-center gap-1 text-slate-400">
                <mat-icon class="text-3xl text-slate-300 dark:text-slate-600">assignment_return</mat-icon>
                <p class="font-bold text-slate-600 dark:text-slate-300">{{ prefs.txt('কোনো বিক্রয় ফেরত পাওয়া যায়নি', 'No sales returns found') }}</p>
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
    </div>
  `
})
export class SalesReturns {
  readonly dataService = inject(DataService);
  private readonly notify = inject(NotificationService);
  readonly session = inject(SessionService);
  private readonly router = inject(Router);
  readonly prefs = inject(PreferencesService);

  readonly tabs = computed<{ value: SalesReturnTab; label: string; icon: string }[]>(() => [
    { value: 'All', label: this.prefs.txt('সব', 'All'), icon: 'assignment_return' },
    { value: 'Posted', label: this.prefs.txt('পোস্টেড', 'Posted'), icon: 'library_add_check' },
    { value: 'Draft', label: this.prefs.txt('খসড়া', 'Draft'), icon: 'edit_note' },
    { value: 'Cancelled', label: this.prefs.txt('বাতিল', 'Cancelled'), icon: 'block' }
  ]);

  activeTab = signal<SalesReturnTab>('All');
  searchQuery = signal('');
  /** Returns are looked up from history, so the list opens on all time and narrows from the bar. */
  private readonly initialRange = resolveDateRange('all');
  dateFrom = signal(this.initialRange.from);
  dateTo = signal(this.initialRange.to);

  filtered = computed<SalesReturn[]>(() => {
    const tab = this.activeTab();
    const q = this.searchQuery().toLowerCase().trim();
    const from = this.dateFrom();
    const to = this.dateTo();
    let list = this.dataService.salesReturns().filter(r => inDateRange(r.date, from, to));
    if (tab !== 'All') list = list.filter(r => r.status === tab);
    if (q) {
      list = list.filter(r =>
        (r.creditNoteNo || '').toLowerCase().includes(q) ||
        (r.invoiceNumber || '').toLowerCase().includes(q) ||
        (r.customerName || '').toLowerCase().includes(q) ||
        (r.reason || '').toLowerCase().includes(q) ||
        (r.date || '').toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const dateCompare = toIsoDate(b.date).localeCompare(toIsoDate(a.date));
      return dateCompare || (b.creditNoteNo || '').localeCompare(a.creditNoteNo || '', undefined, { numeric: true });
    });
  });

  readonly pager = createPager(() => this.filtered());

  totals = computed(() => {
    const list = this.filtered();
    return {
      amount: this.money(list.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
      posted: this.money(list.filter(r => r.status === 'Posted').reduce((s, r) => s + (Number(r.amount) || 0), 0)),
      draft: list.filter(r => r.status === 'Draft').length,
      items: list.reduce((s, r) => s + (r.items?.length || 0), 0)
    };
  });

  pageAmount(): number {
    return this.money(this.pager.paged().reduce((s, r) => s + (Number(r.amount) || 0), 0));
  }

  pageItems(): number {
    return this.pager.paged().reduce((s, r) => s + (r.items?.length || 0), 0);
  }

  tabCount(value: SalesReturnTab): number {
    const from = this.dateFrom();
    const to = this.dateTo();
    const list = this.dataService.salesReturns().filter(r => inDateRange(r.date, from, to));
    return value === 'All' ? list.length : list.filter(r => r.status === value).length;
  }

  setTab(value: SalesReturnTab) {
    this.activeTab.set(value);
    this.pager.setPage(1);
  }

  onRangeChange(range: DateRange) {
    this.dateFrom.set(range.from);
    this.dateTo.set(range.to);
    this.pager.setPage(1);
  }

  onSearch(e: Event) {
    this.searchQuery.set((e.target as HTMLInputElement).value);
    this.pager.setPage(1);
  }

  statusLabel(status: SalesReturn['status']): string {
    const map: Record<SalesReturn['status'], string> = {
      Posted: this.prefs.txt('পোস্টেড', 'Posted'),
      Draft: this.prefs.txt('খসড়া', 'Draft'),
      Cancelled: this.prefs.txt('বাতিল', 'Cancelled')
    };
    return map[status] || status;
  }

  statusBadge(status: SalesReturn['status']): string {
    const map: Record<SalesReturn['status'], string> = {
      Posted: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25',
      Draft: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      Cancelled: 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25'
    };
    return map[status];
  }

  statusDot(status: SalesReturn['status']): string {
    const map: Record<SalesReturn['status'], string> = {
      Posted: 'bg-emerald-500',
      Draft: 'bg-slate-400',
      Cancelled: 'bg-rose-500'
    };
    return map[status];
  }

  money(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  displayDate(value: string): string {
    const iso = toIsoDate(value);
    return iso ? dmyFromIso(iso) : (value || '—');
  }

  openAdd() {
    this.router.navigate(['/sales/returns/add']);
  }

  openEdit(record: SalesReturn) {
    this.router.navigate(['/sales/returns/add'], { queryParams: { edit: record.id } });
  }

  viewItems(record: SalesReturn) {
    this.router.navigate(['/sales/returns/add'], { queryParams: { view: record.id } });
  }

  async deleteRecord(id: number) {
    const confirmed = await this.notify.confirm(
      this.prefs.txt('মুছে ফেললে গ্রাহকের হিসাব ও স্টক আগের অবস্থায় ফিরে যাবে।', 'Deleting will restore the customer account and stock to their previous state.'),
      {
        title: this.prefs.txt('মুছে ফেলবেন?', 'Delete it?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছুন', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    this.dataService.deleteSalesReturn(id);
    this.notify.success(this.prefs.txt('বিক্রয় ফেরত মুছে ফেলা হয়েছে।', 'Sales return deleted.'));
  }

  exportExcel() {
    const rows = this.filtered().map(({ items, ...rest }) => ({ ...rest, itemCount: items.length }));
    this.dataService.exportToExcel(rows, 'Sales_Returns');
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
