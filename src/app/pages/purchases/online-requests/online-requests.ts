import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, OnlineRequest } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { SessionService } from '../../../services/session';
import { PreferencesService } from '../../../services/preferences';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { localDateIso } from '../../../utils/local-date';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';

const CHANNELS: OnlineRequest['channel'][] = ['Website', 'Facebook', 'WhatsApp', 'Phone', 'Walk-in'];
const STATUSES: OnlineRequest['status'][] = ['New', 'Contacted', 'Confirmed', 'Cancelled'];

@Component({
  selector: 'app-online-requests',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, DmyDateDirective],
  styles: `
    .pt-sticky { position: sticky; top: 0; z-index: 5; background-color: var(--sm-brand, #0d9488); }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">

      <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">travel_explore</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                <span>{{ prefs.txt('ক্রয়', 'Purchases') }}</span>
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                <span>{{ prefs.txt('অনলাইন রিকোয়েস্ট', 'Online requests') }}</span>
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('অনলাইন রিকোয়েস্ট', 'Online Requests') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('অনলাইন সূত্রে আসা ক্রয় ও বিক্রয়ের লিড ট্র্যাক করুন।', 'Track purchase and sales leads coming from online channels.') }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button (click)="exportExcel()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon class="text-sm text-emerald-200">description</mat-icon> {{ prefs.txt('এক্সেল', 'Excel') }}
            </button>
            <button (click)="printPage()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon class="text-sm">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
            <button (click)="openAdd()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon class="text-sm">add</mat-icon> {{ prefs.txt('নতুন রিকোয়েস্ট', 'New request') }}
            </button>
          </div>
        </div>
      </div>

      <div class="no-print bg-white p-2 rounded-xl shadow-xs border border-slate-200 flex items-center gap-2 overflow-x-auto">
        @for (t of tabs(); track t.value) {
          @if (activeTab() === t.value) {
            <button (click)="setTab(t.value)" class="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-teal-700 text-white shadow-2xs cursor-pointer">
              <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
              <span>{{ t.label }}</span>
              <span class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-white/25 text-[10px] font-black">{{ tabCount(t.value) }}</span>
            </button>
          } @else {
            <button (click)="setTab(t.value)" class="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
              <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
              <span>{{ t.label }}</span>
              <span class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-black text-slate-600 dark:text-slate-300">{{ tabCount(t.value) }}</span>
            </button>
          }
        }
      </div>

      <div class="no-print bg-white p-3 rounded-xl shadow-xs border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div class="relative w-full sm:max-w-sm">
          <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
          <input
            type="text"
            [placeholder]="prefs.txt('রিকোয়েস্ট নম্বর, গ্রাহক বা ফোন দিয়ে খুঁজুন...', 'Search by request no, customer or phone...')"
            [value]="searchQuery()"
            (input)="onSearch($event)"
            class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none"
          />
        </div>
        <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">{{ activeTabLabel() }} · {{ filtered().length }} {{ prefs.txt('টি', 'rows') }}</span>
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">{{ prefs.txt('সম্ভাব্য বিক্রয়', 'Potential sales') }} <b class="font-mono text-slate-800 dark:text-slate-100">{{ totals().value | number:'1.2-2' }}</b></span>
          <span class="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200">{{ prefs.txt('নতুন', 'New') }} <b class="font-mono text-amber-600 dark:text-amber-400">{{ totals().newCount }}</b></span>
          <span class="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200">{{ prefs.txt('কনফার্ম', 'Confirmed') }} <b class="font-mono text-emerald-600 dark:text-emerald-400">{{ totals().confirmed }}</b></span>
        </div>
      </div>

      <div class="list-print-shell hidden lg:block bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div id="list-printable-area" class="overflow-auto max-h-[72vh]">
          <table class="w-full min-w-[1180px] text-xs text-left border-collapse text-slate-700 dark:text-slate-200">
            <thead>
              <tr class="text-white font-bold uppercase text-[11px] tracking-wider">
                <th class="p-2.5 text-center w-10 pt-sticky">SL</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('রিকোয়েস্ট নম্বর', 'REQUEST NO') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('তারিখ', 'DATE') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('গ্রাহক', 'CUSTOMER') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('ফোন', 'PHONE') }}</th>
                <th class="p-2.5 text-center pt-sticky">{{ prefs.txt('চ্যানেল', 'CHANNEL') }}</th>
                <th class="p-2.5 min-w-[150px] pt-sticky">{{ prefs.txt('পণ্য', 'PRODUCT') }}</th>
                <th class="p-2.5 text-center pt-sticky">{{ prefs.txt('পরিমাণ', 'QTY') }}</th>
                <th class="p-2.5 text-right pt-sticky">{{ prefs.txt('প্রত্যাশিত', 'EXPECTED') }}</th>
                <th class="p-2.5 text-center pt-sticky">{{ prefs.txt('অবস্থা', 'STATUS') }}</th>
                <th class="p-2.5 text-center w-24 pt-sticky">{{ prefs.txt('অ্যাকশন', 'ACTION') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (r of pager.paged(); track r.id; let idx = $index) {
                <tr class="hover:bg-[#e2e8f0] transition-colors">
                  <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-mono font-bold text-teal-800 dark:text-teal-300">{{ r.requestNo }}</td>
                  <td class="p-2.5 whitespace-nowrap">{{ displayDate(r.date) }}</td>
                  <td class="p-2.5 font-bold text-slate-800">{{ r.customerName }}</td>
                  <td class="p-2.5 font-mono text-[11px]">{{ r.phone || '-' }}</td>
                  <td class="p-2.5 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold" [class]="channelBadge(r.channel)">{{ channelLabel(r.channel) }}</span>
                  </td>
                  <td class="p-2.5"><div class="max-w-[170px] truncate" [title]="r.product">{{ r.product || '-' }}</div></td>
                  <td class="p-2.5 text-center font-mono">{{ r.quantity }}</td>
                  <td class="p-2.5 text-right font-mono font-bold">{{ r.expectedPrice | number:'1.2-2' }}</td>
                  <td class="p-2.5 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold" [class]="statusBadge(r.status)">{{ statusLabel(r.status) }}</span>
                  </td>
                  <td class="p-2.5 text-center">
                    <div class="flex items-center justify-center gap-1">
                      @if (r.status !== 'Confirmed' && r.status !== 'Cancelled') {
                        <button (click)="confirmRequest(r)" class="p-1 text-emerald-600 hover:bg-emerald-100 rounded cursor-pointer" [title]="prefs.txt('কনফার্ম করুন', 'Confirm')">
                          <mat-icon class="text-sm">check_circle</mat-icon>
                        </button>
                      }
                      <button (click)="callCustomer(r)" class="p-1 text-sky-600 hover:bg-sky-100 rounded cursor-pointer" [title]="prefs.txt('ফোন করুন', 'Call')">
                        <mat-icon class="text-sm">call</mat-icon>
                      </button>
                      <button (click)="openEdit(r)" class="p-1 text-amber-600 hover:bg-amber-100 rounded cursor-pointer" [title]="prefs.txt('সম্পাদনা', 'Edit')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      @if (session.has('deleteRecords')) {
                        <button (click)="deleteRecord(r.id)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer" [title]="prefs.txt('মুছুন', 'Delete')">
                          <mat-icon class="text-sm">delete</mat-icon>
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="11" class="p-10 text-center">
                    <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
                      <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                        <mat-icon class="text-2xl text-slate-300">inbox</mat-icon>
                      </span>
                      <p class="text-xs font-semibold">{{ prefs.txt('এই ক্যাটাগরিতে কোনো অনলাইন রিকোয়েস্ট নেই।', 'No online request in this category.') }}</p>
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

      <div class="no-print lg:hidden bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden divide-y divide-slate-100">
        @for (r of pager.paged(); track r.id; let idx = $index) {
          <div class="p-3 space-y-2.5">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-bold text-teal-800 dark:text-teal-300 text-sm truncate">{{ r.customerName }}</p>
                <p class="text-[10px] text-slate-500 font-mono">{{ r.requestNo }} • SL {{ pager.offset() + idx + 1 }}</p>
              </div>
              <span class="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="statusBadge(r.status)">{{ statusLabel(r.status) }}</span>
            </div>

            <p class="text-[11px] text-slate-600 dark:text-slate-300 truncate" [title]="r.product">{{ r.product || prefs.txt('পণ্য উল্লেখ নেই', 'No product specified') }} @if (r.quantity) { × {{ r.quantity }} }</p>

            <div class="grid grid-cols-3 gap-2 text-center bg-slate-50 rounded-lg p-2 dark:bg-slate-800/60">
              <div>
                <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('সংখ্যা', 'QTY') }}</p>
                <p class="font-mono font-bold text-slate-800 dark:text-slate-100 text-[11px]">{{ r.quantity }}</p>
              </div>
              <div>
                <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('প্রত্যাশিত', 'Expected') }}</p>
                <p class="font-mono font-bold text-slate-800 dark:text-slate-100 text-[11px]">{{ r.expectedPrice | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('চ্যানেল', 'Channel') }}</p>
                <p class="font-mono font-bold text-slate-800 dark:text-slate-100 text-[11px]">{{ channelLabel(r.channel) }}</p>
              </div>
            </div>

            <div class="flex items-center justify-between gap-2 text-[10px] text-slate-500 flex-wrap">
              <span class="inline-flex items-center gap-1"><mat-icon class="text-xs">call</mat-icon>{{ r.phone || '-' }}</span>
              <span class="inline-flex items-center gap-1"><mat-icon class="text-xs">event</mat-icon>{{ displayDate(r.date) }}</span>
            </div>

            <div class="flex items-center gap-1">
              @if (r.status !== 'Confirmed' && r.status !== 'Cancelled') {
                <button (click)="confirmRequest(r)" class="flex-1 inline-flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                  <mat-icon class="text-sm">check_circle</mat-icon> {{ prefs.txt('কনফার্ম', 'Confirm') }}
                </button>
              }
              <button (click)="openEdit(r)" class="inline-flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">edit</mat-icon>
              </button>
              @if (session.has('deleteRecords')) {
                <button (click)="deleteRecord(r.id)" class="inline-flex items-center justify-center bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                  <mat-icon class="text-sm">delete</mat-icon>
                </button>
              }
            </div>
          </div>
        } @empty {
          <div class="p-8 text-center">
            <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
              <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                <mat-icon class="text-2xl text-slate-300">inbox</mat-icon>
              </span>
              <p class="text-xs font-semibold">{{ prefs.txt('এই ক্যাটাগরিতে কোনো অনলাইন রিকোয়েস্ট নেই।', 'No online request in this category.') }}</p>
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

    @if (showDrawer()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end">
        <div class="bg-white w-full max-w-xl sm:max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden text-slate-800">
          <div class="p-4 flex items-center justify-between border-b border-slate-200">
            <h2 class="text-base font-bold text-slate-900 dark:text-white">{{ isEditMode() ? prefs.txt('রিকোয়েস্ট সম্পাদনা', 'Edit request') : prefs.txt('নতুন অনলাইন রিকোয়েস্ট', 'New online request') }}</h2>
            <button (click)="closeDrawer()" class="text-slate-400 hover:text-slate-700 cursor-pointer p-1 rounded-full hover:bg-slate-100">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-5 space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300"><span class="text-rose-500">*</span> {{ prefs.txt('গ্রাহকের নাম', 'Customer name') }}</label>
                <input [(ngModel)]="formCustomerName" list="request-customers" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
                <datalist id="request-customers">
                  @for (name of customerNames(); track name) {
                    <option [value]="name"></option>
                  }
                </datalist>
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{{ prefs.txt('মোবাইল', 'Mobile') }}</label>
                <input [(ngModel)]="formPhone" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-mono focus:ring-2 focus:ring-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" placeholder="01XXXXXXXXX" />
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{{ prefs.txt('তারিখ', 'Date') }}</label>
                <input type="date" appDmyDate [(ngModel)]="formDate" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{{ prefs.txt('চ্যানেল', 'Channel') }}</label>
                <select [(ngModel)]="formChannel" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs bg-white focus:ring-2 focus:ring-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                  @for (c of channels; track c) {
                    <option [value]="c">{{ channelLabel(c) }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{{ prefs.txt('পণ্য', 'Product') }}</label>
                <input [(ngModel)]="formProduct" list="request-products" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
                <datalist id="request-products">
                  @for (name of productNames(); track name) {
                    <option [value]="name"></option>
                  }
                </datalist>
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{{ prefs.txt('অবস্থা', 'Status') }}</label>
                <select [(ngModel)]="formStatus" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs bg-white focus:ring-2 focus:ring-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                  @for (s of statuses; track s) {
                    <option [value]="s">{{ statusLabel(s) }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{{ prefs.txt('পরিমাণ', 'Quantity') }}</label>
                <input type="number" [(ngModel)]="formQuantity" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-mono focus:ring-2 focus:ring-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{{ prefs.txt('প্রত্যাশিত বাজেট', 'Expected budget') }}</label>
                <input type="number" [(ngModel)]="formExpectedPrice" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-mono focus:ring-2 focus:ring-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{{ prefs.txt('ঠিকানা', 'Address') }}</label>
              <input [(ngModel)]="formAddress" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
            </div>

            <div>
              <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{{ prefs.txt('নোট', 'Note') }}</label>
              <textarea [(ngModel)]="formNote" rows="3" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"></textarea>
            </div>
          </div>

          <div class="border-t border-slate-200 p-4 flex items-center justify-end gap-2 bg-white dark:border-slate-800 dark:bg-slate-900">
            <button (click)="closeDrawer()" class="border border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold px-4 py-2 rounded-lg cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
            <button (click)="save()" class="bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold px-5 py-2 rounded-lg flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ করুন', 'Save') }}
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class OnlineRequests {
  readonly dataService = inject(DataService);
  private readonly notify = inject(NotificationService);
  readonly session = inject(SessionService);
  readonly prefs = inject(PreferencesService);

  readonly tabs = computed(() => [
    { value: 'All', label: this.prefs.txt('সব', 'All'), icon: 'inbox' },
    { value: 'New', label: this.prefs.txt('নতুন', 'New'), icon: 'fiber_new' },
    { value: 'Contacted', label: this.prefs.txt('যোগাযোগ', 'Contacted'), icon: 'call' },
    { value: 'Confirmed', label: this.prefs.txt('কনফার্ম', 'Confirmed'), icon: 'check_circle' },
    { value: 'Cancelled', label: this.prefs.txt('বাতিল', 'Cancelled'), icon: 'block' }
  ]);
  readonly channels = CHANNELS;
  readonly statuses = STATUSES;

  activeTab = signal('All');
  searchQuery = signal('');
  showDrawer = signal(false);
  isEditMode = signal(false);
  editingId = signal<number | null>(null);

  formCustomerName = '';
  formPhone = '';
  formAddress = '';
  formDate = this.today();
  formChannel: OnlineRequest['channel'] = 'Facebook';
  formProduct = '';
  formQuantity: number | null = 1;
  formExpectedPrice: number | null = null;
  formStatus: OnlineRequest['status'] = 'New';
  formNote = '';

  customerNames = computed(() => this.dataService.parties().map(p => p.name));
  productNames = computed(() => this.dataService.products().flatMap(p => {
    const variants = p.variants || [];
    return variants.length ? variants.map(v => `${p.name} - ${v.variantValue}`) : [p.name];
  }));

  filtered = computed<OnlineRequest[]>(() => {
    const tab = this.activeTab();
    const q = this.searchQuery().toLowerCase().trim();
    let list = this.dataService.onlineRequests();
    if (tab !== 'All') list = list.filter(r => r.status === tab);
    if (q) {
      list = list.filter(r =>
        r.requestNo.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        r.product.toLowerCase().includes(q) ||
        r.date.includes(q));
    }
    return list;
  });

  readonly pager = createPager<OnlineRequest>(() => this.filtered());

  totals = computed(() => {
    const list = this.filtered();
    return {
      value: this.money(list.reduce((s, r) => s + (Number(r.expectedPrice) || 0), 0)),
      newCount: list.filter(r => r.status === 'New').length,
      confirmed: list.filter(r => r.status === 'Confirmed').length
    };
  });

  tabCount(value: string): number {
    if (value === 'All') return this.dataService.onlineRequests().length;
    return this.dataService.onlineRequests().filter(r => r.status === value).length;
  }

  activeTabLabel(): string {
    return this.tabs().find(t => t.value === this.activeTab())?.label ?? this.prefs.txt('সব', 'All');
  }

  setTab(value: string) {
    this.activeTab.set(value);
    this.pager.setPage(1);
  }

  onSearch(e: Event) {
    this.searchQuery.set((e.target as HTMLInputElement).value);
    this.pager.setPage(1);
  }

  statusLabel(status: OnlineRequest['status']): string {
    const map: Record<OnlineRequest['status'], string> = {
      New: this.prefs.txt('নতুন', 'New'),
      Contacted: this.prefs.txt('যোগাযোগ হয়েছে', 'Contacted'),
      Confirmed: this.prefs.txt('কনফার্ম', 'Confirmed'),
      Cancelled: this.prefs.txt('বাতিল', 'Cancelled')
    };
    return map[status] || status;
  }

  statusBadge(status: OnlineRequest['status']): string {
    const map: Record<OnlineRequest['status'], string> = {
      New: 'bg-amber-100 text-amber-800',
      Contacted: 'bg-sky-100 text-sky-800',
      Confirmed: 'bg-emerald-100 text-emerald-800',
      Cancelled: 'bg-rose-100 text-rose-800'
    };
    return map[status];
  }

  channelLabel(channel: OnlineRequest['channel']): string {
    const map: Record<OnlineRequest['channel'], string> = {
      Website: this.prefs.txt('ওয়েবসাইট', 'Website'),
      Facebook: this.prefs.txt('ফেসবুক', 'Facebook'),
      WhatsApp: this.prefs.txt('হোয়াটসঅ্যাপ', 'WhatsApp'),
      Phone: this.prefs.txt('ফোন', 'Phone'),
      'Walk-in': this.prefs.txt('দোকানে', 'Walk-in')
    };
    return map[channel] || channel;
  }

  channelBadge(channel: OnlineRequest['channel']): string {
    const map: Record<OnlineRequest['channel'], string> = {
      Website: 'bg-sky-100 text-sky-800',
      Facebook: 'bg-indigo-100 text-indigo-800',
      WhatsApp: 'bg-emerald-100 text-emerald-800',
      Phone: 'bg-amber-100 text-amber-800',
      'Walk-in': 'bg-slate-200 text-slate-700'
    };
    return map[channel];
  }

  today(): string {
    return localDateIso();
  }

  money(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  displayDate(value: string): string {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || '').trim());
    return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : (value || '-');
  }

  openAdd() {
    this.isEditMode.set(false);
    this.editingId.set(null);
    this.formCustomerName = '';
    this.formPhone = '';
    this.formAddress = '';
    this.formDate = this.today();
    this.formChannel = 'Facebook';
    this.formProduct = '';
    this.formQuantity = 1;
    this.formExpectedPrice = null;
    this.formStatus = 'New';
    this.formNote = '';
    this.showDrawer.set(true);
  }

  openEdit(record: OnlineRequest) {
    this.isEditMode.set(true);
    this.editingId.set(record.id);
    this.formCustomerName = record.customerName;
    this.formPhone = record.phone;
    this.formAddress = record.address;
    this.formDate = record.date;
    this.formChannel = record.channel;
    this.formProduct = record.product;
    this.formQuantity = record.quantity;
    this.formExpectedPrice = record.expectedPrice;
    this.formStatus = record.status;
    this.formNote = record.note;
    this.showDrawer.set(true);
  }

  closeDrawer() {
    this.showDrawer.set(false);
  }

  save() {
    const customerName = this.formCustomerName.trim();
    if (!customerName) {
      this.notify.error(this.prefs.txt('গ্রাহকের নাম লিখুন।', 'Enter the customer name.'), this.prefs.txt('নাম নেই', 'No name'));
      return;
    }
    if (!this.formPhone.trim()) {
      this.notify.warning(this.prefs.txt('মোবাইল নম্বর না দিলে যোগাযোগ করা যাবে না।', 'Without a mobile number the customer cannot be contacted.'), this.prefs.txt('ফোন নেই', 'No phone'));
    }

    const payload = {
      date: this.formDate || this.today(),
      customerName,
      phone: this.formPhone.trim(),
      address: this.formAddress.trim(),
      channel: this.formChannel,
      product: this.formProduct.trim(),
      quantity: Number(this.formQuantity) || 0,
      expectedPrice: this.money(this.formExpectedPrice ?? 0),
      status: this.formStatus,
      note: this.formNote.trim()
    };

    if (this.isEditMode() && this.editingId()) {
      this.dataService.updateOnlineRequest(this.editingId() as number, payload);
      this.notify.success(this.prefs.txt('রিকোয়েস্ট আপডেট হয়েছে।', 'Request updated.'));
    } else {
      const created = this.dataService.addOnlineRequest(payload);
      this.notify.success(this.prefs.txt(`নতুন রিকোয়েস্ট সংরক্ষিত হয়েছে: ${created.requestNo}`, `New request saved: ${created.requestNo}`));
    }
    this.showDrawer.set(false);
  }

  confirmRequest(record: OnlineRequest) {
    this.dataService.updateOnlineRequest(record.id, { status: 'Confirmed' });
    this.notify.success(this.prefs.txt(`${record.customerName} — রিকোয়েস্ট কনফার্ম হয়েছে।`, `${record.customerName} — request confirmed.`));
  }

  callCustomer(record: OnlineRequest) {
    const phone = (record.phone || '').replace(/\s+/g, '');
    if (!phone) {
      this.notify.info(this.prefs.txt('এই রিকোয়েস্টে ফোন নম্বর নেই।', 'This request has no phone number.'), this.prefs.txt('নম্বর নেই', 'No number'));
      return;
    }
    this.dataService.updateOnlineRequest(record.id, { status: record.status === 'New' ? 'Contacted' : record.status });
    window.location.href = `tel:${phone}`;
    this.notify.success(this.prefs.txt(`${phone} — যোগাযোগ হিসেবে চিহ্নিত করা হয়েছে।`, `${phone} — marked as contacted.`));
  }

  async deleteRecord(id: number) {
    const confirmed = await this.notify.confirm(
      this.prefs.txt('এই রিকোয়েস্টটি স্থায়ীভাবে মুছে যাবে।', 'This request will be permanently deleted.'),
      {
        title: this.prefs.txt('মুছে ফেলবেন?', 'Delete it?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছুন', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    this.dataService.deleteOnlineRequest(id);
    this.notify.success(this.prefs.txt('রিকোয়েস্ট মুছে ফেলা হয়েছে।', 'Request deleted.'));
  }

  exportExcel() {
    this.dataService.exportToExcel(this.filtered(), 'Online_Requests');
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
