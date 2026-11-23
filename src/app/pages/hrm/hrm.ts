import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import * as htmlToImage from 'html-to-image';
import { DataService, HrmStaff, LeaveType } from '../../services/data';
import { MediaService } from '../../services/media';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { SessionService } from '../../services/session';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { GeoSelect } from '../../components/geo-select/geo-select';
import { localDateIso } from '../../utils/local-date';
import { DmyDateDirective } from '../../directives/dmy-date.directive';
import { BD_DIVISIONS, geoDistricts, geoUpazilas } from '../../utils/bd-geo';
import { qrDataUrl } from '../../utils/qr-code';
import { HrmNav } from './hrm-nav';

@Component({
  selector: 'app-hrm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, DmyDateDirective, GeoSelect, HrmNav],
  styles: `
    /* Sticky column-title band so rows scroll under the teal header. */
    .pt-sticky {
      position: sticky;
      top: 0;
      z-index: 5;
      background-color: var(--sm-brand, #0d9488);
    }
    /* ID card prints at CR80 size instead of filling the page. */
    @media print {
      #printable-area.id-card-sheet {
        width: 85.6mm !important;
        height: 54mm !important;
        border-radius: 0 !important;
        box-shadow: none !important;
      }
      #printable-area.id-card-sheet * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
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
              <mat-icon class="text-lg">groups</mat-icon>
            </span>
            <div>
              <h1 class="text-xl font-bold">{{ prefs.txt('কর্মচারী ব্যবস্থাপনা', 'Employee management') }}</h1>
              <p class="text-[11px] text-teal-50/85">Dashboard / HRM · {{ prefs.txt('কর্মচারীর তথ্য', 'Staff records') }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button (click)="exportExcel()" class="flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon style="font-size:15px;width:15px;height:15px;">description</mat-icon> {{ prefs.txt('এক্সেল', 'Excel') }}
            </button>
            <button (click)="printPage()" class="flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon style="font-size:15px;width:15px;height:15px;">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
            <button (click)="openAddModal()" class="flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon style="font-size:15px;width:15px;height:15px;">person_add</mat-icon> {{ prefs.txt('নতুন কর্মচারী', 'New employee') }}
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

      <!-- Search Bar & Summary -->
      <div class="no-print bg-white p-3 rounded-xl shadow-xs border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div class="relative w-full sm:max-w-sm">
          <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
          <input
            type="text"
            [placeholder]="prefs.txt('নাম, কোড, পদবী বা ফোন দিয়ে খুঁজুন...', 'Search by name, code, designation or phone...')"
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ activeTabLabel() }} · {{ filteredStaff().length }} {{ prefs.txt('জন', 'people') }}
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ prefs.txt('মোট কর্মচারী', 'Total staff') }} <b class="font-mono text-slate-800">{{ totals().headCount }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200">
            {{ prefs.txt('সক্রিয়', 'Active') }} <b class="font-mono text-emerald-600 dark:text-emerald-400">{{ totals().active }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200">
            {{ prefs.txt('মাসিক বেতন', 'Monthly salary') }} <b class="font-mono text-rose-600 dark:text-rose-400">{{ totals().salary | number:'1.2-2' }}</b>
          </span>
        </div>
      </div>

      <!-- Staff Table (desktop / print) -->
      <div class="list-print-shell hidden lg:block bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div id="list-printable-area" class="overflow-auto max-h-[72vh]">
          <table class="w-full min-w-[1080px] text-xs text-left border-collapse text-slate-700 dark:text-slate-200">
            <thead>
              <tr class="text-white font-bold uppercase text-[11px] tracking-wider">
                <th class="p-2.5 text-center w-10 pt-sticky">SL</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('কোড', 'CODE') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('নাম', 'NAME') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('পদবী', 'DESIGNATION') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('ফোন', 'PHONE') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('ইমেইল', 'EMAIL') }}</th>
                <th class="p-2.5 pt-sticky">{{ prefs.txt('যোগদান', 'JOIN DATE') }}</th>
                <th class="p-2.5 text-right pt-sticky">{{ prefs.txt('বেতন', 'SALARY') }}</th>
                <th class="p-2.5 text-center pt-sticky">{{ prefs.txt('স্ট্যাটাস', 'STATUS') }}</th>
                <th class="p-2.5 text-center w-28 pt-sticky">{{ prefs.txt('অ্যাকশন', 'ACTION') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (s of pager.paged(); track s.id; let idx = $index) {
                <tr (click)="openDetail(s)" class="hover:bg-[#e2e8f0] dark:hover:bg-slate-800 transition-colors cursor-pointer">
                  <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-mono font-bold text-slate-800 dark:text-slate-200">{{ s.code }}</td>
                  <td class="p-2.5">
                    <div class="flex items-center gap-1.5 max-w-[220px]">
                      @if (s.photo) {
                        <img [src]="s.photo" alt="" class="w-7 h-7 rounded-full object-cover border border-slate-200 shrink-0" loading="lazy" decoding="async">
                      } @else {
                        <span class="w-7 h-7 rounded-full bg-teal-700/15 text-teal-700 dark:text-teal-300 flex items-center justify-center text-[10px] font-black shrink-0">{{ initials(s.name) }}</span>
                      }
                      <span class="font-bold text-teal-800 dark:text-teal-300 truncate">{{ s.name }}</span>
                    </div>
                  </td>
                  <td class="p-2.5 font-medium text-slate-700 dark:text-slate-200">{{ s.designation || '-' }}</td>
                  <td class="p-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">{{ s.phone || '-' }}</td>
                  <td class="p-2.5 text-slate-500">
                    <div class="max-w-[180px] truncate" [title]="s.email">{{ s.email || '-' }}</div>
                  </td>
                  <td class="p-2.5 text-slate-500 whitespace-nowrap">{{ displayDate(s.joinDate) }}</td>
                  <td class="p-2.5 text-right font-mono font-bold text-slate-800 dark:text-slate-200">{{ s.monthlySalary | number:'1.2-2' }} TK</td>
                  <td class="p-2.5 text-center">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap" [class]="statusBadge(s.status)">{{ statusLabel(s.status) }}</span>
                  </td>
                  <td class="p-2.5 text-center">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="$event.stopPropagation(); openIdCard(s)" class="p-1 text-teal-700 hover:bg-teal-100 rounded cursor-pointer" [title]="prefs.txt('ID কার্ড তৈরি', 'Create ID card')">
                        <mat-icon class="text-sm">badge</mat-icon>
                      </button>
                      <button (click)="$event.stopPropagation(); openDetail(s)" class="p-1 text-sky-700 hover:bg-sky-100 rounded cursor-pointer" [title]="prefs.txt('বিস্তারিত তথ্য', 'Details')">
                        <mat-icon class="text-sm">visibility</mat-icon>
                      </button>
                      <button (click)="$event.stopPropagation(); openEditModal(s)" class="p-1 text-amber-600 hover:bg-amber-100 rounded cursor-pointer" [title]="prefs.txt('কর্মচারী সম্পাদনা', 'Edit employee')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      @if (session.has('deleteRecords')) {
                        <button (click)="$event.stopPropagation(); deleteStaff(s)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer" [title]="prefs.txt('কর্মচারী মুছুন', 'Delete employee')">
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
                        <mat-icon class="text-2xl text-slate-300">badge</mat-icon>
                      </span>
                      <p class="text-xs font-semibold">{{ prefs.txt('এই স্ট্যাটাসে কোনো কর্মচারী পাওয়া যায়নি।', 'No employees found with this status.') }}</p>
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

      <!-- Staff Cards (mobile / tablet) -->
      <div class="no-print lg:hidden bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden divide-y divide-slate-100">
        @for (s of pager.paged(); track s.id; let idx = $index) {
          <div class="p-3 space-y-2.5">
            <div class="flex items-start justify-between gap-2">
              <button (click)="openDetail(s)" class="group flex items-center gap-2 min-w-0 text-left cursor-pointer">
                @if (s.photo) {
                  <img [src]="s.photo" alt="" class="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0" loading="lazy" decoding="async">
                } @else {
                  <span class="w-10 h-10 rounded-full bg-teal-700/15 text-teal-700 dark:text-teal-300 flex items-center justify-center text-xs font-black shrink-0">{{ initials(s.name) }}</span>
                }
                <span class="min-w-0">
                  <span class="block font-bold text-teal-800 dark:text-teal-300 text-sm truncate group-hover:underline">{{ s.name }}</span>
                  <span class="block text-[10px] text-slate-500 truncate">{{ s.code }} • SL {{ pager.offset() + idx + 1 }}</span>
                </span>
              </button>
              <span class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="statusBadge(s.status)">{{ statusLabel(s.status) }}</span>
            </div>

            <div class="grid grid-cols-3 gap-2 text-center bg-slate-50 rounded-lg p-2">
              <div>
                <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('পদবী', 'Designation') }}</p>
                <p class="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">{{ s.designation || '-' }}</p>
              </div>
              <div>
                <p class="text-[9px] uppercase font-bold text-emerald-500">{{ prefs.txt('বেতন', 'Salary') }}</p>
                <p class="font-mono font-bold text-[11px] text-emerald-600 dark:text-emerald-400">{{ s.monthlySalary | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('যোগদান', 'Joined') }}</p>
                <p class="font-mono text-[11px] text-slate-600">{{ displayDate(s.joinDate) }}</p>
              </div>
            </div>

            <div class="flex items-center justify-between gap-2 text-[10px] text-slate-500 flex-wrap">
              <span class="inline-flex items-center gap-1">
                <mat-icon class="text-xs">call</mat-icon>{{ s.phone || '-' }}
              </span>
              <span class="inline-flex items-center gap-1 min-w-0">
                <mat-icon class="text-xs">mail</mat-icon><span class="truncate max-w-[150px]">{{ s.email || '-' }}</span>
              </span>
            </div>

            <div class="flex items-center gap-1">
              <button (click)="openIdCard(s)" class="inline-flex items-center justify-center gap-1 bg-white border border-teal-300 text-teal-700 hover:bg-teal-50 text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">badge</mat-icon> ID
              </button>
              <button (click)="openDetail(s)" class="inline-flex items-center justify-center gap-1 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">visibility</mat-icon> {{ prefs.txt('বিস্তারিত', 'Details') }}
              </button>
              <button (click)="openEditModal(s)" class="flex-1 inline-flex items-center justify-center gap-1 bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">edit</mat-icon> {{ prefs.txt('সম্পাদনা', 'Edit') }}
              </button>
              @if (session.has('deleteRecords')) {
                <button (click)="deleteStaff(s)" class="inline-flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                  <mat-icon class="text-sm">delete</mat-icon>
                </button>
              }
            </div>
          </div>
        } @empty {
          <div class="p-8 text-center">
            <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
              <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                <mat-icon class="text-2xl text-slate-300">badge</mat-icon>
              </span>
              <p class="text-xs font-semibold">{{ prefs.txt('এই স্ট্যাটাসে কোনো কর্মচারী পাওয়া যায়নি।', 'No employees found with this status.') }}</p>
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

    <!-- One-click ID card: the QR carries the staff code the attendance scanner reads. -->
    @if (idCardStaff(); as s) {
      <div class="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-50 flex items-center justify-center p-3" (click)="closeIdCard()">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden text-slate-800" (click)="$event.stopPropagation()">
          <div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <p class="font-bold text-sm flex items-center gap-1.5"><mat-icon class="text-teal-700 text-base">badge</mat-icon> {{ prefs.txt('কর্মচারী ID কার্ড', 'Employee ID card') }}</p>
              <p class="text-[10px] text-slate-500">{{ prefs.txt('প্রিন্ট করুন অথবা PNG ডাউনলোড করুন', 'Print it or download as PNG') }}</p>
            </div>
            <button (click)="closeIdCard()" class="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full cursor-pointer">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>

          <div class="p-4 bg-slate-50 flex justify-center">
            <div #idCardEl id="printable-area"
              class="id-card-sheet relative w-[86mm] h-[54mm] bg-white rounded-xl overflow-hidden shadow-lg border border-slate-200">
              <div class="h-[14mm] bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 px-3 flex items-center justify-between text-white">
                <div class="min-w-0">
                  <p class="text-[7px] tracking-[0.16em] font-bold text-teal-100 uppercase">{{ prefs.txt('কর্মচারীর আইডি কার্ড', 'Employee ID Card') }}</p>
                  <p class="text-[10px] font-black truncate">{{ shopName() }}</p>
                </div>
                <mat-icon class="text-white/90 !text-[17px] !w-[17px] !h-[17px]">storefront</mat-icon>
              </div>

              <div class="flex gap-2.5 px-3 pt-2">
                <div class="shrink-0">
                  @if (s.photo) {
                    <img [src]="s.photo" alt="" class="w-[18mm] h-[22mm] object-cover rounded-lg ring-1 ring-slate-200" loading="lazy" decoding="async">
                  } @else {
                    <span class="w-[18mm] h-[22mm] rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center text-2xl font-black ring-1 ring-teal-100">{{ initials(s.name) }}</span>
                  }
                </div>
                <div class="min-w-0 flex-1 pt-0.5">
                  <p class="text-[12px] font-black text-slate-900 leading-tight truncate">{{ s.name }}</p>
                  <p class="text-[8px] font-semibold text-teal-700 truncate">{{ s.designation || prefs.txt('কর্মচারী', 'Employee') }}</p>
                  <div class="mt-1 text-[7.5px] text-slate-600 leading-[1.45]">
                    <p class="font-mono font-bold text-[8px] text-slate-900">{{ s.code }}</p>
                    <p class="truncate">{{ prefs.txt('ফোন', 'Phone') }}: {{ s.phone || '—' }}</p>
                    <p>{{ prefs.txt('যোগদান', 'Joined') }}: {{ displayDate(s.joinDate) }}</p>
                  </div>
                </div>
                <img [src]="idCardQr()" [alt]="prefs.txt('হাজিরা QR', 'Attendance QR')" class="w-[15mm] h-[15mm] shrink-0 self-start" loading="lazy" decoding="async">
              </div>

              <div class="absolute bottom-0 inset-x-0 px-3 py-1.5 bg-teal-700 text-white flex items-center justify-between gap-2 text-[6.5px]">
                <span class="truncate">{{ geoLine(s) || s.address || '—' }}</span>
                <span class="shrink-0 font-bold tracking-wide">{{ prefs.txt('হাজিরা QR', 'Attendance QR') }}</span>
              </div>
            </div>
          </div>

          <div class="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
            <button (click)="closeIdCard()" class="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer">{{ prefs.txt('বন্ধ', 'Close') }}</button>
            <button (click)="downloadIdCard()" [disabled]="idCardBusy()" class="px-4 py-2 bg-white hover:bg-slate-100 border border-teal-300 text-teal-700 disabled:opacity-50 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-sm">download</mat-icon> PNG
            </button>
            <button (click)="printIdCard()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-sm">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Staff detail: everything on one panel, opened by clicking a table row. -->
    @if (detailStaff(); as s) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end" (click)="closeDetail()">
        <div class="bg-white w-full max-w-md h-full shadow-2xl flex flex-col overflow-hidden text-slate-800" (click)="$event.stopPropagation()">
          <div class="bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 p-5 text-white">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-3 min-w-0">
                @if (s.photo) {
                  <img [src]="s.photo" alt="" class="w-16 h-16 rounded-2xl object-cover ring-2 ring-white/70 shrink-0" loading="lazy" decoding="async">
                } @else {
                  <span class="w-16 h-16 rounded-2xl bg-white/20 text-white flex items-center justify-center text-2xl font-black shrink-0">{{ initials(s.name) }}</span>
                }
                <div class="min-w-0">
                  <p class="text-lg font-black truncate">{{ s.name }}</p>
                  <p class="text-[11px] text-teal-50/90 truncate">{{ s.designation || prefs.txt('কর্মচারী', 'Employee') }}</p>
                  <p class="font-mono text-[11px] font-bold text-teal-100 mt-0.5">{{ s.code }}</p>
                </div>
              </div>
              <button (click)="closeDetail()" class="p-1 text-white/80 hover:text-white hover:bg-white/15 rounded-full cursor-pointer">
                <mat-icon class="text-lg">close</mat-icon>
              </button>
            </div>
            <div class="mt-3 flex items-center gap-2">
              <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white/20">{{ statusLabel(s.status) }}</span>
              <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white/20">{{ displayDate(s.joinDate) }} {{ prefs.txt('যোগদান', 'joined') }}</span>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-4 space-y-3">
            <div class="grid grid-cols-2 gap-2">
              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p class="text-[10px] font-bold text-slate-500">{{ prefs.txt('মাসিক বেতন', 'Monthly salary') }}</p>
                <p class="font-mono text-sm font-black text-emerald-700">{{ s.monthlySalary | number:'1.2-2' }} TK</p>
              </div>
              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p class="text-[10px] font-bold text-slate-500">{{ prefs.txt('এই মাসে হাজিরা', 'Attendance this month') }}</p>
                <p class="font-mono text-sm font-black text-teal-700">{{ detailAttendance().total }} {{ prefs.txt('দিন', 'days') }}</p>
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 divide-y divide-slate-100">
              <div class="flex items-center gap-2 px-3 py-2.5">
                <mat-icon class="text-slate-400 !text-[16px] !w-4 !h-4">call</mat-icon>
                <span class="text-[10px] font-bold text-slate-500 w-20 shrink-0">{{ prefs.txt('ফোন', 'Phone') }}</span>
                <span class="text-xs font-semibold text-slate-800 truncate">{{ s.phone || '—' }}</span>
              </div>
              <div class="flex items-center gap-2 px-3 py-2.5">
                <mat-icon class="text-slate-400 !text-[16px] !w-4 !h-4">mail</mat-icon>
                <span class="text-[10px] font-bold text-slate-500 w-20 shrink-0">{{ prefs.txt('ইমেইল', 'Email') }}</span>
                <span class="text-xs font-semibold text-slate-800 truncate">{{ s.email || '—' }}</span>
              </div>
              <div class="flex items-start gap-2 px-3 py-2.5">
                <mat-icon class="text-slate-400 !text-[16px] !w-4 !h-4 mt-0.5">home</mat-icon>
                <span class="text-[10px] font-bold text-slate-500 w-20 shrink-0">{{ prefs.txt('ঠিকানা', 'Address') }}</span>
                <span class="text-xs font-semibold text-slate-800 leading-snug">{{ s.address || '—' }}</span>
              </div>
              <div class="flex items-start gap-2 px-3 py-2.5">
                <mat-icon class="text-slate-400 !text-[16px] !w-4 !h-4 mt-0.5">map</mat-icon>
                <span class="text-[10px] font-bold text-slate-500 w-20 shrink-0">{{ prefs.txt('বিভাগ/জেলা', 'Division/District') }}</span>
                <span class="text-xs font-semibold text-slate-800 leading-snug">{{ geoLine(s) || '—' }}</span>
              </div>
              <div class="flex items-start gap-2 px-3 py-2.5">
                <mat-icon class="text-slate-400 !text-[16px] !w-4 !h-4 mt-0.5">notes</mat-icon>
                <span class="text-[10px] font-bold text-slate-500 w-20 shrink-0">{{ prefs.txt('নোট', 'Note') }}</span>
                <span class="text-xs font-semibold text-slate-800 leading-snug">{{ s.note || '—' }}</span>
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 p-3">
              <p class="text-[11px] font-bold text-slate-700 mb-2">{{ prefs.txt('এই মাসের হাজিরার সারাংশ', 'Attendance summary this month') }}</p>
              <div class="grid grid-cols-3 gap-2 text-center">
                <div class="rounded-lg bg-emerald-50 border border-emerald-200 py-2">
                  <p class="text-[9px] font-bold text-emerald-600">{{ prefs.txt('উপস্থিত', 'Present') }}</p>
                  <p class="font-mono text-sm font-black text-emerald-700">{{ detailAttendance().present }}</p>
                </div>
                <div class="rounded-lg bg-amber-50 border border-amber-200 py-2">
                  <p class="text-[9px] font-bold text-amber-600">{{ prefs.txt('দেরি', 'Late') }}</p>
                  <p class="font-mono text-sm font-black text-amber-700">{{ detailAttendance().late }}</p>
                </div>
                <div class="rounded-lg bg-sky-50 border border-sky-200 py-2">
                  <p class="text-[9px] font-bold text-sky-600">{{ prefs.txt('ছুটি', 'Leave') }}</p>
                  <p class="font-mono text-sm font-black text-sky-700">{{ detailAttendance().leave }}</p>
                </div>
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 p-3">
              <div class="mb-2 flex items-center justify-between">
                <p class="text-[11px] font-bold text-slate-700">{{ prefs.txt('এই বছরের অনুমোদিত ছুটি', 'Approved leave this year') }}</p>
                <span class="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-600">{{ detailLeaves().total }} {{ prefs.txt('দিন', 'days') }}</span>
              </div>
              <div class="grid grid-cols-4 gap-1.5 text-center">
                <div class="rounded-lg bg-teal-50 border border-teal-200 py-1.5">
                  <p class="text-[9px] font-bold text-teal-700">{{ prefs.txt('নৈমিত্তিক', 'Casual') }}</p>
                  <p class="font-mono text-xs font-black text-teal-800">{{ detailLeaves().casual }}</p>
                </div>
                <div class="rounded-lg bg-teal-50 border border-teal-200 py-1.5">
                  <p class="text-[9px] font-bold text-teal-700">{{ prefs.txt('অসুস্থতা', 'Sick') }}</p>
                  <p class="font-mono text-xs font-black text-teal-800">{{ detailLeaves().sick }}</p>
                </div>
                <div class="rounded-lg bg-teal-50 border border-teal-200 py-1.5">
                  <p class="text-[9px] font-bold text-teal-700">{{ prefs.txt('বার্ষিক', 'Annual') }}</p>
                  <p class="font-mono text-xs font-black text-teal-800">{{ detailLeaves().annual }}</p>
                </div>
                <div class="rounded-lg bg-rose-50 border border-rose-200 py-1.5">
                  <p class="text-[9px] font-bold text-rose-700">{{ prefs.txt('অবৈতনিক', 'Unpaid') }}</p>
                  <p class="font-mono text-xs font-black text-rose-800">{{ detailLeaves().unpaid }}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center gap-2">
            <button (click)="openIdCard(s)" class="flex-1 inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2.5 rounded-lg cursor-pointer">
              <mat-icon class="text-sm">badge</mat-icon> {{ prefs.txt('ID কার্ড', 'ID card') }}
            </button>
            <button (click)="editFromDetail(s)" class="flex-1 inline-flex items-center justify-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-lg cursor-pointer">
              <mat-icon class="text-sm">edit</mat-icon> {{ prefs.txt('সম্পাদনা', 'Edit') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Right Side-Over Drawer: Add / Edit Staff -->
    @if (showAddDrawer()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end">
        <div class="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden text-slate-800 animate-in slide-in-from-right duration-300">

          <div class="bg-white border-b border-slate-200">
            <div class="p-4 flex items-center justify-between border-b border-slate-100">
              <div class="flex items-center gap-2">
                <button (click)="closeDrawer()" class="text-slate-400 hover:text-slate-700 cursor-pointer p-1 rounded-full hover:bg-slate-100 transition-colors">
                  <mat-icon class="text-lg">close</mat-icon>
                </button>
                <h2 class="text-base font-bold text-slate-900">
                  {{ isEditMode() ? prefs.txt('কর্মচারী সম্পাদনা', 'Edit employee') : prefs.txt('নতুন কর্মচারী', 'New employee') }}
                </h2>
              </div>
              <span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">{{ prefs.txt('মোট', 'Total') }} {{ dataService.hrmStaff().length }} {{ prefs.txt('জন', 'people') }}</span>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-6 space-y-4">
            <div class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              @if (formPhoto) {
                <img [src]="formPhoto" alt="" class="w-16 h-16 rounded-xl object-cover ring-1 ring-slate-200 shrink-0" loading="lazy" decoding="async">
              } @else {
                <span class="w-16 h-16 rounded-xl bg-white border border-dashed border-slate-300 text-slate-400 flex items-center justify-center shrink-0">
                  <mat-icon>person</mat-icon>
                </span>
              }
              <div class="flex-1 min-w-0">
                <p class="text-xs font-bold text-slate-700">{{ prefs.txt('প্রোফাইল ছবি', 'Profile photo') }}</p>
                <p class="text-[10px] text-slate-500">{{ prefs.txt('ID কার্ডে ব্যবহার হবে · সর্বোচ্চ 2MB', 'Used on the ID card · max 2MB') }}</p>
                <div class="flex items-center gap-2 mt-1.5">
                  <label class="inline-flex items-center gap-1 bg-white border border-teal-300 text-teal-700 hover:bg-teal-50 text-[11px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer">
                    <input type="file" accept="image/*" class="hidden" (change)="onPhotoPicked($event)">
                    <mat-icon class="text-sm">{{ photoBusy() ? 'hourglass_top' : 'upload' }}</mat-icon>
                    {{ photoBusy() ? prefs.txt('আপলোড হচ্ছে…', 'Uploading…') : prefs.txt('ছবি আপলোড', 'Upload photo') }}
                  </label>
                  @if (formPhoto) {
                    <button type="button" (click)="formPhoto = ''" class="inline-flex items-center gap-1 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 text-[11px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer">
                      <mat-icon class="text-sm">delete</mat-icon> {{ prefs.txt('সরান', 'Remove') }}
                    </button>
                  }
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('স্টাফ কোড', 'Staff Code') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-slate-400 text-sm mr-2">badge</mat-icon>
                  <input type="text" [(ngModel)]="formCode" placeholder="EMP-01" class="w-full bg-transparent outline-none text-xs font-mono font-bold text-slate-800">
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('নাম', 'Name') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-slate-400 text-sm mr-2">person</mat-icon>
                  <input type="text" [(ngModel)]="formName" [placeholder]="prefs.txt('মোঃ হাসান', 'Md. Hasan')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('পদবী', 'Designation') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-slate-400 text-sm mr-2">workspace_premium</mat-icon>
                  <input type="text" [(ngModel)]="formDesignation" [placeholder]="prefs.txt('হেড মেকানিক / সেলসম্যান', 'Head mechanic / Salesman')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('ফোন', 'Phone') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-slate-400 text-sm mr-2">call</mat-icon>
                  <input type="text" [(ngModel)]="formPhone" placeholder="019XXXXXXXX" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ইমেইল', 'Email') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-slate-400 text-sm mr-2">mail</mat-icon>
                  <input type="email" [(ngModel)]="formEmail" [placeholder]="prefs.txt('ইমেইল লিখুন', 'Enter email')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('যোগদানের তারিখ', 'Join date') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-slate-400 text-sm mr-2">calendar_today</mat-icon>
                  <input type="date" appDmyDate [(ngModel)]="formJoinDate" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('মাসিক বেতন', 'Monthly salary') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-400">
                  <span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-1.5 border-r border-slate-300">TK</span>
                  <input type="number" step="0.01" [(ngModel)]="formSalary" class="w-full p-1.5 outline-none text-xs font-bold font-mono text-slate-900">
                </div>
              </div>

              <div>
                <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('স্ট্যাটাস', 'Status') }}</label>
                <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-400">
                  <mat-icon class="text-emerald-500 text-sm mr-2">check_circle</mat-icon>
                  <select [(ngModel)]="formStatus" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    @for (s of statusDefs(); track s) {
                      <option [value]="s">{{ statusLabel(s) }}</option>
                    }
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ঠিকানা (বিস্তারিত)', 'Address (details)') }}</label>
              <textarea rows="2" [(ngModel)]="formAddress" [placeholder]="prefs.txt('গ্রাম/বাসা, রোড, এলাকা', 'Village/house, road, area')"
                class="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium text-slate-800 focus:ring-2 focus:ring-teal-400 focus:outline-none"></textarea>
            </div>

            <div class="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <p class="text-[11px] font-bold text-slate-600 mb-2 flex items-center gap-1.5">
                <mat-icon class="!text-[15px] !w-[15px] !h-[15px] text-teal-600">map</mat-icon> {{ prefs.txt('বিভাগ / জেলা / উপজেলা', 'Division / District / Upazila') }}
              </p>
              <app-geo-select
                [(division)]="formDivision"
                [(district)]="formDistrict"
                [(upazila)]="formUpazila"
              />
            </div>

            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('নোট / মন্তব্য', 'Note / comment') }}</label>
              <textarea rows="3" [(ngModel)]="formNote" [placeholder]="prefs.txt('ডিউটি, দায়িত্ব বা অন্য কিছু...', 'Duty, responsibility or anything else...')"
                class="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium text-slate-800 focus:ring-2 focus:ring-teal-400 focus:outline-none"></textarea>
            </div>
          </div>

          <div class="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
            <button (click)="closeDrawer()" class="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer transition-colors">
              {{ prefs.txt('বাতিল', 'Cancel') }}
            </button>
            <button (click)="saveStaffForm()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-2xs cursor-pointer transition-colors">
              <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ করুন', 'Save') }}
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class Hrm {
  dataService = inject(DataService);
  prefs = inject(PreferencesService);
  private notify = inject(NotificationService);
  private media = inject(MediaService);
  session = inject(SessionService);

  @ViewChild('idCardEl') private idCardEl?: ElementRef<HTMLElement>;

  activeTab = signal<string>('All');
  searchQuery = signal<string>('');
  showAddDrawer = signal<boolean>(false);
  isEditMode = signal<boolean>(false);
  editingStaffId = signal<number | null>(null);
  idCardStaff = signal<HrmStaff | null>(null);
  detailStaff = signal<HrmStaff | null>(null);
  idCardBusy = signal(false);
  photoBusy = computed(() => this.media.busy());

  readonly shopName = computed(() => {
    const s = this.dataService.voucherSettings();
    return `${s.businessNamePart1 || ''} ${s.businessNamePart2 || ''}`.trim() || 'SM Enterprise';
  });

  readonly idCardQr = computed(() => {
    const staff = this.idCardStaff();
    return staff ? qrDataUrl(staff.code, 240) : '';
  });

  readonly detailAttendance = computed(() => {
    const staff = this.detailStaff();
    if (!staff) return { present: 0, late: 0, leave: 0, total: 0 };
    const month = localDateIso().slice(0, 7);
    const rows = this.dataService.attendance()
      .filter(a => a.staffId === staff.id && (a.date || '').startsWith(month));
    return {
      present: rows.filter(a => a.status === 'Present').length,
      late: rows.filter(a => a.status === 'Late').length,
      leave: rows.filter(a => a.status === 'Leave').length,
      total: rows.filter(a => a.status !== 'Absent').length
    };
  });

  readonly detailLeaves = computed(() => {
    const staff = this.detailStaff();
    const empty = { casual: 0, sick: 0, annual: 0, unpaid: 0, total: 0 };
    if (!staff) return empty;
    const year = localDateIso().slice(0, 4);
    const approved = this.dataService.hrmLeaves()
      .filter(l => l.staffId === staff.id && l.status === 'Approved');
    const days = (type: LeaveType) => approved
      .filter(l => l.type === type)
      .reduce((acc, l) => acc + this.dataService.leaveDates(l.fromDate, l.toDate)
        .filter(d => d.startsWith(year)).length, 0);
    const casual = days('Casual');
    const sick = days('Sick');
    const annual = days('Annual');
    const unpaid = days('Unpaid');
    return { casual, sick, annual, unpaid, total: casual + sick + annual + unpaid };
  });

  readonly statusDefs = signal<HrmStaff['status'][]>(['Active', 'On Leave', 'Inactive']);

  // Form state
  formCode = '';
  formName = '';
  formDesignation = '';
  formPhone = '';
  formEmail = '';
  formAddress = '';
  formDivision = '';
  formDistrict = '';
  formUpazila = '';
  formPhoto = '';
  formJoinDate = localDateIso();
  formSalary = 0;
  formStatus: HrmStaff['status'] = 'Active';
  formNote = '';

  readonly tabDefs = computed(() => [
    { value: 'All', label: this.prefs.txt('সব কর্মচারী', 'All employees'), icon: 'badge' },
    { value: 'Active', label: this.prefs.txt('সক্রিয়', 'Active'), icon: 'check_circle' },
    { value: 'On Leave', label: this.prefs.txt('ছুটিতে', 'On leave'), icon: 'beach_access' },
    { value: 'Inactive', label: this.prefs.txt('নিষ্ক্রিয়', 'Inactive'), icon: 'person_off' }
  ]);

  tabCount(value: string): number {
    const list = this.dataService.hrmStaff();
    return value === 'All' ? list.length : list.filter(s => s.status === value).length;
  }

  activeTabLabel(): string {
    const tab = this.tabDefs().find(t => t.value === this.activeTab());
    return tab ? tab.label : this.prefs.txt('সব কর্মচারী', 'All employees');
  }

  statusLabel(status: HrmStaff['status']): string {
    const map: Record<HrmStaff['status'], [string, string]> = {
      'Active': ['সক্রিয়', 'Active'],
      'On Leave': ['ছুটিতে', 'On leave'],
      'Inactive': ['নিষ্ক্রিয়', 'Inactive']
    };
    const pair = map[status];
    return pair ? this.prefs.txt(pair[0], pair[1]) : status;
  }

  filteredStaff = computed(() => {
    let list = this.dataService.hrmStaff();
    const tab = this.activeTab();
    const q = this.searchQuery().toLowerCase().trim();

    if (tab !== 'All') list = list.filter(s => s.status === tab);

    if (q) {
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.designation || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        this.displayDate(s.joinDate).includes(q)
      );
    }

    return list;
  });

  readonly pager = createPager<HrmStaff>(() => this.filteredStaff());

  totals = computed(() => {
    const list = this.filteredStaff();
    return {
      headCount: list.length,
      active: list.filter(s => s.status === 'Active').length,
      salary: Math.round(list.reduce((acc, s) => acc + (Number(s.monthlySalary) || 0), 0) * 100) / 100
    };
  });

  setTab(value: string) {
    this.activeTab.set(value);
    this.pager.setPage(1);
  }

  onSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.searchQuery.set(target.value);
    this.pager.setPage(1);
  }

  initials(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  displayDate(value: string): string {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || '').trim());
    return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : (value || '-');
  }

  statusBadge(status: HrmStaff['status']): string {
    const map: Record<HrmStaff['status'], string> = {
      'Active': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
      'On Leave': 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
      'Inactive': 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300'
    };
    return map[status] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }

  /** Codes are hand-edited later, so the suggestion only skips numbers already taken. */
  nextCode(): string {
    const taken = new Set(this.dataService.hrmStaff().map(s => (s.code || '').trim().toUpperCase()));
    let n = taken.size + 1;
    let candidate = `EMP-${String(n).padStart(2, '0')}`;
    while (taken.has(candidate)) {
      n++;
      candidate = `EMP-${String(n).padStart(2, '0')}`;
    }
    return candidate;
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.editingStaffId.set(null);
    this.formCode = this.nextCode();
    this.formName = '';
    this.formDesignation = '';
    this.formPhone = '';
    this.formEmail = '';
    this.formAddress = '';
    this.formDivision = '';
    this.formDistrict = '';
    this.formUpazila = '';
    this.formPhoto = '';
    this.formJoinDate = localDateIso();
    this.formSalary = 0;
    this.formStatus = 'Active';
    this.formNote = '';
    this.showAddDrawer.set(true);
  }

  openEditModal(s: HrmStaff) {
    this.isEditMode.set(true);
    this.editingStaffId.set(s.id);
    this.formCode = s.code || '';
    this.formName = s.name || '';
    this.formDesignation = s.designation || '';
    this.formPhone = s.phone || '';
    this.formEmail = s.email || '';
    this.formAddress = s.address || '';
    this.formDivision = s.division || '';
    this.formDistrict = s.district || '';
    this.formUpazila = s.upazila || '';
    this.formPhoto = s.photo || '';
    this.formJoinDate = this.isoDay(s.joinDate);
    this.formSalary = s.monthlySalary || 0;
    this.formStatus = s.status;
    this.formNote = s.note || '';
    this.showAddDrawer.set(true);
  }

  closeDrawer() {
    this.showAddDrawer.set(false);
  }

  isoDay(value: string): string {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || '').trim());
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : (value || '');
  }

  saveStaffForm() {
    const cleanName = (this.formName || '').trim();
    if (!cleanName) {
      this.notify.error(this.prefs.txt('কর্মচারীর নাম লিখুন।', 'Enter the employee name.'), this.prefs.txt('নাম নেই', 'Name missing'));
      return;
    }
    const cleanCode = (this.formCode || '').trim();
    if (!cleanCode) {
      this.notify.error(this.prefs.txt('কর্মচারী কোড লিখুন।', 'Enter the employee code.'), this.prefs.txt('কোড নেই', 'Code missing'));
      return;
    }
    const clash = this.dataService.hrmStaff().find(s =>
      s.code.trim().toLowerCase() === cleanCode.toLowerCase() && s.id !== this.editingStaffId());
    if (clash) {
      this.notify.warning(this.prefs.txt(`“${cleanCode}” কোডে কর্মচারী আগেই আছে।`, `An employee with code “${cleanCode}” already exists.`), this.prefs.txt('কোডের দ্বৈততা', 'Duplicate code'));
      return;
    }

    const payload: Omit<HrmStaff, 'id' | 'createdAt'> = {
      code: cleanCode,
      name: cleanName,
      designation: (this.formDesignation || '').trim(),
      phone: (this.formPhone || '').trim(),
      email: (this.formEmail || '').trim(),
      address: (this.formAddress || '').trim(),
      division: this.formDivision || '',
      district: this.formDistrict || '',
      upazila: this.formUpazila || '',
      photo: this.formPhoto || '',
      joinDate: this.isoDay(this.formJoinDate),
      monthlySalary: Number(this.formSalary) || 0,
      status: this.formStatus,
      note: (this.formNote || '').trim()
    };

    if (this.isEditMode() && this.editingStaffId() !== null) {
      this.dataService.updateStaff(this.editingStaffId()!, payload);
      this.notify.success(this.prefs.txt('কর্মচারীর তথ্য আপডেট হয়েছে।', 'Employee details updated.'));
    } else {
      this.dataService.addStaff(payload);
      this.notify.success(this.prefs.txt(`নতুন কর্মচারী সংরক্ষিত হয়েছে: ${cleanName}`, `New employee saved: ${cleanName}`));
    }

    this.showAddDrawer.set(false);
  }

  async deleteStaff(s: HrmStaff) {
    const openAdvance = this.dataService.staffAdvanceOpen(s.id, s.name);
    if (openAdvance > 0) {
      this.notify.warning(
        this.prefs.txt(
          `${s.name} এর ৳${openAdvance.toFixed(2)} অগ্রিম এখনো বাকি। আগে সেটা মিটিয়ে বা বাতিল করে তারপর কর্মচারী মুছুন।`,
          `${s.name} still has ৳${openAdvance.toFixed(2)} in open advance. Settle or cancel it before deleting the employee.`
        ),
        this.prefs.txt('অগ্রিম বাকি আছে', 'Advance is open')
      );
      return;
    }
    const confirmed = await this.notify.confirm(
      this.prefs.txt(`${s.name} (${s.code}) এর রেকর্ড স্থায়ীভাবে মুছে যাবে — সাথে এই কর্মীর হাজিরা ও ছুটির রেকর্ডও মুছে যাবে।`, `The record for ${s.name} (${s.code}) will be deleted permanently, along with this employee’s attendance and leave records.`),
      { title: this.prefs.txt('কর্মচারী মুছে ফেলবেন?', 'Delete this employee?'), kind: 'error', confirmText: this.prefs.txt('মুছুন', 'Delete'), cancelText: this.prefs.txt('বাতিল', 'Cancel') }
    );
    if (confirmed) {
      this.dataService.deleteStaff(s.id);
      this.notify.success(this.prefs.txt('কর্মচারী মুছে ফেলা হয়েছে।', 'Employee deleted.'));
    }
  }

  exportExcel() {
    this.dataService.exportToExcel(this.filteredStaff(), 'HRM_Staff_List');
  }

  async onPhotoPicked(event: Event) {
    const hint = (this.formName || this.formCode || 'staff').trim();
    const picked = await this.media.pick(event, 'staff', hint);
    if (!picked.ok) {
      if (picked.error) this.notify.warning(picked.error, this.prefs.txt('ছবি আপলোড', 'Photo upload'));
      return;
    }
    this.formPhoto = picked.image.ref;
    if (picked.image.note) this.notify.info(picked.image.note, this.prefs.txt('ছবি', 'Photo'));
  }

  openDetail(s: HrmStaff) {
    this.detailStaff.set(s);
  }

  closeDetail() {
    this.detailStaff.set(null);
  }

  editFromDetail(s: HrmStaff) {
    this.detailStaff.set(null);
    this.openEditModal(s);
  }

  openIdCard(s: HrmStaff) {
    this.detailStaff.set(null);
    this.idCardStaff.set(s);
  }

  closeIdCard() {
    this.idCardStaff.set(null);
  }

  printIdCard() {
    window.print();
  }

  async downloadIdCard() {
    const el = this.idCardEl?.nativeElement;
    const staff = this.idCardStaff();
    if (!el || !staff) return;
    this.idCardBusy.set(true);
    try {
      await document.fonts?.ready;
      const dataUrl = await htmlToImage.toPng(el, { pixelRatio: 4, cacheBust: false, backgroundColor: '#ffffff' });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${staff.code}-id-card.png`;
      link.click();
      this.notify.success(this.prefs.txt('ID কার্ড PNG ডাউনলোড হয়েছে।', 'ID card PNG downloaded.'));
    } catch {
      this.notify.error(this.prefs.txt('ID কার্ডের ছবি তৈরি করা যায়নি। আবার চেষ্টা করুন।', 'Could not create the ID card image. Please try again.'));
    } finally {
      this.idCardBusy.set(false);
    }
  }

  /** Bengali/English label for the stored English geo keys. */
  geoLine(s: HrmStaff): string {
    const bn = this.prefs.language() === 'bn';
    const division = (bn ? BD_DIVISIONS.find(d => d.en === (s.division || ''))?.bn : s.division) || s.division || '';
    const district = (bn ? geoDistricts(s.division || '').find(d => d.en === (s.district || ''))?.bn : s.district) || s.district || '';
    const upazila = (bn ? geoUpazilas(s.division || '', s.district || '').find(u => u.en === (s.upazila || ''))?.bn : s.upazila) || s.upazila || '';
    return [upazila, district, division].filter(Boolean).join(', ');
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
