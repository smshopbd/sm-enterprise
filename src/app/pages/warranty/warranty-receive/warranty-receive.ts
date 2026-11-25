import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DataService, Product, WarrantyReceipt } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { localizeAddress } from '../../../utils/bd-geo';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';
import { WarrantyClaim } from '../../../components/warranty-claim/warranty-claim';
import { dmyFromIso, localDateIso } from '../../../utils/local-date';
import { isoDay, isWarrantyCancelled, isWarrantyCompleted, warrantyExpiryDate } from '../../../utils/warranty';

interface ReceiptForm {
  date: string;
  saleId: number | null;
  invoiceNumber: string;
  customerName: string;
  phone: string;
  address: string;
  productId: number | null;
  productName: string;
  serialNumber: string;
  quantity: number;
  unit: string;
  warrantyStart: string;
  warrantyDays: number;
  condition: string;
  reason: string;
  accessories: string;
  expectedDate: string;
  status: string;
  supplierId: number | null;
  supplierName: string;
  stockIn: boolean;
  handledBy: string;
  notes: string;
}

@Component({
  selector: 'app-warranty-receive',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, TablePagination, DmyDateDirective, WarrantyClaim],
  template: `
    <div class="space-y-4 text-xs text-slate-800 dark:text-slate-200">

      @if (isFormView) {
        <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
          <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
          <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

          <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-3">
              <a routerLink="/warranty/receive" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 transition hover:bg-white/25" [title]="prefs.txt('তালিকায় ফিরুন', 'Back to list')">
                <mat-icon class="text-lg">arrow_back</mat-icon>
              </a>
              <div class="min-w-0">
                <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                  {{ prefs.txt('ওয়ারেন্টি', 'Warranty') }}
                  <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                  {{ prefs.txt('গ্রহণ', 'Receiving') }}
                </p>
                <h1 class="truncate text-xl font-bold leading-tight">
                  {{ editId() ? prefs.txt('গ্রহণ এডিট করুন', 'Edit Receipt') : prefs.txt('নতুন ওয়ারেন্টি গ্রহণ', 'New Warranty Receipt') }}
                </h1>
                <p class="flex items-center gap-1.5 truncate text-[11px] text-teal-50/85">
                  {{ prefs.txt('ক্লেইম নম্বর', 'Claim no') }}
                  <span class="rounded-md bg-white/15 px-1.5 py-0.5 font-mono font-bold ring-1 ring-white/20">{{ claimNo() }}</span>
                </p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <a routerLink="/warranty/receive" class="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20">{{ prefs.txt('বাতিল', 'Cancel') }}</a>
              <button (click)="save()" class="inline-flex items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 transition hover:bg-teal-50 cursor-pointer">
                <mat-icon class="text-xs">save</mat-icon> {{ editId() ? prefs.txt('আপডেট', 'Update') : prefs.txt('সেভ করুন', 'Save') }}
              </button>
            </div>
          </div>
        </div>
      } @else {
        <div class="no-print relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
          <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
          <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

          <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                <mat-icon class="text-xl">assignment_return</mat-icon>
              </span>
              <div class="min-w-0">
                <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                  {{ prefs.txt('ওয়ারেন্টি', 'Warranty') }}
                  <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                  {{ prefs.txt('গ্রহণ', 'Receiving') }}
                </p>
                <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('ওয়ারেন্টি গ্রহণ', 'Warranty Receiving') }}</h1>
                <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('গ্রাহকের কাছ থেকে ত্রুটিপূর্ণ পণ্য গ্রহণের তালিকা। নতুন ক্লেইম আলাদা ফরম থেকে খুলুন।', 'List of faulty units received from customers. Open a new claim from its own form.') }}</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button (click)="exportExcel()" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer">
                <mat-icon class="text-xs">file_download</mat-icon> {{ prefs.txt('এক্সপোর্ট', 'Export') }}
              </button>
              <a routerLink="/warranty/receive/new" class="inline-flex items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 transition hover:bg-teal-50">
                <mat-icon class="text-xs">add</mat-icon> {{ prefs.txt('নতুন গ্রহণ', 'New Receipt') }}
              </a>
            </div>
          </div>
        </div>

      <div class="no-print grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div class="rounded-xl border border-teal-200 bg-teal-50/60 dark:bg-teal-900/20 dark:border-teal-800 px-3 py-2.5">
          <p class="text-[10px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">{{ prefs.txt('মোট গ্রহণ', 'Total Receipts') }}</p>
          <p class="text-lg font-bold font-mono text-teal-900 dark:text-teal-200">{{ stats().receipts }}</p>
        </div>
        <div class="rounded-xl border border-amber-200 bg-amber-50/60 dark:bg-amber-900/20 dark:border-amber-800 px-3 py-2.5">
          <p class="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">{{ prefs.txt('চলমান ক্লেইম', 'Open Claims') }}</p>
          <p class="text-lg font-bold font-mono text-amber-900 dark:text-amber-200">{{ stats().open }}</p>
        </div>
        <div class="rounded-xl border border-sky-200 bg-sky-50/60 dark:bg-sky-900/20 dark:border-sky-800 px-3 py-2.5">
          <p class="text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">{{ prefs.txt('আজকের গ্রহণ', 'Today') }}</p>
          <p class="text-lg font-bold font-mono text-sky-900 dark:text-sky-200">{{ stats().todayReceipts }}</p>
        </div>
        <div class="rounded-xl border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-900/20 dark:border-emerald-800 px-3 py-2.5">
          <p class="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{{ prefs.txt('গ্রহণ স্টকে পণ্যের ধরন', 'Products In Intake Stock') }}</p>
          <p class="text-lg font-bold font-mono text-emerald-900 dark:text-emerald-200">{{ stats().unitsReceived }}</p>
        </div>
      </div>
      }

      <!-- Intake form (own page) -->
      @if (isFormView) {
      <section class="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-700">
        <header class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 rounded-t-xl">
          <div class="flex items-center gap-2">
            <mat-icon class="text-teal-600">{{ form().date ? 'edit_document' : 'post_add' }}</mat-icon>
            <h2 class="font-bold text-sm text-slate-900 dark:text-slate-100">{{ prefs.txt('গ্রহণের তথ্য', 'Receipt Details') }}</h2>
          </div>
          <span class="font-mono text-[11px] font-bold text-slate-500">{{ prefs.txt('তারকা চিহ্নিত ঘর আবশ্যক', '* Required fields') }}</span>
        </header>

        <div class="p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          @if (settledEdit()) {
            <p class="col-span-2 lg:col-span-4 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 p-2 text-[11px] text-sky-800 dark:text-sky-200">
              {{ prefs.txt('এই গ্রহণটি একটি পরিবর্তন ভাউচার দিয়ে নিষ্পত্তি হয়েছে — তারিখ, পণ্য, সিরিয়াল, পরিমাণ, স্টক ও স্ট্যাটাস লক করা আছে; কাস্টমার, ফোন, ঠিকানা ও নোট বদলানো যাবে।', 'This receipt was settled by a replacement voucher — date, product, serial, quantity, stock and status are locked; customer, phone, address and notes can still change.') }}
            </p>
          }
          <label class="block">
            <span class="app-label">{{ prefs.txt('গ্রহণের তারিখ', 'Received On') }}</span>
            <input type="date" appDmyDate [disabled]="settledEdit()" [ngModel]="form().date" (ngModelChange)="set('date', $event)" class="app-input" />
          </label>

          <label class="block lg:col-span-2">
            <span class="app-label">{{ prefs.txt('ইনভয়েস থেকে আনুন', 'Pull From Invoice') }}</span>
            <select [disabled]="settledEdit()" [ngModel]="form().saleId" (ngModelChange)="pickSale($event)" class="app-input">
              <option [ngValue]="null">{{ prefs.txt('ইনভয়েস নির্বাচন করুন (ঐচ্ছিক)', 'Select invoice (optional)') }}</option>
              @for (sale of saleOptions(); track sale.id) {
                <option [ngValue]="sale.id">{{ sale.invoice }} — {{ sale.customerName }}</option>
              }
            </select>
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('ইনভয়েস নম্বর', 'Invoice No') }}</span>
            <input [ngModel]="form().invoiceNumber" (ngModelChange)="set('invoiceNumber', $event)" placeholder="INV-..." class="app-input font-mono" />
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('কাস্টমার', 'Customer') }} *</span>
            <input list="wr-customers" [ngModel]="form().customerName" (ngModelChange)="pickCustomerName($event)" placeholder="{{ prefs.txt('কাস্টমারের নাম', 'Customer name') }}" class="app-input" />
            <datalist id="wr-customers">
              @for (party of customers(); track party.id) {
                <option [value]="party.name">{{ party.phone }}</option>
              }
            </datalist>
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('মোবাইল', 'Mobile') }}</span>
            <input [ngModel]="form().phone" (ngModelChange)="set('phone', $event)" placeholder="01XXXXXXXXX" class="app-input font-mono" />
          </label>

          <label class="block lg:col-span-2">
            <span class="app-label">{{ prefs.txt('ঠিকানা', 'Address') }}</span>
            <input [ngModel]="form().address" (ngModelChange)="set('address', $event)" class="app-input" />
          </label>

          @if (selectedSale(); as sale) {
            <label class="block col-span-2 lg:col-span-4">
              <span class="app-label">{{ prefs.txt('ইনভয়েসের পণ্য লাইন', 'Invoice Item') }}</span>
              <select [disabled]="settledEdit()" [ngModel]="saleItemId()" (ngModelChange)="pickSaleItem($event)" class="app-input">
                <option [ngValue]="null">{{ prefs.txt('সঠিক পণ্য ও সিরিয়াল নির্বাচন করুন', 'Choose the correct item and serial') }}</option>
                @for (item of sale.items; track item.id) {
                  <option [ngValue]="item.id">{{ item.productName }} · {{ item.serialNumber || '-' }} · {{ item.quantity }} {{ item.unit }}</option>
                }
              </select>
            </label>
          }
          <label class="block lg:col-span-2">
            <span class="app-label">{{ prefs.txt('পণ্য', 'Product') }} *</span>
            <select [disabled]="settledEdit()" [ngModel]="form().productId" (ngModelChange)="pickProduct($event)" class="app-input">
              <option [ngValue]="null">{{ prefs.txt('পণ্য নির্বাচন করুন', 'Select product') }}</option>
              @if (missingProduct()) {
                <option [ngValue]="form().productId">{{ form().productName }} — {{ prefs.txt('তালিকা থেকে সরানো', 'Removed from catalog') }}</option>
              }
              @for (product of products(); track product.id) {
                <option [ngValue]="product.id">{{ product.name }} @if (product.warrantyDays) { · {{ product.warrantyDays }}d }</option>
              }
            </select>
            @if (form().productId === null) {
              <input aria-label="Product name" [disabled]="settledEdit()" [ngModel]="form().productName" (ngModelChange)="set('productName', $event)" [placeholder]="prefs.txt('তালিকায় না থাকলে পণ্যের নাম লিখুন', 'Enter product name if not listed')" class="app-input mt-1" />
            }
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('সিরিয়াল / IMEI', 'Serial / IMEI') }}</span>
            <input [disabled]="settledEdit()" [ngModel]="form().serialNumber" (ngModelChange)="set('serialNumber', $event)" class="app-input font-mono" />
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('পরিমাণ', 'Quantity') }} *</span>
            <div class="flex gap-1">
              <input type="number" min="0" step="0.01" [disabled]="settledEdit()" [ngModel]="form().quantity" (ngModelChange)="set('quantity', $event)" class="app-input font-mono" />
              <input [disabled]="settledEdit()" [ngModel]="form().unit" (ngModelChange)="set('unit', $event)" [placeholder]="prefs.txt('একক', 'Unit')" class="app-input w-20" />
            </div>
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('ওয়ারেন্টি শুরু', 'Warranty Start') }}</span>
            <input type="date" appDmyDate [ngModel]="form().warrantyStart" (ngModelChange)="set('warrantyStart', $event)" class="app-input" />
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('ওয়ারেন্টি মেয়াদ (দিন)', 'Warranty Days') }}</span>
            <input type="number" min="0" [ngModel]="form().warrantyDays" (ngModelChange)="set('warrantyDays', $event)" class="app-input font-mono" />
            <span class="text-[10px] text-slate-500">{{ prefs.txt('শেষ', 'Expires') }}: {{ expiryText() || '—' }}</span>
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('কন্ডিশন', 'Condition') }}</span>
            <select [ngModel]="form().condition" (ngModelChange)="set('condition', $event)" class="app-input">
              @for (item of conditionOptions(); track item) {
                <option [ngValue]="item">{{ item }}</option>
              }
            </select>
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('সম্ভাব্য ডেলিভারি', 'Expected Delivery') }}</span>
            <input type="date" appDmyDate [ngModel]="form().expectedDate" (ngModelChange)="set('expectedDate', $event)" class="app-input" />
          </label>

          <label class="block lg:col-span-2">
            <span class="app-label">{{ prefs.txt('সমস্যার বিবরণ', 'Reported Fault') }}</span>
            <textarea rows="2" [ngModel]="form().reason" (ngModelChange)="set('reason', $event)" class="app-input resize-y"></textarea>
          </label>

          <label class="block lg:col-span-2">
            <span class="app-label">{{ prefs.txt('জমা দেওয়া এক্সেসরিজ', 'Accessories Received') }}</span>
            <textarea rows="2" [ngModel]="form().accessories" (ngModelChange)="set('accessories', $event)" class="app-input resize-y"></textarea>
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('অবস্থা', 'Status') }}</span>
            <select [disabled]="settledEdit()" [ngModel]="form().status" (ngModelChange)="set('status', $event)" class="app-input">
              @for (item of statusOptions(); track item) {
                <option [ngValue]="item">{{ item }}</option>
              }
            </select>
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('সরবরাহকারী', 'Supplier') }}</span>
            <select [ngModel]="form().supplierId" (ngModelChange)="pickSupplier($event)" class="app-input">
              <option [ngValue]="null">{{ prefs.txt('প্রযোজ্য নয়', 'Not applicable') }}</option>
              @if (missingSupplier()) {
                <option [ngValue]="form().supplierId">{{ form().supplierName }} — {{ prefs.txt('তালিকায় নেই', 'Not in list') }}</option>
              }
              @for (party of suppliers(); track party.id) {
                <option [ngValue]="party.id">{{ party.name }}</option>
              }
            </select>
          </label>

          <label class="block">
            <span class="app-label">{{ prefs.txt('গ্রহণকারী', 'Received By') }}</span>
            <input [ngModel]="form().handledBy" (ngModelChange)="set('handledBy', $event)" class="app-input" />
          </label>

          <div class="block">
            <span class="app-label">{{ prefs.txt('গ্রহণ স্টক', 'Intake Stock') }}</span>
            <label class="flex items-center gap-2 mt-2 text-[11px] font-semibold">
              <input type="checkbox" [disabled]="settledEdit()" [ngModel]="form().stockIn" (ngModelChange)="set('stockIn', $event)" class="h-4 w-4 accent-teal-600" />
              {{ prefs.txt('গ্রহণ স্টকে যোগ হবে', 'Add to intake stock') }}
            </label>
            @if (form().productName) {
              <p class="text-[10px] text-slate-500 mt-1">
                {{ prefs.txt('বর্তমান গ্রহণ স্টক', 'Current intake stock') }}:
                <b class="font-mono">{{ pool().received }}</b> · {{ prefs.txt('পরিবর্তন স্টক', 'replacement') }}:
                <b class="font-mono">{{ pool().replacement }}</b>
              </p>
            }
          </div>

          <label class="block lg:col-span-4">
            <span class="app-label">{{ prefs.txt('নোট', 'Notes') }}</span>
            <textarea rows="2" [ngModel]="form().notes" (ngModelChange)="set('notes', $event)" class="app-input resize-y"></textarea>
          </label>
        </div>

        @if (formError()) {
          <p class="mx-4 mb-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 font-semibold">{{ formError() }}</p>
        }
      </section>
      } @else {

      <!-- Filters -->
      <div class="no-print bg-white dark:bg-slate-900 p-3 rounded-xl shadow-xs border border-slate-200 dark:border-slate-700 flex flex-col lg:flex-row lg:items-end gap-2">
        <label class="block flex-1 min-w-[200px]">
          <span class="app-label">{{ prefs.txt('সার্চ', 'Search') }}</span>
          <div class="relative">
            <mat-icon class="absolute left-2.5 top-2 text-slate-400 text-sm">search</mat-icon>
            <input [ngModel]="query()" (ngModelChange)="onQuery($event)" placeholder="{{ prefs.txt('ক্লেইম, কাস্টমার, সিরিয়াল, ইনভয়েস...', 'Claim, customer, serial, invoice...') }}" class="app-input pl-8" />
          </div>
        </label>
        <label class="block">
          <span class="app-label">{{ prefs.txt('অবস্থা', 'Status') }}</span>
          <select [ngModel]="statusFilter()" (ngModelChange)="onStatus($event)" class="app-input min-w-[150px]">
            <option value="">{{ prefs.txt('সব', 'All') }}</option>
            @for (item of settings().receiptStatuses; track item) {
              <option [ngValue]="item">{{ item }}</option>
            }
          </select>
        </label>
        <label class="block">
          <span class="app-label">{{ prefs.txt('শুরুর তারিখ', 'From') }}</span>
          <input type="date" appDmyDate [ngModel]="fromDate()" (ngModelChange)="onFrom($event)" class="app-input" />
        </label>
        <label class="block">
          <span class="app-label">{{ prefs.txt('শেষ তারিখ', 'To') }}</span>
          <input type="date" appDmyDate [ngModel]="toDate()" (ngModelChange)="onTo($event)" class="app-input" />
        </label>
        <span class="text-[11px] text-slate-500 whitespace-nowrap pb-2">{{ filtered().length }} {{ prefs.txt('রেকর্ড', 'records') }}</span>
      </div>

      <!-- Table -->
      <div class="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[980px] text-xs text-left border-collapse">
            <thead>
              <tr class="bg-teal-700 text-white font-bold uppercase text-[10px] tracking-wider">
                <th class="p-2.5 w-10 text-center">{{ prefs.txt('ক্রম', 'SL') }}</th>
                <th class="p-2.5">{{ prefs.txt('ক্লেইম নং', 'CLAIM NO') }}</th>
                <th class="p-2.5">{{ prefs.txt('তারিখ', 'DATE') }}</th>
                <th class="p-2.5">{{ prefs.txt('কাস্টমার', 'CUSTOMER') }}</th>
                <th class="p-2.5">{{ prefs.txt('পণ্য', 'PRODUCT') }}</th>
                <th class="p-2.5">{{ prefs.txt('সিরিয়াল', 'SERIAL') }}</th>
                <th class="p-2.5 text-center">{{ prefs.txt('পরিমাণ', 'QTY') }}</th>
                <th class="p-2.5 text-center">{{ prefs.txt('স্টক', 'STOCK') }}</th>
                <th class="p-2.5 text-center">{{ prefs.txt('অবস্থা', 'STATUS') }}</th>
                <th class="p-2.5 text-center no-print">{{ prefs.txt('অ্যাকশন', 'ACTION') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              @for (row of pager.paged(); track row.id; let idx = $index) {
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td class="p-2.5 text-center font-bold text-slate-400">{{ pager.offset() + idx + 1 }}</td>
                  <td class="p-2.5 font-mono font-bold text-teal-700 dark:text-teal-300">{{ row.claimNo }}</td>
                  <td class="p-2.5 text-slate-500">{{ dateText(row.date) }}</td>
                  <td class="p-2.5 font-bold text-slate-800 dark:text-slate-100">
                    {{ row.customerName || '-' }}
                    <span class="block text-[10px] font-mono font-normal text-slate-500">{{ row.phone || '-' }}</span>
                  </td>
                  <td class="p-2.5 font-semibold text-slate-700 dark:text-slate-200">
                    {{ row.productName }}
                    @if (row.condition) { <span class="block text-[10px] font-normal text-slate-500">{{ row.condition }}</span> }
                  </td>
                  <td class="p-2.5 font-mono text-slate-600 dark:text-slate-300">{{ row.serialNumber || '-' }}</td>
                  <td class="p-2.5 text-center font-mono">{{ row.quantity }} <span class="text-[10px] text-slate-500">{{ row.unit }}</span></td>
                  <td class="p-2.5 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold" [class]="row.stockIn ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'">
                      {{ row.stockIn ? prefs.txt('স্টকে', 'In') : prefs.txt('স্টক নেই', 'Out') }}
                    </span>
                  </td>
                  <td class="p-2.5 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold" [class]="statusClass(row)">{{ row.status }}</span>
                  </td>
                  <td class="p-2.5 text-center no-print whitespace-nowrap">
                    <button (click)="view.set(row)" [title]="prefs.txt('বিস্তারিত', 'Details')" class="p-1 text-teal-600 hover:bg-teal-100 rounded cursor-pointer"><mat-icon class="text-sm">visibility</mat-icon></button>
                    <button (click)="printRow(row)" [title]="prefs.txt('রিসিট প্রিন্ট', 'Print slip')" class="p-1 text-slate-500 hover:bg-slate-100 rounded cursor-pointer"><mat-icon class="text-sm">print</mat-icon></button>
                    <button (click)="editReceipt(row)" [title]="prefs.txt('এডিট', 'Edit')" class="p-1 text-sky-600 hover:bg-sky-100 rounded cursor-pointer"><mat-icon class="text-sm">edit</mat-icon></button>
                    <button (click)="startReplace(row)" [title]="prefs.txt('পরিবর্তন করুন', 'Replace')" class="p-1 text-emerald-600 hover:bg-emerald-100 rounded cursor-pointer"><mat-icon class="text-sm">swap_horiz</mat-icon></button>
                    <button (click)="remove(row)" [title]="prefs.txt('ডিলিট', 'Delete')" class="p-1 text-rose-600 hover:bg-rose-100 rounded cursor-pointer"><mat-icon class="text-sm">delete</mat-icon></button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="10" class="p-10 text-center text-slate-400 italic">
                    <mat-icon class="text-4xl text-slate-300 block mb-1">assignment_return</mat-icon>
                    {{ prefs.txt('এখনো কোনো ওয়ারেন্টি গ্রহণ নেই। “নতুন গ্রহণ” থেকে প্রথম ক্লেইম খুলুন।', 'No warranty receipt yet. Open the first claim with “New Receipt”.') }}
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
      }
    </div>

    <!-- Detail -->
    @if (view(); as row) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 flex items-center justify-center p-4" (click)="view.set(null)">
        <div class="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 border border-slate-200 dark:border-slate-700" (click)="$event.stopPropagation()">
          <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 mb-3">
            <h3 class="font-bold text-base flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <mat-icon class="text-teal-600">assignment_return</mat-icon> {{ row.claimNo }}
            </h3>
            <button (click)="view.set(null)" class="text-slate-400 hover:text-slate-600 cursor-pointer"><mat-icon>close</mat-icon></button>
          </div>
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
            <div><dt class="text-slate-500">{{ prefs.txt('তারিখ', 'Date') }}</dt><dd class="font-bold">{{ dateText(row.date) }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('অবস্থা', 'Status') }}</dt><dd class="font-bold">{{ row.status }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('কাস্টমার', 'Customer') }}</dt><dd class="font-bold">{{ row.customerName }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('মোবাইল', 'Mobile') }}</dt><dd class="font-mono font-bold">{{ row.phone || '-' }}</dd></div>
            <div class="sm:col-span-2"><dt class="text-slate-500">{{ prefs.txt('ঠিকানা', 'Address') }}</dt><dd class="font-bold">{{ addr(row.address) }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('পণ্য', 'Product') }}</dt><dd class="font-bold text-teal-700 dark:text-teal-300">{{ row.productName }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('সিরিয়াল', 'Serial') }}</dt><dd class="font-mono font-bold">{{ row.serialNumber || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('পরিমাণ', 'Quantity') }}</dt><dd class="font-bold">{{ row.quantity }} {{ row.unit }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('কন্ডিশন', 'Condition') }}</dt><dd class="font-bold">{{ row.condition || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('ইনভয়েস', 'Invoice') }}</dt><dd class="font-mono font-bold">{{ row.invoiceNumber || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('মেয়াদ শেষ', 'Expires') }}</dt><dd class="font-bold">{{ expiryOf(row) || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('সরবরাহকারী', 'Supplier') }}</dt><dd class="font-bold">{{ row.supplierName || '-' }}</dd></div>
            <div><dt class="text-slate-500">{{ prefs.txt('গ্রহণকারী', 'Received By') }}</dt><dd class="font-bold">{{ row.handledBy || '-' }}</dd></div>
            <div class="sm:col-span-2"><dt class="text-slate-500">{{ prefs.txt('সমস্যা', 'Fault') }}</dt><dd class="font-bold whitespace-pre-line">{{ row.reason || '-' }}</dd></div>
            <div class="sm:col-span-2"><dt class="text-slate-500">{{ prefs.txt('এক্সেসরিজ', 'Accessories') }}</dt><dd class="font-bold whitespace-pre-line">{{ row.accessories || '-' }}</dd></div>
            @if (row.replacementClaimNo) {
              <div class="sm:col-span-2 mt-1 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-800 font-bold">
                {{ prefs.txt('পরিবর্তন হয়েছে', 'Replaced') }}: <span class="font-mono">{{ row.replacementClaimNo }}</span>
              </div>
            }
          </dl>
          <div class="flex justify-end gap-2 mt-4">
            <button (click)="printRow(row)" class="bg-teal-600 hover:bg-teal-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer">
              <mat-icon class="text-sm">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (voucherReceipt(); as row) {
      <app-warranty-claim [receipt]="row" (close)="voucherReceipt.set(null)" />
    }
  `,
  styles: [`
    .app-label { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: #64748b; margin-bottom: 3px; }
    .app-input { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; padding: 7px 9px; font-size: 12px; color: #0f172a; outline: none; }
    .app-input:focus { border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13,148,136,.15); }
    :host-context(.dark) .app-label { color: #94a3b8; }
    :host-context(.dark) .app-input { background: #0b1220; border-color: #475569; color: #e2e8f0; }
  `]
})
export class WarrantyReceive {
  private dataService = inject(DataService);
  private notify = inject(NotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  readonly prefs = inject(PreferencesService);

  addr(value?: string): string {
    return localizeAddress(value, this.prefs.language()) || '-';
  }
  /** The list and the form live on separate routes; only one is rendered at a time. */
  readonly isFormView = this.route.snapshot.data['warrantyView'] === 'form';

  readonly settings = this.dataService.warrantySettings;
  readonly dateText = dmyFromIso;

  readonly query = signal('');
  readonly statusFilter = signal('');
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly editId = signal<number | null>(null);
  readonly formError = signal('');
  readonly view = signal<WarrantyReceipt | null>(null);
  readonly voucherReceipt = signal<WarrantyReceipt | null>(null);
  readonly form = signal<ReceiptForm>(this.emptyForm());
  private savedForm = JSON.stringify(this.form());
  readonly saleItemId = signal<number | null>(null);
  readonly selectedSale = computed(() => this.dataService.sales().find(s => s.id === this.form().saleId));
  /** A receipt settled by a replacement voucher keeps its stock/status fields frozen. */
  readonly settledEdit = computed(() => {
    const editing = this.editId();
    const receipt = editing == null ? undefined : this.dataService.warrantyReceipts().find(r => r.id === editing);
    return !!receipt?.replacementClaimNo;
  });

  constructor() {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (!idParam) return;
    const id = Number(idParam);
    const row = /^\d+$/.test(idParam) ? this.dataService.warrantyReceipts().find(r => r.id === id) : undefined;
    if (!row) {
      this.notify.error(
        this.prefs.txt('গ্রহণ ক্লেইমটি খুঁজে পাওয়া যায়নি।', 'Receipt not found.'),
        this.prefs.txt('খুঁজে পাওয়া যায়নি', 'Not found')
      );
      this.router.navigate(['/warranty/receive']);
      return;
    }
    this.loadIntoForm(row);
  }

  confirmLeave(): boolean | Promise<boolean> {
    return JSON.stringify(this.form()) === this.savedForm || this.notify.confirm(this.prefs.txt('অসংরক্ষিত পরিবর্তন বাদ দিয়ে বের হবেন?', 'Leave without saving your changes?'));
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    if (JSON.stringify(this.form()) !== this.savedForm) { event.preventDefault(); event.returnValue = ''; }
  }

  readonly claimNo = computed(() => {
    const editing = this.editId();
    if (editing != null) {
      return this.dataService.warrantyReceipts().find(r => r.id === editing)?.claimNo || '';
    }
    return this.dataService.peekWarrantyReceiptNo();
  });

  readonly products = computed(() => this.dataService.products().slice().sort((a, b) => a.name.localeCompare(b.name)));

  readonly saleOptions = computed(() => this.dataService.sales()
    .filter(sale => sale.status !== 'Cancelled')
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')));

  readonly customers = computed(() => this.dataService.parties()
    .filter(party => (party.roles?.length ? party.roles : [party.type]).some(role => role === 'Customer' || role === 'Corporate Customer' || role === 'Dealer'))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name)));

  readonly suppliers = computed(() => this.dataService.parties()
    .filter(party => (party.roles?.length ? party.roles : [party.type]).includes('Supplier'))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name)));

  readonly missingProduct = computed(() => this.form().productId !== null && !this.products().some(p => p.id === this.form().productId));
  readonly missingSupplier = computed(() => this.form().supplierId !== null && !this.suppliers().some(p => p.id === this.form().supplierId));
  readonly conditionOptions = computed(() => [...new Set([...this.settings().conditions, this.form().condition])]);
  readonly statusOptions = computed(() => [...new Set([...this.settings().receiptStatuses, this.form().status])]);

  readonly product = computed<Product | undefined>(() => {
    const id = this.form().productId;
    return id == null ? undefined : this.products().find(p => p.id === id);
  });

  readonly pool = computed(() => {
    const form = this.form();
    return this.dataService.warrantyStockOf(form.productId ?? undefined, form.productName, form.unit);
  });

  readonly expiryText = computed(() => {
    const form = this.form();
    return form.warrantyStart && form.warrantyDays ? dmyFromIso(warrantyExpiryDate(form.warrantyStart, form.warrantyDays)) : '';
  });

  readonly rows = computed(() => this.dataService.warrantyReceipts()
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.claimNo.localeCompare(a.claimNo)));

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const status = this.statusFilter();
    const from = isoDay(this.fromDate());
    const to = isoDay(this.toDate());
    return this.rows().filter(row => {
      if (status && row.status !== status) return false;
      const day = isoDay(row.date);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (!q) return true;
      return [row.claimNo, row.customerName, row.phone, row.productName, row.serialNumber, row.invoiceNumber, row.status, row.reason]
        .some(value => (value || '').toLowerCase().includes(q));
    });
  });

  readonly pager = createPager(() => this.filtered());

  readonly stats = computed(() => ({
    ...this.dataService.warrantyClaimStats(),
    unitsReceived: this.dataService.warrantyStockRows().filter(row => row.received > 0).length
  }));

  onQuery(value: string) { this.query.set(value); this.pager.setPage(1); }
  onStatus(value: string) { this.statusFilter.set(value); this.pager.setPage(1); }
  onFrom(value: string) { this.fromDate.set(value); this.pager.setPage(1); }
  onTo(value: string) { this.toDate.set(value); this.pager.setPage(1); }

  set<K extends keyof ReceiptForm>(key: K, value: ReceiptForm[K]) {
    this.form.update(current => ({ ...current, [key]: value }));
  }

  pickSale(saleId: number | null) {
    const sale = this.dataService.sales().find(s => s.id === saleId);
    this.form.update(current => ({
      ...current, saleId: sale?.id ?? null, invoiceNumber: sale?.invoice || '',
      customerName: sale?.customerName || '', phone: sale?.mobile || '', address: sale?.address || '',
      warrantyStart: isoDay(sale?.date), productId: null, productName: '', serialNumber: '', quantity: 1
    }));
    this.pickSaleItem(sale?.items.length === 1 ? sale.items[0].id : null);
  }

  pickSaleItem(itemId: number | null) {
    this.saleItemId.set(itemId);
    const item = this.selectedSale()?.items.find(i => i.id === itemId);
    const product = this.products().find(p => p.id === item?.productId);
    this.form.update(current => ({
      ...current, productId: item?.productId ?? null, productName: item?.productName || '',
      serialNumber: item?.serialNumber || '', quantity: item?.quantity || 1, unit: item?.unit || product?.unit || 'pcs',
      warrantyDays: product?.warrantyDays ?? this.settings().defaultWarrantyDays
    }));
  }

  pickCustomerName(name: string) {
    const party = this.customers().find(item => item.name === name);
    this.form.update(current => {
      // Keep the pulled invoice while the name still matches that sale's customer.
      const linkedSale = current.saleId != null
        ? this.dataService.sales().find(sale => sale.id === current.saleId)
        : undefined;
      const keepLink = !!linkedSale && (linkedSale.customerName || '').trim() === name.trim();
      return {
        ...current,
        customerName: name,
        phone: party?.phone || '',
        address: party?.addressText || party?.address || '',
        saleId: keepLink ? current.saleId : null,
        invoiceNumber: keepLink ? current.invoiceNumber : ''
      };
    });
  }

  pickProduct(productId: number | null) {
    if (productId === this.form().productId) return;
    const product = productId == null ? undefined : this.dataService.products().find(p => p.id === productId);
    this.form.update(current => ({
      ...current,
      productId: productId ?? null,
      productName: product?.name || '',
      serialNumber: '',
      unit: product?.unit || current.unit,
      warrantyDays: Math.round(Number(product?.warrantyDays) || Number(this.settings().defaultWarrantyDays) || 0)
    }));
  }

  pickSupplier(supplierId: number | null) {
    if (supplierId === this.form().supplierId) return;
    const party = supplierId == null ? undefined : this.dataService.parties().find(p => p.id === supplierId);
    this.form.update(current => ({ ...current, supplierId: supplierId ?? null, supplierName: party?.name || '' }));
  }

  private emptyForm(): ReceiptForm {
    return {
      date: localDateIso(),
      saleId: null,
      invoiceNumber: '',
      customerName: '',
      phone: '',
      address: '',
      productId: null,
      productName: '',
      serialNumber: '',
      quantity: 1,
      unit: 'pcs',
      warrantyStart: '',
      warrantyDays: Math.round(Number(this.dataService.warrantySettings().defaultWarrantyDays) || 0),
      condition: this.dataService.warrantySettings().conditions[0] || '',
      reason: '',
      accessories: '',
      expectedDate: '',
      status: this.dataService.warrantySettings().receiptStatuses[0] || '',
      supplierId: null,
      supplierName: '',
      stockIn: true,
      handledBy: '',
      notes: ''
    };
  }

  private clearForm() {
    this.form.set(this.emptyForm());
    this.savedForm = JSON.stringify(this.form());
    this.saleItemId.set(null);
    this.editId.set(null);
    this.formError.set('');
  }

  save() {
    const form = this.form();
    const settings = this.settings();
    const customer = (form.customerName || '').trim();
    const product = (form.productName || '').trim();
    const date = isoDay(form.date);
    const quantity = Number(form.quantity);
    if (!customer || !product || !date || !Number.isFinite(quantity) || !(quantity > 0)
      || !Number.isFinite(Number(form.warrantyDays)) || Number(form.warrantyDays) < 0) {
      this.formError.set(this.prefs.txt('কাস্টমার, পণ্য, তারিখ ও পরিমাণ আবশ্যক।', 'Customer, product, date and a positive quantity are required.'));
      return;
    }
    if (!Number.isSafeInteger(Math.round(quantity * 100)) || Math.abs(quantity * 100 - Math.round(quantity * 100)) > 1e-7) {
      this.formError.set(this.prefs.txt('পরিমাণে সর্বোচ্চ দুই দশমিক ব্যবহার করুন।', 'Use at most two decimal places for quantity.'));
      return;
    }
    if (settings.requireInvoice && !(form.invoiceNumber || '').trim()) {
      this.formError.set(this.prefs.txt('ইনভয়েস নম্বর আবশ্যক (সেটিংস অনুযায়ী)।', 'Invoice number is required by your settings.'));
      return;
    }
    const serial = (form.serialNumber || '').trim();
    if (settings.requireSerial && !serial) {
      this.formError.set(this.prefs.txt('সিরিয়াল নম্বর আবশ্যক (সেটিংস অনুযায়ী)।', 'Serial number is required by your settings.'));
      return;
    }
    const editId = this.editId();
    if (serial && !isWarrantyCancelled(form.status) && !isWarrantyCompleted(form.status)) {
      const duplicate = this.dataService.warrantyReceipts().find(row =>
        row.id !== editId
        && !row.replacementClaimNo
        && !isWarrantyCancelled(row.status)
        && !isWarrantyCompleted(row.status)
        && (row.serialNumber || '').trim().toLowerCase() === serial.toLowerCase());
      if (duplicate) {
        this.formError.set(this.prefs.txt(`এই সিরিয়ালের একটি চলমান ক্লেইম আছে: ${duplicate.claimNo}`, `An open claim already holds this serial: ${duplicate.claimNo}`));
        return;
      }
    }
    this.formError.set('');

    const payload = {
      date,
      customerName: customer,
      phone: (form.phone || '').trim(),
      address: (form.address || '').trim(),
      invoiceNumber: (form.invoiceNumber || '').trim(),
      saleId: form.saleId ?? undefined,
      productId: form.productId ?? undefined,
      productName: product,
      serialNumber: serial,
      quantity,
      unit: (form.unit || '').trim(),
      warrantyStart: isoDay(form.warrantyStart) || undefined,
      warrantyDays: Math.round(Number(form.warrantyDays) || 0),
      condition: form.condition || '',
      reason: (form.reason || '').trim(),
      accessories: (form.accessories || '').trim(),
      expectedDate: isoDay(form.expectedDate) || undefined,
      status: form.status || '',
      supplierId: form.supplierId ?? undefined,
      supplierName: (form.supplierName || '').trim(),
      stockIn: !!form.stockIn,
      notes: (form.notes || '').trim(),
      handledBy: (form.handledBy || '').trim()
    };

    if (editId != null) {
      const result = this.dataService.updateWarrantyReceipt(editId, { ...payload, updatedAt: new Date().toISOString() });
      if (!result.ok) {
        this.formError.set(this.updateErrorText(result.error));
        return;
      }
      this.notify.success(this.prefs.txt('গ্রহণ আপডেট হয়েছে।', 'Receipt updated.'));
    } else {
      let record: WarrantyReceipt;
      try {
        record = this.dataService.recordWarrantyReceipt(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        this.formError.set(message.includes('serial')
          ? this.prefs.txt('এই সিরিয়ালের একটি চলমান ক্লেইম আছে।', 'An open claim already holds this serial.')
          : this.prefs.txt('ক্লেইম সংরক্ষণ করা যায়নি; তথ্য যাচাই করে আবার চেষ্টা করুন।', 'The claim could not be saved; check the details and retry.'));
        return;
      }
      this.notify.success(this.prefs.txt(`ক্লেইম ${record.claimNo} তৈরি হয়েছে।`, `Claim ${record.claimNo} created.`));
    }
    this.clearForm();
    this.router.navigate(['/warranty/receive']);
  }

  editReceipt(row: WarrantyReceipt) {
    this.router.navigate(['/warranty/receive', row.id, 'edit']);
  }

  /** Hydrates the standalone form route straight from the stored receipt. */
  private loadIntoForm(row: WarrantyReceipt) {
    this.editId.set(row.id);
    this.formError.set('');
    this.form.set({
      date: isoDay(row.date) || localDateIso(),
      saleId: row.saleId ?? null,
      invoiceNumber: row.invoiceNumber || '',
      customerName: row.customerName || '',
      phone: row.phone || '',
      address: row.address || '',
      productId: row.productId ?? null,
      productName: row.productName || '',
      serialNumber: row.serialNumber || '',
      quantity: Number(row.quantity) || 1,
      unit: row.unit || 'pcs',
      warrantyStart: isoDay(row.warrantyStart || ''),
      warrantyDays: Math.round(Number(row.warrantyDays) || 0),
      condition: row.condition || '',
      reason: row.reason || '',
      accessories: row.accessories || '',
      expectedDate: isoDay(row.expectedDate || ''),
      status: row.status || '',
      supplierId: row.supplierId ?? null,
      supplierName: row.supplierName || '',
      stockIn: !!row.stockIn,
      handledBy: row.handledBy || '',
      notes: row.notes || ''
    });
    this.savedForm = JSON.stringify(this.form());
    this.saleItemId.set(this.selectedSale()?.items.find(item => item.productId === row.productId && (item.serialNumber || '') === row.serialNumber)?.id ?? null);
  }

  async remove(row: WarrantyReceipt) {
    const ok = await this.notify.confirm(
      this.prefs.txt(`${row.claimNo} ক্লেইমটি ডিলিট করবেন? গ্রহণ স্টকও সমন্বয় হবে।`, `Delete claim ${row.claimNo}? The intake stock will be adjusted too.`),
      { title: this.prefs.txt('ডিলিট নিশ্চিত করুন', 'Confirm Delete') }
    );
    if (!ok) return;
    const result = this.dataService.deleteWarrantyReceipt(row.id);
    if (!result.ok) {
      this.notify.error(result.error === 'replaced'
        ? this.prefs.txt('এই ক্লেইম থেকে পরিবর্তন তৈরি হয়েছে — আগে পরিবর্তনটি ডিলিট করুন।', 'A replacement was raised from this claim — delete that first.')
        : result.error === 'received-shortage'
          ? this.prefs.txt('গ্রহণ স্টক যথেষ্ট নয়, তাই এই ক্লেইম ডিলিট করা যাবে না।', 'Insufficient intake stock to delete this claim.')
          : this.prefs.txt('ক্লেইম পাওয়া যায়নি।', 'Claim not found.'));
      return;
    }
    this.notify.success(this.prefs.txt('ক্লেইম ডিলিট হয়েছে।', 'Claim deleted.'));
    if (this.editId() === row.id) this.clearForm();
  }

  printRow(row: WarrantyReceipt) {
    this.voucherReceipt.set(row);
  }

  startReplace(row: WarrantyReceipt) {
    this.router.navigate(['/warranty/replace/new'], { queryParams: { receipt: row.id } });
  }

  expiryOf(row: WarrantyReceipt): string {
    return row.warrantyStart && row.warrantyDays ? dmyFromIso(warrantyExpiryDate(row.warrantyStart, row.warrantyDays)) : '';
  }

  statusClass(row: WarrantyReceipt): string {
    if (row.replacementClaimNo) return 'bg-sky-100 text-sky-800';
    if ((row.status || '').includes('বাতিল') || (row.status || '').toLowerCase() === 'cancelled') return 'bg-slate-200 text-slate-600';
    if ((row.status || '').includes('গ্রহণ')) return 'bg-amber-100 text-amber-800';
    return 'bg-emerald-100 text-emerald-800';
  }

  private updateErrorText(error?: string): string {
    switch (error) {
      case 'settled':
        return this.prefs.txt('এই ক্লেইম থেকে পরিবর্তন হয়েছে, তাই স্টক ও স্ট্যাটাস আর বদলানো যাবে না (ভাউচারটি দেখুন)।', 'This claim is already replaced, so its stock and status are locked (see the voucher).');
      case 'received-shortage':
        return this.prefs.txt('গ্রহণ স্টক যথেষ্ট নয়, তাই এই গ্রহণ আপডেট করা যাবে না।', 'Insufficient intake stock to update this receipt.');
      default:
        return this.prefs.txt('গ্রহণ আপডেট করা যায়নি।', 'Could not update the receipt.');
    }
  }

  exportExcel() {
    const rows = this.filtered().map((row, index) => ({
      SL: index + 1,
      'Claim No': row.claimNo,
      Date: row.date,
      Customer: row.customerName,
      Phone: row.phone,
      Product: row.productName,
      Serial: row.serialNumber,
      Qty: row.quantity,
      Unit: row.unit,
      Condition: row.condition,
      Invoice: row.invoiceNumber,
      Status: row.status,
      'Stock In': row.stockIn ? 'Yes' : 'No',
      Supplier: row.supplierName || '',
      Reason: row.reason || ''
    }));
    this.dataService.exportToExcel(rows, 'Warranty_Receipts');
  }
}
