import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BATTERY_KINDS, BatteryFundTransfer, BatteryKind, BatteryKindStock, BatteryLine, BatteryStockRow, BatteryUnit, BatteryVoucher, BatteryVoucherType, DataService, LEDGER_MODES, LedgerPayment, Party, batteryKindByKey } from '../../services/data';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { SessionService } from '../../services/session';
import { MediaService } from '../../services/media';
import { dmyFromIso, localDateIso } from '../../utils/local-date';
import { DateRange, inDateRange, resolveDateRange, toIsoDate } from '../../utils/date-range';
import { persistedSignal } from '../../utils/persisted-signal';
import { QtyPipe, formatQty, formatQtyInput, roundQty } from '../../utils/quantity';
import { BatteryVoucherComponent } from '../../components/battery-voucher/battery-voucher';
import { GeoSelect } from '../../components/geo-select/geo-select';
import { PasscodeModal } from '../../components/passcode-modal/passcode-modal';
import { DateRangeBar } from '../../components/date-range-bar/date-range-bar';
import { DmyDateDirective } from '../../directives/dmy-date.directive';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';

/** Pseudo kind for good batteries that came in through exchanges; kept out of BATTERY_KINDS. */
const EXCHANGE_KIND: BatteryKind = { key: 'exchange', bn: 'বদল থেকে প্রাপ্ত (ভালো)', en: 'Received via exchange (good)', unit: 'kg' };

@Component({
  selector: 'app-battery-vouchers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, BatteryVoucherComponent, GeoSelect, PasscodeModal, DateRangeBar, DmyDateDirective, QtyPipe, TablePagination],
  template: `
    <div class="space-y-4">
      <!-- Header -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <mat-icon class="text-teal-600">{{ view() === 'ledger' ? 'inventory_2' : view() === 'vouchers' ? 'receipt_long' : 'recycling' }}</mat-icon> {{ title() }}
          </h1>
          @if (view() === 'entry') {
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ prefs.txt('ভাউচার নং', 'Voucher No') }}: <span class="font-mono font-bold">{{ headerVoucherNo() }}</span></p>
          } @else if (view() === 'vouchers') {
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ prefs.txt('মোট', 'Total') }} <span class="font-bold text-slate-700 dark:text-slate-200">{{ history().length }}</span> {{ prefs.txt('টি ভাউচার — তারিখ অনুযায়ী সর্বশেষ উপরে', 'vouchers — newest first') }}</p>
          } @else {
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ prefs.txt('কোন তারিখে কত মাল ঢুকল, কত বেরোল — ধরন অনুযায়ী মজুদ, দাম ও লেনদেন এক নজরে।', 'What came in and went out on each date — stock, value and entries per kind at a glance.') }}</p>
          }
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          @if (view() === 'ledger') {
            <a routerLink="/battery/purchase" class="px-3 py-1.5 rounded-lg font-bold bg-teal-600 text-white hover:bg-teal-700 cursor-pointer flex items-center gap-1">
              <mat-icon class="text-sm">add</mat-icon> {{ prefs.txt('নতুন ক্রয়', 'New purchase') }}
            </a>
            <a routerLink="/battery/sale" class="px-3 py-1.5 rounded-lg font-bold bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer flex items-center gap-1">
              <mat-icon class="text-sm">add</mat-icon> {{ prefs.txt('নতুন বিক্রয়', 'New sale') }}
            </a>
          } @else {
            <a [routerLink]="typeRoute('purchase')" [class]="tabClass('purchase')">{{ prefs.txt('ক্রয়', 'Purchase') }}</a>
            <a [routerLink]="typeRoute('sale')" [class]="tabClass('sale')">{{ prefs.txt('কেজিতে/পিস বিক্রি', 'Sale (kg/pcs)') }}</a>
            <a [routerLink]="typeRoute('exchange')" [class]="tabClass('exchange')">{{ prefs.txt('বদল', 'Exchange') }}</a>
            <a routerLink="/battery/ledger" class="px-3 py-1.5 rounded-lg font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 cursor-pointer flex items-center gap-1">
              <mat-icon class="text-sm">inventory_2</mat-icon> {{ prefs.txt('লেজার', 'Ledger') }}
            </a>
            @if (view() === 'entry') {
              <a [routerLink]="voucherListRoute()" class="px-3 py-1.5 rounded-lg font-bold bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer flex items-center gap-1">
                <mat-icon class="text-sm">receipt_long</mat-icon> {{ prefs.txt('ভাউচার তালিকা', 'Voucher list') }}
              </a>
            } @else {
              <a [routerLink]="entryRoute()" class="px-3 py-1.5 rounded-lg font-bold bg-teal-600 text-white hover:bg-teal-700 cursor-pointer flex items-center gap-1">
                <mat-icon class="text-sm">add</mat-icon> {{ prefs.txt('নতুন এন্ট্রি', 'New entry') }}
              </a>
            }
          }
        </div>
      </div>

      <!-- Summary cards -->
      @if (view() === 'entry') {
        <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          @for (card of summaryCards(); track card.label) {
            <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <p class="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{{ card.label }}</p>
              <p class="text-base font-extrabold mt-1" [class]="card.color">{{ card.value }}</p>
            </div>
          }
        </div>
        @if (summary().incompleteSales > 0) {
          <p class="flex items-center gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
            <mat-icon class="text-sm">info</mat-icon>
            {{ prefs.txt(summary().incompleteSales + 'টি বিক্রয়ের ক্রয়খরচ পাওয়া যায়নি — সেগুলো লাভে ধরা হয়নি। ভাউচারে খরচ বসালে হিসাব যোগ হবে।', summary().incompleteSales + ' sale(s) have no purchase cost — kept out of profit until a cost is set on the voucher.') }}
          </p>
        }
      } @else if (view() === 'vouchers') {
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          @for (card of voucherCards(); track card.label) {
            <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <p class="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{{ card.label }}</p>
              <p class="text-base font-extrabold mt-1" [class]="card.color">{{ card.value }}</p>
            </div>
          }
        </div>
      }

      @if (view() === 'entry') {
      @if (editingVoucher(); as editing) {
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span class="flex items-center gap-1.5 font-bold">
            <mat-icon class="text-base">edit_note</mat-icon>
            {{ prefs.txt('এডিট করছেন', 'Editing') }} <span class="font-mono">{{ editing.voucherNo }}</span> — {{ editing.partyName }}
          </span>
          <button type="button" (click)="cancelEdit()" class="cursor-pointer rounded-lg bg-white/70 px-2 py-1 font-bold text-amber-800 hover:bg-white dark:bg-slate-900/40 dark:text-amber-200">
            {{ prefs.txt('এডিট বাতিল', 'Cancel edit') }}
          </button>
        </div>
      }
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <!-- Entry form -->
        <div class="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="relative">
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">{{ sellerLabel() }} *</label>
              <div class="mt-1 flex gap-1">
                <input [value]="partyQuery()" (input)="onPartyQuery($event)" (focus)="partyOpen.set(true)" (blur)="closePartySoon()"
                  [placeholder]="prefs.txt('পার্টি খুঁজুন / নাম লিখুন', 'Search party / type name')"
                  class="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
                <button type="button" (click)="openCustomerModal()" [title]="prefs.txt('নতুন কাস্টমার', 'New customer')"
                  class="shrink-0 px-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white flex items-center cursor-pointer">
                  <mat-icon class="text-base">person_add</mat-icon>
                </button>
              </div>
              @if (partyOpen()) {
                <div class="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg max-h-56 overflow-auto">
                  @for (p of partyMatches(); track p.id) {
                    <button type="button" (click)="pickParty(p)" class="w-full text-left px-3 py-2 text-xs hover:bg-teal-50 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-0 cursor-pointer">
                      <span class="font-semibold text-slate-800 dark:text-slate-100">{{ p.name }}</span>
                      <span class="text-slate-400"> · {{ p.type }}</span>
                      @if (p.phone) {
                        <span class="text-slate-400"> · {{ p.phone }}</span>
                      }
                    </button>
                  } @empty {
                    <p class="px-3 py-2 text-[11px] text-slate-400">{{ prefs.txt('কোনো পার্টি মেলেনি', 'No party matched') }}</p>
                  }
                  <button type="button" (click)="openCustomerModal()" class="w-full text-left px-3 py-2 text-xs font-bold text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer">
                    <mat-icon class="text-sm">add</mat-icon> {{ prefs.txt('নতুন কাস্টমার যোগ করুন', 'Add new customer') }}
                  </button>
                </div>
              }
            </div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {{ prefs.txt('তারিখ', 'Date') }} *
              <input type="date" appDmyDate [(ngModel)]="date" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
            </label>
            @if (type() !== 'exchange') {
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {{ prefs.txt('লট / স্টক রেফারেন্স', 'Lot / stock reference') }} *
                <div class="mt-1 flex gap-1">
                  <input [(ngModel)]="lot" class="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
                  <button type="button" (click)="regenerateLot()" [title]="prefs.txt('অটো জেনারেট', 'Auto generate')"
                    class="shrink-0 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center cursor-pointer">
                    <mat-icon class="text-base">autorenew</mat-icon>
                  </button>
                </div>
              </label>
            }
          </div>

          @if (type() === 'sale') {
            <div class="rounded-xl border border-slate-200 dark:border-slate-700 p-2.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-[10px] font-black uppercase tracking-wide text-slate-400">{{ prefs.txt('ধরনভিত্তিক স্টক', 'Stock by kind') }}</p>
                <span class="flex items-center gap-1 text-[10px] text-slate-400">
                  <mat-icon class="text-xs">info</mat-icon> {{ prefs.txt('স্টক থাকলেই বিক্রি করা যাবে', 'A kind can be sold only while its stock lasts') }}
                </span>
              </div>
              <div class="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-5">
                @for (k of saleKindStock(); track k.key) {
                  <div class="rounded-lg border p-2"
                    [class]="k.qty > 0 ? 'border-slate-200 dark:border-slate-700' : 'border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30'">
                    <p class="truncate text-[10px] font-bold text-slate-500 dark:text-slate-400" [title]="k.label">{{ k.label }}</p>
                    <p class="text-sm font-black" [class]="k.qty > 0 ? 'text-teal-700 dark:text-teal-300' : 'text-rose-600 dark:text-rose-400'">
                      {{ k.qty > 0 ? (k.qty | qty:k.unit) + ' ' + (k.unit === 'pcs' ? prefs.txt('পিস', 'pcs') : prefs.txt('কেজি', 'kg')) : prefs.txt('স্টকে নেই', 'No stock') }}
                    </p>
                    @if (k.qty > 0) {
                      <p class="text-[9px] text-slate-400">{{ prefs.txt('গড় দর', 'Avg rate') }} {{ k.avgRate.toFixed(2) }}</p>
                    }
                  </div>
                }
              </div>
            </div>
          }

          @if (type() === 'exchange') {
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="rounded-xl border border-teal-200 dark:border-teal-800 p-3 space-y-2">
                <p class="text-xs font-bold text-teal-700 dark:text-teal-300">{{ prefs.txt('প্রাপ্ত ব্যাটারি', 'Received battery') }}</p>
                <input [(ngModel)]="receivedId" [placeholder]="prefs.txt('লট / সিরিয়াল', 'Lot / serial')" class="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
                <div class="flex gap-2">
                  <input type="number" min="0" step="0.1" [ngModel]="receivedKg()" (ngModelChange)="receivedKg.set(+$event)" [placeholder]="prefs.txt('ওজন (কেজি)', 'Weight (kg)')" class="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
                  <select [(ngModel)]="receivedCondition" class="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-2 text-sm">
                    <option value="scrap">{{ prefs.txt('স্ক্র্যাপ', 'Scrap') }}</option>
                    <option value="usable">{{ prefs.txt('ব্যবহারযোগ্য', 'Usable') }}</option>
                  </select>
                </div>
              </div>
              <div class="rounded-xl border border-amber-200 dark:border-amber-800 p-3 space-y-2">
                <p class="text-xs font-bold text-amber-700 dark:text-amber-300">{{ prefs.txt('দেওয়া ব্যাটারি (ভালো)', 'Given battery (good)') }}</p>
                <input [(ngModel)]="givenId" [placeholder]="prefs.txt('লট / সিরিয়াল', 'Lot / serial')" class="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
                <input type="number" min="0" step="0.1" [ngModel]="givenKg()" (ngModelChange)="givenKg.set(+$event)" [placeholder]="prefs.txt('ওজন (কেজি)', 'Weight (kg)')" class="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
              </div>
            </div>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 sm:w-1/3">
              {{ prefs.txt('সম্মত বদলি ফি', 'Agreed exchange fee') }} *
              <input type="number" min="0" step="0.01" [ngModel]="fee()" (ngModelChange)="fee.set(+$event)" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
            </label>
          } @else {
            <div>
              <div class="flex items-center justify-between mb-2">
                <p class="text-xs font-bold text-slate-600 dark:text-slate-300">{{ prefs.txt('ব্যাটারির লাইন', 'Battery lines') }}</p>
                <button type="button" (click)="addLine()" class="text-xs font-bold text-teal-700 dark:text-teal-300 hover:underline cursor-pointer flex items-center gap-1">
                  <mat-icon class="text-sm">add</mat-icon> {{ prefs.txt('লাইন যোগ করুন', 'Add line') }}
                </button>
              </div>
              <div class="space-y-2">
                @for (line of lines(); track $index) {
                  <div class="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                    <label class="flex-1 min-w-36 text-[11px] font-semibold text-slate-500">
                      {{ prefs.txt('ধরন', 'Kind') }}
                      <select [ngModel]="line.kindKey || line.kind" (ngModelChange)="onKindSelect($index, $event)" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
                        @for (k of kindCatalog(); track k.key) { <option [value]="k.key">{{ kindOptionLabel(k) }}</option> }
                      </select>
                    </label>
                    <div class="w-24 text-[11px] font-semibold text-slate-500">
                      {{ prefs.txt('ইউনিট', 'Unit') }}
                      @if (line.kindKey === 'other') {
                        <select [ngModel]="line.unit || 'kg'" (ngModelChange)="onUnitSelect($index, $event)" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1 py-1.5 text-sm">
                          <option value="kg">{{ prefs.txt('কেজি', 'Kg') }}</option>
                          <option value="pcs">{{ prefs.txt('পিস', 'Pcs') }}</option>
                        </select>
                      } @else {
                        <p class="mt-1 px-2 py-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">{{ unitLabel(line.unit) }}</p>
                      }
                    </div>
                    @if (type() === 'sale') {
                      <div class="w-28 text-[11px] font-semibold text-slate-500">
                        {{ prefs.txt('স্টক', 'Stock') }}
                        <p class="mt-1 rounded-lg px-2 py-1.5 text-sm font-bold"
                          [class]="lineAvailable($index) > 0 ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300' : 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300'">
                          {{ lineAvailable($index) > 0 ? (lineAvailable($index) | qty:line.unit) + ' ' + unitLabel(line.unit) : prefs.txt('স্টকে নেই', 'No stock') }}
                        </p>
                      </div>
                    }
                    <label class="w-28 text-[11px] font-semibold text-slate-500">
                      {{ prefs.txt('পরিমাণ', 'Qty') }} ({{ unitLabel(line.unit) }})
                      <input type="number" min="0" [attr.step]="line.unit === 'pcs' ? 1 : 0.1" [attr.max]="type() === 'sale' ? lineAvailable($index) : null" [ngModel]="line.kg" (ngModelChange)="onLineQty($index, $event, qtyBox)" (blur)="onLineQtyBlur($index, qtyBox)" #qtyBox class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm" />
                    </label>
                    <label class="w-28 text-[11px] font-semibold text-slate-500">
                      {{ prefs.txt('দর', 'Rate') }} / {{ unitLabel(line.unit) }}
                      <input type="number" min="0" step="0.01" [ngModel]="line.rate" (ngModelChange)="updateLine($index, { rate: +$event })" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm" />
                    </label>
                    <div class="w-28 text-[11px] font-semibold text-slate-500">
                      {{ prefs.txt('মোট', 'Amount') }}
                      <p class="mt-1 px-2 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">{{ (line.kg * line.rate).toFixed(2) }}</p>
                    </div>
                    <button type="button" (click)="removeLine($index)" class="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950 rounded-lg cursor-pointer" [title]="prefs.txt('সারি সরান', 'Remove row')">
                      <mat-icon class="text-base">delete</mat-icon>
                    </button>
                  </div>
                }
              </div>
            </div>
            @if (type() === 'sale') {
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 sm:w-1/2">
                {{ prefs.txt('বিক্রিত লটের মোট খরচ', 'Total cost of sold lot') }}
                <input type="number" min="0" step="0.01" [ngModel]="displayCost()" (ngModelChange)="onCostInput($event)" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
                <span class="flex flex-wrap items-center gap-x-2 text-[10px] text-slate-400">
                  @if (costManual()) {
                    <span>{{ prefs.txt('লটের খরচ হাতে লেখা হয়েছে', 'Lot cost entered manually') }}</span>
                    <button type="button" (click)="resetCostToAuto()" class="cursor-pointer font-bold text-teal-600 hover:underline dark:text-teal-300">{{ prefs.txt('অটোতে ফেরান', 'Use auto') }}</button>
                  } @else if (autoIncomplete()) {
                    <span class="font-bold text-amber-600 dark:text-amber-400">{{ prefs.txt('ক্রয় খরচ: ক্রয়খরচ অসম্পূর্ণ', 'Lot cost: purchase cost incomplete') }}</span>
                  } @else {
                    <span>{{ prefs.txt('ক্রয় লটের দরে অটো হিসাব', 'Auto at purchase lot cost') }}: <strong class="text-teal-600 dark:text-teal-300">{{ autoCost().toFixed(2) }} TK</strong></span>
                  }
                  <span>· {{ prefs.txt('গড় ক্রয়মূল্য', 'Avg purchase cost') }}: {{ summary().avgCostPerKg.toFixed(2) }} {{ prefs.txt('প্রতি কেজি', 'per kg') }} · {{ prefs.txt('বর্তমান স্টক', 'In stock') }}: {{ summary().stockKg | qty:'kg' }} {{ prefs.txt('কেজি', 'kg') }}@if (summary().stockPcs > 0) {<span> · {{ summary().stockPcs | qty:'pcs' }} {{ prefs.txt('পিস', 'pcs') }}</span>}</span>
                </span>
                @if (!costManual() && autoIncomplete()) {
                  <span class="mt-1 block rounded bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">{{ prefs.txt('এই স্টকের ক্রয়খরচ পাওয়া যাচ্ছে না — খরচ লিখুন, নয়তো ভাউচারে ‘ক্রয়খরচ অসম্পূর্ণ’ দেখাবে।', 'No purchase cost found for this stock — enter the cost, or the voucher will read “purchase cost incomplete”.') }}</span>
                }
              </label>
            }
          }

          <!-- Payments -->
          <div>
            <p class="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2">{{ type() === 'purchase' ? prefs.txt('বাস্তবে যা দিয়েছেন', 'Actually paid') : prefs.txt('বাস্তবে যা পেয়েছেন', 'Actually received') }}</p>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label class="block text-[11px] font-semibold text-slate-500">
                {{ prefs.txt('নগদ', 'Cash') }}
                <input type="number" min="0" step="0.01" [ngModel]="cash()" (ngModelChange)="cash.set(+$event)" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
              </label>
              <label class="block text-[11px] font-semibold text-slate-500">
                {{ prefs.txt('ব্যাংক', 'Bank') }}
                <input type="number" min="0" step="0.01" [ngModel]="bank()" (ngModelChange)="bank.set(+$event)" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
              </label>
              <label class="block text-[11px] font-semibold text-slate-500">
                {{ prefs.txt('মোবাইল', 'Mobile') }}
                <div class="mt-1 flex gap-1">
                  <input type="number" min="0" step="0.01" [ngModel]="mobile()" (ngModelChange)="mobile.set(+$event)" class="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-2 text-sm" />
                  <select [(ngModel)]="mobileType" class="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1 py-2 text-xs">
                    <option value="bKash">bKash</option>
                    <option value="Nagad">Nagad</option>
                  </select>
                </div>
              </label>
              <label class="block text-[11px] font-semibold text-slate-500">
                {{ prefs.txt('রেফারেন্স (ঐচ্ছিক)', 'Reference (optional)') }}
                <input [(ngModel)]="ref" [placeholder]="prefs.txt('ব্যাংক / মোবাইল রেফারেন্স — খালি রাখা যাবে', 'Bank / mobile reference — may stay blank')" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
              </label>
            </div>
          </div>

          <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
            {{ prefs.txt('নোট', 'Notes') }}
            <textarea [(ngModel)]="notes" rows="2" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"></textarea>
          </label>

          @if (errors().length) {
            <div class="rounded-lg bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800 p-3 text-xs text-rose-700 dark:text-rose-300 space-y-1">
              @for (e of errors(); track e) { <p>• {{ e }}</p> }
            </div>
          }

          <div class="flex flex-wrap gap-2">
            <button type="button" (click)="save()" class="bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-base">{{ editingVoucher() ? 'update' : 'save' }}</mat-icon> {{ editingVoucher() ? prefs.txt('আপডেট করুন', 'Update voucher') : prefs.txt('ভাউচার সংরক্ষণ', 'Save voucher') }}
            </button>
            <button type="button" (click)="resetForm()" class="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold px-4 py-2 rounded-lg text-sm cursor-pointer">
              {{ prefs.txt('রিসেট', 'Reset') }}
            </button>
          </div>
        </div>

        <!-- Live totals -->
        <aside class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2 lg:sticky lg:top-4">
          <h2 class="text-sm font-extrabold text-slate-700 dark:text-slate-200">{{ prefs.txt('লাইভ হিসাব', 'Live totals') }}</h2>
          @for (row of totalRows(); track row.label) {
            <div class="flex justify-between gap-2 border-b border-slate-100 dark:border-slate-800 py-1.5 text-xs">
              <span class="text-slate-500 dark:text-slate-400">{{ row.label }}</span>
              <strong class="text-slate-800 dark:text-slate-100">{{ row.value }}</strong>
            </div>
          }
          <div class="flex justify-between gap-2 rounded-lg bg-teal-50 dark:bg-teal-950 p-2.5 text-sm font-extrabold text-teal-800 dark:text-teal-200">
            <span>{{ due() > 0 ? prefs.txt('বাকি', 'Balance due') : prefs.txt('পরিশোধিত', 'Settled') }}</span>
            <span>{{ due().toFixed(2) }}</span>
          </div>
          <p class="text-[10px] text-slate-400 pt-1">{{ prefs.txt('সংরক্ষণ করলে নগদ / ব্যাংক / মোবাইল মূল অ্যাকাউন্টে পোস্ট হবে।', 'On save, cash / bank / mobile post to the main accounts.') }}</p>
        </aside>
      </div>
      }

      @if (view() === 'ledger') {
      <!-- Stock ledger: overview first, then one of the two books -->
      <div class="space-y-4">

        <!-- Book switcher: a segmented tab so each view keeps its own title -->
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-700 dark:bg-slate-800/70">
            <button type="button" (click)="ledgerView.set('daily')"
              class="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition-colors"
              [class]="ledgerView() === 'daily'
                ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-900 dark:text-teal-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'">
              <mat-icon class="text-base">event_note</mat-icon>
              {{ prefs.txt('দিনভিত্তিক ইন / আউট', 'Day-wise in / out') }}
              <span class="rounded-full px-1.5 py-0.5 font-mono text-[9px]"
                [class]="ledgerView() === 'daily' ? 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300' : 'bg-white/70 text-slate-400 dark:bg-slate-900/60'">{{ ledgerDaily().length }}</span>
            </button>
            <button type="button" (click)="ledgerView.set('book')"
              class="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition-colors"
              [class]="ledgerView() === 'book'
                ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'">
              <mat-icon class="text-base">menu_book</mat-icon>
              {{ prefs.txt('লেনদেনের বই', 'Transaction book') }}
              <span class="rounded-full px-1.5 py-0.5 font-mono text-[9px]"
                [class]="ledgerView() === 'book' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-white/70 text-slate-400 dark:bg-slate-900/60'">{{ ledgerRows().length }}</span>
            </button>
          </div>
          <p class="text-[10px] font-semibold text-slate-400">
            @if (ledgerView() === 'daily') {
              {{ prefs.txt('দিনে ক্লিক করলে ওই তারিখের লেনদেনের বই খুলবে।', 'Click a day to open that date in the transaction book.') }}
            } @else {
              {{ prefs.txt('সারিতে ক্লিক করলে লেনদেনের বিস্তারিত দেখাবে।', 'Click a row to open its full details.') }}
            }
          </p>
        </div>

        <!-- Stock & selected-range overview -->
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          @if (summary(); as s) {
            <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-700 via-teal-600 to-indigo-700 p-4 text-white shadow-sm sm:col-span-2 xl:col-span-1">
              <mat-icon class="pointer-events-none absolute -right-3 -top-3 text-[96px] leading-none text-white/10">battery_charging_full</mat-icon>
              <p class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-teal-100">
                <mat-icon class="text-sm">inventory_2</mat-icon> {{ prefs.txt('বর্তমান মজুদ', 'Current stock') }}
              </p>
              <div class="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                <p class="flex items-end gap-1">
                  <span class="text-3xl font-black leading-none tabular-nums" [class]="s.stockKg < 0 ? 'text-rose-200' : ''">{{ s.stockKg | qty:'kg' }}</span>
                  <span class="pb-0.5 text-[11px] font-bold text-teal-100">{{ prefs.txt('কেজি', 'kg') }}</span>
                </p>
                @if (s.stockPcs !== 0) {
                  <p class="flex items-end gap-1">
                    <span class="text-2xl font-black leading-none tabular-nums">{{ s.stockPcs | qty:'pcs' }}</span>
                    <span class="pb-0.5 text-[11px] font-bold text-teal-100">{{ prefs.txt('পিস', 'pcs') }}</span>
                  </p>
                }
              </div>
              <div class="mt-3 grid grid-cols-2 gap-2 border-t border-white/20 pt-2.5">
                <div>
                  <p class="text-[9.5px] text-teal-100/80">{{ prefs.txt('মোট মূল্য', 'Total value') }}</p>
                  <p class="font-mono text-sm font-black">{{ s.stockValue | number:'1.2-2' }} <span class="text-[9px]">TK</span></p>
                </div>
                <div>
                  <p class="text-[9.5px] text-teal-100/80">{{ prefs.txt('গড় ক্রয় / কেজি', 'Avg cost / kg') }}</p>
                  <p class="font-mono text-sm font-black">{{ s.avgCostPerKg | number:'1.2-2' }} <span class="text-[9px]">TK</span></p>
                </div>
              </div>
              <p class="mt-2 flex flex-wrap items-center justify-between gap-1 text-[9.5px] text-teal-100/80">
                <span>{{ activeKindCount() }} {{ prefs.txt('টি ধরনে মজুদ', 'kinds in stock') }}</span>
                <span class="rounded-full bg-white/15 px-2 py-0.5 font-bold">{{ ledgerRows().length }} {{ prefs.txt('লেনদেন দেখা হচ্ছে', 'entries listed') }}</span>
              </p>
            </div>
          }

          @if (ledgerWindowTotals(); as w) {
            <div class="rounded-2xl border border-teal-200/80 bg-white p-3.5 dark:border-teal-900/70 dark:bg-slate-900">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[10px] font-bold uppercase tracking-wide text-teal-600 dark:text-teal-400">{{ prefs.txt('স্টকে ঢুকেছে', 'Stock in') }}</p>
                <span class="grid size-7 place-items-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-300"><mat-icon class="text-base">south_west</mat-icon></span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-end gap-x-2.5 gap-y-1">
                @if (ledgerHasKg()) {
                  <p class="font-mono text-xl font-black leading-none text-teal-700 dark:text-teal-300">{{ w.kgIn | qty:'kg' }} <span class="text-[10px] font-bold text-teal-500">{{ prefs.txt('কেজি', 'kg') }}</span></p>
                }
                @if (ledgerHasPcs()) {
                  <p class="font-mono text-base font-black leading-none text-teal-600 dark:text-teal-400">{{ w.pcsIn | qty:'pcs' }} <span class="text-[10px] font-bold text-teal-500">{{ prefs.txt('পিস', 'pcs') }}</span></p>
                }
                @if (!ledgerHasKg() && !ledgerHasPcs()) {
                  <p class="font-mono text-xl font-black text-slate-300 dark:text-slate-600">0.0</p>
                }
              </div>
              <p class="mt-1.5 text-[9.5px] text-slate-400">{{ prefs.txt('নির্বাচিত সময়ে', 'In selected range') }} · {{ w.inValue | number:'1.2-2' }} TK</p>
            </div>

            <div class="rounded-2xl border border-rose-200/80 bg-white p-3.5 dark:border-rose-900/70 dark:bg-slate-900">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">{{ prefs.txt('স্টক থেকে বের', 'Stock out') }}</p>
                <span class="grid size-7 place-items-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300"><mat-icon class="text-base">north_east</mat-icon></span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-end gap-x-2.5 gap-y-1">
                @if (ledgerHasKg()) {
                  <p class="font-mono text-xl font-black leading-none text-rose-600 dark:text-rose-400">{{ w.kgOut | qty:'kg' }} <span class="text-[10px] font-bold text-rose-400">{{ prefs.txt('কেজি', 'kg') }}</span></p>
                }
                @if (ledgerHasPcs()) {
                  <p class="font-mono text-base font-black leading-none text-rose-500 dark:text-rose-400">{{ w.pcsOut | qty:'pcs' }} <span class="text-[10px] font-bold text-rose-400">{{ prefs.txt('পিস', 'pcs') }}</span></p>
                }
                @if (!ledgerHasKg() && !ledgerHasPcs()) {
                  <p class="font-mono text-xl font-black text-slate-300 dark:text-slate-600">0.0</p>
                }
              </div>
              <p class="mt-1.5 text-[9.5px] text-slate-400">{{ prefs.txt('নির্বাচিত সময়ে', 'In selected range') }} · {{ w.outValue | number:'1.2-2' }} TK</p>
            </div>

            <div class="rounded-2xl border border-indigo-200/80 bg-white p-3.5 dark:border-indigo-900/70 dark:bg-slate-900">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[10px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{{ prefs.txt('নিট পরিবর্তন', 'Net change') }}</p>
                <span class="grid size-7 place-items-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300"><mat-icon class="text-base">swap_vert</mat-icon></span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-end gap-x-2.5 gap-y-1">
                @if (ledgerHasKg()) {
                  <p class="font-mono text-xl font-black leading-none" [class]="ledgerNet().kg < 0 ? 'text-rose-600 dark:text-rose-400' : ledgerNet().kg > 0 ? 'text-teal-700 dark:text-teal-300' : 'text-slate-400'">
                    {{ ledgerNet().kg > 0 ? '+' : '' }}{{ ledgerNet().kg | qty:'kg' }} <span class="text-[10px] font-bold text-slate-400">{{ prefs.txt('কেজি', 'kg') }}</span>
                  </p>
                }
                @if (ledgerHasPcs()) {
                  <p class="font-mono text-base font-black leading-none" [class]="ledgerNet().pcs < 0 ? 'text-rose-600 dark:text-rose-400' : ledgerNet().pcs > 0 ? 'text-teal-700 dark:text-teal-300' : 'text-slate-400'">
                    {{ ledgerNet().pcs > 0 ? '+' : '' }}{{ ledgerNet().pcs | qty:'pcs' }} <span class="text-[10px] font-bold text-slate-400">{{ prefs.txt('পিস', 'pcs') }}</span>
                  </p>
                }
                @if (!ledgerHasKg() && !ledgerHasPcs()) {
                  <p class="font-mono text-xl font-black text-slate-300 dark:text-slate-600">0.00</p>
                }
              </div>
              <p class="mt-1.5 text-[9.5px] text-slate-400">{{ prefs.txt('ইন − আউট', 'In − out') }} · {{ w.entries }} {{ prefs.txt('টি লেনদেন', 'entries') }}</p>
            </div>
          }
        </div>

        <!-- Battery stock fund -->
        <div class="rounded-2xl border border-amber-200 bg-white p-4 dark:border-amber-900/60 dark:bg-slate-900">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="grid size-10 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"><mat-icon>account_balance</mat-icon></span>
              <div>
                <p class="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">{{ prefs.txt('ব্যাটারি স্টক ফান্ড', 'Battery stock fund') }}</p>
                <p class="font-mono text-2xl font-black text-amber-700 dark:text-amber-300">{{ fundBalance() | number:'1.2-2' }} <span class="text-xs">TK</span></p>
                <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('কেনা ব্যাটারির বাকি টাকা — এখান থেকে পার্টিকে দিলে তার বাকি স্বয়ংক্রিয়ভাবে কমবে।', 'Unpaid battery purchases — sending it to the seller settles the due automatically.') }}</p>
              </div>
            </div>
            <div class="text-right">
              <p class="text-[10px] text-slate-400">{{ prefs.txt('ফান্ড থেকে মোট পরিশোধ', 'Paid from fund') }}</p>
              <p class="font-mono text-sm font-bold text-slate-700 dark:text-slate-200">{{ fundTransferredTotal() | number:'1.2-2' }} TK</p>
              <button type="button" (click)="openFundTransfer()" [disabled]="fundBalance() <= 0"
                class="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">
                <mat-icon class="text-sm">swap_horiz</mat-icon> {{ prefs.txt('ফান্ড ট্রান্সফার', 'Transfer fund') }}
              </button>
            </div>
          </div>
        </div>

        @if (fundTransfers().length) {
          <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <h2 class="flex items-center gap-1.5 text-sm font-extrabold text-slate-700 dark:text-slate-200">
                <mat-icon class="text-base text-amber-500">receipt_long</mat-icon>
                {{ prefs.txt('ফান্ড ট্রান্সফার হিসাব', 'Fund transfer history') }}
                <span class="rounded-full bg-amber-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">{{ fundTransfers().length }}</span>
              </h2>
              <p class="text-[10px] text-slate-400">{{ prefs.txt('প্রতিটি ট্রান্সফার পার্টির হিসাবে রশিদ হিসেবে বসেছে।', 'Each transfer is posted as a receipt in the party book.') }}</p>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                  <tr>
                    <th class="px-3 py-2">{{ prefs.txt('ট্রান্সফার', 'Transfer') }}</th>
                    <th class="px-3 py-2">{{ prefs.txt('পার্টি', 'Party') }}</th>
                    <th class="px-3 py-2">{{ prefs.txt('অ্যাকাউন্ট', 'Account') }}</th>
                    <th class="px-3 py-2 text-right">{{ prefs.txt('টাকা', 'Amount') }}</th>
                    <th class="px-3 py-2">{{ prefs.txt('যে ভাউচারগুলো পরিশোধ হলো', 'Vouchers settled') }}</th>
                    <th class="px-3 py-2 text-center">{{ prefs.txt('অ্যাকশন', 'Action') }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (t of fundTransfers(); track t.id) {
                    <tr class="border-b border-slate-100 dark:border-slate-800">
                      <td class="px-3 py-2">
                        <p class="font-mono font-bold text-slate-800 dark:text-slate-100">{{ t.transferNo }}</p>
                        <p class="text-[9.5px] text-slate-400">{{ dateLabel(t.date) }}</p>
                      </td>
                      <td class="px-3 py-2">{{ t.partyName }}</td>
                      <td class="px-3 py-2">
                        <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{{ t.mode }}</span>
                      </td>
                      <td class="px-3 py-2 text-right font-mono font-bold text-amber-700 dark:text-amber-300">{{ t.amount | number:'1.2-2' }}</td>
                      <td class="px-3 py-2 font-mono text-[10px] text-slate-500 dark:text-slate-400">{{ fundAllocationLabel(t) || '—' }}</td>
                      <td class="px-3 py-2 text-center">
                        <button type="button" (click)="requestFundDelete(t)" [title]="prefs.txt('ফান্ড ট্রান্সফার ফেরত নিন (Admin PIN)', 'Reverse fund transfer (Admin PIN)')"
                          class="cursor-pointer rounded-md p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300">
                          <mat-icon class="text-base">lock_open</mat-icon>
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- Filters -->
        <div class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <div class="flex flex-wrap items-center gap-2">
            <app-date-range-bar [from]="ledgerFrom()" [to]="ledgerTo()" (rangeChange)="onLedgerRange($event)" />
            <div class="ml-auto flex flex-wrap items-center gap-2">
              <div class="relative">
                <mat-icon class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">search</mat-icon>
                <input [value]="ledgerQuery()" (input)="onLedgerQuery($event)" [placeholder]="prefs.txt('ভাউচার / পার্টি / ধরন খুঁজুন', 'Search voucher / party / kind')"
                  class="w-52 rounded-full border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs focus:border-teal-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800" />
              </div>
              <button type="button" (click)="toggleLedgerSort()"
                class="flex h-8 cursor-pointer items-center gap-1 rounded-full border border-slate-200 px-3 text-[10.5px] font-bold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                <mat-icon class="text-sm">{{ ledgerSort() === 'desc' ? 'south' : 'north' }}</mat-icon>
                {{ ledgerSort() === 'desc' ? prefs.txt('নতুন আগে', 'Newest first') : prefs.txt('পুরোনো আগে', 'Oldest first') }}
              </button>
            </div>
          </div>

          @if (kindStock().length) {
            <div class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
              <span class="mr-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-400">{{ prefs.txt('ধরন', 'Kind') }}</span>
              <button type="button" (click)="ledgerKind.set('all')"
                class="flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] font-bold transition-colors"
                [class]="ledgerKind() === 'all'
                  ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'">
                <mat-icon class="text-sm">apps</mat-icon> {{ prefs.txt('সব', 'All') }}
                <span class="opacity-70">· {{ ledger().length }}</span>
              </button>
              @for (k of kindStock(); track k.key) {
                <button type="button" (click)="toggleLedgerKind(k.key)"
                  [title]="k.label + ' · ' + prefs.txt('গড় দর', 'Avg rate') + ' ' + k.avgRate.toFixed(2) + ' · ' + k.value.toFixed(2) + ' TK'"
                  class="flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] transition-colors"
                  [class]="ledgerKind() === k.key
                    ? 'border-teal-600 bg-teal-600 font-bold text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'">
                  <span class="size-1.5 rounded-full" [class]="ledgerKind() === k.key ? 'bg-white' : (k.qty < 0 ? 'bg-rose-500' : 'bg-teal-500')"></span>
                  <span class="max-w-36 truncate">{{ k.label }}</span>
                  <span class="font-mono font-black" [class]="k.qty < 0 && ledgerKind() !== k.key ? 'text-rose-500' : ''">{{ k.qty | qty:k.unit }}</span>
                  <span class="text-[8.5px] font-bold uppercase opacity-70">{{ k.unit === 'pcs' ? prefs.txt('পিস', 'pcs') : prefs.txt('কেজি', 'kg') }}</span>
                  <span class="text-[8.5px] opacity-60">{{ k.value | number:'1.0-0' }} TK</span>
                </button>
              }
            </div>
          }
        </div>

        <!-- Day-wise movement: kg and pcs each keep their own scale and never get merged -->
        @if (ledgerView() === 'daily') {
        @if (ledgerDays().days.length) {
          <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <h2 class="flex items-center gap-1.5 text-sm font-extrabold text-slate-700 dark:text-slate-200">
                <mat-icon class="text-base text-indigo-500 dark:text-indigo-400">event_note</mat-icon>
                {{ prefs.txt('দিনভিত্তিক ইন / আউট', 'Day-wise in / out') }}
                <span class="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ ledgerDays().days.length }} {{ prefs.txt('দিন', 'days') }}</span>
              </h2>
              <div class="flex flex-wrap items-center gap-3 text-[10px] font-bold">
                <span class="flex items-center gap-1 text-teal-600 dark:text-teal-400">
                  <span class="size-2 rounded-full bg-teal-500"></span> {{ prefs.txt('ইন', 'In') }}
                </span>
                <span class="flex items-center gap-1 text-rose-600 dark:text-rose-400">
                  <span class="size-2 rounded-full bg-rose-400"></span> {{ prefs.txt('আউট', 'Out') }}
                </span>
                <span class="text-slate-400">{{ prefs.txt('কেজি ও পিস আলাদা মাপে', 'kg and pcs scaled apart') }}</span>
              </div>
            </div>
            <div class="max-h-[64vh] divide-y divide-slate-50 overflow-auto dark:divide-slate-800/60">
              @for (day of ledgerDays().days; track day.date) {
                <button type="button" (click)="openLedgerDay(day.date)"
                  [title]="prefs.txt('এই দিনের লেনদেনগুলো বইতে দেখুন', 'Open this date in the transaction book')"
                  class="grid w-full cursor-pointer grid-cols-[88px_1fr_152px_16px] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-teal-50/60 dark:hover:bg-slate-800/50">
                  <span class="flex flex-col">
                    <span class="whitespace-nowrap font-mono text-[10.5px] font-bold text-slate-600 dark:text-slate-300">{{ dateLabel(day.date) }}</span>
                    <span class="text-[9px] font-semibold text-slate-400">{{ day.entries }} {{ prefs.txt('লেনদেন', 'entries') }}</span>
                  </span>

                  <div class="space-y-1.5">
                    @if (ledgerDays().hasKg) {
                      <div class="flex items-center gap-2">
                        <span class="w-6 shrink-0 text-[8.5px] font-black text-slate-400">{{ prefs.txt('কেজি', 'kg') }}</span>
                        <div class="min-w-0 flex-1 space-y-1">
                          <div class="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div class="h-full rounded-full bg-teal-500" [style.width.%]="day.kgInPct"></div>
                          </div>
                          <div class="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div class="h-full rounded-full bg-rose-400" [style.width.%]="day.kgOutPct"></div>
                          </div>
                        </div>
                      </div>
                    }
                    @if (ledgerDays().hasPcs) {
                      <div class="flex items-center gap-2">
                        <span class="w-6 shrink-0 text-[8.5px] font-black text-slate-400">{{ prefs.txt('পিস', 'pcs') }}</span>
                        <div class="min-w-0 flex-1 space-y-1">
                          <div class="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div class="h-full rounded-full bg-teal-500" [style.width.%]="day.pcsInPct"></div>
                          </div>
                          <div class="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div class="h-full rounded-full bg-rose-400" [style.width.%]="day.pcsOutPct"></div>
                          </div>
                        </div>
                      </div>
                    }
                  </div>

                  <div class="text-right">
                    <div class="flex flex-wrap justify-end gap-1">
                      @if (day.kgIn) {
                        <span class="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">+{{ day.kgIn | qty:'kg' }} {{ prefs.txt('কেজি', 'kg') }}</span>
                      }
                      @if (day.pcsIn) {
                        <span class="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">+{{ day.pcsIn | qty:'pcs' }} {{ prefs.txt('পিস', 'pcs') }}</span>
                      }
                      @if (day.kgOut) {
                        <span class="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-rose-600 dark:bg-rose-950/60 dark:text-rose-300">−{{ day.kgOut | qty:'kg' }} {{ prefs.txt('কেজি', 'kg') }}</span>
                      }
                      @if (day.pcsOut) {
                        <span class="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-rose-600 dark:bg-rose-950/60 dark:text-rose-300">−{{ day.pcsOut | qty:'pcs' }} {{ prefs.txt('পিস', 'pcs') }}</span>
                      }
                    </div>
                    <p class="mt-0.5 font-mono text-[9px] font-semibold text-slate-400">{{ day.amount | number:'1.2-2' }} TK</p>
                  </div>

                  <mat-icon class="text-sm text-slate-300 dark:text-slate-600">chevron_right</mat-icon>
                </button>
              }
            </div>
            <div class="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[10px] font-bold dark:border-slate-800 dark:bg-slate-800/40">
              @if (ledgerHasKg()) {
                <span class="text-teal-700 dark:text-teal-300">{{ prefs.txt('ইন', 'In') }} {{ ledgerWindowTotals().kgIn | qty:'kg' }} {{ prefs.txt('কেজি', 'kg') }}</span>
                <span class="text-rose-600 dark:text-rose-400">{{ prefs.txt('আউট', 'Out') }} {{ ledgerWindowTotals().kgOut | qty:'kg' }} {{ prefs.txt('কেজি', 'kg') }}</span>
              }
              @if (ledgerHasPcs()) {
                <span class="text-teal-700 dark:text-teal-300">{{ prefs.txt('ইন', 'In') }} {{ ledgerWindowTotals().pcsIn | qty:'pcs' }} {{ prefs.txt('পিস', 'pcs') }}</span>
                <span class="text-rose-600 dark:text-rose-400">{{ prefs.txt('আউট', 'Out') }} {{ ledgerWindowTotals().pcsOut | qty:'pcs' }} {{ prefs.txt('পিস', 'pcs') }}</span>
              }
            </div>
          </div>
        } @else {
          <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
            <span class="mx-auto grid size-12 place-items-center rounded-full bg-slate-50 text-slate-300 dark:bg-slate-800 dark:text-slate-600"><mat-icon>event_note</mat-icon></span>
            <p class="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {{ prefs.txt('এই সময়ে কোনো ইন / আউট নেই — অন্য তারিখ পরিসর বেছে নিন বা "সব সময়" চাপুন।', 'No in/out movement in this range — pick another date range or choose All time.') }}
            </p>
          </div>
        }
        }

        <!-- Dated book: one section per date, so a day's ins and outs sit together -->
        @if (ledgerView() === 'book') {
        <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
            <div>
              <h2 class="flex items-center gap-1.5 text-sm font-extrabold text-slate-700 dark:text-slate-200">
                <mat-icon class="text-base text-teal-600 dark:text-teal-400">menu_book</mat-icon>
                {{ prefs.txt('লেনদেনের বই', 'Transaction book') }}
                <span class="rounded-full bg-teal-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-teal-700 dark:bg-teal-950 dark:text-teal-300">{{ ledgerRows().length }} {{ prefs.txt('টি', 'entries') }}</span>
              </h2>
            </div>
            <div class="flex flex-wrap items-center gap-2.5 text-[9.5px] font-bold">
              <span class="flex items-center gap-1 text-teal-600 dark:text-teal-400"><span class="size-1.5 rounded-full bg-teal-500"></span> {{ prefs.txt('ইন = মজুদে জমা', 'In = stock added') }}</span>
              <span class="flex items-center gap-1 text-rose-500 dark:text-rose-400"><span class="size-1.5 rounded-full bg-rose-500"></span> {{ prefs.txt('আউট = মজুদ থেকে বের', 'Out = stock removed') }}</span>
              <span class="flex items-center gap-1 text-slate-400"><mat-icon class="text-sm">functions</mat-icon> {{ prefs.txt('ব্যালেন্স = ওই সময়ের পর মজুদ', 'Balance = stock after entry') }}</span>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full min-w-[860px] text-left text-xs">
              <thead class="bg-slate-50 text-[9.5px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
                <tr>
                  <th class="px-3 py-2">{{ prefs.txt('ধরন / ভাউচার / পার্টি', 'Kind / voucher / party') }}</th>
                  <th class="px-3 py-2 text-right">{{ prefs.txt('ইন', 'In') }}</th>
                  <th class="px-3 py-2 text-right">{{ prefs.txt('আউট', 'Out') }}</th>
                  <th class="px-3 py-2 text-right">{{ prefs.txt('দর', 'Rate') }}</th>
                  <th class="px-3 py-2 text-right">{{ prefs.txt('মূল্য', 'Amount') }}</th>
                  <th class="px-3 py-2 text-right">{{ prefs.txt('ব্যালেন্স', 'Balance') }}</th>
                  <th class="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                @if (loading()) {
                  @for (i of [1,2,3,4,5]; track i) {
                    <tr class="border-t border-slate-100 dark:border-slate-800">
                      @for (j of [1,2,3,4,5,6,7]; track j) {
                        <td class="px-3 py-3"><div class="h-2.5 animate-pulse rounded bg-slate-100 dark:bg-slate-800"></div></td>
                      }
                    </tr>
                  }
                } @else {
                  @for (group of ledgerGroupPager.paged(); track group.date) {
                    <tr class="border-y border-slate-200/80 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-800/50">
                      <td colspan="7" class="px-3 py-2">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <span class="inline-flex items-center gap-2">
                            <span class="grid size-6 place-items-center rounded-lg bg-white text-teal-600 shadow-sm dark:bg-slate-900 dark:text-teal-300"><mat-icon class="text-sm">event</mat-icon></span>
                            <span class="font-mono text-[11.5px] font-black text-slate-700 dark:text-slate-200">{{ dateLabel(group.date) }}</span>
                            <span class="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold text-slate-400 shadow-sm dark:bg-slate-900 dark:text-slate-500">{{ group.entries }} {{ prefs.txt('লেনদেন', 'entries') }}</span>
                          </span>
                          <span class="flex flex-wrap items-center gap-1.5 text-[9.5px] font-bold">
                            @if (group.kgIn) {
                              <span class="rounded-md bg-teal-50 px-1.5 py-0.5 text-teal-700 dark:bg-teal-950/70 dark:text-teal-300">{{ prefs.txt('ইন', 'In') }} {{ group.kgIn | qty:'kg' }} {{ prefs.txt('কেজি', 'kg') }}</span>
                            }
                            @if (group.kgOut) {
                              <span class="rounded-md bg-rose-50 px-1.5 py-0.5 text-rose-600 dark:bg-rose-950/70 dark:text-rose-300">{{ prefs.txt('আউট', 'Out') }} {{ group.kgOut | qty:'kg' }} {{ prefs.txt('কেজি', 'kg') }}</span>
                            }
                            @if (group.pcsIn) {
                              <span class="rounded-md bg-teal-50 px-1.5 py-0.5 text-teal-700 dark:bg-teal-950/70 dark:text-teal-300">{{ prefs.txt('ইন', 'In') }} {{ group.pcsIn | qty:'pcs' }} {{ prefs.txt('পিস', 'pcs') }}</span>
                            }
                            @if (group.pcsOut) {
                              <span class="rounded-md bg-rose-50 px-1.5 py-0.5 text-rose-600 dark:bg-rose-950/70 dark:text-rose-300">{{ prefs.txt('আউট', 'Out') }} {{ group.pcsOut | qty:'pcs' }} {{ prefs.txt('পিস', 'pcs') }}</span>
                            }
                            <span class="rounded-md bg-indigo-50 px-1.5 py-0.5 font-mono text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">{{ group.amount | number:'1.2-2' }} TK</span>
                          </span>
                        </div>
                      </td>
                    </tr>
                    @for (row of group.rows; track $index) {
                    <tr (click)="openLedgerDetail(row)" (keydown.enter)="openLedgerDetail(row)"
                      tabindex="0" role="button" [attr.aria-label]="row.voucherNo + ' — ' + row.kind"
                      class="group cursor-pointer border-b border-slate-100 transition-colors hover:bg-teal-50/50 focus:bg-teal-50/50 focus:outline-none dark:border-slate-800 dark:hover:bg-slate-800/60 dark:focus:bg-slate-800/60">
                      <td class="px-3 py-2">
                        <div class="flex items-center gap-1.5">
                          <span class="w-3.5 text-right font-mono text-[9px] text-slate-300 dark:text-slate-600">{{ $index + 1 }}</span>
                          <span class="size-1.5 shrink-0 rounded-full" [class]="row.inQty > 0 ? 'bg-teal-500' : 'bg-rose-500'"></span>
                          <span class="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-100">{{ row.voucherNo }}</span>
                          @if (row.source === 'sale-adjustment') {
                            <span class="rounded bg-sky-100 px-1 py-0.5 text-[8px] font-black uppercase text-sky-700 dark:bg-sky-950 dark:text-sky-300" [title]="prefs.txt('Add Sale বিল সমন্বয়', 'Add Sale bill adjustment')">{{ prefs.txt('সমন্বয়', 'Adjust') }}</span>
                          }
                        </div>
                        <p class="max-w-52 truncate text-[9.5px] text-slate-400" [title]="row.kind + ' · ' + row.partyName">{{ row.kind }} · {{ row.partyName }}</p>
                      </td>
                      <td class="px-3 py-2 text-right font-mono text-[10.5px] font-bold text-teal-600 dark:text-teal-400">
                        {{ row.inQty ? '+' + (row.inQty | qty:row.unit) : '—' }}
                        @if (row.inQty) { <span class="text-[8.5px] font-bold text-slate-400">{{ unitLabel(row.unit) }}</span> }
                      </td>
                      <td class="px-3 py-2 text-right font-mono text-[10.5px] font-bold text-rose-500 dark:text-rose-400">
                        {{ row.outQty ? '−' + (row.outQty | qty:row.unit) : '—' }}
                        @if (row.outQty) { <span class="text-[8.5px] font-bold text-slate-400">{{ unitLabel(row.unit) }}</span> }
                      </td>
                      <td class="px-3 py-2 text-right font-mono text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400">{{ row.rate | number:'1.2-2' }}</td>
                      <td class="px-3 py-2 text-right font-mono text-[10.5px] font-bold tabular-nums text-slate-700 dark:text-slate-200">{{ row.amount | number:'1.2-2' }}</td>
                      <td class="px-3 py-2 text-right">
                        <p class="font-mono text-[10.5px] font-black tabular-nums" [class]="row.balanceQty < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'">
                          {{ row.balanceQty | qty:row.unit }} <span class="text-[9px] font-bold text-slate-400">{{ unitLabel(row.unit) }}</span>
                        </p>
                        <p class="font-mono text-[9px] tabular-nums text-slate-400">{{ row.balanceValue | number:'1.2-2' }} TK</p>
                      </td>
                      <td class="px-2 py-2 text-right">
                        <mat-icon class="text-base text-slate-300 transition-colors group-hover:text-teal-500 dark:group-hover:text-teal-400">chevron_right</mat-icon>
                      </td>
                    </tr>
                    }
                  } @empty {
                    <tr>
                      <td colspan="7" class="px-4 py-12 text-center">
                        <div class="mx-auto flex max-w-sm flex-col items-center gap-2">
                          <span class="grid size-12 place-items-center rounded-full bg-slate-50 text-slate-300 dark:bg-slate-800 dark:text-slate-600"><mat-icon>inventory_2</mat-icon></span>
                          <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {{ ledgerQuery().trim() ? prefs.txt('এই খোঁজে কোনো লেনদেন মেলেনি।', 'No ledger entry matches this search.')
                              : (ledgerFrom() || ledgerTo()) ? prefs.txt('এই তারিখ পরিসরে কোনো লেনদেন নেই — অন্য তারিখ বেছে নিন বা "সব সময়" চাপুন।', 'No ledger entry in this date range — pick another range or choose All time.')
                              : prefs.txt('স্টক লেজার এখনো খালি — ক্রয় বা বিল সমন্বয় করলে এখানে তারিখ, দর ও পরিমাণসহ জমা হবে।', 'The stock ledger is empty — purchases or sale adjustments appear here with date, rate and quantity.') }}
                          </p>
                          @if (!ledgerQuery().trim() && !ledgerFrom() && !ledgerTo()) {
                            <a routerLink="/battery/purchase" class="mt-1 rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-teal-700">{{ prefs.txt('প্রথম ক্রয় যোগ করুন', 'Add first purchase') }}</a>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                }
              </tbody>
              @if (!loading() && ledgerKind() !== 'all' && ledgerRows().length) {
                <tfoot class="border-t-2 border-slate-200 bg-slate-50 text-[10.5px] font-bold dark:border-slate-700 dark:bg-slate-800/60">
                  <tr>
                    <td class="px-3 py-2.5 text-right text-slate-500 dark:text-slate-400">{{ prefs.txt('এই ধরনের মোট', 'Kind total') }}</td>
                    <td class="px-3 py-2.5 text-right font-mono text-teal-600 dark:text-teal-400">{{ ledgerTotals().inQty | qty:ledgerTotalsUnit() }}</td>
                    <td class="px-3 py-2.5 text-right font-mono text-rose-500 dark:text-rose-400">{{ ledgerTotals().outQty | qty:ledgerTotalsUnit() }}</td>
                    <td class="px-3 py-2.5"></td>
                    <td class="px-3 py-2.5 text-right font-mono tabular-nums">{{ ledgerTotals().amount | number:'1.2-2' }}</td>
                    <td class="px-3 py-2.5 text-right font-mono">{{ ledgerTotals().balanceQty | qty:ledgerTotalsUnit() }}</td>
                    <td></td>
                  </tr>
                </tfoot>
              }
            </table>
          </div>
          <app-table-pagination
            [total]="ledgerGroupPager.total()"
            [page]="ledgerGroupPager.currentPage()"
            [pageSize]="ledgerGroupPager.pageSize()"
            (pageChange)="ledgerGroupPager.setPage($event)"
            (pageSizeChange)="ledgerGroupPager.setPageSize($event)"
          />
        </div>
        }
      </div>
      }

      @if (view() === 'vouchers') {
      <!-- Voucher list -->
      <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <mat-icon class="text-indigo-600 dark:text-indigo-400 text-base">receipt_long</mat-icon>
              {{ voucherListTitle() }}
              <span class="ml-1 rounded-full bg-indigo-100 dark:bg-indigo-950 px-2 py-0.5 text-[10px] font-black text-indigo-700 dark:text-indigo-300">{{ historyInRange().length }} / {{ history().length }}</span>
            </h2>
            <p class="text-[10px] text-slate-400">{{ prefs.txt('ভাউচার নং বা পার্টির নাম দিয়ে খুঁজুন; চোখ আইকনে ভাউচার দেখুন, পেন্সিলে এডিট / কাস্টমাইজ করুন, ডিলিটে অ্যাকাউন্ট ও স্টক ফেরত যাবে।', 'Search by voucher or party; view the voucher, edit / customize it with the pencil, and deleting it reverses accounts and stock.') }}</p>
          </div>
          <div class="relative">
            <mat-icon class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">search</mat-icon>
            <input [value]="voucherQuery()" (input)="onVoucherQuery($event)" [placeholder]="prefs.txt('ভাউচার / পার্টি খুঁজুন', 'Search voucher / party')"
              class="w-56 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pl-8 pr-2 py-1.5 text-xs" />
          </div>
        </div>
        <div class="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <app-date-range-bar [from]="historyFrom()" [to]="historyTo()" (rangeChange)="onHistoryRange($event)" />
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs text-left">
            <thead class="bg-slate-50 dark:bg-slate-800 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-3 py-2">{{ prefs.txt('ভাউচার', 'Voucher') }}</th>
                <th class="px-3 py-2">{{ prefs.txt('তারিখ', 'Date') }}</th>
                <th class="px-3 py-2">{{ prefs.txt('লট / সূত্র', 'Lot / ref') }}</th>
                <th class="px-3 py-2">{{ prefs.txt('পার্টি', 'Party') }}</th>
                <th class="px-3 py-2 text-right">{{ prefs.txt('কেজি / পিস', 'Kg / pcs') }}</th>
                <th class="px-3 py-2 text-right">{{ prefs.txt('মোট', 'Total') }}</th>
                <th class="px-3 py-2 text-right">{{ prefs.txt('পরিশোধ', 'Paid') }}</th>
                <th class="px-3 py-2 text-right">{{ prefs.txt('বাকি', 'Due') }}</th>
                <th class="px-3 py-2 text-right">{{ prefs.txt('লাভ', 'Profit') }}</th>
                <th class="px-3 py-2 text-center">{{ prefs.txt('অ্যাকশন', 'Actions') }}</th>
              </tr>
            </thead>
            <tbody>
              @for (v of historyPager.paged(); track v.id) {
                <tr class="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td class="px-3 py-2 font-mono font-bold">
                    {{ v.voucherNo }}
                    @if (v.source === 'sale-adjustment') {
                      <span class="block mt-0.5 inline-flex w-fit items-center gap-0.5 rounded bg-sky-100 px-1 py-0.5 text-[8.5px] font-black text-sky-700 dark:bg-sky-950 dark:text-sky-300" [title]="prefs.txt('Add Sale বিল সমন্বয় থেকে এসেছে', 'Created from an Add Sale bill adjustment')">
                        <mat-icon style="font-size:9px;width:9px;height:9px;">sell</mat-icon> {{ prefs.txt('বিক্রয় সমন্বয়', 'Sale adjustment') }}
                      </span>
                      <span class="block text-[9px] font-normal text-slate-400">{{ v.saleInvoice }}</span>
                    }
                  </td>
                  <td class="px-3 py-2">{{ dateLabel(v.date) }}</td>
                  <td class="px-3 py-2 font-mono text-[10px] max-w-32 truncate" [title]="v.lot">{{ v.lot || '—' }}</td>
                  <td class="px-3 py-2">{{ v.partyName }}</td>
                  <td class="px-3 py-2 text-right font-semibold">
                    @if (v.type === 'exchange') {
                      <span class="text-teal-700 dark:text-teal-300">+{{ (v.receivedKg || 0) | qty:'kg' }}</span>
                      <span class="text-slate-400"> / </span>
                      <span class="text-amber-600 dark:text-amber-400">−{{ (v.givenKg || 0) | qty:'kg' }}</span>
                    } @else {
                      {{ v.totalKg | qty:qtyUnitFor(v.lines) }}
                    }
                  </td>
                  <td class="px-3 py-2 text-right font-bold">{{ v.total.toFixed(2) }}</td>
                  <td class="px-3 py-2 text-right">{{ v.paid.toFixed(2) }}
                    @if (fundAllocated(v) > 0) {
                      <span class="block text-[9px] font-bold text-amber-600 dark:text-amber-400" [title]="prefs.txt('ব্যাটারি ফান্ড থেকে পরিশোধ', 'Paid from battery fund')">+{{ fundAllocated(v) | number:'1.2-2' }} {{ prefs.txt('ফান্ড', 'fund') }}</span>
                    }
                  </td>
                  <td class="px-3 py-2 text-right" [class.text-rose-600]="fundDueLeft(v) > 0">{{ fundDueLeft(v).toFixed(2) }}</td>
                  <td class="px-3 py-2 text-right font-bold">
                    @if (v.type === 'sale' && costIncomplete(v)) {
                      <span class="text-[9px] font-black text-amber-600 dark:text-amber-400" [title]="prefs.txt('এই বিক্রয়ের স্টকের ক্রয়খরচ পাওয়া যায়নি', 'No purchase cost found for the stock behind this sale')">{{ prefs.txt('ক্রয়খরচ অসম্পূর্ণ', 'Cost incomplete') }}</span>
                    } @else {
                      <span [class.text-teal-600]="profitOf(v) >= 0" [class.text-rose-600]="profitOf(v) < 0">{{ profitOf(v).toFixed(2) }}</span>
                    }
                  </td>
                  <td class="px-3 py-2">
                    <div class="flex justify-center gap-1">
                      <button (click)="viewVoucher(v)" class="p-1 text-slate-500 hover:text-teal-600 cursor-pointer" [title]="prefs.txt('ভাউচার দেখুন', 'View voucher')"><mat-icon class="text-base">visibility</mat-icon></button>
                      @if (v.source !== 'sale-adjustment') {
                        <button (click)="editVoucher(v)" class="p-1 text-slate-500 hover:text-amber-600 cursor-pointer" [title]="prefs.txt('ভাউচার এডিট / কাস্টমাইজ', 'Edit / customize voucher')"><mat-icon class="text-base">edit_note</mat-icon></button>
                      }
                      <button (click)="remove(v)" class="p-1 text-slate-500 hover:text-rose-600 cursor-pointer" [title]="prefs.txt('মুছুন', 'Delete')"><mat-icon class="text-base">delete</mat-icon></button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="10" class="px-3 py-8 text-center text-slate-400">{{ voucherQuery().trim() ? prefs.txt('এই খোঁজে কোনো ভাউচার মেলেনি।', 'No voucher matches this search.') : (historyFrom() || historyTo()) ? prefs.txt('এই তারিখ পরিসরে কোনো ভাউচার নেই — অন্য তারিখ বেছে নিন বা "সব সময়" চাপুন।', 'No voucher in this date range — pick another range or choose All time.') : prefs.txt('এখনো কোনো ভাউচার নেই।', 'No vouchers yet.') }}</td></tr>
              }
            </tbody>
            @if (historyRows().length) {
              <tfoot class="bg-slate-50 dark:bg-slate-800/60 font-extrabold text-slate-700 dark:text-slate-200">
                <tr>
                  <td class="px-3 py-2" colspan="5">{{ prefs.txt('সর্বমোট', 'Total') }} ({{ historyRows().length }})</td>
                  <td class="px-3 py-2 text-right">{{ historyTotals().total | number:'1.2-2' }}</td>
                  <td class="px-3 py-2 text-right">{{ historyTotals().paid | number:'1.2-2' }}</td>
                  <td class="px-3 py-2 text-right" [class.text-rose-600]="historyTotals().due > 0">{{ historyTotals().due | number:'1.2-2' }}</td>
                  <td class="px-3 py-2 text-right">
                    <span [class.text-teal-600]="historyTotals().profit >= 0" [class.text-rose-600]="historyTotals().profit < 0">{{ historyTotals().profit | number:'1.2-2' }}</span>
                    @if (historyTotals().incomplete) {
                      <span class="block text-[9px] font-normal text-amber-600 dark:text-amber-400">+{{ historyTotals().incomplete }} {{ prefs.txt('ক্রয়খরচ অসম্পূর্ণ', 'cost incomplete') }}</span>
                    }
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            }
          </table>
        </div>
        <app-table-pagination
          [total]="historyPager.total()"
          [page]="historyPager.currentPage()"
          [pageSize]="historyPager.pageSize()"
          (pageChange)="historyPager.setPage($event)"
          (pageSizeChange)="historyPager.setPageSize($event)"
        />
      </div>
      }
    </div>

    @if (showCustomerModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4" (click)="closeCustomerModal()">
        <div class="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl max-h-[92dvh] overflow-y-auto overscroll-contain" (click)="$event.stopPropagation()">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <h3 class="text-sm font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
              <mat-icon class="text-teal-600 text-base">person_add</mat-icon>
              {{ prefs.txt('নতুন কাস্টমার', 'New customer') }}
            </h3>
            <button type="button" (click)="closeCustomerModal()" class="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"><mat-icon class="text-base">close</mat-icon></button>
          </div>
          <div class="p-4 space-y-3">
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {{ prefs.txt('নাম', 'Name') }} *
              <input [(ngModel)]="newCustomerName" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {{ prefs.txt('ফোন', 'Phone') }}
                <input [(ngModel)]="newCustomerPhone" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
              </label>
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {{ prefs.txt('ধরন', 'Type') }}
                <select [(ngModel)]="newCustomerType" class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-2 text-sm">
                  <option value="Customer">{{ prefs.txt('কাস্টমার', 'Customer') }}</option>
                  <option value="Supplier">{{ prefs.txt('সাপ্লায়ার', 'Supplier') }}</option>
                  <option value="Dealer">{{ prefs.txt('ডিলার', 'Dealer') }}</option>
                </select>
              </label>
            </div>
            <app-geo-select
              [(division)]="newCustomerDivision"
              [(district)]="newCustomerDistrict"
              [(upazila)]="newCustomerUpazila">
            </app-geo-select>
            <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {{ prefs.txt('ঠিকানা', 'Address') }}
              <textarea [(ngModel)]="newCustomerAddress" rows="2" [placeholder]="prefs.txt('বাসা/রোড, এলাকা, উপজেলা, জেলা...', 'House/road, area, upazila, district...')"
                class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm resize-none"></textarea>
            </label>
            <div class="grid grid-cols-2 gap-3">
              <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {{ prefs.txt('প্রোফাইল ছবি', 'Profile photo') }}
                <label class="mt-1 flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 py-2 text-[11px] text-slate-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                  <mat-icon class="text-sm">photo_camera</mat-icon> {{ newCustomerPhoto() ? prefs.txt('পরিবর্তন', 'Change') : prefs.txt('ছবি যোগ', 'Add photo') }}
                  <input type="file" accept="image/*" (change)="onCustomerPhoto($event)" class="hidden" />
                </label>
                @if (newCustomerPhoto()) {
                  <img [src]="newCustomerPhoto()" alt="photo" class="mt-1 w-10 h-10 rounded-full object-cover border"  loading="lazy" decoding="async" />
                }
              </div>
              <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {{ prefs.txt('ভোটার ডকুমেন্ট', 'Voter document') }}
                <label class="mt-1 flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 py-2 text-[11px] text-slate-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                  <mat-icon class="text-sm">badge</mat-icon> {{ newCustomerDoc() ? prefs.txt('পরিবর্তন', 'Change') : prefs.txt('ডক যোগ', 'Add doc') }}
                  <input type="file" accept="image/*" (change)="onCustomerDoc($event)" class="hidden" />
                </label>
                @if (newCustomerDoc()) {
                  <img [src]="newCustomerDoc()" alt="document" class="mt-1 h-10 w-16 rounded object-cover border"  loading="lazy" decoding="async" />
                }
              </div>
            </div>
            <p class="text-[10px] text-slate-400">{{ prefs.txt('ছবি ও ডকুমেন্ট ঐচ্ছিক।', 'Photo and document are optional.') }}</p>
          </div>
          <div class="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-700">
            <button type="button" (click)="closeCustomerModal()" class="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold cursor-pointer">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
            <button type="button" (click)="saveCustomer()" [disabled]="savingCustomer()" class="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold cursor-pointer disabled:opacity-60">{{ prefs.txt('যোগ করুন', 'Add') }}</button>
          </div>
        </div>
      </div>
    }

    @if (ledgerDetail(); as detail) {
      <div class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm" (click)="closeLedgerDetail()">
        <div class="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" (click)="$event.stopPropagation()">
          <div class="flex items-start justify-between gap-3 bg-gradient-to-r from-indigo-600 to-teal-600 px-4 py-3 text-white">
            <div class="min-w-0">
              <p class="text-[10px] font-bold uppercase tracking-wide text-indigo-100">{{ prefs.txt('স্টক লেজার · বিস্তারিত', 'Stock ledger · details') }}</p>
              <h3 class="truncate font-mono text-base font-black">{{ detail.row.voucherNo }}</h3>
              <p class="text-[10px] text-indigo-100">{{ sourceLabel(detail.row.source) }} · {{ dateLabel(detail.row.date) }}</p>
            </div>
            <button type="button" (click)="closeLedgerDetail()" class="cursor-pointer rounded-lg p-1 text-indigo-100 hover:bg-white/15 hover:text-white">
              <mat-icon class="text-base">close</mat-icon>
            </button>
          </div>

          <div class="max-h-[70dvh] space-y-3 overflow-y-auto p-4">
            <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <div>
                <p class="text-[10px] font-bold uppercase tracking-wide" [class]="detail.row.inQty > 0 ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400'">
                  {{ detail.row.inQty > 0 ? prefs.txt('স্টক জমা', 'Stock in') : prefs.txt('স্টক বের', 'Stock out') }}
                </p>
                <p class="mt-0.5 text-xl font-black" [class]="detail.row.inQty > 0 ? 'text-teal-700 dark:text-teal-300' : 'text-rose-600 dark:text-rose-400'">
                  {{ (detail.row.inQty || detail.row.outQty) | qty:detail.row.unit }} {{ unitLabel(detail.row.unit) }}
                </p>
                <p class="text-[10px] text-slate-400">{{ detail.row.kind }} · {{ prefs.txt('দর', 'Rate') }} {{ detail.row.rate | number:'1.2-2' }} / {{ unitLabel(detail.row.unit) }}</p>
              </div>
              <div class="text-right">
                <p class="text-[10px] text-slate-400">{{ prefs.txt('মূল্য', 'Amount') }}</p>
                <p class="text-lg font-black text-slate-800 dark:text-slate-100">{{ detail.row.amount | number:'1.2-2' }} TK</p>
                <p class="mt-1 text-[10px] text-slate-400">{{ prefs.txt('রানিং ব্যালেন্স', 'Running balance') }}</p>
                <p class="font-mono text-xs font-bold text-slate-700 dark:text-slate-200">{{ detail.row.balanceQty | qty:detail.row.unit }} {{ unitLabel(detail.row.unit) }} · {{ detail.row.balanceValue | number:'1.2-2' }} TK</p>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-1.5 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60 sm:grid-cols-2">
              <div class="flex items-center justify-between gap-2 sm:col-span-2">
                <span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('পার্টি', 'Party') }}</span>
                <strong class="truncate text-slate-800 dark:text-slate-100">{{ detail.row.partyName }}</strong>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('সূত্র', 'Source') }}</span>
                <strong class="text-slate-800 dark:text-slate-100">{{ sourceLabel(detail.row.source) }}</strong>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('ধরন', 'Kind') }}</span>
                <strong class="text-slate-800 dark:text-slate-100">{{ detail.row.kind }}</strong>
              </div>
              @if (detail.voucher; as v) {
                <div class="flex items-center justify-between gap-2 sm:col-span-2">
                  <span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('লট / রেফারেন্স', 'Lot / reference') }}</span>
                  <strong class="font-mono text-slate-800 dark:text-slate-100">{{ v.lot || '—' }}</strong>
                </div>
                @if (v.saleInvoice) {
                  <div class="flex items-center justify-between gap-2 sm:col-span-2">
                    <span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('সংযুক্ত বিক্রয় বিল', 'Linked sale invoice') }}</span>
                    <strong class="font-mono text-sky-700 dark:text-sky-300">{{ v.saleInvoice }}</strong>
                  </div>
                }
                <div class="flex items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('প্রস্তুতকারী', 'Prepared by') }}</span>
                  <strong class="text-slate-800 dark:text-slate-100">{{ v.preparedBy || '—' }}</strong>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('এন্ট্রি সময়', 'Entered at') }}</span>
                  <strong class="text-slate-800 dark:text-slate-100">{{ v.createdAt | date:'dd/MM/yyyy, h:mm a' }}</strong>
                </div>
                @if (v.notes) {
                  <div class="flex items-start justify-between gap-2 sm:col-span-2">
                    <span class="shrink-0 text-slate-500 dark:text-slate-400">{{ prefs.txt('নোট', 'Notes') }}</span>
                    <strong class="text-right font-medium text-slate-800 dark:text-slate-100">{{ v.notes }}</strong>
                  </div>
                }
              }
            </div>

            @if (detail.voucher; as v) {
              <div class="space-y-1.5 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
                <p class="text-[10px] font-black uppercase tracking-wide text-slate-400">{{ prefs.txt('পেমেন্ট ও হিসাব', 'Payment & accounts') }}</p>
                <div class="grid grid-cols-3 gap-2">
                  <div class="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <p class="text-[9px] text-slate-400">{{ prefs.txt('মোট', 'Total') }}</p>
                    <p class="font-bold text-slate-800 dark:text-slate-100">{{ v.total | number:'1.2-2' }}</p>
                  </div>
                  <div class="rounded-lg bg-teal-50 p-2 dark:bg-teal-950/40">
                    <p class="text-[9px] text-teal-600 dark:text-teal-400">{{ prefs.txt('পরিশোধ', 'Paid') }}</p>
                    <p class="font-bold text-teal-700 dark:text-teal-300">{{ fundPaidTotal(v) | number:'1.2-2' }}</p>
                    @if (fundAllocated(v) > 0) {
                      <p class="text-[8.5px] font-bold text-amber-600 dark:text-amber-400">{{ prefs.txt('এর মধ্যে ফান্ড', 'fund') }} {{ fundAllocated(v) | number:'1.2-2' }}</p>
                    }
                  </div>
                  <div class="rounded-lg bg-rose-50 p-2 dark:bg-rose-950/40">
                    <p class="text-[9px] text-rose-500 dark:text-rose-400">{{ prefs.txt('বাকি', 'Due') }}</p>
                    <p class="font-bold text-rose-600 dark:text-rose-300">{{ fundDueLeft(v) | number:'1.2-2' }}</p>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                  <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('নগদ', 'Cash') }}</span><strong>{{ v.cash | number:'1.2-2' }}</strong></div>
                  <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('ব্যাংক', 'Bank') }}</span><strong>{{ v.bank | number:'1.2-2' }}</strong></div>
                  <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">{{ v.mobileType || prefs.txt('মোবাইল', 'Mobile') }}</span><strong>{{ v.mobile | number:'1.2-2' }}</strong></div>
                  <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('রেফারেন্স', 'Reference') }}</span><strong class="truncate font-mono">{{ v.ref || '—' }}</strong></div>
                </div>
                @if (v.type === 'sale' || v.type === 'exchange') {
                  <div class="flex justify-between border-t border-slate-100 pt-1.5 text-[11px] dark:border-slate-800">
                    <span class="text-slate-500 dark:text-slate-400">{{ v.type === 'sale' ? prefs.txt('বিক্রয় লাভ', 'Sale profit') : prefs.txt('বদলি আয়', 'Exchange income') }}</span>
                    @if (v.type === 'sale' && costIncomplete(v)) {
                      <strong class="text-amber-600 dark:text-amber-400">{{ prefs.txt('ক্রয়খরচ অসম্পূর্ণ', 'Cost incomplete') }}</strong>
                    } @else {
                      <strong [class]="profitOf(v) < 0 ? 'text-rose-600' : 'text-emerald-600'">{{ profitOf(v) | number:'1.2-2' }} TK</strong>
                    }
                  </div>
                }
                @if (v.type === 'exchange') {
                  <div class="grid grid-cols-2 gap-1.5 border-t border-slate-100 pt-1.5 text-[11px] dark:border-slate-800">
                    <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('প্রাপ্ত', 'Received') }}</span><strong class="font-mono">{{ v.receivedId }} · {{ v.receivedKg | qty:'kg' }} kg</strong></div>
                    <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">{{ prefs.txt('দেওয়া', 'Given') }}</span><strong class="font-mono">{{ v.givenId }} · {{ v.givenKg | qty:'kg' }} kg</strong></div>
                  </div>
                }
              </div>
            }
          </div>

          <div class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
            @if (detail.voucher) {
              <button type="button" (click)="requestLedgerAction('edit')" class="flex cursor-pointer items-center gap-1 rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40">
                <mat-icon class="text-sm">lock</mat-icon> {{ prefs.txt('এডিট', 'Edit') }}
              </button>
              <button type="button" (click)="requestLedgerAction('delete')" class="flex cursor-pointer items-center gap-1 rounded-lg border border-rose-300 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
                <mat-icon class="text-sm">lock</mat-icon> {{ prefs.txt('ডিলিট', 'Delete') }}
              </button>
              <button type="button" (click)="openVoucherFromDetail()" class="flex cursor-pointer items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700">
                <mat-icon class="text-sm">receipt_long</mat-icon> {{ prefs.txt('সম্পূর্ণ ভাউচার', 'Full voucher') }}
              </button>
            }
            <button type="button" (click)="closeLedgerDetail()" class="cursor-pointer rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
              {{ prefs.txt('বন্ধ', 'Close') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (showFundTransfer()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm" (click)="closeFundTransfer()">
        <div class="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" (click)="$event.stopPropagation()">
          <div class="flex items-start justify-between gap-3 bg-gradient-to-r from-amber-600 to-orange-600 px-4 py-3 text-white">
            <div>
              <p class="text-[10px] font-bold uppercase tracking-wide text-amber-100">{{ prefs.txt('ব্যাটারি স্টক থেকে পরিশোধ', 'Pay from battery stock') }}</p>
              <h3 class="text-base font-black">{{ prefs.txt('ফান্ড ট্রান্সফার', 'Fund transfer') }}</h3>
            </div>
            <button type="button" (click)="closeFundTransfer()" class="cursor-pointer rounded-lg p-1 text-amber-100 hover:bg-white/15 hover:text-white">
              <mat-icon class="text-base">close</mat-icon>
            </button>
          </div>

          <div class="max-h-[70dvh] space-y-3 overflow-y-auto p-4">
            @if (fundParties().length) {
              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {{ prefs.txt('পার্টি', 'Party') }} *
                <select [ngModel]="fundPartyId" (ngModelChange)="fundPartyId = $event; onFundPartyChange()"
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
                  @for (row of fundParties(); track row.party.id) {
                    <option [ngValue]="row.party.id">{{ row.party.name }} — {{ row.available | number:'1.2-2' }} TK</option>
                  }
                </select>
                <span class="mt-1 block text-[10px] text-slate-400">{{ prefs.txt('এই পার্টির ব্যাটারি বাকি', 'Battery due for this party') }}: <strong class="text-amber-600 dark:text-amber-400">{{ fundPartyAvailable() | number:'1.2-2' }} TK</strong></span>
              </label>

              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {{ prefs.txt('টাকার পরিমাণ', 'Amount') }} *
                <div class="mt-1 flex gap-1">
                  <input type="number" min="0" [attr.max]="fundPartyAvailable()" step="0.01" [ngModel]="fundAmount" (ngModelChange)="fundAmount = +$event"
                    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
                  <button type="button" (click)="fillFundAmount()" class="shrink-0 rounded-lg bg-slate-100 px-2 text-[11px] font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer">{{ prefs.txt('সব', 'All') }}</button>
                </div>
              </label>

              <div class="grid grid-cols-2 gap-2">
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {{ prefs.txt('তারিখ', 'Date') }}
                  <input type="date" appDmyDate [(ngModel)]="fundDate" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
                </label>
                <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {{ prefs.txt('কোথা থেকে', 'Paid from') }}
                  <select [ngModel]="fundMode" (ngModelChange)="fundMode = $event" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
                    @for (mode of ledgerModes; track mode) { <option [ngValue]="mode">{{ mode }}</option> }
                  </select>
                </label>
              </div>

              <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {{ prefs.txt('নোট (ঐচ্ছিক)', 'Note (optional)') }}
                <textarea [(ngModel)]="fundNote" rows="2" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"></textarea>
              </label>

              <p class="rounded-lg bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {{ prefs.txt('ট্রান্সফার করলে নির্বাচিত ওয়ালেট অ্যাকাউন্ট থেকে টাকা কমবে, পার্টির ক্রয় বাকি কমবে এবং বাকি থাকলে অগ্রিম হবে। পুরোনো ভাউচার আগে মেটানো হবে।', 'The chosen wallet account goes down, the party purchase due is settled and any excess becomes advance. Oldest vouchers are cleared first.') }}
              </p>
            } @else {
              <div class="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                {{ prefs.txt('ফান্ডে টাকা আছে, কিন্তু কোন পার্টির সাথে ব্যাটারি বাকি মেলেনি। ক্রয় ভাউচারে পার্টি বাছাই করা আছে কি না দেখুন।', 'The fund has money, but no party with an unpaid battery purchase was found. Check that the purchase vouchers have a party selected.') }}
              </div>
            }

            @if (fundError()) {
              <p class="rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{{ fundError() }}</p>
            }
          </div>

          <div class="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
            <button type="button" (click)="closeFundTransfer()" class="cursor-pointer rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
            <button type="button" (click)="saveFundTransfer()" [disabled]="fundSaving() || !fundParties().length"
              class="cursor-pointer rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60">
              {{ prefs.txt('ট্রান্সফার করুন', 'Transfer') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (fundDeleteRequest(); as req) {
      <app-passcode-modal
        [title]="prefs.txt('ফান্ড ট্রান্সফার ফেরত', 'Reverse fund transfer')"
        [message]="prefs.txt(
          req.transferNo + ' ফেরত নিতে Admin PIN দিন। পার্টির পরিশোধ ও ওয়ালেটের টাকা দুটোই আগের অবস্থায় ফিরবে।',
          'Enter the Admin PIN to reverse ' + req.transferNo + '. The party settlement and wallet movement will both be undone.')"
        (verified)="onFundDeletePin()"
        (close)="fundDeleteRequest.set(null)" />
    }

    @if (ledgerAccess(); as req) {
      <app-passcode-modal
        [title]="req.action === 'edit' ? prefs.txt('ভাউচার এডিট / কাস্টমাইজ', 'Edit / customize voucher') : prefs.txt('ভাউচার ডিলিট', 'Delete voucher')"
        [message]="prefs.txt(
          req.action === 'edit'
            ? req.voucher.voucherNo + ' এডিট করতে Admin PIN দিন। তারিখ, পার্টি, লাইন ও পেমেন্ট বদলালে স্টক ও হিসাব নিজে থেকে আপডেট হবে।'
            : req.voucher.voucherNo + ' মুছে ফেলতে Admin PIN দিন। স্টক ও অ্যাকাউন্ট পোস্টিং ফেরত নেওয়া হবে।',
          req.action === 'edit'
            ? 'Enter the Admin PIN to edit ' + req.voucher.voucherNo + '. Stock and accounts will be updated.'
            : 'Enter the Admin PIN to delete ' + req.voucher.voucherNo + '. Stock and account postings will be reversed.')"
        (verified)="onLedgerPasscode()"
        (close)="ledgerAccess.set(null)" />
    }

    @if (voucher(); as saved) {
      <app-battery-voucher [voucher]="saved" [canEdit]="saved.source !== 'sale-adjustment'" (edit)="editViewedVoucher()" (close)="closeVoucher()" />
    }
  `
})
export class BatteryVouchers {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dataService = inject(DataService);
  private notify = inject(NotificationService);
  private session = inject(SessionService);
  private media = inject(MediaService);
  prefs = inject(PreferencesService);

  readonly type = signal<BatteryVoucherType>((this.route.snapshot.data['batteryType'] as BatteryVoucherType) || 'purchase');
  readonly view = signal<'entry' | 'vouchers' | 'ledger'>((this.route.snapshot.data['batteryView'] as 'entry' | 'vouchers' | 'ledger') || 'entry');

  partyName = '';
  partyId: number | null = null;
  date = localDateIso();
  readonly dateLabel = (iso: string) => dmyFromIso(iso) || iso;
  lot = '';
  ref = '';
  notes = '';
  receivedId = '';
  givenId = '';
  receivedCondition: 'scrap' | 'usable' = 'scrap';
  mobileType: 'bKash' | 'Nagad' = 'bKash';

  // Party picker
  partyQuery = signal('');
  partyOpen = signal(false);
  ledgerQuery = signal('');
  ledgerSort = signal<'desc' | 'asc'>('desc');
  ledgerKind = signal<string>('all');
  /** The stock ledger is read as two separate books: day-wise movement, or the dated entries. */
  ledgerView = persistedSignal<'daily' | 'book'>('sm_battery_ledger_view_v1', 'daily', value => value === 'book' ? 'book' : 'daily');
  /** Ledger opens on today; the voucher lists keep the current month. */
  private readonly monthRange = resolveDateRange('month');
  private readonly todayRange = resolveDateRange('today');
  ledgerFrom = signal(this.todayRange.from);
  ledgerTo = signal(this.todayRange.to);
  historyFrom = signal(this.monthRange.from);
  historyTo = signal(this.monthRange.to);
  ledgerDetail = signal<{ row: BatteryStockRow; voucher: BatteryVoucher | null } | null>(null);
  /** Passkey-gated ledger actions; the modal unlocks edit or delete. */
  ledgerAccess = signal<{ action: 'edit' | 'delete'; voucher: BatteryVoucher } | null>(null);
  editingVoucher = signal<BatteryVoucher | null>(null);
  voucherQuery = signal('');

  // Battery stock fund: unpaid purchases can be sent to the seller's ledger.
  showFundTransfer = signal(false);
  fundPartyId: number | null = null;
  fundAmount: number | null = null;
  fundDate = localDateIso();
  fundMode: LedgerPayment['mode'] = 'Cash';
  fundNote = '';
  fundError = signal('');
  fundSaving = signal(false);
  fundDeleteRequest = signal<BatteryFundTransfer | null>(null);
  readonly ledgerModes = LEDGER_MODES;
  readonly fundBalance = computed(() => this.dataService.batteryFundAvailable());
  readonly fundAllocations = computed(() => this.dataService.batteryFundAllocationsByVoucher());
  readonly fundByParty = computed(() => this.dataService.batteryFundByParty());
  readonly fundTransfers = computed(() => [...this.dataService.batteryFundTransfers()]
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id));
  readonly fundTransferredTotal = computed(() =>
    Math.round(this.fundTransfers().reduce((sum, t) => sum + (Number(t.amount) || 0), 0) * 100) / 100);
  readonly fundParties = computed(() => {
    const available = this.fundByParty();
    return this.dataService.parties()
      .map(party => ({ party, available: available.get(party.id) || 0 }))
      .filter(row => row.available > 0)
      .sort((a, b) => a.party.name.localeCompare(b.party.name));
  });

  // Custom customer modal
  showCustomerModal = signal(false);
  newCustomerName = '';
  newCustomerPhone = '';
  newCustomerType: Party['type'] = 'Customer';
  newCustomerPhoto = signal('');
  newCustomerDoc = signal('');
  newCustomerDivision = '';
  newCustomerDistrict = '';
  newCustomerUpazila = '';
  newCustomerAddress = '';
  savingCustomer = signal(false);

  lines = signal<BatteryLine[]>([]);
  receivedKg = signal(0);
  givenKg = signal(0);
  fee = signal(0);
  cost = signal(0);
  /** Once the operator types a lot cost, the field stops tracking the stock average. */
  readonly costManual = signal(false);
  /** Sold lines valued at the lots those kilograms came from. */
  readonly autoCost = computed(() => this.type() === 'sale' ? this.dataService.batteryLinesCost(this.lines()) : 0);
  /** True when some sold kilograms have no purchase lot behind them. */
  readonly autoIncomplete = computed(() => this.type() === 'sale' && this.dataService.batteryLinesCostIncomplete(this.lines()));
  /** What the field and the profit row use: a typed cost, else the lot cost (0 while incomplete). */
  readonly displayCost = computed(() => {
    if (this.type() !== 'sale') return 0;
    const typed = Number(this.cost()) || 0;
    if (this.costManual() && typed > 0) return typed;
    return this.autoIncomplete() ? 0 : this.autoCost();
  });
  cash = signal(0);
  bank = signal(0);
  mobile = signal(0);

  voucher = signal<BatteryVoucher | null>(null);

  readonly kindCatalog = computed<BatteryKind[]>(() => {
    // Good batteries collected through exchanges keep their own book; they can be
    // sold like any kind, so the sale picker offers them once stock exists.
    const usesExchange = this.exchangeBookQty() > 0 || this.lines().some(line => (line.kindKey || '') === 'exchange');
    return this.type() === 'sale' && usesExchange ? [...BATTERY_KINDS, EXCHANGE_KIND] : BATTERY_KINDS;
  });
  kindLabel(kind: BatteryKind): string {
    return this.prefs.language() === 'en' ? kind.en : kind.bn;
  }
  unitLabel(unit: BatteryUnit | undefined): string {
    return (unit || 'kg') === 'pcs' ? this.prefs.txt('পিস', 'Pcs') : this.prefs.txt('কেজি', 'Kg');
  }

  /** A voucher reads in pcs only when every line is pcs; anything mixed falls back to kg. */
  qtyUnitFor(lines: { unit?: string }[] | undefined): BatteryUnit {
    return (lines?.length ?? 0) > 0 && (lines || []).every(line => line.unit === 'pcs') ? 'pcs' : 'kg';
  }

  /** Totals footer only shows for one kind, so its unit decides the decimals. */
  ledgerTotalsUnit(): BatteryUnit {
    const kind = this.ledgerKind();
    return kind === 'all' ? 'kg' : ((this.kindStockMap().get(kind)?.unit === 'pcs') ? 'pcs' : 'kg');
  }

  kindStockQty(kindKey: string | undefined): number {
    const entry = kindKey ? this.kindStockMap().get(kindKey) : undefined;
    return Math.max(0, entry?.qty ?? 0);
  }

  /** Quantity the voucher under edit already took out, keyed by kind. */
  private readonly editingSaleQty = computed<Map<string, number>>(() => {
    const map = new Map<string, number>();
    const voucher = this.editingVoucher();
    if (!voucher || voucher.type !== 'sale') return map;
    for (const line of voucher.lines ?? []) {
      const key = line.kindKey || '';
      map.set(key, (map.get(key) || 0) + (Number(line.kg) || 0));
    }
    return map;
  });

  /** Stock the form may use; while editing a sale its own outbound qty counts as available again. */
  formStockQty(kindKey: string | undefined): number {
    const key = kindKey || '';
    const extra = this.editingSaleQty().get(key) || 0;
    return Math.max(0, Math.round((this.kindStockQty(key) + extra) * 100) / 100);
  }

  /** Dropdown label carries the kind's live stock so the picker itself shows availability. */
  kindOptionLabel(kind: BatteryKind): string {
    const label = this.kindLabel(kind);
    if (this.type() !== 'sale') return label;
    const qty = this.formStockQty(kind.key);
    if (qty <= 0) return `${label} — ${this.prefs.txt('স্টক নেই', 'no stock')}`;
    const unitKey = this.kindStockMap().get(kind.key)?.unit === 'pcs' ? 'pcs' : 'kg';
    const unit = unitKey === 'pcs' ? this.prefs.txt('পিস', 'pcs') : this.prefs.txt('কেজি', 'kg');
    return `${label} — ${formatQty(qty, unitKey)} ${unit}`;
  }

  /** Stock left for this line after the other lines of the same kind are allocated. */
  lineAvailable(index: number): number {
    const line = this.lines()[index];
    if (!line) return 0;
    const key = line.kindKey || '';
    const used = this.lines().reduce((acc, l, i) =>
      i === index || (l.kindKey || '') !== key ? acc : acc + (Number(l.kg) || 0), 0);
    return Math.max(0, Math.round((this.formStockQty(key) - used) * 100) / 100);
  }

  readonly sellerLabel = computed(() => this.type() === 'purchase'
    ? this.prefs.txt('বিক্রেতার নাম', 'Seller name')
    : this.prefs.txt('গ্রাহকের নাম', 'Customer name'));

  readonly partyMatches = computed<Party[]>(() => {
    const q = this.partyQuery().trim().toLowerCase();
    const list = this.dataService.parties().filter(p => p.status !== 'Disabled');
    if (!q) return list.slice(0, 8);
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.phone || '').includes(q) ||
      (p.phones || []).some(value => (value || '').includes(q)) ||
      p.type.toLowerCase().includes(q)
    ).slice(0, 8);
  });

  readonly title = computed(() => {
    if (this.view() === 'ledger') return this.prefs.txt('লেজার স্টোক', 'Stock Ledger');
    if (this.view() === 'vouchers') return this.voucherListTitle();
    if (this.type() === 'purchase') return this.prefs.txt('পুরোনো ব্যাটারি ক্রয়', 'Old Battery Purchase');
    if (this.type() === 'sale') return this.prefs.txt('পুরোনো ব্যাটারি কেজিতে/পিস বিক্রি', 'Old Battery Sale (kg/pcs)');
    return this.prefs.txt('ভালো পুরোনো ব্যাটারি বদল', 'Old Battery Exchange');
  });

  readonly voucherListTitle = computed(() => {
    if (this.type() === 'purchase') return this.prefs.txt('ভাউচার ব্যাটারি ক্রয়', 'Battery Purchase Vouchers');
    if (this.type() === 'sale') return this.prefs.txt('ভাউচার ব্যাটারি বিক্রয়', 'Battery Sale Vouchers');
    return this.prefs.txt('ব্যাটারি বদল ভাউচার', 'Battery Exchange Vouchers');
  });

  typeRoute(t: BatteryVoucherType): string {
    return this.view() === 'vouchers' ? `/battery/${t}/vouchers` : `/battery/${t}`;
  }

  entryRoute(): string {
    return `/battery/${this.type()}`;
  }

  voucherListRoute(): string {
    return `/battery/${this.type()}/vouchers`;
  }

  readonly voucherNo = computed(() => this.dataService.peekBatteryVoucherNo(this.type()));
  readonly headerVoucherNo = computed(() => this.editingVoucher()?.voucherNo ?? this.voucherNo());
  readonly summary = computed(() => this.dataService.batterySummary());
  /** Good batteries received through exchanges, i.e. the pool a new exchange may give from. */
  readonly exchangeBookQty = computed(() => {
    const entry = this.kindStockMap().get('exchange');
    return Math.max(0, Math.round((entry?.qty ?? 0) * 100) / 100);
  });
  /** Editing an exchange returns the battery it gave out, so that quantity can be reused. */
  readonly exchangeStockKg = computed(() => {
    const editing = this.editingVoucher();
    const reused = editing?.type === 'exchange' ? Number(editing.givenKg) || 0 : 0;
    return Math.round((this.exchangeBookQty() + reused) * 100) / 100;
  });
  readonly history = computed(() => this.dataService.batteryVouchers().filter(v => v.type === this.type()));
  readonly historyPager = createPager(() => this.historyRows());
  readonly ledgerGroupPager = createPager(() => this.ledgerDateGroups());
  /** Full dated movements, newest first; balances are the running book. */
  readonly ledger = computed(() => [...this.dataService.batteryStockLedger()].reverse());
  readonly kindStock = computed(() => this.dataService.batteryKindStock());
  readonly kindStockMap = computed(() => {
    const map = new Map<string, BatteryKindStock>();
    for (const row of this.kindStock()) map.set(row.key, row);
    return map;
  });
  /** Every catalog kind with the stock it currently holds — drives the sale form. */
  readonly saleKindStock = computed(() => this.kindCatalog().map(kind => {
    const entry = this.kindStockMap().get(kind.key);
    const unit: BatteryUnit = kind.unit === 'either' ? (entry?.unit === 'pcs' ? 'pcs' : 'kg') : kind.unit;
    return {
      key: kind.key,
      label: this.kindLabel(kind),
      unit,
      qty: this.formStockQty(kind.key),
      avgRate: Math.max(0, entry?.avgRate ?? 0)
    };
  }));

  readonly ledgerRows = computed(() => {
    const q = this.ledgerQuery().trim().toLowerCase();
    const kind = this.ledgerKind();
    const from = this.ledgerFrom();
    const to = this.ledgerTo();
    const base = this.ledgerSort() === 'desc' ? this.ledger() : [...this.ledger()].reverse();
    return base.filter(row => {
      if (kind !== 'all' && row.kindKey !== kind) return false;
      if (!inDateRange(row.date, from, to)) return false;
      if (!q) return true;
      return row.voucherNo.toLowerCase().includes(q) ||
        row.partyName.toLowerCase().includes(q) ||
        row.kind.toLowerCase().includes(q) ||
        row.date.includes(q) ||
        this.dateLabel(row.date).includes(q);
    });
  });

  /** Per-date movement summary; kg and pcs stay in separate columns because they cannot be added. */
  readonly ledgerDaily = computed(() => {
    const days = new Map<string, {
      date: string; kgIn: number; kgOut: number; pcsIn: number; pcsOut: number; amount: number; entries: number;
    }>();
    const round = (value: number) => Math.round(value * 100) / 100;

    for (const row of this.ledgerRows()) {
      const date = toIsoDate(row.date) || row.date;
      let day = days.get(date);
      if (!day) {
        day = { date, kgIn: 0, kgOut: 0, pcsIn: 0, pcsOut: 0, amount: 0, entries: 0 };
        days.set(date, day);
      }
      if (row.unit === 'pcs') {
        day.pcsIn += Number(row.inQty) || 0;
        day.pcsOut += Number(row.outQty) || 0;
      } else {
        day.kgIn += Number(row.inQty) || 0;
        day.kgOut += Number(row.outQty) || 0;
      }
      day.amount += Number(row.amount) || 0;
      day.entries++;
    }

    const direction = this.ledgerSort() === 'desc' ? -1 : 1;
    return [...days.values()]
      .sort((a, b) => direction * a.date.localeCompare(b.date))
      .map(day => ({
        ...day,
        kgIn: round(day.kgIn),
        kgOut: round(day.kgOut),
        pcsIn: round(day.pcsIn),
        pcsOut: round(day.pcsOut),
        amount: round(day.amount)
      }));
  });

  /** Totals for the visible window, split by unit like the daily panel. */
  readonly ledgerWindowTotals = computed(() => {
    const round = (value: number) => Math.round(value * 100) / 100;
    const totals = { kgIn: 0, kgOut: 0, pcsIn: 0, pcsOut: 0, inValue: 0, outValue: 0, entries: 0 };
    for (const row of this.ledgerRows()) {
      if (row.unit === 'pcs') {
        totals.pcsIn += Number(row.inQty) || 0;
        totals.pcsOut += Number(row.outQty) || 0;
      } else {
        totals.kgIn += Number(row.inQty) || 0;
        totals.kgOut += Number(row.outQty) || 0;
      }
      // Money is kept on the side it moved, so an in-row cost never blends with sale revenue.
      if ((Number(row.inQty) || 0) > 0) totals.inValue += Number(row.amount) || 0;
      if ((Number(row.outQty) || 0) > 0) totals.outValue += Number(row.amount) || 0;
      totals.entries++;
    }
    return {
      kgIn: round(totals.kgIn),
      kgOut: round(totals.kgOut),
      pcsIn: round(totals.pcsIn),
      pcsOut: round(totals.pcsOut),
      inValue: round(totals.inValue),
      outValue: round(totals.outValue),
      entries: totals.entries
    };
  });

  readonly ledgerHasKg = computed(() => this.ledgerRows().some(row => row.unit !== 'pcs'));
  readonly ledgerHasPcs = computed(() => this.ledgerRows().some(row => row.unit === 'pcs'));
  readonly loading = computed(() => !this.dataService.hydrated());
  /** Pieces left in stock — kg has its own figure on the summary. */
  readonly stockPcs = computed(() => this.summary().stockPcs);
  readonly activeKindCount = computed(() => this.kindStock().filter(k => (Number(k.qty) || 0) !== 0).length);
  /** In-minus-out for the visible window, kept per unit because kg and pcs cannot be added. */
  readonly ledgerNet = computed(() => {
    const w = this.ledgerWindowTotals();
    return {
      kg: Math.round((w.kgIn - w.kgOut) * 100) / 100,
      pcs: Math.round((w.pcsIn - w.pcsOut) * 100) / 100
    };
  });
  /** Day rows with a bar length per unit, so a pcs-only day never hides behind the kg scale. */
  readonly ledgerDays = computed(() => {
    const days = this.ledgerDaily();
    const maxKg = Math.max(1, ...days.map(d => Math.max(d.kgIn, d.kgOut)));
    const maxPcs = Math.max(1, ...days.map(d => Math.max(d.pcsIn, d.pcsOut)));
    const pct = (value: number, max: number) => value > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
    return {
      hasKg: this.ledgerHasKg(),
      hasPcs: this.ledgerHasPcs(),
      days: days.map(day => ({
        ...day,
        kgInPct: pct(day.kgIn, maxKg),
        kgOutPct: pct(day.kgOut, maxKg),
        pcsInPct: pct(day.pcsIn, maxPcs),
        pcsOutPct: pct(day.pcsOut, maxPcs)
      }))
    };
  });

  /** Dated book: one section per date so a day's ins and outs read together. */
  readonly ledgerDateGroups = computed(() => {
    const groups = new Map<string, {
      date: string; rows: BatteryStockRow[];
      kgIn: number; kgOut: number; pcsIn: number; pcsOut: number; amount: number;
    }>();
    const round = (value: number) => Math.round(value * 100) / 100;
    for (const row of this.ledgerRows()) {
      const date = toIsoDate(row.date) || row.date;
      let group = groups.get(date);
      if (!group) {
        group = { date, rows: [], kgIn: 0, kgOut: 0, pcsIn: 0, pcsOut: 0, amount: 0 };
        groups.set(date, group);
      }
      if (row.unit === 'pcs') {
        group.pcsIn += Number(row.inQty) || 0;
        group.pcsOut += Number(row.outQty) || 0;
      } else {
        group.kgIn += Number(row.inQty) || 0;
        group.kgOut += Number(row.outQty) || 0;
      }
      group.amount += Number(row.amount) || 0;
      group.rows.push(row);
    }
    return [...groups.values()].map(group => ({
      ...group,
      entries: group.rows.length,
      kgIn: round(group.kgIn),
      kgOut: round(group.kgOut),
      pcsIn: round(group.pcsIn),
      pcsOut: round(group.pcsOut),
      amount: round(group.amount)
    }));
  });

  readonly ledgerTotals = computed(() => {
    const rows = this.ledgerRows();
    const sum = (pick: (r: BatteryStockRow) => number) => Math.round(rows.reduce((acc, r) => acc + (Number(pick(r)) || 0), 0) * 100) / 100;
    const stock = this.ledgerKind() === 'all' ? undefined : this.kindStockMap().get(this.ledgerKind());
    return {
      inQty: sum(r => r.inQty),
      outQty: sum(r => r.outQty),
      amount: sum(r => r.amount),
      balanceQty: stock?.qty ?? 0,
      balanceValue: stock?.value ?? 0
    };
  });

  readonly historyInRange = computed(() => {
    const from = this.historyFrom();
    const to = this.historyTo();
    return this.history().filter(v => inDateRange(v.date, from, to));
  });

  readonly historyRows = computed(() => {
    const q = this.voucherQuery().trim().toLowerCase();
    const rows = this.historyInRange();
    if (!q) return rows;
    return rows.filter(v =>
      v.voucherNo.toLowerCase().includes(q) ||
      v.partyName.toLowerCase().includes(q) ||
      (v.lot || '').toLowerCase().includes(q) ||
      (v.saleInvoice || '').toLowerCase().includes(q)
    );
  });

  readonly historyTotals = computed(() => {
    const rows = this.historyRows();
    const sum = (pick: (v: BatteryVoucher) => number) => Math.round(rows.reduce((acc, v) => acc + (Number(pick(v)) || 0), 0) * 100) / 100;
    return {
      total: sum(v => v.total),
      paid: sum(v => v.paid),
      due: sum(v => v.due),
      profit: sum(v => this.dataService.batteryVoucherProfit(v)),
      incomplete: rows.filter(v => v.type === 'sale' && this.costIncomplete(v)).length
    };
  });

  readonly voucherCards = computed(() => {
    const rows = this.historyInRange();
    const money = (n: number) => n.toFixed(2);
    const sum = (pick: (v: BatteryVoucher) => number) => rows.reduce((acc, v) => acc + (Number(pick(v)) || 0), 0);
    const kg = this.type() === 'exchange'
      ? sum(v => ((v.receivedKg || 0) - (v.givenKg || 0)))
      : sum(v => v.totalKg);
    const totals = {
      total: sum(v => v.total),
      paid: sum(v => v.paid),
      due: sum(v => v.due),
      profit: sum(v => this.dataService.batteryVoucherProfit(v))
    };
    return [
      { label: this.prefs.txt('মোট ভাউচার', 'Vouchers'), value: String(rows.length), color: 'text-slate-800 dark:text-slate-100' },
      { label: this.type() === 'exchange' ? this.prefs.txt('নিট কেজি বদল', 'Net kg exchanged') : this.prefs.txt('মোট কেজি', 'Total kg'), value: money(kg), color: 'text-indigo-600' },
      { label: this.type() === 'purchase' ? this.prefs.txt('মোট ক্রয়', 'Total purchase') : this.type() === 'sale' ? this.prefs.txt('মোট বিক্রয়', 'Total sale') : this.prefs.txt('বদলি ফি', 'Exchange fee'), value: money(totals.total), color: 'text-slate-800 dark:text-slate-100' },
      { label: this.type() === 'purchase' ? this.prefs.txt('মোট পরিশোধ', 'Total paid') : this.prefs.txt('মোট আদায়', 'Total received'), value: money(totals.paid), color: 'text-teal-600' },
      { label: this.prefs.txt('মোট বাকি', 'Total due'), value: money(totals.due), color: totals.due > 0 ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100' }
    ];
  });

  readonly totalKg = computed(() => this.lines().reduce((acc, l) => acc + (Number(l.kg) || 0), 0));
  readonly lineTotal = computed(() => this.lines().reduce((acc, l) => acc + (Number(l.kg) || 0) * (Number(l.rate) || 0), 0));
  readonly total = computed(() => this.type() === 'exchange' ? (Number(this.fee()) || 0) : this.lineTotal());
  readonly paid = computed(() => (Number(this.cash()) || 0) + (Number(this.bank()) || 0) + (Number(this.mobile()) || 0));
  readonly due = computed(() => Math.max(0, Math.round((this.total() - this.paid()) * 100) / 100));
  readonly profit = computed(() => this.type() === 'sale' ? this.total() - this.displayCost() : this.type() === 'exchange' ? this.total() : 0);

  readonly summaryCards = computed(() => {
    const s = this.summary();
    const money = (n: number) => n.toFixed(2);
    return [
      { label: this.prefs.txt('মোট ক্রয়', 'Total purchase'), value: money(s.purchaseTotal), color: 'text-slate-800 dark:text-slate-100' },
      { label: this.prefs.txt('মোট বিক্রয়', 'Total sale'), value: money(s.saleTotal), color: 'text-slate-800 dark:text-slate-100' },
      { label: this.prefs.txt('বদলি ফি', 'Exchange fee'), value: money(s.exchangeFee), color: 'text-slate-800 dark:text-slate-100' },
      { label: this.prefs.txt('নিট লাভ', 'Net profit'), value: money(s.profit), color: s.profit >= 0 ? 'text-teal-600' : 'text-rose-600' },
      { label: this.prefs.txt('স্টক', 'Stock'), value: `${formatQty(s.stockKg, 'kg')} ${this.prefs.txt('কেজি', 'kg')}${s.stockPcs ? ` · ${formatQty(s.stockPcs, 'pcs')} ${this.prefs.txt('পিস', 'pcs')}` : ''}`, color: 'text-indigo-600' },
      { label: this.prefs.txt('স্টক মূল্য', 'Stock value'), value: money(s.stockValue), color: 'text-indigo-600' },
      { label: this.prefs.txt('গড় ক্রয় দর', 'Avg purchase rate'), value: money(s.avgCostPerKg), color: 'text-slate-800 dark:text-slate-100' },
      { label: this.prefs.txt('স্টকের ধরন', 'Stock kinds'), value: String(this.dataService.batteryKindStock().filter(k => k.qty > 0).length), color: 'text-slate-800 dark:text-slate-100' }
    ];
  });

  readonly totalRows = computed(() => {
    const exchange = this.type() === 'exchange';
    const qtyUnit = exchange ? 'kg' : this.qtyUnitFor(this.lines());
    const qty = exchange ? this.receivedKg() - this.givenKg() : this.totalKg();
    const incomplete = this.type() === 'sale' && !this.costManual() && this.autoIncomplete();
    const rows = [
      { label: this.type() === 'purchase' ? this.prefs.txt('ক্রয় মূল্য', 'Purchase value') : this.type() === 'sale' ? this.prefs.txt('বিক্রয় মূল্য', 'Sale value') : this.prefs.txt('বদলি ফি', 'Exchange fee'), value: this.total().toFixed(2) },
      { label: this.prefs.txt('মোট পরিমাণ', 'Total qty'), value: `${formatQty(qty, qtyUnit)} ${this.unitLabel(qtyUnit)}` },
      { label: this.prefs.txt('নগদ', 'Cash'), value: (Number(this.cash()) || 0).toFixed(2) },
      { label: this.prefs.txt('ব্যাংক', 'Bank'), value: (Number(this.bank()) || 0).toFixed(2) },
      { label: this.mobileType, value: (Number(this.mobile()) || 0).toFixed(2) },
      { label: this.type() === 'purchase' ? this.prefs.txt('মোট প্রদান', 'Total paid') : this.prefs.txt('মোট প্রাপ্তি', 'Total received'), value: this.paid().toFixed(2) }
    ];
    if (this.type() === 'sale') {
      rows.push({ label: this.prefs.txt('লটের খরচ', 'Lot cost'), value: incomplete ? this.prefs.txt('ক্রয়খরচ অসম্পূর্ণ', 'Cost incomplete') : this.displayCost().toFixed(2) });
      rows.push({ label: this.prefs.txt('লাভ', 'Profit'), value: incomplete ? this.prefs.txt('অসম্পূর্ণ', 'Incomplete') : this.profit().toFixed(2) });
    }
    if (this.type() === 'exchange') rows.push({ label: this.prefs.txt('বদলি আয়', 'Exchange income'), value: this.profit().toFixed(2) });
    return rows;
  });

  readonly errors = computed<string[]>(() => {
    const errs: string[] = [];
    if (!this.effectivePartyName()) errs.push(this.prefs.txt('নাম দিন।', 'Enter a name.'));
    if (!this.date) errs.push(this.prefs.txt('তারিখ দিন।', 'Enter a date.'));
    if (this.type() === 'exchange') {
      if (!this.receivedId.trim() || !this.givenId.trim()) errs.push(this.prefs.txt('দুই ব্যাটারির লট / সিরিয়াল দিন।', 'Enter both battery lot / serial.'));
      if (this.receivedKg() <= 0 || this.givenKg() <= 0) errs.push(this.prefs.txt('দুই ব্যাটারির ওজন দিন।', 'Enter both battery weights.'));
      if (this.fee() <= 0) errs.push(this.prefs.txt('বদলি ফি দিন।', 'Enter the exchange fee.'));
      if (this.paid() > this.fee()) errs.push(this.prefs.txt('পেমেন্ট বদলি ফির বেশি হয়েছে।', 'Payment exceeds the exchange fee.'));
      // Exchanges draw only from their own pool; the battery received on this
      // voucher counts in, so a straight swap stays possible.
      const exchangeAvailable = Math.round((this.exchangeStockKg() + (Number(this.receivedKg()) || 0)) * 100) / 100;
      if (this.givenKg() > exchangeAvailable) {
        errs.push(this.prefs.txt(`বদল থেকে পাওয়া স্টকে মাত্র ${exchangeAvailable} কেজি আছে।`, `Only ${exchangeAvailable} kg in exchange stock for the battery given.`));
      }
    } else {
      if (!this.lot.trim()) errs.push(this.prefs.txt('লট / রেফারেন্স দিন।', 'Enter a lot / reference.'));
      if (!this.lines().length) errs.push(this.prefs.txt('অন্তত একটি লাইন যোগ করুন।', 'Add at least one line.'));
      if (this.lines().some(l => !l.kind || !(l.kg > 0) || !(l.rate > 0))) errs.push(this.prefs.txt('প্রতি লাইনে ধরন, ওজন ও দর দিন।', 'Each line needs kind, weight and rate.'));
      if (this.type() === 'sale') {
        const byKind = new Map<string, number>();
        for (const l of this.lines()) {
          const key = l.kindKey || '';
          byKind.set(key, (byKind.get(key) || 0) + (Number(l.kg) || 0));
        }
        for (const [key, qty] of byKind) {
          if (qty <= 0) continue;
          const kind = batteryKindByKey(key);
          const label = kind ? this.kindLabel(kind) : (this.lines().find(l => (l.kindKey || '') === key)?.kind || key);
          const entry = this.kindStockMap().get(key);
          const available = this.formStockQty(key);
          const unit = entry?.unit === 'pcs' ? this.prefs.txt('পিস', 'pcs') : this.prefs.txt('কেজি', 'kg');
          if (available <= 0) {
            errs.push(this.prefs.txt(`${label} — স্টকে নেই, বিক্রি করা যাবে না।`, `${label} — no stock, cannot sell.`));
          } else if (qty > available) {
            errs.push(this.prefs.txt(`${label} — স্টকে মাত্র ${available} ${unit} আছে, এর বেশি বিক্রি করা যাবে না।`, `${label} — only ${available} ${unit} in stock, cannot sell more.`));
          }
        }
      }
    }
    return errs;
  });

  constructor() {
    this.resetForm();
    this.loadEditingVoucher();
  }

  /** `/battery/:type?edit=<id>` opens the voucher prefilled for a passkey-approved edit. */
  private loadEditingVoucher() {
    const id = Number(this.route.snapshot.queryParamMap.get('edit'));
    if (!id) return;
    const voucher = this.dataService.batteryVouchers().find(v => v.id === id);
    if (!voucher || voucher.type !== this.type()) return;
    if (voucher.source === 'sale-adjustment') {
      // Trade-in rows belong to their sale invoice; editing them here would
      // desync the invoice's battery adjustment.
      this.notify.info(
        this.prefs.txt('এই ভাউচার একটি বিক্রয় বিলের বিল-সমন্বয় — ওই বিলটি এডিট করলেই স্টক ঠিক হবে।', 'This voucher is a sale-invoice adjustment — edit that sale and the stock follows.'),
        this.prefs.txt('বিল-সংযুক্ত ভাউচার', 'Invoice-linked voucher')
      );
      void this.router.navigateByUrl(`/battery/${this.type()}/vouchers`);
      return;
    }
    // The prefilled form is only reachable through the Admin-PIN gate; a typed
    // URL must not skip it.
    const approved = this.router.getCurrentNavigation()?.extras.state?.['editApproved'] === true
      || (typeof history !== 'undefined' && (history.state as Record<string, unknown> | null)?.['editApproved'] === true);
    if (!approved) {
      void this.router.navigateByUrl(`/battery/${this.type()}/vouchers`);
      return;
    }
    this.editingVoucher.set(voucher);
    this.partyName = voucher.partyName;
    this.partyId = voucher.partyId ?? null;
    this.partyQuery.set(voucher.partyName);
    this.date = voucher.date;
    this.lot = voucher.lot || '';
    this.ref = voucher.ref || '';
    this.notes = voucher.notes || '';
    this.receivedId = voucher.receivedId || '';
    this.givenId = voucher.givenId || '';
    this.receivedCondition = voucher.receivedCondition || 'scrap';
    this.mobileType = voucher.mobileType || 'bKash';
    const lines = (voucher.lines ?? []).map(l => ({ ...l }));
    this.lines.set(lines.length ? lines : [this.makeLine()]);
    this.receivedKg.set(Number(voucher.receivedKg) || 0);
    this.givenKg.set(Number(voucher.givenKg) || 0);
    this.fee.set(Number(voucher.fee) || 0);
    this.cost.set(Number(voucher.cost) || 0);
    this.costManual.set((Number(voucher.cost) || 0) > 0);
    this.cash.set(Number(voucher.cash) || 0);
    this.bank.set(Number(voucher.bank) || 0);
    this.mobile.set(Number(voucher.mobile) || 0);
  }

  tabClass(t: BatteryVoucherType): string {
    const base = 'px-3 py-1.5 rounded-lg font-bold cursor-pointer ';
    return this.type() === t
      ? base + 'bg-teal-600 text-white'
      : base + 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200';
  }

  profitOf(v: BatteryVoucher): number {
    return this.dataService.batteryVoucherProfit(v);
  }

  /** A sale whose kilograms were never bought shows no profit figure at all. */
  costIncomplete(v: BatteryVoucher): boolean {
    return this.dataService.batteryVoucherCostIncomplete(v);
  }

  addLine() {
    this.lines.update(list => [...list, this.makeLine()]);
  }

  /**
   * Only a complete figure is stored: a partial auto cost (some kinds have lots,
   * some do not) would be read back as complete and fake the missing profit.
   */
  private savableSaleCost(): number | undefined {
    const typed = Number(this.cost()) || 0;
    if (this.costManual() && typed > 0) return Math.round(typed * 100) / 100;
    if (this.autoIncomplete()) return undefined;
    return Math.round(this.autoCost() * 100) / 100;
  }

  /** A typed lot cost wins; emptying the box hands the figure back to the stock average. */
  onCostInput(value: number | string) {
    const amount = Number(value) || 0;
    this.costManual.set(amount > 0);
    this.cost.set(amount);
  }

  resetCostToAuto() {
    this.costManual.set(false);
    this.cost.set(0);
  }

  /** Apply a catalog kind to a line, snapping the unit (either → operator picks). */
  onKindSelect(index: number, kindKey: string) {
    const kind = this.kindCatalog().find(k => k.key === kindKey) || BATTERY_KINDS[0];
    this.updateLine(index, {
      kind: this.kindLabel(kind),
      kindKey: kind.key,
      unit: kind.unit === 'either' ? (this.lines()[index]?.unit || 'kg') : kind.unit
    });
    if (this.type() === 'sale') {
      const available = this.lineAvailable(index);
      if ((this.lines()[index]?.kg || 0) > available) this.updateLine(index, { kg: available });
    }
  }

  /** Sale quantities can never cross the selected kind's live stock. */
  onLineQty(index: number, value: number, input?: HTMLInputElement) {
    const unit = this.lines()[index]?.unit || 'kg';
    let qty = Math.max(0, roundQty(value, unit));
    if (input && unit === 'pcs' && input.value !== String(qty)) input.value = String(qty);
    if (this.type() === 'sale') {
      const available = this.lineAvailable(index);
      if (qty > available) {
        qty = available;
        // Clamping to the previous model value would leave the typed number on screen.
        if (input) input.value = String(qty);
        this.notify.warning(
          available > 0
            ? this.prefs.txt(`এই ধরনে স্টকে মাত্র ${available} আছে — এর বেশি বিক্রি করা যাবে না।`, `Only ${available} of this kind in stock — cannot sell more.`)
            : this.prefs.txt('এই ধরনের স্টক নেই — বিক্রি করা যাবে না।', 'This kind is out of stock — cannot sell.'),
          this.prefs.txt('স্টক সীমা', 'Stock limit')
        );
      }
    }
    this.updateLine(index, { kg: qty });
  }

  /** Show the normalized figure once typing stops: 2.46 kg reads back as 2.5. */
  onLineQtyBlur(index: number, input: HTMLInputElement) {
    const line = this.lines()[index];
    if (!line) return;
    input.value = formatQtyInput(line.kg, line.unit || 'kg');
  }

  onUnitSelect(index: number, unit: BatteryUnit) {
    this.updateLine(index, { unit });
  }

  private makeLine(): BatteryLine {
    const kind = this.type() === 'sale'
      ? this.kindCatalog().find(k => this.kindStockQty(k.key) > 0) || BATTERY_KINDS[0]
      : BATTERY_KINDS[0];
    return {
      kind: this.kindLabel(kind),
      kindKey: kind.key,
      unit: kind.unit === 'either' ? 'kg' : kind.unit,
      kg: 0,
      rate: 0
    };
  }

  /** Lot reference is generated per voucher type; the operator can still overwrite it. */
  autoLot(): string {
    const prefix = this.type() === 'purchase' ? 'LOT-BPUR' : this.type() === 'sale' ? 'LOT-BSAL' : 'LOT-BEX';
    const count = this.dataService.batteryVouchers().filter(v => v.type === this.type()).length + 1;
    return `${prefix}-${count}`;
  }

  regenerateLot() {
    this.lot = this.autoLot();
  }

  removeLine(index: number) {
    this.lines.update(list => list.filter((_, i) => i !== index));
  }

  updateLine(index: number, patch: Partial<BatteryLine>) {
    this.lines.update(list => list.map((l, i) => i === index ? { ...l, ...patch } : l));
  }

  resetForm() {
    this.editingVoucher.set(null);
    this.partyName = '';
    this.partyId = null;
    this.partyQuery.set('');
    this.partyOpen.set(false);
    this.date = localDateIso();
    this.lot = this.type() === 'exchange' ? '' : this.autoLot();
    this.ref = '';
    this.notes = '';
    this.receivedId = '';
    this.givenId = '';
    this.receivedCondition = 'scrap';
    this.mobileType = 'bKash';
    this.lines.set([this.makeLine()]);
    this.receivedKg.set(0);
    this.givenKg.set(0);
    this.fee.set(0);
    this.cost.set(0);
    this.costManual.set(false);
    this.cash.set(0);
    this.bank.set(0);
    this.mobile.set(0);
  }

  // ---- Party picker / custom customer ----
  onPartyQuery(e: Event) {
    this.partyQuery.set((e.target as HTMLInputElement).value);
    this.partyOpen.set(true);
  }

  onLedgerQuery(e: Event) {
    this.ledgerQuery.set((e.target as HTMLInputElement).value);
    this.ledgerGroupPager.setPage(1);
  }

  onLedgerRange(range: DateRange) {
    this.ledgerFrom.set(range.from);
    this.ledgerTo.set(range.to);
    this.ledgerGroupPager.setPage(1);
  }

  onHistoryRange(range: DateRange) {
    this.historyFrom.set(range.from);
    this.historyTo.set(range.to);
    this.historyPager.setPage(1);
  }

  toggleLedgerSort() {
    this.ledgerSort.update(s => (s === 'desc' ? 'asc' : 'desc'));
  }

  toggleLedgerKind(key: string) {
    this.ledgerKind.update(current => (current === key ? 'all' : key));
    this.ledgerGroupPager.setPage(1);
  }

  /** Drill from a day bar into that date's entries in the transaction book. */
  openLedgerDay(date: string) {
    this.ledgerFrom.set(date);
    this.ledgerTo.set(date);
    this.ledgerGroupPager.setPage(1);
    this.ledgerView.set('book');
  }

  openLedgerDetail(row: BatteryStockRow) {
    const voucher = this.dataService.batteryVouchers().find(v => v.voucherNo === row.voucherNo) || null;
    this.ledgerDetail.set({ row, voucher });
  }

  closeLedgerDetail() {
    this.ledgerDetail.set(null);
  }

  openVoucherFromDetail() {
    const detail = this.ledgerDetail();
    if (!detail?.voucher) return;
    this.voucher.set(detail.voucher);
    this.ledgerDetail.set(null);
  }

  /** Ledger rows and voucher deletes are stock movements — changing them needs the admin PIN first. */
  requestLedgerAction(action: 'edit' | 'delete') {
    const voucher = this.ledgerDetail()?.voucher;
    if (voucher) this.requestVoucherAction(action, voucher);
  }

  private requestVoucherAction(action: 'edit' | 'delete', voucher: BatteryVoucher) {
    if (voucher.source === 'sale-adjustment') {
      this.notify.info(
        this.prefs.txt('এই সারিটি একটি বিক্রয় বিলের বিল-সমন্বয় — ওই বিলটি এডিট বা মুছলে স্টক নিজে থেকেই ঠিক হবে।', 'This row is settled by a sale invoice — edit or delete that sale and the stock follows.'),
        this.prefs.txt('বিল-সংযুক্ত এন্ট্রি', 'Invoice-linked entry')
      );
      return;
    }
    if (action === 'edit' && this.fundAllocated(voucher) > 0) {
      this.notify.info(
        this.prefs.txt(`${voucher.voucherNo} এর কিছু টাকা ব্যাটারি ফান্ড থেকে পরিশোধ হয়েছে — আগে সংশ্লিষ্ট ফান্ড ট্রান্সফারটি মুছুন, তারপর ভাউচারটি এডিট করুন।`, `Part of ${voucher.voucherNo} was paid from the battery fund — delete that fund transfer first, then edit the voucher.`),
        this.prefs.txt('ফান্ডে পরিশোধিত ভাউচার', 'Fund-settled voucher')
      );
      return;
    }
    this.ledgerAccess.set({ action, voucher });
  }

  onLedgerPasscode() {
    const req = this.ledgerAccess();
    if (!req) return;
    this.ledgerAccess.set(null);
    if (req.action === 'edit') {
      this.ledgerDetail.set(null);
      this.router.navigate(['/battery', req.voucher.type], { queryParams: { edit: req.voucher.id }, state: { editApproved: true } });
      return;
    }
    void this.confirmLedgerDelete(req.voucher);
  }

  private async confirmLedgerDelete(voucher: BatteryVoucher) {
    const ok = await this.notify.confirm(
      this.prefs.txt(`${voucher.voucherNo} মুছে ফেলবেন? স্টক ও অ্যাকাউন্ট পোস্টিং ফেরত নেওয়া হবে।`, `Delete ${voucher.voucherNo}? Stock and account postings will be reversed.`),
      { title: this.prefs.txt('ভাউচার মুছুন', 'Delete voucher'), kind: 'error', confirmText: this.prefs.txt('মুছুন', 'Delete'), cancelText: this.prefs.txt('বাতিল', 'Cancel') }
    );
    if (!ok) return;
    this.dataService.deleteBatteryVoucher(voucher.id);
    this.session.log('Battery Voucher', `${voucher.voucherNo} — deleted`);
    this.ledgerDetail.set(null);
    this.notify.success(this.prefs.txt(`${voucher.voucherNo} মুছে ফেলা হয়েছে।`, `${voucher.voucherNo} deleted.`), this.prefs.txt('ব্যাটারি ভাউচার', 'Battery voucher'));
  }

  cancelEdit() {
    this.resetForm();
    this.router.navigateByUrl('/battery/ledger');
  }

  // ---- Battery stock fund ----
  fundAllocated(voucher: BatteryVoucher): number {
    return voucher.type === 'purchase' ? this.fundAllocations().get(voucher.id) || 0 : 0;
  }

  /** Paid on the voucher plus everything the fund has already sent to the seller. */
  fundPaidTotal(voucher: BatteryVoucher): number {
    return Math.round(((Number(voucher.paid) || 0) + this.fundAllocated(voucher)) * 100) / 100;
  }

  fundDueLeft(voucher: BatteryVoucher): number {
    return Math.max(0, Math.round(((Number(voucher.due) || 0) - this.fundAllocated(voucher)) * 100) / 100);
  }

  fundAllocationLabel(transfer: BatteryFundTransfer): string {
    return (transfer.allocations ?? []).map(line => line.voucherNo).join(', ');
  }

  openFundTransfer() {
    const first = this.fundParties()[0];
    this.fundPartyId = first?.party.id ?? null;
    this.fundAmount = first ? first.available : null;
    this.fundDate = localDateIso();
    this.fundMode = 'Cash';
    this.fundNote = '';
    this.fundError.set('');
    this.showFundTransfer.set(true);
  }

  closeFundTransfer() {
    this.showFundTransfer.set(false);
    this.fundSaving.set(false);
  }

  fundPartyAvailable(): number {
    return this.fundPartyId != null ? this.fundByParty().get(this.fundPartyId) || 0 : 0;
  }

  onFundPartyChange() {
    const available = this.fundPartyAvailable();
    this.fundAmount = available > 0 ? available : null;
    this.fundError.set('');
  }

  fillFundAmount() {
    const available = this.fundPartyAvailable();
    if (available > 0) this.fundAmount = available;
  }

  saveFundTransfer() {
    if (this.fundSaving()) return;
    const partyId = Number(this.fundPartyId) || 0;
    const amount = Number(this.fundAmount) || 0;
    if (!partyId) {
      this.fundError.set(this.prefs.txt('পার্টি বাছুন।', 'Choose a party.'));
      return;
    }
    if (!(amount > 0)) {
      this.fundError.set(this.prefs.txt('টাকার পরিমাণ দিন।', 'Enter an amount.'));
      return;
    }
    this.fundSaving.set(true);
    const result = this.dataService.transferBatteryFund({
      partyId,
      amount,
      mode: this.fundMode,
      date: this.fundDate,
      note: this.fundNote,
      createdBy: this.session.currentUser()?.name
    });
    this.fundSaving.set(false);
    if (!result.ok) {
      this.fundError.set(result.error);
      return;
    }
    this.session.log('Battery Voucher', `${result.transfer.transferNo} — fund → ${result.transfer.partyName} — ${amount.toFixed(2)} TK (${this.fundMode})`);
    this.notify.success(
      this.prefs.txt(
        `${amount.toFixed(2)} TK ${result.transfer.partyName} এর হিসাবে পরিশোধ হয়েছে (${result.transfer.transferNo})।`,
        `${amount.toFixed(2)} TK settled to ${result.transfer.partyName} (${result.transfer.transferNo}).`
      ),
      this.prefs.txt('ব্যাটারি ফান্ড ট্রান্সফার', 'Battery fund transfer')
    );
    this.closeFundTransfer();
  }

  requestFundDelete(transfer: BatteryFundTransfer) {
    this.fundDeleteRequest.set(transfer);
  }

  onFundDeletePin() {
    const transfer = this.fundDeleteRequest();
    this.fundDeleteRequest.set(null);
    if (!transfer) return;
    void this.confirmFundDelete(transfer);
  }

  private async confirmFundDelete(transfer: BatteryFundTransfer) {
    const ok = await this.notify.confirm(
      this.prefs.txt(
        `${transfer.transferNo} ফেরত নেবেন? পার্টির পরিশোধ ও ওয়ালেটের টাকা দুটোই আগের অবস্থায় ফিরবে।`,
        `Reverse ${transfer.transferNo}? The party settlement and the wallet movement will both go back.`
      ),
      {
        title: this.prefs.txt('ফান্ড ট্রান্সফার বাতিল', 'Reverse fund transfer'),
        kind: 'warning',
        confirmText: this.prefs.txt('ফেরত নিন', 'Reverse'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (!ok) return;
    this.dataService.deleteBatteryFundTransfer(transfer.id);
    this.session.log('Battery Voucher', `${transfer.transferNo} — fund transfer reversed — ${transfer.amount.toFixed(2)} TK`);
    this.notify.success(
      this.prefs.txt(`${transfer.transferNo} ফেরত নেওয়া হয়েছে।`, `${transfer.transferNo} reversed.`),
      this.prefs.txt('ব্যাটারি ফান্ড', 'Battery fund')
    );
  }

  sourceLabel(source: BatteryStockRow['source']): string {
    if (source === 'sale') return this.prefs.txt('বিক্রয়', 'Sale');
    if (source === 'exchange') return this.prefs.txt('বদল', 'Exchange');
    if (source === 'sale-adjustment') return this.prefs.txt('বিক্রয় সমন্বয়', 'Sale adjustment');
    return this.prefs.txt('ক্রয় / জমা', 'Purchase / in');
  }

  onVoucherQuery(e: Event) {
    this.voucherQuery.set((e.target as HTMLInputElement).value);
    this.historyPager.setPage(1);
  }

  /** Let a suggestion's click land before the dropdown closes on blur. */
  closePartySoon() {
    setTimeout(() => this.partyOpen.set(false), 180);
  }

  pickParty(p: Party) {
    this.partyName = p.name;
    this.partyId = p.id;
    this.partyQuery.set(p.name);
    this.partyOpen.set(false);
  }

  openCustomerModal() {
    this.newCustomerName = this.partyQuery().trim();
    this.newCustomerPhone = '';
    this.newCustomerType = 'Customer';
    this.newCustomerPhoto.set('');
    this.newCustomerDoc.set('');
    this.newCustomerDivision = '';
    this.newCustomerDistrict = '';
    this.newCustomerUpazila = '';
    this.newCustomerAddress = '';
    this.showCustomerModal.set(true);
    this.partyOpen.set(false);
  }

  closeCustomerModal() {
    this.showCustomerModal.set(false);
  }

  async onCustomerPhoto(e: Event) {
    const picked = await this.media.pick(e, 'parties', this.newCustomerName || 'party');
    if (!picked.ok) {
      if (picked.error) this.notify.error(picked.error, this.prefs.txt('ছবি', 'Image'));
      return;
    }
    this.newCustomerPhoto.set(picked.image.ref);
    if (picked.image.note) this.notify.warning(picked.image.note, 'Cloudinary');
  }

  async onCustomerDoc(e: Event) {
    const picked = await this.media.pick(e, 'parties', (this.newCustomerName || 'party') + '-voter');
    if (!picked.ok) {
      if (picked.error) this.notify.error(picked.error, this.prefs.txt('ডকুমেন্ট', 'Document'));
      return;
    }
    this.newCustomerDoc.set(picked.image.ref);
    if (picked.image.note) this.notify.warning(picked.image.note, 'Cloudinary');
  }

  saveCustomer() {
    const name = this.newCustomerName.trim();
    if (!name) {
      this.notify.error(this.prefs.txt('কাস্টমারের নাম দিন।', 'Enter the customer name.'), this.prefs.txt('যাচাই করুন', 'Check the form'));
      return;
    }
    const phoneOwner = this.dataService.partyByPhone(this.newCustomerPhone);
    if (phoneOwner) {
      this.notify.error(
        this.prefs.txt(
          `এই মোবাইল নাম্বারেই “${phoneOwner.name}” পার্টি আছে। এক নাম্বারে দুটি পার্টি আইডি চলবে না।`,
          `This mobile number already belongs to “${phoneOwner.name}”. One number cannot have two party IDs.`
        ),
        this.prefs.txt('ডুপ্লিকেট মোবাইল', 'Duplicate mobile')
      );
      return;
    }
    this.savingCustomer.set(true);
    try {
      const party = this.dataService.addParty({
        name,
        companyName: '',
        type: this.newCustomerType,
        roles: [this.newCustomerType],
        total: 0,
        paid: 0,
        due: 0,
        status: 'Enabled',
        inHand: '',
        zone: this.newCustomerDistrict || '',
        email: '',
        phone: this.newCustomerPhone.trim() || undefined,
        createdAt: new Date().toISOString(),
        address: [this.newCustomerAddress, this.newCustomerUpazila, this.newCustomerDistrict, this.newCustomerDivision].filter(Boolean).join(', '),
        addressText: this.newCustomerAddress.trim() || undefined,
        division: this.newCustomerDivision || undefined,
        district: this.newCustomerDistrict || undefined,
        upazila: this.newCustomerUpazila || undefined,
        thana: this.newCustomerUpazila || undefined,
        documents: this.newCustomerDoc() || '-',
        profileImage: this.newCustomerPhoto() || undefined
      });
      this.partyName = party.name;
      this.partyId = party.id;
      this.partyQuery.set(party.name);
      this.showCustomerModal.set(false);
      this.notify.success(this.prefs.txt(`${party.name} যোগ হয়েছে।`, `${party.name} added.`), this.prefs.txt('কাস্টমার', 'Customer'));
    } finally {
      this.savingCustomer.set(false);
    }
  }

  save() {
    if (this.errors().length) {
      this.notify.error(this.errors()[0], this.prefs.txt('যাচাই করুন', 'Check the form'));
      return;
    }
    const type = this.type();
    const editing = this.editingVoucher();
    const total = Math.round(this.total() * 100) / 100;
    const paid = Math.round(this.paid() * 100) / 100;
    const payload: Omit<BatteryVoucher, 'id' | 'voucherNo' | 'shareKey' | 'walletTxnIds'> = {
      type,
      date: this.date,
      partyName: this.effectivePartyName(),
      partyId: this.partyId ?? undefined,
      lot: this.lot.trim(),
      lines: type === 'exchange' ? [] : this.lines().map(l => ({
        kind: l.kind,
        kindKey: l.kindKey,
        unit: l.unit || 'kg',
        kg: roundQty(l.kg, l.unit || 'kg'),
        rate: Number(l.rate) || 0
      })),
      totalKg: type === 'exchange' ? 0 : Math.round(this.totalKg() * 100) / 100,
      total,
      cost: type === 'sale' ? this.savableSaleCost() : undefined,
      receivedId: type === 'exchange' ? this.receivedId.trim() : undefined,
      receivedKg: type === 'exchange' ? roundQty(this.receivedKg(), 'kg') : undefined,
      receivedCondition: type === 'exchange' ? this.receivedCondition : undefined,
      givenId: type === 'exchange' ? this.givenId.trim() : undefined,
      givenKg: type === 'exchange' ? roundQty(this.givenKg(), 'kg') : undefined,
      fee: type === 'exchange' ? total : undefined,
      cash: Number(this.cash()) || 0,
      bank: Number(this.bank()) || 0,
      mobile: Number(this.mobile()) || 0,
      mobileType: this.mobileType,
      ref: this.ref.trim(),
      paid,
      due: Math.max(0, Math.round((total - paid) * 100) / 100),
      notes: this.notes.trim(),
      preparedBy: editing?.preparedBy || this.session.currentUser()?.name || 'Admin',
      createdAt: editing?.createdAt || new Date().toISOString()
    };
    if (editing) {
      this.dataService.updateBatteryVoucher(editing.id, payload);
      this.session.log('Battery Voucher', `${editing.voucherNo} — updated — ${total.toFixed(2)} TK`);
      this.notify.success(this.prefs.txt(`${editing.voucherNo} আপডেট হয়েছে।`, `${editing.voucherNo} updated.`), this.prefs.txt('ব্যাটারি ভাউচার', 'Battery voucher'));
      this.resetForm();
      this.router.navigateByUrl('/battery/ledger');
      return;
    }
    const saved = this.dataService.addBatteryVoucher(payload);
    this.session.log('Battery Voucher', `${saved.voucherNo} — ${type} — ${total.toFixed(2)} TK`);
    this.notify.success(this.prefs.txt(`${saved.voucherNo} সংরক্ষিত হয়েছে।`, `${saved.voucherNo} saved.`), this.prefs.txt('ব্যাটারি ভাউচার', 'Battery voucher'));
    this.voucher.set(saved);
    this.resetForm();
  }

  /** A picked party, or a name typed in the search box that the operator wants to use as-is. */
  effectivePartyName(): string {
    return (this.partyName || this.partyQuery()).trim();
  }

  viewVoucher(v: BatteryVoucher) {
    this.voucher.set(v);
  }

  /** Pencil in the voucher history: same Admin-PIN gate the ledger uses. */
  editVoucher(v: BatteryVoucher) {
    this.requestVoucherAction('edit', v);
  }

  /** Edit requested from inside the printable voucher preview. */
  editViewedVoucher() {
    const v = this.voucher();
    this.voucher.set(null);
    if (v) this.requestVoucherAction('edit', v);
  }

  closeVoucher() {
    this.voucher.set(null);
  }

  /** Anything typed into the entry form that has not been saved yet. */
  hasUnsavedWork(): boolean {
    if (this.leaving || this.voucher() || this.view() !== 'entry') return false;
    const touchedLine = this.lines().some(line =>
      (Number(line.kg) || 0) > 0 || (Number(line.rate) || 0) > 0);
    return this.editingVoucher() !== null
      || this.effectivePartyName() !== ''
      || touchedLine
      || this.receivedId.trim() !== ''
      || this.givenId.trim() !== ''
      || this.ref.trim() !== ''
      || this.notes.trim() !== ''
      || this.receivedKg() > 0
      || this.givenKg() > 0
      || this.fee() > 0
      || this.cost() > 0
      || this.cash() > 0
      || this.bank() > 0
      || this.mobile() > 0;
  }

  private leaving = false;

  async confirmLeave(): Promise<boolean> {
    if (!this.hasUnsavedWork()) return true;
    const leave = await this.notify.confirm(
      this.prefs.txt(
        'এই ব্যাটারি ভাউচারে দেওয়া তথ্য এখনো সেভ হয়নি। বের হলে লাইন, পার্টি ও পেমেন্টের সব পরিবর্তন হারিয়ে যাবে।',
        'This battery voucher is not saved yet. Leaving will discard the lines, party and payment you entered.'
      ),
      {
        title: this.prefs.txt('পাতা ছেড়ে যাবেন?', 'Leave this page?'),
        kind: 'warning',
        confirmText: this.prefs.txt('হ্যাঁ, বের হন', 'Yes, leave'),
        cancelText: this.prefs.txt('এখানে থাকুন', 'Stay here')
      }
    );
    if (leave) this.leaving = true;
    return leave;
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (!this.hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  remove(v: BatteryVoucher) {
    this.requestVoucherAction('delete', v);
  }
}
