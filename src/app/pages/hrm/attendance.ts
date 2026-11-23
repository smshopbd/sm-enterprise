import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild,
  computed, effect, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import * as htmlToImage from 'html-to-image';
import { jsPDF } from 'jspdf';
import { DataService, AttendanceRecord, HrmStaff } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { CloudService } from '../../services/cloud';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';
import { persistedSignal } from '../../utils/persisted-signal';
import { qrDataUrl, qrMatrix } from '../../utils/qr-code';
import { pngWithDpi } from '../../utils/png-dpi';
import { nextPunch, punchField, PunchKind } from '../../utils/attendance-punch';
import { HrmNav } from './hrm-nav';

/** Exported station cards are print artwork: 300 DPI keeps the QR modules sharp. */
const STATION_DPI = 300;

@Component({
  selector: 'app-hrm-attendance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, HrmNav],
  styles: `
    .at-sticky { position: sticky; top: 0; z-index: 5; background-color: var(--sm-brand, #0d9488); }
    @media print {
      #printable-area.station-sheet {
        width: 76mm !important;
        border-radius: 0 !important;
        box-shadow: none !important;
      }
      #printable-area.station-sheet * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">
      <app-hrm-nav />

      <!-- Hero -->
      <div class="bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 rounded-xl p-4 text-white shadow-sm">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-bold flex items-center gap-2">
              <mat-icon>how_to_reg</mat-icon> {{ prefs.txt('হাজিরা', 'Attendance') }}
            </h1>
            <p class="text-[11px] text-teal-50/90">{{ prefs.txt('QR স্ক্যান বা ফেস হাজিরা — প্রতিটি হাজিরা থেকেই মাসিক বেতন হিসাব হবে।', 'QR scan or face attendance — monthly salary is calculated from every attendance.') }}</p>
          </div>
          <div class="flex items-center gap-2">
            <label class="inline-flex items-center gap-1.5 bg-white/15 border border-white/25 rounded-lg px-2.5 py-1.5">
              <mat-icon class="text-sm">calendar_today</mat-icon>
              <input type="date" [ngModel]="date()" (ngModelChange)="setDate($event)"
                class="bg-transparent outline-none text-xs font-bold text-white [color-scheme:dark]">
            </label>
            <label class="inline-flex items-center gap-1.5 bg-white/15 border border-white/25 rounded-lg px-2.5 py-1.5" [title]="prefs.txt('অফিস শুরুর সময় — এর পরে এলে দেরি', 'Office start time — arrivals after this are late')">
              <mat-icon class="text-sm">schedule</mat-icon>
              <input type="time" [ngModel]="officeStart()" (ngModelChange)="setOfficeStart($event)"
                class="bg-transparent outline-none text-xs font-bold text-white [color-scheme:dark]">
            </label>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('মোট কর্মী', 'Total staff') }}</p>
            <p class="text-lg font-black font-mono">{{ activeStaff().length }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('উপস্থিত', 'Present') }}</p>
            <p class="text-lg font-black font-mono">{{ stats().present }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('দেরি', 'Late') }}</p>
            <p class="text-lg font-black font-mono">{{ stats().late }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('ছুটি', 'Leave') }}</p>
            <p class="text-lg font-black font-mono">{{ stats().leave }}</p>
          </div>
          <div class="bg-white/12 border border-white/20 rounded-lg px-3 py-2">
            <p class="text-[10px] font-bold text-teal-50/80">{{ prefs.txt('অনুপস্থিত', 'Absent') }}</p>
            <p class="text-lg font-black font-mono">{{ stats().absent }}</p>
          </div>
        </div>
      </div>

      <!-- Scan actions -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-col gap-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="font-bold text-sm text-slate-900 flex items-center gap-1.5"><mat-icon class="text-teal-700 text-base">qr_code_scanner</mat-icon> {{ prefs.txt('QR কোড হাজিরা', 'QR attendance') }}</p>
              <p class="text-[11px] text-slate-500 mt-0.5">{{ prefs.txt('কর্মচারীর আইডি কার্ডের QR ধরে স্ক্যান করুন — সকালে ইন, খাবার আউট, ফিরে এসে ইন, বাড়ি যাওয়ার আউট।', 'Scan the employee ID card QR — in the morning, out for lunch, back, then out for the day.') }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button (click)="openScanner('QR')" class="inline-flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold px-3.5 py-2 rounded-lg cursor-pointer">
              <mat-icon class="text-sm">qr_code_scanner</mat-icon> {{ prefs.txt('স্ক্যান শুরু', 'Start scan') }}
            </button>
            <div class="flex items-center border border-slate-300 rounded-lg overflow-hidden flex-1 min-w-[180px]">
              <mat-icon class="text-slate-400 text-sm ml-2">keyboard</mat-icon>
              <input [(ngModel)]="manualCode" (keyup.enter)="checkInByCode()" [placeholder]="prefs.txt('কোড লিখুন (EMP-01)', 'Enter code (EMP-01)')"
                class="w-full px-2 py-2 outline-none text-xs font-mono font-bold">
              <button (click)="checkInByCode()" class="bg-slate-100 hover:bg-slate-200 px-3 py-2 font-bold text-slate-700 cursor-pointer">{{ prefs.txt('হাজিরা', 'Mark') }}</button>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-col gap-3">
          <div>
            <p class="font-bold text-sm text-slate-900 flex items-center gap-1.5"><mat-icon class="text-emerald-600 text-base">face</mat-icon> {{ prefs.txt('ফেস হাজিরা', 'Face attendance') }}</p>
            <p class="text-[11px] text-slate-500 mt-0.5">{{ prefs.txt('কর্মী বেছে নিয়ে ছবি তুলুন — ছবি প্রমাণ হিসেবে সংরক্ষিত থাকবে।', 'Pick the employee and take a photo — the photo is stored as proof.') }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select [(ngModel)]="faceStaffId" class="border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold flex-1 min-w-[170px] outline-none focus:ring-2 focus:ring-teal-400">
              <option [ngValue]="null">{{ prefs.txt('কর্মচারী নির্বাচন করুন', 'Select employee') }}</option>
              @for (s of activeStaff(); track s.id) {
                <option [ngValue]="s.id">{{ s.name }} ({{ s.code }})</option>
              }
            </select>
            <button (click)="openScanner('Face')" class="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-2 rounded-lg cursor-pointer">
              <mat-icon class="text-sm">photo_camera</mat-icon> {{ prefs.txt('ফেস হাজিরা', 'Face check-in') }}
            </button>
            <button (click)="openManual()" class="inline-flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold px-3 py-2 rounded-lg cursor-pointer">
              <mat-icon class="text-sm">edit_note</mat-icon> {{ prefs.txt('ম্যানুয়াল', 'Manual') }}
            </button>
          </div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-col gap-3">
          <div>
            <p class="font-bold text-sm text-slate-900 flex items-center gap-1.5"><mat-icon class="text-indigo-600 text-base">badge</mat-icon> {{ prefs.txt('স্টেশন QR', 'Station QR') }}</p>
            <p class="text-[11px] text-slate-500 mt-0.5">{{ prefs.txt('এই QR দোকানে লাগিয়ে রাখুন — কর্মী নিজের ফোনে স্ক্যান করে ক্যামেরায় মুখ দেখালেই হাজিরা নিশ্চিত হবে।', 'Post this QR in the shop — employees scan it with their own phone and mark attendance with the camera.') }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button (click)="openStationQr()" class="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3.5 py-2 rounded-lg cursor-pointer">
              <mat-icon class="text-sm">qr_code_2</mat-icon> {{ prefs.txt('স্টেশন QR', 'Station QR') }}
            </button>
            <button (click)="openSelfCheckin()" class="inline-flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold px-3 py-2 rounded-lg cursor-pointer">
              <mat-icon class="text-sm">face_retouching_natural</mat-icon> {{ prefs.txt('নিজে হাজিরা', 'Self check-in') }}
            </button>
          </div>
          @if (stationCloud() !== 'idle') {
            <p class="text-[10px] font-semibold flex items-center gap-1 -mt-1 flex-wrap"
              [class]="stationCloud() === 'saved' ? 'text-emerald-700' : stationCloud() === 'error' ? 'text-rose-600' : 'text-slate-500'">
              <mat-icon class="text-[13px]">{{ stationCloud() === 'saved' ? 'cloud_done' : stationCloud() === 'error' ? 'cloud_off' : 'cloud_sync' }}</mat-icon>
              {{ stationCloud() === 'saved'
                ? prefs.txt('QR ক্লাউডে সক্রিয় — কর্মচারীর ফোনে কাজ করবে।', 'QR is active in cloud — it works on employee phones.')
                : stationCloud() === 'error'
                  ? prefs.txt('ক্লাউডে স্টেশন সেভ হয়নি — লগইন/ইন্টারনেট দেখুন।', 'Station could not be saved to cloud — check login/internet.')
                  : prefs.txt('ক্লাউডে সেভ হচ্ছে…', 'Saving to cloud…') }}
              @if (stationCloud() === 'error') {
                <button type="button" (click)="registerStation()" class="underline font-bold cursor-pointer">{{ prefs.txt('আবার চেষ্টা', 'Retry') }}</button>
              }
            </p>
          }
        </div>
      </div>

      <!-- Filters -->
      <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div class="flex items-center gap-1.5 flex-wrap">
          @for (t of statusTabs(); track t.value) {
            <button (click)="setStatus(t.value)"
              class="px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
              [class]="statusFilter() === t.value ? 'bg-teal-700 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'">
              {{ t.label }}
            </button>
          }
        </div>
        <div class="relative w-full sm:max-w-xs">
          <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
          <input [ngModel]="searchQuery()" (ngModelChange)="setSearch($event)" [placeholder]="prefs.txt('নাম বা কোড...', 'Name or code...')"
            class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none">
        </div>
      </div>

      <!-- Table -->
      <div class="hidden lg:block bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div class="overflow-auto max-h-[66vh]">
          <table class="w-full min-w-[1080px] text-xs text-left border-collapse">
            <thead>
              <tr class="text-white font-bold uppercase text-[11px] tracking-wider">
                <th class="p-2.5 w-10 text-center at-sticky">SL</th>
                <th class="p-2.5 at-sticky">{{ prefs.txt('কর্মচারী', 'Employee') }}</th>
                <th class="p-2.5 at-sticky">{{ prefs.txt('তারিখ', 'Date') }}</th>
                <th class="p-2.5 text-center at-sticky">{{ prefs.txt('ইন', 'In') }}</th>
                <th class="p-2.5 text-center at-sticky">{{ prefs.txt('খাবার আউট', 'Lunch out') }}</th>
                <th class="p-2.5 text-center at-sticky">{{ prefs.txt('ফেরা', 'Back') }}</th>
                <th class="p-2.5 text-center at-sticky">{{ prefs.txt('আউট', 'Out') }}</th>
                <th class="p-2.5 text-center at-sticky">{{ prefs.txt('মাধ্যম', 'Method') }}</th>
                <th class="p-2.5 text-center at-sticky">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</th>
                <th class="p-2.5 at-sticky">{{ prefs.txt('নোট', 'Note') }}</th>
                <th class="p-2.5 text-center w-24 at-sticky">{{ prefs.txt('অ্যাকশন', 'Actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (a of pager.paged(); track a.id; let idx = $index) {
                <tr class="hover:bg-[#e2e8f0] transition-colors">
                  <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5">
                    <div class="flex items-center gap-2">
                      @if (a.photo) {
                        <img [src]="a.photo" (click)="viewPhoto.set(a.photo)" class="w-8 h-8 rounded-full object-cover border border-slate-200 cursor-zoom-in" [alt]="prefs.txt('হাজিরার ছবি', 'Attendance photo')" loading="lazy" decoding="async">
                      } @else {
                        <span class="w-8 h-8 rounded-full bg-teal-700/15 text-teal-700 flex items-center justify-center text-[11px] font-black">{{ initials(a.staffName) }}</span>
                      }
                      <div class="min-w-0">
                        <p class="font-bold text-teal-800 truncate">{{ a.staffName }}</p>
                        <p class="text-[10px] text-slate-500 font-mono">{{ a.staffCode }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="p-2.5 text-slate-600 whitespace-nowrap">{{ displayDate(a.date) }}</td>
                  <td class="p-2.5 text-center font-mono font-bold text-slate-800">{{ a.timeIn || '—' }}</td>
                  <td class="p-2.5 text-center font-mono font-bold" [class]="a.lunchOut ? 'text-amber-700' : 'text-slate-300'">{{ a.lunchOut || '—' }}</td>
                  <td class="p-2.5 text-center font-mono font-bold" [class]="a.lunchIn ? 'text-emerald-700' : 'text-slate-300'">{{ a.lunchIn || '—' }}</td>
                  <td class="p-2.5 text-center font-mono font-bold" [class]="a.timeOut ? 'text-slate-800' : 'text-slate-300'">{{ a.timeOut || '—' }}</td>
                  <td class="p-2.5 text-center">
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="methodBadge(a.method)">
                      <mat-icon class="text-[12px]">{{ methodIcon(a.method) }}</mat-icon>{{ methodLabel(a.method) }}
                    </span>
                  </td>
                  <td class="p-2.5 text-center">
                    <span class="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="statusBadge(a.status)">{{ statusLabel(a.status) }}</span>
                  </td>
                  <td class="p-2.5 text-slate-500 max-w-[180px] truncate" [title]="a.note">{{ a.note || '—' }}</td>
                  <td class="p-2.5 text-center">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="openManual(a)" class="p-1 text-amber-600 hover:bg-amber-100 rounded cursor-pointer" [title]="prefs.txt('এডিট', 'Edit')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      @if (session.has('deleteRecords')) {
                        <button (click)="remove(a)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer" [title]="prefs.txt('মুছুন', 'Delete')">
                          <mat-icon class="text-sm">delete</mat-icon>
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="11" class="p-10 text-center text-slate-400">
                    <mat-icon class="text-3xl text-slate-300">how_to_reg</mat-icon>
                    <p class="text-xs font-semibold mt-1">{{ prefs.txt('এই দিনে এখনো কোনো হাজিরা নেই।', 'No attendance for this day yet.') }}</p>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-table-pagination [total]="pager.total()" [page]="pager.currentPage()" [pageSize]="pager.pageSize()"
          (pageChange)="pager.setPage($event)" (pageSizeChange)="pager.setPageSize($event)" />
      </div>

      <!-- Mobile cards -->
      <div class="lg:hidden bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden divide-y divide-slate-100">
        @for (a of pager.paged(); track a.id; let idx = $index) {
          <div class="p-3 flex items-start justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              @if (a.photo) {
                <img [src]="a.photo" (click)="viewPhoto.set(a.photo)" class="w-9 h-9 rounded-full object-cover border border-slate-200" [alt]="prefs.txt('হাজিরার ছবি', 'Attendance photo')" loading="lazy" decoding="async">
              } @else {
                <span class="w-9 h-9 rounded-full bg-teal-700/15 text-teal-700 flex items-center justify-center text-xs font-black shrink-0">{{ initials(a.staffName) }}</span>
              }
              <div class="min-w-0">
                <p class="font-bold text-teal-800 truncate">{{ a.staffName }}</p>
                <p class="text-[10px] text-slate-500 font-mono">{{ a.staffCode }} • {{ displayDate(a.date) }}</p>
                <p class="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                  {{ prefs.txt('ইন', 'In') }} {{ a.timeIn || '—' }} · {{ prefs.txt('খাবার', 'Lunch') }} {{ a.lunchOut || '—' }} →
                  {{ a.lunchIn || '—' }} · {{ prefs.txt('আউট', 'Out') }} {{ a.timeOut || '—' }} · {{ methodLabel(a.method) }}
                </p>
              </div>
            </div>
            <span class="shrink-0 inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold" [class]="statusBadge(a.status)">{{ statusLabel(a.status) }}</span>
          </div>
        } @empty {
          <div class="p-8 text-center text-slate-400 text-xs font-semibold">{{ prefs.txt('এই দিনে এখনো কোনো হাজিরা নেই।', 'No attendance for this day yet.') }}</div>
        }
        <app-table-pagination [total]="pager.total()" [page]="pager.currentPage()" [pageSize]="pager.pageSize()"
          (pageChange)="pager.setPage($event)" (pageSizeChange)="pager.setPageSize($event)" />
      </div>
    </div>

    <!-- Camera sheet -->
    @if (scannerOpen()) {
      <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-50 flex items-center justify-center p-3">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden text-slate-800">
          <div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <mat-icon class="text-teal-700">{{ scanMode() === 'QR' ? 'qr_code_scanner' : 'face' }}</mat-icon>
              <div>
                <p class="font-bold text-sm">{{ scanMode() === 'QR' ? prefs.txt('QR কোড স্ক্যান', 'QR code scan') : prefs.txt('ফেস হাজিরা', 'Face attendance') }}</p>
                <p class="text-[10px] text-slate-500">{{ scanMode() === 'QR' ? prefs.txt('কর্মচারীর QR কার্ড ক্যামেরার সামনে ধরুন', 'Hold the employee QR card in front of the camera') : prefs.txt('কর্মচারীর মুখ ক্যামেরার সামনে রেখে ছবি তুলুন', 'Keep the employee’s face in front of the camera and take the photo') }}</p>
              </div>
            </div>
            <button (click)="closeScanner()" class="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full cursor-pointer">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>

          @if (stationDetected()) {
            <p class="px-4 py-2 text-[11px] font-bold text-emerald-800 bg-emerald-50 border-b border-emerald-200 flex items-center gap-1.5">
              <mat-icon class="text-sm">verified</mat-icon> {{ prefs.txt('স্টেশন QR শনাক্ত হয়েছে — নিচে নিজের নাম বেছে মুখ দেখিয়ে হাজিরা দিন।', 'Station QR detected — pick your name below and show your face to mark attendance.') }}
            </p>
          }

          <div class="relative bg-black aspect-[4/3]">
            <video #cam class="w-full h-full object-cover" autoplay muted playsinline></video>
            @if (scanMode() === 'QR') {
              <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div class="w-52 h-52 border-2 border-emerald-400/90 rounded-2xl shadow-[0_0_0_9999px_rgba(2,6,23,0.35)]"></div>
              </div>
            }
            @if (camError()) {
              <div class="absolute inset-0 bg-slate-900/85 flex items-center justify-center p-6 text-center">
                <div class="text-white space-y-2">
                  <mat-icon class="text-3xl">videocam_off</mat-icon>
                  <p class="text-xs font-semibold">{{ camError() }}</p>
                </div>
              </div>
            }
          </div>

          <div class="p-3 space-y-2">
            @if (scanMode() === 'Face') {
              <select [(ngModel)]="faceStaffId" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-400">
                <option [ngValue]="null">{{ prefs.txt('কর্মচারী নির্বাচন করুন', 'Select employee') }}</option>
                @for (s of activeStaff(); track s.id) {
                  <option [ngValue]="s.id">{{ s.name }} ({{ s.code }})</option>
                }
              </select>
            }
            <div class="flex items-center gap-2">
              @if (scanMode() === 'QR') {
                <input [(ngModel)]="manualCode" (keyup.enter)="checkInByCode()" [placeholder]="prefs.txt('ক্যামেরা কাজ না করলে কোড লিখুন (EMP-01)', 'If the camera fails, enter code (EMP-01)')"
                  class="flex-1 border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-teal-400">
                <button (click)="checkInByCode()" class="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg cursor-pointer">{{ prefs.txt('হাজিরা দিন', 'Mark attendance') }}</button>
              } @else {
                <button (click)="captureFace()" [disabled]="!faceStaffId || !!camError()"
                  class="flex-1 inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer">
                  <mat-icon class="text-base">photo_camera</mat-icon> {{ prefs.txt('ছবি তুলে হাজিরা দিন', 'Take photo & mark attendance') }}
                </button>
              }
            </div>
          </div>
        </div>
      </div>
    }

    <!-- Attendance station QR -->
    @if (stationQrOpen()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3" (click)="stationQrOpen.set(false)">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden text-slate-800" (click)="$event.stopPropagation()">
          <div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <p class="font-bold text-sm">{{ prefs.txt('হাজিরা স্টেশন QR', 'Attendance station QR') }}</p>
              <p class="text-[10px] text-slate-500">{{ prefs.txt('প্রিন্ট করে দোকানের দরজার পাশে লাগিয়ে দিন', 'Print and post it next to the shop door') }}</p>
            </div>
            <button (click)="stationQrOpen.set(false)" class="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full cursor-pointer">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>

          <div class="p-4">
            <!-- Capture happens on this padded wrapper: html-to-image rounds the
                 element's size to whole CSS pixels, so without the margin the
                 export would shave the card's border. The margin is trimmed back
                 off, leaving the card at its true millimetre size. Centring is
                 done by the flex parent because a frozen margin-auto would
                 shift the card inside the capture. -->
            <div class="flex justify-center">
              <div #stationCapture class="bg-white p-4">
                <div #stationSheet id="printable-area" class="station-sheet mx-auto w-[76mm] bg-white rounded-xl border border-slate-300 px-4 py-4 text-center">
                  <p class="text-[9px] font-black uppercase tracking-[0.2em] text-indigo-700">{{ prefs.txt('হাজিরা স্টেশন', 'ATTENDANCE STATION') }}</p>
                  <p class="text-sm font-black text-slate-900 mt-0.5">{{ shopName() }}</p>
                  <img #stationQrImg [src]="stationQr()" class="mx-auto mt-2 w-[52mm] h-[52mm]" [alt]="prefs.txt('হাজিরা স্টেশন QR', 'Attendance station QR')" decoding="sync">
                  <p class="text-[9px] font-semibold text-slate-600 mt-2 leading-snug">{{ prefs.txt('মোবাইল ক্যামেরায় স্ক্যান করুন → নিজের নাম বেছে মুখ দেখান → প্রতিবার স্ক্যানে পরের ধাপ সেভ হয়', 'Scan with the phone camera → pick your name → show your face → each scan saves the next step') }}</p>
                  <p class="mt-2 text-[10px] font-mono font-black text-indigo-700 bg-indigo-50 rounded px-2 py-1 inline-block">{{ stationToken() }}</p>
                  <p class="mt-1 text-[8px] font-mono text-slate-400 break-all leading-tight">{{ stationUrl() }}</p>
                </div>
              </div>
            </div>

            <div class="mt-3 flex items-end gap-2">
              <label class="flex-1">
                <span class="block text-[10px] font-bold text-slate-600 mb-1">{{ prefs.txt('স্টেশন কোড', 'Station code') }}</span>
                <input [(ngModel)]="stationTokenInput" (keyup.enter)="saveStationToken()"
                  class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-indigo-500">
              </label>
              <button (click)="saveStationToken()" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer">{{ prefs.txt('সেভ', 'Save') }}</button>
            </div>
            <p class="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">{{ prefs.txt('কোড বদলালে পুরোনো প্রিন্ট করা QR আর কাজ করবে না — নতুন QR প্রিন্ট করতে হবে।', 'Changing the code disables every QR printed before it — print the new one.') }}</p>
            @if (stationLocalOrigin()) {
              <p class="text-[10px] text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-2.5 py-1.5 mt-2 font-semibold">{{ prefs.txt('এই QR লোকাল/ল্যান ঠিকানার — কর্মচারীর ফোনে খুলবে না। ডিপ্লয় করা সাইট থেকে QR খুলে প্রিন্ট/ডাউনলোড করুন।', 'This QR uses a local/LAN address — it will not open on employee phones. Open the deployed site and print/download the QR from there.') }}</p>
            }
            @if (stationCloud() === 'error') {
              <p class="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-center gap-2">
                <span class="flex-1">{{ prefs.txt('স্টেশন ক্লাউডে সেভ হয়নি — কর্মচারীর ফোনে QR কাজ করবে না। অ্যাডমিন অ্যাকাউন্টে লগইন ও ইন্টারনেট দেখুন।', 'The station was not saved to cloud — the QR will not work on employee phones. Check the admin login and internet.') }}</span>
                <button type="button" (click)="registerStation()" class="shrink-0 px-2 py-1 rounded-md bg-rose-600 text-white font-bold cursor-pointer">{{ prefs.txt('আবার চেষ্টা', 'Retry') }}</button>
              </p>
            } @else if (stationCloud() === 'saved') {
              <p class="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 mt-2">{{ prefs.txt('QR ক্লাউডে সক্রিয় — কর্মচারীর ফোনে স্ক্যান করলেই ক্যামেরা খুলবে।', 'QR is active in cloud — scanning it on an employee phone opens the camera.') }}</p>
            }
          </div>

          <div class="bg-slate-50 px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="downloadStationQr()" class="px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-sm">download</mat-icon> PNG
            </button>
            <button (click)="downloadStationPdf()" class="px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-sm">picture_as_pdf</mat-icon> PDF
            </button>
            <button (click)="printStationQr()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-sm">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Manual entry -->
    @if (manualOpen()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3" (click)="closeManual()">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden text-slate-800" (click)="$event.stopPropagation()">
          <div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <p class="font-bold text-sm">{{ editingId() ? prefs.txt('হাজিরা সম্পাদনা', 'Edit attendance') : prefs.txt('ম্যানুয়াল হাজিরা', 'Manual attendance') }}</p>
            <button (click)="closeManual()" class="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full cursor-pointer">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>
          <div class="p-4 space-y-3">
            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('কর্মচারী', 'Employee') }}</label>
              <select [(ngModel)]="formStaffId" [disabled]="!!editingId()"
                class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-slate-100">
                @for (s of activeStaff(); track s.id) {
                  <option [ngValue]="s.id">{{ s.name }} ({{ s.code }})</option>
                }
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('তারিখ', 'Date') }}</label>
                <input type="date" [(ngModel)]="formDate" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</label>
                <select [(ngModel)]="formStatus" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
                  <option value="Present">{{ prefs.txt('উপস্থিত', 'Present') }}</option>
                  <option value="Late">{{ prefs.txt('দেরি', 'Late') }}</option>
                  <option value="Leave">{{ prefs.txt('ছুটি', 'Leave') }}</option>
                  <option value="Absent">{{ prefs.txt('অনুপস্থিত', 'Absent') }}</option>
                </select>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ইন টাইম', 'In time') }}</label>
                <input type="time" [(ngModel)]="formTimeIn" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('খাবার আউট', 'Lunch out') }}</label>
                <input type="time" [(ngModel)]="formLunchOut" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('খাবার ফেরা', 'Back from lunch') }}</label>
                <input type="time" [(ngModel)]="formLunchIn" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('আউট টাইম', 'Out time') }}</label>
                <input type="time" [(ngModel)]="formTimeOut" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold outline-none">
              </div>
            </div>
            <div>
              <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('নোট', 'Note') }}</label>
              <input [(ngModel)]="formNote" [placeholder]="prefs.txt('কারণ / মন্তব্য', 'Reason / comment')" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs outline-none">
            </div>
          </div>
          <div class="bg-slate-50 px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button (click)="closeManual()" class="px-4 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
            <button (click)="saveManual()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-sm">save</mat-icon> {{ prefs.txt('সংরক্ষণ', 'Save') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (viewPhoto(); as photo) {
      <div class="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4" (click)="viewPhoto.set(null)">
        <img [src]="photo" class="max-h-[80vh] max-w-full rounded-xl shadow-2xl" [alt]="prefs.txt('হাজিরার ছবি', 'Attendance photo')" loading="lazy" decoding="async">
      </div>
    }
  `
})
export class HrmAttendance implements OnDestroy {
  data = inject(DataService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private cloud = inject(CloudService);
  prefs = inject(PreferencesService);
  session = inject(SessionService);

  @ViewChild('cam') private camRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('stationCapture') private stationCaptureRef?: ElementRef<HTMLElement>;
  @ViewChild('stationSheet') private stationSheetRef?: ElementRef<HTMLElement>;
  @ViewChild('stationQrImg') private stationQrImgRef?: ElementRef<HTMLImageElement>;

  readonly date = signal(localDateIso());
  readonly officeStart = persistedSignal<string>('sm_attendance_start_v1', '09:15', v => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : '09:15');
  readonly statusFilter = signal<'All' | 'Present' | 'Late' | 'Leave' | 'Absent'>('All');
  readonly searchQuery = signal('');
  readonly activeStaff = computed(() => this.data.hrmStaff().filter(s => s.status !== 'Inactive'));

  readonly stats = computed(() => {
    const rows = this.data.attendance().filter(a => a.date === this.date());
    const present = rows.filter(a => a.status === 'Present').length;
    const late = rows.filter(a => a.status === 'Late').length;
    const leave = rows.filter(a => a.status === 'Leave').length;
    const marked = new Set(rows.map(a => a.staffId));
    // Explicitly absent rows (e.g. unpaid leave) plus employees with no row.
    const explicitAbsent = new Set(rows.filter(a => a.status === 'Absent').map(a => a.staffId));
    const absent = explicitAbsent.size + this.activeStaff().filter(s => !marked.has(s.id)).length;
    return { present, late, leave, absent };
  });

  readonly filtered = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    return this.data.attendance()
      .filter(a => a.date === this.date())
      .filter(a => status === 'All' || a.status === status)
      .filter(a => !q || `${a.staffName} ${a.staffCode}`.toLowerCase().includes(q))
      .sort((a, b) => (b.timeIn || '').localeCompare(a.timeIn || ''));
  });

  readonly pager = createPager<AttendanceRecord>(() => this.filtered());

  readonly statusTabs = computed<{ value: 'All' | AttendanceRecord['status']; label: string }[]>(() => [
    { value: 'All', label: this.prefs.txt('সব', 'All') },
    { value: 'Present', label: this.prefs.txt('উপস্থিত', 'Present') },
    { value: 'Late', label: this.prefs.txt('দেরি', 'Late') },
    { value: 'Leave', label: this.prefs.txt('ছুটি', 'Leave') },
    { value: 'Absent', label: this.prefs.txt('অনুপস্থিত', 'Absent') }
  ]);

  // scanner
  readonly scannerOpen = signal(false);
  readonly scanMode = signal<'QR' | 'Face'>('QR');
  readonly camError = signal('');
  readonly faceStaffId = signal<number | null>(null);
  readonly viewPhoto = signal<string | null>(null);
  manualCode = '';
  private stream?: MediaStream;
  private detector: any;
  private scanTimer?: ReturnType<typeof setTimeout>;

  // attendance station (printed QR that employees scan with their own phone)
  readonly stationToken = persistedSignal<string>(
    'sm_attendance_station_v1',
    'SM-STATION-01',
    v => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : 'SM-STATION-01')
  );
  readonly stationQrOpen = signal(false);
  readonly stationDetected = signal(false);
  stationTokenInput = '';
  readonly shopName = computed(() => {
    const s = this.data.voucherSettings();
    return `${s.businessNamePart1 || ''} ${s.businessNamePart2 || ''}`.trim() || 'SM Enterprise';
  });
  readonly stationUrl = computed(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/scan?station=${encodeURIComponent(this.stationToken())}`;
  });
  readonly stationQr = computed(() => qrDataUrl(this.stationUrl(), 512));
  readonly stationCloud = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** A QR printed from localhost or a LAN address cannot be scanned elsewhere. */
  readonly stationLocalOrigin = computed(() => {
    if (typeof window === 'undefined') return false;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0'
      || host.endsWith('.local') || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  });
  private stationReady = false;
  private staffPublishTimer?: ReturnType<typeof setTimeout>;
  private onOnline = () => {
    void this.registerStation();
    void this.refreshAttendanceFromCloud();
  };
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.refreshAttendanceFromCloud();
  };

  constructor() {
    // The printed QR opens on an employee's phone without a login, so the
    // station token has to be visible to the public page through Supabase.
    if (typeof window !== 'undefined') {
      setTimeout(() => void this.registerStation(), 800);
      // Station scans land in Supabase; pull them so they show up here.
      setTimeout(() => void this.refreshAttendanceFromCloud(), 1600);
      window.addEventListener('online', this.onOnline);
      document.addEventListener('visibilitychange', this.onVisible);
      effect(() => {
        const staff = this.data.hrmStaff();
        if (!this.stationReady || !staff.length) return;
        clearTimeout(this.staffPublishTimer);
        this.staffPublishTimer = setTimeout(() => void this.publishStaffSnapshot().catch(() => false), 1200);
      });
    }
    const requested = this.route.snapshot.queryParamMap.get('station');
    if (typeof window === 'undefined' || !requested) return;
    if (requested.trim().toUpperCase() !== this.stationToken()) return;
    // A self check-in link is meant to open the camera immediately.
    setTimeout(() => void this.openSelfCheckin(), 400);
  }

  // manual form
  readonly manualOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  formStaffId: number | null = null;
  formDate = localDateIso();
  formTimeIn = '';
  formLunchOut = '';
  formLunchIn = '';
  formTimeOut = '';
  formStatus: AttendanceRecord['status'] = 'Present';
  formNote = '';

  setDate(value: string) {
    this.date.set(value);
    this.pager.setPage(1);
  }

  setOfficeStart(value: string) {
    this.officeStart.set(value);
    void this.registerStation();
  }

  setStatus(value: 'All' | AttendanceRecord['status']) {
    this.statusFilter.set(value);
    this.pager.setPage(1);
  }

  setSearch(value: string) {
    this.searchQuery.set(value);
    this.pager.setPage(1);
  }

  initials(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  displayDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (value || '-');
  }

  statusLabel(status: AttendanceRecord['status']): string {
    const labels: Record<AttendanceRecord['status'], [string, string]> = {
      Present: ['উপস্থিত', 'Present'],
      Late: ['দেরি', 'Late'],
      Leave: ['ছুটি', 'Leave'],
      Absent: ['অনুপস্থিত', 'Absent']
    };
    const label = labels[status];
    return label ? this.prefs.txt(label[0], label[1]) : status;
  }

  statusBadge(status: AttendanceRecord['status']): string {
    const map: Record<AttendanceRecord['status'], string> = {
      Present: 'bg-emerald-100 text-emerald-800',
      Late: 'bg-amber-100 text-amber-800',
      Leave: 'bg-sky-100 text-sky-800',
      Absent: 'bg-rose-100 text-rose-800'
    };
    return map[status] || 'bg-slate-100 text-slate-700';
  }

  methodLabel(method: AttendanceRecord['method']): string {
    const labels: Record<AttendanceRecord['method'], [string, string]> = {
      QR: ['QR স্ক্যান', 'QR scan'],
      Face: ['ফেস', 'Face'],
      Manual: ['ম্যানুয়াল', 'Manual']
    };
    const label = labels[method];
    return label ? this.prefs.txt(label[0], label[1]) : method;
  }

  methodIcon(method: AttendanceRecord['method']): string {
    return { QR: 'qr_code_2', Face: 'face', Manual: 'edit' }[method] || 'edit';
  }

  methodBadge(method: AttendanceRecord['method']): string {
    return {
      QR: 'bg-teal-50 text-teal-700 border border-teal-200',
      Face: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      Manual: 'bg-slate-100 text-slate-600 border border-slate-200'
    }[method] || 'bg-slate-100 text-slate-600';
  }

  private nowTime(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private autoStatus(timeIn: string): AttendanceRecord['status'] {
    return timeIn > this.officeStart() ? 'Late' : 'Present';
  }

  checkInByCode() {
    const code = (this.manualCode || '').trim();
    if (!code) {
      this.notify.warning(this.prefs.txt('কর্মচারীর কোড লিখুন।', 'Enter the employee code.'));
      return;
    }
    const staff = this.findStaff(code);
    if (!staff) {
      this.notify.error(
        this.prefs.txt(`“${code}” কোডে কোনো কর্মচারী নেই।`, `No employee found for code “${code}”.`),
        this.prefs.txt('কর্মচারী পাওয়া যায়নি', 'Employee not found')
      );
      return;
    }
    this.markAttendance(staff, 'Manual');
  }

  private findStaff(token: string): HrmStaff | undefined {
    const value = (token || '').trim().toLowerCase();
    if (!value) return undefined;
    return this.activeStaff().find(s => (s.code || '').trim().toLowerCase() === value)
      ?? this.activeStaff().find(s => (s.name || '').trim().toLowerCase() === value);
  }

  private markAttendance(staff: HrmStaff, method: AttendanceRecord['method'], photo?: string) {
    const day = this.date();
    const time = this.nowTime();
    const existing = this.data.attendance().find(a => a.staffId === staff.id && a.date === day);
    const kind = nextPunch(existing);
    if (kind === 'done' && existing) {
      this.notify.info(this.prefs.txt(
        `${staff.name} আজকের চার ধাপের হাজিরা সম্পন্ন করেছেন (${existing.timeIn} – ${existing.timeOut})।`,
        `${staff.name} already completed today's attendance (${existing.timeIn} – ${existing.timeOut}).`
      ));
      this.finishScan();
      return;
    }
    if (kind === 'in' || !existing) {
      this.data.addAttendance({
        staffId: staff.id,
        staffCode: staff.code,
        staffName: staff.name,
        date: day,
        timeIn: time,
        lunchOut: '',
        lunchIn: '',
        timeOut: '',
        method,
        status: this.autoStatus(time),
        photo: photo || '',
        note: ''
      });
      this.notify.success(this.prefs.txt(
        `${staff.name} — চেক-ইন ${time} (${this.methodLabel(method)})`,
        `${staff.name} — checked in at ${time} (${this.methodLabel(method)})`
      ));
    } else {
      this.data.updateAttendance(existing.id, this.punchPatch(kind, time));
      this.notify.success(this.prefs.txt(
        `${staff.name} — ${this.punchLabel(kind)} ${time} (${this.methodLabel(method)})`,
        `${staff.name} — ${this.punchLabel(kind)} at ${time} (${this.methodLabel(method)})`
      ));
    }
    this.finishScan();
  }

  private punchPatch(kind: PunchKind, time: string): Partial<AttendanceRecord> {
    const field = punchField(kind);
    return field === 'lunchOut' ? { lunchOut: time } : field === 'lunchIn' ? { lunchIn: time } : { timeOut: time };
  }

  private punchLabel(kind: PunchKind): string {
    return {
      in: this.prefs.txt('চেক-ইন', 'checked in'),
      lunchOut: this.prefs.txt('খাবার আউট', 'lunch out'),
      lunchIn: this.prefs.txt('খাবার ফেরা', 'back from lunch'),
      out: this.prefs.txt('চেক-আউট', 'checked out'),
      done: this.prefs.txt('হাজিরা সম্পন্ন', 'attendance complete')
    }[kind];
  }

  private finishScan() {
    this.manualCode = '';
    this.pager.setPage(1);
    this.closeScanner();
  }

  async openScanner(mode: 'QR' | 'Face') {
    if (mode === 'Face' && !this.faceStaffId()) {
      this.notify.warning(
        this.prefs.txt('আগে কর্মচারী নির্বাচন করুন।', 'Select an employee first.'),
        this.prefs.txt('কর্মচারী নির্বাচন', 'Select employee')
      );
      return;
    }
    this.stationDetected.set(false);
    this.scanMode.set(mode);
    this.camError.set('');
    this.scannerOpen.set(true);
    await new Promise(resolve => setTimeout(resolve, 60));
    await this.startCamera(mode);
  }

  /** Self check-in from the printed station QR: staff picks their own name, no pre-selection. */
  async openSelfCheckin() {
    const staff = this.activeStaff();
    if (!staff.length) {
      this.notify.warning(
        this.prefs.txt('আগে কর্মচারী যোগ করুন।', 'Add an employee first.'),
        this.prefs.txt('কর্মচারী নেই', 'No employees')
      );
      return;
    }
    this.faceStaffId.set(staff.length === 1 ? staff[0].id : null);
    this.stationDetected.set(true);
    this.scanMode.set('Face');
    this.camError.set('');
    this.scannerOpen.set(true);
    await new Promise(resolve => setTimeout(resolve, 60));
    await this.startCamera('Face');
  }

  private stopStream() {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = undefined;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = undefined;
    this.detector = undefined;
  }

  private async startCamera(mode: 'QR' | 'Face') {
    const video = this.camRef?.nativeElement;
    if (!video) return;
    this.stopStream();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      this.stream = await navigator.mediaDevices.getUserMedia({
        // QR reading needs the rear camera, but a selfie must use the front one.
        video: { facingMode: { ideal: mode === 'Face' ? 'user' : 'environment' }, width: { ideal: 1280 } },
        audio: false
      });
      video.srcObject = this.stream;
      await video.play();
      if (mode === 'QR') this.startQrLoop(video);
    } catch {
      this.camError.set(this.prefs.txt(
        'ক্যামেরা চালু করা যায়নি। অনুমতি দিন, অথবা নিচের বক্সে কোড লিখে হাজিরা দিন।',
        'Camera could not start. Allow permission, or use the code box below to mark attendance.'
      ));
    }
  }

  private startQrLoop(video: HTMLVideoElement) {
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) {
      this.camError.set(this.prefs.txt(
        'এই ব্রাউজারে QR স্ক্যানার নেই — কোড লিখে হাজিরা দিন।',
        'This browser has no QR scanner — enter the code to mark attendance.'
      ));
      return;
    }
    try {
      this.detector = new Detector({ formats: ['qr_code'] });
    } catch {
      this.camError.set(this.prefs.txt(
        'QR স্ক্যানার চালু হয়নি — কোড লিখে হাজিরা দিন।',
        'QR scanner could not start — enter the code to mark attendance.'
      ));
      return;
    }
    let stationHandled = false;
    const tick = async () => {
      if (!this.scannerOpen()) return;
      try {
        const codes = await this.detector.detect(video);
        if (codes?.length) {
          const raw = String(codes[0].rawValue || '').trim();
          if (!stationHandled && this.isStationCode(raw)) {
            stationHandled = true;
            await this.enterStationMode();
            return;
          }
          const staff = this.findStaff(raw);
          if (staff) {
            this.markAttendance(staff, 'QR');
            return;
          }
          this.notify.warning(this.prefs.txt(
            `স্ক্যান হয়েছে “${raw}” — এই কোডে কর্মচারী নেই।`,
            `Scanned “${raw}” — no employee matches this code.`
          ));
        }
      } catch {
        // frame not ready yet; try again
      }
      this.scanTimer = setTimeout(tick, 450);
    };
    void tick();
  }

  private isStationCode(raw: string): boolean {
    const token = this.stationToken().trim().toLowerCase();
    if (!token || !raw) return false;
    if (raw.startsWith('http')) {
      const match = /[?&]station=([^&\s]+)/i.exec(raw);
      return !!match && decodeURIComponent(match[1]).trim().toLowerCase() === token;
    }
    return raw.trim().toLowerCase() === token;
  }

  /** Station QR declares "this device is the attendance kiosk" — switch to a front-camera selfie. */
  private async enterStationMode() {
    this.stopStream();
    this.stationDetected.set(true);
    this.scanMode.set('Face');
    this.camError.set('');
    const staff = this.activeStaff();
    this.faceStaffId.set(staff.length === 1 ? staff[0].id : null);
    this.notify.info(
      this.prefs.txt('স্টেশন QR শনাক্ত হয়েছে — নিজের নাম বেছে মুখ দেখান।', 'Station QR detected — pick your name and show your face.'),
      this.prefs.txt('ফেস হাজিরা', 'Face attendance')
    );
    await new Promise(resolve => setTimeout(resolve, 80));
    await this.startCamera('Face');
  }

  openStationQr() {
    this.stationTokenInput = this.stationToken();
    this.stationQrOpen.set(true);
    // Re-publish at print time so the staff snapshot matches what is printed.
    void this.registerStation();
  }

  saveStationToken() {
    const clean = (this.stationTokenInput || '').trim().toUpperCase().replace(/\s+/g, '-');
    if (clean.length < 4) {
      this.notify.warning(
        this.prefs.txt('স্টেশন কোড অন্তত ৪ অক্ষরের হতে হবে।', 'The station code must be at least 4 characters.'),
        this.prefs.txt('কোড ছোট', 'Code too short')
      );
      return;
    }
    this.stationToken.set(clean);
    this.stationTokenInput = clean;
    void this.registerStation();
    this.notify.success(this.prefs.txt('স্টেশন QR আপডেট হয়েছে।', 'Station QR updated.'));
  }

  /**
   * Publishes the station token and a public-safe employee snapshot so the
   * /scan page can work without exposing full staff profiles (salary, phone).
   */
  async registerStation(): Promise<void> {
    if (!this.cloud.isEnabled() || !this.cloud.hasUserKey()) {
      this.stationCloud.set('error');
      return;
    }
    this.stationCloud.set('saving');
    try {
      const ok = await this.cloud.upsertPublicRow('sm_attendance_settings_v1', 'station', {
        id: 'station',
        token: this.stationToken(),
        shopName: this.shopName(),
        officeStart: this.officeStart(),
        updatedAt: new Date().toISOString()
      });
      if (ok) this.stationReady = true;
      const staffOk = ok ? await this.publishStaffSnapshot() : false;
      this.stationCloud.set(ok && staffOk ? 'saved' : 'error');
    } catch {
      this.stationCloud.set('error');
    }
  }

  private async publishStaffSnapshot(): Promise<boolean> {
    const staff = this.activeStaff().map(s => ({
      id: s.id,
      code: s.code || '',
      name: s.name,
      designation: s.designation || '',
      status: s.status
    }));
    return this.cloud.upsertPublicRow('sm_attendance_settings_v1', 'staff', {
      id: 'staff',
      staff,
      updatedAt: new Date().toISOString()
    });
  }

  /** Station-written attendance arrives through Supabase, not this device. */
  private async refreshAttendanceFromCloud(): Promise<void> {
    if (!this.cloud.isEnabled() || !this.cloud.hasUserKey()) return;
    try {
      await this.cloud.pullCollection('sm_attendance_v1');
    } catch {
      /* offline — the background sync catches up later */
    }
  }

  printStationQr() {
    window.print();
  }

  async downloadStationQr() {
    const wrap = this.stationCaptureRef?.nativeElement;
    const sheet = this.stationSheetRef?.nativeElement;
    if (!wrap || !sheet) return;
    try {
      const { canvas } = await this.stationSheetCanvas(wrap, sheet, this.stationQrImgRef?.nativeElement);
      const link = document.createElement('a');
      link.href = pngWithDpi(canvas.toDataURL('image/png'), STATION_DPI);
      link.download = `attendance-station-${this.stationToken()}.png`;
      link.click();
      this.notify.success(this.prefs.txt('স্টেশন QR ছবি ডাউনলোড হয়েছে।', 'Station QR image downloaded.'));
    } catch {
      this.notify.error(this.prefs.txt('ছবি তৈরি করা যায়নি — প্রিন্ট ব্যবহার করুন।', 'Could not create the image — use Print instead.'));
    }
  }

  async downloadStationPdf() {
    const wrap = this.stationCaptureRef?.nativeElement;
    const sheet = this.stationSheetRef?.nativeElement;
    if (!wrap || !sheet) return;
    try {
      const { canvas, widthMm, heightMm } = await this.stationSheetCanvas(wrap, sheet, this.stationQrImgRef?.nativeElement);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const x = Math.max(0, (pageW - widthMm) / 2);
      const y = Math.max(0, (pageH - heightMm) / 2);
      // The same millimetres the PNG carries in its DPI tag, so both exports
      // print the card at exactly the same size.
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, widthMm, heightMm);
      pdf.save(`attendance-station-${this.stationToken()}.pdf`);
      this.notify.success(this.prefs.txt('স্টেশন QR PDF ডাউনলোড হয়েছে।', 'Station QR PDF downloaded.'));
    } catch {
      this.notify.error(this.prefs.txt('PDF তৈরি করা যায়নি — প্রিন্ট ব্যবহার করুন।', 'Could not create the PDF — use Print instead.'));
    }
  }

  /**
   * The card is laid out in millimetres, so the export has to land on whole
   * printer pixels: capture the padded wrapper (never the card itself — passing
   * width/height to html-to-image would resize the card and cut its border),
   * crop to the card's ink, then rescale to the exact 300 DPI width. The QR is
   * redrawn from its matrix afterwards so the modules stay razor sharp.
   */
  private async stationSheetCanvas(wrap: HTMLElement, sheet: HTMLElement, qr?: HTMLImageElement): Promise<{ canvas: HTMLCanvasElement; widthMm: number; heightMm: number }> {
    await document.fonts?.ready;
    if (qr && !qr.complete) await qr.decode().catch(() => undefined);
    // One rendered frame after the font/image work, before measuring.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    const shot = await htmlToImage.toPng(wrap, {
      pixelRatio: STATION_DPI / 96,
      cacheBust: false,
      backgroundColor: '#ffffff'
    });
    const image = await this.loadImage(shot);

    const bitmap = document.createElement('canvas');
    bitmap.width = image.naturalWidth;
    bitmap.height = image.naturalHeight;
    const bctx = bitmap.getContext('2d', { willReadFrequently: true });
    if (!bctx) throw new Error('canvas unavailable');
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(0, 0, bitmap.width, bitmap.height);
    bctx.drawImage(image, 0, 0);

    const ink = this.inkBounds(bctx, bitmap.width, bitmap.height);
    // The bitmap is the wrapper at 300 DPI; measure the card itself to know the
    // physical width it was drawn at (w-[76mm] in the template).
    const cardWidth = sheet.getBoundingClientRect().width;
    const widthPx = Math.round(cardWidth * STATION_DPI / 96);
    const heightPx = Math.round(ink.height * widthPx / ink.width);

    const out = document.createElement('canvas');
    out.width = widthPx;
    out.height = heightPx;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, ink.left, ink.top, ink.width, ink.height, 0, 0, widthPx, heightPx);

    // The screenshot enlarged the 512px source and blurs the modules; drawing
    // the matrix ourselves keeps the QR sharp at print resolution.
    if (qr) {
      const scale = image.naturalWidth / Math.max(1, wrap.clientWidth);
      const wrapRect = wrap.getBoundingClientRect();
      const box = qr.getBoundingClientRect();
      const k = widthPx / ink.width;
      this.drawQr(ctx, this.stationUrl(), {
        x: (box.left - wrapRect.left) * scale * k - ink.left * k,
        y: (box.top - wrapRect.top) * scale * k - ink.top * k,
        w: box.width * scale * k,
        h: box.height * scale * k
      }, Math.max(2, box.width * scale * k * 0.02));
    }

    return { canvas: out, widthMm: widthPx / STATION_DPI * 25.4, heightMm: heightPx / STATION_DPI * 25.4 };
  }

  /** Non-white pixel bounds: the card's border, without the capture padding. */
  private inkBounds(ctx: CanvasRenderingContext2D, width: number, height: number): { left: number; top: number; width: number; height: number } {
    const pixels = ctx.getImageData(0, 0, width, height).data;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (pixels[i] > 250 && pixels[i + 1] > 250 && pixels[i + 2] > 250) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < 0 || bottom < 0) return { left: 0, top: 0, width, height };
    return { left, top, width: right - left + 1, height: bottom - top + 1 };
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = src;
    });
  }

  private drawQr(ctx: CanvasRenderingContext2D, text: string, box: { x: number; y: number; w: number; h: number }, bleed = 0): void {
    const matrix = qrMatrix(text, 'M');
    const quiet = 4;
    const modules = matrix.length + quiet * 2;
    // Snap each module edge to a device pixel: the symbol fills its printed box
    // exactly and neighbouring modules never leave a hairline gap.
    const cell = Math.min(box.w, box.h) / modules;
    const size = cell * modules;
    const left = box.x + (box.w - size) / 2;
    const top = box.y + (box.h - size) / 2;
    ctx.fillStyle = '#ffffff';
    // A little bleed erases the blurry screenshot underneath the redrawn symbol.
    ctx.fillRect(box.x - bleed, box.y - bleed, box.w + bleed * 2, box.h + bleed * 2);
    ctx.fillStyle = '#0f172a';
    for (let r = 0; r < matrix.length; r++) {
      const y0 = Math.round(top + (r + quiet) * cell);
      const y1 = Math.round(top + (r + quiet + 1) * cell);
      for (let c = 0; c < matrix.length; c++) {
        if (!matrix[r][c]) continue;
        const x0 = Math.round(left + (c + quiet) * cell);
        const x1 = Math.round(left + (c + quiet + 1) * cell);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }

  captureFace() {
    const staff = this.activeStaff().find(s => s.id === this.faceStaffId());
    const video = this.camRef?.nativeElement;
    if (!staff || !video || !video.videoWidth) {
      this.notify.warning(this.prefs.txt('ক্যামেরা প্রস্তুত নয়, আবার চেষ্টা করুন।', 'Camera is not ready — please try again.'));
      return;
    }
    this.detectFace(video).then(found => {
      if (found === false) {
        this.notify.warning(
          this.prefs.txt('ছবিতে মুখ শনাক্ত হয়নি — ক্যামেরার দিকে তাকিয়ে আবার চেষ্টা করুন।', 'No face detected — look at the camera and try again.'),
          this.prefs.txt('মুখ শনাক্ত হয়নি', 'Face not detected')
        );
        return;
      }
      this.markAttendance(staff, 'Face', this.snapshot(video));
    });
  }

  /** Stock Chrome lacks FaceDetector, so "unknown" still keeps the photo as proof. */
  private async detectFace(video: HTMLVideoElement): Promise<boolean | null> {
    const Detector = (window as any).FaceDetector;
    if (!Detector) return null;
    try {
      const faces = await new Detector({ fastMode: true }).detect(video);
      return (faces?.length || 0) > 0;
    } catch {
      return null;
    }
  }

  private snapshot(video: HTMLVideoElement): string {
    const width = Math.min(320, video.videoWidth || 320);
    const height = Math.round(width * ((video.videoHeight || 240) / (video.videoWidth || 320)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.6);
  }

  closeScanner() {
    this.stopStream();
    this.stationDetected.set(false);
    this.scannerOpen.set(false);
  }

  ngOnDestroy() {
    clearTimeout(this.staffPublishTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    this.closeScanner();
  }

  openManual(record?: AttendanceRecord) {
    this.editingId.set(record?.id ?? null);
    this.formStaffId = record?.staffId ?? this.activeStaff()[0]?.id ?? null;
    this.formDate = record?.date ?? this.date();
    this.formTimeIn = record?.timeIn ?? this.nowTime();
    this.formLunchOut = record?.lunchOut ?? '';
    this.formLunchIn = record?.lunchIn ?? '';
    this.formTimeOut = record?.timeOut ?? '';
    this.formStatus = record?.status ?? 'Present';
    this.formNote = record?.note ?? '';
    this.manualOpen.set(true);
  }

  closeManual() {
    this.manualOpen.set(false);
  }

  saveManual() {
    const staff = this.activeStaff().find(s => s.id === this.formStaffId)
      ?? this.data.hrmStaff().find(s => s.id === this.formStaffId);
    if (!staff) {
      this.notify.warning(this.prefs.txt('কর্মচারী নির্বাচন করুন।', 'Select an employee.'));
      return;
    }
    const payload = {
      staffId: staff.id,
      staffCode: staff.code,
      staffName: staff.name,
      date: this.formDate,
      timeIn: this.formTimeIn,
      lunchOut: this.formLunchOut,
      lunchIn: this.formLunchIn,
      timeOut: this.formTimeOut,
      method: 'Manual' as const,
      status: this.formStatus,
      note: (this.formNote || '').trim()
    };
    const id = this.editingId();
    if (id) {
      this.data.updateAttendance(id, payload);
      this.notify.success(this.prefs.txt('হাজিরা আপডেট হয়েছে।', 'Attendance updated.'));
    } else {
      this.data.addAttendance({ ...payload, photo: '' });
      this.notify.success(this.prefs.txt(`${staff.name} — হাজিরা সংরক্ষিত হয়েছে।`, `${staff.name} — attendance saved.`));
    }
    this.manualOpen.set(false);
    this.pager.setPage(1);
  }

  async remove(record: AttendanceRecord) {
    const ok = await this.notify.confirm(
      this.prefs.txt(
        `${record.staffName} — ${this.displayDate(record.date)} তারিখের হাজিরা মুছে যাবে।`,
        `${record.staffName} — the attendance for ${this.displayDate(record.date)} will be deleted.`
      ),
      {
        title: this.prefs.txt('হাজিরা মুছবেন?', 'Delete attendance?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছুন', 'Delete')
      }
    );
    if (!ok) return;
    this.data.deleteAttendance(record.id);
    this.notify.success(this.prefs.txt('হাজিরা মুছে ফেলা হয়েছে।', 'Attendance deleted.'));
  }
}
