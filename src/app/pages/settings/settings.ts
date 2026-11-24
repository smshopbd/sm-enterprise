import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { downloadWorkbook } from '../../utils/spreadsheet';
import { DataService, UnitOption } from '../../services/data';
import { NotificationService } from '../../services/notification';
import {
  AUDIT_CATEGORIES, AuditCategory, Permission, SessionService, UserAccount, UserRole
} from '../../services/session';
import { AccentKey, PreferencesService, TableBorderMode, TableHoverTone, ThemeMode } from '../../services/preferences';
import { CloudService } from '../../services/cloud';
import type { CloudSyncConflict, SyncReport } from '../../services/cloud';
import { StorageService, BackupPayload } from '../../services/storage';
import { BackupService, CloudBackupEntry } from '../../services/backup';
import { IMAGE_MAX_PX, IMAGE_MAX_BYTES, MediaService } from '../../services/media';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';

type SettingsTab = 'business' | 'appearance' | 'warehouse' | 'units' | 'cloud' | 'backup' | 'users' | 'audit';

const PERMISSION_LABELS: { key: Permission; bn: string; en: string }[] = [
  { key: 'usePos', bn: 'POS ও বিক্রয়', en: 'POS & sales' },
  { key: 'editPrice', bn: 'বিক্রয়মূল্য / ডিসকাউন্ট পরিবর্তন', en: 'Edit sale price / discount' },
  { key: 'deleteRecords', bn: 'রেকর্ড ডিলিট', en: 'Delete records' },
  { key: 'viewReports', bn: 'রিপোর্ট দেখা', en: 'View reports' },
  { key: 'viewAccounts', bn: 'হিসাব ও লেজার দেখা', en: 'View accounts & ledger' },
  { key: 'cashClosing', bn: 'ক্যাশ ক্লোজিং', en: 'Daily cash closing' },
  { key: 'viewHrm', bn: 'HRM ও হাজিরা', en: 'HRM & attendance' },
  { key: 'manageUsers', bn: 'ইউজার পরিচালনা', en: 'Manage users' },
  { key: 'manageSettings', bn: 'সেটিংস ও ওয়্যারহাউজ পরিবর্তন', en: 'Change settings & warehouses' }
];

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination],
  template: `
    <div class="space-y-4 text-xs text-slate-800">

      <div class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>
        <div class="relative flex min-w-0 items-center gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <mat-icon class="text-xl">settings</mat-icon>
          </span>
          <div class="min-w-0">
            <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
              <span>{{ prefs.txt('সিস্টেম', 'System') }}</span>
              <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
              <span>{{ prefs.txt('সেটিংস', 'Settings') }}</span>
            </p>
            <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.t('settings.title') }}</h1>
            <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('ব্যবসার তথ্য, ব্যবহারকারী, ওয়্যারহাউস ও অ্যাপের পছন্দসমূহ পরিচালনা করুন।', 'Manage business info, users, warehouses and app preferences.') }}</p>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xs">
        @for (t of tabs; track t.key) {
          <button (click)="selectTab(t.key)"
            [class]="tab() === t.key
              ? 'border-teal-700 bg-teal-700 text-white shadow-xs'
              : 'border-transparent bg-slate-50 text-slate-600 hover:bg-slate-100'"
            class="shrink-0 px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer">
            {{ prefs.language() === 'bn' ? t.bn : t.en }}
          </button>
        }
      </div>

      @if (!session.canSee('settings')) {
        <div class="bg-white p-8 rounded-xl shadow-xs border border-slate-200 text-center">
          <mat-icon class="text-rose-500">lock</mat-icon>
          <p class="mt-2 font-bold text-slate-700">{{ prefs.t('settings.onlyAdmin') }}</p>
        </div>
      } @else {

        <!-- BUSINESS TAB -->
        @if (tab() === 'business') {
          <div class="bg-white p-5 rounded-xl shadow-xs border border-slate-200 space-y-4 max-w-2xl">
            <h3 class="font-bold text-sm text-slate-900 border-b border-slate-200 pb-2">{{ prefs.t('settings.business') }}</h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('settings.company') }}</label>
                <input type="text" [(ngModel)]="business.businessNamePart1" class="w-full border border-slate-300 rounded-lg p-2 font-bold text-teal-800">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('সংক্ষিপ্ত নাম', 'Short Name') }}</label>
                <input type="text" [(ngModel)]="business.businessNamePart2" class="w-full border border-slate-300 rounded-lg p-2 font-bold text-teal-800">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('common.phone') }}</label>
                <input type="text" [(ngModel)]="business.mobile" class="w-full border border-slate-300 rounded-lg p-2 font-mono">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('settings.email') }}</label>
                <input type="text" [(ngModel)]="business.email" class="w-full border border-slate-300 rounded-lg p-2 font-mono">
              </div>
              <div class="sm:col-span-2">
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('settings.address') }}</label>
                <textarea rows="2" [(ngModel)]="business.address" class="w-full border border-slate-300 rounded-lg p-2"></textarea>
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('settings.soldBy') }}</label>
                <input type="text" [(ngModel)]="business.soldBy" class="w-full border border-slate-300 rounded-lg p-2">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('settings.greeting') }}</label>
                <input type="text" [(ngModel)]="business.greetingText" class="w-full border border-slate-300 rounded-lg p-2">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('settings.term1') }}</label>
                <input type="text" [(ngModel)]="business.term1" class="w-full border border-slate-300 rounded-lg p-2">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('settings.term2') }}</label>
                <input type="text" [(ngModel)]="business.term2" class="w-full border border-slate-300 rounded-lg p-2">
              </div>
            </div>

            <div class="rounded-xl border border-sky-200 bg-sky-50/50 p-4 space-y-2">
              <h4 class="font-bold text-xs uppercase tracking-wide text-sky-800">{{ prefs.t('settings.sales') }}</h4>
              <label class="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" [(ngModel)]="business.allowWholesalePrice" class="mt-0.5 w-4 h-4 accent-sky-600 cursor-pointer">
                <span>
                  <span class="block font-bold text-slate-800">{{ prefs.t('settings.wholesale') }}</span>
                  <span class="block text-[11px] text-slate-500 mt-0.5">{{ prefs.t('settings.wholesaleHint') }}</span>
                </span>
              </label>
            </div>

            <div class="flex items-center gap-2 pt-1">
              <button (click)="saveBusiness()" class="bg-teal-600 hover:bg-teal-700 text-white font-bold px-5 py-2 rounded-lg cursor-pointer">
                {{ prefs.t('common.save') }}
              </button>
              <button (click)="resetBusiness()" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold px-4 py-2 rounded-lg cursor-pointer">
                {{ prefs.txt('রিসেট', 'Reset') }}
              </button>
              @if (savedMsg()) {
                <span class="text-emerald-600 font-semibold">{{ prefs.t('settings.saved') }}</span>
              }
            </div>
          </div>
        }

        <!-- APPEARANCE TAB -->
        @if (tab() === 'appearance') {
          <div class="max-w-3xl space-y-4">

            <!-- Accent -->
            <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 class="font-bold text-sm text-slate-900 dark:text-slate-100">{{ prefs.txt('অ্যাকসেন্ট রঙ', 'Accent color') }}</h3>
                  <p class="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('বাটন, হেডিং, টেবিল হেডার, সিলেক্ট করা সারি ও হাইলাইট — পুরো অ্যাপ একসাথে বদলে যাবে।', 'Buttons, headings, table headers, selected rows and highlights change across the whole app.') }}</p>
                </div>
                <span class="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[10px] font-bold text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                  <mat-icon class="text-[13px]">palette</mat-icon> {{ accentLabel(prefs.accent()) }}
                </span>
              </div>

              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                @for (accent of prefs.accents; track accent.key) {
                  <button type="button" (click)="pickAccent(accent.key)"
                    [attr.aria-pressed]="prefs.accent() === accent.key"
                    [class]="prefs.accent() === accent.key
                      ? 'border-teal-600 ring-2 ring-teal-500/25'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'"
                    class="overflow-hidden rounded-xl border-2 bg-white text-left transition cursor-pointer dark:bg-slate-900">
                    <span class="block h-10 w-full"
                      [style.background-image]="'linear-gradient(120deg,' + accent.shades['500'] + ',' + accent.shades['700'] + ')'"></span>
                    <span class="flex items-center justify-between gap-1 px-2.5 py-2">
                      <span class="truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">{{ accentLabel(accent.key) }}</span>
                      <mat-icon class="text-sm" [class]="prefs.accent() === accent.key ? 'text-teal-600 dark:text-teal-300' : 'text-slate-300 dark:text-slate-600'">check_circle</mat-icon>
                    </span>
                  </button>
                }
              </div>
            </section>

            <!-- Light / dark / system -->
            <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div class="mb-3">
                <h3 class="font-bold text-sm text-slate-900 dark:text-slate-100">{{ prefs.txt('অ্যাপিয়ারেন্স', 'Appearance') }}</h3>
                <p class="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('লাইট, ডার্ক অথবা ডিভাইসের সেটিং অনুযায়ী।', 'Light, dark, or follow your device.') }}</p>
              </div>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
                @for (mode of themeModes; track mode.key) {
                  <button type="button" (click)="chooseThemeMode(mode.key)"
                    [attr.aria-pressed]="prefs.themeMode() === mode.key"
                    [class]="prefs.themeMode() === mode.key
                      ? 'border-teal-600 bg-teal-50/70 ring-1 ring-teal-500/25 dark:bg-teal-950/30'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'"
                    class="flex items-start gap-2.5 rounded-xl border-2 p-3 text-left transition cursor-pointer">
                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      [class]="prefs.themeMode() === mode.key ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'">
                      <mat-icon class="text-base">{{ mode.icon }}</mat-icon>
                    </span>
                    <span class="min-w-0">
                      <span class="block text-[11.5px] font-bold text-slate-800 dark:text-slate-100">{{ prefs.txt(mode.bn, mode.en) }}</span>
                      <span class="mt-0.5 block text-[10px] leading-snug text-slate-500 dark:text-slate-400">{{ prefs.txt(mode.hintBn, mode.hintEn) }}</span>
                    </span>
                  </button>
                }
              </div>
            </section>

            <!-- Live preview -->
            <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
                <p class="font-bold text-sm text-slate-900 dark:text-slate-100">{{ prefs.txt('লাইভ প্রিভিউ', 'Live preview') }}</p>
                <span class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('রঙ বা মোড বদলালেই এখানে বদলে যাবে', 'Updates as soon as you change color or mode') }}</span>
              </div>
              <div class="bg-slate-50 p-3 dark:bg-slate-950">
                <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div class="flex items-center justify-between gap-2 bg-gradient-to-r from-teal-700 to-teal-500 px-3 py-2 text-white">
                    <span class="flex items-center gap-1.5 text-[11px] font-bold"><mat-icon class="text-sm">storefront</mat-icon> {{ prefs.t('app.name') }}</span>
                    <span class="rounded-full bg-white/20 px-2 py-0.5 text-[9px] font-bold">{{ themeModeLabel() }}</span>
                  </div>
                  <div class="space-y-2.5 p-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-bold text-white">{{ prefs.txt('প্রাইমারি বাটন', 'Primary button') }}</span>
                      <span class="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-[10px] font-bold text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">{{ prefs.txt('হালকা ব্যাজ', 'Soft badge') }}</span>
                      <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">{{ prefs.txt('পরিশোধিত', 'Paid') }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-900">
                      <span class="flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-600 dark:text-slate-300">
                        <mat-icon class="text-[14px] text-teal-600 dark:text-teal-300">receipt_long</mat-icon>
                        {{ prefs.txt('নমুনা ভাউচার', 'Sample voucher') }}
                      </span>
                      <span class="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-100">{{ prefs.txt('১,২৫০.০০', '1,250.00') }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- Data-table skin -->
            <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div class="mb-3 flex items-start gap-2">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  <mat-icon class="text-base">table_chart</mat-icon>
                </span>
                <div>
                  <h3 class="font-bold text-sm text-slate-900 dark:text-slate-100">{{ prefs.txt('ডাটা টেবিল স্টাইল', 'Data-table style') }}</h3>
                  <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('সব ডাটা টেবিলে একই হোভার ও বর্ডার প্রযোজ্য হবে। হোভারের রঙ অ্যাকসেন্ট থেকেই আসে।', 'Applies to every data table. The hover tint comes from your accent colour.') }}</p>
                </div>
              </div>

              <div class="space-y-3">
                <div>
                  <p class="mb-1.5 font-semibold text-slate-700 dark:text-slate-200">{{ prefs.txt('সারির হোভার শেড', 'Row hover shade') }}</p>
                  <div class="grid grid-cols-3 gap-2">
                    @for (tone of prefs.tableHoverTones; track tone.key) {
                      <button type="button" (click)="setTableHover(tone.key)"
                        [class]="prefs.tableHover() === tone.key
                          ? 'border-teal-600 bg-teal-50/70 ring-1 ring-teal-500/25 dark:bg-teal-950/30'
                          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'"
                        class="rounded-lg border-2 p-2 text-left transition cursor-pointer">
                        <span class="mb-1 block h-4 w-full rounded border border-slate-200/70 dark:border-slate-700" [style.background-color]="prefs.tableHoverSwatch(tone.key)"></span>
                        <span class="text-[11px] font-bold text-slate-700 dark:text-slate-200">{{ prefs.txt(tone.bn, tone.en) }}</span>
                      </button>
                    }
                  </div>
                </div>

                <div>
                  <p class="mb-1.5 font-semibold text-slate-700 dark:text-slate-200">{{ prefs.txt('বর্ডার সিস্টেম', 'Border system') }}</p>
                  <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    @for (mode of prefs.tableBorderModes; track mode.key) {
                      <button type="button" (click)="setTableBorder(mode.key)"
                        [class]="prefs.tableBorder() === mode.key
                          ? 'border-teal-600 bg-teal-50/70 ring-1 ring-teal-500/25 dark:bg-teal-950/30'
                          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'"
                        class="rounded-lg border-2 p-2 text-left transition cursor-pointer">
                        <span class="mb-1 flex h-4 items-center justify-center">
                          <span class="h-4 w-9 rounded" [class]="borderPreview(mode.key)"></span>
                        </span>
                        <span class="block text-[11px] font-bold text-slate-700 dark:text-slate-200">{{ prefs.txt(mode.bn, mode.en) }}</span>
                        <span class="block text-[9px] leading-tight text-slate-400 dark:text-slate-500">{{ prefs.txt(mode.hintBn, mode.hintEn) }}</span>
                      </button>
                    }
                  </div>
                </div>

                <div>
                  <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{{ prefs.txt('লাইভ প্রিভিউ — মাউস এনে দেখুন', 'Live preview — hover a row') }}</p>
                  <div class="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                    <table class="w-full text-left text-[11px]">
                      <thead>
                        <tr>
                          <th class="px-2.5 py-1.5">{{ prefs.txt('পার্টি', 'Party') }}</th>
                          <th class="px-2.5 py-1.5 text-right">{{ prefs.txt('বাকি', 'Due') }}</th>
                          <th class="px-2.5 py-1.5 text-center">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td class="px-2.5 py-1.5 font-semibold text-slate-800 dark:text-slate-100">{{ prefs.txt('রহিম ট্রেডার্স', 'Rahim Traders') }}</td>
                          <td class="px-2.5 py-1.5 text-right font-mono text-slate-700 dark:text-slate-200">{{ prefs.txt('২,৫০০.০০', '2,500.00') }}</td>
                          <td class="px-2.5 py-1.5 text-center text-slate-600 dark:text-slate-300">{{ prefs.txt('সক্রিয়', 'Active') }}</td>
                        </tr>
                        <tr>
                          <td class="px-2.5 py-1.5 font-semibold text-slate-800 dark:text-slate-100">{{ prefs.txt('করিম ব্যাটারি', 'Karim Battery') }}</td>
                          <td class="px-2.5 py-1.5 text-right font-mono text-slate-700 dark:text-slate-200">{{ prefs.txt('১,২০০.০০', '1,200.00') }}</td>
                          <td class="px-2.5 py-1.5 text-center text-slate-600 dark:text-slate-300">{{ prefs.txt('সক্রিয়', 'Active') }}</td>
                        </tr>
                        <tr>
                          <td class="px-2.5 py-1.5 font-semibold text-slate-800 dark:text-slate-100">{{ prefs.txt('নীলা এন্টারপ্রাইজ', 'Neela Enterprise') }}</td>
                          <td class="px-2.5 py-1.5 text-right font-mono text-slate-700 dark:text-slate-200">{{ prefs.txt('০.০০', '0.00') }}</td>
                          <td class="px-2.5 py-1.5 text-center text-slate-600 dark:text-slate-300">{{ prefs.txt('সক্রিয়', 'Active') }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('থিম শুধু এই ডিভাইসে সংরক্ষিত থাকে।', 'Theme preferences stay on this device.') }}</p>
                <button type="button" (click)="resetTheme()"
                  class="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                  <mat-icon class="text-sm">restart_alt</mat-icon> {{ prefs.txt('ডিফল্ট থিমে ফিরুন', 'Reset to default') }}
                </button>
              </div>
            </section>
          </div>
        }

        <!-- WAREHOUSE TAB -->
        @if (tab() === 'warehouse') {
          <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden max-w-3xl">
            <div class="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              <div>
                <h3 class="font-bold text-sm text-slate-900">{{ prefs.txt('ওয়্যারহাউস ব্যবস্থাপনা', 'Warehouse management') }}</h3>
                <p class="text-[10px] text-slate-500">{{ prefs.txt('নাম বদলালে পণ্যগুলোও নতুন নামে চলে যাবে।', 'Renaming moves the products to the new name.') }}</p>
              </div>
              <button (click)="addWarehouse()" [disabled]="!session.has('manageSettings')"
                class="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-xs">add</mat-icon> {{ prefs.txt('নতুন', 'New') }}
              </button>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-xs text-left">
                <thead class="bg-slate-50 text-slate-600 font-bold uppercase border-b border-slate-200">
                  <tr>
                    <th class="p-3">{{ prefs.txt('ওয়্যারহাউস', 'Warehouse') }}</th>
                    <th class="p-3">{{ prefs.txt('পণ্য', 'Products') }}</th>
                    <th class="p-3">{{ prefs.txt('স্টক ইউনিট', 'Stock units') }}</th>
                    <th class="p-3 text-center">{{ prefs.t('common.actions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (w of dataService.warehouses(); track w) {
                    <tr class="hover:bg-slate-50">
                      <td class="p-3 font-semibold text-slate-800">
                        <span class="inline-flex items-center gap-1.5">
                          <mat-icon class="text-sm text-teal-600">warehouse</mat-icon>{{ w }}
                        </span>
                      </td>
                      <td class="p-3 text-slate-600">{{ warehouseProductCount(w) }}</td>
                      <td class="p-3 text-slate-600">{{ warehouseStock(w) }}</td>
                      <td class="p-3 text-center whitespace-nowrap">
                        <button (click)="renameWarehouse(w)" [disabled]="!session.has('manageSettings')"
                          class="text-teal-600 hover:text-teal-800 p-1 disabled:opacity-30 cursor-pointer" [title]="prefs.txt('এডিট', 'Edit')">
                          <mat-icon class="text-xs">edit</mat-icon>
                        </button>
                        <button (click)="deleteWarehouse(w)" [disabled]="!session.has('manageSettings') || dataService.warehouses().length <= 1"
                          class="text-rose-600 hover:text-rose-800 p-1 disabled:opacity-30 cursor-pointer" [title]="prefs.txt('ডিলিট', 'Delete')">
                          <mat-icon class="text-xs">delete</mat-icon>
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="4" class="p-6 text-center text-slate-400">{{ prefs.t('common.noData') }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
            @if (!session.has('manageSettings')) {
              <p class="px-4 py-2 text-[10px] text-amber-700 bg-amber-50 border-t border-amber-200">{{ prefs.txt('ওয়্যারহাউস পরিবর্তনের অনুমতি নেই।', 'You do not have permission to change warehouses.') }}</p>
            }
          </div>
        }

        <!-- UNITS TAB -->
        @if (tab() === 'units') {
          <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden max-w-3xl">
            <div class="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              <div>
                <h3 class="font-bold text-sm text-slate-900">{{ prefs.txt('একক ব্যবস্থাপনা', 'Unit management') }}</h3>
                <p class="text-[10px] text-slate-500">{{ prefs.txt('নতুন পণ্যে ডিফল্ট এককটি আগেই বসে থাকে। নাম বদলালে পুরোনো পণ্যগুলোও নতুন নামে চলে যাবে।', 'The default unit is preselected on a new product. Renaming moves the existing products to the new name.') }}</p>
              </div>
              <button (click)="addUnit()" [disabled]="!session.has('manageSettings')"
                class="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-xs">add</mat-icon> {{ prefs.txt('নতুন', 'New') }}
              </button>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-xs text-left">
                <thead class="bg-slate-50 text-slate-600 font-bold uppercase border-b border-slate-200">
                  <tr>
                    <th class="p-3">{{ prefs.txt('একক', 'Unit') }}</th>
                    <th class="p-3">{{ prefs.txt('ডিফল্ট', 'Default') }}</th>
                    <th class="p-3">{{ prefs.txt('পণ্য', 'Products') }}</th>
                    <th class="p-3 text-center">{{ prefs.t('common.actions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (u of dataService.units(); track u.id) {
                    <tr class="hover:bg-slate-50">
                      <td class="p-3 font-semibold text-slate-800">
                        <span class="inline-flex items-center gap-1.5">
                          <mat-icon class="text-sm text-teal-600">straighten</mat-icon>{{ u.name }}
                        </span>
                      </td>
                      <td class="p-3">
                        @if (u.isDefault) {
                          <span class="inline-flex items-center gap-1 rounded-full bg-teal-50 border border-teal-200 px-2 py-0.5 text-[10px] font-bold text-teal-700">
                            <mat-icon style="font-size:12px;width:12px;height:12px;">check_circle</mat-icon>
                            {{ prefs.txt('ডিফল্ট', 'Default') }}
                          </span>
                        } @else {
                          <button (click)="setDefaultUnit(u)" [disabled]="!session.has('manageSettings')"
                            class="rounded-lg border border-slate-300 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer">
                            {{ prefs.txt('ডিফল্ট করুন', 'Make default') }}
                          </button>
                        }
                      </td>
                      <td class="p-3 text-slate-600">{{ dataService.unitProductCount(u.name) }}</td>
                      <td class="p-3 text-center whitespace-nowrap">
                        <button (click)="renameUnit(u)" [disabled]="!session.has('manageSettings')"
                          class="text-teal-600 hover:text-teal-800 p-1 disabled:opacity-30 cursor-pointer" [title]="prefs.txt('এডিট', 'Edit')">
                          <mat-icon class="text-xs">edit</mat-icon>
                        </button>
                        <button (click)="deleteUnit(u)" [disabled]="!session.has('manageSettings') || u.isDefault || dataService.units().length <= 1"
                          class="text-rose-600 hover:text-rose-800 p-1 disabled:opacity-30 cursor-pointer" [title]="prefs.txt('ডিলিট', 'Delete')">
                          <mat-icon class="text-xs">delete</mat-icon>
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="4" class="p-6 text-center text-slate-400">{{ prefs.t('common.noData') }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
            @if (!session.has('manageSettings')) {
              <p class="px-4 py-2 text-[10px] text-amber-700 bg-amber-50 border-t border-amber-200">{{ prefs.txt('একক পরিবর্তনের অনুমতি নেই।', 'You do not have permission to change units.') }}</p>
            }
          </div>
        }

        <!-- CLOUD & IMAGES TAB -->
        @if (tab() === 'cloud') {
          @if (!session.has('manageSettings')) {
            <div class="mb-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" role="status">
              <mat-icon class="text-sm shrink-0">lock</mat-icon>
              <span>{{ prefs.txt('ক্লাউড ও ছবির ঠিকানা বদলানো শুধু সেটিংস পরিবর্তনের অনুমতিপ্রাপ্ত ইউজার পারবেন — নিচের তথ্য দেখার জন্য।', 'Only users with the settings permission can change cloud and image configuration — details below are read-only.') }}</span>
            </div>
          }
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">

            <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
              <div class="px-4 py-3 bg-teal-700 text-white flex items-center justify-between">
                <div>
                  <h3 class="font-bold text-sm">Supabase — {{ prefs.txt('ক্লাউড ডাটাবেস', 'cloud database') }}</h3>
                  <p class="text-[10px] text-teal-100">{{ prefs.txt('সব কালেকশন সারি-ধরে সিঙ্ক হয়', 'Every collection syncs row by row') }}</p>
                </div>
                <span class="text-[10px] font-bold px-2 py-1 rounded-full"
                  [class]="cloud.status() === 'online' ? 'bg-emerald-500 text-white'
                    : cloud.status() === 'error' ? 'bg-rose-500 text-white'
                    : cloud.status() === 'connecting' ? 'bg-amber-400 text-amber-950' : 'bg-white/25 text-white'">
                  {{ cloud.status() === 'online' ? prefs.txt('অনলাইন', 'Online') : cloud.status() === 'error' ? prefs.txt('ত্রুটি', 'Error') : cloud.status() === 'connecting' ? prefs.txt('সংযোগ…', 'Connecting…') : prefs.txt('বন্ধ', 'Off') }}
                </span>
              </div>

              <div class="p-4 space-y-3">
                <label class="flex items-center gap-2 font-semibold text-slate-700">
                  <input type="checkbox" [(ngModel)]="cloudDraft.supabaseOn" [disabled]="!session.has('manageSettings')" class="w-4 h-4 accent-teal-600 disabled:opacity-50">
                  {{ prefs.txt('Supabase সিঙ্ক চালু', 'Enable Supabase sync') }}
                </label>
                <div>
                  <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('প্রজেক্ট URL', 'Project URL') }}</label>
                  <input type="text" [(ngModel)]="cloudDraft.url" placeholder="https://xxxxxxxx.supabase.co" [disabled]="!session.has('manageSettings')"
                    class="w-full border border-slate-300 rounded-lg p-2 font-mono text-[11px] disabled:cursor-not-allowed disabled:opacity-60">
                </div>
                <div>
                  <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('অ্যানন পাবলিক কী', 'Anon public key') }}</label>
                  <input type="password" [(ngModel)]="cloudDraft.anonKey" placeholder="eyJhbGciOi…" [disabled]="!session.has('manageSettings')"
                    class="w-full border border-slate-300 rounded-lg p-2 font-mono text-[11px] disabled:cursor-not-allowed disabled:opacity-60">
                </div>
                <div class="rounded-lg bg-teal-50 border border-teal-200 px-3 py-2 text-[11px] text-teal-800 leading-relaxed dark:bg-teal-950/40 dark:border-teal-800 dark:text-teal-200">
                  <mat-icon class="text-xs align-middle">lock</mat-icon>
                  {{ prefs.txt('ডাটাবেস এখন আপনার লগইন পাসওয়ার্ড দিয়েই সুরক্ষিত। আলাদা সিঙ্ক পাসকোড লাগবে না — যেকোনো ডিভাইসে শুধু লগইন করলেই কাজ করবে।', 'The database is now protected by your login password. No separate sync passcode is needed — sign in on any device.') }}
                </div>
                <p class="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {{ prefs.txt('URL ও anon key শুধু এই ডিভাইসে সংরক্ষিত থাকে — ফাইল ব্যাকআপেও যায় না। প্রজেক্ট বদলালে প্রতিটি ডিভাইসে আলাদা করে বসাতে হবে। কখনও service_role key ব্যবহার করবেন না।', 'The URL and anon key are stored on this device only and are excluded from file backups. A new project must be entered on each device. Never use the service_role key.') }}
                </p>

                <div class="flex flex-wrap items-center gap-2 pt-1">
                  <button (click)="saveCloud('supabase')" [disabled]="!session.has('manageSettings')" class="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-4 py-2 rounded-lg cursor-pointer">{{ prefs.txt('সেভ', 'Save') }}</button>
                  <button (click)="testCloud('supabase')" [disabled]="cloudTest().busy || !session.has('manageSettings')"
                    class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50">
                    {{ prefs.txt('সংযোগ পরীক্ষা', 'Test connection') }}
                  </button>
                  <button (click)="runSync('push')" [disabled]="cloudSync().busy || conflictBusy() || !cloud.isEnabled() || cloud.syncConflicts().length || cloud.restoreIntent() || !session.has('manageSettings')"
                    class="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-2 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                    {{ prefs.txt('সব আপলোড', 'Upload all') }} (Push)
                  </button>
                  <button (click)="runSync('pull')" [disabled]="cloudSync().busy || conflictBusy() || !cloud.isEnabled() || cloud.restoreIntent() || !session.has('manageSettings')"
                    class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-2 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                    {{ prefs.txt('সব ডাউনলোড', 'Download all') }} (Pull)
                  </button>
                </div>

                @if (cloudTest().kind === 'supabase' && cloudTest().message) {
                  <div class="rounded-lg px-3 py-2 text-[11px] font-semibold"
                    [class]="cloudTest().ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'">
                    {{ cloudTest().message }}
                  </div>
                }
                @if (cloudSync().message) {
                  <div class="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-semibold text-slate-700" role="status" aria-live="polite">{{ cloudSync().message }}</div>
                }

                @if (cloud.restoreIntent(); as intent) {
                  <section class="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2" aria-labelledby="restore-review-title">
                    <div class="flex items-start gap-2">
                      <mat-icon class="text-amber-700 shrink-0">restore</mat-icon>
                      <div>
                        <h4 id="restore-review-title" class="font-bold text-amber-950">{{ prefs.txt('রিস্টোর করা ডেটা পর্যালোচনা প্রয়োজন', 'Restored data needs review') }}</h4>
                        <p class="text-[11px] text-amber-900 leading-relaxed">
                          {{ prefs.txt(restoredRowCount() + 'টি রেকর্ড ক্লাউডের সঙ্গে মিলিয়ে দেখা হবে। মিল না থাকলে কোনো পক্ষই স্বয়ংক্রিয়ভাবে overwrite হবে না।', restoredRowCount() + ' records will be compared with the cloud. Differences are kept for review, never overwritten automatically.') }}
                        </p>
                        <p class="text-[10px] text-amber-800 mt-1">{{ intent.restoredAt | date:'dd-MM-yyyy HH:mm' }} · {{ intent.backend }}</p>
                      </div>
                    </div>
                    <button (click)="reviewRestoredData()" [disabled]="cloudSync().busy || conflictBusy() || !cloud.isEnabled() || !session.has('manageSettings')"
                      class="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                      {{ cloudSync().busy ? prefs.txt('মিলিয়ে দেখা হচ্ছে…', 'Comparing…') : prefs.txt('ক্লাউডের সঙ্গে মিলিয়ে দেখুন', 'Compare with cloud') }}
                    </button>
                  </section>
                }

                @if (cloud.syncConflicts().length) {
                  <section class="rounded-xl border border-rose-300 bg-rose-50 p-3 space-y-3" aria-labelledby="sync-conflicts-title">
                    <div class="flex items-start gap-2">
                      <mat-icon class="text-rose-700 shrink-0">sync_problem</mat-icon>
                      <div>
                        <h4 id="sync-conflicts-title" class="font-bold text-rose-950">{{ prefs.txt(cloud.syncConflicts().length + 'টি সিঙ্ক সংঘাত', cloud.syncConflicts().length + ' sync conflicts') }}</h4>
                        <p class="text-[11px] text-rose-900">{{ prefs.txt('দুই সংস্করণ দেখে একটি বেছে নিন। সব সংঘাত সমাধান না হওয়া পর্যন্ত সাধারণ আপলোড বন্ধ থাকবে।', 'Review both versions and choose one. Ordinary uploads stay blocked until every conflict is resolved.') }}</p>
                      </div>
                    </div>
                    @for (conflict of cloud.syncConflicts(); track conflict.id) {
                      <div class="rounded-lg border border-rose-200 bg-white overflow-hidden">
                        <button type="button" (click)="toggleConflict(conflict.id)"
                          [attr.aria-expanded]="expandedConflict() === conflict.id"
                          class="w-full text-left cursor-pointer px-3 py-2 font-bold text-slate-800 hover:bg-rose-50 flex flex-wrap items-center justify-between gap-2">
                          <span class="font-mono text-[10px] break-all">{{ conflict.collection }} / {{ conflict.rowId }}</span>
                          <span class="font-normal text-[10px] text-slate-500">{{ conflict.detectedAt | date:'dd-MM-yyyy HH:mm' }}</span>
                        </button>
                        @if (expandedConflict() === conflict.id) {
                        <div class="p-3 border-t border-rose-100 space-y-3">
                          <div class="grid grid-cols-1 lg:grid-cols-2 gap-2">
                            <div class="min-w-0 rounded-lg border border-teal-200 bg-teal-50 p-2">
                              <p class="font-bold text-teal-900 mb-1">{{ prefs.txt('এই ডিভাইস', 'This device') }}</p>
                              <pre class="max-h-56 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed text-teal-950">{{ snapshot(conflict.local) }}</pre>
                            </div>
                            <div class="min-w-0 rounded-lg border border-indigo-200 bg-indigo-50 p-2">
                              <p class="font-bold text-indigo-900 mb-1">{{ prefs.txt('ক্লাউড', 'Cloud') }}</p>
                              <pre class="max-h-56 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed text-indigo-950">{{ snapshot(conflict.remote) }}</pre>
                            </div>
                          </div>
                          <div class="flex flex-wrap gap-2">
                            <button (click)="resolveConflict(conflict, 'local')" [disabled]="conflictBusy() || cloudSync().busy || !session.has('manageSettings')"
                              class="bg-teal-700 hover:bg-teal-800 text-white font-bold px-3 py-2 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                              {{ conflictBusy() === conflict.id + ':local' ? prefs.txt('প্রয়োগ হচ্ছে…', 'Applying…') : prefs.txt('এই ডিভাইসেরটি রাখুন', 'Keep this device') }}
                            </button>
                            <button (click)="resolveConflict(conflict, 'remote')" [disabled]="conflictBusy() || cloudSync().busy || !session.has('manageSettings')"
                              class="bg-indigo-700 hover:bg-indigo-800 text-white font-bold px-3 py-2 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                              {{ conflictBusy() === conflict.id + ':remote' ? prefs.txt('প্রয়োগ হচ্ছে…', 'Applying…') : prefs.txt('ক্লাউডেরটি রাখুন', 'Keep cloud') }}
                            </button>
                          </div>
                        </div>
                        }
                      </div>
                    }
                  </section>
                }

                <div class="grid grid-cols-2 gap-2 text-[11px]">
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('গত Push', 'Last push') }}</p>
                    <p class="font-bold">{{ cloud.config().lastPushAt ? (cloud.config().lastPushAt | date:'dd-MM HH:mm') : '—' }}</p>
                  </div>
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('গত Pull', 'Last pull') }}</p>
                    <p class="font-bold">{{ cloud.config().lastPullAt ? (cloud.config().lastPullAt | date:'dd-MM HH:mm') : '—' }}</p>
                  </div>
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('অপেক্ষমান সারি', 'Pending rows') }}</p>
                    <p class="font-bold">{{ cloud.pendingRows() }}</p>
                  </div>
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('অটো সিঙ্ক', 'Auto sync') }}</p>
                    <label class="font-bold flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" [(ngModel)]="cloudDraft.autoSync" (change)="saveCloud('supabase')" [disabled]="!session.has('manageSettings')" class="w-4 h-4 accent-teal-600 disabled:opacity-50">
                      {{ cloudDraft.autoSync ? prefs.txt('চালু', 'On') : prefs.txt('বন্ধ', 'Off') }}
                    </label>
                  </div>
                  <div class="col-span-2 rounded-lg border border-teal-200 bg-teal-50 p-2">
                    <p class="text-teal-700">{{ prefs.txt('সর্বশেষ ডাটাবেস আপডেট', 'Last database update') }}</p>
                    <p class="font-bold text-teal-900">
                      {{ cloud.config().lastRemoteAt ? (cloud.config().lastRemoteAt | date:'dd-MM-yyyy HH:mm:ss') : prefs.txt('এখনো পাওয়া যায়নি', 'Not fetched yet') }}
                    </p>
                  </div>
                </div>

                <p class="text-[10px] text-slate-500 leading-relaxed">
                  {{ prefs.txt('প্রথমবার Supabase-এর SQL Editor-এ প্রজেক্টের', 'First, in the Supabase SQL Editor run the project’s') }} <span class="font-mono">supabase/new-project.sql</span>
                  {{ prefs.txt('ফাইলটি চালিয়ে', 'file to create the') }} <span class="font-mono">sm_rows</span>
                  {{ prefs.txt('টেবিল ও লগইন-ভিত্তিক RLS পলিসি তৈরি করুন, তারপর এই দুই ঘর পূরণ করে সংযোগ পরীক্ষা করুন। Supabase URL ও public anon key এই ডিভাইসে সংরক্ষিত থাকে; ডেটা ছবি Cloudinary-তে যায়।', 'table and login-based RLS policies, then fill these two fields and test the connection. The Supabase URL and public anon key are stored on this device; images go to Cloudinary.') }}
                </p>
              </div>
            </div>

            <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
              <div class="px-4 py-3 bg-teal-700 text-white">
                <h3 class="font-bold text-sm">Cloudinary — {{ prefs.txt('ছবির স্টোরেজ', 'image storage') }}</h3>
                <p class="text-[10px] text-teal-100">{{ prefs.txt('ভারি ছবি আগে', 'Heavy images are first') }} {{ imageCapLabel }} {{ prefs.txt('হয়, তারপর সাব-ফোল্ডারে যায়', 'then stored in a sub-folder') }}</p>
              </div>

              <div class="p-4 space-y-3">
                <label class="flex items-center gap-2 font-semibold text-slate-700">
                  <input type="checkbox" [(ngModel)]="cloudDraft.cloudinaryOn" [disabled]="!session.has('manageSettings')" class="w-4 h-4 accent-teal-600 disabled:opacity-50">
                  {{ prefs.txt('Cloudinary আপলোড চালু (না থাকলে ছবি ডিভাইসেই থাকবে)', 'Enable Cloudinary upload (otherwise images stay on the device)') }}
                </label>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ক্লাউড নাম', 'Cloud name') }}</label>
                    <input type="text" [(ngModel)]="cloudDraft.cloudName" placeholder="dxy12abc" [disabled]="!session.has('manageSettings')"
                      class="w-full border border-slate-300 rounded-lg p-2 font-mono text-[11px] disabled:cursor-not-allowed disabled:opacity-60">
                  </div>
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('আনসাইনড আপলোড প্রিসেট', 'Unsigned upload preset') }}</label>
                    <input type="text" [(ngModel)]="cloudDraft.uploadPreset" placeholder="sm_x1_unsigned" [disabled]="!session.has('manageSettings')"
                      class="w-full border border-slate-300 rounded-lg p-2 font-mono text-[11px] disabled:cursor-not-allowed disabled:opacity-60">
                  </div>
                  <div class="sm:col-span-2">
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('বেস ফোল্ডার', 'Base folder') }}</label>
                    <input type="text" [(ngModel)]="cloudDraft.folder" placeholder="sm-enterprise" [disabled]="!session.has('manageSettings')"
                      class="w-full border border-slate-300 rounded-lg p-2 font-mono text-[11px] disabled:cursor-not-allowed disabled:opacity-60">
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button (click)="saveCloud('cloudinary')" [disabled]="!session.has('manageSettings')" class="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-4 py-2 rounded-lg cursor-pointer">{{ prefs.txt('সেভ', 'Save') }}</button>
                  <button (click)="testCloud('cloudinary')" [disabled]="cloudTest().busy || !session.has('manageSettings')"
                    class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50">
                    {{ prefs.txt('আপলোড পরীক্ষা', 'Test upload') }}
                  </button>
                </div>

                @if (cloudTest().kind === 'cloudinary' && cloudTest().message) {
                  <div class="rounded-lg px-3 py-2 text-[11px] font-semibold"
                    [class]="cloudTest().ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'">
                    {{ cloudTest().message }}
                  </div>
                }

                <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] space-y-1">
                  <p class="font-bold text-slate-700">{{ prefs.txt('সাব-ফোল্ডার বিভাজন', 'Sub-folder split') }}</p>
                  <p class="font-mono text-slate-600">products/ · variants/ · parties/ · brands/ · categories/ · signature/ · documents/</p>
                  <p class="text-slate-500">{{ prefs.txt('প্রতিটি আপলোড এই এ্যাপের নিজস্ব ডাটাবেসেও (IndexedDB) থাকে — ইন্টারনেট না থাকলেও ছবি খোলে।', 'Every upload is also kept in this app’s own database (IndexedDB) — images open even without internet.') }}</p>
                </div>

                <div class="grid grid-cols-3 gap-2 text-[11px]">
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('টেবিল', 'Tables') }}</p>
                    <p class="font-bold">{{ dbStats().collections }}</p>
                  </div>
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('ছবি', 'Images') }}</p>
                    <p class="font-bold">{{ dbStats().media }}</p>
                  </div>
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('ছবির জায়গা', 'Image size') }}</p>
                    <p class="font-bold">{{ (dbStats().mediaBytes / 1024).toFixed(0) }} KB</p>
                  </div>
                </div>

                <p class="text-[10px] text-slate-500">
                  {{ prefs.txt('লোকাল ডাটাবেস:', 'Local database:') }} <span class="font-bold">{{ database.backend() === 'indexeddb' ? 'IndexedDB (sm_enterprise)' : prefs.txt('localStorage (ব্যাকআপ মোড)', 'localStorage (backup mode)') }}</span>{{ prefs.txt('।', '.') }}
                  {{ prefs.txt('Cloudinary-তে unsigned preset-এর Folder = Base folder + সাব-ফোল্ডার রাখুন, Max upload size ৫MB।', 'In Cloudinary, set the unsigned preset Folder = Base folder + sub-folder, with max upload size 5 MB.') }}
                </p>
              </div>
            </div>
          </div>
        }

        <!-- FILE BACKUP TAB -->
        @if (tab() === 'backup') {
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">

            <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
              <div class="px-4 py-3 bg-teal-700 text-white">
                <h3 class="font-bold text-sm">{{ prefs.txt('ফাইল ব্যাকআপ — এই ডিভাইস', 'File backup — this device') }}</h3>
                <p class="text-[10px] text-teal-100">{{ prefs.txt('সম্পূর্ণ ডাটাবেস (ছবি সমেত) একটাই JSON ফাইলে', 'The whole database (with images) in a single JSON file') }}</p>
              </div>

              <div class="p-4 space-y-3">
                <div class="grid grid-cols-4 gap-2 text-[11px]">
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('টেবিল', 'Tables') }}</p>
                    <p class="font-bold">{{ dbStats().collections }}</p>
                  </div>
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('রেকর্ড', 'Records') }}</p>
                    <p class="font-bold">{{ dbStats().records }}</p>
                  </div>
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('ছবি', 'Images') }}</p>
                    <p class="font-bold">{{ dbStats().media }}</p>
                  </div>
                  <div class="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p class="text-slate-500">{{ prefs.txt('ছবির জায়গা', 'Image size') }}</p>
                    <p class="font-bold">{{ (dbStats().mediaBytes / 1024).toFixed(0) }} KB</p>
                  </div>
                </div>

                <button (click)="exportFile()" [disabled]="backup.job().busy"
                  class="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-lg cursor-pointer disabled:opacity-50">
                  <mat-icon class="text-sm align-middle">download</mat-icon> {{ prefs.txt('সম্পূর্ণ ব্যাকআপ ডাউনলোড (.json)', 'Download full backup (.json)') }}
                </button>

                <div class="border-t border-slate-200 pt-3 space-y-2">
                  <p class="font-bold text-slate-800">{{ prefs.txt('ব্যাকআপ ফাইল থেকে ফিরিয়ে আনুন', 'Restore from a backup file') }}</p>
                  <input type="file" accept="application/json,.json" (change)="onBackupFile($event)"
                    class="w-full border border-slate-300 rounded-lg p-2 text-[11px] file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:font-semibold">

                  @if (staged()) {
                    <div class="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-[11px] font-semibold text-emerald-800">
                      {{ staged()?.label }} · {{ staged()?.collections }} {{ prefs.txt('টেবিল', 'tables') }} · {{ staged()?.records }} {{ prefs.txt('রেকর্ড', 'records') }} · {{ staged()?.media }} {{ prefs.txt('ছবি', 'images') }}
                    </div>
                  }

                  <div class="flex flex-wrap gap-3 text-[11px] font-semibold text-slate-700">
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="importmode" value="replace" [(ngModel)]="importMode">
                      {{ prefs.txt('পুরো ডাটার জায়গায় বসবে (replace)', 'Replace all existing data (replace)') }}
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="importmode" value="merge" [(ngModel)]="importMode">
                      {{ prefs.txt('বর্তমান ডাটার সাথে মিলিয়ে নেবে (merge)', 'Merge with the current data (merge)') }}
                    </label>
                  </div>

                  <button (click)="runImport()" [disabled]="!staged() || backup.job().busy"
                    class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-lg cursor-pointer disabled:opacity-40">
                    {{ prefs.txt('ইমপোর্ট করে এ্যাপ রিলোড করুন', 'Import and reload the app') }}
                  </button>
                </div>

                @if (backup.job().message || backup.job().error) {
                  <div class="rounded-lg px-3 py-2 text-[11px] font-semibold"
                    [class]="backup.job().error ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-50 text-slate-700 border border-slate-200'">
                    {{ backup.job().error || backup.job().message }}
                  </div>
                }
              </div>
            </div>

            <div class="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div class="px-4 py-3 bg-gradient-to-r from-indigo-600 via-violet-600 to-sky-500 text-white flex items-center justify-between gap-2">
                <div>
                  <h3 class="font-bold text-sm">Cloudinary — {{ prefs.txt('অনলাইন ব্যাকআপ', 'online backup') }}</h3>
                  <p class="text-[10px] text-indigo-100">{{ prefs.txt('শুধু JSON ডাটা — ছবি থাকে Cloudinary লিংক হিসেবে, ফাইলে ছবির বাইট যায় না', 'JSON data only — images stay as Cloudinary links, never inside the file') }}</p>
                </div>
                <span class="text-[10px] font-bold px-2 py-1 rounded-full"
                  [class]="backup.cloudReady() ? 'bg-emerald-500 text-white' : 'bg-white/25 text-white'">
                  {{ backup.cloudReady() ? prefs.txt('প্রস্তুত', 'Ready') : prefs.txt('কনফিগ নেই', 'Not configured') }}
                </span>
              </div>

              <div class="p-4 space-y-3">
                @if (!backup.cloudReady()) {
                  <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
                    <p>{{ prefs.txt('Cloudinary কনফিগ সেভ করা নেই — Cloud name ও unsigned upload preset আগে বসাতে হবে।', 'Cloudinary is not configured — save the cloud name and unsigned upload preset first.') }}</p>
                    <button type="button" (click)="selectTab('cloud')"
                      class="mt-2 rounded-lg bg-amber-600 hover:bg-amber-700 px-3 py-1.5 text-[10px] font-bold text-white cursor-pointer">
                      {{ prefs.txt('Cloud ট্যাবে যান', 'Open the Cloud tab') }}
                    </button>
                  </div>
                }
                @if (!session.has('manageSettings')) {
                  <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
                    {{ prefs.txt('শুধু অ্যাডমিন Cloudinary ব্যাকআপ চালাতে পারবেন।', 'Only an administrator can run Cloudinary backups.') }}
                  </div>
                }

                <div class="flex flex-wrap items-center gap-2">
                  <button (click)="sendCloudBackup()" [disabled]="!backup.cloudReady() || backup.job().busy || !session.has('manageSettings')"
                    class="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-40">
                    {{ prefs.txt('এখনই ব্যাকআপ পাঠান', 'Back up now') }}
                  </button>
                  <button (click)="refreshCloudBackups()" [disabled]="backup.job().busy || !session.has('manageSettings')"
                    class="bg-slate-800 hover:bg-slate-900 text-white font-semibold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-40">
                    {{ prefs.txt('ব্যাকআপ তালিকা', 'Backup list') }}
                  </button>
                </div>

                <label class="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 px-3 py-2 cursor-pointer">
                  <input type="checkbox" [ngModel]="backup.autoBackup()" (ngModelChange)="toggleAutoBackup($event)"
                    [disabled]="!session.has('manageSettings') || !backup.cloudReady()" class="mt-0.5">
                  <span class="text-[11px] leading-relaxed">
                    <span class="block font-bold text-slate-800 dark:text-slate-100">{{ prefs.txt('প্রতিদিন স্বয়ংক্রিয় ব্যাকআপ', 'Automatic daily backup') }}</span>
                    <span class="block text-slate-500 dark:text-slate-400">{{ prefs.txt('দিনে একবার, অ্যাপ খোলা থাকলেই Cloudinary-তে নিজে থেকে ব্যাকআপ যাবে।', 'Once a day, while the app is open, a backup is uploaded to Cloudinary by itself.') }}</span>
                  </span>
                </label>
                <p class="text-[10px] text-slate-500 dark:text-slate-400">
                  {{ prefs.txt('শেষ ব্যাকআপ:', 'Last backup:') }}
                  <span class="font-semibold text-slate-700 dark:text-slate-200">{{ backup.lastBackupAt() ? (backup.lastBackupAt() | date:'dd-MM-yyyy HH:mm') : prefs.txt('এখনো কোনো ব্যাকআপ নেই', 'No backup yet') }}</span>
                </p>
                @if (backup.autoStatus()) {
                  <p class="text-[10px] font-semibold" [class]="backup.autoStatus().includes('ব্যর্থ') ? 'text-rose-600 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'">{{ backup.autoStatus() }}</p>
                }
                @if (backup.job().error) {
                  <div class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{{ backup.job().error }}</div>
                } @else if (backup.job().message) {
                  <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200">{{ backup.job().message }}</div>
                }

                @if (backup.cloudFiles().length) {
                  <div class="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <div class="bg-slate-50 dark:bg-slate-800 px-3 py-2 text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300">{{ prefs.txt('Cloudinary-এর ব্যাকআপ', 'Cloudinary backups') }}</div>
                    <div class="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
                      @for (f of backup.cloudFiles(); track f.id) {
                        <div class="px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
                          <div class="min-w-0">
                            <p class="font-semibold text-slate-800 dark:text-slate-100 truncate">{{ f.name }}</p>
                            <p class="text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                              <span>{{ f.createdAt | date:'dd-MM-yyyy HH:mm' }} · {{ (f.bytes / 1024).toFixed(0) }} KB</span>
                              <span class="rounded px-1.5 py-0.5 text-[9px] font-bold"
                                [class]="f.mode === 'full' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'">
                                {{ f.mode === 'full' ? prefs.txt('পুরনো — ছবি সহ', 'legacy — with images') : prefs.txt('শুধু JSON', 'JSON only') }}
                              </span>
                            </p>
                          </div>
                          <div class="flex items-center gap-1 shrink-0">
                            <button (click)="restoreFromCloud(f)" [disabled]="backup.job().busy || !session.has('manageSettings')"
                              class="bg-indigo-600 text-white font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-40">{{ prefs.txt('ফিরিয়ে আনুন', 'Restore') }}</button>
                            <button (click)="forgetCloudBackup(f)" [disabled]="!session.has('manageSettings')" [title]="prefs.txt('তালিকা থেকে সরান', 'Remove from list')"
                              class="bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-100 font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-40">
                              <mat-icon class="text-xs">delete</mat-icon>
                            </button>
                          </div>
                        </div>
                      }
                    </div>
                  </div>
                }

                <div class="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-3 py-2 text-[10px] leading-relaxed text-indigo-900 dark:text-indigo-100 space-y-1">
                  <p>
                    {{ prefs.txt('প্রতিদিনের ফাইল আলাদা তারিখের ফোল্ডারে জমা হয়:', 'Each day gets its own folder:') }}
                    <span class="font-mono">{{ cloudBackupFolder() }}</span> {{ prefs.txt('— Cloudinary Console → Media Library → Raw Files থেকে সহজেই খুঁজে পাবেন।', '— easy to find under Cloudinary Console → Media Library → Raw Files.') }}
                  </p>
                  <p>
                    {{ prefs.txt('ফাইলে শুধু JSON ডাটা থাকে; ছবি রেকর্ডের ভেতরে Cloudinary লিংক হিসেবে থাকে — তাই ব্যাকআপ ছোট ও দ্রুত হয়। এই JSON ফাইলটি "ফাইল ব্যাকআপ" ট্যাবের রিস্টোর ঘর দিয়ে যেকোনো সময় ইমপোর্ট করা যাবে।', 'The file holds JSON data only; images stay as Cloudinary links inside the records, so backups stay small and fast. The same JSON can be imported any time through the restore box on the File backup tab.') }}
                  </p>
                  <p>
                    {{ prefs.txt('তালিকাটি Supabase-এর সাথে সিঙ্ক হয়, তাই যেকোনো ডিভাইস থেকে রিস্টোর করা যাবে। লিস্ট থেকে মুছে ফেললেও Cloudinary-র ফাইলটি মুছে যায় না — Console → Media Library →', 'The list syncs through Supabase, so any device can restore. Removing a row does not delete the asset — use Console → Media Library →') }}
                    <span class="font-mono">backups</span> {{ prefs.txt('থেকে মুছুন। লিংকটি যার কাছে থাকবে সে ফাইলটি পড়তে পারবে, তাই URL শেয়ার করবেন না।', 'to delete it. Anyone holding the link can read the file, so do not share the URL.') }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <section class="mt-4 relative overflow-hidden rounded-2xl border border-rose-300 bg-white shadow-xs" aria-labelledby="hard-reset-title">
            <div class="px-4 py-3 bg-gradient-to-r from-rose-600 via-rose-500 to-orange-500 text-white flex items-center justify-between gap-3">
              <div>
                <h3 id="hard-reset-title" class="font-bold text-sm">{{ prefs.txt('হার্ড রিসেট — পুরো ডাটাবেস খালি করুন', 'Hard reset — wipe the whole database') }}</h3>
                <p class="text-[10px] text-rose-100">{{ prefs.txt('Supabase-এর সব ব্যবসার ডেটা + এই ডিভাইসের ক্যাশ মুছে লগইন পেজে ফিরে যাবে', 'Deletes all business data in Supabase plus this device’s cache, then returns to the login page') }}</p>
              </div>
              <mat-icon class="text-2xl opacity-80">delete_forever</mat-icon>
            </div>
            <div class="p-4 space-y-3">
              <p class="text-[11px] leading-relaxed text-slate-600">
                {{ prefs.txt('প্রাইমারি অ্যাকাউন্ট Supabase-এ থেকে যাবে, তাই একই পাসওয়ার্ডে আবার লগইন করতে পারবেন। বাকি সব সারি এবং অন্য সব ডিভাইসের পুরনো ক্যাশ মুছে যাবে — নতুন ডেটা import করে আবার শুরু করুন।', 'The primary account stays in Supabase, so the same password still signs you in. Every other row and every other device’s old cache is cleared — import fresh data afterwards.') }}
              </p>
              @if (!resetOpen()) {
                <button type="button" (click)="openHardReset()" [disabled]="!canHardReset()"
                  class="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                  {{ prefs.txt('হার্ড রিসেট করুন…', 'Hard reset…') }}
                </button>
                @if (!canHardReset()) {
                  <p class="text-[10px] text-amber-700">{{ prefs.txt('শুধু প্রাইমারি অ্যাডমিন এই কাজটি করতে পারেন।', 'Only the primary admin can do this.') }}</p>
                }
              } @else {
                <div class="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-3">
                  <div class="text-[11px] font-semibold text-rose-900 leading-relaxed">
                    {{ prefs.txt('এটি ফিরিয়ে আনা যাবে না। নিশ্চিত করতে নিচের ঘরে বড় হাতে RESET লিখুন।', 'This cannot be undone. Type RESET in capitals below to confirm.') }}
                  </div>
                  <input type="text" [(ngModel)]="hardResetWord" autocomplete="off" spellcheck="false"
                    class="w-full border border-rose-300 rounded-lg p-2.5 font-mono text-sm tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-rose-500"
                    [placeholder]="prefs.txt('RESET লিখুন', 'Type RESET')">
                  <div class="flex flex-wrap gap-2">
                    <button type="button" (click)="runHardReset()" [disabled]="hardResetBusy() || hardResetWord().trim().toUpperCase() !== 'RESET'"
                      class="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                      {{ hardResetBusy() ? prefs.txt('মুছে ফেলা হচ্ছে…', 'Wiping…') : prefs.txt('হ্যাঁ, সব মুছে ফেলুন', 'Yes, delete everything') }}
                    </button>
                    <button type="button" (click)="cancelHardReset()" [disabled]="hardResetBusy()"
                      class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2.5 px-4 rounded-lg cursor-pointer disabled:opacity-50">
                      {{ prefs.txt('বাতিল', 'Cancel') }}
                    </button>
                  </div>
                  @if (hardResetMessage()) {
                    <p class="text-[11px] font-semibold text-rose-800" role="alert">{{ hardResetMessage() }}</p>
                  }
                </div>
              }
            </div>
          </section>
        }
        @if (tab() === 'users') {
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="lg:col-span-2 bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
              <div class="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <h3 class="font-bold text-sm text-slate-900">{{ prefs.t('settings.users') }}</h3>
                <button (click)="openUserModal()" class="bg-teal-600 hover:bg-teal-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                  <mat-icon class="text-xs">add</mat-icon> {{ prefs.t('settings.addUser') }}
                </button>
              </div>

              <div class="overflow-x-auto">
                <table class="w-full text-xs text-left">
                  <thead class="bg-slate-50 text-slate-600 font-bold uppercase border-b border-slate-200">
                    <tr>
                      <th class="p-3">{{ prefs.t('common.name') }}</th>
                      <th class="p-3">{{ prefs.t('login.username') }}</th>
                      <th class="p-3">{{ prefs.t('settings.role') }}</th>
                      <th class="p-3">{{ prefs.txt('পারমিশন', 'Permissions') }}</th>
                      <th class="p-3">{{ prefs.t('common.status') }}</th>
                      <th class="p-3 text-center">{{ prefs.t('common.actions') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (u of session.users(); track u.id) {
                      <tr class="hover:bg-slate-50">
                        <td class="p-3 font-semibold text-slate-800">
                          <div class="flex items-center gap-2">
                            @if (u.photo) {
                              <img [src]="u.photo" alt="" class="w-7 h-7 rounded-full object-cover ring-1 ring-slate-200 shrink-0" />
                            } @else {
                              <span class="w-7 h-7 rounded-full bg-teal-600 text-white flex items-center justify-center text-[10px] font-bold uppercase shrink-0">{{ userInitial(u) }}</span>
                            }
                            <span>
                              {{ u.name }}
                              @if (session.currentUser()?.id === u.id) {
                                <span class="ml-1 text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-bold">{{ prefs.txt('আপনি', 'YOU') }}</span>
                              }
                              @if (session.isMain(u)) {
                                <span class="ml-1 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">{{ prefs.txt('মালিক', 'OWNER') }}</span>
                              }
                            </span>
                          </div>
                        </td>
                        <td class="p-3 font-mono text-slate-600">{{ u.username }}</td>
                        <td class="p-3">
                          <span [class]="roleClass(u.role)" class="px-2 py-0.5 rounded text-[10px] font-bold">{{ roleLabel(u.role) }}</span>
                        </td>
                        <td class="p-3">
                          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">{{ session.permissionsOf(u).length }}/{{ permissionRows.length }}</span>
                        </td>
                        <td class="p-3">
                          <span [class]="u.active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'" class="px-2 py-0.5 rounded text-[10px] font-bold">
                            {{ u.active ? prefs.t('settings.active') : prefs.t('settings.inactive') }}
                          </span>
                        </td>
                        <td class="p-3 text-center whitespace-nowrap">
                          <button (click)="openUserModal(u)" class="text-teal-600 hover:text-teal-800 p-1 cursor-pointer" [title]="prefs.txt('এডিট', 'Edit')">
                            <mat-icon class="text-xs">edit</mat-icon>
                          </button>
                          <button (click)="deleteUser(u)" [disabled]="session.currentUser()?.id === u.id"
                            class="text-rose-600 hover:text-rose-800 p-1 disabled:opacity-30 cursor-pointer" [title]="prefs.txt('ডিলিট', 'Delete')">
                            <mat-icon class="text-xs">delete</mat-icon>
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
              <div class="px-4 py-3 border-b border-slate-200 bg-slate-50">
                <h3 class="font-bold text-sm text-slate-900">{{ prefs.txt('অনুমতি ম্যাট্রিক্স', 'Permission Matrix') }}</h3>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full min-w-[420px] text-[11px] text-left">
                  <thead class="bg-slate-50 text-slate-600 font-bold uppercase border-b border-slate-200">
                    <tr>
                      <th class="p-2">{{ prefs.txt('অনুমতি', 'Permission') }}</th>
                      <th class="p-2 text-center">{{ prefs.txt('অ্যাডমিন', 'Adm') }}</th>
                      <th class="p-2 text-center">{{ prefs.txt('সেলস', 'Sal') }}</th>
                      <th class="p-2 text-center">{{ prefs.txt('অ্যাকাউন্ট', 'Acc') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (p of permissionRows; track p.key) {
                      <tr>
                        <td class="p-2 text-slate-700">{{ prefs.language() === 'bn' ? p.bn : p.en }}</td>
                        <td class="p-2 text-center">{{ hasRole('Admin', p.key) ? '✓' : '—' }}</td>
                        <td class="p-2 text-center">{{ hasRole('Salesman', p.key) ? '✓' : '—' }}</td>
                        <td class="p-2 text-center">{{ hasRole('Accountant', p.key) ? '✓' : '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        }

        <!-- AUDIT TAB -->
        @if (tab() === 'audit') {
          <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden dark:border-slate-800 dark:bg-slate-900">
            <div class="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-col lg:flex-row lg:items-center justify-between gap-2 dark:border-slate-700 dark:bg-slate-800/60">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="font-bold text-sm text-slate-900 dark:text-white">
                  {{ prefs.t('settings.audit') }} ({{ filteredLogs().length }})
                </h3>
                <span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold dark:bg-slate-700 dark:text-slate-300">{{ prefs.txt('শেষ ৩ দিন', 'Last 3 days') }}</span>
                <span class="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded font-bold dark:bg-teal-950/40 dark:text-teal-300">{{ auditCategoryStats().items.length }} {{ prefs.txt('ক্যাটেগরি', 'categories') }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <input type="text" [ngModel]="auditQuery()" (ngModelChange)="auditQuery.set($event); logsPager.setPage(1)"
                  placeholder="{{ prefs.t('common.search') }}..."
                  class="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-44 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                <button (click)="exportAudit()" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                  <mat-icon class="text-xs">download</mat-icon> {{ prefs.t('common.excel') }}
                </button>
                @if (session.has('manageSettings')) {
                  <button (click)="clearAuditLogs()" class="bg-rose-600 hover:bg-rose-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
                    <mat-icon class="text-xs">delete_sweep</mat-icon> {{ prefs.txt('লগ মুছুন', 'Clear logs') }}
                  </button>
                }
              </div>
            </div>

            <div class="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-1.5 dark:border-slate-800">
              <button type="button" (click)="setAuditCategory('all')" [class]="auditChipClass('all')">
                {{ prefs.txt('সব', 'All') }}
                <span class="rounded-full bg-black/10 px-1">{{ auditCategoryStats().total }}</span>
              </button>
              @for (cat of auditCategoryStats().items; track cat.key) {
                <button type="button" (click)="setAuditCategory(cat.key)" [class]="auditChipClass(cat.key)">
                  {{ prefs.language() === 'bn' ? cat.bn : cat.en }}
                  <span class="rounded-full bg-black/10 px-1">{{ cat.count }}</span>
                </button>
              }
            </div>

            <div class="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table class="w-full min-w-[720px] text-xs text-left">
                <thead class="bg-slate-50 text-slate-600 font-bold uppercase border-b border-slate-200 sticky top-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th class="p-3">{{ prefs.t('settings.time') }}</th>
                    <th class="p-3">{{ prefs.txt('ক্যাটেগরি', 'Category') }}</th>
                    <th class="p-3">{{ prefs.t('settings.user') }}</th>
                    <th class="p-3">{{ prefs.t('settings.role') }}</th>
                    <th class="p-3">{{ prefs.t('settings.action') }}</th>
                    <th class="p-3">{{ prefs.t('settings.detail') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                  @for (logItem of logsPager.paged(); track logItem.id) {
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td class="p-3 font-mono text-slate-500 whitespace-nowrap dark:text-slate-400">{{ logItem.at | date:'dd-MM-yyyy HH:mm:ss' }}</td>
                      <td class="p-3">
                        <span [class]="auditCategoryClass(logItem.category)" class="px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap">{{ auditCategoryLabel(logItem.category) }}</span>
                      </td>
                      <td class="p-3 font-semibold text-slate-800 dark:text-slate-100">{{ logItem.user }}</td>
                      <td class="p-3">
                        <span [class]="roleClass(logItem.role)" class="px-2 py-0.5 rounded text-[10px] font-bold">{{ roleLabel(logItem.role) }}</span>
                      </td>
                      <td class="p-3 font-semibold text-teal-700 dark:text-teal-300">{{ logItem.action }}</td>
                      <td class="p-3 text-slate-600 dark:text-slate-400">{{ logItem.detail }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="p-6 text-center text-slate-400 dark:text-slate-500">{{ prefs.t('common.noData') }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <app-table-pagination
              [total]="logsPager.total()"
              [page]="logsPager.currentPage()"
              [pageSize]="logsPager.pageSize()"
              (pageChange)="logsPager.setPage($event)"
              (pageSizeChange)="logsPager.setPageSize($event)"
            />
          </div>
        }
      }

      <!-- User Modal -->
      @if (showUserModal()) {
        <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" (click)="showUserModal.set(false)">
          <div class="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden" (click)="$event.stopPropagation()">
            <div class="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 class="font-bold text-sm text-slate-900">{{ editingUserId() ? prefs.txt('ইউজার এডিট', 'Edit User') : prefs.t('settings.addUser') }}</h3>
              <button (click)="showUserModal.set(false)" class="text-slate-500 hover:text-slate-800 cursor-pointer">
                <mat-icon class="text-base">close</mat-icon>
              </button>
            </div>

            <div class="p-5 space-y-3 max-h-[75vh] overflow-y-auto">
              <div class="flex items-center gap-3">
                <div class="w-16 h-16 rounded-full overflow-hidden bg-teal-600 text-white flex items-center justify-center font-bold text-xl ring-2 ring-emerald-400/40 shrink-0">
                  @if (userForm.photo) {
                    <img [src]="userForm.photo" alt="" class="w-full h-full object-cover" />
                  } @else {
                    {{ formInitial() }}
                  }
                </div>
                <div class="min-w-0">
                  <label class="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg font-semibold text-slate-700 cursor-pointer">
                    <mat-icon class="text-sm">photo_camera</mat-icon>
                    {{ prefs.txt('প্রোফাইল ছবি', 'Profile photo') }}
                    <input type="file" accept="image/*" class="hidden" (change)="onUserPhoto($event)" />
                  </label>
                  @if (userForm.photo) {
                    <button type="button" (click)="userForm.photo = ''" class="block mt-1 text-rose-600 hover:text-rose-800 font-semibold cursor-pointer">
                      {{ prefs.txt('ছবি সরান', 'Remove photo') }}
                    </button>
                  }
                  <p class="text-[10px] text-slate-400 mt-1">{{ prefs.txt('ছবি স্বয়ংক্রিয়ভাবে ছোট করা হবে', 'The photo is resized automatically') }}</p>
                </div>
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('common.name') }}</label>
                <input type="text" [(ngModel)]="userForm.name" class="w-full border border-slate-300 rounded-lg p-2.5">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('login.username') }}</label>
                <input type="text" [(ngModel)]="userForm.username" class="w-full border border-slate-300 rounded-lg p-2.5 font-mono">
              </div>
              <div>
                <label class="block font-semibold mb-1 text-slate-700">
                  {{ editingUserId() ? prefs.txt('নতুন পাসওয়ার্ড', 'New password') : prefs.txt('পাসওয়ার্ড', 'Password') }}
                  <span class="font-normal text-slate-400">{{ editingUserId() ? prefs.txt('(খালি রাখলে অপরিবর্তিত)', '(blank keeps it)') : prefs.txt('(কমপক্ষে ৬ অক্ষর)', '(at least 6 characters)') }}</span>
                </label>
                <div class="relative">
                  <input [type]="showUserPin() ? 'text' : 'password'" [(ngModel)]="userForm.pin" maxlength="64"
                    autocomplete="new-password"
                    [placeholder]="editingUserId() ? prefs.txt('পরিবর্তন করতে চাইলে নতুন পাসওয়ার্ড দিন', 'Enter a new password only to change it') : prefs.txt('কমপক্ষে ৬ অক্ষর', 'At least 6 characters')"
                    class="w-full border border-slate-300 rounded-lg p-2.5 font-mono pr-10">
                  <button type="button" (click)="showUserPin.set(!showUserPin())"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    [title]="showUserPin() ? prefs.txt('আড়াল করুন', 'Hide') : prefs.txt('দেখুন', 'Show')">
                    <mat-icon class="text-base">{{ showUserPin() ? 'visibility_off' : 'visibility' }}</mat-icon>
                  </button>
                </div>
              </div>
              @if (needsCurrentPin() && userForm.pin) {
                <div>
                  <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('বর্তমান পাসওয়ার্ড', 'Current password') }}</label>
                  <input type="password" [(ngModel)]="userForm.currentPin" autocomplete="current-password"
                    [placeholder]="prefs.txt('নিজের পাসওয়ার্ড পরিবর্তনে আবশ্যক', 'Required to change your own password')"
                    class="w-full border border-slate-300 rounded-lg p-2.5 font-mono">
                </div>
              }
              <div>
                <label class="block font-semibold mb-1 text-slate-700">{{ prefs.t('settings.role') }}</label>
                <select [ngModel]="userForm.role" (ngModelChange)="onUserRoleChange($event)" [disabled]="mainAdminForm()" class="w-full border border-slate-300 rounded-lg p-2.5 disabled:bg-slate-100">
                  <option value="Admin">{{ prefs.t('role.admin') }}</option>
                  <option value="Salesman">{{ prefs.t('role.salesman') }}</option>
                  <option value="Accountant">{{ prefs.t('role.accountant') }}</option>
                </select>
              </div>
              <label class="flex items-center gap-2 font-semibold text-slate-700">
                <input type="checkbox" [(ngModel)]="userForm.active" class="w-4 h-4 accent-teal-600">
                {{ prefs.t('settings.active') }}
              </label>

              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block font-semibold text-slate-700">{{ prefs.txt('ফিচার পারমিশন', 'Feature permissions') }}</label>
                  <button type="button" (click)="toggleAllUserPermissions()" [disabled]="mainAdminForm()"
                    class="text-teal-700 hover:text-teal-900 font-bold cursor-pointer disabled:opacity-40">
                    {{ allUserPermissions() ? prefs.txt('সব বাদ', 'Clear all') : prefs.txt('সব দিন', 'Select all') }}
                  </button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 border border-slate-200 rounded-lg p-2 bg-slate-50/60">
                  @for (p of permissionRows; track p.key) {
                    <label class="flex items-start gap-1.5 font-medium text-slate-700">
                      <input type="checkbox" [checked]="userForm.permissions.includes(p.key)"
                        (change)="toggleUserPermission(p.key)" [disabled]="mainAdminForm()"
                        class="w-3.5 h-3.5 mt-0.5 accent-teal-600 disabled:opacity-60" />
                      <span>{{ prefs.language() === 'bn' ? p.bn : p.en }}</span>
                    </label>
                  }
                </div>
                @if (mainAdminForm()) {
                  <p class="text-[10px] text-slate-500 mt-1">{{ prefs.txt('মালিক অ্যাকাউন্টের সব পারমিশন সবসময় চালু থাকে।', 'The owner account always keeps every permission.') }}</p>
                }
              </div>

              @if (userError()) {
                <p class="text-rose-600 font-semibold">
                  @switch (userError()) {
                    @case ('duplicate') { {{ prefs.txt('এই ইউজারনেম আগে থেকেই আছে', 'This username already exists') }} }
                    @case ('short') { {{ prefs.txt('পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে', 'Password must be at least 6 characters') }} }
                    @case ('invalid') { {{ prefs.txt('বর্তমান পাসওয়ার্ড মেলেনি', 'The current password is incorrect') }} }
                    @case ('sync') { {{ prefs.txt('ক্লাউডে সংরক্ষণ ব্যর্থ — ইন্টারনেট দেখে আবার চেষ্টা করুন', 'Cloud save failed — check the internet and try again') }} }
                    @case ('forbidden') { {{ prefs.txt('এই কাজের অনুমতি নেই', 'You do not have permission for this action') }} }
                    @default { {{ prefs.txt('সব ঘর পূরণ করুন', 'Fill in every field') }} }
                  }
                </p>
              }
            </div>

            <div class="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button (click)="showUserModal.set(false)" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-slate-700 cursor-pointer">
                {{ prefs.t('common.cancel') }}
              </button>
              <button (click)="saveUser()" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg cursor-pointer">
                {{ prefs.t('common.save') }}
              </button>
            </div>
          </div>
        </div>
      }

    </div>
  `
})
export class Settings {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  session = inject(SessionService);
  prefs = inject(PreferencesService);
  private media = inject(MediaService);

  tab = signal<SettingsTab>('business');
  savedMsg = signal<boolean>(false);
  showUserModal = signal<boolean>(false);
  editingUserId = signal<number | null>(null);
  userError = signal<string>('');
  showUserPin = signal<boolean>(false);

  auditQuery = signal<string>('');
  auditCategory = signal<AuditCategory | 'all'>('all');

  tabs: { key: SettingsTab; bn: string; en: string }[] = [
    { key: 'business', bn: 'ব্যবসার তথ্য', en: 'Business' },
    { key: 'appearance', bn: 'রঙ ও থিম', en: 'Theme' },
    { key: 'warehouse', bn: 'ওয়্যারহাউস', en: 'Warehouses' },
    { key: 'units', bn: 'একক', en: 'Units' },
    { key: 'cloud', bn: 'ক্লাউড ও ছবি', en: 'Cloud & Images' },
    { key: 'backup', bn: 'ফাইল ডাটা ব্যাকআপ', en: 'File Backup' },
    { key: 'users', bn: 'ইউজার ও রোল', en: 'Users & Roles' },
    { key: 'audit', bn: 'অডিট লগ', en: 'Audit Log' }
  ];

  permissionRows = PERMISSION_LABELS;

  themeModes: { key: ThemeMode; bn: string; en: string; hintBn: string; hintEn: string; icon: string }[] = [
    { key: 'light', bn: 'লাইট', en: 'Light', hintBn: 'দিনের আলোয় উজ্জ্বল ও পরিষ্কার', hintEn: 'Bright and crisp for daytime', icon: 'light_mode' },
    { key: 'dark', bn: 'ডার্ক', en: 'Dark', hintBn: 'রাতে চোখের আরাম', hintEn: 'Gentle on the eyes at night', icon: 'dark_mode' },
    { key: 'system', bn: 'সিস্টেম', en: 'System', hintBn: 'ডিভাইসের সেটিং অনুযায়ী নিজে বদলাবে', hintEn: 'Follows the device setting', icon: 'brightness_auto' }
  ];

  business = { ...this.dataService.voucherSettings() };

  cloud = inject(CloudService);
  database = inject(StorageService);

  cloudDraft: {
    url: string; anonKey: string; supabaseOn: boolean;
    cloudName: string; uploadPreset: string; folder: string; cloudinaryOn: boolean;
    autoSync: boolean;
  } = this.readCloudDraft();

  cloudTest = signal<{ busy: boolean; kind: string; ok: boolean | null; message: string }>({ busy: false, kind: '', ok: null, message: '' });
  cloudSync = signal<{ busy: boolean; message: string }>({ busy: false, message: '' });
  conflictBusy = signal<string>('');
  /** Only one conflict's full JSON preview is rendered at a time; rendering every
   *  conflict at once can freeze the page when a sync produces many of them. */
  expandedConflict = signal<string>('');
  dbStats = signal<{ collections: number; records: number; media: number; mediaBytes: number }>({ collections: 0, records: 0, media: 0, mediaBytes: 0 });

  backup = inject(BackupService);
  importMode: 'replace' | 'merge' = 'replace';
  staged = signal<{ label: string; collections: number; records: number; media: number } | null>(null);
  private stagedPayload?: BackupPayload;

  imageCapLabel = `${IMAGE_MAX_PX}×${IMAGE_MAX_PX}px / ~${Math.round(IMAGE_MAX_BYTES / 1024)}KB`;

  private readCloudDraft() {
    const c = this.cloud.config();
    return {
      url: c.supabase.url,
      anonKey: c.supabase.anonKey,
      supabaseOn: c.supabase.enabled,
      cloudName: c.cloudinary.cloudName,
      uploadPreset: c.cloudinary.uploadPreset,
      folder: c.cloudinary.folder,
      cloudinaryOn: c.cloudinary.enabled,
      autoSync: c.autoSync
    };
  }

  selectTab(next: SettingsTab) {
    this.tab.set(next);
    if (next === 'cloud' || next === 'backup') {
      this.cloudDraft = this.readCloudDraft();
      void this.database.usage().then(value => this.dbStats.set(value));
    }
    if (next === 'backup') {
      this.backup.listBackups();
    }
  }

  /** Read-only display of the folder today's uploads land in. */
  cloudBackupFolder(): string {
    const base = this.cloud.config().cloudinary.folder;
    return [base, 'backups', localDateIso()].filter(Boolean).join('/');
  }

  saveCloud(source: 'supabase' | 'cloudinary') {
    if (!this.session.has('manageSettings')) return;
    try {
      this.cloud.save({
      supabase: {
        url: this.cloudDraft.url.trim(),
        anonKey: this.cloudDraft.anonKey.trim(),
        enabled: this.cloudDraft.supabaseOn
      },
      cloudinary: {
        cloudName: this.cloudDraft.cloudName.trim(),
        uploadPreset: this.cloudDraft.uploadPreset.trim(),
        folder: this.cloudDraft.folder.trim() || 'sm-enterprise',
        enabled: this.cloudDraft.cloudinaryOn
      },
      autoSync: this.cloudDraft.autoSync
      });
    } catch (error) {
      this.cloudDraft = this.readCloudDraft();
      this.cloudTest.set({ busy: false, kind: source, ok: false, message: this.messageOf(error) });
      return;
    }
    this.session.log('Cloud Settings', this.prefs.txt('Supabase / Cloudinary সেটিংস আপডেট হয়েছে', 'Supabase / Cloudinary settings updated'));
    const testLabel = source === 'cloudinary'
      ? this.prefs.txt('আপলোড পরীক্ষা', 'Test upload')
      : this.prefs.txt('সংযোগ পরীক্ষা', 'Test connection');
    this.cloudTest.set({
      busy: false,
      kind: source,
      ok: true,
      message: this.prefs.txt(`সেভ হয়েছে — এখন "${testLabel}" চাপুন।`, `Saved — now press "${testLabel}".`)
    });
  }

  async testCloud(kind: 'supabase' | 'cloudinary') {
    if (!this.session.has('manageSettings')) return;
    this.cloudTest.set({ busy: true, kind, ok: null, message: this.prefs.txt('চেষ্টা করা হচ্ছে…', 'Trying…') });
    const result = kind === 'supabase' ? await this.cloud.testSupabase() : await this.cloud.testCloudinary();
    this.cloudTest.set({ busy: false, kind, ok: result.ok, message: result.message });
    this.session.log(kind === 'supabase' ? 'Supabase Test' : 'Cloudinary Test', result.message);
  }

  async runSync(action: 'push' | 'pull') {
    if (!this.session.has('manageSettings')) return;
    this.cloudSync.set({
      busy: true,
      message: action === 'push'
        ? this.prefs.txt('আপলোড হচ্ছে…', 'Uploading…')
        : this.prefs.txt('ডাউনলোড হচ্ছে…', 'Downloading…')
    });
    try {
      const report = action === 'push' ? await this.cloud.pushAll() : await this.cloud.pullAll();
      const message = this.syncSummary(report);
      this.cloudSync.set({ busy: false, message });
      void this.database.usage().then(value => this.dbStats.set(value));
      this.session.log('Cloud Sync', `${action}: ${message}`);
    } catch (error) {
      this.cloudSync.set({ busy: false, message: this.messageOf(error) });
    }
  }

  private syncSummary(report: SyncReport): string {
    const seconds = (report.ms / 1000).toFixed(1);
    const conflicts = report.conflicts ? this.prefs.txt(` · ${report.conflicts}টি সংঘাত পর্যালোচনা করুন`, ` · review ${report.conflicts} conflicts`) : '';
    if (report.error) return this.prefs.txt(`ব্যর্থ: ${report.error}`, `Failed: ${report.error}`) + conflicts;
    return this.prefs.txt(
      `${report.pulled} সারি এসেছে, ${report.pushed} সারি গেছে, ${report.collections} কালেকশন · ${seconds}s`,
      `${report.pulled} rows pulled, ${report.pushed} rows pushed, ${report.collections} collections · ${seconds}s`
    ) + conflicts;
  }

  restoredRowCount(): number {
    return Object.values(this.cloud.restoreIntent()?.rows ?? {}).reduce((sum, rows) => sum + Object.keys(rows).length, 0);
  }

  snapshot(value: unknown): string {
    if (value === null) return this.prefs.txt('মুছে ফেলা হয়েছে', 'Deleted');
    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      return String(value);
    }
  }

  toggleConflict(id: string): void {
    this.expandedConflict.update(current => current === id ? '' : id);
  }

  async reviewRestoredData() {
    if (this.cloudSync().busy || this.conflictBusy() || !this.session.has('manageSettings')) return;
    this.cloudSync.set({ busy: true, message: this.prefs.txt('রিস্টোর করা ডেটা ক্লাউডের সঙ্গে মেলানো হচ্ছে…', 'Comparing restored data with the cloud…') });
    try {
      const report = await this.cloud.reconcileRestoredData();
      const message = this.syncSummary(report);
      this.cloudSync.set({ busy: false, message });
      this.session.log('Restore Review', message);
      if (report.conflicts) this.notify.info(message, this.prefs.txt('সংঘাত পাওয়া গেছে', 'Conflicts found'));
      else if (!report.error) this.notify.success(this.prefs.txt('রিস্টোর পর্যালোচনা সম্পন্ন হয়েছে।', 'Restore review completed.'));
    } catch (error) {
      const message = this.messageOf(error);
      this.cloudSync.set({ busy: false, message });
      this.notify.error(message, this.prefs.txt('পর্যালোচনা ব্যর্থ', 'Review failed'));
    }
  }

  async resolveConflict(conflict: CloudSyncConflict, choice: 'local' | 'remote') {
    if (this.conflictBusy() || this.cloudSync().busy || !this.session.has('manageSettings')) return;
    this.conflictBusy.set(`${conflict.id}:${choice}`);
    try {
      const confirmed = await this.notify.confirm(
        choice === 'local'
          ? this.prefs.txt('এই ডিভাইসের সংস্করণটি ক্লাউডে প্রয়োগ হবে এবং ক্লাউডের বর্তমান সংস্করণটি প্রতিস্থাপিত হবে। চালিয়ে যাবেন?', 'This device version will replace the current cloud version. Continue?')
          : this.prefs.txt('ক্লাউডের সংস্করণটি এই ডিভাইসে প্রয়োগ হবে এবং স্থানীয় পরিবর্তনটি প্রতিস্থাপিত হবে। চালিয়ে যাবেন?', 'The cloud version will replace this device version and its local changes. Continue?'),
        {
          title: this.prefs.txt('সংঘাত নিষ্পত্তি', 'Resolve conflict'),
          kind: 'warning',
          confirmText: this.prefs.txt('প্রয়োগ করুন', 'Apply'),
          cancelText: this.prefs.txt('বাতিল', 'Cancel')
        }
      );
      if (!confirmed || !this.session.has('manageSettings')) return;
      const result = choice === 'local'
        ? await this.cloud.chooseLocal(conflict.collection, conflict.rowId)
        : await this.cloud.chooseRemote(conflict.collection, conflict.rowId);
      if (!result.resolved) {
        const message = result.reason === 'missing-conflict'
          ? this.prefs.txt('সংঘাতটি আর নেই; তালিকা রিফ্রেশ হয়েছে।', 'The conflict no longer exists; the list has refreshed.')
          : this.prefs.txt('নির্বাচনের পরে সংস্করণটি আবার বদলেছে। নতুন সংস্করণ দেখে পুনরায় সিদ্ধান্ত নিন।', 'The version changed after selection. Review the new versions and decide again.');
        this.cloudSync.set({ busy: false, message });
        this.notify.info(message, this.prefs.txt('পুনরায় পর্যালোচনা করুন', 'Review again'));
        return;
      }
      const remaining = this.cloud.syncConflicts().length;
      const message = remaining
        ? this.prefs.txt(`সমাধান হয়েছে; আরও ${remaining}টি সংঘাত বাকি।`, `Resolved; ${remaining} conflicts remain.`)
        : this.prefs.txt('সব সংঘাত সমাধান হয়েছে। অটো সিঙ্ক ইচ্ছাকৃতভাবে বন্ধ থাকতে পারে; প্রয়োজনে সেটিংস থেকে চালু করুন।', 'All conflicts are resolved. Auto sync may remain intentionally off; enable it in settings if needed.');
      this.cloudSync.set({ busy: false, message });
      this.session.log('Sync Conflict', `${choice}: ${conflict.collection}/${conflict.rowId}`);
      this.notify.success(message);
    } catch (error) {
      const message = this.messageOf(error);
      this.cloudSync.set({ busy: false, message });
      this.notify.error(message, this.prefs.txt('নিষ্পত্তি ব্যর্থ', 'Resolution failed'));
    } finally {
      this.conflictBusy.set('');
      if (this.expandedConflict() === conflict.id) this.expandedConflict.set('');
    }
  }

  readonly resetOpen = signal(false);
  readonly hardResetWord = signal('');
  readonly hardResetBusy = signal(false);
  readonly hardResetMessage = signal('');

  readonly canHardReset = computed(() => {
    const user = this.session.currentUser();
    return !!user && this.session.isMain(user);
  });

  openHardReset(): void {
    if (!this.canHardReset()) return;
    this.hardResetWord.set('');
    this.hardResetMessage.set('');
    this.resetOpen.set(true);
  }

  cancelHardReset(): void {
    if (this.hardResetBusy()) return;
    this.resetOpen.set(false);
    this.hardResetWord.set('');
    this.hardResetMessage.set('');
  }

  async runHardReset(): Promise<void> {
    if (this.hardResetBusy() || !this.canHardReset()) return;
    if (this.hardResetWord().trim().toUpperCase() !== 'RESET') return;
    this.hardResetBusy.set(true);
    this.hardResetMessage.set(this.prefs.txt('Supabase-এর ডেটা মুছে ফেলা হচ্ছে…', 'Deleting Supabase data…'));
    try {
      const result = await this.session.hardReset();
      if (!result.ok) {
        this.hardResetMessage.set(this.hardResetError(result.error));
        this.hardResetBusy.set(false);
        return;
      }
      const done = this.prefs.txt(
        `সম্পন্ন — ${result.deleted ?? 0}টি সারি মুছে ফেলা হয়েছে। লগইন পেজে ফিরে যাওয়া হচ্ছে…`,
        `Done — ${result.deleted ?? 0} rows deleted. Returning to the login page…`
      );
      this.hardResetMessage.set(done);
      this.notify.success(done, this.prefs.txt('হার্ড রিসেট সম্পন্ন', 'Hard reset complete'));
      setTimeout(() => {
        if (typeof window !== 'undefined') window.location.reload();
      }, 900);
    } catch (error) {
      this.hardResetMessage.set(this.messageOf(error));
      this.hardResetBusy.set(false);
    }
  }

  private hardResetError(code?: string): string {
    if (code === 'forbidden') return this.prefs.txt('শুধু প্রাইমারি অ্যাডমিন এই কাজটি করতে পারেন।', 'Only the primary admin can do this.');
    if (code === 'cloud') return this.prefs.txt('ক্লাউড সেবা পাওয়া যাচ্ছে না।', 'Cloud service is unavailable.');
    if (code === 'incomplete') return this.prefs.txt(
      'সব ডেটা মুছে ফেলা যায়নি, তাই রিসেট সম্পূর্ণ হয়নি এবং এই ডিভাইসের ডেটা অক্ষত রাখা হয়েছে। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।',
      'Some data could not be deleted, so the reset is not complete and this device kept its data. Check the connection and try again.'
    );
    return this.prefs.txt('হার্ড রিসেট ব্যর্থ হয়েছে।', 'Hard reset failed.') + (code ? ` (${code})` : '');
  }

  userForm: {
    name: string; username: string; pin: string; currentPin: string; role: UserRole; active: boolean;
    permissions: Permission[]; photo: string;
  } = this.emptyUser();

  filteredLogs = computed(() => {
    const q = this.auditQuery().toLowerCase().trim();
    const category = this.auditCategory();
    let logs = this.session.auditLogs();
    if (category !== 'all') logs = logs.filter(l => l.category === category);
    if (!q) return logs;
    return logs.filter(l =>
      l.user.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      l.detail.toLowerCase().includes(q) ||
      l.role.toLowerCase().includes(q)
    );
  });

  readonly auditCategoryStats = computed(() => {
    const logs = this.session.auditLogs();
    const counts = new Map<AuditCategory, number>();
    for (const logItem of logs) counts.set(logItem.category, (counts.get(logItem.category) ?? 0) + 1);
    return {
      total: logs.length,
      items: AUDIT_CATEGORIES
        .filter(meta => counts.has(meta.key))
        .map(meta => ({ ...meta, count: counts.get(meta.key) ?? 0 }))
    };
  });

  readonly logsPager = createPager(() => this.filteredLogs());

  setAuditCategory(key: AuditCategory | 'all') {
    this.auditCategory.set(key);
    this.logsPager.setPage(1);
  }

  auditCategoryLabel(category: AuditCategory): string {
    const meta = AUDIT_CATEGORIES.find(item => item.key === category);
    if (!meta) return category;
    return this.prefs.language() === 'bn' ? meta.bn : meta.en;
  }

  auditCategoryClass(category: AuditCategory): string {
    switch (category) {
      case 'sales': return 'bg-emerald-100 text-emerald-800';
      case 'purchases': return 'bg-sky-100 text-sky-800';
      case 'battery': return 'bg-amber-100 text-amber-800';
      case 'parties': return 'bg-violet-100 text-violet-800';
      case 'products': return 'bg-teal-100 text-teal-800';
      case 'stock': return 'bg-lime-100 text-lime-800';
      case 'accounts': return 'bg-indigo-100 text-indigo-800';
      case 'warranty': return 'bg-fuchsia-100 text-fuchsia-800';
      case 'settings': return 'bg-slate-200 text-slate-700';
      case 'security': return 'bg-rose-100 text-rose-800';
      case 'data': return 'bg-cyan-100 text-cyan-800';
      default: return 'bg-slate-100 text-slate-600';
    }
  }

  auditChipClass(key: AuditCategory | 'all'): string {
    return this.auditCategory() === key
      ? 'inline-flex items-center gap-1 rounded-full bg-teal-600 px-2.5 py-1 text-[10px] font-bold text-white cursor-pointer'
      : 'inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-200 cursor-pointer dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';
  }

  async clearAuditLogs() {
    if (!this.session.has('manageSettings')) return;
    const confirmed = await this.notify.confirm(
      this.prefs.txt(
        'শেষ ৩ দিনের সব অডিট লগ স্থায়ীভাবে মুছে যাবে। এই কাজ ফেরানো যাবে না।',
        'Every audit entry from the last 3 days will be permanently deleted. This cannot be undone.'
      ),
      {
        title: this.prefs.txt('সব অডিট লগ মুছবেন?', 'Delete all audit logs?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছে ফেলুন', 'Delete all'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    this.session.clearAudit();
    this.session.log('Audit Cleared', this.prefs.txt('সব পুরোনো অডিট লগ মুছে ফেলা হয়েছে', 'All previous audit entries were deleted'));
    this.setAuditCategory('all');
    this.notify.success(this.prefs.txt('অডিট লগ মুছে ফেলা হয়েছে।', 'Audit log cleared.'));
  }

  roleLabel(role: UserRole): string {
    if (role === 'Admin') return this.prefs.t('role.admin');
    if (role === 'Salesman') return this.prefs.t('role.salesman');
    return this.prefs.t('role.accountant');
  }

  roleClass(role: UserRole): string {
    if (role === 'Admin') return 'bg-teal-100 text-teal-800';
    if (role === 'Salesman') return 'bg-amber-100 text-amber-800';
    return 'bg-indigo-100 text-indigo-800';
  }

  hasRole(role: UserRole, permission: Permission): boolean {
    return this.session.rolePermissions(role).includes(permission);
  }

  saveBusiness() {
    this.dataService.updateVoucherSettings({ ...this.business });
    this.session.log('Settings Changed', this.prefs.txt('ব্যবসার তথ্য ও ইনভয়েস সেটিংস আপডেট হয়েছে', 'Business info and invoice settings updated'));
    this.savedMsg.set(true);
    setTimeout(() => this.savedMsg.set(false), 2500);
  }

  accentLabel(key: AccentKey): string {
    const preset = this.prefs.accents.find(item => item.key === key);
    return preset ? (this.prefs.language() === 'bn' ? preset.bn : preset.en) : key;
  }

  themeModeLabel(): string {
    const mode = this.themeModes.find(item => item.key === this.prefs.themeMode());
    return mode ? this.prefs.txt(mode.bn, mode.en) : this.prefs.themeMode();
  }

  pickAccent(key: AccentKey) {
    const preset = this.prefs.accents.find(item => item.key === key);
    this.prefs.setAccent(key);
    this.session.log('Theme Changed', preset ? (this.prefs.language() === 'bn' ? preset.bn : preset.en) : key);
  }

  chooseThemeMode(mode: ThemeMode) {
    if (this.prefs.themeMode() === mode) return;
    this.prefs.setThemeMode(mode);
    const label = this.themeModes.find(item => item.key === mode);
    this.session.log('Theme Changed', this.prefs.txt(label?.bn ?? mode, label?.en ?? mode));
  }

  resetTheme() {
    this.prefs.resetTheme();
    this.session.log('Theme Changed', this.prefs.txt('ডিফল্ট রঙ ও থিমে ফেরা হয়েছে', 'Reset to the default theme'));
  }

  setTableHover(tone: TableHoverTone) {
    if (this.prefs.tableHover() === tone) return;
    this.prefs.setTableHover(tone);
    const label = this.prefs.tableHoverTones.find(item => item.key === tone);
    this.session.log('Theme Changed', this.prefs.txt(
      `টেবিল হোভার: ${label?.bn ?? tone}`,
      `Table hover: ${label?.en ?? tone}`
    ));
  }

  setTableBorder(mode: TableBorderMode) {
    if (this.prefs.tableBorder() === mode) return;
    this.prefs.setTableBorder(mode);
    const label = this.prefs.tableBorderModes.find(item => item.key === mode);
    this.session.log('Theme Changed', this.prefs.txt(
      `টেবিল বর্ডার: ${label?.bn ?? mode}`,
      `Table border: ${label?.en ?? mode}`
    ));
  }

  /** Small glyph on the border-mode buttons. */
  borderPreview(mode: TableBorderMode): string {
    if (mode === 'grid') return 'border border-slate-400';
    if (mode === 'bold') return 'border-2 border-slate-500';
    if (mode === 'none') return 'border border-dashed border-slate-300';
    return 'border-b border-slate-400';
  }

  warehouseProductCount(name: string): number {
    return this.dataService.products().filter(product => product.warehouse === name).length;
  }

  warehouseStock(name: string): number {
    const total = this.dataService.products()
      .filter(product => product.warehouse === name)
      .reduce((sum, product) => sum + (Number(product.stock) || 0), 0);
    return Math.round(total * 100) / 100;
  }

  async addWarehouse() {
    if (!this.session.has('manageSettings')) return;
    const name = await this.notify.prompt(
      this.prefs.txt('নতুন ওয়্যারহাউসের নাম দিন।', 'Enter a name for the new warehouse.'),
      '',
      {
        title: this.prefs.txt('নতুন ওয়্যারহাউস', 'New Warehouse'),
        inputLabel: this.prefs.txt('ওয়্যারহাউসের নাম', 'Warehouse name'),
        confirmText: this.prefs.txt('যুক্ত করুন', 'Add'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    const result = this.dataService.addWarehouse(name ?? '');
    if (!result.ok) {
      if (result.error === 'duplicate') {
        this.notify.error(this.prefs.txt(`"${(name ?? '').trim()}" আগে থেকেই আছে।`, `"${(name ?? '').trim()}" already exists.`));
      }
      return;
    }
    this.session.log('Warehouse Added', (name ?? '').trim());
  }

  async renameWarehouse(from: string) {
    if (!this.session.has('manageSettings')) return;
    const name = await this.notify.prompt(
      this.prefs.txt(`"${from}" এর নতুন নাম দিন। পণ্যগুলোও নতুন নামে চলে যাবে।`, `New name for "${from}". Its products will move too.`),
      from,
      {
        title: this.prefs.txt('ওয়্যারহাউস এডিট', 'Edit Warehouse'),
        inputLabel: this.prefs.txt('ওয়্যারহাউসের নাম', 'Warehouse name'),
        confirmText: this.prefs.txt('সেভ করুন', 'Save'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    const value = (name ?? '').trim();
    if (!value || value === from) return;
    const result = this.dataService.renameWarehouse(from, value);
    if (!result.ok) {
      if (result.error === 'duplicate') {
        this.notify.error(this.prefs.txt(`"${value}" আগে থেকেই আছে।`, `"${value}" already exists.`));
      }
      return;
    }
    this.session.log('Warehouse Renamed', `${from} → ${value}`);
  }

  async deleteWarehouse(name: string) {
    if (!this.session.has('manageSettings')) return;
    const used = this.warehouseProductCount(name);
    if (used > 0) {
      this.notify.error(this.prefs.txt(
        `"${name}" এ ${used}টি পণ্য আছে — আগে পণ্যগুলো অন্য ওয়্যারহাউসে নিন।`,
        `"${name}" still holds ${used} product${used === 1 ? '' : 's'} — move them first.`
      ));
      return;
    }
    const confirmed = await this.notify.confirm(
      this.prefs.txt(`"${name}" ওয়্যারহাউসটি মুছে যাবে।`, `Warehouse "${name}" will be removed.`),
      {
        title: this.prefs.txt('ওয়্যারহাউস ডিলিট করবেন?', 'Delete warehouse?'),
        kind: 'error',
        confirmText: this.prefs.txt('ডিলিট', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    const result = this.dataService.deleteWarehouse(name);
    if (!result.ok) {
      if (result.error === 'last') {
        this.notify.error(this.prefs.txt('অন্তত একটি ওয়্যারহাউস থাকতে হবে।', 'At least one warehouse must remain.'));
      } else if (result.error === 'inUse') {
        this.notify.error(this.prefs.txt('এই ওয়্যারহাউসে পণ্য আছে।', 'This warehouse still has products.'));
      }
      return;
    }
    this.session.log('Warehouse Deleted', name);
  }

  async addUnit() {
    if (!this.session.has('manageSettings')) return;
    const name = await this.notify.prompt(
      this.prefs.txt('নতুন এককের নাম দিন (যেমন: পিস, কেজি, লিটার)।', 'Enter a name for the new unit (e.g. pcs, kg, litre).'),
      '',
      {
        title: this.prefs.txt('নতুন একক', 'New Unit'),
        inputLabel: this.prefs.txt('এককের নাম', 'Unit name'),
        confirmText: this.prefs.txt('যুক্ত করুন', 'Add'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    const value = (name ?? '').trim();
    const result = this.dataService.addUnit(value);
    if (!result.ok) {
      if (result.error === 'duplicate') {
        this.notify.error(this.prefs.txt(`"${value}" আগে থেকেই আছে।`, `"${value}" already exists.`));
      }
      return;
    }
    this.session.log('Unit Added', value);
  }

  async renameUnit(unit: UnitOption) {
    if (!this.session.has('manageSettings')) return;
    const name = await this.notify.prompt(
      this.prefs.txt(`"${unit.name}" এর নতুন নাম দিন। এই এককের পণ্যগুলোও নতুন নামে চলে যাবে।`, `New name for "${unit.name}". Products using it will move too.`),
      unit.name,
      {
        title: this.prefs.txt('একক এডিট', 'Edit Unit'),
        inputLabel: this.prefs.txt('এককের নাম', 'Unit name'),
        confirmText: this.prefs.txt('সেভ করুন', 'Save'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    const value = (name ?? '').trim();
    if (!value || value === unit.name) return;
    const result = this.dataService.renameUnit(unit.id, value);
    if (!result.ok) {
      if (result.error === 'duplicate') {
        this.notify.error(this.prefs.txt(`"${value}" আগে থেকেই আছে।`, `"${value}" already exists.`));
      }
      return;
    }
    this.session.log('Unit Renamed', `${unit.name} → ${value}`);
  }

  setDefaultUnit(unit: UnitOption) {
    if (!this.session.has('manageSettings') || unit.isDefault) return;
    this.dataService.setDefaultUnit(unit.id);
    this.session.log('Default Unit Set', unit.name);
  }

  async deleteUnit(unit: UnitOption) {
    if (!this.session.has('manageSettings')) return;
    if (unit.isDefault) {
      this.notify.error(this.prefs.txt('ডিফল্ট একক ডিলিট করা যায় না — আগে অন্য একককে ডিফল্ট করুন।', 'The default unit cannot be deleted — make another unit the default first.'));
      return;
    }
    const used = this.dataService.unitProductCount(unit.name);
    if (used > 0) {
      this.notify.error(this.prefs.txt(
        `"${unit.name}" এককটি ${used}টি পণ্যে ব্যবহৃত হচ্ছে — আগে পণ্যগুলোর একক বদলান।`,
        `"${unit.name}" is used by ${used} product${used === 1 ? '' : 's'} — change their unit first.`
      ));
      return;
    }
    const confirmed = await this.notify.confirm(
      this.prefs.txt(`"${unit.name}" এককটি মুছে যাবে।`, `Unit "${unit.name}" will be removed.`),
      {
        title: this.prefs.txt('একক ডিলিট করবেন?', 'Delete unit?'),
        kind: 'error',
        confirmText: this.prefs.txt('ডিলিট', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    const result = this.dataService.deleteUnit(unit.id);
    if (!result.ok) {
      this.notify.error(this.prefs.txt('এককটি ডিলিট করা যায়নি।', 'The unit could not be deleted.'));
      return;
    }
    this.session.log('Unit Deleted', unit.name);
  }

  resetBusiness() {
    this.dataService.resetVoucherSettings();
    this.business = { ...this.dataService.voucherSettings() };
    this.session.log('Settings Reset', this.prefs.txt('ইনভয়েস সেটিংস ডিফল্টে ফিরিয়ে নেওয়া হয়েছে', 'Invoice settings reset to defaults'));
  }

  emptyUser(): {
    name: string; username: string; pin: string; currentPin: string; role: UserRole; active: boolean;
    permissions: Permission[]; photo: string;
  } {
    // Start from the role defaults so a new account is immediately usable.
    return {
      name: '', username: '', pin: '', currentPin: '', role: 'Salesman', active: true,
      permissions: this.session.rolePermissions('Salesman'), photo: ''
    };
  }

  openUserModal(user?: UserAccount) {
    this.userError.set('');
    this.showUserPin.set(false);
    if (user) {
      this.editingUserId.set(user.id);
      // Passwords are hashed, so the stored one can never be shown; blank means "keep it".
      this.userForm = {
        name: user.name, username: user.username, pin: '', currentPin: '', role: user.role, active: user.active,
        permissions: this.session.permissionsOf(user), photo: user.photo || ''
      };
    } else {
      this.editingUserId.set(null);
      this.userForm = this.emptyUser();
    }
    this.showUserModal.set(true);
  }

  mainAdminForm(): boolean {
    const id = this.editingUserId();
    const user = id ? this.session.users().find(u => u.id === id) : null;
    return !!user && this.session.isMain(user);
  }

  /** Changing your own password needs the old one; changing another user's does not. */
  needsCurrentPin(): boolean {
    const id = this.editingUserId();
    return !!id && this.session.currentUser()?.id === id;
  }

  formInitial(): string {
    return (this.userForm.name || this.userForm.username || 'U').trim().charAt(0) || 'U';
  }

  userInitial(user: UserAccount): string {
    return (user.name || user.username || 'U').trim().charAt(0) || 'U';
  }

  onUserRoleChange(role: UserRole) {
    this.userForm.role = role;
    if (this.mainAdminForm()) return;
    // A role change reseeds the sensible defaults; the admin can still fine-tune after.
    this.userForm.permissions = this.session.rolePermissions(role);
  }

  toggleUserPermission(permission: Permission) {
    if (this.mainAdminForm()) return;
    const list = this.userForm.permissions;
    this.userForm.permissions = list.includes(permission)
      ? list.filter(item => item !== permission)
      : [...list, permission];
  }

  allUserPermissions(): boolean {
    return this.permissionRows.every(row => this.userForm.permissions.includes(row.key));
  }

  toggleAllUserPermissions() {
    if (this.mainAdminForm()) return;
    this.userForm.permissions = this.allUserPermissions() ? [] : this.permissionRows.map(row => row.key);
  }

  async onUserPhoto(e: Event) {
    const result = await this.media.pick(e, 'avatars', this.userForm.username || 'user', 5, { maxPx: 200, maxBytes: 40_000 });
    if (!result.ok) {
      if (result.error) this.notify.error(result.error);
      return;
    }
    this.userForm.photo = result.image.ref;
  }

  async saveUser() {
    const editingId = this.editingUserId();
    const result = editingId
      ? await this.session.updateUser({ ...this.userForm, id: editingId })
      : this.session.addUser({ ...this.userForm });

    if (!result.ok) {
      this.userError.set(result.error || 'required');
      return;
    }
    this.showUserModal.set(false);
  }

  async deleteUser(user: UserAccount) {
    const confirmed = await this.notify.confirm(
      this.prefs.txt(
        `${user.name} কে ডিলিট করবেন? এই ইউজার আর লগইন করতে পারবেন না।`,
        `Delete ${user.name}? This user will no longer be able to log in.`
      ),
      {
        title: this.prefs.txt('ইউজার ডিলিট করবেন?', 'Delete user?'),
        kind: 'error',
        confirmText: this.prefs.txt('ডিলিট', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    const result = this.session.deleteUser(user.id);
    if (!result.ok) {
      this.notify.error(this.prefs.txt('ইউজার মুছে ফেলা যায়নি। অনুমতি ও অ্যাডমিন অ্যাকাউন্ট যাচাই করুন।', 'Could not delete the user. Check permissions and administrator account protections.'));
      return;
    }
    this.notify.success(this.prefs.txt(`${user.name} কে ডিলিট করা হয়েছে।`, `${user.name} has been deleted.`));
  }

  exportAudit() {
    const rows = this.filteredLogs().map(l => ({
      Time: new Date(l.at).toLocaleString('en-GB'),
      Category: this.auditCategoryLabel(l.category),
      User: l.user,
      Role: l.role,
      Action: l.action,
      Detail: l.detail
    }));
    void downloadWorkbook(`audit-log-${localDateIso()}.xlsx`, [{ name: 'Audit Log', rows }])
      .then(() => this.session.log('Audit Exported', this.prefs.txt(`${rows.length} টি অডিট এন্ট্রি এক্সপোর্ট হয়েছে`, `${rows.length} audit entries exported`)))
      .catch(error => this.notify.error(this.messageOf(error), this.prefs.txt('এক্সপোর্ট ব্যর্থ', 'Export failed')));
  }

  // ------------------------------------------------------------------
  // FILE DATA BACKUP
  // ------------------------------------------------------------------
  async exportFile() {
    try {
      const result = await this.backup.download();
      this.session.log('Backup Exported', `${result.name} · ${Math.round(result.bytes / 1024)} KB`);
      this.notify.success(this.prefs.txt('ব্যাকআপ ফাইল ডাউনলোড হয়েছে।', 'Backup file downloaded.'));
      void this.database.usage().then(value => this.dbStats.set(value));
    } catch (error) {
      this.notify.error(this.messageOf(error), this.prefs.txt('ব্যাকআপ ব্যর্থ', 'Backup failed'));
    }
  }

  async onBackupFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.stage(await this.backup.parse(file));
    } catch (error) {
      this.notify.error(this.messageOf(error), this.prefs.txt('ফাইল পড়া যায়নি', 'Could not read file'));
    }
  }

  async runImport() {
    const payload = this.stagedPayload;
    if (!payload) return;
    const replace = this.importMode === 'replace';
    const confirmed = await this.notify.confirm(
      replace
        ? this.prefs.txt(
          'ব্যাকআপের ডাটা বর্তমান সব ডাটার জায়গায় বসবে। এরপর এ্যাপ রিলোড হবে — এগিয়ে যাবেন?',
          'Backup data will replace all current data. The app will reload afterwards — continue?'
        )
        : this.prefs.txt(
          'ব্যাকআপের ডাটা বর্তমান ডাটার সাথে মিলিয়ে নেওয়া হবে। এরপর এ্যাপ রিলোড হবে — এগিয়ে যাবেন?',
          'Backup data will be merged with current data. The app will reload afterwards — continue?'
        ),
      {
        title: this.prefs.txt('ইমপোর্ট করবেন?', 'Import?'),
        kind: replace ? 'error' : 'warning',
        confirmText: this.prefs.txt('ইমপোর্ট', 'Import'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    try {
      const summary = await this.backup.restore(payload, this.importMode);
      this.session.log('Backup Imported', `${this.importMode}: ${summary}`);
      await this.notify.confirm(summary, {
        title: this.prefs.txt('রিস্টোর সম্পন্ন — অটো সিঙ্ক বন্ধ', 'Restore complete — auto-sync is off'),
        kind: 'warning',
        confirmText: this.prefs.txt('বুঝেছি', 'Understood'),
        cancelText: this.prefs.txt('বন্ধ করুন', 'Close')
      });
      location.reload();
    } catch (error) {
      this.notify.error(this.messageOf(error), this.prefs.txt('ইমপোর্ট ব্যর্থ', 'Import failed'));
    }
  }

  toggleAutoBackup(value: boolean) {
    if (!this.session.has('manageSettings')) return;
    this.backup.setAutoBackup(value);
    this.session.log('Cloud Backup', value
      ? this.prefs.txt('প্রতিদিন স্বয়ংক্রিয় Cloudinary ব্যাকআপ চালু', 'Daily automatic Cloudinary backup enabled')
      : this.prefs.txt('প্রতিদিন স্বয়ংক্রিয় Cloudinary ব্যাকআপ বন্ধ', 'Daily automatic Cloudinary backup disabled'));
  }

  async sendCloudBackup() {
    if (!this.session.has('manageSettings')) return;
    try {
      const entry = await this.backup.push();
      this.backup.listBackups();
      this.session.log('Cloud Backup', this.prefs.txt(`${entry.name} Cloudinary-তে পাঠানো হয়েছে`, `${entry.name} sent to Cloudinary`));
      this.notify.success(this.prefs.txt('ব্যাকআপ Cloudinary-তে জমা হয়েছে।', 'Backup saved to Cloudinary.'));
    } catch (error) {
      this.notify.error(this.messageOf(error), this.prefs.txt('Cloudinary আপলোড ব্যর্থ', 'Cloudinary upload failed'));
    }
  }

  refreshCloudBackups() {
    if (!this.session.has('manageSettings')) return;
    const count = this.backup.listBackups().length;
    this.notify.info(this.prefs.txt(`${count} টি ব্যাকআপ তালিকায় আছে।`, `${count} backups in the list.`));
  }

  async restoreFromCloud(file: CloudBackupEntry) {
    if (!this.session.has('manageSettings')) return;
    try {
      this.stage(await this.backup.downloadEntry(file));
      this.notify.info(this.prefs.txt(
        'Cloudinary থেকে ফাইল পড়া হয়েছে — এখন উপরের "ইমপোর্ট করে এ্যাপ রিলোড করুন" চাপুন।',
        'File loaded from Cloudinary — now press "Import and reload app" above.'
      ));
    } catch (error) {
      this.notify.error(this.messageOf(error), this.prefs.txt('ডাউনলোড ব্যর্থ', 'Download failed'));
    }
  }

  async forgetCloudBackup(file: CloudBackupEntry) {
    if (!this.session.has('manageSettings')) return;
    const confirmed = await this.notify.confirm(
      this.prefs.txt(
        `${file.name} তালিকা থেকে সরাবেন? Cloudinary-র ফাইলটি নিজে থেকে মুছবে না।`,
        `Remove ${file.name} from the list? The Cloudinary file itself stays.`
      ),
      {
        title: this.prefs.txt('তালিকা থেকে সরান', 'Remove from list'),
        kind: 'warning',
        confirmText: this.prefs.txt('সরান', 'Remove'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!confirmed) return;
    this.backup.removeEntry(file);
    this.notify.success(this.prefs.txt('তালিকা থেকে সরানো হয়েছে।', 'Removed from the list.'));
  }

  private stage(payload: BackupPayload) {
    this.stagedPayload = payload;
    const keys = Object.keys(payload.collections ?? {});
    const records = keys.reduce((sum, key) => {
      const value = payload.collections[key];
      return sum + (Array.isArray(value) ? value.length : 1);
    }, 0);
    this.staged.set({
      label: payload.exportedAt
        ? this.prefs.txt(
          `ব্যাকআপ: ${new Date(payload.exportedAt).toLocaleString('en-GB')}`,
          `Backup: ${new Date(payload.exportedAt).toLocaleString('en-GB')}`
        )
        : this.prefs.txt('ব্যাকআপ ফাইল', 'Backup file'),
      collections: keys.length,
      records,
      media: (payload.media ?? []).length
    });
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
