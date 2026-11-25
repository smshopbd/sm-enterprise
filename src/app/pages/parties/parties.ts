import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, computed, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import {
  DataService, Party, PartyType, SALES_PARTY_TYPES,
  accountOf, hasPartyRole, partyPhoneKey, partyPhones, partyRoles, purchaseAccountOf, salesAccountOf
} from '../../services/data';
import { NotificationService } from '../../services/notification';
import { MediaService } from '../../services/media';
import { PreferencesService } from '../../services/preferences';
import { SessionService } from '../../services/session';
import { PartyLedger } from '../../components/party-ledger/party-ledger';
import { PasscodeModal } from '../../components/passcode-modal/passcode-modal';
import { PartyListDocument, PartyListRow } from '../../components/party-list-document/party-list-document';
import { GeoSelect } from '../../components/geo-select/geo-select';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';
import { localDateIso } from '../../utils/local-date';
import { downloadPartyDocx } from '../../utils/party-docx';
import { geoDivisionOfDistrict, geoNormalizeDistrict, localizeAddress, stripRegionNames } from '../../utils/bd-geo';
import {
  ColumnLayout, ColumnSpec, ResolvedColumn,
  clampLayoutWidth, defaultColumnLayout, loadColumnLayout, saveColumnLayout
} from '../../utils/column-layout';
import { persistedSignal } from '../../utils/persisted-signal';
import { reorderInView } from '../../utils/reorder';

const PARTY_TABS = ['All', 'Customer', 'Corporate Customer', 'Supplier', 'Dealer', 'Staff Member'];

const PARTY_TABLE_COLUMNS: ColumnSpec[] = [
  { key: 'sl', label: 'SL', align: 'center', width: 52, min: 40, max: 72 },
  { key: 'company', label: 'COMPANY NAME', align: 'left', width: 190, min: 100 },
  { key: 'name', label: 'PARTY NAME', align: 'left', width: 210, min: 140 },
  { key: 'type', label: 'TYPE', align: 'left', width: 130, min: 96 },
  { key: 'total', label: 'TOTAL', align: 'right', width: 120, min: 84 },
  { key: 'paid', label: 'PAID', align: 'right', width: 125, min: 84 },
  { key: 'due', label: 'DUE', align: 'right', width: 165, min: 110 },
  { key: 'status', label: 'STATUS', align: 'center', width: 96, min: 78 },
  { key: 'inHand', label: 'IN-HAND', align: 'center', width: 88, min: 66 },
  { key: 'createdAt', label: 'CREATED AT', align: 'left', width: 108, min: 88 },
  { key: 'address', label: 'ADDRESS', align: 'left', width: 190, min: 130 },
  { key: 'action', label: 'ACTION', align: 'center', width: 164, min: 112 }
];

const PARTY_COL_SPECS: Record<string, ColumnSpec> = {};
for (const spec of PARTY_TABLE_COLUMNS) PARTY_COL_SPECS[spec.key] = spec;

const PARTY_TABLE_VIEW_KEY = 'sm_parties_table_view_v1';
const PARTY_SORT_KEY = 'sm_parties_sort_key_v1';
const PARTY_SORT_DIR_KEY = 'sm_parties_sort_dir_v1';
const PARTY_SORTABLE = new Set(['company', 'name', 'type', 'total', 'paid', 'due', 'status', 'inHand', 'createdAt', 'address']);

@Component({
  selector: 'app-parties',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, DragDropModule, PartyLedger, PasscodeModal, PartyListDocument, GeoSelect, TablePagination],
  styles: `
    /* Sticky column-title band so rows scroll under the teal header. */
    .pt-sticky {
      position: sticky;
      top: 0;
      z-index: 5;
      background-color: var(--sm-brand, #0d9488);
    }
    .pt-table { table-layout: fixed; }
    .pt-table th { position: relative; overflow: hidden; }
    .pt-table td { overflow: hidden; }
    .pt-col-head {
      display: flex;
      align-items: center;
      gap: 3px;
      min-width: 0;
    }
    .pt-col-head.right { justify-content: flex-end; }
    .pt-col-head.center { justify-content: center; }
    .pt-col-head .col-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pt-col-head .col-grip { line-height: 1; color: rgba(255, 255, 255, 0.55); cursor: grab; }
    .pt-col-head .col-grip:hover { color: #fff; }
    /* The drag preview leaves the teal header, so white text needs a dark tint. */
    .pt-table th.cdk-drag-preview { color: #0f766e; background-color: #fff; }
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
              <mat-icon class="text-xl">groups</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                {{ prefs.txt('ড্যাশবোর্ড', 'Dashboard') }}
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                {{ prefs.txt('পার্টি', 'Parties') }}
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('পার্টি', 'Parties') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('গ্রাহক, সরবরাহকারী, ডিলার ও কর্মীদের হিসাব এক জায়গায়।', 'Customers, suppliers, dealers and staff accounts in one place.') }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button (click)="exportExcel()" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer">
              <mat-icon class="text-xs">description</mat-icon> Excel
            </button>
            <button (click)="exportWord()" [disabled]="wordBusy()"
              class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 disabled:cursor-wait disabled:opacity-60 cursor-pointer">
              <mat-icon class="text-xs">{{ wordBusy() ? 'hourglass_top' : 'article' }}</mat-icon> Word
            </button>
            <button (click)="openListDocument()" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer">
              <mat-icon class="text-xs">picture_as_pdf</mat-icon> {{ prefs.txt('প্রিন্ট / PDF', 'Print / PDF') }}
            </button>
            <button (click)="openAddModal()" class="inline-flex items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 transition hover:bg-teal-50 cursor-pointer">
              <mat-icon class="text-xs">add</mat-icon> {{ prefs.txt('নতুন পার্টি', 'Add New') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Category Tabs -->
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

      <!-- Search Bar, Summary & Import -->
      <div class="no-print bg-white p-3 rounded-xl shadow-xs border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div class="relative w-full sm:max-w-sm">
          <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
          <input
            type="text"
            [placeholder]="prefs.txt('নাম, ফোন, ঠিকানা বা কোম্পানি দিয়ে খুঁজুন...', 'Search by name, phone, address or company...')"
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            class="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-400 focus:outline-none"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ activeTabLabel() }} · {{ filteredParties().length }} {{ prefs.txt('জন', 'parties') }}
          </span>
          <span class="px-2.5 py-1 rounded-lg border"
            [class]="activeTab() === 'Supplier' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-teal-50 border-teal-200 text-teal-700'">
            {{ accountScopeLabel() }}
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ prefs.txt('মোট', 'Total') }} <b class="font-mono text-slate-800">{{ totals().total | number:'1.2-2' }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            {{ prefs.txt('পরিশোধিত', 'Paid') }} <b class="font-mono text-emerald-600 dark:text-emerald-400">{{ totals().paid | number:'1.2-2' }}</b>
          </span>
          <span class="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200">
            {{ activeTab() === 'Supplier' ? prefs.txt('প্রদেয়', 'Payable') : (activeTab() === 'All' ? prefs.txt('নেট বাকি', 'Net due') : prefs.txt('বাকি', 'Due')) }}
            <b class="font-mono text-rose-600 dark:text-rose-400">{{ totals().due | number:'1.2-2' }}</b>
          </span>
          <div class="hidden lg:flex items-center rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200/70 dark:bg-slate-800/70 dark:ring-slate-700" role="group" [attr.aria-label]="prefs.txt('ভিউ মোড', 'View mode')">
            <button
              (click)="viewMode.set('list')"
              [class]="viewMode() === 'list' ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-900 dark:text-teal-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'"
              class="px-2 py-1.5 rounded-md flex items-center gap-1 text-[11px] font-bold transition-colors cursor-pointer"
              [title]="prefs.txt('তালিকা ভিউ', 'List view')">
              <mat-icon class="text-sm">view_list</mat-icon>
              <span class="hidden xl:inline">{{ prefs.txt('তালিকা', 'List') }}</span>
            </button>
            <button
              (click)="viewMode.set('grid')"
              [class]="viewMode() === 'grid' ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-900 dark:text-teal-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'"
              class="px-2 py-1.5 rounded-md flex items-center gap-1 text-[11px] font-bold transition-colors cursor-pointer"
              [title]="prefs.txt('গ্রিড ভিউ', 'Grid view')">
              <mat-icon class="text-sm">grid_view</mat-icon>
              <span class="hidden xl:inline">{{ prefs.txt('গ্রিড', 'Grid') }}</span>
            </button>
          </div>

          @if (viewMode() === 'list') {
            <div class="relative hidden lg:block" data-party-columns-root>
              <button (click)="toggleColumnSelector()" class="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                <mat-icon class="text-sm text-teal-600">view_column</mat-icon>
                <span class="hidden xl:inline">{{ prefs.txt('কলাম', 'Columns') }}</span>
                <mat-icon class="text-xs">expand_more</mat-icon>
              </button>

              @if (showColumnSelector()) {
                <div class="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <div class="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                    <span class="flex items-center gap-1 text-xs font-bold">
                      <mat-icon class="text-xs text-teal-600">tune</mat-icon> {{ prefs.txt('কলাম সাজান', 'Arrange columns') }}
                    </span>
                    <button (click)="showColumnSelector.set(false)" class="text-slate-400 hover:text-slate-700 cursor-pointer" [attr.aria-label]="prefs.txt('বন্ধ', 'Close')">
                      <mat-icon class="text-sm">close</mat-icon>
                    </button>
                  </div>

                  <div class="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
                    @for (c of allColumns(); track c.key; let i = $index) {
                      <div class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <input type="checkbox" class="size-3.5 rounded accent-teal-600" [checked]="c.visible" [disabled]="!c.toggleable" (change)="toggleColumn(c.key)">
                        <span class="flex-1 truncate text-[11px] font-semibold">{{ colLabel(c.key) }}</span>
                        <span class="font-mono text-[9px] text-slate-400">{{ c.width }}px</span>
                        <button (click)="moveColumn(c.key, -1)" [disabled]="i === 0" class="rounded p-0.5 text-slate-400 hover:text-teal-600 disabled:opacity-25 cursor-pointer" [attr.aria-label]="prefs.txt('উপরে নিন', 'Move up')">
                          <mat-icon class="text-sm">arrow_upward</mat-icon>
                        </button>
                        <button (click)="moveColumn(c.key, 1)" [disabled]="i === allColumns().length - 1" class="rounded p-0.5 text-slate-400 hover:text-teal-600 disabled:opacity-25 cursor-pointer" [attr.aria-label]="prefs.txt('নিচে নিন', 'Move down')">
                          <mat-icon class="text-sm">arrow_downward</mat-icon>
                        </button>
                      </div>
                    }
                  </div>

                  <div class="mt-2 flex items-start gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[9.5px] font-medium leading-snug text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                    <mat-icon class="shrink-0 text-xs text-teal-500">drag_indicator</mat-icon>
                    <span>{{ prefs.txt('টেবিলের হেডার টেনে কলামের ক্রম বদলান, ডান প্রান্ত টেনে চওড়া করুন। হেডারে ক্লিক করে সারি সাজান।', 'Drag a header to reorder, drag its right edge to resize, click a header to sort rows.') }}</span>
                  </div>

                  <div class="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                    <button (click)="selectAllColumns()" class="text-[10px] font-bold text-teal-600 hover:text-teal-800 cursor-pointer">{{ prefs.txt('সব দেখান', 'Show all') }}</button>
                    <button (click)="resetColumns()" class="text-[10px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer">{{ prefs.txt('ডিফল্ট', 'Reset default') }}</button>
                  </div>
                </div>
              }
            </div>
          }

          <label class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg cursor-pointer flex items-center gap-1 border border-slate-300">
            <mat-icon class="text-xs">upload_file</mat-icon> Import Excel
            <input type="file" accept=".xlsx,.csv" (change)="onFileImport($event)" class="hidden">
          </label>
        </div>
      </div>

      <!-- List View: parties table (desktop / print) -->
      <div class="list-print-shell hidden lg:block bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden"
        [style.display]="viewMode() === 'grid' ? 'none' : null">
        <div class="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold text-slate-400 dark:border-slate-800 dark:text-slate-500">
          <span class="inline-flex items-center gap-1">
            <mat-icon class="text-xs text-teal-500">swipe</mat-icon>
            {{ prefs.txt('হেডার টেনে কলাম সাজান · হেডারে ক্লিক করে সারি সাজান', 'Drag headers to arrange columns · click a header to sort rows') }}
          </span>
          @if (sortKey()) {
            <button (click)="clearSort()" class="inline-flex items-center gap-1 rounded-md bg-teal-50 px-2 py-0.5 font-bold text-teal-700 hover:bg-teal-100 cursor-pointer dark:bg-teal-900/40 dark:text-teal-300">
              {{ colLabel(sortKey()) }} · {{ sortDir() === 'asc' ? prefs.txt('ঊর্ধ্বক্রম', 'asc') : prefs.txt('নিম্নক্রম', 'desc') }}
              <mat-icon class="text-xs">close</mat-icon>
            </button>
          }
        </div>
        <div id="list-printable-area" class="overflow-auto max-h-[72vh]">
          <table class="pt-table text-xs text-left border-collapse text-slate-700 dark:text-slate-200"
            [style.width.px]="tableWidthPx()" [style.minWidth.px]="tableWidthPx()">
            <colgroup>
              @for (c of visibleCols(); track c.key) {
                <col [attr.data-col]="c.key" [style.width.px]="c.width">
              }
            </colgroup>
            <thead>
              <tr class="text-white font-bold uppercase text-[11px] tracking-wider" cdkDropList orientation="horizontal" (cdkDropListDropped)="onColumnDrop($event)">
                @for (c of visibleCols(); track c.key) {
                  <th class="p-2.5 pt-sticky"
                    [class.text-right]="c.align === 'right'"
                    [class.text-center]="c.align === 'center'"
                    cdkDrag cdkDragLockAxis="x">
                    <div class="pt-col-head" [class.right]="c.align === 'right'" [class.center]="c.align === 'center'">
                      <mat-icon class="col-grip text-[13px]" cdkDragHandle
                        [title]="prefs.txt('টেনে কলাম সরান', 'Drag to move column')">drag_indicator</mat-icon>
                      @if (isSortable(c.key)) {
                        <button (click)="sortBy(c.key)" class="flex min-w-0 items-center gap-0.5 font-bold uppercase tracking-wider cursor-pointer hover:text-teal-50"
                          [title]="prefs.txt('এই কলামে সারি সাজান', 'Sort rows by this column')">
                          <span class="col-label">{{ colLabel(c.key) }}</span>
                          <mat-icon class="shrink-0 text-[12px]" [class.opacity-40]="sortKey() !== c.key">{{ sortIcon(c.key) }}</mat-icon>
                        </button>
                      } @else {
                        <span class="col-label">{{ colLabel(c.key) }}</span>
                      }
                    </div>
                    <span class="col-resizer" [title]="prefs.txt('টেনে কলামের চওড়া বদলান', 'Drag to resize column')"
                      (mousedown)="startColumnResize($event, c.key)" (click)="$event.stopPropagation()"></span>
                  </th>
                }
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (p of pager.paged(); track p.id; let idx = $index) {
                <tr
                  (click)="viewParty(p)"
                  (keydown.enter)="viewParty(p)"
                  tabindex="0"
                  [attr.aria-label]="prefs.txt(p.name + ' এর তথ্য দেখুন', 'View details of ' + p.name)"
                  class="cursor-pointer hover:bg-teal-50/70 focus-visible:bg-teal-50 focus-visible:outline-none active:bg-teal-100/60 transition-colors"
                >
                  @for (c of visibleCols(); track c.key) {
                    @switch (c.key) {
                      @case ('sl') {
                        <td class="p-2.5 text-center font-bold text-slate-500">{{ pager.offset() + idx + 1 }}</td>
                      }
                      @case ('company') {
                        <td class="p-2.5">
                          <div class="truncate font-semibold text-slate-700 dark:text-slate-300" [title]="p.companyName || ''">
                            {{ p.companyName && p.companyName !== 'N/A' ? p.companyName : '—' }}
                          </div>
                        </td>
                      }
                      @case ('name') {
                        <td class="p-2.5">
                          <button
                            (click)="$event.stopPropagation(); viewParty(p)"
                            [title]="prefs.txt('দেখুন: লেনদেন, বাকি ও সকল তথ্য', 'View ledger, dues and all details')"
                            class="group flex items-center gap-1.5 min-w-0 text-left cursor-pointer"
                          >
                            @if (avatarUrl(p)) {
                              <img [src]="avatarUrl(p)" alt="Avatar" class="w-6 h-6 rounded-full object-cover border border-slate-200 shrink-0" loading="lazy" decoding="async">
                            } @else {
                              <span class="w-6 h-6 rounded-full bg-teal-700/15 text-teal-700 dark:text-teal-300 flex items-center justify-center text-[10px] font-black shrink-0">{{ initials(p.name) }}</span>
                            }
                            <span class="font-bold text-teal-800 dark:text-teal-300 truncate group-hover:underline">{{ p.name }}</span>
                          </button>
                        </td>
                      }
                      @case ('type') {
                        <td class="p-2.5">
                          <div class="flex flex-wrap gap-0.5">
                            @for (role of rolesOf(p); track role) {
                              <span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold whitespace-nowrap" [class]="typeBadge(role)">{{ typeLabel(role) }}</span>
                            }
                          </div>
                        </td>
                      }
                      @case ('total') {
                        <td class="p-2.5 text-right font-mono font-bold text-slate-800 dark:text-slate-100">{{ rowTotal(p) | number:'1.2-2' }} TK</td>
                      }
                      @case ('paid') {
                        <td class="p-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{{ rowPaid(p) | number:'1.2-2' }} TK</td>
                      }
                      @case ('due') {
                        <td class="p-2.5 text-right font-mono font-bold" [class]="dueTextClass(rowDue(p))">
                          <span class="inline-flex items-center gap-0.5">
                            @if (rowDue(p) > 0) {
                              <mat-icon class="text-[10px]">south</mat-icon>
                            } @else if (rowDue(p) < 0) {
                              <mat-icon class="text-[10px]">north</mat-icon>
                            }
                            {{ (rowDue(p) < 0 ? -rowDue(p) : rowDue(p)) | number:'1.2-2' }} TK
                            <span class="text-[9px] font-bold uppercase opacity-80">{{ dueCaption(rowDue(p)) }}</span>
                          </span>
                        </td>
                      }
                      @case ('status') {
                        <td class="p-2.5 text-center">
                          <span [class]="p.status === 'Enabled' ? 'bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold' : 'bg-rose-100 text-rose-800 px-2 py-0.5 rounded text-[10px] font-bold'">{{ p.status }}</span>
                        </td>
                      }
                      @case ('inHand') {
                        <td class="p-2.5 text-center font-semibold text-slate-600 dark:text-slate-300">{{ p.inHand }}</td>
                      }
                      @case ('createdAt') {
                        <td class="p-2.5 text-slate-500 whitespace-nowrap dark:text-slate-400">{{ displayDate(p.createdAt) }}</td>
                      }
                      @case ('address') {
                        <td class="p-2.5 text-slate-600 dark:text-slate-300">
                          <div class="truncate" [title]="addressLabel(p)">{{ addressLabel(p) }}</div>
                        </td>
                      }
                      @case ('action') {
                        <td class="p-2.5 text-center">
                          <div class="flex items-center justify-center gap-1">
                            <button (click)="$event.stopPropagation(); viewParty(p)" class="p-1 text-teal-600 hover:bg-teal-100 rounded cursor-pointer" [title]="prefs.txt('প্রোফাইল ও লেনদেন দেখুন', 'View profile and ledger')">
                              <mat-icon class="text-sm">menu_book</mat-icon>
                            </button>
                            <button (click)="$event.stopPropagation(); openEditModal(p)" class="p-1 text-amber-600 hover:bg-amber-100 rounded cursor-pointer" [title]="prefs.txt('পার্টি সম্পাদনা', 'Edit Party')">
                              <mat-icon class="text-sm">edit</mat-icon>
                            </button>
                            <button (click)="$event.stopPropagation(); payParty(p)" class="p-1 text-emerald-600 hover:bg-emerald-100 rounded cursor-pointer" [title]="prefs.txt('জমা রেকর্ড করুন', 'Record Payment')">
                              <mat-icon class="text-sm">attach_money</mat-icon>
                            </button>
                            @if (canEditPartyMoney()) {
                              <button (click)="$event.stopPropagation(); openBalanceDialog(p)" class="p-1 text-sky-600 hover:bg-sky-100 rounded cursor-pointer" [title]="prefs.txt('ওপেনিং ব্যালেন্স সংশোধন (অ্যাডমিন)', 'Correct opening balance (admin)')">
                                <mat-icon class="text-sm">currency_exchange</mat-icon>
                              </button>
                            }
                            @if (session.has('deleteRecords')) {
                              <button (click)="$event.stopPropagation(); deleteParty(p.id)" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer" [title]="prefs.txt('পার্টি মুছুন', 'Delete Party')">
                                <mat-icon class="text-sm">delete</mat-icon>
                              </button>
                            }
                          </div>
                        </td>
                      }
                    }
                  }
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="visibleCols().length" class="p-10 text-center">
                    <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
                      <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                        <mat-icon class="text-2xl text-slate-300">groups</mat-icon>
                      </span>
                      <p class="text-xs font-semibold">{{ prefs.txt('এই ক্যাটাগরিতে কোনো পার্টি পাওয়া যায়নি।', 'No parties found in this category.') }}</p>
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

      <!-- Grid View (desktop) -->
      @if (viewMode() === 'grid') {
        <div class="no-print hidden lg:block space-y-3">
          <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
            @for (p of pager.paged(); track p.id; let idx = $index) {
              <article class="group flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-xs transition hover:border-teal-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900">
                <div class="flex items-start justify-between gap-2">
                  <button (click)="viewParty(p)" class="flex min-w-0 items-center gap-2 text-left cursor-pointer">
                    @if (avatarUrl(p)) {
                      <img [src]="avatarUrl(p)" alt="Avatar" class="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0" loading="lazy" decoding="async">
                    } @else {
                      <span class="w-9 h-9 rounded-full bg-teal-700/15 text-teal-700 dark:text-teal-300 flex items-center justify-center text-sm font-black shrink-0">{{ initials(p.name) }}</span>
                    }
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-bold text-teal-800 dark:text-teal-300 group-hover:underline">{{ p.name }}</span>
                      <span class="block truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">{{ p.companyName && p.companyName !== 'N/A' ? p.companyName : '—' }}</span>
                    </span>
                  </button>
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    <span [class]="p.status === 'Enabled' ? 'bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded text-[9px] font-bold' : 'bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded text-[9px] font-bold'">{{ p.status }}</span>
                    <span class="font-mono text-[9px] font-bold text-slate-400">SL {{ pager.offset() + idx + 1 }}</span>
                  </div>
                </div>

                <div class="flex flex-wrap gap-0.5">
                  @for (role of rolesOf(p); track role) {
                    <span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold" [class]="typeBadge(role)">{{ typeLabel(role) }}</span>
                  }
                </div>

                <div class="grid grid-cols-3 gap-1.5 rounded-lg bg-slate-50 p-2 text-center dark:bg-slate-800/60">
                  <div>
                    <p class="text-[9px] font-bold uppercase text-slate-400">{{ prefs.txt('মোট', 'Total') }}</p>
                    <p class="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-100">{{ rowTotal(p) | number:'1.2-2' }}</p>
                  </div>
                  <div>
                    <p class="text-[9px] font-bold uppercase text-emerald-500">{{ prefs.txt('জমা', 'Paid') }}</p>
                    <p class="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{{ rowPaid(p) | number:'1.2-2' }}</p>
                  </div>
                  <div>
                    <p class="text-[9px] font-bold uppercase text-rose-400">{{ prefs.txt('বাকি', 'Due') }}</p>
                    <p class="font-mono text-[11px] font-bold" [class]="dueTextClass(rowDue(p))">{{ rowDue(p) | number:'1.2-2' }}</p>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                  <span class="inline-flex items-center gap-1" [title]="phoneListTitle(p)"><mat-icon class="text-xs">call</mat-icon>{{ phoneSummary(p) }}</span>
                  <span class="inline-flex items-center gap-1"><mat-icon class="text-xs">event</mat-icon>{{ displayDate(p.createdAt) }}</span>
                  <span class="inline-flex min-w-0 items-center gap-1"><mat-icon class="text-xs">location_on</mat-icon><span class="truncate">{{ addressLabel(p) }}</span></span>
                </div>

                <div class="mt-auto flex items-center gap-1">
                  <button (click)="viewParty(p)" class="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-teal-700 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-teal-800 cursor-pointer">
                    <mat-icon class="text-sm">menu_book</mat-icon> {{ prefs.txt('লেজার', 'Ledger') }}
                  </button>
                  <button (click)="payParty(p)" class="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 cursor-pointer">
                    <mat-icon class="text-sm">attach_money</mat-icon> {{ prefs.txt('জমা', 'Pay') }}
                  </button>
                  <button (click)="openEditModal(p)" class="inline-flex items-center justify-center rounded-lg bg-amber-500 px-2 py-1.5 text-white hover:bg-amber-600 cursor-pointer" [title]="prefs.txt('এডিট', 'Edit')">
                    <mat-icon class="text-sm">edit</mat-icon>
                  </button>
                  @if (canEditPartyMoney()) {
                    <button (click)="openBalanceDialog(p)" class="inline-flex items-center justify-center rounded-lg bg-sky-600 px-2 py-1.5 text-white hover:bg-sky-700 cursor-pointer" [title]="prefs.txt('ওপেনিং ব্যালেন্স সংশোধন', 'Correct opening balance')">
                      <mat-icon class="text-sm">currency_exchange</mat-icon>
                    </button>
                  }
                  @if (session.has('deleteRecords')) {
                    <button (click)="deleteParty(p.id)" class="inline-flex items-center justify-center rounded-lg bg-rose-600 px-2 py-1.5 text-white hover:bg-rose-700 cursor-pointer" [title]="prefs.txt('মুছুন', 'Delete')">
                      <mat-icon class="text-sm">delete</mat-icon>
                    </button>
                  }
                </div>
              </article>
            } @empty {
              <div class="col-span-full rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
                <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
                  <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center dark:bg-slate-800">
                    <mat-icon class="text-2xl text-slate-300">groups</mat-icon>
                  </span>
                  <p class="text-xs font-semibold">{{ prefs.txt('এই ক্যাটাগরিতে কোনো পার্টি পাওয়া যায়নি।', 'No parties found in this category.') }}</p>
                </div>
              </div>
            }
          </div>
          <div class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <app-table-pagination
              [total]="pager.total()"
              [page]="pager.currentPage()"
              [pageSize]="pager.pageSize()"
              (pageChange)="pager.setPage($event)"
              (pageSizeChange)="pager.setPageSize($event)"
            />
          </div>
        </div>
      }

      <!-- Party Cards (mobile / tablet) -->
      <div class="no-print lg:hidden bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden divide-y divide-slate-100">
        @for (p of pager.paged(); track p.id; let idx = $index) {
          <div class="p-3 space-y-2.5">
            <div class="flex items-start justify-between gap-2">
              <button (click)="viewParty(p)" class="group flex items-center gap-2 min-w-0 text-left cursor-pointer">
                @if (avatarUrl(p)) {
                  <img [src]="avatarUrl(p)" alt="Avatar" class="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0" loading="lazy" decoding="async">
                } @else {
                  <span class="w-8 h-8 rounded-full bg-teal-700/15 text-teal-700 dark:text-teal-300 flex items-center justify-center text-xs font-black shrink-0">{{ initials(p.name) }}</span>
                }
                <span class="min-w-0">
                  <span class="block font-bold text-teal-800 dark:text-teal-300 text-sm truncate group-hover:underline">{{ p.name }}</span>
                  <span class="block text-[10px] text-slate-500 truncate">{{ p.companyName || '-' }} • SL {{ pager.offset() + idx + 1 }}</span>
                </span>
              </button>
              <span class="shrink-0 flex max-w-[45%] flex-wrap justify-end gap-0.5">
                @for (role of rolesOf(p); track role) {
                  <span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold" [class]="typeBadge(role)">{{ typeLabel(role) }}</span>
                }
              </span>
            </div>

            <div class="grid grid-cols-3 gap-2 text-center bg-slate-50 rounded-lg p-2">
              <div>
                <p class="text-[9px] uppercase font-bold text-slate-400">{{ prefs.txt('মোট', 'Total') }}</p>
                <p class="font-mono font-bold text-slate-800 text-[11px]">{{ rowTotal(p) | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-[9px] uppercase font-bold text-emerald-500">{{ prefs.txt('জমা', 'Paid') }}</p>
                <p class="font-mono font-semibold text-emerald-600 dark:text-emerald-400 text-[11px]">{{ rowPaid(p) | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-[9px] uppercase font-bold text-rose-400">{{ prefs.txt('বাকি', 'Due') }}</p>
                <p class="font-mono font-bold text-[11px]" [class]="dueTextClass(rowDue(p))">{{ rowDue(p) | number:'1.2-2' }}</p>
              </div>
            </div>

            <div class="flex items-center justify-between gap-2 text-[10px] text-slate-500 flex-wrap">
              <span class="inline-flex items-center gap-1" [title]="phoneListTitle(p)">
                <mat-icon class="text-xs">call</mat-icon>{{ phoneSummary(p) }}
              </span>
              <span class="inline-flex items-center gap-1">
                <mat-icon class="text-xs">event</mat-icon>{{ displayDate(p.createdAt) }}
              </span>
              <span [class]="p.status === 'Enabled' ? 'text-emerald-700 dark:text-emerald-400 font-bold' : 'text-rose-700 dark:text-rose-400 font-bold'">{{ p.status }}</span>
            </div>

            <div class="flex items-center gap-1">
              <button (click)="viewParty(p)" class="flex-1 inline-flex items-center justify-center gap-1 bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">menu_book</mat-icon> {{ prefs.txt('লেজার', 'Ledger') }}
              </button>
              <button (click)="payParty(p)" class="flex-1 inline-flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">attach_money</mat-icon> {{ prefs.txt('জমা', 'Pay') }}
              </button>
              <button (click)="openEditModal(p)" class="inline-flex items-center justify-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                <mat-icon class="text-sm">edit</mat-icon>
              </button>
              @if (canEditPartyMoney()) {
                <button (click)="openBalanceDialog(p)" class="inline-flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer" [title]="prefs.txt('ওপেনিং ব্যালেন্স সংশোধন', 'Correct opening balance')">
                  <mat-icon class="text-sm">currency_exchange</mat-icon>
                </button>
              }
              @if (session.has('deleteRecords')) {
                <button (click)="deleteParty(p.id)" class="inline-flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold px-2 py-1.5 rounded-lg cursor-pointer">
                  <mat-icon class="text-sm">delete</mat-icon>
                </button>
              }
            </div>
          </div>
        } @empty {
          <div class="p-8 text-center">
            <div class="inline-flex flex-col items-center gap-1.5 text-slate-400">
              <span class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                <mat-icon class="text-2xl text-slate-300">groups</mat-icon>
              </span>
              <p class="text-xs font-semibold">{{ prefs.txt('এই ক্যাটাগরিতে কোনো পার্টি পাওয়া যায়নি।', 'No parties found in this category.') }}</p>
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

    <!-- Right Side-Over Drawer: Add / Edit Parties matching add_parties_d8489194.png & add_parties_2_a8e405fb.png -->
    @if (showAddDrawer()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end">
        <div class="bg-white w-full max-w-xl sm:max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden text-slate-800 animate-in slide-in-from-right duration-300">
          
          <!-- Drawer Header & Stepper Navbar -->
          <div class="bg-white border-b border-slate-200">
            <!-- Top Title Bar -->
            <div class="p-4 flex items-center justify-between border-b border-slate-100">
              <div class="flex items-center gap-2">
                <button (click)="closeDrawer()" class="text-slate-400 hover:text-slate-700 cursor-pointer p-1 rounded-full hover:bg-slate-100 transition-colors">
                  <mat-icon class="text-lg">close</mat-icon>
                </button>
                <h2 class="text-base font-bold text-slate-900">
                  {{ isEditMode() ? prefs.txt('পার্টি এডিট', 'Edit Party') : prefs.txt('নতুন পার্টি', 'Add New Party') }}
                </h2>
              </div>
            </div>

            <!-- 2-Step Navbar Indicator matching screenshots -->
            <div class="px-6 py-3.5 flex items-center justify-center gap-4 bg-slate-50/50">
              <!-- Step 1: Basic Details -->
              <button (click)="goToStep(1)" class="flex items-center gap-2 cursor-pointer outline-none">
                <span [class]="currentStep() >= 1 ? 'w-6 h-6 rounded-full bg-teal-500 text-white font-bold flex items-center justify-center text-xs shadow-2xs' : 'w-6 h-6 rounded-full bg-slate-200 text-slate-500 font-bold flex items-center justify-center text-xs'">
                  @if (currentStep() === 2) {
                    <mat-icon class="text-xs">check</mat-icon>
                  } @else {
                    1
                  }
                </span>
                <span [class]="currentStep() >= 1 ? 'font-bold text-xs text-slate-900' : 'font-semibold text-xs text-slate-400'">
                  {{ prefs.txt('মূল তথ্য', 'Basic') }}
                </span>
              </button>

              <!-- Step Divider Line -->
              <div class="w-24 sm:w-32 h-0.5 rounded-full" [class.bg-teal-500]="currentStep() === 2" [class.bg-slate-200]="currentStep() === 1"></div>

              <!-- Step 2: Additional Info -->
              <button (click)="goToStep(2)" class="flex items-center gap-2 cursor-pointer outline-none">
                <span [class]="currentStep() === 2 ? 'w-6 h-6 rounded-full bg-teal-500 text-white font-bold flex items-center justify-center text-xs shadow-2xs' : 'w-6 h-6 rounded-full bg-slate-200 text-slate-500 font-bold flex items-center justify-center text-xs'">
                  2
                </span>
                <span [class]="currentStep() === 2 ? 'font-bold text-xs text-slate-900' : 'font-semibold text-xs text-slate-400'">
                  {{ prefs.txt('অতিরিক্ত তথ্য', 'Additional') }}
                </span>
              </button>
            </div>
          </div>

          <!-- Drawer Body Content -->
          <div #drawerBody class="flex-1 overflow-y-auto p-6 space-y-4">

            <!-- STEP 1: Basic Details (add_parties_d8489194.png) -->
            @if (currentStep() === 1) {
              <div class="space-y-4 animate-in fade-in duration-200">

                <!-- Roles: one party may hold several roles, each with its own book -->
                <div class="relative" data-role-select-root>
                  <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('রোল', 'Role') }}</label>
                  <button type="button" (click)="toggleRoleMenu()"
                    [class]="roleMenuOpen() ? 'border-teal-500 ring-2 ring-teal-500/25 bg-white' : 'border-slate-300 bg-white hover:border-teal-400'"
                    class="flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer">
                    <mat-icon class="text-slate-400 text-sm">badge</mat-icon>
                    <span class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      @for (role of formTypes; track role) {
                        <span class="inline-flex items-center gap-0.5 rounded-md border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10.5px] font-bold text-teal-800">
                          {{ roleLabel(role) }}
                        </span>
                      }
                    </span>
                    <span class="font-mono text-[10px] font-bold text-slate-400">{{ formTypes.length }}</span>
                    <mat-icon class="text-sm text-slate-400 transition-transform" [class.rotate-180]="roleMenuOpen()">expand_more</mat-icon>
                  </button>

                  @if (roleMenuOpen()) {
                    <div class="relative z-40 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
                      <p class="flex items-center gap-1 border-b border-slate-100 px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-wider text-slate-400">
                        <mat-icon class="text-xs text-teal-600">checklist</mat-icon>
                        {{ prefs.txt('একাধিক রোল বেছে নিন', 'Pick one or more') }}
                      </p>
                      @for (option of partyTypeOptions(); track option.value) {
                        <button type="button" (click)="toggleFormType(option.value)"
                          class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50 cursor-pointer">
                          <span class="grid size-5 shrink-0 place-items-center rounded-[6px] border transition-colors"
                            [class]="isFormType(option.value) ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white text-transparent'">
                            <mat-icon class="text-[13px] h-[13px] w-[13px] leading-[13px]">check</mat-icon>
                          </span>
                          <mat-icon class="text-sm" [class]="isFormType(option.value) ? 'text-teal-700' : 'text-slate-400'">{{ option.icon }}</mat-icon>
                          <span class="flex-1 text-[11.5px] font-bold" [class]="isFormType(option.value) ? 'text-slate-900' : 'text-slate-600'">{{ option.label }}</span>
                          <span class="text-[9px] font-bold uppercase tracking-wide text-slate-400">{{ option.value }}</span>
                        </button>
                      }
                      <div class="flex items-start justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-3 py-1.5">
                        <span class="text-[10px] font-medium leading-snug" [class]="formTypes.length > 1 ? 'text-teal-700 font-semibold' : 'text-slate-500'">
                        {{ formTypes.length > 1
                          ? prefs.txt('মাল্টি-রোল: ক্রয় ও বিক্রয় — দুটো হিসাবই আলাদাভাবে চলবে।', 'Multi-role: purchase and sales books run separately.')
                          : prefs.txt('একাধিক রোল বেছে নিলে একই পার্টির ক্রয় ও বিক্রয় আলাদা হিসাবে থাকবে।', 'Pick multiple roles to keep separate purchase and sales books for this party.') }}
                      </span>
                      <button type="button" (click)="roleMenuOpen.set(false)" class="shrink-0 text-[10px] font-bold text-teal-700 hover:underline cursor-pointer">{{ prefs.txt('ঠিক আছে', 'Done') }}</button>
                      </div>
                    </div>
                  }
                </div>

                <!-- Row 1: Profile Image -->
                <div>
                  <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('প্রোফাইল ছবি', 'Profile Image') }}</label>
                  <label class="flex items-center justify-between border border-slate-300 rounded-lg px-3 py-1.5 bg-white cursor-pointer hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-500">
                    <div class="flex items-center gap-2 overflow-hidden">
                      @if (formProfileImagePreview()) {
                        <img [src]="formProfileImagePreview()" [alt]="prefs.txt('প্রিভিউ', 'Preview')" class="w-5 h-5 rounded-full object-cover" loading="lazy" decoding="async">
                        <span class="text-slate-800 font-semibold truncate text-xs">{{ prefs.txt('ছবি নির্বাচিত', 'Image Selected') }}</span>
                      } @else {
                        <mat-icon class="text-slate-400 text-sm">photo_library</mat-icon>
                        <span class="text-slate-400 text-xs">{{ prefs.txt('ছবি আপলোড করুন', 'Upload Image') }}</span>
                      }
                    </div>
                    <span class="text-teal-600 font-bold text-xs flex items-center gap-0.5">
                      <mat-icon class="text-xs">file_upload</mat-icon> {{ prefs.txt('আপলোড', 'Upload') }}
                    </span>
                    <input type="file" accept="image/*" (change)="onProfileImageSelect($event)" class="hidden">
                  </label>
                </div>

                <!-- Row 2: Warehouse & Company Name -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('ওয়্যারহাউস', 'Warehouse') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <mat-icon class="text-slate-400 text-sm mr-2">storefront</mat-icon>
                      <select [(ngModel)]="formWarehouse" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                        @if (formWarehouse && !dataService.warehouses().includes(formWarehouse)) {
                          <option [value]="formWarehouse">{{ formWarehouse }}</option>
                        }
                        @for (w of dataService.warehouses(); track w) {
                          <option [value]="w">{{ w }}</option>
                        }
                      </select>
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('কোম্পানির নাম', 'Company Name') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <mat-icon class="text-slate-400 text-sm mr-2">domain</mat-icon>
                      <input type="text" [(ngModel)]="formCompanyName" [placeholder]="prefs.txt('যেমন: দৌলতপুর সাইকেল হাউজ', 'e.g. Daulatpur Cycle House')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>
                </div>

                <!-- Row 3: Name & Phone Number -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('নাম', 'Name') }}</label>
                    <div class="flex items-center border rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500"
                      [class.border-slate-300]="!nameError()"
                      [class.border-rose-400]="!!nameError()">
                      <mat-icon class="text-slate-400 text-sm mr-2">person</mat-icon>
                      <input #nameInput type="text" [(ngModel)]="formName" (ngModelChange)="nameError.set('')" [placeholder]="prefs.txt('পার্টির পূর্ণ নাম লিখুন', 'Enter the full party name')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                    @if (nameError()) {
                      <p class="mt-1 text-[10px] font-bold text-rose-600">{{ nameError() }}</p>
                    }
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('মোবাইল নাম্বার', 'Phone') }}</label>
                    <div class="space-y-1.5">
                      <div class="flex items-center border rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500"
                        [class.border-slate-300]="!phoneError()"
                        [class.border-rose-400]="!!phoneError()">
                        <mat-icon class="text-slate-400 text-sm mr-2">call</mat-icon>
                        <input type="tel" inputmode="tel" maxlength="16" [(ngModel)]="formPhone" (ngModelChange)="phoneError.set('')" placeholder="01XXXXXXXXX" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                        <span class="ml-1 shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-[9px] font-bold text-teal-700 border border-teal-200">{{ prefs.txt('প্রধান', 'Primary') }}</span>
                      </div>
                      @for (extra of formExtraPhones; track $index) {
                        <div class="flex items-center gap-1.5">
                          <div class="flex flex-1 items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                            <mat-icon class="text-slate-400 text-sm mr-2">call</mat-icon>
                            <input type="tel" inputmode="tel" maxlength="16" [(ngModel)]="formExtraPhones[$index]" (ngModelChange)="phoneError.set('')" [placeholder]="prefs.txt('01XXXXXXXXX (অতিরিক্ত)', '01XXXXXXXXX (additional)')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                          </div>
                          <button type="button" (click)="removeExtraPhone($index)" [attr.aria-label]="prefs.txt('নম্বর মুছুন', 'Remove number')" [title]="prefs.txt('নম্বর মুছুন', 'Remove number')"
                            class="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 cursor-pointer">
                            <mat-icon class="text-sm">close</mat-icon>
                          </button>
                        </div>
                      }
                      @if (formExtraPhones.length < maxExtraPhones) {
                        <button type="button" (click)="addExtraPhone()"
                          class="inline-flex items-center gap-1 rounded-lg border border-dashed border-teal-300 bg-teal-50/60 px-2.5 py-1 text-[10px] font-bold text-teal-700 transition hover:bg-teal-50 cursor-pointer">
                          <mat-icon class="text-sm">add_phone</mat-icon> {{ prefs.txt('আরেকটি নম্বর যোগ করুন', 'Add another number') }}
                        </button>
                      }
                    </div>
                    @if (phoneError()) {
                      <p class="mt-1 text-[10px] font-bold text-rose-600">{{ phoneError() }}</p>
                    }
                  </div>
                </div>

                <!-- Row 4: Email & Status -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ইমেইল', 'Email') }}</label>
                    <div class="flex items-center border rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500"
                      [class.border-slate-300]="!emailError()"
                      [class.border-rose-400]="!!emailError()">
                      <mat-icon class="text-slate-400 text-sm mr-2">mail</mat-icon>
                      <input type="email" [(ngModel)]="formEmail" (ngModelChange)="emailError.set('')" placeholder="example@email.com" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                    @if (emailError()) {
                      <p class="mt-1 text-[10px] font-bold text-rose-600">{{ emailError() }}</p>
                    }
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt('স্ট্যাটাস', 'Status') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      @if (formStatus === 'Enabled') {
                        <mat-icon class="text-emerald-500 text-sm mr-2">check_circle</mat-icon>
                      } @else {
                        <mat-icon class="text-slate-400 text-sm mr-2">block</mat-icon>
                      }
                      <select [(ngModel)]="formStatus" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                        <option value="Enabled">{{ prefs.txt('সক্রিয়', 'Enabled') }}</option>
                        <option value="Disabled">{{ prefs.txt('নিষ্ক্রিয়', 'Disabled') }}</option>
                      </select>
                    </div>
                  </div>
                </div>

              </div>
            }

            <!-- STEP 2: Additional Info (add_parties_2_a8e405fb.png) -->
            @if (currentStep() === 2) {
              <div class="space-y-4 animate-in fade-in duration-200">

                <!-- Row 1: Opening Balance & Tax Number -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('প্রারম্ভিক ব্যালেন্স', 'Opening Balance') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-500">
                      <span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-1.5 border-r border-slate-300">TK</span>
                      <input type="number" min="0" step="any" [(ngModel)]="formOpeningBalance" [disabled]="!canEditPartyMoney()" class="w-full p-1.5 outline-none text-xs font-bold text-slate-900 disabled:bg-slate-50 disabled:text-slate-500">
                      <select [(ngModel)]="formOpeningBalanceType" [disabled]="!canEditPartyMoney()" class="bg-slate-50 border-l border-slate-300 px-2 py-1.5 text-xs text-slate-600 outline-none disabled:text-slate-400">
                        <option value="Pay">{{ prefs.txt('পাব', 'Pay') }}</option>
                        <option value="Receive">{{ prefs.txt('দিব', 'Receive') }}</option>
                      </select>
                    </div>
                    @if (isEditMode()) {
                      <p class="mt-1 text-[10px] font-semibold text-slate-400">
                        @if (canEditPartyMoney()) {
                          {{ prefs.txt('বদলালে সেভের সময় অ্যাডমিন পাসওয়ার্ড লাগবে; বাকি সমান হারে সমন্বয় হবে, পুরোনো ভাউচার ও পেমেন্ট অপরিবর্তিত থাকবে।', 'Changing it needs the admin password on save; the due shifts by the same amount and old vouchers/payments stay untouched.') }}
                          <button type="button" (click)="fixOpeningFromEditForm()" class="ml-1 font-bold text-sky-600 hover:underline cursor-pointer dark:text-sky-400">{{ prefs.txt('বাকি দিয়ে সংশোধন', 'Fix by due') }}</button>
                        } @else {
                          {{ prefs.txt('পরিবর্তন করতে পার্টি প্রোফাইল বা টেবিলের “ওপেনিং সংশোধন” (অ্যাডমিন পাসওয়ার্ডসহ) ব্যবহার করুন।', 'To change it, use “Fix opening” from the party profile or the table (admin password).') }}
                        }
                      </p>
                    }
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ট্যাক্স নাম্বার', 'Tax Number') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <mat-icon class="text-slate-400 text-sm mr-2">receipt</mat-icon>
                      <input type="text" [(ngModel)]="formTaxNumber" [placeholder]="prefs.txt('ট্যাক্স / VAT নাম্বার', 'Tax / VAT number')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>
                </div>

                <!-- Row 2: Credit Period & Credit Limit -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ক্রেডিট সময়', 'Credit Period') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-500 px-2 py-1">
                      <mat-icon class="text-slate-400 text-sm mr-1.5">calendar_today</mat-icon>
                      <input type="number" min="0" step="1" [(ngModel)]="formCreditPeriod" class="w-full outline-none text-xs font-bold text-slate-900">
                      <span class="text-slate-500 font-medium text-xs px-1">{{ prefs.txt('দিন', 'Days') }}</span>
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ক্রেডিট সীমা', 'Credit Limit') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-500">
                      <div class="bg-slate-100 p-0.5 border-r border-slate-300 flex items-center text-[10px] font-bold">
                        <button type="button" (click)="formCreditLimitMode = 'Manual'" [class]="formCreditLimitMode === 'Manual' ? 'bg-teal-600 text-white px-2 py-0.5 rounded shadow-2xs' : 'text-slate-600 px-2 py-0.5'">{{ prefs.txt('ম্যানুয়াল', 'Manual') }}</button>
                        <button type="button" (click)="formCreditLimitMode = 'Rule-based'" [class]="formCreditLimitMode === 'Rule-based' ? 'bg-teal-600 text-white px-2 py-0.5 rounded shadow-2xs' : 'text-slate-600 px-2 py-0.5'">{{ prefs.txt('নিয়মভিত্তিক', 'Rule-based') }}</button>
                      </div>
                      <span class="bg-slate-50 text-slate-600 font-bold px-2 py-1.5 border-r border-slate-300">TK</span>
                      <input type="number" min="0" step="any" [(ngModel)]="formCreditLimit" class="w-full p-1.5 outline-none text-xs font-bold text-slate-900">
                    </div>
                  </div>
                </div>

                <!-- Row 3: Customer Note / Remarks & Documents -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('নোট', 'Remarks') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <mat-icon class="text-slate-400 text-sm mr-2">note</mat-icon>
                      <input type="text" [(ngModel)]="formRemarks" [placeholder]="prefs.txt('বিশেষ নির্দেশনা বা নোট...', 'Special instructions or notes...')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>

                  <div>
                    <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('ডকুমেন্টের রেফারেন্স', 'Documents') }}</label>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                      <mat-icon class="text-slate-400 text-sm mr-2">description</mat-icon>
                      <input type="text" [(ngModel)]="formDocumentName" [placeholder]="prefs.txt('যেমন: NID, ট্রেড লাইসেন্স নম্বর', 'e.g. NID, trade license number')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                    </div>
                  </div>
                </div>

                <!-- Address Section Header -->
                <div class="pt-2">
                  <h4 class="font-bold text-xs text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-1">{{ prefs.txt('ঠিকানা', 'Address') }}</h4>
                </div>

                <!-- Row 4: Division → District → Upazila (shared with POS & battery forms) -->
                <app-geo-select
                  [(division)]="formDivision"
                  [(district)]="formDistrict"
                  [(upazila)]="formThana">
                </app-geo-select>

                <!-- Row 5: Road / House detail; division/district/upazila sit above. -->
                <div>
                  <label class="block font-medium mb-1 text-slate-600 text-[11px]">{{ prefs.txt('রোড / বাসা / এলাকা', 'Road / House / Area') }}</label>
                  <div class="flex items-center border border-slate-300 rounded-lg px-2 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                    <mat-icon class="text-slate-400 text-sm mr-1.5">home</mat-icon>
                    <input type="text" [(ngModel)]="formAreaRoadHouse" [placeholder]="prefs.txt('যেমন: বাসা ১২, রোড ৩, সোনাডাঙ্গা', 'e.g. House 12, Road 3, Sonadanga')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                  </div>
                </div>

                <!-- Row 5: Enable Geofencing -->
                <div class="pt-2">
                  <label class="block font-semibold mb-1 text-slate-700">{{ prefs.txt('জিওফেন্সিং', 'Geofencing') }}</label>
                  <button type="button" (click)="formGeofencing = !formGeofencing" class="flex items-center gap-2 cursor-pointer focus:outline-none">
                    <div [class]="formGeofencing ? 'w-10 h-5 bg-teal-600 rounded-full p-0.5 transition-colors duration-200' : 'w-10 h-5 bg-slate-300 rounded-full p-0.5 transition-colors duration-200'">
                      <div [class]="formGeofencing ? 'w-4 h-4 bg-white rounded-full shadow-md transform translate-x-5 transition-transform duration-200' : 'w-4 h-4 bg-white rounded-full shadow-md transform translate-x-0 transition-transform duration-200'"></div>
                    </div>
                    <span [class]="formGeofencing ? 'font-bold text-teal-700 text-xs' : 'font-medium text-slate-500 text-xs'">
                      {{ formGeofencing ? prefs.txt('চালু', 'Enabled') : prefs.txt('বন্ধ', 'Disabled') }}
                    </span>
                  </button>
                </div>

              </div>
            }

          </div>

          <!-- Drawer Footer Action Bar matching screenshots -->
          <div class="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
            @if (currentStep() === 1) {
              <button (click)="closeDrawer()" class="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer transition-colors">
                {{ prefs.txt('বাতিল', 'Cancel') }}
              </button>
              <button (click)="goToStep(2)" class="px-5 py-2 bg-teal-500 hover:bg-teal-600 text-white font-bold rounded-lg text-xs cursor-pointer shadow-2xs transition-colors">
                {{ prefs.txt('পরবর্তী', 'Next') }}
              </button>
              <button (click)="savePartyForm()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-2xs cursor-pointer transition-colors">
                <mat-icon class="text-sm">save</mat-icon> {{ isEditMode() ? prefs.txt('আপডেট', 'Update') : prefs.txt('সংরক্ষণ', 'Create') }}
              </button>
            } @else {
              <button (click)="goToStep(1)" class="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer transition-colors">
                {{ prefs.txt('পূর্ববর্তী', 'Back') }}
              </button>
              <button (click)="savePartyForm()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-2xs cursor-pointer transition-colors">
                <mat-icon class="text-sm">save</mat-icon> {{ isEditMode() ? prefs.txt('আপডেট', 'Update') : prefs.txt('সংরক্ষণ', 'Create') }}
              </button>
            }
          </div>

        </div>
      </div>
    }

    <!-- Admin-only opening balance correction -->
    @if (balanceDialogParty(); as bp) {
      <div class="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs">
        <div class="w-full max-w-md overflow-hidden rounded-2xl bg-white text-slate-800 shadow-2xl">
          <div class="relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 px-5 py-4 text-white">
            <div class="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl"></div>
            <div class="relative flex items-start justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2.5">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                  <mat-icon class="text-lg">currency_exchange</mat-icon>
                </span>
                <div class="min-w-0">
                  <p class="text-[9px] font-bold uppercase tracking-[0.14em] text-teal-50/70">{{ prefs.txt('অ্যাডমিন সংশোধন', 'Admin correction') }}</p>
                  <h3 class="truncate text-sm font-bold">{{ prefs.txt('ওপেনিং ব্যালেন্স সমন্বয়', 'Adjust opening balance') }}</h3>
                  <p class="truncate text-[10px] text-teal-50/85">{{ bp.name }}</p>
                </div>
              </div>
              <button (click)="closeBalanceDialog()" class="rounded-full p-1 text-white/80 hover:bg-white/15 hover:text-white cursor-pointer" [attr.aria-label]="prefs.txt('বন্ধ', 'Close')">
                <mat-icon class="text-lg">close</mat-icon>
              </button>
            </div>
          </div>

          <div class="space-y-3 p-5 text-xs">
            <div class="grid grid-cols-2 gap-2">
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60">
                <p class="text-[9px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('বর্তমান বাকি', 'Current due') }}</p>
                <p class="font-mono text-sm font-bold text-slate-800 dark:text-slate-100">{{ balanceCurrentDue() | number:'1.2-2' }} TK</p>
                <p class="text-[9px] font-semibold text-slate-500 dark:text-slate-400">{{ prefs.txt('ভাউচার ও পেমেন্টসহ', 'with vouchers & payments') }}</p>
              </div>
              <div class="rounded-lg border border-teal-200 bg-teal-50 p-2 dark:border-teal-800 dark:bg-teal-900/30">
                <p class="text-[9px] font-bold uppercase tracking-wide text-teal-600 dark:text-teal-300">{{ prefs.txt('নতুন বাকি', 'New due') }}</p>
                <p class="font-mono text-sm font-bold text-teal-800 dark:text-teal-200">{{ (balanceFormAmount || 0) | number:'1.2-2' }} TK</p>
                <p class="text-[9px] font-semibold text-teal-700 dark:text-teal-300">{{ prefs.txt('এটাই বাকি দেখাবে', 'this becomes the due') }}</p>
              </div>
            </div>

            <div>
              <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-300">* {{ prefs.txt('সঠিক মোট বাকি (TK)', 'Correct total due (TK)') }}</label>
              <div class="flex items-center overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-teal-500 dark:border-slate-600 dark:bg-slate-900">
                <span class="border-r border-slate-300 bg-slate-100 px-2.5 py-1.5 font-bold text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">TK</span>
                <input type="number" min="0" step="any" [(ngModel)]="balanceFormAmount" (ngModelChange)="balanceError.set('')"
                  class="w-full bg-transparent p-1.5 font-bold text-slate-900 outline-none dark:text-slate-100">
              </div>
            </div>

            <div>
              <label class="mb-1 block font-semibold text-slate-700 dark:text-slate-300">* {{ prefs.txt('সংশোধনের কারণ', 'Reason for correction') }}</label>
              <textarea rows="2" [(ngModel)]="balanceFormReason" (ngModelChange)="balanceError.set('')"
                [placeholder]="prefs.txt('যেমন: পুরোনো খাতায় ভুল এন্ট্রি, মালিকের নির্দেশে সমন্বয়…', 'e.g. wrong entry in the old book, owner-approved adjustment…')"
                class="w-full resize-none rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-teal-500 dark:bg-slate-900 dark:text-slate-100"
                [ngClass]="balanceError() ? 'border-rose-400' : 'border-slate-300 dark:border-slate-600'"></textarea>
              @if (balanceError()) {
                <p class="mt-1 text-[10px] font-bold text-rose-600">{{ balanceError() }}</p>
              }
            </div>

            <div class="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-medium leading-snug text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <mat-icon class="mr-1 align-middle text-xs">info</mat-icon>
              {{ prefs.txt('যত টাকা লিখবেন, সংশোধনের পর ঠিক তত টাকাই এই পার্টির বাকি দেখাবে; পুরোনো ভাউচার ও পেমেন্ট অপরিবর্তিত থাকবে। সংরক্ষণে অ্যাডমিন পাসওয়ার্ড লাগবে এবং পরিবর্তন অডিট লগে থাকবে।', 'Whatever amount you type becomes this party’s due after the correction; old vouchers and payments stay untouched. Saving needs the admin password and is written to the audit log.') }}
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-900">
            <button (click)="closeBalanceDialog()" class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
              {{ prefs.txt('বাতিল', 'Cancel') }}
            </button>
            <button (click)="requestBalanceCorrection()" class="flex items-center gap-1 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-emerald-700 cursor-pointer">
              <mat-icon class="text-sm">lock_open</mat-icon> {{ prefs.txt('পাসওয়ার্ড দিয়ে সংরক্ষণ', 'Save with password') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (balanceUnlock()) {
      <app-passcode-modal [elevate]="true"
        [title]="prefs.txt('ওপেনিং ব্যালেন্স সংশোধন', 'Opening balance correction')"
        [message]="prefs.txt('বাকি পরিবর্তন করতে অ্যাডমিন পাসওয়ার্ড দিন। সংরক্ষণ করলে ঠিক এই অঙ্কটাই বাকি দেখাবে।', 'Enter the admin password to change the due. The figure you typed will become the due.')"
        (verified)="confirmBalanceCorrection()" (close)="balanceUnlock.set(false)" />
    }

    @if (openingSaveUnlock()) {
      <app-passcode-modal [elevate]="true"
        [title]="prefs.txt('ওপেনিং ব্যালেন্স পরিবর্তন', 'Opening balance change')"
        [message]="prefs.txt('ওপেনিং ব্যালেন্স বদলে পার্টি সেভ করতে অ্যাডমিন পাসওয়ার্ড দিন। বাকি একই অঙ্কে সমন্বয় হবে।', 'Enter the admin password to save the new opening balance. The due will shift by the same amount.')"
        (verified)="confirmOpeningSave()" (close)="openingSaveUnlock.set(false)" />
    }

    @if (liveLedgerParty(); as lp) {
      <app-party-ledger [party]="lp" [autoPay]="ledgerAutoPay()" [paymentOnly]="ledgerPaymentOnly()"
        [side]="activeTab() === 'All' ? undefined : (activeTab() === 'Supplier' ? 'purchase' : 'sales')"
        [canFixOpening]="canEditPartyMoney()"
        (close)="closeLedger()" (edit)="editFromProfile(lp)" (fixOpening)="fixOpeningFromProfile(lp)" />
    }

    @if (listDocumentOpen()) {
      <app-party-list-document
        [rows]="listDocumentRows()"
        [title]="activeTabLabel()"
        [scope]="accountScopeLabel()"
        [search]="searchQuery()"
        [dueLabel]="dueColumnLabel()"
        [sortText]="listSortLabel()"
        [totals]="totals()"
        (close)="listDocumentOpen.set(false)" />
    }
  `
})
export class Parties {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  private media = inject(MediaService);
  prefs = inject(PreferencesService);
  session = inject(SessionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  ledgerParty = signal<Party | null>(null);
  ledgerAutoPay = signal<boolean>(false);
  /** The জমা button opens just the payment form, not the whole party profile. */
  ledgerPaymentOnly = signal<boolean>(false);

  /** The open drawer always reads the live record, so a payment or edit refreshes the summary instantly. */
  liveLedgerParty = computed(() => {
    const open = this.ledgerParty();
    if (!open) return null;
    return this.dataService.parties().find(p => p.id === open.id) ?? open;
  });

  activeTab = signal<string>('All');
  searchQuery = signal<string>('');
  showAddDrawer = signal<boolean>(false);
  isEditMode = signal<boolean>(false);
  editingPartyId = signal<number | null>(null);
  currentStep = signal<1 | 2>(1);

  readonly viewMode = persistedSignal<'list' | 'grid'>('sm_parties_view_v1', 'list', value => value === 'grid' ? 'grid' : 'list');
  readonly sortKey = persistedSignal<string>(PARTY_SORT_KEY, '', value => typeof value === 'string' && PARTY_SORTABLE.has(value) ? value : '');
  readonly sortDir = persistedSignal<'asc' | 'desc'>(PARTY_SORT_DIR_KEY, 'asc', value => value === 'desc' ? 'desc' : 'asc');
  readonly isAdmin = computed(() => this.session.currentUser()?.role === 'Admin');

  /** Owner, or an Admin/permitted user while the owner has not locked party money. */
  readonly canEditPartyMoney = computed(() => {
    const user = this.session.currentUser();
    if (!user) return false;
    if (this.session.isMain(user)) return true;
    if (this.dataService.voucherSettings().lockPartyMoney) return false;
    return user.role === 'Admin' || this.session.has('editPartyMoney');
  });

  /** An explicit grant replaces the admin-PIN prompt; role Admins still enter the PIN. */
  private partyMoneyGrantedByPermission(): boolean {
    const user = this.session.currentUser();
    return !!user && Array.isArray(user.permissions) && user.permissions.includes('editPartyMoney');
  }

  // Column order, visibility and widths are user-owned and survive a reload.
  showColumnSelector = signal<boolean>(false);
  tableLayout = signal<ColumnLayout>(loadColumnLayout(PARTY_TABLE_VIEW_KEY, PARTY_TABLE_COLUMNS));

  visibleCols = computed<ResolvedColumn[]>(() => {
    const layout = this.tableLayout();
    return layout.order
      .filter(key => layout.visible[key])
      .map(key => ({ ...PARTY_COL_SPECS[key], width: layout.widths[key] }));
  });

  tableWidthPx = computed(() => this.visibleCols().reduce((sum, col) => sum + col.width, 0));

  allColumns = computed(() => {
    const layout = this.tableLayout();
    return layout.order.map(key => ({
      key,
      width: layout.widths[key],
      visible: !!layout.visible[key],
      toggleable: key !== 'sl' && key !== 'action'
    }));
  });

  private readonly bnColLabels: Record<string, string> = {
    sl: 'ক্রম', company: 'প্রতিষ্ঠানের নাম', name: 'পার্টিসের নাম', type: 'ধরন',
    total: 'মোট', paid: 'পরিশোধিত', due: 'বাকি', status: 'স্ট্যাটাস',
    inHand: 'হাতে', createdAt: 'তৈরির তারিখ', address: 'ঠিকানা', action: 'অ্যাকশন'
  };

  // Admin opening-balance correction dialog.
  balanceDialogParty = signal<Party | null>(null);
  balanceCurrentDue = signal(0);
  balanceFormAmount = 0;
  balanceFormReason = '';
  balanceError = signal('');
  readonly balanceUnlock = signal(false);
  /** Password gate for an opening change typed directly in the edit form. */
  readonly openingSaveUnlock = signal(false);
  private openingSaveUnlocked = false;

  // Form State matching add_parties_d8489194.png & add_parties_2_a8e405fb.png
  readonly partyTypeOptions = computed<{ value: PartyType; label: string; icon: string }[]>(() => [
    { value: 'Customer', label: this.prefs.txt('কাস্টমার', 'Customer'), icon: 'person' },
    { value: 'Corporate Customer', label: this.prefs.txt('কর্পোরেট', 'Corporate'), icon: 'account_balance' },
    { value: 'Supplier', label: this.prefs.txt('সরবরাহকারী', 'Supplier'), icon: 'local_shipping' },
    { value: 'Dealer', label: this.prefs.txt('ডিলার', 'Dealer'), icon: 'storefront' },
    { value: 'Staff Member', label: this.prefs.txt('স্টাফ', 'Staff'), icon: 'badge' }
  ]);
  formTypes: PartyType[] = ['Supplier'];
  formRole = '';
  formProfileImagePreview = signal<string>('');
  formWarehouse = 'SM Warehouse';
  formCompanyName = '';
  formName = '';
  formPhone = '';
  /** Extra numbers beyond the primary one; blank rows are ignored on save. */
  formExtraPhones: string[] = [];
  readonly maxExtraPhones = 4;
  formEmail = '';
  formStatus: 'Enabled' | 'Disabled' = 'Enabled';

  // Step 2 Form State
  formOpeningBalance = 0;
  formOpeningBalanceType: 'Pay' | 'Receive' = 'Pay';
  formTaxNumber = '';
  formCreditPeriod = 30;
  formCreditLimitMode: 'Manual' | 'Rule-based' = 'Manual';
  formCreditLimit = 0;
  formRemarks = '';
  formDocumentName = '';
  formDivision = '';
  formDistrict = '';
  formThana = '';
  formAreaRoadHouse = '';
  formGeofencing = false;
  nameError = signal('');
  phoneError = signal('');
  emailError = signal('');
  private readonly drawerBody = viewChild<ElementRef<HTMLDivElement>>('drawerBody');
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  roleMenuOpen = signal<boolean>(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab');
      if (tab && PARTY_TABS.includes(tab)) this.activeTab.set(tab);
    });

    // Inline popovers close on any outside pointer press.
    fromEvent<PointerEvent>(this.document, 'pointerdown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(event => {
        const target = event.target as HTMLElement | null;
        if (this.roleMenuOpen() && !target?.closest('[data-role-select-root]')) this.roleMenuOpen.set(false);
        if (this.showColumnSelector() && !target?.closest('[data-party-columns-root]')) this.showColumnSelector.set(false);
      });
    fromEvent<KeyboardEvent>(this.document, 'keydown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(event => {
        if (event.key !== 'Escape') return;
        if (this.balanceDialogParty()) {
          this.balanceDialogParty.set(null);
          return;
        }
        if (this.showColumnSelector()) {
          this.showColumnSelector.set(false);
          return;
        }
        if (this.roleMenuOpen()) this.roleMenuOpen.set(false);
      });
  }

  setTab(tab: string) {
    this.activeTab.set(tab);
    this.pager.setPage(1);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  getCount(role: string): number {
    const list = this.dataService.parties();
    return list.filter(p => partyRoles(p).includes(role as PartyType)).length;
  }

  readonly tabDefs = computed(() => [
    { value: 'All', label: this.prefs.txt('সব', 'All'), icon: 'groups' },
    { value: 'Customer', label: this.prefs.txt('কাস্টমার', 'Customer'), icon: 'person' },
    { value: 'Corporate Customer', label: this.prefs.txt('কর্পোরেট', 'Corporate'), icon: 'account_balance' },
    { value: 'Supplier', label: this.prefs.txt('সরবরাহকারী', 'Supplier'), icon: 'local_shipping' },
    { value: 'Dealer', label: this.prefs.txt('ডিলার', 'Dealer'), icon: 'storefront' },
    { value: 'Staff Member', label: this.prefs.txt('স্টাফ', 'Staff'), icon: 'badge' }
  ]);

  tabCount(value: string): number {
    return value === 'All' ? this.dataService.parties().length : this.getCount(value);
  }

  activeTabLabel(): string {
    const tab = this.tabDefs().find(t => t.value === this.activeTab());
    return tab ? tab.label : this.prefs.txt('সব', 'All');
  }

  /** The active tab decides which book the money columns describe. */
  private displayAccount(p: Party) {
    const tab = this.activeTab();
    if (tab === 'Supplier') return purchaseAccountOf(p);
    const sales = salesAccountOf(p);
    if (tab !== 'All') return sales;
    const purchase = purchaseAccountOf(p);
    return {
      total: Math.round((sales.total + purchase.total) * 100) / 100,
      paid: Math.round((sales.paid + purchase.paid) * 100) / 100,
      // Net position: positive means the party owes the shop.
      due: Math.round((sales.due - purchase.due) * 100) / 100
    };
  }

  rowTotal(p: Party): number { return this.displayAccount(p).total; }
  rowPaid(p: Party): number { return this.displayAccount(p).paid; }
  rowDue(p: Party): number { return this.displayAccount(p).due; }

  rolesOf(p: Party): PartyType[] {
    return partyRoles(p);
  }

  accountScopeLabel(): string {
    const tab = this.activeTab();
    if (tab === 'Supplier') return this.prefs.txt('ক্রয় হিসাব', 'Purchase book');
    if (tab === 'All') return this.prefs.txt('বিক্রয় + ক্রয় (নেট)', 'Sales + purchase (net)');
    return this.prefs.txt('বিক্রয় হিসাব', 'Sales book');
  }

  totals = computed(() => {
    const list = this.filteredParties();
    const sum = (pick: (p: Party) => number) =>
      Math.round(list.reduce((acc, p) => acc + (Number(pick(p)) || 0), 0) * 100) / 100;
    return { total: sum(p => this.rowTotal(p)), paid: sum(p => this.rowPaid(p)), due: sum(p => this.rowDue(p)) };
  });

  readonly listDocumentOpen = signal(false);
  readonly wordBusy = signal(false);

  /** Rows exactly as the A4 party list prints them — same tab, search and sort as the screen. */
  readonly listDocumentRows = computed<PartyListRow[]>(() =>
    this.filteredParties().map((p, index) => {
      const account = this.displayAccount(p);
      return {
        sl: index + 1,
        name: p.name,
        company: (p.companyName || '').trim(),
        roles: this.rolesOf(p).map(role => this.typeLabel(role)).join(', ') || '—',
        phone: partyPhones(p).join(', ') || '—',
        address: localizeAddress(p.address, this.prefs.language()) || '—',
        total: account.total,
        paid: account.paid,
        due: account.due
      };
    })
  );

  openListDocument() {
    this.listDocumentOpen.set(true);
  }

  dueColumnLabel(): string {
    const tab = this.activeTab();
    if (tab === 'Supplier') return this.prefs.txt('প্রদেয়', 'Payable');
    if (tab === 'All') return this.prefs.txt('নেট বাকি', 'Net due');
    return this.prefs.txt('বাকি', 'Due');
  }

  listSortLabel(): string {
    const key = this.sortKey();
    if (!key) return this.prefs.txt('ডিফল্ট', 'Default');
    return `${this.colLabel(key)} · ${this.sortDir() === 'asc' ? this.prefs.txt('ঊর্ধ্বক্রম', 'asc') : this.prefs.txt('নিম্নক্রম', 'desc')}`;
  }

  addressLabel(p: Party): string {
    return localizeAddress(p.address, this.prefs.language()) || '-';
  }

  typeLabel(type: Party['type']): string {
    const map: Record<Party['type'], string> = {
      'Customer': this.prefs.txt('কাস্টমার', 'Customer'),
      'Corporate Customer': this.prefs.txt('কর্পোরেট', 'Corporate'),
      'Supplier': this.prefs.txt('সরবরাহকারী', 'Supplier'),
      'Dealer': this.prefs.txt('ডিলার', 'Dealer'),
      'Staff Member': this.prefs.txt('স্টাফ', 'Staff')
    };
    return map[type] || type;
  }

  typeBadge(type: Party['type']): string {
    const map: Record<Party['type'], string> = {
      'Customer': 'bg-teal-100 text-teal-800',
      'Corporate Customer': 'bg-indigo-100 text-indigo-800',
      'Supplier': 'bg-amber-100 text-amber-800',
      'Dealer': 'bg-sky-100 text-sky-800',
      'Staff Member': 'bg-slate-200 text-slate-700'
    };
    return map[type] || 'bg-slate-100 text-slate-700';
  }

  dueTextClass(due: number): string {
    if (due > 0) return 'text-rose-600 dark:text-rose-400';
    if (due < 0) return 'text-emerald-600 dark:text-emerald-400';
    return 'text-slate-400';
  }

  dueCaption(due: number): string {
    if (due > 0) return this.activeTab() === 'Supplier'
      ? this.prefs.txt('প্রদেয়', 'Payable')
      : this.prefs.txt('বাকি', 'Due');
    if (due < 0) return this.activeTab() === 'All'
      ? this.prefs.txt('প্রদেয়', 'Payable')
      : this.prefs.txt('অগ্রিম', 'Advance');
    return this.prefs.txt('খালি', 'Clear');
  }

  /** Placeholder avatars from the old seed data render as random pictures; use initials instead. */
  avatarUrl(p: Party): string {
    const url = p.profileImage || '';
    return url && !url.includes('picsum.photos') ? url : '';
  }

  initials(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  displayDate(value: string): string {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || '').trim());
    return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : (value || '-');
  }

  /** Primary number with a "+N" hint when the party carries more than one. */
  phoneSummary(p: Party): string {
    const numbers = partyPhones(p);
    if (!numbers.length) return '-';
    return numbers.length === 1 ? numbers[0] : `${numbers[0]} +${numbers.length - 1}`;
  }

  phoneListTitle(p: Party): string {
    return partyPhones(p).join(', ');
  }

  filteredParties = computed(() => {
    let list = this.dataService.parties();
    const tab = this.activeTab();
    const q = this.searchQuery().toLowerCase().trim();

    if (tab !== 'All') {
      list = list.filter(p => hasPartyRole(p, tab as PartyType));
    }

    if (q) {
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.companyName.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q) ||
        (p.phone && p.phone.toLowerCase().includes(q)) ||
        (p.phones || []).some(value => (value || '').toLowerCase().includes(q))
      );
    }

    return this.sortParties(list);
  });

  readonly pager = createPager<Party>(() => this.filteredParties());

  private sortValue(p: Party, key: string): string | number {
    switch (key) {
      case 'company': return p.companyName || '';
      case 'name': return p.name || '';
      case 'type': return this.rolesOf(p).map(role => this.typeLabel(role)).join(', ');
      case 'total': return this.rowTotal(p);
      case 'paid': return this.rowPaid(p);
      case 'due': return this.rowDue(p);
      case 'status': return p.status || '';
      case 'inHand': return p.inHand || '';
      case 'createdAt': return p.createdAt || '';
      case 'address': return p.address || '';
      default: return p.name || '';
    }
  }

  private sortParties(list: Party[]): Party[] {
    const key = this.sortKey();
    if (!key) return list;
    const direction = this.sortDir() === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const left = this.sortValue(a, key);
      const right = this.sortValue(b, key);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' }) * direction;
    });
  }

  isSortable(key: string): boolean {
    return PARTY_SORTABLE.has(key);
  }

  sortBy(key: string) {
    if (!this.isSortable(key)) return;
    if (this.sortKey() === key) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
    this.pager.setPage(1);
  }

  sortIcon(key: string): string {
    if (this.sortKey() !== key) return 'unfold_more';
    return this.sortDir() === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  clearSort() {
    this.sortKey.set('');
    this.pager.setPage(1);
  }

  colLabel(key: string): string {
    const spec = PARTY_COL_SPECS[key];
    const bn = this.bnColLabels[key];
    if (!spec || !bn) return spec?.label ?? key;
    return this.prefs.txt(bn, spec.label);
  }

  toggleColumnSelector() {
    this.showColumnSelector.update(open => !open);
  }

  toggleColumn(key: string) {
    if (key === 'sl' || key === 'action') return;
    const layout = this.tableLayout();
    if (layout.visible[key] && this.visibleCols().length <= 1) return;
    this.tableLayout.set({ ...layout, visible: { ...layout.visible, [key]: !layout.visible[key] } });
    this.saveTableView();
  }

  selectAllColumns() {
    const layout = this.tableLayout();
    const visible: Record<string, boolean> = {};
    for (const key of layout.order) visible[key] = true;
    this.tableLayout.set({ ...layout, visible: { ...layout.visible, ...visible } });
    this.saveTableView();
  }

  resetColumns() {
    this.tableLayout.set(defaultColumnLayout(PARTY_TABLE_COLUMNS));
    this.saveTableView();
  }

  moveColumn(key: string, delta: -1 | 1) {
    const layout = this.tableLayout();
    const order = [...layout.order];
    const from = order.indexOf(key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    this.tableLayout.set({ ...layout, order });
    this.saveTableView();
  }

  private saveTableView() {
    saveColumnLayout(PARTY_TABLE_VIEW_KEY, this.tableLayout());
  }

  onColumnDrop(event: CdkDragDrop<ResolvedColumn[]>) {
    if (event.previousIndex === event.currentIndex) return;
    const layout = this.tableLayout();
    const visibleKeys = this.visibleCols().map(col => col.key);
    const nextOrder = reorderInView(layout.order, visibleKeys, event.previousIndex, event.currentIndex, key => key);
    this.tableLayout.set({ ...layout, order: nextOrder });
    this.saveTableView();
  }

  startColumnResize(event: MouseEvent, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const table = (event.target as HTMLElement).closest('table');
    const colEl = table?.querySelector<HTMLElement>(`col[data-col="${key}"]`);
    const startWidth = this.tableLayout().widths[key] ?? PARTY_COL_SPECS[key]?.width ?? 100;

    const onMove = (moveEvent: MouseEvent) => {
      const spec = PARTY_COL_SPECS[key];
      if (!spec) return;
      const width = clampLayoutWidth(spec, startWidth + moveEvent.clientX - startX);
      if (colEl) colEl.style.width = `${width}px`;
    };
    const onUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const spec = PARTY_COL_SPECS[key];
      if (!spec) return;
      const width = clampLayoutWidth(spec, startWidth + upEvent.clientX - startX);
      if (width !== startWidth) {
        this.tableLayout.update(layout => ({ ...layout, widths: { ...layout.widths, [key]: width } }));
        this.saveTableView();
      } else if (colEl) {
        colEl.style.width = `${startWidth}px`;
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  onSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.searchQuery.set(target.value);
    this.pager.setPage(1);
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.editingPartyId.set(null);
    this.currentStep.set(1);

    // Start from the active tab so adding from "Suppliers" opens a supplier form.
    const tab = this.activeTab();
    this.formTypes = [tab !== 'All' && PARTY_TABS.includes(tab) ? tab as PartyType : 'Customer'];
    this.formRole = this.defaultRoleFor(this.formTypes[0]);
    this.roleMenuOpen.set(false);
    this.formProfileImagePreview.set('');
    this.formWarehouse = 'SM Warehouse';
    this.formCompanyName = '';
    this.formName = '';
    this.formPhone = '';
    this.formExtraPhones = [];
    this.formEmail = '';
    this.formStatus = 'Enabled';

    this.formOpeningBalance = 0;
    this.formOpeningBalanceType = 'Pay';
    this.formTaxNumber = '';
    this.formCreditPeriod = 30;
    this.formCreditLimitMode = 'Manual';
    this.formCreditLimit = 0;
    this.formRemarks = '';
    this.formDocumentName = '';
    this.formDivision = '';
    this.formDistrict = '';
    this.formThana = '';
    this.formAreaRoadHouse = '';
    this.formGeofencing = false;
    this.nameError.set('');
    this.phoneError.set('');
    this.emailError.set('');

    this.showAddDrawer.set(true);
    setTimeout(() => this.nameInput()?.nativeElement.focus(), 80);
  }

  openEditModal(p: Party) {
    this.isEditMode.set(true);
    this.editingPartyId.set(p.id);
    this.currentStep.set(1);
    this.openingSaveUnlock.set(false);
    this.openingSaveUnlocked = false;

    this.formTypes = partyRoles(p);

    this.formRole = p.role || this.defaultRoleFor(this.formTypes[0]);
    this.roleMenuOpen.set(false);
    this.formProfileImagePreview.set(p.profileImage || '');
    this.formWarehouse = p.warehouse || 'SM Warehouse';
    this.formCompanyName = p.companyName && p.companyName !== 'N/A' ? p.companyName : '';
    this.formName = p.name || '';
    const storedPhones = partyPhones(p);
    this.formPhone = storedPhones[0] || '';
    this.formExtraPhones = storedPhones.slice(1);
    this.formEmail = p.email !== '-' ? p.email : '';
    this.formStatus = p.status || 'Enabled';

    const openingNow = this.effectiveOpening(p);
    this.formOpeningBalance = Math.round(Math.abs(openingNow) * 100) / 100;
    this.formOpeningBalanceType = openingNow < 0 ? 'Receive' : 'Pay';
    this.formTaxNumber = p.taxNumber || '';
    this.formCreditPeriod = p.creditPeriod ?? 30;
    this.formCreditLimitMode = p.creditLimitMode || 'Manual';
    this.formCreditLimit = p.creditLimit || 0;
    this.formRemarks = p.remarks || '';
    this.formDocumentName = p.documents !== '-' ? (p.documents || '') : '';
    this.formDistrict = geoNormalizeDistrict(p.district || '') || (p.district || '');
    this.formDivision = p.division || geoDivisionOfDistrict(p.district || '');
    this.formThana = p.upazila || p.thana || '';
    this.formAreaRoadHouse = p.areaRoadHouse
      || stripRegionNames(p.addressText || (p.address !== 'N/A' ? p.address : ''));
    this.formGeofencing = p.geofencing || false;
    this.nameError.set('');
    this.phoneError.set('');
    this.emailError.set('');

    this.showAddDrawer.set(true);
  }

  closeDrawer() {
    this.roleMenuOpen.set(false);
    this.showAddDrawer.set(false);
    this.openingSaveUnlock.set(false);
    this.openingSaveUnlocked = false;
  }

  async onProfileImageSelect(e: Event) {
    const picked = await this.media.pick(e, 'parties', this.formName || 'party');
    if (!picked.ok) {
      if (picked.error) this.notify.error(picked.error, 'Image');
      return;
    }
    this.formProfileImagePreview.set(picked.image.ref);
    if (picked.image.note) this.notify.warning(picked.image.note, 'Cloudinary');
  }

  toggleRoleMenu() {
    this.roleMenuOpen.update(open => !open);
  }

  addExtraPhone() {
    if (this.formExtraPhones.length >= this.maxExtraPhones) return;
    this.formExtraPhones = [...this.formExtraPhones, ''];
    this.phoneError.set('');
  }

  removeExtraPhone(index: number) {
    this.formExtraPhones = this.formExtraPhones.filter((_, i) => i !== index);
    this.phoneError.set('');
  }

  roleLabel(role: PartyType): string {
    return this.partyTypeOptions().find(option => option.value === role)?.label ?? role;
  }

  private defaultRoleFor(type: PartyType): string {
    if (type === 'Dealer') return 'Wholesaler';
    if (type === 'Supplier') return 'General Supplier';
    if (type === 'Staff Member') return 'Staff Agent';
    return 'Retailer';
  }

  isFormType(type: PartyType): boolean {
    return this.formTypes.includes(type);
  }

  toggleFormType(type: PartyType) {
    if (this.formTypes.includes(type)) {
      // Keep at least one role so the party still has a book.
      if (this.formTypes.length === 1) return;
      this.formTypes = this.formTypes.filter(item => item !== type);
      this.formRole = this.defaultRoleFor(this.formTypes[0]);
      return;
    }
    this.formTypes = [...this.formTypes, type];
    if (!this.formRole) this.formRole = this.defaultRoleFor(type);
  }

  /** Opening balances land on the sales book unless the party only supplies goods. */
  private openingSideFor(types: PartyType[]): 'sales' | 'purchase' {
    return types.some(type => SALES_PARTY_TYPES.includes(type)) ? 'sales' : 'purchase';
  }

  goToStep(step: 1 | 2) {
    if (step === 2 && !this.validateBasics()) return;
    this.currentStep.set(step);
    setTimeout(() => {
      const body = this.drawerBody()?.nativeElement;
      if (body) body.scrollTop = 0;
    });
  }

  private normalizePhone(value: string): string {
    let phone = (value || '').replace(/[\s-]/g, '');
    if (phone.startsWith('+88')) phone = phone.slice(3);
    else if (phone.startsWith('88') && phone.length === 13) phone = phone.slice(2);
    return phone;
  }

  private validateBasics(): boolean {
    const name = this.formName.trim();
    const email = this.formEmail.trim();
    const editing = this.editingPartyId() != null
      ? this.dataService.parties().find(p => p.id === this.editingPartyId())
      : undefined;
    // Numbers already stored on this party stay valid even if legacy data repeats them elsewhere.
    const ownKeys = editing ? partyPhones(editing).map(value => partyPhoneKey(value)).filter(Boolean) : [];
    const numbers = [this.formPhone, ...this.formExtraPhones]
      .map(value => this.normalizePhone(value))
      .filter(Boolean);
    const checked: string[] = [];
    let phoneMessage = '';
    if (!numbers.length) {
      phoneMessage = this.prefs.txt('মোবাইল নাম্বার লিখুন।', 'Enter a mobile number.');
    }
    for (const number of numbers) {
      if (phoneMessage) break;
      const key = partyPhoneKey(number);
      if (!/^01[3-9]\d{8}$/.test(number)) {
        phoneMessage = this.prefs.txt(
          `“${number}” সঠিক ১১ ডিজিটের মোবাইল নাম্বার নয় (যেমন 017XXXXXXXX)।`,
          `“${number}” is not a valid 11-digit mobile number (e.g. 017XXXXXXXX).`
        );
        break;
      }
      if (checked.includes(key)) {
        phoneMessage = this.prefs.txt('একই নম্বর একাধিকবার যোগ করা যাবে না।', 'The same number cannot be added twice.');
        break;
      }
      checked.push(key);
      if (ownKeys.includes(key)) continue;
      const phoneOwner = this.dataService.partyByPhone(number, this.editingPartyId());
      if (phoneOwner) {
        phoneMessage = this.prefs.txt(
          `“${number}” নাম্বারটি আগেই “${phoneOwner.name}” পার্টিতে আছে। এক নাম্বারে দুটি পার্টি আইডি তৈরি করা যাবে না।`,
          `“${number}” already belongs to “${phoneOwner.name}”. One phone number cannot have two party IDs.`
        );
        break;
      }
    }
    this.nameError.set(name ? '' : this.prefs.txt('পার্টির নাম লিখুন।', 'Enter the party name.'));
    this.phoneError.set(phoneMessage);
    this.emailError.set(
      !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : this.prefs.txt('সঠিক ইমেইল ঠিকানা দিন।', 'Enter a valid email address.')
    );
    if (this.nameError() || this.phoneError() || this.emailError()) {
      this.currentStep.set(1);
      return false;
    }
    return true;
  }

  private nonNegative(value: unknown, fallback: number): number {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(0, num) : fallback;
  }

  /** "Pay" is money the party owes the shop; "Receive" is an advance held for them. */
  private signedOpening(value: number, type: 'Pay' | 'Receive'): number {
    return type === 'Receive' ? -Math.abs(value) : Math.abs(value);
  }

  /**
   * Opening balance the books actually carry (due minus posted documents).
   * Imported or legacy rows baked their opening straight into the due, so the
   * stored column alone cannot be trusted as the current opening.
   */
  private effectiveOpening(party: Party): number {
    return this.dataService.partyOpeningBalance(
      party, this.openingSideFor(partyRoles(party))
    );
  }

  savePartyForm() {
    const cleanName = this.formName.trim();
    if (!this.validateBasics()) {
      this.notify.error(
        this.prefs.txt('ফরমে দেখানো তথ্যগুলো ঠিক করুন।', 'Fix the highlighted fields in the form.'),
        this.prefs.txt('তথ্য অসম্পূর্ণ', 'Incomplete information')
      );
      return;
    }
    this.formName = cleanName;
    const phones = Array.from(new Set(
      [this.formPhone, ...this.formExtraPhones].map(value => this.normalizePhone(value)).filter(Boolean)
    ));
    this.formPhone = phones[0] || '';
    this.formExtraPhones = phones.slice(1);
    this.formEmail = this.formEmail.trim();
    this.formOpeningBalance = Math.abs(Number(this.formOpeningBalance) || 0);
    // Ledger rows join parties and transactions by name, so duplicates break the books.
    const clash = this.dataService.parties().find(p =>
      p.name.trim().toLowerCase() === cleanName.toLowerCase() && p.id !== this.editingPartyId());
    if (clash) {
      this.notify.warning(
        this.prefs.txt(`“${cleanName}” নামে পার্টি আগেই আছে। নাম আলাদা রাখুন।`, `A party named “${cleanName}” already exists. Use a different name.`),
        this.prefs.txt('নামের দ্বৈততা', 'Duplicate name')
      );
      return;
    }
    this.formName = cleanName;

    // The first role stays the primary type; `roles` carries the full list.
    const mappedType: PartyType = this.formTypes[0] ?? 'Customer';
    const roles: PartyType[] = [...this.formTypes];

    const fullAddress = [this.formAreaRoadHouse, this.formThana, this.formDistrict, this.formDivision].filter(Boolean).join(', ') || 'N/A';
    const opening = this.canEditPartyMoney() ? (Number(this.formOpeningBalance) || 0) : 0;

    if (this.isEditMode() && this.editingPartyId()) {
      const existing = this.dataService.parties().find(p => p.id === this.editingPartyId());
      if (existing) {
        // Opening balance is part of the balance: shift the due by however much
        // the user changed it, so booked invoices and payments stay untouched.
        // It follows its book even when the party's roles change.
        const oldSide = this.openingSideFor(partyRoles(existing));
        const newSide = this.openingSideFor(roles);
        const oldSigned = this.dataService.partyOpeningBalance(existing, oldSide);
        const newSigned = this.signedOpening(opening, this.formOpeningBalanceType);
        const openingChanged = Math.abs(newSigned - oldSigned) >= 0.005;
        // A changed opening is a balance rewrite, so it needs the admin password.
        if (openingChanged && !this.openingSaveUnlocked) {
          if (!this.canEditPartyMoney()) {
            this.notify.warning(
              this.prefs.txt('পার্টির টাকা এডিট মালিক লক করে রেখেছেন। মালিককে জানান।', 'The owner has locked party money edits. Ask the owner.'),
              this.prefs.txt('লক করা আছে', 'Locked')
            );
            return;
          }
          if (!this.partyMoneyGrantedByPermission()) {
            this.openingSaveUnlock.set(true);
            return;
          }
        }
        let salesDue = salesAccountOf(existing).due;
        let purchaseDue = purchaseAccountOf(existing).due;
        if (oldSide === newSide) {
          if (newSide === 'sales') salesDue += newSigned - oldSigned;
          else purchaseDue += newSigned - oldSigned;
        } else {
          if (oldSide === 'sales') salesDue -= oldSigned;
          else purchaseDue -= oldSigned;
          if (newSide === 'sales') salesDue += newSigned;
          else purchaseDue += newSigned;
        }
        const round = (value: number) => Math.round(value * 100) / 100;
        this.dataService.updateParty({
          ...existing,
          name: this.formName,
          companyName: this.formCompanyName || 'N/A',
          type: mappedType,
          roles,
          status: this.formStatus,
          email: this.formEmail || '-',
          phone: this.formPhone || '-',
          phones: this.formExtraPhones.length ? [...this.formExtraPhones] : undefined,
          address: fullAddress,
          role: this.formRole,
          warehouse: this.formWarehouse,
          profileImage: this.formProfileImagePreview(),
          openingBalance: Number(this.formOpeningBalance) || 0,
          openingBalanceType: this.formOpeningBalanceType,
          salesDue: round(salesDue),
          purchaseDue: round(purchaseDue),
          taxNumber: this.formTaxNumber,
          creditPeriod: this.nonNegative(this.formCreditPeriod, 30),
          creditLimitMode: this.formCreditLimitMode,
          creditLimit: this.nonNegative(this.formCreditLimit, 0),
          remarks: this.formRemarks,
          documents: this.formDocumentName || '-',
          division: this.formDivision,
          district: this.formDistrict,
          upazila: this.formThana,
          // Thana and upazila are the same level, so keep one copy only.
          thana: undefined,
          areaRoadHouse: this.formAreaRoadHouse,
          addressText: undefined,
          zone: this.formDistrict || existing.zone,
          geofencing: this.formGeofencing
        });
        if (openingChanged) {
          this.session.log(
            'Party Opening Changed',
            `${existing.name} — ওপেনিং ${oldSigned} → ${newSigned} (বাকি সমন্বিত)`
          );
        } else {
          this.session.log('Party Updated', `${existing.name} — ${mappedType}`);
        }
        this.openingSaveUnlock.set(false);
        this.openingSaveUnlocked = false;
        this.notify.success(this.prefs.txt('পার্টির তথ্য আপডেট হয়েছে।', 'Party updated.'));
      }
    } else {
      const openingSide = this.openingSideFor(roles);
      const openingSigned = this.signedOpening(opening, this.formOpeningBalanceType);
      this.dataService.addParty({
        name: this.formName,
        companyName: this.formCompanyName || 'N/A',
        type: mappedType,
        roles,
        total: 0,
        paid: 0,
        due: openingSigned,
        salesTotal: 0,
        salesPaid: 0,
        salesDue: openingSide === 'sales' ? openingSigned : 0,
        purchaseTotal: 0,
        purchasePaid: 0,
        purchaseDue: openingSide === 'purchase' ? openingSigned : 0,
        status: this.formStatus,
        inHand: '0 Pcs',
        zone: this.formDistrict || '-',
        email: this.formEmail || '-',
        phone: this.formPhone || '-',
        phones: this.formExtraPhones.length ? [...this.formExtraPhones] : undefined,
        createdAt: localDateIso(),
        address: fullAddress,
        documents: this.formDocumentName || '-',
        nextPayment: '-',
        role: this.formRole,
        warehouse: this.formWarehouse,
        profileImage: this.formProfileImagePreview(),
        openingBalance: Number(this.formOpeningBalance) || 0,
        openingBalanceType: this.formOpeningBalanceType,
        taxNumber: this.formTaxNumber,
        creditPeriod: this.nonNegative(this.formCreditPeriod, 30),
        creditLimitMode: this.formCreditLimitMode,
        creditLimit: this.nonNegative(this.formCreditLimit, 0),
        remarks: this.formRemarks,
        division: this.formDivision,
        district: this.formDistrict,
        upazila: this.formThana,
        areaRoadHouse: this.formAreaRoadHouse,
        geofencing: this.formGeofencing
      });
      this.session.log('Party Created', `${cleanName} — ${mappedType} — ওপেনিং ${opening}`);
      this.notify.success(this.prefs.txt(`নতুন পার্টি সংরক্ষিত হয়েছে: ${cleanName}`, `New party saved: ${cleanName}`));
    }

    this.showAddDrawer.set(false);
  }

  async deleteParty(id: number) {
    const confirmed = await this.notify.confirm(
      this.prefs.txt('এই পার্টির রেকর্ড স্থায়ীভাবে মুছে যাবে।', 'This party record will be permanently deleted.'),
      {
        title: this.prefs.txt('পার্টি মুছে ফেলবেন?', 'Delete this party?'),
        kind: 'error',
        confirmText: this.prefs.txt('মুছুন', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (confirmed) {
      const name = this.dataService.parties().find(p => p.id === id)?.name ?? `#${id}`;
      this.dataService.deleteParty(id);
      this.session.log('Party Deleted', name);
      this.notify.success(this.prefs.txt('পার্টি মুছে ফেলা হয়েছে।', 'Party deleted.'));
    }
  }

  viewParty(p: Party) {
    this.ledgerAutoPay.set(false);
    this.ledgerPaymentOnly.set(false);
    this.ledgerParty.set(p);
  }

  editFromProfile(p: Party) {
    this.closeLedger();
    this.openEditModal(p);
  }

  /** Opens the admin correction on top of the profile so the drawer refreshes in place after saving. */
  fixOpeningFromProfile(p: Party) {
    this.openBalanceDialog(p);
  }

  /** The edit form's opening field is read-only; this jumps from it into the admin correction. */
  fixOpeningFromEditForm() {
    const id = this.editingPartyId();
    const party = id !== null ? this.dataService.parties().find(p => p.id === id) : undefined;
    if (!party) return;
    this.closeDrawer();
    this.openBalanceDialog(party);
  }

  payParty(p: Party) {
    this.ledgerAutoPay.set(false);
    this.ledgerPaymentOnly.set(true);
    this.ledgerParty.set(p);
  }

  openBalanceDialog(p: Party) {
    if (!this.canEditPartyMoney()) return;
    const live = this.dataService.parties().find(party => party.id === p.id) ?? p;
    const side = this.openingSideFor(partyRoles(live));
    const currentDue = accountOf(live, side).due;
    this.balanceDialogParty.set(live);
    this.balanceCurrentDue.set(currentDue);
    // The typed figure is the due itself, so start from the books' due.
    this.balanceFormAmount = Math.round(Math.max(0, currentDue) * 100) / 100;
    this.balanceFormReason = '';
    this.balanceError.set('');
    this.balanceUnlock.set(false);
  }

  closeBalanceDialog() {
    this.balanceDialogParty.set(null);
    this.balanceUnlock.set(false);
  }

  /** Validates the form, then asks for the admin password before touching the books. */
  requestBalanceCorrection() {
    const party = this.balanceDialogParty();
    if (!party || !this.canEditPartyMoney()) return;
    const amount = Number(this.balanceFormAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      this.balanceError.set(this.prefs.txt('সঠিক বাকি লিখুন (শূন্য বা বেশি)।', 'Enter a valid due (zero or more).'));
      return;
    }
    if (!this.balanceFormReason.trim()) {
      this.balanceError.set(this.prefs.txt('সংশোধনের কারণ লিখুন — অডিট লগে এটি সংরক্ষিত হবে।', 'Enter a reason — it is saved in the audit log.'));
      return;
    }
    this.balanceError.set('');
    // A user the owner explicitly granted party-money rights does not need the admin PIN.
    if (this.partyMoneyGrantedByPermission()) {
      this.confirmBalanceCorrection();
      return;
    }
    this.balanceUnlock.set(true);
  }

  /** Password verified for an opening change typed in the edit form; save again unlocked. */
  confirmOpeningSave() {
    if (!this.canEditPartyMoney()) return;
    this.openingSaveUnlock.set(false);
    this.openingSaveUnlocked = true;
    try {
      this.savePartyForm();
    } finally {
      this.openingSaveUnlocked = false;
    }
  }

  confirmBalanceCorrection() {
    this.balanceUnlock.set(false);
    const party = this.balanceDialogParty();
    if (!party || !this.canEditPartyMoney()) return;
    const reason = this.balanceFormReason.trim();
    const existing = this.dataService.parties().find(p => p.id === party.id) ?? party;
    const side = this.openingSideFor(partyRoles(existing));
    const round = (value: number) => Math.round(value * 100) / 100;
    // The typed figure is the final due; the opening moves by the same gap so the
    // ledger (opening + posted documents) still adds up to exactly that due.
    const targetDue = round(Math.max(0, Number(this.balanceFormAmount) || 0));
    const currentDue = accountOf(existing, side).due;
    const oldSigned = this.dataService.partyOpeningBalance(existing, side);
    const newSigned = round(oldSigned + targetDue - currentDue);
    const salesDue = side === 'sales' ? targetDue : round(salesAccountOf(existing).due);
    const purchaseDue = side === 'purchase' ? targetDue : round(purchaseAccountOf(existing).due);

    this.dataService.updateParty({
      ...existing,
      openingBalance: Math.abs(newSigned),
      openingBalanceType: newSigned < 0 ? 'Receive' : 'Pay',
      salesDue,
      purchaseDue
    });
    this.session.log(
      'Opening Balance Corrected',
      `${existing.name} — বাকি ${currentDue} → ${targetDue} (ওপেনিং ${oldSigned} → ${newSigned})। কারণ: ${reason}`
    );
    this.balanceDialogParty.set(null);
    this.notify.success(
      this.prefs.txt(`“${existing.name}” এর বাকি এখন ${targetDue.toFixed(2)} TK।`, `“${existing.name}” now shows a due of ${targetDue.toFixed(2)} TK.`),
      this.prefs.txt('সংশোধন সংরক্ষিত', 'Correction saved')
    );
  }

  closeLedger() {
    this.ledgerParty.set(null);
    this.ledgerAutoPay.set(false);
    this.ledgerPaymentOnly.set(false);
  }

  exportExcel() {
    this.dataService.exportToExcel(this.filteredParties(), 'Parties_List');
  }

  /** Word copy of the list exactly as filtered/sorted on screen, with shop letterhead and totals. */
  async exportWord() {
    if (this.wordBusy()) return;
    const rows = this.listDocumentRows();
    if (!rows.length) {
      this.notify.warning(this.prefs.txt('ডাউনলোড করার মতো কোনো পার্টি নেই।', 'No parties to download.'));
      return;
    }
    this.wordBusy.set(true);
    try {
      const shop = this.dataService.voucherSettings();
      const now = new Date();
      const stamp = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      await downloadPartyDocx(rows, {
        title: this.activeTabLabel(),
        scope: this.accountScopeLabel(),
        search: this.searchQuery().trim(),
        sort: this.listSortLabel(),
        dueLabel: this.dueColumnLabel(),
        generated: stamp,
        totals: this.totals(),
        shop: {
          name: `${shop.businessNamePart1} ${shop.businessNamePart2}`.trim(),
          address: shop.address || '',
          mobile: shop.mobile || '',
          email: shop.email || ''
        }
      });
    } catch (error) {
      this.notify.error(
        error instanceof Error ? error.message : String(error),
        this.prefs.txt('Word ফাইল তৈরি হয়নি', 'Word export failed')
      );
    } finally {
      this.wordBusy.set(false);
    }
  }

  async onFileImport(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file) return;
    try {
      const result = await this.dataService.importParties(file);
      this.notify.success(
        this.prefs.txt(
          `${result.added} নতুন কারবারি, ${result.updated} আপডেট${result.skipped ? `, ${result.skipped} বাদ পড়েছে` : ''}।`,
          `${result.added} added, ${result.updated} updated${result.skipped ? `, ${result.skipped} skipped` : ''}.`
        ),
        this.prefs.txt('ইমপোর্ট সম্পন্ন', 'Import complete')
      );
    } catch (error) {
      this.notify.error(
        error instanceof Error ? error.message : String(error),
        this.prefs.txt('ইমপোর্ট ব্যর্থ', 'Import failed')
      );
    }
  }
}
