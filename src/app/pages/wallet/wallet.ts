import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, WalletAccount, WalletTransaction } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { SessionService } from '../../services/session';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';
import { DmyDateDirective } from '../../directives/dmy-date.directive';

type DrawerMode = 'account' | 'txn';

@Component({
  selector: 'app-wallet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, DmyDateDirective],
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

      <!-- Page Header -->
      <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">account_balance_wallet</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                {{ prefs.txt('ড্যাশবোর্ড', 'Dashboard') }}
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                {{ prefs.txt('ওয়ালেট', 'Wallet') }}
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('ওয়ালেট / হোল্ডিং', 'Wallet / Holdings') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('অ্যাকাউন্ট, ব্যালেন্স ও লেনদেনের খাতা', 'Accounts, balances & ledger') }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button (click)="exportExcel()" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer">
              <mat-icon class="text-xs">description</mat-icon> Excel
            </button>
            <button (click)="printPage()" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer">
              <mat-icon class="text-xs">print</mat-icon> Print
            </button>
            <button (click)="openNewTxn()" class="inline-flex items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 transition hover:bg-teal-50 cursor-pointer">
              <mat-icon class="text-xs">paid</mat-icon> {{ prefs.txt('নতুন লেনদেন', 'New transaction') }}
            </button>
            <button (click)="openAddAccount()" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3.5 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer">
              <mat-icon class="text-xs">account_balance</mat-icon> {{ prefs.txt('নতুন অ্যাকাউন্ট', 'New account') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Account Holding Cards -->
      <div class="no-print grid grid-cols-2 lg:grid-cols-4 gap-3">
        @for (acc of dataService.walletAccounts(); track acc.id) {
          <div
            (click)="toggleAccountFilter(acc.id)"
            [title]="prefs.txt('এই অ্যাকাউন্টের লেনদেন দেখুন', 'View this account’s transactions')"
            class="bg-white rounded-xl border p-3.5 shadow-2xs cursor-pointer transition-colors hover:bg-slate-50"
            [class]="accountCardClass(acc)"
          >
            <div class="flex items-start justify-between gap-2">
              <span class="font-bold text-teal-800 dark:text-teal-300 truncate">{{ acc.name }}</span>
              <span class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="typeBadge(acc.type)">{{ acc.type }}</span>
            </div>

            <p class="mt-2 text-lg font-black font-mono" [class]="balanceTextClass(balanceOf(acc.id))">
              {{ balanceOf(acc.id) | number:'1.2-2' }} <span class="text-[10px] font-bold">TK</span>
            </p>

            <div class="mt-1.5 flex items-center justify-between gap-1 text-[10px] text-slate-500">
              <span class="truncate">{{ acc.identifier || prefs.txt('কোনো আইডি নেই', 'No ID') }}</span>
              <span [class]="acc.status === 'Enabled' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'">{{ statusLabel(acc.status) }}</span>
            </div>

            <div class="mt-2 flex items-center gap-1">
              <button (click)="$event.stopPropagation(); openTxnFor(acc.id)" class="flex-1 inline-flex items-center justify-center gap-1 bg-teal-700 hover:bg-teal-800 text-white text-[10px] font-bold px-2 py-1 rounded-lg cursor-pointer">
                <mat-icon class="text-xs">paid</mat-icon> {{ prefs.txt('লেনদেন', 'Transaction') }}
              </button>
              <button (click)="$event.stopPropagation(); openEditAccount(acc)" class="p-1 text-amber-600 hover:bg-amber-100 rounded cursor-pointer" [title]="prefs.txt('অ্যাকাউন্ট সম্পাদনা', 'Edit account')">
                <mat-icon class="text-xs">edit</mat-icon>
              </button>
              @if (session.has('deleteRecords')) {
                <button (click)="$event.stopPropagation(); deleteAccount(acc)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer" [title]="prefs.txt('অ্যাকাউন্ট মুছুন', 'Delete account')">
                  <mat-icon class="text-xs">delete</mat-icon>
                </button>
              }
            </div>
          </div>
        } @empty {
          <div class="col-span-full bg-white rounded-xl border border-slate-200 p-5 text-center text-slate-400">
            <mat-icon class="text-2xl text-slate-300">account_balance_wallet</mat-icon>
            <p class="text-xs font-semibold mt-1">{{ prefs.txt('এখনো কোনো ওয়ালেট অ্যাকাউন্ট নেই। “নতুন অ্যাকাউন্ট” চাপুন।', 'No wallet account yet. Tap “New account”.') }}</p>
          </div>
        }
      </div>

      <!-- Ledger Tabs -->
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

      <!-- Search, Date Range & Summary -->
      <div class="no-print bg-white p-3 rounded-xl shadow-xs border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          <div class="relative w-full sm:w-72">
            <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
            <input
              type="text"
              [placeholder]="prefs.txt('নাম্বার, পার্টি, নোট বা তারিখ দিয়ে খুঁজুন...', 'Search by number, party, note or date...')"
              [value]="searchQuery()"
              (input)="onSearchInput($event)"
              class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none"
            />
          </div>
          <div class="flex items-center gap-1.5 text-slate-500">
            <mat-icon class="text-sm">event</mat-icon>
            <input type="date" appDmyDate [ngModel]="fromDate()" (ngModelChange)="setFromDate($event)"
              class="border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none" />
            <span class="font-bold">{{ prefs.txt('থেকে', 'to') }}</span>
            <input type="date" appDmyDate [ngModel]="toDate()" (ngModelChange)="setToDate($event)"
              class="border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none" />
            @if (fromDate() || toDate()) {
              <button (click)="clearRange()" class="text-slate-500 hover:text-rose-600 cursor-pointer px-1" [title]="prefs.txt('তারিখ রিসেট', 'Reset dates')">
                <mat-icon class="text-sm">clear</mat-icon>
              </button>
            }
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ prefs.txt('লেনদেন', 'Transactions') }} <b class="font-mono text-slate-800">{{ filteredTxns().length }}</b> {{ prefs.txt('টি', 'rows') }}
          </span>
          @if (accountFilterId() !== null) {
            <button (click)="setAccountFilter(null)" class="px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 dark:text-teal-300 inline-flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-xs">filter_alt</mat-icon>{{ accountName(accountFilterId()) }}
              <mat-icon class="text-xs">close</mat-icon>
            </button>
          }
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ prefs.txt('সব অ্যাকাউন্টের ব্যালান্স', 'All account balance') }} <b class="font-mono text-slate-800">{{ totals().balance | number:'1.2-2' }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200">
            {{ prefs.txt('মোট ইন', 'Total in') }} <b class="font-mono text-emerald-600 dark:text-emerald-400">{{ totals().income | number:'1.2-2' }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200">
            {{ prefs.txt('মোট আউট', 'Total out') }} <b class="font-mono text-rose-600 dark:text-rose-400">{{ totals().outcome | number:'1.2-2' }}</b>
          </span>
        </div>
      </div>

      <!-- Ledger Table (desktop / print) -->
      <div class="list-print-shell hidden lg:block bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div id="list-printable-area" class="overflow-auto max-h-[72vh]">
          <table class="w-full min-w-[1080px] text-xs text-left border-collapse text-slate-700 dark:text-slate-200">
            <thead>
              <tr class="text-white font-bold uppercase text-[11px] tracking-wider">
                <th class="p-2.5 text-center w-10 pt-sticky">SL</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('ভাউচার', 'TXN NO') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('তারিখ', 'DATE') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('অ্যাকাউন্ট', 'ACCOUNT') }}</th>
                <th class="p-2.5 text-center pt-sticky">{{ prefs.txt('দিক', 'DIRECTION') }}</th>
                <th class="p-2.5 text-right pt-sticky">{{ prefs.txt('টাকা', 'AMOUNT') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('পার্টি', 'PARTY') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('নোট', 'NOTE') }}</th>
                <th class="p-2.5 text-center w-28 pt-sticky">{{ prefs.txt('অ্যাকশন', 'ACTION') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (t of pager.paged(); track t.id; let idx = $index) {
                <tr class="hover:bg-[#e2e8f0] transition-colors">
                  <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-mono font-bold text-slate-800">{{ t.txnNo }}</td>
                  <td class="p-2.5 text-slate-500 whitespace-nowrap">{{ displayDate(t.date) }}</td>
                  <td class="p-2.5">
                    <span class="font-bold text-teal-800 dark:text-teal-300">{{ accountName(t.accountId) }}</span>
                  </td>
                  <td class="p-2.5 text-center">
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap" [class]="directionBadge(t.direction)">
                      <mat-icon class="text-[10px]">{{ t.direction === 'In' ? 'south' : 'north' }}</mat-icon>{{ directionLabel(t.direction) }}
                    </span>
                  </td>
                  <td class="p-2.5 text-right font-mono font-bold" [class]="t.direction === 'In' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
                    {{ t.direction === 'In' ? '+ ' : '- ' }}{{ t.amount | number:'1.2-2' }}
                  </td>
                  <td class="p-2.5 font-medium text-slate-700 dark:text-slate-200">{{ t.party || '-' }}</td>
                  <td class="p-2.5 text-slate-600">
                    <div class="max-w-[240px] truncate" [title]="t.note">{{ t.note || '-' }}</div>
                  </td>
                  <td class="p-2.5 text-center">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="setAccountFilter(t.accountId)" class="p-1 text-teal-600 hover:bg-teal-100 rounded cursor-pointer" [title]="prefs.txt('এই অ্যাকাউন্টের লেনদেন', 'Transactions of this account')">
                        <mat-icon class="text-sm">filter_alt</mat-icon>
                      </button>
                      @if (session.has('deleteRecords')) {
                        @if (canDeleteTxn(t)) {
                          <button (click)="deleteTxn(t)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer" [title]="prefs.txt('লেনদেন মুছুন', 'Delete transaction')">
                            <mat-icon class="text-sm">delete</mat-icon>
                          </button>
                        } @else {
                          <button (click)="showLinkedNotice(t)" class="p-1 text-slate-400 hover:bg-slate-100 rounded cursor-pointer" [title]="prefs.txt('ডকুমেন্ট থেকে তৈরি লেনদেন', 'Posted by a document')">
                            <mat-icon class="text-sm">link</mat-icon>
                          </button>
                        }
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="9" class="p-10 text-center">
                    <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
                      <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                        <mat-icon class="text-2xl text-slate-300">account_balance_wallet</mat-icon>
                      </span>
                      <p class="text-xs font-semibold">{{ prefs.txt('এই হিসাবে কোনো লেনদেন পাওয়া যায়নি।', 'No transactions found in this ledger.') }}</p>
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

      <!-- Ledger Cards (mobile / tablet) -->
      <div class="no-print lg:hidden bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden divide-y divide-slate-100">
        @for (t of pager.paged(); track t.id; let idx = $index) {
          <div class="p-3 space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-bold text-teal-800 dark:text-teal-300 truncate">{{ accountName(t.accountId) }}</p>
                <p class="text-[10px] text-slate-500 font-mono">{{ t.txnNo }} • SL {{ pager.offset() + idx + 1 }}</p>
              </div>
              <span class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="directionBadge(t.direction)">{{ directionLabel(t.direction) }}</span>
            </div>

            <div class="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-2.5 py-1.5">
              <span class="text-[10px] uppercase font-bold text-slate-400">{{ prefs.txt('তারিখ', 'Date') }}</span>
              <span class="text-[11px] text-slate-600">{{ displayDate(t.date) }}</span>
              <span class="font-mono font-black text-[12px]" [class]="t.direction === 'In' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
                {{ t.direction === 'In' ? '+ ' : '- ' }}{{ t.amount | number:'1.2-2' }}
              </span>
            </div>

            <div class="text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
              <span class="inline-flex items-center gap-1"><mat-icon class="text-xs">person</mat-icon>{{ t.party || '-' }}</span>
              <span class="inline-flex items-center gap-1 min-w-0"><mat-icon class="text-xs">note</mat-icon><span class="truncate max-w-[180px]">{{ t.note || '-' }}</span></span>
            </div>

            <div class="flex items-center gap-1">
              <button (click)="setAccountFilter(t.accountId)" class="flex-1 inline-flex items-center justify-center gap-1 bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">filter_alt</mat-icon> {{ prefs.txt('লেনদেন দেখুন', 'View transactions') }}
              </button>
              @if (session.has('deleteRecords')) {
                @if (canDeleteTxn(t)) {
                  <button (click)="deleteTxn(t)" class="inline-flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                    <mat-icon class="text-sm">delete</mat-icon>
                  </button>
                } @else {
                  <button (click)="showLinkedNotice(t)" class="inline-flex items-center justify-center gap-1 bg-slate-200 hover:bg-slate-300 text-slate-600 text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                    <mat-icon class="text-sm">link</mat-icon>
                  </button>
                }
              }
            </div>
          </div>
        } @empty {
          <div class="p-8 text-center">
            <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
              <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                <mat-icon class="text-2xl text-slate-300">account_balance_wallet</mat-icon>
              </span>
              <p class="text-xs font-semibold">{{ prefs.txt('এই হিসাবে কোনো লেনদেন পাওয়া যায়নি।', 'No transactions found in this ledger.') }}</p>
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

    <!-- Right Side-Over Drawer: Wallet Account / Transaction -->
    @if (showAddDrawer()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end">
        <div class="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden text-slate-800 animate-in slide-in-from-right duration-300">

          <!-- Drawer Header & Mode Switch -->
          <div class="bg-white border-b border-slate-200">
            <div class="p-4 flex items-center justify-between border-b border-slate-100">
              <div class="flex items-center gap-2">
                <button (click)="closeDrawer()" class="text-slate-400 hover:text-slate-700 cursor-pointer p-1 rounded-full hover:bg-slate-100 transition-colors">
                  <mat-icon class="text-lg">close</mat-icon>
                </button>
                <h2 class="text-base font-bold text-slate-900">
                  @if (drawerMode() === 'account') {
                    {{ isEditMode() ? prefs.txt('অ্যাকাউন্ট সম্পাদনা', 'Edit account') : prefs.txt('নতুন ওয়ালেট অ্যাকাউন্ট', 'New wallet account') }}
                  } @else {
                    {{ prefs.txt('নতুন লেনদেন', 'New transaction') }}
                  }
                </h2>
              </div>
              <div class="flex items-center bg-slate-100 rounded-lg p-0.5 text-[11px] font-bold">
                <button (click)="setMode('account')" [class]="drawerMode() === 'account' ? 'bg-teal-700 text-white px-3 py-1.5 rounded-lg shadow-2xs cursor-pointer' : 'text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg cursor-pointer'">
                  {{ prefs.txt('অ্যাকাউন্ট', 'Account') }}
                </button>
                <button (click)="setMode('txn')" [class]="drawerMode() === 'txn' ? 'bg-teal-700 text-white px-3 py-1.5 rounded-lg shadow-2xs cursor-pointer' : 'text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg cursor-pointer'">
                  {{ prefs.txt('লেনদেন', 'Transaction') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Drawer Body -->
          <div class="flex-1 overflow-y-auto p-6 space-y-4">

            @if (drawerMode() === 'account') {
              <div class="space-y-4 animate-in fade-in duration-200">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('অ্যাকাউন্টের নাম', 'Account name') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                      <mat-icon class="text-slate-400 text-sm mr-2">label</mat-icon>
                      <input type="text" [(ngModel)]="formAccName" [placeholder]="prefs.txt('যেমন: ক্যাশ কাউন্টার', 'e.g. Cash counter')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('ধরন', 'Type') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                      <mat-icon class="text-slate-400 text-sm mr-2">category</mat-icon>
                      <select [(ngModel)]="formAccType" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                        @for (t of accountTypes(); track t) {
                          <option [value]="t">{{ t }}</option>
                        }
                      </select>
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('আইডি / নম্বর', 'ID / number') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                      <mat-icon class="text-slate-400 text-sm mr-2">badge</mat-icon>
                      <input type="text" [(ngModel)]="formAccIdentifier" placeholder="019XXXXXXXX / A/C 1234" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ওপেনিং ব্যালান্স', 'Opening balance') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-400">
                      <span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-1.5 border-r border-slate-300">TK</span>
                      <input type="number" step="0.01" [(ngModel)]="formAccOpening" class="w-full p-1.5 outline-none text-xs font-bold text-slate-900 font-mono">
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('স্ট্যাটাস', 'Status') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                      <mat-icon class="text-emerald-500 text-sm mr-2">check_circle</mat-icon>
                      <select [(ngModel)]="formAccStatus" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                        <option value="Enabled">{{ prefs.txt('সক্রিয়', 'Enabled') }}</option>
                        <option value="Disabled">{{ prefs.txt('নিষ্ক্রিয়', 'Disabled') }}</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('নোট', 'Note') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                      <mat-icon class="text-slate-400 text-sm mr-2">note</mat-icon>
                      <input type="text" [(ngModel)]="formAccNote" [placeholder]="prefs.txt('মন্তব্য...', 'Remarks...')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>
                </div>
              </div>
            } @else {
              <div class="space-y-4 animate-in fade-in duration-200">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('তারিখ', 'Date') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                      <mat-icon class="text-slate-400 text-sm mr-2">calendar_today</mat-icon>
                      <input type="date" appDmyDate [(ngModel)]="formTxnDate" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('দিক', 'Direction') }}</label>
                    <div class="flex items-center bg-slate-100 rounded-lg p-1 gap-1">
                      <button type="button" (click)="formTxnDirection = 'In'" [class]="formTxnDirection === 'In' ? 'flex-1 bg-emerald-600 text-white font-bold py-1.5 rounded-md text-xs cursor-pointer shadow-2xs' : 'flex-1 text-slate-600 dark:text-slate-300 font-bold py-1.5 rounded-md text-xs cursor-pointer'">
                        {{ prefs.txt('ইন (জমা)', 'In (received)') }}
                      </button>
                      <button type="button" (click)="formTxnDirection = 'Out'" [class]="formTxnDirection === 'Out' ? 'flex-1 bg-rose-600 text-white font-bold py-1.5 rounded-md text-xs cursor-pointer shadow-2xs' : 'flex-1 text-slate-600 dark:text-slate-300 font-bold py-1.5 rounded-md text-xs cursor-pointer'">
                        {{ prefs.txt('আউট (খরচ)', 'Out (spent)') }}
                      </button>
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('অ্যাকাউন্ট', 'Account') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                      <mat-icon class="text-slate-400 text-sm mr-2">account_balance</mat-icon>
                      <select [ngModel]="formTxnAccountId" (ngModelChange)="formTxnAccountId = $event" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                        <option [ngValue]="0">{{ prefs.txt('অ্যাকাউন্ট বাছুন...', 'Select account...') }}</option>
                        @for (acc of dataService.walletAccounts(); track acc.id) {
                          <option [ngValue]="acc.id">{{ acc.name }} ({{ acc.type }})</option>
                        }
                      </select>
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('পরিমাণ', 'Amount') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-400">
                      <span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-1.5 border-r border-slate-300">TK</span>
                      <input type="number" step="0.01" [(ngModel)]="formTxnAmount" class="w-full p-1.5 outline-none text-xs font-bold text-slate-900 font-mono">
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('পার্টি / কারণ', 'Party / reason') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                      <mat-icon class="text-slate-400 text-sm mr-2">person</mat-icon>
                      <input type="text" [(ngModel)]="formTxnParty" [placeholder]="prefs.txt('যার থেকে / যাকে', 'From / to whom')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('নোট', 'Note') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                      <mat-icon class="text-slate-400 text-sm mr-2">note</mat-icon>
                      <input type="text" [(ngModel)]="formTxnNote" [placeholder]="prefs.txt('বিস্তারিত...', 'Details...')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>
                </div>

                @if (selectedAccountName()) {
                  <div class="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-600 flex items-center gap-1.5">
                    <mat-icon class="text-sm text-teal-600">info</mat-icon>
                    {{ selectedAccountName() }} — {{ prefs.txt('এখনকার ব্যালান্স', 'current balance') }}
                    <b class="font-mono" [class]="balanceTextClass(selectedAccountBalance())">{{ selectedAccountBalance() | number:'1.2-2' }}</b>
                    {{ prefs.txt('লেনদেনের পর দেখানো হবে।', 'Updated after the transaction.') }}
                  </div>
                }
              </div>
            }

          </div>

          <!-- Drawer Footer -->
          <div class="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
            <button (click)="closeDrawer()" class="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer transition-colors">
              {{ prefs.txt('বাতিল', 'Cancel') }}
            </button>
            <button (click)="saveDrawer()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-2xs cursor-pointer transition-colors">
              <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ করুন', 'Save') }}
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class Wallet {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  prefs = inject(PreferencesService);
  session = inject(SessionService);

  activeTab = signal<string>('All');
  searchQuery = signal<string>('');
  fromDate = signal<string>('');
  toDate = signal<string>('');
  accountFilterId = signal<number | null>(null);

  showAddDrawer = signal<boolean>(false);
  drawerMode = signal<DrawerMode>('account');
  isEditMode = signal<boolean>(false);
  editingAccountId = signal<number | null>(null);

  readonly accountTypes = signal<WalletAccount['type'][]>(['Cash', 'bKash', 'Nagad', 'Rocket', 'Bank']);

  // Account form state
  formAccName = '';
  formAccType: WalletAccount['type'] = 'Cash';
  formAccIdentifier = '';
  formAccOpening = 0;
  formAccStatus: WalletAccount['status'] = 'Enabled';
  formAccNote = '';

  // Transaction form state
  formTxnDate = this.today();
  formTxnDirection: WalletTransaction['direction'] = 'In';
  formTxnAccountId = 0;
  formTxnAmount = 0;
  formTxnParty = '';
  formTxnNote = '';

  readonly tabDefs = computed(() => [
    { value: 'All', label: this.prefs.txt('সব লেনদেন', 'All transactions'), icon: 'swap_horiz' },
    { value: 'In', label: this.prefs.txt('ইন (জমা)', 'In (received)'), icon: 'arrow_downward' },
    { value: 'Out', label: this.prefs.txt('আউট (খরচ)', 'Out (spent)'), icon: 'arrow_upward' }
  ]);

  directionLabel(direction: WalletTransaction['direction']): string {
    return direction === 'In' ? this.prefs.txt('ইন', 'In') : this.prefs.txt('আউট', 'Out');
  }

  statusLabel(status: WalletAccount['status']): string {
    return status === 'Enabled' ? this.prefs.txt('সক্রিয়', 'Enabled') : this.prefs.txt('নিষ্ক্রিয়', 'Disabled');
  }

  tabCount(value: string): number {
    const list = this.dataService.walletTransactions();
    return value === 'All' ? list.length : list.filter(t => t.direction === value).length;
  }

  filteredTxns = computed(() => {
    let list = this.dataService.walletTransactions();
    const tab = this.activeTab();
    const accId = this.accountFilterId();
    const from = this.fromDate();
    const to = this.toDate();
    const q = this.searchQuery().toLowerCase().trim();

    if (tab !== 'All') list = list.filter(t => t.direction === tab);
    if (accId !== null) list = list.filter(t => t.accountId === accId);
    if (from) list = list.filter(t => this.isoDay(t.date) >= from);
    if (to) list = list.filter(t => this.isoDay(t.date) <= to);

    if (q) {
      list = list.filter(t =>
        t.txnNo.toLowerCase().includes(q) ||
        (t.party || '').toLowerCase().includes(q) ||
        (t.note || '').toLowerCase().includes(q) ||
        this.accountName(t.accountId).toLowerCase().includes(q) ||
        this.isoDay(t.date).includes(q) ||
        this.displayDate(t.date).includes(q)
      );
    }

    return list;
  });

  readonly pager = createPager<WalletTransaction>(() => this.filteredTxns());

  totals = computed(() => {
    const list = this.filteredTxns();
    const sum = (pick: (t: WalletTransaction) => number) =>
      Math.round(list.reduce((acc, t) => acc + (Number(pick(t)) || 0), 0) * 100) / 100;
    return {
      // walletTotals() folds in every account's opening balance, so it is not a ledger sum.
      balance: Math.round(this.dataService.walletTotals() * 100) / 100,
      income: sum(t => t.direction === 'In' ? t.amount : 0),
      outcome: sum(t => t.direction === 'Out' ? t.amount : 0)
    };
  });

  setTab(value: string) {
    this.activeTab.set(value);
    this.pager.setPage(1);
  }

  setFromDate(value: string) {
    this.fromDate.set(value || '');
    this.pager.setPage(1);
  }

  setToDate(value: string) {
    this.toDate.set(value || '');
    this.pager.setPage(1);
  }

  onSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.searchQuery.set(target.value);
    this.pager.setPage(1);
  }

  clearRange() {
    this.fromDate.set('');
    this.toDate.set('');
    this.pager.setPage(1);
  }

  setAccountFilter(id: number | null) {
    this.accountFilterId.set(id);
    this.pager.setPage(1);
  }

  toggleAccountFilter(id: number) {
    this.setAccountFilter(this.accountFilterId() === id ? null : id);
  }

  balanceOf(accountId: number): number {
    return this.dataService.walletBalance(accountId);
  }

  accountName(accountId: number | null): string {
    if (accountId === null) return '-';
    return this.dataService.walletAccounts().find(a => a.id === accountId)?.name || this.prefs.txt('মুছে গেছে', 'Deleted');
  }

  selectedAccountName(): string {
    return this.formTxnAccountId ? this.accountName(this.formTxnAccountId) : '';
  }

  selectedAccountBalance(): number {
    return this.formTxnAccountId ? this.balanceOf(this.formTxnAccountId) : 0;
  }

  accountCardClass(acc: WalletAccount): string {
    return this.accountFilterId() === acc.id
      ? 'border-teal-600 ring-1 ring-teal-400'
      : 'border-slate-200 dark:border-slate-700';
  }

  typeBadge(type: WalletAccount['type']): string {
    const map: Record<WalletAccount['type'], string> = {
      'Cash': 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300',
      'bKash': 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
      'Nagad': 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
      'Rocket': 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300',
      'Bank': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300'
    };
    return map[type] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }

  directionBadge(direction: WalletTransaction['direction']): string {
    return direction === 'In'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
      : 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300';
  }

  balanceTextClass(value: number): string {
    if (value > 0) return 'text-emerald-600 dark:text-emerald-400';
    if (value < 0) return 'text-rose-600 dark:text-rose-400';
    return 'text-slate-500 dark:text-slate-300';
  }

  isoDay(value: string): string {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || '').trim());
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : '';
  }

  displayDate(value: string): string {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || '').trim());
    return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : (value || '-');
  }

  private today(): string {
    return localDateIso();
  }

  setMode(mode: DrawerMode) {
    if (mode === this.drawerMode()) return;
    this.drawerMode.set(mode);
    if (mode === 'txn') {
      this.isEditMode.set(false);
      this.editingAccountId.set(null);
    }
    if (mode === 'account' && !this.isEditMode()) this.resetAccountForm();
  }

  resetAccountForm() {
    this.formAccName = '';
    this.formAccType = 'Cash';
    this.formAccIdentifier = '';
    this.formAccOpening = 0;
    this.formAccStatus = 'Enabled';
    this.formAccNote = '';
  }

  openAddAccount() {
    this.resetAccountForm();
    this.drawerMode.set('account');
    this.isEditMode.set(false);
    this.editingAccountId.set(null);
    this.showAddDrawer.set(true);
  }

  openEditAccount(acc: WalletAccount) {
    this.drawerMode.set('account');
    this.isEditMode.set(true);
    this.editingAccountId.set(acc.id);
    this.formAccName = acc.name || '';
    this.formAccType = acc.type;
    this.formAccIdentifier = acc.identifier || '';
    this.formAccOpening = acc.openingBalance || 0;
    this.formAccStatus = acc.status;
    this.formAccNote = acc.note || '';
    this.showAddDrawer.set(true);
  }

  openNewTxn() {
    const firstEnabled = this.dataService.walletAccounts().find(a => a.status === 'Enabled');
    this.formTxnDate = this.today();
    this.formTxnDirection = 'In';
    this.formTxnAccountId = firstEnabled ? firstEnabled.id : 0;
    this.formTxnAmount = 0;
    this.formTxnParty = '';
    this.formTxnNote = '';
    this.drawerMode.set('txn');
    this.isEditMode.set(false);
    this.editingAccountId.set(null);
    this.showAddDrawer.set(true);
  }

  openTxnFor(accountId: number) {
    this.openNewTxn();
    this.formTxnAccountId = accountId;
  }

  closeDrawer() {
    this.showAddDrawer.set(false);
  }

  saveDrawer() {
    if (this.drawerMode() === 'account') this.saveAccount();
    else this.saveTransaction();
  }

  private saveAccount() {
    const cleanName = (this.formAccName || '').trim();
    if (!cleanName) {
      this.notify.error(this.prefs.txt('অ্যাকাউন্টের নাম লিখুন।', 'Enter the account name.'), this.prefs.txt('নাম নেই', 'Missing name'));
      return;
    }
    const clash = this.dataService.walletAccounts().find(a =>
      a.name.trim().toLowerCase() === cleanName.toLowerCase() && a.id !== this.editingAccountId());
    if (clash) {
      this.notify.warning(
        this.prefs.txt(`“${cleanName}” নামে অ্যাকাউন্ট আগেই আছে।`, `An account named “${cleanName}” already exists.`),
        this.prefs.txt('নামের দ্বৈততা', 'Duplicate name')
      );
      return;
    }

    const payload: Omit<WalletAccount, 'id'> = {
      name: cleanName,
      type: this.formAccType,
      identifier: (this.formAccIdentifier || '').trim(),
      openingBalance: Math.round((Number(this.formAccOpening) || 0) * 100) / 100,
      status: this.formAccStatus,
      note: (this.formAccNote || '').trim()
    };

    if (this.isEditMode() && this.editingAccountId() !== null) {
      this.dataService.updateWalletAccount(this.editingAccountId()!, payload);
      this.notify.success(this.prefs.txt('অ্যাকাউন্ট আপডেট হয়েছে।', 'Account updated.'));
    } else {
      this.dataService.addWalletAccount(payload);
      this.notify.success(this.prefs.txt(`নতুন অ্যাকাউন্ট সংরক্ষিত হয়েছে: ${cleanName}`, `New account saved: ${cleanName}`));
    }

    this.showAddDrawer.set(false);
  }

  private saveTransaction() {
    const amount = Number(this.formTxnAmount) || 0;
    if (!this.formTxnAccountId) {
      this.notify.error(this.prefs.txt('অ্যাকাউন্ট বাছুন।', 'Select an account.'), this.prefs.txt('অ্যাকাউন্ট নেই', 'No account'));
      return;
    }
    if (!this.dataService.walletAccounts().some(a => a.id === this.formTxnAccountId)) {
      this.notify.error(
        this.prefs.txt('বাছাই করা অ্যাকাউন্টটি আর নেই — আবার বাছুন।', 'The selected account no longer exists — pick another.'),
        this.prefs.txt('অ্যাকাউন্ট পাওয়া যায়নি', 'Account not found')
      );
      return;
    }
    if (amount <= 0) {
      this.notify.error(this.prefs.txt('টাকার পরিমাণ ০ এর বেশি লিখুন।', 'Enter an amount greater than 0.'), this.prefs.txt('পরিমাণ ভুল', 'Invalid amount'));
      return;
    }
    if (!this.isoDay(this.formTxnDate)) {
      this.notify.error(this.prefs.txt('তারিখ লিখুন।', 'Enter a date.'), this.prefs.txt('তারিখ নেই', 'Missing date'));
      return;
    }

    this.dataService.addWalletTransaction({
      date: this.isoDay(this.formTxnDate),
      direction: this.formTxnDirection,
      accountId: this.formTxnAccountId,
      amount,
      party: (this.formTxnParty || '').trim(),
      note: (this.formTxnNote || '').trim()
    });
    this.notify.success(this.prefs.txt(
      `${this.formTxnDirection === 'In' ? 'জমা' : 'খরচ'} লেনদেন সংরক্ষিত হয়েছে।`,
      `${this.formTxnDirection === 'In' ? 'Received' : 'Spent'} transaction saved.`
    ));
    this.showAddDrawer.set(false);
  }

  /** A row an HRM document posted must be removed through that document. */
  canDeleteTxn(t: WalletTransaction): boolean {
    return !this.dataService.walletTxnLinkedToDocument(t);
  }

  private linkedSourceLabel(t: WalletTransaction): string {
    switch (t.source) {
      case 'Salary': return this.prefs.txt('বেতন', 'salary');
      case 'Rent': return this.prefs.txt('বাড়ি ভাড়া', 'rent');
      case 'Expense': return this.prefs.txt('খরচ', 'expense');
      case 'Battery': return this.prefs.txt('ব্যাটারি ভাউচার', 'battery voucher');
      case 'StaffAdvance': return this.prefs.txt('স্টাফ অ্যাডভান্স', 'staff advance');
      default: return this.prefs.txt('অন্য ডকুমেন্ট', 'another document');
    }
  }

  showLinkedNotice(t: WalletTransaction) {
    this.notify.info(
      this.prefs.txt(
        `এই লেনদেনটি ${this.linkedSourceLabel(t)} ডকুমেন্ট থেকে তৈরি — সেখান থেকেই পরিবর্তন বা বাতিল করুন।`,
        `This row comes from the ${this.linkedSourceLabel(t)} document — change or cancel it there.`
      ),
      this.prefs.txt('সংযুক্ত লেনদেন', 'Linked transaction')
    );
  }

  async deleteTxn(t: WalletTransaction) {
    if (!this.canDeleteTxn(t)) {
      this.showLinkedNotice(t);
      return;
    }
    const confirmed = await this.notify.confirm(
      this.prefs.txt(
        `${t.txnNo} লেনদেনটি মুছে গেলে ${this.accountName(t.accountId)} এর ব্যালান্স পরিবর্তন হবে।`,
        `Deleting ${t.txnNo} will change the balance of ${this.accountName(t.accountId)}.`
      ),
      {
        title: this.prefs.txt('লেনদেন মুছে ফেলবেন?', 'Delete this transaction?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছুন', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (confirmed) {
      this.dataService.deleteWalletTransaction(t.id);
      this.notify.success(this.prefs.txt('লেনদেন মুছে ফেলা হয়েছে।', 'Transaction deleted.'));
    }
  }

  async deleteAccount(acc: WalletAccount) {
    const linked = this.dataService.walletAccountLinkedTxns(acc.id);
    if (linked.length) {
      this.notify.warning(
        this.prefs.txt(
          `${acc.name} অ্যাকাউন্টে ${linked.length}টি ডকুমেন্ট-লেনদেন (বেতন/ভাড়া/খরচ/স্টাফ অ্যাডভান্স/ব্যাটারি) আছে। আগে ওই ডকুমেন্টগুলোতে অ্যাকাউন্ট বদলান বা ডকুমেন্ট বাতিল করুন, তারপর অ্যাকাউন্টটি মুছুন।`,
          `${acc.name} is used by ${linked.length} document rows (salary/rent/expense/advance/battery). Change those documents first, then delete the account.`
        ),
        this.prefs.txt('অ্যাকাউন্টটি ব্যবহারে আছে', 'Account is in use')
      );
      return;
    }
    const confirmed = await this.notify.confirm(
      this.prefs.txt(
        `${acc.name} অ্যাকাউন্টটি ও তার সব লেনদেন স্থায়ীভাবে মুছে যাবে।`,
        `The account ${acc.name} and all its transactions will be permanently deleted.`
      ),
      {
        title: this.prefs.txt('অ্যাকাউন্ট মুছে ফেলবেন?', 'Delete this account?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছুন', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (confirmed) {
      if (this.accountFilterId() === acc.id) this.accountFilterId.set(null);
      this.dataService.deleteWalletAccount(acc.id);
      this.notify.success(this.prefs.txt('অ্যাকাউন্ট ও লেনদেন মুছে ফেলা হয়েছে।', 'Account and transactions deleted.'));
    }
  }

  exportExcel() {
    this.dataService.exportToExcel(this.filteredTxns(), 'Wallet_Transactions');
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
